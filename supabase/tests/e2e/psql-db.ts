/**
 * A Db (supabase/functions/_shared/rpc.ts) that calls the SQL functions through psql, as the
 * service role or as a player, on the scratch database tools/test-sql.mjs made: so an end-to-end test runs
 * the Edge Functions' own core against the real migrations with no PostgREST in between. The
 * arguments are passed as one JSON value and each is cast to the type pg_proc says its
 * parameter takes, by name, as PostgREST does.
 */
import { execFileSync } from 'node:child_process';
import { DatabaseError, type Db } from '../../functions/_shared/rpc.ts';
import { instanceSeed } from '../../functions/_shared/seed.ts';
import { conduct } from '../../../instances/divided-world/ui/conduct.ts';
import type { Instance } from '../../../engine/rules/types.ts';

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

/**
 * The instance's seed, for this scratch database. The database is shared with the SQL suite's own test
 * instance (supabase/tests/setup/fixtures.sql), whose race files commit reactions on its kinds, and
 * seed_instance takes a payload's reactions as the instance's whole set and refuses to drop a kind that
 * reactions use (0091). So the kinds the database already holds are seeded beside the instance's own, as
 * they stood before. Where a held kind shares a key or an emoji with one of the instance's, the instance's
 * wins and the held one is left out.
 */
export function scratchSeed(instance: Instance): ReturnType<typeof instanceSeed> {
  const seed = instanceSeed(instance, conduct);
  const held = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('key', key, 'emoji', emoji, 'quadrant', quadrant) order by key), '[]') from reaction_kinds`)) as typeof seed.reactions;
  const keys = new Set(seed.reactions.map((r) => r.key));
  const emoji = new Set(seed.reactions.map((r) => r.emoji));
  return { ...seed, reactions: [...seed.reactions, ...held.filter((r) => !keys.has(r.key) && !emoji.has(r.emoji))] };
}

/** As the service role, or, given an account, as that player, as their session would be. */
export function psqlDb(as?: string): Db {
  const role = as ? 'authenticated' : 'service_role';
  const claims = JSON.stringify(as ? { sub: as, role } : { role });
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const params = sql(`select string_agg(n || ':' || format_type(t, null), ',' order by i)
        from pg_proc p, unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, i)
        where p.proname = :'fn' and p.pronamespace = 'public'::regnamespace`, { fn });
      const typeOf = new Map(params.split(',').filter(Boolean).map((x) => x.split(':') as [string, string]));
      const named = Object.keys(args).map((k) => {
        const type = typeOf.get(k);
        if (!type) throw new Error(`${fn} has no parameter ${k}`);
        if (type === 'jsonb' || type === 'json') return `${k} => (:'args'::jsonb -> '${k}')::${type}`;
        // A JSON array is an array parameter as PostgREST sends it (the patrol run's boards); its text is no array literal, so its elements are cast one by one.
        // A JSON null is SQL NULL, as PostgREST passes it.
        if (type.endsWith('[]')) return `${k} => case when jsonb_typeof(:'args'::jsonb -> '${k}') = 'array' then array(select jsonb_array_elements_text(:'args'::jsonb -> '${k}'))::${type} end`;
        return `${k} => (:'args'::jsonb ->> '${k}')::${type}`;
      });
      try {
        const out = sql(`set role ${role};
          select set_config('request.jwt.claims', :'claims', false) \\g /dev/null
          select coalesce(to_jsonb(public.${fn}(${named.join(', ')})), 'null'::jsonb)::text;`, { args: JSON.stringify(args), claims });
        return JSON.parse(out) as T;
      } catch (e) {
        // psql's own report of the error: its message, and the hint it was raised with.
        const stderr = String((e as { stderr?: string }).stderr ?? e);
        const message = /ERROR:\s+(.*)/.exec(stderr)?.[1]?.trim() ?? stderr.trim();
        const hint = /HINT:\s+(.*)/.exec(stderr)?.[1]?.trim() ?? '';
        throw new DatabaseError(`${fn}: ${message}`, '', 400, message, hint);
      }
    },
  };
}
