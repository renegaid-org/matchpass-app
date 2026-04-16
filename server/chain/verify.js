// server/chain/verify.js — Chain verification and status computation

import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, STATUS } from './types.js';

/**
 * Get a tag value from an event by tag name.
 */
function getTagValue(event, tagName) {
  const tag = event.tags.find(t => Array.isArray(t) && t[0] === tagName);
  return tag ? tag[1] : null;
}

/**
 * Verify the integrity of a credential chain.
 *
 * Events must be sorted in chain order (oldest first).
 * The first event (membership) has no previous tag.
 * Each subsequent event must reference the prior event's ID via a previous tag.
 *
 * Returns { valid, tip, length, errors }
 */
export function verifyChain(events) {
  const errors = [];

  if (!Array.isArray(events) || events.length === 0) {
    return { valid: false, tip: null, length: 0, errors: ['Empty or invalid events array'] };
  }

  const validKinds = new Set(Object.values(EVENT_KINDS));

  // Verify each event's signature and kind
  for (let i = 0; i < events.length; i++) {
    if (!verifyEvent(events[i])) {
      errors.push(`Event ${i} (${events[i].id}): invalid signature`);
    }
    if (!validKinds.has(events[i].kind)) {
      errors.push(`Event ${i} (${events[i].id}): unrecognised kind ${events[i].kind}`);
    }
  }

  // First event must be membership with no previous tag
  const first = events[0];
  if (first.kind !== EVENT_KINDS.MEMBERSHIP) {
    errors.push(`First event must be kind ${EVENT_KINDS.MEMBERSHIP} (membership), got ${first.kind}`);
  }
  const firstPrevious = getTagValue(first, 'previous');
  if (firstPrevious) {
    errors.push('First event (membership) must not have a previous tag');
  }

  // Verify p-tag consistency: every event must reference the same fan pubkey
  const firstPTag = getTagValue(first, 'p');
  if (!firstPTag) {
    errors.push('First event missing p tag (fan pubkey)');
  } else if (first.kind === EVENT_KINDS.MEMBERSHIP && first.pubkey !== firstPTag) {
    errors.push('Membership event signer does not match p-tag (fan pubkey)');
  }
  if (firstPTag) {
    for (let i = 1; i < events.length; i++) {
      const pTag = getTagValue(events[i], 'p');
      if (pTag !== firstPTag) {
        errors.push(
          `Event ${i} (${events[i].id}): p tag ${pTag} does not match fan pubkey ${firstPTag}`
        );
      }
    }
  }

  // Walk the chain: each event's previous tag must match the prior event's ID
  for (let i = 1; i < events.length; i++) {
    const prev = getTagValue(events[i], 'previous');
    if (!prev) {
      errors.push(`Event ${i} (${events[i].id}): missing previous tag`);
    } else if (prev !== events[i - 1].id) {
      errors.push(
        `Event ${i} (${events[i].id}): previous tag ${prev} does not match prior event ${events[i - 1].id}`
      );
    }
  }

  const tip = events[events.length - 1].id;

  return {
    valid: errors.length === 0,
    tip,
    length: events.length,
    errors,
  };
}

/**
 * Verify that the signer of an event is listed in the staff roster event
 * with an appropriate role.
 *
 * The staff roster event (kind 31000) has tags like:
 *   ["p", "<pubkey>", "<role>"]
 *
 * LIMITATION: The current check verifies against the current roster, not the
 * roster at the time of signing. A steward who was authorised when they signed
 * an event but was later removed would fail verification. Conversely, a steward
 * added after signing would pass. This is acceptable for the pilot.
 * TODO: Implement roster versioning — store timestamped roster snapshots and
 * verify each event against the roster that was active at event.created_at.
 */
export function verifySignerAuthority(event, staffRosterEvent) {
  if (!staffRosterEvent || !Array.isArray(staffRosterEvent.tags)) {
    return { authorised: false, reason: 'No staff roster provided' };
  }

  const signerPubkey = event.pubkey;
  const staffEntry = staffRosterEvent.tags.find(
    t => Array.isArray(t) && t[0] === 'p' && t[1] === signerPubkey
  );

  if (!staffEntry) {
    return { authorised: false, reason: `Signer ${signerPubkey} not found in staff roster` };
  }

  const role = staffEntry[2] || 'unknown';

  // Sanctions require safety_officer or higher
  if (event.kind === EVENT_KINDS.SANCTION) {
    const sanctionRoles = ['safety_officer', 'admin', 'owner'];
    if (!sanctionRoles.includes(role)) {
      return {
        authorised: false,
        reason: `Signer role "${role}" insufficient for sanction events (requires safety_officer or above)`,
      };
    }
  }

  return { authorised: true, role };
}

/**
 * Walk a chain of events and compute the current status.
 *
 * Returns { status, statusName, activeCards, activeSanctions }
 */
export function getCurrentStatus(events) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);

  const activeCards = [];
  const activeSanctions = [];

  const TWELVE_MONTHS_SECONDS = 365 * 24 * 60 * 60;
  const TWENTY_FOUR_MONTHS_SECONDS = 2 * TWELVE_MONTHS_SECONDS;

  // Pre-scan: collect review outcomes keyed by the reviewed event ID
  const reviewOutcomes = new Map();
  for (const event of events) {
    if (event.kind === EVENT_KINDS.REVIEW_OUTCOME) {
      const reviewedId = getTagValue(event, 'reviews');
      const outcome = getTagValue(event, 'outcome');
      if (reviewedId && outcome) {
        reviewOutcomes.set(reviewedId, outcome);
      }
    }
  }

  for (const event of events) {
    if (event.kind === EVENT_KINDS.CARD) {
      // Skip dismissed cards
      if (reviewOutcomes.get(event.id) === 'dismissed') continue;

      const rawCardType = getTagValue(event, 'card_type');
      // Treat downgraded reds as yellows
      const cardType = (rawCardType === 'red' && reviewOutcomes.get(event.id) === 'downgraded')
        ? 'yellow'
        : rawCardType;
      const category = getTagValue(event, 'category');
      const ageSeconds = now - event.created_at;

      // M1: Time-based card expiry — yellow cards expire after 12 months, red after 24
      if (cardType === 'yellow' && ageSeconds > TWELVE_MONTHS_SECONDS) {
        continue; // Expired yellow card — skip
      }
      if (cardType === 'red' && ageSeconds > TWENTY_FOUR_MONTHS_SECONDS) {
        continue; // Expired red card — skip
      }

      activeCards.push({ id: event.id, cardType, category, createdAt: event.created_at });
    }

    if (event.kind === EVENT_KINDS.SANCTION) {
      const sanctionType = getTagValue(event, 'sanction_type');
      const reason = getTagValue(event, 'reason');
      const startDate = getTagValue(event, 'start_date');
      const endDate = getTagValue(event, 'end_date');

      // Check if sanction is still active (null/missing endDate = indefinite)
      if (!endDate || endDate === 'indefinite' || endDate >= today) {
        if (startDate <= today) {
          activeSanctions.push({
            id: event.id,
            sanctionType,
            reason,
            startDate,
            endDate,
            createdAt: event.created_at,
          });
        }
      }
    }
  }

  // Determine status: banned > red > yellow > clean
  const hasBan = activeSanctions.some(s => s.sanctionType === 'ban');
  if (hasBan) {
    return { status: STATUS.BANNED, statusName: 'banned', activeCards, activeSanctions };
  }

  const hasSuspension = activeSanctions.some(s => s.sanctionType === 'suspension');
  const hasRed = activeCards.some(c => c.cardType === 'red');
  if (hasRed || hasSuspension) {
    return { status: STATUS.RED, statusName: 'red', activeCards, activeSanctions };
  }

  const hasYellow = activeCards.some(c => c.cardType === 'yellow');
  if (hasYellow) {
    return { status: STATUS.YELLOW, statusName: 'yellow', activeCards, activeSanctions };
  }

  return { status: STATUS.CLEAN, statusName: 'clean', activeCards, activeSanctions };
}
