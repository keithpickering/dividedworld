import { expect, test, type Page } from '@playwright/test';

/**
 * Feelin' Fab's foil as a browser lays it out and draws it (docs/plans/2026-11-06-shine-plan.md, Task 9; the design's sections 1, 3, 5
 * and 6): the canvas (.dw-fab-foil) lies under the words and takes no pointer, a post scrolled out of view draws no frames, reduced
 * motion draws once, and a switch of the board redraws with the other board's band. The computed styles and the element at a point are
 * read from a real page, so a rule that never wins the cascade is red where a regex over fab.css is green. The poisons plant each
 * defect with a style tag and name it: the check reports a list of problems, [] when the page is right, and each poison test expects
 * its own problem in that list (CSP is bypassed for the plant, as e2e/glass-text.spec.ts does; e2e/csp.spec.ts holds the policy).
 *
 * Draws are counted through the loop's probe, which the story page hands over as `window.__kbShineDraws(n)`
 * (instances/divided-world/ui/feelin-fab/Fab.board.stories.tsx): the application exposes nothing.
 */
test.use({ bypassCSP: true });

const STORY = (name: string) => `/?fixture=boards&story=boards-10-feelin-fab--${name}`;
const FAB = '[data-kb-fab]';

const draws = (page: Page, nth = 0): Promise<number> => page.evaluate((n) => window.__kbShineDraws?.(n) ?? -1, nth);
/** Waits for a number of animation frames in the page, so a loop that was going to draw has had the chance. */
const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((count) => new Promise<void>((done) => { let left = count; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);

/** Opens a story, waits for its first Feelin' Fab, and (in view) for its first draw. */
async function open(page: Page, name: string, inView = true) {
  await page.goto(STORY(name));
  await expect(page.locator(FAB).first()).toBeAttached();
  if (inView) {
    await page.locator(FAB).first().scrollIntoViewIfNeeded();
    await expect.poll(() => draws(page)).toBeGreaterThan(0);
  }
}
const plant = (page: Page, css: string) => page.addStyleTag({ content: css });
const setMode = (page: Page, mode: 'light' | 'dark') => page.evaluate((m) => document.documentElement.setAttribute('data-kb-mode', m), mode);

/** The problems with how the canvas lies under the words; none when it is right. */
const layoutProblems = (page: Page, post: number): Promise<string[]> =>
  page.locator(FAB).nth(post).evaluate((host) => {
    const out: string[] = [];
    const canvas = host.querySelector<HTMLCanvasElement>(':scope > canvas.dw-fab-foil');
    const words = host.querySelector<HTMLElement>(':scope > .dw-fab-words');
    if (!canvas || !words) return ['the post has no canvas or no words'];
    const c = getComputedStyle(canvas), w = getComputedStyle(words);
    if (canvas.getAttribute('aria-hidden') !== 'true') out.push('canvas is not hidden from assistive tech');
    if (c.position !== 'absolute') out.push(`canvas is ${c.position}, not absolute`);
    if (c.pointerEvents !== 'none') out.push(`canvas takes the pointer (pointer-events ${c.pointerEvents})`);
    const zc = Number(c.zIndex), zw = Number(w.zIndex);
    if (!(zc < zw)) out.push(`canvas is not under the words (z-index ${c.zIndex} against ${w.zIndex})`);
    const r = canvas.getBoundingClientRect(), h = host.getBoundingClientRect();
    if (Math.abs(r.width - h.width) > 1 || Math.abs(r.height - h.height) > 1) out.push(`canvas is ${r.width}x${r.height}, the post is ${h.width}x${h.height}`);
    /* Where the words sit, whatever answers a pointer must not be the canvas (a canvas with no pointer is skipped by the browser). */
    const wr = words.getBoundingClientRect();
    const over = document.elementFromPoint(wr.left + wr.width / 2, wr.top + Math.min(8, wr.height / 2));
    if (over === canvas) out.push('the canvas lies over the words');
    return out;
  });

/** The mean relative luminance of a sample of the canvas's pixels, and how many of them are painted at all. */
const paint = (page: Page, post: number): Promise<{ lum: number; painted: number; w: number; h: number }> =>
  page.locator(FAB).nth(post).locator('canvas.dw-fab-foil').evaluate((cv: HTMLCanvasElement) => {
    const g = cv.getContext('2d')!;
    const { data } = g.getImageData(0, 0, cv.width, cv.height);
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let sum = 0, n = 0, painted = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      n++;
      if (data[i + 3]! > 0) painted++;
      sum += 0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!);
    }
    return { lum: sum / n, painted: painted / n, w: cv.width, h: cv.height };
  });

test.describe('the foil in a real page', () => {
  test('the canvas lies under the words, fills the post and takes no pointer', async ({ page }) => {
    await open(page, 'two-light');
    expect(await layoutProblems(page, 0)).toEqual([]);
  });

  test('the canvas is painted, at the post\'s size times the device\'s density', async ({ page }) => {
    await open(page, 'three-light');
    const { w, h, painted } = await paint(page, 0);
    const box = (await page.locator(FAB).first().boundingBox())!;
    const dpr = await page.evaluate(() => Math.min(2, window.devicePixelRatio));
    expect(w).toBe(Math.round(Math.round(box.width) * dpr));
    expect(h).toBe(Math.round(Math.round(box.height) * dpr));
    expect(painted).toBeGreaterThan(0.99);
  });

  test('a post in view keeps drawing while shimmer runs', async ({ page }) => {
    await open(page, 'one-light');
    const before = await draws(page);
    await expect.poll(() => draws(page)).toBeGreaterThan(before + 3);
  });

  test('a post scrolled out of view draws no frames, and draws again when it returns', async ({ page }) => {
    await open(page, 'twenty-light');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => { const a = await draws(page); await frames(page, 6); return (await draws(page)) - a; }).toBe(0);
    const away = await draws(page);
    await page.mouse.move(300, 300);
    await frames(page, 20);
    expect(await draws(page)).toBe(away);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => draws(page)).toBeGreaterThan(away);
  });

  test('reduced motion draws once, and neither the pointer nor time draws it again', async ({ page }) => {
    await page.addInitScript(() => document.documentElement.setAttribute('data-kb-motion', 'reduce'));
    await open(page, 'one-still');
    await page.mouse.move(200, 200);
    await page.mouse.move(500, 400);
    await frames(page, 30);
    expect(await draws(page)).toBe(1);
    expect((await paint(page, 0)).painted).toBeGreaterThan(0.99);
  });

  test('switching the board redraws with the other board\'s band, even when the foil is held', async ({ page }) => {
    await page.addInitScript(() => document.documentElement.setAttribute('data-kb-motion', 'reduce'));
    await open(page, 'two-still');
    await frames(page, 10);
    const light = await paint(page, 0);
    expect(light.lum).toBeGreaterThan(0.59);
    const before = await draws(page);
    await setMode(page, 'dark');
    await expect.poll(() => draws(page)).toBe(before + 1);
    const dark = await paint(page, 0);
    expect(dark.lum).toBeLessThan(0.05);
    await setMode(page, 'light');
    await expect.poll(() => draws(page)).toBe(before + 2);
    expect((await paint(page, 0)).lum).toBeGreaterThan(0.59);
  });
});

/*
 * The poisons: each defect the checks above exist to catch, planted by a style tag in a real page, and named by the check.
 * Each red run, with the check expecting no problem, is recorded in the PR that added this spec.
 */
test.describe('the poisons, planted in a real page', () => {
  test('a canvas raised over the words is named', async ({ page }) => {
    await open(page, 'two-light');
    await plant(page, '.dw-fab-foil { z-index: 5 !important }');
    expect(await layoutProblems(page, 0)).toContain('canvas is not under the words (z-index 5 against 1)');
  });

  test('a canvas that takes the pointer is named', async ({ page }) => {
    await open(page, 'two-light');
    await plant(page, '.dw-fab-foil { pointer-events: auto !important }');
    expect(await layoutProblems(page, 0)).toContain('canvas takes the pointer (pointer-events auto)');
  });
});
