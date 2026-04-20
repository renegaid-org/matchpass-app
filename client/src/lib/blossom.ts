/**
 * Fetch a photo from a Blossom server, decrypt it with the fan-provided
 * key, and verify the hash matches. Used to show the steward the fan's
 * photo for manual verification.
 *
 * The fan's Signet app encrypts photos with AES-GCM using a per-photo
 * key. The x tag on the venue entry event is the SHA-256 of the
 * *plaintext* photo (the hash the gate-lock event committed to). We
 * verify the decrypted bytes match that hash.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface PhotoResult {
  blobUrl: string;
  mimeType: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const HEX64_RE = /^[0-9a-f]{64}$/i;

// Reject URLs pointing to loopback / link-local / RFC1918 / metadata endpoints.
// The Blossom URL arrives in a fan-signed QR, so it is attacker-controlled.
function isBlossomHostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.localhost')) return true;
  if (h === '169.254.169.254') return true;
  if (h === 'metadata.google.internal') return true;
  if (/^10\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^(fe80:|fc00:|fd00:|::1)/i.test(h)) return true;
  return false;
}

export function validateBlossomUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid Blossom URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Blossom URL must use https:// (got ${parsed.protocol})`);
  }
  if (isBlossomHostBlocked(parsed.hostname)) {
    throw new Error(`Blossom host ${parsed.hostname} is blocked`);
  }
  return parsed;
}

export async function fetchAndDecryptPhoto(params: {
  blossomUrl: string;
  photoHash: string;
  photoKey: string;
}): Promise<PhotoResult> {
  if (!HEX64_RE.test(params.photoHash)) {
    throw new Error('photo_hash must be 64 hex chars');
  }
  if (!HEX64_RE.test(params.photoKey)) {
    throw new Error('photo_key must be 64 hex chars');
  }
  const base = validateBlossomUrl(params.blossomUrl);
  const url = `${base.toString().replace(/\/$/, '')}/${params.photoHash}`;

  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Blossom fetch failed: ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo too large (${contentLength} bytes)`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo too large (${buffer.byteLength} bytes)`);
  }
  const ciphertext = new Uint8Array(buffer);

  // Signet's encryption layout: [iv: 12B][ciphertext+tag].
  if (ciphertext.length < 28) {
    throw new Error('Photo payload too short');
  }
  const iv = ciphertext.slice(0, 12);
  const body = ciphertext.slice(12);

  const keyBytes = hexToBytes(params.photoKey);
  if (keyBytes.length !== 32) {
    throw new Error('photo_key must be 32 bytes');
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes).buffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv).buffer },
      cryptoKey,
      new Uint8Array(body).buffer,
    ),
  );

  const actualHash = bytesToHex(sha256(decrypted));
  if (actualHash !== params.photoHash) {
    throw new Error('Photo hash mismatch');
  }

  // Detect MIME type from magic bytes (JPEG / PNG / WebP).
  let mimeType = 'image/jpeg';
  if (decrypted[0] === 0x89 && decrypted[1] === 0x50) mimeType = 'image/png';
  else if (decrypted[0] === 0x52 && decrypted[1] === 0x49) mimeType = 'image/webp';

  const blob = new Blob([new Uint8Array(decrypted)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, mimeType };
}
