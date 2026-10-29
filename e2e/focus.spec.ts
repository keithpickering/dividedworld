import { expect, test } from '@playwright/test';
import { controlsWithoutFocusIndicator, focusedIndicator } from './focus.ts';

/* These specs inject axe and poison styles into the page; the site's policy (e2e/csp.spec.ts holds it) would block them. */
test.use({ bypassCSP: true });

const PAGES = ['/', '/b/general', '/characters', '/standings', '/settings'];

for (const path of PAGES) {
  test(`${path}: every control Tab reaches shows a focus indicator`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
    expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
  });
}

test('a thread with its reply box: every stop shows a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeVisible();
  expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
});

test('the reaction picker: every kind the arrows reach shows a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  /* Opened by keyboard, as the picker's own focus is only drawn for a keyboard user. */
  await page.locator('#post-3').getByRole('button', { name: 'React' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^React as / })).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const f = await focusedIndicator(page);
    expect(f?.visible, f?.name).toBe(true);
    seen.add(f!.name);
    await page.keyboard.press(i % 4 === 3 ? 'ArrowDown' : 'ArrowRight');
  }
  expect(seen.size).toBeGreaterThan(3);
});

test('the spin form: its fields show a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await page.locator('#post-1').getByRole('button', { name: 'Spin thread' }).click();
  await expect(page.getByLabel('Thread title')).toBeFocused();
  expect((await focusedIndicator(page))?.visible).toBe(true);
});

/* The poisons: the same check, on pages where a control's outline is taken away, finds that control and no other. */
test('the check finds a link with outline: none, and only that link', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/standings"] { outline: none !important; box-shadow: none !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare).toHaveLength(1);
  expect(bare[0]).toContain('Standings');
});

test('the check finds an outline that is transparent or the color of the page', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/standings"] { outline-color: transparent !important; } a[href="/characters"] { outline-color: rgb(255, 255, 255) !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare.some((b) => b.includes('Standings'))).toBe(true);
  expect(bare.some((b) => b.includes('Characters'))).toBe(true);
});

test('the check does not count a box-shadow the control always has', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/standings"] { outline: none !important; box-shadow: 0 0 0 2px red !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare.some((b) => b.includes('Standings'))).toBe(true);
});

test('Tab cycles back to the start on a page, and the check throws when it cannot', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'HUD' })).toBeVisible();
  await expect(controlsWithoutFocusIndicator(page, 3)).rejects.toThrow(/never came round/u);
});
