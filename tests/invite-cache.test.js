import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInviteCache } from '../server/invite-cache.js';

describe('inviteCache.mint', () => {
  let cache;
  beforeEach(() => {
    cache = createInviteCache({ now: () => 1747200000 });
  });

  it('mints a 192-bit URL-safe token with the requested role', () => {
    const result = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
      displayName: 'Marcus',
    });
    expect(result.invite_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.session_pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.pending_expires_at).toBe(1747200000 + 15 * 60);
  });

  it('looks up by token and returns the record without exposing privkey by default', () => {
    const { invite_token } = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    const record = cache.getByToken(invite_token);
    expect(record.status).toBe('pending');
    expect(record.role).toBe('gate_steward');
    expect(record.session_privkey).toBeUndefined();
  });

  it('exposes session_privkey via getByTokenWithSecrets only', () => {
    const { invite_token } = cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
    const record = cache.getByTokenWithSecrets(invite_token);
    expect(record.session_privkey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('inviteCache transitions', () => {
  let now;
  let cache;
  beforeEach(() => {
    now = 1747200000;
    cache = createInviteCache({ now: () => now });
  });

  function mintOne() {
    return cache.mint({
      clubPubkey: 'aa'.repeat(32),
      inviterPubkey: 'bb'.repeat(32),
      role: 'gate_steward',
    });
  }

  it('accept(): pending → accepted, records persona_pubkey and accepted_at', () => {
    const { invite_token } = mintOne();
    cache.accept(invite_token, 'cc'.repeat(32));
    const rec = cache.getByToken(invite_token);
    expect(rec.status).toBe('accepted');
    expect(rec.persona_pubkey).toBe('cc'.repeat(32));
    expect(rec.accepted_at).toBe(1747200000);
  });

  it('accept(): refuses if not pending', () => {
    const { invite_token } = mintOne();
    cache.accept(invite_token, 'cc'.repeat(32));
    expect(() => cache.accept(invite_token, 'cc'.repeat(32))).toThrow(/not pending/);
  });

  it('consume(): accepted → consumed, zeros session_privkey, drops index entries', () => {
    const { invite_token, session_pubkey } = mintOne();
    cache.accept(invite_token, 'cc'.repeat(32));
    cache.consume(invite_token, 'roster_event_id_42');
    const rec = cache.getByToken(invite_token);
    expect(rec.status).toBe('consumed');
    expect(rec.roster_event_id).toBe('roster_event_id_42');
    const withSecrets = cache.getByTokenWithSecrets(invite_token);
    expect(withSecrets.session_privkey).toBe('00'.repeat(32));
    expect(cache.getBySessionPubkey(session_pubkey)).toBeNull();
  });

  it('cancel(): removes invite entirely, zeros privkey', () => {
    const { invite_token, session_pubkey } = mintOne();
    cache.cancel(invite_token);
    expect(cache.getByToken(invite_token)).toBeNull();
    expect(cache.getBySessionPubkey(session_pubkey)).toBeNull();
  });

  it('pruneExpired(): drops pending invites past pending_expires_at; leaves accepted alone', () => {
    const a = mintOne();
    const b = mintOne();
    cache.accept(b.invite_token, 'cc'.repeat(32));
    now += 15 * 60 + 1;  // 15 minutes + 1 second
    cache.pruneExpired();
    expect(cache.getByToken(a.invite_token)).toBeNull();
    expect(cache.getByToken(b.invite_token)?.status).toBe('accepted');
  });

  it('clearAll(): empty after midnight clear', () => {
    mintOne();
    cache.clearAll();
    expect(cache.activeSessionPubkeys()).toHaveLength(0);
  });
});

describe('inviteCache.checkAuthority', () => {
  let cache;
  beforeEach(() => { cache = createInviteCache(); });

  it('admin can invite any role with any expires_at', () => {
    expect(() => cache.checkAuthority({ inviterRole: 'admin', invitedRole: 'safety_officer' })).not.toThrow();
    expect(() => cache.checkAuthority({ inviterRole: 'admin', invitedRole: 'admin' })).not.toThrow();
  });

  it('staff_manager can only invite gate_steward', () => {
    expect(() => cache.checkAuthority({
      inviterRole: 'staff_manager',
      invitedRole: 'gate_steward',
      staffExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    })).not.toThrow();
    expect(() => cache.checkAuthority({
      inviterRole: 'staff_manager',
      invitedRole: 'roaming_steward',
      staffExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    })).toThrow(/staff_manager can only invite gate_steward/);
  });

  it('staff_manager requires staffExpiresAt ≤ now + 86400', () => {
    const tooFar = Math.floor(Date.now() / 1000) + 86401;
    expect(() => cache.checkAuthority({
      inviterRole: 'staff_manager',
      invitedRole: 'gate_steward',
      staffExpiresAt: tooFar,
    })).toThrow(/within 24 hours/);
  });

  it('staff_manager rejects missing staffExpiresAt', () => {
    expect(() => cache.checkAuthority({
      inviterRole: 'staff_manager',
      invitedRole: 'gate_steward',
    })).toThrow(/staffExpiresAt required/);
  });

  it('other roles cannot invite at all', () => {
    expect(() => cache.checkAuthority({ inviterRole: 'gate_steward', invitedRole: 'gate_steward' })).toThrow(/cannot invite/);
    expect(() => cache.checkAuthority({ inviterRole: 'safety_officer', invitedRole: 'gate_steward' })).toThrow(/cannot invite/);
  });
});
