import { describe, it, expect, beforeEach } from 'vitest';
import { RosterCache } from '../server/roster-cache.js';

const clubPubkey = 'c'.repeat(64);
const staffPubkey = 'a'.repeat(64);
const rosterEvent = {
  id: 'r1', kind: 31920, pubkey: clubPubkey, created_at: 1000,
  tags: [['d', 'staff-roster'], ['p', staffPubkey, 'gate_steward', 'Alice']],
  content: '', sig: 'x'.repeat(128),
};

describe('RosterCache', () => {
  let cache;

  beforeEach(() => {
    cache = new RosterCache();
  });

  it('stores and retrieves a roster', () => {
    const accepted = cache.set(clubPubkey, rosterEvent);
    expect(accepted).toBe(true);

    const result = cache.get(clubPubkey);
    expect(result.rosterEvent.id).toBe('r1');
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0].role).toBe('gate_steward');
  });

  it('rejects stale roster (older created_at returns false, original kept)', () => {
    cache.set(clubPubkey, rosterEvent);

    const staleEvent = { ...rosterEvent, id: 'r0', created_at: 999 };
    const accepted = cache.set(clubPubkey, staleEvent);
    expect(accepted).toBe(false);

    // Original should still be stored
    expect(cache.get(clubPubkey).rosterEvent.id).toBe('r1');
  });

  it('findStaff locates a staff member by pubkey with correct role and clubPubkey', () => {
    cache.set(clubPubkey, rosterEvent);

    const found = cache.findStaff(staffPubkey);
    expect(found).not.toBeNull();
    expect(found.pubkey).toBe(staffPubkey);
    expect(found.role).toBe('gate_steward');
    expect(found.displayName).toBe('Alice');
    expect(found.clubPubkey).toBe(clubPubkey);
  });

  it('findStaff returns null for unknown pubkey', () => {
    cache.set(clubPubkey, rosterEvent);
    expect(cache.findStaff('f'.repeat(64))).toBeNull();
  });

  it('clubPubkeys returns array of known clubs', () => {
    expect(cache.clubPubkeys).toEqual([]);

    cache.set(clubPubkey, rosterEvent);
    expect(cache.clubPubkeys).toEqual([clubPubkey]);

    const secondClub = 'd'.repeat(64);
    const secondEvent = {
      ...rosterEvent,
      id: 'r2',
      pubkey: secondClub,
      tags: [['d', 'staff-roster'], ['p', 'e'.repeat(64), 'admin', 'Bob']],
    };
    cache.set(secondClub, secondEvent);
    expect(cache.clubPubkeys).toHaveLength(2);
    expect(cache.clubPubkeys).toContain(clubPubkey);
    expect(cache.clubPubkeys).toContain(secondClub);
  });
});
