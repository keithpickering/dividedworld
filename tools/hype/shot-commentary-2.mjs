/**
 * The commentary video's part two (docs/plans/2026-11-21-commentary-video-design.md, sections 4 and 5a; the plan's Task 6): nodes 5 to 8,
 * where the music has come in, the camera starts to move and the narrator starts to slip.
 *
 *   node tools/hype/shot-commentary-2.mjs [--only c-n05|c-n06|c-n07|c-n08] [--port 4319]
 *
 *   c-n05  The read.      Snuckles arms the Whoops! the Rope Break caught and presses D-Guy's review, by the real pointer: the ink fills the
 *                         post's body, the back on the post turns over (4D Chess), and the film ends on its Lens, open.
 *   c-n06  The phrase trap. Human Josh quotes Chadluminum's post and types "to be fair" with real key events, and sends it; the Steel Chair
 *                         waiting on that phrase springs and dents the post, and its Lens shows the phrase. A node appears, unclicked.
 *   c-n07  The mask.      D-Guy's HUD, large in frame: the pointer switches the mask to Chadluminum (HEEL to FACE). Three nodes drift in.
 *   c-n08  The node takes control. The page scrolls itself, at a steady pace on every filmed frame (the clicks' frames too), from D-Guy's
 *                         review past the five dressed posts, and rests with post 19 (the taped-over words) in frame for the last two seconds;
 *                         the pointer clicks a node twice on the way and nothing changes.
 *
 * Every take is filmed at the camera's native double density (1440 x 810 at 2x) and written at 2880 x 1620, so the edit can push in
 * without softening, 60 frames a second, with the page's own clock virtual. Each is at least its window of the music (the design's
 * section 2, measured: windows.mjs) and two seconds, and its action is in the first half of its voice clip, so the take then breathes.
 * Beside each take is `c-nNN.json`: the frames beats landed on, and the camera's moves (`move`, `punches`) for the edit to make.
 * Every "asserts" below reads the page and throws when the picture is not the rule.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';
import { windows } from './windows.mjs';
import { duration } from './cutting.mjs';

const only = flag('only', null);
const port = Number(flag('port', 4319));
const SIZE = { width: 2880, height: 1620 };
/* Seconds each node has in the film: the music's windows (music-map.json, split by the voice clips' lengths where the voice folder is there, else by the default shares), and the take's extra still. */
const VOICE = flag('voice', '.runs/hype/voice');
const clipLength = (stem) => { const hit = existsSync(VOICE) ? ['.mp3', '.wav', '.m4a', '.flac'].map((e) => `${VOICE}/${stem}${e}`).find(existsSync) : undefined; return hit ? duration(hit) : undefined; };
const heard = Object.fromEntries(['n05', 'n06', 'n07', 'n08', 'n09', 'n10'].flatMap((id) => { const t = clipLength(id); return t === undefined ? [] : [[id, t]]; }));
const WINDOWS = Object.fromEntries(windows(JSON.parse(readFileSync('instances/divided-world/ui/hype/music-map.json', 'utf8')), { clips: heard }).filter((w) => /^n0[5-8]$/u.test(w.id)).map((w) => [`c-${w.id}`, w.length]));
const STILL = 2.5;

/** Throws with `what` when `ok` is not so: the picture is the rule, not a staging of it. @param {unknown} ok @param {string} what */
function assert(ok, what) { if (!ok) throw new Error(`the page does not show: ${what}`); }

/**
 * Opens the stage for a take, and hands over what every take does: a film written at 2880 x 1620, the pointer's moves, waits and the
 * take's notes. `body(d)` is the take; it runs on the film's clock, and the take is held still to its length afterward.
 * @param {string} id
 * @param {{ as: string, prep: (cam: any) => Promise<void>, body: (d: any) => Promise<void>, camera: (frames: number, landed: { what: string, frame: number }[]) => object }} spec
 */
async function take(id, { as, prep, body, camera }) {
  const cam = await openStage({ as, port, quiet: ['toasts', 'host'] });
  try {
    await prep(cam);
    await cam.drawPointer();
    await settle(cam, 60);
    const F = cam.fps;
    const film = openFilm({ path: `${OUT}/${id}.mp4`, fps: F, out: SIZE, preset: 'veryfast' });
    console.log(`${id}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    await cam.evaluate('window.__shot.zero()');
    let frame = 0, at = { x: 720, y: 405 };
    /** @type {{ what: string, frame: number }[]} */
    const landed = [];
    const d = {
      cam, F,
      get frame() { return frame; },
      page: (/** @type {string} */ js) => cam.evaluate(js),
      /** Where an element is (the middle of it), or null. */
      mid: (/** @type {string} */ find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`),
      mark: (/** @type {string} */ what) => { landed.push({ what, frame }); console.log(`${id}: ${what} at frame ${frame}`); },
      async shoot(/** @type {number} */ seconds) { for (let i = 0, n = Math.round(seconds * F); i < n; i++, frame++) await film.write(await cam.frame(true)); },
      /** Frames until `expression` is true on the page, or throws after `max` seconds. */
      async until(/** @type {string} */ expression, max = 8, label = expression) {
        for (let i = 0; i < max * F; i++) { if (await cam.evaluate(expression)) return; await film.write(await cam.frame(true)); frame++; }
        throw new Error(`${id}: the page never came to: ${label}`);
      },
      /** The pointer's hand-like move to a point (or to a point a function gives, as a target that moves); the point it reached. */
      async go(/** @type {{ x: number, y: number } | (() => Promise<{ x: number, y: number }>)} */ to, seconds = 0.9, seed = 3) {
        const aim = typeof to === 'function' ? to : async () => to;
        const from = at, first = await aim();
        const path = glide(from, first, seconds, { seed });
        for (let i = 0, n = Math.round(seconds * F); i <= n; i++, frame++) {
          const p = path.at(i / F), now = typeof to === 'function' ? await aim() : first;
          /* A target that moves is followed: the path's offset from its first place is kept, and the end is the target's own. */
          const u = i / n, x = p.x + (now.x - first.x) * u, y = p.y + (now.y - first.y) * u;
          await cam.move(x, y); at = { x, y };
          await film.write(await cam.frame(true));
        }
        return at;
      },
      /** A press and release where the pointer is. */
      async tap() { await cam.press(); await d.shoot(0.07); await cam.release(); await d.shoot(0.1); },
      /** One real key (see camera.mjs), then a frame or so. */
      async key(/** @type {string} */ k, seconds = 0.06) { cam.key(k); await d.shoot(seconds); },
      async wheel(/** @type {number} */ dy, frames = 4) { await cam.wheel(dy); await d.shoot(frames / F); },
    };
    await d.shoot(0.5);
    await body(d);
    /* The take is held still to its window and the two seconds the edit holds its last frame in. */
    const total = Math.ceil((WINDOWS[/** @type {keyof typeof WINDOWS} */ (id)] + STILL) * F);
    if (frame > total - 2 * F) throw new Error(`${id}: the action ends at frame ${frame}, past ${total - 2 * F}: no still page is left at its foot`);
    await d.shoot((total - frame) / F);
    await film.end();
    writeFileSync(`${OUT}/${id}.json`, `${JSON.stringify({ landed, ...camera(total, landed) }, null, 2)}\n`);
    console.log(`${id}: ${frame} frames, ${(frame / F).toFixed(1)} s, ${SIZE.width}x${SIZE.height}; errors:`, cam.errors);
  } finally {
    await cam.close();
  }
}

/** A punch of `percent` on each landing of `what`. @param {{ what: string, frame: number }[]} landed @param {string} what @param {number} percent */
const punch = (landed, what, percent) => landed.filter((l) => l.what === what).map((l) => ({ frame: l.frame, percent }));

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

/** The post's top brought to `top` px down the view. @param {number} seq @param {number} top */
const placePost = (seq, top) => `(() => { const p = document.querySelector('#post-${seq}'); p.scrollIntoView({ block: 'start' }); scrollBy(0, -${top}); })()`;

/* ---------------------------------------------------------------------------------------------------------------------------------- */

/** n05: the read. */
const n05 = () => take('c-n05', {
  as: 'Snuckles',
  async prep(cam) {
    /* Before the camera runs, D-Guy's Whoops! has been caught by Snuckles's Rope Break: it is in Snuckles's hand. */
    const cast = await cam.evaluate(`window.__shot.cast('D-Guy', 1, 'whoops', { color: '#3d77ff' })`);
    assert(cast.caught && !cast.rode, "D-Guy's Whoops! caught by the Rope Break on post 1");
    await cam.evaluate(placePost(14, 90));
  },
  async body(d) {
    const handButton = () => d.mid(`document.querySelector('.kb-hud-hand')`);
    await d.go(await handButton(), 1.0, 11);
    await d.tap();
    await d.until(`document.querySelectorAll('button.kb-postcard').length > 10`, 4, 'the hand open');
    await d.shoot(1.0);
    const spot = await d.page(cardSpot('Whoops!'));
    assert(spot, 'a Whoops! in the open hand');
    await d.go(spot, 0.9, 12);
    await d.shoot(0.5);
    await d.tap();
    /* Armed: the post says so, and a button stands on D-Guy's review. */
    await d.until(`Boolean(document.querySelector('#post-14 .kb-ghost-mark'))`, 4, 'the armed Whoops! pressable on post 14');
    d.mark('armed');
    await d.go(() => d.mid(`document.querySelector('#post-14 .kb-ghost-mark')`), 0.9, 13);
    await d.shoot(0.3);
    await d.tap();
    /* The play form: the wheel scrolls it to its button, as a player at this window's height would. */
    await d.until(`Boolean([...document.querySelectorAll('button')].find((b) => /^Play as/.test(b.textContent)))`, 4, 'the play form');
    await d.go({ x: 1190, y: 430 }, 0.6, 14);
    await d.shoot(0.4);
    for (let i = 0; i < 10; i++) await d.wheel(80, 4);
    await d.shoot(0.3);
    const play = () => d.mid(`[...document.querySelectorAll('button')].find((b) => /^Play as/.test(b.textContent))`);
    await d.go(await play(), 0.8, 15);
    await d.shoot(0.3);
    await d.tap();
    /* The ink lands, and fills the post's body border to border. */
    await d.until(`document.querySelectorAll('#post-14 canvas.kb-whoops-ink').length > 0`, 6, 'ink on post 14');
    d.mark('whoops');
    const ink = await d.page(`(() => { const body = document.querySelector('#post-14 .kb-act-main').getBoundingClientRect(); const c = [...document.querySelectorAll('#post-14 canvas.kb-whoops-ink')].map((e) => e.getBoundingClientRect()); return { body: [body.left, body.top, body.right, body.bottom], ink: [Math.min(...c.map((r) => r.left)), Math.min(...c.map((r) => r.top)), Math.max(...c.map((r) => r.right)), Math.max(...c.map((r) => r.bottom))] }; })()`);
    assert(ink.ink[0] <= ink.body[0] + 2 && ink.ink[2] >= ink.body[2] - 2 && ink.ink[1] <= ink.body[1] + 2 && ink.ink[3] >= ink.body[3] - 2, `the ink canvas covering post 14's body, border to border (left, top, right and bottom) ${JSON.stringify(ink)}`);
    /* The result: the card rode. The spring on D-Guy's review says so. */
    const rode = await d.page(`(async () => { const { fake, acts } = window.__kbStage; const on = (await fake.postPlays([acts.review])).plays; return on.find((a) => a.kind === 'spring')?.payload ?? null; })()`);
    assert(rode?.did === 'rode' && rode?.card === '4d-chess', `the 4D Chess on post 14 says the Whoops! rode: ${JSON.stringify(rode)}`);
    d.mark('rode');
    await d.shoot(1.4);
    /* The back on the review has turned over: 4D Chess. Open its Lens. */
    await d.until(`/^4D Chess/.test(document.querySelector('#post-14 .kb-mark')?.getAttribute('aria-label') ?? '')`, 4, 'the back on post 14 turned over: 4D Chess');
    d.mark('turned');
    await d.go(() => d.mid(`document.querySelector('#post-14 .kb-mark')`), 0.9, 16);
    await d.shoot(0.2);
    await d.tap();
    await d.until(`Boolean(document.querySelector('.kb-lens'))`, 4, 'the Lens');
    d.mark('lens');
    await d.shoot(0.8);
    await d.go(() => d.mid(`document.querySelector('.kb-lens .kb-lens-fold')`), 0.7, 17);
    await d.tap();
    await d.shoot(0.5);
    const lens = await d.page(`document.querySelector('.kb-lens').textContent`);
    assert(/4D Chess/.test(lens) && /Sprang/.test(lens) && /set face down by D-Guy/.test(lens), `the Lens of the 4D Chess, open: ${lens}`);
    await d.go({ x: 760, y: 560 }, 0.8, 18);
  },
  camera: (_total, landed) => ({
    /* A slow push on the post, as he explains; it ends on the post and the Lens. */
    move: { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.03, w: 0.74, roll: 0 }, ease: 'inOut' },
    punches: [...punch(landed, 'whoops', 9), ...punch(landed, 'lens', 6)],
  }),
});

/** n06: the phrase trap. */
const n06 = () => take('c-n06', {
  as: 'Human Josh',
  async prep(cam) {
    /* The thread's foot first, so the live post is shown and not held behind a pill; then Chadluminum's post, with its Quote button clear of the HUD. */
    await cam.evaluate(`scrollTo(0, document.documentElement.scrollHeight)`);
    await settle(cam, 20);
    await cam.evaluate(placePost(2, 40));
  },
  async body(d) {
    const quote = () => d.mid(`[...document.querySelectorAll('#post-2 button')].find((b) => b.textContent.trim() === 'Quote')`);
    await d.go(await quote(), 1.0, 21);
    await d.shoot(0.3);
    await d.tap();
    /* The quote is in the reply box, which has the focus. */
    await d.until(`document.activeElement?.getAttribute('aria-label') === 'Your reply' && document.activeElement.value.startsWith('[quote=')`, 4, 'the reply box holding the quote, focused');
    d.mark('quoted');
    await d.shoot(0.5);
    const words = 'to be fair, it is a good walk cycle.';
    for (const ch of words) await d.key(ch, ch === ' ' ? 0.09 : 0.055);
    const typed = await d.page(`document.activeElement.value`);
    assert(typed.includes('to be fair'), `the reply box holding "to be fair": ${typed}`);
    d.mark('typed');
    await d.shoot(0.4);
    const send = () => d.mid(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send')`);
    await d.go(await send(), 0.8, 22);
    await d.shoot(0.2);
    const count = await d.page(`document.querySelectorAll('article.kb-act').length`);
    await d.tap();
    await d.until(`document.querySelectorAll('article.kb-act').length > ${count}`, 4, 'the reply posted');
    d.mark('posted');
    await d.shoot(0.7);
    /* The Steel Chair waiting on the phrase springs on the new post. */
    const seq = await d.page(`Number([...document.querySelectorAll('article.kb-act')].at(-1).id.replace('post-', ''))`);
    await d.page(`(async () => { const { fake, thread } = window.__kbStage; const [a] = await fake.acts(thread, ${seq}, ${seq}); return window.__shot.springsOn(2, a.id); })()`);
    await d.until(`Boolean(document.querySelector('#post-${seq} .kb-mark'))`, 4, 'the chair on the new post');
    d.mark('steel-chair');
    await d.shoot(1.6);
    const chairMark = () => d.mid(`[...document.querySelectorAll('#post-${seq} .kb-mark')].find((m) => /Steel Chair/.test(m.getAttribute('aria-label') ?? ''))`);
    assert(await chairMark(), 'a Steel Chair mark on the new post');
    await d.go(async () => (await chairMark()), 0.9, 23);
    await d.shoot(0.2);
    await d.tap();
    await d.until(`Boolean(document.querySelector('.kb-lens'))`, 4, 'the Lens');
    d.mark('lens');
    await d.shoot(0.6);
    /* The Lens opens on the chair: what it did, and (its play unfolded) that it sprang when a post quoted it. It does not print the phrase for a reader who is not the card's setter, so the phrase is asserted where it is on the page: in the post the chair dented. */
    await d.go(() => d.mid(`document.querySelector('.kb-lens .kb-lens-fold')`), 0.7, 25);
    await d.tap();
    await d.shoot(0.5);
    const lens = await d.page(`document.querySelector('.kb-lens').textContent`);
    assert(/Dented by a chair/.test(lens) && /sprang when a post quoted it/.test(lens), `the Lens of the landed chair: ${lens}`);
    const dented = await d.page(`document.querySelector('#post-${seq}').textContent`);
    assert(dented.includes('to be fair'), `"to be fair" in the post the chair landed on`);
    await d.go({ x: 700, y: 330 }, 0.8, 24);
    /* Late in the take, a node at the page's margin that nobody clicked. */
    await d.shoot(4);
    await d.page(`window.__shot.node(64, 330)`);
    d.mark('node');
  },
  camera: (_total, landed) => ({
    move: { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.1, y: 0.08, w: 0.72, roll: 0 }, ease: 'inOut' },
    punches: [...punch(landed, 'steel-chair', 9), ...punch(landed, 'lens', 6)],
  }),
});

/** n07: the mask. */
const n07 = () => take('c-n07', {
  as: 'D-Guy',
  async prep(cam) { await cam.evaluate(placePost(14, 70)); },
  async body(d) {
    const tag = () => d.page(`document.querySelector('.kb-hud-glass')?.textContent ?? document.querySelector('.kb-hud')?.textContent ?? ''`);
    const before = await tag();
    assert(/D-GUY/i.test(before) && /HEEL/i.test(before) && /ONLY YOU SEE THIS/i.test(before), `the HUD of D-Guy, a Heel only he sees: ${before}`);
    const swap = () => d.mid(`document.querySelector('.kb-hud select')`);
    await d.go(await swap(), 1.2, 31);
    await d.shoot(0.4);
    /* A select, given the keys a player gives it. A press on a native select opens a popup that never comes back while the page's clock is the film's (the camera hangs on it), so the pointer rests on the control and the control is focused as a press would focus it. */
    await d.page(`document.querySelector('.kb-hud select').focus()`);
    await d.shoot(0.5);
    /* The mask above D-Guy in the list is Chadluminum: one press of the Up arrow on the closed select, which changes it as a keyboard does. (Enter would open the native popup, which hangs the camera.) */
    await d.key('ArrowUp', 0.3);
    await d.until(`/Chadluminum/i.test(document.querySelector('.kb-hud select')?.selectedOptions[0]?.textContent ?? '')`, 3, 'the select on Chadluminum');
    await d.until(`/FACE/i.test(document.querySelector('.kb-hud-glass')?.textContent ?? '')`, 3, 'the HUD tag FACE');
    d.mark('switch');
    const after = await tag();
    assert(/CHADLUMINUM/i.test(after) && /FACE/i.test(after) && !/HEEL/i.test(after) && /ONLY YOU SEE THIS/i.test(after), `the HUD of Chadluminum, a Face only he sees: ${after}`);
    await d.go({ x: 900, y: 300 }, 0.8, 32);
    /* Hold. Three more nodes drift in, a second or two apart. */
    await d.shoot(1.8);
    for (const [x, y] of [[980, 190], [420, 310], [1180, 430]]) {
      await d.page(`window.__shot.node(${x}, ${y})`);
      d.mark('node');
      await d.shoot(1.7);
    }
  },
  camera: (_total, landed) => ({
    /* The HUD large in frame, and a slow push on it. */
    move: { from: { x: 0, y: 0.18, w: 0.82, roll: 0 }, to: { x: 0, y: 0.45, w: 0.55, roll: 0 }, ease: 'inOut' },
    punches: punch(landed, 'switch', 7),
  }),
});

/** n08: the node takes control. */
const n08 = () => take('c-n08', {
  as: 'Snuckles',
  async prep(cam) {
    await cam.evaluate(placePost(14, 60));
    /* Several nodes over the page, at page places along the way down. */
    await cam.evaluate(`(() => {
      const { nodes } = window.__kbStage;
      const top = (seq) => document.querySelector('#post-' + seq).getBoundingClientRect().top + scrollY;
      nodes.add(1330, top(14) + 120); nodes.add(70, top(15) + 90); nodes.add(1260, top(16) + 150); nodes.add(980, top(17) + 60); nodes.add(120, top(18) + 140); nodes.add(1250, top(19) + 100);
    })()`);
  },
  async body(d) {
    /* Where each dressed post's effect is, so each can be seen to have drawn: the take throws for any of the five that did not (the film says they are dressed). */
    const EFFECTS = { 15: ['Hot Box', '.dw-hotbox-smoke'], 16: ['Glitter Bomb', '.dw-glitter-over'], 17: ["Feelin' Fab", '.dw-fab-foil'], 18: ['Graffiti', '.kb-graffiti-frame'], 19: ['Autocorrect', '.dw-ac-tape'] };
    /* An effect is drawn while its post is near the viewport (the smoke is not kept for a post long scrolled past), so each is looked for while the page passes it: the posts in view now that wear theirs. */
    const seenDrawn = {};
    const sample = async () => {
      const now = await d.page(`Object.fromEntries(Object.entries(${JSON.stringify(EFFECTS)}).map(([seq, [, sel]]) => { const r = document.querySelector('#post-' + seq).getBoundingClientRect(); return [seq, r.bottom > 0 && r.top < innerHeight && Boolean(document.querySelector('#post-' + seq + ' .kb-act-main ' + sel))]; }))`);
      for (const [seq, on] of Object.entries(now)) if (on) seenDrawn[seq] = true;
    };
    const y0 = await d.page(`scrollY`);
    const foot = await d.page(`document.documentElement.scrollHeight - innerHeight`);
    /* The scroll ends with post 19 (the taped-over words, the last dressed post) in frame, not on the empty reply box at the thread's foot: its top 100 px down the view, or the foot if that is nearer. */
    const top19 = await d.page(`document.querySelector('#post-19').getBoundingClientRect().top + scrollY`);
    const yEnd = Math.min(foot, top19 - 100);
    /* The take is 16.4 s: half a second of lead, the scroll, and at least two seconds of the page at rest with post 19 in frame. The scroll is a function of the film's own frame, so it advances on every filmed frame, the frames in which the pointer presses among them. */
    const seconds = 13;
    const n = Math.round(seconds * d.F), CLICK_FRAMES = 12, f0 = d.frame, span = n + CLICK_FRAMES;
    const scrollTo = () => d.page(`document.scrollingElement.scrollTop = ${y0 + (yEnd - y0) * Math.min(1, (d.frame - f0) / span)}`);
    /** One filmed frame, the page scrolled first. */
    const tick = async () => { await scrollTo(); await d.shoot(1 / d.F); };
    let nodeId = null, t0 = 0, clicks = 0;
    const started = [];
    d.mark('scroll');
    for (let i = 0; i <= n; i++) {
      if (i % 8 === 0) await sample();
      /* Midway the pointer goes to a node that is in view (clear of the HUD), and follows it up the screen as the page moves. */
      await scrollTo();
      if (nodeId === null && i >= Math.round(n * 0.25)) {
        const near = await d.page(`window.__shot.nodes().find((m) => m.y > 400 && m.y < 540) ?? null`);
        if (near) { nodeId = near.id; t0 = i; d.mark('node-seen'); }
      }
      if (nodeId !== null && i >= t0 && i <= t0 + 95) {
        const p = await d.page(`(() => { const e = document.querySelector('[data-hype-node="${nodeId}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (p) {
          const e = Math.min(1, (i - t0) / 28), k = e * e * (3 - 2 * e);
          /* The pointer comes to the node over the frames before the first click, from where it was, and then stays on it. */
          d.cam.move(p.x - (1 - k) * 300, p.y + (1 - k) * 140);
        }
        if (i === t0 + 30 || i === t0 + 90) {
          /* The press and release are frames of the scroll too: three before the release and three after, none still. */
          await d.cam.press(); for (let k = 0; k < 3; k++) await tick(); await d.cam.release(); for (let k = 0; k < 3; k++) await tick();
          clicks++; d.mark('click');
          started.push(await d.page(`window.__shot.nodes().find((n) => n.id === ${nodeId}).started`));
        }
      }
      await d.shoot(1 / d.F);
    }
    assert(clicks === 2, 'the node clicked twice');
    assert(started[0] === true && started[1] === false, `the node started and stopped by the two clicks: ${JSON.stringify(started)}`);
    const y1 = await d.page(`scrollY`);
    assert(Math.abs(y1 - yEnd) < 3, `the page scrolled itself to post 19 (${y1} of ${yEnd})`);
    await sample();
    console.log('c-n08: effects seen drawn on their posts as the page passed them', JSON.stringify(seenDrawn));
    for (const [seq, [name]] of Object.entries(EFFECTS)) assert(seenDrawn[seq] === true, `post ${seq} drew its ${name} while in view: ${JSON.stringify(seenDrawn)}`);
    const seen = await d.page(`(() => { const r = document.querySelector('#post-19').getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height; })()`);
    assert(seen > 0.5, `post 19 is in frame at the end of the scroll (${(seen * 100).toFixed(0)}% of it)`);
    await d.shoot(0.5);
  },
  camera: () => ({
    /* The frame drifts off level, a little more all the way. */
    move: { from: { x: 0.03, y: 0.03, w: 0.94, roll: 0 }, to: { x: 0.06, y: 0.06, w: 0.88, roll: 4 }, ease: 'in' },
    punches: [],
  }),
});

const TAKES = { 'c-n05': n05, 'c-n06': n06, 'c-n07': n07, 'c-n08': n08 };
for (const [id, run] of Object.entries(TAKES)) {
  if (only && only !== id) continue;
  await run();
}
