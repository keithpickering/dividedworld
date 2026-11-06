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
  '--kb-input-bg': '#fff', '--kb-input-edge': '#7a7a7a', '--kb-input-shadow': 'inset 1px 1px 2px rgb(0 0 0 / 0.18)', '--kb-chip-bg': '#fff',
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
  '--kb-input-bg': '#151515', '--kb-input-edge': '#5e5e5e', '--kb-input-shadow': 'inset 1px 1px 2px rgb(0 0 0 / 0.6)', '--kb-chip-bg': '#1a1a1a',
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
.t:not(.posts) tbody tr:nth-child(even) td { background: var(--kb-row-2); }
/* a post is one color across its cells, and posts alternate */
.posts tbody.alt td { background: var(--kb-row-2); }
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
/* ---------- batch 2: the thread, the reply box, New thread ---------- */
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin: 0 0 8px; }
.head h1.title { margin: 0; }
.pager { display: flex; align-items: center; gap: 10px; font-size: 13.75px; font-variant-numeric: tabular-nums; }
.pager .here { font-weight: bold; padding: 1px 6px; background: var(--kb-head-bg); color: var(--kb-head-fg); border: 1px solid var(--kb-frame); }
.pager .where { font-weight: bold; }
table.posts td.bit { width: 216px; }
.pname { font-weight: bold; }
.prank { margin: 4px 0 2px; font-size: 15px; }
.pips { display: inline-flex; gap: 2px; margin: 2px 0 8px; }
.pips i { width: 13px; height: 13px; border: 1px solid var(--kb-fg); }
.pips i.on { background: var(--kb-fg); }
.ava { width: 48px; height: 48px; border: 1px solid var(--kb-fg); background: var(--kb-mini-bg); display: grid; place-items: center; font: bold 17px "Courier New", monospace; margin-bottom: 10px; }
.pcounts { font-size: 13.75px; color: var(--kb-muted); line-height: 1.6; }
.t td.pline { padding: 4px 10px; font-size: 12.5px; color: var(--kb-muted); }
.pl { display: flex; justify-content: space-between; align-items: center; min-height: 26px; }
.pl .r { display: inline-flex; align-items: center; gap: 8px; }
.pl a { color: var(--kb-muted); }
.pbody { position: relative; min-height: 70px; }
.pbody p { margin: 0 0 12px; position: relative; }
.quote { margin: 0 0 12px; border: 1px solid var(--kb-grid); background: var(--kb-row-1); font-size: 13.75px; }
.quote b { display: block; font: bold 12.5px "Courier New", monospace; padding: 4px 8px; background: var(--kb-row-3); border-bottom: 1px solid var(--kb-grid); }
.quote div { padding: 8px; }
/* the reactions are game pieces, drawn as marks are (the reaction-marks build): a skewed glass tile, the emoji and a condensed count */
.reacts { display: flex; gap: 8px; margin-top: 6px; position: relative; z-index: 3; }
.react { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; background: #1a1230; border: 2px solid #cfc6ea; transform: skewX(-12deg); }
.up { display: inline-flex; align-items: center; gap: 6px; transform: skewX(12deg); }
.react .e { font-size: 18px; line-height: 1; }
.react b { font: 700 22px/1 "Barlow Condensed", sans-serif; color: #fff; font-variant-numeric: tabular-nums; }
td.foot { padding: 6px 10px !important; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.b.sm { font-size: 11.25px; padding: 4px 8px; letter-spacing: 0.04em; gap: 5px; }
.b.primary { background: var(--kb-head-bg); color: var(--kb-head-fg); text-shadow: 0 1px 0 #000, 0 0 5px rgb(255 255 255 / 0.35); border-color: #000; }
.b.pressed { box-shadow: inset 1px 2px 3px rgb(0 0 0 / 0.45); filter: brightness(0.92); }
.markw { display: inline-grid; place-items: center; width: 40px; height: 32px; margin-block: -6px; background: #1a1230; border: 2px solid #ff4fd8; box-shadow: 0 0 8px rgb(255 79 216 / 0.7); transform: skewX(-12deg); }
.markw i { display: block; width: 16px; height: 16px; background: #ff4fd8; clip-path: polygon(50% 0, 62% 35%, 100% 50%, 62% 65%, 50% 100%, 38% 65%, 0 50%, 38% 35%); }
.splat { position: absolute; z-index: 2; left: 230px; top: -12px; width: 560px; height: 190px; pointer-events: none; }
.below { display: flex; justify-content: space-between; align-items: center; margin: 0 0 14px; }
/* the reply box and New thread */
.form td { padding: 12px 14px; }
.as { font-size: 13.75px; margin: 0 0 10px; }
.field { display: block; font-weight: bold; font-size: 13.75px; margin: 0 0 4px; }
.input { height: 30px; border: 1px solid var(--kb-input-edge); background: var(--kb-input-bg); box-shadow: var(--kb-input-shadow); margin: 0 0 12px; }
.area { height: 150px; border: 1px solid var(--kb-input-edge); background: var(--kb-input-bg); box-shadow: var(--kb-input-shadow); }
.tools { display: flex; gap: 4px; flex-wrap: wrap; margin: 0 0 6px; }
.tools .b { min-width: 30px; justify-content: center; }
.formfoot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; font-size: 13.75px; color: var(--kb-muted); }
.formfoot .go { display: flex; align-items: center; gap: 8px; }
.phone .head { flex-direction: column; align-items: flex-start; gap: 6px; }
.phone .t td.pbit { padding: 8px; }
.phone .bitrow { display: flex; gap: 10px; align-items: flex-start; }
.phone .bitrow .ava { margin: 0; }
.phone .splat { left: 20px; top: 10px; width: 320px; height: 110px; }
.phone .area { height: 110px; }
.phone .formfoot { flex-wrap: wrap; }
/* nine formatting buttons in one row at 390: each sized to its word */
.phone .tools { gap: 3px; }
.phone .tools .b.sm { min-width: 0; padding: 4px 5px; letter-spacing: 0.02em; }
/* ---------- batch 3: a profile and its record ---------- */
table.about td.avacell { width: 152px; vertical-align: top; padding: 14px 16px; }
.bigava { width: 120px; height: 240px; border: 1px solid var(--kb-fg); background: var(--kb-mini-bg); display: grid; place-items: center; font: bold 40px "Courier New", monospace; }
.about .k { width: 190px; font-family: Verdana, Geneva, sans-serif; letter-spacing: 0; text-shadow: none; padding: 8px 10px; background: var(--kb-row-3) !important; font-size: 13.75px; font-weight: bold; text-align: right; color: var(--kb-fg); vertical-align: middle; }
.about td.v { vertical-align: middle; }
.about .rankline { display: inline-flex; align-items: center; gap: 10px; }
.about .rankline .pips { margin: 0; }
.sig { font-size: 13.75px; }
.sig hr { border: 0; border-top: 1px solid var(--kb-grid); width: 120px; margin: 0 0 8px; }
table.record td.when { width: 170px; font-size: 13.75px; font-variant-numeric: tabular-nums; }
.seeall { display: flex; justify-content: flex-end; font-size: 13.75px; margin: -6px 0 14px; }
.kinds { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 8px; }
.kinds a.b { text-decoration: none; }
.phone .kinds { gap: 3px; }
.phone .kinds .b.sm { padding: 4px 5px; letter-spacing: 0.02em; }
.kinds .b.sm[aria-current] { box-shadow: inset 1px 2px 3px rgb(0 0 0 / 0.45); filter: brightness(0.9); }
.kindnote { font-size: 13.75px; color: var(--kb-muted); margin: 0 0 10px; }
.phone .bigava { width: 76px; height: 152px; font-size: 28px; }
.phone table.about td.avacell { width: 96px; padding: 8px; }
.phone .about th.k { display: table-cell; width: 112px; text-align: left; padding: 6px 8px; font-size: 12.5px; }
.phone .about td.v { padding: 6px 8px; font-size: 13.75px; }
.phone .when-above { display: block; font-size: 12.5px; color: var(--kb-muted); margin-bottom: 2px; }
/* ---------- the trophy case (docs/plans/2026-11-04-cosmetics-design.md, section 4; its board 03) ---------- */
.portrait { position: relative; width: 120px; height: 240px; border: 1px solid var(--kb-fg); overflow: visible; }
.portrait > svg { display: block; width: 100%; height: 100%; }
.portrait .gear { position: absolute; } .portrait .gear svg { display: block; width: 100%; height: 100%; }
table.trophies td.badge { width: 72px; text-align: center; vertical-align: middle; }
table.trophies td.badge svg { width: 30px; height: 30px; display: inline-block; vertical-align: middle; }
table.trophies td.badge svg.wide { width: 54px; height: 27px; }
table.trophies td.shown { width: 110px; font-size: 13.75px; vertical-align: middle; color: var(--kb-muted); }
.trophy b { font-size: 15px; }
.trophy .by { font-size: 13.75px; color: var(--kb-muted); }
table.lineage td { font-size: 13.75px; }
table.lineage td.span { width: 220px; font-variant-numeric: tabular-nums; }
.phone .portrait { width: 76px; height: 152px; }
.phone table.trophies td.badge { width: 48px; padding: 8px 4px; }
.phone .trophy .on { display: block; font-size: 12.5px; color: var(--kb-muted); margin-top: 2px; }
/* ---------- batch 4: The System on the board ---------- */
.notice-wrap { position: relative; margin: 0 0 14px; }
.notice-wrap table.t { margin: 0; }
.notice .says { font-weight: bold; }
.notice td.words { padding: 10px 12px; }
/* the move's label is the glass's own, breaking the notice's frame at its corner as a card's mark breaks a post's */
.glasslabel { position: absolute; right: 14px; top: -14px; z-index: 2; display: flex; transform: skewX(-12deg); box-shadow: 0 0 12px rgb(62 230 255 / 0.65); }
.glasslabel span { display: block; font: 700 18px/1 "Barlow Condensed", sans-serif; text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 14px; }
.glasslabel .l { background: #0d0814; color: #9ef3ff; border: 1px solid #3ee6ff; font-style: italic; }
.glasslabel .w { background: #0d0814; color: #fff; border: 1px solid #3ee6ff; border-left: 1px solid #5b4a7c; }
.sysname { font-weight: bold; font-size: 15px; }
.sysnote { font-size: 12.5px; color: var(--kb-muted); margin-top: 6px; }
.revealline { margin: 0 0 8px; }
/* the class bar is a game piece: the classes' looks, a pattern beside each color */
.classbar { display: flex; height: 26px; border: 1px solid #000; margin: 0 0 6px; }
.classbar span { flex: 1; display: grid; place-items: center; }
.classbar i { font: bold 12.5px/1 "Courier New", monospace; font-style: normal; background: #fff; color: #000; border: 1px solid #000; padding: 2px 4px; }
.classbar .face { background: #2e86de; }
.classbar .heel { background: repeating-linear-gradient(135deg, rgb(0 0 0 / 0.35) 0 2px, transparent 2px 6px), #c0392b; }
.stated { margin: 0; padding-left: 1.2em; font-size: 13.75px; }
.syslist { margin: 0 0 8px; padding-left: 1.2em; }
.staffbadges { display: inline-flex; gap: 6px; align-items: center; }
.coinbadge { display: inline-flex; gap: 5px; align-items: center; border: 1px solid var(--kb-fg); padding: 1px 6px; font: bold 12.5px/1.3 "Courier New", monospace; background: var(--kb-mini-bg); }
.coinbadge i { width: 11px; height: 11px; border-radius: 50%; background: #d4a017; border: 1px solid #000; }
.adminbadge { font: bold 12.5px/1.3 "Courier New", monospace; letter-spacing: 0.06em; background: var(--kb-head-bg); color: var(--kb-head-fg); border: 1px solid #000; padding: 1px 6px; }
table.modlog td.when { width: 110px; font-size: 13.75px; }
table.modlog td.end { width: 220px; font-size: 13.75px; color: var(--kb-muted); }
.lognote { font-size: 13.75px; color: var(--kb-muted); margin: -6px 0 14px; }
/* on the phone each segment keeps its words whole, and the way out wraps under the label when the row is full */
.phone .glasslabel { right: 6px; left: 6px; top: -14px; flex-wrap: wrap; justify-content: flex-end; }
.phone .glasslabel span { font-size: 13px; padding: 4px 8px; white-space: nowrap; }
.phone .notice-wrap { margin-top: 30px; }
/* ---------- batch 5: the errors ---------- */
/* Not found is the forum answering, in its own skin: a period "Information" box. */
table.info h1.missing { font: bold 15px/1.45 Verdana, Geneva, sans-serif; margin: 0 0 10px; }
table.info td.msg { padding: 14px 16px; }
table.info td.msg p { margin: 0 0 10px; }
table.info td.msg ul { margin: 0 0 4px; padding-left: 1.3em; }
table.info td.msg li { margin-bottom: 4px; }
table.info td.addr { background: var(--kb-row-3) !important; font-size: 13.75px; color: var(--kb-muted); }
/* Cannot display is the browser failing: its own plain white page, as the IE pastiche draws it, inside the frame. */
.ie { background: #fff; color: #000; border: 1px solid var(--kb-frame); padding: 26px 32px 22px; display: grid; grid-template-columns: 48px 1fr; gap: 0 16px; font: 15px/1.5 Verdana, Tahoma, Geneva, sans-serif; }
.ie .glyph { width: 40px; height: 48px; border: 2px solid #555; clip-path: polygon(0 0, 70% 0, 100% 25%, 100% 100%, 0 100%); background: linear-gradient(225deg, #555 0 17%, #fff 17%); }
.ie h1 { font: bold 19px/1.3 Verdana, Tahoma, sans-serif; margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid #000; }
.ie p { margin: 0 0 10px; } .ie ul { margin: 0 0 10px; padding-left: 1.3em; } .ie li { margin-bottom: 4px; }
.ie a { color: #000; }
.ie button { font: 15px Verdana, sans-serif; background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; color: #000; }
.ie .foot2 { border-top: 1px solid #000; padding-top: 8px; color: #555; font-size: 13.75px; margin: 4px 0 0; }
.phone .ie { grid-template-columns: 1fr; padding: 18px 16px; }
.phone table.info, .phone .ie { margin-top: 14px; }
/* in dark mode the browser's page is charcoal: a dark-mode reader gets no white flash, and the glyph and the rules still make it the browser's page */
:root[data-kb-mode="dark"] .ie, .screen[data-kb-mode="dark"] .ie { background: #1c1c1c; color: #e8e8e8; }
:root[data-kb-mode="dark"] .ie :is(a, button), .screen[data-kb-mode="dark"] .ie :is(a, button) { color: #fff; }
:root[data-kb-mode="dark"] .ie :is(h1, .foot2), .screen[data-kb-mode="dark"] .ie :is(h1, .foot2) { border-color: #8a8a8a; }
:root[data-kb-mode="dark"] .ie .foot2, .screen[data-kb-mode="dark"] .ie .foot2 { color: #b0b0b0; }
:root[data-kb-mode="dark"] .ie .glyph, .screen[data-kb-mode="dark"] .ie .glyph { border-color: #b0b0b0; background: linear-gradient(225deg, #b0b0b0 0 17%, #1c1c1c 17%); }
.phone .ie .glyph { margin-bottom: 10px; }
`;

/* ---------- content ---------- */
const BANNER = (phone) => `
  <header class="banner">
    <div><p class="logo">DIVIDED WORLD</p>${phone ? `<div class="host">dw.gripe <span class="meter"></span></div>` : ''}</div>
    ${phone ? `<button class="b boards" type="button">Boards</button>` : `<div class="host">dw.gripe <span class="meter"></span></div>`}
  </header>
  <nav class="nav" aria-label="Boards"><a href="#">${px('home')}Index</a><a href="#">${px('board')}General</a><a href="#">${px('board')}Staff Announcements</a></nav>`;

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
      <tr><td><a class="name" href="#">General</a><div class="meta">Anything and everything. The staff are watching.</div></td><td class="n">3</td>
        <td class="last"><span class="who"><span class="mini">M</span><a href="#">Mrs. Hooligan</a></span><br><a class="muted" href="#">Oct 6, 2026</a></td></tr>
      <tr><td><a class="name" href="#">Staff Announcements</a><span class="tag">Staff post here; you react and spin</span><div class="meta">Where the staff post. Reply by spinning a thread.</div></td><td class="n">0</td>
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
  <p class="desc">Anything and everything. The staff are watching.</p>
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
      <tr><td><a class="name" href="#">General</a><div class="meta">Anything and everything. The staff are watching.</div>
        <div class="row-meta"><b>3</b> threads · last: <span class="who"><span class="mini">M</span><a href="#">Mrs. Hooligan</a></span>, <a class="muted" href="#">Oct 6</a></div></td></tr>
      <tr><td><a class="name" href="#">Staff Announcements</a><div style="margin-top:4px"><span class="tag" style="margin:0">Staff post here; you react and spin</span></div><div class="meta">Where the staff post. Reply by spinning a thread.</div>
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
  <p class="desc small">Anything and everything. The staff are watching.</p>
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

/* ================= batch 2: a thread, the reply box, New thread ================= */
/* Page 3 of "who keeps splatting my posts", the Main board's thread (docs/research/2026-10-29-two-worlds/01-main.html). */
/* The splat is drawn for place only: Whoops!'s ink is a game piece, held by its own boards and e2e/whoops.spec.ts. */
const SPLAT = `<svg class="splat" aria-hidden="true" viewBox="0 0 560 190" preserveAspectRatio="none"><g fill="#d93fbf">
  <ellipse cx="250" cy="92" rx="150" ry="62"/><ellipse cx="380" cy="70" rx="90" ry="48"/><ellipse cx="150" cy="120" rx="80" ry="40"/>
  <path d="M60,150 C110,120 150,110 190,118 L170,140 C130,148 95,160 60,150 Z"/><path d="M430,40 C470,20 520,24 540,10 C520,40 480,60 440,70 Z"/>
  <circle cx="40" cy="160" r="9"/><circle cx="18" cy="150" r="5"/><circle cx="520" cy="60" r="8"/><circle cx="545" cy="80" r="5"/><circle cx="300" cy="170" r="10"/><circle cx="330" cy="182" r="5"/><circle cx="120" cy="60" r="7"/></g>
  <g fill="#ff7fe0" opacity="0.55"><ellipse cx="230" cy="70" rx="70" ry="16"/><ellipse cx="370" cy="52" rx="38" ry="10"/></g></svg>`;
const POSTS = [
  { n: 41, who: 'Spritey', rank: 'Main Eventer', pips: 4, posts: 13, at: 'Oct 29, 2026, 9:14 PM', mark: true, splat: true,
    body: '<p>Third time this week. I wrote four whole paragraphs about the new level editor and the ink went down before anyone got past the first sentence.</p><p>I\'m not mad. I\'m documenting.</p><p>Posting this one in pencil.</p>',
    reacts: [['🔥', 4], ['🙏', 1], ['🙄', 2]], edit: false },
  { n: 42, who: 'Mrs. Hooligan', rank: 'Midcarder', pips: 3, posts: 11, at: 'Oct 29, 2026, 9:20 PM',
    body: '<p>Magenta is a very popular color. Half this board would pick magenta. I would pick something classier, personally, if I were the kind of person who did that, which I\'m not.</p><p>Also you double-posted the changelog in the other thread so honestly it\'s a public service.</p>',
    reacts: [['🍅', 2], ['🤮', 3], ['🙏', 1], ['🙂', 1]], edit: false },
  { n: 43, who: 'Pipewrench', rank: 'Enhancement Talent', pips: 2, posts: 10, at: 'Oct 29, 2026, 9:31 PM',
    body: '<div class="quote"><b>Mrs. Hooligan wrote:</b><div>I would pick something classier, personally.</div></div><p>Can confirm Mrs. Hooligan has never once been seen in the same thread as a bucket of ink. Suspicious in its own way, if you think about it.</p>',
    reacts: [], edit: true },
];
const pips = (n) => `<span class="pips" aria-label="Rank ${n} of 6">${Array.from({ length: 6 }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;
const reacts = (p) => (p.reacts.length ? `<div class="reacts">${p.reacts.map(([e, c]) => `<span class="react"><span class="up"><span class="e">${e}</span><b>${c}</b></span></span>`).join('')}</div>` : '');
/* the post line: when, the post's marks, its permalink, in a cell of its own ruled edge to edge, a band for the marks */
const pline = (p, at) => `<div class="pl"><span>${at}</span><span class="r">${p.mark ? '<span class="markw"><span class="up"><i></i></span></span>' : ''}<a href="#">#${p.n}</a></span></div>`;
const actions = (p) => `<div class="acts"><button class="b sm" type="button">Quote</button><button class="b sm" type="button">Spin thread</button>${p.edit ? '<button class="b sm" type="button">Edit</button>' : ''}<button class="b sm" type="button">History</button></div>`;
const postDesk = (p, i, last) => `
    <tbody${i % 2 ? ' class="alt"' : ''}>
      <tr><td class="bit" rowspan="3"><a class="pname" href="#">${p.who}</a><div class="prank">${p.rank}</div>${pips(p.pips)}<div class="ava">${p.who[0]}</div><div class="pcounts">Posts: ${p.posts}<br>Joined Oct 2026</div></td>
        <td class="pline">${pline(p, p.at)}</td></tr>
      <tr><td>
          <div class="pbody">${p.splat ? SPLAT : ''}${p.body}${reacts(p)}</div></td></tr>
      <tr><td class="foot">${actions(p)}</td></tr>
    </tbody>${i < last ? '<tbody><tr class="gap"><td colspan="2"></td></tr></tbody>' : ''}`;
const PAGER = `<nav class="pager" aria-label="Pages, top"><span class="where">Page 3 of 3</span><a href="#">1</a><a href="#">2</a><span class="here" aria-current="page">3</span><a href="#">Jump to latest</a></nav>`;
const THREAD_DESK = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">General</a> › who keeps splatting my posts</p>
  <div class="head"><h1 class="title">who keeps splatting my posts</h1>${PAGER}</div>
  <table class="t posts"><thead><tr><th scope="col" style="width:216px">Author</th><th scope="col">Message</th></tr></thead>${POSTS.map((p, i) => postDesk(p, i, POSTS.length - 1)).join('')}</table>`;

const TOOLS = ['<b>B</b>', '<i>I</i>', '<u>U</u>', '<s>S</s>', 'Link', 'Image', 'Quote', 'Code', 'List'].map((t) => `<button class="b sm" type="button">${t}</button>`).join('');
const reply = (hint) => `
  <table class="t form"><tbody>
    <tr><td class="bar"><h2 class="barh">Reply</h2></td></tr>
    <tr><td><p class="as">Posting as <b>Pipewrench</b></p><div class="tools" role="toolbar" aria-label="Formatting">${TOOLS}</div><div class="area"></div>
      <div class="formfoot"><span>0 of 20000</span><span class="go">${hint ? 'Ctrl+Enter or Command+Enter sends ' : ''}<button class="b sm" type="button">Preview</button><button class="b primary" type="button">Send</button><button class="b sm" type="button">Reveal…</button></span></div></td></tr>
  </tbody></table>`;
/* The thread's foot, scrolled to: the last post, the pager, Follow, the reply box, who is reading. */
const REPLY_DESK = `
  <table class="t posts" style="margin-top:14px">${postDesk(POSTS[2], 0, 0)}</table>
  <div class="below">${PAGER.replace('Pages, top', 'Pages, bottom')}<button class="b sm" type="button">Unfollow this thread</button></div>
  ${reply(true)}
  <table class="t"><tbody><tr><td class="bar" colspan="2"><h2 class="barh">Users browsing this thread</h2></td></tr><tr><td class="ico">${px('who')}</td><td><a href="#">Pipewrench</a>, <a href="#">Spritey</a></td></tr></tbody></table>`;

const newForm = (hint, h) => `
  <table class="t form"><tbody>
    <tr><td class="bar"><h2 class="barh">Start a thread</h2></td></tr>
    <tr><td><p class="as">Posting as <b>Mrs. Hooligan</b></p>
      <label class="field">Title</label><div class="input"></div>
      <label class="field">First post</label><div class="tools" role="toolbar" aria-label="Formatting">${TOOLS}</div><div class="area" style="height:${h}px"></div>
      <div class="formfoot"><span>0 of 20000</span><span class="go">${hint ? 'Ctrl+Enter or Command+Enter starts it ' : ''}<button class="b sm" type="button">Preview</button><button class="b primary" type="button">Start thread</button></span></div></td></tr>
  </tbody></table>`;
const NEW_DESK = `
  <p class="crumb"><a href="#">Index</a> › General</p>
  <h1 class="title">General</h1>
  <p class="desc">Anything and everything. The staff are watching.</p>
  <div class="over"><button class="b pressed" type="button" aria-expanded="true">${px('start')}Start a thread</button></div>
  ${newForm(true, 120)}
  <table class="t"><thead><tr><th scope="col" style="width:48px"><span class="vh">Status</span></th><th scope="col">Thread</th><th scope="col" class="n" style="width:100px">Replies</th><th scope="col" class="n" style="width:100px">Views</th><th scope="col" style="width:280px">Last post</th></tr></thead>
    <tbody>${ROWS.map(rowDesk).join('')}</tbody></table>`;

/* the phone: a post stacked, its postbit a band over it */
const postPhone = (p) => `
    <tbody>
      <tr><td class="pbit"><div class="bitrow"><div class="ava">${p.who[0]}</div><div><a class="pname" href="#">${p.who}</a><div class="prank" style="font-size:13.75px">${p.rank}</div>${pips(p.pips)}</div></div></td></tr>
      <tr><td class="pline">${pline(p, p.at.replace(', 2026', ''))}</td></tr>
      <tr><td><div class="pbody">${p.splat ? SPLAT : ''}${p.body}${reacts(p)}</div></td></tr>
      <tr><td class="foot">${actions(p)}</td></tr>
    </tbody>`;
const THREAD_PHONE = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">General</a> › who keeps splatting my posts</p>
  <div class="head"><h1 class="title">who keeps splatting my posts</h1>${PAGER}</div>
  <table class="t posts">${postPhone(POSTS[0])}<tbody><tr class="gap"><td></td></tr></tbody>${postPhone(POSTS[1])}</table>`;
const REPLY_PHONE = `
  <table class="t posts" style="margin-top:0">${postPhone(POSTS[2])}</table>
  <div class="below">${PAGER.replace('Pages, top', 'Pages, bottom')}</div>
  <div class="below"><button class="b sm" type="button">Unfollow this thread</button></div>
  ${reply(false)}`;
const NEW_PHONE = `
  <p class="crumb"><a href="#">Index</a> › General</p>
  <h1 class="title">General</h1>
  <div class="over"><button class="b pressed" type="button" aria-expanded="true">${px('start')}Start a thread</button></div>
  ${newForm(false, 110)}`;

const withHud = (html, who) => html.replace('>M</span><span class="nm">Mrs. Hooligan<', `>${who[0]}</span><span class="nm">${who}<`);
/* the reply board is the thread scrolled to its foot: no banner, the HUD in place */
const scrolled = (content) => `<div class="screen desk" style="width:1440px;height:1000px"><div class="col">${content}${FOOT}</div>${HUD}</div>`;
const batch2 = [
  ['04-thread.html', 'A thread, Silver light', 'light', withHud(desk(THREAD_DESK), 'Pipewrench')],
  ['04-thread-dark.html', 'A thread, Silver dark', 'dark', withHud(desk(THREAD_DESK), 'Pipewrench')],
  ['05-reply.html', 'The reply box at a thread\'s foot, Silver light', 'light', withHud(scrolled(REPLY_DESK), 'Pipewrench')],
  ['05-reply-dark.html', 'The reply box at a thread\'s foot, Silver dark', 'dark', withHud(scrolled(REPLY_DESK), 'Pipewrench')],
  ['06-new-thread.html', 'Start a thread, Silver light', 'light', desk(NEW_DESK)],
  ['06-new-thread-dark.html', 'Start a thread, Silver dark', 'dark', desk(NEW_DESK)],
];
for (const [file, title, mode, body] of batch2) {
  fs.writeFileSync(path.join(here, file), page({ title, mode, width: 1440, height: 1000, body,
    comment: `A board of the board look design session (docs/plans/2026-11-06-board-look-design.md), batch 2, 1440 by 1000, written by gen.mjs.` }));
}
const phoneScrolled = (content, mode) => `<div class="screen phone" ${mode === 'dark' ? 'data-kb-mode="dark"' : ''} style="width:390px;height:844px"><div class="col">${content}</div>${HUD}</div>`;
fs.writeFileSync(path.join(here, '07-phone.html'), page({
  title: 'A thread, the reply box and Start a thread on the phone, Silver', mode: 'light', width: 4 * 390 + 3 * 24, height: 844,
  comment: 'A board of the board look design session, batch 2: four phone screens at 390 by 844 (a thread, its reply box and Start a thread in light; the thread in dark), 24px apart. Written by gen.mjs.',
  body: `<style>${PHONE_CSS_DARK}</style><div style="display:flex;gap:24px">${withHud(phoneScreen(THREAD_PHONE, 'light'), 'Pipewrench')}${withHud(phoneScrolled(REPLY_PHONE, 'light'), 'Pipewrench')}${phoneScreen(NEW_PHONE, 'light')}${withHud(phoneScreen(THREAD_PHONE, 'dark'), 'Pipewrench')}</div>`,
}));
console.log('wrote the batch 2 boards');

/* ================= batch 3: a profile and its record ================= */
/* Spritey's profile, as engine/ui/profile/Profile.tsx draws one that has revealed its class, and its full record (Record.tsx). */
/* The cosmetics boards' placeholder art (docs/research/2026-11-04-cosmetics/art.svg), inlined so each board stands alone. */
const ART = fs.readFileSync(path.join(here, '../2026-11-04-cosmetics/art.svg'), 'utf8').replace('<svg ', '<svg aria-hidden="true" style="position:absolute;width:0;height:0" ');
const use = (id, vb, cls = '') => `<svg viewBox="${vb}"${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#${id}"/></svg>`;
/* the portrait as the cosmetics board 03 dresses it: a cap reaching above the slot, a mustache, a button */
const PORTRAIT = `<div class="portrait" role="img" aria-label="Spritey's portrait">${use('portrait', '0 0 100 200')}
  <span class="gear" style="left:12%;top:-6%;width:76%;height:23%;transform:rotate(-8deg)">${use('g-cap', '0 0 100 60')}</span>
  <span class="gear" style="left:30%;top:34.5%;width:40%;height:7%">${use('g-stache', '0 0 100 34')}</span>
  <span class="gear" style="left:56%;top:54%;width:26%;height:13%;transform:rotate(14deg)">${use('g-button', '0 0 60 60')}</span></div>`;
const TROPHIES = [
  ['t-belt', '0 0 48 24', 'wide', '<b>Hardcore Belt</b> · champion since Nov&nbsp;2', '(taken from Sock Puppet by Sighbot, the Boss)', true],
  ['t-sprite', '0 0 24 24', '', '<b>Sprite Contest 2026</b> · “Best walk cycle.”', 'Awarded by an admin, Oct 30', true],
  ['t-pet', '0 0 24 24', '', '<b>Boss’s Pet</b>', 'Given by Sighbot, the Boss, Oct 21 · <a href="#">its post</a>', true],
  ['t-demand', '0 0 24 24', '', '<b>Met the Boss’s demand</b> · “12 characters post in Tomato Talk”', 'Oct 14 · <a href="#">the move</a>', false],
];
const LINEAGE = [['Spritey', 'Nov 2 – now', 'by Sighbot’s move'], ['Sock Puppet', 'Oct 18 – Nov 2', 'by Sighbot’s move'], ['Dr. Bones', 'Oct 9 – Oct 18', 'by an admin (first holder)']];
const trophyCase = (phone) => `
  <table class="t trophies"><caption class="vh">Spritey’s trophies, newest first</caption>
    <thead><tr><td class="bar" colspan="${phone ? 2 : 3}"><h2 class="barh">Trophy case (${TROPHIES.length})</h2></td></tr></thead>
    <tbody>${TROPHIES.map(([id, vb, cls, what, by, on]) => `<tr><td class="badge">${use(id, vb, cls)}</td>
      <td class="trophy">${what}<br><span class="by">${by}</span>${phone && on ? '<span class="on">On posts</span>' : ''}</td>${phone ? '' : `<td class="shown">${on ? 'On posts' : ''}</td>`}</tr>`).join('')}</tbody></table>
  <table class="t lineage"><caption class="vh">The Hardcore Belt’s holders, newest first</caption>
    <thead><tr><td class="bar" colspan="${phone ? 1 : 3}"><h2 class="barh">The Hardcore Belt’s lineage</h2></td></tr></thead>
    <tbody>${LINEAGE.map(([who, span, by]) => phone
      ? `<tr><td><a href="#">${who}</a> · ${span}<br><span class="muted">${by}</span></td></tr>`
      : `<tr><td><a href="#">${who}</a></td><td class="span">${span}</td><td class="muted">${by}</td></tr>`).join('')}</tbody></table>`;
const FACTS = [
  ['Title', 'Level editor guy'],
  ['Rank', `<span class="rankline"><b>Main Eventer</b>${pips(4)}</span>`],
  ['Aura this season', '<b>1.85</b> <span class="muted">(settled Oct 30, 8:17 AM)</span>'],
  ['Place', '1 of 3 in season 1 · <a href="#">season standings</a>'],
  ['Posts', '13'], ['Threads spun', '2'], ['Cards played', '4'], ['Joined', 'Oct 2026'],
  ['Wearing', 'Baseball Cap, Mustache, “I Really Wish I Weren’t Here” Button'],
  ['Class', 'Revealed: Face (Oct 20)'],
];
const SIG = '<div class="sig"><hr><i>posting in pencil since 2003</i></div>';
const RECORD = [
  ['Oct 29, 2026', 'Posted: Third time this week. I wrote four whole paragraphs…'],
  ['Oct 28, 2026', 'Played Whoops!: “for the changelog”'],
  ['Oct 27, 2026', 'Spun a thread: who keeps splatting my posts'],
  ['Oct 26, 2026', 'Posted: Who keeps reacting with a thumbs up?'],
  ['Oct 22, 2026', 'Played Stick Around'],
  ['Oct 20, 2026', 'Revealed: Face'],
  ['Oct 19, 2026', 'Posted: Post 168 of the long thread. Still going.'],
  ['Oct 18, 2026', 'Spun a thread: The long one'],
  ['Oct 18, 2026', 'Posted: Post 165 of the long thread. Still going.'],
  ['Oct 17, 2026', 'Played Whoops!'],
  ['Oct 16, 2026', 'Posted: Post 162 of the long thread. Still going.'],
  ['Oct 15, 2026', 'Posted: Post 159 of the long thread. Still going.'],
];
const recordTable = (rows, phone) => `<table class="t record"><caption class="vh">Public record, newest first</caption>
    ${phone ? '' : '<thead><tr><th scope="col">When</th><th scope="col">What</th></tr></thead>'}
    <tbody>${rows.map(([w, t]) => phone
      ? `<tr><td><span class="when-above">${w.replace(', 2026', '')}</span><a href="#">${t}</a></td></tr>`
      : `<tr><td class="when">${w}</td><td><a href="#">${t}</a></td></tr>`).join('')}</tbody></table>`;
const PROFILE_DESK = `${ART}
  <p class="crumb"><a href="#">Index</a> › Spritey</p>
  <h1 class="title">Spritey</h1>
  <table class="t about"><caption class="vh">About Spritey</caption>
    <thead><tr><th scope="col" colspan="3">About Spritey</th></tr></thead>
    <tbody>
      ${FACTS.map(([k, v], i) => `<tr>${i === 0 ? `<td class="avacell" rowspan="${FACTS.length + 1}">${PORTRAIT}</td>` : ''}<th scope="row" class="k">${k}</th><td class="v">${v}</td></tr>`).join('')}
      <tr><td class="v" colspan="2">${SIG}</td></tr>
    </tbody></table>
  ${trophyCase(false)}
  ${recordTable(RECORD.slice(0, 5), false).replace('Public record, newest first', 'Latest rows of the public record, newest first').replace('<thead>', '<thead><tr><td class="bar" colspan="2"><h2 class="barh">Public record</h2></td></tr>')}
  <p class="seeall"><a href="#">See the full record</a></p>`;
const KINDS = ['All', 'Posts', 'Spins', 'Cards', 'Class statements', 'Seasons'];
const RECORD_DESK = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">Spritey</a> › Public record</p>
  <h1 class="title">Spritey’s public record</h1>
  <nav class="kinds" aria-label="Kind of row">${KINDS.map((k, i) => `<a class="b sm" href="#"${i === 0 ? ' aria-current="true"' : ''}>${k}</a>`).join('')}</nav>
  <p class="kindnote">Its Acts with its reveals, announced Turns and season reveal posts, newest first.</p>
  ${recordTable(RECORD, false)}
  <div class="below"><nav class="pager" aria-label="Pages of the record"><span class="where">Page 1 of 3</span><span class="here" aria-current="page">1</span><a href="#">2</a><a href="#">3</a><a href="#">Next page</a></nav></div>`;
const PROFILE_PHONE = `${ART}
  <p class="crumb"><a href="#">Index</a> › Spritey</p>
  <h1 class="title">Spritey</h1>
  <table class="t about"><caption class="vh">About Spritey</caption>
    <tbody>
      <tr><td class="avacell">${PORTRAIT}</td><td><b>Main Eventer</b><br>${pips(4)}<div class="muted small">Level editor guy</div></td></tr>
    </tbody></table>
  <table class="t about"><tbody>
    ${FACTS.slice(2).map(([k, v]) => `<tr><th scope="row" class="k">${k}</th><td class="v">${v}</td></tr>`).join('')}
    <tr><td class="v" colspan="2">${SIG}</td></tr>
  </tbody></table>`;
/* the phone profile scrolled to its trophy case */
const CASE_PHONE = `${ART}${trophyCase(true)}`;
const RECORD_PHONE = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">Spritey</a> › Public record</p>
  <h1 class="title">Spritey’s public record</h1>
  <nav class="kinds" aria-label="Kind of row">${KINDS.map((k, i) => `<a class="b sm" href="#"${i === 0 ? ' aria-current="true"' : ''}>${k}</a>`).join('')}</nav>
  ${recordTable(RECORD.slice(0, 8), true)}`;
/* a page drawn whole, 1700 tall, the HUD at its foot */
const tall = (content) => desk(content).replace('height:1000px', 'height:1700px');
const batch3 = [
  ['08-profile.html', 'A profile with its trophy case, Silver light', 'light', tall(PROFILE_DESK)],
  ['08-profile-dark.html', 'A profile with its trophy case, Silver dark', 'dark', tall(PROFILE_DESK)],
  ['09-record.html', 'A public record, Silver light', 'light', desk(RECORD_DESK)],
  ['09-record-dark.html', 'A public record, Silver dark', 'dark', desk(RECORD_DESK)],
];
for (const [file, title, mode, body] of batch3) {
  const h = file.startsWith('08-') ? 1700 : 1000;
  fs.writeFileSync(path.join(here, file), page({ title, mode, width: 1440, height: h, body,
    comment: `A board of the board look design session (docs/plans/2026-11-06-board-look-design.md), batch 3, 1440 by ${h}, written by gen.mjs.` }));
}
fs.writeFileSync(path.join(here, '10-phone.html'), page({
  title: 'A profile and its record on the phone, Silver', mode: 'light', width: 4 * 390 + 3 * 24, height: 844,
  comment: 'A board of the board look design session, batch 3: four phone screens at 390 by 844, the profile, its trophy case scrolled to, and its record in light, then the profile in dark, 24px apart. Written by gen.mjs.',
  body: `<style>${PHONE_CSS_DARK}</style><div style="display:flex;gap:24px">${phoneScreen(PROFILE_PHONE, 'light')}${phoneScrolled(CASE_PHONE, 'light')}${phoneScreen(RECORD_PHONE, 'light')}${phoneScreen(PROFILE_PHONE, 'dark')}</div>`,
}));
console.log('wrote the batch 3 boards');

/* ================= batch 4: The System on the board ================= */
/* The move notice (engine/ui/board/MoveNotice.tsx), the reveal and tally posts (engine/ui/reveal/Reveal.tsx) and a staff profile
   (engine/ui/profile/Staff.tsx), on their stories' content. The Boss's words are in character and may bluff;
   the glass label, the moderation log and the notes are the engine's plain words. */
const notice = (phone) => `
  <div class="notice-wrap">
    <div class="glasslabel"><span class="l">The Boss renamed this board</span><span class="w">Way out: 5 of 12 posters ›</span></div>
    <table class="t notice"><tbody>
      <tr><td class="bar"><span class="says">Announcement from <a href="#">The Director</a></span></td></tr>
      <tr><td class="words">This board has been IMPROVED. From now on we talk about toast. Show me twelve of you can handle it and maybe I will think about it.
        ${reacts({ reacts: [['🔥', 9], ['🍅', 6], ['👍', 3]] })}</td></tr>
    </tbody></table>
  </div>`;
const TOAST_ROW = { icon: 'new', state: 'New', title: 'toast is a sandwich and I can prove it', by: ['S', 'Spritey'], unread: true, pages: '', replies: 4, views: 0, last: ['P', 'Poster 4', '8 days ago'] };
const NOTICE_DESK = `
  <p class="crumb"><a href="#">Index</a> › Pointless Toast Palace</p>
  <h1 class="title">Pointless Toast Palace</h1>
  <p class="desc">Welcome to the Pointless Toast Palace. Please butter responsibly.</p>
  ${notice(false)}
  <div class="over"><button class="b" type="button">${px('start')}Start a thread</button></div>
  <table class="t"><thead><tr><th scope="col" style="width:48px"><span class="vh">Status</span></th><th scope="col">Thread</th><th scope="col" class="n" style="width:100px">Replies</th><th scope="col" class="n" style="width:100px">Views</th><th scope="col" style="width:280px">Last post</th></tr></thead>
    <tbody>${rowDesk(TOAST_ROW)}</tbody></table>
  <table class="t"><tbody><tr><td class="bar" colspan="2"><h2 class="barh">Users browsing this board</h2></td></tr><tr><td class="ico">${px('who')}</td><td><a href="#">Pipewrench</a></td></tr></tbody></table>`;

/* The Boss's posts: the reveal (signed by the outgoing Boss at the handover) and a settlement's tally. Its postbit is a staff
   member's: its name, its badges, its title, its avatar, no rank (staff are not scored). Its line is in character; the list under it
   is the engine's, exact. */
const BOSSBIT = `<a class="pname" href="#">The Director</a><div style="margin:6px 0 4px"><span class="staffbadges"><span class="coinbadge"><i></i>Personality Cores</span></span></div><div style="margin:0 0 8px"><span class="adminbadge">ADMINISTRATOR</span></div><div class="small muted" style="margin-bottom:8px">Head of Board Operations (Toast Division)</div><div class="ava">T</div><div class="pcounts">Posts: 9<br>Joined Aug 2026</div>`;
const BOSSBIT_PHONE = `<div class="bitrow"><div class="ava">T</div><div><a class="pname" href="#">The Director</a><div style="margin-top:4px"><span class="adminbadge">ADMINISTRATOR</span></div></div></div>`;
const sysPost = (n, at, body, rx, i, phone) => phone ? `
    <tbody>
      <tr><td class="pbit">${BOSSBIT_PHONE}</td></tr>
      <tr><td class="pline">${pline({ n }, at)}</td></tr>
      <tr><td><div class="pbody">${body}${reacts({ reacts: rx })}</div></td></tr>
      <tr><td class="foot"><div class="acts"><button class="b sm" type="button">Quote</button><button class="b sm" type="button">Spin thread</button><button class="b sm" type="button">History</button></div></td></tr>
    </tbody>` : `
    <tbody${i % 2 ? ' class="alt"' : ''}>
      <tr><td class="bit" rowspan="3">${BOSSBIT}</td><td class="pline">${pline({ n }, at)}</td></tr>
      <tr><td><div class="pbody">${body}${reacts({ reacts: rx })}</div></td></tr>
      <tr><td class="foot"><div class="acts"><button class="b sm" type="button">Quote</button><button class="b sm" type="button">Spin thread</button><button class="b sm" type="button">History</button></div></td></tr>
    </tbody>`;
const gap = (cols) => `<tbody><tr class="gap"><td colspan="${cols}"></td></tr></tbody>`;
const REVEALS = [
  [1, 'Oct 31, 2026, 12:00 PM', '<p>My last act as your Director: everyone, unmasked as far as you let me. Try to act surprised. I will not be here to see it.</p>', [['🔥', 7], ['🙄', 3]]],
  [2, 'Oct 31, 2026, 12:00 PM', `<p class="revealline"><b><a href="#">Spritey</a></b>: finished #1, <b>Legend</b> ${pips(6)}, 52.10.</p>
    <div class="classbar" role="img" aria-label="Classes its player made public: Face, revealed Oct 20."><span class="face"><i aria-hidden="true">Face</i></span></div>
    <ul class="stated"><li>Face, revealed Oct 20</li></ul>`, [['🔥', 4], ['🙏', 2]]],
  [3, 'Oct 31, 2026, 12:00 PM', `<p class="revealline"><b><a href="#">Mrs. Hooligan</a></b>: finished #2, <b>Main Eventer</b> ${pips(4)}, 47.35.</p>
    <p class="small muted">Its player made nothing about its class public.</p>`, [['🤔', 5]]],
  [4, 'Oct 31, 2026, 12:00 PM', `<p class="revealline"><b><a href="#">Pipewrench</a></b>: finished #3, <b>Legend</b> ${pips(6)}, 41.70.</p>
    <div class="classbar" role="img" aria-label="Classes its player made public: Face, until its Turn on Oct 20; Heel, revealed Oct 21."><span class="face"><i aria-hidden="true">Face</i></span><span class="heel"><i aria-hidden="true">Heel</i></span></div>
    <ul class="stated"><li>Face, until its Turn on Oct 20</li><li>Heel, revealed Oct 21</li></ul>`, [['🍅', 6], ['🔥', 2]]],
];
const revealPosts = (phone, from) => REVEALS.slice(from).map(([n, at, body, rx], i) => sysPost(n, at, body, rx, i, phone)).join(gap(phone ? 1 : 2));
const REVEAL_DESK = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">Staff Announcements</a> › Season 1: the reveal</p>
  <div class="head"><h1 class="title">Season 1: the reveal</h1></div>
  <table class="t posts"><thead><tr><th scope="col" style="width:216px">Author</th><th scope="col">Message</th></tr></thead>${revealPosts(false, 0)}</table>`;
const TALLY_DESK = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">Staff Announcements</a> › Tonight’s settlement</p>
  <div class="head"><h1 class="title">Tonight’s settlement</h1></div>
  <table class="t posts"><thead><tr><th scope="col" style="width:216px">Author</th><th scope="col">Message</th></tr></thead>
  ${sysPost(1, 'Oct 30, 2026, 8:17 AM', `<p>The numbers are in. Some of you did well. I will not say who, except that I will, below.</p>
    <ul class="syslist"><li><a href="#">Spritey</a> debuts</li><li><a href="#">Pipewrench</a> has Turned</li></ul>`, [['🔥', 3], ['🙏', 1]], 0, false)}</table>
  <table class="t"><tbody><tr><td class="small">Replies here are spins. Use “Spin thread” on any post to start a thread of your own from it.</td></tr></tbody></table>`;

const STAFF_FACTS = [
  ['Staff', '<span class="staffbadges"><span class="coinbadge"><i></i>Personality Cores</span><span class="adminbadge">ADMINISTRATOR</span></span>'],
  ['Title', 'Head of Board Operations (Toast Division)'],
  ['Interests', 'toast, artisanal breads, the 1998 film Small Soldiers (since Tuesday)'],
  ['Favorite members', '<a href="#">Spritey</a>, <a href="#">Pipewrench</a>'],
  ['Current mood', 'Disappointed but Hopeful'],
  ['Career', 'No office held yet.'],
  ['Posts', '0'], ['Joined', 'Aug 2026'],
];
const STAFF_NOTE = '<p class="sysnote">The interests, favorites, mood and signature are what it says about itself, in character, and it may bluff. The moderation log is a plain record.</p>';
const MODLOG = [
  ['Oct 28', 'Renamed <a href="#">General</a> to <a href="#">Pointless Toast Palace</a>', 'in force'],
  ['Oct 25', 'Renamed <a href="#">General</a> to <a href="#">Lawn Bowling Lounge</a>', 'undone: 12 posted'],
  ['Oct 22', 'Renamed <a href="#">General</a> to <a href="#">Pirate Puns Palace</a>', 'ran out Oct 25'],
  ['Oct 20', 'Renamed <a href="#">General</a> to <a href="#">Small Soldiers Situation Room</a>', 'reversed by an admin'],
];
const modlog = (phone) => `
  <table class="t modlog"><caption class="vh">The Director’s moves, newest first</caption>
    <thead><tr><td class="bar" colspan="${phone ? 1 : 3}"><h2 class="barh">Moderation log</h2></td></tr>${phone ? '' : '<tr><th scope="col">When</th><th scope="col">What it did</th><th scope="col">How it ended</th></tr>'}</thead>
    <tbody>${MODLOG.map(([w, what, end]) => phone
      ? `<tr><td><span class="when-above">${w}</span>${what}<br><span class="muted small">${end}</span></td></tr>`
      : `<tr><td class="when">${w}</td><td>${what}</td><td class="end">${end}</td></tr>`).join('')}</tbody></table>
  <p class="lognote">Every move this staff member has made, newest first.</p>`;
const STAFF_DESK = `
  <p class="crumb"><a href="#">Index</a> › The Director</p>
  <h1 class="title">The Director</h1>
  <table class="t about"><caption class="vh">About The Director</caption>
    <thead><tr><th scope="col" colspan="3">About The Director</th></tr></thead>
    <tbody>
      ${STAFF_FACTS.map(([k, v], i) => `<tr>${i === 0 ? `<td class="avacell" rowspan="${STAFF_FACTS.length + 1}"><div class="bigava">T</div></td>` : ''}<th scope="row" class="k">${k}</th><td class="v">${v}</td></tr>`).join('')}
      <tr><td class="v" colspan="2"><div class="sig"><hr>A forum is like a loaf of bread. Somebody has to slice it.</div>${STAFF_NOTE}</td></tr>
    </tbody></table>
  ${modlog(false)}`;

const NOTICE_PHONE = `
  <p class="crumb"><a href="#">Index</a> › Pointless Toast Palace</p>
  <h1 class="title">Pointless Toast Palace</h1>
  <p class="desc small">Welcome to the Pointless Toast Palace. Please butter responsibly.</p>
  ${notice(true)}
  <div class="over"><button class="b" type="button">${px('start')}Start a thread</button></div>
  <table class="t"><tbody>${rowPhone(TOAST_ROW)}</tbody></table>`;
const REVEAL_PHONE = `
  <p class="crumb"><a href="#">Index</a> › <a href="#">Staff Announcements</a> › Season 1: the reveal</p>
  <div class="head"><h1 class="title">Season 1: the reveal</h1></div>
  <table class="t posts">${revealPosts(true, 1)}</table>`;
const STAFF_PHONE = `
  <p class="crumb"><a href="#">Index</a> › The Director</p>
  <h1 class="title">The Director</h1>
  <table class="t about"><tbody>
    <tr><td class="avacell"><div class="bigava">T</div></td><td>${STAFF_FACTS[0][1]}<div class="muted small" style="margin-top:6px">Head of Board Operations (Toast Division)</div></td></tr>
  </tbody></table>
  <table class="t about"><tbody>${STAFF_FACTS.slice(2).map(([k, v]) => `<tr><th scope="row" class="k">${k}</th><td class="v">${v}</td></tr>`).join('')}</tbody></table>
  ${modlog(true)}`;

const batch4 = [
  ['11-move-notice', 'A move in force on its board, Silver', NOTICE_DESK],
  ['12-reveal', 'The season’s reveal, Silver', REVEAL_DESK],
  ['13-tally', 'A settlement’s tally, Silver', TALLY_DESK],
  ['14-staff', 'The Director’s profile, Silver', STAFF_DESK],
];
for (const [file, title, content] of batch4) {
  for (const mode of ['light', 'dark']) {
    fs.writeFileSync(path.join(here, `${file}${mode === 'dark' ? '-dark' : ''}.html`), page({ title: `${title} ${mode}`, mode, width: 1440, height: 1000, body: desk(content),
      comment: `A board of the board look design session (docs/plans/2026-11-06-board-look-design.md), batch 4, 1440 by 1000, written by gen.mjs.` }));
  }
}
fs.writeFileSync(path.join(here, '15-phone.html'), page({
  title: 'The staff on the board on the phone, Silver', mode: 'light', width: 4 * 390 + 3 * 24, height: 844,
  comment: 'A board of the board look design session, batch 4: four phone screens at 390 by 844 (the move notice, the reveal and the Director’s profile in light; the reveal in dark), 24px apart. Written by gen.mjs.',
  body: `<style>${PHONE_CSS_DARK}</style><div style="display:flex;gap:24px">${phoneScreen(NOTICE_PHONE, 'light')}${phoneScreen(REVEAL_PHONE, 'light')}${phoneScreen(STAFF_PHONE, 'light')}${phoneScreen(REVEAL_PHONE, 'dark')}</div>`,
}));
console.log('wrote the batch 4 boards');

/* ================= batch 5: the errors (engine/ui/frame/Unavailable.tsx), their words as built ================= */
/* Not found speaks as a 2003 board's Information box did, naming what was asked for (the owner: the copy should be "more 'classic forum
   404' as well to align with the appearance"). It never says a thing was removed: nothing on the board is (Append-only). */
const MISSING = { t: 'The thread you requested does not exist.', b: 'The board you requested does not exist.', c: 'The character you requested does not exist.' };
const NOTFOUND = (addr) => `
  <table class="t info"><caption class="vh">Information</caption>
    <thead><tr><td class="bar">Information</td></tr></thead>
    <tbody>
      <tr><td class="msg"><h1 class="missing">${MISSING[addr.split('/')[1]] ?? 'There is no page at this address.'}</h1>
        <p>If you followed a link here, it may be mistyped or out of date.</p>
        <p><a href="#">Click here to return to the index</a></p></td></tr>
      <tr><td class="addr">Address: ${addr}</td></tr>
    </tbody></table>`;
const CANNOT = (addr) => `
  <div class="ie" role="group" aria-labelledby="ie-h"><div class="glyph" aria-hidden="true"></div><div>
    <h1 id="ie-h">The page cannot be displayed</h1>
    <p>The page you are looking for is currently unavailable. Divided World did not answer in time, or the connection dropped on the way.</p>
    <p>Please try the following:</p>
    <ul><li>Click <button type="button">Try again</button>, or try again in a moment.</li><li>Check that your connection is working.</li><li>Go <a href="#">back to the index</a>.</li><li>Click your browser’s Back button to return to the page you were on.</li></ul>
    <p class="foot2">Cannot load ${addr}</p></div></div>`;
for (const [file, title, content] of [['16-not-found', 'Information: not found, Silver', NOTFOUND('/t/00000000-0000-4000-8000-00000000dead')], ['17-cannot-display', 'The page cannot be displayed, Silver', CANNOT('dw.gripe/t/3f2a9c1e')]]) {
  for (const mode of ['light', 'dark']) {
    fs.writeFileSync(path.join(here, `${file}${mode === 'dark' ? '-dark' : ''}.html`), page({ title: `${title} ${mode}`, mode, width: 1440, height: 1000, body: desk(content),
      comment: `A board of the board look design session (docs/plans/2026-11-06-board-look-design.md), batch 5, 1440 by 1000, written by gen.mjs.` }));
  }
}
fs.writeFileSync(path.join(here, '18-phone.html'), page({
  title: 'The errors on the phone, Silver', mode: 'light', width: 4 * 390 + 3 * 24, height: 844,
  comment: 'A board of the board look design session, batch 5: four phone screens at 390 by 844, not found and cannot be displayed in light, then in dark, 24px apart. Written by gen.mjs.',
  body: `<style>${PHONE_CSS_DARK}</style><div style="display:flex;gap:24px">${phoneScreen(NOTFOUND('/c/nobody'), 'light')}${phoneScreen(CANNOT('dw.gripe/t/3f2a9c1e'), 'light')}${phoneScreen(NOTFOUND('/c/nobody'), 'dark')}${phoneScreen(CANNOT('dw.gripe/t/3f2a9c1e'), 'dark')}</div>`,
}));
console.log('wrote the batch 5 boards');
