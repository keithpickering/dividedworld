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
    -- The staff's own stock lines and what is owed (0443, docs/plans/2026-11-25-persona-lines-design.md, sections 1.2 and 1.5): personaLines is held by setting_personalines, and owedLines gives the grace, the day's cap and a run's cap.
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


-- ============================================================================================================================================================================================================
-- Part 2 (Task 4 of the plan). Owed lines: the tables, the debt and the grace.
--   A move's end, a request's lapse and a handover's arrival are acts that have already happened; the post that says them in character is owed by its speaker. The act records the debt (owe_line), the staff run voices it with
--   one light call (pay_owed_line(id, body)), and the tick posts the speaker's stock line when it is not voiced within `owedLines.graceMinutes` (or at once for a line that cannot be voiced: the run pays null). A line that
--   cannot be posted is paid `unsaid` with the reason and leaves the queue.
--   tables      lines_owed (insert-only: the debt, with the facts the prompt and the stock line need), lines_owed_open (the queue: a row goes when its line is paid; `failed_at` and `attempts` are the tick's own, as
--               visits_open's are, and `at` is the debt's time, so the queue's index serves the grace), lines_paid (insert-only, one row for each line: how it was paid (voiced, stock, unsaid), the act it made, the reason).
--               RLS is on for all three and no client has a grant. The export carries every table of ours, so these are carried.
--   functions   owe_line, owed_lines_due (the staff run's read: a jsonb array, as filings_due returns), pay_owed_line (idempotent: it takes the queue row's lock, and a line already paid returns its payment and writes nothing),
--               pay_owed_unsaid (the tick's, for The System off or a line that cannot be paid), owed_grace_minutes, standing_order_line_calls_today (the run's count of the day's calls from the ledger, as filing_calls_today counts
--               filings); say_move_end, hand_over and system_tick re-created (the arrival and the lapse owe; step 6 of the tick pays what is late), season_news and staff_requests_now reading the paid act, and staff_call_records taking the duty standingOrderLine.
--   Latest definitions copied: hand_over and system_tick (0437), say_move_end (0443 part 1), season_news (0443 part 1), staff_requests_now (0424), staff_call_records' duty check (0424). Everything each does that is not named is as written.
--   Existing rows: moves in force when this lands owe their ends from then on; a lapse already ruled keeps its post_act (staff_requests_now reads it first); an arrival posted before this is found by season_news as it was (no debt, no new finder); no row is written.
--   Ways out: an owed line ends by itself: voiced by the staff run, or posted from stock by the tick at the grace, or paid from stock at once when it cannot be voiced, or paid unsaid with a reason when it cannot be posted; the act it belongs
--   to has already happened, so no player, character or post waits on it. A line whose payment keeps raising is paid unsaid at the fifth failure.
--   Masks. The facts hold public play only: the move and its maker's `why`, the request post's words and its asker's name as acts_public and characters_public show them (a veiled author is the anonymous character), and staff keys. Nothing
--   here reads an owner, a class or a reactor, and when a line posts depends on the schedule, the cap and the grace, never on who is behind any character.
--   Cost at a busy instance. Everything is bounded by the lines not yet paid, which the grace and the day's calls bound: the tick reads at most `demandChecksPerTick` queue rows (lines_owed_open_tick), the run at most `perRun`, and a
--   superseded flood at a handover owes one line for each move ended and is paid by the same bounds; nothing reads a line paid in the past (season_news and staff_requests_now read one payment by the debt's key, indexed).

create table lines_owed (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  line_key text not null check (line_key in ('moveMet', 'moveExpired', 'moveUnmet', 'moveSuperseded', 'moveReversed', 'moveOverturned', 'requestLapsed', 'bossArrival')),
  thread uuid references threads (id),
  target uuid references acts (id),
  cause_act uuid references acts (id),
  request bigint references staff_requests (id),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  owed_at timestamptz not null default now()
);
create index lines_owed_request on lines_owed (request) where request is not null;
create index lines_owed_arrival on lines_owed ((facts ->> 'handover')) where line_key = 'bossArrival';
create index lines_owed_cause on lines_owed (cause_act) where cause_act is not null;

create table lines_owed_open (
  owed bigint primary key references lines_owed (id),
  at timestamptz not null,
  failed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);
-- The tick's order (failures last, then the oldest first): the grace and the staff run's read are each a walk of this index to the `most`th row.
create index lines_owed_open_tick on lines_owed_open (failed_at nulls first, at, owed);

create table lines_paid (
  owed bigint primary key references lines_owed (id),
  how text not null check (how in ('voiced', 'stock', 'unsaid')),
  act uuid references acts (id),
  reason text check (reason is null or char_length(reason) <= 500),
  at timestamptz not null default now(),
  check ((how = 'unsaid') = (act is null))
);

do $$
declare t text;
begin
  foreach t in array array['lines_owed', 'lines_owed_open', 'lines_paid'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['lines_owed', 'lines_paid'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function staff_rows_append_only()', t || '_no_update', t);
    execute format('create trigger %I before truncate on %I for each statement execute function staff_rows_append_only()', t || '_no_truncate', t);
    execute format('alter table %I enable always trigger %I', t, t || '_no_update');
    execute format('alter table %I enable always trigger %I', t, t || '_no_truncate');
  end loop;
end $$;

-- owed_grace_minutes: how long a line may wait for the staff run before the tick posts its stock line (owedLines.graceMinutes; 15 where the setting is not there yet).
create function owed_grace_minutes() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (s.value ->> 'graceMinutes')::integer from settings s where s.key = 'owedLines'), 15)
$$;
revoke execute on function owed_grace_minutes() from public, anon, authenticated;

-- owe_line: the debt and its place in the queue, in the caller's transaction. Returns the debt's id.
create function owe_line(staff text, line_key text, thread uuid, target uuid, cause_act uuid, request bigint, facts jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made bigint;
  at timestamptz := now();
begin
  insert into lines_owed (staff, line_key, thread, target, cause_act, request, facts, owed_at)
  values (owe_line.staff, owe_line.line_key, owe_line.thread, owe_line.target, owe_line.cause_act, owe_line.request, coalesce(owe_line.facts, '{}'::jsonb), at) returning id into made;
  insert into lines_owed_open (owed, at) values (made, at);
  return made;
end $$;
revoke execute on function owe_line(text, text, uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;

-- settle_owed_line: the one place a line is paid: the payment, the queue's row gone, and (for an arrival that posted) the handover's row pointing at its post, which the pool's digest reads (season_handovers.arrival_act). Internal.
create function settle_owed_line(owed bigint, how text, act uuid, reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare w lines_owed%rowtype;
begin
  select * into w from lines_owed x where x.id = settle_owed_line.owed;
  insert into lines_paid (owed, how, act, reason) values (settle_owed_line.owed, settle_owed_line.how, settle_owed_line.act, left(settle_owed_line.reason, 500));
  delete from lines_owed_open o where o.owed = settle_owed_line.owed;
  if settle_owed_line.act is not null and w.line_key = 'bossArrival' and w.facts ->> 'handover' ~ '^[0-9]{1,18}$' then
    update season_handovers h set arrival_act = settle_owed_line.act where h.id = (w.facts ->> 'handover')::bigint and h.arrival_act is null;
  end if;
end $$;
revoke execute on function settle_owed_line(bigint, text, uuid, text) from public, anon, authenticated;

-- pay_owed_unsaid: a line paid `unsaid` with the reason, posting nothing (The System is off, or the line could not be paid). A line already paid is left as it is. Not a client's, nor the staff run's: the tick's.
create function pay_owed_unsaid(owed bigint, reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from lines_owed_open o where o.owed = pay_owed_unsaid.owed for update;
  if not found then return; end if;
  perform settle_owed_line(pay_owed_unsaid.owed, 'unsaid', null, pay_owed_unsaid.reason);
end $$;
revoke execute on function pay_owed_unsaid(bigint, text) from public, anon, authenticated;

-- pay_owed_line: posts the line as its speaker and pays it. With a body (the staff run's voiced line, trimmed and cut to postMaxLength) it pays `voiced`; with none (null or blank) it posts the speaker's stock line and pays
-- `stock`: a move's key through system_line with the move's kind and params read back from its Act and the move's maker as {boss}, requestLapsed through boss_request_reply (quoting the request), bossArrival through system_line.
-- A speaker that has no stock line to post, or a post that raises (the speaker locked out of the thread, benched, a thread gone), pays `unsaid` with the reason; a lock timeout, deadlock, serialization failure or cancelled
-- statement is not a fact about the line and is raised, so the line is tried again. It takes the queue row's lock, so the staff run and the tick paying one line at once post it once: the second finds it paid, and returns the
-- payment and writes nothing.
create function pay_owed_line(owed bigint, body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w lines_owed%rowtype;
  p lines_paid%rowtype;
  words text := nullif(btrim(coalesce(pay_owed_line.body, ''), E' \t\n\r\f\v'), '');
  most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength'), 2000);
  posted uuid;
  how text;
  why text;
  mv record;
  stock text;
begin
  if pay_owed_line.owed is null then raise exception 'pay_owed_line needs the owed line' using errcode = '22023'; end if;
  perform 1 from lines_owed_open o where o.owed = pay_owed_line.owed for update;
  if not found then
    select * into p from lines_paid x where x.owed = pay_owed_line.owed;
    if found then return jsonb_build_object('owed', p.owed, 'how', p.how, 'act', p.act, 'reason', p.reason, 'already', true); end if;
    raise exception 'there is no owed line %', pay_owed_line.owed using errcode = 'P0002';
  end if;
  select * into w from lines_owed x where x.id = pay_owed_line.owed;
  begin
    if words is not null then
      posted := (write_staff_act(w.staff, 'post', w.thread, w.target, jsonb_build_object('body', left(words, most))) ->> 'id')::uuid;
      how := 'voiced';
    elsif w.line_key = 'requestLapsed' then
      posted := boss_request_reply(w.staff, w.thread, w.target, 'requestLapsed', null);
      if posted is null then why := 'the speaker has no stock line for requestLapsed'; else how := 'stock'; end if;
    elsif w.line_key = 'bossArrival' then
      if stock_lines('bossArrival', w.staff) is null then
        why := 'the speaker has no stock line for bossArrival';
      else
        posted := (write_staff_act(w.staff, 'post', w.thread, w.target, jsonb_build_object('body', left(system_line('bossArrival', null, null, w.staff), most))) ->> 'id')::uuid;
        how := 'stock';
      end if;
    else
      select a.payload ->> 'kind' as kind, a.payload -> 'params' as params into mv from acts a where a.id = w.cause_act;
      if not found then
        why := 'the move this line is about is not there';
      else
        stock := system_line(w.line_key, mv.kind, mv.params, coalesce(w.facts ->> 'maker', w.staff), w.staff);
        posted := (write_staff_act(w.staff, 'post', w.thread, w.target, jsonb_build_object('body', left(stock, most))) ->> 'id')::uuid;
        how := 'stock';
      end if;
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01', '40001', '57014', '57P01') then raise; end if;
    posted := null;
    how := null;
    why := left(sqlerrm || ' (' || sqlstate || ')', 480);
  end;
  if posted is null then
    perform settle_owed_line(w.id, 'unsaid', null, coalesce(why, 'the line could not be posted'));
    return jsonb_build_object('owed', w.id, 'how', 'unsaid', 'act', null, 'reason', coalesce(why, 'the line could not be posted'), 'already', false);
  end if;
  perform settle_owed_line(w.id, how, posted, null);
  return jsonb_build_object('owed', w.id, 'how', how, 'act', posted, 'reason', null, 'already', false);
end $$;
revoke execute on function pay_owed_line(bigint, text) from public, anon, authenticated;
grant execute on function pay_owed_line(bigint, text) to service_role;

-- owed_lines_due: the lines the staff run voices next, at most `most`, as one jsonb array in the queue's order (failures last, then the oldest first): each line's id, speaker, key, thread, facts, the Act it is about
-- (the move, or the request post; null for an arrival) and the speaker's office now. Each row's debt and office are read by key, so the read walks the queue's index to the `most`th row and never the lines paid.
create function owed_lines_due(most integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.j order by x.failed_at nulls first, x.at, x.owed), '[]'::jsonb)
  from (
    select o.failed_at, o.at, o.owed,
           jsonb_build_object('id', w.id, 'staff', w.staff, 'line_key', w.line_key, 'thread', w.thread, 'facts', w.facts, 'cause_act', w.cause_act,
                              'office', (select f.office from staff_office_now f where f.staff = w.staff)) as j
    from lines_owed_open o cross join lateral (select y.* from lines_owed y where y.id = o.owed) w
    order by o.failed_at nulls first, o.at, o.owed
    limit greatest(coalesce(most, 0), 0)
  ) x
$$;
revoke execute on function owed_lines_due(integer) from public, anon, authenticated;
grant execute on function owed_lines_due(integer) to service_role;

-- standing_order_line_calls_today: today's (UTC) model calls for the duty standingOrderLine, from the ledger, as filing_calls_today counts filings. The staff run reads it against `owedLines.perDay`.
create function standing_order_line_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m where m.duty = 'standingOrderLine' and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;
revoke execute on function standing_order_line_calls_today() from public, anon, authenticated;
grant execute on function standing_order_line_calls_today() to service_role;

-- staff_call_records (0424), taking the duty standingOrderLine, the call that voices an owed line. Everything else as 0424 wrote it.
alter table staff_call_records drop constraint staff_call_records_duty_check;
alter table staff_call_records add constraint staff_call_records_duty_check check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal', 'ruling', 'standingOrderLine'));

-- staff_requests_now (0424), its post_act read from the lapse's payment where the ruling holds none: a lapse owes its line and the ruling row is written with no post (a ruling is never edited), so the post a lapse made is the
-- payment's act (lines_paid.act) of the debt for this request. A ruling that holds its own post_act (a lapse before this, or a meeting's) keeps it. Everything else as 0424 wrote it; no client reads it.
create or replace view staff_requests_now as
  select q.id, q.request_act, q.thread, q.asker, q.staff, q.turn_act, q.at, q.ruling as first_ruling,
         coalesce(g.ruling, q.ruling) as ruling, coalesce(g.move, q.move) as move, g.meeting, coalesce(g.post_act, lp.act) as post_act, g.reason, g.at as ruled_at,
         (o.request is not null) as waiting,
         case when o.request is not null then q.at + make_interval(days => staff_request_days()) end as lapses_at
  from staff_requests q left join staff_request_rulings g on g.request = q.id left join staff_requests_open o on o.request = q.id
  left join lateral (select p.act from lines_owed w join lines_paid p on p.owed = w.id where w.request = q.id and w.line_key = 'requestLapsed' order by w.id desc limit 1) lp on true;

-- say_move_end (0443, part 1), the end owed and not posted: the poster (the current Boss for a superseded end, the move's maker otherwise) owes the key for the end in the move's thread, with the facts the staff run and the stock line
-- need: the move, why it ended, when, and its maker (the staff whose name fills {boss}). Nothing is posted here; pay_owed_line posts it. Everything else as part 1 wrote it.
create or replace function say_move_end(move_act uuid, why text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
  poster text;
begin
  select a.thread, a.payload, c.staff into m from acts a join characters c on c.id = a.character where a.id = move_act and a.kind = 'move';
  poster := case when why = 'superseded' then coalesce(current_boss(), m.staff) else m.staff end;
  perform owe_line(poster, case why when 'met' then 'moveMet' when 'reversed' then 'moveReversed' when 'superseded' then 'moveSuperseded' when 'unmet' then 'moveUnmet' when 'overturned' then 'moveOverturned' else 'moveExpired' end,
    m.thread, null, move_act, null, jsonb_build_object('move', move_act, 'why', why, 'ended', clock_timestamp(), 'maker', m.staff));
exception when others then
  raise warning 'say_move_end: the end of move % was not owed: % (%)', move_act, sqlerrm, sqlstate;
end $$;

-- hand_over (0437), the arrival owed and not posted: the new Boss owes `bossArrival` in the handover's thread (owe_line), and pay_owed_line posts it, voiced by the staff run or from the Boss's stock at the grace. The row's id is taken
-- from its sequence first so the debt can name its handover (facts.handover), and the row's arrival_act is filled in when the arrival is paid; its own thread opens as before. The farewell is said at once as it was; where it was not, the arrival is the thread's first post and is paid from stock at once (a thread with no post holds nothing a player
-- wrote, so one whose arrival cannot be posted either raises, which takes the thread and the debt back with it, as it did), and where it was said the arrival is owed and voiced or paid at the grace. The line the
-- Boss has is its persona's, else the instance's (stock_lines), so the thread opens for a line either set holds. Everything else as 0437 wrote it; the signature is the one 0403 made, so the function is replaced in place and its grants stand.
create or replace function hand_over(new_season bigint, outgoing text, at timestamptz, departure boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  chosen text;
  how text;
  note text;
  open_nom record;
  arrival bigint;
  hid bigint := nextval(pg_get_serial_sequence('season_handovers', 'id'));
  ht uuid;
  said boolean;
begin
  begin
    chosen := nominated_boss(outgoing);
    if chosen is not null then how := 'nomination'; end if;
  exception when others then
    chosen := null;
    note := 'the nomination did not seat: ' || sqlerrm;
  end;
  if chosen is null then
    begin
      chosen := rotation_boss(outgoing);
      how := 'rotation';
    exception when others then
      chosen := outgoing;
      how := case when outgoing is null then 'none' else 'unchanged' end;
      note := coalesce(note || '; ', '') || 'the rotation did not choose: ' || sqlerrm;
    end;
  end if;
  -- A departure is the outgoing Boss leaving the roster: it refuses where no other Boss can take the chair, since the outgoing one has no persona file left to sit in it. Nothing has been written yet.
  if departure and (chosen is null or chosen is not distinct from outgoing) then
    raise exception 'the open season''s Boss % has left the roster, and no Boss in it can take the chair', outgoing using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  update seasons set boss = chosen where id = new_season;
  -- Every nomination in force is spent: it named the Boss of this handover, whoever was seated.
  for open_nom in
    select o.move_act from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'nameSuccessor' order by o.landed_at, o.move_act
  loop
    begin
      perform end_move(open_nom.move_act, 'spent', 'handover');
    exception when others then
      note := coalesce(note || '; ', '') || 'a nomination was not spent: ' || sqlerrm;
    end;
  end loop;
  if chosen is not null and chosen is distinct from outgoing then
    begin
      insert into move_bank (staff, balance, as_of) values (chosen, 0, at)
      on conflict (staff) do update set balance = 0, as_of = excluded.as_of;
    exception when others then
      note := coalesce(note || '; ', '') || 'the bank was not started: ' || sqlerrm;
    end;
    -- The offices (0082): the arriving Boss debuts if it was waiting; the outgoing Boss becomes a member, or a Mod Bot where no persona
    -- is one now, since the staff is never empty. The Boss's own office is the season's and is never a row, so the two Bosses of this
    -- handover are left out of the count: the outgoing one's latest row may still read mod, from before it was seated; a retired mod is no mod either. Best effort, as the rest.
    begin
      perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
      update characters set debuted_at = at where staff = chosen and debuted_at is null;
      if outgoing is not null then
        insert into staff_offices (staff, office, cause, season)
        values (outgoing, case when exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and o.staff is distinct from outgoing and o.staff is distinct from chosen and c.retired_at is null) then 'member' else 'mod' end, 'handover', new_season);
      end if;
    exception when others then
      note := coalesce(note || '; ', '') || 'the offices were not moved: ' || sqlerrm;
    end;
    -- The outgoing Boss's moves still waiting are withdrawn: their Boss has left the chair (the rehearsal patch design, section 6). A Mod's own moves are left alone. Refused for good,
    -- with the reason the admin queue shows; nothing is posted. Best effort, as the rest.
    begin
      update queued_moves set failed_at = at, failure = 'its Boss left the chair before it landed', refused_at = at
      where staff = outgoing and landed_act is null and held_at is null and refused_at is null;
    exception when others then
      note := coalesce(note || '; ', '') || 'the outgoing Boss''s waiting moves were not withdrawn: ' || sqlerrm;
    end;
    -- The handover's thread (the staff-board threads design, section 6): one staff thread on the system board, titled by the instance's handoverThreadTitle with the arriving Boss's name and the new season's
    -- number, opened only where there is anything to say in it and kept only if a post lands in it. The Boss's own farewell, written at its last meeting (0337, above), comes first, in place of the stock line,
    -- which stands where none was written or it could not be posted; the arrival follows. The farewell and the arrival swallow their own failures, so the whole is one block: where neither lands the block
    -- raises, which takes the thread back with it (a thread with no post holds nothing a player wrote), and the row records none. A thread that cannot be opened says nothing and the handover stands.
    if (outgoing is not null and (farewell_words(outgoing, new_season, departure) is not null or stock_lines('bossFarewell', outgoing) is not null)) or stock_lines('bossArrival', chosen) is not null then
      begin
        ht := open_staff_thread(chosen, handover_thread_title(chosen, new_season));
        said := say_farewell(outgoing, new_season, departure, ht);
        if not said then said := say_in_thread(outgoing, 'bossFarewell', ht) is not null; end if;
        if stock_lines('bossArrival', chosen) is not null then
          arrival := owe_line(chosen, 'bossArrival', ht, null, null, null, jsonb_build_object('handover', hid, 'season', new_season, 'predecessor', outgoing, 'how', how));
        end if;
        if not said and arrival is not null and (pay_owed_line(arrival, null) ->> 'act') is null then arrival := null; end if;
        if not said and arrival is null then raise exception 'neither the farewell nor the arrival could be posted'; end if;
      exception when others then
        ht := null;
        arrival := null;
        note := coalesce(note || '; ', '') || 'the handover''s thread was not kept: ' || sqlerrm;
      end;
    end if;
  end if;
  insert into season_handovers (id, season, outgoing, boss, how, note, at, arrival_act, cause, thread) overriding system value
  values (hid, new_season, outgoing, chosen, how, left(note, 1000), at, (select p.act from lines_paid p where p.owed = arrival), case when departure then 'departure' else 'rollover' end, ht);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;


-- system_tick (0437), the request lapse owing its line and a new step 6 that pays the lines owed past their grace: the lapse writes its ruling row with no post (post_act null) and owes `requestLapsed` by the Boss,
-- quoting the request post, with the asker's public name and the request's words in its facts; the staff run voices it or step 6 posts the Boss's stock line. Everything else as 0437 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  clash text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  unmet integer := 0;
  arcs integer := 0;
  awards_failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  check_at timestamptz;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  -- The instant the open season's Boss was seated: the latest Boss-changing handover of the open season (a departure's included), else the season's start.
  handed timestamptz := coalesce((select h.at from season_boss_changes h join seasons x on x.id = h.season and x.ends_at is null order by h.landed_at desc, h.handover desc limit 1),
                                  (select x.starts_at from seasons x where x.ends_at is null));
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
  first_before uuid;
  was record;
  dep record;
  lp jsonb;
  rk text;
  resolved uuid;
  lapsed_n integer := 0;
  rq record;
  asked record;
  owed_late record;
  owed_tries integer;
  owed_error text;
  owed_paid integer := 0;
  rq_public boolean;
  mt uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places, so
  -- the key is taken first. A landing move also opens a thread of its own on the system board and writes its Act into it, a thread no one else holds until the tick commits; an admin's reversal takes the key
  -- and only then writes its end into the move's thread. A non-lasting landing therefore has no row a reversal waits for, and the key is needed only where a lasting move is due or in force, which is the test
  -- below. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on. A landed move is written in a thread of its own on the staff's board (below), so it needs no thread made beforehand.
  if enabled then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- A part of a bundle (0329) lands after the parts it builds on, and not before: one of them still waiting, and this one waits; one refused, and it is refused with it (nothing
        -- will ever make the board it names); one held (an admin's hold follows its dependents at once, so this only meets a row queued after the hold), and it is held with it. Then each
        -- role in its params is the board the part it names made, in the Act, so the Act says which board it moved to and the log can name it.
        lp := due.params;
        if due.depends_on is not null then
          select d.id, d.held_at, d.held_by, d.refused_at, d.role into dep from queued_moves d
          where d.id = any (due.depends_on) and d.landed_act is null order by (d.refused_at is not null) desc, (d.held_at is not null) desc, d.id limit 1;
          if found then
            if dep.refused_at is not null then
              update queued_moves set failed_at = now(), failure = left('that move cannot land: the move it builds on was refused', 500), refused_at = now() where id = due.id;
            elsif dep.held_at is not null then
              update queued_moves set held_at = dep.held_at, held_by = dep.held_by where id = due.id;
            end if;
            continue;
          end if;
        end if;
        for rk in select e.key from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role' loop
          resolved := case when (lp -> rk) ? 'beat'
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'])
            else role_board(due.bundle, lp #>> array[rk, 'role']) end;
          if resolved is null then exit; end if;
          lp := jsonb_set(lp, array[rk], to_jsonb(resolved::text));
        end loop;
        if resolved is null and exists (select 1 from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
          update queued_moves set failed_at = now(), failure = left('that move cannot land: a part it names made no board', 500), refused_at = now() where id = due.id;
          continue;
        end if;
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(lp ->> 'board', '')::uuid, lp ->> 'predicate', nullif(lp -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, lp, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The three moves that build the board are checked against the boards and threads as they are now (0320), as a machine move is against the machine: state changes between
        -- the queue and the landing (a board closed, a thread gone, a merge that would now make a cycle). Refused for good, with the reason; it is no Act, so nothing needs reversing.
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then
          -- The writers of a place wait for each other (0339): the global key (already held, taken before the loop; a second take costs nothing), and for a merge the key of the board it closes, which a
          -- thread insert on that board tries shared, so a thread started there is committed before the merge reads its threads, or is refused at once. Both are held to the end of the tick.
          perform lock_thread_places();
          if due.kind = 'mergeBoard' then perform lock_board_closing(safe_uuid(lp ->> 'board')); end if;
          clash := lasting_move_problem(due.kind, lp);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
          first_before := first_open_board();
        end if;
        -- The Boss's trophy (0208) is checked against the instance as it is now: a character that has since become staff or retired, a trophy it was given meanwhile, a belt it
        -- already holds. Refused for good with the reason, as the machine's moves are, and never applied: it is no Act, so no award was written and nothing needs reversing.
        if due.kind = 'awardTrophy' then
          clash := trophy_move_problem(due.params, due.demand);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that trophy cannot be given: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The move's thread (the staff-board threads design, section 6): a part of a bundle goes in the thread of the bundle's earliest landed part, whenever that landed; anything else, and a bundle's first part,
        -- opens a staff thread of its own, titled for its kind. It is opened here, inside this move's block, so a part that fails to land takes its thread with it and the next one that lands opens it again.
        mt := null;
        if due.bundle is not null then
          select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null order by a.created_at, a.seq, a.id limit 1;
        end if;
        if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
        written := (write_staff_act(due.staff, 'move', mt, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        -- A ruling on a player's own character (design section 2): the member a Boss put in a group is told, as is the starter of a thread the Boss moved. A mergeBoard and a group left alert no one.
        if due.kind = 'conferGroup' then
          perform write_alert(safe_uuid(lp ->> 'character'), 'ruling', 'grouped', written, null);
        elsif due.kind = 'moveThread' then
          perform write_alert((select a.character from acts a where a.thread = safe_uuid(lp ->> 'thread') and a.seq = 1), 'ruling', 'threadMoved', written, null);
        end if;
        -- What it was built on, recorded now that it has landed: an admin's reversal of one of them follows it (reverse_move).
        if due.depends_on is not null then
          insert into move_dependencies (act, on_act) select written, d.landed_act from queued_moves d where d.id = any (due.depends_on) and d.landed_act is not null and d.landed_act <> written on conflict do nothing;
        end if;
        -- The award is the move's whole effect and outlasts it: written in this transaction, naming the move's Act, and the move ends at once (`spent`, as a nomination does). If
        -- either fails, the Act goes with them (this block's rollback) and the move is left due, with the failure recorded below.
        if due.kind = 'awardTrophy' then
          insert into trophy_awards (trophy, character, by, act) values (due.params ->> 'trophy', (due.params ->> 'character')::uuid, 'boss', written);
          perform end_move(written, 'spent', 'award');
        end if;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((lp ->> 'board')::uuid, due.admin_description, written);
        end if;
        -- A made board is a row (its slug from its name), pointing at the Act that made it; a moved thread ends the move of the same thread that was in force, as superseded; then the
        -- threads the move touched are rebuilt (lasting_rebuild), so the stored board follows the Acts.
        if due.kind = 'createBoard' then
          insert into boards (slug, name, description, created_by_act) values (board_slug_for(lp ->> 'name'), lp ->> 'name', coalesce(lp ->> 'description', ''), written);
        elsif due.kind = 'moveThread' then
          for was in
            select o.move_act from open_moves o join acts a on a.id = o.move_act
            where a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(lp ->> 'thread') and a.id <> written
            order by o.landed_at, o.move_act
          loop
            if (end_move(was.move_act, 'superseded', 'landing') ->> 'ended')::boolean then perform say_move_end(was.move_act, 'superseded'); end if;
          end loop;
        end if;
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then perform lasting_rebuild(written, first_before); end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 1b. Arcs (0332): after landing, so a bundle that landed in this tick has unlocked what waited on it in the same one. Only while The System is on (a beat unlocks for a meeting). The pass reads the
  -- season's Boss alone and costs the same however many Acts there are; a failure of it is counted and warned about and never stops the rest of the tick.
  if enabled then
    begin
      lp := arc_pass();
      arcs := (lp ->> 'unlocked')::integer + (lp ->> 'lapsed')::integer;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: the arc pass failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := move_expires_at(inforce.move_act);
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover that seated the Boss, the latest of the season's (a departure's included), or after it landed, if later, ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor') and not k.lasting
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, handed) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and not (a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null) and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then
          met := met + 1;
          -- The met demand's trophy to each character that made it (0206), in a block of its own: the move is ended whatever happens here. A failure is a warning, a row
          -- (trophy_award_failures) and a count in the tick's answer, and an admin can give the trophy by hand.
          begin
            perform award_demand_trophies(inforce.move_act);
          exception when others then
            awards_failed := awards_failed + 1;
            raise warning 'system_tick: the trophies for move % were not given: % (%)', inforce.move_act, sqlerrm, sqlstate;
            begin
              insert into trophy_award_failures (move_act, error) values (inforce.move_act, left(sqlerrm || ' (' || sqlstate || ')', 500))
              on conflict (move_act) do update set error = excluded.error, at = now();
            exception when others then null;
            end;
          end;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  -- 3b. Favors: a favor is a group conferred with a check (`params.checkAt`) and the demand it reads. It is not ended `met` by the pass above: a favor met is kept to its
  -- expiry. At its check, one whose demand is not met is stripped, `unmet`, and the Boss says so. A demand that cannot be evaluated (progress carries an `error`) is no evidence:
  -- the favor is left and read again at the next turn. The moves in force that carry a check are a handful; one past its check is read at most once in `demandCheckMinutes`, the
  -- least recently checked first, and none once the budget is spent. One already recorded met (open_moves.progress) is not read again: a demand only ever grows, and the favor
  -- is kept to its expiry.
  for inforce in
    select o.move_act, a.payload from open_moves o join acts a on a.id = o.move_act
    where a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null and (o.checked_at is null or o.checked_at <= now() - check_every)
      and coalesce((o.progress ->> 'met')::boolean, false) is not true
      -- Only a favor whose check has come (the case keeps a malformed time from being cast: the guard refuses one, and a move written any other way must not stop the tick).
      and case when a.payload #>> '{params,checkAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (a.payload #>> '{params,checkAt}')::timestamptz end <= now()
    order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      check_at := (inforce.payload #>> '{params,checkAt}')::timestamptz;
      if check_at <= now() then
        update open_moves set checked_at = now() where move_act = inforce.move_act;
        checked := checked + 1;
        counted := demand_progress_or_error(inforce.move_act);
        if not (counted ? 'error') then update open_moves set progress = counted where move_act = inforce.move_act; end if;
        if counted ? 'error' then
          failed := failed + 1;
          raise warning 'system_tick: favor % could not be read at its check: % ', inforce.move_act, counted ->> 'error';
        elsif not coalesce((counted ->> 'met')::boolean, false) then
          did_end := (end_move(inforce.move_act, 'unmet', 'check') ->> 'ended')::boolean;
          if did_end then unmet := unmet + 1; perform say_move_end(inforce.move_act, 'unmet'); end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: favor % was not checked: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent, at most `demandChecksPerTick` (the tick's one count for work per run; visits have no setting of their own); one that has failed goes behind the
  -- rest, by its last failure; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.failed_at nulls first, o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
      -- Recorded, and sent behind the others (the order above), so a visit that keeps failing never starves the rest.
      update visits_open set failed_at = now(), attempts = attempts + 1 where visit_act = late.visit_act returning attempts into tries;
      insert into visit_file_failures (visit_act, attempts, error) values (late.visit_act, coalesce(tries, 1), left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (visit_act) do update set attempts = excluded.attempts, error = excluded.error, at = now();
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (ended `dropped`, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  -- 5. Staff requests (0424): a request a persona conferred and no meeting has ruled lapses `staffRequests.daysMost` days after it was conferred (staff_requests_now.lapses_at), and one whose request post is
  -- hidden, or gone, lapses at the next tick. Whatever the switch says, as a visit is filed: a state's way out is time, so a request does not wait on The System being on. The oldest first, at most `demandChecksPerTick`
  -- (the tick's one count for work per run), and none once the budget is spent. Where the post is still public and The System is on, the Boss replies in the thread to the request post with the stock line
  -- `requestLapsed` ({boss}, {asker}: the asker as the post's public author shows, so a veiled one is the anonymous name); an instance with no such line says nothing, and a post that cannot be written is
  -- a warning, never a request left waiting (boss_request_reply writes it, as requests_ruled's replies are). The reply is written before its ruling row (which names it), so the request's key is held first: try-locked, never waited on, so a meeting ruling the same
  -- request (requests_ruled holds the same key) and this pass cannot wait on each other; one it holds is left to the next tick. It reads the queue (staff_requests_open), the requests that wait and no other, so a row is read per
  -- waiting request, which the days they wait bound, and never one per request ruled in the past. As visits are (4 above), a request that failed to lapse, or was held by a meeting, goes behind the rest by its last
  -- failure (failed_at, then the oldest first), so one request that keeps raising or keeps being held never holds a slot of the pass from the others; it is still read when the others have been, and a meeting can rule it.
  for rq in select d.id, d.request_act, d.thread from staff_requests_due(cap) d
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if not pg_try_advisory_xact_lock(hashtextextended('kayfabb.request.' || rq.id, 0)) then
        -- A meeting holds it (the row may be one its transaction has already ruled): behind the others, and never waited for (skip locked), so the tick does not wait on that transaction either.
        update staff_requests_open set failed_at = now() where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
        continue;
      end if;
      if exists (select 1 from staff_request_rulings g where g.request = rq.id) then continue; end if;
      rq_public := staff_request_post_public(rq.request_act);
      if rq_public and enabled and boss is not null then
        begin
          select s.asker_name, s.body into asked from staff_request_shown(rq.id) s;
          perform owe_line(boss, 'requestLapsed', rq.thread, rq.request_act, rq.request_act, rq.id,
            jsonb_build_object('asker', coalesce(asked.asker_name, ''), 'body', left(coalesce(asked.body, ''), 600)));
        exception when others then
          raise warning 'system_tick: the lapse of request % was not owed: % (%)', rq.id, sqlerrm, sqlstate;
        end;
      end if;
      insert into staff_request_rulings (request, ruling) values (rq.id, 'lapsed');
      lapsed_n := lapsed_n + 1;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: request % did not lapse: % (%)', rq.id, sqlerrm, sqlstate;
      -- Recorded and sent behind the others (the order above). The block's own writes are undone, so this is the one write left; a row a meeting is ruling is not waited for.
      update staff_requests_open set failed_at = now(), attempts = attempts + 1 where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
    end;
  end loop;

  -- 6. Owed lines (the persona lines plan, Task 4): a line a move's end, a request's lapse or a handover's arrival owes its speaker (lines_owed_open), not paid by the staff run within `owedLines.graceMinutes`, is posted from the
  -- speaker's stock (pay_owed_line with no body); with The System off it is paid `unsaid` ('The System is off') and nothing is posted, as the lapse above says nothing then. Whatever the switch says otherwise: the line's act has happened. The
  -- oldest first (a row that failed goes behind the rest, by its last failure, so one line that keeps raising never holds the pass), at most `demandChecksPerTick` (the tick's one count for work per run), and none once the budget is spent.
  -- The queue is the lines not yet paid, which the grace bounds, and never one per line paid in the past. A row the staff run holds is skipped (skip locked) and paid by whoever has it. A line that raises is counted and sent behind the others
  -- (the attempts), and at the fifth failure is paid `unsaid` with the reason, so no line is stuck for good; a post that the speaker cannot write is paid `unsaid` by pay_owed_line itself.
  for owed_late in
    select o.owed from lines_owed_open o where o.at <= now() - make_interval(mins => owed_grace_minutes()) order by o.failed_at nulls first, o.at, o.owed limit cap for update of o skip locked
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if enabled then
        perform pay_owed_line(owed_late.owed, null);
      else
        perform pay_owed_unsaid(owed_late.owed, 'The System is off');
      end if;
      owed_paid := owed_paid + 1;
    exception when others then
      failed := failed + 1;
      owed_error := left(sqlerrm || ' (' || sqlstate || ')', 400);
      raise warning 'system_tick: owed line % was not paid: %', owed_late.owed, owed_error;
      update lines_owed_open set failed_at = now(), attempts = attempts + 1 where owed = owed_late.owed returning attempts into owed_tries;
      if coalesce(owed_tries, 1) >= 5 then
        begin
          perform pay_owed_unsaid(owed_late.owed, 'it could not be paid after 5 tries: ' || owed_error);
        exception when others then
          raise warning 'system_tick: owed line % could not be dropped: % (%)', owed_late.owed, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n, 'owedPaid', owed_paid);
end $$;


-- season_news (0443, part 1), a Boss's arrival read through its payment: where the handover owed its arrival (lines_owed), the quote is the post that payment made (lines_paid.act), found by the debt's key (facts.handover) and
-- never by time; a debt not yet paid, or paid unsaid, has no arrival to show. A handover with no debt (one recorded before the migration) is read as it was, by the thread or the instant. Everything else as part 1 wrote it.
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
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line, h.thread as handover_thread, h.handover as handover_id from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, case when h.cause = 'departure' then h.number else h.number - 1 end, 'bossFarewell', h.thread, h.handover from season_boss_changes h
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
    -- A handover whose arrival was owed (lines_owed, 0443): the arrival is the post its payment made, by the debt's key (facts.handover), and no other post stands for it; a handover recorded before there was a debt is read as it was.
    cross join lateral (select exists (select 1 from lines_owed w where w.line_key = 'bossArrival' and w.facts ->> 'handover' = c.handover_id::text and c.line = 'bossArrival') as owed) ow
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from lines_owed w join lines_paid pd on pd.owed = w.id join acts a on a.id = pd.act
      where ow.owed and w.line_key = 'bossArrival' and w.facts ->> 'handover' = c.handover_id::text
      order by w.id limit 1
    ) po on true
    left join lateral (
      -- A handover with a thread of its own: the Boss's first post there, by the thread's (thread, seq) index. An older handover has none: the Boss's first post in the announcements thread at that instant, by created_at. Each branch is its own lateral so each keeps its own index; one OR across both made the planner give up the created_at probe.
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.thread = c.handover_thread and a.character = ch.id
      where not ow.owed and c.handover_thread is not null and ch.staff = c.who and a.kind = 'post'
        and stock_lines(c.line, c.who) is not null
      order by a.seq limit 1
    ) ph on true
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where not ow.owed and c.handover_thread is null and ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and stock_lines(c.line, c.who) is not null
      order by a.seq limit 1
    ) pa on true
    cross join lateral (select coalesce(po.id, ph.id, pa.id) as id, coalesce(po.thread, ph.thread, pa.thread) as thread, coalesce(po.seq, ph.seq, pa.seq) as seq, coalesce(po.body, ph.body, pa.body) as body) p
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
