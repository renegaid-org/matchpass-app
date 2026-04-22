import { describe, it, expect } from 'vitest';
import { EventAuthorCache } from '../../server/chain/event-author-cache.js';

describe('EventAuthorCache', () => {
  it('stores and retrieves an author', () => {
    const c = new EventAuthorCache();
    c.record('evt1', 'pub1');
    expect(c.getAuthor('evt1')).toBe('pub1');
  });

  it('returns null for unknown events', () => {
    const c = new EventAuthorCache();
    expect(c.getAuthor('unknown')).toBeNull();
  });

  it('rejects non-string arguments silently', () => {
    const c = new EventAuthorCache();
    c.record(null, 'pub');
    c.record('evt', undefined);
    c.record(123, 'pub');
    expect(c.size).toBe(0);
  });

  it('re-recording the same id updates the author and LRU position', () => {
    const c = new EventAuthorCache(3);
    c.record('a', 'authorA');
    c.record('b', 'authorB');
    c.record('c', 'authorC');
    // Re-record 'a' — should move it to end (most recent).
    c.record('a', 'authorA-v2');
    // Now insert 'd' — overflow should evict 'b' (oldest), not 'a' (refreshed).
    c.record('d', 'authorD');
    expect(c.getAuthor('a')).toBe('authorA-v2');
    expect(c.getAuthor('b')).toBeNull();
    expect(c.getAuthor('c')).toBe('authorC');
    expect(c.getAuthor('d')).toBe('authorD');
  });

  it('evicts the oldest entry when over capacity', () => {
    const c = new EventAuthorCache(2);
    c.record('a', 'A');
    c.record('b', 'B');
    c.record('c', 'C'); // evicts 'a'
    expect(c.getAuthor('a')).toBeNull();
    expect(c.getAuthor('b')).toBe('B');
    expect(c.getAuthor('c')).toBe('C');
    expect(c.size).toBe(2);
  });

  it('clear empties the cache', () => {
    const c = new EventAuthorCache();
    c.record('a', 'A');
    c.clear();
    expect(c.size).toBe(0);
    expect(c.getAuthor('a')).toBeNull();
  });
});
