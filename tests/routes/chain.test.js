import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { EVENT_KINDS } from '../../server/chain/types.js';
import createChainRouter from '../../server/routes/chain.js';

function makeChain({ fanSk, stewardSk }) {
  const fanPk = getPublicKey(fanSk);
  const now = Math.floor(Date.now() / 1000);
  const membership = finalizeEvent({
    kind: EVENT_KINDS.MEMBERSHIP,
    created_at: now - 1000,
    tags: [
      ['d', `${fanPk}:membership`],
      ['p', fanPk],
      ['club', 'c'.repeat(64)],
    ],
    content: '',
  }, fanSk);

  const card = finalizeEvent({
    kind: EVENT_KINDS.CARD,
    created_at: now - 100,
    tags: [
      ['d', `${fanPk}:card:1`],
      ['p', fanPk],
      ['previous', membership.id],
      ['card_type', 'yellow'],
      ['category', 'intoxication'],
    ],
    content: '',
  }, stewardSk);

  return { fanPk, events: [membership, card] };
}

function buildApp(fetchFanChain) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.staff = { pubkey: 'staff1' }; next(); });
  app.use('/chain', createChainRouter({ fetchFanChain }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

describe('GET /chain/:pubkey', () => {
  let fanSk, stewardSk;
  beforeEach(() => {
    fanSk = generateSecretKey();
    stewardSk = generateSecretKey();
  });

  it('rejects invalid pubkey format', async () => {
    const app = buildApp(async () => []);
    const { status } = await get(app, '/chain/not-a-pubkey');
    expect(status).toBe(400);
  });

  it('404 when no events', async () => {
    const app = buildApp(async () => []);
    const { status } = await get(app, `/chain/${'a'.repeat(64)}`);
    expect(status).toBe(404);
  });

  it('returns ordered events, tip, and status for a valid chain', async () => {
    const { fanPk, events } = makeChain({ fanSk, stewardSk });
    const fetcher = vi.fn().mockResolvedValue(events);
    const app = buildApp(fetcher);

    const { status, body } = await get(app, `/chain/${fanPk}`);
    expect(status).toBe(200);
    expect(body.fanPubkey).toBe(fanPk);
    expect(body.events).toHaveLength(2);
    expect(body.tip).toBe(events[1].id);
    expect(body.length).toBe(2);
    expect(body.valid).toBe(true);
    expect(body.statusName).toBe('yellow');
    expect(body.activeCards).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(fanPk);
  });

  it('502 when the fetcher throws', async () => {
    const app = buildApp(async () => { throw new Error('relay down'); });
    const { status, body } = await get(app, `/chain/${'a'.repeat(64)}`);
    expect(status).toBe(502);
    expect(body.error).toMatch(/Relay fetch failed/);
  });
});
