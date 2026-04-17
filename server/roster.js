// server/roster.js — Staff roster event parser and builder (kind 31920, NIP-ROSTER draft)

import { STAFF_ROSTER_KIND } from './chain/types.js';
import { isValidPubkey } from './chain/types.js';

const MAX_ROSTER_STAFF = 200;

/** Roles that may appear in a staff roster. */
export const VALID_STAFF_ROLES = [
  'gate_steward',
  'roaming_steward',
  'safety_officer',
  'safeguarding_officer',
  'admin',
];

/**
 * Parse a kind-31920 staff roster Nostr event into a plain staff array.
 *
 * Validation rules:
 *   - event.kind must be 31920
 *   - tags must include a ['d', 'staff-roster'] entry
 *   - p-tags with an invalid pubkey (not 64 lowercase hex chars) are skipped
 *   - p-tags with an unrecognised role are skipped
 *
 * @param {object} event  - A raw Nostr event object.
 * @returns {{ pubkey: string, role: string, displayName: string }[]}
 * @throws {Error} If the event fails kind or d-tag validation.
 */
export function parseRosterEvent(event) {
  if (event.kind !== STAFF_ROSTER_KIND) {
    throw new Error('Invalid roster event kind');
  }

  const dTag = event.tags.find(([name, value]) => name === 'd' && value === 'staff-roster');
  if (!dTag) {
    throw new Error('Missing staff-roster d-tag');
  }

  const staff = [];

  for (const tag of event.tags) {
    if (tag[0] !== 'p') continue;
    if (staff.length >= MAX_ROSTER_STAFF) break;

    const [, pubkey, role] = tag;
    const displayName = (tag[3] || '').slice(0, 200).replace(/<[^>]*>/g, '');

    if (!isValidPubkey(pubkey)) continue;
    if (!VALID_STAFF_ROLES.includes(role)) continue;

    staff.push({ pubkey, role, displayName });
  }

  return staff;
}

/**
 * Build an unsigned kind-31920 roster event from a staff list.
 *
 * The returned object intentionally omits `id`, `sig`, and `created_at` so
 * callers can sign it with their preferred key-management layer.
 *
 * @param {{ pubkey: string, role: string, displayName: string }[]} staff
 * @returns {object} Unsigned Nostr event skeleton.
 */
export function buildRosterEvent(staff) {
  const pTags = staff.map(({ pubkey, role, displayName }) => [
    'p',
    pubkey,
    role,
    displayName ?? '',
  ]);

  return {
    kind: STAFF_ROSTER_KIND,
    tags: [['d', 'staff-roster'], ...pTags],
    content: '',
  };
}
