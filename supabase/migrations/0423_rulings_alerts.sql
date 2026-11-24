-- Rulings and missing alerts (docs/plans/2026-11-23-rulings-and-missing-alerts-plan.md; the design is docs/plans/2026-11-23-rulings-and-missing-alerts-design.md).
--
-- Section 1 (design section 7): the kinds and the toast preferences. `gift` and `conduct` join the alert kinds, last, so a player's toast choice can name them and the
-- toastDefaults setting may too. The kinds are one list in four places (engine/rules/alerts.ts, the alerts check, the account preferences check, set_preferences and settings_held;
-- engine/rules/alerts.test.ts holds them to it), each redefined whole from its latest definition: both checks from 0213, set_preferences from 0213, settings_held from 0416.
-- Ways out: nothing here adds a state a player can be put in.

-- Section 1 (design section 7): the kinds and the toast preferences
alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct'));

alter table account_preferences drop constraint account_preferences_toasts_check;
alter table account_preferences add constraint account_preferences_toasts_check
  check (toasts is null or toasts <@ array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct']);

-- set_preferences (0213), with the new kinds among those a toast may name. Everything else as 0213 wrote it: dropped and made again with 0213's signature, with its revoke and grant restated.
drop function set_preferences(text, text, text, text, text, integer, text, text, text, integer, text, integer, text, text[], boolean);

create function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null, tilt text default null, effects text default null,
  game_sound text default null, game_volume integer default null, interface_sound text default null, interface_volume integer default null, mode text default null,
  toasts text[] default null, toasts_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
  known text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct'];
  bad text;
  once text[];
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full', 'snappy') then raise exception 'motion follows the system, or is off, smooth or snappy' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if tilt is not null and tilt not in ('off', 'on') then raise exception 'tilt is off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if effects is not null and effects not in ('standard', 'bright') then raise exception 'effects are standard or bright' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if game_sound is not null and game_sound not in ('off', 'on') then raise exception 'game sounds are off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if interface_sound is not null and interface_sound not in ('off', 'on') then raise exception 'interface sounds are off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if game_volume is not null and (game_volume not between 0 and 100 or game_volume % 5 <> 0) then raise exception 'a volume is 0 to 100, in steps of 5' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if interface_volume is not null and (interface_volume not between 0 and 100 or interface_volume % 5 <> 0) then raise exception 'a volume is 0 to 100, in steps of 5' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if mode is not null and mode not in ('system', 'light', 'dark') then raise exception 'the mode follows the device, or is light or dark' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null and coalesce(toasts_default, false) then raise exception 'the toasts are chosen or put back to the defaults, not both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null then
    select string_agg(coalesce(k, '(blank)'), ', ' order by first) into bad from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) where k is null or not k = any (known) group by k) u;
    if bad is not null then raise exception 'not a kind of alert: %', bad using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Repaired, not refused: the same kind named twice is the kind once, in the order it was first named.
    select coalesce(array_agg(k order by first), '{}') into once from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) group by k) d;
  end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size, tilt, effects, game_sound, game_volume, interface_sound, interface_volume, mode, toasts)
  values (caller, coalesce(theme, 'default'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100), coalesce(tilt, 'off'), coalesce(effects, 'standard'),
    coalesce(game_sound, 'off'), coalesce(game_volume, 80), coalesce(interface_sound, 'off'), coalesce(interface_volume, 80), coalesce(mode, 'system'), once)
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size),
    tilt = coalesce(set_preferences.tilt, p.tilt), effects = coalesce(set_preferences.effects, p.effects),
    game_sound = coalesce(set_preferences.game_sound, p.game_sound), game_volume = coalesce(set_preferences.game_volume, p.game_volume),
    interface_sound = coalesce(set_preferences.interface_sound, p.interface_sound), interface_volume = coalesce(set_preferences.interface_volume, p.interface_volume), mode = coalesce(set_preferences.mode, p.mode),
    toasts = case when coalesce(set_preferences.toasts_default, false) then null when set_preferences.toasts is not null then once else p.toasts end
  returning * into kept;
  return preferences_answer(kept);
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer, text, text, text, integer, text, integer, text, text[], boolean) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer, text, text, text, integer, text, integer, text, text[], boolean) to authenticated;

-- settings_held (0416), with the new kinds among those the toastDefaults setting may name. Everything else as 0416 wrote it.
create or replace function settings_held()
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Section 2 (design section 1): what a Mod Bot's work lands
-- ---------------------------------------------------------------------------------------------------------------------

-- file_visit (0361_discipline_cards), telling the character the infraction landed on, and the author where a fall was taken. Everything else as 0361 wrote it.
CREATE OR REPLACE FUNCTION public.file_visit(visit_act uuid, line text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v acts%rowtype;
  charges jsonb;
  top jsonb;
  who uuid;
  mod_key text;
  said text;
  ended jsonb;
  hit jsonb;
  author uuid;
  fall uuid;
  taker uuid;
begin
  select * into v from acts a where a.id = file_visit.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The lock order this file keeps, here and in every writer a fall meets: the post's row (place_cast takes it to lay a play on a post, so a fall cast and a filing are laid one after the other, and the one that goes
  -- second sees the first), then the visit's open row (the row end_visit takes: the end and the infraction are one decision, and the one that waits finds the visit ended), then, inside infract, the row of the
  -- character the infraction lands on. place_cast at post reach takes the post's row; at character reach it takes the character's row alone. start_visit takes advisory locks (visit:<post>, cap:<author>) and then
  -- the open row, and no post row today. `for no key update` is place_cast's own mode, so the two conflict; it does not conflict with a key share (a foreign key) or a read.
  -- The rule for a later change: post first everywhere. Any path that takes both a post row and a character row takes the post's first (so a path that plays from a post on a character takes the post it is cast from
  -- before the character), and a path that takes the open row takes the post's before it. Then no two writers hold one and want the other.
  perform 1 from acts p where p.id = v.target_act_id for no key update;
  perform 1 from visits_open o where o.visit_act = v.id for update;
  charges := visit_charges(v.id);
  top := (select c from jsonb_array_elements(charges) with ordinality e(c, n)
          order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc, n limit 1);
  mod_key := (select c.staff from characters c where c.id = v.character);
  said := coalesce(nullif(btrim(coalesce(line, '')), ''), visit_line('visitFiled', mod_key, charges));
  ended := end_visit(v.id, 'filed', null, said);
  if not (ended ->> 'ended')::boolean then
    return jsonb_build_object('filed', false, 'end_act', ended -> 'end_act', 'outcome', ended ->> 'outcome');
  end if;
  author := (select a.character from acts a where a.id = v.target_act_id);
  who := author;
  -- Task 4 (section 3), taking the fall: the oldest live play of a fall card on the post's own reach that no infraction names, not caught (a caught play holds no place) and not ended by an admin; its caster takes
  -- the filing in the author's place. The play is a public Act, so nothing here reads an owner. A caster infract would refuse where it would not refuse the author (a staff character now: infract warns a player
  -- character alone; a character that is gone cannot be, an Act's character being a foreign key) takes no fall: the filing lands on the author as if there were none, and the play stays unspent. A caster who is
  -- banned now takes it, as infract warns a banned character today. The post's row is held (above), so nothing spends this play or lays another between this read and the infraction.
  select k.id, k.character into fall, taker
  from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.discipline ->> 'kind' = 'fall'
  where k.kind = 'card' and k.target_act_id = v.target_act_id and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught') and not card_ended(k.id)
    and not exists (select 1 from acts i where i.kind = 'infraction' and i.payload ? 'fall_play' and i.payload ->> 'fall_play' = k.id::text)
  order by k.created_at, k.id limit 1;
  if fall is not null and taker is distinct from author and exists (select 1 from characters c where c.id = taker and c.staff is null) then
    who := taker;
  else
    fall := null;
  end if;
  hit := infract(who, top ->> 'band', v.target_act_id, mod_key, nullif(top ->> 'rule_number', '')::integer, v.id, fall);
  -- A filing is the one thing that tells the visited: the character the infraction landed on hears a ban or a warning, about that Act. Where a fall was taken, the author hears `fallTaken` about the infraction, acting as the taker's player,
  -- so a player who took the fall for their own other mask hears nothing on it. A visit that ended any other way (intercepted, trapped, reversed, dropped) returned above and wrote nothing.
  perform write_alert(who, 'ruling', case when hit ->> 'ban' is not null then 'ban' else 'warning' end, coalesce((hit ->> 'ban')::uuid, (hit ->> 'infraction')::uuid), null);
  if fall is not null then
    perform write_alert(author, 'ruling', 'fallTaken', (hit ->> 'infraction')::uuid, (select c.owner from characters c where c.id = who));
  end if;
  return jsonb_build_object('filed', true, 'end_act', ended -> 'end_act') || hit;
end $function$;
revoke execute on function file_visit(uuid, text) from public, anon, authenticated;
grant execute on function file_visit(uuid, text) to service_role;

-- close_appeal (0361_discipline_cards), telling the appellant the ruling. Everything else as 0361 wrote it.
CREATE OR REPLACE FUNCTION public.close_appeal(appeal_act uuid, verdict text, line text DEFAULT NULL::text, staff text DEFAULT NULL::text, most_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ap acts%rowtype;
  pun acts%rowtype;
  ruling acts%rowtype;
  mod_key text;
  who uuid;
  appellant text;
  said text := left(btrim(coalesce(close_appeal.line, '')), 280);
  v text := close_appeal.verdict;
  pts integer;
  delta integer := 0;
  payload jsonb;
  hit jsonb;
  new_until timestamptz;
  days integer;
  paid record;
  amount integer := 0;
  written uuid;
  key text;
  own_end timestamptz;
  length interval;
  most_all numeric;
  most numeric;
  ended boolean := false;
begin
  select * into ap from acts a where a.id = close_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The appeal's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  select * into ruling from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id;
  if found then
    -- The ruling's own numbers, so a retry after a lost answer reports the true outcome.
    return jsonb_build_object('closed', false, 'existing', true, 'ruling_act', ruling.id, 'verdict', ruling.payload ->> 'verdict', 'line', ruling.payload ->> 'line',
      'points_delta', (ruling.payload ->> 'points_delta')::integer,
      'refunded_amount', coalesce((select f.amount from appeal_refunds f where f.appeal_act = ap.id and f.why = 'overturned'), 0))
      || case when ruling.payload ? 'until' then jsonb_build_object('until', ruling.payload ->> 'until') else '{}'::jsonb end;
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if v is null or v not in ('overturned', 'upheld', 'reduced', 'increased') then
    raise exception 'an appeal is answered with overturned, upheld, reduced or increased, not %', coalesce(v, 'nothing') using errcode = '22023';
  end if;
  select * into pun from acts a where a.id = ap.target_act_id;
  -- A move ends under its own lock (end_move's): the ruling, the tick and an apology's end are then one after another, and a move one of them ended is seen as ended here.
  if pun.kind = 'move' then perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(pun.id::text)); end if;
  -- The punishment ran out while the appeal waited: nothing is left to rule on, and an increase must not revive it. No ruling; the price comes back (the appeal stays used).
  if not punishment_running(pun.id) then
    perform refund_appeal(ap.id, 'expired');
    return jsonb_build_object('closed', false, 'refunded', true, 'expired', true, 'reason', 'that punishment had already run out before the appeal was heard, so nothing was ruled and your Aura is back');
  end if;
  mod_key := appeal_hearer(pun.id);
  if mod_key is null then raise exception 'no one is on staff to hear an appeal' using errcode = '55000'; end if;
  if close_appeal.staff is not null and close_appeal.staff <> mod_key then
    raise exception 'this appeal is heard by someone else now' using errcode = '55000';
  end if;
  who := ap.character;
  appellant := (select c.name from characters c where c.id = who);

  if pun.kind = 'move' then
    own_end := (pun.payload ->> 'expires_at')::timestamptz;
    -- A move that ends only by an apology or an admin has no length to halve or add to: the model's other verdicts are written as upheld, in the stock line.
    if own_end is null and v in ('reduced', 'increased') then v := 'upheld'; said := ''; end if;
  end if;
  payload := jsonb_build_object('appeal_act', ap.id, 'verdict', v);

  if pun.kind = 'infraction' then
    pts := (pun.payload ->> 'points')::integer;
    if v = 'overturned' then delta := -pts;
    elsif v = 'reduced' then delta := -least(pts, greatest(1, (pts + 1) / 2));
    elsif v = 'increased' then
      -- One more infraction of the same band for the same post: at most one band's points, and a full bar bans. A fall's infraction names its play again, so the increase lands on the same character, the one who appealed (Task 4).
      hit := infract(who, pun.payload ->> 'band', (pun.payload ->> 'about_act')::uuid, mod_key, nullif(pun.payload ->> 'rule_number', '')::integer, nullif(pun.payload ->> 'visit_act', '')::uuid, nullif(pun.payload ->> 'fall_play', '')::uuid);
      delta := (hit ->> 'points')::integer;
      payload := payload || jsonb_build_object('infraction_act', hit ->> 'infraction');
    end if;
  elsif pun.kind = 'move' then
    -- Its length is from its landing to its own end. A reduction ends it at landing plus half the length (the end may be behind us); an increase adds half the length, but
    -- never past the phase's most days from landing (the smaller of the phase's number and the instance's own).
    length := own_end - pun.created_at;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + length / 2;
    elsif v = 'increased' then
      -- The instance's setting is the outer limit (setting() raises where it is missing); the phase's number, where the call has one, can only lower it.
      most_all := (setting('moveExpiryMostDays') #>> '{}')::numeric;
      most := greatest(1, least(coalesce(close_appeal.most_days, most_all), most_all));
      new_until := own_end + least(length / 2, greatest(interval '0', most * interval '1 day' - length));
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  else
    -- A ban: its length is its days; a reduction counts half of them from the ban's start, an increase runs half of them past its end.
    days := (pun.payload ->> 'days')::integer;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + days * interval '12 hours';
    elsif v = 'increased' then new_until := (pun.payload ->> 'until')::timestamptz + days * interval '12 hours';
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  end if;

  key := 'appeal' || initcap(v);
  said := coalesce(nullif(said, ''), appeal_line(key, mod_key, appellant));
  payload := payload || jsonb_build_object('points_delta', delta, 'line', said);
  written := (write_staff_act(mod_key, 'appeal_ruling', ap.thread, ap.id, payload) ->> 'id')::uuid;
  -- The appellant hears the ruling, about the ruling Act. An `increased` verdict's extra points or ban are told in this one alert: its call to infract above writes no warning or ban of its own.
  perform write_alert(ap.character, 'ruling', 'appealAnswered', written, null);

  -- A move's effect: overturned ends it at once; a reduction that has already run its course ends it now. Each is end_move's, so a move something else just ended is not ended twice.
  if pun.kind = 'move' then
    if v = 'overturned' then
      ended := (end_move(pun.id, 'overturned', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'overturned'); end if;
    elsif v = 'reduced' and new_until <= now() then
      ended := (end_move(pun.id, 'expired', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'expired'); end if;
    end if;
  end if;

  -- An overturned appeal gets its price back.
  if v = 'overturned' then
    select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
    amount := coalesce(paid.price, 0);
    insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, 'overturned');
    if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  end if;
  return jsonb_build_object('closed', true, 'ruling_act', written, 'verdict', v, 'staff', mod_key, 'line', said, 'points_delta', delta, 'refunded_amount', amount)
    || case when new_until is not null then jsonb_build_object('until', new_until) else '{}'::jsonb end
    || case when ended then jsonb_build_object('ended', true) else '{}'::jsonb end
    || case when hit is not null then jsonb_build_object('infraction', hit ->> 'infraction', 'ban', hit -> 'ban') else '{}'::jsonb end;
end $function$;
revoke execute on function close_appeal(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function close_appeal(uuid, text, text, text, integer) to service_role;

-- refund_appeal (0109_appeals), telling the appellant the appeal was refunded unheard. Everything else as 0109 wrote it.
create or replace function refund_appeal(appeal_act uuid, why text default 'failed') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ap acts%rowtype;
  paid record;
  amount integer;
begin
  select * into ap from acts a where a.id = refund_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  if exists (select 1 from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id) then
    return jsonb_build_object('refunded', false, 'closed', true);
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('refunded', false, 'already', true);
  end if;
  select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
  amount := coalesce(paid.price, 0);
  insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, coalesce(refund_appeal.why, 'failed'));
  if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  -- The one place a refund of an unheard appeal is told: close_appeal's expired path and the stale sweep both come through here, so each refund writes it once (the checks above return before any second refund).
  perform write_alert(ap.character, 'ruling', 'appealRefunded', ap.id, null);
  return jsonb_build_object('refunded', true, 'amount', amount);
end $$;
revoke execute on function refund_appeal(uuid, text) from public, anon, authenticated;
grant execute on function refund_appeal(uuid, text) to service_role;

-- refund_report (0401_report_no_visit), telling the reporter the report was refunded unheard. Everything else as 0401 wrote it.
create or replace function refund_report(report_act uuid, why text default 'failed') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  amount integer;
begin
  -- A no-visit refund (veiled, visited) is written by close_report beside its verdict and by nothing else, so no call can write one without it.
  if refund_report.why is not null and refund_report.why not in ('failed', 'stale') then
    raise exception 'refund_report refunds a failed or a stale report, not %', refund_report.why using errcode = '22023';
  end if;
  select * into r from acts a where a.id = refund_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  if exists (select 1 from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id) then
    return jsonb_build_object('refunded', false, 'closed', true);
  end if;
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('refunded', false, 'already', true);
  end if;
  amount := pay_report_back(r.id, coalesce(refund_report.why, 'failed'));
  -- A report refunded unheard is told here, once (the checks above return before a second refund). close_report's no-visit refund (veiled, visited) is beside a verdict and is told by that verdict's reportJudged.
  perform write_alert(r.character, 'ruling', 'reportRefunded', r.id, null);
  return jsonb_build_object('refunded', true, 'amount', amount);
end $$;
revoke execute on function refund_report(uuid, text) from public, anon, authenticated;
grant execute on function refund_report(uuid, text) to service_role;

-- close_report (0401_report_no_visit), telling the reporter the verdict. Everything else as 0401 wrote it.
create or replace function close_report(report_act uuid, verdict text, line text default null, charge jsonb default null, staff text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  v acts%rowtype;
  thr_board uuid;
  board record;
  mod_key text;
  reporter text;
  said text := left(btrim(coalesce(close_report.line, '')), 280);
  rn integer;
  house boolean;
  rule_row rules_now%rowtype;
  ch jsonb;
  band text;
  words text;
  started jsonb;
  target uuid;
  payload jsonb;
  written uuid;
  repaired boolean := false;
  reason text;
  amount integer;
begin
  select * into r from acts a where a.id = close_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The report's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  -- The verdict is checked first: a no-visit report holds a verdict and a refund, so a refund found first would answer a retried close with "refunded before the Mod answered
  -- it", which is false. A verdict answers as it did, with its refund where it has one; a refund with no verdict is a report refunded before it was judged.
  select * into v from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id;
  if found then
    return jsonb_build_object('closed', false, 'existing', true, 'verdict_act', v.id, 'verdict', v.payload ->> 'verdict') ||
      case when v.payload ? 'visit_act' then jsonb_build_object('visit', v.payload -> 'visit_act') else '{}'::jsonb end ||
      coalesce((select jsonb_build_object('refund', jsonb_build_object('why', f.why, 'amount', f.amount)) from report_refunds f where f.report_act = r.id), '{}'::jsonb);
  end if;
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if close_report.verdict is null or close_report.verdict not in ('visit', 'dismissed', 'backfire') then
    raise exception 'a report is answered with a visit, a dismissal or a backfire, not %', coalesce(close_report.verdict, 'nothing') using errcode = '22023';
  end if;
  select t.board into thr_board from threads t where t.id = r.thread;
  select b.id, b.name, b.premise into board from boards_now b where b.id = thr_board;
  mod_key := case when close_report.staff is not null and exists (select 1 from staff_now n where n.staff = close_report.staff) then close_report.staff else beat_of(board.id) end;
  if mod_key is null then raise exception 'no Mod is on staff to answer a report' using errcode = '55000'; end if;
  reporter := (select c.name from characters c where c.id = r.character);

  if close_report.verdict = 'visit' then
    -- The charge, repaired: a rule in force on the board (or a house rule, when it says so) with the rule's own band, else the board's premise at the minor band.
    if jsonb_typeof(close_report.charge) = 'object' then
      if jsonb_typeof(close_report.charge -> 'rule_number') = 'number' and (close_report.charge ->> 'rule_number')::numeric = trunc((close_report.charge ->> 'rule_number')::numeric)
         and (close_report.charge ->> 'rule_number')::numeric between 1 and 100000 then
        rn := (close_report.charge ->> 'rule_number')::integer;
      end if;
      house := coalesce(close_report.charge -> 'house' = 'true'::jsonb, false);
      band := close_report.charge ->> 'band';
    end if;
    if rn is not null then
      select * into rule_row from rules_now x where x.number = rn and case when house then x.board is null else x.board = board.id end limit 1;
    end if;
    if rule_row.move_act is not null then
      select 'Rule ' || rule_row.number || ': ' || fill_tokens(x.plain, jsonb_build_object('param', coalesce(rule_row.param #>> '{}', ''))) into words from rule_predicates x where x.key = rule_row.predicate;
      if rule_row.board is null then words := 'House ' || words; end if;
      ch := jsonb_build_object('rule_number', rule_row.number, 'board', board.id, 'band', rule_row.band, 'cause', 'report', 'about_act', r.target_act_id, 'predicate', rule_row.predicate, 'rule', words);
    else
      if rn is not null or band is null or band not in ('minor', 'moderate', 'severe') then band := 'minor'; repaired := rn is not null; end if;
      ch := jsonb_build_object('rule_number', null, 'board', board.id, 'band', band, 'cause', 'report', 'about_act', r.target_act_id, 'rule', 'the premise of ' || board.name);
    end if;
    started := start_visit(r.target_act_id, mod_key, ch);
    -- A visit that opened none: the reason start_visit named, or a fault. Nothing is written for a reason a report cannot meet (the staff function then refunds the report as failed).
    if started ->> 'visit' is null then
      reason := case when started ->> 'veiled' = 'true' then 'veiled' when started ->> 'repeat' = 'true' then 'visited' end;
      if reason is null then
        raise exception 'a report''s visit opened none, for no reason a report can meet: %', started using errcode = 'P0001';
      end if;
    end if;
    said := coalesce(nullif(said, ''), visit_line('visitArrived', mod_key, jsonb_build_array(ch)));
  elsif close_report.verdict = 'dismissed' then
    said := coalesce(nullif(said, ''), report_line('reportDismissed', mod_key, reporter));
  else
    -- The reporter's latest post, charged minor with wasting the staff's time. A reporter with no post has nothing to visit: the verdict still lands.
    select a.id into target from acts a where a.character = r.character and a.kind in ('post', 'spin') order by a.created_at desc, a.id desc limit 1;
    if target is not null then
      started := start_visit(target, mod_key, jsonb_build_object('rule_number', null, 'board', (select t.board from threads t join acts a on a.thread = t.id where a.id = target), 'band', 'minor',
        'cause', 'backfire', 'about_act', target, 'rule', 'wasting the staff''s time'));
    end if;
    said := coalesce(nullif(said, ''), report_line('reportBackfired', mod_key, reporter));
  end if;

  payload := jsonb_build_object('report_act', r.id, 'verdict', close_report.verdict, 'line', said);
  if started is not null and started ->> 'visit' is not null then payload := payload || jsonb_build_object('visit_act', started ->> 'visit'); end if;
  written := (write_staff_act(mod_key, 'report_verdict', r.thread, r.id, payload) ->> 'id')::uuid;
  perform write_alert(r.character, 'ruling', 'reportJudged', written, null);
  if reason is not null then amount := pay_report_back(r.id, reason); end if;
  return jsonb_build_object('closed', true, 'verdict_act', written, 'verdict', close_report.verdict, 'staff', mod_key, 'line', said, 'charge_repaired', repaired)
    || case when started is not null then jsonb_build_object('visit', started ->> 'visit', 'started', started) else '{}'::jsonb end
    || case when reason is not null then jsonb_build_object('refund', jsonb_build_object('why', reason, 'amount', amount)) else '{}'::jsonb end;
end $$;
revoke execute on function close_report(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function close_report(uuid, text, text, jsonb, text) to service_role;


-- Section 3 (design section 2): a Boss's moves that land on yours
-- system_tick (0403_departed_personas.sql), a landed conferGroup writes the member one ruling/grouped alert and a landed moveThread writes the thread's starter (the character of its first Act) one ruling/threadMoved alert,
-- both about the move's Act (write_alert skips staff and a character with no owner); a mergeBoard and a group left write nothing. Everything else as 0403_departed_personas.sql wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
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
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places;
  -- a move landed before it writes an Act into the announcements thread, a row an admin's reversal (which takes the key and then writes its end into that thread) waits for, so the key cannot wait until the
  -- first lasting landing. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
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
        written := (write_staff_act(due.staff, 'move', ann, null,
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

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'noThread', enabled and ann is null, 'awardsFailed', awards_failed);
end $$;

-- ===================================================================================== Section 4 ====
-- Section 4 (design section 3): an admin's in-game acts on yours
-- Each function is copied whole from its latest definition before this migration; only the alert is added. Their grants are as they were: create or replace keeps them, and each revoke and grant that followed a definition is copied with it.
--   reverse_card         0405_cut.sql: beside the caster's alert, the target's cardEnded/onYours about the card_end, the caster's owner acting. The target is found as my_cards_ended (0402) finds it:
--                        the post's author (post reach), the character (character reach), the thread's starter (thread reach; the Act of seq 1 in the thread, as the view reads it), the locked character
--                        of a lockout, none at board reach.
--   reverse_award        0206_trophies.sql: ruling/trophyReversed to the award's character, about no Act.
--   close_poll_as_admin  0395_polls.sql: ruling/pollClosed to the poll post's character, about the close Act.
--   grant_gear           0213_cosmetics_log.sql: ruling/gearGiven to the character, about no Act, once per grant.
-- Ways out: nothing here adds a state a player can be put in; an alert is read and cleared as every alert is.

create or replace function reverse_card(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  written uuid;
  target uuid;
begin
  perform only_admins('ends a card');
  -- The play's row is locked, so two admins at once write one end between them and the second sees the first's.
  select * into p from acts a where a.id = play and (a.kind = 'card' or (a.kind = 'spring' and a.payload ->> 'did' = 'lockedOut')) for no key update;
  if not found then raise exception 'that is not a card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.kind = 'spring' then
    -- A sprung lockout: over once its `until` has passed. It has no caught, ends, reach, keeps or refunds: those are a card play's.
    if (p.payload ->> 'until')::timestamptz <= now() then
      raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
      raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  else
  if p.payload ? 'caught' then raise exception 'that card was caught by a trap, so it never landed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- A play of a kind that keeps still counts on the posts it was up over after its time (thread_page's `kept`), so an admin may end it then.
  if ((p.payload ->> 'ends')::timestamptz <= now() or exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now()))
     and not coalesce((select ck.keeps from card_kinds ck where ck.key = p.payload ->> 'card'), false) then
    raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
    raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from card_write_refunds r where r.play = p.id) then
    raise exception 'That card didn''t take, so there is nothing of it on this post.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- A play a card that cuts ended: the card that did it is named, since ending that card is what brings this one back (card_cut_at reads the cutting plays an admin has not ended).
  if card_cut_at(p.id) is not null then
    raise exception 'a % already ended that card; end that card to bring this one back',
      (select ck.name from acts c join card_kinds ck on ck.key = c.payload ->> 'card'
       where c.kind = 'card' and (c.payload -> 'cut' ->> 'play') = p.id::text and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)
       order by c.created_at, c.id limit 1)
      using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Any other way a play is over (a pierce a cast spent): it is not an admin's to end again.
  if card_ended(p.id) then raise exception 'that card is already over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'card_end', p.thread, p.id, jsonb_build_object('why', 'reversed', 'by', 'admin')) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  -- The caster's alert (Task 4; for a lockout, the setter's, as the spring is the setter's Act): one, in this transaction, for the caster's own player, about the card_end. write_alert writes none
  -- for a staff character (no owner), so a staff play's end tells nobody. `acting` is null: the admin is not told apart from the caster.
  perform write_alert(p.character, 'cardEnded', null, written, null);
  -- The target's alert (Task 5; design section 3), found as my_cards_ended finds the target side: the post's author at post reach, the character at character reach, the thread's starter at thread reach,
  -- the locked character for a lockout, and none at board reach. `acting` is the caster's owner, so a play on one's own other mask tells the caster alone.
  if p.kind = 'spring' then
    target := (p.payload ->> 'locks')::uuid;
  else
    select case coalesce(pr.reach, 'post')
             when 'post' then (select x.character from acts x where x.id = p.target_act_id)
             when 'character' then pr.character
             when 'thread' then (select o.character from acts o where o.thread = pr.thread and o.seq = 1)
           end
      into target from (select 1) one left join play_reach pr on pr.play = p.id;
  end if;
  perform write_alert(target, 'cardEnded', 'onYours', written, (select c.owner from characters c where c.id = p.character));
  -- The answer carries the play, and for a play beyond a post its reach, so the act function can broadcast the end on `reach`.
  return act_projection(written) || jsonb_strip_nulls(jsonb_build_object('play', p.id,
    'reach', case when p.payload ->> 'reach' in ('character', 'thread', 'board') then p.payload ->> 'reach' end));
end $$;;

create or replace function reverse_award(of_award uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  taken uuid;
begin
  perform only_admins('takes a trophy back');
  perform 1 from trophy_awards where id = of_award for share;
  if not found then raise exception 'there is no such trophy' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into trophy_reversals (award, by) values (of_award, signed_in_account()) on conflict (award) do nothing returning award into taken;
  if taken is null then raise exception 'that trophy was already taken back' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  delete from trophies_shown where award = of_award;
  -- The award's character is told (Task 5): a ruling about no Act, since the log names which award.
  perform write_alert((select a.character from trophy_awards a where a.id = of_award), 'ruling', 'trophyReversed', null, null);
  return jsonb_build_object('reversed', of_award);
end $$;
revoke execute on function reverse_award(uuid) from public, anon;
grant execute on function reverse_award(uuid) to authenticated;

create or replace function close_poll_as_admin(poll uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  closed jsonb;
begin
  perform only_admins('closes a poll');
  closed := poll_close_written(close_poll_as_admin.poll, null);
  -- The poll post's character is told (Task 5), about the close Act.
  perform write_alert((select a.character from acts a where a.id = close_poll_as_admin.poll), 'ruling', 'pollClosed', (closed -> 'act' ->> 'id')::uuid, null);
  return closed;
end $$;
revoke execute on function close_poll_as_admin(uuid) from public, anon;
grant execute on function close_poll_as_admin(uuid) to authenticated;

create or replace function grant_gear(of_character uuid, gear_key text, copies integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  its_owner uuid;
begin
  perform only_admins('grants gear');
  if copies is null or copies not between 1 and 100 then raise exception 'a grant is 1 to 100 copies' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not exists (select 1 from gear_kinds k where k.key = gear_key) then raise exception 'there is no gear "%"', gear_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select owner into its_owner from characters where id = of_character;
  if its_owner is null then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into gear_ledger (account, gear, kind, through) select its_owner, gear_key, 'granted', of_character from generate_series(1, copies);
  -- The character is told (Task 5), about no Act: the log names the gear.
  perform write_alert(of_character, 'ruling', 'gearGiven', null, null);
  return jsonb_build_object('granted', copies);
end $$;
