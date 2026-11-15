/**
 * Steel Chair's body (docs/plans/2026-11-15-steel-chair-plan.md, Task 3): the chair is thrown, hits, folds and falls as a rigid
 * box, and its rest is whatever the contacts leave. The owner's words for it: "the chair is sort of snapping back to a standard 2D
 * orientation once it's on the floor, would be nice if we could make it settle on the floor in a way that completes the movement
 * realistically." So these tests hold the model to physics and never to a pose: no corner through a wall, energy that never rises,
 * an orientation that never turns faster than its own spin ("no snap"), and rest on a real face with every seed ending differently.
 *
 * Each seed is simulated once and its measurements are kept, so the several tests that read one throw do not each run it again.
 * The test world is a post's content area (600 by 260 px, floor 28 px under the words) and a short one for a post of a few lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addThrow, bodies, cornersOf, createWorld, DEPTH, HALF, remove, resize, rng, settle, step, STEP, throwOf,
  type BodyView, type Box, type Event, type World,
} from './body.ts';

const SEEDS = 200;
/** How far past the glass or the back wall the middle of a chair may be pushed by a hard knock before the spring turns it. */
const GLASS_GIVE = 20;
/** Seconds between the three throws into one world: long enough that the earlier chairs have mostly gone to sleep when the next lands. */
const GAP = 1.6;
const WORDS: Box = { left: 40, top: 30, width: 520, height: 200 };
const WORLD = { width: 600, height: 260, floorY: 258 };
const SHORT_WORDS: Box = { left: 40, top: 20, width: 520, height: 80 };
const SHORT = { width: 600, height: 150, floorY: 128 };
const DEG = Math.PI / 180;
/**
 * What "beyond rounding" means for energy, in the energy units of mass 1 (px squared over s squared): a hundredth of a pixel of lift (g times
 * 0.01). A resting chair is moved out of the sliver of floor its turn's arc left it in, and that lift has no kinetic energy to come from.
 */
const RISE = 1900 * 0.01;

type Kind = typeof WORLD;
type V3 = [number, number, number];
type Mat = [V3, V3, V3];

/** An element that has to be there (the tests index lists they know are long enough). */
function at<T>(list: T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`no element ${i}`);
  return v;
}
const worldOf = (k: Kind): World => createWorld(k.width, k.height, k.floorY);

/** The three local axes of a view's box in the world (the columns of its rotation matrix): x across, y along, z through its thickness. */
function matrix(b: BodyView): Mat {
  const { w, x, y, z } = b.quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}

const dot3 = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const half = (i: number): number => HALF[i] as number;

/** The angle between two orientations, radians, accurate for tiny turns. */
function turn(a: BodyView, b: BodyView): number {
  const p = a.quaternion, q = b.quaternion;
  // q * conj(p), the turn from a to b
  const w = q.w * p.w + q.x * p.x + q.y * p.y + q.z * p.z;
  const x = -q.w * p.x + q.x * p.w - q.y * p.z + q.z * p.y;
  const y = -q.w * p.y + q.x * p.z + q.y * p.w - q.z * p.x;
  const z = -q.w * p.z - q.x * p.y + q.y * p.x + q.z * p.w;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

/** How far a point is from a body's box, zero inside it. */
function distanceToBox(p: V3, b: BodyView): number {
  const d: V3 = [p[0] - b.position.x, p[1] - b.position.y, p[2] - b.position.z];
  let sum = 0;
  for (const [i, axis] of matrix(b).entries()) {
    const out = Math.max(Math.abs(dot3(axis, d)) - half(i), 0);
    sum += out * out;
  }
  return Math.sqrt(sum);
}

/** The depth two boxes overlap by along their least-overlapping separating axis (the 15 of the separating axis test); at most zero when apart. */
function overlap(a: BodyView, b: BodyView): number {
  const ma = matrix(a), mb = matrix(b);
  const axes: V3[] = [...ma, ...mb];
  for (const u of ma) for (const v of mb) {
    const c: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len > 1e-6) axes.push([c[0] / len, c[1] / len, c[2] / len]);
  }
  const t: V3 = [b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z];
  let least = Infinity;
  for (const ax of axes) {
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) { ra += half(i) * Math.abs(dot3(ma[i] as V3, ax)); rb += half(i) * Math.abs(dot3(mb[i] as V3, ax)); }
    least = Math.min(least, ra + rb - Math.abs(dot3(t, ax)));
  }
  return least;
}

/** The face a resting body lies on: the local axis most along gravity, its sign, and the corners of that face. */
function lyingFace(b: BodyView): { key: string; face: Array<[number, number, number]> } {
  const m = matrix(b);
  let axis = 0;
  m.forEach((ax, i) => { if (Math.abs(ax[1]) > Math.abs((m[axis] as V3)[1])) axis = i; });
  const sign = (m[axis] as V3)[1] > 0 ? 1 : -1;
  const face = cornersOf(b).filter((_, k) => ((k >> (2 - axis)) & 1 ? 1 : -1) === sign);
  return { key: `${axis}${sign > 0 ? '+' : '-'}`, face };
}

/**
 * Whether a body at rest is propped on an edge against a side wall: two corners on the floor and a corner on the wall. With the plan's
 * friction (0.5 on the floor and on a wall) a chair leaning steeply on a wall stays where it is, which is what the contacts leave.
 */
function leansOnWall(b: BodyView, width: number, floorY: number): boolean {
  const corners = cornersOf(b);
  const onFloor = corners.filter((c) => Math.abs(floorY - c[1]) <= 0.75).length;
  const onWall = corners.filter((c) => c[0] <= 0.75 || width - c[0] <= 0.75).length;
  return onFloor >= 2 && onWall >= 1;
}

/** Everything one throw into an empty world measures, for the tests below. */
interface Run {
  seed: number;
  target: { x: number; y: number };
  hits: Array<Extract<Event, { kind: 'hit' }>>;
  floors: Array<Extract<Event, { kind: 'floor' }>>;
  rests: number;
  flightDeviation: number;
  flightFold: number;
  scaleFirst: number;
  scaleLast: number;
  maxPast: number;
  maxRise: number;
  maxTurnExcess: number;
  sleptAt: number;
  woke: boolean;
  final: BodyView;
  pose: string;
  heading: number;
  faceGap: number;
  leans: boolean;
}

const runs = new Map<string, Run>();

function simulate(seed: number, words: Box = WORDS, kind: Kind = WORLD): Run {
  const memo = `${seed}:${words.height}`;
  const cached = runs.get(memo);
  if (cached) return cached;
  const world = worldOf(kind);
  const th = throwOf(rng(seed), words);
  const id = addThrow(world, th);
  const dx = th.target.x - th.start.x, dy = th.target.y - th.start.y, len = Math.hypot(dx, dy);
  const run: Partial<Run> = {
    seed, target: th.target, hits: [], floors: [], rests: 0, flightDeviation: 0, flightFold: 1, scaleFirst: 0, scaleLast: 0,
    maxPast: 0, maxRise: 0, maxTurnExcess: 0, sleptAt: Infinity, woke: false,
  };
  let prev = at(bodies(world), 0);
  let prevEnergy = NaN;
  let tumblingSteps = 0;
  let t = 0;
  for (let i = 0; i < 7 * 120; i++) {
    const events = step(world, STEP);
    t += STEP;
    for (const e of events) {
      assert.equal(e.id, id);
      if (e.kind === 'hit') run.hits!.push(e);
      else if (e.kind === 'floor') run.floors!.push(e);
      else run.rests!++;
    }
    const b = at(bodies(world), 0);
    if (i === 0) run.scaleFirst = b.scale;
    // the spin a body has can change inside a step (a contact's impulse), so the bound is the fastest it spun during it
    const excess = turn(prev, b) - Math.max(prev.omega, b.omegaPeak) * STEP - 0.01 * DEG;
    run.maxTurnExcess = Math.max(run.maxTurnExcess!, excess);
    if (b.phase === 'flying') {
      run.scaleLast = b.scale;
      run.flightFold = Math.min(run.flightFold!, b.fold);
      // the distance of the body's position from the straight line start -> target
      const px = b.position.x - th.start.x, py = b.position.y - th.start.y;
      run.flightDeviation = Math.max(run.flightDeviation!, Math.abs(px * dy - py * dx) / len, Math.abs(b.position.z));
    } else {
      tumblingSteps++;
      let past = 0;
      for (const c of cornersOf(b)) past = Math.max(past, c[1] - kind.floorY, -c[0], c[0] - kind.width);
      // the glass and back wall are soft: they hold the chair's middle near them with a spring, and its ends may poke through
      past = Math.max(past, (Math.abs(b.position.z) - DEPTH - GLASS_GIVE) + 0.5);
      run.maxPast = Math.max(run.maxPast!, past);
      // the hit step itself sets a new velocity, so the energy is followed from the step after it
      if (tumblingSteps > 1 && !prev.asleep && !Number.isNaN(prevEnergy)) {
        run.maxRise = Math.max(run.maxRise!, b.energy - prevEnergy);
      }
      prevEnergy = b.energy;
    }
    if (prev.asleep && !b.asleep) run.woke = true;
    if (b.asleep && run.sleptAt === Infinity) run.sleptAt = t;
    prev = b;
    if (b.asleep && t > run.sleptAt! + 0.05) break;
  }
  run.final = at(bodies(world), 0);
  const lying = lyingFace(run.final);
  run.pose = lying.key;
  const m = matrix(run.final);
  run.heading = Math.atan2((m[1] as V3)[2], (m[1] as V3)[0]);
  run.faceGap = Math.max(...lying.face.map((c) => Math.abs(kind.floorY - c[1])));
  run.leans = leansOnWall(run.final, kind.width, kind.floorY);
  runs.set(memo, run as Run);
  return run as Run;
}

test('throwOf aims inside the words, 15 percent in from the sides and the top and no lower than 60 percent of their height', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const th = throwOf(rng(seed), WORDS);
    assert.ok(th.target.x >= WORDS.left + 0.15 * WORDS.width - 1e-9 && th.target.x <= WORDS.left + 0.85 * WORDS.width + 1e-9, `x ${th.target.x}`);
    assert.ok(th.target.y >= WORDS.top + 0.15 * WORDS.height - 1e-9 && th.target.y <= WORDS.top + 0.6 * WORDS.height + 1e-9, `y ${th.target.y}`);
    const away = Math.hypot(th.start.x - th.target.x, th.start.y - th.target.y);
    assert.ok(away > 600, 'it starts a world diagonal away, outside the box');
  }
});

test('the same seed gives the same throw', () => {
  assert.deepEqual(throwOf(rng(7), WORDS), throwOf(rng(7), WORDS));
  assert.notDeepEqual(throwOf(rng(7), WORDS), throwOf(rng(8), WORDS));
  const draw = rng(3);
  for (let i = 0; i < 50; i++) { const n = draw(); assert.ok(n >= 0 && n < 1); }
});

test('flight is a straight line to the target with the chair open and falling in scale, and reports exactly one hit, at the target', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    assert.equal(r.hits.length, 1, `seed ${seed}`);
    assert.ok(Math.abs(at(r.hits, 0).at.x - r.target.x) < 1e-9 && Math.abs(at(r.hits, 0).at.y - r.target.y) < 1e-9, `seed ${seed} hit at ${JSON.stringify(at(r.hits, 0).at)}`);
    assert.ok(r.flightDeviation < 1e-6, `seed ${seed} left the line by ${r.flightDeviation}`);
    assert.equal(r.flightFold, 1);
    assert.ok(r.scaleFirst > 2.1 && r.scaleFirst <= 2.2, `first scale ${r.scaleFirst}`);
    assert.ok(r.scaleLast >= 1 && r.scaleLast < 1.05, `last flying scale ${r.scaleLast}`);
  }
});

test('the hit sends the chair back along its approach, up, and spinning, and the hinge closes', () => {
  const world = worldOf(WORLD);
  const th = throwOf(rng(5), WORDS);
  addThrow(world, th);
  let hit = false;
  for (let i = 0; i < 2 * 120 && !hit; i++) hit = step(world, STEP).some((e) => e.kind === 'hit');
  assert.ok(hit);
  assert.equal(at(bodies(world), 0).phase, 'tumbling');
  for (let i = 0; i < 30; i++) step(world, STEP); // 0.25 s: folded
  assert.ok(at(bodies(world), 0).fold < 0.05, `fold ${at(bodies(world), 0).fold}`);
  assert.equal(at(bodies(world), 0).scale, 1);
});

test('after the hit no corner is ever more than 0.5 px past the floor or a wall at the end of a step', () => {
  for (let seed = 0; seed < SEEDS; seed++) assert.ok(simulate(seed).maxPast <= 0.5, `seed ${seed} went ${simulate(seed).maxPast} px past`);
});

test('after the hit the same holds in a short post with hardly any room', () => {
  for (let seed = 0; seed < 60; seed++) {
    const r = simulate(seed, SHORT_WORDS, SHORT);
    assert.ok(r.maxPast <= 0.5, `seed ${seed} went ${r.maxPast} px past`);
    assert.ok(r.sleptAt < 6, `seed ${seed} slept at ${r.sleptAt}`);
  }
});

test('the body energy (kinetic plus g times height) never rises between two steps after the hit, beyond rounding', () => {
  for (let seed = 0; seed < SEEDS; seed++) assert.ok(simulate(seed).maxRise <= RISE, `seed ${seed} rose by ${simulate(seed).maxRise}`);
});

test('every throw sleeps within 6 simulated seconds and reports one rest and a floor hit', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    assert.ok(r.sleptAt <= 6, `seed ${seed} slept at ${r.sleptAt}`);
    assert.equal(r.rests, 1, `seed ${seed}`);
    assert.ok(r.floors.length >= 1 && at(r.floors, 0).speed > 0, `seed ${seed} floor events ${r.floors.length}`);
    assert.equal(r.floors.length, 1, 'the floor event is the first meeting only');
  }
});

test('at rest four corners of one face lie within 0.75 px of the floor: it lies on a face, never balanced on an edge or a corner', () => {
  // The one exception the contacts leave is a chair propped on an edge against a side wall (see leansOnWall); it must be rare.
  let leaning = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    if (r.faceGap <= 0.75) continue;
    assert.ok(r.leans, `seed ${seed} face ${r.pose} gap ${r.faceGap}: not on a face and not leaning on a wall`);
    leaning++;
  }
  assert.ok(leaning <= SEEDS * 0.02, `${leaning} of ${SEEDS} came to rest leaning on a wall`);
});

test('no snap: the orientation never turns by more than its spin allows between two steps, right up to sleep', () => {
  for (let seed = 0; seed < SEEDS; seed++) assert.ok(simulate(seed).maxTurnExcess <= 0, `seed ${seed} turned ${simulate(seed).maxTurnExcess} rad too far`);
});

test('no pose is chosen: over the seeds the bodies come to rest on different faces and headings', () => {
  const faces = new Set<string>();
  const headings = new Set<number>();
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    faces.add(r.pose);
    headings.add(Math.floor((((r.heading % Math.PI) + Math.PI) % Math.PI) / (30 * DEG)));
  }
  assert.ok(faces.size + headings.size >= 3, `faces ${[...faces]} headings ${[...headings]}`);
  assert.ok(headings.size >= 3, `only ${headings.size} headings`);
  assert.ok(faces.size >= 2, `only ${faces.size} faces`);
});

test('three throws into one world all sleep, none overlaps another by more than 1 px, and a landing chair knocks a lying one awake in some seed', () => {
  let knocked = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const world = worldOf(WORLD);
    const rand = rng(1000 + seed);
    const ids: number[] = [];
    const slept = new Set<number>();
    let t = 0;
    for (let n = 0; n < 3; n++) {
      ids.push(addThrow(world, throwOf(rand, WORDS)));
      const was = new Map(bodies(world).map((b) => [b.id, b.asleep]));
      for (let i = 0; i < GAP * 120; i++) {
        step(world, STEP);
        t += STEP;
        for (const b of bodies(world)) {
          if (was.get(b.id) && !b.asleep) { knocked++; was.set(b.id, false); slept.delete(b.id); }
          if (b.asleep) { was.set(b.id, true); slept.add(b.id); }
        }
      }
    }
    // let everything finish, following wakes
    let all = bodies(world);
    for (let i = 0; i < 15 * 120 && !all.every((b) => b.asleep); i++) {
      step(world, STEP);
      t += STEP;
      const next = bodies(world);
      for (const b of next) if (all.find((o) => o.id === b.id)!.asleep && !b.asleep) knocked++;
      all = next;
    }
    assert.ok(all.every((b) => b.asleep), `seed ${seed} still moving after ${t} s`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(overlap(at(all, i), at(all, j)) <= 1, `seed ${seed} bodies ${i} and ${j} overlap by ${overlap(at(all, i), at(all, j))}`);
    }
  }
  assert.ok(knocked >= 1, 'no seed woke a sleeping body');
});

test('settle gives the same final state as stepping by hand, and returns whether everything slept', () => {
  for (let seed = 0; seed < 20; seed++) {
    const a = worldOf(WORLD), b = worldOf(WORLD);
    for (const w of [a, b]) { addThrow(w, throwOf(rng(seed), WORDS)); addThrow(w, throwOf(rng(seed + 500), WORDS)); }
    assert.equal(settle(a, 20), true);
    let n = 0;
    while (!bodies(b).every((x) => x.asleep) && n++ < 20 * 120) step(b, STEP);
    assert.deepEqual(bodies(a), bodies(b));
  }
  const w = worldOf(WORLD);
  addThrow(w, throwOf(rng(1), WORDS));
  assert.equal(settle(w, 0.2), false, 'a throw is still in the air after 0.2 s');
});

test('the same seed gives the same rest', () => {
  for (let seed = 0; seed < 10; seed++) {
    const a = worldOf(WORLD), b = worldOf(WORLD);
    addThrow(a, throwOf(rng(seed), WORDS));
    addThrow(b, throwOf(rng(seed), WORDS));
    settle(a, 20); settle(b, 20);
    assert.equal(bodies(a).length, 1);
    assert.ok(at(bodies(a), 0).asleep);
    assert.deepEqual(bodies(a), bodies(b));
  }
});

test('resize wakes every body and the bodies come to rest inside the new box', () => {
  const world = worldOf(WORLD);
  addThrow(world, throwOf(rng(2), WORDS));
  addThrow(world, throwOf(rng(3), WORDS));
  assert.ok(settle(world, 20));
  assert.equal(bodies(world).length, 2);
  assert.ok(bodies(world).every((b) => b.asleep));
  resize(world, 560, 300, 298);
  assert.ok(bodies(world).every((b) => !b.asleep), 'resize wakes every body');
  assert.ok(settle(world, 20));
  for (const b of bodies(world)) for (const c of cornersOf(b)) assert.ok(c[1] <= 298.5 && c[0] >= -0.5 && c[0] <= 560.5);
});

test('a body can be removed by its id and the others are woken; a given id is kept and a repeated one is refused', () => {
  const world = worldOf(WORLD);
  const first = addThrow(world, throwOf(rng(4), WORDS), 41);
  assert.equal(first, 41);
  const second = addThrow(world, throwOf(rng(5), WORDS));
  assert.notEqual(second, 41);
  assert.throws(() => addThrow(world, throwOf(rng(6), WORDS), 41));
  assert.ok(settle(world, 20));
  assert.equal(remove(world, 41), true);
  assert.equal(remove(world, 41), false);
  assert.equal(bodies(world).length, 1);
  assert.equal(at(bodies(world), 0).asleep, false, 'the others are woken');
  assert.ok(settle(world, 20));
});
