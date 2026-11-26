import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_KEYS, OWED_KEYS, STOCK_LINE_KEYS, stockLinesOf } from './stock.ts';
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
