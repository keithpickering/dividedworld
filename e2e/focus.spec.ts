import { expect, test } from '@playwright/test';
import { controlsWithoutFocusIndicator } from './focus.ts';

const PAGES = ['/', '/b/general', '/characters', '/standings', '/settings'];

for (const path of PAGES) {
  test(`${path}: every control Tab reaches shows a focus indicator`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
    expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
  });
}

test('a thread, with the reply box and a picker open', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await controlsWithoutFocusIndicator(page, 90)).toEqual([]);
});

/* The poison: a button with outline: none is found by the same check. */
test('the check finds a focused control with outline: none', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a, button { outline: none !important; box-shadow: none !important; }' });
  const bare = await controlsWithoutFocusIndicator(page, 12);
  expect(bare.length).toBeGreaterThan(0);
});
