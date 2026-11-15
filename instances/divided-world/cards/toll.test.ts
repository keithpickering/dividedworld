/**
 * Toll's own rules: it is used on a post, never cast, and one at a time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { defaults as settings } from '../settings.ts';
import { by, post } from './test-kit.ts';

test('Toll lands on a post through decideUse, is refused by decidePlay, and a second live one is refused', () => {
  const toll = by('toll');
  assert.equal(decideUse(toll, settings, post(10), [], {}, '').ok, true);
  assert.equal(decidePlay(toll, settings, post(10), [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'toll', act: 'k1', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(toll, settings, post(10), live, {}, '').ok, false);
  assert.deepEqual(toll.lasts, { unit: 'week', count: 1 });
});
