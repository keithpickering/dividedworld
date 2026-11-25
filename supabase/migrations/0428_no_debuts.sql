-- No debuts: a character is made active (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 2; design 2026-11-24-staff-board-threads-design.md).
--
-- A character used to be made waiting, debuting at the next settlement, or dropped in at once, each silent or announced in the season's Promos thread. Now a character is active from the moment it
-- is made, and nothing announces it: create_character takes a name, a class and pronouns, sets debuted_at to its creation and writes no Act. A staff persona may still wait for an office
-- (0082: its way out is an office, not a settlement), so `debuted_at is null` still means a waiting persona, and played_by's refusal of one stays.
--
--   1. the changeover     every player character still waiting is made active now; the staff personas keep what seeding and their offices gave them.
--   2. my_characters      (0427), without `debut_loudness` (dropped and made again, since a view cannot lose a column in place); its grants are as 0030 gave them. my_threads_moved (0423), which reads it, is dropped and made again as it was.
--   3. write_announce, acts_well_formed   (0427), without the `kayfabb.debut_writer` setting 0427 added so the settlement's debut writer passed the new refusal of a debut announcement: the writers are gone,
--      so the refusal is absolute. The debut Acts already written stay as they were; they are history, read as they always were.
--   4. masks_change       (0427), without its debut half (the characters made before the window's end and waiting, and the owed announcements, `debut_announcement_due`); the Turns half is as 0427 wrote it.
--   5. create_character   (0377's five-argument form dropped), `create_character(name, class, pronouns jsonb default null)`, grants as 0124 gave them; the answer is { id, name, class }.
--   6. dropped            set_debut (0028), debut_options (0028), announce_drop (0100), and characters.debut_loudness and characters.debut_announcement_due (with the index and the check on them).
--      Nothing else reads the columns: the latest definition of every function that did is re-created above (grep of supabase/migrations/ for each), and the export and import tools
--      (tools/export-instance.mjs, tools/import-instance.mjs, supabase/functions/_shared/) read a table's columns as the database names them.
--
-- A way out for every state this touches: a waiting player character (none can be made now) is made active by the changeover above; a staff persona waits as before and ends when an office debuts it.

-- ---- 1. the changeover ----

update characters set debuted_at = now() where debuted_at is null and staff is null and retired_at is null;

-- ---- 2. my_characters ----

-- my_threads_moved (0423) reads my_characters, so it is dropped first and made again as it was, with its grants.
drop view my_threads_moved;
drop view my_characters;
create view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until,
         (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
         group_now(c.id) as "group",
         coalesce((select jsonb_agg(jsonb_build_object('board', b.board, 'move', b.move_act, 'group', b."group", 'expires_at', b.expires_at) order by b.board, b.move_act)
                   from bars_of(c.id) b), '[]'::jsonb) as bars,
         (select max(r.at) from class_reveals r where r.character = c.id and r.class = h.class_key and r.at >= h.started_at) as class_shown_at,
         coalesce((select jsonb_agg(jsonb_build_object('thread', l.thread, 'until', l.ends) order by l.ends, l.thread)
                   from (select s.thread, lockout_ends(s.id) as ends from acts s
                         where s.kind = 'spring' and s.payload ->> 'did' = 'lockedOut' and s.payload ->> 'locks' = c.id::text and (s.payload ->> 'until')::timestamptz > now()) l
                   where l.ends > now()), '[]'::jsonb) as lockouts,
         p.announce_act as pending_announce_act,
         n.thread as pending_announce_thread,
         n.seq as pending_announce_seq
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  left join lateral (select a.thread, a.seq from acts a where a.id = p.announce_act) n on true
  where c.owner = auth.uid();
revoke all on my_characters from anon, authenticated;
grant select on my_characters to authenticated;

create view my_threads_moved as
  select d.act as move, m.created_at as at, d.thread, s.character, d.from_board, case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end as to_board,
         t.title, (select b.name from boards_now b where b.id = d.from_board) as from_name,
         (select b.name from boards_now b where b.id = case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end) as to_name
  from my_characters mc
  join acts s on s.character = mc.id and s.seq = 1
  join thread_departures d on d.thread = s.thread
  join acts m on m.id = d.act and m.kind = 'move'
  join threads t on t.id = d.thread;
revoke all on my_threads_moved from public, anon, authenticated, service_role;
grant select on my_threads_moved to authenticated;

-- ---- 3. write_announce, acts_well_formed ----

-- write_announce (0427), without the setting for a debut's insert: it writes a debut no more, and the guard below refuses one from anyone. Everything else as 0427 wrote it.
create or replace function write_announce(of_character uuid, in_thread uuid, what text, was text, cls text, at timestamptz, ahead boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare written uuid;
begin
  insert into acts (character, kind, thread, payload, created_at)
  values (of_character, 'announce', in_thread,
    jsonb_build_object('what', what) || case when was is not null then jsonb_build_object('was', was) else '{}'::jsonb end
                                     || case when cls is not null then jsonb_build_object('class', cls) else '{}'::jsonb end
                                     || case when ahead then jsonb_build_object('ahead', true) else '{}'::jsonb end, at)
  returning id into written;
  return act_projection(written);
end $$;
revoke execute on function write_announce(uuid, uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;

-- acts_well_formed (0427): a debut announcement is refused from anyone, without the exception for the settlement's writer; everything else as 0427 wrote it.
create or replace function public.acts_well_formed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through the game''s own moves' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('draw', 'wash') and coalesce(current_setting('kayfabb.surface_writer', true), '') <> 'on' then
    raise exception 'a draw or a wash is written only through draw_on_surface and wash_surface' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) and new.kind <> 'wash' then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
    -- A debut is no longer announced (a character is active from the moment it is made), and nothing writes one; the Acts already written are untouched.
    if new.payload ->> 'what' = 'debut' then
      raise exception 'a debut is no longer announced' using errcode = '23514';
    end if;
  end if;
  -- An announcement written ahead of its Turn names the class its character's waiting Turn is to; any other names the class held when it was written.
  if new.kind = 'announce' and new.payload ? 'class' and coalesce(new.payload ->> 'ahead', '') = 'true' then
    if (new.payload ->> 'class') is distinct from (select p.class_key from pending_turns p where p.character = new.character) then
      raise exception 'an announcement ahead of a Turn names the class its character''s Turn is to' using errcode = '23514';
    end if;
  elsif (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (not (t.kind = 'card' or (t.kind = 'spring' and t.payload ->> 'did' = 'lockedOut')) or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play or a lockout, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A poll is of a post (or a spin) of its own character's, in its thread; a ballot and a close are of a poll, in its thread; an author's close is by the poll's own character.
  if new.kind = 'poll' and (not post_kind(t.kind) or t.character is distinct from new.character or t.thread <> new.thread) then
    raise exception 'a poll is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind in ('ballot', 'poll_close') and (t.kind <> 'poll' or t.thread <> new.thread) then
    raise exception 'a % is of a poll, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'poll_close' and new.character is not null and new.character is distinct from t.character then
    raise exception 'a poll is closed by its own author or by an admin' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card' and not post_kind(t.kind) then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (not post_kind(t.kind) or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A take-back is of a card set face down on the post it is on, by the one who set it, in the post's thread, while the back is live as of the take-back: not sprung, not taken back before (acts_one_take_back
  -- holds that), and not past its time. The card's own account is read from face_down, never named in the Act.
  if new.kind = 'take_back' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s join face_down f on f.play = s.id
       where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character and f.ends_at > new.created_at
         and not exists (select 1 from acts p where p.kind = 'spring' and (p.payload ->> 'set') = s.id::text))) then
    raise exception 'a take-back is of a live card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A gift is on a drive's opening play, in the play's thread: a card play whose card has a drive and whose payload names the play as its own drive. Whether the drive is still open and the amounts are donate's to say.
  if new.kind = 'donation' and (t.kind <> 'card' or t.thread <> new.thread or t.payload ->> 'drive' is distinct from t.id::text
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.drive is not null)) then
    raise exception 'a gift is to a drive, the first play of a drive card' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A draw or a wash is of a surface card's play that landed, in its thread; a wash is by the character that wrote the post under it.
  if new.kind in ('draw', 'wash') and (t.kind <> 'card' or t.thread <> new.thread or t.payload ? 'caught'
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.surface) or not exists (select 1 from surfaces s where s.play = t.id)) then
    raise exception 'a % is of a surface card''s play, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'wash' and new.character is distinct from (select p.character from acts p where p.id = t.target_act_id) then
    raise exception 'a wash is by the post''s own character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $function$;

-- ---- 4. masks_change ----

-- masks_change (0427), without the debut half: a settlement debuts no one and names no debut. The Turns half is as 0427 wrote it, including a Turn announced and queued before 0427, written the old way
-- in the Promos thread (the changeover of that migration).
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_season bigint;
  in_thread uuid;
  opened boolean;
  first_id uuid;
  written jsonb;
  r record;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text, due_at timestamptz, announce_act uuid) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  -- The backstop (the design's section 3): a Turn whose character revealed at or after the window's end does not take effect behind
  -- that reveal, which would make it false on its own date (#22). The claim (unmask) refuses such a reveal from the moment the run
  -- claims its window, but the run claims it only after it has asked for it: pg_cron's call, the function's start and
  -- next_settlement_window fall between the window's end and the claim. The Turn waits for the next window instead, by itself, and
  -- its player can change or withdraw it meanwhile. unmask() locks the character's row before it checks and writes, and the lock
  -- above is taken first, so a reveal goes wholly before this statement, which then sees it (a statement's snapshot is taken after
  -- the lock it waited on, under read committed), or wholly after it, naming the new class. The announcements this function writes come
  -- after this statement, so a Turn's own at this window's end holds back no Turn here; the backstop stays on `unmask`, a player's
  -- reveal being always an unmask.
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key, p.due_at, p.announce_act
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end
      and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= window_end);
  -- A Turn passed over is due at the first window it was passed over at; its record, never an Act, since a Turn is private.
  update pending_turns set due_at = coalesce(due_at, window_end) where asked_at < window_end and character not in (select character from masks_turns);
  insert into class_history (character, class_key, started_at, due_at, announce_act) select character, class_key, window_end, due_at, announce_act from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end
    from masks_turns where loudness <> 'silent' and announce_act is null;
  if not exists (select 1 from masks_named m join characters c on c.id = (m.entry ->> 'character')::uuid where c.retired_at is null and c.staff is null) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  select p.in_thread, p.opened into in_thread, opened from promos_thread(in_season) p;
  if opened then
    perform broadcast_later('board:' || (select board::text from threads where id = in_thread), 'thread', thread_projection(in_thread));
  end if;
  for r in
    select m.kind, m.entry from masks_named m join characters c on c.id = (m.entry ->> 'character')::uuid
    where c.retired_at is null and c.staff is null order by m.n
  loop
    written := write_announce((r.entry ->> 'character')::uuid, in_thread, r.kind, r.entry ->> 'was', r.entry ->> 'class', window_end);
    first_id := coalesce(first_id, (written ->> 'id')::uuid);
    perform broadcast_later('thread:' || (written ->> 'thread'), 'act', written);
  end loop;
  return first_id;
end $$;

-- ---- 5. create_character ----

drop function create_character(text, text, text, text, jsonb);

-- create_character (0377), a character made active: it debuts in the insert itself and writes no Act. The welcome pack is granted as 0377 granted it.
create function create_character(name text, class text, pronouns jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  named text := btrim(name, ' ');
  made uuid;
  at timestamptz;
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
  if create_character.pronouns is not null and not pronouns_hold(pronouns_lowered(create_character.pronouns)) then
    raise exception 'pronouns are five words of 1 to 12 letters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    -- A character is active from the moment it is made: debuted in the insert itself, at its creation (both are the transaction's now()).
    insert into characters (owner, name, debuted_at) values (caller, named, now())
    returning id, created_at into made, at;
  exception when unique_violation then
    raise exception 'that name is taken' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  insert into class_history (character, class_key, started_at) values (made, class, at);
  insert into character_profiles (character, pronouns) values (made, coalesce(pronouns_lowered(create_character.pronouns), new_pronouns()));
  -- The account's welcome pack (0377), sealed, where `startingPack` names a fixed pack: the same insert for every character, and the unique index (one per account) does nothing for a second, so a retry,
  -- a second character and two made at once grant once, and the answer below is the same shape whether or not a pack was granted.
  insert into packs (account, pack, price, contents, source)
  select caller, k.key, 0, k.contents, 'welcome' from pack_kinds k where k.key = welcome_pack_kind()
  on conflict (account) where source = 'welcome' do nothing;
  return jsonb_build_object('id', made, 'name', named, 'class', class);
end $$;
revoke execute on function create_character(text, text, jsonb) from public, anon;
grant execute on function create_character(text, text, jsonb) to authenticated;

-- ---- 6. dropped ----

drop function set_debut(uuid, text, text);
drop function debut_options(text, text);
drop function announce_drop(uuid, timestamptz);
alter table characters drop column debut_loudness;
alter table characters drop column debut_announcement_due;
