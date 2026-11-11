-- Bundles: parts, roles and dependency (supabase/migrations/0182_bundles.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 4; design section 5).
--
-- A bundle is queued moves sharing one `bundle` id, each part an ordinary move with its own Act. A part names another part's result by its role ({"role": "minus"} where a board
-- goes), resolved when it lands; it waits for the part it names. An admin may hold or reverse any one part, and what builds on it follows: holding a part holds the waiting parts
-- that name it, reversing a landed part reverses what depends on it (a later move into a board it made included), each end its own move_end Act. A dependency is recorded when a
-- move is queued (queued_moves.depends_on) and, when the dependent lands, in move_dependencies, which is insert-only.
--
-- Nothing here queues a bundle from a meeting: the rows are written directly, as the service role writes them.
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
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'bu-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'bu-boss', 'name', 'Bundle Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into boards (slug, name, created_at) values ('elsewhere', 'Elsewhere', now() - interval '9 days'), ('third', 'Third', now() - interval '8 days'), ('fourth', 'Fourth', now() - interval '7 days');
  update boards set created_at = now() - interval '10 days' where slug = 'general';
  insert into admins (account) values (tests.account('bu-admin'));
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
  values (m, 'bu-boss', kind, params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0'), kind in ('createBoard', 'mergeBoard')) returning id into q;
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


-- A part of a bundle, as the service role queues it: the bundle's id and name, the part's role (null for a part nobody names), its kind and params. Live a minute ago unless told to wait.
create function pg_temp.part(bundle uuid, bname text, role text, kind text, params jsonb, wait interval default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, 'bu-boss', kind, params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0'), kind in ('createBoard', 'mergeBoard'), bundle, bname, role) returning id into q;
  return q;
exception when others then
  raise exception 'a % part (role %) was refused at the queue: %', kind, coalesce(role, 'none'), sqlerrm using errcode = sqlstate;
end $$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
create function pg_temp.qrow(q bigint) returns queued_moves language sql as $$ select * from queued_moves where id = q $$;
create function pg_temp.admin() returns uuid language sql as $$ select id from auth.users where email = 'bu-admin@test.invalid' $$;
create function pg_temp.ends(act uuid) returns text language sql as $$
  select coalesce(string_agg((e.payload ->> 'why') || '/' || (e.payload ->> 'by'), ',' order by e.seq), '') from acts e where e.kind = 'move_end' and e.target_act_id = act
$$;
create function pg_temp.made_by(act uuid) returns uuid language sql as $$ select id from boards where created_by_act = act $$;

-- ---- 1. Queuing: two parts under one bundle; the second names the first by its role and depends on it ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Bundled', 'general');
  q1 bigint;
  q2 bigint;
  q3 bigint;
  q4 bigint;
  msg text;
begin
  q1 := pg_temp.part(b, 'The Test Split', 'minus', 'createBoard', pg_temp.mkboard('World Minus'));
  q2 := pg_temp.part(b, 'The Test Split', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform pg_temp.expect((pg_temp.qrow(q1)).depends_on is null or (pg_temp.qrow(q1)).depends_on = '{}', 'the first part depends on something: ' || coalesce((pg_temp.qrow(q1)).depends_on::text, 'null'));
  perform pg_temp.expect((pg_temp.qrow(q2)).depends_on = array[q1], 'the second part does not depend on the first: ' || coalesce((pg_temp.qrow(q2)).depends_on::text, 'null'));
  perform pg_temp.expect((pg_temp.qrow(q2)).params -> 'board' = '{"role": "minus"}'::jsonb, 'the role was not kept in the queued params');
  perform pg_temp.expect((pg_temp.qrow(q2)).bundle = b and (pg_temp.qrow(q2)).role = 'move' and (pg_temp.qrow(q2)).bundle_name = 'The Test Split', 'the part does not carry its bundle, role and name');
  -- A caller never sets what a part depends on: the guard computes it, and a part that names no role and no made board depends on nothing, whatever it was given.
  q3 := pg_temp.part(b, 'The Test Split', 'other', 'createBoard', pg_temp.mkboard('Other'), interval '30 days');
  insert into queued_moves (meeting, staff, kind, params, why, go_live_at, structural, bundle, bundle_name, role, depends_on)
  select meeting, staff, kind, pg_temp.mkboard('Given'), why, go_live_at + interval '30 days', structural, bundle, bundle_name, 'given', array[q1] from queued_moves where id = q3 returning id into q4;
  perform pg_temp.expect((pg_temp.qrow(q4)).depends_on is null, 'a caller''s depends_on was kept: ' || (pg_temp.qrow(q4)).depends_on::text);
  -- Refusals, in words.
  msg := pg_temp.refusal(format('select pg_temp.part(null, null, null, %L, %L, interval ''30 days'')', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus'))));
  perform pg_temp.expect(msg like '23514%inside a bundle%', 'a role in a move that is no part of a bundle: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, %L, %L, %L, %L, interval ''30 days'')', b, 'The Test Split', 'late', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'nobody'))));
  perform pg_temp.expect(msg like '23514%names no part%', 'a role no part has: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, %L, %L, %L, %L, interval ''30 days'')', b, 'The Test Split', 'late', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'move'))));
  perform pg_temp.expect(msg like '23514%makes no board%', 'a role naming a part that makes no board: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, %L, %L, %L, %L, interval ''30 days'')', b, 'The Test Split', 'late', 'moveThread', jsonb_build_object('thread', jsonb_build_object('role', 'minus'), 'board', pg_temp.board('third'))));
  perform pg_temp.expect(msg like '23514%role%', 'a role where a thread goes: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, %L, %L, %L, %L, interval ''30 days'')', b, 'The Test Split', 'minus', 'createBoard', pg_temp.mkboard('Twice')));
  perform pg_temp.expect(msg like '23505%' or msg like '23514%role%', 'two parts of one bundle with one role: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, %L, %L, %L, %L, interval ''30 days'')', b, 'Another Name', 'x', 'createBoard', pg_temp.mkboard('Renamed')));
  perform pg_temp.expect(msg like '23514%name%', 'a part under another name for the bundle: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(%L, null, %L, %L, %L, interval ''30 days'')', gen_random_uuid(), 'x', 'createBoard', pg_temp.mkboard('Nameless')));
  perform pg_temp.expect(msg like '23514%name%', 'a bundle with no name: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select pg_temp.part(null, null, %L, %L, %L, interval ''30 days'')', 'x', 'createBoard', pg_temp.mkboard('Roled')));
  perform pg_temp.expect(msg like '23514%role%bundle%', 'a role with no bundle: ' || coalesce(msg, 'allowed'));
  -- Once queued, a part's bundle, name, role and dependencies never change.
  msg := pg_temp.refusal(format('update queued_moves set role = %L where id = %L', 'else', q2));
  perform pg_temp.expect(msg like '23514%only ever held or landed%', 'a part''s role was changed: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('update queued_moves set depends_on = %L where id = %L', '{}', q2));
  perform pg_temp.expect(msg like '23514%only ever held or landed%', 'a part''s dependencies were changed: ' || coalesce(msg, 'allowed'));
  -- Held and cleaned up: nothing in this block lands.
  update queued_moves set held_at = now(), held_by = pg_temp.admin() where bundle = b;
end $$;

-- ---- 2. Landing: the first lands, the second's role resolves to the board it made, and the dependency is recorded ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Resolved', 'general');
  q1 bigint;
  q2 bigint;
  a1 uuid;
  a2 uuid;
begin
  q1 := pg_temp.part(b, 'The Landing', 'minus', 'createBoard', pg_temp.mkboard('Landing Minus'));
  q2 := pg_temp.part(b, 'The Landing', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform system_tick();
  a1 := (pg_temp.qrow(q1)).landed_act;
  a2 := (pg_temp.qrow(q2)).landed_act;
  perform pg_temp.expect(a1 is not null and a2 is not null, 'the two parts did not land in one tick: ' || coalesce((pg_temp.qrow(q2)).failure, 'no failure') || ' refused ' || coalesce((pg_temp.qrow(q2)).refused_at::text, 'no'));
  perform pg_temp.expect(pg_temp.made_by(a1) is not null, 'the first part made no board');
  perform pg_temp.expect((select a.payload #>> '{params,board}' from acts a where a.id = a2) = pg_temp.made_by(a1)::text, 'the second part''s Act does not name the board the first made: ' || (select a.payload -> 'params' from acts a where a.id = a2)::text);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.made_by(a1), 'the thread is not on the board the first part made');
  perform pg_temp.expect((pg_temp.qrow(q2)).params -> 'board' = '{"role": "minus"}'::jsonb, 'landing rewrote the queued params');
  perform pg_temp.expect((select count(*) from move_dependencies d where d.act = a2 and d.on_act = a1) = 1, 'the dependency was not recorded when the second part landed');
  perform pg_temp.expect((select count(*) from move_dependencies d where d.act = a1) = 0, 'the first part depends on something');
  perform pg_temp.settled('a bundle landing');
end $$;

-- ---- 2b. A part whose role's part has not landed waits; one whose role's part was refused is refused with it ----
do $$
declare
  b uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Waiting', 'general');
  t2 uuid := pg_temp.mk('Refused With', 'general');
  q1 bigint;
  q2 bigint;
  r1 bigint;
  r2 bigint;
begin
  -- The first is live a day from now, the second now: the second waits, and is not failed or refused for waiting.
  q1 := pg_temp.part(b, 'The Wait', 'minus', 'createBoard', pg_temp.mkboard('Waits Minus'), interval '1 day');
  q2 := pg_temp.part(b, 'The Wait', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform system_tick();
  perform pg_temp.expect((pg_temp.qrow(q2)).landed_act is null and (pg_temp.qrow(q2)).failed_at is null and (pg_temp.qrow(q2)).refused_at is null and (pg_temp.qrow(q2)).held_at is null,
    'a part whose role''s part has not landed did not simply wait: ' || to_jsonb(pg_temp.qrow(q2))::text);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'the waiting part moved its thread');
  update queued_moves set held_at = now(), held_by = pg_temp.admin() where bundle = b;
  -- A first part the tick refuses at landing (a refusal is final) refuses the part that names it.
  r1 := pg_temp.part(b2, 'The Refusal', 'minus', 'createBoard', pg_temp.mkboard('Refused Minus'));
  r2 := pg_temp.part(b2, 'The Refusal', 'move', 'moveThread', jsonb_build_object('thread', t2, 'board', jsonb_build_object('role', 'minus')));
  update queued_moves set failed_at = now(), failure = 'that move cannot land: for the test', refused_at = now() where id = r1;
  perform system_tick();
  perform pg_temp.expect((pg_temp.qrow(r2)).landed_act is null and (pg_temp.qrow(r2)).refused_at is not null and (pg_temp.qrow(r2)).failure like '%refused%', 'a part whose role''s part was refused was not refused with it: ' || to_jsonb(pg_temp.qrow(r2))::text);
  perform pg_temp.expect(pg_temp.at(t2) = pg_temp.board('general'), 'the refused part moved its thread');
end $$;

-- ---- 3. Holding: the first holds the second, in one transaction and one instant; the second leaves the first; the chain follows breadth first ----
do $$
declare
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Held Bundle', 'general');
  q1 bigint;
  q2 bigint;
  c1 bigint;
  c2 bigint;
  c3 bigint;
  d1 bigint;
  d2 bigint;
  answer jsonb;
  msg text;
begin
  q1 := pg_temp.part(b, 'The Hold', 'minus', 'createBoard', pg_temp.mkboard('Held Minus'), interval '1 hour');
  q2 := pg_temp.part(b, 'The Hold', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')), interval '1 hour');
  perform tests.become(pg_temp.admin());
  answer := hold_move(q1);
  perform tests.unbecome();
  perform pg_temp.expect((pg_temp.qrow(q1)).held_at is not null and (pg_temp.qrow(q2)).held_at is not null, 'holding the first part did not hold the second');
  perform pg_temp.expect((pg_temp.qrow(q1)).held_at = (pg_temp.qrow(q2)).held_at and (pg_temp.qrow(q1)).held_by = (pg_temp.qrow(q2)).held_by and (pg_temp.qrow(q2)).held_by = pg_temp.admin(),
    'the second part was held at another instant or by another account');
  perform pg_temp.expect(answer ->> 'id' = q1::text and answer -> 'heldAlso' = to_jsonb(array[q2]), 'the answer does not say what was held with it: ' || answer::text);
  -- A move already held answers as it did before; holding it again is refused.
  perform tests.become(pg_temp.admin());
  msg := pg_temp.refusal(format('select hold_move(%L)', q2));
  perform tests.unbecome();
  perform pg_temp.expect(msg like '55000%already held%', 'holding the held second part again: ' || coalesce(msg, 'allowed'));
  -- Holding the second leaves the first.
  c1 := pg_temp.part(c, 'The Other Hold', 'minus', 'createBoard', pg_temp.mkboard('Other Minus'), interval '1 hour');
  c2 := pg_temp.part(c, 'The Other Hold', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')), interval '1 hour');
  perform tests.become(pg_temp.admin());
  perform hold_move(c2);
  perform tests.unbecome();
  perform pg_temp.expect((pg_temp.qrow(c2)).held_at is not null and (pg_temp.qrow(c1)).held_at is null, 'holding the second part touched the first');
  -- A chain: a is made, b is made with a as its fallback, and c merges b into a. Holding a holds b (which names it) and c (which names both): breadth first, one instant.
  d1 := pg_temp.part(d, 'The Chain', 'a', 'createBoard', pg_temp.mkboard('Chain A'), interval '1 hour');
  d2 := pg_temp.part(d, 'The Chain', 'b', 'createBoard', pg_temp.mkboard('Chain B') || jsonb_build_object('fallback', jsonb_build_object('role', 'a')), interval '1 hour');
  c3 := pg_temp.part(d, 'The Chain', 'c', 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'b'), 'into', jsonb_build_object('role', 'a')), interval '1 hour');
  perform pg_temp.expect((pg_temp.qrow(d2)).depends_on = array[d1] and (pg_temp.qrow(c3)).depends_on @> array[d1, d2] and cardinality((pg_temp.qrow(c3)).depends_on) = 2, 'the chain''s dependencies are not as the roles name them: ' || (pg_temp.qrow(c3)).depends_on::text);
  perform tests.become(pg_temp.admin());
  answer := hold_move(d1);
  perform tests.unbecome();
  perform pg_temp.expect((select count(distinct held_at) = 1 and count(*) = 3 from queued_moves where id in (d1, d2, c3) and held_at is not null), 'the chain was not held whole at one instant');
  perform pg_temp.expect(jsonb_array_length(answer -> 'heldAlso') = 2, 'the answer does not count the two held with it: ' || answer::text);
  -- The cleanup: the first of the other bundle waits no more.
  update queued_moves set held_at = now(), held_by = pg_temp.admin() where id = c1;
end $$;

-- ---- 4. Reversing: the first part's landed Act ends the second's as reversed too, each with its own move_end ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Reversed Bundle', 'general');
  q1 bigint;
  q2 bigint;
  a1 uuid;
  a2 uuid;
  made uuid;
  answer jsonb;
begin
  q1 := pg_temp.part(b, 'The Reversal', 'minus', 'createBoard', pg_temp.mkboard('Reversed Minus'));
  q2 := pg_temp.part(b, 'The Reversal', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform system_tick();
  a1 := (pg_temp.qrow(q1)).landed_act;
  a2 := (pg_temp.qrow(q2)).landed_act;
  made := pg_temp.made_by(a1);
  perform pg_temp.expect(a2 is not null and pg_temp.at(t) = made, 'the bundle did not land');
  perform tests.become(pg_temp.admin());
  answer := reverse_move(a1);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(a1) = 'reversed/admin', 'the first part did not end as reversed by an admin: ' || pg_temp.ends(a1));
  perform pg_temp.expect(pg_temp.ends(a2) = 'reversed/admin', 'the second part did not end as reversed by an admin: ' || pg_temp.ends(a2));
  perform pg_temp.expect((select count(distinct e.id) = 2 from acts e where e.kind = 'move_end' and e.target_act_id in (a1, a2)), 'each part has not its own move_end');
  perform pg_temp.expect(answer ->> 'act' = a1::text and jsonb_array_length(answer -> 'alsoEnded') = 1 and answer -> 'alsoEnded' ->> 0 = a2::text, 'the answer does not name the act ended with it: ' || answer::text);
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'the thread did not go back to where it was started');
  perform pg_temp.expect(not exists (select 1 from open_moves where move_act in (a1, a2)), 'a part is still in force');
  perform pg_temp.expect(exists (select 1 from boards_now n where n.id = made and n.closed), 'the board the first part made is not closed');
  perform pg_temp.settled('a bundle reversed');
  -- Reversing the first again is refused, as any second end is.
  perform tests.become(pg_temp.admin());
  perform pg_temp.expect(pg_temp.refusal(format('select reverse_move(%L)', a1)) like '55000%already ended%', 'a second reversal was allowed');
  perform tests.unbecome();
end $$;

-- ---- 4b. Reversing the second leaves the first ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Second Reversed', 'general');
  q1 bigint;
  q2 bigint;
  a1 uuid;
  a2 uuid;
begin
  q1 := pg_temp.part(b, 'The Second Reversal', 'minus', 'createBoard', pg_temp.mkboard('Second Minus'));
  q2 := pg_temp.part(b, 'The Second Reversal', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform system_tick();
  a1 := (pg_temp.qrow(q1)).landed_act;
  a2 := (pg_temp.qrow(q2)).landed_act;
  perform tests.become(pg_temp.admin());
  perform reverse_move(a2);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(a2) = 'reversed/admin' and pg_temp.ends(a1) = '' and exists (select 1 from open_moves where move_act = a1), 'reversing the second part touched the first: ' || pg_temp.ends(a1));
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'the thread did not go back');
end $$;

-- ---- 5. Later moves: a moveThread queued after the board was made, outside any bundle, depends on the creation and is reversed with it ----
do $$
declare
  b uuid := gen_random_uuid();
  t1 uuid := pg_temp.mk('Later One', 'general');
  t2 uuid := pg_temp.mk('Later Two', 'general');
  t3 uuid := pg_temp.mk('Later Three', 'general');
  q1 bigint;
  l1 bigint;
  l2 bigint;
  l3 bigint;
  a1 uuid;
  la1 uuid;
  made uuid;
  answer jsonb;
begin
  q1 := pg_temp.part(b, 'The Late Ones', 'minus', 'createBoard', pg_temp.mkboard('Late Minus'));
  perform system_tick();
  a1 := (pg_temp.qrow(q1)).landed_act;
  made := pg_temp.made_by(a1);
  -- Queued at a later meeting, by its board's id.
  l1 := pg_temp.queue('moveThread', jsonb_build_object('thread', t1, 'board', made));
  perform pg_temp.expect((pg_temp.qrow(l1)).depends_on = array[q1], 'a later move into a made board does not depend on its creation: ' || coalesce((pg_temp.qrow(l1)).depends_on::text, 'null'));
  perform pg_temp.expect((pg_temp.qrow(l1)).bundle is null, 'a later move is in a bundle');
  la1 := pg_temp.land(l1);
  perform pg_temp.expect((select count(*) from move_dependencies d where d.act = la1 and d.on_act = a1) = 1, 'the later move''s dependency was not recorded when it landed');
  -- One that has not landed yet when the creation is reversed is held with it; a move into a board nothing made depends on nothing.
  l2 := pg_temp.queue('moveThread', jsonb_build_object('thread', t2, 'board', made), interval '1 hour');
  l3 := pg_temp.queue('moveThread', jsonb_build_object('thread', t3, 'board', pg_temp.board('elsewhere')));
  perform pg_temp.expect((pg_temp.qrow(l3)).depends_on is null or (pg_temp.qrow(l3)).depends_on = '{}', 'a move into a seeded board depends on something');
  perform pg_temp.expect(pg_temp.at(t1) = made, 'the later move did not put the thread on the made board');
  perform tests.become(pg_temp.admin());
  answer := reverse_move(a1);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(la1) = 'reversed/admin', 'the later move was not reversed with the creation: ' || pg_temp.ends(la1));
  perform pg_temp.expect(answer -> 'alsoEnded' = to_jsonb(array[la1]) and answer -> 'heldAlso' = to_jsonb(array[l2]), 'the answer does not say what followed: ' || answer::text);
  perform pg_temp.expect((pg_temp.qrow(l2)).held_at is not null and (pg_temp.qrow(l2)).held_by = pg_temp.admin(), 'the move waiting to go into the board was not held with the creation');
  perform pg_temp.expect(pg_temp.at(t1) = pg_temp.board('general'), 'the thread has not a board it was started on');
  perform pg_temp.land(l3);
  perform pg_temp.expect(pg_temp.at(t3) = pg_temp.board('elsewhere'), 'an unrelated move was affected');
  perform pg_temp.settled('later moves reversed with their creation');
end $$;

-- ---- 6. The log: moves_log grows bundle and role at its end ----
do $$
declare
  cols text[];
  b uuid;
  a1 uuid;
  row_ record;
begin
  select array_agg(a.attname::text order by a.attnum) into cols from pg_attribute a where a.attrelid = 'moves_log'::regclass and a.attnum > 0 and not a.attisdropped;
  perform pg_temp.expect(cols[array_length(cols, 1) - 1] = 'bundle' and cols[array_length(cols, 1)] = 'role', 'moves_log does not end with bundle and role: ' || cols::text);
  perform pg_temp.expect(cols[1:12] = array['id', 'staff', 'kind', 'params', 'demand', 'expires_at', 'thread', 'at', 'ended_why', 'ended_by', 'ended_at', 'kept_by'], 'moves_log''s first columns changed: ' || cols::text);
  select q.bundle, q.landed_act into b, a1 from queued_moves q where q.bundle_name = 'The Reversal' and q.role = 'minus';
  select * into row_ from moves_log where id = a1;
  perform pg_temp.expect(row_.bundle = b and row_.role = 'minus' and row_.ended_why = 'reversed', 'moves_log does not say the part''s bundle and role: ' || to_jsonb(row_)::text);
  perform pg_temp.expect((select count(*) from moves_log where kind = 'moveThread' and bundle is null and role is null) >= 1, 'a move outside a bundle has a bundle or a role in the log');
  perform pg_temp.expect((select count(*) from moves_log where kind in ('visit', 'report', 'appeal') and (bundle is not null or role is not null)) = 0, 'a visit has a bundle');
end $$;

-- ---- 7. The queue: each part's bundle, role and the bundle's name, in every group a part can be in ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Queue Bundle', 'general');
  q1 bigint;
  q2 bigint;
  a1 uuid;
  qj jsonb;
  row_ jsonb;
begin
  q1 := pg_temp.part(b, 'The Queue Split', 'minus', 'createBoard', pg_temp.mkboard('Queue Minus'));
  q2 := pg_temp.part(b, 'The Queue Split', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')), interval '1 hour');
  -- A plain move waiting beside them, in no bundle.
  perform pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('elsewhere')), interval '2 days');
  perform tests.become(pg_temp.admin());
  qj := admin_queue();
  perform tests.unbecome();
  select x into row_ from jsonb_array_elements(qj -> 'waiting') x where (x ->> 'id')::bigint = q2;
  perform pg_temp.expect(row_ ->> 'bundle' = b::text and row_ ->> 'role' = 'move' and row_ ->> 'bundleName' = 'The Queue Split', 'a waiting part does not say its bundle: ' || coalesce(row_::text, 'not there'));
  select x into row_ from jsonb_array_elements(qj -> 'waiting') x where (x ->> 'id')::bigint = q1;
  perform pg_temp.expect(row_ ->> 'bundle' = b::text and row_ ->> 'role' = 'minus', 'the first waiting part does not say its bundle: ' || coalesce(row_::text, 'not there'));
  perform pg_temp.expect((select count(*) from jsonb_array_elements(qj -> 'waiting') x where x ? 'bundle' and (x -> 'bundle') = 'null'::jsonb) >= 1, 'a waiting move outside a bundle has no null bundle');
  perform system_tick();
  a1 := (pg_temp.qrow(q1)).landed_act;
  perform tests.become(pg_temp.admin());
  qj := admin_queue();
  perform tests.unbecome();
  select x into row_ from jsonb_array_elements(qj -> 'inForce') x where (x ->> 'act')::uuid = a1;
  perform pg_temp.expect(row_ ->> 'bundle' = b::text and row_ ->> 'role' = 'minus' and row_ ->> 'bundleName' = 'The Queue Split', 'an in-force part does not say its bundle: ' || coalesce(row_::text, 'not there'));
  -- Held: the second goes to the ended group with its bundle; reversed: so does the first.
  perform tests.become(pg_temp.admin());
  perform hold_move(q2);
  perform reverse_move(a1);
  qj := admin_queue();
  perform tests.unbecome();
  select x into row_ from jsonb_array_elements(qj -> 'ended') x where (x ->> 'id')::bigint = q2 and x ->> 'how' = 'held';
  perform pg_temp.expect(row_ ->> 'bundle' = b::text and row_ ->> 'role' = 'move' and row_ ->> 'bundleName' = 'The Queue Split', 'a held part does not say its bundle: ' || coalesce(row_::text, 'not there'));
  select x into row_ from jsonb_array_elements(qj -> 'ended') x where (x ->> 'act')::uuid = a1;
  perform pg_temp.expect(row_ ->> 'bundle' = b::text and row_ ->> 'role' = 'minus' and row_ ->> 'how' = 'reversed', 'a reversed part does not say its bundle: ' || coalesce(row_::text, 'not there'));
end $$;

-- ---- 8. move_dependencies is insert-only and no client's: update, delete and truncate are refused, in replica mode too; the API roles reach nothing ----
do $$
declare
  d record;
  msg text;
begin
  select * into d from move_dependencies limit 1;
  perform pg_temp.expect(d.act is not null, 'no dependency was recorded by the cases above');
  msg := pg_temp.refusal(format('update move_dependencies set on_act = act where act = %L', d.act));
  perform pg_temp.expect(msg like '%never changes%' or msg like '%only ever added%', 'a dependency was updated: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('delete from move_dependencies where act = %L', d.act));
  perform pg_temp.expect(msg like '%only ever added%' or msg like '%never changes%', 'a dependency was deleted: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('truncate move_dependencies');
  perform pg_temp.expect(msg like '%only ever added%' or msg like '%never changes%', 'the dependencies were truncated: ' || coalesce(msg, 'allowed'));
  set local session_replication_role = replica;
  msg := pg_temp.refusal(format('delete from move_dependencies where act = %L', d.act));
  perform pg_temp.expect(msg like '%only ever added%' or msg like '%never changes%', 'a dependency was deleted in replica mode: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('truncate move_dependencies');
  perform pg_temp.expect(msg like '%only ever added%' or msg like '%never changes%', 'the dependencies were truncated in replica mode: ' || coalesce(msg, 'allowed'));
  set local session_replication_role = origin;
  msg := pg_temp.refusal(format('insert into move_dependencies (act, on_act) values (%L, %L)', d.act, d.act));
  perform pg_temp.expect(msg is not null, 'a move was made to depend on itself');
  msg := pg_temp.refusal(format('insert into move_dependencies (act, on_act) select %L, a.id from acts a where a.kind <> ''move'' limit 1', d.act));
  perform pg_temp.expect(msg is not null, 'a move was made to depend on an Act that is no move');
  perform pg_temp.expect((select c.relrowsecurity from pg_class c where c.oid = 'move_dependencies'::regclass), 'row level security is off on move_dependencies');
  perform pg_temp.expect(not has_table_privilege('authenticated', 'move_dependencies', 'select,insert,update,delete,truncate') and not has_table_privilege('anon', 'move_dependencies', 'select,insert,update,delete,truncate'), 'a client reaches move_dependencies');
  perform pg_temp.expect((select count(*) = 2 from pg_trigger t where t.tgrelid = 'move_dependencies'::regclass and t.tgenabled = 'A' and not t.tgisinternal and t.tgname in ('move_dependencies_no_update', 'move_dependencies_no_truncate')), 'the guards of move_dependencies do not fire always');
  perform pg_temp.expect((select count(*) from pg_proc p where p.proname in ('hold_move', 'reverse_move', 'admin_queue', 'queued_moves_guard', 'system_tick', 'move_dependencies_guard') and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) = 6, 'a definer does not pin its search_path');
end $$;

-- ---- 9. A part waiting on its role's part says so in the queue: waitsFor names the part, and a part that waits for none has none ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Waits', 'general');
  q1 bigint;
  q2 bigint;
  qj jsonb;
  w1 jsonb;
  w2 jsonb;
begin
  q1 := pg_temp.part(b, 'The Waiters', 'minus', 'createBoard', pg_temp.mkboard('Waiters Minus'));
  q2 := pg_temp.part(b, 'The Waiters', 'move', 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus')));
  perform tests.become(pg_temp.admin());
  qj := admin_queue();
  perform tests.unbecome();
  select x into w1 from jsonb_array_elements(qj -> 'waiting') x where (x ->> 'id')::bigint = q1;
  select x into w2 from jsonb_array_elements(qj -> 'waiting') x where (x ->> 'id')::bigint = q2;
  perform pg_temp.expect(w1 -> 'waitsFor' = '[]'::jsonb, 'the first part waits for something: ' || coalesce((w1 -> 'waitsFor')::text, 'no key'));
  perform pg_temp.expect(jsonb_array_length(w2 -> 'waitsFor') = 1 and w2 #>> '{waitsFor,0,id}' = q1::text and w2 #>> '{waitsFor,0,role}' = 'minus' and w2 #>> '{waitsFor,0,name}' = 'Waiters Minus' and w2 #>> '{waitsFor,0,kind}' = 'createBoard',
    'the second part does not say it waits for the first: ' || coalesce((w2 -> 'waitsFor')::text, 'no key'));
  update queued_moves set held_at = now(), held_by = pg_temp.admin() where bundle = b;
end $$;

-- ---- 10. A creation reversed after what built on it landed: every live dependent ends reversed, every thread has a board, no drift ----
do $$
declare
  b uuid := gen_random_uuid();
  t1 uuid := pg_temp.mk('Late A', 'general');
  t2 uuid := pg_temp.mk('Late B', 'general');
  q uuid;
  qc bigint;
  ac uuid;
  made uuid;
  m1 uuid;
  m2 uuid;
  mg uuid;
begin
  -- Several dependents at later meetings, a merge of a board into the made one among them.
  qc := pg_temp.part(b, 'The Held Creation', 'minus', 'createBoard', pg_temp.mkboard('Held Creation'));
  perform system_tick();
  ac := (pg_temp.qrow(qc)).landed_act;
  made := pg_temp.made_by(ac);
  m1 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t1, 'board', made)));
  m2 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t2, 'board', made)));
  mg := pg_temp.land(pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('fourth'), 'into', made)));
  perform pg_temp.expect(pg_temp.at(t1) = made and pg_temp.at(t2) = made, 'the threads did not land on the made board');
  perform tests.become(pg_temp.admin());
  perform reverse_move(ac);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(m1) = 'reversed/admin' and pg_temp.ends(m2) = 'reversed/admin' and pg_temp.ends(mg) = 'reversed/admin', 'a dependent did not end as reversed: ' || pg_temp.ends(m1) || ' ' || pg_temp.ends(m2) || ' ' || pg_temp.ends(mg));
  perform pg_temp.expect(not exists (select 1 from open_moves where move_act in (ac, m1, m2, mg)), 'a dependent is still in force');
  perform pg_temp.expect(pg_temp.at(t1) = pg_temp.board('general') and pg_temp.at(t2) = pg_temp.board('general'), 'a thread has not the board it was started on');
  perform pg_temp.expect(not exists (select 1 from threads t where not exists (select 1 from boards b2 where b2.id = t.board)), 'a thread has no board');
  perform pg_temp.expect(board_is_open(pg_temp.board('fourth')), 'the merged board did not reopen');
  perform pg_temp.settled('several dependents reversed with their creation');
end $$;

do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('In then out', 'general');
  qc bigint;
  ac uuid;
  made uuid;
  m_in uuid;
  m_out uuid;
begin
  -- A thread moved in and then out: the first move is superseded, the second builds on nothing made.
  qc := pg_temp.part(b, 'The Round Trip', 'minus', 'createBoard', pg_temp.mkboard('Round Trip'));
  perform system_tick();
  ac := (pg_temp.qrow(qc)).landed_act;
  made := pg_temp.made_by(ac);
  m_in := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', made)));
  m_out := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', pg_temp.board('elsewhere'))));
  perform pg_temp.expect(pg_temp.ends(m_in) = 'superseded/landing' and pg_temp.at(t) = pg_temp.board('elsewhere'), 'the thread did not go in and out: ' || pg_temp.ends(m_in));
  perform tests.become(pg_temp.admin());
  perform reverse_move(ac);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(m_in) like '%reversed/admin', 'the superseded move into the board was not reversed with it: ' || pg_temp.ends(m_in));
  perform pg_temp.expect(pg_temp.ends(m_out) = '' and exists (select 1 from open_moves where move_act = m_out), 'the move out, which built on nothing made, ended');
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('elsewhere'), 'the thread left the board the later move put it on');
  perform pg_temp.settled('a thread moved in and out');
end $$;

do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mk('Three deep', 'general');
  qx bigint;
  ax uuid;
  bx uuid;
  ay uuid;
  by_ uuid;
  m uuid;
begin
  -- A three-deep chain: X made; Y made later with X as its fallback; a thread moved into Y.
  qx := pg_temp.part(b, 'The Chain Held', 'minus', 'createBoard', pg_temp.mkboard('Deep X'));
  perform system_tick();
  ax := (pg_temp.qrow(qx)).landed_act;
  bx := pg_temp.made_by(ax);
  ay := pg_temp.land(pg_temp.queue('createBoard', pg_temp.mkboard('Deep Y') || jsonb_build_object('fallback', bx)));
  by_ := pg_temp.made_by(ay);
  m := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', by_)));
  perform pg_temp.expect(pg_temp.at(t) = by_, 'the thread is not on the third board');
  perform tests.become(pg_temp.admin());
  perform reverse_move(ax);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ends(ay) = 'reversed/admin' and pg_temp.ends(m) = 'reversed/admin', 'the chain was not reversed to its end: ' || pg_temp.ends(ay) || ' ' || pg_temp.ends(m));
  perform pg_temp.expect(pg_temp.at(t) = pg_temp.board('general'), 'the thread has not the board it was started on');
  perform pg_temp.settled('a three-deep chain');
end $$;

do $$
declare
  b uuid := gen_random_uuid();
  t1 uuid := pg_temp.mk('Ended first', 'general');
  t2 uuid := pg_temp.mk('Live second', 'general');
  qc bigint;
  ac uuid;
  made uuid;
  m1 uuid;
  m2 uuid;
  answer jsonb;
begin
  -- A dependent already ended (reversed alone) is skipped by the traversal; the live one still follows.
  qc := pg_temp.part(b, 'The Skipped', 'minus', 'createBoard', pg_temp.mkboard('Skipped Place'));
  perform system_tick();
  ac := (pg_temp.qrow(qc)).landed_act;
  made := pg_temp.made_by(ac);
  m1 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t1, 'board', made)));
  m2 := pg_temp.land(pg_temp.queue('moveThread', jsonb_build_object('thread', t2, 'board', made)));
  perform tests.become(pg_temp.admin());
  perform reverse_move(m1);
  answer := reverse_move(ac);
  perform tests.unbecome();
  perform pg_temp.expect(answer -> 'alsoEnded' = to_jsonb(array[m2]), 'the traversal did not skip the ended dependent: ' || answer::text);
  perform pg_temp.expect(pg_temp.ends(m1) = 'reversed/admin' and pg_temp.ends(m2) = 'reversed/admin', 'a dependent is not reversed once: ' || pg_temp.ends(m1) || ' ' || pg_temp.ends(m2));
  perform pg_temp.expect(pg_temp.at(t1) = pg_temp.board('general') and pg_temp.at(t2) = pg_temp.board('general'), 'a thread has no board of its own');
  perform pg_temp.settled('a dependent already ended');
end $$;
