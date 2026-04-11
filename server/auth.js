import { verifyEvent } from 'nostr-tools/pure';
import crypto from 'node:crypto';
import * as db from './db.js';

// NIP-98 replay prevention: track consumed event IDs (120s TTL)
const consumedEventIds = new Map();
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [id, ts] of consumedEventIds) {
    if (ts < cutoff) consumedEventIds.delete(id);
  }
}, 30_000);

const MAX_SESSIONS_PER_STAFF = 5;

/**
 * Create a new staff session.
 *
 * Generates a 32-byte random token, stores its SHA-256 hash in the sessions
 * table, purges any expired sessions, and returns the raw token + expiry.
 *
 * @param {object} staff  — { staff_id, club_id, role, display_name }
 * @param {object} database — injected db module (defaults to real db)
 * @returns {{ token: string, expires_at: string }}
 */
export async function createSession(staff, database = db) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours

  // Purge expired sessions before inserting
  await database.query('DELETE FROM sessions WHERE expires_at < now()');

  // Cap active sessions per staff member
  await database.query(
    `DELETE FROM sessions WHERE session_id IN (
       SELECT session_id FROM sessions
       WHERE staff_id = $1 AND expires_at > now()
       ORDER BY created_at DESC
       OFFSET $2
     )`,
    [staff.staff_id, MAX_SESSIONS_PER_STAFF - 1]
  );

  await database.query(
    `INSERT INTO sessions
       (token_hash, staff_id, club_id, role, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenHash, staff.staff_id, staff.club_id, staff.role, staff.display_name, expiresAt.toISOString()]
  );

  return { token, expires_at: expiresAt.toISOString() };
}

/**
 * Delete a session by raw token.
 *
 * @param {string} token   — raw (unhashed) session token
 * @param {object} database
 * @returns {boolean}
 */
export async function deleteSession(token, database = db) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await database.query(
    `DELETE FROM sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return result.rowCount > 0;
}

/**
 * Auth middleware — accepts either:
 *   Authorization: Bearer <session-token>
 *   Authorization: Nostr <base64-kind-27235-event>
 *
 * On success, attaches req.staff and calls next().
 */
export async function verifyStaff(req, res, next, database = db) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing auth header' });
  }

  // ── Bearer path ────────────────────────────────────────────────────────────
  if (authHeader.startsWith('Bearer ')) {
    return verifyBearer(req, res, next, database, authHeader.slice(7));
  }

  // ── NIP-98 path ────────────────────────────────────────────────────────────
  if (authHeader.startsWith('Nostr ')) {
    return verifyNostr(req, res, next, database, authHeader.slice(6));
  }

  return res.status(401).json({ error: 'Missing auth header' });
}

// ── internal: Bearer token verification ──────────────────────────────────────

async function verifyBearer(req, res, next, database, rawToken) {
  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await database.query(
      `SELECT staff_id, club_id, role, display_name, expires_at
       FROM sessions WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const session = result.rows[0];

    // Check expiry in application layer (belt-and-braces; DB purge is best-effort)
    if (new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    req.staff = {
      staff_id: session.staff_id,
      club_id: session.club_id,
      role: session.role,
      display_name: session.display_name,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
}

// ── internal: NIP-98 Nostr event verification ─────────────────────────────────

async function verifyNostr(req, res, next, database, encoded) {
  try {
    const event = JSON.parse(Buffer.from(encoded, 'base64').toString());

    if (!event || !event.pubkey || !event.sig || !event.kind) {
      return res.status(401).json({ error: 'Invalid auth event structure' });
    }

    if (event.kind !== 27235) {
      return res.status(401).json({ error: 'Auth event must be kind 27235' });
    }

    if (!verifyEvent(event)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) {
      return res.status(401).json({ error: 'Auth event expired' });
    }

    // Replay prevention: reject already-consumed event IDs
    if (event.id && consumedEventIds.has(event.id)) {
      return res.status(401).json({ error: 'Auth event already used' });
    }
    if (event.id) consumedEventIds.set(event.id, Date.now());

    const methodTag = event.tags?.find(t => t[0] === 'method')?.[1];
    if (!methodTag || methodTag.toUpperCase() !== req.method) {
      return res.status(401).json({ error: 'Method tag missing or mismatched' });
    }

    const urlTag = event.tags?.find(t => t[0] === 'u')?.[1];
    if (!urlTag) {
      return res.status(401).json({ error: 'URL tag missing' });
    }

    try {
      const eventUrl = new URL(urlTag);
      const expectedPath = req.originalUrl.split('?')[0];
      // Verify path matches
      if (eventUrl.pathname !== expectedPath) {
        return res.status(401).json({ error: 'URL tag mismatch' });
      }
      // Verify host matches when available (ignore in test/proxy scenarios without host header)
      const reqHost = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
      if (reqHost && eventUrl.host && eventUrl.host !== reqHost) {
        return res.status(401).json({ error: 'URL tag host mismatch' });
      }
      // H4: Scheme check — enforce HTTPS in production
      const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
      const isProduction = process.env.NODE_ENV === 'production' || allowedOrigin.startsWith('https');
      if (isProduction && eventUrl.protocol !== 'https:') {
        return res.status(401).json({ error: 'URL tag must use HTTPS in production' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid URL tag' });
    }

    const result = await database.query(
      `SELECT staff_id, club_id, role, display_name
       FROM staff WHERE signet_pubkey = $1 AND is_active = true`,
      [event.pubkey]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not a registered staff member' });
    }

    req.staff = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
}

/**
 * Role guard — returns middleware that checks req.staff.role.
 * Admin role always passes.
 */
/** Clear the consumed-event cache (test helper only). */
export function _resetReplayCache() { consumedEventIds.clear(); }

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.staff) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.staff.role) && req.staff.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}
