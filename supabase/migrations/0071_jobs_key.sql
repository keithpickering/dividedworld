-- The scheduled jobs' key (docs/plans/2026-11-02-api-keys-design.md; its plan's Task 5). KayfaBB takes Supabase's publishable
-- and secret keys alone, and the settlement's and the meeting's jobs now present the secret key named kayfabb_jobs, in apikey,
-- which settle and meet accept and nothing else does (fromTheService, supabase/functions/_shared/serve.ts). The two Vault
-- secrets the jobs read are now:
--  * kayfabb_functions_url: the project's functions address, as before.
--  * kayfabb_jobs_key: the kayfabb_jobs secret key's value.
-- kayfabb_service_key, which held the legacy service-role key the jobs sent as a bearer, is read nowhere after this migration;
-- a project that has it may delete it. Each function is its latest definition (0004, 0047) with its headers alone changed:
-- 'apikey' in place of 'Authorization' and 'Bearer ', read from kayfabb_jobs_key in place of kayfabb_service_key. Without both
-- secrets the job still sends nothing, and the next minute after they are made runs.
--
-- Then each job is scheduled again where its setting is held, so a database already seeded carries the new command; a database
-- not yet seeded is scheduled by its seed, through the settings triggers (0004, 0047), as before.

create or replace function schedule_settlement() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-settle', setting('settlementCron') #>> '{}', $job$
    select net.http_post(
      url := s.base || '/functions/v1/settle',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := jsonb_build_object('until', date_trunc('minute', now()) - interval '1 minute'),
      timeout_milliseconds := 60000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

create or replace function schedule_meeting() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-meet', setting('meetingCron') #>> '{}', $job$
    select net.http_post(
      url := s.base || '/functions/v1/meet',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := jsonb_build_object('slot', date_trunc('minute', now())),
      timeout_milliseconds := 150000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

select schedule_settlement() where exists (select 1 from settings where key = 'settlementCron');
select schedule_meeting() where exists (select 1 from settings where key = 'meetingCron');
