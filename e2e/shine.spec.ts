import { expect, test, type Page } from '@playwright/test';

/**
 * The shine loop on a busy page, as Chromium runs it (docs/plans/2026-11-06-shine-plan.md, Task 11; the design's section 6): a thread of
 * seventeen posts, sixteen of them shiny (instances/divided-world/ui/Shine.board.stories.tsx), about five in view at 1200 x 900.
 * Scrolled top to bottom over three seconds with a moving mouse, the page keeps its frames (the 95th percentile of the gap between
 * animation frames is under 20 ms) and no shiny post fully out of view is drawn. At rest with shimmer each post in view is drawn on
 * every second frame, about thirty a second; with every shiny post scrolled away the loop stops within three of its own frames (the observer's
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
 * posts hold any. The story's poison `slow` (25 ms in one post's draw) and `keep` (one post ignores being freed) make those
 * checks red; the `poisoned` tests below run them and expect the red.
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
 * past it.
 */
const WORK_BUDGET = 16;
/** Out of view "beyond a margin": a post this many px past the viewport's edge has freed its canvases. */
const FREED_MARGIN = 300;

interface Sample { t: number; draws: number[]; top: number[]; bottom: number[]; height: number }
interface Held { top: number; bottom: number; sizes: { w: number; h: number }[] }

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

/** What the page reports of every shiny post's canvases: its box and the size of each canvas inside it. */
const held = (page: Page): Promise<Held[]> => page.evaluate(() => [...document.querySelectorAll('[data-kb-fab], [data-kb-glitter]')].map((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, sizes: [...el.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height })) };
}));

/** Scrolls the page from the top to the bottom over three seconds under a moving mouse, sampling every frame and the loop's own time in the frames it ran. */
async function scrollRun(page: Page): Promise<{ samples: Sample[]; work: number[] }> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const run = page.evaluate((ms) => new Promise<{ samples: Sample[]; work: number[] }>((done) => {
    const kb = window.__kbShine!, out: Sample[] = [], max = document.documentElement.scrollHeight - window.innerHeight, f0 = kb.frames();
    let t0 = 0;
    const tick = (t: number) => {
      t0 ||= t;
      const hs = kb.hosts();
      out.push({ t, draws: hs.map((h) => h.draws), top: hs.map((h) => h.top), bottom: hs.map((h) => h.bottom), height: window.innerHeight });
      const p = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, p * max);
      if (p < 1) requestAnimationFrame(tick); else done({ samples: out, work: kb.work(kb.frames() - f0) });
    };
    requestAnimationFrame(tick);
  }), 3000);
  /* A moving mouse, over the page's width and height, while it scrolls. */
  for (let i = 0; i < 60; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
  return run;
}

/** A timed run's two measures: the 95th percentile of the gap between animation frames, and of the loop's own time in a frame. */
const measure = (r: { samples: Sample[]; work: number[] }) => {
  const gaps = r.samples.slice(1).map((s, k) => s.t - r.samples[k]!.t);
  return { gap: percentile(gaps, 0.95), median: percentile(gaps, 0.5), max: Math.max(...gaps), work: percentile(r.work, 0.95), frames: r.samples.length, loopFrames: r.work.length };
};
const GAP_BOUND = 20;
/** A timed run holds when its gaps hold; a run holds the loop when its own time does. */
const holds = (m: { gap: number; work: number }) => ({ gap: m.gap < GAP_BOUND, work: m.work < WORK_BUDGET });

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
  test('the frames of the loop\'s lag, and a post in view, are not named', () => {
    const seq = [frame([1], [800]), frame([2], [950]), frame([3], [960]), frame([3], [970]), frame([3], [980]), frame([4], [100])];
    expect(outOfViewDraws(seq)).toEqual([]);
  });
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
       must be under WORK_BUDGET in a timed run too. A loop that costs more than a frame meets neither bound in any run. */
    const runs: ReturnType<typeof measure>[] = [];
    for (let attempt = 0; attempt < 4 && !runs.slice(1).some((m) => holds(m).gap && holds(m).work); attempt += 1) {
      const run = await scrollRun(page), samples = run.samples;
      const m = measure(run);
      runs.push(m);
      console.log(`scroll ${attempt === 0 ? 'warm-up' : attempt}: ${m.frames} frames, gap p95 ${m.gap.toFixed(1)} ms, median ${m.median.toFixed(1)} ms, max ${m.max.toFixed(1)} ms; loop ${m.loopFrames} frames, own time p95 ${m.work.toFixed(2)} ms`);
      expect(samples.length, 'the scroll was sampled across three seconds').toBeGreaterThan(60);
      const last = samples[samples.length - 1]!, firstS = samples[0]!;
      if (attempt === 0) {
        expect(last.draws.reduce((a, b) => a + b, 0), 'the loop drew while the page scrolled').toBeGreaterThan(firstS.draws.reduce((a, b) => a + b, 0) + 50);
        /* Every shiny post came into view on the way down, so each one was drawn at least once. */
        last.draws.forEach((d, h) => expect(d, `post ${h} was drawn once it came into view`).toBeGreaterThan(0));
      }
      expect(outOfViewDraws(samples)).toEqual([]);
    }
    const timed = runs.slice(1);
    const passed = timed.findIndex((m) => holds(m).gap && holds(m).work);
    if (passed >= 0) {
      console.log(`passed in timed run ${passed + 1} of ${timed.length}: gap p95 ${timed[passed]!.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${timed[passed]!.work.toFixed(2)} ms (budget ${WORK_BUDGET})`);
    } else {
      /* No run met both: name each, with what it missed. */
      const missed = timed.map((m, k) => {
        const h = holds(m);
        const what = [!h.gap && 'gap', !h.work && 'loop time'].filter(Boolean).join(' and ');
        return `run ${k + 1} missed ${what}: gap p95 ${m.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${m.work.toFixed(2)} ms (budget ${WORK_BUDGET})`;
      });
      console.log(`no timed run of ${timed.length} met both bounds; ${missed.join('; ')}`);
    }
    expect(Math.min(...timed.map((m) => m.work)), `the loop's own time, 95th percentile, under ${WORK_BUDGET} ms`).toBeLessThan(WORK_BUDGET);
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

  test('poisoned: a draw that takes 25 ms turns the loop-time check and the frame-gap check red', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 'full', 'slow');
    await scrollRun(page);
    const m = measure(await scrollRun(page));
    console.log(`poisoned scroll: gap p95 ${m.gap.toFixed(1)} ms (bound ${GAP_BOUND}), loop own time p95 ${m.work.toFixed(2)} ms (budget ${WORK_BUDGET})`);
    expect(holds(m), 'both checks are red').toEqual({ gap: false, work: false });
  });

  test('poisoned: a post that ignores being freed is named by the buffer check', async ({ page }) => {
    await open(page, 'full', 'keep');
    await scrollRun(page);
    await frames(page, 10);
    const r = heldOutOfView(await held(page), 900);
    console.log(`poisoned bottom: ${r.holding} holding canvas buffers, ${r.inView} in view, held out of view: [${r.held.join(', ')}]`);
    expect(r.held).toEqual([0]);
  });

  test('at rest with shimmer, each post in view is drawn about thirty times a second', async ({ page }) => {
    await open(page, 'full');
    await page.mouse.move(600, 450);
    /* The light eases to the pointer and settles; only then is a draw the idle cadence's. */
    await page.waitForTimeout(1500);
    const a = await hosts(page), fa = await page.evaluate(() => window.__kbShine!.frames());
    const t0 = Date.now();
    await page.waitForTimeout(2000);
    const b = await hosts(page), fb = await page.evaluate(() => window.__kbShine!.frames());
    const secs = (Date.now() - t0) / 1000, loopFrames = fb - fa;
    const rates = b.map((h, i) => ({ view: inView(h), rate: (h.draws - a[i]!.draws) / secs, per: (h.draws - a[i]!.draws) / loopFrames }));
    const shown = rates.filter((r) => r.view);
    console.log(`rest: ${shown.length} in view, ${loopFrames} frames in ${secs.toFixed(2)} s, draws a second ${shown.map((r) => r.rate.toFixed(1)).join(' ')}`);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    for (const r of shown) {
      expect(r.per, 'a draw on every second frame').toBeGreaterThan(0.45);
      expect(r.per).toBeLessThan(0.55);
      expect(r.rate).toBeGreaterThan(20);
      expect(r.rate).toBeLessThan(36);
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
