import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { ChainTipCache } from '../../server/chain-tip-cache.js';
import createTipRouter from '../../server/routes/tip.js';

function buildApp(caches) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.staff = { pubkey: 's', role: 'gate_steward' }; next(); });
  app.use('/tip', createTipRouter(caches));
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const data = await res.json();
    return { status: res.status, body: data };
  } finally { server.close(); }
}

describe('GET /tip/:pubkey', () => {
  let chainTipCache;
  beforeEach(() => { chainTipCache = new ChainTipCache(); });

  it('returns 404 for unknown fan', async () => {
    const app = buildApp({ chainTipCache });
    const { status } = await get(app, '/tip/' + 'f'.repeat(64));
    expect(status).toBe(404);
  });

  it('returns tip for known fan', async () => {
    const pubkey = 'f'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'evt1', status: 0 });
    const app = buildApp({ chainTipCache });
    const { body } = await get(app, '/tip/' + pubkey);
    expect(body.tipEventId).toBe('evt1');
    expect(body.statusName).toBe('clean');
  });

  it('returns 400 for invalid pubkey', async () => {
    const app = buildApp({ chainTipCache });
    const { status } = await get(app, '/tip/bad');
    expect(status).toBe(400);
  });
});
