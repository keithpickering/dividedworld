/**
 * The commentary video's part one, filmed again for the owner's new script (docs/plans/2026-11-21-commentary-video-revision-design.md, sections 9 and
 * 10): takes c-n01, c-n02, c-n02-rant, c-n03 and the close cut-in c-n03-alert. Part one is a calm narrated demo, locked off: a fixed frame, no camera
 * move, no cut inside a node (c-n02-rant is the one exception: two framings, a half-second on the thumbs up, then the reply box). 1440 by 810 at double
 * density (the cut-in 640 by 360 at 4.5 times, 2880 by 1620), the default skin, the HUD in frame. Node 4 is the scrub's now, and the card back's turn
 * is no longer a take.
 *
 *   node tools/hype/shot-commentary-1.mjs [--only c-n01] [--port 4321]
 *
 * The pointer is a narrator's (`narrate`, in pointer.mjs): it wanders toward what he is naming and rests near it, loops lazily around a word, drifts
 * off to rest, and the page gets a small absent-minded scroll down and back. Its cues are the captions': a line's start within a node is its share of
 * the node's clip by characters, the clip's length read with ffprobe from `.runs/hype/voice/nNN.mp3`. A take is its clip's length plus 0.6 s (c-n02 is
 * the first 21.2 s of its clip: its last 2.3 s, "And that REALLY got him going!", and the 3 s before it belong to the rant). The paths are seeded.
 *
 *   c-n01  Post 1 at rest; a commentary node bobs over it. The pointer idles, drifts over the sheet at "putting all of our resources into this", goes
 *          to the node at "put your cursor over the floating commentary symbol and click" and clicks it (it turns), clicks again at "click it again"
 *          (it stops), once more (it turns for the rest), gestures at the page on "take temporary control over the forum", and at "It's best to just
 *          let those ones happen" lifts away and rests.
 *   c-n02  As D-Guy, on his post 14 with the HUD up. Five heat reactions land from "Playtesters threw tomatoes at him", then a thumbs up on "agreeing
 *          with him, politely", each read to have moved the forecast and the HUD's own text. Pointer: near the class tag at "secret class", along the
 *          tally at "threw tomatoes", on the orbs at "made money", on the thumbs up at "politely".
 *   c-n02-rant  About 6 s. Half a second on his post with the thumbs up, then the thread's foot: he clicks into the reply box and types a rant with real
 *          key events, in bursts, a typo corrected once, and the take ends mid-word. The post is never sent.
 *   c-n03  As D-Guy, the real-pointer cast of Whoops! on post 1, caught by its Rope Break. The cast lands on "Here, the gate is another player"; the
 *          pointer circles the card back at "Every card back looks the same" and rests on the alert after "Playtesters described this as unfair."
 *   c-n03-alert  Close, 3 s: the alert "Snuckles had a Reversal waiting..." appears.
 *
 * Every wait is on the page's virtual clock or on a condition, never the wall clock. Beside each take is `<take>.json`: the frames of its beats, as
 * `landed`. Writes .runs/hype/c-n01.mp4, c-n02.mp4, c-n02-rant.mp4, c-n03.mp4, c-n03-alert.mp4 and their .json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { idle, loop, narrate, phraseTime, reach, rest, seeded } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** The instance's captions, a TypeScript file Node reads by stripping its types (as edit-commentary.mjs does). */
const { commentary } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
const only = flag('only', null);
const PORT = Number(flag('port', 4321));
const CSS = { width: 1440, height: 810 };
const CLOSE = { css: { width: 640, height: 360 }, scale: 4.5, out: { width: 2880, height: 1620 } };
/* Where each take stands on the page: Snuckles's first post with its corner and its sheet in frame (its foot is under the HUD), and D-Guy's review with its reaction bar. */
const FIRST_POST_SCROLL = 130;
const REVIEW_TOP = 60;
/** The part of the screen above the HUD, where the hand idles when it is on the thread. */
const PAGE = { x: 190, y: 130, w: 1200, h: 470 };
const SCREEN = { x: 0, y: 0, w: 1440, h: 810 };
const TAKE_EXTRA = 0.6;
/** Seconds from the press of Play to the cast landing as caught, as measured (the first build's was 0.35 s late with a 0.3 s lead). */
const CAST_LEAD = 0.13;

/** A node's lines and the length of its clip in seconds: ffprobe on the voice file, else 150 words a minute. */
function clipOf(id, { dropLast = 0, clipLess = 0 } = {}) {
  const all = commentary.find((n) => n.id === id)?.lines;
  if (!all) throw new Error(`no node ${id}`);
  /* `dropLast` captions and `clipLess` seconds of the voice belong to another take (c-n02's last line and the gap before it). */
  const lines = all.slice(0, all.length - dropLast);
  const file = `${OUT}/voice/${id}.mp3`;
  if (existsSync(file)) {
    const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
    if (Number.isFinite(secs) && secs > 0) return { lines: [...lines], clip: secs - clipLess, voice: true };
  }
  const words = lines.join(' ').split(/\s+/).length;
  return { lines: [...lines], clip: (words / 150) * 60 - clipLess, voice: false };
}

/**
 * Films one take: opens the stage as the options say, runs `body` on the film, and writes the film and its json. `body` gets the helpers of a take, all
 * counting frames: `shoot(seconds)`, `until(seconds)` (shoot up to a time in the take), `follow(path)`, `run(expression)` (a call into the page, with
 * the frames drawn while it is answered), `holds(expression, seconds)`, `roll()` (a take with `late` is not filmed until it says so: the page is
 * prepared with the real pointer first, on frames nothing keeps), `at(phrase)` (when the node's captions say it, in the take) and `mark`.
 */
async function take(name, { as = null, quiet = ['toasts', 'host'], scroll, pointer = true, node = null, css = CSS, scale = 2, out = { width: 1920, height: 1080 }, late = false, seconds = null, clipOpts = {}, prep = null }, body) {
  if (only && only !== name) return;
  const voice = node ? clipOf(node, clipOpts) : null;
  const owed = seconds ?? (voice ? voice.clip + TAKE_EXTRA : 0);
  const cam = await openStage({ as, css, quiet, scale, port: PORT });
  try {
    if (prep) await prep(cam);
    await cam.evaluate(`scrollTo(0, ${scroll})`);
    await settle(cam, 40);
    if (pointer) await cam.drawPointer();
    const film = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out });
    console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart${voice ? `; clip ${voice.clip.toFixed(2)} s (${voice.voice ? 'voice' : '150 wpm'}), take ${owed.toFixed(2)} s` : ''}`);
    const F = cam.fps;
    let f = 0, rolling = !late;
    const landed = [];
    const t = {
      cam, F, css, owed,
      frames: () => f,
      now: () => f / F,
      mark: (what) => { if (!rolling) return; landed.push({ what, frame: f }); console.log(`${name}: ${what} at frame ${f} (${(f / F).toFixed(2)}s)`); },
      roll() { rolling = true; f = 0; },
      /** When the captions say `phrase` (the nth match), in seconds into the take. */
      at: (phrase, nth = 0) => phraseTime(voice.lines, voice.clip, phrase, nth),
      /* One frame, filmed (or, before the take rolls, drawn and thrown away). */
      async frame() { if (rolling) { await film.write(await cam.frame(true)); f++; } else await cam.frame(false); },
      async shoot(secs) { for (let i = 0, n = Math.round(secs * F); i < n; i++) await t.frame(); },
      /* Up to `secs` into the take, if it is not there yet. */
      async until(secs) { while (f < Math.round(secs * F)) await t.frame(); },
      async follow(path) { for (let i = 0, n = Math.round(path.seconds * F); i <= n; i++) { const p = path.at(i / F); await cam.move(p.x, p.y); await t.frame(); } },
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
      /** The narrator's pointer over the rest of the take, to `until`. */
      narrate: (cues, { from, box = PAGE, seed, still = false, until = owed }) => narrate(cam, cues, { frame: () => t.frame(), now: () => f / F, fps: F, from, box, seed, until, still, log: (m) => console.log(`${name}: ${m}`) }),
    };
    await body(t);
    if (f < Math.round(owed * F)) throw new Error(`${name}: ${f} frames is shorter than the ${owed} s the take is owed`);
    await film.end();
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed }, null, 2)}\n`);
    console.log(`${name}: filmed ${f} frames (${(f / F).toFixed(2)} s); errors:`, cam.errors);
    if (cam.errors.length > 0) throw new Error(`${name}: the page raised errors:\n${cam.errors.join('\n')}`);
  } finally {
    await cam.close();
  }
}

/** The place a node hangs and the pointer is sent to: a clear part of the post's body, right of the sheet (the node is 84 px, so it covers none of the words). */
const NODE_AT = { x: 880, y: 330 };
const SHEET = `document.querySelector('#post-1 img.kb-bb-img')`;

/* c-n01: the node, the pointer, three clicks. */
await take('c-n01', { node: 'n01', scroll: FIRST_POST_SCROLL }, async (t) => {
  const { cam } = t;
  const id = await cam.evaluate(`window.__shot.node(${NODE_AT.x}, ${NODE_AT.y})`);
  const node = `document.querySelector('[data-hype-node="${id}"]')`;
  const rest = { x: 1210, y: 500 };
  await cam.move(rest.x, rest.y);
  const state = `window.__shot.nodes().some((n) => n.id === ${id} && n.started)`;
  /* A click's result, read from the page a moment after it: the node started, or stopped. */
  const afterClick = (at, want) => ({ at, do: 'act', run: async (ctx) => { await ctx.holds(want ? state : `!(${state})`, 2); } });
  const click1 = t.at('and click') + 0.5, click2 = t.at('click it again') + 0.35, click3 = t.at('Some commentary nodes') + 0.55;
  await t.narrate([
    { at: t.at('Over the last few years') + 0.4, do: 'go', target: { x: 760, y: 470 }, on: true, hold: 0.3 },
    { at: t.at('Half-Life') + 0.2, do: 'go', target: { x: 1060, y: 300 }, on: true, hold: 0.3 },
    { at: t.at("we've been putting all") - 0.2, do: 'go', target: SHEET, seconds: 2.6, hold: 1.0 },
    { at: t.at('And nobody can') + 0.2, do: 'go', target: { x: 1120, y: 520 }, on: true, hold: 0.2 },
    { at: t.at('put your cursor over') + 0.9, do: 'go', target: node, hold: 0.1 },
    { at: click1, do: 'click', target: node, hold: 0.1, then: () => t.mark('node-click') },
    afterClick(click1 + 0.3, true),
    { at: click2, do: 'click', target: node, hold: 0.1, then: () => t.mark('node-click') },
    afterClick(click2 + 0.3, false),
    { at: click3, do: 'click', target: node, hold: 0.1, then: () => t.mark('node-click') },
    afterClick(click3 + 0.3, true),
    { at: t.at('take temporary control') + 0.2, do: 'sweep', box: PAGE, seconds: 1.9, points: 3 },
    { at: t.at("It's best to just"), do: 'go', target: { x: 1290, y: 330 }, on: true, seconds: 1.6, hold: 3 },
  ], { from: rest, seed: 11 });
  if (!(await cam.evaluate(state))) throw new Error('c-n01: the node is not turning at the end');
});

/** Where the page is scrolled to put D-Guy's post 14 at the top of the frame (below the thread's own header). */
const POST_14_SCROLL = `document.querySelector('#post-14').getBoundingClientRect().top + scrollY - ${REVIEW_TOP}`;
/** The five heat reactions and the thumbs up that follows: other players' characters, from the cast and the crowd. */
const HEAT = [['Snuckles', 'tomato'], ['Serious Deer', 'tomato'], ['Ringside', 'vomiting'], ['Front Row', 'tomato'], ['Nosebleeds', 'tomato']];

/* c-n02: the Heel's forecast: the first 21.2 s of the clip (its last line and the gap before it are the rant's). */
await take('c-n02', { node: 'n02', as: 'D-Guy', scroll: POST_14_SCROLL, seconds: 21.2, clipOpts: { dropLast: 1, clipLess: 5.3 } }, async (t) => {
  const { cam } = t;
  const shown = await cam.evaluate(`(() => { const hud = document.querySelector('.kb-hud-glass')?.textContent ?? ''; return { heel: /heel/i.test(hud), only: /only you see this/i.test(hud), review: Boolean(document.querySelector('#post-14')) }; })()`);
  if (!shown.heel || !shown.only || !shown.review) throw new Error(`the HUD or the review is not in frame: ${JSON.stringify(shown)}`);
  const evaluate = (e) => cam.evaluate(e);
  const forecast = (ctx) => ctx.evaluate('window.__shot.forecast()');
  /* What the HUD itself says of the estimate (the orbs' "+0.30 est."), read from the page's text: the take claims the page shows it, so the page is asked, not only the backend. */
  const ghost = () => evaluate(`document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
  const said = (hundredths) => (hundredths === 0 ? '' : `${hundredths > 0 ? '+' : '−'}${(Math.abs(hundredths) / 100).toFixed(2)} est.`);
  /** Waits for the HUD to say what the forecast is, and throws (with what it said before and after) if it never does or never changed. */
  const hudSays = async (ctx, before, now, why) => {
    const want = said(now);
    try { await ctx.holds(`(document.querySelector('.kb-orbs-pending')?.textContent.replace(/\\s+/g, ' ').trim() ?? '') === ${JSON.stringify(want)}`, 2); } catch { throw new Error(`c-n02: the HUD does not show the forecast after ${why}: it says ${JSON.stringify(await ghost())}, the forecast is ${now} (${JSON.stringify(want)})`); }
    if (want === before) throw new Error(`c-n02: the HUD's estimate did not change after ${why}: ${JSON.stringify(before)} then ${JSON.stringify(want)}`);
  };
  if ((await evaluate('window.__shot.forecast()')) !== 0) throw new Error("the Heel's forecast does not start at nothing");
  if ((await ghost()) !== '') throw new Error('the HUD shows an estimate before any reaction');
  /* The reactions are other players': a character each, from the cast and the crowd. They land through the take (one act, in order), the first well before "threw tomatoes at him" so the tally has its tiles when the pointer runs along it. */
  const reactions = HEAT;
  const firstAt = t.at('Playtesters threw');
  const reacting = async (ctx) => {
    let last = 0, hud = '';
    for (const [i, [who, key]] of reactions.entries()) {
      await ctx.until(firstAt + 0.5 * i);
      await ctx.evaluate(`window.__shot.react(${JSON.stringify(who)}, 14, ${JSON.stringify(key)})`);
      const now = await forecast(ctx);
      if (!(now > last)) throw new Error(`${who}'s ${key} did not raise the Heel's forecast: ${last} then ${now}`);
      await hudSays(ctx, hud, now, `${who}'s ${key}`);
      hud = said(now);
      console.log(`c-n02: ${who}'s ${key}: forecast ${last} -> ${now}; the HUD says ${JSON.stringify(hud)}`);
      t.mark('reaction-up');
      last = now;
    }
    await ctx.until(t.at('agreeing with him') + 0.2);
    await ctx.evaluate(`window.__shot.react('Aisle Seat', 14, 'thumbs-up')`);
    const after = await forecast(ctx);
    if (!(after < last)) throw new Error(`the thumbs up did not lower the Heel's forecast: ${last} then ${after}`);
    await hudSays(ctx, hud, after, "Aisle Seat's thumbs-up");
    console.log(`c-n02: Aisle Seat's thumbs-up: forecast ${last} -> ${after}; the HUD says ${JSON.stringify(said(after))}`);
    t.mark('reaction-down');
  };
  const tally = `document.querySelector('#post-14 .kb-reaction')?.parentElement`;
  const thumbs = `[...document.querySelectorAll('#post-14 .kb-reaction')].find((e) => e.textContent.includes('\u{1F44D}'))`;
  await t.narrate([
    { at: 0, do: 'act', run: reacting },
    { at: t.at('secret class') + 0.1, do: 'go', target: "document.querySelector('.kb-hud-class')", hold: 0.5 },
    { at: t.at('threw tomatoes at him'), do: 'trace', target: tally, guess: { x: 402, y: 422, w: 120, h: 34, left: 342, top: 405 }, seconds: 0.6, hold: 0.05 },
    { at: t.at('made money') + 0.1, do: 'go', target: "document.querySelector('.kb-orbs-row')", fx: 0.3, on: true, hold: 0.3 },
    { at: t.at('politely') + 0.05, do: 'go', target: thumbs, guess: { x: 493, y: 422, w: 64, h: 36, left: 461, top: 404 }, on: true, hold: 0.4 },
  ], { from: { x: 1100, y: 330 }, box: SCREEN, seed: 12 });
});

/**
 * c-n02-rant: D-Guy's answer to the thumbs up (the narrator: "And that REALLY got him going!"). The same page a moment later, the six reactions on his
 * post. Half a second on the post with the thumbs up and the hand resting on it, then the thread's foot (the post and the reply box are a thread
 * apart, so it is two framings): he clicks into the reply box with the real pointer and types, as a person furious at a keyboard does, in bursts, one
 * typo put right with Backspace, with real key events. The take ends mid-word; the post is never sent.
 */
const RANT = 'Who was that??? Come out here and fight me like a man and I will show you where to stick that thu';
const REPLY_BOX = `document.querySelector('textarea[aria-label="Your reply"]')`;
await take('c-n02-rant', {
  as: 'D-Guy', scroll: POST_14_SCROLL, seconds: 5.6,
  async prep(cam) {
    /* The state the last take left: five heat reactions and a thumbs up on post 14, made before the film (and before the clocks are frozen). */
    for (const [who, key] of HEAT) await cam.evaluate(`window.__shot.react(${JSON.stringify(who)}, 14, ${JSON.stringify(key)})`);
    await cam.evaluate(`window.__shot.react('Aisle Seat', 14, 'thumbs-up')`);
    await settle(cam, 20);
    await cam.evaluate(`scrollTo(0, ${POST_14_SCROLL})`);
    await settle(cam, 20);
  },
}, async (t) => {
  const { cam } = t;
  const thumbs = `[...document.querySelectorAll('#post-14 .kb-reaction')].find((e) => e.textContent.includes('\u{1F44D}'))`;
  const there = await t.rect(thumbs);
  if (!there) throw new Error('c-n02-rant: the thumbs up is not on his post');
  await cam.move(there.x, there.y);
  await t.shoot(0.5);
  /* The cut: the thread's foot, with the pointer already over the reply box. */
  await t.run(`scrollTo(0, document.documentElement.scrollHeight)`);
  await t.frame();
  const box = await t.rect(REPLY_BOX);
  if (!box) throw new Error('c-n02-rant: the thread has no reply box at its foot');
  await cam.move(box.x, box.y);
  await t.frame();
  await cam.press(); await t.shoot(0.07); await cam.release();
  await t.holds(`document.activeElement === ${REPLY_BOX}`, 2);
  t.mark('typing');
  /* The keys: one to three frames each with now and then a longer breath, and the typo ("fight" as "fihg"... put right with two Backspaces). */
  const rnd = seeded(77);
  const ops = [];
  for (const ch of RANT.replace('fight', 'fi\u0000')) { if (ch === '\u0000') ops.push('h', 'g', 'Backspace', 'Backspace', 'g', 'h', 't'); else ops.push(ch); }
  let typed = '', whoDone = false;
  for (const [i, op] of ops.entries()) {
    cam.key(op);
    typed = op === 'Backspace' ? typed.slice(0, -1) : typed + op;
    await t.frame();
    if (!whoDone && typed === 'Who was that???') { whoDone = true; t.mark('who-was-that'); }
    const gap = (op === ' ' ? 2 : 1) + 1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.12 ? 3 + Math.floor(rnd() * 5) : 0) + (rnd() < 0.06 ? 5 : 0);
    if (i < ops.length - 1) for (let k = 1; k < gap; k++) await t.frame();
  }
  const value = await cam.evaluate(`${REPLY_BOX}.value`);
  if (value !== RANT) throw new Error(`c-n02-rant: the reply box holds ${JSON.stringify(value)}, not the rant up to "thu"`);
  if (!whoDone) throw new Error('c-n02-rant: "Who was that???" was never complete');
  if (await cam.evaluate(`document.querySelectorAll('#post-22').length`)) throw new Error('c-n02-rant: a post was sent');
  await t.shoot(0.04);
});


/** The play of Whoops! on post 1 by the real pointer, up to the Play button of the form and not including its press: the hand opens, Whoops! is armed, the post is pressed, the form scrolled to its foot. */
async function castSteps(t, { move, idleTo, tip = false, at = /** @type {{ hand?: number, arm?: number, post?: number, form?: number }} */ ({}) }) {
  const { cam } = t;
  const POST = '#post-1';
  const click = async () => { await cam.press(); await t.shoot(0.07); await cam.release(); };
  await idleTo(at.hand ?? 0);
  const hudHand = await t.rect(`document.querySelector('.kb-hud-hand')`);
  if (!hudHand) throw new Error('the HUD has no hand button');
  await move(hudHand, 0.7, 31);
  await t.shoot(0.15);
  await click();
  t.mark('hand-open');
  await t.holds(`Boolean(document.querySelector('[role=dialog][aria-label="Your hand"]')) && [...document.querySelectorAll('button')].some((b) => /^Whoops!/.test(b.getAttribute('aria-label') ?? ''))`, 3);
  await idleTo(at.arm ?? 0);
  /* Whoops! is armed. */
  const card = await t.rect(`[...document.querySelectorAll('button')].find((b) => /^Whoops!/.test(b.getAttribute('aria-label') ?? ''))`);
  /* In a close frame (960 wide) the fan's cards lift and slide under the pointer and a real press on Whoops! does not arm it (found by trying: the same press at 1440 does), so a take with `tip` presses it, and the post's slot, as the page's own click: they are the unfilmed preparation, and the filmed beat is the real pointer's press of Play. */
  if (tip) {
    await t.shoot(0.5);
    await t.run(`[...document.querySelectorAll('button')].find((b) => /^Whoops!/.test(b.getAttribute('aria-label') ?? '')).click()`);
  } else {
    const cardAt = { x: card.x + 2, y: card.y - 30 };
    await move(cardAt, 0.65, 32);
    await t.shoot(0.2);
    await click();
  }
  t.mark('armed');
  await t.holds(`[...document.querySelectorAll('${POST} a, ${POST} button')].some((b) => b.getAttribute('aria-label') === 'Play Whoops! on post 1')`, 3);
  await idleTo(at.post ?? 0);
  /* The post is pressed: the slot at its corner, where a back is. */
  const slot = await t.rect(`[...document.querySelectorAll('${POST} a, ${POST} button')].find((b) => b.getAttribute('aria-label') === 'Play Whoops! on post 1')`);
  if (tip) {
    await t.run(`[...document.querySelectorAll('${POST} a, ${POST} button')].find((b) => b.getAttribute('aria-label') === 'Play Whoops! on post 1').click()`);
  } else {
    await move({ x: slot.x - 1, y: slot.y + 1 }, 0.65, 33);
    await t.shoot(0.2);
    await click();
  }
  t.mark('post-pressed');
  await t.holds(`Boolean(document.querySelector('[role=dialog] button') && [...document.querySelectorAll('[role=dialog] button')].some((b) => /^Play as/.test(b.textContent)))`, 3);
  /* The play form asks for an ink color (the default is chosen) and a message (optional); a player reads it, scrolls to its foot and plays. */
  const form = tip ? { x: 420, y: 200 } : { x: 1190, y: 500 };
  await idleTo(at.form ?? 0);
  await move(form, 0.6, 34, false);
  await t.shoot(0.25);
  await cam.wheel(600);
  await t.shoot(0.3);
}

/** What a real-pointer cast is held to once the Play button is pressed: caught, with no ink on the post. */
async function assertCaught(t) {
  const POST = '#post-1';
  await t.holds(`window.__kbStage.fake.cardsOn(window.__kbStage.acts.first, 30).then((a) => a.some((x) => x.kind === 'card' && x.payload.card === 'whoops'))`, 4);
  const caught = await t.run(`window.__kbStage.fake.cardsOn(window.__kbStage.acts.first, 30).then((acts) => acts.filter((x) => x.kind === 'card' && x.payload.card === 'whoops').map((x) => ({ caught: x.payload.caught !== undefined, set: x.payload.caught ?? null })))`);
  if (caught.length !== 1 || !caught[0].caught) throw new Error(`the cast was not caught: ${JSON.stringify(caught)}`);
  t.mark('caught');
  return async () => {
    const inks = await t.run(`document.querySelectorAll('${POST} canvas.kb-whoops-ink').length`);
    if (inks !== 0) throw new Error(`${inks} ink canvases are on the post: the cast landed`);
  };
}

/** The caster's side of a catch: the alert the backend writes (the stage's `told` writes what the in-memory backend does not), its words read from the page. */
async function assertTold(t) {
  await t.run(`window.__shot.told('D-Guy', 1)`);
  t.mark('alert');
  const said = await t.run(`document.querySelector('.kb-toasts')?.textContent.trim() ?? ''`);
  if (!said.includes('had a Reversal waiting')) throw new Error(`the caught alert's words are not in frame: "${said}"`);
  console.log('c-n03: the alert says:', said);
}

/* c-n03: the gate, by the real pointer, as a player does it; the hand looser than the first build's. */
await take('c-n03', { node: 'n03', as: 'D-Guy', quiet: ['host'], scroll: FIRST_POST_SCROLL }, async (t) => {
  const { cam } = t;
  const MARK = '#post-1 .kb-mark';
  let pos = { x: 1090, y: 300 };
  await cam.move(pos.x, pos.y);
  /* The hand goes where the take's clock says and idles while it waits: small moves and moments of rest, never a held stillness. */
  let seed = 40;
  const idleTo = async (secs) => { const left = secs - t.now(); if (left > 0.05) { const p = idle(pos, left, { seed: seed++, box: SCREEN, radius: 120 }); await t.follow(p); pos = { ...p.end }; } };
  const move = async (to, secs, s, settleOn = true) => { await t.follow(reach(pos, to, secs, { seed: s, settle: settleOn, box: SCREEN })); pos = { ...to }; };
  /* The cast lands (the page's `caught`) where the captions say "Here, the gate": the press is a little before it. */
  const playAt = t.at('Here, the gate') - CAST_LEAD;
  await castSteps(t, { move, idleTo, at: { hand: 0.3, arm: 1.9, post: 0, form: 0 } });
  const go = await t.rect(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^Play as/.test(b.textContent))`);
  if (!go) throw new Error('the play form has no Play button');
  await idleTo(playAt - 0.9);
  await move(go, 0.7, 35);
  await t.shoot(0.2);
  await cam.press(); await t.shoot(0.07); await cam.release();
  t.mark('play-pressed');
  const noInk = await assertCaught(t);
  await t.shoot(0.9);
  await noInk();
  /* The toast's words are in frame; the hand has gone to the card back at the post's corner and circles it where "Every card back looks the same" is said. */
  await assertTold(t);
  const back = await t.rect(`document.querySelector('${MARK}')`);
  if (!back) throw new Error('the post has no card back at its corner');
  const circleAt = t.at('Every card back looks the same');
  const aim = { x: back.x - 64, y: back.y + 48 };
  await idleTo(circleAt - 1.1);
  await move(aim, 1.0, 36);
  const ring = loop(pos, { x: back.x, y: back.y }, 3.0, { seed: 37, radius: 54, box: SCREEN });
  await t.follow(ring);
  pos = { ...ring.end };
  /* Nothing happens after "Playtesters described this as unfair.": the hand goes to the alert and rests on it. */
  const toast = await t.rect(`document.querySelector('.kb-toasts')`);
  if (!toast) throw new Error('c-n03: the alert is gone before the hand rests on it');
  await idleTo(t.at('Playtesters described') - 0.5);
  await move({ x: toast.x, y: toast.y }, 0.9, 38);
  await t.follow(rest(pos, Math.max(0.1, t.owed - t.now()), { seed: 39, box: SCREEN }));
});

/**
 * The cut-in of node 3, close (640 by 360 at 4.5 times density: the page drawn large, as a browser zoomed in draws it, so the effect's real pointer
 * math holds). The page is prepared with the real pointer on frames nothing keeps (the hand opened, Whoops! armed, the post pressed, the form
 * scrolled to its foot), and the take rolls with the hand about to press Play.
 */
async function closeCast(t, { hideHud }) {
  const { cam } = t;
  let pos = { x: 460, y: 180 };
  await cam.move(pos.x, pos.y);
  let seed = 60;
  const idleTo = async () => {};
  const move = async (to, secs, s, settleOn = true) => { await t.follow(reach(pos, to, secs, { seed: s, settle: settleOn, box: { x: 0, y: 0, w: 640, h: 360 } })); pos = { ...to }; };
  await castSteps(t, { move, idleTo, tip: true, at: {} });
  void seed;
  if (hideHud) await cam.evaluate(`(() => { const s = new CSSStyleSheet(); s.insertRule('.kb-hud-glass { display: none !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; })()`);
  const go = await t.rect(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^Play as/.test(b.textContent))`);
  if (!go) throw new Error('the play form has no Play button');
  return { go, pos: () => pos, move };
}

await take('c-n03-alert', { as: 'D-Guy', quiet: ['host'], scroll: 235, ...CLOSE, late: true, seconds: 3 }, async (t) => {
  const { cam } = t;
  const { go, move } = await closeCast(t, { hideHud: false });
  await move(go, 0.7, 53);
  await t.shoot(0.15);
  await cam.press(); await t.shoot(0.07); await cam.release();
  await assertCaught(t);
  await t.shoot(1.2);
  t.roll();
  await t.shoot(0.4);
  await assertTold(t);
  await t.until(3);
});
