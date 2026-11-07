import { chromium } from '@playwright/test';
const dir = process.argv[2], out = process.argv[3];
const b = await chromium.launch();
for (const f of ['01-sign-in', '02-hidden-post']) for (const [w, tag] of [[680, 'desktop'], [375, 'phone']]) for (const img of [true, false]) {
  const p = await b.newPage({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
  if (!img) await p.route(/\.(jpg|png)$/, (r) => r.abort());
  await p.goto('file://' + dir + '/' + f + '.html'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${f}-${tag}${img ? '' : '-noimg'}.png`, fullPage: true }); await p.close();
}
await b.close();
