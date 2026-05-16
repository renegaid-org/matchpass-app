import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createHash, createHmac } from 'crypto';
import createInvitesRouter from '../../server/routes/invites.js';
import { createInviteCache } from '../../server/invite-cache.js';
import { setSubscribeSecretForTest } from '../../server/auth.js';

const TEST_SUBSCRIBE_SECRET = 'a'.repeat(64);

beforeEach(() => {
  setSubscribeSecretForTest(TEST_SUBSCRIBE_SECRET);
});

function cookieNameFor(token) {
  return 'mp_invite_sub_' + createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function signCookieValue(token, iat = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', TEST_SUBSCRIBE_SECRET)
    .update(`${token}.${iat}`)
    .digest('hex');
  return `${iat}.${mac}`;
}

function makeApp({ inviterRole = 'admin' } = {}) {
  const cache = createInviteCache();
  const onMint = vi.fn();
  const app = express();
  app.use(express.json());
  // Stub auth middleware that attaches req.staff
  app.use((req, _res, next) => {
    req.staff = {
      pubkey: 'bb'.repeat(32),
      role: inviterRole,
      clubPubkey: 'aa'.repeat(32),
    };
    next();
  });
  const { apiRouter, acceptRouter } = createInvitesRouter({
    cache,
    onMint,
    gateHost: 'https://gate.matchpass.club',
  });
  app.use('/api/gate/invites', apiRouter);
  // /staff/accept is publicly reachable in production (it's the post-auth
  // redirect target), so we mount the acceptRouter at root without the
  // staff-stub middleware. That middleware still runs on the request because
  // it's mounted earlier — but the accept handler intentionally ignores it.
  app.use('/', acceptRouter);
  return { app, cache, onMint };
}

async function getText(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    server.close();
  }
}

async function post(app, path, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, body: data };
  } finally {
    server.close();
  }
}

async function del(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'DELETE',
    });
    // 204 has no body; other statuses may
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

// Streaming helper: opens an SSE subscription, runs `whileOpen()` once the
// stream is established, then resolves with the first parsed `event: invite`
// payload (or rejects on the 3-second timeout). Matches the bespoke
// `app.listen(0)` + native-fetch pattern already used by `post()` above so we
// avoid pulling in supertest.
async function openSseAndAwaitFirstInviteEvent(app, path, whileOpen) {
  return openSseAndAwaitFirstInviteEventWithHeaders(app, path, {}, whileOpen);
}

async function openSseAndAwaitFirstInviteEventWithHeaders(app, path, extraHeaders, whileOpen) {
  const server = app.listen(0);
  const port = server.address().port;
  const controller = new AbortController();
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      headers: { Accept: 'text/event-stream', ...extraHeaders },
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const body = await res.text();
      return { status: res.status, body };
    }
    // Trigger cache mutation now that the SSE stream is open and the
    // listener has been wired up by the route handler.
    if (whileOpen) await whileOpen();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const readPromise = reader.read();
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ __timeout: true }), remaining),
      );
      const next = await Promise.race([readPromise, timeoutPromise]);
      if (next.__timeout) throw new Error('SSE read timed out');
      if (next.done) throw new Error('SSE stream closed before invite event');
      buf += decoder.decode(next.value, { stream: true });
      // Look for a complete SSE frame.
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = frame.split('\n');
        let eventName = null;
        let dataLine = null;
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
        }
        if (eventName === 'invite' && dataLine) {
          return { status: 200, event: eventName, data: JSON.parse(dataLine) };
        }
      }
    }
    throw new Error('SSE read timed out');
  } finally {
    controller.abort();
    server.close();
  }
}

describe('GET /api/gate/invites/:token/subscribe (SSE)', () => {
  it('streams an accepted event when the cache accepts by session pubkey', async () => {
    const { app, cache } = makeApp();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    const result = await openSseAndAwaitFirstInviteEvent(
      app,
      `/api/gate/invites/${minted.invite_token}/subscribe`,
      async () => {
        // Give the route handler a tick to attach its onEvent listener
        // before we trigger the cache mutation.
        await new Promise((r) => setTimeout(r, 50));
        cache.acceptBySessionPubkey(minted.session_pubkey, 'cc'.repeat(32));
      },
    );
    expect(result.status).toBe(200);
    expect(result.event).toBe('invite');
    expect(result.data.type).toBe('accepted');
    expect(result.data.persona_pubkey).toBe('cc'.repeat(32));
    expect(result.data.display_name).toBe('Marcus');
    expect(typeof result.data.accepted_at).toBe('number');
  }, 5_000);

  it('returns 404 when the invite token does not exist', async () => {
    const { app } = makeApp();
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/gate/invites/nope/subscribe`, {
        headers: { Accept: 'text/event-stream' },
      });
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('returns 403 when the staff club does not own the invite', async () => {
    const { app, cache } = makeApp();
    const minted = cache.mint({
      clubPubkey: 'dd'.repeat(32), // different club
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://localhost:${port}/api/gate/invites/${minted.invite_token}/subscribe`,
        { headers: { Accept: 'text/event-stream' } },
      );
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  // Validates the per-router-instance openConnections counter. Two
  // independent makeApp() calls must NOT share the cap, otherwise a stale
  // counter from one test would leak into the next. Pre-fix this was a
  // module-level Map.
  it('429-caps at MAX_CONNECTIONS_PER_PUBKEY per router instance, isolated across apps', async () => {
    const MAX = 3;
    const openOneStream = async (port, path) => {
      const controller = new AbortController();
      const res = await fetch(`http://localhost:${port}${path}`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      return { status: res.status, abort: () => controller.abort() };
    };

    // First app: open MAX subscriptions to the same invite, then expect 429.
    const app1 = makeApp();
    const minted1 = app1.cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    const server1 = app1.app.listen(0);
    const port1 = server1.address().port;
    const opened1 = [];
    try {
      for (let i = 0; i < MAX; i++) {
        const s = await openOneStream(port1, `/api/gate/invites/${minted1.invite_token}/subscribe`);
        expect(s.status).toBe(200);
        opened1.push(s);
      }
      const overflow = await openOneStream(
        port1,
        `/api/gate/invites/${minted1.invite_token}/subscribe`,
      );
      expect(overflow.status).toBe(429);

      // Second app: same admin pubkey, fresh router instance. The cap must
      // be independent — the first app's full counter must NOT carry over.
      const app2 = makeApp();
      const minted2 = app2.cache.mint({
        clubPubkey: 'aa'.repeat(32),
        inviterPubkey: 'bb'.repeat(32),
        role: 'gate_steward',
      });
      const server2 = app2.app.listen(0);
      const port2 = server2.address().port;
      try {
        const fresh = await openOneStream(
          port2,
          `/api/gate/invites/${minted2.invite_token}/subscribe`,
        );
        expect(fresh.status).toBe(200);
        fresh.abort();
      } finally {
        server2.close();
      }
    } finally {
      for (const s of opened1) s.abort();
      server1.close();
    }
  }, 8_000);
});

describe('POST /api/gate/invites', () => {
  it('admin mints a gate_steward invite and gets a QR-ready URL', async () => {
    const { app, onMint } = makeApp();
    const { status, body } = await post(app, '/api/gate/invites', {
      role: 'gate_steward',
      display_name: 'Marcus',
    });
    expect(status).toBe(201);
    expect(body.invite_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.qr_payload).toMatch(/^https:\/\/mysignet\.app\/\?/);
    expect(body.qr_payload).toContain('relay=wss%3A%2F%2Frelay.trotters.cc');
    expect(body.qr_payload).toContain('accept=persona');
    expect(body.qr_payload).toContain('sessionPubkey=');
    expect(body.qr_payload).toContain('post=https%3A%2F%2Fgate.matchpass.club%2Fstaff%2Faccept%3Finvite%3D' + body.invite_token);
    expect(onMint).toHaveBeenCalledTimes(1);
  });

  it('staff_manager minting gate_steward requires staff_expires_at', async () => {
    const { app } = makeApp({ inviterRole: 'staff_manager' });
    const { status, body } = await post(app, '/api/gate/invites', { role: 'gate_steward' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/staffExpiresAt/);
  });

  it('staff_manager cannot mint roaming_steward', async () => {
    const { app } = makeApp({ inviterRole: 'staff_manager' });
    const { status } = await post(app, '/api/gate/invites', {
      role: 'roaming_steward',
      staff_expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(status).toBe(403);
  });

  it('gate_steward cannot mint anything', async () => {
    const { app } = makeApp({ inviterRole: 'gate_steward' });
    const { status } = await post(app, '/api/gate/invites', { role: 'gate_steward' });
    expect(status).toBe(403);
  });
});

// --- Cookie auth (Task 13) ---------------------------------------------------
//
// SSE callers from a browser can't send Authorization: Nostr because native
// EventSource doesn't expose request headers. POST / therefore sets a short
// path-scoped HMAC-signed cookie which the subscribe route accepts as a
// parallel auth path to NIP-98.

// App variant where the router runs with a real verifyNip98Middleware stub —
// this is what Task 11's wiring will look like. The stub 401s when no auth
// header is present, and only attaches req.staff when called with the magic
// header value. We use it to prove the cookie path is independent of NIP-98
// and that a tampered cookie fails over to NIP-98's 401.
function makeAppWithRealAuth() {
  const cache = createInviteCache();
  const onMint = vi.fn();
  const app = express();
  app.use(express.json());
  const verifyNip98Middleware = (req, res, next) => {
    if (req.headers.authorization === 'Nostr ok') {
      req.staff = {
        pubkey: 'bb'.repeat(32),
        role: 'admin',
        clubPubkey: 'aa'.repeat(32),
      };
      return next();
    }
    return res.status(401).json({ error: 'Missing or invalid auth header' });
  };
  const { apiRouter } = createInvitesRouter({
    cache,
    onMint,
    gateHost: 'https://gate.matchpass.club',
    verifyNip98Middleware,
  });
  app.use('/api/gate/invites', apiRouter);
  return { app, cache };
}

describe('POST /api/gate/invites — subscribe cookie', () => {
  it('sets a path-scoped HMAC-signed cookie on successful mint', async () => {
    const { app } = makeApp();
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/gate/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'gate_steward', display_name: 'Marcus' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      // Name binds to the first 8 hex chars of sha256(token).
      const expectedName = cookieNameFor(body.invite_token);
      expect(setCookie).toContain(`${expectedName}=`);
      // Value shape: <iat>.<hex>
      expect(setCookie).toMatch(new RegExp(`${expectedName}=\\d+\\.[0-9a-f]{64}`));
      // Path scoped to this token's subscribe endpoint only.
      expect(setCookie).toContain(`Path=/api/gate/invites/${body.invite_token}/subscribe`);
      // Hardening flags.
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Max-Age=900');
    } finally {
      server.close();
    }
  });
});

describe('GET /api/gate/invites/:token/subscribe — cookie auth', () => {
  it('accepts a valid cookie with no Authorization header', async () => {
    const { app, cache } = makeAppWithRealAuth();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    const cookieHeader = `${cookieNameFor(minted.invite_token)}=${signCookieValue(minted.invite_token)}`;
    const result = await openSseAndAwaitFirstInviteEventWithHeaders(
      app,
      `/api/gate/invites/${minted.invite_token}/subscribe`,
      { Cookie: cookieHeader },
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        cache.acceptBySessionPubkey(minted.session_pubkey, 'cc'.repeat(32));
      },
    );
    expect(result.status).toBe(200);
    expect(result.event).toBe('invite');
    expect(result.data.type).toBe('accepted');
  }, 5_000);

  it('rejects a tampered cookie (HMAC mismatch) with 401', async () => {
    const { app, cache } = makeAppWithRealAuth();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    // Flip a single hex char of the MAC to invalidate it.
    const good = signCookieValue(minted.invite_token);
    const tampered = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
    const cookieHeader = `${cookieNameFor(minted.invite_token)}=${tampered}`;
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://localhost:${port}/api/gate/invites/${minted.invite_token}/subscribe`,
        { headers: { Accept: 'text/event-stream', Cookie: cookieHeader } },
      );
      // Falls through to NIP-98 (no Authorization header) → 401.
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('still works via NIP-98 header when no cookie is present', async () => {
    const { app, cache } = makeAppWithRealAuth();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    const result = await openSseAndAwaitFirstInviteEventWithHeaders(
      app,
      `/api/gate/invites/${minted.invite_token}/subscribe`,
      { Authorization: 'Nostr ok' },
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        cache.acceptBySessionPubkey(minted.session_pubkey, 'cc'.repeat(32));
      },
    );
    expect(result.status).toBe(200);
    expect(result.event).toBe('invite');
    expect(result.data.type).toBe('accepted');
  }, 5_000);
});

describe('GET /api/gate/invites/accepted', () => {
  it('returns accepted invites for the requester\'s club (admin)', async () => {
    const { app, cache } = makeApp();
    // Mint two invites for the admin's club and accept one. The accepted one
    // must come back; the still-pending one must not.
    const accepted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Marcus',
      staffExpiresAt: Math.floor(Date.now() / 1000) + 4 * 3600,
    });
    cache.acceptBySessionPubkey(accepted.session_pubkey, 'cc'.repeat(32));
    cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Pending Pat',
    });

    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/gate/invites/accepted`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invites).toHaveLength(1);
      const inv = body.invites[0];
      expect(inv.persona_pubkey).toBe('cc'.repeat(32));
      expect(inv.role).toBe('gate_steward');
      expect(inv.display_name).toBe('Marcus');
      expect(inv.club_pubkey).toBe('aa'.repeat(32));
      expect(inv.status).toBe('accepted');
      expect(typeof inv.token_hash).toBe('string');
      expect(typeof inv.accepted_at).toBe('number');
    } finally {
      server.close();
    }
  });

  it('does not leak accepted invites from a different club', async () => {
    // Two apps sharing a single cache: app A is an admin on club A, app B on
    // club B. An accepted invite on club B must NOT appear in club A's view.
    const cache = createInviteCache();
    const onMint = vi.fn();
    const makeAppForClub = (clubPubkey) => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.staff = {
          pubkey: 'bb'.repeat(32),
          role: 'admin',
          clubPubkey,
        };
        next();
      });
      const { apiRouter } = createInvitesRouter({
        cache,
        onMint,
        gateHost: 'https://gate.matchpass.club',
      });
      app.use('/api/gate/invites', apiRouter);
      return app;
    };

    const clubA = 'aa'.repeat(32);
    const clubB = 'dd'.repeat(32);
    const appA = makeAppForClub(clubA);

    // Accepted invite on club B only.
    const mintedB = cache.mint({
      clubPubkey: clubB,
      inviterPubkey: 'ee'.repeat(32),
      role: 'gate_steward',
      displayName: 'B-side Bo',
    });
    cache.acceptBySessionPubkey(mintedB.session_pubkey, 'ff'.repeat(32));

    const server = appA.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/gate/invites/accepted`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invites).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe('DELETE /api/gate/invites/:token', () => {
  it('removes a pending invite from the cache and returns 204', async () => {
    const { app, cache } = makeApp();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    expect(cache.getByToken(minted.invite_token)).not.toBeNull();

    const res = await del(app, `/api/gate/invites/${minted.invite_token}`);
    expect(res.status).toBe(204);
    expect(cache.getByToken(minted.invite_token)).toBeNull();
  });

  it('also removes an accepted invite (manual cancel in either phase)', async () => {
    const { app, cache } = makeApp();
    const minted = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    cache.acceptBySessionPubkey(minted.session_pubkey, 'cc'.repeat(32));

    const res = await del(app, `/api/gate/invites/${minted.invite_token}`);
    expect(res.status).toBe(204);
    expect(cache.getByToken(minted.invite_token)).toBeNull();
  });

  it('returns 404 for an unknown token', async () => {
    const { app } = makeApp();
    const res = await del(app, '/api/gate/invites/never-existed');
    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller is not the club that owns the invite', async () => {
    // Mint into a different club, then DELETE from the makeApp stub (clubPubkey aa).
    const { app, cache } = makeApp();
    const minted = cache.mint({
      clubPubkey: 'dd'.repeat(32), // different club
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    const res = await del(app, `/api/gate/invites/${minted.invite_token}`);
    expect(res.status).toBe(403);
    // And the record must NOT have been removed by the failed attempt.
    expect(cache.getByToken(minted.invite_token)).not.toBeNull();
  });
});

describe('GET /staff/accept', () => {
  it('renders the accepted confirmation page once the invite has been accepted', async () => {
    const { app, cache } = makeApp();
    // Mint via the route so the token round-trips through real wiring; then
    // accept server-side by simulating the relay-handler callback.
    const mintRes = await post(app, '/api/gate/invites', {
      role: 'gate_steward',
      display_name: 'Marcus',
    });
    expect(mintRes.status).toBe(201);
    const token = mintRes.body.invite_token;
    const rec = cache.getByTokenWithSecrets(token);
    cache.acceptBySessionPubkey(rec.session_pubkey, 'cc'.repeat(32));

    const res = await getText(app, `/staff/accept?invite=${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Accepted');
    expect(res.text).toContain('Marcus');
    expect(res.text).toContain('gate steward'); // role label, underscore stripped
    expect(res.text).toContain('cc'.repeat(32)); // persona shown
    expect(res.text).toContain('replaceState'); // URL scrub script present
  });

  it('renders the pending page while the invite is still awaiting sign-in', async () => {
    const { app } = makeApp();
    const mintRes = await post(app, '/api/gate/invites', { role: 'gate_steward' });
    expect(mintRes.status).toBe(201);
    const res = await getText(app, `/staff/accept?invite=${mintRes.body.invite_token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Awaiting');
  });

  it('returns 410 with an expired-invite page for unknown / malformed tokens', async () => {
    const { app } = makeApp();
    const res = await getText(app, '/staff/accept?invite=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(410);
    expect(res.text).toContain('expired');
  });
});
