/**
 * The database holds every setting where it is written (supabase/migrations/0077_settings_held.sql), and
 * supabase/tests/0079-settings-held.sql lists, one row per line, a poison at each edge of each rule and the good default
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

/**
 * The rows of one `values` list in the test file, as the file writes them: `('key', 'json'),` on a line of its own, the last
 * ending `);`. Every line of the list must be a row, so a row this cannot read (a trailing comment, two on a line) fails here
 * rather than going unchecked; a doubled quote inside a value is read as one.
 */
export function listRows(sql: string, table: 'poisons' | 'goods'): Row[] {
  const header = `insert into ${table} (key, value) values\n`;
  const start = sql.indexOf(header);
  assert.notEqual(start, -1, `the file opens a ${table} list`);
  const rows: Row[] = [];
  for (const line of sql.slice(start + header.length).split('\n')) {
    const m = /^ {2}\('([A-Za-z]+)', '((?:[^']|'')*)'\)([,;])$/.exec(line);
    assert.ok(m, `every line of the ${table} list is one row on its own: ${JSON.stringify(line)}`);
    rows.push({ key: m[1]!, value: m[2]!.replaceAll("''", "'") });
    if (m[3] === ';') return rows;
  }
  assert.fail(`the ${table} list ends with ');'`);
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
  checkLists(read('../../supabase/tests/0079-settings-held.sql'));
});

test('the issue\'s own cases are named: presencePollSeconds = 5 and presenceNames = 0', () => {
  const poisons = listRows(read('../../supabase/tests/0079-settings-held.sql'), 'poisons');
  assert.ok(poisons.some((r) => r.key === 'presencePollSeconds' && r.value === '5'));
  assert.ok(poisons.some((r) => r.key === 'presenceNames' && r.value === '0'));
});

test('the kinds the migration lets toastDefaults name are the alert kinds (the lists are one list)', () => {
  // settings_held is redefined by later migrations (0085, 0092), so the list read is the latest migration's that defines it.
  const dir = path.join(here, '../../supabase/migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /function settings_held\b/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).at(-1)!;
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const m = [...sql.matchAll(/kinds text\[\] := array\[((?:'[A-Za-z]+',?\s*)+)\]/g)].at(-1);
  assert.ok(m, 'the migration lists the kinds');
  assert.deepEqual([...m![1]!.matchAll(/'([A-Za-z]+)'/g)].map((k) => k[1]!).sort(), [...ALERT_KINDS].sort());
});

test('the checks go red: a key with no rows in the SQL list, and a poison the TypeScript accepts', () => {
  const sql = read('../../supabase/tests/0079-settings-held.sql');
  const withoutKey = sql.split('\n').filter((l) => !l.startsWith("  ('halving',")).join('\n');
  assert.throws(() => checkLists(withoutKey), /keys of (poisons|goods)/);
  const harmless = sql.replace("insert into poisons (key, value) values\n", "insert into poisons (key, value) values\n  ('walletCap', '600'),\n");
  assert.throws(() => checkLists(harmless), /walletCap = 600 is refused/);
  const commented = sql.replace("  ('presenceNames', '0'),\n", "  ('presenceNames', '0'), -- the issue's own\n");
  assert.notEqual(commented, sql);
  assert.throws(() => checkLists(commented), /every line of the poisons list is one row/);
});
