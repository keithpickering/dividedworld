import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SMOKE, fogAlpha, holeRadius } from '../instances/divided-world/ui/hot-box/smoke.ts';
import { settled } from './settled.ts';

/**
 * Hot Box as a browser draws it (docs/plans/2026-11-15-hot-box-plan.md, Task 7, as amended for forced colors, and docs/plans/2026-11-15-hot-box-fog-plan.md,
 * Task 7; design docs/plans/2026-11-15-hot-box-fog-design.md): the smoke is a shaded fog painted into the engine's tile canvases over the words, so the words
 * under it are covered and inert; a mouse moves the fog aside where it points, leaving a wake that closes from its rim; a touch opens a clearing that holds, a drag
 * leaves a wake and a vertical swipe still scrolls; the post holds no button: Tab reaches the card's mark, the Lens opens from it and holds "Wave the smoke", which
 * a held Enter takes to the end (the post is clear for 20 seconds) and a click holds for one second; the Lens shows the card's state and its way out; under reduced
 * motion nothing is drawn after the first paint and the hold still takes its time; and under forced colors, where a canvas's fog cannot be drawn in system colors,
 * the words themselves are masked, a hard circle clears them (and the trail behind it for a moment), a ring marks it and a sign says what the Lens says. What the
 * fog costs is read at a phone's speed (a 4x CPU throttle) from the tile loop's own probe, and a post at rest costs nothing a second beyond its 20 repaints.
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

/* The ladder's budget, read from the effect's own source (importing the effect would pull in React and its stylesheet), and refused if it is not found. */
const FOG_BUDGET_MS = Number(/export const FOG_BUDGET_MS = (\d+(?:\.\d+)?)/.exec(readFileSync(new URL('../instances/divided-world/ui/hot-box/ladder.ts', import.meta.url), 'utf8'))?.[1]);
if (!Number.isFinite(FOG_BUDGET_MS)) throw new Error('FOG_BUDGET_MS is not in instances/divided-world/ui/hot-box/ladder.ts');
/* The frames painted at the ladder's last rung before the fog's cost there is judged: as many as the ladder judges its own mean on, read from the effect's
 * source as the budget is, so that it is a mean. */
const LADDER_SETTLED = Number(/const LADDER_FIRST = (\d+)/.exec(readFileSync(new URL('../instances/divided-world/ui/hot-box/ladder.ts', import.meta.url), 'utf8'))?.[1]);
if (!Number.isInteger(LADDER_SETTLED)) throw new Error('LADDER_FIRST is not in instances/divided-world/ui/hot-box/ladder.ts');
/* How long the cost cases' sweep goes on past its length while the ladder has not settled (#864). */
const SETTLE_CAP_MS = 6000;

/** The smoke's color in the stories is #ff69b4: red 255, green 105, blue 180. */
/**
 * Whether a pixel of the fog is in the smoke's color. The fog is shaded: lit toward white by at most half, and shaded toward a deeper, cooler shade of the color
 * (fog.ts `FOG.light`, `FOG.shade`), so a channel can be a long way from the color's own and no tolerance on a channel says "this is hot pink". What does hold in
 * every shade is the color's hue: green is its lowest channel, by a margin, as it is in #ff69b4 (and is not in white, black or gray).
 */
const inFogHue = (px: { r: number; g: number; b: number }) => px.g <= Math.min(px.r, px.b) - 25;
/** How far the mask's flat layer may leave one color from another in a line's box: the words at `maskAlpha` 0.06 are 6% of 255, about 15, and glyph antialiasing adds a step. */
const ONE_COLOR = 24;

const POST = '#post-43';
/** The Lens's hold, the only control the card has (the post holds none). */
const wave = (page: Page) => page.getByRole('button', { name: 'Wave the smoke' });
/** The post's Hot Box mark, which opens the Lens. */
const MARK = `${POST} .kb-mark[data-kb-card="hot-box"]:not(.kb-ghost-mark)`;
const LENS = (page: Page) => page.getByRole('dialog', { name: 'Cards on this post' });
/** The post's words: the engine's words box in the post's own content area (the smoke fills the row and has no words box of its own). */
const WORDS = `${POST} .kb-act-grid > [data-kb-content-area] [data-kb-words-box]`;
const words = (page: Page) => page.locator(WORDS);
const link = (page: Page) => words(page).locator('a');

/**
 * Counts each time the smoke's canvas is cleared, which is each time it is drawn, and each call to `requestAnimationFrame`, so "nothing is drawn and no frame is
 * asked for" can be asked of a page. The frame counter wraps whatever `requestAnimationFrame` is when this script runs, so a page whose clock is installed first
 * (see `open`) counts the clock's.
 */
const COUNT_DRAWS = () => {
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  const w = window as unknown as { __hbDraws: number; __hbFrames: number; __hbStacks: string[]; __hbPer: Map<HTMLCanvasElement, number> };
  w.__hbPer = new Map();
  w.__hbDraws = 0;
  w.__hbFrames = 0;
  w.__hbStacks = [];
  CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...a: [number, number, number, number]) {
    if (this.canvas.classList.contains('dw-hotbox-smoke')) { w.__hbDraws += 1; w.__hbPer.set(this.canvas, (w.__hbPer.get(this.canvas) ?? 0) + 1); }
    return clear.apply(this, a);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__hbFrames += 1; if (w.__hbStacks.length < 40) w.__hbStacks.push(String(new Error().stack).split('\n').slice(2, 6).join(' < ')); return raf(cb); };
};
const draws = (page: Page) => page.evaluate(() => (window as unknown as { __hbDraws: number }).__hbDraws);
/** Who asked for the frames after the first `from` of them (the stack of each request), for a message that says whose they were. */
const frameCallers = (page: Page, from: number) => page.evaluate((n) => (window as unknown as { __hbStacks: string[] }).__hbStacks.slice(n), from);
/** The most times any one tile canvas of the post was drawn since `forgetDraws`, and how many were drawn in all. */
const perTile = (page: Page) => page.evaluate(() => { const per = [...(window as unknown as { __hbPer: Map<HTMLCanvasElement, number> }).__hbPer.values()]; return { most: Math.max(0, ...per), all: per.reduce((a, b) => a + b, 0), tiles: per.length }; });
const forgetDraws = (page: Page) => page.evaluate(() => { (window as unknown as { __hbPer: Map<HTMLCanvasElement, number> }).__hbPer.clear(); });
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
  /* A cold story on a busy machine takes a few seconds to load its thread and seed its play. The post holds no control: its smoke's host is what is waited for. */
  await expect(page.locator(`${POST} .dw-hotbox`)).toBeVisible({ timeout: 20_000 });
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

/** Opens the Lens from the post's mark and leaves the mouse off the post (a mouse on the mark would be clearing fog there). */
async function openLens(page: Page) {
  await page.locator(MARK).click();
  await expect(LENS(page)).toBeVisible();
  await expect(wave(page)).toBeVisible();
  await page.mouse.move(5, 5);
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
  }, WORDS);
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

/**
 * How far the clear space (the fog under half its resting strength) runs through a viewport point along a row (`x`) or a column (`y`) of the tiles' canvases: the
 * contiguous run of pixels, either side, until fog or the end of the canvases. Read in the page, a pixel at a time, every `stride` px.
 */
const clearRun = (page: Page, x: number, y: number, axis: 'x' | 'y', stride = 2) => page.evaluate(([px, py, ax, st, rest]) => {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('#post-43 canvas.dw-hotbox-smoke')].filter((c) => c.width > 0);
  const alphaAtPoint = (qx: number, qy: number): number | null => {
    const canvas = canvases.find((c) => { const r = c.getBoundingClientRect(); return qx >= r.left && qx < r.right && qy >= r.top && qy < r.bottom; });
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    return canvas.getContext('2d')!.getImageData(Math.min(canvas.width - 1, Math.round((qx - r.left) * k)), Math.min(canvas.height - 1, Math.round((qy - r.top) * k)), 1, 1).data[3]!;
  };
  const reach = (dir: 1 | -1) => {
    let d = 0;
    for (;;) {
      const a = alphaAtPoint(ax === 'x' ? px! + dir * (d + st!) : px!, ax === 'y' ? py! + dir * (d + st!) : py!);
      if (a === null || a > rest! / 2) return d;
      d += st!;
      if (d > 1500) return d;
    }
  };
  const here = alphaAtPoint(px!, py!);
  if (here === null || here > rest! / 2) return 0;
  return reach(1) + reach(-1);
}, [x, y, axis, stride, fogAlpha(1) * 255] as const);

/** Moves the mouse along a row in `steps` equal moves, each followed by `every` ms of the page's clock. Returns the last point. */
async function sweepRow(page: Page, from: number, to: number, y: number, steps: number, every: number) {
  await page.mouse.move(from, y);
  await run(page, every);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from + ((to - from) * i) / steps, y);
    await run(page, every);
  }
  return { x: to, y };
}

/** The ladder's rung of the post's host, 0 to 4. */
const levelOf = (page: Page) => page.locator(`${POST} .dw-hotbox`).evaluate((el) => Number(el.getAttribute('data-dw-fog-level')));

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
const radiusOf = async (page: Page) => holeRadius((await rowBox(page)).w);

/** The post's content area's padding box in the viewport: its border box inside its borders (`clientLeft`, `clientTop`), `clientWidth` by `clientHeight`. */
const areaBox = (page: Page): Promise<Box> => page.evaluate((sel) => {
  const area = document.querySelector<HTMLElement>(sel)!;
  const r = area.getBoundingClientRect();
  return { x: r.left + area.clientLeft, y: r.top + area.clientTop, w: area.clientWidth, h: area.clientHeight };
}, `${POST} .kb-act-grid > [data-kb-content-area]`);
/** The post's row, the smoke's box (design docs/plans/2026-11-27-season-two-cards-design.md, section 7): the grid's padding box, postbit included, which the row layer's `inset: 0` fills. */
const rowBox = (page: Page): Promise<Box> => page.evaluate((sel) => {
  const row = document.querySelector<HTMLElement>(sel)!;
  const r = row.getBoundingClientRect();
  return { x: r.left + row.clientLeft, y: r.top + row.clientTop, w: row.clientWidth, h: row.clientHeight };
}, `${POST} .kb-act-grid`);
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
  const a = await rowBox(page), c = await canvasBox(page);
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
 * time, so the figure is the first step at or after the end). The Lens is opened from the mark if it is not open. The key is left down for the caller to release.
 */
async function heldToEnd(page: Page, step = 250): Promise<number> {
  if (!(await wave(page).isVisible())) await openLens(page);
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
  expect(inFogHue(px), `the fog over the words is in the smoke's hue (${JSON.stringify(px)})`).toBe(true);
  expect(await words(page).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  /* Inert for a pointer too: what the point over a word hits is not the words. */
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-kb-words-box]') ?? null, [line.x + 40, line.y + line.h / 2] as const)).toBeNull();
});

test('the smoke fills the post\'s row border to border, postbit included, beyond the words\' box', async ({ page }) => {
  await open(page, 'fresh-light');
  await expectCanvasFillsArea(page);
  /* The postbit's cell is in the row: the smoke is over it too. */
  const bit = await page.locator(`${POST} .kb-act-grid > :not([data-kb-content-area]):not(.kb-row-layer)`).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20), w: r.width }; }).find((b) => b.w > 20));
  expect(bit, 'the row has a cell beside the words').toBeDefined();
  const bitFog = (await fogAt(page, bit!.x, bit!.y, 1))!;
  expect(bitFog, 'the smoke is over the postbit').not.toBeNull();
  expect(bitFog.a).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  const a = await areaBox(page), w = await wordsBox(page);
  expect(w.x - a.x, 'the area has padding around the words, which is what this checks').toBeGreaterThanOrEqual(6);
  const spots = await offWords(page);
  expect(Object.keys(spots).length).toBeGreaterThanOrEqual(4);
  for (const [name, p] of Object.entries(spots)) {
    const px = await fogAt(page, p.x, p.y, 2);
    expect(px, `${name}: a pixel of the canvas`).not.toBeNull();
    expect(px!.a, `${name} is covered at the fog's strength`).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    expect(inFogHue(px!), `${name} is in the smoke's hue (${JSON.stringify(px)})`).toBe(true);
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

test('the post holds no control of its own, and every control in its row is under the smoke yet pressable', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  await expect(page.locator(`${POST} .dw-hotbox-wave`), 'no wave button stands on the post').toHaveCount(0);
  await expect(wave(page), 'and no "Wave the smoke" is there before the Lens is open').toHaveCount(0);
  /* Every control the post offers, outside its words: a hit at its center lands on it (the fog does not take clicks), and with the canvas made hittable for a moment, which of them are under it. */
  const report = await page.evaluate(() => {
    const post = document.querySelector('#post-43')!;
    const canvases = [...post.querySelectorAll<HTMLElement>('canvas.dw-hotbox-smoke')];
    const found = [...post.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [data-kb-over-ink], .kb-mark')]
      .filter((el) => !el.closest('[data-kb-words-box]') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
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
  /* The smoke is over the whole row, postbit included (design docs/plans/2026-11-27-season-two-cards-design.md, section 7), so the row's controls are plainly under it; what matters is that a press still reaches each. The mark's press is made for real: it opens the Lens, where Wave the smoke is the way out. */
  expect(report.all.some((n) => n.includes('kb-mark')), 'the row holds the card\'s mark').toBe(true);
  await page.locator(MARK).click();
  await expect(LENS(page), 'a click on the mark under the smoke opens the Lens').toBeVisible();
  await expect(wave(page)).toBeVisible();
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
  /* The fog closes in from its rim (design, section 3.2): half way through, the rim is more fogged than the center, by a clear margin (a uniform fade would have both the same), and neither is past the model's fog. */
  const rim = x + r * 0.8;
  const mid = { center: await alphaAt(page, x, y, 1), rim: await alphaAt(page, rim, y, 1) };
  test.info().annotations.push({ type: 'closing', description: `half way: center ${mid.center.toFixed(0)}, rim ${mid.rim.toFixed(0)}, of ${fog.toFixed(0)}` });
  console.log(`hot-box closing: half way, center ${mid.center.toFixed(0)}, rim ${mid.rim.toFixed(0)}, fog ${fog.toFixed(0)}`);
  expect(mid.rim, 'half way through its closing the rim is partly fogged again').toBeGreaterThan(20);
  expect(mid.rim, 'and not past the fog').toBeLessThan(fog - 20);
  expect(mid.rim - mid.center, 'the rim is more fogged than the center: it closes in from the rim').toBeGreaterThan(30);
  /* The wake lasts SMOKE.roll (2.5 s) and the field's last cells settle to rest a little after it; 500 ms is what that takes on this machine, and the poll below waits no longer than the test's own timeout. */
  await run(page, SMOKE.roll / 2 + 500);
  await expect.poll(() => alphaAt(page, x, y), 'and the whole of it has closed, the center last').toBeGreaterThanOrEqual(fog - 10);
  await expect.poll(() => alphaAt(page, rim, y), 'the rim too').toBeGreaterThanOrEqual(fog - 10);
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
  await expect(lens.getByText('Smoke over the post')).toBeVisible();
  /* The page's reader is the post's author, and the play landed just now: the hold is on, so the author is told when they can air it out and reads through as any reader does until then. */
  await expect(lens.locator('.kb-lens-ends')).toContainText(/^You can air it out for good in \d+h \d+m\. Until then, point at the smoke, or hold Wave the smoke, to read\./u);
  await expect(lens.locator('.kb-lens-ends')).toContainText(/Ends/u);
  await expect(lens.getByRole('button', { name: 'Wave the smoke' })).toBeVisible();
});

/* --------------------------------------------------------------------- the keyboard and the hold ---- */

test('Tab reaches the mark, Enter opens the Lens, Tab reaches "Wave the smoke", a held Enter clears the post, its link can be focused, and the smoke is back 20 seconds later with focus on the mark', async ({ page }) => {
  /* A long post's hold steps the clock 250 ms a round trip, and a round trip on CI's slower Linux takes several times what it takes here. */
  test.setTimeout(420_000);
  await open(page, 'long-post', { frozen: true });
  expect((await lines(page)).length, 'twelve paragraphs run to many lines').toBeGreaterThan(20);
  const on = (selector: string) => page.locator(selector).evaluate((el) => el === document.activeElement);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 200 && !(await on(MARK)); i++) await page.keyboard.press('Tab');
  await expect(page.locator(MARK), 'Tab reaches the Hot Box mark').toBeFocused();
  await page.keyboard.press('Enter');
  await expect(LENS(page)).toBeVisible();
  for (let i = 0; i < 20 && !(await wave(page).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(wave(page), 'Tab reaches "Wave the smoke" in the Lens').toBeFocused();
  /* The words are inert: a link in them cannot be reached before a sweep. */
  await link(page).focus();
  await expect(link(page)).not.toBeFocused();
  const spent = await heldToEnd(page);
  test.info().annotations.push({ type: 'sweep', description: `${(await lines(page)).length} lines, held to the end in ${(spent / 1000).toFixed(1)} s` });
  console.log(`hot-box long-post: ${(await lines(page)).length} lines, held to the end in ${(spent / 1000).toFixed(1)} s`);
  expect(spent, 'a long post takes a long hold').toBeGreaterThan(10_000);
  await page.keyboard.up('Enter');
  /* Clear: the first line and the last have nothing over them. A tile is held only near the window, so each is brought into view to be read. */
  const view = async (index: number) => {
    const l = (await lines(page))[index < 0 ? (await lines(page)).length + index : index]!;
    await page.evaluate((to) => { window.scrollBy(0, to - 560); }, l.y + l.h / 2);
    await run(page, 100);
    const at = (await lines(page))[index < 0 ? (await lines(page)).length + index : index]!;
    /* The layer learns that a tile has come near from its IntersectionObserver, which reports in real time, and takes the report up in a frame, which is on
     * the page's frozen clock. A reader's browser gives both at once; here the clock is moved a frame at each look until the report has been taken up and
     * a tile covers the line. A layer that never makes the tile fails here, with a frame of model time per look (a few hundred ms in all, well inside the wave). */
    await expect.poll(async () => { const held = (await fogAt(page, at.x + at.w / 2, at.y + at.h / 2)) !== null; if (!held) await run(page, 16); return held; }, `a tile of the layer is held over line ${index} once it is in view`).toBe(true);
    return at;
  };
  for (const index of [0, -1]) {
    const l = await view(index);
    await expect.poll(() => alphaAt(page, l.x + l.w / 2, l.y + l.h / 2), `the waved post has no smoke over line ${index}`).toBeLessThanOrEqual(2);
  }
  await expect(words(page)).not.toHaveJSProperty('inert', true);
  await link(page).focus();
  await expect(link(page), 'the link can be focused once the post is waved').toBeFocused();
  /* Twenty seconds on the page's own clock (a jump: the effect's timer is late and catches up): the smoke is back and the words inert again. */
  await page.clock.fastForward(SMOKE.waved + 200);
  await run(page, SMOKE.roll + 300);
  await expect(words(page)).toHaveJSProperty('inert', true);
  /* Under the fog again: the last line, still in view, whose tile was held cleared through the wave, and then the first, whose tile is made after it (fogged, not bare). */
  for (const index of [-1, 0]) {
    const l = await view(index);
    /* The page's clock is frozen, and a tile is repainted in the frame that follows a move of it: each look at the pixel moves the clock a frame, as `view` does until the tile is held. */
    await expect.poll(async () => { const a = await alphaAt(page, l.x + l.w / 2, l.y + l.h / 2); if (!(a >= (fogAlpha(1) - 0.06) * 255)) await run(page, 16); return a; }, `the smoke is back over line ${index}`).toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  }
  /* Focus was in the words when they went inert: it goes to the post's mark (No player is ever stuck), and nowhere else is it moved. */
  await expect(page.locator(MARK)).toBeFocused();
});

/* ---------------------------------------------------------------------------------------- the fog ---- */

test('the fog is shaded: many colors in the smoked area, and not the flat color alone', async ({ page }) => {
  await open(page, 'fresh-light');
  /* Only pixels at the fog's resting strength count: a transparent pixel is no color of the fog, and a fog of one flat color with transparent corners must not pass for shaded. */
  const found = await page.evaluate((minAlpha) => {
    const colors = new Map<number, number>();
    let total = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('#post-43 canvas.dw-hotbox-smoke')) {
      if (canvas.width === 0 || canvas.height === 0) continue;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! < minAlpha) continue;
        const key = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
        colors.set(key, (colors.get(key) ?? 0) + 1);
        total += 1;
      }
    }
    let most = 0;
    for (const n of colors.values()) most = Math.max(most, n);
    return { distinct: colors.size, total, share: total ? most / total : 1 };
  }, (fogAlpha(1) - 0.06) * 255);
  test.info().annotations.push({ type: 'shading', description: `${found.distinct} distinct colors over ${found.total} px; the commonest is ${(found.share * 100).toFixed(1)}% of them` });
  expect(found.total, 'the post has smoke painted').toBeGreaterThan(1000);
  expect(found.distinct, 'at least 40 distinct colors').toBeGreaterThanOrEqual(40);
  expect(found.share, 'no one color (the flat fog color) is most of it').toBeLessThan(0.5);
});

test('the fog moves with the pointer: the clear space is a streak along the path, longer than it is across', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  const { line, y } = await aim(page);
  const r = await radiusOf(page);
  const from = line.x + 30;
  /* A steady pace: 20 px every 20 ms, 1,000 px a second. */
  const end = await sweepRow(page, from, from + 360, y, 18, 20);
  await run(page, 60);
  const along = await clearRun(page, end.x, end.y, 'x');
  const across = await clearRun(page, end.x, end.y, 'y');
  test.info().annotations.push({ type: 'streak', description: `radius ${r.toFixed(0)} px: ${along} px clear along the path, ${across} px across` });
  console.log(`hot-box streak: radius ${r.toFixed(0)}, along ${along}, across ${across}`);
  expect(across, 'the pointer has cleared something').toBeGreaterThan(r);
  expect(along, 'the clear space is longer along the path than across it').toBeGreaterThan(across * 1.25);
  /* The post is short, so a column through the pointer ends at the post's edges and "across" is less than a circle's width: a round mask would pass the line above. A streak is also longer than a circle is wide. */
  expect(along, 'and longer than a round clearing of the model radius is wide').toBeGreaterThan(2 * r * 1.5);
});

test('the wake closes: a point the pointer left is clearer than rest at 300 ms and at rest by 2.5 s', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  const { line, y } = await aim(page);
  const r = await radiusOf(page);
  const rest = await alphaAt(page, line.x + 30, y + 40);
  expect(rest, 'the fog at rest before the move').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
  /* The point left behind: where the pointer started, then more than two radii away from where it stops. */
  const from = line.x + 30;
  const behind = { x: from + r * 0.3, y };
  const end = await sweepRow(page, from, from + r * 3, y, 15, 15);
  expect(end.x - behind.x, 'the point is well behind the pointer').toBeGreaterThan(r * 2);
  await run(page, 300);
  const at300 = await alphaAt(page, behind.x, behind.y);
  expect(at300, 'the wake behind the pointer is clearer than rest at 300 ms').toBeLessThan(rest - 40);
  await run(page, 2200);
  await expect.poll(() => alphaAt(page, behind.x, behind.y), 'and it has closed to rest by 2.5 s').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
});

test('one click on the Lens\'s hold holds for a second and does not finish a post', async ({ page }) => {
  await open(page, 'fresh-light', { frozen: true });
  await openLens(page);
  await wave(page).dispatchEvent('click');
  await run(page, 1500);
  await expect(words(page), 'one click does not take a post\'s sweep to its end').toHaveJSProperty('inert', true);
});

test('clicks on the Lens\'s hold, 900 ms apart, finish the short post\'s sweep of the row', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'fresh-light', { frozen: true });
  await openLens(page);
  /* The sweep goes over the row's height, postbit included (design section 7), a line at a time at the scrub's pace, so it is longer than the content area's was: the most clicks it can need is the row's height in the shortest lines
     the sweep tells apart (it merges those 2 px apart), a line of the row's width each, with a second of the hold per click. */
  const row = await rowBox(page);
  const most = Math.ceil((row.h / 12) * (row.w / SWEEP_PX_S) * 1000 / 900);
  let clicks = 0;
  /* Each click comes before the last one's second is out, so the hold goes on from one to the next. */
  while (clicks < most && await words(page).evaluate((el) => (el as HTMLElement).inert)) {
    await wave(page).dispatchEvent('click');
    await run(page, 900);
    clicks += 1;
  }
  expect(clicks, 'it took more than the one click that does not finish a post').toBeGreaterThan(1);
  await expect(words(page), `the held sweep reached the end of the post (${clicks} clicks of at most ${most})`).not.toHaveJSProperty('inert', true);
});

test('the fog fills the area at rest, and its repaints are at most 20 a second', async ({ page }) => {
  await open(page, 'fresh-light', { counted: true });
  await forgetDraws(page);
  const began = await page.evaluate(() => performance.now());
  await page.waitForTimeout(3000);
  const seconds = ((await page.evaluate(() => performance.now())) - began) / 1000;
  const { most, tiles } = await perTile(page);
  test.info().annotations.push({ type: 'rest', description: `${tiles} tile(s); the most repainted one was drawn ${most} times in ${seconds.toFixed(2)} s` });
  expect(tiles, 'the post has a tile that is repainted at all').toBeGreaterThan(0);
  expect(most, 'a tile at rest is repainted at most 21 times a second').toBeLessThanOrEqual(Math.ceil(21 * seconds));
});

test('a post scrolled out of view holds no tile and repaints nothing', async ({ page }) => {
  await open(page, 'long-post', { counted: true });
  /* First the post is in view and does hold a tile that is repainted, so that "none after" is a change and not an effect that never made a layer. */
  await expect.poll(() => page.locator(`${POST} canvas.dw-hotbox-smoke`).count(), 'a tile canvas is held for the post while it is in view').toBeGreaterThanOrEqual(1);
  await forgetDraws(page);
  await page.waitForTimeout(500);
  expect((await perTile(page)).all, 'and it is being repainted while in view').toBeGreaterThan(0);
  /* The page is made taller (a spacer before the post, which the post does not know of), so that the window can be 3,000 px from the post whatever the board's length. */
  const far = await page.evaluate(() => {
    const post = document.querySelector('#post-43')!;
    const spacer = document.createElement('div');
    spacer.style.height = '5000px';
    post.parentElement!.insertBefore(spacer, post);
    window.scrollTo(0, 0);
    const now = document.querySelector('#post-43 .kb-act-main')!.getBoundingClientRect();
    return Math.max(now.top - window.innerHeight, -now.bottom);
  });
  expect(far, 'the post is 3,000 px or more out of view').toBeGreaterThanOrEqual(3000);
  await expect.poll(() => page.locator(`${POST} canvas.dw-hotbox-smoke`).count(), 'no tile canvas is held for it').toBe(0);
  await page.waitForTimeout(200);
  await forgetDraws(page);
  await page.waitForTimeout(1500);
  expect((await perTile(page)).all, 'and nothing of it is repainted').toBe(0);
});

test.describe('what the fog costs', () => {
  /* The painter's own time, which the tile loop keeps for its last 600 frames (engine/ui/cards/tileLoop.ts, `probe.work`): the way e2e/effect-tiles.spec.ts reads it. */
  const BUDGET_STORY = 'boards-25-effect-budget--hot-box';

  async function sweepFor(page: Page, ms: number, story: string) {
    await page.goto(story.startsWith('boards-25') ? `/?fixture=boards&story=${story}` : STORY(story));
    await expect(page.locator(`${POST} .dw-hotbox`)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __kbTiles?: unknown }).__kbTiles))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(`${POST} .dw-hotbox`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(500);
    const line = (await lines(page))[1]!;
    const y = line.y + line.h / 2, x0 = line.x + 40, span = Math.min(line.w - 80, 500);
    expect(line.y, 'the line swept is on screen').toBeLessThan(1000);
    const f0 = await page.evaluate(() => {
      const kb = (window as unknown as { __kbTiles: { frames(): number }; __hbRung: number }).__kbTiles;
      /* The frame the ladder last stepped in, so the frames painted at the rung it settled on can be told from the ones before. */
      const w = window as unknown as { __hbRung: number };
      w.__hbRung = kb.frames();
      new MutationObserver(() => { w.__hbRung = kb.frames(); }).observe(document.querySelector('#post-43 .dw-hotbox')!, { attributes: true, attributeFilter: ['data-dw-fog-level'] });
      return kb.frames();
    });
    /* The figures, read in one go: the frames since the sweep began and since the ladder's last step. */
    const read = () => page.evaluate((from) => {
      const kb = (window as unknown as { __kbTiles: { frames(): number; work(n: number): number[] } }).__kbTiles;
      const work = kb.work(kb.frames() - from);
      const mean = (a: number[]) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : 0);
      const atRung = kb.work(kb.frames() - (window as unknown as { __hbRung: number }).__hbRung);
      return { frames: work.length, mean: mean(work), last: mean(work.slice(-30)), atRung: mean(atRung), atRungFrames: atRung.length, max: Math.max(0, ...work), level: Number(document.querySelector('#post-43 .dw-hotbox')?.getAttribute('data-dw-fog-level')) };
    }, f0);
    /* The sweep is `ms` long, then goes on until the ladder has painted LADDER_SETTLED frames at its last rung or SETTLE_CAP_MS more has
     * passed (#864). The ladder judges the mean of its last frames for as long as the post paints, and at 4x CPU rung 0 costs about the budget, so on a slow runner
     * its last step can fall in the sweep's last frames; judged then, the rung it took would have nothing painted at it. It steps at most four times
     * (FOG_LEVEL_MOST), each after at least LADDER_SETTLED frames painted at the rung before, so a ladder that is settling settles well inside the cap. The
     * figures returned are the ones the last check read, so a step the ladder takes after it cannot empty the rung they judge. */
    /* A check is a round trip to the page, so once the sweep is past its length it reads every tenth move (about a second at 4x CPU), not every move. */
    const CHECK_MOVES = 10;
    const began = Date.now();
    let waitedFrom: number | null = null;
    let got: Awaited<ReturnType<typeof read>>;
    for (let i = 0; ; i++) {
      const phase = (i % 40) / 40;
      await page.mouse.move(x0 + span * (phase < 0.5 ? phase * 2 : 2 - phase * 2), y);
      const swept = Date.now() - began;
      if (swept < ms || (waitedFrom !== null && i % CHECK_MOVES !== 0)) continue;
      got = await read();
      if (got.atRungFrames >= LADDER_SETTLED || swept >= ms + SETTLE_CAP_MS) break;
      /* Not settled at the sweep's end: the time from here on is what the run waited for it. */
      waitedFrom ??= swept;
    }
    const waited = waitedFrom === null ? null : { ms: Date.now() - began - waitedFrom, capped: got.atRungFrames < LADDER_SETTLED };
    return { ...got, waited };
  }

  for (const [label, story] of [['LongPost', 'long-post'], ['the longest post the instance allows', BUDGET_STORY]] as const) {
    for (const rate of [1, 4]) {
      test(`${label} at ${rate}x CPU: the fog's painter is within ${FOG_BUDGET_MS} ms a frame, or the ladder has stepped down to where it is`, async ({ page }) => {
        test.setTimeout(90_000);
        if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
        const got = await sweepFor(page, rate === 4 ? 6000 : 3000, story);
        const text = `${label}, ${rate}x CPU, pointer sweeping ${rate === 4 ? 6 : 3} s${got.waited ? ` and ${(got.waited.ms / 1000).toFixed(1)} s past it, waiting for the ladder to settle${got.waited.capped ? ', which it had not by the cap' : ''}` : ''}: ${got.frames} frames, mean ${got.mean.toFixed(2)} ms, mean at the rung it settled on ${got.atRung.toFixed(2)} ms over ${got.atRungFrames} frames, worst ${got.max.toFixed(1)} ms, ladder rung ${got.level}`;
        test.info().annotations.push({ type: 'cost', description: text });
        console.log(`hot-box cost: ${text}`);
        expect(got.frames, 'the painter ran').toBeGreaterThan(10);
        /* Only the throttled run is held to the budget (a phone's speed); the unthrottled one is the figure to compare it with. */
        if (rate === 4) {
          expect(got.atRungFrames, 'the ladder has settled: frames were painted at its last rung').toBeGreaterThanOrEqual(LADDER_SETTLED);
          expect(got.atRung, `the ladder settled on rung ${got.level} and the frames painted at it are within the budget`).toBeLessThanOrEqual(FOG_BUDGET_MS);
        }
      });
    }
  }

  /* Not held to the budget: where the ladder comes to at a phone's speed given time (it judges the mean of its first 8 frames, which a throttled page paints in well under a second), for the figures. */
  test('LongPost at 4x CPU for 12 s: where the ladder settles', async ({ page }) => {
    test.setTimeout(90_000);
    await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const got = await sweepFor(page, 12_000, 'long-post');
    const text = `LongPost, 4x CPU, pointer sweeping 12 s: ${got.frames} frames, mean ${got.mean.toFixed(2)} ms, last 30 frames mean ${got.last.toFixed(2)} ms, worst ${got.max.toFixed(1)} ms, ladder rung ${got.level}`;
    test.info().annotations.push({ type: 'cost', description: text });
    console.log(`hot-box cost: ${text}`);
    expect(got.frames).toBeGreaterThan(30);
  });

  test('a short post at 1x and 4x CPU: the figures', async ({ page }) => {
    test.setTimeout(90_000);
    for (const rate of [1, 4]) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const got = await sweepFor(page, 3000, 'fresh-light');
      const text = `short post, ${rate}x CPU, pointer sweeping 3 s: ${got.frames} frames, mean ${got.mean.toFixed(2)} ms, last 30 frames mean ${got.last.toFixed(2)} ms, worst ${got.max.toFixed(1)} ms, ladder rung ${got.level}`;
      test.info().annotations.push({ type: 'cost', description: text });
      console.log(`hot-box cost: ${text}`);
      expect(got.frames).toBeGreaterThan(10);
    }
  });
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
      await expect(sign).toContainText('Smoke over the post');
      /* The page's reader is the post's author, inside the hold: the sign says when they can air it out, and the way through until then. */
      await expect(sign).toContainText(/You can air it out for good in \d+h \d+m\. Until then, point at the smoke, or hold Wave the smoke, to read\./u);
      const text = await systemColor(page, 'CanvasText');
      const frame = page.locator(`${POST} .dw-hotbox-frame`);
      await expect(frame).toBeVisible();
      expect(await frame.evaluate((el) => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; })).toEqual({ style: 'solid', width: '2px', color: text });
      await expect(page.locator(`${POST} canvas.dw-hotbox-smoke`), 'no tile is made under forced colors').toHaveCount(0);
      /* The outline is the row's, border to border (the smoke's container), postbit included, not the words'. */
      const fb = (await frame.boundingBox())!, ab = await rowBox(page);
      for (const [k, v] of [['x', fb.x], ['y', fb.y], ['w', fb.width], ['h', fb.height]] as const) expect(Math.abs(v - ab[k]), `the frame's ${k} is the row's`).toBeLessThanOrEqual(1);
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
      /* A clearing and the trail point the pointer's first move left in it are each a disc, and each draws a ring: the one centered on the pointer is measured. */
      const rings = page.locator(`${POST} .dw-hotbox-ring`);
      await expect(rings).not.toHaveCount(0);
      /* Some ring is the pointer's: centered on it, within 2 px (the count is whatever it is). */
      const ringIndex = await rings.evaluateAll((els, [px, py]) => els.findIndex((el) => { const b = el.getBoundingClientRect(); return Math.abs(b.left + b.width / 2 - px!) <= 2 && Math.abs(b.top + b.height / 2 - py!) <= 2; }), [x, y] as const);
      expect(ringIndex, 'some ring is centered on the pointer').toBeGreaterThanOrEqual(0);
      const ring = rings.nth(ringIndex);
      const rb = (await ring.boundingBox())!;
      expect(Math.abs(rb.width - 2 * r)).toBeLessThanOrEqual(2);
      expect(await ring.evaluate((el) => { const c = getComputedStyle(el); return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor, events: c.pointerEvents }; })).toEqual({ style: 'solid', width: '2px', color: text, events: 'none' });
      expect(await colorRange(page, inLine(x - r * 0.6, x + r * 0.6)), 'the circle shows the words').toBeGreaterThanOrEqual(100);
      expect(await colorRange(page, inLine(x + r + 6, x + r + 80)), 'right outside the ring there is no fade').toBeLessThanOrEqual(ONE_COLOR);
      /* It closes again after the pointer leaves. */
      await page.mouse.move(5, 5);
      await run(page, SMOKE.roll + 300);
      await expect(rings).toHaveCount(0);
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
      await expect(rings).not.toHaveCount(0);
      /* The pointer's first move leaves a trail point that draws a ring too, so the count is whatever it is: some ring is the pointer's (centered on it, within 2 px, and a clearing's width). */
      const pb = (await rings.evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })))
        .find((b) => Math.abs(b.x + b.width / 2 - below.x) <= 2 && Math.abs(b.y + b.height / 2 - below.y) <= 2);
      expect(pb, 'some ring is centered on the pointer, in the padding').toBeDefined();
      expect(Math.abs(pb!.width - 2 * r)).toBeLessThanOrEqual(2);
      /* Its left and right edges lie in the padding below the words (the ring's vertical middle is that row), where there is no text: both are dark against the page. */
      expect(pb!.y + pb!.height / 2, 'the ring\'s middle row is below the words').toBeGreaterThan(wb2.y + wb2.h + 2);
      for (const ex of [pb!.x, pb!.x + pb!.width - 2]) expect(await colorRange(page, { x: ex - 2, y: pb!.y + pb!.height / 2 - 2, w: 6, h: 4 }), 'the ring is drawn in the padding').toBeGreaterThanOrEqual(100);
      /* The words are masked still: the last line, clear of the ring, is one color. */
      const all = await lines(page), last = all[all.length - 1]!;
      expect(await colorRange(page, { x: last.x + 8, y: last.y + 3, w: Math.max(20, Math.min(160, last.w - 16)), h: last.h - 6 }), 'the words stay masked with the pointer in the padding').toBeLessThanOrEqual(ONE_COLOR);
      await page.mouse.move(5, 5);
      await run(page, SMOKE.roll + 300);
      await expect(rings).toHaveCount(0);
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
      await link(other).focus();
      await expect(link(other), 'the link in the words can be focused once the post is waved').toBeFocused();
    } finally {
      await otherContext.close();
    }
  });

  test('the trail: a word behind the pointer is unmasked at 500 ms and masked at 1 s', async ({ page }) => {
    await open(page, 'fresh-light', { frozen: true });
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator(`${POST} .dw-hotbox-sign`)).toBeVisible();
    const { line, y } = await aim(page);
    const r = await radiusOf(page);
    const inLine = (from: number, to: number): Box => ({ x: from, y: line.y + 3, w: to - from, h: line.h - 6 });
    /* A quick move from `from` to a point more than two radii on: the word at the start is behind the pointer, and was passed 80 ms ago at most. */
    const from = line.x + r + 10;
    expect(line.w, 'the line is long enough for the move').toBeGreaterThan(r * 4 + 20);
    const behind = inLine(from - r * 0.3, from + r * 0.3);
    expect(await colorRange(page, behind), 'before the move the word is masked').toBeLessThanOrEqual(ONE_COLOR);
    await sweepRow(page, from, from + r * 2.6, y, 8, 10);
    await run(page, 500);
    expect(await colorRange(page, behind), 'at 500 ms a word behind the pointer is unmasked').toBeGreaterThanOrEqual(100);
    await run(page, 500);
    await expect.poll(() => colorRange(page, behind), 'and at 1 s it is masked again').toBeLessThanOrEqual(ONE_COLOR);
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

test('axe finds nothing on the smoked post with the Lens open', async ({ page }) => {
  await open(page, 'fresh-light');
  await openLens(page);
  expect(await violations(page)).toEqual([]);
});

test.describe('at a phone\'s width', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

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

  test('a horizontal drag across a line leaves a wake behind the finger, and it closes again', async ({ page }) => {
    await open(page, 'fresh-light', { frozen: true });
    const [first] = await lines(page);
    const r = await radiusOf(page);
    const y = first!.y + first!.h / 2, x0 = first!.x + 4, x1 = first!.x + first!.w - 4;
    /* A point on the path, more than a clearing's radius (and its soft edge) from both the touch-down point and where the finger ends: neither the touch's own held clearing at
       the start nor the one it carries to the end reaches it, so only the wake the finger left can have opened it. */
    const clear = r * 1.3;
    const mid = (x0 + x1) / 2;
    expect(mid - x0, 'the drag is long enough for a point beyond the start clearing').toBeGreaterThan(clear);
    expect(x1 - mid, 'and beyond the end clearing').toBeGreaterThan(clear);
    const rest = await alphaAt(page, mid, y);
    expect(rest, 'fog at rest on the path').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y }] });
      await run(page, 15);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await run(page, 300);
    await expect.poll(() => alphaAt(page, mid, y), 'the wake the finger left on its path is clearer than rest shortly after it passed').toBeLessThan(rest - 40);
    /* The wake lasts SMOKE.wake (1.5 s) and the end's clearing SMOKE.touchHold (4 s) but it is not near the middle: three seconds on, the middle is whole fog again. */
    await run(page, 3000);
    await expect.poll(() => alphaAt(page, mid, y), 'and a few seconds later it is whole fog again').toBeGreaterThanOrEqual((fogAlpha(1) - 0.06) * 255);
    await cdp.detach();
  });

  test('a vertical swipe that starts on the smoked words scrolls the page and leaves no long wake', async ({ page }) => {
    await open(page, 'long-post');
    const host = words(page);
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
    await expect.poll(() => page.evaluate(() => window.scrollY), 'the swipe that started on the smoked words moved the page (`touch-action: pan-y` on the host)').toBeGreaterThan(before + 100);
    /* The browser took the swipe for a scroll, so the finger sent no moves: what is open is the clearing where it landed and no streak along 200 px of path. The cleared area (fog under
       half its rest strength, in css px) is about one clearing's, never the clearing's and a streak of two radii by 200 px. */
    const r = await radiusOf(page);
    const cleared = await page.locator(`${POST} canvas.dw-hotbox-smoke`).evaluateAll((els, rest) => {
      let area = 0;
      for (const el of els as HTMLCanvasElement[]) {
        if (el.width === 0) continue;
        const k = el.width / el.getBoundingClientRect().width;
        const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! < rest / 2) n += 1;
        area += n / (k * k);
      }
      return area;
    }, fogAlpha(1) * 255);
    test.info().annotations.push({ type: 'swipe', description: `${cleared.toFixed(0)} css px squared cleared; one clearing is ${(Math.PI * r * r).toFixed(0)}` });
    console.log(`hot-box swipe: cleared ${cleared.toFixed(0)}, one clearing ${(Math.PI * r * r).toFixed(0)}`);
    expect(cleared, 'a swipe leaves one clearing and no long wake').toBeLessThan(1.6 * Math.PI * r * r);
    await cdp.detach();
  });
});
