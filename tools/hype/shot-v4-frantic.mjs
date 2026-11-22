/**
 * The commentary video's frantic half (docs/plans/2026-11-21-commentary-video-revision-design.md, section 11): the footage "begins to get progressively
 * more frantic": quick cuts, tight close-ups, fast tracking with a real shutter's blur, an action-packed forum. Every take is in the Hot Rod skin (the
 * film turns from Fan Site to Hot Rod when the narrator loses control), is written at 2880 x 1620, 60 frames a second, and is FRONT-LOADED: the
 * edit uses one to two seconds of most of them, so the beat is in the first second and nothing is held.
 *
 *   node tools/hype/shot-v4-frantic.mjs --only f-caught [--port 4323]
 *
 * Takes (the names are the cut list's):
 *   f-caught f-thrown f-chess-lens   Hotel Bro's Whoops! caught by Snuckles's face-down Rope Break; thrown back at his own post 7, where the back turns
 *                                    over to 4D Chess; the 4D Chess's Lens.
 *   f-phrase                         Ringside's real quote of post 2 posted, the frame on it as the Steel Chair is thrown.
 *   f-forged                         D-Guy's forged quote of Chadluminum typed in the real composer and sent.
 *   f-heap-wide f-heap-tight f-heap-turned   one script on one clock: a play every 0.7 s on post 1 (the turned take at 240 fps, blended).
 *   f-track-1..3                     the page whipped from post to post and stopped dead on an effect as it happens (240 fps, blended).
 *   f-gpt2                           the droning You Were Saying? tail typing on post 13, no camera motion.
 *   f-fold                           Serious Deer's folded post 14, opened.
 *   f-peel f-scrub f-smoke f-tag f-hold f-chair   close-ups of effects handled by the pointer.
 *   f-leave-1..5, f-leave-all        the five leaving posts submitted through the real composer; the page scrolls down to follow them.
 *
 * A take at 240 fps is blended four to one into 60 (ffmpeg tmix), which is a shutter's blur: the camera steps the page's clock itself. Beside each
 * take is `<take>.json`: `landed` (frames in 60 fps terms), `blur` (whether it was blended), `move`/`punches` for the edit. Every wait is on the
 * page's virtual clock or a condition; every "assert" reads the page and throws when the picture is not what the film claims.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const only = flag('only', null);
const PORT = Number(flag('port', 4323));
const SIZE = { width: 2880, height: 1620 };
const DESKTOP = { width: 1440, height: 810 };
const CLOSE = { width: 960, height: 540 };
const WIDE = { width: 1920, height: 1080 };
/** The leaving takes' viewport: a leaving post is about 420 CSS px tall (the post body's own minimum), so a 1080 px-high view holds barely one above the reply box; at 3200 x 1800 (still 16:9, filmed at density 0.9, which is still sharper than the old 1920-wide takes at 0.75) three earlier ones fit above Chadluminum's. */
const PILE = { width: 3200, height: 1800 };

/** Throws with `what` when `ok` is not so. @param {unknown} ok @param {string} what */
function assert(ok, what) { if (!ok) throw new Error(`the page does not show: ${what}`); }

/** The five leaving posts' words (stage-world.ts's LEAVING), typed into the composer by real keys. */
const LEAVING = {
  Snuckles: "That's it! I'll kindly take my Wigglers elsewhere!!!",
  'Hotel Bro': "I can't wait to fuggetabout you clowns, capiche?",
  'Serious Deer': "I didn't do anything but ok.",
  'D-Guy': "that's all, folks \u{1F62C}",
  Chadluminum: "I've really tried for a long time, but I just don't think this is going to work. See you all around.",
};
const LEAVERS = Object.keys(LEAVING);

/** A film at 240 frames a second blended four to one into 60: each output frame is the mean of four frames, a shutter open for the whole interval. */
function openBlend({ path, fps, out }) {
  const k = fps / 60;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-vf', `tmix=frames=${k}:weights='${Array(k).fill('1').join(' ')}',select='eq(mod(n\\,${k})\\,${k - 1})',setpts=N/60/TB,scale=${out.width}:${out.height}:flags=lanczos`,
    '-r', '60', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg left with ${c}`)))); });
  return {
    write: (jpeg) => new Promise((r) => { if (ff.stdin.write(jpeg)) r(); else ff.stdin.once('drain', r); }),
    end: async () => { ff.stdin.end(); await done; },
  };
}

/** Frames drawn and thrown away (the page's time moves, nothing is filmed) until a call into the page is answered. @param {any} cam @param {string} expression */
async function answered(cam, expression) {
  let done = false, value, failure;
  const asked = cam.evaluate(expression).then((v) => { value = v; }, (e) => { failure = e; }).then(() => { done = true; });
  for (let i = 0; !done; i++) { if (i > 900) throw new Error(`the page never answered: ${expression}`); await cam.frame(false); }
  await asked;
  if (failure) throw failure;
  return value;
}
/** A number of frames drawn and thrown away. @param {any} cam @param {number} n */
async function drawn(cam, n) { for (let i = 0; i < n; i++) await cam.frame(false); }
/** A press by the real pointer, nothing filmed: it moves to `to`, presses and releases. @param {any} cam @param {{ x: number, y: number }} to */
async function hidden(cam, to) {
  await cam.move(to.x, to.y);
  await drawn(cam, 6);
  await cam.press(); await cam.frame(false); await cam.release();
  await drawn(cam, 12);
}
/** The middle of the element the expression finds, or null. @param {any} cam @param {string} find */
const midOf = (cam, find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; })()`);

/** The post's top brought to `top` px down the view. @param {number} seq @param {number} top */
const placePost = (seq, top) => `(() => { const p = document.querySelector('#post-${seq}'); p.scrollIntoView({ block: 'start' }); scrollBy(0, -${top}); })()`;
/** The post's body's centre brought to the view's middle plus `dy`. @param {number} seq @param {number} dy */
/** The post's body's top brought to `top` px down the view. @param {number} seq @param {number} top */
const placeBody = (seq, top) => `(() => { const p = document.querySelector('#post-${seq}'); p.scrollIntoView({ block: 'center' }); const r = p.querySelector('.kb-act-main').getBoundingClientRect(); scrollBy(0, r.top - ${top}); })()`;
const centerPost = (seq, dy = 0) => `(() => { const r = document.querySelector('#post-${seq} .kb-act-main').getBoundingClientRect(); scrollBy(0, r.top + r.height / 2 - innerHeight / 2 - (${dy})); })()`;
const SEND = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send')`;
const REPLY = `document.querySelector('textarea[aria-label="Your reply"]')`;
const FOOT = `document.documentElement.scrollHeight - innerHeight`;

/**
 * Films one take. `body(d)` runs on the film's clock; the take is held to `seconds` (it throws if the body runs over by more than a fifth of a second).
 * `prep(cam)` runs before the clocks are frozen (frames drawn with `cam.frame(false)`), and returns where the pointer starts.
 * `fps` is 60 or 240 (blended to 60). Times in `d` are seconds of the take; marks are frames of the 60 fps film.
 * @param {string} name
 * @param {{ as?: string | null, css?: { width: number, height: number }, scale?: number, fps?: number, quiet?: string[], seconds: number, prep?: (cam: any) => Promise<any>, body: (d: any) => Promise<void>, move?: object | null, punches?: { frame: number, percent: number }[] | ((landed: { what: string, frame: number }[]) => { frame: number, percent: number }[]), skin?: string, hold?: boolean }} spec
 */
async function take(name, { as = null, css = DESKTOP, scale, fps = 60, quiet = ['toasts', 'host'], seconds, prep, body, move = null, punches = [], skin = 'hot-rod' }) {
  if (only && only !== name) return;
  const cam = await openStage({ skin, as, css, scale: scale ?? SIZE.width / css.width, fps, quiet, port: PORT });
  try {
    const start = prep ? await prep(cam) : null;
    await cam.drawPointer();
    await settle(cam, 40);
    /* The skin's style sheet loads after the first effects mount: they raise a named error ("shine band: --kb-fg is not a hex color") once, before the film, and draw on the next pass. Errors BEFORE the film are counted and reported; one raised during it fails the take. */
    assert(await cam.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--kb-fg').trim() !== ''`), 'the skin\'s tokens loaded (--kb-fg)');
    const bootErrors = cam.errors.length;
    if (bootErrors) console.log(`${name}: ${bootErrors} page errors at load, before the film (the skin's tokens not yet read by the first effects)`);
    const film = (fps === 60 ? openFilm({ path: `${OUT}/${name}.mp4`, fps: 60, out: SIZE, preset: 'veryfast' }) : openBlend({ path: `${OUT}/${name}.mp4`, fps, out: SIZE }));
    console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart (${fps} fps${fps === 60 ? '' : ', blended to 60'})`);
    await cam.evaluate('window.__shot.zero()');
    const F = fps, K = fps / 60;
    let raw = 0, at = start ?? { x: css.width * 0.7, y: css.height * 0.6 };
    /** @type {{ what: string, frame: number }[]} */
    const landed = [];
    /** @type {null | ((d: any) => Promise<void>)} */
    let each = null;
    const d = {
      cam, F, css,
      get t() { return raw / F; },
      get frame() { return Math.floor(raw / K); },
      get at() { return at; },
      set each(fn) { each = fn; },
      page: (/** @type {string} */ js) => cam.evaluate(js),
      mid: (/** @type {string} */ find) => midOf(cam, find),
      mark: (/** @type {string} */ what) => { landed.push({ what, frame: Math.floor(raw / K) }); console.log(`${name}: ${what} at ${(raw / F).toFixed(2)} s (frame ${Math.floor(raw / K)})`); },
      /** One frame, filmed. */
      async one() { if (each) await each(d); await film.write(await cam.frame(true)); raw++; },
      async shoot(/** @type {number} */ secs) { for (let i = 0, n = Math.round(secs * F); i < n; i++) await d.one(); },
      /** Shoots up to `secs` into the take. */
      async until(/** @type {number} */ secs) { while (raw < Math.round(secs * F)) await d.one(); },
      /** Frames filmed until `expression` is true on the page, or throws after `max` seconds. */
      async when(/** @type {string} */ expression, max = 4, label = expression) {
        for (let i = 0; i < max * F; i++) { if (await cam.evaluate(expression)) return; await d.one(); }
        throw new Error(`${name}: the page never came to: ${label}`);
      },
      /** A call into the page answered while frames are filmed. */
      async run(/** @type {string} */ expression) {
        let done = false, value, failure;
        const asked = cam.evaluate(expression).then((v) => { value = v; }, (e) => { failure = e; }).then(() => { done = true; });
        for (let i = 0; !done; i++) { if (i > 40 * F) throw new Error(`the page never answered: ${expression}`); await d.one(); }
        await asked;
        if (failure) throw failure;
        return value;
      },
      /** Frames not filmed (the page's time moves). */
      hide: (/** @type {number} */ n) => drawn(cam, n),
      /** The page's time runs on with no frame drawn. */
      skip: (/** @type {number} */ ms) => cam.skip(ms),
      put: async (/** @type {number} */ x, /** @type {number} */ y) => { at = { x, y }; await cam.move(x, y); },
      /** The pointer's hand-like move to a point (or one a function gives), a frame at a time. */
      async go(/** @type {{ x: number, y: number } | (() => Promise<{ x: number, y: number }>)} */ to, seconds = 0.4, seed = 3, settleOn = true) {
        const aim = typeof to === 'function' ? to : async () => to;
        const first = await aim(), path = glide(at, first, seconds, { seed, settle: settleOn }), n = Math.max(1, Math.round(seconds * F));
        for (let i = 0; i <= n; i++) {
          const p = path.at(i / F), now = await aim(), u = i / n;
          await d.put(p.x + (now.x - first.x) * u, p.y + (now.y - first.y) * u);
          await d.one();
        }
        return at;
      },
      async press(/** @type {number} */ secs = 0.06) { await cam.press(); await d.shoot(secs); await cam.release(); },
      async tap(/** @type {number} */ after = 0.05) { await d.press(); await d.shoot(after); },
      async key(/** @type {string} */ k, secs = 0.03) { cam.key(k); await d.shoot(secs); },
      /** A scroll of the page to `y` (a number, or a page expression) over `secs`: eased like a camera operator's whip, fast in the middle, with a hair of overshoot that the page's own foot or top may cut off. */
      async whip(/** @type {number | string} */ y, secs = 0.4, overshoot = 0.025) {
        const y0 = await cam.evaluate('scrollY'), y1 = typeof y === 'number' ? y : await cam.evaluate(y), n = Math.max(1, Math.round(secs * F));
        const quart = (/** @type {number} */ u) => (u < 0.5 ? 8 * u ** 4 : 1 - (-2 * u + 2) ** 4 / 2);
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          /* The whip reaches the target at 85% of the move, runs a hair past it, and settles back: the operator's hard stop. */
          const pos = u < 0.85 ? quart(u / 0.85) : 1 + overshoot * Math.sin(Math.PI * (u - 0.85) / 0.15);
          await cam.evaluate(`document.scrollingElement.scrollTop = ${y0 + (y1 - y0) * pos}`);
          await d.one();
        }
        await cam.evaluate(`document.scrollingElement.scrollTop = ${y1}`);
      },
      /** A smooth, even scroll to `y` over `secs`. */
      async scrollTo(/** @type {number | string} */ y, secs = 0.4) {
        const y0 = await cam.evaluate('scrollY'), y1 = typeof y === 'number' ? y : await cam.evaluate(y), n = Math.max(1, Math.round(secs * F));
        for (let i = 1; i <= n; i++) { const u = 0.5 - 0.5 * Math.cos(Math.PI * i / n); await cam.evaluate(`document.scrollingElement.scrollTop = ${y0 + (y1 - y0) * u}`); await d.one(); }
      },
    };
    await body(d);
    if (d.t > seconds + 0.2) throw new Error(`${name}: the body ran ${d.t.toFixed(2)} s, over the take's ${seconds} s`);
    await d.until(seconds);
    await film.end();
    const marks = landed.length;
    const pun = typeof punches === 'function' ? punches(landed) : punches;
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed, blur: fps === 240, move, punches: pun }, null, 2)}\n`);
    console.log(`${name}: ${Math.floor(raw / K)} frames, ${(raw / F).toFixed(2)} s, ${SIZE.width}x${SIZE.height}, ${marks} beats; errors during the film:`, cam.errors.slice(bootErrors));
    if (cam.errors.length > bootErrors) throw new Error(`${name}: the page raised during the film: ${cam.errors.slice(bootErrors).join('; ')}`);
  } finally {
    await cam.close();
  }
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* The leaving posts. */

/**
 * The page at the thread's last page, at its foot (the live posts are shown only there), `before` leavers already in the thread above the reply box
 * (posted unfilmed, each by its own character), the reply box holding `words` typed with real keys, and the pointer on Send. Returns the pointer's place.
 */
/** The page scrolled so the reply box's Send button sits `gap` px above the very bottom of the frame: the posts above it (the earlier leavers) fill the frame, and a new post pushes the stack up. */
const boxToBottom = (gap = 28) => `(() => { const b = ${SEND}; const r = b.getBoundingClientRect(); scrollBy(0, r.bottom - (innerHeight - ${gap})); })()`;
async function leavePrep(cam, words, before) {
  await cam.evaluate(`[...document.querySelectorAll('a')].find((b) => /Jump to latest/.test(b.textContent)).click()`);
  await cam.until(`Boolean(document.querySelector('#post-21'))`, { label: 'the last page' });
  const foot = async () => { await cam.evaluate(`scrollTo(0, document.documentElement.scrollHeight)`); await drawn(cam, 12); };
  await foot();
  for (const who of before) {
    /** @type {any} */ const r = await answered(cam, `window.__shot.leave(${JSON.stringify(who)}, { wait: 3000 })`);
    if (!r?.shown) throw new Error(`${who}'s leaving post was not shown: ${JSON.stringify(r)}`);
    await foot();
  }
  /* The reply box is pressed by the real pointer and typed in with real keys, a few frames each. */
  const box = await midOf(cam, REPLY);
  await hidden(cam, { x: box.x, y: box.y });
  await cam.until(`document.activeElement === ${REPLY}`, { label: 'the reply box focused' });
  for (const ch of words) { cam.key(ch); await drawn(cam, 2); }
  const typed = await cam.evaluate(`${REPLY}.value`);
  if (typed !== words) throw new Error(`the reply box holds ${JSON.stringify(typed)}, not ${JSON.stringify(words)}`);
  /* The reply box sits at the very bottom of the frame, so as many of the posts it follows as fit are in frame above it, and the new post arrives there and pushes them up. */
  await cam.evaluate(boxToBottom());
  await drawn(cam, 12);
  const send = await midOf(cam, SEND);
  await cam.move(send.x, send.y);
  await drawn(cam, 8);
  return { x: send.x, y: send.y };
}

/** A per-frame follower: when the page grows, it scrolls itself down to the new foot in a fast eased whip. @param {number} secs */
function follower(secs = 0.32) {
  let seen = null, from = 0, to = 0, t0 = -1;
  return async (/** @type {any} */ d) => {
    const h = await d.page('document.documentElement.scrollHeight');
    if (seen === null) seen = h;
    if (h > seen + 10) { to = (t0 >= 0 ? to : await d.page('scrollY')) + (h - seen); seen = h; from = await d.page('scrollY'); t0 = d.t; d.mark('follow'); }
    if (t0 >= 0) {
      const u = Math.min(1, (d.t - t0) / secs), e = 1 - (1 - u) ** 3;
      await d.page(`document.scrollingElement.scrollTop = ${from + (to - from) * e}`);
      if (u >= 1) t0 = -1;
    }
  };
}

const leaveTake = (n) => take(`f-leave-${n}`, {
  as: LEAVERS[n - 1], css: PILE, quiet: ['toasts', 'host', 'hud', 'selection'], seconds: 1.8,
  prep: (cam) => leavePrep(cam, LEAVING[LEAVERS[n - 1]], LEAVERS.slice(0, n - 1)),
  async body(d) {
    const who = LEAVERS[n - 1], words = LEAVING[who];
    const before = await d.page(`document.querySelectorAll('article.kb-act').length`);
    assert(before === 5 + (n - 1), `${n - 1} earlier leaving posts above the reply box (${before} posts)`);
    assert(await d.page(`${REPLY}.value`) === words, 'the reply box holding the leaving words');
    d.each = follower();
    await d.shoot(0.3);
    d.mark('send');
    await d.press(0.05);
    await d.when(`document.querySelectorAll('article.kb-act').length === ${before + 1}`, 2, 'the leaving post posted');
    d.mark('posted');
    await d.until(0.9);
    const last = await d.page(`(() => { const a = [...document.querySelectorAll('article.kb-act')].at(-1); return { id: a.id, text: a.innerText, name: a.querySelector('.kb-postbit-name')?.textContent ?? '' }; })()`);
    assert(last.text.includes(words), `the post saying ${JSON.stringify(words)}: ${JSON.stringify(last.text)}`);
    assert(last.name.includes(who), `the post is ${who}'s: ${last.name}`);
  },
});

/** f-leave-all: the reader at the foot as all five arrive, 0.5 s apart, the page jerking down to follow each (240 fps, blended). */
const leaveAll = () => take('f-leave-all', {
  as: 'Ringside', css: PILE, quiet: ['toasts', 'host', 'hud', 'selection'], fps: 240, seconds: 4,
  async prep(cam) {
    await cam.evaluate(`[...document.querySelectorAll('a')].find((b) => /Jump to latest/.test(b.textContent)).click()`);
    await cam.until(`Boolean(document.querySelector('#post-21'))`, { label: 'the last page' });
    await cam.evaluate(boxToBottom());
    await drawn(cam, 12);
    return { x: 700, y: 300 };
  },
  async body(d) {
    const pending = [];
    const follow = follower(0.2);
    d.each = async (dd) => {
      for (const [i, who] of LEAVERS.entries()) if (!pending[i] && dd.t >= 0.3 + 0.5 * i) { pending[i] = dd.cam.evaluate(`window.__shot.leave(${JSON.stringify(who)}, { wait: 3000 })`); d.mark(`leave:${who}`); }
      await follow(dd);
    };
    await d.until(3.6);
    const got = await Promise.all(pending);
    assert(got.length === 5 && got.every((r) => r.shown), `all five posts shown: ${JSON.stringify(got)}`);
    const seen = await d.page(`[...document.querySelectorAll('article.kb-act')].slice(-5).map((a) => a.innerText)`);
    for (const [i, who] of LEAVERS.entries()) assert(seen[i].includes(LEAVING[who]), `${who}'s words on the page: ${JSON.stringify(seen[i])}`);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** f-fold: Serious Deer's folded post 14 opens on the line about generative AI: the film's one showing of the gag. */
const fold = () => take('f-fold', {
  css: CLOSE, quiet: ['toasts', 'host', 'hud'], seconds: 3,
  async prep(cam) {
    await cam.evaluate(`(() => { scrollTo(0, 0); const r = document.querySelector('#post-14').getBoundingClientRect(); scrollBy(0, r.top - 120); })()`);
    await settle(cam, 30);
    const bar = await midOf(cam, `[...document.querySelectorAll('#post-14 button')].find((b) => /^(Show|Hide) post/.test(b.getAttribute('aria-label') ?? b.textContent.trim()))`);
    assert(bar, 'the fold bar on post 14');
    return { x: bar.x + bar.w * 0.2, y: bar.y + 70 };
  },
  async body(d) {
    const bar = `[...document.querySelectorAll('#post-14 button')].find((b) => /^(Show|Hide) post/.test(b.getAttribute('aria-label') ?? b.textContent.trim()))`;
    assert(await d.page(`${bar}?.getAttribute('aria-expanded') === 'false'`), 'post 14 folded, its bar closed');
    assert(!(await d.page(`document.querySelector('#post-14').innerText`)).includes('generative AI'), 'the words hidden while the post is closed');
    const b = await d.mid(bar);
    /* A third of a second closed: the pointer arrives on the bar at once and presses. */
    await d.go({ x: b.x + b.w * 0.3, y: b.y }, 0.22, 91, false);
    await d.shoot(0.04);
    d.mark('press');
    await d.press(0.06);
    await d.when(`${bar}?.getAttribute('aria-expanded') === 'true'`, 2, 'the fold open');
    d.mark('open');
    await d.go({ x: b.x + b.w * 0.8, y: b.y + 150 }, 0.5, 92, false);
    await d.until(1.2);
    assert((await d.page(`document.querySelector('#post-14').innerText`)).includes("I've analyzed this sprite sheet's pixels and come to the unfortunate conclusion that it was created using generative AI."), "the words of Serious Deer's post, all of them");
    d.mark('words');
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** How many characters of the tail have typed in under the GPT-2 post (the hidden rest and the cursor are not counted). */
const TYPED = `(() => { const t = document.querySelector('#post-13 [data-kb-tail]'); if (!t) return 0; const c = t.cloneNode(true); for (const e of c.querySelectorAll('[data-kb-rest], [data-kb-cursor], [data-kb-cursor-place]')) e.remove(); return c.textContent.length; })()`;

/** f-gpt2: the one calm image of the storm: the droning tail typing on under post 13, close, steady, no camera motion at all. */
const gpt2 = () => take('f-gpt2', {
  css: { width: 640, height: 360 }, scale: 4.5, quiet: ['toasts', 'host', 'hud'], seconds: 6,
  async prep(cam) { await cam.evaluate(`document.querySelector('#post-13').scrollIntoView({ block: 'start' })`); await settle(cam, 30); return { x: 700, y: 400 }; },
  async body(d) {
    await d.page('window.__shot.gpt2()');
    for (let i = 0; i < 900 && (await d.page(TYPED)) < 1; i++) await d.hide(1);
    /* A few lines in: the tail types at 40 characters a second; the page's time runs on with no frame drawn, then the frame is set once (the take's only scroll, before the film's first frame). */
    await d.skip(9000);
    await d.hide(30);
    /* The frame is set once, before the first frame: the cursor line a third of the way down. The tail grows about 11 px a second, so over the take it stays in frame with no camera motion. */
    await d.page(`(() => { const c = document.querySelector('#post-13 [data-kb-cursor]') ?? document.querySelector('#post-13 [data-kb-tail]'); scrollBy(0, c.getBoundingClientRect().top - 120); })()`);
    await d.hide(4);
    const first = await d.page(TYPED);
    assert(first > 250, `the tail already flowing at the first frame (${first} characters)`);
    d.mark('typing');
    const y0 = await d.page('scrollY');
    await d.shoot(6);
    assert((await d.page('scrollY')) === y0, 'the page did not move');
    const cursorY = await d.page(`document.querySelector('#post-13 [data-kb-cursor]')?.getBoundingClientRect().top ?? -1`);
    assert(cursorY > 0 && cursorY < d.css.height - 20, `the cursor line still in frame at the end (${cursorY})`);
    const last = await d.page(TYPED);
    assert(last - first > 160, `the tail typing on during the take (${first} to ${last} characters)`);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* The cards: a face-down back on a post, a Whoops! cast at it. */

/** The spot on a card button in the open hand where that card is the one on top (the cards overlap), nearest its upper middle. @param {string} name */
const cardSpot = (name) => `(() => {
  const b = [...document.querySelectorAll('button.kb-postcard')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)}));
  if (!b) return null;
  const r = b.getBoundingClientRect(); let best = null;
  for (let fy = 0.06; fy < 0.96; fy += 0.04) for (let fx = 0.06; fx < 0.96; fx += 0.04) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y)?.closest('button') !== b) continue;
    const dist = Math.hypot(fx - 0.5, fy - 0.3);
    if (!best || dist < best.dist) best = { x, y, dist };
  }
  return best; })()`;
const PLAY_BUTTON = `[...document.querySelectorAll('button')].find((b) => /^Play as/.test(b.textContent))`;
const markOf = (seq) => `document.querySelector('#post-${seq} .kb-mark')?.getAttribute('aria-label') ?? ''`;

/** The hand opened and Whoops! armed by the real pointer, nothing filmed, so a take starts on the armed card; returns where the pointer starts. @param {any} cam @param {number} seq */
async function armWhoops(cam, seq) {
  await cam.evaluate(placePost(seq, 90));
  await settle(cam, 20);
  await hidden(cam, await midOf(cam, `document.querySelector('.kb-hud-hand')`));
  await cam.until(`[...document.querySelectorAll('button.kb-postcard')].some((b) => (b.getAttribute('aria-label') ?? '').startsWith('Whoops!'))`, { label: 'the hand open' });
  await hidden(cam, await cam.evaluate(cardSpot('Whoops!')));
  await cam.until(`Boolean(document.querySelector('#post-${seq} .kb-ghost-mark'))`, { label: `the armed Whoops! pressable on post ${seq}` });
  const slot = await midOf(cam, `document.querySelector('#post-${seq} .kb-ghost-mark')`);
  return { x: slot.x + 150, y: slot.y + 110 };
}

/** The play of the armed Whoops! on post `seq` by the real pointer: the slot pressed, the form scrolled to its foot, Play pressed. Marks `pressed` and `play`. @param {any} d @param {number} seq */
async function playArmed(d, seq) {
  await d.go(() => d.mid(`document.querySelector('#post-${seq} .kb-ghost-mark')`), 0.3, 13);
  d.mark('pressed');
  await d.press(0.05);
  await d.when(`Boolean(${PLAY_BUTTON})`, 3, 'the play form');
  await d.go({ x: 1190, y: 430 }, 0.2, 14, false);
  for (let i = 0; i < 4; i++) { await d.cam.wheel(260); await d.shoot(0.03); }
  await d.go(async () => (await d.mid(PLAY_BUTTON)) ?? { x: 1190, y: 600 }, 0.25, 15);
  d.mark('play');
  await d.press(0.05);
}

/** f-caught: Hotel Bro's Whoops! is cast at Snuckles's post 1, where a face-down card waits: the back turns over to Rope Break, no ink lands. */
const caught = () => take('f-caught', {
  as: 'Hotel Bro', seconds: 4, quiet: ['host'],
  prep: (cam) => armWhoops(cam, 1),
  async body(d) {
    assert(await d.page(`Boolean(document.querySelector('#post-1 .kb-mark'))`), 'a card back on post 1');
    const before = await d.page(markOf(1));
    d.mark('armed');
    await playArmed(d, 1);
    await d.when(`window.__kbStage.fake.cardsOn(window.__kbStage.acts.first, 30).then((a) => a.some((x) => x.kind === 'card' && x.payload.card === 'whoops'))`, 3, 'the cast recorded');
    const acts = await d.run(`window.__kbStage.fake.cardsOn(window.__kbStage.acts.first, 30).then((acts) => acts.filter((x) => x.kind === 'card' && x.payload.card === 'whoops').map((x) => ({ caught: x.payload.caught !== undefined })))`);
    assert(acts.length === 1 && acts[0].caught, `the cast caught: ${JSON.stringify(acts)}`);
    d.mark('caught');
    assert((await d.page(`document.querySelectorAll('#post-1 canvas.kb-whoops-ink').length`)) === 0, 'no ink on post 1');
    await d.until(1.0);
    await d.run(`window.__shot.told('Hotel Bro', 1)`);
    d.mark('alert');
    const turned = await d.page(markOf(1));
    console.log(`f-caught: the back on post 1: ${JSON.stringify(before)} -> ${JSON.stringify(turned)}`);
    assert(/Rope Break/.test(turned), `the back turned over to Rope Break: ${turned}`);
    d.mark('turned');
    assert((await d.page(`document.querySelector('.kb-toasts')?.textContent ?? ''`)).includes('had a Reversal waiting'), 'the alert "Snuckles had a Reversal waiting."');
    assert((await d.page(`document.querySelectorAll('#post-1 canvas.kb-whoops-ink').length`)) === 0, 'still no ink on post 1');
  },
});

/** Snuckles holds the caught Whoops!: Hotel Bro's cast, caught (unfilmed, through the backend). @param {any} cam */
async function snucklesHoldsWhoops(cam) {
  const c = await cam.evaluate(`window.__shot.cast('Hotel Bro', 1, 'whoops', { color: '#ff2bd6' })`);
  assert(c.caught && !c.rode, "Hotel Bro's Whoops! caught by the Rope Break on post 1");
}

/** f-thrown: the caught Whoops! thrown back at Hotel Bro's post 7: ink fills it; the 4D Chess face down there turns over (he wanted it played). */
const thrown = () => take('f-thrown', {
  as: 'Snuckles', seconds: 4,
  async prep(cam) { await snucklesHoldsWhoops(cam); return armWhoops(cam, 7); },
  async body(d) {
    assert(!(await d.page(markOf(7))).startsWith('4D Chess'), 'the back on post 7 still face down');
    d.mark('armed');
    await playArmed(d, 7);
    await d.when(`document.querySelectorAll('#post-7 canvas.kb-whoops-ink').length > 0`, 4, 'ink on post 7');
    d.mark('whoops');
    const ink = await d.page(`(() => { const b = document.querySelector('#post-7 .kb-act-main').getBoundingClientRect(); const c = [...document.querySelectorAll('#post-7 canvas.kb-whoops-ink')].map((e) => e.getBoundingClientRect()); return { body: [b.left, b.top, b.right, b.bottom], ink: [Math.min(...c.map((r) => r.left)), Math.min(...c.map((r) => r.top)), Math.max(...c.map((r) => r.right)), Math.max(...c.map((r) => r.bottom))] }; })()`);
    assert(ink.ink[0] <= ink.body[0] + 2 && ink.ink[2] >= ink.body[2] - 2 && ink.ink[1] <= ink.body[1] + 2 && ink.ink[3] >= ink.body[3] - 2, `ink over post 7's body, border to border ${JSON.stringify(ink)}`);
    const rode = await d.run(`(async () => { const { fake, acts } = window.__kbStage; const on = await fake.cardsOn(acts.heel, 30); return on.find((a) => a.kind === 'spring')?.payload ?? null; })()`);
    assert(rode?.did === 'rode' && rode?.card === '4d-chess', `the 4D Chess on post 7 says the Whoops! rode: ${JSON.stringify(rode)}`);
    d.mark('rode');
    await d.when(`/^4D Chess/.test(${markOf(7)})`, 3, 'the back on post 7 turned over: 4D Chess');
    d.mark('turned');
    await d.go({ x: 760, y: 120 }, 0.4, 16, false);
  },
  punches: (landed) => landed.filter((l) => l.what === 'whoops').map((l) => ({ frame: l.frame, percent: 8 })),
});

/** f-chess-lens: the 4D Chess's Lens opening, desktop layout, then closed. */
const chessLens = () => take('f-chess-lens', {
  as: 'Snuckles', seconds: 2.5,
  async prep(cam) {
    await snucklesHoldsWhoops(cam);
    const c = await cam.evaluate(`window.__shot.cast('Snuckles', 7, 'whoops', { color: '#3d77ff' })`);
    assert(c.rode && !c.caught, 'the Whoops! rode on post 7');
    await cam.evaluate(placePost(7, 120));
    await settle(cam, 40);
    await cam.until(`/^4D Chess/.test(${markOf(7)})`, { label: 'the back on post 7 turned over' });
    const m = await midOf(cam, `document.querySelector('#post-7 .kb-mark')`);
    return { x: m.x + 220, y: m.y + 130 };
  },
  async body(d) {
    await d.go(() => d.mid(`document.querySelector('#post-7 .kb-mark')`), 0.25, 16);
    await d.press(0.05);
    await d.when(`Boolean(document.querySelector('.kb-lens'))`, 2, 'the Lens');
    d.mark('lens');
    const side = await d.page(`(() => { const r = document.querySelector('.kb-lens').getBoundingClientRect(); return { w: r.width, vw: innerWidth }; })()`);
    assert(side.w < side.vw * 0.7, `the Lens as a side panel at the desktop layout (${side.w} of ${side.vw})`);
    await d.go(() => d.mid(`document.querySelector('.kb-lens .kb-lens-fold')`), 0.3, 17);
    await d.press(0.05);
    await d.shoot(0.4);
    const lens = await d.page(`document.querySelector('.kb-lens').textContent`);
    assert(/4D Chess/.test(lens) && /Sprang/.test(lens), `the Lens of the 4D Chess, open: ${lens}`);
    d.mark('open');
    await d.until(1.6);
    d.cam.key('Escape');
    await d.until(2.0);
    d.mark('closed');
  },
  move: { rect: { x: 0.55, y: 0.05, w: 0.43, h: 0.8 }, note: 'the Lens side panel' },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* The phrase trap and the forged quote, through the real composer. */

/** Quote pressed on post 2 (by the real pointer, unfilmed) and `typed` keys typed after it. Returns the reply box's text. @param {any} cam @param {string} words @param {(cam: any) => Promise<void>} [cut] */
async function quoteTyped(cam, words, cut) {
  await cam.evaluate(`scrollTo(0, document.documentElement.scrollHeight)`);
  await drawn(cam, 12);
  await cam.evaluate(placePost(2, 40));
  await drawn(cam, 12);
  await hidden(cam, await midOf(cam, `[...document.querySelectorAll('#post-2 button')].find((b) => b.textContent.trim() === 'Quote')`));
  await cam.until(`document.activeElement?.getAttribute('aria-label') === 'Your reply' && document.activeElement.value.startsWith('[quote=')`, { label: 'the reply box holding the quote, focused' });
  if (cut) await cut(cam);
  for (const ch of words) { cam.key(ch); await drawn(cam, 2); }
  return cam.evaluate(`document.activeElement.value`);
}

/** The reply box's Send under the pointer, the page at the thread's foot. @param {any} cam */
async function pointerOnSend(cam) {
  await cam.evaluate(`scrollTo(0, document.documentElement.scrollHeight)`);
  await drawn(cam, 12);
  const send = await midOf(cam, SEND);
  await cam.move(send.x, send.y);
  await drawn(cam, 8);
  return { x: send.x, y: send.y };
}

/** f-phrase: Ringside's real quote of post 2, "to be fair he probably did mean that", posted; the frame on the new post as the Steel Chair is thrown. */
const phrase = () => take('f-phrase', {
  as: 'Ringside', seconds: 5, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) {
    const words = 'to be fair he probably did mean that';
    const box = await quoteTyped(cam, words);
    assert(box.endsWith(`[/quote]\n${words}`), `the reply box holding the real quote and the words: ${JSON.stringify(box)}`);
    return pointerOnSend(cam);
  },
  async body(d) {
    const was = await d.page(`document.querySelectorAll('article.kb-act').length`);
    const seen = await d.page(`new Set([...document.querySelectorAll('article.kb-act')].map((a) => a.id)).size`);
    void seen;
    await d.shoot(0.15);
    d.mark('send');
    await d.press(0.05);
    await d.when(`[...document.querySelectorAll('article.kb-act')].some((a) => Number(a.id.replace('post-', '')) > 20 && /to be fair he probably did mean that/.test(a.innerText) && /quote/i.test(a.innerHTML))`, 3, 'the quoting reply posted and shown');
    const seq = await d.page(`Number([...document.querySelectorAll('article.kb-act')].filter((a) => /to be fair he probably did mean that/.test(a.innerText)).at(-1).id.replace('post-', ''))`);
    void was;
    d.mark('sent');
    /* The frame goes ON the new post, its body clear of the HUD and the view's edges, and stays still for the effect to arm (0.3 s). */
    await d.scrollTo(`(() => { const r = document.querySelector('#post-${seq} .kb-act-main').getBoundingClientRect(); return scrollY + r.top + r.height / 2 - innerHeight / 2 + 10; })()`, 0.35);
    await d.go({ x: 1330, y: 90 }, 0.25, 23, false);
    assert((await d.page(`document.querySelectorAll('#post-${seq} .dw-chair-group').length`)) === 0, 'no chair on the new post before the spring');
    await d.shoot(0.35);
    await d.run(`(async () => { const { fake, thread } = window.__kbStage; const [a] = await fake.acts(thread, ${seq}, ${seq}); return window.__shot.springsOn(2, a.id); })()`);
    await d.when(`document.querySelectorAll('#post-${seq} .dw-chair-group').length > 0`, 3, 'the chair on the new post');
    d.mark('steel-chair');
    await d.when(`document.querySelectorAll('#post-${seq} .dw-chair-dent').length > 0`, 3, 'the chair has hit and dented the post');
    d.mark('dent');
    await d.when(`(() => { const g = [...document.querySelectorAll('#post-${seq} .dw-chair-group')]; return g.length > 0 && g.every((x) => x.hasAttribute('data-rest')); })()`, 4, 'the chair at rest on the post');
    d.mark('rest');
    assert(await d.page(`[...document.querySelectorAll('#post-${seq} .kb-mark')].some((m) => /Steel Chair/.test(m.getAttribute('aria-label') ?? ''))`), 'a Steel Chair mark on the new post');
    assert((await d.page(`document.querySelector('#post-${seq}').textContent`)).includes('to be fair'), '"to be fair" in the post the chair landed on');
  },
  punches: (landed) => landed.filter((l) => l.what === 'dent').map((l) => ({ frame: l.frame, percent: 9 })),
});

/** f-forged: D-Guy's forged quote of Chadluminum, typed in the real composer from the middle of the forged words, and sent: the counterfeit's wobbly border. */
const forged = () => take('f-forged', {
  as: 'Snuckles', seconds: 3.5, quiet: ['toasts', 'host'],
  async prep(cam) {
    /* The mask is D-Guy's: the HUD's select, by the keys a player gives it. */
    await cam.evaluate(`document.querySelector('.kb-hud select').focus()`);
    const opts = await cam.evaluate(`[...document.querySelector('.kb-hud select').options].map((o) => o.textContent)`);
    const here = opts.findIndex((o) => /Snuckles/i.test(o)), there = opts.findIndex((o) => /D-Guy/i.test(o));
    assert(there >= 0, `a D-Guy mask in the HUD's select: ${JSON.stringify(opts)}`);
    for (let i = 0; i < Math.abs(there - here); i++) { cam.key(there > here ? 'ArrowDown' : 'ArrowUp'); await drawn(cam, 8); }
    await cam.until(`/D-Guy/i.test(document.querySelector('.kb-hud select').selectedOptions[0].textContent)`, { label: 'the mask D-Guy' });
    await cam.evaluate(`document.activeElement.blur()`);
    /* The HUD is in frame for the swap and quieted after it (a hidden select takes no keys). */
    await cam.evaluate(`(() => { const s = new CSSStyleSheet(); s.insertRule('.kb-hud-glass { display: none !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; })()`);
    const FORGED = 'are Wiggler Freaks enough to do something about it';
    const box = await quoteTyped(cam, FORGED.slice(0, 22), async (c) => {
      for (let i = 0; i < 9; i++) { c.key('ArrowLeft'); await drawn(c, 2); }
      for (let i = 0; i < 52; i++) { c.key('Backspace'); await drawn(c, 1); }
    });
    assert(/Only a few among us are Wiggler Freaks e\[\/quote\]\n$/.test(box) || box.includes('are Wiggler Freaks e'), `the box mid-typing the forged words: ${JSON.stringify(box)}`);
    return { x: 900, y: 300 };
  },
  async body(d) {
    const FORGED = 'are Wiggler Freaks enough to do something about it';
    const box = () => d.page(`document.activeElement.value`);
    for (const ch of FORGED.slice(22)) await d.key(ch, ch === ' ' ? 0.035 : 0.025);
    d.mark('typed');
    for (let i = 0; i < 9; i++) await d.key('ArrowRight', 0.015);
    for (const ch of 'what did he mean by this') await d.key(ch, ch === ' ' ? 0.035 : 0.025);
    assert((await box()).endsWith(`${FORGED}[/quote]\nwhat did he mean by this`), `the box holding the forged quote and the comment: ${JSON.stringify(await box())}`);
    await d.scrollTo(FOOT, 0.2);
    await d.go(async () => d.mid(SEND), 0.3, 41);
    await d.press(0.05);
    d.mark('sent');
    await d.when(`[...document.querySelectorAll('article.kb-act')].some((a) => Number(a.id.replace('post-', '')) > 20 && /Wiggler Freaks enough/.test(a.innerText))`, 3, 'the forged reply posted and shown');
    const seq = await d.page(`Number([...document.querySelectorAll('article.kb-act')].filter((a) => /Wiggler Freaks enough/.test(a.innerText)).at(-1).id.replace('post-', ''))`);
    assert(await d.page(`/D-Guy/i.test(document.querySelector('#post-${seq} .kb-postbit-name')?.textContent ?? '')`), "the new post is D-Guy's");
    const stored = await d.run(`(async () => { const { fake, thread, acts } = window.__kbStage; const [a] = await fake.acts(thread, ${seq}, ${seq}); return { forged: a.payload.forged ?? [], target: a.targetActId, quoted: acts.chad }; })()`);
    assert(stored.forged.includes(stored.quoted) && stored.target === null, `the stored quote forged, with no target: ${JSON.stringify(stored)}`);
    await d.scrollTo(`(() => { const r = document.querySelector('#post-${seq}').getBoundingClientRect(); return scrollY + r.top + r.height / 2 - innerHeight / 2; })()`, 0.3);
    await d.when(`Boolean(document.querySelector('#post-${seq} .kb-quote[data-kb-counterfeit]'))`, 2, 'the counterfeit quote drawn');
    const look = await d.page(`(() => { const q = document.querySelector('#post-${seq} .kb-quote[data-kb-counterfeit]'); return { link: Boolean(q.querySelector('a[href]')), text: q.textContent }; })()`);
    assert(!look.link && /Wiggler Freaks/.test(look.text), `the counterfeit quote without a post link: ${JSON.stringify(look)}`);
    d.mark('posted');
  },
  punches: (landed) => landed.filter((l) => l.what === 'sent').map((l) => ({ frame: l.frame, percent: 6 })),
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* The heap: ONE script on ONE clock, three framings (post 1, every play on it). */

/** The plays of the heap, in order, each 0.7 s after the last from 0.5 s: three inks, three chairs, the laugh track, Jimmy's banner, Off Day, Hot Box late; Stick Around after. (You Were Saying? is not in the heap.) */
const HEAP = ['whoops-1', 'steel-chair-1', 'whoops-2', 'steel-chair-2', 'whoops-3', 'steel-chair-3', 'laugh-track', 'jimmy-wails', 'off-day', 'hot-box'];
const HEAP_AT = (i) => 0.5 + 0.7 * i;
const STICK_AT = 8.0;
/** The reader's two tries at wheeling away (seconds): after the hold screen is up (about 1.5 s after Stick Around lands). */
const TRIES = [[9.75, 0.7], [10.75, 0.8]];
const kindOf = (step) => step.replace(/-\d$/u, '');

/** In the page: the heap's per-frame step, the same arithmetic for the three framings, a function of the take's time `t`. */
const HEAP_JS = `(() => {
  const abs = (e) => { let x = 0, y = 0; for (; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return { x, y }; };
  let amp = 0, last = 0;
  const lim = (v, m) => Math.max(-m, Math.min(m, v));
  window.__film = {
    lay() { const post = document.querySelector('#post-1'), body = post.querySelector('.kb-act-main'), p = abs(post), b = abs(body); return { top: p.y, h: post.offsetHeight, bx: b.x, by: b.y, bw: body.offsetWidth, bh: body.offsetHeight }; },
    step(mode, t, landings, scripted, bumps) {
      const L = this.lay();
      if (scripted) document.scrollingElement.scrollTop = L.top - 4 + Math.max(0, L.h - 590) * 0.35;
      if (mode === 'wide') return;
      if (mode === 'tight') {
        const s = 1.4, cx = L.bx + L.bw / 2, cy = L.by + L.bh / 2 - scrollY;
        window.__shot.turn({ scale: s, x: -s * (cx - innerWidth / 2), y: -s * (cy - innerHeight / 2) });
        return;
      }
      /* turned: swung hard and fast, further with each landing, and big whips; no axis past 66 degrees, so the board never shows its back or goes edge-on. */
      const dt = Math.max(0, t - last); last = t;
      amp += (landings / 10 - amp) * (1 - Math.exp(-dt / 0.45));
      const tau = Math.PI * 2;
      const ry = lim((16 + 30 * amp) * Math.sin(tau * t / 1.7 + 0.9) + 14 * Math.sin(tau * t / 0.74) + 40 * bumps, 66);
      const rx = lim(5 + 14 * amp * Math.sin(tau * t / 2.3 + 0.3), 24);
      const rz = lim(2 + 9 * amp * Math.sin(tau * t / 1.3), 14);
      window.__film.worst = Math.max(window.__film.worst ?? 0, Math.abs(rx), Math.abs(ry), Math.abs(rz));
      window.__shot.turn({ rx, ry, rz, scale: 0.8 });
    },
  };
})()`;
/** 0 outside [a, b], a smooth bump up to 1 and back to 0 inside. */
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)) ** 2);

const heap = (framing) => take(`f-heap-${framing}`, {
  as: 'Ringside', seconds: 12, fps: framing === 'turned' ? 240 : 60,
  quiet: framing === 'tight' ? ['toasts', 'host', 'hud', 'selection'] : ['toasts', 'host', 'selection'],
  async prep(cam) {
    const steps = await cam.evaluate('window.__shot.pileSteps');
    for (const s of HEAP) assert(steps.includes(s), `the pile has the step ${s}`);
    assert(steps.includes('stick-around'), 'the pile has Stick Around');
    /* The Rope Break set on post 1 is sprung first, unfilmed, by a real cast, so the plays that follow land as the rules let them. */
    const c = await cam.evaluate(`window.__shot.cast('Hotel Bro', 1, 'whoops', { color: '#3d77ff' })`);
    assert(c.caught, 'the Rope Break caught the first Whoops!');
    await cam.evaluate(HEAP_JS);
    await cam.evaluate(`window.__film.step('wide', 0, 0, true, 0)`);
    await settle(cam, 40);
    return { x: Math.round(DESKTOP.width * 0.6), y: Math.round(DESKTOP.height * 0.45) };
  },
  async body(d) {
    const steps = await d.page('window.__shot.pileSteps');
    const plays = [...HEAP.map((s, i) => ({ step: s, at: HEAP_AT(i) })), { step: 'stick-around', at: STICK_AT }];
    let next = 0, landings = 0;
    const wheels = TRIES.flatMap(([from, len], n) => Array.from({ length: Math.round(len / 0.033) }, (_, i) => ({ at: from + i * 0.033, dy: 110 + 60 * n, done: false })));
    d.each = async (dd) => {
      while (next < plays.length && dd.t >= plays[next].at) {
        const { step } = plays[next++];
        await dd.page(`window.__shot.pile(${steps.indexOf(step)})`);
        if (step !== 'stick-around') landings++;
        dd.mark(kindOf(step));
      }
      for (const w of wheels) if (!w.done && dd.t >= w.at) { w.done = true; await dd.cam.wheel(w.dy); }
      await dd.page(`window.__film.step(${JSON.stringify(framing)}, ${dd.t}, ${landings}, ${dd.t < STICK_AT + 1.0}, ${framing === 'turned' ? bump(dd.t, 3.1, 3.75) + bump(dd.t, 6.6, 7.1) - bump(dd.t, 8.9, 9.4) : 0})`);
    };
    await d.until(7.7);
    const inks = await d.page(`document.querySelectorAll('#post-1 canvas.kb-whoops-ink').length`);
    const chairs = await d.page(`document.querySelectorAll('#post-1 .dw-chair-group').length`);
    console.log(`${framing}: on post 1 before Stick Around: ${inks} ink canvases, ${chairs} chairs`);
    assert(inks >= 3 && chairs >= 2, `the coats of ink and the chairs on post 1 before Stick Around (${inks} canvases, ${chairs} chairs)`);
    await d.until(12);
    assert(next === plays.length, 'every play of the heap landed');
    const held = await d.page(`Boolean(document.querySelector('.kb-hold-foot [role="progressbar"][aria-label="Break free"]'))`);
    assert(held, 'the reader held by Stick Around: the hold screen is on the page');
    if (framing === 'turned') {
      const worst = await d.page('window.__film.worst');
      assert(worst <= 70, `the board turned ${worst} degrees on one axis at most (under 70)`);
      console.log(`f-heap-turned: the board's largest turn on any axis was ${worst.toFixed(1)} degrees`);
    }
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Fast camera tracking: the page whipped from post to post, stopped dead on an effect as it happens (240 fps, blended). */

/** Where the page must be scrolled to put post `seq`'s top `top` px down the view. */
const postTop = (seq, top) => `(() => { const r = document.querySelector('#post-${seq}').getBoundingClientRect(); return scrollY + r.top - ${top}; })()`;
/** Hot Box's mean fog alpha over the smoke's own tiles on a post: 0 clear, 1 thick. */
const fogOf = (seq) => `(() => { let sum = 0, n = 0; for (const c of document.querySelectorAll('#post-${seq} canvas.dw-hotbox-smoke')) { const b = c.getBoundingClientRect(); if (b.bottom < 0 || b.top > innerHeight) continue; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4 * 9) { sum += d[i] / 255; n++; } } return n ? sum / n : null; })()`;

/** f-track-1: post 2 to the smoke on post 8, dead stop, the smoke waved away. */
const track1 = () => take('f-track-1', {
  as: 'Ringside', fps: 240, seconds: 3, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) {
    /* The smoke is drawn while its post is near the view: it is built first, then the page goes back to post 2. */
    await cam.evaluate(placePost(8, 60));
    await settle(cam, 90);
    await cam.until(`document.querySelectorAll('#post-8 canvas.dw-hotbox-smoke').length > 0`, { label: 'the smoke drawn' });
    await settle(cam, 60);
    await cam.evaluate(placePost(2, 60));
    await settle(cam, 30);
    return { x: 720, y: 500 };
  },
  async body(d) {
    await d.shoot(0.1);
    d.mark('whip');
    await d.whip(postTop(8, 50), 0.42, 0.02);
    d.mark('stop');
    await d.until(0.65);
    const words = await d.mid(`document.querySelector('#post-8 .dw-hotbox-words')`);
    assert(words, 'the words under the smoke on post 8');
    const before = await d.page(fogOf(8));
    assert(before > 0.4, `smoke over post 8 at the stop (${before})`);
    d.mark('smoke');
    /* The pointer waves across the smoke, two passes. */
    for (const [i, dir] of [1, -1].entries()) {
      const x0 = words.x - dir * words.w * 0.42, x1 = words.x + dir * words.w * 0.42, y = words.y - words.h * 0.2 + i * 40;
      await d.go({ x: x0, y }, 0.12, 60 + i, false);
      const n = Math.round(0.5 * d.F);
      for (let k = 0; k <= n; k++) { const u = k / n; await d.put(x0 + (x1 - x0) * u, y + 18 * Math.sin(u * 9)); await d.one(); }
    }
    const after = await d.page(fogOf(8));
    assert(after < before - 0.05, `the smoke parted where the hand went (${before} to ${after})`);
    d.mark('cleared');
  },
});

/** f-track-2: post 8 to the graffiti wall on post 11, dead stop, a tag drawn on it. */
const track2 = () => take('f-track-2', {
  as: 'Ringside', fps: 240, seconds: 3, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) {
    /* The wall's drawing dock is opened first by the real pointer (unfilmed), so the film is the tag. */
    await cam.evaluate(placePost(11, 70));
    await settle(cam, 60);
    const tile = await midOf(cam, `[...document.querySelectorAll('#post-11 button')].find((e) => e.textContent.trim() === 'Draw')`);
    assert(tile, "the wall's Draw tile");
    await hidden(cam, tile);
    await cam.until(`Boolean(document.querySelector('.kb-graffiti-dock')) && Boolean(document.querySelector('#post-11 [data-kb-draw-surface]'))`, { label: 'the drawing dock open' });
    await settle(cam, 30);
    await cam.evaluate(placePost(8, 60));
    await settle(cam, 30);
    return { x: 700, y: 450 };
  },
  async body(d) {
    const { word, arrow } = await import(`file://${process.cwd()}/instances/divided-world/ui/hype/graffiti-shapes.ts`);
    await d.shoot(0.1);
    d.mark('whip');
    await d.whip(postTop(11, 60), 0.42, 0.02);
    d.mark('stop');
    await d.until(0.6);
    const surface = await d.mid(`document.querySelector('#post-11 [data-kb-draw-surface]')`);
    assert(surface, "the wall's drawing surface at the stop");
    const box = await d.page(`(() => { const r = document.querySelector('#post-11 [data-kb-draw-surface]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const aspect = box.w / box.h;
    const before = Number(await d.page(`document.querySelector('#post-11 [data-kb-draw-surface]').getAttribute('data-kb-strokes')`));
    d.mark('tag');
    /* The short word is drawn fast and marked `word` when its last stroke is done, so the edit's second after the stop holds all of LAST. */
    for (const [shapeAt, shape] of [word('LAST', 0.08, 0.5, 0.3, 'red', aspect), arrow(0.6, 0.62, 0.8, 0.3, 'red', aspect)].entries()) {
      for (const s of shape.strokes) {
        const pts = s.points.map(([x, y]) => ({ x: box.x + x * box.w, y: box.y + y * box.h }));
        await d.go(pts[0], 0.04, 70, false);
        await d.cam.press();
        const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y)), total = lens.reduce((a, b) => a + b, 0), secs = Math.max(0.08, total / 3600);
        const n = Math.round(secs * d.F);
        for (let k = 1; k <= n; k++) {
          let want = (k / n) * total, i = 0;
          while (i < lens.length - 1 && want > lens[i]) { want -= lens[i]; i++; }
          const u = lens[i] > 0 ? Math.min(1, want / lens[i]) : 1;
          await d.put(pts[i].x + (pts[i + 1].x - pts[i].x) * u, pts[i].y + (pts[i + 1].y - pts[i].y) * u);
          await d.one();
        }
        await d.cam.release();
        await d.shoot(0.02);
      }
      if (shapeAt === 0) d.mark('word');
    }
    const after = Number(await d.page(`document.querySelector('#post-11 [data-kb-draw-surface]').getAttribute('data-kb-strokes')`));
    assert(after > before, `strokes drawn on the wall (${before} to ${after})`);
    d.mark('drawn');
  },
});

/** f-track-3: the wall on post 11 to Hotel Bro's post 7, dead stop, a tomato lands on it. */
const track3 = () => take('f-track-3', {
  as: 'Ringside', fps: 240, seconds: 3, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) { await cam.evaluate(placePost(11, 60)); await settle(cam, 60); return { x: 760, y: 420 }; },
  async body(d) {
    await d.shoot(0.1);
    d.mark('whip');
    await d.whip(postTop(7, 60), 0.4, 0.02);
    d.mark('stop');
    await d.until(0.55);
    const before = await d.page(`document.querySelector('#post-7').innerText`);
    await d.run(`window.__shot.react('Front Row', 7, 'tomato')`);
    d.mark('tomato');
    await d.until(1.6);
    const after = await d.page(`document.querySelector('#post-7').innerText`);
    assert(after !== before, 'post 7 changed when the tomato landed');
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* Close-ups in Hot Rod: one effect each, large in frame, a real pointer handling it. */

const CLOSEUP = (w) => ({ css: { width: w, height: Math.round(w * 9 / 16) }, scale: SIZE.width / w });

/** The ink on any post: each coat's canvas alpha sampled on a grid, summed. */
const COVER = `(() => { let sum = 0; for (const c of document.querySelectorAll('[id^="post-"] canvas.kb-whoops-ink')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4 * 37) sum += d[i] / 255; } return sum; })()`;
const BUILT_1 = `(() => { const el = document.querySelector('#post-1 .kb-whoops'); if (!el) return false; const bands = (el.getAttribute('data-kb-bands') ?? '').split(' ').filter(Boolean).length; const live = (el.getAttribute('data-kb-layers') ?? '').split(' ').filter((l) => l === 'live').length; return bands > 0 && Number(el.getAttribute('data-kb-pictures')) === live * bands; })()`;
const COATS = [['D-Guy', '#ff2bd6', 101, 'classy'], ['Serious Deer', '#19e3ff', 202, 'eleven colors'], ['Chadluminum', '#ffd93d', 303, 'with love'], ['D-Guy', '#7dff3a', 404, 'room for one more']];
const landCoat = (n) => `window.__shot.splat(${n}, '${COATS[n - 1][0]}', '${COATS[n - 1][1]}', ${COATS[n - 1][2]}, '${COATS[n - 1][3]}')`;

/** f-scrub: a frantic hand scrubbing ink off post 1, ending as a fresh coat lands (2.5 s). */
const scrub = () => take('f-scrub', {
  as: 'Snuckles', ...CLOSEUP(1120), seconds: 2.5, quiet: ['toasts', 'host', 'hud', 'selection'],
  async prep(cam) {
    await cam.evaluate(`window.__shot.aim(1, window.__kbStage.acts.first)`);
    await cam.evaluate('window.__shot.place(16)');
    for (let n = 1; n <= 3; n++) await cam.evaluate(landCoat(n));
    await settle(cam, 60);
    await cam.until(BUILT_1, { label: 'the coats built on post 1' });
    await settle(cam, 30);
    await cam.evaluate('window.__shot.place(16)');
    await settle(cam, 20);
    return { x: CLOSEUP(1120).css.width + 30, y: 500 };
  },
  async body(d) {
    const { buzz } = await import('./pointer.mjs');
    const box = await d.page('window.__shot.body()');
    const start = await d.page(COVER);
    const hand = buzz({ box: { x: box.x - 60, y: box.y - 36, w: box.w + 120, h: box.h + 72 }, seed: 123, from: { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 }, energy: 1 });
    let down = false, map = null, aim = 0, landedAt = null, before = 0;
    await d.put(box.x + box.w * 0.3, box.y + box.h * 0.4);
    d.each = async (dd) => {
      const t = dd.t;
      if (dd.F * t % 15 < 1 || map === null) {
        map = await dd.page('window.__shot.ink()');
        const high = Math.max(...map.top);
        if (high >= 0 && t > aim) {
          const cells = map.top.flatMap((l, i) => (l === high && map.thick[i] > 0.3 ? [i] : []));
          if (cells.length) { const c = cells[Math.floor(Math.random() * 0 + (cells.length / 2))]; hand.seek({ x: box.x + ((c % map.cols) + 0.5) * (box.w / map.cols), y: box.y + (Math.floor(c / map.cols) + 0.5) * (box.h / map.rows) }); aim = t + 0.4; }
        }
      }
      if (landedAt === null && t >= 1.7) {
        before = await dd.page(COVER);
        assert(before < start * 0.99, `the ink's cover fell under the hand (${start.toFixed(0)} to ${before.toFixed(0)})`);
        await dd.page(landCoat(4));
        landedAt = t; dd.mark('splat');
      }
      for (let half = 0; half < 2; half++) {
        const p = hand.step(0.5 / dd.F);
        await dd.put(p.x, p.y);
        const ink = await dd.page(`window.__shot.inkAt(${p.x}, ${p.y})`);
        if (down && !ink) { await dd.cam.release(); down = false; } else if (!down && ink) { await dd.cam.press(); down = true; }
      }
    };
    await d.until(2.5);
    if (down) await d.cam.release();
    const after = await d.page(COVER);
    assert(after > before * 1.02, `a fresh coat landed over the scrubbed ink (${before.toFixed(0)} to ${after.toFixed(0)})`);
    console.log(`f-scrub: cover ${start.toFixed(0)} -> ${before.toFixed(0)} -> ${after.toFixed(0)}`);
  },
  punches: (landed) => landed.filter((l) => l.what === 'splat').map((l) => ({ frame: l.frame, percent: 7 })),
});

/** f-smoke: Hot Box on post 8, waved (2.5 s). */
const smoke = () => take('f-smoke', {
  as: 'Ringside', ...CLOSEUP(576), seconds: 2.5, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) { await cam.evaluate(placePost(8, 60)); await settle(cam, 90); await cam.until(`document.querySelectorAll('#post-8 canvas.dw-hotbox-smoke').length > 0`, { label: 'the smoke drawn' }); await settle(cam, 90); return { x: 620, y: 200 }; },
  async body(d) {
    const words = await d.mid(`document.querySelector('#post-8 .dw-hotbox-words')`);
    assert(words, 'the words under the smoke on post 8');
    const before = await d.page(fogOf(8));
    assert(before > 0.4, `smoke over post 8 (${before})`);
    d.mark('smoke');
    const lines = Math.max(2, Math.round(words.h / (await d.page(`parseFloat(getComputedStyle(document.querySelector('#post-8 .dw-hotbox-words')).lineHeight) || 20`))));
    const lineH = words.h / lines;
    const left = words.x - words.w / 2, y = (i) => words.y - words.h / 2 + (i + 0.5) * lineH;
    await d.go({ x: left + 8, y: y(0) }, 0.2, 4, false);
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 === 0 ? 1 : -1, from = dir > 0 ? left + 6 : left + words.w - 6, span = words.w - 12, secs = 0.5;
      const n = Math.round(secs * d.F);
      for (let k = 0; k <= n; k++) { const u = k / n; await d.put(from + dir * span * u, y(Math.min(i, lines - 1)) + 2.5 * Math.sin(u * 14)); await d.one(); }
      if (i === 0) { assert((await d.page(fogOf(8))) < before - 0.08, 'the fog fell where the hand went'); d.mark('cleared'); }
      await d.go({ x: d.at.x, y: y(Math.min(i + 1, lines - 1)) }, 0.1, 20 + i, false);
    }
  },
});

/** f-tag: the wall on post 11 tagged live by a reader (2.5 s): the Draw tile, strokes drawn fast, Tag it. */
const tag = () => take('f-tag', {
  as: 'Ringside', ...CLOSEUP(1008), seconds: 2.5, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) { await cam.evaluate(`document.querySelector('#post-11').scrollIntoView({ block: 'start' })`); await settle(cam, 90); const tile = await midOf(cam, `[...document.querySelectorAll('#post-11 button')].find((e) => e.textContent.trim() === 'Draw')`); return { x: tile.x + 160, y: tile.y + 120 }; },
  async body(d) {
    const { heart, word } = await import(`file://${process.cwd()}/instances/divided-world/ui/hype/graffiti-shapes.ts`);
    const tile = await d.mid(`[...document.querySelectorAll('#post-11 button')].find((e) => e.textContent.trim() === 'Draw')`);
    await d.go(tile, 0.25, 6, false);
    d.mark('draw');
    await d.press(0.05);
    await d.when(`Boolean(document.querySelector('.kb-graffiti-dock')) && Boolean(document.querySelector('#post-11 [data-kb-draw-surface]'))`, 2, 'the drawing dock open');
    d.mark('dock');
    const box = await d.page(`(() => { const r = document.querySelector('#post-11 [data-kb-draw-surface]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const aspect = box.w / box.h;
    let strokes = 0;
    for (const { can, shape } of [{ can: 'blue', shape: word('LAST', 0.05, 0.5, 0.3, 'blue', aspect) }, { can: 'pink', shape: heart(0.9, 0.62, 0.22, 'pink', aspect) }]) {
      const radio = await d.mid(`document.querySelector('.kb-graffiti-dock [role="radio"][aria-label="${can[0].toUpperCase() + can.slice(1)}"]')`);
      await d.go(radio, 0.12, 30 + strokes, false);
      await d.press(0.04);
      for (const s of shape.strokes) {
        const pts = s.points.map(([x, y]) => ({ x: box.x + x * box.w, y: box.y + y * box.h }));
        await d.go(pts[0], 0.06, 50 + strokes, false);
        await d.cam.press();
        const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y)), total = lens.reduce((a, b) => a + b, 0), n = Math.max(5, Math.round(total / 3600 * d.F));
        for (let k = 1; k <= n; k++) {
          let want = (k / n) * total, i = 0;
          while (i < lens.length - 1 && want > lens[i]) { want -= lens[i]; i++; }
          const u = lens[i] > 0 ? Math.min(1, want / lens[i]) : 1;
          await d.put(pts[i].x + (pts[i + 1].x - pts[i].x) * u, pts[i].y + (pts[i + 1].y - pts[i].y) * u);
          await d.one();
        }
        await d.cam.release();
        strokes++;
      }
      d.mark(`drawn:${can}`);
    }
    assert(Number(await d.page(`document.querySelector('#post-11 [data-kb-draw-surface]').getAttribute('data-kb-strokes')`)) === strokes, `the surface holds all ${strokes} strokes`);
    const tagIt = await d.mid(`[...document.querySelectorAll('.kb-graffiti-dock button')].find((e) => /Tag it/i.test(e.textContent))`);
    await d.go(tagIt, 0.15, 77, false);
    await d.press(0.04);
    await d.when(`!document.querySelector('.kb-graffiti-dock')`, 2, 'the tag saved (the dock closed)');
    d.mark('tagged');
  },
});

/** f-hold: Stick Around's Break free bar fought by the reader's wheel, desktop layout (2.5 s). */
const HOLD = `[role="dialog"][aria-label="Stick Around"]:not([data-kb-exiting])`;
const LEVEL = `(() => { const f = document.querySelector('${HOLD} .kb-hold-fill'), t = document.querySelector('${HOLD} .kb-hold-track'); return f && t ? f.getBoundingClientRect().width / t.getBoundingClientRect().width : -1; })()`;
const hold = () => take('f-hold', {
  as: 'Ringside', seconds: 2.5, quiet: ['toasts', 'host'],
  async prep(cam) {
    await cam.evaluate(`document.querySelector('#post-9').scrollIntoView({ block: 'center' })`);
    await settle(cam, 40);
    await cam.move(720, 275);
    await cam.evaluate(`(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, 9, 9).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast['Hotel Bro'], a.id, 'stick-around', { live: true, layer: 1, message: 'required reading', config: { sentence: 'I have read all nine parts and I feel changed.' } }); }); })()`);
    await cam.until(`Boolean(document.querySelector('${HOLD}'))`, { label: 'the Stick Around view taking the reader' });
    await settle(cam, 60);
    /* The reader has read to the end of the held post (the wheel, unfilmed): only a push past the end counts against the bar. */
    const atEnd = `(() => { const s = document.querySelector('${HOLD} [role="region"]'); return s ? s.scrollHeight - s.clientHeight - s.scrollTop < 2 : false; })()`;
    for (let i = 0; i < 40 && !(await cam.evaluate(atEnd)); i++) { await cam.wheel(60); await drawn(cam, 2); }
    await drawn(cam, 10);
    return { x: 720, y: 500 };
  },
  async body(d) {
    assert(await d.page(`Boolean(document.querySelector('${HOLD}'))`), 'the reader held');
    assert((await d.page(`(document.querySelector('${HOLD}')?.innerText ?? '')`)).length > 40, "the held view showing the post's words");
    d.mark('held');
    let peak = 0;
    for (let n = 0; n < 2; n++) {
      for (let i = 0; i < 14; i++) { await d.cam.wheel(160 + 60 * n); await d.shoot(0.03); peak = Math.max(peak, await d.page(LEVEL)); if (i === 0) d.mark(`push-${n + 1}`); }
      const hi = await d.page(LEVEL);
      assert(hi > 0.1, `the Break free bar climbed under push ${n + 1} (${hi})`);
      await d.shoot(n === 0 ? 0.35 : 0.2);
      if (n === 0) { assert((await d.page(LEVEL)) < hi - 0.03, 'the bar fell back once the wheel stopped'); d.mark('fell-back'); }
    }
    console.log('f-hold: peak', peak);
    assert(await d.page(`Boolean(document.querySelector('${HOLD}'))`), 'the reader is still held at the end');
  },
});

/** f-chair: a Steel Chair thrown at post 4, hit, bounce, rest, with the words bending (2.5 s). */
const chair = () => take('f-chair', {
  as: 'Ringside', ...CLOSEUP(960), seconds: 2.5, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) {
    await cam.evaluate(placeBody(4, 40));
    await cam.evaluate(centerPost(4, 0));
    /* The throw's seed is the reader's own (crypto.getRandomValues): a seeded stand-in makes a take repeatable. */
    await cam.evaluate(`(() => { let a = ${Number(flag('seed', 1))} * 2654435761 >>> 0; crypto.getRandomValues = (arr) => { for (let i = 0; i < arr.length; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); arr[i] = (t ^ (t >>> 14)) >>> 0; } return arr; }; return 1; })()`);
    await settle(cam, 80);
    return { x: 990, y: 560 };
  },
  async body(d) {
    assert((await d.page(`document.querySelectorAll('#post-4 .dw-chair-group').length`)) === 0, 'no chair on the post before the take');
    await d.shoot(0.05);
    console.log('f-chair: the play', await d.run(`(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, 4, 4).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast['D-Guy'], a.id, 'steel-chair', { layer: 1, message: '', live: true, ends: new Date(Date.now() + 3 * 86400000).toISOString() }); }); })()`));
    const seen = { throw: false, hit: false };
    d.each = async (dd) => {
      if (!seen.throw && (await dd.page(`document.querySelectorAll('#post-4 .dw-chair-group').length`)) > 0) { seen.throw = true; dd.mark('throw'); }
      if (!seen.hit && (await dd.page(`document.querySelectorAll('#post-4 .dw-chair-dent').length`)) > 0) { seen.hit = true; dd.mark('hit'); }
    };
    await d.until(2.45);
    const rest = await d.page(`[...document.querySelectorAll('#post-4 .dw-chair-group')].every((g) => g.hasAttribute('data-rest'))`);
    if (rest) d.mark('rest');
    assert(seen.throw && seen.hit, 'a chair thrown and a dent made');
    console.log(`f-chair: beats ${JSON.stringify(seen)}, at rest by the end: ${rest}`);
  },
  punches: (landed) => landed.filter((l) => l.what === 'hit').map((l) => ({ frame: l.frame, percent: 9 })),
});

/** f-peel: the autocorrect strip on post 12 rolled back and torn, twice (2.5 s). */
const STUCK = `(() => { const p = document.querySelector('#post-12 [data-kb-ac-piece]'); return p ? p.getAttribute('data-kb-ac-stuck') : null; })()`;
const stretches = (/** @type {string | null} */ s) => (s ? s.split(',').map((x) => x.split('-').map(Number)) : []);
const peel = () => take('f-peel', {
  as: 'Concessions', ...CLOSEUP(448), seconds: 3.6, quiet: ['toasts', 'host', 'hud'],
  async prep(cam) {
    await cam.evaluate(placeBody(12, 60)); await settle(cam, 90);
    const r = await midOf(cam, `document.querySelector('#post-12 [data-kb-ac-piece]')`);
    return { x: r.left + 30, y: r.y + 26 };
  },
  async body(d) {
    const piece = await d.page(`(() => { const r = document.querySelector('#post-12 [data-kb-ac-piece]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cy: r.top + r.height / 2 }; })()`);
    const before = stretches(await d.page(STUCK));
    assert(before.length === 1 && before[0][1] - before[0][0] > 100, 'one whole strip stuck');
    let width = before[0][1] - before[0][0];
    for (const [n, side] of ['a', 'b'].entries()) {
      const s = stretches(await d.page(STUCK))[0], edge = piece.x + (side === 'a' ? s[0] : s[1]), grip = side === 'a' ? edge + 4 : edge - 4, y = piece.cy, dir = side === 'a' ? 1 : -1;
      await d.go({ x: grip, y }, n === 0 ? 0.14 : 0.2, 5 + n, false);
      await d.cam.press();
      await d.when(`Boolean(document.querySelector('#post-12 [data-kb-ac-roll="live"]'))`, 2, 'the pick up (a live roll)');
      d.mark('pick');
      const from = grip;
      for (let k = 0; k <= Math.round(0.12 * d.F); k++) { await d.put(from + dir * 70 * (k / d.F), y + 1.5 * Math.sin(k)); await d.one(); }
      const p0 = d.at.x;
      for (let k = 0; k <= Math.round(0.3 * d.F); k++) { await d.put(p0 + dir * Math.min(165, 900 * (k / d.F)), y - 4 * (k / d.F)); await d.one(); }
      await d.when(`!document.querySelector('#post-12 [data-kb-ac-roll]') && ${STUCK} !== null`, 1.2, 'the tape torn (its roll let fall)');
      d.mark('tear');
      await d.cam.release();
      const torn = stretches(await d.page(STUCK))[0];
      assert(torn[1] - torn[0] < width - 8, `tear ${n + 1} left the strip shorter (${width} to ${torn[1] - torn[0]})`);
      width = torn[1] - torn[0];
    }
  },
  punches: (landed) => landed.filter((l) => l.what === 'tear').map((l) => ({ frame: l.frame, percent: 6 })),
});

const TAKES = {
  'f-caught': caught,
  'f-forged': forged, 'f-phrase': phrase,
  'f-heap-wide': () => heap('wide'), 'f-heap-tight': () => heap('tight'), 'f-heap-turned': () => heap('turned'),
  'f-track-1': track1, 'f-track-2': track2, 'f-track-3': track3,
  'f-peel': peel, 'f-scrub': scrub, 'f-smoke': smoke, 'f-tag': tag, 'f-hold': hold, 'f-chair': chair,
 'f-thrown': thrown, 'f-chess-lens': chessLens,
  'f-leave-1': () => leaveTake(1), 'f-leave-2': () => leaveTake(2), 'f-leave-3': () => leaveTake(3), 'f-leave-4': () => leaveTake(4), 'f-leave-5': () => leaveTake(5),
  'f-leave-all': leaveAll,
  'f-fold': fold,
  'f-gpt2': gpt2,
};
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);
for (const [name, run] of Object.entries(TAKES)) if (only === null || only === name) await run();
