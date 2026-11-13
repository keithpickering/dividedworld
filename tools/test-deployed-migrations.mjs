/**
 * Tests for the guard in tools/check-deployed-migrations.mjs.
 *
 *   node tools/test-deployed-migrations.mjs
 *
 * The check reads supabase_migrations.schema_migrations from a live database, so it runs only in
 * the release, and this test is the part of it the build runs. Nothing here connects anywhere:
 * `problems` and the retry are driven with plain values and an injected runner and sleep, and the
 * command is run as a child process only on the refusals, which happen before any connection (the
 * localhost refusal means the command cannot even be pointed at the local Postgres, on purpose).
 *
 * The poisons, each its own case: a remote version the repository lacks (under both modes); a
 * local version not yet remote (fine before, a complaint after); equal lists; the command with no
 * --db, no mode, both modes, and a database on this machine in each spelling; the real folder; and
 * the retry, which repeats a transport failure and throws a query error or any refusal by a server
 * that answered at once, with one case per class of psql message; and the environment the check
 * hands psql (a connect timeout of its own, English messages), built without connecting.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkModule from './check-deployed-migrations.mjs';
import { connection } from './instance-files.mjs';

const { localVersions, problems, retrying } = checkModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-deployed-migrations.mjs');
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

/* ----------------------------------------------------------------------- problems ---- */

const local = ['0001', '0002', '0490'];
let p = problems(local, ['0001', '0002', '0490', '0003'], 'before');
check('1. a remote version not in local fails under before, naming it', p.length === 1 && p[0].includes('0003'), JSON.stringify(p));
p = problems(local, ['0001', '0002', '0490', '0003'], 'after');
check('2. a remote version not in local fails under after, naming it', p.length === 1 && p[0].includes('0003'), JSON.stringify(p));
p = problems(['0001', '0002', '0490', '0500'], ['0001', '0002', '0490'], 'before');
check('3a. a local version not yet remote is fine under before', p.length === 0, JSON.stringify(p));
p = problems(['0001', '0002', '0490', '0500'], ['0001', '0002', '0490'], 'after');
check('3b. a local version not yet remote is a complaint under after, naming it', p.length === 1 && p[0].includes('0500'), JSON.stringify(p));
check('4a. equal lists are [] under before', problems(local, [...local], 'before').length === 0);
check('4b. equal lists are [] under after', problems(local, [...local], 'after').length === 0);
p = problems(['0001', '0500'], ['0001', '0003'], 'after');
check('after names both directions at once', p.length === 2 && p.some((x) => x.includes('0003')) && p.some((x) => x.includes('0500')), JSON.stringify(p));

/* ----------------------------------------------------------------------- the command ---- */

function cli(...argv) {
  return spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', timeout: 10_000 });
}
const refuses = (name, argv, want) => {
  const c = cli(...argv);
  check(name, c.status === 2 && want.test(c.stderr) && !/secretpw/.test(c.stdout + c.stderr) && !/reading supabase_migrations/.test(c.stdout), `${c.status} ${c.stdout}${c.stderr}`);
};
refuses('5a. no --db exits 2', ['--before'], /--db/);
refuses('5a2. an empty --db exits 2 and says it is empty', ['--db', '', '--before'], /--db is empty/);
refuses('5b. no mode exits 2', ['--db', 'postgres://u:secretpw@db.example.com:5432/postgres'], /--before|--after/);
refuses('5c. both modes exit 2', ['--db', 'postgres://u:secretpw@db.example.com:5432/postgres', '--before', '--after'], /--before|--after/);
for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST', '0.0.0.0', '127.0.0.2']) {
  refuses(`5d. a database on ${host} exits 2 without connecting`, ['--db', `postgres://postgres:secretpw@${host}:54322/postgres`, '--before'], /this machine/);
}
refuses('5e. a URL that does not parse exits 2', ['--db', 'not a url', '--after'], /URL/);
refuses('5f. a URL with no host exits 2', ['--db', 'postgres:///postgres', '--after'], /host/);

/* ----------------------------------------------------------------------- the real folder ---- */

const dir = path.resolve(here, '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sql'));
const versions = localVersions(dir);
check('6. localVersions on the real directory returns one version per .sql file', files.length > 0 && versions.length === files.length && new Set(versions).size === versions.length, `${versions.length} versions, ${files.length} files`);
check('6b. localVersions does not assume contiguous numbers and is sorted', versions.every((v, i) => i === 0 || versions[i - 1] < v));

/* ----------------------------------------------------------------------- the retry ---- */

const connectionDown = () => new Error('psql: error: connection to server at "db.example.com" (1.2.3.4), port 5432 failed: Connection refused');
const queryError = () => new Error('ERROR:  relation "supabase_migrations.schema_migrations" does not exist');
const noSleep = async () => {};

async function retryCase(name, fn) {
  try { await fn(); } catch (e) { check(name, false, 'threw ' + e.message); }
}

await retryCase('7a. a connection failure is retried, then succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const got = await retrying(() => { calls++; if (calls < 3) throw connectionDown(); return 'ok'; }, { sleep: async (ms) => { sleeps.push(ms); } });
  check('7a. a connection failure is retried, then succeeds', got === 'ok' && calls === 3 && sleeps.length === 2 && sleeps[1] > sleeps[0], `${got} after ${calls} calls, sleeps ${sleeps}`);
});
await retryCase('7b. three connection failures fail, after three attempts', async () => {
  let calls = 0;
  let err = null;
  // The fake gives up by itself past the cap, so a retry with no cap fails here by name and never hangs the build.
  try { await retrying(() => { calls++; if (calls > 5) throw new Error('retried past the cap'); throw connectionDown(); }, { sleep: noSleep }); } catch (e) { err = e; }
  check('7b. three connection failures fail, after three attempts', err && calls === 3 && /Connection refused/.test(err.message), `${calls} calls, ${err?.message}`);
});
await retryCase('7c. a query error is thrown on the first attempt, never retried', async () => {
  let calls = 0;
  let err = null;
  try { await retrying(() => { calls++; throw queryError(); }, { sleep: noSleep }); } catch (e) { err = e; }
  check('7c. a query error is thrown on the first attempt, never retried', err && calls === 1 && /does not exist/.test(err.message), `${calls} calls, ${err?.message}`);
});
await retryCase('7d. a refused login is not a transport failure and is thrown at once', async () => {
  let calls = 0;
  let err = null;
  const refused = () => new Error('psql: error: connection to server at "db.example.com" (1.2.3.4), port 5432 failed: FATAL:  password authentication failed for user "postgres"');
  try { await retrying(() => { calls++; throw refused(); }, { sleep: noSleep }); } catch (e) { err = e; }
  check('7d. a refused login is not a transport failure and is thrown at once', err && calls === 1, `${calls} calls`);
});

const psqlFailed = (detail) => () => new Error(`psql: error: connection to server at "db.example.com" (1.2.3.4), port 5432 failed: ${detail}`);
const refusal = (name, make) => retryCase(name, async () => {
  let calls = 0;
  let err = null;
  try { await retrying(() => { calls++; if (calls > 5) throw new Error('retried past the cap'); throw make(); }, { sleep: noSleep }); } catch (e) { err = e; }
  check(name, err && calls === 1 && !/past the cap/.test(err.message), `${calls} calls, ${err?.message}`);
});
const transport = (name, make) => retryCase(name, async () => {
  let calls = 0;
  let err = null;
  try { await retrying(() => { calls++; if (calls > 5) throw new Error('retried past the cap'); throw make(); }, { sleep: noSleep }); } catch (e) { err = e; }
  check(name, err && calls === 3 && !/past the cap/.test(err.message), `${calls} calls, ${err?.message}`);
});

await refusal('7e. the pooler\'s "Tenant or user not found" is a refusal, thrown at once', psqlFailed('FATAL:  Tenant or user not found'));
await refusal('7f. "no pg_hba.conf entry" is a refusal, thrown at once', psqlFailed('FATAL:  no pg_hba.conf entry for host "5.6.7.8", user "postgres", database "postgres", SSL encryption'));
await refusal('7g. "SSL connection is required" is a refusal, thrown at once', psqlFailed('FATAL:  SSL connection is required. Please specify SSL options and retry.'));
await refusal('7h. an unknown role is a refusal, thrown at once', psqlFailed('FATAL:  role "nobody" does not exist'));
await refusal('7i. an unknown database is a refusal, thrown at once', psqlFailed('FATAL:  database "nope" does not exist'));
await transport('7j. "the database system is starting up" is transient and retried', psqlFailed('FATAL:  the database system is starting up'));
await transport('7k. "the database system is shutting down" is transient and retried', psqlFailed('FATAL:  the database system is shutting down'));
await transport('7l. "remaining connection slots are reserved" is transient and retried', psqlFailed('FATAL:  remaining connection slots are reserved for non-replication superuser connections'));
await transport('7m. "too many clients" is transient and retried', psqlFailed('FATAL:  sorry, too many clients already'));
await transport('7n. "timeout expired" is a transport failure and is retried', psqlFailed('timeout expired'));
await transport('7o. an unresolvable host name is a transport failure and is retried', () => new Error('psql: error: could not translate host name "db.example.com" to address: Temporary failure in name resolution'));
await transport('7p. "server closed the connection unexpectedly" is a transport failure and is retried', () => new Error('psql:<stdin>:1: error: server closed the connection unexpectedly\n\tThis probably means the server terminated abnormally\n\tbefore or while processing the request.'));
await transport('7q. "Network is unreachable" is a transport failure and is retried', psqlFailed('Network is unreachable\n\tIs the server running on that host and accepting TCP/IP connections?'));
await transport('7r. "could not receive data from server" is a transport failure and is retried', () => new Error('psql: error: SSL SYSCALL error: EOF detected\npsql: error: could not receive data from server: Connection reset by peer'));

/* ------------------------------------------------------- the environment psql gets ---- */

const connectOptions = checkModule.connectOptions;
const plain = connection('postgres://postgres:secretpw@db.invalid:5432/postgres');
let handed = null;
try { handed = connectOptions(plain); } catch (e) { check('8a. connectOptions exists', false, e.message); }
if (handed) {
  check('8a. a connection with no timeout of its own gets 10 seconds', handed.env.PGCONNECT_TIMEOUT === '10', JSON.stringify(handed.env.PGCONNECT_TIMEOUT));
  check('8b. the URL\'s own connect_timeout is kept', connectOptions(connection('postgres://postgres:secretpw@db.invalid:5432/postgres?connect_timeout=3')).env.PGCONNECT_TIMEOUT === '3');
  check('8c. psql runs untranslated: LC_ALL is C', handed.env.LC_ALL === 'C', String(handed.env.LC_ALL));
  check('8d. the rest of the connection is untouched and the input is not mutated', handed.env.PGHOST === 'db.invalid' && handed.named === plain.named && !('LC_ALL' in plain.env));
}

/* ----------------------------------------------------------------------- the tail ---- */

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
