# MatchPass Kind Migration Plan — 2026-04-17

**Context:** MatchPass kind allocations were renumbered to resolve collisions with TROTT and NIP-29. Code is updated; production relays still hold events at the old kinds.

| Concern | Old kind | New kind | Why |
|---|---|---|---|
| Membership | 31100 | **31900** | TROTT translation-language collision |
| Gate-lock | 31101 | **31901** | TROTT translation-language collision |
| Attendance | 31102 | **31902** | TROTT translation-language collision |
| Card | 31103 | **31903** | TROTT translation-language collision |
| Sanction | 31104 | **31904** | TROTT translation-language collision |
| Review outcome | 31105 | **31905** | TROTT translation-language collision |
| Staff roster | 39001 | **31920** | NIP-29 Simple Groups collision (NIP-29 reserves 39000–39003) |

After the code shift deploys, fans' chain tips and clubs' staff rosters at the old kinds will be **orphaned** — readable but no longer written. Three migration options below; pick one.

## Option 1 — Re-emit at new kinds (recommended for chain events)

**How it works:** On first read post-deploy, when the gate server fetches a fan's chain tip and finds only old-kind events, it re-emits each event at the new kind, signed by the same authority (steward/safety officer for non-membership events; fan for membership). The membership event is the trickiest — it's fan-signed and the server can't sign on the fan's behalf, so fans must re-emit their membership the next time they open their Signet app (Signet displays a "republish your MatchPass membership" prompt during the transition window).

**Pros**
- Continuity: fan chain tips + statuses preserved
- Fans don't lose membership; cards and sanctions migrated cleanly
- One-shot, no permanent dual-kind code path

**Cons**
- Requires Signet UI update for fan-side membership re-emit
- Coordination: gate server must run a migration job before steward PWAs start writing at new kinds (otherwise chain `previous` tags break)
- Signature provenance: all re-emitted non-membership events get re-signed by the migration authority, not the original steward — this is a deliberate audit-trail compromise (or signal as `migrated: true` tag)

**Effort:** Medium. ~1 day server-side migration job + 0.5 day Signet prompt.

## Option 2 — Bridge subscription (recommended for staff rosters)

**How it works:** During a transition window, the gate server subscribes to BOTH the old kind (39001) AND the new kind (31920) for staff rosters. The roster cache merges both streams, preferring the newer `created_at`. Clubs republish their roster at the new kind on next admin action; once all clubs have republished, the bridge subscription is removed.

**Pros**
- Zero coordination — clubs migrate at their own pace
- No data loss
- Reversible

**Cons**
- Code complexity: dual subscription + merge logic
- Some clubs may never republish if no admin action triggers it
- Cleanup: need to schedule the bridge removal (e.g. 90 days post-deploy)

**Effort:** Low. ~2 hours subscription + merge code; 1 hour cleanup PR scheduled for cutoff.

## Option 3 — Hard cutover

**How it works:** No migration. Old events orphaned. Fans re-create membership on next gate visit (steward sees no chain tip → issues fresh membership). Clubs re-publish staff roster on next admin action. Card/sanction history at old kinds is lost (can be exported to ops log if needed).

**Pros**
- Zero dev work
- Clean slate

**Cons**
- Loss of card/sanction history (may be acceptable for a pilot deployment)
- Awkward fan UX at first gate visit post-deploy ("you're new — sign up again")
- Ban list reset: previously-banned fans become clean unless manually re-added

**Effort:** Zero dev. Operational overhead at first match-day post-deploy.

## Recommendation

**Hybrid: Option 1 for chain events, Option 2 for staff rosters.**

- Chain events have continuity value (sanctions, attendance history) — Option 1 preserves them with a migration job.
- Staff rosters change frequently and are easy to republish — Option 2 lets clubs migrate naturally with zero coordination.
- Avoid Option 3 for chain events (loses sanction history) but it's acceptable for rosters if Option 2 is too much code.

## Implementation checklist (if hybrid)

### Pre-deploy

- [ ] Deploy code shifts to staging relay first (`wss://relay.staging.trotters.cc` or local dev relay)
- [ ] Verify steward PWA can build chain events at new kinds + sign via NIP-46
- [ ] Verify gate server validates and persists new-kind events
- [ ] Verify dual-subscription roster cache (Option 2) merges streams correctly

### Deploy day

- [ ] Push code to production gate server
- [ ] Run migration job: server iterates over all known fans, fetches old-kind chain, re-emits at new kinds (Option 1, non-membership events). Tag re-emitted events with `["migrated", "2026-XX-XX"]` for audit trail.
- [ ] Push Signet update with "republish MatchPass membership" prompt for fans
- [ ] Bridge subscription active for staff rosters (Option 2)

### Post-deploy

- [ ] Monitor: how many fans have re-emitted membership over 7/14/30 days
- [ ] Monitor: how many clubs have republished roster
- [ ] After 90 days: remove bridge subscription, deprecate old-kind read path

## Out of scope for this plan

- The original kind shifts themselves (already done; see `2026-04-16-matchpass-gate-design.md`)
- Updates to `matchpass-app-internal` private spec docs (separate, owner action)
- Wider TROTT integration (this is a kind-numbering migration, not an architectural change)

## References

- Kind shift code changes: 2026-04-17 cross-project audit session
- Spec: `2026-04-16-matchpass-gate-design.md` (updated to new kinds)
- TROTT acknowledgement: `trott/specs/QUICK-REFERENCE.md` Reserved & Excluded Ranges
