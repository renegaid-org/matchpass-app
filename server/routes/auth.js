import { Router } from 'express';
import { verifyStaff, createSession, deleteSession } from '../auth.js';
import * as db from '../db.js';

const router = Router();

export async function handleLogin(req, res, database = db) {
  try {
    const session = await createSession(req.staff, database);
    res.json({
      token: session.token,
      staff: {
        staff_id: req.staff.staff_id,
        club_id: req.staff.club_id,
        role: req.staff.role,
        display_name: req.staff.display_name,
      },
      expires_at: session.expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create session' });
  }
}

export async function handleLogout(req, res, database = db) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    await deleteSession(token, database);
    res.status(204).end();
  } catch (err) {
    res.status(204).end();
  }
}

router.post('/login', (req, res, next) => verifyStaff(req, res, next), (req, res) => handleLogin(req, res));
router.delete('/logout', (req, res) => handleLogout(req, res));

export default router;
