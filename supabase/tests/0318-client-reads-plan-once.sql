-- Every stable function the client calls keeps one generic plan (docs/plans/2026-11-13-plan-once-design.md, sections 3 and 4).
--
-- A client read is a stable function in public (the list is ALLOWED_RPCS, tools/check-web-reads.mjs, which tools/test-sql.mjs hands this file as the setting kayfabb.client_rpcs).
-- A `language sql` function is planned afresh on every call, and a `plpgsql` one plans each statement for the first five calls and then may switch to a generic plan, so a page that reads many
-- rows pays for planning on every call. A `plpgsql` function with `plan_cache_mode = force_generic_plan` plans once. The check names every client read that is not that.
--
-- 1. The poison: a planted `language sql` read is named, is not named once exempt, and a planted `plpgsql` read without the setting is still named; one with it is not.
-- 2. The exemptions: empty today.
-- 3. The real list: every client read that is a stable function in public is `plpgsql` with the setting, or the file raises naming each one that is not.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- The names, among those that are stable functions in public, that are not plpgsql or do not hold plan_cache_mode=force_generic_plan, less the exempt. Sorted.
create function pg_temp.not_planned_once(names text[], exempt text[]) returns text[] language sql as $$
  select coalesce(array_agg(distinct p.proname::text order by p.proname::text), '{}')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join pg_language l on l.oid = p.prolang
  where p.provolatile = 's'
    and p.proname::text = any (names)
    and not (p.proname::text = any (exempt))
    and (l.lanname <> 'plpgsql' or not coalesce(p.proconfig, '{}') @> array['plan_cache_mode=force_generic_plan'])
$$;

-- ---- 1. The poison ----
create function public.planted_client_read() returns bigint language sql stable as $$ select count(*) from public.acts_public $$;

do $$
begin
  perform pg_temp.expect(pg_temp.not_planned_once(array['planted_client_read'], '{}') = array['planted_client_read'],
    'the check did not name a planted language sql read: ' || pg_temp.not_planned_once(array['planted_client_read'], '{}')::text);
  perform pg_temp.expect(pg_temp.not_planned_once(array['planted_client_read'], array['planted_client_read']) = '{}',
    'the check named a planted read that was exempt');
end $$;

drop function public.planted_client_read();
create function public.planted_client_read() returns bigint language plpgsql stable as $$ begin return (select count(*) from public.acts_public); end $$;

do $$
begin
  perform pg_temp.expect(pg_temp.not_planned_once(array['planted_client_read'], '{}') = array['planted_client_read'],
    'the check did not name a planted plpgsql read without the setting: ' || pg_temp.not_planned_once(array['planted_client_read'], '{}')::text);
end $$;

alter function public.planted_client_read() set plan_cache_mode = force_generic_plan;

do $$
begin
  perform pg_temp.expect(pg_temp.not_planned_once(array['planted_client_read'], '{}') = '{}',
    'the check named a plpgsql read that holds the setting: ' || pg_temp.not_planned_once(array['planted_client_read'], '{}')::text);
end $$;

drop function public.planted_client_read();

-- ---- 2. The exemptions ----
-- An entry is for a helper that must stay inlinable into a caller or a policy, which a plpgsql function is not; the reason says which caller or policy.
-- A read that merely has not been converted is not an entry.
create temp table exempt_reads (name text primary key, reason text not null check (length(reason) > 20));
insert into exempt_reads (name, reason) select * from (values (null::text, null::text)) v where false;

-- ---- 3. The real list ----
do $$
declare
  unplanned text[];
begin
  unplanned := pg_temp.not_planned_once(string_to_array(current_setting('kayfabb.client_rpcs'), ','), coalesce((select array_agg(name) from exempt_reads), '{}'));
  if cardinality(unplanned) > 0 then
    raise exception '% client read(s) are not plpgsql with plan_cache_mode = force_generic_plan: %', cardinality(unplanned), array_to_string(unplanned, ', ');
  end if;
end $$;
