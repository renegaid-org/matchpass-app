// tests/invite-unwrap.test.js
//
// Tests for server/invite-unwrap.js — the NIP-17 gift-wrap unwrapper for
// Signet relay-mode auth responses.
//
// The plan originally specified a JSON "golden fixture" captured from
// signet-app's test-consumer (port 5175). That harness is not available in
// the headless plan-execution context, so we use the documented fallback:
// build the fixture programmatically using nostr-tools primitives via
// tests/test-util/build-signet-auth-wrap.js, which mirrors
// signet-app/src/lib/relay-publish.ts giftWrap exactly.

import { describe, it, expect, beforeAll } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { unwrapAuthResponse } from '../server/invite-unwrap.js';
import { buildSignetAuthWrap } from './test-util/build-signet-auth-wrap.js';
import { buildTamperedWrap } from './test-util/build-tampered-wrap.js';

describe('unwrapAuthResponse', () => {
  let fixture;

  beforeAll(async () => {
    // Deterministic-ish test fixture: keys are random per run, but the
    // wire shape is invariant. We freeze the object so accidental writes
    // in one test cannot bleed into another.
    const personaSk = generateSecretKey();
    const sessionSk = generateSecretKey();
    const personaPubkey = getPublicKey(personaSk);
    const sessionPubkey = getPublicKey(sessionSk);
    const challenge = bytesToHex(generateSecretKey()); // 64-hex; reuses CSPRNG path

    const built = await buildSignetAuthWrap({
      personaPrivkey: personaSk,
      sessionPubkey,
      challenge,
      displayName: 'Marcus',
    });

    fixture = Object.freeze({
      ...built,
      session_privkey: bytesToHex(sessionSk),
      persona_privkey: bytesToHex(personaSk),
    });
    // (sanity — wire shape we expect to hand to the unwrapper)
    expect(fixture.wrap.kind).toBe(1059);
    expect(fixture.expected_persona_pubkey).toBe(personaPubkey);
  });

  it('unwraps a valid gift-wrap and returns persona_pubkey + challenge', async () => {
    const result = await unwrapAuthResponse({
      wrap: fixture.wrap,
      sessionPrivkey: fixture.session_privkey,
      expectedChallenge: fixture.expected_challenge,
    });
    expect(result.ok).toBe(true);
    expect(result.personaPubkey).toBe(fixture.expected_persona_pubkey);
    expect(result.challenge).toBe(fixture.expected_challenge);
    expect(result.displayName).toBe('Marcus');
  });

  it('rejects when the seal signature is tampered', async () => {
    const tampered = await buildTamperedWrap(fixture, 'seal-sig');
    const result = await unwrapAuthResponse({
      wrap: tampered,
      sessionPrivkey: fixture.session_privkey,
      expectedChallenge: fixture.expected_challenge,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/seal/);
  });

  it('rejects when authEvent.pubkey !== seal.pubkey', async () => {
    const tampered = await buildTamperedWrap(fixture, 'pubkey-mismatch');
    const result = await unwrapAuthResponse({
      wrap: tampered,
      sessionPrivkey: fixture.session_privkey,
      expectedChallenge: fixture.expected_challenge,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pubkey/);
  });

  it('rejects when inner challenge does not match expected', async () => {
    const result = await unwrapAuthResponse({
      wrap: fixture.wrap,
      sessionPrivkey: fixture.session_privkey,
      expectedChallenge: 'ff'.repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/challenge/);
  });

  it('rejects when decrypted with the wrong session_privkey', async () => {
    const result = await unwrapAuthResponse({
      wrap: fixture.wrap,
      sessionPrivkey: '11'.repeat(32),
      expectedChallenge: fixture.expected_challenge,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/decrypt/);
  });
});
