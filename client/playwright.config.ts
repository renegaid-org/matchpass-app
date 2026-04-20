import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for matchpass-app PWA smoke tests.
 *
 * The full Sprint-B e2e suite (scan happy path, card issuance, review
 * flow, offline queue) needs a fixture Nostr relay and a matchpass-gate
 * running against it. Those harnesses are post-pilot work — this config
 * runs only the shell smoke test by default.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.MP_BASE_URL || 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.MP_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        port: 5175,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 30_000,
      },
});
