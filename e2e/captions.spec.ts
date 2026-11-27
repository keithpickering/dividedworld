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

/* A line rises as it enters (the stack moves as the toasts do), so a box is read once two reads 50 ms apart agree. */
const box = async (page: Page, selector: string) => {
  let last: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 80; i++) {
    const b = await page.locator(selector).first().boundingBox();
    if (!b) throw new Error(`${selector} has no box`);
    if (last && last.x === b.x && last.y === b.y && last.width === b.width && last.height === b.height) return b;
    last = b;
    await page.waitForTimeout(50);
  }
  throw new Error(`${selector} never came to rest`);
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
    /* The bar's rise is waited out by `box`. */
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

type Says = { say(w: { text: string; ms: number }): void };
for (const [width, height] of [[390, 844], [1280, 800]] as const) {
  test(`at ${width} three says stand as three bars inside the gutters above the HUD, each above the next, and a fourth pushes out the first`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/b/general');
    const hud = page.getByRole('region', { name: 'Game HUD' });
    await expect(hud).toBeVisible();
    const say = (text: string) => page.evaluate((t) => ((globalThis as unknown as { __kbCaptions: Says }).__kbCaptions).say({ text: t, ms: 60_000 }), text);
    for (const t of ['A steel chair clangs', 'A chair clatters to the floor', 'Crowd laughs']) await say(t);
    const bars = page.locator('.kb-captions-bar');
    await expect(bars).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    /* Each line rises as it enters: settle, then read the boxes. */
    await expect(async () => {
      const boxes = await bars.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      const h = await hud.boundingBox();
      if (!h) throw new Error('the HUD has no box');
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(16 - 0.5);
        expect(b.x + b.w).toBeLessThanOrEqual(width - 16 + 0.5);
      }
      const last = boxes[2]!;
      expect(h.y - (last.y + last.h)).toBeGreaterThanOrEqual(10 - 0.01);
      expect(boxes[0]!.y + boxes[0]!.h).toBeLessThanOrEqual(boxes[1]!.y + 0.5);
      expect(boxes[1]!.y + boxes[1]!.h).toBeLessThanOrEqual(boxes[2]!.y + 0.5);
    }).toPass({ timeout: 4000 });
    await say('A fourth line');
    await expect(bars).toHaveCount(3);
    await expect(bars.filter({ hasText: 'A steel chair clangs' })).toHaveCount(0);
    await expect(bars.last()).toHaveText(/a fourth line/i);
  });
}

test('the live region holds the words, and the drawn bar is hidden from a screen reader', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'boards-captions--short-main');
  const region = page.getByRole('status', { name: 'Sound captions' });
  await expect(region).toHaveText('Crowd laughs');
  await expect(page.locator('.kb-captions')).toHaveAttribute('aria-hidden', 'true');
});

test('a held caption is italic and not announced', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'boards-captions--held-main');
  await expect(page.locator('.kb-captions-text')).toHaveCSS('font-style', 'italic');
  await expect(page.getByRole('status', { name: 'Sound captions' })).toHaveText('');
});

/* The phone's stack is compact (the owner's word on 2026-11-27, look A of the phone bench): 13px words with no tracking in a 4px tray, 4px between lines,
   so three fire-extinguisher lines each sit on one row and the stack stays near a hundred pixels rather than one and a half times that. */
test('at 390 three captions stand compact: each on one row, the stack under a hundred pixels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  const say = (text: string) => page.evaluate((t) => ((globalThis as unknown as { __kbCaptions: Says }).__kbCaptions).say({ text: t, ms: 60_000 }), text);
  for (const t of ['A fire extinguisher thunks', 'A fire extinguisher hisses', 'A fire extinguisher clunks to the floor']) await say(t);
  const bars = page.locator('.kb-captions-bar');
  await expect(bars).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const text = page.locator('.kb-captions-text').first();
  await expect(text).toHaveCSS('font-size', '13px');
  await expect(text).toHaveCSS('letter-spacing', 'normal');
  await expect(async () => {
    const heights = await page.locator('.kb-captions-text').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeLessThan(13 * 1.25 * 1.5 + 4); /* one row of words and its padding, never two */
    expect((await box(page, '.kb-captions')).height).toBeLessThan(100);
  }).toPass({ timeout: 4000 });
});
