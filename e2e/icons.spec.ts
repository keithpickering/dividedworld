import { expect, test } from '@playwright/test';

/**
 * The site's icons are served as files, not as the single-page app (docs/plans/2026-11-02-favicon-design.md
 * §3, §5). An instance's ui/public/ is the site's root (web/vite.config.ts), so the build copies
 * favicon.ico and apple-touch-icon.png there. Without them a request for either is answered with
 * index.html, and browsers and other clients ask for /favicon.ico unprompted.
 */
test('/favicon.ico is an ICO, not the page', async ({ request }) => {
  const res = await request.get('/favicon.ico');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type'] ?? '').not.toContain('text/html');
  const body = await res.body();
  expect([...body.subarray(0, 4)]).toEqual([0x00, 0x00, 0x01, 0x00]);
});

test('/apple-touch-icon.png is a PNG, not the page', async ({ request }) => {
  const res = await request.get('/apple-touch-icon.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type'] ?? '').not.toContain('text/html');
  const body = await res.body();
  expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('the page names both icons', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')).toHaveCount(1);
});
