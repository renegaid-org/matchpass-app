// server/chain-tip-cache.js — In-memory cache for fan chain tips
// Map<fanPubkey, { tipEventId, status, lastSeen }>

export class ChainTipCache {
  constructor() { this._tips = new Map(); }

  get(fanPubkey) { return this._tips.get(fanPubkey); }

  set(fanPubkey, { tipEventId, status }) {
    this._tips.set(fanPubkey, { tipEventId, status, lastSeen: new Date() });
  }

  has(fanPubkey) { return this._tips.has(fanPubkey); }

  get size() { return this._tips.size; }

  clear() { this._tips.clear(); }
}
