import { Router } from 'express';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, isValidPubkey, isValidCardType, isValidCategory, isValidSanctionType, isValidReviewOutcome } from '../chain/types.js';
import { verifySignerAuthority } from '../chain/verify.js';
import { publishEvent } from '../relay.js';

const ALLOWED_KINDS = new Set(Object.values(EVENT_KINDS));

// Per-fan lock — prevents concurrent submissions racing on the same chain tip
const fanLocks = new Map(); // fanPubkey -> Promise

async function withFanLock(fanPubkey, fn) {
  while (fanLocks.has(fanPubkey)) {
    await fanLocks.get(fanPubkey);
  }
  const promise = fn();
  fanLocks.set(fanPubkey, promise);
  try {
    return await promise;
  } finally {
    fanLocks.delete(fanPubkey);
  }
}

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

    // Validate created_at
    const now = Math.floor(Date.now() / 1000);
    if (event.created_at > now + 120) {
      return res.status(400).json({ error: 'Event timestamp too far in the future' });
    }
    if (event.created_at < now - 86400) {
      return res.status(400).json({ error: 'Event timestamp too old (>24h)' });
    }

    if (!ALLOWED_KINDS.has(event.kind)) {
      return res.status(400).json({ error: `Event kind ${event.kind} not allowed` });
    }

    const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
    if (!pTag || !isValidPubkey(pTag[1])) {
      return res.status(400).json({ error: 'Missing or invalid p tag' });
    }
    const fanPubkey = pTag[1];

    return withFanLock(fanPubkey, async () => {
      if (event.kind === EVENT_KINDS.MEMBERSHIP) {
        // Membership must be self-signed by the fan
        if (event.pubkey !== fanPubkey) {
          return res.status(400).json({ error: 'Membership event must be signed by the fan (pubkey mismatch)' });
        }
        // Prevent duplicate membership (chain reset attack)
        if (chainTipCache.has(fanPubkey)) {
          return res.status(409).json({ error: 'Fan already has a chain — cannot resubmit membership' });
        }
      }

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
            error: 'chain_tip_mismatch',
            currentTip: tip.tipEventId,
            // PWA re-fetches /api/gate/chain/:pubkey to see intervening
            // events and re-signs with the current tip.
          });
        }
      }

      // Tag content validation per kind
      const getTag = (name) => event.tags?.find(t => Array.isArray(t) && t[0] === name)?.[1];

      if (event.kind === EVENT_KINDS.CARD) {
        const cardType = getTag('card_type');
        const category = getTag('category');
        if (!isValidCardType(cardType)) return res.status(400).json({ error: 'Invalid card_type tag' });
        if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category tag' });
      }

      if (event.kind === EVENT_KINDS.SANCTION) {
        const sanctionType = getTag('sanction_type');
        if (!isValidSanctionType(sanctionType)) return res.status(400).json({ error: 'Invalid sanction_type tag' });
        const startDate = getTag('start_date');
        if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
          return res.status(400).json({ error: 'Invalid start_date tag' });
        }
      }

      if (event.kind === EVENT_KINDS.REVIEW_OUTCOME) {
        const outcome = getTag('outcome');
        const reviews = getTag('reviews');
        if (!isValidReviewOutcome(outcome)) return res.status(400).json({ error: 'Invalid outcome tag' });
        if (!reviews || !/^[0-9a-f]{64}$/.test(reviews)) return res.status(400).json({ error: 'Invalid reviews tag' });
      }

      // Publish to relay
      try {
        await publishEvent(event);
      } catch (err) {
        console.error('Relay publish failed:', err.message);
        return res.status(502).json({ error: 'Relay publish failed' });
      }

      // Update cache — derive status from the event kind
      let status = 0; // clean
      if (event.kind === EVENT_KINDS.CARD) {
        const cardType = event.tags?.find(t => t[0] === 'card_type')?.[1];
        if (cardType === 'red') status = 2;
        else if (cardType === 'yellow') status = 1;
      } else if (event.kind === EVENT_KINDS.SANCTION) {
        const sanctionType = event.tags?.find(t => t[0] === 'sanction_type')?.[1];
        if (sanctionType === 'ban') status = 3;
        else status = 2; // suspension
      } else if (event.kind === EVENT_KINDS.REVIEW_OUTCOME) {
        // Dismissal/downgrade lowers status. Accurate status comes from next relay sync.
        const outcome = event.tags?.find(t => t[0] === 'outcome')?.[1];
        if (outcome === 'dismissed') status = 0;
        else status = 1; // downgraded = yellow at most
      } else if ([EVENT_KINDS.MEMBERSHIP, EVENT_KINDS.GATE_LOCK, EVENT_KINDS.ATTENDANCE].includes(event.kind)) {
        // Non-status-changing events: preserve any existing status
        status = chainTipCache.get(fanPubkey)?.status ?? 0;
      }
      chainTipCache.set(fanPubkey, { tipEventId: event.id, status, createdAt: event.created_at });

      return res.status(201).json({ ok: true, eventId: event.id, fanPubkey });
    });
  });

  return router;
}
