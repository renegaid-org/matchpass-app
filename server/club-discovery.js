const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class ClubDiscovery {
  constructor(apiUrl, { refreshMs = DEFAULT_REFRESH_MS, onChange = null } = {}) {
    this._apiUrl = apiUrl;
    this._refreshMs = refreshMs;
    this._clubPubkeys = [];
    this._timer = null;
    this._onChange = onChange;
  }

  async fetch() {
    try {
      const res = await fetch(`${this._apiUrl}/api/clubs/pubkeys`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newPubkeys = Array.isArray(data.pubkeys) ? data.pubkeys : [];
      const changed = JSON.stringify(newPubkeys) !== JSON.stringify(this._clubPubkeys);
      this._clubPubkeys = newPubkeys;
      console.log(`Club discovery: ${this._clubPubkeys.length} club(s) from ${this._apiUrl}`);
      if (changed && this._onChange) {
        this._onChange(this._clubPubkeys);
      }
    } catch (err) {
      console.error('Club discovery failed:', err.message);
    }
    return this._clubPubkeys;
  }

  startPeriodicRefresh() {
    this._timer = setInterval(() => this.fetch(), this._refreshMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  get pubkeys() {
    return this._clubPubkeys;
  }
}
