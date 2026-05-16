// tests/invite-handler.test.js
//
// Tests for server/invite-handler.js — the glue between a kind-1059
// gift-wrap landing on the relay subscription and the invite cache's
// pending → accepted transition.
//
// The plan originally specified a JSON "golden fixture" loaded from
// tests/fixtures/signet-auth-wrap.json. Task 4 replaced that JSON
// fixture with a programmatic builder (tests/test-util/build-signet-auth-wrap.js)
// because the signet-app test-consumer harness is not available in
// headless CI. We follow the same approach here: build the wrap on
// the fly, then use cache._injectForTest to overwrite the auto-
// generated session keys with the builder's fixture values so the
// handler's session_pubkey lookup matches.
//
// Wire shape recap: wrap (kind 1059) -> seal (kind 13) -> rumor
// (kind 29999 whose content JSON-stringifies the AuthResponse). The
// recipient session pubkey appears in the wrap's `p` tag and is what
// the handler uses to look up the invite.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createInviteHandler } from '../server/invite-handler.js';
import { createInviteCache } from '../server/invite-cache.js';
import { buildSignetAuthWrap } from './test-util/build-signet-auth-wrap.js';

describe('createInviteHandler', () => {
  let cache;
  let onAccept;
  let handler;

  beforeEach(() => {
    cache = createInviteCache();
    onAccept = vi.fn();
    handler = createInviteHandler({ cache, onAccept });
  });

  /**
   * Mint an invite, then build a gift-wrap addressed to its session
   * pubkey. Returns { token, fixture } where fixture holds the wrap
   * and the persona/challenge expectations we want to assert against.
   */
  async function mintAndBuildWrap() {
    // 1. Generate a fresh session key (mirrors what mint would do)
    //    and a persona key (the "Signet user" responding to the QR).
    const sessionSk = generateSecretKey();
    const sessionPubkey = getPublicKey(sessionSk);
    const session_privkey = bytesToHex(sessionSk);
    const personaSk = generateSecretKey();
    const challenge = bytesToHex(generateSecretKey());

    // 2. Mint a real invite, then inject our keys + challenge so the
    //    cache's index maps point session_pubkey -> token.
    const { invite_token } = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    cache._injectForTest(invite_token, {
      session_privkey,
      session_pubkey: sessionPubkey,
      auth_challenge: challenge,
    });

    // 3. Build the matching gift-wrap.
    const built = await buildSignetAuthWrap({
      personaPrivkey: personaSk,
      sessionPubkey,
      challenge,
      displayName: 'Marcus',
    });

    return { token: invite_token, fixture: built };
  }

  it('valid wrap → cache.accept called + onAccept fired', async () => {
    const { token, fixture } = await mintAndBuildWrap();
    await handler(fixture.wrap);
    const rec = cache.getByToken(token);
    expect(rec.status).toBe('accepted');
    expect(rec.persona_pubkey).toBe(fixture.expected_persona_pubkey);
    expect(onAccept).toHaveBeenCalledTimes(1);
    const [tokenHashArg, resultArg] = onAccept.mock.calls[0];
    expect(typeof tokenHashArg).toBe('string');
    expect(resultArg).toEqual(expect.objectContaining({
      personaPubkey: fixture.expected_persona_pubkey,
    }));
  });

  it('wrap for unknown session pubkey → silently ignored', async () => {
    const { fixture } = await mintAndBuildWrap();
    const readdressed = { ...fixture.wrap, tags: [['p', 'ee'.repeat(32)]] };
    await handler(readdressed);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('invalid wrap → invite stays pending, no onAccept', async () => {
    const { token, fixture } = await mintAndBuildWrap();
    const garbage = { ...fixture.wrap, content: 'not-a-valid-cipher' };
    await handler(garbage);
    expect(cache.getByToken(token).status).toBe('pending');
    expect(onAccept).not.toHaveBeenCalled();
  });
});
