import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_KEYS, OWED_KEYS, STOCK_LINE_KEYS, STOCK_LINE_TOKENS, repairLandingLine, stockLinesOf } from './stock.ts';
import { testSystem } from '../rules/test-system.ts';
import type { SystemContent } from '../rules/types.ts';

const own = Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, [`Own ${k}.`]])) as unknown as SystemContent['stockLines'];
const system: SystemContent = {
  ...testSystem,
  roster: testSystem.roster.map((p) => (p.key === 'bot-a' ? { ...p, stockLines: own } : p)),
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, [`Instance ${k}.`]])) as unknown as SystemContent['stockLines'],
};

test('stockLinesOf gives the roster persona\'s list for a roster key, and the instance\'s for any other', () => {
  assert.deepEqual(stockLinesOf(system, 'bot-a', 'moveMet'), ['Own moveMet.']);
  assert.deepEqual(stockLinesOf(system, 'ghost', 'moveMet'), ['Instance moveMet.']);
});

test('the owed and landing keys are standing orders', () => {
  assert.deepEqual([...OWED_KEYS], ['moveMet', 'moveExpired', 'moveUnmet', 'moveSuperseded', 'moveReversed', 'moveOverturned', 'requestLapsed', 'bossArrival']);
  assert.deepEqual([...LANDING_KEYS], ['moveLanded', 'ruleSet']);
  for (const k of [...OWED_KEYS, ...LANDING_KEYS]) assert.ok(STOCK_LINE_KEYS.includes(k), k);
});

test('repairLandingLine: cut at a sentence to 280 and recorded, foreign tokens stripped and recorded, blank and non-text none', () => {
  const long = repairLandingLine('A sentence here. '.repeat(40), 'moveLanded');
  assert.ok(long.line !== null && long.line.length <= 280 && long.line.endsWith('.'), String(long.line?.length));
  assert.deepEqual(long.trims, [{ path: 'line', predicate: 'maxLength(280)', before: 17 * 40 - 1, after: long.line!.length }]);

  const foreign = repairLandingLine('Hear {appellant}: {move} stands, {rule} too, {mod.they} said.', 'moveLanded');
  assert.equal(foreign.line, 'Hear appellant: {move} stands, rule too, mod.they said.');
  assert.deepEqual(foreign.trims, [{ path: 'line', predicate: 'tokens(moveLanded)', before: 3, after: 0 }]);

  const rule = repairLandingLine('{rule} on {board}, says {boss.they}.', 'ruleSet');
  assert.equal(rule.line, '{rule} on {board}, says boss.they.');

  assert.deepEqual(repairLandingLine('  \n ', 'ruleSet'), { line: null, trims: [] });
  for (const bad of [5, null, undefined, {}]) assert.deepEqual(repairLandingLine(bad, 'moveLanded'), { line: null, trims: [] });
  assert.deepEqual(repairLandingLine('Fine.', 'moveLanded'), { line: 'Fine.', trims: [] });
});

test('repairLandingLine: a nested brace leaves no token the key is not given, every strip counted', () => {
  const boss = repairLandingLine('{{boss}} rules.', 'moveLanded');
  assert.equal(boss.line, 'boss rules.');
  assert.deepEqual(boss.trims, [{ path: 'line', predicate: 'tokens(moveLanded)', before: 2, after: 0 }]);
  // An allowed token inside stray braces is kept, the outer pair stripped and recorded.
  const move = repairLandingLine('{{move}} lands.', 'moveLanded');
  assert.equal(move.line, '{move} lands.');
  assert.deepEqual(move.trims, [{ path: 'line', predicate: 'tokens(moveLanded)', before: 1, after: 0 }]);
});

test('banEntry is a stock line key, given {mod} and {banned}, and is not an owed key: a ban entry is paid through bans_owed, not lines_owed', () => {
  assert.ok(STOCK_LINE_KEYS.includes('banEntry'));
  assert.deepEqual([...STOCK_LINE_TOKENS.banEntry], ['mod', 'banned']);
  assert.ok(!(OWED_KEYS as readonly string[]).includes('banEntry') && !(LANDING_KEYS as readonly string[]).includes('banEntry'));
  assert.deepEqual(stockLinesOf(system, 'bot-a', 'banEntry'), ['Own banEntry.']);
});
