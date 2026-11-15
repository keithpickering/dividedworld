/**
 * Steel Chair's body (docs/plans/2026-11-15-steel-chair-plan.md, Task 3, as amended the same day: the world is the post's content
 * area): a folding chair is thrown at the words, hits, folds, and falls to the floor at the bottom of the content area as a rigid
 * box. The owner's words for it: "the chair is sort of snapping back to a standard 2D orientation once it's on the floor, would be
 * nice if we could make it settle on the floor in a way that completes the movement realistically." So nothing in this file moves
 * an orientation toward a chosen pose: a turn is made only by a spin the body already has or by a contact's impulse, and rest is
 * what the contacts leave. There is no step that "finishes" a rotation, no easing toward flat, no bias on which face lands down.
 *
 * Pure TypeScript with no DOM, clock or Math.random: the caller accumulates real time and steps by a fixed STEP, and every
 * random number comes from a generator passed in (rng(seed) below), so the same seed gives the same throw and the same rest on
 * every reader's screen. Units are CSS pixels and seconds; x runs right, y down, z toward the reader.
 *
 * The world: a floor (the plane y = floorY, the content area's bottom border) and two side walls (x = 0 and x = width, its left
 * and right borders), all hard, and a soft glass and back wall (z = DEPTH and z = -DEPTH) that hold the chair's middle in front of
 * the post and let its ends poke through. The words' box inside the world is only where the throw aims; the chair is never kept
 * out of it, since the content area is the container.
 *
 * Before the hit the chair flies a straight line, open (fold 1) and scaled down toward the page as it comes. At the hit its
 * velocity and spin are replaced by the throw's own pre-drawn numbers and the hinge begins to close; from then on it is a box
 * 46 wide, 90 tall and 8 thick of uniform density (mass 1, so impulses are in px/s). A free body keeps its angular momentum, so a
 * thin box spun about its middle axis tumbles as one does. A step is: gravity and damping; contacts solved before anything moves;
 * the move; the contacts the move left; a push out of any penetration by translation only; an energy bound; and sleep.
 *
 * Contacts are sequential impulses (accumulated and clamped so that a contact only ever pushes, carried from step to step so that a
 * chair at rest starts each step holding itself up). The floor, the walls and other chairs are solved speculatively, before the
 * move, with the gap in hand: a point that would pass its surface this step is held to arrive on it, so a resting chair never sinks
 * and has to be lifted back (a lift is energy from nowhere, and was what kept chairs resting on one another awake). Two chairs that
 * overlap anyway (one landing where another lies) are separated along the axis of least overlap of the two boxes.
 *
 * Sleep: a body slower than 6 px/s and 12 degrees a second for 0.4 s sleeps and becomes a static obstacle. A body moving into a
 * sleeper faster than 200 px/s at a contact wakes it with the equal and opposite impulse, whether that contact is met before the move
 * (a chair stopped on arrival) or after it (one that overlapped anyway). Two awake chairs also push each other
 * apart (the plan names sleepers as the obstacles; two chairs falling together must not pass through each other either).
 */

export type Vec3 = [number, number, number];
/** A rotation matrix, row by row. */
type Mat = [number, number, number, number, number, number, number, number, number];
/** A quaternion as [w, x, y, z]. */
export type Quat = [number, number, number, number];
/** The words' box in world coordinates: where a throw aims. */
export interface Box { left: number; top: number; width: number; height: number }

/** A throw, drawn whole from the generator up front so it is plain data: the same seed is the same throw. */
export interface Throw {
  target: { x: number; y: number };
  start: { x: number; y: number };
  /** The unit direction of approach, start toward target. */
  direction: { x: number; y: number };
  speed: number;
  /** The spin in flight, radians a second about the world's x, y and z. */
  spin: Vec3;
  orientation: Quat;
  scaleFrom: number;
  /** The sideways kick at the hit, px/s, along the perpendicular of the approach. */
  kick: number;
  /** The new spin the hit gives, radians a second. */
  spinAfter: Vec3;
}

export type Event =
  | { kind: 'hit'; id: number; at: { x: number; y: number } }
  | { kind: 'floor'; id: number; speed: number }
  | { kind: 'rest'; id: number };

export interface BodyView {
  id: number;
  position: { x: number; y: number; z: number };
  quaternion: { w: number; x: number; y: number; z: number };
  /** 1 open, 0 folded. */
  fold: number;
  /** The drawn size: it falls from the throw's scaleFrom to 1 on the way in, and is 1 after the hit. */
  scale: number;
  phase: 'flying' | 'tumbling';
  asleep: boolean;
  /** Linear speed, px/s. */
  speed: number;
  /** Angular speed, rad/s. */
  omega: number;
  /** The fastest angular speed it had at any moment of the last step, rad/s: its orientation turned by no more than this times the step. */
  omegaPeak: number;
  /** Kinetic (linear and rotational) plus g times height above the floor plus the glass spring's, with mass 1. */
  energy: number;
}

interface Body {
  id: number;
  th: Throw;
  phase: 'flying' | 'tumbling';
  pos: Vec3;
  q: Quat;
  vel: Vec3;
  w: Vec3;
  /** Row-major rotation matrix of q, kept current by frame(). */
  R: Mat;
  flown: number;
  foldT: number;
  scale: number;
  asleep: boolean;
  quiet: number;
  floored: boolean;
  /** The fastest the body turned during the last step, rad/s: what its turn in that step is bounded by. */
  peak: number;
}

export interface World {
  width: number;
  height: number;
  floorY: number;
  list: Body[];
  nextId: number;
  /** The impulses each contact applied last step and this one, by contact, so a resting chair starts a step already holding itself up. */
  warm: Map<string, [number, number, number]>;
  warming: Map<string, [number, number, number]>;
}

export const STEP = 1 / 120;
export const DEPTH = 40;
/** The folded chair's half extents: 46 wide, 90 tall, 8 thick. */
export const HALF: Vec3 = [23, 45, 4];

const GRAVITY = 1900;
const LINEAR_DAMPING = 0.1;
const ANGULAR_DAMPING = 0.6;
const FLOOR_BOUNCE = 0.35;
const WALL_BOUNCE = 0.5;
const FRICTION = 0.5;
/** Below this closing speed a contact does not bounce: gravity alone adds 16 px/s a step, which must not be a bounce. */
const BOUNCE_FLOOR = 40;
const SLEEP_SPEED = 6;
const SLEEP_SPIN = 12 * Math.PI / 180;
const SLEEP_TIME = 0.4;
const WAKE_SPEED = 200;
/** How deep a point may be inside another chair's box and still be a touching contact solved before the move, px. */
const TOUCH = 0.5;
const PASSES = 16;
/** The hinge: a critically damped spring from open to closed that is 98 percent shut in about 0.15 s. */
const HINGE = 40;
/** The glass's spring, 1/s squared (about 3 Hz), and the drag on a chair held in it, 1/s. */
const GLASS_SPRING = 400;
const GLASS_DRAG = 8;
const RADIUS = Math.hypot(...HALF);

/** Principal moments of a uniform box of mass 1 about its own x, y and z. */
const INERTIA: Vec3 = (() => {
  const [w, h, d] = [HALF[0] * 2, HALF[1] * 2, HALF[2] * 2];
  return [(h * h + d * d) / 12, (w * w + d * d) / 12, (w * w + h * h) / 12];
})();

/** A small seeded generator of numbers in [0, 1) (mulberry32): the one every function here draws from. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- small vector and quaternion helpers ---------- */

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

/** The orientation after turning by the angular velocity w for dt: the exact rotation, so the turn is |w|·dt and no more. */
function turned(q: Quat, w: Vec3, dt: number): Quat {
  const speed = norm(w);
  const angle = speed * dt;
  if (angle < 1e-14) return q;
  const s = Math.sin(angle / 2) / speed;
  const r = qmul([Math.cos(angle / 2), w[0] * s, w[1] * s, w[2] * s], q);
  const len = Math.hypot(r[0], r[1], r[2], r[3]);
  return [r[0] / len, r[1] / len, r[2] / len, r[3] / len];
}

function matrixOf(q: Quat): Mat {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** R v: a body-frame vector into the world. */
const toWorld = (R: Mat, v: Vec3): Vec3 => [
  R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
  R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
  R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
];
/** Rᵀ v: a world vector into the body frame. */
const toBody = (R: Mat, v: Vec3): Vec3 => [
  R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
  R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
  R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
];
/** The inverse inertia tensor in the world, applied to v. */
function invInertia(b: Body, v: Vec3): Vec3 {
  const R = b.R;
  const l0 = (R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) / INERTIA[0];
  const l1 = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) / INERTIA[1];
  const l2 = (R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) / INERTIA[2];
  return [R[0] * l0 + R[1] * l1 + R[2] * l2, R[3] * l0 + R[4] * l1 + R[5] * l2, R[6] * l0 + R[7] * l1 + R[8] * l2];
}

/** Where a local point of the box is in the world. */
const pointOf = (b: Body, local: Vec3): Vec3 => add(b.pos, toWorld(b.R, local));

/** The eight corners, and the midpoints of the edges along the two long sides: the points that can touch another chair. */
const CORNERS: Vec3[] = [];
for (let k = 0; k < 8; k++) CORNERS.push([k & 4 ? HALF[0] : -HALF[0], k & 2 ? HALF[1] : -HALF[1], k & 1 ? HALF[2] : -HALF[2]]);
/**
 * What can touch another chair is more than its corners: two thin boxes lie across each other with an edge on a face and no
 * corner under anything. So the points are the corners and a row along each of the eight edges of the two large faces, every
 * 15 px or so. They are where the contact impulses act, so that a chair resting on another is held at several places and not
 * two; the separation of two boxes that overlap does not depend on them (separation() below finds it from the boxes).
 */
const SAMPLES: Vec3[] = [...CORNERS];
for (const sz of [-1, 1]) {
  for (const sx of [-1, 1]) for (let k = 1; k < 6; k++) SAMPLES.push([sx * HALF[0], -HALF[1] + (k * 2 * HALF[1]) / 6, sz * HALF[2]]);
  for (const sy of [-1, 1]) for (let k = 1; k < 3; k++) SAMPLES.push([-HALF[0] + (k * 2 * HALF[0]) / 3, sy * HALF[1], sz * HALF[2]]);
}

/** The eight corners of a body as the view shows it, in the order a bit pattern of (x, y, z) signs counts. */
export function cornersOf(b: BodyView): Vec3[] {
  const R = matrixOf([b.quaternion.w, b.quaternion.x, b.quaternion.y, b.quaternion.z]);
  const pos: Vec3 = [b.position.x, b.position.y, b.position.z];
  return CORNERS.map((c) => add(pos, toWorld(R, c)));
}

/* ---------- the world ---------- */

export function createWorld(width: number, height: number, floorY: number): World {
  return { width, height, floorY, list: [], nextId: 1, warm: new Map(), warming: new Map() };
}

/**
 * A throw. The target is a point in the words' box, 15 percent in from the sides and from the top and no lower than 60 percent
 * of its height (the dent bends the words, so the aim is the words). The chair comes from any direction, from one diagonal of
 * the world away (taken as twice the words' margins plus their size, since the world is the box the words sit in), at 1500 px/s,
 * spinning up to 600 degrees a second about each axis, scaled 2.2 times and shrinking to 1 as it arrives.
 */
export function throwOf(rand: () => number, words: Box): Throw {
  const target = {
    x: words.left + words.width * (0.15 + 0.7 * rand()),
    y: words.top + words.height * (0.15 + 0.45 * rand()),
  };
  const angle = rand() * Math.PI * 2;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const diagonal = Math.hypot(words.width + 2 * words.left, words.height + 2 * words.top);
  const start = { x: target.x - direction.x * diagonal, y: target.y - direction.y * diagonal };
  const deg = Math.PI / 180;
  const spin: Vec3 = [(rand() * 2 - 1) * 600 * deg, (rand() * 2 - 1) * 600 * deg, (rand() * 2 - 1) * 600 * deg];
  // A uniformly random orientation (Shoemake's method)
  const [u1, u2, u3] = [rand(), rand(), rand()];
  const orientation: Quat = [
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
  ];
  const kick = (rand() * 2 - 1) * 110;
  const spinAfter: Vec3 = [(rand() * 2 - 1) * 900 * deg, (rand() * 2 - 1) * 900 * deg, (rand() * 2 - 1) * 700 * deg];
  return { target, start, direction, speed: 1500, spin, orientation, scaleFrom: 2.2, kick, spinAfter };
}

/** Puts a throw in the air. The id is the caller's, if given, so a play can find its body again; otherwise the next free one. */
export function addThrow(world: World, th: Throw, id?: number): number {
  if (id !== undefined && world.list.some((b) => b.id === id)) throw new Error(`a body with id ${id} is already in the world`);
  const use = id ?? world.nextId;
  world.nextId = Math.max(world.nextId, use + 1);
  const body: Body = {
    id: use, th, phase: 'flying',
    pos: [th.start.x, th.start.y, 0], q: th.orientation,
    vel: [th.direction.x * th.speed, th.direction.y * th.speed, 0], w: [...th.spin],
    R: matrixOf(th.orientation), flown: 0, foldT: 0, scale: th.scaleFrom, asleep: false, quiet: 0, floored: false, peak: 0,
  };
  world.list.push(body);
  return use;
}

/** Takes a body out (its play ended) and wakes the rest, since one may have been lying on it. */
export function remove(world: World, id: number): boolean {
  const at = world.list.findIndex((b) => b.id === id);
  if (at < 0) return false;
  world.list.splice(at, 1);
  wakeAll(world);
  return true;
}

/** A new box (the post was resized or its words reflowed): every body wakes, so none is left hanging in the air or inside a wall. */
export function resize(world: World, width: number, height: number, floorY: number): void {
  world.width = width;
  world.height = height;
  world.floorY = floorY;
  wakeAll(world);
}

function wakeAll(world: World): void {
  world.warm.clear();
  for (const b of world.list) { b.asleep = false; b.quiet = 0; }
}

const foldAt = (t: number): number => (1 + HINGE * t) * Math.exp(-HINGE * t);

/** Linear plus rotational kinetic energy, mass 1. */
function kineticOf(b: Body): number {
  const local = toBody(b.R, b.w);
  return 0.5 * dot(b.vel, b.vel) + 0.5 * (INERTIA[0] * local[0] ** 2 + INERTIA[1] * local[1] ** 2 + INERTIA[2] * local[2] ** 2);
}

/** Kinetic plus g times height above the floor plus what the glass's spring holds. */
function energyOf(world: World, b: Body): number {
  const over = Math.max(Math.abs(b.pos[2]) - DEPTH, 0);
  return kineticOf(b) + GRAVITY * (world.floorY - b.pos[1]) + 0.5 * GLASS_SPRING * over * over;
}

export function bodies(world: World): BodyView[] {
  return world.list.map((b) => {
    return {
      id: b.id,
      position: { x: b.pos[0], y: b.pos[1], z: b.pos[2] },
      quaternion: { w: b.q[0], x: b.q[1], y: b.q[2], z: b.q[3] },
      fold: b.phase === 'flying' ? 1 : foldAt(b.foldT),
      scale: b.scale,
      phase: b.phase,
      asleep: b.asleep,
      speed: norm(b.vel),
      omega: norm(b.w),
      omegaPeak: Math.max(b.peak, norm(b.w)),
      energy: energyOf(world, b),
    };
  });
}

/**
 * Steps until every body sleeps or maxSeconds of simulated time have passed; for reduced motion and a moment. The return value says
 * which of the two ended it: true if every body is asleep, false if the time ran out first with at least one still moving (or still in
 * the air), in which case the world is left where the last step put it and the caller may settle again or go on stepping.
 */
export function settle(world: World, maxSeconds: number): boolean {
  for (let t = 0; t < maxSeconds && !world.list.every((b) => b.asleep); t += STEP) step(world, STEP);
  return world.list.every((b) => b.asleep);
}

/* ---------- one step ---------- */

/**
 * One step of dt (the caller's fixed STEP; the numbers here are tuned for 1/120 s). In order: gravity and damping on the
 * velocities of the tumbling chairs; the contacts with the floor and walls, solved before anything moves, with the gap in hand, so
 * that a chair comes to rest exactly on a surface and never sinks into it (a sink pushed back out would lift it, which is energy from
 * nowhere); the move; the contacts the move left (another chair's box, a corner that turned into a wall); the push out of whatever
 * penetration remains; a bound on energy; and sleep.
 */
export function step(world: World, dt: number): Event[] {
  const events: Event[] = [];
  const fresh = new Set<Body>();
  // the sleepers a contact knocked awake this step: they stay static for the rest of it and are awake for the next
  const woken = new Set<Body>();
  // the energy of every chair at the start of the step, before gravity (a sleeper's is its height alone: it might be woken)
  const before = new Map<Body, number>();
  for (const b of world.list) if (b.phase === 'tumbling') before.set(b, energyOf(world, b));
  for (const b of world.list) {
    b.peak = b.asleep ? 0 : norm(b.w);
    if (b.asleep) continue;
    if (b.phase === 'flying') { if (fly(b, dt, events)) fresh.add(b); }
    else accelerate(b, dt);
  }
  const moving = world.list.filter((b) => !b.asleep && b.phase === 'tumbling' && !fresh.has(b));
  const awake = world.list.filter((b) => !b.asleep && b.phase === 'tumbling');
  // before the move: the floor and the walls, with the gap
  const early: Contact[] = [];
  const surfaces = planes(world);
  for (const a of moving) {
    // a point farther from a surface than three steps of the fastest anything on the body moves cannot reach it this step
    const reach = 3 * (norm(a.vel) + norm(a.w) * RADIUS) * dt + 1;
    for (const [ci, corner] of CORNERS.entries()) {
      const p = pointOf(a, corner);
      for (const [pi, plane] of surfaces.entries()) {
        const gap = Math.max(plane.gap(p), 0);
        if (gap > reach) continue;
        // every corner is a constraint, not only those that look to reach the plane now: an impulse at one corner can turn the body
        // so that another comes down faster, and a constraint that is slack just stays at zero
        early.push(makeContact(a, null, p, plane.n, plane.e, plane.floor, dt, gap, `e${a.id}.${ci}.${pi}`));
      }
    }
  }
  // and the other chairs, the same way: every sample point that is outside another chair's box and near it, with the distance
  const live = world.list.filter((b) => b.phase === 'tumbling');
  for (const a of moving) {
    for (const b of live) {
      if (a === b) continue;
      const reach = 3 * (norm(a.vel) + norm(a.w) * RADIUS + norm(b.vel) + norm(b.w) * RADIUS) * dt + 1;
      if (norm(sub(a.pos, b.pos)) > 2 * RADIUS + reach) continue;
      for (const [si, sample] of SAMPLES.entries()) {
        const near = probeNear(a, sample, b, reach);
        if (near) early.push(makeContact(a, b, near.p, near.n, FLOOR_BOUNCE, false, dt, near.gap, `s${a.id}.${b.id}.${si}`));
        // a sleeper's points near this chair too (an awake chair's own points are its own contacts): the sleeper cannot give way
        if (b.asleep) {
          const back = probeNear(b, sample, a, reach);
          if (back) {
          const c = makeContact(a, null, back.p, [-back.n[0], -back.n[1], -back.n[2]], FLOOR_BOUNCE, false, dt, back.gap, `t${a.id}.${b.id}.${si}`);
          c.sleeper = b;
          c.sleeperR = sub(back.p, b.pos);
          early.push(c);
        }
        }
      }
    }
  }
  reportFloor(early, events);
  solve(early, world);
  // a fast chair is stopped here before it reaches a sleeper, so this is where it knocks it: the rule is on the contact, not on the overlap
  knock(early, woken);
  for (const b of moving) {
    limitLift(b, before.get(b) ?? 0, world, dt);
    move(b, dt);
  }
  // after the move: another chair's box, and what the turn left past a wall
  const touching = late(world, awake, dt, events, woken);
  pushOut(world, awake);
  // A contact may take energy from a chair and never give it: whatever push out is left lifts a body by a few hundredths of a
  // pixel, which is energy from nowhere. The velocities are scaled down (never turned) by what that cost, so no step raises it. Chairs
  // that touch trade energy, so each touching group is held to the energy its members started the step with, together.
  for (const group of groupsOf(awake, touching)) {
    let was = 0, now = 0, kinetic = 0;
    for (const b of group) { was += before.get(b) ?? energyOf(world, b); now += energyOf(world, b); kinetic += kineticOf(b); }
    const excess = now - was;
    if (excess <= 0) continue;
    const keep = kinetic > excess ? Math.sqrt((kinetic - excess) / kinetic) : 0;
    for (const b of group) { b.vel = mul(b.vel, keep); b.w = mul(b.w, keep); }
  }
  for (const b of woken) { b.asleep = false; b.quiet = 0; }
  world.warm = world.warming;
  world.warming = new Map();
  for (const b of awake) {
    if (norm(b.vel) < SLEEP_SPEED && norm(b.w) < SLEEP_SPIN) b.quiet += dt;
    else b.quiet = 0;
    if (b.quiet >= SLEEP_TIME) {
      b.asleep = true;
      b.vel = [0, 0, 0];
      b.w = [0, 0, 0];
      events.push({ kind: 'rest', id: b.id });
    }
  }
  return events;
}

/**
 * A chair may not rise on energy it does not have. Gravity's push on the velocity in this step is paid for by the fall that follows
 * it; where a contact has stopped that fall and turned the rest into an upward velocity, the move would lift the chair by more
 * than the energy it started the step with allows (up to half of g squared times dt squared, a rocking chair's whole sag). So the
 * velocities are scaled down, never turned, to the largest scale at which kinetic plus height after the move is no more than it was.
 */
function limitLift(b: Body, start: number, world: World, dt: number): void {
  const a = kineticOf(b);
  const lift = -b.vel[1] * dt * GRAVITY;
  const c = GRAVITY * (world.floorY - b.pos[1]) - start;
  if (a + lift + c <= 0) return;
  let s: number;
  if (a < 1e-12) s = lift > 0 ? Math.max(-c / lift, 0) : 1;
  else s = (-lift + Math.sqrt(lift * lift - 4 * a * c)) / (2 * a);
  s = Math.min(Math.max(s, 0), 1);
  b.vel = mul(b.vel, s);
  b.w = mul(b.w, s);
}

/** The straight line in: the spin runs, and the step that would pass the target ends on it as the hit. True on the hit. */
function fly(b: Body, dt: number, events: Event[]): boolean {
  const { th } = b;
  const total = Math.hypot(th.target.x - th.start.x, th.target.y - th.start.y);
  const left = (th.target.x - b.pos[0]) * th.direction.x + (th.target.y - b.pos[1]) * th.direction.y;
  b.q = turned(b.q, b.w, dt);
  b.R = matrixOf(b.q);
  if (left <= th.speed * dt) {
    b.pos = [th.target.x, th.target.y, 0];
    b.phase = 'tumbling';
    b.scale = 1;
    b.foldT = 0;
    const away = { x: -th.direction.x * 170, y: -th.direction.y * 170 };
    const side = { x: -th.direction.y * th.kick, y: th.direction.x * th.kick };
    b.vel = [away.x + side.x, away.y + side.y - 180, 0];
    b.w = [...th.spinAfter];
    events.push({ kind: 'hit', id: b.id, at: { x: th.target.x, y: th.target.y } });
    return true;
  }
  b.pos = [b.pos[0] + th.direction.x * th.speed * dt, b.pos[1] + th.direction.y * th.speed * dt, 0];
  b.flown += th.speed * dt;
  b.scale = th.scaleFrom + (1 - th.scaleFrom) * Math.min(b.flown / total, 1);
  return false;
}

function accelerate(b: Body, dt: number): void {
  b.vel = [b.vel[0], b.vel[1] + GRAVITY * dt, b.vel[2]];
  // The glass and the back wall are soft: a chair whose middle is past one is pushed back toward the post by a spring (and slowed,
  // so it settles), and its ends may poke through them (the content area is a container the effect may leave for comedic effect).
  // A hard wall pinned a chair sliding off the edge of another and kept it rocking there; a spring lets it slide until it is held.
  const over = Math.abs(b.pos[2]) - DEPTH;
  if (over > 0) {
    b.vel[2] -= Math.sign(b.pos[2]) * GLASS_SPRING * over * dt;
    b.vel[2] *= Math.exp(-GLASS_DRAG * dt);
  }
  b.vel = mul(b.vel, Math.exp(-LINEAR_DAMPING * dt));
  b.w = mul(b.w, Math.exp(-ANGULAR_DAMPING * dt));
}

function move(b: Body, dt: number): void {
  b.peak = Math.max(b.peak, norm(b.w));
  b.pos = add(b.pos, mul(b.vel, dt));
  // A free body keeps its angular momentum, not its angular velocity: the box turns by w for dt, and the w it has afterward is the
  // one that momentum gives in the new orientation (a thin box spun about its middle axis tumbles; a fixed w would make energy up).
  const l = toBody(b.R, b.w);
  const momentum = toWorld(b.R, [l[0] * INERTIA[0], l[1] * INERTIA[1], l[2] * INERTIA[2]]);
  b.q = turned(b.q, b.w, dt);
  b.R = matrixOf(b.q);
  b.w = invInertia(b, momentum);
  b.foldT += dt;
}

/* ---------- contacts ---------- */

interface Contact {
  /** Which contact this is from one step to the next: the same two bodies and the same point on them. */
  key: string;
  a: Body;
  /** The body whose box a's point is in, or null for a wall or the floor. */
  b: Body | null;
  /** True when b is awake and takes its share of the impulse; false for a wall and for a sleeper (static). */
  bMoves: boolean;
  floor: boolean;
  /** The three directions of the contact: the normal (out of the surface, toward a), then two tangents. */
  d: [Vec3, Vec3, Vec3];
  /** For each direction, the lever arm crossed with it (r x d) on a and on b, and the angular velocity an impulse along it gives each. */
  rxa: [Vec3, Vec3, Vec3];
  rxb: [Vec3, Vec3, Vec3];
  wa: [Vec3, Vec3, Vec3];
  wb: [Vec3, Vec3, Vec3];
  /** The inverse of the mass the contact moves along each direction. */
  k: [number, number, number];
  ra: Vec3;
  rb: Vec3;
  closing: number;
  /** Whether the point reaches the surface within this step at the speed it has before the solve. */
  reaches: boolean;
  /** The least normal speed the solver leaves: a bounce's, or minus the gap over dt so a chair arrives and goes no further. */
  target: number;
  /** The impulse so far along the normal and the two tangents, summed over the passes (the clamps are on the sums). */
  j: [number, number, number];
  /** Everything applied to a, so a woken sleeper can be given the opposite. */
  total: Vec3;
  /** The sleeping chair this contact pushes against, if any (whether b is it or the contact is a wall-like one made from its point), and its lever arm. */
  sleeper: Body | null;
  sleeperR: Vec3;
}

/** The floor and the two side walls: how far a point is from each, and its normal and bounce. */
function planes(world: World): Array<{ gap: (p: Vec3) => number; n: Vec3; e: number; floor: boolean }> {
  return [
    { gap: (p) => world.floorY - p[1], n: [0, -1, 0], e: FLOOR_BOUNCE, floor: true },
    { gap: (p) => p[0], n: [1, 0, 0], e: WALL_BOUNCE, floor: false },
    { gap: (p) => world.width - p[0], n: [-1, 0, 0], e: WALL_BOUNCE, floor: false },
  ];
}

function velocityAt(b: Body, r: Vec3): Vec3 { return add(b.vel, cross(b.w, r)); }

function applyImpulse(b: Body, J: Vec3, r: Vec3): void {
  b.vel = add(b.vel, J);
  b.w = add(b.w, invInertia(b, cross(r, J)));
}

function makeContact(a: Body, b: Body | null, p: Vec3, n: Vec3, e: number, floor: boolean, dt: number, gap: number, key: string): Contact {
  const bMoves = b !== null && !b.asleep;
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = cross(n, helper);
  const l1 = norm(t1);
  const u1: Vec3 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
  const d: [Vec3, Vec3, Vec3] = [n, u1, cross(n, u1)];
  const ra = sub(p, a.pos);
  const rb = b ? sub(p, b.pos) : [0, 0, 0] as Vec3;
  const zero = (): Vec3 => [0, 0, 0];
  const rxa: [Vec3, Vec3, Vec3] = [cross(ra, d[0]), cross(ra, d[1]), cross(ra, d[2])];
  const rxb: [Vec3, Vec3, Vec3] = b ? [cross(rb, d[0]), cross(rb, d[1]), cross(rb, d[2])] : [zero(), zero(), zero()];
  const wa: [Vec3, Vec3, Vec3] = [invInertia(a, rxa[0]), invInertia(a, rxa[1]), invInertia(a, rxa[2])];
  const wb: [Vec3, Vec3, Vec3] = bMoves ? [invInertia(b as Body, rxb[0]), invInertia(b as Body, rxb[1]), invInertia(b as Body, rxb[2])] : [zero(), zero(), zero()];
  const k: [number, number, number] = [
    1 + dot(wa[0], rxa[0]) + (bMoves ? 1 + dot(wb[0], rxb[0]) : 0),
    1 + dot(wa[1], rxa[1]) + (bMoves ? 1 + dot(wb[1], rxb[1]) : 0),
    1 + dot(wa[2], rxa[2]) + (bMoves ? 1 + dot(wb[2], rxb[2]) : 0),
  ];
  const c: Contact = {
    key, a, b, bMoves, floor, d, rxa, rxb, wa, wb, k, ra, rb, closing: 0, reaches: false, target: 0, j: [0, 0, 0], total: [0, 0, 0],
    sleeper: b && b.asleep ? b : null, sleeperR: rb,
  };
  const closing = -along(c, 0);
  c.closing = closing;
  c.reaches = closing * dt > gap;
  c.target = c.reaches && closing > BOUNCE_FLOOR ? e * closing : -gap / dt;
  return c;
}

/** The speed of a's point relative to b's (or the surface) along one of the contact's directions. */
function along(c: Contact, i: number): number {
  const d = c.d[i] as Vec3, rxa = c.rxa[i] as Vec3, rxb = c.rxb[i] as Vec3;
  const { a, b } = c;
  let v = a.vel[0] * d[0] + a.vel[1] * d[1] + a.vel[2] * d[2] + a.w[0] * rxa[0] + a.w[1] * rxa[1] + a.w[2] * rxa[2];
  if (b) v -= b.vel[0] * d[0] + b.vel[1] * d[1] + b.vel[2] * d[2] + b.w[0] * rxb[0] + b.w[1] * rxb[1] + b.w[2] * rxb[2];
  return v;
}

/**
 * Whether a local point of one body is inside another body's box: the point, the way out along the least-penetrating face and how
 * far, or null. Plain numbers, since this runs for every sample of every near pair, several times a step.
 */
function probe(owner: Body, local: Vec3, box: Body): { p: Vec3; n: Vec3; depth: number } | null {
  const R = owner.R, Q = box.R;
  const px = owner.pos[0] + R[0] * local[0] + R[1] * local[1] + R[2] * local[2];
  const py = owner.pos[1] + R[3] * local[0] + R[4] * local[1] + R[5] * local[2];
  const pz = owner.pos[2] + R[6] * local[0] + R[7] * local[1] + R[8] * local[2];
  const dx = px - box.pos[0], dy = py - box.pos[1], dz = pz - box.pos[2];
  const l0 = Q[0] * dx + Q[3] * dy + Q[6] * dz;
  const r0 = HALF[0] - Math.abs(l0);
  if (r0 <= 0) return null;
  const l1 = Q[1] * dx + Q[4] * dy + Q[7] * dz;
  const r1 = HALF[1] - Math.abs(l1);
  if (r1 <= 0) return null;
  const l2 = Q[2] * dx + Q[5] * dy + Q[8] * dz;
  const r2 = HALF[2] - Math.abs(l2);
  if (r2 <= 0) return null;
  let axis = 0, depth = r0, sign = l0 >= 0 ? 1 : -1;
  if (r1 < depth) { axis = 1; depth = r1; sign = l1 >= 0 ? 1 : -1; }
  if (r2 < depth) { axis = 2; depth = r2; sign = l2 >= 0 ? 1 : -1; }
  const n: Vec3 = axis === 0 ? [Q[0] * sign, Q[3] * sign, Q[6] * sign] : axis === 1 ? [Q[1] * sign, Q[4] * sign, Q[7] * sign] : [Q[2] * sign, Q[5] * sign, Q[8] * sign];
  return { p: [px, py, pz], n, depth };
}

/**
 * The separating axis test of two boxes: the axis of least overlap among the fifteen (the three faces of each and the nine crossed
 * edges), as a unit vector pointing from b toward a, and how far they overlap along it (zero or less when they are apart).
 * `reach` is how far a's box extends from its middle along the axis, for where its deepest point is.
 */
function separation(a: Body, b: Body): { n: Vec3; depth: number; reach: number } {
  const A = a.R, B = b.R;
  const t: Vec3 = [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]];
  let bestDepth = Infinity;
  let best: Vec3 = [0, 1, 0];
  let bestReach = 0;
  const test = (x: number, y: number, z: number, edge: boolean): void => {
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) return;
    const ax = x / len, ay = y / len, az = z / len;
    const ra = HALF[0] * Math.abs(A[0] * ax + A[3] * ay + A[6] * az) + HALF[1] * Math.abs(A[1] * ax + A[4] * ay + A[7] * az) + HALF[2] * Math.abs(A[2] * ax + A[5] * ay + A[8] * az);
    const rb = HALF[0] * Math.abs(B[0] * ax + B[3] * ay + B[6] * az) + HALF[1] * Math.abs(B[1] * ax + B[4] * ay + B[7] * az) + HALF[2] * Math.abs(B[2] * ax + B[5] * ay + B[8] * az);
    const dist = t[0] * ax + t[1] * ay + t[2] * az;
    const depth = ra + rb - Math.abs(dist);
    // a face is preferred to an edge unless the edge is clearly less overlapped
    if (depth < bestDepth - (edge ? 1e-3 : 0)) {
      bestDepth = depth;
      const sign = dist >= 0 ? 1 : -1;
      best = [ax * sign, ay * sign, az * sign];
      bestReach = ra;
    }
  };
  const colsA: Vec3[] = [[A[0], A[3], A[6]], [A[1], A[4], A[7]], [A[2], A[5], A[8]]];
  const colsB: Vec3[] = [[B[0], B[3], B[6]], [B[1], B[4], B[7]], [B[2], B[5], B[8]]];
  for (const [x, y, z] of colsA) test(x, y, z, false);
  for (const [x, y, z] of colsB) test(x, y, z, false);
  for (const [ux, uy, uz] of colsA) for (const [vx, vy, vz] of colsB) test(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, true);
  return { n: best, depth: bestDepth, reach: bestReach };
}

/**
 * How near a local point of one body is to another body's box, from outside it: the point, the direction from the box toward the
 * point (the box's face for a point over a face, the line to the nearest edge or corner for a point off one) and the distance,
 * or null if it is inside the box or farther than reach.
 */
function probeNear(owner: Body, local: Vec3, box: Body, reach: number): { p: Vec3; n: Vec3; gap: number } | null {
  const R = owner.R, Q = box.R;
  const px = owner.pos[0] + R[0] * local[0] + R[1] * local[1] + R[2] * local[2];
  const py = owner.pos[1] + R[3] * local[0] + R[4] * local[1] + R[5] * local[2];
  const pz = owner.pos[2] + R[6] * local[0] + R[7] * local[1] + R[8] * local[2];
  const dx = px - box.pos[0], dy = py - box.pos[1], dz = pz - box.pos[2];
  const l0 = Q[0] * dx + Q[3] * dy + Q[6] * dz;
  const l1 = Q[1] * dx + Q[4] * dy + Q[7] * dz;
  const l2 = Q[2] * dx + Q[5] * dy + Q[8] * dz;
  const o0 = l0 > HALF[0] ? l0 - HALF[0] : l0 < -HALF[0] ? l0 + HALF[0] : 0;
  const o1 = l1 > HALF[1] ? l1 - HALF[1] : l1 < -HALF[1] ? l1 + HALF[1] : 0;
  const o2 = l2 > HALF[2] ? l2 - HALF[2] : l2 < -HALF[2] ? l2 + HALF[2] : 0;
  const gap = Math.hypot(o0, o1, o2);
  if (gap > reach) return null;
  if (gap === 0) {
    // On the surface or just inside it: the way out is the nearest face. This is a contact at gap zero, not no contact: a chair that is
    // resting has its points exactly here (the push out leaves them on the surface to rounding), and a contact that was only taken when
    // the point was outside let a resting chair fall a step's gravity into the other and be stopped after the fact, so it started every
    // step at 16 px/s and never slept. A point deeper than TOUCH is a collision, which is the late pass's, along the pair's own axis.
    const r0 = HALF[0] - Math.abs(l0), r1 = HALF[1] - Math.abs(l1), r2 = HALF[2] - Math.abs(l2);
    const depth = Math.min(r0, r1, r2);
    if (depth > TOUCH) return null;
    const axis = r0 <= r1 && r0 <= r2 ? 0 : r1 <= r2 ? 1 : 2;
    const l = axis === 0 ? l0 : axis === 1 ? l1 : l2;
    const sign = l >= 0 ? 1 : -1;
    return {
      p: [px, py, pz],
      n: [Q[axis] * sign, Q[3 + axis] * sign, Q[6 + axis] * sign],
      gap: 0,
    };
  }
  const n0 = o0 / gap, n1 = o1 / gap, n2 = o2 / gap;
  return {
    p: [px, py, pz],
    n: [Q[0] * n0 + Q[1] * n1 + Q[2] * n2, Q[3] * n0 + Q[4] * n1 + Q[5] * n2, Q[6] * n0 + Q[7] * n1 + Q[8] * n2],
    gap,
  };
}

/** The first meeting of a chair with the floor is an event, with the speed it was closing at. */
function reportFloor(list: Contact[], events: Event[]): void {
  const speeds = new Map<Body, number>();
  for (const c of list) if (c.floor && c.reaches && !c.a.floored && c.closing > 0) speeds.set(c.a, Math.max(speeds.get(c.a) ?? 0, c.closing));
  for (const [body, speed] of speeds) { body.floored = true; events.push({ kind: 'floor', id: body.id, speed }); }
}

/**
 * The contacts after the move: a point of one chair inside another's box (a sleeper is static; an awake one takes its share), and
 * a corner a turn carried past the floor or a wall. Returns the bodies that touched another chair, whose energy is traded.
 */
function late(world: World, awake: Body[], dt: number, events: Event[], woken: Set<Body>): Array<[Body, Body]> {
  const touching: Array<[Body, Body]> = [];
  const live = world.list.filter((b) => b.phase === 'tumbling');
  const list: Contact[] = [];
  const surfaces = planes(world);
  for (const a of awake) {
    for (const [ci, corner] of CORNERS.entries()) {
      const p = pointOf(a, corner);
      for (const [pi, plane] of surfaces.entries()) {
        if (plane.gap(p) < 0) list.push(makeContact(a, null, p, plane.n, plane.e, plane.floor, dt, 0, `p${a.id}.${ci}.${pi}`));
      }
    }
  }
  for (const a of awake) for (const b of live) {
    if (a === b || (!b.asleep && b.id < a.id) || norm(sub(a.pos, b.pos)) > 2 * RADIUS) continue;
    const sat = separation(a, b);
    if (sat.depth <= 0) continue;
    // One direction for the whole pair, the axis of least overlap: points of either chair inside the other push along it (each
    // point choosing its own way out had two thin chairs pushing across each other and leaving one standing in the other)
    let any = false;
    for (const [si, sample] of SAMPLES.entries()) {
      const inA = probe(a, sample, b);
      if (inA) { any = true; list.push(makeContact(a, b, inA.p, sat.n, FLOOR_BOUNCE, false, dt, 0, `b${a.id}.${b.id}.${si}`)); }
      const inB = probe(b, sample, a);
      if (inB) { any = true; list.push(makeContact(a, b, inB.p, sat.n, FLOOR_BOUNCE, false, dt, 0, `c${a.id}.${b.id}.${si}`)); }
    }
    // overlapped with no sampled point inside either (edges crossing): one contact at a's deepest point along the way out
    if (!any) {
      const p: Vec3 = [a.pos[0] - sat.n[0] * sat.reach, a.pos[1] - sat.n[1] * sat.reach, a.pos[2] - sat.n[2] * sat.reach];
      list.push(makeContact(a, b, p, sat.n, FLOOR_BOUNCE, false, dt, 0, `d${a.id}.${b.id}`));
    }
  }
  for (const c of list) if (c.b) touching.push([c.a, c.b]);
  reportFloor(list, events);
  solve(list, world);
  knock(list, woken);
  return touching;
}

/**
 * A sleeper that a contact meets at a closing speed over WAKE_SPEED wakes, and is handed the equal and opposite of what the contacts
 * with it gave the chair that hit it (every contact of the pair, not only the fast ones: the impulse is the pair's, however many points
 * carried it). The contact has to reach the sleeper this step; a point that is near and fast but has not arrived has taken nothing yet.
 */
function knock(list: Contact[], woken: Set<Body>): void {
  const hit = new Set<Body>();
  for (const c of list) if (c.sleeper && c.reaches && c.closing > WAKE_SPEED) hit.add(c.sleeper);
  if (hit.size === 0) return;
  for (const c of list) {
    if (!c.sleeper || !hit.has(c.sleeper)) continue;
    applyImpulse(c.sleeper, mul(c.total, -1), c.sleeperR);
    woken.add(c.sleeper);
  }
}

/** The awake chairs as groups: those that touched one another this step together, every other chair alone. */
function groupsOf(awake: Body[], touching: Array<[Body, Body]>): Body[][] {
  const root = new Map<Body, Body>(awake.map((b) => [b, b]));
  const find = (b: Body): Body => { let r = b; while (root.get(r) !== r) r = root.get(r) as Body; return r; };
  for (const [a, b] of touching) if (root.has(a) && root.has(b)) root.set(find(a), find(b));
  const groups = new Map<Body, Body[]>();
  for (const b of awake) {
    const r = find(b);
    groups.set(r, [...(groups.get(r) ?? []), b]);
  }
  return [...groups.values()];
}

/** Out of penetration by translation alone, never a turn: chairs apart (a sleeper stays), then the walls and floor have the last word. */
function pushOut(world: World, awake: Body[]): void {
  const live = world.list.filter((b) => b.phase === 'tumbling');
  for (let pass = 0; pass < 3; pass++) {
    for (const a of awake) for (const b of live) {
      if (a === b || (!b.asleep && b.id < a.id) || norm(sub(a.pos, b.pos)) > 2 * RADIUS) continue;
      const sat = separation(a, b);
      if (sat.depth <= 0) continue;
      a.pos = add(a.pos, mul(sat.n, sat.depth * (b.asleep ? 1 : 0.5)));
      if (!b.asleep) b.pos = sub(b.pos, mul(sat.n, sat.depth * 0.5));
    }
    for (const a of awake) {
      let floorPast = 0, left = 0, right = 0;
      for (const local of CORNERS) {
        const p = pointOf(a, local);
        floorPast = Math.max(floorPast, p[1] - world.floorY);
        left = Math.max(left, -p[0]);
        right = Math.max(right, p[0] - world.width);
      }
      a.pos = [a.pos[0] + left - right, a.pos[1] - floorPast, a.pos[2]];
    }
  }
}

/** Sequential impulses: every pass visits every contact, friction first then the normal, with the sums clamped (a contact never pulls). */
function solve(list: Contact[], world: World): void {
  // Warm start: a contact that held last step starts this one with the impulse it held then, so a chair at rest is not
  // re-discovered by sixteen passes every step (which leaves it a few px/s of jitter and never lets it sleep). A bounce is new.
  for (const c of list) {
    const held = world.warm.get(c.key);
    if (!held || c.closing > BOUNCE_FLOOR) continue;
    held.forEach((amount, i) => { push(c, i, amount); c.j[i] = amount; });
  }
  for (let pass = 0; pass < PASSES; pass++) {
    for (const c of list) {
      for (let i = 1; i < 3; i++) {
        const limit = FRICTION * c.j[0];
        const was = c.j[i] as number;
        const next = Math.max(-limit, Math.min(limit, was - along(c, i) / (c.k[i] as number)));
        push(c, i, next - was);
        c.j[i] = next;
      }
      const next = Math.max(0, c.j[0] - (along(c, 0) - c.target) / c.k[0]);
      push(c, 0, next - c.j[0]);
      c.j[0] = next;
    }
  }
  for (const c of list) world.warming.set(c.key, c.j);
}

/** An impulse of size s along one of the contact's directions, on a and the opposite on b if b is awake. Velocities change in place. */
function push(c: Contact, i: number, s: number): void {
  const { a, b } = c;
  const d = c.d[i] as Vec3, wa = c.wa[i] as Vec3;
  a.vel[0] += d[0] * s; a.vel[1] += d[1] * s; a.vel[2] += d[2] * s;
  a.w[0] += wa[0] * s; a.w[1] += wa[1] * s; a.w[2] += wa[2] * s;
  c.total[0] += d[0] * s; c.total[1] += d[1] * s; c.total[2] += d[2] * s;
  if (b && c.bMoves) {
    const wb = c.wb[i] as Vec3;
    b.vel[0] -= d[0] * s; b.vel[1] -= d[1] * s; b.vel[2] -= d[2] * s;
    b.w[0] -= wb[0] * s; b.w[1] -= wb[1] * s; b.w[2] -= wb[2] * s;
  }
}
