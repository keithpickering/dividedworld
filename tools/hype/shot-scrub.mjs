/**
 * The running gag, shots S1 to S6 (docs/plans/2026-11-14-hype-video-storyboard.md): one post, coat after coat of ink, and a poster who
 * gets through them, comes within a patch of having the post back, and is buried again. Each round is filmed long; the edit takes what
 * it needs.
 *
 *   node tools/hype/shot-scrub.mjs --round 1|2|3 [--seed n] [--still] [--skin default] [--most seconds] [--port 4319]
 *
 *   round 1  three Whoops! land on the post, one after another; a steady hand digs through all three to the first of the words
 *   round 2  about half the post is back and the rest is going when a fourth coat lands on top of everything
 *   round 3  a few patches from clean; the post is clean for one beat, and then three more coats land
 *
 * The hand is `buzz` (tools/hype/pointer.mjs): one unbroken line of arcs that works its way around the ink, headed for the coat on top
 * wherever it is thickest. It presses on ink, since a press on the post's bare words selects them as on any page, and it lifts and presses
 * again to start on the coat below, since a stroke washes only the coat it began on (Effect.tsx's `begin`).
 *
 * A coat takes longer to wash than a round has, so rounds 2 and 3 open on the post as the time between visits would have left it
 * (`left`: coats washed clean, and others washed down to a patch), and each round's own washing is real.
 *
 * Writes .runs/hype/scrub-<round>.mp4 (with --still, one picture of the round's opening frame and no film).
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { buzz, glide, seeded } from './pointer.mjs';
import { BUILT, OUT, flag, openStage, settle } from './stage.mjs';

const round = Number(flag('round', 1));
const seed = Number(flag('seed', 41 * round));
const still = process.argv.includes('--still');
const most = Number(flag('most', 0));

/* The coats, in the order they land: who throws each, its color, the splat's own seed and what its thrower says. */
const COATS = [
  ['D-Guy', '#ff2bd6', 101, 'classy'],
  ['Serious Deer', '#19e3ff', 202, 'eleven colors'],
  ['Chadluminum', '#ffd93d', 303, 'with love'],
  ['D-Guy', '#7dff3a', 404, 'room for one more'],
  ['Human Josh', '#ff7a1a', 505, 'as a human'],
  ['Serious Deer', '#9b5cff', 606, 'twelve colors now'],
  ['Chadluminum', '#ff3b3b', 707, 'still proud of you'],
];
const land = (n) => `window.__shot.splat(${n}, '${COATS[n - 1][0]}', '${COATS[n - 1][1]}', ${COATS[n - 1][2]}, '${COATS[n - 1][3]}')`;

/**
 * A round: what the visits before it left (`left`), what the hand is like (`energy`), and what happens (`beats`, each run once when
 * its `when` first holds; a beat may `land` coats, `stun` the hand for some seconds, `lift` it for good, or `end` the round after some more).
 */
const ROUNDS = {
  1: {
    energy: 0.5, enter: 3.0, arrive: 4.3, most: 15,
    beats: [{ when: (s) => s.t >= 0.6, land: [1] }, { when: (s) => s.t >= 1.35, land: [2] }, { when: (s) => s.t >= 2.1, land: [3] }],
  },
  2: {
    energy: 0.72, enter: 0.2, arrive: 0.6, most: 24,
    /* About half the post is back: the three coats still lie over its right side, each to its own ragged edge. */
    left: { coats: 3, clean: [], wash: [[1, 7, { x0: 0.5, x1: 1.2, y0: -0.25, y1: 1.25 }], [2, 7, { x0: 0.44, x1: 1.2, y0: -0.2, y1: 1.3 }], [3, 7, { x0: 0.56, x1: 1.2, y0: -0.3, y1: 1.2 }]] },
    beats: [
      /* It is going well. Then a fourth coat lands on all of it, and the hand stops where it is. */
      { when: (s) => s.t >= 5.2, land: [4], stun: 0.8, end: 3.6 },
    ],
  },
  3: {
    energy: 0.97, enter: 0.15, arrive: 0.45, most: 30,
    /* A few patches from clean: the fourth coat down to a blob, and scraps of the first two under and beside it. */
    left: {
      coats: 4, clean: [3],
      wash: [[1, 7, { x0: 0.5, x1: 0.8, y0: 0.3, y1: 0.85 }], [2, 7, { x0: 0.16, x1: 0.36, y0: 0.42, y1: 0.9 }], [4, 7, { x0: 0.3, x1: 0.66, y0: 0.12, y1: 0.7 }]],
    },
    beats: [
      /* Clean. One beat on the words. Then three more, faster each time. */
      { when: (s) => s.live.length === 0, lift: true },
      { when: (s) => s.live.length === 0 && s.sinceChange >= 1.25, land: [5] },
      { when: (s) => s.landed >= 5 && s.sinceLand >= 0.62, land: [6] },
      { when: (s) => s.landed >= 6 && s.sinceLand >= 0.4, land: [7], end: 1.3 },
    ],
  },
};
const R = ROUNDS[round];
if (!R) throw new Error(`there is no round ${round}: the rounds are 1, 2 and 3`);

const cam = await openStage({ skin: flag('skin', 'default'), css: { width: 1120, height: 630 }, quiet: ['toasts', 'host', 'hud', 'selection'] });
try {
  await cam.evaluate('window.__shot.place(150)');
  let landed = 0;
  if (R.left) {
    const plays = [];
    for (let n = 1; n <= R.left.coats; n++) plays.push(await cam.evaluate(land(n)));
    landed = R.left.coats;
    await settle(cam, 60);
    for (const n of R.left.clean) await cam.evaluate(`window.__shot.clean('${plays[n - 1]}')`);
    for (const [n, passes, keep] of R.left.wash) await cam.evaluate(`window.__shot.wash('${plays[n - 1]}', ${passes}, ${JSON.stringify(keep)})`);
    await settle(cam, 90);
    await cam.until(BUILT, { label: 'the coats left by the rounds before' });
  }
  await settle(cam, 30);
  await cam.drawPointer();
  /* Framed last, once everything that changes the page's height above the post has been drawn. */
  const box = await cam.evaluate('window.__shot.place(150)');
  await settle(cam, 20);
  console.log(`round ${round}, seed ${seed}; the body of the post:`, box, await cam.evaluate('window.__shot.state()'));

  if (still) {
    writeFileSync(`${OUT}/scrub-${round}-still.jpg`, await cam.frame(true));
    console.log('errors:', cam.errors);
  } else {
    const film = openFilm({ path: `${OUT}/scrub-${round}.mp4`, fps: cam.fps });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps, rnd = seeded(seed + 7);
    const off = { x: cam.css.width + 30, y: box.y + box.h * 1.5 };
    const first = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 };
    const approach = glide(off, first, R.arrive - R.enter, { seed, settle: false });
    const hand = buzz({ box, seed, from: first, energy: R.energy });
    const within = (p) => p.x > box.x + 2 && p.x < box.x + box.w - 2 && p.y > box.y + 2 && p.y < box.y + box.h - 2;
    /* The hand's eye: the ink as cells, looked at a few times a second; which coat is on top at a point, and where the work is. */
    let map = null, aim = -1, aimUntil = 0;
    const cellAt = (p) => {
      if (!map || !within(p)) return -1;
      return Math.min(map.rows - 1, Math.floor(((p.y - box.y) / box.h) * map.rows)) * map.cols + Math.min(map.cols - 1, Math.floor(((p.x - box.x) / box.w) * map.cols));
    };
    const center = (i) => ({ x: box.x + ((i % map.cols) + 0.5) * (box.w / map.cols), y: box.y + (Math.floor(i / map.cols) + 0.5) * (box.h / map.rows) });
    const look = (p, t) => {
      const high = Math.max(...map.top);
      if (high < 0) { aim = -1; return; }
      if (aim >= 0 && map.top[aim] === high && map.thick[aim] > 0.2 && t < aimUntil) return;
      /* The coat on top, where it is thick and near: one of the best few, so the hand does not always take the same line. */
      const ranked = map.top.map((l, i) => (l === high ? [i, map.thick[i] / (1 + Math.hypot(center(i).x - p.x, center(i).y - p.y) / 260)] : null)).filter(Boolean).sort((a, b) => b[1] - a[1]);
      aim = ranked[Math.floor(rnd() * Math.min(5, ranked.length))][0];
      aimUntil = t + 0.45 + 0.5 * rnd();
      hand.seek(center(aim));
    };

    const state = { t: 0, live: [], landed, sinceChange: 0, sinceLand: 0 };
    const done = new Set();
    const cap = most || R.most;
    let endAt = Infinity, stunnedUntil = 0, lifted = false, down = false, stroke = -1, p = off, changedAt = 0, landedAt = 0, layers = '';
    const started = Date.now();
    await cam.move(off.x, off.y);
    let f = 0;
    for (; f / F < Math.min(endAt, cap); f++) {
      const t = f / F;
      if (f % 6 === 0) {
        const now = (await cam.evaluate('window.__shot.state().layers')) ?? '';
        if (now !== layers) { layers = now; changedAt = t; console.log(`  ${t.toFixed(2)}s: ${now || 'no coats'}`); }
        if (f % 12 === 0 || !map) map = await cam.evaluate('window.__shot.ink()');
      }
      Object.assign(state, { t, live: layers.split(' ').flatMap((l, i) => (l === 'live' ? [i] : [])), landed, sinceChange: t - changedAt, sinceLand: t - landedAt });
      for (const [i, beat] of R.beats.entries()) {
        if (done.has(i) || !beat.when(state)) continue;
        done.add(i);
        for (const n of beat.land ?? []) { await cam.evaluate(land(n)); landed = n; landedAt = t; state.landed = n; state.sinceLand = 0; }
        if (beat.stun) stunnedUntil = t + beat.stun;
        if (beat.lift) lifted = true;
        if (beat.end !== undefined) endAt = t + beat.end;
      }
      if (t >= R.enter && t < R.arrive) {
        p = approach.at(t - R.enter);
        await cam.move(p.x, p.y);
      } else if (t >= R.arrive && lifted) {
        /* Nothing left to scrub: the hand lets go and drifts off the words a little, and stays there for what comes. */
        if (down) { await cam.release(); down = false; }
        p = { x: p.x + (box.x + box.w * 0.8 - p.x) * 0.03, y: p.y + (box.y + box.h * 0.62 - p.y) * 0.03 };
        await cam.move(p.x, p.y);
      } else if (t >= R.arrive && t >= stunnedUntil) {
        look(p, t);
        for (let half = 0; half < 2; half++) {
          p = hand.step(0.5 / F);
          await cam.move(p.x, p.y);
          const at = cellAt(p), top = at < 0 ? -1 : map.top[at];
          if (down && (!within(p) || !state.live.includes(stroke) || (top >= 0 && top !== stroke && map.thick[at] > 0.3))) { await cam.release(); down = false; }
          /* The cells say roughly where ink is; the press is made only where there is ink under the very point, or it would select the words. */
          else if (!down && top >= 0 && await cam.evaluate(`window.__shot.inkAt(${p.x}, ${p.y})`)) { await cam.press(); down = true; stroke = top; }
        }
      }
      await film.write(await cam.frame(true));
      if (f % 120 === 0) console.log(`frame ${f} at ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    await film.end();
    console.log(`filmed ${f} frames (${(f / F).toFixed(1)}s) in ${((Date.now() - started) / 1000).toFixed(0)}s; errors:`, cam.errors);
  }
} finally {
  await cam.close();
}
