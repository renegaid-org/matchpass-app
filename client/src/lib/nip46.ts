/**
 * NIP-46 Remote Signer client (PWA side).
 *
 * Flow:
 * 1. PWA generates an ephemeral keypair (session key).
 * 2. PWA builds a `nostrconnect://` URI carrying the session pubkey and a
 *    relay URL. This is shown as a QR; the user scans it with Signet.
 * 3. Signet responds with an encrypted kind 24133 "connect" event
 *    addressed to the session pubkey. The decrypted content contains
 *    the user's real pubkey — now we have the remote signer identity.
 * 4. To sign, PWA publishes an encrypted sign_event request to the
 *    remote pubkey via the relay. Signet prompts the user, signs, and
 *    replies with an encrypted result event.
 *
 * Reference spec: https://github.com/nostr-protocol/nips/blob/master/46.md
 */

import { Relay } from 'nostr-tools/relay';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { UnsignedEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import type { EventTemplate, NostrEvent } from '../types';

const NIP46_KIND = 24133;
const DEFAULT_RELAY = 'wss://relay.trotters.cc';

export interface PairingState {
  sessionSecret: Uint8Array;
  sessionPubkey: string;
  relayUrl: string;
  remotePubkey: string | null;
  connectedAt: number | null;
  appName: string;
  appUrl: string;
}

export type PairingStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; uri: string; sessionPubkey: string }
  | { kind: 'connected'; remotePubkey: string }
  | { kind: 'error'; message: string };

interface PendingRequest {
  resolve(result: string): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class Nip46Client {
  private relay: Relay | null = null;
  private sub: { close(): void } | null = null;
  private state: PairingState;
  private statusListeners = new Set<(s: PairingStatus) => void>();
  private pending = new Map<string, PendingRequest>();
  private signRequestTimeoutMs = 60_000;

  constructor(opts: {
    relayUrl?: string;
    appName?: string;
    appUrl?: string;
    existing?: { sessionSecretHex: string; remotePubkey: string; relayUrl: string };
  } = {}) {
    if (opts.existing) {
      const sessionSecret = hexToBytes(opts.existing.sessionSecretHex);
      this.state = {
        sessionSecret,
        sessionPubkey: getPublicKey(sessionSecret),
        relayUrl: opts.existing.relayUrl,
        remotePubkey: opts.existing.remotePubkey,
        connectedAt: Date.now(),
        appName: opts.appName || 'matchpass-app',
        appUrl: opts.appUrl || 'https://matchpass.app',
      };
    } else {
      const sessionSecret = generateSecretKey();
      this.state = {
        sessionSecret,
        sessionPubkey: getPublicKey(sessionSecret),
        relayUrl: opts.relayUrl || DEFAULT_RELAY,
        remotePubkey: null,
        connectedAt: null,
        appName: opts.appName || 'matchpass-app',
        appUrl: opts.appUrl || 'https://matchpass.app',
      };
    }
  }

  onStatus(fn: (s: PairingStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emit(s: PairingStatus) {
    for (const fn of this.statusListeners) fn(s);
  }

  get sessionSecretHex(): string {
    return bytesToHex(this.state.sessionSecret);
  }

  get remotePubkey(): string | null {
    return this.state.remotePubkey;
  }

  get relayUrl(): string {
    return this.state.relayUrl;
  }

  /** Build the nostrconnect:// URI to display as a QR. */
  get connectUri(): string {
    const metadata = JSON.stringify({
      name: this.state.appName,
      url: this.state.appUrl,
    });
    const relayParam = encodeURIComponent(this.state.relayUrl);
    const metaParam = encodeURIComponent(metadata);
    return `nostrconnect://${this.state.sessionPubkey}?relay=${relayParam}&metadata=${metaParam}`;
  }

  /**
   * Connect to the relay and subscribe to inbound NIP-46 events.
   * Must be called before the URI can be used.
   */
  async start(): Promise<void> {
    if (this.relay) return;
    this.relay = await Relay.connect(this.state.relayUrl);
    this.subscribe();
    if (this.state.remotePubkey) {
      this.emit({ kind: 'connected', remotePubkey: this.state.remotePubkey });
    } else {
      this.emit({
        kind: 'waiting',
        uri: this.connectUri,
        sessionPubkey: this.state.sessionPubkey,
      });
    }
  }

  private subscribe() {
    if (!this.relay) return;
    this.sub = this.relay.subscribe(
      [{ kinds: [NIP46_KIND], '#p': [this.state.sessionPubkey] }],
      {
        onevent: (event) => this.handleIncoming(event).catch(err => console.warn('NIP-46 handle error', err)),
      },
    );
  }

  private async handleIncoming(event: NostrEvent | UnsignedEvent): Promise<void> {
    const signedEvent = event as NostrEvent;
    const conversationKey = nip44.v2.utils.getConversationKey(
      this.state.sessionSecret,
      signedEvent.pubkey,
    );
    let plaintext: string;
    try {
      plaintext = nip44.v2.decrypt(signedEvent.content, conversationKey);
    } catch (err) {
      console.warn('NIP-46 decrypt failed', err);
      return;
    }

    let parsed: { id?: string; result?: string; error?: string; method?: string; params?: string[] };
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      return;
    }

    // Connect event: first reply from Signet — its pubkey in result.
    if (!this.state.remotePubkey && parsed.result && /^[0-9a-f]{64}$/i.test(parsed.result)) {
      this.state.remotePubkey = parsed.result;
      this.state.connectedAt = Date.now();
      this.emit({ kind: 'connected', remotePubkey: parsed.result });
      return;
    }

    // Response to an outstanding request.
    if (parsed.id && this.pending.has(parsed.id)) {
      const req = this.pending.get(parsed.id)!;
      clearTimeout(req.timer);
      this.pending.delete(parsed.id);
      if (parsed.error) req.reject(new Error(parsed.error));
      else if (parsed.result !== undefined) req.resolve(parsed.result);
      else req.reject(new Error('Malformed NIP-46 response'));
    }
  }

  private async sendEncrypted(toPubkey: string, content: string): Promise<void> {
    if (!this.relay) throw new Error('Relay not connected');
    const conversationKey = nip44.v2.utils.getConversationKey(
      this.state.sessionSecret,
      toPubkey,
    );
    const encrypted = nip44.v2.encrypt(content, conversationKey);
    const template: UnsignedEvent = {
      kind: NIP46_KIND,
      pubkey: this.state.sessionPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', toPubkey]],
      content: encrypted,
    };
    const signed = finalizeEvent(template, this.state.sessionSecret);
    await this.relay.publish(signed);
  }

  /** Ask the remote signer to sign an event template. */
  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    if (!this.state.remotePubkey) throw new Error('Not connected to a remote signer');
    if (!this.relay) throw new Error('Relay not connected');

    const id = crypto.randomUUID();
    const request = {
      id,
      method: 'sign_event',
      params: [JSON.stringify(template)],
    };

    const resultPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Signer request timed out'));
      }, this.signRequestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    await this.sendEncrypted(this.state.remotePubkey, JSON.stringify(request));
    const resultJson = await resultPromise;
    return JSON.parse(resultJson) as NostrEvent;
  }

  /** Ask the remote signer for its public key (round-trip sanity check). */
  async getPublicKey(): Promise<string> {
    if (!this.state.remotePubkey) throw new Error('Not connected');
    const id = crypto.randomUUID();
    const request = { id, method: 'get_public_key', params: [] };
    const result = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('get_public_key timed out'));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    await this.sendEncrypted(this.state.remotePubkey, JSON.stringify(request));
    return result;
  }

  disconnect(): void {
    this.sub?.close();
    this.sub = null;
    this.relay?.close();
    this.relay = null;
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('Client disconnected'));
      this.pending.delete(id);
    }
  }

  forget(): void {
    this.disconnect();
    this.state.remotePubkey = null;
    this.state.connectedAt = null;
    this.emit({ kind: 'idle' });
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
