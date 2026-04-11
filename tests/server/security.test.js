import { describe, it, expect } from 'vitest';
import { isValidDateString, isValidPhotoHash } from '../../server/validation.js';
import { validateCardInput } from '../../server/routes/cards.js';
import { handleLogout } from '../../server/routes/auth.js';

describe('M2: isValidDateString', () => {
  it('accepts valid YYYY-MM-DD date', () => {
    expect(isValidDateString('2026-04-11')).toBe(true);
  });

  it('accepts leap year date', () => {
    expect(isValidDateString('2024-02-29')).toBe(true);
  });

  it('rejects non-leap year Feb 29', () => {
    expect(isValidDateString('2025-02-29')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidDateString('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidDateString(null)).toBe(false);
  });

  it('rejects ISO datetime format', () => {
    expect(isValidDateString('2026-04-11T00:00:00Z')).toBe(false);
  });

  it('rejects DD-MM-YYYY format', () => {
    expect(isValidDateString('11-04-2026')).toBe(false);
  });

  it('rejects invalid month', () => {
    expect(isValidDateString('2026-13-01')).toBe(false);
  });

  it('rejects invalid day', () => {
    expect(isValidDateString('2026-04-32')).toBe(false);
  });

  it('rejects text string', () => {
    expect(isValidDateString('not-a-date')).toBe(false);
  });
});

describe('M5: photo hash validation', () => {
  it('accepts valid hex photo hash', () => {
    expect(isValidPhotoHash('a'.repeat(64))).toBe(true);
  });

  it('rejects non-hex characters', () => {
    expect(isValidPhotoHash('z'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidPhotoHash('')).toBe(false);
  });

  it('rejects hashes longer than 128 chars', () => {
    expect(isValidPhotoHash('a'.repeat(129))).toBe(false);
  });
});

describe('M10: category bypass removed', () => {
  it('accepts Other category (it is in the valid list)', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'a'.repeat(64),
      category: 'Other',
      match_date: '2026-04-11',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects unknown category', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'a'.repeat(64),
      category: 'SomethingMadeUp',
      match_date: '2026-04-11',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid category');
  });
});

describe('M2: match_date format validation in cards', () => {
  it('rejects invalid match_date format', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'a'.repeat(64),
      category: 'Other',
      match_date: 'not-a-date',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('YYYY-MM-DD');
  });
});

describe('C4: logout token format validation', () => {
  it('returns 204 for missing token', async () => {
    const req = { headers: {} };
    let statusCode;
    const res = {
      status(code) { statusCode = code; return this; },
      end() {},
    };
    await handleLogout(req, res);
    expect(statusCode).toBe(204);
  });

  it('returns 204 for malformed token without DB call', async () => {
    const req = { headers: { authorization: 'Bearer not-hex-and-wrong-length' } };
    let statusCode;
    const res = {
      status(code) { statusCode = code; return this; },
      end() {},
    };
    // If it tried to call the DB, it would throw because we didn't provide one
    // The token format check should short-circuit before that
    await handleLogout(req, res);
    expect(statusCode).toBe(204);
  });
});
