/**
 * The front door's marks (docs/plans/2026-11-27-graffiti-everywhere-plan.md, Task 9): shapes in a group's own units from its center, and
 * the groups and draws made of them, each held to Graffiti's own `validateDraw`.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/front-door/marks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrow, drawOver, glyphs, heart, onImage, onWords, postContent, ring, scribble, washPasses, type Facts, type Shape } from './marks.ts';
import { decodePoints } from '../../cards/whoops/points.ts';
import { graffiti, REACH } from '../../cards/graffiti.ts';
import { whoops } from '../../cards/whoops.ts';

const shapes = (seed?: number): Record<string, Shape> => ({
  arrow: arrow([1, 0.2], [0.25, 0.05], seed), ring: ring([0, 0], 0.2, 0.13, seed), glyphs: glyphs('??', [-0.28, -0.17], 0.3, seed),
  heart: heart([0, 0], 2.6, seed), scribble: scribble({ x0: -0.38, y0: -0.07, x1: 0.38, y1: 0.07 }, seed),
});

test('every shape draws finite points near its own origin, in its group\'s units', () => {
  for (const [name, shape] of Object.entries(shapes())) {
    assert.ok(shape.length > 0, name);
    for (const stroke of shape) for (const [x, y] of stroke) assert.ok(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 3 && Math.abs(y) <= 3, `${name}: ${x}, ${y}`);
  }
  /* A shape is where it was asked to be: a ring is centered on its center and a heart on its. */
  const mid = (pts: [number, number][], k: 0 | 1) => (Math.max(...pts.map((p) => p[k])) + Math.min(...pts.map((p) => p[k]))) / 2;
  const r = ring([0.5, -0.25], 0.2, 0.1).flat();
  assert.ok(Math.abs(mid(r, 0) - 0.5) < 0.05 && Math.abs(mid(r, 1) + 0.25) < 0.05, 'a ring is about its center');
  const h = heart([4, 3], 2).flat();
  assert.ok(Math.abs(mid(h, 0) - 4) < 0.2 && Math.abs(mid(h, 1) - 3) < 0.2, 'a heart is about its center');
});

test('the same seed draws the same strokes, and another seed a different hand', () => {
  assert.deepEqual(shapes(7), shapes(7));
  assert.deepEqual(shapes(), shapes(1));
  assert.notDeepEqual(shapes(7), shapes(8));
});

test('shapes have the strokes their names say', () => {
  assert.equal(arrow([0, 0], [0.7, 0]).length, 3, 'a shaft and two barbs');
  assert.equal(ring([0, 0], 0.3, 0.3).length, 1);
  assert.equal(glyphs('??', [0, 0], 0.2).length, 4, 'a hook and a dot each');
});

test('a heart is about as wide as tall, a question mark narrower than tall, and an arrow\'s barbs lean back of its shaft, with one unit across and down', () => {
  const span = (pts: [number, number][], k: 0 | 1) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  const h = heart([0, 0], 2).flat();
  const ratio = span(h, 0) / span(h, 1);
  assert.ok(ratio > 0.8 && ratio < 1.2, `a heart is about as wide as tall: ${ratio}`);
  assert.ok(Math.abs(span(h, 1) - 2) < 0.2, `a heart is about its size tall: ${span(h, 1)}`);
  const q = glyphs('?', [0, 0], 0.3)[0]!;
  const qr = span(q, 0) / span(q, 1);
  assert.ok(qr > 0.4 && qr < 0.9, `a question mark is narrower than tall: ${qr}`);
  const [, wing] = arrow([0, 0], [0.8, 0], 5);
  const tip = wing![0]!, end = wing![wing!.length - 1]!;
  const back = Math.abs(end[0] - tip[0]), up = Math.abs(end[1] - tip[1]);
  assert.ok(back / up > 1 && back / up < 3, `barbs lean about 0.5 radians back of the shaft: ${back / up}`);
});

const body = 'Hi.\n\n[img]/a.gif[/img]\n\nLet me know what you think!';
const facts: Facts = { version: 'post-1', body, box: { w: 65.9, h: 38.5 }, images: [{ left: 0, top: 6, w: 12.5, h: 25.7 }], words: (at) => [(at % 28) * 0.5, 36] };
const find = (s: string) => postContent(body).text.indexOf(s);
/* The post's picture is a bundled file's root-relative address, which the page makes absolute (engine/ui/front-door/pictures.ts); the marks read it so and name it as written. */
const marks = () => [
  onImage(0, [0.325, 0.326], 12.5, 'red', 'stock', ring([0, 0], 0.2, 0.13, 3), arrow([1, 0.2], [0.25, 0.05], 4)),
  onImage(0, [1, 0.52], 12.5, 'black', 'stock', glyphs('??', [-0.24, -0.15], 0.3, 5)),
  onImage(0, [0.5, 0.8], 12.5, 'black', 'fat', scribble({ x0: -0.38, y0: -0.07, x1: 0.38, y1: 0.07 }, 6)),
  onWords(find('what you think!'), 'what you think!'.length, [9.5, 0.7], 'pink', 'stock', heart([0, 0], 2.6, 7)),
];

test('a draw of marks passes Graffiti\'s validateDraw, with the anchors the post gives', () => {
  const draw = drawOver(facts, ...marks());
  const v = graffiti.surface!.validateDraw(draw);
  assert.equal(v.ok, true, String(!v.ok && v.why));
  const [img, , , words] = draw.groups;
  assert.deepEqual(img!.anchor, { kind: 'image', version: 'post-1', n: 0, src: '/a.gif', nth: 0, x: 0.325, y: 0.326 });
  assert.equal(img!.unit, 'image');
  assert.equal(img!.em, 12.5);
  assert.deepEqual(words!.anchor, { kind: 'text', version: 'post-1', at: find('what you think!'), len: 15, dx: 9.5, dy: 0.7 });
  assert.equal(words!.unit, 'em');
  assert.equal(draw.groups.every((g) => g.at[0] >= 0 && g.at[0] <= 1 && g.at[1] >= 0 && g.at[1] <= 1), true, 'every fallback spot is in the box');
  assert.deepEqual(draw.box, { w: 65.9, h: 38.5 });
});

test('each of onImage, onWords and drawOver alone passes Graffiti\'s validateDraw', () => {
  const ring1 = ring([0, 0], 0.2, 0.13, 3);
  const alone = [onImage(0, [0.5, 0.5], 12.5, 'red', 'stock', ring1), onWords(find('what you think!'), 15, [9.5, 0.7], 'pink', 'stock', heart([0, 0], 2.6, 7))];
  for (const m of alone) {
    const v = graffiti.surface!.validateDraw(drawOver(facts, m));
    assert.equal(v.ok, true, `${m.kind}: ${String(!v.ok && v.why)}`);
  }
  assert.equal(graffiti.surface!.validateDraw(drawOver(facts, ...alone)).ok, true);
});

test('the same marks give the same draw', () => {
  assert.deepEqual(drawOver(facts, ...marks()), drawOver(facts, ...marks()));
});

test('a mark on an image the post does not have, or on words past its text, throws', () => {
  assert.throws(() => drawOver(facts, onImage(3, [0.5, 0.5], 12.5, 'red', 'stock', ring([0, 0], 0.1, 0.1))), /image 3/);
  assert.throws(() => drawOver(facts, onWords(postContent(body).text.length - 2, 5, [0, 0], 'red', 'stock', ring([0, 0], 1, 1))), /words/);
});

test('a drawing over Graffiti\'s bounds throws, and a group reaching past REACH is one validateDraw refuses', () => {
  assert.throws(() => drawOver(facts, ...Array.from({ length: 121 }, () => onImage(0, [0.5, 0.5], 12.5, 'red', 'stock', [[[0, 0]]] as Shape))));
  const far = drawOver(facts, onImage(0, [0.5, 0.5], 12.5, 'red', 'stock', [[[REACH.image + 1, 0]]] as Shape));
  assert.equal(graffiti.surface!.validateDraw(far).ok, false);
});

test('washPasses passes Whoops!\'s validateState, one wash stroke a band', () => {
  const state = washPasses([{ top: 0.1, bottom: 0.3 }, { top: 0.5, bottom: 0.9 }], { aspect: 3.2, width: 0.08, seed: 3 });
  assert.equal(state.strokes.length, 2);
  assert.ok(state.strokes.every((s) => s.tool === 'wash'));
  const v = whoops.validateState!(state);
  assert.equal(v.ok, true, String(!v.ok && v.why));
  assert.deepEqual(washPasses([{ top: 0.1, bottom: 0.3 }], { aspect: 3, width: 0.08, seed: 3 }), washPasses([{ top: 0.1, bottom: 0.3 }], { aspect: 3, width: 0.08, seed: 3 }));
});

test('two question marks are drawn by hand, not stamped: the second is not the first moved across', () => {
  const [hook1, , hook2] = glyphs('??', [0.2, 0.2], 0.2, 5);
  const shift = hook2![0]![0] - hook1![0]![0];
  const moved = hook1!.map(([x, y]) => [x + shift, y]);
  const apart = Math.max(...hook2!.map((p, i) => Math.hypot(p[0] - moved[i]![0]!, p[1] - moved[i]![1]!)));
  assert.ok(apart > 0.005, `the second hook is within ${apart} of the first moved across`);
});

test('a wash band with an edge and a slant stays between its edges and sinks to its right', () => {
  const { strokes } = washPasses([{ top: 0.1, bottom: 0.2, left: 0.3, right: 0.6, slant: 0.2 }], { aspect: 2.8, width: 0.05, seed: 2 });
  const points = decodePoints(strokes[0]!.points)!;
  for (const [x] of points) assert.ok(x >= 0.28 && x <= 0.62, `x ${x} is outside 0.3 to 0.6`);
  const at = (side: 'l' | 'r') => points.filter(([x]) => (side === 'l' ? x < 0.45 : x >= 0.45)).map(([, y]) => y);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(mean(at('r')) - mean(at('l')) > 0.1, 'the right end sits lower than the left');
});

test('a question mark\'s hook stays open: its curl never comes back round to where it began', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const shape = glyphs('??', [0.2, 0.2], 0.2, seed);
    for (const hook of [shape[0]!, shape[2]!]) {
      const [start, end] = [hook[0]!, hook[14]!];
      assert.ok(end[1] - start[1] > 0.02, `seed ${seed}: the curl ends at ${end}, back level with its start ${start}`);
    }
  }
});
