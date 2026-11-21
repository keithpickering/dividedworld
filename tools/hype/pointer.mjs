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
