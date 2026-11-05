-- Cost at scale (docs/plans/2026-11-03-cost-at-scale-design.md, section 3; plan Task 3): every setting is held where it is written.
--
-- engine/rules/instance.ts (SETTINGS) names what each setting must be, and settingsProblems checks a seed against it. The database
-- held only some of them, so a row written past the seed (an admin's screen, a hand-run update) could break a rule the engine
-- depends on, and the first sign was a failure somewhere else. settings_held() holds the rest: one branch for each key in SETTINGS
-- that no earlier trigger holds, each mirroring its TypeScript rule's bounds and raising '<key> is <the rule's words>' with 23514,
-- so the refusal names the predicate that failed.
--
-- Held before this migration, by their own triggers, and left as they are: editGrace (0022, 0041), presenceWindow (0041),
-- settlementLength, seasonLength, turnCooldown (0007, 0020, 0054), inviteLifetime (0020, 0054), setLasts (0054),
-- invitesPerPlayer (0020), reachRarity and reachLasts (0055) and economy (0006).
-- Held here, although the plan counted them as held: the three crons (settlementCron, viewCountCron, meetingCron) and
-- systemEnabled, whose triggers only reschedule a job after the write and check nothing. Held here too, for one edge: the seven
-- span keys (settlementLength, seasonLength, turnCooldown, inviteLifetime, setLasts, editGrace, presenceWindow), whose earlier
-- holds let a span with no count through (their test is null, not false); a branch here refuses it.
--
-- A JSON number is read as JavaScript reads it: one past a double's range is Infinity there (refused as not finite), and one
-- too small for a double is 0 there (refused where above 0 is wanted), so those bounds are written here as numbers.
--
-- A whole number is a JSON number with no fraction inside JavaScript's safe integers, as Number.isSafeInteger reads it
-- (engine/rules/instance.ts, isWhole). A key outside SETTINGS (the copy, say) is no business of this trigger.

create function setting_whole(v jsonb, lo numeric, hi numeric default 9007199254740991) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
    and (v #>> '{}')::numeric >= lo and (v #>> '{}')::numeric <= hi and (v #>> '{}')::numeric <= 9007199254740991, false)
$$;

-- A span: a unit among those given and a whole count from 1 to 1000. A missing field is a span that does not hold, never a null.
create function setting_span(v jsonb, units text[]) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'unit') = 'string' and (v ->> 'unit') = any (units)
    and setting_whole(v -> 'count', 1, 1000), false)
$$;

-- Five fields of numbers, *, ranges, lists and steps, each inside its own range (minute, hour, day of month, month, day of week
-- with 0 and 7 both Sunday); names are refused. Mirrors isCron in engine/rules/instance.ts.
create function setting_cron(v jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  fields text[];
  los integer[] := array[0, 0, 1, 1, 0];
  his integer[] := array[59, 23, 31, 12, 7];
  part text;
  m text[];
  a numeric;
  b numeric;
begin
  if jsonb_typeof(v) is distinct from 'string' then return false; end if;
  fields := regexp_split_to_array(regexp_replace(v #>> '{}', '^\s+|\s+$', '', 'g'), '\s+');
  if cardinality(fields) <> 5 then return false; end if;
  for i in 1..5 loop
    foreach part in array string_to_array(fields[i], ',') loop
      m := regexp_match(part, '^(\*|([0-9]+)(?:-([0-9]+))?)(?:/([0-9]+))?$');
      if m is null then return false; end if;
      if m[4] is not null and m[4]::numeric < 1 then return false; end if;
      if m[1] <> '*' then
        a := m[2]::numeric;
        b := coalesce(m[3]::numeric, a);
        if not (a >= los[i] and b <= his[i] and a <= b) then return false; end if;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- Where JavaScript's parse of a JSON number stops being finite (2^1024 - 2^970: from there it rounds to Infinity), and the
-- least positive number it does not read as 0 (just past 2^-1075, half the least subnormal; written a hair above it).
create function setting_infinity() returns numeric
language sql immutable set search_path = public, pg_temp as $$ select power(2::numeric, 1024) - power(2::numeric, 970) $$;
create function setting_positive(v jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric > 2.4703282292062328e-324, false)
$$;

-- An object of named numbers: cardSettings' shape (the economy's is held by 0006).
create function setting_named_numbers(v jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(v) = 'object' and not exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number'
    or abs((e.value #>> '{}')::numeric) >= setting_infinity())
$$;

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

create function settings_held() returns trigger
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
create trigger settings_held before insert or update on settings for each row execute function settings_held();

revoke execute on function setting_whole(jsonb, numeric, numeric), setting_span(jsonb, text[]), setting_cron(jsonb),
  setting_infinity(), setting_positive(jsonb), setting_named_numbers(jsonb), setting_pool(jsonb), settings_held() from public, anon, authenticated;

-- Every row already there goes through the hold, so one that breaks a rule fails this migration and names its key.
update settings set value = value;
