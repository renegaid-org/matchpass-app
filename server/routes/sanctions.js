import { Router } from 'express';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { publishSanction, publishSanctionUpdate } from '../nostr.js';
import { isValidPubkey, isValidText, isValidUUID } from '../validation.js';

const router = Router();

router.post('/', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const { sanction_type, fan_signet_pubkey, reason, start_date, end_date, match_count } = req.body;
  if (!['suspension', 'ban'].includes(sanction_type)) {
    return res.status(400).json({ error: 'sanction_type must be suspension or ban' });
  }
  if (!fan_signet_pubkey || !reason || !start_date) {
    return res.status(400).json({ error: 'fan_signet_pubkey, reason, and start_date required' });
  }
  if (!isValidPubkey(fan_signet_pubkey)) {
    return res.status(400).json({ error: 'Invalid fan pubkey format' });
  }
  if (!isValidText(reason, 500)) {
    return res.status(400).json({ error: 'reason required and max 500 characters' });
  }
  if (match_count != null && (!Number.isInteger(match_count) || match_count < 1 || match_count > 100)) {
    return res.status(400).json({ error: 'match_count must be a positive integer (1-100)' });
  }
  // Validate start_date is reasonable (today, yesterday, or up to 30 days in future)
  const startDateObj = new Date(start_date);
  if (isNaN(startDateObj.getTime())) {
    return res.status(400).json({ error: 'start_date must be a valid date' });
  }
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 1);
  const thirtyDaysAhead = new Date(now);
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
  if (startDateObj < sevenDaysAgo || startDateObj > thirtyDaysAhead) {
    return res.status(400).json({ error: 'start_date must be between yesterday and 30 days from now' });
  }
  if (end_date) {
    const endDateObj = new Date(end_date);
    if (isNaN(endDateObj.getTime())) {
      return res.status(400).json({ error: 'end_date must be a valid date' });
    }
    if (endDateObj <= startDateObj) {
      return res.status(400).json({ error: 'end_date must be after start_date' });
    }
  }
  const result = await query(
    `INSERT INTO sanctions (sanction_type, fan_signet_pubkey, issued_by_club, reason, start_date, end_date, match_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [sanction_type, fan_signet_pubkey, req.staff.club_id, reason, start_date, end_date || null, match_count || null]
  );

  // Publish to cross-club network
  const clubResult = await query('SELECT nostr_pubkey FROM clubs WHERE club_id = $1', [req.staff.club_id]);
  const clubPubkey = clubResult.rows[0]?.nostr_pubkey;
  if (clubPubkey) {
    const eventId = await publishSanction(result.rows[0], clubPubkey);
    if (eventId) {
      await query('UPDATE sanctions SET nostr_event_id = $1 WHERE sanction_id = $2', [eventId, result.rows[0].sanction_id]);
    }
  }

  res.status(201).json(result.rows[0]);
});

// GET /api/sanctions — list active sanctions
// Design tension: the scan API requires full fan pubkeys to enforce cross-club bans.
// This endpoint is also consumed by the dashboard view. The pilot accepts this tension:
// the fix is in the frontend — don't display raw pubkeys to the safety officer.
// Future: split into a scan-internal endpoint (full pubkey) and a dashboard endpoint
// (hashed or omitted pubkey).
router.get('/', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  // Own club's sanctions: full detail
  const ownResult = await query(
    `SELECT s.*, c.name as issuing_club_name
     FROM sanctions s JOIN clubs c ON s.issued_by_club = c.club_id
     WHERE s.status = 'active' AND s.issued_by_club = $1
     ORDER BY s.created_at DESC`,
    [req.staff.club_id]
  );

  // Other clubs' sanctions: minimal fields only
  const otherResult = await query(
    `SELECT s.fan_signet_pubkey, s.sanction_type, s.status, s.start_date, s.end_date, c.name as issuing_club_name
     FROM sanctions s JOIN clubs c ON s.issued_by_club = c.club_id
     WHERE s.status = 'active' AND s.issued_by_club != $1
     ORDER BY s.created_at DESC`,
    [req.staff.club_id]
  );

  res.json({ own: ownResult.rows, network: otherResult.rows });
});

router.patch('/:id', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid sanction ID' });
  const { status } = req.body;
  if (!['overturned', 'expired'].includes(status)) {
    return res.status(400).json({ error: 'status must be overturned or expired' });
  }
  const result = await query(
    'UPDATE sanctions SET status = $1 WHERE sanction_id = $2 AND issued_by_club = $3 RETURNING *',
    [status, req.params.id, req.staff.club_id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Sanction not found' });

  // Publish status update to network
  const clubResult2 = await query('SELECT nostr_pubkey FROM clubs WHERE club_id = $1', [req.staff.club_id]);
  if (clubResult2.rows[0]?.nostr_pubkey) {
    await publishSanctionUpdate(req.params.id, status, clubResult2.rows[0].nostr_pubkey);
  }

  res.json(result.rows[0]);
});

export default router;
