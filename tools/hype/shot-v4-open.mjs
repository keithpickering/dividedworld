/**
 * The commentary video's calm first half, the sixth cut (docs/plans/2026-11-21-commentary-video-revision-design.md, section 11): takes o-open,
 * o-op-close, o-kind, o-heel, o-heel-aura and o-rant. It has to look like a real person's narrated screen recording: one continuous-feeling pointer
 * (never a tween) that is the narrator's (`narrate`, in pointer.mjs), each take's pointer starting where the take before it ended (the edit joins them;
 * the end of each is kept in `.runs/hype/o-pointer.json`, as a fraction of the frame, and each take's json says where it started and ended). The Fan
 * Site skin, the desktop layout (1440 by 810) written at 2880 by 1620, except the close-up of the first post (960 by 540 at 3 times) and the close-up of
 * the Aura orbs (the desktop layout at 4 times, cropped).
 *
 *   node tools/hype/shot-v4-open.mjs [--only o-open] [--port 4321]
 *
 *   o-open       27 s. Post 1 at rest, a commentary node bobbing over it, silence for 4.5 s: the pointer drifts in, hovers near the node, hesitates, circles
 *                off, comes back, and clicks it at exactly 4.5 s (`node-click`; the node starts turning, and that click is what starts v01). Then v01's
 *                idle pointer: a slow drift across the sprite sheet at "putting all of our resources into this".
 *   o-op-close   16 s (v02). The same post, closer (960 by 540 at 3 times, the HUD out): the pointer points things out as he says them and, in the last
 *                1.5 s, travels down and leaves the bottom of the frame.
 *   o-kind       20 s (v03, v04). Chadluminum's post 2 with the pointer entering from the top, settling about 4 s, then a slow human scroll (small uneven
 *                notches of the wheel) down through the four kind posts, each through the middle of the frame with its effect drawn and its reactions
 *                visible, a hover on a positive reaction, arriving at Hotel Bro's post 7 as the take ends.
 *   o-heel       19 s (v05), as Hotel Bro. Post 7 with the HUD: the pointer near the class tag; five heat reactions a third of a second apart on "the crowd
 *                threw tomatoes at him"; the forecast and the orbs rise; a thumbs up lands on "politely" and the forecast falls (each read from
 *                `forecast()` and from the HUD's own text).
 *   o-heel-aura  4 s, as Hotel Bro. A close-up of the HUD's orbs and forecast while the five tomatoes land and it climbs (the owner's "close up on increasing aura bar").
 *   o-rant       6.5 s, as Hotel Bro (the video of angry typing). Half a second on the thumbs up, then the reply box: he types with real keys, in bursts, a typo
 *                put right with Backspace; it ends mid-word, never sent.
 *
 * Every wait is on the page's virtual clock or on a condition. Beside each take is `<take>.json`: `landed` (the frame of each beat), and the pointer's
 * `start` and `end` as fractions of the frame.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { idle, narrate, phraseTime, reach, rest, seeded } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { commentary } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
const only = flag('only', null);
const PORT = Number(flag('port', 4321));
const SKIN = 'fan-site';
const DESKTOP = { width: 1440, height: 810 };
const SCREEN = { x: 0, y: 0, w: 1440, h: 810 };
const SIDE = `${OUT}/o-pointer.json`;

/** A node's lines and the length of its clip: ffprobe on the voice file. */
function clipOf(id) {
  const lines = commentary.find((n) => n.id === id)?.lines;
  if (!lines) throw new Error(`no node ${id}`);
  const file = `${OUT}/voice/${id}.mp3`;
  if (!existsSync(file)) throw new Error(`no voice clip ${file}`);
  const clip = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
  return { lines: [...lines], clip };
}

/** Where the previous take's pointer ended, as a fraction of its frame (the edit joins the takes there), or `fallback`. */
function previousEnd(name, fallback) {
  try { const s = JSON.parse(readFileSync(SIDE, 'utf8'))[name]; if (s) return s; } catch { /* none yet */ }
  return fallback;
}
function keepEnd(name, end) {
  let all = {};
  try { all = JSON.parse(readFileSync(SIDE, 'utf8')); } catch { /* none yet */ }
  all[name] = end;
  writeFileSync(SIDE, `${JSON.stringify(all, null, 2)}\n`);
}

/** A film of a part of the capture: `crop` (CSS px) is cut from the frames and scaled to `out`. */
function openCropFilm({ path: file, fps, scale, crop, out }) {
  const px = (v) => Math.round(v * scale);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-vf', `crop=${px(crop.w)}:${px(crop.h)}:${px(crop.x)}:${px(crop.y)},scale=${out.width}:${out.height}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg left with ${c}`)))); });
  return {
    write: (jpeg) => new Promise((r) => { if (ff.stdin.write(jpeg)) r(); else ff.stdin.once('drain', r); }),
    end: async () => { ff.stdin.end(); await done; },
  };
}

/**
 * Films one take: opens the stage, runs `body` on the film, writes the film and its json. `body` gets `t`: `shoot(seconds)`, `until(seconds)`, `follow(path)`,
 * `run(expression)` (a call into the page, with frames drawn while it is answered), `holds(expression, seconds)`, `at(phrase)` (when the voice says it, in
 * the take: `lead` seconds of silence plus the phrase's place in the clip), `rect(find)`, `mark`, `narrate`, `pointerNow()`.
 */
async function take(name, { as = null, quiet = ['toasts', 'host'], scroll = /** @type {any} */ (0), voice = null, lead = 0, seconds, css = DESKTOP, scale = 2, out = { width: 2880, height: 1620 }, crop = null, start, prep = null }, body) {
  if (only && only !== name) return;
  const clip = voice ? clipOf(voice) : null;
  const owed = seconds;
  const cam = await openStage({ skin: SKIN, as, css, quiet, scale, port: PORT });
  try {
    if (prep) await prep(cam);
    await cam.evaluate(`scrollTo(0, ${typeof scroll === 'function' ? await cam.evaluate(scroll(css)) : scroll})`);
    await settle(cam, 40);
    await cam.drawPointer();
    const from = { x: start.x * css.width, y: start.y * css.height };
    await cam.move(from.x, from.y);
    const film = crop ? openCropFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, scale, crop, out }) : openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out });
    console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart${clip ? `; clip ${clip.clip.toFixed(2)} s, take ${owed} s` : ''}`);
    const F = cam.fps;
    let f = 0;
    const landed = [];
    const t = {
      cam, F, css, owed, from,
      frames: () => f,
      now: () => f / F,
      mark: (what) => { landed.push({ what, frame: f }); console.log(`${name}: ${what} at frame ${f} (${(f / F).toFixed(2)}s)`); },
      at: (phrase, nth = 0) => lead + phraseTime(clip.lines, clip.clip, phrase, nth),
      /* A frame the browser never answers (seen once or twice in a load of four filming agents) is a thrown error, not an hour's wait. */
      async frame() {
        let timer;
        const dead = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${name}: the browser drew no frame in 45 s at frame ${f}`)), 45_000); });
        try { await Promise.race([(async () => { await film.write(await cam.frame(true)); })(), dead]); } finally { clearTimeout(timer); }
        f++;
      },
      async shoot(secs) { for (let i = 0, n = Math.round(secs * F); i < n; i++) await t.frame(); },
      async until(secs) { while (f < Math.round(secs * F)) await t.frame(); },
      async follow(p) { for (let i = 1, n = Math.max(1, Math.round(p.seconds * F)); i <= n; i++) { const q = p.at(Math.min(p.seconds, i / F)); await cam.move(q.x, q.y); await t.frame(); } },
      async run(expression) {
        let done = false, value, failure;
        const asked = cam.evaluate(expression).then((v) => { value = v; }, (e) => { failure = e; }).then(() => { done = true; });
        for (let i = 0; !done; i++) { if (i > 600) throw new Error(`the page never answered: ${expression}`); await t.frame(); }
        await asked;
        if (failure) throw failure;
        return value;
      },
      async holds(expression, limit = 4) {
        for (let i = 0, n = Math.round(limit * F); i <= n; i++) { if (await t.run(expression)) return; }
        throw new Error(`${name}: the page never came to: ${expression}`);
      },
      rect: (find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; })()`),
      /** Where the drawn pointer is now, in CSS px. */
      pointerNow: () => cam.evaluate(`(() => { const m = /translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/.exec(document.getElementById('kb-hype-pointer').style.transform); return { x: Number(m[1]), y: Number(m[2]) }; })()`),
      narrate: (cues, { from: at = from, box = SCREEN, seed, still = false, until = owed }) => narrate(cam, cues, { frame: () => t.frame(), now: () => f / F, fps: F, from: at, box, seed, until, still, log: (m) => console.log(`${name}: ${m}`) }),
    };
    await body(t);
    if (f < Math.round(owed * F)) throw new Error(`${name}: ${f} frames is shorter than the ${owed} s the take is owed`);
    const end = await t.pointerNow();
    await film.end();
    const endFrac = { x: +(end.x / css.width).toFixed(4), y: +(end.y / css.height).toFixed(4) };
    keepEnd(name, endFrac);
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed, start, end: endFrac, ...(crop ? { crop } : {}) }, null, 2)}\n`);
    console.log(`${name}: filmed ${f} frames (${(f / F).toFixed(2)} s); the pointer ends at ${JSON.stringify(endFrac)}; errors:`, cam.errors);
    if (cam.errors.length > 0) throw new Error(`${name}: the page raised errors:\n${cam.errors.join('\n')}`);
  } finally {
    await cam.close();
  }
}

/* ---------------------------------------------------------------------------------------------------------------------------- o-open */
const FIRST_POST_SCROLL = 130;
const NODE_AT = { x: 850, y: 330 };
const SHEET = `document.querySelector('#post-1 img.kb-bb-img')`;

await take('o-open', { voice: 'v01', lead: 4.5, seconds: 27, scroll: FIRST_POST_SCROLL, start: { x: 0.97, y: 0.86 } }, async (t) => {
  const { cam } = t;
  const id = await cam.evaluate(`window.__shot.node(${NODE_AT.x}, ${NODE_AT.y})`);
  const node = `document.querySelector('[data-hype-node="${id}"]')`;
  const started = `window.__shot.nodes().some((n) => n.id === ${id} && n.started)`;
  if (await cam.evaluate(started)) throw new Error('o-open: the node is turning before it is clicked');
  const CLICK = 4.5;
  await t.narrate([
    /* Silence: it drifts in from the edge, hovers near the node, hesitates, circles off, comes back and clicks. */
    { at: 1.9, do: 'go', target: node, hold: 0.3 },
    { at: 2.2, do: 'circle', target: node, seconds: 0.8, radius: 110 },
    { at: CLICK, do: 'click', target: node, hold: 0.1, then: () => { t.mark('node-click'); } },
    { at: CLICK + 0.3, do: 'act', run: async (ctx) => { await ctx.holds(started, 2); } },
    /* v01: idle, a slow drift across the sprite sheet at "putting all of our resources into this". */
    { at: t.at('Over the last few years') + 0.5, do: 'go', target: { x: 780, y: 215 }, hold: 0.4 },
    { at: t.at("we've been putting all") - 0.5, do: 'trace', target: SHEET, seconds: 3.2, hold: 0.8 },
  ], { seed: 21 });
  const press = t.landedAt;
  if (!(await cam.evaluate(started))) throw new Error('o-open: the node is not turning at the end');
  void press;
});

/* ---------------------------------------------------------------------------------------------------------------------------- o-op-close */
const CLOSE = { width: 960, height: 540 };
/** The page scrolled to put post 1's body at the top of the frame. */
const post1Top = () => `document.querySelector('#post-1 .kb-act-main').getBoundingClientRect().top + scrollY - 6`;
/** A rectangle of the page's text: the words of `needle` in post 1, as an element-like for `narrate`. */
const words = (needle) => `(() => { const root = document.querySelector('#post-1 .kb-act-main'); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(${JSON.stringify(needle)}); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${needle.length}); return { getBoundingClientRect: () => r.getBoundingClientRect() }; } } return null; })()`;

await take('o-op-close', {
  voice: 'v02', seconds: 16, css: CLOSE, scale: 3, quiet: ['toasts', 'host', 'hud'], scroll: post1Top,
  start: previousEnd('o-open', { x: 0.45, y: 0.5 }),
}, async (t) => {
  const box = { x: 0, y: 0, w: CLOSE.width, h: CLOSE.height + 40 };
  const sheet = SHEET;
  await t.narrate([
    { at: Math.max(1.0, t.at('a straightforward MFGG')), do: 'trace', target: words('my first ever sprite sheet'), seconds: 1.9, hold: 0.2 },
    { at: t.at('2.9 star') - 0.5, do: 'circle', target: sheet, seconds: 2.4, radius: 130 },
    { at: t.at('earnest and innocuous') - 0.2, do: 'go', target: words('original character'), hold: 1.5 },
    /* The last 1.5 s ("... the kind of game design problem we set out to solve"): the cursor moves downward and leaves. */
    { at: t.owed - 1.9, do: 'go', target: { x: CLOSE.width * 0.5, y: CLOSE.height + 26 }, on: true, seconds: 1.55, hold: 0.2 },
  ], { box, seed: 31, still: true });
});

/* ---------------------------------------------------------------------------------------------------------------------------- o-kind */
/** Where the page is scrolled to put post `n` with its top `y` px down the frame. */
const postAt = (n, y) => `document.querySelector('#post-${n}').getBoundingClientRect().top + scrollY - ${y}`;
/** What each kind post is drawn with, asserted on the page while the post is in view. */
const KIND = { 3: 'fab', 4: 'hype', 5: 'fab', 6: 'reading' };

await take('o-kind', {
  voice: 'v03', seconds: 20, scroll: () => postAt(2, 40),
  start: { x: previousEnd('o-op-close', { x: 0.5, y: 1 }).x, y: -0.015 },
}, async (t) => {
  const { cam, F } = t;
  const posts = await cam.evaluate(`window.__kbStage.posts`);
  const top = (n) => cam.evaluate(`document.querySelector('#post-${n}').getBoundingClientRect().top + scrollY`);
  const rnd = seeded(5);
  /* The scroll's course: [seconds, scrollY] knots; the post's top is 88 px down the frame when it is through the middle (the HUD covers the foot of the frame). */
  const base0 = await cam.evaluate('scrollY');
  const mid = async (n) => (await top(posts[n])) - 88;
  const S = [await mid('kind1'), await mid('kind2'), await mid('kind3'), await mid('kind4')];
  const end = (await top(posts.heel)) - 158;
  const knots = [
    [0, base0], [4.2, base0], [6.9, S[0]], [9.5, S[1]], [10.5, S[1]], [13.0, S[2]], [15.7, S[3]], [16.2, S[3]], [18.6, end - 70], [20, end],
  ];
  const target = (sec) => {
    for (let i = 1; i < knots.length; i++) {
      if (sec <= knots[i][0]) { const [t0, y0] = knots[i - 1], [t1, y1] = knots[i], u = (sec - t0) / (t1 - t0); const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65; return y0 + (y1 - y0) * e; }
    }
    return end;
  };
  /* The wheel in small uneven notches: each a few frames of an eased roll, the next one starting when the target is a notch away. */
  let owedPx = 0, rolled = 0, queue = [], notch = 46;
  const scrolling = async (sec) => {
    const want = target(sec) - base0;
    if (queue.length === 0 && want - rolled >= notch) {
      const n = Math.min(want - rolled, notch);
      const frames = 5 + Math.floor(rnd() * 3);
      const weights = Array.from({ length: frames }, (_, i) => (frames - i) ** 1.6), sum = weights.reduce((a, b) => a + b, 0);
      queue = weights.map((w) => (w / sum) * n);
      rolled += n;
      notch = 34 + rnd() * 52;
    }
    if (queue.length > 0) {
      owedPx += queue.shift();
      const dy = Math.round(owedPx);
      if (dy !== 0) { await cam.wheel(dy); owedPx -= dy; }
    }
  };
  /* The pointer: enters from the top and settles on post 2; drifts through the scroll; hovers a positive reaction on post 4's pause. */
  const f_log = true;
  let pos = { ...t.from };
  const wait = async (secs, make) => {
    const p = make(Math.max(0.05, secs - t.now()));
    for (let i = 1, n = Math.max(1, Math.round(p.seconds * F)); i <= n; i++) {
      const q = p.at(Math.min(p.seconds, i / F));
      await cam.move(q.x, q.y); await scrolling(t.now());
      await t.frame();
      if (f_log && i % 60 === 0) console.log('o-kind: t', t.now().toFixed(2), 'scrollY', await cam.evaluate('scrollY'));
    }
    pos = { ...p.end };
  };
  const drift = (until, radius = 70, s = 1) => wait(until, (left) => idle(pos, left, { seed: 40 + s + Math.floor(until * 7), box: { x: 330, y: 150, w: 1000, h: 400 }, radius }));
  const go = (to, secs, s, settleOn = true) => wait(t.now() + secs, () => reach(pos, to, secs, { seed: s, settle: settleOn, box: { x: -20, y: -20, w: 1480, h: 850 } }));
  const effects = {};
  /** The post's effect is on the page, drawn, and in view; its reactions are visible. */
  const checkKind = async (key) => {
    const n = posts[key], what = KIND[n - 2];
    const seen = await cam.evaluate(`(() => {
      const p = document.querySelector('#post-${n}'), r = p.getBoundingClientRect();
      const inView = r.top >= 0 && r.bottom <= 598;
      const foil = p.querySelector('canvas.dw-fab-foil'), fr = foil?.getBoundingClientRect();
      const marks = [...p.querySelectorAll('.kb-mark')].map((m) => m.getAttribute('aria-label') ?? m.textContent.trim().slice(0, 40));
      const reactions = [...p.querySelectorAll('.kb-reaction')].filter((e) => e.getBoundingClientRect().height > 0).length;
      return { inView, foil: foil ? { w: fr.width, h: fr.height, onScreen: fr.top >= 0 && fr.bottom <= 598, ink: (() => { try { const c = foil.getContext('2d'); if (!c) return null; const d = c.getImageData(0, 0, foil.width, foil.height).data; let k = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) k++; return k; } catch { return null; } })() } : null, marks, reactions };
    })()`);
    effects[key] = seen;
    if (!seen.inView) throw new Error(`o-kind: ${key} is not whole in view when it is through the middle: ${JSON.stringify(seen)}`);
    if (seen.reactions < 1) throw new Error(`o-kind: ${key} shows no reactions: ${JSON.stringify(seen)}`);
    if (what === 'fab' && !(seen.foil && seen.foil.w > 100 && seen.foil.h > 50 && seen.foil.onScreen && seen.foil.ink !== 0)) throw new Error(`o-kind: ${key}'s Feelin' Fab foil did not draw: ${JSON.stringify(seen)}`);
    if (what !== 'fab' && seen.marks.length < 1) throw new Error(`o-kind: ${key} has no card mark on it: ${JSON.stringify(seen)}`);
    t.mark(`kind-${n}`);
  };
  /* "human beings enjoy being Liked": about 4 s settled on Chadluminum's post (the pointer enters from the top at once). */
  await go({ x: 780, y: 215 }, 1.4, 41);
  await drift(4.2, 40, 1);
  /* The scroll begins. Each kind post is checked as it comes through the middle of the frame. */
  await drift(6.9, 70, 2);
  await checkKind('kind1');
  await drift(9.5, 70, 3);
  await checkKind('kind2');
  /* On its pause the pointer goes to a positive reaction on the post and hovers it, then leaves. */
  const chip = await t.rect(`document.querySelector('#post-${posts.kind2} .kb-reaction')`);
  if (!chip) throw new Error('o-kind: post 4 has no reaction to hover');
  await go({ x: chip.x, y: chip.y }, 0.6, 42);
  await wait(10.35, (left) => rest(pos, left, { seed: 43 }));
  const hot = await cam.evaluate(`document.querySelector('#post-${posts.kind2} .kb-reaction:hover') !== null`);
  if (!hot) throw new Error('o-kind: the pointer is not over the reaction it hovers');
  t.mark('reaction-hover');
  await go({ x: chip.x + 200, y: chip.y - 150 }, 0.7, 44);
  await drift(13.0, 70, 4);
  await checkKind('kind3');
  await drift(15.7, 70, 5);
  await checkKind('kind4');
  await drift(18.6, 60, 6);
  await drift(20, 40, 7);
  /* The scroll arrives: Hotel Bro's post is coming into the frame from below. */
  const arrived = await cam.evaluate(`(() => { const r = document.querySelector('#post-${posts.heel}').getBoundingClientRect(); return { top: r.top, innerHeight }; })()`);
  console.log('o-kind: Hotel Bro\'s post top is at', arrived.top, 'of', arrived.innerHeight, '; effects:', JSON.stringify(effects));
  if (!(arrived.top > 100 && arrived.top < 520)) throw new Error(`o-kind: Hotel Bro's post is not arriving in the frame: top ${arrived.top}`);
  t.mark('heel-arrives');
});

/* ---------------------------------------------------------------------------------------------------------------------------- the Heel */
const HEAT = [['Snuckles', 'tomato'], ['Serious Deer', 'tomato'], ['Ringside', 'vomiting'], ['Front Row', 'tomato'], ['Nosebleeds', 'tomato']];
const heelPost = () => 'window.__kbStage.posts.heel';
const HEEL_TOP = 60;
const heelScroll = () => `document.querySelector('#post-' + ${heelPost()}).getBoundingClientRect().top + scrollY - ${HEEL_TOP}`;
const tallyOf = `document.querySelector('#post-' + ${heelPost()} + ' .kb-reaction-list')`;
const thumbsOf = `[...document.querySelectorAll('#post-' + ${heelPost()} + ' .kb-reaction')].find((e) => e.textContent.includes('\u{1F44D}'))`;
const said = (hundredths) => (hundredths === 0 ? '' : `${hundredths > 0 ? '+' : '−'}${(Math.abs(hundredths) / 100).toFixed(2)} est.`);

/**
 * The Heel's forecast, the five heat reactions from `firstAt` a third of a second apart and the thumbs up at `thumbsAt`: each lands as another
 * player's character, and is read to have moved the forecast and the HUD's own text (the orbs' "+0.30 est.") the way the film claims.
 */
function reactions(t, { firstAt, thumbsAt, gap = 1 / 3 }) {
  const { cam } = t;
  const forecast = (ctx) => ctx.evaluate('window.__shot.forecast()');
  const ghost = (ctx) => ctx.evaluate(`document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
  const hudSays = async (ctx, now, why) => {
    const want = said(now);
    try { await ctx.holds(`(document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? '') === ${JSON.stringify(want)}`, 2); } catch { throw new Error(`the HUD does not show the forecast after ${why}: it says ${JSON.stringify(await ghost(ctx))}, the forecast is ${now} (${JSON.stringify(want)})`); }
  };
  return async (ctx) => {
    if ((await forecast(ctx)) !== 0) throw new Error("the Heel's forecast does not start at nothing");
    if ((await ghost(ctx)) !== '') throw new Error('the HUD shows an estimate before any reaction');
    let last = 0, hud = '';
    const post = await cam.evaluate(heelPost());
    for (const [i, [who, key]] of HEAT.entries()) {
      await ctx.until(firstAt + gap * i);
      await ctx.evaluate(`window.__shot.react(${JSON.stringify(who)}, ${post}, ${JSON.stringify(key)})`);
      const now = await forecast(ctx);
      if (!(now > last)) throw new Error(`${who}'s ${key} did not raise the Heel's forecast: ${last} then ${now}`);
      await hudSays(ctx, now, `${who}'s ${key}`);
      if (said(now) === hud) throw new Error(`the HUD's estimate did not change after ${who}'s ${key}: ${hud}`);
      console.log(`${t.name}: ${who}'s ${key}: forecast ${last} -> ${now}; the HUD says ${JSON.stringify(said(now))}`);
      hud = said(now);
      t.mark('reaction-up');
      last = now;
    }
    if (thumbsAt == null) return;
    await ctx.until(thumbsAt);
    await ctx.evaluate(`window.__shot.react('Aisle Seat', ${post}, 'thumbs-up')`);
    const after = await forecast(ctx);
    if (!(after < last)) throw new Error(`the thumbs up did not lower the Heel's forecast: ${last} then ${after}`);
    await hudSays(ctx, after, "Aisle Seat's thumbs-up");
    console.log(`${t.name}: Aisle Seat's thumbs-up: forecast ${last} -> ${after}; the HUD says ${JSON.stringify(said(after))}`);
    t.mark('reaction-down');
  };
}

await take('o-heel', {
  as: 'Hotel Bro', voice: 'v05', seconds: 19, scroll: heelScroll,
  start: previousEnd('o-kind', { x: 0.6, y: 0.4 }),
}, async (t) => {
  t.name = 'o-heel';
  const shown = await t.cam.evaluate(`(() => { const hud = document.querySelector('.kb-hud-glass')?.textContent ?? ''; return { heel: /heel/i.test(hud), orbs: Boolean(document.querySelector('.kb-orbs-row')), post: Boolean(document.querySelector('#post-' + ${heelPost()})) }; })()`);
  if (!shown.heel || !shown.orbs || !shown.post) throw new Error(`the HUD or the post is not in frame: ${JSON.stringify(shown)}`);
  const firstAt = t.at('the crowd threw'), thumbsAt = t.at('politely');
  await t.narrate([
    { at: 0, do: 'act', run: reactions(t, { firstAt, thumbsAt }) },
    { at: t.at("he's a Heel") + 0.1, do: 'go', target: "document.querySelector('.kb-hud-class')", hold: 0.9 },
    { at: firstAt + 0.45, do: 'trace', target: tallyOf, guess: { x: 410, y: 415, w: 130, h: 30, left: 345, top: 400 }, seconds: 0.7, hold: 0.05 },
    { at: t.at('it gives him Aura') + 0.15, do: 'go', target: "document.querySelector('.kb-orbs-row')", fx: 0.3, on: true, hold: 1.0 },
    { at: thumbsAt + 0.15, do: 'go', target: thumbsOf, guess: { x: 487, y: 415, w: 50, h: 30, left: 462, top: 400 }, on: true, hold: 0.2 },
    { at: t.at('actually LOSES') + 0.4, do: 'go', target: "document.querySelector('.kb-orbs-row')", fx: 0.5, on: true, hold: 0.3 },
    { at: t.at('check this out') - 0.2, do: 'go', target: thumbsOf, on: true, hold: 0.3 },
  ], { seed: 51, still: true });
});

await take('o-heel-aura', {
  as: 'Hotel Bro', seconds: 4, scale: 2, out: { width: 1920, height: 1080 }, crop: { x: 406, y: 450, w: 640, h: 360 }, scroll: heelScroll,
  start: previousEnd('o-kind', { x: 0.6, y: 0.4 }),
}, async (t) => {
  t.name = 'o-heel-aura';
  await t.narrate([
    { at: 0, do: 'act', run: reactions(t, { firstAt: 0.55, thumbsAt: null }) },
    { at: 0.5, do: 'go', target: "document.querySelector('.kb-orbs-row')", fx: 0.28, fy: 0.5, on: true, seconds: 0.9, hold: 3 },
  ], { seed: 61 });
  const text = await t.cam.evaluate(`document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim()`);
  console.log('o-heel-aura: the HUD ends saying', JSON.stringify(text));
});

/* ---------------------------------------------------------------------------------------------------------------------------- o-rant */
/**
 * The Heel's answer to the thumbs up ("video of angry typing", played in the 4.5 s gap before "Problem solved."): half a second on the thumbs up, then the
 * thread's foot with the pointer already over the reply box: he clicks into it and types with real key events, in bursts, one typo put right with Backspace.
 * The take ends mid-word; the post is never sent.
 */
const RANT = 'Who was that??? Come out here and fight me like a man and I will show you where to stick that thu';
const REPLY_BOX = `document.querySelector('textarea[aria-label="Your reply"]')`;
await take('o-rant', {
  as: 'Hotel Bro', seconds: 6.5, scroll: heelScroll,
  start: previousEnd('o-heel', { x: 0.35, y: 0.6 }),
  async prep(cam) {
    /* The state the last take left: five heat reactions and a thumbs up on his post, made before the film. */
    const post = await cam.evaluate(heelPost());
    for (const [who, key] of HEAT) await cam.evaluate(`window.__shot.react(${JSON.stringify(who)}, ${post}, ${JSON.stringify(key)})`);
    await cam.evaluate(`window.__shot.react('Aisle Seat', ${post}, 'thumbs-up')`);
    await settle(cam, 20);
  },
}, async (t) => {
  const { cam } = t;
  const there = await t.rect(thumbsOf);
  if (!there) throw new Error('o-rant: the thumbs up is not on his post');
  const here = await t.pointerNow();
  if (Math.hypot(there.x - here.x, there.y - here.y) > 2) await t.follow(reach(here, { x: there.x, y: there.y }, 0.2, { seed: 71, settle: false, box: SCREEN }));
  await t.shoot(0.5);
  /* The cut: the thread's foot, with the pointer already over the reply box. */
  await t.run(`scrollTo(0, document.documentElement.scrollHeight)`);
  await t.frame();
  const box = await t.rect(REPLY_BOX);
  if (!box) throw new Error('o-rant: the thread has no reply box at its foot');
  await cam.move(box.x, box.y);
  await t.frame();
  await cam.press(); await t.shoot(0.07); await cam.release();
  await t.holds(`document.activeElement === ${REPLY_BOX}`, 2);
  t.mark('typing');
  /* The keys: one to three frames each, now and then a longer breath, and the typo ("fight" as "fihg", put right with two Backspaces). */
  const rnd = seeded(77);
  const ops = [];
  for (const ch of RANT.replace('fight', 'fi\u0000')) { if (ch === '\u0000') ops.push('h', 'g', 'Backspace', 'Backspace', 'g', 'h', 't'); else ops.push(ch); }
  let typed = '', whoDone = false;
  for (const [i, op] of ops.entries()) {
    cam.key(op);
    typed = op === 'Backspace' ? typed.slice(0, -1) : typed + op;
    await t.frame();
    if (!whoDone && typed === 'Who was that???') { whoDone = true; t.mark('who-was-that'); }
    const gap = (op === ' ' ? 1 : 0) + 1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.1 ? 3 + Math.floor(rnd() * 4) : 0) + (rnd() < 0.04 ? 4 : 0);
    if (i < ops.length - 1) for (let k = 1; k < gap; k++) await t.frame();
  }
  const value = await cam.evaluate(`${REPLY_BOX}.value`);
  if (value !== RANT) throw new Error(`o-rant: the reply box holds ${JSON.stringify(value)}, not the rant up to "thu"`);
  if (!whoDone) throw new Error('o-rant: "Who was that???" was never complete');
  if (t.now() > t.owed) throw new Error(`o-rant: the typing ran to ${t.now().toFixed(2)} s, past the ${t.owed} s take`);
  await t.until(t.owed);
  const posts = await cam.evaluate(`document.querySelectorAll('article.kb-act').length`);
  if (posts > 20) throw new Error('o-rant: a post was sent');
});
