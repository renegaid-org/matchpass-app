import { Router } from 'express';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, isValidPubkey } from '../chain/types.js';
import { verifySignerAuthority } from '../chain/verify.js';
import { publishEvent } from '../relay.js';

const ALLOWED_KINDS = new Set(Object.values(EVENT_KINDS));

export default function createEventRouter({ chainTipCache, rosterCache }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { event } = req.body;
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ error: 'event required' });
    }

    if (!verifyEvent(event)) {
      return res.status(400).json({ error: 'Invalid event signature' });
    }

    if (!ALLOWED_KINDS.has(event.kind)) {
      return res.status(400).json({ error: `Event kind ${event.kind} not allowed` });
    }

    const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
    if (!pTag || !isValidPubkey(pTag[1])) {
      return res.status(400).json({ error: 'Missing or invalid p tag' });
    }
    const fanPubkey = pTag[1];

    // Signer authority (skip for membership — signed by fan)
    if (event.kind !== EVENT_KINDS.MEMBERSHIP) {
      const roster = rosterCache.get(req.staff?.clubPubkey);
      if (!roster) {
        return res.status(400).json({ error: 'No roster found for your club' });
      }
      const authCheck = verifySignerAuthority(event, roster.rosterEvent);
      if (!authCheck.authorised) {
        return res.status(403).json({ error: authCheck.reason });
      }
    }

    // Chain linkage (skip for membership — first event)
    if (event.kind !== EVENT_KINDS.MEMBERSHIP) {
      const previousTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'previous');
      if (!previousTag || !previousTag[1]) {
        return res.status(400).json({ error: 'Missing previous tag' });
      }
      const tip = chainTipCache.get(fanPubkey);
      if (tip && tip.tipEventId !== previousTag[1]) {
        return res.status(409).json({
          error: 'Chain tip mismatch', currentTip: tip.tipEventId,
        });
      }
    }

    // Publish to relay
    try {
      await publishEvent(event);
    } catch (err) {
      return res.status(502).json({ error: `Relay publish failed: ${err.message}` });
    }

    // Update cache
    chainTipCache.set(fanPubkey, { tipEventId: event.id, status: 0 });

    return res.status(201).json({ ok: true, eventId: event.id, fanPubkey });
  });

  return router;
}
