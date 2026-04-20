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
  // Normalise: strip IPv6 brackets, trailing dots, and lower-case. new URL()
  // returns "[::1]" for IPv6 literals and preserves trailing dots on FQDNs.
  // Without stripping, `[::1]` and `localhost.` bypass the block set.
  let h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h === 'localhost') return true;
  if (h.endsWith('.localhost')) return true;
  // IPv4 private ranges
  if (/^10\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  // IPv6 loopback / link-local / ULA — note the normalised address may drop
  // a leading "::" prefix (e.g. "::1" normalises to "::1" still; "::ffff:a.b.c.d"
  // is the IPv4-mapped form, commonly reachable).
  if (h === '::' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '0:0:0:0:0:0:0:0') return true;
  if (/^(fe80:|fc00:|fd00:)/i.test(h)) return true;
  // IPv4-mapped IPv6: ::ffff:127.0.0.1 etc — reject anything starting with ::ffff
  if (/^::ffff:/i.test(h)) return true;
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
