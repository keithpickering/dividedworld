/**
 * Whoops!'s scrubbing, the pure half (refinements design sections 3 and 4): what a stroke leaves of a layer in
 * the body's box on one screen, which layer a stroke scrubs, the bounds a saved stroke keeps to, the accessible
 * sweep's pace, and which lines of text lie under ink. Strokes are in shares of the box; the brush is in px.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRUSH_PX, CELL_PX, LayerInk, MIN_STEP_PX, PEN_PX, ROW_PX, SWEEP_BRUSH_ROWS, SWEEP_SPEED,
  bandsOf, brushOf, coveredLines, fits, fitStroke, minStepOf, sweepStep, topLayer, type Pt, type Stroke, type Sweep,
} from './scrub.ts';
import { encodePoints } from './points.ts';
import { covers, makeSplat, type Box } from './splat.ts';
import { whoops, STROKES } from '../whoops.ts';

/** The drawer's box on a desktop: a few lines of body. */
const DESK: Box = { w: 988, h: 330 };
const PHONE: Box = { w: 390, h: 1200 };
const splatOf = (seed: number) => makeSplat(seed);
/** A wash of `px` across, in shares of `box`, through `points`. */
const washIn = (box: Box, points: Pt[], px = BRUSH_PX): Stroke => ({ tool: 'wash', ...brushOf(px, box), points });
const penIn = (box: Box, points: Pt[], color = '#ff2bd6'): Stroke => ({ tool: 'ink', color, ...brushOf(PEN_PX, box), points });
/** The center of a splat's core, in shares of the design box (1.25 x 1), which is the box's own share. */
const heart = (seed: number): Pt => { const { cx, cy } = splatOf(seed).placement; return [cx / 1.25, cy]; };

test('the measures are the board\'s own, in px', () => {
  assert.deepEqual([BRUSH_PX, PEN_PX, ROW_PX, SWEEP_BRUSH_ROWS, CELL_PX, MIN_STEP_PX, SWEEP_SPEED], [30, 9, 22.5, 1.15, 12.5, 5, 0.55]);
  const b = brushOf(30, DESK);
  assert.ok(Math.abs(b.width - 30 / 988) < 1e-12 && Math.abs(b.aspect - 988 / 330) < 1e-12);
});

test('the brush follows the drawer\'s box: round where it was drawn, an ellipse on a taller screen', () => {
  const at: Pt = [0.5, 0.5];
  const dab = { width: 30 / 988, aspect: 988 / 330 };
  const probe = (box: Box, dxPx: number, dyPx: number) => {
    const ink = new LayerInk(splatOf(11), [], box);
    ink.wash([at], dab.width, dab.aspect);
    return ink.has(at[0] + dxPx / box.w, at[1] + dyPx / box.h) === covers(splatOf(11), box, at[0] + dxPx / box.w, at[1] + dyPx / box.h);
  };
  // Where drawn: 30px across, round. Inside 14px every way is washed; past 16px nothing of the brush is left.
  const ink = new LayerInk(splatOf(11), [], DESK);
  ink.wash([at], dab.width, dab.aspect);
  for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10]] as const) assert.equal(ink.has(at[0] + dx / DESK.w, at[1] + dy / DESK.h), false, `inside at ${dx},${dy}`);
  assert.ok(probe(DESK, 16, 0) && probe(DESK, 0, 16) && probe(DESK, 12, 12), 'past the brush is as the splat was');
  // On 390x1200: radii 15 * 390/988 = 5.9px across and 15 * 1200/330 = 54.5px down.
  const tall = new LayerInk(splatOf(11), [], PHONE);
  tall.wash([at], dab.width, dab.aspect);
  assert.equal(tall.has(at[0] + 5 / PHONE.w, at[1]), false);
  assert.equal(tall.has(at[0], at[1] + 52 / PHONE.h), false);
  assert.equal(tall.has(at[0], at[1] - 52 / PHONE.h), false);
  assert.equal(tall.has(at[0] + 7 / PHONE.w, at[1]), covers(splatOf(11), PHONE, at[0] + 7 / PHONE.w, at[1]));
  assert.equal(tall.has(at[0], at[1] + 57 / PHONE.h), covers(splatOf(11), PHONE, at[0], at[1] + 57 / PHONE.h));
  assert.equal(covers(splatOf(11), PHONE, at[0], at[1]), true, 'the heart of the splat was ink to begin with');
});

test('a wash leaves a layer without ink along its path and nowhere else', () => {
  const splat = splatOf(11);
  const [cx, cy] = heart(11);
  const ink = new LayerInk(splat, [], DESK);
  assert.equal(ink.has(cx, cy), true);
  assert.equal(ink.washed, 0);
  const b = brushOf(BRUSH_PX, DESK);
  ink.wash([[cx - 0.05, cy], [cx + 0.05, cy]], b.width, b.aspect);
  assert.equal(ink.has(cx, cy), false);
  assert.equal(ink.has(cx + 0.05, cy), false, 'a brush is round at its ends');
  assert.equal(ink.has(cx, cy + 0.3), covers(splat, DESK, cx, cy + 0.3), 'a spot the brush did not reach is as it was');
  assert.ok(ink.washed > 0 && ink.washed < 0.3);
  assert.equal(new LayerInk(splat, [washIn(DESK, [[cx - 0.05, cy], [cx + 0.05, cy]])], DESK).has(cx, cy), false, 'a saved stroke washes as a fresh one does');
});

test('ink past the box is never counted: washing every cell of the box reaches clean', () => {
  // A one-line box: the splat is laid over it whole and runs past its edges.
  const box: Box = { w: 988, h: 60 };
  const ink = new LayerInk(splatOf(13), [], box);
  const b = brushOf(BRUSH_PX, box);
  for (let y = 0; y <= 1.0001; y += (BRUSH_PX * 0.7) / box.h) ink.wash([[0, Math.min(1, y)], [1, Math.min(1, y)]], b.width, b.aspect);
  assert.ok(ink.washed > 0.97, `washed ${ink.washed}`);
  assert.equal(ink.inkSpan(0.5, ROW_PX / 2 / box.h), null, 'and there is nothing left for the sweep to find');
});

test('the share only rises: the sweep, row by row, washes to clean', () => {
  const box: Box = { w: 988, h: 8 * ROW_PX };
  const ink = new LayerInk(splatOf(12), [], box);
  const rows = bandsOf(box);
  assert.equal(rows.length, 8);
  const b = brushOf(SWEEP_BRUSH_ROWS * ROW_PX, box);
  let s: Sweep = { row: 0, x: 0 };
  let last = 0, prev: Pt | null = null, t = 0;
  while (ink.washed < 0.95 && t < 300) {
    const step = sweepStep(rows, s, 1 / 60, (row) => ink.inkSpan(rows[row]!, ROW_PX / 2 / box.h));
    if (step.idle) break;
    if (prev && step.sweep.row === s.row) ink.wash([prev, step.point], b.width, b.aspect);
    else ink.wash([step.point], b.width, b.aspect);
    prev = step.point;
    s = step.sweep;
    t += 1 / 60;
    assert.ok(ink.washed >= last, 'never falls');
    last = ink.washed;
  }
  assert.ok(ink.washed >= 0.95, `reaches clean (${ink.washed})`);
});

test('a stroke scrubs the top layer that still has ink where it starts', () => {
  const under = new LayerInk(splatOf(21), [], DESK);
  const over = new LayerInk(splatOf(22), [], DESK);
  let spot: Pt | null = null;
  for (let y = 0.3; y < 0.7 && !spot; y += 0.02) for (let x = 0.3; x < 0.7; x += 0.02) if (under.has(x, y) && over.has(x, y)) { spot = [x, y]; break; }
  assert.ok(spot, 'two splats on one post overlap somewhere');
  const b = brushOf(BRUSH_PX * 2, DESK);
  assert.equal(topLayer([under, over], spot[0], spot[1]), 1);
  over.wash([spot], b.width, b.aspect);
  assert.equal(topLayer([under, over], spot[0], spot[1]), 0, 'where the top layer is gone the one under it is scrubbed');
  under.wash([spot], b.width, b.aspect);
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
  ink.wash([[0, cy], [1, cy]], b.width, b.aspect);
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
    const ink = new LayerInk(splatOf(seed), [stroke], box);
    const fresh = new LayerInk(splatOf(seed), [], box);
    // On the path, to half the brush's reach down, every point is washed.
    for (let x = cx - 0.1; x <= cx + 0.1 + 1e-9; x += 0.02) {
      for (const f of [0, 0.5, -0.5]) assert.equal(ink.has(x, cy + f * ry), false, `on the path at ${x.toFixed(2)},${f} on ${label}`);
    }
    // Well past the brush's ellipse (1.5 radii down, 2 across past the ends) a point is as the splat left it, and some of them are ink.
    let ink_beyond = 0;
    const beyond: Pt[] = [];
    for (let x = cx - 0.1; x <= cx + 0.1 + 1e-9; x += 0.02) beyond.push([x, cy + 1.5 * ry], [x, cy - 1.5 * ry]);
    beyond.push([cx - 0.1 - 2 * rx, cy], [cx + 0.1 + 2 * rx, cy]);
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
  // The same shares of the same splat, counted on grids of different cell counts: they agree to within half a point of the layer (the
  // grid's rounding of the band's edges, about 0.0005 apart today), where a brush that ignored the box's shape would be far off.
  assert.ok(Math.abs(share[0]! - share[1]!) < 0.005, `washed share ${share[0]} on the desk, ${share[1]} on the phone`);
});

/* ------------------------------------------------------- the author's pen belongs to its layer ---- */

const penAcross = (box: Box, y: number): Stroke => penIn(box, [[0, y], [0.5, y], [1, y]]);

test('a line under a pen stroke is covered, as the eye finds it covered, and is read once the pen is scrubbed away', () => {
  const y = 0.95;
  const ink = new LayerInk(splatOf(51), [penAcross(DESK, y)], DESK);
  const lines = [{ top: y - 0.01, bottom: y + 0.01, text: 'under the pen' }, { top: 0.02, bottom: 0.04, text: 'clear of it' }];
  assert.deepEqual(coveredLines(lines, [ink]), [true, false]);
  const b = brushOf(BRUSH_PX, DESK);
  ink.wash([[0, y], [1, y]], b.width, b.aspect);
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
  over.wash([[sx, sy]], b.width, b.aspect);
  assert.equal(topLayer([under, inked, over], sx, sy), 1, 'with the layer above washed away, the pen is what is there');
});

test('a pen written over a wash is ink again there, and a wash after it removes it: the strokes are in order', () => {
  const [cx, cy] = heart(55);
  const wash = washIn(DESK, [[cx - 0.05, cy], [cx + 0.05, cy]]);
  const pen = penIn(DESK, [[cx - 0.02, cy], [cx + 0.02, cy]], '#fff');
  const splat = splatOf(55);
  assert.equal(new LayerInk(splat, [wash], DESK).has(cx, cy), false);
  assert.equal(new LayerInk(splat, [wash, pen], DESK).has(cx, cy), true, 'written back');
  assert.equal(new LayerInk(splat, [wash, pen, wash], DESK).has(cx, cy), false, 'and washed again');
});

test('a pen stroke counts in the share washed: ink written back lowers it, and washing it raises it', () => {
  const [cx, cy] = heart(56);
  const wash = washIn(DESK, [[cx - 0.1, cy], [cx + 0.1, cy]], BRUSH_PX * 3);
  const splat = splatOf(56);
  const washedOnly = new LayerInk(splat, [wash], DESK);
  const written = new LayerInk(splat, [wash, penIn(DESK, [[cx - 0.1, cy], [cx + 0.1, cy]], '#fff')], DESK);
  assert.ok(written.washed < washedOnly.washed, `${written.washed} < ${washedOnly.washed}`);
  const b = brushOf(BRUSH_PX * 3, DESK);
  written.wash([[cx - 0.1, cy], [cx + 0.1, cy]], b.width, b.aspect);
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
  ink.wash([[0, y], [1, y]], b.width, b.aspect);
  assert.equal(ink.inkSpan(y, 1 / (2 * box.h / ROW_PX) * 0.1), null, 'swept, it is gone from the row');
});

test('a point has ink as the last stroke over it says, else the splat does: the same answer a pass over every stroke gives, asked again or not', () => {
  const box = PHONE;
  const splat = splatOf(7);
  const strokes: Stroke[] = [];
  let a = 12345;
  const next = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 60; k++) {
    const points: Pt[] = Array.from({ length: 1 + Math.floor(next() * 4) }, () => [next(), next()] as Pt);
    const w = next() < 0.3 ? 0.02 : 0.08;
    const aspect = [0.4, 1, 2.5][Math.floor(next() * 3)]!;
    strokes.push(next() < 0.3 ? { tool: 'ink', color: 'red', width: w * 0.3, aspect, points } : { tool: 'wash', width: w, aspect, points });
  }
  const ink = new LayerInk(splat, strokes, box);
  /* The same strokes, long hand: the latest segment whose ellipse reaches the point decides, else the splat. */
  const brute = (x: number, y: number): boolean => {
    for (let k = strokes.length - 1; k >= 0; k--) {
      const s = strokes[k]!, rx = s.width / 2, ry = (s.width / 2) * s.aspect;
      for (let i = Math.max(1, s.points.length - 1) - 1; i >= 0; i--) {
        const [ax, ay] = s.points[i]!, [bx, by] = s.points[i + 1] ?? s.points[i]!;
        const dx = (bx - ax) / rx, dy = (by - ay) / ry, len2 = dx * dx + dy * dy;
        const px = (x - ax) / rx, py = (y - ay) / ry;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
        if (Math.hypot(t * dx - px, t * dy - py) <= 1) return s.tool === 'ink';
      }
    }
    return covers(splat, box, x, y);
  };
  for (let n = 0; n < 4000; n++) {
    const x = next() * 1.2 - 0.1, y = next() * 1.2 - 0.1;
    assert.equal(ink.has(x, y), brute(x, y), `(${x}, ${y})`);
    assert.equal(ink.has(x, y), brute(x, y), `asked again: (${x}, ${y})`);
  }
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
