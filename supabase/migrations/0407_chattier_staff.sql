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
--   tables      staff_sessions, pool_kept_picks, pool_turns, pool_answered, staff_points, pool_round_claims: each append-only by a trigger firing always, no client's, RLS on.
--   functions   claim_pool_round, write_sessions, sessions_awake, sessions_day, keep_pick, kept_picks, pool_waiting_rows (invoker, one inlinable read), pool_waiting, pool_turns_today,
--               write_staff_turn, pool_conversation, pool_record, staff_points_latest: security definer, search_path pinned, the service role's only.
--   presence    presence_listed (0357_post_veils.sql) gains a persona in session on its threads; presence_box (0128_groups.sql, plan settings of 0368_client_reads_plan_once.sql) lists it in the index.
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

create function staff_rows_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a row of % is never edited or removed (%); every change is a new row', tg_table_name, tg_op using errcode = 'P0001';
end $$;
revoke execute on function staff_rows_append_only() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff_sessions', 'pool_kept_picks', 'pool_turns', 'pool_answered', 'staff_points', 'pool_round_claims'] loop
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

-- The day's sessions, `rows` being [{staff, start, end}] with `start` and `end` in minutes from 00:00 UTC of `on_day` (what drawSessions draws, engine/system/sessions.ts). A row already there is left as it is, so a rerun of the
-- day's first round writes nothing twice; answers how many sessions the day holds. A staff key that is not a posting persona (a persona, not the developer or the stand-in) is refused, and so is a span outside the day.
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
  if exists (select 1 from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
             where x."start" is null or x."end" is null or x."start" < 0 or x."end" > 1440 or x."end" <= x."start") then
    raise exception 'a session starts and ends inside the day, and ends after it starts' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into staff_sessions (day, staff, starts_at, ends_at)
  select on_day, x.staff, (on_day::timestamp at time zone 'UTC') + x."start" * interval '1 minute', (on_day::timestamp at time zone 'UTC') + x."end" * interval '1 minute'
  from jsonb_to_recordset(rows) as x(staff text, "start" integer, "end" integer)
  on conflict (day, staff, starts_at) do nothing;
  return (select count(*)::integer from staff_sessions s where s.day = on_day);
end $$;

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
-- (The pool setting is read from the settings table, so a database that has none yet reads the defaults, 28 days.) It reads through the persona's own recent posts (acts_character) and, for each, the replies found by the target index (acts_target), never a scan of the window's posts (the newest 200 replies to a post are read, which also keeps the planner to one index probe for each of the persona's posts, as a join by merge would read every reply there is). A plain invoker SQL function, so the planner
-- inlines it: the query is the plan the test explains, and pool_waiting and the presence view read it as one.
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
    select x.id, x.thread, x.character, x.created_at from acts x
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_rows.since and x.character is not null
    order by x.created_at desc, x.id desc limit 200
  ) r
  join characters w on w.id = r.character and w.staff is null
  where c.staff = any (pool_waiting_rows.staff_keys) and c.staff_kind = 'persona'
    -- Public: neither post is under a live author veil, which shows its post as the stand-in's (acts_public's cover condition, read by the two posts' ids once a reply is found); a veiled reply's author is not named here.
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = r.id)
    and not exists (select 1 from pool_answered a where a.reply = r.id)
    and locked_out_until(c.id, r.thread) is null
$$;
revoke execute on function pool_waiting_rows(text[], timestamptz) from public, anon, authenticated;
grant execute on function pool_waiting_rows(text[], timestamptz) to service_role;

-- For each persona of `staff_keys`, its threads with waiting replies: [{staff, thread, heat, replies: [{act, author, at}]}], the replies newest last. `heat` is the public reaction total on the persona's turns in that
-- thread, read as pool_signals reads its tallies (reaction_tallies_open, 0358_blind_totals.sql): the totals the crowd sees, never who reacted.
create function pool_waiting(staff_keys text[], since timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', g.staff, 'thread', g.thread,
      'heat', coalesce((select sum(tt.count) from pool_turns t join reaction_tallies_open tt on tt.act = t.post_act where t.staff = g.staff and t.thread = g.thread), 0),
      'replies', g.replies) order by g.staff, g.thread), '[]'::jsonb)
  from (select w.staff, w.thread, jsonb_agg(jsonb_build_object('act', w.act, 'author', w.author, 'at', w.at) order by w.at, w.act) as replies
        from pool_waiting_rows(staff_keys, since) w group by w.staff, w.thread) g
$$;

-- The turns written on a UTC day, instance-wide (the ceiling counts calls and nothing else).
create function pool_turns_today(on_day date) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from pool_turns t where t.day = on_day
$$;

-- A turn, written whole: the post (through write_staff_act, 0402_thread_lockout.sql, so a lockout, a ban or a benched persona refuses exactly as it does there), its pool_turns row and a pool_answered row for each
-- reply it answers, in one transaction. Refuses (writing nothing, hint 'kayfabb.refusal') a session that is not the persona's or not open now, a `quoting` not among `answers`, an answer that is not a player's post in the
-- thread replying to one of the persona's own, and any answer already answered. One transaction, so a turn has no orphan: a lost answer is found as answered by the next round.
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
  -- Each answer is a post in the thread by a character that is not staff (a staff post is never a waiting reply), replying to a post of this persona.
  if (select count(*) from acts a join acts t on t.id = a.target_act_id and t.character = who and t.kind = 'post' join characters w on w.id = a.character
      where a.id = any (wanted) and a.kind = 'post' and a.thread = in_thread and w.staff is null) is distinct from cardinality(wanted) then
    raise exception 'a turn answers players'' posts in its thread that reply to its own' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if exists (select 1 from pool_answered p where p.reply = any (wanted)) then
    raise exception 'a reply is answered once' using hint = 'kayfabb.refusal', errcode = '55000';
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
-- with `cut` saying so, each reply's author's name and pronouns. Public play only (acts_public, characters_public). {posts: [{act, at, body, cut, replies: [{act, author, name, pronouns, at, body, cut}]}]}
create function pool_conversation(staff_key text, in_thread uuid, most integer, replies integer, chars integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('posts', coalesce((
    select jsonb_agg(jsonb_build_object('act', m.id, 'at', m.created_at, 'body', m.body, 'cut', m.cut,
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object('act', r.id, 'author', r.character, 'name', r.name, 'pronouns', r.pronouns, 'at', r.created_at, 'body', r.body, 'cut', r.cut) order by r.created_at, r.id)
          from (select x.id, x.character, x.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
                       left(coalesce(x.current_payload ->> 'body', ''), greatest(chars, 1)) as body,
                       length(coalesce(x.current_payload ->> 'body', '')) > greatest(chars, 1) as cut
                from acts_public x join characters_public c on c.id = x.character
                where x.target_act_id = m.id and x.kind = 'post'
                order by x.created_at desc, x.id desc limit greatest(replies, 0)) r), '[]'::jsonb))
      order by m.created_at, m.id)
    from (select a.id, a.created_at, left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body,
                 length(coalesce(a.current_payload ->> 'body', '')) > greatest(chars, 1) as cut
          from acts_public a
          where a.thread = in_thread and a.kind = 'post' and a.character = (select c.id from characters c where c.staff = staff_key)
          order by a.created_at desc, a.id desc limit greatest(most, 0)) m), '[]'::jsonb))
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

revoke execute on function claim_pool_round(timestamptz, interval), write_sessions(date, jsonb), sessions_awake(timestamptz), sessions_day(date), keep_pick(date, text, jsonb), kept_picks(date),
  pool_waiting(text[], timestamptz), pool_turns_today(date), write_staff_turn(text, bigint, uuid, uuid, uuid[], text), pool_conversation(text, uuid, integer, integer, integer),
  pool_record(uuid, text), staff_points_latest(text) from public, anon, authenticated;
grant execute on function claim_pool_round(timestamptz, interval), write_sessions(date, jsonb), sessions_awake(timestamptz), sessions_day(date), keep_pick(date, text, jsonb), kept_picks(date),
  pool_waiting(text[], timestamptz), pool_turns_today(date), write_staff_turn(text, bigint, uuid, uuid, uuid[], text), pool_conversation(text, uuid, integer, integer, integer),
  pool_record(uuid, text), staff_points_latest(text) to service_role;

-- ------------------------------------------------------------------------------------------------- presence ----

-- presence_listed (0357_post_veils.sql), with a third branch and a column: a persona's character on each thread it posted in since a session of its began or has a reply waiting in (pool_waiting_rows, limited to that persona), for
-- each session open now, `place_since` the session's start and `seen_at` now, marked `in_session`. A persona out of session is listed only by its own posts, as the branch above lists it. The new column is last, so the
-- view's others read as they did. Everything else as 0357_post_veils.sql wrote it.
create or replace view presence_listed as
  select c.id, c.name, p.place_kind, p.place, p.board, p.place_since, p.online_since, p.seen_at, false as staff, false as in_session
  from presence p join characters c on c.id = p.character
  where c.debuted_at is not null and c.retired_at is null
    and not exists (select 1 from presence_hidden h where h.character = p.character)
  union all
  select c.id, c.name, 'thread'::text, a.thread, t.board, a.last_at, a.last_at, a.last_at, true, false
  from characters c
  cross join lateral (
    select x.thread, max(x.created_at) as last_at
    from acts_public x
    where x.character = c.id and x.kind = 'post'
      and x.created_at >= now() - coalesce(span_interval((select s.value from settings s where s.key = 'presenceWindow')), interval '0')
    group by x.thread
  ) a
  join threads t on t.id = a.thread
  where c.staff is not null and c.staff_kind not in ('developer', 'anonymous') and c.debuted_at is not null and c.retired_at is null
  union all
  select c.id, c.name, 'thread'::text, w.thread, t.board, s.starts_at, s.starts_at, now(), true, true
  from staff_sessions s
  join characters c on c.staff = s.staff and c.staff_kind = 'persona' and c.debuted_at is not null and c.retired_at is null
  cross join lateral (
    select x.thread from acts_public x where x.character = c.id and x.kind = 'post' and x.created_at >= s.starts_at group by x.thread
    union
    select r.thread from pool_waiting_rows(array[s.staff], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') r
  ) w
  join threads t on t.id = w.thread
  where s.starts_at <= now() and now() < s.ends_at;

revoke all on presence_listed from anon, authenticated;

-- presence_box (0128_groups.sql; the plan cache and jit settings 0368_client_reads_plan_once.sql gave it kept), with the index's box listing a staff persona while it is in session, once however many threads it is on, as a
-- staff name. The count behind "others" keeps counting characters that are not staff only, so a player sees the same total as before; a thread's box and a board's box read the view as they did. Everything else as
-- 0128_groups.sql wrote it.
create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
declare
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
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
      where v.kind = 'visit' and v.thread = in_place and m.staff is not null and m.staff_kind is distinct from 'developer' and m.debuted_at is not null and m.retired_at is null),
    one as (
      select s.id, s.name, bool_or(s.staff) as staff, min(s.place_since) as place_since, min(s.visit_post) as visit_post from seen s group by s.id, s.name),
    f as (select * from one order by one.place_since, one.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id), 'group', group_now(f.id))
                                      || case when f.visit_post is not null then jsonb_build_object('visit_post', f.visit_post) else '{}'::jsonb end
                                      order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from one)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id), 'group', group_now(f.id)) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    -- Everyone who is not staff, and a persona in session; a persona's rows (one for each thread it is on) are one name. `total` is the characters that are not staff, plus the staff names shown, so that "others"
    -- is what a player's box has always counted.
    with f as (
      select l.id, l.name, bool_or(l.staff) as staff, min(l.online_since) as online_since from presence_listed l
      where l.seen_at >= now() - win and (not l.staff or l.in_session) group by l.id, l.name order by min(l.online_since), l.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id), 'group', group_now(f.id)) order by f.online_since, f.id), '[]'::jsonb) from f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win) + (select count(*) from f where f.staff)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;
revoke execute on function presence_box(text, uuid) from public, anon;
grant execute on function presence_box(text, uuid) to authenticated;
