/**
 * A Db (supabase/functions/_shared/rpc.ts) that calls the SQL functions through psql, as the
 * service role, on the scratch database tools/test-sql.mjs made: so an end-to-end test runs
 * the Edge Functions' own core against the real migrations with no PostgREST in between. The
 * arguments are passed as one JSON value and each is cast to the type pg_proc says its
 * parameter takes, by name, as PostgREST does.
 */
import { execFileSync } from 'node:child_process';
import { DatabaseError, type Db } from '../../functions/_shared/rpc.ts';

export function scratchUrl(): string {
  const url = process.env.KAYFABB_SCRATCH_URL;
  if (!url) throw new Error('KAYFABB_SCRATCH_URL is not set; end-to-end tests run inside tools/test-sql.mjs');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`refusing a database on ${host}`);
  return url;
}

/** Runs SQL as the harness's superuser and returns psql's unaligned output. */
export function sql(text: string, vars: Record<string, string> = {}): string {
  const args = ['-v', 'ON_ERROR_STOP=1', '-qtAX', scratchUrl()];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  return execFileSync('psql', args, { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function psqlDb(): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const params = sql(`select string_agg(n || ':' || format_type(t, null), ',' order by i)
        from pg_proc p, unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, i)
        where p.proname = :'fn' and p.pronamespace = 'public'::regnamespace`, { fn });
      const typeOf = new Map(params.split(',').filter(Boolean).map((x) => x.split(':') as [string, string]));
      const named = Object.keys(args).map((k) => {
        const type = typeOf.get(k);
        if (!type) throw new Error(`${fn} has no parameter ${k}`);
        return type === 'jsonb' || type === 'json' ? `${k} => (:'args'::jsonb -> '${k}')::${type}` : `${k} => (:'args'::jsonb ->> '${k}')::${type}`;
      });
      try {
        const out = sql(`set role service_role;
          select set_config('request.jwt.claims', '{"role": "service_role"}', false) \\g /dev/null
          select coalesce(to_jsonb(public.${fn}(${named.join(', ')})), 'null'::jsonb)::text;`, { args: JSON.stringify(args) });
        return JSON.parse(out) as T;
      } catch (e) {
        const stderr = String((e as { stderr?: string }).stderr ?? e);
        throw new DatabaseError(`${fn}: ${stderr.trim()}`, '', 400);
      }
    },
  };
}
