-- A merge rebuilds its threads in one statement, moves the search copy before it locks them, and a reply pays nothing for any of it (final review of PR #450, findings F1 and F4, delta review F6; "Weigh a design at the scale of a busy instance").
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
--
-- threads_board_by_rebuild is the guard that nothing else changes the column and skips the upkeep: a row trigger `before update of board`, so a statement that leaves board out of its SET list (every reply)
-- never meets it. It refuses unless rebuild_thread_places has set the transaction-local flag kayfabb.rebuilding_places, which it clears afterward, or the session is in replica role (an import or a restore, whose
-- other triggers are off too). It is enabled always. 0030's insert trigger stays.

drop trigger threads_recount_board on threads;
drop trigger threads_search_board on threads;
drop function threads_recount_board();
drop function threads_search_board();

create or replace function rebuild_thread_places(which uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  olds uuid[];
  news uuid[];
  d record;
  changed integer;
begin
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
