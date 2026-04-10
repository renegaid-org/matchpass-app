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

describe('shouldAutoRed (rolling 12-month window)', () => {
  const now = new Date('2026-09-14T15:00:00Z');

  it('returns true when 1 recent active yellow exists', () => {
    const cards = [{ card_type: 'yellow', status: 'active', created_at: '2026-06-01T00:00:00Z' }];
    expect(shouldAutoRed(cards, now)).toBe(true);
  });

  it('returns false for no active yellows', () => {
    expect(shouldAutoRed([], now)).toBe(false);
  });

  it('ignores expired yellows', () => {
    const cards = [{ card_type: 'yellow', status: 'expired', created_at: '2026-06-01T00:00:00Z' }];
    expect(shouldAutoRed(cards, now)).toBe(false);
  });

  it('ignores yellows older than 12 months', () => {
    const cards = [{ card_type: 'yellow', status: 'active', created_at: '2025-01-01T00:00:00Z' }];
    expect(shouldAutoRed(cards, now)).toBe(false);
  });

  it('counts yellows from exactly 12 months ago', () => {
    const cards = [{ card_type: 'yellow', status: 'active', created_at: '2025-09-14T15:00:00Z' }];
    expect(shouldAutoRed(cards, now)).toBe(true);
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

describe('shouldExpireYellow (Option D — whichever comes last)', () => {
  // Card created 4 months ago with 5 clean matches → both conditions met
  it('expires when 5 clean matches AND 3+ months old', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 5, created_at: '2026-05-01T00:00:00Z' };
    expect(shouldExpireYellow(card, now)).toBe(true);
  });

  // 5 clean matches but only 2 months old → time floor not met
  it('does not expire with 5 clean matches but under 3 months old', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 5, created_at: '2026-08-01T00:00:00Z' };
    expect(shouldExpireYellow(card, now)).toBe(false);
  });

  // 3 months old but only 4 clean matches → match threshold not met
  it('does not expire at 3 months with only 4 clean matches', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 4, created_at: '2026-06-01T00:00:00Z' };
    expect(shouldExpireYellow(card, now)).toBe(false);
  });

  // Hard ceiling: 12 months old regardless of clean matches
  it('expires at 12-month ceiling regardless of clean matches', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 0, created_at: '2025-09-01T00:00:00Z' };
    expect(shouldExpireYellow(card, now)).toBe(true);
  });

  // Challenge freezes the clock
  it('does not expire while challenged (no review yet)', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 10, created_at: '2026-01-01T00:00:00Z', challenge_at: '2026-09-10T00:00:00Z', reviewed_at: null };
    expect(shouldExpireYellow(card, now)).toBe(false);
  });

  // Challenge resolved — clock resumes
  it('expires after challenge is resolved', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'yellow', status: 'active', clean_matches: 5, created_at: '2026-05-01T00:00:00Z', challenge_at: '2026-05-02T00:00:00Z', reviewed_at: '2026-05-05T00:00:00Z' };
    expect(shouldExpireYellow(card, now)).toBe(true);
  });

  it('returns false for red cards', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    expect(shouldExpireYellow({ card_type: 'red', status: 'active', clean_matches: 10, created_at: '2025-01-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('shouldExpireRed (Option D — whichever comes last)', () => {
  // Confirmed + 10 clean + 7 months old → both conditions met
  it('expires when confirmed, 10 clean matches, AND 6+ months old', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 10, created_at: '2026-02-01T00:00:00Z' };
    expect(shouldExpireRed(card, now)).toBe(true);
  });

  // 10 clean but only 4 months old → time floor not met
  it('does not expire with 10 clean matches but under 6 months old', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 10, created_at: '2026-06-01T00:00:00Z' };
    expect(shouldExpireRed(card, now)).toBe(false);
  });

  // 6 months old but only 9 clean → match threshold not met
  it('does not expire at 6 months with only 9 clean matches', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 9, created_at: '2026-03-01T00:00:00Z' };
    expect(shouldExpireRed(card, now)).toBe(false);
  });

  // Not yet reviewed → does not expire
  it('does not expire when not yet reviewed', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: null, clean_matches: 10, created_at: '2026-01-01T00:00:00Z' };
    expect(shouldExpireRed(card, now)).toBe(false);
  });

  // Hard ceiling: 24 months regardless
  it('expires at 24-month ceiling regardless of clean matches or review', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: null, clean_matches: 0, created_at: '2024-09-01T00:00:00Z' };
    expect(shouldExpireRed(card, now)).toBe(true);
  });

  // Challenge freezes the clock
  it('does not expire while challenged', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const card = { card_type: 'red', status: 'active', review_outcome: 'confirmed', clean_matches: 10, created_at: '2026-01-01T00:00:00Z', challenge_at: '2026-09-10T00:00:00Z', reviewed_at: null };
    expect(shouldExpireRed(card, now)).toBe(false);
  });
});
