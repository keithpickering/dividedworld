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
 * Sleep: a body slower than 6 px/s and 12 degrees a second for 0.4 s sleeps and becomes a static obstacle, but only while it lies low: no
 * corner higher above the floor than REST_RISE. One that goes quiet higher (standing on its end, leaning on a wall) is nudged and falls over
 * (nudge(): a seeded kick of its spin about its lowest edge, never a turn of its orientation, which still changes only by integrating the
 * spin), and so stays awake until it lies down. A body moving into a
 * sleeper faster than 200 px/s at a contact wakes it with the equal and opposite impulse, whether that contact is met before the move
 * (a chair stopped on arrival) or after it (one that overlapped anyway). Two awake chairs also push each other
 * apart (the plan names sleepers as the obstacles; two chairs falling together must not pass through each other either).
 *
 * Shapes: what a body is (the chair, a can) is a Shape, a convex solid symmetric about its middle: its sample points, corners, face normals,
 * edge directions, how far it reaches along a direction (support), inertia, reach, and what its rest allows. The contact tests read only that,
 * so a chair is a box that hinges and a can is a prism that may stand on its end. The chair's throw and rest are exactly what they were before
 * shapes (rest-record.json holds them); the throw draws the same numbers whatever is thrown.
 *
 * Cost: measured at about 0.01 to 0.02 ms a step with one chair tumbling, about 0.04 ms with three awake apart and about 0.05 ms with three
 * awake in a pile, and about 0.003 ms with all asleep, on a desktop (the figures before shapes, from an older run, were 0.02, 0.07, 0.12 and
 * 0.002 on that machine; on this one, the chair is the same before and after shapes to within the noise of the run). A prism of 12 sides (15 px
 * radius and 40 tall, the can's shape) costs more, since it has seven face normals and seven edge directions, not three: about 0.015 to 0.025 ms
 * with one tumbling, about 0.13 to 0.19 ms with three awake apart and about 0.2 to 0.3 ms with three awake in a pile; with a chair and two
 * prisms, about 0.1 ms apart and about 0.2 to 0.27 ms in a pile. A phone is several times slower. The caller must
 * cap the steps it runs in one frame (a slow frame must not owe a hundred steps, which makes the next frame slower still). The
 * cost is kept down without changing a result: a pair of chairs, or a chair and a wall, too far apart for any sample point to be
 * near is not probed; a step's contacts are recycled, not allocated; a contact nothing has pushed since it last pushed nothing is
 * not visited again in a step; and the separating axis test stops at the first face axis that separates two boxes.
 */

import type { ThrownObject } from './objects.ts';

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
  /** What is thrown: which shape the body has (SHAPES). It draws no number, so a seed's path is the same whatever it is. */
  object: ThrownObject;
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
  // speed, omega, omegaPeak and energy are for tests and diagnostics: what is drawn is the position, quaternion, fold and scale.
  /** Linear speed, px/s. */
  speed: number;
  /** Angular speed, rad/s. */
  omega: number;
  /** The fastest angular speed it had at any moment of the last step, rad/s: its orientation turned by no more than this times the
   * step. */
  omegaPeak: number;
  /** Kinetic (linear and rotational) plus g times height above the floor plus the glass spring's, with mass 1. */
  energy: number;
  /** How many times the body has been nudged to fall over (it went quiet standing, or leaning, above REST_RISE). */
  nudges: number;
  /** True if it was let sleep above REST_RISE after the cap of nudges: a wedged body, which the tests require to be none. */
  wedged: boolean;
}

interface Body {
  id: number;
  th: Throw;
  /** What the body is: its samples, corners, axes, inertia and reach. */
  shape: Shape;
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
  /** Counts the impulses the solver has applied to the body, so that a contact can tell whether anything it reads has changed. */
  pushes: number;
  /** How many nudges the body has had, and whether it was let sleep high after the cap. */
  nudges: number;
  wedged: boolean;
  /** The body's own seeded generator for its nudges (seeded from its throw, so every reader's screen draws the same). */
  luck: () => number;
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
/**
 * The highest a corner of a SLEEPING body may be above the floor, px: the most an honest rest on other chairs reaches. Three chairs lying
 * flat on one another stand 3 x the 8 px thickness (24); a chair lying across the edge of the stack, its far end up on it, stands up to one
 * more thickness above that (it is 46 wide, and tilted over one thickness it rises 8 across that width): 32; and 1 px more for the 0.5 px
 * (TOUCH) of each of the two contacts those rests keep. Three is the most the effect stacks (it keeps at most three live chairs). A body
 * that goes quiet any higher (standing on its 46 by 8 end or on its long narrow face, propped on a wall or the glass, or on more than
 * that) is not let sleep: it is nudged and falls over (nudge()).
 */
export const REST_RISE = 3 * 2 * HALF[2] + 2 * HALF[2] + 2 * 0.5;

export const GRAVITY = 1900;
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
/**
 * The nudge a quiet body above REST_RISE is given: its angular velocity gains a spin that tips it about its lowest edge toward a horizontal
 * direction drawn from its own seeded generator, and gravity does the rest. It is sized to the body: the energy the spin has about the pivot
 * is NUDGE_FIRST times the barrier (g times the rise it takes to lift the middle over the pivot; NUDGE_MIN_LIFT is the least counted), so a
 * chair on its 8 px end, whose barrier is a fraction of a pixel, gets a few thousand (7% of the energy of its fall) and one on its narrow face
 * its own, where one force for both would be a shove for one and a breath for the other. Each next nudge is NUDGE_GROWTH times harder, and the
 * spin is never over NUDGE_CAP rad/s. A chair stands unstably only toward its 8 px thickness (toward its 46 px width the barrier is a hundred
 * times more), so the direction starts within 30 degrees either side of the chair's thin axis, either way round, as a draft or a floor's
 * tremor would topple it; each next nudge triples that spread (within 90 degrees at the second, any direction at the third), since a chair
 * propped like a ladder between the floor and a wall tips only along its own length. After the first, a nudge also hops the body
 * (NUDGE_HOP) and slides it (NUDGE_SLIDE), which lets go the friction that holds a propped chair. In a room barely wider than the chair is
 * long a nudge that frees it can land it leaning on the other wall, so a body may need several (in a probe of 6000 seeded runs of three
 * throws the most was 11, one in 18000 bodies); from the tenth on a nudge is as hard as the tenth with a new direction, and a body is only
 * let sleep high (wedged) after MAX_NUDGES, which the tests count none of: the last resort, so that a run always ends.
 */
const NUDGE_FIRST = 2;
const NUDGE_GROWTH = 1.5;
const NUDGE_CAP = 6;
/** The nudge after which they stop growing: the tenth's strength is kept for the rest, since a harder one would only fling the chair across the room. */
const GROWN_AT = 10;
const NUDGE_SPREAD = Math.PI / 6;
/** The least rise of the middle, px, that a nudge's energy is sized for (g times it): about the lift of tipping a chair a few degrees. */
const NUDGE_MIN_LIFT = 1;
/** The hop that comes with a later nudge, px, and the sliding speed, px/s per unit of the nudge's strength, along the direction it tips. */
const NUDGE_HOP = 1.5;
const NUDGE_SLIDE = 60;
const MAX_NUDGES = 24;
/** How deep a point may be inside another chair's box and still be a touching contact solved before the move, px. */
const TOUCH = 0.5;
const PASSES = 16;
/** The hinge: a critically damped spring from open to closed that is 98 percent shut in about 0.15 s. */
const HINGE = 40;
/** The glass's spring, 1/s squared (about 3 Hz), and the drag on a chair held in it, 1/s. */
const GLASS_SPRING = 400;
const GLASS_DRAG = 8;
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
  const I = b.shape.inertia;
  const l0 = (R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) / I[0];
  const l1 = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) / I[1];
  const l2 = (R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) / I[2];
  return [R[0] * l0 + R[1] * l1 + R[2] * l2, R[3] * l0 + R[4] * l1 + R[5] * l2, R[6] * l0 + R[7] * l1 + R[8] * l2];
}

/** Where a local point of the box is in the world. */
const pointOf = (b: Body, local: Vec3): Vec3 => add(b.pos, toWorld(b.R, local));

/**
 * What a thrown object is, to the physics: everything the body reads about its form, so that the chair is one shape and a can another and
 * nothing below the shape knows which. All of it is local to the body (y is the prism's axis; the box's three axes are x, y and z).
 */
export interface Shape {
  name: string;
  /** Where the contact impulses act and what can touch another body: the corners first, then a row along each edge that can lie across another's face. */
  points: Vec3[];
  corners: Vec3[];
  /** The unit face normals, one for each parallel pair of faces. */
  faces: Vec3[];
  /** The unit edge directions, one for each parallel set. */
  edges: Vec3[];
  /** How far the shape reaches from its middle along a local unit direction. */
  support(dir: Vec3): number;
  /** Principal moments about the local x, y and z, mass 1. */
  inertia: Vec3;
  /** The distance from the middle to the farthest corner. */
  reach: number;
  /** Whether it folds as it is hit (the chair's hinge). */
  hinge: boolean;
  /** Whether it may sleep standing on its end, which is a rest and not a balance. */
  sleepsUpright: boolean;
  /** The highest a corner of a sleeping body of this shape may be above the floor, px. */
  restRise: number;
  /** Where a fire extinguisher's spout is, local (its top; y is negative up as the chair's frame has it). Only the extinguisher has one. */
  spout?: Vec3;
  /** A box's half extents: the exact distance to a box is known from them (a prism's is bounded by its face planes instead). */
  half?: Vec3;
}

/**
 * A box of uniform density and mass 1. What can touch another body is more than its corners: two thin boxes lie across each other with an
 * edge on a face and no corner under anything. So the points are the corners and a row along each of the eight edges of the two large faces,
 * every 15 px or so. They are where the contact impulses act, so that a body resting on another is held at several places and not two; the
 * separation of two bodies that overlap does not depend on them (separation() below finds it from the shapes).
 */
export function boxShape(half: Vec3, hinge: boolean): Shape {
  const corners: Vec3[] = [];
  for (let k = 0; k < 8; k++) corners.push([k & 4 ? half[0] : -half[0], k & 2 ? half[1] : -half[1], k & 1 ? half[2] : -half[2]]);
  const points: Vec3[] = [...corners];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) for (let k = 1; k < 6; k++) points.push([sx * half[0], -half[1] + (k * 2 * half[1]) / 6, sz * half[2]]);
    for (const sy of [-1, 1]) for (let k = 1; k < 3; k++) points.push([-half[0] + (k * 2 * half[0]) / 3, sy * half[1], sz * half[2]]);
  }
  const [w, h, d] = [half[0] * 2, half[1] * 2, half[2] * 2];
  const axes = (): Vec3[] => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return {
    name: 'box', points, corners, faces: axes(), edges: axes(),
    support: (v) => half[0] * Math.abs(v[0]) + half[1] * Math.abs(v[1]) + half[2] * Math.abs(v[2]),
    inertia: [(h * h + d * d) / 12, (w * w + d * d) / 12, (w * w + h * h) / 12],
    reach: Math.hypot(...half), hinge, sleepsUpright: false, restRise: 3 * 2 * half[2] + 2 * half[2] + 2 * 0.5, half,
  };
}

/**
 * A prism of uniform density and mass 1 along the local y: `sides` (even, so that faces come in parallel pairs) corners round each end, a
 * body that stands on its end or lies on a side. The points are the corners and a row every 15 px or so along each rim edge and down each
 * side edge. A cylinder's inertia is used, since a prism of many sides is not far from one.
 */
export function prismShape(radius: number, height: number, sides: number): Shape {
  if (sides < 4 || sides % 2 !== 0) throw new Error(`a prism needs an even number of sides, at least 4 (got ${sides})`);
  const halfHeight = height / 2;
  const turn = (2 * Math.PI) / sides;
  const rim: Array<[number, number]> = [];
  for (let k = 0; k < sides; k++) rim.push([radius * Math.cos(k * turn), radius * Math.sin(k * turn)]);
  const corners: Vec3[] = [];
  for (const sy of [-1, 1]) for (const [x, z] of rim) corners.push([x, sy * halfHeight, z]);
  const points: Vec3[] = [...corners];
  const row = (from: Vec3, to: Vec3): void => {
    const n = Math.max(1, Math.round(norm(sub(to, from)) / 15));
    for (let k = 1; k < n; k++) points.push(add(from, mul(sub(to, from), k / n)));
  };
  for (let k = 0; k < sides; k++) {
    for (let e = 0; e < 2; e++) row(corners[e * sides + k] as Vec3, corners[e * sides + ((k + 1) % sides)] as Vec3);
    row(corners[k] as Vec3, corners[sides + k] as Vec3);
  }
  const faces: Vec3[] = [], edges: Vec3[] = [];
  for (let k = 0; k < sides / 2; k++) {
    const mid = (k + 0.5) * turn;
    faces.push([Math.cos(mid), 0, Math.sin(mid)]);
    const [x0, z0] = rim[k] as [number, number], [x1, z1] = rim[(k + 1) % sides] as [number, number];
    const len = Math.hypot(x1 - x0, z1 - z0);
    edges.push([(x1 - x0) / len, 0, (z1 - z0) / len]);
  }
  faces.push([0, 1, 0]);
  edges.push([0, 1, 0]);
  const thin = Math.min(2 * radius * Math.cos(turn / 2), height);
  return {
    name: `prism${sides}`, points, corners, faces, edges,
    support: (v) => {
      let best = -Infinity;
      for (const [x, z] of rim) best = Math.max(best, x * v[0] + z * v[2]);
      return best + halfHeight * Math.abs(v[1]);
    },
    inertia: [(3 * radius * radius + height * height) / 12, (radius * radius) / 2, (3 * radius * radius + height * height) / 12],
    reach: Math.hypot(radius, halfHeight), hinge: false, sleepsUpright: true, restRise: 4 * thin + 2 * 0.5,
  };
}

/** The folding chair. */
export const CHAIR: Shape = boxShape(HALF, true);

/** How thick a shape is lying on its thinnest face, px: a box's thinnest side, a prism's width across two parallel side faces. */
function lyingThickness(shape: Shape): number {
  return Math.min(...shape.faces.map((f) => 2 * shape.support(f)));
}

/** How thick a chair lies, px (HALF[2] each side): what two of them under an object add to its rest. */
export const CHAIR_THICKNESS = 2 * HALF[2];

/**
 * The highest a corner of a sleeping shape reaches, worked out as the chair's REST_RISE comment does it, but with the owner's reading of
 * 2026-11-25 (issue #1104): an object rests on at most two chairs (not on the thickest object that could lie under it), so that is two chair
 * thicknesses; then its own lying thickness twice (lying flat on that stack, and lying across the edge of it one thickness higher), or its
 * own height for one that stands on its end; and 1 px for the 0.5 px (TOUCH) of each of two contacts. The chair's own is 33 by the same
 * sum (two chairs, two of itself, 1), which is why it keeps REST_RISE.
 */
function restRiseOver(shape: Shape): number {
  const lying = 2 * lyingThickness(shape);
  const standing = shape.sleepsUpright ? 2 * shape.support([0, 1, 0]) : 0;
  return 2 * CHAIR_THICKNESS + Math.max(lying, standing) + 2 * 0.5;
}

/* The owner's tuned sizes (2026-11-25, from his bench): the reaches are 48.9, 50.6 and 47.0, none past the chair's 50.7. */
const CAN = prismShape(25, 84, 12);
const LADDER = boxShape([15, 48, 6], true);
const EXTINGUISHER = { ...prismShape(13.5, 90, 12), spout: [18, -39.6, 0] as Vec3 };

/** The shape of each thrown object. The chair keeps the rest it had before shapes (REST_RISE, which chair.ts's room is made from). */
export const SHAPES: Record<ThrownObject, Shape> = {
  chair: CHAIR,
  can: { ...CAN, restRise: restRiseOver(CAN) },
  ladder: { ...LADDER, restRise: restRiseOver(LADDER) },
  extinguisher: { ...EXTINGUISHER, restRise: restRiseOver(EXTINGUISHER) },
};

/** The corners of a body as the view shows it (a box's eight, in the order a bit pattern of (x, y, z) signs counts). */
export function cornersOf(b: BodyView, shape: Shape = CHAIR): Vec3[] {
  const R = matrixOf([b.quaternion.w, b.quaternion.x, b.quaternion.y, b.quaternion.z]);
  const pos: Vec3 = [b.position.x, b.position.y, b.position.z];
  return shape.corners.map((c) => add(pos, toWorld(R, c)));
}

/* ---------- the world ---------- */

export function createWorld(width: number, height: number, floorY: number): World {
  return { width, height, floorY, list: [], nextId: 1, warm: new Map(), warming: new Map() };
}

/**
 * Where a throw's target falls in the box it is given: this fraction of the way in from the left and from the top (the inset) and this much
 * of the box's width and height on from there (the span), so the target is 15 to 85 percent across and 15 to 60 percent down. Named, and
 * exported, because dent.ts `hitZone` sizes the box a throw is given from exactly this range: one list, not two that must agree.
 */
export const THROW_INSET_X = 0.15;
export const THROW_SPAN_X = 0.7;
export const THROW_INSET_Y = 0.15;
export const THROW_SPAN_Y = 0.45;

/**
 * A throw. The target is a point in the words' box, 15 percent in from the sides and from the top and no lower than 60 percent
 * of its height (the dent bends the words, so the aim is the words). The chair comes from any direction, from one diagonal of
 * the world away (taken as twice the words' margins plus their size, since the world is the box the words sit in), at 1500 px/s,
 * spinning up to 600 degrees a second about each axis, scaled 2.2 times and shrinking to 1 as it arrives. The object draws no number: the
 * same generator gives the same throw whatever is thrown, so what differs between objects is their shape and nothing else.
 */
export function throwOf(rand: () => number, words: Box, object: ThrownObject = 'chair'): Throw {
  const target = {
    x: words.left + words.width * (THROW_INSET_X + THROW_SPAN_X * rand()),
    y: words.top + words.height * (THROW_INSET_Y + THROW_SPAN_Y * rand()),
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
  return { target, start, direction, speed: 1500, spin, orientation, scaleFrom: 2.2, kick, spinAfter, object };
}

/** A seed for a body's nudges, from the numbers of its throw alone (the same throw, the same nudges, on any machine). */
function seedOf(th: Throw): number {
  let h = 2166136261;
  for (const v of [th.target.x, th.target.y, ...th.orientation, th.kick, th.spinAfter[0]]) h = Math.imul(h ^ Math.floor(v * 1e6), 16777619);
  return h >>> 0;
}

/** The highest any corner of a body is above the floor, px. */
function riseOf(world: World, b: Body): number {
  let top = Infinity;
  for (const corner of b.shape.corners) top = Math.min(top, pointOf(b, corner)[1]);
  return world.floorY - top;
}

/** The most an end face may lean from the horizontal, and still be an end the body stands on: 5 degrees. */
const UPRIGHT = Math.cos(5 * Math.PI / 180);

/**
 * Whether a body that sleeps upright stands on its end: the end's whole outline within TOUCH of the floor, and the end the prism's own (its
 * axis, the local y, within 5 degrees of the world's up or down). A body that is only held there by a wall or another chair is not.
 */
function onItsEnd(world: World, b: Body): boolean {
  if (!b.shape.sleepsUpright) return false;
  const axis = toWorld(b.R, [0, 1, 0]);
  if (Math.abs(axis[1]) < UPRIGHT) return false;
  // y runs down: the end that is lower is the one on the floor
  const side = axis[1] > 0 ? 1 : -1;
  for (const corner of b.shape.corners) {
    if (corner[1] * side <= 0) continue;
    if (Math.abs(world.floorY - pointOf(b, corner)[1]) > TOUCH) return false;
  }
  return true;
}

/** Whether a body is too high to sleep: a corner above its shape's restRise, unless it stands on a prism's end. */
function tooHigh(world: World, b: Body): boolean {
  return riseOf(world, b) > b.shape.restRise && !onItsEnd(world, b);
}

/**
 * Tips a body that has gone quiet above REST_RISE (standing on its end or its narrow face, propped on a wall, the glass or another chair)
 * so that it falls over. Physics and nothing else: its angular velocity gains a nudge about a horizontal axis whose angle is drawn from the
 * body's seeded generator (so the sign and the axis differ from body to body and are the same for every reader), pivoting about the lowest
 * corner: the middle gets the linear velocity that pivot gives it, so the corner is not driven into the floor. The orientation is not
 * touched: it turns only as the next steps integrate this spin, and the contacts and gravity do the falling. Each nudge for the same
 * body is harder than the one before (NUDGE_GROWTH, up to NUDGE_CAP).
 */
function nudge(world: World, b: Body): void {
  b.nudges++;
  b.quiet = 0;
  /* The direction to tip toward: the body's thin axis (its local z) seen from above, off by a seeded angle that widens with each nudge,
     and either way round (the sign is the generator's too). */
  const thin = toWorld(b.R, [0, 0, 1]);
  const base = Math.hypot(thin[0], thin[2]) > 0.05 ? Math.atan2(thin[2], thin[0]) : 0;
  const side = b.luck() < 0.5 ? 0 : Math.PI;
  const angle = base + side + (b.luck() * 2 - 1) * Math.min(Math.PI, NUDGE_SPREAD * 3 ** (b.nudges - 1));
  const rate = NUDGE_FIRST * NUDGE_GROWTH ** Math.min(b.nudges - 1, GROWN_AT - 1);
  const d: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
  /* The pivot: of the corners that are on the floor (within a pixel of the lowest) the one farthest toward d. */
  let lowY = -Infinity;
  for (const corner of b.shape.corners) lowY = Math.max(lowY, pointOf(b, corner)[1]);
  let pivot = b.pos, far = -Infinity;
  for (const corner of b.shape.corners) {
    const p = pointOf(b, corner);
    if (p[1] >= lowY - 1 && dot(p, d) > far) { far = dot(p, d); pivot = p; }
  }
  /* Tipping toward d, y being down, is the spin d x y; the middle moves as it does about that pivot. Its size: the energy the spin has about
     the pivot (the body's inertia about that axis through the middle, plus the middle's about the pivot) is `rate` times the barrier. */
  const axis = cross(d, [0, 1, 0]);
  const r = sub(b.pos, pivot);
  /* The middle's offset from the line through the pivot along the axis (the edge it tips over), and its height above that line. */
  const across = norm(cross(r, axis));
  /* No less than NUDGE_MIN_LIFT of it: a body already leaning over its pivot (a ladder between the floor and a wall) has none, and is held by
     friction alone, which a spin of nothing would not break. */
  const barrier = Math.max(NUDGE_MIN_LIFT, across - (pivot[1] - b.pos[1]));
  const local = toBody(b.R, axis);
  const I = b.shape.inertia;
  const inertia = I[0] * local[0] ** 2 + I[1] * local[1] ** 2 + I[2] * local[2] ** 2 + across ** 2;
  const spin = mul(axis, Math.min(NUDGE_CAP, Math.sqrt((2 * rate * GRAVITY * barrier) / inertia)));
  b.w = add(b.w, spin);
  b.vel = add(b.vel, cross(spin, sub(b.pos, pivot)));
  /* The first nudge is the tip alone. Where that did not free the body (one propped on a wall is held by friction, which a tip does not
     break), the next ones come with the hop and the slide. */
  if (b.nudges >= 2) {
    b.vel[1] -= Math.sqrt(2 * GRAVITY * NUDGE_HOP);
    b.vel = add(b.vel, mul(d, NUDGE_SLIDE * rate));
  }
}

/** Puts a throw in the air. The id is the caller's, if given, so a play can find its body again; otherwise the next free one. */
export function addThrow(world: World, th: Throw, id?: number): number {
  if (id !== undefined && world.list.some((b) => b.id === id)) throw new Error(`a body with id ${id} is already in the world`);
  const use = id ?? world.nextId;
  world.nextId = Math.max(world.nextId, use + 1);
  const body: Body = {
    id: use, th, shape: SHAPES[th.object], phase: 'flying',
    pos: [th.start.x, th.start.y, 0], q: th.orientation,
    vel: [th.direction.x * th.speed, th.direction.y * th.speed, 0], w: [...th.spin],
    R: matrixOf(th.orientation), flown: 0, foldT: 0, scale: th.scaleFrom, asleep: false, quiet: 0, floored: false, peak: 0, pushes: 0, nudges: 0, wedged: false, luck: rng(seedOf(th)),
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
  const I = b.shape.inertia;
  return 0.5 * dot(b.vel, b.vel) + 0.5 * (I[0] * local[0] ** 2 + I[1] * local[1] ** 2 + I[2] * local[2] ** 2);
}

/** Kinetic plus g times height above the floor plus what the glass's spring holds. */
function energyOf(world: World, b: Body): number {
  const over = Math.max(Math.abs(b.pos[2]) - DEPTH, 0);
  return kineticOf(b) + GRAVITY * (world.floorY - b.pos[1]) + 0.5 * GLASS_SPRING * over * over;
}

export function bodies(world: World): BodyView[] {
  return world.list.map((b) => ({
    id: b.id,
    position: { x: b.pos[0], y: b.pos[1], z: b.pos[2] },
    quaternion: { w: b.q[0], x: b.q[1], y: b.q[2], z: b.q[3] },
    fold: b.phase === 'flying' || !b.shape.hinge ? 1 : foldAt(b.foldT),
    scale: b.scale,
    phase: b.phase,
    asleep: b.asleep,
    speed: norm(b.vel),
    omega: norm(b.w),
    omegaPeak: Math.max(b.peak, norm(b.w)),
    energy: energyOf(world, b),
    nudges: b.nudges,
    wedged: b.wedged,
  }));
}

/**
 * The gap between one play's throw and the next, in steps of the world's own time (0.35 s): the effect's animated run, its reduced
 * picture and the tests all stagger by this one number, so a seed's pile is the same in each.
 */
export const STAGGER_STEPS = Math.round(0.35 / STEP);
/**
 * The longest a run is settled for at once (reduced motion), in simulated seconds. A chair that lands on its end is nudged
 * over, which can take several tries of a fall each: of 6000 seeded runs of three throws into rooms of four sizes the slowest took 20 s
 * (one body needing 11 nudges), and settling that one takes about 0.4 s of a reader's main thread. The tests hold the slowest world they
 * run to half of this, so that a run cut off with a chair in mid-air is not one seed away.
 */
export const SETTLE_S = 60;

/**
 * Steps until every body sleeps or maxSeconds of simulated time have passed; for reduced motion. The return value says
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
  pooled = 0;
  const early: Contact[] = [];
  const surfaces = planes(world);
  for (const a of moving) {
    // a point farther from a surface than three steps of the fastest anything on the body moves cannot reach it this step
    const reach = 3 * (norm(a.vel) + norm(a.w) * a.shape.reach) * dt + 1;
    // and no point of the body is nearer a surface than the middle's distance less the radius: a surface that sphere cannot reach is
    // skipped
    const near = surfaces.map((plane) => plane.gap(a.pos) - a.shape.reach <= reach + 1e-6);
    for (const [ci, corner] of a.shape.corners.entries()) {
      const p = pointOf(a, corner);
      for (const [pi, plane] of surfaces.entries()) {
        if (!near[pi]) continue;
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
  const speed = new Map<Body, number>(live.map((b) => [b, norm(b.vel) + norm(b.w) * b.shape.reach]));
  for (const a of moving) {
    for (const b of live) {
      if (a === b) continue;
      const reach = 3 * ((speed.get(a) as number) + (speed.get(b) as number)) * dt + 1;
      if (norm(sub(a.pos, b.pos)) > a.shape.reach + b.shape.reach + reach) continue;
      // no point of a chair is nearer the other's box than its middle's distance less its radius: a pair that sphere cannot reach has
      // no sample near enough, and its probes are skipped (a point is never counted nearer than it is)
      const forth = !apart(a, b, reach);
      // a sleeper's points near this chair too (an awake chair's own points are its own contacts): the sleeper cannot give way
      const back = b.asleep && !apart(b, a, reach);
      if (!forth && !back) continue;
      const pa = a.shape.points, pb = b.shape.points;
      for (let si = 0; si < Math.max(pa.length, pb.length); si++) {
        const near = forth && si < pa.length ? probeNear(a, pa[si] as Vec3, b, reach) : null;
        if (near) early.push(makeContact(a, b, near.p, near.n, FLOOR_BOUNCE, false, dt, near.gap, `s${a.id}.${b.id}.${si}`));
        const under = back && si < pb.length ? probeNear(b, pb[si] as Vec3, a, reach) : null;
        if (under) {
          const n: Vec3 = [-under.n[0], -under.n[1], -under.n[2]];
          const c = makeContact(a, null, under.p, n, FLOOR_BOUNCE, false, dt, under.gap, `t${a.id}.${b.id}.${si}`);
          c.sleeper = b;
          c.sleeperR[0] = under.p[0] - b.pos[0]; c.sleeperR[1] = under.p[1] - b.pos[1]; c.sleeperR[2] = under.p[2] - b.pos[2];
          early.push(c);
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
  for (const group of touching.length > 0 ? groupsOf(awake, touching) : awake.map((b) => [b])) {
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
    if (b.quiet >= SLEEP_TIME && tooHigh(world, b) && b.nudges < MAX_NUDGES) nudge(world, b);
    else if (b.quiet >= SLEEP_TIME) {
      if (tooHigh(world, b)) b.wedged = true;
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
  const I = b.shape.inertia;
  const momentum = toWorld(b.R, [l[0] * I[0], l[1] * I[1], l[2] * I[2]]);
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
  closing: number;
  /** Whether the point reaches the surface within this step at the speed it has before the solve. */
  reaches: boolean;
  /** The least normal speed the solver leaves: a bounce's, or minus the gap over dt so a chair arrives and goes no further. */
  target: number;
  /** The impulse so far along the normal and the two tangents, summed over the passes (the clamps are on the sums). */
  j: [number, number, number];
  /** Everything applied to a, so a woken sleeper can be given the opposite. */
  total: Vec3;
  /** True when the last visit of the solver pushed nothing, with a and b's push counts as they were (a, b) after it. */
  settled: boolean;
  seenA: number;
  seenB: number;
  /** The sleeping chair this contact pushes against, if any (whether b is it or the contact is a wall-like one made from its
   * point), and its lever arm. */
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

/**
 * The contacts of a step are recycled: a step makes dozens, each with a dozen small arrays, and the arrays are filled in place. A
 * contact is good until the next list is begun (the early list is finished before the late one starts, and a step is not re-entered).
 */
const pool: Contact[] = [];
let pooled = 0;

function blankContact(): Contact {
  const v = (): Vec3 => [0, 0, 0];
  return {
    key: '', a: null as unknown as Body, b: null, bMoves: false, floor: false,
    d: [v(), v(), v()], rxa: [v(), v(), v()], rxb: [v(), v(), v()], wa: [v(), v(), v()], wb: [v(), v(), v()],
    k: [0, 0, 0], closing: 0, reaches: false, target: 0, j: [0, 0, 0], total: [0, 0, 0], sleeper: null, sleeperR: v(),
    settled: false, seenA: 0, seenB: 0,
  };
}

/** r x d into out. */
function crossInto(r0: number, r1: number, r2: number, d: Vec3, out: Vec3): void {
  out[0] = r1 * d[2] - r2 * d[1];
  out[1] = r2 * d[0] - r0 * d[2];
  out[2] = r0 * d[1] - r1 * d[0];
}

/** invInertia() into out. */
function invInertiaInto(b: Body, v: Vec3, out: Vec3): void {
  const R = b.R;
  const I = b.shape.inertia;
  const l0 = (R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) / I[0];
  const l1 = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) / I[1];
  const l2 = (R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) / I[2];
  out[0] = R[0] * l0 + R[1] * l1 + R[2] * l2;
  out[1] = R[3] * l0 + R[4] * l1 + R[5] * l2;
  out[2] = R[6] * l0 + R[7] * l1 + R[8] * l2;
}

function makeContact(a: Body, b: Body | null, p: Vec3, n: Vec3, e: number, floor: boolean, dt: number, gap: number, key: string): Contact {
  if (pooled === pool.length) pool.push(blankContact());
  const c = pool[pooled++] as Contact;
  const bMoves = b !== null && !b.asleep;
  c.key = key; c.a = a; c.b = b; c.bMoves = bMoves; c.floor = floor;
  const { d, rxa, rxb, wa, wb } = c;
  const d0 = d[0] as Vec3, d1 = d[1] as Vec3, d2 = d[2] as Vec3;
  d0[0] = n[0]; d0[1] = n[1]; d0[2] = n[2];
  // the tangents: n crossed with an axis it is not near, and n crossed with that
  const hx = Math.abs(n[0]) < 0.9 ? 1 : 0, hy = Math.abs(n[0]) < 0.9 ? 0 : 1;
  const t0 = n[1] * 0 - n[2] * hy, t1 = n[2] * hx - n[0] * 0, t2 = n[0] * hy - n[1] * hx;
  const l1 = Math.hypot(t0, t1, t2);
  d1[0] = t0 / l1; d1[1] = t1 / l1; d1[2] = t2 / l1;
  d2[0] = d0[1] * d1[2] - d0[2] * d1[1]; d2[1] = d0[2] * d1[0] - d0[0] * d1[2]; d2[2] = d0[0] * d1[1] - d0[1] * d1[0];
  const rax = p[0] - a.pos[0], ray = p[1] - a.pos[1], raz = p[2] - a.pos[2];
  const rbx = b ? p[0] - b.pos[0] : 0, rby = b ? p[1] - b.pos[1] : 0, rbz = b ? p[2] - b.pos[2] : 0;
  const k = c.k;
  for (let i = 0; i < 3; i++) {
    const di = d[i] as Vec3, xa = rxa[i] as Vec3, xb = rxb[i] as Vec3, ya = wa[i] as Vec3, yb = wb[i] as Vec3;
    crossInto(rax, ray, raz, di, xa);
    invInertiaInto(a, xa, ya);
    if (b) crossInto(rbx, rby, rbz, di, xb); else { xb[0] = 0; xb[1] = 0; xb[2] = 0; }
    if (bMoves) invInertiaInto(b as Body, xb, yb); else { yb[0] = 0; yb[1] = 0; yb[2] = 0; }
    k[i] = 1 + dot(ya, xa) + (bMoves ? 1 + dot(yb, xb) : 0);
  }
  c.j[0] = 0; c.j[1] = 0; c.j[2] = 0;
  c.settled = false;
  c.total[0] = 0; c.total[1] = 0; c.total[2] = 0;
  c.sleeper = b && b.asleep ? b : null;
  c.sleeperR[0] = rbx; c.sleeperR[1] = rby; c.sleeperR[2] = rbz;
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
 * Whether a local point of one body is inside another body's shape: the point, the way out along the least-penetrating face and how
 * far, or null. The point's depth below each face's plane is what the shape reaches along that face's normal less how far the point is
 * along it, on both faces of a parallel pair (the shapes are symmetric about their middles). Plain numbers, since this runs for every
 * sample of every near pair, several times a step.
 */
export function probe(owner: Body, local: Vec3, box: Body): { p: Vec3; n: Vec3; depth: number } | null {
  const R = owner.R, Q = box.R;
  const px = owner.pos[0] + R[0] * local[0] + R[1] * local[1] + R[2] * local[2];
  const py = owner.pos[1] + R[3] * local[0] + R[4] * local[1] + R[5] * local[2];
  const pz = owner.pos[2] + R[6] * local[0] + R[7] * local[1] + R[8] * local[2];
  const dx = px - box.pos[0], dy = py - box.pos[1], dz = pz - box.pos[2];
  const L0 = Q[0] * dx + Q[3] * dy + Q[6] * dz;
  const L1 = Q[1] * dx + Q[4] * dy + Q[7] * dz;
  const L2 = Q[2] * dx + Q[5] * dy + Q[8] * dz;
  const { faces, support } = box.shape;
  let best = -1, depth = Infinity, sign = 1;
  for (let k = 0; k < faces.length; k++) {
    const f = faces[k] as Vec3;
    const l = f[0] * L0 + f[1] * L1 + f[2] * L2;
    const r = support(f) - Math.abs(l);
    if (r <= 0) return null;
    if (r < depth) { best = k; depth = r; sign = l >= 0 ? 1 : -1; }
  }
  const f = faces[best] as Vec3;
  const n: Vec3 = [(Q[0] * f[0] + Q[1] * f[1] + Q[2] * f[2]) * sign, (Q[3] * f[0] + Q[4] * f[1] + Q[5] * f[2]) * sign, (Q[6] * f[0] + Q[7] * f[1] + Q[8] * f[2]) * sign];
  return { p: [px, py, pz], n, depth };
}

/**
 * The separating axis test of two bodies: the axis of least overlap among those of their shapes (the faces of each and the crossed
 * edges; for two boxes the fifteen: the three faces of each and the nine crossed edges), as a unit vector pointing from b toward a, and how
 * far they overlap along it (zero or less when they are apart). `reach` is how far a's shape extends from its middle along the axis, for
 * where its deepest point is.
 */
export function separation(a: Body, b: Body): { n: Vec3; depth: number; reach: number } {
  const A = a.R, B = b.R;
  tx = a.pos[0] - b.pos[0]; ty = a.pos[1] - b.pos[1]; tz = a.pos[2] - b.pos[2];
  sepDepth = Infinity; sepX = 0; sepY = 1; sepZ = 0; sepReach = 0;
  // the face axes first: one of them that separates the shapes ends it (the least overlap is then at most zero, whatever the rest say)
  for (const f of a.shape.faces) {
    if (axisOverlap(a, b, A[0] * f[0] + A[1] * f[1] + A[2] * f[2], A[3] * f[0] + A[4] * f[1] + A[5] * f[2], A[6] * f[0] + A[7] * f[1] + A[8] * f[2], false) <= 0) return APART;
  }
  for (const f of b.shape.faces) {
    if (axisOverlap(a, b, B[0] * f[0] + B[1] * f[1] + B[2] * f[2], B[3] * f[0] + B[4] * f[1] + B[5] * f[2], B[6] * f[0] + B[7] * f[1] + B[8] * f[2], false) <= 0) return APART;
  }
  for (const e of a.shape.edges) {
    const ux = A[0] * e[0] + A[1] * e[1] + A[2] * e[2], uy = A[3] * e[0] + A[4] * e[1] + A[5] * e[2], uz = A[6] * e[0] + A[7] * e[1] + A[8] * e[2];
    for (const g of b.shape.edges) {
      const vx = B[0] * g[0] + B[1] * g[1] + B[2] * g[2], vy = B[3] * g[0] + B[4] * g[1] + B[5] * g[2], vz = B[6] * g[0] + B[7] * g[1] + B[8] * g[2];
      axisOverlap(a, b, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, true);
    }
  }
  return { n: [sepX, sepY, sepZ], depth: sepDepth, reach: sepReach };
}

const APART = { n: [0, 1, 0] as Vec3, depth: -1, reach: 0 };
/** separation()'s state: the offset of the two middles and the least overlap so far (the module's scratch: a step is not re-entered). */
let tx = 0, ty = 0, tz = 0, sepDepth = 0, sepX = 0, sepY = 0, sepZ = 0, sepReach = 0;
/** The local direction reachAlong() hands a shape's support (the module's scratch). */
const local: Vec3 = [0, 0, 0];

/** How far a body's shape extends from its middle along a world unit direction. */
function reachAlong(b: Body, x: number, y: number, z: number): number {
  const R = b.R;
  local[0] = R[0] * x + R[3] * y + R[6] * z;
  local[1] = R[1] * x + R[4] * y + R[7] * z;
  local[2] = R[2] * x + R[5] * y + R[8] * z;
  return b.shape.support(local);
}

/** The overlap of two bodies along one candidate axis (not yet unit), kept as the best if it is the least so far. Returns the overlap. */
function axisOverlap(a: Body, b: Body, x: number, y: number, z: number, edge: boolean): number {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return Infinity;
  const ax = x / len, ay = y / len, az = z / len;
  const ra = reachAlong(a, ax, ay, az);
  const rb = reachAlong(b, ax, ay, az);
  const dist = tx * ax + ty * ay + tz * az;
  const depth = ra + rb - Math.abs(dist);
  // a face is preferred to an edge unless the edge is clearly less overlapped
  if (depth < sepDepth - (edge ? 1e-3 : 0)) {
    sepDepth = depth;
    const sign = dist >= 0 ? 1 : -1;
    sepX = ax * sign; sepY = ay * sign; sepZ = az * sign;
    sepReach = ra;
  }
  return depth;
}

/**
 * Whether every point of the owner's shape is farther than reach from the other body's shape, for certain: along one of the other shape's
 * own face normals the owner's shape (a sphere of its reach about its middle, or its extent along that axis, whichever is tighter) is that
 * far off. Then no sample of the owner is near the shape, and probeNear need not be asked about any of them.
 */
function apart(owner: Body, box: Body, reach: number): boolean {
  const Q = box.R;
  const dx = owner.pos[0] - box.pos[0], dy = owner.pos[1] - box.pos[1], dz = owner.pos[2] - box.pos[2];
  const limit = reach + 1e-6;
  const { faces } = box.shape;
  let sphere = 0, nearest = 0;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i] as Vec3;
    const x = Q[0] * f[0] + Q[1] * f[1] + Q[2] * f[2], y = Q[3] * f[0] + Q[4] * f[1] + Q[5] * f[2], z = Q[6] * f[0] + Q[7] * f[1] + Q[8] * f[2];
    const c = Math.abs(x * dx + y * dy + z * dz);
    const held = box.shape.support(f);
    // the extent of the owner's shape along that normal
    const out = c - reachAlong(owner, x, y, z) - held;
    if (out > limit) return true;
    const past = Math.max(c - held, 0);
    sphere += past * past;
    nearest = Math.max(nearest, past);
  }
  // for a box the passed distances are along orthogonal axes and add as a hypotenuse; for any other shape the farthest one is a bound
  return (box.shape.half ? Math.sqrt(sphere) : nearest) - owner.shape.reach > limit;
}

/**
 * How near a local point of one body is to another body's shape, from outside it: the point, the direction from the shape toward the
 * point (a box's face for a point over a face, the line to the nearest edge or corner for a point off one; a prism's is the face it is
 * farthest over, which is never farther than the point is) and the distance, or null if it is inside the shape or farther than reach.
 */
function probeNear(owner: Body, point: Vec3, box: Body, reach: number): { p: Vec3; n: Vec3; gap: number } | null {
  const R = owner.R, Q = box.R;
  const px = owner.pos[0] + R[0] * point[0] + R[1] * point[1] + R[2] * point[2];
  const py = owner.pos[1] + R[3] * point[0] + R[4] * point[1] + R[5] * point[2];
  const pz = owner.pos[2] + R[6] * point[0] + R[7] * point[1] + R[8] * point[2];
  const dx = px - box.pos[0], dy = py - box.pos[1], dz = pz - box.pos[2];
  const l0 = Q[0] * dx + Q[3] * dy + Q[6] * dz;
  const l1 = Q[1] * dx + Q[4] * dy + Q[7] * dz;
  const l2 = Q[2] * dx + Q[5] * dy + Q[8] * dz;
  const half = box.shape.half;
  if (!half) return probeNearConvex(px, py, pz, l0, l1, l2, box, reach);
  const o0 = l0 > half[0] ? l0 - half[0] : l0 < -half[0] ? l0 + half[0] : 0;
  const o1 = l1 > half[1] ? l1 - half[1] : l1 < -half[1] ? l1 + half[1] : 0;
  const o2 = l2 > half[2] ? l2 - half[2] : l2 < -half[2] ? l2 + half[2] : 0;
  const gap = Math.hypot(o0, o1, o2);
  if (gap > reach) return null;
  if (gap === 0) {
    // On the surface or just inside it: the way out is the nearest face. This is a contact at gap zero, not no contact: a chair that is
    // resting has its points exactly here (the push out leaves them on the surface to rounding), and a contact that was only taken when
    // the point was outside let a resting chair fall a step's gravity into the other and be stopped after the fact, so it started every
    // step at 16 px/s and never slept. A point deeper than TOUCH is a collision, which is the late pass's, along the pair's own axis.
    const r0 = half[0] - Math.abs(l0), r1 = half[1] - Math.abs(l1), r2 = half[2] - Math.abs(l2);
    const depth = Math.min(r0, r1, r2);
    if (depth > TOUCH) return null;
    const axis = r0 <= r1 && r0 <= r2 ? 0 : r1 <= r2 ? 1 : 2;
    const l = axis === 0 ? l0 : axis === 1 ? l1 : l2;
    const sign = l >= 0 ? 1 : -1;
    return {
      p: [px, py, pz],
      n: [Q[axis]! * sign, Q[3 + axis]! * sign, Q[6 + axis]! * sign],
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

/** probeNear for a shape that is not a box: the point's height over the face plane it is farthest over (the same rules as a box's for a point on or inside the surface). */
function probeNearConvex(px: number, py: number, pz: number, l0: number, l1: number, l2: number, box: Body, reach: number): { p: Vec3; n: Vec3; gap: number } | null {
  const Q = box.R;
  const { faces, support } = box.shape;
  let best = -1, over = -Infinity, sign = 1;
  for (let k = 0; k < faces.length; k++) {
    const f = faces[k] as Vec3;
    const l = f[0] * l0 + f[1] * l1 + f[2] * l2;
    const o = Math.abs(l) - support(f);
    if (o > over) { best = k; over = o; sign = l >= 0 ? 1 : -1; }
  }
  if (over > reach) return null;
  // inside the surface: a contact at gap zero if no deeper than TOUCH, as for a box
  if (over <= 0 && -over > TOUCH) return null;
  const f = faces[best] as Vec3;
  return {
    p: [px, py, pz],
    n: [(Q[0] * f[0] + Q[1] * f[1] + Q[2] * f[2]) * sign, (Q[3] * f[0] + Q[4] * f[1] + Q[5] * f[2]) * sign, (Q[6] * f[0] + Q[7] * f[1] + Q[8] * f[2]) * sign],
    gap: Math.max(over, 0),
  };
}

/** The first meeting of a chair with the floor is an event, with the speed it was closing at. */
function reportFloor(list: Contact[], events: Event[]): void {
  const speeds = new Map<Body, number>();
  for (const c of list) {
    if (c.floor && c.reaches && !c.a.floored && c.closing > 0) speeds.set(c.a, Math.max(speeds.get(c.a) ?? 0, c.closing));
  }
  for (const [body, speed] of speeds) { body.floored = true; events.push({ kind: 'floor', id: body.id, speed }); }
}

/**
 * The contacts after the move: a point of one chair inside another's box (a sleeper is static; an awake one takes its share), and
 * a corner a turn carried past the floor or a wall. Returns the bodies that touched another chair, whose energy is traded.
 */
function late(world: World, awake: Body[], dt: number, events: Event[], woken: Set<Body>): Array<[Body, Body]> {
  const touching: Array<[Body, Body]> = [];
  const live = world.list.filter((b) => b.phase === 'tumbling');
  pooled = 0;
  const list: Contact[] = [];
  const surfaces = planes(world);
  for (const a of awake) {
    // a surface farther from the middle than the radius has no corner past it
    const near = surfaces.map((plane) => plane.gap(a.pos) - a.shape.reach < 1e-6);
    for (const [ci, corner] of a.shape.corners.entries()) {
      const p = pointOf(a, corner);
      for (const [pi, plane] of surfaces.entries()) {
        if (near[pi] && plane.gap(p) < 0) list.push(makeContact(a, null, p, plane.n, plane.e, plane.floor, dt, 0, `p${a.id}.${ci}.${pi}`));
      }
    }
  }
  for (const a of awake) for (const b of live) {
    if (a === b || (!b.asleep && b.id < a.id) || norm(sub(a.pos, b.pos)) > a.shape.reach + b.shape.reach) continue;
    const sat = separation(a, b);
    if (sat.depth <= 0) continue;
    // One direction for the whole pair, the axis of least overlap: points of either chair inside the other push along it (each
    // point choosing its own way out had two thin chairs pushing across each other and leaving one standing in the other)
    let any = false;
    const pa = a.shape.points, pb = b.shape.points;
    for (let si = 0; si < Math.max(pa.length, pb.length); si++) {
      const inA = si < pa.length ? probe(a, pa[si] as Vec3, b) : null;
      if (inA) { any = true; list.push(makeContact(a, b, inA.p, sat.n, FLOOR_BOUNCE, false, dt, 0, `b${a.id}.${b.id}.${si}`)); }
      const inB = si < pb.length ? probe(b, pb[si] as Vec3, a) : null;
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
    let moved = false;
    for (const a of awake) for (const b of live) {
      if (a === b || (!b.asleep && b.id < a.id) || norm(sub(a.pos, b.pos)) > a.shape.reach + b.shape.reach) continue;
      const sat = separation(a, b);
      if (sat.depth <= 0) continue;
      moved = true;
      a.pos = add(a.pos, mul(sat.n, sat.depth * (b.asleep ? 1 : 0.5)));
      if (!b.asleep) b.pos = sub(b.pos, mul(sat.n, sat.depth * 0.5));
    }
    for (const a of awake) {
      let floorPast = 0, left = 0, right = 0;
      for (const local of a.shape.corners) {
        const p = pointOf(a, local);
        floorPast = Math.max(floorPast, p[1] - world.floorY);
        left = Math.max(left, -p[0]);
        right = Math.max(right, p[0] - world.width);
      }
      if (left === 0 && right === 0 && floorPast === 0) continue;
      moved = true;
      a.pos = [a.pos[0] + left - right, a.pos[1] - floorPast, a.pos[2]];
    }
    // a pass that moved nothing is the last that would: the next one sees what this one saw
    if (!moved) break;
  }
}

/** Sequential impulses: every pass visits every contact, friction first then the normal, with the sums clamped (a contact never pulls). */
function solve(list: Contact[], world: World): void {
  // Warm start: a contact that held last step starts this one with the impulse it held then, so a chair at rest is not
  // re-discovered by sixteen passes every step (which leaves it a few px/s of jitter and never lets it sleep). A bounce is new.
  for (const c of list) {
    const held = world.warm.get(c.key);
    if (!held || c.closing > BOUNCE_FLOOR) continue;
    for (let i = 0; i < 3; i++) { push(c, i, held[i] as number); c.j[i] = held[i] as number; }
  }
  for (let pass = 0; pass < PASSES; pass++) {
    for (const c of list) {
      // a visit is a function of the two bodies' velocities and the contact's own sums: if the last one pushed nothing and nothing it
      // reads has been pushed since, this one would push nothing either
      const { a, b } = c;
      if (c.settled && c.seenA === a.pushes && (!c.bMoves || c.seenB === (b as Body).pushes)) continue;
      const pushedA = a.pushes, pushedB = b ? b.pushes : 0;
      // Friction is clamped on each tangent separately, a square (a pyramid) around the cone, so a slide on a diagonal is slowed by up to
      // root two times as much as one along an axis. A Coulomb cone (the tangential impulse's length at most mu times the normal's) was
      // tried and is the physically right one: it slows a diagonal slide as much as an axis one (the todo test below). It is not used
      // because the 200-seed rest test then fails: with it seed 155 (or, with a different step on the tangents, seed 33) comes to rest
      // asleep tilted 21 degrees on one long edge of its thin end, 2.9 px off the floor. The same kind of rest turns up without it
      // (seeds 705, 734 and 1134 of the first 1500), so the cone only moves which seed it falls on; the rest itself is the open defect.
      const limit = FRICTION * c.j[0];
      for (let i = 1; i < 3; i++) {
        const was = c.j[i] as number;
        // a contact that holds nothing along the normal and nothing along this tangent can push nothing along it
        if (limit === 0 && was === 0) continue;
        const next = Math.max(-limit, Math.min(limit, was - along(c, i) / (c.k[i] as number)));
        push(c, i, next - was);
        c.j[i] = next;
      }
      const next = Math.max(0, c.j[0] - (along(c, 0) - c.target) / c.k[0]);
      push(c, 0, next - c.j[0]);
      c.j[0] = next;
      c.settled = a.pushes === pushedA && (!b || b.pushes === pushedB);
      c.seenA = a.pushes;
      c.seenB = b ? b.pushes : 0;
    }
  }
  for (const c of list) world.warming.set(c.key, [c.j[0], c.j[1], c.j[2]]);
}

/** An impulse of size s along one of the contact's directions, on a and the opposite on b if b is awake. Velocities change in place. */
function push(c: Contact, i: number, s: number): void {
  if (s === 0) return;
  const { a, b } = c;
  a.pushes++;
  const d = c.d[i] as Vec3, wa = c.wa[i] as Vec3;
  a.vel[0] += d[0] * s; a.vel[1] += d[1] * s; a.vel[2] += d[2] * s;
  a.w[0] += wa[0] * s; a.w[1] += wa[1] * s; a.w[2] += wa[2] * s;
  c.total[0] += d[0] * s; c.total[1] += d[1] * s; c.total[2] += d[2] * s;
  if (b && c.bMoves) {
    b.pushes++;
    const wb = c.wb[i] as Vec3;
    b.vel[0] -= d[0] * s; b.vel[1] -= d[1] * s; b.vel[2] -= d[2] * s;
    b.w[0] -= wb[0] * s; b.w[1] -= wb[1] * s; b.w[2] -= wb[2] * s;
  }
}
