/**
 * The five view names are held in three places: `GEAR_VIEWS` here in TypeScript, and in supabase/migrations/0443_gear_views.sql the check on `gear_worn.view` and the
 * `not in (...)` list in `piece_problem`. This reads both lists from the migration and sets each against `GEAR_VIEWS`, so a name changed in one place and not the others
 * fails the build. (`piece_problem`'s words and the pgTAP file supabase/tests/0443-gear-views.sql hold the refusal; this holds only the names.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { GEAR_VIEWS } from './cosmetics.ts';

const MIGRATION = path.join(import.meta.dirname, '../../supabase/migrations/0443_gear_views.sql');

/** The names in the column's check, in the order the migration writes them. */
export function checkedViews(sql: string): string[] {
  const m = /add column view text check \(view in \(([^)]*)\)\)/.exec(sql);
  assert.ok(m, 'the migration adds a view column with a check listing its names');
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

/** The names in `piece_problem`'s `not in (...)` list, in the order the migration writes them. */
export function problemViews(sql: string): string[] {
  const m = /\(p ->> 'view'\) not in \(([^)]*)\)/.exec(sql);
  assert.ok(m, 'the migration\'s piece_problem refuses a view not in a list of names');
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

test('the column\'s check and GEAR_VIEWS hold the same five names', () => {
  assert.deepEqual(checkedViews(fs.readFileSync(MIGRATION, 'utf8')), [...GEAR_VIEWS]);
});

test('piece_problem\'s list and GEAR_VIEWS hold the same five names', () => {
  assert.deepEqual(problemViews(fs.readFileSync(MIGRATION, 'utf8')), [...GEAR_VIEWS]);
});

test('problemViews reads a list and refuses a migration with none', () => {
  assert.deepEqual(problemViews("if (p ->> 'view') not in ('a', 'b') then"), ['a', 'b']);
  assert.throws(() => problemViews('select 1'));
});

test('checkedViews reads a list and refuses a migration with none', () => {
  assert.deepEqual(checkedViews("alter table t add column view text check (view in ('a', 'b'))"), ['a', 'b']);
  assert.throws(() => checkedViews('select 1'));
});
