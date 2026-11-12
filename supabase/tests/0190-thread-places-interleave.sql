-- Place writers wait for each other, and every thread insert meets one guard (supabase/migrations/0339_thread_places_at_scale.sql, with 0320, 0322, 0326, 0329, 0334 and 0338; final review of PR #450, findings F7 and F9;
-- delta review F11 to F15).
--
-- rebuild_thread_places computes places from the Acts its own snapshot can see, and the writers that change a place did not wait for each other: start_thread, the tick's landing of a lasting move, and
-- end_move of one. Two interleavings left a thread on a closed board that no board page lists, with no way back:
--   (a) a thread started on board S while the tick had landed, and not yet committed, a merge of S into D: not_closed(S) passes (the merge is not committed), the thread is stored on S, and the merge's
--       rebuild never saw it;
--   (b) an admin's reversal of a moveThread that committed while the tick landed a merge of the thread's origin board: the reversal's rebuild cannot see the merge and puts the thread back on the
--       board the merge closed.
-- And (F9) a reply that took its thread's row after the merge rewrote post_search.board, and before it updated threads.board, inserted its search row with the old board, and nothing rewrote it.
--
-- The fix is locks, held to commit: one global exclusive key for everything that writes a place (the tick, once, before it lands anything whenever a lasting move may land or end; end_move of a lasting
-- kind; every rebuild), and per board a key a merge, or a reversed createBoard, takes exclusively for the board it closes. Every insert into threads takes that key shared, in a trigger (F11: a spin and a
-- Mod Bot's thread had no check at all, and a spin from The System's board went to the oldest board, open or not), and it TRIES the key (F14): a start on a board being merged is refused at once, in plain
-- words, where it used to wait out the whole tick, which at scale is past a request's timeout. Once the merge has committed, the same insert is refused in words that name where the threads went.
-- Starts on a board nobody is closing never wait and are never refused. And (F13) the tick and the other writers meet the two kinds of lock in one order: the global key first, a thread's row after it.
--
-- Every case runs the real system_tick and the real start_thread and end_move in sessions of their own (dblink), since the point is one session reading while another holds an uncommitted write. The rows
-- are committed (tests.commit) and the file takes them out again when it is done; every name is this file's.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- A transaction begun in a connection, as the player who owns the mask.
create function pg_temp.player(conn text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(conn, 'begin');
  perform extensions.dblink_exec(conn, $q$set local request.jwt.claims = '{"sub": "7ace0000-0190-4000-8000-0000000000a1", "role": "authenticated"}'$q$);
end $$;

-- A connection's result read, and what is left of it drained: a connection takes no other command until dblink_get_result has answered with no rows, and a result that raised needs the drain too.
create function pg_temp.drain(conn text) returns void language plpgsql as $$
begin
  for i in 1..3 loop
    begin
      perform * from extensions.dblink_get_result(conn) as x(r text);
    exception when others then null;
    end;
  end loop;
end $$;

-- What a connection that has been sent a query is waiting on, as pg_stat_activity says: polled until it shows a lock wait (the kind and the event: `Lock:advisory` for a key, `Lock:transactionid` for a
-- row), bounded at `secs`; null when it never waited, which is what a writer with no key does.
create function pg_temp.wait_lock(like_query text, secs numeric default 10) returns text language plpgsql as $$
declare
  until_at timestamptz := clock_timestamp() + make_interval(secs => secs);
  seen text;
begin
  loop
    -- The activity view is read once a transaction; the test's is one transaction, so each look starts from a fresh one.
    perform pg_stat_clear_snapshot();
    select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') into seen
    from pg_stat_activity where query like like_query and pid <> pg_backend_pid() and state = 'active' and wait_event_type = 'Lock' limit 1;
    if seen is not null then return seen; end if;
    exit when clock_timestamp() > until_at;
    perform pg_sleep(0.02);
  end loop;
  return null;
end $$;

-- A statement run in a subtransaction that is always rolled back, and what it did said as text: 'ok:' and the result of `after` (read in the same subtransaction, so it sees what the statement wrote),
-- or 'refused:' and the words it was refused in. Nothing it writes outlives the call.
create function pg_temp.probe(q text, after text default 'select ''done''') returns text language plpgsql as $$
declare
  res text;
begin
  begin
    execute q;
    execute after into res;
    raise exception 'ok:%', res using errcode = 'RB001';
  exception
    when sqlstate 'RB001' then return sqlerrm;
    when others then return 'refused:' || sqlerrm;
  end;
end $$;

-- What the files before this one left in the rows this file borrows (a committing test leaves its settings behind), put back when it is done.
create temp table prior (what text primary key, value jsonb);

-- ---- 0. The world: a player with a mask, a Boss with the season, the three lasting kinds, and boards in pairs (a case's source and destination), made newer than the first open board so no merge here moves it ----
do $$
begin
  insert into prior select 'setting ' || s.key, s.value from settings s where s.key in ('systemEnabled', 'systemAnnouncements');
  insert into prior select 'debuted shard ' || d.shard, to_jsonb(d) from debuted_count d;
  insert into prior select 'boss', to_jsonb(boss) from seasons where ends_at is null and boss is not null;
  -- The System board's thread counts: the announcements threads this file makes are counted on it (0030's insert trigger), and its cleanup deletes them without the delete trigger.
  insert into prior select 'count shard ' || c.shard, to_jsonb(c) from board_thread_counts c where c.board = (select id from boards where is_system);
  insert into prior select 'kind ' || k.key, to_jsonb(k) from move_kinds k where k.key in ('createBoard', 'mergeBoard', 'moveThread', 'ilWait');
  perform tests.commit($sql$
    insert into auth.users (id, email) values ('7ace0000-0190-4000-8000-0000000000a1', 'interleave@test.invalid');
    insert into accounts (id, created_at) values ('7ace0000-0190-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
    insert into characters (id, owner, name, created_at, debuted_at) values ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000a1', 'Interleaver', now(), now());
    insert into class_history (character, class_key) values ('7ace0000-0190-4000-8000-0000000000b1', 'alpha');
    insert into characters (id, owner, name, created_at, debuted_at) values ('7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000a1', 'Interleaver Two', now(), now());
    insert into class_history (character, class_key) values ('7ace0000-0190-4000-8000-0000000000b2', 'alpha');
    insert into characters (id, name, staff, staff_kind, created_at, debuted_at) values ('7ace0000-0190-4000-8000-0000000000f1', 'Interleave Boss', 'il-boss', 'persona', now(), now());
    update seasons set boss = 'il-boss' where ends_at is null;
    insert into boards (id, slug, name, created_at) values
      ('7ace0000-0190-4000-8000-0000000000c1', 'il-src-a', 'Il Source A', now() + interval '1 day'),
      ('7ace0000-0190-4000-8000-0000000000c2', 'il-dst-a', 'Il Destination A', now() + interval '2 days'),
      ('7ace0000-0190-4000-8000-0000000000c3', 'il-moved-to', 'Il Moved To', now() + interval '3 days'),
      ('7ace0000-0190-4000-8000-0000000000c4', 'il-else', 'Il Elsewhere', now() + interval '4 days'),
      ('7ace0000-0190-4000-8000-0000000000c5', 'il-src-b', 'Il Source B', now() + interval '5 days'),
      ('7ace0000-0190-4000-8000-0000000000c6', 'il-dst-b', 'Il Destination B', now() + interval '6 days'),
      ('7ace0000-0190-4000-8000-0000000000c7', 'il-src-f', 'Il Source F', now() + interval '7 days'),
      ('7ace0000-0190-4000-8000-0000000000c8', 'il-dst-f', 'Il Destination F', now() + interval '8 days'),
      -- The oldest board there is, where a spin from The System's board opens until it is merged away (case 6); the pair of case 3b's merge.
      ('7ace0000-0190-4000-8000-0000000000c9', 'il-old', 'Il Oldest', '1990-01-01T00:00:00Z'),
      ('7ace0000-0190-4000-8000-0000000000ca', 'il-dst-c', 'Il Destination C', now() + interval '9 days'),
      ('7ace0000-0190-4000-8000-0000000000cb', 'il-src-d', 'Il Source D', now() + interval '10 days'),
      ('7ace0000-0190-4000-8000-0000000000cc', 'il-dst-d', 'Il Destination D', now() + interval '11 days');
    insert into threads (id, board, title) values
      ('7ace0000-0190-4000-8000-000000000a01', '7ace0000-0190-4000-8000-0000000000c1', 'Il thread A1'),
      ('7ace0000-0190-4000-8000-000000000b01', '7ace0000-0190-4000-8000-0000000000c5', 'Il thread B1'),
      ('7ace0000-0190-4000-8000-000000000b02', '7ace0000-0190-4000-8000-0000000000c5', 'Il thread B2'),
      ('7ace0000-0190-4000-8000-000000000f01', '7ace0000-0190-4000-8000-0000000000c7', 'Il thread F1'),
      ('7ace0000-0190-4000-8000-000000000f02', '7ace0000-0190-4000-8000-0000000000c7', 'Il thread F2'),
      ('7ace0000-0190-4000-8000-000000000d01', '7ace0000-0190-4000-8000-0000000000c4', 'Il thread D1'),
      ('7ace0000-0190-4000-8000-000000000e01', (select id from boards where is_system), 'Il announcements');
    set local session_replication_role = replica;
    insert into acts (character, kind, thread, payload, seq, created_at)
      select '7ace0000-0190-4000-8000-0000000000b1', 'post', t.id, jsonb_build_object('body', 'Il body ' || s), s, now() - interval '1 day' + s * interval '1 second'
      from threads t, generate_series(1, 2) s where t.title like 'Il thread %';
    update threads set next_seq = 3, replies = 1 where title like 'Il thread %';
    insert into post_search (act, thread, board, first, character, created_at, words)
      select a.id, a.thread, t.board, a.seq = 1, a.character, a.created_at, search_words(a.payload ->> 'body', null)
      from acts a join threads t on t.id = a.thread where t.title like 'Il thread %';
    set local session_replication_role = origin;
    insert into settings (key, value) values ('systemEnabled', 'true'::jsonb), ('systemAnnouncements', '"7ace0000-0190-4000-8000-000000000e01"'::jsonb)
      on conflict (key) do update set value = excluded.value;
    insert into move_kinds (key, structural, shapes_board, lasting) values ('createBoard', true, true, true), ('mergeBoard', true, true, true), ('moveThread', false, false, true)
      on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = true;
    -- A move that is not lasting, for the tick to land before a lasting one (case 3b).
    insert into move_kinds (key, structural, shapes_board, lasting) values ('ilWait', false, false, false) on conflict (key) do nothing;
    insert into meetings (started_at, slot, finished_at, outcome) values ('2001-02-03T04:05:06Z', clock_timestamp(), '2001-02-03T04:06:06Z', 'ok');
    -- The moveThread of case (b), landed and committed now: thread B2 goes to Il Moved To.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'moveThread', '{"thread": "7ace0000-0190-4000-8000-000000000b02", "board": "7ace0000-0190-4000-8000-0000000000c3"}', 'because', now() - interval '1 minute', false from meetings;
    do $d$ begin perform system_tick(); end $d$;
    -- A second System thread, and The System speaks there from now on: the merge's Act and a reversal's move_end of the moveThread above go to different threads, so no row lock between them
    -- serializes the two (the first version of case 2 had one announcements thread, and never went red with the keys removed: F12).
    insert into threads (id, board, title) values ('7ace0000-0190-4000-8000-000000000e02', (select id from boards where is_system), 'Il announcements two');
    update settings set value = '"7ace0000-0190-4000-8000-000000000e02"'::jsonb where key = 'systemAnnouncements';
    -- The merge of case (a), waiting for a tick.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'mergeBoard', '{"board": "7ace0000-0190-4000-8000-0000000000c1", "into": "7ace0000-0190-4000-8000-0000000000c2"}', 'because', now() - interval '1 minute', true from meetings;
  $sql$);
  perform pg_temp.expect((select board from threads where title = 'Il thread B2') = '7ace0000-0190-4000-8000-0000000000c3', 'the fixture did not move thread B2 to the board it was sent to');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'the fixture starts with drift');
end $$;

-- ---- 1. Case (a): the tick has landed, and not committed, a merge of a board. Every way of putting a thread on it is refused at once, in plain words, and none of them waits (F11, F14); once the merge commits, the same inserts are refused in words that name where the threads went ----
-- The three paths that insert a player's or a Mod Bot's thread on a board: start_thread, a spin (spin_written), and a persona's thread (write_staff_thread, chatter's). A start on a board nobody is closing does not wait either.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  origin uuid := (select a.id from acts a join threads t on t.id = a.thread where t.title = 'Il thread A1' and a.seq = 1);
  outcome text;
  t0 timestamptz;
  quick interval;
  quick_other interval;
  went text;
begin
  perform extensions.dblink_connect('tick', url);
  perform extensions.dblink_connect('starter', url);
  perform extensions.dblink_connect('other', url);
  perform extensions.dblink_exec('tick', 'begin');
  perform * from extensions.dblink('tick', 'select system_tick()::text') as x(r text);
  perform pg_temp.expect((select count(*) from extensions.dblink('tick', $q$select landed_act::text from queued_moves where kind = 'mergeBoard' and landed_act is not null$q$) as x(a text)) = 1, 'the tick did not land the merge');

  -- (1) A start on the closing board, with the merge open: refused at once, not after the tick.
  perform pg_temp.player('starter');
  perform extensions.dblink_exec('starter', $q$set local lock_timeout = '5s'$q$);
  outcome := 'no refusal';
  t0 := clock_timestamp();
  begin
    perform * from extensions.dblink('starter', $q$select start_thread('il-src-a', '7ace0000-0190-4000-8000-0000000000b1', 'Il late thread', 'Started while the merge lands.')::text$q$) as x(r text);
  exception when others then
    outcome := sqlerrm;
  end;
  quick := clock_timestamp() - t0;
  perform extensions.dblink_exec('starter', 'rollback');
  raise notice 'a start on the board being merged was answered in %: %', quick, outcome;
  perform pg_temp.expect(outcome like '%being merged%try again%', 'a start on a board being merged was not refused in plain words: ' || outcome);
  perform pg_temp.expect(quick < interval '1 second', format('a start on a board being merged waited %s for the merge', quick));

  -- (2) A spin from a post on that board, the merge open: the thread it opens would be on the same board.
  perform pg_temp.player('starter');
  perform extensions.dblink_exec('starter', $q$set local lock_timeout = '5s'$q$);
  outcome := 'no refusal';
  t0 := clock_timestamp();
  begin
    perform * from extensions.dblink('starter', format($q$select spin(%L, '7ace0000-0190-4000-8000-0000000000b1', 'Il late spin', 'Spun while the merge lands.')::text$q$, origin)) as x(r text);
  exception when others then
    outcome := sqlerrm;
  end;
  quick := clock_timestamp() - t0;
  perform extensions.dblink_exec('starter', 'rollback');
  raise notice 'a spin onto the board being merged was answered in %: %', quick, outcome;
  perform pg_temp.expect(outcome like '%being merged%try again%', 'a spin onto a board being merged was not refused in plain words: ' || outcome);
  perform pg_temp.expect(quick < interval '1 second', format('a spin onto a board being merged waited %s for the merge', quick));

  -- (3) A persona's thread there, the merge open (the service role's call, as chatter makes it).
  perform extensions.dblink_exec('starter', 'begin');
  outcome := 'no refusal';
  t0 := clock_timestamp();
  begin
    perform * from extensions.dblink('starter', $q$select write_staff_thread('il-boss', 'il-src-a', 'Il late staff thread', 'Written while the merge lands.')::text$q$) as x(r text);
  exception when others then
    outcome := sqlerrm;
  end;
  quick := clock_timestamp() - t0;
  perform extensions.dblink_exec('starter', 'rollback');
  raise notice 'a persona''s thread onto the board being merged was answered in %: %', quick, outcome;
  perform pg_temp.expect(outcome like '%being merged%try again%', 'a persona''s thread onto a board being merged was not refused in plain words: ' || outcome);
  perform pg_temp.expect(quick < interval '1 second', format('a persona''s thread onto a board being merged waited %s for the merge', quick));

  -- A start on a board the merge does not touch, with the merge still open: it must not wait for it, and is not refused.
  perform pg_temp.player('other');
  perform extensions.dblink_exec('other', $q$set local lock_timeout = '2s'$q$);
  t0 := clock_timestamp();
  perform * from extensions.dblink('other', $q$select start_thread('il-else', '7ace0000-0190-4000-8000-0000000000b2', 'Il unrelated thread', 'No merge here.')::text$q$) as x(r text);
  quick_other := clock_timestamp() - t0;
  perform extensions.dblink_exec('other', 'commit');
  perform pg_temp.expect(quick_other < interval '1 second', format('a start on a board nobody is closing waited %s for a merge of another', quick_other));

  -- The merge commits.
  perform extensions.dblink_exec('tick', 'commit');
  perform extensions.dblink_disconnect('tick');
  perform extensions.dblink_disconnect('starter');
  perform extensions.dblink_disconnect('other');

  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), format('%s thread(s) are not on their place after the merge', (select count(*) from thread_places_drift())));
  perform pg_temp.expect(not exists (select 1 from threads where title in ('Il late thread', 'Il late spin', 'Il late staff thread')), 'a refused insert left a thread');
  perform pg_temp.expect((select board from threads where title = 'Il unrelated thread') = '7ace0000-0190-4000-8000-0000000000c4', 'the start on the other board did not land');
  perform pg_temp.expect((select board from threads where title = 'Il thread A1') = '7ace0000-0190-4000-8000-0000000000c2', 'the merge did not move its own thread');

  perform set_config('request.jwt.claims', '{"sub": "7ace0000-0190-4000-8000-0000000000a1", "role": "authenticated"}', true);
  -- Merged and committed: each path is refused in words that name the destination, and nothing is written. (A persona's thread and a direct insert, the two with no check of their own, are the point.)
  went := pg_temp.probe($q$select start_thread('il-src-a', '7ace0000-0190-4000-8000-0000000000b1', 'Il later thread', 'After the merge.')::text$q$);
  perform pg_temp.expect(went like 'refused:%Il Destination A%', 'a start on the merged board was not refused with the destination named: ' || went);
  went := pg_temp.probe($q$select write_staff_thread('il-boss', 'il-src-a', 'Il later staff thread', 'After the merge.')::text$q$);
  perform pg_temp.expect(went like 'refused:%Il Destination A%', 'a persona''s thread onto the merged board was not refused with the destination named: ' || went);
  went := pg_temp.probe($q$insert into threads (board, title) values ('7ace0000-0190-4000-8000-0000000000c1', 'Il direct thread')$q$);
  perform pg_temp.expect(went like 'refused:%Il Destination A%', 'an insert onto the merged board was not refused with the destination named: ' || went);
  -- A spin from a post that moved with the merge opens on the destination.
  went := pg_temp.probe(format($q$select spin_written(%L, '7ace0000-0190-4000-8000-0000000000b1', 'Il later spin', 'After the merge.', false, '{}')::text$q$, origin),
                        $q$select t.board::text from threads t where t.title = 'Il later spin'$q$);
  perform pg_temp.expect(went = 'ok:7ace0000-0190-4000-8000-0000000000c2', 'a spin from a post that moved with the merge did not open on the destination: ' || went);
  -- The import writes in the replica role, which carries threads as they were exported: the guard is not in its way.
  begin
    set local session_replication_role = replica;
    insert into threads (board, origin_board, title) values ('7ace0000-0190-4000-8000-0000000000c1', '7ace0000-0190-4000-8000-0000000000c1', 'Il imported thread');
    raise exception 'imported' using errcode = 'RB001';
  exception when sqlstate 'RB001' then null;
  end;
end $$;

-- ---- 2. Case (b): an admin reverses the moveThread that sent thread B2 away from its origin, while the tick lands a merge of that origin. The reversal waits for the merge, then rebuilds from it ----
-- The merge's Act goes to The System's second thread and the moveThread's end to the first (the fixture's setting), so no row lock between them serializes the two: only the keys do (F12; the first version of
-- this case wrote both into one thread, and stayed green with every key removed).
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  move uuid := (select q.landed_act from queued_moves q where q.kind = 'moveThread');
  waited text;
  ended text;
begin
  perform pg_temp.expect(move is not null, 'the moveThread of the fixture did not land');
  perform tests.commit($sql$
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'mergeBoard', '{"board": "7ace0000-0190-4000-8000-0000000000c5", "into": "7ace0000-0190-4000-8000-0000000000c6"}', 'because', now() - interval '1 minute', true from meetings;
  $sql$);
  perform extensions.dblink_connect('tick', url);
  perform extensions.dblink_connect('admin', url);
  perform extensions.dblink_exec('tick', 'begin');
  perform * from extensions.dblink('tick', 'select system_tick()::text') as x(r text);
  perform pg_temp.expect((select count(*) from extensions.dblink('tick', $q$select 1 from queued_moves where kind = 'mergeBoard' and landed_act is not null$q$) as x(a int)) = 2, 'the tick did not land the second merge');
  perform extensions.dblink_exec('admin', 'begin');
  perform extensions.dblink_send_query('admin', format($q$select end_move(%L, 'reversed', 'admin')::text$q$, move));
  waited := pg_temp.wait_lock('%end_move%reversed%');
  raise notice 'the reversal, while the merge was open, was waiting on %', waited;
  perform extensions.dblink_exec('tick', 'commit');
  select string_agg(r, '') into ended from extensions.dblink_get_result('admin') as x(r text);
  perform pg_temp.drain('admin');
  perform extensions.dblink_exec('admin', 'commit');
  perform extensions.dblink_disconnect('tick');
  perform extensions.dblink_disconnect('admin');

  perform pg_temp.expect(ended like '%"ended": true%', 'the reversal did not end the move: ' || coalesce(ended, 'nothing'));
  perform pg_temp.expect(waited = 'Lock:advisory', 'the reversal did not wait on the merge''s key: ' || coalesce(waited, 'it did not wait'));
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), format('after the reversal and the merge, %s thread(s) are not on their place', (select count(*) from thread_places_drift())));
  perform pg_temp.expect(board_closed_to((select board from threads where title = 'Il thread B2')) is null, 'thread B2 was left on a closed board: ' || (select b.slug from threads t join boards b on b.id = t.board where t.title = 'Il thread B2'));
  perform pg_temp.expect((select board from threads where title = 'Il thread B2') = '7ace0000-0190-4000-8000-0000000000c6', 'thread B2 is not on the destination of the merge of its origin');
end $$;

-- ---- 3. Every rebuild takes the one global key: a second rebuild waits for the first to commit (two overlapping ones deadlocked on post_search rows before) ----
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  waited text;
begin
  perform extensions.dblink_connect('first', url);
  perform extensions.dblink_connect('second', url);
  perform extensions.dblink_exec('first', 'begin');
  perform * from extensions.dblink('first', $q$select rebuild_thread_places(array['7ace0000-0190-4000-8000-000000000a01']::uuid[])::text$q$) as x(r text);
  perform extensions.dblink_send_query('second', $q$select rebuild_thread_places(array['7ace0000-0190-4000-8000-000000000b01']::uuid[])::text$q$);
  waited := pg_temp.wait_lock('%rebuild_thread_places%b01%');
  perform extensions.dblink_exec('first', 'commit');
  perform * from extensions.dblink_get_result('second') as x(r text);
  perform pg_temp.drain('second');
  perform extensions.dblink_disconnect('first');
  perform extensions.dblink_disconnect('second');
  perform pg_temp.expect(waited = 'Lock:advisory', 'a second rebuild did not wait on the first: ' || coalesce(waited, 'it was not running'));
end $$;

-- ---- 3b. F13: one lock order. The tick has landed a move that is not lasting (its Act is in The System's thread, a row it holds to the end), and has a lasting one still to land; an admin reverses a moveThread whose end goes into the same thread ----
-- Before, the tick took the global key only at its first lasting landing, after it had written into that thread, while end_move takes the key first and the thread's row second: the tick waited for the admin's key,
-- the admin for the tick's row, and one of them was killed as a deadlock victim. Now the tick takes the key first, once, before it lands anything, and the admin waits at the key holding nothing.
-- The tick is held between its two landings by a gate (an advisory lock this file's other session holds, taken by a trigger on the one move that is not lasting), so the interleaving is the same every run.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  move uuid;
  waited_tick text;
  waited_admin text;
  tick_out text := 'no error';
  admin_out text := 'no error';
  ended text;
begin
  perform tests.commit($sql$
    -- A moveThread that lands in the second announcements thread, the one The System speaks in now.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'moveThread', '{"thread": "7ace0000-0190-4000-8000-000000000d01", "board": "7ace0000-0190-4000-8000-0000000000c3"}', 'because', now() - interval '3 minutes', false from meetings;
    do $d$ begin perform system_tick(); end $d$;
    create function public.il_gate() returns trigger language plpgsql as $f$ begin perform pg_advisory_xact_lock(hashtext('il.gate')); return new; end $f$;
    create trigger zz_il_gate before insert on acts for each row when (new.kind = 'move' and new.payload ->> 'kind' = 'ilWait') execute function public.il_gate();
    -- Due now, in this order: the move that is not lasting, then the merge.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'ilWait', '{}', 'because', now() - interval '2 minutes', false from meetings;
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'mergeBoard', '{"board": "7ace0000-0190-4000-8000-0000000000cb", "into": "7ace0000-0190-4000-8000-0000000000cc"}', 'because', now() - interval '1 minute', true from meetings;
  $sql$);
  move := (select q.landed_act from queued_moves q where q.kind = 'moveThread' and q.params ->> 'thread' = '7ace0000-0190-4000-8000-000000000d01');
  perform pg_temp.expect(move is not null, 'the second moveThread did not land');
  perform pg_temp.expect((select a.thread from acts a where a.id = move) = '7ace0000-0190-4000-8000-000000000e02', 'the second moveThread did not land in the second announcements thread');
  perform pg_temp.expect((select board from threads where title = 'Il thread D1') = '7ace0000-0190-4000-8000-0000000000c3', 'thread D1 did not move');

  perform extensions.dblink_connect('gate', url);
  perform extensions.dblink_connect('tick', url);
  perform extensions.dblink_connect('admin', url);
  perform extensions.dblink_exec('gate', 'begin');
  perform * from extensions.dblink('gate', $q$select pg_advisory_xact_lock(hashtext('il.gate'))::text$q$) as x(r text);
  perform extensions.dblink_exec('tick', 'begin');
  perform extensions.dblink_send_query('tick', 'select system_tick()::text');
  -- The tick has landed the move that is not lasting (its Act holds the thread's row) and waits at the gate.
  waited_tick := pg_temp.wait_lock('%system_tick()%');
  perform pg_temp.expect(waited_tick = 'Lock:advisory', 'the tick did not stop at the gate: ' || coalesce(waited_tick, 'it did not wait'));
  perform extensions.dblink_exec('admin', 'begin');
  perform extensions.dblink_send_query('admin', format($q$select end_move(%L, 'reversed', 'admin')::text$q$, move));
  waited_admin := pg_temp.wait_lock('%end_move%reversed%');
  raise notice 'the tick waited on %, the reversal, with the tick holding the thread, on %', waited_tick, waited_admin;
  -- The gate opens. The tick goes on to the merge.
  perform extensions.dblink_exec('gate', 'commit');
  begin
    perform * from extensions.dblink_get_result('tick') as x(r text);
  exception when others then
    tick_out := sqlerrm;
  end;
  perform pg_temp.drain('tick');
  perform extensions.dblink_exec('tick', case when tick_out = 'no error' then 'commit' else 'rollback' end);
  begin
    select string_agg(r, '') into ended from extensions.dblink_get_result('admin') as x(r text);
  exception when others then
    admin_out := sqlerrm;
  end;
  perform pg_temp.drain('admin');
  perform extensions.dblink_exec('admin', case when admin_out = 'no error' then 'commit' else 'rollback' end);
  perform extensions.dblink_disconnect('gate');
  perform extensions.dblink_disconnect('tick');
  perform extensions.dblink_disconnect('admin');
  -- Put out for the rest of the suite. It cannot be dropped from here: this file's own transaction has read acts, and a drop waits for it; the scratch database takes it with it.
  perform tests.commit($sql$ alter table acts disable trigger zz_il_gate; $sql$);

  perform pg_temp.expect(waited_admin = 'Lock:advisory', 'the reversal did not wait on the tick''s global key, holding nothing: ' || coalesce(waited_admin, 'it did not wait'));
  perform pg_temp.expect(tick_out = 'no error' and admin_out = 'no error', format('a deadlock between the tick and the reversal: the tick said "%s", the reversal said "%s"', tick_out, admin_out));
  perform pg_temp.expect((select q.landed_act is not null and q.failure is null from queued_moves q where q.kind = 'mergeBoard' and q.params ->> 'board' = '7ace0000-0190-4000-8000-0000000000cb') is true,
    'the tick did not land the merge: ' || coalesce((select q.failure from queued_moves q where q.kind = 'mergeBoard' and q.params ->> 'board' = '7ace0000-0190-4000-8000-0000000000cb'), 'no failure recorded'));
  perform pg_temp.expect(ended like '%"ended": true%', 'the reversal did not end the move: ' || coalesce(ended, 'nothing'));
  perform pg_temp.expect((select board from threads where title = 'Il thread D1') = '7ace0000-0190-4000-8000-0000000000c4', 'the reversal did not put thread D1 back');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), format('%s thread(s) are not on their place', (select count(*) from thread_places_drift())));
end $$;

-- ---- 4. F9: a reply that holds its thread's row while the merge rewrites the search copy leaves its own search row on the board the thread left, unless the rebuild rewrites it once the thread has moved ----
-- The merge of source F is in force and its rebuild has not run (the state a landed merge leaves, written directly); a reply is written and not committed; the rebuild runs and waits on the thread's row.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
begin
  perform tests.commit($sql$
    set local session_replication_role = replica;
    insert into acts (id, character, kind, thread, payload, seq, created_at)
      values ('7ace0000-0190-4000-8000-0000000000d9', '7ace0000-0190-4000-8000-0000000000b1', 'move', '7ace0000-0190-4000-8000-000000000f01',
              '{"kind": "mergeBoard", "body": "Merged.", "params": {"board": "7ace0000-0190-4000-8000-0000000000c7", "into": "7ace0000-0190-4000-8000-0000000000c8"}}', 3, now());
    insert into open_moves (move_act, landed_at) values ('7ace0000-0190-4000-8000-0000000000d9', now());
    update threads set next_seq = 4 where id = '7ace0000-0190-4000-8000-000000000f01';
  $sql$);
  perform extensions.dblink_connect('replier', url);
  perform extensions.dblink_connect('merger', url);
  perform extensions.dblink_exec('replier', 'begin');
  perform extensions.dblink_exec('replier', $q$insert into acts (character, kind, thread, payload) values ('7ace0000-0190-4000-8000-0000000000b1', 'post', '7ace0000-0190-4000-8000-000000000f01', '{"body": "Il late reply"}')$q$);
  perform extensions.dblink_send_query('merger', $q$select rebuild_thread_places(array['7ace0000-0190-4000-8000-000000000f01', '7ace0000-0190-4000-8000-000000000f02']::uuid[])::text$q$);
  -- The merger waits on the reply's row (the thread's): polled, not slept.
  perform pg_temp.expect(pg_temp.wait_lock('%rebuild_thread_places%f01%') is not null, 'the rebuild did not wait on the reply that holds its thread');
  perform extensions.dblink_exec('replier', 'commit');
  perform * from extensions.dblink_get_result('merger') as x(r text);
  perform pg_temp.drain('merger');
  perform extensions.dblink_disconnect('replier');
  perform extensions.dblink_disconnect('merger');
  perform pg_temp.expect((select count(*) from post_search p join threads t on t.id = p.thread where t.title like 'Il thread F%') = 5, 'the reply did not make its search row: ' || (select count(*) from post_search p join threads t on t.id = p.thread where t.title like 'Il thread F%'));
  perform pg_temp.expect(not exists (select 1 from post_search p join threads t on t.id = p.thread where t.title like 'Il thread F%' and p.board is distinct from t.board),
    format('%s search row(s) of the moved threads are on a board their thread left', (select count(*) from post_search p join threads t on t.id = p.thread where t.title like 'Il thread F%' and p.board is distinct from t.board)));
  perform pg_temp.expect((select board from threads where title = 'Il thread F1') = '7ace0000-0190-4000-8000-0000000000c8', 'thread F1 did not move');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after the rebuild');
end $$;

-- ---- 5. F11: a spin from The System's board opens on the first open board, not the oldest one: the oldest is merged away, and the thread must not land on a board no page lists ----
do $$
declare
  origin uuid := '7ace0000-0190-4000-8000-0000000000d1';
  opened text;
begin
  perform tests.commit($sql$
    -- A post of The System's, in its first announcements thread (written directly, in the replica role, as the fixture's posts are).
    set local session_replication_role = replica;
    insert into acts (id, character, kind, thread, payload, seq, created_at)
      select '7ace0000-0190-4000-8000-0000000000d1', '7ace0000-0190-4000-8000-0000000000f1', 'post', t.id, '{"body": "Il words of The System"}', t.next_seq, now() from threads t where t.id = '7ace0000-0190-4000-8000-000000000e01';
    update threads set next_seq = next_seq + 1 where id = '7ace0000-0190-4000-8000-000000000e01';
    set local session_replication_role = origin;
    -- The oldest board, merged away: the tick lands it and commits.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'mergeBoard', '{"board": "7ace0000-0190-4000-8000-0000000000c9", "into": "7ace0000-0190-4000-8000-0000000000ca"}', 'because', now() - interval '1 minute', true from meetings;
    do $d$ begin perform system_tick(); end $d$;
  $sql$);
  perform pg_temp.expect(board_closed_to('7ace0000-0190-4000-8000-0000000000c9') is not null, 'the oldest board was not merged away');
  perform pg_temp.expect((select b.is_system from threads t join boards b on b.id = t.board join acts a on a.thread = t.id where a.id = origin), 'the post is not on The System''s board');
  opened := pg_temp.probe(format($q$select spin_written(%L, '7ace0000-0190-4000-8000-0000000000b1', 'Il spun from the System', 'Spun from what it said.', false, '{}')::text$q$, origin),
                          $q$select t.board::text from threads t where t.title = 'Il spun from the System'$q$);
  perform pg_temp.expect(opened like 'ok:%', 'a spin from a post of The System''s was refused: ' || opened);
  perform pg_temp.expect(board_closed_to(substr(opened, 4)::uuid) is null, 'a spin from a post of The System''s opened its thread on a closed board: ' || coalesce((select b.slug from boards b where b.id = substr(opened, 4)::uuid), opened));
  perform pg_temp.expect(substr(opened, 4)::uuid = first_open_board(), 'a spin from a post of The System''s did not open on the first open board');
  perform pg_temp.expect(players_board() = first_open_board(), 'players_board is not the first open board');
  -- The pool's list of boards, which a persona's thread is aimed at, leaves out a closed board.
  perform pg_temp.expect(not (pool_context() -> 'boards' ? '7ace0000-0190-4000-8000-0000000000c9'), 'the pool lists a closed board');
  perform pg_temp.expect(pool_context() -> 'boards' ? '7ace0000-0190-4000-8000-0000000000ca', 'the pool does not list an open board');
end $$;

-- ---- 6. The file takes its rows out, in the replica role (which turns off the foreign keys), with the Acts' append-only guard off for this one transaction of a session of its own; what it borrowed is put back as it was ----
do $$
begin
  perform tests.commit($sql$
    set local session_replication_role = replica;
    delete from post_search where thread in (select id from threads where title like 'Il %');
    alter table thread_departures disable trigger thread_departures_fixed;
    delete from thread_departures where thread in (select id from threads where title like 'Il %');
    alter table thread_departures enable trigger thread_departures_fixed;
    delete from character_post_counts_base where character in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000f1');
    delete from open_moves where move_act in (select a.id from acts a where a.thread in (select id from threads where title like 'Il %') and a.kind = 'move');
    delete from move_dependencies where act in (select a.id from acts a where a.thread in (select id from threads where title like 'Il %'));
    alter table acts disable trigger acts_no_update;
    delete from acts where thread in (select id from threads where title like 'Il %') or character in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000f1');
    alter table acts enable trigger acts_no_update;
    delete from queued_moves where staff = 'il-boss';
    alter table meetings disable trigger meetings_no_update;
    delete from meetings m where not exists (select 1 from queued_moves q where q.meeting = m.id) and m.started_at = '2001-02-03T04:05:06Z';
    alter table meetings enable trigger meetings_no_update;
    delete from threads where title like 'Il %';
    delete from board_thread_counts where board in (select id from boards where slug like 'il-%');
    -- The System board's counts, which the announcements threads above were counted on (0030's insert trigger) and the delete above does not take back, as they were (F15).
    update board_thread_counts set threads = 0 where board = (select id from boards where is_system);
    delete from boards where slug like 'il-%';
    delete from standings where character in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000f1');
    delete from class_history where character in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2');
    delete from characters where id in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000f1');
    delete from accounts where id = '7ace0000-0190-4000-8000-0000000000a1';
    delete from auth.users where id = '7ace0000-0190-4000-8000-0000000000a1';
  $sql$);
  perform tests.commit(
    -- The borrowed rows: each put back as it was, or taken out where there was none.
    (select string_agg(case when p.value is null then format('delete from settings where key = %L;', k.key)
                            else format('update settings set value = %L::jsonb where key = %L;', p.value, k.key) end, ' ')
     from (values ('systemEnabled'), ('systemAnnouncements')) k(key) left join prior p on p.what = 'setting ' || k.key)
    || ' ' ||
    (select string_agg(case when p.value is null then format('delete from move_kinds where key = %L;', k.key)
                            else format('update move_kinds set structural = %L, shapes_board = %L, lasting = %L where key = %L;', p.value ->> 'structural', p.value ->> 'shapes_board', p.value ->> 'lasting', k.key) end, ' ')
     from (values ('createBoard'), ('mergeBoard'), ('moveThread'), ('ilWait')) k(key) left join prior p on p.what = 'kind ' || k.key)
    || ' ' ||
    coalesce((select string_agg(format('update board_thread_counts set threads = %s where board = (select id from boards where is_system) and shard = %s;', p.value ->> 'threads', p.value ->> 'shard'), ' ') from prior p where p.what like 'count shard %'), '')
    -- The count of debuted characters (0030) moved with the two masks' debuts; it goes back to the shards it had.
    || ' delete from debuted_count; ' ||
    coalesce((select string_agg(format('insert into debuted_count (shard, characters) values (%s, %s);', p.value ->> 'shard', p.value ->> 'characters'), ' ') from prior p where p.what like 'debuted shard %'), '')
    || ' ' || format('update seasons set boss = %L where ends_at is null and boss = ''il-boss'';', (select p.value #>> '{}' from prior p where p.what = 'boss')));
end $$;

-- The System board's counts are what they were before this file (F15): the announcements threads it made were counted, and taking them out must not leave the board one or two too high.
do $$
begin
  perform pg_temp.expect((select coalesce(sum(c.threads), 0) from board_thread_counts c where c.board = (select id from boards where is_system))
    = (select coalesce(sum((p.value ->> 'threads')::integer), 0) from prior p where p.what like 'count shard %'),
    format('the System board is counted as %s threads, and had %s', (select coalesce(sum(c.threads), 0) from board_thread_counts c where c.board = (select id from boards where is_system)),
           (select coalesce(sum((p.value ->> 'threads')::integer), 0) from prior p where p.what like 'count shard %')));
end $$;
