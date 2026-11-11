import { expect, test, type Page } from '@playwright/test';

/**
 * The caption bar's stories in the browser (the Laugh Track plan, Task 7): the bar stands above the HUD and never covers it, fits a phone's width,
 * and the live region holds the words. The stories are ids of engine/ui/audio/Captions.board.stories.tsx.
 */
const open = async (page: Page, id: string) => {
  await page.goto(`/?fixture=boards&story=${id}`);
  await expect(page.locator('.kb-captions-bar')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
};

for (const [id, width] of [['boards-captions--short-main', 1280], ['boards-captions--long-main', 1280], ['boards-captions--held-main', 1280], ['boards-captions--short-phone', 390], ['boards-captions--long-phone', 390], ['boards-captions--held-phone', 390]] as const) {
  test(`${id}: the bar fits the window and stands clear of the HUD's seam`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, id);
    const bar = await box(page, '.kb-captions-bar');
    expect(bar.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(bar.x + bar.width).toBeLessThanOrEqual(width - 16 + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    /* Above the seam: its 10px gap (the Main board is scaled to the window, so a little less there) stands between its bottom edge and the window's,
       over the HUD's measured height (zero where a story has no HUD; the real HUD is held by the next test). */
    expect(800 - (bar.y + bar.height)).toBeGreaterThanOrEqual(width === 390 ? 9.5 : 8);
    expect(await page.locator('.kb-captions-bar').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  });
}

test('on a page with the HUD, the bar never covers it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/b/general');
  const hud = page.getByRole('region', { name: 'Game HUD' });
  await expect(hud).toBeVisible();
  const h = await hud.boundingBox();
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.className = 'kb-captions-bar';
    bar.textContent = 'Crowd laughs';
    document.body.append(bar);
  });
  const bar = await box(page, '.kb-captions-bar');
  expect(h).not.toBeNull();
  expect(bar.y + bar.height).toBeLessThanOrEqual(h!.y + 0.5);
});

test('the live region holds the words, and the drawn bar is hidden from a screen reader', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'boards-captions--short-main');
  const region = page.getByRole('status', { name: 'Sound captions' });
  await expect(region).toHaveText('Crowd laughs');
  await expect(page.locator('.kb-captions-bar')).toHaveAttribute('aria-hidden', 'true');
});

test('a held caption is italic and not announced', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'boards-captions--held-main');
  await expect(page.locator('.kb-captions-text')).toHaveCSS('font-style', 'italic');
  await expect(page.getByRole('status', { name: 'Sound captions' })).toHaveText('');
});
