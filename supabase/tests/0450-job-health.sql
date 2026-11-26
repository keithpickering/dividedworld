-- Job health: job_runs, record_job_run, job_status, admin_jobs, and the three SQL jobs' heartbeats (supabase/migrations/0450_job_health.sql; docs/plans/2026-11-20-job-health-design.md, sections 1 and 6.1; its plan, Task 2).
--
-- 1. record_job_run sets last_ok_at, moves it on a second call, leaves another job's row alone, makes the row when it is the first, and refuses a name that is not kayfabb-[a-z-]+.
-- 2. job_status() as anon returns the ten jobs with the jobGraceMinutes row's value, and null when the row is deleted; it names a job that has a job_runs row and no cron.job row.
-- 3. admin_jobs() as a player is refused; as an admin it returns the last run row of each job and the two Vault booleans (true, then false with the secret deleted, or empty).
-- 4. Each SQL job's cron.job command runs its work before its record and names its own job (the poison: a scratch command with the record first fails the order reading).
-- 5. record_job_run is the service role's alone; job_runs is no client's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- True when `cmd` is exactly its work, then its own record, in that order.
create function pg_temp.in_order(cmd text, work text, job text) returns boolean language sql as $$
  select position(work in cmd) > 0 and position(format('select public.record_job_run(%L)', job) in cmd) > position(work in cmd)
    and regexp_replace(cmd, '\s+', ' ', 'g') = format('select public.%s; select public.record_job_run(%L);', work, job)
$$;

do $$
declare
  jobs constant text[] := array['kayfabb-settle', 'kayfabb-meet', 'kayfabb-chatter', 'kayfabb-staff', 'kayfabb-write', 'kayfabb-mail', 'kayfabb-conceal', 'kayfabb-system-tick', 'kayfabb-search-rebuild', 'kayfabb-view-counts'];
  j text; boss uuid; ann uuid; n integer; t1 timestamptz; t2 timestamptz; r record; cmd text;
begin
  boss := tests.account('jh-boss'); ann := tests.account('jh-ann');
  insert into admins (account) values (boss);
  -- All ten are scheduled, as on a deployed instance; the three SQL jobs through their own schedule functions.
  foreach j in array jobs loop perform cron.schedule(j, '* * * * *', 'select 1'); end loop;
  perform schedule_system_tick(); perform schedule_search_rebuild(); perform schedule_view_counts();
  delete from job_runs;

  -- 1. record_job_run
  perform record_job_run('kayfabb-settle');
  select first_seen, last_ok_at into t1, t2 from job_runs where job = 'kayfabb-settle';
  if t2 is null then raise exception 'record_job_run made no last_ok_at'; end if;
  if t1 is null then raise exception 'the row has no first_seen'; end if;
  perform record_job_run('kayfabb-meet');
  update job_runs set last_ok_at = now() - interval '1 hour' where job = 'kayfabb-settle';
  select last_ok_at into t1 from job_runs where job = 'kayfabb-settle';
  perform record_job_run('kayfabb-meet');
  if (select last_ok_at from job_runs where job = 'kayfabb-settle') is distinct from t1 then raise exception 'another job''s call moved this row'; end if;
  update job_runs set last_ok_at = now() - interval '1 hour' where job = 'kayfabb-meet';
  perform record_job_run('kayfabb-meet');
  if (select last_ok_at from job_runs where job = 'kayfabb-meet') < now() - interval '1 minute' then raise exception 'a second call did not move last_ok_at'; end if;
  if (select count(*) from job_runs) is distinct from 2 then raise exception 'rows: expected 2'; end if;
  foreach j in array array['kayfabb-', 'Kayfabb-x', 'kayfabb-a1', 'other', 'kayfabb-x; drop', ''] loop
    if pg_temp.refusal(format('select record_job_run(%L)', j)) is null then raise exception 'record_job_run took the name %', j; end if;
  end loop;
  if pg_temp.refusal('select record_job_run(null)') is null then raise exception 'record_job_run took null'; end if;

  -- 2. job_status() as anon
  foreach j in array jobs loop insert into job_runs (job) values (j) on conflict do nothing; end loop;
  delete from settings where key = 'jobGraceMinutes';
  insert into settings (key, value) values ('jobGraceMinutes', '{"kayfabb-settle": 30, "kayfabb-mail": 10}');
  perform tests.become_anon();
  select count(*) into n from job_status();
  if n <> 10 then raise exception 'job_status returned % jobs, not 10', n; end if;
  if (select count(distinct grace) from job_status()) is distinct from 1 or (select grace from job_status() limit 1) is distinct from '{"kayfabb-settle": 30, "kayfabb-mail": 10}'::jsonb then raise exception 'the grace is not the settings row'; end if;
  select * into r from job_status() where job = 'kayfabb-settle';
  if r.schedule <> '* * * * *' or r.active is not true or r.last_ok_at is null or r.first_seen is null then raise exception 'job_status settle row: %', r; end if;
  perform tests.unbecome();
  delete from settings where key = 'jobGraceMinutes';
  perform tests.become_anon();
  if (select count(*) from job_status() where grace is not null) is distinct from 0 then raise exception 'job_status grace is not null with no row'; end if;
  if (select count(*) from job_status()) is distinct from 10 then raise exception 'job_status broke with no settings row'; end if;
  perform tests.unbecome();
  -- A job with a row and no schedule, and one scheduled and with no row, both appear.
  insert into job_runs (job) values ('kayfabb-gone');
  perform cron.schedule('kayfabb-fresh', '5 4 * * *', 'select 1');
  perform tests.become_anon();
  select * into r from job_status() where job = 'kayfabb-gone';
  if r.job is null or r.schedule is not null then raise exception 'a job with no schedule: %', r; end if;
  select * into r from job_status() where job = 'kayfabb-fresh';
  if r.job is null or r.schedule <> '5 4 * * *' or r.first_seen is not null then raise exception 'a scheduled job with no row: %', r; end if;
  perform tests.unbecome();
  delete from job_runs where job = 'kayfabb-gone'; delete from cron.job where jobname = 'kayfabb-fresh';
  insert into cron.job (jobname, schedule, command) values ('other-job', '* * * * *', 'select 1');
  perform tests.become_anon();
  if exists (select 1 from job_status() where job = 'other-job') then raise exception 'job_status named a job that is not kayfabb-'; end if;
  perform tests.unbecome();

  -- 3. admin_jobs()
  perform tests.become(ann);
  if pg_temp.refusal('select * from admin_jobs()') is null then raise exception 'a player read admin_jobs'; end if;
  perform tests.become_anon();
  if pg_temp.refusal('select * from admin_jobs()') is null then raise exception 'a visitor read admin_jobs'; end if;
  perform tests.unbecome();
  insert into cron.job_run_details (jobid, command, status, return_message, start_time, end_time)
    select jobid, command, 'succeeded', '1 row', now() - interval '3 minutes', now() - interval '3 minutes' from cron.job where jobname = 'kayfabb-mail';
  insert into cron.job_run_details (jobid, command, status, return_message, start_time, end_time)
    select jobid, command, 'failed', 'the last one', now() - interval '1 minute', now() - interval '1 minute' from cron.job where jobname = 'kayfabb-mail';
  delete from vault.decrypted_secrets where name in ('kayfabb_functions_url', 'kayfabb_jobs_key');
  insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'https://x.invalid'), ('kayfabb_jobs_key', 'sb_secret_x');
  perform tests.become(boss);
  select count(*) into n from admin_jobs();
  if n <> 10 then raise exception 'admin_jobs returned % rows', n; end if;
  select * into r from admin_jobs() where job = 'kayfabb-mail';
  if r.last_status <> 'failed' or r.last_message <> 'the last one' then raise exception 'admin_jobs mail run: %', r; end if;
  if r.last_start < now() - interval '2 minutes' then raise exception 'admin_jobs did not read the latest run: %', r; end if;
  if (select count(*) from admin_jobs() where url_set and key_set) is distinct from 10 then raise exception 'the Vault booleans are not true for every row'; end if;
  if (select last_status from admin_jobs() where job = 'kayfabb-settle') is not null then raise exception 'a job with no run has a status'; end if;
  if (select string_agg(x::text, '') from admin_jobs() x) like '%sb_secret_x%' or (select string_agg(x::text, '') from admin_jobs() x) like '%x.invalid%' then raise exception 'admin_jobs returned a secret''s value'; end if;
  perform tests.unbecome();
  delete from vault.decrypted_secrets where name = 'kayfabb_jobs_key';
  perform tests.become(boss);
  if (select count(*) from admin_jobs() where url_set and not key_set) is distinct from 10 then raise exception 'the key boolean did not go false'; end if;
  perform tests.unbecome();
  update vault.decrypted_secrets set decrypted_secret = '' where name = 'kayfabb_functions_url';
  insert into vault.decrypted_secrets values ('kayfabb_jobs_key', 'k');
  perform tests.become(boss);
  if (select count(*) from admin_jobs() where not url_set and key_set) is distinct from 10 then raise exception 'an empty url counted as set'; end if;
  perform tests.unbecome();

  -- 4. The SQL jobs record after their work, and name their own job.
  for r in select * from (values ('kayfabb-system-tick', 'system_tick()'), ('kayfabb-search-rebuild', 'search_rebuild_step()'), ('kayfabb-view-counts', 'count_thread_views()')) v(job, work) loop
    select command into cmd from cron.job where jobname = r.job;
    if not pg_temp.in_order(cmd, r.work, r.job) then raise exception '% command is not its work then its own record: %', r.job, cmd; end if;
  end loop;
  -- The poison: a scratch command with the record first must fail the reading, and so must another job's name.
  if pg_temp.in_order('select public.record_job_run(''kayfabb-system-tick''); select public.system_tick();', 'system_tick()', 'kayfabb-system-tick') then raise exception 'the order reading passed a record placed first'; end if;
  if pg_temp.in_order('select public.system_tick(); select public.record_job_run(''kayfabb-meet'');', 'system_tick()', 'kayfabb-system-tick') then raise exception 'the order reading passed another job''s name'; end if;
  if (select schedule from cron.job where jobname = 'kayfabb-view-counts') is distinct from setting('viewCountCron') #>> '{}' then raise exception 'view counts lost its schedule'; end if;
  if (select schedule from cron.job where jobname = 'kayfabb-system-tick') is distinct from '* * * * *' or (select schedule from cron.job where jobname = 'kayfabb-search-rebuild') is distinct from '* * * * *' then raise exception 'a schedule changed'; end if;

  -- 5. Who may call what
  foreach j in array array['anon', 'authenticated'] loop
    if pg_temp.refusal(format('set local role %s; select record_job_run(%L)', j, 'kayfabb-settle')) is null then raise exception '% called record_job_run', j; end if;
    if pg_temp.refusal(format('set local role %s; select count(*) from job_runs', j)) is null then raise exception '% read job_runs', j; end if;
    reset role;
  end loop;
  perform tests.become_service();
  perform record_job_run('kayfabb-settle');
  perform tests.unbecome();
  if not (select relrowsecurity from pg_class where oid = 'public.job_runs'::regclass) then raise exception 'job_runs has no row-level security'; end if;
end $$;
