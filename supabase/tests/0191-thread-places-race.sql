-- A merge moves the search copy before it locks the threads, and a reply pays nothing for it (supabase/migrations/0312_thread_places_at_scale.sql; delta review of PR #450, finding F4).
--
-- Landing a merge of many threads rewrote post_search.board for every post of every moved thread from a trigger on threads, after threads.board was updated, so the moved threads' rows stayed locked
-- for the whole rewrite: 19.6 s for 11,111 threads of 555,550 posts, and a reply to a moved thread (acts_take_seq updates its thread's row) waited 17.8 s on the row lock. rebuild_thread_places now moves
-- the search copy first, adjusts the counts once per board, and updates threads.board last, in one statement.
--
-- The rows are committed (tests.commit) and the merge runs in a session of its own (dblink), since the point is another session writing while it runs; every name is this file's, and the file takes
-- its rows out again when it is done. The state a landed merge leaves before its rebuild is written directly (a move Act in force, the threads not yet moved), which is exactly what lasting_rebuild
-- finds when it calls rebuild_thread_places. Without the replica role the 100,000 Acts of the fixture would each fire the Act triggers.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- ---- 0. The fixture: two boards, 5,000 threads of 20 posts each on one of them (100,000 post_search rows), a merge of that board in force whose rebuild has not run ----
do $$
begin
  perform tests.commit($sql$
    insert into auth.users (id, email) values ('7ace0000-0189-4000-8000-0000000000a1', 'thread-race@test.invalid');
    insert into accounts (id, created_at) values ('7ace0000-0189-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
    insert into characters (id, owner, name, created_at, debuted_at) values ('7ace0000-0189-4000-8000-0000000000b1', '7ace0000-0189-4000-8000-0000000000a1', 'Thread Racer', now(), now());
    insert into class_history (character, class_key) values ('7ace0000-0189-4000-8000-0000000000b1', 'alpha');
    insert into boards (id, slug, name, created_at) values
      ('7ace0000-0189-4000-8000-0000000000c1', 'race-src', 'Race Source', now() - interval '3 days'), ('7ace0000-0189-4000-8000-0000000000c2', 'race-dst', 'Race Destination', now() - interval '4 days');
    insert into threads (board, title) select '7ace0000-0189-4000-8000-0000000000c1', 'Race thread ' || g from generate_series(1, 5000) g;
    set local session_replication_role = replica;
    insert into acts (character, kind, thread, payload, seq, created_at)
      select '7ace0000-0189-4000-8000-0000000000b1', 'post', t.id, jsonb_build_object('body', 'Race body ' || s || ' of ' || t.title), s, now() - interval '1 day' + s * interval '1 second'
      from threads t, generate_series(1, 20) s where t.title like 'Race thread %';
    update threads set next_seq = 21, replies = 19 where title like 'Race thread %';
    insert into post_search (act, thread, board, first, character, created_at, words)
      select a.id, a.thread, t.board, a.seq = 1, a.character, a.created_at, search_words(a.payload ->> 'body', case when a.seq = 1 then t.title end)
      from acts a join threads t on t.id = a.thread where t.title like 'Race thread %';
    insert into acts (id, character, kind, thread, payload, seq, created_at)
      select '7ace0000-0189-4000-8000-0000000000d1', '7ace0000-0189-4000-8000-0000000000b1', 'move', t.id,
             '{"kind": "mergeBoard", "body": "Merged.", "params": {"board": "7ace0000-0189-4000-8000-0000000000c1", "into": "7ace0000-0189-4000-8000-0000000000c2"}}', 21, now()
      from threads t where t.title = 'Race thread 1';
    insert into open_moves (move_act, landed_at) values ('7ace0000-0189-4000-8000-0000000000d1', now());
    analyze threads; analyze acts; analyze post_search;
  $sql$);
  perform pg_temp.expect((select count(*) from post_search p join threads t on t.id = p.thread where t.title like 'Race thread %') = 100000, 'the fixture did not index 20 posts for each of the 5,000 threads');
  perform pg_temp.expect((select count(*) from thread_places_drift() d join threads t on t.id = d.thread where t.title like 'Race thread %') = 5000, 'the fixture is not 5,000 threads waiting on their rebuild');
end $$;

-- ---- 1. The merge lands in one session; in another, replies to the moved threads are written while it runs, each held to a short lock wait ----
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  victims uuid[];
  held integer := 0;       -- replies that waited out their lock and failed
  during integer := 0;     -- replies started while the merge was running
  total integer := 0;
  first_error text;
  t0 timestamptz := clock_timestamp();
  took interval;
  i integer := 0;
  v uuid;
begin
  select array_agg(id) into victims from (select id from threads where title like 'Race thread %' order by title limit 200) x;
  perform extensions.dblink_connect('merger', url);
  perform extensions.dblink_connect('replier', url);
  -- The replier's wait is short on purpose: a reply that has to wait out the search rewrite is a reply that waited seconds, and fails here.
  perform extensions.dblink_exec('replier', 'set lock_timeout = ''1s''');
  perform extensions.dblink_send_query('merger', 'select rebuild_thread_places((select array_agg(id) from threads where title like ''Race thread %''))');
  loop
    exit when extensions.dblink_is_busy('merger') = 0 and total > 0;
    v := victims[1 + (i % cardinality(victims))];
    i := i + 1;
    total := total + 1;
    if extensions.dblink_is_busy('merger') = 1 then during := during + 1; end if;
    begin
      -- What acts_take_seq does for a reply to the thread, to a thread the merge moves.
      perform extensions.dblink_exec('replier', format('update threads set next_seq = next_seq + 1, last_at = now() where id = %L', v));
    exception when others then
      held := held + 1;
      first_error := coalesce(first_error, sqlerrm);
      exit when held >= 3;
    end;
    perform pg_sleep(0.02);
  end loop;
  -- Whatever ran past the loop, wait it out so the next block reads a finished merge.
  begin
    perform * from extensions.dblink_get_result('merger') as r(changed integer);
  exception when others then
    perform extensions.dblink_disconnect('replier');
    perform extensions.dblink_disconnect('merger');
    raise exception 'the merge did not land: %', sqlerrm;
  end;
  took := clock_timestamp() - t0;
  perform extensions.dblink_disconnect('replier');
  perform extensions.dblink_disconnect('merger');
  raise notice 'the merge of 5,000 threads with 100,000 posts landed in %; % replies were written, % of them while it ran, % held past 1 s', took, total, during, held;
  perform pg_temp.expect(held = 0, format('a reply to a moved thread was held by the merge: %s of %s failed to take the thread''s row in 1 s (%s)', held, total, first_error));
  perform pg_temp.expect(during >= 2, format('only %s replies were tried while the merge ran, so the test did not overlap it', during));
end $$;

-- ---- 2. What the merge leaves: every thread on the destination, the counts and the search copy follow, no drift ----
do $$
begin
  perform pg_temp.expect((select count(*) from threads where title like 'Race thread %' and board = '7ace0000-0189-4000-8000-0000000000c2') = 5000, 'the threads did not all join the destination');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after the merge');
  perform pg_temp.expect(not exists (select 1 from post_search p join threads t on t.id = p.thread where t.title like 'Race thread %' and p.board is distinct from t.board), 'a post''s search copy is on a board its thread left');
  perform pg_temp.expect((select count(*) from post_search where board = '7ace0000-0189-4000-8000-0000000000c2') = 100000, 'the destination does not hold the 100,000 search rows');
  perform pg_temp.expect((select coalesce(sum(threads), 0) from board_thread_counts where board = '7ace0000-0189-4000-8000-0000000000c1') = 0, 'the source still counts threads: ' || (select sum(threads) from board_thread_counts where board = '7ace0000-0189-4000-8000-0000000000c1'));
  perform pg_temp.expect((select coalesce(sum(threads), 0) from board_thread_counts where board = '7ace0000-0189-4000-8000-0000000000c2') = 5000, 'the destination does not count 5,000 threads: ' || (select sum(threads) from board_thread_counts where board = '7ace0000-0189-4000-8000-0000000000c2'));
end $$;

-- ---- 3. Nothing else changes threads.board: a direct update is refused, and the refusal is the guard's own. On rows of this transaction's own, so no lock is left on the fixture ----
do $$
declare
  elsewhere uuid;
  t uuid;
  state text;
  msg text;
begin
  insert into boards (slug, name) values ('race-guard-a', 'Guard A'), ('race-guard-b', 'Guard B');
  elsewhere := (select id from boards where slug = 'race-guard-b');
  insert into threads (board, title) values ((select id from boards where slug = 'race-guard-a'), 'Guarded') returning id into t;
  begin
    update threads set board = elsewhere where id = t;
    raise exception 'a direct update of threads.board was allowed';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if not (state = 'P0001' and msg like '%only through rebuild_thread_places%') then raise exception 'refused by something else, or not at all: % %', state, msg; end if;
  end;
  perform pg_temp.expect((select board from threads where id = t) = (select id from boards where slug = 'race-guard-a'), 'the refused update moved the thread');
  -- A statement that leaves board out of its SET list does not meet the guard (a reply's update of the thread is one).
  update threads set last_at = last_at where id = t;
  -- A session in replica mode (a restore, an import) is not refused: it carries the counts and the search copy as they were exported.
  set local session_replication_role = replica;
  update threads set board = elsewhere where id = t;
  set local session_replication_role = origin;
  perform pg_temp.expect((select board from threads where id = t) = elsewhere, 'a replica-mode update of threads.board was refused');
  -- A rebuild puts it back, and leaves the flag off: a direct update after it is refused again.
  perform pg_temp.expect(rebuild_thread_places(array[t]) = 1, 'the rebuild did not put the poisoned thread back');
  begin
    update threads set board = elsewhere where id = t;
    raise exception 'a direct update of threads.board was allowed after a rebuild';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if not (state = 'P0001' and msg like '%only through rebuild_thread_places%') then raise exception 'refused by something else, or not at all, after a rebuild: % %', state, msg; end if;
  end;
end $$;

-- ---- 4. The upkeep is not per row: the statement triggers of 0312 are gone, and a rebuild adjusts the counts and the search copy itself ----
do $$
begin
  perform pg_temp.expect(not exists (select 1 from pg_proc where proname in ('threads_recount_board', 'threads_search_board')), 'a per-update trigger function of the board count or the search copy still exists');
  perform pg_temp.expect(not exists (select 1 from pg_trigger where tgrelid = 'threads'::regclass and tgname in ('threads_recount_board', 'threads_search_board')), 'a trigger of the board count or the search copy is still on threads');
end $$;

-- ---- 5. The file takes its rows out, in the replica role (which turns off the foreign keys), with the Acts' append-only guard off for this one transaction of a session of its own (0001's guard is enabled always, and a failing
-- statement rolls the transaction back with the guard on again). Every table that holds one of the rows is named. 100,000 Acts and as many search rows are not left for the files after this one ----
do $$
begin
  perform tests.commit($sql$
    set local session_replication_role = replica;
    delete from post_search where thread in (select id from threads where title like 'Race thread %');
    delete from open_moves where move_act = '7ace0000-0189-4000-8000-0000000000d1';
    alter table acts disable trigger acts_no_update;
    delete from acts where thread in (select id from threads where title like 'Race thread %');
    alter table acts enable trigger acts_no_update;
    delete from threads where title like 'Race thread %';
    delete from board_thread_counts where board in ('7ace0000-0189-4000-8000-0000000000c1', '7ace0000-0189-4000-8000-0000000000c2');
    delete from boards where id in ('7ace0000-0189-4000-8000-0000000000c1', '7ace0000-0189-4000-8000-0000000000c2');
    delete from standings where character = '7ace0000-0189-4000-8000-0000000000b1';
    delete from class_history where character = '7ace0000-0189-4000-8000-0000000000b1';
    delete from characters where id = '7ace0000-0189-4000-8000-0000000000b1';
    delete from accounts where id = '7ace0000-0189-4000-8000-0000000000a1';
    delete from auth.users where id = '7ace0000-0189-4000-8000-0000000000a1';
  $sql$);
  -- The 100,000 dead Acts and the statistics of the fixture are not left for the plan tests that follow (a vacuum cannot run inside the transaction of tests.commit, so it has a connection of its own).
  perform extensions.dblink_connect('tidy', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('tidy', 'vacuum analyze acts, post_search, threads, characters, boards, board_thread_counts, open_moves');
  perform extensions.dblink_disconnect('tidy');
end $$;
