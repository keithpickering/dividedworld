/**
 * Makes an instance's served icons from its two sources, and the record of what they were made from.
 *
 *   node tools/make-icons.mjs <icon folder> <public folder>
 *   (for an instance: node tools/make-icons.mjs instances/<name>/ui/icon instances/<name>/ui/public)
 *
 * The design is docs/plans/2026-11-02-favicon-design.md. The icon folder holds `coin-16.png`, the
 * owner's 16px sprite, and `coin.svg`, the vector every larger size is drawn from. This writes, to
 * the public folder:
 *
 * - `favicon.ico`: three PNG images, the sprite as read (byte for byte, never decoded and written
 *   again, which could change its colors through a gamma or color-profile chunk), then the vector
 *   drawn at 32 and 48px on a transparent ground;
 * - `apple-touch-icon.png`: 180px, the vector at 148px centered on the glass's ground (#07050d),
 *   every pixel opaque, since iOS fills a transparent pixel with black and rounds the corners itself;
 *
 * and to the icon folder `icons.json`, the SHA-256 of each source and each output, keys sorted, which
 * tools/check-icons.mjs reads against the committed files.
 *
 * It is run by hand, never by the build: it draws the vector in Chromium, and the build has no
 * browser (tools/build.mjs, OUTSIDE_THE_BUILD). It uses the Chromium the environment provides, as
 * tools/test-e2e.mjs's run does, and never downloads one. A rerun on unchanged sources writes the same
 * files when Chromium draws the same pixels; another Chromium version may draw them a shade apart,
 * which rewrites the outputs and the record with no source changed. That is allowed: the check reads
 * the record against the files, not against a new drawing. It names no instance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { sha256, writeIco } from './icons.mjs';

/** The glass's ground, behind the home-screen icon. */
const GROUND = '#07050d';
const APPLE = 180;
const APPLE_COIN = 148;

/** A page of `size` pixels square holding the SVG at `coin` pixels, centered, on `ground` or nothing. */
function pageHtml(svg, size, coin, ground) {
  const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const margin = (size - coin) / 2;
  return `<!doctype html><html><head><style>
html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: ${ground ?? 'transparent'}; }
img { display: block; position: absolute; left: ${margin}px; top: ${margin}px; width: ${coin}px; height: ${coin}px; }
</style></head><body><img src="${src}" alt=""></body></html>`;
}

async function draw(browser, svg, { size, coin = size, ground }) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  try {
    await page.setContent(pageHtml(svg, size, coin, ground));
    await page.locator('img').evaluate((img) => img.decode());
    return await page.screenshot({ type: 'png', omitBackground: !ground, clip: { x: 0, y: 0, width: size, height: size } });
  } finally {
    await page.close();
  }
}

/** An object with its keys sorted, so the record's text does not depend on the order written. */
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

async function main() {
  const [iconDir, publicDir] = process.argv.slice(2);
  if (!iconDir || !publicDir) {
    console.error('usage: node tools/make-icons.mjs <icon folder> <public folder>');
    process.exit(2);
  }
  for (const f of ['coin-16.png', 'coin.svg']) {
    if (!fs.existsSync(path.join(iconDir, f))) {
      console.error(`  make-icons: ${path.join(iconDir, f)} is missing; the icon folder holds the sprite (coin-16.png) and the vector (coin.svg)`);
      process.exit(1);
    }
  }
  const sprite = fs.readFileSync(path.join(iconDir, 'coin-16.png'));
  const svg = fs.readFileSync(path.join(iconDir, 'coin.svg'));

  const browser = await chromium.launch();
  let ico, apple;
  try {
    const [p32, p48, p180] = [
      await draw(browser, svg, { size: 32 }),
      await draw(browser, svg, { size: 48 }),
      await draw(browser, svg, { size: APPLE, coin: APPLE_COIN, ground: GROUND }),
    ];
    ico = writeIco([sprite, p32, p48]);
    apple = p180;
    console.log(`  drawn in Chromium ${browser.version()}`);
  } finally {
    await browser.close();
  }

  fs.mkdirSync(publicDir, { recursive: true });
  const written = [
    [path.join(publicDir, 'favicon.ico'), ico],
    [path.join(publicDir, 'apple-touch-icon.png'), apple],
  ];
  for (const [f, bytes] of written) fs.writeFileSync(f, bytes);
  const record = {
    outputs: sorted({ 'favicon.ico': sha256(ico), 'apple-touch-icon.png': sha256(apple) }),
    sources: sorted({ 'coin-16.png': sha256(sprite), 'coin.svg': sha256(svg) }),
  };
  const recordText = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  const recordFile = path.join(iconDir, 'icons.json');
  fs.writeFileSync(recordFile, recordText);
  for (const [f, bytes] of [...written, [recordFile, recordText]]) console.log(`  wrote ${f} (${bytes.length} bytes)`);
}

try {
  await main();
} catch (e) {
  console.error(`  make-icons: ${e.message}`);
  process.exit(1);
}
