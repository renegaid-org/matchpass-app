/**
 * Validate that a string looks like a valid pubkey.
 * Accepts hex (64 chars) or npub1 bech32 format.
 */
export function isValidPubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') return false;
  if (pubkey.length > 200) return false; // Prevent absurdly long strings
  // Hex format (64 hex chars)
  if (/^[0-9a-f]{64}$/.test(pubkey)) return true;
  // npub1 bech32 format
  if (/^npub1[a-z0-9]{58}$/.test(pubkey)) return true;
  return false;
}

/**
 * Validate scan_type enum.
 */
export function isValidScanType(scanType) {
  return ['gate_entry', 'roaming_check'].includes(scanType);
}

/**
 * Validate card category against allowed list.
 */
const VALID_CATEGORIES = [
  'Verbal abuse (toward steward)',
  'Verbal abuse (toward other fans)',
  'Verbal abuse (toward players/officials)',
  'Discriminatory behaviour',
  'Pyrotechnics / missiles',
  'Persistent standing (where not permitted)',
  'Alcohol violation',
  'Auto-red: two yellows',
  'Other',
];

export function isValidCategory(category) {
  return VALID_CATEGORIES.includes(category);
}

/**
 * Validate a text field has content and does not exceed maxLen.
 */
export function isValidText(str, maxLen = 500) {
  return typeof str === 'string' && str.length > 0 && str.length <= maxLen;
}

/**
 * Validate an optional text field (may be null/undefined, but if present must be within maxLen).
 */
export function isValidOptionalText(str, maxLen = 500) {
  if (str == null || str === '') return true;
  return typeof str === 'string' && str.length <= maxLen;
}

/**
 * Validate a UUID format string.
 */
export function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Validate photo hash — should be hex string.
 */
export function isValidPhotoHash(hash) {
  if (!hash || typeof hash !== 'string') return false;
  return /^[0-9a-f]{64}$/.test(hash);
}

/**
 * Validate a strict YYYY-MM-DD date string.
 * Checks format with regex and that the date actually parses to a valid date.
 */
export function isValidDateString(str) {
  if (!str || typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
