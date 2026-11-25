import { expect, test, type Locator, type Page } from '@playwright/test';
import { fogAlpha } from '../instances/divided-world/ui/hot-box/smoke.ts';
import { roomHeightOf } from '../instances/divided-world/ui/steel-chair/chair.ts';
import { inflateSync } from 'node:zlib';
import { pageViolations } from './axe.ts';
import { settled } from './settled.ts';
import { BODY_FLOOR, REDRAWN_SHARE, redrawn, type Sample } from './shine-share.ts';

/** The room a post of chairs keeps: the stories' plays have ids that roll chairs. */
const ROOM_HEIGHT = roomHeightOf([]);

/**
 * Card effects in a spun thread's ORIGIN box, as a browser lays them out (docs/plans/2026-11-15-origin-box-effects-plan.md, Task 3; design, sections 2 to 7).
 * The rule: an effect on a post fills the post's content area, border to border, and in the box that area is `div.kb-origin-area`, the box under its band out
 * to its other three borders (`data-kb-content-area`). The stories are instances/divided-world/ui/OriginEffects.board.stories.tsx. Each case names the defect
 * that turns it red, its poison.
 *
 * Shared helpers: `box` is the group named "Origin", `area` its content area, `padBox` an element's padding box in client px, and `fills` asserts that a layer's
 * four edges are within a pixel of the area's padding box, polled, since an effect places its layers from a ResizeObserver.
 *
 * Time. Hot Box reads the page's clock and the model's times are seconds long, so its cases install Playwright's clock, pause it once the page has settled and
 * move it with `runFor`, as e2e/hot-box.spec.ts does.
 *
 * Case 11 is not in the plan: `GlitterOver` holds a play on the character who spun the thread (delivered with their post on the page), and case 11 reads the box over that glitter. The stories `Under` and `FabBright` seed their plays on the spin's own Act, as a server holds them.
 *
 * Cases 12 to 14 are Task 7 of the plan, the box's foil held to the cost a post's is (the bound is e2e/shine-share.ts's, which e2e/shine.spec.ts holds a busy thread to): at rest, out of view, and
 * with the opening post's foil and the box's together. They read the loop through the story's `window.__kbOriginShine`.
 *
 * Cases 15 to 19 are Task 4 of docs/plans/2026-11-16-steel-chair-origin-plan.md (issue #768): Steel Chair's shading and chairs in the ORIGIN box on a post that reads `!` (`ChairLanded`, and at the phone's width `ChairLandedPhone`). Its case 5 (the cap still holds)
 * is e2e/steel-chair.spec.ts's `theLineCanBeRead`, whose browser's union is read against the minimum of each dent's own uncapped shade (from dent.ts) at the same 0.12; its case 1 on `WithFab`, and the axe case on it, are in that spec. Case 7's loop reads `ChairLanded` too (the plan's case 4).
 *
 * Cases 3b, 3c and 13b are Tasks 4 and 13 of docs/plans/2026-11-16-playable-moments-plan.md: a moment's list stands in the box's foot, a moment is playable (scrub, Reset, no request), and a moment's ink is freed out of view.
 *
 * Case 10 of the plan (a box with nothing under its band draws no area) is not here: no story's box is the band alone (the plan's own condition), so
 * engine/ui/spin/Spin.test.tsx's case 4 holds it.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 1120 } });

const STORY = (name: string) => `/?fixture=boards&story=boards-26-origin-effects--${name}`;
const box = (page: Page) => page.getByRole('group', { name: 'Origin', exact: true });
const area = (page: Page) => box(page).locator('.kb-origin-area');
const band = (page: Page) => box(page).locator('.kb-origin-head');
/** The byline: a band of the box's own between the band and the area (the owner, 2026-11-21: it is "not part of the post itself"). */
const byline = (page: Page) => box(page).locator(':scope > .kb-origin-byline');
const history = (page: Page) => box(page).getByRole('button', { name: 'History', exact: true });

interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** An element's padding box in the viewport: its border box inside its borders. */
const padBox = (el: Locator): Promise<Rect> => el.evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left + e.clientLeft, top: r.top + e.clientTop, right: r.left + e.clientLeft + e.clientWidth, bottom: r.top + e.clientTop + e.clientHeight };
});
/** An element's border box in the viewport. */
const borderBox = (el: Locator): Promise<Rect> => el.evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});
const centerOf = async (el: Locator) => { const r = await borderBox(el); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };

/** Opens a story, waits for its box and the fonts, and lets the entrances settle. */
async function open(page: Page, name: string, o: { readonly frozen?: boolean; readonly ready?: () => Promise<void> } = {}) {
  if (o.frozen) await page.clock.install({ time: Date.now() });
  await page.goto(STORY(name));
  await expect(box(page)).toBeVisible({ timeout: 20_000 });
  await expect(area(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  /* What the story seeds once its page is up (the opening post's plays) is waited for before the clock is stopped, which would stop the seeding's own timers. */
  await o.ready?.();
  await settled(page, { loops: true });
  if (o.frozen) await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

/** Moves a frozen page's clock, and gives React's scheduler (not faked) the turn it needs to draw what the move changed. */
const run = (page: Page, ms: number) => page.clock.runFor(ms);

/**
 * The union of the layer's elements' boxes is the area's padding box: each of the four edges within a pixel. Polled, since a layer is placed by a
 * ResizeObserver; the failure names which edge is off, and by how much, or that there is no layer at all.
 */
async function fills(layer: Locator, areaEl: Locator, what: string) {
  await expect.poll(async () => {
    const a = await padBox(areaEl);
    const rects = await layer.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
    if (rects.length === 0) return `no ${what} in the box`;
    const u = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    const off = SIDES.filter((k) => Math.abs(u[k] - a[k]) > 1).map((k) => `${k} ${u[k].toFixed(1)} against the area's ${a[k].toFixed(1)}`);
    return off.length === 0 ? 'fills' : `${what} does not fill the area: ${off.join('; ')}`;
  }, { message: `${what} fills the area's padding box`, timeout: 10_000 }).toBe('fills');
}

/** A color as the page resolves a token, read through a probe element. */
const token = (page: Page, name: string) => page.evaluate((n) => {
  const p = document.createElement('i');
  p.style.color = `var(${n})`;
  document.body.append(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, name);

/** The ink canvases' alpha (0 to 255) at a viewport point, the strongest of those that cover it, each read at its own place and scale; null when no canvas covers it. */
const inkAlpha = (page: Page, selector: string, x: number, y: number) => page.evaluate(([sel, px, py]) => {
  let best: number | null = null;
  for (const c of document.querySelectorAll<HTMLCanvasElement>(sel as string)) {
    const r = c.getBoundingClientRect();
    if ((px as number) < r.left || (px as number) >= r.right || (py as number) < r.top || (py as number) >= r.bottom || c.width === 0) continue;
    const k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(Math.floor(((px as number) - r.left) * k), Math.floor(((py as number) - r.top) * k), 1, 1).data;
    best = Math.max(best ?? 0, d[3]!);
  }
  return best;
}, [selector, x, y] as const);

/**
 * The longest stretch of solid ink (alpha over 40) along any of the horizontal lines at `ys`, between `from` and `to`, sampled every `step` px, as [from, to, y]; null when no line has any.
 * The fonts and the line heights of a machine move a line a few px, so a caller offers a band of lines and takes the best, not one it measured on its own.
 */
const solidRun = (page: Page, selector: string, ys: readonly number[], from: number, to: number, step = 6) => page.evaluate(([sel, lines, a, b, st]) => {
  const cvs = [...document.querySelectorAll<HTMLCanvasElement>(sel as string)];
  const solid = (px: number, py: number) => cvs.some((c) => {
    const r = c.getBoundingClientRect();
    if (px < r.left || px >= r.right || py < r.top || py >= r.bottom || c.width === 0) return false;
    const k = c.width / r.width;
    return c.getContext('2d')!.getImageData(Math.floor((px - r.left) * k), Math.floor((py - r.top) * k), 1, 1).data[3]! > 40;
  });
  let best: [number, number, number] | null = null;
  for (const y of lines as number[]) {
    let at: number | null = null;
    for (let x = a as number; x <= (b as number); x += st as number) {
      if (solid(x, y)) { at ??= x; if (best === null || x - at > best[1] - best[0]) best = [at, x, y]; } else at = null;
    }
  }
  return best;
}, [selector, ys, from, to, step] as const);
/** `n` lines evenly across a span (the middle of each of n equal parts of it). */
const linesIn = (top: number, bottom: number, n: number): number[] => Array.from({ length: n }, (_, i) => top + ((i + 0.5) / n) * (bottom - top));

/** The sum of the alpha of every canvas the selector names, in whole pixels' worth: it falls with every wash (e2e/whoops.spec.ts). */
const inked = (page: Page, selector: string) => page.evaluate((sel) => {
  let n = 0;
  for (const c of document.querySelectorAll<HTMLCanvasElement>(sel)) {
    if (c.width === 0) continue;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) n += d[i]! / 255;
  }
  return Math.round(n);
}, selector);

/** The post's pictures are built (a layer in each band near the viewport), so a read of its ink is a baseline and not the flat stand-in. */
const built = (page: Page, whoops: string) => expect.poll(() => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const bands = (el.getAttribute('data-kb-bands') ?? '').split(' ').filter(Boolean).length;
  const live = (el.getAttribute('data-kb-layers') ?? '').split(' ').filter((l) => l === 'live').length;
  return bands > 0 && Number(el.getAttribute('data-kb-pictures')) === live * bands;
}, whoops), { timeout: 20_000, message: 'the ink\'s pictures are built' }).toBe(true);

/* ------------------------------------------------------------------------------------------ 1. the area ---- */

test('1. the area is the box under its band and byline, out to the box\'s other three borders', async ({ page }) => {
  /* Poison: give `.kb-origin` back its 0.4em bottom padding (the area's bottom edge then stands 0.4em above the frame's inner edge). */
  await open(page, 'whoops');
  const a = await padBox(area(page));
  const bandBottom = (await borderBox(band(page))).bottom;
  const line = await borderBox(byline(page));
  const inner = await padBox(box(page));
  expect(Math.abs(line.top - bandBottom), `the byline's top against the band's bottom edge (${line.top} against ${bandBottom})`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.top - line.bottom), `the area's top against the byline's bottom edge (${a.top} against ${line.bottom})`).toBeLessThanOrEqual(0.5);
  for (const k of ['left', 'right', 'bottom'] as const) expect(Math.abs(a[k] - inner[k]), `the area's ${k} against the box's border box less its 1px border (${a[k]} against ${inner[k]})`).toBeLessThanOrEqual(0.5);
});

/* ------------------------------------------------------------------------------------------ 2. Whoops! ---- */

for (const [name, size] of [['whoops', { width: 1440, height: 1120 }], ['whoops-phone', { width: 390, height: 844 }]] as const) {
  test(`2. Whoops! fills the box's area and is solid in its bottom-left corner, and the byline stands outside it (${name})`, async ({ page }) => {
    /* Poison: `bleed` and the `.kb-act-main` class lookup put back in Whoops!'s measure (the state before Task 4): the ink is the words' box, not the area. */
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, name);
    await built(page, '.kb-origin .kb-whoops');
    const ink = box(page).locator('canvas.kb-whoops-ink');
    await fills(ink, area(page), 'the ink');
    const a = await padBox(area(page));
    const line = await borderBox(byline(page));
    const inkAt = (x: number, y: number) => inkAlpha(page, '.kb-origin canvas.kb-whoops-ink', x, y);
    /* The byline is the box's band and no part of the post: it stands above the area, so the ink that fills the area never covers it. */
    expect(line.bottom, `the byline (${JSON.stringify(line)}) stands above the area (${JSON.stringify(a)})`).toBeLessThanOrEqual(a.top + 0.5);
    const atCorner = await inkAt(a.left + 2, a.bottom - 2);
    expect(atCorner, 'the ink at a point 2px inside the area\'s bottom-left corner').not.toBeNull();
    expect(atCorner!, 'the ink is solid in the corner').toBeGreaterThan(40);
  });
}

/* ------------------------------------------------------------------------------------------ 3. a moment ---- */

for (const name of ['whoops-landed', 'glitter-spun'] as const) {
  test(`3. a moment's effect is painted as a live post's: it fills the area, and no ring is drawn (${name})`, async ({ page }) => {
    /* Poison: `MomentView` drawn outside the area (the effect then finds the opening post's body, or none). */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, name);
    const layer = name === 'whoops-landed' ? box(page).locator('canvas.kb-whoops-ink') : box(page).locator('canvas.dw-glitter-under');
    await fills(layer, area(page), name === 'whoops-landed' ? 'the still ink' : 'the glitter\'s under canvas');
    await expect(box(page).locator('.kb-moment')).toHaveCount(1);
    expect(await area(page).locator('.kb-moment').count(), 'the moment is inside the area').toBe(1);
    await expect(box(page).locator('.kb-moment-ring'), 'a moment in the box is the content: no ring').toHaveCount(0);
  });
}

/*
 * What a moment says under its post stands in the box's foot, outside the area (docs/plans/2026-11-16-playable-moments-plan.md, Task 4), so an effect that fills the
 * area is solid in its bottom-left corner as a live box's is (case 2), and the list's box is clear of the area's.
 */
test('3b. with a Whoops! moment in the box, the ink is solid in the area\'s bottom-left corner, and the list stands outside the area', async ({ page }) => {
  /* Poison: the list drawn inside the area again (it then stands over the corner and meets the area's box). */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'whoops-landed');
  await built(page, '.kb-origin .kb-whoops');
  const list = box(page).locator('.kb-origin-foot .kb-moment-list');
  await expect(list).toBeVisible();
  const a = await padBox(area(page));
  const l = await borderBox(list);
  expect(l.top >= a.bottom - 0.5 || l.bottom <= a.top + 0.5 || l.left >= a.right - 0.5 || l.right <= a.left + 0.5, `the list stands outside the content area: its box (${JSON.stringify(l)}) does not intersect the area's (${JSON.stringify(a)})`).toBe(true);
  /* The foot is lifted by its own rule, not by the opening post's `[data-kb-content-area] [data-kb-over-ink]` rule (thread.css): with that ancestor's mark taken off, the foot is still positioned and on top. */
  await box(page).evaluate((el) => { for (let up = el.parentElement; up; up = up.parentElement) up.removeAttribute('data-kb-content-area'); });
  const foot = await box(page).locator('.kb-origin-foot').evaluate((el) => { const c = getComputedStyle(el); return { position: c.position, zIndex: c.zIndex }; });
  expect(foot, 'the foot is positioned and lifted by its own rule').toEqual({ position: 'relative', zIndex: '2' });
  const hit = await list.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top !== null && el.closest('.kb-origin-foot')!.contains(top); });
  expect(hit, "the topmost element at the list's center is inside the foot").toBe(true);
  /* The corner is as solid as the wash saved in the story's moment (its ink there is untouched), so this asks only that the moment's ink is drawn there. */
  const atCorner = await inkAlpha(page, '.kb-origin canvas.kb-whoops-ink', a.left + 2, a.bottom - 2);
  expect(atCorner, "the moment's ink canvas can be sampled at a point 2px inside the area's bottom-left corner").not.toBeNull();
  expect(atCorner!, "the moment's ink is solid (drawn, not washed) at that corner of the area").toBeGreaterThan(40);
});

/*
 * A moment is playable (docs/plans/2026-11-16-playable-moments-design.md, sections 1 and 4): a scrub across the box's Whoops! washes its ink, Reset in the head brings it back from the moment's own state,
 * and nothing is requested between the two: what a reader does in a moment leaves their screen no further than the canvas.
 */
test("3c. scrubbing in the box's Whoops! moment washes ink, Reset brings it back, and no request is made between the two", async ({ page }) => {
  /* Poison: Reset's press does nothing (the ink stays washed), or a moment's scrub sends a save (a request is then made). */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'whoops-landed');
  await built(page, '.kb-origin .kb-whoops');
  const INK = '.kb-origin canvas.kb-whoops-ink';
  await expect.poll(() => inked(page, INK)).toBeGreaterThan(1000);
  /* The moment's own markup has no byline row to find, so the ink is looked for along the area's rows: the longest stretch of solid ink on 24 of them. */
  const a = await padBox(area(page));
  const along = await solidRun(page, INK, linesIn(a.top, a.bottom, 24), a.left, a.right, 3);
  expect(along, 'the ink has a stretch of solid ink in the area to scrub across').not.toBeNull();
  expect(along![1] - along![0], `the stretch is long enough to scrub across (${along})`).toBeGreaterThanOrEqual(24);
  const before = await inked(page, INK);
  const requests: string[] = [];
  /* The backend is the page's own fake, so a save is no network request: it is counted where the fake takes it (the story's `__kbOriginSaves`). */
  const saves = () => page.evaluate(() => window.__kbOriginSaves!());
  const savesBefore = await saves();
  page.on('request', (r) => { requests.push(`${r.method()} ${r.resourceType()} ${r.url()}`); });
  const [from, to, y] = along!;
  const mid = (from + to) / 2;
  await page.mouse.move(mid, y);
  await page.mouse.down();
  for (let pass = 0; pass < 6; pass++) await page.mouse.move(mid + (pass % 2 === 0 ? 1 : -1) * Math.max(8, (to - from) / 2 - 4), y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => inked(page, INK), { message: 'a scrub in the moment washes ink' }).toBeLessThan(before);
  await box(page).locator('.kb-origin-head .kb-origin-reset').click();
  await expect.poll(() => inked(page, INK), { message: 'Reset brings the ink back' }).toBeGreaterThan(before * 0.95);
  expect(requests, 'no request is made between the scrub and Reset').toEqual([]);
  expect(await saves(), 'the fake backend is asked to save or release nothing between the scrub and Reset').toBe(savesBefore);
});

/* ------------------------------------------------------------------------------------------ 4. Feelin' Fab ---- */

test('4. Feelin\' Fab fills the area at the density its words cost, and lies under the words', async ({ page }) => {
  /* Poison: `paintScale` forced to 1 in the effect (the backing is then the area's size at full density, not at the density the words cost). */
  await open(page, 'fab');
  const foil = box(page).locator('canvas.dw-fab-foil');
  await fills(foil, area(page), 'the foil');
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const want = await page.evaluate(() => {
    const host = document.querySelector('.kb-origin [data-kb-fab]')!;
    const cell = host.closest<HTMLElement>('[data-kb-content-area]')!;
    const own = host.getBoundingClientRect(), painted = cell.clientWidth * cell.clientHeight;
    const scale = Math.min(1, Math.max(0.5, Math.sqrt((own.width * own.height) / painted)));
    const d = Math.min(2, window.devicePixelRatio || 1) * scale;
    return { w: Math.round(cell.clientWidth * d), h: Math.round(cell.clientHeight * d), area: cell.matches('.kb-origin-area') };
  });
  expect(want.area, 'the effect\'s body is the box\'s area').toBe(true);
  await expect.poll(() => page.evaluate(() => window.__kbOriginFab?.size(0) ?? null), { message: 'the foil\'s backing size is the area\'s at the density the words cost' }).toEqual({ w: want.w, h: want.h });
  /* Under the words: the canvas is below them in z-order (a hit test could not say so: the foil takes no pointer). */
  const z = await box(page).evaluate((b) => {
    const cv = b.querySelector<HTMLElement>('canvas.dw-fab-foil')!, w = b.querySelector<HTMLElement>('.dw-fab-words')!;
    return { canvas: Number(getComputedStyle(cv).zIndex), words: Number(getComputedStyle(w).zIndex) };
  });
  expect(z.canvas, 'the foil is under the words (z-index)').toBeLessThan(z.words);
});

/* ------------------------------------------------------------------------------------------ 5. bright ink ---- */

test('5. under Brighter effects the box\'s words and quote wear the bright ink; the byline and History keep the board\'s, and the band is the column head\'s', async ({ page }) => {
  /* Poison: the quote's border put back as two selector rules in thread.css (the reset's then outweighs the bright one, or the other way round, whichever area is nearer). */
  await open(page, 'fab-bright');
  const bright = await token(page, '--kb-bright-ink');
  expect(bright, 'the bright ink and the board\'s ink differ, or this proves nothing').not.toBe(await token(page, '--kb-board-fg'));
  await expect(area(page)).toHaveAttribute('data-kb-bright-ink', '');
  const color = (el: Locator, prop: 'color' | 'borderTopColor' | 'textShadow') => el.evaluate((e, p) => getComputedStyle(e)[p as 'color'], prop);
  expect(await color(box(page).locator('.dw-fab-words'), 'color'), 'the words\' color').toBe(bright);
  expect(await color(byline(page), 'color'), 'the byline, outside the area, does not wear the bright ink').not.toBe(bright);
  expect(await color(box(page).locator('.kb-quote'), 'borderTopColor'), 'the quote\'s border color').toBe(bright);
  expect(await color(history(page), 'color'), 'the History button\'s color is the board\'s').toBe(await token(page, '--kb-button-fg'));
  /* The control: the words wear the bright outline in their text-shadow, so its absence on History is a difference and not a property that never carries it. */
  const outline = await token(page, '--kb-bright-outline');
  expect(await color(box(page).locator('.dw-fab-words'), 'textShadow'), "the words wear the bright outline (the control for History's)").toContain(outline);
  expect(await color(history(page), 'textShadow'), 'the History button wears no bright outline').not.toContain(outline);
  const head = await page.locator('.kb-acts-head > span').first().evaluate((e) => getComputedStyle(e).color);
  expect(await color(band(page), 'color'), 'the band\'s color is the thread\'s column head\'s').toBe(head);
});

/* ------------------------------------------------------------------------------------------ 6. Hot Box ---- */

test('6. Hot Box fills the area and not the byline, History stands over it, and a clearing opens on the words and not on History', async ({ page }) => {
  /* Poison: the History `<p>` loses its `data-kb-over-ink` mark (the smoke is then over the button, and a pointer on it opens a clearing). */
  /* The smoke's canvas is sized (its picture made on a frame the paused clock would not give) before the clock stops. */
  await open(page, 'hot-box', { frozen: true, ready: () => expect.poll(() => page.evaluate(() => (document.querySelector<HTMLCanvasElement>('.kb-origin canvas.dw-hotbox-smoke')?.width ?? 0) > 0), { message: 'the smoke is sized', timeout: 15_000 }).toBe(true) });
  const smoke = box(page).locator('canvas.dw-hotbox-smoke');
  await fills(smoke, area(page), 'the smoke');
  const fogAt = (x: number, y: number) => page.evaluate(([px, py]) => {
    const cv = document.querySelector<HTMLCanvasElement>('.kb-origin canvas.dw-hotbox-smoke');
    if (!cv || cv.width === 0) return Number.NaN;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const cx = Math.round((px! - r.left) * k), cy = Math.round((py! - r.top) * k);
    const d = cv.getContext('2d')!.getImageData(Math.max(0, cx - 2), Math.max(0, cy - 2), 5, 5).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i]!;
    return sum / (d.length / 4);
  }, [x, y] as const);
  const fogged = (fogAlpha(1) - 0.06) * 255;
  const at = await centerOf(history(page));
  /* The button is what a hit test at its center lands on, and the smoke is fogged under it. */
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent ?? null, [at.x, at.y] as const), 'a hit at the History button\'s center').toBe('History');
  expect(await fogAt(at.x, at.y), 'the smoke is full strength under the button').toBeGreaterThanOrEqual(fogged);
  /* Over the smoke in the paint order, too: the line the button stands in is lifted (a positioned layer above the smoke's), and a hit test cannot say so, the canvas taking no pointer. */
  const layers = await box(page).evaluate((b) => {
    const line = b.querySelector('.kb-origin-area > p:has(button)') as HTMLElement, cv = b.querySelector('canvas.dw-hotbox-smoke') as HTMLElement;
    return { line: getComputedStyle(line).zIndex, smoke: getComputedStyle(cv).zIndex, lifted: line.hasAttribute('data-kb-over-ink') };
  });
  expect(Number(layers.line), `the History line is over the smoke (z-index ${layers.line} against ${layers.smoke}; lifted ${layers.lifted})`).toBeGreaterThan(Number(layers.smoke));
  /* A pointer over History opens no clearing; one over the byline does. */
  await page.mouse.move(at.x, at.y);
  await run(page, 150);
  expect(await fogAt(at.x, at.y), 'a pointer over History opens no clearing').toBeGreaterThanOrEqual(fogged);
  const by = await borderBox(byline(page));
  const filled = await padBox(area(page));
  expect(by.bottom, 'the byline stands above the area the smoke fills').toBeLessThanOrEqual(filled.top + 0.5);
  /* A point on the first line of the words, which the smoke covers. */
  const line = { x: (filled.left + filled.right) / 2, y: filled.top + 12 };
  expect(await fogAt(line.x, line.y), 'the smoke is full strength over the words').toBeGreaterThanOrEqual(fogged);
  await page.mouse.move(line.x, line.y);
  await run(page, 150);
  /* Soft, so that the panel's checks below are still read when the clearing is not there yet. */
  await expect.soft.poll(() => fogAt(line.x, line.y), { message: 'a pointer over the words opens a clearing (the canvas\'s alpha there drops)', timeout: 3000 }).toBeLessThanOrEqual(2);
  /* A press on History opens the panel, and the panel is on an opaque ground that covers its list whole, first row to last, margins included.
     The smoke may show between the History line and the panel: each is lifted on a ground of its own (design, section 3). */
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(history(page)).toHaveAttribute('aria-expanded', 'true');
  const panel = await box(page).locator('.kb-origin-lift').evaluate((wrapper) => {
    /* The ground is on the panel the wrapper holds (spin.css `.kb-origin-lift > :not(:empty)`), a flow root, so its box is what the list stands in. */
    const lift = wrapper.firstElementChild as HTMLElement;
    const g = getComputedStyle(lift);
    const l = lift.getBoundingClientRect();
    const px = (v: string) => parseFloat(v) || 0;
    const outside: string[] = [];
    for (const e of lift.querySelectorAll<HTMLElement>('*')) {
      const r = e.getBoundingClientRect(), c = getComputedStyle(e);
      if (r.width === 0 && r.height === 0) continue;
      if (r.top - px(c.marginTop) < l.top - 0.5 || r.bottom + px(c.marginBottom) > l.bottom + 0.5) outside.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${(r.top - px(c.marginTop)).toFixed(1)}..${(r.bottom + px(c.marginBottom)).toFixed(1)} against ${l.top.toFixed(1)}..${l.bottom.toFixed(1)}`);
    }
    return { bg: g.backgroundColor, rows: lift.querySelectorAll('*').length, outside };
  });
  expect(panel.rows, 'the panel has content').toBeGreaterThan(0);
  const alpha = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(panel.bg);
  expect(alpha, `the panel's background is a color (${panel.bg})`).not.toBeNull();
  expect(Number(alpha![4] ?? 1), `the panel's background is opaque (${panel.bg})`).toBe(1);
  expect(panel.outside, 'the panel\'s ground covers its whole list, margins included: no strip of smoke between a row and the ground\'s edge').toEqual([]);
});

/* ------------------------------------------------------------------------------------------ 7. Steel Chair ---- */

const REST_MS = 10_000;
/** The first seed is the one e2e/steel-chair.spec.ts pins for its own throw; the others are two of its other pins. Where a chair lands depends on the area's measured size and the words' rects, so each run's geometry is measured on the layout it ran on, and none is a number found on one machine. */
const CHAIR_SEEDS = [101, 104, 113];

async function openChair(page: Page, name: string, seed: number) {
  /* A run's seed is the one value read as `getRandomValues(new Uint32Array(1))`, as e2e/steel-chair.spec.ts replaces it; any other read is the page's own. */
  await page.addInitScript((given: number) => {
    const w = window as unknown as { __seed: number };
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((a: ArrayBufferView) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = given; w.__seed = given; return a; }
      return real(a as Uint8Array);
    }) as typeof crypto.getRandomValues;
  }, seed);
  await page.goto(STORY(name));
  await expect(box(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => {
    const groups = [...document.querySelectorAll('.kb-origin .dw-chair-group')];
    return groups.length === 1 && groups.every((g) => g.hasAttribute('data-rest'));
  }), { timeout: REST_MS, message: 'one chair drawn and asleep' }).toBe(true);
}

for (const name of ['chair', 'chair-short', 'chair-landed'] as const) {
  for (const seed of CHAIR_SEEDS) {
    test(`7. Steel Chair's floor and walls are the box's, and its room is the area's (${name}, seed ${seed})`, async ({ page }) => {
      /* Poison: the room put back as `[data-kb-content-area]:has(.dw-chair)::after` (it is then drawn on the opening post's body, which holds the chair by descent, and not on the box's area). */
      await openChair(page, name, seed);
      const m = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('.kb-origin-area')!;
        const r = b.getBoundingClientRect();
        const inner = { left: r.left + b.clientLeft, top: r.top + b.clientTop, right: r.left + b.clientLeft + b.clientWidth, bottom: r.top + b.clientTop + b.clientHeight };
        const chairs = [...b.querySelectorAll<HTMLElement>('.dw-chair-group')].map((g) => {
          const rects = [...g.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect());
          return { left: Math.min(...rects.map((x) => x.left)), top: Math.min(...rects.map((x) => x.top)), right: Math.max(...rects.map((x) => x.right)), bottom: Math.max(...rects.map((x) => x.bottom)) };
        });
        const after = getComputedStyle(b, '::after');
        const lines: Rect[] = [];
        const walker = document.createTreeWalker(b.querySelector('[data-kb-words-box]')!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0) lines.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
        }
        const opening = b.closest('.kb-origin')!.closest<HTMLElement>('.kb-act-main')!;
        const openAfter = getComputedStyle(opening, '::after');
        /* As e2e/steel-chair.spec.ts measures it: the last box of the area that takes room in the flow, against where the area's content ends. */
        const last = [...b.children].filter((c) => getComputedStyle(c).position !== 'absolute').at(-1)!;
        const gap = r.top + b.clientTop + b.clientHeight - parseFloat(getComputedStyle(b).paddingBottom) - last.getBoundingClientRect().bottom;
        return {
          area: inner, chairs, lines,
          room: { display: after.display, content: after.content, height: parseFloat(after.height), gap },
          opening: { content: openAfter.content, height: parseFloat(openAfter.height) || 0 },
        };
      });
      expect(m.chairs.length, 'the chair is drawn in the box').toBeGreaterThan(0);
      for (const [i, c] of m.chairs.entries()) {
        /* Inside the area's padding box: the side walls are its borders and the floor's front is its bottom border (half a pixel allowed at a border). */
        expect(c.left, `chair ${i} left`).toBeGreaterThanOrEqual(m.area.left - 0.5);
        expect(c.right, `chair ${i} right`).toBeLessThanOrEqual(m.area.right + 0.5);
        expect(c.top, `chair ${i} top`).toBeGreaterThanOrEqual(m.area.top - 0.5);
        expect(c.bottom, `chair ${i} bottom: no lower than the area's bottom`).toBeLessThanOrEqual(m.area.bottom + 0.5);
        /* On the floor: no higher than the room above the bottom border. */
        expect(m.area.bottom - c.top, `chair ${i}: top above the area's bottom, the room being ${ROOM_HEIGHT}`).toBeLessThanOrEqual(ROOM_HEIGHT + 1);
        /* Overlap by more than a pixel: a line's rect and a piece's meet at an edge by a rounding, and a font's own leading differs. */
        const covered = m.lines.filter((l) => l.left < c.right - 1 && l.right > c.left + 1 && l.top < c.bottom - 1 && l.bottom > c.top + 1);
        expect(covered, `no word is under the chair's box ${JSON.stringify(c)}`).toEqual([]);
      }
      expect.soft(m.room.display, 'the area\'s ::after is the room (a block)').toBe('block');
      expect.soft(m.room.height, 'the room is ROOM_HEIGHT tall').toBeCloseTo(ROOM_HEIGHT, 0);
      /* And last: at least the room's height is left between the area's last box and the end of its content (e2e/steel-chair.spec.ts `roomIsLast`). */
      expect.soft(m.room.gap, 'room left between the last box and the end of the area\'s content').toBeGreaterThanOrEqual(ROOM_HEIGHT - 1);
      expect.soft(m.opening.content, `the opening post's .kb-act-main has no ::after of its own (${m.opening.height}px tall)`).toMatch(/^(none|normal)$/u);
    });
  }
}

/* ------------------------------------------------------------------------------------------ 8. the box stands above ---- */

/**
 * What is painted at a point, read from the page itself: a 1 by 1 screenshot, whose PNG holds one filter byte and then the pixel (a filter reads the pixels before and above, and a
 * lone pixel has none). A canvas that takes no pointer is never in `elementsFromPoint`, so a hit test cannot say which of two things is painted over the other: what is painted can.
 */
async function pixelAt(page: Page, x: number, y: number): Promise<readonly [number, number, number]> {
  /* `animations: 'allow'`: nothing runs under the box in these stories that `disabled` would stop. The one animation of this page that is keyed on the motion setting forced on <html> and could run in a
     post is a new act's slide-in (thread.css `.kb-act[data-kb-arrived]`), which is inside `prefers-reduced-motion: no-preference`, and the cases that read a pixel emulate reduced motion; the rest keyed on it
     (the sheet, the HUD, reactions, the postcard) are outside the box and the opening post. And `disabled` finishes and cancels animations through the page's animation timeline, which the paused clock does not move. */
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }, animations: 'allow' });
  let kind = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { kind = data[9]!; expect(data[8], 'an 8-bit screenshot').toBe(8); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  expect([2, 6], `a truecolor screenshot (PNG color type ${kind})`).toContain(kind);
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1]!, raw[2]!, raw[3]!];
}

/** Runs `read` with every canvas of the opening post that is not the box's own hidden, and shows them again after: what the box has over them is painted the same either way. */
async function withoutOuterEffects<T>(page: Page, read: () => Promise<T>): Promise<T> {
  const set = (hidden: boolean) => page.evaluate((h) => {
    for (const c of document.querySelectorAll<HTMLElement>('article:has(.kb-origin) canvas')) if (!c.closest('.kb-origin')) c.style.visibility = h ? 'hidden' : '';
  }, hidden);
  await set(true);
  try { return await read(); } finally { await set(false); }
}

/**
 * Which is painted over which at a point, read as the browser stacks them: the opening post's canvases take no pointer, so they are never in `elementsFromPoint`; here they are made
 * to take one for the read alone, and the list is then the paint order, top first. `inBox` is the place of the first element of the box in it, `canvas` of the first canvas of the
 * opening post outside the box (-1 when there is none), `of` the place of the first element that is not one of those canvases and is inside `within` (a selector), or -1.
 */
const stacking = (page: Page, x: number, y: number, within: string | null = null) => page.evaluate(([px, py, sel]) => {
  const canvases = [...document.querySelectorAll<HTMLElement>('article:has(.kb-origin) canvas')].filter((c) => !c.closest('.kb-origin'));
  const was = canvases.map((c) => c.style.pointerEvents);
  for (const c of canvases) c.style.pointerEvents = 'auto';
  const all = document.elementsFromPoint(px as number, py as number);
  canvases.forEach((c, i) => { c.style.pointerEvents = was[i]!; });
  const b = document.querySelector('.kb-origin')!;
  const name = (e: Element) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`;
  return {
    inBox: all.findIndex((e) => b.contains(e)),
    canvas: all.findIndex((e) => canvases.includes(e as HTMLElement)),
    of: sel === null ? -1 : all.findIndex((e) => e.closest(sel as string) !== null && !canvases.includes(e as HTMLElement)),
    top: all.slice(0, 5).map(name).join(' < '),
  };
}, [x, y, within] as const);

/** Five points in the box, one in each of its parts: the band's text, the mark (when a play on the box's post has one), the byline, the words and the History button. */
async function boxPoints(page: Page) {
  const words = await borderBox(area(page).locator(':scope > [data-kb-words-box] > .kb-bb'));
  const head = await borderBox(band(page).locator('.kb-origin-head-text'));
  return {
    band: { x: head.left + 8, y: (head.top + head.bottom) / 2 },
    mark: (await box(page).locator('.kb-mark').count()) > 0 ? await centerOf(box(page).locator('.kb-mark')) : null,
    byline: await centerOf(byline(page)),
    words: { x: words.left + 30, y: words.top + 8 },
    History: await centerOf(history(page)),
  };
}

/** The channel of two pixels that differs most. */
const apart = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

test('8. the box stands above the opening post\'s effects, and its presses are its own', async ({ page }) => {
  /* Poison: `.kb-origin` loses its `data-kb-over-ink` mark (engine/ui/spin/Origin.tsx): the opening post's ink and smoke are then over the box, and its presses start strokes and clearings. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const opening = page.locator('article:has(.kb-origin)').first();
  await open(page, 'under', { frozen: true, ready: async () => {
    await expect(opening.locator('canvas.kb-whoops-ink').first(), "the opening post's Whoops! ink").toBeAttached({ timeout: 15_000 });
    await expect(opening.locator('canvas.dw-hotbox-smoke').first(), "the opening post's Hot Box smoke").toBeAttached({ timeout: 15_000 });
    /* Built before the clock stops: a paused clock freezes the animation frames and the timers the pictures are made on, so a wait for them after it could never end. */
    await built(page, 'article:has(.kb-origin) .kb-whoops');
  } });
  const OPENING_INK = 'article:has(.kb-origin) canvas.kb-whoops-ink';
  /** The strongest alpha of the opening post's canvases the selector names (its ink and smoke by default) at a viewport point. */
  const outerAlpha = (x: number, y: number, sel = 'article:has(.kb-origin) canvas.kb-whoops-ink, article:has(.kb-origin) canvas.dw-hotbox-smoke') => page.evaluate(([px, py, which]) => {
    let best = 0;
    for (const c of document.querySelectorAll<HTMLCanvasElement>(which!)) {
      if (c.closest('.kb-origin')) continue;
      const r = c.getBoundingClientRect();
      if (px! < r.left || px! >= r.right || py! < r.top || py! >= r.bottom || c.width === 0) continue;
      const k = c.width / r.width;
      best = Math.max(best, c.getContext('2d')!.getImageData(Math.floor((px! - r.left) * k), Math.floor((py! - r.top) * k), 1, 1).data[3]!);
    }
    return best;
  }, [x, y, sel] as const);
  const points = await boxPoints(page);
  const words = await borderBox(area(page).locator(':scope > [data-kb-words-box] > .kb-bb'));
  /* Five points in the box, one in each of its parts: an element of the box answers at each (the mark is pressable, which is all that is read of it: its own layer puts it over the opening post's
     canvases whether or not the box is lifted, so its order and its pixel would pass either way). At the other four, what is painted is the box's and not the opening post's effects': that is read as a pixel
     twice, with every canvas of the opening post shown and then hidden, and the box over them gives the same pixel. It can only fail where an effect has ink, so each point is asserted to have some: the
     Hot Box smoke's, which is a fog over the whole post (the Whoops! splat does not reach the band, so it cannot be what is asserted at every point; it is what the scrubs below begin on). */
  for (const [name, p] of Object.entries(points).flatMap(([k, v]) => (v === null ? [] : [[k, v] as const]))) {
    const answers = await page.evaluate(([px, py]) => document.querySelector('.kb-origin')!.contains(document.elementFromPoint(px!, py!)), [p.x, p.y] as const);
    expect(answers, `${name}: an element of the box answers at its point`).toBe(true);
    if (name === 'mark') continue;
    const order = await stacking(page, p.x, p.y);
    expect(order.canvas, `${name}: the opening post has canvases at the point`).toBeGreaterThanOrEqual(0);
    expect(order.inBox, `${name}: the box is painted over the opening post's canvases (box at ${order.inBox}, canvas at ${order.canvas}: ${order.top})`).toBeLessThan(order.canvas);
    expect(await outerAlpha(p.x, p.y), `${name}: the opening post's ink or smoke has ink at the point, or the pixel below proves nothing`).toBeGreaterThan(40);
    const shown = await pixelAt(page, p.x, p.y);
    const hidden = await withoutOuterEffects(page, () => pixelAt(page, p.x, p.y));
    expect(apart(shown, hidden), `${name}: the pixel painted at the point is the box's, the same with the opening post's ink and smoke hidden (${shown} shown, ${hidden} hidden)`).toBeLessThanOrEqual(2);
  }
  /* The opening post's own body, under the box: where its words are, from the box's bottom edge to the post's own. */
  const body = await page.evaluate(() => {
    const b = document.querySelector('.kb-origin')!.getBoundingClientRect();
    const m = document.querySelector('.kb-origin')!.closest('.kb-act-main')!.getBoundingClientRect();
    return { left: m.left, right: m.right, top: b.bottom + 8, bottom: m.bottom - 4 };
  });
  /** A scrub: a press `amp` px left of `x`, drawn back and forth across the stretch. */
  const scrub = async (x: number, y: number, amp: number) => {
    await page.mouse.move(x - amp, y);
    await page.mouse.down();
    for (let pass = 0; pass < 6; pass++) await page.mouse.move(x + (pass % 2 === 0 ? amp : -amp), y, { steps: 12 });
    await page.mouse.up();
    await run(page, 300);
  };
  /* A press has to begin on ink, or the page has it (nothing is washed with or without the box lifted). The longest stretch of solid ink is looked for on a band of lines (every 4 px across 60), within the
     element the press is for, since a machine's fonts move the lines the words stand on and the splat is only where its seed put it. */
  const stretch = async (top: number, bottom: number, from: number, to: number, what: string) => {
    const ys: number[] = [];
    for (let y = top; y <= Math.min(bottom, top + 60); y += 4) ys.push(y);
    const r = await solidRun(page, OPENING_INK, ys, from, to);
    expect(r, `${what}: a stretch of solid ink on a line of the band ${top.toFixed(0)} to ${Math.min(bottom, top + 60).toFixed(0)}`).not.toBeNull();
    expect(r![1] - r![0], `${what}: the stretch is long enough to scrub across (${r})`).toBeGreaterThanOrEqual(160);
    return { x: (r![0] + r![1]) / 2, y: r![2], amp: Math.min(90, (r![1] - r![0]) / 2 - 10) };
  };
  /* The control: below the box the opening post's ink is painted over its own words, so the same read there finds a pixel that differs. Without it a read that never saw ink would pass. */
  const own = await stretch(body.top, body.bottom, body.left, body.right, 'below the box, in the opening post\'s own words');
  const control = await pixelAt(page, own.x, own.y);
  const controlHidden = await withoutOuterEffects(page, () => pixelAt(page, own.x, own.y));
  expect(apart(control, controlHidden), `the control: below the box the pixel painted is the effects' (${control} shown, ${controlHidden} hidden)`).toBeGreaterThan(8);

  /* A scrub across the box's words washes nothing of the opening post's ink; the same scrub over the opening post's own words washes it. Each press begins on ink, found along the line
     it is drawn on (the splat is only where its seed put it): a press with no ink under it starts nothing, lifted box or not. */
  const before = await inked(page, OPENING_INK);
  expect(before, 'the opening post has ink').toBeGreaterThan(1000);
  const inBox = await stretch(words.top + 8, words.bottom - 4, words.left, words.right, 'under the box\'s words');
  expect(await outerAlpha(inBox.x - inBox.amp, inBox.y), 'the scrub across the box begins on ink').toBeGreaterThan(40);
  await scrub(inBox.x, inBox.y, inBox.amp);
  await run(page, 300);
  expect(await inked(page, OPENING_INK), 'a scrub across the box\'s words leaves the opening post\'s ink as it was').toBe(before);
  expect(await outerAlpha(own.x - own.amp, own.y), 'the scrub over the opening post\'s own words begins on ink').toBeGreaterThan(40);
  await scrub(own.x, own.y, own.amp);
  expect(await inked(page, OPENING_INK), 'the same scrub over the opening post\'s own words lowers its ink').toBeLessThan(before);
  /* A pointer over the box opens no clearing in the opening post's smoke. */
  const smokeAt = (x: number, y: number) => page.evaluate(([px, py]) => {
    const cv = [...document.querySelectorAll<HTMLCanvasElement>('canvas.dw-hotbox-smoke')].find((c) => !c.closest('.kb-origin'));
    if (!cv || cv.width === 0) return Number.NaN;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const d = cv.getContext('2d')!.getImageData(Math.round((px! - r.left) * k), Math.round((py! - r.top) * k), 1, 1).data;
    return d[3]!;
  }, [x, y] as const);
  const fog = await smokeAt(points.byline.x, points.byline.y);
  expect(fog, 'the opening post\'s smoke is over the box\'s point').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  await page.mouse.move(points.byline.x, points.byline.y);
  await run(page, 200);
  expect(await smokeAt(points.byline.x, points.byline.y), 'a pointer over the box opens no clearing in the opening post\'s smoke').toBeGreaterThanOrEqual(fog - 2);
  /* The mark's Lens: the play opens, and its Go to post is pressed and navigates to the origin post, whose number the band shows ("Spun from #N"). */
  const originNumber = /Spun from #(\d+) in/u.exec(await band(page).innerText())?.[1];
  expect(originNumber, 'the band names the origin post by its number').toBeDefined();
  expect(points.mark, 'the box has a mark').not.toBeNull();
  await page.mouse.click(points.mark!.x, points.mark!.y);
  const lens = page.getByRole('dialog').filter({ has: page.locator('.kb-lens-body') });
  await lens.getByRole('button', { name: /^\d+ plays? ·/u }).click();
  const go = lens.getByRole('link', { name: 'Go to post' });
  await expect(go, "the mark's Lens has Go to post").toBeVisible();
  /* The story's page answers to its own address, so the move is read where the router makes it: the address it pushes. */
  await page.evaluate(() => {
    const w = window as unknown as { __pushed: string[] };
    w.__pushed = [];
    const push = window.history.pushState.bind(window.history);
    window.history.pushState = (...a: Parameters<History['pushState']>) => { w.__pushed.push(String(a[2])); return push(...a); };
  });
  await go.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pushed: string[] }).__pushed), { message: `Go to post navigates to the origin post, #post-${originNumber}` }).toContainEqual(expect.stringMatching(new RegExp(`#post-${originNumber}$`, 'u')));
});

/* ------------------------------------------------------------------------------------------ 9. the phone ---- */

test.describe('9. the phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the page does not scroll sideways, and Whoops! still fills the area', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'whoops-phone');
    await built(page, '.kb-origin .kb-whoops');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide, 'the page\'s scroll width over its client width').toBeLessThanOrEqual(0);
    await fills(box(page).locator('canvas.kb-whoops-ink'), area(page), 'the ink');
  });

  /* The character-spun box with a second strip (`GlitterOverWhoops`): its head holds the text, the character's mark, the post card's mark and Reset, at the phone's width. */
  test('a character-spun box with two strips does not overflow, and its head text, the marks of both strips and Reset do not overlap', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'glitter-over-whoops-phone');
    const marks = box(page).locator('.kb-origin-head .kb-mark');
    await expect(marks).toHaveCount(2);
    await expect(band(page).locator('.kb-origin-reset')).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
    const own = await box(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(own, 'the box does not overflow itself').toBeLessThanOrEqual(0);
    const parts = { text: await borderBox(band(page).locator('.kb-origin-head-text')), first: await borderBox(marks.nth(0)), second: await borderBox(marks.nth(1)), reset: await borderBox(band(page).locator('.kb-origin-reset')) };
    const whole = await borderBox(box(page));
    for (const [name, b] of Object.entries(parts)) expect(b.left >= whole.left - 0.5 && b.right <= whole.right + 0.5, `${name} is inside the box (${JSON.stringify(b)} in ${JSON.stringify(whole)})`).toBe(true);
    const names = Object.keys(parts) as (keyof typeof parts)[];
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        /* Reset is a word of the head's text (it stands in its line), so it lies inside the text's box by design. */
        if ((a === 'text' && b === 'reset')) continue;
        const x = parts[a], y = parts[b];
        const apart = x.right <= y.left + 0.5 || y.right <= x.left + 0.5 || x.bottom <= y.top + 0.5 || y.bottom <= x.top + 0.5;
        expect(apart, `${a} (${JSON.stringify(x)}) and ${b} (${JSON.stringify(y)}) do not overlap`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------------------------------ 11. a glittered opening post ---- */

test('11. under a glittered opening post the box is painted over the glitter, and a pointer in the box picks none of it up', async ({ page }) => {
  /* Poison: `.kb-origin` loses its `data-kb-over-ink` mark (engine/ui/spin/Origin.tsx, as case 8): the glitter is then painted over the box, and a pointer on the box's words picks it up. */
  const opening = page.locator('article:has(.kb-origin)').first();
  const host = opening.locator('[data-kb-glitter]').first();
  await open(page, 'glitter-over', { frozen: true, ready: async () => {
    await expect(host, "the opening post's glitter, a play on the character who spun the thread").toBeAttached({ timeout: 15_000 });
    await expect(opening.locator('canvas.dw-glitter-under').first()).toBeAttached({ timeout: 15_000 });
  } });
  /* The glitter is there: its canvases fill the opening post's body, and the box (a plain post by another character) has none of its own. */
  await fills(opening.locator('canvas.dw-glitter-under'), opening.locator('.kb-act-main').first(), 'the opening post\'s glitter');
  await expect(box(page).locator('[data-kb-glitter], canvas.dw-glitter-under'), 'the box\'s plain post has no glitter of its own').toHaveCount(0);
  /* Painted over by the box: at each of its five points the box is painted over the opening post's canvases, glitter's over canvas among them (z-index 1, over the words); and the same read at the
     opening post's own words finds that canvas over them (the control: a read that never met the canvas would pass). */
  for (const [name, p] of Object.entries(await boxPoints(page)).flatMap(([k, v]) => (v === null ? [] : [[k, v] as const]))) {
    const order = await stacking(page, p.x, p.y);
    expect(order.canvas, `${name}: the opening post's glitter has a canvas at the point`).toBeGreaterThanOrEqual(0);
    expect(order.inBox, `${name}: the box is painted over the glitter's canvases (box at ${order.inBox}, canvas at ${order.canvas}: ${order.top})`).toBeLessThan(order.canvas);
  }
  const own = await borderBox(host);
  const ownAt = await stacking(page, (own.left + own.right) / 2, (own.top + own.bottom) / 2, '[data-kb-glitter]');
  expect(ownAt.canvas, `the control: the glitter's canvases are over the opening post's own words (canvas at ${ownAt.canvas}, words at ${ownAt.of}: ${ownAt.top})`).toBeGreaterThanOrEqual(0);
  expect(ownAt.canvas, `the control: a canvas is painted over the opening post's own words (canvas at ${ownAt.canvas}, words at ${ownAt.of})`).toBeLessThan(ownAt.of);
  /* Cling (e2e/glitter.spec.ts): a mouse passing over a glittered post picks glitter up, and the page-fixed layer `canvas[data-kb-shine="cling"]` is made by the first pickup. A pointer moved
     back and forth across the box's words picks none up; the same over the opening post's own words does. */
  const cling = page.locator('canvas[data-kb-shine="cling"]');
  const carried = () => page.evaluate(() => window.__kbOriginShine!.carried());
  const sweep = async (r: Rect, passes = 3) => {
    const y = (r.top + r.bottom) / 2;
    for (let i = 0; i < passes; i++) {
      await page.mouse.move(r.left + 10, y);
      await page.mouse.move(r.right - 10, y, { steps: 30 });
      await run(page, 50);
    }
  };
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches), 'a fine pointer, and motion on: reduced motion turns cling off by design').toBe(true);
  const inBox = await borderBox(area(page).locator(':scope > [data-kb-words-box] > .kb-bb'));
  await sweep(inBox);
  await expect(cling, 'a pointer across the box\'s words picks no glitter up').toHaveCount(0);
  /* The first pickup over the opening post's own words makes the layer. It is made in short stretches, until a few flakes are carried: a sweep across the words fills the layer to its cap (26),
     and a pickup that is refused cannot then be told from one with no room left. A pickup takes a real flake off the post, the nearest within REACH_PICK of the pointer
     (docs/plans/2026-11-21-glitter-hands-plan.md), so a stretch swept once is bare: each stretch is on fresh ground, along the words a row at a time. */
  const cols = Math.max(1, Math.floor((own.right - own.left - 20) / 70));
  const rows = [0.3, 0.5, 0.7].map((k) => own.top + (own.bottom - own.top) * k);
  for (let i = 0; i < 40 && (await carried()) < 3; i++) {
    const x = own.left + 10 + (i % cols) * 70, y = rows[Math.floor(i / cols) % rows.length]!;
    await page.mouse.move(x, y);
    await page.mouse.move(x + 60, y, { steps: 3 });
  }
  await expect(cling, 'the same over the opening post\'s own words picks glitter up').toHaveCount(1);
  const held = await carried();
  expect(held, 'a few flakes are carried, with room for more').toBeGreaterThanOrEqual(3);
  expect(held, 'a few flakes are carried, with room for more').toBeLessThan(20);
  /* The layer is live now, and hears the whole page and not the host: each move it hears is asked of the host's `refuses`, as the first was. Across the box's words, for long enough that a pickup not
     refused would fill the layer (a move picks up with a chance of up to 0.6, and some thirty moves a pass go over a thousand px), nothing more is carried. */
  await sweep(inBox, 8);
  expect(await carried(), `a pointer across the box's words, with the layer live, picks nothing more up (${held} carried before)`).toBeLessThanOrEqual(held);
  await expect(cling, 'the layer is still there').toHaveCount(1);
  /* And moves over the opening post's own words can: the refusal is of the box, not of the layer. */
  await sweep(own, 3);
  expect(await carried(), 'further moves over the opening post\'s own words pick more up').toBeGreaterThan(held);
});

/* ------------------------------------------------------------------------------------------ 12 to 14. the cost ---- */

/** Waits for a number of animation frames in the page. */
const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((count) => new Promise<void>((done) => { let left = count; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);

/** Every Feelin' Fab's loop draws and boxes on each of `n` animation frames, in the shape e2e/shine-share.ts reads (a sample a frame, a host a column), and which hosts are the box's and the share each is registered at. */
const sampleFrames = (page: Page, n: number) => page.evaluate((count) => new Promise<{ samples: Sample[]; inBox: boolean[]; shares: number[] }>((done) => {
  const kb = window.__kbOriginShine!, out: Sample[] = [];
  const tick = (t: number) => {
    const hs = kb.hosts();
    out.push({ t, draws: hs.map((h) => h.draws), top: hs.map((h) => h.top), bottom: hs.map((h) => h.bottom), height: window.innerHeight, painted: hs.map((h) => ({ top: h.top, bottom: h.bottom, width: h.width })), own: hs.map((h) => h.own) });
    if (out.length > count) done({ samples: out, inBox: hs.map((h) => h.inBox), shares: hs.map((h) => h.share) }); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), n);
/** The samples of one host only. */
const only = (samples: readonly Sample[], h: number): Sample[] => samples.map((s) => ({ ...s, draws: [s.draws[h]!], top: [s.top[h]!], bottom: [s.bottom[h]!], painted: [s.painted![h]!], own: [s.own![h]!] }));
/** The draws every Feelin' Fab on the page makes over the next `n` animation frames, summed. */
const drawsOver = (page: Page, n: number): Promise<number> => page.evaluate((count) => new Promise<number>((done) => {
  const kb = window.__kbOriginShine!, total = () => kb.hosts().reduce((a, h) => a + h.draws, 0), from = total();
  let left = count;
  const tick = () => (--left <= 0 ? done(total() - from) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);
/** The light eases to the pointer and settles; only then is a draw the idle cadence's (e2e/shine.spec.ts, "at rest"). It has settled when two windows of 20 frames, one after the other, draw the same count. */
async function atRest(page: Page) {
  await page.mouse.move(5, 5);
  let before = -1;
  await expect.poll(async () => { const now = await drawsOver(page, 20); const same = now === before; before = now; return same; }, { message: 'the light has settled: two windows of 20 frames draw the same count', timeout: 20_000 }).toBe(true);
}
const AT_REST_FRAMES = 240;
const wordsArea = (s: Sample, h: number) => Math.round(s.own![h]!.width * (s.own![h]!.bottom - s.own![h]!.top));
const paintedArea = (s: Sample, h: number) => Math.round(s.painted![h]!.width * (s.painted![h]!.bottom - s.painted![h]!.top));
/** The share of the loop's rate a host is registered at, as engine/ui/cards/body.ts `paintShare` gives it: its words' box over its painted box, between `BODY_FLOOR` (its `LEAST_SHARE`) and 1. */
const shareOf = (s: Sample, h: number) => Math.min(1, Math.max(BODY_FLOOR, wordsArea(s, h) / paintedArea(s, h)));

test('12. at rest the box\'s foil is redrawn within what its words and its area allow, by the bound e2e/shine.spec.ts holds a post to', async ({ page }) => {
  /* Poison: `share` forced to 1 in Feelin' Fab's `register` call (instances/divided-world/ui/feelin-fab/Effect.tsx): the area is then redrawn at the words' rate, over what it is allowed. */
  await open(page, 'fab');
  await expect.poll(() => page.evaluate(() => window.__kbOriginShine!.hosts().length)).toBe(1);
  await atRest(page);
  const { samples, inBox, shares } = await sampleFrames(page, AT_REST_FRAMES);
  expect(inBox, 'the one foil on the page is the box\'s').toEqual([true]);
  const r = redrawn(samples, 1440), last = samples.at(-1)!;
  expect(Math.abs(shares[0]! - shareOf(last, 0)), `the box's foil is registered at the share its words and its area give (${shares[0]} against ${shareOf(last, 0).toFixed(3)})`).toBeLessThanOrEqual(0.02);
  console.log(`origin box at rest: ${(r.changed / r.allowed).toFixed(2)} of what it is allowed (bound ${REDRAWN_SHARE}); words ${wordsArea(last, 0)} px squared, area ${paintedArea(last, 0)}, draws ${last.draws[0]! - samples[0]!.draws[0]!} in ${AT_REST_FRAMES} frames`);
  expect(r.changed, 'the box\'s foil is drawn at rest, or the bound below proves nothing').toBeGreaterThan(0);
  expect(r.changed / r.allowed, 'the screen area the box\'s draws change at rest, over the larger of its words\' box and a quarter of its area').toBeLessThan(REDRAWN_SHARE);
});

test('13. scrolled out of view, nothing is drawn for the box and its canvas holds no backing store; back in view, it is drawn again', async ({ page }) => {
  /* Poison: `hidden: leave` dropped from Feelin' Fab's `register` call: the canvas keeps its backing store out of view. */
  await open(page, 'fab');
  await expect.poll(() => page.evaluate(() => window.__kbOriginShine!.hosts()[0]?.draws ?? 0)).toBeGreaterThan(0);
  const size = () => page.evaluate(() => window.__kbOriginFab!.size(0));
  const draws = () => page.evaluate(() => window.__kbOriginShine!.hosts()[0]!.draws);
  const shown = await size();
  expect(shown, 'in view, the foil has a canvas').not.toBeNull();
  expect(shown!.w * shown!.h, `in view, the foil's backing store is not empty (${shown!.w} by ${shown!.h})`).toBeGreaterThan(0);
  /* A tall page, as e2e/shine.spec.ts makes one: room below, and the box scrolled away from the viewport. */
  await page.evaluate(() => { const s = document.createElement('div'); s.style.height = '4000px'; document.body.append(s); window.scrollTo(0, document.documentElement.scrollHeight); });
  expect(await page.evaluate(() => document.querySelector('.kb-origin')!.getBoundingClientRect().bottom < 0), 'the box is scrolled fully out of view').toBe(true);
  /* The backing store is freed on the in-view observer's word and the worker's message after it, neither on a frame count: polled until it is 0. */
  await expect.poll(async () => { const z = await size(); return z === null ? 'no canvas' : z.w * z.h; }, { message: "out of view the foil's canvas holds no backing store", timeout: 10_000 }).toBe(0);
  await frames(page, 4);
  const gone = await size();
  expect(gone, 'out of view the foil still has a canvas').not.toBeNull();
  expect(gone!.w * gone!.h, `out of view the foil's canvas still holds no backing store (${gone!.w} by ${gone!.h})`).toBe(0);
  const at = await draws();
  await frames(page, 20);
  expect(await draws(), 'nothing is drawn for the box out of view').toBe(at);
  expect(await page.evaluate(() => window.__kbOriginShine!.running()), 'the loop has nothing in view and has stopped').toBe(false);
  /* Back in view it is sized and drawn again. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(draws, { message: 'back in view the box is drawn again' }).toBeGreaterThan(at);
  await expect.poll(async () => { const z = await size(); return z === null ? 0 : z.w * z.h; }, { message: 'back in view the foil has a backing store again' }).toBeGreaterThan(0);
});

test("13b. in a moment's box, scrolled out of view, the Whoops! ink holds no pictures; back in view, they are built again", async ({ page }) => {
  /* Poison: the picture bands of a moment's Whoops! kept built out of view (the effect's near-band reading left out of its moment form). */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'whoops-landed');
  await built(page, '.kb-origin .kb-whoops');
  const pictures = () => page.evaluate(() => { const el = document.querySelector('.kb-origin .kb-whoops'); return { bands: (el?.getAttribute('data-kb-bands') ?? '').split(' ').filter(Boolean).length, pictures: Number(el?.getAttribute('data-kb-pictures') ?? '0') }; });
  expect((await pictures()).pictures, 'in view, the ink has its pictures').toBeGreaterThan(0);
  await page.evaluate(() => { const s = document.createElement('div'); s.style.height = '4000px'; document.body.append(s); window.scrollTo(0, document.documentElement.scrollHeight); });
  expect(await page.evaluate(() => document.querySelector('.kb-origin')!.getBoundingClientRect().bottom < 0), 'the box is scrolled fully out of view').toBe(true);
  await expect.poll(pictures, { message: 'out of view the ink holds no pictures', timeout: 10_000 }).toEqual({ bands: 0, pictures: 0 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await pictures()).pictures, { message: 'back in view the ink is built again', timeout: 10_000 }).toBeGreaterThan(0);
});

test('14. with the opening post\'s foil and the box\'s both on the page, two hosts are registered and each is held to its own allowance', async ({ page }) => {
  /* Poison: `share` forced to 1 in Feelin' Fab's `register` call for the box's host (`el.closest('.kb-origin') ? 1 : share`), which the box's registered share fails; for the opening post's host alone (`el.closest('.kb-origin') ? share : 1`), the opening post's bound fails as well. */
  /* Two foils are brought to rest and sampled over hundreds of frames: on a loaded machine that passed the 30 s a test is given, once, in a run of the whole suite. */
  test.slow();
  await open(page, 'fab-bright');
  await expect.poll(() => page.evaluate(() => window.__kbOriginShine!.hosts().length), { message: 'two Feelin\' Fabs are registered with the loop' }).toBe(2);
  await atRest(page);
  const { samples, inBox, shares } = await sampleFrames(page, AT_REST_FRAMES);
  expect(inBox.filter(Boolean).length, 'one of the two is the box\'s').toBe(1);
  expect(inBox.filter((b) => !b).length, 'and one is the opening post\'s').toBe(1);
  const last = samples.at(-1)!, over: string[] = [];
  for (const [h, mine] of inBox.entries()) {
    const name = mine ? 'the box\'s foil' : 'the opening post\'s foil';
    const r = redrawn(only(samples, h), 1440);
    console.log(`${name} at rest: ${(r.changed / r.allowed).toFixed(2)} of what it is allowed (bound ${REDRAWN_SHARE}); words ${wordsArea(last, h)} px squared, painted ${paintedArea(last, h)}, draws ${last.draws[h]! - samples[0]!.draws[h]!} in ${AT_REST_FRAMES} frames`);
    expect.soft(r.changed, `${name} is drawn at rest, or its bound proves nothing`).toBeGreaterThan(0);
    /* The registered share is read as it is, not through the cost it makes: a box share of 1 costs under the bound here (1.22 of 1.25), so only the share itself fails on it. */
    const want = shareOf(last, h);
    if (Math.abs(shares[h]! - want) > 0.02) over.push(`${name}: registered at share ${shares[h]!.toFixed(3)}, where its words (${wordsArea(last, h)} px squared) over its area (${paintedArea(last, h)}) give ${want.toFixed(3)}`);
    if (!(r.changed / r.allowed < REDRAWN_SHARE)) over.push(`${name}: ${(r.changed / r.allowed).toFixed(2)} of what it is allowed, over the bound ${REDRAWN_SHARE}`);
  }
  expect(over, 'each host\'s redrawn area, over what that host is allowed, is within the bound').toEqual([]);
});


/* ------------------------------------------------------------------------------------------ 15 to 19. Steel Chair on a `!` ---- */

/** Opens a Steel Chair story whose chair is drawn and asleep, at a size, with the first of CHAIR_SEEDS (a moment's run has its own seed, the plays'). */
async function openChairAt(page: Page, name: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await openChair(page, name, CHAIR_SEEDS[0]!);
}

/** A clip of the page as RGBA pixels (the screenshot is decoded in the page, which has a canvas). */
async function pixelsOf(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number[]> {
  const png = (await page.screenshot({ clip, animations: 'allow' })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  }, png);
}

/** Each dent's box in the box's area, in the viewport. */
const dentBoxes = (page: Page): Promise<{ left: number; top: number; right: number; bottom: number; width: number; height: number }[]> => area(page).evaluate((a) =>
  [...a.querySelectorAll<HTMLElement>('.dw-chair-dents .dw-chair-dent')].map((d) => { const r = d.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }));

for (const [name, size] of [['chair-landed', { width: 1440, height: 1120 }], ['chair-landed-phone', { width: 390, height: 844 }]] as const) {
  test(`15. the shading draws no block: the four corners of each dent's box are the same with the shading shown and hidden (${name})`, async ({ page }) => {
    /* Poison: the shade image made opaque again (alpha 255, the gray kept) in dent.ts: its corners, where the dent is flat, are then the shade's gray block. */
    await openChairAt(page, name, size);
    const dents = await dentBoxes(page);
    expect(dents.length, 'the story has a dent').toBeGreaterThan(0);
    await area(page).evaluate((a) => { for (const el of a.querySelectorAll<HTMLElement>('.dw-chair-layer')) el.style.visibility = 'hidden'; });
    const SQ = 4;
    for (const [i, d] of dents.entries()) {
      const corners = [[d.left, d.top], [d.right - SQ, d.top], [d.left, d.bottom - SQ], [d.right - SQ, d.bottom - SQ]] as const;
      for (const [k, [x, y]] of corners.entries()) {
        const clip = { x: Math.ceil(x), y: Math.ceil(y), width: SQ, height: SQ };
        const shown = await pixelsOf(page, clip);
        await area(page).evaluate((a) => { for (const el of a.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = 'hidden'; });
        const hidden = await pixelsOf(page, clip);
        await area(page).evaluate((a) => { for (const el of a.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = ''; });
        const worst = Math.max(...shown.map((v, j) => Math.abs(v - hidden[j]!)));
        expect(worst, `dent ${i}, corner ${k} (${JSON.stringify(clip)}): the shading changes a pixel there by ${worst} levels of 255`).toBeLessThanOrEqual(2);
      }
      const whole = { x: Math.ceil(d.left), y: Math.ceil(d.top), width: Math.floor(d.width) - 1, height: Math.floor(d.height) - 1 };
      const drawn = await pixelsOf(page, whole);
      await area(page).evaluate((a) => { for (const el of a.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = 'hidden'; });
      const bare = await pixelsOf(page, whole);
      await area(page).evaluate((a) => { for (const el of a.querySelectorAll<HTMLElement>('.dw-chair-dents, .dw-chair-glows')) el.style.visibility = ''; });
      let most = 0;
      for (let j = 0; j < drawn.length; j++) most = Math.max(most, Math.abs(drawn[j]! - bare[j]!));
      expect(most, `dent ${i}: the dent is drawn: inside its box some pixel differs with the shading shown and hidden by more than 2 levels (the most is ${most})`).toBeGreaterThan(2);
    }
  });
}

/** The seeds a live short post is thrown with in case 16. Seed 10 is one of the sixteen tried whose dent lands low enough that a zone taller than the area (the poison) puts it out of the area: a seed is a fixture, and the others are two of case 7's. */
const ZONE_SEEDS = [10, 101, 113];
for (const [name, size, seed] of [['chair-landed', { width: 1440, height: 1120 }, CHAIR_SEEDS[0]!], ['chair-landed-phone', { width: 390, height: 844 }, CHAIR_SEEDS[0]!], ...ZONE_SEEDS.map((n) => ['chair-short', { width: 1440, height: 1120 }, n] as const)] as const) {
  test(`16. every dent is inside the area, and none lies over the band's words (${name}, seed ${seed})`, async ({ page }) => {
    /* Poison: `zoneHeight` returning the area's height plus 40 (dent.ts): the dents are aimed in a zone taller than the area. */
    await page.setViewportSize(size);
    await openChair(page, name, seed);
    const a = await padBox(area(page));
    const bandBottom = (await borderBox(band(page))).bottom;
    const dents = await dentBoxes(page);
    expect(dents.length, 'the story has a dent').toBeGreaterThan(0);
    for (const [i, d] of dents.entries()) {
      const where = `dent ${i} ${JSON.stringify(d)} in the area ${JSON.stringify(a)}`;
      expect(d.left, where).toBeGreaterThanOrEqual(a.left - 1);
      expect(d.right, where).toBeLessThanOrEqual(a.right + 1);
      expect(d.top, where).toBeGreaterThanOrEqual(a.top - 1);
      expect(d.bottom, where).toBeLessThanOrEqual(a.bottom + 1);
      expect(d.top, `${where}: at or below the band's bottom (${bandBottom})`).toBeGreaterThanOrEqual(bandBottom - 1);
    }
  });
}

for (const [name, size] of [['chair-landed', { width: 1440, height: 1120 }], ['chair-landed-phone', { width: 390, height: 844 }]] as const) {
  test(`17. the box grew: its content is at least 237 px tall and the dent's larger axis is over 100 px (${name})`, async ({ page }) => {
    /* Poison: the `[data-dw-chair-room]` rule's `min-height` deleted (steel-chair.css): the area is as tall as a `!` and its byline. */
    await openChairAt(page, name, size);
    const content = await area(page).evaluate((a) => { const c = getComputedStyle(a); return a.clientHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom); });
    expect(content, `the area's content height (237 is the full dent, 160, and the room, ${ROOM_HEIGHT})`).toBeGreaterThanOrEqual(160 + ROOM_HEIGHT - 0.5);
    const larger = Math.max(...(await dentBoxes(page)).map((d) => Math.max(d.width, d.height)));
    expect(larger, "the dent's larger axis").toBeGreaterThan(100);
  });
}

test('18. after the box changes from 1440 to 390 wide, the layers fill the area again and the chair is on the floor', async ({ page }) => {
  /* Poison: the still run's size observer not bound (Effect.tsx): a moment's layers keep the places they were drawn at, 1440 wide. */
  await openChairAt(page, 'chair-landed', { width: 1440, height: 1120 });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [layer, what] of [['.dw-chair-dents', "the dents' layer"], ['.dw-chair-glows', "the lights' layer"], ['.dw-chair-layer', "the chairs' layer"]] as const) {
    await fills(box(page).locator(layer), area(page), what);
  }
  await expect.poll(async () => {
    const m = await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('.kb-origin-area')!;
      const r = b.getBoundingClientRect(), bottom = r.top + b.clientTop + b.clientHeight;
      const rects = [...b.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect());
      return { bottom, top: Math.min(...rects.map((x) => x.top)), low: Math.max(...rects.map((x) => x.bottom)), left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)), areaLeft: r.left + b.clientLeft, areaRight: r.left + b.clientLeft + b.clientWidth };
    });
    const off: string[] = [];
    if (m.bottom - m.top > ROOM_HEIGHT + 1) off.push(`the chair's top is ${(m.bottom - m.top).toFixed(1)} above the area's bottom, over the room's ${ROOM_HEIGHT}`);
    if (m.low > m.bottom + 0.5) off.push(`the chair's bottom ${m.low.toFixed(1)} is below the area's ${m.bottom.toFixed(1)}`);
    if (m.left < m.areaLeft - 0.5 || m.right > m.areaRight + 0.5) off.push(`the chair ${m.left.toFixed(1)} to ${m.right.toFixed(1)} is outside the area ${m.areaLeft.toFixed(1)} to ${m.areaRight.toFixed(1)}`);
    return off.length === 0 ? 'on the floor' : off.join('; ');
  }, { message: "the chair is on the area's floor, inside its walls, after the box changed", timeout: 10_000 }).toBe('on the floor');
});

for (const name of ['chair-landed', 'chair-landed-phone'] as const) {
  test(`19. axe finds nothing on ${name}`, async ({ page }) => {
    await openChairAt(page, name, name === 'chair-landed' ? { width: 1440, height: 1120 } : { width: 390, height: 844 });
    expect(await pageViolations(page)).toEqual([]);
  });
}

/* ------------------------------------------------------------------------------------------ 20. the objects ---- */

/**
 * Case 20 to 22 are Task 12 of docs/plans/2026-11-23-steel-chair-objects-design.md: a fire extinguisher's puff (Puff.tsx) fills the ORIGIN box's area, border to border,
 * and is gone in `billowMs + holdMs + fadeMs` and 500 ms (20); a can's lid leaves the area and is seen outside it (21, the walk of e2e/steel-chair.spec.ts's lid
 * tests, here on the stories `Can` and `Extinguisher`); and a chair, a can and an extinguisher on the box's post make the room of the tallest (22). The seed is
 * a single pinned value, as `openChair`'s. Poisons (`KB_POISON` in the environment): `nopuff` (20: a drawImage onto a puff tile is dropped, so its canvases stay
 * empty), `lidclip` (21: the area gets `overflow: hidden`), `room` (22: the room is the chair's again).
 */
const POISON = process.env.KB_POISON ?? '';
const PUFF_MS = 600 + 400 + 4000;
const OBJECT_SEED = 104;

async function openObject(page: Page, name: string, seed = OBJECT_SEED) {
  await page.addInitScript((given: number) => {
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((a: ArrayBufferView) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = given; return a; }
      return real(a as Uint8Array);
    }) as typeof crypto.getRandomValues;
  }, seed);
  await page.goto(STORY(name));
  await expect(box(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
}

/** The puff's tiles in the box: how many, their union, the area's padding box, and the alpha of the tile pixel at the area's middle. */
const puffIn = (page: Page) => page.evaluate(() => {
  const a = document.querySelector<HTMLElement>('.kb-origin-area:has(.dw-chair)')!;
  const r = a.getBoundingClientRect();
  const inner = { left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight };
  const tiles = [...document.querySelectorAll<HTMLCanvasElement>('canvas.dw-chair-puff')].filter((c) => c.width > 0 && c.getBoundingClientRect().width > 0);
  const inArea = tiles.filter((c) => a.contains(c));
  const rects = inArea.map((c) => c.getBoundingClientRect());
  let seen = 0;
  const mx = (inner.left + inner.right) / 2, my = (inner.top + inner.bottom) / 2;
  const c = inArea.find((q) => { const b = q.getBoundingClientRect(); return mx >= b.left && mx < b.right && my >= b.top && my < b.bottom; });
  if (c) {
    const b = c.getBoundingClientRect(), k = c.width / b.width;
    const x = Math.round((mx - b.left) * k), y = Math.round((my - b.top) * k);
    seen = c.getContext('2d')!.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data[3]!;
  }
  return {
    all: tiles.length, tiles: inArea.length, area: inner, seen,
    union: rects.length ? { left: Math.min(...rects.map((b) => b.left)), top: Math.min(...rects.map((b) => b.top)), right: Math.max(...rects.map((b) => b.right)), bottom: Math.max(...rects.map((b) => b.bottom)) } : null,
  };
});

test('20. the extinguisher\'s puff is drawn in the box\'s area, border to border, and is gone within its fade and 500 ms', async ({ page }) => {
  test.setTimeout(45_000);
  if (POISON === 'nopuff') await page.addInitScript(() => { const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...a: Parameters<typeof draw>) { if (!this.canvas.classList.contains('dw-chair-puff')) draw.apply(this, a); } as typeof draw; });
  await openObject(page, 'extinguisher');
  let filled: Awaited<ReturnType<typeof puffIn>> | null = null;
  const began = Date.now();
  while (Date.now() - began < 20_000) {
    const p = await puffIn(page);
    const u = p.union;
    if (u && p.seen > 100 && u.left <= p.area.left + 1 && u.right >= p.area.right - 1 && u.top <= p.area.top + 1 && u.bottom >= p.area.bottom - 1) { filled = p; break; }
    await page.waitForTimeout(25);
  }
  expect(filled, 'the puff is drawn in the box\'s area and its tiles fill it border to border').not.toBeNull();
  /* Every tile of the puff on the page is in the box's area: none is in the opening post's body. */
  expect((await puffIn(page)).all, 'no puff tile outside the box\'s area').toBe((await puffIn(page)).tiles);
  await expect.poll(async () => (await puffIn(page)).all, { timeout: PUFF_MS + 500, intervals: [100], message: 'gone within billow, hold and fade, and 500 ms' }).toBe(0);
});

test('21. the can\'s lid leaves the box\'s area and is seen outside it', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript((given: number) => {
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((a: ArrayBufferView) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = given; return a; }
      return real(a as Uint8Array);
    }) as typeof crypto.getRandomValues;
  }, 101);
  await page.goto(STORY('can'));
  if (POISON === 'lidclip') await page.addStyleTag({ content: '.kb-origin-area { overflow: hidden; }' });
  await expect(page.locator('.dw-chair').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await area(page).scrollIntoViewIfNeeded();
  const seen = await page.evaluate(() => new Promise<{ lids: number; outside: number; seen: number; gone: boolean }>((resolve) => {
    const a = document.querySelector<HTMLElement>('.kb-origin-area:has(.dw-chair)')!;
    const out = { lids: 0, outside: 0, seen: 0, gone: false };
    const started = performance.now();
    const clips = (el: Element): boolean => { const s = getComputedStyle(el); return s.overflowX !== 'visible' || s.overflowY !== 'visible' || /paint|strict|content/.test(s.contain) || s.clipPath !== 'none'; };
    const tick = (): void => {
      const lid = a.querySelector<HTMLElement>('.dw-chair-lid');
      if (lid) {
        out.lids++;
        const rects = [...lid.querySelectorAll('.dw-chair-piece')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        if (rects.length) {
          const lb = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
          const r = a.getBoundingClientRect();
          const ab = { left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight };
          if (lb.right <= ab.left || lb.left >= ab.right || lb.bottom <= ab.top || lb.top >= ab.bottom) {
            out.outside++;
            /* Seen: what is left of its box after every clipping ancestor's padding box still has area. */
            let kept = { ...lb };
            for (let el = lid.parentElement; el && el !== document.documentElement; el = el.parentElement) {
              if (!clips(el)) continue;
              const q = el.getBoundingClientRect();
              kept = { left: Math.max(kept.left, q.left + el.clientLeft), top: Math.max(kept.top, q.top + el.clientTop), right: Math.min(kept.right, q.left + el.clientLeft + el.clientWidth), bottom: Math.min(kept.bottom, q.top + el.clientTop + el.clientHeight) };
            }
            if (kept.right - kept.left > 1 && kept.bottom - kept.top > 1) out.seen++;
          }
        }
      } else if (out.lids > 0) { out.gone = true; resolve(out); return; }
      if (performance.now() - started > 20_000) { resolve(out); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log(`origin can: ${seen.lids} frames with a lid, ${seen.outside} wholly outside the area, ${seen.seen} of them seen`);
  expect(seen.lids, 'a lid was drawn').toBeGreaterThan(0);
  expect(seen.outside, 'the lid was wholly outside the box\'s area at some frame').toBeGreaterThan(0);
  expect(seen.seen, 'and seen there, cut away by no ancestor').toBeGreaterThan(0);
  expect(seen.gone, 'and gone when its arc is done').toBe(true);
});

test('22. a chair, a can and an extinguisher on the box\'s post: the area\'s room is the tallest\'s', async ({ page }) => {
  await openObject(page, 'mixed-three', 101);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.kb-origin-area .dw-chair-group').length), { timeout: 20_000, message: 'the three objects are drawn' }).toBe(3);
  if (POISON === 'room') await page.addStyleTag({ content: '[data-dw-chair-room]::after { height: 77px !important; }' });
  const room = await page.evaluate(() => {
    const a = document.querySelector<HTMLElement>('.kb-origin-area:has(.dw-chair)')!;
    return { marked: a.hasAttribute('data-dw-chair-room'), height: parseFloat(getComputedStyle(a, '::after').height), groups: a.querySelectorAll('.dw-chair-group').length };
  });
  expect(room.marked, 'the box\'s area carries the room').toBe(true);
  expect(room.groups, 'three objects are drawn').toBe(3);
  expect(room.height, 'the room is roomHeightOf(chair, can, extinguisher)').toBeCloseTo(roomHeightOf(['chair', 'can', 'extinguisher']), 0);
});
