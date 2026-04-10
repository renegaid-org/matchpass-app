import { Router } from 'express';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidUUID } from '../validation.js';

const router = Router();

router.get('/today', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const clubId = req.staff.club_id;
  const today = new Date().toISOString().split('T')[0];

  const [scans, cards, incidents] = await Promise.all([
    query(
      `SELECT result, COUNT(*)::int as count FROM scan_log
       WHERE club_id = $1 AND match_date = $2 GROUP BY result`,
      [clubId, today]
    ),
    query(
      `SELECT card_type, COUNT(*)::int as count FROM cards
       WHERE club_id = $1 AND match_date = $2 GROUP BY card_type`,
      [clubId, today]
    ),
    query(
      `SELECT c.card_id, c.card_type, c.category, c.notes, c.status, c.seat_or_location, c.created_at, c.match_date, s.display_name as issued_by_name
       FROM cards c JOIN staff s ON c.issued_by = s.staff_id
       WHERE c.club_id = $1 AND c.match_date = $2 ORDER BY c.created_at DESC`,
      [clubId, today]
    ),
  ]);

  res.json({
    date: today,
    scans: Object.fromEntries(scans.rows.map(r => [r.result, r.count])),
    cardCounts: Object.fromEntries(cards.rows.map(r => [r.card_type, r.count])),
    incidents: incidents.rows,
  });
});

router.get('/review-queue', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const result = await query(
    `SELECT c.card_id, c.card_type, c.category, c.notes, c.status, c.challenge_text, c.review_deadline, c.created_at, c.match_date, s.display_name as issued_by_name
     FROM cards c JOIN staff s ON c.issued_by = s.staff_id
     WHERE c.club_id = $1 AND c.card_type = 'red'
     AND c.review_outcome IS NULL
     ORDER BY c.review_deadline ASC`,
    [req.staff.club_id]
  );
  res.json(result.rows);
});

router.patch('/review/:cardId', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  if (!isValidUUID(req.params.cardId)) return res.status(400).json({ error: 'Invalid card ID' });
  const { review_outcome, review_notes } = req.body;
  if (!['confirmed', 'downgraded', 'dismissed'].includes(review_outcome)) {
    return res.status(400).json({ error: 'review_outcome must be confirmed, downgraded, or dismissed' });
  }
  if (review_notes && review_notes.length > 500) {
    return res.status(400).json({ error: 'review_notes max 500 characters' });
  }

  let newStatus = 'active';
  if (review_outcome === 'dismissed') newStatus = 'dismissed';

  const result = await query(
    `UPDATE cards SET review_outcome = $1, review_notes = $2, reviewed_by = $3,
     reviewed_at = NOW(), status = $4
     WHERE card_id = $5 AND club_id = $6 RETURNING *`,
    [review_outcome, review_notes || null, req.staff.staff_id, newStatus, req.params.cardId, req.staff.club_id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Card not found' });

  if (review_outcome === 'downgraded') {
    await query('UPDATE cards SET card_type = $1 WHERE card_id = $2', ['yellow', req.params.cardId]);
  }

  res.json(result.rows[0]);
});

router.get('/scan-flags', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const result = await query(
    `SELECT f.flag_id, f.fan_signet_pubkey, f.match_date, f.first_gate_id, f.second_gate_id, f.created_at, f.notes,
            s1.created_at as first_scan_time, s2.created_at as second_scan_time,
            st.display_name as flagged_by_staff
     FROM duplicate_scan_flags f
     LEFT JOIN scan_log s1 ON f.first_scan_id = s1.scan_id
     LEFT JOIN scan_log s2 ON f.second_scan_id = s2.scan_id
     LEFT JOIN staff st ON s2.staff_id = st.staff_id
     WHERE f.club_id = $1 AND f.dismissed_at IS NULL
     ORDER BY f.created_at DESC
     LIMIT 50`,
    [req.staff.club_id]
  );
  res.json(result.rows);
});

router.patch('/scan-flags/:flagId/dismiss', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  if (!isValidUUID(req.params.flagId)) return res.status(400).json({ error: 'Invalid flag ID' });
  const { notes } = req.body;
  if (notes && notes.length > 500) {
    return res.status(400).json({ error: 'notes max 500 characters' });
  }
  const result = await query(
    `UPDATE duplicate_scan_flags SET dismissed_by = $1, dismissed_at = NOW(), notes = $2
     WHERE flag_id = $3 AND club_id = $4 AND dismissed_at IS NULL RETURNING *`,
    [req.staff.staff_id, notes || null, req.params.flagId, req.staff.club_id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Flag not found' });
  res.json(result.rows[0]);
});

router.get('/season-stats', verifyStaff, requireRole('safety_officer'), async (req, res) => {
  const seasonResult = await query(
    'SELECT season_id FROM seasons WHERE club_id = $1 AND is_active = true',
    [req.staff.club_id]
  );
  if (seasonResult.rows.length === 0) return res.json({});
  const seasonId = seasonResult.rows[0].season_id;

  const [totalCards, byCategory, byMatch] = await Promise.all([
    query(
      'SELECT card_type, COUNT(*)::int as count FROM cards WHERE club_id = $1 AND season_id = $2 GROUP BY card_type',
      [req.staff.club_id, seasonId]
    ),
    query(
      'SELECT category, COUNT(*)::int as count FROM cards WHERE club_id = $1 AND season_id = $2 GROUP BY category ORDER BY count DESC',
      [req.staff.club_id, seasonId]
    ),
    query(
      'SELECT match_date, COUNT(*)::int as count FROM cards WHERE club_id = $1 AND season_id = $2 GROUP BY match_date ORDER BY match_date',
      [req.staff.club_id, seasonId]
    ),
  ]);

  res.json({
    totalCards: Object.fromEntries(totalCards.rows.map(r => [r.card_type, r.count])),
    byCategory: byCategory.rows,
    byMatch: byMatch.rows,
  });
});

export default router;
