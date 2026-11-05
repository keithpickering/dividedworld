// For each screen: cold load and in-app navigation; the api calls (start/end vs. the move), the waves, and the DOM bursts.
const { chromium } = require('playwright');
const LAT = Number(process.argv[2] ?? 100);
const base = `http://localhost:5199`;
const bursts = (ts, gap = 25) => { const out = []; for (const t of ts) { if (!out.length || t - out[out.length - 1].end > gap) out.push({ start: t, end: t }); else out[out.length - 1].end = t; } return out; };
async function settle(page) { // until no api call is pending and none has started for 4×LAT
  for (;;) { await page.waitForTimeout(LAT * 4); const s = await page.evaluate(() => { const tr = globalThis.__trace; const open = tr.some((r) => r.end === null); const last = Math.max(0, ...tr.map((r) => r.end ?? r.start)); return { open, idle: performance.now() - last }; }); if (!s.open && s.idle >= LAT * 3) return; }
}
function report(label, t0, trace, muts) {
  const calls = trace.filter((r) => r.start >= t0 - 1).map((r) => ({ ...r, s: Math.round(r.start - t0), e: Math.round(r.end - t0) }));
  const done = Math.max(0, ...calls.map((c) => c.e));
  // waves: calls whose start falls in the same LAT-wide window after the previous wave's ends
  const waves = []; for (const c of [...calls].sort((a, b) => a.s - b.s)) { const w = waves[waves.length - 1]; if (w && c.s < w.at + LAT * 0.5) w.calls.push(c.name); else waves.push({ at: c.s, calls: [c.name] }); }
  const b = bursts(muts.filter((t) => t >= t0).map((t) => t - t0)).filter((x) => x.start > 5);
  console.log(`\n## ${label} @ ${LAT}ms/call — ${calls.length} calls, last answer at ${done}ms (= ${(done / LAT).toFixed(1)} round trips), ${b.length} DOM update bursts`);
  waves.forEach((w, i) => console.log(`  wave ${i + 1} @${w.at}ms: ${w.calls.join(', ')}`));
  console.log(`  bursts at: ${b.map((x) => Math.round(x.start)).join(', ')}`);
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const [label, path] of [['index (cold)', '/'], ['board (cold)', '/b/general']]) {
    await page.goto(`${base}${path}?lat=${LAT}`); await settle(page);
    const { trace, muts } = await page.evaluate(() => ({ trace: globalThis.__trace, muts: globalThis.__muts }));
    report(label, 0, trace, muts);
  }
  // thread cold
  await page.goto(`${base}/b/general?lat=${LAT}`); await settle(page);
  const threadHref = await page.locator('a[href^="/t/"]').first().getAttribute('href');
  await page.goto(`${base}${threadHref.split('?')[0]}?lat=${LAT}`); await settle(page);
  { const { trace, muts } = await page.evaluate(() => ({ trace: globalThis.__trace, muts: globalThis.__muts })); report('thread (cold)', 0, trace, muts); }
  // in-app moves: thread -> index -> board -> thread
  for (const [label, sel] of [['move thread→index', 'nav a[href="/"]'], ['move index→board', 'main a[href^="/b/"]'], ['move board→thread', 'main a[href^="/t/"]']]) {
    const t0 = await page.evaluate(() => performance.now());
    await page.locator(sel).first().click(); await settle(page);
    const { trace, muts } = await page.evaluate(() => ({ trace: globalThis.__trace, muts: globalThis.__muts }));
    report(label, t0, trace, muts);
  }
  await browser.close();
})();
