import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidPubkey, isValidText, isValidOptionalText } from '../validation.js';
import { subscribeToNetwork } from '../nostr.js';

const router = Router();

router.get('/mine', verifyStaff, async (req, res) => {
  const result = await query('SELECT * FROM clubs WHERE club_id = $1', [req.staff.club_id]);
  res.json(result.rows[0]);
});

router.put('/mine', verifyStaff, requireRole('admin'), async (req, res) => {
  const { name, fa_affiliation, ground_name, league } = req.body;
  if (name && !isValidText(name, 200)) return res.status(400).json({ error: 'name max 200 characters' });
  if (!isValidOptionalText(fa_affiliation, 200)) return res.status(400).json({ error: 'fa_affiliation max 200 characters' });
  if (!isValidOptionalText(ground_name, 200)) return res.status(400).json({ error: 'ground_name max 200 characters' });
  if (!isValidOptionalText(league, 200)) return res.status(400).json({ error: 'league max 200 characters' });
  const result = await query(
    `UPDATE clubs SET name = $1, fa_affiliation = $2, ground_name = $3, league = $4
     WHERE club_id = $5 RETURNING *`,
    [name, fa_affiliation, ground_name, league, req.staff.club_id]
  );
  res.json(result.rows[0]);
});

// POST /api/clubs — create a new club (requires bootstrap token for pilot)
router.post('/', async (req, res) => {
  const bootstrapToken = process.env.BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    return res.status(403).json({ error: 'Bootstrap not configured' });
  }
  const provided = req.headers['x-bootstrap-token'] || '';
  try {
    const a = Buffer.from(bootstrapToken, 'utf-8');
    const b = Buffer.from(provided, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid bootstrap token' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid bootstrap token' });
  }
  const { name, fa_affiliation, ground_name, league, nostr_pubkey } = req.body;
  if (!name || !nostr_pubkey) {
    return res.status(400).json({ error: 'name and nostr_pubkey required' });
  }
  if (!isValidText(name, 200)) return res.status(400).json({ error: 'name max 200 characters' });
  if (!isValidOptionalText(fa_affiliation, 200)) return res.status(400).json({ error: 'fa_affiliation max 200 characters' });
  if (!isValidOptionalText(ground_name, 200)) return res.status(400).json({ error: 'ground_name max 200 characters' });
  if (!isValidOptionalText(league, 200)) return res.status(400).json({ error: 'league max 200 characters' });
  if (!isValidPubkey(nostr_pubkey)) {
    return res.status(400).json({ error: 'Invalid nostr_pubkey format' });
  }
  const result = await query(
    `INSERT INTO clubs (name, fa_affiliation, ground_name, league, nostr_pubkey)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, fa_affiliation, ground_name, league, nostr_pubkey]
  );

  // Refresh Nostr subscription to include new club
  subscribeToNetwork().catch(err => console.error('Failed to refresh Nostr subscription:', err));

  res.status(201).json(result.rows[0]);
});

export default router;
