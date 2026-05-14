// server/routes/invites.js — Staff QR invite mint endpoint
// POST /api/gate/invites mints an invite record (via the in-memory invite
// cache) and returns a QR-ready Signet auth URL. The SSE subscription and
// /staff/accept routes are added in subsequent tasks; this file currently
// owns only the mint path.

import { Router } from 'express';
import { createHash } from 'crypto';
import { checkAuthority } from '../invite-cache.js';

const RELAY_URL = process.env.RELAY_URL || 'wss://relay.trotters.cc';

// Per-pubkey open-connection cap for invite SSE streams. Mirrors the cap in
// server/routes/subscribe.js — long-lived streams bypass the request-rate
// limiter, so an authenticated staff member could otherwise open unbounded
// subscriptions and exhaust server FDs / memory.
const MAX_CONNECTIONS_PER_PUBKEY = 3;
const openConnections = new Map(); // pubkey -> count

function hashTokenHex(token) {
  return createHash('sha256').update(token).digest('hex');
}

function buildQrPayload({ gateHost, inviteToken, sessionPubkey, authChallenge }) {
  const url = new URL('https://mysignet.app/');
  url.searchParams.set('auth', '1');
  url.searchParams.set('relay', RELAY_URL);
  url.searchParams.set('origin', gateHost);
  url.searchParams.set('name', 'MatchPass');
  url.searchParams.set('callback', `${gateHost}/api/gate/auth-result`);
  url.searchParams.set('challenge', authChallenge);
  url.searchParams.set('sessionPubkey', sessionPubkey);
  url.searchParams.set('t', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('accept', 'persona');
  url.searchParams.set('post', `${gateHost}/staff/accept?invite=${inviteToken}`);
  return url.toString();
}

export default function createInvitesRouter({ cache, onMint = () => {}, gateHost }) {
  const router = Router();

  router.post('/', (req, res) => {
    const { role, staff_expires_at, display_name } = req.body || {};
    if (!role) return res.status(400).json({ error: 'role required' });

    try {
      checkAuthority({
        inviterRole: req.staff.role,
        invitedRole: role,
        staffExpiresAt: staff_expires_at,
      });
    } catch (err) {
      const msg = err.message;
      const status =
        msg.includes('staffExpiresAt required') || msg.includes('within 24 hours') ? 400 : 403;
      return res.status(status).json({ error: msg });
    }

    const minted = cache.mint({
      clubPubkey: req.staff.clubPubkey,
      inviterPubkey: req.staff.pubkey,
      role,
      displayName: display_name,
      staffExpiresAt: staff_expires_at,
    });

    const qr_payload = buildQrPayload({
      gateHost,
      inviteToken: minted.invite_token,
      sessionPubkey: minted.session_pubkey,
      authChallenge: minted.auth_challenge,
    });

    // Defence-in-depth: belt-and-braces same-origin check on the `post` URL we
    // just baked into the QR. If gateHost is ever misconfigured (e.g. a typo,
    // protocol-relative slip, or attacker-injected header) we'd rather fail
    // the mint than hand the fan a QR that exfiltrates their auth flow.
    const postUrl = new URL(qr_payload).searchParams.get('post');
    if (!postUrl || new URL(postUrl).origin !== gateHost) {
      return res.status(500).json({ error: 'post URL same-origin invariant failed' });
    }

    onMint(minted.invite_token);

    return res.status(201).json({
      invite_token: minted.invite_token,
      qr_payload,
      pending_expires_at: minted.pending_expires_at,
    });
  });

  // GET /:token/subscribe — Server-Sent Events stream of lifecycle
  // transitions for a single invite (accepted / consumed / expired). The
  // staff manager's PWA opens this immediately after minting so the QR card
  // can flip from "Waiting…" to "Accepted" without polling.
  //
  // Auth + scoping: the mounting middleware has populated req.staff with the
  // caller's clubPubkey. We refuse cross-club subscriptions (a club staff
  // member trying to watch another club's invite) with 403, and reject
  // unknown tokens with 404 so a malicious caller can't probe for valid
  // invite tokens by status code.
  router.get('/:token/subscribe', (req, res) => {
    const { token } = req.params;
    const rec = cache.getByToken(token);
    if (!rec) return res.status(404).json({ error: 'invite not found' });
    if (rec.club_pubkey !== req.staff?.clubPubkey) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const pubkey = req.staff?.pubkey;
    const openCount = openConnections.get(pubkey) || 0;
    if (openCount >= MAX_CONNECTIONS_PER_PUBKEY) {
      return res.status(429).json({ error: 'Too many open subscriptions' });
    }
    openConnections.set(pubkey, openCount + 1);

    const tokenHash = hashTokenHex(token);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Initial comment flushes through proxies right away.
    res.write(': connected\n\n');

    const send = (eventTokenHash, payload) => {
      // Per-token fanout: the cache emits to all listeners, the route layer
      // filters by hash before writing.
      if (eventTokenHash !== tokenHash) return;
      res.write(`event: invite\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const unsubscribe = cache.onEvent(send);

    // Heartbeat every 25 s keeps the connection alive through proxies that
    // idle-close at 30–60 s (Cloudflare, Caddy default timeouts).
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
