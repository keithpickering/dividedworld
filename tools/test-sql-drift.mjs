/**
 * The SQL suite's drift step fails on a play_post that differs from the Acts, against a real database.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres node tools/test-sql-drift.mjs
 *
 * tools/test-sql.mjs reads play_post_drift() (supabase/migrations/0408_play_post.sql) on each file's clone after the file, and
 * `readAfterFile` is the runner's own path after a file (afterFileSql, parseAfterFile, driftFailure), run here on a clone. A check that has only
 * ever passed proves that it runs, not that it detects ("A guard that has never been red is not known to work"), and tools/test-sql-refusal.mjs can only stand a psql in for the database. So this builds
 * a real template from the migrations and the fixtures, as the suite does (its settings first, the one `vacuum (analyze)` last), clones it as the suite does (cloneSql), plays a card on a
 * post on the clone, and writes the refund the play's own trigger (play_post_on_refund) would have kept a row for, with that trigger
 * disabled: that path must fail naming the play. A clone nothing was done to must pass.
 *
 * Outside the build, which has no Postgres (tools/build.mjs, OUTSIDE_THE_BUILD); it runs in .github/workflows/sql.yml beside the suite,
 * on the same refusal of any database but this machine's.
 */
import { execFileSync } from 'node:child_process';
import { buildTemplate, cloneSql, readAfterFile, refusal } from './test-sql.mjs';

const url = process.env.DATABASE_URL;
const why = refusal(url);
if (why) { console.error(`  test-sql-drift: ${why}`); process.exit(2); }

const at = (db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const psql = (target, sql) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', target, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const template = `kayfabb_scratch_drift_${process.pid}_${Date.now()}`;
const clone = `${template}_1`;
try {
  /* The suite's own builder: the settings, the shim, every migration, the fixtures and the one vacuum, so this cannot build another template than the suite's. */
  const built = await buildTemplate(url, template, { step: (label, err) => { if (err) console.error(`  ${label}: ${err}`); return !err; } });
  if (!built.ok) throw new Error('the template did not build');
  psql(url, cloneSql(template, clone, url));
  const target = at(clone);
  /* The runner's own path after a file: afterFileSql on the clone, parseAfterFile, driftFailure (readAfterFile); null when the clone drifts from nothing. */
  const drift = async () => (await readAfterFile(target)).failure;

  /* Built as the runner builds it: its settings given first, one vacuum (analyze) after the fixtures. */
  check('the template carries the suite\'s bounds and names itself in kayfabb.scratch_url', psql(at(template), "select current_setting('lock_timeout') || ' ' || current_setting('kayfabb.scratch_url')").trim() === `30s ${at(template)}`);
  check('and every table in public is analyzed, as the one vacuum leaves it', psql(at(template), "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.reltuples < 0").trim() === '0');

  const clean = await drift();
  check('a clone of a template the migrations and fixtures made has no drift', clean === null, String(clean));
  const counts = (await readAfterFile(target)).calls;
  check('and the same call reads the function counts, which only a working wrapper brings back', counts.length > 0 && counts.every((c) => typeof c.name === 'string' && Number.isFinite(Number(c.calls))), JSON.stringify(counts.slice(0, 2)));

  /* A card played through its trigger leaves a row that matches; still clean. */
  const played = psql(target, `select set_config('kayfabb.seeding', 'on', false);
    do $$ declare c uuid := tests.character(tests.account('drift-a'), 'Drift A'); t uuid := tests.thread('Drift'); p uuid := tests.post(c, t);
    begin insert into acts (character, kind, thread, target_act_id, payload) values (c, 'card', t, p, '{"card": "splat", "config": {}}'); end $$;
    select id from acts where kind = 'card';`);
  const play = played.trim().split('\n').pop();
  const kept = await drift();
  check('a play with its row is no drift', Boolean(play) && kept === null, String(kept));

  /* The poison: the refund lands with the trigger that keeps play_post disabled, so the kept row misses it. */
  psql(target, `alter table card_write_refunds disable trigger play_post_on_refund;
    insert into card_write_refunds (play, amount) values ('${play}', 5);
    alter table card_write_refunds enable trigger play_post_on_refund;`);
  const failure = await drift();
  check('a refund written with its trigger disabled fails the check', failure !== null, 'it passed');
  check('and names the play', Boolean(failure) && failure.includes(play), String(failure));
} finally {
  for (const db of [clone, template]) {
    try { psql(url, `drop database if exists ${db} with (force);`); } catch (e) { console.error(`  test-sql-drift: could not drop ${db}: ${e.message}`); }
  }
}

console.log(`\n  sql-drift: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-drift: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
