// Mockup bake: the page recipe's smoke over the ground, 600x300 CSS at 2x, fading to the ground at its foot.
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const glass = JSON.parse(fs.readFileSync('instances/divided-world/ui/glass.json', 'utf8'));
const W = 600, H = 180, DPR = 2, GROUND = glass.keys.standard['--kb-glass-ground'].value;
const layers = glass.smoke.field.layers, colors = glass.smoke.recipes.page.colors;
const hex = (n) => Math.round(n * 1000) / 1000;
const svgOf = (l) => {
  const m = [0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1, ...l.alpha.map(hex)].join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W*DPR}" height="${H*DPR}" viewBox="0 0 ${W} ${H}"><filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${l.frequency.join(' ')}" numOctaves="${l.octaves}" seed="${l.seed}"/><feColorMatrix type="matrix" values="${m}"/><feGaussianBlur stdDeviation="${l.blur}"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>`;
};
const divs = layers.map((l, i) => colors[i].opacity ? `<div style="position:absolute;inset:0;background:${colors[i].color};opacity:${colors[i].opacity};-webkit-mask-image:url('data:image/svg+xml;base64,${Buffer.from(svgOf(l)).toString('base64')}');-webkit-mask-size:100% 100%"></div>` : '').join('');
const html = `<html><body style="margin:0"><div id="b" style="position:relative;width:${W}px;height:${H}px;background:${GROUND};overflow:hidden">${divs}<div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 40%, ${GROUND} 100%)"></div></div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: DPR, viewport: { width: W, height: H } });
await p.setContent(html); await p.waitForTimeout(300);
await p.locator('#b').screenshot({ path: process.argv[2], type: 'jpeg', quality: 78 });
const c = await b.newPage({ deviceScaleFactor: 1, viewport: { width: 96, height: 96 } });
await c.setContent(`<body style="margin:0;background:${GROUND}"><img id="i" style="display:block;width:96px;height:96px" src="data:image/svg+xml;base64,${fs.readFileSync('instances/divided-world/ui/icon/coin.svg').toString('base64')}"></body>`);
await c.locator('#i').screenshot({ path: process.argv[3] });

// Corners: a 12px chamfer at 2x, ground beyond the cut, the edge drawn along the diagonal.
const corner = async (file, fill, edge, which) => {
  const pg = await (await chromium.launch()).newPage({ deviceScaleFactor: 2, viewport: { width: 12, height: 12 } });
  const pts = which === 'tr' ? '0,0 12,12 12,0' : '12,0 12,12 0,12'; // the cut-away triangle, in ground
  const line = which === 'tr' ? 'M0 0.5 L11.5 12' : 'M12 0.5 L0.5 12';
  await pg.setContent(`<body style="margin:0"><svg id="s" width="12" height="12" viewBox="0 0 12 12" style="display:block;background:${fill}"><polygon points="${pts}" fill="${GROUND}"/>${edge ? `<path d="${line}" stroke="${edge}" stroke-width="1.4" fill="none"/>` : ''}</svg></body>`);
  await pg.locator('#s').screenshot({ path: file });
};
await corner(process.argv[2].replace('smoke.jpg', 'cut-panel.png'), '#160d2a', '#19e3ff', 'tr');
await corner(process.argv[2].replace('smoke.jpg', 'cut-button.png'), '#19e3ff', null, 'br');
process.exit(0);
