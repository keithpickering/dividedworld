/**
 * The ink field's operations (ink-field design, sections 1 to 3): a pen adds to the splat's field, a wash takes from it,
 * and one implementation serves the painter's grid, a layer's cells and a single point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_OVER, DROPS_MOST, END_BULB, FIELD_MOST, READ_THROUGH, THIN_FLOOR, THIN_SPAN, WASH_TAKES, bandGrid, beginPen, beginWash, cellGrid, denseGrid, addBall, endsOf, fieldAtPoint, kOf, linesOf,
  penAt, penLine, pointGrid, beginLine, radiusOf, splatInto, strokesInto, washLine, type FieldStroke, type Grid,
} from './field.ts';
import { THRESHOLD, fieldGrid, makeSplat, mulberry32, type Box, type Splat } from './splat.ts';
import { brushOf, fitStroke, type Pt, type Stroke } from './scrub.ts';

const WIDE: Box = { w: 988, h: 330 };
const TALL: Box = { w: 390, h: 1200 };
const MID: Box = { w: 754, h: 438 };
const NONE: Splat = { balls: [], placement: { cx: 0.625, cy: 0.5 } };

const pen = (points: Pt[], brush: { width: number; aspect: number }, extra: object = {}): FieldStroke => ({ tool: 'ink', color: 'black', ...brush, points, ...extra });
const wash = (points: Pt[], brush: { width: number; aspect: number }, extra: object = {}): FieldStroke => ({ tool: 'wash', ...brush, points, ...extra });
const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tolerance ${tol})`);
const fill = (g: Grid, v: number) => g.values.fill(v);
/** The grid's value at a px position (the point whose center is nearest). */
const at = (g: Grid, x: number, y: number) => g.values[Math.min(g.rows - 1, Math.floor(y / g.step)) * g.cols + Math.min(g.cols - 1, Math.floor(x / g.step))]!;

test('the constants are named', () => {
  assert.deepEqual([WASH_TAKES, END_BULB, DROPS_MOST, FIELD_MOST], [1.5, 1.35, 3, 16]);
});

test('grids: dense, cell and single point lay their points out the same way', () => {
  const d = denseGrid(MID, 2), c = cellGrid(MID, 12.5), p = pointGrid(30.25, 11);
  assert.deepEqual([d.cols, d.rows, d.step, d.ox, d.oy], [1508, 876, 0.5, 0.25, 0.25]);
  assert.deepEqual([c.cols, c.rows, c.step, c.ox, c.oy], [61, 36, 12.5, 6.25, 6.25]);
  assert.deepEqual([p.cols, p.rows, p.ox, p.oy], [1, 1, 30.25, 11]);
});

test('splatInto is fieldGrid', () => {
  const splat = makeSplat(20261112), g = denseGrid(MID, 2);
  splatInto(g, splat, MID);
  const want = fieldGrid(splat, MID, 2);
  assert.equal(g.values.length, want.length);
  let worst = 0;
  for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(g.values[i]! - want[i]!));
  assert.ok(worst < 1e-5, `worst ${worst}`);
});

test('a lone line\'s edge is its radius, on a wide box and on a tall one (an ellipse there)', () => {
  const brush = brushOf(16, WIDE);
  /* Wide: the drawer's own box, round. */
  const h = [pen([[0.1, 0.5], [0.8, 0.5]], brush)];
  const r = radiusOf(brush, WIDE);
  near(r, 8, 1e-9);
  for (const s of [-1, 1]) {
    assert.ok(fieldAtPoint(NONE, WIDE, h, 400, 165 + s * (r - 0.5)) >= THRESHOLD, 'inside');
    assert.ok(fieldAtPoint(NONE, WIDE, h, 400, 165 + s * (r + 0.5)) < THRESHOLD, 'outside');
  }
  /* Tall: the same brush is r across and r * k down. */
  const rt = radiusOf(brush, TALL), k = kOf(brush, TALL);
  assert.ok(k > 5, `an ellipse, k ${k}`);
  const v = [pen([[0.5, 0.1], [0.5, 0.9]], brush)], hz = [pen([[0.1, 0.5], [0.9, 0.5]], brush)];
  for (const s of [-1, 1]) {
    assert.ok(fieldAtPoint(NONE, TALL, v, 195 + s * (rt - 0.5), 600) >= THRESHOLD, 'across, inside');
    assert.ok(fieldAtPoint(NONE, TALL, v, 195 + s * (rt + 0.5), 600) < THRESHOLD, 'across, outside');
    assert.ok(fieldAtPoint(NONE, TALL, hz, 195, 600 + s * (rt * k - 0.5)) >= THRESHOLD, 'down, inside');
    assert.ok(fieldAtPoint(NONE, TALL, hz, 195, 600 + s * (rt * k + 0.5)) < THRESHOLD, 'down, outside');
  }
});

test('no bulge at a line\'s own points: the center line varies by under 2%', () => {
  const brush = brushOf(16, WIDE), pts: Pt[] = [];
  for (let i = 0; i < 30; i++) pts.push([(100 + i * 5) / WIDE.w, 0.5]);
  const g = denseGrid(WIDE, 1);
  penLine(g, WIDE, [pen(pts, brush)]);
  /* Away from the end: the bulb (2.7r reach) is the end's, not the line's own points. */
  let lo = Infinity, hi = -Infinity;
  for (let x = 110; x < 215; x++) { const v = at(g, x + 0.5, 165); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok((hi - lo) / hi < 0.02, `varies ${lo}..${hi}`);
  near((hi + lo) / 2, 1, 0.05, 'the level');
});

test('a splat and a line each below the threshold are ink together: the fields add where they meet', () => {
  const splat: Splat = { balls: [{ x: 0.625, y: 0.5, r: 0.1 }], placement: { cx: 0.625, cy: 0.5 } };
  const rPx = 0.1 * Math.sqrt((WIDE.w * WIDE.h) / 1.25), edgeX = 494 + rPx;
  const brush = brushOf(16, WIDE), line = [pen([[(edgeX + 60) / WIDE.w, 0.5], [(edgeX + 8) / WIDE.w, 0.5]], brush)];
  /* A point just off both the splat's edge and the line's flank (found by scanning): 0.336 from each, 0.673 together. */
  const x = edgeX + 4, y = 165 + 12;
  const splatOnly = fieldAtPoint(splat, WIDE, [], x, y), lineOnly = fieldAtPoint(NONE, WIDE, line, x, y), both = fieldAtPoint(splat, WIDE, line, x, y);
  assert.ok(splatOnly < THRESHOLD, `the splat alone ${splatOnly}`);
  assert.ok(lineOnly < THRESHOLD, `the line alone ${lineOnly}`);
  assert.ok(both >= THRESHOLD, `together ${both}`);
  near(both, splatOnly + lineOnly, 1e-5, 'the sum');
});

test('one line in pieces is one line: the same field, and one bulb', () => {
  const brush = brushOf(16, WIDE), pts: Pt[] = [];
  let x = 20, dir = 1;
  for (let i = 0; i < 1200; i++) {
    if (x > 960 || x < 20) dir = -dir;
    x += dir * 7;
    // A wiggle of 8px each way, past the simplification's quarter-radius tolerance, so fitStroke keeps the points.
    pts.push([x / WIDE.w, (15 + (i / 1200) * 300 + (i % 2 ? 8 : -8)) / WIDE.h]);
  }
  const pieces: FieldStroke[] = fitStroke({ tool: 'ink', color: 'black', ...brush, points: pts, drops: 2 }, [5 / WIDE.w, 5 / WIDE.h]);
  assert.ok(pieces.length >= 3, `${pieces.length} pieces`);
  assert.equal(linesOf(pieces).length, 1);
  const whole: FieldStroke = { ...pieces[0]!, points: pieces.flatMap((s, i) => (i ? s.points.slice(1) : s.points)), drops: 2 } as FieldStroke;
  delete (whole as { continues?: true }).continues;
  const a = denseGrid(WIDE, 1), b = denseGrid(WIDE, 1);
  strokesInto(a, WIDE, pieces);
  strokesInto(b, WIDE, [whole]);
  let worst = 0;
  for (let i = 0; i < a.values.length; i++) worst = Math.max(worst, Math.abs(a.values[i]! - b.values[i]!));
  assert.ok(worst < 1e-6, `worst ${worst}`);
  assert.ok(a.values.some((v) => v > 0));
  assert.equal(endsOf(pieces.map((s) => ({ ...s, drops: 0 })), WIDE).length, 1, 'one bulb for the whole line');
  assert.equal(endsOf(pieces, WIDE).length, 3);
});

test('ends come from saved data: the same stroke gives the same balls; drops 0 is the bulb alone; a short line has none', () => {
  const brush = brushOf(16, MID), r = radiusOf(brush, MID);
  const pts: Pt[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [(100 + i * 20) / MID.w, (200 + Math.sin(i) * 15) / MID.h]);
  const s = pen(pts, brush, { drops: 3 }) as FieldStroke;
  const a = endsOf([s], MID), b = endsOf([s], MID);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  near(a[0]!.r, r * END_BULB, 1e-9, 'bulb');
  assert.deepEqual(a[0]!.x, pts[9]![0] * MID.w);
  assert.equal(endsOf([{ ...s, drops: 0 }], MID).length, 1);
  assert.equal(endsOf([{ ...s, drops: undefined }], MID).length, 1);
  assert.equal(endsOf([{ ...s, drops: 9 }], MID).length, 1 + DROPS_MOST);
  /* Shorter than 4r: nothing. */
  assert.deepEqual(endsOf([pen([[0.2, 0.5], [0.2 + (3 * r) / MID.w, 0.5]], brush, { drops: 3 })], MID), []);
  assert.deepEqual(endsOf([pen([[0.2, 0.5]], brush, { drops: 3 })], MID), []);
  /* Moving one saved point moves the drops; their count stays. */
  const moved = pts.map((p, i): Pt => (i === 4 ? [p[0] + 0.0001, p[1]] : p));
  const c = endsOf([pen(moved, brush, { drops: 3 })], MID);
  assert.equal(c.length, a.length);
  assert.notDeepEqual(c.slice(1), a.slice(1));
  /* Each drop is past the end, within 0.25 rad of the last direction. */
  const back = pts[7]!, end = pts[9]!, ang = Math.atan2((end[1] - back[1]) * MID.h, (end[0] - back[0]) * MID.w);
  for (const d of a.slice(1)) {
    const from = Math.atan2(d.y - a[0]!.y, d.x - a[0]!.x);
    assert.ok(Math.abs(from - ang) <= 0.25 + 1e-9, `angle ${from} vs ${ang}`);
    const dist = Math.hypot(d.x - a[0]!.x, d.y - a[0]!.y);
    assert.ok(dist >= r * 2.6 - 1e-9 && dist <= r * (2.6 + 2.2 * 2 + 2) + 1e-9);
    assert.ok(d.r >= r * 0.35 - 1e-9 && d.r <= r * 0.7 + 1e-9);
  }
});

const straight = (box: Box, gap: number, brush: { width: number; aspect: number }, y = 0.5): Stroke => {
  const pts: Pt[] = [];
  for (let x = 100; x <= 400; x += gap) pts.push([x / box.w, y]);
  return wash(pts, brush);
};

test('one pass takes WASH_TAKES, whether its points are 5px or 25px apart', () => {
  for (const gap of [5, 25]) {
    const brush = brushOf(30, MID), g = denseGrid(MID, 1);
    fill(g, 3);
    washLine(g, MID, [straight(MID, gap, brush) as FieldStroke]);
    near(at(g, 250, 219), 3 - WASH_TAKES, 0.05, `gap ${gap}`);
  }
});

test('passes add: a thin arm clears in one pass, the core takes two', () => {
  const brush = brushOf(30, MID), g = denseGrid(MID, 1), arm = denseGrid(MID, 1);
  fill(g, 3); fill(arm, 0.7);
  const one = straight(MID, 5, brush) as FieldStroke;
  washLine(g, MID, [one]); washLine(arm, MID, [one]);
  assert.ok(at(arm, 250, 219) <= 0.001, 'arm after one');
  near(at(g, 250, 219), 3 - WASH_TAKES, 0.05, 'core after one');
  washLine(g, MID, [one]);
  assert.ok(at(g, 250, 219) <= 5e-3, `core after two ${at(g, 250, 219)}`);
});

test('a dab is one pass: a one-point wash lowers its center by WASH_TAKES', () => {
  const brush = brushOf(30, MID), g = denseGrid(MID, 1);
  fill(g, 3);
  washLine(g, MID, [wash([[250.5 / MID.w, 219.5 / MID.h]], brush)]);
  near(at(g, 250.5, 219.5), 3 - WASH_TAKES, 1e-4);
  /* Incrementally: the disc shows at once, the top-up at the lift. */
  const h = denseGrid(MID, 1);
  fill(h, 3);
  const line = beginWash(h, MID, brush);
  line.to([250.5 / MID.w, 219.5 / MID.h]);
  const mid = at(h, 250.5, 219.5);
  assert.ok(mid < 3 && mid > 3 - WASH_TAKES);
  line.end();
  near(at(h, 250.5, 219.5), 3 - WASH_TAKES, 1e-4);
});

test('a short drag is a dab: a line no longer than R (2r) takes WASH_TAKES under its end, as a tap does', () => {
  const brush = brushOf(30, MID);
  for (const drag of [3, 4, 14]) {
    const g = denseGrid(MID, 1);
    fill(g, 3);
    const line = beginWash(g, MID, brush);
    line.to([250.5 / MID.w, 219.5 / MID.h]);
    line.to([(250.5 + drag) / MID.w, 219.5 / MID.h]);
    line.end();
    near(at(g, 250.5 + drag, 219.5), 3 - WASH_TAKES, 0.05, `a ${drag}px drag`);
  }
  /* A line of 1.5 * 2r or more (DAB_FADE_ENDS) is a pass, not a dab: nothing is added at its end. */
  const g = denseGrid(MID, 1), h = denseGrid(MID, 1);
  fill(g, 3); fill(h, 3);
  const long = (grid: Grid, end: boolean) => { const l = beginWash(grid, MID, brush); l.to([250.5 / MID.w, 219.5 / MID.h]); l.to([(250.5 + 60) / MID.w, 219.5 / MID.h]); if (end) l.end(); };
  long(g, true); long(h, false);
  assert.deepEqual(g.values, h.values);
});

test('never below zero, and every point lowered is marked washed (and no other)', () => {
  const brush = brushOf(30, MID), g = denseGrid(MID, 1);
  fill(g, 0.3);
  for (let i = 0; i < 4; i++) washLine(g, MID, [straight(MID, 5, brush) as FieldStroke]);
  assert.ok(g.values.every((v) => v >= 0));
  assert.equal(g.washed[219 * g.cols + 250], 1);
  assert.equal(g.washed[10 * g.cols + 10], 0);
  assert.equal(g.washed[219 * g.cols + 700], 0);
  const empty = denseGrid(MID, 1);
  washLine(empty, MID, [straight(MID, 5, brush) as FieldStroke]);
  assert.ok(empty.washed.every((m) => m === 0), 'a point with no ink is not lowered');
});

test('order matters: a wash takes the pen\'s ink; a pen after a wash is whole', () => {
  const pb = brushOf(16, MID), wb = brushOf(30, MID);
  const p = pen([[100 / MID.w, 219 / MID.h], [400 / MID.w, 219 / MID.h]], pb), w = wash([[100 / MID.w, 219 / MID.h], [400 / MID.w, 219 / MID.h]], wb);
  assert.ok(fieldAtPoint(NONE, MID, [p, w], 250, 219) <= 0.001);
  const alone = fieldAtPoint(NONE, MID, [p], 250, 219);
  near(fieldAtPoint(NONE, MID, [w, p], 250, 219), alone, 1e-6);
  near(alone, 1, 1e-4);
});

test('the point agrees with the grid: a seeded splat and 40 mixed strokes, 200 random points', () => {
  const splat = makeSplat(7777), rnd = mulberry32(42), g = denseGrid(MID, 1);
  const strokes: FieldStroke[] = [];
  for (let s = 0; s < 40; s++) {
    const brush = brushOf(8 + rnd() * 36, rnd() < 0.3 ? TALL : MID), n = 2 + Math.floor(rnd() * 30);
    let x = rnd(), y = rnd();
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) { pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]); x += (rnd() - 0.5) * 0.04; y += (rnd() - 0.5) * 0.06; }
    const tool = rnd() < 0.5 ? 'ink' : 'wash';
    const prev = strokes[strokes.length - 1];
    const joined = prev && prev.tool === tool && rnd() < 0.25;
    const extra = tool === 'ink' ? { drops: Math.floor(rnd() * 4) } : {};
    strokes.push(joined ? { ...(tool === 'ink' ? pen(pts, prev, extra) : wash(pts, prev, extra)), continues: true } : tool === 'ink' ? pen(pts, brush, extra) : wash(pts, brush, extra));
  }
  splatInto(g, splat, MID);
  strokesInto(g, MID, strokes);
  let touchedInk = 0;
  for (let n = 0; n < 200; n++) {
    const i = Math.floor(rnd() * g.cols), j = Math.floor(rnd() * g.rows);
    const want = g.values[j * g.cols + i]!, got = fieldAtPoint(splat, MID, strokes, i + 0.5, j + 0.5);
    if (want > 0) touchedInk++;
    near(got, want, 1e-4, `point ${i},${j}`);
  }
  assert.ok(touchedInk > 20, 'the points are not all empty');
});

test('a line can be driven incrementally, and each call returns the rectangle it touched', () => {
  const brush = brushOf(16, MID), g = denseGrid(MID, 1), line = beginPen(g, MID, brush);
  const r0 = line.to([100 / MID.w, 200 / MID.h]);
  assert.ok(r0.x1 > r0.x0 && r0.y1 > r0.y0);
  const r1 = line.to([160 / MID.w, 200 / MID.h]);
  assert.ok(r1.x0 <= 92 && r1.x1 >= 176, `${JSON.stringify(r1)}`);
  assert.ok(g.values[200 * g.cols + 130]! > 0.9);
  line.end();
  /* The scope is cleared when the line ends: a second line starts fresh. */
    const second = beginPen(g, MID, brush);
  second.to([100 / MID.w, 200 / MID.h]);
  assert.ok(g.values[200 * g.cols + 100]! > 1.5, 'a second line adds');
});

test('a pen line must be ended before another begins on its grid: a second beginPen throws, until end()', () => {
  const brush = brushOf(16, MID), g = denseGrid(MID, 1), other = denseGrid(MID, 1);
  const first = beginPen(g, MID, brush);
  first.to([0.2, 0.5]);
  assert.throws(() => beginPen(g, MID, brush), /open/);
  assert.throws(() => beginLine(g, MID, pen([], brush)), /open/);
  assert.doesNotThrow(() => beginPen(other, MID, brush).end(), 'another grid is its own scope');
  assert.doesNotThrow(() => beginWash(g, MID, brush).end(), 'a wash has no scope');
  first.end();
  assert.doesNotThrow(() => beginPen(g, MID, brush).end());
});

test('cost: 400 corner-to-corner pen segments visit only the cells the capsule can reach', () => {
  const brush = brushOf(16, MID), g = denseGrid(MID, 1), line = beginPen(g, MID, brush);
  g.work = { visits: 0 };
  const t = performance.now();
  for (let i = 0; i < 401; i++) line.to(i % 2 ? [(MID.w - 10) / MID.w, (MID.h - 10) / MID.h] : [10 / MID.w, 10 / MID.h]);
  line.end();
  console.log(`# long pen segments: ${g.work.visits} visits, ${(performance.now() - t).toFixed(0)}ms`);
  /* A capsule 16px across and ~850px long is ~27,000 cells; its bounding box is ~350,000. */
  assert.ok(g.work.visits < 400 * 60_000, `${g.work.visits} visits`);
  assert.ok(g.values[219 * g.cols + 377]! > 0.9, 'the line is there');
});

test('cost: 12,000 points of 30px wash under 1.5s, 12,000 points of 16px pen under 600ms', () => {
  const route = (): Pt[] => {
    const pts: Pt[] = [];
    let x = 10, dir = 1, y = 10;
    for (let i = 0; i < 12_000; i++) {
      x += dir * 5;
      if (x > MID.w - 10 || x < 10) { dir = -dir; y = 10 + ((y + 17 - 10) % (MID.h - 20)); }
      pts.push([x / MID.w, y / MID.h]);
    }
    return pts;
  };
  const wb = brushOf(30, MID), g = denseGrid(MID, 1);
  fill(g, 3);
  let t = performance.now();
  washLine(g, MID, [wash(route(), wb)]);
  const washMs = performance.now() - t;
  const pb = brushOf(16, MID), h = denseGrid(MID, 1);
  t = performance.now();
  penLine(h, MID, [pen(route(), pb)]);
  const penMs = performance.now() - t;
  console.log(`# wash ${washMs.toFixed(0)}ms, pen ${penMs.toFixed(0)}ms`);
  assert.ok(washMs < 1500, `wash ${washMs}ms`);
  assert.ok(penMs < 600, `pen ${penMs}ms`);
});

test('penAt: a pen line at a point, plus its end balls, is penLine on that point (one kernel for painter and model)', () => {
  const rnd = mulberry32(7);
  for (const box of [WIDE, TALL, MID]) for (const aspect of [1, 0.4, 2.5]) {
    const brush = { width: 18, aspect }, k = kOf(brush, box), r = radiusOf(brush, box);
    for (let trial = 0; trial < 6; trial++) {
      const n = trial === 0 ? 1 : 2 + Math.floor(rnd() * 6);
      const pts: Pt[] = [];
      const cx = 0.2 + rnd() * 0.6, cy = 0.2 + rnd() * 0.6;
      for (let i = 0; i < n; i++) pts.push([cx + (rnd() - 0.5) * 0.25, cy + (rnd() - 0.5) * 0.25]);
      const line = [pen(pts, brush, { drops: Math.floor(rnd() * 4) })];
      const balls = endsOf(line, box);
      for (let q = 0; q < 60; q++) {
        const x = (cx + (rnd() - 0.5) * 0.5) * box.w, y = (cy + (rnd() - 0.5) * 0.5) * box.h;
        const g = pointGrid(x, y);
        penLine(g, box, line);
        const v = penAt(pts, brush, box, x, y / k);
        const gb = pointGrid(x, y);
        for (const b of balls) addBall(gb, k, b);
        near(v + gb.values[0]!, g.values[0]!, 1e-5, `${box.w}x${box.h} aspect ${aspect} r ${r}`);
      }
    }
  }
});

/** Strokes for a lattice test: a mixed list of `n` pens and washes spread over the whole box, some joined, as a post's would be. */
function mixedStrokes(box: Box, n: number, seed: number): FieldStroke[] {
  const rnd = mulberry32(seed), strokes: FieldStroke[] = [];
  for (let s = 0; s < n; s++) {
    const brush = brushOf(8 + rnd() * 36, box), len = 2 + Math.floor(rnd() * 30);
    let x = rnd(), y = rnd();
    const pts: Pt[] = [];
    for (let i = 0; i < len; i++) { pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]); x += (rnd() - 0.5) * 0.04; y += (rnd() - 0.5) * 0.02; }
    const tool = rnd() < 0.5 ? 'ink' : 'wash';
    const prev = strokes[strokes.length - 1];
    const joined = prev && prev.tool === tool && rnd() < 0.25;
    const extra = tool === 'ink' ? { drops: Math.floor(rnd() * 4) } : {};
    strokes.push(joined ? { ...(tool === 'ink' ? pen(pts, prev, extra) : wash(pts, prev, extra)), continues: true } : tool === 'ink' ? pen(pts, brush, extra) : wash(pts, brush, extra));
  }
  return strokes;
}

test('bands equal the whole: a lattice cut into bands of 512 rows with an apron has the whole grid\'s values and washed marks, bit for bit', () => {
  const box: Box = { w: 390, h: 1400 }, splat = makeSplat(20261112), strokes = mixedStrokes(box, 40, 99);
  for (const density of [1, 0.73]) {
    const whole = denseGrid(box, density);
    splatInto(whole, splat, box);
    strokesInto(whole, box, strokes);
    let ink = 0, washed = 0;
    for (let i = 0; i < whole.values.length; i++) { if (whole.values[i]! > 0) ink++; if (whole.washed[i]) washed++; }
    assert.ok(ink > 1000 && washed > 100, `the lists leave ink and washed marks (${ink}, ${washed})`);
    let compared = 0;
    for (let row0 = 0; row0 < whole.rows; row0 += 512) {
      /* One row of apron above and below, which may lie outside the lattice (-1, or one past the end). */
      const band = bandGrid(box, density, row0 - 1, Math.min(512, whole.rows - row0) + 2);
      assert.equal(band.cols, whole.cols);
      assert.equal(band.row0, row0 - 1);
      splatInto(band, splat, box);
      strokesInto(band, box, strokes);
      for (let j = 0; j < band.rows; j++) {
        const lattice = band.row0 + j;
        if (lattice < 0 || lattice >= whole.rows) continue;
        for (let i = 0; i < band.cols; i++) {
          const m = j * band.cols + i, w = lattice * whole.cols + i;
          assert.ok(Object.is(band.values[m], whole.values[w]), `density ${density}, lattice (${i}, ${lattice}): ${band.values[m]} vs ${whole.values[w]}`);
          assert.equal(band.washed[m], whole.washed[w], `washed at (${i}, ${lattice})`);
          compared++;
        }
      }
    }
    assert.ok(compared >= whole.values.length, 'every lattice point was compared');
  }
});

test('a band far from a stroke visits nothing', () => {
  const box: Box = { w: 390, h: 4000 }, brush = brushOf(30, box);
  const band = bandGrid(box, 1, 3000, 512);
  band.work = { visits: 0 };
  /* Pen and wash, 2,000px above the band's first row, with the pen's bulb and drops. */
  strokesInto(band, box, [
    pen([[0.2, 500 / box.h], [0.7, 520 / box.h]], brush, { drops: 3 }),
    wash([[0.2, 540 / box.h], [0.7, 560 / box.h]], brush),
  ]);
  assert.equal(band.work.visits, 0);
  strokesInto(band, box, [pen([[0.2, 3200 / box.h], [0.7, 3220 / box.h]], brush)]);
  assert.ok(band.work.visits > 0, 'a stroke in the band does visit');
});

/*
 * The plan asked that the take under the end point "never rises with length" and "changes by under 0.1 between
 * neighbors 0.05R apart" from R to 1.6R. The disc spacing (h = r / 3, 5px for this brush) rules both out: the end
 * point is reached by a half line of discs, so what the discs alone give it is a sawtooth with a period of h that rises
 * by up to about 0.22 where the last disc's phase wraps, and the fade has to fall about 0.75 across 0.5R besides. What
 * the fade is for (design section 3) is that the step at R is gone, so this holds that: no neighbor, starting from
 * just under R, falls by more than FALL_MOST (the step it replaces is 0.61; the finished code's largest fall is
 * 0.19), the top-up never takes less than none, and the rises are the discs' own. FALL_MOST is the owner's to confirm
 * (the PR's Design questions).
 */
test('a drag never cleans less than a shorter one: the step at R is gone, and what rises is the disc spacing\'s', () => {
  const FALL_MOST = 0.22;
  const brush = brushOf(30, MID), R = 2 * radiusOf(brush, MID), x0 = 150.5, y = 219.5;
  /* The take under the end point of a straight wash `length` long; `topUp` false never ends the line, which is the discs alone. */
  const takeAt = (length: number, topUp = true): number => {
    const g = denseGrid(MID, 1);
    fill(g, 3);
    const line = beginWash(g, MID, brush);
    line.to([x0 / MID.w, y / MID.h]);
    if (length > 0) line.to([(x0 + length) / MID.w, y / MID.h]);
    if (topUp) line.end();
    return 3 - at(g, x0 + length, y);
  };
  for (const f of [0, 0.5, 1]) near(takeAt(f * R), WASH_TAKES, 0.02, `a drag of ${f}R`);
  const fs: number[] = [];
  for (let f = 0.95; f <= 1.6001; f += 0.05) fs.push(f);
  const withUp = fs.map((f) => takeAt(f * R)), bare = fs.map((f) => takeAt(f * R, false));
  let bareRise = 0;
  for (let i = 1; i < fs.length; i++) bareRise = Math.max(bareRise, bare[i]! - bare[i - 1]!);
  assert.ok(bareRise > 0.1, `the discs alone rise by ${bareRise}: the sawtooth is real`);
  for (let i = 0; i < fs.length; i++) {
    assert.ok(withUp[i]! >= bare[i]! - 1e-6, `the top-up took ground at ${fs[i]!.toFixed(2)}R: ${withUp[i]} vs ${bare[i]}`);
    if (i === 0) continue;
    const d = withUp[i]! - withUp[i - 1]!;
    assert.ok(-d <= FALL_MOST, `a step of ${(-d).toFixed(3)} down at ${fs[i]!.toFixed(2)}R`);
    assert.ok(d <= bareRise + 0.02, `a rise of ${d.toFixed(3)} at ${fs[i]!.toFixed(2)}R, more than the discs' ${bareRise.toFixed(3)}`);
  }
  for (const f of [1.1, 1.25, 1.5, 2]) assert.ok(takeAt(f * R) <= WASH_TAKES + 0.02, `a drag of ${f}R`);
});

test('COVER_OVER is the field at which a washed point reads through at READ_THROUGH', () => {
  assert.equal(READ_THROUGH, 0.75);
  near(COVER_OVER, 0.738, 0.001, 'COVER_OVER');
  near(THIN_FLOOR + ((1 - THIN_FLOOR) * COVER_OVER) / THIN_SPAN, READ_THROUGH, 1e-9, 'the thinning at COVER_OVER');
});
