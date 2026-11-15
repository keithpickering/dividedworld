/**
 * Mooch's own rules: its quadrant and its four-deep stack.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay } from '../../../engine/rules/cards.ts';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import { defaults as settings } from '../settings.ts';
import { by, post } from './test-kit.ts';

test('Mooch lands with a quadrant, is refused on a quadrant already live and lands on another', () => {
  const mooch = by('mooch');
  const live = [{ card: 'mooch', act: 'k1', quadrant: 'excitedPositive' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.deepEqual(mooch.validateConfig({ quadrant: 'calmPositive' }), { ok: true, value: { quadrant: 'calmPositive' } });
  assert.equal(mooch.validateConfig({}).ok, false, 'no quadrant');
  assert.equal(mooch.validateConfig({ quadrant: 'loud' }).ok, false);
  assert.equal(mooch.canApply(post(10), [], { quadrant: 'excitedPositive' }).ok, true);
  assert.equal(decidePlay(mooch, settings, post(10), live, { quadrant: 'excitedPositive' }, '').ok, false, 'that quadrant is taken');
  assert.equal(decidePlay(mooch, settings, post(10), live, { quadrant: 'calmPositive' }, '').ok, true, 'another lands');
  assert.equal(decidePlay(mooch, settings, post(10), live, {}, '').ok, false, 'a configuration with none is refused');
  assert.deepEqual(mooch.validateConfig({}), { ok: false, why: 'choose the reactions to mooch' });
  assert.deepEqual(mooch.validateConfig({ quadrant: 'loud' }), { ok: false, why: 'choose the reactions to mooch' });
  assert.deepEqual(mooch.lasts, { unit: 'week', count: 1 });
});

test('Mooch stacks four deep, one per quadrant, and a fifth is refused', () => {
  const mooch = by('mooch');
  const up = (n: number) => QUADRANTS.slice(0, n).map((quadrant, i) => ({ card: 'mooch', act: `k${i}`, reach: 'post' as const, quadrant, ends: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.equal(decidePlay(mooch, settings, post(10), up(3), { quadrant: QUADRANTS[3] }, '').ok, true, 'the fourth lands');
  assert.deepEqual(decidePlay(mooch, settings, post(10), up(4), { quadrant: QUADRANTS[0] }, ''), { ok: false, why: 'this post already carries 4 of that card, the most it takes' });
});
