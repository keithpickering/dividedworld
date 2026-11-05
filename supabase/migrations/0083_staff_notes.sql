-- Staff notes (the staff roster design, "The masks"; its plan, Task 6).
--
-- A pool persona writes a short note of its own with each post it makes: a thought to itself, kept for the next time it is asked to
-- write. A note is read, never acted on: the Boss's meeting reads its own recent notes as context (`engine/system/memory.ts`,
-- `supabase/functions/meet/core.ts`) and nothing here, or there, turns a note's words into an effect.
--
-- `act` is the pool post that wrote the note, so a note is never without its post; `body` is at most 280 characters (the engine's
-- `noteMost`, held there by a test that reads this file) and never blank. The table is append-only like the office log, and no client
-- reaches it: only `staff_notes_recent`, for the service role, reads it back.
--
-- Ways out: nothing here holds a player in a state. A note is an inert record of what a persona thought.

create table staff_notes (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  act uuid not null references acts (id),
  at timestamptz not null default now(),
  body text not null check (length(btrim(body, E' \t\n\r\f\v')) between 1 and 280)
);
create index staff_notes_latest on staff_notes (staff, at desc, id desc);
alter table staff_notes enable row level security;
revoke all on staff_notes from public, anon, authenticated;

create function staff_notes_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a staff note is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create trigger staff_notes_no_update before update or delete on staff_notes for each row execute function staff_notes_append_only();
create trigger staff_notes_no_truncate before truncate on staff_notes for each statement execute function staff_notes_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table staff_notes enable always trigger staff_notes_no_update;
alter table staff_notes enable always trigger staff_notes_no_truncate;
revoke execute on function staff_notes_append_only() from public, anon, authenticated;

-- A persona's notes after `since` (null: all), the newest `most`, returned oldest first as a json array of their words.
create function staff_notes_recent(of_staff text, since timestamptz, most integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(n.body order by n.at, n.id), '[]'::jsonb)
  from (
    select s.body, s.at, s.id from staff_notes s
    where s.staff = of_staff and (since is null or s.at > since)
    order by s.at desc, s.id desc
    limit greatest(coalesce(most, 0), 0)
  ) n
$$;
revoke execute on function staff_notes_recent(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function staff_notes_recent(text, timestamptz, integer) to service_role;

-- The setting that bounds the read is `pool.notesRead`: how many of its own recent notes the Boss's meeting reads (a whole number, at least 1).
-- It is held with the pool's other settings by settings_held (0077); the TypeScript rule is `poolRule` in engine/rules/instance.ts, and
-- supabase/tests/0079-settings-held.sql lists its poisons and goods.

-- ----------------------------------------------------------------------------------- the pool's settings held ----

-- The posting pool's settings (`pool`; the staff roster plan, Task 9): exactly eight fields, each held as the TypeScript rule says
-- (`poolRule` in engine/rules/instance.ts). Returns the words of what is wrong, or null. Its rarities are rarity_rank's (0054) and its triggers are
-- the pool's eight (engine/system/pool.ts, TRIGGERS), which supabase/tests/0079-settings-held.sql and engine/rules/settings-held.test.ts keep one list.
create function setting_pool(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  fields text[] := array['weekly', 'holdback', 'threadsWeekly', 'cardRarityMost', 'priorityDays', 'notesRead', 'strengths', 'chatterCron'];
  triggers text[] := array['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat'];
  shape text := 'an object giving weekly, priorityDays and notesRead (whole numbers, at least 1), threadsWeekly (a whole number, at least 0), '
    'holdback (from 0 to 0.5), cardRarityMost (common, uncommon, rare or legendary), strengths (a whole number, at least 1, for each of '
    'named, quoted, legacy, successorStumbles, oldFlame, homeTurf, seasonTurn, hotOnBeat) and chatterCron (a five-field cron expression, each field inside its range)';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (fields) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  foreach k in array array['weekly', 'priorityDays', 'notesRead'] loop
    if not setting_whole(v -> k, 1) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  if not setting_whole(v -> 'threadsWeekly', 0) then return shape || '; "threadsWeekly" is not'; end if;
  if not coalesce(jsonb_typeof(v -> 'holdback') = 'number' and (v ->> 'holdback')::numeric >= 0 and (v ->> 'holdback')::numeric <= 0.5, false) then
    return shape || '; "holdback" is not';
  end if;
  if not coalesce(jsonb_typeof(v -> 'cardRarityMost') = 'string' and rarity_rank(v ->> 'cardRarityMost') is not null, false) then
    return shape || '; "cardRarityMost" is not';
  end if;
  if not setting_cron(v -> 'chatterCron') then return shape || '; "chatterCron" is not'; end if;
  if jsonb_typeof(v -> 'strengths') is distinct from 'object' then return shape || '; "strengths" is not'; end if;
  select e into k from jsonb_object_keys(v -> 'strengths') e where e <> all (triggers) limit 1;
  if k is not null then return format('%s; "strengths.%s" is not a trigger', shape, k); end if;
  foreach k in array triggers loop
    if not setting_whole(v -> 'strengths' -> k, 1) then return format('%s; "strengths.%s" is not', shape, k); end if;
  end loop;
  return null;
end $$;

create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
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
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
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
    when 'pool' then setting_pool(v)
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
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;
revoke execute on function setting_pool(jsonb), settings_held() from public, anon, authenticated;
