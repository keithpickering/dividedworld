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
 * Draws and frames are the loop's own, handed over by the story as `window.__kbShine`.
 */
const STORY = (name: string) => `/?fixture=boards&story=boards-15-shine--${name}`;
const SHINY = 16;
const LAG = 2;

interface Sample { t: number; draws: number[]; top: number[]; bottom: number[]; height: number }

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

async function open(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(STORY(name));
  await expect.poll(() => page.evaluate(() => window.__kbShine?.hosts().length ?? 0)).toBe(SHINY);
  await settle(page);
}

const hosts = (page: Page) => page.evaluate(() => window.__kbShine!.hosts());
const inView = (h: { top: number; bottom: number }, height = 900) => h.bottom > 0 && h.top < height;
/** Waits for a number of animation frames in the page. */
const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((count) => new Promise<void>((done) => { let left = count; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);

test.describe('the planted samples, red where they should be', () => {
  const frame = (draws: number[], top: number[], bottom = top.map((t) => t + 100)): Sample => ({ t: 0, draws, top, bottom, height: 900 });
  test('a post drawn while fully out of view is named', () => {
    const away = [2000], seq: Sample[] = [];
    for (let k = 0; k < 6; k += 1) seq.push(frame([k + 1], away));
    expect(outOfViewDraws(seq)).toEqual([{ frame: 2, host: 0 }, { frame: 3, host: 0 }, { frame: 4, host: 0 }, { frame: 5, host: 0 }]);
  });
  test('the frames of the loop\'s lag, and a post in view, are not named', () => {
    const seq = [frame([1], [800]), frame([2], [950]), frame([3], [960]), frame([3], [970]), frame([3], [980]), frame([4], [100])];
    expect(outOfViewDraws(seq)).toEqual([]);
  });
});

test.describe('a busy thread', () => {
  test('scrolled top to bottom with a moving mouse, the frames hold and nothing out of view is drawn', async ({ page }) => {
    await open(page, 'full');
    const first = await hosts(page);
    const visible = first.filter((h) => inView(h)).length;
    expect(visible, 'about five shiny posts in view').toBeGreaterThanOrEqual(3);
    expect(visible).toBeLessThanOrEqual(8);
    /* The first run down the page is a warm-up (the script compiled, each post's buffers and flakes made for the first time) and is not timed.
       A software-drawn headless Chromium drops a frame now and then, and a gap is a whole frame or two (16.7 or 33.3 ms), so one drop too many
       moves the 95th percentile from 16.8 to 33.3: the bound is met if one of three timed runs meets it. Every run must draw nothing out of
       view. A loop that costs more than a frame meets the bound in none. */
    const p95s: number[] = [];
    for (let attempt = 0; attempt < 4 && !p95s.slice(1).some((p) => p < 20); attempt += 1) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      const run = page.evaluate((ms) => new Promise<Sample[]>((done) => {
        const kb = window.__kbShine!, out: Sample[] = [], max = document.documentElement.scrollHeight - window.innerHeight;
        let t0 = 0;
        const tick = (t: number) => {
          t0 ||= t;
          const hs = kb.hosts();
          out.push({ t, draws: hs.map((h) => h.draws), top: hs.map((h) => h.top), bottom: hs.map((h) => h.bottom), height: window.innerHeight });
          const p = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, p * max);
          if (p < 1) requestAnimationFrame(tick); else done(out);
        };
        requestAnimationFrame(tick);
      }), 3000);
      /* A moving mouse, over the page's width and height, while it scrolls. */
      for (let i = 0; i < 60; i += 1) { await page.mouse.move(100 + (i * 17) % 1000, 100 + (i * 41) % 700); await page.waitForTimeout(45); }
      const samples = await run;
      const gaps = samples.slice(1).map((s, k) => s.t - samples[k]!.t);
      p95s.push(percentile(gaps, 0.95));
      console.log(`scroll ${attempt === 0 ? 'warm-up' : attempt}: ${samples.length} frames, p95 ${p95s[attempt]!.toFixed(1)} ms, median ${percentile(gaps, 0.5).toFixed(1)} ms, max ${Math.max(...gaps).toFixed(1)} ms`);
      expect(samples.length, 'the scroll was sampled across three seconds').toBeGreaterThan(60);
      const last = samples[samples.length - 1]!, firstS = samples[0]!;
      if (attempt === 0) {
        expect(last.draws.reduce((a, b) => a + b, 0), 'the loop drew while the page scrolled').toBeGreaterThan(firstS.draws.reduce((a, b) => a + b, 0) + 50);
        /* Every shiny post came into view on the way down, so each one was drawn at least once. */
        last.draws.forEach((d, h) => expect(d, `post ${h} was drawn once it came into view`).toBeGreaterThan(0));
      }
      expect(outOfViewDraws(samples)).toEqual([]);
    }
    expect(Math.min(...p95s.slice(1))).toBeLessThan(20);
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
