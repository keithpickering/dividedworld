import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import { judgeLayout } from './glass-layout.ts';
import type * as Gatherer from './glass-layout-page.ts';

/**
 * The layout gatherer's self-test (e2e/glass-layout-page.ts), in a real Chromium on a small
 * fixture page: the judgment's own test (e2e/glass-layout.test.ts) runs on plain data and cannot
 * say whether the gatherer ever sees the defect. The fixture is the glass content's shape, a
 * column that clips sideways (`overflow-x: clip`, as `.kb-glass-content` does), holding the three
 * defects the gatherer must hand to the judgment from inside a clip, and the one it must not
 * refuse: an overflow inside a track that scrolls on purpose.
 */
const GATHERER = buildSync({
  entryPoints: [new URL('./glass-layout-page.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', globalName: 'kbGlassLayout', target: 'es2022', write: false,
}).outputFiles[0]!.text;

type Bundled = typeof globalThis & { kbGlassLayout: typeof Gatherer };

const FIXTURE = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.3 sans-serif; }
  .content { overflow-x: clip; width: 100%; }
  .head { display: flex; flex-wrap: nowrap; }
  .head h1 { flex: 0 0 auto; width: 330px; margin: 0; font-size: 24px; }
  .head p.lead { flex: 1 1 auto; margin: 0; font-size: 21px; }
  .panel { width: 410px; height: 40px; background: #333; margin: 0; }
  .cut { position: relative; width: 300px; height: 100px; background: #444;
    clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%); }
  .cut button.go { position: absolute; right: 0; top: 0; width: 80px; height: 40px; transform: skewX(-10deg); }
  .cut2 { position: relative; box-sizing: border-box; padding-top: 40px; width: 300px; height: 100px; background: #444;
    clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%); }
  .rail { overflow-x: auto; width: 150px; height: 40px; margin: 0 0 0 140px; }
  .rail .strip2 { position: relative; width: 900px; height: 40px; }
  .rail button.far { position: absolute; left: 500px; top: 0; width: 80px; height: 40px; }
  .rail button.half { position: absolute; left: 100px; top: 0; width: 80px; height: 40px; }
  .cut2 button.hang { position: absolute; left: 290px; top: 60px; width: 80px; height: 30px; }
  .track { overflow-x: auto; width: 200px; height: 30px; }
  .track .strip { width: 600px; height: 20px; }
</style>
<main class="content">
  <header class="head"><h1>My characters</h1><p class="lead">Every character you have made, and where each one stands.</p></header>
  <section class="panel">A panel</section>
  <div class="cut"><button class="go">Go</button></div>
  <div class="cut2"><div class="rail"><div class="strip2"><button class="far">Far</button><button class="half">Half</button></div></div><button class="hang">Hang</button></div>
  <div class="track"><div class="strip">strip</div></div>
</main>`;

test.use({ viewport: { width: 390, height: 844 } });

test('the gatherer hands the judgment what a clipping column holds, and not a scroll on purpose', async ({ page }) => {
  await page.setContent(FIXTURE);
  await page.addScriptTag({ content: GATHERER });
  const facts = await page.evaluate(() => (globalThis as Bundled).kbGlassLayout.gather());
  const out = judgeLayout({ screen: 'the fixture', ...facts });
  const text = out.join('\n');
  expect(text).toMatch(/squeezed block: .*p\.lead/u);
  expect(text).toMatch(/overflow: .*section\.panel/u);
  expect(text).toMatch(/cut control: .*button\.go/u);
  /* A button hanging past the panel's edge is cut; one scrolled out of its rail is not drawn, so nothing cuts it. */
  expect(text).toMatch(/cut control: .*button\.hang/u);
  expect(text).not.toMatch(/button\.far/u);
  /* One half in its rail's view, the other half hidden past the panel's edge, is judged by the half in view: not cut. */
  expect(text).not.toMatch(/button\.half/u);
  expect(text).not.toMatch(/track|strip/u);
});

/*
 * Paint order (refusal 6): the swap's calm is a stacking context, which paints over a static
 * neighbor and faded the phone avatar; the same neighbor positioned above it is not dimmed. The
 * fixture reproduces both, with the calm's backing as calm.css draws it (a `::before` at
 * z-index -1 in an isolated calm). It also holds the card-face art exemption to marked text inside
 * the card: an aria-hidden ancestor above the card exempts nothing.
 */
const PAINT = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.3 sans-serif; }
  .calm { position: relative; isolation: isolate; margin: 60px 60px 0; width: 200px; height: 40px; }
  .calm::before { content: ''; position: absolute; z-index: -1; inset: -30px; background: #000; pointer-events: none; }
  .row { position: relative; height: 0; }
  button.pic { width: 80px; height: 30px; }
  button.over { display: block; margin: -20px 0 0 70px; }
  button.above { position: absolute; left: 70px; top: -20px; z-index: 1; }
  .card { display: flex; width: 358px; margin-top: 200px; }
  .card p { width: 100px; margin: 0; }
</style>
<main>
  <div class="calm kb-calm">Calm</div>
  <button class="pic over">Over</button>
  <div class="calm kb-calm" style="margin-top: 140px">Calm two</div>
  <div class="row"><button class="pic above">Above</button></div>
  <div aria-hidden="true"><div class="kb-postcard card"><p class="bare">Every character you have made, and where each one stands, on this card.</p><span></span></div></div>
  <div class="kb-postcard card"><p data-kb-art class="marked">Every character you have made, and where each one stands, on this card.</p><span></span></div>
</main>`;

test('the gatherer reads paint order: a calm painted over a control is refused, one under it is not', async ({ page }) => {
  await page.setContent(PAINT);
  await page.addScriptTag({ content: GATHERER });
  const facts = await page.evaluate(() => (globalThis as Bundled).kbGlassLayout.gather());
  const text = judgeLayout({ screen: 'the fixture', ...facts }).join('\n');
  expect(text).toMatch(/calm over other content: .*lies on .*button\.pic\.over/u);
  expect(text).not.toMatch(/lies on .*button\.pic\.above/u);
  /* The gatherer lists the one it read as above, and not the other. */
  const listed = facts.calms.flatMap((c) => c.above ?? []);
  expect(listed.some((p) => p.includes('button.pic.above'))).toBe(true);
  expect(listed.some((p) => p.includes('button.pic.over'))).toBe(false);
});

test('card-face art is only marked text inside the card, not anything under an aria-hidden ancestor', async ({ page }) => {
  await page.setContent(PAINT);
  await page.addScriptTag({ content: GATHERER });
  const facts = await page.evaluate(() => (globalThis as Bundled).kbGlassLayout.gather());
  const text = judgeLayout({ screen: 'the fixture', ...facts }).join('\n');
  expect(text).toMatch(/squeezed block: .*p\.bare/u);
  expect(text).not.toMatch(/p\.marked/u);
});
