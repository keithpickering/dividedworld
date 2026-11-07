// Writes motion/prototype.html: the booster reveal's choreography, playable, for the owner to tune (the booster packs
// design's amendment of 2026-11-07, "The reveal's motion"). Called by ../gen.mjs with its parts, so the machine, the
// faces and the backs are the boards' own. Every card's art is inlined, so the one file opens anywhere.
//
// The timings are the glass polish's feels (engine/ui/glass/motion-tokens.ts on #293, Phase 3), copied as they stand there,
// and every beat names the token it runs on. The prototype plays them with the Web Animations API; the build plays them with
// Motion through the presets in engine/ui/glass/motion.ts, and Snappy's spring is Motion's own (here an overshooting curve
// stands in for it). A reference for the motion, not code to copy.
import fs from 'node:fs';
import path from 'node:path';

const FEELS = {
  smooth: { enter: 380, exit: 300, screen: 420, stagger: 30, ease: 'cubic-bezier(0.22, 1, 0.36, 1)', distance: 16, blur: 6, scale: 0.98, spring: false },
  snappy: { enter: 180, exit: 140, screen: 220, stagger: 24, ease: 'cubic-bezier(0.22, 1, 0.36, 1)', distance: 24, blur: 0, scale: 1, spring: true },
};

export function write({ MACHINE, FACE_CSS, CSS, FONTS, smoke, face, back, pack, torn, faces, PACK, ESC, root, here }) {
  /* Inline every file the faces read, so the prototype carries its art. */
  const inline = (html) => html.replace(/src="\.\.\/\.\.\/\.\.\/([^"]+)"/g, (_, rel) => {
    const file = path.join(root, rel);
    const svg = fs.readFileSync(file, 'utf8');
    return `src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"`;
  });
  const machine = inline(MACHINE)
    .replace('<b style="transform: skewX(12deg); padding: 0 8px; background: #14030a; color: #ff9cc0; font: 24px Anton, Impact, sans-serif">2 &rarr; 7</b>',
      '<b data-proto="count" style="transform: skewX(12deg); padding: 0 8px; background: #14030a; color: #ff9cc0; font: 24px Anton, Impact, sans-serif">2</b>')
    .replace('<a href="#" style="display: inline-flex; align-items: center; gap: 14px; margin-top: 28px;', '<a href="#" data-proto="hand" style="display: inline-flex; align-items: center; gap: 14px; margin-top: 28px;')
    .replace('<span style="position: absolute; left: 14px; top: 10px; font: 800 13px', '<span data-proto="tray" style="position: absolute; left: 14px; top: 10px; font: 800 13px')
    .replace('<button class="kb-buy"', '<button class="kb-buy" data-proto="buy"');
  const cards = PACK.map((k, i) => ({ name: faces[k].name, rarity: faces[k].rarity, face: inline(face(k, 'sheet')), back: inline(back('sheet', i === 4)) }));
  const single = { name: faces['stick-around'].name, face: inline(face('stick-around', 'slot')) };
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Booster reveal: motion prototype</title>
<!-- The booster reveal's motion, playable (docs/plans/2026-11-04-booster-packs-design.md, amended 2026-11-07). Written by
     motion/prototype.mjs through ../gen.mjs. Timings are the glass polish's feels (#293); a reference, not code to copy. -->
${FONTS}
<style>${FACE_CSS}
${CSS}
html,body{background:#2a2833;color:#f1ecff;font-family:'Barlow Condensed',sans-serif}
#bar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:#16141c;border-bottom:1px solid #3a3746}
#bar .btn{min-height:40px;padding:0 16px;font-size:18px}
#bar .on{background:#19e3ff;border-color:#19e3ff;color:#03141a}
#bar label{font:700 18px 'Barlow Condensed',sans-serif;letter-spacing:1px;margin-left:8px}
#log{flex-basis:100%;font:500 16px 'Barlow Condensed',sans-serif;color:#c9c3dd;min-height:20px}
#fit{position:relative;overflow:hidden}
#root{position:absolute;left:0;top:0;width:1440px;height:1080px;transform-origin:0 0;overflow:hidden;background:#07050d}
#overlay{position:absolute;inset:0;z-index:20;display:none}
#overlay.open{display:block}
#dim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(40,16,80,.55),rgba(7,5,13,.92) 72%);backdrop-filter:blur(3px)}
.card{position:absolute;left:0;top:0;width:276px;height:414px;transform-origin:0 0;perspective:1400px}
.flip{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.flip>.side{position:absolute;inset:0;backface-visibility:hidden}
.flip>.front{transform:rotateY(180deg)}
.flip.turned{transform:rotateY(180deg)}
.halo{position:absolute;inset:-110px;background:radial-gradient(circle,rgba(255,217,61,.42),rgba(255,217,61,.12) 45%,transparent 70%);opacity:0;pointer-events:none}
.mark{position:absolute;left:10%;right:10%;bottom:-14px;height:4px;background:#19e3ff;box-shadow:0 0 12px rgba(25,227,255,.8);opacity:0}
.flyer{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:30}
</style>
</head>
<body>
<div id="bar" role="toolbar" aria-label="Prototype">
  <span role="group" aria-label="Motion feel" style="display:flex;gap:8px">
    <button class="btn" data-feel="smooth"><b>SMOOTH</b></button><button class="btn" data-feel="snappy"><b>SNAPPY</b></button><button class="btn" data-feel="off"><b>OFF</b></button>
  </span>
  <label><input type="checkbox" id="slow"> Slow &times;4</label>
  <span style="flex:1"></span>
  <button class="btn" id="buyPack"><b>BUY THE BOOSTER</b></button>
  <button class="btn" id="buyOne"><b>BUY STICK AROUND</b></button>
  <button class="btn" id="reset"><b>RESET</b></button>
  <p id="log" aria-live="polite"></p>
</div>
<div id="fit"><div id="root">
${smoke(1440, 1080, [[40, 110, 360, 640], [1060, 110, 340, 920]])}
${machine}
<div id="overlay" role="dialog" aria-modal="true" aria-label="Opening a Booster">
  <div id="dim"></div>
  <div id="pack" style="position:absolute;left:0;top:0;transform-origin:0 0">${inline(pack(180))}</div>
  <div id="strip" style="position:absolute;left:0;top:0;width:240px;transform-origin:0 0">${torn(240)}</div>
  <div id="head" style="position:absolute;left:0;right:0;top:71px;text-align:center">
    <h1 style="margin:0;font:56px/1 Anton,Impact,sans-serif;letter-spacing:1px;color:#fff">BOOSTER</h1>
    <p id="counter" role="status" style="margin:6px 0 0;font:800 22px 'Barlow Condensed',sans-serif;letter-spacing:4px;color:#c9f8ff">0 OF 5 TURNED OVER</p>
  </div>
  <p id="tag" class="raretag" style="top:164px;margin:0;z-index:4;opacity:0"><b>RARE &middot; MAIN EVENT</b></p>
  <div id="sparks"></div>
  <div id="cards"></div>
  <div id="foot" style="position:absolute;left:0;right:0;top:924px;display:flex;flex-direction:column;align-items:center;gap:16px">
    <div class="btns" style="gap:18px" id="btns"></div>
    <p class="note" id="hint" style="font-size:20px"></p>
  </div>
</div>
</div></div>
<script>
const FEELS = ${JSON.stringify(FEELS)};
const CARDS = ${JSON.stringify(cards)};
const SINGLE = ${JSON.stringify(single)};
const ESC = ${JSON.stringify(ESC)};
const SPOT = { x: 582, y: 214, s: 1 };
const ROW = (i) => ({ x: 297 + i * 174, y: 660, s: 150 / 276 });
const SPARKS = [[-34, 40, 18], [300, 20, 14], [318, 300, 20], [-30, 330, 12], [290, 420, 10], [-20, 180, 9]];
const $ = (s, el = document) => el.querySelector(s);
const root = $('#root'), overlay = $('#overlay');
let feelName = 'smooth';
let running = [];

/* ---- the feel: Phase 3's tokens; Off is null and every beat lands at once ---- */
function feel() {
  if (feelName === 'off') return null;
  const f = FEELS[feelName], k = $('#slow').checked ? 4 : 1;
  return { ...f, enter: f.enter * k, exit: f.exit * k, screen: f.screen * k, stagger: f.stagger * k };
}
/* How a thing lands: the feel's ease, or under Snappy an overshoot standing in for Motion's spring (stiffness 520, damping 32). */
const landing = (f) => (f.spring ? 'cubic-bezier(0.34, 1.45, 0.64, 1)' : f.ease);
/* stagger(feel, count): the step is the feel's stagger, capped so the last starts within \`screen\` (motion.ts). */
const stagger = (f, n) => { const step = n > 1 ? Math.min(f.stagger, f.screen / (n - 1)) : 0; return Array.from({ length: n }, (_, i) => step * i); };

function play(el, frames, opts) {
  const f = feel();
  if (!f) { const last = frames[frames.length - 1]; Object.assign(el.style, last); return Promise.resolve(); }
  const a = el.animate(frames, { fill: 'forwards', ...opts });
  running.push(a);
  return a.finished.then(() => { a.commitStyles?.(); a.cancel(); running = running.filter((x) => x !== a); }, () => {});
}
/* An input while a beat runs completes it at once (Phase 3: input goes to the entering tree at once, and no animation waits). */
function settle() { for (const a of [...running]) { try { a.finish(); } catch {} } running = []; }
const wait = (ms) => (feel() ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const at = (p, extra = '') => \`translate(\${p.x}px, \${p.y}px) scale(\${p.s})\${extra}\`;
function rectOf(el) {
  const r = el.getBoundingClientRect(), o = root.getBoundingClientRect(), k = o.width / 1440;
  return { x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k };
}
const say = (t) => { $('#log').textContent = t; };

/* ---- toHand: one flight for a bought card and for each card of a pack (the machine's single buy uses it too) ---- */
function toHand(el, from, delay = 0) {
  const f = feel();
  const hand = rectOf($('[data-proto="hand"]'));
  const s0 = from.s, s1 = 0.12;
  const tx = hand.x + hand.w * 0.3, ty = hand.y + hand.h / 2 - (414 * s1) / 2;
  const mid = { x: (from.x + tx) / 2 - 60, y: Math.min(from.y, ty) - 120 };
  return play(el, [
    { transform: \`translate(\${from.x}px, \${from.y}px) scale(\${s0}) rotate(0deg)\`, opacity: 1 },
    { transform: \`translate(\${mid.x}px, \${mid.y}px) scale(\${(s0 + s1) / 2}) rotate(-10deg)\`, opacity: 1, offset: 0.5 },
    { transform: \`translate(\${tx}px, \${ty}px) scale(\${s1}) rotate(-14deg)\`, opacity: 0 },
  ], f ? { duration: f.screen, delay, easing: f.ease } : {});
}
let handCount = 2;
function landInHand(n) {
  const f = feel(), hand = $('[data-proto="hand"]');
  handCount += n; $('[data-proto="count"]').textContent = String(handCount);
  if (f) hand.animate([{ transform: 'skewX(-12deg) scale(1)', filter: 'brightness(1)' }, { transform: 'skewX(-12deg) scale(1.08)', filter: 'brightness(1.5)', offset: 0.35 }, { transform: 'skewX(-12deg) scale(1)', filter: 'brightness(1)' }], { duration: f.enter, easing: f.ease });
}

/* ---- the single buy: the card drops into the tray, then flies to the hand ---- */
async function buyOne() {
  settle();
  const f = feel();
  say('Stick Around is in your hand.');
  const tray = rectOf($('[data-proto="tray"]').parentElement);
  const el = document.createElement('div'); el.className = 'flyer'; el.innerHTML = SINGLE.face; root.append(el);
  /* The card lies on its side in the tray, as the machine's art drops it: its center on the tray's. */
  el.style.transformOrigin = '43px 64.5px';
  const rest = { x: tray.x + tray.w / 2 - 43, y: tray.y + tray.h / 2 - 64.5, s: 1 };
  if (!f) { el.remove(); landInHand(1); return; }
  await play(el, [{ transform: \`translate(\${rest.x}px, \${rest.y - 150}px) rotate(-78deg)\`, opacity: 0 }, { transform: \`translate(\${rest.x}px, \${rest.y}px) rotate(-78deg)\`, opacity: 1 }], { duration: f.enter, easing: landing(f) });
  await wait(f.screen / 2);
  await play(el, [
    { transform: \`translate(\${rest.x}px, \${rest.y}px) rotate(-78deg)\`, opacity: 1 },
    { transform: \`translate(\${rest.x - 200}px, \${rest.y - 420}px) rotate(-30deg) scale(.8)\`, opacity: 1, offset: 0.5 },
    { transform: \`translate(\${rectOf($('[data-proto="hand"]')).x + 40}px, \${rectOf($('[data-proto="hand"]')).y}px) rotate(-14deg) scale(.35)\`, opacity: 0 },
  ], { duration: f.screen, easing: f.ease });
  el.remove(); landInHand(1);
}

/* ---- the reveal ---- */
let turned = 0, spot = -1, open = false;
function build() {
  const box = $('#cards'); box.innerHTML = '';
  CARDS.forEach((c, i) => {
    const el = document.createElement('div'); el.className = 'card'; el.dataset.i = i;
    el.innerHTML = (i === 4 ? '<div class="halo"></div>' : '') + \`<div class="flip"><div class="side back">\${c.back}</div><div class="side front">\${c.face}</div></div><div class="mark"></div>\`;
    el.addEventListener('click', () => { if (i === turned) turnNext(); });
    box.append(el);
  });
  $('#sparks').innerHTML = SPARKS.map(([x, y, s]) => \`<span class="spark" style="left:\${SPOT.x + x}px;top:\${SPOT.y + y}px;width:\${s}px;height:\${s}px;opacity:0"></span>\`).join('');
  $('#tag').style.opacity = 0;
}
const cardEl = (i) => $(\`.card[data-i="\${i}"]\`);
function buttons(done) {
  $('#btns').innerHTML = done
    ? \`<button class="btn gold" id="done"><b>DONE</b></button><button class="btn" id="close"><b>\${ESC}BACK TO THE MACHINE</b></button>\`
    : \`<button class="btn gold" id="next"><b>TURN THE NEXT CARD</b></button><button class="btn" id="all"><b>TURN ALL</b></button><button class="btn" id="close"><b>\${ESC}CLOSE</b></button>\`;
  $('#hint').textContent = done ? "These five are already in your hand. Main Event isn't sold on its own; this is one of the ways to get it." : 'Click the next card or press Space to turn it. All five are already in your hand.';
  $('#next')?.addEventListener('click', turnNext); $('#all')?.addEventListener('click', turnAll);
  $('#done')?.addEventListener('click', leave); $('#close').addEventListener('click', leave);
}

async function buyPack() {
  if (open) return;
  settle(); open = true; turned = 0; spot = -1; build(); buttons(false);
  $('#counter').textContent = '0 OF 5 TURNED OVER';
  say('Bought a Booster. Its five cards are in your hand.');
  /* The cards were in the hand from the purchase: the count moves now, not when the reveal ends. */
  handCount += 5; $('[data-proto="count"]').textContent = String(handCount);
  overlay.classList.add('open');
  const f = feel();
  const slot = rectOf($('[aria-label^="Buy Booster"] > span'));
  const packAt = { x: 630, y: 260, s: 1 };
  const pk = $('#pack'), strip = $('#strip'), head = $('#head'), foot = $('#foot');
  for (const el of [head, foot]) { el.style.opacity = 0; }
  [...document.querySelectorAll('.card')].forEach((c) => { c.style.opacity = 0; c.style.transform = at({ x: packAt.x + 45, y: packAt.y + 60, s: 0.32 }, ' rotate(-8deg)'); });
  pk.style.opacity = 1; strip.style.opacity = 1;
  /* E1, E2: the board dims (backdrop), and the pack rises from its slot to the middle (overlay, anchored on the slot). */
  play($('#dim'), [{ opacity: 0 }, { opacity: 1 }], f ? { duration: f.enter, easing: f.ease } : {});
  const from = \`translate(\${slot.x}px, \${slot.y}px) scale(\${slot.w / 180})\`;
  const strip0 = { x: packAt.x - 30, y: packAt.y - 8 };
  strip.style.transform = \`translate(\${strip0.x}px, \${strip0.y}px)\`; strip.style.opacity = 0;
  await play(pk, [{ transform: from, filter: \`blur(\${f ? f.blur : 0}px)\` }, { transform: at(packAt), filter: 'blur(0px)' }], f ? { duration: f.screen, easing: landing(f) } : {});
  /* E3: the tear. The pack's top lifts away to the head, where it stays as the reveal's mark. */
  strip.style.opacity = 1;
  await play(strip, [{ transform: \`translate(\${strip0.x}px, \${strip0.y}px) rotate(0deg)\` }, { transform: 'translate(600px, 20px) rotate(-4deg)', offset: 0.6 }, { transform: 'translate(600px, 20px) rotate(0deg)' }], f ? { duration: f.enter, easing: landing(f) } : {});
  /* E4: the deal. Five backs fly out of the pack into the row, by stagger(feel, 5), the gold hit last. */
  const d = f ? stagger(f, 5).map((x) => x * 3) : [0, 0, 0, 0, 0];
  const deals = CARDS.map((_, i) => play(cardEl(i), [
    { transform: at({ x: packAt.x + 45, y: packAt.y + 60, s: 0.32 }, ' rotate(-8deg)'), opacity: 0 },
    { transform: at(ROW(i), ' rotate(0deg)'), opacity: 1 },
  ], f ? { duration: f.enter, delay: d[i], easing: landing(f) } : {}));
  play(pk, [{ transform: at(packAt), opacity: 1 }, { transform: at({ ...packAt, y: packAt.y + (f ? f.distance * 3 : 0) }), opacity: 0 }], f ? { duration: f.exit, delay: d[4], easing: f.ease } : {});
  /* E5: the head and the buttons land, as a screen's head and panels stagger (staggerItem). */
  [head, foot].forEach((el, i) => play(el, [{ opacity: 0, transform: \`translateY(\${f ? f.distance / 2 : 0}px)\`, filter: \`blur(\${f ? f.blur : 0}px)\` }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }], f ? { duration: f.enter, delay: d[4] + i * f.stagger, easing: landing(f) } : {}));
  await Promise.all(deals);
  /* E6: the first back lifts into the spotlight, waiting to be turned. */
  await lift(0);
}

/* The lift: a card moves between its row slot and the spotlight (Motion's shared layout in the build), over \`enter\`. */
function lift(i) { const f = feel(); spot = i; return play(cardEl(i), [{ transform: at(ROW(i)) }, { transform: at(SPOT) }], f ? { duration: f.enter, easing: landing(f) } : {}); }
function lower(i) {
  const f = feel(), el = cardEl(i);
  play(el.querySelector('.mark'), [{ opacity: 1 }, { opacity: 0 }], f ? { duration: f.exit } : {});
  return play(el, [{ transform: at(SPOT) }, { transform: at(ROW(i)) }], f ? { duration: f.enter, easing: landing(f) } : {});
}
/* The flip: rotateY over \`enter\` (Snappy's spring lands it with a small overshoot). Off: the face, at once, never turned through. */
function flip(i) {
  const f = feel(), el = cardEl(i).querySelector('.flip');
  if (!f) { el.classList.add('turned'); return Promise.resolve(); }
  return play(el, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: f.enter * 1.2, easing: landing(f) }).then(() => el.classList.add('turned'));
}
function count() {
  $('#counter').textContent = turned === 5 ? '5 OF 5 \\u00b7 ALL IN YOUR HAND' : \`\${turned} OF 5 TURNED OVER\`;
  say(turned === 5 ? 'All five turned: Whoops!, Bluff, Feelin\\' Fab, Stick Around and Main Event.' : \`Card \${turned}: \${CARDS[turned - 1].name}, \${CARDS[turned - 1].rarity}.\`);
}

/* The hit's beat: before it turns, its gold back pulses once (over \`screen\`); once turned, its halo, the sparks and its tag. */
async function hitBeat() {
  const f = feel(), el = cardEl(4);
  if (f) await play(el, [{ transform: at(SPOT, ' scale(1)') }, { transform: at(SPOT, ' scale(1.05)'), offset: 0.45 }, { transform: at(SPOT, ' scale(1)') }], { duration: f.screen, easing: f.ease });
}
function hitLanded() {
  const f = feel();
  play(cardEl(4).querySelector('.halo'), [{ opacity: 0 }, { opacity: 1 }], f ? { duration: f.screen, easing: f.ease } : {});
  const ds = f ? stagger(f, SPARKS.length) : [];
  [...document.querySelectorAll('#sparks .spark')].forEach((s, i) => play(s, [{ opacity: 0, transform: 'scale(0) rotate(0deg)' }, { opacity: 1, transform: 'scale(1.4) rotate(45deg)', offset: 0.5 }, { opacity: 1, transform: 'scale(1) rotate(90deg)' }], f ? { duration: f.enter, delay: ds[i] * 2, easing: f.ease } : {}));
  const ring = cardEl(4).querySelector('.front .kb-postcard');
  play(ring, [{ boxShadow: '0 0 0 2px #2ee6ff, 0 0 30px rgba(46,230,255,.6)' }, { boxShadow: '0 0 0 2px #ffd93d, 0 0 46px rgba(255,217,61,.75)' }], f ? { duration: f.screen, easing: f.ease } : {});
  play($('#tag'), [{ opacity: 0, transform: \`translateX(-50%) skewX(-12deg) translateY(\${f ? -f.distance : 0}px)\` }, { opacity: 1, transform: 'translateX(-50%) skewX(-12deg) translateY(0)' }], f ? { duration: f.enter, easing: landing(f) } : {});
}

let busy = false;
async function turnNext() {
  if (!open || turned >= 5) return;
  settle();
  if (busy) return; busy = true;
  const i = turned;
  /* The card shown settles back into its row slot as the next one lifts into the spotlight (T1). */
  if (spot !== i) { if (spot >= 0) lower(spot); await lift(i); }
  if (i === 4) await hitBeat();
  turned = i + 1; count();
  /* The announcement goes at the turn's start; the flip follows (T2). */
  await flip(i);
  cardEl(i).querySelector('.mark').style.opacity = 1;
  if (i === 4) { hitLanded(); buttons(true); }
  busy = false;
}
/* Turn all: the backs left in the row flip where they lie, staggered, and the hit lifts last with its beat. */
async function turnAll() {
  if (!open || turned >= 5) return;
  settle(); busy = true;
  const f = feel();
  if (spot >= 0 && spot < 4 && cardEl(spot).querySelector('.flip.turned')) lower(spot);
  const rest = []; for (let i = turned; i < 4; i++) rest.push(i);
  const d = f ? stagger(f, rest.length).map((x) => x * 3) : rest.map(() => 0);
  await Promise.all(rest.map(async (i, n) => { if (spot === i) { await play(cardEl(i), [{ transform: at(SPOT) }, { transform: at(ROW(i)) }], f ? { duration: f.enter, easing: landing(f) } : {}); } await wait(d[n]); await flip(i); }));
  turned = 4; busy = false; spot = -1;
  await turnNext();
}
/* The exit: the head and buttons leave (exit), the five cards sweep into the hand by toHand, staggered, and the dim lifts in step. */
async function leave() {
  if (!open) return;
  settle(); open = false;
  const f = feel();
  say('Back to the machine.');
  for (const el of [$('#head'), $('#foot'), $('#tag'), $('#strip')]) play(el, [{ opacity: 1 }, { opacity: 0 }], f ? { duration: f.exit, easing: f.ease } : {});
  for (const s of document.querySelectorAll('#sparks .spark, .halo')) play(s, [{ opacity: 1 }, { opacity: 0 }], f ? { duration: f.exit } : {});
  const d = f ? stagger(f, 5).map((x) => x * 2) : [0, 0, 0, 0, 0];
  await Promise.all(CARDS.map((_, i) => toHand(cardEl(i), i === spot ? SPOT : ROW(i), d[i])));
  landInHand(0);
  await play($('#dim'), [{ opacity: 1 }, { opacity: 0 }], f ? { duration: f.exit, easing: f.ease } : {});
  overlay.classList.remove('open');
}

/* ---- the controls ---- */
function setFeel(n) { feelName = n; document.querySelectorAll('[data-feel]').forEach((b) => b.classList.toggle('on', b.dataset.feel === n)); }
document.querySelectorAll('[data-feel]').forEach((b) => b.addEventListener('click', () => setFeel(b.dataset.feel)));
setFeel('smooth');
$('#buyPack').addEventListener('click', buyPack);
$('[data-proto="buy"]').addEventListener('click', buyPack);
$('#buyOne').addEventListener('click', buyOne);
$('#reset').addEventListener('click', () => { settle(); open = false; overlay.classList.remove('open'); handCount = 2; $('[data-proto="count"]').textContent = '2'; say(''); });
document.addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.key === ' ') { e.preventDefault(); turnNext(); }
  if (e.key === 'Escape') leave();
});
function fit() { const w = Math.min(document.documentElement.clientWidth, 1440), k = w / 1440; root.style.transform = \`scale(\${k})\`; $('#fit').style.height = 1080 * k + 'px'; }
addEventListener('resize', fit); fit();
</script>
</body>
</html>
`;
  fs.mkdirSync(path.join(here, 'motion'), { recursive: true });
  fs.writeFileSync(path.join(here, 'motion', 'prototype.html'), html);
}
