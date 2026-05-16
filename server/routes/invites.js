// server/routes/invites.js — Staff QR invite mint endpoint + accept page.
//
// Exposes two Express Routers:
//   apiRouter    — POST /  and GET /:token/subscribe
//                  (mounted at /api/gate/invites behind NIP-98 auth)
//   acceptRouter — GET /staff/accept
//                  (mounted at root, publicly reachable — this is the
//                  redirect target after a Signet auth in the QR flow,
//                  and the fan/steward arriving here is not yet a known
//                  staff member from the gate's perspective).

import { Router } from 'express';
import { createHash } from 'crypto';
import { checkAuthority } from '../invite-cache.js';
import { buildSubscribeCookieHeader, verifySubscribeCookie } from '../auth.js';

const RELAY_URL = process.env.RELAY_URL || 'wss://relay.trotters.cc';

// Per-pubkey open-connection cap for invite SSE streams. Mirrors the cap in
// server/routes/subscribe.js — long-lived streams bypass the request-rate
// limiter, so an authenticated staff member could otherwise open unbounded
// subscriptions and exhaust server FDs / memory.
//
// The counter map lives inside the router factory closure (NOT at module
// scope) so that each createInvitesRouter() call gets its own counter.
// That keeps per-test app instances isolated from each other in vitest's
// jsdom worker, and removes a module-level mutable singleton.
const MAX_CONNECTIONS_PER_PUBKEY = 3;

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

export default function createInvitesRouter({
  cache,
  onMint = () => {},
  gateHost,
  // Optional NIP-98 middleware. When provided, Task 11's wiring layer passes
  // it in and we apply it directly to the routes that need it (POST mint, and
  // SSE when no valid cookie is present). When omitted (tests / current
  // pre-wiring state) we assume some upstream middleware has already
  // populated req.staff — that's the previous contract and we preserve it.
  verifyNip98Middleware = null,
} = {}) {
  const apiRouter = Router();
  const acceptRouter = Router();

  // Per-router-instance SSE connection counter. Lives in this closure so
  // separate router instances (e.g. two test apps in the same worker)
  // don't share state. See the comment near MAX_CONNECTIONS_PER_PUBKEY.
  const openConnections = new Map(); // connKey -> count

  // POST / always requires NIP-98 — there's no cookie path for minting.
  const nip98 = verifyNip98Middleware || ((_req, _res, next) => next());

  // GET /accepted — Snapshot of accepted-but-not-yet-consumed invites for the
  // requester's club. Used by the PWA's PendingAcceptancesPanel to show a
  // queue of personas waiting to be added to the roster. NIP-98 authenticated
  // (admin / staff_manager only — these are the roles that can act on the
  // queue by publishing a new roster). The handler filters strictly by the
  // requester's clubPubkey so an admin from club A cannot see club B's queue.
  apiRouter.get('/accepted', nip98, (req, res) => {
    const role = req.staff?.role;
    if (role !== 'admin' && role !== 'staff_manager') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const clubPubkey = req.staff.clubPubkey;
    const accepted = cache.acceptedInvitesForClub(clubPubkey);
    const invites = accepted
      .map(({ token_hash }) => cache.detailByTokenHash(token_hash))
      .filter((d) => d && d.club_pubkey === clubPubkey);
    return res.json({ invites });
  });

  // DELETE /:token — Admin-initiated invite cancel. Removes the cache entry
  // immediately, regardless of phase (pending or accepted). Strictly scoped:
  // 404 (not 403) for unknown tokens prevents probing, but a real token owned
  // by a different club returns 403. Returns 204 with no body on success.
  apiRouter.delete('/:token', nip98, (req, res) => {
    const { token } = req.params;
    const rec = cache.getByToken(token);
    if (!rec) return res.status(404).json({ error: 'invite not found' });
    if (rec.club_pubkey !== req.staff?.clubPubkey) {
      return res.status(403).json({ error: 'forbidden' });
    }
    cache.cancel(token);
    return res.status(204).end();
  });

  apiRouter.post('/', nip98, (req, res) => {
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

    // Short-lived path-scoped subscribe cookie so the client's native
    // EventSource (which can't send Authorization headers) can authenticate to
    // the per-token SSE endpoint. Cookie is bound to the exact subscribe path
    // for this token, so it cannot leak to any other endpoint.
    res.setHeader('Set-Cookie', buildSubscribeCookieHeader(minted.invite_token));

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
  // Auth + scoping: this route accepts EITHER
  //   (a) the short-lived path-scoped subscribe cookie that POST / minted, OR
  //   (b) a NIP-98 Authorization header (server-to-server / fetch callers).
  // Browsers' native EventSource can't send Authorization, so the cookie path
  // is the primary auth route from the PWA. The cookie is path-scoped to this
  // exact /:token/subscribe URL and carries an HMAC over the token, so
  // possession of a valid cookie is itself authorisation for this single
  // subscription — we skip the cross-club ownership check in that case
  // (the cookie was only ever issued to the rightful staff member at mint).
  // For NIP-98 we keep the existing club-ownership check.
  //
  // 404 (not 403) for unknown tokens prevents a malicious caller from
  // probing for valid invite tokens by status code.
  const cookieOrNip98 = (req, res, next) => {
    if (verifySubscribeCookie(req.params.token, req.headers.cookie)) {
      req._inviteAuthVia = 'cookie';
      return next();
    }
    if (verifyNip98Middleware) {
      return verifyNip98Middleware(req, res, (err) => {
        if (err) return next(err);
        req._inviteAuthVia = 'nip98';
        next();
      });
    }
    // No NIP-98 middleware wired in — fall through assuming an upstream
    // middleware already populated req.staff (preserves prior test contract).
    req._inviteAuthVia = req.staff ? 'nip98' : 'none';
    next();
  };

  apiRouter.get('/:token/subscribe', cookieOrNip98, (req, res) => {
    const { token } = req.params;
    const rec = cache.getByToken(token);
    if (!rec) return res.status(404).json({ error: 'invite not found' });

    // Cross-club ownership check only applies when auth was via NIP-98 (we
    // know the caller's clubPubkey). Cookie auth is already path-scoped to
    // this exact token, so the cookie itself proves authorisation.
    if (req._inviteAuthVia !== 'cookie') {
      if (rec.club_pubkey !== req.staff?.clubPubkey) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    // Per-connection cap: for NIP-98 we key on the staff pubkey (mirrors the
    // existing rate-limit story); for cookie auth we key on the token hash
    // since one cookie is bound to exactly one token. Either way, no single
    // caller can hold more than MAX_CONNECTIONS_PER_PUBKEY streams open.
    const connKey =
      req._inviteAuthVia === 'cookie'
        ? `cookie:${hashTokenHex(token).slice(0, 16)}`
        : req.staff?.pubkey;
    const openCount = openConnections.get(connKey) || 0;
    if (openCount >= MAX_CONNECTIONS_PER_PUBKEY) {
      return res.status(429).json({ error: 'Too many open subscriptions' });
    }
    openConnections.set(connKey, openCount + 1);

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
      const remaining = (openConnections.get(connKey) || 1) - 1;
      if (remaining <= 0) openConnections.delete(connKey);
      else openConnections.set(connKey, remaining);
      res.end();
    });
  });

  // GET /staff/accept — Public landing page reached after a successful
  // Signet auth via the minted QR's `post=` parameter. The token in the
  // query string is the plaintext invite token (one-time, short-lived);
  // it's used purely to look up the cache record and decide which static
  // HTML state to render. The inline <script> scrubs the token from the
  // browser URL so it can't leak via referer / shoulder-surf / history.
  acceptRouter.get('/staff/accept', (req, res) => {
    const token = req.query.invite;
    if (!token || typeof token !== 'string') {
      return res
        .status(410)
        .type('html')
        .send(renderError('This invite link is malformed or expired.'));
    }
    const rec = cache.getByToken(token);
    if (!rec) {
      return res
        .status(410)
        .type('html')
        .send(
          renderError(
            'This invite is expired or has already been used. Ask your manager to send a new one.',
          ),
        );
    }
    if (rec.status === 'consumed') {
      return res
        .status(410)
        .type('html')
        .send(renderError('This invite has already been used.'));
    }
    if (rec.status === 'accepted') {
      return res
        .status(200)
        .type('html')
        .send(
          renderAccepted({
            displayName: rec.display_name,
            personaPubkey: rec.persona_pubkey,
            role: rec.role,
          }),
        );
    }
    return res.status(200).type('html').send(renderPending());
  });

  return { apiRouter, acceptRouter };
}

// --- Inline HTML helpers -----------------------------------------------------
//
// Kept as plain string-builders rather than a templating library — these are
// three small static pages with zero loops and the brand styling is intended
// to match the MatchPass planning site (#2d6a4f primary, #1a472a dark, Georgia
// headings). The replaceState script in the shell strips the `?invite=…`
// query from the URL after render so the token can't leak via referer or
// browser history.

function renderShell(body) {
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MatchPass</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1.25rem; color: #1a472a; }
h1 { font-family: Georgia, serif; color: #1a472a; }
.card { padding: 1.5rem; border: 2px solid #2d6a4f; border-radius: 8px; }
.muted { color: #666; font-size: 0.875rem; }
.persona { font-family: monospace; font-size: 0.875rem; background: #f0f4f1; padding: 0.5rem; border-radius: 4px; word-break: break-all; display: inline-block; }
</style>
</head><body>${body}<script>history.replaceState({}, '', window.location.pathname);</script></body></html>`;
}

function renderAccepted({ displayName, personaPubkey, role }) {
  const greeting = displayName ? `Welcome, ${escapeHtml(displayName)}.` : 'Welcome.';
  const roleLabel = escapeHtml(String(role || '').replace(/_/g, ' '));
  return renderShell(`
    <h1>Accepted</h1>
    <div class="card">
      <p>${greeting}</p>
      <p>You've been signed in as <strong>${roleLabel}</strong>. Your manager will add you to the roster.</p>
      <p class="muted">Persona: <code class="persona">${escapeHtml(personaPubkey || '')}</code></p>
    </div>
  `);
}

function renderPending() {
  return renderShell(`
    <h1>Awaiting sign-in</h1>
    <div class="card">
      <p>This invite is ready, but no one has signed in yet. If you just scanned the QR, complete the approval in your Signet app.</p>
    </div>
  `);
}

function renderError(msg) {
  return renderShell(`
    <h1>Invite expired</h1>
    <div class="card"><p>${escapeHtml(msg)}</p></div>
  `);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
