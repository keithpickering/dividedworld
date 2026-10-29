import { expect, test } from '@playwright/test';

/* The index and a board's thread list at a phone's width: one column, no horizontal scroll. */
test.use({ viewport: { width: 320, height: 640 } });

for (const path of ['/', '/b/general', '/b/the-system']) {
  test(`${path} has no horizontal scroll at 320px wide`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('a board\'s rows are stacked cards on a phone', async ({ page }) => {
  await page.goto('/b/general');
  const row = page.locator('.kb-thread-row').first();
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('block');
});
