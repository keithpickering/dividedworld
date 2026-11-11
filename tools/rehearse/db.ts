/**
 * The rehearsal's database client: a `Db` that does what PostgREST does for `POST /rpc/<fn>`, over one held
 * connection to Postgres. It reads a function's argument names and types and its return shape from pg_proc
 * once, casts each named argument from the JSON body, returns a set as an array and anything else as its JSON
 * value, runs the call in a transaction as `service_role` or as `authenticated` with the player's claims (as
 * tests.become does), and turns an error into the same DatabaseError with its SQLSTATE, message and hint.
 * One held connection, because a rehearsed week is about 10,080 ticks, and libfaketime reads its clock file
 * on every time call. No argument value is ever put into the SQL text: the whole body travels as one jsonb
 * parameter.
 */
import pg from 'pg';
import { DatabaseError, type Db } from '../../supabase/functions/_shared/rpc.ts';

export type Caller = 'service' | { readonly player: string };

export interface Connection {
  db(as: Caller): Db;
  /** Plain SQL as the superuser, for setup and the scheduler. */
  sql(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  end(): Promise<void>;
}

interface Arg { name: string; type: string; hasDefault: boolean }
interface Signature { args: Arg[]; returnsSet: boolean; returnType: string }

/** PostgREST's table of SQLSTATEs to HTTP statuses; 42501 is 403 here, since a caller always has a role. */
export function statusFor(code: string): number {
  if (code === 'PGRST202') return 404;
  if (code === '42501') return 403;
  if (code === '42883' || code === '42P01') return 404;
  if (code === '42P17') return 500;
  if (code === 'P0001') return 400;
  if (code === '23503' || code === '23505') return 409;
  if (code === '25006') return 405;
  if (code === '40001' || code === '40P01') return 500;
  if (code.startsWith('08') || code.startsWith('53')) return 503;
  if (['09', '25', '2D', '38', '39', '3B'].some((p) => code.startsWith(p))) return 500;
  if (['0L', '0P', '28'].some((p) => code.startsWith(p))) return 403;
  if (['54', '55', '57', '58', 'F', 'H', 'XX'].some((p) => code.startsWith(p))) return 500;
  if (code.startsWith('P0')) return 500;
  return 400;
}

const SIGNATURES = `
  select p.proargnames as names, p.proretset as retset, p.pronargdefaults as ndefaults,
         format_type(p.prorettype, null) as rettype, p.proargmodes as modes,
         coalesce((select array_agg(format_type(t.oid, null) order by t.ord) from unnest(p.proargtypes::oid[]) with ordinality t(oid, ord)), '{}') as types
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = $1`;

function toDatabaseError(fn: string, e: unknown): DatabaseError {
  const x = e as { code?: string; message?: string; hint?: string; detail?: string };
  const code = x.code ?? '';
  const reason = x.message ?? String(e);
  return new DatabaseError(`${fn}: ${reason}${x.detail ? ` (${x.detail})` : ''}`, code, statusFor(code), reason, x.hint ?? '');
}

const notFound = (fn: string, why: string) => new DatabaseError(`${fn}: ${why}`, 'PGRST202', 404, why, '');

function wrap(client: pg.Client): Connection {
  const cache = new Map<string, Signature[]>();

  async function signatures(fn: string): Promise<Signature[]> {
    const known = cache.get(fn);
    if (known) return known;
    const { rows } = await client.query(SIGNATURES, [fn]);
    const found: Signature[] = rows.map((r) => {
      const types: string[] = r.types;
      // Names cover every argument, OUT ones included, when modes are given; keep the inputs only.
      let names: string[] = r.names ?? types.map((_, i) => `$${i + 1}`);
      if (r.modes) names = names.filter((_: string, i: number) => ['i', 'b', 'v'].includes(r.modes[i]));
      const first = types.length - r.ndefaults;
      return { args: types.map((type, i) => ({ name: names[i] ?? `$${i + 1}`, type, hasDefault: i >= first })), returnsSet: r.retset, returnType: r.rettype };
    });
    if (found.length > 0) cache.set(fn, found);
    return found;
  }

  function choose(fn: string, all: Signature[], given: string[]): Signature {
    if (all.length === 0) throw notFound(fn, `Could not find the function public.${fn} in the schema cache`);
    const ok = all.find((s) => given.every((g) => s.args.some((a) => a.name === g)) && s.args.every((a) => a.hasDefault || given.includes(a.name)));
    if (!ok) throw notFound(fn, `Could not find the function public.${fn}(${given.join(', ')}) in the schema cache`);
    return ok;
  }

  function sqlFor(fn: string, sig: Signature, given: string[]): string {
    const call = sig.args.filter((a) => given.includes(a.name)).map((a) => {
      const key = pg.escapeLiteral(a.name);
      let value: string;
      if (a.type === 'jsonb' || a.type === 'json') value = `($1::jsonb -> ${key})::${a.type}`;
      else if (a.type.endsWith('[]')) value = `(case when jsonb_typeof($1::jsonb -> ${key}) = 'array' then array(select jsonb_array_elements_text($1::jsonb -> ${key}))::${a.type} end)`;
      else value = `($1::jsonb ->> ${key})::${a.type}`;
      return `${pg.escapeIdentifier(a.name)} => ${value}`;
    }).join(', ');
    const target = `public.${pg.escapeIdentifier(fn)}(${call})`;
    if (sig.returnsSet) return `select coalesce(json_agg(r), '[]'::json) as result from ${target} r`;
    if (sig.returnType === 'void') return `select (${target}) is null as result`;
    return `select to_json(${target}) as result`;
  }

  return {
    sql: async (text, params) => (await client.query(text, params)).rows,
    end: () => client.end(),
    db(as) {
      const claims = as === 'service' ? { role: 'service_role' } : { sub: as.player, role: 'authenticated' };
      const role = as === 'service' ? 'service_role' : 'authenticated';
      return {
        async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
          const given = Object.keys(args);
          const sig = choose(fn, await signatures(fn), given);
          const text = sqlFor(fn, sig, given);
          try {
            await client.query('begin');
            await client.query(`set local role ${role}`);
            await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
            const { rows } = await client.query(text, given.length > 0 ? [JSON.stringify(args)] : []);
            await client.query('commit');
            return (sig.returnType === 'void' && !sig.returnsSet ? null : rows[0]?.result ?? null) as T;
          } catch (e) {
            await client.query('rollback').catch(() => {});
            throw toDatabaseError(fn, e);
          }
        },
      };
    },
  };
}

/** One connection to the rehearsal's own cluster, over its Unix socket, as the superuser. */
export async function connect(socketDir: string, port: number, database: string): Promise<Connection> {
  const client = new pg.Client({ host: socketDir, port, database, user: 'postgres' });
  await client.connect();
  return wrap(client);
}

/** The same over a connection string, for a scratch database on a server that has one (the tests'). */
export async function connectUrl(connectionString: string): Promise<Connection> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return wrap(client);
}
