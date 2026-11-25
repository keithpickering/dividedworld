/**
 * The ended visit marks' mocks (docs/plans/2026-11-25-ended-visit-marks-design.md), shot from the built visit story in Storybook
 * ("Boards/01 Lens: a visit", TalkedDown) with only the visit mark's contents laid in. Run Storybook (`npm run storybook`), then:
 *   node docs/research/2026-11-25-ended-visit-marks/shoot.cjs
 * It writes one crop of post #41's date row per outcome and treatment, then 02-approved.png beside itself; the crops are removed.
 * Option A (a corner badge) is drawn as it was shown to the owner; option B carries the approved filed icon.
 */
const path = require('node:path');
const fs = require('node:fs');
const OUT = (f) => path.join(__dirname, f);
const { chromium } = require('playwright');
const STATES = [
  ['filed', 'Filed', 'filed'], ['intercepted', 'Talked down', 'talked-down'], ['trapped', 'Trapped', 'trapped'],
  ['reversed', 'Ended', 'trapped'], ['dropped', 'Dropped', 'trapped'],
];
const WATCH = (extra = '', face = 'none') => `<svg class="kb-visit-watch" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="14" r="7.5" style="fill:${face}"/><path d="M12 14V9.5M9.5 3h5M12 3v3M18.2 7.2l1.4-1.4"/>${extra}</svg>`;
// Option A: the stopwatch alone, with a small badge in the corner naming the outcome.
const BADGE = {
  filed: '<path d="M8 3.5v5.5M8 11.6v.9" />',
  intercepted: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />',
  trapped: '<path d="M3 6l2.5 4 2.5-4 2.5 4 2.5-4" />',
  reversed: '<rect x="5" y="5" width="6" height="6" style="fill:currentColor;stroke:none" />',
  dropped: '<path d="M4 8h8" />',
};
// Option B: the stopwatch itself changes; no badge.
const ICON = {
  filed: WATCH('<circle cx="12" cy="17.6" r="1.25" style="fill:var(--kb-visit-ink);stroke:none"/>').replace('M12 14V9.5', 'M12 15V9.5'),
  intercepted: WATCH('<path d="M3.5 21.5L20.5 4.5" style="stroke:var(--kb-glass-text-hi);stroke-width:2.4"/>'),
  trapped: WATCH('<path d="M3 23l3-4 3 4 3-4 3 4 3-4 3 4" style="stroke:var(--kb-glass-text-hi);stroke-width:2"/>'),
  reversed: WATCH('<rect x="9" y="11" width="6" height="6" style="fill:var(--kb-glass-text-hi);stroke:none"/>').replace('M12 14V9.5', 'M12 14V14'),
  dropped: WATCH().replace('<circle', '<circle stroke-dasharray="3 2.6"'),
};
const CSS = `
.mock-a .kb-meta-tile-in, .mock-b .kb-meta-tile-in { gap: 0 }
.kb-mark.kb-visit-mark.mock-a, .kb-mark.kb-visit-mark.mock-b { padding-inline: 0.45rem; }
.mock-badge { position:absolute; top:-7px; right:-7px; width:16px; height:16px; box-sizing:border-box; display:grid; place-items:center;
  background: var(--kb-glass-ground); border: 2px solid var(--kb-visit-ink); color: var(--kb-glass-text-hi); pointer-events:none; }
.mock-badge svg { width: 12px; height: 12px; fill:none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.kb-callout { display: none !important; }
`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('http://localhost:6006/iframe.html?viewMode=story&id=boards-01-lens-a-visit--talked-down', { waitUntil: 'networkidle' });
  await p.waitForSelector('.kb-visit-mark'); await p.waitForTimeout(1500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.addStyleTag({ content: CSS });
  await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); document.querySelector('#post-41').scrollIntoView({ block: 'center' }); });
  const clip = async (name) => {
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => { const row = document.querySelector('#post-41 .kb-act-meta').getBoundingClientRect(); const s = document.querySelector('#post-41 .kb-marks').getBoundingClientRect(); return { x: row.right - 430, y: s.top - 14, width: 430, height: s.height + 22 }; });
    await p.screenshot({ path: OUT(`${name}.png`), clip: r });
  };
  for (const [state, word] of STATES) {
    for (const opt of ['now', 'a', 'b']) {
      await p.evaluate(({ state, word, opt, WATCH0, badge, icon }) => {
        const m = document.querySelector('.kb-visit-mark');
        m.dataset.kbVisit = state; m.classList.remove('mock-a', 'mock-b'); m.querySelector('.mock-badge')?.remove();
        const inner = m.querySelector('.kb-meta-tile-in');
        if (opt === 'now') inner.innerHTML = `${WATCH0}<span class="kb-visit-time">${word}</span>`;
        if (opt === 'a') { m.classList.add('mock-a'); inner.innerHTML = WATCH0; m.insertAdjacentHTML('beforeend', `<span class="mock-badge"><svg viewBox="0 0 16 16">${badge}</svg></span>`); }
        if (opt === 'b') { m.classList.add('mock-b'); inner.innerHTML = icon; }
      }, { state, word, opt, WATCH0: WATCH(), badge: BADGE[state], icon: ICON[state] });
      await clip(`${state}-${opt}`);
    }
  }
  // The open visit, unchanged, for reference.
  await p.evaluate(({ WATCH0 }) => { const m = document.querySelector('.kb-visit-mark'); m.classList.remove('mock-a','mock-b'); m.querySelector('.mock-badge')?.remove(); m.dataset.kbVisit = 'open'; m.querySelector('.kb-meta-tile-in').innerHTML = `${WATCH0}<span class="kb-visit-time">2:41</span>`; }, { WATCH0: WATCH() });
  await clip('open');
  // The approved sheet: now beside option B, and the open visit for reference.
  const rows = [['filed', 'Filed'], ['intercepted', 'Talked down'], ['trapped', 'Trapped'], ['reversed', 'Ended by an admin'], ['dropped', 'Dropped']]
    .map(([k, w]) => `<tr><td class="s">${w}</td><td><img src="${k}-now.png"></td><td><img src="${k}-b.png"></td></tr>`).join('');
  fs.writeFileSync(OUT('sheet.html'), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:15px/1.4 system-ui,sans-serif;color:#111;padding:24px} h1{font-size:20px;margin:0 0 4px} p{margin:0 0 18px;color:#444}
table{border-collapse:collapse} th,td{padding:6px 10px;text-align:left} th{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:2px solid #111}
td{border-bottom:1px solid #ddd} td.s{font-weight:700;white-space:nowrap} img{width:430px;display:block} .ref{margin-top:18px;display:flex;gap:14px;align-items:center}
</style><h1>Ended visit marks: option B, filed as a “!”</h1><p>Post #41's date row, with a Whoops! mark beside the visit for scale. The words stay in the mark's screen-reader name and on the Lens tab.</p>
<table><tr><th>Outcome</th><th>Now</th><th>B: the stopwatch changes</th></tr>${rows}</table><div class="ref"><b>Open visit (unchanged):</b><img src="open.png"></div>`);
  const sheet = await b.newPage({ viewport: { width: 1060, height: 600 }, deviceScaleFactor: 2 });
  await sheet.goto('file://' + OUT('sheet.html'));
  await sheet.screenshot({ path: OUT('02-approved.png'), fullPage: true });
  for (const f of fs.readdirSync(__dirname)) if (/^(\w+-(now|a|b)|open)\.png$|^sheet\.html$/.test(f)) fs.rmSync(OUT(f));
  await b.close();
})();
