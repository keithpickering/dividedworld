/**
 * The hype video's hand: where the pointer is at each moment of a shot, made to move like a person's and not like a function
 * (docs/plans/2026-11-14-hype-video-storyboard.md, "How the scrubbing should move"). Every path is drawn from a seeded source, so a take
 * can be filmed again exactly and a new seed is a new take.
 *
 * Everything here is plain arithmetic on CSS px and seconds: no page, no camera.
 */

/** A seeded source of numbers in [0, 1): the same seed, the same take. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, u) => a + (b - a) * u;
/** How a hand covers a distance: slow off the mark, fast through the middle, slow onto the target. */
const reachEase = (u) => u * u * u * (10 - 15 * u + 6 * u * u);

/** A move from `a` to `b` that bows to one side, as an arm swings on its elbow. */
function swing(a, b, bow) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return (u) => {
    const e = reachEase(u), off = bow * Math.sin(Math.PI * e);
    return { x: lerp(a.x, b.x, e) + nx * off, y: lerp(a.y, b.y, e) + ny * off };
  };
}

/** Smooth noise in [-1, 1] along a line: a seeded value at each whole number, eased between them. Each call makes its own line. */
function drift(rnd) {
  const knots = [];
  const at = (i) => { while (knots.length <= i) knots.push(rnd() * 2 - 1); return knots[i]; };
  return (x) => {
    const i = Math.floor(x), u = x - i, e = u * u * (3 - 2 * u);
    return lerp(at(i), at(i + 1), e);
  };
}

/**
 * A scrubbing hand that never stops: one continuous line of arcs, back and forth over a spot that itself wanders the box, as a fly
 * works its way around a window. There are no separate gestures and no pauses; what varies, smoothly and all the time, is how wide the
 * stroke is, which way it leans, how round it is, how fast it goes, and where it is headed.
 *
 *   box      { x, y, w, h } in CSS px: where the hand works
 *   energy   0 to 1: a calm hand makes small, slower strokes and moves on slowly; a desperate one makes wide, fast ones and darts
 *   from     where the hand starts
 *
 * `step(dt)` moves the hand on by `dt` seconds and answers where it is. `seek(point)` says where the work is (a patch of ink): the hand
 * heads there, and wanders the box when it is told nothing.
 */
export function buzz({ box, seed, from, energy = 0.5 }) {
  const rnd = seeded(seed);
  const nLean = drift(rnd), nWide = drift(rnd), nRound = drift(rnd), nPace = drift(rnd), nEight = drift(rnd), nX = drift(rnd), nY = drift(rnd);
  const hz = lerp(2.1, 4.6, energy), wide = lerp(46, 120, energy), roam = lerp(110, 420, energy);
  let t = 0, phase = rnd() * Math.PI * 2;
  let spot = { ...from }, vel = { x: 0, y: 0 };
  let goal = { x: box.x + box.w * 0.5, y: box.y + box.h * 0.5 }, goalUntil = 0, sought = null, grow = 0;

  return {
    seek(point) { sought = point; },
    step(dt) {
      t += dt;
      /* Where the stroke is headed: the work it was shown, else somewhere new in the box every second or so. */
      if (sought) { goal = sought; sought = null; goalUntil = t + 0.5; }
      else if (t >= goalUntil) { goal = { x: box.x + box.w * (0.08 + 0.84 * rnd()), y: box.y + box.h * (0.12 + 0.76 * rnd()) }; goalUntil = t + lerp(1.4, 0.55, energy) * (0.7 + 0.6 * rnd()); }
      /* The spot is pulled to the goal like a weight on a spring, never quite arriving, with a wander of its own on top. */
      const pull = lerp(5, 14, energy), drag = lerp(3.2, 5.2, energy);
      vel.x += ((goal.x - spot.x) * pull - vel.x * drag) * dt;
      vel.y += ((goal.y - spot.y) * pull - vel.y * drag) * dt;
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > roam) { vel.x *= roam / speed; vel.y *= roam / speed; }
      spot.x += vel.x * dt; spot.y += vel.y * dt;
      /* The stroke: an ellipse whose length, lean and roundness drift, with a figure of eight folded in and out of it. */
      phase += Math.PI * 2 * hz * (1 + 0.28 * nPace(t * 0.9)) * dt;
      grow = Math.min(1, grow + dt * 2.5);
      const lean = nLean(t * 0.55) * lerp(0.55, 1.15, energy);
      const along = wide * (1 + 0.42 * nWide(t * 0.8)) * grow;
      const across = along * (0.34 + 0.2 * nRound(t * 0.7));
      const eight = 0.5 + 0.5 * nEight(t * 0.45);
      const a = Math.cos(phase) * along, b = (Math.sin(phase) * (1 - eight) + Math.sin(2 * phase) * eight * 0.8) * across;
      const cos = Math.cos(lean), sin = Math.sin(lean);
      return {
        x: spot.x + a * cos - b * sin + nX(t * 3.1) * 5,
        y: spot.y + (a * sin + b * cos) * 0.72 + nY(t * 3.4) * 4,
      };
    },
  };
}

/**
 * A move from `a` to `b` in `seconds`, for a pointer that is not scrubbing: it bows a little, and with `settle` it runs a few px past the
 * target and comes back, as a hand does when it stops on a thing.
 */
export function glide(a, b, seconds, { seed = 1, settle = true } = {}) {
  const rnd = seeded(seed);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const path = swing(a, b, (rnd() - 0.5) * Math.min(60, dist * 0.18));
  const over = settle ? Math.min(9, dist * 0.03) : 0, dx = (b.x - a.x) / (dist || 1), dy = (b.y - a.y) / (dist || 1);
  return {
    seconds,
    at(time) {
      const u = Math.max(0, Math.min(1, time / seconds));
      const main = Math.min(1, u / 0.82), p = path(main);
      const back = u <= 0.82 ? Math.sin(main * Math.PI * 0.5) ** 6 : 1 - reachEase((u - 0.82) / 0.18);
      return { x: p.x + dx * over * back, y: p.y + dy * over * back };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------------
 * The narrator's pointer (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R5). A developer recording his screen while he talks
 * does not hold the pointer still and does not point at things: it wanders toward what he is naming and rests near it, loops lazily around a
 * word, drifts off into empty space, and the page gets a small absent-minded scroll down and back. These are the paths of that hand, as pure
 * arithmetic, and `narrate`, which runs them against a take's clock.
 *
 * A path is `{ seconds, at(t), end }`: where the hand is `t` seconds in (the hand's own point at 0, `end` at `seconds`).
 * ------------------------------------------------------------------------------------------------------------------------------------ */

/** A minimum-jerk curve: 0 to 1 with no velocity at either end, the shape of a hand's reach. */
const minJerk = (u) => { const v = Math.max(0, Math.min(1, u)); return v * v * v * (10 - 15 * v + 6 * v * v); };
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const inBox = (p, box) => (box ? { x: clamp(p.x, box.x, box.x + box.w), y: clamp(p.y, box.y, box.y + box.h) } : p);
const pick = (rnd, lo, hi) => lo + (hi - lo) * rnd();

/**
 * Where each caption of a node starts, in seconds into its clip: its share of the node's characters, which is how the edit times the captions
 * (tools/hype/edit-commentary.mjs: the lines' lengths, with no spaces counted), so a cue and the caption it follows come together.
 */
export function cueTimes(lines, clip) {
  const total = lines.reduce((s, l) => s + l.length, 0);
  let before = 0;
  return lines.map((line) => {
    const at = (before / total) * clip;
    before += line.length;
    return { line, at, end: (before / total) * clip };
  });
}

/** When `phrase` begins in the clip: its character's share of the node's characters (as `cueTimes`). `nth` picks which match (0 is the first). */
export function phraseTime(lines, clip, phrase, nth = 0) {
  const text = lines.join(' ');
  let at = -1;
  for (let i = 0; i <= nth; i++) { at = text.indexOf(phrase, at + 1); if (at < 0) throw new Error(`the captions do not hold "${phrase}" (match ${nth + 1})`); }
  /* A line boundary in the joined text is a space the share does not count: one per line that began before the phrase. */
  let line = 0, start = 0;
  for (const l of lines) { if (start + l.length + 1 > at) break; start += l.length + 1; line++; }
  return ((at - Math.min(line, lines.length - 1)) / lines.reduce((s, l) => s + l.length, 0)) * clip;
}

/** Strings paths together: each starts where the one before ended (the caller built them so). */
function chain(parts) {
  const seconds = parts.reduce((s, p) => s + p.seconds, 0);
  const end = parts.length ? parts.at(-1).end : { x: 0, y: 0 };
  return {
    seconds, end,
    at(t) {
      let left = Math.max(0, t);
      for (const p of parts) { if (left <= p.seconds) return p.at(left); left -= p.seconds; }
      return { ...end };
    },
  };
}

/**
 * A reach from `from` to `to`: slow off the mark and onto the target, its peak speed early or late as a hand's is, bowed to one side, wobbling a
 * little off the line, and (with `settle`) a few px past the target before it comes back to rest on it. `box` keeps it inside the screen.
 */
export function reach(from, to, seconds, { seed = 1, settle = true, box } = /** @type {{ seed?: number, settle?: boolean, box?: Box }} */ ({})) {
  const rnd = seeded(seed);
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  const ux = dist ? dx / dist : 1, uy = dist ? dy / dist : 0, nx = -uy, ny = ux;
  const bowMax = Math.min(70, dist * 0.16), bow = (rnd() < 0.5 ? -1 : 1) * pick(rnd, 0.5, 1) * bowMax;
  const over = settle ? (Math.min(12, dist * 0.025) * pick(rnd, 0.6, 1.4)) / (dist || 1) : 0;
  const skew = pick(rnd, 0.85, 1.2), wob = drift(rnd), split = settle ? 0.8 : 1;
  const at = (t) => {
    const u = clamp(t / seconds, 0, 1), m = Math.min(1, u / split);
    const s = (1 + over) * minJerk(m ** skew) - (u > split ? over * minJerk((u - split) / (1 - split)) : 0);
    const off = bow * Math.sin(Math.PI * m) + 3.2 * wob(u * 3) * Math.sin(Math.PI * u);
    return inBox({ x: from.x + dx * s + nx * off, y: from.y + dy * s + ny * off }, box);
  };
  return { seconds, at, end: { ...to } };
}

/**
 * A lazy loop around `center`: the hand leaves from where it is, winds in toward the word and goes round it a turn or so, on a ring that is not a
 * circle (a tilted ellipse whose width breathes), and comes off it on the ring.
 */
export function loop(from, center, seconds, { seed = 1, radius = 48, box } = /** @type {{ seed?: number, radius?: number, box?: Box }} */ ({})) {
  const rnd = seeded(seed);
  const rx = radius * pick(rnd, 0.9, 1.15), ry = rx * pick(rnd, 0.55, 0.75), tilt = pick(rnd, -0.5, 0.5), dir = rnd() < 0.5 ? -1 : 1, turns = pick(rnd, 1.05, 1.3), phi = rnd() * 6;
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const ring = (u) => {
    const th = a0 + dir * Math.PI * 2 * turns * minJerk(u), breathe = 1 + 0.14 * Math.sin(th * 1.3 + phi);
    const ex = Math.cos(th) * rx * breathe, ey = Math.sin(th) * ry;
    return { x: center.x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y: center.y + ex * Math.sin(tilt) + ey * Math.cos(tilt) };
  };
  const at = (t) => {
    const u = clamp(t / seconds, 0, 1), w = minJerk(Math.min(1, u / 0.4)), r = ring(u);
    return inBox({ x: lerp(from.x, r.x, w), y: lerp(from.y, r.y, w) }, box);
  };
  return { seconds, at, end: at(seconds) };
}

/** A hand at rest on `point`: not still, it drifts a few px and is quiet. */
export function rest(point, seconds, { seed = 1, box } = /** @type {{ seed?: number, box?: Box }} */ ({})) {
  const rnd = seeded(seed), nx = drift(rnd), ny = drift(rnd);
  const at = (t) => inBox({ x: point.x + 2.2 * (nx(t * 0.7) - nx(0)), y: point.y + 2 * (ny(t * 0.8) - ny(0)) }, box);
  return { seconds, at, end: at(seconds) };
}

/**
 * A hand with nothing to do: moments of rest (a second or two) and small reaches of a few dozen px, nowhere near frantic, inside `box` (the
 * screen's, narrowed to the neighborhood of where the hand is, so it stays where it was). It fills exactly `seconds`.
 */
export function idle(from, seconds, { seed = 1, box = { x: 0, y: 0, w: 1440, h: 810 }, radius = 170 } = /** @type {{ seed?: number, box?: Box, radius?: number }} */ ({})) {
  const rnd = seeded(seed);
  const near = { x: Math.max(box.x, from.x - radius), y: Math.max(box.y, from.y - radius), w: 0, h: 0 };
  near.w = Math.min(box.x + box.w, from.x + radius) - near.x;
  near.h = Math.min(box.y + box.h, from.y + radius) - near.y;
  const parts = [];
  let at = { ...from }, left = seconds;
  const add = (p) => { parts.push(p); at = p.end; left -= p.seconds; };
  const first = Math.min(left, pick(rnd, 0.5, 1.6));
  if (first > 0) add(rest(at, first, { seed: Math.floor(rnd() * 1e6), box }));
  for (let tries = 0; tries < 40 && left > 0.4; tries++) {
    const ang = rnd() * Math.PI * 2, d = pick(rnd, 25, 130);
    const to = inBox({ x: at.x + Math.cos(ang) * d, y: at.y + Math.sin(ang) * d }, { x: near.x + 6, y: near.y + 6, w: Math.max(0, near.w - 12), h: Math.max(0, near.h - 12) });
    const gone = Math.hypot(to.x - at.x, to.y - at.y);
    if (gone < 12) continue;
    const move = (0.6 + gone / 320) * pick(rnd, 0.9, 1.3), stay = pick(rnd, 0.8, 2.4);
    if (move + 0.3 > left) break;
    add(reach(at, to, move, { seed: Math.floor(rnd() * 1e6), box }));
    add(rest(at, Math.min(stay, left), { seed: Math.floor(rnd() * 1e6), box }));
  }
  if (left > 1e-9) add(rest(at, left, { seed: Math.floor(rnd() * 1e6), box }));
  return { ...chain(parts), seconds };
}

/** A loose gesture across a box ("take control of the forum"): a smooth line through a few waypoints that alternate sides, never stopping at them. */
export function sweep(from, box, seconds, { seed = 1, points = 3 } = {}) {
  const rnd = seeded(seed);
  const way = [{ ...from }];
  for (let i = 0; i < points; i++) {
    const left = (i + (rnd() < 0.5 ? 0 : 1)) % 2 === 0;
    way.push({ x: box.x + box.w * (left ? pick(rnd, 0.1, 0.4) : pick(rnd, 0.6, 0.9)), y: box.y + box.h * pick(rnd, 0.12, 0.88) });
  }
  const cum = [0];
  for (let i = 1; i < way.length; i++) cum.push(cum[i - 1] + Math.max(1, Math.hypot(way[i].x - way[i - 1].x, way[i].y - way[i - 1].y)));
  const total = cum.at(-1);
  const pt = (i) => way[clamp(i, 0, way.length - 1)];
  const at = (t) => {
    const u = clamp(t / seconds, 0, 1), s = (0.3 * u + 0.7 * minJerk(u)) * total;
    let i = 1;
    while (i < way.length - 1 && s > cum[i]) i++;
    const v = clamp((s - cum[i - 1]) / (cum[i] - cum[i - 1]), 0, 1), p0 = pt(i - 2), p1 = pt(i - 1), p2 = pt(i), p3 = pt(i + 1);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * v + (2 * a - 5 * b + 4 * c - d) * v * v + (-a + 3 * b - 3 * c + d) * v * v * v);
    return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
  };
  return { seconds, at, end: at(seconds) };
}

/** The page's scroll as an absent-minded hand makes it: `depth` px down, a moment there, and back. `at(t)` is the offset from where it began. */
export function scrollCurve({ depth, down = 1.1, hold = 0.7, back = 1.3 }) {
  const seconds = down + hold + back;
  return {
    seconds,
    at(t) {
      if (t <= down) return depth * minJerk(t / down);
      if (t <= down + hold) return depth;
      return depth * (1 - minJerk((t - down - hold) / back));
    },
  };
}

/**
 * Plays a narrator's pointer over a take: `cues` say what the hand does and when, on the take's clock (`io.now()`, which only moves with a drawn
 * frame), and between them it idles. Every frame goes through `io.frame()`, so the take's own helpers keep counting.
 *
 *   io  { frame, now, fps, from, box, seed, until, still, log }  `from` is where the hand starts; `box` where it idles; `until` seconds into the take;
 *       `still` makes the hand rest where it has nothing to do, and not wander
 *
 * A cue is `{ at, do, ... }` (a target is a page expression for an element, a `{x, y}`, or a function giving either):
 *   go       { target, guess, fx, fy, on, hold, seconds }  arrives near the target (or on it) at `at`, rests `hold` s; `fx`, `fy` pick a point of its box;
 *                                     `guess` is the rect to plan with while the page has no such element yet; `seconds` sets the length of the move
 *   hover    { target }               arrives ON the target at `at` and stays: a button looked at and not pressed
 *   click    { target, then(ctx) }    arrives on the target in time to press it at `at`; presses 70 ms; `then` runs as it is pressed (a take marks the beat there)
 *   circle   { target, seconds }      from `at`, a lazy loop around the target
 *   trace    { target, seconds }      arrives at the target's left end at `at`, then runs along it
 *   sweep    { box, seconds, points } from `at`, a loose gesture across a box
 *   scroll   { depth, down, hold, back }  from `at`, a small scroll down and back by the wheel
 *   rest     { seconds }              still, for a while
 *   act      { run(ctx) }             starts `run` at `at`, alongside the hand: ctx has now, evaluate, frames(n), holds(expression, limit)
 */
export async function narrate(cam, cues, io) {
  const { frame, now, fps, from, box = { x: 0, y: 0, w: 1440, h: 810 }, until, still = false, log = () => {} } = io;
  const rnd = seeded(io.seed ?? 1);
  const sub = () => Math.floor(rnd() * 1e6);
  let pos = { ...from }, failure = null;
  const waiters = [];
  const acts = cues.filter((c) => c.do === 'act').map((c) => ({ cue: c, started: false, done: false, promise: null }));
  const ctx = {
    now, evaluate: (e) => cam.evaluate(e),
    frames: (n) => new Promise((resolve) => { waiters.push({ n, resolve }); }),
    /** Frames until the take is `seconds` in. */
    async until(seconds) { while (now() < seconds - 1e-9) await ctx.frames(1); },
    async holds(expression, limit = 4) {
      for (let waited = 0; waited <= limit * fps; waited += 3) { if (await cam.evaluate(expression)) return; await ctx.frames(3); }
      throw new Error(`the page never came to: ${expression}`);
    },
  };
  const tick = async () => {
    for (const a of acts) {
      if (a.started || now() < a.cue.at - 1e-9) continue;
      a.started = true;
      a.promise = Promise.resolve().then(() => a.cue.run(ctx)).catch((e) => { failure ||= e; }).then(() => { a.done = true; });
    }
    await frame();
    for (const w of waiters.splice(0)) { w.n--; if (w.n <= 0) w.resolve(); else waiters.push(w); }
    if (failure) throw failure;
  };
  const follow = async (path) => {
    /* A path shorter than a frame is still a frame: the take's clock moves only with one, and a loop waiting on it must not spin. */
    for (let i = 1, n = Math.max(1, Math.round(path.seconds * fps)); i <= n; i++) { pos = path.at(Math.min(path.seconds, i / fps)); await cam.move(pos.x, pos.y); await tick(); }
    pos = { ...path.end };
  };
  const hold = (seconds) => (seconds > 0 ? follow(rest(pos, seconds, { seed: sub(), box })) : null);
  const fill = async (time) => { const left = time - now(); if (left > 0.05) await (still ? hold(left) : follow(idle(pos, left, { seed: sub(), box }))); };
  /* A target's rect. With a `guess` (where it is expected to be), a target the page does not have yet is planned against the guess: the hand is sent early enough, and reads the page again when it sets off. */
  const rectOf = async (find, guess) => {
    if (typeof find === 'function') find = await find();
    if (typeof find !== 'string') return { x: find.x, y: find.y, w: find.w ?? 0, h: find.h ?? 0, left: find.left ?? find.x, top: find.top ?? find.y };
    const r = await cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; })()`);
    if (!r) { if (guess) return guess; throw new Error(`narrate: nothing on the page for ${find}`); }
    return r;
  };
  /* Where the hand heads for a target: on it, or near it (not dead on: a few px off its edge, in a direction that varies). */
  const aimAt = (r, cue) => {
    const p = { x: r.left + r.w * (cue.fx ?? 0.5), y: r.top + r.h * (cue.fy ?? 0.5) };
    if (cue.on || cue.do === 'hover' || cue.do === 'click') return inBox({ x: p.x + pick(rnd, -2, 2), y: p.y + pick(rnd, -2, 2) }, box);
    const ang = rnd() * Math.PI * 2, d = Math.min(Math.max(r.w, r.h) / 2, 60) + pick(rnd, 10, 26);
    return inBox({ x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d }, box);
  };
  const travel = (to) => { const d = Math.hypot(to.x - pos.x, to.y - pos.y); return (d < 40 ? 0.3 + d / 200 : 0.55 + d / 650) * pick(rnd, 0.9, 1.3); };
  const late = (cue, begin) => { if (now() > begin + 0.25) log(`narrate: ${cue.do} at ${cue.at.toFixed(2)} s is ${(now() - begin).toFixed(2)} s late`); };

  for (const cue of cues.filter((c) => c.do !== 'act')) {
    switch (cue.do) {
      case 'go': case 'hover': case 'click': case 'trace': {
        const planned = await rectOf(cue.target, cue.guess), plan = cue.do === 'trace' ? inBox({ x: planned.left + 6, y: planned.y }, box) : aimAt(planned, cue);
        const dur = cue.seconds && cue.do !== 'trace' ? cue.seconds : travel(plan), lead = dur + (cue.do === 'click' ? 0.3 : 0);
        await fill(cue.at - lead);
        late(cue, cue.at - lead);
        /* Read again where it is as the hand sets off (a guessed target is the page's own by now, and a bobbing one is where it is). */
        const r = await rectOf(cue.target, cue.guess), dest = cue.do === 'trace' ? inBox({ x: r.left + 6, y: r.y }, box) : aimAt(r, cue);
        await follow(reach(pos, dest, dur, { seed: sub(), box }));
        if (cue.do === 'click') {
          /* The thing may have moved on (a node bobs): the hand reads where it is now and settles on it, then presses. */
          const again = aimAt(await rectOf(cue.target, cue.guess), cue);
          await follow(reach(pos, again, 0.3, { seed: sub(), settle: false, box }));
          await cam.press(); if (cue.then) await cue.then(ctx); await hold(0.07); await cam.release();
          log(`narrate: click at ${now().toFixed(2)} s (cue ${cue.at.toFixed(2)} s)`);
        } else if (cue.do === 'trace') {
          const to = inBox({ x: r.left + r.w - 6, y: r.y + pick(rnd, -4, 4) }, box);
          await follow(reach(pos, to, cue.seconds ?? 1.2, { seed: sub(), box }));
        }
        await hold(cue.hold ?? 0.5);
        break;
      }
      case 'circle': {
        const r = await rectOf(cue.target);
        await fill(cue.at);
        await follow(loop(pos, { x: r.x, y: r.y }, cue.seconds ?? 2.4, { seed: sub(), radius: cue.radius ?? Math.max(34, Math.min(r.w, r.h) * 0.5 + 14), box }));
        break;
      }
      case 'sweep':
        await fill(cue.at);
        await follow(sweep(pos, cue.box ?? box, cue.seconds ?? 3, { seed: sub(), points: cue.points ?? 3 }));
        break;
      case 'scroll': {
        await fill(cue.at);
        const curve = scrollCurve({ depth: cue.depth ?? 90, down: cue.down, hold: cue.hold, back: cue.back }), still = rest(pos, curve.seconds, { seed: sub(), box });
        let scrolled = 0;
        for (let i = 1, n = Math.round(curve.seconds * fps); i <= n; i++) {
          pos = still.at(i / fps); await cam.move(pos.x, pos.y);
          const want = Math.round(curve.at(i / fps)), dy = want - scrolled;
          if (dy !== 0) { await cam.wheel(dy); scrolled = want; }
          await tick();
        }
        pos = { ...still.end };
        break;
      }
      case 'rest': await fill(cue.at); await hold(cue.seconds ?? 1); break;
      default: throw new Error(`narrate: no gesture "${cue.do}"`);
    }
  }
  while (now() < until - 1e-9) await (still ? hold(until - now()) : follow(idle(pos, until - now(), { seed: sub(), box })));
  /* An act still answering the page at the end gets a little longer, then is a failure. */
  for (const a of acts) if (!a.started) throw new Error(`narrate: an act was cued at ${a.cue.at} s, after the take's ${until} s`);
  for (let extra = 0; acts.some((a) => !a.done) && extra < 300; extra++) await tick();
  if (acts.some((a) => !a.done)) throw new Error('narrate: an act never finished');
  if (failure) throw failure;
}
