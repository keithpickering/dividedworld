const { chromium } = require('playwright');
const base = `.kb-table.kb-board-list .kb-board-row > td, .kb-table.kb-thread-list .kb-thread-row > td:not(.kb-thread-flags) { vertical-align: baseline !important; }`;
(async () => {
  const b = await chromium.launch();
  for (const [name, css] of [['before', ''], ['inline', base], ['own-line', base + '.kb-thread-spun { display: block; }']]) {
    for (const [story, sel] of [['boards-01-index--index', '.kb-board-list'], ['boards-02-board--board', '.kb-thread-list']]) {
      if (name === 'own-line' && story.includes('index')) continue;
      const p = await b.newPage({ bypassCSP: true, viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
      await p.goto(`http://localhost:4173/?fixture=boards&story=${story}`);
      await p.waitForSelector(sel);
      await p.waitForTimeout(400);
      await p.evaluate((own) => {
        for (const t of document.querySelectorAll('time')) t.textContent = '2 days ago';
        const bt = document.querySelector('.kb-board-last-title'); if (bt) bt.textContent = 'Spin a spin';
        const row = document.querySelectorAll('.kb-thread-row')[1];
        if (row) {
          row.querySelector('.kb-thread-title b').textContent = 'Spin a spin';
          const s = document.createElement('span'); s.className = 'kb-thread-spun kb-small'; s.innerHTML = (own ? '' : ' ') + '↳ spun from <a href="#">#1 in Gabe my beloved</a>';
          row.querySelector('.kb-thread-title').after(s);
        }
      }, name === 'own-line');
      if (css) await p.addStyleTag({ content: css });
      const box = await p.locator(sel).boundingBox();
      await p.screenshot({ path: `${process.argv[2]}/desk-${name}-${story.includes('index') ? 'index' : 'board'}.png`, clip: { ...box, height: Math.min(box.height, 260) } });
      await p.close();
    }
  }
  await b.close();
})();
