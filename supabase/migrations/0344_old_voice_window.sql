-- The old voice's window: the settings that bound what the old voice is sent and what a play may buy (docs/plans/2026-11-12-old-voice-window-design.md §4,
-- docs/plans/2026-11-12-old-voice-window-plan.md Task 2). A row is held alone: the floor below the window is not checked here, since the most a play may buy
-- is computed (the smaller of its own most and the window less the floor), so no pair of rows can be wrong.
--
-- settings_held (0340) holds five settings more: oldVoiceWindow (a whole number of tokens from 64 to 1,000,000), oldVoiceTokenizer ("gpt2" or "bytes"),
-- oldVoicePromptFloor (a whole number of tokens, at least 1), cardWriteShortShare (a number from 0 to 1) and cardWriteRerolls (a whole number from 0 to 5), each
-- in the words of settingsProblems. Everything else in it is as 0340 left it, and so are its grants.
-- screen_settings (0156) shows oldVoiceWindow and oldVoicePromptFloor, so a length slider offers only lengths that fit. The tokenizer, the share and the re-rolls
-- are the server's and stay off it. Everything else in the view is as 0156 left it.

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
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    -- The old voice's window (§4 of docs/plans/2026-11-12-old-voice-window-design.md), in the words engine/rules/instance.ts gives each.
    when 'oldVoiceWindow' then case when not setting_whole(v, 64, 1000000) then 'a whole number of tokens from 64 to 1,000,000' end
    when 'oldVoiceTokenizer' then case when v not in ('"gpt2"', '"bytes"') then '"gpt2" or "bytes"' end
    when 'oldVoicePromptFloor' then case when not setting_whole(v, 1) then 'a whole number of tokens, at least 1' end
    when 'cardWriteShortShare' then case when not coalesce(case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 1 end, false) then 'a number from 0 to 1' end
    when 'cardWriteRerolls' then case when not setting_whole(v, 0, 5) then 'a whole number from 0 to 5' end
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
end $function$;
revoke execute on function settings_held() from public, anon, authenticated;

create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select unnest(k.reads) from card_kinds k)))
         || jsonb_build_object('groups', (
              select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', g.key, 'name', g.name, 'badge', g.badge, 'color', g.color, 'stripe', g.stripe, 'staff', g.condition = 'staff'))
                                        order by g.source = 'conferred', coalesce(g.rung, 0), g.key), '[]'::jsonb) from group_kinds g)) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'searchLanguage', 'searchRankPool', 'pronouns', 'setLasts',
                  'oldVoiceWindow', 'oldVoicePromptFloor');
