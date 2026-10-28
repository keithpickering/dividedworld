/**
 * The SQL suite: every migration replayed from zero into a scratch database, then every
 * assertion file under supabase/tests/.
 *
 *   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run test:sql
 *
 * Each run creates a database of its own on the server DATABASE_URL names
 * (`kayfabb_scratch_<pid>_<time>`), applies supabase/tests/setup/auth-shim.sql (a stand-in for
 * what Supabase provides before any migration: the API roles, `auth.uid()` read from the
 * claims a test sets), then every supabase/migrations/*.sql in name order, then each
 * supabase/tests/NNNN-*.sql in number order, and drops the database at the end, pass or fail.
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
 * psql is the only tool: no driver, no pgTAP. Outside the build (tools/build.mjs,
 * OUTSIDE_THE_BUILD), which has no database; it runs in .github/workflows/sql.yml against a
 * Postgres service, and locally against the container's own Postgres
 * (scripts/setup-container.sh, .claude/hooks/session-start.sh).
 *
 * Carried from currents (docs/plans/port-manifest.md): its reset of a shared `public` became a
 * scratch database, and its stand-ins for storage, pg_net and Vault stay behind until a
 * migration here needs them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const testsDir = path.join(repoRoot, 'supabase/tests');
const shim = path.join(testsDir, 'setup/auth-shim.sql');

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Why a DATABASE_URL may not be used, or null when it may: unset, not a URL, or a host
 * other than this machine.
 * @param {string | undefined} url
 */
export function refusal(url) {
  if (!url) return 'DATABASE_URL is not set (postgres://postgres:pg@localhost:5432/postgres)';
  let host;
  try { host = new URL(url).hostname; } catch { return 'DATABASE_URL is not a valid URL'; }
  if (!LOCAL_HOSTS.has(host)) return `refusing DATABASE_URL on host "${host}": this harness creates and drops databases, and reads only Postgres on localhost`;
  return null;
}

/** The URL with its database swapped for another on the same server. */
const withDatabase = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

function psql(url, sql) {
  try {
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-X', url, '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('\n  psql not found; run scripts/setup-container.sh'); process.exit(2); }
    return (err.stderr || err.stdout || String(err)).trim();
  }
}

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

    console.log('\nsql: assertions');
    const numberOf = (f) => Number(ASSERTION_FILE.exec(f)?.[1] ?? Number.NaN);
    const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.sql'))
      .sort((a, b) => (numberOf(a) - numberOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
    let ran = 0;
    for (const t of files) {
      if (!ASSERTION_FILE.test(t)) { step(t, 'an .sql file in supabase/tests/ that is not NNNN-*.sql would never run; rename it or move it under setup/'); continue; }
      const sql = fs.readFileSync(path.join(testsDir, t), 'utf8');
      if (!/raise\s+exception/i.test(sql)) { step(t, 'asserts nothing: no `raise exception` in this file'); continue; }
      ran++;
      step(t, psql(target, `begin;\n${sql}\nrollback;\n`));
    }
    console.log(`\n  sql: ${migrations.length} migration(s); ${ran} assertion file(s); ${failed} failed`);
    return failed ? 1 : 0;
  } finally {
    const err = psql(url, `drop database if exists ${scratch} with (force);`);
    if (err) console.error(`  test-sql: could not drop ${scratch}: ${err}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
