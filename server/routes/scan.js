import { Router } from 'express';
import { verifyEvent } from 'nostr-tools/pure';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { computeFanStatus, shouldExpireYellow, shouldExpireRed } from '../card-engine.js';
import { isValidScanType, isValidPhotoHash, isValidPubkey, isValidOptionalText } from '../validation.js';

const VENUE_ENTRY_KIND = 21235;
const MAX_QR_AGE_SECONDS = 60;

/**
 * Verify a kind 21235 venue entry Nostr event.
 * Returns { pubkey, photo_hash } on success, throws on failure.
 */
export function verifyVenueEntryEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid venue entry event');
  }
  if (event.kind !== VENUE_ENTRY_KIND) {
    throw new Error('Wrong event kind');
  }
  if (!event.pubkey || !/^[0-9a-f]{64}$/.test(event.pubkey)) {
    throw new Error('Missing or invalid pubkey');
  }
  if (!Array.isArray(event.tags)) {
    throw new Error('Missing tags');
  }
  const hasTypeTag = event.tags.some(
    t => Array.isArray(t) && t[0] === 't' && t[1] === 'signet-venue-entry'
  );
  if (!hasTypeTag) {
    throw new Error('Not a venue entry event');
  }

  // Freshness check
  const now = Math.floor(Date.now() / 1000);
  const age = now - event.created_at;
  if (age > MAX_QR_AGE_SECONDS) {
    throw new Error(`QR expired — ${age}s old`);
  }
  if (age < -10) {
    throw new Error('QR timestamp in the future');
  }

  // Schnorr signature verification
  if (!verifyEvent(event)) {
    throw new Error('Invalid signature');
  }

  // Extract fields from tags
  const xTag = event.tags.find(t => Array.isArray(t) && t[0] === 'x');
  const photoHash = xTag ? xTag[1] : null;

  return { pubkey: event.pubkey, photo_hash: photoHash };
}

const router = Router();

export function checkDuplicateScan(priorAdmissions, currentStaffId, currentTime = Date.now()) {
  if (priorAdmissions.length === 0) return null;
  const latest = priorAdmissions[0]; // ordered by created_at DESC
  const msSince = currentTime - new Date(latest.created_at).getTime();
  // Same staff + under 30s = steward double-tap, not a real duplicate
  if (msSince < 30_000 && latest.staff_id === currentStaffId) {
    return { stewardError: true };
  }
  // Otherwise: genuine duplicate — flag for officer review
  return { flag: true };
}

export function computeScanResult({ fanPubkey, photoHash, cards, sanctions, gateLock, seasonId }) {
  const status = computeFanStatus({ cards, sanctions });

  let photoMismatch = false;
  let needsGateLock = false;

  if (gateLock) {
    if (gateLock.photo_hash !== photoHash) {
      photoMismatch = true;
      return {
        colour: 'amber',
        yellowCount: status.yellowCount,
        reason: 'Photo mismatch — photo changed since gate-lock',
        photoMismatch: true,
        needsGateLock: false,
      };
    }
  } else {
    needsGateLock = true;
  }

  return { ...status, photoMismatch, needsGateLock };
}

router.post('/', verifyStaff, requireRole('gate_steward', 'roaming_steward', 'safety_officer'), async (req, res) => {
  let fan_signet_pubkey, photo_hash;

  // Accept either a signed venue entry event or legacy { pubkey, photo_hash }
  if (req.body.venue_entry_event) {
    try {
      const verified = verifyVenueEntryEvent(req.body.venue_entry_event);
      fan_signet_pubkey = verified.pubkey;
      photo_hash = verified.photo_hash;
    } catch (err) {
      console.error('Venue entry verification failed:', err.message);
      return res.status(400).json({ error: 'Venue entry verification failed' });
    }
  } else {
    fan_signet_pubkey = req.body.fan_signet_pubkey;
    photo_hash = req.body.photo_hash;
  }

  if (!fan_signet_pubkey || !photo_hash) {
    return res.status(400).json({ error: 'fan_signet_pubkey and photo_hash required' });
  }

  if (!isValidPubkey(fan_signet_pubkey)) {
    return res.status(400).json({ error: 'Invalid fan pubkey format' });
  }

  if (!isValidPhotoHash(photo_hash)) {
    return res.status(400).json({ error: 'Invalid photo_hash format' });
  }

  const scanType = req.body.scan_type || 'gate_entry';
  if (!isValidScanType(scanType)) {
    return res.status(400).json({ error: 'scan_type must be gate_entry or roaming_check' });
  }

  const gateId = req.body.gate_id || null;
  if (gateId && !isValidOptionalText(gateId, 50)) {
    return res.status(400).json({ error: 'gate_id too long (max 50)' });
  }

  const seasonResult = await query(
    'SELECT season_id FROM seasons WHERE club_id = $1 AND is_active = true',
    [req.staff.club_id]
  );
  if (seasonResult.rows.length === 0) {
    return res.status(400).json({ error: 'No active season configured' });
  }
  const seasonId = seasonResult.rows[0].season_id;

  // --- Duplicate scan detection ---
  if (scanType === 'gate_entry') {
    const priorAdmissions = await query(
      `SELECT scan_id, staff_id, gate_id, created_at FROM scan_log
       WHERE fan_signet_pubkey = $1 AND club_id = $2 AND match_date = CURRENT_DATE
       AND scan_type = 'gate_entry' AND result IN ('green','amber')
       ORDER BY created_at DESC LIMIT 5`,
      [fan_signet_pubkey, req.staff.club_id]
    );
    const dupCheck = checkDuplicateScan(priorAdmissions.rows, req.staff.staff_id);
    if (dupCheck?.flag) {
      const denyLog = await query(
        `INSERT INTO scan_log (fan_signet_pubkey, staff_id, club_id, match_date, scan_type, result, photo_hash_matched, gate_locked, gate_id)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, 'red', false, false, $5) RETURNING scan_id`,
        [fan_signet_pubkey, req.staff.staff_id, req.staff.club_id, scanType, gateId]
      );
      await query(
        `INSERT INTO duplicate_scan_flags (fan_signet_pubkey, club_id, match_date, first_scan_id, second_scan_id, first_gate_id, second_gate_id)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)`,
        [fan_signet_pubkey, req.staff.club_id, priorAdmissions.rows[0].scan_id, denyLog.rows[0].scan_id, priorAdmissions.rows[0].gate_id, gateId]
      );
      return res.json({ colour: 'red', reason: 'Duplicate scan — flagged for officer review', duplicate: true });
    }
    // stewardError case: proceed normally (accidental double-tap)
  }

  const cardsResult = await query(
    'SELECT * FROM cards WHERE fan_signet_pubkey = $1 AND club_id = $2 AND season_id = $3',
    [fan_signet_pubkey, req.staff.club_id, seasonId]
  );

  const sanctionsResult = await query(
    'SELECT * FROM sanctions WHERE fan_signet_pubkey = $1 AND status = $2',
    [fan_signet_pubkey, 'active']
  );

  const lockResult = await query(
    'SELECT * FROM gate_locks WHERE fan_signet_pubkey = $1 AND season_id = $2',
    [fan_signet_pubkey, seasonId]
  );

  const scanResult = computeScanResult({
    fanPubkey: fan_signet_pubkey,
    photoHash: photo_hash,
    cards: cardsResult.rows,
    sanctions: sanctionsResult.rows,
    gateLock: lockResult.rows[0] || null,
    seasonId,
  });

  if (scanResult.needsGateLock && scanResult.colour !== 'red') {
    await query(
      `INSERT INTO gate_locks (fan_signet_pubkey, photo_hash, season_id, locked_by_staff, club_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (fan_signet_pubkey, season_id) DO NOTHING`,
      [fan_signet_pubkey, photo_hash, seasonId, req.staff.staff_id, req.staff.club_id]
    );
    scanResult.gateLocked = true;
  }

  const logResult = scanResult.photoMismatch ? 'mismatch' : scanResult.colour;
  await query(
    `INSERT INTO scan_log (fan_signet_pubkey, staff_id, club_id, match_date, scan_type, result, photo_hash_matched, gate_locked, gate_id)
     VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8)`,
    [fan_signet_pubkey, req.staff.staff_id, req.staff.club_id, scanType, logResult, !scanResult.photoMismatch, scanResult.gateLocked || false, gateId]
  );

  if (scanResult.colour === 'green' && cardsResult.rows.length > 0) {
    await query(
      `UPDATE cards SET clean_matches = clean_matches + 1
       WHERE fan_signet_pubkey = $1 AND club_id = $2 AND status = 'active'`,
      [fan_signet_pubkey, req.staff.club_id]
    );

    // Expire cards that have met their clean_matches threshold
    const updatedCards = await query(
      'SELECT * FROM cards WHERE fan_signet_pubkey = $1 AND club_id = $2 AND status = $3',
      [fan_signet_pubkey, req.staff.club_id, 'active']
    );
    for (const card of updatedCards.rows) {
      if (shouldExpireYellow(card) || shouldExpireRed(card)) {
        await query(
          "UPDATE cards SET status = 'expired' WHERE card_id = $1",
          [card.card_id]
        );
      }
    }
  }

  res.json(scanResult);
});

export default router;
