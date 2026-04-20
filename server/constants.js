// Scan result sub-states. Mirror in client/src/types.ts as `SubState`.
// See docs/matchpass-app-roles-and-flows.md §2.2.3 for the full enumeration.
export const SUB_STATES = {
  CLEAN: 'clean',
  FIRST_VISIT: 'first_visit',
  YELLOW_CARD_ACTIVE: 'yellow_card_active',
  QR_STALE: 'qr_stale',
  CHAIN_LOADING: 'chain_loading',
  BANNED: 'banned',
  ACTIVE_RED_CARD: 'active_red_card',
  SUSPENSION_ACTIVE: 'suspension_active',
  DUPLICATE_ADMISSION: 'duplicate_admission',
  QR_EXPIRED: 'qr_expired',
  QR_FUTURE: 'qr_future',
  QR_INVALID_SIGNATURE: 'qr_invalid_signature',
  QR_NOT_VENUE_ENTRY: 'qr_not_venue_entry',
  PHOTO_HASH_MISMATCH: 'photo_hash_mismatch',
};

// Which substrings in verifyVenueEntry's thrown error map to which sub_state.
// Used to classify parse/verify failures into client-actionable reasons.
export function subStateForVerifyError(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('expired')) return SUB_STATES.QR_EXPIRED;
  if (m.includes('future')) return SUB_STATES.QR_FUTURE;
  if (m.includes('signature')) return SUB_STATES.QR_INVALID_SIGNATURE;
  if (m.includes('kind') || m.includes('venue entry')) return SUB_STATES.QR_NOT_VENUE_ENTRY;
  return SUB_STATES.QR_INVALID_SIGNATURE;
}

// Map chain-tip status code to sub_state.
// 0=clean, 1=yellow, 2=red, 3=banned.
export function subStateForStatus(status) {
  if (status === 3) return SUB_STATES.BANNED;
  if (status === 2) return SUB_STATES.ACTIVE_RED_CARD;
  if (status === 1) return SUB_STATES.YELLOW_CARD_ACTIVE;
  return SUB_STATES.CLEAN;
}

// Human-readable reason for a given sub_state. Sent to the client as `reason`.
export function reasonForSubState(sub) {
  switch (sub) {
    case SUB_STATES.CLEAN: return null;
    case SUB_STATES.FIRST_VISIT: return 'First visit — not yet in chain cache';
    case SUB_STATES.YELLOW_CARD_ACTIVE: return 'Yellow card active';
    case SUB_STATES.QR_STALE: return 'QR is stale — ask fan to refresh in Signet';
    case SUB_STATES.CHAIN_LOADING: return 'Chain cache warming — admit with background verify';
    case SUB_STATES.BANNED: return 'Banned';
    case SUB_STATES.ACTIVE_RED_CARD: return 'Active red card or suspension';
    case SUB_STATES.SUSPENSION_ACTIVE: return 'Suspension active';
    case SUB_STATES.DUPLICATE_ADMISSION: return 'Already admitted today — hold for officer';
    case SUB_STATES.QR_EXPIRED: return 'QR expired — ask fan to refresh';
    case SUB_STATES.QR_FUTURE: return 'QR timestamp in the future — check device clock';
    case SUB_STATES.QR_INVALID_SIGNATURE: return 'QR signature invalid — ask fan to refresh';
    case SUB_STATES.QR_NOT_VENUE_ENTRY: return 'Wrong QR type presented';
    case SUB_STATES.PHOTO_HASH_MISMATCH: return 'Photo verification failed';
    default: return null;
  }
}
