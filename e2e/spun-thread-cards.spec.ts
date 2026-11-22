import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { settled } from './settled.ts';
import { sideways } from './sideways.ts';

/**
 * Cards on a spun thread, in a browser (docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 7; design, section 4): the opening post of a spun thread is a post
 * for every card, so it offers what any post does, and its effect fills its content area (`.kb-act-main`, the body between its bars and borders) border to border
 * while the ORIGIN box, set inside that body, stands above it. The story is instances/divided-world/ui/SpunThreadCards.board.stories.tsx: a thread spun by the
 * signed-in player's character, who holds Whoops!, Good Vibes and Glitter Bomb. Each case names the defect that turns it red, its poison.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 1120 } });

const STORY = (name: string) => `/?fixture=boards&story=boards-27-cards-on-a-spun-thread--${name}`;
const HAND = /^Hand, \d+ postcards?$/;

/* The sweep's pace, read from the scrub rules' own source (importing it would pull in React), and refused if it is not found. */
const SCRUB_SOURCE = readFileSync(new URL('../instances/divided-world/cards/whoops/scrub.ts', import.meta.url), 'utf8');
const SWEEP_PX_S = Number(/export const SWEEP_PX_S = (\d+)/.exec(SCRUB_SOURCE)?.[1]);
const ROW_PX = Number(/export const ROW_PX = ([\d.]+)/.exec(SCRUB_SOURCE)?.[1]);
if (!Number.isFinite(SWEEP_PX_S) || !Number.isFinite(ROW_PX)) throw new Error('SWEEP_PX_S or ROW_PX is not in instances/divided-world/cards/whoops/scrub.ts');

interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** The opening post: the article the ORIGIN box stands in. */
const opening = (page: Page) => page.locator('article:has(.kb-origin)').first();
const box = (page: Page) => page.getByRole('group', { name: 'Origin', exact: true });
/** The opening post's content area: the body that holds the box and the spin's own words. */
const body = (page: Page) => opening(page).locator('.kb-act-main[data-kb-content-area]').first();

const padBox = (el: Locator): Promise<Rect> => el.evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left + e.clientLeft, top: r.top + e.clientTop, right: r.left + e.clientLeft + e.clientWidth, bottom: r.top + e.clientTop + e.clientHeight };
});
const borderBox = (el: Locator): Promise<Rect> => el.evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});

/** Opens the story, waits for the opening post with its box and the hand, and lets the entrances settle. */
async function open(page: Page, name = 'cards') {
  await page.goto(STORY(name));
  await expect(box(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: HAND })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
}

/** Arms a card from the hand, as a player does. */
async function arm(page: Page, name: RegExp, settle = true) {
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  if (!(await hand.isVisible())) await page.getByRole('button', { name: HAND }).click();
  /* The hand fans its cards over one another, so a pointer press lands on a neighbor's art: the card is armed from the keyboard, which is how a player without a pointer does it (e2e/hand-arc.spec.ts). */
  await expect(hand).not.toHaveAttribute('data-kb-dealing', '', { timeout: 10_000 });
  await hand.getByRole('button', { name }).first().focus();
  await page.keyboard.press('Enter');
  await expect(hand).toBeHidden();
  /* The hand's exit and the card's arming entrances are done before anything is pressed. A phone's closed hand drawer rests at inline opacity 0 and blur(6px), which `settled` reads as an entrance that never ends: the one case there plays nothing and passes false. */
  if (settle) await settled(page, { loops: true });
}

/** The ink's pictures are built (a layer in each band near the viewport), so a read of its ink is a baseline and not the flat stand-in. */
const built = (page: Page) => expect.poll(() => page.evaluate(() => {
  const el = document.querySelector('article:has(.kb-origin) .kb-whoops');
  if (!el) return false;
  const bands = (el.getAttribute('data-kb-bands') ?? '').split(' ').filter(Boolean).length;
  const live = (el.getAttribute('data-kb-layers') ?? '').split(' ').filter((l) => l === 'live').length;
  return bands > 0 && Number(el.getAttribute('data-kb-pictures')) === live * bands;
}), { timeout: 20_000, message: 'the ink\'s pictures are built' }).toBe(true);

/** The opening post's ink canvases that are not the box's own (the box shows the quoted post, which has none). */
const OUTER_INK = 'article:has(.kb-origin) canvas.kb-whoops-ink';

/** The sum of the alpha of the opening post's own ink canvases, in whole pixels' worth: it falls with every wash. */
const inked = (page: Page) => page.evaluate((sel) => {
  let n = 0;
  for (const c of document.querySelectorAll<HTMLCanvasElement>(sel)) {
    if (c.closest('.kb-origin') || c.width === 0) continue;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) n += d[i]! / 255;
  }
  return Math.round(n);
}, OUTER_INK);

/** What is painted at a point, read from the page itself: a 1 by 1 screenshot, whose PNG holds one filter byte and then the pixel (as e2e/origin-effects.spec.ts reads it). */
async function pixelAt(page: Page, x: number, y: number): Promise<readonly [number, number, number]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }, animations: 'allow' });
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1]!, raw[2]!, raw[3]!];
}

/** Plays Whoops! on the opening post through its play mark and form, as a player does, and waits for the ink. */
async function playWhoops(page: Page) {
  await arm(page, /^Whoops!, Salty\b/);
  await opening(page).getByRole('button', { name: 'Play Whoops! on post 1' }).click();
  const form = page.getByRole('dialog', { name: 'Whoops!' });
  await expect(form).toBeVisible();
  await settled(page, { loops: true });
  await form.getByRole('button', { name: /^Play as Pipewrench$/ }).click();
  await expect(form).toBeHidden();
  await expect(opening(page).locator('canvas.kb-whoops-ink').first(), 'the opening post wears the ink').toBeAttached({ timeout: 15_000 });
  await built(page);
}

/* ------------------------------------------------------------------------------------------ 1. Whoops! ---- */

test('1. Whoops! on the opening post: armed, marked, played, its ink fills the content area and the box stands above it; the wash clears it', async ({ page }) => {
  /* Poison: `Body` in engine/ui/thread/Post.tsx stops drawing `PostEffects place="thread"` for a spin (the ink is never drawn), or draws it into the words' own box (it then
     does not fill `.kb-act-main`); `.kb-origin` loses its `data-kb-over-ink` (the ink is then over the box, and a press in the box is the ink's). */
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await arm(page, /^Whoops!, Salty\b/);
  /* The play mark is on the opening post's own strip, in its header and never in the box. */
  const ghost = opening(page).getByRole('button', { name: 'Play Whoops! on post 1' });
  await expect(ghost, 'the armed card\'s play mark is on the opening post').toHaveCount(1);
  expect(await ghost.evaluate((g) => g.closest('.kb-origin') === null && g.closest('.kb-act-meta') !== null), 'in the post\'s header, not in the box').toBe(true);
  await page.keyboard.press('Escape');
  await playWhoops(page);

  /* The ink's canvases, taken together, are the content area's padding box, within a pixel on each side. */
  await expect.poll(async () => {
    const a = await padBox(body(page));
    const rects = await page.evaluate((sel) => [...document.querySelectorAll<HTMLCanvasElement>(sel)].filter((c) => !c.closest('.kb-origin')).map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), OUTER_INK);
    if (rects.length === 0) return 'no ink on the opening post';
    const u = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    const off = SIDES.filter((k) => Math.abs(u[k] - a[k]) > 1).map((k) => `${k} ${u[k].toFixed(1)} against the area's ${a[k].toFixed(1)}`);
    return off.length === 0 ? 'fills' : `the ink does not fill the opening post's content area: ${off.join('; ')}`;
  }, { message: 'the ink fills the opening post\'s content area', timeout: 10_000 }).toBe('fills');

  /* The box stands above the ink: it is lifted over it, an element of the box answers at every point of it, and the box's pixels are the same with the opening post's ink shown and hidden. */
  await expect(page.locator('.kb-origin')).toHaveAttribute('data-kb-over-ink', /.*/);
  const region = await borderBox(box(page));
  const answers = await page.evaluate((r) => {
    const out: boolean[] = [];
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.25, 0.5, 0.75]) {
      const e = document.elementFromPoint(r.left + (r.right - r.left) * fx, r.top + (r.bottom - r.top) * fy);
      out.push(e !== null && document.querySelector('.kb-origin')!.contains(e));
    }
    return out;
  }, region);
  expect(answers.every(Boolean), 'an element of the box answers at every point tried in it').toBe(true);
  /* What is painted inside the box is the box's: at up to nine points of its rectangle where the opening post's ink lies under it (read from the canvases), the pixel is the same (within 2 of a channel) with every
     canvas of the opening post shown and hidden, and the box is painted over the canvas at each (a hit test cannot say, the canvases take no pointer: they are made to take one for the read).
     A point on bare ground would pass whether the box were lifted or not, so only inked points count, and there must be some. */
  const inkedPoints = await page.evaluate(([sel, l, t, r, b]) => {
    const found: { x: number; y: number }[] = [];
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>(sel as string)].filter((c) => !c.closest('.kb-origin') && c.width > 0);
    for (let y = (t as number) + 4; y < (b as number) - 4; y += 10) for (let x = (l as number) + 4; x < (r as number) - 4; x += 10) {
      for (const c of canvases) {
        const cr = c.getBoundingClientRect();
        if (x < cr.left || x >= cr.right || y < cr.top || y >= cr.bottom) continue;
        const k = c.width / cr.width;
        if (c.getContext('2d')!.getImageData(Math.floor((x - cr.left) * k), Math.floor((y - cr.top) * k), 1, 1).data[3]! > 40) { found.push({ x, y }); break; }
      }
    }
    return found;
  }, [OUTER_INK, region.left, region.top, region.right, region.bottom] as const);
  expect(inkedPoints.length, 'the ink has pixels under the box\'s rectangle, so the check below is tied to ink').toBeGreaterThan(0);
  const stride = Math.max(1, Math.floor(inkedPoints.length / 9));
  const points = inkedPoints.filter((_, i) => i % stride === 0).slice(0, 9);
  for (const p of points) {
    const order = await page.evaluate(([px, py]) => {
      const canvases = [...document.querySelectorAll<HTMLElement>('article:has(.kb-origin) canvas')].filter((c) => !c.closest('.kb-origin'));
      const was = canvases.map((c) => c.style.pointerEvents);
      for (const c of canvases) c.style.pointerEvents = 'auto';
      const all = document.elementsFromPoint(px!, py!);
      canvases.forEach((c, i) => { c.style.pointerEvents = was[i]!; });
      const b = document.querySelector('.kb-origin')!;
      return { inBox: all.findIndex((e) => b.contains(e)), canvas: all.findIndex((e) => canvases.includes(e as HTMLElement)) };
    }, [p.x, p.y] as const);
    expect(order.inBox, `the box answers at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).toBeGreaterThanOrEqual(0);
    if (order.canvas >= 0) expect(order.inBox, `the box is painted over the opening post's canvas at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).toBeLessThan(order.canvas);
    const painted = await pixelAt(page, p.x, p.y);
    await page.evaluate(() => { for (const c of document.querySelectorAll<HTMLElement>('article:has(.kb-origin) canvas')) if (!c.closest('.kb-origin')) c.style.visibility = 'hidden'; });
    const without = await pixelAt(page, p.x, p.y);
    await page.evaluate(() => { for (const c of document.querySelectorAll<HTMLElement>('article:has(.kb-origin) canvas')) c.style.visibility = ''; });
    expect(Math.max(...painted.map((v, i) => Math.abs(v - without[i]!))), `the pixel at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) is the box's, the same with the opening post's ink shown and hidden (${painted} shown, ${without} hidden)`).toBeLessThanOrEqual(2);
  }
  /* A press and drag inside the box is the box's: the ink is not washed by it. */
  const before = await inked(page);
  const inner = await borderBox(box(page).locator('.kb-origin-area'));
  const y = (inner.top + inner.bottom) / 2;
  await page.mouse.move(inner.left + 40, y);
  await page.mouse.down();
  for (let pass = 0; pass < 6; pass++) await page.mouse.move(inner.left + (pass % 2 === 0 ? 240 : 40), y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await inked(page), 'a scrub across the box washes none of the opening post\'s ink').toBe(before);
  /* Positive control: the same kind of scrub outside the box, on the opening post's own inked body, does wash some, so the line above is not true of a scrub that washes nothing anywhere. */
  const bodyBox = await borderBox(body(page));
  const outside = [
    { top: region.bottom + 4, bottom: bodyBox.bottom - 4 },
    { top: bodyBox.top + 4, bottom: region.top - 4 },
  ].find((s) => s.bottom - s.top >= 12);
  expect(outside, 'the opening post\'s body has room outside the box to scrub').toBeDefined();
  /* A press begins a wash only on ink, so it begins at a point of the strip that the canvases show inked. */
  const start = await page.evaluate(([sel, l, t, r, b]) => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>(sel as string)].filter((c) => !c.closest('.kb-origin') && c.width > 0);
    for (let y = (t as number); y < (b as number); y += 4) for (let x = (l as number); x < (r as number); x += 8) {
      for (const c of canvases) {
        const cr = c.getBoundingClientRect();
        if (x < cr.left || x >= cr.right || y < cr.top || y >= cr.bottom) continue;
        const k = c.width / cr.width;
        if (c.getContext('2d')!.getImageData(Math.floor((x - cr.left) * k), Math.floor((y - cr.top) * k), 1, 1).data[3]! > 200) return { x, y };
      }
    }
    return null;
  }, [OUTER_INK, bodyBox.left + 60, outside!.top, bodyBox.right - 260, outside!.bottom] as const);
  expect(start, 'the strip outside the box has ink to begin a scrub on').not.toBeNull();
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  for (let pass = 0; pass < 6; pass++) await page.mouse.move(start!.x + (pass % 2 === 0 ? 200 : 0), start!.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await inked(page), 'a scrub outside the box, on the opening post\'s body, does wash some of its ink').toBeLessThan(before);

  /* The way out, on the opening post: the Lens's "Hold to scrub" (the keyboard path, timed like a scrub) clears the ink. A pass down the body takes a line's width over the pace for each line. */
  const area = await borderBox(body(page));
  const PASS_S = ((area.bottom - area.top) / ROW_PX) * ((area.right - area.left) / SWEEP_PX_S);
  const SWEEP_MS = Math.round(Math.max(60, 6 * PASS_S) * 1000);
  test.setTimeout(SWEEP_MS + 60_000);
  await opening(page).locator('.kb-mark[data-kb-card="whoops"]:not(.kb-ghost-mark)').click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await expect(lens).toBeVisible();
  await lens.getByRole('button', { name: 'Hold to scrub' }).focus();
  const whoops = opening(page).locator('.kb-whoops');
  await page.keyboard.down('Space');
  const began = Date.now();
  while (Date.now() - began < SWEEP_MS && (await whoops.getAttribute('data-kb-layers')) !== 'clean') await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  test.info().annotations.push({ type: 'sweep', description: `${Date.now() - began}ms of ${SWEEP_MS}ms (a pass down the body is ${PASS_S.toFixed(1)}s)` });
  await expect(whoops, 'the wash clears the opening post\'s ink').toHaveAttribute('data-kb-layers', 'clean');
});

/* ------------------------------------------------------------------------------------------ 2. Good Vibes ---- */

test('2. Good Vibes is played from the thread\'s head by the spinner, and its mark is beside the title', async ({ page }) => {
  /* Poison: `Post.tsx`'s thread head draws the thread's reach mark only for a thread that began with a `post` Act (a spun thread's head then has no play mark for its spinner). */
  await open(page);
  await arm(page, /^Good Vibes, /);
  const head = page.locator('.kb-thread-head');
  await head.getByRole('button', { name: /^Use Good Vibes on / }).click();
  const form = page.getByRole('dialog', { name: 'Good Vibes' });
  await expect(form).toBeVisible();
  await settled(page, { loops: true });
  await form.getByRole('button', { name: /^Use as Pipewrench$/ }).click();
  await expect(form).toBeHidden();
  const mark = head.locator('.kb-thread-head-marks .kb-mark[data-kb-card="good-vibes"]:not(.kb-ghost-mark)');
  await expect(mark, 'the play is a mark in the head').toHaveCount(1);
  /* Beside the title: on the title's row, to its right, in the head's own frame. */
  const t = await borderBox(head.getByRole('heading', { level: 1 }));
  const m = await borderBox(mark);
  expect(m.left, 'the mark is to the right of the title\'s start').toBeGreaterThan(t.left);
  expect(Math.abs((m.top + m.bottom) / 2 - (t.top + t.bottom) / 2), 'the mark shares the title\'s row').toBeLessThan(((t.bottom - t.top) + (m.bottom - m.top)) / 2);
});

/* ------------------------------------------------------------------------------------------ 3. Glitter Bomb ---- */

test('3. Glitter Bomb is cast on the spinner from the opening post\'s postbit', async ({ page }) => {
  /* Poison: the postbit's character strip is drawn only for a `post` Act (the opening post's postbit then has no play mark for a character card). */
  await open(page);
  await arm(page, /^Glitter Bomb, /);
  const bit = opening(page).locator('.kb-postbit');
  await bit.getByRole('button', { name: 'Play Glitter Bomb on Pipewrench' }).click();
  const form = page.getByRole('dialog', { name: 'Glitter Bomb' });
  await expect(form).toBeVisible();
  await settled(page, { loops: true });
  await form.getByRole('button', { name: /^Play as Pipewrench$/ }).click();
  await expect(form).toBeHidden();
  await expect(bit.locator('.kb-mark[data-kb-card="glitter-bomb"]:not(.kb-ghost-mark)'), 'the play is a mark on the postbit').toHaveCount(1);
});

/* ------------------------------------------------------------------------------------------ 4. keyboard ---- */

test('4. with reduced motion, the opening post\'s play mark is reachable by keyboard and named, and opens the form', async ({ page }) => {
  /* Poison: the play mark is drawn as a non-button (a span or a div with a handler): Tab never lands on it, and Enter opens nothing. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await arm(page, /^Whoops!, Salty\b/);
  const ghost = opening(page).getByRole('button', { name: 'Play Whoops! on post 1' });
  await expect(ghost).toHaveAccessibleName('Play Whoops! on post 1');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  for (let i = 0; i < 120 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await ghost.evaluate((g) => g === document.activeElement);
  }
  expect(reached, 'Tab reaches the opening post\'s play mark').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Whoops!' }), 'Enter opens the play form').toBeVisible();
});

/* ------------------------------------------------------------------------------------------ 5. phone ---- */

test('5. at phone width the page has no horizontal scroll with the opening post\'s strip and the band\'s marks both drawn', async ({ page }) => {
  /* Poison: the opening post's strip drawn with `flex-wrap: nowrap` and no room for its marks (the header then pushes the page wider than the window). */
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'cards-phone');
  await arm(page, /^Whoops!, Salty\b/, false);
  const strip = opening(page).locator('.kb-act-meta .kb-marks');
  await expect(strip.locator('.kb-mark').first(), 'the opening post\'s strip has marks').toBeVisible();
  await expect(opening(page).getByRole('button', { name: 'Play Whoops! on post 1' }), 'and the armed card\'s play mark').toBeVisible();
  const band = box(page).locator('.kb-origin-head .kb-mark').first();
  await expect(band, 'the band has its own marks').toBeVisible();
  /* Two strips in two frames: the band's marks are never in the opening post's header, and the other way round. */
  expect(await strip.evaluate((s) => s.closest('.kb-origin') === null), 'the opening post\'s strip is not in the box').toBe(true);
  const art = await opening(page).elementHandle();
  expect(await strip.evaluate((s, a) => s.closest('.kb-act-meta') !== null && a!.contains(s), art), 'the opening post\'s strip is in the opening post\'s header').toBe(true);
  expect(await band.evaluate((m) => m.closest('.kb-origin-head') !== null && m.closest('.kb-origin') !== null), 'the band\'s mark is in the ORIGIN box\'s band').toBe(true);
  expect(await band.evaluate((m) => m.closest('.kb-act-meta') === null), 'and not in the opening post\'s header').toBe(true);
  expect(await sideways(page), 'the page does not reach past the window').toBeLessThanOrEqual(0);
  const client = await page.evaluate(() => document.documentElement.clientWidth);
  for (const m of await opening(page).locator('.kb-mark').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }))) {
    expect(m.l).toBeGreaterThanOrEqual(0);
    expect(m.r).toBeLessThanOrEqual(client);
  }
});
