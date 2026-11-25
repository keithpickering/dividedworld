import { expect, test, devices, type Page } from '@playwright/test';
import type { E2eWindow } from './glass-screens.ts';

/**
 * It's Curtains in a browser (docs/plans/2026-11-23-its-curtains-plan.md, Task 8). The curtain's own parts are Vitest's (instances/divided-world/ui/its-curtains/*.test.tsx);
 * what is here is what only a browser decides: what is under the curtain and what a Tab reaches, the real caption bar, a real mouse, a touch swipe against a tap, and the
 * order of the bar, the curtain and the post. The cases run in the app, with a post seeded through `__kbFake` (the e2e build's hook), because the story route has no caption
 * bar. The ORIGIN box case is in e2e/origin-effects.spec.ts.
 *
 * The owner's tuning (its-curtains/tuning.ts): the halves open in 500 ms, the confetti is thrown 40% of the way through the open on ONE window-sized fixed canvas, the drumroll
 * caption comes with a mouse that really moves over the curtain, and on a touch screen while the curtain crosses the reader's line.
 *
 * The post is Mrs. Hooligan's, the curtains Spritey's (the demo world's two characters). Captions are the words of the sound slots (instances/divided-world/ui/sounds.ts):
 * "Drumroll" while the loop plays, "Ta-da!" when the tada plays.
 */
test.use({ bypassCSP: true });

const MAIN = { width: 1280, height: 800 } as const;
type Fabric = 'red' | 'royal-blue' | 'gold';

/** The curtain's own button: the face a reader presses. */
const curtain = (page: Page) => page.locator('.kb-row-cover .dw-curtain-button');
const words = (page: Page) => page.locator('.kb-act-main', { hasText: 'THE-WORDS-UNDER-THE-CURTAIN' });
const NAME = 'Mrs. Hooligan';
/** A held caption (a loop's) is on the visible stack, not in the live region, which only announces what is said once. */
const held = (page: Page) => page.locator('.kb-captions-text').first();
const region = (page: Page) => page.getByRole('status', { name: 'Sound captions' });

interface Opts { readonly fabrics?: readonly Fabric[]; readonly fold?: boolean; readonly padding?: number; readonly size?: { width: number; height: number } }

/**
 * Seeds a thread with a post by Mrs. Hooligan under the given curtains (outermost last in `fabrics`, as layers go up), and `padding` filler posts above and below it,
 * then opens the thread. Returns once the curtain is drawn.
 */
async function openInApp(page: Page, o: Opts = {}) {
  const fabrics = o.fabrics ?? ['red'];
  if (o.size) await page.setViewportSize(o.size);
  else if (!page.viewportSize()) await page.setViewportSize(MAIN);
  await page.addInitScript(() => { try { sessionStorage.setItem('kb-demo-preferences', JSON.stringify({ gameSound: 'off' })); } catch { /* not kept */ } });
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  const thread = await page.evaluate(({ fabrics: fs, fold, padding }) => {
    const w = globalThis as E2eWindow;
    const { characters } = w.__kbDemo;
    const made = w.__kbFake.seed.thread('general', characters.spritey, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best. Number one is Double Dash.');
    const filler = (n: number) => Array.from({ length: n }, (_, i) => w.__kbFake.seed.post(made.thread, characters.spritey, `Filler post ${i + 1}: ${'ordinary words '.repeat(40)}`));
    filler(padding);
    const post = w.__kbFake.seed.post(made.thread, characters.hooligan, 'THE-WORDS-UNDER-THE-CURTAIN. I would like to formally announce that Double Dash is the greatest game ever made.\n\nA second paragraph, so the row has some height to hang its pleats from.');
    filler(padding);
    fs.forEach((fabric, i) => w.__kbFake.seed.card(characters.spritey, post, 'its-curtains', { layer: i + 1, live: true, config: { fabric }, message: `A ${fabric} curtain` }));
    if (fold) w.__kbFake.seed.card(characters.spritey, post, 'below-the-fold', { layer: fs.length + 1, live: true, config: {}, message: 'Below the fold' });
    return made.thread;
  }, { fabrics, fold: o.fold === true, padding: o.padding ?? 0 });
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, thread);
  await expect(o.fold ? row(page).locator('.kb-fold-bar') : curtain(page)).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  /* e2e/settled.ts is not used: the spotlights rest at an inline opacity of 0.28, which it reads as an entrance that never ends. A short wait lets the entrances go instead. */
  await page.waitForTimeout(500);
  if (!o.fold) await curtain(page).evaluate((el) => el.closest('.kb-row-cover')!.scrollIntoView({ block: 'center', behavior: 'instant' }));
}

/** The post's article: the one holding the words. */
function row(page: Page) { return rowOf(page); }
const rowOf = (page: Page) => page.locator('article', { has: page.locator('.kb-act-main', { hasText: 'THE-WORDS-UNDER-THE-CURTAIN' }) }).last();

const confettiCanvas = (page: Page) => page.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => { const s = getComputedStyle(c); return s.position === 'fixed' && s.pointerEvents === 'none'; }).length);

/** What is on top at a point of the row's middle: the curtain's button, or something of the post. */
const topAtMiddle = async (page: Page) => {
  await curtain(page).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const r = (await row(page).locator('.kb-act-grid').first().boundingBox())!;
  return page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x!, y!);
    return { curtain: el?.closest('.dw-curtain-button') !== null, what: el ? el.tagName + '.' + el.className : null, inPost: el?.closest('.kb-act-grid') !== null && el?.closest('.kb-row-cover') === null };
  }, [r.x + r.width / 2, r.y + r.height / 2] as const);
};

const opened = async (page: Page) => {
  await expect(page.locator('.kb-row-cover')).toHaveCount(0, { timeout: 5000 });
  await expect(words(page).first()).toBeVisible();
};

test('with a mouse: the row is hidden under the curtain and Tab never reaches it, the mouse starts the drumroll, a click opens, and Encore shuts it again', async ({ page }) => {
  await openInApp(page);
  /* Hidden: the curtain's button is what a pointer finds over the whole row, postbit included, and the row's grid is inert. */
  const r = (await row(page).locator('.kb-act-grid').first().boundingBox())!;
  const c0 = (await curtain(page).boundingBox())!;
  expect(c0.y, 'the curtain starts at the top of the row').toBeLessThanOrEqual(r.y + 1);
  expect(c0.y + c0.height, 'and ends at its bottom').toBeGreaterThanOrEqual(r.y + r.height - 1);
  expect(await topAtMiddle(page)).toMatchObject({ curtain: true, inPost: false });
  const postbit = row(page).locator('.kb-postbit').first();
  const pb = (await postbit.boundingBox())!;
  const over = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.dw-curtain-button') !== null, [pb.x + pb.width / 2, pb.y + pb.height / 2] as const);
  expect(over, 'the postbit is under the curtain too').toBe(true);
  expect(await row(page).locator('.kb-act-grid').evaluate((el) => [...el.children].filter((k) => !k.classList.contains('kb-row-cover')).every((k) => k.hasAttribute('inert'))), 'everything of the post\'s grid is inert').toBe(true);
  /* Tab: go through the whole page. Nothing inside the post's grid is ever focused, and the curtain's button is. */
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const seen = new Set<string>();
  let inGrid = false;
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const a = document.activeElement;
      return { grid: a?.closest('.kb-act-grid') !== null && a?.closest('.kb-row-cover') === null && a?.closest('.kb-act-grid')?.textContent?.includes('THE-WORDS-UNDER-THE-CURTAIN') === true, curtain: a?.classList.contains('dw-curtain-button') === true };
    });
    if (at.grid) inGrid = true;
    if (at.curtain) seen.add('curtain');
  }
  expect(inGrid, 'a Tab reached something inside the covered post').toBe(false);
  expect(seen.has('curtain'), 'a Tab reached the curtain\'s button').toBe(true);
  /* A mouse that really moves over the curtain: the drumroll's caption. */
  await curtain(page).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const c = (await curtain(page).boundingBox())!;
  await page.mouse.move(c.x - 40, c.y + c.height / 2);
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
  await page.mouse.move(c.x + c.width / 2 + 20, c.y + c.height / 2 + 6, { steps: 4 });
  await expect(held(page)).toHaveText(/drumroll/iu, { timeout: 4000 });
  /* A click opens it: the ta-da, then the post's name and words, visible and pressable. */
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await expect(region(page)).toHaveText(/ta-da/iu, { timeout: 4000 });
  await opened(page);
  await expect(row(page).locator('.kb-postbit').first()).toContainText(NAME);
  expect(await row(page).locator('.kb-act-grid').evaluate((el) => [...el.children].some((k) => k.hasAttribute('inert'))), 'nothing of the post is inert once open').toBe(false);
  await expect(row(page).getByRole('button', { name: /^Quote$|^Reply$|Quote|React/u }).first()).toBeVisible();
  const mid = await words(page).first().boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.kb-act-main') !== null, [mid!.x + mid!.width / 2, mid!.y + 8] as const), 'the words are what a press reaches').toBe(true);
  /* Encore in the Lens shuts it again. */
  await row(page).getByRole('button', { name: /It.s Curtains/u }).first().click();
  const lens = page.getByRole('dialog');
  await expect(lens.getByText('Open for you')).toBeVisible();
  await lens.getByRole('button', { name: 'Encore' }).click();
  await expect(curtain(page)).toBeVisible();
  expect(await topAtMiddle(page)).toMatchObject({ curtain: true, inPost: false });
});

test('three stacked: three presses, each showing the next fabric, and the third shows the post', async ({ page }) => {
  /* Layers go up outward: the last seeded is outermost, so Red, Royal Blue, Gold from the outside is gold-last order reversed. */
  await openInApp(page, { fabrics: ['gold', 'royal-blue', 'red'] });
  const fabricOf = () => curtain(page).getAttribute('data-dw-fabric');
  const underOf = () => page.locator('.kb-row-cover [data-dw-under]').getAttribute('data-dw-fabric');
  const label = () => curtain(page).getAttribute('aria-label').then(async (l) => l ?? (await curtain(page).innerText()));
  expect(await fabricOf()).toBe('red');
  expect(await underOf()).toBe('royal-blue');
  expect(await label()).toMatch(/Open the curtain, 1 of 3/u);
  /* A pointer over the stack finds the outermost curtain's button, not the pleats of the one under it. */
  expect(await topAtMiddle(page), 'what a pointer finds at the stack\'s middle').toMatchObject({ curtain: true, inPost: false });
  await curtain(page).click();
  await expect.poll(fabricOf, { timeout: 5000 }).toBe('royal-blue');
  expect(await underOf()).toBe('gold');
  await expect.poll(label).toMatch(/2 of 3/u);
  expect(await topAtMiddle(page)).toMatchObject({ curtain: true, inPost: false });
  await curtain(page).click();
  await expect.poll(fabricOf, { timeout: 5000 }).toBe('gold');
  expect(await page.locator('.kb-row-cover [data-dw-under]').count()).toBe(0);
  await expect.poll(label).toMatch(/3 of 3/u);
  expect(await topAtMiddle(page)).toMatchObject({ curtain: true, inPost: false });
  await curtain(page).click();
  await opened(page);
});

test('keyboard alone: Tab to the curtain, then Enter opens it', async ({ page }) => {
  await openInApp(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 120; i++) {
    if (await curtain(page).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(curtain(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await opened(page);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('one press opens it, and no confetti canvas is ever made', async ({ page }) => {
    await openInApp(page);
    await page.evaluate(() => {
      const w = window as unknown as { __seenCanvas: number };
      w.__seenCanvas = 0;
      new MutationObserver(() => { w.__seenCanvas += document.querySelectorAll('canvas').length; }).observe(document.body, { childList: true, subtree: true });
    });
    await curtain(page).click();
    await opened(page);
    await page.waitForTimeout(800);
    expect(await confettiCanvas(page), 'no confetti canvas now').toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __seenCanvas: number }).__seenCanvas), 'and none was added while it opened').toBe(0);
  });
});

test('with motion, a press throws confetti on one window-sized fixed canvas and removes it after', async ({ page }) => {
  await openInApp(page);
  await curtain(page).click();
  await expect.poll(() => confettiCanvas(page), { timeout: 3000 }).toBe(1);
  const size = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find((k) => getComputedStyle(k).position === 'fixed')!; const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
  expect(size.w).toBe(size.iw);
  expect(size.h).toBe(size.ih);
  await opened(page);
  await expect.poll(() => confettiCanvas(page), { timeout: 6000 }).toBe(0);
});

test('Below the Fold on the same post: the bar, then the curtain, then the post', async ({ page }) => {
  await openInApp(page, { fold: true });
  const bar = row(page).locator('.kb-fold-bar');
  await expect(bar).toBeVisible();
  const toggle = row(page).getByRole('button', { name: /Show post|Hide post/u }).first();
  /* The bar is outermost: the post is folded, and a curtain shows only once the bar is opened. */
  await expect(toggle).toHaveText(/Show post/u);
  await expect(curtain(page)).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveText(/Hide post/u);
  await expect(curtain(page)).toBeVisible();
  const b = (await bar.boundingBox())!;
  const c = (await curtain(page).boundingBox())!;
  expect(c.y, 'the curtain is under the bar').toBeGreaterThanOrEqual(b.y + b.height - 1);
  expect(await topAtMiddle(page)).toMatchObject({ curtain: true, inPost: false });
  await curtain(page).click();
  await opened(page);
  const after = (await words(page).first().boundingBox())!;
  expect(after.y, 'the words are under the bar').toBeGreaterThan(b.y + b.height - 1);
});

test.describe('on a phone', () => {
  const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
  test.use({ ...pixel });

  /** A touch's swipe by the DevTools protocol: a finger down at (x, y), dragged by dy over `steps`, and lifted. */
  async function swipe(page: Page, x: number, y: number, dy: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  /** Puts the curtain's row across the reader's line, and then out of it. */
  const lineY = (page: Page) => page.evaluate(() => {
    const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
    return ((window.innerHeight - hud) * 50) / 100;
  });
  const scrollRowTo = (page: Page, rel: 'across' | 'above') => page.evaluate(async (where) => {
    const el = document.querySelector('.kb-row-cover')!;
    const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
    const line = ((window.innerHeight - hud) * 50) / 100;
    const r = el.getBoundingClientRect();
    window.scrollBy({ top: where === 'across' ? r.top + r.height / 2 - line : r.bottom + 200 - line, behavior: 'instant' });
  }, rel);

  test('scrolling the post through the line shows the drumroll, a swipe from the curtain scrolls and opens nothing, and a tap opens it', async ({ page }) => {
    await openInApp(page, { padding: 6, size: { width: 412, height: 915 } });
    /* Scrolled away from the curtain: no drumroll yet. */
    await scrollRowTo(page, 'above');
    await page.waitForTimeout(300);
    await expect(page.locator('.kb-captions-text').filter({ hasText: /drumroll/iu })).toHaveCount(0);
    /* Through the line: the drumroll's caption. */
    await scrollRowTo(page, 'across');
    expect(await lineY(page)).toBeGreaterThan(0);
    await expect(held(page)).toHaveText(/drumroll/iu, { timeout: 4000 });
    /* A swipe that starts on the curtain scrolls the page, and the curtain is still shut. */
    const c = (await curtain(page).boundingBox())!;
    const y0 = await page.evaluate(() => window.scrollY);
    await swipe(page, c.x + c.width / 2, Math.min(c.y + c.height / 2, 700), -240);
    await page.waitForTimeout(400);
    const y1 = await page.evaluate(() => window.scrollY);
    expect(y1, 'the swipe scrolled the page').toBeGreaterThan(y0 + 50);
    await expect(page.locator('.kb-row-cover')).toHaveCount(1);
    expect(await confettiCanvas(page), 'nothing was thrown').toBe(0);
    /* A tap opens it. */
    await scrollRowTo(page, 'across');
    await page.waitForTimeout(300);
    const t = (await curtain(page).boundingBox())!;
    await page.touchscreen.tap(t.x + t.width / 2, Math.min(t.y + t.height / 2, 800));
    await opened(page);
  });
});
