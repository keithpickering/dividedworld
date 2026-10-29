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

/** Which database a URL names, as host:port/database, with no user or password in it. */
export function named(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('the database is a postgres:// URL');
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
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
  'the schedule\'s service key in Vault: a secret, seeded again with the instance (supabase/functions/seed/)',
  'Supabase Auth\'s sessions and refresh tokens: they end, and each player signs in once more',
];
