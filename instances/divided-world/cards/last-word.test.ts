/**
 * Last Word's own rules: refused under a live back, one at a time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideUse } from '../../../engine/rules/cards.ts';
import { defaults as settings } from '../settings.ts';
import { by, post } from './test-kit.ts';

test('Last Word is refused on a post with a live back, lands on one without, and a second is refused', () => {
  const lastWord = by('last-word');
  const live = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: null, act: 'b1', faceDown: true, ends: live }], {}, '').ok, false, 'a back is live');
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: null, act: 'b1', faceDown: true, ends: new Date(Date.now() - 1000).toISOString() }], {}, '').ok, true, 'a back that has ended');
  assert.equal(decideUse(lastWord, settings, post(10), [], {}, '').ok, true);
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: 'last-word', act: 'k1', gimmick: lastWord.gimmick, ends: live }], {}, '').ok, false, 'a second');
});
