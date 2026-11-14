/**
 * The screen functions' guard (the forum load plan, Task 3). A screen function is a function in `public` named `boot` or ending
 * `_page`: one call that returns everything a screen reads, so the page costs one request however many things it shows. What
 * makes that safe is what the function is, so this file reads each one's catalog row and its recorded dependencies and asserts:
 *   1. (retired by 0367) a SQL-standard body (`begin atomic`) used to be required so that Postgres recorded the dependencies. The client
 *      reads are now plpgsql with `plan_cache_mode = force_generic_plan`, which records none: what a migration removes from under a page
 *      is found by the call-coverage guard in tools/test-sql.mjs (docs/plans/2026-11-13-plan-once-design.md, section 5). Dependencies are
 *      still read below for whichever screen function has a SQL-standard body (a plpgsql one has none, and is checked by 2 and 4);
 *   2. it is `security invoker` and `stable`: it reads as the caller, under the caller's policies, and writes nothing;
 *   3. every relation it depends on, and every `public` function, is one a screen may read (ALLOWED_READS, ALLOWED_RPCS and SCREEN_HELPERS in
 *      tools/check-web-reads.mjs, the list the web app's own reads answer to), and every such function is itself stable or
 *      immutable, so a screen function never reaches a write (`here`, `mark_read`);
 *   4. `authenticated` can execute it and `anon` cannot.
 * `screenFaults` is that detection, and each poison below is a screen function broken in exactly one of those ways, created in a
 * transaction that is rolled back: the guard is trusted because it has been seen to answer a fault for each. With no screen
 * function yet the real check passes; later tasks add functions it then holds. Run by tools/test-sql.mjs, like its neighbors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
// @ts-expect-error the guard's lists live in a plain .mjs
import { ALLOWED_READS, ALLOWED_RPCS, SCREEN_HELPERS } from '../../../tools/check-web-reads.mjs';

/** Runs one SQL text, in one session, and returns psql's unaligned output. */
export type Query = (text: string) => string;

const lit = (xs: readonly string[]) => `array[${xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(', ')}]::text[]`;

/**
 * Functions that end in `_page` and are not screen functions: `standings_page` (0030) is an older security definer plpgsql function the
 * standings screen already calls, named before this convention. The plan did not account for it; it leaves this list when it is rewritten
 * as a screen function or renamed. Nothing else belongs here.
 */
const NOT_SCREEN_FUNCTIONS = ['standings_page'];

/** The search reads (0117) are screen functions without the `_page` name: one call, plpgsql with a fixed generic plan, an invoker, stable, reading what a screen may. */
export const SEARCH_READS = ['search_posts', 'search_threads', 'search_suggest'];

/** One line per fault, `function: predicate`, over every screen function visible to the session `db` runs in. */
export async function screenFaults(db: Query): Promise<string[]> {
  const out = db(`
    with screens as (
      select p.oid, p.proname, p.prosqlbody, p.prosecdef, p.provolatile
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and (p.proname = 'boot' or p.proname like '%\\_page' or p.proname = any (${lit(SEARCH_READS)})) and p.proname <> all (${lit(NOT_SCREEN_FUNCTIONS)})
    ),
    deps as (
      select distinct s.oid as screen, d.refclassid::regclass::text as kind, d.refobjid
      from screens s join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = s.oid
      where d.refclassid in ('pg_class'::regclass, 'pg_proc'::regclass)
    ),
    faults as (
      select proname, 'it is security definer, so it reads as its owner and not the caller' as why from screens where prosecdef
      union all select proname, 'it is not stable (provolatile = ''' || provolatile::text || ''')' from screens where provolatile <> 's'
      union all select s.proname, 'it depends on relation ' || n.nspname || '.' || c.relname || ', which is not in ALLOWED_READS'
        from deps d join screens s on s.oid = d.screen join pg_class c on d.kind = 'pg_class' and c.oid = d.refobjid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname <> 'pg_catalog' and not (n.nspname = 'public' and c.relname = any (${lit(ALLOWED_READS)}))
      union all select s.proname, 'it depends on function ' || f.proname || ', which is not in ALLOWED_RPCS or SCREEN_HELPERS'
        from deps d join screens s on s.oid = d.screen join pg_proc f on d.kind = 'pg_proc' and f.oid = d.refobjid
        where f.pronamespace = 'public'::regnamespace and f.oid <> s.oid and not (f.proname = any (${lit([...ALLOWED_RPCS, ...SCREEN_HELPERS])}))
      union all select s.proname, 'it depends on function ' || f.proname || ', which is volatile and may write'
        from deps d join screens s on s.oid = d.screen join pg_proc f on d.kind = 'pg_proc' and f.oid = d.refobjid
        where f.pronamespace = 'public'::regnamespace and f.oid <> s.oid and f.provolatile = 'v'
      union all select proname, 'authenticated cannot execute it' from screens where not has_function_privilege('authenticated', oid, 'execute')
      union all select proname, 'anon can execute it' from screens where has_function_privilege('anon', oid, 'execute')
    )
    select proname || ': ' || why from faults order by 1;`);
  return out.split('\n').filter(Boolean);
}

/** The real database's screen functions, as the scratch database holds them. */
const real: Query = (text) => sql(text);

/** A transaction that creates the poison, asks the question and rolls back, in one session, so nothing is left behind. */
const inPoison = (create: string): Query => (text) => sql(`begin;\n${create}\n${text}\nrollback;`);

const poisons: { name: string; create: string; why: RegExp }[] = [
  { name: 'reads a private table', why: /poison_page: it depends on relation public\.characters/,
    create: `create function public.poison_page() returns jsonb language sql stable begin atomic select to_jsonb(count(*)) from public.characters; end;
      grant execute on function public.poison_page() to authenticated; revoke execute on function public.poison_page() from public, anon;` },
  { name: 'is security definer', why: /poison_page: it is security definer/,
    create: `create function public.poison_page() returns jsonb language sql stable security definer begin atomic select to_jsonb(1); end;
      grant execute on function public.poison_page() to authenticated; revoke execute on function public.poison_page() from public, anon;` },
  { name: 'calls here', why: /poison_page: it depends on function here, which is volatile and may write/,
    /* Declared stable, so only the volatile-dependency clause can catch it: here is in ALLOWED_RPCS. */
    create: `create function public.poison_page() returns jsonb language sql stable begin atomic select to_jsonb(public.here('board', null, null)); end;
      grant execute on function public.poison_page() to authenticated; revoke execute on function public.poison_page() from public, anon;` },
  { name: 'is granted to anon', why: /poison_page: anon can execute it/,
    create: `create function public.poison_page() returns jsonb language sql stable begin atomic select to_jsonb(1); end;
      grant execute on function public.poison_page() to authenticated, anon;` },
];

test('every screen function is an invoker, stable function (plpgsql with a fixed generic plan, or SQL-bodied) that reads only what a screen may and that anon cannot call', async () => {
  const faults = await screenFaults(real);
  assert.deepEqual(faults, [], faults.join('\n'));
});

test('the guard reads the search functions as screens, and they write nothing', async () => {
  const listed = sql(`select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname = any (${lit(SEARCH_READS)}) and prolang = (select oid from pg_language where lanname = 'plpgsql') and proconfig @> array['plan_cache_mode=force_generic_plan'] and not prosecdef and provolatile = 's'`);
  assert.equal(listed, [...SEARCH_READS].sort().join(','), 'the three search reads are plpgsql with the fixed plan, invokers and stable');
  const before = sql(`select (select count(*) from acts) || ',' || (select count(*) from post_search) || ',' || (select count(*) from search_rebuild)`);
  sql(`select search_posts('a', null, null, null, null, false, null, null, 5), search_threads('a', null, null, null, null, false, null, null, 5), search_suggest('ab', null, null, false, 5)`);
  assert.equal(sql(`select (select count(*) from acts) || ',' || (select count(*) from post_search) || ',' || (select count(*) from search_rebuild)`), before, 'a search wrote a row');
});

for (const p of poisons) {
  test(`the guard answers a fault for a screen function that ${p.name}`, async () => {
    const faults = await screenFaults(inPoison(p.create));
    assert.ok(faults.some((f) => p.why.test(f)), `no fault matching ${p.why} among: ${JSON.stringify(faults)}`);
    assert.deepEqual(await screenFaults(real), [], 'the poison was rolled back');
  });
}
