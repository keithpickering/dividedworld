-- Job health: job_runs, record_job_run, job_status, admin_jobs, and the three SQL jobs' heartbeats (supabase/migrations/0450_job_health.sql; docs/plans/2026-11-20-job-health-design.md, sections 1 and 6.1; its plan, Task 2).
--
-- 1. record_job_run sets last_ok_at, moves it on a second call, leaves another job's row alone, makes the row when it is the first, and refuses a name that is not kayfabb-[a-z-]+.
-- 2. job_status() as anon returns the ten jobs with the jobGraceMinutes row's value, and null when the row is deleted; it names a job that has a job_runs row and no cron.job row.
-- 3. admin_jobs() as a player is refused; as an admin it returns the last run row of each job and the two Vault booleans (true, then false with the secret deleted, or empty).
-- 4. Each SQL job's cron.job command runs its work before its record and names its own job (the poison: a scratch command with the record first fails the order reading).
-- 5. record_job_run is the service role's alone; job_runs is no client's.
-- 6. A job's row begins when it is scheduled (note_job_scheduled, called by each of the ten schedule functions): a fresh seed gives every job a row with a first_seen and no last_ok_at, a
--    reschedule keeps first_seen, a database with no settings gets none, and the helper is no client's.
--
-- -- 7. A SQL job's command is atomic: with its work failing, the record is not written (the command run as pg_cron runs one: a whole string, one transaction; here one execute of the string in an exception block, which rolls the whole string back).
-- -- 8. A stray kayfabb-x1 in cron.job is skipped by the migration's bulk insert and by the settings trigger's; job_status() with a non-object jobGraceMinutes row; admin_jobs() for a job in job_runs and not in cron.job has no last run.

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

  -- 7. Atomic: the exact command text of each SQL job, its work swapped for a scratch function that raises, run as one string. pg_cron runs a command as one SPI call in one transaction, so
  -- either every statement of it lands or none does; an exception block (a subtransaction) around one execute of the whole string is that same all-or-nothing.
  create function pg_temp.boom() returns void language plpgsql as 'begin raise exception ''the work failed''; end';
  create function pg_temp.fine() returns void language plpgsql as 'begin null; end';
  for r in select * from (values ('kayfabb-system-tick', 'public.system_tick()'), ('kayfabb-search-rebuild', 'public.search_rebuild_step()'), ('kayfabb-view-counts', 'public.count_thread_views()')) v(job, work) loop
    select command into cmd from cron.job where jobname = r.job;
    if position(r.work in cmd) = 0 then raise exception '% command does not hold %: %', r.job, r.work, cmd; end if;
    delete from job_runs where job = r.job;
    -- Control: with the work fine, the whole string runs and the record lands.
    execute replace(cmd, r.work, 'pg_temp.fine()');
    if not exists (select 1 from job_runs where job = r.job and last_ok_at is not null) then raise exception '% control: the swapped command recorded nothing', r.job; end if;
    delete from job_runs where job = r.job;
    begin
      execute replace(cmd, r.work, 'pg_temp.boom()');
      raise exception '% the failing command did not raise', r.job;
    exception when others then
      if sqlerrm <> 'the work failed' then raise; end if;
    end;
    if exists (select 1 from job_runs where job = r.job) then raise exception '% recorded a run though its work failed', r.job; end if;
  end loop;
  -- The poison: a record placed first would land before the work fails, and it is the one thing this reading must see.
  begin
    execute 'select public.record_job_run(''kayfabb-system-tick''); select pg_temp.boom();';
  exception when others then null;
  end;
  if exists (select 1 from job_runs where job = 'kayfabb-system-tick') then raise exception 'the atomic reading kept a record whose command failed'; end if;

  -- 8. A stray name is skipped by the migration's bulk insert (its statement, as written in 0450) and by the settings trigger's.
  insert into cron.job (jobname, schedule, command) values ('kayfabb-x1', '* * * * *', 'select 1');
  delete from job_runs;
  insert into job_runs (job) select jobname from cron.job where jobname ~ '^kayfabb-[a-z-]+$' and exists (select 1 from settings) on conflict do nothing;
  if exists (select 1 from job_runs where job = 'kayfabb-x1') then raise exception 'the bulk insert made a row for a stray name'; end if;
  if (select count(*) from job_runs) is distinct from 10 then raise exception 'the bulk insert made % rows, not 10', (select count(*) from job_runs); end if;
  delete from job_runs;
  insert into settings (key, value) values ('jhProbe', '1');
  if exists (select 1 from job_runs where job = 'kayfabb-x1') then raise exception 'the settings trigger made a row for a stray name'; end if;
  delete from settings where key = 'jhProbe';
  delete from cron.job where jobname = 'kayfabb-x1';

  -- job_status() with a jobGraceMinutes row that is not an object.
  delete from settings where key = 'jobGraceMinutes';
  if pg_temp.refusal('insert into settings (key, value) values (''jobGraceMinutes'', ''5'')') is null then
    perform tests.become_anon();
    if (select count(*) from job_status() where grace = '5'::jsonb) is distinct from 10 then raise exception 'job_status did not carry a non-object grace as it is'; end if;
    perform tests.unbecome();
    delete from settings where key = 'jobGraceMinutes';
  end if;

  -- admin_jobs() for a job with a row and no schedule: its last run is null, never another job's.
  insert into job_runs (job) values ('kayfabb-gone');
  perform tests.become(boss);
  select * into r from admin_jobs() where job = 'kayfabb-gone';
  if r.job is null or r.last_status is not null or r.last_message is not null or r.last_start is not null then raise exception 'a job absent from cron.job has a last run: %', r; end if;
  perform tests.unbecome();
  delete from job_runs where job = 'kayfabb-gone';

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

-- 6. A job's row begins when it is scheduled.
do $$
declare
  jobs constant text[] := array['kayfabb-settle', 'kayfabb-meet', 'kayfabb-chatter', 'kayfabb-staff', 'kayfabb-write', 'kayfabb-mail', 'kayfabb-conceal', 'kayfabb-system-tick', 'kayfabb-search-rebuild', 'kayfabb-view-counts'];
  j text; t timestamptz; kept jsonb;
begin
  -- The fixtures' instance, kept to be seeded again.
  select jsonb_object_agg(key, value) into kept from settings;
  delete from job_runs;
  delete from cron.job where jobname like 'kayfabb-%';

  -- A database with no settings: the schedule functions that read none add no row.
  set local session_replication_role = replica;  -- the economy's guard refuses a delete of the settings; this is a database that never had them
  delete from settings;
  set local session_replication_role = origin;
  perform schedule_card_writes(); perform schedule_mail(); perform schedule_conceal(); perform schedule_system_tick(); perform schedule_search_rebuild();
  if (select count(*) from job_runs) is distinct from 0 then raise exception 'a schedule function made a row in a database with no settings: %', (select string_agg(job, ', ') from job_runs); end if;
  if (select count(*) from cron.job where jobname like 'kayfabb-%') is distinct from 5 then raise exception 'the five were not scheduled'; end if;

  -- A fresh seed: the settings arrive (their triggers schedule), then the jobs no setting keys.
  insert into settings (key, value) select e.key, e.value from jsonb_each(kept) e;
  -- The settings' arrival began the rows of the jobs already scheduled, the four no setting keys among them.
  foreach j in array array['kayfabb-write', 'kayfabb-mail', 'kayfabb-conceal', 'kayfabb-search-rebuild'] loop
    if not exists (select 1 from job_runs where job = j and last_ok_at is null) then raise exception '% has no row after the settings arrived', j; end if;
  end loop;
  -- The fixtures hold some of the keys the jobs read; the rest arrive as a seed's payload would bring them (written past the validators, which are not under test), each job scheduled as its trigger would.
  set constraints all immediate;
  alter table settings disable trigger settings_held;
  insert into settings (key, value) values ('meetingCron', '"0 6 * * *"'), ('pool', '{"chatterCron": "0 7 * * *"}'), ('modBots', '{"filingCron": "0 8 * * *"}'), ('systemEnabled', 'true')
    on conflict do nothing;
  alter table settings enable trigger settings_held;
  perform schedule_settlement(); perform schedule_meeting(); perform schedule_chatter(); perform schedule_staff(); perform schedule_system_tick(); perform schedule_view_counts();
  perform schedule_card_writes(); perform schedule_mail(); perform schedule_conceal(); perform schedule_search_rebuild();
  foreach j in array jobs loop
    if not exists (select 1 from cron.job where jobname = j) then raise exception '% is not scheduled by the seed', j; end if;
    if not exists (select 1 from job_runs where job = j and first_seen is not null and last_ok_at is null) then raise exception '% has no row with a first_seen and no last_ok_at after a seed', j; end if;
  end loop;
  if (select count(*) from job_runs) is distinct from 10 then raise exception 'job_runs holds % rows after a seed, not 10', (select count(*) from job_runs); end if;

  -- A reschedule keeps first_seen and a recorded run.
  update job_runs set first_seen = now() - interval '3 days';
  perform record_job_run('kayfabb-settle');
  update settings set value = '"7 7 * * *"' where key = 'settlementCron';
  perform schedule_card_writes(); perform schedule_mail(); perform schedule_conceal(); perform schedule_system_tick(); perform schedule_search_rebuild(); perform schedule_view_counts();
  if (select count(*) from job_runs where first_seen > now() - interval '2 days') is distinct from 0 then raise exception 'a reschedule moved a first_seen'; end if;
  if (select last_ok_at from job_runs where job = 'kayfabb-settle') is null then raise exception 'a reschedule cleared last_ok_at'; end if;

  -- The helper is no client's.
  foreach j in array array['anon', 'authenticated'] loop
    if pg_temp.refusal(format('set local role %s; select note_job_scheduled(%L)', j, 'kayfabb-settle')) is null then raise exception '% called note_job_scheduled', j; end if;
    reset role;
  end loop;
end $$;
