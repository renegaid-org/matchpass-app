import { describe, it, expect } from 'vitest';
import { verifyVenueEntry } from '../server/venue-entry.js';

describe('verifyVenueEntry', () => {
  const now = Math.floor(Date.now() / 1000);

  function makeEvent(overrides = {}) {
    return {
      kind: 21235, pubkey: 'a'.repeat(64), created_at: now,
      tags: [
        ['t', 'signet-venue-entry'],
        ['x', 'b'.repeat(64)],
        ['blossom', 'https://blossom.example.com'],
        ['photo_key', 'c'.repeat(64)],
      ],
      content: '', id: 'd'.repeat(64), sig: 'e'.repeat(128),
      ...overrides,
    };
  }

  it('rejects wrong kind', () => {
    expect(() => verifyVenueEntry(makeEvent({ kind: 1 }), { skipSignatureCheck: true })).toThrow('Wrong event kind');
  });

  it('rejects missing t tag', () => {
    const event = makeEvent();
    event.tags = event.tags.filter(t => t[0] !== 't');
    expect(() => verifyVenueEntry(event, { skipSignatureCheck: true })).toThrow('Not a venue entry');
  });

  it('rejects expired event (>60s)', () => {
    expect(() => verifyVenueEntry(makeEvent({ created_at: now - 90 }), { skipSignatureCheck: true })).toThrow('QR expired');
  });

  it('rejects future event (>10s ahead)', () => {
    expect(() => verifyVenueEntry(makeEvent({ created_at: now + 20 }), { skipSignatureCheck: true })).toThrow('future');
  });

  it('rejects invalid pubkey', () => {
    expect(() => verifyVenueEntry(makeEvent({ pubkey: 'bad' }), { skipSignatureCheck: true })).toThrow('invalid pubkey');
  });

  it('rejects null/undefined event', () => {
    expect(() => verifyVenueEntry(null)).toThrow('Invalid venue entry');
  });

  it('extracts fields from valid event', () => {
    const result = verifyVenueEntry(makeEvent(), { skipSignatureCheck: true });
    expect(result.pubkey).toBe('a'.repeat(64));
    expect(result.x).toBe('b'.repeat(64));
    expect(result.blossom).toBe('https://blossom.example.com');
    expect(result.photoKey).toBe('c'.repeat(64));
  });

  it('handles missing optional tags', () => {
    const event = makeEvent();
    event.tags = [['t', 'signet-venue-entry']]; // no x, blossom, photo_key
    const result = verifyVenueEntry(event, { skipSignatureCheck: true });
    expect(result.x).toBeNull();
    expect(result.blossom).toBeNull();
    expect(result.photoKey).toBeNull();
  });
});
