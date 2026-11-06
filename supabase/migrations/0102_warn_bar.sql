-- The warn bar, infractions and timed bans (the Mod Bots design, section 5; its plan, Task 5).
--
-- An infraction is an Act: a Mod's filing of a breach, its band's points frozen on it, naming the character it is against and the post it is about. A ban is an
-- Act: the day a character's bar filled, naming its end. Both are Acts of no character that name theirs in the payload, as a reveal does (acts_character_null),
-- and both sit in the thread of the post they are about without taking a seq. Only `infract` writes them (a guard trigger refuses any other write, as describe's
-- does), so the bar can only move as the design says.
--
-- warn_points(character) = the points of the character's infractions that have not expired and landed after its last ban, less each one's relief (an appeal's
-- ruling; `infraction_relief` is 0 until Task 10 writes the appeal Acts and fills it). A full bar (the points reach `warnBar.size`) writes a ban whose length is
-- the season's ladder step: the character's bans this season, counting this one, index `warnBar.banDays` and the last step repeats. A new season counts none, so
-- the ladder resets. banned_until(character) is the latest end among the bans still running, or null.
--
-- A banned character can browse and cannot post, start or spin a thread, edit, react, unmask or play or set a card. Each refusal names when the ban ends, in
-- UTC, out of character and true, and holds only that character: a mask of the same account is refused nothing (the check is on `through`, after played_by has
-- shown the caller plays it). Turning (a Turn), withdrawing a Turn, the profile and reading are left to a banned character: they are not words in a thread.
-- A Turn's announcement is written by the settlement, not by the character.
--
-- Reads: characters_public gains warn_points and banned_until, and the thread, profile and presence reads carry them (a thread's postbits and the profile read
-- characters_public; presence_box tags a name with its ban only). They are public: an infraction and a ban are public Acts and a character is not its player.
-- Cost: both are read by an index of the character's own infractions or bans (acts_infractions, acts_bans: the character named in the payload, then time),
-- never a scan of Acts; a view column is computed only for a query that selects it, so the existing reads of characters_public pay nothing, and a thread's
-- page pays for the handful of characters on it, each a probe of those indexes.
--
-- Ways out: points drop off by themselves `decay` after they land; a ban ends by itself at its stated time (at most the ladder's last step); an appeal (Task 10)
-- and an admin's reversal (Task 10 and Part 4's Unban) are the other ways. A banned character's other masks play on.

-- ---------------------------------------------------------------------------------------------------- the Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'describe', 'infraction', 'ban'));

alter table acts drop constraint acts_character_null;
alter table acts add constraint acts_character_null check ((character is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end', 'describe', 'infraction', 'ban')));

-- An infraction and a ban point at nothing: the post is in the payload (about_act) and so is the infraction that filled the bar.
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move', 'update', 'describe', 'infraction', 'ban') or target_act_id is not null
  or (kind = 'card' and payload ->> 'reach' = 'board'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban'));

alter table acts add constraint acts_infraction_payload check (kind <> 'infraction' or (
  payload - 'character' - 'band' - 'points' - 'rule_number' - 'board' - 'about_act' - 'visit_act' - 'staff' - 'expires_at' = '{}'::jsonb
  and jsonb_typeof(payload -> 'character') = 'string' and payload ->> 'character' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and payload ->> 'band' in ('minor', 'moderate', 'severe')
  and jsonb_typeof(payload -> 'points') = 'number' and payload ->> 'points' ~ '^[1-9][0-9]{0,8}$'
  and (jsonb_typeof(payload -> 'rule_number') = 'null' or (jsonb_typeof(payload -> 'rule_number') = 'number' and payload ->> 'rule_number' ~ '^[0-9]{1,9}$'))
  and jsonb_typeof(payload -> 'board') = 'string' and payload ->> 'board' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(payload -> 'about_act') = 'string' and payload ->> 'about_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (jsonb_typeof(payload -> 'visit_act') = 'null' or (jsonb_typeof(payload -> 'visit_act') = 'string' and payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and jsonb_typeof(payload -> 'staff') = 'string' and payload ->> 'staff' <> ''
  and jsonb_typeof(payload -> 'expires_at') = 'string') is true);

alter table acts add constraint acts_ban_payload check (kind <> 'ban' or (
  payload - 'character' - 'days' - 'until' - 'infraction_act' - 'season' = '{}'::jsonb
  and jsonb_typeof(payload -> 'character') = 'string' and payload ->> 'character' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(payload -> 'days') = 'number' and payload ->> 'days' ~ '^[1-9][0-9]{0,8}$'
  and jsonb_typeof(payload -> 'until') = 'string'
  and jsonb_typeof(payload -> 'infraction_act') = 'string' and payload ->> 'infraction_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(payload -> 'season') = 'number' and payload ->> 'season' ~ '^[0-9]{1,9}$') is true);

-- The bar and the ban are read by the character named in the payload, newest first.
create index acts_infractions on acts ((payload ->> 'character'), created_at desc) where kind = 'infraction';
create index acts_bans on acts ((payload ->> 'character'), created_at desc) where kind = 'ban';

-- acts_take_seq (0099), also leaving an infraction and a ban out of their thread's seq; everything else as 0099 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- Only infract writes an infraction or a ban, and each is well formed beyond what a check can say: the character is a player's, the post is a post, the visit
-- (when named) is an Act, a ban follows an infraction of the same character, and the times are times.
create function acts_warn_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('kayfabb.warn_writer', true), '') <> 'on' then
    raise exception 'an infraction or a ban is written only through infract' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not exists (select 1 from characters c where c.id = (new.payload ->> 'character')::uuid and c.staff is null) then
    raise exception 'an infraction or a ban is against a player''s character' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'infraction' then
    perform (new.payload ->> 'expires_at')::timestamptz;
    if not exists (select 1 from acts p where p.id = (new.payload ->> 'about_act')::uuid and p.kind = 'post' and p.thread = new.thread
                   and p.character = (new.payload ->> 'character')::uuid) then
      raise exception 'an infraction is about a post of that character''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'visit_act') = 'string' and not exists (select 1 from acts v where v.id = (new.payload ->> 'visit_act')::uuid) then
      raise exception 'an infraction names a visit that is an Act' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    perform (new.payload ->> 'until')::timestamptz;
    if not exists (select 1 from acts i where i.id = (new.payload ->> 'infraction_act')::uuid and i.kind = 'infraction'
                   and i.payload ->> 'character' = new.payload ->> 'character' and i.thread = new.thread) then
      raise exception 'a ban follows an infraction of the same character, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function acts_warn_guard() from public, anon, authenticated;
create trigger acts_warn_guard before insert on acts for each row when (new.kind in ('infraction', 'ban')) execute function acts_warn_guard();

-- ------------------------------------------------------------------------------------------------- the settings ----

-- The warn bar's settings (`warnBar`): exactly the fields of WarnBarSettings (engine/rules/types.ts), each held as the TypeScript rule says (`warnBarRule` in
-- engine/rules/instance.ts). Returns the words of what is wrong, or null. supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function setting_warnbar(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  shape constant text := 'an object giving size (a whole number, at least 1), bands (minor, moderate and severe, whole numbers from 1 to size), decay (a span: a unit of minute, day, week or month and a whole count from 1 to 1000) and banDays (a list of one or more whole numbers of days, each at least 1)';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (array['size', 'bands', 'decay', 'banDays']) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  if not setting_whole(v -> 'size', 1) then return shape || '; "size" is not'; end if;
  if jsonb_typeof(v -> 'bands') is distinct from 'object' or (select count(*) from jsonb_object_keys(v -> 'bands')) <> 3 then return shape || '; "bands" is not'; end if;
  foreach k in array array['minor', 'moderate', 'severe'] loop
    if not setting_whole(v -> 'bands' -> k, 1, (v ->> 'size')::numeric) then return format('%s; "bands.%s" is not', shape, k); end if;
  end loop;
  if not setting_span(v -> 'decay', array['minute', 'day', 'week', 'month']) then return shape || '; "decay" is not'; end if;
  if jsonb_typeof(v -> 'banDays') is distinct from 'array' or jsonb_array_length(v -> 'banDays') < 1
     or exists (select 1 from jsonb_array_elements(v -> 'banDays') e where not setting_whole(e, 1)) then
    return shape || '; "banDays" is not';
  end if;
  return null;
end $$;
revoke execute on function setting_warnbar(jsonb) from public, anon, authenticated;

-- settings_held (0101), also holding `warnBar`. Everything else as 0101 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded'];
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
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
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


-- ------------------------------------------------------------------------------------------- bar, bans, infract ----

-- What an appeal took off an infraction's points. Zero until Task 10 writes the appeal rulings (reduced, overturned) and replaces this body with a read of
-- them by the infraction's id; warn_points already subtracts it from each infraction it counts, so that is the one place Task 10 touches.
create function infraction_relief(infraction uuid) returns integer
language sql stable set search_path = public, pg_temp as $$ select 0 $$;
revoke execute on function infraction_relief(uuid) from public, anon, authenticated;

-- The bar: the points of the character's infractions that have not expired and landed after its last ban, each less its relief. Reads the character's
-- infractions by acts_infractions and its last ban by acts_bans.
create function warn_points(who uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(greatest(0, (i.payload ->> 'points')::integer - infraction_relief(i.id))), 0)::integer
  from acts i
  where i.kind = 'infraction' and i.payload ->> 'character' = who::text
    and (i.payload ->> 'expires_at')::timestamptz > now()
    and i.created_at > coalesce((select max(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text), '-infinity'::timestamptz)
$$;
-- Signed-in players may execute it: a function a view calls is executed with the privileges of whoever reads the view, and characters_public is read by them.
-- It answers a public fact about any id (an infraction is a public Act) and the same zero for an id that is no character.
revoke execute on function warn_points(uuid) from public, anon;
grant execute on function warn_points(uuid) to authenticated, service_role;

-- When the character's latest running ban ends, or null. A ban's end is on the Act; Task 10's reversals and Part 4's Unban are read here when they exist.
create function banned_until(who uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select max((b.payload ->> 'until')::timestamptz)
  from acts b
  where b.kind = 'ban' and b.payload ->> 'character' = who::text and (b.payload ->> 'until')::timestamptz > now()
$$;
-- Executable by signed-in players for the same reason as warn_points.
revoke execute on function banned_until(uuid) from public, anon;
grant execute on function banned_until(uuid) to authenticated, service_role;

-- The refusal every action of a banned character meets, called by each right after played_by has shown the caller plays `who`. Plain, true and out of
-- character: whose ban, when it ends (UTC, rounded up to the minute so the time named is never before the real end), that it ends by itself, and that it holds
-- only this character.
create function not_banned(who uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare until timestamptz := banned_until(who);
begin
  if until is not null then
    raise exception 'this character is banned until % UTC; the ban ends by itself then, and it holds only this character, not your other characters',
      to_char(date_trunc('minute', until + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;
revoke execute on function not_banned(uuid) from public, anon, authenticated;
grant execute on function not_banned(uuid) to service_role;

-- A Mod's filing lands: the infraction, its band's points frozen on it, and, if the bar is full, a ban. `about_act` is the post, `staff` the Mod that filed,
-- `rule_number` the rule broken (null where none, as for Obstruction) and `visit_act` the visit it ends (null where none). Returns {infraction, points,
-- warn_points (after), ban (the Act or null), until}. The character's row is locked, so two filings at once see each other's points and bans.
create function infract(who uuid, band text, about_act uuid, staff text, rule_number integer default null, visit_act uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  bar jsonb;
  pts integer;
  in_thread uuid;
  on_board uuid;
  at timestamptz;
  inf uuid;
  total integer;
  made uuid;
  season_no integer;
  prior integer;
  steps jsonb;
  days integer;
  ends timestamptz;
  ban_at timestamptz;
begin
  if band is null or band not in ('minor', 'moderate', 'severe') then raise exception 'there is no band "%"; a breach is minor, moderate or severe', coalesce(band, '') using errcode = '22023'; end if;
  if staff is null or staff = '' then raise exception 'an infraction names the Mod that filed it' using errcode = '22023'; end if;
  perform 1 from characters c where c.id = who and c.staff is null for no key update;
  if not found then raise exception 'there is no player character to warn' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = about_act and a.kind = 'post' and a.character = who;
  if in_thread is null then raise exception 'an infraction is for a post this character wrote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if visit_act is not null and not exists (select 1 from acts v where v.id = visit_act) then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The time and the bar are taken with the row held: a filing that waited for another's ban lands after it, and sees its bar.
  at := clock_timestamp();
  bar := setting('warnBar');
  pts := (bar -> 'bands' ->> band)::integer;
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', in_thread,
    jsonb_build_object('character', who, 'band', band, 'points', pts, 'rule_number', rule_number, 'board', on_board, 'about_act', about_act, 'visit_act', visit_act,
                       'staff', staff, 'expires_at', at + span_interval(bar -> 'decay')), at)
  returning id into inf;
  total := warn_points(who);
  if total >= (bar ->> 'size')::integer then
    -- This season's bans of this character, this one counting: a new season has none, so the ladder starts again.
    -- With no season open (between one and the next) it is the latest season's; 0 only where no season was ever made.
    season_no := coalesce((select max(s.number) from seasons s), 0);
    select count(*) into prior from acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text and (b.payload ->> 'season')::integer = season_no;
    steps := bar -> 'banDays';
    days := (steps ->> least(prior, jsonb_array_length(steps) - 1))::integer;
    ban_at := greatest(clock_timestamp(), at + interval '1 microsecond');
    ends := ban_at + make_interval(days => days);
    insert into acts (character, kind, thread, payload, created_at)
    values (null, 'ban', in_thread, jsonb_build_object('character', who, 'days', days, 'until', ends, 'infraction_act', inf, 'season', season_no), ban_at)
    returning id into made;
    total := 0;
  end if;
  perform set_config('kayfabb.warn_writer', '', true);
  return jsonb_build_object('infraction', inf, 'points', pts, 'warn_points', total, 'ban', made, 'until', ends);
end $$;
revoke execute on function infract(uuid, text, uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function infract(uuid, text, uuid, text, integer, uuid) to service_role;

-- ------------------------------------------------------------------------------------------------------ reads ----

-- characters_public (0082), also carrying the bar and the ban. Columns added at the end, so every grant and every reader stays as it is.
create or replace view characters_public as
  select c.id, c.name, date_trunc('month', c.debuted_at at time zone 'UTC')::date as joined, c.staff,
    case when c.staff is null then null when c.staff_kind = 'developer' then 'developer' else o.office end as office,
    warn_points(c.id) as warn_points, banned_until(c.id) as banned_until
  from characters c left join staff_office_now o on o.staff = c.staff
  where c.debuted_at is not null;

-- thread_page (0094), each person's character also carrying warn_points and banned_until; everything else as 0094 wrote it.
create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  page_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  posts as materialized (select a.id, a.character from page_acts a where a.kind = 'post'),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
  ),
  ids as materialized (select a.id from page_acts a union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select p.character from played p) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;

-- profile_page and record_page (0096), the character also carrying warn_points and banned_until; everything else as 0096 wrote it.
create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until from characters_public where id = in_character
  ), acts5 as (
    -- PROFILE_ROWS (engine/ui/profile/record.ts): the newest few of its own Acts, with no count.
    select a.* from acts_public a
    where a.character = in_character and a.kind in ('post', 'spin', 'card')
    order by a.created_at desc limit 5
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r where r.character = in_character
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character = in_character
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style
      from character_profiles where character = in_character) p),
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character) n),
    'standing', standing_place(in_character),
    'settled_at', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'season', (select to_jsonb(s) from current_season s limit 1),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts5 a), '[]'::jsonb),
    -- The card plays' target posts and the Turns' tallies, placed with one batched read (playLinks, turnLinks).
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts5 a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
      select x.* from acts_public x where x.kind = 'reveal' and x.payload ->> 'character' = in_character::text
      order by x.created_at desc limit 50) a), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until from characters_public where id = in_character
  ), k as (
    select case when in_kind in ('all', 'post', 'spin', 'card', 'class', 'seasons') then in_kind else 'all' end as kind,
           least(greatest(coalesce(in_page, 1), 1), 10000) as page
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r, k
    where r.character = in_character and k.kind in ('all', 'class')
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t, k
    where t.character = in_character and k.kind in ('all', 'class')
  ), seasons_read as (
    select x.* from acts_public x, k
    where k.kind in ('all', 'seasons') and x.kind = 'reveal' and x.payload ->> 'character' = in_character::text
    order by x.created_at desc limit 50
  ), w as (
    -- The window of the character's own Acts: for `all`, from `max(0, offset - extras)` for `offset + 20 - from` rows
    -- (the extras are merged in by the client, `mergeWindow`); for one kind, the page itself; for class and seasons, none.
    select case k.kind when 'all' then array['post', 'spin', 'card'] when 'post' then array['post'] when 'spin' then array['spin']
                       when 'card' then array['card'] else array[]::text[] end as kinds,
           case when k.kind = 'all' then greatest(0, (k.page - 1) * 20 - ((select count(*) from rv) + (select count(*) from tn) + (select count(*) from seasons_read)))
                else (k.page - 1) * 20 end as from_row,
           case when k.kind = 'all' then (k.page - 1) * 20 + 20 else 20 end as base
    from k
  ), acts_read as (
    -- The kinds as an init plan, so the planner keeps the ordered scan of the character's Acts with the limit pushed down.
    select a.* from acts_public a
    where a.character = in_character and a.kind = any (((select kinds from w)::text[]))
    order by a.created_at desc
    offset (select from_row from w)
    limit (select case when k.kind = 'all' then w.base - w.from_row else 20 end from w, k)
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'kind', (select kind from k),
    'page', (select page from k),
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style
      from character_profiles where character = in_character) p),
    -- RecordScreen reads the counters for all, post, spin and card only.
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character and (select kind from k) in ('all', 'post', 'spin', 'card')) n),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from seasons_read a), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts_read a), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts_read a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

-- presence_box (0093), each name also carrying banned_until (null where the character is not banned); everything else as 0093 wrote it.
create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
  -- as one name; the index never lists a staff character.
  if in_kind = 'thread' then
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id)) order by f.place_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.staff, l.place_since from presence_listed l
                  where l.place = in_place and l.seen_at >= now() - win order by l.place_since, l.id limit cap) f),
           (select count(*) from presence_listed l where l.place = in_place and l.seen_at >= now() - win)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id)) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', false, 'banned_until', banned_until(f.id)) order by f.online_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.online_since from presence_listed l
                  where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap) f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;


-- ------------------------------------------------------------------------------------------------ the refusals ----

-- Each of these as its latest migration wrote it, with one line added after the line that shows the caller plays `through`: `perform not_banned(through)`.
-- post (0078), start_thread (0013), spin (0013), edit_post (0005), unmask (0074), react (0054) and play_card (0086's nine-argument one, which the ten-argument
-- one calls) and set_card (0086). A staff character is never banned (infract refuses one), so the pool's staff_* writers are left alone.
CREATE OR REPLACE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  parked uuid[];
  locked uuid[];
  passes uuid[];
  setters uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- What this post may pass: the thread's waiting backs on others' posts (the partial index), those that have sprung apart, since a
  -- sprung back is neither locked nor probed for a lock (a spring is public, and acts_one_spring finds it by index).
  select coalesce(array_agg(w.play) filter (where not w.sprung), '{}'), coalesce(array_agg(w.play) filter (where w.sprung), '{}') into maybe, parked
  from (select r.play, exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = r.play::text) as sprung
        from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
        where r.thread = in_thread and r.passed_by is null and p.character is distinct from through) w;
  -- Plus the quoted post's live, unsprung back, passed or not.
  maybe := maybe || array(select f.play from face_down f
                          where f.post = quoting and f.ends_at > now() and f.play <> all (maybe)
                            and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text));
  -- Step 3: those backs with their reply rows, in `play` order, in one statement. A reply row is read as locked: a post that passed a
  -- back while this waited has stamped it, and it is not this post's to pass. spring_traps then finds each row already held.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.play) filter (where b.waits and b.poster is distinct from through), '{}'),
         coalesce(array_agg(b.setter), '{}')
    into locked, passes, setters
  from (select f.play, s.character as setter, p.character as poster, (r.passed_by is null and r.thread = in_thread) as waits
        from face_down f join face_down_reply r on r.play = f.play join acts s on s.id = f.play join acts p on p.id = f.post
        where f.play = any (maybe)
        order by f.play for update of f, r) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  -- Locked and read as waiting in step 3, so no other post can have stamped them.
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  -- The sprung ones are stamped without waiting: a post that locked one in step 3 (it read the back unsprung) may hold the row and
  -- wait on this post's thread or count row, so a wait here could cross. A row held by another is skipped and stays waiting; the next
  -- post by another character stamps it.
  if cardinality(parked) > 0 then
    update face_down_reply set passed_by = written, passed_at = now()
    where play in (select r.play from face_down_reply r where r.play = any (parked) and r.passed_by is null order by r.play for update skip locked);
  end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written, held => locked);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

CREATE OR REPLACE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin, jsonb_build_object('title', title, 'body', coalesce(body, ''))) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

CREATE OR REPLACE FUNCTION public.edit_post(target uuid, through uuid, body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  in_thread uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select thread into in_thread from acts where id = target and kind = 'post' and character = through;
  if in_thread is null then raise exception 'that is not a post of this character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'edit', in_thread, target, jsonb_build_object('body', body));
  return act_projection(target);
end $function$;

CREATE OR REPLACE FUNCTION public.unmask(through uuid, in_thread uuid, message text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  perform not_banned(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.window_end <= now()
                    and not exists (select 1 from settlements s where s.ends_at > k.window_start)))) then
    raise exception 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $function$;

CREATE OR REPLACE FUNCTION public.react(target uuid, through uuid, reaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
  sprung jsonb;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  perform not_banned(through);
  if not exists (select 1 from reaction_kinds k where k.key = reaction) then
    raise exception 'there is no reaction "%"', reaction using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The System's own Acts (a tally, the reveal) have no author, and no author's owner to hold the
  -- caller apart from: they are reacted to like any Act, and pay nobody (settle.ts).
  select a.kind, c.owner into target_kind, author_owner
  from acts a left join characters c on c.id = a.character where a.id = target;
  if target_kind is null then
    raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if target_kind = 'edit' then raise exception 'an edit is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The author's owner now: a character changing hands is not in this slice, and the session
  -- that adds it decides what becomes of reactions between its old and new owner's characters.
  if author_owner = caller then
    raise exception 'your characters cannot react to each other' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;

  select coalesce(array_agg(r.kind order by r.slot), '{}') into held
  from reactions r where r.act = target and r.reactor_account = caller;
  -- The lowest free slot, so a slot given back (a reaction removed, later) is taken again rather
  -- than colliding for ever. The slot only makes two reactions at once collide; the cap is held
  -- by the count above, so lowering reactionCap later leaves existing reactions as they are.
  select min(g) into free_slot from generate_series(1, cardinality(held) + 1) g
  where not exists (select 1 from reactions r where r.act = target and r.reactor_account = caller and r.slot = g);
  if reaction = any (held) then
    raise exception 'you have already left that reaction here' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if cardinality(held) >= cap then
    raise exception 'you have left % reactions here, the most there are', cap using hint = 'kayfabb.refusal', errcode = '23514';
  end if;

  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot)
    values (target, through, caller, reaction, free_slot);
  exception when unique_violation then
    -- Another reaction of this player's landed between the read above and this write.
    raise exception 'you reacted here twice at once; try again' using hint = 'kayfabb.refusal', errcode = '40001';
  end;
  insert into reaction_tallies (act, kind, count) values (target, reaction, 1)
  on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  -- After every refusal: a trap never refuses the reaction that springs it.
  if target_kind = 'post' then sprung := spring_traps('reaction', target, null, (select k.quadrant from reaction_kinds k where k.key = reaction)); end if;

  return jsonb_build_object('act', target, 'thread', (select thread from acts where id = target),
    'tally', (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target))
    || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held integer;
  said text := coalesce(message, '');
  played jsonb;
  written uuid;
begin
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = play_card.card;
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  played := place_cast(through, card, target, config, said, reach, from_post, who, price);
  written := (played ->> 'id')::uuid;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return played;
end $function$;

CREATE OR REPLACE FUNCTION public.set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held integer;
  placed jsonb;
  written uuid;
begin
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = set_card.card;
  if coalesce(held, 0) < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  placed := place_set(through, card, target, config, who, price);
  written := (placed ->> 'id')::uuid;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return placed;
end $function$;
