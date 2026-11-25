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
 * The suite's shape is held here too, read from what the recording psql was sent: the template built once, a clone of it
 * for every file with the settings `alter database` does not carry over (bounds, track_functions, client_rpcs, scratch_url)
 * given before anything connects, drift and function counts read after each file and the clone dropped, pass or fail; and a
 * psql that never answers must be killed and reported by its file's name, so a lock regression (removing 0030's
 * `for update skip locked` hung 0012-cards.sql) fails the suite instead of hanging it.
 *
 * Files run together in a pool and over shards: shardOf cuts the one sorted list by position (poisoned here with an off-by-one that drops
 * the last file, a split that repeats a file, and a shard that is not one), a recording psql that sleeps shows no more files in flight than
 * KAYFABB_SQL_WORKERS, and gatherFailures is planted with each way shard reports fail to cover the files on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

/* ---- the template and a clone for each file ---- */
/* A psql that records its arguments and its SQL, one record per call, and succeeds. Planted behavior, each once and on the first
   assertion file's call (the harness wraps each in `begin;`): HANG never answers, as a backend stuck on a deadlock it cannot see
   would; FAIL answers an error; DRIFT answers the drift rows it names with the tag the after-file call reads. */
const bounded = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-psql-bounds-'));
/* Each run of the suite has a directory of its own for what the psql records (KAYFABB_STATE), so runs may go side by side. */
const hanger = path.join(bounded, 'psql.mjs');
fs.writeFileSync(hanger, `import fs from 'node:fs';
const STATE = process.env.KAYFABB_STATE;
/* When each psql began, one time to a line, so the kill is timed by the gap from the hung psql to the one after it. */
fs.appendFileSync(STATE + '/starts', Date.now() + '\\n');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(STATE + '/calls', process.argv.slice(2).join(' ') + '\\n' + sql + '\\n\\x1e\\n');
/* The after-file call, on the clone of the first file: answered with the drift rows DRIFT names (\`drift|play|why\`, as psql -A -t -F '|' prints them). */
/* A planted behavior happens once: the first psql to create the marker file is the one that takes it, and with files in flight together two cannot both. */
const once = (file, text = '1') => { try { fs.writeFileSync(file, text, { flag: 'wx' }); return true; } catch { return false; } };
if (process.env.DRIFT && /^select pg_stat_force_next_flush\\(\\);/.test(sql) && once(STATE + '/hung.drift')) process.stdout.write('drift|' + process.env.DRIFT + '\\n');
/* CALLS answers each after-file call with one function count row (\`calls|name|n\`), so that a report holds counts to sum. */
if (process.env.CALLS && /^select pg_stat_force_next_flush\\(\\);/.test(sql)) process.stdout.write('calls|' + process.env.CALLS + '\\n');
/* The template's creation, with its settings in the same call: the database is made, then the settings fail. */
if (process.env.FAIL_SETTINGS && /^create database kayfabb_scratch_\\d+_\\d+;/.test(sql)) { process.stderr.write('ERROR:  planted settings failure'); process.exit(1); }
if (/^begin;\\n/.test(sql)) {
  /* FAIL_N: the first N files fail, each with an error of two lines. SLEEP_MS: a file takes that long, and its span is recorded. */
  for (let k = 1; k <= Number(process.env.FAIL_N || 0); k++) if (once(STATE + '/hung.n' + k)) { process.stderr.write('ERROR:  planted failure\\nDETAIL:  a second line'); process.exit(1); }
  if (process.env.HANG || process.env.FAIL) if (once(STATE + '/hung', String(Date.now()))) {
    if (process.env.FAIL) { process.stderr.write('ERROR:  planted failure'); process.exit(1); }
    setTimeout(() => {}, 60_000);
  }
  if (process.env.SLEEP_MS) {
    const began = Date.now();
    await new Promise((r) => setTimeout(r, Number(process.env.SLEEP_MS)));
    fs.appendFileSync(STATE + '/spans', began + ' ' + Date.now() + (/kayfabb-sql: alone/.test(sql) ? ' alone' : ' pooled') + '\\n');
  }
}
`);
/**
 * One run of the suite with the recording psql. `pattern` limits it to the files whose names match; `hang`, `fail` and `drift` plant what is above.
 * A run is made ready (its state directory, its environment), run (here, or beforehand and side by side: see prelaunch), and read.
 */
const ready = ({ pattern = '', hang = false, fail = false, drift = '', keep = '', timeoutMs = '60000', e2eDir = '', workers = '', shard = '', report = '', extraEnv = {} } = {}) => {
  const state = fs.mkdtempSync(path.join(bounded, 'run-'));
  const env = { ...process.env, KAYFABB_PSQL_SHIM: hanger, KAYFABB_STATE: state, DATABASE_URL: 'postgres://postgres:pg@localhost:5432/postgres', KAYFABB_SQL_FILE_TIMEOUT_MS: timeoutMs, HANG: hang ? '1' : '', FAIL: fail ? '1' : '', DRIFT: drift, KAYFABB_SQL_KEEP: keep, KAYFABB_SQL_WORKERS: workers, CALLS: '', ...(e2eDir ? { KAYFABB_SQL_E2E_DIR: e2eDir } : {}), ...extraEnv };
  const args = ['tools/test-sql.mjs', ...(pattern ? [pattern] : []), ...(shard ? [`--shard=${shard}`] : []), ...(report ? [`--report=${report}`] : [])];
  return { state, env, args };
};
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
const read = (state, status, out) => {
  const records = fs.existsSync(path.join(state, 'calls')) ? fs.readFileSync(path.join(state, 'calls'), 'utf8').split('\x1e\n').filter((x) => x.trim()) : [];
  /* How long the hung psql lived: from its start to the start of the next psql, which the suite runs once the hung one is killed. */
  const hungAt = fs.existsSync(path.join(state, 'hung')) ? Number(fs.readFileSync(path.join(state, 'hung'), 'utf8')) : NaN;
  const after = lines(path.join(state, 'starts')).map(Number).find((t) => t > hungAt);
  const spans = lines(path.join(state, 'spans')).map((l) => { const [a, b, kind] = l.split(' '); return [Number(a), Number(b), kind]; });
  return { status, out, records, spans, hungMs: after === undefined ? NaN : after - hungAt };
};
/* The suite's own end-to-end files would try a clone this psql never made; a bound keeps a slip here from hanging the
   build. It is wide, since the whole run under a busy build (a Node start for each psql, the end-to-end files) took 85s on Windows. */
const runAside = (opts) => new Promise((resolve) => {
  const { state, env, args } = ready(opts);
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
  child.on('close', (status) => { clearTimeout(timer); resolve(read(state, status, out)); });
});
/** Runs that were made ready beforehand, by the options object that asked for them. */
const ahead = new Map();
/**
 * Runs each set of options side by side, a few at a time (each run is a replay of every migration through a Node psql, which dominates this
 * file's time, and one run at a time left the machine's other CPUs idle), and keeps the results for boundedSuite to answer with.
 * @param {object[]} list
 */
async function prelaunch(list) {
  let next = 0;
  const lane = async () => { for (let at = next++; at < list.length; at = next++) ahead.set(list[at], await runAside(list[at])); };
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, lane));
}
function boundedSuite(opts = {}) {
  if (ahead.has(opts)) return ahead.get(opts);
  const { state, env, args } = ready(opts);
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 600_000 });
  return read(state, r.status, (r.stdout ?? '') + (r.stderr ?? ''));
}
/* What a record says: the database its connection names (`postgres` is the server's own, where databases are made and dropped), and its SQL. */
const dbOf = (c) => /\/(\w+) -f/.exec(c.split('\n')[0] ?? '')?.[1] ?? '';
const bodyOf = (c) => c.split('\n').slice(1).join('\n').trim();
const isFile = (c) => /^begin;\n/.test(bodyOf(c)) && bodyOf(c).endsWith('\nrollback;');
/* A clone is named for the template and a number; a snapshot of the replay (`_s0025`, `_migrated`) is not one. */
const createdClone = (c) => /^create database (kayfabb_scratch_\d+_\d+_\d+) template (kayfabb_scratch_\w+);/.exec(bodyOf(c));
const droppedDb = (c) => /^drop database if exists (kayfabb_scratch_\w+) with \(force\);$/.exec(bodyOf(c))?.[1];
const assertionFiles = fs.readdirSync('supabase/tests').filter((f) => ASSERTION_FILE.test(f)).sort();
const e2eFiles = fs.readdirSync('supabase/tests/e2e').filter((f) => /^\d{4}-[\w.-]+\.ts$/.test(f));
const first = assertionFiles[0];
const second = assertionFiles[1];

/* Every run of the suite this file reads, laid out here and run side by side before the checks (prelaunch), so each check below reads its run by name. A run
   that plants a behavior does so on the first file, so those take one worker: with files in flight together, which file is first is not fixed. */
const small = '000';
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-e2e-none-'));
const sawIn = path.join(bounded, 'saw');
const writesEnv = (file) => `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(file)}, JSON.stringify({ url: process.env.KAYFABB_SCRATCH_URL, snapshots: process.env.KAYFABB_SNAPSHOTS }));\n`;
/** A planted end-to-end directory: the runner reads it in place of supabase/tests/e2e, so the planted names are the run's. */
const plantedDir = (files) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-e2e-')); for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(d, n), t); return d; };
const planted = {
  poison: plantedDir({
    '0901-replays-the-migrations.ts': "import fs from 'node:fs';\nfor (const m of fs.readdirSync('supabase/migrations')) console.log(m);\n",
    '0902-asks-the-list.ts': "import { migrationFiles } from '../../../tools/test-sql.mjs';\nmigrationFiles();\n",
    '0903-only-says-so.ts': writesEnv(sawIn + '3') + '// supabase/migrations and migrationFiles, in a comment\n',
  }),
  told: plantedDir({ '0904-asks-where.ts': writesEnv(sawIn + '4') }),
  pointed: plantedDir({ '0905-across-0003.ts': writesEnv(sawIn + '5') }),
  nowhere: plantedDir({ '0906-nowhere-across-9999.ts': '' }),
  dupe: plantedDir({ '0907-a-across-0003.ts': '', '0908-b-across-0003.ts': '' }),
  unpointed: plantedDir({ '0909-x-across-.ts': '' }),
};
const reportFile = path.join(bounded, 'report.json');
/** A planted directory of assertion files: the runner reads it in place of supabase/tests/ (KAYFABB_SQL_TESTS_DIR). */
const raises = "do $$ begin raise exception 'x'; end $$;\n";
const timedBody = "do $$ declare t0 timestamptz; begin t0 := clock_timestamp(); if clock_timestamp() - t0 > interval '1 second' then raise exception 'slow'; end if; end $$;\n";
const aloneLine = '-- kayfabb-sql: alone\n';
const testsPlanted = {
  timed: plantedDir({
    '0001-timed-unmarked.sql': timedBody,
    '0002-marker-in-a-block-comment.sql': '/* ' + aloneLine + ' */\n' + timedBody,
    '0003-marker-misspelled.sql': '-- kayfabb-sql: alon\n-- kayfabb sql: alone\n--kayfabb-sql: alonee\n' + timedBody,
    '0004-marker-on-an-untimed-file.sql': aloneLine + raises,
    '0005-timed-and-marked.sql': aloneLine + timedBody,
    '0006-clock-as-a-value.sql': "do $$ declare id timestamptz := clock_timestamp(); begin raise notice 'at %', clock_timestamp(); if id is null then raise exception 'x'; end if; end $$;\n",
  }),
  alone: plantedDir({
    ...Object.fromEntries(['0001', '0002', '0003', '0004', '0005', '0006'].map((n) => [`${n}-pooled.sql`, raises])),
    '0007-alone-a.sql': aloneLine + timedBody,
    '0008-alone-b.sql': aloneLine + timedBody,
  }),
};
const runs = {
  full: {},
  hang: { pattern: small, hang: true, workers: '1', timeoutMs: '1500' },
  fail: { pattern: small, fail: true, workers: '1' },
  kept: { pattern: small, fail: true, keep: 'failed', workers: '1' },
  drifted: { pattern: small, workers: '1', drift: '00000000-0000-4000-8000-0000000000d1|a play with no row' },
  noSettings: { pattern: first, extraEnv: { FAIL_SETTINGS: '1' } },
  part: { pattern: first },
  one: { pattern: '0001' },
  none: { pattern: 'no-such-file-anywhere' },
  bad: ['3/2', '0/2', '1/0', '1/1.5', 'x'].map((shard) => ({ shard })),
  shard: { shard: '2/3' },
  wide: { pattern: small, e2eDir: emptyDir, workers: '3', extraEnv: { SLEEP_MS: '800' }, timeoutMs: '60000' },
  alone: { pattern: small, e2eDir: emptyDir, workers: '1', extraEnv: { SLEEP_MS: '200' }, timeoutMs: '60000' },
  failing: { pattern: small, e2eDir: emptyDir, workers: '3', extraEnv: { FAIL_N: '2', SLEEP_MS: '300' }, timeoutMs: '60000' },
  reported: { pattern: small, e2eDir: emptyDir, workers: '2', report: reportFile, extraEnv: { FAIL_N: '1', CALLS: 'thread_page|3' }, timeoutMs: '60000' },
  poison: { pattern: 'e2e/090', e2eDir: planted.poison },
  told: { pattern: '0904', e2eDir: planted.told },
  pointed: { pattern: '0905', e2eDir: planted.pointed },
  nowhere: { pattern: '0906', e2eDir: planted.nowhere },
  dupe: { pattern: 'e2e/090', e2eDir: planted.dupe },
  unpointed: { pattern: '0909', e2eDir: planted.unpointed },
  noE2e: { pattern: first },
  timed: { e2eDir: emptyDir, workers: '1', extraEnv: { KAYFABB_SQL_TESTS_DIR: testsPlanted.timed } },
  aloneFiles: { e2eDir: emptyDir, workers: '3', extraEnv: { KAYFABB_SQL_TESTS_DIR: testsPlanted.alone, SLEEP_MS: '700' } },
};
await prelaunch(Object.values(runs).flat());

/* The pure pieces first. */
{
  const sql = typeof runner.cloneSql === 'function' ? runner.cloneSql('tmpl', 'tmpl_3', 'postgres://postgres:pg@localhost:5432/postgres') : '';
  check('cloneSql makes the clone from the template', /^create database tmpl_3 template tmpl;/.test(sql), sql.slice(0, 80));
  check('and gives the clone the bounds, which `alter database` does not carry over from the template',
    Object.entries(SESSION_BOUNDS).every(([k, v]) => sql.includes(`alter database tmpl_3 set ${k} to '${v}';`)), sql);
  check('track_functions', sql.includes("alter database tmpl_3 set track_functions to 'all';"), sql);
  check('kayfabb.client_rpcs', /alter database tmpl_3 set kayfabb\.client_rpcs to '[^']+';/.test(sql), sql);
  check('and kayfabb.scratch_url, naming the clone itself', sql.includes("alter database tmpl_3 set kayfabb.scratch_url to 'postgres://postgres:pg@localhost:5432/tmpl_3';"), sql);
  const parsed = typeof runner.parseAfterFile === 'function' ? runner.parseAfterFile(['drift|p1|why one', 'calls|thread_page|3', '', 'calls|board_page|0']) : null;
  check('the after-file call\'s one result is read as drift rows and function counts', JSON.stringify(parsed) === JSON.stringify({ drift: [{ name: 'p1', calls: 'why one' }], calls: [{ name: 'thread_page', calls: '3' }, { name: 'board_page', calls: '0' }] }), JSON.stringify(parsed));
  check('afterFileSql asks for both, in one call', /play_post_drift\(\)/.test(runner.afterFileSql ?? '') && /pg_stat_user_functions/.test(runner.afterFileSql ?? ''));
  const sum = typeof runner.sumCalls === 'function' ? runner.sumCalls([[{ name: 'a', calls: '2' }, { name: 'b', calls: '0' }], [{ name: 'a', calls: '1' }, { name: 'c', calls: '0' }]]) : null;
  check('sumCalls adds each name\'s calls over every clone and keeps names that nobody called', JSON.stringify(sum) === JSON.stringify([{ name: 'a', calls: 3 }, { name: 'b', calls: 0 }, { name: 'c', calls: 0 }]), JSON.stringify(sum));
  check('VACUUM_STATEMENT is gone', !('VACUUM_STATEMENT' in runner));
  check('and no mention of it is left in the runner', !/VACUUM_STATEMENT/.test(fs.readFileSync('tools/test-sql.mjs', 'utf8')));
}

/* One full run, read for how the template and the clones are made. */
const full = boundedSuite(runs.full);
{
  const r = full;
  const tmpl = r.records.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean) ?? '';
  const ofTemplate = r.records.filter((c) => dbOf(c) === tmpl);
  const vacuums = r.records.filter((c) => /^\s*vacuum\b/im.test(bodyOf(c)));
  const lastBuild = ofTemplate.map((c, i) => (bodyOf(c) === 'vacuum (analyze);' ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
  const clones = r.records.map(createdClone).filter(Boolean).map((m) => m[1]);
  const fileCalls = r.records.filter(isFile);
  const settingsOn = (db) => r.records.findIndex((c) => dbOf(c) === 'postgres' && new RegExp(`alter database ${db} set`).test(bodyOf(c)));

  check('the template is created once, with no template of its own', Boolean(tmpl) && r.records.filter((c) => /^create database kayfabb_scratch_\d+_\d+;/.test(bodyOf(c))).length === 1);
  check('the shim, every migration and the fixtures go to it, one call each',
    ofTemplate.filter((c) => bodyOf(c) !== 'vacuum (analyze);').length === runner.migrationFiles().length + 1, `${ofTemplate.length} calls on ${tmpl}`);
  check('one `vacuum (analyze);` follows the fixtures, on the template', ofTemplate.filter((c) => bodyOf(c) === 'vacuum (analyze);').length === 1 && bodyOf(ofTemplate[ofTemplate.length - 1]) === 'vacuum (analyze);', `last call on the template: ${bodyOf(ofTemplate.at(-1) ?? '').slice(0, 40)}`);
  check('and it is the only vacuum of the run, so none is sent before a file', vacuums.length === 1, `${vacuums.length} calls mention vacuum`);
  check('the template is bounded before the shim, so its connections start bounded too',
    ofTemplate.length > 0 && Object.keys(SESSION_BOUNDS).every((k) => settingsOn(tmpl) >= 0 && r.records[settingsOn(tmpl)].includes(` set ${k} to `)) && settingsOn(tmpl) < r.records.findIndex((c) => dbOf(c) === tmpl), `settings at ${settingsOn(tmpl)}`);
  check('neither bound is zero, which is no bound', Object.values(SESSION_BOUNDS).every((v) => /^[1-9]\d*(ms|s|min)$/.test(v)), JSON.stringify(SESSION_BOUNDS));
  check('a lock regression costs less than a statement: lock_timeout is the shorter bound', parseInt(SESSION_BOUNDS.lock_timeout) * (SESSION_BOUNDS.lock_timeout.endsWith('min') ? 60 : 1) < parseInt(SESSION_BOUNDS.statement_timeout) * (SESSION_BOUNDS.statement_timeout.endsWith('min') ? 60 : 1));

  check('every assertion file and every end-to-end file gets a clone of the template', clones.length === assertionFiles.length + e2eFiles.length && fileCalls.length === assertionFiles.length && new Set(clones).size === clones.length, `${clones.length} clones, ${fileCalls.length} assertion calls`);
  check('each clone is named for the template and a number, so a leftover is attributable', clones.length > 0 && clones.every((c) => new RegExp(`^${tmpl}_\\d+$`).test(c)), clones.slice(0, 2).join(','));
  check('each assertion file runs on a clone of its own, not on the template', fileCalls.every((c) => clones.includes(dbOf(c))) && new Set(fileCalls.map(dbOf)).size === fileCalls.length);
  check('made before the file, with the template left alone after the fixtures', fileCalls.every((c) => r.records.findIndex((x) => createdClone(x)?.[1] === dbOf(c)) < r.records.indexOf(c)) && r.records.indexOf(fileCalls[0]) > lastBuild);
  /* What `alter database … set` does not carry to a clone. The poison is a runner that sets these on the template only. */
  const settingsText = (db) => r.records.filter((c) => dbOf(c) === 'postgres' && new RegExp(`alter database ${db} set`).test(bodyOf(c))).map(bodyOf).join('\n');
  const firstConnection = (db) => r.records.findIndex((c) => dbOf(c) === db);
  check('each clone is given lock_timeout, statement_timeout, track_functions and kayfabb.client_rpcs',
    clones.length > 0 && clones.every((db) => [...Object.entries(SESSION_BOUNDS).map(([k, v]) => `alter database ${db} set ${k} to '${v}'`), `alter database ${db} set track_functions to 'all'`, `alter database ${db} set kayfabb.client_rpcs to `].every((s) => settingsText(db).includes(s))), clones.filter((db) => !/client_rpcs/.test(settingsText(db))).length + ' without');
  check('and kayfabb.scratch_url naming the clone itself', clones.length > 0 && clones.every((db) => settingsText(db).includes(`alter database ${db} set kayfabb.scratch_url to 'postgres://postgres:pg@localhost:5432/${db}'`)));
  check('all before anything connects to it', clones.length > 0 && clones.every((db) => settingsOn(db) >= 0 && settingsOn(db) < firstConnection(db)), `${clones.filter((db) => !(settingsOn(db) >= 0 && settingsOn(db) < firstConnection(db))).length} clones connected first`);

  /* After each file, one call on its clone reads drift and the counts, before the drop. */
  const afterOf = (db) => r.records.map((c, i) => (dbOf(c) === db && bodyOf(c) === runner.afterFileSql.trim() ? i : -1)).filter((i) => i >= 0);
  const lastUse = (db) => r.records.map((c, i) => (dbOf(c) === db ? i : -1)).filter((i) => i >= 0).at(-1);
  const dropAt = (db) => r.records.findIndex((c) => droppedDb(c) === db);
  check('after each file, one call on its clone reads the drift and the function counts', clones.length > 0 && clones.every((db) => afterOf(db).length === 1), `${clones.filter((db) => afterOf(db).length !== 1).length} clones without exactly one`);
  check('after the file, and last before the drop', clones.every((db) => afterOf(db)[0] === lastUse(db) && dropAt(db) > afterOf(db)[0]));
  check('every clone is dropped with force, and only once', clones.every((db) => r.records.filter((c) => droppedDb(c) === db).length === 1));
  check('and the template is dropped last', droppedDb(r.records.at(-1) ?? '') === tmpl, bodyOf(r.records.at(-1) ?? '').slice(0, 60));
  check('the files\' lines carry their seconds', new RegExp(`PASS  ${first.replace('.', '\\.')}  \\d+\\.\\ds`).test(r.out), r.out.split('\n').filter((l) => l.includes(first)).join(' | '));
  const slowest = /slowest[^\n]*\n((?:\s+\d+\.\ds  \S+\n?)+)/.exec(r.out)?.[1].trim().split('\n') ?? [];
  check('and the summary lists the ten slowest, longest first', slowest.length === 10 && slowest.every((l, i) => i === 0 || parseFloat(slowest[i - 1]) >= parseFloat(l)), slowest.join(' | '));
  check('no file of the whole run was killed by a bound (a killed file\'s clone is rightly not read, so a kill under load would hide a read)', !/was killed/.test(r.out), r.out.split('\n').filter((l) => /was killed/.test(l)).slice(0, 2).join(' | '));
  check('a whole run compares in this process: every file against the files on disk, and the client reads', /PASS  coverage/.test(r.out) && !/FAIL  coverage/.test(r.out), r.out.split('\n').filter((l) => /coverage/.test(l)).join(' | '));
  check('no drift row from the stand-in: no file fails its drift read, and every assertion file passes', !/differs from the Acts/.test(r.out) && assertionFiles.every((f) => new RegExp(`PASS  ${f.replace('.', '\\.')}  `).test(r.out)), r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

/* A hang, a failure and a drift row, each on the first of a few files. */
{
  const hang = boundedSuite(runs.hang);
  check('a file whose psql never answers fails the suite', hang.status === 1, `status ${hang.status}`);
  /* Timed from the hung psql to the next, never over the whole run: the run's length is every other file's too, and on a busy machine
     it passed the 60s hang while the kill came at 1.5s. Half the hang leaves room for a slow Node start. */
  check('and is killed at the bound, not waited out', hang.hungMs < 30_000, `the hung psql lived ${hang.hungMs} ms`);
  check('and the failure names the file and says it was killed at the bound',
    new RegExp(`FAIL  ${first.replace('.', '\\.')}  [\\d.]+s\\s+did not finish within 1\\.5s and was killed`).test(hang.out), hang.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | '));
  check('and the files after it still run', /PASS  0001-/.test(hang.out), hang.out.slice(0, 400));
  const clonesOf = (r) => r.records.map(createdClone).filter(Boolean).map((m) => m[1]);
  check('and its clone is dropped', clonesOf(hang).length > 0 && clonesOf(hang).every((db) => hang.records.some((c) => droppedDb(c) === db)));
  /* A killed file's backend may be the one that is stuck; a read on its clone could wait out the file bound again, so it goes straight to the drop. */
  const hungClone = dbOf(hang.records.find(isFile) ?? '');
  const readsOf = (r, db) => r.records.filter((c) => dbOf(c) === db && bodyOf(c) === runner.afterFileSql.trim()).length;
  check('the killed file\'s clone is not read after it, and is dropped', Boolean(hungClone) && readsOf(hang, hungClone) === 0 && hang.records.some((c) => droppedDb(c) === hungClone), `${readsOf(hang, hungClone)} reads of ${hungClone}`);
  check('while the files that finished are read', hang.records.filter(isFile).map(dbOf).filter((db) => db !== hungClone).every((db) => readsOf(hang, db) === 1));

  const fail = boundedSuite(runs.fail);
  check('a planted failure fails that file\'s line and the suite', fail.status === 1 && new RegExp(`FAIL  ${first.replace('.', '\\.')}  [\\d.]+s\\s+ERROR:  planted failure`).test(fail.out), fail.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join(' | '));
  check('and its clone is dropped all the same', clonesOf(fail).length > 0 && clonesOf(fail).every((db) => fail.records.some((c) => droppedDb(c) === db)));

  const kept = boundedSuite(runs.kept);
  const failedClone = dbOf(kept.records.find(isFile) ?? '');
  check('KAYFABB_SQL_KEEP=failed keeps the failing file\'s clone', Boolean(failedClone) && !kept.records.some((c) => droppedDb(c) === failedClone));
  check('prints its URL', kept.out.includes(`postgres://postgres:pg@localhost:5432/${failedClone}`), kept.out.slice(0, 300));
  const passedClones = kept.records.filter(isFile).map(dbOf).filter((db) => db !== failedClone);
  check('and drops the clones of assertion files that passed', passedClones.length > 1 && passedClones.every((db) => kept.records.some((c) => droppedDb(c) === db)));
  check('without it, nothing is kept: no clone is named as kept', !/kept: postgres/.test(fail.out));

  const drifted = boundedSuite(runs.drifted);
  const driftClone = dbOf(drifted.records.find(isFile) ?? '');
  check('a drift row from one file\'s clone fails the suite', drifted.status === 1, `status ${drifted.status}`);
  check('and fails that file\'s line, naming the row', new RegExp(`FAIL  ${first.replace('.', '\\.')}  [\\d.]+s\\s+play_post or post_kinds differs from the Acts[^\\n]*\\s+00000000-0000-4000-8000-0000000000d1  a play with no row`).test(drifted.out), drifted.out.split('\n').filter((l) => /FAIL|00000000/.test(l)).join(' | '));
  check('and no other file', (drifted.out.match(/FAIL  0\d{3}-/g) ?? []).length === 1, drifted.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | '));
  check('driftFailure is null for no rows and names every row it is given', runner.driftFailure([]) === null && /a  b\nc  d/.test(runner.driftFailure([{ name: 'a', calls: 'b' }, { name: 'c', calls: 'd' }]) ?? ''));
  check('the drifted clone is dropped', Boolean(driftClone) && drifted.records.some((c) => droppedDb(c) === driftClone));

  /* The template is made and its settings fail: it is dropped, not left. */
  const noSettings = boundedSuite(runs.noSettings);
  const madeTemplate = noSettings.records.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean);
  check('a template whose settings fail fails the run before any file', noSettings.status === 1 && /planted settings failure/.test(noSettings.out) && noSettings.records.filter(isFile).length === 0, `status ${noSettings.status}`);
  check('and the template that was made is dropped, not leaked', Boolean(madeTemplate) && noSettings.records.some((c) => droppedDb(c) === madeTemplate), `${madeTemplate}: ${noSettings.records.length} calls`);

  /* A pattern run reads part of the suite: it says so under coverage, and compares nothing. */
  const part = boundedSuite(runs.part);
  const coverageText = /sql: coverage\n([\s\S]*?)\n\s*\n/.exec(part.out)?.[1] ?? '';
  check('a pattern run prints `skipped` under coverage', /skipped/.test(coverageText), coverageText);
  check('and no coverage failure', !/FAIL  coverage/.test(part.out) && part.status === 0, `status ${part.status}`);

  /* A pattern runs the matching files only; none matching fails the run. */
  const one = boundedSuite(runs.one);
  const wanted = [...assertionFiles, ...e2eFiles].filter((f) => f.includes('0001')).length;
  check('a pattern runs only the files whose names match', one.records.map(createdClone).filter(Boolean).length === wanted && one.records.filter(isFile).length === assertionFiles.filter((f) => f.includes('0001')).length && !/0002-/.test(one.out.replace(/psql[^\n]*/g, '')), `${one.records.map(createdClone).filter(Boolean).length} clones, wanted ${wanted}`);
  check('and still builds the template', one.records.filter((c) => dbOf(c) !== 'postgres').length > runner.migrationFiles().length);
  const none = boundedSuite(runs.none);
  check('a pattern that matches nothing fails the run, rather than passing on nothing', none.status === 1 && /no-such-file-anywhere/.test(none.out) && none.records.filter(isFile).length === 0, `status ${none.status}`);
}

/* ---- shards, the pool and the gathering ---- */
{
  const names = Array.from({ length: 11 }, (_, k) => `${String(k + 1).padStart(4, '0')}-f.sql`);
  /* What a split must be: shard i is the files at positions i, i+n, … (1-based), the shards are disjoint, and their union is the list. */
  const problems = (shard, list, n) => {
    const found = [];
    const parts = Array.from({ length: n }, (_, k) => shard(list, k + 1, n));
    parts.forEach((part, k) => { if (JSON.stringify(part) !== JSON.stringify(list.filter((_, at) => at % n === k))) found.push(`shard ${k + 1}/${n} is ${JSON.stringify(part)}`); });
    const all = parts.flat();
    if (new Set(all).size !== all.length) found.push(`a file is in two shards of ${n}`);
    if (JSON.stringify([...all].sort()) !== JSON.stringify([...list].sort())) found.push(`the union of ${n} shards is not the list`);
    return found;
  };
  const sizes = [1, 2, 3, 4, 7, 11, 13];
  check('over i = 1..n the shards are disjoint and their union is the list, for every n', typeof runner.shardOf === 'function' && sizes.every((n) => problems(runner.shardOf, names, n).length === 0), sizes.map((n) => problems(runner.shardOf ?? (() => []), names, n)[0]).filter(Boolean).join(' | '));
  check('shard 2 of 4 is positions 2, 6, 10', JSON.stringify(runner.shardOf?.(names, 2, 4)) === JSON.stringify([names[1], names[5], names[9]]));
  const dropsLast = (list, i, n) => runner.shardOf(list.slice(0, -1), i, n);
  const repeats = (list, i, n) => list.filter((_, at) => at % n === i - 1 || at === 0);
  check('poison: a split that drops the last file is red', typeof runner.shardOf === 'function' && sizes.some((n) => problems(dropsLast, names, n).length > 0));
  check('poison: a split that repeats a file is red', typeof runner.shardOf === 'function' && sizes.some((n) => problems(repeats, names, n).length > 0));
  const offByOne = (list, i, n) => list.filter((_, at) => at % n === i % n);
  check('poison: positions counted from 0 and not 1 is red', sizes.some((n) => problems(offByOne, names, n).length > 0));
  const rejects = (fn, i, n) => { try { fn(names, i, n); return false; } catch { return true; } };
  const notShards = [[0, 4], [5, 4], [1, 0], [1, -1], [1.5, 2], [1, 2.5], [Number.NaN, 2], [-1, 2]];
  check('i > n, i < 1, n < 1 and a non-integer are each refused', typeof runner.shardOf === 'function' && notShards.every(([i, n]) => rejects(runner.shardOf, i, n)), notShards.filter(([i, n]) => !rejects(runner.shardOf ?? (() => {}), i, n)).join(' | '));
  check('poison: a shardOf that answers a list for them is red', !notShards.every(([i, n]) => rejects((list) => list, i, n)));
  const parsed = (arg) => { try { return JSON.stringify(runner.parseShard(arg)); } catch { return 'throws'; } };
  check('--shard=i/n is read, and no flag is shard 1 of 1', parsed('2/4') === '[2,4]' && parsed(undefined) === '[1,1]', `${parsed('2/4')} ${parsed(undefined)}`);
  check('and anything that is not i/n is refused', ['3/2', '0/2', '1/0', '1/1.5', 'x', '2', '1/2/3', '-1/2'].every((a) => parsed(a) === 'throws'));
  for (const [at, bad] of ['3/2', '0/2', '1/0', '1/1.5', 'x'].entries()) {
    const r = boundedSuite(runs.bad[at]);
    check(`--shard=${bad} fails the run before any psql is called`, r.status === 1 && r.records.length === 0 && /shard/.test(r.out), `status ${r.status}, ${r.records.length} calls: ${r.out.slice(0, 120)}`);
  }

  /* The sorted list is the assertion files, then the end-to-end files; a shard of a run is what shardOf says of it. */
  const listed = typeof runner.suiteFiles === 'function' ? runner.suiteFiles().names : [];
  check('the one list is every assertion file, then every end-to-end file as `e2e/<file>`', JSON.stringify(listed) === JSON.stringify([...assertionFiles, ...e2eFiles.sort().map((f) => `e2e/${f}`)]), `${listed.length} names`);
  const shardRun = boundedSuite(runs.shard);
  const want = runner.shardOf?.(listed, 2, 3) ?? [];
  const lineNames = [...shardRun.out.matchAll(/^ {2}(?:PASS|FAIL)  (\S+\.(?:sql|ts))/gm)].map((m) => m[1]).filter((n) => listed.includes(n));
  check('a run of --shard=2/3 runs the files shardOf names for it, and no others', want.length > 0 && JSON.stringify([...lineNames].sort()) === JSON.stringify([...want].sort()), `${lineNames.length} lines, wanted ${want.length}`);
  check('and clones one for each', shardRun.records.map(createdClone).filter(Boolean).length === want.length, `${shardRun.records.map(createdClone).filter(Boolean).length} clones`);
  check('a shard does not compare coverage or files: it says `skipped`', /sql: coverage\n\s+skipped/.test(shardRun.out) && !/(PASS|FAIL)  (coverage|files)/.test(shardRun.out));

  /* The pool. An empty end-to-end directory keeps the stand-in away from the suite's real end-to-end files, and 000 takes the assertion files 0000 to 0009. */
  const mostAtOnce = (spans) => Math.max(0, ...spans.flatMap(([from]) => [spans.filter(([a, b]) => a <= from && from < b).length]));
  const wide = boundedSuite(runs.wide);
  const wideSpans = wide.spans;
  check('with KAYFABB_SQL_WORKERS=3 and a psql that sleeps, three files are in flight at once', wideSpans.length >= 6 && mostAtOnce(wideSpans) === 3, `${wideSpans.length} files, ${mostAtOnce(wideSpans)} at once`);
  check('and never a fourth, over the whole run', mostAtOnce(wideSpans) <= 3);
  check('and every one of them ran and passed', wideSpans.length === (wide.out.match(/^ {2}PASS  000\d-/gm) ?? []).length && wide.status === 0, `status ${wide.status}`);
  const alone = boundedSuite(runs.alone);
  check('with one worker, one at a time', mostAtOnce(alone.spans) === 1 && alone.status === 0, `${mostAtOnce(alone.spans)} at once`);
  /* A failing file does not stop the others; each file's output is one block; the failed count is the number of failed files. */
  const failing = boundedSuite(runs.failing);
  const total = (failing.out.match(/^ {2}(?:PASS|FAIL)  000\d-/gm) ?? []).length;
  check('a failing file does not stop the others: the rest still run and pass', failing.status === 1 && total >= 6 && (failing.out.match(/^ {2}PASS  000\d-/gm) ?? []).length === total - 2, `${total} files`);
  check('the failed count is the number of failed files', new RegExp(`; 2 failed`).test(failing.out), failing.out.split('\n').filter((l) => /failed/.test(l)).join(' | '));
  const blocks = [...failing.out.matchAll(/^ {2}FAIL  (000\d-\S+)  [\d.]+s\n {8}ERROR:  planted failure\n {8}DETAIL:  a second line$/gm)];
  check('each file\'s output is one block: a failure\'s two lines follow its line, with no other file\'s between', blocks.length === 2, `${blocks.length} whole blocks`);

  /* The report, and the gathering. */
  const reported = boundedSuite(runs.reported);
  const rep = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  check('--report writes the shard, each file with its outcome and seconds, and the summed calls', rep !== null && rep.shard.i === 1 && rep.shard.n === 1 && rep.files.length >= 6 && rep.files.every((f) => typeof f.name === 'string' && ['passed', 'failed'].includes(f.outcome) && typeof f.seconds === 'number') && rep.files.filter((f) => f.outcome === 'failed').length === 1 && JSON.stringify(rep.calls) === JSON.stringify([{ name: 'thread_page', calls: 3 * rep.files.length }]), JSON.stringify(rep).slice(0, 300));
  check('and the files are in name order', rep !== null && JSON.stringify(rep.files.map((f) => f.name)) === JSON.stringify([...rep.files.map((f) => f.name)].sort()));

  const disk = ['0001-a.sql', '0002-b.sql', 'e2e/0001-c.ts', 'e2e/0002-d.ts'];
  const report = (i, n, files, outcome = 'passed', calls = [{ name: 'thread_page', calls: 1 }]) => ({ shard: { i, n }, files: files.map((name) => ({ name, outcome, seconds: 1 })), calls });
  const good = () => [report(1, 2, [disk[0], disk[2]]), report(2, 2, [disk[1], disk[3]])];
  const gf = (reports) => (typeof runner.gatherFailures === 'function' ? runner.gatherFailures(reports, disk) : ['no gatherFailures']);
  check('shard reports that cover every file once, passed, fail nothing', gf(good()).length === 0, gf(good()).join(' | '));
  const dropped = good(); dropped[1].files.pop();
  check('a file in no report is named', gf(dropped).some((m) => m.includes('e2e/0002-d.ts') && /no report/.test(m)), gf(dropped).join(' | '));
  const twice = good(); twice[1].files.push({ name: disk[0], outcome: 'passed', seconds: 1 });
  check('a file in two reports is named', gf(twice).some((m) => m.includes('0001-a.sql') && /2 reports/.test(m)), gf(twice).join(' | '));
  const failedOne = good(); failedOne[0].files[1].outcome = 'failed';
  check('a file that did not pass is named', gf(failedOne).some((m) => m.includes('e2e/0001-c.ts') && /did not pass/.test(m)), gf(failedOne).join(' | '));
  const totals = good(); totals[1].shard.n = 3;
  check('shard totals that differ are named', gf(totals).some((m) => /disagree/.test(m)), gf(totals).join(' | '));
  const lone = [good()[0]];
  check('a missing shard number is named', gf(lone).some((m) => /shard 2\/2 has no report/.test(m)), gf(lone).join(' | '));
  const stale = good(); stale[1].files.push({ name: 'e2e/0099-gone.ts', outcome: 'passed', seconds: 1 });
  check('a report that names a file not on disk is named, so a stale or foreign report does not pass', gf(stale).some((m) => m.includes('e2e/0099-gone.ts') && /not on disk/.test(m)), gf(stale).join(' | '));
  check('no report at all fails', gf([]).length > 0);
  check('a report with no shard fails', gf([{ files: [] }, ...good()]).some((m) => /no shard/.test(m)));
  check('a shard that ran nothing, with its files in no report, fails', gf([report(1, 2, []), report(2, 2, [disk[1], disk[3]])]).length > 0);

  /* --gather: no database, no refusal; every report on disk against the files on disk, then the reads on the summed counts. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-gather-'));
  const onDisk = typeof runner.suiteFiles === 'function' ? runner.suiteFiles().names : [];
  const halves = (mut = (x) => x) => {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'sql-shard-2'), { recursive: true }); fs.mkdirSync(path.join(dir, 'sql-shard-1'), { recursive: true });
    const [a, b] = mut([report(1, 2, onDisk.filter((_, k) => k % 2 === 0)), report(2, 2, onDisk.filter((_, k) => k % 2 === 1))]);
    if (a) fs.writeFileSync(path.join(dir, 'sql-shard-1', 'report.json'), JSON.stringify(a));
    if (b) fs.writeFileSync(path.join(dir, 'sql-shard-2', 'report.json'), JSON.stringify(b));
  };
  const gathered = () => {
    fs.rmSync(marker, { force: true });
    const env = /** @type {NodeJS.ProcessEnv} */ ({ ...process.env, KAYFABB_PSQL_SHIM: recorder });
    delete env.DATABASE_URL;
    const r = spawnSync(process.execPath, ['tools/test-sql.mjs', `--gather=${dir}`], { env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr, psqlRan: fs.existsSync(marker) };
  };
  halves();
  const okGather = gathered();
  check('--gather passes on reports that cover every file on disk once, with no DATABASE_URL and no psql', okGather.status === 0 && !okGather.psqlRan, `status ${okGather.status}: ${okGather.out.slice(0, 300)}`);
  halves((r) => [r[0], null]);
  const missing = gathered();
  check('--gather fails on a missing shard and the files it held', missing.status === 1 && /shard 2\/2 has no report/.test(missing.out) && /is in no report/.test(missing.out), missing.out.slice(0, 300));
  halves((r) => { r[1].files.push(r[0].files[0]); return r; });
  const dup = gathered();
  check('--gather fails on a file in two reports', dup.status === 1 && /in 2 reports/.test(dup.out), dup.out.slice(0, 300));
  halves((r) => { r[0].files[0].outcome = 'failed'; return r; });
  const notPassed = gathered();
  check('--gather fails on a file that did not pass', notPassed.status === 1 && /did not pass/.test(notPassed.out), notPassed.out.slice(0, 300));
  halves((r) => { r[0].calls = [{ name: 'planted_read', calls: 0 }]; r[1].calls = []; return r; });
  const unread = gathered();
  check('--gather fails on a client read no shard called, on the counts summed over the shards', unread.status === 1 && /planted_read/.test(unread.out), unread.out.slice(0, 300));
  halves((r) => { r[0].calls = [{ name: 'thread_page', calls: 0 }]; r[1].calls = [{ name: 'thread_page', calls: 2 }]; return r; });
  const summed = gathered();
  check('and passes when another shard called it: the sum is what is compared', summed.status === 0, summed.out.slice(0, 300));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---- a file that holds a wall-clock budget runs alone (#1099) ---- */
{
  const mostAtOnce = (spans) => Math.max(0, ...spans.flatMap(([from]) => [spans.filter(([a, b]) => a <= from && from < b).length]));
  const timed = (text) => (typeof runner.holdsClockBudget === 'function' ? runner.holdsClockBudget(text) : null);
  const wrap = (body) => `do $$ declare t0 timestamptz; spent interval; begin ${body} end $$;`;
  check('an elapsed time compared in an `if … then raise exception` is a budget', timed(wrap("t0 := clock_timestamp(); spent := clock_timestamp() - t0; if spent > interval '1 second' then raise exception 'slow'; end if;")) === true);
  check('and so is the clock itself in the condition', timed(wrap("if (select claimed_until - clock_timestamp() from t) > interval '1 minute' then raise exception 'x'; end if;")) === true);
  check('and an assert on an elapsed time', timed(wrap("t0 := clock_timestamp(); spent := clock_timestamp() - t0; assert spent < interval '1 s', 'slow';")) === true);
  check('and a helper that raises, called with an elapsed time', timed("create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$ begin if not ok then raise exception '%', what; end if; end $$;\n" + wrap("t0 := clock_timestamp(); spent := clock_timestamp() - t0; perform pg_temp.expect(spent < interval '1 s', 'slow');")) === true);
  check('an elapsed time kept in a variable of a declaration counts as well', timed("do $$ declare t0 timestamptz := clock_timestamp(); begin if extract(epoch from clock_timestamp() - t0) > 2 then raise exception 'slow'; end if; end $$;") === true);
  check('the clock as an id or a timestamp a row is written with is not a budget', timed("insert into meetings (slot) values (clock_timestamp());\ndo $$ begin if (select count(*) from meetings) <> 1 then raise exception 'x'; end if; end $$;") === false);
  check('nor the clock printed in a NOTICE, or a time measured and only printed', timed(wrap("t0 := clock_timestamp(); spent := clock_timestamp() - t0; raise notice 'took %', spent;")) === false);
  check('nor a comment or a string that says so', timed("-- if clock_timestamp() - t0 > 1 then raise exception 'slow'; end if;\ndo $$ begin raise exception 'a clock_timestamp() then raise exception'; end $$;") === false);
  check('an `end if` and an `if exists` are not conditions', timed(wrap("drop table if exists t; t0 := clock_timestamp(); if true then null; end if; if clock_timestamp() > t0 then null; end if; raise exception 'x';")) === false);
  const carries = (text) => (typeof runner.carriesAloneMarker === 'function' ? runner.carriesAloneMarker(text) : null);
  check('the marker is `-- kayfabb-sql: alone` on a line of its own', carries('-- why\n-- kayfabb-sql: alone\nselect 1;') === true);
  check('inside a block comment it does not count', carries('/*\n-- kayfabb-sql: alone\n*/\nselect 1;') === false);
  check('misspelled, it does not count', ['-- kayfabb-sql: alon', '-- kayfabb sql: alone', '--kayfabb-sql: alonee', '-- kayfabb-sql: alone now', 'select 1; -- kayfabb-sql: alone'].every((t) => carries(t) === false));

  /* Every real file says what it is: a file holds a budget exactly when it carries the marker. */
  const mismatched = assertionFiles.filter((f) => { const t = fs.readFileSync(path.join('supabase/tests', f), 'utf8'); return timed(t) !== carries(t); });
  check('every assertion file carries the marker if and only if it holds a wall-clock budget', typeof runner.holdsClockBudget === 'function' && mismatched.length === 0, mismatched.join(', '));

  /* The runner refuses what the check names, on planted files; it runs a marked file. */
  const t = boundedSuite(runs.timed);
  const lineOf = (name) => new RegExp(`^ {2}(PASS|FAIL)  ${name.replace('.', '\\.')}[^\n]*(?:\n {8}[^\n]*)*`, 'm').exec(t.out)?.[0] ?? '';
  check('a timed file with no marker is refused, saying what to add', /FAIL/.test(lineOf('0001-timed-unmarked.sql')) && /wall-clock budget/.test(lineOf('0001-timed-unmarked.sql')) && /-- kayfabb-sql: alone/.test(lineOf('0001-timed-unmarked.sql')), lineOf('0001-timed-unmarked.sql'));
  check('a marker inside a block comment does not save it', /FAIL/.test(lineOf('0002-marker-in-a-block-comment.sql')) && /wall-clock budget/.test(lineOf('0002-marker-in-a-block-comment.sql')), lineOf('0002-marker-in-a-block-comment.sql'));
  check('nor does a marker that is misspelled', /FAIL/.test(lineOf('0003-marker-misspelled.sql')) && /wall-clock budget/.test(lineOf('0003-marker-misspelled.sql')), lineOf('0003-marker-misspelled.sql'));
  check('a marker on a file that holds no budget is refused too: the marker means what it says', /FAIL/.test(lineOf('0004-marker-on-an-untimed-file.sql')) && /holds no wall-clock budget/.test(lineOf('0004-marker-on-an-untimed-file.sql')), lineOf('0004-marker-on-an-untimed-file.sql'));
  check('a timed file with its marker runs and passes', /PASS/.test(lineOf('0005-timed-and-marked.sql')), lineOf('0005-timed-and-marked.sql'));
  check('and a file that only uses the clock as a value is not asked for one', /PASS/.test(lineOf('0006-clock-as-a-value.sql')), lineOf('0006-clock-as-a-value.sql'));
  check('the refused files get no clone, and the run fails', t.status === 1 && t.records.map(createdClone).filter(Boolean).length === 2, `${t.records.map(createdClone).filter(Boolean).length} clones, status ${t.status}`);

  /* The pool, with a file that runs alone: nothing is in flight beside it, and it waits for the others to end. */
  const a = boundedSuite(runs.aloneFiles);
  const spans = a.spans;
  const overlaps = (x, y) => x[0] < y[1] && y[0] < x[1];
  const aloneSpans = spans.filter((x) => x[2] === 'alone');
  const pooledSpans = spans.filter((x) => x[2] === 'pooled');
  check('both marked files and all the others ran and passed', aloneSpans.length === 2 && pooledSpans.length === 6 && a.status === 0, `${aloneSpans.length} alone, ${pooledSpans.length} pooled, status ${a.status}`);
  check('while a file that runs alone is in flight, the count in flight is 1', aloneSpans.every((x) => spans.filter((y) => y !== x && overlaps(x, y)).length === 0), JSON.stringify(spans));
  check('it waits for every other file to end, and starts none after it begins', aloneSpans.every((x) => pooledSpans.every((y) => y[1] <= x[0])), JSON.stringify(spans));
  check('and the others still ran together, three at a time', mostAtOnce(pooledSpans) === 3, `${mostAtOnce(pooledSpans)} at once`);
}

/* ---- a run that is interrupted leaves nothing on the server ---- */
{
  const { state, env, args } = ready({ pattern: small, e2eDir: emptyDir, workers: '1', extraEnv: { SLEEP_MS: '60000' } });
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const began = Date.now();
  const files = () => (fs.existsSync(path.join(state, 'calls')) ? fs.readFileSync(path.join(state, 'calls'), 'utf8').split('\x1e\n').filter((x) => x.trim()) : []);
  /* Until a file is running on its clone: its psql is sleeping, so the run is in the middle of the pool. */
  while (Date.now() - began < 240_000 && !files().some(isFile)) await new Promise((r) => setTimeout(r, 100));
  child.kill('SIGINT');
  const result = await Promise.race([exited, new Promise((r) => setTimeout(() => r({ code: 'still running', signal: null }), 30_000))]);
  if (result.code === 'still running') child.kill('SIGKILL');
  const recs = files();
  const tmplName = recs.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean) ?? '';
  const sweep = recs.find((c) => dbOf(c) === 'postgres' && /drop database if exists %I with \(force\)/.test(bodyOf(c)) && bodyOf(c).includes(`datname = '${tmplName}'`) && bodyOf(c).includes(`like '${tmplName}\\_%'`));
  check('SIGINT during a run exits 130, not by the signal and not left running', result.code === 130, `${JSON.stringify(result)}`);
  check('and drops the template and every database named `<template>_%` (clones, their sub-databases, snapshots) in one sweep', Boolean(tmplName) && Boolean(sweep), `${tmplName}: ${recs.length} calls`);
  check('and the in-flight psql is killed with it, not waited out', Date.now() - began < 200_000 && result.code !== 'still running');
  /* psql missing: exit 2 at once, with the same cleanup path (which cannot itself need psql in a loop). */
  const lost = spawnSync(process.execPath, ['tools/test-sql.mjs', small], { env: { ...process.env, KAYFABB_PSQL_SHIM: '', PATH: '/nonexistent', DATABASE_URL: 'postgres://postgres:pg@localhost:5432/postgres' }, encoding: 'utf8', timeout: 60_000 });
  check('psql not found exits 2 and says so', lost.status === 2 && /not found/.test(lost.stdout + lost.stderr), `status ${lost.status}: ${(lost.stdout + lost.stderr).slice(0, 200)}`);
}

/* The end-to-end helper's own psql calls are bounded, so a stuck clone cannot hang a file past the runner's bound. */
{
  const helper = fs.readFileSync('supabase/tests/e2e/psql-db.ts', 'utf8');
  const onServer = /const onServer = [^\n]*/.exec(helper)?.[0] ?? '';
  check('psql-db.ts\'s onServer has a timeout that kills', /timeout: FILE_TIMEOUT_MS/.test(onServer) && /killSignal: 'SIGKILL'/.test(onServer), onServer.slice(0, 200));
}

/* ---- the end-to-end files: snapshots of the replay, and what a file may not do ---- */
{
  const names = ['0003-export.ts', '0007-avatar-sweep-across-0025.ts', '0008-turns-across-0028.ts', '0001-settlement.ts', '0026-kept-across-0356.ts'];
  const have = typeof runner.snapshotPoints === 'function';
  const points = have ? runner.snapshotPoints(names) : null;
  check('snapshotPoints reads the migrations named by -across-MMMM, sorted', JSON.stringify(points) === JSON.stringify(['0025', '0028', '0356']), JSON.stringify(points));
  const throws = (fn) => { try { fn(); return ''; } catch (e) { return String(e.message ?? e); } };
  check('a file that is not an upgrade test names no point and is not an error', have && JSON.stringify(runner.snapshotPoints(['0001-a.ts', '0002-b.ts'])) === '[]');
  const noPoint = have ? throws(() => runner.snapshotPoints(['0007-avatar-sweep-across-.ts'])) : '';
  check('a name that says -across- with no point is refused, naming the file', /0007-avatar-sweep-across-\.ts/.test(noPoint) && /point/.test(noPoint), noPoint);
  const noPoint2 = have ? throws(() => runner.snapshotPoints(['0007-x-across-25.ts'])) : '';
  check('and so is one whose point is not four digits', /0007-x-across-25\.ts/.test(noPoint2), noPoint2);
  const twice = have ? throws(() => runner.snapshotPoints(['0007-a-across-0025.ts', '0009-b-across-0025.ts'])) : '';
  check('two files naming one point are refused, naming both', /0007-a-across-0025\.ts/.test(twice) && /0009-b-across-0025\.ts/.test(twice), twice);
  const missing = have ? throws(() => runner.snapshotPoints(['0007-a-across-0025.ts', '0008-b-across-9999.ts'], ['0024_x.sql', '0025_y.sql'])) : '';
  check('a point no migration has is refused, naming it', /9999/.test(missing) && /0008-b-across-9999\.ts/.test(missing), missing);
  check('and a point a migration has is not', have && JSON.stringify(runner.snapshotPoints(['0007-a-across-0025.ts'], ['0024_x.sql', '0025_y.sql'])) === '["0025"]');

  const reads = typeof runner.e2eRefusal === 'function' ? (t) => runner.e2eRefusal(t) : () => 'no e2eRefusal';
  check('an end-to-end file that reads supabase/migrations is refused', /supabase\/migrations/.test(reads("fs.readdirSync(path.join(root, 'supabase/migrations'))") ?? ''));
  check('and so is one that reads migrationFiles', /migrationFiles/.test(reads("import { migrationFiles } from '../../../tools/test-sql.mjs'; migrationFiles();") ?? ''));
  check('a mention in a comment is not read', reads("// the migrations (supabase/migrations/0025_avatars.sql)\n/* supabase/migrations and migrationFiles */\nconst a = 1;") === null);
  check('a URL\'s double slash does not hide what follows it on the line', /migrationFiles/.test(reads("const u = 'postgres://x'; migrationFiles();") ?? ''));

  const tmplOf = (r) => r.records.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean) ?? '';

  /* Poison: a file that replays the migrations itself. */
  const poison = boundedSuite(runs.poison);
  check('the runner refuses an end-to-end file that replays the migrations itself, and the run fails', poison.status === 1 && /FAIL  e2e\/0901-replays-the-migrations\.ts[^\n]*\s+reads supabase\/migrations/.test(poison.out), poison.out.split('\n').filter((l) => /FAIL|e2e/.test(l)).join(' | ').slice(0, 400));
  check('and one that asks migrationFiles', /FAIL  e2e\/0902-asks-the-list\.ts[^\n]*\s+reads[^\n]*migrationFiles/.test(poison.out), poison.out.slice(0, 300));
  check('the refused files get no clone, and one that only mentions them in a comment still runs and passes', /PASS  e2e\/0903-only-says-so\.ts/.test(poison.out) && poison.records.map(createdClone).filter(Boolean).length === 1, `${poison.records.map(createdClone).filter(Boolean).length} clones`);

  /* What the file is told. */
  const told = boundedSuite(runs.told);
  const saw = fs.existsSync(sawIn + '4') ? JSON.parse(fs.readFileSync(sawIn + '4', 'utf8')) : {};
  const cloneOf = told.records.map(createdClone).filter(Boolean)[0]?.[1];
  check('an end-to-end file is told its clone in KAYFABB_SCRATCH_URL', Boolean(cloneOf) && saw.url === `postgres://postgres:pg@localhost:5432/${cloneOf}`, JSON.stringify(saw));
  const snaps = saw.snapshots ? JSON.parse(saw.snapshots) : {};
  check('and the snapshots in KAYFABB_SNAPSHOTS: `migrated`, and a point for each file that names one', typeof snaps.migrated === 'string' && snaps.migrated.startsWith(tmplOf(told)), saw.snapshots);
  const pointed = boundedSuite(runs.pointed);
  const sawPointed = fs.existsSync(sawIn + '5') ? JSON.parse(fs.readFileSync(sawIn + '5', 'utf8')) : {};
  const pointedSnaps = sawPointed.snapshots ? JSON.parse(sawPointed.snapshots) : {};
  check('a point a file names is in it, and its database is made from the template', /^kayfabb_scratch_\d+_\d+_/.test(pointedSnaps['0003'] ?? '') && pointed.records.some((c) => bodyOf(c).startsWith(`create database ${pointedSnaps['0003']} template ${tmplOf(pointed)};`)), sawPointed.snapshots);

  /* Each snapshot is made between the right two migrations, by `create database … template`, and given the settings. */
  const bodies = (r) => r.records.map((c) => ({ db: dbOf(c), body: bodyOf(c) }));
  const migrationBody = (n) => fs.readFileSync(path.join('supabase/migrations', n), 'utf8').trim();
  const allMigrations = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  const indexOfBody = (r, text) => bodies(r).findIndex((b) => b.body === text.trim());
  const at = (r, db) => bodies(r).findIndex((b) => b.db === 'postgres' && b.body.startsWith(`create database ${db} template `));
  const thirdAt = allMigrations.indexOf('0003_aura.sql');
  const snapOf = pointedSnaps['0003'];
  check('the snapshot of 0003 is made after 0002 and before 0003', at(pointed, snapOf) > indexOfBody(pointed, migrationBody(allMigrations[thirdAt - 1])) && at(pointed, snapOf) >= 0 && at(pointed, snapOf) < indexOfBody(pointed, migrationBody(allMigrations[thirdAt])), `${indexOfBody(pointed, migrationBody(allMigrations[thirdAt - 1]))} < ${at(pointed, snapOf)} < ${indexOfBody(pointed, migrationBody(allMigrations[thirdAt]))}`);
  const migrated = pointedSnaps.migrated;
  const lastBody = migrationBody(allMigrations.at(-1));
  const fixturesBody = fs.readFileSync('supabase/tests/setup/fixtures.sql', 'utf8').trim();
  check('the migrated snapshot is made after the last migration and before the fixtures', at(pointed, migrated) > indexOfBody(pointed, lastBody) && at(pointed, migrated) < indexOfBody(pointed, fixturesBody), `${indexOfBody(pointed, lastBody)} < ${at(pointed, migrated)} < ${indexOfBody(pointed, fixturesBody)}`);
  const settingsOf = (r, db) => r.records.filter((c) => dbOf(c) === 'postgres' && new RegExp(`alter database ${db} set`).test(bodyOf(c))).map(bodyOf).join('\n');
  check('each snapshot is given the bounds, track_functions and client_rpcs, which a clone does not carry', [snapOf, migrated].every((db) => Boolean(db) && Object.entries(SESSION_BOUNDS).every(([k, v]) => settingsOf(pointed, db).includes(`alter database ${db} set ${k} to '${v}'`)) && settingsOf(pointed, db).includes(`alter database ${db} set track_functions to 'all'`) && settingsOf(pointed, db).includes(`alter database ${db} set kayfabb.client_rpcs`)));
  const droppedAt = (r, db) => r.records.findIndex((c) => droppedDb(c) === db);
  check('the snapshots are dropped, before the template', [snapOf, migrated].every((db) => Boolean(db) && droppedAt(pointed, db) > 0 && droppedAt(pointed, db) < droppedAt(pointed, tmplOf(pointed))));

  /* A run with no end-to-end file in it makes no snapshot. */
  const noE2e = boundedSuite(runs.noE2e);
  check('a pattern that selects no end-to-end file makes no snapshot', noE2e.records.length > 0 && !noE2e.records.some((c) => dbOf(c) === 'postgres' && /^create database \w+_(s\d+|migrated) /.test(bodyOf(c))), '');

  /* Whatever a file leaves named after its clone goes with the clone. */
  const dropOf = pointed.records.filter((c) => dbOf(c) === 'postgres' && /pg_database/.test(bodyOf(c)) && /\\gexec/.test(bodyOf(c)));
  check('when a clone is dropped, so is every database named for it (<clone>_%)', dropOf.length >= 1 && dropOf.every((c) => /like 'kayfabb_scratch_\d+_\d+_\d+\\_%'/.test(bodyOf(c))), dropOf[0] ? bodyOf(dropOf[0]) : 'no such call');

  /* A point no migration has fails the run before anything runs. */
  const nowhere = boundedSuite(runs.nowhere);
  check('a point no migration has fails the run before any psql is called', nowhere.status === 1 && /9999/.test(nowhere.out) && nowhere.records.length === 0, `status ${nowhere.status}, ${nowhere.records.length} calls: ${nowhere.out.slice(0, 200)}`);
  const dupe = boundedSuite(runs.dupe);
  check('two files naming one point fail the run before any psql is called', dupe.status === 1 && /0907-a-across-0003\.ts/.test(dupe.out) && /0908-b-across-0003\.ts/.test(dupe.out) && dupe.records.length === 0, `status ${dupe.status}, ${dupe.records.length} calls`);
  const unpointed = boundedSuite(runs.unpointed);
  check('and so does a name with -across- and no point', unpointed.status === 1 && /0909-x-across-\.ts/.test(unpointed.out) && unpointed.records.length === 0, `status ${unpointed.status}`);
  for (const d of [...Object.values(planted), ...Object.values(testsPlanted), emptyDir]) fs.rmSync(d, { recursive: true, force: true });

  /* The real files: every upgrade test is named for its point, and no file replays the migrations on its own. */
  const real = have ? (() => { try { return runner.snapshotPoints(e2eFiles, allMigrations); } catch (e) { return String(e.message); } })() : 'no snapshotPoints';
  check('the end-to-end files\' names give their points, each of which a migration has', Array.isArray(real) && real.join(',') === '0025,0028,0029,0082,0115,0139,0356', String(real));
  const replaying = e2eFiles.filter((f) => runner.e2eRefusal?.(fs.readFileSync(path.join('supabase/tests/e2e', f), 'utf8')) != null);
  check('and no end-to-end file replays migrations on its own: the runner refuses none of them', typeof runner.e2eRefusal === 'function' && replaying.length === 0, replaying.join(', '));
}
fs.rmSync(bounded, { recursive: true, force: true });

fs.rmSync(bin, { recursive: true, force: true });
console.log(`\n  sql-refusal: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-refusal: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
