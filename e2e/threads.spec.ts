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

test.describe('a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the thread column takes most of the row and the counts are narrow', async ({ page }) => {
    await page.goto('/b/general');
    await expect(page.locator('.kb-thread-row').first()).toBeVisible();
    const widths = await page.locator('.kb-thread-list thead th').evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect().width));
    const total = widths.reduce((a, b) => a + b, 0);
    // flags, thread, replies, views, last post
    expect(widths[1]! / total).toBeGreaterThan(0.4);
    expect(widths[2]! / total).toBeLessThan(0.12);
    expect(widths[3]! / total).toBeLessThan(0.12);
  });

  test('the new-thread form is closed until asked for, and opens above the list with focus on its title', async ({ page }) => {
    await page.goto('/b/general');
    const button = page.getByRole('button', { name: 'Start a thread' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
    await button.click();
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeFocused();
  });
});
