// tests/integration/invite-end-to-end.test.js
//
// End-to-end canary for the staff QR invite flow against a real Nostr relay.
//
//   1. matchpass-gate is spun up in-process (express app, no app.listen at
//      module scope — see createTestApp() below).
//   2. The test connects to the configured relay (env INTEGRATION_RELAY_URL)
//      so the same relay carries the gate's kind-1059 subscription, the
//      test client's publish, and the gate's kind-31920 roster publish.
//   3. An invite is minted via POST /api/gate/invites (NIP-98 signed by a
//      seeded admin pubkey).
//   4. A persona keypair is generated, a Signet auth gift-wrap is built
//      from tests/test-util/build-signet-auth-wrap.js, and published to
//      the relay.
//   5. The test waits up to 5 s for the cache to flip the invite to
//      `accepted` via the kind-1059 subscription + invite-handler pipeline.
//   6. The admin then publishes a kind-31920 roster event including the
//      accepted persona pubkey, and the test asserts the cache flips to
//      `consumed` via the route's consume hook.
//
// Skipped by default. To run against the staging relay:
//
//   INTEGRATION_RELAY_URL=wss://relay.trotters.cc \
//     npx vitest run tests/integration/invite-end-to-end.test.js
//
// If you find issues with the wiring while running this (e.g. SSE doesn't
// fire, the consume hook misses), the canary's job is to surface them — the
// fix belongs in a follow-up.

import { describe, it, expect } from 'vitest';
import express from 'express';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';

import { ChainTipCache } from '../../server/chain-tip-cache.js';
import { RosterCache } from '../../server/roster-cache.js';
import { ScanTracker } from '../../server/scan-tracker.js';
import { ReviewRequestCache } from '../../server/review-request-cache.js';
import { EventAuthorCache } from '../../server/chain/event-author-cache.js';
import { createInviteCache } from '../../server/invite-cache.js';
import { createInviteHandler } from '../../server/invite-handler.js';
import {
  connectAndSubscribe,
  getRelay,
  refreshInviteSubscription,
  attachInviteCache,
  _resetInviteSubscriptionForTest,
} from '../../server/relay.js';
import { verifyNip98 } from '../../server/auth.js';
import createEventRouter from '../../server/routes/event.js';
import createInvitesRouter from '../../server/routes/invites.js';
import { STAFF_ROSTER_KIND } from '../../server/chain/types.js';

import { buildSignetAuthWrap } from '../test-util/build-signet-auth-wrap.js';

const RELAY_URL = process.env.INTEGRATION_RELAY_URL;
const skip = !RELAY_URL;

// --- helpers ----------------------------------------------------------------

function buildNip98Header(sk, { method, url }) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['method', method], ['u', url]],
      content: '',
    },
    sk,
  );
  return 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64');
}

function buildAdminRosterEvent(clubSk, adminPk, extraPersonas = []) {
  const tags = [
    ['d', 'staff-roster'],
    ['p', adminPk, 'admin', 'Test Admin'],
  ];
  for (const pk of extraPersonas) {
    tags.push(['p', pk, 'gate_steward', '']);
  }
  return finalizeEvent(
    {
      kind: STAFF_ROSTER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    },
    clubSk,
  );
}

/**
 * Build a stand-alone express app that mirrors the production wiring in
 * server/index.js, minus app.listen and the ClubDiscovery / midnight clear
 * schedulers. Returns the app plus the live caches and a `close()` to tear
 * down the relay handle.
 */
async function createTestApp({ relayUrl, clubPubkeys }) {
  const chainTipCache = new ChainTipCache();
  const rosterCache = new RosterCache();
  const scanTracker = new ScanTracker();
  const reviewRequestCache = new ReviewRequestCache();
  const eventAuthorCache = new EventAuthorCache();
  const inviteCache = createInviteCache();

  const inviteHandler = createInviteHandler({
    cache: inviteCache,
    onAccept: () => {},
  });

  // Reset any subscription state from prior tests in this process.
  _resetInviteSubscriptionForTest();
  attachInviteCache(inviteCache, inviteHandler);

  inviteCache.onEvent(() => {
    refreshInviteSubscription(getRelay(), inviteCache.activeSessionPubkeys());
  });

  // Connect to the live relay BEFORE wiring routes — connectAndSubscribe
  // is responsible for assigning the module-level relay handle that
  // refreshInviteSubscription will later read via getRelay().
  await connectAndSubscribe(
    relayUrl,
    { chainTipCache, rosterCache, reviewRequestCache, eventAuthorCache },
    clubPubkeys,
  );

  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const auth = verifyNip98(rosterCache);

  app.use(
    '/api/gate/event',
    auth,
    createEventRouter({
      chainTipCache,
      rosterCache,
      eventAuthorCache,
      inviteCache,
    }),
  );

  const { apiRouter: invitesApiRouter, acceptRouter: invitesAcceptRouter } =
    createInvitesRouter({
      cache: inviteCache,
      onMint: () => {
        refreshInviteSubscription(getRelay(), inviteCache.activeSessionPubkeys());
      },
      gateHost: 'http://localhost',
      verifyNip98Middleware: auth,
    });
  app.use('/api/gate/invites', invitesApiRouter);
  app.use('/', invitesAcceptRouter);

  return {
    app,
    inviteCache,
    rosterCache,
    chainTipCache,
    close() {
      const r = getRelay();
      try {
        r?.close?.();
      } catch {
        /* ignore */
      }
      _resetInviteSubscriptionForTest();
    },
  };
}

// Variant that calls `buildHeaders(url)` with the live URL (host:port) so the
// caller can build a NIP-98 Authorization header matching the actual request
// target — host-tag verification in server/auth.js compares URL.host to
// req.headers.host, which always includes the ephemeral port.
async function postWithSignedUrl(app, path, body, buildHeaders) {
  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://localhost:${port}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildHeaders(url) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    server.close();
  }
}

async function waitFor(predicate, { timeoutMs = 5_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await predicate();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

// --- the test ---------------------------------------------------------------

describe.skipIf(skip)('Invite end-to-end with real relay', () => {
  it(
    'mints, accepts via gift-wrap, then consumes via roster publish',
    async () => {
      // 1. Seed a club key + admin roster fixture. The admin signs the
      //    roster event with their club key, so rosterCache.findStaff will
      //    return clubPubkey === adminPubkey on lookup. The gate accepts that
      //    as a valid NIP-98 signer.
      const adminSk = generateSecretKey();
      const adminPk = getPublicKey(adminSk);

      const ctx = await createTestApp({
        relayUrl: RELAY_URL,
        clubPubkeys: [adminPk],
      });

      try {
        // Seed the rosterCache directly (parallel to what the relay would
        // give us on a fresh boot if the admin had previously published).
        const initialRoster = buildAdminRosterEvent(adminSk, adminPk, []);
        ctx.rosterCache.set(adminPk, initialRoster);

        // 2. Mint an invite as the admin.
        const mintRes = await postWithSignedUrl(
          ctx.app,
          '/api/gate/invites',
          { role: 'gate_steward', display_name: 'Integration Marcus' },
          (url) => ({
            Authorization: buildNip98Header(adminSk, { method: 'POST', url }),
          }),
        );
        expect(mintRes.status).toBe(201);
        const inviteToken = mintRes.body.invite_token;

        // Pull session pubkey + challenge from the cache (these are the
        // server's view, not exposed by the POST response).
        const minted = ctx.inviteCache.getByTokenWithSecrets(inviteToken);
        expect(minted).toBeTruthy();
        expect(minted.status).toBe('pending');

        // 3. Generate a persona keypair and build a Signet auth wrap.
        const personaSk = generateSecretKey();
        const personaPk = getPublicKey(personaSk);
        const { wrap } = await buildSignetAuthWrap({
          personaPrivkey: personaSk,
          sessionPubkey: minted.session_pubkey,
          challenge: minted.auth_challenge,
          displayName: 'Integration Marcus',
        });

        // 4. Publish the wrap to the same relay. The gate's kind-1059
        //    subscription should pick it up, the invite-handler should
        //    unwrap + verify, and the cache should flip to `accepted`.
        const publisherRelay = await Relay.connect(RELAY_URL);
        try {
          await publisherRelay.publish(wrap);
        } finally {
          publisherRelay.close();
        }

        await waitFor(
          () => ctx.inviteCache.getByToken(inviteToken)?.status === 'accepted',
          { timeoutMs: 5_000 },
        );
        const accepted = ctx.inviteCache.getByToken(inviteToken);
        expect(accepted.persona_pubkey).toBe(personaPk);

        // 5. Build + publish a roster event that includes the new persona,
        //    via POST /api/gate/event (the production wiring). The event
        //    router's consume-hook fires after the publish succeeds.
        const newRoster = buildAdminRosterEvent(adminSk, adminPk, [personaPk]);
        const evRes = await postWithSignedUrl(
          ctx.app,
          '/api/gate/event',
          { event: newRoster },
          (url) => ({
            Authorization: buildNip98Header(adminSk, { method: 'POST', url }),
          }),
        );
        expect(evRes.status).toBe(201);

        // 6. Cache should now report consumed. The consume hook is
        //    synchronous after publish — no wait should be needed, but we
        //    poll briefly to absorb relay-round-trip jitter.
        await waitFor(
          () => ctx.inviteCache.getByToken(inviteToken)?.status === 'consumed',
          { timeoutMs: 2_000 },
        );
        const consumed = ctx.inviteCache.getByToken(inviteToken);
        expect(consumed.status).toBe('consumed');
        expect(consumed.roster_event_id).toBe(newRoster.id);
      } finally {
        ctx.close();
      }
    },
    30_000,
  );
});
