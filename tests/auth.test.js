import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyNip98, requireRole, _resetReplayCache } from '../server/auth.js';
import { RosterCache } from '../server/roster-cache.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

function buildAuthHeader(sk, { method = 'GET', url = 'http://localhost/api/gate/scan', createdAt } = {}) {
  const event = finalizeEvent({
    kind: 27235,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    tags: [['method', method], ['u', url]],
    content: '',
  }, sk);
  return { header: 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64'), event };
}

function mockReq({ authHeader, method = 'GET', originalUrl = '/api/gate/scan', host = 'localhost' }) {
  return {
    headers: { authorization: authHeader, host },
    method,
    originalUrl,
    get(h) { return h.toLowerCase() === 'host' ? host : undefined; },
  };
}

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

  it('rejects replay of a previously-consumed auth event', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    // Seed roster so the replay check is not short-circuited by the staff lookup.
    const rosterEvent = {
      id: 'r', kind: 31920, pubkey: 'c'.repeat(64), created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'staff-roster'], ['p', pk, 'gate_steward', 'Alice']],
      content: '', sig: 'x'.repeat(128),
    };
    rosterCache.set('c'.repeat(64), rosterEvent);
    const { header } = buildAuthHeader(sk);
    const req1 = mockReq({ authHeader: header });
    const req2 = mockReq({ authHeader: header });
    const next1 = vi.fn(); const next2 = vi.fn();
    const res1 = mockRes(); const res2 = mockRes();
    verifyNip98(rosterCache)(req1, res1, next1);
    expect(next1).toHaveBeenCalled();
    verifyNip98(rosterCache)(req2, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(401);
    expect(next2).not.toHaveBeenCalled();
  });

  it('rejects method-tag mismatch BEFORE spending a signature verification', () => {
    // Build an event with method=GET but submit as POST. Structural check fires
    // before verifyEvent(), so even a schnorr-invalid signature would be
    // rejected on the cheap path. We assert 401 + method-tag message.
    const sk = generateSecretKey();
    const { header } = buildAuthHeader(sk, { method: 'GET' });
    const req = mockReq({ authHeader: header, method: 'POST' });
    const res = mockRes();
    const next = vi.fn();
    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toMatch(/Method tag mismatch/);
  });

  it('rejects expired created_at', () => {
    const sk = generateSecretKey();
    const { header } = buildAuthHeader(sk, { createdAt: Math.floor(Date.now() / 1000) - 300 });
    const req = mockReq({ authHeader: header });
    const res = mockRes();
    verifyNip98(rosterCache)(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error).toMatch(/expired/);
  });

  it('rejects mismatched host in URL tag', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    rosterCache.set('c'.repeat(64), {
      id: 'r', kind: 31920, pubkey: 'c'.repeat(64), created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'staff-roster'], ['p', pk, 'gate_steward', 'Alice']],
      content: '', sig: 'x'.repeat(128),
    });
    const { header } = buildAuthHeader(sk, { url: 'http://evil.example/api/gate/scan' });
    const req = mockReq({ authHeader: header, host: 'localhost' });
    const res = mockRes();
    verifyNip98(rosterCache)(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error).toMatch(/host mismatch/);
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
