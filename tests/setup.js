// Node 18 does not expose webcrypto on globalThis by default. nostr-tools
// (via @noble/hashes / @noble/curves) needs crypto.getRandomValues when
// generating keys for tests. Polyfill it here for the whole test run.

import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
