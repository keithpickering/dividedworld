/**
 * Off Day's own rules: the class it names and where it lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardTarget } from '../../../engine/rules/cards.ts';
import { by, post } from './test-kit.ts';

test('Off Day refuses a class the instance lacks and lands on a character', () => {
  const off = by('off-day');
  const character = { reach: 'character' as const, act: 'c1', kind: 'post' as const, length: 0, text: '' } as unknown as CardTarget;
  assert.deepEqual(off.validateConfig({ class: 'face' }), { ok: true, value: { class: 'face' } });
  for (const bad of ['ghost', '', 7, undefined]) assert.equal(off.validateConfig({ class: bad }).ok, false, String(bad));
  assert.equal(off.canApply(character, []).ok, true);
  assert.equal(off.canApply(post(10), []).ok, false, 'not on a post');
  assert.deepEqual(off.validateConfig({ class: 'ghost' }), { ok: false, why: 'choose the class to name' });
  assert.deepEqual(off.validateConfig(null), { ok: false, why: 'choose the class to name' });
  assert.deepEqual(off.lasts, { unit: 'day', count: 2 });
  const chara = { reach: 'character' as const, character: 'c1' };
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'off-day', act: `o${i}`, reach: 'character' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.equal(off.canApply(chara, up(1)).ok, true, 'the next window\'s lands while this one is live');
  assert.deepEqual(off.canApply(chara, up(2)), { ok: false, why: 'this character already carries 2 of that card, the most it takes' });
});
