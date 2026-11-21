/**
 * A poll on a phone (docs/plans/2026-11-20-polls-plan.md, Task 5): below the board's phone width each option's bar and count go on their own line under the option, and on the
 * Main board they stand on the option's own line. Read from the open story's real layout, which jsdom cannot give.
 */
import { expect, test } from '@playwright/test';

const open = async (page: import('@playwright/test').Page, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/?fixture=boards&story=boards-28-polls--open');
  const poll = page.getByRole('group', { name: /^Best kart in the series\?/u });
  await poll.waitFor();
  const row = poll.locator('tr', { hasText: 'Pipe Frame' });
  const box = async (sel: string) => (await row.locator(sel).boundingBox())!;
  return { name: await box('.kb-poll-name'), bar: await box('.kb-poll-barcell'), count: await box('.kb-poll-count') };
};

test('on a phone the bar and the count stand on a line under the option', async ({ page }) => {
  const r = await open(page, 390);
  expect(r.bar.y).toBeGreaterThanOrEqual(r.name.y + r.name.height - 1);
  expect(r.count.y).toBeGreaterThanOrEqual(r.name.y + r.name.height - 1);
  expect(Math.abs(r.count.y - r.bar.y)).toBeLessThan(r.bar.height + 12);
});

test('on the Main board the bar and the count stand beside the option', async ({ page }) => {
  const r = await open(page, 1100);
  expect(r.bar.x).toBeGreaterThan(r.name.x + r.name.width - 1);
  expect(Math.abs(r.bar.y - r.name.y)).toBeLessThan(r.name.height);
});
