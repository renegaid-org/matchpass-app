import { describe, it, expect } from 'vitest';
import { validateCardInput } from '../../server/routes/cards.js';

describe('validateCardInput', () => {
  it('accepts valid yellow card input', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Verbal abuse (toward steward)',
      match_date: '2026-09-14',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid card_type', () => {
    const result = validateCardInput({
      card_type: 'blue',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Other',
      match_date: '2026-09-14',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('card_type');
  });

  it('rejects missing fan_signet_pubkey', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      category: 'Other',
      match_date: '2026-09-14',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing category', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      match_date: '2026-09-14',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing match_date', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Other',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects notes over 280 characters', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Other',
      match_date: '2026-09-14',
      notes: 'x'.repeat(281),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('280');
  });

  it('accepts notes at exactly 280 characters', () => {
    const result = validateCardInput({
      card_type: 'yellow',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Other',
      match_date: '2026-09-14',
      notes: 'x'.repeat(280),
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid red card input', () => {
    const result = validateCardInput({
      card_type: 'red',
      fan_signet_pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category: 'Discriminatory behaviour',
      match_date: '2026-09-14',
    });
    expect(result.valid).toBe(true);
  });
});
