-- A merge rebuilds its threads in one statement, and what follows a thread's board follows per statement (final review of PR #450, finding F1; "Weigh a design at the scale of a busy instance").
--
-- Landing a mergeBoard or a createBoard rebuilt every thread the move touched with rebuild_thread_places(touched), which called thread_place(id) once per thread, and each changed thread fired
-- three row triggers (threads_recount_board, threads_search_board) inside the tick's one transaction. On a board of 10,000 threads that was 32 s to land, 16 s to reverse, and a reply to any of
-- the threads (acts_take_seq updates its thread's row) waited 30 s on the lock the tick held. thread_places_computed() reads all 10,000 threads in 7 ms.
--
--   rebuild_thread_places(which)  with a long list of threads, one statement: it joins thread_places_computed() and writes only the rows that differ. A short list (a moveThread's one thread) still
--                                 asks thread_place per thread, since computing every thread's place to write one is the larger cost on a busy instance; REBUILD_SET_BASED_FROM is where
--                                 the two meet. Both read the same rules, and tests 0180, 0182 and 0189 assert that they agree.
--   threads_recount_board         a statement-level trigger over the update's transition tables: each board's count is adjusted once by the net difference, on the one shard the row trigger
--                                 would have taken (0030's `for update skip locked`), boards in id order so two statements cannot wait on each other. The system board is still never adjusted.
--                                 A transition table cannot be given a column list, so a statement that does not change a board finds no rows to adjust and returns.
--   threads_search_board          the same shape: one update of post_search.board for all the threads that moved, through post_search_thread_at.

create or replace function rebuild_thread_places(which uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if which is null then
    with written as (
      update threads t set board = c.place from thread_places_computed() c where c.thread = t.id and t.board is distinct from c.place returning 1
    ) select count(*)::integer into changed from written;
  elsif cardinality(which) > 100 then  -- REBUILD_SET_BASED_FROM: past this the one pass over every thread is cheaper than a probe per thread
    with written as (
      update threads t set board = c.place from thread_places_computed() c
      where c.thread = t.id and t.id in (select u from unnest(which) u) and c.place is not null and t.board is distinct from c.place returning 1
    ) select count(*)::integer into changed from written;
  else
    with written as (
      update threads t set board = p.place from (select x.id, thread_place(x.id) as place from threads x where x.id = any (which)) p
      where t.id = p.id and p.place is not null and t.board is distinct from p.place returning 1
    ) select count(*)::integer into changed from written;
  end if;
  return changed;
end $$;

-- The counts: per statement, by the net difference. The system board is never adjusted (its threads are taken off its count when they are started).
drop trigger threads_recount_board on threads;
create or replace function threads_recount_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record;
begin
  -- The rows whose board changed are found with EXCEPT, never a join of the two tables: a transition table has no statistics and no index, so the planner takes a join of them for one row
  -- and nests the loop (quadratic: 6 s for 5,000 threads), where EXCEPT hashes.
  for d in
    select x.board, sum(x.delta)::integer as delta from (
      select r.board, -1 as delta from (select o.id, o.board from old_rows o except select n.id, n.board from new_rows n) r
       where not exists (select 1 from boards b where b.id = r.board and b.is_system)
      union all
      select r.board, 1 from (select n.id, n.board from new_rows n except select o.id, o.board from old_rows o) r
       where not exists (select 1 from boards b where b.id = r.board and b.is_system)
    ) x group by x.board having sum(x.delta) <> 0 order by x.board
  loop
    update board_thread_counts set threads = threads + d.delta
     where board = d.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = d.board order by c.shard for update skip locked limit 1), 0);
  end loop;
  return null;
end $$;
create trigger threads_recount_board after update on threads
  referencing old table as old_rows new table as new_rows for each statement execute function threads_recount_board();

-- The search copy: the posts of every thread that moved, in one update.
drop trigger threads_search_board on threads;
create or replace function threads_search_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update post_search p set board = c.board
    from (select n.id, n.board from new_rows n except select o.id, o.board from old_rows o) c
   where p.thread = c.id and p.board is distinct from c.board;
  return null;
end $$;
create trigger threads_search_board after update on threads
  referencing old table as old_rows new table as new_rows for each statement execute function threads_search_board();

revoke execute on function threads_recount_board(), threads_search_board() from public, anon, authenticated;
