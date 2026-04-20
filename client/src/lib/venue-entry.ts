/**
 * Parse and verify kind 21235 venue entry events.
 *
 * Venue entry events are signed by the fan's Signet identity and contain
 * the pubkey, photo hash (x), Blossom URL (blossom), and photo decryption
 * key (photo_key). Signet regenerates them every 30 seconds.
 *
 * See credential-chain-spec.md §3 (superseded) + matchpass-gate design §3.
 */

import { verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent } from '../types';

export const VENUE_ENTRY_KIND = 21235;
export const MAX_AGE_SECONDS = 60;

export interface VenueEntry {
  pubkey: string;
  x?: string;
  blossom?: string;
  photoKey?: string;
  eventId: string;
  createdAt: number;
}

export class VenueEntryError extends Error {
  constructor(message: string, public readonly subState: string) {
    super(message);
    this.name = 'VenueEntryError';
  }
}

function getTag(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find(t => Array.isArray(t) && t[0] === name);
  return tag?.[1];
}

export function parseVenueEntry(raw: string): NostrEvent {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new VenueEntryError('QR is not a valid Nostr event', 'qr_not_venue_entry');
  }
  if (typeof event !== 'object' || event === null) {
    throw new VenueEntryError('QR is not a Nostr event', 'qr_not_venue_entry');
  }
  return event as NostrEvent;
}

/**
 * Verify a kind 21235 venue entry event locally.
 * Throws VenueEntryError on failure; returns parsed fields on success.
 */
export function verifyVenueEntry(event: NostrEvent): VenueEntry {
  if (event.kind !== VENUE_ENTRY_KIND) {
    throw new VenueEntryError('Not a venue entry QR', 'qr_not_venue_entry');
  }
  if (!event.pubkey || !/^[0-9a-f]{64}$/.test(event.pubkey)) {
    throw new VenueEntryError('Invalid pubkey in venue entry', 'qr_invalid_signature');
  }
  if (!Array.isArray(event.tags)) {
    throw new VenueEntryError('Malformed tags', 'qr_not_venue_entry');
  }

  const hasTypeTag = event.tags.some(
    t => Array.isArray(t) && t[0] === 't' && t[1] === 'signet-venue-entry',
  );
  if (!hasTypeTag) {
    throw new VenueEntryError('Wrong QR type', 'qr_not_venue_entry');
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - event.created_at;
  if (age > MAX_AGE_SECONDS) {
    throw new VenueEntryError('QR expired — ask fan to refresh', 'qr_expired');
  }
  if (age < -10) {
    throw new VenueEntryError('QR timestamp in the future', 'qr_future');
  }

  if (!verifyEvent(event)) {
    throw new VenueEntryError('Invalid signature', 'qr_invalid_signature');
  }

  // Validate optional fields before handing them to the caller: photoKey feeds
  // into hexToBytes/AES-GCM and blossom feeds into fetch(). A malicious QR
  // could otherwise set photo_key to a very long string and waste decode time,
  // or set blossom to javascript:// / file:// / http://internal/...
  const rawX = getTag(event, 'x');
  const rawBlossom = getTag(event, 'blossom');
  const rawPhotoKey = getTag(event, 'photo_key');
  const HEX64_RE = /^[0-9a-f]{64}$/i;
  if (rawX !== undefined && !HEX64_RE.test(rawX)) {
    throw new VenueEntryError('Malformed x tag', 'qr_invalid_signature');
  }
  if (rawPhotoKey !== undefined && !HEX64_RE.test(rawPhotoKey)) {
    throw new VenueEntryError('Malformed photo_key tag', 'qr_invalid_signature');
  }
  if (rawBlossom !== undefined) {
    if (typeof rawBlossom !== 'string' || rawBlossom.length > 512) {
      throw new VenueEntryError('Malformed blossom tag', 'qr_invalid_signature');
    }
    try {
      const u = new URL(rawBlossom);
      if (u.protocol !== 'https:') {
        throw new VenueEntryError('Blossom URL must be https', 'qr_invalid_signature');
      }
    } catch {
      throw new VenueEntryError('Malformed blossom tag', 'qr_invalid_signature');
    }
  }

  return {
    pubkey: event.pubkey,
    x: rawX,
    blossom: rawBlossom,
    photoKey: rawPhotoKey,
    eventId: event.id,
    createdAt: event.created_at,
  };
}
