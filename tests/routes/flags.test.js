import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { ScanTracker } from '../../server/scan-tracker.js';
import { ReviewRequestCache } from '../../server/review-request-cache.js';
import createFlagsRouter from '../../server/routes/flags.js';

function buildApp({ scanTracker, reviewRequestCache, clubPubkey = 'c'.repeat(64) }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.staff = { pubkey: 'staff1', role: 'safety_officer', clubPubkey };
    next();
  });
  app.use('/flags', createFlagsRouter({ scanTracker, reviewRequestCache }));
  return app;
}

async function req(app, method, path, body) {
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

function makeReviewEvent(id, clubPubkey) {
  return {
    id,
    pubkey: 'f'.repeat(64),
    kind: 31910,
    created_at: 1700000000,
    tags: [
      ['p', 'a'.repeat(64)],
      ['reviews', 'b'.repeat(64)],
      ['club', clubPubkey],
    ],
    content: '',
    sig: '0'.repeat(128),
  };
}

describe('/flags route', () => {
  let scanTracker, reviewRequestCache;
  beforeEach(() => {
    scanTracker = new ScanTracker();
    reviewRequestCache = new ReviewRequestCache();
  });

  it('GET returns empty arrays when nothing is cached', async () => {
    const app = buildApp({ scanTracker, reviewRequestCache });
    const { status, body } = await req(app, 'GET', '/flags');
    expect(status).toBe(200);
    expect(body.flags).toEqual([]);
    expect(body.reviewRequests).toEqual([]);
  });

  it('GET surfaces duplicate-scan flags and review requests for the officer\'s club', async () => {
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-A', 'staff1');
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-B', 'staff2');
    reviewRequestCache.set(makeReviewEvent('1'.repeat(64), 'c'.repeat(64)));
    reviewRequestCache.set(makeReviewEvent('2'.repeat(64), 'd'.repeat(64)));

    const app = buildApp({ scanTracker, reviewRequestCache });
    const { body } = await req(app, 'GET', '/flags');
    expect(body.flags).toHaveLength(1);
    expect(body.reviewRequests).toHaveLength(1);
    expect(body.reviewRequests[0].id).toBe('1'.repeat(64));
  });

  it('POST /:id/dismiss succeeds with a note', async () => {
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-A', 'staff1');
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-B', 'staff2');
    const flagId = scanTracker.listOpenFlags()[0].id;

    const app = buildApp({ scanTracker, reviewRequestCache });
    const { status, body } = await req(app, 'POST', `/flags/${encodeURIComponent(flagId)}/dismiss`, { note: 'resolved' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(scanTracker.listOpenFlags()).toHaveLength(0);
  });

  it('POST /:id/dismiss 404 when unknown', async () => {
    const app = buildApp({ scanTracker, reviewRequestCache });
    const { status } = await req(app, 'POST', '/flags/unknown/dismiss', { note: 'x' });
    expect(status).toBe(404);
  });

  it('POST /:id/dismiss 400 for oversized note', async () => {
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-A', 'staff1');
    scanTracker.checkAndRecord('a'.repeat(64), 'gate-B', 'staff2');
    const flagId = scanTracker.listOpenFlags()[0].id;

    const app = buildApp({ scanTracker, reviewRequestCache });
    const longNote = 'x'.repeat(501);
    const { status } = await req(app, 'POST', `/flags/${encodeURIComponent(flagId)}/dismiss`, { note: longNote });
    expect(status).toBe(400);
  });
});
