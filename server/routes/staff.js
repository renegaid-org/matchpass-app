import { Router } from 'express';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidPubkey, isValidOptionalText, isValidUUID } from '../validation.js';

const router = Router();

router.get('/', verifyStaff, requireRole('admin', 'safety_officer'), async (req, res) => {
  const result = await query(
    'SELECT staff_id, display_name, role, is_active, created_at FROM staff WHERE club_id = $1',
    [req.staff.club_id]
  );
  res.json(result.rows);
});

router.post('/', verifyStaff, requireRole('admin', 'safeguarding_officer'), async (req, res) => {
  const { signet_pubkey, display_name, role } = req.body;
  const validRoles = ['gate_steward', 'roaming_steward', 'safety_officer', 'safeguarding_officer', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }
  // Only admins can create other admins
  if (role === 'admin' && req.staff.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can create admin staff' });
  }
  if (!signet_pubkey || !isValidPubkey(signet_pubkey)) {
    return res.status(400).json({ error: 'Invalid Signet pubkey format' });
  }
  if (!isValidOptionalText(display_name, 100)) {
    return res.status(400).json({ error: 'display_name max 100 characters' });
  }
  const result = await query(
    `INSERT INTO staff (club_id, signet_pubkey, display_name, role)
     VALUES ($1, $2, $3, $4) RETURNING staff_id, display_name, role, is_active`,
    [req.staff.club_id, signet_pubkey, display_name, role]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/:id', verifyStaff, requireRole('admin', 'safeguarding_officer'), async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid staff ID' });
  await query(
    'UPDATE staff SET is_active = false WHERE staff_id = $1 AND club_id = $2',
    [req.params.id, req.staff.club_id]
  );
  res.status(204).end();
});

export default router;
