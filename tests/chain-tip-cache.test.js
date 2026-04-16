import { describe, it, expect, beforeEach } from 'vitest';
import { ChainTipCache } from '../server/chain-tip-cache.js';

describe('ChainTipCache', () => {
  let cache;

  beforeEach(() => {
    cache = new ChainTipCache();
  });

  it('stores and retrieves a tip', () => {
    const pubkey = 'a'.repeat(64);
    const tipEventId = 'b'.repeat(64);
    cache.set(pubkey, { tipEventId, status: 0 });

    const result = cache.get(pubkey);
    expect(result.tipEventId).toBe(tipEventId);
    expect(result.status).toBe(0);
    expect(result.lastSeen).toBeInstanceOf(Date);
  });

  it('returns undefined for unknown pubkey', () => {
    expect(cache.get('unknown')).toBeUndefined();
  });

  it('returns correct size', () => {
    expect(cache.size).toBe(0);
    cache.set('a'.repeat(64), { tipEventId: 'b'.repeat(64), status: 1 });
    expect(cache.size).toBe(1);
    cache.set('c'.repeat(64), { tipEventId: 'd'.repeat(64), status: 2 });
    expect(cache.size).toBe(2);
  });

  it('clear empties the cache', () => {
    cache.set('a'.repeat(64), { tipEventId: 'b'.repeat(64), status: 0 });
    cache.set('c'.repeat(64), { tipEventId: 'd'.repeat(64), status: 1 });
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a'.repeat(64))).toBeUndefined();
  });
});
