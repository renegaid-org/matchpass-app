import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  createMembership,
  createGateLock,
  createAttendance,
  createCard,
  createSanction,
  getCurrentStatus,
  STATUS,
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

  return { fanSk, fanPk, stewardSk, clubPk, membership, gateLock, attendance };
}

describe('getCurrentStatus', () => {
  it('returns CLEAN for a fan with no cards or sanctions', () => {
    const { membership, gateLock, attendance } = makeChainBase();
    const result = getCurrentStatus([membership, gateLock, attendance]);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.statusName).toBe('clean');
    expect(result.activeCards).toHaveLength(0);
    expect(result.activeSanctions).toHaveLength(0);
  });

  it('returns YELLOW for a fan with a yellow card', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);
    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.statusName).toBe('yellow');
    expect(result.activeCards).toHaveLength(1);
    expect(result.activeCards[0].cardType).toBe('yellow');
  });

  it('returns RED for a fan with a red card', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const card = createCard(fanPk, 'red', 'assault', attendance.id, stewardSk);
    const result = getCurrentStatus([membership, gateLock, attendance, card]);
    expect(result.status).toBe(STATUS.RED);
    expect(result.statusName).toBe('red');
  });

  it('red overrides yellow', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const yellow = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);
    const red = createCard(fanPk, 'red', 'assault', yellow.id, stewardSk);
    const result = getCurrentStatus([membership, gateLock, attendance, yellow, red]);
    expect(result.status).toBe(STATUS.RED);
    expect(result.activeCards).toHaveLength(2);
  });

  it('returns BANNED for a fan with an active ban', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const sanction = createSanction(
      fanPk, 'ban', 'Violent conduct', '2026-01-01', 'indefinite', attendance.id, stewardSk
    );
    const result = getCurrentStatus([membership, gateLock, attendance, sanction]);
    expect(result.status).toBe(STATUS.BANNED);
    expect(result.statusName).toBe('banned');
    expect(result.activeSanctions).toHaveLength(1);
  });

  it('ban overrides everything', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const red = createCard(fanPk, 'red', 'assault', attendance.id, stewardSk);
    const ban = createSanction(
      fanPk, 'ban', 'Repeated violence', '2026-01-01', 'indefinite', red.id, stewardSk
    );
    const result = getCurrentStatus([membership, gateLock, attendance, red, ban]);
    expect(result.status).toBe(STATUS.BANNED);
  });

  it('returns RED for an active suspension', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const sanction = createSanction(
      fanPk, 'suspension', 'Throwing objects', '2026-01-01', '2026-12-31', attendance.id, stewardSk
    );
    const result = getCurrentStatus([membership, gateLock, attendance, sanction]);
    expect(result.status).toBe(STATUS.RED);
    expect(result.activeSanctions).toHaveLength(1);
  });

  it('ignores expired sanctions', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    // Sanction that ended in the past
    const sanction = createSanction(
      fanPk, 'suspension', 'Minor incident', '2025-01-01', '2025-06-01', attendance.id, stewardSk
    );
    const result = getCurrentStatus([membership, gateLock, attendance, sanction]);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.activeSanctions).toHaveLength(0);
  });

  it('ignores future sanctions (not yet started)', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const sanction = createSanction(
      fanPk, 'suspension', 'Scheduled', '2027-01-01', '2027-06-01', attendance.id, stewardSk
    );
    const result = getCurrentStatus([membership, gateLock, attendance, sanction]);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.activeSanctions).toHaveLength(0);
  });

  it('handles a chain with membership only', () => {
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const clubPk = getPublicKey(generateSecretKey());
    const membership = createMembership(fanPk, clubPk, fanSk);

    const result = getCurrentStatus([membership]);
    expect(result.status).toBe(STATUS.CLEAN);
  });

  it('accumulates multiple cards', () => {
    const { stewardSk, fanPk, membership, gateLock, attendance } = makeChainBase();
    const y1 = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);
    const y2 = createCard(fanPk, 'yellow', 'missile', y1.id, stewardSk);
    const result = getCurrentStatus([membership, gateLock, attendance, y1, y2]);
    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.activeCards).toHaveLength(2);
  });
});
