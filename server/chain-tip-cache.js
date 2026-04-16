// server/chain-tip-cache.js — In-memory cache for fan chain tips
// Map<fanPubkey, { tipEventId, status, lastSeen }>

const DEFAULT_MAX_SIZE = 100_000;

export class ChainTipCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._tips = new Map();
    this._maxSize = maxSize;
  }

  get(fanPubkey) { return this._tips.get(fanPubkey); }

  set(fanPubkey, { tipEventId, status }) {
    // Delete first so re-insert moves to end (Map insertion order = LRU)
    this._tips.delete(fanPubkey);
    this._tips.set(fanPubkey, { tipEventId, status, lastSeen: new Date() });
    // Evict oldest entries if over capacity
    if (this._tips.size > this._maxSize) {
      const oldest = this._tips.keys().next().value;
      this._tips.delete(oldest);
    }
  }

  has(fanPubkey) { return this._tips.has(fanPubkey); }

  get size() { return this._tips.size; }

  clear() { this._tips.clear(); }
}
