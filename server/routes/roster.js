import { Router } from 'express';
import { verifyEvent } from 'nostr-tools/pure';
import { STAFF_ROSTER_KIND } from '../chain/types.js';
import { parseRosterEvent, VALID_STAFF_ROLES } from '../roster.js';

/**
 * GET  /api/gate/roster          — returns the authenticated admin's
 *                                   current roster event (or 404 if
 *                                   the cache has no copy yet).
 * POST /api/gate/roster          — admin submits a new signed kind
 *                                   31920 event. Server verifies the
 *                                   signer matches the admin's club
 *                                   pubkey, validates the roster, and
 *                                   publishes to the relay.
 *
 * Auth: mounting middleware enforces NIP-98 and requireRole('admin').
 */
export default function createRosterRouter({ rosterCache, publishEvent }) {
  const router = Router();

  router.get('/', (req, res) => {
    const clubPubkey = req.staff?.clubPubkey;
    if (!clubPubkey) return res.status(403).json({ error: 'No club pubkey on session' });
    const entry = rosterCache.get(clubPubkey);
    if (!entry) return res.status(404).json({ error: 'No roster cached for your club' });
    return res.json({
      clubPubkey,
      rosterEvent: entry.rosterEvent,
      staff: entry.staff,
    });
  });

  router.post('/', async (req, res) => {
    const clubPubkey = req.staff?.clubPubkey;
    if (!clubPubkey) return res.status(403).json({ error: 'No club pubkey on session' });

    const { event } = req.body || {};
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ error: 'event required' });
    }
    if (event.kind !== STAFF_ROSTER_KIND) {
      return res.status(400).json({ error: `Event kind must be ${STAFF_ROSTER_KIND}` });
    }
    if (event.pubkey !== clubPubkey) {
      return res.status(403).json({
        error: 'Roster must be signed by the club pubkey (matching the admin session)',
      });
    }
    if (!verifyEvent(event)) {
      return res.status(400).json({ error: 'Invalid event signature' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (event.created_at > now + 120) {
      return res.status(400).json({ error: 'Event timestamp too far in the future' });
    }
    if (event.created_at < now - 86400) {
      return res.status(400).json({ error: 'Event timestamp too old (>24h)' });
    }

    let staff;
    try {
      staff = parseRosterEvent(event);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (staff.length === 0) {
      return res.status(400).json({ error: 'Roster must contain at least one staff member' });
    }

    // Admin's own pubkey must remain with admin role — prevents admin
    // lockout from a typo. The requesting admin's pubkey is req.staff.pubkey.
    const self = staff.find(s => s.pubkey === req.staff.pubkey);
    if (!self || self.role !== 'admin') {
      return res.status(400).json({
        error: 'Your own pubkey must remain in the roster with role "admin"',
      });
    }

    try {
      await publishEvent(event);
    } catch (err) {
      console.error('Relay publish failed:', err.message);
      return res.status(502).json({ error: 'Relay publish failed' });
    }

    rosterCache.set(clubPubkey, event);
    return res.status(201).json({ ok: true, eventId: event.id, staff });
  });

  return router;
}

export { VALID_STAFF_ROLES };
