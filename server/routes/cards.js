import { Router } from 'express';
import { query } from '../db.js';
import pool from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { shouldAutoRed, reviewDeadline } from '../card-engine.js';
import { publishRedCard } from '../nostr.js';
import { isValidPubkey, isValidCategory, isValidOptionalText } from '../validation.js';

const router = Router();

export function validateCardInput(body) {
  const { card_type, fan_signet_pubkey, category, match_date, notes } = body;
  if (!card_type || !['yellow', 'red'].includes(card_type)) {
    return { valid: false, error: 'card_type must be yellow or red' };
  }
  if (!fan_signet_pubkey) return { valid: false, error: 'fan_signet_pubkey required' };
  if (fan_signet_pubkey.length > 200) return { valid: false, error: 'fan_signet_pubkey too long' };
  if (!isValidPubkey(fan_signet_pubkey)) return { valid: false, error: 'Invalid pubkey format' };
  if (!category) return { valid: false, error: 'category required' };
  if (category !== 'Other' && !isValidCategory(category)) {
    return { valid: false, error: 'Invalid category' };
  }
  if (!match_date) return { valid: false, error: 'match_date required' };
  if (notes && notes.length > 280) return { valid: false, error: 'notes must be 280 chars or fewer' };
  return { valid: true };
}

router.post('/', verifyStaff, requireRole('roaming_steward', 'safety_officer'), async (req, res) => {
  const validation = validateCardInput(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { card_type, fan_signet_pubkey, category, match_date, notes, seat_or_location } = req.body;
  if (!isValidOptionalText(seat_or_location, 100)) {
    return res.status(400).json({ error: 'seat_or_location max 100 characters' });
  }

  // Validate match_date is today or yesterday (for late-night matches)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  // Note: uses server-local time. If server runs in UTC and steward is in BST,
  // a card at 23:30 BST (00:30+1 UTC) may be rejected. For the pilot this is
  // acceptable — production should use the club's configured timezone.
  if (match_date !== todayStr && match_date !== yesterdayStr) {
    return res.status(400).json({ error: 'match_date must be today or yesterday' });
  }

  const seasonResult = await query(
    'SELECT season_id FROM seasons WHERE club_id = $1 AND is_active = true',
    [req.staff.club_id]
  );
  if (seasonResult.rows.length === 0) {
    return res.status(400).json({ error: 'No active season' });
  }
  const seasonId = seasonResult.rows[0].season_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reject card issuance if fan is already banned
    const banCheck = await client.query(
      'SELECT sanction_id FROM sanctions WHERE fan_signet_pubkey = $1 AND status = $2',
      [fan_signet_pubkey, 'active']
    );
    if (banCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fan has an active ban or suspension — card issuance not applicable' });
    }

    let autoRed = false;
    if (card_type === 'yellow') {
      const existingCards = await client.query(
        `SELECT * FROM cards WHERE fan_signet_pubkey = $1 AND club_id = $2
         AND season_id = $3 AND card_type = 'yellow' AND status = 'active'
         FOR UPDATE`,
        [fan_signet_pubkey, req.staff.club_id, seasonId]
      );
      if (shouldAutoRed(existingCards.rows)) {
        autoRed = true;
      }
    }

    const deadline = reviewDeadline(card_type);

    const result = await client.query(
      `INSERT INTO cards (card_type, fan_signet_pubkey, issued_by, club_id, season_id,
       match_date, category, notes, seat_or_location, review_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [card_type, fan_signet_pubkey, req.staff.staff_id, req.staff.club_id,
       seasonId, match_date, category, notes || null, seat_or_location || null, deadline]
    );

    const card = result.rows[0];

    let autoRedCard = null;
    if (autoRed) {
      const redDeadline = reviewDeadline('red');
      const redResult = await client.query(
        `INSERT INTO cards (card_type, fan_signet_pubkey, issued_by, club_id, season_id,
         match_date, category, notes, review_deadline)
         VALUES ('red', $1, $2, $3, $4, $5, 'Auto-red: two yellows', 'Triggered by second yellow card', $6) RETURNING *`,
        [fan_signet_pubkey, req.staff.staff_id, req.staff.club_id,
         seasonId, match_date, redDeadline]
      );
      autoRedCard = redResult.rows[0];
    }

    await client.query('COMMIT');

    // Publish red cards to network (outside transaction)
    if (card.card_type === 'red' || autoRedCard) {
      const clubResult = await query('SELECT nostr_pubkey FROM clubs WHERE club_id = $1', [req.staff.club_id]);
      const clubPubkey = clubResult.rows[0]?.nostr_pubkey;
      if (clubPubkey) {
        const targetCard = autoRedCard || card;
        if (targetCard.card_type === 'red') {
          const eventId = await publishRedCard(targetCard, clubPubkey);
          if (eventId) {
            await query('UPDATE cards SET nostr_event_id = $1 WHERE card_id = $2', [eventId, targetCard.card_id]);
          }
        }
      }
    }

    res.status(201).json({ card, autoRed, autoRedCard });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.get('/', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const seasonResult = await query(
    'SELECT season_id FROM seasons WHERE club_id = $1 AND is_active = true',
    [req.staff.club_id]
  );
  if (seasonResult.rows.length === 0) return res.json([]);

  const result = await query(
    `SELECT c.*, s.display_name as issued_by_name
     FROM cards c JOIN staff s ON c.issued_by = s.staff_id
     WHERE c.club_id = $1 AND c.season_id = $2
     ORDER BY c.created_at DESC`,
    [req.staff.club_id, seasonResult.rows[0].season_id]
  );
  res.json(result.rows);
});

router.post('/unlinked', verifyStaff, requireRole('roaming_steward', 'safety_officer'), async (req, res) => {
  const { card_type, category, match_date, notes, seat_or_location, description } = req.body;
  if (!description) return res.status(400).json({ error: 'description required for unlinked card' });
  if (description.length > 500) return res.status(400).json({ error: 'description must be 500 chars or fewer' });
  if (notes && notes.length > 280) return res.status(400).json({ error: 'notes must be 280 chars or fewer' });
  if (!card_type || !['yellow', 'red'].includes(card_type)) {
    return res.status(400).json({ error: 'card_type must be yellow or red' });
  }
  if (!category || !isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!isValidOptionalText(seat_or_location, 100)) return res.status(400).json({ error: 'seat_or_location max 100 characters' });
  if (!match_date) return res.status(400).json({ error: 'match_date required' });
  // Validate match_date is today or yesterday
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  if (match_date !== todayStr && match_date !== yesterdayStr) {
    return res.status(400).json({ error: 'match_date must be today or yesterday' });
  }

  const result = await query(
    `INSERT INTO unlinked_cards (card_type, issued_by, club_id, match_date, category, notes, seat_or_location, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [card_type || 'yellow', req.staff.staff_id, req.staff.club_id,
     match_date, category, notes || null, seat_or_location || null, description]
  );
  res.status(201).json(result.rows[0]);
});

export default router;
