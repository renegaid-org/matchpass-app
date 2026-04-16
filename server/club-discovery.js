const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class ClubDiscovery {
  constructor(apiUrl, refreshMs = DEFAULT_REFRESH_MS) {
    this._apiUrl = apiUrl;
    this._refreshMs = refreshMs;
    this._clubPubkeys = [];
    this._timer = null;
  }

  async fetch() {
    try {
      const res = await fetch(`${this._apiUrl}/api/clubs/pubkeys`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._clubPubkeys = Array.isArray(data.pubkeys) ? data.pubkeys : [];
      console.log(`Club discovery: ${this._clubPubkeys.length} club(s) from ${this._apiUrl}`);
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
