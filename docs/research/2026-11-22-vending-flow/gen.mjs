// Writes the Vending Machine flow boards (docs/plans/2026-11-22-vending-machine-flow-design.md) into this folder:
// `node docs/research/2026-11-22-vending-flow/gen.mjs`. Each board is one self-contained HTML file at a fixed size, in the
// two-worlds boards' style (docs/research/2026-10-29-two-worlds/): a reference for the look and the layout, not code to copy.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ART = '../../../instances/divided-world/ui/cards';
const PACK_ART = '../../../engine/ui/vending/pack-test-art.webp';

const CYAN = '#19e3ff', GOLD = '#ffd93d', PINK = '#ff3d7f', INK = '#f1ecff', SOFT = '#e4def7', GROUND = '#07050d';
const RED = '#d24a2c', CARD_CYAN = '#2ee6ff';

/** The machine's ten slots in the boards fixture's `07-vending` moment. */
const SLOTS = [
  { code: 'A1', name: 'Booster', price: '3.00', color: GOLD, ink: '#1a1200', art: PACK_ART, pack: true },
  { code: 'A2', name: 'Autocorrect', price: '1.00', color: RED, ink: '#0d0301', art: `${ART}/autocorrect/art.webp` },
  { code: 'B1', name: 'Below the Fold', price: '1.00', color: PINK, ink: '#14030a', art: `${ART}/below-the-fold/art.webp` },
  { code: 'B2', name: "Feelin' Fab", price: '0.20', color: CARD_CYAN, ink: '#03141a', art: `${ART}/feelin-fab/art.webp` },
  { code: 'C1', name: 'Hype-Up', price: '1.00', color: CARD_CYAN, ink: '#03141a', art: `${ART}/hype-up/art.webp` },
  { code: 'C2', name: 'Overreaction', price: '1.00', color: RED, ink: '#0d0301', art: `${ART}/overreaction/art.webp` },
  { code: 'D1', name: 'Stick Around', price: '1.00', color: CARD_CYAN, ink: '#03141a', art: `${ART}/stick-around/art.webp` },
  { code: 'D2', name: 'THIS', price: '0.20', color: RED, ink: '#0d0301', art: `${ART}/this/art.webp` },
  { code: 'E1', name: 'Whoops!', price: '1.00', color: PINK, ink: '#14030a', art: `${ART}/whoops/art.webp` },
  { code: 'E2', name: 'You Were Saying?', price: '1.00', color: RED, ink: '#0d0301', art: `${ART}/you-were-saying/art.webp` },
];

/** A chamfered polygon: the top right and bottom left corners cut by `c` px, the glass's panel. */
const cut = (c) => `polygon(0 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% 100%, ${c}px 100%, 0 calc(100% - ${c}px))`;

const CSS = `
body{margin:0;background:${GROUND}}
a{color:inherit}
*{box-sizing:border-box}
button{font:inherit;color:inherit}
a:focus-visible,button:focus-visible{outline:3px solid #fff;outline-offset:3px}
.orb{position:relative;width:40px;height:40px;border-radius:50%;overflow:hidden;flex:none;background:radial-gradient(circle at 50% 60%,#1c1533,#07060c 72%);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.22)}
.orb .liq,.orb .spend{position:absolute;left:0;right:0}.orb .liq{bottom:0}
.orb .spend{background:repeating-linear-gradient(135deg,rgba(255,61,127,.95) 0 2px,rgba(255,61,127,.15) 2px 5px)}
.orb .gloss{position:absolute;left:17%;top:8%;width:48%;height:30%;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,rgba(255,255,255,.9),rgba(255,255,255,0) 70%)}
.c1{background:radial-gradient(circle at 38% 30%,#ead6ff,#b46cff 52%,#3d1475)}
.c2{background:radial-gradient(circle at 38% 30%,#d6e9ff,#3d9bff 52%,#0c3275)}
.c3{background:radial-gradient(circle at 38% 30%,#d6fff0,#2ef0a0 52%,#08603f)}
.c4{background:radial-gradient(circle at 38% 30%,#fff7d6,#ffd93d 52%,#7a5c06)}
.c5{background:radial-gradient(circle at 38% 30%,#ffe7d6,#ff9a3d 52%,#7a3406)}
.tab{display:flex;align-items:center;min-height:52px;padding:0 15px;transform:skewX(-10deg);text-decoration:none;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:${SOFT};white-space:nowrap}
.tab b{display:inline-block;transform:skewX(10deg);font-weight:800}
.label{font:800 20px 'Barlow Condensed',sans-serif;letter-spacing:3px;color:${SOFT};text-transform:uppercase}
.fine{margin:0;font:500 21px/1.5 'Barlow Condensed',sans-serif;color:${SOFT}}
.frame{position:absolute;inset:0;clip-path:${cut(18)}}
.flicker{animation:flicker 6s steps(1) infinite}
@keyframes flicker{0%,100%{opacity:1}47%{opacity:1}48%{opacity:.55}49%{opacity:1}83%{opacity:1}84%{opacity:.7}85%{opacity:1}}
@media (prefers-reduced-motion: reduce){.flicker{animation:none}}
`;

const head = (title, width) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}">
<title>${title}: the Vending Machine flow board</title>
<!-- A board of the Vending Machine flow design session (docs/plans/2026-11-22-vending-machine-flow-design.md), written by
     gen.mjs in this folder. A reference for the look and the layout, not code to copy. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&amp;family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&amp;display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>`;

/** The smoke, as the two-worlds boards draw it, with calms over the text blocks. */
const smoke = (w, h, calms) => `
  <svg aria-hidden="true" width="${w}" height="${h}" style="position:absolute;left:0;top:0">
    <defs>
      <filter id="vA" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.0022 0.004" numOctaves="5" seed="71"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.14  0 0 0 0 0.98  1.8 0 0 0 -0.78"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="vB" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.005" numOctaves="4" seed="19"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.17  0 0 0 0 0.84  0 2 0 0 -1.05"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="vC" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.0034 0.006" numOctaves="4" seed="3"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.85  0 0 0 0 0.24  0 0 2 0 -1.15"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="vSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="60"></feGaussianBlur></filter>
      <mask id="vCalm" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
        <rect width="${w}" height="${h}" fill="#fff"></rect>
        ${calms.map(([x, y, cw, ch]) => `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="#000" opacity="0.85" filter="url(#vSoft)"></rect>`).join('')}
      </mask>
    </defs>
    <g mask="url(#vCalm)">
      <rect width="${w}" height="${h}" filter="url(#vA)" opacity="0.85"></rect>
      <rect width="${w}" height="${h}" filter="url(#vB)" opacity="0.45"></rect>
      <rect width="${w}" height="${h}" filter="url(#vC)" opacity="0.3"></rect>
    </g>
  </svg>`;

/** Six orbs for a balance in hundredths, with `spend` hundredths striped as the drain's preview. */
function orbs(balance, spend = 0, size = 40) {
  const colors = ['c1', 'c2', 'c3', 'c4', 'c5', 'c1'];
  const after = balance - spend;
  return Array.from({ length: 6 }, (_, i) => {
    const lo = i * 100;
    const fill = Math.max(0, Math.min(100, after - lo));
    const was = Math.max(0, Math.min(100, balance - lo));
    const stripe = was - fill;
    return `<div class="orb" style="width:${size}px;height:${size}px">${fill ? `<div class="liq ${colors[i]}" style="height:${fill}%"></div>` : ''}${stripe ? `<div class="spend" style="bottom:${fill}%;height:${stripe}%"></div>` : ''}<div class="gloss"></div></div>`;
  }).join('');
}

/** The circled i, drawn: never a letter the uppercase transform can reach. */
const infoIcon = (size) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(7,5,13,.85)" stroke="#c9f8ff" stroke-width="1.8"></circle><circle cx="12" cy="7.4" r="1.5" fill="#c9f8ff"></circle><rect x="10.8" y="10.2" width="2.4" height="7.6" rx=".4" fill="#c9f8ff"></rect></svg>`;

/** One slot cell: the chamfered cell, the card's face, the chip inside its bottom border and the info control in its corner. */
function cell(s, { picked = false, short = false, w, h, face, phone = false }) {
  const edge = picked ? (short ? PINK : CYAN) : 'rgba(201,248,255,.38)';
  const glow = picked ? `filter:drop-shadow(0 0 10px ${short ? 'rgba(255,61,127,.6)' : 'rgba(25,227,255,.6)'})` : '';
  const fh = h - 12 - 8 - 30 - 10, fw = Math.round(fh / 1.5);
  const tap = phone ? 44 : 36;
  return `
        <div style="position:relative;width:${w}px;height:${h}px;${glow}">
          <div class="frame" aria-hidden="true" style="clip-path:${cut(12)};background:${edge}"></div>
          <div class="frame" aria-hidden="true" style="clip-path:${cut(12)};inset:${picked ? 2 : 1.5}px;background:${picked ? (short ? 'rgba(40,6,20,.96)' : 'rgba(6,30,40,.96)') : 'rgba(10,8,22,.94)'}"></div>
          <button role="radio" aria-checked="${picked}" aria-label="${s.name}, ${s.price} ${s.price === '1.00' ? 'orb' : 'orbs'}" tabindex="${picked ? 0 : -1}" style="position:absolute;inset:0;padding:0;border:0;background:transparent;cursor:pointer">
            <span style="position:absolute;left:50%;top:${phone ? 12 : 12}px;width:${fw}px;height:${fh}px;margin-left:-${fw / 2}px;overflow:hidden;box-shadow:0 0 0 1.5px ${s.color},0 0 14px ${s.color}66;clip-path:${cut(6)};background:#0b0914">
              ${s.pack ? `<span style="position:absolute;inset:0;background:linear-gradient(135deg,#fff3b0,#ffd93d 30%,#b46cff 60%,#2ee6ff);display:flex;align-items:center;justify-content:center"><span style="font:${phone ? 20 : 18}px/1 Anton,Impact,sans-serif;letter-spacing:1px;color:#1a1200;transform:rotate(-8deg);background:rgba(255,255,255,.7);padding:4px 6px">BOOSTER</span></span>` : `<img alt="" src="${s.art}" style="width:100%;height:100%;object-fit:cover;display:block">`}
              ${s.pack ? '' : `<span style="position:absolute;left:0;right:0;bottom:0;padding:3px 4px;background:rgba(7,5,13,.82);font:${phone ? 12 : 11}px/1 Anton,Impact,sans-serif;letter-spacing:.5px;color:#fff;text-transform:uppercase;text-align:left">${s.name}</span>`}
            </span>
            <span style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;bottom:10px;font:800 20px/1 'Barlow Condensed',sans-serif;letter-spacing:1px;background:${s.color};color:${s.ink};padding:3px 7px">${s.code} · ${s.price}</span>
          </button>
          <button aria-label="About ${s.name}" tabindex="${picked ? 0 : -1}" style="position:absolute;right:4px;top:4px;width:${tap}px;height:${tap}px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer">${infoIcon(phone ? 28 : 26)}</button>
        </div>`;
}

/** The machine's body and marquee, chamfered. */
function body({ w, h, sign, signSize }) {
  return `
      <div aria-hidden="true" style="position:absolute;inset:0;clip-path:${cut(28)};background:${PINK};filter:drop-shadow(0 0 22px rgba(255,61,127,.45))"></div>
      <div aria-hidden="true" style="position:absolute;inset:2px;clip-path:${cut(27)};background:#0d0819"></div>
      <div aria-hidden="true" style="position:absolute;inset:12px;clip-path:${cut(22)};background:rgba(25,227,255,.45)"></div>
      <div aria-hidden="true" style="position:absolute;inset:13px;clip-path:${cut(21)};background:#120b22"></div>
      <div aria-hidden="true" style="position:absolute;left:30px;right:30px;top:26px;height:${Math.round(signSize * 1.6)}px;clip-path:${cut(14)};background:rgba(255,217,61,.45)"></div>
      <div aria-hidden="true" style="position:absolute;left:31px;right:31px;top:27px;height:${Math.round(signSize * 1.6) - 2}px;clip-path:${cut(13)};background:#07040e;display:flex;align-items:center;justify-content:center">
        <span class="flicker" style="font:${signSize}px/1 Anton,Impact,sans-serif;letter-spacing:3px;color:#fff4c4;text-shadow:0 0 6px ${GOLD},0 0 18px ${GOLD},0 0 36px rgba(255,154,61,.8)">${sign}</span>
      </div>`;
}

/** A primary skewed button, or a muted one. */
function buyButton({ words, sub, muted = false, height = 64, width = '100%', described, stack = false }) {
  const bg = muted ? 'rgba(228,222,247,.10)' : PINK;
  const fg = muted ? '#b7afd6' : '#14030a';
  return `<button ${muted ? `aria-disabled="true"${described ? ` aria-describedby="${described}"` : ''}` : ''} style="display:flex;flex-direction:${stack ? 'column' : 'row'};align-items:center;justify-content:center;gap:${stack ? 2 : 12}px;width:${width};min-height:${height}px;padding:0 18px;border:${muted ? '1.5px dashed rgba(228,222,247,.4)' : '0'};transform:skewX(-10deg);background:${bg};color:${fg};cursor:pointer;${muted ? '' : 'box-shadow:0 0 22px rgba(255,61,127,.5)'}">
            <span style="transform:skewX(10deg);font:32px/1 Anton,Impact,sans-serif;letter-spacing:1px">${words}</span>${sub ? `<span style="transform:skewX(10deg);font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:1px">${sub}</span>` : ''}
          </button>`;
}

/** The hand counter: where a bought card lands. */
const handCounter = (from, to, { size = 28 } = {}) => `<div style="display:flex;align-items:center;gap:10px">
              <span class="label" style="font-size:18px;color:${PINK}">Your hand</span>
              <span style="font:${size}px/1 Anton,Impact,sans-serif;color:${INK};background:#14030a;box-shadow:0 0 0 1.5px ${PINK};padding:4px 10px">${to === null ? from : `${from} → <b style="color:${GOLD};font-weight:400">${to}</b>`}</span>
            </div>`;

/** The tray: a stage with no words, holding a resting card or nothing. */
function tray({ w, h, card }) {
  return `<div aria-hidden="true" style="position:relative;width:${w}px;height:${h}px">
            <div style="position:absolute;inset:0;clip-path:${cut(12)};background:rgba(201,248,255,.32)"></div>
            <div style="position:absolute;inset:1.5px;clip-path:${cut(11)};background:linear-gradient(180deg,#030106 0%,#0c0718 100%)"></div>
            <div style="position:absolute;left:14px;right:14px;bottom:12px;height:2px;background:rgba(25,227,255,.35)"></div>
            ${card ? `<span style="position:absolute;left:24px;bottom:16px;width:${Math.round((h - 34) / 1.5)}px;height:${h - 34}px;transform:rotate(-6deg);overflow:hidden;clip-path:${cut(6)};box-shadow:0 0 0 1.5px ${card.color};background:#0b0914;filter:drop-shadow(0 0 12px ${card.color}88)">
              <img alt="" src="${card.art}" style="width:100%;height:100%;object-fit:cover;display:block">
              <span style="position:absolute;left:0;right:0;bottom:0;padding:3px 4px;background:rgba(7,5,13,.82);font:11px/1 Anton,Impact,sans-serif;color:#fff;text-transform:uppercase">${card.name}</span>
            </span>` : ''}
          </div>`;
}

/** The price display: the picked slot and its price, or the bought state, or the short state. */
function display({ state, slot, w, phone = false }) {
  const pad = phone ? '12px 16px' : '16px 20px';
  if (state === 'bought') {
    return `<div role="status" style="position:relative;width:${w};padding:${pad};clip-path:${cut(12)};background:rgba(255,217,61,.08);box-shadow:inset 0 0 0 1.5px rgba(255,217,61,.6)">
            <div class="label" style="color:${GOLD};font-size:${phone ? 18 : 20}px">Bought · ${slot.name}</div>
            <div style="font:${phone ? 40 : 52}px/1.05 Anton,Impact,sans-serif;color:${GOLD};text-shadow:0 0 18px rgba(255,217,61,.45)">4.62 <span style="font:800 ${phone ? 22 : 26}px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:${INK}">LEFT</span></div>
          </div>`;
  }
  const short = state === 'short';
  const c = short ? PINK : '#2ef0a0';
  return `<div role="status" style="position:relative;width:${w};padding:${pad};clip-path:${cut(12)};background:${short ? 'rgba(255,61,127,.08)' : 'rgba(46,240,160,.06)'};box-shadow:inset 0 0 0 1.5px ${short ? 'rgba(255,61,127,.7)' : 'rgba(46,240,160,.5)'}">
            <div class="label" style="color:${short ? '#ffb3cd' : '#9ff7d2'};font-size:${phone ? 18 : 20}px">${slot.code} · ${slot.name}</div>
            <div style="font:${phone ? 40 : 52}px/1.05 Anton,Impact,sans-serif;color:${c};text-shadow:0 0 18px ${short ? 'rgba(255,61,127,.45)' : 'rgba(46,240,160,.45)'}">${slot.price}</div>
            ${short ? `<div id="need" style="font:800 ${phone ? 19 : 21}px 'Barlow Condensed',sans-serif;letter-spacing:1px;color:#ffb3cd">NEED ${slot.price} · HAVE 1.62 SOLID</div>` : ''}
          </div>`;
}

const menu = (w, phone) => phone ? `
  <nav aria-label="Menu" style="position:absolute;left:0;right:0;top:0;height:64px;z-index:5;display:flex;align-items:center;gap:6px;padding:0 12px;background:rgba(7,5,13,.94);border-bottom:1px solid #9ef4ff;box-shadow:0 1px 10px rgba(25,227,255,.35);overflow:hidden">
    <a href="#" class="tab" style="border:1px solid #fff;color:#fff;min-height:44px;padding:0 14px;font-size:20px"><b>‹ BACK</b></a>
    <a href="#" class="tab" aria-current="page" style="background:rgba(25,227,255,.16);box-shadow:inset 0 -3px 0 ${CYAN};color:#fff;min-height:44px;padding:0 14px;font-size:20px"><b>VENDING MACHINE</b></a>
    <a href="#" class="tab" style="min-height:44px;padding:0 14px;font-size:20px"><b>MY CHARACTERS</b></a>
  </nav>` : `
  <nav aria-label="Menu" style="position:absolute;left:0;right:0;top:0;height:84px;z-index:5;display:flex;align-items:center;gap:8px;padding:0 40px;background:rgba(7,5,13,.9);border-bottom:1px solid #9ef4ff;box-shadow:0 1px 12px rgba(25,227,255,.35)">
    <a href="#" class="tab" aria-keyshortcuts="Escape" style="border:1px solid #fff;color:#fff;margin-right:18px"><b><kbd style="display:inline-block;margin-right:10px;padding:0 6px;border:1px solid #fff;font:800 18px 'Barlow Condensed',sans-serif">ESC</kbd>BACK TO THE BOARD</b></a>
    <a href="#" class="tab"><b>ALERTS</b></a>
    <a href="#" class="tab" aria-current="page" style="background:rgba(25,227,255,.16);box-shadow:inset 0 -3px 0 ${CYAN};color:#fff"><b>VENDING MACHINE</b></a>
    <a href="#" class="tab"><b>MY CHARACTERS</b></a>
    <a href="#" class="tab"><b>SEASON</b></a>
    <a href="#" class="tab"><b>MY LOG</b></a>
    <a href="#" class="tab"><b>GUIDE</b></a>
    <a href="#" class="tab"><b>UPDATES</b></a>
    <a href="#" class="tab"><b>SETTINGS</b></a>
  </nav>`;

/* ---------- The desk boards: 1440 by 1080 ---------- */

function desk({ state, title, file, note }) {
  const C2 = SLOTS[5];
  const picked = state === 'picked';
  const bought = state === 'bought';
  const balance = bought ? 462 : 562;
  const spend = picked ? 100 : 0;
  const cellW = 172, cellH = 190, face = 0, gap = 12;
  const slotsHtml = SLOTS.map((s) => cell(s, { picked: picked && s === C2, w: cellW, h: cellH, face })).join('');
  const html = `${head(title, 1440)}
<body>
<div style="width:1440px;height:1080px;position:relative;overflow:hidden;background:${GROUND};color:${INK};font-family:'Barlow Condensed',sans-serif">
  ${menu(1440, false)}
  ${smoke(1440, 1080, [[40, 96, 370, 560], [1100, 96, 320, 400]])}

  <!-- left: the title and the wallet alone (design, 10) -->
  <aside style="position:absolute;left:64px;top:120px;width:320px;display:flex;flex-direction:column;gap:24px">
    <div>
      <div style="font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:4px;color:${GOLD}">SPEND AURA</div>
      <h1 style="margin:0;font:86px/0.95 Anton,Impact,sans-serif;letter-spacing:1px;color:${GOLD};text-shadow:0 0 30px rgba(255,217,61,.35)">VENDING MACHINE</h1>
    </div>
    <section aria-label="Your wallet" style="position:relative;padding:18px 20px">
      <div aria-hidden="true" style="position:absolute;inset:0;clip-path:${cut(22)};background:rgba(255,217,61,.5)"></div>
      <div aria-hidden="true" style="position:absolute;inset:1.5px;clip-path:${cut(21)};background:rgba(16,11,10,.94)"></div>
      <div style="position:relative">
        <div class="label">Wallet</div>
        <div role="img" aria-label="Wallet: ${(balance / 100).toFixed(2)} of 6.00 solid${picked ? '; buying Overreaction leaves 4.62' : ''}" style="display:flex;gap:8px;margin-top:12px">${orbs(balance, spend)}</div>
        <p style="margin:12px 0 0;font:600 22px 'Barlow Condensed',sans-serif">${picked ? `5.62 → <b style="font:28px Anton,Impact,sans-serif;color:${GOLD};font-weight:400">4.62</b>` : `<b style="font:28px Anton,Impact,sans-serif;font-weight:400">${(balance / 100).toFixed(2)}</b>`} <span style="color:${SOFT}">of 6.00 solid</span></p>
        <p class="fine" style="margin-top:10px">Only solid Aura spends. Your live estimate settles into it each day.</p>
        <p class="fine" style="margin-top:8px">What you buy is private: nobody else sees it until you play it.</p>
      </div>
    </section>
    <a href="#" style="font:700 21px 'Barlow Condensed',sans-serif;color:#9ef4ff;text-decoration:underline;text-underline-offset:4px">See your hand, on the board ›</a>
  </aside>

  <!-- the machine: chamfered, its slots a radiogroup of cells, its decision column sticky beside them (design, 2, 5, 8) -->
  <div role="group" aria-label="Vending Machine" style="position:absolute;left:420px;top:108px;width:640px;height:1160px">
    ${body({ w: 640, h: 1160, sign: 'FRESH BEEF', signSize: 52 })}
    <div role="radiogroup" aria-label="Slots" style="position:absolute;left:30px;top:124px;display:grid;grid-template-columns:repeat(2,${cellW}px);gap:${gap}px">${slotsHtml}
    </div>

    <!-- the decision column: sticky under the menu bar while the slots scroll -->
    <div style="position:absolute;left:412px;top:124px;width:200px;display:flex;flex-direction:column;gap:16px">
      ${picked ? display({ state: 'picked', slot: C2, w: '200px' }) : bought ? display({ state: 'bought', slot: C2, w: '200px' }) : ''}
      ${picked ? buyButton({ words: 'BUY', sub: 'OVERREACTION · 1.00', height: 84, stack: true }) : bought ? buyButton({ words: 'BUY ANOTHER', height: 64 }) : ''}
      ${bought ? `<p class="fine" style="font-size:21px">Overreaction is in your hand.</p>` : ''}
      ${tray({ w: 200, h: 150, card: bought ? C2 : null })}
      ${handCounter(bought ? 3 : 2, picked ? 3 : null)}
    </div>
  </div>

  <!-- the right column keeps its place for a pack's odds and the Boss's moves; this moment has neither -->
  <div style="position:absolute;left:1100px;top:130px;width:300px">
    <p class="fine" style="color:#b7afd6">${note}</p>
  </div>
</div>
</body>
</html>
`;
  writeFileSync(join(here, file), html);
}

/* ---------- The phone boards: 390 by 844 ---------- */

function phone({ state, title, file }) {
  const short = state === 'short';
  const info = state === 'info';
  const pick = short ? SLOTS[0] : SLOTS[1];
  const balance = short ? 162 : 562;
  const cellW = 163, cellH = 196, face = 0;
  const slotsHtml = SLOTS.slice(0, 6).map((s) => cell(s, { picked: !info && s === pick, short: short && s === pick, w: cellW, h: cellH, face, phone: true })).join('');
  const bar = info ? '' : `
  <!-- the purchase bar: risen on the pick, docked to the window's foot (design, 1) -->
  <section aria-label="Your pick" style="position:absolute;left:0;right:0;bottom:0;z-index:6;padding:14px 16px 16px;background:${GROUND};border-top:1px solid #9ef4ff;box-shadow:0 -1px 12px rgba(25,227,255,.35)">
    <button aria-label="Clear the pick" style="position:absolute;right:8px;top:6px;width:44px;height:44px;border:0;background:transparent;color:${SOFT};font:34px/1 Anton,Impact,sans-serif;cursor:pointer">×</button>
    <div style="display:flex;gap:12px;align-items:stretch;padding-right:40px">
      ${display({ state: short ? 'short' : 'picked', slot: pick, w: '100%', phone: true })}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0">
      <span style="font:600 21px 'Barlow Condensed',sans-serif">${short ? `<span style="color:${SOFT}">Wallet</span> 1.62 <span style="color:${SOFT}">solid</span>` : `5.62 → <b style="font:24px Anton,Impact,sans-serif;color:${GOLD};font-weight:400">4.62</b>`}</span>
      ${handCounter(2, short ? null : 3, { size: 22 })}
    </div>
    ${short ? buyButton({ words: 'BUY', muted: true, height: 60, described: 'need' }) : buyButton({ words: 'BUY', sub: `${pick.name.toUpperCase()} · ${pick.price}`, height: 60 })}
  </section>`;
  const sheet = !info ? '' : `
  <!-- the info dialog as the phone's bottom sheet, with Buy in its sticky foot (design, 7) -->
  <div aria-hidden="true" style="position:absolute;inset:0;z-index:6;background:rgba(3,2,8,.72)"></div>
  <section role="dialog" aria-modal="true" aria-labelledby="sheet-title" style="position:absolute;left:0;right:0;bottom:0;top:118px;z-index:7;background:${GROUND};border-top:1px solid #9ef4ff;box-shadow:0 -1px 12px rgba(25,227,255,.35);display:flex;flex-direction:column">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid rgba(201,248,255,.2)">
      <div>
        <div class="label" style="font-size:18px;color:#9ef4ff">Slot C2 · Move</div>
        <h2 id="sheet-title" style="margin:2px 0 0;font:40px/1 Anton,Impact,sans-serif;letter-spacing:1px">OVERREACTION</h2>
      </div>
      <button aria-label="Close" style="width:48px;height:48px;border:1px solid ${SOFT};background:transparent;color:${INK};font:26px/1 Anton,Impact,sans-serif;cursor:pointer">×</button>
    </div>
    <div style="flex:1;overflow:hidden;padding:14px 16px;display:flex;gap:14px">
      <span style="flex:none;width:120px;height:180px;overflow:hidden;clip-path:${cut(8)};box-shadow:0 0 0 1.5px ${RED};background:#0b0914"><img alt="" src="${ART}/overreaction/art.webp" style="width:100%;height:100%;object-fit:cover"></span>
      <div>
        <p style="margin:0;font:28px/1 Anton,Impact,sans-serif;color:${INK}">1.00 <span style="font:700 21px 'Barlow Condensed',sans-serif;color:${SOFT}">to buy</span></p>
        <p class="fine" style="margin-top:8px;font-size:20px">A Pepperoni card, common. It adds one emoji you choose to this post's reactions, and you say how it scores. Anyone can then leave it, here and nowhere else…</p>
      </div>
    </div>
    <div style="padding:12px 16px 16px;border-top:1px solid #9ef4ff;box-shadow:0 -1px 10px rgba(25,227,255,.3);background:${GROUND}">
      <p class="fine" style="margin-bottom:10px">1.00 from 5.62 solid → <b style="color:${GOLD}">4.62</b></p>
      <div style="display:flex;gap:12px">
        <button style="flex:none;min-height:56px;padding:0 18px;border:1px solid ${SOFT};transform:skewX(-10deg);background:transparent;color:${INK};cursor:pointer"><span style="display:inline-block;transform:skewX(10deg);font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px">CLOSE</span></button>
        ${buyButton({ words: 'BUY', sub: 'OVERREACTION · 1.00', height: 64, stack: true })}
      </div>
    </div>
  </section>`;
  const html = `${head(title, 390)}
<body>
<div style="width:390px;height:844px;position:relative;overflow:hidden;background:${GROUND};color:${INK};font-family:'Barlow Condensed',sans-serif">
  ${menu(390, true)}
  ${smoke(390, 844, [[0, 64, 390, 140]])}

  <!-- the compact head: a one-line title and a one-row wallet (design, 10) -->
  <div style="position:absolute;left:16px;right:16px;top:76px">
    <h1 style="margin:0;font:36px/1 Anton,Impact,sans-serif;letter-spacing:1px;color:${GOLD};text-shadow:0 0 18px rgba(255,217,61,.35)">VENDING MACHINE</h1>
    <section aria-label="Your wallet" style="display:flex;align-items:center;gap:6px;margin-top:10px">
      <div role="img" aria-label="Wallet: ${(balance / 100).toFixed(2)} of 6.00 solid" style="display:flex;gap:4px">${orbs(balance, short || info ? 0 : 100, 26)}</div>
      <span style="margin-left:6px;white-space:nowrap;font:600 20px 'Barlow Condensed',sans-serif"><b style="font:22px Anton,Impact,sans-serif;font-weight:400">${(balance / 100).toFixed(2)}</b> <span style="color:${SOFT}">of 6.00 solid</span></span>
      <button aria-label="About the wallet" style="margin-left:auto;width:44px;height:44px;border:0;background:transparent;display:flex;align-items:center;justify-content:center">${infoIcon(26)}</button>
    </section>
  </div>

  <!-- the machine, starting on the first screen -->
  <div role="group" aria-label="Vending Machine" style="position:absolute;left:12px;right:12px;top:188px;height:1100px">
    ${body({ w: 366, h: 1100, sign: 'FRESH BEEF', signSize: 34 })}
    <div role="radiogroup" aria-label="Slots" style="position:absolute;left:14px;top:${26 + 56 + 14}px;display:grid;grid-template-columns:repeat(2,${cellW}px);gap:12px">${slotsHtml}
    </div>
  </div>
  ${bar}${sheet}
</div>
</body>
</html>
`;
  writeFileSync(join(here, file), html);
}

desk({ state: 'picked', title: 'Picked, on a desk', file: '01-desk-picked.html', note: 'A pack’s odds and the Boss’s moves stand here when there are any.' });
desk({ state: 'bought', title: 'Bought, on a desk', file: '02-desk-bought.html', note: 'A pack’s odds and the Boss’s moves stand here when there are any.' });
phone({ state: 'picked', title: 'Picked, on a phone', file: '03-phone-picked.html' });
phone({ state: 'short', title: 'Short of solid Aura, on a phone', file: '04-phone-short.html' });
phone({ state: 'info', title: 'A card’s info, on a phone', file: '05-phone-info.html' });
