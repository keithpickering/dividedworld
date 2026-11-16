import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { storyNameFromExport, toId } from 'storybook/internal/csf';
import { boardStoryIds, instanceUis } from './board-stories.ts';
import { MAX_TILE_PIXELS, TILE_NEAR_PX, TILE_PX, mostTiles } from '../engine/ui/cards/tiles.ts';

/**
 * The tile layer's frames and pixels, as Chromium runs them (docs/plans/2026-11-16-effect-tiles-design.md, section 6, guard 3; the plan,
 * docs/plans/2026-11-16-effect-tiles-step-1-plan.md, Task 7). One story for each effect on the layer
 * (instances/divided-world/ui/EffectBudget.board.stories.tsx), a post of the longest length the instance allows, scrolled from just above
 * its top to just past its bottom in three seconds, in the two sizes the game is played at (`SIZES`: the desktop's and a phone's; the config has
 * no projects, each spec sets its own size as e2e/a11y.spec.ts does). In each:
 *
 * - Pixels. Every frame of the scroll is sampled in the page (`scrollRun`): every canvas under the post's `.kb-act-main` holds at most
 *   `MAX_TILE_PIXELS` canvas px; the canvases that hold any number at most `mostTiles(window height)` times the layer's sheets; none that holds any
 *   lies more than `TILE_NEAR_PX` plus one tile (`TILE_PX`) outside the window. A tile's sheets are the canvases that share its place in the post, and
 *   the most that share one is read from the frame (a layer's sheets are not in the page): a layer that leaks tiles has them at places of their own,
 *   so it is counted as the tiles it holds. A canvas holds pixels where its width and height are not 0 (a layer frees one by sizing it to 0 by 0).
 * - Own time. The 95th percentile of the tile loop's own time in a frame (engine/ui/cards/tileLoop.ts `probe.work`, the loop's step timed on the
 *   page's own clock) is under `OWN_BUDGET`, half a 16.7 ms frame, leaving the rest to the page. As e2e/shine.spec.ts does it: a warm-up run that
 *   is not timed (the script compiled, the first tiles made), then up to three timed runs, and one must meet the budget. Every run's figures and
 *   the gap between frames are logged; the gap is not asserted (issue #318: on a software-drawn Chromium it misses for the runner's load, and the
 *   loop's own time is what sees the loop).
 * - Never bare (a story that hides words: it carries the tag `effect-hides-words`). In every sampled frame each band of the post that crosses the
 *   window is held, with a canvas that holds pixels, or far, with a background that is not transparent: a band is never the post's words with
 *   neither the tile nor its stand-in over them.
 * - At the bottom. With the scroll at its end the tiles of the post's top have been released: no canvas holds pixels more than `TILE_NEAR_PX` plus
 *   a tile above the window.
 *
 * Which stories are which is read from the story files' tags where Playwright collects its tests (`storiesTagged`), so a story added to the file is
 * run with no edit here: `effect-budget` is a budget story, `effect-poison` a poison. The poisons are for this spec to see its checks go red (a
 * check never red is not known to work): `PoisonSlow` makes a layer of its own whose painter takes 25 ms, which misses `OWN_BUDGET` in every run,
 * and `PoisonWhole` lays one canvas the size of the post body, which the pixel check refuses and names by its size. The checks themselves are plain
 * functions of the page's raw samples, and are tried on planted samples as well.
 */

/** The 95th percentile of the tile loop's own time in a frame, in ms: half of a 60 Hz frame. Measured here and on CI by the Task 7 runs (the PR holds the figures). */
const OWN_BUDGET = 8;
/** The window sizes: the desktop's, as e2e/shine.spec.ts runs it, and a phone's, as e2e/a11y.spec.ts does. */
const SIZES = { desktop: { width: 1200, height: 900 }, phone: { width: 390, height: 844 } } as const;
/** How long a scroll takes, in ms. */
const SCROLL_MS = 3000;
/** The scroll starts this far above the post's top and ends this far past its bottom, in CSS px. */
const SCROLL_MARGIN = 150;
/** A canvas that holds pixels may lie this far outside the window: the layer holds the tiles near the window, and an observer reports after the frame that scrolled. */
const OUTSIDE_PX = TILE_NEAR_PX + TILE_PX;
const SLOW_POISON = 'boards-25-effect-budget--poison-slow';
const WHOLE_POISON = 'boards-25-effect-budget--poison-whole';

interface CanvasSample { w: number; h: number; top: number; bottom: number; left: number }
interface BandSample { top: number; bottom: number; tile: string | null; background: string; canvas: boolean }
/** One animation frame of a scroll, read in the page: the window's height, every canvas under the post's words and every band of the post. */
interface Sample { t: number; vh: number; canvases: CanvasSample[]; bands: BandSample[] }
interface Run { samples: Sample[]; work: number[] }

/* ---- Which stories are which: the tags in the story files. ---- */

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const storyFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? storyFiles(p) : e.name.endsWith('.board.stories.tsx') ? [p] : [];
});

/** The ids of the board stories that carry `tag` in their `tags: [...]` (a story's export, up to the next export), by the id Storybook gives each. */
export function storiesTagged(tag: string, roots: readonly string[] = [path.join(REPO, 'engine', 'ui'), ...instanceUis(REPO)]): string[] {
  const all = new Set(boardStoryIds(roots));
  const found = roots.flatMap(storyFiles).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const title = /\bconst meta\b[^=]*=\s*\{[^}]*?\btitle:\s*(?:'([^']+)'|"([^"]+)")/.exec(text)?.slice(1).find(Boolean);
    if (!title) return [];
    return text.split(/^(?=export const )/m).flatMap((chunk) => {
      const name = /^export const (\w+)/.exec(chunk)?.[1];
      const tags = /\btags:\s*\[([^\]]*)\]/.exec(chunk)?.[1] ?? '';
      return name && [...tags.matchAll(/['"]([^'"]+)['"]/g)].some((m) => m[1] === tag) ? [toId(title, storyNameFromExport(name))] : [];
    });
  });
  return found.filter((id) => all.has(id)).sort();
}

const BUDGET_STORIES = storiesTagged('effect-budget');
const HIDING_STORIES = new Set(storiesTagged('effect-hides-words'));
const POISONS = storiesTagged('effect-poison');

/* ---- The checks, plain functions of the page's samples. ---- */

const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};
const holdsPixels = (c: CanvasSample) => c.w > 0 && c.h > 0;
const outside = (c: CanvasSample, vh: number) => c.bottom < -OUTSIDE_PX || c.top > vh + OUTSIDE_PX;

/** The sheets of a layer as the frame shows them: the most canvases holding pixels that share one place (the tile's own left and top) in the post. */
export function sheetsIn(canvases: readonly CanvasSample[]): number {
  const at = new Map<string, number>();
  for (const c of canvases) if (holdsPixels(c)) at.set(`${c.left}:${c.top}`, (at.get(`${c.left}:${c.top}`) ?? 0) + 1);
  return Math.max(1, ...at.values());
}

/** What the pixel check names in a run's samples, one line for each frame and canvas it refuses (at most a dozen are kept). */
export function pixelProblems(samples: readonly Sample[]): string[] {
  const out: string[] = [];
  samples.forEach((s, k) => {
    for (const c of s.canvases) {
      if (c.w * c.h > MAX_TILE_PIXELS) out.push(`frame ${k}: a ${c.w}x${c.h} canvas holds ${c.w * c.h} px, over the ${MAX_TILE_PIXELS} a tile may`);
      if (holdsPixels(c) && outside(c, s.vh)) out.push(`frame ${k}: a ${c.w}x${c.h} canvas holds pixels at ${Math.round(c.top)} to ${Math.round(c.bottom)} px, outside a window ${s.vh} tall by more than ${OUTSIDE_PX}`);
    }
    const holding = s.canvases.filter(holdsPixels).length, most = mostTiles(s.vh) * sheetsIn(s.canvases);
    if (holding > most) out.push(`frame ${k}: ${holding} canvases hold pixels, over the ${most} a window ${s.vh} tall is allowed (${mostTiles(s.vh)} tiles of ${sheetsIn(s.canvases)} sheets)`);
  });
  return out.slice(0, 12);
}

/** The bands of the post that cross the window in some frame with neither a tile that holds pixels nor a stand-in with a color. */
export function bareProblems(samples: readonly Sample[]): string[] {
  const out: string[] = [];
  samples.forEach((s, k) => {
    s.bands.forEach((b, i) => {
      if (!(b.bottom > 0 && b.top < s.vh)) return;
      const covered = (b.tile === 'held' && b.canvas) || (b.tile === 'far' && b.background !== 'rgba(0, 0, 0, 0)' && b.background !== 'transparent');
      if (!covered) out.push(`frame ${k}: band ${i} (${Math.round(b.top)} to ${Math.round(b.bottom)} px) is in the window with data-kb-tile ${b.tile ?? 'unset'}, ${b.canvas ? 'a canvas' : 'no canvas with pixels'}, background ${b.background}`);
    });
  });
  return out.slice(0, 12);
}

/** The canvases that still hold pixels above the window by more than the near range and a tile, in one sample taken at the scroll's end. */
export function releasedProblems(s: Sample): string[] {
  return s.canvases.filter((c) => holdsPixels(c) && c.bottom < -OUTSIDE_PX).map((c) => `a ${c.w}x${c.h} canvas still holds pixels at ${Math.round(c.top)} to ${Math.round(c.bottom)} px, above the window by more than ${OUTSIDE_PX}`);
}

/* ---- The page. ---- */

const STORY = (id: string) => `/?fixture=boards&story=${id}`;

async function open(page: Page, id: string, size: keyof typeof SIZES): Promise<void> {
  await page.setViewportSize(SIZES[size]);
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
  const main = document.querySelector<HTMLElement>('#post-43 .kb-act-main')!;
  const canvases = [...main.querySelectorAll<HTMLCanvasElement>('canvas')].map((c) => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, top: r.top, bottom: r.bottom, left: r.left };
  });
  const bands = [...main.querySelectorAll<HTMLElement>('.kb-band')].map((b) => {
    const r = b.getBoundingClientRect();
    let next = b.nextElementSibling, canvas = false;
    /* A tile's canvases follow its stand-in (engine/ui/cards/tiles.ts `make`). */
    while (next instanceof HTMLCanvasElement) { if (next.width > 0 && next.height > 0) canvas = true; next = next.nextElementSibling; }
    return { top: r.top, bottom: r.bottom, tile: b.getAttribute('data-kb-tile'), background: getComputedStyle(b).backgroundColor, canvas };
  });
  return { vh: window.innerHeight, canvases, bands };
};
type PageSample = () => Omit<Sample, 't'>;

/**
 * Scrolls from `SCROLL_MARGIN` above the post's words to `SCROLL_MARGIN` past their bottom over `SCROLL_MS`, sampling every animation frame, and
 * returns the loop's own time in the frames it ran. The scroll's end is the post's, so that "at the bottom" has a post top to have released.
 */
async function scrollRun(page: Page): Promise<Run> {
  const run = await page.evaluate(async ({ ms, margin }) => {
    const main = document.querySelector<HTMLElement>('#post-43 .kb-act-main')!;
    const top = main.getBoundingClientRect().top + window.scrollY, bottom = main.getBoundingClientRect().bottom + window.scrollY;
    const from = Math.max(0, top - margin), to = Math.min(document.documentElement.scrollHeight - window.innerHeight, Math.max(from + 1, bottom - window.innerHeight + margin));
    window.scrollTo(0, from);
    await new Promise<void>((done) => { let n = 20; const wait = () => (--n <= 0 ? done() : requestAnimationFrame(wait)); requestAnimationFrame(wait); });
    const kb = window.__kbTiles!, f0 = kb.frames();
    return new Promise<{ samples: Sample[]; work: number[] }>((done) => {
      const out: Sample[] = [];
      let t0 = 0;
      const tick = (t: number) => {
        t0 ||= t;
        out.push({ t, ...(window as unknown as { __kbSample: PageSample }).__kbSample() });
        const p = Math.min(1, (t - t0) / ms);
        window.scrollTo(0, from + p * (to - from));
        if (p < 1) { requestAnimationFrame(tick); return; }
        done({ samples: out, work: kb.work(kb.frames() - f0) });
      };
      requestAnimationFrame(tick);
    });
  }, { ms: SCROLL_MS, margin: SCROLL_MARGIN });
  return run;
}

/** The scroll's end, after a few frames for the layer to learn it (the observer reports after the frame that scrolled). */
async function atTheBottom(page: Page): Promise<Sample> {
  await page.evaluate(() => new Promise<void>((done) => { let n = 10; const tick = () => (--n <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
  return page.evaluate(() => ({ t: 0, ...(window as unknown as { __kbSample: PageSample }).__kbSample() }));
}

/** A timed run's figures: the 95th percentile of the loop's own time in a frame, and of the gap between animation frames (logged, not asserted). */
function measure(r: Run) {
  if (r.work.length < 20) throw new Error(`the tile loop ran ${r.work.length} frames in the scroll: its own time was not measured`);
  const gaps = r.samples.slice(1).map((s, k) => s.t - r.samples[k]!.t);
  return { own: percentile(r.work, 0.95), ownMax: Math.max(...r.work), gap: percentile(gaps, 0.95), median: percentile(gaps, 0.5), frames: r.samples.length, loopFrames: r.work.length };
}
const figures = (m: ReturnType<typeof measure>) => `${m.frames} frames, loop ${m.loopFrames} frames, own time p95 ${m.own.toFixed(2)} ms (max ${m.ownMax.toFixed(2)}), gap p95 ${m.gap.toFixed(1)} ms, median ${m.median.toFixed(1)} ms`;

test.describe('the planted samples, red where they should be', () => {
  const canvas = (top: number, over: Partial<CanvasSample> = {}): CanvasSample => ({ w: 1200, h: 1024, top, bottom: top + 512, left: 0, ...over });
  const frame = (canvases: CanvasSample[], bands: BandSample[] = []): Sample => ({ t: 0, vh: 900, canvases, bands });
  test('the tiles of a layer near the window are within the pixels, and one over the figure, one far away or one too many are each named', () => {
    expect(pixelProblems([frame([canvas(0), canvas(512), canvas(1024)])])).toEqual([]);
    expect(pixelProblems([frame([canvas(0, { w: 1200, h: 6000, bottom: 3000 })])]).join()).toContain('1200x6000 canvas holds 7200000 px');
    expect(pixelProblems([frame([canvas(-2000, { bottom: -1488 })])])[0]).toContain('outside a window 900 tall');
    expect(pixelProblems([frame(Array.from({ length: 12 }, (_, i) => canvas(i * 512)))]).join()).toContain('canvases hold pixels, over the');
    /* A tile's second sheet is the same place: the allowance is of sheets, so two sheets of the most tiles pass. */
    expect(pixelProblems([frame(Array.from({ length: 2 * mostTiles(900) }, (_, i) => canvas(Math.floor(i / 2) * 512)))])).toEqual([]);
  });
  test('a canvas sized to 0 by 0 holds nothing, wherever it lies', () => {
    expect(pixelProblems([frame([canvas(-5000, { w: 0, h: 0, bottom: -4488 })])])).toEqual([]);
    expect(releasedProblems(frame([canvas(-5000, { w: 0, h: 0, bottom: -4488 })]))).toEqual([]);
    expect(releasedProblems(frame([canvas(-5000, { bottom: -4488 })]))).toHaveLength(1);
  });
  test('a band in the window with no tile and no color is named, and a held one with a canvas, a far one with fog and one outside the window are not', () => {
    const band = (top: number, over: Partial<BandSample>): BandSample => ({ top, bottom: top + 512, tile: 'held', background: 'rgba(0, 0, 0, 0)', canvas: true, ...over });
    expect(bareProblems([frame([], [band(0, {}), band(512, { tile: 'far', canvas: false, background: 'rgba(255, 105, 180, 0.9)' }), band(5000, { tile: null, canvas: false })])])).toEqual([]);
    expect(bareProblems([frame([], [band(0, { canvas: false })])])).toHaveLength(1);
    expect(bareProblems([frame([], [band(0, { tile: 'far', canvas: false })])])).toHaveLength(1);
    expect(bareProblems([frame([], [band(0, { tile: null })])])).toHaveLength(1);
  });
});

for (const [size, viewport] of Object.entries(SIZES) as [keyof typeof SIZES, (typeof SIZES)[keyof typeof SIZES]][]) {
  test.describe(`the tile layer's frames and pixels, ${size} (${viewport.width} by ${viewport.height})`, () => {
    /* These tests time the page and the loop, so they run one after another in one worker (e2e/shine.spec.ts). */
    test.describe.configure({ mode: 'serial' });

    test('the budget stories are the ones the story files tag, and the poisons are there', () => {
      expect(BUDGET_STORIES, 'a budget story for each effect on the layer').toContain('boards-25-effect-budget--hot-box');
      expect(POISONS).toEqual(expect.arrayContaining([SLOW_POISON, WHOLE_POISON]));
      expect([...HIDING_STORIES].filter((id) => !BUDGET_STORIES.includes(id)), 'a story that hides words is a budget story').toEqual([]);
    });

    for (const id of BUDGET_STORIES) {
      test(`${id}: no canvas is over the figure or far from the window at any frame, the loop's own time is under ${OWN_BUDGET} ms, no band is bare, and the top's tiles are released at the bottom`, async ({ page }) => {
        /* A warm-up and up to three timed runs at about four seconds each, with the page's opening. */
        test.setTimeout(120_000);
        await open(page, id, size);
        const runs: ReturnType<typeof measure>[] = [];
        for (let attempt = 0; attempt < 4 && !runs.slice(1).some((m) => m.own < OWN_BUDGET); attempt += 1) {
          const run = await scrollRun(page);
          const m = measure(run);
          runs.push(m);
          console.log(`${id} ${size} ${attempt === 0 ? 'warm-up' : `timed run ${attempt}`}: ${figures(m)}`);
          expect(run.samples.length, 'the scroll was sampled all the way').toBeGreaterThan(60);
          expect(run.samples.some((s) => s.canvases.some(holdsPixels)), 'a canvas held pixels during the scroll (the pixel check can see one)').toBe(true);
          /* Pixels, in every run, warm-up too: the first scroll is the likeliest to show a canvas the layer should not hold. */
          expect(pixelProblems(run.samples), `pixels held, ${id} ${size}, run ${attempt}`).toEqual([]);
          if (HIDING_STORIES.has(id)) {
            expect(run.samples.some((s) => s.bands.length > 0), 'the post has bands (the never-bare check can see one)').toBe(true);
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
      });
    }

    test('poisoned: a painter that takes 25 ms turns the own-time check red in every run', async ({ page }) => {
      test.setTimeout(120_000);
      await open(page, SLOW_POISON, size);
      const timed: ReturnType<typeof measure>[] = [];
      await scrollRun(page);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const m = measure(await scrollRun(page));
        timed.push(m);
        console.log(`poisoned slow ${size} timed run ${attempt + 1}: ${figures(m)} (budget ${OWN_BUDGET})`);
      }
      for (const [k, m] of timed.entries()) expect(m.own, `timed run ${k + 1} misses the budget`).toBeGreaterThanOrEqual(OWN_BUDGET);
    });

    test('poisoned: one canvas the size of the post turns the pixel check red, and names its size', async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, WHOLE_POISON, size);
      const run = await scrollRun(page);
      const whole = run.samples.flatMap((s) => s.canvases).reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a));
      const problems = pixelProblems(run.samples);
      console.log(`poisoned whole ${size}: ${problems.length} problems; first: ${problems[0] ?? 'none'}`);
      expect(problems.length, 'the pixel check is red').toBeGreaterThan(0);
      expect(problems.join('\n'), 'and names the canvas by its size').toContain(`a ${whole.w}x${whole.h} canvas holds ${whole.w * whole.h} px`);
      expect(whole.w * whole.h, 'it is over the figure').toBeGreaterThan(MAX_TILE_PIXELS);
    });
  });
}
