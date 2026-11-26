-- Announcements, the staff pin and the recap (docs/plans/2026-11-25-arc-announcements-plan.md, Task 3; its design, sections 1, 3, 4, 5 and 8).
-- Part 1 of the migration (Task 3) stands first; part 2 is appended below (arc_plot, pool_record's `plot`, `push` and `leadIns`, meeting_context's `plot` and `leadIns`, board_page's `stickies`).
--
-- Part 1. An announced beat opens a sticky thread; the recap; two gaps Task 2 found.
--   arc_announcements   insert-only (its guards fire always; RLS on, no client grant): one row per announcement the meeting wrote: season, staff, beat (the event key, `after:<pred>:<key>` for an aftermath beat),
--                       thread, act (the post), title, pitch, push (the authored line, copied at write so a later seed cannot change what was said), the arc_beat_events row it announces (`play`) and `repeatable`.
--                       Uniqueness knows a repeatable beat by that column, set at write from the persona's file: unique (season, staff, beat) where not repeatable, and unique (play) always, so a repeatable beat
--                       announces once for each play. The pitch is cut at 200 characters and the push at 300 (PITCH_MOST, PUSH_MOST); a bound a model overshoots is trimmed and recorded, never a lost answer.
--   staff_pin_events    insert-only (`pinned` | `unpinned`; by is null for the system, the admin's account otherwise), indexed (season, thread, id desc). staff_stickies(board) lists the threads of a board whose latest
--                       event is `pinned` in the open season, oldest pin first: a pin ends with its season, or when an admin unpins it. unpin_staff_thread (admin only) writes `unpinned`, and refuses a thread
--                       with no live pin in plain words. Both are read-only to players: staff_stickies is called by board_page, in part 2, which runs as its caller, so part 2 grants it to the signed-in role like board_stubs; the admin's unpin is granted to authenticated as the
--                       other admin RPCs are.
--   arc_beat_key        the event key a beat named in a payload stands for: the Boss's own beat, or an unlocked-or-not aftermath beat of the predecessor that seated it (the plain key arc_for_meeting lists, or
--                       the full `after:<pred>:<key>`). Own beats win a plain key that both name.
--   apply_meeting       (0445) takes `announcements: [{beat, title, body, pitch, push}]`. For each, after the beat's `played` event is written in this meeting: open_staff_thread(boss, title), the body as the
--                       Boss's post at seq 1, a `pinned` event and the arc_announcements row, in one sub-block, so a failure leaves none of them and the answer stands. An announcement for a beat this meeting
--                       did not play (named by no bundle, or whose bundle was refused) is skipped and recorded in `announcementsSkipped` with the beat named, as a refused bundle is: a bad one never fails
--                       the whole answer. A meeting already applied returns before any of it, so a repeat writes nothing twice; a refused bundle writes no `played` event and so no announcement.
--                       It also accepts an aftermath beat of the predecessor as `bundles[].beat`, by its plain key or `after:<pred>:<key>` (arc_beat_key), writes its `played` event under
--                       `after:<pred>:<key>` and queues its authored bundle at no cost, as an own beat's. It stores the payload's `recap` beside the farewell and handoff, under the same window rule.
--   handoffs            gains `recap` (at most 300 characters); handoffs_latest gains it as its last column.
--   queued_moves_guard  (0424) reads a role of the predecessor's beat, {role, beat, of: 'predecessor'}, through beat_role_board's fifth argument; a role is written with those keys and no others.
--   system_tick         (0445) lands a part of a bundle in the thread of the announcement of the beat that played the bundle; a bundle with no announcement (an instance's played Split before this migration, a
--                       beat with no `announce` block) lands as 0437 wrote it: in the thread of the bundle's earliest landed part, else a thread of its own. Its role resolution passes `of` likewise.
--
-- Latest definitions copied: apply_meeting and system_tick (0445_persona_lines.sql), queued_moves_guard (0424_staff_requests.sql), handoffs_latest (0403_departed_personas.sql). Everything each does that is not
-- named here is as written there; security definer, search_path and grants stay (they are replaced in place).
-- Existing rows: the new tables start empty and no announcement is written retroactively, so a bundle played before this migration still lands in the move thread 0437 opened.
-- Ways out: a staff pin ends with its season or by an admin's unpin; no state is added to a player, a character or a post. A thread that promised something an admin held is the fiction; the log and the move posts
-- say what landed. Masks: nothing here reads who made a character, a class or who reacted; staff_stickies reads staff threads only. At a busy instance: a few announcements a season, one thread and one pin each; the stickies of
-- a board are a read of its pins in the open season through the index.
--
-- Part 2. The reads: the plot so far, the Boss's push and lead-ins, the stickies of a board.
--   arc_plot(in_staff)  `{last, initiatives}`: the plot so far, the same for every reader (in_staff, the reader, changes nothing in it: the engine compares its own key with `last.boss` and each initiative's `boss`
--                       for its second-person reading, design 8a). `last` is {boss, name, recap, facts} for the length of the CURRENT Boss's honeymoon (arc_season_span, so its persona's own phase_days count) after the
--                       handover that seated it (season_handovers.at, the one arc_predecessor reads), else null; recap is handoffs_latest's (null where none) and `facts` is handoff_facts of the season that Boss served,
--                       given only where there is no recap (it is the fallback, and only ever read inside a prompt). `initiatives` are the open season's arc_announcements, oldest first, a departed Boss's included
--                       (the season's story is one), capped at the latest 12: a persona file may hold 24 beats (ARC_BEATS_MOST), and a Boss that announces every one would put about 24 x 350 characters in
--                       every staff pool call; 12 keep the section to about 4,000 characters, and a season with more has its older ones scroll off, as they do the board.
--   admin_staff_pins    (admin only) the open season's live staff pins on every board with each title, oldest first, for the Machine screen.
--   pool_record         (0415) gains `plot` (arc_plot) for every persona and, for the sitting Boss alone, `push` (the authored push of each initiative that Boss announced in this season, blanks left out, oldest first, the
--                       latest 12: a departed Boss's push is never the sitting Boss's) and `leadIns` (arc_lead_ins keys; the Edge Function maps them to mood lines). A Mod or a member has neither key.
--   meeting_context     (0404) gains `plot` and `leadIns` for the current Boss.
--   board_page          (0368) gains `stickies`: page 1's rows of the board's staff pins, each as thread_list gives it, in staff_stickies' order, and `[]` on any other page or board. As with `pins`, the rows are not taken out of
--                       `threads` here (the pager's numbers stay the thread count's); the reader draws the stickies first and leaves them out of the rows below. Their characters, reads and views are in the page's lists.
--                       staff_stickies is granted to the signed-in role for it (a definer reading staff threads: public facts, the same for every caller).
-- Latest definitions copied: pool_record (0415_chattier_staff.sql), meeting_context (0404_card_retirement.sql), board_page (0368_client_reads_plan_once.sql).
-- Masks: none of these reads who made a character, a class or who reacted; the plot is announcements, handoffs and handover rows. A busy instance: the plot is bounded (12 initiatives, one recap); stickies are the few pins of one board.

-- ------------------------------------------------------------------------------------ the tables ----

create table arc_announcements (
  id bigint generated always as identity primary key,
  season bigint not null references seasons (id),
  staff text not null references characters (staff),
  beat text not null check (beat ~ '^[a-z][a-z0-9_-]{0,39}$' or beat ~ '^after:[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$'),
  thread uuid not null references threads (id),
  act uuid not null references acts (id),
  title text not null check (title <> ''),
  pitch text not null default '' check (char_length(pitch) <= 200),
  push text not null default '' check (char_length(push) <= 300),
  -- The `played` event of arc_beat_events this announces: one announcement for each play. No foreign key to it: an import writes this table before arc_beat_events (name order), in replica mode.
  play bigint not null,
  repeatable boolean not null default false,
  at timestamptz not null default now()
);
create unique index arc_announcements_play on arc_announcements (play);
create unique index arc_announcements_beat on arc_announcements (season, staff, beat) where not repeatable;
alter table arc_announcements enable row level security;
revoke all on arc_announcements from public, anon, authenticated;

create function arc_announcements_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then raise exception 'an announcement is only ever added (%)', tg_op using errcode = 'P0001'; end if;
  -- An import writes as a replica, in name order, so this table's rows go in before the events and the threads they name; each row was checked when it was first written.
  if current_setting('session_replication_role') = 'replica' then return new; end if;
  if not exists (select 1 from arc_beat_events e where e.id = new.play and e.event = 'played' and e.season = new.season and e.staff = new.staff and e.beat = new.beat) then
    raise exception 'an announcement is for a beat''s play, and % is not one of %''s plays of %', new.play, new.staff, new.beat using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function arc_announcements_guard() from public, anon, authenticated;
create trigger arc_announcements_insert before insert on arc_announcements for each row execute function arc_announcements_guard();
create trigger arc_announcements_no_update before update on arc_announcements for each row execute function arc_announcements_guard();
create trigger arc_announcements_no_delete before delete on arc_announcements for each row execute function arc_announcements_guard();
create trigger arc_announcements_no_truncate before truncate on arc_announcements for each statement execute function arc_announcements_guard();
alter table arc_announcements enable always trigger arc_announcements_insert;
alter table arc_announcements enable always trigger arc_announcements_no_update;
alter table arc_announcements enable always trigger arc_announcements_no_delete;
alter table arc_announcements enable always trigger arc_announcements_no_truncate;

create table staff_pin_events (
  id bigint generated always as identity primary key,
  thread uuid not null references threads (id),
  season bigint not null references seasons (id),
  event text not null check (event in ('pinned', 'unpinned')),
  -- Null for the system (an announcement pins its own thread); the admin's account for an unpin.
  by uuid,
  at timestamptz not null default now(),
  check (event = 'unpinned' or by is null)
);
-- A thread's latest event in a season, and all the pins of a season: staff_stickies reads this and nothing else of the table.
create index staff_pin_events_latest on staff_pin_events (season, thread, id desc);
alter table staff_pin_events enable row level security;
revoke all on staff_pin_events from public, anon, authenticated;

create function staff_pin_events_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'a staff pin event is only ever added (%)', tg_op using errcode = 'P0001';
end $$;
revoke execute on function staff_pin_events_guard() from public, anon, authenticated;
create trigger staff_pin_events_no_update before update on staff_pin_events for each row execute function staff_pin_events_guard();
create trigger staff_pin_events_no_delete before delete on staff_pin_events for each row execute function staff_pin_events_guard();
create trigger staff_pin_events_no_truncate before truncate on staff_pin_events for each statement execute function staff_pin_events_guard();
alter table staff_pin_events enable always trigger staff_pin_events_no_update;
alter table staff_pin_events enable always trigger staff_pin_events_no_delete;
alter table staff_pin_events enable always trigger staff_pin_events_no_truncate;

-- ---------------------------------------------------------------------------------- the stickies ----

-- The threads of a board that stand pinned: the latest event of the thread in the open season is `pinned`, the oldest pin first. A season that is no longer open holds none, so a roll-over needs no write.
create function staff_stickies(in_board uuid) returns table (thread uuid, pinned_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.thread, p.at
  from staff_pin_events p
  join threads t on t.id = p.thread and t.board = in_board
  where p.season = (select x.id from seasons x where x.ends_at is null) and p.event = 'pinned'
    and not exists (select 1 from staff_pin_events q where q.season = p.season and q.thread = p.thread and q.id > p.id)
  order by p.at, p.id
$$;
revoke execute on function staff_stickies(uuid) from public, anon, authenticated;
grant execute on function staff_stickies(uuid) to service_role;

-- An admin takes a staff thread's pin down. The refusal is in plain words: the glass shows it as it is.
create function unpin_staff_thread(in_thread uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sn bigint := (select x.id from seasons x where x.ends_at is null);
  last text;
begin
  perform only_admins('unpins a staff thread');
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.staff_pin.' || coalesce(in_thread::text, ''), 0));
  select p.event into last from staff_pin_events p where p.season = sn and p.thread = in_thread order by p.id desc limit 1;
  if last is distinct from 'pinned' then
    raise exception 'That thread has no live pin.' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into staff_pin_events (thread, season, event, by) values (in_thread, sn, 'unpinned', auth.uid());
  return jsonb_build_object('thread', in_thread);
end $$;
revoke execute on function unpin_staff_thread(uuid) from public, anon;
grant execute on function unpin_staff_thread(uuid) to authenticated;

-- ------------------------------------------------------------------------------------- the beat key ----

-- The event key a beat named in a payload stands for: the Boss's own beat, else an aftermath beat of the predecessor that seated it in this season, by its plain key (as arc_for_meeting lists it) or as
-- `after:<predecessor>:<key>`. Null where it is neither. A beat of both names is the Boss's own: the full form names the other.
create function arc_beat_key(in_staff text, in_season bigint, in_beat text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select b.value ->> 'key' from persona_arcs a, jsonb_array_elements(a.beats) b where a.staff = in_staff and b.value ->> 'key' = in_beat limit 1),
    (select 'after:' || p.staff || ':' || (b.value ->> 'key')
     from arc_predecessor(in_staff, in_season) p join persona_arcs a on a.staff = p.staff, jsonb_array_elements(a.aftermath) b
     where p.seated = in_season and (b.value ->> 'key' = in_beat or 'after:' || p.staff || ':' || (b.value ->> 'key') = in_beat) limit 1))
$$;
revoke execute on function arc_beat_key(text, bigint, text) from public, anon, authenticated;
grant execute on function arc_beat_key(text, bigint, text) to service_role;

-- ------------------------------------------------------------------------------------- the recap ----

alter table handoffs add column recap text check (char_length(recap) <= 300);
-- The words that stand (0403), the recap the last column. A view takes a new column at its end.
create or replace view handoffs_latest as
  select distinct on (h.season, h.staff) h.id, h.season, h.staff, h.meeting, h.farewell, h.note, h.written_at, h.recap
  from handoffs h order by h.season, h.staff, h.id desc;

-- ---------------------------------------------------------------------------------- the queue's roles ----

create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
  holder text;
  watched uuid;
  source uuid;
  target record;
  grp group_kinds%rowtype;
  has_board boolean;
  dkind text;
  check_at timestamptz;
  cap jsonb;
  lasting_param text;
  rk text;
  rn text;
  part queued_moves%rowtype;
  has_role boolean := false;
  depends bigint[] := '{}';
  probe jsonb;
  used text[] := '{}';
  stand uuid;
  made_board uuid;
  maker bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
    -- Who may make a move: the office the staff member holds now must be one the kind names (0103). The Boss holds the seat the open season names;
    -- a Mod Bot is on staff; a member, a benched persona, a waiting one and the developer make none.
    holder := (select o.office from staff_office_now o where o.staff = new.staff);
    if holder is null or not exists (select 1 from move_kinds k where k.key = new.kind and holder = any (k.offices)) then
      raise exception 'a % move is not one a % makes', new.kind, coalesce(holder, 'staff member with no office') using errcode = '23514';
    end if;
    -- The Boss's three moves on the machine (0140): the params, the demand and the bounds, from the move and the economy alone. What the machine looks like when
    -- the move lands is checked then, by the tick, which refuses a move that cannot (a meeting that read the machine a day earlier is not failed for it).
    if new.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
      if jsonb_typeof(new.params -> 'slot') = 'string' then new.params := jsonb_set(new.params, '{slot}', to_jsonb(lower(new.params ->> 'slot'))); end if;
      problem := machine_move_problem(new.kind, new.params, new.demand, new.go_live_at, new.expires_at, false);
      if problem is not null then raise exception 'a machine move is refused: %', problem using errcode = '23514'; end if;
    end if;
    -- A lasting move (0320) has no expiry and carries no demand: the meeting queues it with an expiry of its own length (0 hours), which is nothing, so the guard keeps none.
    if (select k.lasting from move_kinds k where k.key = new.kind) then
      if new.demand is not null then raise exception 'a % has no demand; what it builds stays', new.kind using errcode = '23514'; end if;
      new.expires_at := null;
    end if;
    -- A bundle (0329): parts sharing one id and one name. A part may name another part's result by its role, {"role": r}, where a board goes; the part it names is the bundle's own, made
    -- earlier in the queue, and makes a board. What a move builds on is its `depends_on`, set here and nowhere else: a caller's value is never kept. A later move naming a board a move made
    -- (a real id, outside any bundle) depends on that move's row too, so an admin's hold or reversal of the creation follows it.
    new.depends_on := null;
    if new.bundle is null then
      if new.role is not null or new.bundle_name is not null then raise exception 'a role and a name belong to a part of a bundle, and this move is in none' using errcode = '23514'; end if;
    else
      if new.bundle_name is null or btrim(new.bundle_name) = '' then raise exception 'a bundle has a name' using errcode = '23514'; end if;
      if exists (select 1 from queued_moves p where p.bundle = new.bundle and p.bundle_name <> new.bundle_name) then
        raise exception 'a bundle has one name: this part says "%" and its bundle says otherwise', new.bundle_name using errcode = '23514';
      end if;
    end if;
    if new.kind in ('createBoard', 'moveThread', 'mergeBoard') then
      for rk in select unnest(array['thread', 'board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> rk) = 'object' then
          if rk = 'thread' then raise exception 'a role names a board, never a thread' using errcode = '23514'; end if;
          if new.bundle is null then raise exception 'a {"role"} names a part of the same bundle and is admitted only inside a bundle' using errcode = '23514'; end if;
          if jsonb_typeof(new.params #> array[rk, 'role']) is distinct from 'string'
             or exists (select 1 from jsonb_object_keys(new.params -> rk) k where k not in ('role', 'beat', 'of'))
             or ((new.params -> rk) ? 'beat' and jsonb_typeof(new.params #> array[rk, 'beat']) is distinct from 'string')
             or ((new.params -> rk) ? 'of' and (not ((new.params -> rk) ? 'beat') or new.params #> array[rk, 'of'] is distinct from '"predecessor"'::jsonb)) then
            raise exception 'a role is written {"role": name}, or {"role": name, "beat": key} for a board an earlier beat made, or {"role": name, "beat": key, "of": "predecessor"} for one the last Boss''s beat made, and nothing more' using errcode = '23514';
          end if;
          rn := new.params #>> array[rk, 'role'];
          if (new.params -> rk) ? 'beat' then
            -- A board an earlier beat's bundle made (0334): resolved now, from the landed Acts, so it must have landed; the move that made it is what this part builds on.
            made_board := beat_role_board(meeting_season(new.meeting), new.staff, new.params #>> array[rk, 'beat'], rn, new.params #>> array[rk, 'of']);
            if made_board is null then
              raise exception 'the role "%" of the beat "%" has made no board yet', rn, new.params #>> array[rk, 'beat'] using errcode = '23514';
            end if;
            maker := (select q.id from queued_moves q join boards b on b.created_by_act = q.landed_act where b.id = made_board);
            depends := depends || coalesce(maker, 0::bigint);
            has_role := true;
          else
            select * into part from queued_moves p where p.bundle = new.bundle and p.role = rn;
            if not found then raise exception 'the role "%" names no part of this bundle made before this one', rn using errcode = '23514'; end if;
            if part.kind <> 'createBoard' then raise exception 'the part with the role "%" makes no board', rn using errcode = '23514'; end if;
            depends := depends || part.id;
            has_role := true;
          end if;
        end if;
      end loop;
      if new.kind = 'mergeBoard' and has_role and new.params -> 'board' = new.params -> 'into' then raise exception 'a board is never merged into itself' using errcode = '23514'; end if;
    elsif exists (select 1 from jsonb_each(new.params) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
      raise exception 'a role is for the moves that build the board, and a % is not one', new.kind using errcode = '23514';
    end if;
    -- The three moves that build the board: one form of the ids for every reader (the indexes on the moves compare lowercase), then what the move names, as it is now.
    if new.kind in ('createBoard', 'moveThread', 'mergeBoard') then
      for lasting_param in select unnest(array['thread', 'board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> lasting_param) = 'string' then new.params := jsonb_set(new.params, array[lasting_param], to_jsonb(lower(new.params ->> lasting_param))); end if;
      end loop;
      -- A real id that a move made puts that move among what this one depends on; the names it carries are checked as they are now (a role's board does not exist yet: an open board of
      -- the players stands in for each, a different one each, and the landing checks the real one).
      for lasting_param in select unnest(array['board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> lasting_param) = 'string' then
          used := used || (new.params ->> lasting_param);
          depends := depends || coalesce((select q.id from queued_moves q join boards b on b.created_by_act = q.landed_act where b.id = safe_uuid(new.params ->> lasting_param)), 0::bigint);
        end if;
      end loop;
      depends := array_remove(depends, 0::bigint);
      probe := new.params;
      if has_role then
        for rk in select k from jsonb_object_keys(new.params) k where jsonb_typeof(new.params -> k) = 'object' loop
          stand := (select b.id from boards b where not b.is_system and board_is_open(b.id) and not (b.id::text = any (used)) order by b.created_at, b.id limit 1);
          if stand is null then probe := null; exit; end if;
          used := used || stand::text;
          probe := jsonb_set(probe, array[rk], to_jsonb(stand::text));
        end loop;
      end if;
      if probe is not null then problem := lasting_move_problem(new.kind, probe); end if;
      if problem is not null then raise exception 'a % is refused: %', new.kind, problem using errcode = '23514'; end if;
      if cardinality(depends) > 0 then new.depends_on := (select array_agg(distinct x order by x) from unnest(depends) x); end if;
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
    -- A group move (the design's section 5). The character is a debuted one of the players' and not staff; the group is one the instance lists as conferred. A board is barred
    -- only by a punishment, and it is a board of the players. A punishment that bars a board carries the apology that lifts it, and nothing else carries that demand. A favor
    -- carries the check the tick reads and the demand it reads; a punishment carries none. A character has one such move at a time, and a punishment waits out the cap.
    if new.kind = 'conferGroup' then
      -- One form of the ids for every reader (the landed-Act count, the index), as a rule's board is kept in lowercase.
      if jsonb_typeof(new.params -> 'character') = 'string' then new.params := jsonb_set(new.params, '{character}', to_jsonb(lower(new.params ->> 'character'))); end if;
      if jsonb_typeof(new.params -> 'board') = 'string' then new.params := jsonb_set(new.params, '{board}', to_jsonb(lower(new.params ->> 'board'))); end if;
      select c.id, c.name, c.staff into target from characters_public c
      where c.id = case when lower(new.params ->> 'character') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'character')::uuid end;
      if target.id is null then raise exception 'a group move names a member who has debuted' using errcode = '23514'; end if;
      if target.staff is not null then raise exception 'a group move never names a staff member' using errcode = '23514'; end if;
      select * into grp from group_kinds k where k.key = new.params ->> 'group' and k.source = 'conferred';
      if not found then raise exception 'a group move names a conferred group, and "%" is not one', coalesce(new.params ->> 'group', '') using errcode = '23514'; end if;
      -- A Mod's group move is a punishment that bars a board of its beat: the favor is refused here, and the board and the beat by the Mod's rules below.
      if holder = 'mod' and grp.tone <> 'punishment' then raise exception 'a Mod confers a punishment, never a favor' using errcode = '23514'; end if;
      has_board := new.params -> 'board' is not null and new.params -> 'board' <> 'null'::jsonb;
      if has_board then
        if grp.tone <> 'punishment' then raise exception 'only a punishment bars a board' using errcode = '23514'; end if;
        if lower(new.params ->> 'board') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or not exists (select 1 from boards b where b.id = (new.params ->> 'board')::uuid and b.id is distinct from system_board()) then
          raise exception 'a group move bars a board of the players, not The System''s' using errcode = '23514';
        end if;
      end if;
      dkind := new.demand ->> 'kind';
      if grp.tone = 'punishment' and has_board and dkind is distinct from 'apologyAccepted' then
        raise exception 'a punishment that bars a board carries the demand apologyAccepted' using errcode = '23514';
      end if;
      if dkind = 'apologyAccepted' and not (grp.tone = 'punishment' and has_board) then
        raise exception 'only a punishment that bars a board carries the demand apologyAccepted' using errcode = '23514';
      end if;
      if grp.tone = 'favor' then
        begin
          check_at := (new.params ->> 'checkAt')::timestamptz;
        exception when others then
          check_at := null;
        end;
        if new.expires_at is null or check_at is null or check_at <= new.go_live_at or check_at >= new.expires_at then
          raise exception 'a favor carries a checkAt between its go-live and its expiry' using errcode = '23514';
        end if;
        if new.demand is null then raise exception 'a favor carries the demand its check reads' using errcode = '23514'; end if;
      elsif new.params ? 'checkAt' then
        raise exception 'a punishment carries no checkAt' using errcode = '23514';
      end if;
      -- One decision under the character's lock, as a patrol's finding is (start_visit): the one-at-a-time rule and the cap.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.cap:' || target.id::text, 0));
      if exists (select 1 from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'conferGroup' and lower(a.payload #>> '{params,character}') = target.id::text)
         or exists (select 1 from queued_moves q where q.kind = 'conferGroup' and lower(q.params ->> 'character') = target.id::text and q.landed_act is null and q.held_at is null and q.refused_at is null) then
        raise exception 'that character is already in a group a move put it in' using errcode = '23514';
      end if;
      if grp.tone = 'punishment' then
        cap := mod_cap();
        if staff_punishments(target.id, (cap ->> 'days')::integer) >= (cap ->> 'punishments')::integer then
          raise exception '% has been punished % times in % days, the most staff may', target.name, cap ->> 'punishments', cap ->> 'days' using errcode = '23514';
        end if;
      end if;
    end if;
    if new.admin_description is not null then raise exception 'a queued move is queued without an admin''s replacement' using errcode = '23514'; end if;
    if new.kind = 'setRule' then
      -- A rule ends by its expiry, so none waits on an admin; the board is stored in lowercase, the one form numbering and indexes compare.
      if new.expires_at is null then raise exception 'a rule needs an expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'board') = 'string' then new.params := jsonb_set(new.params, '{board}', to_jsonb(lower(new.params ->> 'board'))); end if;
      -- The board's shape comes before anything casts it: a board that is no uuid is a malformed rule, never an error in a cast.
      if jsonb_typeof(new.params -> 'board') is distinct from 'string' and new.params -> 'board' is not null and new.params -> 'board' <> 'null'::jsonb then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      if jsonb_typeof(new.params -> 'board') = 'string' and (new.params ->> 'board') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      problem := rule_params_problem(new.params);
      if problem is not null then raise exception 'a rule is malformed: %', problem using errcode = '23514'; end if;
      problem := rule_conflict(nullif(new.params ->> 'board', '')::uuid, new.params ->> 'predicate', nullif(new.params -> 'param', 'null'::jsonb));
      if problem is not null then raise exception 'that rule would leave no post that follows the rules: %', problem using errcode = '23514'; end if;
    end if;
    -- A Mod's move names a board of its beat and spends an allowance (0103); a Mod's moveThread names two, the thread's and its destination. The board is the beat_of answer for it, so a board the Boss's order left out is
    -- still some Mod's; the allowance is counted under a lock of the Mod's own, so two moves queued at once cannot spend the one left.
    -- Only the guard says which order a row spends against: a caller's value is never kept.
    new.spent_order := null;
    if holder = 'mod' then
      -- The Mod's own lock comes first: the beat and the allowance are read under it, so two moves queued at once (two sessions, or two rows of one insert,
      -- which are counted because these functions are volatile) cannot spend the one left.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || new.staff, 0));
      watched := case when (new.params ->> 'board') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'board')::uuid end;
      if watched is null then raise exception 'a Mod''s move names the board it watches' using errcode = '23514'; end if;
      if new.kind = 'moveThread' then
        -- A Mod moves a thread between boards of its beat: the thread's board now and the board it goes to are each on it, and each refusal names which.
        source := thread_place(safe_uuid(new.params ->> 'thread'));
        if source is null or beat_of(source) is distinct from new.staff then raise exception 'the thread is on a board that is not on %''s beat', new.staff using errcode = '23514'; end if;
        if beat_of(watched) is distinct from new.staff then raise exception 'the board it goes to is not on %''s beat', new.staff using errcode = '23514'; end if;
        if watched = source then raise exception 'the thread is already on that board' using errcode = '23514'; end if;
      elsif beat_of(watched) is distinct from new.staff then raise exception 'that board is not on %''s beat', new.staff using errcode = '23514';
      end if;
      -- A rule a Mod sets lasts at most `modBots.ruleDaysMost` days (7 where the setting is not there yet; setting_modbots holds it a whole number, and it is read as numeric all the same): the Boss's phase bounds the Boss's, and nothing but this bounds a Mod's.
      if new.kind = 'setRule' and new.expires_at > new.go_live_at + coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * interval '1 day' then
        raise exception 'a rule a Mod sets lasts at most % days', coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7)::numeric(10,0) using errcode = '23514';
      end if;
      if mod_allowance(new.staff) < 1 then raise exception '% has no allowance left; the Boss hands out more at its meeting', new.staff using errcode = '23514'; end if;
      new.spent_order := (select x.id from staff_orders x where x.staff = new.staff order by x.id desc limit 1);
    end if;
  else
    params_ok := new.params is not distinct from old.params
      or (old.kind = 'nameSuccessor' and old.landed_act is null and old.held_at is null
          and new.params - 'boss' = old.params - 'boss' and jsonb_typeof(new.params -> 'boss') = 'string');
    if not params_ok
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural, new.spent_order, new.cause_act, new.bundle, new.bundle_name, new.role, new.depends_on)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural, old.spent_order, old.cause_act, old.bundle, old.bundle_name, old.role, old.depends_on) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    -- Who replaced a nomination and when change only with the Boss they replace, and with each other.
    if (new.replaced_by, new.replaced_at) is distinct from (old.replaced_by, old.replaced_at)
       and (new.params is not distinct from old.params or new.replaced_by is null or new.replaced_at is null) then
      raise exception 'a replacement is recorded with the Boss it puts in place' using errcode = '23514';
    end if;
    -- An admin's replacement of a description is for a rename still waiting, and never leaves the row afterward.
    if (new.admin_description, new.described_by, new.described_at) is distinct from (old.admin_description, old.described_by, old.described_at)
       and (old.kind <> 'renameBoard' or old.landed_act is not null or old.held_at is not null or new.admin_description is null) then
      raise exception 'only a rename that is still waiting takes an admin''s description' using errcode = '23514';
    end if;
    -- A refusal at landing is final: set once, on a row still waiting, and never changed or taken back.
    if (new.refused_at, new.failed_at, new.failure) is distinct from (old.refused_at, old.failed_at, old.failure)
       and (old.refused_at is not null or (new.refused_at is not null and (old.landed_act is not null or old.held_at is not null or new.failure is null))) then
      raise exception 'a refused rule stays refused' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- system_tick (0445), a part of a bundle landing in the announcement thread of the beat that played the bundle where there is one, and a role of the predecessor's beat resolved through its `of`. Everything else as 0445 wrote it.
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
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on, q.line from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
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
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'], lp #>> array[rk, 'of'])
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
          -- A bundle an announced beat played lands in that beat's announcement thread (arc_announcements, read through the play it announces); one with no announcement (a beat with no `announce` block, or a bundle played
          -- before announcements) goes where 0437 sent it: the thread of the bundle's earliest landed part.
          select n.thread into mt from arc_announcements n join arc_beat_events e on e.id = n.play where e.bundle = due.bundle limit 1;
          if mt is null then
            select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null order by a.created_at, a.seq, a.id limit 1;
          end if;
        end if;
        if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
        written := (write_staff_act(due.staff, 'move', mt, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', case when nullif(btrim(due.line, E' \t\n\r\f\v'), '') is not null then system_line_fill(btrim(due.line, E' \t\n\r\f\v'), due.kind, lp, due.staff)
            else system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff) end)
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
  -- The queue is the lines not yet paid, which the grace bounds, and never one per line paid in the past. A row the staff run holds is skipped (skip locked) and paid by whoever has it. A line that raises (only a transient failure gets here:
  -- pay_owed_line pays every other failure `unsaid` itself) is counted and sent behind the others (the attempts, a record and no cap), and is tried again on a later tick, so a run of transient failures never turns a line into an unsaid one.
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
      update lines_owed_open set failed_at = now(), attempts = attempts + 1 where owed = owed_late.owed;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n, 'owedPaid', owed_paid);
end $$;


-- apply_meeting (0445), taking `announcements` (a sticky thread for each announced beat the meeting plays), an aftermath beat of the predecessor as a bundle's beat, and the `recap`. Everything else as 0445 wrote it.
create or replace function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  bal2 numeric;
  cap numeric := (payload ->> 'bank_cap')::numeric;
  returned numeric := 0;
  spent integer;
  handed integer := 0;
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  inh jsonb;
  due record;
  kind_row move_kinds%rowtype;
  live timestamptz;
  kept integer := 0;
  ended_n integer := 0;
  skipped integer := 0;
  nominated boolean := false;
  act_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  kept_moves jsonb := '[]';
  rules_skipped jsonb := '[]';
  machine_skipped jsonb := '[]';
  lasting_skipped jsonb := '[]';
  mlive timestamptz;
  mhours numeric;
  problem text;
  idx integer := 0;
  ord jsonb;
  planned jsonb := '[]';
  most integer;
  who text;
  bs uuid[];
  b text;
  bid uuid;
  claimed uuid[] := '{}';
  asked numeric;
  amount integer;
  line text;
  mod_memory jsonb;
  orders_skipped integer := 0;
  clamped integer := 0;
  trimmed integer := 0;
  planned_mods text[] := '{}';
  prev staff_orders%rowtype;
  at_order integer;
  room integer;
  check_at timestamptz;
  pat jsonb;
  pat_at timestamptz;
  pat_most integer;
  pat_n integer := 0;
  pat_skipped integer := 0;
  -- The season the meeting was held in, which is not the open one when the season turned between the meeting and this apply: the beat's events and the kinds it holds back are that season's.
  season_id bigint := coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null));
  held text[] := held_back_kinds(boss, coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null)));
  beats_played text[] := '{}';
  held_skipped jsonb := '[]';
  bundles_skipped jsonb := '[]';
  bnd jsonb;
  bpart jsonb;
  bidx integer := 0;
  bundle_id uuid;
  authored boolean;
  parts_n integer;
  charged integer;
  queued_n integer := 0;
  authored_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleAuthoredMostParts'), 8);
  composed_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleMostParts'), 4);
  hf_farewell text := nullif(btrim(coalesce(payload ->> 'farewell', ''), E' \t\n\r\f\v'), '');
  hf_note text := nullif(btrim(coalesce(payload ->> 'handoff', ''), E' \t\n\r\f\v'), '');
  hf_post_most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  hf_trims jsonb := '[]';
  hf_skipped jsonb := '[]';
  pt jsonb;
  pt_line text;
  pt_n integer := 0;
  pt_skipped integer := 0;
  pt_trimmed integer := 0;
  rr jsonb := jsonb_build_object('spent', 0, 'rulings', '[]'::jsonb, 'skipped', '[]'::jsonb);
  -- The minutes (0439): the Boss's words on the meeting, posted as written; a blank one, or a value that is not text, is none.
  minutes_txt text := nullif(btrim(case when jsonb_typeof(payload -> 'minutes') = 'string' then payload ->> 'minutes' end, E' \t\n\r\f\v'), '');
  minutes_posted boolean := false;
  minutes_skipped text;
  minutes_trims jsonb := '[]';
  -- The recap (the arc announcements design, section 8): the outgoing Boss's in-character line on its season, at most 300 characters, kept like the farewell.
  hf_recap text := nullif(btrim(case when jsonb_typeof(payload -> 'recap') = 'string' then payload ->> 'recap' end, E' \t\n\r\f\v'), '');
  -- The announcements (the same design, sections 1 and 3): a beat the meeting plays by its bundle's entry is named here by its event key, with the arc_beat_events row it wrote.
  bkey text;
  played_play jsonb := '{}';
  ann jsonb;
  ann_key text;
  ann_beat text;
  ann_play bigint;
  ann_thread uuid;
  ann_act uuid;
  ann_title text;
  ann_body text;
  ann_pitch text;
  ann_push text;
  ann_repeatable boolean;
  ann_written jsonb := '[]';
  ann_skipped jsonb := '[]';
  ann_trims jsonb := '[]';
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || apply_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = apply_meeting.meeting) then
    raise exception 'there is no meeting %', apply_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = apply_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already applied', 'meeting', apply_meeting.meeting);
  end if;
  if boss is null or boss is distinct from current_boss() then
    raise exception 'a meeting is the open season''s Boss''s; % is not (%)', boss, current_boss() using errcode = '22023';
  end if;
  if hold is null then raise exception 'a meeting needs structuralHoldHours, which this instance does not set' using errcode = '22023'; end if;
  -- The Boss's bank lock, in the order apply_boss_move takes them (every open meeting's, then the bank's): a turn's debit is made under it, so a meeting that begins after the turn looked reads the bank the turn left, and a turn that
  -- begins after this one waits for it, never the balance written over by a read taken earlier.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.bank.' || boss, 0));
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;
  -- The one lock order, before the first write: a lasting move queued, or a lasting move ended by an inheritance decision, writes places, and the Acts this answer writes (a move_keep, a move_end) are rows an
  -- admin's reversal waits for after it holds the key.
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) i where jsonb_typeof(i.value) = 'object')
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'moves') = 'array' then payload -> 'moves' else '[]'::jsonb end) m
                join move_kinds k on k.key = m.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) b,
                     jsonb_array_elements(case when jsonb_typeof(b.value -> 'parts') = 'array' then b.value -> 'parts' else '[]'::jsonb end) p
                join move_kinds k on k.key = p.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'requests') = 'array' then payload -> 'requests' else '[]'::jsonb end) r
                join move_kinds k on k.key = r.value #>> '{move,kind}' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- The moves: a kind outside the catalog raises; a rule the queue would refuse is skipped and recorded, and costs nothing.
  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    idx := idx + 1;
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    -- A kind the Boss does not use yet (its persona holds it back until a beat unlocks, 0333) is skipped and recorded, and costs nothing: the engine drops it too, and the database holds the line.
    if kind_row.key = any (held) then
      held_skipped := held_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind_row.key));
      continue;
    end if;
    if kind_row.key = 'setRule' then
      problem := rule_params_problem(mv -> 'params');
      if problem is null then
        problem := rule_conflict(nullif(mv #>> '{params,board}', '')::uuid, mv #>> '{params,predicate}', nullif(mv #> '{params,param}', 'null'::jsonb));
      end if;
      if problem is not null then
        rules_skipped := rules_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- A machine move the queue's guard would refuse for its params, its demand or its bounds (the guard's own predicate, machine_move_problem without the machine as it is
    -- at landing) is skipped and recorded, and costs nothing: one bad machine move never fails the whole answer, as a bad rule does not.
    if kind_row.key in ('pullSlot', 'repriceSlot', 'flashSale') then
      problem := null;
      begin
        mlive := greatest((mv ->> 'go_live_at')::timestamptz, now());
        mhours := case when jsonb_typeof(mv -> 'expires_in_hours') = 'number' then (mv ->> 'expires_in_hours')::numeric end;
        problem := machine_move_problem(kind_row.key,
          case when jsonb_typeof(mv #> '{params,slot}') = 'string' then jsonb_set(mv -> 'params', '{slot}', to_jsonb(lower(mv #>> '{params,slot}'))) else mv -> 'params' end,
          mv -> 'demand', mlive, case when mhours is not null then mlive + mhours * interval '1 hour' end, false);
        if problem is null and mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then
          if not exists (select 1 from demand_kinds d where d.key = mv #>> '{demand,kind}') then problem := 'there is no such demand kind';
          else problem := demand_params_problem(mv -> 'demand'); end if;
        end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        machine_skipped := machine_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- The three lasting board moves the queue would refuse (what they name is not there, a board is closed, a merge would make a cycle, a demand a lasting move cannot carry) are skipped
    -- and recorded, and cost nothing, as a machine move is: one bad one never fails the whole answer.
    if kind_row.key in ('createBoard', 'moveThread', 'mergeBoard') then
      problem := null;
      begin
        if mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then problem := 'a lasting move carries no demand';
        else problem := lasting_move_problem(kind_row.key, mv -> 'params'); end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        lasting_skipped := lasting_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    kept_moves := kept_moves || jsonb_build_array(mv);
  end loop;
  spent := jsonb_array_length(kept_moves);

  -- The orders: validated into a plan, so nothing is written before the bank has agreed.
  if jsonb_typeof(payload -> 'orders') = 'array' and jsonb_array_length(payload -> 'orders') > 0 then
    most := (setting('modBots') ->> 'allowanceMost')::integer;
    if most is null then raise exception 'orders need the setting modBots, which this instance does not set' using errcode = '22023'; end if;
    for ord in select value from jsonb_array_elements(payload -> 'orders') loop
      who := ord ->> 'mod';
      if jsonb_typeof(ord) is distinct from 'object' or who is null or who = any (planned_mods) or not exists (select 1 from staff_now n where n.staff = who) then
        orders_skipped := orders_skipped + 1;
        continue;
      end if;
      bs := '{}';
      for b in select t.v from jsonb_array_elements_text(case when jsonb_typeof(ord -> 'boards') = 'array' then ord -> 'boards' else '[]'::jsonb end) with ordinality t(v, n) order by t.n loop
        if b ~* uuid_re then
          bid := lower(b)::uuid;
          if exists (select 1 from boards x where x.id = bid and not x.is_system) and bid <> all (claimed) and bid <> all (bs) then bs := bs || bid; end if;
        end if;
      end loop;
      claimed := claimed || bs;
      asked := case when jsonb_typeof(ord -> 'allowance') = 'number' then floor((ord ->> 'allowance')::numeric) else 0 end;
      amount := greatest(0, least(asked, most));
      if amount is distinct from asked then clamped := clamped + 1; end if;
      line := left(btrim(coalesce(ord ->> 'order', ''), E' \t\n\r\f\v'), 200);
      -- A blank line is no instruction: the Mod keeps the one it had.
      if line = '' then line := coalesce((select x.order_line from staff_orders x where x.staff = who order by x.id desc limit 1), ''); end if;
      mod_memory := case when jsonb_typeof(ord -> 'memory') = 'object' then jsonb_set(jsonb_set(ord -> 'memory', '{opinions}', public_entries(ord #> '{memory,opinions}')), '{grudges}', public_entries(ord #> '{memory,grudges}')) end;
      planned := planned || jsonb_build_array(jsonb_build_object('mod', who, 'boards', to_jsonb(bs), 'order', line, 'allowance', amount, 'memory', mod_memory));
      planned_mods := planned_mods || who;
      handed := handed + amount;
    end loop;
  end if;

  -- What the Mods did not spend goes back, never above the cap: one lock per persona with an order, in key order, so a Mod's move queued at the same
  -- moment is either counted here or counted against the new order, never both and never neither.
  for who in select distinct o.staff from staff_orders o order by o.staff loop
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || who, 0));
    returned := returned + order_unspent(who);
  end loop;
  -- What was added is what the cap allowed, and that is what is recorded.
  bal2 := least(cap, bal + returned);
  returned := greatest(0, bal2 - bal);
  -- The Boss's own moves are its own: they must be paid, else this raises, as it always has. The allowances are what is left. A Mod that queued between the
  -- meeting's read and this apply spent some of what the answer counted on; the answer is not failed for it: the allowances are trimmed from the last
  -- order backward to the bank, and the trims are recorded.
  -- The bundles (fangame split design, sections 2, 5 and 9), each all or nothing: its parts are queued under one bundle id and one name, in the order sent (a role names an earlier part), and a
  -- beat's bundle writes `played` with it. An authored bundle (it names a beat of this Boss's that is unlocked and unplayed) costs the bank nothing; a bundle of the Boss's own costs one move a part
  -- and holds at most bundleMostParts, none of a kind held back. A beat with no bundle has no parts and is played by being named. A bundle the queue would refuse (the guard raises), a beat
  -- that is not unlocked and a bank that cannot pay are each skipped and recorded, with the reason: one bad bundle never fails the whole answer. The guard still holds every part.
  for bnd in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) loop
    bidx := bidx + 1;
    begin
      if jsonb_typeof(bnd) is distinct from 'object' or jsonb_typeof(bnd -> 'parts') is distinct from 'array' then
        raise exception 'a bundle is {name, beat, parts}' using errcode = '22023';
      end if;
      authored := jsonb_typeof(bnd -> 'beat') = 'string';
      parts_n := jsonb_array_length(bnd -> 'parts');
      if authored then
        -- The Boss's own beat, or an aftermath beat of the predecessor that seated it (by its plain key or after:<predecessor>:<key>), recorded under its event key.
        bkey := arc_beat_key(boss, season_id, bnd ->> 'beat');
        if bkey is null then
          raise exception 'the beat "%" is not this Boss''s', bnd ->> 'beat' using errcode = '22023';
        end if;
        if arc_latest_states(boss, season_id) ->> bkey is distinct from 'unlocked' then
          raise exception 'the beat "%" is not unlocked, or has been played', bnd ->> 'beat' using errcode = '22023';
        end if;
        if parts_n > authored_most then raise exception 'an authored bundle holds at most % parts', authored_most using errcode = '22023'; end if;
        charged := 0;
      else
        if parts_n < 1 then raise exception 'a bundle of the Boss''s own has at least one part' using errcode = '22023'; end if;
        if parts_n > composed_most then raise exception 'a bundle of the Boss''s own holds at most % parts', composed_most using errcode = '22023'; end if;
        if spent + parts_n > floor(bal2) then raise exception 'the bank cannot pay for % parts', parts_n using errcode = '23514'; end if;
        charged := parts_n;
      end if;
      if parts_n > 0 and btrim(coalesce(bnd ->> 'name', '')) = '' then raise exception 'a bundle has a name' using errcode = '22023'; end if;
      bundle_id := case when parts_n > 0 then gen_random_uuid() end;
      for bpart in select value from jsonb_array_elements(bnd -> 'parts') loop
        select * into kind_row from move_kinds k where k.key = bpart ->> 'kind';
        if not found then raise exception 'there is no move kind "%"', bpart ->> 'kind' using errcode = '23514'; end if;
        if not authored and kind_row.key = any (held) then raise exception 'the kind % is held back', kind_row.key using errcode = '23514'; end if;
        live := greatest((bpart ->> 'go_live_at')::timestamptz, now());
        if kind_row.structural then live := greatest(live, now() + hold); end if;
        insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
        values (apply_meeting.meeting, boss, kind_row.key, bpart -> 'params', bpart -> 'demand', bpart ->> 'why', live,
          live + coalesce((bpart ->> 'expires_in_hours')::numeric, 0) * interval '1 hour', kind_row.structural, bundle_id, left(bnd ->> 'name', 120), nullif(bpart ->> 'role', ''));
      end loop;
      if authored then
        insert into arc_beat_events (season, staff, beat, event, bundle) values (season_id, boss, bkey, 'played', bundle_id) returning id into ann_play;
        played_play := played_play || jsonb_build_object(bkey, ann_play);
        beats_played := beats_played || (bnd ->> 'beat');
      end if;
      spent := spent + charged;
      queued_n := queued_n + parts_n;
    exception when others then
      bundles_skipped := bundles_skipped || jsonb_build_array(jsonb_build_object('index', bidx - 1, 'name', bnd ->> 'name', 'why', left(sqlerrm, 300)));
    end;
  end loop;

  -- The announcements (arc_announcements, above): for a beat this meeting played, a staff thread opened by the Boss, its post at seq 1, the pin and the row, together in one sub-block, so a failure leaves none of them and
  -- never fails the answer. A beat the meeting did not play (no bundle entry names it, or its bundle was refused above, which writes no `played` event) is skipped with the beat named. A pitch and a push over their bounds
  -- are cut and the trim recorded. An applied meeting returned at the top, so a repeat writes nothing; a play has one announcement (the table's unique index) besides.
  for ann in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'announcements') = 'array' then payload -> 'announcements' else '[]'::jsonb end) loop
    ann_beat := case when jsonb_typeof(ann) = 'object' and jsonb_typeof(ann -> 'beat') = 'string' then ann ->> 'beat' end;
    begin
      if ann_beat is null then raise exception 'an announcement is {beat, title, body, pitch, push}' using errcode = '22023'; end if;
      ann_key := arc_beat_key(boss, season_id, ann_beat);
      if ann_key is null or not (played_play ? ann_key) then
        raise exception 'the beat "%" is not played in this meeting', ann_beat using errcode = '22023';
      end if;
      ann_play := (played_play ->> ann_key)::bigint;
      ann_title := btrim(case when jsonb_typeof(ann -> 'title') = 'string' then ann ->> 'title' else '' end, E' \t\n\r\f\v');
      ann_body := btrim(case when jsonb_typeof(ann -> 'body') = 'string' then ann ->> 'body' else '' end, E' \t\n\r\f\v');
      ann_pitch := btrim(case when jsonb_typeof(ann -> 'pitch') = 'string' then ann ->> 'pitch' else '' end, E' \t\n\r\f\v');
      ann_push := btrim(case when jsonb_typeof(ann -> 'push') = 'string' then ann ->> 'push' else '' end, E' \t\n\r\f\v');
      if ann_body = '' then raise exception 'an announcement has a body' using errcode = '22023'; end if;
      if hf_post_most is not null and char_length(ann_body) > hf_post_most then
        ann_trims := ann_trims || jsonb_build_array(jsonb_build_object('path', 'announcements.' || ann_key || '.body', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(ann_body), 'after', hf_post_most));
        ann_body := left(ann_body, hf_post_most);
      end if;
      if char_length(ann_pitch) > 200 then
        ann_trims := ann_trims || jsonb_build_array(jsonb_build_object('path', 'announcements.' || ann_key || '.pitch', 'predicate', 'maxLength(200)', 'before', char_length(ann_pitch), 'after', 200));
        ann_pitch := left(ann_pitch, 200);
      end if;
      if char_length(ann_push) > 300 then
        ann_trims := ann_trims || jsonb_build_array(jsonb_build_object('path', 'announcements.' || ann_key || '.push', 'predicate', 'maxLength(300)', 'before', char_length(ann_push), 'after', 300));
        ann_push := left(ann_push, 300);
      end if;
      select coalesce((b.value ->> 'repeatable')::boolean, false) into ann_repeatable from persona_arcs a, jsonb_array_elements(a.beats) b where a.staff = boss and b.value ->> 'key' = ann_key;
      ann_thread := open_staff_thread(boss, ann_title);
      ann_act := (write_staff_act(boss, 'post', ann_thread, null, jsonb_build_object('body', ann_body)) ->> 'id')::uuid;
      insert into staff_pin_events (thread, season, event) values (ann_thread, season_id, 'pinned');
      insert into arc_announcements (season, staff, beat, thread, act, title, pitch, push, play, repeatable)
      values (season_id, boss, ann_key, ann_thread, ann_act, (select t.title from threads t where t.id = ann_thread), ann_pitch, ann_push, ann_play, coalesce(ann_repeatable, false));
      ann_written := ann_written || jsonb_build_array(jsonb_build_object('beat', ann_key, 'thread', ann_thread));
    exception when others then
      ann_skipped := ann_skipped || jsonb_build_array(jsonb_build_object('beat', ann_beat, 'why', left(sqlerrm, 300)));
    end;
  end loop;

  if spent > floor(bal2) then
    raise exception 'the moves cost % and the bank holds %', spent, bal2 using errcode = '23514';
  end if;
  -- The requests the answer ruled on (the staff requests design, section 3): paid from what the bank can still pay after the Boss's own moves and its bundle, before the allowances (the engine counts them in the same order), and
  -- each a row of its own with the Boss's move queued under this meeting. requests_ruled never touches move_bank: what it spent is charged with the rest, in the one write of the balance below.
  if jsonb_typeof(payload -> 'requests') = 'array' then
    rr := requests_ruled(apply_meeting.meeting, payload -> 'requests', floor(bal2)::integer - spent);
    spent := spent + (rr ->> 'spent')::integer;
  end if;
  room := floor(bal2)::integer - spent;
  at_order := jsonb_array_length(planned);
  while handed > room and at_order > 0 loop
    amount := (planned -> (at_order - 1) ->> 'allowance')::integer;
    if amount > 0 then
      asked := least(amount, handed - room);
      planned := jsonb_set(planned, array[(at_order - 1)::text, 'allowance'], to_jsonb(amount - asked::integer));
      handed := handed - asked::integer;
      trimmed := trimmed + 1;
    end if;
    at_order := at_order - 1;
  end loop;

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent. The
  -- memory is written only when it came.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
    insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  end if;
  if jsonb_typeof(payload -> 'profile') = 'object' then
    insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
    values (boss, apply_meeting.meeting,
      array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
      array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
        where f.id in (select c.id from characters_public c) order by f.ord),
      coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));
  end if;

  for mv in select value from jsonb_array_elements(kept_moves) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    -- A favor's check must fall between its go-live and its expiry as the queue lands them; the answer set it from the meeting's clock, so one that no longer does is
    -- moved to half the favor's life from its go-live.
    if kind_row.key = 'conferGroup' and mv #> '{params,checkAt}' is not null then
      begin
        check_at := (mv #>> '{params,checkAt}')::timestamptz;
      exception when others then
        check_at := null;
      end;
      if check_at is null or check_at <= live or check_at >= live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour') then
        mv := jsonb_set(mv, '{params,checkAt}', to_jsonb(to_char((live + ((mv ->> 'expires_in_hours')::numeric * interval '30 minutes')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      end if;
    end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, line)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural, left(nullif(btrim(mv ->> 'line', E' \t\n\r\f\v'), ''), 280));
  end loop;

  -- The successor: queued beside the moves, not among them, and not charged to the bank.
  if jsonb_typeof(payload -> 'successor') = 'object' then
    select * into kind_row from move_kinds k where k.key = 'nameSuccessor';
    if found and jsonb_typeof(payload #> '{successor,boss}') = 'string' and (payload #>> '{successor,boss}') = any (boss_roster()) and (payload #>> '{successor,boss}') <> boss then
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
      values (apply_meeting.meeting, boss, 'nameSuccessor', jsonb_build_object('boss', payload #>> '{successor,boss}'), null,
        left(coalesce(nullif(payload #>> '{successor,why}', ''), 'No reason given.'), 200), now() + hold, null, kind_row.structural);
      nominated := true;
    else
      skipped := skipped + 1;
    end if;
  end if;

  -- The inheritance review: what the answer names must be among the moves due now; the rest is dropped. Each is answered at most once.
  for inh in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) loop
    act_id := case when (inh ->> 'move_act') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (inh ->> 'move_act')::uuid end;
    select * into due from inheritance_due(boss, 100) d where d.act = act_id;
    -- An answer with no decision (null in the test) is no decision: skipped, never read as "end".
    if act_id is null or not found or not coalesce((inh ->> 'decision') in ('keep', 'end'), false) then
      skipped := skipped + 1;
    elsif inh ->> 'decision' = 'keep' then
      perform write_staff_act(boss, 'move_keep', due.thread, due.act, '{}'::jsonb);
      kept := kept + 1;
    elsif inh ->> 'decision' = 'end' then
      if (end_move(due.act, 'superseded', 'boss') ->> 'ended')::boolean then perform say_move_end(due.act, 'superseded'); ended_n := ended_n + 1; end if;
    end if;
  end loop;

  -- The farewell and the handoff (0337), kept only from a meeting within farewellWindowHours of the season's end: the engine's repair already dropped them from any other, and the database holds
  -- the same line. Each is trimmed to its bound (the farewell to postMaxLength, the note to 2000) and the trim is recorded, never a lost answer. A blank one is none; a meeting that gives neither
  -- writes no row, so an earlier meeting's words are not displaced by silence. A new row is the latest of its season, and the ones before it stay.
  if hf_farewell is not null or hf_note is not null or hf_recap is not null then
    if not in_farewell_window() then
      hf_skipped := jsonb_build_array(jsonb_build_object('why', 'inFarewellWindow'));
    else
      if hf_farewell is not null and hf_post_most is not null and char_length(hf_farewell) > hf_post_most then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'farewell', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(hf_farewell), 'after', hf_post_most));
        hf_farewell := left(hf_farewell, hf_post_most);
      end if;
      if hf_note is not null and char_length(hf_note) > 2000 then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'handoff', 'predicate', 'maxLength(2000)', 'before', char_length(hf_note), 'after', 2000));
        hf_note := left(hf_note, 2000);
      end if;
      if hf_recap is not null and char_length(hf_recap) > 300 then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'recap', 'predicate', 'maxLength(300)', 'before', char_length(hf_recap), 'after', 300));
        hf_recap := left(hf_recap, 300);
      end if;
      -- What this meeting leaves out stands as the latest row had it: a later meeting that writes only a note does not take the farewell back, nor one that writes only a farewell the note; the recap stands likewise.
      insert into handoffs (season, staff, meeting, farewell, note, recap)
      select season_id, boss, apply_meeting.meeting, coalesce(hf_farewell, x.farewell), coalesce(hf_note, x.note, ''), coalesce(hf_recap, x.recap)
      from (select 1) one left join handoffs_latest x on x.season = season_id and x.staff = boss;
    end if;
  end if;

  -- An answer that left a persona with an order out carries it forward only while the persona is on staff (staff_now: an order ends with the office, the
  -- excerpts-and-orders design, section 2): its beat (less what another order claimed) and its line, with an allowance of 0, because what it had was returned above.
  -- A persona off staff (a Boss, or a Mod moved off) is carried nothing: if its latest row still holds a line, a beat or an allowance, one blank row with 0 ends it (the allowance is
  -- returned above once, and a Mod that comes back has no order until a meeting gives it one), and once the latest row is blank no row is written. After this meeting every
  -- persona on staff with an order has its latest from it.
  for ord in select value from jsonb_array_elements(planned) loop
    insert into staff_orders (meeting, staff, boards, order_line, allowance)
    values (apply_meeting.meeting, ord ->> 'mod', array(select jsonb_array_elements_text(ord -> 'boards'))::uuid[], ord ->> 'order', (ord ->> 'allowance')::integer);
    if jsonb_typeof(ord -> 'memory') = 'object' then
      insert into staff_memory (staff, meeting, body) values (ord ->> 'mod', apply_meeting.meeting, ord -> 'memory');
    end if;
  end loop;
  for who in
    select distinct o.staff from staff_orders o
    where o.meeting <> apply_meeting.meeting and o.staff <> all (planned_mods) order by o.staff
  loop
    select * into prev from staff_orders o where o.staff = who and o.meeting <> apply_meeting.meeting order by o.id desc limit 1;
    if exists (select 1 from staff_now n where n.staff = who) then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, array(select x from unnest(prev.boards) x where x <> all (claimed)), prev.order_line, 0);
    elsif prev.order_line <> '' or prev.allowance > 0 or prev.boards <> '{}' then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, '{}', '', 0);
    end if;
  end loop;

  -- The patrols the answer scheduled, kept on the meeting record by meet/core.ts (its repair already dropped a Mod off staff, moved a time into today and cut them to
  -- patrolsPerDay); the database holds the same line whatever the caller sent. Written once with the meeting: a retry finds the meeting closed above, and (meeting, n) is
  -- unique besides.
  pat_most := coalesce((select (s.value ->> 'patrolsPerDay')::integer from settings s where s.key = 'modBots'), 0);
  if jsonb_typeof(payload #> '{record,patrols}') = 'array' then
    for pat in select value from jsonb_array_elements(payload #> '{record,patrols}') loop
      if pat_n >= pat_most then pat_skipped := pat_skipped + 1; continue; end if;
      pat_at := null;
      begin
        pat_at := (pat ->> 'at')::timestamptz;
      exception when others then pat_at := null;
      end;
      if jsonb_typeof(pat) is distinct from 'object' or pat_at is null or jsonb_typeof(pat -> 'mod') is distinct from 'string'
         or not exists (select 1 from staff_now n where n.staff = pat ->> 'mod') then
        pat_skipped := pat_skipped + 1;
        continue;
      end if;
      pat_n := pat_n + 1;
      insert into patrols (meeting, n, staff, at)
      values (apply_meeting.meeting, pat_n, pat ->> 'mod', least(greatest(pat_at, now()), now() + interval '24 hours'))
      on conflict on constraint patrols_meeting_n_key do nothing;
    end loop;
  end if;

  -- The talking points the answer wrote (meet/core.ts repaired them: a persona that posts, once each, a line cut at a word to 200 characters, a blank one dropped); the database holds the same line whatever the caller sent. A key
  -- that is not a persona in a posting office (the Boss, a Mod or a member: not benched, not waiting), a second line for one key, a blank line and anything that is not an object are skipped and counted; a line over 200
  -- characters is cut and counted. They are written with the orders in this transaction, once: a retry finds the meeting closed above, and (meeting, staff) is unique besides.
  if jsonb_typeof(payload -> 'points') = 'array' then
    for pt in select value from jsonb_array_elements(payload -> 'points') loop
      pt_line := case when jsonb_typeof(pt) = 'object' and jsonb_typeof(pt -> 'line') = 'string' then nullif(btrim(pt ->> 'line', E' \t\n\r\f\v'), '') end;
      if pt_line is null or jsonb_typeof(pt -> 'staff') is distinct from 'string'
         or not exists (select 1 from staff_office_now o where o.staff = pt ->> 'staff' and o.office in ('boss', 'mod', 'member')) then
        pt_skipped := pt_skipped + 1;
        continue;
      end if;
      if char_length(pt_line) > 200 then pt_line := left(pt_line, 200); pt_trimmed := pt_trimmed + 1; end if;
      insert into staff_points (meeting, staff, line) values (apply_meeting.meeting, pt ->> 'staff', pt_line) on conflict on constraint staff_points_meeting_staff_key do nothing;
      if found then pt_n := pt_n + 1; else pt_skipped := pt_skipped + 1; end if;
    end loop;
  end if;

  -- The minutes, after the moves are queued: the Boss's post in the season's Staff Meetings thread, within postMaxLength (the engine already trimmed them to its own bound). An applied meeting returned above, so a retry never posts them again.
  if minutes_txt is not null then
    if hf_post_most is not null and char_length(minutes_txt) > hf_post_most then
      minutes_trims := jsonb_build_array(jsonb_build_object('path', 'minutes', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(minutes_txt), 'after', hf_post_most));
      minutes_txt := left(minutes_txt, hf_post_most);
    end if;
    -- The minutes are words that decide nothing: a thread the instance has no word for, a benched Boss or a Boss locked out of the thread must not fail a meeting whose paid answer is
    -- being applied. The sub-block rolls back its own thread insert and season update, and the record says why (as `bundlesSkipped` does).
    begin
      perform write_staff_act(boss, 'post', meetings_thread(season_id), null, jsonb_build_object('body', minutes_txt));
      minutes_posted := true;
    exception when others then
      minutes_skipped := left(sqlerrm, 300);
    end;
  end if;

  insert into move_bank (staff, balance, as_of) values (boss, bal2 - spent - handed, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal2 - spent - handed,
    coalesce(payload -> 'record', '{}') || jsonb_build_object(
      'handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated),
      'allowances', jsonb_build_object('returned', returned, 'handed', handed, 'orders', jsonb_array_length(planned), 'skipped', orders_skipped, 'clamped', clamped, 'trimmed', trimmed),
      'rulesSkipped', rules_skipped,
      'machineSkipped', machine_skipped,
      'lastingSkipped', lasting_skipped,
      -- What was actually played (0335): the engine's `beatsDefaulted` and its `playedWithDefaults` trims say what it meant to play, and are kept only for the beats this transaction played.
      'beatsPlayed', to_jsonb(beats_played),
      'beatsDefaulted', coalesce((select jsonb_agg(d.k) from jsonb_array_elements_text(case when jsonb_typeof(payload #> '{record,beatsDefaulted}') = 'array' then payload #> '{record,beatsDefaulted}' else '[]'::jsonb end) d(k) where d.k = any (beats_played)), '[]'::jsonb),
      'trims', coalesce((select jsonb_agg(x.t order by x.n) from jsonb_array_elements(case when jsonb_typeof(payload #> '{record,trims}') = 'array' then payload #> '{record,trims}' else '[]'::jsonb end) with ordinality x(t, n)
                         where not (x.t ->> 'predicate' = 'playedWithDefaults' and not ((regexp_replace(coalesce(x.t ->> 'path', ''), '^beats\.', '')) = any (beats_played)))), '[]'::jsonb),
      'heldBackSkipped', held_skipped,
      'bundlesSkipped', bundles_skipped,
      'handoffTrims', hf_trims,
      'handoffSkipped', hf_skipped,
      'announcementsWritten', ann_written,
      'announcementsSkipped', ann_skipped,
      'announcementsTrims', ann_trims,
      'minutesTrims', minutes_trims,
      'minutesPosted', minutes_posted,
      'minutesSkipped', to_jsonb(minutes_skipped),
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped),
      'pointsWritten', jsonb_build_object('written', pt_n, 'skipped', pt_skipped, 'trimmed', pt_trimmed),
      'requestsRuled', jsonb_build_object('ruled', jsonb_array_length(rr -> 'rulings'), 'spent', rr -> 'spent', 'skipped', rr -> 'skipped')));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', jsonb_array_length(kept_moves) + queued_n, 'beats_played', to_jsonb(beats_played), 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed, 'requests', rr -> 'rulings');
end $$;



-- =========================================================================================== part 2 ====

-- ----------------------------------------------------------------------------------- the plot so far ----

-- The plot so far, for a staff persona's pool call and the Boss's meeting: {last, initiatives}. It is the season's, the same for every reader (in_staff, the reader, is not read: the engine compares its own key with
-- `last.boss` and each initiative's `boss` for the second-person reading of the design's section 8a).
--   last         {boss, name, recap, facts} for the sitting Boss's honeymoon (arc_season_span's length: its persona's own days where it sets them, else the instance's) counted from the handover that seated it
--                (the season_handovers row arc_predecessor reads), else null. boss is the outgoing Boss's staff key and name its character's; recap is the outgoing Boss's latest for the season it served
--                (handoffs_latest), null where none; facts is handoff_facts of that season, given only where there is no recap: it is what the engine's fallback line is built from, and nothing reads it otherwise.
--   initiatives  the open season's announcements, oldest first, a departed Boss's among them, at most the latest 12. A file holds up to 24 beats (ARC_BEATS_MOST) and a Boss that announces every one would
--                put 24 x about 350 characters in every pool call all season; 12 is about 4,000 characters, and an older initiative scrolls out of the plot as it does out of the board's sight.
create function arc_plot(in_staff text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sn bigint := (select x.id from seasons x where x.ends_at is null);
  sitting text := current_boss();
  pred record;
  seated timestamptz;
  span record;
  recap text;
  last_season jsonb;
begin
  if sn is null then return jsonb_build_object('last', null, 'initiatives', '[]'::jsonb); end if;
  -- An instance with no `phases` setting has no honeymoon to count (arc_season_span would refuse it), so it has no last season either.
  if sitting is not null and exists (select 1 from settings g where g.key = 'phases') then
    select * into pred from arc_predecessor(sitting, sn) p;
    if found then
      select h.at into seated from season_handovers h
      where h.boss = sitting and h.outgoing = pred.staff and h.season = pred.seated and h.how in ('nomination', 'rotation') order by h.id desc limit 1;
      select * into span from arc_season_span(sitting, sn);
      if seated is not null and found and now() < seated + (span.honeymoon_ends - span.starts_at) then
        select nullif(btrim(x.recap), '') into recap from handoffs_latest x where x.season = pred.season and x.staff = pred.staff;
        last_season := jsonb_build_object('boss', pred.staff, 'name', (select c.name from characters c where c.staff = pred.staff), 'recap', recap,
          'facts', case when recap is null then handoff_facts(pred.season) end);
      end if;
    end if;
  end if;
  return jsonb_build_object('last', last_season,
    'initiatives', coalesce((select jsonb_agg(jsonb_build_object('beat', z.beat, 'title', z.title, 'pitch', z.pitch, 'thread', z.thread, 'boss', z.staff) order by z.at, z.id)
      from (select a.* from arc_announcements a where a.season = sn order by a.at desc, a.id desc limit 12) z), '[]'::jsonb));
end $$;
revoke execute on function arc_plot(text) from public, anon, authenticated;
grant execute on function arc_plot(text) to service_role;

-- ------------------------------------------------------------------------------------- the stickies ----

-- board_page runs as its caller and reads the stickies of the board it shows: a signed-in read of staff threads, the same for every caller (it is in tools/check-web-reads.mjs's SCREEN_HELPERS, never called by the web).
revoke execute on function staff_stickies(uuid) from public, anon;
grant execute on function staff_stickies(uuid) to authenticated, service_role;

-- The Machine screen's list for an admin: every live staff pin of the open season on any board (staff_stickies' predicate), oldest pin first, each with its thread's title.
create function admin_staff_pins() returns table (thread uuid, title text, pinned_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the pinned staff threads');
  return query
  select p.thread, t.title, p.at
  from staff_pin_events p join threads t on t.id = p.thread
  where p.season = (select x.id from seasons x where x.ends_at is null) and p.event = 'pinned'
    and not exists (select 1 from staff_pin_events q where q.season = p.season and q.thread = p.thread and q.id > p.id)
  order by p.at, p.id;
end $$;
revoke execute on function admin_staff_pins() from public, anon;
grant execute on function admin_staff_pins() to authenticated;

-- ---------------------------------------------------------------------------------- the reads ----

-- pool_record (0415) with `plot` for every persona and, for the sitting Boss alone, `push` and `leadIns`. Everything else as 0415 wrote it.
create or replace function pool_record(in_thread uuid, staff_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with since as (
    select coalesce((select m.slot from meetings m where m.outcome = 'ok' order by m.slot desc limit 1), now() - interval '1 day') as at
  ),
  lines as (
    select a.id as act, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, 'landed'::text as state, a.created_at as at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act, since s where a.created_at >= s.at
    union all
    select a.id, a.payload ->> 'kind', a.payload -> 'params', 'ended', e.created_at, e.payload ->> 'why'
    from acts_public e join acts_public a on a.id = e.target_act_id, since s where e.kind = 'move_end' and e.created_at >= s.at
  ),
  newest as (select l.* from lines l order by l.at desc, l.act limit 10)
  select jsonb_build_object(
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', n.act, 'kind', n.kind, 'params', n.params, 'state', n.state, 'at', n.at, 'why', n.why) order by n.at desc, n.act) from newest n), '[]'::jsonb),
    'rules', rules_in_force((select t.board from threads t where t.id = in_thread)),
    'order', mod_standing(staff_key) -> 'order',
    -- The plot so far (0447), the same for every persona; the Boss alone is also given the push of what it announced this season and the lead-ins that are live for it.
    'plot', arc_plot(staff_key))
    || case when staff_key is not distinct from current_boss() then jsonb_build_object(
      'push', coalesce((select jsonb_agg(z.push order by z.at, z.id)
                        from (select a.push, a.at, a.id from arc_announcements a
                              where a.season = (select x.id from seasons x where x.ends_at is null) and a.staff = staff_key and a.push <> ''
                              order by a.at desc, a.id desc limit 12) z), '[]'::jsonb),
      'leadIns', to_jsonb(arc_lead_ins(staff_key, (select x.id from seasons x where x.ends_at is null))))
    else '{}'::jsonb end
$$;

-- meeting_context (0404) with `plot` and `leadIns`. Everything else as 0404 wrote it.
create or replace function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    -- The Boss's arc (0334): the beats unlocked and not yet played, each with whether it is due, and the kinds still held back. Never a locked beat, a brief or a template.
    'arc', arc_for_meeting(current_boss(), (select x.id from seasons x where x.ends_at is null)),
    -- The plot so far (0447) and the lead-ins live for the Boss (the keys arc_for_meeting lists under `arc` as well; the Edge Function maps them to the briefs the Boss reads).
    'plot', arc_plot(current_boss()),
    'leadIns', to_jsonb(arc_lead_ins(current_boss(), (select x.id from seasons x where x.ends_at is null))),
    -- The farewell and the handoff (0337, above): a meeting within farewellWindowHours of the season's end is shown what the code knows of the season (`handoffFacts`), to write its handoff from;
    -- the new Boss is handed its predecessor's facts and note (`predecessor`) for inheritanceGraceDays after the handover. Both are null otherwise.
    'handoffFacts', case when in_farewell_window() then handoff_facts((select x.id from seasons x where x.ends_at is null)) end,
    'predecessor', predecessor_handoff(),
    -- The Boss's standing nomination (the rehearsal patch design, section 5): its latest nameSuccessor, waiting or landed and not ended, that no admin held or refused.
    'nomination', (select jsonb_build_object('boss', q.params ->> 'boss', 'at', (extract(epoch from m.started_at) * 1000)::bigint)
      from queued_moves q join meetings m on m.id = q.meeting
      where q.kind = 'nameSuccessor' and q.staff = current_boss() and q.held_at is null and q.refused_at is null
        and (q.landed_act is null or not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = q.landed_act))
      order by q.id desc limit 1),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system and not n.closed order by n.name, n.id limit 50) b), '[]'),
    'successors', to_jsonb(array(select r from unnest(boss_roster()) with ordinality x(r, ord) where r is distinct from current_boss() order by x.ord)),
    'inheritanceDue', coalesce((select jsonb_agg(jsonb_build_object('act', d.act, 'kind', d.payload ->> 'kind', 'params', d.payload -> 'params',
        'landedAt', d.landed_at, 'expiresAt', d.payload -> 'expires_at', 'by', d.author, 'boardName', d.board_name) order by d.landed_at, d.act)
      from inheritance_due(current_boss(), 20) d), '[]'),
    -- The Mods on staff: what the Boss's meeting needs to order each (its latest order, the allowance it has not spent, and so what returns to the bank).
    'mods', coalesce((select jsonb_agg(jsonb_build_object('key', n.staff, 'since', n.since, 'allowance', order_unspent(n.staff), 'granted', o.allowance,
        'boards', coalesce(to_jsonb(o.boards), '[]'::jsonb), 'order', o.order_line) order by n.staff)
      from staff_now n left join lateral (select x.allowance, x.boards, x.order_line from staff_orders x where x.staff = n.staff order by x.id desc limit 1) o on true), '[]'),
    -- The rules in force, so the meeting drops a rule that would leave no compliant post before the queue would refuse it.
    'rules', coalesce((select jsonb_agg(jsonb_build_object('board', r.board, 'predicate', r.predicate, 'param', r.param, 'number', r.number) order by r.board nulls last, r.number)
      from rules_now r), '[]'),
    -- The groups (member groups design, section 5): the catalog a move may confer, and the characters the meeting may not choose. A character is held while a group move is
    -- in force on it or queued and not held (the guard's one-at-a-time rule), and capped while staff_punishments is at the cap; each is listed with the group it is in now.
    -- Only those two kinds are listed, which a busy instance keeps to a handful; every other character is in its earned group and free to be chosen.
    'groups', jsonb_build_object(
      'conferred', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'tone', g.tone) order by g.tone desc, g.key) from group_kinds g where g.source = 'conferred'), '[]'),
      'characters', group_move_bars()),
    -- The machine, so the Boss can name a slot: the admins' own word on each (hidden ones too, for a flash sale), whether a pull of it could land, and the Boss's move
    -- in force on it. Slots and moves only: no purchase, no buyer, nothing computed from who owns what.
    'machine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'availability', s.availability, 'price', s.price,
        'pullable', s.card is not null and s.availability = 'onSale' and card_in_open_pack(s.card),
        'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act) from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1)) order by s.position)
      from (select x.* from machine_slots x where slot_in_print(x.id) order by x.position limit 60) s), '[]'))
$$;

-- board_page (0368) with `stickies`: page 1's staff pins of the board, each as thread_list gives it, in staff_stickies' order. Their characters, reads and views are in the page's lists. Everything else as 0368 wrote it.
create or replace function public.board_page(in_slug text, in_page integer, effect_cards text[])
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  WITH b AS (
          SELECT x.id,
             x.slug,
             x.name,
             x.description,
             x.is_system,
             x.move_act,
             x.closed
            FROM boards_now x
           WHERE ((x.slug = board_page.in_slug) OR ((x.id)::text = board_page.in_slug))
           ORDER BY (x.slug = board_page.in_slug) DESC
          LIMIT 1
         ), p AS (
          SELECT b_1.id AS board,
             c.total,
             LEAST(GREATEST(COALESCE(board_page.in_page, 1), 1), GREATEST(1, (ceil(((c.total)::numeric / 20.0)))::integer)) AS page
            FROM (b b_1
              CROSS JOIN LATERAL ( SELECT COALESCE(( SELECT n.threads
                            FROM board_counts n
                           WHERE (n.board = b_1.id)), 0) AS total) c)
           WHERE (NOT b_1.closed)
         ), went AS (
          SELECT board_closed_to(b_1.id) AS to_board
            FROM b b_1
           WHERE b_1.closed
         ), listed AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place
            FROM thread_list l
           WHERE (l.board = ( SELECT p_1.board
                    FROM p p_1))
           ORDER BY l.last_at DESC
          OFFSET ( SELECT ((p_1.page - 1) * 20)
                    FROM p p_1)
          LIMIT 20
         ), stickies AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             s.ord
            FROM (p p_1
              CROSS JOIN LATERAL staff_stickies(p_1.board) WITH ORDINALITY s(thread, pinned_at, ord))
              JOIN thread_list l ON (l.id = s.thread)
           WHERE (p_1.page = 1)
         ), pins AS MATERIALIZED (
          SELECT x.thread,
             x.play,
             x.ends_at,
             x.act
            FROM (p p_1
              CROSS JOIN LATERAL pinned_threads(p_1.board) x(thread, play, ends_at, act))
           WHERE (p_1.page = 1)
         ), banner AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM (p p_1
              CROSS JOIN LATERAL effects_above('{}'::uuid[], NULL::uuid, p_1.board) x(play, reach, target, ends_at, act))
         ), marked AS MATERIALIZED (
          SELECT ((m.act ->> 'id'::text))::uuid AS id,
             (m.act ->> 'character'::text) AS "character",
             (m.act #>> '{payload,card}'::text[]) AS card
            FROM ( SELECT pins.act
                    FROM pins
                 UNION ALL
                  SELECT banner.act
                    FROM banner) m
         ), wanted AS (
          SELECT m.id
            FROM marked m
           WHERE (m.card = ANY (COALESCE(board_page.effect_cards, '{}'::text[])))
         ), threads AS MATERIALIZED (
          SELECT l.id,
             l.first_character,
             l.last_character
            FROM listed l
         UNION
          SELECT ((x.thread ->> 'id'::text))::uuid AS uuid,
             ((x.thread ->> 'first_character'::text))::uuid AS uuid,
             ((x.thread ->> 'last_character'::text))::uuid AS uuid
            FROM pins x
         UNION
          SELECT s.id,
             s.first_character,
             s.last_character
            FROM stickies s
         ), people AS (
          SELECT t.first_character AS id
            FROM threads t
         UNION
          SELECT t.last_character
            FROM threads t
         UNION
          SELECT (m."character")::uuid AS "character"
            FROM marked m
         )
  SELECT jsonb_build_object('board', (to_jsonb(b.*) - 'closed'::text), 'closed', b.closed, 'mergedInto', ( SELECT (w.to_board -> 'mergedInto'::text)
            FROM went w), 'goesTo', ( SELECT (w.to_board -> 'goesTo'::text)
            FROM went w), 'fallback', ( SELECT (w.to_board -> 'fallback'::text)
            FROM went w), 'stubs',
         CASE
             WHEN (p.page = 1) THEN board_stubs(p.board)
             ELSE '[]'::jsonb
         END, 'total', COALESCE(p.total, 0), 'page', COALESCE(p.page, 1), 'threads', ( SELECT COALESCE(jsonb_agg(to_jsonb(l.*)), '[]'::jsonb) AS "coalesce"
            FROM listed l), 'pins', ( SELECT COALESCE(jsonb_agg(to_jsonb(x.*) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone DESC, x.play DESC), '[]'::jsonb) AS "coalesce"
            FROM pins x), 'stickies', ( SELECT COALESCE(jsonb_agg(to_jsonb(s.*) - 'ord'::text ORDER BY s.ord), '[]'::jsonb) AS "coalesce"
            FROM stickies s), 'banner', ( SELECT COALESCE(jsonb_agg(to_jsonb(x.*) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
            FROM banner x), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', s.play, 'state', s.state, 'saved_at', s.saved_at)), '[]'::jsonb) AS "coalesce"
            FROM effect_state s
           WHERE (s.play IN ( SELECT wanted.id
                    FROM wanted))), 'releases', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', r.play)), '[]'::jsonb) AS "coalesce"
            FROM effect_releases r
           WHERE (r.play IN ( SELECT wanted.id
                    FROM wanted))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
            FROM reaction_tallies t
           WHERE (t.act IN ( SELECT marked.id
                    FROM marked))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'character', r."character")), '[]'::jsonb) AS "coalesce"
            FROM my_reactions r
           WHERE (r.act IN ( SELECT marked.id
                    FROM marked))), 'reading', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('thread', r.thread, 'furthest_seq', r.furthest_seq)), '[]'::jsonb) AS "coalesce"
            FROM reading r
           WHERE (r.thread IN ( SELECT threads.id
                    FROM threads))), 'views', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('thread', v.thread, 'views', v.views)), '[]'::jsonb) AS "coalesce"
            FROM thread_view_counts v
           WHERE (v.thread IN ( SELECT threads.id
                    FROM threads))), 'characters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'profile',
                 CASE
                     WHEN (f."character" IS NULL) THEN NULL::jsonb
                     ELSE (jsonb_build_object('title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait, 'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f."character"))
                 END)), '[]'::jsonb) AS "coalesce"
            FROM (characters_public c
              LEFT JOIN character_profiles f ON ((f."character" = c.id)))
           WHERE (c.id IN ( SELECT people.id
                    FROM people
                   WHERE (people.id IS NOT NULL)))), 'presence',
         CASE
             WHEN (p.board IS NULL) THEN NULL::jsonb
             ELSE presence_box('board'::text, p.board)
         END, 'unread', my_alerts_unread()) AS jsonb_build_object
    FROM (b
      LEFT JOIN p ON ((p.board = b.id)))
  );
end
$function$;
