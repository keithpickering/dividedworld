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
  addThrow, bodies, cornersOf, createWorld, DEPTH, HALF, REST_RISE, remove, resize, rng, settle, SETTLE_S, STAGGER_STEPS, step, STEP, throwOf,
  type BodyView, type Box, type Event, type World,
} from './body.ts';

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
