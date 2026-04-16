import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { ChainTipCache } from '../../server/chain-tip-cache.js';
import { ScanTracker } from '../../server/scan-tracker.js';
import createScanRouter from '../../server/routes/scan.js';

function buildApp(caches, routeOpts = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.staff = { pubkey: 'staff1', role: 'gate_steward', clubPubkey: 'c'.repeat(64) };
    next();
  });
  app.use('/scan', createScanRouter(caches, routeOpts));
  return app;
}

function makeVenueEvent(pubkey = 'a'.repeat(64)) {
  return {
    kind: 21235, pubkey, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'signet-venue-entry'], ['x', 'b'.repeat(64)], ['blossom', 'https://blossom.example.com'], ['photo_key', 'c'.repeat(64)]],
    content: '', id: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    sig: 'e'.repeat(128),
  };
}

async function post(app, path, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, body: data };
  } finally {
    server.close();
  }
}

describe('POST /scan', () => {
  let chainTipCache, scanTracker;
  beforeEach(() => {
    chainTipCache = new ChainTipCache();
    scanTracker = new ScanTracker();
  });

  it('returns 400 without venue_entry_event', async () => {
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { status } = await post(app, '/scan', {});
    expect(status).toBe(400);
  });

  it('returns amber for unknown fan (first visit)', async () => {
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { body } = await post(app, '/scan', { venue_entry_event: makeVenueEvent() });
    expect(body.decision).toBe('amber');
    expect(body.firstTime).toBe(true);
  });

  it('returns green for clean cached fan', async () => {
    const pubkey = 'a'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'tip1', status: 0 });
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { body } = await post(app, '/scan', { venue_entry_event: makeVenueEvent(pubkey) });
    expect(body.decision).toBe('green');
  });

  it('returns red for banned fan', async () => {
    const pubkey = 'a'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'tip1', status: 3 });
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { body } = await post(app, '/scan', { venue_entry_event: makeVenueEvent(pubkey) });
    expect(body.decision).toBe('red');
    expect(body.reason).toBe('Banned');
  });

  it('returns amber for yellow-carded fan', async () => {
    const pubkey = 'a'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'tip1', status: 1 });
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { body } = await post(app, '/scan', { venue_entry_event: makeVenueEvent(pubkey) });
    expect(body.decision).toBe('amber');
  });

  it('includes photo info in response', async () => {
    const app = buildApp({ chainTipCache, scanTracker }, { skipSignatureCheck: true });
    const { body } = await post(app, '/scan', { venue_entry_event: makeVenueEvent() });
    expect(body.x).toBe('b'.repeat(64));
    expect(body.blossom).toBe('https://blossom.example.com');
    expect(body.photoKey).toBe('c'.repeat(64));
  });
});
