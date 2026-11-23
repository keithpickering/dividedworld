/**
 * The front door's marks (docs/plans/2026-11-23-wiggler-front-door-plan.md, Task 5): shapes in the cards' own stroke formats.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/front-door/marks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrow, glyphs, heart, ring, scribble, tag, washPasses, type Shape } from './marks.ts';
import { graffiti } from '../../cards/graffiti.ts';
import { whoops } from '../../cards/whoops.ts';

const shapes = (seed?: number): Record<string, Shape> => ({
  arrow: arrow([0.1, 0.9], [0.9, 0.05], seed), ring: ring([0.5, 0.5], 0.6, 0.6, seed), glyphs: glyphs('??', [0.7, 0.8], 0.3, seed),
  heart: heart([0.9, 0.1], 0.5, seed), scribble: scribble({ x0: 0, y0: 0, x1: 1, y1: 1 }, seed), arrowEdge: arrow([0, 0], [1, 1], seed),
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
  assert.equal(arrow([0.1, 0.5], [0.8, 0.5]).length, 3, 'a shaft and two barbs');
  assert.equal(ring([0.5, 0.5], 0.3, 0.3).length, 1);
  assert.equal(glyphs('??', [0.1, 0.1], 0.2).length, 4, 'a hook and a dot each');
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
