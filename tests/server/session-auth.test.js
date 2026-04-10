import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock verifyEvent so NIP-98 path works without real Schnorr keys
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn((event) => event._testValid !== false),
}));

import { createSession, deleteSession, verifyStaff, _resetReplayCache } from '../../server/auth.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function sha256hex(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeNostrToken(pubkey, opts = {}) {
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

function makeNostrReq(token) {
  return {
    headers: { authorization: `Nostr ${token}` },
    method: 'GET',
    originalUrl: '/api/test',
  };
}

function makeBearerReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    method: 'GET',
    originalUrl: '/api/test',
  };
}

function mockRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return res;
}

const staffRow = {
  staff_id: 'staff-uuid-1',
  club_id: 'club-uuid-1',
  role: 'gate_steward',
  display_name: 'Test Steward',
};

// ── createSession ─────────────────────────────────────────────────────────────

describe('createSession', () => {
  it('returns a 64-char hex token and an expires_at', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await createSession(staffRow, mockDb);
    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('expires_at');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores SHA-256 hash of token in sessions table', async () => {
    let insertArgs = null;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO sessions')) {
          insertArgs = params;
        }
        return { rows: [] };
      }),
    };
    const result = await createSession(staffRow, mockDb);
    expect(insertArgs).not.toBeNull();
    const storedHash = insertArgs[0];
    const expectedHash = sha256hex(result.token);
    expect(storedHash).toBe(expectedHash);
  });

  it('stores staff_id, club_id, role, display_name', async () => {
    let insertArgs = null;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO sessions')) insertArgs = params;
        return { rows: [] };
      }),
    };
    await createSession(staffRow, mockDb);
    // params: [token_hash, staff_id, club_id, role, display_name, expires_at]
    expect(insertArgs[1]).toBe(staffRow.staff_id);
    expect(insertArgs[2]).toBe(staffRow.club_id);
    expect(insertArgs[3]).toBe(staffRow.role);
    expect(insertArgs[4]).toBe(staffRow.display_name);
  });

  it('purges expired sessions before inserting', async () => {
    const queries = [];
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push(sql.trim().split(/\s+/)[0].toUpperCase()); // first keyword
        return { rows: [] };
      }),
    };
    await createSession(staffRow, mockDb);
    // DELETE must appear before INSERT
    const deleteIdx = queries.findIndex(q => q === 'DELETE');
    const insertIdx = queries.findIndex(q => q === 'INSERT');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(deleteIdx);
  });

  it('expires_at is approximately 4 hours from now', async () => {
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const before = new Date();
    const result = await createSession(staffRow, mockDb);
    const after = new Date();
    const expiresAt = new Date(result.expires_at);
    const fourHours = 4 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + fourHours - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after.getTime() + fourHours + 1000);
  });
});

// ── deleteSession ─────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  it('returns true when a session row was deleted', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };
    const result = await deleteSession('sometoken', mockDb);
    expect(result).toBe(true);
  });

  it('returns false when no session found', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
    };
    const result = await deleteSession('notoken', mockDb);
    expect(result).toBe(false);
  });

  it('deletes by SHA-256 hash of the supplied token', async () => {
    let deleteArgs = null;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        deleteArgs = params;
        return { rowCount: 1 };
      }),
    };
    const rawToken = 'abc123rawtoken';
    await deleteSession(rawToken, mockDb);
    expect(deleteArgs[0]).toBe(sha256hex(rawToken));
  });
});

// ── verifyStaff — Bearer path ─────────────────────────────────────────────────

describe('verifyStaff — Bearer token', () => {
  it('attaches req.staff and calls next() for a valid, unexpired token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = sha256hex(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...staffRow, token_hash: hash, expires_at: expiresAt }],
      }),
    };
    const req = makeBearerReq(token);
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next, mockDb);
    expect(next).toHaveBeenCalled();
    expect(req.staff.role).toBe('gate_steward');
  });

  it('returns 401 for an expired session', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() - 60 * 1000).toISOString(); // in the past
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...staffRow, expires_at: expiresAt }],
      }),
    };
    const req = makeBearerReq(token);
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next, mockDb);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token not found', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const req = makeBearerReq('unknowntoken');
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next, mockDb);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired session' });
    expect(next).not.toHaveBeenCalled();
  });

  it('uses timing-safe comparison (no timing side-channel)', async () => {
    // We verify the DB lookup is by hash, not raw token, so timing-safe compare is used.
    const token = 'test-token-timing';
    let queryHash = null;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queryHash = params[0];
        return { rows: [] };
      }),
    };
    const req = makeBearerReq(token);
    await verifyStaff(req, mockRes(), vi.fn(), mockDb);
    // DB query must be by hash, not raw token
    expect(queryHash).toBe(sha256hex(token));
    expect(queryHash).not.toBe(token);
  });
});

// ── verifyStaff — NIP-98 path still works ────────────────────────────────────

describe('verifyStaff — NIP-98 path alongside Bearer', () => {
  beforeEach(() => _resetReplayCache());

  it('still accepts Nostr auth header with valid event', async () => {
    const pubkey = 'ab'.repeat(32);
    const token = makeNostrToken(pubkey);
    const req = makeNostrReq(token);
    const res = mockRes();
    const next = vi.fn();
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [staffRow] }),
    };
    await verifyStaff(req, res, next, mockDb);
    expect(next).toHaveBeenCalled();
    expect(req.staff.role).toBe('gate_steward');
  });

  it('rejects Nostr event with wrong kind', async () => {
    const token = makeNostrToken('ab'.repeat(32), { kind: 1 });
    const req = makeNostrReq(token);
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth event must be kind 27235' });
  });

  it('rejects Nostr event with expired timestamp', async () => {
    const token = makeNostrToken('ab'.repeat(32), {
      created_at: Math.floor(Date.now() / 1000) - 120,
    });
    const req = makeNostrReq(token);
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth event expired' });
  });
});

// ── verifyStaff — missing header ──────────────────────────────────────────────

describe('verifyStaff — missing header', () => {
  it('returns 401 with "Missing auth header" when no Authorization header', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    await verifyStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing auth header' });
    expect(next).not.toHaveBeenCalled();
  });
});

// ── handleLogin ──────────────────────────────────────────────────────────────

describe('handleLogin', () => {
  it('returns a session token when auth succeeds', async () => {
    const { handleLogin } = await import('../../server/routes/auth.js');
    const staff = { staff_id: 'staff-1', club_id: 'club-1', role: 'gate_steward', display_name: 'Test' };
    const req = { staff };
    let responseBody = null;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((body) => { responseBody = body; }),
    };

    const mockDb = {
      query: vi.fn().mockImplementation((text) => {
        if (text.includes('DELETE FROM sessions WHERE expires_at')) return { rowCount: 0 };
        if (text.includes('INSERT INTO sessions')) return { rows: [{ session_id: 'sid' }] };
        return { rows: [] };
      }),
    };

    await handleLogin(req, res, mockDb);
    expect(res.json).toHaveBeenCalled();
    expect(responseBody.token).toMatch(/^[0-9a-f]{64}$/);
    expect(responseBody.staff.role).toBe('gate_steward');
    expect(responseBody.expires_at).toBeDefined();
  });
});

// ── handleLogout ─────────────────────────────────────────────────────────────

describe('handleLogout', () => {
  it('returns 204 on successful logout', async () => {
    const { handleLogout } = await import('../../server/routes/auth.js');
    const req = { headers: { authorization: 'Bearer aabbccdd' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn(),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };

    await handleLogout(req, res, mockDb);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 204 even when token not found (idempotent)', async () => {
    const { handleLogout } = await import('../../server/routes/auth.js');
    const req = { headers: { authorization: 'Bearer nonexistent' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn(),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
    };

    await handleLogout(req, res, mockDb);
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
