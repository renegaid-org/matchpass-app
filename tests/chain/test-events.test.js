import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import {
  createMembership,
  createGateLock,
  createAttendance,
  createCard,
  createSanction,
  EVENT_KINDS,
} from '../../server/chain/index.js';

function getTagValue(event, name) {
  const tag = event.tags.find(t => t[0] === name);
  return tag ? tag[1] : null;
}

describe('createMembership', () => {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const clubSk = generateSecretKey();
  const clubPk = getPublicKey(clubSk);

  it('creates a valid kind 31100 event', () => {
    const event = createMembership(fanPk, clubPk, fanSk);
    expect(event.kind).toBe(EVENT_KINDS.MEMBERSHIP);
    expect(event.pubkey).toBe(fanPk);
    expect(verifyEvent(event)).toBe(true);
  });

  it('has correct d-tag format', () => {
    const event = createMembership(fanPk, clubPk, fanSk);
    expect(getTagValue(event, 'd')).toBe(`${fanPk}:membership`);
  });

  it('includes p tag with fan pubkey', () => {
    const event = createMembership(fanPk, clubPk, fanSk);
    expect(getTagValue(event, 'p')).toBe(fanPk);
  });

  it('includes club tag', () => {
    const event = createMembership(fanPk, clubPk, fanSk);
    expect(getTagValue(event, 'club')).toBe(clubPk);
  });

  it('rejects invalid fan pubkey', () => {
    expect(() => createMembership('bad', clubPk, fanSk)).toThrow('Invalid fan pubkey');
  });

  it('rejects invalid club pubkey', () => {
    expect(() => createMembership(fanPk, 'bad', fanSk)).toThrow('Invalid club pubkey');
  });
});

describe('createGateLock', () => {
  const stewardSk = generateSecretKey();
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const clubSk = generateSecretKey();
  const clubPk = getPublicKey(clubSk);

  it('creates a valid kind 31101 event', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createGateLock(fanPk, clubPk, 'abc123hash', membership.id, stewardSk);
    expect(event.kind).toBe(EVENT_KINDS.GATE_LOCK);
    expect(verifyEvent(event)).toBe(true);
  });

  it('references the previous event via previous tag', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createGateLock(fanPk, clubPk, 'abc123hash', membership.id, stewardSk);
    expect(getTagValue(event, 'previous')).toBe(membership.id);
  });

  it('includes photo_hash tag', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createGateLock(fanPk, clubPk, 'abc123hash', membership.id, stewardSk);
    expect(getTagValue(event, 'photo_hash')).toBe('abc123hash');
  });

  it('has a unique d-tag with season date', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createGateLock(fanPk, clubPk, 'abc123hash', membership.id, stewardSk);
    const dTag = getTagValue(event, 'd');
    expect(dTag).toMatch(new RegExp(`^${fanPk}:gatelock:\\d{4}-\\d{2}-\\d{2}$`));
  });
});

describe('createAttendance', () => {
  const stewardSk = generateSecretKey();
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const clubPk = getPublicKey(generateSecretKey());

  it('creates a valid kind 31102 event', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createAttendance(fanPk, '2026-04-11', 'clean', membership.id, stewardSk);
    expect(event.kind).toBe(EVENT_KINDS.ATTENDANCE);
    expect(verifyEvent(event)).toBe(true);
  });

  it('has correct d-tag with match date', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createAttendance(fanPk, '2026-04-11', 'clean', membership.id, stewardSk);
    expect(getTagValue(event, 'd')).toBe(`${fanPk}:attendance:2026-04-11`);
  });

  it('includes match_date and result tags', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createAttendance(fanPk, '2026-04-11', 'yellow', membership.id, stewardSk);
    expect(getTagValue(event, 'match_date')).toBe('2026-04-11');
    expect(getTagValue(event, 'result')).toBe('yellow');
  });

  it('rejects invalid result', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    expect(() => createAttendance(fanPk, '2026-04-11', 'blue', membership.id, stewardSk))
      .toThrow('Invalid result');
  });
});

describe('createCard', () => {
  const stewardSk = generateSecretKey();
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const clubPk = getPublicKey(generateSecretKey());

  it('creates a valid kind 31103 event', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createCard(fanPk, 'yellow', 'intoxication', membership.id, stewardSk);
    expect(event.kind).toBe(EVENT_KINDS.CARD);
    expect(verifyEvent(event)).toBe(true);
  });

  it('has a unique d-tag with UUID', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createCard(fanPk, 'red', 'assault', membership.id, stewardSk);
    const dTag = getTagValue(event, 'd');
    expect(dTag).toMatch(new RegExp(`^${fanPk}:card:[0-9a-f-]{36}$`));
  });

  it('includes card_type and category tags', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createCard(fanPk, 'yellow', 'missile', membership.id, stewardSk);
    expect(getTagValue(event, 'card_type')).toBe('yellow');
    expect(getTagValue(event, 'category')).toBe('missile');
  });

  it('d-tags are unique across multiple cards', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const card1 = createCard(fanPk, 'yellow', 'intoxication', membership.id, stewardSk);
    const card2 = createCard(fanPk, 'yellow', 'intoxication', card1.id, stewardSk);
    expect(getTagValue(card1, 'd')).not.toBe(getTagValue(card2, 'd'));
  });

  it('rejects invalid card type', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    expect(() => createCard(fanPk, 'green', 'assault', membership.id, stewardSk))
      .toThrow('Invalid card type');
  });

  it('rejects invalid category', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    expect(() => createCard(fanPk, 'yellow', 'dancing', membership.id, stewardSk))
      .toThrow('Invalid category');
  });
});

describe('createSanction', () => {
  const stewardSk = generateSecretKey();
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const clubPk = getPublicKey(generateSecretKey());

  it('creates a valid kind 31104 event', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createSanction(
      fanPk, 'ban', 'Violent conduct', '2026-04-11', 'indefinite', membership.id, stewardSk
    );
    expect(event.kind).toBe(EVENT_KINDS.SANCTION);
    expect(verifyEvent(event)).toBe(true);
  });

  it('has a unique d-tag with UUID', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createSanction(
      fanPk, 'suspension', 'Throwing objects', '2026-04-11', '2026-05-11', membership.id, stewardSk
    );
    const dTag = getTagValue(event, 'd');
    expect(dTag).toMatch(new RegExp(`^${fanPk}:sanction:[0-9a-f-]{36}$`));
  });

  it('includes all sanction tags', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const event = createSanction(
      fanPk, 'ban', 'Racial abuse', '2026-04-11', 'indefinite', membership.id, stewardSk
    );
    expect(getTagValue(event, 'sanction_type')).toBe('ban');
    expect(getTagValue(event, 'reason')).toBe('Racial abuse');
    expect(getTagValue(event, 'start_date')).toBe('2026-04-11');
    expect(getTagValue(event, 'end_date')).toBe('indefinite');
  });

  it('rejects invalid sanction type', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    expect(() => createSanction(
      fanPk, 'warning', 'Bad behaviour', '2026-04-11', '2026-05-11', membership.id, stewardSk
    )).toThrow('Invalid sanction type');
  });
});

describe('chain linking', () => {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const stewardSk = generateSecretKey();
  const clubPk = getPublicKey(generateSecretKey());

  it('builds a chain where each event references the previous', () => {
    const membership = createMembership(fanPk, clubPk, fanSk);
    const gateLock = createGateLock(fanPk, clubPk, 'photo123', membership.id, stewardSk);
    const attendance = createAttendance(fanPk, '2026-04-11', 'clean', gateLock.id, stewardSk);
    const card = createCard(fanPk, 'yellow', 'intoxication', attendance.id, stewardSk);

    expect(getTagValue(gateLock, 'previous')).toBe(membership.id);
    expect(getTagValue(attendance, 'previous')).toBe(gateLock.id);
    expect(getTagValue(card, 'previous')).toBe(attendance.id);
  });
});
