import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { storyNameFromExport, toId } from 'storybook/internal/csf';
import { boardStoryIds, instanceUis } from './board-stories.ts';
import { MAX_TILE_DENSITY, MAX_TILE_PIXELS, TILE_NEAR_PX, TILE_PX, mostTiles } from '../engine/ui/cards/tiles.ts';

/**
 * The tile layer's frames and pixels, as Chromium runs them (docs/plans/2026-11-16-effect-tiles-design.md, section 6, guard 3; the plan,
 * docs/plans/2026-11-16-effect-tiles-step-1-plan.md, Task 7). One story for each effect on the layer
 * (instances/divided-world/ui/EffectBudget.board.stories.tsx), a post of the longest length the instance allows, scrolled from just above
 * its top to just past its bottom in three seconds, in the two screens the game is played at (`SIZES`: the desktop's at a device scale factor of 2 and a dense
 * touch phone's at 3, so that a tile is drawn at the layer's cap, 2, and the density cap can be seen to hold; the config has no projects, each spec sets
 * its own size as e2e/a11y.spec.ts does). Sizes and rects are CSS px and canvas width and height are canvas px, and the spec keeps them apart. In each:
 *
 * - Pixels. Every frame of the scroll is sampled in the page (`scrollRun`): every canvas under the post's row (`.kb-act-grid`: its content area and the layers a card that fills the row draws) holds at most
 *   `MAX_TILE_PIXELS` canvas px and is drawn at most at `MAX_TILE_DENSITY` per CSS px of its box, whatever the screen's density (and on these dense
 *   screens it is drawn at that density, so the cap is exercised and is not passed at 1 by accident); the canvases that hold any number at most
 *   `mostTiles(window height)` times the effect's sheets; no place in the post holds more canvases with pixels than the effect's sheets; none that holds
 *   any lies more than `TILE_NEAR_PX` plus one tile (`TILE_PX`) outside the window. A tile's sheets are the canvases that share its place in the post, and
 *   an effect's sheets are declared by its budget story (the tag `effect-sheets-N`), not inferred from the frame, so a layer that leaks by stacking
 *   canvases is not given room by doing so. An effect may ask the layer for a lower density (`TileLayerOptions.density`; Hot Box's fog asks for 1): its budget
 *   story declares that too (the tag `effect-density-N`, at most the cap; none is the cap), and on those screens some canvas is drawn at the ask and none denser,
 *   so a regression that drops the ask and draws at the cap is red. A canvas holds pixels where its width and height are not 0 (a layer frees one by sizing it to 0 by 0).
 * - Own time. The 95th percentile of the tile loop's own time in a frame (engine/ui/cards/tileLoop.ts `probe.work`, the loop's step timed on the
 *   page's own clock) is under `OWN_BUDGET`, half a 16.7 ms frame, leaving the rest to the page. A run that gave the loop fewer than `MIN_LOOP_FRAMES`
 *   frames is a tripwire that says so (the machine is too slow to measure on), and for a poison it counts as a miss of the budget. As e2e/shine.spec.ts does it: a warm-up run that
 *   is not timed (the script compiled, the first tiles made), then up to three timed runs, and one must meet the budget. Every run's figures and
 *   the gap between frames are logged; the gap is not asserted (issue #318: on a software-drawn Chromium it misses for the runner's load, and the
 *   loop's own time is what sees the loop).
 * - Never bare (a story that hides words: it carries the tag `effect-hides-words`). In every sampled frame each band of the post that crosses the
 *   window is held, with a canvas that holds pixels, or far, with a background that is not transparent: a band is never the post's words with
 *   neither the tile nor its stand-in over them. The scroll must have shown a held band with a canvas (the held branch is exercised live), and a jump
 *   (the window thrown to the post's middle, to near its end and back to its top) is sampled in each of the next `JUMP_FRAMES` frames, the fling case.
 *   What this cannot see even so: a held canvas that is blank or stale, a canvas whose content is wrong after a resize, a canvas that is hidden by
 *   style. It reads only each canvas's size and place, and each band's attribute and color.
 * - At the bottom. With the scroll at its end the tiles of the post's top have been released: no canvas holds pixels more than `TILE_NEAR_PX` plus
 *   a tile above the window.
 *
 * Which stories are which is read from the story files' tags where Playwright collects its tests (`storiesTagged`), so a story added to the file is
 * run with no edit here: `effect-budget` is a budget story, `effect-poison` a poison. The poisons are for this spec to see its checks go red (a
 * check never red is not known to work): `PoisonSlow` makes a layer of its own whose painter takes 25 ms, which misses `OWN_BUDGET` in every run,
 * and `PoisonWhole` lays one canvas the size of the post body, which the pixel check refuses and names by its size. The checks themselves are plain
 * functions of the page's raw samples, and are tried on planted samples as well.
 */

/** The 95th percentile of the tile loop's own time in a frame, in ms: half of a 60 Hz frame. The figure is the design's (sections 6 and 9); the PR records what the runs measured. */
const OWN_BUDGET = 8;
/** The screens: the desktop's, as e2e/shine.spec.ts runs it but at a device scale factor of 2, and a dense touch phone's (CSS px for the window; `dpr` is the device scale factor). */
const SIZES = {
  desktop: { width: 1200, height: 900, dpr: 2, touch: false },
  phone: { width: 390, height: 844, dpr: 3, touch: true },
} as const;
/** A run in which the tile loop ran fewer frames than this measured nothing: a tripwire for a budget story, a miss for the slow poison. */
const MIN_LOOP_FRAMES = 20;
/** A scroll of three seconds is sampled in at least this many animation frames (a software renderer at about 20 fps gives 60; this is half of that). */
const MIN_SAMPLES = 30;
/** After each jump this many animation frames are sampled. */
const JUMP_FRAMES = 8;
/** How long a scroll takes, in ms. */
const SCROLL_MS = 3000;
/** The most a frame moves the scroll's clock, ms: two 60 Hz frames, so a frame that took longer scrolls no farther than that (about 110 px of the 3,250 px a second a long post goes at). */
const MAX_STEP_MS = 33.4;
/** The scroll starts this far above the post's top and ends this far past its bottom, in CSS px. */
const SCROLL_MARGIN = 150;
/** A canvas that holds pixels may lie this far outside the window: the layer holds the tiles near the window, and an observer reports after the frame that scrolled. */
const OUTSIDE_PX = TILE_NEAR_PX + TILE_PX;
const SLOW_POISON = 'boards-25-effect-budget--poison-slow';
const WHOLE_POISON = 'boards-25-effect-budget--poison-whole';

/** A canvas: `w` and `h` are its canvas px, `cw` and `ch` its box in CSS px, and `top`, `bottom` and `left` its place in CSS px. */
interface CanvasSample { w: number; h: number; cw: number; ch: number; top: number; bottom: number; left: number }
interface BandSample { top: number; bottom: number; tile: string | null; background: string; canvas: boolean }
/** One animation frame of a scroll, read in the page: the window's height, every canvas under the post's words and every band of the post. */
interface Sample { t: number; vh: number; dpr: number; canvases: CanvasSample[]; bands: BandSample[]; label?: string }
/** A scroll: its samples, the loop's own time in each frame it ran, and the post's height and the scroll's ends in CSS px. */
interface Run { samples: Sample[]; work: number[]; post: number; from: number; to: number }

/* ---- Which stories are which: the tags in the story files. ---- */

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const storyFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? storyFiles(p) : e.name.endsWith('.board.stories.tsx') ? [p] : [];
});

/** The tags of each board story, in its `tags: [...]` (a story's export, up to the next export), by the id Storybook gives each. */
export function storyTags(roots: readonly string[] = [path.join(REPO, 'engine', 'ui'), ...instanceUis(REPO)]): Map<string, string[]> {
  const all = new Set(boardStoryIds(roots));
  const found = roots.flatMap(storyFiles).flatMap((file): [string, string[]][] => {
    const text = fs.readFileSync(file, 'utf8');
    const title = /\bconst meta\b[^=]*=\s*\{[^}]*?\btitle:\s*(?:'([^']+)'|"([^"]+)")/.exec(text)?.slice(1).find(Boolean);
    if (!title) return [];
    return text.split(/^(?=export const )/m).flatMap((chunk) => {
      const name = /^export const (\w+)/.exec(chunk)?.[1];
      const tags = /\btags:\s*\[([^\]]*)\]/.exec(chunk)?.[1] ?? '';
      return name ? [[toId(title, storyNameFromExport(name)), [...tags.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)]] : [];
    });
  });
  return new Map(found.filter(([id]) => all.has(id)));
}

/** The ids of the board stories that carry `tag`. */
export function storiesTagged(tag: string, tags: ReadonlyMap<string, string[]> = storyTags()): string[] {
  return [...tags].filter(([, t]) => t.includes(tag)).map(([id]) => id).sort();
}

/** The sheets a budget story declares for its effect (the tag `effect-sheets-N`, N a positive whole number), or undefined where it declares none or two. */
export function declaredSheets(tags: readonly string[]): number | undefined {
  const found = tags.flatMap((t) => { const m = /^effect-sheets-([1-9]\d*)$/.exec(t); return m ? [Number(m[1])] : []; });
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The density a budget story declares its effect asks of the layer (the tag `effect-density-N`, N a positive number up to `MAX_TILE_DENSITY`), or
 * undefined where it declares none, two, or one that is not a number in that range: such a story draws at the cap.
 */
export function declaredDensity(tags: readonly string[]): number | undefined {
  const found = tags.flatMap((t) => { const m = /^effect-density-(\d+(?:\.\d+)?)$/.exec(t); return m ? [Number(m[1])] : []; });
  return found.length === 1 && found[0]! > 0 && found[0]! <= MAX_TILE_DENSITY ? found[0] : undefined;
}

const TAGS = storyTags();
const BUDGET_STORIES = storiesTagged('effect-budget', TAGS);
const HIDING_STORIES = new Set(storiesTagged('effect-hides-words', TAGS));
const POISONS = storiesTagged('effect-poison', TAGS);

/* ---- The checks, plain functions of the page's samples. ---- */

/** The alpha of a computed color (`rgba(r, g, b, a)`, `rgb(r g b / a)`, `color(srgb r g b / a)`, `transparent`); a color it cannot read is 0, which is refused. */
export function alphaOf(color: string): number {
  const c = color.trim();
  if (c === 'transparent') return 0;
  const m = /^(?:rgba?|color)\(([^)]*)\)$/.exec(c);
  if (!m) return 0;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
  const a = c.startsWith('color(') ? (m[1]!.includes('/') ? parts[parts.length - 1]! : '1') : parts.length >= 4 ? parts[3]! : '1';
  const n = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  return Number.isFinite(n) ? n : 0;
}
const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};
const holdsPixels = (c: CanvasSample) => c.w > 0 && c.h > 0;
const outside = (c: CanvasSample, vh: number) => c.bottom < -OUTSIDE_PX || c.top > vh + OUTSIDE_PX;
const inWindow = (b: BandSample, vh: number) => b.bottom > 0 && b.top < vh;
const at = (s: Sample, k: number) => s.label ?? `frame ${k}`;

/** What the pixel check names in a run's samples for an effect of `sheets` sheets, one line for each frame and canvas it refuses (at most a dozen are kept). */
export function pixelProblems(samples: readonly Sample[], sheets: number): string[] {
  const out: string[] = [];
  samples.forEach((s, k) => {
    const places = new Map<string, number>();
    for (const c of s.canvases) {
      if (c.w * c.h > MAX_TILE_PIXELS) out.push(`${at(s, k)}: a ${c.w}x${c.h} canvas holds ${c.w * c.h} px, over the ${MAX_TILE_PIXELS} a tile may`);
      if (c.w > Math.ceil(c.cw * MAX_TILE_DENSITY) || c.h > Math.ceil(c.ch * MAX_TILE_DENSITY)) {
        out.push(`${at(s, k)}: a ${c.w}x${c.h} canvas is drawn denser than ${MAX_TILE_DENSITY} per CSS px (its box is ${c.cw}x${c.ch} CSS px, on a screen of ${s.dpr})`);
      }
      if (holdsPixels(c) && outside(c, s.vh)) out.push(`${at(s, k)}: a ${c.w}x${c.h} canvas holds pixels at ${Math.round(c.top)} to ${Math.round(c.bottom)} px, outside a window ${s.vh} tall by more than ${OUTSIDE_PX}`);
      if (holdsPixels(c)) places.set(`${c.left}:${c.top}`, (places.get(`${c.left}:${c.top}`) ?? 0) + 1);
    }
    for (const [place, n] of places) if (n > sheets) out.push(`${at(s, k)}: ${n} canvases with pixels at the place ${place} (left:top), over the ${sheets} sheet${sheets === 1 ? '' : 's'} the story declares`);
    const holding = s.canvases.filter(holdsPixels).length, most = mostTiles(s.vh) * sheets;
    if (holding > most) out.push(`${at(s, k)}: ${holding} canvases hold pixels, over the ${most} a window ${s.vh} tall is allowed (${mostTiles(s.vh)} tiles of ${sheets} sheets)`);
  });
  return out.slice(0, 12);
}

/**
 * On a screen as dense as the layer's cap or more, some canvas with pixels is drawn at the density the effect draws at, `min(cap, ask)` (its box times
 * it, rounded up), and none is drawn denser: else the cap was never in play, or the effect's ask was dropped. `ask` is what the budget story declares
 * (`declaredDensity`); with none the effect draws at the cap.
 */
export function densityProblems(samples: readonly Sample[], ask?: number): string[] {
  const dense = samples.filter((s) => s.dpr >= MAX_TILE_DENSITY);
  if (dense.length === 0) return ['no frame was taken on a screen as dense as the cap'];
  const d = Math.min(MAX_TILE_DENSITY, ask ?? MAX_TILE_DENSITY);
  const drawn = dense.some((s) => s.canvases.some((c) => holdsPixels(c) && c.w + 1 > c.cw * d && c.h + 1 > c.ch * d));
  if (!drawn) {
    return [ask === undefined
      ? `no canvas with pixels was drawn at ${MAX_TILE_DENSITY} per CSS px on a screen of ${dense[0]!.dpr}, so the density cap was never in play`
      : `no canvas with pixels was drawn at ${d} per CSS px on a screen of ${dense[0]!.dpr}, so the density the effect asks for (${ask}) was never in play`];
  }
  if (ask === undefined) return [];
  const over = dense.flatMap((s) => s.canvases.filter((c) => holdsPixels(c) && (c.w > Math.ceil(c.cw * d) || c.h > Math.ceil(c.ch * d))));
  return over.length === 0 ? [] : [`a ${over[0]!.w}x${over[0]!.h} canvas is drawn denser than the ${d} per CSS px the effect asks for (its box is ${over[0]!.cw}x${over[0]!.ch} CSS px), so its ask of ${ask} was dropped`];
}

/** The bands of the post that cross the window in some frame with neither a tile that holds pixels nor a stand-in with a color. */
export function bareProblems(samples: readonly Sample[]): string[] {
  const out: string[] = [];
  samples.forEach((s, k) => {
    s.bands.forEach((b, i) => {
      if (!inWindow(b, s.vh)) return;
      const covered = (b.tile === 'held' && b.canvas) || (b.tile === 'far' && alphaOf(b.background) > 0);
      if (!covered) out.push(`${at(s, k)}: band ${i} (${Math.round(b.top)} to ${Math.round(b.bottom)} px) is in the window with data-kb-tile ${b.tile ?? 'unset'}, ${b.canvas ? 'a canvas' : 'no canvas with pixels'}, background ${b.background}`);
    });
  });
  return out.slice(0, 12);
}

/** Whether some frame had a band in the window that was held with a canvas that holds pixels (the held branch of the never-bare check is exercised). */
export const sawHeld = (samples: readonly Sample[]): boolean => samples.some((s) => s.bands.some((b) => inWindow(b, s.vh) && b.tile === 'held' && b.canvas));

/** The canvases that still hold pixels above the window by more than the near range and a tile, in one sample taken at the scroll's end. */
export function releasedProblems(s: Sample): string[] {
  return s.canvases.filter((c) => holdsPixels(c) && c.bottom < -OUTSIDE_PX).map((c) => `a ${c.w}x${c.h} canvas still holds pixels at ${Math.round(c.top)} to ${Math.round(c.bottom)} px, above the window by more than ${OUTSIDE_PX}`);
}

/* ---- The page. ---- */

const STORY = (id: string) => `/?fixture=boards&story=${id}`;

/** The screen (size, density, touch) is the describe's `test.use`. */
async function open(page: Page, id: string): Promise<void> {
  await page.addInitScript(`window.__kbSample = ${readFrame.toString()};`);
  await page.goto(STORY(id));
  await expect.poll(() => page.evaluate(() => Boolean(window.__kbTiles) && Boolean(document.querySelector('#post-43 .kb-act-main')))).toBe(true);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  /* The post's height is settled before a scroll is planned from it. */
  await page.evaluate(() => new Promise<void>((done) => {
    const read = () => `${document.documentElement.scrollHeight}`;
    let prev = read(), same = 0;
    const tick = () => { const now = read(); same = now === prev ? same + 1 : 0; prev = now; if (same >= 20) done(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
}

/** Reads one frame of the post, in the page (handed over before the page loads, as `window.__kbSample`): the same code runs in every frame of a scroll and at its end. */
const readFrame = () => {
  /* The post's row, which holds its content area and a layer a card that fills the row draws in (Hot Box's smoke, `.kb-row-layer`: docs/plans/2026-11-27-season-two-cards-design.md, section 7): a canvas of either is the post's. */
  const main = document.querySelector<HTMLElement>('#post-43 .kb-act-grid')!;
  const canvases = [...main.querySelectorAll<HTMLCanvasElement>('canvas')].map((c) => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, cw: r.width, ch: r.height, top: r.top, bottom: r.bottom, left: r.left };
  });
  const bands = [...main.querySelectorAll<HTMLElement>('.kb-band')].map((b) => {
    const r = b.getBoundingClientRect();
    let next = b.nextElementSibling, canvas = false;
    /* A tile's canvases follow its stand-in (engine/ui/cards/tiles.ts `make`). */
    while (next instanceof HTMLCanvasElement) { if (next.width > 0 && next.height > 0) canvas = true; next = next.nextElementSibling; }
    return { top: r.top, bottom: r.bottom, tile: b.getAttribute('data-kb-tile'), background: getComputedStyle(b).backgroundColor, canvas };
  });
  return { vh: window.innerHeight, dpr: window.devicePixelRatio, canvases, bands };
};
type PageSample = () => Omit<Sample, 't'>;

/**
 * Scrolls from `SCROLL_MARGIN` above the post's words to `SCROLL_MARGIN` past their bottom over `SCROLL_MS`, sampling every animation frame, and
 * returns the loop's own time in the frames it ran. The scroll's end is the post's, so that "at the bottom" has a post top to have released.
 */
async function scrollRun(page: Page): Promise<Run> {
  const run = await page.evaluate(async ({ ms, margin, maxStep }) => {
    const main = document.querySelector<HTMLElement>('#post-43 .kb-act-main')!;
    const top = main.getBoundingClientRect().top + window.scrollY, bottom = main.getBoundingClientRect().bottom + window.scrollY;
    const from = Math.max(0, top - margin), to = Math.min(document.documentElement.scrollHeight - window.innerHeight, Math.max(from + 1, bottom - window.innerHeight + margin));
    window.scrollTo(0, from);
    await new Promise<void>((done) => { let n = 20; const wait = () => (--n <= 0 ? done() : requestAnimationFrame(wait)); requestAnimationFrame(wait); });
    const kb = window.__kbTiles!, f0 = kb.frames();
    return new Promise<Run>((done) => {
      const out: Sample[] = [];
      /* The scroll's clock is the frames', not the wall's: a frame moves it by at most `maxStep` ms of scroll, so a machine that draws 8 frames a second scrolls as far in each as one that draws 30 and
         takes longer over the whole, and the checks measure the layer and not how starved the runner is (on a 2-core runner with a second worker, a 3 s scroll of 9,700 px moved the window 400 px a
         frame, and a tile 800 to 1,660 px above it, the layer's release a frame or two behind, was named as a leak: the same failure, in Hot Box and Steel Chair alike, on main as on the branch). */
      let last = 0, spent = 0;
      const tick = (t: number) => {
        spent += Math.min(last === 0 ? 0 : t - last, maxStep);
        last = t;
        out.push({ t, ...(window as unknown as { __kbSample: PageSample }).__kbSample() });
        const p = Math.min(1, spent / ms);
        window.scrollTo(0, from + p * (to - from));
        if (p < 1) { requestAnimationFrame(tick); return; }
        done({ samples: out, work: kb.work(kb.frames() - f0), post: bottom - top, from, to });
      };
      requestAnimationFrame(tick);
    });
  }, { ms: SCROLL_MS, margin: SCROLL_MARGIN, maxStep: MAX_STEP_MS });
  return run;
}

/**
 * The fling: from wherever the scroll ended, the window is thrown to the post's middle, to near its end and back to its top, and each of the next
 * `JUMP_FRAMES` animation frames after each throw is sampled (the first is the frame the jump is first drawn in, before the layer has been told).
 */
async function jumpRun(page: Page): Promise<Sample[]> {
  return page.evaluate(async ({ frames }) => {
    const main = document.querySelector<HTMLElement>('#post-43 .kb-act-main')!;
    const top = main.getBoundingClientRect().top + window.scrollY, bottom = main.getBoundingClientRect().bottom + window.scrollY;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    const stops: [string, number][] = [
      ['jump to the middle', Math.min(room, Math.max(0, (top + bottom) / 2 - window.innerHeight / 2))],
      ['jump to near the end', Math.min(room, Math.max(0, bottom - window.innerHeight))],
      ['jump back to the top', Math.max(0, top - 150)],
    ];
    const out: Sample[] = [];
    for (const [label, y] of stops) {
      window.scrollTo(0, y);
      for (let i = 0; i < frames; i += 1) {
        const t = await new Promise<number>((next) => requestAnimationFrame(next));
        out.push({ t, label: `${label}, frame ${i}`, ...(window as unknown as { __kbSample: PageSample }).__kbSample() });
      }
    }
    return out;
  }, { frames: JUMP_FRAMES });
}

/** The scroll's end, after a few frames for the layer to learn it (the observer reports after the frame that scrolled). */
async function atTheBottom(page: Page): Promise<Sample> {
  await page.evaluate(() => new Promise<void>((done) => { let n = 10; const tick = () => (--n <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
  return page.evaluate(() => ({ t: 0, ...(window as unknown as { __kbSample: PageSample }).__kbSample() }));
}

/** A timed run's figures: the 95th percentile of the loop's own time in a frame, and of the gap between animation frames (logged, not asserted). */
function measure(r: Run) {
  const gaps = r.samples.slice(1).map((s, k) => s.t - r.samples[k]!.t);
  const some = r.work.length > 0, gapped = gaps.length > 0;
  return {
    own: some ? percentile(r.work, 0.95) : Infinity, ownMax: some ? Math.max(...r.work) : Infinity,
    gap: gapped ? percentile(gaps, 0.95) : NaN, median: gapped ? percentile(gaps, 0.5) : NaN, frames: r.samples.length, loopFrames: r.work.length,
  };
}
/** A run that gave the loop too few frames to measure, or whose own time is at or over the budget: for the slow poison, either is a miss of the budget (the loop was that slow). */
export const missed = (m: ReturnType<typeof measure>): boolean => m.loopFrames < MIN_LOOP_FRAMES || m.own >= OWN_BUDGET;
const figures = (m: ReturnType<typeof measure>) => `${m.frames} frames, loop ${m.loopFrames} frames, own time p95 ${m.own.toFixed(2)} ms (max ${m.ownMax.toFixed(2)}), gap p95 ${m.gap.toFixed(1)} ms, median ${m.median.toFixed(1)} ms`;

test.describe('the planted samples, red where they should be', () => {
  const canvas = (top: number, over: Partial<CanvasSample> = {}): CanvasSample => ({ w: 1200, h: 1024, cw: 600, ch: 512, top, bottom: top + 512, left: 0, ...over });
  const frame = (canvases: CanvasSample[], bands: BandSample[] = [], over: Partial<Sample> = {}): Sample => ({ t: 0, vh: 900, dpr: 2, canvases, bands, ...over });
  test('the tiles of a layer near the window are within the pixels, and one over the figure, one far away or one too many are each named', () => {
    expect(pixelProblems([frame([canvas(0), canvas(512), canvas(1024)])], 1)).toEqual([]);
    expect(pixelProblems([frame([canvas(0, { w: 1200, h: 6000, cw: 1200, ch: 3000, bottom: 3000 })])], 1).join()).toContain('1200x6000 canvas holds 7200000 px');
    expect(pixelProblems([frame([canvas(-2000, { bottom: -1488 })])], 1)[0]).toContain('outside a window 900 tall');
    expect(pixelProblems([frame(Array.from({ length: 12 }, (_, i) => canvas(i * 512)))], 1).join()).toContain('canvases hold pixels, over the');
  });
  test('a sheet is declared, so a second canvas at a place is named for a one-sheet effect and is room for a two-sheet one', () => {
    const stacked = frame([canvas(0), canvas(0), canvas(512)]);
    expect(pixelProblems([stacked], 1).join()).toContain('2 canvases with pixels at the place 0:0 (left:top), over the 1 sheet the story declares');
    expect(pixelProblems([stacked], 2)).toEqual([]);
    /* A two-sheet effect's most tiles pass, and no more. */
    expect(pixelProblems([frame(Array.from({ length: 2 * mostTiles(900) }, (_, i) => canvas(Math.floor(i / 2) * 512)))], 2)).toEqual([]);
    expect(pixelProblems([frame(Array.from({ length: 2 * mostTiles(900) + 1 }, (_, i) => canvas(Math.floor(i / 2) * 512)))], 2)).not.toEqual([]);
  });
  test('a canvas drawn denser than the cap per CSS px is named, whatever the screen, and a layer that never draws at the cap on a dense screen is named', () => {
    const dense = canvas(0, { w: 1800, h: 1536, cw: 600, ch: 512 });
    expect(pixelProblems([frame([dense], [], { dpr: 3 })], 1).join()).toContain('1800x1536 canvas is drawn denser than 2 per CSS px (its box is 600x512 CSS px, on a screen of 3)');
    expect(pixelProblems([frame([canvas(0, { cw: 600.25, w: 1201 })], [], { dpr: 3 })], 1)).toEqual([]);
    expect(densityProblems([frame([canvas(0)], [], { dpr: 3 })])).toEqual([]);
    expect(densityProblems([frame([canvas(0, { w: 600, h: 512 })], [], { dpr: 3 })]).join()).toContain('the density cap was never in play');
    expect(densityProblems([frame([canvas(0)], [], { dpr: 1 })]).join()).toContain('no frame was taken on a screen as dense as the cap');
  });
  test('a canvas sized to 0 by 0 holds nothing, wherever it lies', () => {
    expect(pixelProblems([frame([canvas(-5000, { w: 0, h: 0, bottom: -4488 })])], 1)).toEqual([]);
    expect(releasedProblems(frame([canvas(-5000, { w: 0, h: 0, bottom: -4488 })]))).toEqual([]);
    expect(releasedProblems(frame([canvas(-5000, { bottom: -4488 })]))).toHaveLength(1);
  });
  test('a band in the window with no tile and no color is named, and a held one with a canvas, a far one with fog and one outside the window are not', () => {
    const band = (top: number, over: Partial<BandSample>): BandSample => ({ top, bottom: top + 512, tile: 'held', background: 'rgba(0, 0, 0, 0)', canvas: true, ...over });
    expect(bareProblems([frame([], [band(0, {}), band(512, { tile: 'far', canvas: false, background: 'rgba(255, 105, 180, 0.9)' }), band(5000, { tile: null, canvas: false })])])).toEqual([]);
    expect(bareProblems([frame([], [band(0, { canvas: false })])])).toHaveLength(1);
    expect(bareProblems([frame([], [band(0, { tile: 'far', canvas: false })])])).toHaveLength(1);
    expect(bareProblems([frame([], [band(0, { tile: null })])])).toHaveLength(1);
    /* A color with no alpha is no cover, whatever its channels. */
    for (const background of ['rgba(255, 105, 180, 0)', 'rgb(255 105 180 / 0)', 'color(srgb 1 0.41 0.7 / 0)', 'transparent', 'not a color']) {
      expect(bareProblems([frame([], [band(0, { tile: 'far', canvas: false, background })])]), background).toHaveLength(1);
    }
    for (const background of ['rgba(255, 105, 180, 0.5)', 'rgb(255, 105, 180)', 'rgb(255 105 180 / 50%)', 'color(srgb 1 0.41 0.7 / 0.5)', 'color(srgb 1 0.41 0.7)']) {
      expect(bareProblems([frame([], [band(0, { tile: 'far', canvas: false, background })])]), background).toEqual([]);
    }
  });
  test('a jump sample names its jump and frame, and a held band with a canvas in the window is what the live scroll must have seen', () => {
    const bare: BandSample = { top: 0, bottom: 512, tile: 'far', background: 'rgba(0, 0, 0, 0)', canvas: false };
    expect(bareProblems([frame([], [bare], { label: 'jump to the middle, frame 2' })])[0]).toContain('jump to the middle, frame 2: band 0');
    expect(sawHeld([frame([], [{ ...bare, tile: 'held', canvas: true }])])).toBe(true);
    expect(sawHeld([frame([], [{ ...bare, tile: 'held', canvas: false }]), frame([], [{ ...bare, top: 5000, bottom: 5512, tile: 'held', canvas: true }])])).toBe(false);
  });
  test('a run with too few loop frames, or an own time at the budget, is a miss; a run of enough frames under the budget is not', () => {
    const run = (work: number[]): Run => ({ samples: [], work, post: 0, from: 0, to: 0 });
    expect(missed(measure(run([])))).toBe(true);
    expect(missed(measure(run(Array.from({ length: MIN_LOOP_FRAMES - 1 }, () => 1))))).toBe(true);
    expect(missed(measure(run(Array.from({ length: MIN_LOOP_FRAMES }, () => OWN_BUDGET))))).toBe(true);
    expect(missed(measure(run(Array.from({ length: MIN_LOOP_FRAMES }, () => 1))))).toBe(false);
  });
  test('the tags give a story its sheets: one tag with a positive whole number, and none or two give none', () => {
    expect(declaredSheets(['effect-budget', 'effect-sheets-2'])).toBe(2);
    expect(declaredSheets(['effect-budget'])).toBeUndefined();
    expect(declaredSheets(['effect-sheets-1', 'effect-sheets-2'])).toBeUndefined();
    expect(declaredSheets(['effect-sheets-0'])).toBeUndefined();
  });
  test('the tags give a story its density: one tag with a positive number up to the cap, and none, two, zero, over the cap or not a number give none', () => {
    expect(declaredDensity(['effect-budget', 'effect-density-1'])).toBe(1);
    expect(declaredDensity([`effect-density-${MAX_TILE_DENSITY}`])).toBe(MAX_TILE_DENSITY);
    expect(declaredDensity(['effect-density-1.5'])).toBe(1.5);
    expect(declaredDensity(['effect-budget'])).toBeUndefined();
    expect(declaredDensity(['effect-density-1', 'effect-density-2'])).toBeUndefined();
    expect(declaredDensity(['effect-density-0'])).toBeUndefined();
    expect(declaredDensity([`effect-density-${MAX_TILE_DENSITY + 1}`])).toBeUndefined();
    expect(declaredDensity(['effect-density-fast'])).toBeUndefined();
  });
  test('an effect that asks for a density is held to it: a canvas at the ask passes, one at the cap or none with pixels is named, and no ask is the cap as before', () => {
    const ask1 = canvas(0, { w: 600, h: 512 });
    expect(densityProblems([frame([ask1], [], { dpr: 3 })], 1)).toEqual([]);
    expect(densityProblems([frame([canvas(0)], [], { dpr: 3 })], 1).join()).toContain('denser than the 1 per CSS px the effect asks for');
    expect(densityProblems([frame([ask1, canvas(512)], [], { dpr: 3 })], 1).join()).toContain('denser than the 1 per CSS px the effect asks for');
    expect(densityProblems([frame([canvas(0, { w: 0, h: 0 })], [], { dpr: 3 })], 1).join()).toContain('was never in play');
    expect(densityProblems([frame([], [], { dpr: 3 })], 1).join()).toContain('was never in play');
    expect(densityProblems([frame([ask1], [], { dpr: 1 })], 1).join()).toContain('no frame was taken on a screen as dense as the cap');
    /* No ask: the three assertions above are unchanged. */
    expect(densityProblems([frame([canvas(0)], [], { dpr: 3 })], undefined)).toEqual([]);
    expect(densityProblems([frame([ask1], [], { dpr: 3 })], undefined).join()).toContain('the density cap was never in play');
  });
});

/* The two screens are under one serial describe: the config runs tests of a file on every worker (fullyParallel), and a timing test
   that shared the machine with another would be measured against it (e2e/shine.spec.ts's block is serial for the same reason). */
test.describe('the tile layer\'s frames and pixels', () => {
  test.describe.configure({ mode: 'serial' });

  test('the budget stories are the ones the story files tag, each declares its sheets, and the poisons are there', () => {
    expect(BUDGET_STORIES, 'a budget story for each effect on the layer').toContain('boards-25-effect-budget--hot-box');
    expect(POISONS).toEqual(expect.arrayContaining([SLOW_POISON, WHOLE_POISON]));
    expect([...HIDING_STORIES].filter((id) => !BUDGET_STORIES.includes(id)), 'a story that hides words is a budget story').toEqual([]);
    expect(BUDGET_STORIES.filter((id) => declaredSheets(TAGS.get(id)!) === undefined), 'a budget story declares its effect\'s sheets with one tag, effect-sheets-N').toEqual([]);
  });

  for (const [size, screen] of Object.entries(SIZES) as [keyof typeof SIZES, (typeof SIZES)[keyof typeof SIZES]][]) {
    test.describe(`${size} (${screen.width} by ${screen.height} CSS px at a device scale factor of ${screen.dpr}${screen.touch ? ', a touch phone' : ''})`, () => {
      test.use({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: screen.dpr, hasTouch: screen.touch, isMobile: screen.touch });

      for (const id of BUDGET_STORIES) {
        test(`${id}: no canvas is over the figure, too dense or far from the window at any frame, the loop's own time is under ${OWN_BUDGET} ms, no band is bare, and the top's tiles are released at the bottom`, async ({ page }) => {
          /* A warm-up and up to three timed runs at about four seconds each, with the page's opening. */
          test.setTimeout(120_000);
          const sheets = declaredSheets(TAGS.get(id)!) ?? 1;
          await open(page, id);
          const runs: ReturnType<typeof measure>[] = [];
          for (let attempt = 0; attempt < 4 && !runs.slice(1).some((m) => m.own < OWN_BUDGET); attempt += 1) {
            const run = await scrollRun(page);
            const m = measure(run);
            runs.push(m);
            console.log(`${id} ${size} ${attempt === 0 ? 'warm-up' : `timed run ${attempt}`}: ${figures(m)}`);
            const seen = [...new Set(run.samples.flatMap((s) => s.canvases.filter(holdsPixels).map((c) => `${c.w}x${c.h}`)))];
            console.log(`${id} ${size} run ${attempt}: canvases seen ${seen.join(', ')}; post ${Math.round(run.post)} CSS px, scroll ${Math.round(run.from)} to ${Math.round(run.to)}`);
            const vh = run.samples[0]!.vh;
            expect(run.samples[0]!.dpr, 'the screen is as dense as it was set to be').toBe(screen.dpr);
            expect(run.post, `the post is taller than the window and both of its margins (${vh} + 2 * ${OUTSIDE_PX} CSS px), or the outside and released checks have nothing to refuse`).toBeGreaterThan(vh + 2 * OUTSIDE_PX);
            expect(run.to, 'the scroll goes downward').toBeGreaterThan(run.from);
            expect(m.loopFrames, `TRIPWIRE: the tile loop ran ${m.loopFrames} frames in the scroll, under the ${MIN_LOOP_FRAMES} this spec needs to measure its own time: the machine is too slow for this spec, which is not a miss of the ${OWN_BUDGET} ms budget`).toBeGreaterThanOrEqual(MIN_LOOP_FRAMES);
            expect(run.samples.length, `the scroll was sampled in at least ${MIN_SAMPLES} animation frames`).toBeGreaterThanOrEqual(MIN_SAMPLES);
            expect(run.samples.some((s) => s.canvases.some(holdsPixels)), 'a canvas held pixels during the scroll (the pixel check can see one)').toBe(true);
            /* Pixels, in every run, warm-up too: the first scroll is the likeliest to show a canvas the layer should not hold. */
            expect(pixelProblems(run.samples, sheets), `pixels held, ${id} ${size}, run ${attempt}`).toEqual([]);
            expect(densityProblems(run.samples, declaredDensity(TAGS.get(id)!)), `density, ${id} ${size}, run ${attempt}`).toEqual([]);
            if (HIDING_STORIES.has(id)) {
              expect(run.samples.some((s) => s.bands.length > 0), 'the post has bands (the never-bare check can see one)').toBe(true);
              expect(sawHeld(run.samples), 'some frame had a band in the window held with a canvas (the held branch of the never-bare check is exercised)').toBe(true);
              expect(bareProblems(run.samples), `a band bare, ${id} ${size}, run ${attempt}`).toEqual([]);
            }
          }
          const timed = runs.slice(1);
          const met = timed.findIndex((m) => m.own < OWN_BUDGET);
          console.log(`${id} ${size}: own time p95 of the timed runs ${timed.map((m) => m.own.toFixed(2)).join(', ')} ms (budget ${OWN_BUDGET}); gap p95 ${timed.map((m) => m.gap.toFixed(1)).join(', ')} ms (logged, not asserted, #318); ${met >= 0 ? `timed run ${met + 1} met the budget` : 'no timed run met the budget'}`);
          expect(Math.min(...timed.map((m) => m.own)), `the tile loop's own time in a frame, 95th percentile, under ${OWN_BUDGET} ms`).toBeLessThan(OWN_BUDGET);

          const end = await atTheBottom(page);
          expect(releasedProblems(end), 'the tiles of the post\'s top are released at the bottom').toEqual([]);
          expect(end.canvases.filter(holdsPixels).length, 'and the tiles of its bottom are held').toBeGreaterThan(0);
          if (HIDING_STORIES.has(id)) {
            const jumps = await jumpRun(page);
            console.log(`${id} ${size}: jump run, ${jumps.length} frames; held bands with a canvas in the window ${jumps.filter((s) => sawHeld([s])).length}, bands in the window ${jumps.reduce((n, s) => n + s.bands.filter((b) => inWindow(b, s.vh)).length, 0)}`);
            expect(jumps.length, 'every frame of every jump was sampled').toBe(3 * JUMP_FRAMES);
            expect(bareProblems(jumps), `a band bare after a jump, ${id} ${size}`).toEqual([]);
          }
        });
      }

      test('poisoned: a painter that takes 25 ms turns the own-time check red in every run', async ({ page }) => {
        test.setTimeout(120_000);
        await open(page, SLOW_POISON);
        const timed: ReturnType<typeof measure>[] = [];
        await scrollRun(page);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const m = measure(await scrollRun(page));
          timed.push(m);
          console.log(`poisoned slow ${size} timed run ${attempt + 1}: ${figures(m)} (budget ${OWN_BUDGET})`);
        }
        /* A run that gave the loop too few frames to measure is as slow a loop as there is: a miss. */
        for (const [k, m] of timed.entries()) expect(missed(m), `timed run ${k + 1} misses the budget (own time p95 ${m.own.toFixed(2)} ms over ${m.loopFrames} loop frames)`).toBe(true);
      });

      test('poisoned: one canvas the size of the post turns the pixel check red, and names its size', async ({ page }) => {
        test.setTimeout(60_000);
        await open(page, WHOLE_POISON);
        const run = await scrollRun(page);
        const whole = run.samples.flatMap((s) => s.canvases).reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a));
        const problems = pixelProblems(run.samples, 1);
        console.log(`poisoned whole ${size}: ${problems.length} problems; first: ${problems[0] ?? 'none'}`);
        expect(problems.length, 'the pixel check is red').toBeGreaterThan(0);
        expect(problems.join('\n'), 'and names the canvas by its size').toContain(`a ${whole.w}x${whole.h} canvas holds ${whole.w * whole.h} px`);
        expect(whole.w * whole.h, 'it is over the figure').toBeGreaterThan(MAX_TILE_PIXELS);
      });
    });
  }
});
