import { describe, it, expect } from 'vitest';
import { parseRosterEvent, buildRosterEvent, VALID_STAFF_ROLES } from '../server/roster.js';

const clubPubkey = 'c'.repeat(64);
const signerPubkey = 'a'.repeat(64);

function baseEvent(tags) {
  return {
    id: 'r1', kind: 31920, pubkey: clubPubkey, created_at: 1_000_000,
    tags, content: '', sig: 'x'.repeat(128),
  };
}

describe('VALID_STAFF_ROLES', () => {
  it('includes staff_manager (Phase 1 role vocab)', () => {
    expect(VALID_STAFF_ROLES).toContain('staff_manager');
    expect(VALID_STAFF_ROLES).toContain('gate_steward');
    expect(VALID_STAFF_ROLES).toContain('admin');
  });
});

describe('parseRosterEvent expires_at', () => {
  it('returns expiresAt = null when tag has no position-4 value', () => {
    const ev = baseEvent([
      ['d', 'staff-roster'],
      ['p', signerPubkey, 'gate_steward', 'Alice'],
    ]);
    const [member] = parseRosterEvent(ev);
    expect(member.expiresAt).toBeNull();
  });

  it('parses a numeric string at position 4 as expires_at', () => {
    const ts = 1_714_867_200;
    const ev = baseEvent([
      ['d', 'staff-roster'],
      ['p', signerPubkey, 'gate_steward', 'Alice', String(ts)],
    ]);
    const [member] = parseRosterEvent(ev);
    expect(member.expiresAt).toBe(ts);
  });

  it('fails open to null on non-numeric position-4 ("external" legacy, garbage)', () => {
    // "external" is the legacy flag at position 3 per §5.7, but if someone
    // puts garbage at position 4 we must not silently expire a permanent entry.
    const ev = baseEvent([
      ['d', 'staff-roster'],
      ['p', signerPubkey, 'safety_officer', 'External', 'external'],
    ]);
    const [member] = parseRosterEvent(ev);
    expect(member.expiresAt).toBeNull();
  });

  it('fails open to null on zero / negative position-4', () => {
    const ev = baseEvent([
      ['d', 'staff-roster'],
      ['p', signerPubkey, 'gate_steward', 'Alice', '0'],
      ['p', 'b'.repeat(64), 'gate_steward', 'Bob', '-1000'],
    ]);
    const members = parseRosterEvent(ev);
    expect(members[0].expiresAt).toBeNull();
    expect(members[1].expiresAt).toBeNull();
  });

  it('accepts staff_manager role', () => {
    const ev = baseEvent([
      ['d', 'staff-roster'],
      ['p', signerPubkey, 'staff_manager', 'Club Secretary'],
    ]);
    const [member] = parseRosterEvent(ev);
    expect(member.role).toBe('staff_manager');
  });
});

describe('buildRosterEvent round-trip with expires_at', () => {
  it('emits expires_at at position 4 when provided; omits when null', () => {
    const now = 1_714_867_200;
    const event = buildRosterEvent([
      { pubkey: 'a'.repeat(64), role: 'admin', displayName: 'Admin' },
      { pubkey: 'b'.repeat(64), role: 'gate_steward', displayName: 'Temp Bob', expiresAt: now + 3600 },
    ]);
    const pTags = event.tags.filter(t => t[0] === 'p');
    expect(pTags[0]).toEqual(['p', 'a'.repeat(64), 'admin', 'Admin']);
    expect(pTags[1]).toEqual(['p', 'b'.repeat(64), 'gate_steward', 'Temp Bob', String(now + 3600)]);
  });

  it('round-trips through parseRosterEvent', () => {
    const ts = 1_714_867_200;
    const built = buildRosterEvent([
      { pubkey: 'a'.repeat(64), role: 'admin', displayName: 'Admin' },
      { pubkey: 'b'.repeat(64), role: 'gate_steward', displayName: 'Temp', expiresAt: ts },
    ]);
    const roundtripEvent = { ...built, id: 'x', pubkey: 'c'.repeat(64), created_at: 1, sig: 'y'.repeat(128) };
    const members = parseRosterEvent(roundtripEvent);
    expect(members[0].expiresAt).toBeNull();
    expect(members[1].expiresAt).toBe(ts);
  });
});
