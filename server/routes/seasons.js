import { Router } from 'express';
import { query } from '../db.js';
import pool from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidDateString } from '../validation.js';

const router = Router();

router.get('/', verifyStaff, async (req, res) => {
  const result = await query(
    'SELECT * FROM seasons WHERE club_id = $1 ORDER BY start_date DESC',
    [req.staff.club_id]
  );
  res.json(result.rows);
});

router.get('/active', verifyStaff, async (req, res) => {
  const result = await query(
    'SELECT * FROM seasons WHERE club_id = $1 AND is_active = true',
    [req.staff.club_id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'No active season' });
  }
  res.json(result.rows[0]);
});

router.post('/', verifyStaff, requireRole('admin'), async (req, res) => {
  const { name, start_date, end_date } = req.body;
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'name, start_date, and end_date required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'name max 100 characters' });
  }
  if (!isValidDateString(start_date)) {
    return res.status(400).json({ error: 'start_date must be a valid date in YYYY-MM-DD format' });
  }
  if (!isValidDateString(end_date)) {
    return res.status(400).json({ error: 'end_date must be a valid date in YYYY-MM-DD format' });
  }
  if (new Date(end_date) <= new Date(start_date)) {
    return res.status(400).json({ error: 'end_date must be after start_date' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE seasons SET is_active = false WHERE club_id = $1', [req.staff.club_id]);
    const result = await client.query(
      `INSERT INTO seasons (club_id, name, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [req.staff.club_id, name, start_date, end_date]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
