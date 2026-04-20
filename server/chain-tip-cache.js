// server/chain-tip-cache.js — In-memory cache for fan chain tips
// Map<fanPubkey, { tipEventId, status, createdAt, lastSeen }>
//
// createdAt is the chain event's created_at (seconds since epoch). It is
// used by the relay subscription to discard out-of-order older events.

const DEFAULT_MAX_SIZE = 100_000;

export class ChainTipCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._tips = new Map();
    this._maxSize = maxSize;
  }

  get(fanPubkey) { return this._tips.get(fanPubkey); }

  set(fanPubkey, { tipEventId, status, createdAt = 0 }) {
    // Delete first so re-insert moves to end (Map insertion order = LRU)
    this._tips.delete(fanPubkey);
    this._tips.set(fanPubkey, { tipEventId, status, createdAt, lastSeen: new Date() });
    // Evict oldest entries if over capacity, but skip RED/BANNED entries.
    // Without this, an attacker can publish 100k+ fresh-fan membership events
    // to evict a real ban — the gate would then see an empty cache for the
    // banned fan and treat them as first-visit.
    if (this._tips.size > this._maxSize) {
      for (const [key, entry] of this._tips) {
        if (key === fanPubkey) continue; // never evict the just-inserted entry
        if (entry.status >= 2) continue; // preserve RED (2) and BANNED (3)
        this._tips.delete(key);
        break;
      }
    }
  }

  has(fanPubkey) { return this._tips.has(fanPubkey); }

  get size() { return this._tips.size; }

  clear() { this._tips.clear(); }
}
