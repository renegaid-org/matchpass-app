# PWA e2e tests

This folder holds Playwright e2e tests for matchpass-app.

## Running

```bash
npm run test:e2e           # boots Vite dev server at :5175 automatically
MP_BASE_URL=https://gate.example.com npm run test:e2e  # against a deployed instance
```

## Scope

The current smoke test only asserts the PWA shell loads. The Sprint B
plan calls for full e2e coverage of:

- scan happy path (clean → green)
- scan banned (banned → red)
- card issuance (roaming steward)
- review flow (officer signs dismissal)
- self-review block
- offline queue (disconnect → scan+card → reconnect → settles)

Those tests need:

1. A fixture Nostr relay (e.g. `strfry` in a container, or a stub
   in-memory relay built into the harness) seeded with deterministic
   chain + roster fixtures.
2. A matchpass-gate instance pointing at that relay.
3. A Signet-less signing path — either a fake NIP-46 remote signer or
   an `MP_TEST_SIGNER=localkey` env switch on the client that reads a
   seckey from localStorage.

Tracked as post-pilot work. Keep the smoke test green until then.
