import { verifyEvent } from 'nostr-tools/pure';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Replay prevention: consumed event IDs. The cache key timestamp is the event's
// own created_at * 1000 (ms) — not the wall-clock time of first use — so cache
// TTL matches the auth window instead of extending replay opportunities past it.
const consumedEventIds = new Map();
const MAX_CONSUMED = 100_000;
const AUTH_WINDOW_SECONDS = 60;
setInterval(() => {
  const cutoff = Date.now() - AUTH_WINDOW_SECONDS * 1000;
  for (const [id, ts] of consumedEventIds) {
    if (ts < cutoff) consumedEventIds.delete(id);
  }
}, 10_000);

export function _resetReplayCache() {
  consumedEventIds.clear();
}

// Optional allowlist for the URL tag host — primes from env at boot. If unset,
// falls back to comparing against the inbound Host header (less strict).
const ALLOWED_HOST = (() => {
  const allowed = process.env.ALLOWED_HOST || process.env.ALLOWED_ORIGIN;
  if (!allowed) return null;
  try { return new URL(allowed).host; } catch { return null; }
})();

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

      // Cheap structural checks first — signature verification (schnorr) is the
      // single most expensive op on this path, so we validate everything else
      // first to avoid amplifying CPU DoS via unauthenticated requests.
      if (!event || typeof event !== 'object' || event.kind !== 27235) {
        return res.status(401).json({ error: 'Auth event must be kind 27235' });
      }
      if (!event.id || !/^[0-9a-f]{64}$/.test(event.id)) {
        return res.status(401).json({ error: 'Invalid auth event ID' });
      }
      if (!event.pubkey || !/^[0-9a-f]{64}$/.test(event.pubkey)) {
        return res.status(401).json({ error: 'Invalid auth event pubkey' });
      }

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - event.created_at) > AUTH_WINDOW_SECONDS) {
        return res.status(401).json({ error: 'Auth event expired' });
      }

      const methodTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'method')?.[1];
      if (!methodTag || methodTag.toUpperCase() !== req.method) {
        return res.status(401).json({ error: 'Method tag mismatch' });
      }

      const urlTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'u')?.[1];
      if (!urlTag) {
        return res.status(401).json({ error: 'URL tag missing' });
      }
      let eventUrl;
      try {
        eventUrl = new URL(urlTag);
      } catch {
        return res.status(401).json({ error: 'Invalid URL tag' });
      }
      const expectedPath = req.originalUrl.split('?')[0];
      if (eventUrl.pathname !== expectedPath) {
        return res.status(401).json({ error: 'URL tag path mismatch' });
      }
      // Host match: prefer the configured ALLOWED_HOST (not attacker-controllable).
      // Falls back to the request Host header only when no allowlist is set.
      const expectedHost = ALLOWED_HOST || req.get?.('host') || req.headers?.host;
      if (expectedHost && eventUrl.host !== expectedHost) {
        return res.status(401).json({ error: 'URL tag host mismatch' });
      }

      // Replay check (pre-verify) — if we've already consumed this id, short-circuit
      // without burning a schnorr verification.
      if (consumedEventIds.has(event.id)) {
        return res.status(401).json({ error: 'Auth event already used' });
      }

      // Signature last: only spend CPU if every cheap check has passed.
      if (!verifyEvent(event)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Record this id in the replay cache. Keyed by event.created_at (ms) so
      // the sweep evicts on the auth window, not on first-use wall time.
      // On overflow, evict the oldest entry rather than globally rejecting auth.
      consumedEventIds.set(event.id, event.created_at * 1000);
      if (consumedEventIds.size > MAX_CONSUMED) {
        const oldest = consumedEventIds.keys().next().value;
        consumedEventIds.delete(oldest);
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

// ---------------------------------------------------------------------------
// Short-lived path-scoped subscription cookie.
//
// Browsers' native EventSource can't send Authorization headers, so the SSE
// route at GET /api/gate/invites/:token/subscribe accepts EITHER a NIP-98
// header (server-to-server / fetch callers) OR a per-token HMAC-signed cookie
// minted at POST-time.
//
// Cookie shape:
//   Name : mp_invite_sub_<first8 of sha256(token)>
//   Value: <iat>.<hmac_hex>   where hmac = HMAC-SHA256(secret, `${token}.${iat}`)
//   Path : /api/gate/invites/<token>/subscribe   (browser only ever sends it
//          back to the exact SSE endpoint, so possession of the cookie is
//          itself authorisation for that single subscription).
//   Flags: HttpOnly; Secure; Max-Age=900; SameSite=Strict
//
// The secret is sourced from INVITE_SUBSCRIBE_SECRET; if unset we generate a
// random 32-byte hex at process start. Restarts therefore invalidate all
// in-flight subscribe cookies, which is consistent with matchpass-gate's
// stateless / "rebuild from the chain" model.
const COOKIE_NAME_PREFIX = 'mp_invite_sub_';
const COOKIE_MAX_AGE_SECONDS = 900;

let _subscribeSecret =
  process.env.INVITE_SUBSCRIBE_SECRET || randomBytes(32).toString('hex');

export function setSubscribeSecretForTest(secret) {
  _subscribeSecret = secret;
}

export function getSubscribeSecret() {
  return _subscribeSecret;
}

function cookieNameForToken(token) {
  return COOKIE_NAME_PREFIX + createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function hmacForToken(token, iat) {
  return createHmac('sha256', _subscribeSecret).update(`${token}.${iat}`).digest('hex');
}

/**
 * Build the Set-Cookie header value for a freshly minted invite token.
 * Returns the full header string suitable for `res.setHeader('Set-Cookie', ...)`.
 */
export function buildSubscribeCookieHeader(token) {
  const iat = Math.floor(Date.now() / 1000);
  const mac = hmacForToken(token, iat);
  const name = cookieNameForToken(token);
  const value = `${iat}.${mac}`;
  const path = `/api/gate/invites/${encodeURIComponent(token)}/subscribe`;
  return (
    `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Strict; ` +
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  );
}

/**
 * Parse a raw Cookie header into a flat name->value map. Tolerates stray
 * whitespace and missing values; never throws.
 */
function parseCookieHeader(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/**
 * Verify that the Cookie header carries a valid, in-window subscribe cookie
 * for the given invite token. Constant-time HMAC comparison; returns true on
 * success, false on any failure (missing cookie, malformed value, expired,
 * tampered MAC).
 */
export function verifySubscribeCookie(token, cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  const name = cookieNameForToken(token);
  const value = cookies[name];
  if (!value) return false;

  const dot = value.indexOf('.');
  if (dot === -1) return false;
  const iatStr = value.slice(0, dot);
  const macHex = value.slice(dot + 1);
  const iat = Number(iatStr);
  if (!Number.isFinite(iat) || iat <= 0) return false;
  if (!/^[0-9a-f]+$/.test(macHex)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - iat > COOKIE_MAX_AGE_SECONDS) return false;
  // Allow up to 60 s of negative skew (clock drift) but no further-future iat.
  if (iat - now > 60) return false;

  const expected = hmacForToken(token, iat);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(macHex, 'hex');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
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
