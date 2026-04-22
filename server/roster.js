// server/roster.js — Staff roster event parser and builder (kind 31920, NIP-ROSTER draft)

import { STAFF_ROSTER_KIND } from './chain/types.js';
import { isValidPubkey } from './chain/types.js';

const MAX_ROSTER_STAFF = 200;

/** Pre-2026-04-17 kind. Accepted by parser during transition window only. */
const LEGACY_STAFF_ROSTER_KIND = 39001;
const ACCEPTED_ROSTER_KINDS = new Set([STAFF_ROSTER_KIND, LEGACY_STAFF_ROSTER_KIND]);

/** Roles that may appear in a staff roster. */
export const VALID_STAFF_ROLES = [
  'gate_steward',
  'roaming_steward',
  'staff_manager',
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
 * Tag shape (positional, 0-indexed):
 *   [0] "p"
 *   [1] pubkey (hex64)
 *   [2] role (from VALID_STAFF_ROLES)
 *   [3] optional: display name OR the literal "external" flag (see §5.7)
 *   [4] optional: expires_at as Unix-seconds (numeric string). Non-numeric
 *       ignored (entry treated as no expiry — fails open to "permanent"
 *       rather than silently expired).
 *
 * @param {object} event  - A raw Nostr event object.
 * @returns {{ pubkey: string, role: string, displayName: string, expiresAt: number | null }[]}
 * @throws {Error} If the event fails kind or d-tag validation.
 */
export function parseRosterEvent(event) {
  if (!ACCEPTED_ROSTER_KINDS.has(event.kind)) {
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

    // Optional position-4 expires_at. Parse permissively: a numeric string
    // becomes a number; anything else (missing, "external" from a legacy
    // flag, garbage) becomes null = no expiry.
    let expiresAt = null;
    if (tag[4] !== undefined && tag[4] !== null) {
      const parsed = Number(tag[4]);
      if (Number.isFinite(parsed) && parsed > 0) {
        expiresAt = Math.floor(parsed);
      }
    }

    staff.push({ pubkey, role, displayName, expiresAt });
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
  const pTags = staff.map(({ pubkey, role, displayName, expiresAt }) => {
    const base = ['p', pubkey, role, displayName ?? ''];
    if (expiresAt != null && Number.isFinite(expiresAt) && expiresAt > 0) {
      base.push(String(Math.floor(expiresAt)));
    }
    return base;
  });

  return {
    kind: STAFF_ROSTER_KIND,
    tags: [['d', 'staff-roster'], ...pTags],
    content: '',
  };
}
