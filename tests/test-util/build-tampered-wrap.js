// tests/test-util/build-tampered-wrap.js
//
// Take a valid gift-wrap (as produced by build-signet-auth-wrap.js, plus
// `session_privkey` so we can decrypt) and produce a tampered variant
// that the unwrap module should reject.
//
//   variant: 'seal-sig'        — re-encrypt seal content WITHOUT re-signing
//                                the seal. seal.sig is stale, so verifyEvent
//                                on the seal fails → 'seal-invalid'.
//
//   variant: 'pubkey-mismatch' — re-sign the seal with a fresh keypair so
//                                seal.sig verifies, but leave the inner
//                                authEvent.pubkey pointing at the original
//                                persona. The unwrapper's
//                                "authEvent.pubkey === seal.pubkey" guard
//                                then fires → 'authEvent-pubkey-mismatch-with-seal'.

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { getConversationKey, encrypt as nip44Encrypt, decrypt as nip44Decrypt } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';

const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;

function randomTimestamp() {
  const twoDays = 2 * 24 * 60 * 60;
  const offset = Math.floor(Math.random() * twoDays * 2) - twoDays;
  return Math.floor(Date.now() / 1000) + offset;
}

export async function buildTamperedWrap(fixture, variant) {
  const { wrap, session_privkey, session_pubkey } = fixture;
  if (!session_privkey) {
    throw new Error('buildTamperedWrap requires fixture.session_privkey');
  }
  const skBytes = hexToBytes(session_privkey);

  // Decrypt outer wrap → seal.
  const wrapCk = getConversationKey(skBytes, wrap.pubkey);
  const sealJson = nip44Decrypt(wrap.content, wrapCk);
  const seal = JSON.parse(sealJson);

  // Decrypt seal → rumor (kind 29999, AuthResponse JSON in content).
  const sealCk = getConversationKey(skBytes, seal.pubkey);
  const rumorJson = nip44Decrypt(seal.content, sealCk);
  const rumor = JSON.parse(rumorJson);

  if (variant === 'seal-sig') {
    // Re-encrypt the same rumor with the original seal conversation key,
    // then leave seal.sig untouched — content is fresh, so the canonical
    // hash changes and verifyEvent on the seal fails.
    const newSealContent = nip44Encrypt(JSON.stringify(rumor), sealCk);
    const tamperedSeal = { ...seal, content: newSealContent };
    return rewrapAroundSeal(tamperedSeal, wrap);
  }

  if (variant === 'pubkey-mismatch') {
    // Build a fresh keypair for the seal so its signature is valid but its
    // pubkey differs from the inner authEvent.pubkey. The seal must be
    // encrypted with this fresh key (so the recipient can still NIP-44
    // decrypt it via ECDH).
    const decoySk = generateSecretKey();
    try {
      const decoyPk = getPublicKey(decoySk);
      const decoySealCk = getConversationKey(decoySk, session_pubkey);
      // Rumor is left unchanged — authEvent.pubkey still references the
      // original persona, but seal.pubkey is now decoyPk → mismatch.
      const newSealContent = nip44Encrypt(JSON.stringify(rumor), decoySealCk);
      const newSealTemplate = {
        kind: KIND_SEAL,
        created_at: randomTimestamp(),
        tags: [],
        content: newSealContent,
      };
      const newSeal = finalizeEvent(newSealTemplate, decoySk);
      return rewrapAroundSeal(newSeal, wrap);
    } finally {
      decoySk.fill(0);
    }
  }

  throw new Error(`buildTamperedWrap: unknown variant ${variant}`);
}

/**
 * Re-encrypt the given seal under the existing wrap conversation key
 * and return a new wrap event signed by a fresh ephemeral key.
 * Reuses the original wrap's recipient tag.
 */
function rewrapAroundSeal(newSeal, originalWrap) {
  // We need to sign with a fresh ephemeral key for the wrap to remain
  // schnorr-valid. The recipient ('p' tag) is the session pubkey we read
  // off the original wrap's tags.
  const ephSk = generateSecretKey();
  try {
    const recipientPubkey = originalWrap.tags.find(t => t[0] === 'p')?.[1];
    if (!recipientPubkey) throw new Error('original wrap missing p-tag');
    const newWrapCk = getConversationKey(ephSk, recipientPubkey);
    const newWrapContent = nip44Encrypt(JSON.stringify(newSeal), newWrapCk);
    const newWrapTemplate = {
      kind: KIND_GIFT_WRAP,
      created_at: randomTimestamp(),
      tags: [['p', recipientPubkey]],
      content: newWrapContent,
    };
    return finalizeEvent(newWrapTemplate, ephSk);
  } finally {
    ephSk.fill(0);
  }
}
