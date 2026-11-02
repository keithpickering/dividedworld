/** The shared seeded sequence: the same seed draws the same numbers, a different seed draws others, all in [0, 1). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from './seeded.ts';

test('the same seed draws the same sequence, another seed another, all in [0, 1)', () => {
  const draw = (seed: string) => { const next = seeded(seed); return Array.from({ length: 20 }, () => next()); };
  assert.deepEqual(draw('a:b'), draw('a:b'));
  assert.notDeepEqual(draw('a:b'), draw('a:c'));
  for (const n of draw('x')) assert.ok(n >= 0 && n < 1, String(n));
});
