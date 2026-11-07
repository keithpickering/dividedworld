/**
 * The old theme column's rows are rewritten into a theme and a mode (the board look plan, Task 15): migrating across
 * supabase/migrations/0103_board_mode.sql turns a stored `system` into the default theme following the device, `light` and `dark` into the
 * default theme in that mode, and any other key into itself with the device's mode. On a database of its own, made here beside the scratch
 * one tools/test-sql.mjs made, from the migrations before 0103 and the test instance's fixtures, because a replay from zero has no rows for
 * the migration's UPDATE to rewrite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scratchUrl } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = path.join(root, 'supabase/migrations');
const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('stored themes system, light, dark and an instance\'s own become a theme and a mode', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_mode`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    const all = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
    assert.ok(all.includes('0103_board_mode.sql'), 'the migration this holds is there');
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of all.filter((f) => f < '0103')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8'));
    // Before: one account per stored theme, the old column mixing the house theme in a mode with the instance's own keys.
    psqlOn(db.toString(), `
      do $$
      begin
        insert into account_preferences (account, theme) values
          (tests.account('mode-s'), 'system'), (tests.account('mode-l'), 'light'), (tests.account('mode-d'), 'dark'), (tests.account('mode-o'), 'dusk');
      end $$;`);
    assert.equal(psqlOn(db.toString(), `select string_agg(theme, ',' order by theme) from account_preferences`), 'dark,dusk,light,system');

    psqlOn(db.toString(), fs.readFileSync(path.join(migrations, '0103_board_mode.sql'), 'utf8'));
    for (const m of all.filter((f) => f > '0103_board_mode.sql')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));

    const after = (label: string) => psqlOn(db.toString(), `select theme || ',' || mode from account_preferences p join auth.users u on u.id = p.account where u.email = '${label}@test.invalid'`);
    assert.equal(after('mode-s'), 'default,system', 'system is the default theme following the device');
    assert.equal(after('mode-l'), 'default,light', 'light is the default theme in light');
    assert.equal(after('mode-d'), 'default,dark', 'dark is the default theme in dark');
    assert.equal(after('mode-o'), 'dusk,system', 'an instance\'s own theme stays, with the device\'s mode');
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
