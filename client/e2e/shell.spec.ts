import { test, expect } from '@playwright/test';

test('PWA shell loads and asks for pairing', async ({ page }) => {
  await page.goto('/');
  // The Pair screen is the default when no session is present.
  await expect(page.getByText(/pair/i)).toBeVisible({ timeout: 10_000 });
});

test('service worker registers', async ({ page }) => {
  // The dev server does not register the SW (see lib/sw-register.ts),
  // so this assertion only runs against a production build. Skip when
  // running against the Vite dev server.
  test.skip(
    !process.env.MP_BASE_URL,
    'service worker only registers in production builds',
  );
  await page.goto('/');
  const hasSw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  });
  expect(hasSw).toBe(true);
});
