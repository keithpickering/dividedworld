/**
 * The plays an instance already holds, across the migration that gives play_reach its start (the file whose name ends `_kept_character.sql`, found by that name and not by its
 * number, which changes when it is renumbered at merge): each row's `started_at` is its Act's `created_at`, the column is not null, both guards are enabled `always` again, and
 * an update is still refused (docs/plans/2026-11-13-glitter-keeps-bound-plan.md, Task 1). The suite replays from zero, so no row exists when that migration runs there, and once it has
 * run a row cannot be written without a start; the honest proof is a database of its own, made here beside the scratch one tools/test-sql.mjs made, from the migrations before it, so the rows
 * are written by the schema that wrote such rows (a play at character, thread (one that pins its board) and board reach), then the migration and every one after it.
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

test('plays held before the migration carry their Act\'s date as their start after it, and the guards are back', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_kept`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    const all = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
    const found = all.filter((f) => f.endsWith('_kept_character.sql'));
    assert.equal(found.length, 1, 'exactly one migration is named for the kept character');
    const before = all.filter((f) => f < found[0]);
    assert.ok(before.length > 0 && before.includes('0055_card_reach.sql'), 'the migrations before it include the one that made play_reach');
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of before) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    // The test instance's settings, as supabase/tests/setup/fixtures.sql writes them.
    const fixtures = fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8');
    const settings = fixtures.indexOf('insert into settings');
    psqlOn(db.toString(), fixtures.slice(settings, fixtures.indexOf("');\n", settings) + 3));
    assert.equal(psqlOn(db.toString(), `select count(*) from information_schema.columns where table_name = 'play_reach' and column_name = 'started_at'`), '0', 'the schema before it has no start');
    const [acct, caster, target, general, thread, pin, ann] = ['01', 'c1', 'c2', 'b1', 'd1', 'd2', 'd3'].map((s) => `00000000-0000-4000-8000-0000000000${s}`);
    psqlOn(db.toString(), `
      insert into class_kinds (key, name) values ('alpha', 'Alpha');
      insert into boards (id, slug, name, is_system) values ('${general}', 'general', 'General', false), ('00000000-0000-4000-8000-0000000000b2', 'the-system', 'The System', true);
      insert into seasons (number, starts_at) values (1, now() - interval '100 days');
      insert into auth.users (id, email) values ('${acct}', 'kept@test.invalid');
      insert into accounts (id) values ('${acct}');
      insert into characters (id, owner, name, created_at, debuted_at) values
        ('${caster}', '${acct}', 'Kept Caster', now() - interval '90 days', now() - interval '90 days'),
        ('${target}', '${acct}', 'Kept Target', now() - interval '90 days', now() - interval '90 days');
      insert into class_history (character, class_key, started_at) values ('${caster}', 'alpha', now() - interval '90 days'), ('${target}', 'alpha', now() - interval '90 days');
      insert into threads (id, board, title) values ('${thread}', '${general}', 'Kept thread'), ('${pin}', '${general}', 'Kept pin'),
        ('${ann}', (select id from boards where slug = 'the-system'), 'Announcements');
      insert into acts (id, character, kind, thread, payload, created_at) values
        ('00000000-0000-4000-8000-0000000000a0', '${target}', 'post', '${thread}', '{"body": "A post."}', now() - interval '60 days'),
        ('00000000-0000-4000-8000-0000000000a5', '${target}', 'post', '${pin}', '{"body": "Another post."}', now() - interval '60 days');
      insert into acts (id, character, kind, thread, target_act_id, payload, created_at) values
        ('00000000-0000-4000-8000-0000000000a1', '${caster}', 'card', '${thread}', '00000000-0000-4000-8000-0000000000a0', '{"card": "kc-char", "reach": "character", "character": "${target}"}', now() - interval '40 days 3 hours'),
        ('00000000-0000-4000-8000-0000000000a2', '${caster}', 'card', '${thread}', '00000000-0000-4000-8000-0000000000a0', '{"card": "kc-thread", "reach": "thread"}', now() - interval '30 days 5 minutes'),
        ('00000000-0000-4000-8000-0000000000a3', '${caster}', 'card', '${pin}', '00000000-0000-4000-8000-0000000000a5', '{"card": "kc-pin", "reach": "thread"}', now() - interval '20 days 7 seconds'),
        ('00000000-0000-4000-8000-0000000000a4', '${caster}', 'card', '${ann}', null, '{"card": "kc-board", "reach": "board", "board": "${general}"}', now() - interval '10 days 11 hours');
      insert into play_reach (play, reach, character, thread, board, pins_board, ends_at) values
        ('00000000-0000-4000-8000-0000000000a1', 'character', '${target}', null, null, null, now() - interval '33 days'),
        ('00000000-0000-4000-8000-0000000000a2', 'thread', null, '${thread}', null, null, now() - interval '29 days'),
        ('00000000-0000-4000-8000-0000000000a3', 'thread', null, '${pin}', null, '${general}', now() - interval '19 days'),
        ('00000000-0000-4000-8000-0000000000a4', 'board', null, null, '${general}', null, now() - interval '9 days');`);
    assert.equal(psqlOn(db.toString(), `select count(*) from play_reach`), '4', 'the old schema wrote four rows, one at each reach and one that pins');
    for (const m of all.filter((f) => f >= found[0])) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));

    assert.equal(psqlOn(db.toString(), `select count(*) from play_reach r join acts a on a.id = r.play where r.started_at = a.created_at`), '4', 'each row\'s start is its Act\'s date');
    assert.equal(psqlOn(db.toString(), `select count(*) from play_reach where pins_board is not null`), '1', 'the pinning row was carried');
    assert.equal(psqlOn(db.toString(), `select is_nullable from information_schema.columns where table_name = 'play_reach' and column_name = 'started_at'`), 'NO', 'the column is not null');
    assert.equal(psqlOn(db.toString(), `select string_agg(tgname || '=' || tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid = 'play_reach'::regclass and tgname in ('play_reach_no_update', 'play_reach_no_truncate')`),
      'play_reach_no_truncate=A,play_reach_no_update=A', 'both guards are enabled always again');
    assert.throws(() => psqlOn(db.toString(), `update play_reach set ends_at = ends_at + interval '1 day'`), /a play beyond a post is never edited/, 'an update is refused');
    assert.throws(() => psqlOn(db.toString(), `update play_reach set started_at = now()`), /a play beyond a post is never edited/, 'an update of the start is refused');
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
