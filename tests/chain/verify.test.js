// tests/chain/verify.test.js

import { describe, it, expect } from 'vitest';
import { getCurrentStatus, verifyChain, verifySignerAuthority } from '../../server/chain/verify.js';
import { EVENT_KINDS, STATUS } from '../../server/chain/types.js';

const fanPubkey = 'f'.repeat(64);

function mockEvent(kind, id, tags = [], createdAt = Math.floor(Date.now() / 1000)) {
  return { id, kind, created_at: createdAt, pubkey: 'a'.repeat(64), sig: 'b'.repeat(128), tags };
}

describe('getCurrentStatus — review outcomes', () => {
  it('dismissed card leaves status CLEAN with 0 active cards', () => {
    const cardId = 'c'.repeat(64);
    const reviewId = 'r'.repeat(64);

    const events = [
      mockEvent(EVENT_KINDS.CARD, cardId, [
        ['p', fanPubkey],
        ['card_type', 'yellow'],
        ['category', 'other'],
      ]),
      mockEvent(EVENT_KINDS.REVIEW_OUTCOME, reviewId, [
        ['p', fanPubkey],
        ['reviews', cardId],
        ['outcome', 'dismissed'],
      ]),
    ];

    const result = getCurrentStatus(events);

    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.statusName).toBe('clean');
    expect(result.activeCards).toHaveLength(0);
  });

  it('downgraded red card produces YELLOW status with cardType "yellow"', () => {
    const cardId = 'd'.repeat(64);
    const reviewId = 'e'.repeat(64);

    const events = [
      mockEvent(EVENT_KINDS.CARD, cardId, [
        ['p', fanPubkey],
        ['card_type', 'red'],
        ['category', 'assault'],
      ]),
      mockEvent(EVENT_KINDS.REVIEW_OUTCOME, reviewId, [
        ['p', fanPubkey],
        ['reviews', cardId],
        ['outcome', 'downgraded'],
      ]),
    ];

    const result = getCurrentStatus(events);

    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.statusName).toBe('yellow');
    expect(result.activeCards).toHaveLength(1);
    expect(result.activeCards[0].cardType).toBe('yellow');
  });

  it('chain with no review outcomes works as before (regression)', () => {
    const yellowId = '1'.repeat(64);
    const redId = '2'.repeat(64);

    const events = [
      mockEvent(EVENT_KINDS.CARD, yellowId, [
        ['p', fanPubkey],
        ['card_type', 'yellow'],
        ['category', 'missile'],
      ]),
      mockEvent(EVENT_KINDS.CARD, redId, [
        ['p', fanPubkey],
        ['card_type', 'red'],
        ['category', 'assault'],
      ]),
    ];

    const result = getCurrentStatus(events);

    expect(result.status).toBe(STATUS.RED);
    expect(result.statusName).toBe('red');
    expect(result.activeCards).toHaveLength(2);
  });

  it('verifySignerAuthority rejects staff_manager for every event kind', () => {
    // Phase 1: role exists in vocabulary but must not sign chain events.
    const mgrPubkey = '5'.repeat(64);
    const rosterEvent = {
      id: 'r1', kind: 31920, pubkey: 'c'.repeat(64), created_at: 1,
      tags: [
        ['d', 'staff-roster'],
        ['p', mgrPubkey, 'staff_manager', 'Club Secretary'],
      ],
      content: '', sig: 'x'.repeat(128),
    };
    const kindsToTry = [
      EVENT_KINDS.MEMBERSHIP, EVENT_KINDS.GATE_LOCK, EVENT_KINDS.ATTENDANCE,
      EVENT_KINDS.CARD, EVENT_KINDS.SANCTION, EVENT_KINDS.REVIEW_OUTCOME,
    ];
    for (const kind of kindsToTry) {
      const event = mockEvent(kind, '1'.repeat(64), [['p', fanPubkey]]);
      event.pubkey = mgrPubkey;
      const result = verifySignerAuthority(event, rosterEvent);
      expect(result.authorised).toBe(false);
      expect(result.reason).toMatch(/staff_manager/);
    }
  });

  it('verifyChain returns tip=null when events have invalid signatures', () => {
    // Mock events have fake signatures, so verifyEvent() fails for all of them.
    // Prior to the fix, tip was still populated; callers that ignored `valid`
    // would act on attacker-controlled data.
    const events = [
      mockEvent(EVENT_KINDS.MEMBERSHIP, 'a'.repeat(64), [['p', fanPubkey]]),
    ];
    events[0].pubkey = fanPubkey;
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.tip).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('dismissed red card leaves a yellow card as the only active card', () => {
    const yellowId = '3'.repeat(64);
    const redId = '4'.repeat(64);
    const reviewId = '5'.repeat(64);

    const events = [
      mockEvent(EVENT_KINDS.CARD, yellowId, [
        ['p', fanPubkey],
        ['card_type', 'yellow'],
        ['category', 'other'],
      ]),
      mockEvent(EVENT_KINDS.CARD, redId, [
        ['p', fanPubkey],
        ['card_type', 'red'],
        ['category', 'assault'],
      ]),
      mockEvent(EVENT_KINDS.REVIEW_OUTCOME, reviewId, [
        ['p', fanPubkey],
        ['reviews', redId],
        ['outcome', 'dismissed'],
      ]),
    ];

    const result = getCurrentStatus(events);

    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.activeCards).toHaveLength(1);
    expect(result.activeCards[0].cardType).toBe('yellow');
  });
});
