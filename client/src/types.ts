/** Staff roles — must match credential-chain-spec §5. */
export type Role =
  | 'gate_steward'
  | 'roaming_steward'
  | 'safety_officer'
  | 'safeguarding_officer'
  | 'admin';

/** Scan decision — must match server constant `decision`. */
export type Decision = 'green' | 'amber' | 'red';

/** Sub-state — must match server constants in `server/constants.js`. */
export type SubState =
  | 'clean'
  | 'first_visit'
  | 'yellow_card_active'
  | 'qr_stale'
  | 'chain_loading'
  | 'banned'
  | 'active_red_card'
  | 'suspension_active'
  | 'duplicate_admission'
  | 'qr_expired'
  | 'qr_future'
  | 'qr_invalid_signature'
  | 'qr_not_venue_entry'
  | 'photo_hash_mismatch';

export interface ScanResult {
  decision: Decision;
  sub_state: SubState;
  fanPubkey: string;
  reason?: string;
  /** Server notes photo unreachable before PWA tries. */
  photo_status?: 'ok' | 'unreachable';
  /** Blossom server URL from the venue entry event. */
  blossom?: string;
  /** Expected SHA-256 of the decrypted photo. */
  x?: string;
  /** Photo decryption key. */
  photoKey?: string;
  /** True when the decision was computed locally while offline. */
  offline?: boolean;
}

export interface StaffEntry {
  pubkey: string;
  role: Role;
  displayName?: string;
  external?: boolean;
  clubPubkey: string;
}

/** A fan / steward / club pubkey — 64 hex chars. */
export type Pubkey = string;

/** Nostr event ID — 64 hex chars. */
export type EventId = string;

export interface NostrEvent {
  id: EventId;
  pubkey: Pubkey;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Unsigned event template before signing via NIP-46. */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** Active pairing with a Signet identity over NIP-46. */
export interface NIP46Session {
  remotePubkey: Pubkey;
  sessionSecret: string;
  relayUrl: string;
  pairedAt: number;
}
