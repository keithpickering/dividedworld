/**
 * The commentary video's part one, takes c-n01 to c-n04 (docs/plans/2026-11-21-commentary-video-design.md, sections 4 and 5a; the plan's Task 5).
 * Part one is locked off: a fixed frame, no camera move, no cut inside a node, and nothing in a take's json that moves it. It is a sober developer
 * commentary, and its stillness is what the rest of the film breaks. 1440 by 810 at double density, the default skin, the HUD in frame.
 *
 *   node tools/hype/shot-commentary-1.mjs [--only c-n01] [--port 4319]
 *
 *   c-n01  The thread at rest, Snuckles's sprite sheet in frame, its Rope Break card back at the post's corner. A commentary node hangs over the
 *          post and bobs; the pointer travels to it, and clicks it, and it turns. Then nothing but the node turning.
 *   c-n02  As D-Guy, framed on his review with the HUD up: HEEL, "only you see this", and the orbs' forecast. Other players' reactions land a beat apart
 *          (the stage's `react`, scored through the instance's own class rule): four tomatoes and a vomit, each read to have raised the forecast, then one
 *          thumbs up, read to have lowered it.
 *   c-n03  As D-Guy, framed on Snuckles's first post, by the real pointer: the hand opens, Whoops! is armed, the post is pressed, the play form is
 *          answered. The Rope Break at the post's corner catches the cast and turns over. The ink never lands (asserted), the cast is read to have been
 *          caught, and the caster's alert (the backend writes one; the stage's `told` writes what the in-memory backend does not) is held in frame.
 *   c-n04  Snuckles's first post, held perfectly still: no pointer, and one started node turning slowly in a corner of the page.
 *
 * Every wait is on the page's virtual clock or on a condition, never the wall clock. Each take ends in two seconds of a still page (the nodes of c-n01
 * and c-n04 keep turning, as they should; the pointer and the page are still). Beside each take is `c-nNN.json`: the frames of its beats, as `landed`.
 *
 * Writes .runs/hype/c-n01.mp4 to c-n04.mp4 and their .json.
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const only = flag('only', null);
const PORT = Number(flag('port', 4319));
const CSS = { width: 1440, height: 810 };
/* Where each take stands on the page: Snuckles's first post with its corner and its sheet in frame (its foot is under the HUD), and D-Guy's review with its reaction bar. */
const FIRST_POST_SCROLL = 130;
const REVIEW_TOP = 60;

/**
 * Films one take: opens the stage as the options say, runs `body` on the film, and writes the film and its json. `body` gets the helpers of a take, all
 * counting frames: `shoot(seconds)`, `until(seconds)` (shoot up to a time in the take), `follow(path)`, `waver(at, seconds, seed)` (a hand that has
 * stopped drifts a few px), `run(expression)` (a call into the page, with the frames drawn while it is answered), `holds(expression, seconds)` and `mark`.
 */
async function take(name, { as = null, quiet = ['toasts', 'host'], scroll, pointer = true, seconds }, body) {
  if (only && only !== name) return;
  const cam = await openStage({ as, css: CSS, quiet, port: PORT });
  try {
    await cam.evaluate(`scrollTo(0, ${scroll})`);
    await settle(cam, 40);
    if (pointer) await cam.drawPointer();
    const film = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps });
    console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps;
    let f = 0;
    const landed = [];
    const t = {
      cam, F,
      frames: () => f,
      mark: (what) => { landed.push({ what, frame: f }); console.log(`${name}: ${what} at frame ${f} (${(f / F).toFixed(2)}s)`); },
      /* One frame, filmed. */
      async frame() { await film.write(await cam.frame(true)); f++; },
      async shoot(secs) { for (let i = 0, n = Math.round(secs * F); i < n; i++) await t.frame(); },
      /* Up to `secs` into the take, if it is not there yet. */
      async until(secs) { while (f < Math.round(secs * F)) await t.frame(); },
      async follow(path) { for (let i = 0, n = Math.round(path.seconds * F); i <= n; i++) { const p = path.at(i / F); await cam.move(p.x, p.y); await t.frame(); } },
      async waver(at, secs, seed) { for (let i = 0, n = Math.round(secs * F); i < n; i++) { const u = i / F; await cam.move(at.x + 2.5 * Math.sin(u * 2.3 + seed), at.y + 2 * Math.sin(u * 3.1 + seed * 2)); await t.frame(); } },
      /* A call into the page, answered while frames are drawn: the fake answers on the page's clock, which only moves with a frame. */
      async run(expression) {
        let done = false, value, failure;
        const asked = cam.evaluate(expression).then((v) => { value = v; }, (e) => { failure = e; }).then(() => { done = true; });
        for (let i = 0; !done; i++) { if (i > 600) throw new Error(`the page never answered: ${expression}`); await t.frame(); }
        await asked;
        if (failure) throw failure;
        return value;
      },
      /* Frames until the page says `expression` is true, at most `limit` seconds. */
      async holds(expression, limit = 4) {
        for (let i = 0, n = Math.round(limit * F); i <= n; i++) { if (await t.run(expression)) return; }
        throw new Error(`${name}: the page never came to: ${expression}`);
      },
      /* The middle of the element the page finds, or null. */
      rect: (find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; })()`),
    };
    await body(t);
    /* The take's last two seconds are a still page, for the edit to hold. */
    await t.shoot(2.0);
    if (f < Math.round(seconds * F)) throw new Error(`${name}: ${f} frames is shorter than the ${seconds} s the take is owed`);
    await film.end();
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed }, null, 2)}\n`);
    console.log(`${name}: filmed ${f} frames (${(f / F).toFixed(2)} s); errors:`, cam.errors);
    if (cam.errors.length > 0) throw new Error(`${name}: the page raised errors:\n${cam.errors.join('\n')}`);
  } finally {
    await cam.close();
  }
}

/** The place a node hangs and the pointer is sent to: a clear part of the post's body, right of the sheet. */
const NODE_AT = { x: 880, y: 330 };

/* c-n01 (voice 31.5 s): the node, the pointer, the click. The take is 35 s: the narrator's instructions play over all of it. */
await take('c-n01', { scroll: FIRST_POST_SCROLL, seconds: 34 }, async (t) => {
  const { cam } = t;
  const id = await cam.evaluate(`window.__shot.node(${NODE_AT.x}, ${NODE_AT.y})`);
  const node = `document.querySelector('[data-hype-node="${id}"]')`;
  /* The hand starts low and right, in the frame, and rests there while the node bobs. */
  const rest = { x: 1210, y: 480 };
  await cam.move(rest.x, rest.y);
  await t.shoot(2.0);
  const aim = await t.rect(node);
  if (!aim) throw new Error('the node is not on the page');
  await t.follow(glide(rest, { x: aim.x + 3, y: aim.y + 2 }, 1.7, { seed: 21 }));
  /* The node bobs; the hand sees where it is now and settles on it. */
  const near = await t.rect(node);
  await t.follow(glide({ x: aim.x + 3, y: aim.y + 2 }, { x: near.x, y: near.y }, 0.25, { seed: 22, settle: false }));
  await t.until(3.9);
  const on = await t.rect(node);
  await cam.move(on.x, on.y);
  await cam.press(); await t.shoot(0.07); await cam.release();
  t.mark('node-click');
  await t.holds(`window.__shot.nodes().some((n) => n.id === ${id} && n.started)`, 1);
  /* Then nothing but the node turning: the hand rests beside it, still in frame, and is quiet for the last two seconds. */
  await t.waver({ x: on.x, y: on.y }, 32.2 - t.frames() / t.F, 3);
});

/* c-n02 (voice 20.7 s): the Heel's forecast. The take is 24 s. */
await take('c-n02', { as: 'D-Guy', scroll: 6161 - REVIEW_TOP, pointer: false, seconds: 23 }, async (t) => {
  const { cam } = t;
  const shown = await cam.evaluate(`(() => { const hud = document.querySelector('.kb-hud-glass')?.textContent ?? ''; return { heel: /heel/i.test(hud), only: /only you see this/i.test(hud), review: Boolean(document.querySelector('#post-14')) }; })()`);
  if (!shown.heel || !shown.only || !shown.review) throw new Error(`the HUD or the review is not in frame: ${JSON.stringify(shown)}`);
  const forecast = () => t.run('window.__shot.forecast()');
  /* What the HUD itself says of the estimate (the orbs' "+0.30 est."), read from the page's text: the take claims the page shows it, so the page is asked, not only the backend. */
  const ghost = () => t.run(`document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
  const said = (hundredths) => (hundredths === 0 ? '' : `${hundredths > 0 ? '+' : '\u2212'}${(Math.abs(hundredths) / 100).toFixed(2)} est.`);
  /** Waits for the HUD to say what the forecast is, and throws (with what it said before and after) if it never does or never changed. */
  const hudSays = async (before, now, why) => {
    const want = said(now);
    try { await t.holds(`(document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? '') === ${JSON.stringify(want)}`, 2); } catch { throw new Error(`c-n02: the HUD does not show the forecast after ${why}: it says ${JSON.stringify(await ghost())}, the forecast is ${now} (${JSON.stringify(want)})`); }
    if (want === before) throw new Error(`c-n02: the HUD's estimate did not change after ${why}: ${JSON.stringify(before)} then ${JSON.stringify(want)}`);
  };
  let last = await forecast();
  if (last !== 0) throw new Error(`the Heel's forecast starts at ${last}, not nothing`);
  let hud = await ghost();
  if (hud !== '') throw new Error(`the HUD shows an estimate before any reaction: ${JSON.stringify(hud)}`);
  /* The reactions are other players': a character each, from the cast and the crowd. */
  const reactions = [['Snuckles', 'tomato'], ['Serious Deer', 'tomato'], ['Ringside', 'vomiting'], ['Front Row', 'tomato'], ['Nosebleeds', 'tomato']];
  for (const [i, [who, key]] of reactions.entries()) {
    await t.until(5 + 1.5 * i);
    await t.run(`window.__shot.react(${JSON.stringify(who)}, 14, ${JSON.stringify(key)})`);
    const now = await forecast();
    if (!(now > last)) throw new Error(`${who}'s ${key} did not raise the Heel's forecast: ${last} then ${now}`);
    await hudSays(hud, now, `${who}'s ${key}`);
    hud = said(now);
    console.log(`c-n02: ${who}'s ${key}: forecast ${last} -> ${now}; the HUD says ${JSON.stringify(hud)}`);
    t.mark('reaction-up');
    last = now;
  }
  await t.until(15);
  await t.run(`window.__shot.react('Aisle Seat', 14, 'thumbs-up')`);
  const after = await forecast();
  if (!(after < last)) throw new Error(`the thumbs up did not lower the Heel's forecast: ${last} then ${after}`);
  await hudSays(hud, after, "Aisle Seat's thumbs-up");
  console.log(`c-n02: Aisle Seat's thumbs-up: forecast ${last} -> ${after}; the HUD says ${JSON.stringify(said(after))}`);
  t.mark('reaction-down');
  await t.until(22);
});

/* c-n03 (voice 16.2 s): the gate. By the real pointer, as a player does it. */
await take('c-n03', { as: 'D-Guy', quiet: ['host'], scroll: FIRST_POST_SCROLL, seconds: 19 }, async (t) => {
  const { cam } = t;
  const POST = '#post-1';
  const wait = async (secs) => t.shoot(secs);
  const hand = await t.rect(`document.querySelector('.kb-hud-hand')`);
  if (!hand) throw new Error('the HUD has no hand button');
  const click = async () => { await cam.press(); await t.shoot(0.07); await cam.release(); };
  const start = { x: 1090, y: 300 };
  await cam.move(start.x, start.y);
  await wait(0.8);
  /* The hand opens. */
  await t.follow(glide(start, hand, 0.8, { seed: 31 }));
  await wait(0.2);
  await click();
  t.mark('hand-open');
  await t.holds(`Boolean(document.querySelector('[role=dialog][aria-label="Your hand"]')) && [...document.querySelectorAll('button')].some((b) => /^Whoops!/.test(b.getAttribute('aria-label') ?? ''))`, 3);
  await wait(0.6);
  /* Whoops! is armed. */
  const card = await t.rect(`[...document.querySelectorAll('button')].find((b) => /^Whoops!/.test(b.getAttribute('aria-label') ?? ''))`);
  const cardAt = { x: card.x, y: card.y - 30 };
  await t.follow(glide(hand, cardAt, 0.8, { seed: 32 }));
  await wait(0.25);
  await click();
  t.mark('armed');
  await t.holds(`[...document.querySelectorAll('${POST} a, ${POST} button')].some((b) => b.getAttribute('aria-label') === 'Play Whoops! on post 1')`, 3);
  await wait(0.4);
  /* The post is pressed: the slot at its corner, where a back is. */
  const slot = await t.rect(`[...document.querySelectorAll('${POST} a, ${POST} button')].find((b) => b.getAttribute('aria-label') === 'Play Whoops! on post 1')`);
  await t.follow(glide(cardAt, slot, 0.7, { seed: 33 }));
  await wait(0.25);
  await click();
  t.mark('post-pressed');
  await t.holds(`Boolean(document.querySelector('[role=dialog] button') && [...document.querySelectorAll('[role=dialog] button')].some((b) => /^Play as/.test(b.textContent)))`, 3);
  await wait(0.6);
  /* The play form asks for an ink color (the default is chosen) and a message (optional); a player reads it, scrolls to its foot and plays. */
  const form = { x: 1190, y: 500 };
  await t.follow(glide(slot, form, 0.6, { seed: 34, settle: false }));
  await t.waver(form, 0.3, 4);
  await cam.wheel(600);
  await wait(0.8);
  const go = await t.rect(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^Play as/.test(b.textContent))`);
  if (!go) throw new Error('the play form has no Play button');
  await t.follow(glide(form, go, 0.6, { seed: 35 }));
  await wait(0.2);
  await click();
  t.mark('play-pressed');
  /* The cast is caught: the play is on the post, with its catch, and no ink canvas is. */
  await t.holds(`window.__kbStage.fake.postPlays([window.__kbStage.acts.first]).then((read) => read.plays).then((a) => a.some((x) => x.kind === 'card' && x.payload.card === 'whoops'))`, 4);
  const caught = await t.run(`window.__kbStage.fake.postPlays([window.__kbStage.acts.first]).then((read) => read.plays).then((acts) => acts.filter((x) => x.kind === 'card' && x.payload.card === 'whoops').map((x) => ({ caught: x.payload.caught !== undefined, set: x.payload.caught ?? null })))`);
  if (caught.length !== 1 || !caught[0].caught) throw new Error(`the cast was not caught: ${JSON.stringify(caught)}`);
  t.mark('caught');
  await wait(1.5);
  const inks = await t.run(`document.querySelectorAll('${POST} canvas.kb-whoops-ink').length`);
  if (inks !== 0) throw new Error(`${inks} ink canvases are on the post: the cast landed`);
  /* The caster's side of a catch: the alert the backend writes. */
  await t.run(`window.__shot.told('D-Guy', 1)`);
  t.mark('alert');
  /* The toast's words are in frame, and stay for as long as a toast does; the take then ends in its still page, with the toast gone. */
  const said = await t.run(`document.querySelector('.kb-toasts')?.textContent.trim() ?? ''`);
  if (!said.includes('had a Reversal waiting')) throw new Error(`the caught alert's words are not in frame: "${said}"`);
  console.log('c-n03: the alert says:', said);
  const shownAt = t.frames();
  await t.holds(`!(document.querySelector('.kb-toasts')?.textContent.trim())`, 9);
  console.log(`c-n03: the words stayed ${((t.frames() - shownAt) / t.F).toFixed(1)} s`);
  await wait(1.0);
});

/* c-n04 (voice 16.7 s): the last calm shot. No pointer, one node turning in a corner. */
await take('c-n04', { quiet: ['toasts', 'host'], scroll: FIRST_POST_SCROLL, pointer: false, seconds: 19 }, async (t) => {
  const { cam } = t;
  /* The node was started before the film: a click the film does not show, and the pointer sent off the page. */
  const id = await cam.evaluate(`window.__shot.node(1340, 70)`);
  await settle(cam, 10);
  const at = await t.rect(`document.querySelector('[data-hype-node="${id}"]')`);
  await cam.move(at.x, at.y); await settle(cam, 3); await cam.press(); await settle(cam, 2); await cam.release(); await settle(cam, 3);
  await cam.move(-100, -100);
  await settle(cam, 10);
  if (!(await cam.evaluate(`window.__shot.nodes().some((n) => n.id === ${id} && n.started)`))) throw new Error('the corner node did not start');
  await t.shoot(19);
});
