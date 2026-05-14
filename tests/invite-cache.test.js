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
