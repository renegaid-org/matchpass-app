/**
 * Build unsigned templates for MatchPass chain events (kinds 31900-31905)
 * and the Review Request event (kind 31910).
 *
 * These functions return EventTemplate objects. Signing is handled
 * separately by the NIP-46 signer.
 */

import type { EventTemplate } from '../types';

export const EVENT_KINDS = {
  MEMBERSHIP: 31900,
  GATE_LOCK: 31901,
  ATTENDANCE: 31902,
  CARD: 31903,
  SANCTION: 31904,
  REVIEW_OUTCOME: 31905,
  REVIEW_REQUEST: 31910,
  ROSTER: 31920,
} as const;

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
  'duplicate_admission',
  'other',
] as const;

export type CardCategory = typeof CARD_CATEGORIES[number];

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function membershipTemplate(fanPubkey: string, clubPubkey: string): EventTemplate {
  return {
    kind: EVENT_KINDS.MEMBERSHIP,
    created_at: now(),
    content: '',
    tags: [
      ['d', `${fanPubkey}:${clubPubkey}`],
      ['p', fanPubkey],
      ['club', clubPubkey],
    ],
  };
}

export function gateLockTemplate(params: {
  fanPubkey: string;
  clubPubkey: string;
  photoHash: string;
  previousEventId: string;
}): EventTemplate {
  const date = new Date().toISOString().split('T')[0];
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    kind: EVENT_KINDS.GATE_LOCK,
    created_at: now(),
    content: '',
    tags: [
      ['d', `${params.fanPubkey}:${date}:${nonce}`],
      ['p', params.fanPubkey],
      ['previous', params.previousEventId],
      ['photo_hash', params.photoHash],
      ['club', params.clubPubkey],
    ],
  };
}

export function attendanceTemplate(params: {
  fanPubkey: string;
  previousEventId: string;
  matchDate: string; // YYYY-MM-DD
  result: 'clean' | 'yellow' | 'red';
}): EventTemplate {
  return {
    kind: EVENT_KINDS.ATTENDANCE,
    created_at: now(),
    content: '',
    tags: [
      ['d', `${params.fanPubkey}:${params.matchDate}`],
      ['p', params.fanPubkey],
      ['previous', params.previousEventId],
      ['match_date', params.matchDate],
      ['result', params.result],
    ],
  };
}

export function cardTemplate(params: {
  fanPubkey: string;
  previousEventId: string;
  cardType: 'yellow' | 'red';
  category: CardCategory;
  matchDate: string;
  notes?: string;
}): EventTemplate {
  return {
    kind: EVENT_KINDS.CARD,
    created_at: now(),
    content: params.notes || '',
    tags: [
      ['d', `${params.fanPubkey}:${uuid()}`],
      ['p', params.fanPubkey],
      ['previous', params.previousEventId],
      ['card_type', params.cardType],
      ['category', params.category],
      ['match_date', params.matchDate],
    ],
  };
}

export function sanctionTemplate(params: {
  fanPubkey: string;
  previousEventId: string;
  sanctionType: 'suspension' | 'ban';
  reason: string;
  startDate: string;
  endDate: string; // date or 'indefinite'
  linkedCardIds?: string[];
  notes?: string;
}): EventTemplate {
  const tags: string[][] = [
    ['d', `${params.fanPubkey}:${uuid()}`],
    ['p', params.fanPubkey],
    ['previous', params.previousEventId],
    ['sanction_type', params.sanctionType],
    ['reason', params.reason],
    ['start_date', params.startDate],
    ['end_date', params.endDate],
  ];
  for (const id of params.linkedCardIds || []) tags.push(['e', id]);
  return {
    kind: EVENT_KINDS.SANCTION,
    created_at: now(),
    content: params.notes || '',
    tags,
  };
}

export function reviewOutcomeTemplate(params: {
  fanPubkey: string;
  previousEventId: string;
  reviewedEventId: string;
  outcome: 'dismissed' | 'downgraded';
  reasoning?: string;
}): EventTemplate {
  return {
    kind: EVENT_KINDS.REVIEW_OUTCOME,
    created_at: now(),
    content: params.reasoning || '',
    tags: [
      ['d', `${params.fanPubkey}:review:${uuid()}`],
      ['p', params.fanPubkey],
      ['previous', params.previousEventId],
      ['reviews', params.reviewedEventId],
      ['outcome', params.outcome],
    ],
  };
}

export function reviewRequestTemplate(params: {
  fanPubkey: string;
  clubPubkey: string;
  reviewedEventId: string;
}): EventTemplate {
  return {
    kind: EVENT_KINDS.REVIEW_REQUEST,
    created_at: now(),
    content: '',
    tags: [
      ['d', `${params.fanPubkey}:reviewreq:${uuid()}`],
      ['p', params.fanPubkey],
      ['reviews', params.reviewedEventId],
      ['club', params.clubPubkey],
    ],
  };
}
