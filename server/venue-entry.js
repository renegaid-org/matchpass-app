import { verifyEvent } from 'nostr-tools/pure';
import { isValidPhotoHash, isValidPhotoKey } from './validation.js';

const VENUE_ENTRY_KIND = 21235;
const MAX_AGE_SECONDS = 60;

export function verifyVenueEntry(event, opts = {}) {
  if (!event || typeof event !== 'object') throw new Error('Invalid venue entry event');
  if (event.kind !== VENUE_ENTRY_KIND) throw new Error('Wrong event kind');
  if (!event.pubkey || !/^[0-9a-f]{64}$/.test(event.pubkey)) throw new Error('Missing or invalid pubkey');
  if (!Array.isArray(event.tags)) throw new Error('Missing tags');

  const hasTypeTag = event.tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === 'signet-venue-entry');
  if (!hasTypeTag) throw new Error('Not a venue entry event');

  const now = Math.floor(Date.now() / 1000);
  const age = now - event.created_at;
  if (age > MAX_AGE_SECONDS) throw new Error('QR expired');
  if (age < -10) throw new Error('QR timestamp in the future');

  if (!opts.skipSignatureCheck) {
    if (!verifyEvent(event)) throw new Error('Invalid signature');
  }

  const getTag = (name) => {
    const tag = event.tags.find(t => Array.isArray(t) && t[0] === name);
    return tag ? tag[1] : null;
  };

  const x = getTag('x');
  const blossom = getTag('blossom');
  const photoKey = getTag('photo_key');

  if (x && !isValidPhotoHash(x)) throw new Error('Invalid x tag (photo hash) format');
  if (photoKey && !isValidPhotoKey(photoKey)) throw new Error('Invalid photo_key format');

  return { pubkey: event.pubkey, x, blossom, photoKey };
}
