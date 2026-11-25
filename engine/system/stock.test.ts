import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillStockLine } from './stock.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';

test('a stock line fills its named tokens and the Boss\'s pronoun forms, leaves what it does not know, and is chosen by the pick', () => {
  const lines = ['{asker}, the answer is no. {boss} says {boss.they} {boss.is} done; {unknown} {boss.nope}.', 'Granted.'];
  assert.equal(fillStockLine(lines, 0, { boss: 'Big Bad', asker: 'Ann' }, PRONOUN_PRESETS.she), 'Ann, the answer is no. Big Bad says she is done; {unknown} {boss.nope}.');
  assert.equal(fillStockLine(lines, 3, { boss: 'Big Bad', asker: 'Ann' }, PRONOUN_PRESETS.she), 'Granted.');
  assert.equal(fillStockLine(lines, -1, {}, PRONOUN_PRESETS.it), 'Granted.', 'a pick below zero still lands on a line');
  assert.equal(fillStockLine([], 0, {}, PRONOUN_PRESETS.it), null, 'an instance with no such line says nothing');
});
