import { Router } from 'express';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidPubkey } from '../validation.js';

const router = Router();

router.post('/', verifyStaff, requireRole('safeguarding_officer'), async (req, res) => {
  const { parent_signet_pubkey, child_signet_pubkey, relationship } = req.body;
  if (!parent_signet_pubkey || !child_signet_pubkey) {
    return res.status(400).json({ error: 'Both parent and child pubkeys required' });
  }
  if (!isValidPubkey(parent_signet_pubkey) || !isValidPubkey(child_signet_pubkey)) {
    return res.status(400).json({ error: 'Invalid pubkey format' });
  }
  if (!['parent', 'guardian', 'other'].includes(relationship)) {
    return res.status(400).json({ error: 'relationship must be parent, guardian, or other' });
  }
  const result = await query(
    `INSERT INTO parent_child_linkages (parent_signet_pubkey, child_signet_pubkey, relationship, verified_by, club_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (parent_signet_pubkey, child_signet_pubkey) DO UPDATE SET
       relationship = $3, verified_by = $4, verified_at = NOW()
     RETURNING *`,
    [parent_signet_pubkey, child_signet_pubkey, relationship, req.staff.staff_id, req.staff.club_id]
  );
  res.status(201).json(result.rows[0]);
});

router.get('/', verifyStaff, requireRole('safeguarding_officer'), async (req, res) => {
  const result = await query(
    `SELECT l.*, s.display_name as verified_by_name
     FROM parent_child_linkages l JOIN staff s ON l.verified_by = s.staff_id
     WHERE l.club_id = $1 ORDER BY l.verified_at DESC`,
    [req.staff.club_id]
  );
  res.json(result.rows);
});

export default router;
