import { expect, test, type Browser, type Page } from '@playwright/test';
import { fireBursts, percentile, scrollRun, settle } from './shine-share.ts';

/**
 * The gate: what bending the foil costs (docs/plans/2026-11-23-dent-bend-plan.md, Task 4; the design's section 2.4, docs/plans/2026-11-23-dent-bend-design.md).
 * The busy thread of e2e/shine.spec.ts with a Steel Chair on every post that has a Feelin' Fab (the story `Dented`,
 * instances/divided-world/ui/Shine.board.stories.tsx), scrolled top to bottom the way shine.spec.ts scrolls it (e2e/shine-share.ts `scrollRun`, at
 * `SPEED` px a second instead of `SCROLL_SPEED`, under a moving mouse), at CPU throttling 2 (CDP `Emulation.setCPUThrottlingRate`). In one run every foil carries the engine's
 * `data-kb-bend`, so a standing dent bends it (`bend: true`); in the other none does, so the dent only shades it (`bend: false`). The story sets the
 * attribute for the measurement alone; Steel Chair's effect does not touch the foil. The page learns which from `window.__kbBend`, set before it loads
 * (the app rewrites its address, so a query would not survive; the story's `bend` arg is the default).
 *
 * `DENT_BEND_RUNS=N`: N scrolls of each, alternating (bent, shade only, bent, ...), one `dent-bend-data` line of JSON for each run: the frame gap's
 * 95th percentile and median, the frames, and the bend; and a `dent-bend-verdict` line: the median of the bent runs' 95th percentiles over the shade-only
 * runs' (the verdict is "bent" at 1.10 or under, "shade only" over it, docs/research/2026-11-23-dent-bend). Without it, one pair, logged, and nothing
 * about the frame gap asserted (the owner's ruling on the frame gap, keithpickering/dividedworld#318): the line is how CI's log follows the bent page's
 * cost, as `shine-data` follows the shiny page's (shine.spec.ts).
 *
 * What is asserted is that a run measures what it says it does, so one cannot silently measure nothing: the foils carry the attribute in a bent run and
 * none does in the other, and some frame of the scroll had a standing dent (a content area with a `--kb-bend`) in view over a foil, and in a bent run
 * over a foil that carried the attribute. A dent stands while its post is in view and is thrown again, with a flight, when the post comes back (the effect's
 * `ARM_MS`), so the scroll is measured with the chairs at their own pace and the dents standing where they stand; both variants do the same.
 *
 * The poison (`DENT_BEND_POISON=1`, which the gate is run with once, to be seen red): in a bent run, every animation frame is held 25 ms by a busy loop
 * while a foil carries `data-kb-bend`, the cost the bend would have if it were a slow one. It is planted here, never in the product.
 */
const RUNS = Number(process.env.DENT_BEND_RUNS ?? 0);
const POISON = process.env.DENT_BEND_POISON === '1';
/** CPU throttling of the runs: Chrome's, of the page's main thread, standing in for a slower machine. */
const THROTTLE = 2;
/** The verdict: the bent runs' 95th-percentile gap, within this share over the shade-only runs'. */
const WITHIN = 1.1;
const FOILS = 12;
/**
 * How fast the measured scroll moves, in CSS px a second: slower than shine.spec.ts's `SCROLL_SPEED`. A Steel Chair throws when a post's middle has been in view 300 ms, its dent lands after the flight and is cleared when the post has
 * wholly left the view, so at `SCROLL_SPEED` (1,290) no dent stood in view in the first run of this spec (47 of 81 frames sampled, none with a dent). At this speed a post is in
 * view for some four seconds and its dent stands for most of them: the scroll measures the foil with the dent over it.
 */
const SPEED = Number(process.env.DENT_BEND_SPEED ?? 300);

const median = (xs: readonly number[]): number => percentile(xs, 0.5);

async function open(browser: Browser, bend: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.addInitScript((b) => { window.__kbBend = b; }, bend);
  if (POISON && bend) {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      let last = -1;
      window.requestAnimationFrame = (cb) => raf((t) => {
        if (t !== last && document.querySelector('canvas.dw-fab-foil[data-kb-bend]')) {
          last = t;
          for (const until = performance.now() + 25; performance.now() < until;) { /* busy */ }
        }
        cb(t);
      });
    });
  }
  await page.goto('/?fixture=boards&story=boards-15-shine--dented');
  await expect.poll(() => page.evaluate(() => window.__kbShine?.hosts().length ?? 0), { timeout: 60_000 }).toBe(16);
  await settle(page);
  return { page, close: () => context.close() };
}

interface Seen { frames: number; dent: number; bent: number }

/** A sampler in the page, every fourth frame: whether a content area with a `--kb-bend` over a foil is in view, and whether that foil carries the attribute. */
const sampleDents = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __kbDent: { frames: number; dent: number; bent: number; stop: boolean } };
  w.__kbDent = { frames: 0, dent: 0, bent: 0, stop: false };
  let n = 0;
  const tick = (): void => {
    if (w.__kbDent.stop) return;
    if (++n % 4 === 0) {
      w.__kbDent.frames += 1;
      let dent = false, bent = false;
      for (const c of document.querySelectorAll('canvas.dw-fab-foil')) {
        const area = c.closest<HTMLElement>('[data-kb-content-area]');
        if (!area) continue;
        const r = area.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const v = area.style.getPropertyValue('--kb-bend');
        if (v && v !== 'none') { dent = true; if (c.hasAttribute('data-kb-bend')) bent = true; }
      }
      if (dent) w.__kbDent.dent += 1;
      if (bent) w.__kbDent.bent += 1;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const stopDents = (page: Page): Promise<Seen> => page.evaluate(() => {
  const w = window as unknown as { __kbDent: { frames: number; dent: number; bent: number; stop: boolean } };
  w.__kbDent.stop = true;
  return { frames: w.__kbDent.frames, dent: w.__kbDent.dent, bent: w.__kbDent.bent };
});

async function oneRun(browser: Browser, bend: boolean, n: number) {
  const { page, close } = await open(browser, bend);
  try {
    await fireBursts(page);
    const carrying = await page.evaluate(() => ({ foils: document.querySelectorAll('canvas.dw-fab-foil').length, bent: document.querySelectorAll('canvas.dw-fab-foil[data-kb-bend]').length }));
    expect(carrying.foils, 'the thread\'s Feelin\' Fab foils').toBe(FOILS);
    expect(carrying.bent, bend ? 'every foil carries data-kb-bend' : 'no foil carries data-kb-bend').toBe(bend ? FOILS : 0);
    await sampleDents(page);
    const run = await scrollRun(page, SPEED);
    const seen = await stopDents(page);
    const gaps = run.samples.slice(1).map((s, k) => s.t - run.samples[k]!.t);
    const out = { run: n, bend, poison: POISON && bend, throttle: THROTTLE, gap: +percentile(gaps, 0.95).toFixed(2), median: +percentile(gaps, 0.5).toFixed(2), frames: run.samples.length, sampled: seen.frames, dentFrames: seen.dent, bentFrames: seen.bent };
    console.log(`dent-bend-data ${JSON.stringify(out)}`);
    expect(seen.dent, 'frames of the scroll with a dent standing in view over a foil').toBeGreaterThan(0);
    if (bend) expect(seen.bent, 'frames with such a dent over a foil carrying data-kb-bend').toBeGreaterThan(0);
    return out;
  } finally {
    await close();
  }
}

test(`the foil bent by a dent against shaded only, ${RUNS > 0 ? `${RUNS} scrolls each` : 'one pair, logged'}`, async ({ browser }) => {
  const pairs = RUNS > 0 ? RUNS : 1;
  test.setTimeout(pairs * 2 * 120_000 + 60_000);
  const bent: number[] = [], shaded: number[] = [];
  for (let i = 0; i < pairs; i += 1) {
    bent.push((await oneRun(browser, true, i * 2 + 1)).gap);
    shaded.push((await oneRun(browser, false, i * 2 + 2)).gap);
  }
  const ratio = median(bent) / median(shaded);
  console.log(`dent-bend-verdict ${JSON.stringify({ runs: pairs, bentMedianP95: +median(bent).toFixed(2), shadeOnlyMedianP95: +median(shaded).toFixed(2), ratio: +ratio.toFixed(3), within: WITHIN, verdict: ratio <= WITHIN ? 'bent' : 'shade only', poison: POISON })}`);
});
