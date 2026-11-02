/** The shared seeded sequence: the same seed draws the same numbers, a different seed draws others, all in [0, 1). */
import { expect, test } from 'vitest';
import { seeded } from './seeded.ts';

test('the same seed draws the same sequence, another seed another, all in [0, 1)', () => {
  const draw = (seed: string) => { const next = seeded(seed); return Array.from({ length: 20 }, () => next()); };
  expect(draw('a:b')).toEqual(draw('a:b'));
  expect(draw('a:b')).not.toEqual(draw('a:c'));
  for (const n of draw('x')) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1); }
});
