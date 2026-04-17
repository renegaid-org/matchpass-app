// server/chain/types.js — Event kind constants and controlled vocabularies

export const EVENT_KINDS = {
  MEMBERSHIP: 31900,
  GATE_LOCK: 31901,
  ATTENDANCE: 31902,
  CARD: 31903,
  SANCTION: 31904,
  REVIEW_OUTCOME: 31905,
};

export const STAFF_ROSTER_KIND = 31920;

export const CARD_CATEGORIES = [
  'assault',
  'weapons',
  'theft',
  'abuse-racial',
  'abuse-religious',
  'abuse-sexual',
  'abuse-other',
  'intoxication',
  'missile',
  'pitch-incursion',
  'other',
];

export const CARD_TYPES = ['yellow', 'red'];

export const SANCTION_TYPES = ['suspension', 'ban'];

export const STATUS = {
  CLEAN: 0,
  YELLOW: 1,
  RED: 2,
  BANNED: 3,
};

/**
 * Validate a card category against the controlled vocabulary.
 */
export function isValidCategory(category) {
  return CARD_CATEGORIES.includes(category);
}

/**
 * Validate a card type.
 */
export function isValidCardType(type) {
  return CARD_TYPES.includes(type);
}

/**
 * Validate a sanction type.
 */
export function isValidSanctionType(type) {
  return SANCTION_TYPES.includes(type);
}

/**
 * Validate a hex pubkey (64 lowercase hex chars).
 */
export function isValidPubkey(pubkey) {
  return typeof pubkey === 'string' && /^[0-9a-f]{64}$/.test(pubkey);
}

/**
 * Validate a hex event ID (64 lowercase hex chars).
 */
export function isValidEventId(id) {
  return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
}

export const REVIEW_OUTCOMES = ['dismissed', 'downgraded'];

export function isValidReviewOutcome(outcome) {
  return REVIEW_OUTCOMES.includes(outcome);
}
