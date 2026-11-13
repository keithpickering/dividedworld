// Takes the shots: node shoot.mjs   (from anywhere; writes shots/<board>-1440.png and -390.png at 2x)
// Needs Playwright with Chromium (require('playwright')). Run node mock.mjs first if a board changed.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'shots');
fs.mkdirSync(out, { recursive: true });
const boards = fs.readdirSync(here).filter((f) => /^\d\d-.*\.html$/.test(f)).sort();
const browser = await chromium.launch();
for (const f of boards) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.goto(`file://${path.join(here, f)}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${f.replace('.html', '')}-${width}.png`), fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log(`shot ${boards.length} boards`);
