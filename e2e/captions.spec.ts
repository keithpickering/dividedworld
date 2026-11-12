import { expect, test, type Page } from '@playwright/test';

/**
 * The caption bar's stories in the browser (the Laugh Track plan, Task 7): the real bar stands above the real HUD and never covers it, and fits a phone's width
 * (the first tests), and the live region holds the words (the stories, ids of engine/ui/audio/Captions.board.stories.tsx).
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

type CaptionsWindow = typeof globalThis & { readonly __kbCaptions: { say(w: { text: string; ms: number }): void } };

/* The real bar, over the real HUD, on a signed-in board page: the caption is said through the page's own store (web/src/demo.ts leaves it on
   globalThis in the end-to-end build, the one instance the bar subscribes to), so the bar that appears is the app's. */
const LONG = 'A very long crowd laughs at the thing that was just said, and keeps on going well past the width of a phone';
for (const [width, height, text] of [[390, 844, 'Crowd laughs'], [390, 844, LONG], [1280, 800, 'Crowd laughs'], [1920, 1000, LONG]] as const) {
  test(`at ${width} (${text.length} letters) the bar stands over the HUD with the gutters and the gap, at any scale`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/b/general');
    const hud = page.getByRole('region', { name: 'Game HUD' });
    await expect(hud).toBeVisible();
    await page.evaluate((t) => (globalThis as CaptionsWindow).__kbCaptions.say({ text: t, ms: 60_000 }), text);
    await expect(page.locator('.kb-captions-bar')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    /* The bar's slide-in is a fade, not a move; its box is read once it is as drawn. */
    const bar = await box(page, '.kb-captions-bar');
    const h = await hud.boundingBox();
    if (!h) throw new Error('the HUD has no box');
    expect(bar.y + bar.height).toBeLessThanOrEqual(h.y + 0.5);
    expect(bar.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(bar.x + bar.width).toBeLessThanOrEqual(width - 16 + 0.5);
    expect(bar.y).toBeGreaterThanOrEqual(0);
    /* The gap between the bar and the HUD is the bar's own 10px (captions.css; the bar is not drawn in the board's zoom, so it does not scale, whatever the
       scale: 1280 is 0.89 here), plus under one pixel for the HUD's height rounded up to whole pixels in --kb-hud-measured. */
    const gap = h.y - (bar.y + bar.height);
    expect(gap).toBeGreaterThanOrEqual(10 - 0.01);
    expect(gap).toBeLessThan(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator('.kb-captions-bar').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  });
}

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
