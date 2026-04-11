// server/chain/events.js — Event creation for the credential chain

import { finalizeEvent } from 'nostr-tools/pure';
import crypto from 'node:crypto';
import { EVENT_KINDS, isValidPubkey, isValidCardType, isValidCategory, isValidSanctionType } from './types.js';
import { isValidDateString } from '../validation.js';

/**
 * Create a kind 31100 membership event (signed by the fan).
 */
export function createMembership(fanPubkey, clubPubkey, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!isValidPubkey(clubPubkey)) throw new Error('Invalid club pubkey');

  const template = {
    kind: EVENT_KINDS.MEMBERSHIP,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:membership`],
      ['p', fanPubkey],
      ['club', clubPubkey],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}

/**
 * Create a kind 31101 gate-lock event (signed by steward).
 */
export function createGateLock(fanPubkey, clubPubkey, photoHash, previousEventId, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!isValidPubkey(clubPubkey)) throw new Error('Invalid club pubkey');
  if (!photoHash || typeof photoHash !== 'string') throw new Error('Invalid photo hash');
  if (!previousEventId || typeof previousEventId !== 'string') throw new Error('Invalid previous event ID');

  const seasonDate = new Date().toISOString().slice(0, 10);

  const template = {
    kind: EVENT_KINDS.GATE_LOCK,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:gatelock:${seasonDate}`],
      ['p', fanPubkey],
      ['previous', previousEventId],
      ['photo_hash', photoHash],
      ['club', clubPubkey],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}

/**
 * Create a kind 31102 attendance event (signed by steward).
 */
export function createAttendance(fanPubkey, matchDate, result, previousEventId, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!matchDate || typeof matchDate !== 'string' || !isValidDateString(matchDate)) throw new Error('Invalid match date');
  if (!['clean', 'yellow', 'red'].includes(result)) throw new Error('Invalid result');
  if (!previousEventId || typeof previousEventId !== 'string') throw new Error('Invalid previous event ID');

  const template = {
    kind: EVENT_KINDS.ATTENDANCE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:attendance:${matchDate}`],
      ['p', fanPubkey],
      ['previous', previousEventId],
      ['match_date', matchDate],
      ['result', result],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}

/**
 * Create a kind 31103 card event (signed by steward).
 */
export function createCard(fanPubkey, cardType, category, previousEventId, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!isValidCardType(cardType)) throw new Error('Invalid card type');
  if (!isValidCategory(category)) throw new Error('Invalid category');
  if (!previousEventId || typeof previousEventId !== 'string') throw new Error('Invalid previous event ID');

  const uuid = crypto.randomUUID();

  const template = {
    kind: EVENT_KINDS.CARD,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:card:${uuid}`],
      ['p', fanPubkey],
      ['previous', previousEventId],
      ['card_type', cardType],
      ['category', category],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}

/**
 * Create a kind 31104 sanction event (signed by steward).
 */
export function createSanction(fanPubkey, sanctionType, reason, startDate, endDate, previousEventId, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!isValidSanctionType(sanctionType)) throw new Error('Invalid sanction type');
  if (!reason || typeof reason !== 'string') throw new Error('Invalid reason');
  if (!startDate || typeof startDate !== 'string' || !isValidDateString(startDate)) throw new Error('Invalid start date');
  if (!endDate || typeof endDate !== 'string') throw new Error('Invalid end date');
  // endDate can be 'indefinite' or a valid date string
  if (endDate !== 'indefinite' && !isValidDateString(endDate)) throw new Error('Invalid end date format');
  if (!previousEventId || typeof previousEventId !== 'string') throw new Error('Invalid previous event ID');

  const uuid = crypto.randomUUID();

  const template = {
    kind: EVENT_KINDS.SANCTION,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:sanction:${uuid}`],
      ['p', fanPubkey],
      ['previous', previousEventId],
      ['sanction_type', sanctionType],
      ['reason', reason],
      ['start_date', startDate],
      ['end_date', endDate],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}
