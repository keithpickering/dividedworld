/**
 * The database holds a pronoun set where it is written (supabase/migrations/0117_pronouns.sql, `pronouns_hold`), and
 * supabase/tests/0117-pronouns.sql lists, one row per line, a poison at each edge of the rule and the good sets. This reads those two lists and
 * sets them against pronounProblems, so the SQL's rule and the TypeScript rule cannot drift apart without one of the two failing: every poison
 * is refused here, every good is accepted here. (The SQL file asserts the same rows against `pronouns_hold`.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pronounProblems } from './pronouns.ts';

const here = import.meta.dirname;
const read = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8');
const SQL_FILE = '../../supabase/tests/0117-pronouns.sql';

/**
 * The values of one list in the test file, as the file writes them: `('json'),` on a line of its own, the last ending `);`. Every line of
 * the list must be a row, so a row this cannot read fails here rather than going unchecked; a doubled quote is read as one.
 */
export function pronounRows(sql: string, table: 'pronoun_poisons' | 'pronoun_goods'): unknown[] {
  const header = `insert into ${table} (value) values\n`;
  const start = sql.indexOf(header);
  assert.notEqual(start, -1, `the file opens a ${table} list`);
  const rows: unknown[] = [];
  for (const line of sql.slice(start + header.length).split('\n')) {
    const m = /^ {2}\('((?:[^']|'')*)'\)([,;])$/.exec(line);
    assert.ok(m, `every line of the ${table} list is one row on its own: ${JSON.stringify(line)}`);
    rows.push(JSON.parse(m[1]!.replaceAll("''", "'")));
    if (m[2] === ';') return rows;
  }
  assert.fail(`the ${table} list ends with ');'`);
}

export function checkLists(sql: string): void {
  const poisons = pronounRows(sql, 'pronoun_poisons');
  const goods = pronounRows(sql, 'pronoun_goods');
  assert.ok(poisons.length >= 40, 'the poison list has its rows');
  assert.ok(goods.length >= 10, 'the good list has its rows');
  for (const p of poisons) assert.ok(pronounProblems(p).length > 0, `${JSON.stringify(p)} is refused by pronounProblems`);
  for (const g of goods) assert.deepEqual(pronounProblems(g), [], `${JSON.stringify(g)} is accepted by pronounProblems`);
}

test('every poison in the SQL test fails pronounProblems and every good passes it', () => {
  checkLists(read(SQL_FILE));
});

test('the lists cover the rule: the length bound, a bare separator, a combining mark first, a missing key, an extra key, a plural that is not a boolean', () => {
  const poisons = pronounRows(read(SQL_FILE), 'pronoun_poisons').map((p) => JSON.stringify(p));
  const has = (re: RegExp) => assert.ok(poisons.some((p) => re.test(p)), `a poison matches ${re}`);
  has(/abcdefghijklm/);
  has(/"subject":"-a"/);
  has(/"subject":"a-"/);
  has(/"subject":"\u0301a"/);
  has(/"plural":"yes"/);
  has(/"extra"/);
  assert.ok(poisons.some((p) => !p.includes('"plural"')), 'a poison with no plural');
});

test('the checks go red: a poison the TypeScript accepts, a good it refuses, and a row it cannot read', () => {
  const sql = read(SQL_FILE);
  const harmless = sql.replace('insert into pronoun_poisons (value) values\n', `insert into pronoun_poisons (value) values\n  ('{"subject": "he", "object": "him", "determiner": "his", "possessive": "his", "reflexive": "himself", "plural": false}'),\n`);
  assert.notEqual(harmless, sql);
  assert.throws(() => checkLists(harmless), /is refused by pronounProblems/);
  const spoiled = sql.replace('insert into pronoun_goods (value) values\n', `insert into pronoun_goods (value) values\n  ('{"subject": "abcdefghijklm", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),\n`);
  assert.throws(() => checkLists(spoiled), /is accepted by pronounProblems/);
  const commented = sql.replace('insert into pronoun_goods (value) values\n', 'insert into pronoun_goods (value) values\n  (\'{}\'), -- a comment\n');
  assert.throws(() => checkLists(commented), /every line of the pronoun_goods list is one row/);
});
