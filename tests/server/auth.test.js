import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock verifyEvent from nostr-tools so we can test without real Schnorr signatures
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn((event) => event._testValid !== false),
}));

import { verifyStaff, requireRole, _resetReplayCache } from '../../server/auth.js';

// Helper: create a valid-looking NIP-98 auth event
function makeAuthToken(pubkey, opts = {}) {
  const event = {
    pubkey,
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['method', 'GET'], ['u', 'http://localhost:3000/api/test']],
    sig: 'fakesig',
    id: `fakeid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...opts,
  };
  return Buffer.from(JSON.stringify(event)).toString('base64');
}

function makeReq(token) {
  return { headers: { authorization: `Nostr ${token}` }, method: 'GET', originalUrl: '/api/test' };
}

describe('verifyStaff', () => {
  beforeEach(() => _resetReplayCache());
  it('rejects requests without Authorization header', async () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing auth header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid base64', async () => {
    const req = { headers: { authorization: 'Nostr !!!invalid!!!' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects events with wrong kind', async () => {
    const token = makeAuthToken('ab'.repeat(32), { kind: 1 });
    const req = makeReq(token);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth event must be kind 27235' });
  });

  it('rejects when pubkey not found in staff table', async () => {
    const token = makeAuthToken('ab'.repeat(32));
    const req = makeReq(token);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await verifyStaff(req, res, next, mockDb);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('attaches staff info to req when valid', async () => {
    const pubkey = 'ab'.repeat(32);
    const token = makeAuthToken(pubkey);
    const req = makeReq(token);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ staff_id: 'abc', club_id: 'club1', role: 'gate_steward', display_name: 'Test' }],
      }),
    };
    await verifyStaff(req, res, next, mockDb);
    expect(next).toHaveBeenCalled();
    expect(req.staff.role).toBe('gate_steward');
  });

  it('rejects expired events', async () => {
    const token = makeAuthToken('ab'.repeat(32), { created_at: Math.floor(Date.now() / 1000) - 120 });
    const req = makeReq(token);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth event expired' });
  });
});

describe('requireRole', () => {
  it('allows matching role', () => {
    const req = { staff: { role: 'safety_officer' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows admin for any role check', () => {
    const req = { staff: { role: 'admin' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects non-matching role', () => {
    const req = { staff: { role: 'gate_steward' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRole('safety_officer')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
