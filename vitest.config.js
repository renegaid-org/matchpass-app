import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    // Only the server's own tests/ dir. The client has its own vitest
    // config and the Playwright e2e dir must never be picked up here.
    include: ['tests/**/*.test.js'],
    exclude: ['client/**', 'node_modules/**'],
  },
});
