import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import createInvitesRouter from '../../server/routes/invites.js';
import { createInviteCache } from '../../server/invite-cache.js';

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
  app.use('/api/gate/invites', createInvitesRouter({ cache, onMint, gateHost: 'https://gate.matchpass.club' }));
  return { app, cache, onMint };
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

// Streaming helper: opens an SSE subscription, runs `whileOpen()` once the
// stream is established, then resolves with the first parsed `event: invite`
// payload (or rejects on the 3-second timeout). Matches the bespoke
// `app.listen(0)` + native-fetch pattern already used by `post()` above so we
// avoid pulling in supertest.
async function openSseAndAwaitFirstInviteEvent(app, path, whileOpen) {
  const server = app.listen(0);
  const port = server.address().port;
  const controller = new AbortController();
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      headers: { Accept: 'text/event-stream' },
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
