-- Turns are announced at once and committed (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 1; design 2026-11-24-staff-board-threads-design.md).
--
-- A Turn used to be announced at its settlement, in the season's Promos thread, as a side effect nobody chose the place of. Now an announced Turn is posted when its
-- player asks for it, in the thread the player names: turn() takes the thread, writes the character's own `announce` Act there at once (payload `ahead: true`, naming what the
-- player chose to name: the class it was, the class it will be) and commits the Turn, which then stands until it takes effect. A silent Turn can be announced later, and so committed,
-- by announce_turn(). The settlement writes no Act for a committed Turn; it links the class_history row it writes to the announcement (`class_history.announce_act`), so one join reads
-- an old Turn's announcement and a new one's alike, and class_reveals and turns_announced read an ahead announcement only once its Turn has landed, dated the landing.
--
--   1. columns            pending_turns.announce_act, class_history.announce_act (granted beside class_history's other public columns); the backfill for the Turns announced before this.
--   2. write_announce     (0100), taking `ahead`; a debut it writes is allowed past the guard below by a setting that lasts its statement (Task 2 removes debuts and this with them).
--      turn()'s `was` reads class_now(through, 'infinity') as 0074 did, not now() as the plan wrote: a window's end may lie ahead of now() (a settlement run early, and the tests' days), and the class a Turn leaves is the one it holds after every landing so far.
--   3. turn               (0074, 0028's three-argument shim and 0074's five-argument form dropped), taking the thread and announcing in it; refuses a change of a committed Turn.
--   4. announce_turn      new: announces and commits a silent pending Turn.
--   5. withdraw_turn      (0007), refusing a committed Turn in the change's words.
--   6. acts_well_formed   (0402), refusing a new debut announcement and an ahead announcement naming a class other than its Turn's.
--   7. masks_change       (0100), writing no Act for a committed Turn, linking the landing to its announcement; a Turn announced and queued before this migration is written the old way.
--   8. class_reveals, turns_announced   (0100), reading an ahead announcement through the landing.
--   9. my_characters      (0402), exposing the pending Turn's announcement, its thread and its number in it.
--
-- A plan gap, recorded: the plan calls the thread's checks `unmask`'s (not_the_systems, not_locked_out, not_closed, not_barred). unmask (0155) asks acting, not_banned, that the thread exists and
-- not_the_systems; the other three are the ones post (0402) asks, and not_closed is the one that refuses a thread started on a closed board. The thread check here is all of them, in the order
-- post asks them after unmask's: not_banned, exists, not_the_systems, not_locked_out, not_closed, not_barred, so that a Turn is posted nowhere a post would be refused.
--
-- Retiring a character (0205) already deletes its pending Turn, committed or not; nothing links its announcement to a class_history row, so it is never read as a reveal.

-- ---- 1. columns ----

alter table pending_turns add column announce_act uuid references acts (id);
alter table class_history add column announce_act uuid references acts (id);
grant select (announce_act) on class_history to authenticated;
-- One announcement is one Turn's, and a reader finds a Turn's announcement by the act.
create unique index class_history_announce_act on class_history (announce_act) where announce_act is not null;

-- The backfill: each old `announce` Turn Act whose character has a class_history row starting at the Act's date (the settlement's window end both were written at). class_history is not an Act
-- table; this is the one update.
update class_history h set announce_act = a.id
from acts a
where a.kind = 'announce' and a.payload ->> 'what' = 'turn' and a.character = h.character and a.created_at = h.started_at and h.announce_act is null;

-- ---- 2. write_announce ----

-- write_announce (0100), also taking `ahead` (default false), which adds `ahead: true` to the payload: the announcement of a Turn written before the Turn takes effect. A debut it writes (the
-- settlement's, until Task 2) sets kayfabb.debut_writer for the insert alone, which acts_well_formed's debut guard reads. Everything else as 0100 wrote it.
drop function write_announce(uuid, uuid, text, text, text, timestamptz);
create function write_announce(of_character uuid, in_thread uuid, what text, was text, cls text, at timestamptz, ahead boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare written uuid;
begin
  if what = 'debut' then perform set_config('kayfabb.debut_writer', 'on', true); end if;
  insert into acts (character, kind, thread, payload, created_at)
  values (of_character, 'announce', in_thread,
    jsonb_build_object('what', what) || case when was is not null then jsonb_build_object('was', was) else '{}'::jsonb end
                                     || case when cls is not null then jsonb_build_object('class', cls) else '{}'::jsonb end
                                     || case when ahead then jsonb_build_object('ahead', true) else '{}'::jsonb end, at)
  returning id into written;
  if what = 'debut' then perform set_config('kayfabb.debut_writer', '', true); end if;
  return act_projection(written);
end $$;
revoke execute on function write_announce(uuid, uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;

-- ---- 3. turn ----

-- The checks a Turn's thread meets before an announcement is written in it, shared by turn and announce_turn so that they cannot drift: the ones a reveal asks (not_banned, that the thread exists, not_the_systems)
-- and the ones a post asks beside them (not_locked_out, not_closed, not_barred), in that order. None of them differs with who owns anything.
create function turn_thread_checks(through uuid, in_thread uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare on_board uuid;
begin
  perform not_banned(through);
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform not_locked_out(through, in_thread);
  perform not_closed(on_board);
  perform not_barred(through, on_board);
end $$;
revoke execute on function turn_thread_checks(uuid, uuid) from public, anon, authenticated;

-- The refusal of any change to a committed Turn, in one place: turn, announce_turn's sibling withdraw_turn and the change all say it in the same words.
create function committed_turn_refusal(of_character uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare asked timestamptz; passed_over timestamptz;
begin
  select p.asked_at, p.due_at into asked, passed_over from pending_turns p where p.character = of_character and p.announce_act is not null;
  if not found then return; end if;
  -- A Turn a settlement passed over (masks_change sets due_at: the unmask backstop) takes effect at a later window, the first it can, which no time computed from asked_at names.
  raise exception 'that Turn was announced, so it stands until it takes effect at %',
    case when passed_over is not null then 'the next settlement it can' else coalesce(refusal_time(next_settlement_at(asked)), 'the next settlement') end
    using hint = 'kayfabb.refusal', errcode = '42501';
end $$;
revoke execute on function committed_turn_refusal(uuid) from public, anon, authenticated;

drop function turn(uuid, text, text);
drop function turn(uuid, text, text, boolean, boolean);

-- turn (0074), taking the thread an announced Turn is posted in. Every refusal of 0074 stays, in its order; a committed Turn refuses any change; an announced Turn requires a thread and a silent one
-- refuses one; the thread meets turn_thread_checks. An announced Turn writes its announcement at once, ahead, and commits: its id is stored in pending_turns.announce_act, and the answer carries it.
-- `in_thread` has no default in the plan; it defaults to null here so that a silent Turn needs no argument for it, and an announced one with none is refused.
create function turn(through uuid, to_class text, loudness text, show_from boolean, show_to boolean, in_thread uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text;
  last_turn timestamptz;
  next_allowed timestamptz;
  posted jsonb;
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
  if loudness = 'announced' and in_thread is null then
    raise exception 'an announced Turn is posted in a thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if loudness = 'silent' and in_thread is not null then
    raise exception 'a silent Turn is posted nowhere' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One Turn of a character's at a time, and none while a settlement makes one take effect
  -- (masks_change locks the same row), so the cooldown is read from what took effect.
  perform 1 from characters where id = through for no key update;
  -- A committed Turn stands until it takes effect.
  perform committed_turn_refusal(through);
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
  if loudness = 'announced' then perform turn_thread_checks(through, in_thread); end if;
  -- Asked again before the settlement, it is the same Turn, changed.
  insert into pending_turns (character, class_key, loudness, show_from, show_to) values (through, to_class, loudness, show_from, show_to)
  on conflict (character) do update set class_key = excluded.class_key, loudness = excluded.loudness, show_from = excluded.show_from, show_to = excluded.show_to,
    asked_at = clock_timestamp(), due_at = null;
  if loudness = 'announced' then
    posted := write_announce(through, in_thread, 'turn', case when show_from then was end, case when show_to then to_class end, clock_timestamp(), true);
    update pending_turns set announce_act = (posted ->> 'id')::uuid where character = through;
  end if;
  -- Read at the moment it was asked, as masks_change() reads asked_at.
  return jsonb_build_object('pending', true, 'class', to_class, 'loudness', loudness, 'show_from', show_from, 'show_to', show_to,
    'takes_effect_at', next_settlement_at(clock_timestamp()))
    || case when posted is not null then jsonb_build_object('announcement', posted) else '{}'::jsonb end;
end $$;
revoke execute on function turn(uuid, text, text, boolean, boolean, uuid) from public, anon;
grant execute on function turn(uuid, text, text, boolean, boolean, uuid) to authenticated;

-- ---- 4. announce_turn ----

-- A silent pending Turn, announced and so committed: the same thread checks and the same write as an announced turn(). Refused with no pending Turn, and with a committed one. Both `show_` false is a plain "has Turned".
create function announce_turn(through uuid, in_thread uuid, show_from boolean, show_to boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p pending_turns%rowtype;
  was text;
  posted jsonb;
begin
  perform acting(through);
  if show_from is null or show_to is null then
    raise exception 'a Turn names its classes or does not' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform 1 from characters where id = through for no key update;
  select * into p from pending_turns where character = through;
  if not found then raise exception 'no Turn of that character is waiting' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.announce_act is not null then raise exception 'that Turn was announced already' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if in_thread is null then raise exception 'an announced Turn is posted in a thread' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform turn_thread_checks(through, in_thread);
  select class_key into was from class_now(through, 'infinity');
  posted := write_announce(through, in_thread, 'turn', case when show_from then was end, case when show_to then p.class_key end, clock_timestamp(), true);
  update pending_turns set loudness = 'announced', show_from = announce_turn.show_from, show_to = announce_turn.show_to, announce_act = (posted ->> 'id')::uuid where character = through;
  return jsonb_build_object('pending', true, 'class', p.class_key, 'loudness', 'announced', 'show_from', show_from, 'show_to', show_to,
    'takes_effect_at', next_settlement_at(p.asked_at), 'announcement', posted);
end $$;
revoke execute on function announce_turn(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function announce_turn(uuid, uuid, boolean, boolean) to authenticated;

-- ---- 5. withdraw_turn ----

-- withdraw_turn (0007), refusing a committed Turn with the change's words. Everything else as 0007 wrote it.
create or replace function withdraw_turn(through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform acting(through);
  perform 1 from characters where id = through for no key update;
  perform committed_turn_refusal(through);
  delete from pending_turns where character = through;
  if not found then raise exception 'no Turn of that character is waiting' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  return jsonb_build_object('withdrawn', true);
end $$;

-- ---- 6. acts_well_formed ----

-- acts_well_formed (0402_thread_lockout): a new debut announcement is refused (a debut is no longer announced; the settlement's debut writer is let through by kayfabb.debut_writer until Task 2), and an announcement
-- ahead of its Turn names the class of its character's pending Turn, where any other names the class held. Everything else as 0402 wrote it.
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
    -- A debut is no longer announced (a character is active from the moment it is made). The settlement's own debut writer (write_announce) still writes one
    -- while the debut half of masks_change stays, and says so with a setting that lasts its statement; Acts already written are untouched.
    if new.payload ->> 'what' = 'debut' and coalesce(current_setting('kayfabb.debut_writer', true), '') <> 'on' then
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

-- ---- 7. masks_change ----

-- masks_change (0100): the Turns half inserts class_history (character, class_key, started_at, due_at, announce_act) from the pending row's announce_act, and a committed Turn (one with an announce_act) writes no Act, its announcement
-- being written already. A pending Turn with loudness 'announced' and no announce_act (queued before this migration) is written the old way, in the Promos thread: the changeover. The debut half stays until Task 2.
-- Everything else as 0100 wrote it.
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
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  -- A retired character makes no Act: one owed its announcement across a gap and retired since is
  -- named, as it was due to be, and skipped where the Acts are written, so no settlement is held back by it.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name, debut_loudness
  ) insert into masks_named (n, kind, entry)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name, 'loudness', debut_loudness)
    from (select id, name, debut_loudness from d where debut_loudness <> 'silent' union all select id, name, debut_loudness from owed) named;
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
  -- after this statement, so a debut's or a Turn's own at this window's end holds back no Turn here; the backstop stays on `unmask`, a player's
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
  -- A debut announced with its class names the class held once the window's Turns have taken effect.
  update masks_named m set entry = m.entry || jsonb_build_object('class', (select class_key from class_now((m.entry ->> 'character')::uuid, window_end)))
  where m.kind = 'debut' and m.entry ->> 'loudness' = 'with_class';
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

-- ---- 8. class_reveals, turns_announced ----

-- class_reveals (0100): an announce Act that names a class is read as it was (a debut with its class, an old Turn naming the class it Turns to: the class held when it was written) unless it is ahead of its Turn;
-- an ahead one is read through the landing, class_history on announce_act, its `at` the landing's started_at, and with no such row (the Turn has not landed, or never will) it is no reveal. Same columns.
create or replace view class_reveals as
  select a.id as act, a.character, a.payload ->> 'class' as class, a.created_at as at, a.payload ->> 'via' as via, a.thread
  from acts a where a.kind = 'unmask'
  union all
  select a.id, a.character, a.payload ->> 'class', a.created_at, a.payload ->> 'what', a.thread
  from acts a where a.kind = 'announce' and a.payload ? 'class' and coalesce(a.payload ->> 'ahead', '') <> 'true'
  union all
  select a.id, a.character, a.payload ->> 'class', h.started_at, a.payload ->> 'what', a.thread
  from acts a join class_history h on h.announce_act = a.id
  where a.kind = 'announce' and a.payload ? 'class' and a.payload ->> 'ahead' = 'true';

-- turns_announced (0100): the same, for the Turns an announce Act lists: an ahead announcement is a Turn taken when it lands, at the landing's started_at, and is listed only once landed. Same columns. Read by character first:
-- a filter on one is a probe of acts_tally_turns (the tallies), of acts_announce_character (the announce Acts) and of acts_announce_character with class_history_announce_act (the landings).
create or replace view turns_announced as
  select a.id as act, c.id as character, a.created_at as at, e.entry ->> 'was' as was
  from characters c
  cross join lateral (
    select x.id, x.created_at, x.payload from acts x
    where x.kind = 'tally' and x.payload -> 'turns' @> jsonb_build_array(jsonb_build_object('character', c.id))
  ) a
  cross join lateral jsonb_array_elements(a.payload -> 'turns') e(entry)
  where e.entry ->> 'character' = c.id::text
  union all
  select x.id, x.character, x.created_at, x.payload ->> 'was'
  from acts x where x.kind = 'announce' and x.payload ->> 'what' = 'turn' and coalesce(x.payload ->> 'ahead', '') <> 'true'
  union all
  select x.id, x.character, h.started_at, x.payload ->> 'was'
  from acts x join class_history h on h.announce_act = x.id
  where x.kind = 'announce' and x.payload ->> 'what' = 'turn' and x.payload ->> 'ahead' = 'true';

-- ---- 9. my_characters ----

-- my_characters (0402), with the pending Turn's announcement last: its Act, its thread and its number in it, where the Turn is committed. Everything else as 0402 wrote it; its grants are as they were.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
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
