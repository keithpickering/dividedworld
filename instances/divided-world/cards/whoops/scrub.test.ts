/**
 * Whoops!'s scrubbing, the pure half (refinements design sections 3 and 4): what a stroke leaves of a layer in
 * the body's box on one screen, which layer a stroke scrubs, the bounds a saved stroke keeps to, the accessible
 * sweep's pace, and which lines of text lie under ink. Strokes are in shares of the box; the brush is in px.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRUSH_PX, CELL_PX, LayerInk, MIN_STEP_PX, PEN_PX, ROW_PX, SWEEP_BRUSH_ROWS, SWEEP_SPEED,
  bandsOf, brushOf, coveredLines, fits, fitStroke, minStepOf, sweepStep, topLayer, type Drops, type LiveLine, type Pt, type Stroke, type Sweep,
} from './scrub.ts';
import { WASH_TAKES, cellGrid, fieldAtPoint, splatInto, strokesInto } from './field.ts';
import { encodePoints } from './points.ts';
import { THRESHOLD, covers, makeSplat, mulberry32, type Box, type Splat } from './splat.ts';
import { whoops, STROKES } from '../whoops.ts';

/** The drawer's box on a desktop: a few lines of body. */
const DESK: Box = { w: 988, h: 330 };
const PHONE: Box = { w: 390, h: 1200 };
const MID: Box = { w: 754, h: 438 };
const splatOf = (seed: number) => makeSplat(seed);
/** A wash of `px` across, in shares of `box`, through `points`. */
const washIn = (box: Box, points: Pt[], px = BRUSH_PX): Stroke => ({ tool: 'wash', ...brushOf(px, box), points });
const penIn = (box: Box, points: Pt[], color = '#ff2bd6'): Stroke => ({ tool: 'ink', color, ...brushOf(PEN_PX, box), points });
/** Enough passes to clear any of the splat's ink under the path (its heart holds about 8, a pass takes 1.5 at the path's center, less to the side). */
const MANY = 14;
const times = (stroke: Stroke, n = MANY): Stroke[] => Array.from({ length: n }, () => stroke);
/** `passes` passes of a brush through `points`, each a line begun, moved along and lifted, as a hand makes them. */
function scrub(ink: LayerInk, points: readonly Pt[], b: { width: number; aspect: number }, passes = 1): void {
  for (let n = 0; n < passes; n++) {
    const line = ink.begin({ tool: 'wash', ...b, points: [] });
    for (const p of points) line.to(p);
    line.end();
  }
}
const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tolerance ${tol})`);
/** A cell's center, in px, and in shares of the box. */
const centerPx = (i: number, j: number): Pt => [(i + 0.5) * CELL_PX, (j + 0.5) * CELL_PX];
const centerShare = (box: Box, i: number, j: number): Pt => [((i + 0.5) * CELL_PX) / box.w, ((j + 0.5) * CELL_PX) / box.h];
/** The cell of an untouched layer holding the most ink, and one holding thin ink (a value just over the threshold up to 1.2). */
function coreAndArm(splat: Splat, box: Box) {
  const g = cellGrid(box, CELL_PX);
  splatInto(g, splat, box);
  let core = 0, arm = -1;
  for (let k = 0; k < g.values.length; k++) {
    if (g.values[k]! > g.values[core]!) core = k;
    const v = g.values[k]!;
    if (arm < 0 && v >= THRESHOLD + 0.1 && v <= 1.2) arm = k;
  }
  const at = (k: number) => ({ i: k % g.cols, j: Math.floor(k / g.cols), v: g.values[k]! });
  return { core: at(core), arm: at(arm) };
}
/** A seeded mix of strokes near the splat's heart: washes and pens, dabs, lines in pieces (`continues`) and droplets. */
function randomStrokes(splat: Splat, box: Box, n: number, seed: number): Stroke[] {
  const rnd = mulberry32(seed), { cx, cy } = splat.placement, out: Stroke[] = [];
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  let a: Pt = [cx / 1.25, cy];
  const jump = (): Pt => (a = [clamp01(cx / 1.25 + (rnd() - 0.5) * 0.6), clamp01(cy + (rnd() - 0.5) * 0.6)]);
  const walk = (len: number): Pt[] => Array.from({ length: len }, () => (a = [clamp01(a[0] + (rnd() - 0.5) * 0.3), clamp01(a[1] + (rnd() - 0.5) * 0.3)]));
  const drops = () => Math.floor(rnd() * 4) as Drops;
  while (out.length < n) {
    const pen = rnd() < 0.35, b = brushOf(pen ? PEN_PX : [14, 30, 44][Math.floor(rnd() * 3)]!, box);
    const make = (points: Pt[], more: { continues?: true; drops?: Drops }): Stroke => pen ? { tool: 'ink', color: '#000', ...b, points, ...more } : { tool: 'wash', ...b, points, ...(more.continues ? { continues: true } : null) };
    if (rnd() < 0.2) { out.push(make([jump()], pen ? { drops: drops() } : {})); continue; }
    const first = jump();
    const more = rnd() < 0.4;
    out.push(make([first, ...walk(1 + Math.floor(rnd() * 4))], more || !pen ? {} : { drops: drops() }));
    if (more) out.push(make([a, ...walk(1 + Math.floor(rnd() * 4))], { continues: true, ...(pen ? { drops: drops() } : null) }));
  }
  return out;
}
/** The center of a splat's core, in shares of the design box (1.25 x 1), which is the box's own share. */
const heart = (seed: number): Pt => { const { cx, cy } = splatOf(seed).placement; return [cx / 1.25, cy]; };

test('the measures are the board\'s own, in px', () => {
  assert.deepEqual([BRUSH_PX, PEN_PX, ROW_PX, SWEEP_BRUSH_ROWS, CELL_PX, MIN_STEP_PX, SWEEP_SPEED], [30, 16, 22.5, 1.15, 12.5, 5, 0.55]);
  const b = brushOf(30, DESK);
  assert.ok(Math.abs(b.width - 30 / 988) < 1e-12 && Math.abs(b.aspect - 988 / 330) < 1e-12);
});

test('the brush follows the drawer\'s box: round where it was drawn, an ellipse on a taller screen', () => {
  const seed = 11, splat = splatOf(seed);
  /* How much a dab at the heart lowers the field at a point `dx`, `dy` px from it. */
  const lowered = (box: Box, dx: number, dy: number): number => {
    const [hx, hy] = heart(seed), b = brushOf(BRUSH_PX, DESK);
    const ink = new LayerInk(splat, [], box), p: Pt = [hx + dx / box.w, hy + dy / box.h];
    const before = ink.valueAt(p[0], p[1]);
    scrub(ink, [[hx, hy]], b);
    return before - ink.valueAt(p[0], p[1]);
  };
  /* Where drawn the brush is round: the same lowering 14px across and 14px down. */
  near(lowered(DESK, 14, 0), lowered(DESK, 0, 14), 0.02, 'round on the drawer\'s box');
  assert.ok(lowered(DESK, 14, 0) > 0.3 && lowered(DESK, 14, 0) < WASH_TAKES - 0.3, 'and less at its side than at its center');
  /* On 390x1200 the brush is 6px across by 6 * k down, k = 988/330 * 1200/390: 7px across lowers as 7 * k px down does, and 7px down lowers hardly less than the center. */
  const k = (988 / 330) * (PHONE.h / PHONE.w);
  near(lowered(PHONE, 7, 0), lowered(PHONE, 0, 7 * k), 0.02, 'an ellipse on a taller box');
  assert.ok(lowered(PHONE, 0, 7) > lowered(PHONE, 7, 0) + 0.2, 'down 7px is still under the brush, across 7px is at its side');
});

/** The passes of the 30px brush through a cell's center that clear it: each takes `WASH_TAKES` at the center. */
const passesFor = (v: number) => Math.ceil((v - THRESHOLD) / WASH_TAKES);

test('a thin arm clears in one pass and the core\'s center does not: it takes several', () => {
  for (const seed of [11, 12, 13]) {
    const splat = splatOf(seed), { core, arm } = coreAndArm(splat, DESK), b = brushOf(BRUSH_PX, DESK);
    const across = (c: { i: number; j: number }): Pt[] => { const [x, y] = centerPx(c.i, c.j); return [[(x - 100) / DESK.w, y / DESK.h], [(x + 100) / DESK.w, y / DESK.h]]; };
    const thin = new LayerInk(splat, [], DESK);
    assert.equal(thin.ink[arm.j * thin.cells.cols + arm.i], 1);
    scrub(thin, across(arm), b);
    assert.equal(thin.ink[arm.j * thin.cells.cols + arm.i], 0, `seed ${seed}: one pass clears the arm`);
    assert.equal(thin.has(...centerShare(DESK, arm.i, arm.j)), false);
    const need = passesFor(core.v), ink = new LayerInk(splat, [], DESK), at = core.j * ink.cells.cols + core.i;
    assert.ok(need >= 3, `seed ${seed}: the core's center holds ${core.v}, ${need} passes`);
    scrub(ink, across(core), b);
    assert.equal(ink.ink[at], 1, `seed ${seed}: one pass leaves the core's center inked`);
    assert.equal(ink.has(...centerShare(DESK, core.i, core.j)), true);
    scrub(ink, across(core), b, need - 2);
    assert.equal(ink.ink[at], 1, `seed ${seed}: one pass short of ${need} leaves it inked`);
    scrub(ink, across(core), b);
    assert.equal(ink.ink[at], 0, `seed ${seed}: ${need} passes clear it`);
    /* The same, saved: a layer rebuilt from the strokes is the layer washed as often. */
    const saved = new LayerInk(splat, Array.from({ length: need }, (): Stroke => ({ tool: 'wash', ...b, points: across(core) })), DESK);
    assert.deepEqual(saved.ink, ink.ink);
  }
});

test('washed grows strictly with each pass over the core, until the core is clean', () => {
  const splat = splatOf(11), { core } = coreAndArm(splat, DESK), b = brushOf(BRUSH_PX, DESK);
  const [x, y] = centerPx(core.i, core.j), path: Pt[] = [[(x - 100) / DESK.w, y / DESK.h], [(x + 100) / DESK.w, y / DESK.h]];
  const ink = new LayerInk(splat, [], DESK), at = core.j * ink.cells.cols + core.i;
  const seen = [ink.washed];
  for (let n = 0; n < 12 && ink.ink[at] === 1; n++) { scrub(ink, path, b); seen.push(ink.washed); }
  assert.equal(ink.ink[at], 0, 'the core is clean in the end');
  assert.equal(seen.length - 1, passesFor(core.v), 'in as many passes as it holds');
  for (let n = 1; n < seen.length; n++) assert.ok(seen[n]! > seen[n - 1]!, `pass ${n}: ${seen[n - 1]} to ${seen[n]}`);
});

test('a pen line\'s bulb makes has true past the line\'s end, once the line is lifted', () => {
  const none: Splat = { balls: [], placement: { cx: 0.625, cy: 0.5 } };
  const b = brushOf(PEN_PX, DESK), r = PEN_PX / 2;
  const pen: Stroke = { tool: 'ink', color: '#000', ...b, points: [[0.2, 0.5], [0.5, 0.5]] };
  const past: Pt = [0.5 + (1.2 * r) / DESK.w, 0.5];
  const ink = new LayerInk(none, [], DESK);
  const line = ink.begin(pen);
  for (const p of pen.points) line.to(p);
  assert.equal(ink.has(...past), false, 'still drawing, the pen has not reached it');
  assert.equal(ink.has(0.4, 0.5), true);
  line.end();
  assert.equal(ink.has(...past), true, 'lifted, the bulb is there');
  assert.equal(new LayerInk(none, [pen], DESK).has(...past), true, 'and so in a layer built from the saved stroke');
  assert.equal(ink.has(0.5 + (4 * r) / DESK.w, 0.5), false, 'but not far past');
  assert.equal(new LayerInk(none, [{ ...pen, points: [[0.5, 0.5], [0.5 + r / DESK.w, 0.5]] }], DESK).has(0.5 + (4 * r) / DESK.w, 0.5), false, 'a line under four radii has no bulb');
});

test('has after a dab is false at its center over an arm and true over the core', () => {
  const splat = splatOf(11), { core, arm } = coreAndArm(splat, DESK), b = brushOf(BRUSH_PX, DESK);
  for (const [name, c, want] of [['arm', arm, false], ['core', core, true]] as const) {
    const p = centerShare(DESK, c.i, c.j), ink = new LayerInk(splat, [], DESK);
    const line = ink.begin({ tool: 'wash', ...b, points: [] });
    line.to(p);
    line.end();
    assert.equal(ink.has(...p), want, `a dab over the ${name}, live`);
    assert.equal(new LayerInk(splat, [{ tool: 'wash', ...b, points: [p] }], DESK).has(...p), want, `a dab over the ${name}, saved`);
  }
});

test('a continues piece goes on with the line still open, and begins its own when none is', () => {
  const splat = splatOf(11), seed = 3;
  const strokes = randomStrokes(splat, DESK, 12, seed);
  const a: Stroke = { tool: 'ink', color: '#000', ...brushOf(PEN_PX, DESK), points: [[0.3, 0.5], [0.4, 0.5]] };
  const c: Stroke = { ...a, points: [[0.4, 0.5], [0.55, 0.52]], continues: true, drops: 2 };
  const ink = new LayerInk(splat, strokes, DESK);
  const first = ink.begin(a);
  first.to(a.points[0]!); first.to(a.points[1]!);
  const second = ink.begin(c);
  assert.strictEqual(second, first, 'the same line');
  second.to(c.points[0]!); second.to(c.points[1]!);
  second.end(2);
  const whole = new LayerInk(splat, [...strokes, a, c], DESK);
  assert.deepEqual(ink.ink, whole.ink);
  near(ink.washed, whole.washed, 1e-12);
  const after = ink.begin({ ...c, continues: true });
  assert.notStrictEqual(after, first, 'with the line lifted, a continues piece is a line of its own');
  after.end();
  /* A second pen line while one is open is refused by the field, and leaves the layer as it was. */
  const open = ink.begin(a);
  assert.throws(() => ink.begin({ ...a, points: [] }), /already open/);
  open.end();
});

test('has equals the cell\'s value at cell centers and fieldAtPoint at random points, over lines in pieces, dabs and drops', () => {
  const box = MID, splat = splatOf(20261112), strokes = randomStrokes(splat, box, 40, 9);
  assert.ok(strokes.some((s) => s.continues) && strokes.some((s) => s.points.length === 1) && strokes.some((s) => s.tool === 'ink' && (s.drops ?? 0) > 0), 'the mix has pieces, dabs and drops');
  const ink = new LayerInk(splat, strokes, box);
  for (let j = 0; j < ink.cells.rows; j++) {
    for (let i = 0; i < ink.cells.cols; i++) {
      const v = ink.cells.values[j * ink.cells.cols + i]!, [x, y] = centerShare(box, i, j);
      near(ink.valueAt(x, y), v, 1e-4, `cell ${i},${j}`);
      if (Math.abs(v - THRESHOLD) > 1e-4) assert.equal(ink.has(x, y), v >= THRESHOLD, `has at cell ${i},${j}`);
    }
  }
  const rnd = mulberry32(77);
  for (let n = 0; n < 300; n++) {
    const x = rnd() * 1.2 - 0.1, y = rnd() * 1.2 - 0.1, f = fieldAtPoint(splat, box, strokes, x * box.w, y * box.h);
    near(ink.valueAt(x, y), f, 1e-4, `(${x}, ${y})`);
    if (Math.abs(f - THRESHOLD) > 1e-4) assert.equal(ink.has(x, y), f >= THRESHOLD);
  }
  /* A line being drawn answers as the cells do, before it is lifted. */
  const live = new LayerInk(splat, strokes, box), line = live.begin({ tool: 'ink', color: '#000', ...brushOf(PEN_PX, box), points: [] });
  for (const p of [[0.4, 0.4], [0.6, 0.45], [0.7, 0.6]] as Pt[]) line.to(p);
  for (let j = 0; j < live.cells.rows; j += 3) for (let i = 0; i < live.cells.cols; i += 3) {
    near(live.valueAt(...centerShare(box, i, j)), live.cells.values[j * live.cells.cols + i]!, 1e-4, `open line, cell ${i},${j}`);
  }
  line.end(1);
});

test('the model and the painter agree: every cell\'s ink is the field at its center at the threshold', () => {
  const box = MID, splat = splatOf(20261112), strokes = randomStrokes(splat, box, 40, 5);
  const ink = new LayerInk(splat, strokes, box);
  const painter = cellGrid(box, CELL_PX);
  splatInto(painter, splat, box);
  strokesInto(painter, box, strokes);
  let inked = 0, washed = 0;
  for (let j = 0; j < ink.cells.rows; j++) {
    for (let i = 0; i < ink.cells.cols; i++) {
      const at = j * ink.cells.cols + i, [x, y] = centerPx(i, j);
      const f = fieldAtPoint(splat, box, strokes, x, y);
      near(painter.values[at]!, f, 1e-4, `painter, cell ${i},${j}`);
      if (Math.abs(f - THRESHOLD) < 1e-4) continue;
      assert.equal(ink.ink[at] === 1, f >= THRESHOLD, `cell ${i},${j} holds ${f}`);
      inked += ink.ink[at]!; washed += painter.washed[at]!;
    }
  }
  assert.ok(inked > 50 && washed > 50, `the strokes did something: ${inked} inked, ${washed} washed cells`);
  assert.ok(ink.washed > 0 && ink.washed < 1);
});

test('the sweep makes as many passes as the ink needs, and is idle only once the layer is clean', () => {
  const box: Box = { w: 988, h: 8 * ROW_PX }, ink = new LayerInk(splatOf(12), [], box), rows = bandsOf(box);
  const brush = brushOf(SWEEP_BRUSH_ROWS * ROW_PX, box), half = ROW_PX / 2 / box.h, dt = 1 / 30;
  let s: Sweep = { row: 0, x: 0 }, line: LiveLine | null = null, lineRow = -1, idle = false, t = 0, last = 0;
  const entries = rows.map(() => 0);
  for (; t < 600; t += dt) {
    const step = sweepStep(rows, s, dt, (row) => ink.inkSpan(rows[row]!, half));
    if (step.idle) { idle = true; break; }
    if (!line || step.sweep.row !== lineRow) {
      line?.end();
      line = ink.begin({ tool: 'wash', ...brush, points: [] });
      lineRow = step.sweep.row;
      entries[lineRow] = (entries[lineRow] ?? 0) + 1;
    }
    line.to(step.point);
    s = step.sweep;
    assert.ok(ink.washed >= last, 'the share never falls');
    last = ink.washed;
  }
  line?.end();
  assert.ok(idle, `the sweep goes idle (${t.toFixed(0)}s, ${ink.washed})`);
  assert.ok(ink.washed >= 0.95, `idle only at the clean share (${ink.washed})`);
  assert.ok(entries.some((n) => n >= 2), `a band is passed more than once (${entries})`);
});

test('the sweep\'s pace is a hand\'s: one pass takes WASH_TAKES under its center', () => {
  const box: Box = { w: 988, h: 8 * ROW_PX }, splat = splatOf(12), rows = bandsOf(box);
  const brush = brushOf(SWEEP_BRUSH_ROWS * ROW_PX, box), half = ROW_PX / 2 / box.h;
  /* The band point holding the most ink (a point on a band's center line, at a cell's column). */
  const probe = new LayerInk(splat, [], box);
  let best: Pt = [0.5, rows[0]!], bestV = 0;
  for (let k = 0; k < rows.length; k++) for (let i = 4; i < probe.cells.cols - 4; i++) {
    const p: Pt = centerShare(box, i, 0).map((v, n) => (n === 0 ? v : rows[k]!)) as unknown as Pt, v = probe.valueAt(p[0], p[1]);
    if (v > bestV) { bestV = v; best = p; }
  }
  assert.ok(bestV >= WASH_TAKES + 0.5, `a band of the core holds ${bestV}`);
  const row = rows.reduce((m, y, k) => (Math.abs(y - best[1]) < Math.abs(rows[m]! - best[1]) ? k : m), 0);
  const ink = new LayerInk(splat, [], box);
  let s: Sweep = { row, x: 0 }, line: LiveLine | null = null;
  for (let n = 0; n < 5000; n++) {
    const step = sweepStep(rows, s, 1 / 30, (r) => ink.inkSpan(rows[r]!, half));
    if (step.idle || step.sweep.row !== row) break;
    line ??= ink.begin({ tool: 'wash', ...brush, points: [] });
    line.to(step.point);
    s = step.sweep;
  }
  line?.end();
  const hand = new LayerInk(splat, [], box);
  scrub(hand, [[0, best[1]], [1, best[1]]], brush);
  const swept = bestV - ink.valueAt(...best), took = bestV - hand.valueAt(...best);
  near(took, WASH_TAKES, 0.05, 'a hand pass');
  near(swept, took, 0.05, 'the sweep\'s pass');
});

test('ink past the box is never counted: washing every cell of the box reaches clean', () => {
  // A one-line box: the splat is laid over it whole and runs past its edges.
  const box: Box = { w: 988, h: 60 };
  const ink = new LayerInk(splatOf(13), [], box);
  const b = brushOf(BRUSH_PX, box);
  for (let y = 0; y <= 1.0001; y += (BRUSH_PX * 0.7) / box.h) scrub(ink, [[0, Math.min(1, y)], [1, Math.min(1, y)]], b, 10);
  assert.ok(ink.washed > 0.97, `washed ${ink.washed}`);
  assert.equal(ink.inkSpan(0.5, ROW_PX / 2 / box.h), null, 'and there is nothing left for the sweep to find');
});

test('a stroke scrubs the top layer that still has ink where it starts', () => {
  const under = new LayerInk(splatOf(21), [], DESK);
  const over = new LayerInk(splatOf(22), [], DESK);
  let spot: Pt | null = null;
  for (let y = 0.3; y < 0.7 && !spot; y += 0.02) for (let x = 0.3; x < 0.7; x += 0.02) if (under.has(x, y) && over.has(x, y)) { spot = [x, y]; break; }
  assert.ok(spot, 'two splats on one post overlap somewhere');
  const b = brushOf(BRUSH_PX * 2, DESK);
  assert.equal(topLayer([under, over], spot[0], spot[1]), 1);
  scrub(over, [spot], b, MANY);
  assert.equal(topLayer([under, over], spot[0], spot[1]), 0, 'where the top layer is gone the one under it is scrubbed');
  scrub(under, [spot], b, MANY);
  assert.equal(topLayer([under, over], spot[0], spot[1]), -1);
  assert.equal(topLayer([under, null, over], spot[0], spot[1]), -1, 'a layer that is clean is not there');
});

test('a stroke is kept to what the card\'s rules take, however long the drag', () => {
  const step = minStepOf(DESK);
  const long: Stroke = { tool: 'wash', ...brushOf(BRUSH_PX, DESK), points: Array.from({ length: 1700 }, (_, i): Pt => [i / 1700, i % 2 === 0 ? 0.2 : 0.8]) };
  const kept = fitStroke(long, step);
  assert.ok(kept.length >= 2, 'a long drag is several strokes');
  assert.ok(kept.every((s) => s.points.length <= STROKES.points));
  assert.equal(kept.flatMap((s) => s.points).length >= 1700 / 4, true, 'and loses no stretch of it');
  const wild: Stroke = { tool: 'wash', width: 3, aspect: 2.34567, points: [[-0.3, -2], [1.4, 90], [0.123456789, 0.987654321]] };
  const [only] = fitStroke(wild, step);
  assert.deepEqual(only!.points, [[0, 0], [1, 1], [0.1235, 0.9877]], 'ink past the box is kept at its edge, to a ten-thousandth');
  assert.equal(only!.width, STROKES.widest);
  assert.equal(only!.aspect, 2.35, 'the aspect is kept to three significant figures');
  assert.equal(fitStroke({ ...wild, aspect: 0.0123456 }, step)[0]!.aspect, 0.0123);
  const validated = whoops.validateState!({ strokes: [...kept, only!].map((s) => ({ ...s, points: encodePoints(s.points) })) });
  assert.equal(validated.ok, true, validated.ok ? '' : validated.why);
});

test('a drag\'s near-duplicate points are thinned out of what is kept', () => {
  const step = minStepOf(DESK);
  const b = brushOf(BRUSH_PX, DESK);
  const crawl: Stroke = { tool: 'wash', ...b, points: [[0.2, 0.5], [0.2005, 0.5], [0.201, 0.5], [0.2015, 0.5], [0.4, 0.5], [0.4004, 0.5]] };
  assert.deepEqual(fitStroke(crawl, step)[0]!.points, [[0.2, 0.5], [0.4004, 0.5]], 'points under a step from the last one kept are dropped, but the stroke still ends where the pen did');
  const dab: Stroke = { tool: 'wash', ...b, points: [[0.5, 0.5], [0.5002, 0.5]] };
  assert.deepEqual(fitStroke(dab, step)[0]!.points, [[0.5, 0.5]], 'a dab is one point');
  // The step is 5px on each axis: a tall box takes a smaller share down than across.
  const [sx, sy] = minStepOf(PHONE);
  assert.ok(Math.abs(sx - 5 / 390) < 1e-12 && Math.abs(sy - 5 / 1200) < 1e-12);
});

test('a layer\'s strokes fit while they are within the card\'s counts, and not past them', () => {
  const stroke = (n: number): Stroke => ({ tool: 'wash', width: 0.03, aspect: 3, points: Array.from({ length: n }, (_, i): Pt => [i / n, 0.5]) });
  assert.equal(fits(Array.from({ length: STROKES.most }, () => stroke(10))), true);
  assert.equal(fits(Array.from({ length: STROKES.most + 1 }, () => stroke(1))), false);
  assert.equal(fits(Array.from({ length: 81 }, () => stroke(STROKES.points))), false, 'more points in all than the card keeps');
});

test('the sweep goes line by line at 0.55 of the box a second, a line at a time and never all at once', () => {
  const box: Box = { w: 988, h: 330 };
  const rows = bandsOf(box);
  assert.equal(rows.length, Math.floor(330 / ROW_PX));
  assert.ok(Math.abs(rows[0]! - 0.5 * ROW_PX / 330) < 1e-12 && Math.abs(rows[1]! - 1.5 * ROW_PX / 330) < 1e-12, 'centers of rows ROW_PX tall, in shares');
  assert.equal(bandsOf({ w: 400, h: 5 }).length, 1);
  let s: Sweep = { row: 0, x: 0 };
  const dt = 1 / 60;
  let t = 0;
  while (s.row === 0 && t < 5) { ({ sweep: s } = sweepStep(rows, s, dt)); t += dt; }
  assert.ok(Math.abs(t - 1 / SWEEP_SPEED) < 0.05, `a line takes ${t}s`);
  assert.equal(s.row, 1);
  assert.ok(s.x < 0.05, 'the next line starts at its left');
  let last: Sweep = { row: rows.length - 1, x: 0.99 };
  ({ sweep: last } = sweepStep(rows, last, 0.1));
  assert.equal(last.row, 0);
});

test('a line of text is covered when the ink over it is most of its length, and read once it is not', () => {
  const [, cy] = heart(41);
  const ink = new LayerInk(splatOf(41), [], DESK);
  const lines = [
    { top: 0, bottom: 0.03, text: 'far above any ink' },
    { top: cy - 0.03, bottom: cy + 0.03, text: 'through the heart of it' },
  ];
  assert.deepEqual(coveredLines(lines, [ink]), [false, true]);
  const b = brushOf(BRUSH_PX * 1.5, DESK);
  scrub(ink, [[0, cy], [1, cy]], b, MANY);
  assert.deepEqual(coveredLines(lines, [ink]), [false, false], 'washed, the line is read');
  assert.deepEqual(coveredLines(lines, [null, null]), [false, false], 'clean layers cover nothing');
  assert.deepEqual(coveredLines([{ top: 0.9, bottom: 0.95, text: 'under a pen' }], [new LayerInk(splatOf(41), [penIn(DESK, [[0, 0.925], [0.5, 0.925]])], DESK)]), [true], 'half its length under ink is covered');
});

test('a drawing keeps its place: a stroke\'s points land at the same shares on two boxes, and its washed cells on each match the shares it passed', () => {
  const seed = 61;
  const [cx, cy] = heart(seed);
  const stroke = washIn(DESK, [[cx - 0.1, cy], [cx + 0.1, cy]]);
  const rx = stroke.width / 2, ry = (stroke.width / 2) * stroke.aspect;
  const share: number[] = [];
  for (const box of [DESK, PHONE]) {
    const label = `${box.w}x${box.h}`;
    const ink = new LayerInk(splatOf(seed), times(stroke), box);
    const fresh = new LayerInk(splatOf(seed), [], box);
    // On the path, to half the brush's reach down, every point is washed.
    for (let x = cx - 0.1; x <= cx + 0.1 + 1e-9; x += 0.02) {
      for (const f of [0, 0.5, -0.5]) assert.equal(ink.has(x, cy + f * ry), false, `on the path at ${x.toFixed(2)},${f} on ${label}`);
    }
    // Well past the brush's field (2.2 radii down, and past the ends) a point is as the splat left it, and some of them are ink.
    let ink_beyond = 0;
    const beyond: Pt[] = [];
    for (let x = cx - 0.1; x <= cx + 0.1 + 1e-9; x += 0.02) beyond.push([x, cy + 2.2 * ry], [x, cy - 2.2 * ry]);
    beyond.push([cx - 0.1 - 2.2 * rx, cy], [cx + 0.1 + 2.2 * rx, cy]);
    for (const [x, y] of beyond) {
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;
      assert.equal(ink.has(x, y), covers(splatOf(seed), box, x, y), `beyond the brush at ${x.toFixed(3)},${y.toFixed(3)} on ${label}`);
      if (covers(splatOf(seed), box, x, y)) { ink_beyond++; assert.equal(ink.has(x, y), true); }
    }
    assert.ok(ink_beyond >= 3, `the splat has ink just past the path on ${label} (${ink_beyond})`);
    assert.equal(fresh.washed, 0);
    assert.ok(ink.washed > 0 && ink.washed < 1, `the cells it passed are counted on ${label} (${ink.washed})`);
    share.push(ink.washed);
  }
  // The same shares of the same splat, counted on grids of different cell counts (and a splat shaped by each box): close, not equal,
  // as the module says, where a brush that ignored the box's shape would be far off (a fifth of the share, not a few hundredths).
  assert.ok(Math.abs(share[0]! - share[1]!) < 0.2 * Math.max(...share), `washed share ${share[0]} on the desk, ${share[1]} on the phone`);
});

/* ------------------------------------------------------- the author's pen belongs to its layer ---- */

const penAcross = (box: Box, y: number): Stroke => penIn(box, [[0, y], [0.5, y], [1, y]]);

test('a line under a pen stroke is covered, as the eye finds it covered, and is read once the pen is scrubbed away', () => {
  const y = 0.95;
  const ink = new LayerInk(splatOf(51), [penAcross(DESK, y)], DESK);
  const lines = [{ top: y - 0.01, bottom: y + 0.01, text: 'under the pen' }, { top: 0.02, bottom: 0.04, text: 'clear of it' }];
  assert.deepEqual(coveredLines(lines, [ink]), [true, false]);
  const b = brushOf(BRUSH_PX, DESK);
  scrub(ink, [[0, y], [1, y]], b, MANY);
  assert.deepEqual(coveredLines(lines, [ink]), [false, false], 'a reader\'s stroke over the pen removes it on their screen');
  assert.equal(ink.has(0.5, y), false);
});

test('a pen stroke is the ink of its layer: a stroke over it scrubs that layer, and a layer above has it covered', () => {
  const under = new LayerInk(splatOf(52), [], DESK);
  const penned = new LayerInk(splatOf(53), [penAcross(DESK, 0.99)], DESK);
  const over = new LayerInk(splatOf(54), [], DESK);
  assert.equal(topLayer([under, penned, over], 0.5, 0.99), 1, 'the pen is the layer\'s ink where no layer above has any');
  const [sx, sy] = heart(54);
  const inked = new LayerInk(splatOf(53), [penIn(DESK, [[sx, sy], [sx + 0.05, sy]], '#fff')], DESK);
  assert.equal(topLayer([under, inked, over], sx, sy), 2);
  const b = brushOf(BRUSH_PX * 4, DESK);
  scrub(over, [[sx, sy]], b, MANY);
  assert.equal(topLayer([under, inked, over], sx, sy), 1, 'with the layer above washed away, the pen is what is there');
});

test('a pen written over a wash is ink again there, and a wash after it removes it: the strokes are in order', () => {
  const [cx, cy] = heart(55);
  const wash = washIn(DESK, [[cx - 0.05, cy], [cx + 0.05, cy]]);
  const pen = penIn(DESK, [[cx - 0.02, cy], [cx + 0.02, cy]], '#fff');
  const splat = splatOf(55);
  assert.equal(new LayerInk(splat, times(wash), DESK).has(cx, cy), false);
  assert.equal(new LayerInk(splat, [...times(wash), pen], DESK).has(cx, cy), true, 'written back');
  assert.equal(new LayerInk(splat, [...times(wash), pen, ...times(wash)], DESK).has(cx, cy), false, 'and washed again');
});

test('a pen stroke counts in the share washed: ink written back lowers it, and washing it raises it', () => {
  const [cx, cy] = heart(56);
  const wash = washIn(DESK, [[cx - 0.1, cy], [cx + 0.1, cy]], BRUSH_PX * 3);
  const splat = splatOf(56);
  const washedOnly = new LayerInk(splat, times(wash, 2 * MANY), DESK);
  const written = new LayerInk(splat, [...times(wash), penIn(DESK, [[cx - 0.1, cy], [cx + 0.1, cy]], '#fff')], DESK);
  assert.ok(written.washed < washedOnly.washed, `${written.washed} < ${washedOnly.washed}`);
  const b = brushOf(BRUSH_PX * 3, DESK);
  scrub(written, [[cx - 0.1, cy], [cx + 0.1, cy]], b, MANY);
  assert.ok(Math.abs(written.washed - washedOnly.washed) < 1e-9, 'scrubbed again, it is as washed as before');
});

test('a pen stroke where the splat is not is found by the sweep and counted in the share, and the sweep clears it', () => {
  const box: Box = { w: 988, h: 8 * ROW_PX };
  const y = 0.99;
  const ink = new LayerInk(splatOf(57), [penAcross(box, y)], box);
  const clean = new LayerInk(splatOf(57), [], box);
  assert.notEqual(ink.inkSpan(y, ROW_PX / 2 / box.h), null, 'the sweep finds ink where only the pen is');
  assert.equal(clean.washed, 0);
  assert.ok(ink.washed <= 0 + 1e-12 || ink.washed < 0.05, 'the share starts whole or close to it');
  const b = brushOf(SWEEP_BRUSH_ROWS * ROW_PX, box);
  scrub(ink, [[0, y], [1, y]], b, MANY);
  assert.equal(ink.inkSpan(y, 1 / (2 * box.h / ROW_PX) * 0.1), null, 'swept, it is gone from the row');
});

test('a stroke always ends on its last point, even one under a step from the last kept', () => {
  const step = minStepOf(DESK);
  const b = brushOf(PEN_PX, DESK);
  const [end] = fitStroke({ tool: 'wash', ...b, points: [[0, 0], [0.5, 0], [0.5001, 0]] }, step);
  assert.deepEqual(end!.points, [[0, 0], [0.5001, 0]], 'the last point replaces the one it is too close to');
  const [dab] = fitStroke({ tool: 'wash', ...b, points: [[0, 0], [0.0001, 0]] }, [0.05, 0.05]);
  assert.deepEqual(dab!.points, [[0, 0]], 'a lone point stays a dab');
});

test('a sweep saved on a row past a shrunken box is clamped to its last row', () => {
  const rows = bandsOf({ w: 400, h: 100 });
  const { sweep, point } = sweepStep(rows, { row: rows.length + 5, x: 0.2 }, 1 / 60);
  assert.ok(sweep.row < rows.length);
  assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
});

test('a layer on a very tall box keeps its splat memory to the stated bound', () => {
  const box: Box = { w: 390, h: 20000 };
  const ink = new LayerInk(splatOf(3), [], box);
  const held = () => [...(ink as unknown as { memo: Map<number, Map<number, boolean>> }).memo.values()].reduce((n, c) => n + c.size, 0);
  assert.ok(held() <= 20_000, `memo holds ${held()} after the grid pass`);
  let most = 0;
  for (let k = 0; k < 30_000; k++) { ink.has(Math.random(), Math.random()); if (k % 500 === 0) most = Math.max(most, held()); }
  assert.ok(most <= 20_000 && held() <= 20_000, `memo holds ${Math.max(most, held())}`);
});

test('a stroke is simplified to within a quarter of the brush\'s radius, keeping its ends', () => {
  const step = minStepOf(DESK);
  const b = brushOf(BRUSH_PX, DESK);
  const line: Stroke = { tool: 'wash', ...b, points: Array.from({ length: 200 }, (_, i): Pt => [0.1 + i * 0.004, 0.5]) };
  assert.deepEqual(fitStroke(line, step)[0]!.points, [[0.1, 0.5], [0.896, 0.5]], '200 points along a straight line become 2');
  const radius = 0.3 * DESK.h;
  const circle: Pt[] = Array.from({ length: 400 }, (_, i) => {
    const t = (i / 399) * Math.PI * 2;
    return [Math.round((0.5 + (radius * Math.cos(t)) / DESK.w) * 1e4) / 1e4, Math.round((0.5 + (radius * Math.sin(t)) / DESK.h) * 1e4) / 1e4];
  });
  const [kept] = fitStroke({ tool: 'ink', color: 'red', ...b, points: circle }, [1e-9, 1e-9]);
  assert.ok(kept!.points.length < 400 && kept!.points.length > 8, `a circle keeps ${kept!.points.length} points`);
  assert.deepEqual(kept!.points[0], circle[0], 'the first point is kept');
  assert.deepEqual(kept!.points[kept!.points.length - 1], circle[399], 'the last point is kept');
  const tol = (b.width * DESK.w) / 8;
  const px = ([x, y]: Pt): Pt => [x * DESK.w, y * DESK.h];
  const near = (p: Pt) => {
    let best = Infinity;
    for (let i = 1; i < kept!.points.length; i++) {
      const [ax, ay] = px(kept!.points[i - 1]!), [bx, by] = px(kept!.points[i]!), [qx, qy] = px(p);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx - qx, ay + t * dy - qy));
    }
    return best;
  };
  for (const p of circle) assert.ok(near(p) <= tol + 0.05, `a point is ${near(p).toFixed(2)}px from the kept line, over ${tol}`);
  const dab: Stroke = { tool: 'wash', ...b, points: [[0.5, 0.5]] };
  assert.deepEqual(fitStroke(dab, step)[0]!.points, [[0.5, 0.5]], 'a dab stays a dab');
});

test('a long stroke is pieces that each start where the last ended, and only the last keeps its drops', () => {
  const step: Pt = [1e-9, 1e-9];
  const b = brushOf(4, DESK);
  const zig: Pt[] = Array.from({ length: 1200 }, (_, i) => [(i % 2) * 0.9 + 0.05, 0.05 + (i / 1200) * 0.9]);
  const pieces = fitStroke({ tool: 'ink', color: 'red', ...b, points: zig, continues: true, drops: 2 }, step);
  assert.ok(pieces.length >= 3, `${pieces.length} pieces`);
  assert.ok(pieces.every((s) => s.points.length <= STROKES.points));
  for (let i = 1; i < pieces.length; i++) assert.deepEqual(pieces[i]!.points[0], pieces[i - 1]!.points[pieces[i - 1]!.points.length - 1], `piece ${i} starts where the last ended`);
  assert.deepEqual(pieces.map((s) => (s as { continues?: true }).continues), [true, ...pieces.slice(1).map(() => true)], 'every piece after the first continues (the first keeps what it was given)');
  assert.deepEqual(pieces.map((s) => (s as { drops?: number }).drops), [...pieces.slice(1).map(() => undefined), 2].map((d, i) => (i === pieces.length - 1 ? 2 : undefined)), 'drops on the last alone');
  const fresh = fitStroke({ tool: 'ink', color: 'red', ...b, points: zig, drops: 3 }, step);
  assert.equal((fresh[0] as { continues?: true }).continues, undefined, 'the first piece of a new line does not continue');
  assert.ok(fresh.slice(1).every((s) => (s as { continues?: true }).continues === true));
  assert.deepEqual(fresh.map((s) => (s as { drops?: number }).drops), fresh.map((_, i) => (i === fresh.length - 1 ? 3 : undefined)));
  const wash = fitStroke({ tool: 'wash', ...b, points: zig }, step);
  assert.ok(wash.every((s) => !('drops' in s)), 'a wash has no drops');
});
