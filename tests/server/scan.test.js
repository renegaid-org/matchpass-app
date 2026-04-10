import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeScanResult, checkDuplicateScan, verifyVenueEntryEvent } from '../../server/routes/scan.js';

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn((event) => event._testValid !== false),
}));

describe('computeScanResult', () => {
  it('returns green with needsGateLock for clean fan with no gate-lock', () => {
    const result = computeScanResult({
      fanPubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      photoHash: 'sha256abc',
      cards: [],
      sanctions: [],
      gateLock: null,
      seasonId: 'season-1',
    });
    expect(result.colour).toBe('green');
    expect(result.needsGateLock).toBe(true);
    expect(result.photoMismatch).toBe(false);
  });

  it('returns green without needsGateLock when photo matches gate-lock', () => {
    const result = computeScanResult({
      fanPubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      photoHash: 'sha256abc',
      cards: [],
      sanctions: [],
      gateLock: { photo_hash: 'sha256abc' },
      seasonId: 'season-1',
    });
    expect(result.colour).toBe('green');
    expect(result.needsGateLock).toBe(false);
    expect(result.photoMismatch).toBe(false);
  });

  it('returns amber with photoMismatch when photo hash differs from gate-lock', () => {
    const result = computeScanResult({
      fanPubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      photoHash: 'sha256abc',
      cards: [],
      sanctions: [],
      gateLock: { photo_hash: 'sha256different' },
      seasonId: 'season-1',
    });
    expect(result.colour).toBe('amber');
    expect(result.photoMismatch).toBe(true);
    expect(result.reason).toContain('Photo mismatch');
  });

  it('returns red for banned fan even without gate-lock', () => {
    const result = computeScanResult({
      fanPubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      photoHash: 'sha256abc',
      cards: [],
      sanctions: [{ sanction_type: 'ban', status: 'active', end_date: '2027-01-01' }],
      gateLock: null,
      seasonId: 'season-1',
    });
    expect(result.colour).toBe('red');
    expect(result.needsGateLock).toBe(true);
  });

  it('returns amber for fan with active yellow and matching gate-lock', () => {
    const result = computeScanResult({
      fanPubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      photoHash: 'sha256abc',
      cards: [{ card_type: 'yellow', status: 'active' }],
      sanctions: [],
      gateLock: { photo_hash: 'sha256abc' },
      seasonId: 'season-1',
    });
    expect(result.colour).toBe('amber');
    expect(result.yellowCount).toBe(1);
  });
});

describe('verifyVenueEntryEvent', () => {
  function validEvent(overrides = {}) {
    return {
      kind: 21235,
      pubkey: 'a'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'signet-venue-entry'], ['x', 'b'.repeat(64)]],
      content: '',
      id: 'c'.repeat(64),
      sig: 'd'.repeat(128),
      ...overrides,
    };
  }

  it('accepts a valid venue entry event', () => {
    const result = verifyVenueEntryEvent(validEvent());
    expect(result.pubkey).toBe('a'.repeat(64));
    expect(result.photo_hash).toBe('b'.repeat(64));
  });

  it('extracts null photo_hash when no x tag', () => {
    const event = validEvent({ tags: [['t', 'signet-venue-entry']] });
    const result = verifyVenueEntryEvent(event);
    expect(result.photo_hash).toBeNull();
  });

  it('rejects wrong kind', () => {
    expect(() => verifyVenueEntryEvent(validEvent({ kind: 1 }))).toThrow('Wrong event kind');
  });

  it('rejects missing signet-venue-entry tag', () => {
    expect(() => verifyVenueEntryEvent(validEvent({ tags: [] }))).toThrow('Not a venue entry event');
  });

  it('rejects expired QR (>60s old)', () => {
    const old = Math.floor(Date.now() / 1000) - 120;
    expect(() => verifyVenueEntryEvent(validEvent({ created_at: old }))).toThrow('QR expired');
  });

  it('rejects future timestamp (>10s ahead)', () => {
    const future = Math.floor(Date.now() / 1000) + 30;
    expect(() => verifyVenueEntryEvent(validEvent({ created_at: future }))).toThrow('future');
  });

  it('rejects invalid signature', () => {
    const event = validEvent();
    event._testValid = false;
    expect(() => verifyVenueEntryEvent(event)).toThrow('Invalid signature');
  });

  it('rejects null/undefined event', () => {
    expect(() => verifyVenueEntryEvent(null)).toThrow();
    expect(() => verifyVenueEntryEvent(undefined)).toThrow();
  });

  it('rejects event with missing pubkey', () => {
    expect(() => verifyVenueEntryEvent(validEvent({ pubkey: '' }))).toThrow('Missing or invalid pubkey');
  });
});

describe('checkDuplicateScan', () => {
  it('returns null when no prior admissions', () => {
    expect(checkDuplicateScan([], 'staff-1')).toBeNull();
  });

  it('returns stewardError when same staff within 30 seconds', () => {
    const now = Date.now();
    const priorAdmissions = [{
      scan_id: 'scan-1', staff_id: 'staff-1', gate_id: 'gate-A',
      created_at: new Date(now - 10_000).toISOString(),
    }];
    const result = checkDuplicateScan(priorAdmissions, 'staff-1', now);
    expect(result).toEqual({ stewardError: true });
  });

  it('returns flag when same staff after 30 seconds', () => {
    const now = Date.now();
    const priorAdmissions = [{
      scan_id: 'scan-1', staff_id: 'staff-1', gate_id: 'gate-A',
      created_at: new Date(now - 31_000).toISOString(),
    }];
    const result = checkDuplicateScan(priorAdmissions, 'staff-1', now);
    expect(result).toEqual({ flag: true });
  });

  it('returns flag when different staff regardless of timing', () => {
    const now = Date.now();
    const priorAdmissions = [{
      scan_id: 'scan-1', staff_id: 'staff-1', gate_id: 'gate-A',
      created_at: new Date(now - 5_000).toISOString(),
    }];
    const result = checkDuplicateScan(priorAdmissions, 'staff-2', now);
    expect(result).toEqual({ flag: true });
  });

  it('returns stewardError at exactly 29 seconds same staff', () => {
    const now = Date.now();
    const priorAdmissions = [{
      scan_id: 'scan-1', staff_id: 'staff-1', gate_id: 'gate-A',
      created_at: new Date(now - 29_000).toISOString(),
    }];
    const result = checkDuplicateScan(priorAdmissions, 'staff-1', now);
    expect(result).toEqual({ stewardError: true });
  });

  it('returns flag at exactly 30 seconds same staff', () => {
    const now = Date.now();
    const priorAdmissions = [{
      scan_id: 'scan-1', staff_id: 'staff-1', gate_id: 'gate-A',
      created_at: new Date(now - 30_000).toISOString(),
    }];
    const result = checkDuplicateScan(priorAdmissions, 'staff-1', now);
    expect(result).toEqual({ flag: true });
  });
});
