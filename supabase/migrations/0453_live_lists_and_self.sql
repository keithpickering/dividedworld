-- Live lists: a board's thread list and the index hear every post (docs/plans/2026-11-25-live-lists-and-self-design.md, sections 2, 3 and 5; plan Task 1).
--
--   thread_row     the row of one thread exactly as board_page lists it (to_jsonb over thread_list's columns, 0448), or null for a thread thread_list does not list.
--   board_summary  the entry of one board exactly as index_page builds it (0368), or null for a closed board.
--   acts_live_lists  after a statement that wrote an Act with a thread and a place number (a post, a spin, an unmask, an announcement: what bumps a thread in thread_list), queues `row` on `board:<board>`
--                    and `board` on `index`, each skipped when its projection is null. An edit, a card, a poll and a reaction have no place number and send nothing.
--                    The row carries no view count (views stay hourly batches), no reading position, and nothing about an owner, an account or a reactor: it is what any signed-in player reads in the list.
--   masks_change   (0436) without its `thread` broadcast to the board: the thread it opens is a thread whose first Act fires the trigger above, so the one row is sent from there. Nothing else changes.
--   the policy     "signed-in players hear the board" (0008) also lets a signed-in role hear `index`.
--
-- The projections are plpgsql, not SQL: a SQL function's plan is not re-made after an index under it is dropped in the same transaction (supabase/tests/0034-thread-list.sql does that, and 'could not open relation' was the answer).
-- They are volatile on purpose: a trigger reads the Act it fires on, which a stable function's older snapshot would not show.
-- A way out: nothing here holds a player in a state; a missed event is read again by the page's own reload.

create function thread_row(in_thread uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select to_jsonb(l) from (
    select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.last_seq, t.replies, t.first_act, t.first_character, t.last_act, t.last_character,
           t.replies_this_week, t.origin_thread, t.origin_place
    from thread_list t where t.id = in_thread) l);
end $$;
revoke execute on function thread_row(uuid) from public, anon, authenticated;

create function board_summary(in_board uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
      'thread_count', coalesce(c.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title)
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true
    where b.id = in_board and not b.closed);
end $$;
revoke execute on function board_summary(uuid) from public, anon, authenticated;

-- One statement, not one row: a statement that writes many Acts (a settlement's announcements, a backfill, a test that writes twenty thousand) sends each thread's row and each board's entry once, as the state after the statement,
-- and costs two projections for each thread and board it touched and not one for each Act. A row of one Act is the same row: the transition table holds that Act alone.
create function acts_live_lists() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  one record;
  listed jsonb;
  summary jsonb;
begin
  for one in select distinct n.thread from new_acts n where n.thread is not null and n.seq is not null loop
    listed := thread_row(one.thread);
    if listed is not null then perform broadcast_later('board:' || (listed ->> 'board'), 'row', listed); end if;
  end loop;
  for one in select distinct t.board from new_acts n join threads t on t.id = n.thread where n.thread is not null and n.seq is not null loop
    summary := board_summary(one.board);
    if summary is not null then perform broadcast_later('index', 'board', summary); end if;
  end loop;
  return null;
end $$;
revoke execute on function acts_live_lists() from public, anon, authenticated;

create trigger acts_live_lists after insert on acts referencing new table as new_acts for each statement execute function acts_live_lists();

-- masks_change (0436), without the `thread` broadcast: the first Act of the thread it opens sends the board its row. Everything else as 0436 wrote it.
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

-- The policy of 0008, made again with `index`. Fail closed, as 0008 and 0061 are: without row-level security the policy would hold nobody back.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'realtime')
     and exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
      raise exception 'realtime.messages has no row-level security, so private channels would be open to every listener';
    end if;
    drop policy if exists "signed-in players hear the board" on realtime.messages;
    execute $p$create policy "signed-in players hear the board" on realtime.messages for select to authenticated
      using (extension = 'broadcast' and (realtime.topic() like 'thread:%' or realtime.topic() like 'board:%' or realtime.topic() = 'index'))$p$;
  end if;
end $$;
