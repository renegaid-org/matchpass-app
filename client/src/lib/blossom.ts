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

export async function fetchAndDecryptPhoto(params: {
  blossomUrl: string;
  photoHash: string;
  photoKey: string;
}): Promise<PhotoResult> {
  const url = `${params.blossomUrl.replace(/\/$/, '')}/${params.photoHash}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Blossom fetch failed: ${response.status}`);
  }
  const ciphertext = new Uint8Array(await response.arrayBuffer());

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
