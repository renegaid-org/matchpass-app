// server/invite-cache.js — In-memory cache for staff QR invites
// Mints ephemeral session keypairs and tracks pending → accepted → consumed
// lifecycle for QR-based staff onboarding. Stateless, in-memory only:
// pending invites expire after 15 minutes; the cache is rebuilt from relay
// gift-wrap subscription on restart.

import { randomBytes } from 'crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

const PENDING_TTL_S = 15 * 60;

function hashToken(token) {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

function urlSafeRandomToken() {
  // 24 random bytes → 32-char URL-safe base64 (no padding)
  return randomBytes(24).toString('base64url');
}

export function createInviteCache({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  // token_hash → InviteRecord
  const byTokenHash = new Map();
  // auth_challenge → token_hash
  const byChallenge = new Map();
  // session_pubkey → token_hash
  const bySessionPubkey = new Map();

  function mint({ clubPubkey, inviterPubkey, role, displayName, staffExpiresAt }) {
    const token = urlSafeRandomToken();
    const tokenHash = hashToken(token);
    const authChallenge = bytesToHex(randomBytes(32));
    const sk = generateSecretKey();
    const session_privkey = bytesToHex(sk);
    sk.fill(0);
    const session_pubkey = getPublicKey(Buffer.from(session_privkey, 'hex'));

    const record = {
      club_pubkey: clubPubkey,
      inviter_pubkey: inviterPubkey,
      role,
      display_name: displayName,
      pending_expires_at: now() + PENDING_TTL_S,
      staff_expires_at: staffExpiresAt,
      status: 'pending',
      auth_challenge: authChallenge,
      session_pubkey,
      session_privkey,
    };
    byTokenHash.set(tokenHash, record);
    byChallenge.set(authChallenge, tokenHash);
    bySessionPubkey.set(session_pubkey, tokenHash);

    return {
      invite_token: token,
      session_pubkey,
      auth_challenge: authChallenge,
      pending_expires_at: record.pending_expires_at,
    };
  }

  function publicRecord(rec) {
    if (!rec) return null;
    const { session_privkey, ...rest } = rec;
    return rest;
  }

  return {
    mint,
    getByToken: (token) => publicRecord(byTokenHash.get(hashToken(token))),
    getByTokenWithSecrets: (token) => byTokenHash.get(hashToken(token)) ?? null,
    getByChallenge: (challenge) => {
      const h = byChallenge.get(challenge);
      return h ? publicRecord(byTokenHash.get(h)) : null;
    },
    getBySessionPubkey: (pubkey) => {
      const h = bySessionPubkey.get(pubkey);
      return h ? byTokenHash.get(h) : null;  // secrets-included; only callable from unwrap
    },
    activeSessionPubkeys: () => [...bySessionPubkey.keys()],
  };
}
