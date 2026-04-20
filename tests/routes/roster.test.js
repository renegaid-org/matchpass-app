import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { RosterCache } from '../../server/roster-cache.js';
import { STAFF_ROSTER_KIND } from '../../server/chain/types.js';
import createRosterRouter from '../../server/routes/roster.js';

function buildApp({ rosterCache, publishEvent, staff }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.staff = staff;
    next();
  });
  app.use('/roster', createRosterRouter({ rosterCache, publishEvent }));
  return app;
}

function makeRosterEvent(clubSk, entries, createdAt = Math.floor(Date.now() / 1000)) {
  const tags = [['d', 'staff-roster']];
  for (const e of entries) tags.push(['p', e.pubkey, e.role, e.displayName || '']);
  return finalizeEvent({
    kind: STAFF_ROSTER_KIND,
    created_at: createdAt,
    tags,
    content: '',
  }, clubSk);
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

describe('roster routes', () => {
  let clubSk, clubPk, adminPk, rosterCache, publishEvent;

  beforeEach(() => {
    clubSk = generateSecretKey();
    clubPk = getPublicKey(clubSk);
    adminPk = clubPk; // pilot: admin pubkey === club pubkey
    rosterCache = new RosterCache();
    publishEvent = vi.fn().mockResolvedValue(undefined);
  });

  it('GET returns 403 when session has no club pubkey', async () => {
    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin' },
    });
    const { status } = await request(app, 'GET', '/roster');
    expect(status).toBe(403);
  });

  it('GET returns 404 when roster not cached', async () => {
    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status } = await request(app, 'GET', '/roster');
    expect(status).toBe(404);
  });

  it('GET returns the cached roster with parsed staff', async () => {
    const entries = [
      { pubkey: adminPk, role: 'admin', displayName: 'Morgan' },
      { pubkey: 'a'.repeat(64), role: 'gate_steward', displayName: 'Steve' },
    ];
    const event = makeRosterEvent(clubSk, entries);
    rosterCache.set(clubPk, event);

    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await request(app, 'GET', '/roster');
    expect(status).toBe(200);
    expect(body.clubPubkey).toBe(clubPk);
    expect(body.staff).toHaveLength(2);
    expect(body.staff[0].displayName).toBe('Morgan');
  });

  it('POST publishes a new roster signed by the club pubkey', async () => {
    const now = Math.floor(Date.now() / 1000);
    const original = makeRosterEvent(clubSk, [
      { pubkey: adminPk, role: 'admin', displayName: 'Morgan' },
    ], now - 10);
    rosterCache.set(clubPk, original);

    const next = makeRosterEvent(clubSk, [
      { pubkey: adminPk, role: 'admin', displayName: 'Morgan' },
      { pubkey: 'a'.repeat(64), role: 'gate_steward', displayName: 'Steve' },
    ], now);

    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await request(app, 'POST', '/roster', { event: next });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const cached = rosterCache.get(clubPk);
    expect(cached.staff).toHaveLength(2);
  });

  it('POST rejects a roster signed by a different pubkey', async () => {
    const wrongSk = generateSecretKey();
    const wrongRoster = makeRosterEvent(wrongSk, [
      { pubkey: adminPk, role: 'admin', displayName: 'Morgan' },
    ]);

    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await request(app, 'POST', '/roster', { event: wrongRoster });
    expect(status).toBe(403);
    expect(body.error).toMatch(/must be signed by the club pubkey/);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('POST rejects a roster that drops the admin themselves', async () => {
    const next = makeRosterEvent(clubSk, [
      { pubkey: 'a'.repeat(64), role: 'gate_steward', displayName: 'Steve' },
    ]);

    const app = buildApp({
      rosterCache, publishEvent,
      staff: { pubkey: adminPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await request(app, 'POST', '/roster', { event: next });
    expect(status).toBe(400);
    expect(body.error).toMatch(/remain in the roster with role "admin"/);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
