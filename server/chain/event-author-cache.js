// server/chain/event-author-cache.js
//
// Bounded event-id → author-pubkey map used to enforce the self-review
// prohibition in verifySignerAuthority (§2.4.3, §4.3). Every chain event
// that passes the relay-ingest signature + kind + timestamp checks is
// recorded here; the REVIEW_OUTCOME path then checks whether the signer
// authored the event they are attempting to review.
//
// Sizing: the cache is bounded by LRU eviction at `maxSize` (default
// 100_000). That's ~100k chain events retained in memory — several
// seasons' worth for a club of any realistic size. Missing entries fail
// open (authorised) so a cold-start officer can still review historical
// events that predate this cache — that's consistent with the existing
// "PWA layer enforces" fallback. The important correctness property is:
// if the cache DOES know the author, we trust it.

const DEFAULT_MAX_SIZE = 100_000;

export class EventAuthorCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._authors = new Map();
    this._maxSize = maxSize;
  }

  /** Record the author of an event. Safe to call with the same id repeatedly. */
  record(eventId, authorPubkey) {
    if (typeof eventId !== 'string' || typeof authorPubkey !== 'string') return;
    // Re-insert to move to end (Map insertion order = LRU recency)
    this._authors.delete(eventId);
    this._authors.set(eventId, authorPubkey);
    if (this._authors.size > this._maxSize) {
      const oldest = this._authors.keys().next().value;
      this._authors.delete(oldest);
    }
  }

  /** Return the recorded author pubkey for an event, or null if unknown. */
  getAuthor(eventId) {
    return this._authors.get(eventId) ?? null;
  }

  get size() { return this._authors.size; }

  clear() { this._authors.clear(); }
}
