-- The database plans without JIT (supabase/migrations/0441_database_jit_off.sql; docs/plans/2026-11-25-database-jit-off-plan.md, Task 2; design sections 2 and 3).
-- 1. The session reads `jit` as off.
-- 2. The database stores `jit=off` for every role (pg_db_role_setting, setrole = 0): the migration's setting, told apart from one a connection made for itself. The runner copies what the
--    template stored onto this file's clone (tools/test-sql.mjs, cloneSql), so this reads the migration, not the runner.
-- 3. The setting does what it is for: with jit_above_cost at 0, a small query's plan carries no JIT; under `set local jit = on` the same plan carries one, where the server has JIT,
--    so the probe is not blind. Where the server has no JIT, the file says so and holds 1 and 2 alone.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

-- The top object of a plan's JSON, executed, so JIT's compile is part of it when it happens.
create function pg_temp.plan() returns jsonb language plpgsql as $$
declare j json;
begin
  execute 'explain (analyze, format json) select sum(g) from generate_series(1, 1000) g' into j;
  return (j::jsonb) -> 0;
end $$;

select pg_temp.expect(current_setting('jit') = 'off', format('the session reads jit as %s, not off', current_setting('jit')));

select pg_temp.expect(exists (
  select 1 from pg_db_role_setting s, unnest(s.setconfig) c
  where s.setdatabase = (select oid from pg_database where datname = current_database()) and s.setrole = 0 and c = 'jit=off'
), 'the database does not store jit = off');

set local jit_above_cost = 0;
select pg_temp.expect(not (pg_temp.plan() ? 'JIT'), 'a plan under the database''s setting compiled JIT: ' || pg_temp.plan()::text);

set local jit = on;
do $$ begin
  if pg_jit_available() then
    perform pg_temp.expect(pg_temp.plan() ? 'JIT', 'the probe cannot see JIT: under jit = on the plan has no JIT key');
  else
    raise notice 'JIT is not available on this server, so the part of this file that watches a plan compile was not exercised';
  end if;
end $$;
