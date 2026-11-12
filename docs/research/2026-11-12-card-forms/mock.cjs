/**
 * A mock for the owner, 2026-11-12: Laugh Track's settings in the play form, as it is today (left) and in the glass's own look (right).
 *
 *   node docs/research/2026-11-12-card-forms/mock.cjs
 *
 * It writes 01-laugh-track-form.html beside itself and a picture of it. The page links the engine's own stylesheets and reads the
 * instance's glass.json, so the fields, the choice and the buttons are the play form's; only the .mk- rules are new.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const here = __dirname;
const root = path.resolve(here, '../../..');
const glass = JSON.parse(fs.readFileSync(path.join(root, 'instances/divided-world/ui/glass.json'), 'utf8')).keys.standard;
const tokens = Object.entries(glass).map(([k, v]) => `  ${k}: ${v.value};`).join('\n');
const post = 'For over two decades, the fan game community has been one of the most creative and resilient corners of gaming culture, with no franchise inspiring quite as much passion as Nintendo’s flagship mascot, Mario. Long before official tools like Super Mario Maker allowed players to construct and share their own levels on home consoles, dedicated enthusiasts were reverse-engineering classic titles, building custom engines from scratch, and distributing their creations across early internet forums.';
const CUES = [['fan game', 'Boo', 'Cues 2 places in this post'], ['forums', 'Laugh', 'Cues 1 place in this post'], ['Mario', 'Cheer', 'Cues 11 places in this post']];

const button = (kind, words) => `<button type="button" class="kb-glass-button kb-glass-skew" data-kb-kind="${kind}" data-kb-size="s"><span class="kb-glass-upright">${words}</span></button>`;
const row = (n, phrase, sound, hint) => `
  <div class="mk-cue">
    <div class="mk-cue-head"><label class="kb-play-label" for="p${n}">Cue ${n}</label>${button('quiet', 'Remove')}</div>
    <input id="p${n}" class="kb-play-input" type="text" value="${phrase}">
    <div class="kb-play-choice-row mk-sounds" role="radiogroup" aria-label="Sound for cue ${n}">
      ${['Laugh', 'Cheer', 'Boo'].map((s) => `<label class="kb-play-choice-opt"><input type="radio" class="kb-visually-hidden" name="s${n}" ${s === sound ? 'checked' : ''}><span>${s}</span></label>`).join('')}
    </div>
    <p class="kb-play-fine">${hint}</p>
  </div>`;
const old = CUES.map(([p, s, h], i) => `<div><div class="f"><label>Phrase</label><input type="text" value="${p}"><label>Sound</label><select><option>${s}</option></select><button type="button">Remove</button></div><p>${h}</p>${i === 0 ? '<p>A face-down Laugh Track waits for this phrase</p>' : ''}</div>`).join('');
const font = (weight, file) => `@font-face { font-family: "Barlow Condensed"; font-weight: ${weight}; src: url("../../../instances/divided-world/ui/fonts/BarlowCondensed-${file}.woff2"); }`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Card forms mock</title>
<link rel="stylesheet" href="../../../engine/ui/glass/tokens.css">
<link rel="stylesheet" href="../../../engine/ui/glass/base.css">
<link rel="stylesheet" href="../../../engine/ui/glass/parts.css">
<link rel="stylesheet" href="../../../engine/ui/cards/play.css">
<style>
${font(500, 'Medium')}
${font(600, 'SemiBold')}
${font(700, 'Bold')}
${font(800, 'ExtraBold')}
@font-face { font-family: "Anton"; src: url("../../../instances/divided-world/ui/fonts/Anton-Regular.woff2"); }
:root {
${tokens}
}
body { margin: 0; padding: 32px; background: var(--kb-glass-ground); display: flex; gap: 48px; align-items: flex-start; font-family: var(--kb-glass-font-body); }
.col { width: 420px; }
.col > h2 { margin: 0 0 6px; font: 400 26px var(--kb-glass-font-display); letter-spacing: .5px; text-transform: uppercase; color: var(--kb-glass-text-2); }
.sheet { box-sizing: border-box; padding: 28px; background: var(--kb-glass-sheet); border: 1px solid color-mix(in srgb, var(--kb-glass-neon) 40%, transparent); }
.kb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.kb-play { margin-top: 0; }
/* Today: the rules of instances/divided-world/ui/laugh-track/laugh-track.css, with the board font it names. */
.old { display: grid; gap: .5rem; border: 0; margin: 0; padding: 0; font-family: Verdana, sans-serif; }
.old legend { padding: 0; margin-bottom: .25rem; font: inherit; letter-spacing: 0; text-transform: none; font-weight: 600; }
.old blockquote { border: 1px solid #888; margin: 0; padding: .3em 2%; white-space: pre-wrap; max-height: 12rem; overflow: auto; }
.old .f { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
.old .f input { flex: 1 1 10rem; min-width: 0; }
/* Proposed: what the kit adds to the play form's own pieces. */
.mk-form { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.mk-cue { display: flex; flex-direction: column; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--kb-glass-text-hi) 22%, transparent); }
.mk-cue-head { display: flex; align-items: center; justify-content: space-between; min-height: 36px; }
.mk-cue .kb-play-input { margin-top: 4px; }
.mk-sounds { margin-top: 8px; }
.mk-cue .kb-play-fine { margin-top: 6px; }
.mk-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mk-post { max-height: calc(5 * 1.4em + 20px); }
</style></head><body>
<div class="col"><h2>Today</h2><div class="sheet"><div class="kb-play"><fieldset class="old">
  <legend>Your audience&apos;s cues</legend>
  <blockquote>${post}</blockquote>
  ${old}
  <button type="button" style="justify-self:start">Add a cue</button>
  <p>14 places in all (at most 30)</p>
</fieldset></div></div></div>
<div class="col"><h2>Proposed</h2><div class="sheet"><div class="kb-play"><fieldset class="mk-form">
  <div><legend class="kb-play-label">Your audience&apos;s cues</legend>
  <p class="kb-play-fine">Select words in the post below with a pointer or by touch, or type them. A selection fills the first empty cue.</p>
  <div class="kb-play-post-frame kb-glass-cut-panel"><div class="kb-play-post mk-post" tabindex="0">${post}</div></div></div>
  ${row(1, 'fan game', 'Boo', 'Cues 2 places in this post. A face-down Laugh Track waits for this phrase.')}
  ${row(2, 'forums', 'Laugh', 'Cues 1 place in this post')}
  ${row(3, 'Mario', 'Cheer', 'Cues 11 places in this post')}
  ${row(4, '', 'Laugh', 'At least 4 letters or digits, matched as whole words in any case')}
  <div class="mk-foot">${button('secondary', 'Add a cue')}<p class="kb-play-fine" role="status">14 places in all (at most 30)</p></div>
</fieldset></div></div></div>
</body></html>
`;

const out = path.join(here, '01-laugh-track-form.html');
fs.writeFileSync(out, html);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`file://${out}`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(here, '01-laugh-track-form.png'), fullPage: true });
  await b.close();
})();
