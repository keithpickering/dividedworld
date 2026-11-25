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

/* ---- the template and a clone for each file ---- */
/* A psql that records its arguments and its SQL, one record per call, and succeeds. Planted behavior, each once and on the first
   assertion file's call (the harness wraps each in `begin;`): HANG never answers, as a backend stuck on a deadlock it cannot see
   would; FAIL answers an error; DRIFT answers the drift rows it names with the tag the after-file call reads. */
const bounded = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-psql-bounds-'));
const calls = path.join(bounded, 'calls');
const hung = path.join(bounded, 'hung');
/* When each psql began, one time to a line, so the kill is timed by the gap from the hung psql to the one after it. */
const starts = path.join(bounded, 'starts');
const hanger = path.join(bounded, 'psql.mjs');
fs.writeFileSync(hanger, `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(starts)}, Date.now() + '\\n');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n' + sql + '\\n\\x1e\\n');
/* The after-file call, on the clone of the first file: answered with the drift rows DRIFT names (\`drift|play|why\`, as psql -A -t -F '|' prints them). */
/* A planted behavior happens once: the first psql to create the marker file is the one that takes it, and with files in flight together two cannot both. */
const once = (file, text = '1') => { try { fs.writeFileSync(file, text, { flag: 'wx' }); return true; } catch { return false; } };
if (process.env.DRIFT && /^select pg_stat_force_next_flush\\(\\);/.test(sql) && once(${JSON.stringify(hung)} + '.drift')) process.stdout.write('drift|' + process.env.DRIFT + '\\n');
/* The template's creation, with its settings in the same call: the database is made, then the settings fail. */
if (process.env.FAIL_SETTINGS && /^create database kayfabb_scratch_\\d+_\\d+;/.test(sql)) { process.stderr.write('ERROR:  planted settings failure'); process.exit(1); }
if (/^begin;\\n/.test(sql)) {
  /* FAIL_N: the first N files fail, each with an error of two lines. SLEEP_MS: a file takes that long, and its span is recorded. */
  for (let k = 1; k <= Number(process.env.FAIL_N || 0); k++) if (once(${JSON.stringify(hung)} + '.n' + k)) { process.stderr.write('ERROR:  planted failure\\nDETAIL:  a second line'); process.exit(1); }
  if (process.env.HANG || process.env.FAIL) if (once(${JSON.stringify(hung)}, String(Date.now()))) {
    if (process.env.FAIL) { process.stderr.write('ERROR:  planted failure'); process.exit(1); }
    setTimeout(() => {}, 60_000);
  }
  if (process.env.SLEEP_MS) {
    const began = Date.now();
    await new Promise((r) => setTimeout(r, Number(process.env.SLEEP_MS)));
    fs.appendFileSync(${JSON.stringify(calls)} + '.spans', began + ' ' + Date.now() + '\\n');
  }
}
`);
/** One run of the suite with the recording psql. `pattern` limits it to the files whose names match; `hang`, `fail` and `drift` plant what is above. */
function boundedSuite({ pattern = '', hang = false, fail = false, drift = '', keep = '', timeoutMs = '1500', e2eDir = '', extraEnv = {} } = {}) {
  for (const f of [calls, calls + '.spans', hung, hung + '.drift', hung + '.n1', hung + '.n2', starts]) fs.rmSync(f, { force: true });
  const env = { ...process.env, KAYFABB_PSQL_SHIM: hanger, DATABASE_URL: 'postgres://postgres:pg@localhost:5432/postgres', KAYFABB_SQL_FILE_TIMEOUT_MS: timeoutMs, HANG: hang ? '1' : '', FAIL: fail ? '1' : '', DRIFT: drift, KAYFABB_SQL_KEEP: keep, ...(e2eDir ? { KAYFABB_SQL_E2E_DIR: e2eDir } : {}), ...extraEnv };
  /* The suite's own end-to-end files would try a clone this psql never made; a bound keeps a slip here from hanging the
     build. It is wide, since the whole run under a busy build (a Node start for each psql, the end-to-end files) took 85s on Windows. */
  const r = spawnSync(process.execPath, ['tools/test-sql.mjs', ...(pattern ? [pattern] : [])], { env, encoding: 'utf8', timeout: 600_000 });
  const records = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\x1e\n').filter((x) => x.trim()) : [];
  /* How long the hung psql lived: from its start to the start of the next psql, which the suite runs once the hung one is killed. */
  const hungAt = fs.existsSync(hung) ? Number(fs.readFileSync(hung, 'utf8')) : NaN;
  const after = fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').split('\n').filter(Boolean).map(Number).find((t) => t > hungAt) : undefined;
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), records, hungMs: after === undefined ? NaN : after - hungAt };
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
const full = boundedSuite();
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
  check('no drift row from the stand-in: no file fails its drift read, and every assertion file passes', !/differs from the Acts/.test(r.out) && assertionFiles.every((f) => new RegExp(`PASS  ${f.replace('.', '\\.')}  `).test(r.out)), r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

/* A hang, a failure and a drift row, each on the first of a few files. */
{
  const small = '000';
  const hang = boundedSuite({ pattern: small, hang: true });
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

  const fail = boundedSuite({ pattern: small, fail: true });
  check('a planted failure fails that file\'s line and the suite', fail.status === 1 && new RegExp(`FAIL  ${first.replace('.', '\\.')}  [\\d.]+s\\s+ERROR:  planted failure`).test(fail.out), fail.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join(' | '));
  check('and its clone is dropped all the same', clonesOf(fail).length > 0 && clonesOf(fail).every((db) => fail.records.some((c) => droppedDb(c) === db)));

  const kept = boundedSuite({ pattern: small, fail: true, keep: 'failed' });
  const failedClone = dbOf(kept.records.find(isFile) ?? '');
  check('KAYFABB_SQL_KEEP=failed keeps the failing file\'s clone', Boolean(failedClone) && !kept.records.some((c) => droppedDb(c) === failedClone));
  check('prints its URL', kept.out.includes(`postgres://postgres:pg@localhost:5432/${failedClone}`), kept.out.slice(0, 300));
  const passedClones = kept.records.filter(isFile).map(dbOf).filter((db) => db !== failedClone);
  check('and drops the clones of assertion files that passed', passedClones.length > 1 && passedClones.every((db) => kept.records.some((c) => droppedDb(c) === db)));
  check('without it, nothing is kept: no clone is named as kept', !/kept: postgres/.test(fail.out));

  const drifted = boundedSuite({ pattern: small, drift: '00000000-0000-4000-8000-0000000000d1|a play with no row' });
  const driftClone = dbOf(drifted.records.find(isFile) ?? '');
  check('a drift row from one file\'s clone fails the suite', drifted.status === 1, `status ${drifted.status}`);
  check('and fails that file\'s line, naming the row', new RegExp(`FAIL  ${first.replace('.', '\\.')}  [\\d.]+s\\s+play_post or post_kinds differs from the Acts[^\\n]*\\s+00000000-0000-4000-8000-0000000000d1  a play with no row`).test(drifted.out), drifted.out.split('\n').filter((l) => /FAIL|00000000/.test(l)).join(' | '));
  check('and no other file', (drifted.out.match(/FAIL  0\d{3}-/g) ?? []).length === 1, drifted.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | '));
  check('driftFailure is null for no rows and names every row it is given', runner.driftFailure([]) === null && /a  b\nc  d/.test(runner.driftFailure([{ name: 'a', calls: 'b' }, { name: 'c', calls: 'd' }]) ?? ''));
  check('the drifted clone is dropped', Boolean(driftClone) && drifted.records.some((c) => droppedDb(c) === driftClone));

  /* The template is made and its settings fail: it is dropped, not left. */
  const noSettings = boundedSuite({ pattern: first, extraEnv: { FAIL_SETTINGS: '1' } });
  const madeTemplate = noSettings.records.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean);
  check('a template whose settings fail fails the run before any file', noSettings.status === 1 && /planted settings failure/.test(noSettings.out) && noSettings.records.filter(isFile).length === 0, `status ${noSettings.status}`);
  check('and the template that was made is dropped, not leaked', Boolean(madeTemplate) && noSettings.records.some((c) => droppedDb(c) === madeTemplate), `${madeTemplate}: ${noSettings.records.length} calls`);

  /* A pattern run reads part of the suite: it says so under coverage, and compares nothing. */
  const part = boundedSuite({ pattern: first });
  const coverageText = /sql: coverage\n([\s\S]*?)\n\s*\n/.exec(part.out)?.[1] ?? '';
  check('a pattern run prints `skipped` under coverage', /skipped/.test(coverageText), coverageText);
  check('and no coverage failure', !/FAIL  coverage/.test(part.out) && part.status === 0, `status ${part.status}`);

  /* A pattern runs the matching files only; none matching fails the run. */
  const one = boundedSuite({ pattern: '0001' });
  const wanted = [...assertionFiles, ...e2eFiles].filter((f) => f.includes('0001')).length;
  check('a pattern runs only the files whose names match', one.records.map(createdClone).filter(Boolean).length === wanted && one.records.filter(isFile).length === assertionFiles.filter((f) => f.includes('0001')).length && !/0002-/.test(one.out.replace(/psql[^\n]*/g, '')), `${one.records.map(createdClone).filter(Boolean).length} clones, wanted ${wanted}`);
  check('and still builds the template', one.records.filter((c) => dbOf(c) !== 'postgres').length > runner.migrationFiles().length);
  const none = boundedSuite({ pattern: 'no-such-file-anywhere' });
  check('a pattern that matches nothing fails the run, rather than passing on nothing', none.status === 1 && /no-such-file-anywhere/.test(none.out) && none.records.filter(isFile).length === 0, `status ${none.status}`);
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

  /* A planted end-to-end directory: the runner reads it in place of supabase/tests/e2e, so the planted names are the run's. */
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-e2e-'));
  const plant = (name, text) => fs.writeFileSync(path.join(planted, name), text);
  const unplant = () => { for (const f of fs.readdirSync(planted)) fs.rmSync(path.join(planted, f)); };
  const sawIn = path.join(bounded, 'saw');
  const writesEnv = (file) => `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(file)}, JSON.stringify({ url: process.env.KAYFABB_SCRATCH_URL, snapshots: process.env.KAYFABB_SNAPSHOTS }));\n`;
  const tmplOf = (r) => r.records.map((c) => /^create database (kayfabb_scratch_\d+_\d+);/.exec(bodyOf(c))?.[1]).find(Boolean) ?? '';

  /* Poison: a file that replays the migrations itself. */
  plant('0901-replays-the-migrations.ts', "import fs from 'node:fs';\nfor (const m of fs.readdirSync('supabase/migrations')) console.log(m);\n");
  plant('0902-asks-the-list.ts', "import { migrationFiles } from '../../../tools/test-sql.mjs';\nmigrationFiles();\n");
  plant('0903-only-says-so.ts', writesEnv(sawIn + '3') + '// supabase/migrations and migrationFiles, in a comment\n');
  const poison = boundedSuite({ pattern: 'e2e/090', e2eDir: planted });
  check('the runner refuses an end-to-end file that replays the migrations itself, and the run fails', poison.status === 1 && /FAIL  e2e\/0901-replays-the-migrations\.ts[^\n]*\s+reads supabase\/migrations/.test(poison.out), poison.out.split('\n').filter((l) => /FAIL|e2e/.test(l)).join(' | ').slice(0, 400));
  check('and one that asks migrationFiles', /FAIL  e2e\/0902-asks-the-list\.ts[^\n]*\s+reads[^\n]*migrationFiles/.test(poison.out), poison.out.slice(0, 300));
  check('the refused files get no clone, and one that only mentions them in a comment still runs and passes', /PASS  e2e\/0903-only-says-so\.ts/.test(poison.out) && poison.records.map(createdClone).filter(Boolean).length === 1, `${poison.records.map(createdClone).filter(Boolean).length} clones`);
  unplant();

  /* What the file is told. */
  plant('0904-asks-where.ts', writesEnv(sawIn + '4'));
  plant('0905-across-0003.ts', writesEnv(sawIn + '5'));
  const told = boundedSuite({ pattern: '0904', e2eDir: planted });
  const saw = fs.existsSync(sawIn + '4') ? JSON.parse(fs.readFileSync(sawIn + '4', 'utf8')) : {};
  const cloneOf = told.records.map(createdClone).filter(Boolean)[0]?.[1];
  check('an end-to-end file is told its clone in KAYFABB_SCRATCH_URL', Boolean(cloneOf) && saw.url === `postgres://postgres:pg@localhost:5432/${cloneOf}`, JSON.stringify(saw));
  const snaps = saw.snapshots ? JSON.parse(saw.snapshots) : {};
  check('and the snapshots in KAYFABB_SNAPSHOTS: `migrated`, and a point for each file that names one', typeof snaps.migrated === 'string' && snaps.migrated.startsWith(tmplOf(told)), saw.snapshots);
  const pointed = boundedSuite({ pattern: '0905', e2eDir: planted });
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
  const noE2e = boundedSuite({ pattern: first });
  check('a pattern that selects no end-to-end file makes no snapshot', noE2e.records.length > 0 && !noE2e.records.some((c) => dbOf(c) === 'postgres' && /^create database \w+_(s\d+|migrated) /.test(bodyOf(c))), '');

  /* Whatever a file leaves named after its clone goes with the clone. */
  const dropOf = pointed.records.filter((c) => dbOf(c) === 'postgres' && /pg_database/.test(bodyOf(c)) && /\\gexec/.test(bodyOf(c)));
  check('when a clone is dropped, so is every database named for it (<clone>_%)', dropOf.length >= 1 && dropOf.every((c) => /like 'kayfabb_scratch_\d+_\d+_\d+\\_%'/.test(bodyOf(c))), dropOf[0] ? bodyOf(dropOf[0]) : 'no such call');

  /* A point no migration has fails the run before anything runs. */
  unplant();
  plant('0906-nowhere-across-9999.ts', '');
  const nowhere = boundedSuite({ pattern: '0906', e2eDir: planted });
  check('a point no migration has fails the run before any psql is called', nowhere.status === 1 && /9999/.test(nowhere.out) && nowhere.records.length === 0, `status ${nowhere.status}, ${nowhere.records.length} calls: ${nowhere.out.slice(0, 200)}`);
  unplant();
  plant('0907-a-across-0003.ts', ''); plant('0908-b-across-0003.ts', '');
  const dupe = boundedSuite({ pattern: 'e2e/090', e2eDir: planted });
  check('two files naming one point fail the run before any psql is called', dupe.status === 1 && /0907-a-across-0003\.ts/.test(dupe.out) && /0908-b-across-0003\.ts/.test(dupe.out) && dupe.records.length === 0, `status ${dupe.status}, ${dupe.records.length} calls`);
  unplant();
  plant('0909-x-across-.ts', '');
  const unpointed = boundedSuite({ pattern: '0909', e2eDir: planted });
  check('and so does a name with -across- and no point', unpointed.status === 1 && /0909-x-across-\.ts/.test(unpointed.out) && unpointed.records.length === 0, `status ${unpointed.status}`);
  fs.rmSync(planted, { recursive: true, force: true });

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
