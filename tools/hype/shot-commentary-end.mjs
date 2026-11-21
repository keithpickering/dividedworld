/**
 * The commentary video's end card (docs/plans/2026-11-21-commentary-video-plan.md, Task 7; the design, section 4, node 13): a page of the tool's
 * own, not the game's. A rainbow across the whole frame, slowly scrolling and cycling for obnoxiousness, and over it, centered, wrapped and as
 * large as fits with margins, in Comic Sans MS, black with a white outline, the sentence of `TITLE` and `TITLE_NOTE` (instances/divided-world/ui/hype/commentary.ts),
 * misspelled as it is meant to be.
 *
 *   node tools/hype/shot-commentary-end.mjs [--stand-in] [--port 4319]
 *
 * Writes .runs/hype/c-end.mp4: 12 s at 1920 x 1080, 60 frames a second (the card is the one take not filmed at double density: it is
 * the tool's own page, drawn at the size it is shown). If the font is not installed (`document.fonts.check('16px "Comic Sans MS"')` is false, or, since that answers true for any system family no @font-face names, the words measure the same as a fallback's) the shot throws naming the font; with
 * `--stand-in` it uses "Comic Neue", "Chalkboard SE" or the generic `cursive` family instead and stamps "FONT MISSING: Comic Sans MS" small in a corner,
 * so a film made without the font says so on its face. This file is run with plain `node`: Node 22.18 and later strips the types of the instance's
 * `commentary.ts` as it imports it, as edit-commentary.mjs does.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openCamera, openFilm } from './camera.mjs';
import { OUT, flag } from './stage.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { TITLE, TITLE_NOTE } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
const standIn = process.argv.includes('--stand-in');
const SECONDS = 12;
const FPS = 60;
const FONT = 'Comic Sans MS';
const STAND_IN = '"Comic Neue", "Chalkboard SE", cursive';

/** The page: a rainbow that fills the frame (a gradient three times the frame's width, so it can scroll and wrap), and the card. */
const page = `<!doctype html><html><head><meta charset="utf-8"><title>end card</title></head>
<body style="margin:0;width:100vw;height:100vh;overflow:hidden;background:#000">
<div id="bow" style="position:fixed;inset:0"></div>
<div id="card" style="position:fixed;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;padding:90px 120px;box-sizing:border-box">
  <div id="words" style="text-align:center;font-weight:bold;line-height:1.12;color:#000"></div>
</div>
<div id="stamp" style="position:fixed;left:14px;bottom:10px;font:14px monospace;color:#fff;background:#000;padding:2px 6px;display:none"></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });
const cam = await openCamera({ url: `data:text/html;charset=utf-8,${encodeURIComponent(page)}`, css: { width: 1920, height: 1080 }, scale: 1 });
try {
  await cam.until(`Boolean(document.getElementById('words'))`, { label: 'the end card page drawn' });
  /*
   * `document.fonts.check` answers true for any family no @font-face names (there is nothing to load), so it cannot tell an installed system font
   * from a missing one. It is asked, and so is a measure: the same words in the font with a fallback, and in the fallback alone, at two fallbacks;
   * a font that is not there is the fallback every time.
   */
  const has = await cam.evaluate(`(() => {
    if (!document.fonts.check('16px "${FONT}"')) return false;
    const width = (family) => { const e = document.createElement('span'); e.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:72px ' + family; e.textContent = 'Wmiql 0123 The quick brown fox'; document.body.append(e); const w = e.getBoundingClientRect().width; e.remove(); return w; };
    return ['monospace', 'serif', 'sans-serif'].some((fallback) => width('"${FONT}", ' + fallback) !== width(fallback));
  })()`);
  if (!has && !standIn) throw new Error(`the font "${FONT}" is not installed on this machine, and the end card is set in nothing else: install it, or run with --stand-in to film a card that says so`);
  await cam.evaluate(`(() => {
    const words = document.getElementById('words'), card = document.getElementById('card'), bow = document.getElementById('bow');
    words.style.fontFamily = ${JSON.stringify(has ? `"${FONT}"` : STAND_IN)};
    words.textContent = ${JSON.stringify(TITLE + " " + TITLE_NOTE)};
    /* Black words with a white outline all round: eight shadows, since a stroke would eat into the letters. */
    const o = (r) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([x, y]) => (x * r) + 'px ' + (y * r) + 'px 0 #fff').join(',');
    /* As large as fits inside the margins. */
    const room = { w: card.clientWidth - 240, h: card.clientHeight - 180 };
    let lo = 16, hi = 400;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      words.style.fontSize = mid + 'px'; words.style.width = room.w + 'px';
      if (words.scrollHeight <= room.h) lo = mid; else hi = mid;
    }
    words.style.fontSize = lo + 'px';
    words.style.textShadow = o(Math.max(3, lo / 22)) + ', 0 ' + (lo / 14) + 'px ' + (lo / 8) + 'px rgba(0,0,0,.5)';
    /* The rainbow: every color across the WHOLE frame. The bands are four spectrums wide (each as wide as the frame) on a tilted slab bigger than the frame, so they can slide forever and never show a seam or an edge. */
    const stops = ['#ff0000', '#ff8800', '#ffee00', '#22dd22', '#00ccff', '#2244ff', '#aa22ff', '#ff22aa'];
    const all = [0, 1, 2, 3].flatMap((k) => stops.map((c, i) => c + ' ' + (k * 25 + (i * 25) / stops.length).toFixed(3) + '%'));
    Object.assign(bow.style, { inset: 'auto', left: '-150vw', top: '-60vh', width: '400vw', height: '220vh', backgroundImage: 'linear-gradient(90deg,' + all.join(',') + ',' + stops[0] + ' 100%)', filter: 'saturate(1.5)' });
    window.__bow = (t) => {
      /* The stripes slide across the frame, tilted, and the whole thing cycles its hue a little: obnoxious on purpose. */
      const slide = (t * 160) % 1920;
      bow.style.transform = 'rotate(-12deg) translateX(' + slide + 'px)';
      bow.style.filter = 'saturate(1.5) hue-rotate(' + (t * 18) + 'deg)';
    };
    if (${!has}) { const s = document.getElementById('stamp'); s.textContent = 'FONT MISSING: Comic Sans MS'; s.style.display = 'block'; }
  })()`);
  const info = await cam.evaluate(`({ size: getComputedStyle(document.getElementById('words')).fontSize, lines: Math.round(document.getElementById('words').getBoundingClientRect().height / parseFloat(getComputedStyle(document.getElementById('words')).lineHeight)), fits: document.getElementById('words').getBoundingClientRect().height })`);
  console.log(`c-end: ${has ? FONT : `STAND-IN (${STAND_IN})`}; font size ${info.size}, ${info.lines} lines, ${Math.round(info.fits)}px tall`);
  const film = openFilm({ path: `${OUT}/c-end.mp4`, fps: cam.fps, out: { width: 1920, height: 1080 } });
  await cam.freeze();
  for (let f = 0; f < SECONDS * FPS; f++) {
    await cam.evaluate(`window.__bow(${f / FPS})`);
    await film.write(await cam.frame(true));
  }
  await film.end();
  writeFileSync(`${OUT}/c-end.json`, JSON.stringify({ landed: [], font: has ? FONT : 'stand-in' }, null, 2));
  console.log(`c-end: ${SECONDS * FPS} frames; errors:`, cam.errors);
} finally {
  await cam.close();
}
