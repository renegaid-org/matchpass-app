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
const TWENTY_FOUR_HOURS = 24 * 60 * 60;

function hashToken(token) {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

function urlSafeRandomToken() {
  // 24 random bytes → 32-char URL-safe base64 (no padding)
  return randomBytes(24).toString('base64url');
}

export function checkAuthority({ inviterRole, invitedRole, staffExpiresAt, now = Math.floor(Date.now() / 1000) }) {
  if (inviterRole === 'admin') return;
  if (inviterRole === 'staff_manager') {
    if (invitedRole !== 'gate_steward') {
      throw new Error('staff_manager can only invite gate_steward');
    }
    if (staffExpiresAt == null) {
      throw new Error('staffExpiresAt required when inviter is staff_manager');
    }
    if (staffExpiresAt > now + TWENTY_FOUR_HOURS) {
      throw new Error('staff_manager invites must expire within 24 hours');
    }
    return;
  }
  throw new Error(`role ${inviterRole} cannot invite`);
}

export function createInviteCache({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  // token_hash → InviteRecord
  const byTokenHash = new Map();
  // auth_challenge → token_hash
  const byChallenge = new Map();
  // session_pubkey → token_hash
  const bySessionPubkey = new Map();

  // Event bus for SSE fanout. Listeners receive (tokenHash, payload) tuples
  // for accepted / consumed / expired transitions. Cache stays the single
  // source of truth — the route layer just filters and forwards.
  const _listeners = new Set();
  function emit(tokenHash, payload) {
    for (const l of _listeners) {
      try { l(tokenHash, payload); } catch (e) { console.error(e); }
    }
  }

  function mint({ clubPubkey, inviterPubkey, role, displayName, staffExpiresAt }) {
    const token = urlSafeRandomToken();
    const tokenHash = hashToken(token);
    const authChallenge = bytesToHex(randomBytes(32));
    const sk = generateSecretKey();
    // Derive the pubkey from the live `sk` buffer BEFORE we hex-encode and
    // wipe — otherwise we'd materialise a second, unwiped copy of the key
    // material in the hex-decoded Buffer just to call getPublicKey on it.
    const session_pubkey = getPublicKey(sk);
    const session_privkey = bytesToHex(sk);
    sk.fill(0);

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
    const tokenHash = hashToken(token);
    const rec = byTokenHash.get(tokenHash);
    if (!rec) throw new Error('invite not found');
    if (rec.status !== 'accepted') throw new Error('invite not accepted');
    rec.status = 'consumed';
    rec.roster_event_id = rosterEventId;
    rec.session_privkey = '00'.repeat(32);  // wipe
    byChallenge.delete(rec.auth_challenge);
    bySessionPubkey.delete(rec.session_pubkey);
    emit(tokenHash, { type: 'consumed', roster_event_id: rosterEventId });
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
        // Emit before deletion so listeners still see a valid hash mapping.
        emit(hash, { type: 'expired' });
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

  // Snapshot of accepted invites for a club. Returns a fresh array so the
  // caller can iterate without worrying about concurrent state-transitions
  // (e.g. consumeByTokenHash) mutating the underlying byTokenHash map.
  function acceptedInvitesForClub(clubPubkey) {
    const out = [];
    for (const [hash, rec] of byTokenHash) {
      if (rec.status === 'accepted' && rec.club_pubkey === clubPubkey) {
        out.push({ token_hash: hash, persona_pubkey: rec.persona_pubkey });
      }
    }
    return out;
  }

  // Same semantics as consume() but works from a token hash. Used by the
  // /api/gate/event roster-publish hook, which only knows hashes (the
  // plaintext invite token isn't available at consume time).
  function consumeByTokenHash(tokenHash, rosterEventId) {
    const rec = byTokenHash.get(tokenHash);
    if (!rec) throw new Error('invite not found');
    if (rec.status !== 'accepted') throw new Error('invite not accepted');
    rec.status = 'consumed';
    rec.roster_event_id = rosterEventId;
    rec.session_privkey = '00'.repeat(32);  // wipe
    byChallenge.delete(rec.auth_challenge);
    bySessionPubkey.delete(rec.session_pubkey);
    emit(tokenHash, { type: 'consumed', roster_event_id: rosterEventId });
  }

  // Public summary used by /api/gate/invites/accepted (Task 15). Returns a
  // plain object — never the live record — so callers can't mutate cache
  // state. Includes token_hash so the caller can correlate with SSE events.
  function detailByTokenHash(tokenHash) {
    const rec = byTokenHash.get(tokenHash);
    if (!rec) return null;
    return {
      token_hash: tokenHash,
      club_pubkey: rec.club_pubkey,
      role: rec.role,
      display_name: rec.display_name,
      persona_pubkey: rec.persona_pubkey,
      accepted_at: rec.accepted_at,
      staff_expires_at: rec.staff_expires_at,
      status: rec.status,
    };
  }

  function acceptBySessionPubkey(sessionPubkey, personaPubkey) {
    const tokenHash = bySessionPubkey.get(sessionPubkey);
    if (!tokenHash) return null;
    const rec = byTokenHash.get(tokenHash);
    if (!rec) return null;
    if (rec.status !== 'pending') throw new Error('invite not pending');
    if (now() > rec.pending_expires_at) throw new Error('invite expired');
    rec.status = 'accepted';
    rec.persona_pubkey = personaPubkey;
    rec.accepted_at = now();
    emit(tokenHash, {
      type: 'accepted',
      persona_pubkey: personaPubkey,
      accepted_at: rec.accepted_at,
      display_name: rec.display_name,
    });
    return tokenHash;  // identifier for SSE fanout
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
    acceptBySessionPubkey,
    consume,
    consumeByTokenHash,
    acceptedInvitesForClub,
    detailByTokenHash,
    cancel,
    pruneExpired,
    clearAll,
    checkAuthority,
    onEvent(listener) {
      _listeners.add(listener);
      return () => _listeners.delete(listener);
    },
    _emitForTest: emit,
    // Test-only: overwrite the auto-generated session keys / challenge with
    // fixture values so cryptographic fixtures built outside the cache can be
    // exercised against it. Atomically updates the bySessionPubkey and
    // byChallenge index maps so lookups continue to work after the swap.
    _injectForTest(token, partial) {
      const rec = byTokenHash.get(hashToken(token));
      if (!rec) return;
      if (partial.session_pubkey && partial.session_pubkey !== rec.session_pubkey) {
        bySessionPubkey.delete(rec.session_pubkey);
        bySessionPubkey.set(partial.session_pubkey, hashToken(token));
      }
      if (partial.auth_challenge && partial.auth_challenge !== rec.auth_challenge) {
        byChallenge.delete(rec.auth_challenge);
        byChallenge.set(partial.auth_challenge, hashToken(token));
      }
      Object.assign(rec, partial);
    },
  };
}
