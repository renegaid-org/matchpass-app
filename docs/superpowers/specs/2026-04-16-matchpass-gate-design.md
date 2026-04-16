# matchpass-gate — Stateless Gate Verification Service

**Date:** 2026-04-16
**Status:** Design approved
**Replaces:** matchpass-app fan-facing routes (cards, sanctions, scan, gate_locks, linkages, dashboard)

## Core Purpose

MatchPass reduces friction for well-behaved fans and increases it for those who
aren't. Cards and bans are edge cases — the system is designed around the 99%
who scan, get green, and enjoy the match.

MatchPass is voluntary. Away fans can choose not to present their pass. Clubs
should be more lenient with fans who do use it. The system rewards
participation, it doesn't gatekeep entry.

## Architecture Principle: No Central Fan Database

Fan data lives on the credential chain (Nostr events, kinds 31100–31105) and in
the fan's Signet app. Never in a central database.

matchpass-gate is a **thin real-time verification gateway** — in-memory caches,
ephemeral state, relay-connected. If the server restarts, it rebuilds from the
relay. Nothing persists. Nothing to erase.

## System Split

| | **matchpass.club** | **matchpass-gate** (new) |
|---|---|---|
| Purpose | Club directory, verification, profiles | Real-time gate verification |
| Storage | Postgres (public club data) | None persistent. In-memory only. |
| Data | Club names, domains, pubkeys, verification | Fan chain tips (cache), today's scans (ephemeral) |
| Auth | Public website | NIP-98 (steward's Signet) |
| Relay | Reads club pubkeys for verification | Subscribes to chain events, publishes steward-signed events |
| GDPR | N/A — all public data | N/A — no persistent personal data |

matchpass.club stays as-is (Postgres-backed, unchanged).

## matchpass-gate Internals

### 1. In-Memory Chain Tip Cache

On startup, the server connects to the relay (`wss://relay.trotters.cc`) and
subscribes to chain events (kinds 31100–31105) for known clubs.

**Club discovery:** The gate server fetches the club list from the
matchpass.club API (public endpoint, returns pubkeys of verified clubs). This is
the only interaction between the two systems — a read-only bootstrap call.

State: `Map<fanPubkey, { tipEventId, status, lastSeen }>`

- Populated from relay on startup (fetch existing events)
- Updated live as new events arrive via subscription
- Server restart = full rebuild from relay (no persistence needed)
- No fan data written to disk at any point
- Club list refreshed periodically (hourly) from matchpass.club API

### 2. Staff Roster Cache

Same pattern as chain tips. Subscribes to kind 39001 (staff roster) events from
known clubs. Builds an in-memory roster used for signer authority verification.

State: `Map<clubPubkey, rosterEvent>`

Already implemented in current codebase (`roster.js`, `roster-cache.js`) — the
relay subscription and roster parsing carry over. The Postgres upsert gets
replaced with a Map set.

### 3. Gate Scan Endpoint

`POST /api/gate/scan`

Fan presents a venue entry QR at the gate. Signet already produces these
(kind 21235, implemented in signet-app #109). Single endpoint handles the full
gate flow.

**Input:** `{ venue_entry_event: <signed-nostr-event> }` — a kind 21235 venue
entry event containing the fan's pubkey, photo hash (`x` tag), Blossom server
URL (`blossom` tag), and photo decryption key (`photo_key` tag). Signed by the
fan, refreshes every 30 seconds.

**Flow:**
1. Verify Nostr event signature (`verifyEvent`)
2. Verify kind is 21235 with `t` tag `signet-venue-entry`
3. Check freshness (60-second window on `created_at`)
4. Check replay (in-memory Set, 60-second TTL on event ID)
5. Extract fan pubkey, look up status from in-memory chain tip cache
6. Check duplicate admission (ephemeral daily tracker)
7. Return decision + photo info for steward display

**Output:** `{ decision: "green"|"amber"|"red", fanPubkey, status, blossom?, x?, photoKey?, reason? }`

The steward's PWA uses `blossom` + `x` + `photoKey` to fetch, decrypt, and
display the fan's photo for visual verification.

**Decisions:**
- **Green** — fan in cache with clean or yellow status, no duplicate
- **Amber** — first-time visitor (not in cache), or yellow card
- **Red** — banned, suspended, active red card, duplicate admission, invalid signature

**Duplicate detection:**
State: `Map<fanPubkey, { gate, time, staffId }>`
- Cleared at midnight (ephemeral)
- Same staff + under 30 seconds = steward double-tap (ignore)
- Different gate or different staff = genuine duplicate (red + flag)

**No QR presented:**
Normal flow — steward admits manually. No system interaction needed. This is
club policy, not a system error.

### 4. Event Submission Endpoint

`POST /api/gate/event`

Steward's PWA submits a pre-signed Nostr chain event. The server validates and
publishes to the relay. The server never holds signing keys.

**Input:** `{ event: <signed-nostr-event> }`

The steward's PWA constructs the event template (tags, content, kind) and
sends it to Signet for signing via NIP-46 (remote signer). Signet signs it
without needing to understand MatchPass chain semantics. The PWA then submits
the signed event to this endpoint.

**Flow:**
1. Verify Nostr event signature (`verifyEvent`)
2. Validate event kind is in allowed set (31100–31105)
3. Verify signer authority against staff roster cache
4. Validate chain linkage (`previous` tag matches current tip for this fan)
5. Publish event to relay
6. Update in-memory chain tip cache

**Accepted event kinds:**
- 31100 — Membership (signed by fan)
- 31101 — Gate-lock (signed by steward)
- 31102 — Attendance (signed by steward)
- 31103 — Card (signed by steward, roaming_steward or above)
- 31104 — Sanction (signed by safety_officer or above)
- 31105 — Review outcome: dismissal or downgrade (signed by safety_officer or above)

**Kind 31105 (new) — Review Outcome:**
References the original card/sanction event ID. Only dismissals and downgrades
produce chain events. A "confirmed" review changes nothing on the chain.

Tags: `['d', '{fanPubkey}:review:{uuid}']`, `['p', fanPubkey]`,
`['previous', tipEventId]`, `['reviews', originalEventId]`,
`['outcome', 'dismissed'|'downgraded']`

Status computation in `chain/verify.js` already walks the chain. It needs
updating to recognise kind 31105 and skip/downgrade the referenced card.

### 5. Chain Tip Query

`GET /api/gate/tip/:pubkey`

Returns the cached chain tip and status for a fan. Used by the steward's PWA
to build chain events (needs the current tip for the `previous` tag).

**Input:** pubkey as URL param
**Output:** `{ fanPubkey, tipEventId, status, statusName }`
**Auth:** NIP-98 (steward must be authenticated)

If the fan isn't in the cache, returns 404. The PWA handles this by creating a
membership event as the chain's first event.

### 6. Dashboard Data

`GET /api/gate/dashboard`

Returns today's gate activity from ephemeral in-memory state. For the safety
officer's PWA view.

- Today's scan count by result (green/amber/red)
- Today's duplicate flags
- No historical data — it's ephemeral

Season-level stats (total cards, categories, trends) come from querying the
relay for the club's signed events, not from the gate server. This can be a
client-side relay query in the PWA or a separate offline analytics tool.

## What Carries Over From matchpass-app

| File | Destination | Changes |
|------|-------------|---------|
| `server/chain/types.js` | matchpass-gate | Add kind 31105 |
| `server/chain/events.js` | matchpass-gate | Add `createReviewOutcome()` |
| `server/chain/verify.js` | matchpass-gate | Handle kind 31105 in `getCurrentStatus()` |
| `server/chain/qr-proof.js` | DROPPED | Compact QR proof replaced by venue entry event (kind 21235) |
| `server/auth.js` | matchpass-gate | NIP-98 verification, unchanged |
| `server/roster.js` | matchpass-gate | Unchanged (parsing) |
| `server/roster-cache.js` | matchpass-gate | Replace DB upsert with Map |
| `server/nostr.js` | matchpass-gate | Strip to relay subscription only, add chain event sub |
| `server/validation.js` | matchpass-gate | Carry over validators |

## What Gets Dropped

- All 21 Postgres migrations
- `db.js` + pool connection
- `server/card-engine.js` (replaced by `chain/verify.js`)
- `server/blossom.js` (photo decryption — fan shows photo from Signet, not server-decrypted)
- Routes: `cards.js`, `sanctions.js`, `scan.js`, `linkages.js`, `dashboard.js`, `clubs.js`, `seasons.js`, `staff.js`
- Tables: `cards`, `sanctions`, `scan_log`, `gate_locks`, `parent_child_linkages`, `sessions`, `unlinked_cards`, `duplicate_scan_flags`, `chain_tips`, `signed_events`, `clubs`, `seasons`, `staff`
- GDPR templates, retention crons, erasure logic
- `server/club-verify.js` (stays with matchpass.club)

## What's New

| Component | Description |
|-----------|-------------|
| In-memory chain tip cache | `Map<fanPubkey, { tipEventId, status }>`, relay-fed |
| Ephemeral scan tracker | `Map<fanPubkey, { gate, time, staffId }>`, daily |
| `POST /api/gate/scan` | Merged gate endpoint — QR verify + duplicate detect |
| `POST /api/gate/event` | Accept steward-signed events, publish to relay |
| `GET /api/gate/tip/:pubkey` | Chain tip lookup for PWA event building |
| `GET /api/gate/dashboard` | Today's ephemeral gate stats |
| Kind 31105 event | Review outcome (dismissal/downgrade) on chain |
| `chain/events.js` update | `createReviewOutcome()` function |
| `chain/verify.js` update | Handle 31105 in status computation |

## Unlinked Incident Reports

When a steward witnesses an incident but can't identify the fan (no QR scan),
they need to record it. These are club operational records with no fan ID — no
GDPR applies.

For the pilot, the steward records this in whatever tool they already use
(notebook, phone notes, radio to safety officer). matchpass-gate doesn't need
to handle this — it's not fan credential data and it's not gate verification.

If clubs later want a shared incident log, that's a matchpass.club feature (club
operational data, public-ish), not a matchpass-gate feature.

## Signet Integration — No Signet Changes Required

Signet is a general-purpose identity app. MatchPass-specific logic lives
entirely in matchpass-gate and the steward PWA. Signet provides:

- **Fan at gate:** venue entry QR (kind 21235) — already implemented (#109).
  Contains pubkey, encrypted photo hash (`x` tag), Blossom URL, photo key.
  Refreshes every 30 seconds.
- **Steward signing:** NIP-46 remote signer. The steward PWA constructs chain
  event templates (kinds 31100–31105) and asks Signet to sign them. Signet
  signs without needing to understand chain semantics.
- **Steward auth:** NIP-98 HTTP auth headers, already implemented.

No new Signet issues. No Signet code changes.

## Dependencies

- **Relay** (`wss://relay.trotters.cc`) must be running and accepting events
- **Signet #109** (encrypted photo + venue entry event) — implemented

## Not In Scope

- Per-club instances (Level 3 infrastructure) — future
- Parent-child linkages on chain — future, each club verifies independently for now
- Season ticket integration — future, needs club validation first
- Historical analytics — future, query relay offline
- NFC wristband support — future, same venue entry event works over NFC
- Compact 133-byte QR proof — dropped in favour of venue entry event
