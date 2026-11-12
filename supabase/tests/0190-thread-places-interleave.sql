-- Place writers wait for each other (supabase/migrations/0235_thread_places_at_scale.sql, with 0216, 0218, 0222, 0225 and 0230; final review of PR #450, findings F7 and F9).
--
-- rebuild_thread_places computes places from the Acts its own snapshot can see, and the writers that change a place did not wait for each other: start_thread, the tick's landing of a lasting move, and
-- end_move of one. Two interleavings left a thread on a closed board that no board page lists, with no way back:
--   (a) a thread started on board S while the tick had landed, and not yet committed, a merge of S into D: not_closed(S) passes (the merge is not committed), the thread is stored on S, and the merge's
--       rebuild never saw it;
--   (b) an admin's reversal of a moveThread that committed while the tick landed a merge of the thread's origin board: the reversal's rebuild cannot see the merge and puts the thread back on the
--       board the merge closed.
-- And (F9) a reply that took its thread's row after the merge rewrote post_search.board, and before it updated threads.board, inserted its search row with the old board, and nothing rewrote it.
--
-- The fix is locks, held to commit: one global exclusive key for everything that writes a place (the tick before it lands a lasting move, end_move of a lasting kind, every rebuild), and per board a
-- key a merge, or a reversed createBoard, takes exclusively for the board it closes, and start_thread takes shared before it asks whether the board is closed. So a start waits only while a closing
-- move on its own board is open, and then it sees the move and is refused in words that name where the threads went; starts on a board nobody is closing never wait.
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

-- What a connection that has been sent a query is waiting on, as pg_stat_activity says, after a moment for it to get there.
create function pg_temp.waiting_on(like_query text) returns text language plpgsql as $$
begin
  perform pg_sleep(0.7);
  -- The activity view is read once a transaction; the test's is one transaction, so each look starts from a fresh one.
  perform pg_stat_clear_snapshot();
  return (select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') from pg_stat_activity where query like like_query and pid <> pg_backend_pid() and state = 'active' limit 1);
end $$;

-- What the files before this one left in the rows this file borrows (a committing test leaves its settings behind), put back when it is done.
create temp table prior (what text primary key, value jsonb);

-- ---- 0. The world: a player with a mask, a Boss with the season, the three lasting kinds, and boards in pairs (a case's source and destination), made newer than the first open board so no merge here moves it ----
do $$
begin
  insert into prior select 'setting ' || s.key, s.value from settings s where s.key in ('systemEnabled', 'systemAnnouncements');
  insert into prior select 'debuted shard ' || d.shard, to_jsonb(d) from debuted_count d;
  insert into prior select 'boss', to_jsonb(boss) from seasons where ends_at is null and boss is not null;
  insert into prior select 'kind ' || k.key, to_jsonb(k) from move_kinds k where k.key in ('createBoard', 'mergeBoard', 'moveThread');
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
      ('7ace0000-0190-4000-8000-0000000000c8', 'il-dst-f', 'Il Destination F', now() + interval '8 days');
    insert into threads (id, board, title) values
      ('7ace0000-0190-4000-8000-000000000a01', '7ace0000-0190-4000-8000-0000000000c1', 'Il thread A1'),
      ('7ace0000-0190-4000-8000-000000000b01', '7ace0000-0190-4000-8000-0000000000c5', 'Il thread B1'),
      ('7ace0000-0190-4000-8000-000000000b02', '7ace0000-0190-4000-8000-0000000000c5', 'Il thread B2'),
      ('7ace0000-0190-4000-8000-000000000f01', '7ace0000-0190-4000-8000-0000000000c7', 'Il thread F1'),
      ('7ace0000-0190-4000-8000-000000000f02', '7ace0000-0190-4000-8000-0000000000c7', 'Il thread F2'),
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
    insert into meetings (started_at, slot, finished_at, outcome) values ('2001-02-03T04:05:06Z', clock_timestamp(), '2001-02-03T04:06:06Z', 'ok');
    -- The moveThread of case (b), landed and committed now: thread B2 goes to Il Moved To.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'moveThread', '{"thread": "7ace0000-0190-4000-8000-000000000b02", "board": "7ace0000-0190-4000-8000-0000000000c3"}', 'because', now() - interval '1 minute', false from meetings;
    do $d$ begin perform system_tick(); end $d$;
    -- The merge of case (a), waiting for a tick.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural)
      select max(id), 'il-boss', 'mergeBoard', '{"board": "7ace0000-0190-4000-8000-0000000000c1", "into": "7ace0000-0190-4000-8000-0000000000c2"}', 'because', now() - interval '1 minute', true from meetings;
  $sql$);
  perform pg_temp.expect((select board from threads where title = 'Il thread B2') = '7ace0000-0190-4000-8000-0000000000c3', 'the fixture did not move thread B2 to the board it was sent to');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'the fixture starts with drift');
end $$;

-- ---- 1. Case (a): a thread is started on the board while the tick has landed, and not committed, a merge of it. The start waits for the merge, then sees it and is refused in words that name where the threads went ----
-- A start on a board nobody is closing does not wait at all, while the merge is open.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  waited text;
  outcome text := 'no refusal';
  started boolean := false;
  t0 timestamptz;
  quick interval;
begin
  perform extensions.dblink_connect('tick', url);
  perform extensions.dblink_connect('starter', url);
  perform extensions.dblink_connect('other', url);
  perform extensions.dblink_exec('tick', 'begin');
  perform * from extensions.dblink('tick', 'select system_tick()::text') as x(r text);
  perform pg_temp.expect((select count(*) from extensions.dblink('tick', $q$select landed_act::text from queued_moves where kind = 'mergeBoard' and landed_act is not null$q$) as x(a text)) = 1, 'the tick did not land the merge');

  -- The start on the closing board: sent, then given a moment to get to its check.
  perform pg_temp.player('starter');
  perform extensions.dblink_exec('starter', $q$set local lock_timeout = '20s'$q$);
  perform extensions.dblink_send_query('starter', $q$select start_thread('il-src-a', '7ace0000-0190-4000-8000-0000000000b1', 'Il late thread', 'Started while the merge lands.')::text$q$);
  waited := pg_temp.waiting_on('%Il late thread%');

  -- A start on a board the merge does not touch, with the merge still open: it must not wait for it.
  perform pg_temp.player('other');
  perform extensions.dblink_exec('other', $q$set local lock_timeout = '2s'$q$);
  t0 := clock_timestamp();
  perform * from extensions.dblink('other', $q$select start_thread('il-else', '7ace0000-0190-4000-8000-0000000000b2', 'Il unrelated thread', 'No merge here.')::text$q$) as x(r text);
  quick := clock_timestamp() - t0;
  perform extensions.dblink_exec('other', 'commit');
  raise notice 'a start on another board took % while the merge was open; the start on the closing board was waiting on %', quick, waited;
  perform pg_temp.expect(quick < interval '1 second', format('a start on a board nobody is closing waited %s for a merge of another', quick));

  -- The merge commits; the start on the closing board goes on, and is refused or lands on the destination.
  perform extensions.dblink_exec('tick', 'commit');
  begin
    perform * from extensions.dblink_get_result('starter') as x(r text);
    started := true;
  exception when others then
    outcome := sqlerrm;
  end;
  perform pg_temp.drain('starter');
  perform extensions.dblink_exec('starter', case when started then 'commit' else 'rollback' end);
  perform extensions.dblink_disconnect('tick');
  perform extensions.dblink_disconnect('starter');
  perform extensions.dblink_disconnect('other');

  perform pg_temp.expect(not exists (select 1 from thread_places_drift()),
    format('a thread started while the merge landed is on a board that is not its place: %s thread(s) drift (start %s: %s)', (select count(*) from thread_places_drift()), case when started then 'went through' else 'refused' end, outcome));
  if started then
    perform pg_temp.expect((select board from threads where title = 'Il late thread') = '7ace0000-0190-4000-8000-0000000000c2', 'the thread started on the merged board is not on its destination');
  else
    perform pg_temp.expect(outcome like '%Il Destination A%', 'the refusal does not name where the threads went: ' || outcome);
    perform pg_temp.expect(not exists (select 1 from threads where title = 'Il late thread'), 'a refused start left a thread');
  end if;
  perform pg_temp.expect((select board from threads where title = 'Il unrelated thread') = '7ace0000-0190-4000-8000-0000000000c4', 'the start on the other board did not land');
  perform pg_temp.expect((select board from threads where title = 'Il thread A1') = '7ace0000-0190-4000-8000-0000000000c2', 'the merge did not move its own thread');
end $$;

-- ---- 2. Case (b): an admin reverses the moveThread that sent thread B2 away from its origin, while the tick lands a merge of that origin. The reversal waits for the merge, then rebuilds from it ----
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
  waited := pg_temp.waiting_on('%end_move%reversed%');
  raise notice 'the reversal, while the merge was open, was waiting on %', waited;
  perform extensions.dblink_exec('tick', 'commit');
  select string_agg(r, '') into ended from extensions.dblink_get_result('admin') as x(r text);
  perform pg_temp.drain('admin');
  perform extensions.dblink_exec('admin', 'commit');
  perform extensions.dblink_disconnect('tick');
  perform extensions.dblink_disconnect('admin');

  perform pg_temp.expect(ended like '%"ended": true%', 'the reversal did not end the move: ' || coalesce(ended, 'nothing'));
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
  waited := pg_temp.waiting_on('%rebuild_thread_places%b01%');
  perform extensions.dblink_exec('first', 'commit');
  perform * from extensions.dblink_get_result('second') as x(r text);
  perform pg_temp.drain('second');
  perform extensions.dblink_disconnect('first');
  perform extensions.dblink_disconnect('second');
  perform pg_temp.expect(waited = 'Lock:advisory', 'a second rebuild did not wait on the first: ' || coalesce(waited, 'it was not running'));
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
  perform pg_sleep(0.7);
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

-- ---- 5. The file takes its rows out, in the replica role (which turns off the foreign keys), with the Acts' append-only guard off for this one transaction of a session of its own; what it borrowed is put back as it was ----
do $$
begin
  perform tests.commit($sql$
    set local session_replication_role = replica;
    delete from post_search where thread in (select id from threads where title like 'Il %');
    alter table thread_departures disable trigger thread_departures_fixed;
    delete from thread_departures where thread in (select id from threads where title like 'Il %');
    alter table thread_departures enable trigger thread_departures_fixed;
    delete from character_post_counts where character in ('7ace0000-0190-4000-8000-0000000000b1', '7ace0000-0190-4000-8000-0000000000b2', '7ace0000-0190-4000-8000-0000000000f1');
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
     from (values ('createBoard'), ('mergeBoard'), ('moveThread')) k(key) left join prior p on p.what = 'kind ' || k.key)
    -- The count of debuted characters (0030) moved with the two masks' debuts; it goes back to the shards it had.
    || ' delete from debuted_count; ' ||
    coalesce((select string_agg(format('insert into debuted_count (shard, characters) values (%s, %s);', p.value ->> 'shard', p.value ->> 'characters'), ' ') from prior p where p.what like 'debuted shard %'), '')
    || ' ' || format('update seasons set boss = %L where ends_at is null and boss = ''il-boss'';', (select p.value #>> '{}' from prior p where p.what = 'boss')));
end $$;
