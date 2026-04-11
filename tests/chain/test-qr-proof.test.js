import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  generateQRProof,
  verifyQRProof,
  isProofFresh,
  STATUS,
  createMembership,
} from '../../server/chain/index.js';

describe('generateQRProof', () => {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const tipId = 'a'.repeat(64);

  it('produces a base64 string', () => {
    const proof = generateQRProof(fanPk, tipId, STATUS.CLEAN, fanSk);
    expect(typeof proof).toBe('string');
    // Base64 of 133 bytes = ceil(133/3)*4 = 178 chars (with padding)
    const decoded = Buffer.from(proof, 'base64');
    expect(decoded.length).toBe(133);
  });

  it('rejects invalid pubkey', () => {
    expect(() => generateQRProof('short', tipId, STATUS.CLEAN, fanSk)).toThrow('Invalid fan pubkey');
  });

  it('rejects invalid chain tip', () => {
    expect(() => generateQRProof(fanPk, 'short', STATUS.CLEAN, fanSk)).toThrow('Invalid chain tip');
  });

  it('rejects invalid status', () => {
    expect(() => generateQRProof(fanPk, tipId, 5, fanSk)).toThrow('Invalid status');
  });
});

describe('verifyQRProof', () => {
  const fanSk = generateSecretKey();
  const fanPk = getPublicKey(fanSk);
  const tipId = 'b'.repeat(64);

  it('verifies a valid proof', () => {
    const proof = generateQRProof(fanPk, tipId, STATUS.YELLOW, fanSk);
    const result = verifyQRProof(proof);
    expect(result.valid).toBe(true);
    expect(result.fanPubkey).toBe(fanPk);
    expect(result.chainTip).toBe(tipId);
    expect(result.status).toBe(STATUS.YELLOW);
    expect(typeof result.timestamp).toBe('number');
  });

  it('rejects a tampered proof (flipped byte)', () => {
    const proof = generateQRProof(fanPk, tipId, STATUS.CLEAN, fanSk);
    const bytes = Buffer.from(proof, 'base64');
    // Flip a byte in the status field
    bytes[64] = bytes[64] ^ 0xff;
    const tampered = bytes.toString('base64');
    const result = verifyQRProof(tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects a proof with wrong length', () => {
    const result = verifyQRProof(Buffer.from('too short').toString('base64'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('length');
  });

  it('rejects a proof signed by a different key', () => {
    const otherSk = generateSecretKey();
    // Generate proof with the wrong secret key (mismatch with pubkey in the proof)
    const proof = generateQRProof(fanPk, tipId, STATUS.CLEAN, otherSk);
    const result = verifyQRProof(proof);
    // The signature is valid for the other key, but the pubkey in the message is fanPk
    // so schnorr.verify checks sig against fanPk and it should fail
    expect(result.valid).toBe(false);
  });

  it('handles invalid base64 gracefully', () => {
    const result = verifyQRProof('not-valid-base64!!!');
    // Buffer.from with base64 is lenient, so this may decode to wrong length
    expect(result.valid).toBe(false);
  });
});

describe('isProofFresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for a proof generated just now', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isProofFresh({ timestamp: now })).toBe(true);
  });

  it('returns false for a proof older than maxAge', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isProofFresh({ timestamp: now - 60 }, 30)).toBe(false);
  });

  it('returns false for a proof with timestamp in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isProofFresh({ timestamp: now + 60 })).toBe(false);
  });

  it('returns false for null/undefined proof', () => {
    expect(isProofFresh(null)).toBe(false);
    expect(isProofFresh(undefined)).toBe(false);
  });

  it('respects custom maxAge', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isProofFresh({ timestamp: now - 5 }, 10)).toBe(true);
    expect(isProofFresh({ timestamp: now - 15 }, 10)).toBe(false);
  });
});

describe('round-trip with real chain event', () => {
  it('generates and verifies a proof using a real chain tip event ID', () => {
    const fanSk = generateSecretKey();
    const fanPk = getPublicKey(fanSk);
    const clubPk = getPublicKey(generateSecretKey());

    const membership = createMembership(fanPk, clubPk, fanSk);
    const proof = generateQRProof(fanPk, membership.id, STATUS.CLEAN, fanSk);
    const result = verifyQRProof(proof);

    expect(result.valid).toBe(true);
    expect(result.fanPubkey).toBe(fanPk);
    expect(result.chainTip).toBe(membership.id);
    expect(result.status).toBe(STATUS.CLEAN);
  });
});
