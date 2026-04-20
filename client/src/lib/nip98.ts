/**
 * NIP-98 HTTP Auth header builder.
 *
 * The matchpass-app PWA signs each authenticated HTTP request with a kind
 * 27235 event via its NIP-46 signer (Signet). The server verifies the
 * signature and the method/url tags.
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/98.md
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { EventTemplate } from '../types';

export interface Nip98Signer {
  signEvent(template: EventTemplate): Promise<{
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    sig: string;
  }>;
}

/**
 * Build a base64-encoded NIP-98 auth event for the given request.
 * Returns the value to use in the `Authorization` header after "Nostr ".
 */
export async function buildNip98AuthHeader(
  method: string,
  url: string,
  body: unknown,
  signer: Nip98Signer,
): Promise<string> {
  const tags: string[][] = [
    ['u', url],
    ['method', method.toUpperCase()],
  ];
  if (body !== undefined && method.toUpperCase() !== 'GET') {
    const payloadString = typeof body === 'string' ? body : JSON.stringify(body);
    const hash = bytesToHex(sha256(new TextEncoder().encode(payloadString)));
    tags.push(['payload', hash]);
  }

  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };

  const signed = await signer.signEvent(template);
  const json = JSON.stringify(signed);
  return 'Nostr ' + btoa(json);
}
