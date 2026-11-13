// Builds and shoots the THIS mock: node build.cjs (from this folder). It borrows the board look's own styles
// (../2026-11-06-board-look/04-thread.html and 07-phone.html), so the boards here are drawn as those are.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const look = path.join(__dirname, '../2026-11-06-board-look');
const desk = fs.readFileSync(path.join(look, '04-thread.html'), 'utf8');
const phone = fs.readFileSync(path.join(look, '07-phone.html'), 'utf8');
const style = desk.match(/<style>[\s\S]*?<\/style>/)[0].replace('body { width: 1440px; height: 1000px; }', '');
const dark = phone.match(/<style>\.screen\[data-kb-mode="dark"\][\s\S]*?<\/style>/)[0];

const mine = `<style>
body { background: #6b6b6b; padding: 22px; }
.sheet { display: flex; gap: 26px; align-items: flex-start; }
.label { font: bold 15px/1.3 Verdana, sans-serif; color: #fff; margin: 0 0 8px; max-width: 390px; }
.label small { display: block; font-weight: normal; font-size: 12.5px; opacity: 0.9; }
.desk .col { padding-bottom: 20px; }
.screen { --this-ink: #e0261b; --this-hl: rgb(255 228 0 / 0.9); --this-paper: #fff; }
.screen[data-kb-mode="dark"] { --this-ink: #ff6a5c; --this-hl: rgb(255 228 0 / 0.32); --this-paper: #1a1a1a; }
.pbody { overflow: visible; }
/* the phrase the note points at: a highlighter's swipe under the words */
.hl { background: linear-gradient(transparent 58%, var(--this-hl) 58% 94%, transparent 94%); }
.gapper { display: inline-block; width: 0; vertical-align: top; }
.this { position: absolute; z-index: 4; color: var(--this-ink); font-family: "Permanent Marker", "Comic Sans MS", cursive; }
.this b { display: block; font-weight: normal; font-size: 31px; line-height: 1; letter-spacing: 0.02em; transform: rotate(-4deg); transform-origin: left center; }
.this span { display: block; font-size: 17px; line-height: 1.2; }
/* A, the wedge: the line opens and the note sits in the gap, its arrow reaching up to the words */
.this.wedge { left: 0; right: 0; display: flex; gap: 12px; align-items: flex-start; }
.this.wedge b { flex: none; padding-top: 2px; }
.this.wedge span { padding-top: 8px; }
/* B, the margin: the note hangs outside the post's frame */
.this.margin { width: 108px; }
.this.margin span { margin-top: 4px; font-size: 13px; }
/* C, the sticker: a label slapped over the words */
.this.sticker { background: var(--this-paper); border: 2px solid var(--this-ink); padding: 5px 9px 6px; width: 168px; transform: rotate(-5deg); box-shadow: 2px 3px 0 rgb(0 0 0 / 0.35); }
.this.sticker b { font-size: 26px; transform: none; }
.this.sticker span { font-size: 15px; }
/* the words in the board's own type, for the look question */
.plain .this span { font: bold 15px/1.3 Verdana, Geneva, "DejaVu Sans", sans-serif; padding-top: 9px; }
svg.swoop { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 4; }
svg.swoop path { fill: none; stroke: var(--this-ink); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.phone .reacts { flex-wrap: wrap; }
</style>`;

const place = `<script>
document.fonts.ready.then(() => {
  for (const note of document.querySelectorAll('.this')) {
    const body = note.closest('.pbody');
    const hl = body.querySelector('.hl[data-n="' + note.dataset.n + '"]');
    const kind = note.classList.contains('wedge') ? 'wedge' : note.classList.contains('margin') ? 'margin' : 'sticker';
    const svg = body.querySelector('svg.swoop');
    if (kind === 'wedge') {
      // the gap: an inline box at the phrase's end, as tall as its line and the note under it
      const gap = document.createElement('span'); gap.className = 'gapper';
      const line = parseFloat(getComputedStyle(hl).lineHeight);
      gap.style.height = (line + note.offsetHeight + 30) + 'px';
      hl.after(gap);
    }
    note._hl = hl; note._kind = kind; note._svg = svg;
  }
  for (const note of document.querySelectorAll('.this')) {
    const body = note.closest('.pbody'), b = body.getBoundingClientRect();
    const rects = [...note._hl.getClientRects()]; const last = rects[rects.length - 1];
    const lineH = parseFloat(getComputedStyle(note._hl).lineHeight);
    const under = last.top - b.top + lineH;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (note._kind === 'wedge') {
      note.style.top = (under + 22) + 'px';
      const word = note.querySelector('b').getBoundingClientRect();
      const fromX = word.left - b.left + word.width * 0.55, fromY = under + 22;
      const tipX = Math.max(last.left - b.left + 14, Math.min(last.left - b.left + last.width / 2, b.width - 14)), tipY = under - 1;
      const up = tipX >= fromX ? 1 : -1;
      path.setAttribute('d', 'M' + fromX + ',' + fromY + ' Q' + (fromX + 4 * up) + ',' + (tipY + 9) + ' ' + tipX + ',' + (tipY + 2) + ' m' + (-10 * up) + ',-3 l' + (10 * up) + ',3 l' + (-7 * up) + ',9');
    } else if (note._kind === 'margin') {
      const left = b.width + 26; note.style.left = left + 'px'; const top = Math.max(last.top - b.top - 8, (body._low || -99) + 10); note.style.top = top + 'px'; body._low = top + note.offsetHeight;
      const y = last.top - b.top + lineH / 2, fromY = parseFloat(note.style.top) + 18, tipX = last.right - b.left + 8;
      path.setAttribute('d', 'M' + (left - 6) + ',' + fromY + ' Q' + ((left + tipX) / 2) + ',' + (y - 12) + ' ' + tipX + ',' + y + ' m10,-9 l-10,9 l11,6');
    } else {
      note.style.right = '-4px'; note.style.top = (last.top - b.top - 10) + 'px';
    }
    if (path.getAttribute('d')) note._svg.appendChild(path);
  }
});
</script>`;

const P1 = (n) => `<p>Okay, hot take time. The physics in the original engine were never the problem. <span class="hl" data-n="1">People blame the engine because it's easier than admitting their levels were bad.</span></p>`;
const text = (notes) => `<svg class="swoop" aria-hidden="true"></svg>${P1()}<p>I played forty of the contest entries last weekend. The ones that felt good all used the default settings. Every single one.</p><p>Anyway the new level editor is fine. <span class="hl" data-n="2">Stop asking for slopes.</span></p>${notes}<div class="reacts"><span class="react"><span class="up"><span class="e">🔥</span><b>4</b></span></span><span class="react"><span class="up"><span class="e">🙏</span><b>1</b></span></span><span class="react"><span class="up"><span class="e">🙄</span><b>2</b></span></span></div>`;
const note = (kind, n, words) => `<div class="this ${kind}" data-n="${n}"><b>THIS${kind === 'sticker' ? ' ◀' : ''}</b>${words ? `<span>${words}</span>` : ''}</div>`;
const agree = 'finally somebody said it';
const disagree = 'is how you lose the whole board';
const mark = '<span class="markw"><span class="up"><i></i></span></span>';
const acts = '<div class="acts"><button class="b sm" type="button">Quote</button><button class="b sm" type="button">Spin thread</button><button class="b sm" type="button">History</button></div>';

const deskScreen = (kind) => `<div class="screen desk" style="width:1440px"><div class="col">
  <p class="crumb"><a href="#">Index</a> › <a href="#">General</a> › the engine was never the problem</p>
  <div class="head"><h1 class="title">the engine was never the problem</h1></div>
  <table class="t posts"><thead><tr><th scope="col" style="width:216px">Author</th><th scope="col">Message</th></tr></thead>
    <tbody>
      <tr><td class="bit" rowspan="3"><a class="pname" href="#">Spritey</a><div class="prank">Main Eventer</div><span class="pips"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></span><div class="ava">S</div><div class="pcounts">Posts: 13<br>Joined Oct 2026</div></td>
        <td class="pline"><div class="pl"><span>Oct 29, 2026, 9:14 PM</span><span class="r">${mark}<a href="#">#41</a></span></div></td></tr>
      <tr><td><div class="pbody">${text(note(kind, 1, agree) + note(kind, 2, disagree))}</div></td></tr>
      <tr><td class="foot">${acts}</td></tr>
    </tbody></table></div></div>`;

const phoneScreen = (kind, mode, notes, extra = '') => `<div class="screen phone ${extra}" ${mode ? 'data-kb-mode="dark"' : ''} style="width:390px;height:760px"><div class="col">
  <p class="crumb"><a href="#">Index</a> › <a href="#">General</a> › the engine was never the problem</p>
  <table class="t posts"><tbody>
      <tr><td class="pbit"><div class="bitrow"><div class="ava">S</div><div><a class="pname" href="#">Spritey</a><div class="prank">Main Eventer</div><span class="pips"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></span></div></div></td></tr>
      <tr><td class="pline"><div class="pl"><span>Oct 29, 9:14 PM</span><span class="r">${mark}<a href="#">#41</a></span></div></td></tr>
      <tr><td><div class="pbody">${text(notes)}</div></td></tr>
      <tr><td class="foot">${acts}</td></tr>
    </tbody></table></div></div>`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@600;700&family=Permanent+Marker&family=Silkscreen&display=swap">
${style}${dark}${mine}</head><body>${body}${place}</body></html>`;

const long = 'is exactly what I said in March and got warned for';
const pages = {
  '03-look': page('THIS: the words in marker, or in the board\'s own type', `<div class="sheet">
    <div><p class="label">Marker words<small>All of the note is handwriting. The second note is 50 characters.</small></p>${phoneScreen('wedge', false, note('wedge', 1, agree) + note('wedge', 2, long))}</div>
    <div><p class="label">Board-type words<small>THIS is handwriting; the caster's words are the board's own type.</small></p>${phoneScreen('wedge', false, note('wedge', 1, agree) + note('wedge', 2, long), 'plain')}</div></div>`),
  '01-phone': page('THIS on the phone: the wedge, the sticker, and the wedge in dark', `<div class="sheet">
    <div><p class="label">A. The wedge<small>The line opens; the note sits under the words it points at.</small></p>${phoneScreen('wedge', false, note('wedge', 1, agree) + note('wedge', 2, disagree))}</div>
    <div><p class="label">C. The sticker<small>Slapped over the words; a reader presses it to peel it aside.</small></p>${phoneScreen('sticker', false, note('sticker', 1, agree) + note('sticker', 2, disagree))}</div>
    <div><p class="label">A, dark, with a bare THIS<small>No words is a play too: the plain "^ this".</small></p>${phoneScreen('wedge', true, note('wedge', 1, '') + note('wedge', 2, disagree))}</div></div>`),
  '02-desk': page('THIS on the desktop: the wedge and the margin', `<p class="label" style="max-width:none">A. The wedge, as on the phone</p>${deskScreen('wedge')}
    <p class="label" style="max-width:none;margin-top:22px">B. The margin: the note hangs outside the post's frame, where a wide window has room</p>${deskScreen('margin')}`),
};

(async () => {
  const b = await chromium.launch();
  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(__dirname, name + '.html'), html);
    const p = await b.newPage({ viewport: { width: 1484, height: 900 }, deviceScaleFactor: 2 });
    await p.goto('file://' + path.join(__dirname, name + '.html'));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const el = await p.$(name !== '02-desk' ? '.sheet' : 'body');
    const box = await el.boundingBox();
    await p.screenshot({ path: path.join(__dirname, name + '.png'), fullPage: true, clip: name !== '02-desk' ? { x: 0, y: 0, width: box.width + 44, height: box.height + 44 } : undefined });
    await p.close();
  }
  await b.close();
})();
