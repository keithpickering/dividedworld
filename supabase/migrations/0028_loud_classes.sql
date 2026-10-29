-- Creation and Turns announced with a class: a debut may be announced with its class, beside
-- silent and announced (0024), and an announced Turn may name the class it Turns to, the class it
-- Turns from (0007's "revealed"), both, or neither. Each that names the class the character now
-- holds writes the character's own unmask Act (0027) when it takes effect, in the season's Turns
-- thread right after the tally, or the drop's announcement, that names it: one write_unmask() for
-- all three, so they cannot drift. The class reveal design, section 2; its plan, Task 2.
--
-- That unmask is the one Act a character has on The System's board, written by The System on its
-- behalf, since no character posts there (post() and unmask() still refuse players). It is the
-- character's all the same: reacted to and spun like any reveal, and its reactions are scored for
-- the character (settlement_input, 0004, reads every Act a character has). Naming only the class a
-- Turn leaves states a class the character no longer holds, so it writes no unmask.
--
--   debut_loudness   silent | announced | with_class        (with_class: the tally names its class)
--   a Turn           silent | announced, + show_from (names the class it leaves), show_to (the one it takes)
--
-- A Turn waiting across this migration, asked "revealed", becomes announced with show_from: it takes
-- effect as asked. turn()'s three-argument form is kept for an older client, and reads "revealed"
-- the same way. Every way out is as before: a debut and a Turn take effect at the settlement, or
-- its player changes or withdraws them; a revealed class holds nobody (0027).

alter table characters drop constraint characters_debut_loudness_check;
alter table characters add constraint characters_debut_loudness_check check (debut_loudness in ('silent', 'announced', 'with_class'));

-- The table's lock is taken by the first statement and held to the end of the migration, run in one
-- transaction as Supabase applies it, so no turn() writes a "revealed" row between the update and
-- the check that refuses one.
alter table pending_turns add column show_from boolean not null default false, add column show_to boolean not null default false;
update pending_turns set loudness = 'announced', show_from = true where loudness = 'revealed';
alter table pending_turns drop constraint pending_turns_loudness_check;
alter table pending_turns add constraint pending_turns_loudness_check check (loudness in ('silent', 'announced'));
alter table pending_turns add constraint pending_turns_silent_names_nothing check (loudness = 'announced' or not (show_from or show_to));
grant select (show_from, show_to) on pending_turns to authenticated;

-- The three options, as the Edge Function checks them first (engine/rules/actions.ts).
create or replace function debut_options(timing text, loudness text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if timing is null or timing not in ('now', 'tally') then
    raise exception 'a character drops now or debuts at the tally' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if loudness is null or loudness not in ('silent', 'announced', 'with_class') then
    raise exception 'a debut is silent, announced, or announced with its class' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
end $$;

-- announce_drop (0024), naming the class of a drop announced with it, and writing its unmask after
-- the announcement, at the drop: the answer carries it (`unmask`) to send live. Between seasons
-- both wait for the next tally, as the announcement did.
create or replace function announce_drop(dropped uuid, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_season bigint := (select id from seasons where starts_at <= at and (ends_at is null or ends_at > at));
  c characters%rowtype;
  posted jsonb;
begin
  if in_season is null then
    update characters set debut_announcement_due = true where id = dropped;
    return null;
  end if;
  select * into c from characters where id = dropped;
  posted := post_tally(in_season, jsonb_build_array(jsonb_build_object('character', c.id, 'name', c.name)
    || case when c.debut_loudness = 'with_class' then jsonb_build_object('class', (select class_key from class_now(c.id, at))) else '{}'::jsonb end), '[]', at);
  if c.debut_loudness = 'with_class' then
    posted := posted || jsonb_build_object('unmask', write_unmask(c.id, (posted -> 'act' ->> 'thread')::uuid, 'debut', at));
  end if;
  return posted;
end $$;

-- masks_change (0024), naming the classes a debut or a Turn was announced with, and writing the
-- unmask of each that names the class now held right after the tally part that names it. A debut's
-- class is read once the window's Turns have taken effect, so a drop owed its announcement across
-- a gap, that Turned in it, names the class it holds at the tally, which is the unmask's date.
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 100;
  in_season bigint;
  first_tally uuid;
  posted jsonb;
  unmasked jsonb;
  parts integer;
  r record;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb, unmasks boolean) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text, since timestamptz) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  -- A retired character makes no Act: one owed its announcement across a gap and retired since is
  -- named, as it was due to be, and never unmasked, or no settlement could write its tally.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness, retired_at
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name, debut_loudness, retired_at
  ) insert into masks_named (n, kind, entry, unmasks)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name), debut_loudness = 'with_class' and retired_at is null
    from (select id, name, debut_loudness, retired_at from d where debut_loudness <> 'silent' union all select id, name, debut_loudness, retired_at from owed) named;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key, n.since
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end;
  insert into class_history (character, class_key, started_at) select character, class_key, window_end from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry, unmasks)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was, 'since', since) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end,
      show_to
    from masks_turns where loudness <> 'silent';
  update masks_named m set entry = m.entry || jsonb_build_object('class', (select class_key from class_now((m.entry ->> 'character')::uuid, window_end)))
  where m.kind = 'debut' and m.unmasks;
  if not exists (select 1 from masks_named) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  parts := ((select count(*) from masks_named) + most - 1) / most;
  for part in 1..parts loop
    posted := post_tally(in_season,
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'debut'), '[]') from masks_named where (n - 1) / most = part - 1),
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'turn'), '[]') from masks_named where (n - 1) / most = part - 1),
      window_end, part, parts);
    if posted -> 'thread' <> 'null'::jsonb then
      perform broadcast_later('board:' || (posted -> 'thread' ->> 'board'), 'thread', posted -> 'thread');
    end if;
    first_tally := coalesce(first_tally, (posted -> 'act' ->> 'id')::uuid);
    perform broadcast_later('thread:' || (posted -> 'act' ->> 'thread'), 'act', posted -> 'act');
    -- The part's reveals, in its order, right after it: the character's own Acts, by The System's hand.
    for r in select kind, entry from masks_named where (n - 1) / most = part - 1 and unmasks order by n loop
      unmasked := write_unmask((r.entry ->> 'character')::uuid, (posted -> 'act' ->> 'thread')::uuid, r.kind, window_end);
      perform broadcast_later('thread:' || (unmasked ->> 'thread'), 'act', unmasked);
    end loop;
  end loop;
  return first_tally;
end $$;

-- create_character (0024): a drop announced with its class is announced at once too.
create or replace function create_character(name text, class text, timing text default 'tally', loudness text default 'announced') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  named text := btrim(name, ' ');
  made uuid;
  at timestamptz;
  announced jsonb;
begin
  if named is null or char_length(named) not between 1 and 40 then
    raise exception 'a name is 1 to 40 characters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A name nobody's can be made to look like: unique whatever its case or script (0011), and holding no
  -- invisible, control or direction character and no space but a single one. The same set as
  -- engine/rules/actions.ts's NAME_HIDDEN.
  if named ~ '[\u0001-\u001f\u007f- ­͏؜ᅟᅠ ឴឵᠋-᠎ -‏ -  -⁯　ㅤ︀-️﻿ﾠ￰-￿⠀\U0001d173-\U0001d17a\U000e0000-\U000e0fff]' or named like '%  %' then
    raise exception 'a name can hold letters, marks, digits, symbols and single spaces, nothing hidden' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = class) then
    raise exception 'there is no class "%"', class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform debut_options(timing, loudness);
  begin
    -- A drop is debuted in the insert itself, at its creation (both are the transaction's now()).
    insert into characters (owner, name, debut_loudness, debuted_at) values (caller, named, loudness, case when timing = 'now' then now() end)
    returning id, created_at into made, at;
  exception when unique_violation then
    raise exception 'that name is taken' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  insert into class_history (character, class_key, started_at) values (made, class, at);
  if timing = 'now' and loudness <> 'silent' then announced := announce_drop(made, at); end if;
  return jsonb_build_object('id', made, 'name', named, 'class', class, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;

-- set_debut (0024): the same.
create or replace function set_debut(through uuid, timing text, loudness text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  c characters%rowtype;
  at timestamptz := now();
  announced jsonb;
begin
  perform debut_options(timing, loudness);
  -- Locked before it is read, so a settlement debuting it at this moment goes first or after.
  select * into c from characters where id = through and owner = caller for no key update;
  if c.id is null then raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  if c.debuted_at is not null then raise exception 'it has debuted' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if c.retired_at is not null then raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  update characters set debut_loudness = loudness, debuted_at = case when timing = 'now' then at end where id = through;
  if timing = 'now' and loudness <> 'silent' then announced := announce_drop(through, at); end if;
  return jsonb_build_object('id', through, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;

-- turn() (0014), with the classes it names: `show_from`, the class it Turns from (0007's
-- "revealed"), and `show_to`, the class it Turns to, which writes the character's unmask when the
-- Turn takes effect. A silent Turn names neither. Both are given: a form with defaults beside the
-- three-argument one below would make a three-argument call ambiguous.
create function turn(through uuid, to_class text, loudness text, show_from boolean, show_to boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text;
  last_turn timestamptz;
  next_allowed timestamptz;
begin
  perform acting(through);
  if loudness is null or loudness not in ('silent', 'announced') then
    raise exception 'a Turn is silent or announced' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if show_from is null or show_to is null then
    raise exception 'a Turn names its classes or does not' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if loudness = 'silent' and (show_from or show_to) then
    raise exception 'a silent Turn names no class' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One Turn of a character's at a time, and none while a settlement makes one take effect
  -- (masks_change locks the same row), so the cooldown is read from what took effect.
  perform 1 from characters where id = through for no key update;
  select class_key into was from class_now(through, 'infinity');
  if was = to_class then
    if exists (select 1 from pending_turns where character = through) then
      raise exception 'this character already is one: withdraw its waiting Turn to keep it' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The cooldown runs from the last Turn's taking effect; a character's first class is not a Turn.
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  -- Asked again before the settlement, it is the same Turn, changed.
  insert into pending_turns (character, class_key, loudness, show_from, show_to) values (through, to_class, loudness, show_from, show_to)
  on conflict (character) do update set class_key = excluded.class_key, loudness = excluded.loudness, show_from = excluded.show_from, show_to = excluded.show_to,
    asked_at = clock_timestamp();
  -- Read at the moment it was asked, as masks_change() reads asked_at.
  return jsonb_build_object('pending', true, 'class', to_class, 'loudness', loudness, 'show_from', show_from, 'show_to', show_to,
    'takes_effect_at', next_settlement_at(clock_timestamp()));
end $$;

-- turn() (0007's three arguments), kept for an older client: "revealed" is announced, naming the
-- class it Turns from.
create or replace function turn(through uuid, to_class text, loudness text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if loudness = 'revealed' then return turn(through, to_class, 'announced', true, false); end if;
  return turn(through, to_class, loudness, false, false);
end $$;

revoke execute on function turn(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function turn(uuid, text, text, boolean, boolean) to authenticated;
