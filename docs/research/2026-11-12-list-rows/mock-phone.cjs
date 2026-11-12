const { chromium } = require('playwright');
const base = `
  .mock-lead-shown { display: inline; color: var(--kb-muted); font-size: var(--kb-size-small); }
  .kb-table.kb-board-list .kb-board-row > td, .kb-table.kb-thread-list .kb-thread-row > td:not(.kb-thread-flags) { vertical-align: baseline !important; }
`;
const A = base + `
  .kb-table.kb-thread-list .kb-thread-row > td.kb-thread-last, .mock-last { display: inline-block !important; white-space: nowrap; }
  .kb-thread-spun { display: block; }
`;
const B = base + `
  .kb-table.kb-thread-list .kb-thread-row > td.kb-thread-last, .kb-table.kb-board-list .kb-board-row > td.kb-board-last { display: block !important; }
  .mock-lead { display: none !important; }
  .kb-thread-spun { display: block; }
`;
(async () => {
  const b = await chromium.launch();
  for (const [name, css] of [['before', ''], ['A', A], ['B', B]]) {
    for (const [story, sel] of [['boards-01-index--index', '.kb-board-list'], ['boards-02-board--board', '.kb-thread-list']]) {
      const p = await b.newPage({ bypassCSP: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
      await p.goto(`http://localhost:4173/?fixture=boards&story=${story}`);
      await p.waitForSelector(sel);
      await p.waitForTimeout(400);
      await p.evaluate((variant) => {
        const mock = variant !== 'before';
        // the owner's case: a spun thread, one reply, a relative date
        for (const t of document.querySelectorAll('time')) t.textContent = '2 days ago';
        const bt = document.querySelector('.kb-board-last-title'); if (bt) bt.textContent = 'Spin a spin';
        const n = document.querySelector('.kb-board-threads .kb-num'); if (n) n.textContent = '13';
        const row = document.querySelectorAll('.kb-thread-row')[1];
        if (row) {
          row.querySelector('.kb-thread-title b').textContent = 'Spin a spin';
          const s = document.createElement('span'); s.className = 'kb-thread-spun kb-small'; s.innerHTML = (mock ? '' : ' ') + '↳ spun from <a href="#">#1 in Gabe my beloved</a>';
          row.querySelector('.kb-thread-title').after(s);
          row.querySelector('.kb-thread-replies .kb-num').textContent = '1';
          if (mock) row.querySelector('.kb-thread-replies .kb-thread-unit').textContent = ' reply';
        }
        if (!mock) return;
        // the leading separator of the last-post cell moves out of the unit, so a wrapped unit never starts with a dot
        for (const cell of document.querySelectorAll('.kb-thread-last, .kb-board-last')) {
          const sep = cell.querySelector(':scope > [class$="-sep"]'); if (!sep) continue;
          sep.classList.add('mock-lead'); cell.before(sep);
          sep.classList.add('mock-lead-shown');
        }
        // the index: "last: Spin a spin · Snuckles, 2 days ago", the byline and date one unbreakable unit
        for (const cell of document.querySelectorAll('.kb-board-last')) {
          const title = cell.querySelector('.kb-board-last-title'); const label = cell.querySelector('.kb-board-last-label'); if (!title || !label) continue;
          cell.prepend(label); title.after(' · ');
          const unit = document.createElement('span'); unit.className = 'mock-last';
          const who = cell.querySelector('.kb-who'); who.before(unit);
          while (unit.nextSibling) unit.append(unit.nextSibling);
        }
      }, name);
      if (css) await p.addStyleTag({ content: css });
      await p.locator(sel).screenshot({ path: `${process.argv[2]}/${name}-${story.includes('index') ? 'index' : 'board'}.png`, clip: undefined });
      await p.close();
    }
  }
  await b.close();
})();
