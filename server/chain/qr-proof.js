// server/chain/qr-proof.js — QR proof generation and verification
//
// Proof format (133 bytes):
//   pubkey(32) + tipHash(32) + status(1) + timestamp(4) + schnorrSig(64)
// Encoded as base64 for QR transport.

import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

/**
 * Generate a compressed QR proof.
 *
 * @param {string} fanPubkey - 64-char hex pubkey
 * @param {string} chainTipEventId - 64-char hex event ID of the chain tip
 * @param {number} status - Status byte (0=clean, 1=yellow, 2=red, 3=banned)
 * @param {Uint8Array} fanSeckey - 32-byte secret key
 * @returns {string} Base64-encoded proof
 */
export function generateQRProof(fanPubkey, chainTipEventId, status, fanSeckey) {
  if (typeof fanPubkey !== 'string' || fanPubkey.length !== 64) {
    throw new Error('Invalid fan pubkey');
  }
  if (typeof chainTipEventId !== 'string' || chainTipEventId.length !== 64) {
    throw new Error('Invalid chain tip event ID');
  }
  if (typeof status !== 'number' || status < 0 || status > 3) {
    throw new Error('Invalid status byte');
  }

  const pubkeyBytes = hexToBytes(fanPubkey);
  const tipBytes = hexToBytes(chainTipEventId);
  const timestamp = Math.floor(Date.now() / 1000);

  // Build the message to sign: pubkey(32) + tip(32) + status(1) + timestamp(4)
  const message = new Uint8Array(69);
  message.set(pubkeyBytes, 0);
  message.set(tipBytes, 32);
  message[64] = status;
  // Write timestamp as big-endian uint32
  message[65] = (timestamp >>> 24) & 0xff;
  message[66] = (timestamp >>> 16) & 0xff;
  message[67] = (timestamp >>> 8) & 0xff;
  message[68] = timestamp & 0xff;

  // Schnorr sign the 69-byte message
  const signature = schnorr.sign(message, fanSeckey);

  // Assemble the full proof: message(69) + signature(64) = 133 bytes
  const proof = new Uint8Array(133);
  proof.set(message, 0);
  proof.set(signature, 69);

  return Buffer.from(proof).toString('base64');
}

/**
 * Decode and verify a QR proof.
 *
 * @param {string} proofBase64 - Base64-encoded proof string
 * @returns {{ valid: boolean, fanPubkey?: string, chainTip?: string, status?: number, timestamp?: number, error?: string }}
 */
export function verifyQRProof(proofBase64) {
  try {
    const proof = Buffer.from(proofBase64, 'base64');
    if (proof.length !== 133) {
      return { valid: false, error: `Invalid proof length: ${proof.length}, expected 133` };
    }

    const pubkeyBytes = proof.subarray(0, 32);
    const tipBytes = proof.subarray(32, 64);
    const status = proof[64];
    const timestamp =
      (proof[65] << 24) | (proof[66] << 16) | (proof[67] << 8) | proof[68];
    // Handle potential negative from left shift of bit 31
    const timestampUnsigned = timestamp >>> 0;

    const message = proof.subarray(0, 69);
    const signature = proof.subarray(69, 133);

    const fanPubkey = bytesToHex(pubkeyBytes);

    // Verify the Schnorr signature against the fan's pubkey
    const valid = schnorr.verify(signature, message, pubkeyBytes);

    if (!valid) {
      return { valid: false, error: 'Invalid Schnorr signature' };
    }

    return {
      valid: true,
      fanPubkey,
      chainTip: bytesToHex(tipBytes),
      status,
      timestamp: timestampUnsigned,
    };
  } catch (err) {
    return { valid: false, error: `Proof verification failed: ${err.message}` };
  }
}

/**
 * Check whether a proof is still fresh (not stale).
 *
 * @param {{ timestamp: number }} proof - Decoded proof object
 * @param {number} maxAgeSeconds - Maximum age in seconds (default 30)
 * @returns {boolean}
 */
export function isProofFresh(proof, maxAgeSeconds = 30) {
  if (!proof || typeof proof.timestamp !== 'number') return false;
  const now = Math.floor(Date.now() / 1000);
  const age = now - proof.timestamp;
  return age >= 0 && age <= maxAgeSeconds;
}
