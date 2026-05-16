import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

// Mock the relay layer so the test never opens a websocket. Each test re-
// reads `publishEventMock` via the imported reference, so we can assert it
// was called and control success/failure.
const publishEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../server/relay.js', () => ({
  publishEvent: (...args) => publishEventMock(...args),
}));

import createEventRouter from '../../server/routes/event.js';
import { createInviteCache } from '../../server/invite-cache.js';
import { STAFF_ROSTER_KIND } from '../../server/chain/types.js';

function buildApp({ inviteCache, staff, chainTipCache, rosterCache, eventAuthorCache }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.staff = staff;
    next();
  });
  app.use(
    '/event',
    createEventRouter({ chainTipCache, rosterCache, eventAuthorCache, inviteCache }),
  );
  return app;
}

function makeRosterEvent(clubSk, personaPubkeys, createdAt = Math.floor(Date.now() / 1000)) {
  const tags = [['d', 'staff-roster']];
  for (const pk of personaPubkeys) {
    tags.push(['p', pk, 'gate_steward', '']);
  }
  return finalizeEvent(
    {
      kind: STAFF_ROSTER_KIND,
      created_at: createdAt,
      tags,
      content: '',
    },
    clubSk,
  );
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
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

describe('POST /api/gate/event — invite consume hook', () => {
  let clubSk, clubPk, inviteCache;

  beforeEach(() => {
    publishEventMock.mockClear();
    publishEventMock.mockResolvedValue(undefined);
    clubSk = generateSecretKey();
    clubPk = getPublicKey(clubSk);
    inviteCache = createInviteCache();
  });

  it('marks invite consumed when published roster contains the accepted persona pubkey', async () => {
    // Mint + accept an invite tied to this club.
    const { invite_token } = inviteCache.mint({
      clubPubkey: clubPk,
      inviterPubkey: clubPk,
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    const personaSk = generateSecretKey();
    const personaPk = getPublicKey(personaSk);
    inviteCache.accept(invite_token, personaPk);

    // Sanity: invite is currently accepted.
    expect(inviteCache.getByToken(invite_token).status).toBe('accepted');

    // Publish a roster event that includes the accepted persona pubkey.
    const rosterEvent = makeRosterEvent(clubSk, [clubPk, personaPk]);
    const app = buildApp({
      inviteCache,
      staff: { pubkey: clubPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status } = await post(app, '/event', { event: rosterEvent });

    expect(status).toBe(201);
    expect(publishEventMock).toHaveBeenCalledTimes(1);

    const after = inviteCache.getByToken(invite_token);
    expect(after.status).toBe('consumed');
    expect(after.roster_event_id).toBe(rosterEvent.id);
  });

  it('does not mark consumed if accepted persona pubkey not in roster', async () => {
    // Mint + accept an invite — persona X.
    const { invite_token } = inviteCache.mint({
      clubPubkey: clubPk,
      inviterPubkey: clubPk,
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    const personaSk = generateSecretKey();
    const personaPk = getPublicKey(personaSk);
    inviteCache.accept(invite_token, personaPk);

    // Publish a roster containing a DIFFERENT persona pubkey, not X.
    const otherPk = 'a'.repeat(64);
    const rosterEvent = makeRosterEvent(clubSk, [clubPk, otherPk]);
    const app = buildApp({
      inviteCache,
      staff: { pubkey: clubPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status } = await post(app, '/event', { event: rosterEvent });

    expect(status).toBe(201);
    expect(publishEventMock).toHaveBeenCalledTimes(1);

    const after = inviteCache.getByToken(invite_token);
    expect(after.status).toBe('accepted');
    expect(after.roster_event_id).toBeUndefined();
  });

  it('roster publish still succeeds when no inviteCache is wired (back-compat)', async () => {
    const rosterEvent = makeRosterEvent(clubSk, [clubPk]);
    const app = buildApp({
      // No inviteCache — the hook must be skipped silently.
      staff: { pubkey: clubPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await post(app, '/event', { event: rosterEvent });
    expect(status).toBe(201);
    expect(body.eventId).toBe(rosterEvent.id);
    expect(publishEventMock).toHaveBeenCalledTimes(1);
  });

  it('rejects roster signed by a pubkey other than the session club pubkey', async () => {
    const wrongSk = generateSecretKey();
    const rosterEvent = makeRosterEvent(wrongSk, [clubPk]);
    const app = buildApp({
      inviteCache,
      staff: { pubkey: clubPk, role: 'admin', clubPubkey: clubPk },
    });
    const { status, body } = await post(app, '/event', { event: rosterEvent });
    expect(status).toBe(403);
    expect(body.error).toMatch(/signed by the club pubkey/);
    expect(publishEventMock).not.toHaveBeenCalled();
  });
});
