-- Job health (docs/plans/2026-11-20-job-health-design.md, sections 0, 1, 2 and 6.1; its plan, Task 2).
--
-- A job writes its own heartbeat. pg_cron's `succeeded` only says a request was queued, so each job that finishes and answers records the time in `job_runs`
-- through record_job_run; the three SQL jobs do it in their own command, after their work, in one transaction (a run that throws records nothing). The
-- function jobs record through asJob (Task 3). job_status() is the read anyone may make (a schedule, whether it is active, first_seen, last_ok_at and the grace);
-- admin_jobs() adds pg_cron's last run and whether the two Vault secrets the jobs read are present, for admins alone, and never a secret's value.
--
-- job_runs is a machine table like view_count_runs (0018): updated in place, no history (pg_cron's own table is that), not an Act. It has no policy and no grant to
-- a client; the instance export carries it with every other public table.
--
-- Latest definitions copied: schedule_system_tick (0048), schedule_search_rebuild (0117), schedule_view_counts (0018); none was re-created later. Each keeps its
-- schedule expression exactly and changes only its command. system_tick and the other work functions are not touched. 0018 did not call schedule_view_counts at
-- migration time (the settings trigger does, at a seed), so it is called here with the guard the other settings-keyed jobs use, so a seeded instance carries
-- the new command at once. settings_held (0445) holds the new `jobGraceMinutes` setting beside the rest.

create table job_runs (
  job text primary key check (job ~ '^kayfabb-[a-z-]+$'),
  first_seen timestamptz not null default now(),
  last_ok_at timestamptz
);
alter table job_runs enable row level security;
revoke all on job_runs from public, anon, authenticated;

create function record_job_run(job text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if job is null or job !~ '^kayfabb-[a-z-]+$' then
    raise exception 'record_job_run: % is not a job name', coalesce(job, 'null') using errcode = '22023';
  end if;
  insert into job_runs as r (job, last_ok_at) values (record_job_run.job, now())
  on conflict on constraint job_runs_pkey do update set last_ok_at = now();
end $$;
revoke execute on function record_job_run(text) from public, anon, authenticated;
grant execute on function record_job_run(text) to service_role;

-- The jobs an instance already runs begin their row now: a job that has never run is measured from here. Only where the instance has settings: a database just
-- migrated holds no rows in any table of its own (an import into it is refused as not empty, tools/import-instance.mjs; supabase/tests/e2e/0003-export.ts holds the list), and the
-- search rebuild is scheduled by 0117 even then. A seeded instance's rows for the jobs its seed schedules are a gap the plan names (job_runs rows at seed time).
insert into job_runs (job) select jobname from cron.job where jobname like 'kayfabb-%' and exists (select 1 from settings) on conflict do nothing;

-- One row per job in the union of the scheduled kayfabb- jobs and the rows; the grace is the settings row's whole value, read from `settings` directly (setting() raises on a missing row).
create function job_status() returns table (job text, schedule text, active boolean, first_seen timestamptz, last_ok_at timestamptz, grace jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with names as (
    select c.jobname as job from cron.job c where c.jobname like 'kayfabb-%'
    union
    select r.job from job_runs r
  )
  select n.job, c.schedule, c.active, r.first_seen, r.last_ok_at, (select s.value from settings s where s.key = 'jobGraceMinutes')
  from names n
  left join cron.job c on c.jobname = n.job
  left join job_runs r on r.job = n.job
  order by n.job
$$;
revoke execute on function job_status() from public;
grant execute on function job_status() to anon, authenticated;

create function admin_jobs() returns table (job text, schedule text, active boolean, first_seen timestamptz, last_ok_at timestamptz, grace jsonb,
                                            last_status text, last_message text, last_start timestamptz, url_set boolean, key_set boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  url_ok boolean;
  key_ok boolean;
begin
  perform only_admins('reads the jobs');
  select coalesce(bool_or(coalesce(btrim(d.decrypted_secret), '') <> '') filter (where d.name = 'kayfabb_functions_url'), false),
         coalesce(bool_or(coalesce(btrim(d.decrypted_secret), '') <> '') filter (where d.name = 'kayfabb_jobs_key'), false)
    into url_ok, key_ok from vault.decrypted_secrets d where d.name in ('kayfabb_functions_url', 'kayfabb_jobs_key');
  return query
  select s.job, s.schedule, s.active, s.first_seen, s.last_ok_at, s.grace, l.status, l.return_message, l.start_time, url_ok, key_ok
  from job_status() s
  left join cron.job c on c.jobname = s.job
  left join lateral (
    select d.status, d.return_message, d.start_time from cron.job_run_details d where d.jobid = c.jobid order by d.start_time desc nulls last, d.runid desc limit 1
  ) l on true
  order by s.job;
end $$;
revoke execute on function admin_jobs() from public, anon;
grant execute on function admin_jobs() to authenticated;

-- The three SQL jobs: the work, then the record, one transaction.
create or replace function schedule_system_tick() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-system-tick', '* * * * *', 'select public.system_tick(); select public.record_job_run(''kayfabb-system-tick'');');
end $$;

create or replace function schedule_search_rebuild() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-search-rebuild', '* * * * *', 'select public.search_rebuild_step(); select public.record_job_run(''kayfabb-search-rebuild'');');
end $$;

create or replace function schedule_view_counts() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-view-counts', setting('viewCountCron') #>> '{}', 'select public.count_thread_views(); select public.record_job_run(''kayfabb-view-counts'');');
end $$;

select schedule_system_tick() where exists (select 1 from settings where key = 'systemEnabled');
select schedule_search_rebuild();
select schedule_view_counts() where exists (select 1 from settings where key = 'viewCountCron');

-- settings_held (0445_persona_lines.sql), holding `jobGraceMinutes` (engine/rules/instance.ts, jobGraceRule) beside the rest. Everything else as 0445 wrote it.
create or replace function public.settings_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'revealPerk' then case when not coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1, false) then 'a number from 0 to 1' end
    -- How many days a post's debate is followed (0391): a whole number of days, at least 1 and at most 365 (as digestBoardDays and movedStubDays are), so the `::integer` and the interval the inputs build from it cannot overflow.
    when 'debateDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'postEffects' then case when not setting_whole(v, 1, 16) then 'a whole number of effects, at least 1 and at most 16' end
    when 'crowdPayEach' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdFloor' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdPayMost' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollOptionsMax' then case when not setting_whole(v, 2, 100) then 'a whole number of options, at least 2 and at most 100' end
    when 'pollQuestionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollOptionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollLastsMin' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'pollLastsMax' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    -- The old voice's window (§4 of docs/plans/2026-11-12-old-voice-window-design.md), in the words engine/rules/instance.ts gives each.
    when 'oldVoiceWindow' then case when not setting_whole(v, 64, 1000000) then 'a whole number of tokens from 64 to 1,000,000' end
    when 'oldVoiceTokenizer' then case when v not in ('"gpt2"', '"bytes"') then '"gpt2" or "bytes"' end
    when 'oldVoicePromptFloor' then case when not setting_whole(v, 1) then 'a whole number of tokens, at least 1' end
    when 'cardWriteFullShare' then case when not coalesce(case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 1 end, false) then 'a number from 0 to 1' end
    when 'cardWriteTopUps' then case when not setting_whole(v, 0, 5) then 'a whole number from 0 to 5' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    -- How many conversations with waiting replies the digest shows a pool persona (0415): a whole number from 0 to 12, as DIGEST_MOST.conversations holds.
    when 'digestConversations' then case when not setting_whole(v, 0, 12) then 'a whole number of conversations, at least 0 and at most 12' end
    -- The digest's per-day lists and the standouts' span (0433, docs/plans/2026-11-25-digest-sees-the-board-design.md, section 4): a whole number of each per day of the window, from 1 to DIGEST_MOST's ceiling,
    -- and the span in days of the standouts, from 1 to 30 (DIGEST_MOST.standoutDays); the instance's values are held by engine/rules/instance.ts too.
    when 'digestPolls' then case when not setting_whole(v, 1, 20) then 'a whole number of polls, at least 1 and at most 20' end
    when 'digestSpins' then case when not setting_whole(v, 1, 20) then 'a whole number of spun threads, at least 1 and at most 20' end
    when 'digestPlays' then case when not setting_whole(v, 1, 20) then 'a whole number of plays, at least 1 and at most 20' end
    when 'digestStandoutDays' then case when not setting_whole(v, 1, 30) then 'a whole number of days, at least 1 and at most 30' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'movedStubDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'bundleMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'bundleAuthoredMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'farewellWindowHours' then case when not setting_whole(v, 1, 720) then 'a whole number of hours, at least 1 and at most 720' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    -- The staff's own stock lines and what is owed (0445, docs/plans/2026-11-25-persona-lines-design.md, sections 1.2 and 1.5): personaLines is held by setting_personalines, and owedLines gives the grace, the day's cap and a run's cap.
    when 'personaLines' then case when not setting_personalines(v) then 'an object of objects, each key of a persona''s set holding a non-empty list of non-blank lines' end
    when 'owedLines' then case when not coalesce(jsonb_typeof(v) = 'object' and setting_whole(v -> 'graceMinutes', 1, 1440) and setting_whole(v -> 'perDay', 0, 10000) and setting_whole(v -> 'perRun', 1, 200), false)
      then 'an object giving graceMinutes (a whole number of minutes from 1 to 1440), perDay (a whole number from 0 to 10000) and perRun (a whole number from 1 to 200)' end
    -- Job health (0450): some of the scheduled jobs, each a grace of whole minutes from 1 to 1440; a job left out keeps its default.
    when 'jobGraceMinutes' then case when not coalesce(jsonb_typeof(v) = 'object'
        and not exists (select 1 from jsonb_each(v) e where e.key <> all (array['kayfabb-settle', 'kayfabb-meet', 'kayfabb-chatter', 'kayfabb-staff', 'kayfabb-write', 'kayfabb-mail', 'kayfabb-conceal', 'kayfabb-system-tick', 'kayfabb-search-rebuild', 'kayfabb-view-counts']) or not setting_whole(e.value, 1, 1440)), false)
      then 'an object giving some of the jobs (kayfabb-settle, kayfabb-meet, kayfabb-chatter, kayfabb-staff, kayfabb-write, kayfabb-mail, kayfabb-conceal, kayfabb-system-tick, kayfabb-search-rebuild, kayfabb-view-counts), each a grace of a whole number of minutes from 1 to 1440' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    -- How long a conferred request waits for a meeting, and how many a meeting reads (0424): setting_staffrequests.
    when 'staffRequests' then setting_staffrequests(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'conduct' then setting_conduct(v)
    when 'conductVersion' then case when not setting_whole(v, 1) then 'a whole number, at least 1 (the version of the code of conduct)' end
    when 'conductSections' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''), false)
      then 'an array of section keys, each a non-blank string' end
    when 'cosmetics' then setting_cosmetics(v)
    -- The pack an account's first character is given (0377): the key of a pack, or null for none. That it names a fixed pack of the instance is the instance check's (engine/rules/instance.ts) and
    -- welcome_pack_kind's: a name that is no fixed pack grants nothing.
    when 'startingPack' then case when not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}', E' \t\n\r\f\v') <> '')) then 'the key of a fixed pack, or null for none' end
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  -- The least a poll may last is held against the most, whichever is written (the other's row is read as it stands; a row that is not a span is that row's own refusal, never this one).
  if why is null and new.key = 'pollLastsMin' and setting_span((select g.value from settings g where g.key = 'pollLastsMax'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) > span_interval((select g.value from settings g where g.key = 'pollLastsMax')) then
    why := 'a span no longer than pollLastsMax';
  end if;
  if why is null and new.key = 'pollLastsMax' and setting_span((select g.value from settings g where g.key = 'pollLastsMin'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) < span_interval((select g.value from settings g where g.key = 'pollLastsMin')) then
    why := 'a span no shorter than pollLastsMin';
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $function$;
