/**
 * Steel Chair's thrown object: a play's object is rolled from its id alone, so it is one answer for every reader and every replay. The shares
 * are held to the table's weights over many ids, and four ids are hard-coded (one per object) so a change to the hash or the salt is a named failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTS, objectOf, type ThrownObject } from './objects.ts';

test('the weights sum to 1000 and the table runs chair, can, ladder, extinguisher', () => {
  assert.deepEqual(OBJECTS.map((o) => o.object), ['chair', 'can', 'ladder', 'extinguisher']);
  assert.deepEqual(OBJECTS.map((o) => o.weight), [900, 40, 40, 20]);
  assert.equal(OBJECTS.reduce((sum, o) => sum + o.weight, 0), 1000);
  assert.ok(Object.isFrozen(OBJECTS));
});

test('over 100000 ids the shares are within half a point of 90, 4, 4 and 2 percent', () => {
  const N = 100000;
  const count: Record<ThrownObject, number> = { chair: 0, can: 0, ladder: 0, extinguisher: 0 };
  for (let i = 0; i < N; i++) count[objectOf(`play-${i}`)]++;
  const want: Record<ThrownObject, number> = { chair: 90, can: 4, ladder: 4, extinguisher: 2 };
  for (const o of Object.keys(want) as ThrownObject[]) {
    assert.ok(Math.abs((count[o] / N) * 100 - want[o]) < 0.5, `${o} is ${(count[o] / N) * 100}% of plays, not near ${want[o]}%`);
  }
});

test('a play is the same object each time it is asked', () => {
  for (const id of ['play-0', 'play-7', 'abc', 'e1c4-uuid']) assert.equal(objectOf(id), objectOf(id));
});

test('four known ids give each object (a change to the hash or the salt shows up here)', () => {
  assert.equal(objectOf('play-0'), 'chair');
  assert.equal(objectOf('play-6'), 'can');
  assert.equal(objectOf('play-2'), 'ladder');
  assert.equal(objectOf('play-93'), 'extinguisher');
});
