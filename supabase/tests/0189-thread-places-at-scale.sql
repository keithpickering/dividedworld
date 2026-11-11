-- A merge rebuilds its threads in one statement, and the counts follow per statement (supabase/migrations/0192_thread_places_at_scale.sql; final review of PR #450, finding F1).
--
-- Landing a mergeBoard rebuilt every thread of the merged board one thread_place() call at a time, the board count and the search copy each following per row, all inside the tick's one
-- transaction: 32 s for 10,000 threads, and a reply to any thread on that board waited the whole time on a row lock. This builds a board of 5,000 threads with a post each, lands a
-- mergeBoard through system_tick, and asserts that thread_place was not called per thread, that the landing finished under a bound, and that drift, the counts and the search copy
-- agree after the landing, after the reversal and after a rebuild of a few threads (the single-thread path stays per thread).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- ---- 0. The world: a Boss whose seed lists the three kinds as the engine's catalog does; three more boards, oldest first ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'lb-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'lb-boss', 'name', 'Lasting Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into boards (slug, name, created_at) values ('elsewhere', 'Elsewhere', now() - interval '9 days'), ('third', 'Third', now() - interval '8 days'), ('fourth', 'Fourth', now() - interval '7 days');
  update boards set created_at = now() - interval '10 days' where slug = 'general';
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.mk(title text, on_slug text) returns uuid language sql as $$
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id
$$;
create function pg_temp.at(t uuid) returns uuid language sql as $$ select board from threads where id = t $$;
-- A move waiting to land, as apply_meeting queues it (a lasting move is queued with an expiry of 0 hours, which is its go-live, a time the table's own check refuses and the
-- guard drops first): live a minute ago.
create function pg_temp.queue(kind text, params jsonb, wait interval default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'lb-boss', kind, params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0'), kind in ('createBoard', 'mergeBoard')) returning id into q;
  return q;
end $$;
create function pg_temp.land(q bigint) returns uuid language plpgsql as $$
declare
  r queued_moves;
begin
  perform system_tick();
  select * into r from queued_moves where id = q;
  if r.landed_act is null then raise exception 'the move did not land: refused % failure %', r.refused_at, r.failure; end if;
  return r.landed_act;
end $$;
create function pg_temp.reverse(move uuid) returns void language plpgsql as $$
begin
  if not (end_move(move, 'reversed', 'admin') ->> 'ended')::boolean then raise exception 'the move was already ended'; end if;
end $$;
-- The invariant after every case: no drift, and the counts the board pages read agree with the threads on each board (the system board counts 0).
create function pg_temp.settled(what text) returns void language plpgsql as $$
declare
  bad record;
begin
  if exists (select 1 from thread_places_drift()) then raise exception '% left drift: %', what, (select count(*) from thread_places_drift()); end if;
  select b.slug, coalesce(c.threads, 0) as counted, (select count(*) from threads t where t.board = b.id) as there into bad
  from boards b left join board_counts c on c.board = b.id
  where not b.is_system and coalesce(c.threads, 0) <> (select count(*) from threads t where t.board = b.id) limit 1;
  if found then raise exception '% left board_thread_counts off on %: counted %, there %', what, bad.slug, bad.counted, bad.there; end if;
end $$;


-- ---- 1. A busy board: 5,000 threads on one board, a post each, so each has a search row ----
do $$
declare
  c uuid := tests.character(tests.account('scale-player'), 'Scaler');
  src uuid := pg_temp.board('third');
begin
  insert into threads (board, title) select src, 'Thread ' || g from generate_series(1, 5000) g;
  insert into acts (character, kind, thread, payload) select c, 'post', t.id, jsonb_build_object('body', 'Body of ' || t.title) from threads t where t.board = src;
  perform pg_temp.expect((select count(*) from post_search where board = src) = 5000, 'the fixture did not index a post for each of the 5,000 threads');
  perform pg_temp.settled('the fixture');
end $$;

-- ---- 2. thread_place is not called per thread; the landing is under its bound; nothing is left off ----
do $$
declare
  src uuid := pg_temp.board('third');
  dst uuid := pg_temp.board('fourth');
  fn oid := 'thread_place(uuid)'::regprocedure;
  q bigint;
  t0 timestamptz;
  took interval;
  calls bigint;
  bound constant interval := interval '3 seconds';
  mv uuid;
begin
  perform set_config('track_functions', 'all', true);
  perform pg_stat_clear_snapshot();
  q := pg_temp.queue('mergeBoard', jsonb_build_object('board', src, 'into', dst));
  t0 := clock_timestamp();
  mv := pg_temp.land(q);
  took := clock_timestamp() - t0;
  perform pg_stat_clear_snapshot();
  calls := coalesce((select pg_stat_get_xact_function_calls(fn)), 0);
  raise notice 'landing a mergeBoard over 5000 threads took %; thread_place was called % times', took, calls;
  perform pg_temp.expect(calls < 100, format('thread_place was called %s times for a board of 5,000 threads; the rebuild must be one statement', calls));
  perform pg_temp.expect(took < bound, format('landing the merge took %s, over the bound of %s', took, bound));
  perform pg_temp.expect((select count(*) from threads where board = dst) = 5000 and not exists (select 1 from threads where board = src), 'the threads did not all join the other board');
  perform pg_temp.expect(not exists (select 1 from post_search p join threads t on t.id = p.thread where p.board <> t.board), 'a post''s search copy is on a board its thread left');
  perform pg_temp.settled('the merge');

  t0 := clock_timestamp();
  perform pg_temp.reverse(mv);
  took := clock_timestamp() - t0;
  raise notice 'reversing it took %', took;
  perform pg_temp.expect(took < bound, format('reversing the merge took %s, over the bound of %s', took, bound));
  perform pg_temp.expect((select count(*) from threads where board = src) = 5000, 'the reversal did not return the threads');
  perform pg_temp.expect(not exists (select 1 from post_search p join threads t on t.id = p.thread where p.board <> t.board), 'a post''s search copy did not come back with its thread');
  perform pg_temp.settled('the reversal');
end $$;

-- ---- 3. A rebuild of a few threads still reaches the same places as thread_place; the set-based and the single-thread paths agree on a stale row ----
do $$
declare
  src uuid := pg_temp.board('third');
  few uuid[];
  many uuid[];
begin
  select array_agg(id) into few from (select id from threads where board = src limit 5) x;
  select array_agg(id) into many from threads where board = src;
  perform set_config('session_replication_role', 'replica', true);
  update threads set board = pg_temp.board('elsewhere') where id = any (few);
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.expect(rebuild_thread_places(few) = 5, 'the few-thread rebuild did not write the 5 stale rows');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after a few-thread rebuild');
  perform set_config('session_replication_role', 'replica', true);
  update threads set board = pg_temp.board('elsewhere') where id = any (many);
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.expect(rebuild_thread_places(many) = 5000, 'the many-thread rebuild did not write the 5,000 stale rows');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after a many-thread rebuild');
  perform pg_temp.expect(not exists (select 1 from threads t where t.id = any (many) and t.board is distinct from thread_place(t.id)), 'the set-based rebuild and thread_place disagree');
end $$;
