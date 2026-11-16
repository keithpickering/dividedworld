import { expect, test, type Locator, type Page } from '@playwright/test';
import { fogAlpha } from '../instances/divided-world/ui/hot-box/smoke.ts';
import { ROOM_HEIGHT } from '../instances/divided-world/ui/steel-chair/chair.ts';
import { settled } from './settled.ts';

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
 * Case 10 of the plan (a box with nothing under its band draws no area) is not here: no story's box is the band alone (the plan's own condition), so
 * engine/ui/spin/Spin.test.tsx's case 4 holds it.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 1120 } });

const STORY = (name: string) => `/?fixture=boards&story=boards-26-origin-effects--${name}`;
const box = (page: Page) => page.getByRole('group', { name: 'Origin', exact: true });
const area = (page: Page) => box(page).locator('.kb-origin-area');
const band = (page: Page) => box(page).locator('.kb-origin-head');
/** The byline, the first line of the area. */
const byline = (page: Page) => area(page).locator(':scope > p.kb-small.kb-muted').first();
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

test('1. the area is the box under its band, out to the box\'s other three borders', async ({ page }) => {
  /* Poison: give `.kb-origin` back its 0.4em bottom padding (the area's bottom edge then stands 0.4em above the frame's inner edge). */
  await open(page, 'whoops');
  const a = await padBox(area(page));
  const bandBottom = (await borderBox(band(page))).bottom;
  const inner = await padBox(box(page));
  expect(Math.abs(a.top - bandBottom), `the area's top against the band's bottom edge (${a.top} against ${bandBottom})`).toBeLessThanOrEqual(0.5);
  for (const k of ['left', 'right', 'bottom'] as const) expect(Math.abs(a[k] - inner[k]), `the area's ${k} against the box's border box less its 1px border (${a[k]} against ${inner[k]})`).toBeLessThanOrEqual(0.5);
});

/* ------------------------------------------------------------------------------------------ 2. Whoops! ---- */

for (const [name, size] of [['whoops', { width: 1440, height: 1120 }], ['whoops-phone', { width: 390, height: 844 }]] as const) {
  test(`2. Whoops! fills the box's area, and its ink is solid in the byline and in the area's bottom-left corner (${name})`, async ({ page }) => {
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
    const atByline = await inkAt((line.left + line.right) / 2, (line.top + line.bottom) / 2);
    expect(atByline, 'the ink at a point in the byline').not.toBeNull();
    expect(atByline!, 'the ink is solid in the byline').toBeGreaterThan(40);
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
  /* Under the words: the canvas is below them in z-order and a hit test at a word is not the canvas. */
  const z = await box(page).evaluate((b) => {
    const cv = b.querySelector<HTMLElement>('canvas.dw-fab-foil')!, w = b.querySelector<HTMLElement>('.dw-fab-words')!;
    const r = w.getBoundingClientRect();
    const over = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(8, r.height / 2));
    return { canvas: Number(getComputedStyle(cv).zIndex), words: Number(getComputedStyle(w).zIndex), over: over === cv };
  });
  expect(z.canvas, 'the foil is under the words (z-index)').toBeLessThan(z.words);
  expect(z.over, 'a hit test at a word is the canvas').toBe(false);
});

/* ------------------------------------------------------------------------------------------ 5. bright ink ---- */

test('5. under Brighter effects the box\'s words, byline and quote wear the bright ink; History keeps the board\'s, and the band is the column head\'s', async ({ page }) => {
  /* Poison: the quote's border put back as two selector rules in thread.css (the reset's then outweighs the bright one, or the other way round, whichever area is nearer). */
  await open(page, 'fab-bright');
  const bright = await token(page, '--kb-bright-ink');
  expect(bright, 'the bright ink and the board\'s ink differ, or this proves nothing').not.toBe(await token(page, '--kb-board-fg'));
  await expect(area(page)).toHaveAttribute('data-kb-bright-ink', '');
  const color = (el: Locator, prop: 'color' | 'borderTopColor' | 'textShadow') => el.evaluate((e, p) => getComputedStyle(e)[p as 'color'], prop);
  expect(await color(box(page).locator('.dw-fab-words'), 'color'), 'the words\' color').toBe(bright);
  expect(await color(byline(page), 'color'), 'the byline\'s color').toBe(bright);
  expect(await color(box(page).locator('.kb-quote'), 'borderTopColor'), 'the quote\'s border color').toBe(bright);
  expect(await color(history(page), 'color'), 'the History button\'s color is the board\'s').toBe(await token(page, '--kb-button-fg'));
  expect(await color(history(page), 'textShadow'), 'the History button wears no bright outline').not.toContain(await token(page, '--kb-bright-outline'));
  const head = await page.locator('.kb-acts-head > span').first().evaluate((e) => getComputedStyle(e).color);
  expect(await color(band(page), 'color'), 'the band\'s color is the thread\'s column head\'s').toBe(head);
});

/* ------------------------------------------------------------------------------------------ 6. Hot Box ---- */

test('6. Hot Box fills the area, History stands over it, and a clearing opens on the byline and not on History', async ({ page }) => {
  /* Poison: the History `<p>` loses its `data-kb-over-ink` mark (the smoke is then over the button, and a pointer on it opens a clearing). */
  await open(page, 'hot-box', { frozen: true });
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
  const line = await centerOf(byline(page));
  expect(await fogAt(line.x, line.y), 'the smoke is full strength under the byline').toBeGreaterThanOrEqual(fogged);
  await page.mouse.move(line.x, line.y);
  await run(page, 150);
  /* Soft, so that the panel's checks below are still read when the clearing is not there yet. */
  await expect.soft.poll(() => fogAt(line.x, line.y), { message: 'a pointer over the byline opens a clearing (the canvas\'s alpha there drops)', timeout: 3000 }).toBeLessThanOrEqual(2);
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

for (const name of ['chair', 'chair-short'] as const) {
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
        const walker = document.createTreeWalker(b.querySelector('.dw-chair-words')!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0) lines.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
        }
        const opening = b.closest('.kb-origin')!.closest<HTMLElement>('.kb-act-main')!;
        const openAfter = getComputedStyle(opening, '::after');
        return {
          area: inner, chairs, lines,
          room: { display: after.display, content: after.content, height: parseFloat(after.height) },
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
        const covered = m.lines.filter((l) => l.left < c.right && l.right > c.left && l.top < c.bottom && l.bottom > c.top);
        expect(covered, `no word is under the chair's box ${JSON.stringify(c)}`).toEqual([]);
      }
      expect.soft(m.room.display, 'the area\'s ::after is the room (a block)').toBe('block');
      expect.soft(m.room.height, 'the room is ROOM_HEIGHT tall').toBeCloseTo(ROOM_HEIGHT, 0);
      expect.soft(m.opening.content, `the opening post's .kb-act-main has no ::after of its own (${m.opening.height}px tall)`).toMatch(/^(none|normal)$/u);
    });
  }
}

/* ------------------------------------------------------------------------------------------ 8. the box stands above ---- */

test('8. the box stands above the opening post\'s effects, and its presses are its own', async ({ page }) => {
  /* Poison: `.kb-origin` loses its `data-kb-over-ink` mark (the opening post's ink is then over the box, and its presses start strokes and clearings). */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const opening = page.locator('article:has(.kb-origin)').first();
  await open(page, 'under', { frozen: true, ready: async () => {
    await expect(opening.locator('canvas.kb-whoops-ink').first(), "the opening post's Whoops! ink").toBeAttached({ timeout: 15_000 });
    await expect(opening.locator('canvas.dw-hotbox-smoke').first(), "the opening post's Hot Box smoke").toBeAttached({ timeout: 15_000 });
  } });
  await built(page, 'article:has(.kb-origin) .kb-whoops');
  /* Five points in the box: what answers at each is the box's before any effect's ink. */
  const marks = await centerOf(box(page).locator('.kb-mark'));
  const words = await borderBox(area(page).locator(':scope > .kb-bb'));
  const points = {
    band: await (async () => { const r = await borderBox(band(page).locator('.kb-origin-head-text')); return { x: r.left + 8, y: (r.top + r.bottom) / 2 }; })(),
    mark: marks,
    byline: await centerOf(byline(page)),
    words: { x: words.left + 30, y: words.top + 8 },
    History: await centerOf(history(page)),
  };
  const stack = (x: number, y: number) => page.evaluate(([px, py]) => {
    const b = document.querySelector('.kb-origin')!;
    const all = document.elementsFromPoint(px!, py!);
    const inBox = all.findIndex((e) => b.contains(e));
    const ink = all.findIndex((e) => e.closest('[data-kb-effect-ink]') !== null);
    return { inBox, ink, top: all.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`) };
  }, [x, y] as const);
  for (const [name, p] of Object.entries(points)) {
    const s = await stack(p.x, p.y);
    expect(s.inBox, `${name}: an element of the box answers at its point (${s.top.join(' < ')})`).toBeGreaterThanOrEqual(0);
    expect(s.ink === -1 || s.inBox < s.ink, `${name}: the box's element comes before any effect's ink (box at ${s.inBox}, ink at ${s.ink}: ${s.top.join(' < ')})`).toBe(true);
  }
  /* A scrub across the box's words washes nothing of the opening post's ink; the same scrub over the opening post's own words washes it. */
  const OPENING_INK = 'article:has(.kb-origin) canvas.kb-whoops-ink';
  const before = await inked(page, OPENING_INK);
  expect(before, 'the opening post has ink').toBeGreaterThan(1000);
  const scrub = async (x: number, y: number) => {
    await page.mouse.move(x - 90, y);
    await page.mouse.down();
    for (let pass = 0; pass < 6; pass++) await page.mouse.move(x + (pass % 2 === 0 ? 90 : -90), y, { steps: 12 });
    await page.mouse.up();
    await run(page, 300);
  };
  await scrub(points.words.x + 120, points.words.y);
  await run(page, 300);
  expect(await inked(page, OPENING_INK), 'a scrub across the box\'s words leaves the opening post\'s ink as it was').toBe(before);
  /* The opening post's own words: a stretch of solid ink below the box, in the post's body and not under the box. */
  const spot = await page.evaluate(() => {
    const b = document.querySelector('.kb-origin')!.getBoundingClientRect();
    const body = document.querySelector('.kb-origin')!.closest('.kb-act-main')!.getBoundingClientRect();
    return { x: body.left + body.width / 2, y: b.bottom + 14 };
  });
  await scrub(spot.x, spot.y);
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
  /* The mark's Lens: the play opens, and its Go to post is pressed and navigates. */
  await page.mouse.click(points.mark.x, points.mark.y);
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
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pushed: string[] }).__pushed), { message: 'Go to post navigates to the origin post' }).toContainEqual(expect.stringMatching(/#post-2$/u));
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
});
