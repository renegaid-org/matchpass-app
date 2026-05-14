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
