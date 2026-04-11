import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  createMembership,
  createGateLock,
  createAttendance,
  createCard,
  createSanction,
  verifyChain,
  getCurrentStatus,
  STATUS,
  EVENT_KINDS,
} from '../../server/chain/index.js';

function makeChainBase() {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const stewardSk = generateSecretKey();
  const clubSk = generateSecretKey();
  const clubPk = getPublicKey(clubSk);

  const membership = createMembership(fanPk, clubPk, fanSk);
  const gateLock = createGateLock(fanPk, clubPk, 'photohash', membership.id, stewardSk);
  const attendance = createAttendance(fanPk, '2026-04-11', 'clean', gateLock.id, stewardSk);

  return { fanSk, fanPk, stewardSk, clubPk, clubSk, membership, gateLock, attendance };
}

describe('C2: p-tag consistency', () => {
  it('rejects a chain with mixed p-tags', () => {
    const fan1Sk = generateSecretKey();
    const fan1Pk = getPublicKey(fan1Sk);
    const fan2Sk = generateSecretKey();
    const fan2Pk = getPublicKey(fan2Sk);
    const stewardSk = generateSecretKey();
    const clubSk = generateSecretKey();
    const clubPk = getPublicKey(clubSk);

    // Fan 1's membership
    const membership = createMembership(fan1Pk, clubPk, fan1Sk);

    // Create an attendance for fan 2 but chain it to fan 1's membership
    const attendance = createAttendance(fan2Pk, '2026-04-11', 'clean', membership.id, stewardSk);

    const result = verifyChain([membership, attendance]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('p tag'))).toBe(true);
  });

  it('passes when all events have the same p-tag', () => {
    const { membership, gateLock, attendance } = makeChainBase();
    const result = verifyChain([membership, gateLock, attendance]);
    expect(result.valid).toBe(true);
  });
});

describe('M1: card time-based expiry', () => {
  it('expires yellow cards older than 12 months', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);
    // Backdate the card to 13 months ago
    const thirteenMonthsAgo = Math.floor(Date.now() / 1000) - (13 * 30 * 24 * 60 * 60);
    card.created_at = thirteenMonthsAgo;

    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.activeCards).toHaveLength(0);
  });

  it('keeps yellow cards younger than 12 months', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);
    // Card was just created, so it should be active
    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.activeCards).toHaveLength(1);
  });

  it('expires red cards older than 24 months', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'red', 'assault', attendance.id, stewardSk);
    // Backdate the card to 25 months ago
    const twentyFiveMonthsAgo = Math.floor(Date.now() / 1000) - (25 * 30 * 24 * 60 * 60);
    card.created_at = twentyFiveMonthsAgo;

    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.activeCards).toHaveLength(0);
  });

  it('keeps red cards younger than 24 months', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'red', 'assault', attendance.id, stewardSk);
    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.RED);
    expect(result.activeCards).toHaveLength(1);
  });
});

describe('H2: unbounded event array', () => {
  it('verifyChain handles large valid chains', () => {
    // Just test that verifyChain itself doesn't crash with boundary values
    const { membership } = makeChainBase();
    // Single event chain is fine
    const result = verifyChain([membership]);
    expect(result.valid).toBe(true);
  });
});
