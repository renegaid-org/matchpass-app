/**
 * Signing backends for NIP-98 auth.
 * Each backend implements: getPublicKey(), signEvent(event), isAvailable(), name
 */

// --- NIP-07 Backend (browser extension: nos2x, Alby, etc.) ---

export const Nip07Backend = {
  name: 'NIP-07 Extension',

  isAvailable() {
    return typeof window !== 'undefined' && !!window.nostr;
  },

  async getPublicKey() {
    return window.nostr.getPublicKey();
  },

  async signEvent(event) {
    return window.nostr.signEvent(event);
  },
};

// --- NIP-46 Backend (remote signing via Heartwood / bunker) ---

export const Nip46Backend = {
  name: 'NIP-46 Remote Signer',
  _bunkerUri: null,
  _relay: null,
  _remotePubkey: null,
  _clientSecretKey: null,
  _connected: false,

  isAvailable() {
    const uri = localStorage.getItem('mp_bunker_uri');
    return !!uri;
  },

  async connect() {
    const uri = localStorage.getItem('mp_bunker_uri');
    if (!uri) throw new Error('No bunker URI configured');

    const url = new URL(uri);
    this._remotePubkey = url.hostname || url.pathname.replace('//', '');
    const relayUrl = url.searchParams.get('relay');
    const secret = url.searchParams.get('secret');
    if (!relayUrl || !this._remotePubkey) throw new Error('Invalid bunker URI');

    const { generateSecretKey, getPublicKey } = await import('/js/vendor/nostr-tools/pure.js');
    this._clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(this._clientSecretKey);

    try {
      const { Relay } = await import('/js/vendor/nostr-tools/relay.js');
      this._relay = await Relay.connect(relayUrl);

      await this._nip46Request('connect', [clientPubkey, secret || '']);
      this._connected = true;
    } catch (err) {
      if (this._clientSecretKey) { this._clientSecretKey.fill(0); this._clientSecretKey = null; }
      throw err;
    }
  },

  async getPublicKey() {
    if (!this._connected) await this.connect();
    const result = await this._nip46Request('get_public_key', []);
    return result;
  },

  async signEvent(event) {
    if (!this._connected) await this.connect();
    const eventJson = JSON.stringify(event);
    const result = await this._nip46Request('sign_event', [eventJson]);
    return JSON.parse(result);
  },

  async _nip46Request(method, params) {
    const { finalizeEvent, getPublicKey } = await import('/js/vendor/nostr-tools/pure.js');
    const nip44 = await import('/js/vendor/nostr-tools/nip44.js');

    const clientPubkey = getPublicKey(this._clientSecretKey);
    const id = crypto.randomUUID();
    const convKey = nip44.v2.utils.getConversationKey(this._clientSecretKey, this._remotePubkey);
    const content = nip44.v2.encrypt(
      JSON.stringify({ id, method, params }),
      convKey
    );

    const requestEvent = finalizeEvent({
      kind: 24133,
      content,
      tags: [['p', this._remotePubkey]],
      created_at: Math.floor(Date.now() / 1000),
    }, this._clientSecretKey);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.close();
        reject(new Error('NIP-46 signing timeout (30s)'));
      }, 30000);

      const sub = this._relay.subscribe([
        { kinds: [24133], '#p': [clientPubkey], since: Math.floor(Date.now() / 1000) - 5 },
      ], {
        onevent: async (event) => {
          try {
            const respConvKey = nip44.v2.utils.getConversationKey(this._clientSecretKey, event.pubkey);
            const decrypted = JSON.parse(
              nip44.v2.decrypt(event.content, respConvKey)
            );
            if (decrypted.id === id) {
              clearTimeout(timeout);
              sub.close();
              if (decrypted.error) reject(new Error(decrypted.error));
              else resolve(decrypted.result);
            }
          } catch (e) { /* ignore non-matching events */ }
        },
      });

      this._relay.publish(requestEvent);
    });
  },

  disconnect() {
    if (this._relay) this._relay.close();
    this._connected = false;
    if (this._clientSecretKey) { this._clientSecretKey.fill(0); this._clientSecretKey = null; }
  },
};

// --- Local Key Backend (PIN-protected encrypted keypair) ---

export const LocalKeyBackend = {
  name: 'Local Key (PIN)',
  _secretKey: null,

  isAvailable() {
    return !!localStorage.getItem('mp_encrypted_key');
  },

  async generateAndStore(pin) {
    const { generateSecretKey, getPublicKey } = await import('/js/vendor/nostr-tools/pure.js');
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);

    await this._encryptAndStore(secretKey, pin);
    secretKey.fill(0); // zeroize after encryption
    return pubkey;
  },

  async unlock(pin) {
    const stored = localStorage.getItem('mp_encrypted_key');
    if (!stored) throw new Error('No stored key');

    const { salt, iv, ciphertext } = JSON.parse(stored);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: hexToBytes(salt), iterations: 600000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBytes(iv) },
        derivedKey,
        hexToBytes(ciphertext)
      );
      this._secretKey = new Uint8Array(decrypted);
    } catch {
      throw new Error('Wrong PIN');
    }
  },

  async getPublicKey() {
    if (!this._secretKey) throw new Error('Key not unlocked');
    const { getPublicKey } = await import('/js/vendor/nostr-tools/pure.js');
    return getPublicKey(this._secretKey);
  },

  async signEvent(event) {
    if (!this._secretKey) throw new Error('Key not unlocked');
    const { finalizeEvent } = await import('/js/vendor/nostr-tools/pure.js');
    return finalizeEvent(event, this._secretKey);
  },

  lock() {
    if (this._secretKey) {
      this._secretKey.fill(0);
      this._secretKey = null;
    }
  },

  async _encryptAndStore(secretKey, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      secretKey
    );

    localStorage.setItem('mp_encrypted_key', JSON.stringify({
      salt: bytesToHex(salt),
      iv: bytesToHex(iv),
      ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    }));
  },
};

// --- Auto-detection ---

export function detectBackend() {
  if (Nip07Backend.isAvailable()) return Nip07Backend;
  if (Nip46Backend.isAvailable()) return Nip46Backend;
  if (LocalKeyBackend.isAvailable()) return LocalKeyBackend;
  return null;
}

// --- Helpers ---

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Create an unsigned NIP-98 event for a given method and URL.
 */
export function createNip98Event(pubkey, method, url) {
  return {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['method', method.toUpperCase()],
      ['u', url],
    ],
    content: '',
    pubkey,
  };
}
