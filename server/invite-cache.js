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

  function accept(token, personaPubkey) {
    const rec = byTokenHash.get(hashToken(token));
    if (!rec) throw new Error('invite not found');
    if (rec.status !== 'pending') throw new Error('invite not pending');
    if (now() > rec.pending_expires_at) throw new Error('invite expired');
    rec.status = 'accepted';
    rec.persona_pubkey = personaPubkey;
    rec.accepted_at = now();
  }

  function consume(token, rosterEventId) {
    const rec = byTokenHash.get(hashToken(token));
    if (!rec) throw new Error('invite not found');
    if (rec.status !== 'accepted') throw new Error('invite not accepted');
    rec.status = 'consumed';
    rec.roster_event_id = rosterEventId;
    rec.session_privkey = '00'.repeat(32);  // wipe
    byChallenge.delete(rec.auth_challenge);
    bySessionPubkey.delete(rec.session_pubkey);
  }

  function cancel(token) {
    const tokenHash = hashToken(token);
    const rec = byTokenHash.get(tokenHash);
    if (!rec) return;
    rec.session_privkey = '00'.repeat(32);
    byTokenHash.delete(tokenHash);
    byChallenge.delete(rec.auth_challenge);
    bySessionPubkey.delete(rec.session_pubkey);
  }

  function pruneExpired() {
    const t = now();
    for (const [hash, rec] of byTokenHash) {
      if (rec.status === 'pending' && t > rec.pending_expires_at) {
        rec.session_privkey = '00'.repeat(32);
        byTokenHash.delete(hash);
        byChallenge.delete(rec.auth_challenge);
        bySessionPubkey.delete(rec.session_pubkey);
      }
    }
  }

  function clearAll() {
    for (const rec of byTokenHash.values()) {
      rec.session_privkey = '00'.repeat(32);
    }
    byTokenHash.clear();
    byChallenge.clear();
    bySessionPubkey.clear();
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
    accept,
    consume,
    cancel,
    pruneExpired,
    clearAll,
  };
}
