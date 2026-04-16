import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyNip98, requireRole, _resetReplayCache } from '../server/auth.js';
import { RosterCache } from '../server/roster-cache.js';

function mockRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return res;
}

describe('verifyNip98', () => {
  let rosterCache;
  beforeEach(() => {
    rosterCache = new RosterCache();
    _resetReplayCache();
  });

  it('rejects missing auth header', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects Bearer auth (only Nostr accepted)', () => {
    const req = { headers: { authorization: 'Bearer abc123' } };
    const res = mockRes();
    const next = vi.fn();
    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects malformed base64', () => {
    const req = { headers: { authorization: 'Nostr !!!invalid!!!' } };
    const res = mockRes();
    const next = vi.fn();
    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireRole', () => {
  it('passes when role matches', () => {
    const req = { staff: { role: 'safety_officer' } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes for admin regardless', () => {
    const req = { staff: { role: 'admin' } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects insufficient role', () => {
    const req = { staff: { role: 'gate_steward' } };
    const res = mockRes();
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects when not authenticated', () => {
    const req = {};
    const res = mockRes();
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
