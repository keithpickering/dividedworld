/**
 * The commentary video's close-ups (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R6): the film's B-roll. One effect each,
 * LARGE in frame, a real pointer handling it. Round 1's scrub is the model of a hand that is not a function (tools/hype/shot-scrub.mjs).
 *
 *   node tools/hype/shot-closeups.mjs [--only b-autocorrect-peel|b-scrub-1|...] [--port 4319]
 *
 * Every take is filmed at 2880 x 1620, 60 frames a second, on the page's virtual clock, the stage drawn at a small CSS viewport at a high
 * density, as a person who has zoomed their browser in sees it: the effect's own pointer math is the real one, only everything is larger.
 * Each is a few seconds, the interesting motion early, nothing held for words to be read. Beside each take is `<take>.json`
 * (`landed`: every beat and its frame, for the edit), and every "asserts" below reads the page and throws when the picture is not the rule.
 *
 *   b-autocorrect-peel   the post's AUTHOR picks the strip of tape at its end, rolls it back, and tears it, three times
 *   b-scrub-1..3         Whoops! ink on a post, scrubbed: calm; faster, wider, missing; frantic, then a fresh coat lands
 *   b-gpt2               You Were Saying? and its real tail typing in under the post
 *   b-smoke-wave         Hot Box: the pointer waves the smoke away, and it rolls back in
 *   b-graffiti-tag       the Graffiti wall, drawn on live by a reader
 *   b-stick-around       a reader held on a post, the wheel against the Break Free bar
 *   b-glitter-drag       the Glitter Bomb's glitter, dragged along
 *   b-chair              Steel Chairs thrown at a post, in the Midnight skin
 *   b-react              the React picker, and its stamp
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { openCamera, openFilm } from './camera.mjs';
import { buzz, glide, seeded } from './pointer.mjs';
import { BUILT, OUT, flag, openStage, settle } from './stage.mjs';

const only = flag('only', null);
const port = Number(flag('port', 4319));
const SIZE = { width: 2880, height: 1620 };

/** Throws with `what` when `ok` is not so: the picture is the rule, not a staging of it. @param {unknown} ok @param {string} what */
function assert(ok, what) { if (!ok) throw new Error(`the page does not show: ${what}`); }

/**
 * Opens the stage for a take and hands over what every take does: a film, the pointer's moves, waits and the take's notes.
 * `body(d)` is the take; it runs on the film's clock. `css` and `scale` are the zoom: css x scale is the frame.
 * @param {string} id
 * @param {{ story?: string | null, as?: string, skin?: string, css?: { width: number, height: number }, quiet?: string[], prep?: (cam: any) => Promise<void>, body: (d: any) => Promise<void> }} spec
 */
async function take(id, { as, skin = 'default', css = { width: 576, height: 324 }, quiet = ['toasts', 'host', 'hud'], story = null, prep, body }) {
  if (only && only !== id) return;
  const scale = SIZE.width / css.width;
  const cam = story ? await openCamera({ url: `http://localhost:${port}/?fixture=boards&story=${story}`, css, scale }) : await openStage({ as, skin, css, scale, port, quiet });
  try {
    if (story) await cam.until(`document.querySelectorAll('button').length > 3`, { label: 'the story drawn' });
    if (prep) await prep(cam);
    await cam.drawPointer();
    await settle(cam, 60);
    const F = cam.fps;
    const film = openFilm({ path: `${OUT}/${id}.mp4`, fps: F, out: SIZE, preset: 'veryfast' });
    console.log(`${id}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    if (!story) await cam.evaluate('window.__shot.zero()');
    let frame = 0, at = { x: css.width + 40, y: css.height * 0.7 };
    /** @type {{ what: string, frame: number }[]} */
    const landed = [];
    const d = {
      cam, F, css,
      get frame() { return frame; },
      get at() { return at; },
      page: (/** @type {string} */ js) => cam.evaluate(js),
      /** The box of the first element `find` (an expression) gives, in CSS px, or null. */
      box: (/** @type {string} */ find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`),
      mark: (/** @type {string} */ what) => { landed.push({ what, frame }); console.log(`${id}: ${what} at frame ${frame}`); },
      async frameOnce() { await film.write(await cam.frame(true)); frame++; },
      async shoot(/** @type {number} */ seconds) { for (let i = 0, n = Math.round(seconds * F); i < n; i++) await d.frameOnce(); },
      /** Frames until `expression` is true on the page, or throws after `max` seconds. */
      async until(/** @type {string} */ expression, max = 8, label = expression) {
        for (let i = 0; i < max * F; i++) { if (await cam.evaluate(expression)) return; await d.frameOnce(); }
        throw new Error(`${id}: the page never came to: ${label}`);
      },
      /** The pointer to (x, y) at once, for the frame. */
      async put(/** @type {number} */ x, /** @type {number} */ y) { at = { x, y }; await cam.move(x, y); },
      /** The pointer's hand-like move to a point (or one a function gives), a frame at a time. */
      async go(/** @type {{ x: number, y: number } | (() => Promise<{ x: number, y: number }>)} */ to, seconds = 0.6, seed = 3, settleOn = true) {
        const aim = typeof to === 'function' ? to : async () => to;
        const from = at, first = await aim();
        const path = glide(from, first, seconds, { seed, settle: settleOn });
        for (let i = 0, n = Math.max(1, Math.round(seconds * F)); i <= n; i++) {
          const p = path.at(i / F), now = await aim(), u = i / n;
          await d.put(p.x + (now.x - first.x) * u, p.y + (now.y - first.y) * u);
          await d.frameOnce();
        }
        return at;
      },
      /** The pointer along `path(t)` (seconds from the start of the move) for `seconds`, a frame at a time; `each(t)` runs before each frame. */
      async drag(/** @type {(t: number) => { x: number, y: number }} */ path, /** @type {number} */ seconds, /** @type {((t: number) => Promise<void> | void) | undefined} */ each) {
        for (let i = 0, n = Math.round(seconds * F); i < n; i++) {
          const t = i / F, p = path(t);
          await d.put(p.x, p.y);
          if (each) await each(t);
          await d.frameOnce();
        }
      },
      async press() { await cam.press(); await d.frameOnce(); },
      async release() { await cam.release(); await d.frameOnce(); },
      async tap() { await cam.press(); await d.shoot(0.07); await cam.release(); await d.shoot(0.1); },
      async wheel(/** @type {number} */ dy, frames = 3) { await cam.wheel(dy); await d.shoot(frames / F); },
    };
    await body(d);
    await film.end();
    writeFileSync(`${OUT}/${id}.json`, `${JSON.stringify({ landed, move: null, punches: landed.filter((l) => l.what === 'tear' || l.what === 'splat').map((l) => ({ frame: l.frame, percent: 6 })) }, null, 2)}\n`);
    console.log(`${id}: ${frame} frames, ${(frame / F).toFixed(1)} s, ${SIZE.width}x${SIZE.height}; errors:`, cam.errors);
    if (cam.errors.length) throw new Error(`${id}: the page raised ${cam.errors.join('; ')}`);
  } finally {
    await cam.close();
  }
}

/** The post `seq` brought to centre of the view, then its body's top to `top` CSS px. */
const placePost = (seq, top) => `(() => { const p = document.querySelector('#post-${seq}'); p.scrollIntoView({ block: 'center' }); const r = p.querySelector('.kb-act-main').getBoundingClientRect(); scrollBy(0, r.top - ${top}); })()`;

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** The strip's stuck stretches as the piece says them: "35.0-155.9" -> [[35, 155.9]]. */
const STUCK = `(() => { const p = document.querySelector('#post-19 [data-kb-ac-piece]'); return p ? p.getAttribute('data-kb-ac-stuck') : null; })()`;
const stretches = (/** @type {string | null} */ s) => (s ? s.split(',').map((x) => x.split('-').map(Number)) : []);

/** b-autocorrect-peel: the author picks the tape at an end, rolls it back, and tears it, three times. */
const autocorrectPeel = () => take('b-autocorrect-peel', {
  as: 'Concessions',
  css: { width: 448, height: 252 },
  async prep(cam) { await cam.evaluate(placePost(19, 105)); await settle(cam, 90); },
  async body(d) {
    const piece = await d.box(`document.querySelector('#post-19 [data-kb-ac-piece]')`);
    assert(piece, 'the strip of tape on post 19');
    const y = piece.cy;
    const before = stretches(await d.page(STUCK));
    console.log('stuck at the start', before);
    assert(before.length === 1 && before[0][1] - before[0][0] > 100, 'one whole strip stuck');
    /* The hand comes in from the right, to an end. Three tears: from the start, from the far end, from the start again. */
    const sides = ['a', 'b', 'a'];
    let width = before[0][1] - before[0][0];
    for (const [n, side] of sides.entries()) {
      const s = stretches(await d.page(STUCK))[0];
      const edge = piece.x + (side === 'a' ? s[0] : s[1]);
      const grip = side === 'a' ? edge + 4 : edge - 4;
      await d.go({ x: grip, y }, n === 0 ? 0.55 : 0.3, 5 + n);
      await d.press();
      /* The pick: held still until the corner stands up and the page says the roll is live. */
      await d.until(`Boolean(document.querySelector('#post-19 [data-kb-ac-roll="live"]'))`, 3, 'the pick up (a live roll)');
      d.mark('pick');
      /* A steady peel, a little, at no more than the pace. */
      const dir = side === 'a' ? 1 : -1;
      await d.drag((t) => ({ x: grip + dir * 70 * t, y: y + 1.5 * Math.sin(t * 9) }), 0.2);
      const peeled = stretches(await d.page(STUCK))[0];
      assert(peeled[1] - peeled[0] < width - 8, `the strip shortened by the peel (${width} to ${peeled[1] - peeled[0]})`);
      /* Then too fast: the hand runs ahead of the line, and the tape strains, and tears. */
      const from = d.at.x;
      await d.drag((t) => ({ x: from + dir * Math.min(165, 900 * t), y: y - 4 * t }), 0.4);
      await d.until(`!document.querySelector('#post-19 [data-kb-ac-roll]') && ${STUCK} !== null`, 1.2, 'the tape torn (its roll let fall)');
      d.mark('tear');
      await d.release();
      const torn = stretches(await d.page(STUCK))[0];
      console.log(`tear ${n + 1}: stuck ${JSON.stringify(torn)}`);
      assert(torn[1] - torn[0] < width - 8, `tear ${n + 1} left the strip shorter (${width} to ${torn[1] - torn[0]})`);
      width = torn[1] - torn[0];
    }
    await d.go({ x: piece.x + piece.w * 0.5, y: y + 40 }, 0.4, 9);
    await d.shoot(0.3);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** The total ink on the post's body: each coat's canvas alpha, sampled on a grid, summed (round 1's `ink()` reads the same canvases). */
const COVER = `(() => {
  let sum = 0;
  for (const c of document.querySelectorAll('[id^="post-"] canvas.kb-whoops-ink')) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 37) sum += d[i] / 255;
  }
  return sum;
})()`;

const COATS = [
  ['D-Guy', '#ff2bd6', 101, 'classy'],
  ['Serious Deer', '#19e3ff', 202, 'eleven colors'],
  ['Chadluminum', '#ffd93d', 303, 'with love'],
  ['D-Guy', '#7dff3a', 404, 'room for one more'],
];
const land = (n) => `window.__shot.splat(${n}, '${COATS[n - 1][0]}', '${COATS[n - 1][1]}', ${COATS[n - 1][2]}, '${COATS[n - 1][3]}')`;

/**
 * A scrubbed post: `coats` coats are on it when the take starts; a hand (pointer.mjs `buzz`) works over the post's body at `energy`,
 * pressing only where there is ink under the pointer, and letting go where there is none. `over` is how far past the body the hand roams
 * (px), `fresh` is a time (seconds) at which a fresh coat lands on top. The ink's cover is asserted to have fallen before that.
 */
const scrub = (id, { coats, energy, over = 0, seconds = 5, seed, fresh = null, css = { width: 720, height: 405 } }) => take(id, {
  css,
  quiet: ['toasts', 'host', 'hud', 'selection'],
  async prep(cam) {
    await cam.evaluate('window.__shot.place(48)');
    for (let n = 1; n <= coats; n++) await cam.evaluate(land(n));
    await settle(cam, 60);
    await cam.until(BUILT, { label: 'the coats built' });
    await settle(cam, 30);
    await cam.evaluate('window.__shot.place(48)');
    await settle(cam, 20);
  },
  async body(d) {
    const box = await d.page('window.__shot.body()');
    const start = await d.page(COVER);
    console.log(`${id}: the post's body`, box, 'cover', start.toFixed(0));
    const hand = buzz({ box: { x: box.x - over, y: box.y - over * 0.6, w: box.w + 2 * over, h: box.h + over * 1.2 }, seed, from: { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 }, energy });
    const rnd = seeded(seed + 3);
    await d.put(box.x + box.w + 30, box.y + box.h * 0.9);
    const first = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 };
    const approach = glide(d.at, first, 0.45, { seed, settle: false });
    let down = false, landedFresh = false, coverAtFresh = null, map = null;
    for (let i = 0; i < 0.45 * d.F; i++) { const p = approach.at(i / d.F); await d.put(p.x, p.y); await d.frameOnce(); }
    let aim = 0;
    for (let f = 0; f < seconds * d.F; f++) {
      const t = f / d.F;
      if (f % 15 === 0) {
        map = await d.page('window.__shot.ink()');
        const high = Math.max(...map.top);
        if (high >= 0 && t > aim) {
          const cells = map.top.flatMap((l, i) => (l === high && map.thick[i] > 0.3 ? [i] : []));
          if (cells.length) { const c = cells[Math.floor(rnd() * cells.length)]; hand.seek({ x: box.x + ((c % map.cols) + 0.5) * (box.w / map.cols), y: box.y + (Math.floor(c / map.cols) + 0.5) * (box.h / map.rows) }); aim = t + 0.5; }
        }
      }
      if (fresh !== null && !landedFresh && t >= fresh) {
        coverAtFresh = await d.page(COVER);
        assert(coverAtFresh < start * 0.97, `the ink's cover fell under the hand (${start.toFixed(0)} to ${coverAtFresh.toFixed(0)})`);
        await d.page(land(coats + 1));
        d.mark('splat');
        landedFresh = true;
      }
      for (let half = 0; half < 2; half++) {
        const p = hand.step(0.5 / d.F);
        await d.put(p.x, p.y);
        const ink = await d.page(`window.__shot.inkAt(${p.x}, ${p.y})`);
        if (down && !ink) { await d.cam.release(); down = false; }
        else if (!down && ink) { await d.cam.press(); down = true; }
      }
      await d.frameOnce();
    }
    if (down) await d.release();
    const end = await d.page(COVER);
    console.log(`${id}: cover ${start.toFixed(0)} -> ${coverAtFresh === null ? end.toFixed(0) : `${coverAtFresh.toFixed(0)} -> ${end.toFixed(0)}`}`);
    if (fresh === null) assert(end < start * 0.97, `the ink's cover fell (${start.toFixed(0)} to ${end.toFixed(0)})`);
    else assert(end > coverAtFresh, 'a fresh coat on top');
  },
});

const scrub1 = () => scrub('b-scrub-1', { coats: 2, energy: 0.35, seconds: 5, seed: 41 });
const scrub2 = () => scrub('b-scrub-2', { coats: 2, energy: 0.75, over: 25, seconds: 5, seed: 82 });
const scrub3 = () => scrub('b-scrub-3', { coats: 3, energy: 1, over: 60, seconds: 5, seed: 123, fresh: 3.6 });

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** How many characters of the tail have typed in under post 20 (the hidden rest and the cursor are not counted). */
const TYPED = `(() => {
  const t = document.querySelector('#post-20 [data-kb-tail]');
  if (!t) return 0;
  const c = t.cloneNode(true);
  for (const e of c.querySelectorAll('[data-kb-rest], [data-kb-cursor], [data-kb-cursor-place]')) e.remove();
  return c.textContent.length;
})()`;
const TYPED_TEXT = TYPED.replace('c.textContent.length', 'c.textContent');
const SPRITZY = 1278;

/**
 * You Were Saying? lands on post 20 as the take begins and its real tail types in under the post (40 characters a second: the whole tail is about
 * 34 s, and "-Spritzy" is typed at 32 s). `from` is the number of characters typed (unfilmed, on the same virtual clock) before the film starts;
 * the tail's end is kept mid-frame then.
 */
const gpt2 = (id, { from = 0, seconds = 8 }) => take(id, {
  css: { width: 640, height: 360 },
  async prep(cam) { await cam.evaluate(`document.querySelector('#post-20').scrollIntoView({ block: 'start' })`); await settle(cam, 40); },
  async body(d) {
    await d.cam.freeze;
    await d.page('window.__shot.gpt2()');
    for (let i = 0; i < 600 && (await d.page(TYPED)) < 1; i++) await d.cam.frame(false);
    const at = (/** @type {number} */ y) => d.page(`(() => { const t = document.querySelector('#post-20 [data-kb-tail]'); const r = (document.querySelector('#post-20 [data-kb-cursor-place]') ?? t).getBoundingClientRect(); scrollBy(0, r.top - ${y}); })()`);
    if (from === 0) {
      await d.page(`(() => { const t = document.querySelector('#post-20 [data-kb-tail]').getBoundingClientRect(); scrollBy(0, t.top - 115); })()`);
    } else {
      for (let i = 0; i < 4000 && (await d.page(TYPED)) < from; i++) await d.cam.frame(false);
      await at(210);
    }
    await d.cam.frame(false);
    const first = await d.page(TYPED);
    d.mark('typing');
    let spritzy = false;
    for (let f = 0; f < seconds * d.F; f++) {
      await d.put(d.css.width + 40, d.css.height + 40);
      if (!spritzy && (await d.page(TYPED_TEXT)).includes('-Spritzy')) { spritzy = true; d.mark('spritzy'); }
      await d.frameOnce();
      /* The tail's end is kept in frame as the lines grow. */
      if (from > 0 && f % 20 === 0) await at(210);
    }
    const last = await d.page(TYPED);
    console.log(`${id}: ${first} characters typed at the first frame, ${last} at the last (${((last - first) / seconds).toFixed(0)} a second)`);
    assert(last - first > 40 * seconds * 0.7, 'the tail typing under post 20 at about 40 characters a second');
    if (from > 0) assert(spritzy && last >= SPRITZY, '"-Spritzy" typed in the take');
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** The mean alpha of Hot Box's fog over a rectangle of the page (CSS px): each tile's canvas read where it lies. 0 is clear, 1 is smoke. */
const fogOver = (r) => `(() => {
  const r = ${JSON.stringify(r)};
  let sum = 0, n = 0;
  for (const c of document.querySelectorAll('#post-15 canvas.dw-hotbox-smoke')) {
    const b = c.getBoundingClientRect(), k = c.width / b.width;
    const x0 = Math.max(r.x, b.left), x1 = Math.min(r.x + r.w, b.right), y0 = Math.max(r.y, b.top), y1 = Math.min(r.y + r.h, b.bottom);
    if (x1 <= x0 || y1 <= y0) continue;
    const d = c.getContext('2d').getImageData(Math.floor((x0 - b.left) * k), Math.floor((y0 - b.top) * k), Math.max(1, Math.floor((x1 - x0) * k)), Math.max(1, Math.floor((y1 - y0) * k))).data;
    for (let i = 3; i < d.length; i += 4 * 5) { sum += d[i] / 255; n++; }
  }
  return n ? sum / n : null;
})()`;

/** b-smoke-wave: Hot Box on post 15. The pointer sweeps along the lines to read, the fog parts around it, and rolls back in behind. */
const smokeWave = () => take('b-smoke-wave', {
  css: { width: 576, height: 324 },
  async prep(cam) { await cam.evaluate(placePost(15, 60)); await settle(cam, 90); await cam.until(`document.querySelectorAll('#post-15 canvas.dw-hotbox-smoke').length > 0`, { label: 'the smoke drawn' }); await settle(cam, 90); },
  async body(d) {
    const words = await d.box(`document.querySelector('#post-15 .dw-hotbox-words')`);
    assert(words, 'the words under the smoke on post 15');
    const lineH = await d.page(`parseFloat(getComputedStyle(document.querySelector('#post-15 .dw-hotbox-words')).lineHeight) || 20`);
    const lines = Math.max(2, Math.round(words.h / lineH));
    console.log('b-smoke-wave: words', words, 'line height', lineH, 'lines', lines);
    const row = (i) => ({ x: words.x, y: words.y + i * lineH, w: words.w, h: lineH });
    const y = (i) => words.y + (i + 0.5) * lineH;
    const before = await d.page(fogOver(row(0)));
    assert(before > 0.5, `smoke over the first line before the hand (${before})`);
    d.mark('smoke');
    /* In from the left edge, along the first line and back along the second, then a third line; then away. */
    await d.put(words.x - 30, y(0));
    await d.go({ x: words.x + 8, y: y(0) }, 0.25, 4, false);
    const sweeps = [];
    for (let i = 0; i < Math.min(3, lines); i++) {
      const dir = i % 2 === 0 ? 1 : -1, from = dir > 0 ? words.x + 6 : words.x + words.w - 6, span = words.w - 12, secs = 1.1;
      await d.drag((t) => ({ x: from + dir * span * Math.min(1, t / secs), y: y(i) + 2.5 * Math.sin(t * 14) }), secs);
      if (i === 0) { sweeps.push(await d.page(fogOver(row(0)))); d.mark('cleared'); }
      if (i < Math.min(3, lines) - 1) await d.drag((t) => ({ x: d.at.x, y: d.at.y }), 0.01);
      if (i < Math.min(3, lines) - 1) { const to = { x: dir > 0 ? words.x + words.w - 6 : words.x + 6, y: y(i + 1) }; await d.go(to, 0.12, 20 + i, false); }
    }
    /* Then the hand leaves, and the smoke rolls back in over what was read. */
    await d.go({ x: words.x + words.w * 0.5, y: words.y + words.h + 70 }, 0.35, 8, false);
    const cleared = sweeps[0];
    await d.shoot(2.8);
    const after = await d.page(fogOver(row(0)));
    d.mark('rolled-back');
    console.log(`b-smoke-wave: fog over line 1: ${before.toFixed(2)} -> ${cleared.toFixed(2)} -> ${after.toFixed(2)}`);
    assert(cleared < before - 0.12, `the fog fell where the hand went (${before} to ${cleared})`);
    assert(after > cleared + 0.12, `the fog rose again after the hand left (${cleared} to ${after})`);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** The pixels of the wall's ink canvas on post 18 that hold paint. */
const WALL_PIXELS = `(() => { const c = document.querySelector('#post-18 .kb-graffiti-ink'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 3) if (d[i] > 40) n++; return n; })()`;

/**
 * b-graffiti-tag: the stage's wall on post 18, tagged by a reader live: the Draw tile, then a can chosen by the pointer and a stroke drawn with
 * it, for each of a scribble-out of FIRST, the word LAST, an arrow, a face and a heart (the shapes of graffiti-shapes.ts are the paths the hand
 * follows, in the box's own proportions), and Tag it. The dock's meter and the surface's stroke count are read from the page.
 */
const graffitiTag = () => take('b-graffiti-tag', {
  css: { width: 1000, height: 562 },
  async prep(cam) { await cam.evaluate(`document.querySelector('#post-18').scrollIntoView({ block: 'start' })`); await settle(cam, 90); },
  async body(d) {
    /* Node strips the types of the stage's own shapes; the tools' type check does not read a .ts import. */
    const { arrow, heart, face, word, scribbleOut } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/graffiti-shapes.ts')).href);
    const meterOf = async () => Number(/(\d+)% of/.exec(await d.page(`document.querySelector('.kb-graffiti-label')?.textContent ?? ''`))?.[1]);
    const before = await d.page(WALL_PIXELS);
    assert(before > 500, 'the stage wall inked on post 18');
    const tile = await d.box(`[...document.querySelectorAll('#post-18 button')].find((e) => e.textContent.trim() === 'Draw')`);
    assert(tile, "the wall's Draw tile");
    await d.put(tile.cx + 160, tile.cy + 120);
    await d.go({ x: tile.cx, y: tile.cy }, 0.4, 6, false);
    await d.tap();
    await d.until(`Boolean(document.querySelector('.kb-graffiti-dock')) && Boolean(document.querySelector('#post-18 [data-kb-draw-surface]'))`, 3, 'the drawing dock open');
    d.mark('dock');
    await d.shoot(0.25);
    const surface = await d.box(`document.querySelector('#post-18 [data-kb-draw-surface]')`);
    const aspect = surface.w / surface.h;
    const metered = await meterOf();
    const shapes = [
      { can: 'red', shape: scribbleOut(0.03, 0.62, 0.24, 'red', aspect) },
      { can: 'blue', shape: word('LAST', 0.05, 0.5, 0.3, 'blue', aspect) },
      { can: 'orange', shape: arrow(0.56, 0.62, 0.72, 0.3, 'orange', aspect) },
      { can: 'purple', shape: face(0.45, 0.67, 0.3, 'purple', aspect) },
      { can: 'pink', shape: heart(0.9, 0.62, 0.22, 'pink', aspect) },
    ];
    let strokes = 0;
    for (const { can, shape } of shapes) {
      const name = can[0].toUpperCase() + can.slice(1);
      const radio = await d.box(`document.querySelector('.kb-graffiti-dock [role="radio"][aria-label="${name}"]')`);
      assert(radio, `the ${name} can on the dock`);
      await d.go({ x: radio.cx, y: radio.cy }, 0.16, 30 + strokes, false);
      await d.tap();
      assert(await d.page(`document.querySelector('.kb-graffiti-dock [role="radio"][aria-label="${name}"]').getAttribute('aria-checked') === 'true'`), `the ${name} can chosen`);
      for (const s of shape.strokes) {
        const pts = s.points.map(([x, y]) => ({ x: surface.x + x * surface.w, y: surface.y + y * surface.h }));
        await d.go(pts[0], 0.07, 50 + strokes, false);
        await d.press();
        const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
        const total = lens.reduce((a, b) => a + b, 0), secs = Math.max(0.12, total / 1900);
        await d.drag((t) => {
          let want = Math.min(1, t / secs) * total, i = 0;
          while (i < lens.length - 1 && want > lens[i]) { want -= lens[i]; i++; }
          const u = lens[i] > 0 ? Math.min(1, want / lens[i]) : 1;
          return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
        }, secs);
        await d.put(pts[pts.length - 1].x, pts[pts.length - 1].y);
        await d.release();
        strokes++;
      }
      d.mark(`drawn:${shape.kind}`);
    }
    const drawn = Number(await d.page(`document.querySelector('#post-18 [data-kb-draw-surface]').getAttribute('data-kb-strokes')`));
    console.log(`b-graffiti-tag: ${drawn} strokes on the surface, the meter ${metered}% -> ${await meterOf()}%`);
    assert(drawn === strokes, `the surface holds all ${strokes} strokes (${drawn})`);
    assert((await meterOf()) < 40 && (await meterOf()) > metered, 'the wall within its limit and fuller');
    const tag = await d.box(`[...document.querySelectorAll('.kb-graffiti-dock button')].find((e) => /Tag it/i.test(e.textContent))`);
    await d.go({ x: tag.cx, y: tag.cy }, 0.3, 77, false);
    await d.tap();
    await d.until(`!document.querySelector('.kb-graffiti-dock')`, 4, 'the tag saved (the dock closed)');
    d.mark('tagged');
    await d.shoot(0.5);
    const after = await d.page(WALL_PIXELS);
    console.log(`b-graffiti-tag: wall pixels ${before} -> ${after}`);
    assert(after > before * 1.05, 'the wall holds the new strokes');
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** A card played on a stage post (by its number in the thread) by a character of the cast, live, landing on the open page. */
const playOn = (seq, name, card, options) => `(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, ${seq}, ${seq}).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast[${JSON.stringify(name)}], a.id, ${JSON.stringify(card)}, { live: true, ...${JSON.stringify(options)} }); }); })()`;

const HOLD = `[role="dialog"][aria-label="Stick Around"]:not([data-kb-exiting])`;
const LEVEL = `(() => { const f = document.querySelector('${HOLD} .kb-hold-fill'), t = document.querySelector('${HOLD} .kb-hold-track'); return f && t ? f.getBoundingClientRect().width / t.getBoundingClientRect().width : -1; })()`;

/**
 * b-stick-around: a reader (Ringside) held on D-Guy's review by Stick Around, in the card's full-screen view. The wheel pushes against the Break
 * free bar: it climbs and falls back when the wheel stops, twice; the third push fills it and the view lets the reader go. Wheel events are the
 * camera's real ones (camera.mjs `wheel`).
 */
const stickAround = () => take('b-stick-around', {
  as: 'Ringside', skin: 'fan-site',
  css: { width: 800, height: 450 },
  async prep(cam) { await cam.evaluate(`(() => { const p = document.querySelector('#post-9'); p.scrollIntoView({ block: 'center' }); })()`); await settle(cam, 60); },
  async body(d) {
    await d.put(d.css.width * 0.5, d.css.height * 0.34);
    await d.shoot(0.1);
    await d.page(playOn(9, 'D-Guy', 'stick-around', { layer: 1, message: 'required reading', config: { sentence: 'I have read all nine parts and I feel changed.' } }));
    await d.until(`Boolean(document.querySelector('${HOLD}'))`, 8, 'the Stick Around view taking the reader');
    d.mark('held');
    await d.shoot(0.5);
    /* The reader reads down the post with the wheel to its end: only a push past the end counts against the bar. */
    const atEnd = `(() => { const s = document.querySelector('${HOLD} [role="region"]'); return s ? s.scrollHeight - s.clientHeight - s.scrollTop < 2 : false; })()`;
    for (let i = 0; i < 40 && !(await d.page(atEnd)); i++) { await d.cam.wheel(30); await d.shoot(2 / 60); }
    assert(await d.page(atEnd), 'the held post scrolled to its end');
    d.mark('read');
    await d.shoot(0.2);
    const peaks = [];
    for (let n = 0; n < 3; n++) {
      let peak = 0;
      /* A push: wheel ticks against the end of the post, the bar climbing; the third goes on until the view lets go. */
      for (let i = 0; i < (n < 2 ? 22 : 90) && (await d.page(`Boolean(document.querySelector('${HOLD}'))`)); i++) {
        await d.cam.wheel(120 + 50 * n);
        await d.shoot(1 / 60 * 2);
        peak = Math.max(peak, await d.page(LEVEL));
        if (n === 2 && i === 0) d.mark('third-push');
      }
      peaks.push(peak);
      if (n < 2) {
        assert(peak > 0.15, `the Break free bar climbed under push ${n + 1} (peak ${peak})`);
        d.mark(`push-${n + 1}`);
        await d.shoot(0.5);
        const fell = await d.page(LEVEL);
        assert(fell < peak - 0.05, `the bar fell back once the wheel stopped (${peak} to ${fell})`);
        d.mark('fell-back');
      }
    }
    console.log('b-stick-around: peaks', peaks);
    await d.until(`!document.querySelector('${HOLD}')`, 3, 'the view letting the reader go');
    d.mark('free');
    await d.shoot(0.8);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/**
 * b-glitter-drag: the Glitter Bomb on post 16 goes off as the post comes to the middle of the view, and the pointer is dragged through the
 * glitter, side to side, carrying it (the engine's cling: `canvas[data-kb-shine="cling"]` is the layer the first pickup makes); then it leaves
 * down the page's edge with what stuck, and the glitter drops.
 */
const glitterDrag = () => take('b-glitter-drag', {
  skin: 'midnight',
  css: { width: 540, height: 304 },
  quiet: ['toasts', 'host', 'hud', 'selection'],
  async prep(cam) { await cam.evaluate(placePost(16, 50)); await settle(cam, 60); },
  async body(d) {
    const box = await d.page('(() => { const r = document.querySelector("#post-16 .kb-act-main").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()');
    console.log('b-glitter-drag: body', box);
    await d.put(d.css.width + 30, box.y + box.h * 0.5);
    d.mark('burst-watched');
    await d.shoot(0.9);
    let clung = false;
    const rng = seeded(16);
    const path = glide(d.at, { x: box.x + box.w * 0.9, y: box.y + box.h * 0.5 }, 0.45, { seed: 16, settle: false });
    await d.drag((t) => path.at(t), 0.45);
    d.mark('enter');
    /* Through the glitter side to side, a few px a move, as a hand passes over a post: wide arcs that wander down and up the body. */
    const secs = 4.2;
    await d.drag((t) => {
      const u = t / secs;
      return { x: box.x + box.w * (0.5 + 0.42 * Math.cos(u * Math.PI * 5.5)), y: box.y + box.h * (0.5 + 0.34 * Math.sin(u * Math.PI * 3.3 + 0.6)) };
    }, secs, async () => {
      if (!clung && (await d.page(`document.querySelectorAll('canvas[data-kb-shine="cling"]').length`)) > 0) { clung = true; d.mark('clinging'); }
    });
    assert(clung, 'the cling layer (glitter picked up by the pointer)');
    const last = d.at;
    const out = glide(last, { x: 2, y: box.y + box.h + 90 }, 0.6, { seed: 17, settle: false });
    await d.drag((t) => out.at(t), 0.6);
    await d.shoot(1.4);
    void rng;
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/**
 * b-chair: Steel Chairs thrown at Snuckles's update (post 4), in the Midnight skin, where the dents read: the first lands as the take starts,
 * and the second and third follow (a post takes up to three at once, each thrown 0.35 s of the world's time after the last it knows of). Each
 * chair is a play of the card on the post, landing live on the open page; the page's chair groups and dents are counted for each.
 */
const chair = () => take('b-chair', {
  skin: 'midnight',
  css: { width: 720, height: 405 },
  async prep(cam) { await cam.evaluate(placePost(4, 26)); await settle(cam, 80); },
  async body(d) {
    const post = '#post-4';
    const count = (/** @type {string} */ sel) => d.page(`document.querySelectorAll('${post} ${sel}').length`);
    assert((await count('.dw-chair-group')) === 0, 'no chair on the post before the take');
    await d.put(d.css.width + 30, d.css.height + 30);
    await d.shoot(0.35);
    const ends = '3 * 86400000';
    for (let n = 1; n <= 3; n++) {
      await d.page(`(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, 4, 4).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast['D-Guy'], a.id, 'steel-chair', { layer: ${n}, message: '', live: true, ends: new Date(Date.now() + ${ends}).toISOString() }); }); })()`);
      await d.until(`document.querySelectorAll('${post} .dw-chair-group').length >= ${n}`, 3, `chair ${n} thrown`);
      d.mark(`throw-${n}`);
      await d.until(`document.querySelectorAll('${post} .dw-chair-dent').length >= ${n}`, 4, `the dent of chair ${n}`);
      d.mark(`dent-${n}`);
      assert((await count('.dw-chair-dent')) === n && (await count('.dw-chair-group')) === n, `${n} chair(s) and ${n} dent(s) on the post`);
      await d.shoot(n < 3 ? 1.1 : 1.8);
    }
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** What a post shows of reactions: the text of its reaction chips (the buttons of its row that are not the React button). */
const CHIPS = `[...document.querySelectorAll('#post-2 .kb-reactions button, #post-2 [class*="kb-react"] button, #post-2 .kb-chip')].map((b) => (b.getAttribute('aria-label') ?? b.textContent).trim()).join('|')`;

/**
 * b-react: the film's own player (Snuckles) presses + React on Chadluminum's kind words (post 2), the picker opens (the 4x4 map of reactions in
 * their four groups), the pointer looks along it and picks Fire; the picker closes and the post wears the new reaction.
 */
const react = () => take('b-react', {
  css: { width: 1100, height: 619 },
  async prep(cam) { await cam.evaluate(`document.querySelector('#post-2').scrollIntoView({ block: 'start' }); scrollBy(0, -170)`); await settle(cam, 60); },
  async body(d) {
    const before = await d.page(CHIPS);
    const button = () => d.box(`[...document.querySelectorAll('#post-2 button')].find((e) => /React/.test(e.textContent))`);
    const b = await button();
    assert(b, "the post's + React button");
    await d.put(b.cx + 150, b.cy - 120);
    await d.go({ x: b.cx, y: b.cy }, 0.45, 61);
    await d.tap();
    await d.until(`Boolean(document.querySelector('[role="dialog"][aria-label^="React to"]'))`, 3, 'the picker open');
    d.mark('picker');
    await d.shoot(0.4);
    const kind = (name) => d.box(`[...document.querySelectorAll('[role="dialog"] .kb-picker-kind')].find((e) => /^${name},/.test(e.getAttribute('aria-label') ?? ''))`);
    /* The pointer looks across the map (Heart, then Laughing, then Fire), and chooses. */
    for (const { name, secs } of [{ name: 'Heart', secs: 0.4 }, { name: 'Laughing', secs: 0.3 }, { name: 'Fire', secs: 0.35 }]) {
      const k = await kind(name);
      assert(k, `the ${name} reaction in the picker`);
      await d.go({ x: k.cx, y: k.cy }, secs, 70 + name.length, name === 'Fire');
      await d.shoot(name === 'Fire' ? 0.25 : 0.12);
    }
    await d.tap();
    await d.until(`!document.querySelector('[role="dialog"][aria-label^="React to"]')`, 3, 'the picker closed on a pick');
    d.mark('picked');
    await d.until(`${CHIPS} !== ${JSON.stringify(before)}`, 3, 'the post wearing the new reaction');
    d.mark('stamp');
    console.log('b-react: reaction chips', JSON.stringify(before), '->', JSON.stringify(await d.page(CHIPS)));
    await d.shoot(1.3);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/**
 * b-laugh: the Laugh Track on Human Josh's joke (post 10): its underlined cues are pressed with the pointer, the punchline's first (a laugh), then
 * "As a human" (a boo). The page marks a cue it has played (`dw-lt-fired`).
 */
const laugh = () => take('b-laugh', {
  skin: 'blue-steel',
  css: { width: 480, height: 270 },
  async prep(cam) { await cam.evaluate(placePost(10, 50)); await settle(cam, 60); },
  async body(d) {
    const cues = await d.page(`new Set([...document.querySelectorAll('#post-10 .dw-lt-cue')].map((e) => e.dataset.ltPlace)).size`);
    assert(cues >= 2, `two cues drawn on post 10 (${cues})`);
    await d.put(d.css.width + 30, d.css.height * 0.7);
    await d.shoot(0.15);
    for (const { n, who } of [{ n: 0, who: 'laugh' }, { n: 1, who: 'boo' }]) {
      const find = `[...document.querySelectorAll('#post-10 .dw-lt-cue')].filter((e, i, a) => a.findIndex((x) => x.dataset.ltPlace === e.dataset.ltPlace) === i)[${n}]`;
      const cue = await d.box(find);
      assert(cue, `cue ${n + 1}`);
      await d.go(async () => { const r = await d.page(`(() => { const r = (${find}).getClientRects()[0]; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); return r; }, n === 0 ? 0.6 : 0.4, 80 + n);
      await d.shoot(0.12);
      await d.tap();
      await d.until(`new Set([...document.querySelectorAll('#post-10 .dw-lt-fired')].map((e) => e.dataset.ltPlace)).size >= ${n + 1}`, 3, `cue ${n + 1} played`);
      d.mark(who);
      await d.shoot(n === 0 ? 1.1 : 1.6);
    }
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** What post 11's Jimmy Wails banner says and shows now: its text, and its drive's bar if it has one. */
const JIMMY = `(() => { const p = document.querySelector('#post-11'); return JSON.stringify({ text: p.innerText.replace(/\\s+/g, ' '), bars: [...p.querySelectorAll('[role="progressbar"], meter')].map((b) => b.getAttribute('aria-valuenow') ?? b.getAttribute('value')) }); })()`;

/**
 * b-jimmy: the Jimmy Wails appeal on Snuckles's post (post 11), as Chadluminum (another player than the card's caster): the pointer goes to the
 * largest gift (1.00) and gives it; the banner takes the Aura (its text and bar change).
 */
const jimmy = () => take('b-jimmy', {
  as: 'Chadluminum', skin: 'hot-rod',
  css: { width: 800, height: 450 },
  async prep(cam) { await cam.evaluate(placePost(11, 18)); await settle(cam, 60); },
  async body(d) {
    const gift = () => d.box(`[...document.querySelectorAll('#post-11 button')].find((b) => b.textContent.trim() === '1.00')`);
    const g = await gift();
    assert(g, 'a 1.00 gift button on the Jimmy Wails banner');
    const before = await d.page(JIMMY);
    await d.put(d.css.width + 30, g.cy + 60);
    await d.shoot(0.2);
    await d.go({ x: g.cx, y: g.cy }, 0.55, 51);
    await d.shoot(0.2);
    await d.tap();
    await d.until(`${JIMMY} !== ${JSON.stringify(before)}`, 4, 'the banner taking the gift');
    d.mark('gift');
    console.log('b-jimmy:', before.slice(0, 300), '->', (await d.page(JIMMY)).slice(0, 300));
    await d.shoot(1.8);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/**
 * b-fold: Below the Fold on Serious Deer's post (post 3), landed with `cast` before the take as the film's first player's Human Josh: the post
 * is one bar, and the pointer presses it once; the post opens (the bar says Hide, its words and its postbit show).
 */
const fold = () => take('b-fold', {
  css: { width: 640, height: 360 },
  async prep(cam) {
    const r = await cam.evaluate(`window.__shot.cast('Human Josh', 3, 'below-the-fold', {}, '')`);
    assert(r.caught === false || r.caught === undefined || !r.caught, 'the Below the Fold not caught by a back');
    await settle(cam, 40);
    await cam.until(`Boolean(document.querySelector('#post-3[data-kb-fold], #post-3 [data-kb-fold], article[data-kb-fold]'))`, { label: 'post 3 folded' });
    await cam.evaluate(`(() => { const p = document.querySelector('article[data-kb-fold]'); p.scrollIntoView({ block: 'start' }); scrollBy(0, -40); })()`);
    await settle(cam, 40);
  },
  async body(d) {
    const bar = `[...document.querySelectorAll('article[data-kb-fold] button')].find((b) => /^(Show|Hide) post #/.test(b.getAttribute('aria-label') ?? ''))`;
    assert(await d.page(`${bar}?.getAttribute('aria-expanded') === 'false'`), 'a folded post: its bar says closed');
    const b = await d.box(bar);
    await d.put(d.css.width + 30, b.cy + 80);
    await d.shoot(0.25);
    await d.go({ x: b.x + b.w * 0.45, y: b.cy }, 0.6, 91);
    await d.shoot(0.2);
    await d.tap();
    await d.until(`${bar}?.getAttribute('aria-expanded') === 'true'`, 3, 'the fold open');
    d.mark('open');
    assert(await d.page(`(document.querySelector('article[data-kb-fold] [data-kb-cell="words"]')?.textContent ?? '').trim().length > 5`), 'the post\'s words showing');
    await d.shoot(2.0);
  },
});

/* ---------------------------------------------------------------------------------------------------------------------------------- */

const BUTTONS = `[...document.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-label') ?? e.textContent.trim())`;
const buttonNamed = (name) => `(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(name)} && e.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;

/**
 * b-pack: round 1's pack (shot-pack.mjs) on the booster packs board's own story: the Booster selected and bought, the pack opens, and its five
 * cards are turned one at a time with the pointer, the last the rare. The take is tight: the selection is pressed at once, the cards turn quickly.
 */
const pack = () => take('b-pack', {
  story: 'boards-booster-packs--machine',
  css: { width: 1000, height: 562 },
  async prep(cam) {
    /* The machine is a long page: the wheel (the camera's real one) brings the Booster to the middle of the view before the film starts. */
    await cam.move(500, 300);
    for (let i = 0; i < 60; i++) {
      const at = await cam.evaluate(buttonNamed('Buy Booster, 3.00 orbs, a pack of 5 postcards'));
      if (at && at.y > 562 * 0.3 && at.y < 562 * 0.6) break;
      await cam.wheel(at && at.y < 562 / 2 ? -80 : 140);
      for (let f = 0; f < 6; f++) await cam.frame(false);
    }
    for (let f = 0; f < 30; f++) await cam.frame(false);
  },
  async body(d) {
    const go = async (name, secs, seed) => {
      /* The machine is a long page: the wheel brings the button into the middle of the view, as a player's scrolling would (a scrollIntoView call under the frozen clock never answers). */
      for (let i = 0; i < 60; i++) {
        const at = await d.page(buttonNamed(name));
        if (at && at.y > d.css.height * 0.2 && at.y < d.css.height * 0.8) break;
        await d.wheel(Math.sign((at ? at.y : d.css.height * 2) - d.css.height / 2) * 140, 4);
      }
      const to = await d.page(buttonNamed(name));
      if (!to) throw new Error(`the page has no button named "${name}": it has ${(await d.page(BUTTONS)).join(' | ')}`);
      await d.go(to, secs, seed);
    };
    await d.put(d.css.width * 0.7, d.css.height * 0.55);
    await d.shoot(0.15);
    await go('Buy Booster, 3.00 orbs, a pack of 5 postcards', 0.55, 61);
    await d.shoot(0.08); await d.tap(); d.mark('select'); await d.shoot(0.12);
    await go('Buy Booster · 3.00', 0.3, 62);
    await d.shoot(0.1); await d.tap(); d.mark('buy');
    await d.shoot(2.5);     await d.until(`${BUTTONS}.includes('Turn the next card')`, 6, 'the pack opened (a card to turn)');
    d.mark('opened');
    await go('Turn the next card', 0.4, 63);
    for (let n = 1; n <= 5; n++) {
      await d.shoot(n === 1 ? 0.15 : 0.1);
      await d.tap();
      d.mark(`turn-${n}`);
      await d.shoot(n === 5 ? 1.0 : 0.25);
    }
    assert(!(await d.page(BUTTONS)).includes('Turn the next card'), 'all five cards turned (no card left to turn)');
  },
});

/**
 * b-hand: round 1's hand (shot-hand.mjs): the HUD's Hand button pressed, the hand fans open, the pointer crosses the fan once, each card standing
 * up as it is crossed, and picks one (Ultra Happy Heart).
 */
const hand = () => take('b-hand', {
  skin: 'fan-site',
  css: { width: 1440, height: 810 },
  quiet: ['toasts', 'host'],
  async prep(cam) { await cam.evaluate('window.__shot.place(120)'); await settle(cam, 40); },
  async body(d) {
    const CARDS = `[...document.querySelectorAll('button')].filter((b) => /postcard/.test(b.getAttribute('aria-label') ?? b.textContent ?? '') && !b.classList.contains('kb-hud-hand')).map((b) => { const r = b.getBoundingClientRect(); return { name: (b.getAttribute('aria-label') ?? b.textContent).slice(0, 40), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }).filter((c) => c.w > 0)`;
    const btn = await d.box(`document.querySelector('.kb-hud-hand')`);
    assert(btn, "the HUD's Hand button");
    await d.put(d.css.width * 0.52, d.css.height * 0.42);
    await d.shoot(0.1);
    await d.go({ x: btn.cx, y: btn.cy }, 0.55, 5);
    await d.shoot(0.1);
    await d.tap();
    await d.until(`document.querySelectorAll('button.kb-postcard').length > 10`, 4, 'the hand open');
    d.mark('open');
    await d.shoot(0.9);
    const cards = await d.page(CARDS);
    assert(cards.length > 10, `the hand shows its cards (${cards.length})`);
    const mid = (Math.min(...cards.map((c) => c.y)) + Math.max(...cards.map((c) => c.y))) / 2;
    const front = cards.filter((c) => c.y >= mid).sort((a, b) => b.x - a.x);
    const on = (row, x) => {
      const near = [...row].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x)), [a, c = a] = near;
      const u = a === c || a.x === c.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (c.x - a.x)));
      return { x, y: a.y + (c.y - a.y) * u - 28 };
    };
    const from = front[0].x + 40, to = front.at(-1).x - 40;
    await d.go(on(front, from), 0.4, 8, false);
    /* One pass along the front row at an even pace, with a hand's small wander. */
    const secs = 1.8;
    await d.drag((t) => { const u = Math.min(1, t / secs), e = u * u * (3 - 2 * u), p = on(front, from + (to - from) * e); return { x: p.x, y: p.y + 4 * Math.sin(u * 23) }; }, secs);
    d.mark('crossed');
    const spotOf = (PICK) => d.page(`(() => {
      const b = [...document.querySelectorAll('button.kb-postcard')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(PICK)}));
      if (!b) return null;
      const r = b.getBoundingClientRect(); let best = null;
      for (let fy = 0.06; fy < 0.96; fy += 0.06) for (let fx = 0.06; fx < 0.96; fx += 0.06) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y)?.closest('button') !== b) continue;
        const dd = Math.hypot(fx - 0.5, fy - 0.3);
        if (!best || dd < best.dd) best = { x, y, dd };
      }
      return best; })()`);
    let PICK = null, spot = null;
    for (const name of ['Ultra Happy Heart', 'Unban', 'Steel Chair', 'Whoops!', 'Glitter Bomb']) { spot = await spotOf(name); if (spot) { PICK = name; break; } }
    console.log('b-hand: the cards', cards.map((c) => c.name.split(',')[0]).join(' | '));
    assert(spot, 'a card showing in the open hand to pick');
    const before = await d.page(`document.querySelector('.kb-hud-hand')?.textContent.trim()`);
    await d.go(spot, 0.6, 7);
    await d.shoot(0.5);
    await d.tap();
    d.mark('picked');
    await d.shoot(1.2);
    console.log('b-hand: the hand button', JSON.stringify(before), '->', JSON.stringify(await d.page(`document.querySelector('.kb-hud-hand')?.textContent.trim()`)), '; the page now has', await d.page(`document.querySelectorAll('[role="dialog"], .kb-armed, .kb-ghost-mark').length`), 'armed marks and dialogs');
  },
});

const takes = [autocorrectPeel, scrub1, scrub2, scrub3, smokeWave, graffitiTag, stickAround, glitterDrag, chair, react, laugh, jimmy, fold, pack, hand, () => gpt2("b-gpt2", { from: 0, seconds: 8 }), () => gpt2('b-gpt2-end', { from: 1190, seconds: 4.5 })];
for (const t of takes) await t();
