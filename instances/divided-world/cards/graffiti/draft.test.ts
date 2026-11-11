/**
 * What a drawing in progress is, the pure half (plan Task 10; design sections 2, 6 and 8): the wall's cells from its live Acts, the meter's
 * figures (a stroke over ink already there adds nothing), what is sent, and the bounds a draw keeps to. The toolbar and the drawing on the post
 * are Toolbar.test.tsx's and Compose.test.tsx's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { count } from '../../../../engine/rules/surface.ts';
import { BOUNDS } from '../graffiti.ts';
import { addPoint, engineStrokes, inputOf, meterOf, overWords, paintAct, percent, undo, wallCells, type Draft, type Pt, type Stroke } from './draft.ts';

const stripe = (y: number, cap: Stroke['cap'] = 'fat'): Stroke => ({ can: 'red', cap, aspect: 1.5, points: [[0.05, y], [0.95, y]] });
const freehand = (...strokes: Stroke[]): Draft => ({ kind: 'freehand', strokes });
const wallOf = (...strokes: Stroke[]) => [{ kind: 'draw', payload: { strokes } }];

test('percent is a whole percent of the 100 by 100 grid, rounded down as the screen says it', () => {
  assert.equal(percent(3100), 31);
  assert.equal(percent(3199), 31);
  assert.equal(percent(0), 0);
});

test('the wall\'s cells are its draws less the washes after them, in order', () => {
  const drawn = wallCells(wallOf(stripe(0.5)));
  assert.ok(count(drawn) > 300, 'a fat stripe across a post covers hundreds of cells');
  const washed = wallCells([...wallOf(stripe(0.5)), { kind: 'wash', payload: { strokes: [{ aspect: 1.5, points: [[0, 0.5], [1, 0.5]] }] } }]);
  assert.equal(count(washed), 0, 'a sponge as wide as the stripe takes it all');
  const after = wallCells([{ kind: 'wash', payload: { strokes: [{ aspect: 1.5, points: [[0, 0.5], [1, 0.5]] }] } }, ...wallOf(stripe(0.5))]);
  assert.equal(count(after), count(drawn), 'a draw after a wash is not cut');
});

test('a stroke over ink already on the wall adds nothing to the meter, and one beside it adds its own cells', () => {
  const wall = wallCells(wallOf(stripe(0.5)));
  const same = meterOf(wall, 0, freehand(stripe(0.5)), 4000);
  assert.equal(same.after, same.wall, 'the same stripe is nothing more');
  const beside = meterOf(wall, 0, freehand(stripe(0.5), stripe(0.8)), 4000);
  assert.ok(beside.after > beside.wall);
  assert.equal(beside.wall, count(wall));
  assert.equal(beside.most, 4000);
});

test('over is when the wall with the drawing would pass the limit, and exactly the limit is not over', () => {
  const wall = wallCells(wallOf(stripe(0.5)));
  const m = meterOf(wall, 0, freehand(stripe(0.8)), count(wall));
  assert.equal(m.over, true);
  assert.equal(meterOf(wall, 0, freehand(stripe(0.5)), count(wall)).over, false);
  assert.equal(meterOf(wall, 0, null, 4000).after, count(wall), 'no drawing is nothing more');
});

test('a wall whose strokes are not read yet counts the drawing on top of the cells the server says are covered', () => {
  const m = meterOf(null, 1500, freehand(stripe(0.5)), 4000);
  assert.equal(m.wall, 1500);
  assert.equal(m.after, 1500 + count(wall0(stripe(0.5))));
});
const wall0 = (s: Stroke) => wallCells(wallOf(s));

test('a stencil counts as the cells its strokes cover, the same the server expands', () => {
  const stencil: Draft = { kind: 'stencil', stencil: 'x', can: 'blue', spot: 4 };
  assert.ok(engineStrokes(stencil).length === 2);
  const m = meterOf(wallCells([]), 0, stencil, 4000);
  assert.ok(m.after > 0 && m.after < 1200, 'a third of the width by a third of the height holds at most a ninth of the grid');
});

test('the over words say where the wall would stand and its limit, in whole percents', () => {
  assert.equal(overWords({ wall: 3100, after: 4600, most: 4000, over: true }), 'This tag would take the wall to 46%; its limit is 40%');
  assert.equal(overWords({ wall: 3100, after: 4001, most: 4000, over: true }), 'This tag would take the wall to 41%; its limit is 40%');
});

test('what is sent is the strokes without the marks that join them, or a stencil\'s three names', () => {
  const part: Stroke = { ...stripe(0.3), part: true };
  assert.deepEqual(inputOf(freehand(stripe(0.5), part)), { strokes: [stripe(0.5), stripe(0.3)] });
  assert.deepEqual(inputOf({ kind: 'stencil', stencil: 'crown', can: 'pink', spot: 1 }), { stencil: 'crown', can: 'pink', spot: 1 });
});

test('the painter is given the drawing as a draw Act, and nothing for no drawing', () => {
  assert.equal(paintAct(null), null);
  const act = paintAct(freehand(stripe(0.5)));
  assert.equal(act?.kind, 'draw');
  assert.equal((act?.payload as { strokes: unknown[] }).strokes.length, 1);
  assert.equal((paintAct({ kind: 'stencil', stencil: 'x', can: 'blue', spot: 4 })?.payload as { strokes: unknown[] }).strokes.length, 2);
});

test('a stroke grows by points, and past 300 a stroke goes on in another that starts where it ended', () => {
  const strokes: Stroke[] = [{ can: 'red', cap: 'stock', aspect: 1, points: [[0, 0]] }];
  for (let i = 1; i < BOUNDS.points; i++) assert.equal(addPoint(strokes, [i / 1000, 0]), 'ok');
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points.length, BOUNDS.points);
  assert.equal(addPoint(strokes, [0.5, 0.5]), 'ok');
  assert.equal(strokes.length, 2);
  assert.equal(strokes[1]!.part, true);
  assert.deepEqual(strokes[1]!.points[0], strokes[0]!.points.at(-1));
  assert.deepEqual(strokes[1]!.points.at(-1), [0.5, 0.5]);
});

test('no point is added past 3,000 in all or past 120 strokes, and the answer says which', () => {
  const full = (n: number, each: number): Stroke[] => Array.from({ length: n }, () => ({ can: 'red', cap: 'stock', aspect: 1, points: Array.from({ length: each }, (): Pt => [0.1, 0.1]) }));
  assert.equal(addPoint(full(BOUNDS.totalPoints / BOUNDS.points, BOUNDS.points), [0.2, 0.2]), 'points', '3,000 points in all');
  const many = full(BOUNDS.strokes, 20);
  many[many.length - 1]!.points = full(1, BOUNDS.points)[0]!.points;
  assert.equal(addPoint(many, [0.3, 0.3]), 'strokes', '120 strokes, the last one full');
  assert.equal(addPoint(full(BOUNDS.strokes, 1), [0.2, 0.2]), 'ok', 'a short last stroke still takes a point at 120 strokes');
});

test('Undo takes the last stroke, with the parts that continue it', () => {
  const a = stripe(0.2), b = stripe(0.4), c: Stroke = { ...stripe(0.6), part: true };
  const strokes = [a, b, c];
  undo(strokes);
  assert.deepEqual(strokes, [a]);
  undo(strokes);
  assert.deepEqual(strokes, []);
  undo(strokes);
  assert.deepEqual(strokes, []);
});
