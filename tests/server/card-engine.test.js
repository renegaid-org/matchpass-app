import { describe, it, expect } from 'vitest';
import { computeFanStatus, shouldAutoRed, reviewDeadline, shouldExpireYellow, shouldExpireRed } from '../../server/card-engine.js';

describe('computeFanStatus', () => {
  it('returns green for fan with no cards and no sanctions', () => {
    const result = computeFanStatus({ cards: [], sanctions: [] });
    expect(result.colour).toBe('green');
    expect(result.yellowCount).toBe(0);
    expect(result.reason).toBeNull();
  });

  it('returns amber for fan with one active yellow', () => {
    const result = computeFanStatus({
      cards: [{ card_type: 'yellow', status: 'active' }],
      sanctions: [],
    });
    expect(result.colour).toBe('amber');
    expect(result.yellowCount).toBe(1);
  });

  it('returns red for fan with active ban', () => {
    const result = computeFanStatus({
      cards: [],
      sanctions: [{ sanction_type: 'ban', status: 'active', end_date: '2027-05-01' }],
    });
    expect(result.colour).toBe('red');
    expect(result.reason).toContain('Banned');
    expect(result.reason).toContain('2027-05-01');
  });

  it('returns red for fan with active suspension', () => {
    const result = computeFanStatus({
      cards: [],
      sanctions: [{ sanction_type: 'suspension', status: 'active', match_count: 3 }],
    });
    expect(result.colour).toBe('red');
    expect(result.reason).toContain('Suspended');
  });

  it('returns red for fan with active red card', () => {
    const result = computeFanStatus({
      cards: [{ card_type: 'red', status: 'active' }],
      sanctions: [],
    });
    expect(result.colour).toBe('red');
    expect(result.reason).toContain('review pending');
  });

  it('ignores expired and dismissed cards', () => {
    const result = computeFanStatus({
      cards: [
        { card_type: 'yellow', status: 'expired' },
        { card_type: 'red', status: 'dismissed' },
      ],
      sanctions: [],
    });
    expect(result.colour).toBe('green');
  });

  it('sanctions take priority over cards', () => {
    const result = computeFanStatus({
      cards: [{ card_type: 'yellow', status: 'active' }],
      sanctions: [{ sanction_type: 'ban', status: 'active', end_date: null }],
    });
    expect(result.colour).toBe('red');
    expect(result.reason).toBe('Banned');
  });
});

describe('shouldAutoRed', () => {
  it('returns true when 1 active yellow already exists (new yellow makes 2)', () => {
    const cards = [{ card_type: 'yellow', status: 'active' }];
    expect(shouldAutoRed(cards)).toBe(true);
  });

  it('returns true when 2+ active yellows exist', () => {
    const cards = [
      { card_type: 'yellow', status: 'active' },
      { card_type: 'yellow', status: 'active' },
    ];
    expect(shouldAutoRed(cards)).toBe(true);
  });

  it('returns false for no active yellows', () => {
    expect(shouldAutoRed([])).toBe(false);
  });

  it('ignores expired yellows', () => {
    const cards = [{ card_type: 'yellow', status: 'expired' }];
    expect(shouldAutoRed(cards)).toBe(false);
  });
});

describe('reviewDeadline', () => {
  it('returns 48 hours for yellow', () => {
    const now = new Date('2026-09-14T15:00:00Z');
    const deadline = reviewDeadline('yellow', now);
    expect(deadline.toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('returns 7 days for red', () => {
    const now = new Date('2026-09-14T15:00:00Z');
    const deadline = reviewDeadline('red', now);
    expect(deadline.toISOString()).toBe('2026-09-21T15:00:00.000Z');
  });
});

describe('shouldExpireYellow', () => {
  it('returns true at 5 clean matches', () => {
    expect(shouldExpireYellow({ card_type: 'yellow', clean_matches: 5 })).toBe(true);
  });

  it('returns false at 4 clean matches', () => {
    expect(shouldExpireYellow({ card_type: 'yellow', clean_matches: 4 })).toBe(false);
  });

  it('returns false for red cards', () => {
    expect(shouldExpireYellow({ card_type: 'red', clean_matches: 5 })).toBe(false);
  });
});

describe('shouldExpireRed', () => {
  it('returns true when confirmed and 10 clean matches', () => {
    expect(shouldExpireRed({ card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 10 })).toBe(true);
  });

  it('returns false when not yet reviewed', () => {
    expect(shouldExpireRed({ card_type: 'red', status: 'active', review_outcome: null, clean_matches: 10 })).toBe(false);
  });

  it('returns false when fewer than 10 clean matches', () => {
    expect(shouldExpireRed({ card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 9 })).toBe(false);
  });
});
