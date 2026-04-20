import { describe, it, expect } from 'vitest';
import { verifyVenueEntry, VenueEntryError } from './venue-entry';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

function buildVenueEntry(opts: {
  secret?: Uint8Array;
  blossom?: string;
  photoKey?: string;
  x?: string;
  createdAt?: number;
} = {}) {
  const sk = opts.secret ?? generateSecretKey();
  const pk = getPublicKey(sk);
  const tags: string[][] = [
    ['t', 'signet-venue-entry'],
    ['p', pk],
  ];
  if (opts.blossom !== undefined) tags.push(['blossom', opts.blossom]);
  if (opts.photoKey !== undefined) tags.push(['photo_key', opts.photoKey]);
  if (opts.x !== undefined) tags.push(['x', opts.x]);
  return finalizeEvent(
    {
      kind: 21235,
      content: '',
      tags,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    },
    sk,
  );
}

describe('verifyVenueEntry input validation', () => {
  it('accepts a well-formed entry with valid https Blossom and 64-hex photo_key', () => {
    const photoKey = 'a'.repeat(64);
    const x = 'b'.repeat(64);
    const event = buildVenueEntry({
      blossom: 'https://blossom.matchpass.club',
      photoKey,
      x,
    });
    const out = verifyVenueEntry(event);
    expect(out.photoKey).toBe(photoKey);
    expect(out.x).toBe(x);
  });

  it('rejects non-hex photo_key', () => {
    const event = buildVenueEntry({ photoKey: 'notreallyhex' });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });

  it('rejects oversized photo_key', () => {
    const event = buildVenueEntry({ photoKey: 'a'.repeat(5000) });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });

  it('rejects non-hex x', () => {
    const event = buildVenueEntry({ x: 'not-a-hash' });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });

  it('rejects javascript: blossom URL', () => {
    const event = buildVenueEntry({ blossom: 'javascript:alert(1)' });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });

  it('rejects http:// blossom URL', () => {
    const event = buildVenueEntry({ blossom: 'http://blossom.matchpass.club' });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });

  it('rejects enormous blossom tag (length cap)', () => {
    const event = buildVenueEntry({ blossom: 'https://a.com/' + 'x'.repeat(600) });
    expect(() => verifyVenueEntry(event)).toThrow(VenueEntryError);
  });
});
