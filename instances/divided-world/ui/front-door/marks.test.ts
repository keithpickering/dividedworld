/**
 * The front door's marks (docs/plans/2026-11-23-wiggler-front-door-plan.md, Task 5): shapes in the cards' own stroke formats.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/front-door/marks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrow, glyphs, heart, ring, scribble, tag, washPasses, type Shape } from './marks.ts';
import { decodePoints } from '../../cards/whoops/points.ts';
import { graffiti } from '../../cards/graffiti.ts';
import { whoops } from '../../cards/whoops.ts';

const shapes = (seed?: number): Record<string, Shape> => ({
  arrow: arrow([0.1, 0.9], [0.9, 0.05], 3, seed), ring: ring([0.5, 0.5], 0.6, 0.6, seed), glyphs: glyphs('??', [0.7, 0.8], 0.3, 3, seed),
  heart: heart([0.9, 0.1], 0.5, 3, seed), scribble: scribble({ x0: 0, y0: 0, x1: 1, y1: 1 }, seed), arrowEdge: arrow([0, 0], [1, 1], 3, seed),
});

test('every shape stays inside the box, even placed at its edge', () => {
  for (const [name, shape] of Object.entries(shapes())) {
    assert.ok(shape.length > 0, name);
    for (const stroke of shape) for (const [x, y] of stroke) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${name}: ${x}, ${y}`);
  }
});

test('the same seed draws the same strokes, and another seed a different hand', () => {
  assert.deepEqual(shapes(7), shapes(7));
  assert.deepEqual(shapes(), shapes(1));
  assert.notDeepEqual(shapes(7), shapes(8));
});

test('shapes have the strokes their names say', () => {
  assert.equal(arrow([0.1, 0.5], [0.8, 0.5], 3).length, 3, 'a shaft and two barbs');
  assert.equal(ring([0.5, 0.5], 0.3, 0.3).length, 1);
  assert.equal(glyphs('??', [0.1, 0.1], 0.2, 3).length, 4, 'a hook and a dot each');
});

test('a heart and a question mark are as proportioned on the page as in the plan, at a post body\'s aspect', () => {
  const span = (pts: [number, number][], k: 0 | 1) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  const h = heart([0.5, 0.5], 0.2, 3).flat();
  const ratio = (span(h, 0) * 3) / span(h, 1);
  assert.ok(ratio > 0.8 && ratio < 1.2, `a heart is about as wide as tall on the page: ${ratio}`);
  const q = glyphs('?', [0.1, 0.1], 0.3, 3)[0]!;
  const qr = (span(q, 0) * 3) / span(q, 1);
  assert.ok(qr > 0.4 && qr < 0.9, `a question mark is narrower than tall on the page: ${qr}`);
  /* An arrow's barbs lean 30 degrees off the shaft on the page, not on the share grid: a level shaft's barbs go back as far as they go up or down. */
  const [, wing] = arrow([0.1, 0.5], [0.8, 0.5], 3, 5);
  const tip = wing![0]!, end = wing![wing!.length - 1]!;
  const back = Math.abs(end[0] - tip[0]) * 3, up = Math.abs(end[1] - tip[1]);
  assert.ok(back / up > 1 && back / up < 3, `barbs lean about 0.5 radians back of the shaft: ${back / up}`);
});

test('a tag passes Graffiti\'s validateDraw', () => {
  const draw = tag('red', 'fat', 3.2, ...Object.values(shapes()));
  const v = graffiti.surface!.validateDraw(draw);
  assert.equal(v.ok, true, String(!v.ok && v.why));
  assert.equal(draw.strokes[0]!.aspect, 3.2);
});

test('a tag over Graffiti\'s bounds throws', () => {
  assert.throws(() => tag('red', 'fat', 3, ...Array.from({ length: 121 }, () => [[[0.5, 0.5]]] as Shape)));
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
  const [hook1, , hook2] = glyphs('??', [0.2, 0.2], 0.2, 1.7, 5);
  const shift = hook2![0]![0] - hook1![0]![0];
  const moved = hook1!.map(([x, y]) => [x + shift, y]);
  const apart = Math.max(...hook2!.map((p, i) => Math.hypot(p[0] - moved[i]![0]!, p[1] - moved[i]![1]!)));
  assert.ok(apart > 0.01, `the second hook is within ${apart} of the first moved across`);
});

test('a wash band with an edge and a slant stays between its edges and sinks to its right', () => {
  const { strokes } = washPasses([{ top: 0.1, bottom: 0.2, left: 0.3, right: 0.6, slant: 0.2 }], { aspect: 2.8, width: 0.05, seed: 2 });
  const points = decodePoints(strokes[0]!.points)!;
  for (const [x] of points) assert.ok(x >= 0.28 && x <= 0.62, `x ${x} is outside 0.3 to 0.6`);
  const at = (side: 'l' | 'r') => points.filter(([x]) => (side === 'l' ? x < 0.45 : x >= 0.45)).map(([, y]) => y);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(mean(at('r')) - mean(at('l')) > 0.1, 'the right end sits lower than the left');
});
