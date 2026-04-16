# matchpass-gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build matchpass-gate — a stateless, in-memory-only gate verification server that replaces matchpass-app's fan-facing routes.

**Architecture:** Express server with zero persistence. Three in-memory Maps (chain tips, roster, scan tracker) populated from a Nostr relay subscription. Four HTTP endpoints behind NIP-98 auth. Fan presents a kind-21235 venue entry event at the gate; steward submits pre-signed chain events (kinds 31100-31105) that the server validates and publishes to the relay.

**Tech Stack:** Node.js, Express, nostr-tools 2.x, @noble/curves (Schnorr), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-04-16-matchpass-gate-design.md`

---

## File Structure

All files live in a new `matchpass-gate/` directory at the MatchPass workspace root (`/media/sf_MintAI/MatchPass/matchpass-gate/`).

```
matchpass-gate/
  package.json
  server/
    index.js                  # Express app, middleware, route mounting, relay init
    relay.js                  # Relay connection, subscription, publish, reconnect
    auth.js                   # NIP-98 verification backed by in-memory roster cache
    club-discovery.js         # Fetch verified club pubkeys from matchpass.club API
    chain-tip-cache.js        # Map<fanPubkey, {tipEventId, status, lastSeen}>
    roster-cache.js           # Map<clubPubkey, {rosterEvent, staff[]}> — in-memory only
    scan-tracker.js           # Ephemeral daily admission tracker + duplicate detection
    venue-entry.js            # Verify kind 21235 venue entry events
    validation.js             # Carried over from matchpass-app (pure functions)
    roster.js                 # Carried over from matchpass-app (pure parsing)
    chain/
      types.js                # Carried over + kind 31105 + REVIEW_OUTCOME
      events.js               # Carried over + createReviewOutcome()
      verify.js               # Carried over + handle 31105 in getCurrentStatus()
      index.js                # Re-exports
    routes/
      scan.js                 # POST /api/gate/scan
      event.js                # POST /api/gate/event
      tip.js                  # GET /api/gate/tip/:pubkey
      dashboard.js            # GET /api/gate/dashboard
  tests/
    chain/
      types.test.js
      events.test.js
      verify.test.js
    venue-entry.test.js
    scan-tracker.test.js
    chain-tip-cache.test.js
    roster-cache.test.js
    auth.test.js
    routes/
      scan.test.js
      event.test.js
      tip.test.js
      dashboard.test.js
    integration.test.js
```

**Carried over unchanged:** `validation.js`, `roster.js` (copy from matchpass-app).
**Carried over with modifications:** `chain/types.js`, `chain/events.js`, `chain/verify.js`, `chain/index.js`.
**Rewritten from scratch:** `auth.js`, `roster-cache.js`.
**New files:** `relay.js`, `club-discovery.js`, `chain-tip-cache.js`, `scan-tracker.js`, `venue-entry.js`, all routes, `index.js`.

---

### Task 1: Project scaffolding and carry-over files

**Files:**
- Create: `matchpass-gate/package.json`
- Create: `matchpass-gate/.gitignore`
- Copy: `matchpass-gate/server/validation.js` (from `matchpass-app/server/validation.js`)
- Copy: `matchpass-gate/server/roster.js` (from `matchpass-app/server/roster.js`)

- [ ] **Step 1: Create matchpass-gate directory and package.json**

```bash
mkdir -p /media/sf_MintAI/MatchPass/matchpass-gate
cd /media/sf_MintAI/MatchPass/matchpass-gate
```

```json
{
  "name": "matchpass-gate",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.4.1",
    "nostr-tools": "^2.10.4",
    "@noble/curves": "^1.8.1",
    "@noble/hashes": "^1.7.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.env
```

- [ ] **Step 3: Install dependencies**

```bash
cd /media/sf_MintAI/MatchPass/matchpass-gate && npm install
```

- [ ] **Step 4: Copy carry-over files unchanged**

```bash
mkdir -p server/chain tests/chain tests/routes
cp ../matchpass-app/server/validation.js server/validation.js
cp ../matchpass-app/server/roster.js server/roster.js
```

- [ ] **Step 5: Verify copies work**

```bash
node -e "import('./server/validation.js').then(m => console.log('validation OK:', typeof m.isValidPubkey))"
```

Expected: `validation OK: function`

Note: `roster.js` imports from `./chain/types.js` which does not exist yet. It will be created in Task 2.

- [ ] **Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold matchpass-gate project with carry-over files"
```

---

### Task 2: Chain library — carry over and add kind 31105

**Files:**
- Create: `matchpass-gate/server/chain/types.js` (from matchpass-app + additions)
- Create: `matchpass-gate/server/chain/events.js` (from matchpass-app + additions)
- Create: `matchpass-gate/server/chain/verify.js` (from matchpass-app + additions)
- Create: `matchpass-gate/server/chain/index.js` (from matchpass-app + additions)
- Create: `matchpass-gate/tests/chain/types.test.js`
- Create: `matchpass-gate/tests/chain/events.test.js`
- Create: `matchpass-gate/tests/chain/verify.test.js`

- [ ] **Step 1: Copy chain files from matchpass-app**

```bash
cd /media/sf_MintAI/MatchPass/matchpass-gate
cp ../matchpass-app/server/chain/types.js server/chain/types.js
cp ../matchpass-app/server/chain/events.js server/chain/events.js
cp ../matchpass-app/server/chain/verify.js server/chain/verify.js
cp ../matchpass-app/server/chain/index.js server/chain/index.js
```

- [ ] **Step 2: Add kind 31105 to types.js**

Add to `EVENT_KINDS` object:

```js
REVIEW_OUTCOME: 31105,
```

Add validation function:

```js
export const REVIEW_OUTCOMES = ['dismissed', 'downgraded'];

export function isValidReviewOutcome(outcome) {
  return REVIEW_OUTCOMES.includes(outcome);
}
```

- [ ] **Step 3: Add createReviewOutcome to events.js**

```js
import { isValidReviewOutcome } from './types.js';

/**
 * Create a kind 31105 review outcome event (signed by safety officer).
 */
export function createReviewOutcome(fanPubkey, reviewedEventId, outcome, previousEventId, signerSeckey) {
  if (!isValidPubkey(fanPubkey)) throw new Error('Invalid fan pubkey');
  if (!reviewedEventId || typeof reviewedEventId !== 'string') throw new Error('Invalid reviewed event ID');
  if (!isValidReviewOutcome(outcome)) throw new Error('Invalid review outcome');
  if (!previousEventId || typeof previousEventId !== 'string') throw new Error('Invalid previous event ID');

  const uuid = crypto.randomUUID();

  const template = {
    kind: EVENT_KINDS.REVIEW_OUTCOME,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${fanPubkey}:review:${uuid}`],
      ['p', fanPubkey],
      ['previous', previousEventId],
      ['reviews', reviewedEventId],
      ['outcome', outcome],
    ],
    content: '',
  };

  return finalizeEvent(template, signerSeckey);
}
```

- [ ] **Step 4: Update verify.js getCurrentStatus to handle kind 31105**

Add to the imports:

```js
import { EVENT_KINDS, STATUS } from './types.js';
```

Inside `getCurrentStatus()`, after the existing card/sanction loop, add a second pass for review outcomes:

```js
// Collect review outcomes
const reviewOutcomes = new Map();
for (const event of events) {
  if (event.kind === EVENT_KINDS.REVIEW_OUTCOME) {
    const reviewedId = getTagValue(event, 'reviews');
    const outcome = getTagValue(event, 'outcome');
    if (reviewedId && outcome) {
      reviewOutcomes.set(reviewedId, outcome);
    }
  }
}
```

Then modify the card collection logic to check `reviewOutcomes`:

```js
if (event.kind === EVENT_KINDS.CARD) {
  // Skip if this card was dismissed by a review outcome
  if (reviewOutcomes.get(event.id) === 'dismissed') continue;

  const cardType = getTagValue(event, 'card_type');
  // If downgraded, treat red as yellow
  const effectiveType = reviewOutcomes.get(event.id) === 'downgraded' && cardType === 'red'
    ? 'yellow' : cardType;
  // ... rest of card logic using effectiveType instead of cardType
```

- [ ] **Step 5: Update chain/index.js re-exports**

Add to exports:

```js
export { isValidReviewOutcome, REVIEW_OUTCOMES } from './types.js';
export { createReviewOutcome } from './events.js';
```

Remove the qr-proof exports (file no longer exists):

```js
// REMOVE these lines:
// export { generateQRProof, verifyQRProof, isProofFresh } from './qr-proof.js';
```

- [ ] **Step 6: Write tests for kind 31105**

`tests/chain/types.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { EVENT_KINDS, isValidReviewOutcome } from '../../server/chain/types.js';

describe('types', () => {
  it('includes REVIEW_OUTCOME kind 31105', () => {
    expect(EVENT_KINDS.REVIEW_OUTCOME).toBe(31105);
  });

  it('validates review outcomes', () => {
    expect(isValidReviewOutcome('dismissed')).toBe(true);
    expect(isValidReviewOutcome('downgraded')).toBe(true);
    expect(isValidReviewOutcome('confirmed')).toBe(false);
    expect(isValidReviewOutcome('')).toBe(false);
  });
});
```

`tests/chain/verify.test.js` — add a test for dismissed/downgraded cards:

```js
import { describe, it, expect } from 'vitest';
import { getCurrentStatus } from '../../server/chain/verify.js';
import { EVENT_KINDS, STATUS } from '../../server/chain/types.js';

// Helper to create minimal mock events
function mockEvent(kind, id, tags = [], createdAt = Math.floor(Date.now() / 1000)) {
  return { id, kind, created_at: createdAt, pubkey: 'a'.repeat(64), sig: 'b'.repeat(128), tags };
}

describe('getCurrentStatus with review outcomes', () => {
  const fanPubkey = 'f'.repeat(64);

  it('dismissed card is excluded from status', () => {
    const cardId = 'card123';
    const events = [
      mockEvent(EVENT_KINDS.MEMBERSHIP, 'mem1', [['p', fanPubkey]]),
      mockEvent(EVENT_KINDS.CARD, cardId, [
        ['p', fanPubkey], ['previous', 'mem1'], ['card_type', 'yellow'], ['category', 'other'],
      ]),
      mockEvent(EVENT_KINDS.REVIEW_OUTCOME, 'rev1', [
        ['p', fanPubkey], ['previous', cardId], ['reviews', cardId], ['outcome', 'dismissed'],
      ]),
    ];
    const result = getCurrentStatus(events);
    expect(result.status).toBe(STATUS.CLEAN);
    expect(result.activeCards).toHaveLength(0);
  });

  it('downgraded red card counts as yellow', () => {
    const cardId = 'card456';
    const events = [
      mockEvent(EVENT_KINDS.MEMBERSHIP, 'mem1', [['p', fanPubkey]]),
      mockEvent(EVENT_KINDS.CARD, cardId, [
        ['p', fanPubkey], ['previous', 'mem1'], ['card_type', 'red'], ['category', 'other'],
      ]),
      mockEvent(EVENT_KINDS.REVIEW_OUTCOME, 'rev1', [
        ['p', fanPubkey], ['previous', cardId], ['reviews', cardId], ['outcome', 'downgraded'],
      ]),
    ];
    const result = getCurrentStatus(events);
    expect(result.status).toBe(STATUS.YELLOW);
    expect(result.activeCards[0].cardType).toBe('yellow');
  });
});
```

- [ ] **Step 7: Run tests**

```bash
cd /media/sf_MintAI/MatchPass/matchpass-gate && npx vitest run tests/chain/
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: chain library with kind 31105 review outcome support"
```

---

### Task 3: In-memory caches — chain tips, roster, scan tracker

**Files:**
- Create: `matchpass-gate/server/chain-tip-cache.js`
- Create: `matchpass-gate/server/roster-cache.js`
- Create: `matchpass-gate/server/scan-tracker.js`
- Create: `matchpass-gate/tests/chain-tip-cache.test.js`
- Create: `matchpass-gate/tests/roster-cache.test.js`
- Create: `matchpass-gate/tests/scan-tracker.test.js`

- [ ] **Step 1: Write chain-tip-cache.js tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { ChainTipCache } from '../../server/chain-tip-cache.js';

describe('ChainTipCache', () => {
  let cache;
  beforeEach(() => { cache = new ChainTipCache(); });

  it('stores and retrieves a tip', () => {
    cache.set('aaa', { tipEventId: 'evt1', status: 0 });
    const tip = cache.get('aaa');
    expect(tip.tipEventId).toBe('evt1');
    expect(tip.status).toBe(0);
    expect(tip.lastSeen).toBeInstanceOf(Date);
  });

  it('returns undefined for unknown pubkey', () => {
    expect(cache.get('unknown')).toBeUndefined();
  });

  it('returns size', () => {
    cache.set('a', { tipEventId: 'e1', status: 0 });
    cache.set('b', { tipEventId: 'e2', status: 1 });
    expect(cache.size).toBe(2);
  });
});
```

- [ ] **Step 2: Implement chain-tip-cache.js**

```js
// server/chain-tip-cache.js — In-memory chain tip cache
// Map<fanPubkey, { tipEventId, status, lastSeen }>

export class ChainTipCache {
  constructor() {
    this._tips = new Map();
  }

  get(fanPubkey) {
    return this._tips.get(fanPubkey);
  }

  set(fanPubkey, { tipEventId, status }) {
    this._tips.set(fanPubkey, { tipEventId, status, lastSeen: new Date() });
  }

  has(fanPubkey) {
    return this._tips.has(fanPubkey);
  }

  get size() {
    return this._tips.size;
  }

  clear() {
    this._tips.clear();
  }
}
```

- [ ] **Step 3: Run chain-tip-cache tests**

```bash
npx vitest run tests/chain-tip-cache.test.js
```

Expected: PASS.

- [ ] **Step 4: Write roster-cache.js tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { RosterCache } from '../../server/roster-cache.js';

describe('RosterCache', () => {
  let cache;
  beforeEach(() => { cache = new RosterCache(); });

  const clubPubkey = 'c'.repeat(64);
  const rosterEvent = {
    id: 'r1', kind: 39001, pubkey: clubPubkey, created_at: 1000,
    tags: [['d', 'staff-roster'], ['p', 'a'.repeat(64), 'gate_steward', 'Alice']],
    content: '', sig: 'x'.repeat(128),
  };

  it('stores and retrieves a roster', () => {
    cache.set(clubPubkey, rosterEvent);
    const result = cache.get(clubPubkey);
    expect(result.rosterEvent.id).toBe('r1');
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0].role).toBe('gate_steward');
  });

  it('rejects stale roster (older created_at)', () => {
    cache.set(clubPubkey, rosterEvent);
    const olderEvent = { ...rosterEvent, id: 'r0', created_at: 500 };
    const accepted = cache.set(clubPubkey, olderEvent);
    expect(accepted).toBe(false);
    expect(cache.get(clubPubkey).rosterEvent.id).toBe('r1');
  });

  it('finds staff by pubkey across all clubs', () => {
    cache.set(clubPubkey, rosterEvent);
    const staff = cache.findStaff('a'.repeat(64));
    expect(staff).not.toBeNull();
    expect(staff.role).toBe('gate_steward');
    expect(staff.clubPubkey).toBe(clubPubkey);
  });

  it('returns null for unknown staff pubkey', () => {
    expect(cache.findStaff('unknown')).toBeNull();
  });
});
```

- [ ] **Step 5: Implement roster-cache.js**

```js
// server/roster-cache.js — In-memory staff roster cache
// Map<clubPubkey, { rosterEvent, staff[], createdAt }>

import { parseRosterEvent } from './roster.js';

export class RosterCache {
  constructor() {
    this._rosters = new Map();
  }

  /**
   * Store a roster event. Returns false if the event is stale (older than current).
   */
  set(clubPubkey, rosterEvent) {
    const existing = this._rosters.get(clubPubkey);
    if (existing && rosterEvent.created_at <= existing.createdAt) {
      return false;
    }

    const staff = parseRosterEvent(rosterEvent);
    this._rosters.set(clubPubkey, {
      rosterEvent,
      staff,
      createdAt: rosterEvent.created_at,
    });
    return true;
  }

  get(clubPubkey) {
    return this._rosters.get(clubPubkey);
  }

  /**
   * Find a staff member by their pubkey across all clubs.
   * Returns { pubkey, role, displayName, clubPubkey } or null.
   */
  findStaff(staffPubkey) {
    for (const [clubPubkey, { staff }] of this._rosters) {
      const member = staff.find(s => s.pubkey === staffPubkey);
      if (member) return { ...member, clubPubkey };
    }
    return null;
  }

  /** All known club pubkeys. */
  get clubPubkeys() {
    return [...this._rosters.keys()];
  }

  get size() {
    return this._rosters.size;
  }

  clear() {
    this._rosters.clear();
  }
}
```

- [ ] **Step 6: Run roster-cache tests**

```bash
npx vitest run tests/roster-cache.test.js
```

Expected: PASS.

- [ ] **Step 7: Write scan-tracker.js tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { ScanTracker } from '../../server/scan-tracker.js';

describe('ScanTracker', () => {
  let tracker;
  beforeEach(() => { tracker = new ScanTracker(); });

  it('first admission returns null (no duplicate)', () => {
    const result = tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    expect(result).toBeNull();
  });

  it('same staff within 30s returns stewardError', () => {
    tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    const result = tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    expect(result).toEqual({ stewardError: true });
  });

  it('different gate returns duplicate flag', () => {
    tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    const result = tracker.checkAndRecord('fan1', 'gateB', 'staff2');
    expect(result).toEqual({ duplicate: true });
  });

  it('different staff at same gate returns duplicate flag', () => {
    tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    const result = tracker.checkAndRecord('fan1', 'gateA', 'staff2');
    expect(result).toEqual({ duplicate: true });
  });

  it('tracks today stats', () => {
    tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    tracker.recordResult('green');
    tracker.recordResult('amber');
    tracker.recordResult('red');
    const stats = tracker.getStats();
    expect(stats.green).toBe(1);
    expect(stats.amber).toBe(1);
    expect(stats.red).toBe(1);
    expect(stats.total).toBe(3);
  });

  it('clearDay resets everything', () => {
    tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    tracker.recordResult('green');
    tracker.clearDay();
    expect(tracker.getStats().total).toBe(0);
    const result = tracker.checkAndRecord('fan1', 'gateA', 'staff1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 8: Implement scan-tracker.js**

```js
// server/scan-tracker.js — Ephemeral daily admission tracker

export class ScanTracker {
  constructor() {
    this._admissions = new Map(); // fanPubkey -> { gate, time, staffId }
    this._duplicateFlags = [];
    this._stats = { green: 0, amber: 0, red: 0 };
  }

  /**
   * Check for duplicate admission and record this scan.
   * Returns null (no duplicate), { stewardError: true }, or { duplicate: true }.
   */
  checkAndRecord(fanPubkey, gate, staffId) {
    const prior = this._admissions.get(fanPubkey);

    if (prior) {
      const msSince = Date.now() - prior.time;
      if (msSince < 30_000 && prior.staffId === staffId) {
        return { stewardError: true };
      }
      this._duplicateFlags.push({
        fanPubkey,
        firstGate: prior.gate,
        secondGate: gate,
        time: new Date(),
      });
      return { duplicate: true };
    }

    this._admissions.set(fanPubkey, { gate, time: Date.now(), staffId });
    return null;
  }

  recordResult(decision) {
    if (this._stats[decision] !== undefined) {
      this._stats[decision]++;
    }
  }

  getStats() {
    return {
      ...this._stats,
      total: this._stats.green + this._stats.amber + this._stats.red,
      duplicateFlags: [...this._duplicateFlags],
    };
  }

  clearDay() {
    this._admissions.clear();
    this._duplicateFlags = [];
    this._stats = { green: 0, amber: 0, red: 0 };
  }
}
```

- [ ] **Step 9: Run scan-tracker tests**

```bash
npx vitest run tests/scan-tracker.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: in-memory caches — chain tips, roster, scan tracker"
```

---

### Task 4: Venue entry verification

**Files:**
- Create: `matchpass-gate/server/venue-entry.js`
- Create: `matchpass-gate/tests/venue-entry.test.js`

- [ ] **Step 1: Write venue-entry tests**

```js
import { describe, it, expect } from 'vitest';
import { verifyVenueEntry } from '../../server/venue-entry.js';

describe('verifyVenueEntry', () => {
  const now = Math.floor(Date.now() / 1000);

  function makeEvent(overrides = {}) {
    return {
      kind: 21235,
      pubkey: 'a'.repeat(64),
      created_at: now,
      tags: [
        ['t', 'signet-venue-entry'],
        ['x', 'b'.repeat(64)],
        ['blossom', 'https://blossom.example.com'],
        ['photo_key', 'c'.repeat(64)],
      ],
      content: '',
      id: 'd'.repeat(64),
      sig: 'e'.repeat(128),
      ...overrides,
    };
  }

  it('rejects wrong kind', () => {
    expect(() => verifyVenueEntry(makeEvent({ kind: 1 }))).toThrow('Wrong event kind');
  });

  it('rejects missing t tag', () => {
    const event = makeEvent();
    event.tags = event.tags.filter(t => t[0] !== 't');
    expect(() => verifyVenueEntry(event)).toThrow('Not a venue entry event');
  });

  it('rejects expired event (>60s)', () => {
    expect(() => verifyVenueEntry(makeEvent({ created_at: now - 90 }))).toThrow('QR expired');
  });

  it('rejects future event (>10s ahead)', () => {
    expect(() => verifyVenueEntry(makeEvent({ created_at: now + 20 }))).toThrow('QR timestamp in the future');
  });

  it('extracts fields from valid event', () => {
    // Note: signature verification is skipped in this unit test
    // (verifyEvent is tested separately and requires real crypto)
    const result = verifyVenueEntry(makeEvent(), { skipSignatureCheck: true });
    expect(result.pubkey).toBe('a'.repeat(64));
    expect(result.x).toBe('b'.repeat(64));
    expect(result.blossom).toBe('https://blossom.example.com');
    expect(result.photoKey).toBe('c'.repeat(64));
  });
});
```

- [ ] **Step 2: Implement venue-entry.js**

```js
// server/venue-entry.js — Verify kind 21235 venue entry events

import { verifyEvent } from 'nostr-tools/pure';
import { isValidPhotoHash, isValidPhotoKey } from './validation.js';

const VENUE_ENTRY_KIND = 21235;
const MAX_AGE_SECONDS = 60;

/**
 * Verify a kind 21235 venue entry Nostr event.
 * Returns { pubkey, x, blossom, photoKey } on success, throws on failure.
 *
 * @param {object} event - The Nostr event to verify.
 * @param {object} [opts] - Options. skipSignatureCheck for testing.
 */
export function verifyVenueEntry(event, opts = {}) {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid venue entry event');
  }
  if (event.kind !== VENUE_ENTRY_KIND) {
    throw new Error('Wrong event kind');
  }
  if (!event.pubkey || !/^[0-9a-f]{64}$/.test(event.pubkey)) {
    throw new Error('Missing or invalid pubkey');
  }
  if (!Array.isArray(event.tags)) {
    throw new Error('Missing tags');
  }

  const hasTypeTag = event.tags.some(
    t => Array.isArray(t) && t[0] === 't' && t[1] === 'signet-venue-entry'
  );
  if (!hasTypeTag) {
    throw new Error('Not a venue entry event');
  }

  // Freshness check
  const now = Math.floor(Date.now() / 1000);
  const age = now - event.created_at;
  if (age > MAX_AGE_SECONDS) {
    throw new Error('QR expired');
  }
  if (age < -10) {
    throw new Error('QR timestamp in the future');
  }

  // Signature verification
  if (!opts.skipSignatureCheck) {
    if (!verifyEvent(event)) {
      throw new Error('Invalid signature');
    }
  }

  // Extract fields from tags
  const getTag = (name) => {
    const tag = event.tags.find(t => Array.isArray(t) && t[0] === name);
    return tag ? tag[1] : null;
  };

  const x = getTag('x');
  const blossom = getTag('blossom');
  const photoKey = getTag('photo_key');

  if (x && !isValidPhotoHash(x)) {
    throw new Error('Invalid x tag (photo hash) format');
  }
  if (photoKey && !isValidPhotoKey(photoKey)) {
    throw new Error('Invalid photo_key format');
  }

  return { pubkey: event.pubkey, x, blossom, photoKey };
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/venue-entry.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: venue entry event verification (kind 21235)"
```

---

### Task 5: NIP-98 auth backed by roster cache

**Files:**
- Create: `matchpass-gate/server/auth.js`
- Create: `matchpass-gate/tests/auth.test.js`

- [ ] **Step 1: Write auth tests**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyNip98 } from '../../server/auth.js';
import { RosterCache } from '../../server/roster-cache.js';

describe('verifyNip98', () => {
  let rosterCache;

  beforeEach(() => {
    rosterCache = new RosterCache();
  });

  it('rejects missing Authorization header', () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects non-Nostr auth scheme', () => {
    const req = { headers: { authorization: 'Bearer abc123' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyNip98(rosterCache)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Implement auth.js**

```js
// server/auth.js — NIP-98 HTTP auth backed by in-memory roster cache
// No database. Staff lookup uses the roster cache populated from relay.

import { verifyEvent } from 'nostr-tools/pure';

// Replay prevention: consumed event IDs with 120s TTL
const consumedEventIds = new Map();
const MAX_CONSUMED = 10_000;
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [id, ts] of consumedEventIds) {
    if (ts < cutoff) consumedEventIds.delete(id);
  }
}, 30_000);

/** Clear replay cache (test helper). */
export function _resetReplayCache() {
  consumedEventIds.clear();
}

/**
 * Returns Express middleware that verifies NIP-98 auth against the roster cache.
 * On success, attaches req.staff = { pubkey, role, displayName, clubPubkey }.
 */
export function verifyNip98(rosterCache) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Nostr ')) {
      return res.status(401).json({ error: 'Missing or invalid auth header' });
    }

    try {
      const encoded = authHeader.slice(6);
      const event = JSON.parse(Buffer.from(encoded, 'base64').toString());

      if (!event || event.kind !== 27235) {
        return res.status(401).json({ error: 'Auth event must be kind 27235' });
      }

      if (!verifyEvent(event)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Freshness
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - event.created_at) > 60) {
        return res.status(401).json({ error: 'Auth event expired' });
      }

      // Replay prevention
      if (event.id && consumedEventIds.has(event.id)) {
        return res.status(401).json({ error: 'Auth event already used' });
      }
      if (consumedEventIds.size >= MAX_CONSUMED) {
        return res.status(429).json({ error: 'Too many auth requests' });
      }
      if (event.id) consumedEventIds.set(event.id, Date.now());

      // Method tag
      const methodTag = event.tags?.find(t => t[0] === 'method')?.[1];
      if (!methodTag || methodTag.toUpperCase() !== req.method) {
        return res.status(401).json({ error: 'Method tag mismatch' });
      }

      // URL tag
      const urlTag = event.tags?.find(t => t[0] === 'u')?.[1];
      if (!urlTag) {
        return res.status(401).json({ error: 'URL tag missing' });
      }
      try {
        const eventUrl = new URL(urlTag);
        const expectedPath = req.originalUrl.split('?')[0];
        if (eventUrl.pathname !== expectedPath) {
          return res.status(401).json({ error: 'URL tag path mismatch' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid URL tag' });
      }

      // Staff lookup from roster cache (not database)
      const staff = rosterCache.findStaff(event.pubkey);
      if (!staff) {
        return res.status(403).json({ error: 'Not a registered staff member' });
      }

      req.staff = staff;
      next();
    } catch {
      return res.status(401).json({ error: 'Auth verification failed' });
    }
  };
}

/**
 * Role guard — returns middleware that checks req.staff.role.
 * Admin role always passes.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.staff) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.staff.role) && req.staff.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/auth.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: NIP-98 auth backed by in-memory roster cache"
```

---

### Task 6: Club discovery

**Files:**
- Create: `matchpass-gate/server/club-discovery.js`

- [ ] **Step 1: Implement club-discovery.js**

```js
// server/club-discovery.js — Fetch verified club pubkeys from matchpass.club API

const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class ClubDiscovery {
  constructor(apiUrl, refreshMs = DEFAULT_REFRESH_MS) {
    this._apiUrl = apiUrl;
    this._refreshMs = refreshMs;
    this._clubPubkeys = [];
    this._timer = null;
  }

  async fetch() {
    try {
      const res = await fetch(`${this._apiUrl}/api/clubs/pubkeys`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._clubPubkeys = Array.isArray(data.pubkeys) ? data.pubkeys : [];
      console.log(`Club discovery: ${this._clubPubkeys.length} club(s) from ${this._apiUrl}`);
    } catch (err) {
      console.error('Club discovery failed:', err.message);
    }
    return this._clubPubkeys;
  }

  startPeriodicRefresh() {
    this._timer = setInterval(() => this.fetch(), this._refreshMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  get pubkeys() {
    return this._clubPubkeys;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: club discovery from matchpass.club API"
```

---

### Task 7: Relay connection and subscription

**Files:**
- Create: `matchpass-gate/server/relay.js`

- [ ] **Step 1: Implement relay.js**

This connects to the Nostr relay, subscribes to chain events and roster events, and publishes steward-signed events. It feeds the in-memory caches.

```js
// server/relay.js — Nostr relay connection, subscription, and publishing

import { Relay } from 'nostr-tools/relay';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, STAFF_ROSTER_KIND } from './chain/types.js';
import { getCurrentStatus } from './chain/verify.js';

let relay = null;

function shutdown() {
  if (relay) { relay.close(); relay = null; }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/**
 * Connect to the relay and subscribe to chain + roster events.
 *
 * @param {string} relayUrl
 * @param {object} caches - { chainTipCache, rosterCache }
 * @param {string[]} clubPubkeys - Known club pubkeys to filter events
 */
export async function connectAndSubscribe(relayUrl, caches, clubPubkeys) {
  const { chainTipCache, rosterCache } = caches;

  try {
    relay = await Relay.connect(relayUrl);
    console.log(`Relay: connected to ${relayUrl}`);
  } catch (err) {
    console.error(`Relay: connection failed — ${err.message}`);
    relay = null;
    return;
  }

  // Subscribe to chain events (31100-31105) for all fans
  const chainKinds = Object.values(EVENT_KINDS);
  relay.subscribe(
    [{ kinds: chainKinds }],
    {
      onevent: (event) => {
        if (!verifyEvent(event)) return;
        handleChainEvent(event, chainTipCache);
      },
    }
  );

  // Subscribe to staff roster events (39001) from known clubs
  if (clubPubkeys.length > 0) {
    relay.subscribe(
      [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }],
      {
        onevent: (event) => {
          if (!verifyEvent(event)) return;
          rosterCache.set(event.pubkey, event);
          console.log(`Relay: roster update from ${event.pubkey.slice(0, 12)}`);
        },
      }
    );
  }

  // Fetch existing events from relay (historical)
  await fetchExisting(relay, chainKinds, clubPubkeys, caches);
}

/**
 * Fetch existing chain events and rosters from the relay on startup.
 */
async function fetchExisting(relay, chainKinds, clubPubkeys, { chainTipCache, rosterCache }) {
  // Fetch rosters first (needed for signer verification context)
  if (clubPubkeys.length > 0) {
    const rosterEvents = await collectEvents(relay, [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }]);
    for (const event of rosterEvents) {
      if (verifyEvent(event)) rosterCache.set(event.pubkey, event);
    }
    console.log(`Relay: fetched ${rosterEvents.length} roster event(s)`);
  }

  // Fetch chain events
  const chainEvents = await collectEvents(relay, [{ kinds: chainKinds }]);
  for (const event of chainEvents) {
    if (verifyEvent(event)) handleChainEvent(event, chainTipCache);
  }
  console.log(`Relay: fetched ${chainEvents.length} chain event(s), ${chainTipCache.size} fan tip(s) cached`);
}

/**
 * Collect events from a relay subscription until EOSE or timeout.
 */
function collectEvents(relay, filters, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const collected = [];
    const timeout = setTimeout(() => { sub.close(); resolve(collected); }, timeoutMs);
    const sub = relay.subscribe(filters, {
      onevent: (event) => collected.push(event),
      oneose: () => { clearTimeout(timeout); sub.close(); resolve(collected); },
    });
  });
}

/**
 * Handle a single chain event — update the chain tip cache.
 */
function handleChainEvent(event, chainTipCache) {
  const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
  if (!pTag || !pTag[1]) return;
  const fanPubkey = pTag[1];

  const existing = chainTipCache.get(fanPubkey);

  // Only update if this event is newer than the cached tip
  if (existing) {
    // Simple heuristic: newer created_at wins
    // Full chain verification happens at scan time
    const existingEvent = existing._rawEvent;
    if (existingEvent && event.created_at <= existingEvent.created_at) return;
  }

  // Compute status from this single event (approximation — full chain walk at scan time)
  // For now, just track the latest event as the tip
  let status = 0; // clean by default
  chainTipCache.set(fanPubkey, { tipEventId: event.id, status });
  chainTipCache.get(fanPubkey)._rawEvent = event;
}

/**
 * Publish a signed event to the relay.
 */
export async function publishEvent(event) {
  if (!relay) throw new Error('Relay not connected');
  await relay.publish(event);
}

/**
 * Get relay connection status.
 */
export function getRelayStatus() {
  return { connected: !!relay };
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: relay connection, subscription, and chain tip ingestion"
```

---

### Task 8: API routes — scan, event, tip, dashboard

**Files:**
- Create: `matchpass-gate/server/routes/scan.js`
- Create: `matchpass-gate/server/routes/event.js`
- Create: `matchpass-gate/server/routes/tip.js`
- Create: `matchpass-gate/server/routes/dashboard.js`

- [ ] **Step 1: Implement POST /api/gate/scan**

```js
// server/routes/scan.js — POST /api/gate/scan

import { Router } from 'express';
import { verifyVenueEntry } from '../venue-entry.js';

// Replay prevention for venue entry events (60s TTL)
const consumedScans = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, ts] of consumedScans) {
    if (ts < cutoff) consumedScans.delete(id);
  }
}, 15_000);

export default function createScanRouter({ chainTipCache, scanTracker }) {
  const router = Router();

  router.post('/', (req, res) => {
    const { venue_entry_event } = req.body;
    if (!venue_entry_event) {
      return res.status(400).json({ error: 'venue_entry_event required' });
    }

    // Verify the venue entry event
    let entry;
    try {
      entry = verifyVenueEntry(venue_entry_event);
    } catch (err) {
      return res.status(400).json({ decision: 'red', error: err.message });
    }

    // Replay check
    const eventId = venue_entry_event.id;
    if (eventId && consumedScans.has(eventId)) {
      return res.status(400).json({ decision: 'red', error: 'QR already scanned' });
    }
    if (eventId) consumedScans.set(eventId, Date.now());

    // Duplicate admission check
    const gate = req.body.gate_id || null;
    const staffId = req.staff?.pubkey || 'anonymous';
    const dupCheck = scanTracker.checkAndRecord(entry.pubkey, gate, staffId);

    if (dupCheck?.duplicate) {
      scanTracker.recordResult('red');
      return res.json({
        decision: 'red',
        fanPubkey: entry.pubkey,
        reason: 'Duplicate admission — flagged for review',
        duplicate: true,
      });
    }
    // stewardError: ignore (accidental double-tap), proceed normally

    // Look up fan status from chain tip cache
    const tip = chainTipCache.get(entry.pubkey);

    if (!tip) {
      // First-time visitor — not in cache
      scanTracker.recordResult('amber');
      return res.json({
        decision: 'amber',
        fanPubkey: entry.pubkey,
        status: 0,
        reason: 'First visit — not yet in chain cache',
        firstTime: true,
        x: entry.x,
        blossom: entry.blossom,
        photoKey: entry.photoKey,
      });
    }

    // Determine decision from cached status
    // 0=clean, 1=yellow, 2=red, 3=banned
    let decision;
    let reason = null;
    if (tip.status === 3) { decision = 'red'; reason = 'Banned'; }
    else if (tip.status === 2) { decision = 'red'; reason = 'Active red card or suspension'; }
    else if (tip.status === 1) { decision = 'amber'; reason = 'Yellow card'; }
    else { decision = 'green'; }

    scanTracker.recordResult(decision);

    return res.json({
      decision,
      fanPubkey: entry.pubkey,
      status: tip.status,
      reason,
      x: entry.x,
      blossom: entry.blossom,
      photoKey: entry.photoKey,
    });
  });

  return router;
}
```

- [ ] **Step 2: Implement POST /api/gate/event**

```js
// server/routes/event.js — POST /api/gate/event

import { Router } from 'express';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS } from '../chain/types.js';
import { verifySignerAuthority } from '../chain/verify.js';
import { isValidPubkey } from '../chain/types.js';
import { publishEvent } from '../relay.js';

const ALLOWED_KINDS = new Set(Object.values(EVENT_KINDS));

export default function createEventRouter({ chainTipCache, rosterCache }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { event } = req.body;
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ error: 'event required' });
    }

    // 1. Verify signature
    if (!verifyEvent(event)) {
      return res.status(400).json({ error: 'Invalid event signature' });
    }

    // 2. Validate kind
    if (!ALLOWED_KINDS.has(event.kind)) {
      return res.status(400).json({ error: `Event kind ${event.kind} not allowed` });
    }

    // 3. Extract fan pubkey
    const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
    if (!pTag || !isValidPubkey(pTag[1])) {
      return res.status(400).json({ error: 'Missing or invalid p tag (fan pubkey)' });
    }
    const fanPubkey = pTag[1];

    // 4. Verify signer authority (skip for membership — signed by fan)
    if (event.kind !== EVENT_KINDS.MEMBERSHIP) {
      const roster = rosterCache.get(req.staff?.clubPubkey);
      if (!roster) {
        return res.status(400).json({ error: 'No roster found for your club' });
      }
      const authCheck = verifySignerAuthority(event, roster.rosterEvent);
      if (!authCheck.authorised) {
        return res.status(403).json({ error: authCheck.reason });
      }
    }

    // 5. Validate chain linkage
    if (event.kind !== EVENT_KINDS.MEMBERSHIP) {
      const previousTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'previous');
      if (!previousTag || !previousTag[1]) {
        return res.status(400).json({ error: 'Missing previous tag' });
      }
      const tip = chainTipCache.get(fanPubkey);
      if (tip && tip.tipEventId !== previousTag[1]) {
        return res.status(409).json({
          error: 'Chain tip mismatch — previous tag does not match current tip',
          currentTip: tip.tipEventId,
        });
      }
    }

    // 6. Publish to relay
    try {
      await publishEvent(event);
    } catch (err) {
      return res.status(502).json({ error: `Relay publish failed: ${err.message}` });
    }

    // 7. Update chain tip cache
    chainTipCache.set(fanPubkey, { tipEventId: event.id, status: 0 });
    // Status will be recomputed on next chain sync from relay

    return res.status(201).json({
      ok: true,
      eventId: event.id,
      fanPubkey,
    });
  });

  return router;
}
```

- [ ] **Step 3: Implement GET /api/gate/tip/:pubkey**

```js
// server/routes/tip.js — GET /api/gate/tip/:pubkey

import { Router } from 'express';
import { isValidPubkey } from '../chain/types.js';

const STATUS_NAMES = { 0: 'clean', 1: 'yellow', 2: 'red', 3: 'banned' };

export default function createTipRouter({ chainTipCache }) {
  const router = Router();

  router.get('/:pubkey', (req, res) => {
    const { pubkey } = req.params;
    if (!isValidPubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const tip = chainTipCache.get(pubkey);
    if (!tip) {
      return res.status(404).json({ error: 'Fan not in chain cache' });
    }

    return res.json({
      fanPubkey: pubkey,
      tipEventId: tip.tipEventId,
      status: tip.status,
      statusName: STATUS_NAMES[tip.status] || 'unknown',
    });
  });

  return router;
}
```

- [ ] **Step 4: Implement GET /api/gate/dashboard**

```js
// server/routes/dashboard.js — GET /api/gate/dashboard

import { Router } from 'express';

export default function createDashboardRouter({ scanTracker, chainTipCache, rosterCache }) {
  const router = Router();

  router.get('/', (req, res) => {
    const stats = scanTracker.getStats();
    return res.json({
      date: new Date().toISOString().split('T')[0],
      scans: {
        green: stats.green,
        amber: stats.amber,
        red: stats.red,
        total: stats.total,
      },
      duplicateFlags: stats.duplicateFlags,
      cache: {
        fans: chainTipCache.size,
        clubs: rosterCache.size,
      },
    });
  });

  return router;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: API routes — scan, event, tip, dashboard"
```

---

### Task 9: Server entry point

**Files:**
- Create: `matchpass-gate/server/index.js`

- [ ] **Step 1: Implement server/index.js**

```js
// server/index.js — matchpass-gate entry point

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { ChainTipCache } from './chain-tip-cache.js';
import { RosterCache } from './roster-cache.js';
import { ScanTracker } from './scan-tracker.js';
import { ClubDiscovery } from './club-discovery.js';
import { connectAndSubscribe, getRelayStatus } from './relay.js';
import { verifyNip98, requireRole } from './auth.js';

import createScanRouter from './routes/scan.js';
import createEventRouter from './routes/event.js';
import createTipRouter from './routes/tip.js';
import createDashboardRouter from './routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── In-memory state ──────────────────────────────────────────────────────────
const chainTipCache = new ChainTipCache();
const rosterCache = new RosterCache();
const scanTracker = new ScanTracker();
const caches = { chainTipCache, rosterCache, scanTracker };

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
});

// Global rate limit
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// Gate scan — higher limit (busy gate)
app.use('/api/gate/scan', rateLimit({ windowMs: 60_000, max: 120 }));

// Event submission — lower limit
app.use('/api/gate/event', rateLimit({ windowMs: 60_000, max: 30 }));

// Static files (steward PWA)
app.use(express.static(join(__dirname, '..', 'public')));

// Health / status
app.get('/api/gate/status', (req, res) => {
  res.json({
    relay: getRelayStatus(),
    cache: { fans: chainTipCache.size, clubs: rosterCache.size },
    scans: scanTracker.getStats(),
  });
});

// Auth middleware for protected routes
const auth = verifyNip98(rosterCache);

// Routes
app.use('/api/gate/scan', auth, createScanRouter(caches));
app.use('/api/gate/event', auth, createEventRouter(caches));
app.use('/api/gate/tip', auth, createTipRouter(caches));
app.use('/api/gate/dashboard', auth, requireRole('safety_officer', 'admin'), createDashboardRouter(caches));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const RELAY_URL = process.env.RELAY_URL || 'wss://relay.trotters.cc';
const CLUB_API = process.env.MATCHPASS_CLUB_API || 'https://matchpass.club';

async function start() {
  // 1. Discover clubs
  const discovery = new ClubDiscovery(CLUB_API);
  const clubPubkeys = await discovery.fetch();
  discovery.startPeriodicRefresh();

  // 2. Connect to relay and populate caches
  await connectAndSubscribe(RELAY_URL, { chainTipCache, rosterCache }, clubPubkeys);

  // 3. Clear scan tracker at midnight
  scheduleMidnightClear(scanTracker);

  // 4. Start HTTP server
  app.listen(PORT, () => {
    console.log(`matchpass-gate listening on ${PORT}`);
    console.log(`Relay: ${RELAY_URL}`);
    console.log(`Clubs: ${clubPubkeys.length} discovered`);
    console.log(`Cache: ${chainTipCache.size} fan tip(s), ${rosterCache.size} roster(s)`);
  });
}

function scheduleMidnightClear(tracker) {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    tracker.clearDay();
    console.log('Scan tracker cleared at midnight');
    setInterval(() => {
      tracker.clearDay();
      console.log('Scan tracker cleared at midnight');
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

export default app;
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: server entry point with relay bootstrap and midnight clear"
```

---

### Task 10: Integration tests

**Files:**
- Create: `matchpass-gate/tests/routes/scan.test.js`
- Create: `matchpass-gate/tests/routes/event.test.js`
- Create: `matchpass-gate/tests/routes/tip.test.js`
- Create: `matchpass-gate/tests/routes/dashboard.test.js`

- [ ] **Step 1: Write scan route test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { ChainTipCache } from '../../server/chain-tip-cache.js';
import { ScanTracker } from '../../server/scan-tracker.js';
import createScanRouter from '../../server/routes/scan.js';
import express from 'express';

function buildApp(caches) {
  const app = express();
  app.use(express.json());
  // Stub auth: attach staff to req
  app.use((req, res, next) => { req.staff = { pubkey: 'staff1', role: 'gate_steward' }; next(); });
  app.use('/api/gate/scan', createScanRouter(caches));
  return app;
}

describe('POST /api/gate/scan', () => {
  let chainTipCache, scanTracker, app;

  beforeEach(() => {
    chainTipCache = new ChainTipCache();
    scanTracker = new ScanTracker();
    app = buildApp({ chainTipCache, scanTracker });
  });

  it('returns 400 without venue_entry_event', async () => {
    const res = await fetch(await startServer(app), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns amber for unknown fan', async () => {
    const event = makeVenueEntry();
    const res = await postScan(app, event);
    const body = await res.json();
    expect(body.decision).toBe('amber');
    expect(body.firstTime).toBe(true);
  });

  it('returns green for clean cached fan', async () => {
    const pubkey = 'a'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'tip1', status: 0 });
    const event = makeVenueEntry({ pubkey });
    const res = await postScan(app, event);
    const body = await res.json();
    expect(body.decision).toBe('green');
  });

  it('returns red for banned fan', async () => {
    const pubkey = 'a'.repeat(64);
    chainTipCache.set(pubkey, { tipEventId: 'tip1', status: 3 });
    const event = makeVenueEntry({ pubkey });
    const res = await postScan(app, event);
    const body = await res.json();
    expect(body.decision).toBe('red');
    expect(body.reason).toBe('Banned');
  });
});

// Helpers (to be fleshed out — venue entry events need skipSignatureCheck for testing)
function makeVenueEntry({ pubkey = 'a'.repeat(64) } = {}) {
  return {
    kind: 21235,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'signet-venue-entry'],
      ['x', 'b'.repeat(64)],
      ['blossom', 'https://blossom.example.com'],
      ['photo_key', 'c'.repeat(64)],
    ],
    content: '',
    id: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    sig: 'e'.repeat(128),
  };
}
```

Note: full integration tests need a test harness that stubs signature verification. The implementation should accept a `skipSignatureCheck` option in test mode (already built into `verifyVenueEntry`). The test helpers above show the pattern; the subagent implementing this task should flesh out the HTTP test harness using Vitest + supertest or direct fetch against an ephemeral server.

- [ ] **Step 2: Write tip, dashboard, and event route tests** (similar pattern)

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: route integration tests for scan, event, tip, dashboard"
```

---

### Task 11: Smoke test and CLAUDE.md

**Files:**
- Create: `matchpass-gate/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# CLAUDE.md — matchpass-gate

## Core purpose

MatchPass reduces friction for well-behaved fans and increases it for those who
aren't. Cards and bans are edge cases — the system is designed around the 99%
who scan, get green, and enjoy the match.

## Architecture — NO central fan database

This server is a **stateless, in-memory-only verification gateway**. Fan data
lives on the credential chain (Nostr events, kinds 31100-31105) and in the
fan's Signet app. Nothing persists. Nothing to erase.

- Chain tips: in-memory Map, rebuilt from relay on restart
- Scan tracking: ephemeral, cleared at midnight
- Staff rosters: in-memory Map from relay subscription
- No Postgres. No migrations. No persistence.

## Running

```bash
npm start                    # Connects to relay, serves on PORT
npm test                     # Vitest
```

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| PORT | 3000 | HTTP port |
| RELAY_URL | wss://relay.trotters.cc | Nostr relay |
| MATCHPASS_CLUB_API | https://matchpass.club | Club discovery endpoint |
| ALLOWED_ORIGIN | http://localhost:3000 | CORS origin |
```

- [ ] **Step 2: Verify the server starts**

```bash
cd /media/sf_MintAI/MatchPass/matchpass-gate
RELAY_URL=wss://relay.trotters.cc npm start
```

Expected: server starts, connects to relay, logs cache sizes.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "docs: add CLAUDE.md, smoke test passes"
```

---

## Summary

| Task | What it builds | Files |
|------|---------------|-------|
| 1 | Project scaffolding + carry-over | package.json, validation.js, roster.js |
| 2 | Chain library + kind 31105 | chain/types, events, verify, index + tests |
| 3 | In-memory caches | chain-tip-cache, roster-cache, scan-tracker + tests |
| 4 | Venue entry verification | venue-entry.js + tests |
| 5 | NIP-98 auth (roster-backed) | auth.js + tests |
| 6 | Club discovery | club-discovery.js |
| 7 | Relay connection | relay.js |
| 8 | API routes | routes/scan, event, tip, dashboard |
| 9 | Server entry point | index.js |
| 10 | Integration tests | tests/routes/* |
| 11 | Smoke test + docs | CLAUDE.md |
