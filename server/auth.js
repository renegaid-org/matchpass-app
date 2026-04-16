import { verifyEvent } from 'nostr-tools/pure';

// Replay prevention: consumed event IDs with 120s TTL
const consumedEventIds = new Map();
const MAX_CONSUMED = 10_000;
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [id, ts] of consumedEventIds) {
    if (ts < cutoff) consumedEventIds.delete(id);
  }
}, 30_000);

export function _resetReplayCache() {
  consumedEventIds.clear();
}

/**
 * Returns Express middleware that verifies NIP-98 auth against the roster cache.
 * On success, attaches req.staff = { pubkey, role, displayName, clubPubkey }.
 */
export function verifyNip98(rosterCache) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Nostr ')) {
      return res.status(401).json({ error: 'Missing or invalid auth header' });
    }

    try {
      const encoded = authHeader.slice(6);
      const event = JSON.parse(Buffer.from(encoded, 'base64').toString());

      if (!event || event.kind !== 27235) {
        return res.status(401).json({ error: 'Auth event must be kind 27235' });
      }

      if (!verifyEvent(event)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - event.created_at) > 60) {
        return res.status(401).json({ error: 'Auth event expired' });
      }

      if (event.id && consumedEventIds.has(event.id)) {
        return res.status(401).json({ error: 'Auth event already used' });
      }
      if (consumedEventIds.size >= MAX_CONSUMED) {
        return res.status(429).json({ error: 'Too many auth requests' });
      }
      if (event.id) consumedEventIds.set(event.id, Date.now());

      const methodTag = event.tags?.find(t => t[0] === 'method')?.[1];
      if (!methodTag || methodTag.toUpperCase() !== req.method) {
        return res.status(401).json({ error: 'Method tag mismatch' });
      }

      const urlTag = event.tags?.find(t => t[0] === 'u')?.[1];
      if (!urlTag) {
        return res.status(401).json({ error: 'URL tag missing' });
      }
      try {
        const eventUrl = new URL(urlTag);
        const expectedPath = req.originalUrl.split('?')[0];
        if (eventUrl.pathname !== expectedPath) {
          return res.status(401).json({ error: 'URL tag path mismatch' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid URL tag' });
      }

      // Staff lookup from roster cache (NOT database)
      const staff = rosterCache.findStaff(event.pubkey);
      if (!staff) {
        return res.status(403).json({ error: 'Not a registered staff member' });
      }

      req.staff = staff;
      next();
    } catch {
      return res.status(401).json({ error: 'Auth verification failed' });
    }
  };
}

/**
 * Role guard — returns middleware that checks req.staff.role.
 * Admin role always passes.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.staff.role) && req.staff.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}
