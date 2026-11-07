/**
 * Makes an instance's baked email assets from its glass, and the record of what they were made from.
 *
 *   node tools/make-mail-assets.mjs <instance ui folder>
 *   (for an instance: node tools/make-mail-assets.mjs instances/<name>/ui)
 *
 * The design is docs/plans/2026-11-07-glass-mail-design.md. The ui folder holds `glass.json`, `icon/coin.svg`
 * and `fonts/`; the instance's email theme is `<ui>/../mail/index.ts`. This writes, to `<ui>/public/mail/`:
 *
 * - `smoke.jpg`: 1200 by 360 (600 by 180 at 2x). The field's wide layers in the `page` recipe's colors and
 *   opacities, each an element masked by engine/ui/glass/field.ts's `fieldLayerSvg` (the one definition of how
 *   a layer is drawn, imported, never copied), over the ground, as Smoke.tsx composites them (a layer at
 *   opacity 0 draws nothing, so none is placed), with a linear
 *   fade to the ground over the lower 60%. The JPEG quality is the highest, from 90 down, that keeps the file
 *   at or under 60KB;
 * - `cut-panel.png` and `cut-button.png`: 24 by 24 (12 at 2x), every pixel opaque. The panel's corner is the
 *   cut-away triangle in the ground over `--kb-glass-field`, with the diagonal edge in `--kb-glass-neon`, top
 *   right; the button's is the ground over `--kb-glass-neon`, bottom right;
 * - `coin.png`: 80 by 80, `icon/coin.svg` drawn on the ground, opaque;
 * - `fonts/`: the fonts the email theme names (the basenames of its `fonts[].url`s), copied byte for byte
 *   from `<ui>/fonts/`. Reading the theme keeps this tool free of any instance's list;
 *
 * and `<ui>/../mail/assets.json`, the SHA-256 of each output and of each source (tools/mail-assets.mjs's
 * `sourceSlices` as canonical JSON, the coin vector and each font), keys sorted, which tools/check-mail.mjs
 * reads against the committed files. The record holds the inputs that come from the glass, the ones a
 * change to the instance's look would move. The bake's own constants here (the fade's 40%, the corner's
 * geometry and edge width) are not hashed: a change to them is a change to this tool, made with a re-bake
 * in the same commit, and the record then reads the new outputs.
 *
 * It is run by hand, never by the build: it draws in Chromium, and the build has no browser
 * (tools/build.mjs, OUTSIDE_THE_BUILD). It uses the Chromium the environment provides and never downloads
 * one. Node reads field.ts and the theme directly (type stripping). A rerun on unchanged sources writes the
 * same files when Chromium draws the same pixels; another version may draw them a shade apart, which rewrites
 * the outputs and the record with no source changed. That is allowed: the check reads the record against the
 * files. It names no instance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { COIN, CORNER, SMOKE, sha256, sorted, sourceSlices, glassColor } from './mail-assets.mjs';

const DPR = 2;

/** The smoke's page: the wide layers over the ground, each masked by its noise, the foot faded to the ground. */
function smokeHtml({ layers, colors, ground, fieldLayerSvg }) {
  const w = SMOKE.width / DPR;
  const h = SMOKE.height / DPR;
  const divs = layers.map((layer, i) => {
    const c = colors[i];
    if (!c || !c.opacity) return '';
    const svg = fieldLayerSvg(layer, { width: w, height: h }, { width: SMOKE.width, height: SMOKE.height });
    const mask = `url('data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}')`;
    return `<div style="position:absolute;inset:0;background-color:${c.color};opacity:${c.opacity};-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-size:100% 100%;mask-size:100% 100%"></div>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0"><div id="b" style="position:relative;width:${w}px;height:${h}px;background:${ground};overflow:hidden">${divs}<div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 40%, ${ground} 100%)"></div></div></body></html>`;
}

/** The smoke at the highest JPEG quality that fits. */
async function drawSmoke(browser, input) {
  const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: SMOKE.width / DPR, height: SMOKE.height / DPR } });
  try {
    await page.setContent(smokeHtml(input));
    /*
     * The masks are SVG data URLs the page decodes on its own time, and a screenshot taken before they
     * are drawn is a smoke without its clouds that still fits the size. So each mask's image is decoded
     * first (the same URL, so the page's decode is the cached one), then two frames let the masks paint.
     * A fixed sleep would race a slow machine.
     */
    await page.evaluate(async () => {
      const masked = [...document.querySelectorAll('#b > div')].slice(0, -1); /* the last is the fade */
      const urls = masked
        .map((d) => /url\(["']?(data:[^"')]+)/.exec(getComputedStyle(d).getPropertyValue('mask-image') || getComputedStyle(d).getPropertyValue('-webkit-mask-image'))?.[1])
        .filter((u) => u);
      if (urls.length === 0 || urls.length !== masked.length) throw new Error(`found ${urls.length} of ${masked.length} masks to wait on`);
      await Promise.all(urls.map((u) => { const i = new Image(); i.src = u; return i.decode(); }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    for (let quality = 90; quality >= 30; quality -= 2) {
      const jpg = await page.locator('#b').screenshot({ type: 'jpeg', quality });
      if (jpg.length <= SMOKE.maxBytes) return jpg;
    }
    throw new Error(`smoke.jpg does not fit ${SMOKE.maxBytes} bytes even at quality 30`);
  } finally {
    await page.close();
  }
}

/** A corner: 12 CSS pixels at 2x, the cut-away triangle in the ground over `fill`, the edge along the diagonal when `edge`. */
async function drawCorner(browser, { fill, ground, edge, where }) {
  const s = CORNER / DPR;
  const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: s, height: s } });
  try {
    const top = where === 'top-right';
    const pts = top ? `0,0 ${s},${s} ${s},0` : `${s},0 ${s},${s} 0,${s}`;
    const line = top ? `M0 0.5 L${s - 0.5} ${s}` : `M${s} 0.5 L0.5 ${s}`;
    await page.setContent(`<body style="margin:0"><svg id="s" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="display:block;background:${fill}"><polygon points="${pts}" fill="${ground}"/>${edge ? `<path d="${line}" stroke="${edge}" stroke-width="1.4" fill="none"/>` : ''}</svg></body>`);
    return await page.locator('#s').screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

/** The vector on the ground, at 80 pixels. */
async function drawCoin(browser, svg, ground) {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: COIN, height: COIN } });
  try {
    await page.setContent(`<body style="margin:0;background:${ground}"><img id="i" style="display:block;width:${COIN}px;height:${COIN}px" src="data:image/svg+xml;base64,${svg.toString('base64')}"></body>`);
    await page.locator('#i').evaluate((img) => /** @type {HTMLImageElement} */ (img).decode());
    return await page.locator('#i').screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

async function main() {
  const [ui] = process.argv.slice(2);
  if (!ui) {
    console.error('usage: node tools/make-mail-assets.mjs <instance ui folder>');
    process.exit(2);
  }
  const need = (f) => {
    if (!fs.existsSync(f)) throw new Error(`${f} is missing`);
    return f;
  };
  const glass = JSON.parse(fs.readFileSync(need(path.join(ui, 'glass.json')), 'utf8'));
  const svg = fs.readFileSync(need(path.join(ui, 'icon', 'coin.svg')));
  const mailDir = path.join(ui, '..', 'mail');
  const theme = (await import(pathToFileURL(path.resolve(need(path.join(mailDir, 'index.ts')))).href)).mailTheme;
  const fontFiles = [...new Set(theme.fonts.map((f) => path.posix.basename(new URL(f.url).pathname)))].sort();
  const { fieldLayerSvg } = await import(pathToFileURL(path.resolve('engine/ui/glass/field.ts')).href);

  const slices = sourceSlices(glass);
  const [ground, field, neon] = ['--kb-glass-ground', '--kb-glass-field', '--kb-glass-neon'].map((t) => glassColor(glass, t));
  const layers = glass.smoke.field.layers;
  const colors = glass.smoke.recipes.page.colors;

  const browser = await chromium.launch();
  let smoke, panel, button, coin;
  try {
    smoke = await drawSmoke(browser, { layers, colors, ground, fieldLayerSvg });
    panel = await drawCorner(browser, { fill: field, ground, edge: neon, where: 'top-right' });
    button = await drawCorner(browser, { fill: neon, ground, edge: null, where: 'bottom-right' });
    coin = await drawCoin(browser, svg, ground);
    console.log(`  drawn in Chromium ${browser.version()}`);
  } finally {
    await browser.close();
  }

  const out = path.join(ui, 'public', 'mail');
  fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
  const images = { 'smoke.jpg': smoke, 'cut-panel.png': panel, 'cut-button.png': button, 'coin.png': coin };
  const outputs = {};
  const sources = {};
  for (const [name, bytes] of Object.entries(images)) {
    fs.writeFileSync(path.join(out, name), bytes);
    outputs[name] = sha256(bytes);
  }
  for (const f of fontFiles) {
    const bytes = fs.readFileSync(need(path.join(ui, 'fonts', f)));
    fs.writeFileSync(path.join(out, 'fonts', f), bytes);
    outputs[`fonts/${f}`] = sha256(bytes);
    sources[`fonts/${f}`] = sha256(bytes);
  }
  for (const [name, text] of Object.entries(slices)) sources[name] = sha256(Buffer.from(text));
  sources['icon/coin.svg'] = sha256(svg);
  const recordText = Buffer.from(JSON.stringify({ outputs: sorted(outputs), sources: sorted(sources) }, null, 2) + '\n');
  const recordFile = path.join(mailDir, 'assets.json');
  fs.writeFileSync(recordFile, recordText);
  for (const [name, bytes] of Object.entries(images)) console.log(`  wrote ${path.join(out, name)} (${bytes.length} bytes)`);
  console.log(`  copied ${fontFiles.length} fonts to ${path.join(out, 'fonts')}`);
  console.log(`  wrote ${recordFile} (${recordText.length} bytes)`);
}

try {
  await main();
} catch (e) {
  console.error(`  make-mail-assets: ${e.message}`);
  process.exit(1);
}
