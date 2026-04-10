/**
 * Venue entry credential parser.
 *
 * Supports two QR formats:
 *   1. Signed kind 21235 Nostr event (from Signet app)
 *   2. Legacy JSON { pubkey, photo_hash } (transitional)
 *
 * The Nostr event format is verified: Schnorr signature + freshness check.
 * The legacy format is accepted without verification (no signature to check).
 */

import { isValidPhotoHash } from './utils.js';

const VENUE_ENTRY_KIND = 21235;
const MAX_AGE_SECONDS = 60;

/**
 * @typedef {Object} ParsedCredential
 * @property {string} pubkey      - Hex public key
 * @property {string|null} photo_hash  - SHA-256 photo hash (from 'x' tag or field)
 * @property {string|null} blossom_url - Blossom server URL (from 'blossom' tag)
 * @property {boolean} verified    - Whether signature was cryptographically verified
 * @property {'nostr'|'legacy'} format - Which format was parsed
 * @property {Object|null} raw_event - The full Nostr event (for server-side verification)
 */

/**
 * Parse and verify a venue entry QR code.
 *
 * @param {string} qrData - Raw string from QR scanner
 * @returns {Promise<ParsedCredential>}
 * @throws {Error} on invalid data, bad signature, or stale event
 */
export async function parseCredential(qrData) {
  let parsed;
  try {
    parsed = JSON.parse(qrData);
  } catch {
    throw new Error('Invalid QR code — not JSON');
  }

  if (parsed.kind === VENUE_ENTRY_KIND) {
    return parseNostrEvent(parsed);
  }

  // Legacy format: { pubkey, photo_hash }
  return parseLegacy(parsed);
}

/**
 * Parse a kind 21235 Nostr venue entry event.
 * Verifies Schnorr signature and checks freshness.
 */
async function parseNostrEvent(event) {
  // Validate required fields
  if (!event.pubkey || typeof event.pubkey !== 'string') {
    throw new Error('Missing pubkey in venue entry event');
  }
  if (!/^[0-9a-f]{64}$/.test(event.pubkey)) {
    throw new Error('Invalid pubkey format');
  }
  if (typeof event.created_at !== 'number') {
    throw new Error('Missing created_at timestamp');
  }
  if (!event.id || !event.sig) {
    throw new Error('Event not signed');
  }
  if (!Array.isArray(event.tags)) {
    throw new Error('Missing tags');
  }

  let clientVerified = true;

  // Check for signet-venue-entry tag
  const hasTypeTag = event.tags.some(
    t => Array.isArray(t) && t[0] === 't' && t[1] === 'signet-venue-entry'
  );
  if (!hasTypeTag) {
    throw new Error('Not a venue entry event');
  }

  // Freshness check
  const now = Math.floor(Date.now() / 1000);
  const age = now - event.created_at;
  if (age > MAX_AGE_SECONDS) {
    throw new Error(`QR expired — ${age}s old (max ${MAX_AGE_SECONDS}s)`);
  }
  if (age < -10) {
    throw new Error('QR timestamp is in the future');
  }

  // Attempt client-side signature verification (requires vendored nostr-tools)
  try {
    const { verifyEvent } = await import('/js/vendor/nostr-tools/pure.js');
    if (!verifyEvent(event)) {
      throw new Error('Invalid signature — QR may be forged');
    }
  } catch (e) {
    if (e.message.includes('signature')) throw e;
    // nostr-tools not available in browser — server will verify
    clientVerified = false;
  }

  // Extract photo hash from 'x' tag
  const xTag = event.tags.find(t => Array.isArray(t) && t[0] === 'x');
  const photoHash = xTag ? xTag[1] : null;

  if (photoHash && !isValidPhotoHash(photoHash)) {
    throw new Error('Invalid photo hash in event');
  }

  // Extract blossom URL from 'blossom' tag
  const blossomTag = event.tags.find(t => Array.isArray(t) && t[0] === 'blossom');
  const blossomUrl = blossomTag ? blossomTag[1] : null;

  return {
    pubkey: event.pubkey,
    photo_hash: photoHash,
    blossom_url: blossomUrl,
    verified: clientVerified,
    format: 'nostr',
    raw_event: event,
  };
}

/**
 * Parse legacy { pubkey, photo_hash } format.
 * No signature verification possible.
 */
function parseLegacy(obj) {
  if (!obj.pubkey || !obj.photo_hash) {
    throw new Error('Invalid credential — missing pubkey or photo_hash');
  }
  if (!isValidPhotoHash(obj.photo_hash)) {
    throw new Error('Invalid photo hash');
  }

  return {
    pubkey: obj.pubkey,
    photo_hash: obj.photo_hash,
    blossom_url: null,
    verified: false,
    format: 'legacy',
    raw_event: null,
  };
}
