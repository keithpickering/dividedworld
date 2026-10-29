/**
 * What tools/export-instance.mjs and tools/import-instance.mjs share: their arguments, the
 * tables an instance is made of, and psql, which both run, so neither needs a driver.
 *
 * An instance is every table in the public schema, private ones included, and the logins beside
 * them in Supabase Auth (auth.users, and auth.identities where Auth keeps one), so that an
 * imported instance's players sign in as before. What is not exported is said where it is left
 * out (NOT_EXPORTED): the two Vault secrets, Auth's sessions, which end, and the tables the
 * migrations fill themselves (MIGRATION_DATA), whose release the manifest names instead.
 *
 * A connection's password never reaches psql's command line, where any user's `ps` reads it, nor
 * the terminal: the URL is taken apart here and handed to psql as libpq's variables, and every
 * message a tool prints passes through scrub() first.
 */
import { execFileSync, spawn } from 'node:child_process';

export const FORMAT = 'kayfabb-export/1';

/** --from and --to, both required. */
export function args(argv, usage) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--from' && flag !== '--to') throw new Error(usage);
    out[flag.slice(2)] = argv[i + 1];
  }
  if (!out.from || !out.to) throw new Error(usage);
  return out;
}

/** The query parameters a URL may carry, as the libpq variable each sets: none can send psql elsewhere. */
const HARMLESS = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME' };

/** Every secret a tool has been handed, so that scrub() can take each out of what it prints. */
const secrets = new Set();

/**
 * A message with every password a tool was given, raw or encoded, replaced. One shorter than four
 * characters is left, since it would be found inside psql's own words (PL/pgSQL) and is no secret
 * worth the garble; nothing prints a password in any case, since none reaches psql's command line.
 */
export function scrub(text) {
  let out = String(text);
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('<password>');
  return out;
}

/**
 * A URL taken apart: the database it names, as host:port/database with no user or password, and
 * the libpq variables that connect to it. A URL that names no host or database, carries a
 * parameter that could connect somewhere else than it says, or meets a PG* variable that could,
 * is refused.
 */
export function connection(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('the database is a postgres:// URL'); }
  if (u.password) secrets.add(u.password);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('the database is a postgres:// URL');
  if (!u.hostname) throw new Error('the URL names no host');
  if (u.pathname.length < 2) throw new Error('the URL names no database');
  const env = {};
  for (const [key, value] of u.searchParams) {
    if (!(key in HARMLESS)) throw new Error(`the URL's ${key} parameter could connect somewhere it does not say`);
    env[HARMLESS[key]] = value;
  }
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS']) if (process.env[key]) throw new Error(`${key} is set, and could connect somewhere the URL does not say`);
  const decode = (part, what) => {
    try { return decodeURIComponent(part); } catch { throw new Error(`the URL's ${what} is not percent-encoded`); }
  };
  const password = decode(u.password, 'password');
  secrets.add(password);
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
  return {
    named: `${u.hostname}:${u.port || '5432'}${u.pathname}`,
    env: { PGHOST: host, PGPORT: u.port || '5432', PGDATABASE: decode(u.pathname.slice(1), 'database'), PGUSER: decode(u.username, 'user') || 'postgres', PGPASSWORD: password, ...env },
  };
}

const psqlEnv = (c) => {
  const env = { ...process.env, ...c.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG') && !(key in c.env)) delete env[key];
  return env;
};
const PSQL = ['-v', 'ON_ERROR_STOP=1', '-qtAX', '-f', '-'];

/** Runs a script through psql and returns its unaligned output; an error carries psql's own words, scrubbed. */
export function psql(c, script) {
  try {
    return execFileSync('psql', PSQL, { input: script, env: psqlEnv(c), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
  } catch (e) {
    throw new Error(scrub(String(e.stderr || '').trim() || `psql exited ${e.status ?? 'without a status'}`));
  }
}

/** psql reading a script streamed to it, for a load too large to hold. */
export function psqlStream(c) {
  return spawn('psql', PSQL, { env: psqlEnv(c), stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The database as the server itself names it, once connected. */
export function answered(c) {
  return psql(c, `select format('%s on port %s', current_database(), coalesce(inet_server_port()::text, 'the local socket'))`);
}

/**
 * The instance's tables, each with its columns (stored generated columns aside, which are
 * computed again) and the order its rows are written in, read as JSON so that no name or type
 * (numeric(10,2)) can be cut at a delimiter.
 */
export function tables(c) {
  return JSON.parse(psql(c, `
    select coalesce(json_agg(json_build_object('name', t.name, 'columns', t.columns, 'order', t.ord) order by t.name), '[]')
    from (
      select format('%I.%I', n.nspname, c.relname) as name,
        (select json_agg(json_build_array(quote_ident(a.attname), format_type(a.atttypid, a.atttypmod)) order by a.attnum)
           from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '') as columns,
        coalesce((select string_agg(quote_ident(a.attname), ', ' order by array_position(i.indkey, a.attnum))
           from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
           where i.indrelid = c.oid and i.indisprimary), 'ctid') as ord
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
        and format('%I.%I', n.nspname, c.relname) <> all (array[${MIGRATION_DATA.map((t) => `'${t}'`).join(', ')}]::text[])
    ) t`));
}

/**
 * The tables a migration fills, the same in every instance at one set of migrations: the name
 * folds (supabase/migrations/0010_name_folds.sql). Not an instance's to carry; the manifest
 * names their release instead (nameFolds), and an import into a database holding another is
 * refused, since every character's name keys are that release's.
 */
export const MIGRATION_DATA = ['public.name_maps', 'public.name_classes', 'public.unicode_data'];

/** The release of each kind of name fold the database holds, and the hash of the file it came from. */
export const nameFolds = (c) => JSON.parse(psql(c, `select coalesce(json_object_agg(what, json_build_object('version', version, 'sha256', source_sha256) order by what), '{}') from public.unicode_data`));

/** The one file name a table's rows are kept in. */
export const fileOf = (name) => `${name}.jsonl`;

/** Prints a tool's failure, scrubbed, and exits. */
export function fail(e) {
  console.error(scrub(e?.message ?? e));
  process.exit(1);
}

export const NOT_EXPORTED = [
  'the name folds (public.name_maps, public.name_classes, public.unicode_data): the migrations load them, and the manifest names their release and source files (nameFolds), which an import requires the new database to hold; every character\'s name keys are computed again there and must be the ones carried',
  'the two Vault secrets the scheduled jobs call the Edge Functions with, kayfabb_functions_url and kayfabb_service_key: secrets, which are set by hand on the new project, with select vault.create_secret(<the functions URL>, \'kayfabb_functions_url\') and select vault.create_secret(<the service key>, \'kayfabb_service_key\') (supabase/migrations/0004_schedule.sql reads them); until then the settlement job runs and calls nothing',
  'Supabase Auth\'s sessions and refresh tokens: they end, and each player signs in once more',
];
