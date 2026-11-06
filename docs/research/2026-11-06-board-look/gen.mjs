/**
 * Writes the board look design session's screen boards (docs/plans/2026-11-06-board-look-design.md):
 *
 *   node docs/research/2026-11-06-board-look/gen.mjs
 *
 * Each board is one self-contained HTML file at a fixed size, drawn in the Silver house theme with the token names the
 * design proposes (`--kb-*`), light on :root and dark under [data-kb-mode="dark"], as a theme file holds them. The board
 * world is the subject; the HUD is drawn for place only and is held by the two-worlds boards. Content is the demo world's
 * (web/src/demo.ts). They are references for the look, not code to copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------- the Silver house theme, in the proposed vocabulary ---------- */
const LIGHT = {
  '--kb-bg': '#d9d9d9', '--kb-fg': '#000', '--kb-muted': '#454545', '--kb-link': '#000', '--kb-link-hover': '#4a4a4a',
  '--kb-grid': '#8a8a8a', '--kb-frame': '#4a4a4a', '--kb-row-1': '#f7f7f7', '--kb-row-2': '#ebebeb', '--kb-row-3': '#dedede',
  '--kb-head-bg': 'linear-gradient(#6a6a6a, #474747 50%, #383838 51%, #2b2b2b)', '--kb-head-fg': '#fff', '--kb-head-shadow': '0 1px 0 #000',
  '--kb-bar-bg': 'linear-gradient(#ffffff, #e2e2e2 50%, #d4d4d4 51%, #c6c6c6)', '--kb-bar-fg': '#000', '--kb-bar-shadow': '0 1px 0 #fff',
  '--kb-banner-bg': 'linear-gradient(#ffffff, #cfcfcf)', '--kb-logo-fg': '#111', '--kb-logo-shadow': '1px 1px 0 #fff, 2px 2px 0 #9a9a9a',
  '--kb-nav-bg': 'linear-gradient(#5e5e5e, #3a3a3a)', '--kb-nav-fg': '#fff',
  '--kb-tag-bg': '#fff', '--kb-mini-bg': '#fff', '--kb-mini-rule': '#000',
  '--kb-icon-ink': '#1a1a1a', '--kb-icon-back': '#b8b8b8', '--kb-icon-front': '#f0f0f0', '--kb-icon-new': '#6e6e6e', '--kb-icon-hi': '#fff', '--kb-icon-line': '#8a8a8a', '--kb-icon-hot': '#4a4a4a',
  '--kb-button-bg': 'linear-gradient(#fcfcfc 0%, #d8d8d8 48%, #b4b4b4 52%, #e6e6e6 100%)', '--kb-button-edge': '#3a3a3a',
  '--kb-button-fg': '#111', '--kb-button-fg-shadow': '0 1px 0 rgb(255 255 255 / 0.9), 0 0 5px rgb(255 255 255 / 0.7)',
  '--kb-badge-a': '#3a3a3a', '--kb-badge-a-fg': '#fff', '--kb-badge-b': '#e8e8e8', '--kb-badge-b-fg': '#000',
  '--kb-vignette-color': '#1e083c', '--kb-vignette-edge': '0.32',
};
const DARK = {
  '--kb-bg': '#141414', '--kb-fg': '#e8e8e8', '--kb-muted': '#b0b0b0', '--kb-link': '#fff', '--kb-link-hover': '#cfcfcf',
  '--kb-grid': '#4a4a4a', '--kb-frame': '#000', '--kb-row-1': '#262626', '--kb-row-2': '#1f1f1f', '--kb-row-3': '#2e2e2e',
  '--kb-head-bg': 'linear-gradient(#5a5a5a, #3c3c3c 50%, #2c2c2c 51%, #202020)', '--kb-head-fg': '#fff', '--kb-head-shadow': '0 1px 0 #000',
  '--kb-bar-bg': 'linear-gradient(#3e3e3e, #333 50%, #2a2a2a 51%, #232323)', '--kb-bar-fg': '#fff', '--kb-bar-shadow': '0 1px 0 #000',
  '--kb-banner-bg': 'linear-gradient(#323232, #121212)', '--kb-logo-fg': '#f2f2f2', '--kb-logo-shadow': '1px 1px 0 #000, 2px 2px 0 #555',
  '--kb-nav-bg': 'linear-gradient(#3a3a3a, #262626)', '--kb-nav-fg': '#fff',
  '--kb-tag-bg': '#1a1a1a', '--kb-mini-bg': '#1a1a1a', '--kb-mini-rule': '#e8e8e8',
  '--kb-icon-ink': '#000', '--kb-icon-back': '#8c8c8c', '--kb-icon-front': '#d8d8d8', '--kb-icon-new': '#555', '--kb-icon-hi': '#f4f4f4', '--kb-icon-line': '#8a8a8a', '--kb-icon-hot': '#bdbdbd',
  '--kb-button-bg': 'linear-gradient(#6a6a6a 0%, #454545 48%, #2a2a2a 52%, #3c3c3c 100%)', '--kb-button-edge': '#000',
  '--kb-button-fg': '#fff', '--kb-button-fg-shadow': '0 1px 0 #000, 0 0 5px rgb(255 255 255 / 0.35)',
  '--kb-badge-a': '#e8e8e8', '--kb-badge-a-fg': '#000', '--kb-badge-b': '#2a2a2a', '--kb-badge-b-fg': '#e8e8e8',
  '--kb-vignette-color': '#3c1478', '--kb-vignette-edge': '0.55',
};
const decl = (o) => Object.entries(o).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/* ---------- icons: drawn as 2003 icon GIFs were, a few flat tones, a 1px outline and a highlight, at a whole-pixel size ---------- */
/* Every stroke sits on a half pixel and every icon is drawn at its viewBox's own size, so its lines land on the screen's pixels. */
const FLAME = '<path class="hot" d="M19.5,0.5 C21,2.5 23.5,4 22.8,7 C22.3,9 20,9.5 18.8,8.6 C17.5,7.6 17.8,5.8 19,4.8 C17.4,5 16.5,6.5 16.8,8.2 C15,6.5 16.5,2.5 19.5,0.5 Z"/><path class="hi" d="M20,4.6 C21,5.6 21.6,6.6 21,7.6 C20.5,8.1 19.7,7.8 19.7,7 Z"/>';
const SHEET = '<path class="paper" d="M5.5,2.5 H17.5 V11.5 H5.5 Z"/><path class="line" d="M7.5,5.5 H15.5 M7.5,7.5 H15.5 M7.5,9.5 H12.5"/>';
const folder = (isNew, hot) => [24, 20,
  '<path class="back" d="M2.5,3.5 H9.5 L11.5,5.5 H21.5 V17.5 H2.5 Z"/>' + (isNew ? SHEET : '') +
  `<path class="${isNew ? 'front-new' : 'front'}" d="M2.5,17.5 L4.5,9.5 H23.5 L21.5,17.5 Z"/><path class="shine" d="M5.4,10.5 H22.3"/>` + (hot ? FLAME : '')];
const ICONS = {
  old: folder(false, false), new: folder(true, false), hot: folder(false, true), 'new-hot': folder(true, true),
  who: [24, 20, '<circle class="back" cx="15.5" cy="6" r="3.5"/><path class="back" d="M9.5,17.5 C9.5,11.5 21.5,11.5 21.5,17.5 Z"/><circle class="front" cx="9" cy="8.5" r="3.8"/><path class="front" d="M2.5,19.5 C2.5,13 15.5,13 15.5,19.5 Z"/>'],
  home: [16, 14, '<path class="s" d="M1.5,7.5 L8,1.5 L14.5,7.5 M3.5,6.5 V12.5 H12.5 V6.5 M7,12.5 V9.5 H9 V12.5"/>'],
  board: [16, 14, '<path class="s" d="M1.5,2.5 H14.5 V12.5 H1.5 Z M4,5.5 H12 M4,7.5 H12 M4,9.5 H9"/>'],
  start: [14, 14, '<path class="s" d="M2.5,1.5 H9.5 L11.5,3.5 V12.5 H2.5 Z M5,7.5 H9 M7,5.5 V9.5"/>'],
};
function px(name) {
  const [w, h, body] = ICONS[name];
  return `<svg class="ic" aria-hidden="true" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

/* ---------- the look's CSS ---------- */
const CSS = `
:root {
${decl(LIGHT)}
}
:root[data-kb-mode="dark"] {
${decl(DARK)}
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--kb-bg); color: var(--kb-fg); font: 15px/1.45 Verdana, Geneva, "DejaVu Sans", sans-serif; }
a { color: var(--kb-link); }
a:hover { color: var(--kb-link-hover); }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.screen { position: relative; overflow: hidden; background: var(--kb-bg); color: var(--kb-fg); }
/* the house vignette: the glass's violet toward the window's corners, half strength over the column (instances/divided-world/ui/theme.css) */
.screen::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: radial-gradient(130% 110% at 50% 45%, transparent 55%, color-mix(in srgb, var(--kb-vignette-color) calc(var(--kb-vignette-edge) * 100%), transparent) 100%); }
.col { position: relative; z-index: 1; width: 1200px; margin: 0 auto; padding-top: 18px; }
.mono { font-family: "Courier New", Courier, "Liberation Mono", monospace; font-weight: bold; }
.small { font-size: 13.75px; }
.muted { color: var(--kb-muted); }

/* the banner, then the boards' bar */
.banner { display: flex; justify-content: space-between; align-items: center; background: var(--kb-banner-bg); border: 1px solid var(--kb-frame); padding: 16px 18px; }
.logo { font: bold 31px/1 "Courier New", Courier, monospace; letter-spacing: 0.09em; color: var(--kb-logo-fg); text-shadow: var(--kb-logo-shadow); margin: 0; }
.host { display: flex; align-items: center; gap: 10px; font-size: 13.75px; color: var(--kb-muted); }
.meter { display: block; width: 94px; height: 11px; background: #d4d0c8; box-shadow: inset 1px 1px #808080, inset -1px -1px #fff; }
.nav { display: flex; gap: 18px; padding: 8px 12px; background: var(--kb-nav-bg); border: 1px solid var(--kb-frame); border-top: 0; font-size: 13.75px; margin: 0 0 16px; }
.nav a { color: var(--kb-nav-fg); display: inline-flex; gap: 6px; align-items: center; }

.crumb { font-size: 13.75px; margin: 0 0 4px; }
h1.title { font: bold 22.5px/1.2 "Courier New", Courier, monospace; margin: 0 0 6px; }
.desc { color: var(--kb-muted); margin: 0 0 12px; }
.over { display: flex; justify-content: space-between; align-items: flex-end; margin: 0 0 8px; }

/* the table: cellspacing as a gap, the gap the grid */
table.t { width: 100%; border-collapse: separate; border-spacing: 1px; background: var(--kb-grid); border: 1px solid var(--kb-frame); margin: 0 0 14px; }
.t th, .t td { color: var(--kb-fg); font-size: 15px; line-height: 1.45; text-align: left; vertical-align: top; background: var(--kb-row-1); padding: 8px 10px; }
.t th { background: var(--kb-head-bg); color: var(--kb-head-fg); text-shadow: var(--kb-head-shadow); font: bold 13.75px/1.3 "Courier New", Courier, monospace; letter-spacing: 0.02em; padding: 6px 10px; }
.t tbody tr:nth-child(even) td { background: var(--kb-row-2); }
.t td.n { background: var(--kb-row-3) !important; text-align: center; font-variant-numeric: tabular-nums; }
.t th.n { text-align: center; }
.t td.bar { background: var(--kb-bar-bg) !important; color: var(--kb-bar-fg); text-shadow: var(--kb-bar-shadow); font: bold 15px/1.3 "Courier New", Courier, monospace; padding: 7px 10px; }
.t td.ico { width: 48px; text-align: center; vertical-align: middle; padding: 6px; }
.t tbody.pins td { border-bottom: 0; }
.t tr.gap td { background: var(--kb-row-3) !important; padding: 0; height: 4px; }
.barh { margin: 0; font: inherit; color: inherit; }
.name { font-weight: bold; font-size: 16px; }
.nowrap { white-space: nowrap; }
.meta { font-size: 13.75px; color: var(--kb-muted); margin-top: 3px; }
.meta a { color: var(--kb-link); }
.last { font-size: 13.75px; line-height: 1.65; }
.mini { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; border: 1px solid var(--kb-mini-rule); background: var(--kb-mini-bg); font: bold 11px/1 "Courier New", monospace; }
/* centered on the name's capitals, not its line box: Verdana's line box holds more room under its capitals than over them, 2px of it at these sizes */
.who { display: inline-flex; align-items: center; gap: 5px; }
.who .mini { position: relative; top: -2px; }
.tag { font: bold 12px/1 "Courier New", monospace; border: 1px dashed var(--kb-fg); background: var(--kb-tag-bg); padding: 2px 5px; margin-left: 6px; vertical-align: 2px; }
.sysname { font-weight: bold; }

/* the pin's mark is a game piece: the glass's own tag, as engine/ui/cards/marks.css draws it */
.pin { display: inline-grid; place-items: center; width: 32px; height: 22px; margin-left: 6px; vertical-align: -4px; background: #0d0814; border: 1px solid #3ee6ff; box-shadow: 0 0 6px rgb(62 230 255 / 0.7); transform: skewX(-12deg); }
.pin i { width: 10px; height: 8px; background: #3ee6ff; }

/* the folder icons */
.ic { display: inline-block; vertical-align: middle; flex: none; }
.ic path, .ic circle { stroke: var(--kb-icon-ink); stroke-width: 1; stroke-linejoin: round; }
.ic .back { fill: var(--kb-icon-back); } .ic .front { fill: var(--kb-icon-front); } .ic .front-new { fill: var(--kb-icon-new); }
.ic .paper { fill: var(--kb-icon-hi); } .ic .line { stroke: var(--kb-icon-line); fill: none; } .ic .shine { stroke: var(--kb-icon-hi); fill: none; }
.ic .hot { fill: var(--kb-icon-hot); } .ic .hi { fill: var(--kb-icon-hi); stroke: none; }
.ic .s { fill: none; stroke: currentColor; }

/* Chrome: a 2003 Photoshop button, every layer style on, over real text */
.b { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--kb-button-edge); background: var(--kb-button-bg); color: var(--kb-button-fg);
  font: bold 13.75px/1 Verdana, Geneva, sans-serif; text-transform: lowercase; letter-spacing: 0.06em; padding: 7px 14px; text-shadow: var(--kb-button-fg-shadow);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.55), inset 0 -1px 0 rgb(0 0 0 / 0.25), 1px 2px 3px rgb(0 0 0 / 0.35); cursor: pointer; }


.legend td { font-size: 12.5px; background: var(--kb-row-3) !important; }
.legend span { display: inline-flex; align-items: center; gap: 6px; margin-right: 22px; }

.foot { text-align: center; font-size: 12.5px; color: var(--kb-muted); margin-top: 18px; }
.badges { display: flex; justify-content: center; gap: 4px; margin-top: 8px; }
.b80 { display: inline-flex; width: 80px; height: 15px; border: 1px solid #000; font: 8px/13px "Silkscreen", monospace; text-transform: uppercase; overflow: hidden; }
.b80 span:first-child { background: var(--kb-badge-a); color: var(--kb-badge-a-fg); padding: 0 3px; }
.b80 span:last-child { flex: 1; background: var(--kb-badge-b); color: var(--kb-badge-b-fg); text-align: center; }

/* the HUD, drawn for place only: held by docs/research/2026-10-29-two-worlds/01-main.html */
.hud { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; background: linear-gradient(#170b2a, #0b0614); border-top: 1px solid #9ef3ff; box-shadow: 0 -2px 14px rgb(62 230 255 / 0.55); color: #ece6f7; font-family: "Barlow Condensed", sans-serif; display: flex; align-items: center; }
.hud .m { border: 2px solid #3ee6ff; display: grid; place-items: center; font: 700 28px/1 "Barlow Condensed", sans-serif; }
.hud .nm { font: 400 34px/1 Anton, Impact, sans-serif; text-transform: uppercase; }
.hud .orbs { display: flex; }
.hud .orbs i { border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff8 0 12%, transparent 30%), var(--c); box-shadow: inset 0 -6px 10px #0006; }
.hud .hand { margin-left: auto; font: 400 26px/1 Anton, Impact, sans-serif; background: #ff3d8b; color: #19061a; transform: skewX(-14deg); }
.hud .for { position: absolute; right: 14px; top: 8px; font: 600 12px/1 "Barlow Condensed", sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #b9add0; }
.desk .hud { height: 190px; padding: 0 60px; gap: 28px; }
.desk .hud .m { width: 82px; height: 82px; } .desk .hud .orbs { gap: 18px; margin-left: 40px; } .desk .hud .orbs i { width: 56px; height: 56px; } .desk .hud .hand { padding: 16px 34px; }

/* ---------- the phone ---------- */
.phone .col { width: auto; padding: 12px 8px 0; }
.phone .banner { padding: 10px 10px; align-items: flex-start; }
.phone .logo { font-size: 22px; }
.phone .host { margin-top: 8px; font-size: 12.5px; }
.phone .nav { display: none; }
.phone .boards { margin-left: 8px; }
.phone .crumb, .phone .banner + .nav + h1.title { margin-top: 12px; }
.phone .t th { display: none; }
.phone .t td.ico { width: 40px; padding: 8px 4px; vertical-align: top; }
.phone .t td { padding: 8px 8px; }
.phone .row-meta { font-size: 13.75px; color: var(--kb-muted); margin-top: 4px; line-height: 1.6; }
.phone .row-meta b { color: var(--kb-fg); font-weight: normal; }
.phone .hud { height: 124px; padding: 0 12px; gap: 10px; flex-wrap: wrap; align-content: center; }
.phone .hud .m { width: 44px; height: 44px; font-size: 22px; }
.phone .hud .nm { font-size: 22px; }
.phone .hud .orbs { gap: 6px; width: 100%; } .phone .hud .orbs i { width: 30px; height: 30px; }
.phone .hud .hand { font-size: 18px; padding: 8px 14px; }
.phone .foot { margin-bottom: 12px; }
`;

/* ---------- content ---------- */
const BANNER = (phone) => `
  <header class="banner">
    <div><p class="logo">DIVIDED WORLD</p>${phone ? `<div class="host">dw.gripe <span class="meter"></span></div>` : ''}</div>
    ${phone ? `<button class="b boards" type="button">Boards</button>` : `<div class="host">dw.gripe <span class="meter"></span></div>`}
  </header>
  <nav class="nav" aria-label="Boards"><a href="#">${px('home')}Index</a><a href="#">${px('board')}General</a><a href="#">${px('board')}The System</a></nav>`;

const FOOT = `
  <footer class="foot">Powered by KayfaBB
    <div class="badges" aria-hidden="true"><span class="b80"><span>Game</span><span>On</span></span><span class="b80"><span>Masks</span><span>On</span></span><span class="b80"><span>Kilter</span><span>Off</span></span></div>
  </footer>`;

const HUD = `
  <div class="hud" aria-hidden="true"><span class="for">The HUD, drawn for place</span><span class="m">M</span><span class="nm">Mrs. Hooligan</span>
    <span class="orbs"><i style="--c:#9b59b6"></i><i style="--c:#3498db"></i><i style="--c:#2ecc71"></i><i style="--c:#2a2238"></i><i style="--c:#2a2238"></i><i style="--c:#2a2238"></i></span><span class="hand">Hand 3</span></div>`;

const INDEX_DESK = `
  <h1 class="title">Index</h1>
  <table class="t">
    <caption class="vh">Boards</caption>
    <thead><tr><th scope="col">Board</th><th scope="col" class="n" style="width:120px">Threads</th><th scope="col" style="width:300px">Last post</th></tr></thead>
    <tbody>
      <tr><td><a class="name" href="#">General</a><div class="meta">Anything and everything. The System is watching.</div></td><td class="n">3</td>
        <td class="last"><span class="who"><span class="mini">M</span><a href="#">Mrs. Hooligan</a></span><br><a class="muted" href="#">Oct 6, 2026</a></td></tr>
      <tr><td><a class="name" href="#">The System</a><span class="tag">The System posts; you react and spin</span><div class="meta">What The System says. Reply by spinning a thread.</div></td><td class="n">0</td>
        <td class="last muted">None yet</td></tr>
    </tbody>
  </table>
  <table class="t">
    <tbody>
      <tr><td class="bar" colspan="2"><h2 class="barh">Who is online</h2></td></tr>
      <tr><td class="ico">${px('who')}</td><td><a href="#">Mrs. Hooligan</a>, <a href="#">Spritey</a><div class="meta">Characters active in the past 5 minutes</div></td></tr>
    </tbody>
  </table>`;

const ROWS = [
  { icon: 'new', state: 'New', title: 'Rate my avatar', by: ['M', 'Mrs. Hooligan'], unread: true, pages: '', replies: 0, views: 0, last: ['M', 'Mrs. Hooligan', 'Oct 6, 2026'] },
  { icon: 'new-hot', state: 'New, hot', title: 'The long one', by: ['S', 'Spritey'], unread: true, pages: '<a href="#">1</a> <a href="#">2</a> <a href="#">3</a> … <a href="#">9</a>', replies: 169, views: 4, last: ['P', 'Pipewrench', 'Oct 5, 2026'] },
  { icon: 'old', state: 'No new posts', title: 'Who keeps reacting with a thumbs up?', by: ['S', 'Spritey'], spun: 'Rate my avatar', unread: false, pages: '', replies: 3, views: 3, last: ['M', 'Mrs. Hooligan', 'Oct 5, 2026'] },
];
const PIN = { icon: 'hot', state: 'Hot', title: 'who keeps splatting my posts', by: ['S', 'Spritey'], unread: false, pages: '<a href="#">1</a> <a href="#">2</a> <a href="#">3</a>', replies: 45, views: 12, last: ['G', 'Gloomba', 'Oct 6, 2026'], pin: true };

const rowDesk = (r) => `
      <tr><td class="ico">${px(r.icon)}<span class="vh">${r.state}</span></td>
        <td><a class="name" href="#">${r.title}</a>${r.pin ? '<span class="pin" title="Pinned by a card"><i></i></span>' : ''}${r.spun ? ` <span class="small muted">↳ spun from <a href="#">${r.spun}</a></span>` : ''}
          <div class="meta"><span class="who"><span class="mini">${r.by[0]}</span><a href="#">${r.by[1]}</a></span>${r.unread ? ' · <a href="#">first unread</a>' : ''}${r.pages ? ` · pages: ${r.pages}` : ''}</div></td>
        <td class="n">${r.replies}</td><td class="n">${r.views}</td>
        <td class="last"><span class="who"><span class="mini">${r.last[0]}</span><a href="#">${r.last[1]}</a></span><br><a class="muted" href="#">${r.last[2]}</a></td></tr>`;

const BOARD_DESK = `
  <p class="crumb"><a href="#">Index</a> › General</p>
  <h1 class="title">General</h1>
  <p class="desc">Anything and everything. The System is watching.</p>
  <div class="over"><button class="b" type="button">${px('start')}Start a thread</button></div>
  <table class="t">
    <caption class="vh">Threads on General, most recently posted first</caption>
    <thead><tr><th scope="col" style="width:48px"><span class="vh">Status</span></th><th scope="col">Thread</th><th scope="col" class="n" style="width:100px">Replies</th><th scope="col" class="n" style="width:100px">Views</th><th scope="col" style="width:280px">Last post</th></tr></thead>
    <tbody class="pins">${rowDesk(PIN)}<tr class="gap"><td colspan="5"></td></tr></tbody>
    <tbody>${ROWS.map(rowDesk).join('')}</tbody>
  </table>
  <table class="t legend"><tbody><tr><td><span>${px('new')} New posts</span><span>${px('old')} No new posts</span><span>${px('hot')} Hot: 10 replies this week</span></td></tr></tbody></table>
  <table class="t">
    <tbody>
      <tr><td class="bar" colspan="2"><h2 class="barh">Users browsing this board</h2></td></tr>
      <tr><td class="ico">${px('who')}</td><td><a href="#">Mrs. Hooligan</a></td></tr>
    </tbody>
  </table>`;

const INDEX_PHONE = `
  <h1 class="title">Index</h1>
  <table class="t"><caption class="vh">Boards</caption>
    <tbody>
      <tr><td><a class="name" href="#">General</a><div class="meta">Anything and everything. The System is watching.</div>
        <div class="row-meta"><b>3</b> threads · last: <span class="who"><span class="mini">M</span><a href="#">Mrs. Hooligan</a></span>, <a class="muted" href="#">Oct 6</a></div></td></tr>
      <tr><td><a class="name" href="#">The System</a><div style="margin-top:4px"><span class="tag" style="margin:0">The System posts; you react and spin</span></div><div class="meta">What The System says. Reply by spinning a thread.</div>
        <div class="row-meta"><b>0</b> threads · none yet</div></td></tr>
    </tbody></table>
  <table class="t"><tbody><tr><td class="bar"><h2 class="barh">Who is online</h2></td></tr><tr><td><a href="#">Mrs. Hooligan</a>, <a href="#">Spritey</a><div class="meta">Characters active in the past 5 minutes</div></td></tr></tbody></table>`;

const rowPhone = (r) => `
      <tr><td class="ico">${px(r.icon)}<span class="vh">${r.state}</span></td>
        <td><a class="name" href="#">${r.title}</a>${r.pin ? '<span class="pin"><i></i></span>' : ''}
          <div class="meta"><span class="who"><span class="mini">${r.by[0]}</span><a href="#">${r.by[1]}</a></span>${r.unread ? ' · <a href="#">first unread</a>' : ''}${r.pages ? ` · pages: ${r.pages}` : ''}</div>
          <div class="row-meta"><b>${r.replies}</b> replies · <b>${r.views}</b> views · last: <a href="#">${r.last[1]}</a>, <a class="muted nowrap" href="#">${r.last[2].replace(', 2026', '')}</a></div></td></tr>`;

const BOARD_PHONE = `
  <p class="crumb"><a href="#">Index</a> › General</p>
  <h1 class="title">General</h1>
  <p class="desc small">Anything and everything. The System is watching.</p>
  <div class="over"><button class="b" type="button">${px('start')}Start a thread</button></div>
  <table class="t"><caption class="vh">Threads on General, most recently posted first</caption>
    <tbody class="pins">${rowPhone(PIN)}<tr class="gap"><td colspan="2"></td></tr></tbody>
    <tbody>${ROWS.map(rowPhone).join('')}</tbody></table>`;

/* ---------- pages ---------- */
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@600;700&family=Silkscreen&display=swap">';
function page({ title, comment, mode, width, height, body }) {
  return `<!doctype html>
<html lang="en"${mode === 'dark' ? ' data-kb-mode="dark"' : ''}>
<head>
<meta charset="utf-8">
<title>${title}</title>
<!-- ${comment} -->
${FONTS}
<style>${CSS}
body { width: ${width}px; height: ${height}px; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
const desk = (content) => `<div class="screen desk" style="width:1440px;height:1000px"><div class="col">${BANNER(false)}${content}${FOOT}</div>${HUD}</div>`;
const phoneScreen = (content, mode) => `<div class="screen phone" ${mode === 'dark' ? 'data-kb-mode="dark"' : ''} style="width:390px;height:844px">${''}<div class="col">${BANNER(true)}${content}${FOOT}</div>${HUD}</div>`;

const boards = [
  ['01-index.html', 'The index, Silver light', 'light', 1440, 1000, desk(INDEX_DESK)],
  ['01-index-dark.html', 'The index, Silver dark', 'dark', 1440, 1000, desk(INDEX_DESK)],
  ['02-board.html', 'A board, Silver light', 'light', 1440, 1000, desk(BOARD_DESK)],
  ['02-board-dark.html', 'A board, Silver dark', 'dark', 1440, 1000, desk(BOARD_DESK)],
];
for (const [file, title, mode, w, h, body] of boards) {
  fs.writeFileSync(path.join(here, file), page({ title, mode, width: w, height: h, body,
    comment: `A board of the board look design session (docs/plans/2026-11-06-board-look-design.md), batch 1, ${w} by ${h}, written by gen.mjs.` }));
}
/* The phone board: the index and the board at 390 by 844, light then dark, side by side. A dark screen marks itself, so its tokens are the dark block's. */
const PHONE_CSS_DARK = `.screen[data-kb-mode="dark"] {\n${decl(DARK)}\n}`;
fs.writeFileSync(path.join(here, '03-phone.html'), page({
  title: 'The index and a board on the phone, Silver', mode: 'light', width: 4 * 390 + 3 * 24, height: 844,
  comment: 'A board of the board look design session, batch 1: four phone screens at 390 by 844, the index and a board in light, then in dark, 24px apart. Written by gen.mjs.',
  body: `<style>${PHONE_CSS_DARK}</style><div style="display:flex;gap:24px">${phoneScreen(INDEX_PHONE, 'light')}${phoneScreen(BOARD_PHONE, 'light')}${phoneScreen(INDEX_PHONE, 'dark')}${phoneScreen(BOARD_PHONE, 'dark')}</div>`,
}));
console.log('wrote the batch 1 boards');
