-- createBoard, moveThread and mergeBoard land and end (supabase/migrations/0173_lasting_boards.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 2; design section 4).
--
-- Each kind is queued as the meeting queues it, lands through system_tick as a move does, and ends when it is reversed or superseded. What they build stays: no expiry, no demand.
-- A made board is a row that points at its Act; a moved thread is stored on its new board; a merged board closes and its threads join the other. Every case ends with
-- thread_places_drift() empty, and board_thread_counts agrees with the threads on each board.

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

-- ---- 1. The seed writes lasting for the three kinds: the first lasting kinds there are ----
do $$
begin
  perform pg_temp.expect((select count(*) from move_kinds where key in ('createBoard', 'moveThread', 'mergeBoard') and lasting) = 3, 'seed_instance did not write move_kinds.lasting = true for the three kinds');
  perform pg_temp.expect((select structural and shapes_board from move_kinds where key = 'createBoard') and (select structural and shapes_board from move_kinds where key = 'mergeBoard')
                         and (select not structural and not shapes_board from move_kinds where key = 'moveThread'), 'the kinds'' structural and shapes_board flags were not seeded');
end $$;

-- ---- 2. createBoard: a board with a slug from its name, pointing at its Act; boards_now lists it with its premise; the hold; no expiry, no demand ----
do $$
declare
  q bigint;
  q2 bigint;
  q3 bigint;
  held bigint;
  act uuid;
  act2 uuid;
  b boards;
  now_row boards_now;
  msg text;
begin
  -- A structural move waits out its hold: one not yet live is not landed by a tick.
  held := pg_temp.queue('createBoard', jsonb_build_object('name', 'Later Place', 'premise', 'Later.', 'description', 'Not yet.'), interval '1 day');
  perform system_tick();
  perform pg_temp.expect((select landed_act is null and refused_at is null from queued_moves where id = held), 'a createBoard not yet live landed');

  q := pg_temp.queue('createBoard', jsonb_build_object('name', 'Toast Corner', 'premise', 'Toast, and only toast.', 'description', 'A new board.'));
  perform pg_temp.expect((select expires_at is null from queued_moves where id = q), 'the guard kept an expiry on a lasting move');
  act := pg_temp.land(q);
  select * into b from boards where slug = 'toast-corner';
  perform pg_temp.expect(b.id is not null, 'the landing made no board with the slug toast-corner');
  perform pg_temp.expect(b.name = 'Toast Corner' and b.description = 'A new board.' and b.created_by_act = act and not b.is_system, 'the made board is not as the move named it: ' || to_jsonb(b)::text);
  perform pg_temp.expect(not (select a.payload ? 'expires_at' from acts a where a.id = act), 'the Act of a lasting move carries an expiry');
  select * into now_row from boards_now n where n.id = b.id;
  perform pg_temp.expect(now_row.name = 'Toast Corner' and now_row.premise = 'Toast, and only toast.' and now_row.description = 'A new board.' and not now_row.closed and now_row.merged_into is null,
    'boards_now does not list the made board with its name and premise: ' || to_jsonb(now_row)::text);
  perform pg_temp.expect((select count(*) from board_thread_counts where board = b.id) = 4, 'the made board has no thread counts');
  -- It stays: another tick does not end it, and it is in force.
  perform system_tick();
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = act) and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = act), 'a lasting move ended by itself');
  -- A second board of the same name gets a suffix; a name with no letters or digits still gets a slug.
  q2 := pg_temp.queue('createBoard', jsonb_build_object('name', 'Toast Corner', 'premise', 'More toast.', 'description', 'Again.'));
  act2 := pg_temp.land(q2);
  perform pg_temp.expect(exists (select 1 from boards where slug = 'toast-corner-2' and created_by_act = act2), 'a second board of the same name has no suffixed slug');
  q3 := pg_temp.queue('createBoard', jsonb_build_object('name', '!!!', 'premise', 'p', 'description', 'd'));
  perform pg_temp.land(q3);
  perform pg_temp.expect(exists (select 1 from boards where slug = 'board'), 'a name with no letters or digits made no slug');
  -- created_by_act is set only at insert, in any role of the session; and only a createBoard Act can make a board.
  msg := pg_temp.refusal(format('update boards set created_by_act = null where id = %L', b.id));
  perform pg_temp.expect(msg like 'P0001%never changes%', 'created_by_act was changed: ' || coalesce(msg, 'allowed'));
  set local session_replication_role = replica;
  msg := pg_temp.refusal(format('update boards set created_by_act = %L where id = %L', act2, b.id));
  set local session_replication_role = origin;
  perform pg_temp.expect(msg like 'P0001%never changes%', 'created_by_act was changed in replica mode: ' || coalesce(msg, 'allowed'));
  perform pg_temp.settled('createBoard');
end $$;

-- ---- 3. The queue's guard for a lasting move: no demand, each kind's refusals in words ----
do $$
declare
  msg text;
  general uuid := pg_temp.board('general');
  t uuid := pg_temp.mk('Guarded', 'general');
  m bigint;
  sys uuid := (select id from boards where is_system);
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  msg := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, structural)
    values (%s, 'lb-boss', 'moveThread', %L, %L, 'because', now(), false)$q$, m, jsonb_build_object('thread', t, 'board', pg_temp.board('third')),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 5))));
  perform pg_temp.expect(msg like '23514%no demand%', 'a lasting move with a demand was queued: ' || coalesce(msg, 'allowed'));
  -- A thread that does not exist.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', gen_random_uuid(), 'board', pg_temp.board('third'))));
  perform pg_temp.expect(msg like '23514%there is no such thread%', 'a move of a thread that is not there: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', 'nonsense', 'board', pg_temp.board('third'))));
  perform pg_temp.expect(msg like '23514%there is no such thread%', 'a move of a thread named nonsense: ' || coalesce(msg, 'allowed'));
  -- A board that does not exist, and The System's own board, as a target.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', t, 'board', gen_random_uuid())));
  perform pg_temp.expect(msg like '23514%no such board%', 'a move onto a board that is not there: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', t, 'board', sys)));
  perform pg_temp.expect(msg like '23514%System%own board%', 'a move onto The System''s board: ' || coalesce(msg, 'allowed'));
  -- A thread on The System's own board is never moved.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', (select t2.id from threads t2 where t2.board = sys limit 1), 'board', general)));
  perform pg_temp.expect(msg like '23514%System%own board%never moved%', 'a move of the announcements thread: ' || coalesce(msg, 'allowed'));
  -- A merge of a board into itself, a board that is not there, and The System's board.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'mergeBoard', jsonb_build_object('board', general, 'into', general)));
  perform pg_temp.expect(msg like '23514%never merged into itself%', 'a board merged into itself: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'mergeBoard', jsonb_build_object('board', general, 'into', gen_random_uuid())));
  perform pg_temp.expect(msg like '23514%no such board to merge it into%', 'a merge into a board that is not there: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'mergeBoard', jsonb_build_object('board', sys, 'into', general)));
  perform pg_temp.expect(msg like '23514%System%own board%', 'The System''s board merged: ' || coalesce(msg, 'allowed'));
  -- A new board needs a name, a premise and a description, and its fallback is an open board of the players.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'createBoard', jsonb_build_object('name', '  ', 'premise', 'p', 'description', 'd')));
  perform pg_temp.expect(msg like '23514%needs a name%', 'a board with a blank name: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'createBoard', jsonb_build_object('name', 'N', 'premise', 'p', 'description', 'd', 'fallback', sys)));
  perform pg_temp.expect(msg like '23514%fallback%open board%', 'a fallback that is The System''s board: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'createBoard', jsonb_build_object('name', 'N', 'premise', 'p', 'description', 'd', 'fallback', 'nonsense')));
  perform pg_temp.expect(msg like '23514%fallback%open board%', 'a fallback that is no uuid: ' || coalesce(msg, 'allowed'));
  -- Uppercase ids are kept in one form: lowercase (queued for far ahead, so it lands in none of the cases below).
  perform pg_temp.queue('moveThread', jsonb_build_object('thread', upper(t::text), 'board', upper(pg_temp.board('third')::text)), interval '30 days');
  perform pg_temp.expect((select q.params ->> 'thread' = t::text and q.params ->> 'board' = pg_temp.board('third')::text from queued_moves q order by q.id desc limit 1), 'the guard did not lowercase the ids');
end $$;

-- ---- 4. moveThread: its landing stores the thread's board; the counts follow; a second move ends the first as superseded; reversing returns the thread ----
do $$
declare
  t uuid := pg_temp.mk('Wanderer', 'general');
  g0 integer := (select threads from board_counts where board = pg_temp.board('general'));
  e0 integer := (select threads from board_counts where board = pg_temp.board('elsewhere'));
  q1 bigint;
  q2 bigint;
  m1 uuid;
  m2 uuid;
  msg text;
begin
  q1 := pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('elsewhere')));
  m1 := pg_temp.land(q1);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('elsewhere'), 'a moveThread did not set the thread''s board');
  perform pg_temp.expect((select origin_board from threads where id = t) = pg_temp.board('general'), 'a moveThread changed the thread''s origin');
  perform pg_temp.expect((select threads from board_counts where board = pg_temp.board('general')) = g0 - 1 and (select threads from board_counts where board = pg_temp.board('elsewhere')) = e0 + 1,
    'the board counts did not follow the moved thread');
  perform pg_temp.settled('moveThread');
  -- A second move of the same thread ends the first, superseded, at landing.
  q2 := pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('third')));
  m2 := pg_temp.land(q2);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('third'), 'the second moveThread did not place the thread');
  perform pg_temp.expect((select e.payload ->> 'why' = 'superseded' from acts e where e.kind = 'move_end' and e.target_act_id = m1), 'the first moveThread was not ended as superseded');
  perform pg_temp.expect(not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = m2) and exists (select 1 from open_moves where move_act = m2), 'the second moveThread is not in force');
  perform pg_temp.settled('a superseding moveThread');
  -- Reversing the second restores the first, which it superseded: a superseded end does not take a move out of the thread's reckoning (only reversed or overturned does), though
  -- the first stays ended and nothing is written for it. The counts follow.
  perform pg_temp.reverse(m2);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('elsewhere'), 'reversing the second moveThread did not return the thread to the first move''s board');
  perform pg_temp.expect((select e.payload ->> 'why' = 'superseded' from acts e where e.kind = 'move_end' and e.target_act_id = m1) and (select count(*) from acts e where e.target_act_id = m1 and e.kind = 'move_end') = 1,
    'the superseded move was ended again or its end changed');
  perform pg_temp.expect((select threads from board_counts where board = pg_temp.board('general')) = g0 - 1 and (select threads from board_counts where board = pg_temp.board('elsewhere')) = e0 + 1,
    'the board counts did not follow the thread back to the first move''s board');
  perform pg_temp.settled('a reversed moveThread that had superseded one');
  -- The restored first move is in force again (open_moves, so the admin queue lists it and an admin can find it to reverse it): the thread sits on its board.
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = m1) and not exists (select 1 from open_moves where move_act = m2), 'a superseded move restored by the reversal of its superseder is not in force');
  -- A superseded move can still be reversed, once: a new move_end beside its superseded one. With the second reversed, reversing the first returns the thread to its origin.
  perform pg_temp.reverse(m1);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'reversing the first moveThread after the second did not return the thread to its origin');
  perform pg_temp.expect((select count(*) from acts e where e.kind = 'move_end' and e.target_act_id = m1) = 2 and (select count(*) from moves_log l where l.id = m1) = 1
    and (select ended_why from moves_log l where l.id = m1) = 'reversed', 'the log does not read a move with two ends as one row, ended reversed');
  perform pg_temp.expect(not (end_move(m1, 'reversed', 'admin') ->> 'ended')::boolean and not (end_move(m1, 'superseded', 'landing') ->> 'ended')::boolean, 'a move took a third end');
  perform pg_temp.settled('a reversed superseded move');
  perform pg_temp.expect(not exists (select 1 from open_moves where move_act = m1), 'a move reversed after being superseded is still in force');
  -- The first reversed while the second is live changes nothing about where the thread is; reversing the second then returns it to its origin.
  t := pg_temp.mk('Pair', 'general');
  m1 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('elsewhere'))));
  m2 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('third'))));
  perform pg_temp.reverse(m1);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('third') and exists (select 1 from open_moves where move_act = m2), 'reversing the superseded first moved the thread or ended the second');
  perform pg_temp.settled('the superseded first reversed with the second live');
  perform pg_temp.reverse(m2);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'reversing the second after the first did not return the thread to its origin');
  perform pg_temp.settled('both reversed');
  -- A move that was only ever reversed returns its thread to its origin.
  t := pg_temp.mk('Lone', 'general');
  m1 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('fourth'))));
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('fourth'), 'a third move did not place the thread');
  perform pg_temp.reverse(m1);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'reversing the only moveThread did not return the thread');
  perform pg_temp.settled('a reversed lone moveThread');
  -- Only a createBoard Act can make a board: a board naming a moveThread Act is refused, and none is made.
  msg := pg_temp.refusal(format('insert into boards (slug, name, created_by_act) values (%L, %L, %L)', 'sneaky', 'Sneaky', m1));
  perform pg_temp.expect(msg like '23514%made by a createBoard%', 'a board made by something other than a createBoard: ' || coalesce(msg, 'allowed'));
  perform pg_temp.expect((select count(*) from boards where slug = 'sneaky') = 0, 'a board named for a non-createBoard Act was made');
end $$;

-- ---- 4b. The tick: two moves of one thread in one tick, a failing landing among others, a second end refused, a restored move reversed from the queue's list ----
do $$
declare
  t uuid := pg_temp.mk('Tick pair', 'general');
  qa bigint;
  qb bigint;
  ra queued_moves;
  rb queued_moves;
  good bigint;
  bad bigint;
  after_t uuid := pg_temp.mk('After the bad one', 'general');
  qm bigint;
  restored uuid;
  m uuid;
  msg text;
begin
  -- Two moveThreads of one thread in one tick land in queue order; the first is ended superseded by the second's landing, in that tick.
  qa := pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('elsewhere')));
  qb := pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('third')));
  perform system_tick();
  select * into ra from queued_moves where id = qa;
  select * into rb from queued_moves where id = qb;
  perform pg_temp.expect(ra.landed_act is not null and rb.landed_act is not null, 'two moves of one thread did not both land in one tick');
  perform pg_temp.expect((select e.payload ->> 'why' = 'superseded' from acts e where e.kind = 'move_end' and e.target_act_id = ra.landed_act), 'the first of two moves in one tick was not ended superseded');
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = rb.landed_act) and not exists (select 1 from open_moves where move_act = ra.landed_act) and pg_temp.at(t) = pg_temp.board('third'), 'the second of two moves in one tick is not the one in force');
  perform pg_temp.settled('two moves of one thread in one tick');
  -- A reversed second restores the first, which the queue's list then shows in force: reversing it from there works, and the thread goes home.
  perform pg_temp.reverse(rb.landed_act);
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = ra.landed_act) and pg_temp.at(t) = pg_temp.board('elsewhere'), 'the restored move is not in force on the board it restored');
  perform pg_temp.reverse(ra.landed_act);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general') and not exists (select 1 from open_moves where move_act in (ra.landed_act, rb.landed_act)), 'reversing the restored move did not send the thread home');
  perform pg_temp.settled('a restored move reversed');
  -- A restored move is not in force once a later move of the thread lands: rebuild_open_moves agrees with the trigger.
  restored := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', after_t, 'board', pg_temp.board('elsewhere'))));
  m := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', after_t, 'board', pg_temp.board('third'))));
  perform pg_temp.reverse(m);
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = restored), 'setup: the restored move is not in force');
  m := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', after_t, 'board', pg_temp.board('fourth'))));
  perform pg_temp.expect(not exists (select 1 from open_moves where move_act = restored) and exists (select 1 from open_moves where move_act = m) and pg_temp.at(after_t) = pg_temp.board('fourth'), 'a later move did not take the restored one out of force');
  perform pg_temp.expect(rebuild_open_moves() = 0, 'rebuild_open_moves disagrees with the moves in force the trigger kept');
  perform pg_temp.settled('a later move after a restore');
  -- A second end that is not a supersession is refused: a move reversed takes neither another reversal, an overturn nor a supersession.
  perform pg_temp.reverse(m);
  perform pg_temp.expect(not (end_move(m, 'overturned', 'admin') ->> 'ended')::boolean and not (end_move(m, 'reversed', 'admin') ->> 'ended')::boolean and not (end_move(m, 'superseded', 'landing') ->> 'ended')::boolean
    and (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id = m) = 1, 'a move reversed took another end');
  msg := pg_temp.refusal(format('update acts set payload = payload || %L where id = %L', '{"why":"reversed"}'::jsonb, (select e.id from acts e where e.kind = 'move_end' and e.target_act_id = m)));
  perform pg_temp.expect(msg is not null, 'a move_end was updated in place');
  -- One failing landing leaves the others: a board the database refuses to make stays due with its failure on the row, and the moves queued with it land.
  create function public.lb_poison() returns trigger language plpgsql as $f$ begin if new.name = 'Poisoned' then raise exception 'poisoned board'; end if; return new; end $f$;
  create trigger lb_poison before insert on boards for each row execute function public.lb_poison();
  bad := pg_temp.queue('createBoard', jsonb_build_object('name', 'Poisoned', 'premise', 'p', 'description', 'd'));
  good := pg_temp.queue('createBoard', jsonb_build_object('name', 'Fine', 'premise', 'p', 'description', 'd'));
  qm := pg_temp.queue('moveThread', jsonb_build_object('thread', after_t, 'board', pg_temp.board('elsewhere')));
  perform system_tick();
  perform pg_temp.expect((select landed_act is null and failed_at is not null and failure like '%poisoned board%' and refused_at is null from queued_moves where id = bad), 'the failing landing was not recorded on its row');
  perform pg_temp.expect(not exists (select 1 from boards where name = 'Poisoned') and not exists (select 1 from acts a where a.kind = 'move' and a.payload #>> '{params,name}' = 'Poisoned'), 'the failing landing left an Act or a board');
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = good) and (select landed_act is not null from queued_moves where id = qm) and pg_temp.at(after_t) = pg_temp.board('elsewhere'), 'a failing landing stopped the others');
  perform pg_temp.settled('a failing landing among others');
  drop trigger lb_poison on boards;
  update queued_moves set held_at = now(), held_by = tests.account('lb-admin') where id = bad;
end $$;

-- ---- 4c. A meeting's answer with a lasting move the queue would refuse applies the rest and records the skipped one ----
do $$
declare
  m bigint;
  r jsonb;
  rec jsonb;
  pl jsonb;
  closed uuid := pg_temp.board('third');
  sys uuid := (select id from boards where is_system);
  mv jsonb;
begin
  insert into move_bank (staff, balance, as_of) values ('lb-boss', 5, now()) on conflict (staff) do update set balance = 5, as_of = now();
  mv := jsonb_build_object('go_live_at', now(), 'expires_in_hours', 0, 'why', 'Because.');
  pl := jsonb_build_object('boss', 'lb-boss', 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'Done.'),
    'moves', jsonb_build_array(
      mv || jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', gen_random_uuid(), 'board', pg_temp.board('general'))),
      mv || jsonb_build_object('kind', 'createBoard', 'params', jsonb_build_object('name', 'Meeting Made', 'premise', 'p', 'description', 'd')),
      mv || jsonb_build_object('kind', 'createBoard', 'params', jsonb_build_object('name', 'Bad Fallback', 'premise', 'p', 'description', 'd', 'fallback', sys)),
      mv || jsonb_build_object('kind', 'mergeBoard', 'params', jsonb_build_object('board', pg_temp.board('general'), 'into', pg_temp.board('general')))),
    'record', '{}'::jsonb);
  m := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  r := apply_meeting(m, pl);
  perform pg_temp.expect(r ->> 'status' = 'applied' and (r ->> 'queued')::integer = 1, 'the meeting did not apply with the one good lasting move: ' || r::text);
  perform pg_temp.expect((select count(*) from queued_moves where meeting = m) = 1 and (select params ->> 'name' from queued_moves where meeting = m) = 'Meeting Made' and (select expires_at is null from queued_moves where meeting = m), 'only the good move was queued, with no expiry');
  select record into rec from meetings where id = m;
  perform pg_temp.expect(jsonb_array_length(rec -> 'lastingSkipped') = 3 and rec #>> '{lastingSkipped,0,index}' = '0' and rec #>> '{lastingSkipped,0,why}' like '%no such thread%' and rec #>> '{lastingSkipped,1,index}' = '2'
    and rec #>> '{lastingSkipped,2,index}' = '3', 'the skipped ones are not on the record: ' || rec::text);
  -- The meeting's board list leaves out a closed board, so the model is not offered one to rename, merge into or move a thread onto.
  insert into boards (slug, name, created_at) values ('closer', 'Closer', now() - interval '6 days');
  perform pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('closer'), 'into', pg_temp.board('elsewhere'))));
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(meeting_context() -> 'boards') b where b ->> 'id' = pg_temp.board('closer')::text)
    and exists (select 1 from jsonb_array_elements(meeting_context() -> 'boards') b where b ->> 'id' = pg_temp.board('elsewhere')::text), 'the meeting''s board list holds a closed board or misses an open one: ' || (meeting_context() -> 'boards')::text);
  perform pg_temp.settled('a meeting with a bad lasting move');
end $$;

-- ---- 5. mergeBoard: threads join the other board, the board closes; reversing reopens it and returns the threads; chains; refusals; cycles ----
do $$
declare
  a1 uuid := pg_temp.mk('Third A', 'third');
  a2 uuid := pg_temp.mk('Third B', 'third');
  m1 uuid := pg_temp.mk('Moved in', 'general');
  q bigint;
  qm bigint;
  merge uuid;
  mv uuid;
  msg text;
  n integer;
begin
  mv := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', m1, 'board', pg_temp.board('third'))));
  perform pg_temp.expect(pg_temp.at(m1) = pg_temp.board('third'), 'setup: the thread was not moved onto Third');
  n := (select count(*) from threads where board = pg_temp.board('third'));
  q := pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('third'), 'into', pg_temp.board('fourth')));
  merge := pg_temp.land(q);
  perform pg_temp.expect(pg_temp.at(a1) = pg_temp.board('fourth') and pg_temp.at(a2) = pg_temp.board('fourth') and pg_temp.at(m1) = pg_temp.board('fourth'), 'a mergeBoard did not move every thread on the board');
  perform pg_temp.expect((select closed and merged_into = pg_temp.board('fourth') from boards_now where id = pg_temp.board('third')), 'boards_now does not say the merged board is closed and where it went');
  perform pg_temp.expect((select not closed and merged_into is null from boards_now where id = pg_temp.board('fourth')), 'boards_now closed the board that was merged into');
  perform pg_temp.expect((select threads from board_counts where board = pg_temp.board('fourth')) >= n and coalesce((select threads from board_counts where board = pg_temp.board('third')), 0) = 0, 'the counts did not follow the merge');
  perform pg_temp.settled('mergeBoard');
  -- A merged board is closed: no move onto it, no merge of it again, and none into a board merged into it (a cycle), whose words say so.
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'moveThread', jsonb_build_object('thread', a1, 'board', pg_temp.board('third'))));
  perform pg_temp.expect(msg like '23514%closed%', 'a move onto a closed board: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'mergeBoard', jsonb_build_object('board', pg_temp.board('third'), 'into', pg_temp.board('general'))));
  perform pg_temp.expect(msg like '23514%already closed%', 'a merge of a closed board: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.queue(%L, %L)', 'mergeBoard', jsonb_build_object('board', pg_temp.board('fourth'), 'into', pg_temp.board('third'))));
  perform pg_temp.expect(msg like '23514%already merged into it%', 'a cycle was queued: ' || coalesce(msg, 'allowed'));
  -- Reversing reopens the board and returns its threads, the moved-in one included (its move is still in force).
  perform pg_temp.reverse(merge);
  perform pg_temp.expect(pg_temp.at(a1) = pg_temp.board('third') and pg_temp.at(a2) = pg_temp.board('third') and pg_temp.at(m1) = pg_temp.board('third'), 'reversing a mergeBoard did not return the threads');
  perform pg_temp.expect((select not closed and merged_into is null from boards_now where id = pg_temp.board('third')), 'reversing a mergeBoard did not reopen the board');
  perform pg_temp.settled('a reversed mergeBoard');
end $$;

do $$
declare
  x uuid;
  y uuid;
  z uuid;
  tx uuid;
  ty uuid;
  mxy uuid;
  myz uuid;
  qa bigint;
  qb bigint;
  r queued_moves;
begin
  -- Chains: X into Y, Y into Z: X's threads end on Z; reversing Y into Z leaves X's on Y (the threads of a board routed through the reversed one are rebuilt too).
  insert into boards (slug, name, created_at) values ('ex', 'Ex', now() - interval '5 days'), ('why', 'Why', now() - interval '4 days'), ('zed', 'Zed', now() - interval '3 days');
  x := pg_temp.board('ex'); y := pg_temp.board('why'); z := pg_temp.board('zed');
  tx := pg_temp.mk('Started on Ex', 'ex'); ty := pg_temp.mk('Started on Why', 'why');
  mxy := pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', x, 'into', y)));
  myz := pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', y, 'into', z)));
  perform pg_temp.expect(pg_temp.at(tx) = z and pg_temp.at(ty) = z, 'a chain of merges did not send the threads to the end of it');
  perform pg_temp.settled('a chain of merges');
  perform pg_temp.reverse(myz);
  perform pg_temp.expect(pg_temp.at(tx) = y and pg_temp.at(ty) = y, 'reversing the end of a chain did not return the threads routed through it');
  perform pg_temp.settled('a reversed end of a chain');
  perform pg_temp.reverse(mxy);
  perform pg_temp.expect(pg_temp.at(tx) = x and pg_temp.at(ty) = y, 'reversing the start of a chain did not return its threads');
  perform pg_temp.settled('a reversed start of a chain');
  -- A cycle is refused at landing too: two merges that were each fine to queue are due together, and the second finds the first.
  qa := pg_temp.queue('mergeBoard', jsonb_build_object('board', x, 'into', y));
  qb := pg_temp.queue('mergeBoard', jsonb_build_object('board', y, 'into', x));
  perform system_tick();
  select * into r from queued_moves where id = qa;
  perform pg_temp.expect(r.landed_act is not null, 'the first of two merges did not land');
  select * into r from queued_moves where id = qb;
  perform pg_temp.expect(r.landed_act is null and r.refused_at is not null and r.failure like '%already merged into it%', 'the merge that would make a cycle was not refused at landing: ' || to_jsonb(r)::text);
  perform pg_temp.expect(not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'mergeBoard' and a.payload #>> '{params,board}' = y::text and a.payload #>> '{params,into}' = x::text), 'a refused merge left an Act');
  perform pg_temp.expect(pg_temp.at(tx) = y and pg_temp.at(ty) = y, 'a refused cycle moved threads');
  perform pg_temp.settled('a cycle refused at landing');
  -- A move queued onto a board that closes before it lands is refused at landing, for good.
  qa := pg_temp.queue('mergeBoard', jsonb_build_object('board', z, 'into', y));
  qb := pg_temp.queue('moveThread', jsonb_build_object('thread', ty, 'board', z));
  perform system_tick();
  select * into r from queued_moves where id = qb;
  perform pg_temp.expect(r.landed_act is null and r.refused_at is not null and r.failure like '%closed%', 'a move onto a board closed since it was queued was not refused at landing: ' || to_jsonb(r)::text);
  perform pg_temp.settled('a move refused at landing');
end $$;

-- ---- 6. Reversing createBoard: threads moved in go back; threads started in it go to its fallback, or the first open board; the board closes ----
do $$
declare
  fb uuid := pg_temp.board('fourth');
  cmove uuid;
  nmove uuid;
  nb uuid;
  nnb uuid;
  moved uuid := pg_temp.mk('Moved into the made board', 'general');
  started uuid;
  started2 uuid;
  mt uuid;
  fmerge uuid;
begin
  cmove := pg_temp.land(pg_temp.queue('createBoard', jsonb_build_object('name', 'With Fallback', 'premise', 'p', 'description', 'd', 'fallback', fb)));
  nb := (select id from boards where created_by_act = cmove);
  started := pg_temp.mk('Started in the made board', 'with-fallback');
  mt := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', moved, 'board', nb)));
  perform pg_temp.expect(pg_temp.at(moved) = nb and pg_temp.at(started) = nb, 'setup: threads are not on the made board');
  perform pg_temp.settled('a made board with threads');
  perform pg_temp.reverse(cmove);
  perform pg_temp.expect((select closed and merged_into is null from boards_now where id = nb), 'a reversed createBoard did not close its board');
  perform pg_temp.expect(pg_temp.at(started) = fb, 'a thread started in a reversed createBoard did not go to its fallback');
  perform pg_temp.expect(pg_temp.at(moved) = pg_temp.board('general'), 'a thread moved into a reversed createBoard did not go back to its origin');
  perform pg_temp.settled('a reversed createBoard with a fallback');
  -- With the move that put it there reversed too, the moved thread is back where it started.
  perform pg_temp.reverse(mt);
  perform pg_temp.expect(pg_temp.at(moved) = pg_temp.board('general'), 'reversing the move into a closed board did not return the thread to its origin');
  perform pg_temp.settled('a reversed moveThread onto a closed board');
  -- A thread that had an earlier move to another board returns to that board, not to its origin and not to the fallback.
  cmove := pg_temp.land(pg_temp.queue('createBoard', jsonb_build_object('name', 'Briefly', 'premise', 'p', 'description', 'd', 'fallback', fb)));
  nb := (select id from boards where created_by_act = cmove);
  moved := pg_temp.mk('Moved twice', 'general');
  perform pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', moved, 'board', pg_temp.board('third'))));
  perform pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', moved, 'board', nb)));
  perform pg_temp.expect(pg_temp.at(moved) = nb, 'setup: the second move did not place the thread on the made board');
  perform pg_temp.reverse(cmove);
  perform pg_temp.expect(pg_temp.at(moved) = pg_temp.board('third'), 'a thread moved into a reversed createBoard did not go back to its earlier move''s board');
  perform pg_temp.settled('a reversed createBoard, a thread with an earlier move');

  nmove := pg_temp.land(pg_temp.queue('createBoard', jsonb_build_object('name', 'No Fallback', 'premise', 'p', 'description', 'd')));
  nnb := (select id from boards where created_by_act = nmove);
  started2 := pg_temp.mk('Started in the other made board', 'no-fallback');
  perform pg_temp.reverse(nmove);
  perform pg_temp.expect(pg_temp.at(started2) = pg_temp.board('general'), 'a thread started in a reversed createBoard with no fallback did not go to the first open board');
  perform pg_temp.expect((select closed from boards_now where id = nnb), 'the board of a reversed createBoard with no fallback is not closed');
  perform pg_temp.settled('a reversed createBoard with no fallback');
  -- The first open board changes when it is merged away: a thread that went to it is rebuilt too, though no merge route reaches it.
  fmerge := pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('general'), 'into', pg_temp.board('elsewhere'))));
  perform pg_temp.expect(pg_temp.at(started2) = pg_temp.board('elsewhere'), 'a thread routed to the first open board did not follow it when that board was merged away');
  perform pg_temp.settled('the first open board merged away');
  -- And when it reopens: the thread started in the closed made board is on neither General nor anything routed through it, so only the change of the first open board finds it.
  perform pg_temp.reverse(fmerge);
  perform pg_temp.expect(pg_temp.at(started2) = pg_temp.board('general'), 'a thread routed to the first open board did not follow it back when that board reopened');
  perform pg_temp.settled('the first open board reopened');
end $$;

-- ---- 7. Not handed on: a new Boss's review leaves a lasting move in force, and the handover's pass still ends an ordinary one ----
do $$
declare
  kept uuid;
  ordinary uuid;
begin
  select a.id into kept from acts a join open_moves o on o.move_act = a.id where a.payload ->> 'kind' = 'mergeBoard' limit 1;
  perform pg_temp.expect(kept is not null, 'setup: no mergeBoard is in force');
  insert into move_kinds (key, structural, shapes_board) values ('renameBoard', true, true) on conflict (key) do nothing;
  ordinary := (write_staff_act('lb-boss', 'move', (select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements'), null,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'expires_at', now() + interval '30 days',
      'params', jsonb_build_object('board', pg_temp.board('general'), 'name', 'Renamed', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
  perform pg_temp.expect(not exists (select 1 from inheritance_due('lb-other') d where d.act = kept), 'a lasting move is due for the new Boss''s review');
  perform pg_temp.expect(exists (select 1 from inheritance_due('lb-other') d where d.act = ordinary), 'the ordinary board-shaping move is not due for review (the comparison is void)');
  -- A new Boss has been in the seat past the grace and has addressed neither: the handover's pass of the tick ends the ordinary move, and never the lasting one.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Other Boss', 'lb-other', 'persona', now());
  update seasons set boss = 'lb-other', starts_at = now() - interval '30 days' where ends_at is null;
  update open_moves set landed_at = now() - interval '10 days' where move_act in (ordinary, kept);
  perform system_tick();
  perform pg_temp.expect(exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = ordinary and e.payload ->> 'why' = 'superseded'), 'the handover''s pass did not end the ordinary board-shaping move (the comparison is void)');
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = kept) and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = kept), 'the handover''s pass ended a lasting move');
  perform pg_temp.settled('the end');
end $$;

-- ---- 8. Every role that reads boards_now still reads it with a merged and a reversed board in the instance: the view runs its helper functions as its owner, so no role needs execute on them ----
do $$
declare
  r text;
  n integer;
  closed_n integer;
begin
  perform pg_temp.expect((select count(*) from boards_now where closed) > 0, 'setup: no closed board in boards_now');
  foreach r in array array['anon', 'authenticated', 'kayfabb_digest'] loop
    execute format('set local role %I', r);
    select count(*), count(*) filter (where closed) into n, closed_n from boards_now;
    reset role;
    perform pg_temp.expect(n = (select count(*) from boards) and closed_n > 0, r || ' does not read every board, closed ones included, from boards_now');
  end loop;
  perform tests.become(tests.account('lb-reader'));
  n := jsonb_array_length(index_page() -> 'boards');
  perform tests.unbecome();
  perform pg_temp.expect(n > 0, 'the board index does not read for a signed-in player');
end $$;
