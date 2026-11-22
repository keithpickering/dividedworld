/**
 * The SQL suite's drift step fails on a play_post that differs from the Acts, against a real database.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres node tools/test-sql-drift.mjs
 *
 * tools/test-sql.mjs ends with `driftCheck`, which runs play_post_drift() (supabase/migrations/0407_play_post.sql) on the scratch
 * database. A check that has only ever passed proves that it runs, not that it detects ("A guard that has never been red is not known
 * to work"), and tools/test-sql-refusal.mjs can only stand a psql in for the database. So this builds a real one from the migrations
 * and the fixtures, as the suite does, plays a card on a post, and writes the refund the play's own trigger (play_post_on_refund) would
 * have kept a row for, with that trigger disabled: `driftCheck` must fail naming the play. A clean database must pass.
 *
 * Outside the build, which has no Postgres (tools/build.mjs, OUTSIDE_THE_BUILD); it runs in .github/workflows/sql.yml beside the suite,
 * on the same refusal of any database but this machine's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { driftCheck, migrationFiles, refusal } from './test-sql.mjs';

const url = process.env.DATABASE_URL;
const why = refusal(url);
if (why) { console.error(`  test-sql-drift: ${why}`); process.exit(2); }

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../supabase/tests/setup/fixtures.sql');
const at = (db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const psql = (target, sql) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', target, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const scratch = `kayfabb_scratch_drift_${process.pid}_${Date.now()}`;
try {
  psql(url, `create database ${scratch};`);
  const target = at(scratch);
  for (const f of [...migrationFiles(), fixtures]) psql(target, fs.readFileSync(f, 'utf8'));

  check('a database the migrations and fixtures made has no drift', driftCheck(target) === null, String(driftCheck(target)));

  /* A card played through its trigger leaves a row that matches; still clean. */
  const played = psql(target, `select set_config('kayfabb.seeding', 'on', false);
    do $$ declare c uuid := tests.character(tests.account('drift-a'), 'Drift A'); t uuid := tests.thread('Drift'); p uuid := tests.post(c, t);
    begin insert into acts (character, kind, thread, target_act_id, payload) values (c, 'card', t, p, '{"card": "splat", "config": {}}'); end $$;
    select id from acts where kind = 'card';`);
  const play = played.trim().split('\n').pop();
  check('a play with its row is no drift', Boolean(play) && driftCheck(target) === null, String(driftCheck(target)));

  /* The poison: the refund lands with the trigger that keeps play_post disabled, so the kept row misses it. */
  psql(target, `alter table card_write_refunds disable trigger play_post_on_refund;
    insert into card_write_refunds (play, amount) values ('${play}', 5);
    alter table card_write_refunds enable trigger play_post_on_refund;`);
  const failure = driftCheck(target);
  check('a refund written with its trigger disabled fails the check', failure !== null, 'it passed');
  check('and names the play', Boolean(failure) && failure.includes(play), String(failure));
} finally {
  try { psql(url, `drop database if exists ${scratch} with (force);`); } catch (e) { console.error(`  test-sql-drift: could not drop ${scratch}: ${e.message}`); }
}

console.log(`\n  sql-drift: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-drift: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
