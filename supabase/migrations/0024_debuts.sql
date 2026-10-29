-- A new character drops now or debuts at the tally, each silent or announced, like a Turn's
-- loudness. The clues design, section 4; the clues plan, Task 3.
--
--                 announced                                      silent
--   drop now      acts at once; The System posts at once in      acts at once; its first post is
--                 the season's Turns thread, naming it           its entrance
--   at the tally  waits; named in the tally (as before)          waits; debuts at the tally, unnamed
--
-- A dropped character is debuted from its creation, so it is in every list at once, its
-- creation's minute a clue its player chose (CLAUDE.md, "A response never proves a private
-- fact"). Its announcement is a tally Act of one name, written by the same post_tally() the
-- settlement's tally is, so the two cannot drift. A character waiting to debut may be dropped now,
-- or have its announcement changed, until the tally. A season's reveal names every character,
-- silent ones included, as it names silent Turns (reveal_season, 0007, reads debuted_at alone).
--
-- Its way out: a character waiting to debut, silent or announced, debuts at the next settlement,
-- or its player drops it now.

alter table characters add column debut_loudness text not null default 'announced' check (debut_loudness in ('silent', 'announced'));
-- An announced drop made between seasons, when no season holds a Turns thread: The System names
-- it in the next tally, and clears this then.
alter table characters add column debut_announcement_due boolean not null default false;
create index characters_debut_announcement_due on characters (id) where debut_announcement_due;

-- One tally Act, in the season's Turns thread, opened here where it is not open yet. masks_change()
-- writes the settlement's in parts of at most a hundred names; a drop's is one part, of one debut
-- and no Turns. Returns the Act's public projection, and the thread's where this opened it, for its
-- caller to send live: the settlement through its outbox, a drop in the act function's answer.
create function post_tally(in_season bigint, debuts jsonb, turns jsonb, at timestamptz, part integer default 1, parts integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  in_thread uuid;
  opened uuid;
  written uuid;
begin
  select * into s from seasons where id = in_season for no key update;
  in_thread := s.turns_thread;
  if in_thread is null then
    insert into threads (board, title) values (system_board(), copy_of('turnsThreadTitle', s.number)) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = s.id;
    opened := in_thread;
  end if;
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'tally', in_thread, jsonb_build_object('season', s.number, 'part', part, 'of', parts, 'debuts', debuts, 'turns', turns), at)
  returning id into written;
  return jsonb_build_object('act', act_projection(written), 'thread', case when opened is null then null else thread_projection(opened) end);
end $$;

-- A drop's announcement, at `at`: in the season open then, or, between seasons, at the next tally.
-- The character's row is held by the caller.
create function announce_drop(dropped uuid, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_season bigint := (select id from seasons where starts_at <= at and (ends_at is null or ends_at > at));
begin
  if in_season is null then
    update characters set debut_announcement_due = true where id = dropped;
    return null;
  end if;
  return post_tally(in_season, (select jsonb_build_array(jsonb_build_object('character', id, 'name', name)) from characters where id = dropped), '[]', at);
end $$;

-- 0007's, with its tally drawn out into post_tally(), and naming a debut only when announced: a
-- silent one debuts unnamed. An announced drop made between seasons is named here too, once.
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 100;
  in_season bigint;
  first_tally uuid;
  posted jsonb;
  parts integer;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, name text, was text, since timestamptz) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name
  ) insert into masks_named (n, kind, entry)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name)
    from (select id, name from d where debut_loudness = 'announced' union all select id, name from owed) named;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  insert into masks_turns
    select p.character, p.class_key, p.loudness, c.name, n.class_key, n.since
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end;
  insert into class_history (character, class_key, started_at) select character, class_key, window_end from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when loudness = 'revealed' then jsonb_build_object('was', was, 'since', since) else '{}'::jsonb end
    from masks_turns where loudness <> 'silent';
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
  end loop;
  return first_tally;
end $$;

-- Make a character, with its first class (0009's, which this replaces): `timing` 'tally' waits to
-- debut at the next settlement, as before; 'now' drops it, debuted from its creation. `loudness`
-- 'announced' has The System name it, at the tally or, for a drop, at once; 'silent' does not.
-- The defaults are 0009's create_character(name, class).
drop function create_character(text, text);
create function create_character(name text, class text, timing text default 'tally', loudness text default 'announced') returns jsonb
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
  if timing = 'now' and loudness = 'announced' then announced := announce_drop(made, at); end if;
  return jsonb_build_object('id', made, 'name', named, 'class', class, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;

-- A character still waiting to debut, as its player: its announcement changed, or dropped now.
-- One that has debuted is refused; so is one retired, which an admin restores first.
create function set_debut(through uuid, timing text, loudness text) returns jsonb
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
  if timing = 'now' and loudness = 'announced' then announced := announce_drop(through, at); end if;
  return jsonb_build_object('id', through, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;

-- The two options, as the Edge Function checks them first (engine/rules/actions.ts).
create function debut_options(timing text, loudness text) returns void
language plpgsql immutable security definer set search_path = public, pg_temp as $$
begin
  if timing is null or timing not in ('now', 'tally') then
    raise exception 'a character drops now or debuts at the tally' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if loudness is null or loudness not in ('silent', 'announced') then
    raise exception 'a debut is silent or announced' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
end $$;

revoke execute on function post_tally(bigint, jsonb, jsonb, timestamptz, integer, integer), announce_drop(uuid, timestamptz),
  masks_change(timestamptz), debut_options(text, text), create_character(text, text, text, text), set_debut(uuid, text, text) from public, anon, authenticated;
grant execute on function create_character(text, text, text, text), set_debut(uuid, text, text) to authenticated;
