-- Chattier staff, the migration (docs/plans/2026-11-22-chattier-staff-plan.md; the design is docs/plans/2026-11-22-chattier-staff-design.md).
-- Task 1 writes the settings section; later tasks append their sections below it.
--
-- 1. the settings
--   setting_pool       (0085_staff_notes.sql), holding two more fields: `sessions` (perDay 0 to 8; minutes least and most, whole, 10 to 180, least not above most; waking from and to,
--                      whole UTC hours 0 to 23) and `turns` (waitHours 1 to 168; perThread 1 to 6; perSession from perThread to 12; perDay 0 to 500). Everything else as
--                      0085_staff_notes.sql wrote it. (`create or replace`: it has not been redefined since 0085.)
--   settings_held      (0395_polls.sql), holding `digestConversations`: a whole number from 0 to 12 (DIGEST_MOST.conversations). Everything else as 0395_polls.sql wrote it.
--   Existing rows: this writes no settings row. The release's seed fills them as it filled the fields added before (0355_settings_tuned.sql): `seed_setting` writes the code's value
--   over an untuned `pool` row, and a tuned `pool` row gains the keys it lacks (`jsonb_fill`, nested objects included) with `tuned_at` kept; `digestConversations` is a new key, so its row
--   is inserted. engine/rules/instance.ts (SETTINGS) holds the same rules, and supabase/tests/0079-settings-held.sql lists a poison at each edge.
-- Ways out: no state is added. Masks: a setting is the instance's own number, read by no response that could show a private fact.
--
-- 2. the database (Task 4; plan Task 4, design sections 2, 3, 4 and 7)
--   tables      staff_sessions, pool_kept_picks, pool_turns, pool_answered, staff_points, pool_round_claims, pool_round_days: each append-only by a trigger firing always, no client's, RLS on.
--   functions   apply_meeting (0403_departed_personas.sql) writes the meeting's talking points (section 3 below); claim_pool_round, write_sessions (which also marks the day started), pool_day_started, sessions_awake, sessions_day, keep_pick, kept_picks, pool_waiting,
--               pool_turns_today, write_staff_turn, pool_conversation, pool_record, staff_points_latest: security definer, search_path pinned, the service role's only. pool_waiting_rows, pool_waiting_in_thread and
--               pool_waiting_in_board are the one waiting-reply read in three keys (invoker SQL, so the planner inlines each); staff_rows_append_only is the tables' trigger.
--   presence    presence_listed (0357_post_veils.sql) is not redefined; presence_box (0128_groups.sql, plan settings of 0368_client_reads_plan_once.sql) lists a persona in session itself: in a thread's or a board's box
--               by its own posts since the session began or a reply waiting there, in the index's box by the session alone.
-- Ways out: a session ends at its stated time by itself; a reply waits only waitHours; a kept pick is spent by the day's end; nothing here holds a player.
-- Masks: every read below is of public posts by characters, public reaction totals, staff facts and the instance's settings; none reads who owns a character, a class or who reacted.

-- ===================================================================================== 1. the settings ====
-- setting_pool (0085_staff_notes.sql), holding `sessions` and `turns`. Everything else as 0085_staff_notes.sql wrote it.
create or replace function setting_pool(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  fields text[] := array['weekly', 'holdback', 'threadsWeekly', 'cardRarityMost', 'priorityDays', 'notesRead', 'chatterThreadPosts', 'strengths', 'sessions', 'turns', 'chatterCron'];
  triggers text[] := array['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat'];
  shape text := 'an object giving weekly, priorityDays, notesRead and chatterThreadPosts (whole numbers, at least 1), threadsWeekly (a whole number, at least 0), '
    'holdback (from 0 to 0.5), cardRarityMost (common, uncommon, rare or legendary), strengths (a whole number, at least 1, for each of '
    'named, quoted, legacy, successorStumbles, oldFlame, homeTurf, seasonTurn, hotOnBeat) sessions (perDay, a whole number from 0 to 8; minutes, least and most, whole, from 10 to 180, the least not above the most; waking, from and to, whole UTC hours from 0 to 23), '
    'turns (waitHours, a whole number from 1 to 168; perThread, from 1 to 6; perSession, from perThread to 12; perDay, from 0 to 500) and chatterCron (a five-field cron expression, each field inside its range)';
  k text;
  s jsonb;
  t jsonb;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (fields) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  foreach k in array array['weekly', 'priorityDays', 'notesRead', 'chatterThreadPosts'] loop
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
  -- sessions: exactly perDay, minutes and waking (0407; `sessionsHeld` in engine/rules/instance.ts).
  s := v -> 'sessions';
  if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s)) <> 3
     or not setting_whole(s -> 'perDay', 0, 8)
     or jsonb_typeof(s -> 'minutes') is distinct from 'object' or (select count(*) from jsonb_object_keys(s -> 'minutes')) <> 2
     or not setting_whole(s -> 'minutes' -> 'least', 10, 180) or not setting_whole(s -> 'minutes' -> 'most', 10, 180)
     or (s -> 'minutes' -> 'least') > (s -> 'minutes' -> 'most')
     or jsonb_typeof(s -> 'waking') is distinct from 'object' or (select count(*) from jsonb_object_keys(s -> 'waking')) <> 2
     or not setting_whole(s -> 'waking' -> 'from', 0, 23) or not setting_whole(s -> 'waking' -> 'to', 0, 23) then
    return shape || '; "sessions" is not';
  end if;
  -- turns: exactly waitHours, perThread, perSession and perDay (0407; `turnsHeld` in engine/rules/instance.ts).
  t := v -> 'turns';
  if jsonb_typeof(t) is distinct from 'object' or (select count(*) from jsonb_object_keys(t)) <> 4
     or not setting_whole(t -> 'waitHours', 1, 168) or not setting_whole(t -> 'perThread', 1, 6)
     or not setting_whole(t -> 'perSession', case when setting_whole(t -> 'perThread', 1, 6) then (t ->> 'perThread')::numeric else 1 end, 12) or not setting_whole(t -> 'perDay', 0, 500) then
    return shape || '; "turns" is not';
  end if;
  if jsonb_typeof(v -> 'strengths') is distinct from 'object' then return shape || '; "strengths" is not'; end if;
  select e into k from jsonb_object_keys(v -> 'strengths') e where e <> all (triggers) limit 1;
  if k is not null then return format('%s; "strengths.%s" is not a trigger', shape, k); end if;
  foreach k in array triggers loop
    if not setting_whole(v -> 'strengths' -> k, 1) then return format('%s; "strengths.%s" is not', shape, k); end if;
  end loop;
  return null;
end $$;


-- settings_held (0395_polls.sql), holding `digestConversations`. Everything else as 0395_polls.sql wrote it.
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
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
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
    when 'crowdPayEach' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
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
    -- How many conversations with waiting replies the digest shows a pool persona (0407): a whole number from 0 to 12, as DIGEST_MOST.conversations holds.
    when 'digestConversations' then case when not setting_whole(v, 0, 12) then 'a whole number of conversations, at least 0 and at most 12' end
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
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
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
revoke execute on function setting_pool(jsonb), settings_held() from public, anon, authenticated;

-- ============================================================================================ 2. the database ====

-- ------------------------------------------------------------------------------------------------------ tables ----
-- Each is append-only, as pool_spends is (0089_pool_spends.sql): a trigger refuses an update, a delete and a truncate, firing always (a session in replica mode, as a restore with triggers disabled runs,
-- fires it too), row-level security is on and no client reads or writes one; the service role reaches them through the functions below.

-- A persona's visit on a UTC day: it is awake in [starts_at, ends_at). Written once for the day at its first round (write_sessions), read by every later round and by presence.
create table staff_sessions (
  id bigint generated always as identity primary key,
  day date not null,
  staff text not null references characters (staff),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unique (day, staff, starts_at),
  check (ends_at > starts_at)
);
create index staff_sessions_open on staff_sessions (ends_at, starts_at);

-- The day's pick, kept for its persona's session. Whether it was written is known by its pool_spends row, so nothing here is ever updated.
create table pool_kept_picks (
  id bigint generated always as identity primary key,
  day date not null,
  staff text not null references characters (staff),
  pick jsonb not null,
  at timestamptz not null default now(),
  unique (day, staff)
);

-- A turn: a persona's post in a session that answers a thread's waiting replies. `post_act` is the post, `quoting` the reply it quotes.
create table pool_turns (
  id bigint generated always as identity primary key,
  day date not null,
  staff text not null references characters (staff),
  session bigint not null references staff_sessions (id),
  thread uuid not null references threads (id),
  post_act uuid not null unique references acts (id),
  quoting uuid not null references acts (id),
  at timestamptz not null default now()
);
create index pool_turns_day on pool_turns (day);
create index pool_turns_session_thread on pool_turns (session, thread);
-- A persona's turns in a thread, which is where a thread's heat is read (the public reaction total on them).
create index pool_turns_staff_thread on pool_turns (staff, thread);

-- Each waiting reply a turn answered, so a reply is answered once (the primary key).
create table pool_answered (
  reply uuid primary key references acts (id),
  turn bigint not null references pool_turns (id)
);
create index pool_answered_turn on pool_answered (turn);

-- The talking points the meeting wrote for a persona: one line on the day, read by that persona's calls until the next meeting.
create table staff_points (
  id bigint generated always as identity primary key,
  meeting bigint not null references meetings (id),
  staff text not null references characters (staff),
  line text not null check (char_length(line) between 1 and 200),
  at timestamptz not null default now(),
  unique (meeting, staff)
);
create index staff_points_latest on staff_points (staff, id desc);

-- A round's claim on its slot, taken at the start of the round, so two rounds of one slot never both run (claim_pool_round).
create table pool_round_claims (
  id bigint generated always as identity primary key,
  slot timestamptz not null,
  at timestamptz not null default clock_timestamp(),
  run uuid not null default gen_random_uuid()
);
create index pool_round_claims_slot_at on pool_round_claims (slot, at desc);

-- A UTC day whose first round finished: written by write_sessions, last of the first round's work and in the same transaction as the day's sessions, so the day is marked exactly when its work is done. A round that
-- finds the day unmarked is a first round and does the day's work whole (the draw is deterministic and a second keep or a second write of the same rows is a no-op); a day with no session drawn is marked all the same.
create table pool_round_days (
  day date primary key,
  at timestamptz not null default now()
);

create function staff_rows_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a row of % is never edited or removed (%); every change is a new row', tg_table_name, tg_op using errcode = 'P0001';
end $$;
revoke execute on function staff_rows_append_only() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff_sessions', 'pool_kept_picks', 'pool_turns', 'pool_answered', 'staff_points', 'pool_round_claims', 'pool_round_days'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('create trigger %I before update or delete on %I for each row execute function staff_rows_append_only()', t || '_no_update', t);
    execute format('create trigger %I before truncate on %I for each statement execute function staff_rows_append_only()', t || '_no_truncate', t);
    execute format('alter table %I enable always trigger %I', t, t || '_no_update');
    execute format('alter table %I enable always trigger %I', t, t || '_no_truncate');
  end loop;
end $$;

-- --------------------------------------------------------------------------------------------------- the round ----

-- A round's claim on its slot, as claim_pool_run (0089_pool_spends.sql) claims a day: the run's id, or null when a claim for the slot is younger than the lease. The slot's advisory lock is taken inside, so two
-- claimers are serialized and cannot both win. The way out of a crashed round is time: its claim ages past the lease and the next round of the slot goes ahead.
create function claim_pool_round(slot timestamptz, lease interval default interval '10 minutes') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare made uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb-pool-round:' || slot::text, 0));
  if exists (select 1 from pool_round_claims c where c.slot = claim_pool_round.slot and c.at > clock_timestamp() - lease) then return null; end if;
  insert into pool_round_claims (slot) values (claim_pool_round.slot) returning run into made;
  return made;
end $$;

-- ------------------------------------------------------------------------------------------------- the sessions ----

-- Rerunning is safe because the draw is deterministic (engine/system/sessions.ts, seeded from the day and the persona): a rerun of the day's first round proposes the same rows, which `on conflict do nothing` leaves as they are. A draw that
-- changed between two runs of one day would add sessions beside the first; the unique key is (day, staff, starts_at), not (day, staff).
-- The day's sessions, `rows` being [{staff, start, end}] with `start` and `end` in minutes from 00:00 UTC of `on_day` (what drawSessions draws, engine/system/sessions.ts). A row already there is left as it is, so a rerun of the
-- day's first round writes nothing twice; answers how many sessions the day holds. A staff key that is not a posting persona (a persona in a posting office: not the developer or the stand-in, not benched, not waiting) is refused, and so is a span outside the day.
create function write_sessions(on_day date, rows jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare bad text;
begin
  if jsonb_typeof(rows) is distinct from 'array' then
    raise exception 'the day''s sessions are a list' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select x.staff into bad from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
  where not exists (select 1 from characters c where c.staff = x.staff and c.staff_kind = 'persona') limit 1;
  if found then raise exception '"%" is not a persona that posts', bad using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- A posting persona is one in a posting office: not benched, not waiting (the office write_staff_act refuses).
  select x.staff into bad from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
  where exists (select 1 from staff_office_now o where o.staff = x.staff and o.office in ('waiting', 'benched')) limit 1;
  if found then raise exception '"%" is benched or waiting and keeps no sessions', bad using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if exists (select 1 from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
             where x."start" is null or x."end" is null or x."start" < 0 or x."end" > 1440 or x."end" <= x."start") then
    raise exception 'a session starts and ends inside the day, and ends after it starts' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into staff_sessions (day, staff, starts_at, ends_at)
  select on_day, x.staff, (on_day::timestamp at time zone 'UTC') + x."start" * interval '1 minute', (on_day::timestamp at time zone 'UTC') + x."end" * interval '1 minute'
  from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
  on conflict (day, staff, starts_at) do nothing;
  -- The day's mark, last, in this transaction: a day written with no rows is marked as well.
  insert into pool_round_days (day) values (on_day) on conflict (day) do nothing;
  return (select count(*)::integer from staff_sessions s where s.day = on_day);
end $$;

-- Whether the day's first round has finished (write_sessions marked it).
create function pool_day_started(on_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from pool_round_days d where d.day = on_day)
$$;

-- The sessions open at `at` (starts_at <= at < ends_at), each as {staff, session, spent, spentByThread}: the turns the persona has spent in it in all and in each thread (planTurns reads these).
create function sessions_awake(at timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', s.staff, 'session', s.id,
      'spent', (select count(*) from pool_turns t where t.session = s.id),
      'spentByThread', coalesce((select jsonb_object_agg(g.thread, g.n) from (select t.thread, count(*) as n from pool_turns t where t.session = s.id group by t.thread) g), '{}'::jsonb))
    order by s.starts_at, s.id), '[]'::jsonb)
  from staff_sessions s
  where s.ends_at > sessions_awake.at and s.starts_at <= sessions_awake.at
$$;

-- The day's sessions, [{staff, session, startsAt, endsAt}], for the picks (which persona still has one to come).
create function sessions_day(on_day date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', s.staff, 'session', s.id, 'startsAt', s.starts_at, 'endsAt', s.ends_at) order by s.starts_at, s.id), '[]'::jsonb)
  from staff_sessions s where s.day = on_day
$$;

-- The day's pick for a persona, kept until its session. A second keep for the same day and persona writes nothing (the first is the day's).
create function keep_pick(on_day date, of_staff text, pick jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from characters c where c.staff = of_staff and c.staff_kind = 'persona') then
    raise exception 'there is no persona "%"', of_staff using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into pool_kept_picks (day, staff, pick) values (on_day, of_staff, keep_pick.pick) on conflict (day, staff) do nothing;
end $$;

-- The day's kept picks that are not yet written (no pool_spends row for that day and persona), [{staff, pick}].
create function kept_picks(on_day date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', k.staff, 'pick', k.pick) order by k.id), '[]'::jsonb)
  from pool_kept_picks k
  where k.day = on_day and not exists (select 1 from pool_spends s where s.day = k.day and s.staff = k.staff)
$$;

-- ------------------------------------------------------------------------------------------- the waiting replies ----

-- The replies waiting on a persona: public posts (kind post, not under an author veil) made at or after `since` by a character that is not staff, whose target is a public post of that persona from `since` less the pool's
-- priorityDays, answered by no turn (no pool_answered row), in a thread the persona is not locked out of (locked_out_until, 0402_thread_lockout.sql). One row for each reply: (staff, thread, act, author, at).
-- (The pool setting is read from the settings table, so a database that has none yet reads the defaults, 28 days.) It reads through the persona's own recent posts (acts_character) and, for each, the replies found by the target index (acts_target), never a scan of the window's posts (the newest 200 waiting replies to a post are read, every filter applied before that cap, which also keeps the planner to one index probe for each of the persona's posts, as a join by merge would read every reply there is). A plain invoker SQL function, so the planner
-- inlines it: the query is the plan the test explains, and pool_waiting and the presence view read it as one.
-- The three functions below, pool_waiting_rows, pool_waiting_in_thread and pool_waiting_in_board, are one read and change together: a predicate that makes a reply waiting is edited in all three, and write_staff_turn
-- asks pool_waiting_in_thread for what it may answer, so the three cannot drift apart without a test failing. They are three, not one with optional keys, because each must be a plain inlinable SQL function whose own-posts scan
-- is keyed by a constant (a thread, a board) that the planner sees: with `in_thread is null or ...` in one body, the generic plan presence_box runs under cannot use the thread's index.
create function pool_waiting_rows(staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_rows.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_rows.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_rows.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;
revoke execute on function pool_waiting_rows(text[], timestamptz) from public, anon, authenticated;
grant execute on function pool_waiting_rows(text[], timestamptz) to service_role;

-- The same read keyed by a thread, for a thread's presence box: it starts from the persona's own posts in that thread (acts_thread_posts) and probes the target index from them, so it touches nothing outside the thread.
create function pool_waiting_in_thread(in_thread uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.thread = pool_waiting_in_thread.in_thread
      and p.created_at >= pool_waiting_in_thread.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_thread.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_thread.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;
revoke execute on function pool_waiting_in_thread(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function pool_waiting_in_thread(uuid, text[], timestamptz) to service_role;

-- The same read keyed by a board, for a board's presence box: the persona's own posts in the board's threads only.
create function pool_waiting_in_board(in_board uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    join threads pt on pt.id = p.thread and pt.board = pool_waiting_in_board.in_board
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_in_board.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_board.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_board.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;
revoke execute on function pool_waiting_in_board(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function pool_waiting_in_board(uuid, text[], timestamptz) to service_role;

-- For each persona of `staff_keys`, its threads with waiting replies: [{staff, thread, heat, replies: [{act, author, at}]}], the replies newest last. `heat` is the public reaction total on the persona's turns in that
-- thread, read as pool_signals reads its tallies (reaction_tallies_open, 0358_blind_totals.sql): the totals the crowd sees, never who reacted.
-- Bounded, so a round's read is flat however many players talk: at most 12 threads for a persona (those with the newest waiting reply) and 20 replies in a thread (the newest 20; the others stay waiting for a later round, and a
-- turn answers only what it was shown). Behind it the read is a persona's own posts of the last priorityDays and the newest 200 waiting replies to each, which a persona's few posts a day keep small.
create function pool_waiting(staff_keys text[], since timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', g.staff, 'thread', g.thread,
      'heat', coalesce((select sum(tt.count) from pool_turns t join reaction_tallies_open tt on tt.act = t.post_act where t.staff = g.staff and t.thread = g.thread), 0),
      'replies', g.replies) order by g.staff, g.thread), '[]'::jsonb)
  from (
    select t.staff, t.thread, t.replies
    from (select r.staff, r.thread, jsonb_agg(jsonb_build_object('act', r.act, 'author', r.author, 'at', r.at) order by r.at, r.act) as replies,
                 row_number() over (partition by r.staff order by max(r.at) desc, r.thread) as rank
          from (select w.*, row_number() over (partition by w.staff, w.thread order by w.at desc, w.act desc) as n
                from pool_waiting_rows(staff_keys, since) w) r
          where r.n <= 20 group by r.staff, r.thread) t
    where t.rank <= 12) g
$$;

-- The turns written on a UTC day, instance-wide (the ceiling counts calls and nothing else).
create function pool_turns_today(on_day date) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from pool_turns t where t.day = on_day
$$;

-- A turn, written whole: the post (through write_staff_act, 0402_thread_lockout.sql, so a lockout, a ban or a benched persona refuses exactly as it does there), its pool_turns row and a pool_answered row for each
-- reply it answers, in one transaction. Refuses (writing nothing, hint 'kayfabb.refusal') a session that is not the persona's or not open now, a `quoting` not among `answers`, any answer already answered, and an answer that is not waiting now (not a player's reply to one of the persona's own posts in the thread,
-- or older than the wait, or under an author veil, or in a thread the persona is locked out of). One transaction, so a turn has no orphan: a lost answer is found as answered by the next round.
create function write_staff_turn(staff_key text, in_session bigint, in_thread uuid, quoting uuid, answers uuid[], body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  sess staff_sessions;
  wanted uuid[];
  written jsonb;
  made bigint;
begin
  select c.id into who from characters c where c.staff = staff_key and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', staff_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb-staff-turn:' || staff_key, 0));
  select * into sess from staff_sessions s where s.id = in_session;
  if sess.id is null or sess.staff is distinct from staff_key then
    raise exception 'that session is not %''s', staff_key using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not (sess.starts_at <= now() and now() < sess.ends_at) then
    raise exception 'that session is not open now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select coalesce(array_agg(distinct x), '{}') into wanted from unnest(answers) x;
  if cardinality(wanted) = 0 or write_staff_turn.quoting is null or not (write_staff_turn.quoting = any (wanted)) then
    raise exception 'a turn quotes one of the replies it answers' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A reply is answered once. Two guards: the persona's lock above serializes its turns, so the second of two racing turns finds the first's pool_answered rows here; and pool_answered's primary key (reply) refuses a
  -- duplicate whatever got past this read, rolling the whole turn back.
  if exists (select 1 from pool_answered p where p.reply = any (wanted)) then
    raise exception 'a reply is answered once' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Each answer is waiting now, by the very read that finds waiting replies (pool_waiting_in_thread): a public reply by a character that is not staff to a post of this persona in this thread, within the wait, not under an
  -- author veil, not in a thread the persona is locked out of.
  if (select count(*) from pool_waiting_in_thread(in_thread, array[staff_key], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') w
      where w.act = any (wanted)) is distinct from cardinality(wanted) then
    raise exception 'a turn answers the replies waiting on its own posts in its thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform within('body', body, 'postMaxLength');
  written := write_staff_act(staff_key, 'post', in_thread, write_staff_turn.quoting, jsonb_build_object('body', body));
  insert into pool_turns (day, staff, session, thread, post_act, quoting)
  values (sess.day, staff_key, in_session, in_thread, (written ->> 'id')::uuid, write_staff_turn.quoting) returning id into made;
  insert into pool_answered (reply, turn) select x, made from unnest(wanted) x;
  return jsonb_build_object('turn', made, 'post', written);
end $$;

-- --------------------------------------------------------------------------------------------- what a turn reads ----

-- The persona's conversation in a thread: its newest `most` posts there, oldest first, each with the newest `replies` replies to it (oldest first), every body cut to `chars` as pool_thread cuts (0366_excerpts_and_orders.sql)
-- with `cut` saying so, each reply's author's name and pronouns. What is asked for is clamped (at most 20 posts, 10 replies to a post, 2000 characters), so the read is bounded whatever a caller passes. Public play only (acts_public, characters_public). {posts: [{act, at, body, cut, replies: [{act, author, name, pronouns, at, body, cut}]}]}
create function pool_conversation(staff_key text, in_thread uuid, most integer, replies integer, chars integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('posts', coalesce((
    select jsonb_agg(jsonb_build_object('act', m.id, 'at', m.created_at, 'body', m.body, 'cut', m.cut,
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object('act', r.id, 'author', r.character, 'name', r.name, 'pronouns', r.pronouns, 'at', r.created_at, 'body', r.body, 'cut', r.cut) order by r.created_at, r.id)
          from (select x.id, x.character, x.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
                       left(coalesce(x.current_payload ->> 'body', ''), least(greatest(chars, 1), 2000)) as body,
                       length(coalesce(x.current_payload ->> 'body', '')) > least(greatest(chars, 1), 2000) as cut
                from acts_public x join characters_public c on c.id = x.character
                where x.target_act_id = m.id and x.kind = 'post'
                order by x.created_at desc, x.id desc limit least(greatest(replies, 0), 10)) r), '[]'::jsonb))
      order by m.created_at, m.id)
    from (select a.id, a.created_at, left(coalesce(a.current_payload ->> 'body', ''), least(greatest(chars, 1), 2000)) as body,
                 length(coalesce(a.current_payload ->> 'body', '')) > least(greatest(chars, 1), 2000) as cut
          from acts_public a
          where a.thread = in_thread and a.kind = 'post' and a.character = (select c.id from characters c where c.staff = staff_key)
          order by a.created_at desc, a.id desc limit least(greatest(most, 0), 20)) m), '[]'::jsonb))
$$;

-- Today's public record for a persona's call in a thread: {moves, rules, order}.
--   moves  the moves that landed (open_moves, the handful in force) or ended (move_end) since the slot of the latest meeting that held, at most 10, newest first, each as its public line {act, kind, params, state, at, why}: the
--          move's kind and params and when it landed or ended, never its demand's progress. A move still waiting on admins is no Act yet and is not here (system_digest, 0396_poll_reads.sql, reads the moves the same way).
--   rules  the rules in force on the thread's board (rules_in_force, 0106_mod_moves.sql).
--   order  the persona's standing order when it is a Mod (mod_standing, 0366_excerpts_and_orders.sql), else null.
create function pool_record(in_thread uuid, staff_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with since as (
    select coalesce((select m.slot from meetings m where m.outcome = 'ok' order by m.slot desc limit 1), now() - interval '1 day') as at
  ),
  lines as (
    select a.id as act, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, 'landed'::text as state, a.created_at as at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act, since s where a.created_at >= s.at
    union all
    select a.id, a.payload ->> 'kind', a.payload -> 'params', 'ended', e.created_at, e.payload ->> 'why'
    from acts_public e join acts_public a on a.id = e.target_act_id, since s where e.kind = 'move_end' and e.created_at >= s.at
  ),
  newest as (select l.* from lines l order by l.at desc, l.act limit 10)
  select jsonb_build_object(
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', n.act, 'kind', n.kind, 'params', n.params, 'state', n.state, 'at', n.at, 'why', n.why) order by n.at desc, n.act) from newest n), '[]'::jsonb),
    'rules', rules_in_force((select t.board from threads t where t.id = in_thread)),
    'order', mod_standing(staff_key) -> 'order')
$$;

-- The talking point the latest meeting that held wrote for a persona: its line, or null when that meeting wrote none for it (a persona the meeting leaves out has none that day).
create function staff_points_latest(staff_key text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.line from staff_points p
  where p.staff = staff_key and p.meeting = (select m.id from meetings m where m.outcome = 'ok' order by m.slot desc limit 1)
$$;

revoke execute on function claim_pool_round(timestamptz, interval), write_sessions(date, jsonb), pool_day_started(date), sessions_awake(timestamptz), sessions_day(date), keep_pick(date, text, jsonb), kept_picks(date),
  pool_waiting(text[], timestamptz), pool_turns_today(date), write_staff_turn(text, bigint, uuid, uuid, uuid[], text), pool_conversation(text, uuid, integer, integer, integer),
  pool_record(uuid, text), staff_points_latest(text) from public, anon, authenticated;
grant execute on function claim_pool_round(timestamptz, interval), write_sessions(date, jsonb), pool_day_started(date), sessions_awake(timestamptz), sessions_day(date), keep_pick(date, text, jsonb), kept_picks(date),
  pool_waiting(text[], timestamptz), pool_turns_today(date), write_staff_turn(text, bigint, uuid, uuid, uuid[], text), pool_conversation(text, uuid, integer, integer, integer),
  pool_record(uuid, text), staff_points_latest(text) to service_role;

-- ------------------------------------------------------------------------------------------------- presence ----

-- presence_listed (0357_post_veils.sql) is not redefined: a persona in session is read by presence_box itself, from the persona's own sessions and posts in the place asked about, so a read of one thread or board touches nothing outside it
-- (a third branch of the view would have run the persona's waiting-reply read for every open session on every read, the place filter never reaching it).

-- presence_box (0128_groups.sql; the plan cache and jit settings 0368_client_reads_plan_once.sql gave it kept), listing a staff persona that is in session (a session open now, the persona in a posting office): in a thread's
-- box when it posted there since the session began or has a reply waiting there (pool_waiting_in_thread), in a board's box likewise (pool_waiting_in_board), and in the index's box by the session alone, with no waiting read. The index
-- adds the personas in session to the players' names rather than counting them among the capped ones, so "others" is what the players alone make it. Everything else as 0128_groups.sql wrote it.
create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
declare
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
  wait interval := coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour';
  at_board uuid;
  shown jsonb;
  total integer;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- The box, read by one statement per kind of place (0041). A board's box reads a staff character's rows (one per thread it posted in)
  -- as one name; the index lists a staff character only while it is in session. A thread's box also lists a Mod on an open visit in it, once.
  if in_kind = 'thread' then
    with seen as (
      select l.id, l.name, l.staff, l.place_since, null::integer as visit_post from presence_listed l
      where l.place = in_place and l.seen_at >= now() - win
      union all
      select m.id, m.name, true, v.created_at, p.seq
      from acts v
      join visits_open o on o.visit_act = v.id
      join acts p on p.id = o.post
      join characters m on m.id = v.character
      where v.kind = 'visit' and v.thread = in_place and m.staff is not null and m.staff_kind is distinct from 'developer' and m.debuted_at is not null and m.retired_at is null
      union all
      select c.id, c.name, true, s.starts_at, null::integer
      from staff_sessions s
      join characters c on c.staff = s.staff and c.staff_kind = 'persona' and c.debuted_at is not null and c.retired_at is null
      where s.starts_at <= now() and now() < s.ends_at and not exists (select 1 from staff_office_now o where o.staff = s.staff and o.office in ('waiting', 'benched'))
        and (exists (select 1 from acts_public x where x.thread = in_place and x.character = c.id and x.kind = 'post' and x.created_at >= s.starts_at)
             or exists (select 1 from pool_waiting_in_thread(in_place, array[s.staff], now() - wait) w))),
    one as (
      select s.id, s.name, bool_or(s.staff) as staff, min(s.place_since) as place_since, min(s.visit_post) as visit_post from seen s group by s.id, s.name),
    f as (select * from one order by one.place_since, one.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id), 'group', group_now(f.id))
                                      || case when f.visit_post is not null then jsonb_build_object('visit_post', f.visit_post) else '{}'::jsonb end
                                      order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from one)
      into shown, total;
  elsif in_kind = 'board' then
    with b0 as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff
      union all
      select c.id, c.name, true, s.starts_at
      from staff_sessions s
      join characters c on c.staff = s.staff and c.staff_kind = 'persona' and c.debuted_at is not null and c.retired_at is null
      where s.starts_at <= now() and now() < s.ends_at and not exists (select 1 from staff_office_now o where o.staff = s.staff and o.office in ('waiting', 'benched'))
        and (exists (select 1 from acts_public x join threads xt on xt.id = x.thread where xt.board = in_place and x.character = c.id and x.kind = 'post' and x.created_at >= s.starts_at)
             or exists (select 1 from pool_waiting_in_board(in_place, array[s.staff], now() - wait) w))),
    b as (select x.id, x.name, bool_or(x.staff) as staff, min(x.place_since) as place_since from b0 x group by x.id, x.name),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id), 'group', group_now(f.id)) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    -- The players, capped; and every persona in session beside them, outside the cap, once however many threads it is on. `total` is the players plus the personas shown, so "others" counts players alone.
    with f as (
      select l.id, l.name, false as staff, l.online_since from presence_listed l
      where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap),
    g as (
      select c.id, c.name, true as staff, min(s.starts_at) as online_since
      from staff_sessions s
      join characters c on c.staff = s.staff and c.staff_kind = 'persona' and c.debuted_at is not null and c.retired_at is null
      where s.starts_at <= now() and now() < s.ends_at and not exists (select 1 from staff_office_now o where o.staff = s.staff and o.office in ('waiting', 'benched'))
      group by c.id, c.name),
    u as (select * from f union all select * from g)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'staff', u.staff, 'banned_until', banned_until(u.id), 'group', group_now(u.id)) order by u.online_since, u.id), '[]'::jsonb) from u),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win) + (select count(*) from g)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;
revoke execute on function presence_box(text, uuid) from public, anon;
grant execute on function presence_box(text, uuid) to authenticated;

-- ===================================================================================== 3. the meeting's talking points ====
-- apply_meeting (0403_departed_personas.sql), writing the talking points: each `payload.points` entry {staff, line} is a staff_points row of the meeting, in the same transaction as its orders (the plan's Task 5, the design's
-- section 4). Everything else as 0403_departed_personas.sql wrote it.
create or replace function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  bal2 numeric;
  cap numeric := (payload ->> 'bank_cap')::numeric;
  returned numeric := 0;
  spent integer;
  handed integer := 0;
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  inh jsonb;
  due record;
  kind_row move_kinds%rowtype;
  live timestamptz;
  kept integer := 0;
  ended_n integer := 0;
  skipped integer := 0;
  nominated boolean := false;
  act_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  kept_moves jsonb := '[]';
  rules_skipped jsonb := '[]';
  machine_skipped jsonb := '[]';
  lasting_skipped jsonb := '[]';
  mlive timestamptz;
  mhours numeric;
  problem text;
  idx integer := 0;
  ord jsonb;
  planned jsonb := '[]';
  most integer;
  who text;
  bs uuid[];
  b text;
  bid uuid;
  claimed uuid[] := '{}';
  asked numeric;
  amount integer;
  line text;
  mod_memory jsonb;
  orders_skipped integer := 0;
  clamped integer := 0;
  trimmed integer := 0;
  planned_mods text[] := '{}';
  prev staff_orders%rowtype;
  at_order integer;
  room integer;
  check_at timestamptz;
  pat jsonb;
  pat_at timestamptz;
  pat_most integer;
  pat_n integer := 0;
  pat_skipped integer := 0;
  -- The season the meeting was held in, which is not the open one when the season turned between the meeting and this apply: the beat's events and the kinds it holds back are that season's.
  season_id bigint := coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null));
  held text[] := held_back_kinds(boss, coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null)));
  beats_played text[] := '{}';
  held_skipped jsonb := '[]';
  bundles_skipped jsonb := '[]';
  bnd jsonb;
  bpart jsonb;
  bidx integer := 0;
  bundle_id uuid;
  authored boolean;
  parts_n integer;
  charged integer;
  queued_n integer := 0;
  authored_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleAuthoredMostParts'), 8);
  composed_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleMostParts'), 4);
  hf_farewell text := nullif(btrim(coalesce(payload ->> 'farewell', ''), E' \t\n\r\f\v'), '');
  hf_note text := nullif(btrim(coalesce(payload ->> 'handoff', ''), E' \t\n\r\f\v'), '');
  hf_post_most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  hf_trims jsonb := '[]';
  hf_skipped jsonb := '[]';
  pt jsonb;
  pt_line text;
  pt_n integer := 0;
  pt_skipped integer := 0;
  pt_trimmed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || apply_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = apply_meeting.meeting) then
    raise exception 'there is no meeting %', apply_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = apply_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already applied', 'meeting', apply_meeting.meeting);
  end if;
  if boss is null or boss is distinct from current_boss() then
    raise exception 'a meeting is the open season''s Boss''s; % is not (%)', boss, current_boss() using errcode = '22023';
  end if;
  if hold is null then raise exception 'a meeting needs structuralHoldHours, which this instance does not set' using errcode = '22023'; end if;
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;
  -- The one lock order, before the first write: a lasting move queued, or a lasting move ended by an inheritance decision, writes places, and the Acts this answer writes (a move_keep, a move_end) are rows an
  -- admin's reversal waits for after it holds the key.
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) i where jsonb_typeof(i.value) = 'object')
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'moves') = 'array' then payload -> 'moves' else '[]'::jsonb end) m
                join move_kinds k on k.key = m.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) b,
                     jsonb_array_elements(case when jsonb_typeof(b.value -> 'parts') = 'array' then b.value -> 'parts' else '[]'::jsonb end) p
                join move_kinds k on k.key = p.value ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- The moves: a kind outside the catalog raises; a rule the queue would refuse is skipped and recorded, and costs nothing.
  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    idx := idx + 1;
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    -- A kind the Boss does not use yet (its persona holds it back until a beat unlocks, 0333) is skipped and recorded, and costs nothing: the engine drops it too, and the database holds the line.
    if kind_row.key = any (held) then
      held_skipped := held_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind_row.key));
      continue;
    end if;
    if kind_row.key = 'setRule' then
      problem := rule_params_problem(mv -> 'params');
      if problem is null then
        problem := rule_conflict(nullif(mv #>> '{params,board}', '')::uuid, mv #>> '{params,predicate}', nullif(mv #> '{params,param}', 'null'::jsonb));
      end if;
      if problem is not null then
        rules_skipped := rules_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- A machine move the queue's guard would refuse for its params, its demand or its bounds (the guard's own predicate, machine_move_problem without the machine as it is
    -- at landing) is skipped and recorded, and costs nothing: one bad machine move never fails the whole answer, as a bad rule does not.
    if kind_row.key in ('pullSlot', 'repriceSlot', 'flashSale') then
      problem := null;
      begin
        mlive := greatest((mv ->> 'go_live_at')::timestamptz, now());
        mhours := case when jsonb_typeof(mv -> 'expires_in_hours') = 'number' then (mv ->> 'expires_in_hours')::numeric end;
        problem := machine_move_problem(kind_row.key,
          case when jsonb_typeof(mv #> '{params,slot}') = 'string' then jsonb_set(mv -> 'params', '{slot}', to_jsonb(lower(mv #>> '{params,slot}'))) else mv -> 'params' end,
          mv -> 'demand', mlive, case when mhours is not null then mlive + mhours * interval '1 hour' end, false);
        if problem is null and mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then
          if not exists (select 1 from demand_kinds d where d.key = mv #>> '{demand,kind}') then problem := 'there is no such demand kind';
          else problem := demand_params_problem(mv -> 'demand'); end if;
        end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        machine_skipped := machine_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- The three lasting board moves the queue would refuse (what they name is not there, a board is closed, a merge would make a cycle, a demand a lasting move cannot carry) are skipped
    -- and recorded, and cost nothing, as a machine move is: one bad one never fails the whole answer.
    if kind_row.key in ('createBoard', 'moveThread', 'mergeBoard') then
      problem := null;
      begin
        if mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then problem := 'a lasting move carries no demand';
        else problem := lasting_move_problem(kind_row.key, mv -> 'params'); end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        lasting_skipped := lasting_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    kept_moves := kept_moves || jsonb_build_array(mv);
  end loop;
  spent := jsonb_array_length(kept_moves);

  -- The orders: validated into a plan, so nothing is written before the bank has agreed.
  if jsonb_typeof(payload -> 'orders') = 'array' and jsonb_array_length(payload -> 'orders') > 0 then
    most := (setting('modBots') ->> 'allowanceMost')::integer;
    if most is null then raise exception 'orders need the setting modBots, which this instance does not set' using errcode = '22023'; end if;
    for ord in select value from jsonb_array_elements(payload -> 'orders') loop
      who := ord ->> 'mod';
      if jsonb_typeof(ord) is distinct from 'object' or who is null or who = any (planned_mods) or not exists (select 1 from staff_now n where n.staff = who) then
        orders_skipped := orders_skipped + 1;
        continue;
      end if;
      bs := '{}';
      for b in select t.v from jsonb_array_elements_text(case when jsonb_typeof(ord -> 'boards') = 'array' then ord -> 'boards' else '[]'::jsonb end) with ordinality t(v, n) order by t.n loop
        if b ~* uuid_re then
          bid := lower(b)::uuid;
          if exists (select 1 from boards x where x.id = bid and not x.is_system) and bid <> all (claimed) and bid <> all (bs) then bs := bs || bid; end if;
        end if;
      end loop;
      claimed := claimed || bs;
      asked := case when jsonb_typeof(ord -> 'allowance') = 'number' then floor((ord ->> 'allowance')::numeric) else 0 end;
      amount := greatest(0, least(asked, most));
      if amount is distinct from asked then clamped := clamped + 1; end if;
      line := left(btrim(coalesce(ord ->> 'order', ''), E' \t\n\r\f\v'), 200);
      -- A blank line is no instruction: the Mod keeps the one it had.
      if line = '' then line := coalesce((select x.order_line from staff_orders x where x.staff = who order by x.id desc limit 1), ''); end if;
      mod_memory := case when jsonb_typeof(ord -> 'memory') = 'object' then jsonb_set(jsonb_set(ord -> 'memory', '{opinions}', public_entries(ord #> '{memory,opinions}')), '{grudges}', public_entries(ord #> '{memory,grudges}')) end;
      planned := planned || jsonb_build_array(jsonb_build_object('mod', who, 'boards', to_jsonb(bs), 'order', line, 'allowance', amount, 'memory', mod_memory));
      planned_mods := planned_mods || who;
      handed := handed + amount;
    end loop;
  end if;

  -- What the Mods did not spend goes back, never above the cap: one lock per persona with an order, in key order, so a Mod's move queued at the same
  -- moment is either counted here or counted against the new order, never both and never neither.
  for who in select distinct o.staff from staff_orders o order by o.staff loop
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || who, 0));
    returned := returned + order_unspent(who);
  end loop;
  -- What was added is what the cap allowed, and that is what is recorded.
  bal2 := least(cap, bal + returned);
  returned := greatest(0, bal2 - bal);
  -- The Boss's own moves are its own: they must be paid, else this raises, as it always has. The allowances are what is left. A Mod that queued between the
  -- meeting's read and this apply spent some of what the answer counted on; the answer is not failed for it: the allowances are trimmed from the last
  -- order backward to the bank, and the trims are recorded.
  -- The bundles (fangame split design, sections 2, 5 and 9), each all or nothing: its parts are queued under one bundle id and one name, in the order sent (a role names an earlier part), and a
  -- beat's bundle writes `played` with it. An authored bundle (it names a beat of this Boss's that is unlocked and unplayed) costs the bank nothing; a bundle of the Boss's own costs one move a part
  -- and holds at most bundleMostParts, none of a kind held back. A beat with no bundle has no parts and is played by being named. A bundle the queue would refuse (the guard raises), a beat
  -- that is not unlocked and a bank that cannot pay are each skipped and recorded, with the reason: one bad bundle never fails the whole answer. The guard still holds every part.
  for bnd in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) loop
    bidx := bidx + 1;
    begin
      if jsonb_typeof(bnd) is distinct from 'object' or jsonb_typeof(bnd -> 'parts') is distinct from 'array' then
        raise exception 'a bundle is {name, beat, parts}' using errcode = '22023';
      end if;
      authored := jsonb_typeof(bnd -> 'beat') = 'string';
      parts_n := jsonb_array_length(bnd -> 'parts');
      if authored then
        if not exists (select 1 from persona_arcs a, jsonb_array_elements(a.beats) b where a.staff = boss and b.value ->> 'key' = bnd ->> 'beat') then
          raise exception 'the beat "%" is not this Boss''s', bnd ->> 'beat' using errcode = '22023';
        end if;
        if arc_latest_states(boss, season_id) ->> (bnd ->> 'beat') is distinct from 'unlocked' then
          raise exception 'the beat "%" is not unlocked, or has been played', bnd ->> 'beat' using errcode = '22023';
        end if;
        if parts_n > authored_most then raise exception 'an authored bundle holds at most % parts', authored_most using errcode = '22023'; end if;
        charged := 0;
      else
        if parts_n < 1 then raise exception 'a bundle of the Boss''s own has at least one part' using errcode = '22023'; end if;
        if parts_n > composed_most then raise exception 'a bundle of the Boss''s own holds at most % parts', composed_most using errcode = '22023'; end if;
        if spent + parts_n > floor(bal2) then raise exception 'the bank cannot pay for % parts', parts_n using errcode = '23514'; end if;
        charged := parts_n;
      end if;
      if parts_n > 0 and btrim(coalesce(bnd ->> 'name', '')) = '' then raise exception 'a bundle has a name' using errcode = '22023'; end if;
      bundle_id := case when parts_n > 0 then gen_random_uuid() end;
      for bpart in select value from jsonb_array_elements(bnd -> 'parts') loop
        select * into kind_row from move_kinds k where k.key = bpart ->> 'kind';
        if not found then raise exception 'there is no move kind "%"', bpart ->> 'kind' using errcode = '23514'; end if;
        if not authored and kind_row.key = any (held) then raise exception 'the kind % is held back', kind_row.key using errcode = '23514'; end if;
        live := greatest((bpart ->> 'go_live_at')::timestamptz, now());
        if kind_row.structural then live := greatest(live, now() + hold); end if;
        insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
        values (apply_meeting.meeting, boss, kind_row.key, bpart -> 'params', bpart -> 'demand', bpart ->> 'why', live,
          live + coalesce((bpart ->> 'expires_in_hours')::numeric, 0) * interval '1 hour', kind_row.structural, bundle_id, left(bnd ->> 'name', 120), nullif(bpart ->> 'role', ''));
      end loop;
      if authored then
        insert into arc_beat_events (season, staff, beat, event, bundle) values (season_id, boss, bnd ->> 'beat', 'played', bundle_id);
        beats_played := beats_played || (bnd ->> 'beat');
      end if;
      spent := spent + charged;
      queued_n := queued_n + parts_n;
    exception when others then
      bundles_skipped := bundles_skipped || jsonb_build_array(jsonb_build_object('index', bidx - 1, 'name', bnd ->> 'name', 'why', left(sqlerrm, 300)));
    end;
  end loop;

  if spent > floor(bal2) then
    raise exception 'the moves cost % and the bank holds %', spent, bal2 using errcode = '23514';
  end if;
  room := floor(bal2)::integer - spent;
  at_order := jsonb_array_length(planned);
  while handed > room and at_order > 0 loop
    amount := (planned -> (at_order - 1) ->> 'allowance')::integer;
    if amount > 0 then
      asked := least(amount, handed - room);
      planned := jsonb_set(planned, array[(at_order - 1)::text, 'allowance'], to_jsonb(amount - asked::integer));
      handed := handed - asked::integer;
      trimmed := trimmed + 1;
    end if;
    at_order := at_order - 1;
  end loop;

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent. The
  -- memory is written only when it came.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
    insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  end if;
  if jsonb_typeof(payload -> 'profile') = 'object' then
    insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
    values (boss, apply_meeting.meeting,
      array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
      array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
        where f.id in (select c.id from characters_public c) order by f.ord),
      coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));
  end if;

  for mv in select value from jsonb_array_elements(kept_moves) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    -- A favor's check must fall between its go-live and its expiry as the queue lands them; the answer set it from the meeting's clock, so one that no longer does is
    -- moved to half the favor's life from its go-live.
    if kind_row.key = 'conferGroup' and mv #> '{params,checkAt}' is not null then
      begin
        check_at := (mv #>> '{params,checkAt}')::timestamptz;
      exception when others then
        check_at := null;
      end;
      if check_at is null or check_at <= live or check_at >= live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour') then
        mv := jsonb_set(mv, '{params,checkAt}', to_jsonb(to_char((live + ((mv ->> 'expires_in_hours')::numeric * interval '30 minutes')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      end if;
    end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural);
  end loop;

  -- The successor: queued beside the moves, not among them, and not charged to the bank.
  if jsonb_typeof(payload -> 'successor') = 'object' then
    select * into kind_row from move_kinds k where k.key = 'nameSuccessor';
    if found and jsonb_typeof(payload #> '{successor,boss}') = 'string' and (payload #>> '{successor,boss}') = any (boss_roster()) and (payload #>> '{successor,boss}') <> boss then
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
      values (apply_meeting.meeting, boss, 'nameSuccessor', jsonb_build_object('boss', payload #>> '{successor,boss}'), null,
        left(coalesce(nullif(payload #>> '{successor,why}', ''), 'No reason given.'), 200), now() + hold, null, kind_row.structural);
      nominated := true;
    else
      skipped := skipped + 1;
    end if;
  end if;

  -- The inheritance review: what the answer names must be among the moves due now; the rest is dropped. Each is answered at most once.
  for inh in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) loop
    act_id := case when (inh ->> 'move_act') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (inh ->> 'move_act')::uuid end;
    select * into due from inheritance_due(boss, 100) d where d.act = act_id;
    -- An answer with no decision (null in the test) is no decision: skipped, never read as "end".
    if act_id is null or not found or not coalesce((inh ->> 'decision') in ('keep', 'end'), false) then
      skipped := skipped + 1;
    elsif inh ->> 'decision' = 'keep' then
      perform write_staff_act(boss, 'move_keep', due.thread, due.act, '{}'::jsonb);
      kept := kept + 1;
    elsif inh ->> 'decision' = 'end' then
      if (end_move(due.act, 'superseded', 'boss') ->> 'ended')::boolean then perform say_move_end(due.act, 'superseded'); ended_n := ended_n + 1; end if;
    end if;
  end loop;

  -- The farewell and the handoff (0337), kept only from a meeting within farewellWindowHours of the season's end: the engine's repair already dropped them from any other, and the database holds
  -- the same line. Each is trimmed to its bound (the farewell to postMaxLength, the note to 2000) and the trim is recorded, never a lost answer. A blank one is none; a meeting that gives neither
  -- writes no row, so an earlier meeting's words are not displaced by silence. A new row is the latest of its season, and the ones before it stay.
  if hf_farewell is not null or hf_note is not null then
    if not in_farewell_window() then
      hf_skipped := jsonb_build_array(jsonb_build_object('why', 'inFarewellWindow'));
    else
      if hf_farewell is not null and hf_post_most is not null and char_length(hf_farewell) > hf_post_most then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'farewell', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(hf_farewell), 'after', hf_post_most));
        hf_farewell := left(hf_farewell, hf_post_most);
      end if;
      if hf_note is not null and char_length(hf_note) > 2000 then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'handoff', 'predicate', 'maxLength(2000)', 'before', char_length(hf_note), 'after', 2000));
        hf_note := left(hf_note, 2000);
      end if;
      -- What this meeting leaves out stands as the latest row had it: a later meeting that writes only a note does not take the farewell back, nor one that writes only a farewell the note.
      insert into handoffs (season, staff, meeting, farewell, note)
      select season_id, boss, apply_meeting.meeting, coalesce(hf_farewell, x.farewell), coalesce(hf_note, x.note, '')
      from (select 1) one left join handoffs_latest x on x.season = season_id and x.staff = boss;
    end if;
  end if;

  -- An answer that left a persona with an order out carries it forward only while the persona is on staff (staff_now: an order ends with the office, the
  -- excerpts-and-orders design, section 2): its beat (less what another order claimed) and its line, with an allowance of 0, because what it had was returned above.
  -- A persona off staff (a Boss, or a Mod moved off) is carried nothing: if its latest row still holds a line, a beat or an allowance, one blank row with 0 ends it (the allowance is
  -- returned above once, and a Mod that comes back has no order until a meeting gives it one), and once the latest row is blank no row is written. After this meeting every
  -- persona on staff with an order has its latest from it.
  for ord in select value from jsonb_array_elements(planned) loop
    insert into staff_orders (meeting, staff, boards, order_line, allowance)
    values (apply_meeting.meeting, ord ->> 'mod', array(select jsonb_array_elements_text(ord -> 'boards'))::uuid[], ord ->> 'order', (ord ->> 'allowance')::integer);
    if jsonb_typeof(ord -> 'memory') = 'object' then
      insert into staff_memory (staff, meeting, body) values (ord ->> 'mod', apply_meeting.meeting, ord -> 'memory');
    end if;
  end loop;
  for who in
    select distinct o.staff from staff_orders o
    where o.meeting <> apply_meeting.meeting and o.staff <> all (planned_mods) order by o.staff
  loop
    select * into prev from staff_orders o where o.staff = who and o.meeting <> apply_meeting.meeting order by o.id desc limit 1;
    if exists (select 1 from staff_now n where n.staff = who) then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, array(select x from unnest(prev.boards) x where x <> all (claimed)), prev.order_line, 0);
    elsif prev.order_line <> '' or prev.allowance > 0 or prev.boards <> '{}' then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, '{}', '', 0);
    end if;
  end loop;

  -- The patrols the answer scheduled, kept on the meeting record by meet/core.ts (its repair already dropped a Mod off staff, moved a time into today and cut them to
  -- patrolsPerDay); the database holds the same line whatever the caller sent. Written once with the meeting: a retry finds the meeting closed above, and (meeting, n) is
  -- unique besides.
  pat_most := coalesce((select (s.value ->> 'patrolsPerDay')::integer from settings s where s.key = 'modBots'), 0);
  if jsonb_typeof(payload #> '{record,patrols}') = 'array' then
    for pat in select value from jsonb_array_elements(payload #> '{record,patrols}') loop
      if pat_n >= pat_most then pat_skipped := pat_skipped + 1; continue; end if;
      pat_at := null;
      begin
        pat_at := (pat ->> 'at')::timestamptz;
      exception when others then pat_at := null;
      end;
      if jsonb_typeof(pat) is distinct from 'object' or pat_at is null or jsonb_typeof(pat -> 'mod') is distinct from 'string'
         or not exists (select 1 from staff_now n where n.staff = pat ->> 'mod') then
        pat_skipped := pat_skipped + 1;
        continue;
      end if;
      pat_n := pat_n + 1;
      insert into patrols (meeting, n, staff, at)
      values (apply_meeting.meeting, pat_n, pat ->> 'mod', least(greatest(pat_at, now()), now() + interval '24 hours'))
      on conflict on constraint patrols_meeting_n_key do nothing;
    end loop;
  end if;

  -- The talking points the answer wrote (meet/core.ts repaired them: a persona that posts, once each, a line cut at a word to 200 characters, a blank one dropped); the database holds the same line whatever the caller sent. A key
  -- that is not a persona in a posting office (the Boss, a Mod or a member: not benched, not waiting), a second line for one key, a blank line and anything that is not an object are skipped and counted; a line over 200
  -- characters is cut and counted. They are written with the orders in this transaction, once: a retry finds the meeting closed above, and (meeting, staff) is unique besides.
  if jsonb_typeof(payload -> 'points') = 'array' then
    for pt in select value from jsonb_array_elements(payload -> 'points') loop
      pt_line := case when jsonb_typeof(pt) = 'object' and jsonb_typeof(pt -> 'line') = 'string' then nullif(btrim(pt ->> 'line', E' \t\n\r\f\v'), '') end;
      if pt_line is null or jsonb_typeof(pt -> 'staff') is distinct from 'string'
         or not exists (select 1 from staff_office_now o where o.staff = pt ->> 'staff' and o.office in ('boss', 'mod', 'member')) then
        pt_skipped := pt_skipped + 1;
        continue;
      end if;
      if char_length(pt_line) > 200 then pt_line := left(pt_line, 200); pt_trimmed := pt_trimmed + 1; end if;
      insert into staff_points (meeting, staff, line) values (apply_meeting.meeting, pt ->> 'staff', pt_line) on conflict on constraint staff_points_meeting_staff_key do nothing;
      if found then pt_n := pt_n + 1; else pt_skipped := pt_skipped + 1; end if;
    end loop;
  end if;

  insert into move_bank (staff, balance, as_of) values (boss, bal2 - spent - handed, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal2 - spent - handed,
    coalesce(payload -> 'record', '{}') || jsonb_build_object(
      'handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated),
      'allowances', jsonb_build_object('returned', returned, 'handed', handed, 'orders', jsonb_array_length(planned), 'skipped', orders_skipped, 'clamped', clamped, 'trimmed', trimmed),
      'rulesSkipped', rules_skipped,
      'machineSkipped', machine_skipped,
      'lastingSkipped', lasting_skipped,
      -- What was actually played (0335): the engine's `beatsDefaulted` and its `playedWithDefaults` trims say what it meant to play, and are kept only for the beats this transaction played.
      'beatsPlayed', to_jsonb(beats_played),
      'beatsDefaulted', coalesce((select jsonb_agg(d.k) from jsonb_array_elements_text(case when jsonb_typeof(payload #> '{record,beatsDefaulted}') = 'array' then payload #> '{record,beatsDefaulted}' else '[]'::jsonb end) d(k) where d.k = any (beats_played)), '[]'::jsonb),
      'trims', coalesce((select jsonb_agg(x.t order by x.n) from jsonb_array_elements(case when jsonb_typeof(payload #> '{record,trims}') = 'array' then payload #> '{record,trims}' else '[]'::jsonb end) with ordinality x(t, n)
                         where not (x.t ->> 'predicate' = 'playedWithDefaults' and not ((regexp_replace(coalesce(x.t ->> 'path', ''), '^beats\.', '')) = any (beats_played)))), '[]'::jsonb),
      'heldBackSkipped', held_skipped,
      'bundlesSkipped', bundles_skipped,
      'handoffTrims', hf_trims,
      'handoffSkipped', hf_skipped,
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped),
      'pointsWritten', jsonb_build_object('written', pt_n, 'skipped', pt_skipped, 'trimmed', pt_trimmed)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', jsonb_array_length(kept_moves) + queued_n, 'beats_played', to_jsonb(beats_played), 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed);
end $$;
revoke execute on function apply_meeting(bigint, jsonb) from public, anon, authenticated;
grant execute on function apply_meeting(bigint, jsonb) to service_role;

-- ===================================================================================== 4. the digest's conversations ====
-- system_digest (0396_poll_reads.sql), also returning `conversations`: the window's top conversations, each a persona's turns in one thread (pool_turns), ranked by the public reaction total on the turns then by their number and
-- cut to the setting `digestConversations` (6 where an instance has none); each names the thread, the persona, the public characters whose replies the turns answered (pool_answered; at most 8), the turns, the reactions and the hottest
-- turn with the reply it quoted, cut to `digestExcerptChars`. The characters it names join `characters`. Public posts and public reaction totals only: no owner, class or reactor. The role reads the two tables, selecting only (a grant and a select policy on each, as 0045 gave its other reads).
-- Everything else as 0396 wrote it (owner and grants kept; the grants are stated again below).
grant select on pool_turns, pool_answered to kayfabb_digest;
create policy digest_reads on pool_turns for select to kayfabb_digest using (true);
create policy digest_reads on pool_answered for select to kayfabb_digest using (true);
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  conv_cap integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  -- The conversations' setting (0407): an instance seeded before it reads the default of 6.
  begin conv_cap := (setting('digestConversations'))::integer; exception when no_data_found then conv_cap := 6; end;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt,
           coalesce(length(p.current_payload ->> 'body') > chars, false) as cut
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, reaction_quadrant(t.act, t.kind) as quadrant, sum(t.count)::integer as n
    from w join reaction_tallies_open t on t.act = w.id
    group by w.thread, reaction_quadrant(t.act, t.kind)
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies_open t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.cut, w.created_at
    from w left join reaction_tallies_open t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.cut, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies_open t on t.act = a.id
    where mm.dkind = 'quadrantOnBoard' and reaction_quadrant(t.act, t.kind) = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  -- The conversations (0407): a persona's turns in one thread over the window, from pool_turns, each turn's post read through acts_public (a removed post is not a turn the digest shows) and its reactions the public
  -- total, as an excerpt's are. Ranked by the reactions, then the turns, then the thread and persona; cut to the setting. The persona is read through characters_public, so one that never debuted is not listed.
  turn_r as (
    select t.id as turn, t.thread, t.staff, t.at, t.post_act, t.quoting,
           (select coalesce(sum(rt.count), 0)::integer from reaction_tallies_open rt where rt.act = t.post_act) as reactions
    from pool_turns t join acts_public pa on pa.id = t.post_act
    -- `day` is the UTC day of the session a turn belongs to, which began no later than the turn; the day bounds (a day wider before, for a session that ran past midnight) let the (day) index serve the read, the `at` bounds make it exact.
    where t.day >= (since at time zone 'UTC')::date - 1 and t.day <= (until at time zone 'UTC')::date and t.at >= since and t.at < until
  ),
  conv as (
    select g.thread, g.staff, g.turns, g.reactions, left(tl.title, 120) as title, cp.id as persona
    from (select tr.thread, tr.staff, count(*)::integer as turns, sum(tr.reactions)::integer as reactions from turn_r tr group by tr.thread, tr.staff) g
    join thread_list tl on tl.id = g.thread
    join characters_public cp on cp.staff = g.staff
    order by g.reactions desc, g.turns desc, g.thread, g.staff
    limit conv_cap
  ),
  -- Who a conversation answered: the public authors of the replies its turns answered (pool_answered), the most answered first, at most 8.
  conv_with as (
    select x.thread, x.staff, x.character, x.name
    from (
      select c.thread, c.staff, r.character, cp.name, row_number() over (partition by c.thread, c.staff order by count(*) desc, r.character) as rn
      from conv c
      join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
      join pool_answered pan on pan.turn = tr.turn
      join acts_public r on r.id = pan.reply
      join characters_public cp on cp.id = r.character
      group by c.thread, c.staff, r.character, cp.name
    ) x
    where x.rn <= 8
  ),
  -- The hottest exchange: the turn the crowd reacted to most (the later one on a tie) and the reply it quoted, each cut to the excerpt setting.
  conv_best as (
    select distinct on (c.thread, c.staff) c.thread, c.staff,
           left(pa.current_payload ->> 'body', chars) as turn_text, coalesce(length(pa.current_payload ->> 'body') > chars, false) as turn_cut,
           q.character as reply_by, left(q.current_payload ->> 'body', chars) as reply_text, coalesce(length(q.current_payload ->> 'body') > chars, false) as reply_cut
    from conv c
    join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
    join acts_public pa on pa.id = tr.post_act
    join acts_public q on q.id = tr.quoting and q.character is not null
    order by c.thread, c.staff, tr.reactions desc, tr.at desc, tr.turn desc
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
    union select persona from conv union select character from conv_with union select reply_by from conv_best
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt, 'cut', e.cut)
                          || coalesce((select jsonb_build_object('poll', jsonb_build_object('question', p.payload ->> 'question',
                                         'options', (select coalesce(jsonb_agg(jsonb_build_object('text', o.t, 'count', coalesce(c.counts[o.n::integer], 0)) order by o.n), '[]'::jsonb)
                                                     from jsonb_array_elements_text(p.payload -> 'options') with ordinality o(t, n)),
                                         'closed', c.closed))
                                       from (select a.id, a.payload from acts_public a where a.kind = 'poll' and a.target_act_id = e.act order by a.created_at desc, a.id desc limit 1) p
                                       join poll_counts c on c.poll = p.id), '{}'::jsonb)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object('thread', c.thread, 'title', c.title, 'persona', jsonb_build_object('staff', c.staff, 'character', c.persona),
                          'with', coalesce((select jsonb_agg(jsonb_build_object('id', w.character, 'name', w.name) order by w.name, w.character) from conv_with w where w.thread = c.thread and w.staff = c.staff), '[]'::jsonb),
                          'turns', c.turns, 'reactions', c.reactions,
                          'exchange', (select jsonb_build_object('text', b.turn_text, 'cut', b.turn_cut, 'reply', jsonb_build_object('character', b.reply_by, 'text', b.reply_text, 'cut', b.reply_cut))
                                       from conv_best b where b.thread = c.thread and b.staff = c.staff))
                          order by c.reactions desc, c.turns desc, c.thread, c.staff) from conv c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function system_digest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function system_digest(timestamptz, timestamptz) to service_role;
