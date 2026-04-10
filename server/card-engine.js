/**
 * Compute a fan's gate status from their cards and sanctions.
 * Returns: { colour: 'green'|'amber'|'red', yellowCount, reason }
 */
export function computeFanStatus({ cards, sanctions }) {
  const activeSanctions = sanctions.filter(s => s.status === 'active');
  for (const s of activeSanctions) {
    if (s.sanction_type === 'ban') {
      const expiry = s.end_date ? ` — expires ${s.end_date}` : '';
      return { colour: 'red', yellowCount: 0, reason: `Banned${expiry}` };
    }
    if (s.sanction_type === 'suspension') {
      return { colour: 'red', yellowCount: 0, reason: `Suspended — ${s.match_count} matches` };
    }
  }

  const activeCards = cards.filter(c => c.status === 'active');
  const activeYellows = activeCards.filter(c => c.card_type === 'yellow');
  const activeReds = activeCards.filter(c => c.card_type === 'red');

  if (activeReds.length > 0) {
    return { colour: 'red', yellowCount: activeYellows.length, reason: 'Red card — review pending' };
  }

  if (activeYellows.length > 0) {
    return { colour: 'amber', yellowCount: activeYellows.length, reason: null };
  }

  return { colour: 'green', yellowCount: 0, reason: null };
}

/**
 * Compute the review deadline for a card.
 * Yellow: 48 hours. Red: 7 days.
 */
export function reviewDeadline(cardType, issuedAt = new Date()) {
  const ms = cardType === 'yellow' ? 48 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(issuedAt.getTime() + ms);
}

// Expiry thresholds (Option D — whichever comes last)
const YELLOW_CLEAN_MATCHES = 5;
const YELLOW_MIN_MONTHS = 3;
const YELLOW_CEILING_MONTHS = 12;
const RED_CLEAN_MATCHES = 10;
const RED_MIN_MONTHS = 6;
const RED_CEILING_MONTHS = 24;

/**
 * Months elapsed since a date.
 */
function monthsSince(dateStr, now = new Date()) {
  const d = new Date(dateStr);
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

/**
 * Check if a yellow card should expire.
 *
 * Option D (whichever comes last):
 *   - 5 clean matches AND at least 3 months old → expires
 *   - Hard ceiling: 12 months regardless of clean matches
 *
 * If the card is challenged, expiry is frozen (challenge_at is set).
 */
export function shouldExpireYellow(card, now = new Date()) {
  if (card.card_type !== 'yellow') return false;
  if (card.status !== 'active') return false;
  if (card.challenge_at && !card.reviewed_at) return false; // challenge freezes clock

  const months = monthsSince(card.created_at, now);

  // Hard ceiling — expires regardless
  if (months >= YELLOW_CEILING_MONTHS) return true;

  // Both conditions met (whichever comes last)
  return card.clean_matches >= YELLOW_CLEAN_MATCHES && months >= YELLOW_MIN_MONTHS;
}

/**
 * Check if a red card should expire.
 *
 * Option D (whichever comes last):
 *   - Review must be confirmed + 10 clean matches AND at least 6 months old → expires
 *   - Hard ceiling: 24 months regardless of clean matches
 *
 * If the card is challenged, expiry is frozen.
 */
export function shouldExpireRed(card, now = new Date()) {
  if (card.card_type !== 'red') return false;
  if (card.status !== 'active') return false;
  if (card.challenge_at && !card.reviewed_at) return false; // challenge freezes clock

  const months = monthsSince(card.created_at, now);

  // Hard ceiling — expires regardless
  if (months >= RED_CEILING_MONTHS) return true;

  // Both conditions met (whichever comes last)
  if (card.review_outcome !== 'confirmed') return false;
  return card.clean_matches >= RED_CLEAN_MATCHES && months >= RED_MIN_MONTHS;
}

/**
 * Check if two active yellows should trigger an automatic red.
 * Uses a rolling 12-month window, not season-bound.
 */
export function shouldAutoRed(existingCards, now = new Date()) {
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const recentActiveYellows = existingCards.filter(
    c => c.card_type === 'yellow'
      && c.status === 'active'
      && new Date(c.created_at) >= twelveMonthsAgo
  );
  return recentActiveYellows.length >= 1;
}
