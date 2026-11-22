/**
 * The commentary video's title card (docs/plans/2026-11-21-commentary-video-revision-design.md; the owner: "a really cool title card with an 'invite only' ... it should align
 * exactly with the final sting of the mountain king track. Big sting, final note, title card with the divided world logo coin + courier new at the exact moment of the
 * orchestra hitting that final beat"). One take, `c-title`, 6.5 s, 1920 x 1080 at 60 fps. Frame 0 IS the hit: the card is fully there on frame 0 (an impact, not a fade-in), then
 * lives for the chord's decay, and the edit's fade to black is made here over the take's last 0.8 s. It is the film's one earnest image: the coin, the name, INVITE ONLY, and nothing else.
 *
 *   node tools/hype/shot-commentary-end.mjs [--stand-in] [--stills 0,0.05,1]
 *
 * Writes .runs/hype/c-title.mp4 and c-title.json ({ landed: [{ what: 'strike', frame: 0 }, { what: 'fade', frame: 342 }], font }). `--stills` writes jpegs of the card at those card
 * times to .runs/hype/stills/, to look at while the look is made, and films nothing.
 *
 * The face is Courier New bold, the board's own (instances/divided-world/ui/theme.css `--kb-font-mono`; engine/ui/base.css sets the board's headings `bold ... var(--kb-font-mono)`).
 * Courier New is a system font and is not in every container. Without it the shot throws naming it; `--stand-in` films with a metric-compatible face found on the machine
 * (Liberation Mono, Cousine, Nimbus Mono PS), writes `"font": "<its name>"` into the take's json and says the take must be filmed again where Courier New is installed. Nothing is
 * ever burned into the picture about it.
 *
 * The page is the tool's own (a data: page), every frame a pure function of the card's time `t` (`window.__card(t, fade, frame)`), so the take is frame-exact however long a frame
 * takes to draw. The words are `TITLE` and `TITLE_TAG` of instances/divided-world/ui/hype/commentary.ts, imported, never retyped; the page's text is asserted to be exactly them.
 * The coin is instances/divided-world/ui/icon/coin.svg itself, drawn as a vector at 6 x its 64 unit box (so its seam, which sits on whole pixels at 32 units, sits on whole pixels here).
 *
 * The look is the glass's (PRODUCT.md, "Brand Commitments") with a hint of the seam: a near-black violet ground under the glass's own smoke (drawn as engine/ui/glass/field.ts draws
 * it, from instances/divided-world/ui/glass.json), the coin lit, the type in pale light with a restrained glow, and between the name and the tag a 1px rule of pale cyan with a cyan
 * glow, the game's own mark of where board meets glass. The hit: a flash and bloom that decay inside 0.4 s, a shake of a few pixels that is gone by 0.3 s, the coin arriving
 * over scale and settling. After it: a very slow push-in, the smoke drifting, one soft sweep of light across the coin.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCamera, openFilm } from './camera.mjs';
import { OUT, flag } from './stage.mjs';

const { TITLE, TITLE_TAG } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
const glass = JSON.parse(readFileSync('instances/divided-world/ui/glass.json', 'utf8'));
const coinSvg = readFileSync('instances/divided-world/ui/icon/coin.svg', 'utf8');
const FPS = 60;
const W = 1920, H = 1080;
const SECONDS = 6.5, FADE_SECONDS = 0.8;
const NAME = 'c-title';

/* The face. Courier New, or under --stand-in the first metric-compatible face the machine has. */
const wantStandIn = process.argv.includes('--stand-in');
const fcMatch = (pattern) => spawnSync('fc-match', ['-f', '%{family}', pattern], { encoding: 'utf8' }).stdout.split(',')[0].trim();
const FACE = (() => {
  if (fcMatch('Courier New:bold') === 'Courier New') return 'Courier New';
  if (!wantStandIn) throw new Error('the font "Courier New" is not installed on this machine: the title card is set in nothing else. Install it, or film with --stand-in (a metric-compatible face, to be filmed again where Courier New is installed)');
  const stand = ['Liberation Mono', 'Cousine', 'Nimbus Mono PS'].find((n) => fcMatch(`${n}:bold`) === n);
  if (!stand) throw new Error('the font "Courier New" is not installed and no metric-compatible stand-in (Liberation Mono, Cousine, Nimbus Mono PS) is either');
  return stand;
})();
const standIn = FACE !== 'Courier New';

const layers = glass.smoke.field.layers.slice(0, 2);
const colors = glass.smoke.recipes.page.colors.slice(0, 2);
const ground = glass.keys.standard['--kb-glass-ground'].value;
const pale = glass.keys.standard['--kb-glass-pale'].value;
const coinUrl = `data:image/svg+xml;base64,${Buffer.from(coinSvg).toString('base64')}`;

/* The layout, in page pixels. The coin is 6 x 64 so its whole-pixel seam stays on whole pixels. */
const COIN = 384, TITLE_SIZE = 132, TAG_SIZE = 52;
const COIN_Y = 340, TITLE_Y = 652, RULE_Y = 752, TAG_Y = 822;

const page = `<!doctype html><html><head><meta charset="utf-8"><title>title card</title>
<style>
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
#stage { position: absolute; inset: 0; overflow: hidden; background: ${ground}; }
#world { position: absolute; inset: 0; transform-origin: 50% 46%; }
.layer { position: absolute; left: -200px; top: -120px; width: 2320px; height: 1320px; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
#halo { position: absolute; left: 50%; top: ${COIN_Y}px; width: 1500px; height: 900px; transform: translate(-50%, -50%); background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(140,36,250,.34), rgba(74,24,154,.14) 45%, rgba(0,0,0,0) 100%); mix-blend-mode: screen; }
#coinwrap { position: absolute; left: 50%; top: ${COIN_Y}px; width: ${COIN}px; height: ${COIN}px; margin: -${COIN / 2}px 0 0 -${COIN / 2}px; }
#coin { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#sheen { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; mix-blend-mode: screen; pointer-events: none; }
#sheen i { position: absolute; top: -20%; bottom: -20%; width: 34%; left: 0; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(214,250,255,.55) 50%, rgba(255,255,255,0)); transform: skewX(-16deg); }
.line { position: absolute; left: 50%; margin: 0; white-space: nowrap; text-align: center; font-family: "${FACE}", monospace; font-weight: bold; line-height: 1; }
#title { top: ${TITLE_Y}px; font-size: ${TITLE_SIZE}px; letter-spacing: 0.07em; color: #f4efff; transform: translate(-50%, -50%); text-shadow: 0 0 var(--tg, 30px) rgba(140,36,250,var(--ta, .5)), 0 0 calc(var(--tg, 30px) * 2.6) rgba(25,227,255,calc(var(--ta, .5) * .4)); }
#tag { top: ${TAG_Y}px; font-size: ${TAG_SIZE}px; letter-spacing: 0.4em; color: ${pale}; transform: translate(-50%, -50%); text-shadow: 0 0 18px rgba(25,227,255,var(--ga, .4)); }
#rule { position: absolute; left: 50%; top: ${RULE_Y}px; width: 560px; height: 1px; margin-left: -280px; background: #c9f8ff; box-shadow: 0 0 6px 1px rgba(25,227,255,.8), 0 0 22px 3px rgba(25,227,255,.35); }
#flash { position: absolute; inset: 0; mix-blend-mode: screen; background: radial-gradient(ellipse 62% 66% at 50% ${((COIN_Y / H) * 100).toFixed(1)}%, rgba(255,255,255,.9), rgba(190,150,255,.5) 30%, rgba(60,20,120,0) 100%); }
#streak { position: absolute; left: 50%; top: ${COIN_Y}px; width: 1700px; height: 14px; margin: -7px 0 0 -850px; mix-blend-mode: screen; background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255,255,255,1), rgba(170,240,255,.8) 14%, rgba(25,227,255,.3) 50%, rgba(25,227,255,0) 100%); filter: blur(1px); }
#vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 76% 82% at 50% 48%, rgba(0,0,0,0) 42%, rgba(0,0,0,.5) 80%, rgba(0,0,0,.88) 100%); }
#grain { position: absolute; inset: -64px; background-repeat: repeat; mix-blend-mode: overlay; opacity: .17; }
#black { position: absolute; inset: 0; background: #000; opacity: 0; }
</style></head>
<body><div id="stage">
  <div id="world">
    <div class="layer" id="smoke0"></div><div class="layer" id="smoke1"></div>
    <div id="halo"></div><div id="flash"></div>
    <div id="coinwrap"><img id="coin" src="${coinUrl}" alt=""><div id="sheen"><i id="sheeni"></i></div></div>
    <div id="streak"></div>
    <h1 class="line" id="title"></h1>
    <div id="rule"></div>
    <p class="line" id="tag"></p>
  </div>
  <div id="vignette"></div><div id="grain"></div><div id="black"></div>
</div></body></html>`;

/** Runs in the page: builds the smoke, sets the words, checks the face, defines `window.__card(t, fade, frame)`. */
const SETUP = `(async () => {
  const TITLE = ${JSON.stringify(TITLE)}, TAG = ${JSON.stringify(TITLE_TAG)}, FACE = ${JSON.stringify(FACE)};
  const LAYERS = ${JSON.stringify(layers)}, COLORS = ${JSON.stringify(colors)};
  const $ = (id) => document.getElementById(id);
  $('title').textContent = TITLE; $('tag').textContent = TAG;
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
  await $('coin').decode();
  /* The face: the named face's width must differ from the generic serif's and sans-serif's, so a fallback cannot pass for it. */
  const probe = 'Wmiql 0123 DIVIDED WORLD INVITE ONLY';
  const width = (family) => { const e = document.createElement('span'); e.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:bold 72px ' + family; e.textContent = probe; document.body.append(e); const w = e.getBoundingClientRect().width; e.remove(); return w; };
  await document.fonts.load('bold 72px "' + FACE + '"', probe);
  const loaded = document.fonts.check('bold 72px "' + FACE + '"', probe) && width('"' + FACE + '", serif') !== width('serif') && width('"' + FACE + '", sans-serif') !== width('sans-serif');
  /* Grain: a tile of fine noise, drawn once. */
  const g = document.createElement('canvas'); g.width = g.height = 512; const gx = g.getContext('2d'), gd = gx.createImageData(512, 512);
  let s = 0x9e3779b9; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  for (let i = 0; i < gd.data.length; i += 4) { const v = 128 + Math.round(((rnd() + rnd() + rnd()) / 3 - 0.5) * 255); gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v; gd.data[i + 3] = 255; }
  gx.putImageData(gd, 0, 0);
  $('grain').style.backgroundImage = 'url(' + g.toDataURL('image/png') + ')';
  const hash = (n) => { let h = (n + 1) * 2654435761 >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return h >>> 0; };
  const clamp = (u) => Math.min(1, Math.max(0, u));
  const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
  /* One frame, a pure function of the card's time t (seconds from the hit). */
  window.__card = (t, fade, frame) => {
    const hit = Math.exp(-t / 0.11);                       // the flash: 1 on the hit frame, about 0.03 by 0.4 s
    const shakeEnv = Math.exp(-t / 0.075) * (1 - smooth((t - 0.2) / 0.1));
    const dx = 7 * shakeEnv * Math.cos(t * 118), dy = 5 * shakeEnv * Math.sin(t * 93 + 1);
    const push = 1 + 0.011 * t;                            // the slow push-in
    $('world').style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(' + push.toFixed(5) + ')';
    const k = 0.7 + 0.25 * hit;
    $('smoke0').style.opacity = (Number($('smoke0').dataset.opacity) * k * (0.94 + 0.06 * Math.sin(t * 0.5))).toFixed(4);
    $('smoke1').style.opacity = (Number($('smoke1').dataset.opacity) * k * (0.94 + 0.06 * Math.sin(t * 0.37 + 1.3))).toFixed(4);
    $('smoke0').style.transform = 'translate(' + (-24 * t).toFixed(2) + 'px,' + (6 * t + 10 * Math.sin(t * 0.4)).toFixed(2) + 'px) scale(' + (1.02 + 0.005 * t).toFixed(5) + ')';
    $('smoke1').style.transform = 'translate(' + (28 * t - 60).toFixed(2) + 'px,' + (-5 * t + 12 * Math.sin(t * 0.33 + 2)).toFixed(2) + 'px) scale(' + (1.03 + 0.004 * t).toFixed(5) + ')';
    $('halo').style.opacity = (0.85 + 0.45 * hit + 0.08 * Math.sin(t * 0.9)).toFixed(3);
    /* The coin lands with weight: over scale on the hit, settling. */
    $('coinwrap').style.transform = 'scale(' + (1 + 0.055 * Math.exp(-t / 0.13)).toFixed(5) + ')';
    $('coin').style.filter = 'drop-shadow(0 0 ' + (26 + 20 * hit).toFixed(1) + 'px rgba(140,36,250,' + (0.55 + 0.35 * hit).toFixed(3) + ')) drop-shadow(0 0 ' + (80 + 40 * hit).toFixed(1) + 'px rgba(25,227,255,' + (0.22 + 0.2 * hit).toFixed(3) + '))';
    /* One soft sweep of light across the coin, 1.3 s to 2.5 s. */
    const su = clamp((t - 1.3) / 1.2), sheen = $('sheeni');
    sheen.style.left = (-40 + 140 * smooth(su)).toFixed(2) + '%';
    sheen.style.opacity = (su > 0 && su < 1 ? Math.sin(Math.PI * su) : 0).toFixed(3);
    $('title').style.setProperty('--tg', (30 + 24 * hit).toFixed(1) + 'px');
    $('title').style.setProperty('--ta', (0.5 + 0.4 * hit).toFixed(3));
    $('tag').style.setProperty('--ga', (0.4 + 0.35 * hit).toFixed(3));
    $('rule').style.opacity = (0.8 + 0.2 * hit).toFixed(3);
    $('flash').style.opacity = hit.toFixed(4);
    /* The seam flares across the frame on the hit: the coin's cyan line, drawn long. */
    $('streak').style.opacity = (hit > 0.02 ? hit : 0).toFixed(4);
    $('streak').style.transform = 'scaleX(' + (0.75 + 0.3 * (1 - hit)).toFixed(3) + ') scaleY(' + (0.7 + 0.5 * hit).toFixed(3) + ')';
    const h = hash(frame ?? Math.round(t * 60));
    $('grain').style.transform = 'translate(' + (-(h % 64)) + 'px,' + (-((h >>> 8) % 64)) + 'px)';
    $('black').style.opacity = String(fade);
  };
  window.__card(0, 0, 0);
  window.__card(2, 0, 120);
  const box = (id) => { const r = $(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const boxes = { coin: box('coin'), title: box('title'), tag: box('tag') };   // at t = 2 s, after the coin has settled
  window.__card(0, 0, 0);
  return { loaded, text: { title: $('title').textContent, tag: $('tag').textContent }, boxes };
})()`;

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/stills`, { recursive: true });

/** Opens the card page and checks it: the words are TITLE and TITLE_TAG, the face is the face. */
async function openCard() {
  const cam = await openCamera({ url: `data:text/html;charset=utf-8,${encodeURIComponent(page)}`, css: { width: W, height: H }, scale: 1 });
  await cam.until(`Boolean(document.getElementById('title'))`, { label: 'the title card page drawn' });
  const info = await cam.evaluate(SETUP);
  if (!info.loaded) throw new Error(`the font "${FACE}" did not load: the title card is set in nothing else`);
  if (info.text.title !== TITLE) throw new Error(`the page's title is "${info.text.title}", not TITLE ("${TITLE}")`);
  if (info.text.tag !== TITLE_TAG) throw new Error(`the page's tag is "${info.text.tag}", not TITLE_TAG ("${TITLE_TAG}")`);
  console.log(`title card: ${TITLE} / ${TITLE_TAG}; face ${FACE} loaded`);
  if (standIn) console.log(`STAND-IN: filmed in ${FACE}, not Courier New; this take must be filmed again where Courier New is installed`);
  return { cam, info };
}

async function film() {
  const { cam, info } = await openCard();
  try {
    const out = openFilm({ path: `${OUT}/${NAME}.mp4`, fps: cam.fps, out: { width: W, height: H } });
    await cam.freeze();
    const count = Math.round(SECONDS * FPS), fadeFrames = Math.round(FADE_SECONDS * FPS);
    for (let f = 0; f < count; f++) {
      const dark = f >= count - fadeFrames ? (f - (count - fadeFrames) + 1) / fadeFrames : 0;
      await cam.evaluate(`window.__card(${(f / FPS).toFixed(5)}, ${dark.toFixed(5)}, ${f})`);
      await out.write(await cam.frame(true));
    }
    await out.end();
    writeFileSync(`${OUT}/${NAME}.json`, `${JSON.stringify({ landed: [{ what: 'strike', frame: 0 }, { what: 'fade', frame: count - fadeFrames }], ...(standIn ? { font: FACE } : {}) }, null, 2)}\n`);
    console.log(`${NAME}: ${count} frames, ${SECONDS} s; errors:`, cam.errors);
    measure(info.boxes);
  } finally {
    await cam.close();
  }
}

/** The card is there on frame 0: the mean luma inside the coin's, the name's and the tag's boxes on frame 0 is at least that of frame 60 (the flash may only add). */
function measure(boxes) {
  const luma = (n, b) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', `${OUT}/${NAME}.mp4`, '-vf', `select=eq(n\\,${n}),crop=${Math.round(b.w)}:${Math.round(b.h)}:${Math.round(b.x)}:${Math.round(b.y)},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /YAVG=([\d.]+)/.exec(r.stdout);
    if (!m) throw new Error(`could not measure frame ${n}: ${r.stderr}`);
    return Number(m[1]);
  };
  for (const [what, b] of Object.entries(boxes)) {
    const a = luma(0, b), c = luma(60, b);
    console.log(`frame 0 luma in the ${what} box: ${a.toFixed(1)}; frame 60: ${c.toFixed(1)}; ratio ${(a / c).toFixed(2)}`);
    if (a < 0.95 * c) throw new Error(`frame 0 is not at full strength in the ${what} box (${a.toFixed(1)} against ${c.toFixed(1)} on frame 60)`);
  }
}

async function stills(times) {
  const { cam } = await openCard();
  try {
    await cam.freeze();
    for (const t of times) {
      await cam.evaluate(`window.__card(${t}, 0, ${Math.round(t * FPS)})`);
      await cam.frame(true);
      writeFileSync(`${OUT}/stills/${NAME}-t${t}.jpg`, await cam.frame(true));
    }
  } finally {
    await cam.close();
  }
}

if (flag('stills', null) !== null) await stills(String(flag('stills')).split(',').map(Number));
else await film();
