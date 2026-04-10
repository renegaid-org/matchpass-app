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
 * Check if issuing a new yellow would trigger an automatic red.
 * Two active yellows in the same season = auto red.
 */
export function shouldAutoRed(existingCards) {
  const activeYellows = existingCards.filter(
    c => c.card_type === 'yellow' && c.status === 'active'
  );
  return activeYellows.length >= 1;
}

/**
 * Compute the review deadline for a card.
 * Yellow: 48 hours. Red: 7 days.
 */
export function reviewDeadline(cardType, issuedAt = new Date()) {
  const ms = cardType === 'yellow' ? 48 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(issuedAt.getTime() + ms);
}

/**
 * Check if a yellow card should expire based on clean matches.
 * Yellow expires after 5 clean matches at the issuing club.
 */
export function shouldExpireYellow(card) {
  return card.card_type === 'yellow' && card.clean_matches >= 5;
}

/**
 * Check if a red card should expire.
 * Red expires after review/suspension period plus 10 clean matches at the issuing club.
 */
export function shouldExpireRed(card) {
  if (card.card_type !== 'red') return false;
  if (card.status !== 'active') return false;
  if (card.review_outcome === 'confirmed' && card.clean_matches >= 10) return true;
  return false;
}
