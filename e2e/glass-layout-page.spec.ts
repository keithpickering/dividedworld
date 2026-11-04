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
  .track { overflow-x: auto; width: 200px; height: 30px; }
  .track .strip { width: 600px; height: 20px; }
</style>
<main class="content">
  <header class="head"><h1>My characters</h1><p class="lead">Every character you have made, and where each one stands.</p></header>
  <section class="panel">A panel</section>
  <div class="cut"><button class="go">Go</button></div>
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
  expect(text).not.toMatch(/track|strip/u);
});
