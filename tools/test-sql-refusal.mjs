/**
 * tools/test-sql.mjs refuses any database but local Postgres, before it runs anything.
 *
 *   node tools/test-sql-refusal.mjs
 *
 * The SQL suite creates and drops databases on the server DATABASE_URL names, and the name
 * DATABASE_URL is also what a hosted project's dashboard hands out for its live database. So
 * the suite's first act is to read the host and refuse anything that is not this machine
 * ("A test that builds its own subject cannot tell you the subject is missing"). That refusal
 * is a guard, and the suite itself is outside the build, which has no database; this file is
 * in the build so the refusal is driven red on every push. Each case runs the real suite with
 * a `psql` that only records that it was called: a refused URL must exit 2 with nothing
 * recorded, so the refusal is shown to come before any SQL, not merely to happen. The stand-in
 * is a Node script named by KAYFABB_PSQL_SHIM, so it runs on every platform the build does.
 *
 * The suite's bounds are held here too: every connection to the scratch database must start with
 * lock_timeout and statement_timeout, set on the database before the first connection to it, and a psql
 * that never answers must be killed and reported by its file's name, so a lock regression (removing 0030's
 * `for update skip locked` hung 0012-cards.sql) fails the suite instead of hanging it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ASSERTION_FILE, SESSION_BOUNDS, nullBlind, refusal } from './test-sql.mjs';
/* A namespace import, so a runner without the constant fails the assertions below instead of failing to load. */
import * as runner from './test-sql.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-psql-'));
const marker = path.join(bin, 'called');
const recorder = path.join(bin, 'psql.mjs');
fs.writeFileSync(recorder, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');\n`);

/** Runs the suite with the recording psql; returns its status, stderr and whether psql ran. */
function suite(url) {
  fs.rmSync(marker, { force: true });
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, KAYFABB_PSQL_SHIM: recorder };
  if (url === undefined) delete env.DATABASE_URL; else env.DATABASE_URL = url;
  const r = spawnSync(process.execPath, ['tools/test-sql.mjs'], { env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, psqlRan: fs.existsSync(marker) };
}

for (const [name, url] of [
  ['a hosted project\'s pooler', 'postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres'],
  ['a hosted project\'s direct host', 'postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres'],
  ['a host that merely starts with localhost', 'postgres://postgres:pg@localhost.example.com:5432/postgres'],
  ['an address on the network', 'postgres://postgres:pg@10.0.0.5:5432/postgres'],
  ['a string that is not a URL', 'not a url'],
  ['localhost with a host parameter, which libpq lets override it', 'postgres://postgres:pg@localhost:5432/postgres?host=db.abcdefgh.supabase.co'],
  ['localhost with a hostaddr parameter', 'postgres://postgres:pg@localhost:5432/postgres?hostaddr=10.0.0.5'],
  ['localhost with a service parameter, whose file can name any host', 'postgres://postgres:pg@localhost:5432/postgres?service=prod'],
  ['a URL with no host, which libpq fills from PGHOST', 'postgres:///postgres'],
  ['DATABASE_URL unset', undefined],
]) {
  const r = suite(url);
  check(`${name} is refused with exit 2`, r.status === 2, `status ${r.status}: ${r.stderr}`);
  check(`${name} is refused before psql is called`, !r.psqlRan);
}

check('localhost is allowed', refusal('postgres://postgres:pg@localhost:5432/postgres') === null);
check('127.0.0.1 is allowed', refusal('postgres://postgres:pg@127.0.0.1:5432/postgres') === null);
check('::1 is allowed', refusal('postgres://postgres:pg@[::1]:5432/postgres') === null);
check('localhost with sslmode is allowed', refusal('postgres://postgres:pg@localhost:5432/postgres?sslmode=disable') === null);
/* The recording psql succeeds at everything, so this case shows only that the refusal is not
   what stopped the cases above; the suite's real flow is shown by running it on Postgres. */
{
  const r = suite('postgres://postgres:pg@localhost:5432/postgres');
  check('and an allowed URL does reach psql, so the cases above are not refused for some other reason', r.psqlRan, `status ${r.status}: ${r.stderr}`);
}

/* The harness also refuses an assertion that a missing row passes: `if (select …) <> x` is null,
   so never true, when the select finds nothing, and the test it guards stays green over a write
   that never happened. */
check('an `if (select …) <> x` is refused', nullBlind("if (select change from wallet_events where account = a) <> -100 then raise exception 'x'; end if;").length === 1);
check('one after `or` or `and` too', nullBlind("if x or (select n from t) <> 1 then raise exception 'x'; end if;\nif y and (select (n) from t) <> 2 then raise exception 'y'; end if;").length === 2);
check('`is distinct from` is not refused', nullBlind("if (select change from wallet_events) is distinct from -100 then raise exception 'x'; end if;").length === 0);
check('a select whose comparison is not right after it is not refused', nullBlind("if exists (select 1 from t) then raise exception 'x'; end if;\nperform (select 1) + 1;").length === 0);

/* ---- the bounds ---- */
/* A psql that records its arguments and its SQL, one record per call, and succeeds; or, with HANG set, never answers on
   the first assertion file (the harness wraps each in `begin;`), as a backend stuck on a deadlock it cannot see would. */
const bounded = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-psql-bounds-'));
const calls = path.join(bounded, 'calls');
const hung = path.join(bounded, 'hung');
/* When each psql began, one time to a line, so the kill is timed by the gap from the hung psql to the one after it. */
const starts = path.join(bounded, 'starts');
const ran = path.join(bounded, 'ran');
const hanger = path.join(bounded, 'psql.mjs');
fs.writeFileSync(hanger, `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(starts)}, Date.now() + '\\n');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n' + sql + '\\n\\x1e\\n');
if (process.env.VACUUM_FAILS && sql.startsWith(process.env.VACUUM_FAILS)) { process.stderr.write('ERROR:  vacuum refused by the test'); process.exit(1); }
/* Past the vacuum, where a real psql with ON_ERROR_STOP would go on to run the rest. A call that failed above is never listed. */
fs.appendFileSync(${JSON.stringify(ran)}, (/^(vacuum \\(analyze\\); )?begin;\\n/.test(sql) ? 'file' : 'other') + '\\n');
if (/^(vacuum \\(analyze\\); )?begin;/.test(sql) && process.env.HANG && !fs.existsSync(${JSON.stringify(hung)})) {
  fs.writeFileSync(${JSON.stringify(hung)}, String(Date.now()));
  setTimeout(() => {}, 60_000);
}
`);
function boundedSuite(hang, timeoutMs = '1500', vacuumFails = '') {
  fs.rmSync(calls, { force: true });
  fs.rmSync(hung, { force: true });
  fs.rmSync(starts, { force: true });
  fs.rmSync(ran, { force: true });
  const env = { ...process.env, KAYFABB_PSQL_SHIM: hanger, DATABASE_URL: 'postgres://postgres:pg@localhost:5432/postgres', KAYFABB_SQL_FILE_TIMEOUT_MS: timeoutMs, HANG: hang ? '1' : '', VACUUM_FAILS: vacuumFails };
  /* The suite's own end-to-end files would try the scratch database this psql never made; a bound keeps a slip here from hanging the
     build. It is wide, since the whole run under a busy build (a Node start for each psql, the end-to-end files) took 85s on Windows. */
  const r = spawnSync(process.execPath, ['tools/test-sql.mjs'], { env, encoding: 'utf8', timeout: 600_000 });
  const records = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\x1e\n').filter((x) => x.trim()) : [];
  /* How long the hung psql lived: from its start to the start of the next psql, which the suite runs once the hung one is killed. */
  const hungAt = fs.existsSync(hung) ? Number(fs.readFileSync(hung, 'utf8')) : NaN;
  const after = fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').split('\n').filter(Boolean).map(Number).find((t) => t > hungAt) : undefined;
  const proceeded = fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), records, proceeded, hungMs: after === undefined ? NaN : after - hungAt };
}
{
  const r = boundedSuite(false);
  const sets = Object.entries(SESSION_BOUNDS).map(([k, v]) => r.records.findIndex((c) => new RegExp(`alter database kayfabb_scratch_\\w+ set ${k} to '${v}'`).test(c)));
  const firstOnScratch = r.records.findIndex((c) => /\/kayfabb_scratch_\w+ -f/.test(c.split('\n')[0] ?? ''));
  check('the suite sets lock_timeout and statement_timeout on the scratch database', sets.every((i) => i >= 0), JSON.stringify(sets));
  check('before the first connection to it (the shim), so every connection and every dblink session starts bounded',
    firstOnScratch > 0 && sets.every((i) => i >= 0 && i < firstOnScratch), `bounds at ${JSON.stringify(sets)}, first scratch connection at ${firstOnScratch}`);
  check('neither bound is zero, which is no bound', Object.values(SESSION_BOUNDS).every((v) => /^[1-9]\d*(ms|s|min)$/.test(v)), JSON.stringify(SESSION_BOUNDS));
  check('a lock regression costs less than a statement: lock_timeout is the shorter bound', parseInt(SESSION_BOUNDS.lock_timeout) * (SESSION_BOUNDS.lock_timeout.endsWith('min') ? 60 : 1) < parseInt(SESSION_BOUNDS.statement_timeout) * (SESSION_BOUNDS.statement_timeout.endsWith('min') ? 60 : 1));
}
{
  const first = fs.readdirSync('supabase/tests').filter((f) => ASSERTION_FILE.test(f)).sort()[0];
  const r = boundedSuite(true);
  check('a file whose psql never answers fails the suite', r.status === 1, `status ${r.status}`);
  /* Timed from the hung psql to the next, never over the whole run: the run's length is every other file's too, and on a busy machine
     it passed the 60s hang while the kill came at 1.5s. Half the hang leaves room for a slow Node start. */
  check('and is killed at the bound, not waited out', r.hungMs < 30_000, `the hung psql lived ${r.hungMs} ms`);
  check('and the failure names the file and says it was killed at the bound',
    new RegExp(`FAIL  ${first?.replace('.', '\\.')}\\s+did not finish within 1\\.5s and was killed`).test(r.out), r.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | '));
  check('and the files after it still run', /PASS  0001-/.test(r.out), r.out.slice(0, 400));
}
/* ---- the statistics state ---- */
/* Every file starts from the same statistics state: `vacuum (analyze)` on the scratch database. An assertion file's
   vacuum travels in the file's own psql call, ahead of its transaction (`vacuum (analyze); begin;`, on one line so the
   file's line numbers in psql's errors are what they always were), since a psql start is a Node start here and a call of
   its own for each of ~230 files nearly doubled this check's run. An end-to-end file is run by `node --test`, so its
   vacuum is a psql call of its own right before it. The scratch tests directory is the real one: the recorded calls are
   read, so no files are added. */
{
  const VACUUM = runner.VACUUM_STATEMENT;
  const body = (c) => c.split('\n').slice(1).join('\n');
  const isVacuumOnly = (c) => body(c).trim() === VACUUM;
  const onScratch = (c) => /\/kayfabb_scratch_\w+ -f/.test(c.split('\n')[0] ?? '');
  /* An assertion file's call: wrapped in begin; … rollback; (a migration may say `begin;` too, and is not one). */
  const isFile = (c) => /^(vacuum \(analyze\); )?begin;\n/.test(body(c)) && body(c).trimEnd().endsWith('\nrollback;');
  const r = boundedSuite(false);
  const fileAt = r.records.map((c, i) => (isFile(c) ? i : -1)).filter((i) => i >= 0);
  const e2eCount = fs.readdirSync('supabase/tests/e2e').filter((f) => /^\d{4}-[\w.-]+\.ts$/.test(f)).length;
  const startsWithIt = (c) => body(c).startsWith(VACUUM);
  const outside = (c) => body(c).indexOf(VACUUM) < body(c).indexOf('begin;');
  check('the statement is `vacuum (analyze);`', VACUUM === 'vacuum (analyze);', String(VACUUM));
  check('every assertion file\'s own call starts with it', fileAt.length > 0 && fileAt.every((i) => startsWithIt(r.records[i])), `${fileAt.filter((i) => !startsWithIt(r.records[i])).length} of ${fileAt.length} calls do not`);
  check('before its `begin;`, so outside the file\'s transaction', fileAt.every((i) => outside(r.records[i])));
  check('on the same line as `begin;`, so the file\'s line numbers in psql\'s errors are unchanged', fileAt.every((i) => body(r.records[i]).startsWith(`${VACUUM} begin;\n`)));
  check('and sent to the scratch database', fileAt.every((i) => onScratch(r.records[i])));
  check('no vacuum-only call precedes an assertion file', fileAt.every((i) => i === 0 || !isVacuumOnly(r.records[i - 1])));
  const vacuumOnly = r.records.filter(isVacuumOnly);
  check('one vacuum-only call precedes each end-to-end file', vacuumOnly.length === e2eCount, `${vacuumOnly.length} vacuum-only calls for ${e2eCount} end-to-end files`);
  check('and goes to the scratch database', vacuumOnly.length > 0 && vacuumOnly.every(onScratch));

  const bad = boundedSuite(false, '1500', VACUUM ?? 'vacuum (analyze);');
  const first = fs.readdirSync('supabase/tests').filter((f) => ASSERTION_FILE.test(f)).sort()[0];
  const e2eFirst = fs.readdirSync('supabase/tests/e2e').filter((f) => /^\d{4}-[\w.-]+\.ts$/.test(f)).sort()[0];
  check('a failing vacuum fails the suite', bad.status === 1, `status ${bad.status}`);
  check('it fails that file\'s step with the error', new RegExp(`FAIL  ${first?.replace('.', '\\.')}\\s+ERROR:  vacuum refused by the test`).test(bad.out), bad.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join(' | '));
  check('and the runner counts every assertion file as failed', new RegExp(`; ${fileAt.length + e2eCount} failed`).test(bad.out), bad.out.split('\n').slice(-3).join(' | '));
  /* The shim lists a call only once it is past the vacuum, as a real psql with ON_ERROR_STOP stops at the failing first statement. */
  check('and the file itself is not run', !bad.proceeded.includes('file'), `${bad.proceeded.filter((x) => x === 'file').length} files went on past the vacuum`);
  check('the same for an end-to-end file', !e2eFirst || new RegExp(`FAIL  e2e/${e2eFirst.replace('.', '\\.')}\\s+vacuum \\(analyze\\); failed, so the file was not run:\\s+ERROR:  vacuum refused by the test`).test(bad.out), bad.out.split('\n').filter((l) => /e2e/.test(l)).slice(0, 2).join(' | '));
}
fs.rmSync(bounded, { recursive: true, force: true });

fs.rmSync(bin, { recursive: true, force: true });
console.log(`\n  sql-refusal: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-refusal: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
