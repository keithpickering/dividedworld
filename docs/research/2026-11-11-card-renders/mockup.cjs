// Draws the real Postcard story, puts each card's render in place of its vector canvas, and saves every card as an image.
// The card's frame, plates, words and sizes are the engine's own; only the picture's address is changed, in the page.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const R = __dirname;                    // the renders sit beside this script
const out = process.argv[2];
const SERVED = new RegExp('/__render/([a-z-]+)[.]png');
const keyOf = (name) => name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  await p.route(SERVED, (route) => {
    const file = path.join(R, route.request().url().match(SERVED)[1] + '.png');
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(file) });
  });
  await p.goto('http://localhost:6006/iframe.html?id=cards-postcard--all-sizes&viewMode=story', { waitUntil: 'networkidle' });
  await p.waitForSelector('.kb-postcard', { timeout: 120000 });
  const cards = await p.$$('.kb-postcard');
  const info = [];
  for (let i = 0; i < cards.length; i++) {
    const label = await cards[i].getAttribute('aria-label');
    const [name, size] = label.split(', ');
    const key = keyOf(name);
    const has = fs.existsSync(path.join(R, key + '.png'));
    if (has) {
      await cards[i].$eval('img.kb-postcard-art', (img, src) => new Promise((done, fail) => { img.onload = done; img.onerror = () => fail(new Error('no picture')); img.src = src; }), '/__render/' + key + '.png');
    }
    info.push({ i, name, size, key, swapped: has });
  }
  await p.waitForTimeout(500);
  for (let i = 0; i < cards.length; i++) await cards[i].screenshot({ path: path.join(out, info[i].key + '--' + info[i].size + '.png') });
  fs.writeFileSync(path.join(out, 'info.json'), JSON.stringify(info, null, 1));
  console.log('cards', cards.length, 'swapped', info.filter((c) => c.swapped).length, 'not swapped', [...new Set(info.filter((c) => !c.swapped).map((c) => c.key))].join(' ') || 'none');
  await b.close();
})();
