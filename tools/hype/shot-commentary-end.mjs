/**
 * The commentary video's title (docs/plans/2026-11-21-commentary-video-revision-design.md, section 10; the owner: "take advantage of the final 2 strikes of the mountain
 * king ... to show 'DIVIDED WROLD' on strike 1 and then the nonsense in the parentheses immediately afterwards on strike 2, in smaller text. Make the title card look
 * essentially cinematic in quality in spite of the inexplicable errors in the text itself."). Two takes, each beginning at its strike (frame 0 is the hit):
 *
 *   c-title-1   4.5 s: black, and on frame 0 the title is THERE at full strength (a strike, not a fade-in); then it lives: a very slow push-in, the smoke moving behind it.
 *   c-title-2   6.0 s: the same card continuing, from the state c-title-1 is in at 3.4 s, so the cut between them is seamless (the same smoke and the same push, offset by 3.4 s);
 *               on frame 0 the parenthetical appears beneath the title, smaller, at full strength; it holds, still pushing in; the edit's fade to black is made here,
 *               over the take's last 0.8 s.
 *
 *   node tools/hype/shot-commentary-end.mjs [--only c-title-1|c-title-2] [--seam] [--stills 0,0.25,1 [--note]]
 *
 * Writes .runs/hype/<take>.mp4 (1920 x 1080, 60 fps) and <take>.json ({ landed, move: null, strike: 0, seamAt: 3.4 }). `--seam` also writes .runs/hype/stills/c-title-seam-{a,b}.png,
 * the last frame the edit uses of c-title-1 (card time 3.4 s less a frame) beside c-title-2's frame 0.
 *
 * The page is the tool's own (written here as a data: page, since it needs no route of the game's), and every frame of it is a pure function of the card's time `t`
 * (`window.__card(t, fade)`), set by the script from the frame's index: the take is frame-exact however long a frame takes to draw. The words are `TITLE` and
 * `TITLE_NOTE` of instances/divided-world/ui/hype/commentary.ts, imported (Node 22.18 and later strips the types as it imports), never retyped; the page's text is asserted to be
 * exactly them. The fonts are the game's own files (instances/divided-world/ui/fonts/: Anton for the title, Barlow Condensed for the note), which the camera answers for an
 * address of its own (`serve`, as the stage answers the sprite sheet's): the page asks for them as a page of the game does, and the shot throws naming a font that did not load.
 *
 * The look is the glass's (PRODUCT.md, "Brand Commitments"; the boards of docs/research/2026-10-29-two-worlds/): a near-black violet ground (`--kb-glass-ground`, #07050d) under the
 * glass's own smoke, drawn the way engine/ui/glass/field.ts draws it: feTurbulence fractal noise, a color matrix to alpha, a blur, rasterized once and used as a mask over a layer's
 * color. The first two layers of the instance's field (instances/divided-world/ui/glass.json: seeds 57 and 8, violet and cyan) are read from that file, with the page recipe's colors.
 * Gold and cyan are the accents. The drift is faster than the glass's (which would not be seen to move in ten seconds) and the clouds are drawn larger.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCamera, openFilm } from './camera.mjs';
import { OUT, flag } from './stage.mjs';

const { TITLE, TITLE_NOTE } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
const glass = JSON.parse(readFileSync('instances/divided-world/ui/glass.json', 'utf8'));
const FPS = 60;
const W = 1920, H = 1080;
/** The card's time at which the second strike lands, and so where c-title-2 begins on the card's clock. */
const SEAM = 3.4;
const TAKES = { 'c-title-1': { seconds: 4.5, from: 0, fade: false }, 'c-title-2': { seconds: 6, from: SEAM, fade: true } };
const FADE_SECONDS = 0.8;
const only = flag('only', null);
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);

/* The fonts, from the instance's own files, at addresses the camera answers. */
const FONTS = {
  anton: { file: 'instances/divided-world/ui/fonts/Anton-Regular.woff2', url: 'https://dw.gripe/hype/fonts/Anton-Regular.woff2', family: 'Anton', weight: 400 },
  barlow: { file: 'instances/divided-world/ui/fonts/BarlowCondensed-Medium.woff2', url: 'https://dw.gripe/hype/fonts/BarlowCondensed-Medium.woff2', family: 'Barlow Condensed', weight: 500 },
};
const serve = Object.fromEntries(Object.values(FONTS).map((f) => [f.url, { file: f.file, type: 'font/woff2' }]));

const layers = glass.smoke.field.layers.slice(0, 2);
const colors = glass.smoke.recipes.page.colors.slice(0, 2);
const ground = glass.keys.standard['--kb-glass-ground'].value;
const gold = glass.keys.standard['--kb-glass-ready'].value;
const cyan = glass.keys.standard['--kb-glass-neon'].value;
const pale = glass.keys.standard['--kb-glass-pale'].value;

const page = `<!doctype html><html><head><meta charset="utf-8"><title>title card</title>
<style>
${Object.values(FONTS).map((f) => `@font-face { font-family: "${f.family}"; src: url("${f.url}") format("woff2"); font-weight: ${f.weight}; font-style: normal; font-display: block; }`).join('\n')}
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
#stage { position: absolute; inset: 0; overflow: hidden; background: ${ground}; }
.layer { position: absolute; left: -200px; top: -120px; width: 2320px; height: 1320px; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; will-change: transform; }
#calm { position: absolute; inset: 0; background: radial-gradient(ellipse 46% 40% at 50% 49%, rgba(7,5,13,.62), rgba(7,5,13,0) 100%); }
#bloom { position: absolute; inset: 0; background: radial-gradient(ellipse 42% 30% at 50% 47%, rgba(140,36,250,.32), rgba(20,217,255,.07) 55%, rgba(0,0,0,0) 100%); mix-blend-mode: screen; }
#card { position: absolute; inset: 0; transform-origin: 50% 47%; }
.title, .note { position: absolute; left: 50%; white-space: nowrap; margin: 0; transform: translate(-50%, -50%); text-align: center; }
.title { font-family: "Anton", sans-serif; font-weight: 400; line-height: 1; letter-spacing: 0.13em; padding-left: 0.13em; color: transparent; }
.title > span { display: block; position: relative; }
/* The face: a pale vertical gradient, clipped to the letters. Its glow and its highlight are the same words drawn behind and over it from the attribute, so the element's text is the title once. */
.title .face { background: linear-gradient(180deg, #fbf9ff 0%, #e2d9fb 46%, #a898e2 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.title .face::before, .title .face::after { content: attr(data-text); position: absolute; left: 0; top: 0; right: 0; pointer-events: none; }
.title .face::before { z-index: -1; color: transparent; background: none; text-shadow: 0 0 var(--glowR, 40px) rgba(140,36,250,var(--glow, .6)), 0 0 calc(var(--glowR, 40px) * 2.4) rgba(20,217,255,calc(var(--glow, .6) * .55)); }
.title .face::after { background: linear-gradient(100deg, rgba(255,255,255,0) calc(var(--sweep, -40%) - 18%), rgba(214,250,255,var(--sweepA, 0)) var(--sweep, -40%), rgba(255,255,255,0) calc(var(--sweep, -40%) + 18%)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.note { font-family: "Barlow Condensed", sans-serif; font-weight: 500; color: ${pale}; letter-spacing: 0.13em; padding-left: 0.13em; line-height: 1; text-shadow: 0 0 22px rgba(20,217,255,.38), 0 0 2px rgba(7,5,13,.9); }
.note > span { display: block; position: relative; }
.note > span::after { content: attr(data-text); position: absolute; left: 0; top: 0; right: 0; background: linear-gradient(100deg, rgba(255,255,255,0) calc(var(--nsweep, -40%) - 16%), rgba(255,255,255,var(--nsweepA, 0)) var(--nsweep, -40%), rgba(255,255,255,0) calc(var(--nsweep, -40%) + 16%)); -webkit-background-clip: text; background-clip: text; color: transparent; text-shadow: none; pointer-events: none; }
.rule { position: absolute; left: 50%; height: 2px; transform: translate(-50%, -50%); background: linear-gradient(90deg, rgba(232,194,90,0), ${gold} 22%, ${gold} 78%, rgba(232,194,90,0)); box-shadow: 0 0 12px rgba(255,217,61,.35); }
.streak { position: absolute; left: 50%; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none; mix-blend-mode: screen; }
#vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 78% 82% at 50% 49%, rgba(0,0,0,0) 38%, rgba(0,0,0,.52) 78%, rgba(0,0,0,.9) 100%); }
#grain { position: absolute; inset: -64px; background-repeat: repeat; mix-blend-mode: overlay; opacity: .2; }
#black { position: absolute; inset: 0; background: #000; opacity: 0; }
</style></head>
<body><div id="stage">
  <div class="layer" id="smoke0"></div>
  <div class="layer" id="smoke1"></div>
  <div id="calm"></div><div id="bloom"></div>
  <div id="card">
    <h1 class="title" id="title"><span class="face" id="face"></span></h1>
    <div class="streak" id="streak"></div>
    <div class="rule" id="rule"></div>
    <div class="streak" id="nstreak"></div>
    <p class="note" id="note"><span id="notetext"></span></p>
  </div>
  <div id="vignette"></div><div id="grain"></div><div id="black"></div>
</div></body></html>`;

/** Runs in the page once its fonts are in: builds the smoke, sets the type, and defines `window.__card(t, fade, frame)`. */
const SETUP = `(async () => {
  const TITLE = ${JSON.stringify(TITLE)}, NOTE = ${JSON.stringify(TITLE_NOTE)};
  const LAYERS = ${JSON.stringify(layers)}, COLORS = ${JSON.stringify(colors)};
  const $ = (id) => document.getElementById(id);
  const H = ${H}, W = ${W};
  /* The words, once each; the highlight and the glow read them from an attribute. */
  $('face').textContent = TITLE; $('face').dataset.text = TITLE; $('notetext').textContent = NOTE; $('notetext').dataset.text = NOTE;
  /* The smoke, as field.ts draws it: the layer's noise, turned to white with its alpha row, blurred; a mask over the layer's color. The clouds are drawn ZOOM times larger than the glass's. */
  const ZOOM = 1.2, PX = { w: 2320, h: 1320 };
  const rasterize = async (layer) => {
    const m = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, ...layer.alpha].join(' ');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + PX.w + '" height="' + PX.h + '" viewBox="0 0 ' + (PX.w / ZOOM) + ' ' + (PX.h / ZOOM) + '">'
      + '<filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="' + layer.frequency.join(' ') + '" numOctaves="' + layer.octaves + '" seed="' + layer.seed + '"/>'
      + '<feColorMatrix type="matrix" values="' + m + '"/><feGaussianBlur stdDeviation="' + layer.blur + '"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>';
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = PX.w; c.height = PX.h; c.getContext('2d').drawImage(img, 0, 0, PX.w, PX.h);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    URL.revokeObjectURL(url);
    return URL.createObjectURL(png);
  };
  for (let i = 0; i < 2; i++) {
    const el = $('smoke' + i), url = await rasterize(LAYERS[i]);
    el.style.webkitMaskImage = el.style.maskImage = 'url(' + url + ')';
    el.style.backgroundColor = COLORS[i].color;
    el.dataset.opacity = COLORS[i].opacity;
  }
  /* Fonts: loaded, and shown to be the faces and not a fallback. */
  const fonts = ${JSON.stringify(Object.values(FONTS).map((f) => ({ family: f.family, weight: f.weight })))};
  const probe = 'Wmiql 0123 The quick brown fox DIVIDED WROLD';
  const width = (family, weight) => { const e = document.createElement('span'); e.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + weight + ' 72px ' + family; e.textContent = probe; document.body.append(e); const w = e.getBoundingClientRect().width; e.remove(); return w; };
  const loaded = {};
  for (const f of fonts) {
    await document.fonts.load(f.weight + ' 72px "' + f.family + '"', probe);
    const spec = f.weight + ' 72px "' + f.family + '"';
    loaded[f.family] = document.fonts.check(spec, probe) && ['monospace', 'serif', 'sans-serif'].every((fb) => width('"' + f.family + '", ' + fb, f.weight) !== width(fb, f.weight));
  }
  /* The type: the title as wide as its card allows, the note a size that sits under it as a tagline does. */
  const title = $('title'), note = $('note');
  const TITLE_W = 1400;
  title.style.fontSize = '100px'; const w100 = title.getBoundingClientRect().width;
  const size = 100 * TITLE_W / w100;
  title.style.fontSize = size.toFixed(2) + 'px';
  note.style.fontSize = '31px';
  const CY = 0.452 * H;                       // the title's centre
  const tH = title.getBoundingClientRect().height;
  title.style.top = CY + 'px';
  /* Anton's caps stand high in its line box; the box is centred, the caps are then nudged to the card's optical centre. */
  title.style.transform = 'translate(-50%, -50%) translateY(' + (size * 0.045).toFixed(1) + 'px)';
  const ruleY = CY + size * 0.5 + 34, noteY = ruleY + 46;
  const rule = $('rule'); rule.style.top = ruleY + 'px'; rule.style.width = '440px';
  note.style.top = noteY + 'px';
  const st = $('streak'), ns = $('nstreak');
  Object.assign(st.style, { top: (CY + size * 0.045) + 'px', height: '16px', width: '1700px', background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255,255,255,1), rgba(170,240,255,.85) 16%, rgba(20,217,255,.34) 52%, rgba(20,217,255,0) 100%)', filter: 'blur(1.5px)' });
  Object.assign(ns.style, { top: ruleY + 'px', height: '8px', width: '1500px', background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255,255,255,.9), rgba(150,235,255,.6) 20%, rgba(20,217,255,.22) 55%, rgba(20,217,255,0) 100%)', filter: 'blur(1px)' });
  /* A grain tile, drawn once (fine, unbiased noise); the grain moves by a different offset every frame. */
  const g = document.createElement('canvas'); g.width = g.height = 512; const gx = g.getContext('2d'), gd = gx.createImageData(512, 512);
  let s = 0x9e3779b9; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  for (let i = 0; i < gd.data.length; i += 4) { const v = 128 + Math.round(((rnd() + rnd() + rnd()) / 3 - 0.5) * 255); gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v; gd.data[i + 3] = 255; }
  gx.putImageData(gd, 0, 0);
  $('grain').style.backgroundImage = 'url(' + g.toDataURL('image/png') + ')';
  const hash = (n) => { let h = (n + 1) * 2654435761 >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return h >>> 0; };
  const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
  const SEAM = ${SEAM};
  /* One frame, a pure function of the card's time t (seconds from the first strike): where the smoke is, how far the card has pushed in, what the strikes have left. */
  window.__card = (t, fade, frame, withNote) => {
    const flash = (since, k) => (since < 0 ? 0 : Math.exp(-since / k));
    const f1 = flash(t, 0.13), f2 = withNote ? flash(t - SEAM, 0.1) : 0;
    const s0 = $('smoke0'), s1 = $('smoke1');
    const k = 0.62 + 0.28 * f1 + 0.12 * f2;
    s0.style.opacity = (Number(s0.dataset.opacity) * k * (0.94 + 0.06 * Math.sin(t * 0.5))).toFixed(4);
    s1.style.opacity = (Number(s1.dataset.opacity) * k * (0.94 + 0.06 * Math.sin(t * 0.37 + 1.3))).toFixed(4);
    const sc = 1.02 + 0.006 * t;
    s0.style.transform = 'translate(' + (-26 * t).toFixed(2) + 'px,' + (7 * t + 10 * Math.sin(t * 0.4)).toFixed(2) + 'px) scale(' + sc.toFixed(5) + ')';
    s1.style.transform = 'translate(' + (30 * t - 60).toFixed(2) + 'px,' + (-5 * t + 12 * Math.sin(t * 0.33 + 2)).toFixed(2) + 'px) scale(' + (1.03 + 0.004 * t).toFixed(5) + ')';
    $('card').style.transform = 'scale(' + (1 + 0.0072 * t).toFixed(5) + ')';
    $('bloom').style.opacity = (0.8 + 0.5 * f1 + 0.2 * f2).toFixed(3);
    /* Strike 1: the title is there at full strength on its first frame; a streak and a sweep and a flare of glow decay over the first half second. */
    const face = $('face');
    face.style.setProperty('--glow', (0.36 + 0.6 * f1 + 0.1 * f2).toFixed(3));
    face.style.setProperty('--glowR', (36 + 26 * f1).toFixed(1) + 'px');
    const u = Math.min(1, t / 0.55);
    face.style.setProperty('--sweep', (6 + 104 * ease(u)).toFixed(2) + '%');
    face.style.setProperty('--sweepA', (t < 0.55 ? 0.95 * (1 - ease(u) * 0.6) * (1 - u * u) : 0).toFixed(3));
    const st = $('streak');
    st.style.opacity = (f1 > 0.012 ? f1 : 0).toFixed(3);
    st.style.transform = 'translate(-50%, -50%) scaleX(' + (0.92 + 0.28 * (1 - f1)).toFixed(3) + ') scaleY(' + (0.8 + 0.6 * f1).toFixed(3) + ')';
    /* Strike 2: the note comes in at full strength on the card's SEAM second, with a smaller streak and sweep of its own. */
    const showNote = withNote && t >= SEAM - 1e-9;
    $('note').style.visibility = showNote ? 'visible' : 'hidden';
    $('rule').style.opacity = '1'; $('rule').style.boxShadow = '0 0 ' + (12 + 18 * f2).toFixed(1) + 'px rgba(255,217,61,' + (0.35 + 0.5 * f2).toFixed(3) + ')';
    const n = Math.min(1, Math.max(0, (t - SEAM) / 0.5));
    $('note').style.setProperty('--nsweep', (-10 + 125 * ease(n)).toFixed(2) + '%');
    $('note').style.setProperty('--nsweepA', (showNote && t - SEAM < 0.5 ? 0.9 * (1 - n * n) : 0).toFixed(3));
    $('note').style.textShadow = '0 0 ' + (22 + 14 * f2).toFixed(1) + 'px rgba(20,217,255,' + (0.38 + 0.4 * f2).toFixed(3) + '), 0 0 2px rgba(7,5,13,.9)';
    const ns = $('nstreak');
    ns.style.opacity = (showNote && f2 > 0.012 ? f2 : 0).toFixed(3);
    ns.style.transform = 'translate(-50%, -50%) scaleX(' + (0.9 + 0.25 * (1 - f2)).toFixed(3) + ')';
    /* The grain is a different frame of noise every frame. */
    const h = hash(frame ?? Math.round(t * 60));
    $('grain').style.transform = 'translate(' + (-(h % 64)) + 'px,' + (-((h >>> 8) % 64)) + 'px)';
    $('black').style.opacity = String(fade);
  };
  window.__card(0, 0, 0, false);
  return { loaded, text: { title: $('face').textContent, note: $('notetext').textContent }, size };
})()`;

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/stills`, { recursive: true });

/** Opens the card page and checks it: its words are the title's and the note's, its fonts are the faces. */
async function openCard() {
  const cam = await openCamera({ url: `data:text/html;charset=utf-8,${encodeURIComponent(page)}`, css: { width: W, height: H }, scale: 1, serve });
  await cam.until(`Boolean(document.getElementById('face'))`, { label: 'the title card page drawn' });
  const info = await cam.evaluate(SETUP);
  for (const f of Object.values(FONTS)) if (!info.loaded[f.family]) throw new Error(`the font "${f.family}" did not load from ${f.file}: the title card is set in nothing else`);
  if (info.text.title !== TITLE) throw new Error(`the page's title is "${info.text.title}", not TITLE ("${TITLE}")`);
  if (info.text.note !== TITLE_NOTE) throw new Error(`the page's note is "${info.text.note}", not TITLE_NOTE ("${TITLE_NOTE}")`);
  const read = await cam.evaluate(`({ title: document.getElementById('title').textContent, note: document.getElementById('note').textContent })`);
  if (read.title !== TITLE || read.note !== TITLE_NOTE) throw new Error(`the card's text is "${read.title}" and "${read.note}": it must be TITLE and TITLE_NOTE exactly`);
  console.log(`title card: ${TITLE} / ${TITLE_NOTE}; fonts ${Object.values(FONTS).map((f) => f.family).join(', ')} loaded; title ${info.size.toFixed(1)}px`);
  return cam;
}

async function film(name) {
  const { seconds, from, fade } = TAKES[name];
  const cam = await openCard();
  try {
    const out = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out: { width: W, height: H } });
    await cam.freeze();
    const count = Math.round(seconds * FPS), fadeFrames = Math.round(FADE_SECONDS * FPS);
    for (let f = 0; f < count; f++) {
      /* The edit's fade is this take's last 0.8 s, from nothing to black on its last frame. */
      const dark = fade && f >= count - fadeFrames ? (f - (count - fadeFrames) + 1) / fadeFrames : 0;
      await cam.evaluate(`window.__card(${(from + f / FPS).toFixed(5)}, ${dark.toFixed(5)}, ${Math.round(from * FPS) + f}, ${name === 'c-title-2'})`);
      await out.write(await cam.frame(true));
    }
    await out.end();
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed: [{ what: 'strike', frame: 0 }, ...(name === 'c-title-2' ? [{ what: 'fade', frame: count - fadeFrames }] : [])], move: null, strike: 0, seamAt: SEAM }, null, 2)}\n`);
    console.log(`${name}: ${count} frames, ${seconds} s; errors:`, cam.errors);
  } finally {
    await cam.close();
  }
}

/** The seam as a pair of stills: the last frame the edit uses of c-title-1 (card time 3.4 s less a frame) and c-title-2's first frame. */
async function seam() {
  const cam = await openCard();
  try {
    await cam.freeze();
    for (const [tag, t, frame] of [['a', SEAM - 1 / FPS, Math.round(SEAM * FPS) - 1], ['b', SEAM, Math.round(SEAM * FPS)]]) {
      await cam.evaluate(`window.__card(${Number(t).toFixed(5)}, 0, ${frame}, ${tag === 'b'})`);
      await cam.frame(true);
      const jpeg = await cam.frame(true);
      writeFileSync(`${OUT}/stills/c-title-seam-${tag}.jpg`, jpeg);
    }
  } finally {
    await cam.close();
  }
}

/** `--stills 0,0.25,1 [--note]`: stills of the card at those card times (the note's strike is in with --note), to look at while the look is made. */
async function stills(times, withNote) {
  const cam = await openCard();
  try {
    await cam.freeze();
    for (const t of times) {
      await cam.evaluate(`window.__card(${t}, 0, ${Math.round(t * FPS)}, ${withNote})`);
      await cam.frame(true);
      writeFileSync(`${OUT}/stills/c-title-t${t}${withNote ? 'n' : ''}.jpg`, await cam.frame(true));
    }
  } finally {
    await cam.close();
  }
}

if (flag('stills', null) !== null) await stills(String(flag('stills')).split(',').map(Number), process.argv.includes('--note'));
else if (process.argv.includes('--seam')) await seam();
else for (const name of Object.keys(TAKES)) if (only === null || only === name) await film(name);
