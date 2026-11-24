import { expect, type Page } from '@playwright/test';

/**
 * What e2e/shine.spec.ts holds a shine host's cost to, shared so that e2e/origin-effects.spec.ts holds the ORIGIN box's foil to the same bound and not to a copy of it: the screen area a
 * host's draws change over what it is allowed (`redrawn`) stays under `REDRAWN_SHARE`, where a host is allowed the larger of its words' box and `BODY_FLOOR` of its painted box (the larger of the
 * words' box and a quarter of the content area, engine/ui/cards/body.ts `paintShare`, issue #304 and PR #695). The planted samples that drive `redrawn` red are in e2e/shine.spec.ts.
 */

/** The on-screen area a scroll's draws change, over what the posts in view are allowed (`redrawn`): at most this. */
export const REDRAWN_SHARE = 1.25;
/**
 * The share of its content area a post's draws may change a frame however few its words: the least share of the rate a body is
 * redrawn at (engine/ui/cards/body.ts `LEAST_SHARE`), stated here on its own, so a floor raised there is seen here.
 */
export const BODY_FLOOR = 0.25;

export interface Box1 { top: number; bottom: number; width: number }
export interface Sample { t: number; draws: number[]; top: number[]; bottom: number[]; height: number; painted?: Box1[]; own?: Box1[]; layers?: number[]; scrollY?: number }

/** A box's area inside the viewport's rows, in CSS px squared. */
export const onScreen = (b: Box1, height: number): number => Math.max(0, Math.min(b.bottom, height) - Math.max(b.top, 0)) * b.width;

/**
 * The screen the shine changed over a run: for each sample after the first, the on-screen area of each post drawn since the one before
 * (its painted box, the content area), summed; and what the posts were allowed, every post in view on every frame: the larger of its
 * words' box and `BODY_FLOOR` of its painted box, each as much as is on screen. A host drawn more than once between two samples counts
 * each draw. For the log, `words` is the words' boxes alone (the allowance before a body had its floor, as the runs before it
 * recorded it) and `view` the viewport's area over the same samples (`width` times each one's height).
 */
export function redrawn(samples: readonly Sample[], width = 0): { changed: number; allowed: number; words: number; view: number } {
  let changed = 0, allowed = 0, words = 0, view = 0;
  samples.forEach((s, k) => {
    if (k === 0) return;
    view += width * s.height;
    s.draws.forEach((d, h) => {
      const drew = d - samples[k - 1]!.draws[h]!, body = onScreen(s.painted![h]!, s.height);
      if (drew > 0) changed += drew * body;
      const own = onScreen(s.own![h]!, s.height);
      words += own;
      allowed += Math.max(own, BODY_FLOOR * body);
    });
  });
  return { changed, allowed, words, view };
}

/* The busy thread's timed scroll, shared with e2e/dent-bend.spec.ts (docs/plans/2026-11-23-dent-bend-plan.md, Task 4): moved here from e2e/shine.spec.ts, not copied. */

/**
 * How fast the timed scrolls move, in CSS px a second: the speed the scroll had while it was three seconds from the top of the page to
 * its bottom and a post's body had no floor (3,865 px, CI's `shine-data`). The page is longer now (a body is at least 22.5em: 7,267
 * px), and the scroll takes as long as the page is, so the loop's and the worker's time, the raster share and the frames a post is in
 * view for are measured at the speed they always were. Three seconds over this page was 2,420 px a second, and showed a cost these
 * runs never measured: a Glitter Bomb's burst point crossed the middle of the window (the 540 px it is watched against) in about 220
 * ms, under the 300 ms it must stay there to fire (instances/divided-world/ui/glitter-bomb/Effect.tsx `ARM_MS`), so no burst fired
 * and every pass armed all four again, each drawn whole on every frame while it armed (a busy draw is never held to its share): with
 * the floor, 2.41 against the words on CI. That cost is real, a reader can scroll that fast, and it is
 * keithpickering/dividedworld#726's; it is not measured here. The timed runs measure posts whose bursts have fired, which `fireBursts`
 * sees to by name before them, whatever the speed.
 */
export const SCROLL_SPEED = 1290;

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

/** Waits for the fonts and for the thread's first shiny post to stop changing size, so a late layout adds no draw to a count. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => new Promise<void>((done) => {
    const read = () => `${document.querySelectorAll('[data-kb-fab], [data-kb-glitter]').length}:${document.documentElement.scrollHeight}`;
    let prev = read(), same = 0;
    const tick = () => { const now = read(); same = now === prev ? same + 1 : 0; prev = now; if (same >= 20) done(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
}

export interface Run { samples: Sample[]; work: number[]; workerWork: number[] }

/**
 * How long a scroll of the page from its top to its bottom takes at `SCROLL_SPEED`, in ms. The loop and the worker keep their own
 * time for their last 600 frames (engine/ui/shine/loop.ts `WORK_KEEP`), about ten seconds: `measure` refuses a run longer than that.
 * `speed` is in CSS px a second, `SCROLL_SPEED` unless a spec says otherwise (e2e/dent-bend.spec.ts scrolls slowly, and reads the frames' times alone).
 */
export const scrollMs = (page: Page, speed = SCROLL_SPEED): Promise<number> =>
  page.evaluate((v) => Math.round(((document.documentElement.scrollHeight - window.innerHeight) / v) * 1000), speed);

/** A moving mouse, over the page's width and height, for as long as a scroll of `ms` lasts. */
export async function mouse(page: Page, ms: number): Promise<void> {
  const end = Date.now() + ms * 0.9;
  for (let i = 0; Date.now() < end; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
}

/** Scrolls the page from the top to the bottom at `SCROLL_SPEED` under a moving mouse, sampling every frame, the loop's own time in the frames it ran and the foil worker's in the batches it drew. */
export async function scrollRun(page: Page, speed = SCROLL_SPEED): Promise<Run> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const ms = await scrollMs(page, speed);
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
  }, ms);
  await mouse(page, ms);
  return run;
}

/**
 * Fires every Glitter Bomb's burst, one post at a time: its burst point is brought to the middle of the window and held there until
 * the burst is in the air (the canvas over the words has a backing store only then: instances/divided-world/ui/glitter-bomb/
 * Effect.tsx `sizeOver`). A burst fires once per mount, so the scrolls after this pass posts that are settled, and none arms.
 */
export async function fireBursts(page: Page): Promise<void> {
  const bombs = page.locator('[data-kb-glitter]');
  expect(await bombs.count(), 'the thread\'s four Glitter Bomb posts').toBe(4);
  for (let i = 0; i < 4; i += 1) {
    /* The point is centered again at each look (the post's first draw moves it to its seeded place), and looked at often: a burst is in the air for a second or two. */
    await expect.poll(async () => {
      await bombs.nth(i).locator('.dw-glitter-origin').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      return bombs.nth(i).locator('canvas.dw-glitter-over').evaluate((c: HTMLCanvasElement) => c.width);
    }, { message: `Glitter Bomb post ${i}'s burst is in the air`, intervals: [50] }).toBeGreaterThan(0);
  }
}
