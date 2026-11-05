/**
 * Divided World's reaction set, exactly as docs/plans/2026-11-05-reaction-set-design.md settled it: the keys, the
 * emoji by code point (so an editor cannot swap in a look-alike), the quadrants, and the picker's order within each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUADRANTS } from '../../engine/rules/types.ts';
import { reactions } from './reactions.ts';

const SET = [
  ['fire', '\u{1F525}', 'excitedPositive'],
  ['heart', '\u{2764}\u{FE0F}', 'excitedPositive'],
  ['laughing', '\u{1F602}', 'excitedPositive'],
  ['hundred-points', '\u{1F4AF}', 'excitedPositive'],
  ['tomato', '\u{1F345}', 'excitedNegative'],
  ['vomiting', '\u{1F92E}', 'excitedNegative'],
  ['cursing', '\u{1F92C}', 'excitedNegative'],
  ['thumbs-down', '\u{1F44E}', 'excitedNegative'],
  ['thumbs-up', '\u{1F44D}', 'calmPositive'],
  ['folded-hands', '\u{1F64F}', 'calmPositive'],
  ['salute', '\u{1FAE1}', 'calmPositive'],
  ['light-bulb', '\u{1F4A1}', 'calmPositive'],
  ['facepalm', '\u{1F926}', 'boredNegative'],
  ['eye-roll', '\u{1F644}', 'boredNegative'],
  ['crickets', '\u{1F997}', 'boredNegative'],
  ['yawn', '\u{1F971}', 'boredNegative'],
];

test('the set is the design\'s sixteen, by key, code point and quadrant, in the picker\'s order', () => {
  assert.deepEqual(reactions.map((r) => [r.key, r.emoji, r.quadrant]), SET);
});

test('each quadrant holds four', () => {
  for (const q of QUADRANTS) assert.equal(reactions.filter((r) => r.quadrant === q).length, 4, q);
});

test('no emoji repeats', () => {
  assert.equal(new Set(reactions.map((r) => r.emoji)).size, reactions.length);
});
