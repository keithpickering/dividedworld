/**
 * What tools/export-instance.mjs and tools/import-instance.mjs share: their arguments, the
 * tables an instance is made of, and psql, which both run, so neither needs a driver.
 *
 * An instance is every table in the public schema, private ones included, and the logins beside
 * them in Supabase Auth (auth.users, and auth.identities where Auth keeps one), so that an
 * imported instance's players sign in as before. What is not exported is said where it is left
 * out: the schedule's service key in Vault, which is a secret and is seeded again, and Auth's
 * sessions, which end, so players sign in once more.
 */
import { execFileSync } from 'node:child_process';

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

/** The query parameters a URL may carry: none of them can send psql to another database. */
const HARMLESS = new Set(['sslmode', 'sslrootcert', 'connect_timeout', 'application_name']);

/**
 * Which database a URL names, as host:port/database, with no user or password in it. A URL that
 * names no database, or carries a parameter that could connect somewhere else than it says (a
 * host, a database, a service), is refused, and so is a PG* variable that would fill a part the
 * URL leaves out.
 */
export function named(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('the database is a postgres:// URL');
  if (!u.hostname) throw new Error('the URL names no host');
  if (u.pathname.length < 2) throw new Error('the URL names no database');
  for (const key of u.searchParams.keys()) if (!HARMLESS.has(key)) throw new Error(`the URL's ${key} parameter could connect somewhere it does not say`);
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS']) if (process.env[key]) throw new Error(`${key} is set, and could connect somewhere the URL does not say`);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

/** The database as the server itself names it, once connected. */
export function answered(url) {
  return psql(url, `select format('%s on port %s', current_database(), coalesce(inet_server_port()::text, 'the local socket'))`);
}

/** Runs a script through psql and returns its unaligned output. */
export function psql(url, script) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
}

/**
 * The instance's tables, each with its columns (stored generated columns aside, which are
 * computed again) and the order its rows are written in.
 */
export function tables(url) {
  const rows = psql(url, `
    select format('%I.%I', n.nspname, c.relname),
      (select string_agg(format('%s %s', quote_ident(a.attname), format_type(a.atttypid, a.atttypmod)), ',' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''),
      coalesce((select string_agg(quote_ident(a.attname), ', ' order by array_position(i.indkey, a.attnum))
         from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = c.oid and i.indisprimary), 'ctid')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
    order by 1`);
  return rows.split('\n').filter(Boolean).map((line) => {
    const [name, columns, order] = line.split('|');
    return { name, columns: columns.split(',').map((c) => { const at = c.indexOf(' '); return [c.slice(0, at), c.slice(at + 1)]; }), order };
  });
}

export const NOT_EXPORTED = [
  'the two Vault secrets the scheduled jobs call the Edge Functions with, kayfabb_functions_url and kayfabb_service_key: secrets, which the new project sets with vault.create_secret() as a deploy does (supabase/migrations/0004_schedule.sql); until then the settlement job runs and calls nothing',
  'Supabase Auth\'s sessions and refresh tokens: they end, and each player signs in once more',
];
