# Nostr-Sourced Staff Roster Implementation Plan

> **NOTE (2026-04-17):** Kind allocations in this plan have been renumbered. Roster kind moved from old 39001 → 31920 (NIP-29 Simple Groups collision); fan chain kinds moved from old 31100–31105 → 31900–31905 (TROTT translation-language collision). The ranges below have been updated. See `CLAUDE.md` and `docs/superpowers/specs/2026-04-16-matchpass-gate-design.md` for current truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PostgreSQL as the source of truth for staff identity with Nostr roster events published by clubs, making the DB a write-through cache.

**Architecture:** Clubs publish a replaceable kind-31920 Nostr event (d-tag `staff-roster`) listing staff pubkeys, roles, and display names as p-tags. MatchPass subscribes to these events, caches them in the existing `staff` table (adding `roster_event_id` and `deactivated_at` columns), and uses the cache for auth lookups. The staff table's foreign keys to 8 other tables remain intact. GDPR erasure pseudonymises rather than deletes.

**Tech Stack:** Node.js/Express, PostgreSQL, nostr-tools, vitest

**Kind number rationale:** 31920 is a parameterised replaceable event (NIP-01 kind range 30000-39999). Using 31920 avoids collision with existing fan credential kinds (31900-31904) and cross-club sanction kinds (30078-30080). The d-tag `staff-roster` scopes it per club.

---

### Task 1: Database Migration — Add Roster Tracking Columns

**Files:**
- Create: `db/migrations/015_add_roster_tracking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Track which roster event populated each staff record, and when deactivated
ALTER TABLE staff ADD COLUMN IF NOT EXISTS roster_event_id TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ;
```

- [ ] **Step 2: Run the migration against local database**

Run: `docker exec matchpass-app-db-1 psql -U matchpass -d matchpass -f /dev/stdin < db/migrations/015_add_roster_tracking.sql`
Expected: columns added, no errors

- [ ] **Step 3: Verify columns exist**

Run: `docker exec matchpass-app-db-1 psql -U matchpass -d matchpass -c "\d staff"`
Expected: `roster_event_id`, `deactivated_at`, `erased_at` columns visible

- [ ] **Step 4: Commit**

```bash
git add db/migrations/015_add_roster_tracking.sql
git commit -m "db: add roster tracking columns to staff table"
```

---

### Task 2: Define Staff Roster Event Kind and Parser

**Files:**
- Create: `server/roster.js`
- Modify: `server/chain/types.js`
- Create: `tests/server/roster.test.js`

This module parses and validates incoming staff roster Nostr events. It does NOT handle relay subscription (that's Task 3). Pure functions, fully testable.

- [ ] **Step 1: Add kind constant to types.js**

In `server/chain/types.js`, add to EVENT_KINDS:

```javascript
export const EVENT_KINDS = {
  MEMBERSHIP: 31900,
  GATE_LOCK: 31901,
  ATTENDANCE: 31902,
  CARD: 31903,
  SANCTION: 31904,
};

export const STAFF_ROSTER_KIND = 31920;
```

- [ ] **Step 2: Write failing tests for roster parsing**

Create `tests/server/roster.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseRosterEvent, buildRosterEvent } from '../../server/roster.js';

const CLUB_PUBKEY = 'aa'.repeat(32);
const STAFF_PUBKEY_1 = 'bb'.repeat(32);
const STAFF_PUBKEY_2 = 'cc'.repeat(32);

function makeRosterEvent(pubkey, pTags, opts = {}) {
  return {
    id: 'dd'.repeat(32),
    pubkey,
    kind: 31920,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'staff-roster'],
      ...pTags,
    ],
    content: '',
    sig: 'ee'.repeat(64),
    ...opts,
  };
}

describe('parseRosterEvent', () => {
  it('parses valid roster with multiple staff', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', STAFF_PUBKEY_1, 'gate_steward', 'Alice'],
      ['p', STAFF_PUBKEY_2, 'admin', 'Bob'],
    ]);
    const result = parseRosterEvent(event);
    expect(result.clubPubkey).toBe(CLUB_PUBKEY);
    expect(result.staff).toHaveLength(2);
    expect(result.staff[0]).toEqual({
      pubkey: STAFF_PUBKEY_1,
      role: 'gate_steward',
      displayName: 'Alice',
    });
    expect(result.staff[1]).toEqual({
      pubkey: STAFF_PUBKEY_2,
      role: 'admin',
      displayName: 'Bob',
    });
  });

  it('rejects event with wrong kind', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', STAFF_PUBKEY_1, 'admin', 'Alice'],
    ], { kind: 1 });
    expect(() => parseRosterEvent(event)).toThrow('Invalid roster event kind');
  });

  it('rejects event without d-tag staff-roster', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', STAFF_PUBKEY_1, 'admin', 'Alice'],
    ]);
    event.tags = event.tags.filter(t => t[0] !== 'd');
    expect(() => parseRosterEvent(event)).toThrow('Missing staff-roster d-tag');
  });

  it('skips p-tags with invalid role', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', STAFF_PUBKEY_1, 'admin', 'Alice'],
      ['p', STAFF_PUBKEY_2, 'superadmin', 'Mallory'],
    ]);
    const result = parseRosterEvent(event);
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0].displayName).toBe('Alice');
  });

  it('skips p-tags with invalid pubkey format', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', 'not-a-pubkey', 'admin', 'Bad'],
      ['p', STAFF_PUBKEY_1, 'admin', 'Good'],
    ]);
    const result = parseRosterEvent(event);
    expect(result.staff).toHaveLength(1);
  });

  it('returns empty staff array for roster with no p-tags', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, []);
    const result = parseRosterEvent(event);
    expect(result.staff).toEqual([]);
  });

  it('uses empty string for missing display name', () => {
    const event = makeRosterEvent(CLUB_PUBKEY, [
      ['p', STAFF_PUBKEY_1, 'gate_steward'],
    ]);
    const result = parseRosterEvent(event);
    expect(result.staff[0].displayName).toBe('');
  });
});

describe('buildRosterEvent', () => {
  it('builds unsigned roster event from staff list', () => {
    const staff = [
      { pubkey: STAFF_PUBKEY_1, role: 'gate_steward', displayName: 'Alice' },
      { pubkey: STAFF_PUBKEY_2, role: 'admin', displayName: 'Bob' },
    ];
    const event = buildRosterEvent(staff);
    expect(event.kind).toBe(31920);
    expect(event.content).toBe('');
    const dTag = event.tags.find(t => t[0] === 'd');
    expect(dTag[1]).toBe('staff-roster');
    const pTags = event.tags.filter(t => t[0] === 'p');
    expect(pTags).toHaveLength(2);
    expect(pTags[0]).toEqual(['p', STAFF_PUBKEY_1, 'gate_steward', 'Alice']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/server/roster.test.js`
Expected: FAIL — module `../../server/roster.js` not found

- [ ] **Step 4: Implement roster.js**

Create `server/roster.js`:

```javascript
// server/roster.js — Parse and build staff roster Nostr events (kind 31920)

import { STAFF_ROSTER_KIND } from './chain/types.js';

const VALID_ROLES = [
  'gate_steward', 'roaming_steward', 'safety_officer',
  'safeguarding_officer', 'admin',
];

/**
 * Parse a staff roster Nostr event into a structured object.
 *
 * Event format:
 *   kind: 31920 (parameterised replaceable)
 *   tags: [["d", "staff-roster"], ["p", pubkey, role, displayName], ...]
 *   content: ""
 *   signed by: club's Nostr key
 *
 * @param {object} event — a Nostr event object
 * @returns {{ clubPubkey: string, eventId: string, staff: Array<{pubkey, role, displayName}> }}
 */
export function parseRosterEvent(event) {
  if (event.kind !== STAFF_ROSTER_KIND) {
    throw new Error('Invalid roster event kind');
  }

  const dTag = event.tags?.find(t => t[0] === 'd' && t[1] === 'staff-roster');
  if (!dTag) {
    throw new Error('Missing staff-roster d-tag');
  }

  const staff = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'p') continue;
    const pubkey = tag[1];
    const role = tag[2];
    const displayName = tag[3] || '';

    if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) continue;
    if (!VALID_ROLES.includes(role)) continue;

    staff.push({ pubkey, role, displayName });
  }

  return {
    clubPubkey: event.pubkey,
    eventId: event.id,
    staff,
  };
}

/**
 * Build an unsigned staff roster event from a list of staff.
 * The caller must sign it with the club's secret key.
 *
 * @param {Array<{pubkey, role, displayName}>} staff
 * @returns {object} unsigned Nostr event
 */
export function buildRosterEvent(staff) {
  return {
    kind: STAFF_ROSTER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'staff-roster'],
      ...staff.map(s => ['p', s.pubkey, s.role, s.displayName]),
    ],
    content: '',
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/roster.test.js`
Expected: all 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/chain/types.js server/roster.js tests/server/roster.test.js
git commit -m "feat: add staff roster event parser (kind 31920)"
```

---

### Task 3: Roster Cache — Upsert Logic

**Files:**
- Create: `server/roster-cache.js`
- Create: `tests/server/roster-cache.test.js`

This module handles upserting parsed roster data into the staff table. Pure database logic, tested with a mock db.

- [ ] **Step 1: Write failing tests**

Create `tests/server/roster-cache.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertRoster } from '../../server/roster-cache.js';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const CLUB_PUBKEY = 'aa'.repeat(32);
const STAFF_1 = 'bb'.repeat(32);
const STAFF_2 = 'cc'.repeat(32);
const EVENT_ID = 'dd'.repeat(32);

function makeMockDb() {
  const queries = [];
  return {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      // SELECT club_id FROM clubs WHERE nostr_pubkey = $1
      if (text.includes('FROM clubs WHERE nostr_pubkey')) {
        return { rows: [{ club_id: CLUB_ID }] };
      }
      // SELECT staff_id, signet_pubkey FROM staff WHERE club_id = $1 AND erased_at IS NULL
      if (text.includes('FROM staff WHERE club_id') && text.includes('erased_at IS NULL')) {
        return { rows: [] };
      }
      // INSERT ... ON CONFLICT
      if (text.includes('INSERT INTO staff')) {
        return { rows: [{ staff_id: '22222222-2222-2222-2222-222222222222' }] };
      }
      // UPDATE staff SET is_active = false
      if (text.includes('UPDATE staff SET is_active = false')) {
        return { rowCount: 0 };
      }
      return { rows: [] };
    }),
    queries,
  };
}

describe('upsertRoster', () => {
  it('inserts new staff from roster event', async () => {
    const db = makeMockDb();
    const roster = {
      clubPubkey: CLUB_PUBKEY,
      eventId: EVENT_ID,
      staff: [
        { pubkey: STAFF_1, role: 'gate_steward', displayName: 'Alice' },
      ],
    };
    const result = await upsertRoster(roster, db);
    expect(result.added).toBe(1);
    expect(result.deactivated).toBe(0);
    // Should have queried clubs table
    const clubQuery = db.query.mock.calls.find(c => c[0].includes('FROM clubs'));
    expect(clubQuery).toBeTruthy();
  });

  it('rejects roster from unknown club', async () => {
    const db = {
      query: vi.fn(async (text) => {
        if (text.includes('FROM clubs')) return { rows: [] };
        return { rows: [] };
      }),
    };
    const roster = {
      clubPubkey: 'ff'.repeat(32),
      eventId: EVENT_ID,
      staff: [{ pubkey: STAFF_1, role: 'admin', displayName: 'Alice' }],
    };
    const result = await upsertRoster(roster, db);
    expect(result).toBeNull();
  });

  it('deactivates staff not in new roster', async () => {
    const db = {
      query: vi.fn(async (text) => {
        if (text.includes('FROM clubs')) return { rows: [{ club_id: CLUB_ID }] };
        if (text.includes('FROM staff WHERE club_id') && text.includes('erased_at IS NULL')) {
          return { rows: [
            { staff_id: 'old-id', signet_pubkey: STAFF_2 },
          ]};
        }
        if (text.includes('INSERT INTO staff')) {
          return { rows: [{ staff_id: 'new-id' }] };
        }
        if (text.includes('UPDATE staff SET is_active = false')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };
    const roster = {
      clubPubkey: CLUB_PUBKEY,
      eventId: EVENT_ID,
      staff: [{ pubkey: STAFF_1, role: 'admin', displayName: 'Alice' }],
    };
    const result = await upsertRoster(roster, db);
    expect(result.deactivated).toBe(1);
  });

  it('skips erased staff records during deactivation', async () => {
    const db = {
      query: vi.fn(async (text) => {
        if (text.includes('FROM clubs')) return { rows: [{ club_id: CLUB_ID }] };
        // Returns no non-erased staff
        if (text.includes('FROM staff WHERE club_id') && text.includes('erased_at IS NULL')) {
          return { rows: [] };
        }
        if (text.includes('INSERT INTO staff')) {
          return { rows: [{ staff_id: 'new-id' }] };
        }
        return { rows: [] };
      }),
    };
    const roster = {
      clubPubkey: CLUB_PUBKEY,
      eventId: EVENT_ID,
      staff: [{ pubkey: STAFF_1, role: 'admin', displayName: 'Alice' }],
    };
    const result = await upsertRoster(roster, db);
    expect(result.deactivated).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/roster-cache.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement roster-cache.js**

Create `server/roster-cache.js`:

```javascript
// server/roster-cache.js — Upsert staff roster into PostgreSQL cache

import * as db from './db.js';

/**
 * Upsert a parsed roster into the staff table.
 *
 * - Looks up club_id by the roster's club pubkey
 * - Upserts each staff member (INSERT ON CONFLICT UPDATE)
 * - Deactivates staff who are no longer in the roster (but not erased ones)
 * - Never DELETEs records (GDPR: pseudonymise, not delete)
 *
 * @param {{ clubPubkey, eventId, staff: Array<{pubkey, role, displayName}> }} roster
 * @param {object} database — injected db (defaults to real db)
 * @returns {{ added: number, updated: number, deactivated: number } | null}
 */
export async function upsertRoster(roster, database = db) {
  // Look up club by Nostr pubkey
  const clubResult = await database.query(
    'SELECT club_id FROM clubs WHERE nostr_pubkey = $1',
    [roster.clubPubkey]
  );
  if (clubResult.rows.length === 0) {
    console.log(`Roster: unknown club pubkey ${roster.clubPubkey.slice(0, 8)}...`);
    return null;
  }
  const clubId = clubResult.rows[0].club_id;

  // Get current non-erased staff for this club
  const currentResult = await database.query(
    'SELECT staff_id, signet_pubkey FROM staff WHERE club_id = $1 AND erased_at IS NULL',
    [clubId]
  );
  const currentPubkeys = new Set(currentResult.rows.map(r => r.signet_pubkey));
  const rosterPubkeys = new Set(roster.staff.map(s => s.pubkey));

  let added = 0;
  let updated = 0;

  // Upsert each staff member from the roster
  for (const member of roster.staff) {
    const result = await database.query(
      `INSERT INTO staff (club_id, signet_pubkey, display_name, role, is_active, roster_event_id, deactivated_at)
       VALUES ($1, $2, $3, $4, true, $5, NULL)
       ON CONFLICT (club_id, signet_pubkey) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           is_active = true,
           roster_event_id = EXCLUDED.roster_event_id,
           deactivated_at = NULL
       RETURNING staff_id`,
      [clubId, member.pubkey, member.displayName, member.role, roster.eventId]
    );
    if (currentPubkeys.has(member.pubkey)) {
      updated++;
    } else {
      added++;
    }
  }

  // Deactivate staff not in the new roster (skip erased records)
  let deactivated = 0;
  for (const pubkey of currentPubkeys) {
    if (!rosterPubkeys.has(pubkey)) {
      const result = await database.query(
        `UPDATE staff SET is_active = false, deactivated_at = NOW()
         WHERE club_id = $1 AND signet_pubkey = $2 AND is_active = true AND erased_at IS NULL`,
        [clubId, pubkey]
      );
      deactivated += result.rowCount;
    }
  }

  console.log(`Roster: club ${clubId} — ${added} added, ${updated} updated, ${deactivated} deactivated`);
  return { added, updated, deactivated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/roster-cache.test.js`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/roster-cache.js tests/server/roster-cache.test.js
git commit -m "feat: add roster cache upsert logic"
```

---

### Task 4: Nostr Subscription for Roster Events

**Files:**
- Modify: `server/nostr.js`

Add roster event subscription alongside the existing sanction subscription. When a roster event arrives, verify its signature, parse it, and upsert the cache.

- [ ] **Step 1: Add roster imports and kind to nostr.js**

At the top of `server/nostr.js`, add:

```javascript
import { parseRosterEvent } from './roster.js';
import { upsertRoster } from './roster-cache.js';
import { STAFF_ROSTER_KIND } from './chain/types.js';
```

- [ ] **Step 2: Add roster subscription in subscribeToNetwork()**

Replace the `subscribeToNetwork` function in `server/nostr.js` with a version that subscribes to both sanctions AND roster events:

```javascript
export async function subscribeToNetwork() {
  if (!relay) return;

  const clubsResult = await query('SELECT nostr_pubkey FROM clubs');
  const knownPubkeys = clubsResult.rows.map(r => r.nostr_pubkey);

  if (knownPubkeys.length === 0) {
    console.log('Nostr: no clubs registered, subscription deferred');
    return;
  }

  if (currentSubscription) {
    currentSubscription.close();
    currentSubscription = null;
  }

  const since = Math.floor(Date.now() / 1000) - 300;
  currentSubscription = relay.subscribe(
    [
      { kinds: [MATCHPASS_RED_CARD, MATCHPASS_SANCTION, MATCHPASS_SANCTION_UPDATE, STAFF_ROSTER_KIND], authors: knownPubkeys, since },
    ],
    {
      onevent: async (event) => {
        try {
          await handleIncomingEvent(event);
        } catch (err) {
          console.error('Nostr: failed to handle incoming event', err);
        }
      },
    }
  );

  console.log(`Nostr: subscribed to ${knownPubkeys.length} club(s)`);
}
```

- [ ] **Step 3: Add roster handling in handleIncomingEvent()**

At the end of the `handleIncomingEvent` function in `server/nostr.js`, add:

```javascript
  if (event.kind === STAFF_ROSTER_KIND) {
    if (!verifyEvent(event)) {
      console.log('Nostr: rejected roster event with invalid signature');
      return;
    }
    try {
      const roster = parseRosterEvent(event);
      await upsertRoster(roster);
    } catch (err) {
      console.error('Nostr: failed to process roster event', err.message);
    }
  }
```

- [ ] **Step 4: Also fetch roster events on startup (not just live subscription)**

For initial cache population, add a one-time fetch after subscribing. In `initNostr`, after `await subscribeToNetwork()`, add a call to fetch existing roster events:

```javascript
export async function initNostr(secretKeyHex) {
  if (secretKeyHex) {
    clubSecretKey = Uint8Array.from(Buffer.from(secretKeyHex, 'hex'));
  } else {
    clubSecretKey = generateSecretKey();
    console.log('Nostr: using ephemeral key. Set NOSTR_SECRET_KEY for production.');
  }

  try {
    relay = await Relay.connect(RELAY_URL);
    console.log(`Nostr: connected to ${RELAY_URL}`);
    await subscribeToNetwork();
    await fetchExistingRosters();
  } catch (err) {
    console.error('Nostr: connection failed, cross-club propagation disabled.', err.message);
    relay = null;
  }
}

async function fetchExistingRosters() {
  if (!relay) return;

  const clubsResult = await query('SELECT nostr_pubkey FROM clubs');
  const knownPubkeys = clubsResult.rows.map(r => r.nostr_pubkey);
  if (knownPubkeys.length === 0) return;

  const events = await relay.list([
    { kinds: [STAFF_ROSTER_KIND], authors: knownPubkeys },
  ]);

  for (const event of events) {
    if (!verifyEvent(event)) continue;
    try {
      const roster = parseRosterEvent(event);
      await upsertRoster(roster);
    } catch (err) {
      console.error('Nostr: failed to process existing roster', err.message);
    }
  }

  console.log(`Nostr: fetched ${events.length} existing roster event(s)`);
}
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS (nostr.js changes don't break existing tests — the relay is mocked/absent in test)

- [ ] **Step 6: Commit**

```bash
git add server/nostr.js
git commit -m "feat: subscribe to staff roster events from relay"
```

---

### Task 5: GDPR Erasure Endpoint

**Files:**
- Modify: `server/routes/staff.js`
- Create: `tests/server/staff-erasure.test.js`

Replace the staff CRUD routes with read-only roster view + GDPR erasure endpoint.

- [ ] **Step 1: Write failing tests for erasure**

Create `tests/server/staff-erasure.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { handleErasure } from '../../server/routes/staff.js';

function makeReq(staffId) {
  return {
    params: { id: staffId },
    staff: { club_id: 'club-1', role: 'admin' },
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  };
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('handleErasure', () => {
  it('pseudonymises staff record on erasure', async () => {
    const req = makeReq(VALID_UUID);
    const res = makeRes();
    const db = {
      query: vi.fn(async (text) => {
        if (text.includes('UPDATE staff SET')) return { rowCount: 1 };
        return { rows: [] };
      }),
    };
    await handleErasure(req, res, db);
    expect(res.status).toHaveBeenCalledWith(204);
    // Verify the UPDATE query pseudonymises display_name and hashes pubkey
    const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE staff SET'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toContain('Former Staff');
    expect(updateCall[0]).toContain('erased_at');
  });

  it('returns 404 for non-existent staff', async () => {
    const req = makeReq(VALID_UUID);
    const res = makeRes();
    const db = {
      query: vi.fn(async () => ({ rowCount: 0 })),
    };
    await handleErasure(req, res, db);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects invalid UUID', async () => {
    const req = makeReq('not-a-uuid');
    const res = makeRes();
    const db = { query: vi.fn() };
    await handleErasure(req, res, db);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/staff-erasure.test.js`
Expected: FAIL — `handleErasure` not exported

- [ ] **Step 3: Rewrite server/routes/staff.js**

Replace the contents of `server/routes/staff.js`:

```javascript
import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { verifyStaff, requireRole } from '../auth.js';
import { isValidUUID } from '../validation.js';
import * as db from '../db.js';

const router = Router();

// GET /api/staff — list cached roster (read-only)
router.get('/', verifyStaff, requireRole('admin', 'safety_officer'), async (req, res) => {
  const result = await query(
    `SELECT staff_id, display_name, role, is_active, created_at, deactivated_at
     FROM staff WHERE club_id = $1 AND erased_at IS NULL
     ORDER BY is_active DESC, created_at ASC`,
    [req.staff.club_id]
  );
  res.json(result.rows);
});

// POST /api/staff/:id/erase — GDPR erasure (pseudonymise, not delete)
export async function handleErasure(req, res, database = db) {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid staff ID' });
  }

  const staffId = req.params.id;
  const hashedMarker = crypto.createHash('sha256')
    .update(`erased-${staffId}`)
    .digest('hex');

  const result = await database.query(
    `UPDATE staff
     SET display_name = 'Former Staff',
         signet_pubkey = $1,
         is_active = false,
         erased_at = NOW(),
         nip05 = NULL
     WHERE staff_id = $2 AND club_id = $3 AND erased_at IS NULL`,
    [hashedMarker, staffId, req.staff.club_id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Staff record not found or already erased' });
  }

  res.status(204).end();
}

router.post('/:id/erase', verifyStaff, requireRole('admin'), (req, res) => handleErasure(req, res));

export default router;
```

- [ ] **Step 4: Run erasure tests to verify they pass**

Run: `npx vitest run tests/server/staff-erasure.test.js`
Expected: all 3 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS. The `staff-auth.test.js` tests only use `requireRole` which hasn't changed. The old staff CRUD tests (if any exist separately) may need updating — check output.

- [ ] **Step 6: Commit**

```bash
git add server/routes/staff.js tests/server/staff-erasure.test.js
git commit -m "feat: replace staff CRUD with read-only roster + GDPR erasure"
```

---

### Task 6: Admin UI — Read-Only Roster View

**Files:**
- Modify: `public/views/admin.html`
- Modify: `public/js/admin.js`

Replace the staff add/remove form with a read-only view of the cached roster, plus a link to Signet for managing it.

- [ ] **Step 1: Update admin.html — replace staff section**

Replace the `<!-- Staff -->` section in `public/views/admin.html` with:

```html
        <!-- Staff Roster (read-only — managed in Signet) -->
        <div style="background:#1e293b;padding:1.5rem;border-radius:12px;margin-bottom:1.5rem;">
            <h2 style="font-family:Georgia,serif;font-size:1.1rem;color:#d8f3dc;margin-bottom:0.25rem;">Staff Roster</h2>
            <p style="color:#64748b;font-size:0.85rem;margin-bottom:1rem;">Managed via your club&rsquo;s Signet roster. Changes sync automatically.</p>
            <div id="admin-staff-list" style="margin-bottom:1rem;"></div>
            <a href="https://mysignet.app" target="_blank" rel="noopener" style="display:inline-block;background:#059669;color:white;padding:0.6rem 1.2rem;border-radius:8px;text-decoration:none;font-size:0.9rem;">Manage Roster in Signet</a>
        </div>
```

- [ ] **Step 2: Update admin.js — remove staff CRUD, keep read-only load**

Replace `public/js/admin.js` with:

```javascript
import { api } from './api.js';
import { escapeHtml } from './utils.js';

export async function initAdmin() {
  await loadClub();
  await loadSeason();
  await loadStaff();
}

async function loadClub() {
  try {
    const club = await api('/api/clubs/mine');
    document.getElementById('admin-name').value = club.name || '';
    document.getElementById('admin-ground').value = club.ground_name || '';
    document.getElementById('admin-league').value = club.league || '';
    document.getElementById('admin-fa').value = club.fa_affiliation || '';
  } catch (err) {
    console.error(err);
  }
}

async function loadSeason() {
  try {
    const season = await api('/api/seasons/active');
    document.getElementById('admin-active-season').innerHTML =
      `<div style="padding:0.75rem;background:#0f172a;border-radius:8px;border-left:4px solid #059669;">
        <span style="font-weight:700;color:#d8f3dc;">${escapeHtml(season.name)}</span>
        <span style="font-size:0.8rem;color:#64748b;margin-left:0.5rem;">${escapeHtml(season.start_date)} to ${escapeHtml(season.end_date)}</span>
      </div>`;
  } catch (err) {
    document.getElementById('admin-active-season').innerHTML =
      '<p style="color:#64748b;font-style:italic;">No active season. Create one below.</p>';
  }
}

async function loadStaff() {
  try {
    const staff = await api('/api/staff');
    const el = document.getElementById('admin-staff-list');
    if (staff.length === 0) {
      el.innerHTML = '<p style="color:#64748b;font-style:italic;">No staff in roster. Publish a roster from Signet to get started.</p>';
    } else {
      el.innerHTML = staff.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#0f172a;border-radius:8px;margin-bottom:0.5rem;">
          <div>
            <span style="font-weight:700;color:#d8f3dc;">${escapeHtml(s.display_name || 'Unnamed')}</span>
            <span style="font-size:0.8rem;color:#64748b;margin-left:0.5rem;">${escapeHtml(s.role.replaceAll('_', ' '))}</span>
          </div>
          ${s.is_active
            ? '<span style="color:#059669;font-size:0.8rem;">Active</span>'
            : `<span style="color:#64748b;font-size:0.8rem;">Inactive${s.deactivated_at ? ' — ' + new Date(s.deactivated_at).toLocaleDateString('en-GB') : ''}</span>`
          }
        </div>
      `).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

window.saveClub = async function() {
  try {
    await api('/api/clubs/mine', {
      method: 'PUT',
      body: {
        name: document.getElementById('admin-name').value,
        ground_name: document.getElementById('admin-ground').value,
        league: document.getElementById('admin-league').value,
        fa_affiliation: document.getElementById('admin-fa').value || null,
      },
    });
    alert('Club profile saved.');
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
};

window.createSeason = async function() {
  const name = document.getElementById('admin-season-name').value;
  const start = document.getElementById('admin-season-start').value;
  const end = document.getElementById('admin-season-end').value;
  if (!name || !start || !end) { alert('All season fields required'); return; }
  try {
    await api('/api/seasons', {
      method: 'POST',
      body: { name, start_date: start, end_date: end },
    });
    await loadSeason();
    document.getElementById('admin-season-name').value = '';
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add public/views/admin.html public/js/admin.js
git commit -m "feat: admin UI shows read-only roster, managed via Signet"
```

---

### Task 7: Auth Rate-Limit for Signet Endpoint

**Files:**
- Modify: `server/index.js`

The new `/api/auth/signet` endpoint needs the same rate limiting as `/api/auth/login`.

- [ ] **Step 1: Add rate limit for signet auth**

In `server/index.js`, after the existing login rate limiter, add:

```javascript
app.use('/api/auth/signet', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' },
}));
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "fix: add rate limit to /api/auth/signet endpoint"
```

---

### Task 8: Signet-Side Specification Document

**Files:**
- Create: `docs/signet-roster-spec.md`

Document what Signet needs to implement for the roster publishing side. This is a spec for the Signet team (the user's other tab), not code in this repo.

- [ ] **Step 1: Write the spec**

Create `docs/signet-roster-spec.md`:

```markdown
# Signet Staff Roster Publishing Spec

## Overview

Signet must allow club admins to publish a staff roster as a Nostr event.
MatchPass subscribes to these events and uses them for staff authorisation.

## Event Format

- **Kind:** 31920 (parameterised replaceable, NIP-01)
- **d-tag:** `staff-roster`
- **p-tags:** One per staff member: `["p", "<hex-pubkey>", "<role>", "<display-name>"]`
- **Content:** empty string
- **Signed by:** The club's Nostr key (same key used for sanctions)

### Valid Roles

| Role | Description |
|------|-------------|
| `gate_steward` | Scans fans at the gate |
| `roaming_steward` | Issues cards during matches |
| `safety_officer` | Views dashboard and match reports |
| `safeguarding_officer` | Manages child linkages and verifications |
| `admin` | Full access including club profile and roster |

### Example Event

```json
{
  "kind": 31920,
  "tags": [
    ["d", "staff-roster"],
    ["p", "1fce2009b4caf3aee06338757d1f1aeecfcaa46800b77b19e9cfc16dbc9b1d69", "admin", "Test Admin"],
    ["p", "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234", "gate_steward", "Gate Vol 1"]
  ],
  "content": "",
  "created_at": 1744567890
}
```

### Behaviour

- Publishing a new roster event **replaces** the previous one (same kind + d-tag = replaceable).
- Staff removed from the roster lose access on the next MatchPass sync (typically seconds).
- Staff added to the roster gain access on the next sync.
- The club admin should be able to add/remove staff personas and assign roles via a UI.
- The roster should be published to the relay configured in Signet's connection settings.

### Relay Requirements

- The roster event must be published to a relay that MatchPass subscribes to.
- Currently: the relay configured via `NOSTR_RELAY_URL` env var on the MatchPass server.
- Signet should use the same relay the club is already connected to for sanctions.

### Trust Model

- MatchPass trusts roster events signed by known club pubkeys (clubs registered via bootstrap).
- The club pubkey is registered in the MatchPass `clubs` table.
- Signet does NOT need to authenticate with MatchPass — the Nostr signature is the auth.
```

- [ ] **Step 2: Commit**

```bash
git add docs/signet-roster-spec.md
git commit -m "docs: add Signet staff roster publishing spec"
```

---

### Task 9: Integration Test — End-to-End Roster Flow

**Files:**
- Create: `tests/server/roster-integration.test.js`

Test the full flow: roster event arrives → cache updates → auth succeeds.

- [ ] **Step 1: Write the integration test**

Create `tests/server/roster-integration.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn(() => true),
}));

import { parseRosterEvent } from '../../server/roster.js';
import { upsertRoster } from '../../server/roster-cache.js';
import { verifySignetRedirect, _resetReplayCache } from '../../server/auth.js';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const CLUB_PUBKEY = 'aa'.repeat(32);
const STAFF_PUBKEY = 'bb'.repeat(32);
const STAFF_ID = '22222222-2222-2222-2222-222222222222';

describe('roster → auth integration', () => {
  beforeEach(() => _resetReplayCache());

  it('staff can sign in after roster upsert', async () => {
    // Step 1: Parse a roster event
    const event = {
      id: 'dd'.repeat(32),
      pubkey: CLUB_PUBKEY,
      kind: 31920,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'staff-roster'],
        ['p', STAFF_PUBKEY, 'gate_steward', 'Alice'],
      ],
      content: '',
      sig: 'ee'.repeat(64),
    };
    const roster = parseRosterEvent(event);
    expect(roster.staff).toHaveLength(1);

    // Step 2: Upsert the roster
    const upsertDb = {
      query: vi.fn(async (text) => {
        if (text.includes('FROM clubs')) return { rows: [{ club_id: CLUB_ID }] };
        if (text.includes('FROM staff WHERE club_id') && text.includes('erased_at IS NULL')) return { rows: [] };
        if (text.includes('INSERT INTO staff')) return { rows: [{ staff_id: STAFF_ID }] };
        return { rows: [] };
      }),
    };
    const result = await upsertRoster(roster, upsertDb);
    expect(result.added).toBe(1);

    // Step 3: Auth lookup succeeds for the same pubkey
    const authDb = {
      query: vi.fn(async () => ({
        rows: [{ staff_id: STAFF_ID, club_id: CLUB_ID, role: 'gate_steward', display_name: 'Alice' }],
      })),
    };
    const req = {
      body: {
        pubkey: STAFF_PUBKEY,
        signature: 'ab'.repeat(64),
        eventId: 'cd'.repeat(32),
      },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    // Mock schnorr.verify to return true for this test
    const { schnorr } = await import('@noble/curves/secp256k1.js');
    vi.spyOn(schnorr, 'verify').mockReturnValue(true);

    await verifySignetRedirect(req, res, next, authDb);
    expect(next).toHaveBeenCalled();
    expect(req.staff.role).toBe('gate_steward');
    expect(req.staff.display_name).toBe('Alice');

    schnorr.verify.mockRestore();
  });

  it('staff cannot sign in after roster removal', async () => {
    // Auth lookup returns empty (staff was deactivated by roster update)
    const authDb = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const req = {
      body: {
        pubkey: STAFF_PUBKEY,
        signature: 'ab'.repeat(64),
        eventId: 'ef'.repeat(32),
      },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    const { schnorr } = await import('@noble/curves/secp256k1.js');
    vi.spyOn(schnorr, 'verify').mockReturnValue(true);

    await verifySignetRedirect(req, res, next, authDb);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    schnorr.verify.mockRestore();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/server/roster-integration.test.js`
Expected: all 2 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/server/roster-integration.test.js
git commit -m "test: add roster → auth integration tests"
```

---

### Task 10: Final Verification and Cleanup

- [ ] **Step 1: Run full test suite one final time**

Run: `npx vitest run`
Expected: all tests PASS — no regressions

- [ ] **Step 2: Verify migration is ready for production**

Run: `docker exec matchpass-app-db-1 psql -U matchpass -d matchpass -c "\d staff"`
Expected: `roster_event_id`, `deactivated_at`, `erased_at` columns visible

- [ ] **Step 3: Verify the existing auth flow still works**

Run: `npx vitest run tests/server/auth.test.js tests/server/session-auth.test.js tests/server/staff-auth.test.js`
Expected: all existing auth tests PASS unchanged

- [ ] **Step 4: Final commit — update service worker cache version**

In `public/sw.js`, bump `CACHE_NAME` from `matchpass-v2` to `matchpass-v3`.

```bash
git add public/sw.js
git commit -m "chore: bump SW cache to v3 for roster changes"
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `db/migrations/015_add_roster_tracking.sql` | Create | Add `roster_event_id`, `deactivated_at`, `erased_at` columns |
| `server/chain/types.js` | Modify | Add `STAFF_ROSTER_KIND = 31920` constant |
| `server/roster.js` | Create | Parse and build staff roster Nostr events |
| `server/roster-cache.js` | Create | Upsert parsed rosters into staff table cache |
| `server/nostr.js` | Modify | Subscribe to roster events, fetch on startup |
| `server/routes/staff.js` | Rewrite | Read-only roster view + GDPR erasure endpoint |
| `server/index.js` | Modify | Rate limit for `/api/auth/signet` |
| `public/views/admin.html` | Modify | Read-only staff roster, link to Signet |
| `public/js/admin.js` | Rewrite | Remove staff CRUD, keep read-only load |
| `public/sw.js` | Modify | Bump cache version |
| `docs/signet-roster-spec.md` | Create | Spec for Signet-side roster publishing |
| `tests/server/roster.test.js` | Create | Roster parser unit tests |
| `tests/server/roster-cache.test.js` | Create | Cache upsert unit tests |
| `tests/server/staff-erasure.test.js` | Create | GDPR erasure endpoint tests |
| `tests/server/roster-integration.test.js` | Create | End-to-end roster → auth flow tests |
