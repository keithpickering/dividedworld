import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { creaseAt, edgesAt, foldEnd, foldMatrix } from './fold.ts';
import { endJags, tearJag } from './paper.ts';

const apply = (m: readonly number[], [x, y]: readonly [number, number]): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
const near = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);

describe('the corner fold', () => {
  test('a pick all the way up has an upright crease, and the first moment a diagonal one a third of the height in', () => {
    const up = creaseAt(1, 90, 24, 1.5);
    assert.ok(Math.abs(up.n[1]) < 1e-9, `n = ${up.n}`);
    near(up.n[0], -1, 'upright normal points at the end');
    near(up.A[0], 1.5 + (24 * 1.24) / Math.SQRT2, 'upright crease');
    near(up.A[1], 0, 'on the top edge');
    const first = creaseAt(0, 90, 24, 1.5);
    near(first.n[0], -Math.SQRT1_2, 'a diagonal normal');
    near(first.n[1], -Math.SQRT1_2, 'a diagonal normal');
    near(first.A[0] - 1.5, 24 * 0.34, 'a third of the height from the end');
    assert.ok(Math.abs((first.A[0] - 1.5) / 24 - 1 / 3) < 0.01);
  });

  test('the turn grows from 110 to 150 degrees, in radians', () => {
    near(creaseAt(0, 90, 24, 0).angle, (110 * Math.PI) / 180, 'first');
    near(creaseAt(1, 90, 24, 0).angle, (150 * Math.PI) / 180, 'up');
  });

  test('the crease stays where it is: a point on it maps to itself, a point d inside the corner lands d cos(angle) from it', () => {
    for (const t of [0, 0.3, 0.6, 1]) {
      const c = creaseAt(t, 90, 24, 2);
      const m = foldMatrix(c);
      const tangent: [number, number] = [-c.n[1], c.n[0]];
      for (const s of [-30, 0, 11, 40]) {
        const p: [number, number] = [c.A[0] + tangent[0] * s, c.A[1] + tangent[1] * s];
        const [x, y] = apply(m, p);
        near(x, p[0], `t=${t} crease x`);
        near(y, p[1], `t=${t} crease y`);
      }
      const d = 7;
      const [x, y] = apply(m, [c.A[0] + c.n[0] * d, c.A[1] + c.n[1] * d]);
      const away = (x - c.A[0]) * c.n[0] + (y - c.A[1]) * c.n[1];
      near(away, d * Math.cos(c.angle), `t=${t} lands d cos(angle) from the crease`);
      assert.ok(away < 0, 'past 90 degrees it lies back over the tape');
    }
  });
});

describe('the end the fold comes from', () => {
  const W = 90, H = 24, seed = 'play:1:0';
  const mean = (j: ReadonlyArray<readonly [number, number]>) => j.reduce((a, [u]) => a + u, 0) / j.length;

  test('the right end folds with its own jag, mirrored into the frame, not the left one', () => {
    const left = foldEnd('a', 0, 0, W, H, seed), right = foldEnd('b', W, 0, W, H, seed);
    assert.notDeepEqual(left.map(([u]) => u), right.map(([u]) => u));
    const own = endJags(seed, W, H).right;
    assert.deepEqual(right.map(([u]) => u), own.map(([x]) => W - x));
    assert.deepEqual(right.map(([, y]) => y), own.map(([, y]) => y));
    assert.ok(right.every(([u]) => u >= 0 && u <= 4.1), 'it runs into the tape from the end');
  });

  test('a tear inside the piece folds with the torn outline the body is cut by, and a peel line with a straight cut', () => {
    const torn = foldEnd('a', 40, 2 * 3 + 0, W, H, seed);
    assert.deepEqual(torn, tearJag(seed, 40, H).map(([x, y]) => [x - 40, y]), 'the body\'s own cut, from its edge');
    assert.ok(torn.length > 4 && new Set(torn.map(([u]) => u)).size > 3, 'ragged');
    assert.notDeepEqual(torn.map(([u]) => u), foldEnd('a', 0, 0, W, H, seed).map(([u]) => u));
    const mirrored = foldEnd('b', 60, 0 * 3 + 2, W, H, seed);
    assert.deepEqual(mirrored, tearJag(seed, 60, H).map(([x, y]) => [-(x - 60), y]), 'the right end\'s tear, mirrored into the frame');
    assert.notDeepEqual(mirrored.map(([u]) => u), foldEnd('a', 60, 2 * 3 + 0, W, H, seed).map(([u]) => u), 'not the left tear at the same place');
    assert.deepEqual(foldEnd('a', 40, 1 * 3 + 0, W, H, seed), [[0, 0], [0, H]]);
    assert.ok(Math.abs(mean(torn)) < 1.6);
  });

  test('the picked edge is read from the stretch that has it', () => {
    const stuck = [[0, 30, 1], [50, 90, 2 * 3 + 0]];
    assert.equal(edgesAt(stuck, 'a', 50), 6);
    assert.equal(edgesAt(stuck, 'b', 30), 1);
    assert.equal(edgesAt(stuck, 'a', 0), 1);
  });
});
