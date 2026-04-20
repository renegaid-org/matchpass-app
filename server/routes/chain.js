import { Router } from 'express';
import { isValidPubkey } from '../chain/types.js';
import { verifyChain, getCurrentStatus } from '../chain/verify.js';

const STATUS_NAMES = { 0: 'clean', 1: 'yellow', 2: 'red', 3: 'banned' };

/**
 * GET /api/gate/chain/:pubkey
 *
 * Fetches the fan's full chain from the relay (via fetchFanChain),
 * verifies linkage, and returns the ordered events plus computed
 * status. Used by the officer UI to inspect a fan's history and by
 * the PWA to reconcile after a 409 chain-tip mismatch.
 *
 * The fetcher is injected so the route can be tested without a live
 * relay (and so other endpoints can swap in a cached walker later).
 */
export default function createChainRouter({ fetchFanChain }) {
  const router = Router();

  router.get('/:pubkey', async (req, res) => {
    const { pubkey } = req.params;
    if (!isValidPubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    let events;
    try {
      events = await fetchFanChain(pubkey);
    } catch (err) {
      console.error('fetchFanChain failed:', err.message);
      return res.status(502).json({ error: 'Relay fetch failed' });
    }

    if (!events.length) {
      return res.status(404).json({ error: 'No chain events found for this pubkey' });
    }

    const verification = verifyChain(events);
    const summary = getCurrentStatus(events);

    return res.json({
      fanPubkey: pubkey,
      events: events.map(e => ({
        id: e.id,
        kind: e.kind,
        pubkey: e.pubkey,
        created_at: e.created_at,
        tags: e.tags,
      })),
      tip: verification.tip,
      length: verification.length,
      valid: verification.valid,
      errors: verification.errors,
      status: summary.status,
      statusName: STATUS_NAMES[summary.status] || summary.statusName,
      activeCards: summary.activeCards,
      activeSanctions: summary.activeSanctions,
    });
  });

  return router;
}
