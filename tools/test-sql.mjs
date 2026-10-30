/**
 * The SQL suite: every migration replayed from zero into a scratch database, then every
 * assertion file under supabase/tests/.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run test:sql
 *
 * Each run creates a database of its own on the server DATABASE_URL names
 * (`kayfabb_scratch_<pid>_<time>`), applies supabase/tests/setup/auth-shim.sql (a stand-in for
 * what Supabase provides before any migration: the API roles, `auth.uid()` read from the
 * claims a test sets), then every supabase/migrations/*.sql in name order, then
 * supabase/tests/setup/fixtures.sql (a test instance's vocabulary and helpers that make
 * players, characters and posts), then each supabase/tests/NNNN-*.sql in number order, and drops the database at the end, pass or fail.
 * A scratch database rather than a scratch schema, because the migrations are written for
 * Supabase's own `public` and `auth` and must run here exactly as they will there; the
 * database DATABASE_URL names is only where the scratch one is created from, and nothing in it
 * is touched.
 *
 * Why the whole history and not the new files: a migration that only works on a database
 * that already has yesterday's state is a migration nobody can replay, and replaying from zero
 * is the one test that catches it. It proves the migrations' content and nothing about whether
 * they were applied anywhere ("A test that builds its own subject cannot tell you the subject
 * is missing"), so this harness never reads a deployed database: it refuses, before anything
 * else, a DATABASE_URL that is unset or names a host other than this machine.
 *
 * Each assertion file runs inside its own `begin; … rollback;`. `set local role` and
 * `set_config(…, true)` are scoped to a transaction and are silent no-ops outside one, and an
 * assertion file is exactly where a caller is impersonated; the wrap also means a file's
 * throwaway rows never leak into the next. Migrations are not wrapped: they run as Supabase
 * applies them. A file with no `raise exception` asserts nothing and fails as such, and a file
 * named with a number that the pattern does not take fails rather than being skipped, since
 * either would otherwise be a test nobody knew never ran.
 *
 * A hang fails, and names its file. Every connection to the scratch database, each file's psql and every
 * dblink session a race test opens, starts with SESSION_BOUNDS, set on the database itself so no helper
 * has to remember them: a lock regression whose two sides are this file's connection and a dblink session
 * it waits on (removing 0030's `for update skip locked` from threads_count_board did exactly this to
 * 0012-cards.sql) is a deadlock Postgres cannot see, since one side waits on a lock and the other on a
 * socket, and without a bound the suite never ends. The lock wait then fails at lock_timeout, and any
 * other statement that never ends fails at statement_timeout. A psql that outlives both (a backend stuck
 * where neither reaches) is killed at FILE_TIMEOUT_MS and reported as such. A file or statement setting
 * its own shorter lock_timeout (the racers' 20s in tests.raced) is unaffected.
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const testsDir = path.join(repoRoot, 'supabase/tests');
const shim = path.join(testsDir, 'setup/auth-shim.sql');
const fixtures = path.join(testsDir, 'setup/fixtures.sql');

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

function psql(url, sql) {
  try {
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-X', url, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('\n  psql not found; run scripts/setup-container.sh'); process.exit(2); }
    if (timedOut(err)) return killedWhy();
    return (err.stderr || err.stdout || String(err)).trim();
  }
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

const timedOut = (err) => err.code === 'ETIMEDOUT' || (err.signal != null && err.status == null);
const killedWhy = () => `did not finish within ${FILE_TIMEOUT_MS / 1000}s and was killed: a hang that neither lock_timeout (${SESSION_BOUNDS.lock_timeout}) nor statement_timeout (${SESSION_BOUNDS.statement_timeout}) ended`;

/** Assertion files: four digits, a hyphen, a name. Ordered by number, then name. */
export const ASSERTION_FILE = /^(\d{4})-[\w.-]+\.sql$/;

function main() {
  const url = process.env.DATABASE_URL;
  const why = refusal(url);
  if (why) { console.error(`  test-sql: ${why}`); process.exit(2); }

  const scratch = `kayfabb_scratch_${process.pid}_${Date.now()}`;
  const target = withDatabase(url, scratch);
  let failed = 0;
  const step = (label, err) => {
    console.log(`  ${err ? 'FAIL' : 'PASS'}  ${label}${err ? `\n        ${err.split('\n').join('\n        ')}` : ''}`);
    if (err) failed++;
    return !err;
  };

  console.log(`\nsql: scratch database ${scratch}`);
  if (!step('create', psql(url, `create database ${scratch};`))) process.exit(1);
  /* A race test opens connections of its own to the scratch database (dblink), so it is told
     where that is; the URL is this machine's and the database is dropped with it. */
  if (!step('scratch_url', psql(url, `alter database ${scratch} set kayfabb.scratch_url to '${target.replaceAll("'", "''")}';`))) process.exit(1);
  /* Before any connection to it, so the shim, every migration, every file and every dblink session start bounded. */
  if (!step('bounds', psql(url, boundsSql(scratch)))) process.exit(1);
  try {
    if (!step('setup/auth-shim.sql', psql(target, fs.readFileSync(shim, 'utf8')))) return 1;

    console.log('\nsql: migrations, from zero');
    const migrations = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort() : [];
    for (const m of migrations) {
      if (!step(m, psql(target, fs.readFileSync(path.join(migrationsDir, m), 'utf8')))) {
        console.error('\n  a migration failed; the schema is not replayable from zero');
        return 1;
      }
    }

    if (!step('setup/fixtures.sql', psql(target, fs.readFileSync(fixtures, 'utf8')))) return 1;

    console.log('\nsql: assertions');
    const numberOf = (f) => Number(ASSERTION_FILE.exec(f)?.[1] ?? Number.NaN);
    const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.sql'))
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
      step(t, psql(target, `begin;\n${sql}\nrollback;\n`));
    }
    /* End to end: TypeScript that runs the Edge Functions' own core against this scratch
       database (supabase/tests/e2e/NNNN-*.ts, Node's test runner), so the contract between the
       engine and the SQL is read where both meet. */
    console.log('\nsql: end to end');
    const e2eDir = path.join(testsDir, 'e2e');
    const e2e = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => /^\d{4}-[\w.-]+\.ts$/.test(f)).sort() : [];
    for (const f of e2e) {
      try {
        execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', path.join(e2eDir, f)], {
          env: { ...process.env, KAYFABB_SCRATCH_URL: target }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL',
        });
        step(`e2e/${f}`, null);
      } catch (err) {
        step(`e2e/${f}`, (timedOut(err) ? `${killedWhy()}\n` : '') + String(err.stdout || '') + String(err.stderr || ''));
      }
    }
    console.log(`\n  sql: ${migrations.length} migration(s); ${ran} assertion file(s); ${e2e.length} end-to-end file(s); ${failed} failed`);
    return failed ? 1 : 0;
  } finally {
    const err = psql(url, `drop database if exists ${scratch} with (force);`);
    if (err) console.error(`  test-sql: could not drop ${scratch}: ${err}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
