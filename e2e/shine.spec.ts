import { expect, test, type Page } from '@playwright/test';

/**
 * The shine loop on a busy page, as Chromium runs it (docs/plans/2026-11-06-shine-plan.md, Task 11; the design's section 6): a thread of
 * seventeen posts, sixteen of them shiny (instances/divided-world/ui/Shine.board.stories.tsx), about five in view at 1200 x 900.
 * Scrolled top to bottom over three seconds with a moving mouse, the page keeps its frames (the 95th percentile of the gap between
 * animation frames is under 20 ms) and no shiny post fully out of view is drawn. At rest with shimmer a post whose painted body is no
 * bigger than its words is drawn on every second frame, about thirty a second, and a bigger one at its share of that (engine/ui/cards/
 * body.ts `paintShare`, issue #304); with every shiny post scrolled away the loop stops within three of its own frames (the observer's
 * word comes after the frame that scrolled, the loop's next frame finds nothing in view and stops); and under
 * reduced motion the loop runs no frame after the first draw.
 *
 * "Out of view" is read from the post's box against the viewport on every frame, in the page, and handed here as raw samples. The loop
 * learns of a post leaving from an IntersectionObserver, which delivers after the frame that scrolled it away, so a post may still be
 * drawn in the frame it was scrolled out in and the next one: a draw counts against the loop only when the post was fully out of view in
 * this sample and in the two before it (`LAG`). `outOfViewDraws` is checked on planted samples below, red where it should be.
 *
 * The frame gap sees the page, not the loop: a loop that costs 3 ms of a 16.7 ms frame passes it. So the loop's own time in each frame
 * (`probe.work`, around its step) is read too, and its 95th percentile bounded by `WORK_BUDGET`. And buffers out of view are released:
 * with the page scrolled to the bottom every shiny post fully out of view (beyond a margin) has canvases of width and height 0, and few
 * posts hold any. And what the canvases raster is counted (the story's `raster`, around the page's 2D contexts): a frame of the scroll
 * rasters under `RASTER_SHARE` of the shiny posts in view, the check a fast machine's frame gap cannot make. The story's poisons make those
 * checks red; the `poisoned` tests below run them and expect the red.
 *
 * A Feelin' Fab's foil is drawn in a worker, on a canvas the page handed over (engine/ui/shine/foilClient.ts); a Glitter Bomb's is drawn on
 * the page. So each instrument reads both threads, and the story hands them over (`window.__kbShine`, instances/divided-world/ui/
 * Shine.board.stories.tsx): the loop's own time is the page's, and the worker's own time per batch (`WORK_BUDGET` too: the worker keeps
 * the display's rate only if a frame's foils fit in a frame) is read from the worker; a Fab canvas's size is read from the worker (a
 * transferred canvas's own attributes say nothing); a frame's rastered pixels are the page's plus the worker's batch with the same `t`.
 * The poison `slow` (25 ms in every Glitter Bomb post's draw on the page), `slow-worker` (25 ms in every batch of the worker) and `keep` (one
 * Fab's canvas, in the worker, ignores being freed) make those checks red.
 *
 * And the screen the shine changes is counted (`redrawn`): a post paints its whole body, which is bigger than its words, and on a
 * software-composited page (CI's headless Chromium) a frame costs the screen area its draws change. Over the scroll, the on-screen area
 * of every post's draws, summed, stays within `REDRAWN_SHARE` of what its words' boxes would change were each drawn on every frame (the
 * rate a moving light draws a post with no body to paint). With the whole body redrawn on every frame (9e513e4, the head before issue
 * #304), it was about twice that, and the frame gap missed its bound on CI. `redrawn` is checked on planted samples below.
 *
 * And every timed run logs what it worked against, as one `shine-data` line of JSON, so a slow run can be told apart from a slow shine
 * and the shine's cost can be followed as posts grow taller and effects stack (issue #304): the scroll's distance and speed, the
 * shiny posts and canvases on screen and the share of the viewport those canvases cover (what a software compositor draws every frame
 * of a scroll, redrawn or not), the screen the draws changed, a fixed piece of work timed on the page's thread just before (how loaded
 * the machine was), and a control: the same scroll of the same page with every shine canvas hidden, so the loop draws nothing and
 * nothing of the shine is composited. A control that drops frames as the run did says the machine or the layout cost them, not the
 * shine. Nothing here is asserted; it is read from CI's log.
 *
 * Draws and frames are the loop's own, handed over by the story as `window.__kbShine`.
 */
const STORY = (name: string) => `/?fixture=boards&story=boards-15-shine--${name}`;
const SHINY = 16;
const LAG = 2;
/**
 * The 95th percentile of the loop's own time in a frame while the page scrolls, in ms. Measured here (software-drawn headless Chromium,
 * all sixteen posts, five in view) at 11.6 to 12.5 ms over eight timed runs while the foil's render did every cell's math each frame, and
 * at 3.9 to 4.4 ms once it precomputed what the light does not move (engine/ui/shine/foil.ts): most of the loop was that render. The
 * budget is under one 16.7 ms frame: a loop that costs more than a frame cannot keep its frames, and the 25 ms poisoned draw below is far
 * past it. The same budget is the foil worker's per batch: its work is a frame's draws, which must fit a frame for the foil to keep
 * the display's rate.
 */
const WORK_BUDGET = 16;
/**
 * CPU throttling for a run that stands in for a slower machine than this one (`KB_CPU_THROTTLE=2`: Chrome's throttling of the page's
 * main thread, which is how a busy scroll's cost the loop never sees was found); unset, none.
 */
const THROTTLE = Number(process.env.KB_CPU_THROTTLE ?? 1);
/**
 * What the canvases raster in a frame of the scroll, read by the story's counter around the page's 2D contexts. A fast machine's
 * frame gap cannot see this cost and the loop's own time never does: a 2D canvas's draws are rastered when the frame is produced,
 * outside the loop's step. At 37749ee every Feelin' Fab cleared its post-sized canvas and drew its grid scaled over it with 'high'
 * smoothing, every frame, and every Glitter Bomb cleared its own and filled all 4,200 flakes: on a slow machine (the CI runner's
 * software-drawn Chromium, or this one with its CPU throttled to half) the scroll lost a frame in two, with the loop's own time well
 * inside its budget. Measured here, CPU throttled x2 against the same page held still (16.7 ms): the gap's 95th percentile was 33.4 ms
 * in every run; a clear plus a bilinear draw, 33.3 in most; a bilinear draw alone, 16.8 in most; the 'high' draw alone, 33.4 in every
 * run. So two checks: no pixel is scaled at 'high' smoothing in a frame (37749ee: a post-sized canvas a Feelin' Fab), and the pixels
 * rastered a frame, as a share of the device-px area of the shiny posts in view, stay under `RASTER_SHARE` at the 95th percentile
 * (37749ee: median 1.8, 95th percentile 2.1; now median 0.9, 95th percentile 1.1, the Feelin' Fabs' one opaque draw each and little
 * else).
 */
const RASTER_SHARE = 1.5;
/** The on-screen area a scroll's draws change, over what the posts' words would change drawn on every frame: at most this. */
const REDRAWN_SHARE = 1.25;
/** Out of view "beyond a margin": a post this many px past the viewport's edge has freed its canvases. */
const FREED_MARGIN = 300;

interface Box1 { top: number; bottom: number; width: number }
interface Sample { t: number; draws: number[]; top: number[]; bottom: number[]; height: number; painted?: Box1[]; own?: Box1[]; layers?: number[]; scrollY?: number }
interface Held { top: number; bottom: number; area?: number; own?: number; sizes: { w: number; h: number }[]; shine?: { w: number; h: number }[] }

/** The shiny posts that hold canvas buffers while fully out of view by more than `margin`, and how many posts hold any at all. */
export function heldOutOfView(posts: readonly Held[], height: number, margin = FREED_MARGIN): { held: number[]; holding: number; inView: number } {
  const held: number[] = [];
  posts.forEach((p, i) => { if ((p.bottom < -margin || p.top > height + margin) && p.sizes.some((c) => c.w > 0 || c.h > 0)) held.push(i); });
  return { held, holding: posts.filter((p) => p.sizes.some((c) => c.w > 0 && c.h > 0)).length, inView: posts.filter((p) => p.bottom > 0 && p.top < height).length };
}

/** The frames in which a post's draw count rose while it had been fully out of view for this sample and the `LAG` before it. */
export function outOfViewDraws(samples: readonly Sample[], lag = LAG): { frame: number; host: number }[] {
  const bad: { frame: number; host: number }[] = [];
  const out = (s: Sample, h: number) => s.bottom[h]! < 0 || s.top[h]! > s.height;
  samples.forEach((s, k) => {
    if (k === 0) return;
    s.draws.forEach((d, h) => {
      if (d <= samples[k - 1]!.draws[h]!) return;
      let all = k >= lag;
      for (let j = 0; j <= lag && all; j += 1) all = out(samples[k - j]!, h);
      if (all) bad.push({ frame: k, host: h });
    });
  });
  return bad;
}

/** A box's area inside the viewport's rows, in CSS px squared. */
const onScreen = (b: Box1, height: number): number => Math.max(0, Math.min(b.bottom, height) - Math.max(b.top, 0)) * b.width;

/**
 * The screen the shine changed over a run: for each sample after the first, the on-screen area of each post drawn since the one before
 * (its painted box), summed; and what the words would have changed, every post in view drawn on every frame (its words' box). A host
 * drawn more than once between two samples counts each draw.
 */
export function redrawn(samples: readonly Sample[]): { changed: number; words: number } {
  let changed = 0, words = 0;
  samples.forEach((s, k) => {
    if (k === 0) return;
    s.draws.forEach((d, h) => {
      const drew = d - samples[k - 1]!.draws[h]!;
      if (drew > 0) changed += drew * onScreen(s.painted![h]!, s.height);
      words += onScreen(s.own![h]!, s.height);
    });
  });
  return { changed, words };
}

const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

/** Waits for the fonts and for the thread's first shiny post to stop changing size, so a late layout adds no draw to a count. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => new Promise<void>((done) => {
    const read = () => `${document.querySelectorAll('[data-kb-fab], [data-kb-glitter]').length}:${document.documentElement.scrollHeight}`;
    let prev = read(), same = 0;
    const tick = () => { const now = read(); same = now === prev ? same + 1 : 0; prev = now; if (same >= 20) done(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
}

async function open(page: Page, name: string, poison = ''): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 900 });
  if (THROTTLE > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  /* The app rewrites the address it is given, so the story's poison is handed over before the page loads, not in the query. */
  if (poison) await page.addInitScript((p) => { (window as { __kbPoison?: string }).__kbPoison = p; }, poison);
  await page.goto(STORY(name));
  await expect.poll(() => page.evaluate(() => window.__kbShine?.hosts().length ?? 0)).toBe(SHINY);
  await settle(page);
}

const hosts = (page: Page) => page.evaluate(() => window.__kbShine!.hosts());
const inView = (h: { top: number; bottom: number }, height = 900) => h.bottom > 0 && h.top < height;
/** Waits for a number of animation frames in the page. */
const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((count) => new Promise<void>((done) => { let left = count; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);

/** What the page reports of every shiny post's canvases: its box and the size of each canvas inside it (a worker's canvases read from the worker). */
const held = (page: Page): Promise<Held[]> => page.evaluate(() => window.__kbShine!.held());

interface Run { samples: Sample[]; work: number[]; workerWork: number[] }

/** Scrolls the page from the top to the bottom over three seconds under a moving mouse, sampling every frame, the loop's own time in the frames it ran and the foil worker's in the batches it drew. */
async function scrollRun(page: Page): Promise<Run> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const run = page.evaluate(async (ms) => {
    const kb = window.__kbShine!;
    const batches0 = (await kb.workerWork(0)).batches;
    return new Promise<Run>((done) => {
      const out: Sample[] = [], max = document.documentElement.scrollHeight - window.innerHeight, f0 = kb.frames();
      let t0 = 0;
      const tick = (t: number) => {
        t0 ||= t;
        const hs = kb.hosts();
        out.push({
          t, draws: hs.map((h) => h.draws), top: hs.map((h) => h.top), bottom: hs.map((h) => h.bottom), height: window.innerHeight,
          painted: hs.map((h) => ({ top: h.top, bottom: h.bottom, width: h.width })), own: hs.map((h) => h.own),
          layers: hs.map((h) => h.layers), scrollY: window.scrollY,
        });
        const p = Math.min(1, (t - t0) / ms);
        window.scrollTo(0, p * max);
        if (p < 1) { requestAnimationFrame(tick); return; }
        const work = kb.work(kb.frames() - f0);
        void kb.workerWork(600).then((w) => { const n = Math.min(600, w.batches - batches0); done({ samples: out, work, workerWork: w.work.slice(w.work.length - n) }); });
      };
      requestAnimationFrame(tick);
    });
  }, 3000);
  /* A moving mouse, over the page's width and height, while it scrolls. */
  for (let i = 0; i < 60; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
  return run;
}

/** A fixed piece of work on the page's thread, in ms: how loaded the machine is just now (the same page, the same work, every run). */
const calibrate = (page: Page): Promise<number> => page.evaluate(() => {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e6; i++) x += Math.sqrt(i) * Math.sin(i);
  (window as { __kbSink?: number }).__kbSink = x;
  return performance.now() - t0;
});

/**
 * The control: the same scroll with every shine canvas hidden (`display: none`, so none is composited and the loop, told they left
 * view, draws nothing), its frame gaps' 95th percentile and median and its frame count; the canvases are shown again after.
 */
async function controlRun(page: Page): Promise<{ gap: number; median: number; frames: number }> {
  await page.evaluate(() => { window.scrollTo(0, 0); for (const c of document.querySelectorAll<HTMLElement>('[data-kb-fab] canvas, [data-kb-glitter] canvas')) c.style.display = 'none'; });
  await page.waitForTimeout(500);
  const run = page.evaluate((ms) => new Promise<number[]>((done) => {
    const ts: number[] = [], max = document.documentElement.scrollHeight - window.innerHeight;
    let t0 = 0;
    const tick = (t: number) => {
      t0 ||= t;
      ts.push(t);
      const p = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, p * max);
      if (p < 1) requestAnimationFrame(tick); else done(ts);
    };
    requestAnimationFrame(tick);
  }), 3000);
  for (let i = 0; i < 60; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
  const ts = await run;
  await page.evaluate(() => { for (const c of document.querySelectorAll<HTMLElement>('[data-kb-fab] canvas, [data-kb-glitter] canvas')) c.style.display = ''; });
  const gaps = ts.slice(1).map((t, k) => t - ts[k]!);
  return { gap: percentile(gaps, 0.95), median: percentile(gaps, 0.5), frames: ts.length };
}

/** What a run worked against (the header's `shine-data`): means over its frames, the viewport's share in [0, 1]. */
function conditions(r: Run): Record<string, number> {
  const s = r.samples, n = s.length, vh = s[0]!.height, vw = 1200;
  let posts = 0, layers = 0, cover = 0;
  for (const f of s) {
    f.draws.forEach((_, h) => {
      const area = onScreen(f.painted![h]!, f.height);
      if (area <= 0) return;
      posts++;
      layers += f.layers![h]!;
      cover += area * f.layers![h]!;
    });
  }
  const scrolled = (s[n - 1]!.scrollY ?? 0) - (s[0]!.scrollY ?? 0);
  const red = redrawn(s);
  return {
    scrollPx: Math.round(scrolled), pxPerFrame: +(scrolled / Math.max(1, n - 1)).toFixed(1),
    postsInView: +(posts / n).toFixed(2), layersInView: +(layers / n).toFixed(2), layerCover: +(cover / n / (vw * vh)).toFixed(3),
    redrawn: +(red.changed / Math.max(1, red.words)).toFixed(3),
  };
}

/** A timed run's three measures: the 95th percentile of the gap between animation frames, of the loop's own time in a frame, and of the foil worker's own time in a batch. */
const measure = (r: Run) => {
  /* A worker that drew nothing would read as a cheap one: the run is refused, not passed. */
  if (r.workerWork.length < 60) throw new Error(`the foil worker drew ${r.workerWork.length} batches in the run: its time was not measured`);
  const gaps = r.samples.slice(1).map((s, k) => s.t - r.samples[k]!.t);
  return {
    gap: percentile(gaps, 0.95), median: percentile(gaps, 0.5), max: Math.max(...gaps), work: percentile(r.work, 0.95), worker: percentile(r.workerWork, 0.95),
    frames: r.samples.length, loopFrames: r.work.length, batches: r.workerWork.length,
  };
};
const GAP_BOUND = 20;
/** A timed run holds when its gaps hold; a run holds the loop when its own time does, and the worker when its own time per batch does. */
const holds = (m: { gap: number; work: number; worker: number }) => ({ gap: m.gap < GAP_BOUND, work: m.work < WORK_BUDGET, worker: m.worker < WORK_BUDGET });
const holdsAll = (m: { gap: number; work: number; worker: number }) => { const h = holds(m); return h.gap && h.work && h.worker; };

/**
 * A scroll like `scrollRun`'s with the canvas count on: each frame's rastered pixels (the page's plus the worker's batch with the same `t`)
 * over the device-px area of the shiny posts in view, and those scaled at 'high'. `matched` is how many frames had a worker batch, and
 * `workerPx` what the worker rastered in them: a count that never reaches the worker would pass every bound, so the test asks for both.
 */
async function rasterRun(page: Page): Promise<{ frames: { share: number; high: number }[]; matched: number; workerPx: number }> {
  await page.evaluate(() => { window.scrollTo(0, 0); window.__kbShine!.raster.start(); });
  await page.waitForTimeout(500);
  const run = page.evaluate((ms) => new Promise<{ frames: { share: number; high: number }[]; matched: number; workerPx: number }>((done) => {
    const kb = window.__kbShine!, seen: { t: number; px: number; high: number; area: number }[] = [], max = document.documentElement.scrollHeight - window.innerHeight;
    let t0 = 0;
    kb.raster.take();
    const tick = (t: number) => {
      t0 ||= t;
      const area = kb.hosts().filter((h) => h.bottom > 0 && h.top < window.innerHeight).reduce((a, h) => a + h.area, 0);
      const r = kb.raster.take();
      if (area > 0) seen.push({ t, px: r.px, high: r.high, area });
      const p = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, p * max);
      if (p < 1) { requestAnimationFrame(tick); return; }
      void kb.raster.worker().then((batches) => {
        kb.raster.stop();
        const by = new Map(batches.map((b) => [b.t, b]));
        let matched = 0, workerPx = 0;
        const frames = seen.map((f) => {
          const w = by.get(f.t);
          if (w) { matched++; workerPx += w.px; }
          return { share: (f.px + (w?.px ?? 0)) / f.area, high: f.high + (w?.high ?? 0) };
        });
        done({ frames, matched, workerPx });
      });
    };
    requestAnimationFrame(tick);
  }), 3000);
  for (let i = 0; i < 60; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
  return run;
}

test.describe('the planted samples, red where they should be', () => {
  const frame = (draws: number[], top: number[], bottom = top.map((t) => t + 100)): Sample => ({ t: 0, draws, top, bottom, height: 900 });
  test('a post drawn while fully out of view is named', () => {
    const away = [2000], seq: Sample[] = [];
    for (let k = 0; k < 6; k += 1) seq.push(frame([k + 1], away));
    expect(outOfViewDraws(seq)).toEqual([{ frame: 2, host: 0 }, { frame: 3, host: 0 }, { frame: 4, host: 0 }, { frame: 5, host: 0 }]);
  });
  test('a draw after exactly LAG samples out of view is the loop\'s lag; one more sample out and it is named', () => {
    const away = [2000];
    /* In view, then out for LAG samples (indexes 1 and 2), drawn at the second of them: not named. */
    const lagged = [frame([1], [500]), frame([1], away), frame([2], away)];
    expect(outOfViewDraws(lagged)).toEqual([]);
    /* Out for LAG + 1 samples (indexes 1 to 3), drawn at the last: named. */
    const late = [frame([1], [500]), frame([1], away), frame([1], away), frame([2], away)];
    expect(outOfViewDraws(late)).toEqual([{ frame: 3, host: 0 }]);
  });
  test('a post out of view that still holds a buffer is named, and one in view or near the edge is not', () => {
    const post = (top: number, w: number, h = w) => ({ top, bottom: top + 100, sizes: [{ w, h }] });
    expect(heldOutOfView([post(2000, 300), post(2000, 0), post(100, 300), post(1100, 300), post(-500, 300, 0)], 900))
      .toEqual({ held: [0, 4], holding: 3, inView: 1 });
  });
  test('a post whose body is twice its words, drawn on every frame, changes twice the screen they would: over the bound', () => {
    const box = (top: number, h: number): Box1 => ({ top, bottom: top + h, width: 100 });
    const seq = (every: number): Sample[] => Array.from({ length: 41 }, (_, k) => ({
      t: k * 16, draws: [Math.floor(k / every)], top: [100], bottom: [300], height: 900, painted: [box(100, 200)], own: [box(100, 100)],
    }));
    const full = redrawn(seq(1)), half = redrawn(seq(2));
    expect(full.changed / full.words).toBeCloseTo(2, 5);
    expect(full.changed / full.words).toBeGreaterThan(REDRAWN_SHARE);
    expect(half.changed / half.words).toBeCloseTo(1, 5);
    expect(half.changed / half.words).toBeLessThan(REDRAWN_SHARE);
  });
  test('only the part of a post on screen counts, and a post out of view counts for neither', () => {
    const s = (draws: number, top: number): Sample => ({ t: 0, draws: [draws], top: [top], bottom: [top + 400], height: 900, painted: [{ top, bottom: top + 400, width: 10 }], own: [{ top, bottom: top + 400, width: 10 }] });
    expect(redrawn([s(0, 700), s(1, 700)])).toEqual({ changed: 2000, words: 2000 });
    expect(redrawn([s(0, 2000), s(0, 2000)])).toEqual({ changed: 0, words: 0 });
  });
  test('the frames of the loop\'s lag, and a post in view, are not named', () => {
    const seq = [frame([1], [800]), frame([2], [950]), frame([3], [960]), frame([3], [970]), frame([3], [980]), frame([4], [100])];
    expect(outOfViewDraws(seq)).toEqual([]);
  });
});

/**
 * A post paints its whole body (engine/ui/cards/body.ts), but costs no more pixels for it: each canvas holds no more device pixels than
 * the post's own box (its words' element) at the page's density did, or, where the words are a line or two, the body at half that
 * density (`paintScale`'s floor). On CI the whole body at full density doubled the loop's and the foil worker's time and dropped frames.
 */
test('a shiny post\'s canvases hold no more pixels than its words\' box did at the page\'s density, or the body at half of it', async ({ page }) => {
  await open(page, 'full');
  const d = await page.evaluate(() => Math.min(2, window.devicePixelRatio || 1));
  /* The posts in view, which have drawn (one out of view may keep a canvas's 300 by 150 default until it is first drawn). */
  const posts = (await held(page)).filter((p) => inView(p) && p.shine!.some((c) => c.w > 0));
  expect(posts.length, 'posts in view hold their buffers').toBeGreaterThan(2);
  const over = posts.flatMap((p, i) => p.shine!.filter((c) => c.w * c.h > Math.max(p.own! * d * d, p.area! * (d / 2) ** 2) * 1.05 + 4 * (c.w + c.h))
    .map((c) => `post ${i}: a ${c.w}x${c.h} canvas, its words ${Math.round(p.own!)} px squared, its body ${Math.round(p.area!)}`));
  expect(over).toEqual([]);
});

test.describe('a busy thread', () => {
  /* These tests time the page and the loop, so they run one after another in one worker: two of them in parallel on a software-drawn
     Chromium on few cores slow each other's frames and make the bound a measure of the machine. */
  test.describe.configure({ mode: 'serial' });

  test('scrolled top to bottom with a moving mouse, the loop is cheap, the frames hold, nothing out of view is drawn, and its buffers are freed', async ({ page }) => {
    /* Three tries at a timed run after a warm-up, at about seven seconds each. */
    test.setTimeout(120_000);
    await open(page, 'full');
    const first = await hosts(page);
    const visible = first.filter((h) => inView(h)).length;
    expect(visible, 'about five shiny posts in view').toBeGreaterThanOrEqual(3);
    expect(visible).toBeLessThanOrEqual(8);
    expect(heldOutOfView(await held(page), 900).holding, 'at the top the posts in view hold their buffers (the buffer check can see one)').toBeGreaterThanOrEqual(visible);
    /* The first run down the page is a warm-up (the script compiled, each post's buffers and flakes made for the first time) and is not timed.
       A software-drawn headless Chromium drops a frame now and then, and a gap is a whole frame or two (16.7 or 33.3 ms), so one drop too many
       moves the 95th percentile from 16.8 to 33.3: the frame-gap bound is met if one of three timed runs meets it. Every run must draw nothing
       out of view. The loop's own time is the check that sees the loop (a loop that costs 3 ms of a frame passes the gap): its 95th percentile
       must be under WORK_BUDGET in a timed run too, and so must the foil worker's own time per batch (which the loop cannot see). A loop that
       costs more than a frame meets neither bound in any run. */
    const runs: ReturnType<typeof measure>[] = [];
    const data: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 4 && !runs.slice(1).some(holdsAll); attempt += 1) {
      const cpu = await calibrate(page);
      const run = await scrollRun(page), samples = run.samples;
      const m = measure(run);
      runs.push(m);
      if (attempt > 0) data.push({ run: attempt, cpuMs: +cpu.toFixed(1), gap: +m.gap.toFixed(1), median: +m.median.toFixed(1), frames: m.frames, loop: +m.work.toFixed(2), worker: +m.worker.toFixed(2), ...conditions(run) });
      console.log(`scroll ${attempt === 0 ? 'warm-up' : attempt}: ${m.frames} frames, gap p95 ${m.gap.toFixed(1)} ms, median ${m.median.toFixed(1)} ms, max ${m.max.toFixed(1)} ms; loop ${m.loopFrames} frames, own time p95 ${m.work.toFixed(2)} ms; worker ${m.batches} batches, own time p95 ${m.worker.toFixed(2)} ms`);
      expect(samples.length, 'the scroll was sampled across three seconds').toBeGreaterThan(60);
      const last = samples[samples.length - 1]!, firstS = samples[0]!;
      if (attempt === 0) {
        expect(last.draws.reduce((a, b) => a + b, 0), 'the loop drew while the page scrolled').toBeGreaterThan(firstS.draws.reduce((a, b) => a + b, 0) + 50);
        /* Every shiny post came into view on the way down, so each one was drawn at least once. */
        last.draws.forEach((d, h) => expect(d, `post ${h} was drawn once it came into view`).toBeGreaterThan(0));
      }
      expect(outOfViewDraws(samples)).toEqual([]);
      if (attempt > 0) {
        const r = redrawn(samples);
        console.log(`redrawn: the screen the shine changed, over what the words would change drawn every frame: ${(r.changed / r.words).toFixed(2)} (bound ${REDRAWN_SHARE})`);
        expect(r.changed / r.words, 'the screen area the scroll\'s draws change, over the words\' at every frame').toBeLessThan(REDRAWN_SHARE);
      }
    }
    const timed = runs.slice(1);
    /* The control, before anything is asserted, so a run that fails is logged with it. */
    const cpu = await calibrate(page), control = await controlRun(page);
    for (const d of data) console.log(`shine-data ${JSON.stringify({ ...d, throttle: THROTTLE, controlGap: +control.gap.toFixed(1), controlMedian: +control.median.toFixed(1), controlFrames: control.frames, controlCpuMs: +cpu.toFixed(1) })}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const passed = timed.findIndex(holdsAll);
    if (passed >= 0) {
      console.log(`passed in timed run ${passed + 1} of ${timed.length}: gap p95 ${timed[passed]!.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${timed[passed]!.work.toFixed(2)} ms (budget ${WORK_BUDGET}), worker own time p95 ${timed[passed]!.worker.toFixed(2)} ms (budget ${WORK_BUDGET})`);
    } else {
      /* No run met both: name each, with what it missed. */
      const missed = timed.map((m, k) => {
        const h = holds(m);
        const what = [!h.gap && 'gap', !h.work && 'loop time', !h.worker && 'worker time'].filter(Boolean).join(' and ');
        return `run ${k + 1} missed ${what}: gap p95 ${m.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${m.work.toFixed(2)} ms, worker own time p95 ${m.worker.toFixed(2)} ms (budget ${WORK_BUDGET})`;
      });
      console.log(`no timed run of ${timed.length} met both bounds; ${missed.join('; ')}`);
    }
    expect(Math.min(...timed.map((m) => m.work)), `the loop's own time, 95th percentile, under ${WORK_BUDGET} ms`).toBeLessThan(WORK_BUDGET);
    expect(Math.min(...timed.map((m) => m.worker)), `the foil worker's own time per batch, 95th percentile, under ${WORK_BUDGET} ms`).toBeLessThan(WORK_BUDGET);
    expect(Math.min(...timed.map((m) => m.gap)), 'the frame gap, 95th percentile (the backstop)').toBeLessThan(GAP_BOUND);
    expect(passed, 'one run met both').toBeGreaterThanOrEqual(0);

    /* At the bottom, the posts far out of view have let their buffers go, and few posts hold any. */
    await frames(page, 10);
    const bottom = await held(page);
    const r = heldOutOfView(bottom, 900);
    console.log(`bottom: ${bottom.length} shiny posts, ${r.inView} in view, ${r.holding} holding canvas buffers, held out of view: [${r.held.join(', ')}]`);
    expect(r.held, 'no post far out of view holds a canvas').toEqual([]);
    expect(r.holding, 'few posts hold buffers').toBeLessThanOrEqual(r.inView + 2);
  });

  test('scrolled with a moving mouse, the page rasters only what the light changes: a small share of the shiny posts in view a frame', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, 'full');
    await scrollRun(page);
    const counted = await rasterRun(page);
    const frames = counted.frames;
    const shares = frames.map((f) => f.share), high = frames.reduce((a, f) => a + f.high, 0);
    const p95 = percentile(shares, 0.95);
    console.log(`raster: ${frames.length} frames, share of the posts in view rastered a frame: median ${percentile(shares, 0.5).toFixed(2)}, p95 ${p95.toFixed(2)}, max ${Math.max(...shares).toFixed(2)} (bound ${RASTER_SHARE}); scaled at 'high': ${high} px in ${frames.filter((f) => f.high > 0).length} frames; the worker's batches matched ${counted.matched} of them (${counted.workerPx.toFixed(0)} px)`);
    expect(frames.length, 'the scroll was sampled across three seconds').toBeGreaterThan(60);
    expect(counted.matched, 'the worker\'s raster count reached the page\'s frames').toBeGreaterThan(60);
    expect(counted.workerPx, 'the worker rastered something').toBeGreaterThan(0);
    expect(percentile(shares, 0.5), 'the shine drew while the page scrolled').toBeGreaterThan(0);
    expect(high, 'canvas pixels scaled at \'high\' smoothing quality during the scroll').toBe(0);
    expect(p95, 'canvas pixels rastered a frame, over the shiny posts in view (95th percentile)').toBeLessThan(RASTER_SHARE);
  });

  test('poisoned: Glitter Bomb draws that take 25 ms each on the page turn the loop-time check and the frame-gap check red', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 'full', 'slow');
    await scrollRun(page);
    const m = measure(await scrollRun(page));
    console.log(`poisoned scroll: gap p95 ${m.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${m.work.toFixed(2)} ms, worker own time p95 ${m.worker.toFixed(2)} ms (budget ${WORK_BUDGET})`);
    expect(holds(m), 'the loop-time and frame-gap checks are red').toMatchObject({ gap: false, work: false });
  });

  test('poisoned: a foil worker that takes 25 ms a batch turns the worker-time check red', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 'full', 'slow-worker');
    await scrollRun(page);
    const m = measure(await scrollRun(page));
    console.log(`poisoned worker scroll: gap p95 ${m.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${m.work.toFixed(2)} ms, worker own time p95 ${m.worker.toFixed(2)} ms (budget ${WORK_BUDGET})`);
    expect(holds(m).worker, 'the worker-time check is red').toBe(false);
  });

  test('poisoned: a post that ignores being freed is named by the buffer check', async ({ page }) => {
    await open(page, 'full', 'keep');
    await scrollRun(page);
    await frames(page, 10);
    const r = heldOutOfView(await held(page), 900);
    console.log(`poisoned bottom: ${r.holding} holding canvas buffers, ${r.inView} in view, held out of view: [${r.held.join(', ')}]`);
    expect(r.held).toEqual([0]);
  });

  test('at rest with shimmer, each post in view is drawn about thirty times a second, or its share of that when its body is bigger than its words', async ({ page }) => {
    await open(page, 'full');
    await page.mouse.move(600, 450);
    /* The light eases to the pointer and settles; only then is a draw the idle cadence's. */
    await page.waitForTimeout(1500);
    const a = await hosts(page), fa = await page.evaluate(() => window.__kbShine!.frames());
    const t0 = Date.now();
    await page.waitForTimeout(2000);
    const b = await hosts(page), fb = await page.evaluate(() => window.__kbShine!.frames());
    const secs = (Date.now() - t0) / 1000, loopFrames = fb - fa;
    const rates = b.map((h, i) => ({ view: inView(h), share: h.share, rate: (h.draws - a[i]!.draws) / secs, per: (h.draws - a[i]!.draws) / loopFrames }));
    const shown = rates.filter((r) => r.view);
    console.log(`rest: ${shown.length} in view, ${loopFrames} frames in ${secs.toFixed(2)} s, draws a second (share) ${shown.map((r) => `${r.rate.toFixed(1)} (${r.share.toFixed(2)})`).join(' ')}`);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.some((r) => r.share < 1), 'a post in view paints a body bigger than its words').toBe(true);
    for (const r of shown) {
      /* A post's idle draws are its share of one on every second frame: give or take one draw in the two seconds. */
      const slack = 1.5 / loopFrames;
      expect(r.per, 'a draw on every second frame, times its share').toBeGreaterThan(0.5 * r.share * 0.9 - slack);
      expect(r.per).toBeLessThan(0.5 * r.share * 1.1 + slack);
      expect(r.rate).toBeGreaterThan(20 * r.share);
      expect(r.rate).toBeLessThan(36 * r.share);
    }
    for (const r of rates.filter((x) => !x.view)) expect(r.rate, 'a post out of view draws nothing').toBe(0);
  });

  test('with every shiny post scrolled away, the loop stops within three of its frames', async ({ page }) => {
    await open(page, 'full');
    /* Room below the last post, so no shiny one is left on the page's last screen. */
    await page.evaluate(() => { const s = document.createElement('div'); s.style.height = '3000px'; document.body.append(s); });
    await frames(page, 4);
    expect(await page.evaluate(() => window.__kbShine!.running())).toBe(true);
    const lag = await page.evaluate(() => new Promise<{ frames: number; running: boolean; seen: number }>((done) => {
      const kb = window.__kbShine!;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const at = kb.frames();
      let waited = 0;
      const tick = () => {
        waited += 1;
        if (!kb.running() || waited > 30) done({ frames: kb.frames() - at, running: kb.running(), seen: kb.hosts().filter((h) => h.bottom > 0 && h.top < innerHeight).length });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    console.log(`stop: ${lag.frames} loop frames after the scroll, running ${lag.running}`);
    expect(lag.seen).toBe(0);
    expect(lag.running).toBe(false);
    /* The frame the scroll was made in may still run (1), the observer tells the loop after the frame that showed the scroll (2), and the next frame finds nothing to draw and stops (3). */
    expect(lag.frames).toBeLessThanOrEqual(3);
    const after = await page.evaluate(() => window.__kbShine!.frames());
    await frames(page, 20);
    expect(await page.evaluate(() => window.__kbShine!.frames()), 'no frame runs once it has stopped').toBe(after);
    /* And it starts again, with the first post back in view. */
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.__kbShine!.running())).toBe(true);
  });

  test('under reduced motion the loop runs no frame after the first draw', async ({ page }) => {
    await open(page, 'still');
    await frames(page, 6);
    const base = await hosts(page), f = await page.evaluate(() => window.__kbShine!.frames());
    expect(base.filter((h) => inView(h)).every((h) => h.draws >= 1), 'every post in view was drawn').toBe(true);
    expect(await page.evaluate(() => window.__kbShine!.running())).toBe(false);
    await page.mouse.move(200, 200);
    await page.mouse.move(700, 500);
    await frames(page, 30);
    expect(await page.evaluate(() => window.__kbShine!.frames())).toBe(f);
    expect((await hosts(page)).map((h) => h.draws)).toEqual(base.map((h) => h.draws));
  });
});
