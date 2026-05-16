// server/invite-unwrap.js — NIP-17 gift-wrap unwrapper for Signet
// relay-mode auth responses.
//
// Wire shape (mirrors signet-app/src/lib/relay-publish.ts giftWrap +
// signet-protocol buildAuthResponseEventTemplate):
//
//   wrap   = kind 1059, encrypted to recipient (session) by an ephemeral
//            key, tag [['p', recipientPubkey]]
//   seal   = kind 13, decrypted from wrap.content; signed by the persona
//            and NIP-44-encrypts the rumor JSON to recipient
//   rumor  = kind 29999 nostr event (UNSIGNED — only id is computed),
//            content = JSON.stringify(authResponse)
//   authResponse = { type: 'signet-auth-response', requestId, authEvent,
//                    displayName? }
//   authEvent    = kind 21236, signed by persona, with [['challenge', …]]
//
// The function returns { ok, error?, personaPubkey?, challenge?, displayName? }.
// Failure modes are returned (not thrown) so the caller can log uniformly —
// tampered wraps, wraps not addressed to us, and stale challenges are all
// expected outcomes in production traffic.

import { verifyEvent } from 'nostr-tools/pure';
import { getConversationKey, decrypt as nip44Decrypt } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';

const KIND_GIFT_WRAP = 1059;
const KIND_SEAL = 13;
const KIND_AUTH_RESPONSE_OUTER = 29999;
const KIND_AUTH_EVENT_INNER = 21236;

export async function unwrapAuthResponse({ wrap, sessionPrivkey, expectedChallenge }) {
  // Challenge verification is a load-bearing security check — refuse to run
  // without one rather than silently letting any inner challenge through.
  if (!expectedChallenge) {
    return { ok: false, error: 'expected-challenge-missing' };
  }
  if (!wrap || wrap.kind !== KIND_GIFT_WRAP) {
    return { ok: false, error: 'wrong-kind' };
  }

  const skBytes = hexToBytes(sessionPrivkey);

  // Step 1: decrypt outer wrap → seal
  let seal;
  try {
    const wrapCk = getConversationKey(skBytes, wrap.pubkey);
    const sealJson = nip44Decrypt(wrap.content, wrapCk);
    seal = JSON.parse(sealJson);
  } catch (err) {
    return { ok: false, error: `wrap-decrypt-failed: ${err.message}` };
  }

  // Step 2: verify seal signature
  if (!seal || seal.kind !== KIND_SEAL || !verifyEvent(seal)) {
    return { ok: false, error: 'seal-invalid' };
  }

  // Step 3: decrypt seal → rumor (kind 29999 nostr event template)
  let rumor;
  try {
    const sealCk = getConversationKey(skBytes, seal.pubkey);
    const rumorJson = nip44Decrypt(seal.content, sealCk);
    rumor = JSON.parse(rumorJson);
  } catch (err) {
    return { ok: false, error: `seal-decrypt-failed: ${err.message}` };
  }

  if (!rumor || rumor.kind !== KIND_AUTH_RESPONSE_OUTER) {
    return { ok: false, error: 'rumor-wrong-kind' };
  }

  // Step 4: parse the rumor's content as an AuthResponse
  let authResponse;
  try {
    authResponse = JSON.parse(rumor.content);
  } catch (err) {
    return { ok: false, error: `rumor-content-parse-failed: ${err.message}` };
  }
  if (!authResponse || authResponse.type !== 'signet-auth-response') {
    return { ok: false, error: 'rumor-not-auth-response' };
  }

  const inner = authResponse.authEvent;
  if (!inner || inner.kind !== KIND_AUTH_EVENT_INNER) {
    return { ok: false, error: 'inner-wrong-kind' };
  }

  // Step 5: verify inner authEvent signature
  if (!verifyEvent(inner)) {
    return { ok: false, error: 'inner-sig-invalid' };
  }

  // Step 6: assert authEvent.pubkey === seal.pubkey (no mix-and-match)
  if (inner.pubkey !== seal.pubkey) {
    return { ok: false, error: 'authEvent-pubkey-mismatch-with-seal' };
  }

  // Step 7: check the challenge tag
  const challengeTag = inner.tags?.find(t => Array.isArray(t) && t[0] === 'challenge')?.[1];
  if (!challengeTag) {
    return { ok: false, error: 'challenge-tag-missing' };
  }
  if (challengeTag !== expectedChallenge) {
    return { ok: false, error: 'challenge-mismatch' };
  }

  return {
    ok: true,
    personaPubkey: inner.pubkey,
    challenge: challengeTag,
    displayName: authResponse.displayName,
  };
}
