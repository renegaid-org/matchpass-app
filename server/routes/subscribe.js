import { Router } from 'express';

/**
 * GET /api/gate/subscribe
 *
 * Server-Sent Events stream of chain + review-request events relevant
 * to the authenticated steward. Clients open this to keep caches
 * warm (review list, chain tips for fans they've scanned) without
 * polling.
 *
 * Auth is handled by the mounting middleware (NIP-98). The steward's
 * pubkey is available at req.staff.pubkey.
 */
export default function createSubscribeRouter({ subscribeToLiveEvents }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Initial comment lets proxies flush headers right away.
    res.write(': connected\n\n');

    const send = (event) => {
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
      res.end();
    });
  });

  return router;
}
