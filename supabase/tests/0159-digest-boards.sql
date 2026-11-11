-- The digest's board lines (supabase/migrations/0157_digest_boards.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 7; design section 4, "Noticing").
--
-- system_digest returns `boards`: each open, non-system board's {id, name, premise, posts}, posts counted over `digestBoardDays` before the window's end, on the board
-- each thread is on now. At most `digestBoards` of them; with more boards than that, the busiest half and the quietest half. The lines read posts per board and nothing
-- else: no owner, no account, no class, no reaction. The two settings are checked where they are written, and the digest meets an instance that has not set them.
--
-- The world: a seed that lists the three lasting kinds (as 0158 does), so a board can be made and another merged away; seven open boards with counts 6, 5, 4, 3, 2, 1 and 0
-- in the window, posts just outside it that are not counted, and a post on The System's board that is not listed.

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

do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'db-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'db-boss', 'name', 'Digest Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.queue(kind text, params jsonb) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'db-boss', kind, params, null, 'because', now() - interval '1 minute', now() - interval '1 minute', kind in ('createBoard', 'mergeBoard')) returning id into q;
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
-- n posts by `by_c` in a new thread on the board, the first at `at` and one more a minute after each.
create function pg_temp.posts(by_c uuid, on_slug text, n integer, at timestamptz) returns uuid language plpgsql as $$
declare
  t uuid;
  i integer;
begin
  insert into threads (board, title) values (pg_temp.board(on_slug), 'Thread on ' || on_slug || ' at ' || at::text) returning id into t;
  for i in 1..n loop perform tests.post(by_c, t, 'Post ' || i, at + (i - 1) * interval '1 minute'); end loop;
  return t;
end $$;

do $$
declare
  -- Far from now: other files commit rows (the race tests) that a window around now would count.
  until_at timestamptz := '2040-06-01T12:00:00Z';
  inside timestamptz := '2040-05-25T12:00:00Z';
  acct uuid; acct2 uuid; a uuid; b uuid;
  toast uuid; sys uuid; t uuid; p uuid; q bigint;
  d jsonb; d2 jsonb;
begin
  acct := tests.account('db-a'); acct2 := tests.account('db-b');
  a := tests.character(acct, 'Db Ann'); b := tests.character(acct2, 'Db Bo');
  sys := (select id from boards where is_system);

  insert into boards (slug, name, description) values
    ('busy', 'Busy Place', 'Where it is loud.'), ('mid', 'Middle Place', 'In between.'), ('low', 'Low Place', 'Hardly a sound.'),
    ('none', 'Empty Place', 'Nobody comes.'), ('third', 'Third Place', 'To be merged.'), ('fourth', 'Fourth Place', 'Gets the merge.');
  update boards set description = 'The general board.' where slug = 'general';
  -- Toast Corner is made by a createBoard, and its premise is the one that move gave.
  q := pg_temp.queue('createBoard', jsonb_build_object('name', 'Toast Corner', 'premise', 'Toast, and only toast.', 'description', 'A new board.'));
  perform pg_temp.land(q);
  toast := pg_temp.board('toast-corner');

  -- In the window (21 days up to until_at): busy 6, general 5, fourth 2 + the 2 that come from third, mid 3, toast 2, low 1, none 0.
  perform pg_temp.posts(a, 'busy', 4, inside);
  perform pg_temp.posts(b, 'busy', 2, inside + interval '1 day');
  perform pg_temp.posts(b, 'general', 5, inside);
  perform pg_temp.posts(a, 'fourth', 2, inside);
  perform pg_temp.posts(a, 'third', 2, inside);
  perform pg_temp.posts(b, 'mid', 3, inside);
  perform pg_temp.posts(a, 'toast-corner', 2, inside);
  perform pg_temp.posts(a, 'low', 1, inside);
  -- Not counted: posts before the 21 days, posts at or after the window's end, and a post on The System's board.
  perform pg_temp.posts(a, 'none', 4, until_at - interval '22 days');
  perform pg_temp.posts(a, 'low', 3, until_at);
  insert into threads (board, title) values (sys, 'On the system board') returning id into t;
  perform tests.post(a, t, 'Hello.', inside);
  -- Third is merged into Fourth: it closes, and its thread's posts are Fourth's now.
  q := pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('third'), 'into', pg_temp.board('fourth')));
  perform pg_temp.land(q);
  perform pg_temp.expect((select closed from boards_now where slug = 'third'), 'setup: Third is not closed');

  perform tests.become_service();

  -- ---- 1. An instance that has not set the two settings gets the defaults: 30 lines over 21 days. All seven open boards, none of The System's or the closed one. ----
  delete from settings where key in ('digestBoards', 'digestBoardDays');
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '5'), ('digestExcerptChars', '20') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect(jsonb_typeof(d -> 'boards') = 'array', 'the digest has no boards list: ' || d::text);
  perform pg_temp.expect((d ->> 'boardDays') = '21', 'the digest does not say its days: ' || coalesce(d ->> 'boardDays', 'nothing'));
  perform pg_temp.expect(jsonb_array_length(d -> 'boards') = 7, 'the digest does not list the seven open boards: ' || (d -> 'boards')::text);
  perform pg_temp.expect(d -> 'boards' -> 0 ->> 'name' = 'Busy Place' and d -> 'boards' -> 2 ->> 'name' = 'Fourth Place' and d -> 'boards' -> 6 ->> 'name' = 'Empty Place', 'the boards are not busiest first: ' || (d -> 'boards')::text);
  perform pg_temp.expect((select array_agg((e ->> 'posts')::integer order by ord) from jsonb_array_elements(d -> 'boards') with ordinality x(e, ord)) = array[6, 5, 4, 3, 2, 1, 0],
    'the counts are not 6, 5, 4, 3, 2, 1, 0 (a merged board''s posts are the board it went to; outside the days or after the end, nothing): ' || (d -> 'boards')::text);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(d -> 'boards') e where e ->> 'name' in ('Third Place')) and not exists (select 1 from jsonb_array_elements(d -> 'boards') e where (e ->> 'id')::uuid = sys),
    'the closed board or The System''s board is listed');
  -- The premise: a made board's is its move's, another's is its description.
  perform pg_temp.expect((select e ->> 'premise' from jsonb_array_elements(d -> 'boards') e where (e ->> 'id')::uuid = toast) = 'Toast, and only toast.', 'a made board''s premise is not its move''s');
  perform pg_temp.expect((select e ->> 'premise' from jsonb_array_elements(d -> 'boards') e where (e ->> 'id')::uuid = pg_temp.board('busy')) = 'Where it is loud.', 'a board''s premise is not its description');
  -- Only what a board's page shows.
  perform pg_temp.expect((select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['id', 'name', 'posts', 'premise']) from jsonb_array_elements(d -> 'boards') e),
    'a board line holds more than id, name, premise and posts: ' || (d -> 'boards' -> 0)::text);

  -- ---- 2. The cap: the busiest half and the quietest half (the busiest take the odd one). ----
  insert into settings (key, value) values ('digestBoards', '4') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect((select array_agg((e ->> 'posts')::integer order by ord) from jsonb_array_elements(d -> 'boards') with ordinality x(e, ord)) = array[6, 5, 1, 0],
    'a cap of 4 is not the two busiest and the two quietest: ' || (d -> 'boards')::text);
  insert into settings (key, value) values ('digestBoards', '5') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect((select array_agg((e ->> 'posts')::integer order by ord) from jsonb_array_elements(d -> 'boards') with ordinality x(e, ord)) = array[6, 5, 4, 1, 0],
    'a cap of 5 is not the three busiest and the two quietest: ' || (d -> 'boards')::text);
  insert into settings (key, value) values ('digestBoards', '1') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect((select array_agg((e ->> 'posts')::integer) from jsonb_array_elements(d -> 'boards') e) = array[6], 'a cap of 1 is not the busiest: ' || (d -> 'boards')::text);
  -- A cap the boards do not reach lists them all.
  insert into settings (key, value) values ('digestBoards', '7') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect(jsonb_array_length(d -> 'boards') = 7, 'a cap equal to the boards dropped one: ' || (d -> 'boards')::text);

  -- ---- 3. The days: a shorter span leaves out the older posts; a longer one takes in those from 22 days back. ----
  insert into settings (key, value) values ('digestBoards', '30'), ('digestBoardDays', '3') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect((select coalesce(sum((e ->> 'posts')::integer), 0) from jsonb_array_elements(d -> 'boards') e) = 0, '3 days back from the end should hold no post: ' || (d -> 'boards')::text);
  insert into settings (key, value) values ('digestBoardDays', '30') on conflict (key) do update set value = excluded.value;
  d := system_digest(until_at - interval '1 day', until_at);
  perform pg_temp.expect((select (e ->> 'posts')::integer from jsonb_array_elements(d -> 'boards') e where (e ->> 'id')::uuid = pg_temp.board('none')) = 4, '30 days back should take in the 4 posts from 22 days back');
  insert into settings (key, value) values ('digestBoardDays', '21') on conflict (key) do update set value = excluded.value;

  -- ---- 4. Posts per board only: the window's start does not move the count (it counts days before its end), and a reaction is not read (none is granted to the digest role). ----
  d := system_digest(until_at - interval '1 day', until_at);
  d2 := system_digest(until_at - interval '1 hour', until_at);
  perform pg_temp.expect(d -> 'boards' = d2 -> 'boards', 'the window''s start changed the boards');

  -- ---- 5. The index the count reads: posts by time, so 21 days of posts is a range scan and not a walk of every Act. ----
  perform pg_temp.expect(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'acts' and indexname = 'acts_posts_by_time'), 'there is no index of posts by time');
  perform tests.unbecome();

  -- ---- 6. The settings are checked where they are written. ----
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoards', '0') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoards%', 'digestBoards 0 was allowed');
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoards', '31') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoards%', 'digestBoards 31 was allowed');
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoards', '"many"') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoards%', 'digestBoards "many" was allowed');
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoardDays', '0') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoardDays%', 'digestBoardDays 0 was allowed');
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoardDays', '366') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoardDays%', 'digestBoardDays 366 was allowed');
  perform pg_temp.expect(pg_temp.refusal($q$insert into settings (key, value) values ('digestBoardDays', '1.5') on conflict (key) do update set value = excluded.value$q$) like '23514%digestBoardDays%', 'digestBoardDays 1.5 was allowed');
  insert into settings (key, value) values ('digestBoards', '30'), ('digestBoardDays', '365') on conflict (key) do update set value = excluded.value;
end $$;
