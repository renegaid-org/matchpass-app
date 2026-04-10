import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn(() => true),
}));

import { requireRole } from '../../server/auth.js';

describe('requireRole', () => {
  function makeRes() {
    return { status: vi.fn().mockReturnThis(), json: vi.fn() };
  }

  it('allows admin to create staff', () => {
    const req = { staff: { role: 'admin' } };
    const res = makeRes();
    const next = vi.fn();
    requireRole('admin', 'safeguarding_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows safeguarding_officer to create staff', () => {
    const req = { staff: { role: 'safeguarding_officer' } };
    const res = makeRes();
    const next = vi.fn();
    requireRole('admin', 'safeguarding_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects gate_steward from creating staff', () => {
    const req = { staff: { role: 'gate_steward' } };
    const res = makeRes();
    const next = vi.fn();
    requireRole('admin', 'safeguarding_officer')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
