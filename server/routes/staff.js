import { Router } from 'express';

/**
 * GET /api/gate/staff
 *
 * Officer-accessible read-only view of the club's roster merged with today's
 * per-steward scan counts. Replaces the admin-only /api/gate/roster for the
 * officer dashboard's Stewards tab (§4.5.4).
 *
 * Scope: returns only the public fields of each roster entry
 * (pubkey, role, displayName, expiresAt). Not the full signed kind-31920
 * event — officers don't need to mutate the roster, only see who's on duty.
 *
 * Auth: mounting middleware enforces NIP-98 + requireRole('safety_officer',
 * 'safeguarding_officer', 'admin').
 */
export default function createStaffRouter({ rosterCache, scanTracker }) {
  const router = Router();

  router.get('/', (req, res) => {
    const clubPubkey = req.staff?.clubPubkey;
    if (!clubPubkey) return res.status(403).json({ error: 'No club pubkey on session' });

    const entry = rosterCache.get(clubPubkey);
    if (!entry) return res.json({ clubPubkey, staff: [], date: new Date().toISOString().slice(0, 10) });

    const now = Math.floor(Date.now() / 1000);
    const staff = entry.staff
      // Hide entries that have already expired — rosterCache.findStaff filters
      // at scan time too, so presenting them in the dashboard would be
      // misleading ("on duty" when the server already treats them as absent).
      .filter(s => !s.expiresAt || s.expiresAt > now)
      .map(s => {
        const scans = scanTracker.getStaffStats(s.pubkey);
        return {
          pubkey: s.pubkey,
          role: s.role,
          displayName: s.displayName || null,
          expiresAt: s.expiresAt ?? null,
          scans: { ...scans, total: scans.green + scans.amber + scans.red },
        };
      });

    return res.json({
      clubPubkey,
      staff,
      date: new Date().toISOString().slice(0, 10),
    });
  });

  return router;
}
