import { Router } from 'express';
import { REVIEW_REQUEST_KIND } from '../chain/types.js';

// Per-pubkey open-connection cap. SSE streams are long-lived and bypass the
// request-rate limiter once the initial GET is through, so an authenticated
// client can otherwise open unbounded streams and exhaust server FDs / memory.
const MAX_CONNECTIONS_PER_PUBKEY = 3;
const openConnections = new Map(); // pubkey -> count

/**
 * GET /api/gate/subscribe
 *
 * Server-Sent Events stream of chain + review-request events relevant
 * to the authenticated steward. Clients open this to keep caches
 * warm (review list, chain tips for fans they've scanned) without
 * polling.
 *
 * Auth is handled by the mounting middleware (NIP-98). The steward's
 * pubkey is available at req.staff.pubkey and their club at req.staff.clubPubkey.
 * Review-request events are filtered to the steward's own club to avoid
 * cross-club officer-workload leakage.
 */
export default function createSubscribeRouter({ subscribeToLiveEvents }) {
  const router = Router();

  router.get('/', (req, res) => {
    const pubkey = req.staff?.pubkey;
    const clubPubkey = req.staff?.clubPubkey;
    const openCount = openConnections.get(pubkey) || 0;
    if (openCount >= MAX_CONNECTIONS_PER_PUBKEY) {
      return res.status(429).json({ error: 'Too many open subscriptions' });
    }
    openConnections.set(pubkey, openCount + 1);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Initial comment lets proxies flush headers right away.
    res.write(': connected\n\n');

    const send = (event) => {
      // Review requests are scoped to a single club — filter out any whose
      // `club` tag does not match the subscribed steward's club.
      if (event.kind === REVIEW_REQUEST_KIND) {
        const eventClub = event.tags?.find(t => Array.isArray(t) && t[0] === 'club')?.[1];
        if (clubPubkey && eventClub && eventClub !== clubPubkey) return;
      }
      const payload = {
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags,
      };
      res.write(`event: chain\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const unsubscribe = subscribeToLiveEvents(send);

    // Heartbeat every 25s keeps the connection alive through proxies
    // that idle-close at 30–60s (Cloudflare, Caddy default timeouts).
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      const remaining = (openConnections.get(pubkey) || 1) - 1;
      if (remaining <= 0) openConnections.delete(pubkey);
      else openConnections.set(pubkey, remaining);
      res.end();
    });
  });

  return router;
}
