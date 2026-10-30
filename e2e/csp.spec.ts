import { expect, test } from '@playwright/test';

/**
 * The page under the headers the site is served with (web/headers.ts, served by `vite preview`):
 * they are there, and walking the main flows, the avatar editor's WebAssembly fallback included,
 * the browser reports no Content-Security-Policy violation.
 */
test('the response carries the security headers and the asset cache rule', async ({ page, request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(h['content-security-policy']).toContain('https://*.supabase.co');
  expect(h['referrer-policy']).toBe('strict-origin');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  void page;
});

test('the main flows run under the policy with no violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/content security policy/iu.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', (e) => violations.push(e.message));
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
  await expect(page.getByRole('dialog', { name: /^React as / })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/characters');
  await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
  await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/settings');
  await page.getByRole('radio', { name: /^Dark/u }).check();
  await expect(page.locator('html')).toHaveAttribute('data-kb-mode', 'dark');
  expect(violations).toEqual([]);
});
