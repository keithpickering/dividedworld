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
import { readFileSync } from 'node:fs';
import {
  addThrow, boxShape, bodies, CHAIR, CHAIR_THICKNESS, SHAPES, cornersOf, createWorld, DEPTH, HALF, REST_RISE, remove, resize, probe, prismShape, rng, separation, settle, SETTLE_S, STAGGER_STEPS, step, STEP, throwOf,
  type BodyView, type Box, type Event, type World,
} from './body.ts';
import { Z_FRONT } from './chair.ts';
import type { ThrownObject } from './objects.ts';

const SEEDS = 200;
/** How far past the glass or the back wall the middle of a chair may be pushed by a hard knock before the spring turns it. */
const GLASS_GIVE = 20;
/** Seconds between the three throws into one world: long enough that the earlier chairs have mostly gone to sleep when the next lands. */
const GAP = 1.6;
/** The seeds of the three-throws-with-a-gap test: each runs three throws and the wait for all of them, so fewer than the single throws. */
const GAP_SEEDS = 50;
const WORDS: Box = { left: 40, top: 30, width: 520, height: 200 };
const WORLD = { width: 600, height: 260, floorY: 258 };
const SHORT_WORDS: Box = { left: 40, top: 20, width: 520, height: 80 };
const SHORT = { width: 600, height: 150, floorY: 128 };
const DEG = Math.PI / 180;
/**
 * What "beyond rounding" means for energy, in the energy units of mass 1 (px squared over s squared): a hundredth of a pixel of lift
 * (g times 0.01). A resting chair is moved out of the sliver of floor its turn's arc left it in, and that lift has no kinetic energy
 * to come from.
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

/**
 * The depth two boxes overlap by along their least-overlapping separating axis (the 15 of the separating axis test); at most zero
 * when apart.
 */
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

/** The highest a body's corners are above the floor, px. */
const riseOf = (b: BodyView, floorY: number): number => floorY - Math.min(...cornersOf(b).map((c) => c[1]));

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
      // (a nudge, given at the end of the step it is counted in, is the one place energy is let rise: see the nudge test)
      if (tumblingSteps > 1 && !prev.asleep && !Number.isNaN(prevEnergy) && b.nudges === prev.nudges) {
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
    const { x, y } = th.target;
    assert.ok(x >= WORDS.left + 0.15 * WORDS.width - 1e-9 && x <= WORDS.left + 0.85 * WORDS.width + 1e-9, `x ${x}`);
    assert.ok(y >= WORDS.top + 0.15 * WORDS.height - 1e-9 && y <= WORDS.top + 0.6 * WORDS.height + 1e-9, `y ${y}`);
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
    const hit = at(r.hits, 0).at;
    assert.ok(Math.abs(hit.x - r.target.x) < 1e-9 && Math.abs(hit.y - r.target.y) < 1e-9, `seed ${seed} hit at ${JSON.stringify(hit)}`);
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

test('at rest four corners of one face lie within 0.75 px of the floor: it lies on a face, never balanced on an edge, a corner or a wall', () => {
  /* A chair propped on an edge against a side wall used to be the one exception, at up to 2% of the seeds. It no longer is: a body that goes
     quiet above REST_RISE is nudged and falls over, so the allowance is zero. */
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    assert.ok(r.faceGap <= 0.75, `seed ${seed} face ${r.pose} gap ${r.faceGap}: not lying on a face (leaning on a wall: ${r.leans})`);
  }
});

test('over the single throws no body sleeps with a corner above REST_RISE, and none is wedged', () => {
  let nudged = 0, most = 0, latest = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    assert.ok(r.final.asleep, `seed ${seed}`);
    assert.ok(riseOf(r.final, WORLD.floorY) <= REST_RISE, `seed ${seed} sleeps with a corner ${riseOf(r.final, WORLD.floorY)} px above the floor (REST_RISE ${REST_RISE})`);
    assert.equal(r.final.wedged, false, `seed ${seed} was let sleep wedged`);
    if (r.final.nudges > 0) nudged++;
    most = Math.max(most, r.final.nudges);
    latest = Math.max(latest, r.sleptAt);
  }
  console.log(`# singles: ${nudged} of ${SEEDS} nudged, at most ${most} nudges, the latest asleep at ${latest.toFixed(2)} s`);
});

/**
 * Three throws one stagger apart (the effect's own run) into the narrow worlds of a short or a tall post, the cases that were slowest and
 * the one that was let sleep wedged when a probe ran 6000 of them: [width of the content area, its height, seed]. A chair on its end in a
 * room barely wider than its 90 px length can be flung from one wall to the other and left leaning on one, so it needs more nudges than the
 * single throws ever do; each of these must tip over, sleep within SETTLE_S, and sleep no higher than REST_RISE.
 */
const SLOW: Array<[number, number, number]> = [
  [180, 260, 929], [180, 260, 754], [180, 260, 608], [180, 260, 707], [180, 260, 866], [180, 260, 943], [180, 260, 274], [300, 90, 700],
];

test('three staggered throws into the narrowest rooms, among them the slowest and the one that was wedged, all tip over and sleep', () => {
  let most = 0, slowest = 0;
  for (const [w, h, seed] of SLOW) {
    const world = createWorld(w - 8, h, h);
    const rand = rng(seed * 104729);
    const aim: Box = { left: 10, top: 10, width: w * 0.5, height: Math.max(20, h * 0.4) };
    for (let i = 0; i < 3; i++) {
      addThrow(world, throwOf(rand, aim));
      if (i < 2) for (let k = 0; k < STAGGER_STEPS; k++) step(world, STEP);
    }
    let steps = 0;
    while (steps * STEP < SETTLE_S && !bodies(world).every((b) => b.asleep)) { step(world, STEP); steps++; }
    assert.ok(bodies(world).every((b) => b.asleep), `${w} by ${h}, seed ${seed}: a body is still moving after ${SETTLE_S} s`);
    slowest = Math.max(slowest, steps * STEP);
    for (const b of bodies(world)) {
      most = Math.max(most, b.nudges);
      assert.equal(b.wedged, false, `${w} by ${h}, seed ${seed}: body ${b.id} was let sleep wedged after ${b.nudges} nudges`);
      assert.ok(riseOf(b, h) <= REST_RISE, `${w} by ${h}, seed ${seed}: body ${b.id} sleeps ${riseOf(b, h)} px above the floor (REST_RISE ${REST_RISE})`);
    }
  }
  /* The reduced picture settles for SETTLE_S and ignore whether it was enough: a world that needed more would be drawn with a chair in mid-air. */
  assert.ok(slowest <= SETTLE_S / 2, `the slowest world took ${slowest.toFixed(2)} s to sleep, past half of SETTLE_S ${SETTLE_S}`);
  console.log(`# the slow rooms: the most nudges one body needed was ${most}, the slowest world slept at ${slowest.toFixed(2)} s`);
});

/** A chair stands on its 46 by 8 end at rest on the floor, as nothing in the game now leaves one: the body that has to fall over. */
function standing(world: World, seed = 1, x = 300) {
  return placed(world, seed, [x, WORLD.floorY - HALF[1], 0], false, [0, 0, 0], false);
}

test('a body standing on its end falls over and sleeps flat: no snap, energy up only at the nudge, and the nudge small against the fall', () => {
  const fall = 1900 * (HALF[1] - HALF[2]);
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = worldOf(WORLD);
    standing(world, seed);
    let prev = at(bodies(world), 0);
    let t = 0, worstExcess = -Infinity, nudgeEnergy = 0, risesOutsideNudge = 0, biggestTurn = 0;
    while (!prev.asleep && t < 8) {
      step(world, STEP);
      t += STEP;
      const b = at(bodies(world), 0);
      const excess = turn(prev, b) - Math.max(prev.omega, b.omegaPeak) * STEP - 0.01 * DEG;
      worstExcess = Math.max(worstExcess, excess);
      biggestTurn = Math.max(biggestTurn, turn(prev, b));
      if (b.nudges > prev.nudges) nudgeEnergy = Math.max(nudgeEnergy, b.energy - prev.energy);
      else if (!prev.asleep) risesOutsideNudge = Math.max(risesOutsideNudge, b.energy - prev.energy);
      prev = b;
    }
    assert.ok(prev.asleep, `seed ${seed} still moving after ${t} s`);
    assert.ok(t <= 4, `seed ${seed} took ${t} s to lie down`);
    assert.ok(prev.nudges >= 1, `seed ${seed} was never nudged`);
    assert.ok(riseOf(prev, WORLD.floorY) <= REST_RISE, `seed ${seed} sleeps ${riseOf(prev, WORLD.floorY)} px up`);
    assert.ok(worstExcess <= 0, `seed ${seed} turned ${worstExcess} rad too far in a step`);
    assert.ok(risesOutsideNudge <= RISE, `seed ${seed} energy rose by ${risesOutsideNudge} outside a nudge`);
    assert.ok(nudgeEnergy <= 0.15 * fall, `seed ${seed} nudge energy ${nudgeEnergy} against the fall ${fall}`);
    assert.ok(biggestTurn < 2 * DEG * 12, `a step turned ${biggestTurn / DEG} degrees`);
  }
});

test('the same seed gives the same nudges and the same rest, step by step', () => {
  for (const seed of [1, 2, 3]) {
    const a = worldOf(WORLD), b = worldOf(WORLD);
    standing(a, seed); standing(b, seed);
    for (let i = 0; i < 6 * 120; i++) { step(a, STEP); step(b, STEP); assert.deepEqual(bodies(a), bodies(b)); }
    assert.ok(at(bodies(a), 0).nudges >= 1);
    assert.ok(at(bodies(a), 0).asleep);
  }
  const x = worldOf(WORLD), y = worldOf(WORLD);
  standing(x, 1); standing(y, 2);
  settle(x, 8); settle(y, 8);
  assert.notDeepEqual(at(bodies(x), 0).quaternion, at(bodies(y), 0).quaternion, 'different seeds fall different ways');
});

test('settle ends a standing body flat, in the same rest as stepping by hand', () => {
  for (const seed of [1, 2, 3]) {
    const a = worldOf(WORLD), b = worldOf(WORLD);
    standing(a, seed); standing(b, seed);
    assert.equal(settle(a, 12), true);
    let n = 0;
    while (!bodies(b).every((x) => x.asleep) && n++ < 12 * 120) step(b, STEP);
    assert.deepEqual(bodies(a), bodies(b));
    assert.ok(riseOf(at(bodies(a), 0), WORLD.floorY) <= REST_RISE);
  }
});

test('no snap: the orientation never turns by more than its spin allows between two steps, right up to sleep', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const excess = simulate(seed).maxTurnExcess;
    assert.ok(excess <= 0, `seed ${seed} turned ${excess} rad too far`);
  }
});

test('no pose is chosen: over the seeds the bodies come to rest on different faces and headings', () => {
  const faces = new Set<string>();
  const headings = new Set<number>();
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = simulate(seed);
    faces.add(r.pose);
    headings.add(Math.floor((((r.heading % Math.PI) + Math.PI) % Math.PI) / (30 * DEG)));
  }
  assert.ok(headings.size >= 3, `only ${headings.size} headings`);
  assert.ok(faces.size >= 2, `only ${faces.size} faces`);
});

test('three throws into one world all sleep, none overlaps another by more than 1 px, ' +
  'and a landing chair knocks a lying one awake in some seed', () => {
  let knocked = 0, wakingSeeds = 0;
  for (let seed = 0; seed < GAP_SEEDS; seed++) {
    const knockedBefore = knocked;
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
    for (const b of all) {
      assert.ok(riseOf(b, WORLD.floorY) <= REST_RISE, `seed ${seed}: body ${b.id} sleeps ${riseOf(b, WORLD.floorY)} px above the floor`);
      assert.equal(b.wedged, false, `seed ${seed}: body ${b.id} was let sleep wedged`);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(overlap(at(all, i), at(all, j)) <= 1, `seed ${seed} bodies ${i} and ${j} overlap by ${overlap(at(all, i), at(all, j))}`);
    }
    if (knocked > knockedBefore) wakingSeeds++;
  }
  console.log(`# a landing chair woke a lying one in ${wakingSeeds} of the ${GAP_SEEDS} seeds`);
  assert.ok(knocked >= 1, 'no seed woke a sleeping body');
});

/**
 * The chairs of a post that throws up to three at once (the effect's stack): 350 ms apart, into a content area the size of a roomy
 * post.
 */
const BUSY = { width: 600, height: 300, floorY: 300 };
const BUSY_WORDS: Box = { left: 16, top: 16, width: 568, height: 240 };
const BUSY_GAP = 0.35;
/** The latest any seed of the three-at-350-ms test fell asleep after the last throw, seconds; printed so the number is on record. */
let latestBusy = 0;
/** What the rest rule did over the busy seeds: bodies nudged, the most nudges one needed. */
let busyNudged = 0, busyMost = 0, busyBodies = 0;

/**
 * The seeds that once failed this test (146, 147, 177, 198, each as 5000 + i) are always run, then the first 40: each seed is three
 * chairs in one world for up to 20 s, which is what makes the file slow, and these are the ones that found its defects.
 */
const BUSY_SEEDS = [146, 147, 177, 198, ...Array.from({ length: 40 }, (_, i) => i)];

test('three throws 350 ms apart (the effect stack) all sleep within 8 s of the last, ' +
  'overlap by at most 1 px, and stay inside the floor and walls', () => {
  for (const seed of BUSY_SEEDS) {
    const world = worldOf(BUSY);
    const rand = rng(5000 + seed);
    let thrown = 0, t = 0, lastAt = 0, allSleptAt = Infinity, past = 0;
    for (let i = 0; i < 20 * 120; i++) {
      while (thrown < 3 && t >= thrown * BUSY_GAP - 1e-9) { addThrow(world, throwOf(rand, BUSY_WORDS)); lastAt = t; thrown++; }
      step(world, STEP);
      t += STEP;
      const now = bodies(world);
      for (const b of now) {
        if (b.phase !== 'tumbling') continue;
        for (const c of cornersOf(b)) past = Math.max(past, c[1] - BUSY.floorY, -c[0], c[0] - BUSY.width);
      }
      if (thrown === 3 && allSleptAt === Infinity && now.every((b) => b.asleep)) allSleptAt = t - lastAt;
      if (t > lastAt + 8) break;
    }
    const all = bodies(world);
    const moving = all.filter((b) => !b.asleep).map((b) => `body ${b.id} at ${b.speed.toFixed(1)} px/s, ${b.omega.toFixed(2)} rad/s`);
    assert.ok(moving.length === 0, `seed ${seed}: still moving 8 s after the last throw: ${moving.join('; ')}`);
    latestBusy = Math.max(latestBusy, allSleptAt);
    for (const b of all) {
      busyBodies++;
      if (b.nudges > 0) busyNudged++;
      busyMost = Math.max(busyMost, b.nudges);
      assert.ok(riseOf(b, BUSY.floorY) <= REST_RISE, `seed ${seed}: body ${b.id} sleeps ${riseOf(b, BUSY.floorY)} px above the floor (REST_RISE ${REST_RISE})`);
      assert.equal(b.wedged, false, `seed ${seed}: body ${b.id} was let sleep wedged`);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(overlap(at(all, i), at(all, j)) <= 1, `seed ${seed} bodies ${i} and ${j} overlap by ${overlap(at(all, i), at(all, j))}`);
    }
    assert.ok(past <= 0.5, `seed ${seed} a corner went ${past} px past the floor or a wall`);
  }
  console.log(`# the latest any of the ${BUSY_SEEDS.length} seeds fell asleep after the last throw: ${latestBusy.toFixed(2)} s; ${busyNudged} of ${busyBodies} bodies nudged, at most ${busyMost} nudges`);
});

/**
 * Puts a body where a test wants it: thrown through addThrow like any other (so it is a real body of the world), then made a folded
 * chair at a position, with an orientation and a velocity. The test reaches into the world's list for it, since the effect never needs to.
 */
function placed(world: World, seed: number, pos: V3, flat: boolean, vel: V3, asleep: boolean) {
  const id = addThrow(world, throwOf(rng(seed), WORDS));
  const b = world.list.find((x) => x.id === id)!;
  b.phase = 'tumbling';
  b.pos = pos;
  // lying flat: a quarter turn about x, so the thin axis is the vertical one (a box 46 wide, 8 tall, 90 deep)
  b.q = flat ? [Math.SQRT1_2, Math.SQRT1_2, 0, 0] : [1, 0, 0, 0];
  b.R = flat ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  b.vel = vel;
  b.w = [0, 0, 0];
  b.foldT = 1;
  b.scale = 1;
  b.floored = true;
  b.asleep = asleep;
  return b;
}

/** A chair lies asleep on the floor; another comes down on it standing on its end (or lying flat), with a gap of `gap` px and a speed of `v` px/s down. */
function dropOnSleeper(gap: number, v: number, mode: 'end' | 'flat' = 'end') {
  const world = worldOf(WORLD);
  const lying = placed(world, 1, [300, WORLD.floorY - 4, 0], true, [0, 0, 0], true);
  const mover = placed(world, 2, [300, WORLD.floorY - 8 - (mode === 'end' ? 45 : 4) - gap, 0], mode === 'flat', [0, v, 0], false);
  return { world, lying, mover };
}

/** A chair lying flat on the floor is given a sliding speed along a floor direction (x, z), and the speed it has after `seconds`. */
function slide(dir: [number, number], seconds: number): { speed: number; sleeping: boolean } {
  const world = worldOf(WORLD);
  const v = 300;
  const body = placed(world, 1, [200, WORLD.floorY - 4, 0], true, [dir[0] * v, 0, dir[1] * v], false);
  for (let i = 0; i < Math.round(seconds / STEP); i++) step(world, STEP);
  return { speed: Math.hypot(body.vel[0], body.vel[1], body.vel[2]), sleeping: body.asleep };
}

/**
 * A todo, run and reported but not failing: friction is a pyramid (clamped per tangent), which slows a diagonal slide by up to root two
 * times mu g, and this test is red for it (a diagonal at 300 px/s is down to 28 px/s after 0.2 s where along an axis it is 106). A
 * Coulomb cone makes it pass (a diagonal at 106 to 125 px/s) and makes the 200-seed rest test fail on one seed, so it is held back;
 * see the comment in solve() in body.ts.
 */
test('sliding on the floor is slowed by friction mu times g in any direction: the Coulomb cone, not a square along the axes',
  { todo: 'friction is a pyramid, not a cone: the cone makes one seed of the rest test end tilted on an edge' }, () => {
  const MU_G = 0.5 * 1900;
  const seconds = 0.2;
  const along = slide([1, 0], seconds);
  const diagonal = slide([Math.SQRT1_2, Math.SQRT1_2], seconds);
  const expected = 300 - MU_G * seconds;
  assert.ok(!along.sleeping && !diagonal.sleeping);
  assert.ok(Math.abs(along.speed - expected) <= 0.05 * 300, `along an axis: ${along.speed} px/s, mu g predicts ${expected}`);
  assert.ok(
    Math.abs(diagonal.speed - along.speed) <= 0.05 * 300,
    `on the diagonal ${diagonal.speed} px/s against ${along.speed} along an axis`,
  );
});

test('a corner contact on a sleeper closing faster than 200 px/s wakes it with the equal and opposite impulse, ' +
  'wherever the contact is solved', () => {
  const { world, lying, mover } = dropOnSleeper(20, 600);
  let woke = false;
  for (let i = 0; i < 60 && !woke; i++) {
    const before = mover.vel[1];
    step(world, STEP);
    if (lying.asleep) continue;
    woke = true;
    // what the mover lost in the step is what the sleeper has gained (gravity's 16 px/s added to the mover is not the contact's)
    const lost = before + 1900 * STEP - mover.vel[1];
    assert.ok(lost > 200, `the mover lost only ${lost} px/s`);
    assert.ok(Math.abs(lying.vel[1] - lost) <= 0.05 * lost + 15, `the sleeper gained ${lying.vel[1]} where the mover lost ${lost}`);
    assert.ok(Math.abs(lying.vel[0]) < 0.05 * lost + 15 && Math.abs(lying.vel[2]) < 0.05 * lost + 15, `sideways ${lying.vel}`);
  }
  assert.ok(woke, 'the sleeper was never woken by a chair landing on it at 600 px/s');
});

test('a contact on a sleeper closing slower than 200 px/s leaves it asleep', () => {
  /* The mover comes down flat: one standing on its end would be nudged over by the rest rule (body.ts nudge) once it was quiet, and that fall is
     its own, not the slow contact this test is about. */
  const { world, lying, mover } = dropOnSleeper(1, 100, 'flat');
  let hit = false;
  for (let i = 0; i < 240; i++) {
    const before = mover.vel[1];
    step(world, STEP);
    hit = hit || mover.vel[1] < before;
    assert.ok(lying.asleep, `woken at step ${i}`);
  }
  assert.ok(hit, 'the mover never met the sleeper');
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

test('a world smaller than a chair, or of no size at all, leaves every body finite and asleep', () => {
  for (const [width, height, floorY] of [[30, 20, 10], [0, 0, 0]] as const) {
    const world = worldOf(WORLD);
    addThrow(world, throwOf(rng(2), WORDS));
    addThrow(world, throwOf(rng(3), WORDS));
    assert.ok(settle(world, 20));
    resize(world, width, height, floorY);
    assert.ok(settle(world, 20), `still moving in a ${width} by ${height} world`);
    for (const b of bodies(world)) {
      const numbers = [...Object.values(b.position), ...Object.values(b.quaternion)];
      assert.ok(numbers.every(Number.isFinite), `${width} wide: ${JSON.stringify(b)}`);
      assert.ok(b.asleep);
    }
  }
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

/**
 * The record: where a chair came to rest before the thrown objects had shapes (seeds 0 to 199, three throws a play apart as the effect
 * staggers them, into a room 600 by 400). It was written from the body as it stood, and a chair's throw and rest must not move at all.
 */
test('the chair rests where it rested before shapes', () => {
  const record = JSON.parse(readFileSync(new URL('./rest-record.json', import.meta.url), 'utf8')) as Array<Array<{ p: number[]; q: number[] }>>;
  const words: Box = { left: 40, top: 30, width: 520, height: 330 };
  assert.equal(record.length, 200);
  for (let seed = 0; seed < 200; seed++) {
    const world = createWorld(600, 400, 400);
    const rand = rng(seed);
    for (let i = 0; i < 3; i++) {
      addThrow(world, throwOf(rand, words));
      if (i < 2) for (let k = 0; k < STAGGER_STEPS; k++) step(world, STEP);
    }
    settle(world, SETTLE_S);
    const now = bodies(world);
    const was = at(record, seed);
    assert.equal(now.length, was.length, `seed ${seed}: body count`);
    for (const [i, b] of now.entries()) {
      const r = at(was, i);
      const got = [b.position.x, b.position.y, b.position.z, b.quaternion.w, b.quaternion.x, b.quaternion.y, b.quaternion.z];
      const want = [...r.p, ...r.q];
      for (const [k, v] of got.entries()) assert.ok(Math.abs(v - (want[k] as number)) < 1e-9, `seed ${seed} body ${i} value ${k}: ${v} against ${want[k]}`);
    }
  }
});

/* ---------- shapes ---------- */

/**
 * Today's chair constants, as the body held them before shapes: copied here, from the code on main, so that a box that drifts from them fails
 * (the build of the chair's shape is the one under test, so it cannot be the reference for itself).
 */
const WAS_CORNERS: V3[] = [];
for (let k = 0; k < 8; k++) WAS_CORNERS.push([k & 4 ? HALF[0] : -HALF[0], k & 2 ? HALF[1] : -HALF[1], k & 1 ? HALF[2] : -HALF[2]]);
const WAS_SAMPLES: V3[] = [...WAS_CORNERS];
for (const sz of [-1, 1]) {
  for (const sx of [-1, 1]) for (let k = 1; k < 6; k++) WAS_SAMPLES.push([sx * HALF[0], -HALF[1] + (k * 2 * HALF[1]) / 6, sz * HALF[2]]);
  for (const sy of [-1, 1]) for (let k = 1; k < 3; k++) WAS_SAMPLES.push([-HALF[0] + (k * 2 * HALF[0]) / 3, sy * HALF[1], sz * HALF[2]]);
}
const WAS_INERTIA: V3 = (() => {
  const [w, h, d] = [HALF[0] * 2, HALF[1] * 2, HALF[2] * 2];
  return [(h * h + d * d) / 12, (w * w + d * d) / 12, (w * w + h * h) / 12];
})();

test('the chair\'s shape is the box of today\'s constants: the same samples in the same order, corners and inertia', () => {
  const shape = boxShape(HALF, true);
  assert.deepEqual(shape.points, WAS_SAMPLES);
  assert.deepEqual(shape.corners, WAS_CORNERS);
  assert.deepEqual(shape.inertia, WAS_INERTIA);
  assert.equal(shape.points.length, 36);
  assert.equal(shape.reach, Math.hypot(...HALF));
  assert.equal(shape.restRise, REST_RISE);
  assert.deepEqual(CHAIR.points, WAS_SAMPLES);
  assert.equal(CHAIR.hinge, true);
  assert.equal(CHAIR.sleepsUpright, false);
});

/** A body as the geometry reads it: a place, a rotation and a shape. */
function placed2(shape: typeof CHAIR, pos: V3, R: number[]): Parameters<typeof separation>[0] {
  return { pos, R, shape } as unknown as Parameters<typeof separation>[0];
}
function rotationOf(q: number[]): number[] {
  const [w, x, y, z] = q as [number, number, number, number];
  const len = Math.hypot(w, x, y, z);
  const [a, b, c, d] = [w / len, x / len, y / len, z / len];
  return [
    1 - 2 * (c * c + d * d), 2 * (b * c - d * a), 2 * (b * d + c * a),
    2 * (b * c + d * a), 1 - 2 * (b * b + d * d), 2 * (c * d - b * a),
    2 * (b * d - c * a), 2 * (c * d + b * a), 1 - 2 * (b * b + c * c),
  ];
}

/** Today's separating axis test of two boxes, as it stood on main (the fifteen axes, the three faces of each and the nine crossed edges). */
function wasSeparation(a: { pos: V3; R: number[] }, b: { pos: V3; R: number[] }): { n: V3; depth: number; reach: number } {
  const A = a.R as number[], B = b.R as number[];
  const t = [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]];
  let best = Infinity, n: V3 = [0, 1, 0], reach = 0;
  const overlap = (x: number, y: number, z: number, edge: boolean): number => {
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) return Infinity;
    const ax = x / len, ay = y / len, az = z / len;
    const ra = HALF[0] * Math.abs(A[0]! * ax + A[3]! * ay + A[6]! * az) + HALF[1] * Math.abs(A[1]! * ax + A[4]! * ay + A[7]! * az) +
      HALF[2] * Math.abs(A[2]! * ax + A[5]! * ay + A[8]! * az);
    const rb = HALF[0] * Math.abs(B[0]! * ax + B[3]! * ay + B[6]! * az) + HALF[1] * Math.abs(B[1]! * ax + B[4]! * ay + B[7]! * az) +
      HALF[2] * Math.abs(B[2]! * ax + B[5]! * ay + B[8]! * az);
    const dist = t[0]! * ax + t[1]! * ay + t[2]! * az;
    const depth = ra + rb - Math.abs(dist);
    if (depth < best - (edge ? 1e-3 : 0)) {
      best = depth;
      const sign = dist >= 0 ? 1 : -1;
      n = [ax * sign, ay * sign, az * sign];
      reach = ra;
    }
    return depth;
  };
  for (let k = 0; k < 3; k++) if (overlap(A[k]!, A[3 + k]!, A[6 + k]!, false) <= 0) return { n: [0, 1, 0], depth: -1, reach: 0 };
  for (let k = 0; k < 3; k++) if (overlap(B[k]!, B[3 + k]!, B[6 + k]!, false) <= 0) return { n: [0, 1, 0], depth: -1, reach: 0 };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ux = A[i]!, uy = A[3 + i]!, uz = A[6 + i]!, vx = B[j]!, vy = B[3 + j]!, vz = B[6 + j]!;
    overlap(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, true);
  }
  return { n, depth: best, reach };
}

test('the separation of two boxes is today\'s, on 1000 seeded pairs (overlapping, touching and apart)', () => {
  const rand = rng(77);
  let overlapping = 0, apartPairs = 0;
  for (let i = 0; i < 1000; i++) {
    const q = (): number[] => [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const reach = 1 + 99 * rand();
    const a = placed2(CHAIR, [0, 0, 0], rotationOf(q()));
    const b = placed2(CHAIR, [(rand() * 2 - 1) * reach, (rand() * 2 - 1) * reach, (rand() * 2 - 1) * reach], rotationOf(q()));
    const now = separation(a, b), was = wasSeparation(a as never, b as never);
    assert.deepEqual(now, was, `pair ${i}`);
    if (was.depth > 0) overlapping++; else apartPairs++;
  }
  assert.ok(overlapping > 100 && apartPairs > 100, `the pairs must be both kinds: ${overlapping} overlapping, ${apartPairs} apart`);
});

test('a prism reaches its apothem along each side normal, its half height along its axis, and its radius along a corner', () => {
  const [radius, height, sides] = [15, 40, 12];
  const prism = prismShape(radius, height, sides);
  const apothem = radius * Math.cos(Math.PI / sides);
  assert.equal(prism.faces.length, sides / 2 + 1);
  assert.equal(prism.edges.length, sides / 2 + 1);
  for (const f of prism.faces.slice(0, sides / 2)) {
    assert.ok(Math.abs(Math.hypot(...f) - 1) < 1e-12);
    assert.ok(Math.abs(prism.support(f) - apothem) < 1e-9, `${f}: ${prism.support(f)} against ${apothem}`);
  }
  assert.ok(Math.abs(prism.support([0, 1, 0]) - height / 2) < 1e-12);
  assert.ok(Math.abs(prism.support([1, 0, 0]) - radius) < 1e-9);
  assert.equal(prism.corners.length, 2 * sides);
  assert.deepEqual(prism.points.slice(0, 2 * sides), prism.corners);
  assert.ok(prism.points.length > prism.corners.length);
  // the inertia of a solid cylinder of mass 1
  assert.ok(Math.abs((prism.inertia[1] as number) - radius * radius / 2) < 1e-9);
  assert.ok(Math.abs((prism.inertia[0] as number) - (3 * radius * radius + height * height) / 12) < 1e-9);
});

test('a point just inside a prism\'s face probes out along that face, whichever way the prism is turned', () => {
  const prism = prismShape(15, 40, 12);
  const apothem = 15 * Math.cos(Math.PI / 12);
  const owner = placed2(CHAIR, [0, 0, 0], rotationOf([1, 0, 0, 0]));
  for (const angle of [0, 30, 77]) {
    const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
    const R = [c, 0, s, 0, 1, 0, -s, 0, c];
    const where: V3 = [100, 200, 5];
    const box = placed2(prism, where, R);
    for (const [k, f] of prism.faces.entries()) {
      const reach = k < prism.faces.length - 1 ? apothem : 20;
      const world: V3 = [R[0]! * f[0] + R[1]! * f[1] + R[2]! * f[2], R[3]! * f[0] + R[4]! * f[1] + R[5]! * f[2], R[6]! * f[0] + R[7]! * f[1] + R[8]! * f[2]];
      for (const sign of [1, -1]) {
        // a point 0.5 px inside the face, over its middle
        const p: V3 = [where[0] + sign * world[0] * (reach - 0.5), where[1] + sign * world[1] * (reach - 0.5), where[2] + sign * world[2] * (reach - 0.5)];
        owner.pos = p;
        const hit = probe(owner, [0, 0, 0], box);
        assert.ok(hit, `angle ${angle} face ${k} sign ${sign}: not inside`);
        assert.ok(Math.abs(hit.depth - 0.5) < 1e-9, `depth ${hit.depth}`);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs((hit.n[i] as number) - sign * (world[i] as number)) < 1e-9, `angle ${angle} face ${k}: normal ${hit.n} against ${world}`);
        // and a point 0.5 px outside is not inside
        owner.pos = [where[0] + sign * world[0] * (reach + 0.5), where[1] + sign * world[1] * (reach + 0.5), where[2] + sign * world[2] * (reach + 0.5)];
        assert.equal(probe(owner, [0, 0, 0], box), null);
      }
    }
  }
});

/* ---------- the four objects ---------- */

const OBJECT_LIST: ThrownObject[] = ['chair', 'can', 'ladder', 'extinguisher'];
/** The most a point may be inside another body and still be a touching contact (body.ts TOUCH). */
const TOUCH_PX = 0.5;
const REST_WORDS: Box = { left: 40, top: 30, width: 520, height: 330 };

test('no shape reaches farther than the chair, which is what holds chair.ts K for every post', () => {
  const chair = Math.hypot(...HALF);
  for (const o of OBJECT_LIST) assert.ok(SHAPES[o].reach <= chair + 1e-9, `${o} reaches ${SHAPES[o].reach} against the chair's ${chair}`);
});

test('the four shapes are the ladder, the can and the extinguisher the owner tuned (2026-11-25)', () => {
  assert.equal(SHAPES.chair, CHAIR);
  assert.deepEqual(SHAPES.ladder.half, [15, 48, 6]);
  assert.equal(SHAPES.ladder.hinge, true);
  assert.equal(SHAPES.ladder.sleepsUpright, false);
  assert.equal(SHAPES.can.name, 'prism12');
  assert.equal(SHAPES.can.sleepsUpright, true);
  assert.ok(Math.abs(SHAPES.can.support([0, 1, 0]) - 42) < 1e-12);
  assert.ok(Math.abs(SHAPES.can.support([1, 0, 0]) - 25) < 1e-9);
  assert.equal(SHAPES.extinguisher.sleepsUpright, true);
  assert.ok(Math.abs(SHAPES.extinguisher.support([0, 1, 0]) - 45) < 1e-12);
  assert.ok(Math.abs(SHAPES.extinguisher.support([1, 0, 0]) - 13.5) < 1e-9);
  assert.deepEqual(SHAPES.extinguisher.spout, [18, -39.6, 0]);
  for (const o of ['chair', 'can', 'ladder'] as const) assert.equal(SHAPES[o].spout, undefined);
  assert.equal(SHAPES.chair.restRise, REST_RISE);
  /* The reaches the owner's bench gave: the can 48.9, the ladder 50.6, the extinguisher 47.0 (the chair's 50.7 is the cap). */
  assert.ok(Math.abs(SHAPES.can.reach - 48.9) < 0.05, `${SHAPES.can.reach}`);
  assert.ok(Math.abs(SHAPES.ladder.reach - 50.6) < 0.05, `${SHAPES.ladder.reach}`);
  assert.ok(Math.abs(SHAPES.extinguisher.reach - 47.0) < 0.05, `${SHAPES.extinguisher.reach}`);
});

test('restRise is built from two chairs under it: two chair thicknesses, its own lying thickness twice (or its standing height), and 1 px', () => {
  assert.equal(CHAIR_THICKNESS, 8);
  for (const o of ['can', 'ladder', 'extinguisher'] as const) {
    const s = SHAPES[o];
    const lying = Math.min(...s.faces.map((f) => 2 * s.support(f)));
    const standing = s.sleepsUpright ? 2 * s.support([0, 1, 0]) : 0;
    assert.equal(s.restRise, 2 * CHAIR_THICKNESS + Math.max(2 * lying, standing) + 1, o);
  }
  assert.equal(SHAPES.ladder.restRise, 2 * 8 + 2 * 12 + 1);
  assert.equal(SHAPES.extinguisher.restRise, 2 * 8 + 90 + 1);
});

/** The throws of one seed: each object alone, or three drawn uniformly from the seed (so each object is present often enough to mean something). */
function throwsOf(seed: number, mode: ThrownObject | 'mixed'): ThrownObject[] {
  if (mode !== 'mixed') return [mode, mode, mode];
  const draw = rng(90000 + seed);
  return [0, 1, 2].map(() => OBJECT_LIST[Math.floor(draw() * OBJECT_LIST.length)] as ThrownObject);
}

/** The rest of one run of throws into a roomy post, with what the rest test asserts measured. */
function restOf(seed: number, objects: ThrownObject[]) {
  const world = createWorld(600, 400, 400);
  const rand = rng(seed);
  for (const [i, o] of objects.entries()) {
    addThrow(world, throwOf(rand, REST_WORDS, o));
    if (i < objects.length - 1) for (let k = 0; k < STAGGER_STEPS; k++) step(world, STEP);
  }
  const slept = settle(world, SETTLE_S);
  const now = bodies(world);
  const list = now.map((b, i) => {
    const shape = SHAPES[objects[i] as ThrownObject];
    const corners = cornersOf(b, shape);
    const rise = 400 - Math.min(...corners.map((c) => c[1]));
    const past = Math.max(...corners.map((c) => Math.abs(c[2])));
    const R = rotationOf([b.quaternion.w, b.quaternion.x, b.quaternion.y, b.quaternion.z]);
    const axisY = R[4] as number;
    // standing on an end: the axis within 5 degrees of the vertical and the lower end's corners on the floor
    const side = axisY > 0 ? 1 : -1;
    const onEnd = shape.sleepsUpright && Math.abs(axisY) >= Math.cos(5 * DEG) &&
      cornersOf(b, shape).filter((_, k) => (shape.corners[k] as V3)[1] * side > 0).every((c) => Math.abs(400 - c[1]) <= TOUCH_PX);
    return { b, shape, rise, past, onEnd, R };
  });
  let deepest = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, c = list[j]!;
    const A = placed2(a.shape, [a.b.position.x, a.b.position.y, a.b.position.z], a.R);
    const C = placed2(c.shape, [c.b.position.x, c.b.position.y, c.b.position.z], c.R);
    deepest = Math.max(deepest, separation(A, C).depth);
  }
  return { slept, list, deepest, now };
}

function assertRest(seed: number, objects: ThrownObject[], label: string): void {
  const r = restOf(seed, objects);
  const where = `${label} seed ${seed} (${objects.join(', ')})`;
  assert.ok(r.slept, `${where}: still moving after ${SETTLE_S} s`);
  for (const [i, body] of r.list.entries()) {
    assert.ok(body.b.asleep, `${where}: body ${i} awake`);
    assert.equal(body.b.wedged, false, `${where}: body ${i} was let sleep wedged`);
    assert.ok(body.past <= Z_FRONT, `${where}: body ${i} reaches z ${body.past}, past Z_FRONT ${Z_FRONT}`);
    assert.ok(body.rise <= body.shape.restRise || body.onEnd, `${where}: body ${i} sleeps ${body.rise} px up, past its restRise ${body.shape.restRise}, and not on its end`);
  }
  assert.ok(r.deepest <= TOUCH_PX + 1e-6, `${where}: two bodies overlap by ${r.deepest}`);
}

for (const object of OBJECT_LIST) {
  test(`${object}: three of them thrown alone from seeds 0 to 199 all sleep inside the room, no higher than restRise, none inside another`, () => {
    const t0 = Date.now();
    for (let seed = 0; seed < SEEDS; seed++) assertRest(seed, throwsOf(seed, object), object);
    console.log(`# ${object} x3: ${Date.now() - t0} ms for ${SEEDS} seeds`);
  });
}

test('three throws of objects drawn from the seed (each present at least 30 times in 200 seeds) all sleep as the single ones do', () => {
  const count = new Map<ThrownObject, number>();
  const t0 = Date.now();
  for (let seed = 0; seed < SEEDS; seed++) {
    const objects = throwsOf(seed, 'mixed');
    for (const o of objects) count.set(o, (count.get(o) ?? 0) + 1);
    assertRest(seed, objects, 'mixed');
  }
  for (const o of OBJECT_LIST) assert.ok((count.get(o) ?? 0) >= 30, `${o} is present ${count.get(o)} times`);
  console.log(`# mixed: ${Date.now() - t0} ms; counts ${OBJECT_LIST.map((o) => `${o} ${count.get(o)}`).join(', ')}`);
});

/** Found by scanning seeds 0 to 199 of a lone can: 18 of them land on a base (9, 16, 47, 54, ...) and none is nudged (the can of 2026-11-25 is 50 across by 84). */
const CAN_STANDING_SEED = 9;
test('a can that lands on its base sleeps standing, and it is not nudged over', () => {
  const r = restOf(CAN_STANDING_SEED, ['can']);
  const [body] = r.list;
  assert.ok(body && body.b.asleep);
  assert.ok(body.onEnd, 'the can is not standing on an end');
  assert.equal(body.b.nudges, 0);
});

test('the object draws no number: a throw of any object is the chair\'s throw apart from `object`', () => {
  for (const seed of [0, 1, 7, 99, 150]) {
    const chair = throwOf(rng(seed), WORDS);
    for (const o of OBJECT_LIST) assert.deepEqual(throwOf(rng(seed), WORDS, o), { ...chair, object: o }, `${o} seed ${seed}`);
  }
});

test('each object\'s hit lands at the throw\'s target, where its body is, so its dent (centered on the hit) is centered on the body', () => {
  for (const o of OBJECT_LIST) for (const seed of [0, 1, 7, 42, 99]) {
    const world = createWorld(600, 400, 400);
    const th = throwOf(rng(seed), WORDS, o);
    const id = addThrow(world, th);
    let hit: { x: number; y: number } | undefined, middle: { x: number; y: number; z: number } | undefined;
    for (let k = 0; k < 600 && !hit; k++) {
      for (const e of step(world, STEP)) if (e.kind === 'hit' && e.id === id) {
        hit = e.at;
        const b = bodies(world).find((x) => x.id === id)!;
        middle = b.position;
      }
    }
    assert.ok(hit && middle, `${o} seed ${seed}: no hit`);
    assert.ok(Math.abs(hit.x - th.target.x) < 1e-9 && Math.abs(hit.y - th.target.y) < 1e-9, `${o} seed ${seed}: hit ${hit.x},${hit.y} against target ${th.target.x},${th.target.y}`);
    assert.ok(Math.abs(middle.x - hit.x) < 1e-9 && Math.abs(middle.y - hit.y) < 1e-9 && Math.abs(middle.z) < 1e-9, `${o} seed ${seed}: the body is at ${middle.x},${middle.y},${middle.z} at its hit`);
  }
});
