import { expect, test } from '@playwright/test';

/**
 * Entering the glass from a board that was scrolled down: the glass page starts at its top (engine/ui/glass/Page.tsx), as a move between
 * two glass screens does, rather than opening as far down as the board had been read.
 */
test.use({ deviceScaleFactor: 1, viewport: { width: 1440, height: 500 } });

test('a glass page entered from a scrolled board starts at its top', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.locator('.kb-thread-list')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator('.kb-hud-avatar').click();
  await expect(page.locator('.kb-roster-card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
