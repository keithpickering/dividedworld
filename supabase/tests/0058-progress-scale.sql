-- The scale guard for a board page's progress read (supabase/migrations/0053_stored_progress.sql; the final review of the system plan, F1).
-- move_progress(move_act) is called on every board view, by anyone, so what it costs may not grow with the board's posts since the move
-- landed: the tick counts a demand's progress at its own pace and stores it on the move's open_moves row, and this read is a probe of that
-- row. This file measures it: a landed move whose board holds 2,000 posts and then 20,000, and how many buffers (8 kB pages) one call
-- touches at each size, from EXPLAIN (ANALYZE, BUFFERS): the buffer counters are the backend's own and include the work of every function
-- the statement calls, security definer or not, which a plan's nodes do not show. The first version counted rows of `acts` through the
-- statistics views' transaction counters (pg_stat_get_xact_tuples_returned) and measured nothing on some runs: those counters are
-- flushed to the shared statistics whenever the session goes idle between statements, and a poison that reads a million rows read 0.
-- Buffers do not depend on when the statistics are flushed.
--
-- The poison is the body this migration replaced (the evaluator called on every read): the last block runs the same measure against a
-- function that does that, and the guard must go red on it. A guard that has never been red is not known to work.

-- Shared buffers (hit or read) one execution of `call_sql` touches. It is run once first, unmeasured: the first call after an ANALYZE
-- plans the function's statements again, which reads the catalogs and statistics (126 buffers against 11, whatever the board holds), and
-- that is a cost of the first call and not of the board's size.
create function pg_temp.buffers_of(call_sql text) returns bigint language plpgsql as $$
declare plan jsonb;
begin
  execute call_sql;
  execute 'explain (analyze, buffers, format json) ' || call_sql into plan;
  return coalesce((plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0);
end $$;

-- ---- A seed with a Boss, a landed move that asks for 1,000 different characters, and a board that gets posts ----
do $$
declare
  seed jsonb := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true), 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ps-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'ps-boss', 'name', 'Scale Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'distinctCharactersOnBoard'))));
  general uuid := (select id from boards where slug = 'general');
  sys uuid;
  mv uuid;
  t uuid;
begin
  perform seed_instance(seed);
  select th.id into sys from threads th join boards bd on bd.id = th.board where bd.is_system and th.title = 'Announcements';
  mv := (write_staff_act('ps-boss', 'move', sys, null, jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
    'params', jsonb_build_object('board', general, 'name', 'Scale Hall', 'premise', 'Scale.', 'description', 'About scale.'),
    'demand', jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', jsonb_build_object('board', general, 'count', 1000)),
    'expires_at', now() + interval '3 days')) ->> 'id')::uuid;
  t := tests.thread('Scale thread');
  create temp table scale_fixture as select mv as move_act, t as thread;
  create temp table scale_chars (n integer primary key, id uuid not null);
  insert into scale_chars select i, tests.character(tests.account('ps-' || i), 'Scale ' || i) from generate_series(1, 50) i;
  grant select on scale_fixture, scale_chars to public;
end $$;

-- Posts added so the board holds `upto` of them since the landing (they start after the ones already there).
create function pg_temp.fill(upto integer) returns void language plpgsql as $$
declare have integer := (select count(*) from acts where thread = (select thread from scale_fixture) and kind = 'post');
begin
  insert into acts (character, kind, thread, payload, created_at)
  select c.id, 'post', (select thread from scale_fixture), jsonb_build_object('body', 'p' || i), now() + make_interval(secs => i)
  from generate_series(have + 1, upto) i join scale_chars c on c.n = 1 + (i % 50);
  analyze acts;
end $$;

-- ---- The tick has counted the move; the read is a probe of that row at 2,000 and at 20,000 posts ----
do $$
declare
  mv uuid := (select move_act from scale_fixture);
  small bigint; big bigint; got jsonb;
begin
  perform pg_temp.fill(2000);
  perform system_tick();
  if (select progress from open_moves where move_act = mv) is null then raise exception 'the tick stored no count for the move'; end if;
  small := pg_temp.buffers_of(format('select move_progress(%L)', mv));
  perform pg_temp.fill(20000);
  big := pg_temp.buffers_of(format('select move_progress(%L)', mv));
  raise notice 'move_progress touched % buffers at 2,000 posts and % at 20,000', small, big;
  if small > 100 or big > 100 then raise exception 'move_progress touches % buffers at 2,000 posts and % at 20,000; it is a probe of a stored row', small, big; end if;
  got := move_progress(mv);
  if (got ->> 'done')::integer is distinct from 50 or (got ->> 'of')::integer is distinct from 1000 then raise exception 'the stored count is %', got;
  end if;
  -- The same guard against the body 0053 replaced: it counts, on every call, what the board holds, and the measure must see that.
  create function pg_temp.old_move_progress(move_act uuid) returns jsonb language sql as 'select demand_progress_or_error(move_act)';
  big := pg_temp.buffers_of(format('select pg_temp.old_move_progress(%L)', mv));
  raise notice 'the poison touched % buffers at 20,000 posts', big;
  if big <= 1000 then raise exception 'the guard cannot see the evaluator read the board: it measured % buffers', big; end if;
end $$;
