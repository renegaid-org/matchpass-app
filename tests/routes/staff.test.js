import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { RosterCache } from '../../server/roster-cache.js';
import { ScanTracker } from '../../server/scan-tracker.js';
import createStaffRouter from '../../server/routes/staff.js';

const clubPubkey = 'c'.repeat(64);
const alicePubkey = 'a'.repeat(64);
const bobPubkey = 'b'.repeat(64);

function buildApp(caches, clubOnSession = clubPubkey) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.staff = { pubkey: 'o'.repeat(64), role: 'safety_officer', clubPubkey: clubOnSession };
    next();
  });
  app.use('/staff', createStaffRouter(caches));
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

const rosterEvent = (tags) => ({
  id: 'r1', kind: 31920, pubkey: clubPubkey, created_at: Math.floor(Date.now() / 1000),
  tags: [['d', 'staff-roster'], ...tags], content: '', sig: 'x'.repeat(128),
});

describe('GET /staff', () => {
  let rosterCache;
  let scanTracker;

  beforeEach(() => {
    rosterCache = new RosterCache();
    scanTracker = new ScanTracker();
  });

  it('returns an empty list when the session has no cached roster', async () => {
    const app = buildApp({ rosterCache, scanTracker });
    const { status, body } = await get(app, '/staff');
    expect(status).toBe(200);
    expect(body.staff).toEqual([]);
  });

  it('403 when session has no club pubkey', async () => {
    const app = buildApp({ rosterCache, scanTracker }, null);
    const { status } = await get(app, '/staff');
    expect(status).toBe(403);
  });

  it('returns roster entries merged with per-staff scan counts', async () => {
    rosterCache.set(clubPubkey, rosterEvent([
      ['p', alicePubkey, 'gate_steward', 'Alice'],
      ['p', bobPubkey, 'roaming_steward', 'Bob'],
    ]));
    scanTracker.recordResult('green', alicePubkey);
    scanTracker.recordResult('green', alicePubkey);
    scanTracker.recordResult('red', alicePubkey);
    scanTracker.recordResult('amber', bobPubkey);

    const app = buildApp({ rosterCache, scanTracker });
    const { body } = await get(app, '/staff');
    const alice = body.staff.find(s => s.pubkey === alicePubkey);
    const bob = body.staff.find(s => s.pubkey === bobPubkey);
    expect(alice.role).toBe('gate_steward');
    expect(alice.displayName).toBe('Alice');
    expect(alice.scans).toEqual({ green: 2, amber: 0, red: 1, total: 3 });
    expect(bob.scans).toEqual({ green: 0, amber: 1, red: 0, total: 1 });
  });

  it('hides expired roster entries from the officer view', async () => {
    const now = Math.floor(Date.now() / 1000);
    rosterCache.set(clubPubkey, rosterEvent([
      ['p', alicePubkey, 'gate_steward', 'Alice'],
      // Expired temp steward
      ['p', bobPubkey, 'gate_steward', 'Temp Bob', String(now - 60)],
    ]));

    const app = buildApp({ rosterCache, scanTracker });
    const { body } = await get(app, '/staff');
    expect(body.staff.map(s => s.pubkey)).toEqual([alicePubkey]);
  });

  it('returns public fields only — no signed event, no sig, no content', async () => {
    rosterCache.set(clubPubkey, rosterEvent([
      ['p', alicePubkey, 'admin', 'Admin'],
    ]));
    const app = buildApp({ rosterCache, scanTracker });
    const { body } = await get(app, '/staff');
    const [member] = body.staff;
    expect(member).toEqual(expect.objectContaining({
      pubkey: alicePubkey, role: 'admin', displayName: 'Admin',
    }));
    expect(member.sig).toBeUndefined();
    expect(member.content).toBeUndefined();
    expect(member.tags).toBeUndefined();
  });
});
