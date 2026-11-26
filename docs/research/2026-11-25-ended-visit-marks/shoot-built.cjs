/**
 * Shots and measurements of the built ended visit marks (docs/plans/2026-11-25-ended-visit-marks-design.md).
 * Build Storybook (`npx storybook build -o <dir>`), serve <dir>, then: node shoot-built.cjs http://localhost:6007
 * Writes 03-built-<story>.png (a tight crop of post #41's date row, where the marks sit) and prints the widths as JSON.
 */
const path = require('node:path');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:6007';
const OUT = (f) => path.join(__dirname, f);
const ID = (s) => `${BASE}/iframe.html?viewMode=story&id=boards-01-lens-a-visit--${s}`;
const SHOTS = [['filed', 'filed'], ['talked-down', 'talked-down'], ['trapped', 'trapped'], ['quiz', 'open']];
const measure = () => {
  const w = (el) => (el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null);
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : null);
  const v = document.querySelector('#post-41 .kb-visit-mark');
  const o = [...document.querySelectorAll('#post-41 .kb-mark')].filter((m) => m !== v);
  return { visit: w(v), visitH: h(v), kind: v?.dataset.kbVisit, others: o.map((m) => ({ cls: m.className, w: w(m), h: h(m) })), layout: document.documentElement.dataset.kbLayout ?? null };
};
(async () => {
  const b = await chromium.launch();
  const result = {};
  const open = async (p, story) => {
    await p.goto(ID(story), { waitUntil: 'networkidle' });
    await p.waitForSelector('#post-41 .kb-visit-mark'); await p.waitForTimeout(1500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.addStyleTag({ content: '.kb-callout { display: none !important; }' });
    await p.evaluate(() => { document.activeElement?.blur(); document.querySelector('#post-41').scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(200);
  };
  const clip = (p) => p.evaluate(() => {
    const row = document.querySelector('#post-41 .kb-act-meta').getBoundingClientRect();
    const s = document.querySelector('#post-41 .kb-marks').getBoundingClientRect();
    return { x: Math.max(0, row.right - 430), y: s.top - 14, width: Math.min(430, row.width), height: s.height + 22 };
  });
  const main = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  for (const [story, name] of SHOTS) {
    await open(main, story);
    result[`default ${name}`] = await main.evaluate(measure);
    await main.screenshot({ path: OUT(`03-built-${name}.png`), clip: await clip(main) });
  }
  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const [story, name] of SHOTS) {
    await open(phone, `${story}-phone`);
    result[`phone ${name}`] = await phone.evaluate(measure);
    if (name === 'talked-down') await phone.screenshot({ path: OUT('03-built-talked-down-phone.png'), clip: await clip(phone) });
  }
  // Forced colors, the default layout.
  await main.emulateMedia({ forcedColors: 'active' });
  await open(main, 'talked-down');
  await main.screenshot({ path: OUT('03-built-forced-colors.png'), clip: await clip(main) });
  await main.emulateMedia({ forcedColors: 'none' });
  // Any visit mark in a spun thread's ORIGIN box?
  const spin = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const ids = (await (await spin.request.get(`${BASE}/index.json`)).json()).entries;
  result.origin = {};
  for (const id of Object.keys(ids).filter((i) => i.startsWith('spin') && ids[i].type === 'story')) {
    await spin.goto(`${BASE}/iframe.html?viewMode=story&id=${id}`, { waitUntil: 'networkidle' }); await spin.waitForTimeout(1200);
    result.origin[id] = await spin.evaluate(() => document.querySelectorAll('.kb-visit-mark').length);
  }
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})();
