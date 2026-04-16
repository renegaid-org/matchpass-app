# CLAUDE.md — matchpass-app

## Repo boundaries

This repo is **code only**. Do not put docs, specs, plans, ADRs, or GDPR
papers here. Those live in matchpass-prv.

| What | Where |
|------|-------|
| Application code + tests | **This repo** (`renegaid-org/matchpass-app`) |
| Docs, specs, plans, ADRs, GDPR, deploy instructions | `matchpass-prv` (private) |
| Private issues and feature tracking | `matchpass-app-internal` (issues only) |
| Club directory site | `matchpass-club` (public) |

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

When tempted to add persistence for fan data, stop. Ask: can this live on the
chain, on the fan's device, or in ephemeral memory?

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

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/gate/scan | NIP-98 | Fan presents venue entry QR |
| POST | /api/gate/event | NIP-98 | Steward submits signed chain event |
| GET | /api/gate/tip/:pubkey | NIP-98 | Chain tip lookup for PWA |
| GET | /api/gate/dashboard | NIP-98 + safety_officer | Today's ephemeral stats |
| GET | /api/gate/status | None | Health check |
