const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const js = fs.readFileSync(__dirname + '/bench.js', 'utf8');
  for (const gpu of [false]) {
    const b = await chromium.launch({ args: gpu ? ['--enable-gpu', '--use-angle=swiftshader'] : [] });
    const p = await b.newPage();
    await p.setContent('<!doctype html><body></body>');
    await p.addScriptTag({ content: js });
    await p.waitForFunction(() => window.__out, null, { timeout: 120000 });
    console.log(gpu ? '-- swiftshader' : '-- default');
    console.log((await p.evaluate(() => window.__out)).join('\n'));
    await b.close();
  }
})();
