// Writes the booster packs boards, redrawn (docs/research/2026-11-07-booster-packs/), as self-contained HTML files in the
// backfill boards' markup (docs/research/2026-11-05-backfill/gen.mjs): the same smoke and calms, menu bar, display title,
// skewed controls and row rules. Every card face and back on them is the engine's own (engine/ui/cards/Postcard.tsx), rendered
// here through Vite with Divided World's cards, and drawn by the engine's own stylesheet (postcard.css over the glass tokens,
// with the instance's values from glass.json), so a board shows the card template exactly as the build draws it.
// Run from the repository's root: node docs/research/2026-11-07-booster-packs/gen.mjs
// Each board's sample data is written into it. A reference for the look, not code to copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ---- the engine's faces, rendered once ---- */
const vite = await createServer({ root, configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
let faces, coin, Postcard, PostcardBack;
try {
  ({ Postcard, PostcardBack } = await vite.ssrLoadModule('/engine/ui/cards/Postcard.tsx'));
  const { facesOf } = await vite.ssrLoadModule('/engine/ui/cards/faces.ts');
  const { instanceUi } = await vite.ssrLoadModule('/instances/divided-world/ui/index.ts');
  const { instance } = await vite.ssrLoadModule('/instances/divided-world/index.ts');
  faces = Object.fromEntries(facesOf(instance.cards, instanceUi.cards, instance.settings).map((f) => [f.key, f]));
  coin = instanceUi.cardBack.mark;
} finally {
  await vite.close();
}
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement: h } = await import('react');
/* A file the bundler served from the repository's root is read from this folder, three levels down. */
/* React's server renderer hoists a `<link rel="preload">` for each image; a board has no head to hoist it to, so it is dropped. */
const local = (html) => html.replace(/<link rel="preload" as="image"[^>]*\/>/g, '').replaceAll('src="/instances/', 'src="../../../instances/');
const face = (key, size, style = {}) => local(renderToStaticMarkup(h(Postcard, { face: faces[key], size, style })));
const back = (size, hit = false, style = {}) => local(renderToStaticMarkup(h(PostcardBack, { size, hit, mark: coin, style })));

/*
 * The card back as the owner amended it on 2026-11-07 (docs/plans/2026-11-05-card-template-design.md, the amendment of that
 * date) is built into engine/ui/cards/postcard.css (docs/plans/2026-11-04-booster-packs-plan.md, Task 9), so the boards read
 * the engine's stylesheet alone.
 */

/* The engine's stylesheet for a face, over the glass's tokens with the instance's values, the way the app's root sets them. */
const glass = JSON.parse(read('instances/divided-world/ui/glass.json')).keys.standard;
const FACE_CSS = `${read('engine/ui/glass/tokens.css')}
:root{--kb-glass-skew-tag:-12deg;${Object.entries(glass).map(([k, v]) => `${k}:${v.value}`).join(';')}}
${read('engine/ui/cards/postcard.css')}`;

const CSS = `
body{margin:0}
a{color:inherit}a:hover{color:inherit;text-decoration:none}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #ffffff;outline-offset:3px}
.tab{display:flex;align-items:center;min-height:52px;padding:0 20px;white-space:nowrap;transform:skewX(-10deg);text-decoration:none;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:#e4def7}
.many .tab{padding:0 13px;letter-spacing:1.5px}
.most .tab{padding:0 10px;letter-spacing:1px}
.tab b{display:inline-block;transform:skewX(10deg);font-weight:800}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;transform:skewX(-10deg);text-decoration:none;border:1px solid rgba(241,236,255,.6);background:none;cursor:pointer;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:#f1ecff}
.btn b{display:inline-block;transform:skewX(10deg);font-weight:800}
.btn.primary{background:#19e3ff;border-color:#19e3ff;color:#03141a;box-shadow:0 0 18px rgba(25,227,255,.6)}
.btn.gold{background:#ffd93d;border-color:#ffd93d;color:#1a1403;box-shadow:0 0 18px rgba(255,217,61,.55)}
.btn.sm{min-height:44px;padding:0 16px;font-size:19px}
.btns{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.lead{margin:0;max-width:680px;font:600 21px/1.5 'Barlow Condensed',sans-serif;color:#f1ecff}
.note{margin:0;font:500 21px/1.5 'Barlow Condensed',sans-serif;color:#e4def7}
.lnk{font:700 21px 'Barlow Condensed',sans-serif;color:#c9f8ff;text-decoration-thickness:2px;text-underline-offset:4px}
.sec{margin:0;font:800 20px 'Barlow Condensed',sans-serif;letter-spacing:3px}
.piece{--cut:22px;--edge:rgba(201,248,255,.55);--ground:rgba(7,5,13,.94);position:relative;isolation:isolate;background:var(--edge);clip-path:polygon(0 0,calc(100% - var(--cut)) 0,100% var(--cut),100% 100%,var(--cut) 100%,0 calc(100% - var(--cut)))}
.piece::before{content:'';position:absolute;z-index:-1;inset:1.5px;background:var(--ground);clip-path:polygon(0 0,calc(100% - var(--cut) + .62px) 0,100% calc(var(--cut) - .62px),100% 100%,calc(var(--cut) - .62px) 100%,0 calc(100% - var(--cut) + .62px))}
.sel,.num{box-sizing:border-box;height:52px;padding:0 14px;background:rgba(18,12,36,.9);border:1px solid #19e3ff;color:#f1ecff;font:700 21px 'Barlow Condensed',sans-serif}
.num{width:110px;text-align:right}
.gem{display:inline-grid;place-items:center;flex:none;width:22px;height:22px;transform:rotate(45deg);background:#0b0914;box-shadow:inset 0 0 0 1.5px var(--g)}
.gem::before{content:attr(data-gem);transform:rotate(-45deg);color:var(--g);font:16px/1 'Barlow Condensed',sans-serif}
.odds{width:100%;border-collapse:collapse;font:600 21px 'Barlow Condensed',sans-serif;color:#f1ecff}
.odds th{padding:16px 0 8px;text-align:left;font:800 19px 'Barlow Condensed',sans-serif;letter-spacing:2.5px;color:#9ef4ff;border-bottom:1px solid rgba(201,248,255,.4)}
.odds td{padding:7px 0;border-bottom:1px solid rgba(241,236,255,.14)}
.odds td:last-child{text-align:right;font-weight:800}
.odds .who{display:flex;align-items:center;gap:12px}
.tag{display:inline-block;transform:skewX(-12deg);padding:2px 10px;font:italic 800 17px/1.3 'Barlow Condensed',sans-serif;letter-spacing:1.5px;white-space:nowrap}
.tag b{display:inline-block;transform:skewX(12deg);font-weight:800}
.reveal-row{display:flex;gap:24px;align-items:flex-start}
.turned{position:relative}
.turned.now::after{content:'';position:absolute;left:10%;right:10%;bottom:-14px;height:4px;background:#19e3ff;box-shadow:0 0 12px rgba(25,227,255,.8)}
.turned.hit.now::after{background:#ffd93d;box-shadow:0 0 12px rgba(255,217,61,.8)}
.spark{position:absolute;width:16px;height:16px;background:#ffd93d;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)}
.raretag{position:absolute;left:50%;transform:translateX(-50%) skewX(-12deg);background:#ffd93d;color:#1a1403;font:800 22px 'Barlow Condensed',sans-serif;letter-spacing:3px;padding:6px 18px;white-space:nowrap;box-shadow:0 0 18px rgba(255,217,61,.6)}
.raretag b{display:inline-block;transform:skewX(12deg)}
.adm-head th{padding-bottom:12px}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&amp;family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&amp;display=swap" rel="stylesheet">`;

/** The backfill's smoke, with a calm (a soft dark rect in the mask) under each region, as [x, y, w, h, opacity]. */
function smoke(w, h, calms, id = '') {
  const rects = calms.map(([x, y, cw, ch, o = 0.85]) => `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="#000000" opacity="${o}" filter="url(#soft${id})"></rect>`).join('\n        ');
  return `<svg aria-hidden="true" width="${w}" height="${h}" style="position: absolute; left: 0; top: 0">
    <defs>
      <filter id="sA${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.0022 0.004" numOctaves="5" seed="23"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.14  0 0 0 0 0.98  1.8 0 0 0 -0.74"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="sB${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.005" numOctaves="4" seed="61"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.85  0 0 0 0 1  0 2 0 0 -1.0"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="soft${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${w < 600 ? 30 : 60}"></feGaussianBlur></filter>
      <mask id="calm${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
        <rect width="${w}" height="${h}" fill="#ffffff"></rect>
        ${rects}
      </mask>
    </defs>
    <g mask="url(#calm${id})">
      <rect width="${w}" height="${h}" filter="url(#sA${id})" opacity="0.95"></rect>
      <rect width="${w}" height="${h}" filter="url(#sB${id})" opacity="0.5"></rect>
    </g>
  </svg>`;
}

const ESC = `<kbd style="display: inline-block; margin-right: 10px; padding: 0 6px; border: 1px solid #ffffff; font: 800 20px/1.25 'Barlow Condensed', sans-serif; letter-spacing: 1px">ESC</kbd>`;
const TABS = ['ALERTS', 'VENDING MACHINE', 'MY CHARACTERS', 'SEASON', 'MY LOG', 'GUIDE', 'UPDATES', 'SETTINGS'];

/** The menu bar every glass page shares, as the backfill draws it (nine tabs set tighter, Admin last for an admin). */
function menu(tabs, current) {
  const t = tabs.map((n) => n === current
    ? `<a href="#" class="tab" aria-current="page" style="background: rgba(25,227,255,.16); box-shadow: inset 0 -3px 0 #19e3ff; color: #ffffff"><b>${n}</b></a>`
    : `<a href="#" class="tab"><b>${n}</b></a>`).join('\n    ');
  return `<nav aria-label="Menu" class="${tabs.length > 8 ? 'many most' : 'many'}" style="position: absolute; left: 0; right: 0; top: 0; height: 84px; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 0 28px; background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
    <a href="#" class="tab" aria-keyshortcuts="Escape" style="border: 1px solid #ffffff; color: #ffffff; margin-right: 18px"><b>${ESC}BACK TO THE BOARD</b></a>
    ${t}
  </nav>`;
}

const phoneMenu = `<nav aria-label="Menu" style="position: absolute; left: 0; right: 0; top: 0; height: 70px; z-index: 5; display: flex; align-items: center; padding: 0 12px; background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
      <a href="#" class="tab" style="border: 1px solid #ffffff; color: #ffffff; min-height: 46px; font-size: 20px"><b>&lsaquo; BACK TO THE BOARD</b></a>
    </nav>`;

function page({ file, name, w, h, note, body }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${w}">
<title>${name}: the booster packs board</title>
<!-- A board of the booster packs design (docs/plans/2026-11-04-booster-packs-design.md), redrawn on 2026-11-07 after the card
     template merged (docs/plans/2026-11-05-card-template-design.md), ${w} by ${h}. ${note} Every card face and back is the
     engine's own Postcard and PostcardBack, rendered by gen.mjs in this folder with the engine's stylesheet. A reference for
     the look, not code to copy. -->
${FONTS}
<style>${FACE_CSS}
${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
  fs.writeFileSync(path.join(here, file), html);
}

const frame = (w, h, inner) => `<div style="width: ${w}px; height: ${h}px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; font-family: 'Barlow Condensed', sans-serif">
${inner}
</div>`;

const phone = (label, inner, calms, id) => `<figure aria-label="${label}" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; flex: none">
    ${smoke(390, 844, calms, id)}
    ${inner}
  </figure>`;

/* ---- the pack, a rarity's gem, and the sample pack ---- */

const RARITY = { common: ['●', '#e4def7'], uncommon: ['◆', '#2ee6ff'], rare: ['★', '#ffd93d'], legendary: ['✦', '#ff5cc8'] };
/** A rarity's gem as the face draws it: its glyph says the rarity by shape, so its color is never the only cue. */
const gem = (r) => `<span class="gem" style="--g: ${RARITY[r][1]}" data-gem="${RARITY[r][0]}" aria-hidden="true"></span>`;

/**
 * The Booster's pack in a slot, at the card's 2:3: a foil wrapper crimped at both ends, the instance's mark, its name and its
 * count. The foil and wrapper are a placeholder; the pack's art is the owner's to give (the instance's, as a card's art is).
 */
const pack = (w, part = 'whole') => {
  const u = w / 100;
  const crimp = Array.from({ length: 11 }, (_, i) => `${i * 10}% ${i % 2 ? 0 : 3.2 * u}px`).join(',');
  const crimpB = Array.from({ length: 11 }, (_, i) => `${100 - i * 10}% calc(100% - ${i % 2 ? 0 : 3.2 * u}px)`).join(',');
  /* Where the pack tears: a jagged line across its top, under the crimp. 'opened' is the pack below it, 'top' the strip above. */
  const tear = Array.from({ length: 13 }, (_, i) => `${(i * 100) / 12}% ${(i % 2 ? 9 : 14) * u}px`);
  const clip = part === 'opened' ? `${tear.join(',')},${crimpB}` : part === 'top' ? `${crimp},${[...tear].reverse().join(',')}` : `${crimp},${crimpB}`;
  return `<span aria-hidden="true" data-kb-art style="position: relative; display: block; width: ${w}px; height: ${w * 1.5}px; clip-path: polygon(${clip}); background: linear-gradient(155deg, #ffd93d 0%, #ff3d7f 34%, #7a2bff 66%, #19e3ff 100%)">
      <span style="position: absolute; left: 0; right: 0; top: ${9 * u}px; height: 1.5px; background: rgba(7,5,13,.45)"></span>
      <span style="position: absolute; left: 0; right: 0; bottom: ${9 * u}px; height: 1.5px; background: rgba(7,5,13,.45)"></span>
      <span style="position: absolute; inset: ${14 * u}px ${8 * u}px ${18 * u}px; background: linear-gradient(115deg, rgba(255,255,255,.0) 30%, rgba(255,255,255,.45) 48%, rgba(255,255,255,0) 62%)"></span>
      <img src="${coin}" alt="" style="position: absolute; left: ${25 * u}px; top: ${30 * u}px; width: ${50 * u}px; height: ${50 * u}px; filter: drop-shadow(0 0 ${3 * u}px rgba(7,5,13,.7))">
      <span style="position: absolute; left: ${6 * u}px; right: ${6 * u}px; top: ${92 * u}px; padding: ${2 * u}px 0; transform: skewX(-12deg); background: rgba(7,5,13,.88); text-align: center; font: ${15 * u}px/1 Anton, Impact, sans-serif; letter-spacing: .02em; color: #ffffff">BOOSTER</span>
      <span style="position: absolute; left: 0; right: 0; top: ${116 * u}px; text-align: center; font: 800 ${8.5 * u}px/1 'Barlow Condensed', sans-serif; letter-spacing: .14em; color: #07050d">5 CARDS</span>
    </span>`;
};

/** The emptied pack, parked at the top of the reveal: slid up past the screen's top edge, its foot in view as the reveal's head. */
const parked = (w, show, left) => `<div aria-hidden="true" style="position: absolute; left: ${left}px; top: ${show - w * 1.5}px; filter: drop-shadow(0 6px 14px rgba(7,5,13,.8))">${pack(w, 'opened')}</div>`;

/** The sample pack, in pull order: four commons-or-better, then the hit. */
const PACK = ['whoops', 'bluff', 'feelin-fab', 'stick-around', 'main-event'];

/* ==== 01: the machine, the Booster in A1 selected ==== */

const SLOT_ZOOM = 0.58; // the build's: a slot's face is laid out at 86 by 129 and zoomed (engine/ui/vending/vending.css)
const tagColor = { '#2ee6ff': ['#2ee6ff', '#03141a'], '#ff3d7f': ['#ff3d7f', '#14030a'], '#d24a2c': ['#d24a2c', '#1a0602'] };
/** A cell of the machine: the slot (a button) over its shelf edge, which holds the code and price and the info control. */
function cell({ code, key, price, was, out, selected, packSlot, sealed }) {
  const f = key && faces[key];
  const [bg, ink] = packSlot ? ['#ffd93d', '#1a1403'] : f ? tagColor[f.art.color] : ['#ffd93d', '#1a1403'];
  if (sealed) {
    return `<div class="cell" style="display: flex; flex-direction: column">
          <div role="img" aria-label="Empty slot ${code}, waiting for a future postcard" style="flex: 1; display: flex; justify-content: center; padding-top: 2px"><span style="zoom: ${SLOT_ZOOM}; box-sizing: border-box; width: 86px; height: 129px; border-radius: 6px; border: 1.5px dashed rgba(255,217,61,.55); display: flex; align-items: center; justify-content: center; font: 54px/1 Anton, Impact, sans-serif; color: transparent; -webkit-text-stroke: 1px rgba(255,217,61,.7)">?</span></div>
          <div style="display: flex; align-items: center; height: 38px; border-top: 1px solid rgba(201,248,255,.35)"><span style="font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 1px; color: #ffd93d">${code}</span></div>
        </div>`;
  }
  const name = packSlot ? 'Booster' : f.name;
  const what = packSlot ? 'a pack of 5 postcards' : `${f.rarity} ${f.play[0].toUpperCase()}${f.play.slice(1)}`;
  const label = out ? `${name}, sold out: ${out}` : `Buy ${name}, ${price} orb${was ? `, marked up from ${was}` : ''}, ${what}${selected ? ', selected' : ''}`;
  const art = packSlot ? pack(86) : face(key, 'slot');
  return `<div class="cell" style="display: flex; flex-direction: column">
          <button aria-label="${label}"${selected ? ' aria-pressed="true"' : ''}${out ? ' aria-disabled="true"' : ''} style="position: relative; flex: 1; display: flex; justify-content: center; padding: 2px 0 0; margin: 0; border: 0; background: ${selected ? 'rgba(255,217,61,.10)' : 'transparent'}; box-shadow: ${selected ? 'inset 0 0 0 2px #ffd93d, 0 0 20px rgba(255,217,61,.45)' : 'none'}; cursor: pointer">
            <span style="zoom: ${SLOT_ZOOM}; display: block; ${out ? 'filter: grayscale(1) brightness(.45)' : ''}">${art}</span>
            ${out ? `<span aria-hidden="true" style="position: absolute; left: 6px; right: 6px; top: 30px; transform: rotate(-12deg); padding: 3px 0; background: #ff3d7f; color: #14030a; text-align: center; font: 800 16px 'Barlow Condensed', sans-serif; letter-spacing: 2.5px">PULLED</span>` : ''}
          </button>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 38px; border-top: 1px solid rgba(201,248,255,.35)">
            <span aria-hidden="true" style="padding: 1px 8px; background: ${out ? 'rgba(241,236,255,.16)' : bg}; color: ${out ? '#e4def7' : ink}; font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 1px; white-space: nowrap">${code} &middot; ${out ? 'SOLD OUT' : was ? `<s style="opacity: .7">${was}</s> ${price}` : price}</span>
            <button class="btn" aria-label="About ${name}" style="min-height: 30px; width: 34px; padding: 0; font-size: 17px"><b>i</b></button>
          </div>
        </div>`;
}

const SLOTS = [
  { code: 'A1', packSlot: true, price: '3.00', selected: true },
  { code: 'A2', key: 'whoops', price: '1.00', out: 'pulled by the Boss until Nov 9' },
  { code: 'B1', key: 'stick-around', price: '1.00' },
  { code: 'B2', key: 'autocorrect', price: '1.00' },
  { code: 'C1', key: 'bluff', price: '0.25' },
  { code: 'C2', key: 'feelin-fab', price: '0.20' },
  { code: 'D1', key: 'trap-card', price: '1.50' },
  { code: 'D2', key: 'force-field', price: '1.50' },
  { code: 'E1', key: 'glitter-bomb', price: '2.25', was: '1.50' },
  { code: 'E2', sealed: true },
];

const orb = (fill, part = 1) => part === 1
  ? `<span style="width: 40px; height: 40px; border-radius: 50%; background: radial-gradient(circle at 36% 30%, #ffffff, ${fill} 46%, #07050d 120%)"></span>`
  : part === 0
    ? `<span style="box-sizing: border-box; width: 40px; height: 40px; border-radius: 50%; border: 1.5px dashed rgba(255,217,61,.75)"></span>`
    : `<span style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(0deg, ${fill} ${part * 100}%, rgba(255,217,61,.0) ${part * 100}%), #0b0914; box-shadow: inset 0 0 0 1.5px rgba(255,217,61,.75)"></span>`;

/** The selected pack's odds, pull by pull, each card's chance in the hit; the same table on the phone. */
const oddsTable = (size = 21) => `<table class="odds" style="font-size: ${size}px">
        <caption style="text-align: left; caption-side: top; padding: 0 0 2px; font: ${size === 21 ? 44 : 34}px/1 Anton, Impact, sans-serif; color: #ffffff">BOOSTER ODDS</caption>
        <tr><th colspan="2">CARDS 1 TO 4, EACH</th></tr>
        <tr><td><span class="who">${gem('common')}Common</span></td><td>85%</td></tr>
        <tr><td><span class="who">${gem('uncommon')}Uncommon</span></td><td>15%</td></tr>
        <tr><th colspan="2">CARD 5, THE HIT</th></tr>
        <tr><td><span class="who">${gem('uncommon')}Trap Card</span></td><td>25%</td></tr>
        <tr><td><span class="who">${gem('uncommon')}Force Field</span></td><td>25%</td></tr>
        <tr><td><span class="who">${gem('uncommon')}Glitter Bomb</span></td><td>25%</td></tr>
        <tr><td><span class="who">${gem('rare')}Main Event</span></td><td>25%</td></tr>
      </table>`;

const bossMoves = (size = 21) => `<h2 class="sec" style="color: #ff9cc0; font-size: ${size - 1}px">THE BOSS'S MOVES</h2>
      <p class="note" style="margin-top: 10px; font-size: ${size}px"><b style="color: #ffffff">Whoops! is pulled</b> until Nov 9, or sooner once 12 different characters post in Tomato Talk (7 so far). It still comes in Boosters.</p>
      <p class="note" style="margin-top: 12px; font-size: ${size}px"><b style="color: #ffffff">Glitter Bomb is marked up</b> from 1.50 to 2.25 until Nov 8, or sooner once 20 posts land in Tomato Talk (4 so far).</p>`;

/** "In this pack": five card backs at the slot's size, the last one the hit's gold. */
const inPack = (zoom) => `<div aria-hidden="true" style="display: flex; gap: 6px">${[0, 1, 2, 3, 4].map((i) => `<span style="zoom: ${zoom}; display: block">${back('slot', i === 4)}</span>`).join('')}</div>`;

const MACHINE = `
  ${smoke(1440, 1080, [[40, 110, 360, 640], [1060, 110, 340, 920]])}
  ${menu(TABS, 'VENDING MACHINE')}
  <main>
  <section aria-label="Your wallet and hand" style="position: absolute; left: 64px; top: 121px; width: 320px">
    <p style="margin: 0; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 4px; color: #ffd93d">SPEND AURA</p>
    <h1 style="margin: 0; font: 74px/1 Anton, Impact, sans-serif; color: #ffd93d; text-shadow: 0 0 22px rgba(255,217,61,.45)">VENDING<br>MACHINE</h1>
    <section aria-label="Your wallet" class="piece" style="--edge: rgba(255,217,61,.6); --ground: rgba(26,20,3,.92); margin-top: 28px; padding: 22px 20px 24px">
      <p class="sec" style="color: #f1ecff">WALLET &middot; SOLID ONLY</p>
      <div role="img" aria-label="Wallet: 5.62 of 6.00; buying the Booster leaves 2.62" style="display: flex; gap: 8px; margin-top: 14px">${orb('#a78bfa')}${orb('#4a8bff')}${orb('#2ee68f', 0.62)}${orb('', 0)}${orb('', 0)}${orb('', 0)}</div>
      <p style="margin: 14px 0 0; font: 600 21px 'Barlow Condensed', sans-serif">5.62 &rarr; <b style="font: 30px Anton, Impact, sans-serif; color: #ffd93d">2.62</b></p>
      <p class="note" style="margin-top: 8px; font-size: 20px">The ghost estimate can't be spent. What you buy is private: nobody else sees it until you play it.</p>
    </section>
    <a href="#" style="display: inline-flex; align-items: center; gap: 14px; margin-top: 28px; padding: 6px 22px; transform: skewX(-12deg); background: #ff3d7f; color: #14030a; text-decoration: none; box-shadow: 0 0 22px rgba(255,61,127,.5)"><b style="transform: skewX(12deg); font: 30px Anton, Impact, sans-serif">YOUR HAND</b><b style="transform: skewX(12deg); padding: 0 8px; background: #14030a; color: #ff9cc0; font: 24px Anton, Impact, sans-serif">2 &rarr; 7</b></a>
  </section>

  <section aria-label="The machine" style="position: absolute; left: 420px; top: 109px; width: 620px; height: 959px; box-sizing: border-box; border: 2px solid #ff3d7f; border-radius: 22px; box-shadow: 0 0 24px rgba(255,61,127,.45), inset 0 0 0 10px #0d0a1a, inset 0 0 0 11px rgba(201,248,255,.4); background: #0b0914">
    <p data-kb-art style="position: absolute; left: 30px; right: 30px; top: 22px; height: 80px; margin: 0; display: grid; place-items: center; border: 1px solid rgba(255,217,61,.4); border-radius: 14px; font: 56px/1 Anton, Impact, sans-serif; color: #ffd93d; text-shadow: 0 0 18px rgba(255,217,61,.75)">[MACHINE NAME]</p>
    <div style="position: absolute; left: 30px; top: 124px; width: 352px; height: 647px; box-sizing: border-box; padding: 14px; border: 1px solid rgba(201,248,255,.4); background: rgba(25,227,255,.04); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(5, 1fr); column-gap: 14px">
      ${SLOTS.map(cell).join('\n      ')}
    </div>
    <div style="position: absolute; left: 400px; top: 124px; width: 190px">
      <section aria-label="Selected" style="padding: 12px 14px 10px; border: 1px solid rgba(46,230,143,.6); background: rgba(46,230,143,.06)">
        <p class="sec" style="font-size: 17px; letter-spacing: 2px; color: #2ee68f">A1 &middot; BOOSTER</p>
        <p style="margin: 2px 0 0; font: 46px/1 Anton, Impact, sans-serif; color: #2ee68f; text-shadow: 0 0 14px rgba(46,230,143,.6)">3.00</p>
      </section>
      <section aria-label="In this pack" style="margin-top: 18px; padding: 14px; border: 1px solid rgba(201,248,255,.35)">
        <p class="sec" style="font-size: 16px; letter-spacing: 2.5px; color: #9ef4ff">IN THIS PACK</p>
        <div style="margin-top: 12px">${inPack(0.3)}</div>
        <p class="note" style="margin-top: 12px; font-size: 19px; line-height: 1.4">Five cards, the last one at least uncommon. It opens as soon as you buy it.</p>
      </section>
      <button class="kb-buy" style="display: block; width: 190px; margin-top: 18px; padding: 10px 0 12px; border: 0; background: #ff3d7f; color: #14030a; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%); cursor: pointer"><b style="display: block; font: 40px/1 Anton, Impact, sans-serif">BUY</b><span style="display: block; margin-top: 4px; font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px">BOOSTER &middot; 3.00</span></button>
    </div>
    <div data-kb-art style="position: absolute; left: 30px; right: 30px; top: 791px; height: 140px; border: 1px solid rgba(201,248,255,.4); background: #05040a">
      <span style="position: absolute; left: 14px; top: 10px; font: 800 13px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #c9c3dd">PUSH</span>
      <span style="position: absolute; right: 16px; bottom: 12px; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #ff9cc0">TO YOUR HAND</span>
    </div>
  </section>

  <aside aria-label="About the Booster" style="position: absolute; left: 1076px; top: 121px; width: 300px">
    ${oddsTable()}
    <p class="note" style="margin-top: 12px; font-size: 19px; line-height: 1.4">Main Event isn't sold on its own. Within a rarity, every card is equally likely.</p>
    <div style="margin-top: 30px; padding-top: 24px; border-top: 1px solid rgba(241,236,255,.22)">${bossMoves(20)}</div>
  </aside>
  </main>`;

page({
  file: '01-machine.html', name: 'The machine, a Booster selected', w: 1440, h: 1080,
  note: 'The machine as the build lays it out on main (its slots, shelf edges and info controls at the zoomed slot size), stocked from the admin\'s order: the Booster in A1, selected, its contents and odds shown plainly; Whoops! pulled by the Boss (A2); Glitter Bomb marked up (E1); Main Event hidden, so it draws no slot; E2 sealed.',
  body: frame(1440, 1080, MACHINE),
});

/* ==== 02, 03: the reveal ==== */


/** The row of the pack in pull order at the fan's size: turned cards face up, the rest face down, the hit's back gold. */
function row(turned, now) {
  return PACK.map((k, i) => {
    const f = faces[k];
    const hit = i === 4;
    if (i < turned) return `<li class="turned${hit ? ' hit' : ''}${i === now ? ' now' : ''}" aria-label="Card ${i + 1}: ${f.name}, ${f.tag}, ${f.rarity}${i === now ? ', the card shown' : ''}">${face(k, 'fan')}</li>`;
    return `<li aria-label="Card ${i + 1}, face down${hit ? ', the hit' : ''}">${i === turned ? `<button aria-label="Turn card ${i + 1}" style="display: block; padding: 0; border: 0; background: none; cursor: pointer">${back('fan', hit)}</button>` : back('fan', hit)}</li>`;
  }).join('\n      ');
}

const sparks = [[-34, 40, 18], [300, 20, 14], [318, 300, 20], [-30, 330, 12], [290, 420, 10], [-20, 180, 9]];

function reveal({ file, name, note, turned, title, counter, spot, buttons, hint }) {
  const hit = spot === 4;
  page({
    file, name, w: 1440, h: 1080, note,
    body: frame(1440, 1080, `
  ${smoke(1440, 1080, [[300, 30, 840, 1020, 0.9]])}
  <div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 46%, rgba(40,16,80,.45), rgba(7,5,13,.9) 72%)"></div>
  <section role="dialog" aria-modal="true" aria-label="Opening a Booster" style="position: absolute; inset: 0">
    ${parked(180, 46, 630)}
    <div style="position: absolute; left: 0; right: 0; top: 71px; text-align: center">
      <h1 style="margin: 0; font: 56px/1 Anton, Impact, sans-serif; letter-spacing: 1px; color: #ffffff">${title}</h1>
      <p role="status" style="margin: 6px 0 0; font: 800 22px 'Barlow Condensed', sans-serif; letter-spacing: 4px; color: #c9f8ff">${counter}</p>
    </div>
    <div style="position: absolute; left: 582px; top: 214px; width: 276px; height: 414px">
      ${hit ? `<div aria-hidden="true" style="position: absolute; inset: -110px; background: radial-gradient(circle, rgba(255,217,61,.38), rgba(255,217,61,.1) 45%, transparent 70%)"></div>
      ${sparks.map(([x, y, s]) => `<span class="spark" aria-hidden="true" style="left: ${x}px; top: ${y}px; width: ${s}px; height: ${s}px"></span>`).join('')}
      <p class="raretag" style="top: -50px; margin: 0; z-index: 4"><b>RARE &middot; MAIN EVENT</b></p>` : ''}
      <article aria-label="${faces[PACK[spot]].name}, ${faces[PACK[spot]].tag}, ${faces[PACK[spot]].rarity}" style="position: relative">${face(PACK[spot], 'sheet', hit ? { boxShadow: '0 0 0 2px #ffd93d, 0 0 46px rgba(255,217,61,.75), 0 30px 50px rgba(7,5,13,.9)' } : {})}</article>
    </div>
    <ol aria-label="The pack, in the order it was pulled" class="reveal-row" style="position: absolute; left: 297px; top: 660px; margin: 0; padding: 0; list-style: none">
      ${row(turned, spot)}
    </ol>
    <div style="position: absolute; left: 0; right: 0; top: 924px; display: flex; flex-direction: column; align-items: center; gap: 16px">
      <div class="btns" style="gap: 18px">${buttons}</div>
      <p class="note" style="font-size: 20px">${hint}</p>
    </div>
  </section>`),
  });
}

reveal({
  file: '02-reveal.html', name: 'Opening a Booster', turned: 3, spot: 2,
  note: 'The reveal after buying, three of five turned: the card last turned large at the sheet\'s size in the middle (the spotlight), and the pack in pull order beneath at the fan\'s size, the next card\'s back a button, the hit\'s back gold.',
  title: 'BOOSTER', counter: '3 OF 5 TURNED OVER',
  buttons: `<button class="btn gold"><b>TURN THE NEXT CARD</b></button><button class="btn"><b>TURN ALL</b></button><button class="btn"><b>${ESC}CLOSE</b></button>`,
  hint: 'Click the next card or press Space to turn it. All five are already in your hand.',
});

reveal({
  file: '03-hit.html', name: 'A Booster, all turned', turned: 5, spot: 4,
  note: 'All five turned: the hit in the spotlight, a rare Main Event with its gold tag, glow and sparkles; the pack beneath, all face up.',
  title: 'BOOSTER', counter: '5 OF 5 &middot; ALL IN YOUR HAND',
  buttons: `<button class="btn gold"><b>DONE</b></button><button class="btn"><b>${ESC}BACK TO THE MACHINE</b></button>`,
  hint: 'These five are already in your hand. Main Event isn\'t sold on its own; this is one of the ways to get it.',
});

/* ==== 05: the machine's admin page ==== */

/** The admin's pages, a strip of two under the page's lead: Moves (the queue) and The machine. */
const adminTabs = (cur, top) => `<nav aria-label="Admin pages" style="position: absolute; left: 64px; top: ${top}px"><ul class="btns" style="margin: 0; padding: 0; list-style: none; gap: 10px">${['MOVES', 'THE MACHINE'].map((n) => `<li><a href="#" class="btn sm${n === cur ? ' primary' : ''}"${n === cur ? ' aria-current="page"' : ''}><b>${n}</b></a></li>`).join('')}</ul></nav>`;

const ADMIN = [
  ['A1', 'Booster', 'pack &middot; 5 cards', 'On sale', '3.00', ''],
  ['A2', 'Whoops!', 'common', 'On sale', '1.00', ['PULLED BY THE BOSS &middot; TO NOV 9', '#ff3d7f']],
  ['B1', 'Stick Around', 'common', 'On sale', '1.00', ''],
  ['B2', 'Autocorrect', 'common', 'On sale', '1.00', ''],
  ['C1', 'Bluff', 'common', 'On sale', '0.25', ''],
  ['C2', "Feelin' Fab", 'common', 'On sale', '0.20', ''],
  ['D1', 'Trap Card', 'uncommon', 'On sale', '1.50', ''],
  ['D2', 'Force Field', 'uncommon', 'On sale', '1.50', ''],
  ['E1', 'Glitter Bomb', 'uncommon', 'On sale', '1.50', ['MARKED UP &times;1.5 &middot; 2.25 TO NOV 8', '#ff3d7f']],
  ['&ndash;', 'Main Event', 'rare', 'Hidden', '3.00', 'Only in packs. The Boss may flash-sale it.'],
];

const arrow = (dir, off) => `<button class="btn sm" aria-label="Move ${dir}"${off ? ' disabled' : ''} style="width: 44px; padding: 0; ${off ? 'opacity: .35; cursor: default' : ''}"><b>${dir === 'up' ? '&uarr;' : '&darr;'}</b></button>`;

const adminRow = ([slot, name, kind, avail, price, boss], i, all) => `<tr style="border-top: 1px solid rgba(241,236,255,.14)">
          <td style="padding: 8px 0; font: 800 21px 'Barlow Condensed', sans-serif; color: #ffd93d">${slot}</td>
          <td><span style="display: flex; gap: 8px">${arrow('up', i === 0)}${arrow('down', i === all.length - 1)}</span></td>
          <th scope="row" style="text-align: left; font: 700 21px/1.15 'Barlow Condensed', sans-serif">${name}<br><span style="font-weight: 500; font-size: 18px; color: #e4def7">${kind}</span></th>
          <td><select class="sel" aria-label="${name}: availability"><option>${avail}</option></select></td>
          <td><input class="num" aria-label="${name}: price" value="${price}"></td>
          <td>${Array.isArray(boss) ? `<span class="tag" style="border: 1px solid ${boss[1]}; color: #ff9cc0"><b>${boss[0]}</b></span> <a href="#" class="lnk" style="margin-left: 10px; font-size: 19px; white-space: nowrap">In the queue</a>` : `<span class="note" style="font-size: 19px">${boss}</span>`}</td>
        </tr>`;

page({
  file: '05-admin.html', name: 'The machine, for an admin', w: 1440, h: 1180,
  note: 'The machine\'s admin page under the menu\'s Admin tab, its two pages (Moves, the queue, and The machine) in a strip under the lead: the slots in grid order with move up and down, availability, price, and any Boss move in force linked to its row in the queue; one Save changes for the page.',
  body: frame(1440, 1180, `
  ${smoke(1440, 1180, [[40, 100, 1360, 1040]])}
  ${menu([...TABS, 'ADMIN'], 'ADMIN')}
  <main>
  <h1 style="position: absolute; left: 64px; top: 120px; margin: 0; font: 112px/1 Anton, Impact, sans-serif; letter-spacing: 1px; text-shadow: 0 0 30px rgba(25,227,255,.35)">THE MACHINE</h1>
  <p class="lead" style="position: absolute; left: 64px; top: 238px; max-width: 900px">The slots in the order players see them. A hidden slot draws nothing; a sold-out slot shows greyed. What a pack can roll is set in the code, with the cards.</p>
  ${adminTabs('THE MACHINE', 322)}
  <form style="position: absolute; left: 64px; top: 404px; width: 1312px">
    <table style="width: 100%; border-collapse: collapse; color: #f1ecff">
      <thead><tr class="adm-head" style="font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 2.5px; color: #19e3ff; text-align: left">
        <th style="width: 90px">SLOT</th><th style="width: 150px">ORDER</th><th style="width: 260px">ITEM</th><th style="width: 200px">AVAILABILITY</th><th style="width: 170px">PRICE</th><th>THE BOSS</th>
      </tr></thead>
      <tbody>
        ${ADMIN.map(adminRow).join('\n        ')}
      </tbody>
    </table>
    <div class="btns" style="margin-top: 26px; padding-top: 22px; border-top: 1px solid rgba(241,236,255,.22)"><button class="btn primary"><b>SAVE CHANGES</b></button><span class="note" style="font-size: 20px">Players see a saved price at once. A Boss move in force reads the new price.</span></div>
  </form>
  </main>`),
});

/* ==== 04: the phone, four screens at 390 by 844 ==== */

const pTitle = (t, top = 92) => `<h1 style="position: absolute; left: 16px; top: ${top}px; width: 358px; margin: 0; font: 56px/1 Anton, Impact, sans-serif; letter-spacing: .5px; color: #ffd93d; text-shadow: 0 0 22px rgba(255,217,61,.4)">${t}</h1>`;

const phoneMachine = `${phoneMenu}
    <main style="position: absolute; left: 16px; top: 86px; width: 358px">
      <section aria-label="Selected" style="padding: 10px 14px; border: 1px solid rgba(46,230,143,.6); background: rgba(46,230,143,.06)">
        <p class="sec" style="font-size: 16px; letter-spacing: 2px; color: #2ee68f">A1 &middot; BOOSTER</p>
        <p style="margin: 2px 0 0; font: 40px/1 Anton, Impact, sans-serif; color: #2ee68f">3.00</p>
      </section>
      <section aria-label="In this pack" style="display: flex; gap: 14px; align-items: center; margin-top: 12px; padding: 12px 14px; border: 1px solid rgba(201,248,255,.35)">
        <div style="flex: none">${inPack(0.26)}</div>
        <p class="note" style="font-size: 17px; line-height: 1.35">Five cards, the last one at least uncommon. It opens as soon as you buy it.</p>
      </section>
      <button style="display: block; width: 100%; margin-top: 12px; padding: 8px 0 10px; border: 0; background: #ff3d7f; color: #14030a; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)"><b style="display: block; font: 34px/1 Anton, Impact, sans-serif">BUY</b><span style="display: block; margin-top: 2px; font: 800 17px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px">BOOSTER &middot; 3.00</span></button>
      <aside aria-label="About the Booster" style="margin-top: 22px">
        ${oddsTable(17)}
        <p class="note" style="margin-top: 10px; font-size: 17px; line-height: 1.4">Main Event isn't sold on its own. Within a rarity, every card is equally likely.</p>
      </aside>
    </main>`;

/** The phone's reveal: the pack is a pile at the sheet's size, the top card turned with a tap, and a row of five counting down. */
const phoneReveal = (turned, spot, buttons, hint, counter) => `<section role="dialog" aria-modal="true" aria-label="Opening a Booster" style="position: absolute; inset: 0">
      <div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 46%, rgba(40,16,80,.45), rgba(7,5,13,.9) 72%)"></div>
      ${parked(120, 28, 135)}
      <div style="position: absolute; left: 0; right: 0; top: 38px; text-align: center">
        <h1 style="margin: 0; font: 44px/1 Anton, Impact, sans-serif; color: #ffffff">BOOSTER</h1>
        <p role="status" style="margin: 4px 0 0; font: 800 18px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #c9f8ff">${counter}</p>
        <div aria-hidden="true" style="display: flex; justify-content: center; gap: 8px; margin-top: 10px">${[0, 1, 2, 3, 4].map((i) => `<span style="box-sizing: border-box; width: 18px; height: 27px; border-radius: 3px; ${i < turned ? 'background: rgba(241,236,255,.3)' : `border: 1.5px solid ${i === 4 ? '#ffd93d' : 'rgba(241,236,255,.6)'}`}"></span>`).join('')}</div>
      </div>
      <div style="position: absolute; left: 57px; top: 214px; width: 276px; height: 414px">
        ${turned < 5 ? `<span aria-hidden="true" style="position: absolute; left: 12px; top: 10px; transform: rotate(5deg)">${back('sheet', turned === 4)}</span>` : ''}
        ${spot === 4 ? `<p class="raretag" style="top: -40px; margin: 0; z-index: 4; font-size: 18px"><b>RARE &middot; MAIN EVENT</b></p>` : ''}
        <article aria-label="${faces[PACK[spot]].name}" style="position: relative">${face(PACK[spot], 'sheet', spot === 4 ? { boxShadow: '0 0 0 2px #ffd93d, 0 0 40px rgba(255,217,61,.75)' } : {})}</article>
      </div>
      <div style="position: absolute; left: 16px; right: 16px; top: 650px; display: flex; flex-direction: column; align-items: stretch; gap: 12px">
        ${buttons}
        <p class="note" style="font-size: 17px; text-align: center">${hint}</p>
      </div>
    </section>`;

const phoneAdmin = `${phoneMenu}
    <main style="position: absolute; left: 16px; top: 86px; width: 358px">
      <h1 style="margin: 0; font: 56px/1 Anton, Impact, sans-serif">THE MACHINE</h1>
      <nav aria-label="Admin pages" style="display: flex; gap: 8px; margin-top: 12px"><a href="#" class="btn sm"><b>MOVES</b></a><a href="#" class="btn sm primary" aria-current="page"><b>THE MACHINE</b></a></nav>
      <ol style="margin: 16px 0 0; padding: 0; list-style: none">
        ${ADMIN.slice(0, 3).map(([slot, name, kind, avail, price, boss], i) => `<li style="padding: 12px 0; border-top: 1px solid rgba(241,236,255,.22)">
          <div style="display: flex; justify-content: space-between; align-items: center"><b style="font: 700 20px 'Barlow Condensed', sans-serif"><span style="color: #ffd93d">${slot}</span> &nbsp;${name} <span style="font-weight: 500; font-size: 17px; color: #e4def7">${kind}</span></b><span style="display: flex; gap: 6px">${arrow('up', i === 0)}${arrow('down', false)}</span></div>
          <div style="display: flex; gap: 10px; margin-top: 10px"><select class="sel" style="flex: 1; height: 44px; font-size: 18px" aria-label="${name}: availability"><option>${avail}</option></select><input class="num" style="height: 44px; width: 96px; font-size: 18px" aria-label="${name}: price" value="${price}"></div>
          ${Array.isArray(boss) ? `<p style="margin: 10px 0 0"><span class="tag" style="font-size: 15px; border: 1px solid ${boss[1]}; color: #ff9cc0"><b>${boss[0]}</b></span> <a href="#" class="lnk" style="font-size: 17px">In the queue</a></p>` : ''}
        </li>`).join('')}
      </ol>
      <p class="note" style="font-size: 17px; padding-top: 8px; border-top: 1px solid rgba(241,236,255,.22)">&hellip; seven more slots, then Save changes.</p>
    </main>`;

page({
  file: '04-phone.html', name: 'Booster packs on a phone', w: 1660, h: 884,
  note: 'Four phone screens at 390 by 844: the machine scrolled to the selected Booster (its price, what is in it, Buy and its odds, which follow the slots on the phone); the reveal as a pile, three turned; all five turned, the hit on top; and the admin page, each slot a block of its own.',
  body: `<div style="width: 1660px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('The machine, a Booster selected', phoneMachine, [[0, 70, 390, 774]], 'p1')}
  ${phone('Opening a Booster', phoneReveal(3, 2, `<button class="btn gold" style="min-height: 48px"><b>TAP FOR THE NEXT CARD</b></button><div style="display: flex; gap: 10px"><button class="btn" style="flex: 1; min-height: 44px; font-size: 19px"><b>TURN ALL</b></button><button class="btn" style="flex: 1; min-height: 44px; font-size: 19px"><b>CLOSE</b></button></div>`, 'Tap the card, or swipe it away, to turn the next one.', '3 OF 5 TURNED OVER'), [[0, 0, 390, 844, 0.9]], 'p2')}
  ${phone('A Booster, all turned', phoneReveal(5, 4, `<button class="btn gold" style="min-height: 48px"><b>DONE</b></button>`, 'These five are already in your hand.', '5 OF 5 &middot; ALL IN YOUR HAND'), [[0, 0, 390, 844, 0.9]], 'p3')}
  ${phone('The machine, for an admin', phoneAdmin, [[0, 70, 390, 774]], 'p4')}
</div>`,
});

await import('./motion/prototype.mjs').then((m) => m.write({ MACHINE, FACE_CSS, CSS, FONTS, smoke, face, back, pack, parked, faces, PACK, ESC, root, here }));

console.log('wrote 01-machine, 02-reveal, 03-hit, 04-phone, 05-admin, motion/prototype.html');
