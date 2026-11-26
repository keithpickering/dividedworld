/**
 * The five view names are held twice: `GEAR_VIEWS` here in TypeScript and the check on `gear_worn.view` in supabase/migrations/0434_gear_views.sql. This reads the
 * migration's list and sets it against `GEAR_VIEWS`, so a name added to one and not the other fails the build. (`piece_problem`'s words in the same migration
 * and the pgTAP file supabase/tests/0434-gear-views.sql hold the refusal; this holds only the names.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { GEAR_VIEWS } from './cosmetics.ts';

const MIGRATION = path.join(import.meta.dirname, '../../supabase/migrations/0434_gear_views.sql');

/** The names in the column's check, in the order the migration writes them. */
export function checkedViews(sql: string): string[] {
  const m = /add column view text check \(view in \(([^)]*)\)\)/.exec(sql);
  assert.ok(m, 'the migration adds a view column with a check listing its names');
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

test('the column\'s check and GEAR_VIEWS hold the same five names', () => {
  assert.deepEqual(checkedViews(fs.readFileSync(MIGRATION, 'utf8')), [...GEAR_VIEWS]);
});

test('checkedViews reads a list and refuses a migration with none', () => {
  assert.deepEqual(checkedViews("alter table t add column view text check (view in ('a', 'b'))"), ['a', 'b']);
  assert.throws(() => checkedViews('select 1'));
});
