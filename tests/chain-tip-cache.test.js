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

  it('stores createdAt for ordering', () => {
    const pubkey = 'a'.repeat(64);
    cache.set(pubkey, { tipEventId: 'b'.repeat(64), status: 0, createdAt: 1000 });
    expect(cache.get(pubkey).createdAt).toBe(1000);
  });

  it('defaults createdAt to 0 when omitted', () => {
    const pubkey = 'a'.repeat(64);
    cache.set(pubkey, { tipEventId: 'b'.repeat(64), status: 0 });
    expect(cache.get(pubkey).createdAt).toBe(0);
  });

  it('LRU eviction preserves RED and BANNED entries (ban-evasion defence)', () => {
    const small = new ChainTipCache(3);
    const bannedFan = 'b'.repeat(64);
    small.set(bannedFan, { tipEventId: '1'.repeat(64), status: 3 }); // BANNED
    small.set('c'.repeat(64), { tipEventId: '2'.repeat(64), status: 0 });
    small.set('d'.repeat(64), { tipEventId: '3'.repeat(64), status: 0 });
    // Overflow — must evict the oldest CLEAN entry, not the banned one.
    small.set('e'.repeat(64), { tipEventId: '4'.repeat(64), status: 0 });
    expect(small.get(bannedFan)).toBeDefined();
    expect(small.get(bannedFan).status).toBe(3);
    expect(small.get('c'.repeat(64))).toBeUndefined();
  });

  it('LRU eviction preserves RED entries too', () => {
    const small = new ChainTipCache(2);
    const redFan = 'f'.repeat(64);
    small.set(redFan, { tipEventId: '1'.repeat(64), status: 2 }); // RED
    small.set('a'.repeat(64), { tipEventId: '2'.repeat(64), status: 0 });
    small.set('b'.repeat(64), { tipEventId: '3'.repeat(64), status: 0 });
    expect(small.get(redFan)).toBeDefined();
    expect(small.get(redFan).status).toBe(2);
  });
});
