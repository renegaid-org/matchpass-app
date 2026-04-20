// server/review-request-cache.js — In-memory cache for review requests (kind 31910)
// Map<reviewRequestId, event>
//
// Populated from relay subscription. Filtered to events whose `club` tag
// matches a known club pubkey. Surfaced via GET /api/gate/flags alongside
// duplicate-scan flags — both are officer-action items.

const DEFAULT_MAX_SIZE = 10_000;

export class ReviewRequestCache {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this._requests = new Map();
    this._maxSize = maxSize;
  }

  // Store a review request event. Replays with the same id are no-ops.
  set(event) {
    if (!event || typeof event !== 'object' || !event.id) return false;
    if (this._requests.has(event.id)) return false;
    this._requests.set(event.id, event);
    if (this._requests.size > this._maxSize) {
      const oldest = this._requests.keys().next().value;
      this._requests.delete(oldest);
    }
    return true;
  }

  get(id) { return this._requests.get(id); }

  has(id) { return this._requests.has(id); }

  remove(id) { return this._requests.delete(id); }

  // List every cached request. Optional filter: { clubPubkey }.
  list({ clubPubkey } = {}) {
    const out = [];
    for (const event of this._requests.values()) {
      if (clubPubkey) {
        const club = event.tags?.find(t => Array.isArray(t) && t[0] === 'club')?.[1];
        if (club !== clubPubkey) continue;
      }
      out.push(event);
    }
    return out.sort((a, b) => b.created_at - a.created_at);
  }

  get size() { return this._requests.size; }

  clear() { this._requests.clear(); }
}
