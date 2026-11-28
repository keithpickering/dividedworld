/**
 * What a drawing in progress is, the pure half (plan Task 10; design sections 2, 6 and 8): the wall's cells from its live Acts, the meter's
 * figures (a stroke over ink already there adds nothing), what is sent, and the bounds a draw keeps to. The toolbar and the drawing on the post
 * are Toolbar.test.tsx's and Compose.test.tsx's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintedCount, coatsOf } from '../../../../engine/rules/surface.ts';
import { BOUNDS, COATS, graffiti } from '../graffiti.ts';
import { addPoint, bare, engineStrokes, inputOf, meterOf, overWords, paintAct, percent, undo, wordsOf, type Draft, type Pt, type Stroke, type Tagging } from './draft.ts';

/* Strokes are in px of the post body's box, at 15 px to the em, so Stock is 16.05 px wide and its brush's radius is 8 px. */
const BOX = { w: 600, h: 400 };
const EM = 15;
const stroke = (points: Pt[], cap: Stroke['cap'] = 'stock'): Stroke => ({ can: 'red', cap, points });
const stripe = (y: number, cap: Stroke['cap'] = 'fat'): Stroke => stroke([[30, y], [570, y]], cap);
const freehand = (...strokes: Stroke[]): Draft => ({ kind: 'freehand', strokes });
const nothing = bare(BOX, EM);

/** A post's words on this screen: each word's mark (its left, and the top of its line), in the order `wordsOf` finds them in `text`. */
const TEXT = 'Hello there world, this is a paragraph of words';
const SPOTS: readonly [number, number][] = [[0, 10], [45, 10], [90, 10], [145, 10], [0, 40], [30, 40], [50, 40], [120, 40]];
const tagging = (over: Partial<Tagging> = {}): Tagging => ({
  ...bare(BOX, EM), version: 'v1', text: TEXT,
  words: wordsOf(TEXT).slice(0, SPOTS.length).map((w, i) => ({ ...w, x: SPOTS[i]![0], y: SPOTS[i]![1], h: 21 })),
  ...over,
});
const start = (word: string) => TEXT.indexOf(word);
const group = (input: unknown, i = 0) => (input as { groups: { at: number[]; anchor: Record<string, unknown>; unit: string; em?: number; strokes: { points: number[][] }[] }[] }).groups[i]!;
const groups = (input: unknown) => (input as { groups: unknown[] }).groups.length;
const accepted = (input: unknown) => { const v = graffiti.surface!.validateDraw(input); assert.ok(v.ok, v.ok ? '' : v.why); };

test('percent is a whole percent of the 100 by 100 grid, rounded down as the screen says it', () => {
  assert.equal(percent(3100), 31);
  assert.equal(percent(3199), 31);
  assert.equal(percent(0), 0);
});

test('words are split on whitespace in the visible text, each at its first character', () => {
  assert.deepEqual(wordsOf('  Hi  there\nyou '), [{ start: 2, len: 2 }, { start: 6, len: 5 }, { start: 12, len: 3 }]);
  assert.deepEqual(wordsOf(''), []);
});

/* ---------------------------------------------------------------- the tag's attachment ---- */

/** HELLO: five vertical bars 30 px apart, centered at (100, 25), which is inside "world,". */
const HELLO = freehand(...[40, 70, 100, 130, 160].map((x) => stroke([[x, 10], [x, 40]])));

test('a draft of HELLO over a paragraph tags as one group with a text attachment on the word under its center', () => {
  const input = inputOf(HELLO, tagging());
  accepted(input);
  assert.equal(groups(input), 1, 'five letters 30 px apart are one group');
  assert.deepEqual(group(input).anchor, { kind: 'text', version: 'v1', at: start('world,'), len: 6, dx: 0.67, dy: 1 });
  assert.equal(group(input).unit, 'em');
  assert.deepEqual(group(input).at, [0.1667, 0.0625], 'its center, in shares of the drawer\'s box');
  assert.deepEqual(group(input).strokes[0]!.points, [[-4, -1], [-4, 1]], 'points are ems from the group\'s center');
  assert.deepEqual((input as { box: unknown }).box, { w: 40, h: 26.67 }, 'the drawer\'s box in ems');
});

test('a ring over an image tags as an image attachment in image widths', () => {
  const ring = stroke(Array.from({ length: 17 }, (_, i): Pt => [200 + 40 * Math.cos((i / 16) * 2 * Math.PI), 125 + 40 * Math.sin((i / 16) * 2 * Math.PI)]));
  const input = inputOf(freehand(ring), tagging({ images: [{ src: 'https://x.test/a.png', nth: 0 }], pictures: [{ n: 0, x: 100, y: 50, w: 200, h: 150 }] }));
  accepted(input);
  assert.deepEqual(group(input).anchor, { kind: 'image', version: 'v1', n: 0, src: 'https://x.test/a.png', nth: 0, x: 0.5, y: 0.5 });
  assert.equal(group(input).unit, 'image');
  assert.equal(group(input).em, 13.33, 'how many ems one image width was');
  assert.deepEqual(group(input).strokes[0]!.points[0], [0.2, 0], 'forty px on a 200 px image is 0.2 of its width');
});

test('long strokes over a small image are attached to the box, since the rules take a point only so far from its group\'s center in the image\'s own widths', () => {
  const small = { images: [{ src: 'https://x.test/a.png', nth: 0 }], pictures: [{ n: 0, x: 290, y: 100, w: 20, h: 20 }] };
  const long = freehand(stroke([[0, 110], [600, 110]]));
  const input = inputOf(long, tagging(small));
  accepted(input);
  assert.deepEqual(group(input).anchor, { kind: 'box' }, 'ten image widths either way is 200 px here, and these reach 300');
  assert.equal(group(input).unit, 'em');
  // The same stroke over an image it fits within stays an image group.
  const wide = inputOf(long, tagging({ ...small, pictures: [{ n: 0, x: 200, y: 50, w: 200, h: 120 }] }));
  accepted(wide);
  assert.equal(group(wide).anchor.kind, 'image');
});

test('a tag in the blank space right of the last line attaches to that line\'s last word, with a positive dx', () => {
  const input = inputOf(freehand(stroke([[300, 50], [330, 50]])), tagging());
  accepted(input);
  const a = group(input).anchor as { kind: string; at: number; len: number; dx: number; dy: number };
  assert.equal(a.kind, 'text');
  assert.equal(a.at, start('of'));
  assert.equal(a.len, 2);
  assert.ok(a.dx > 0, `dx ${a.dx}`);
  assert.ok(a.dx > 8, 'it kept how far it was from the word, not the word\'s own start');
});

test('a group nowhere near a word or an image, or drawn where the post\'s version is not known, is attached to the box', () => {
  assert.deepEqual(group(inputOf(HELLO, nothing)).anchor, { kind: 'box' }, 'no words measured');
  assert.deepEqual(group(inputOf(HELLO, tagging({ version: null }))).anchor, { kind: 'box' }, 'no version to name');
  const input = inputOf(HELLO, nothing);
  accepted(input);
  assert.deepEqual(group(input).at, [0.1667, 0.0625]);
});

test('a ring and a mark drawn far from it are two groups, each attached where its own center is', () => {
  const dot = stroke([[400, 250], [410, 250]]);
  const input = inputOf(freehand(stroke([[40, 10], [40, 40]]), dot), tagging());
  accepted(input);
  assert.equal(groups(input), 2);
  assert.equal((group(input, 0).anchor as { at: number }).at, start('Hello'));
  assert.equal(group(input, 1).anchor.kind, 'text', 'the second is beside the last word, since nothing is under it');
});

test('what is sent is the strokes without the marks that join them, grouped, or a stencil\'s three names', () => {
  const part: Stroke = { ...stroke([[40, 40], [40, 60]]), part: true };
  const input = inputOf(freehand(stroke([[40, 10], [40, 40]]), part), nothing);
  assert.deepEqual(group(input).strokes.map((s) => s.points.length), [2, 2]);
  assert.ok(!JSON.stringify(input).includes('part'));
  assert.deepEqual(inputOf({ kind: 'stencil', stencil: 'crown', can: 'pink', spot: 1 }, nothing), { stencil: 'crown', can: 'pink', spot: 1 });
});

/* ---------------------------------------------------------------- the meter ---- */

test('the meter for a draft over existing paint counts the draft\'s own cells in full', () => {
  const alone = meterOf(0, freehand(stripe(200)), 4000, nothing);
  assert.ok(alone.after > 300, 'a fat stripe across a post covers hundreds of cells');
  const over = meterOf(1500, freehand(stripe(200)), 4000, nothing);
  assert.equal(over.wall, 1500);
  assert.equal(over.after, 1500 + alone.after, 'ink over ink already there is no longer free');
  assert.equal(meterOf(1500, null, 4000, nothing).after, 1500, 'no drawing is nothing more');
});

test('the own cells are the ones the server counts: the draft\'s painted cells, framed as the rules frame a draw', () => {
  const draft = freehand(stripe(200), stripe(300, 'skinny'));
  const v = graffiti.surface!.validateDraw(inputOf(draft, nothing));
  assert.ok(v.ok);
  assert.equal(meterOf(0, draft, 4000, nothing).after, paintedCount(coatsOf(v.value.strokes, COATS)));
  assert.deepEqual(engineStrokes(draft, nothing), v.value.strokes);
});

test('over is when the wall with the drawing would pass the limit, and exactly the limit is not over', () => {
  const own = meterOf(0, freehand(stripe(200)), 4000, nothing).after;
  assert.equal(meterOf(100, freehand(stripe(200)), own + 100, nothing).over, false);
  assert.equal(meterOf(101, freehand(stripe(200)), own + 100, nothing).over, true);
});

test('a stencil counts as the cells its strokes cover, the same the server expands', () => {
  const stencil: Draft = { kind: 'stencil', stencil: 'x', can: 'blue', spot: 4 };
  assert.equal(engineStrokes(stencil, nothing).length, 2);
  const m = meterOf(0, stencil, 4000, nothing);
  assert.ok(m.after > 0 && m.after < 1200, 'a third of the width by a third of the height holds at most a ninth of the grid');
});

test('the over words say where the wall would stand and its limit, in whole percents', () => {
  assert.equal(overWords({ wall: 3100, after: 4600, most: 4000, over: true }), 'This tag would take the wall to 46%; its limit is 40%');
  assert.equal(overWords({ wall: 3100, after: 4001, most: 4000, over: true }), 'This tag would take the wall to 41%; its limit is 40%');
});

test('the painter is given the drawing as a draw Act in the new shape, and nothing for no drawing', () => {
  assert.equal(paintAct(null, nothing), null);
  const act = paintAct(freehand(stripe(200)), nothing);
  assert.equal(act?.kind, 'draw');
  assert.equal((act?.payload as { groups: unknown[] }).groups.length, 1);
  assert.equal((paintAct({ kind: 'stencil', stencil: 'x', can: 'blue', spot: 4 }, nothing)?.payload as { groups: { strokes: unknown[] }[] }).groups[0]!.strokes.length, 2);
});

/* ---------------------------------------------------------------- the bounds ---- */

test('a stroke grows by points, and past 300 a stroke goes on in another that starts where it ended', () => {
  const strokes: Stroke[] = [{ can: 'red', cap: 'stock', points: [[0, 0]] }];
  for (let i = 1; i < BOUNDS.points; i++) assert.equal(addPoint(strokes, [i / 10, 0]), 'ok');
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points.length, BOUNDS.points);
  assert.equal(addPoint(strokes, [50, 50]), 'ok');
  assert.equal(strokes.length, 2);
  assert.equal(strokes[1]!.part, true);
  assert.deepEqual(strokes[1]!.points[0], strokes[0]!.points.at(-1));
  assert.deepEqual(strokes[1]!.points.at(-1), [50, 50]);
});

test('no point is added past 3,000 in all or past 120 strokes, and the answer says which', () => {
  const full = (n: number, each: number): Stroke[] => Array.from({ length: n }, () => ({ can: 'red', cap: 'stock', points: Array.from({ length: each }, (): Pt => [10, 10]) }));
  assert.equal(addPoint(full(BOUNDS.totalPoints / BOUNDS.points, BOUNDS.points), [20, 20]), 'points', '3,000 points in all');
  const many = full(BOUNDS.strokes, 20);
  many[many.length - 1]!.points = full(1, BOUNDS.points)[0]!.points;
  assert.equal(addPoint(many, [30, 30]), 'strokes', '120 strokes, the last one full');
  assert.equal(addPoint(full(BOUNDS.strokes, 1), [20, 20]), 'ok', 'a short last stroke still takes a point at 120 strokes');
});

test('Undo takes the last stroke, with the parts that continue it', () => {
  const a = stripe(80), b = stripe(160), c: Stroke = { ...stripe(240), part: true };
  const strokes = [a, b, c];
  undo(strokes);
  assert.deepEqual(strokes, [a]);
  undo(strokes);
  assert.deepEqual(strokes, []);
  undo(strokes);
  assert.deepEqual(strokes, []);
});

/* ---------------------------------------------------------------- the cost of a move ---- */

/** A hatch: parallel diagonal strokes whose boxes overlap and whose cores never touch, the grouping's slowest input (every pair of strokes is measured segment by segment). */
const HATCH_BOX = { w: 3000, h: 3000 };
const hatch = (strokes: number, points: number): Stroke[] =>
  Array.from({ length: strokes }, (_, i) => ({ can: 'red', cap: 'skinny', points: Array.from({ length: points }, (_, j): Pt => [i * 50 + j * 30, j * 30]) }));
/** The segment-distance work something does, as the `Math.hypot` calls it makes: a count, never a clock. */
function hypots<T>(run: () => T): { value: T; calls: number } {
  const real = Math.hypot;
  let calls = 0;
  Math.hypot = (...args: number[]) => { calls++; return real(...args); };
  try { return { value: run(), calls }; } finally { Math.hypot = real; }
}

test('a pointer move on a worst-case hatch does no grouping: the meter and the preview take the strokes finished before it as grouped once', () => {
  const bareBox = bare(HATCH_BOX, EM);
  const strokes = hatch(40, 25);
  const draft = freehand(...strokes);
  const grouping = hypots(() => inputOf(draft, bareBox));
  assert.ok(grouping.calls > 100_000, `the hatch is the grouping's worst case (${grouping.calls} distance calls)`);
  meterOf(0, draft, 100_000, bareBox, true); // the stroke that began: the finished ones are grouped once
  paintAct(draft, bareBox, true);
  strokes.at(-1)!.points.push([2400, 800]); // the pointer moves
  const meter = hypots(() => meterOf(0, draft, 100_000, bareBox, true));
  const preview = hypots(() => paintAct(draft, bareBox, true));
  assert.ok(meter.calls < 5_000, `a move's meter measured ${meter.calls} distances`);
  assert.ok(preview.calls < 5_000, `a move's preview measured ${preview.calls} distances`);
  assert.ok(meter.value.after > 0);
});

test('what the move\'s meter counts is what Tag it sends: it agrees with the server\'s count wherever the live stroke touches none that is finished', () => {
  const strokes = [stripe(100), stripe(300), stroke([[30, 380], [570, 380]])];
  const draft = freehand(...strokes);
  const live = meterOf(0, draft, 4000, nothing, true);
  assert.equal(live.after, meterOf(0, draft, 4000, nothing).after);
  const v = graffiti.surface!.validateDraw(inputOf(draft, nothing));
  assert.ok(v.ok);
  assert.equal(live.after, paintedCount(coatsOf(v.value.strokes, COATS)));
});

test('Tag it\'s payload is grouped in full whatever was asked of the move before it, and a stroke changed since is regrouped', () => {
  const bareBox = bare(HATCH_BOX, EM);
  const far = stroke([[2800, 2800], [2900, 2900]], 'skinny');
  const strokes = [...hatch(3, 5), far];
  const draft = freehand(...strokes);
  const sent = JSON.stringify(inputOf(draft, bareBox));
  meterOf(0, draft, 100_000, bareBox, true);
  paintAct(draft, bareBox, true);
  assert.equal(JSON.stringify(inputOf(draft, bareBox)), sent, 'the cache never reaches what is sent');
  assert.equal(groups(JSON.parse(sent)), 2, 'the hatch is one group and the far stroke another');
  strokes[0]!.points.push([3, 3]); // an earlier stroke changes under the cache
  meterOf(0, draft, 100_000, bareBox, true);
  strokes[3]!.points.push([2950, 2950]);
  assert.notEqual(JSON.stringify(inputOf(draft, bareBox)), sent);
  assert.equal(groups(inputOf(draft, bareBox)), 2);
});
