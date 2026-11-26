-- Persona lines: the staff speak for themselves (docs/plans/2026-11-25-persona-lines-plan.md; the design, docs/plans/2026-11-25-persona-lines-design.md, sections 1.2 and 1.5).
-- This is part 1 of the migration (Task 3); later tasks of the plan append parts 2 and 3 to this file.
--
-- Part 1. One picker for the set, and its settings.
--   A staff character posts a stock line from its own set (the setting `personaLines`, an object of persona key -> line key -> list of lines) and, where its set has no list for the key, from the
--   instance's (`systemLines`); where neither has one, the caller says what it always said. stock_lines is that one rule: the persona's list where it is a non-empty array whose first element is a
--   string, else the instance's under the same test, else null. It reads the settings as the readers it replaces did, and is no client's to call.
--   system_line, visit_line, report_line, appeal_line and boss_request_reply read through it, each with the staff key it already took (the Boss, for boss_request_reply); say_in_thread (0437) and
--   season_news (0440) ask it whether the speaker has a line, where they asked whether the instance had one.
--   system_line gains `speaker`, the set to pick from where the line is posted by someone other than the staff key whose name fills `{boss}` (coalesce(speaker, staff_key)). say_move_end passes the poster
--   for a superseded end: the current Boss posts it, `{boss}` still names the move's maker. Adding a parameter changes the signature, so the old one is dropped; every caller passes four arguments and
--   resolves to the new one.
--   settings_held holds `personaLines` (an object of objects of non-empty lists of non-blank strings) and `owedLines` ({graceMinutes 1..1440, perDay 0..10000, perRun 1..200}, whole numbers); the
--   instance's own copy of the rules is engine/rules/instance.ts (SETTINGS).
-- Latest definitions copied: settings_held (0433), system_line (0437, with its system_line_fill), visit_line, report_line and appeal_line (0126), boss_request_reply (0424), say_in_thread (0437; it was
--   say_in_announcements until 0437), say_move_end (0129) and season_news (0440). Everything each does that is not named here is as written there; the security definer, search_path and grants stay.
-- Existing rows: this writes no settings row (the release's seed does); a deployed instance with neither setting reads exactly as before.
-- Ways out: no state is added. Masks: a stock line is the instance's own words, picked at random as before; nothing here reads an owner, a class or a reactor.

-- setting_personalines: personaLines holds when it is an object of objects, each of whose values is a non-empty array of strings none of which is blank.
create function setting_personalines(v jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'object'
    and not exists (
      select 1 from jsonb_each(v) p
      where jsonb_typeof(p.value) is distinct from 'object'
         or exists (
           select 1 from jsonb_each(p.value) l
           where jsonb_typeof(l.value) is distinct from 'array' or jsonb_array_length(l.value) = 0
              or exists (select 1 from jsonb_array_elements(l.value) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''))), false)
$$;
revoke execute on function setting_personalines(jsonb) from public, anon, authenticated;

-- settings_held (0433_digest_sees_the_board.sql), holding `personaLines` and `owedLines` beside the rest. Everything else as 0433 wrote it.
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
    -- The staff's own stock lines and what is owed (0442, docs/plans/2026-11-25-persona-lines-design.md, sections 1.2 and 1.5): personaLines is held by setting_personalines, and owedLines gives the grace, the day's cap and a run's cap.
    when 'personaLines' then case when not setting_personalines(v) then 'an object of objects, each key of a persona''s set holding a non-empty list of non-blank lines' end
    when 'owedLines' then case when not coalesce(jsonb_typeof(v) = 'object' and setting_whole(v -> 'graceMinutes', 1, 1440) and setting_whole(v -> 'perDay', 0, 10000) and setting_whole(v -> 'perRun', 1, 200), false)
      then 'an object giving graceMinutes (a whole number of minutes from 1 to 1440), perDay (a whole number from 0 to 10000) and perRun (a whole number from 1 to 200)' end
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


-- stock_lines: the list of lines a speaker may say under a key: its persona's own, else the instance's, else null (a list is a non-empty array whose first element is a string).
create function stock_lines(line_key text, speaker text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.value -> stock_lines.speaker -> stock_lines.line_key from settings p where p.key = 'personaLines'
       and jsonb_typeof(p.value -> stock_lines.speaker -> stock_lines.line_key) = 'array' and jsonb_array_length(p.value -> stock_lines.speaker -> stock_lines.line_key) > 0
       and jsonb_typeof(p.value -> stock_lines.speaker -> stock_lines.line_key -> 0) = 'string'),
    (select i.value -> stock_lines.line_key from settings i where i.key = 'systemLines'
       and jsonb_typeof(i.value -> stock_lines.line_key) = 'array' and jsonb_array_length(i.value -> stock_lines.line_key) > 0
       and jsonb_typeof(i.value -> stock_lines.line_key -> 0) = 'string'))
$$;
revoke execute on function stock_lines(text, text) from public, anon, authenticated;

-- system_line (0437), picking from the speaker's set through stock_lines: `speaker` is the staff key whose set to pick from where it is not `staff_key` (which still fills `{boss}`). Everything else as 0437 wrote it.
drop function system_line(text, text, jsonb, text);
create function system_line(line_key text, move_kind text, params jsonb, staff_key text, speaker text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  line text;
begin
  lines := stock_lines(line_key, coalesce(speaker, staff_key));
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  end if;
  return system_line_fill(line, move_kind, params, staff_key);
end $$;
revoke execute on function system_line(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function system_line(text, text, jsonb, text, text) to service_role;

-- visit_line (0126), picking through stock_lines for the Mod. Everything else as 0126 wrote it.
create or replace function visit_line(line_key text, staff text, charges jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = visit_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = visit_line.staff);
  rules text := coalesce(nullif((select string_agg(coalesce(nullif(c ->> 'rule', ''), 'a breach of the rules'), '; ' order by n) from jsonb_array_elements(charges) with ordinality e(c, n)), ''), 'a breach of the rules');
begin
  lines := stock_lines(line_key, visit_line.staff);
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'rule', rules) || pronoun_tokens('mod', mod_id));
  end if;
  return case line_key when 'visitArrived' then mod_name || ' is looking at this post under ' || rules || '.' else mod_name || ' filed this post under ' || rules || '.' end;
end $$;
revoke execute on function visit_line(text, text, jsonb) from public, anon, authenticated;

-- report_line (0126), picking through stock_lines for the Mod. Everything else as 0126 wrote it.
create or replace function report_line(line_key text, staff text, reporter text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = report_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = report_line.staff);
begin
  lines := stock_lines(line_key, report_line.staff);
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'reporter', reporter) || pronoun_tokens('mod', mod_id)), 280);
  end if;
  return case line_key
    when 'reportDismissed' then mod_name || ' read ' || reporter || '''s report and dismissed it.'
    else mod_name || ' read ' || reporter || '''s report and has some thoughts about ' || reporter || '.' end;
end $$;
revoke execute on function report_line(text, text, text) from public, anon, authenticated;

-- appeal_line (0126), picking through stock_lines for the hearer. Everything else as 0126 wrote it.
create or replace function appeal_line(line_key text, staff text, appellant text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = appeal_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = appeal_line.staff);
begin
  lines := stock_lines(line_key, appeal_line.staff);
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'appellant', appellant) || pronoun_tokens('mod', mod_id)), 280);
  end if;
  return case line_key
    when 'appealOverturned' then mod_name || ' heard ' || appellant || '''s appeal and overturned it.'
    when 'appealReduced' then mod_name || ' heard ' || appellant || '''s appeal and reduced it.'
    when 'appealIncreased' then mod_name || ' heard ' || appellant || '''s appeal and increased it.'
    else mod_name || ' heard ' || appellant || '''s appeal and upheld it.' end;
end $$;
revoke execute on function appeal_line(text, text, text) from public, anon, authenticated;

-- boss_request_reply (0424), picking its stock line through stock_lines for the Boss. Everything else as 0424 wrote it.
create or replace function boss_request_reply(boss text, in_thread uuid, request_act uuid, stock text, own_line text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  body text := nullif(btrim(coalesce(own_line, ''), E' \t\n\r\f\v'), '');
  boss_name text;
  boss_id uuid;
  asker text;
begin
  if body is null then
    lines := stock_lines(boss_request_reply.stock, boss_request_reply.boss);
    if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) = 0 or jsonb_typeof(lines -> 0) is distinct from 'string' then return null; end if;
    select c.name, c.id into boss_name, boss_id from characters c where c.staff = boss_request_reply.boss;
    select k.name into asker from acts_public a join characters_public k on k.id = a.character where a.id = boss_request_reply.request_act;
    body := fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer,
      jsonb_build_object('boss', coalesce(boss_name, ''), 'asker', coalesce(asker, '')) || pronoun_tokens('boss', boss_id));
  end if;
  return (write_staff_act(boss_request_reply.boss, 'post', in_thread, boss_request_reply.request_act, jsonb_build_object('body', body)) ->> 'id')::uuid;
end $$;
revoke execute on function boss_request_reply(text, uuid, uuid, text, text) from public, anon, authenticated;

-- say_in_thread (0437; say_in_announcements until then), asking whether the speaker has a line for the key (its persona's, else the instance's) where it asked whether the instance had one. Everything else as 0437 wrote it.
create or replace function say_in_thread(speaker text, line_key text, in_thread uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if in_thread is null or speaker is null then return null; end if;
  if stock_lines(line_key, speaker) is null then return null; end if;
  return (write_staff_act(speaker, 'post', in_thread, null, jsonb_build_object('body', system_line(line_key, null, null, speaker))) ->> 'id')::uuid;
exception when others then
  raise warning 'say_in_thread: % was not said by %: % (%)', line_key, speaker, sqlerrm, sqlstate;
  return null;
end $$;

-- say_move_end (0129), picking from the poster's set: a superseded end is posted by the current Boss (the move's maker where there is none), so it reads the Boss's set while `{boss}` still names the maker.
-- Every other end is posted by the maker. Everything else as 0129 wrote it.
create or replace function say_move_end(move_act uuid, why text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
  poster text;
begin
  select a.thread, a.payload, c.staff into m from acts a join characters c on c.id = a.character where a.id = move_act and a.kind = 'move';
  poster := case when why = 'superseded' then coalesce(current_boss(), m.staff) else m.staff end;
  perform write_staff_act(poster, 'post', m.thread, null, jsonb_build_object('body',
    system_line(case why when 'met' then 'moveMet' when 'reversed' then 'moveReversed' when 'superseded' then 'moveSuperseded' when 'unmet' then 'moveUnmet' when 'overturned' then 'moveOverturned' else 'moveExpired' end, m.payload ->> 'kind', m.payload -> 'params', m.staff, poster)));
exception when others then
  raise warning 'say_move_end: the end of move % was not said: % (%)', move_act, sqlerrm, sqlstate;
end $$;

-- season_news (0440), its two checks that a Boss's entry has a line asking stock_lines for the Boss (c.who) where they asked the instance's set. Everything else as 0440 wrote it.
create or replace function public.season_news(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20)
 returns setof season_news_row
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id and r.standing > 0 and r.place is not null order by r.standing desc, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements', 'roster') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select (case when n.kind = 'roster' then 'roster' else 'tally' end)::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer when n.kind = 'roster' then (select s.number from seasons s where s.id = re.season) else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                when n.kind = 'roster' then coalesce((re.record ->> 'landedCount')::integer, 0)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           when n.kind = 'roster' then jsonb_build_object('turns', case when jsonb_typeof(re.record -> 'landed') = 'array' then re.record -> 'landed' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    left join roster_entries re on n.kind = 'roster' and re.acts[1] = a.id
    where n.kind in ('tally', 'announcements', 'roster') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line, h.thread as handover_thread from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, case when h.cause = 'departure' then h.number else h.number - 1 end, 'bossFarewell', h.thread from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      -- A handover with a thread of its own: the Boss's first post there, by the thread's (thread, seq) index. An older handover has none: the Boss's first post in the announcements thread at that instant, by created_at. Each branch is its own lateral so each keeps its own index; one OR across both made the planner give up the created_at probe.
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.thread = c.handover_thread and a.character = ch.id
      where c.handover_thread is not null and ch.staff = c.who and a.kind = 'post'
        and stock_lines(c.line, c.who) is not null
      order by a.seq limit 1
    ) ph on true
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where c.handover_thread is null and ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and stock_lines(c.line, c.who) is not null
      order by a.seq limit 1
    ) pa on true
    cross join lateral (select coalesce(ph.id, pa.id) as id, coalesce(ph.thread, pa.thread) as thread, coalesce(ph.seq, pa.seq) as seq, coalesce(ph.body, pa.body) as body) p
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first;
end
$function$;
