// The cosmetics boards' generator, 2026-11-04: writes each NN-name.html from its .src.html, inlining the placeholder
// art (art.svg) and the glass's smoke (smoke.txt, the booster packs boards' own), then shots each at twice its size.
// Run from the repository root: node docs/research/2026-11-04-cosmetics/gen.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const art = readFileSync(join(here, 'art.svg'), 'utf8');
const smoke = readFileSync(join(here, 'smoke.txt'), 'utf8');
const boards = readdirSync(here).filter((f) => f.endsWith('.src.html')).sort();
for (const src of boards) {
  const out = src.replace('.src.html', '.html');
  writeFileSync(join(here, out), readFileSync(join(here, src), 'utf8').replace('<!--ART-->', art).replace('<!--SMOKE-->', smoke));
}
if (process.argv.includes('--shots')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  for (const src of boards) {
    const out = src.replace('.src.html', '');
    const glass = readFileSync(join(here, src), 'utf8').includes('boards.css');
    const page = await browser.newPage({ viewport: { width: glass ? 1440 : 1180, height: glass ? 1080 : 900 }, deviceScaleFactor: 2 });
    await page.goto('file://' + join(here, out + '.html'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(here, out + '.png'), fullPage: !glass });
    await page.close();
  }
  await browser.close();
}
