-- A merge rebuilds its threads in one statement, moves the search copy before it locks them, and a reply pays nothing for any of it; and the writers of a place wait for each other (final review of PR #450, findings F1, F4, F7 and F9, delta review F6 and F11 to F15; "Weigh a design at the scale of a busy instance").
--
-- Landing a mergeBoard or a createBoard rebuilt every thread the move touched with rebuild_thread_places(touched), which called thread_place(id) once per thread, and each changed thread fired
-- two row triggers (0293's threads_recount_board, 0117's threads_search_board) inside the tick's one transaction. On a board of 10,000 threads that was 32 s to land, 16 s to reverse, and a reply to any of
-- the threads (acts_take_seq updates its thread's row) waited 30 s on the lock the tick held. thread_places_computed() reads all 10,000 threads in 7 ms. A first fix moved the upkeep into statement-level triggers
-- on threads, which still ran after threads.board was updated, so the moved threads' rows stayed locked while post_search.board was rewritten (11,111 threads of 555,550 posts: 19.6 s, a reply waited 17.8 s),
-- and which fired on every `update threads`, a reply's included, at about 0.3 ms a post, since a transition-table trigger cannot be limited to a column. So there is no trigger upkeep at all:
--
-- rebuild_thread_places is the only writer of threads.board (0291, 0292, and here; the one other writer of the column is the import, in replica role, which carries the counts and the search copy as exported),
-- so it keeps them itself, in one call and in this order:
--   1. the moves, once: (thread, old board, new board) where they differ. A long list of threads, or all, is one statement that joins thread_places_computed(); a short list (a moveThread's one thread) still asks
--      thread_place per thread, since computing every thread's place to write one is the larger cost on a busy instance; REBUILD_SET_BASED_FROM is where the two meet. Both read the same rules, and tests
--      0180, 0182 and 0189 assert that they agree.
--   2. post_search.board of those threads' posts. A reply inserts a post_search row and never updates one, and an edit updates words only (0117's acts_search), so only an edit of a moved thread's post waits on
--      these rows, for the length of this statement.
--   3. board_thread_counts, once per board by its net change, on the shard 0030's insert trigger chooses (`for update skip locked`), boards in id order so two statements cannot wait on each other, never the
--      system board's.
--   4. threads.board, last, in one statement. The thread rows are locked from here to the commit, and this is the short part.
--   5. post_search.board of those threads again, where it still differs. A reply takes its thread's row after step 2 began and before step 4 updated it, and inserts its search row with the board the thread
--      is leaving; step 4 waits for that reply to commit, so this statement, which comes after, sees its row. It touches only stale rows, and the thread rows are locked here (F9).
--
-- The writers of a place wait for each other (F7). rebuild_thread_places computes places from the Acts its own snapshot can see, and the other writers did not wait for one another: start_thread, the tick's
-- landing of a lasting move, and end_move or reverse_move of one. A thread started on a board while the tick had landed, and not committed, a merge of it was stored on the board the merge closed (not_closed
-- passed, the merge not being visible, and the merge's rebuild never saw the thread); an admin's reversal of a moveThread that committed while the tick landed a merge of the thread's origin put the thread
-- back on the closed board. Both left a thread on a board no page lists, with no way back. Transaction-level advisory locks, each held to commit (under READ COMMITTED, each statement after the lock sees
-- what the other transaction committed), now serialize them:
--   lock_thread_places()      ONE global exclusive key, "thread places". The tick takes it ONCE, before its landing loop, whenever a lasting move is due or a lasting move is in force (so any end it may make is covered);
--                             end_move before its per-move lock and before it reads, for a lasting kind, reverse_move before its first end, apply_meeting before its first write whenever its answer may queue or end a
--                             lasting move, lasting_rebuild and rebuild_thread_places themselves (so a caller that forgot is still serialized, and two overlapping rebuilds, which deadlocked on post_search rows, now
--                             run one after the other). It is re-entrant: a second take in one transaction costs nothing.
--   lock_board_closing(board) a key per board, exclusive, that a move taking the board out of play holds: a landing mergeBoard, and the end of a mergeBoard or a createBoard (a reversed createBoard closes the
--                             board it made). It takes the global key first, so the order is one everywhere: the global key, then board keys.
--   lock_board_start(board)   the same key, shared, and TRIED, never waited for (delta review F14): a start that finds a closing move open on its board is refused at once, in plain words ("this board is being
--                             merged or closed right now; try again in a minute"), where it used to wait out the whole tick, which at scale is past a request's timeout. It is taken in a statement of its own before
--                             the closed check reads, so the check's snapshot is made after the key is won: a closing move that has committed is seen, and the start is refused in words that name where the
--                             threads went. Starts on a board nobody is closing never wait and are never refused, and starts on one board never meet each other (shared).
--
-- EVERY insert into threads meets the guard (delta review F11). start_thread had the key and the check; a spin (spin_written) and a persona's thread (write_staff_thread, from chatter) had neither, and a spin
-- from a post on The System's board opened on players_board(), the oldest board there is, open or not. So the guard is a trigger, threads_on_open_board, `before insert` on threads, for each row: it takes
-- lock_board_start in one statement and then asks not_closed in the next (a fresh snapshot), and refuses a closed board that is not The System's in the same words start_thread uses. The paths, from the migrations'
-- latest definitions (every `insert into threads`, grepped):
--   start_thread (0299)               checks first (its words are the ones a player sees), and the trigger is behind it;
--   spin_written (0130)               the trigger only; players_board() (here) is now the first OPEN board, so a spin from The System's post never aims at a closed one;
--   write_staff_thread (0089)         the trigger only; pool_context (here) no longer lists a closed board, so chatter is not aimed at one;
--   The System's own threads          the announcements thread (system_tick's and every later definition of post_update, season and reveal writers) and the updates, turns, reveal and results threads are
--                                     on The System's board, which no move can close (lasting_move_problem), and the trigger returns at once for it;
--   an import or a restore            in the replica role, where a trigger that is not `enable always` does not fire: it carries threads as they were exported (supabase/tests/e2e/0003-export.ts).
-- A thread that moves does not insert; threads.board changes only through rebuild_thread_places (below).
--
-- One lock order, and no deadlock (delta review F13). The global key comes first, whatever else a transaction does. Before, the tick took it only at its first lasting landing, after earlier landings had written
-- Acts into The System's announcements thread (a row it holds to the end), while end_move and reverse_move take the key and then write the move's end into that same thread: the tick waited for the admin's
-- key, the admin for the tick's row. Now the tick takes the key before its landing loop whenever any lasting move is due or in force, an admin's reversal waits at the key holding nothing, and apply_meeting,
-- which wrote a move_keep Act before it ended a lasting move as superseded, takes the key before its first write whenever its answer names a lasting move or an inheritance decision. The board keys are taken only
-- under the global key, so two writers never meet on one; the only contender for a board key is a start (or any other thread insert), which holds a single shared key, takes no other lock of this kind and
-- never waits for one (it tries), and what it writes is its own new rows (a thread, its first post, the counts on a shard `skip locked`). A system board is never closed (lasting_move_problem).
-- Cost: an insert into threads on a board nobody is closing takes one uncontended shared advisory lock (about 0.01 ms) and one read of the board; on a board being merged it is refused at once; a tick with a
-- lasting move in force takes the one global key at its start and holds it to its end, which is the tick's own length (admin reversals wait that long and nothing else does).
--
-- threads_board_by_rebuild is the guard that nothing else changes the column and skips the upkeep: a row trigger `before update of board`, so a statement that leaves board out of its SET list (every reply)
-- never meets it. It refuses unless rebuild_thread_places has set the transaction-local flag kayfabb.rebuilding_places, which it clears afterward, or the session is in replica role (an import or a restore, whose
-- other triggers are off too). It is enabled always. 0030's insert trigger stays.

drop trigger threads_recount_board on threads;
drop trigger threads_search_board on threads;
drop function threads_recount_board();
drop function threads_search_board();

-- The locks (see the header). The first int of each key names the kind, the second the board; hashtext collisions only make two boards share a wait, never miss one.
create function lock_thread_places() returns void
language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtext('kayfabb.thread_places'), 0)
$$;
create function lock_board_closing(in_board uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform lock_thread_places();
  perform pg_advisory_xact_lock(hashtext('kayfabb.board_places'), hashtext(in_board::text));
end $$;
create function lock_board_start(in_board uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Tried, not waited for: a closing move holds the key to the end of the tick, which at scale is past a request's timeout. The words are plain and out of character, as the closed board's are.
  if not pg_try_advisory_xact_lock_shared(hashtext('kayfabb.board_places'), hashtext(in_board::text)) then
    raise exception 'this board is being merged or closed right now; try again in a minute' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;
revoke execute on function lock_thread_places(), lock_board_closing(uuid), lock_board_start(uuid) from public, anon, authenticated;
grant execute on function lock_thread_places(), lock_board_closing(uuid), lock_board_start(uuid) to service_role;

-- The guard every insert into threads meets (see the header). The key is taken in one statement and the closed check read in the next, so its snapshot is made after the key is won. The System's board is never
-- closed and takes neither. An import runs in the replica role, where this trigger does not fire (it is not `enable always`): the threads arrive as exported.
create function threads_on_open_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from boards b where b.id = new.board and b.is_system) then return new; end if;
  perform lock_board_start(new.board);
  perform not_closed(new.board);
  return new;
end $$;
create trigger threads_on_open_board before insert on threads for each row execute function threads_on_open_board();
revoke execute on function threads_on_open_board() from public, anon, authenticated;

-- players_board (0013), the first OPEN board for players, where a thread spun from The System's Act opens: the oldest board may be merged away, and no page lists a thread on a closed one.
create or replace function players_board() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select first_open_board()
$$;

-- pool_context (0089), leaving out a closed board: chatter aims a persona's thread at a board it lists. Everything else as 0089 wrote it.
create or replace function pool_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'predecessor', (select h.outgoing from season_handovers h
                    where h.boss = current_boss() and h.outgoing is distinct from h.boss order by h.landed_at desc, h.season desc limit 1),
    'offices', coalesce((select jsonb_object_agg(o.staff, o.office) from staff_office_now o join characters c on c.staff = o.staff where c.staff_kind = 'persona'), '{}'::jsonb),
    'characters', coalesce((select jsonb_object_agg(c.staff, c.id) from characters c where c.staff is not null and c.staff_kind = 'persona'), '{}'::jsonb),
    'boards', coalesce((select jsonb_object_agg(b.id, b.slug) from boards b where not b.is_system and board_is_open(b.id)), '{}'::jsonb))
$$;

create or replace function rebuild_thread_places(which uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  olds uuid[];
  news uuid[];
  d record;
  changed integer;
begin
  -- 0. The one global key, before anything is read: what another writer committed is what this call computes from.
  perform lock_thread_places();
  -- 1. The moves, computed once. Three reads: every thread, a long list (one pass over every thread is cheaper than a probe per thread; REBUILD_SET_BASED_FROM), a short list.
  if which is null then
    select array_agg(t.id), array_agg(t.board), array_agg(c.place) into ids, olds, news
    from threads t join thread_places_computed() c on c.thread = t.id where c.place is not null and t.board is distinct from c.place;
  elsif cardinality(which) > 100 then
    select array_agg(t.id), array_agg(t.board), array_agg(c.place) into ids, olds, news
    from threads t join thread_places_computed() c on c.thread = t.id
    where t.id in (select u from unnest(which) u) and c.place is not null and t.board is distinct from c.place;
  else
    select array_agg(p.id), array_agg(p.board), array_agg(p.place) into ids, olds, news
    from (select x.id, x.board, thread_place(x.id) as place from threads x where x.id = any (which)) p where p.place is not null and p.board is distinct from p.place;
  end if;
  if ids is null then return 0; end if;

  -- 2. The search copy, before threads is touched: a reply to a moved thread does not wait on these rows.
  update post_search p set board = m.place from unnest(ids, news) as m(id, place) where p.thread = m.id and p.board is distinct from m.place;

  -- 3. The counts, once per board by the net change, on the shard a row trigger would have taken; the system board's threads are never counted.
  for d in
    select x.board, sum(x.delta)::integer as delta from (
      select o as board, -1 as delta from unnest(olds) o
      union all
      select n, 1 from unnest(news) n
    ) x where not exists (select 1 from boards b where b.id = x.board and b.is_system) group by x.board having sum(x.delta) <> 0 order by x.board
  loop
    update board_thread_counts set threads = threads + d.delta
     where board = d.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = d.board order by c.shard for update skip locked limit 1), 0);
  end loop;

  -- 4. threads.board, last and in one statement, past the guard. A thread whose board is no longer the one this call read (another rebuild between the read and here) fails the call, which rolls the
  -- counts and the search copy back with it, rather than leaving them counted for a move that was not made.
  perform set_config('kayfabb.rebuilding_places', 'on', true);
  update threads t set board = m.place from unnest(ids, olds, news) as m(id, old_board, place) where t.id = m.id and t.board = m.old_board;
  get diagnostics changed = row_count;
  perform set_config('kayfabb.rebuilding_places', 'off', true);
  if changed <> cardinality(ids) then
    raise exception 'rebuild_thread_places found % of % threads moved by another writer; nothing was written', cardinality(ids) - changed, cardinality(ids);
  end if;

  -- 5. The search rows a reply wrote in the meantime. It took its thread's row after step 2 and before step 4 and read the board the thread was leaving; step 4 waited for it, so it is visible now. Only stale rows.
  update post_search p set board = m.place from unnest(ids, news) as m(id, place) where p.thread = m.id and p.board is distinct from m.place;
  return changed;
end $$;

create function threads_board_by_rebuild() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_setting('session_replication_role') = 'replica' or coalesce(current_setting('kayfabb.rebuilding_places', true), '') = 'on' then
    return new;
  end if;
  raise exception 'threads.board changes only through rebuild_thread_places, which keeps the board counts and the search copy with it';
end $$;
create trigger threads_board_by_rebuild before update of board on threads
  for each row when (old.board is distinct from new.board) execute function threads_board_by_rebuild();
alter table threads enable always trigger threads_board_by_rebuild;

revoke execute on function threads_board_by_rebuild() from public, anon, authenticated;
