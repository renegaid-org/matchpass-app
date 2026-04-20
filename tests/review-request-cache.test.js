import { describe, it, expect, beforeEach } from 'vitest';
import { ReviewRequestCache } from '../server/review-request-cache.js';

function makeRequest(id, clubPubkey, createdAt = 1700000000) {
  return {
    id,
    pubkey: 'f'.repeat(64),
    kind: 31910,
    created_at: createdAt,
    tags: [
      ['p', 'a'.repeat(64)],
      ['reviews', 'b'.repeat(64)],
      ['club', clubPubkey],
    ],
    content: '',
    sig: '0'.repeat(128),
  };
}

describe('ReviewRequestCache', () => {
  let cache;
  beforeEach(() => {
    cache = new ReviewRequestCache();
  });

  it('stores and retrieves by id', () => {
    const e = makeRequest('1'.repeat(64), 'c'.repeat(64));
    expect(cache.set(e)).toBe(true);
    expect(cache.get('1'.repeat(64))).toEqual(e);
  });

  it('ignores duplicates', () => {
    const e = makeRequest('1'.repeat(64), 'c'.repeat(64));
    expect(cache.set(e)).toBe(true);
    expect(cache.set(e)).toBe(false);
    expect(cache.size).toBe(1);
  });

  it('list filters by clubPubkey and sorts newest first', () => {
    const clubA = 'a'.repeat(64);
    const clubB = 'b'.repeat(64);
    cache.set(makeRequest('1'.repeat(64), clubA, 1000));
    cache.set(makeRequest('2'.repeat(64), clubB, 2000));
    cache.set(makeRequest('3'.repeat(64), clubA, 3000));

    const forA = cache.list({ clubPubkey: clubA });
    expect(forA).toHaveLength(2);
    expect(forA[0].created_at).toBe(3000);
    expect(forA[1].created_at).toBe(1000);

    expect(cache.list({ clubPubkey: clubB })).toHaveLength(1);
    expect(cache.list()).toHaveLength(3);
  });

  it('evicts oldest when over capacity', () => {
    const small = new ReviewRequestCache(2);
    small.set(makeRequest('1'.repeat(64), 'c'.repeat(64), 1000));
    small.set(makeRequest('2'.repeat(64), 'c'.repeat(64), 2000));
    small.set(makeRequest('3'.repeat(64), 'c'.repeat(64), 3000));
    expect(small.size).toBe(2);
    expect(small.has('1'.repeat(64))).toBe(false);
    expect(small.has('3'.repeat(64))).toBe(true);
  });

  it('remove drops an entry', () => {
    const e = makeRequest('1'.repeat(64), 'c'.repeat(64));
    cache.set(e);
    expect(cache.remove('1'.repeat(64))).toBe(true);
    expect(cache.size).toBe(0);
  });
});
