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
    // Evict oldest entries if over capacity, but skip RED/BANNED entries so
    // an attacker cannot publish 100k+ membership events to evict a real ban.
    // If the whole cache is saturated with RED/BANNED (unbounded growth) the
    // loop below falls through to a hard-cap evict at maxSize * 2 to prevent
    // a fully-RED cache from OOM-ing the process.
    if (this._tips.size > this._maxSize) {
      let evicted = false;
      for (const [key, entry] of this._tips) {
        if (key === fanPubkey) continue;
        if (entry.status >= 2) continue;
        this._tips.delete(key);
        evicted = true;
        break;
      }
      if (!evicted && this._tips.size > this._maxSize * 2) {
        const oldest = this._tips.keys().next().value;
        if (oldest !== fanPubkey) this._tips.delete(oldest);
      }
    }
  }

  has(fanPubkey) { return this._tips.has(fanPubkey); }

  get size() { return this._tips.size; }

  clear() { this._tips.clear(); }
}
