import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedAfterPeel } from './peel.ts';

test('the author\'s save after a peel: the places kept in order, and clean once every place is peeled', () => {
  assert.deepEqual(savedAfterPeel([2], 0, 3), { peeled: [0, 2] });
  assert.deepEqual(savedAfterPeel([0, 2], 1, 3), { peeled: [0, 1, 2], clean: true });
  assert.deepEqual(savedAfterPeel([0], 0, 3), { peeled: [0] }, 'a place already peeled is kept once');
});
