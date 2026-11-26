/**
 * Tests for the guard in tools/check-job-health.mjs.
 *
 *   node tools/test-job-health.mjs
 *
 * The check reads job_status() from a live database, so it runs only in .github/workflows/job-health.yml, and this test is the part
 * of it the build runs. Nothing here connects anywhere: the command is driven through `run()` with a stand-in for psql, a fixed
 * clock and no pause, and the real command is spawned only on refusals, which happen before any connection.
 *
 * The poisons, each its own case: a stopped job (named, with its since); a job cron.job lacks (no row, and a row only job_runs
 * supplied); a job switched off; a schedule the engine cannot read; all ten running (exit 0); `localhost`, `127.0.0.1`, `::1` and a
 * `host=` parameter refused without a connection; the URL and its password never printed on any path; a transport failure retried
 * and, when it outlasts the retries, reported as a failure to read and never as a stopped job; an answered refusal or a query error
 * exit 1 at once, unretried.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS } from '../engine/rules/jobs.ts';
import { run } from './check-job-health.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-job-health.mjs');
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

const AT = new Date('2026-11-26T12:00:00Z');
const ago = (minutes) => new Date(AT.getTime() - minutes * 60_000).toISOString();
const URL_ = 'postgres://postgres.abcdefgh:secretpw@aws-0-us-west-1.pooler.example.com:5432/postgres';
const HOST = 'aws-0-us-west-1.pooler.example.com';

/** One row per job, every one scheduled every minute and good a minute ago; `change(name, row)` breaks some. */
const ABSENT = Symbol('no row');
/** @param {(name: string, row: any) => any} [change] */
const rows = (change = () => undefined) =>
  JOBS.map((j) => {
    const row = { job: j.name, schedule: '* * * * *', active: true, firstSeen: ago(60 * 24 * 30), lastOkAt: ago(1), grace: null };
    return change(j.name, row) ?? row;
  }).filter((row) => row !== ABSENT);

/** The command with psql replaced; returns the status, every line it printed and how many times psql was called. */
async function drive(argv, answer) {
  const lines = [];
  const state = { calls: 0 };
  const code = await run(argv, {
    log: (l) => lines.push(l),
    err: (l) => lines.push(l),
    run: async (_c, sql) => {
      state.calls++;
      if (!/job_status\(\)/.test(sql)) throw new Error('the check asked for something other than job_status()');
      return answer(state.calls);
    },
    now: () => AT,
    sleep: async () => {},
  });
  return { code, text: lines.join('\n'), calls: state.calls };
}
const answers = (value) => () => JSON.stringify(value);

/* ----------------------------------------------------------------------- the comparison ---- */

let r = await drive(['--db', URL_], answers(rows()));
check('1. all ten running: exit 0', r.code === 0 && /all 10 jobs are running/.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-conceal' ? { ...row, lastOkAt: ago(120) } : undefined))));
check('2a. a stopped job: exit 1', r.code === 1, `${r.code} ${r.text}`);
check('2b. the stopped job is named with its since, and no other is', /kayfabb-conceal is stopped, since /.test(r.text) && r.text.includes(ago(120)) && !/kayfabb-mail/.test(r.text), r.text);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-meet' ? { ...row, schedule: '0 13 * * *', lastOkAt: null, firstSeen: ago(60 * 30) } : undefined))));
check('2c. a daily job that never ran, past its grace, is stopped, and its since is when it was scheduled', r.code === 1 && /kayfabb-meet is stopped, since /.test(r.text) && r.text.includes(ago(60 * 30)), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-staff' ? { ...row, lastOkAt: null, firstSeen: null } : undefined))));
check('2d. a job with no reference at all is stopped, "never run"', r.code === 1 && /kayfabb-staff is stopped, never run/.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n) => (n === 'kayfabb-write' ? ABSENT : undefined))));
check('3a. a job with no row in job_status(): exit 1, missing from cron.job', r.code === 1 && /kayfabb-write is missing from cron\.job/.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-mail' ? { ...row, schedule: null, active: null } : undefined))));
check('3b. a row only job_runs supplied (null schedule): exit 1, missing from cron.job, with its last good run', r.code === 1 && /kayfabb-mail is missing from cron\.job \(job_runs knows it, last good run since /.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers([]));
check('3c. an empty job_status() names all ten as missing', r.code === 1 && JOBS.every((j) => r.text.includes(`${j.name} is missing from cron.job`)), r.text);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-settle' ? { ...row, active: false } : undefined))));
check('3d. a job cron.job holds switched off: exit 1, inactive', r.code === 1 && /kayfabb-settle is inactive in cron\.job/.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-chatter' ? { ...row, schedule: '30 seconds' } : undefined))));
check('3e. a schedule outside the grammar reads stopped, never thrown', r.code === 1 && /kayfabb-chatter is stopped, since .*outside the grammar/.test(r.text), `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-conceal' ? { ...row, lastOkAt: ago(15), grace: { 'kayfabb-conceal': 60 } } : undefined))));
check('4a. the grace the database holds on the row wins over the repository\'s default', r.code === 0, `${r.code} ${r.text}`);

r = await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-conceal' ? { ...row, lastOkAt: ago(15) } : undefined))));
check('4b. the repository\'s ten-minute grace applies when the row carries none', r.code === 1 && /kayfabb-conceal/.test(r.text), `${r.code} ${r.text}`);

/* ----------------------------------------------------------------------- refusals ---- */

async function refuses(name, argv, want) {
  const x = await drive(argv, () => { throw new Error('connected, which a refusal must never do'); });
  check(name, x.code === 2 && x.calls === 0 && want.test(x.text) && !/secretpw/.test(x.text) && !/reading job_status/.test(x.text), `${x.code} calls ${x.calls} ${x.text}`);
}
await refuses('5a. no --db is refused', [], /--db/);
await refuses('5b. an empty --db is refused and says so', ['--db', ''], /--db is empty/);
await refuses('5c. an unknown argument is refused', ['--db', URL_, '--before'], /unknown argument/);
await refuses('5d. a URL that does not parse is refused', ['--db', 'not a url'], /URL/);
await refuses('5e. a URL with no host is refused', ['--db', 'postgres:///postgres'], /host/);
for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST', '0.0.0.0', '127.0.0.2']) {
  await refuses(`5f. a database on ${host} is refused without connecting`, ['--db', `postgres://postgres:secretpw@${host}:54322/postgres`], /this machine/);
}
await refuses('5g. a host= parameter is refused without connecting', ['--db', `${URL_}?host=other.example.com`], /host parameter/);
await refuses('5h. a hostaddr= parameter is refused without connecting', ['--db', `${URL_}?hostaddr=10.0.0.1`], /hostaddr parameter/);
await refuses('5i. a service= parameter is refused without connecting', ['--db', `${URL_}?service=x`], /service parameter/);
await refuses('5j. a URL naming no database is refused', ['--db', 'postgres://u:secretpw@db.example.com:5432'], /no database/);

const cli = spawnSync(process.execPath, [script, '--db', 'postgres://postgres:secretpw@localhost:54322/postgres'], { encoding: 'utf8', timeout: 20_000 });
check('5k. the real command refuses localhost with exit 2 and prints no secret', cli.status === 2 && /this machine/.test(cli.stderr) && !/secretpw/.test(cli.stdout + cli.stderr), `${cli.status} ${cli.stdout}${cli.stderr}`);
const bare = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 });
check('5l. the real command with no --db exits 2', bare.status === 2 && /--db/.test(bare.stderr), `${bare.status} ${bare.stderr}`);

/* ----------------------------------------------------------------------- the URL is never printed ---- */

const leaky = (calls) => { throw new Error(`psql: error: connection to server at "${HOST}" (1.2.3.4), port 5432 failed: Connection refused (${URL_}) secretpw`); };
const everyRun = [
  await drive(['--db', URL_], answers(rows())),
  await drive(['--db', URL_], answers(rows((n, row) => (n === 'kayfabb-conceal' ? { ...row, lastOkAt: ago(120) } : undefined)))),
  await drive(['--db', URL_], leaky),
  await drive(['--db', URL_], () => { throw new Error(`ERROR: relation x ${URL_} secretpw`); }),
];
check('6a. the host is printed on every path', everyRun.every((x) => x.text.includes(HOST)), everyRun.map((x) => x.text).join('\n'));
check('6b. neither the URL nor its password nor its user is printed on any path', everyRun.every((x) => !/secretpw|postgres:\/\/|postgres\.abcdefgh/.test(x.text)), everyRun.map((x) => x.text).join('\n'));

/* ----------------------------------------------------------------------- a failed read ---- */

r = await drive(['--db', URL_], (calls) => (calls < 3 ? leaky(calls) : JSON.stringify(rows())));
check('7a. a transport failure is retried, and a read that then succeeds is judged on its rows', r.code === 0 && r.calls === 3, `${r.code} calls ${r.calls} ${r.text}`);

r = await drive(['--db', URL_], (calls) => { if (calls > 5) throw new Error('retried past the cap'); return leaky(calls); });
check('7b. a transport failure that outlasts the retries is exit 1 after three attempts', r.code === 1 && r.calls === 3 && !/past the cap/.test(r.text), `${r.code} calls ${r.calls} ${r.text}`);
check('7c. ...reported as a failure to read, never as a stopped job', /could not read job_status\(\)/.test(r.text) && /not a stopped job/.test(r.text) && !/ is stopped|missing from cron\.job|inactive/.test(r.text.replace('not a stopped job', '')), r.text);

r = await drive(['--db', URL_], () => { throw new Error('psql: error: connection to server at "x" failed: FATAL:  password authentication failed for user "postgres"'); });
check('7d. a server that answered and refused is exit 1 at once, unretried', r.code === 1 && r.calls === 1 && /could not read/.test(r.text), `${r.code} calls ${r.calls}`);

r = await drive(['--db', URL_], () => { throw new Error('ERROR:  function job_status() does not exist'); });
check('7e. a query error is exit 1 at once, unretried, a failure to read', r.code === 1 && r.calls === 1 && /could not read job_status\(\)/.test(r.text), `${r.code} calls ${r.calls}`);

r = await drive(['--db', URL_], () => 'not json');
check('7f. an answer that is not the rows is a failure to read, not a pass', r.code === 1 && /could not read/.test(r.text), `${r.code} ${r.text}`);
r = await drive(['--db', URL_], () => '{"a":1}');
check('7g. an answer that is not a list is a failure to read, not a pass', r.code === 1 && /could not read/.test(r.text), `${r.code} ${r.text}`);

/* ----------------------------------------------------------------------- the tail ---- */

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
