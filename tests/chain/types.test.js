// tests/chain/types.test.js

import { describe, it, expect } from 'vitest';
import { EVENT_KINDS, REVIEW_OUTCOMES, isValidReviewOutcome } from '../../server/chain/types.js';

describe('EVENT_KINDS', () => {
  it('REVIEW_OUTCOME equals 31105', () => {
    expect(EVENT_KINDS.REVIEW_OUTCOME).toBe(31105);
  });
});

describe('isValidReviewOutcome', () => {
  it('accepts "dismissed"', () => {
    expect(isValidReviewOutcome('dismissed')).toBe(true);
  });

  it('accepts "downgraded"', () => {
    expect(isValidReviewOutcome('downgraded')).toBe(true);
  });

  it('rejects "confirmed"', () => {
    expect(isValidReviewOutcome('confirmed')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidReviewOutcome('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidReviewOutcome(null)).toBe(false);
  });
});

describe('REVIEW_OUTCOMES', () => {
  it('contains exactly dismissed and downgraded', () => {
    expect(REVIEW_OUTCOMES).toEqual(['dismissed', 'downgraded']);
  });
});
