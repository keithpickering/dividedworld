/**
 * Whoops!'s scrubbing, the pure half (design section 11; cards plan Task 5): the fixed layout's
 * arithmetic, what a stroke leaves of a layer, which layer a stroke scrubs, the bounds a saved stroke
 * keeps to, the accessible sweep's pace, and which lines of text lie under ink.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRUSH, LayerInk, ROW, SWEEP_BRUSH, SWEEP_SPEED, bandsOf, coveredLines, fits, fitStroke, layoutOf, sweepStep, toLayout, topLayer, type Pt, type Stroke, type Sweep } from './scrub.ts';
import { covers, makeSplat } from './splat.ts';
import { whoops, STROKES } from '../whoops.ts';

const HEIGHT = 8;
/** The post's own box: the only ink a stroke can reach. */
const BOX = { minX: 0, maxX: 1, minY: 0, maxY: HEIGHT };
const splatOf = (seed: number) => makeSplat(seed);

test('the layout is 360px scaled to the frame, never scaled up, and centered', () => {
  assert.deepEqual(layoutOf(360), { scale: 1, width: 360, offset: 0 });
  const wide = layoutOf(900);
  assert.equal(wide.scale, 1);
  assert.equal(wide.width, 360);
  assert.equal(wide.offset, 270);
  const narrow = layoutOf(320);
  assert.ok(Math.abs(narrow.scale - 320 / 360) < 1e-9);
  assert.equal(narrow.offset, 0);
});

test('a point on the screen is in widths of the layout, the same words at any screen width', () => {
  // The same spot of the layout: its quarter across and half a width down.
  for (const frame of [320, 360, 620, 1000]) {
    const l = layoutOf(frame);
    const [x, y] = toLayout([l.offset + 0.25 * l.width, 0.5 * l.width], frame);
    assert.ok(Math.abs(x - 0.25) < 1e-9 && Math.abs(y - 0.5) < 1e-9, `at ${frame}px`);
  }
});

test('a wash leaves a layer without ink along its path and nowhere else', () => {
  const splat = splatOf(11);
  const { cx, cy } = splat.placement;
  const ink = new LayerInk(splat, []);
  assert.equal(ink.has(cx, cy), true);
  assert.equal(ink.washed, 0);
  ink.wash([[cx - 0.1, cy], [cx + 0.1, cy]], BRUSH);
  assert.equal(ink.has(cx, cy), false);
  assert.equal(ink.has(cx + 0.1, cy), false, 'a brush is round at its ends');
  assert.equal(ink.has(cx, cy + 0.2), covers(splat, cx, cy + 0.2), 'a spot the brush did not reach is as it was');
  assert.ok(ink.washed > 0 && ink.washed < 0.2);
  assert.equal(new LayerInk(splat, [{ tool: 'wash', width: BRUSH, points: [[cx - 0.1, cy], [cx + 0.1, cy]] }]).has(cx, cy), false, 'a saved stroke washes as a fresh one does');
});

test('washing the whole splat row by row reaches clean, and the share only rises', () => {
  const splat = splatOf(12);
  const ink = new LayerInk(splat, []);
  let last = 0;
  for (let y = splat.bounds.minY; y <= splat.bounds.maxY; y += BRUSH * 0.9) {
    ink.wash([[splat.bounds.minX, y], [splat.bounds.maxX, y]], BRUSH);
    assert.ok(ink.washed >= last);
    last = ink.washed;
  }
  assert.ok(ink.washed > 0.97, `washed ${ink.washed}`);
});

test('ink that runs past the post\'s box, where no stroke can reach, is not counted: washing the box clean is clean', () => {
  // A one-line post: the blob runs far below it, into the margin.
  const splat = makeSplat(13);
  assert.ok(splat.bounds.maxY > 0.3, 'the splat runs past the post');
  const box = { minX: 0, maxX: 1, minY: 0, maxY: 0.1 };
  const ink = new LayerInk(splat, [], box);
  for (let y = 0.0; y <= 0.1; y += BRUSH * 0.7) ink.wash([[0, y], [1, y]], BRUSH);
  assert.ok(ink.washed > 0.97, `washed ${ink.washed}`);
  assert.equal(new LayerInk(splat, []).washed < 0.5, true, 'counted whole, the same strokes would leave most of it');
  assert.equal(ink.inkSpan(0.05, ROW / 2), null, 'and there is nothing left for the sweep to find');
});

test('a stroke scrubs the top layer that still has ink where it starts', () => {
  const under = new LayerInk(splatOf(21), []);
  const over = new LayerInk(splatOf(22), []);
  // A point both splats cover, if there is one in the middle of the post.
  let spot: [number, number] | null = null;
  for (let y = 0; y < 3 && !spot; y += 0.05) for (let x = 0.2; x < 0.8; x += 0.05) if (under.has(x, y) && over.has(x, y)) { spot = [x, y]; break; }
  assert.ok(spot, 'two splats on one post overlap somewhere');
  assert.equal(topLayer([under, over], spot[0], spot[1]), 1);
  over.wash([[spot[0], spot[1]]], BRUSH * 2);
  assert.equal(topLayer([under, over], spot[0], spot[1]), 0, 'where the top layer is gone the one under it is scrubbed');
  under.wash([[spot[0], spot[1]]], BRUSH * 2);
  assert.equal(topLayer([under, over], spot[0], spot[1]), -1);
  assert.equal(topLayer([under, null, over], spot[0], spot[1]), -1, 'a layer that is clean is not there');
});

test('a stroke is kept to what the card\'s rules take, however long the drag', () => {
  const long: Stroke = { tool: 'wash', width: BRUSH, points: Array.from({ length: 1700 }, (_, i): [number, number] => [(i % 100) / 100, 1 + Math.floor(i / 100) * 0.02]) };
  const kept = fitStroke(long);
  assert.ok(kept.length >= 2, 'a long drag is several strokes');
  assert.ok(kept.every((s) => s.points.length <= STROKES.points));
  assert.equal(kept.flatMap((s) => s.points).length >= 1700 / 4, true, 'and loses no stretch of it');
  const wild: Stroke = { tool: 'wash', width: BRUSH, points: [[-0.3, -2], [1.4, 90], [0.5, 0.5]] };
  const [only] = fitStroke(wild);
  assert.deepEqual(only!.points, [[0, 0], [1, 64], [0.5, 0.5]], 'ink that runs into the margins is kept at their edge');
  const validated = whoops.validateState!({ strokes: [...kept, only] });
  assert.equal(validated.ok, true, validated.ok ? '' : validated.why);
});

test('a layer\'s strokes fit while they are within the card\'s counts, and not past them', () => {
  const stroke = (n: number): Stroke => ({ tool: 'wash', width: BRUSH, points: Array.from({ length: n }, (_, i): [number, number] => [i / n, 1]) });
  assert.equal(fits(Array.from({ length: STROKES.most }, () => stroke(10))), true);
  assert.equal(fits(Array.from({ length: STROKES.most + 1 }, () => stroke(1))), false);
  assert.equal(fits(Array.from({ length: 25 }, () => stroke(STROKES.points))), false, 'more points in all than the card keeps');
});

test('the sweep goes line by line at 0.55 widths a second, a line at a time and never all at once', () => {
  const rows = bandsOf(1);
  assert.equal(rows.length, Math.round(1 / ROW));
  let s: Sweep = { row: 0, x: 0 };
  const dt = 1 / 60;
  let t = 0;
  while (s.row === 0 && t < 5) { ({ sweep: s } = sweepStep(rows, s, dt)); t += dt; }
  assert.ok(Math.abs(t - 1 / SWEEP_SPEED) < 0.05, `a line takes ${t}s`);
  assert.equal(s.row, 1);
  assert.ok(s.x < 0.05, 'the next line starts at its left');
  // After the last line it goes round again.
  let last: Sweep = { row: rows.length - 1, x: 0.99 };
  ({ sweep: last } = sweepStep(rows, last, 0.1));
  assert.equal(last.row, 0);
});

test('a hand-paced sweep clears a layer in about the time a hand takes, not at once and not forever', () => {
  const splat = splatOf(31);
  const ink = new LayerInk(splat, [], BOX);
  const rows = bandsOf(HEIGHT);
  let s: Sweep = { row: 0, x: 0 };
  const dt = 1 / 60;
  let t = 0;
  let last: Pt | null = null;
  while (ink.washed < 0.95 && t < 600) {
    const step = sweepStep(rows, s, dt, (row) => ink.inkSpan(rows[row]!, ROW / 2));
    if (step.idle) break;
    if (last && step.sweep.row === s.row) ink.wash([last, step.point], SWEEP_BRUSH);
    else ink.wash([step.point], SWEEP_BRUSH);
    last = step.point;
    s = step.sweep;
    t += dt;
  }
  assert.ok(ink.washed >= 0.95, `it reaches clean (${ink.washed})`);

  // A hand scrubs the same splat back and forth at a brisk 1.5 widths a second, its rows a brush apart, where there is ink.
  const hand = new LayerInk(splat, [], BOX);
  let path = 0;
  for (let y = splat.bounds.minY, flip = false; y <= splat.bounds.maxY; y += BRUSH * 0.9, flip = !flip) {
    const span = hand.inkSpan(y, BRUSH / 2);
    if (!span) continue;
    hand.wash(flip ? [[span[1], y], [span[0], y]] : [[span[0], y], [span[1], y]], BRUSH);
    path += span[1] - span[0];
  }
  const handTime = path / 1.5;
  assert.ok(hand.washed >= 0.95, 'the hand reaches clean too');
  assert.ok(t > handTime / 2 && t < handTime * 3, `the sweep takes ${t.toFixed(1)}s where a hand takes ${handTime.toFixed(1)}s`);
  assert.ok(t > 8 && t < 60, `a layer takes ${t.toFixed(1)}s of sweeping`);
});

test('a line of text is covered when the ink over it is most of its length, and read once it is not', () => {
  const splat = splatOf(41);
  const { cy } = splat.placement;
  const ink = new LayerInk(splat, []);
  const lines = [
    { top: -3, bottom: -2.95, text: 'far above any ink' },
    { top: cy - 0.025, bottom: cy + 0.025, text: 'through the heart of it' },
  ];
  assert.deepEqual(coveredLines(lines, [ink]), [false, true]);
  ink.wash([[-0.2, cy], [1.2, cy]], BRUSH * 1.5);
  assert.deepEqual(coveredLines(lines, [ink]), [false, false], 'washed, the line is read');
  assert.deepEqual(coveredLines(lines, [null, null]), [false, false], 'clean layers cover nothing');
});
