import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { creaseAt, foldMatrix } from './fold.ts';

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
