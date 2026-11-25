/**
 * The SQL suite: every migration replayed from zero into a template database, then every assertion file under
 * supabase/tests/ and every end-to-end file under supabase/tests/e2e/ on a clone of it, one clone a file.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run test:sql
 *   DATABASE_URL=… npm run test:sql -- 0420          (only the files whose names contain 0420)
 *   KAYFABB_SQL_KEEP=failed …                        (a failing file's clone is kept, and its URL printed)
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
 * Settings do not travel with a clone: `alter database … set` is stored for the database it names, so a clone of a bounded
 * template has no bounds. So each clone is given its own, in the call that makes it, before anything connects to it
 * (cloneSql): SESSION_BOUNDS, `track_functions`, `kayfabb.client_rpcs`, and `kayfabb.scratch_url` naming the clone itself,
 * so a race test's dblink sessions open on its own clone. The template gets the same, since the shim and the migrations
 * run on it. supabase/tests/0000-harness.sql goes red on a clone without them ("this file's connection is unbounded").
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
 * a part of the suite and skips that comparison.
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
import { execFileSync } from 'node:child_process';
import { ALLOWED_RPCS } from './check-web-reads.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const testsDir = path.join(repoRoot, 'supabase/tests');
const shim = path.join(testsDir, 'setup/auth-shim.sql');
const fixtures = path.join(testsDir, 'setup/fixtures.sql');

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

function psql(url, sql) {
  try {
    execFileSync(PSQL.file, [...PSQL.args, '-v', 'ON_ERROR_STOP=1', '-q', '-X', url, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('\n  psql not found; run scripts/setup-container.sh'); process.exit(2); }
    if (timedOut(err)) return killedWhy();
    return (err.stderr || err.stdout || String(err)).trim();
  }
}

/** Like psql, but answers the lines of what its queries print, unaligned and `|`-separated, or the error. @returns {{ lines: string[], error: string | null }} */
function psqlLines(url, sql) {
  try {
    const out = execFileSync(PSQL.file, [...PSQL.args, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t', '-F', '|', url, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return { lines: String(out).split('\n'), error: null };
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('\n  psql not found; run scripts/setup-container.sh'); process.exit(2); }
    return { lines: [], error: timedOut(err) ? killedWhy() : (err.stderr || err.stdout || String(err)).trim() };
  }
}

/** The rows of one query as `name|count` pairs, or the error. @returns {{ rows: { name: string, calls: string }[], error: string | null }} */
function psqlRows(url, sql) {
  const { lines, error } = psqlLines(url, sql);
  return { rows: lines.filter((l) => l.includes('|')).map((l) => { const [name, calls] = l.split('|'); return { name, calls }; }), error };
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
 * is stored for the database it names and is not copied by `create database … template`, so a clone made without these has no bounds,
 * no function counts and no scratch URL. All of it is sent before anything connects to the clone.
 */
export const cloneSql = (template, clone, url) => `create database ${clone} template ${template};\n${settingsSql(clone, url)}`;

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

/** Why the drift check failed, or null: `rows` are the `{ name: play, calls: why }` pairs psqlRows read. Pure, so tools/test-sql-refusal.mjs drives it. */
export function driftFailure(rows) {
  if (!rows.length) return null;
  return `play_post or post_kinds differs from the Acts (play_post_drift() names ${rows.length === DRIFT_ROWS ? `at least ${DRIFT_ROWS}` : rows.length} row(s)):\n${rows.map((r) => `${r.name}  ${r.calls}`).join('\n')}`;
}

/**
 * The drift check on one database: why it failed (the rows play_post_drift() names, or the error that stopped the query), or null.
 * tools/test-sql-drift.mjs drives it red against a real database whose trigger was disabled.
 * @param {string} url
 */
export function driftCheck(url) {
  const drifted = psqlRows(url, driftSql);
  return drifted.error ? `could not run play_post_drift():\n${drifted.error}` : driftFailure(drifted.rows);
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

const timedOut = (err) => err.code === 'ETIMEDOUT' || (err.signal != null && err.status == null);
const killedWhy = () => `did not finish within ${FILE_TIMEOUT_MS / 1000}s and was killed: a hang that neither lock_timeout (${SESSION_BOUNDS.lock_timeout}) nor statement_timeout (${SESSION_BOUNDS.statement_timeout}) ended`;

/** Assertion files: four digits, a hyphen, a name. Ordered by number, then name. */
export const ASSERTION_FILE = /^(\d{4})-[\w.-]+\.sql$/;

/** Seconds, one decimal, of a duration in ms. */
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function main() {
  const url = process.env.DATABASE_URL;
  const why = refusal(url);
  if (why) { console.error(`  test-sql: ${why}`); process.exit(2); }

  const template = `kayfabb_scratch_${process.pid}_${Date.now()}`;
  const templateUrl = withDatabase(url, template);
  const pattern = process.argv[2] ?? '';
  const keepFailed = process.env.KAYFABB_SQL_KEEP === 'failed';
  let failed = 0;
  const timings = [];
  /** @type {{ name: string, calls: string }[][]} */
  const counts = [];
  const step = (label, err, ms) => {
    console.log(`  ${err ? 'FAIL' : 'PASS'}  ${label}${ms === undefined ? '' : `  ${seconds(ms)}`}${err ? `\n        ${err.split('\n').join('\n        ')}` : ''}`);
    if (err) failed++;
    if (ms !== undefined) timings.push({ label, ms });
    return !err;
  };

  /* One file on a clone of its own: make it, run the file on it, read the drift and the counts, then drop it, pass or fail (kept, with
     its URL, when KAYFABB_SQL_KEEP=failed and the file failed). `run` is given the clone's URL and answers why the file failed, or null. */
  let clones = 0;
  const onClone = (label, run) => {
    const clone = `${template}_${++clones}`;
    const cloneUrl = withDatabase(url, clone);
    const began = Date.now();
    let err = psql(url, cloneSql(template, clone, url));
    let kept = false;
    try {
      if (!err) {
        err = run(cloneUrl);
        /* Read after the file, before the drop, even from a file that failed: its calls count, and its drift is named if the file itself was fine. */
        const after = psqlLines(cloneUrl, afterFileSql);
        if (after.error) err ??= `could not read the drift and the function statistics:\n${after.error}`;
        else {
          const read = parseAfterFile(after.lines);
          counts.push(read.calls);
          err ??= driftFailure(read.drift);
        }
      }
      step(label, err, Date.now() - began);
      if (err && keepFailed) { kept = true; console.log(`        kept: ${cloneUrl}`); }
    } finally {
      if (!kept) {
        const dropped = psql(url, `drop database if exists ${clone} with (force);`);
        if (dropped) console.error(`  test-sql: could not drop ${clone}: ${dropped}`);
      }
    }
  };

  console.log(`\nsql: template database ${template}`);
  if (!step('create', psql(url, `create database ${template};\n${settingsSql(template, url)}`))) process.exit(1);
  try {
    const [shimFile, ...migrationPaths] = migrationFiles();
    if (!step('setup/auth-shim.sql', psql(templateUrl, fs.readFileSync(shimFile, 'utf8')))) return 1;

    console.log('\nsql: migrations, from zero');
    const migrations = migrationPaths.map((f) => path.basename(f));
    for (const m of migrations) {
      if (!step(m, psql(templateUrl, fs.readFileSync(path.join(migrationsDir, m), 'utf8')))) {
        console.error('\n  a migration failed; the schema is not replayable from zero');
        return 1;
      }
    }

    if (!step('setup/fixtures.sql', psql(templateUrl, fs.readFileSync(fixtures, 'utf8')))) return 1;
    /* Once, here: every clone starts from this analyzed state. */
    if (!step('vacuum (analyze)', psql(templateUrl, 'vacuum (analyze);'))) return 1;

    console.log(`\nsql: assertions${pattern ? ` matching "${pattern}"` : ''}`);
    const numberOf = (f) => Number(ASSERTION_FILE.exec(f)?.[1] ?? Number.NaN);
    const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.sql') && f.includes(pattern))
      .sort((a, b) => (numberOf(a) - numberOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
    let ran = 0;
    for (const t of files) {
      if (!ASSERTION_FILE.test(t)) { step(t, 'an .sql file in supabase/tests/ that is not NNNN-*.sql would never run; rename it or move it under setup/'); continue; }
      const sql = fs.readFileSync(path.join(testsDir, t), 'utf8');
      const code = withoutComments(sql);
      if (!/raise\s+exception/i.test(code)) { step(t, 'asserts nothing: no `raise exception` outside a comment in this file'); continue; }
      if (/(^|;)\s*(commit|rollback(?!\s+to\b))\b/im.test(withoutDollarQuotes(code))) { step(t, 'ends its own transaction, which would escape the rollback around it'); continue; }
      const blind = nullBlind(code);
      if (blind.length) { step(t, `passes when its select finds no row; use \`is distinct from\`:\n          ${blind.join('\n          ')}`); continue; }
      ran++;
      /* `begin;` on its own line before the file, so a file's line N is line N+1 of what psql reads and the `psql:<stdin>:N:` in an error means what it always did. */
      onClone(t, (cloneUrl) => psql(cloneUrl, `begin;\n${sql}\nrollback;\n`));
    }
    /* End to end: TypeScript that runs the Edge Functions' own core against its clone
       (supabase/tests/e2e/NNNN-*.ts, Node's test runner), so the contract between the
       engine and the SQL is read where both meet. */
    console.log('\nsql: end to end');
    const e2eDir = path.join(testsDir, 'e2e');
    const e2e = (fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => /^\d{4}-[\w.-]+\.ts$/.test(f)).sort() : []).filter((f) => f.includes(pattern));
    for (const f of e2e) {
      onClone(`e2e/${f}`, (cloneUrl) => {
        try {
          execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', path.join(e2eDir, f)], {
            env: { ...process.env, KAYFABB_SCRATCH_URL: cloneUrl }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL',
          });
          return null;
        } catch (err) {
          return (timedOut(err) ? `${killedWhy()}\n` : '') + String(err.stdout || '') + String(err.stderr || '');
        }
      });
    }
    if (!files.length && !e2e.length) step('pattern', `no file in supabase/tests/ or supabase/tests/e2e/ has a name containing "${pattern}", so nothing ran`);
    /* A client read no test calls is one whose broken reference nothing would find: a plpgsql body is checked only when
       it runs. The counts of every file's clone, summed; a run of part of the suite cannot say which reads the rest would call. */
    console.log('\nsql: coverage');
    if (pattern) console.log('  skipped: a pattern runs part of the suite');
    else {
      const summed = sumCalls(counts);
      const uncalled = uncalledReads(summed.map((r) => r.name).filter((n) => !(n in UNCOUNTABLE_READS)), summed);
      step('coverage', uncalled.length
        ? `${uncalled.length} client read(s) in ALLOWED_RPCS no test called: ${uncalled.join(', ')}\n`
          + 'A client read no test calls is one whose broken reference nothing would find; add a call to the assertion file that tests it.'
        : null);
    }
    console.log(`\nsql: slowest files`);
    for (const t of [...timings].sort((a, b) => b.ms - a.ms).slice(0, 10)) console.log(`  ${seconds(t.ms).padStart(7)}  ${t.label}`);
    console.log(`\n  sql: ${migrations.length} migration(s); ${ran} assertion file(s); ${e2e.length} end-to-end file(s); ${failed} failed`);
    return failed ? 1 : 0;
  } finally {
    const err = psql(url, `drop database if exists ${template} with (force);`);
    if (err) console.error(`  test-sql: could not drop ${template}: ${err}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
