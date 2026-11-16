import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SMOKE, fogAlpha, holeRadius } from '../instances/divided-world/ui/hot-box/smoke.ts';
import { settled } from './settled.ts';

/**
 * Hot Box as a browser draws it (docs/plans/2026-11-15-hot-box-plan.md, Task 7, as amended for forced colors; design, section 2.2): the smoke
 * is a canvas over the words, so the words under it are covered and inert; a mouse clears a soft patch where it points and the patch closes
 * again after it leaves (or moves onto the control); a touch opens one that holds, and a swipe still scrolls; Tab reaches "Wave the smoke",
 * and holding Enter to the end clears the post for 20 seconds; the Lens shows the card's state, its way out and the same hold; under reduced
 * motion nothing is drawn after the first paint and the hold still takes its time; and under forced colors, where a canvas's fog cannot be
 * drawn in system colors, the words themselves are masked, a hard circle clears them, a ring marks it and a sign says what the Lens says.
 *
 * The post is #43 of the boards fixture (instances/divided-world/ui/hot-box/HotBox.board.stories.tsx): the one post of the Main board's page
 * with no Whoops! ink over its words. The story route renders no play function, so every test moves the pointer or holds the control itself.
 *
 * Time. The effect reads the page's clock (`api.now()` is `Date.now()` on the boards fixture), and the model's times are seconds long (a clearing
 * rolls shut in 2.5 s, a wave lasts 20 s, a long post's sweep takes minutes), so a timing test installs Playwright's clock, pauses it once the page has
 * settled and moves it with `runFor` (every timer and frame inside the span runs, in order) or `fastForward` (a jump, which the effect's catch-up
 * on a late timer must handle). A paused page runs no animation frame until the clock is moved, so a read that follows a move polls.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 1120 } });

const STORY = (name: string) => `/?fixture=boards&story=boards-24-hot-box--${name}`;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/* The sweep's pace, read from the scrub rules' own source as e2e/whoops.spec.ts reads it (importing it would pull in more than a number), and refused if it is not found. */
const SWEEP_PX_S = Number(/export const SWEEP_PX_S = (\d+)/.exec(readFileSync(new URL('../instances/divided-world/cards/whoops/scrub.ts', import.meta.url), 'utf8'))?.[1]);
if (!Number.isFinite(SWEEP_PX_S)) throw new Error('SWEEP_PX_S is not in instances/divided-world/cards/whoops/scrub.ts');

/** The smoke's color in the stories, #ff69b4. */
const FOG: readonly [number, number, number] = [255, 105, 180];
/**
 * How far a channel of the fog's color at a point may be from the smoke's color: a puff is a disc of white or black at most 22% opaque (the effect draws
 * it at 0.22 times its shade), which moves a channel by at most 22% of 255, 56, and a little more where it is composited over a fog that is not opaque.
 */
const FOG_TOLERANCE = 60;
/** How far the mask's flat layer may leave one color from another in a line's box: the words at `maskAlpha` 0.06 are 6% of 255, about 15, and glyph antialiasing adds a step. */
const ONE_COLOR = 24;

const wave = (page: Page) => page.getByRole('button', { name: 'Wave the smoke' });
const POST = '#post-43';
const words = (page: Page) => page.locator(`${POST} .dw-hotbox-words`);
const link = (page: Page) => words(page).locator('a');

/**
 * Counts each time the smoke's canvas is cleared, which is each time it is drawn, and each call to `requestAnimationFrame`, so "nothing is drawn and no frame is
 * asked for" can be asked of a page. The frame counter wraps whatever `requestAnimationFrame` is when this script runs, so a page whose clock is installed first
 * (see `open`) counts the clock's.
 */
const COUNT_DRAWS = () => {
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  const w = window as unknown as { __hbDraws: number; __hbFrames: number; __hbStacks: string[] };
  w.__hbDraws = 0;
  w.__hbFrames = 0;
  w.__hbStacks = [];
  CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...a: [number, number, number, number]) {
    if (this.canvas.classList.contains('dw-hotbox-smoke')) w.__hbDraws += 1;
    return clear.apply(this, a);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__hbFrames += 1; if (w.__hbStacks.length < 40) w.__hbStacks.push(String(new Error().stack).split('\n').slice(2, 6).join(' < ')); return raf(cb); };
};
const draws = (page: Page) => page.evaluate(() => (window as unknown as { __hbDraws: number }).__hbDraws);
/** Who asked for the frames after the first `from` of them (the stack of each request), for a message that says whose they were. */
const frameCallers = (page: Page, from: number) => page.evaluate((n) => (window as unknown as { __hbStacks: string[] }).__hbStacks.slice(n), from);
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __hbFrames: number }).__hbFrames);

/**
 * Opens a story and waits for its smoke and its first settled frame, with the post in the middle of the screen. `clock`: the page's clock is installed before
 * it loads (and so runs as usual), and paused for the test to move (`frozen`).
 */
async function open(page: Page, name: string, o: { readonly frozen?: boolean; readonly counted?: boolean } = {}) {
  /* The clock first, so the counter wraps its `requestAnimationFrame` (init scripts run in the order they are added). */
  if (o.frozen) await page.clock.install({ time: Date.now() });
  if (o.counted) await page.addInitScript(COUNT_DRAWS);
  await page.goto(STORY(name));
  /* A cold story on a busy machine takes a few seconds to load its thread and seed its play. */
  await expect(wave(page)).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
  await page.locator(`${POST} .dw-hotbox`).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settled(page, { loops: true });
  /* A second ahead: the clock runs as usual until it is paused, and a pause in the past is refused. */
  if (o.frozen) await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

/** Moves a frozen page's clock, and gives React's scheduler (not faked) the turn it needs to draw what the move changed. */
async function run(page: Page, ms: number) {
  await page.clock.runFor(ms);
}

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** The words' lines, as boxes in the viewport: each text node's line fragments, those on one line joined, top to bottom. */
async function lines(page: Page): Promise<Box[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const found: { x: number; y: number; r: number; b: number }[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!(n.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) found.push({ x: r.left, y: r.top, r: r.right, b: r.bottom });
    }
    found.sort((a, b) => a.y - b.y || a.x - b.x);
    const out: { x: number; y: number; r: number; b: number }[] = [];
    for (const f of found) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - f.y) < 4) { last.x = Math.min(last.x, f.x); last.r = Math.max(last.r, f.r); last.b = Math.max(last.b, f.b); } else out.push({ ...f });
    }
    return out.map((o) => ({ x: o.x, y: o.y, w: o.r - o.x, h: o.b - o.y }));
  }, `${POST} .dw-hotbox-words`);
}

/** The smoke's tile canvas at a viewport point (the layer holds a canvas for each tile): the mean of the (2 * half + 1) square around it, each channel as the canvas holds it; null when no tile holds the point. */
async function fogAt(page: Page, x: number, y: number, half = 2) {
  return page.evaluate(([px, py, h]) => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('#post-43 canvas.dw-hotbox-smoke')].find((c) => {
      const r = c.getBoundingClientRect();
      return c.width > 0 && px! >= r.left && px! < r.right && py! >= r.top && py! < r.bottom;
    });
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const k = canvas.width / box.width;
    const cx = Math.round((px! - box.left) * k), cy = Math.round((py! - box.top) * k);
    const x0 = Math.max(0, cx - h!), y0 = Math.max(0, cy - h!);
    const data = canvas.getContext('2d')!.getImageData(x0, y0, Math.min(canvas.width - x0, 2 * h! + 1), Math.min(canvas.height - y0, 2 * h! + 1)).data;
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 4; c++) sum[c]! += data[i + c]!;
    const n = data.length / 4;
    return { r: sum[0]! / n, g: sum[1]! / n, b: sum[2]! / n, a: sum[3]! / n };
  }, [x, y, half] as const);
}
const alphaAt = async (page: Page, x: number, y: number, half = 2) => (await fogAt(page, x, y, half))?.a ?? Number.NaN;

/** The widest of the first three lines, and a point on it a fixed way in, where a mouse is put. */
async function aim(page: Page) {
  const found = (await lines(page)).slice(0, 3).sort((a, b) => b.w - a.w)[0]!;
  expect(found.w).toBeGreaterThan(400);
  return { line: found, x: found.x + 200, y: found.y + found.h / 2 };
}

/**
 * The smoke's radius, read from the content area's width (the smoke's container is the post's whole content area, `.kb-act-main`, border to border: the owner's
 * word of 2026-11-15, as Whoops! and Feelin' Fab fill theirs). Not the words' box, which is narrower by the area's padding.
 */
const radiusOf = async (page: Page) => holeRadius((await areaBox(page)).w);

/** The post's content area's padding box in the viewport: its border box inside its borders (`clientLeft`, `clientTop`), `clientWidth` by `clientHeight`. */
const areaBox = (page: Page): Promise<Box> => page.evaluate((sel) => {
  const area = document.querySelector(sel)!.closest<HTMLElement>('.kb-act-main')!;
  const r = area.getBoundingClientRect();
  return { x: r.left + area.clientLeft, y: r.top + area.clientTop, w: area.clientWidth, h: area.clientHeight };
}, `${POST} .dw-hotbox`);
const wordsBox = async (page: Page): Promise<Box> => { const b = (await words(page).boundingBox())!; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
/**
 * The smoke's box in the viewport: the union of its tiles' canvases (the layer places each at its offset in the box). The union is the content area only
 * while every tile of the post is held, which is true of the short fixture post (one tile near the view); a post taller than the window's near range holds
 * only the tiles near it, and its union is shorter than the area.
 */
const canvasBox = (page: Page): Promise<Box> => page.locator(`${POST} canvas.dw-hotbox-smoke`).evaluateAll((els) => {
  if (els.length === 0) throw new Error('the smoke has no tile canvas: there is no box to take the union of');
  const rs = els.map((el) => el.getBoundingClientRect());
  const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
});

/** The tiles together are the content area's padding box, to a pixel, and each tile's bitmap is made. */
async function expectCanvasFillsArea(page: Page) {
  const a = await areaBox(page), c = await canvasBox(page);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(c[k] - a[k]), `the canvas's ${k} is the content area's (${JSON.stringify(c)} against ${JSON.stringify(a)})`).toBeLessThanOrEqual(1);
  expect(await page.locator(`${POST} canvas.dw-hotbox-smoke`).evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLCanvasElement).width > 0 && (el as HTMLCanvasElement).height > 0))).toBe(true);
}

/**
 * Points in the content area that are not on the words' box, each named: in the area's left and right padding at the words' middle, in the space below the words
 * (the area runs on under them), at the area's top-left corner, and, when the last line stops short of the words' right edge, beside it.
 */
async function offWords(page: Page): Promise<Record<string, { x: number; y: number }>> {
  const a = await areaBox(page), w = await wordsBox(page), all = await lines(page), last = all[all.length - 1]!;
  const out: Record<string, { x: number; y: number }> = {
    'left padding': { x: (a.x + w.x) / 2, y: w.y + w.h / 2 },
    'right padding': { x: (w.x + w.w + a.x + a.w) / 2, y: w.y + w.h / 2 },
    'below the words': { x: w.x + w.w / 2, y: (w.y + w.h + a.y + a.h) / 2 },
    'top-left corner': { x: a.x + 3, y: a.y + 3 },
  };
  if (last.x + last.w + 60 < w.x + w.w) out['beside the last line'] = { x: (last.x + last.w + w.x + w.w) / 2, y: last.y + last.h / 2 };
  return out;
}

/** The point of the viewport an element stands at, and whether a hit test there lands on it (or inside it). */
const hitsAtCenter = (page: Page, selector: string) => page.locator(selector).evaluate((el) => {
  const b = el.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return hit !== null && (hit === el || el.contains(hit));
});

/** The most a channel differs between the pixels of a screenshot of `clip`; the screenshot is read in the page, since the page can decode a PNG and the test runner here has no decoder. */
async function colorRange(page: Page, clip: Box) {
  const png = await page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c]!, d[i + c]!); hi[c] = Math.max(hi[c]!, d[i + c]!); }
    return Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  }, png.toString('base64'));
}

/**
 * Holds Enter on the control until the post is waved and returns how long the hold took on the page's clock, in whole steps of `step` ms (the clock moves a step at a
 * time, so the figure is the first step at or after the end). The key is left down for the caller to release.
 */
async function heldToEnd(page: Page, step = 250): Promise<number> {
  await wave(page).focus();
  const began = await page.evaluate(() => Date.now());
  await page.keyboard.down('Enter');
  for (;;) {
    await run(page, step);
    const spent = (await page.evaluate(() => Date.now())) - began;
    if (!(await words(page).evaluate((el) => (el as HTMLElement).inert))) return spent;
    if (spent > 900_000) throw new Error('the hold never reached the end of the post');
  }
}

/** axe's violations over the whole page, contrast included; none when the page is right. */
async function violations(page: Page, within?: string): Promise<string[]> {
  await page.addStyleTag({ content: '.kb-smoke-layers { display: none !important; }' });
  await page.evaluate(axeSource);
  const found = await page.evaluate(async ([tags, scope]) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] }> } }).axe;
    return (await axe.run(scope ? { include: [[scope]] } : document, { runOnly: { type: 'tag', values: tags as string[] } })).violations;
  }, [TAGS, within ?? null] as const);
  /* The page's own scroll is the viewport's, as e2e/a11y.spec.ts lets go. */
  return found
    .map((v) => ({ ...v, nodes: v.id === 'scrollable-region-focusable' ? v.nodes.filter((n) => !(Array.isArray(n.target) && n.target.length === 1 && (n.target[0] === 'body' || n.target[0] === 'html'))) : v.nodes }))
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 8).map((n) => JSON.stringify(n.target)).join(' | ')}`);
}

/** A color the way the page resolves a system color, so a border can be compared with `CanvasText` itself. */
const systemColor = (page: Page, name: string) => page.evaluate((color) => {
  const probe = document.createElement('div');
  probe.style.cssText = `forced-color-adjust: none; color: ${color}`;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}, name);

/* ------------------------------------------------------------------------------------------ the smoke ---- */

test('the words under the smoke are covered in the caster\'s color, and inert', async ({ page }) => {
  await open(page, 'fresh-light');
  const { line } = await aim(page);
  const px = (await fogAt(page, line.x + line.w / 2, line.y + line.h / 2, 3))!;
  expect(px, 'the post has a smoke canvas with something in it').not.toBeNull();
  expect(px.a).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  FOG.forEach((c, i) => expect(Math.abs([px.r, px.g, px.b][i]! - c)).toBeLessThanOrEqual(FOG_TOLERANCE));
  expect(await words(page).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  /* Inert for a pointer too: what the point over a word hits is not the words. */
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.dw-hotbox-words') ?? null, [line.x + 40, line.y + line.h / 2] as const)).toBeNull();
});

test('the smoke fills the post\'s content area border to border, beyond the words\' box', async ({ page }) => {
  await open(page, 'fresh-light');
  await expectCanvasFillsArea(page);
  const a = await areaBox(page), w = await wordsBox(page);
  expect(w.x - a.x, 'the area has padding around the words, which is what this checks').toBeGreaterThanOrEqual(6);
  const spots = await offWords(page);
  expect(Object.keys(spots).length).toBeGreaterThanOrEqual(4);
  for (const [name, p] of Object.entries(spots)) {
    const px = await fogAt(page, p.x, p.y, 2);
    expect(px, `${name}: a pixel of the canvas`).not.toBeNull();
    expect(px!.a, `${name} is covered at the fog's strength`).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    FOG.forEach((c, i) => expect(Math.abs([px!.r, px!.g, px!.b][i]! - c), `${name} is in the smoke's color`).toBeLessThanOrEqual(FOG_TOLERANCE));
  }
});

test('a mouse in the area\'s padding, outside the words, opens a clearing there', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  const spots = await offWords(page);
  const p = spots['below the words']!;
  const fog = await alphaAt(page, p.x, p.y);
  expect(fog).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.kb-act-main') !== null, [p.x, p.y] as const), 'the point is in the area').toBe(true);
  await page.mouse.move(p.x, p.y);
  await run(page, 100);
  await expect.poll(() => alphaAt(page, p.x, p.y), 'the clearing opens where the mouse is, outside the words').toBeLessThanOrEqual(2);
  /* It is a clearing of the area's own radius, centered there: a point a radius and a bit to its side along the same row is fogged again. */
  const r = await radiusOf(page);
  expect(await alphaAt(page, p.x + r * 1.5, p.y)).toBeGreaterThanOrEqual(fog - 10);
  const left = spots['left padding']!;
  await page.mouse.move(left.x, left.y);
  await run(page, 100);
  await expect.poll(() => alphaAt(page, left.x, left.y), 'and in the left padding too').toBeLessThanOrEqual(2);
});

test('"Wave the smoke" is above the fog and a press on it sweeps the words clear; what else of the post is hit and what is under the fog', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  expect(await hitsAtCenter(page, `${POST} .dw-hotbox-wave`), 'the control is what a hit at its center lands on').toBe(true);
  const [first] = await lines(page);
  const perLine = ((await words(page).evaluate((el) => el.getBoundingClientRect().width)) / SWEEP_PX_S) * 1000;
  const button = (await wave(page).boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await run(page, perLine + 300);
  await expect.poll(() => alphaAt(page, first!.x + first!.w / 2, first!.y + first!.h / 2), 'a press on the control clears the first line').toBeLessThanOrEqual(2);
  await page.mouse.up();
  /* Every control the post offers, outside its words: a hit at its center lands on it (the fog does not take clicks), and with the canvas made hittable for a moment, which of them are under it. */
  const report = await page.evaluate(() => {
    const post = document.querySelector('#post-43')!;
    const canvases = [...post.querySelectorAll<HTMLElement>('canvas.dw-hotbox-smoke')];
    const found = [...post.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [data-kb-over-ink], .kb-mark')]
      .filter((el) => !el.closest('.dw-hotbox-words') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    const name = (el: HTMLElement) => `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/u)[0] ?? ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`;
    const center = (el: HTMLElement) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] as const; };
    const blocked = found.filter((el) => { const [x, y] = center(el); const hit = document.elementFromPoint(x, y); return !(hit && (hit === el || el.contains(hit))); }).map(name);
    const prior = canvases.map((c) => c.style.pointerEvents);
    for (const c of canvases) c.style.pointerEvents = 'auto';
    const under = found.filter((el) => { const [x, y] = center(el); return canvases.includes(document.elementFromPoint(x, y) as HTMLElement); }).map(name);
    canvases.forEach((c, i) => { c.style.pointerEvents = prior[i]!; });
    return { all: found.map(name), blocked, under };
  });
  test.info().annotations.push({ type: 'post controls', description: `all: ${report.all.join(', ')}; blocked: ${report.blocked.join(', ') || 'none'}; under the fog: ${report.under.join(', ') || 'none'}` });
  console.log(`hot-box post #43 controls: ${JSON.stringify(report)}`);
  expect(report.blocked, 'no control of the post is blocked by the smoke').toEqual([]);
  expect(report.under.filter((n) => n.includes('dw-hotbox-wave') || n.includes('kb-reactions')), 'the wave control and the reactions row are above the fog').toEqual([]);
});

test('a mouse over a line clears it there, softly, and it closes again after the pointer leaves', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  const { x, y } = await aim(page);
  const r = await radiusOf(page);
  const fog = await alphaAt(page, x, y);
  expect(fog).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  await page.mouse.move(x, y);
  await run(page, 100);
  await expect.poll(() => alphaAt(page, x, y)).toBeLessThanOrEqual(2);
  /* The soft edge: a point in the clearing's edge band is neither clear nor fogged. */
  const edge = await alphaAt(page, x + r * (1 - SMOKE.edge / 2), y, 0);
  expect(edge).toBeGreaterThan(20);
  expect(edge).toBeLessThan(fog - 20);
  /* Away from the clearing the smoke is as it was. */
  expect(await alphaAt(page, x + r * 2.2, y)).toBeGreaterThanOrEqual(fog - 10);
  await page.mouse.move(5, 5);
  await run(page, SMOKE.roll / 2);
  await expect.poll(() => alphaAt(page, x, y), 'half way through its closing').toBeGreaterThan(20);
  expect(await alphaAt(page, x, y)).toBeLessThan(fog - 20);
  await run(page, SMOKE.roll / 2 + 150);
  await expect.poll(() => alphaAt(page, x, y)).toBeGreaterThanOrEqual(fog - 10);
});

test('moving the mouse from the words onto the control closes the clearing', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  const { x, y } = await aim(page);
  await page.mouse.move(x, y);
  await run(page, 100);
  await expect.poll(() => alphaAt(page, x, y)).toBeLessThanOrEqual(2);
  const button = (await wave(page).boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await run(page, SMOKE.roll + 300);
  await expect.poll(() => alphaAt(page, x, y), 'a mouse on the control leaves nothing open behind it').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
});

test('the control\'s pointer leave stops a hold', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  /* The first line: the one the held sweep has finished after a line's time and a little over (the widest of the first few might be the second). */
  const [line] = await lines(page);
  const mid = { x: line!.x + 100, y: line!.y + line!.h / 2 };
  const perLine = ((await words(page).evaluate((el) => el.getBoundingClientRect().width)) / SWEEP_PX_S) * 1000;
  const button = (await wave(page).boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await run(page, perLine + 300);
  await expect.poll(() => alphaAt(page, mid.x, mid.y), 'a line the held sweep finished is clear').toBeLessThanOrEqual(2);
  await page.mouse.move(5, 5);
  await run(page, SMOKE.roll + 300);
  await expect.poll(() => alphaAt(page, mid.x, mid.y), 'the smoke is back after the pointer left the control').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  await run(page, perLine * 3);
  expect(await alphaAt(page, mid.x, mid.y), 'and the hold does not start again').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  expect(await words(page).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await page.mouse.up();
});

test('thinning is visibly thinner than fresh', async ({ page, context }) => {
  await open(page, 'fresh-light');
  const { line } = await aim(page);
  const at = { x: line.x + line.w / 2, y: line.y + line.h / 2 };
  const fresh = await alphaAt(page, at.x, at.y, 6);
  const other = await context.newPage();
  await open(other, 'thinning');
  const thin = await alphaAt(other, at.x, at.y, 6);
  expect(fresh).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  /* Two and a half days of three in: the fog is about 0.53 of 1 against 0.94, and a reader sees it. */
  expect(thin).toBeLessThanOrEqual((fogAlpha(1 / 6) + 0.1) * 255);
  expect(fresh - thin).toBeGreaterThan(60);
});

test('the Lens opens from the card\'s mark and shows the state, the way out and the hold control', async ({ page }) => {
  await open(page, 'fresh-light');
  await page.locator(`${POST} .kb-mark[data-kb-card="hot-box"]:not(.kb-ghost-mark)`).click();
  const lens = page.getByRole('dialog', { name: 'Cards on this post' });
  await expect(lens).toBeVisible();
  await expect(lens.getByText('Smoke over the words')).toBeVisible();
  await expect(lens.locator('.kb-lens-ends')).toContainText('Point at the words, or hold Wave the smoke, to read.');
  await expect(lens.locator('.kb-lens-ends')).toContainText(/Ends/u);
  await expect(lens.getByRole('button', { name: 'Wave the smoke' })).toBeVisible();
});

/* --------------------------------------------------------------------- the keyboard and the hold ---- */

test('Tab reaches the control, a held Enter clears the post, its link can then be focused, and the smoke is back 20 seconds later', async ({ page }) => {
  /* A long post's hold steps the clock 250 ms a round trip, and a round trip on CI's slower Linux takes several times what it takes here. */
  test.setTimeout(420_000);
  await open(page, 'long-post', { frozen: true });
  expect((await lines(page)).length, 'twelve paragraphs run to many lines').toBeGreaterThan(20);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 100; i++) {
    if (await wave(page).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(wave(page)).toBeFocused();
  /* The words are inert: a link in them cannot be reached before a sweep. */
  await link(page).focus();
  await expect(link(page)).not.toBeFocused();
  const spent = await heldToEnd(page);
  test.info().annotations.push({ type: 'sweep', description: `${(await lines(page)).length} lines, held to the end in ${(spent / 1000).toFixed(1)} s` });
  console.log(`hot-box long-post: ${(await lines(page)).length} lines, held to the end in ${(spent / 1000).toFixed(1)} s`);
  expect(spent, 'a long post takes a long hold').toBeGreaterThan(10_000);
  await page.keyboard.up('Enter');
  /* Clear: the first line and the last have nothing over them. */
  const all = await lines(page);
  for (const l of [all[0]!, all[all.length - 1]!]) await expect.poll(() => alphaAt(page, l.x + l.w / 2, l.y + l.h / 2), 'the waved post has no smoke over its words').toBeLessThanOrEqual(2);
  await expect(words(page)).not.toHaveJSProperty('inert', true);
  await page.keyboard.press('Tab');
  await expect(link(page)).toBeFocused();
  /* Twenty seconds on the page's own clock (a jump: the effect's timer is late and catches up): the smoke is back and the words inert again. */
  await page.clock.fastForward(SMOKE.waved + 200);
  await run(page, SMOKE.roll + 300);
  await expect(words(page)).toHaveJSProperty('inert', true);
  await expect.poll(() => alphaAt(page, all[0]!.x + all[0]!.w / 2, all[0]!.y + all[0]!.h / 2)).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  /* Focus was in the words when they went inert: it goes back to the control (No player is ever stuck). */
  await expect(wave(page)).toBeFocused();
});

/* ------------------------------------------------------------------------------------ reduced motion ---- */

test('under reduced motion nothing is drawn after the first paint, and the hold still takes time', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await open(page, 'reduced', { counted: true, frozen: true });
  const first = await draws(page);
  expect(first, 'the first paint happened').toBeGreaterThan(0);
  /* The counters are live (the full-motion page below moves them): this page's clock is paused, so a loop would draw and ask for frames as it moves. */
  /* The frame counter starts after a short settle, as one stray request from the page's own entrances (one in about twenty runs, under load; not the effect's, which asks for none) can land just after the first paint; a loop would ask every 16 ms of the two seconds that follow. */
  await run(page, 500);
  await page.waitForTimeout(300);
  const firstFrames = await frames(page);
  await run(page, 2000);
  await page.waitForTimeout(300);
  expect(await draws(page), 'no frame is drawn as time passes').toBe(first);
  expect(await frames(page), `and no animation frame is asked for after the first paint (asked for by: ${(await frameCallers(page, firstFrames)).join(' || ')})`).toBe(firstFrames);
  const spent = await heldToEnd(page);
  await page.keyboard.up('Enter');
  expect(spent, 'the hold is as long as a sweep of the post').toBeGreaterThanOrEqual(1500);
  /* The same post at full motion takes as long, give or take the step the clock moves by (a step is 250 ms: 500 is two of them, one each side, and a slower machine's round trips do not change the page's clock). */
  /* A context of its own: a clock is a context's, and this one's is paused. */
  const loudContext = await browser.newContext({ viewport: { width: 1440, height: 1120 }, bypassCSP: true });
  try {
    const loud = await loudContext.newPage();
    await open(loud, 'fresh-light', { counted: true, frozen: true });
    const first2 = await draws(loud), firstFrames2 = await frames(loud);
    await run(loud, 500);
    await loud.waitForTimeout(300);
    expect(await draws(loud), 'with motion the counter does see frames').toBeGreaterThan(first2);
    expect(await frames(loud), 'and the frame counter sees them asked for').toBeGreaterThan(firstFrames2);
    const spentLoud = await heldToEnd(loud);
    await loud.keyboard.up('Enter');
    expect(Math.abs(spent - spentLoud)).toBeLessThanOrEqual(500);
  } finally {
    await loudContext.close();
  }
});

/* ------------------------------------------------------------------------------------ forced colors ---- */

test.describe('under forced colors', () => {
  for (const name of ['fresh-light', 'long-post']) {
    test(`${name}: the words are masked and a hard circle clears them, with a ring and a sign`, async ({ page }) => {
      await open(page, name, { counted: true, frozen: true });
      await page.emulateMedia({ forcedColors: 'active' });
      const sign = page.locator(`${POST} .dw-hotbox-sign`);
      await expect(sign).toBeVisible();
      await expect(sign).toContainText('Smoke over the words');
      await expect(sign).toContainText('Point at the words, or hold Wave the smoke, to read.');
      const text = await systemColor(page, 'CanvasText');
      const frame = page.locator(`${POST} .dw-hotbox-frame`);
      await expect(frame).toBeVisible();
      expect(await frame.evaluate((el) => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; })).toEqual({ style: 'solid', width: '2px', color: text });
      await expect(page.locator(`${POST} canvas.dw-hotbox-smoke`), 'no tile is made under forced colors').toHaveCount(0);
      /* The outline is the content area's, border to border (the smoke's container), not the words'. */
      const fb = (await frame.boundingBox())!, ab = await areaBox(page);
      for (const [k, v] of [['x', fb.x], ['y', fb.y], ['w', fb.width], ['h', fb.height]] as const) expect(Math.abs(v - ab[k]), `the frame's ${k} is the area's`).toBeLessThanOrEqual(1);
      /* No frame is drawn for a canvas nobody sees. The toggle has settled first (the sign is up above; a short step lets the effect's own re-render and its last paint go by). */
      await run(page, 100);
      await page.waitForTimeout(200);
      const before = await draws(page);
      await run(page, 1000);
      await page.waitForTimeout(200);
      expect(await draws(page)).toBe(before);

      /* Away from the pointer a line shows no glyphs: its whole box is one color. */
      const { line, x, y } = await aim(page);
      const r = await radiusOf(page);
      /* Inside the line's box by a few px, so a sample takes none of the line above or below it. (The frame's outline is the content area's, ten px outside the words' box.) */
      const inLine = (from: number, to: number): Box => ({ x: from, y: line.y + 3, w: to - from, h: line.h - 6 });
      expect(await colorRange(page, inLine(line.x + 8, line.x + 400))).toBeLessThanOrEqual(ONE_COLOR);

      /* With the mouse over it: inside the circle the words show (more than one color), outside, right up to the ring, they do not (a hard edge). */
      await page.mouse.move(x, y);
      await run(page, 100);
      const ring = page.locator(`${POST} .dw-hotbox-ring`);
      await expect(ring).toHaveCount(1);
      const rb = (await ring.boundingBox())!;
      expect(Math.abs(rb.width - 2 * r)).toBeLessThanOrEqual(2);
      expect(await ring.evaluate((el) => { const c = getComputedStyle(el); return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor, events: c.pointerEvents }; })).toEqual({ style: 'solid', width: '2px', color: text, events: 'none' });
      expect(await colorRange(page, inLine(x - r * 0.6, x + r * 0.6)), 'the circle shows the words').toBeGreaterThanOrEqual(100);
      expect(await colorRange(page, inLine(x + r + 6, x + r + 80)), 'right outside the ring there is no fade').toBeLessThanOrEqual(ONE_COLOR);
      /* It closes again after the pointer leaves. */
      await page.mouse.move(5, 5);
      await run(page, SMOKE.roll + 300);
      await expect(ring).toHaveCount(0);
      await expect.poll(() => colorRange(page, inLine(x - r * 0.6, x + r * 0.6))).toBeLessThanOrEqual(ONE_COLOR);

      /*
       * The pointer in the area's padding, below the words, where there is no text at all: the ring is drawn there (a sample of its edge where nothing else is
       * painted cannot pass on glyphs), the words stay masked, and a clearing opens with the pointer outside them.
       */
      const area = await areaBox(page);
      const wb = await wordsBox(page);
      /* A long post runs past the screen: scroll the area's bottom edge to a good way up the screen, clear of any fixed bar at its foot (a scroll, which the paused clock does not touch). */
      await page.evaluate((bottom) => { window.scrollBy(0, bottom - (window.innerHeight - 220)); }, area.y + area.h);
      /* Not `settled`: it waits for animation frames, which a paused clock never runs. */
      await run(page, 100);
      const area2 = await areaBox(page), wb2 = await wordsBox(page);
      expect(wb2.y + wb2.h + 20, 'the area runs on under the words').toBeLessThan(area2.y + area2.h);
      const below = { x: wb2.x + wb2.w / 2, y: (wb2.y + wb2.h + area2.y + area2.h) / 2 };
      expect(below.y, 'the point is on screen').toBeLessThan(1120);
      expect(await page.evaluate(([x, y]) => { const hit = document.elementFromPoint(x!, y!); return hit?.closest('.kb-act-main') ? 'area' : `${hit?.tagName}.${hit?.className}`; }, [below.x, below.y] as const), 'the point is in the area').toBe('area');
      await page.mouse.move(below.x, below.y);
      await run(page, 100);
      await expect(ring).toHaveCount(1);
      const pb = (await ring.boundingBox())!;
      expect(Math.abs(pb.width - 2 * r)).toBeLessThanOrEqual(2);
      expect(Math.abs(pb.x + pb.width / 2 - below.x), 'the ring is centered on the pointer').toBeLessThanOrEqual(2);
      expect(Math.abs(pb.y + pb.height / 2 - below.y), 'the ring is centered on the pointer, in the padding').toBeLessThanOrEqual(2);
      /* Its left and right edges lie in the padding below the words (the ring's vertical middle is that row), where there is no text: both are dark against the page. */
      expect(pb.y + pb.height / 2, 'the ring\'s middle row is below the words').toBeGreaterThan(wb2.y + wb2.h + 2);
      for (const ex of [pb.x, pb.x + pb.width - 2]) expect(await colorRange(page, { x: ex - 2, y: pb.y + pb.height / 2 - 2, w: 6, h: 4 }), 'the ring is drawn in the padding').toBeGreaterThanOrEqual(100);
      /* The words are masked still: the last line, clear of the ring, is one color. */
      const all = await lines(page), last = all[all.length - 1]!;
      expect(await colorRange(page, { x: last.x + 8, y: last.y + 3, w: Math.max(20, Math.min(160, last.w - 16)), h: last.h - 6 }), 'the words stay masked with the pointer in the padding').toBeLessThanOrEqual(ONE_COLOR);
      await page.mouse.move(5, 5);
      await run(page, SMOKE.roll + 300);
      await expect(ring).toHaveCount(0);
    });
  }

  test('long-post: the hold takes as long as without forced colors, and leaves the link focusable', async ({ page, browser }) => {
    /* Two long holds, 250 ms of the page's clock a round trip each, on a machine (CI's Linux) whose round trips are slower than this one's. */
    test.setTimeout(420_000);
    await open(page, 'long-post', { frozen: true });
    const plain = await heldToEnd(page);
    await page.keyboard.up('Enter');
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1120 }, bypassCSP: true });
    try {
      const other = await otherContext.newPage();
      await open(other, 'long-post', { frozen: true });
      await other.emulateMedia({ forcedColors: 'active' });
      await expect(other.locator(`${POST} .dw-hotbox-sign`)).toBeVisible();
      const forced = await heldToEnd(other);
      await other.keyboard.up('Enter');
      /* Each side is counted in steps of 250 ms, and the forced path moves its mask on a 50 ms timer: a second is about the one step each can be off by, twice. The clock is the page's, so a slow machine does not widen this. */
      expect(Math.abs(plain - forced)).toBeLessThanOrEqual(1000);
      await other.keyboard.press('Tab');
      await expect(link(other)).toBeFocused();
    } finally {
      await otherContext.close();
    }
  });

  test('with forced colors off there is no mask, no ring and no sign, and the canvas keeps its soft clearing', async ({ page }) => {
    await open(page, 'fresh-light', { frozen: true });
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator(`${POST} .dw-hotbox-sign`)).toBeVisible();
    await page.emulateMedia({ forcedColors: 'none' });
    await expect(page.locator(`${POST} .dw-hotbox-sign`)).toHaveCount(0);
    await expect(page.locator(`${POST} .dw-hotbox-frame`)).toHaveCount(0);
    const { x, y } = await aim(page);
    const r = await radiusOf(page);
    await page.mouse.move(x, y);
    await run(page, 100);
    await expect(page.locator(`${POST} .dw-hotbox-ring`)).toHaveCount(0);
    expect(await words(page).evaluate((el) => { const c = getComputedStyle(el); return { mask: c.maskImage, outline: c.outlineStyle }; })).toEqual({ mask: 'none', outline: 'none' });
    expect(await page.locator(`${POST} canvas.dw-hotbox-smoke`).first().evaluate((el) => getComputedStyle(el).display)).toBe('block');
    /* The soft clearing, as in the first test: the center is clear, the fog is the fog, and the edge band is between. */
    await expect.poll(() => alphaAt(page, x, y)).toBeLessThanOrEqual(2);
    const fog = await alphaAt(page, x + r * 2.2, y);
    expect(fog).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    const edge = await alphaAt(page, x + r * (1 - SMOKE.edge / 2), y, 0);
    expect(edge).toBeGreaterThan(20);
    expect(edge).toBeLessThan(fog - 20);
  });

  test('axe finds nothing on the smoked post', async ({ page }) => {
    await open(page, 'fresh-light');
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator(`${POST} .dw-hotbox-sign`)).toBeVisible();
    /* The smoked post alone: axe does not model forced colors, and read over the whole page under them it reports the contrast of other posts' reaction tiles and the HUD,
       which are not Hot Box's and which the same page passes with forced colors off (the `axe finds nothing on fresh-light` test below). */
    expect(await violations(page, POST)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ the rest ---- */

for (const name of ['fresh-light', 'fresh-dark', 'reduced']) {
  test(`axe finds nothing on ${name}`, async ({ page }) => {
    await open(page, name);
    expect(await violations(page)).toEqual([]);
  });
}

test.describe('at a phone\'s width', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('the control is at least 44px tall', async ({ page }) => {
    await open(page, 'fresh-light');
    expect((await wave(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('the smoke fills the content area border to border at a phone\'s width, beyond the words', async ({ page }) => {
    await open(page, 'fresh-light');
    await expectCanvasFillsArea(page);
    const spots = await offWords(page);
    for (const [name, p] of Object.entries(spots)) {
      const px = await fogAt(page, p.x, p.y, 1);
      expect(px, `${name}: a pixel of the canvas`).not.toBeNull();
      expect(px!.a, `${name} is covered at the fog's strength`).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    }
  });

  test('a tap in the left padding, outside the words, opens a clearing there', async ({ page }) => {
    await open(page, 'fresh-light', { frozen: true });
    const p = (await offWords(page))['left padding']!;
    await expect.poll(() => alphaAt(page, p.x, p.y)).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    expect(await page.evaluate(([x, y]) => { const hit = document.elementFromPoint(x!, y!); return hit?.closest('.kb-act-main') ? 'area' : `${hit?.tagName}.${hit?.className}`; }, [p.x, p.y] as const), 'the point is in the area').toBe('area');
    /* The left padding, not the strip below the words: that is 7px at a phone's width, beside the post's buttons, and touch targeting hands a tap there to them. */
    await page.touchscreen.tap(p.x, p.y);
    await run(page, 100);
    await expect.poll(() => alphaAt(page, p.x, p.y)).toBeLessThanOrEqual(2);
  });

  test('a tap opens a clearing where it lands, which holds and then closes', async ({ page }) => {
    await open(page, 'fresh-light', { frozen: true });
    /* A phone's lines are short: a point in the middle of the first. */
    const [first] = await lines(page);
    const x = first!.x + first!.w / 2, y = first!.y + first!.h / 2;
    await expect.poll(() => alphaAt(page, x, y)).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    await page.touchscreen.tap(x, y);
    await run(page, 100);
    await expect.poll(() => alphaAt(page, x, y)).toBeLessThanOrEqual(2);
    await run(page, SMOKE.touchHold - 600);
    await expect.poll(() => alphaAt(page, x, y), 'a touched clearing holds before it starts to close').toBeLessThanOrEqual(2);
    await run(page, 600 + SMOKE.roll + 300);
    await expect.poll(() => alphaAt(page, x, y)).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  });

  test('a swipe over the smoked post still scrolls the page', async ({ page }) => {
    await open(page, 'long-post');
    const host = page.locator(`${POST} .dw-hotbox-words`);
    /* The post's words a third of the way down the screen, so a swipe up starts on them. */
    await host.evaluate((el) => { window.scrollBy(0, el.getBoundingClientRect().top - 300); });
    await settled(page, { loops: true });
    const box = (await host.boundingBox())!;
    const startY = Math.min(700, box.y + 250);
    const startX = box.x + box.width / 2;
    const before = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX, y: startY - i * 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY), 'the swipe moved the page').toBeGreaterThan(before + 100);
    await cdp.detach();
  });
});
