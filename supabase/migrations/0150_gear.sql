-- Gear: what a character wears over its portrait (the cosmetics design, docs/plans/2026-11-04-cosmetics-design.md; the plan, Task 2).
--
-- An instance names its gear (`Instance.gear`); seed_instance writes the kinds. An account holds copies, counted from its ledger, which is
-- append-only like the card ledger: a copy found by a Random Event (Task 4's `event`) or granted by an admin. A character wears at most
-- `cosmetics.gear.wornMost` pieces, one to a layer, and a copy is worn on one mask at a time, so an outfit is saved under a lock that
-- the account's other masks wait at. What a mask wears is public by character (gear_worn); who holds how many copies is the player's
-- alone ("A response never proves a private fact"): the refusals below read only the caller's own copies, and an admin's grant answers
-- the same whoever plays the mask. A new portrait takes the outfit off (its pieces were placed over the old picture); a way back is to place them again.

-- ------------------------------------------------------------------------------------------------------ the settings hold ----

-- The `cosmetics` setting: exactly the fields of CosmeticsSettings (engine/rules/types.ts), each held as `cosmeticsRule` in engine/rules/instance.ts
-- holds it. supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function setting_weights(v jsonb, keys text[], zero_ok text[] default '{}') returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare k text; w jsonb;
begin
  if jsonb_typeof(v) is distinct from 'object' or v = '{}'::jsonb then return false; end if;
  for k, w in select * from jsonb_each(v) loop
    if k <> all (keys) or not setting_whole(w, case when k = any (zero_ok) then 0 else 1 end) then return false; end if;
  end loop;
  return true;
end $$;
revoke execute on function setting_weights(jsonb, text[], text[]) from public, anon, authenticated;

create function setting_cosmetics(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  shape constant text := 'an object giving gear (wornMost, a whole number, at least 1; reach, a fraction of the portrait''s width from 0 to 2), trophies (shownMost, a whole number, at least 1) and events (windowMinutes, a whole number from 1 to 1440; dayMost, a whole number, at least 1; outcomes, a positive whole weight for line, gear and card and an optional whole weight, at least 0, for none; gearRarity and cardRarity, each a positive whole weight for one or more of common, uncommon, rare, legendary)';
  rarities constant text[] := array['common', 'uncommon', 'rare', 'legendary'];
  k text;
  part text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (array['gear', 'trophies', 'events']) limit 1;
  if k is not null then return format('%s; "cosmetics.%s" is not one of its fields', shape, k); end if;
  foreach part in array array['gear', 'trophies', 'events'] loop
    if jsonb_typeof(v -> part) is distinct from 'object' then return format('%s; "%s" is not', shape, part); end if;
  end loop;
  select e into k from jsonb_object_keys(v -> 'gear') e where e <> all (array['wornMost', 'reach']) limit 1;
  if k is not null then return format('%s; "gear.%s" is not one of its fields', shape, k); end if;
  if not setting_whole(v #> '{gear,wornMost}', 1) then return shape || '; "gear.wornMost" is not'; end if;
  if not coalesce(jsonb_typeof(v #> '{gear,reach}') = 'number' and (v #>> '{gear,reach}')::numeric between 0 and 2, false) then return shape || '; "gear.reach" is not'; end if;
  select e into k from jsonb_object_keys(v -> 'trophies') e where e <> 'shownMost' limit 1;
  if k is not null then return format('%s; "trophies.%s" is not one of its fields', shape, k); end if;
  if not setting_whole(v #> '{trophies,shownMost}', 1) then return shape || '; "trophies.shownMost" is not'; end if;
  select e into k from jsonb_object_keys(v -> 'events') e where e <> all (array['windowMinutes', 'dayMost', 'outcomes', 'gearRarity', 'cardRarity']) limit 1;
  if k is not null then return format('%s; "events.%s" is not one of its fields', shape, k); end if;
  if not setting_whole(v #> '{events,windowMinutes}', 1, 1440) then return shape || '; "events.windowMinutes" is not'; end if;
  if not setting_whole(v #> '{events,dayMost}', 1) then return shape || '; "events.dayMost" is not'; end if;
  if not setting_weights(v #> '{events,outcomes}', array['line', 'gear', 'card', 'none'], array['none']) then return shape || '; "events.outcomes" is not a positive whole weight for each outcome'; end if;
  foreach part in array array['line', 'gear', 'card'] loop
    if not (v #> '{events,outcomes}') ? part then return format('%s; "events.outcomes.%s" is missing', shape, part); end if;
  end loop;
  if not setting_weights(v #> '{events,gearRarity}', rarities) then return shape || '; "events.gearRarity" is not a positive whole weight for one or more rarities'; end if;
  if not setting_weights(v #> '{events,cardRarity}', rarities) then return shape || '; "events.cardRarity" is not a positive whole weight for one or more rarities'; end if;
  return null;
end $$;
revoke execute on function setting_cosmetics(jsonb) from public, anon, authenticated;

-- settings_held (0149), also holding `cosmetics`. Everything else as 0149 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
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
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
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
end $$;

-- ------------------------------------------------------------------------------------------------------------- the tables ----

-- The gear an instance offers: its keys and rarities (its names, lines and art are the instance's code and UI). Added and updated by a seed.
create table gear_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'legendary'))
);

-- A copy found or granted: one row in per copy. Trading adds rows out later; gear_held is the one place that counts. A found copy names the Random Event
-- that dropped it (Task 4 adds the foreign key to that table), a granted one names none. Append-only, as card_ledger is (0006).
create table gear_ledger (
  id bigint generated always as identity primary key,
  account uuid not null references accounts (id),
  gear text not null references gear_kinds (key),
  kind text not null check (kind in ('found', 'granted')),
  event uuid,
  at timestamptz not null default now(),
  check ((kind = 'found') = (event is not null))
);
create index gear_ledger_account on gear_ledger (account, gear);
create trigger gear_ledger_no_update before update or delete on gear_ledger for each row execute function ledger_append_only();
create trigger gear_ledger_no_truncate before truncate on gear_ledger for each statement execute function ledger_append_only();
alter table gear_ledger enable always trigger gear_ledger_no_update;
alter table gear_ledger enable always trigger gear_ledger_no_truncate;

-- What a character wears: one piece to a layer. A piece's place is a fraction of the portrait (engine/rules/cosmetics.ts Piece): the center x and y of it,
-- its width as a fraction of the portrait's, and its turn in degrees. The checks hold pieceProblem's bounds; the layer's upper bound is the
-- `cosmetics.gear.wornMost` setting, which set_outfit holds.
create table gear_worn (
  character uuid not null references characters (id),
  layer integer not null check (layer >= 0),
  gear text not null references gear_kinds (key),
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  w numeric not null check (w between 0.05 and 1.5),
  turn numeric not null check (turn between -180 and 180),
  primary key (character, layer)
);
create index gear_worn_gear on gear_worn (gear);

alter table gear_kinds enable row level security;
alter table gear_ledger enable row level security;
alter table gear_worn enable row level security;
revoke all on gear_kinds, gear_ledger, gear_worn from public, anon, authenticated;
grant select on gear_kinds, gear_ledger, gear_worn to authenticated;
create policy read on gear_kinds for select to authenticated using (true);
create policy own on gear_ledger for select to authenticated using (account = auth.uid());
create policy read on gear_worn for select to authenticated using (true);

-- --------------------------------------------------------------------------------------------------------------- the wardrobe ----

-- The copies of a gear an account holds. Rows in, today; this is where rows out will be taken off.
create function gear_held(who uuid, gear text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from gear_ledger l where l.account = who and l.gear = gear_held.gear
$$;
revoke execute on function gear_held(uuid, text) from public, anon, authenticated;

-- A player's wardrobe: each gear they hold, how many copies, and which of their own characters wear it. Read from the caller's own account alone, and driven from
-- their own characters (characters_owner) to those characters' pieces (gear_worn's primary key), never from every wearer of a gear.
create function my_wardrobe() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('gear', h.gear, 'rarity', k.rarity, 'held', h.held,
      'worn_by', coalesce((select jsonb_agg(w.character order by w.character) from characters c join gear_worn w on w.character = c.id
                           where c.owner = signed_in_account() and w.gear = h.gear), '[]'::jsonb)) order by h.gear), '[]'::jsonb)
  from (select l.gear, count(*)::integer as held from gear_ledger l where l.account = signed_in_account() group by l.gear) h
  join gear_kinds k on k.key = h.gear
$$;
revoke execute on function my_wardrobe() from public, anon;
grant execute on function my_wardrobe() to authenticated;

-- The first thing wrong with a piece, in plain words, or null: engine/rules/cosmetics.ts pieceProblem's bounds.
create function piece_problem(p jsonb, wore integer) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  within boolean;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'a piece is an object giving its gear, x, y, w, turn and layer'; end if;
  if jsonb_typeof(p -> 'gear') is distinct from 'string' then return 'a piece names its gear'; end if;
  if not coalesce(jsonb_typeof(p -> 'x') = 'number' and (p ->> 'x')::numeric between 0 and 1, false) then return 'a piece''s x is outside the portrait'; end if;
  if not coalesce(jsonb_typeof(p -> 'y') = 'number' and (p ->> 'y')::numeric between 0 and 1, false) then return 'a piece''s y is outside the portrait'; end if;
  if not coalesce(jsonb_typeof(p -> 'w') = 'number' and (p ->> 'w')::numeric between 0.05 and 1.5, false) then return 'a piece''s width is from 0.05 to 1.5 of the portrait''s width'; end if;
  if not coalesce(jsonb_typeof(p -> 'turn') = 'number' and (p ->> 'turn')::numeric between -180 and 180, false) then return 'a piece''s turn is from -180 to 180 degrees'; end if;
  if not setting_whole(p -> 'layer', 0, wore - 1) then return format('a piece''s layer is a whole number below %s', wore); end if;
  return null;
end $$;
revoke execute on function piece_problem(jsonb, integer) from public, anon, authenticated;

-- A player saves what a character wears: `pieces` is the whole outfit, replacing the one before. The character's row is locked (a new portrait locks it too), then
-- the account's outfits as a whole: one lock for the account, because an account's other masks may wear nothing to lock a row of, and two saves for two
-- masks would then each find the copy free. Taking the lock after the row is deadlock-free: nothing holding the account's lock asks for a row. The
-- refusals read the caller's own copies, in the words of engine/rules/cosmetics.ts outfitProblems.
create function set_outfit(who uuid, through uuid, pieces jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer;
  p jsonb;
  why text;
  problems text[] := '{}';
  g record;
  free integer;
begin
  select (s.value #>> '{gear,wornMost}')::integer into most from settings s where s.key = 'cosmetics';
  if most is null then raise exception 'this instance has no gear settings' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- The row first, then who plays it: a retirement committing between the two would otherwise find a retired mask dressed.
  perform 1 from characters where id = through and owner = who for no key update;
  perform played_by(through, who);
  if jsonb_typeof(pieces) is distinct from 'array' then raise exception 'an outfit is a list of pieces' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if jsonb_array_length(pieces) > most then
    raise exception '% pieces are worn; at most %', jsonb_array_length(pieces), most using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  for p in select e from jsonb_array_elements(pieces) e loop
    why := piece_problem(p, most);
    if why is not null then raise exception '%', why using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if not exists (select 1 from gear_kinds k where k.key = p ->> 'gear') then
      raise exception 'there is no gear "%"', p ->> 'gear' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('kayfabb.outfit'), hashtext(who::text));
  -- Layer collisions come before copy shortfalls, as outfitProblems lists them.
  for g in
    select pc ->> 'gear' as gear, (pc ->> 'layer')::integer as layer, row_number() over (partition by (pc ->> 'layer')::integer order by ord) as n,
           first_value(pc ->> 'gear') over (partition by (pc ->> 'layer')::integer order by ord) as first
    from jsonb_array_elements(pieces) with ordinality t(pc, ord) order by ord
  loop
    if g.n > 1 then problems := problems || format('"%s" shares layer %s with "%s"', g.gear, g.layer, g.first); end if;
  end loop;
  for g in
    select pc ->> 'gear' as gear, count(*)::integer as here from jsonb_array_elements(pieces) pc group by pc ->> 'gear' order by pc ->> 'gear'
  loop
    -- The account's own characters to their pieces (characters_owner, then gear_worn's primary key), once per gear.
    free := greatest(0, gear_held(who, g.gear) - (select count(*) from characters c join gear_worn w on w.character = c.id
                                                  where c.owner = who and c.id <> through and w.gear = g.gear));
    if g.here > free then
      problems := problems || format('"%s" is worn %s time%s here, and %s %s free', g.gear, g.here, case when g.here = 1 then '' else 's' end,
        free, case when free = 1 then 'copy is' else 'copies are' end);
    end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception '%', array_to_string(problems, '; ') using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A data-modifying CTE would meet its own delete's row at the same key, so the two statements are the function's transaction.
  delete from gear_worn where character = through;
  insert into gear_worn (character, layer, gear, x, y, w, turn)
  select through, (pc ->> 'layer')::integer, pc ->> 'gear', (pc ->> 'x')::numeric, (pc ->> 'y')::numeric, (pc ->> 'w')::numeric, (pc ->> 'turn')::numeric
  from jsonb_array_elements(pieces) pc;
  return jsonb_build_object('worn', jsonb_array_length(pieces));
end $$;
revoke execute on function set_outfit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function set_outfit(uuid, uuid, jsonb) to service_role;

-- An admin gives copies of a gear to whoever plays a character. The answer is the same whoever that is, and names no account.
create function grant_gear(of_character uuid, gear_key text, copies integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  its_owner uuid;
begin
  perform only_admins('grants gear');
  if copies is null or copies not between 1 and 100 then raise exception 'a grant is 1 to 100 copies' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not exists (select 1 from gear_kinds k where k.key = gear_key) then raise exception 'there is no gear "%"', gear_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select owner into its_owner from characters where id = of_character;
  if its_owner is null then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into gear_ledger (account, gear, kind) select its_owner, gear_key, 'granted' from generate_series(1, copies);
  return jsonb_build_object('granted', copies);
end $$;
revoke execute on function grant_gear(uuid, text, integer) from public, anon;
grant execute on function grant_gear(uuid, text, integer) to authenticated;

-- ------------------------------------------------------------------------------------------------------------- the portrait ----

-- How tall the portrait is, as a multiple of its width (1 to 2): what the postbit's box is drawn at, so worn pieces sit where they were placed. Null for an avatar
-- written before this.
alter table character_profiles add column portrait_tallness numeric check (portrait_tallness between 1 and 2);

-- profile_projection (0124), also carrying `portrait_tallness` and `outfit` (the pieces worn, in layer order). Everything else as 0124 wrote it.
create or replace function profile_projection(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature,
    'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame,
    'pip_style', p.pip_style, 'pronouns', p.pronouns, 'portrait_tallness', p.portrait_tallness,
    'outfit', coalesce((select jsonb_agg(jsonb_build_object('gear', w.gear, 'x', w.x, 'y', w.y, 'w', w.w, 'turn', w.turn, 'layer', w.layer) order by w.layer)
                        from gear_worn w where w.character = p.character), '[]'::jsonb))
  from character_profiles p where p.character = of_character
$$;

-- set_avatar (0025), also taking the portrait's tallness (a new portrait's; a recrop keeps the stored one) and taking the outfit off a new portrait: its pieces
-- were placed over the old picture. A null tallness with a portrait is an avatar the way it was before this. The signature changes, so the old function goes.
drop function set_avatar(uuid, uuid, text, text, jsonb, jsonb);
create function set_avatar(who uuid, through uuid, square text, portrait text, square_frame jsonb, portrait_frame jsonb, portrait_tallness numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was character_profiles%rowtype;
  kept_portrait text;
begin
  perform played_by(through, who);
  if square is null or (portrait is null) <> (portrait_frame is null) then raise exception 'an avatar has a square crop, and a portrait crop with its frame or neither' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not frame_holds(square_frame) or (portrait is not null and not frame_holds(portrait_frame)) then raise exception 'a crop frame lies inside its picture' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if set_avatar.portrait_tallness is not null and (portrait is null or set_avatar.portrait_tallness not between 1 and 2) then raise exception 'a portrait is 1 to 2 times as tall as it is wide' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from characters where id = through for no key update;
  select * into was from character_profiles where character = through for update;
  kept_portrait := coalesce(portrait, was.avatar_portrait);
  if kept_portrait is null then raise exception 'an avatar is cut from a portrait; send it' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into character_profiles as p (character, avatar_square, avatar_portrait, square_frame, portrait_frame, portrait_tallness)
  values (through, square, kept_portrait, square_frame, coalesce(portrait_frame, was.portrait_frame), case when portrait is not null then set_avatar.portrait_tallness else was.portrait_tallness end)
  on conflict (character) do update set avatar_square = excluded.avatar_square, avatar_portrait = excluded.avatar_portrait,
    square_frame = excluded.square_frame, portrait_frame = excluded.portrait_frame, portrait_tallness = excluded.portrait_tallness, updated_at = now();
  if portrait is not null then delete from gear_worn where character = through; end if;
  return jsonb_build_object('profile', profile_projection(through), 'replaced', to_jsonb(array_remove(array[
    case when was.avatar_square is distinct from square then was.avatar_square end,
    case when portrait is not null and was.avatar_portrait is distinct from portrait then was.avatar_portrait end], null)));
end $$;
revoke execute on function set_avatar(uuid, uuid, text, text, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function set_avatar(uuid, uuid, text, text, jsonb, jsonb, numeric) to service_role;

-- retire_character (0021), also taking the outfit off: a retired mask wears nothing, and its copies are free to the account's others.
create or replace function retire_character(of_character uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('retires a character');
  perform 1 from characters where id = of_character for no key update;
  if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if exists (select 1 from characters where id = of_character and retired_at is not null) then
    raise exception 'that character is already retired' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One waiting to debut would debut at the next settlement all the same, named in the tally as a
  -- mask nobody can play; it is retired once it has.
  if exists (select 1 from characters where id = of_character and debuted_at is null) then
    raise exception 'that character debuts at the next settlement; it can be retired once it has' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  update characters set retired_at = now() where id = of_character;
  delete from pending_turns where character = of_character;
  delete from gear_worn where character = of_character;
  return jsonb_build_object('character', of_character, 'retired', true);
end $$;

-- ------------------------------------------------------------------------------------------------------------------ the seed ----

-- seed_instance (0149), also writing the instance's gear: kinds added and their rarities brought up to date, and a kind the instance dropped removed unless a ledger row or an outfit names it. Everything else as 0149 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, how long a Use of it is up, where it reaches, whether it pins and whether it writes.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, lasts, reaches, pins, writes)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
