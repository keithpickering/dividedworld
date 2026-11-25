/**
 * The SQL suite: every migration replayed from zero into a template database, then every assertion file under
 * supabase/tests/ and every end-to-end file under supabase/tests/e2e/ on a clone of it, one clone a file.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run test:sql
 *   DATABASE_URL=… npm run test:sql -- 0420          (only the files whose names contain 0420)
 *   KAYFABB_SQL_KEEP=failed …                        (a failing file's clone is kept, and its URL printed)
 *   KAYFABB_SQL_WORKERS=2 …                          (how many files run at once; the default is one for each CPU)
 *   … --shard=2/4 --report=sql-report.json           (the files at positions 2, 6, 10… of the one list, and a report of the run)
 *   node tools/test-sql.mjs --gather=<dir>           (every shard's report in <dir> against the files on disk; needs no database)
 *
 * Each run creates a **template** on the server DATABASE_URL names (`kayfabb_scratch_<pid>_<time>`), applies
 * supabase/tests/setup/auth-shim.sql (a stand-in for what Supabase provides before any migration: the API roles,
 * `auth.uid()` read from the claims a test sets), then every supabase/migrations/*.sql in name order, then
 * supabase/tests/setup/fixtures.sql (a test instance's vocabulary and helpers that make players, characters and posts),
 * then one `vacuum (analyze)`. Then every supabase/tests/NNNN-*.sql in number order, and every e2e/NNNN-*.ts, each runs on a
 * clone of its own (`create database <template>_<n> template <template>`) made just before it and dropped just after it,
 * pass or fail, and the template is dropped at the end. A template and clones rather than a scratch schema, because the
 * migrations are written for Supabase's own `public` and `auth` and must run here exactly as they will there; the database
 * DATABASE_URL names is only where they are created from, and nothing in it is touched.
 *
 * Why the whole history and not the new files: a migration that only works on a database
 * that already has yesterday's state is a migration nobody can replay, and replaying from zero
 * is the one test that catches it. It proves the migrations' content and nothing about whether
 * they were applied anywhere ("A test that builds its own subject cannot tell you the subject
 * is missing"), so this harness never reads a deployed database: it refuses, before anything
 * else, a DATABASE_URL that is unset or names a host other than this machine.
 *
 * Why a clone a file. A rollback does not give back everything a file touches, and a race test commits through dblink on
 * purpose: rows, dead tuples, statistics and plan-cache state one file left were what the next file started from, so a plan
 * assertion on a toy fixture read whichever plan those leftovers priced lowest, and a file could pass only because an
 * earlier one had committed the row it read. A clone starts every file from the template's one analyzed state: dead rows
 * reclaimed and statistics true to the committed rows (the template's one `vacuum (analyze)`), a fresh session's empty plan
 * cache, and cumulative statistics, which decide autovacuum, at zero for a new database. No file can reach another's rows, order
 * stops mattering, and one file can be run alone with a pattern. What it fixes is where a file starts, never what its own
 * rows do to a plan: a plan assertion must still stand on its own fixture and `analyze` it, at the scale the assertion is
 * about. A clone costs about what the vacuum before each file did, 0.1 s to make and 0.2 s to drop.
 *
 * What a clone carries: `alter database … set` is stored for the database it names (`pg_db_role_setting`), and `create database …
 * template` does not copy it. So the runner copies it (cloneSql): every setting stored for the source database with no role, read from the
 * catalog by name, with no list of settings of its own, so a setting a migration stores with `alter database` reaches every clone with no
 * runner change, and a file's clone shows the migration's setting and not one the runner invented. Then the runner gives the clone its own,
 * last so that they win where both are set: the bounds (SESSION_BOUNDS), `track_functions`, `kayfabb.client_rpcs`, and `kayfabb.scratch_url`
 * naming the clone itself (the source's names the source), so a race test's dblink sessions open on its own clone. All of it is sent in the
 * call that makes the clone, before anything connects to it. The template gets its own settings the same way, since the shim and the
 * migrations run on it. supabase/tests/0000-harness.sql goes red on a clone without them ("this file's connection is unbounded").
 *
 * Databases for the end-to-end files that need their own. While the template is replayed, the runner keeps a snapshot (`create database … template`,
 * made between two migrations, each of whose psql has ended) before each migration an upgrade test crosses, and one `migrated` snapshot after the last migration
 * and before the fixtures. The point is the file's name: `NNNN-<name>-across-MMMM.ts` crosses migration MMMM (snapshotPoints, the one list; a name that gives no
 * point, two files naming one, or a point no migration has fail the run before anything is made). A file is told its clone in KAYFABB_SCRATCH_URL and the
 * snapshots in KAYFABB_SNAPSHOTS (JSON: point to database name, and `migrated`), and takes a database from supabase/tests/e2e/psql-db.ts (`databaseBefore`,
 * `migratedDatabase`: a clone of a snapshot, named `<clone>_<suffix>`). The runner drops every database named `<clone>_%` with the clone, and refuses a file
 * that reads the migrations itself (e2eRefusal), as it refuses an assertion file that ends its own transaction.
 *
 * Each assertion file runs inside its own `begin; … rollback;`. `set local role` and
 * `set_config(…, true)` are scoped to a transaction and are silent no-ops outside one, and an
 * assertion file is exactly where a caller is impersonated; the wrap also means a file's
 * rows are not what the next statement of the file's own session sees. Migrations are not wrapped: they run as Supabase
 * applies them. A file with no `raise exception` asserts nothing and fails as such, and a file
 * named with a number that the pattern does not take fails rather than being skipped, since
 * either would otherwise be a test nobody knew never ran. A pattern that matches no file fails too.
 *
 * Drift and coverage are read after each file, before its clone is dropped (afterFileSql, one psql call), because a dropped clone
 * takes its rows and its statistics with it. The kept tables `play_post` and `post_kinds` must hold what the Acts say
 * (play_post_drift()): read on the clone of the file that wrote the rows, so a drift is named with that file, whether the file
 * committed through an end-to-end run or a race test's dblink. And the function statistics, which say which client reads a
 * test called, a call in a rolled-back transaction included, are summed over every file; the comparison (uncalledReads) runs
 * once on the sum after the last file, since a read one file leaves uncalled is another's to call. A run with a pattern reads
 * a part of the suite and skips that comparison, and says so (`skipped`, under `sql: coverage`). A killed file's clone is not read
 * (see below): its counts are missing from the sum, and the file has already failed the run.
 *
 * A hang fails, and names its file. Every connection to a clone, each file's psql and every
 * dblink session a race test opens, starts with SESSION_BOUNDS, set on the database itself so no helper
 * has to remember them: a lock regression whose two sides are this file's connection and a dblink session
 * it waits on (removing 0030's `for update skip locked` from threads_count_board did exactly this to
 * 0012-cards.sql) is a deadlock Postgres cannot see, since one side waits on a lock and the other on a
 * socket, and without a bound the suite never ends. The lock wait then fails at lock_timeout, and any
 * other statement that never ends fails at statement_timeout. A psql that outlives both (a backend stuck
 * where neither reaches) is killed at FILE_TIMEOUT_MS and reported as such, its clone dropped, and the files after it still run. A
 * file or statement setting its own shorter lock_timeout (the racers' 20s in tests.raced) is unaffected.
 *
 * Files run in a pool, and over shards. As many files run at once as the machine has CPUs (`os.availableParallelism()`, or KAYFABB_SQL_WORKERS), each on
 * its own clone and taken in name order; the pool is `child_process.spawn` and not `execFileSync`, which would block the one thread that runs the pool.
 * Each file's whole output is printed as one block when it ends, so lines of different files never interleave, and a failing file does not stop the
 * others: the failed count is the number of files that failed. The template is built once, before the pool, and its snapshots only when a selected
 * end-to-end file needs them. `--shard=i/n` runs the files at positions i, i+n, i+2n… of the one sorted list (the assertion files, then the end-to-end
 * files as `e2e/<file>`; shardOf, counting from 1), so every file is in exactly one shard and no list but the files on disk says which; no flag is shard
 * 1 of 1. A pattern then narrows the shard's files. `--report=<path>` writes `{ shard: { i, n }, files: [{ name, outcome, seconds }], calls }`, the summed
 * function counts included, and `--gather=<dir>` reads every report in a directory and lists the files on disk: it fails unless every file is in
 * exactly one report and passed, every shard 1..n reported and agrees on n (gatherFailures), and every client read was called on the counts summed over
 * every report (coverageFailure). A split that drops a file, a file run twice and a shard that silently ran nothing are each red there. It touches no
 * database, so the refusal of one does not apply to it. A run with no `--shard` and no pattern is the whole suite and makes the same comparison in this
 * process, on its own report, so `npm run test:sql` is one command that runs everything; a shard or a pattern runs part and says `skipped`.
 *
 * A file that holds a wall-clock budget says so itself, in a line of its own, `-- kayfabb-sql: alone` (carriesAloneMarker; #1099 has the why): the pool runs every
 * other file first, then each marked file by itself, with nothing else of this runner in flight. A file is refused before it runs if it holds a budget without the
 * marker, or carries the marker without one (holdsClockBudget). tools/test-sql-refusal.mjs drives both on planted files.
 *
 * Each file's line carries its seconds, and the summary lists the slowest, since a file that grows is otherwise found by a CI
 * run that takes longer.
 *
 * psql is the only tool: no driver, no pgTAP. Outside the build (tools/build.mjs,
 * OUTSIDE_THE_BUILD), which has no database; it runs in .github/workflows/sql.yml against a
 * Postgres service, and locally against the container's own Postgres
 * (scripts/setup-container.sh, .claude/hooks/session-start.sh).
 *
 * Carried from currents (docs/plans/port-manifest.md): its reset of a shared `public` became a
 * scratch database, and its stand-ins for storage, pg_net and Vault stayed behind until a
 * migration here needed them: pg_net and Vault arrived with 0004, and Storage's bucket table
 * with 0019, each in supabase/tests/setup/auth-shim.sql.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { ALLOWED_RPCS } from './check-web-reads.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const testsDir = path.join(repoRoot, 'supabase/tests');
const shim = path.join(testsDir, 'setup/auth-shim.sql');
const fixtures = path.join(testsDir, 'setup/fixtures.sql');
/* Where the assertion files are: supabase/tests/, or another directory KAYFABB_SQL_TESTS_DIR names, for tools/test-sql-refusal.mjs to plant files in. */
const suiteDir = () => process.env.KAYFABB_SQL_TESTS_DIR || testsDir;

/**
 * The SQL a database is built from, in order: the shim, then every migration by name. One list: this harness and the rehearsal
 * (tools/rehearse/setup.ts) both read it, so neither can apply them in an order the other does not. Absolute paths; the shim is first.
 * fixtures.sql is the suite's own and is not in it.
 */
export function migrationFiles() {
  const names = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort() : [];
  return [shim, ...names.map((m) => path.join(migrationsDir, m))];
}

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SAFE_PARAMETERS = new Set(['sslmode', 'connect_timeout', 'application_name']);

/**
 * Why a DATABASE_URL may not be used, or null when it may: unset, not a URL, or a host
 * other than this machine.
 * @param {string | undefined} url
 */
export function refusal(url) {
  if (!url) return 'DATABASE_URL is not set (postgres://postgres:pg@localhost:5432/postgres)';
  let parsed;
  try { parsed = new URL(url); } catch { return 'DATABASE_URL is not a valid URL'; }
  const host = parsed.hostname;
  if (!LOCAL_HOSTS.has(host)) return `refusing DATABASE_URL on host "${host}": this harness creates and drops databases, and reads only Postgres on localhost`;
  /* libpq reads connection parameters from the query string too, and `host`, `hostaddr` and
     `service` there override the host above, so only parameters that cannot move the
     connection are let through. */
  for (const key of parsed.searchParams.keys()) {
    if (!SAFE_PARAMETERS.has(key)) return `refusing DATABASE_URL with the parameter "${key}": only ${[...SAFE_PARAMETERS].join(', ')} are allowed, since others can point libpq at another host`;
  }
  return null;
}

/** The URL with its database swapped for another on the same server. */
const withDatabase = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

/* The program run as psql. tools/test-sql-refusal.mjs stands a recording psql in for the real one through
   KAYFABB_PSQL_SHIM, a Node script this Node runs: a shell script put first on PATH, the way it used to stand in,
   is never run on Windows, where the real psql.exe further down PATH answers instead. */
const PSQL = process.env.KAYFABB_PSQL_SHIM ? { file: process.execPath, args: [process.env.KAYFABB_PSQL_SHIM] } : { file: 'psql', args: [] };

/**
 * How a run ends when it cannot reach its `finally` blocks (a signal, or a program that is not there): kill every child still running, drop every
 * database the run made, and exit. What the run made is named from its template (`<template>`, and `<template>_%`: the clones, the databases a
 * file makes from a snapshot, the snapshots), so one sweep covers it, and a run killed with a clone half-made leaves nothing on the server.
 * `sweep` is set once the template is named. A second call (the sweep's own psql missing) only exits.
 */
const children = new Set();
/** @type {{ url: string, template: string } | null} */
let sweep = null;
let leaving = false;
function leave(code) {
  if (leaving) process.exit(code);
  leaving = true;
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  if (sweep) {
    const t = sweep.template;
    const err = psql(sweep.url, `select format('drop database if exists %I with (force)', datname) from pg_database where datname = '${t}' or datname like '${t}\\_%' \\gexec`);
    if (err) console.error(`  test-sql: could not drop what is named for ${t}: ${err}`);
  }
  process.exit(code);
}

function psql(url, sql) {
  try {
    execFileSync(PSQL.file, [...PSQL.args, '-v', 'ON_ERROR_STOP=1', '-q', '-X', url, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('\n  psql not found; run scripts/setup-container.sh'); leave(2); }
    if (timedOut(err)) return killedWhy();
    return (err.stderr || err.stdout || String(err)).trim();
  }
}

/**
 * Runs a program without blocking this process (the pool runs files together), killed with SIGKILL at FILE_TIMEOUT_MS. Answers its exit code,
 * whether it was killed, and what it printed. A killed program's own children may hold its pipes open, so it is let go two seconds after it exits.
 * @param {string} file
 * @param {string[]} args
 * @param {{ input?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number | null, killed: boolean, out: string, err: string }>}
 */
function exec(file, args, { input, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    children.add(child);
    let out = '';
    let err = '';
    let killed = false;
    let done = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, FILE_TIMEOUT_MS);
    const finish = (code) => { if (done) return; done = true; children.delete(child); clearTimeout(timer); resolve({ code, killed, out, err }); };
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
      if (e.code === 'ENOENT') { console.error(`\n  ${file} not found; run scripts/setup-container.sh`); leave(2); }
      err += String(e);
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.on('exit', (code) => { setTimeout(() => finish(code), 2000).unref(); });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

/** psql as exec runs it: the SQL on stdin; answers the error (what psql printed, or the kill) or null. */
async function psqlAsync(url, sql) {
  const r = await exec(PSQL.file, [...PSQL.args, '-v', 'ON_ERROR_STOP=1', '-q', '-X', url, '-f', '-'], { input: sql });
  return { error: r.killed ? killedWhy() : r.code === 0 ? null : (r.err || r.out || `psql exited with ${r.code}`).trim() };
}

/** psqlLines, without blocking: the lines the queries print, unaligned and `|`-separated, or the error. @returns {Promise<{ lines: string[], error: string | null }>} */
async function psqlLinesAsync(url, sql) {
  const r = await exec(PSQL.file, [...PSQL.args, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t', '-F', '|', url, '-f', '-'], { input: sql });
  if (r.killed) return { lines: [], error: killedWhy() };
  return r.code === 0 ? { lines: r.out.split('\n'), error: null } : { lines: [], error: (r.err || r.out || `psql exited with ${r.code}`).trim() };
}

/** SQL with its `--` and block comments blanked, so a comment cannot stand in for code. */
const withoutComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/* SQL with every dollar-quoted body blanked: a `commit` inside a `do` block or a function body
   cannot end the file's transaction (Postgres refuses it there), and one inside a string sent
   to another connection is that connection's; only one at the top level escapes the wrap. */
const withoutDollarQuotes = (sql) => sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, ' ');

/**
 * Each `if`, `or` or `and` whose condition is `(select …) <> …`: a select that finds no row is
 * null, `null <> x` is null, and the `raise` it guards never runs, so the assertion passes over
 * exactly the missing row it exists to catch. `is distinct from` says what was meant.
 */
export function nullBlind(code) {
  const found = [];
  const opener = /\b(if|or|and)\s+\(\s*select\b/gi;
  for (let m; (m = opener.exec(code));) {
    const start = m.index + m[0].indexOf('(');
    let depth = 0;
    let end = start;
    for (; end < code.length; end++) {
      if (code[end] === '(') depth++;
      else if (code[end] === ')' && --depth === 0) break;
    }
    if (/^\s*<>/.test(code.slice(end + 1))) found.push(code.slice(m.index, Math.min(code.length, end + 8)).replace(/\s+/g, ' '));
  }
  return found;
}

/**
 * The bounds every connection to the scratch database starts with (see the header). A healthy lock wait in
 * this suite is a race's barrier or one session waiting out another's commit, both well under a second and
 * the barrier capped at 10 s (tests.race_as); 30 s is three times the longest, and is the most a lock
 * regression costs. The longest healthy statements, measured on this container's Postgres, are
 * e2e/0004-names.ts's one query over every folded code point (between 30 and 50 s: a 30 s bound cut it) and
 * 0032-unmask.sql's 20,000-post insert (over 10 s); 300 s is six times the longest, room for a CI runner a
 * few times slower, and still ends any other hang in five minutes.
 */
export const SESSION_BOUNDS = Object.freeze({ lock_timeout: '30s', statement_timeout: '300s' });

/**
 * How long one psql (a migration, an assertion file) or one end-to-end file may run before it is killed:
 * past every statement_timeout a file can meet in a row of statements that each come in under it would be
 * unbounded, so the process has a bound of its own, wider than one statement's. KAYFABB_SQL_FILE_TIMEOUT_MS
 * overrides it for tools/test-sql-refusal.mjs, which drives the kill with a psql that never answers.
 */
export const FILE_TIMEOUT_MS = Number(process.env.KAYFABB_SQL_FILE_TIMEOUT_MS) > 0 ? Number(process.env.KAYFABB_SQL_FILE_TIMEOUT_MS) : 10 * 60 * 1000;

/** The SQL that gives every new connection to a database the bounds. */
export const boundsSql = (db) => Object.entries(SESSION_BOUNDS).map(([k, v]) => `alter database ${db} set ${k} to '${v}';`).join('\n');

/**
 * Every connection to a database counts function calls (`track_functions = all`), so that after a file Postgres's own statistics say
 * which client reads a test called, a call in a rolled-back transaction included (see `afterFileSql`).
 */
export const trackSql = (db) => `alter database ${db} set track_functions to 'all';`;

/**
 * The client reads as a setting of the database, `kayfabb.client_rpcs` (names joined by commas), so an assertion file reads the list
 * with `current_setting('kayfabb.client_rpcs')` and holds no copy (supabase/tests/0320-client-reads-plan-once.sql).
 */
export const clientRpcsSql = (db) => `alter database ${db} set kayfabb.client_rpcs to '${ALLOWED_RPCS.join(',')}';`;

/**
 * Every setting a database of the suite starts with, as `alter database` statements: the bounds, `track_functions`, the client reads,
 * and `kayfabb.scratch_url`, which names the database itself so that a race test (dblink) opens its sessions on the database its
 * own file runs on. `url` is any URL on the server; the database in it is swapped for `db`.
 */
export const settingsSql = (db, url) => [boundsSql(db), trackSql(db), clientRpcsSql(db), `alter database ${db} set kayfabb.scratch_url to '${withDatabase(url, db).replaceAll("'", "''")}';`].join('\n');

/**
 * The SQL, run on the server's own database, that makes one clone of the template and gives it its settings. `alter database … set`
 * is stored for the database it names and is not copied by `create database … template`, so the clone first gets, by `\gexec`, one
 * `alter database` for each setting stored for its source with no role (`setrole = 0`; names read from the catalog, none listed here, values
 * quoted whole so that a scalar one with commas, such as `kayfabb.client_rpcs`, survives), then the runner's own, which come last so
 * the clone's `scratch_url` names the clone. A list-valued setting such as `search_path` would arrive as one element, since its stored
 * form is the list already joined; no migration stores one at the database, and one that does needs this copy to learn the difference.
 * All of it is sent before anything connects to the clone.
 */
export const cloneSql = (template, clone, url) => `create database ${clone} template ${template};
select format('alter database %I set %s to %L', '${clone}', split_part(c, '=', 1), substr(c, strpos(c, '=') + 1))
from pg_db_role_setting s, unnest(s.setconfig) c
where s.setdatabase = (select oid from pg_database where datname = '${template}') and s.setrole = 0 \\gexec
${settingsSql(clone, url)}`;

/**
 * The drift check, read on a file's clone after the file: every row the kept tables `play_post` and `post_kinds` hold that
 * the Acts do not say, and every Act they miss (supabase/migrations/0408_play_post.sql and 0409_post_kinds.sql). A trigger that does not
 * run, a write that goes around one and an end nobody added to the table's mirror all show here, whichever file did it. The first rows
 * only: a run that drifts says so, and the full list is one `select * from play_post_drift()` away.
 */
export const DRIFT_ROWS = 10;
export const driftSql = `select play, why from play_post_drift() order by play, why limit ${DRIFT_ROWS};`;

/**
 * The stable functions in `public` among the client reads, each with the calls the statistics hold (summed over overloads).
 * Read on a connection of its own after every other to the clone has ended; the flush is forced anyway.
 */
const countsSql = `select p.proname, coalesce(sum(s.calls), 0)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
left join pg_stat_user_functions s on s.funcid = p.oid
where p.provolatile = 's' and p.proname = any (string_to_array('${ALLOWED_RPCS.join(',')}', ','))
group by p.proname order by p.proname`;

/**
 * What one psql call reads on a file's clone before it is dropped: the drift rows and the function counts, each row's first column
 * saying which (`drift|play|why`, `calls|name|n`), so one call and one parse tell them apart. See parseAfterFile.
 */
export const afterFileSql = `select pg_stat_force_next_flush();
select 'drift', d.* from (${driftSql.replace(/;$/, '')}) d;
select 'calls', c.* from (${countsSql}) c;`;

/**
 * The lines afterFileSql printed, split into the drift rows and the function counts, each as the `{ name, calls }` pair the rest reads
 * (a drift row's `calls` is its why, which may itself hold a `|`). Pure.
 * @param {string[]} lines
 */
export function parseAfterFile(lines) {
  const drift = [];
  const calls = [];
  for (const l of lines) {
    const [tag, name, ...rest] = l.split('|');
    if (name === undefined) continue;
    (tag === 'drift' ? drift : tag === 'calls' ? calls : []).push({ name, calls: rest.join('|') });
  }
  return { drift, calls };
}

/**
 * The calls of every file's clone added up, name by name, as `{ name, calls }` rows in name order: a read one file left uncalled is
 * another's to call, so the comparison is on the sum. A name keeps its row at zero. Pure.
 * @param {{ name: string, calls: number | string }[][]} perFile
 */
export function sumCalls(perFile) {
  const sums = new Map();
  for (const rows of perFile) for (const r of rows) sums.set(r.name, (sums.get(r.name) ?? 0) + Number(r.calls));
  return [...sums].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, calls]) => ({ name, calls }));
}

/** Why the drift check failed, or null: `rows` are the `{ name: play, calls: why }` pairs parseAfterFile made. Pure, so tools/test-sql-refusal.mjs drives it. */
export function driftFailure(rows) {
  if (!rows.length) return null;
  return `play_post or post_kinds differs from the Acts (play_post_drift() names ${rows.length === DRIFT_ROWS ? `at least ${DRIFT_ROWS}` : rows.length} row(s)):\n${rows.map((r) => `${r.name}  ${r.calls}`).join('\n')}`;
}

/**
 * What the runner reads on a file's clone after the file, before the drop: afterFileSql through psqlLinesAsync, parseAfterFile, driftFailure. Answers the
 * function counts and the `failure` that stopped the read or the drift it found (null when there is none). The one path a file takes, and the one
 * tools/test-sql-drift.mjs runs against a real clone whose trigger was disabled, so a break here is seen there.
 * @param {string} cloneUrl
 * @returns {Promise<{ calls: { name: string, calls: string }[], failure: string | null }>}
 */
export async function readAfterFile(cloneUrl) {
  const after = await psqlLinesAsync(cloneUrl, afterFileSql);
  if (after.error) return { calls: [], failure: `could not read the drift and the function statistics:\n${after.error}` };
  const got = parseAfterFile(after.lines);
  return { calls: got.calls, failure: driftFailure(got.drift) };
}

/**
 * Client reads the statistics cannot count, each with the reason. Postgres counts a call when it returns, so a function whose
 * only work is to raise is never counted, however often it is called. `screen_refusal` is that function (0094): it is reached
 * only from a screen's refused argument, and tests/0096-thread-page.sql asserts the refusal it raises. Not a way to excuse a
 * read nobody tests: an entry is a function that always raises, and the reason says so.
 */
export const UNCOUNTABLE_READS = Object.freeze({
  screen_refusal: 'it only raises, and a call that raises is not counted; supabase/tests/0096-thread-page.sql asserts its refusal through thread_page',
});

/**
 * The stable functions among the client reads (ALLOWED_RPCS, tools/check-web-reads.mjs) that no test called: `stableNames`
 * are the reads that are stable functions in `public`, `callRows` the `{ name, calls }` Postgres's function statistics hold
 * for them (summed over overloads). A name with no row, or a row with no calls, is uncalled. Sorted. Pure, so
 * tools/test-sql-coverage.mjs drives it red on a planted name.
 * @param {string[]} stableNames
 * @param {{ name: string, calls: number | string }[]} callRows
 */
export function uncalledReads(stableNames, callRows) {
  const calls = new Map();
  for (const r of callRows) calls.set(r.name, (calls.get(r.name) ?? 0) + Number(r.calls));
  return stableNames.filter((n) => !((calls.get(n) ?? 0) > 0)).sort();
}

/**
 * SQL with its comments blanked and its single-quoted strings emptied, in one pass that knows which it is in: a `--` inside a string (a URL's
 * `xn--`) is not a comment, and a quote inside a comment is not a string. Dollar-quoted bodies are code and are left as they are. Pure.
 * @param {string} sql
 */
export function codeOnly(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const two = sql.slice(i, i + 2);
    if (two === '--') { const nl = sql.indexOf('\n', i); i = nl < 0 ? sql.length : nl; out += ' '; }
    else if (two === '/*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; out += ' '; }
    else if (sql[i] === "'") {
      const escaped = /[eE]$/.test(out) && !/\w[eE]$/.test(out);
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (escaped && sql[j] === '\\') j++;
        else if (sql[j] === "'") { if (sql[j + 1] === "'") j++; else break; }
      }
      /* A string that names an EXPLAIN ANALYZE's time stays as a token, since a value read from it is a measured time (holdsClockBudget). */
      out += /\b(?:execution|planning) time\b/i.test(sql.slice(i, j + 1)) ? "'EXPLAIN_TIME'" : "''"; i = j + 1;
    } else out += sql[i++];
  }
  return out;
}

/**
 * SQL with its block comments blanked and everything else kept, in one pass that knows a line comment, a string and a block comment apart: a `/*` inside a
 * `--` comment or a string opens nothing, and block comments nest, as Postgres's do. Pure.
 * @param {string} sql
 */
export function withoutBlockComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const two = sql.slice(i, i + 2);
    if (two === '--') { const nl = sql.indexOf('\n', i); const end = nl < 0 ? sql.length : nl; out += sql.slice(i, end); i = end; }
    else if (two === '/*') {
      let depth = 1;
      let j = i + 2;
      for (; j < sql.length && depth > 0; j++) {
        if (sql.startsWith('/*', j)) { depth++; j++; } else if (sql.startsWith('*/', j)) { depth--; j++; }
      }
      out += ' '; i = j;
    } else if (sql[i] === "'") {
      let j = i + 1;
      for (; j < sql.length; j++) if (sql[j] === "'") { if (sql[j + 1] === "'") j++; else break; }
      out += sql.slice(i, j + 1); i = j + 1;
    } else out += sql[i++];
  }
  return out;
}

/**
 * The marker a file carries to run alone (#1099): a line comment, on a line of its own, `-- kayfabb-sql: alone`, spelled exactly, with LF or CRLF line
 * ends. A marker inside a block comment, or misspelled, is not one. The file is the one list of what runs alone; the runner keeps no table.
 * @param {string} sql
 */
export const ALONE_MARKER = /^[ \t]*--[ \t]*kayfabb-sql:[ \t]*alone[ \t]*\r?$/m;
export const carriesAloneMarker = (sql) => ALONE_MARKER.test(withoutBlockComments(sql));

/**
 * Whether an assertion file holds a wall-clock budget: a `raise exception` (an `if … then raise exception`, or an `assert`) whose condition reads the
 * clock, directly (`clock_timestamp()` in the condition) or through an elapsed time (a variable that a statement assigned from `clock_timestamp()`
 * less a start that was itself assigned `clock_timestamp()`, or from an EXPLAIN ANALYZE's "Execution Time" or "Planning Time", or from another elapsed variable). That is a time measured and compared to a budget
 * or an interval, which what else runs on the machine changes. Not that: `clock_timestamp()` as a value (an id, a `slot`, `expires_at`, a timestamp
 * a row is written with), printed in a NOTICE, or waited for (`pg_sleep`), none of which a slow machine turns into a failure. Comments and the text of
 * strings are not read. Conservative where it must be (a SQL string built for another session is read as code), so a file it flags that is not timed
 * can be told apart by its condition; the rule is the tools/test-sql-refusal.mjs survey of every file. Pure.
 * @param {string} sql
 */
export function holdsClockBudget(sql) {
  const code = codeOnly(sql);
  const clock = /\bclock_timestamp\s*\(\s*\)/i;
  /* `name := expr;` and the declaration `name type := expr;`. */
  const assigns = [...code.matchAll(/\b([a-z_]\w*)\s*:=\s*([^;]*);|\b([a-z_]\w*)\s+(?:timestamptz|timestamp|interval|numeric|bigint|integer|int|double\s+precision|real|float8|text|date)\b[^;:=]*:=\s*([^;]*);/gi)]
    .map((m) => ({ name: (m[1] ?? m[3]).toLowerCase(), expr: m[2] ?? m[4] }));
  const starts = new Set(assigns.filter((a) => /^\s*clock_timestamp\s*\(\s*\)\s*$/i.test(a.expr)).map((a) => a.name));
  const mentions = (text, names) => [...names].some((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  /* A value read from an EXPLAIN ANALYZE's "Execution Time" or "Planning Time" is an elapsed time as well. */
  const elapsed = new Set(assigns.filter((a) => /'EXPLAIN_TIME'/.test(a.expr)).map((a) => a.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const a of assigns) {
      if (elapsed.has(a.name) || starts.has(a.name)) continue;
      if ((clock.test(a.expr) && mentions(a.expr, starts)) || mentions(a.expr, elapsed)) { elapsed.add(a.name); grew = true; }
    }
  }
  const readsClock = (cond) => clock.test(cond) || /'EXPLAIN_TIME'/.test(cond) || mentions(cond, elapsed);
  /* `if` and `elsif`: the condition runs to the `then` outside any parenthesis or CASE, and counts when the branch begins with `raise exception`. */
  for (const m of code.matchAll(/\b(?:if|elsif)\b/gi)) {
    /* Only an `if` that begins a statement: not `end if`, nor the `if exists` of a `drop` or `create`. */
    if (m[0].toLowerCase() === 'if' && !/(?:^|[;$]|\b(?:begin|then|else|loop))\s*$/i.test(code.slice(0, m.index))) continue;
    let depth = 0;
    let cases = 0;
    let at = m.index + m[0].length;
    for (const w of code.slice(at).matchAll(/[()]|\b(?:case|end|then)\b/gi)) {
      const t = w[0].toLowerCase();
      if (t === '(') depth++;
      else if (t === ')') depth--;
      else if (t === 'case') cases++;
      else if (t === 'end') cases--;
      else if (depth <= 0 && cases <= 0) {
        const cond = code.slice(at, at + w.index);
        if (/^\s*raise\s+exception\b/i.test(code.slice(at + w.index + 4)) && readsClock(cond)) return true;
        break;
      }
    }
  }
  if ([...code.matchAll(/\bassert\b([^;]*);/gi)].some((m) => readsClock(m[1]))) return true;
  /* A helper this file defines that raises (`pg_temp.expect(cond, message)`), called with a condition that reads the clock. */
  const raisers = [...code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:\w+\.)?(\w+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi)]
    .filter((m) => /\braise\s+exception\b/i.test(m[3])).map((m) => m[1]);
  return raisers.some((n) => [...code.matchAll(new RegExp(`\\b(?:\\w+\\.)?${n}\\s*\\(([^;]*)\\)\\s*;`, 'gi'))].some((m) => readsClock(m[1])));
}

/** An end-to-end file: four digits, a hyphen, a name. */
export const E2E_FILE = /^\d{4}-[\w.-]+\.ts$/;

/**
 * The migrations the upgrade tests cross, from the end-to-end files' names: a file named `NNNN-<name>-across-MMMM.ts` crosses
 * migration MMMM, and the runner keeps a snapshot of the database as it stood before MMMM (see main). The name is the one list.
 * A file with no `-across-` is not an upgrade test and names no point. Sorted, with no repeats; throws, naming the files, on a name
 * that says `-across-` and gives no four-digit point, on two files naming one point, and, given `migrationNames` (the migrations'
 * file names), on a point no migration has. Pure.
 * @param {string[]} e2eNames
 * @param {string[]} [migrationNames]
 */
export function snapshotPoints(e2eNames, migrationNames) {
  /** @type {Map<string, string>} */
  const named = new Map();
  for (const f of e2eNames) {
    const point = pointOfFile(f);
    if (point === null) continue;
    if (named.has(point)) throw new Error(`${named.get(point)} and ${f} both name the point ${point}; a point is one file's, since each file's snapshot is its own`);
    if (migrationNames && !migrationNames.some((m) => m.startsWith(`${point}_`))) throw new Error(`${f} names the point ${point}, and no migration in supabase/migrations/ begins ${point}_`);
    named.set(point, f);
  }
  return [...named.keys()].sort();
}

/**
 * The one parse of an end-to-end file's name: the migration it crosses (`NNNN-<name>-across-MMMM.ts` gives `MMMM`), or null for a file that is not an upgrade
 * test. Throws on a name that says `-across-` and gives no four-digit point, since the word is reserved for upgrade tests. Pure.
 * @param {string} name
 * @returns {string | null}
 */
export function pointOfFile(name) {
  const at = name.indexOf('-across-');
  if (at < 0) return null;
  const point = /^(\d{4})\.ts$/.exec(name.slice(at + '-across-'.length))?.[1];
  if (!point) throw new Error(`${name} says -across- but gives no point: the word is reserved for upgrade tests, which are named NNNN-<name>-across-MMMM.ts for the migration MMMM they cross`);
  return point;
}

/**
 * Why a suffix of a database made from a clone (`<clone>_<suffix>`, in supabase/tests/e2e/psql-db.ts) may not be used, or null: lowercase letters, digits and
 * underscores only (the name goes into SQL unquoted), and short enough that the whole name stays within the 63 bytes Postgres keeps of an identifier. Pure.
 * @param {string} clone
 * @param {string} suffix
 */
export function cloneSuffixError(clone, suffix) {
  if (!/^[a-z0-9_]+$/.test(suffix)) return `the suffix "${suffix}" must be lowercase letters, digits and underscores, at least one: it is part of a database name written into SQL`;
  const name = `${clone}_${suffix}`;
  if (Buffer.byteLength(name) > 63) return `the database name ${name} is ${Buffer.byteLength(name)} bytes, and Postgres keeps only 63 of an identifier: use a shorter suffix`;
  return null;
}

/**
 * Why an end-to-end file may not run, or null. A file replays no migrations of its own: the runner snapshots the replay it makes
 * for the template (`databaseBefore` and `migratedDatabase` in supabase/tests/e2e/psql-db.ts hand a file a clone of one), and a file
 * that reads the migrations itself goes back to replaying them, which is what the snapshots end. The text is read with its comments
 * blanked, as an assertion file's is.
 * @param {string} text
 */
export function e2eRefusal(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const read = ['supabase/migrations', 'migrationFiles'].find((w) => code.includes(w));
  return read ? `reads ${read}, which an end-to-end file may not: it takes a database from databaseBefore() or migratedDatabase() (supabase/tests/e2e/psql-db.ts), never by replaying the migrations itself` : null;
}

/** Whether a file's failure is its kill at FILE_TIMEOUT_MS (what killedWhy says), as opposed to an error it answered. */
const wasKilled = (err) => typeof err === 'string' && err.startsWith('did not finish within');
const timedOut = (err) => err.code === 'ETIMEDOUT' || (err.signal != null && err.status == null);
const killedWhy = () => `did not finish within ${FILE_TIMEOUT_MS / 1000}s and was killed: a hang that neither lock_timeout (${SESSION_BOUNDS.lock_timeout}) nor statement_timeout (${SESSION_BOUNDS.statement_timeout}) ended`;

/** Assertion files: four digits, a hyphen, a name. Ordered by number, then name. */
export const ASSERTION_FILE = /^(\d{4})-[\w.-]+\.sql$/;

/** Seconds, one decimal, of a duration in ms. */
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Every file of the suite, as the one sorted list the shards are cut from: the assertion files (every .sql in supabase/tests/, by
 * number then name, a name that is not NNNN-*.sql included, which fails when it is reached), then the end-to-end files, each named
 * `e2e/<file>` as its line prints. `e2eDir` is where the end-to-end files are (KAYFABB_SQL_E2E_DIR stands another in, for
 * tools/test-sql-refusal.mjs). The files on disk are the only list: the gathering step reads this too.
 * @param {string} [e2eDir]
 * @returns {{ names: string[], e2e: string[] }} `names` is the whole list, `e2e` the bare end-to-end file names
 */
export function suiteFiles(e2eDir = path.join(testsDir, 'e2e')) {
  const numberOf = (f) => Number(ASSERTION_FILE.exec(f)?.[1] ?? Number.NaN);
  const assertion = fs.readdirSync(suiteDir()).filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (numberOf(a) - numberOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
  const e2e = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => E2E_FILE.test(f)).sort() : [];
  return { names: [...assertion, ...e2e.map((f) => `e2e/${f}`)], e2e };
}

/**
 * The files of shard `i` of `n`: those at positions i, i+n, i+2n… of the list, counting from 1 (so shard 1 of 4 takes the 1st, 5th, 9th). Every
 * file is in exactly one shard, and nothing but the list says which. Throws on an `i` or `n` that is not a whole number, on `n < 1`, and
 * on `i` outside 1..n: a run that cannot say which files are its own runs none of them. Pure.
 * @param {string[]} files
 * @param {number} i
 * @param {number} n
 */
export function shardOf(files, i, n) {
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 1 || i > n) throw new Error(`shard ${i}/${n} is not a shard: i and n are whole numbers, n is at least 1, and i is from 1 to n`);
  return files.filter((_, at) => at % n === i - 1);
}

/** `--shard=i/n` as `[i, n]`; no flag is shard 1 of 1. Throws on anything else. Pure. @param {string | undefined} arg */
export function parseShard(arg) {
  if (arg === undefined) return [1, 1];
  const m = /^(\d+)\/(\d+)$/.exec(arg);
  if (!m) throw new Error(`--shard=${arg} is not i/n: two whole numbers, as --shard=2/4`);
  const [i, n] = [Number(m[1]), Number(m[2])];
  shardOf([], i, n);
  return [i, n];
}

/**
 * Every way a set of shard reports fails to cover the files: a report with no shard to name, a different total of shards from one report to
 * another, a shard number with no report, a file in no report, a file in two, a file that did not pass, and a file in a report that is not on disk. `reports` are what `--report`
 * wrote (`{ shard: { i, n }, files: [{ name, outcome, seconds }], calls }`), `allFiles` the files on disk (suiteFiles). One message each; none is
 * an empty list. Pure, so tools/test-sql-refusal.mjs plants each.
 * @param {any[]} reports each `{ shard: { i, n }, files: [{ name, outcome, seconds }], calls }` as `--report` wrote it, or whatever a stale or foreign file held
 * @param {string[]} allFiles
 */
export function gatherFailures(reports, allFiles) {
  if (!reports.length) return ['no shard report was found, so nothing says that any file ran'];
  const failures = [];
  /* A report that cannot be read as one is named, by its place in the list, and left out of what follows: a null, no shard, a files list that is not a list or holds
     a null, or no calls list (the summed reads need it). */
  const named = [];
  reports.forEach((r, k) => {
    const problems = [];
    if (!r || typeof r !== 'object') problems.push('it is not an object');
    else {
      if (!Number.isInteger(r.shard?.i) || !Number.isInteger(r.shard?.n)) problems.push('no shard {i, n}');
      if (!Array.isArray(r.files)) problems.push('files is not a list');
      else if (r.files.some((f) => !f || typeof f.name !== 'string')) problems.push('a file entry is not { name, outcome, seconds }');
      if (!Array.isArray(r.calls)) problems.push('calls is not a list');
    }
    if (problems.length) failures.push(`report ${k + 1}${r?.shard ? ` (shard ${r.shard.i}/${r.shard.n})` : ''} is malformed: ${problems.join('; ')}`);
    else named.push(r);
  });
  const totals = [...new Set(named.map((r) => r.shard.n))].sort((a, b) => a - b);
  if (totals.length > 1) failures.push(`the reports disagree on how many shards there are: ${totals.join(' and ')}`);
  const n = Math.max(0, ...totals);
  for (let k = 1; k <= n; k++) if (!named.some((r) => r.shard.i === k)) failures.push(`shard ${k}/${n} has no report`);
  /** @type {Map<string, { shard: string, outcome: string }[]>} */
  const seen = new Map();
  for (const r of named) for (const f of r.files) seen.set(f.name, [...(seen.get(f.name) ?? []), { shard: `${r.shard.i}/${r.shard.n}`, outcome: f.outcome }]);
  for (const [name, ran] of seen) if (!allFiles.includes(name)) failures.push(`${name} is in a report (shard ${ran.map((x) => x.shard).join(', ')}) but not on disk: a stale or foreign report`);
  for (const name of allFiles) {
    const ran = seen.get(name) ?? [];
    if (!ran.length) failures.push(`${name} is in no report: no shard ran it`);
    else if (ran.length > 1) failures.push(`${name} is in ${ran.length} reports (shards ${ran.map((x) => x.shard).join(', ')}): a file runs once`);
    else if (ran[0].outcome !== 'passed') failures.push(`${name} did not pass (${ran[0].outcome}) in shard ${ran[0].shard}`);
  }
  return failures;
}

/**
 * Why the client reads are not all called, or null: the counts of every report summed, then `uncalledReads` on the sum. A read one file leaves
 * uncalled is another's to call, and another shard's, so the comparison is on every file of every shard.
 * @param {{ calls: { name: string, calls: number | string }[] }[]} reports
 */
export function coverageFailure(reports) {
  /* A report with no calls list is malformed, and named so by gatherFailures; it adds nothing here. */
  const summed = sumCalls(reports.filter((r) => Array.isArray(r?.calls)).map((r) => r.calls));
  const uncalled = uncalledReads(summed.map((r) => r.name).filter((n) => !(n in UNCOUNTABLE_READS)), summed);
  return uncalled.length
    ? `${uncalled.length} client read(s) in ALLOWED_RPCS no test called: ${uncalled.join(', ')}\n`
      + 'A client read no test calls is one whose broken reference nothing would find; add a call to the assertion file that tests it.'
    : null;
}

/** Every `.json` file under a directory, however deep (a downloaded artifact is one folder each), by path. */
function jsonFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsonFilesUnder(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : [])).sort();
}

/** `--gather=<dir>`: every report in the directory against the files on disk. No database, so no refusal of one applies. */
function gather(dir) {
  const problems = [];
  const reports = [];
  try {
    for (const f of jsonFilesUnder(dir)) {
      try { reports.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (err) { problems.push(`${f} is not a readable report: ${err.message}`); }
    }
  } catch (err) { problems.push(`could not read ${dir}: ${err.message}`); }
  const { names } = suiteFiles(process.env.KAYFABB_SQL_E2E_DIR || undefined);
  console.log(`\nsql: gather ${reports.length} report(s) from ${dir}, ${names.length} file(s) on disk`);
  problems.push(...gatherFailures(reports, names));
  if (reports.length) {
    const unread = coverageFailure(reports);
    if (unread) problems.push(unread);
  }
  for (const p of problems) console.log(`  FAIL  ${p.split('\n').join('\n        ')}`);
  if (!problems.length) console.log(`  PASS  every file ran once, in one of ${reports.length} shard(s), and passed; every client read was called`);
  return problems.length ? 1 : 0;
}

/** How many files run at once: KAYFABB_SQL_WORKERS, or one for each CPU. */
const workerCount = () => (Number(process.env.KAYFABB_SQL_WORKERS) >= 1 ? Math.floor(Number(process.env.KAYFABB_SQL_WORKERS)) : os.availableParallelism());

/**
 * Runs `work` over `items` with at most `limit` in flight, taking them in order; resolves with every result in the items' order. A work that
 * rejects rejects the pool, so `work` answers its failures as values.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
export async function pool(items, limit, work) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => { for (let at = next++; at < items.length; at = next++) results[at] = await work(items[at]); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/**
 * The template, built the one way for the suite and for tools/test-sql-drift.mjs: create the database with its settings (one call, so a failure may leave it made:
 * the caller drops it), the shim, every migration in name order with a snapshot of the replay before each of `points`, one `migrated` snapshot after the last
 * migration and before the fixtures when `migrated`, the fixtures, then the one `vacuum (analyze)`. `step(label, error)` is told of each and answers whether to go
 * on; `say(heading)` of the stretch of migrations. Answers `{ ok, snapshots, migrations, migrationFailed }`: `snapshots` maps each point, and `migrated`, to the
 * database kept for it, and the caller drops them with the template.
 * @param {string} url any URL on the server
 * @param {string} template
 * @param {{ points?: string[], migrated?: boolean, step?: (label: string, error: string | null) => boolean, say?: (heading: string) => void }} [options]
 */
export async function buildTemplate(url, template, { points = [], migrated = false, step = (_, error) => !error, say = () => {} } = {}) {
  const templateUrl = withDatabase(url, template);
  /** @type {Record<string, string>} */
  const snapshots = {};
  const result = (ok, extra = {}) => ({ ok, snapshots, migrations: [], migrationFailed: false, ...extra });
  const run = async (label, target, sql) => step(label, (await psqlAsync(target, sql)).error);
  if (!await run('create', url, `create database ${template};\n${settingsSql(template, url)}`)) return result(false);
  const [shimFile, ...migrationPaths] = migrationFiles();
  if (!await run('setup/auth-shim.sql', templateUrl, fs.readFileSync(shimFile, 'utf8'))) return result(false);
  say('migrations, from zero');
  const migrations = migrationPaths.map((f) => path.basename(f));
  /* Each migration's psql has ended, so nothing is connected to the template and `create database … template` may read it. */
  const snapshot = async (key, name) => {
    if (!await run(`snapshot ${key}`, url, cloneSql(template, name, url))) return false;
    snapshots[key] = name;
    return true;
  };
  for (const m of migrations) {
    const point = points.find((p) => m.startsWith(`${p}_`));
    if (point && !await snapshot(point, `${template}_s${point}`)) return result(false, { migrations });
    if (!await run(m, templateUrl, fs.readFileSync(path.join(migrationsDir, m), 'utf8'))) return result(false, { migrations, migrationFailed: true });
  }
  if (migrated && !await snapshot('migrated', `${template}_migrated`)) return result(false, { migrations });
  if (!await run('setup/fixtures.sql', templateUrl, fs.readFileSync(fixtures, 'utf8'))) return result(false, { migrations });
  /* Once, here: every clone starts from this analyzed state. */
  if (!await run('vacuum (analyze)', templateUrl, 'vacuum (analyze);')) return result(false, { migrations });
  return result(true, { migrations });
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Map();
  for (const a of args.filter((x) => x.startsWith('--'))) {
    const m = /^--(shard|report|gather)=(.*)$/.exec(a);
    if (!m) { console.error(`  test-sql: unknown option ${a} (--shard=i/n, --report=<path>, --gather=<dir>)`); return 2; }
    flags.set(m[1], m[2]);
  }
  const pattern = args.find((a) => !a.startsWith('--')) ?? '';
  if (flags.has('gather')) return gather(flags.get('gather'));

  const url = process.env.DATABASE_URL;
  const why = refusal(url);
  if (why) { console.error(`  test-sql: ${why}`); process.exit(2); }

  /* Which shard this is, which files there are and which migrations the end-to-end files cross, before anything is made: a shard that is
     not one, a name that gives no point, two that give one, or a point no migration has fails the run here, with no database touched. */
  let shardI;
  let shardN;
  try { [shardI, shardN] = parseShard(flags.get('shard')); } catch (err) { console.error(`  test-sql: ${err.message}`); return 1; }
  const everything = suiteFiles(process.env.KAYFABB_SQL_E2E_DIR || undefined);
  const e2eDir = process.env.KAYFABB_SQL_E2E_DIR || path.join(testsDir, 'e2e');
  const migrationNames = migrationFiles().slice(1).map((f) => path.basename(f));
  let allPoints;
  try { allPoints = snapshotPoints(everything.e2e, migrationNames); } catch (err) { console.error(`  test-sql: ${err.message}`); return 1; }
  /* This shard's files of the one list, then the pattern's among them (a pattern also takes an end-to-end file by its label, `e2e/0001`, which is its name). */
  const selected = shardOf(everything.names, shardI, shardN).filter((f) => f.includes(pattern));
  if (pattern && !selected.length) { console.error(`  test-sql: no file in supabase/tests/ or supabase/tests/e2e/ in shard ${shardI}/${shardN} has a name containing "${pattern}", so nothing ran`); return 1; }
  const selectedE2e = selected.filter((f) => f.startsWith('e2e/')).map((f) => f.slice(4));
  /* A snapshot of the replay for each point a selected file names, and the migrated one, are made while the template is built, and only then. */
  const points = allPoints.filter((p) => selectedE2e.some((f) => pointOfFile(f) === p));
  /** @type {Record<string, string>} point to the database that holds the replay before it, and `migrated` */
  const snapshots = {};
  const template = `kayfabb_scratch_${process.pid}_${Date.now()}`;
  /* An interrupt, or a terminate, ends the run here (the `finally` below is not reached by a signal): exit 130 or 143 after the sweep. The template's build
     awaits each of its steps (one psql each), so the handler runs between them and kills the one in flight, the build included. */
  sweep = { url, template };
  process.on('SIGINT', () => leave(130));
  process.on('SIGTERM', () => leave(143));
  const keepFailed = process.env.KAYFABB_SQL_KEEP === 'failed';
  const workers = workerCount();
  const step = (label, err) => {
    console.log(`  ${err ? 'FAIL' : 'PASS'}  ${label}${err ? `\n        ${err.split('\n').join('\n        ')}` : ''}`);
    return !err;
  };

  /** What a file would have to be to run, or why it may not: its text for an assertion file, nothing more to read for an end-to-end one. */
  const refused = (name) => {
    if (name.startsWith('e2e/')) return { why: e2eRefusal(fs.readFileSync(path.join(e2eDir, name.slice(4)), 'utf8')) };
    if (!ASSERTION_FILE.test(name)) return { why: 'an .sql file in supabase/tests/ that is not NNNN-*.sql would never run; rename it or move it under setup/' };
    const sql = fs.readFileSync(path.join(suiteDir(), name), 'utf8');
    const code = withoutComments(sql);
    if (!/raise\s+exception/i.test(code)) return { why: 'asserts nothing: no `raise exception` outside a comment in this file' };
    if (/(^|;)\s*(commit|rollback(?!\s+to\b))\b/im.test(withoutDollarQuotes(code))) return { why: 'ends its own transaction, which would escape the rollback around it' };
    const blind = nullBlind(code);
    if (blind.length) return { why: `passes when its select finds no row; use \`is distinct from\`:\n          ${blind.join('\n          ')}` };
    const timedFile = holdsClockBudget(sql);
    const marked = carriesAloneMarker(sql);
    if (timedFile && !marked) return { why: 'holds a wall-clock budget (a time measured with clock_timestamp() and compared in a raise), which another file on the runner can make it miss: add the line `-- kayfabb-sql: alone` near the top, so that it runs with nothing beside it (#1099)' };
    if (marked && !timedFile) return { why: 'carries `-- kayfabb-sql: alone` but holds no wall-clock budget, and the marker means what it says: take it off, or add the budget it is for (#1099)' };
    return { why: null, sql, alone: marked };
  };

  /**
   * One file, from its clone to its drop: make the clone of the template, run the file on it, read the drift and the counts, drop the clone, pass or
   * fail (kept, with its URL, when KAYFABB_SQL_KEEP=failed and the file failed). Answers the result as a value, with the block of text the file prints
   * when it ends, so lines of files running together never interleave. The clone's name is the template's and the file's place in the run.
   */
  const runFile = async (name, place, read) => {
    const block = (err, ms, extra = '') => `  ${err ? 'FAIL' : 'PASS'}  ${name}${ms === undefined ? '' : `  ${seconds(ms)}`}${err ? `\n        ${err.split('\n').join('\n        ')}` : ''}${extra}`;
    if (read.why) return { name, outcome: 'failed', seconds: 0, calls: [], text: block(read.why) };
    const clone = `${template}_${place}`;
    const cloneUrl = withDatabase(url, clone);
    const began = Date.now();
    let err = (await psqlAsync(url, cloneSql(template, clone, url))).error;
    let calls = [];
    let kept = false;
    let extra = '';
    try {
      if (!err) {
        err = name.startsWith('e2e/') ? await runE2e(name.slice(4), cloneUrl) : await runAssertion(read.sql, cloneUrl);
        /* Read after the file, before the drop, even from a file that failed: its calls count, and its drift is named if the file itself was fine.
           Not from a file that was killed: its backend may be the one that is stuck, and a read on its clone could wait out the file bound again. */
        const got = wasKilled(err) ? null : await readAfterFile(cloneUrl);
        if (got) { calls = got.calls; err ??= got.failure; }
      }
      if (err && keepFailed) { kept = true; extra = `\n        kept: ${cloneUrl}`; }
    } finally {
      if (!kept) {
        /* What a file made and named after its clone (`<clone>_<suffix>`, a database from psql-db.ts) goes with it, so a file that died
           before its `finally` leaves nothing. `_` is a wildcard in `like`, so it is escaped; `<clone>_1` and `<clone>_10` stay apart
           since the clone's own number is followed by the underscore. */
        const children = (await psqlAsync(url, `select format('drop database if exists %I with (force)', datname) from pg_database where datname like '${clone}\\_%' \\gexec`)).error;
        if (children) console.error(`  test-sql: could not drop what is named for ${clone}: ${children}`);
        const dropped = (await psqlAsync(url, `drop database if exists ${clone} with (force);`)).error;
        if (dropped) console.error(`  test-sql: could not drop ${clone}: ${dropped}`);
      }
    }
    const ms = Date.now() - began;
    return { name, outcome: err ? 'failed' : 'passed', seconds: Math.round(ms) / 1000, calls, text: block(err, ms, extra) };
  };
  /* `begin;` on its own line before the file, so a file's line N is line N+1 of what psql reads and the `psql:<stdin>:N:` in an error means what it always did. */
  const runAssertion = async (sql, cloneUrl) => (await psqlAsync(cloneUrl, `begin;\n${sql}\nrollback;\n`)).error;
  /* End to end: TypeScript that runs the Edge Functions' own core against its clone
     (supabase/tests/e2e/NNNN-*.ts, Node's test runner), so the contract between the
     engine and the SQL is read where both meet. */
  const runE2e = async (file, cloneUrl) => {
    const r = await exec(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', path.join(e2eDir, file)], {
      env: { ...process.env, KAYFABB_SCRATCH_URL: cloneUrl, KAYFABB_SNAPSHOTS: JSON.stringify(snapshots) },
    });
    return r.code === 0 && !r.killed ? null : (r.killed ? `${killedWhy()}\n` : '') + r.out + r.err;
  };

  console.log(`\nsql: template database ${template}`);
  try {
    const built = await buildTemplate(url, template, {
      points, migrated: selectedE2e.length > 0, step,
      say: (what) => console.log(`\nsql: ${what}`),
    });
    Object.assign(snapshots, built.snapshots);
    if (!built.ok) {
      if (built.migrationFailed) console.error('\n  a migration failed; the schema is not replayable from zero');
      return 1;
    }
    const migrations = built.migrations;

    console.log(`\nsql: ${selected.length} file(s)${pattern ? ` matching "${pattern}"` : ''}${shardN > 1 ? `, shard ${shardI}/${shardN}` : ''}, ${Math.min(workers, selected.length)} at a time`);
    /* A file that runs alone (its marker, `-- kayfabb-sql: alone`) is held to the end: every other file runs in the pool first, then each marked file on its
       own, one at a time, with nothing else of this runner in flight. One pass at the end is the simplest schedule that is right, and it keeps the pool full for
       as long as there are other files, where waiting for a drain at each marked file's turn would leave workers idle each time. */
    const items = selected.map((name, at) => {
      /* What a file is, read once: a file the runner cannot read fails its own line, and never the run. */
      let read;
      try { read = refused(name); } catch (err) { read = { why: `could not read the file: ${err.message}` }; }
      return { name, place: at + 1, read, alone: Boolean(read.alone) };
    });
    /* The pool's contract is that `work` never rejects: whatever a file throws becomes that file's failed result. */
    const runItem = async ({ name, place, read }) => {
      let r;
      try { r = await runFile(name, place, read); } catch (err) {
        r = { name, outcome: 'failed', seconds: 0, calls: [], text: `  FAIL  ${name}\n        the runner failed on this file: ${err?.stack ?? err}` };
      }
      console.log(r.text);
      return r;
    };
    const pooledResults = await pool(items.filter((i) => !i.alone), workers, runItem);
    const aloneResults = await pool(items.filter((i) => i.alone), 1, runItem);
    /* The report lists the files in the one list's order, however they were scheduled. */
    const results = selected.map((name) => [...pooledResults, ...aloneResults].find((r) => r.name === name));
    const failed = results.filter((r) => r.outcome !== 'passed').length;
    const report = { shard: { i: shardI, n: shardN }, files: results.map((r) => ({ name: r.name, outcome: r.outcome, seconds: r.seconds })), calls: sumCalls(results.map((r) => r.calls)) };
    if (flags.has('report')) fs.writeFileSync(flags.get('report'), `${JSON.stringify(report, null, 1)}\n`);

    /* The files that ran, against the files on disk, and the client reads no test calls (a plpgsql body is checked only when it runs, so a
       broken reference nothing calls is found by nothing). Both are about the whole suite: a pattern or a shard runs part of it and cannot say. A
       run that is the whole suite makes the comparison in this process, the one a gathering job makes over every shard's report. */
    console.log('\nsql: coverage');
    let compared = 0;
    if (pattern || shardN > 1) console.log(`  skipped: ${pattern ? 'a pattern runs part of the suite' : `shard ${shardI}/${shardN} runs part of the suite, and \`--gather\` compares every shard's report`}`);
    else {
      const uncovered = gatherFailures([report], everything.names);
      for (const f of uncovered) step('files', f);
      const unread = coverageFailure([report]);
      step('coverage', unread);
      compared = uncovered.length + (unread ? 1 : 0);
    }
    console.log(`\nsql: slowest files`);
    for (const t of [...results].filter((r) => r.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 10)) console.log(`  ${`${t.seconds.toFixed(1)}s`.padStart(7)}  ${t.name}`);
    console.log(`\n  sql: ${migrations.length} migration(s); ${selected.length - selectedE2e.length} assertion file(s); ${selectedE2e.length} end-to-end file(s); ${failed} failed`);
    return failed || compared ? 1 : 0;
  } finally {
    for (const snap of Object.values(snapshots)) {
      const gone = psql(url, `drop database if exists ${snap} with (force);`);
      if (gone) console.error(`  test-sql: could not drop ${snap}: ${gone}`);
    }
    const err = psql(url, `drop database if exists ${template} with (force);`);
    if (err) console.error(`  test-sql: could not drop ${template}: ${err}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
