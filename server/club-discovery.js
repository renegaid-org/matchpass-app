const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024; // 256 KB — room for thousands of pubkeys
const MAX_CLUB_PUBKEYS = 10_000;
const PUBKEY_RE = /^[0-9a-f]{64}$/;

// Block SSRF: reject URLs whose hostname resolves to loopback / link-local /
// private networks / cloud metadata endpoints. This is best-effort host-based
// (a hostname that resolves to RFC1918 at request time is still allowed through
// — DNS rebinding is a known residual risk; the right long-term fix is to
// resolve explicitly and pin the address).
const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.169.254', // AWS / GCP / OpenStack metadata
  'metadata.google.internal',
]);
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  // IPv4 private ranges
  if (/^10\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  // IPv6 loopback / link-local / ULA
  if (/^(fe80:|fc00:|fd00:|::1)/i.test(h)) return true;
  return false;
}

export class ClubDiscovery {
  constructor(apiUrl, { refreshMs = DEFAULT_REFRESH_MS, onChange = null } = {}) {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Club discovery: unsupported protocol ${parsed.protocol}`);
    }
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      throw new Error('Club discovery: http:// refused in production');
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new Error(`Club discovery: hostname ${parsed.hostname} is blocked`);
    }
    this._apiUrl = apiUrl;
    this._refreshMs = refreshMs;
    this._clubPubkeys = [];
    this._timer = null;
    this._onChange = onChange;
  }

  async fetch() {
    try {
      const res = await fetch(`${this._apiUrl}/api/clubs/pubkeys`, {
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentLength = Number(res.headers.get('content-length'));
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new Error(`response too large (${contentLength} bytes)`);
      }
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error(`response too large (${text.length} bytes)`);
      }
      const data = JSON.parse(text);
      const raw = Array.isArray(data.pubkeys) ? data.pubkeys : [];
      // Validate every returned pubkey. A compromised or hostile club directory
      // could otherwise inject arbitrary strings that flow to the relay
      // subscription filter and to roster authority checks.
      const newPubkeys = raw
        .filter(p => typeof p === 'string' && PUBKEY_RE.test(p))
        .slice(0, MAX_CLUB_PUBKEYS);
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
