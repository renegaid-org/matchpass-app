// tests/test-util/build-signet-auth-wrap.js
//
// Programmatic builder for a NIP-17 gift-wrapped Signet auth response.
// Mirrors signet-app/src/lib/relay-publish.ts (giftWrap +
// buildAuthResponseEventTemplate) on the wire so server/invite-unwrap.js
// can be tested without a live relay round-trip from signet-app's
// test-consumer (which is not available in headless CI).
//
// The construction MUST stay byte-compatible with relay-publish.ts —
// it is the contract this module is testing against. If signet-app
// changes the wire shape, this builder needs to follow.
//
// Construction (see relay-publish.ts):
//   1. signedAuthEvent: kind 21236 signed by personaPrivkey, with the
//      [['challenge', challenge]] tag and content '{}'.
//   2. authResponse: {type:'signet-auth-response', requestId, authEvent}.
//   3. rumor template: kind 29999 (the outer template returned by
//      buildAuthResponseEventTemplate), pubkey = personaPubkey, content =
//      JSON.stringify(authResponse). Compute id, no signature.
//   4. seal (kind 13): NIP-44 encrypts JSON.stringify(rumor) to recipient
//      (sessionPubkey) and is signed by the SAME personaPrivkey — this
//      is what makes the "authEvent.pubkey === seal.pubkey" check in the
//      unwrapper meaningful.
//   5. wrap (kind 1059): NIP-44 encrypts JSON.stringify(seal) to recipient
//      and is signed by a fresh EPHEMERAL key. Tag [['p', recipientPubkey]].
//
// created_at uses the ±2-day randomTimestamp pattern from relay-publish.ts
// (NIP-59 timing obfuscation) — fine for tests because the unwrap module
// does not check freshness; the cache layer does.

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { getConversationKey, encrypt as nip44Encrypt } from 'nostr-tools/nip44';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

const KIND_AUTH_EVENT_INNER = 21236;
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;
const KIND_AUTH_RESPONSE_TEMPLATE = 29999;

/** NIP-01 canonical event id (SHA-256 of the serialized array). */
function computeEventId(event) {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

/** ±2 days of now, per NIP-59 timing obfuscation. */
function randomTimestamp() {
  const twoDays = 2 * 24 * 60 * 60;
  const offset = Math.floor(Math.random() * twoDays * 2) - twoDays;
  return Math.floor(Date.now() / 1000) + offset;
}

/**
 * Build a valid NIP-17 gift-wrapped Signet auth response addressed to
 * `sessionPubkey`. Returns the wrap event plus the matching expectations
 * so tests can assert on the unwrap output directly.
 *
 * @param {object} args
 * @param {Uint8Array} args.personaPrivkey  32-byte secret key — signs both the
 *                                          inner kind-21236 and the kind-13 seal.
 * @param {string} args.sessionPubkey       64-hex recipient (matchpass invite session).
 * @param {string} args.challenge           64-hex auth challenge (== requestId).
 * @param {string} [args.displayName]       Optional persona handle.
 * @returns {Promise<{wrap, expected_persona_pubkey, expected_challenge, session_pubkey, display_name?}>}
 */
export async function buildSignetAuthWrap({ personaPrivkey, sessionPubkey, challenge, displayName }) {
  const personaPubkey = getPublicKey(personaPrivkey);

  // Step 1: signed inner kind-21236 (the cryptographic proof).
  const innerAuthTemplate = {
    kind: KIND_AUTH_EVENT_INNER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', challenge]],
    content: '{}',
  };
  const signedAuthEvent = finalizeEvent(innerAuthTemplate, personaPrivkey);

  // Step 2: AuthResponse wrapper.
  const authResponse = {
    type: 'signet-auth-response',
    requestId: challenge,
    authEvent: signedAuthEvent,
    ...(displayName ? { displayName } : {}),
  };

  // Step 3: rumor — buildAuthResponseEventTemplate shape (kind 29999),
  // pubkey == personaPubkey (signet-app passes backend.activePublicKeyHex
  // which is the persona's own pubkey for this flow).
  const rumorTemplate = {
    kind: KIND_AUTH_RESPONSE_TEMPLATE,
    pubkey: personaPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['session', authResponse.requestId],
      ['status', 'approved'],
    ],
    content: JSON.stringify(authResponse),
  };
  const rumor = { ...rumorTemplate, id: computeEventId(rumorTemplate) };

  // Step 4: seal — NIP-44 encrypt rumor JSON, sign with personaPrivkey.
  const sealConvKey = getConversationKey(personaPrivkey, sessionPubkey);
  const sealContent = nip44Encrypt(JSON.stringify(rumor), sealConvKey);
  const sealTemplate = {
    kind: KIND_SEAL,
    created_at: randomTimestamp(),
    tags: [],
    content: sealContent,
  };
  const seal = finalizeEvent(sealTemplate, personaPrivkey);

  // Step 5: wrap — NIP-44 encrypt seal JSON, sign with ephemeral key.
  const ephSk = generateSecretKey();
  try {
    const wrapConvKey = getConversationKey(ephSk, sessionPubkey);
    const wrapContent = nip44Encrypt(JSON.stringify(seal), wrapConvKey);
    const wrapTemplate = {
      kind: KIND_GIFT_WRAP,
      created_at: randomTimestamp(),
      tags: [['p', sessionPubkey]],
      content: wrapContent,
    };
    const wrap = finalizeEvent(wrapTemplate, ephSk);

    return {
      wrap,
      expected_persona_pubkey: personaPubkey,
      expected_challenge: challenge,
      session_pubkey: sessionPubkey,
      ...(displayName ? { display_name: displayName } : {}),
    };
  } finally {
    ephSk.fill(0);
  }
}
