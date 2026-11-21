/**
 * The narrator's pointer (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R5): the cue times read from the captions and the pure
 * path math under `narrate`. A path is `{ seconds, at(t), end }`; each kind is held to the same three claims: it starts where the hand is, it
 * stays inside the bounds it was given, and no frame at 60 fps moves it further than a calm hand would. The paths are sampled at 60 fps, as a
 * take draws them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueTimes, phraseTime, reach, loop, rest, idle, sweep, scrollCurve, narrate, seeded } from './pointer.mjs';

const FPS = 60;
const BOX = { x: 0, y: 0, w: 1440, h: 810 };
/** How far the hand may travel in one frame (CSS px): 30 px a frame is 1800 px a second, a brisk flick, and part one is calm. */
const MAX_STEP = 30;

/** Samples `path` at the film's frame rate, ends included. */
const sample = (path) => {
  const out = [];
  for (let i = 0, n = Math.round(path.seconds * FPS); i <= n; i++) out.push(path.at(i / FPS));
  return out;
};
const near = (a, b, tol, what = '') => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= tol, `${what} (${a.x.toFixed(1)}, ${a.y.toFixed(1)}) is not within ${tol} of (${b.x}, ${b.y})`);
/** The claims every path makes. */
function sound(path, from, label, { box = BOX, maxStep = MAX_STEP } = {}) {
  const pts = sample(path);
  near(pts[0], from, 0.5, `${label}: starts`);
  for (const [i, p] of pts.entries()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: frame ${i} is not a point`);
    assert.ok(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h, `${label}: frame ${i} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) leaves the bounds`);
    if (i > 0) assert.ok(Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) <= maxStep, `${label}: frame ${i} jumps ${Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y).toFixed(1)} px`);
  }
  near(pts.at(-1), path.end, 0.5, `${label}: ends where it says`);
  return pts;
}

test('a caption starts at its share of the node by characters, and the lines together are the whole clip', () => {
  const lines = ['abcd', 'efghij', 'klmnopqrst'];
  const t = cueTimes(lines, 20);
  /* The node is 4 + 6 + 10 = 20 characters (the edit counts no spaces); a line starts where the characters before it end. */
  assert.deepEqual(t.map((c) => c.line), lines);
  assert.equal(t[0].at, 0);
  assert.ok(Math.abs(t[1].at - 20 * 4 / 20) < 1e-9);
  assert.ok(Math.abs(t[2].at - 20 * 10 / 20) < 1e-9);
  assert.ok(Math.abs(t[2].end - 20) < 1e-9);
  assert.ok(Math.abs(t[0].end - t[1].at) < 1e-9, 'a line ends where the next begins');
});

test('a phrase starts at its character within the joined text, or throws when the captions do not hold it', () => {
  const lines = ['Hello there,', 'put your cursor over it and click.'];
  const total = 'Hello there,'.length + 'put your cursor over it and click.'.length;
  /* A phrase in the second line starts after all of the first's characters (no space counted) and its own offset in the line. */
  assert.ok(Math.abs(phraseTime(lines, 10, 'put your cursor') - 10 * 12 / total) < 1e-9);
  assert.ok(Math.abs(phraseTime(lines, 10, 'and click') - 10 * (12 + 'put your cursor over it '.length) / total) < 1e-9);
  /* The caption's start and a phrase at its head are the same moment, as the edit shows the caption. */
  assert.ok(Math.abs(phraseTime(lines, 10, 'put your cursor') - cueTimes(lines, 10)[1].at) < 1e-9);
  assert.throws(() => phraseTime(lines, 10, 'a phrase nobody says'), /a phrase nobody says/);
  /* The first of two matches is the one meant, unless a start is asked for. */
  assert.ok(phraseTime(['go go go'], 9, 'go', 1) > phraseTime(['go go go'], 9, 'go'));
});

test('the same seed draws the same path, and another seed another', () => {
  const a = sample(reach({ x: 100, y: 100 }, { x: 900, y: 500 }, 1.5, { seed: 4 }));
  const b = sample(reach({ x: 100, y: 100 }, { x: 900, y: 500 }, 1.5, { seed: 4 }));
  const c = sample(reach({ x: 100, y: 100 }, { x: 900, y: 500 }, 1.5, { seed: 5 }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const r1 = seeded(7), r2 = seeded(7);
  assert.equal(r1(), r2());
});

test('a reach starts and ends where asked, bows, runs a little past the target and comes back, and is never a straight line between coordinates', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const from = { x: 120, y: 700 }, to = { x: 1250, y: 90 };
    const path = reach(from, to, 1.9, { seed });
    const pts = sound(path, from, `reach ${seed}`);
    near(path.end, to, 0.001);
    /* How far the line strays from the chord: a hand bows. */
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const stray = Math.max(...pts.map((p) => Math.abs((to.x - from.x) * (from.y - p.y) - (from.x - p.x) * (to.y - from.y)) / len));
    assert.ok(stray > 4, `reach ${seed} is a straight line (strays ${stray.toFixed(1)} px)`);
    /* It passes the target along the line before it settles, by a few px, never by many. */
    const along = pts.map((p) => ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / len);
    const past = Math.max(...along) - len;
    assert.ok(past > 0.5 && past < 18, `reach ${seed} overshoots by ${past.toFixed(1)} px`);
  }
});

test('a reach starts and stops at rest: its first and last frames move less than its middle ones', () => {
  const pts = sample(reach({ x: 100, y: 100 }, { x: 1000, y: 600 }, 1.8, { seed: 9 }));
  const step = (i) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  const mid = Math.max(...pts.slice(0, -1).map((_, i) => step(i)));
  assert.ok(step(0) < mid * 0.1, `the first frame moves ${step(0).toFixed(2)} of a peak ${mid.toFixed(2)}`);
  assert.ok(step(pts.length - 2) < mid * 0.1, 'the last frame moves too much to be a stop');
});

test('a very short reach, and one of no distance, are still sound', () => {
  sound(reach({ x: 300, y: 300 }, { x: 306, y: 297 }, 0.4, { seed: 2 }), { x: 300, y: 300 }, 'short');
  sound(reach({ x: 300, y: 300 }, { x: 300, y: 300 }, 0.4, { seed: 2 }), { x: 300, y: 300 }, 'none');
});

test('a loop circles a word: it leaves from where the hand is, winds about the center on both sides, and ends on its ring', () => {
  const center = { x: 700, y: 400 }, from = { x: 560, y: 520 };
  for (const seed of [1, 2, 3]) {
    const path = loop(from, center, 2.6, { seed, radius: 50 });
    const pts = sound(path, from, `loop ${seed}`);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    /* Wound round the center: points on every side of it. */
    assert.ok(xs.some((x) => x < center.x - 25) && xs.some((x) => x > center.x + 25) && ys.some((y) => y < center.y - 15) && ys.some((y) => y > center.y + 15), `loop ${seed} does not circle`);
    assert.ok(Math.hypot(path.end.x - center.x, path.end.y - center.y) < 80, 'the loop ends beside the word');
    /* It is not a circle drawn with a compass: the radius is not constant. */
    const radii = pts.slice(Math.round(pts.length * 0.4)).map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    assert.ok(Math.max(...radii) - Math.min(...radii) > 6, 'a perfect circle');
  }
});

test('a rest drifts a few px and no more, and is quiet', () => {
  const at = { x: 640, y: 360 };
  const path = rest(at, 2.5, { seed: 3 });
  const pts = sound(path, at, 'rest', { maxStep: 1 });
  assert.ok(Math.max(...pts.map((p) => Math.hypot(p.x - at.x, p.y - at.y))) <= 6, 'a rest wanders');
  assert.ok(Math.max(...pts.map((p) => Math.hypot(p.x - at.x, p.y - at.y))) > 0.4, 'a rest is a dead still pointer');
});

test('an idle hand fills exactly the time it is given with small moves and moments of rest, inside its box, and never frantic', () => {
  const box = { x: 700, y: 120, w: 600, h: 500 };
  for (const [seconds, seed] of [[0.5, 1], [1.2, 2], [3.7, 3], [8, 4], [14, 5]]) {
    const from = { x: 900, y: 300 };
    const path = idle(from, seconds, { seed, box });
    assert.ok(Math.abs(path.seconds - seconds) < 1e-9, `idle ${seconds}: lasts ${path.seconds}`);
    const pts = sound(path, from, `idle ${seconds}`, { box, maxStep: 12 });
    if (seconds >= 8) {
      const moved = Math.max(...pts.map((p) => Math.hypot(p.x - from.x, p.y - from.y)));
      assert.ok(moved > 25, `idle ${seconds} never moves (${moved.toFixed(1)} px)`);
      /* "There are still moments of a second or two": a stretch of a full second with almost no motion. */
      let still = false;
      for (let i = 0; i + FPS <= pts.length; i += 6) if (Math.hypot(pts[i + FPS - 1].x - pts[i].x, pts[i + FPS - 1].y - pts[i].y) < 5) still = true;
      assert.ok(still, `idle ${seconds} has no moment of rest`);
    }
  }
});

test('a sweep passes through loose waypoints of a box without stopping, ending where it says', () => {
  const box = { x: 100, y: 100, w: 1000, h: 500 };
  const from = { x: 700, y: 400 };
  const path = sweep(from, box, 3.2, { seed: 8, points: 4 });
  const pts = sound(path, from, 'sweep', { box: { x: 0, y: 0, w: 1440, h: 810 } });
  const xs = pts.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 250, 'a sweep covers little of the box');
  assert.ok(path.end.x >= box.x && path.end.x <= box.x + box.w, 'ends in the box');
});

test('a scroll curve goes down and back: it starts at nothing, reaches its depth, comes home, and the page is never moved more than a few px a frame', () => {
  const curve = scrollCurve({ depth: 110, down: 1.1, hold: 0.7, back: 1.3 });
  assert.ok(Math.abs(curve.seconds - 3.1) < 1e-9);
  assert.equal(curve.at(0), 0);
  assert.ok(Math.abs(curve.at(curve.seconds) - 0) < 1e-9, 'it comes home');
  assert.ok(Math.abs(curve.at(1.1 + 0.2) - 110) < 1e-6, 'it holds at its depth');
  let prev = 0, top = 0;
  for (let i = 1, n = Math.round(curve.seconds * FPS); i <= n; i++) { const v = curve.at(i / FPS); top = Math.max(top, Math.abs(v - prev)); prev = v; }
  assert.ok(top <= 6, `the page moves ${top.toFixed(1)} px in a frame`);
});

/** A camera that only records, and a take that counts frames. */
function fakeTake() {
  const calls = [];
  let f = 0;
  const cam = {
    move: async (x, y) => { calls.push({ kind: 'move', x, y, frame: f }); },
    press: async () => { calls.push({ kind: 'press', frame: f }); },
    release: async () => { calls.push({ kind: 'release', frame: f }); },
    wheel: async (dy) => { calls.push({ kind: 'wheel', dy, frame: f }); },
    evaluate: async (expr) => (expr.includes('getBoundingClientRect') ? { x: 800, y: 300, w: 80, h: 80, left: 760, top: 260 } : null),
  };
  const io = { frame: async () => { f++; }, now: () => f / FPS, fps: FPS, from: { x: 1200, y: 500 }, box: BOX, seed: 5, until: 12 };
  return { cam, io, calls, frames: () => f };
}

test('narrate runs the cues on the take\'s clock: it fills to the end, goes to a target and clicks at its cue, and never jumps', async () => {
  const { cam, io, calls, frames } = fakeTake();
  const acts = [];
  let pressedAt = -1;
  await narrate(cam, [
    { at: 2, do: 'go', target: 'node', note: 'near' },
    { at: 5, do: 'click', target: 'node', then: (ctx) => { pressedAt = ctx.now(); } },
    { at: 7, do: 'act', run: async (ctx) => { acts.push(ctx.now()); } },
  ], io);
  assert.ok(frames() >= 12 * FPS, 'it runs until the take is owed');
  const moves = calls.filter((c) => c.kind === 'move');
  for (let i = 1; i < moves.length; i++) assert.ok(Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y) <= MAX_STEP, `move ${i} jumps`);
  const press = calls.find((c) => c.kind === 'press');
  assert.ok(press, 'no click');
  assert.ok(press.frame / FPS >= 5 - 0.01 && press.frame / FPS <= 5.8, `the click comes at ${(press.frame / FPS).toFixed(2)} s, not at its cue`);
  assert.ok(Math.abs(pressedAt - press.frame / FPS) < 0.02, `the press hook ran at ${pressedAt}`);
  const release = calls.find((c) => c.kind === 'release');
  assert.ok(release.frame > press.frame, 'a press is let go');
  /* The pointer was on the node, not near it, for the click. */
  const before = moves.filter((m) => m.frame <= press.frame).at(-1);
  near(before, { x: 800, y: 300 }, 20, 'the click');
  assert.equal(acts.length, 1);
  assert.ok(acts[0] >= 7 - 0.02 && acts[0] <= 7.1, `the act runs at ${acts[0]}`);
});

test('narrate scrolls a little with the wheel and brings the page home, and an act that throws stops the take', async () => {
  const a = fakeTake();
  await narrate(a.cam, [{ at: 1, do: 'scroll', depth: 90, down: 1, hold: 0.5, back: 1 }], { ...a.io, until: 6 });
  const wheels = a.calls.filter((c) => c.kind === 'wheel');
  assert.ok(wheels.length > 20);
  assert.ok(Math.abs(wheels.reduce((s, w) => s + w.dy, 0)) <= 1, 'the page does not come home');
  assert.ok(Math.max(...wheels.map((w) => Math.abs(w.dy))) <= 6);
  const b = fakeTake();
  await assert.rejects(narrate(b.cam, [{ at: 1, do: 'act', run: async () => { throw new Error('the page said no'); } }], { ...b.io, until: 6 }), /the page said no/);
});

test('a still narrator rests where it has nothing to do; a target the page lacks is planned by its guess; a go can be given its length', async () => {
  const a = fakeTake();
  await narrate(a.cam, [], { ...a.io, until: 5, still: true });
  for (const m of a.calls.filter((c) => c.kind === 'move')) near(m, a.io.from, 7, 'a still hand');
  const b = fakeTake();
  let asked = 0;
  b.cam.evaluate = async (expr) => (expr.includes('getBoundingClientRect') && ++asked > 1 ? { x: 400, y: 200, w: 10, h: 10, left: 395, top: 195 } : null);
  const arrived = [];
  await narrate(b.cam, [
    { at: 4, do: 'go', target: 'later', guess: { x: 380, y: 210, w: 10, h: 10, left: 375, top: 205 }, on: true, seconds: 1.5, hold: 0.2 },
    { at: 4.2, do: 'act', run: async (ctx) => { arrived.push(ctx.now()); await ctx.until(4.5); arrived.push(ctx.now()); } },
  ], { ...b.io, until: 8 });
  const moves = b.calls.filter((c) => c.kind === 'move');
  const at4 = moves.filter((m) => Math.abs(m.frame / FPS - 4) < 0.05).at(-1);
  near(at4, { x: 400, y: 200 }, 12, 'the go arrives at the real target at its cue, after the page answered');
  assert.ok(arrived[1] >= 4.5 - 1e-9 && arrived[1] < 4.6, 'an act waits on the take clock');
});

test('a take that ends between two frames ends: a gap shorter than a frame is drawn as one frame, never spun on', { timeout: 5000 }, async () => {
  for (const until of [5.004, 5.0083, 5.012]) {
    const a = fakeTake();
    await narrate(a.cam, [], { ...a.io, until });
    assert.ok(a.frames() <= Math.ceil(until * FPS) + 1, `${until}: ${a.frames()} frames`);
    const b = fakeTake();
    await narrate(b.cam, [], { ...b.io, until, still: true });
    assert.ok(b.frames() <= Math.ceil(until * FPS) + 1);
  }
});
