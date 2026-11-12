-- Board stubs, a closed board's page, and starting a thread on one (supabase/migrations/0299_board_stubs.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 3).
--
-- A thread moved away from a board is listed on it for movedStubDays as a stub row, below the board's own threads, with the board it is on now. A closed board answers
-- {closed, mergedInto | fallback} and no threads; the index lists no closed board; and a thread started on a closed board is refused in words that name the board its threads went to.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 0. The world: a Boss that may make, move and merge; four boards beside General; a reader with a character ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'movedStubDays', 7, 'titleMaxLength', 100, 'postMaxLength', 5000,
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'bs-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'bs-boss', 'name', 'Stub Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into boards (slug, name, created_at) values ('bs-one', 'Board One', now() - interval '9 days'), ('bs-two', 'Board Two', now() - interval '8 days'), ('bs-three', 'Board Three', now() - interval '7 days');
  update boards set created_at = now() - interval '10 days' where slug = 'general';
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.reader() returns uuid language sql as $$ select owner from characters where name = 'Stub Reader' $$;
create function pg_temp.mk(title text, on_slug text, by_character uuid) returns uuid language plpgsql as $$
declare t uuid;
begin
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id into t;
  perform tests.post(by_character, t, 'First post of ' || title);
  return t;
end $$;
create function pg_temp.queue(kind text, params jsonb) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'bs-boss', kind, params, null, 'because', now() - interval '1 minute', now() - interval '1 minute', kind in ('createBoard', 'mergeBoard')) returning id into q;
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
-- A page as the signed-in reader reads it.
create function pg_temp.page(slug text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform tests.become(pg_temp.reader());
  j := board_page(slug, 1, array[]::text[]);
  perform tests.unbecome();
  return j;
end $$;
create function pg_temp.stubs(slug text) returns text language sql as $$
  select coalesce(string_agg((s ->> 'title') || '>' || (s ->> 'moved_to_name'), ', ' order by s ->> 'title'), '') from jsonb_array_elements(pg_temp.page(slug) -> 'stubs') s
$$;

do $$
declare
  acct uuid := tests.account('bs-reader');
begin
  perform tests.character(acct, 'Stub Reader');
end $$;

-- ---- 1. A stub: a moved thread is on the board it left, below the board's own threads, with the board it is on now ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  t1 uuid;
  t2 uuid;
  q bigint;
  j jsonb;
begin
  t1 := pg_temp.mk('Wandering thread', 'bs-one', c);
  t2 := pg_temp.mk('Staying thread', 'bs-one', c);
  perform pg_temp.expect(pg_temp.stubs('bs-one') = '', 'a board with no move away lists a stub');
  q := pg_temp.queue('moveThread', jsonb_build_object('thread', t1, 'board', pg_temp.board('bs-two')));
  perform pg_temp.land(q);
  j := pg_temp.page('bs-one');
  perform pg_temp.expect(jsonb_array_length(j -> 'threads') = 1 and j -> 'threads' -> 0 ->> 'id' = t2::text, 'the board still lists a thread that moved away among its own: ' || (j -> 'threads')::text);
  perform pg_temp.expect(pg_temp.stubs('bs-one') = 'Wandering thread>Board Two', 'the board does not list the moved thread as a stub with its board now: ' || coalesce((j -> 'stubs')::text, 'no stubs key'));
  perform pg_temp.expect(j -> 'stubs' -> 0 ->> 'id' = t1::text and j -> 'stubs' -> 0 ->> 'moved_to' = pg_temp.board('bs-two')::text and j -> 'stubs' -> 0 ->> 'moved_to_slug' = 'bs-two' and j -> 'stubs' -> 0 ->> 'moved_at' is not null,
    'the stub row lacks the thread, its board now or when it moved: ' || coalesce((j -> 'stubs' -> 0)::text, 'none'));
  perform pg_temp.expect((j ->> 'total')::integer = 1, 'the total counts a stub');
  -- The board it went to lists it as its own thread and no stub.
  j := pg_temp.page('bs-two');
  perform pg_temp.expect(j -> 'threads' -> 0 ->> 'id' = t1::text and pg_temp.stubs('bs-two') = '', 'the board it moved to does not list it as its own, alone');

  -- After movedStubDays it is no longer listed (the move is older than the window).
  -- (The row is insert-only, enabled always; the test lifts the guard to age the move, and puts it back.)
  perform pg_temp.expect(pg_temp.refusal(format('update thread_departures set left_at = now() - interval %L where thread = %L', '8 days', t1)) like 'P0001%', 'a departure row was changed');
  alter table thread_departures disable trigger thread_departures_fixed;
  update thread_departures set left_at = now() - interval '8 days' where thread = t1;
  alter table thread_departures enable always trigger thread_departures_fixed;
  perform pg_temp.expect(pg_temp.stubs('bs-one') = '', 'a stub is listed past movedStubDays');
  alter table thread_departures disable trigger thread_departures_fixed;
  update thread_departures set left_at = now() - interval '6 days' where thread = t1;
  alter table thread_departures enable always trigger thread_departures_fixed;
  perform pg_temp.expect(pg_temp.stubs('bs-one') = 'Wandering thread>Board Two', 'a stub inside movedStubDays is not listed');
end $$;

-- ---- 2. A reversal takes the stub away; a second move leaves a stub on each board it left, each saying where the thread is now ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  t uuid;
  q bigint;
  mv uuid;
begin
  t := pg_temp.mk('Twice moved', 'bs-one', c);
  mv := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('bs-two'))));
  perform pg_temp.expect(pg_temp.stubs('bs-one') like '%Twice moved>Board Two%', 'no stub after the first move');
  perform end_move(mv, 'reversed', 'admin');
  perform pg_temp.expect(pg_temp.stubs('bs-one') not like '%Twice moved%', 'a reversed move leaves a stub (the thread is back where it was)');
  perform pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('bs-two'))));
  perform pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('bs-three'))));
  perform pg_temp.expect(pg_temp.stubs('bs-one') like '%Twice moved>Board Three%', 'the first board does not say where the thread is now: ' || pg_temp.stubs('bs-one'));
  perform pg_temp.expect(pg_temp.stubs('bs-two') like '%Twice moved>Board Three%', 'the second board lists no stub: ' || pg_temp.stubs('bs-two'));
  perform pg_temp.expect(pg_temp.stubs('bs-three') not like '%Twice moved%', 'the board it is on lists a stub of it');
end $$;

-- ---- 3. A merged board is closed: {closed, mergedInto}, no threads, no stubs; the index leaves it out; a thread cannot be started on it ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  t uuid;
  j jsonb;
  seen jsonb;
  msg text;
  g uuid := pg_temp.board('general');
begin
  t := pg_temp.mk('Merged with the board', 'bs-three', c);
  perform pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('bs-three'), 'into', g)));
  j := pg_temp.page('bs-three');
  perform pg_temp.expect((j ->> 'closed')::boolean, 'a merged board does not answer closed: ' || j::text);
  perform pg_temp.expect(j -> 'mergedInto' ->> 'id' = g::text and j -> 'mergedInto' ->> 'slug' = 'general' and j -> 'mergedInto' ->> 'name' = 'General', 'a merged board does not name the board it went into: ' || coalesce((j -> 'mergedInto')::text, 'none'));
  perform pg_temp.expect(j -> 'fallback' is null or j -> 'fallback' = 'null'::jsonb, 'a merged board also names a fallback');
  perform pg_temp.expect(jsonb_array_length(j -> 'threads') = 0 and jsonb_array_length(j -> 'stubs') = 0 and (j ->> 'total')::integer = 0 and j -> 'board' ->> 'slug' = 'bs-three', 'a closed board lists threads or stubs: ' || j::text);
  perform pg_temp.expect(pg_temp.page('bs-one') ->> 'closed' is null or pg_temp.page('bs-one') ->> 'closed' = 'false', 'an open board answers closed');
  perform pg_temp.expect(coalesce(pg_temp.page('bs-one') -> 'mergedInto', 'null'::jsonb) = 'null'::jsonb, 'an open board names a merge');
  perform pg_temp.expect(j ? 'unread' and j ? 'presence', 'a closed board''s page lacks the keys the screen reads');
  -- The index.
  perform tests.become(pg_temp.reader());
  seen := index_page() -> 'boards';
  perform tests.unbecome();
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(seen) b where b ->> 'slug' = 'bs-one') and not exists (select 1 from jsonb_array_elements(seen) b where b ->> 'slug' = 'bs-three'),
    'the index lists a closed board or leaves out an open one: ' || (select string_agg(b ->> 'slug', ',') from jsonb_array_elements(seen) b));
  -- Starting a thread.
  perform tests.become(pg_temp.reader());
  msg := pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'bs-three', c, 'Too late', 'Hello.'));
  perform tests.unbecome();
  perform pg_temp.expect(msg is not null and msg like '%General%' and msg like '%merged%', 'starting a thread on a merged board is not refused naming General: ' || coalesce(msg, 'allowed'));
  perform pg_temp.expect(not exists (select 1 from threads where title = 'Too late'), 'the refused thread was written');
  -- An open board still takes one.
  perform tests.become(pg_temp.reader());
  perform start_thread('bs-one', c, 'Still works', 'Hello.');
  perform tests.unbecome();
end $$;

-- ---- 4. A board whose making was reversed is closed too, and says where its threads went (its fallback, else the first open board) ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  made uuid;
  mk uuid;
  j jsonb;
  msg text;
begin
  mk := pg_temp.land(pg_temp.queue('createBoard', jsonb_build_object('name', 'Short Lived', 'premise', 'Briefly.', 'description', 'Not for long.', 'fallback', pg_temp.board('bs-two'))));
  select id into made from boards where created_by_act = mk;
  perform end_move(mk, 'reversed', 'admin');
  j := pg_temp.page('short-lived');
  perform pg_temp.expect((j ->> 'closed')::boolean and j -> 'fallback' ->> 'id' = pg_temp.board('bs-two')::text and j -> 'fallback' ->> 'name' = 'Board Two', 'a reversed creation does not answer closed with its fallback: ' || j::text);
  perform pg_temp.expect(coalesce(j -> 'mergedInto', 'null'::jsonb) = 'null'::jsonb, 'a reversed creation names a merge');
  perform tests.become(pg_temp.reader());
  msg := pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'short-lived', c, 'Nowhere', 'Hello.'));
  perform tests.unbecome();
  perform pg_temp.expect(msg like '%Board Two%' and msg like '%closed%', 'starting a thread on a closed made board does not name its fallback: ' || coalesce(msg, 'allowed'));
  -- No fallback: the first open board of the players.
  mk := pg_temp.land(pg_temp.queue('createBoard', jsonb_build_object('name', 'Short Lived Too', 'premise', 'Briefly.', 'description', 'Not for long.')));
  perform end_move(mk, 'reversed', 'admin');
  j := pg_temp.page('short-lived-too');
  perform pg_temp.expect((j ->> 'closed')::boolean and j -> 'fallback' ->> 'id' = first_open_board()::text, 'a closed board with no fallback does not name the first open board: ' || j::text);
end $$;

-- ---- 5. A board that does not exist is still null; a closed board's page is still read only by a signed-in player ----
do $$
begin
  perform pg_temp.expect(pg_temp.page('no-such-board') is null, 'a missing board is not null');
  perform tests.become_anon();
  perform pg_temp.expect(pg_temp.refusal($q$select board_page('bs-three', 1, array[]::text[])$q$) like '42501%', 'anon reads a closed board');
  perform tests.unbecome();
end $$;

-- ---- 6. move_thread_names: a landed move names the thread's title and the board it left; a waiting one the board the thread is on ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  t uuid;
  mv uuid;
  got jsonb;
begin
  t := pg_temp.mk('Named for the sentence', 'bs-one', c);
  got := move_thread_names(jsonb_build_array(jsonb_build_object('thread', t, 'act', null)));
  perform pg_temp.expect(got -> 0 ->> 'key' = t::text and got -> 0 ->> 'title' = 'Named for the sentence' and got -> 0 ->> 'left' = pg_temp.board('bs-one')::text, 'a waiting move does not name the thread and the board it is on: ' || got::text);
  mv := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('bs-two'))));
  got := move_thread_names(jsonb_build_array(jsonb_build_object('thread', t, 'act', mv)));
  perform pg_temp.expect(got -> 0 ->> 'key' = mv::text and got -> 0 ->> 'left' = pg_temp.board('bs-one')::text, 'a landed move does not name the board the thread left: ' || got::text);
  perform pg_temp.expect(move_thread_names('"nonsense"') = '[]'::jsonb and move_thread_names(jsonb_build_array(jsonb_build_object('thread', 'not-a-uuid'))) = '[]'::jsonb, 'a bad item is not skipped');
end $$;

-- ---- 7. Stubs are on page one, below its threads, taking none of its slots; they are not repeated on the later pages ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  i integer;
  t uuid;
  j jsonb;
begin
  insert into boards (slug, name) values ('bs-busy', 'Busy Board');
  for i in 1..25 loop
    t := pg_temp.mk('Busy ' || i, 'bs-busy', c);
  end loop;
  t := pg_temp.mk('Leaves the busy board', 'bs-busy', c);
  perform pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('bs-two'))));
  j := pg_temp.page('bs-busy');
  perform pg_temp.expect((j ->> 'total')::integer = 25 and jsonb_array_length(j -> 'threads') = 20, 'the stub took a slot or a count on the first page: ' || (j ->> 'total'));
  perform pg_temp.expect(jsonb_array_length(j -> 'stubs') = 1, 'page one of a busy board lists no stub');
  perform tests.become(pg_temp.reader());
  j := board_page('bs-busy', 2, array[]::text[]);
  perform tests.unbecome();
  perform pg_temp.expect(jsonb_array_length(j -> 'stubs') = 0 and jsonb_array_length(j -> 'threads') = 5, 'a later page repeats the stubs');
end $$;

-- ---- 8. A closed board names the first open board its threads are in, even when the board it was merged into was closed since ----
do $$
declare
  c uuid := (select id from characters where name = 'Stub Reader');
  j jsonb;
  msg text;
begin
  insert into boards (slug, name) values ('ch-a', 'Chain A'), ('ch-b', 'Chain B'), ('ch-c', 'Chain C');
  perform pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('ch-a'), 'into', pg_temp.board('ch-b'))));
  j := pg_temp.page('ch-a');
  perform pg_temp.expect(j -> 'goesTo' ->> 'slug' = 'ch-b' and j -> 'mergedInto' ->> 'slug' = 'ch-b', 'one merge: the first open board is the board merged into: ' || j::text);
  perform pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('ch-b'), 'into', pg_temp.board('ch-c'))));
  j := pg_temp.page('ch-a');
  perform pg_temp.expect(j -> 'mergedInto' ->> 'name' = 'Chain B', 'the page does not keep the direct target in its words: ' || j::text);
  perform pg_temp.expect(j -> 'goesTo' ->> 'slug' = 'ch-c' and j -> 'goesTo' ->> 'name' = 'Chain C', 'a board merged into one that was merged again does not follow to the first open board: ' || j::text);
  perform pg_temp.expect(pg_temp.page('ch-b') -> 'goesTo' ->> 'slug' = 'ch-c', 'the middle board does not name the open one');
  perform tests.become(pg_temp.reader());
  msg := pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'ch-a', c, 'Late', 'Hello.'));
  perform tests.unbecome();
  perform pg_temp.expect(msg like '%Chain B%' and msg like '%Chain C%', 'the refusal does not name the first open board: ' || coalesce(msg, 'allowed'));
  -- Starting on the open board it names works.
  perform tests.become(pg_temp.reader());
  perform start_thread('ch-c', c, 'Here', 'Hello.');
  perform tests.unbecome();
  -- A made board whose fallback was closed since follows on too.
  perform pg_temp.expect(pg_temp.page('short-lived') -> 'goesTo' ->> 'slug' is not null, 'a closed made board names no board its threads are in');
end $$;
