-- A merge rebuilds its threads in one statement, moves the search copy before it locks them, and a reply pays nothing for any of it; and the writers of a place wait for each other (final review of PR #450, findings F1, F4, F7 and F9, delta review F6; "Weigh a design at the scale of a busy instance").
--
-- Landing a mergeBoard or a createBoard rebuilt every thread the move touched with rebuild_thread_places(touched), which called thread_place(id) once per thread, and each changed thread fired
-- two row triggers (0216's threads_recount_board, 0117's threads_search_board) inside the tick's one transaction. On a board of 10,000 threads that was 32 s to land, 16 s to reverse, and a reply to any of
-- the threads (acts_take_seq updates its thread's row) waited 30 s on the lock the tick held. thread_places_computed() reads all 10,000 threads in 7 ms. A first fix moved the upkeep into statement-level triggers
-- on threads, which still ran after threads.board was updated, so the moved threads' rows stayed locked while post_search.board was rewritten (11,111 threads of 555,550 posts: 19.6 s, a reply waited 17.8 s),
-- and which fired on every `update threads`, a reply's included, at about 0.3 ms a post, since a transition-table trigger cannot be limited to a column. So there is no trigger upkeep at all:
--
-- rebuild_thread_places is the only writer of threads.board (0214, 0215, and here; the one other writer of the column is the import, in replica role, which carries the counts and the search copy as exported),
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
--   lock_thread_places()      ONE global exclusive key, "thread places". The tick takes it before it reads anything for a lasting move's landing (its checks, first_open_board and the rebuild), end_move before
--                             its per-move lock and before it reads, for a lasting kind, reverse_move before its first end, lasting_rebuild and rebuild_thread_places themselves (so a caller that forgot is still
--                             serialized, and two overlapping rebuilds, which deadlocked on post_search rows, now run one after the other). It is re-entrant: a second take in one transaction costs nothing.
--   lock_board_closing(board) a key per board, exclusive, that a move taking the board out of play holds: a landing mergeBoard, and the end of a mergeBoard or a createBoard (a reversed createBoard closes the
--                             board it made). It takes the global key first, so the order is one everywhere: the global key, then board keys.
--   lock_board_start(board)   the same key, shared. start_thread takes it in a statement of its own before it asks not_closed, so the check's snapshot is made after the lock is won: a start waits only while a
--                             closing move on its own board is open, and then it sees the move and is refused in words that name where the threads went. Starts on a board nobody is closing never wait, and
--                             starts on one board never wait on each other (shared).
-- No deadlock. The one order is the global key, then board keys (a writer that closes several boards in one transaction, a reversal's chain, takes them under the global key one after another, where no other
-- writer can be: the only contender for a board key is a start, so there is no second order to sort by). The board keys are taken only under the global key, so two writers never meet on one; the only contender for a board key is a start, which holds a
-- single shared key and takes no other lock of this kind, and what a start writes is its own new rows (a thread, its first post, the counts on a shard `skip locked`), so a writer waiting for its key waits only
-- for that start to commit, and a start waiting for a writer's key holds nothing the writer waits on. A system board is never closed (lasting_move_problem), and start_thread refuses it before the key; no
-- other path inserts a thread onto a board a move can close (the other inserts are the system board's announcements, reveals and updates). Cost: a start with no closing move in flight takes one uncontended
-- shared advisory lock (about 0.01 ms); a start on a board being merged waits for the tick to commit (see the timings in the PR); a start on any other board never does.
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
language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock_shared(hashtext('kayfabb.board_places'), hashtext(in_board::text))
$$;
revoke execute on function lock_thread_places(), lock_board_closing(uuid), lock_board_start(uuid) from public, anon, authenticated;
grant execute on function lock_thread_places(), lock_board_closing(uuid), lock_board_start(uuid) to service_role;

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
