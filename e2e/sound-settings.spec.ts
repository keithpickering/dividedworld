import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../engine/ui/data/api.ts';
import { pageViolations } from './axe.ts';

/**
 * Settings > Sound in the browser (the Laugh Track plan, Task 7): each row saves its choice to the account and keeps it across a reload, the volume
 * shows only while its sound is on, and axe finds nothing on the section or on the welcome page, which carries the same rows.
 */
test.use({ bypassCSP: true });

const ROWS = [
  { legend: 'Game sounds', volume: 'Game volume' },
  { legend: 'Interface sounds', volume: 'Interface volume' },
] as const;

const group = (page: Page, name: string) => page.getByRole('radiogroup', { name });

for (const row of ROWS) {
  test(`${row.legend} saves and reloads its choice, and ${row.volume} shows only while on`, async ({ page }) => {
    await page.goto('/settings?section=sound');
    const radios = group(page, row.legend);
    await expect(radios).toBeVisible();
    await expect(radios.getByRole('radio', { name: 'Off' })).toBeChecked();
    await expect(page.getByLabel(row.volume)).toHaveCount(0);
    await radios.getByRole('radio', { name: 'On' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('Saved to your account.')).toBeVisible();
    await expect(page.getByLabel(row.volume)).toBeVisible();
    await page.reload();
    await expect(group(page, row.legend).getByRole('radio', { name: 'On' })).toBeChecked();
    await expect(page.getByLabel(row.volume)).toBeVisible();
    await group(page, row.legend).getByRole('radio', { name: 'Off' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel(row.volume)).toHaveCount(0);
    await page.reload();
    await expect(group(page, row.legend).getByRole('radio', { name: 'Off' })).toBeChecked();
  });
}

test('a volume is saved and is still there after a reload', async ({ page }) => {
  await page.goto('/settings?section=sound');
  await group(page, 'Game sounds').getByRole('radio', { name: 'On' }).focus();
  await page.keyboard.press('Space');
  const range = page.getByLabel('Game volume');
  await range.focus();
  const before = DEFAULT_PREFERENCES.gameVolume;
  await expect(range).toHaveValue(String(before));
  await page.keyboard.press('ArrowLeft');
  const after = before - 5;
  await expect(range).toHaveValue(String(after));
  /* A release is saved once the range is left (or after a short quiet); leaving it is the sure way, and the account's save follows. */
  await page.keyboard.press('Tab');
  /* The account's save, as the demo world keeps it for the tab (web/src/demo.ts), is what a reload reads back; the note under the rows is already up from the On press. */
  await expect.poll(() => page.evaluate(() => (JSON.parse(sessionStorage.getItem('kb-demo-preferences') ?? '{}') as { gameVolume?: number }).gameVolume)).toBe(after);
  await page.reload();
  await expect(page.getByLabel('Game volume')).toHaveValue(String(after));
});

test('axe finds nothing on Settings > Sound, off and on', async ({ page }) => {
  await page.goto('/settings?section=sound');
  await expect(page.getByRole('heading', { level: 2, name: 'Sound' })).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
  await group(page, 'Game sounds').getByRole('radio', { name: 'On' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Game volume')).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
});

test('axe finds nothing on the welcome page, which carries the sound rows', async ({ page }) => {
  await page.goto('/welcome');
  await expect(group(page, 'Game sounds')).toBeVisible();
  await expect(group(page, 'Interface sounds')).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
});
