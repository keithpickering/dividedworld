/**
 * Guard: every scheduled job of the deployed database is running.
 *
 *   node tools/check-job-health.mjs --db <postgres URL>
 *
 * The Jobs page and the strip read the same thing in the browser (docs/plans/2026-11-20-job-health-design.md); this is the
 * read nobody has to open a page for. It runs hourly in .github/workflows/job-health.yml, apart from Release so that a stopped
 * job never holds a release, and GitHub's failed-run email to the owner is the alert. It reads `select * from job_status()`,
 * computes the engine's `jobHealth` (engine/rules/jobs.ts, so the cron grammar is read once, never twice) with the engine's
 * `JOBS` and the grace the database holds on every row, falling back to Divided World's `jobGraceMinutes` setting
 * (instances/divided-world/settings.ts), and exits 1 naming each job that is stopped with the time its last good run, or its
 * scheduling, began (`since`).
 *
 * A job in `JOBS` that the deployed `cron.job` does not hold is named apart: it has no row in job_status() at all, or a row that
 * only `job_runs` supplied (job_status() is the union of the kayfabb- jobs in cron.job and the rows of job_runs, and its schedule
 * and active columns come from cron.job alone, so a null schedule means cron.job has no such job). A job cron.job holds but has
 * switched off (`active` false) is named too. Those cannot run, whatever their last good run says.
 *
 * Like tools/check-deployed-migrations.mjs, whose URL refusal, scrub(), retry and psql environment it reuses, it reads a live
 * database and so is not a step of tools/build.mjs; tools/test-job-health.mjs, which is, drives it red without connecting
 * anywhere. The database is named by an explicit --db, never by a default, and a database on this machine is refused in every
 * spelling, as is a URL with a parameter that could connect somewhere it does not say (`host=`, `hostaddr=`, `service=`). It
 * prints the host it read, never the URL: the password is handed to psql in its environment, and every message passes through
 * scrub().
 *
 * A transport failure is tried again, three attempts with a pause that doubles. A server that answered and refused, or a query
 * error, is exit 1 at once. Either way, a read that failed is reported as a failure to read and never as a stopped job: it says
 * nothing about the jobs.
 * Exit status: 0 every job is running, 1 a job is stopped or missing, or the read failed, 2 refused.
 */

import { pathToFileURL } from 'node:url';
import { JOBS, jobHealth } from '../engine/rules/jobs.ts';
import { defaults } from '../instances/divided-world/settings.ts';
import { connectOptions, isThisMachine, retrying } from './check-deployed-migrations.mjs';
import { connection, psql, scrub } from './instance-files.mjs';

/** One JSON document: job_status()'s rows as `jobHealth` takes them. */
export const QUERY = `select coalesce(json_agg(json_build_object(
  'job', s.job, 'schedule', s.schedule, 'active', s.active, 'firstSeen', s.first_seen, 'lastOkAt', s.last_ok_at, 'grace', s.grace
) order by s.job), '[]'::json) from job_status() s`;

/** What the command was asked for, or the plain reason it refuses (`refusal`); nothing here connects. */
export function parseArgs(argv) {
  let db;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') db = argv[++i];
    else return { refusal: `unknown argument ${argv[i]}; the only argument is --db <postgres URL>` };
  }
  if (db === '') return { refusal: "--db is empty: the SUPABASE_DB_URL secret is not set in the production environment, or, in a hand run, the variable passed to --db is unset" };
  if (!db) return { refusal: 'no --db: name the database to read, explicitly; there is no default' };
  let u;
  try { u = new URL(db); } catch { return { refusal: 'the --db value is not a postgres:// URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { refusal: 'the --db value is not a postgres:// URL' };
  if (!u.hostname) return { refusal: 'the --db URL names no host, so it cannot be told which database would be read' };
  if (isThisMachine(u.hostname)) return { refusal: 'the --db host is this machine; this check reads the deployed database, and the local one is a throwaway' };
  return { db, host: u.hostname };
}

/**
 * What is wrong with the jobs, each naming its job: those `JOBS` names that cron.job lacks, those it holds switched off, and the
 * stopped ones with their `since`. `rows` are job_status()'s, `grace` the instance's setting, `at` the time read.
 * @returns {string[]}
 */
export function problems(rows, grace, at) {
  const byName = new Map(rows.map((r) => [r.job, r]));
  const out = [];
  for (const h of jobHealth(rows, grace, at)) {
    const row = byName.get(h.job);
    const since = h.since === null ? 'never run' : `since ${h.since}`;
    if (!row || row.schedule === null) out.push(`${h.job} is missing from cron.job (${row ? `job_runs knows it, last good run ${since}` : 'job_status() has no row for it'}); nothing schedules it`);
    else if (!row.active) out.push(`${h.job} is inactive in cron.job (${since})`);
    else if (h.unreadable) out.push(`${h.job} is stopped, ${since}: its schedule ${JSON.stringify(row.schedule)} is outside the grammar the engine reads`);
    else if (h.stopped) out.push(`${h.job} is stopped, ${since}${h.missed ? `; first missed ${h.missed}, ${h.missedRuns}${h.missedRuns >= 99 ? ' or more' : ''} due time(s) missed` : ''}`);
  }
  return out;
}

/** `job_status()`'s rows, read through psql with the transport retried. */
/** @param {any} c @param {{ run?: (c: any, sql: string) => string | Promise<string>, sleep?: (ms: number) => Promise<void> }} [deps] */
export async function readRows(c, { run = psql, sleep } = {}) {
  const text = await retrying(() => run(c, QUERY), sleep ? { sleep } : {});
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('job_status() did not answer a list of rows');
  return rows;
}

/**
 * The whole command with its effects handed in, so the test drives it without a database. Returns the exit status; `log` and
 * `err` take lines. `deps.run` is psql, `deps.now` the clock, `deps.sleep` the retry's pause.
 */
/**
 * @param {string[]} argv
 * @param {{ log: (line: string) => void, err: (line: string) => void, run?: (c: any, sql: string) => string | Promise<string>, now?: () => Date, sleep?: (ms: number) => Promise<void> }} deps
 */
export async function run(argv, { log, err, run: runPsql = psql, now = () => new Date(), sleep }) {
  const a = parseArgs(argv);
  if (a.refusal) {
    err(`  job-health: refused: ${a.refusal}`);
    return 2;
  }
  let c;
  try { c = connectOptions(connection(a.db)); } catch (e) {
    err(`  job-health: refused: ${scrub(e.message)}`);
    return 2;
  }
  /** scrub() takes the password out; the URL itself goes too, should any message quote it. */
  const clean = (t) => scrub(String(t).split(a.db).join('<url>'));
  log(`reading job_status() from ${a.host}`);
  let rows;
  try {
    rows = await readRows(c, { run: runPsql, sleep });
  } catch (e) {
    err(`  job-health: could not read job_status() from ${a.host}, so nothing is known of the jobs (this is not a stopped job): ${clean(e?.message ?? e)}`);
    return 1;
  }
  const found = problems(rows, defaults.jobGraceMinutes, now());
  if (found.length) {
    err(`  job-health: ${found.length} of ${JOBS.length} job(s) not running:`);
    for (const f of found) err(`    ${f}`);
    return 1;
  }
  log(`  job-health: all ${JOBS.length} jobs are running`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), { log: (l) => console.log(l), err: (l) => console.error(l) }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`  job-health: ${scrub(e?.message ?? e)}`);
      process.exit(1);
    },
  );
}
