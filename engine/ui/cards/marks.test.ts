/** `kindsOf`: the card kinds of a post's plays, in the order each first appears in billing (marks-and-the-lens design, section 1). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { kindsOf, MARKS_NARROW, MARKS_WIDE } from './marks.ts';
import type { CardPlay } from './types.ts';

const play = (id: string, card: string): CardPlay => ({ id, card, layer: 1, caster: null, message: '', config: {}, playedAt: '2026-10-29T12:00:00Z', post: 'p' });

describe('kindsOf', () => {
  test('orders kinds by the first play of each in billing, one entry per kind', () => {
    assert.deepEqual(kindsOf([play('a', 'whoops'), play('b', 'stick'), play('c', 'whoops'), play('d', 'grab'), play('e', 'stick')]), ['whoops', 'stick', 'grab']);
  });
  test('is empty for no plays, and does not reorder a kind by a later play of it', () => {
    assert.deepEqual(kindsOf([]), []);
    assert.deepEqual(kindsOf([play('a', 'b'), play('b', 'a'), play('c', 'b')]), ['b', 'a']);
  });
});

test('a strip draws four marks on a desktop and three on a phone', () => {
  assert.equal(MARKS_WIDE, 4);
  assert.equal(MARKS_NARROW, 3);
});
