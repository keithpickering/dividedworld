import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_KEYS, OWED_KEYS, STOCK_LINE_KEYS, stockLinesOf } from './stock.ts';
import { testSystem } from '../rules/test-system.ts';

const set = (line: string) => Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, [line]])) as unknown as typeof testSystem.stockLines;
const system = { ...testSystem, stockLines: set('Instance.'), roster: [{ ...testSystem.roster[0]!, stockLines: set('Boss A.') }, testSystem.roster[1]!] };

test('a roster persona says its own lines at a key, and any other speaker the instance\'s', () => {
  assert.deepEqual(stockLinesOf(system, 'boss-a', 'moveMet'), ['Boss A.']);
  assert.deepEqual(stockLinesOf(system, 'bot-a', 'moveMet'), ['A line.']);
  assert.deepEqual(stockLinesOf(system, 'nobody', 'moveMet'), ['Instance.']);
});

test('the owed keys and the landing keys are standing orders, and no key is both', () => {
  assert.deepEqual([...OWED_KEYS].sort(), ['bossArrival', 'moveExpired', 'moveMet', 'moveOverturned', 'moveReversed', 'moveSuperseded', 'moveUnmet', 'requestLapsed']);
  assert.deepEqual([...LANDING_KEYS], ['moveLanded', 'ruleSet']);
  for (const k of [...OWED_KEYS, ...LANDING_KEYS]) assert.ok((STOCK_LINE_KEYS as readonly string[]).includes(k), k);
  assert.ok(!OWED_KEYS.some((k) => (LANDING_KEYS as readonly string[]).includes(k)));
});
