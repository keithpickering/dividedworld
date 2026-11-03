/**
 * The database holds every setting where it is written (supabase/migrations/0074_settings_held.sql), and
 * supabase/tests/0078-settings-held.sql lists, one row per line, a poison at each edge of each rule and the good default
 * for each key. This reads those two lists and sets them against settingsProblems, so the SQL's holds and the TypeScript
 * rules cannot drift apart without one of the two failing: every key has both kinds of row, every poison is refused here,
 * every good is accepted here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { settingsProblems } from './instance.ts';
import { ALERT_KINDS } from './alerts.ts';
import type { Settings } from './types.ts';

const here = import.meta.dirname;
const read = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8');

type Row = { key: string; value: string };

/** The rows of one `values` list in the test file, as the file writes them: `('key', 'json'),` on a line of its own. */
export function listRows(sql: string, table: 'poisons' | 'goods'): Row[] {
  const start = sql.indexOf(`insert into ${table} (key, value) values`);
  assert.notEqual(start, -1, `the file opens a ${table} list`);
  const end = sql.indexOf(';', start);
  return [...sql.slice(start, end).matchAll(/^\s*\('([A-Za-z]+)', '(.*)'\),?\s*$/gm)].map((m) => ({ key: m[1]!, value: m[2]! }));
}

/** The keys SETTINGS names, as settingsProblems reports them missing from an empty settings. */
export function settingsKeys(): string[] {
  return settingsProblems({} as Settings).map((p) => /^setting "([A-Za-z]+)" is missing$/.exec(p)![1]!).sort();
}

/** A whole settings: the first good of each key (the engine's rules never import an instance's or a screen's test world). */
const wholeFrom = (goods: Row[]): Settings => Object.fromEntries([...goods].reverse().map((r) => [r.key, JSON.parse(r.value)])) as unknown as Settings;

export function checkLists(sql: string): void {
  const keys = settingsKeys();
  assert.ok(keys.length > 40, 'SETTINGS has its keys');
  const poisons = listRows(sql, 'poisons');
  const goods = listRows(sql, 'goods');
  assert.deepEqual([...new Set(poisons.map((r) => r.key))].sort(), keys, 'the keys of poisons are SETTINGS\'s keys');
  assert.deepEqual([...new Set(goods.map((r) => r.key))].sort(), keys, 'the keys of goods are SETTINGS\'s keys');
  const valid = wholeFrom(goods);
  assert.deepEqual(settingsProblems(valid), [], 'the first good of each key makes a whole settings');
  const with_ = (key: string, value: string): Settings => ({ ...valid, [key]: JSON.parse(value) }) as Settings;
  for (const { key, value } of poisons) {
    const problems = settingsProblems(with_(key, value));
    assert.equal(problems.length, 1, `${key} = ${value} is refused by settingsProblems, and by it alone (got ${JSON.stringify(problems)})`);
    assert.ok(problems[0]!.startsWith(`setting "${key}" is `), problems[0]);
  }
  for (const { key, value } of goods) {
    assert.deepEqual(settingsProblems(with_(key, value)), [], `${key} = ${value} is accepted by settingsProblems`);
  }
}

test('the poisons and goods in the SQL test cover every setting, and settingsProblems agrees with each', () => {
  checkLists(read('../../supabase/tests/0078-settings-held.sql'));
});

test('the issue\'s own cases are named: presencePollSeconds = 5 and presenceNames = 0', () => {
  const poisons = listRows(read('../../supabase/tests/0078-settings-held.sql'), 'poisons');
  assert.ok(poisons.some((r) => r.key === 'presencePollSeconds' && r.value === '5'));
  assert.ok(poisons.some((r) => r.key === 'presenceNames' && r.value === '0'));
});

test('the kinds the migration lets toastDefaults name are the alert kinds (the lists are one list)', () => {
  const sql = read('../../supabase/migrations/0074_settings_held.sql');
  const m = /kinds text\[\] := array\[((?:'[A-Za-z]+',?\s*)+)\]/.exec(sql);
  assert.ok(m, 'the migration lists the kinds');
  assert.deepEqual([...m![1]!.matchAll(/'([A-Za-z]+)'/g)].map((k) => k[1]!).sort(), [...ALERT_KINDS].sort());
});

test('the checks go red: a key with no rows in the SQL list, and a poison the TypeScript accepts', () => {
  const sql = read('../../supabase/tests/0078-settings-held.sql');
  const withoutKey = sql.split('\n').filter((l) => !l.startsWith("  ('halving',")).join('\n');
  assert.throws(() => checkLists(withoutKey), /keys of (poisons|goods)/);
  const harmless = sql.replace("insert into poisons (key, value) values\n", "insert into poisons (key, value) values\n  ('walletCap', '600'),\n");
  assert.throws(() => checkLists(harmless), /walletCap = 600 is refused/);
});
