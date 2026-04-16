import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { ChainTipCache } from '../../server/chain-tip-cache.js';
import { RosterCache } from '../../server/roster-cache.js';
import { ScanTracker } from '../../server/scan-tracker.js';
import createDashboardRouter from '../../server/routes/dashboard.js';

function buildApp(caches) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.staff = { role: 'safety_officer' }; next(); });
  app.use('/dashboard', createDashboardRouter(caches));
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

describe('GET /dashboard', () => {
  it('returns stats with zero counts initially', async () => {
    const caches = {
      scanTracker: new ScanTracker(),
      chainTipCache: new ChainTipCache(),
      rosterCache: new RosterCache(),
    };
    const app = buildApp(caches);
    const { body } = await get(app, '/dashboard');
    expect(body.scans.total).toBe(0);
    expect(body.cache.fans).toBe(0);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
