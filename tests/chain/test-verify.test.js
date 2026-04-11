import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  createMembership,
  createGateLock,
  createAttendance,
  createCard,
  createSanction,
  verifyChain,
  verifySignerAuthority,
  EVENT_KINDS,
} from '../../server/chain/index.js';

function buildChain() {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const stewardSk = generateSecretKey();
  const stewardPk = getPublicKey(stewardSk);
  const clubSk = generateSecretKey();
  const clubPk = getPublicKey(clubSk);

  const membership = createMembership(fanPk, clubPk, fanSk);
  const gateLock = createGateLock(fanPk, clubPk, 'photohash', membership.id, stewardSk);
  const attendance = createAttendance(fanPk, '2026-04-11', 'clean', gateLock.id, stewardSk);

  return {
    events: [membership, gateLock, attendance],
    fanSk, fanPk, stewardSk, stewardPk, clubSk, clubPk,
  };
}

describe('verifyChain', () => {
  it('validates a correct chain', () => {
    const { events } = buildChain();
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.tip).toBe(events[2].id);
  });

  it('rejects an empty events array', () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Empty');
  });

  it('rejects a broken chain (missing event in the middle)', () => {
    const { events } = buildChain();
    // Remove the middle event — event[2] references event[1] which is now missing
    const broken = [events[0], events[2]];
    const result = verifyChain(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does not match'))).toBe(true);
  });

  it('rejects a tampered chain (wrong previous tag)', () => {
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const stewardSk = generateSecretKey();
    const clubPk = getPublicKey(generateSecretKey());

    const membership = createMembership(fanPk, clubPk, fanSk);
    // Create an attendance referencing a bogus event ID instead of membership
    const bogusId = 'a'.repeat(64);
    const attendance = createAttendance(fanPk, '2026-04-11', 'clean', bogusId, stewardSk);

    const result = verifyChain([membership, attendance]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does not match'))).toBe(true);
  });

  it('rejects a chain where the first event is not membership', () => {
    const stewardSk = generateSecretKey();
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const clubPk = getPublicKey(generateSecretKey());

    const membership = createMembership(fanPk, clubPk, fanSk);
    const attendance = createAttendance(fanPk, '2026-04-11', 'clean', membership.id, stewardSk);

    // Put attendance first
    const result = verifyChain([attendance]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('membership'))).toBe(true);
  });

  it('detects an event with an invalid signature', () => {
    const { events } = buildChain();
    // Corrupt the signature; JSON round-trip strips the verifiedSymbol cache
    const tampered = JSON.parse(JSON.stringify({ ...events[1], sig: 'f'.repeat(128) }));
    const result = verifyChain([events[0], tampered, events[2]]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid signature'))).toBe(true);
  });
});

describe('verifySignerAuthority', () => {
  it('authorises a steward listed in the staff roster', () => {
    const { events, stewardPk, clubSk, clubPk } = buildChain();
    const rosterEvent = {
      kind: 31000,
      pubkey: clubPk,
      tags: [
        ['d', 'staff-roster'],
        ['p', stewardPk, 'gate_steward'],
      ],
    };

    const result = verifySignerAuthority(events[1], rosterEvent);
    expect(result.authorised).toBe(true);
    expect(result.role).toBe('gate_steward');
  });

  it('rejects a signer not in the staff roster', () => {
    const { events, clubPk } = buildChain();
    const rosterEvent = {
      kind: 31000,
      pubkey: clubPk,
      tags: [
        ['d', 'staff-roster'],
        ['p', 'b'.repeat(64), 'gate_steward'],
      ],
    };

    const result = verifySignerAuthority(events[1], rosterEvent);
    expect(result.authorised).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('rejects a gate_steward signing a sanction', () => {
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const stewardSk = generateSecretKey();
    const stewardPk = getPublicKey(stewardSk);
    const clubPk = getPublicKey(generateSecretKey());

    const membership = createMembership(fanPk, clubPk, fanSk);
    const sanction = createSanction(
      fanPk, 'ban', 'Violence', '2026-04-11', 'indefinite', membership.id, stewardSk
    );

    const rosterEvent = {
      kind: 31000,
      pubkey: clubPk,
      tags: [
        ['d', 'staff-roster'],
        ['p', stewardPk, 'gate_steward'],
      ],
    };

    const result = verifySignerAuthority(sanction, rosterEvent);
    expect(result.authorised).toBe(false);
    expect(result.reason).toContain('insufficient');
  });

  it('allows a safety_officer to sign a sanction', () => {
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const officerSk = generateSecretKey();
    const officerPk = getPublicKey(officerSk);
    const clubPk = getPublicKey(generateSecretKey());

    const membership = createMembership(fanPk, clubPk, fanSk);
    const sanction = createSanction(
      fanPk, 'suspension', 'Throwing objects', '2026-04-11', '2026-05-11', membership.id, officerSk
    );

    const rosterEvent = {
      kind: 31000,
      pubkey: clubPk,
      tags: [
        ['d', 'staff-roster'],
        ['p', officerPk, 'safety_officer'],
      ],
    };

    const result = verifySignerAuthority(sanction, rosterEvent);
    expect(result.authorised).toBe(true);
    expect(result.role).toBe('safety_officer');
  });

  it('returns not authorised when no roster provided', () => {
    const { events } = buildChain();
    const result = verifySignerAuthority(events[1], null);
    expect(result.authorised).toBe(false);
  });
});
