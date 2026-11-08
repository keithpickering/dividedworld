/**
 * The office log keeps what staff_changes held (the staff roster plan, Task 2): migrating across supabase/migrations/0082_offices.sql
 * copies every row of `staff_changes`, in order, with its move_act and its cause (a row with a move_act is a `move`, any other the
 * `seed`), `on_staff` true as `mod` and false as `member`; every `boss` and `bot` character becomes a `persona` with its key, its Acts
 * and its profile as they were; and the old table is gone. On a database of its own, made here beside the scratch one tools/test-sql.mjs
 * made, from the migrations before 0082 and the test instance's fixtures.
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

test('a staff_changes row becomes an office row, in order, with its move_act and cause; every boss and bot becomes a persona', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_offices`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    const all = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
    assert.ok(all.includes('0082_offices.sql'), 'the migration this holds is there');
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of all.filter((f) => f < '0082')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8'));
    // Before: a Boss and two Mod Bots with profiles and Acts; a hire and a fire with a move, a seed hire, a fire with no move, and
    // several rows for one bot so that their order matters. Rows are planted out of key order, so only `id` can sort them.
    psqlOn(db.toString(), `
      do $$
      declare
        t uuid := tests.thread();
        boss uuid; bot_a uuid; bot_b uuid; hire uuid; fire uuid;
      begin
        insert into characters (name, staff, staff_kind, debuted_at) values ('Old Boss', 'old-boss', 'boss', now()) returning id into boss;
        insert into characters (name, staff, staff_kind, debuted_at) values ('Bot A', 'bot-a', 'bot', now()) returning id into bot_a;
        insert into characters (name, staff, staff_kind, debuted_at) values ('Bot B', 'bot-b', 'bot', now()) returning id into bot_b;
        insert into character_profiles (character, title, signature) values (boss, 'The Boss', 'sig boss'), (bot_a, 'Mod Bot', 'sig a'), (bot_b, 'Mod Bot', 'sig b')
          on conflict (character) do update set title = excluded.title, signature = excluded.signature;
        perform set_config('kayfabb.staff_writer', 'on', true);
        perform tests.act(boss, 'post', t, '{"body": "hello"}');
        hire := tests.act(boss, 'post', t, '{"body": "a hire"}');
        fire := tests.act(boss, 'post', t, '{"body": "a fire"}');
        perform set_config('kayfabb.staff_writer', '', true);
        insert into staff_changes (staff, on_staff, at, move_act) values
          ('bot-b', true,  '2000-01-01', null),
          ('bot-a', true,  '2000-01-02', null),
          ('bot-a', false, '2000-01-03', fire),
          ('bot-a', true,  '2000-01-04', hire),
          ('bot-b', false, '2000-01-05', null),
          ('bot-a', false, '2000-01-06', fire);
      end $$;`);
    const rowsBefore = psqlOn(db.toString(), `select string_agg(staff || ':' || coalesce(move_act::text, '-') || ':' || at::date, ',' order by id) from staff_changes`);
    const keep = `select (select string_agg(to_jsonb(a)::text, ',' order by a.seq) from acts a) || '|' || (select string_agg((to_jsonb(p) - 'pronouns')::text, ',' order by p.character) from character_profiles p)
      || '|' || (select string_agg(c.staff || ':' || c.name || ':' || c.debuted_at::text, ',' order by c.staff) from characters c where c.staff is not null)`;
    const kept = psqlOn(db.toString(), keep);
    assert.match(psqlOn(db.toString(), `select string_agg(staff_kind, ',' order by staff) from characters where staff is not null`), /^bot,bot,boss$/);

    psqlOn(db.toString(), fs.readFileSync(path.join(migrations, '0082_offices.sql'), 'utf8'));
    for (const m of all.filter((f) => f > '0082_offices.sql')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));

    // After: the same rows in the same order, as office rows.
    const rowsAfter = psqlOn(db.toString(), `select string_agg(staff || ':' || coalesce(move_act::text, '-') || ':' || at::date, ',' order by id) from staff_offices`);
    assert.equal(rowsAfter, rowsBefore, 'every row was carried, in order, with its move_act and its time');
    assert.equal(
      psqlOn(db.toString(), `select string_agg(staff || ':' || office || ':' || cause, ',' order by id) from staff_offices`),
      'bot-b:mod:seed,bot-a:mod:seed,bot-a:member:move,bot-a:mod:move,bot-b:member:seed,bot-a:member:move',
      'on staff is mod and off staff member; a row with a move is cause move, any other seed');
    assert.equal(psqlOn(db.toString(), `select count(*) from staff_offices`), '6');
    assert.equal(psqlOn(db.toString(), `select string_agg(staff_kind, ',' order by staff) from characters where staff is not null`), 'persona,persona,persona', 'every boss and bot is a persona');
    assert.equal(psqlOn(db.toString(), `select string_agg(staff, ',' order by staff) from characters where staff_kind = 'persona'`), 'bot-a,bot-b,old-boss', 'each keeps its key');
    assert.equal(psqlOn(db.toString(), keep), kept, 'the Acts, the profiles, the names and the debuts are as they were');
    assert.equal(psqlOn(db.toString(), `select to_regclass('public.staff_changes') is null`), 't', 'staff_changes is gone');
    assert.equal(psqlOn(db.toString(), `select string_agg(staff || '=' || office, ',' order by staff) from staff_office_now`), 'bot-a=member,bot-b=member,old-boss=member', 'the office now is the latest row (no season names a Boss here)');
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
