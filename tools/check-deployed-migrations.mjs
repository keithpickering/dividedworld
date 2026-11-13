/**
 * Guard: the database a release is about to change (or has just changed) holds the migrations the
 * repository says it does, no more and no fewer.
 *
 *   node tools/check-deployed-migrations.mjs --db <postgres URL> --before
 *   node tools/check-deployed-migrations.mjs --db <postgres URL> --after
 *
 * The SQL suite replays supabase/migrations/ into a throwaway database, which proves what the
 * migrations say and nothing about whether any of them was applied to the real one: a test that
 * builds its own subject cannot tell you the subject is missing. So this reads the one record that
 * can, supabase_migrations.schema_migrations in the deployed database, and compares its versions
 * with the repository's.
 *
 *   --before, run ahead of `supabase db push`: a version the database holds and the repository
 *     does not is SQL applied by hand, or a migration renamed after it was applied, and the push
 *     would go on top of a database the repository cannot rebuild. A version the repository has and
 *     the database lacks is simply what the push is about to apply.
 *   --after, run behind it: the two lists must be equal.
 *
 * It reads a live database, so it runs only in the release and is not a step of tools/build.mjs;
 * tools/test-deployed-migrations.mjs, which is, drives it red without connecting anywhere. The
 * database is named by an explicit --db and never by a default, and a database on this machine is
 * refused in every spelling, since the replayed throwaway is exactly where this would report
 * perfect agreement over the question it exists to ask. A URL it cannot read a host from is
 * refused too. It prints the host it read, never the URL: the password is handed to psql in its
 * environment (tools/instance-files.mjs), and every message passes through scrub().
 *
 * A transport failure is tried again, three attempts with a pause that doubles between them: no
 * answer from the server is a fact about the network. A server that answered and refused (a login,
 * an unknown tenant, role or database, pg_hba, SSL required) or a query error (the table missing)
 * is a fact about the request, and is thrown at once; so is anything unrecognized. Only the
 * server's own "come back soon" (starting up, too many clients) is retried. Each attempt gives up
 * connecting after 10 seconds, unless the URL says connect_timeout.
 * Exit status: 0 no problems, 1 problems (each names its versions), 2 refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrationVersion } from './check-migration-versions.mjs';
import { connection, psql, scrub } from './instance-files.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The versions of a folder's `.sql` files, sorted; a version is not assumed to follow the last. */
export function localVersions(dir) {
  const versions = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const v = migrationVersion(name);
    if (v === null) throw new Error(`${name} is not a migration's name; tools/check-migration-versions.mjs says what shape one has`);
    versions.push(v);
  }
  return versions.sort();
}

/**
 * What is wrong between the repository's versions and the database's, each naming its versions.
 * `before` complains of what only the database holds; `after` of every difference.
 */
export function problems(local, remote, mode) {
  if (mode !== 'before' && mode !== 'after') throw new Error(`mode is before or after, not ${mode}`);
  const here = new Set(local);
  const there = new Set(remote);
  const out = [];
  for (const v of [...there].filter((x) => !here.has(x)).sort()) {
    out.push(`the database holds migration ${v}, which the repository does not have (SQL applied by hand, or a migration renamed after it was applied)`);
  }
  if (mode === 'after') {
    for (const v of [...here].filter((x) => !there.has(x)).sort()) {
      out.push(`the repository has migration ${v}, which the database does not hold after the push`);
    }
  }
  return out;
}

/**
 * A failure of the transport: no answer from a server, or an answer that says to come back soon.
 * psql prefixes every connect error with `connection to server at ... failed`, so that prefix says
 * nothing; what follows it does. A server that answered with FATAL has refused the request (an
 * unknown tenant, role or database, no pg_hba.conf entry, SSL required, a wrong password) and
 * trying again cannot change that, except the FATALs that name a moment (starting up, shutting
 * down, too many clients, connection slots reserved). No answer at all (name resolution, refused,
 * timed out, unreachable, the line dropped) is the network. Anything else is not retried.
 */
export function isConnectionFailure(error) {
  const text = String(error?.message ?? error);
  if (/the database system is (starting up|shutting down|in recovery mode)|too many (clients|connections)|remaining connection slots are reserved/i.test(text)) return true;
  if (/\b(FATAL|ERROR):/.test(text)) return false;
  return /could not translate host name|name or service not known|temporary failure in name resolution|connection refused|timeout expired|timed out|server closed the connection unexpectedly|network is unreachable|no route to host|connection reset|could not receive data|ssl syscall|unexpected eof/i.test(text);
}

const CONNECT_TIMEOUT_SECONDS = '10';

/**
 * The connection as the check hands it to psql: a connect timeout of its own, unless the URL carried
 * one (instance-files deletes the PG* variables a job sets, so none inherited would apply), and
 * LC_ALL=C so that the messages isConnectionFailure reads are psql's English whatever the runner's locale.
 * Pure; the connection it is given is not changed.
 */
export function connectOptions(c) {
  return { ...c, env: { PGCONNECT_TIMEOUT: CONNECT_TIMEOUT_SECONDS, ...c.env, LC_ALL: 'C' } };
}

/**
 * Runs `fn` up to `attempts` times, repeating only after a connection failure, with a pause that
 * doubles between attempts. Any other error is thrown at once, and so is the last connection
 * failure. `sleep` is injected so the test waits for nothing.
 */
export async function retrying(fn, { attempts = 3, baseMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= attempts || !isConnectionFailure(e)) throw e;
      await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
}

/** A host that is this machine, in any spelling libpq would resolve to it. */
export function isThisMachine(hostname) {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '0.0.0.0' || h === '::' || h === '::1'
    || /^(0:){7}[01]$/.test(h) || /^::ffff:/.test(h) || /^(0x[0-9a-f]+|\d+)$/i.test(h);
}

/** What the command was asked for, or the plain reason it refuses (`refusal`); nothing here connects. */
export function parseArgs(argv) {
  let db;
  const modes = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') db = argv[++i];
    else if (argv[i] === '--before') modes.push('before');
    else if (argv[i] === '--after') modes.push('after');
    else return { refusal: `unknown argument ${argv[i]}; the arguments are --db <postgres URL> and --before or --after` };
  }
  if (db === '') return { refusal: '--db is empty: the release\'s SUPABASE_DB_URL secret is not set in the production environment, or, in a hand run, the variable passed to --db is unset' };
  if (!db) return { refusal: 'no --db: name the database to read, explicitly; there is no default' };
  if (modes.length !== 1) return { refusal: 'give exactly one of --before and --after' };
  let u;
  try { u = new URL(db); } catch { return { refusal: 'the --db value is not a postgres:// URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { refusal: 'the --db value is not a postgres:// URL' };
  if (!u.hostname) return { refusal: 'the --db URL names no host, so it cannot be told which database would be read' };
  if (isThisMachine(u.hostname)) return { refusal: 'the --db host is this machine; this check reads the deployed database, and the local one is the throwaway the migrations are replayed into' };
  return { db, mode: modes[0], host: u.hostname };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.refusal) {
    console.error(`  deployed-migrations: refused: ${a.refusal}`);
    process.exit(2);
  }
  let c;
  try { c = connectOptions(connection(a.db)); } catch (e) {
    console.error(`  deployed-migrations: refused: ${scrub(e.message)}`);
    process.exit(2);
  }
  console.log(`reading supabase_migrations from ${a.host}`);
  const local = localVersions(path.join(repoRoot, 'supabase', 'migrations'));
  const out = await retrying(() => psql(c, 'select version from supabase_migrations.schema_migrations order by 1'));
  const remote = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const found = problems(local, remote, a.mode);
  if (found.length) {
    console.error(`  deployed-migrations: ${found.length} problem(s) ${a.mode} the push:`);
    for (const f of found) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`  deployed-migrations: ${remote.length} migration(s) in the database, ${local.length} in the repository: nothing wrong ${a.mode} the push`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`  deployed-migrations: ${scrub(e?.message ?? e)}`);
    process.exit(1);
  });
}
