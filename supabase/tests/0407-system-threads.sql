-- The staff's threads live on the system board (supabase/migrations/0407_system_threads_follow_the_flag.sql; docs/plans/2026-11-22-system-threads-follow-the-flag-plan.md, Task 1).
-- system_threads() is the threads the instance itself makes (the announcements thread, the Updates thread and each season's Turns thread). thread_place and thread_places_computed
-- put every one of them on system_board(), whichever board the thread was started on and whatever a move says, so moving the flag moves them.

-- Staff threads (0429) that earlier files committed are unflagged here, so the set and what the seed places are exactly this file's three (this file's transaction is rolled back).
update threads set staff_placed = false where staff_placed;
-- Two boards, `a` flagged. The fixture's own system board is unflagged first (boards_one_system allows one).
update boards set is_system = false where is_system;
insert into boards (slug, name, is_system) values ('sta', 'A', true);
insert into boards (slug, name) values ('stb', 'B');
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.mk(title text, on_slug text) returns uuid language sql as $$
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id
$$;
-- Settings are upserted and the seasons made exact: an earlier file's committed state (a race test's announcements thread, a season's Turns thread) may already be there, and the set is
-- then exactly these three.
insert into settings (key, value) values
  ('systemAnnouncements', to_jsonb(pg_temp.mk('Announcements', 'sta')::text)),
  ('updatesThread', to_jsonb(pg_temp.mk('Updates', 'sta')::text))
on conflict (key) do update set value = excluded.value;
update seasons set turns_thread = null;
update seasons set turns_thread = pg_temp.mk('Turns', 'sta') where number = 1;
select pg_temp.mk('Ordinary', 'sta');

-- ---- system_threads(): the three, and nothing else ----
do $$
declare
  want uuid[] := array[(select id from threads where title = 'Announcements'), (select id from threads where title = 'Updates'), (select id from threads where title = 'Turns')];
  got uuid[];
begin
  -- Staff threads (0429) are in system_threads() too, and an earlier file may have left some committed: instance_threads() is the three alone, the set this file is about.
  select array_agg(x order by x) into got from instance_threads() x;
  if got is distinct from (select array_agg(w order by w) from unnest(want) w) then
    raise exception 'system_threads should answer the announcements, Updates and Turns threads, got %', got;
  end if;
  if (select count(*) from system_threads() x where x is null) is distinct from 0::bigint then raise exception 'system_threads answered a null'; end if;
  if has_function_privilege('anon', 'system_threads()', 'execute') or has_function_privilege('authenticated', 'system_threads()', 'execute') or has_function_privilege('public', 'system_threads()', 'execute') then
    raise exception 'system_threads is callable by a client';
  end if;
end $$;

-- ---- with the flag on `b` (the seed's own statement), the three are placed on `b` by both functions; an ordinary thread stays ----
do $$
declare
  ordinary uuid := (select id from threads where title = 'Ordinary');
  t uuid;
begin
  update boards set is_system = false where is_system;
  update boards set is_system = true where slug = 'stb';
  foreach t in array array[(select id from threads where title = 'Announcements'), (select id from threads where title = 'Updates'), (select id from threads where title = 'Turns')] loop
    if thread_place(t) is distinct from pg_temp.board('stb') then raise exception 'thread_place did not follow the flag for %', (select title from threads where id = t); end if;
    if (select c.place from thread_places_computed() c where c.thread = t) is distinct from pg_temp.board('stb') then raise exception 'thread_places_computed did not follow the flag for %', (select title from threads where id = t); end if;
  end loop;
  if thread_place(ordinary) is distinct from pg_temp.board('sta') then raise exception 'thread_place moved an ordinary thread with the flag'; end if;
  if (select c.place from thread_places_computed() c where c.thread = ordinary) is distinct from pg_temp.board('sta') then raise exception 'thread_places_computed moved an ordinary thread with the flag'; end if;
end $$;

-- ---- a landed moveThread naming the announcements thread changes nothing: both placements still answer system_board() ----
insert into move_kinds (key, structural, shapes_board, lasting) values ('moveThread', false, false, true)
on conflict (key) do update set lasting = true;
insert into characters (name, staff, staff_kind, debuted_at) values ('Sys Boss', 'st-boss', 'persona', now());
do $$
declare
  ann uuid := (select id from threads where title = 'Announcements');
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload)
  values ((select id from characters where staff = 'st-boss'), 'move', ann,
          jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', ann, 'board', pg_temp.board('sta')), 'body', 'landed'));
  perform set_config('kayfabb.staff_writer', '', true);
  if thread_place(ann) is distinct from system_board() or system_board() is distinct from pg_temp.board('stb') then raise exception 'a landed moveThread moved the announcements thread: %', thread_place(ann); end if;
  if (select c.place from thread_places_computed() c where c.thread = ann) is distinct from system_board() then raise exception 'thread_places_computed let a moveThread move the announcements thread'; end if;
end $$;

-- ---- the meeting's moveThread refuses a thread of the staff's, even while its stored board is not yet the system board ----
do $$
declare
  ann uuid := (select id from threads where title = 'Announcements');
  ordinary uuid := (select id from threads where title = 'Ordinary');
  said text;
begin
  -- The flag is on `b` and the threads are not yet rebuilt: the announcements thread is stored on `a` and was started on it, neither the system board, so only the set itself refuses it.
  said := lasting_move_problem('moveThread', jsonb_build_object('thread', ann, 'board', pg_temp.board('sta')));
  if said is distinct from 'that thread is the staff''s own and stays on their board' then
    raise exception 'lasting_move_problem should refuse the staff''s thread in its own words, got %', said;
  end if;
  if lasting_move_problem('moveThread', jsonb_build_object('thread', ordinary, 'board', pg_temp.board('sta'))) is not null then
    raise exception 'lasting_move_problem refused an ordinary thread: %', lasting_move_problem('moveThread', jsonb_build_object('thread', ordinary, 'board', pg_temp.board('sta')));
  end if;
end $$;

-- ---- after a rebuild the stored boards agree with the computed ones ----
do $$
begin
  perform rebuild_thread_places();
  if exists (select 1 from thread_places_drift()) then raise exception 'drift after a rebuild: %', (select count(*) from thread_places_drift()); end if;
  if (select count(*) from threads t where t.id in (select instance_threads()) and t.board is distinct from system_board()) is distinct from 0::bigint then raise exception 'a system thread is stored off the system board'; end if;
end $$;

-- ================= seed_instance rebuilds and recounts the staff's threads (plan Task 2) =================
-- The seed finds every thread of the staff's that is not stored on the system board and places it there, then recounts the boards it left and the board it arrived on
-- by the rule thread_list lists by (backfill_board_counts, 0063): threads in thread_list on the board, in shard 0, the other shards zero.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.slug_of(b uuid) returns text language sql as $$ select slug from boards where id = b $$;
create function pg_temp.seeded(system_slug text) returns jsonb language sql as $$
  select seed_instance(jsonb_build_object('boards', jsonb_build_array(
    jsonb_build_object('slug', 'sta', 'name', 'A', 'system', system_slug = 'sta'),
    jsonb_build_object('slug', 'stb', 'name', 'B', 'system', system_slug = 'stb'))))
$$;
-- What a board's list shows and what its count says, as one line when they differ.
create function pg_temp.count_problem(slug text) returns text language sql as $$
  select case when listed is distinct from counted then format('%s lists %s threads and counts %s', count_problem.slug, listed, counted) end
  from (select (select count(*) from thread_list l where l.board = b.id) as listed,
               coalesce((select c.threads from board_counts c where c.board = b.id), 0) as counted
        from boards b where b.slug = count_problem.slug) x
$$;
-- Every row of the three tables a seed could write, with where it sits in its heap: an update, even to the same values, moves it.
create function pg_temp.snapshot() returns text language sql as $$
  select md5(coalesce((select string_agg(t::text || t.ctid::text, ',' order by t.id) from threads t), '')
          || coalesce((select string_agg(c::text || c.ctid::text, ',' order by c.board, c.shard) from board_thread_counts c), '')
          || coalesce((select string_agg(p::text || p.ctid::text, ',' order by p.ctid) from post_search p), ''))
$$;
create function pg_temp.staff_threads_on(slug text) returns bigint language sql as $$
  select count(*) from threads t where t.id in (select instance_threads()) and t.board = pg_temp.board(slug)
$$;

-- A thread on sta that no list shows (0063's unlisted_threads), counted by 0030's insert trigger: a recount by anything but thread_list leaves sta's count one too high.
insert into unlisted_threads (thread) values (pg_temp.mk('Unlisted', 'sta'));
-- A post of the staff's in the announcements thread, so there is a search row to follow the thread.
do $$
declare ann uuid := (select id from threads where title = 'Announcements');
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload) values ((select id from characters where staff = 'st-boss'), 'post', ann, jsonb_build_object('body', 'Announced.'));
  perform set_config('kayfabb.staff_writer', '', true);
  if (select count(*) from post_search p where p.thread = ann) is distinct from 1::bigint then raise exception 'the fixture post has no search row, so the seed test could not follow it'; end if;
end $$;

-- ---- 1. seed with `a` flagged, then `b`: the three follow the flag, an ordinary thread stays, the counts agree ----
do $$
declare
  ann uuid := (select id from threads where title = 'Announcements');
  ordinary uuid := (select id from threads where title = 'Ordinary');
  owner uuid := tests.account('sst-owner');
  ch uuid := tests.character(owner, 'Sst Player');
  answer jsonb;
  said text;
begin
  -- The flag is on `b` from the first file section and the three were rebuilt there; flag `a` through the seed.
  answer := pg_temp.seeded('sta');
  if pg_temp.staff_threads_on('sta') is distinct from 3::bigint then raise exception 'seeding with a flagged should put the three staff threads on a, got % on a', pg_temp.staff_threads_on('sta'); end if;
  if (answer ->> 'placed') is distinct from '3' then raise exception 'seeding with a flagged should report placed 3, got %', answer ->> 'placed'; end if;
  if pg_temp.count_problem('sta') is not null then raise exception 'after flagging a: %', pg_temp.count_problem('sta'); end if;
  if pg_temp.count_problem('stb') is not null then raise exception 'after flagging a: %', pg_temp.count_problem('stb'); end if;

  answer := pg_temp.seeded('stb');
  if pg_temp.staff_threads_on('stb') is distinct from 3::bigint then raise exception 'reseeding with b flagged should put the three staff threads on b, got % on b', pg_temp.staff_threads_on('stb'); end if;
  if (answer ->> 'placed') is distinct from '3' then raise exception 'reseeding with b flagged should report placed 3, got %', answer ->> 'placed'; end if;
  if (select t.board from threads t where t.id = ordinary) is distinct from pg_temp.board('sta') then raise exception 'the seed moved an ordinary thread'; end if;
  if (select count(*) from post_search p where p.thread = ann and p.board is distinct from pg_temp.board('stb')) is distinct from 0::bigint then raise exception 'the announcements thread''s search rows did not follow it to b'; end if;
  if pg_temp.count_problem('sta') is not null then raise exception 'after flagging b: %', pg_temp.count_problem('sta'); end if;
  if pg_temp.count_problem('stb') is not null then raise exception 'after flagging b: %', pg_temp.count_problem('stb'); end if;
  if exists (select 1 from board_thread_counts c where c.board in (pg_temp.board('sta'), pg_temp.board('stb')) and c.shard > 0 and c.threads <> 0) then raise exception 'a count was left in a shard other than 0'; end if;
  if exists (select 1 from thread_places_drift()) then raise exception 'drift after the seed placed the threads'; end if;

  -- A player's post into the announcements thread is refused: the thread is on the system board now.
  perform tests.become(owner);
  said := pg_temp.refusal(format('select post(%L, %L, %L)', ann, ch, 'Let me in.'));
  perform tests.unbecome();
  if said is distinct from 'only the staff post here; spin a thread from what they said' then raise exception 'a player''s post into the announcements thread should be refused by not_the_systems, got %', said; end if;
end $$;

-- ---- 2. a third identical reseed writes nothing ----
do $$
declare
  before_snapshot text := pg_temp.snapshot();
  answer jsonb;
begin
  answer := pg_temp.seeded('stb');
  if (answer ->> 'placed') is distinct from '0' then raise exception 'a reseed with nothing astray should report placed 0, got %', answer ->> 'placed'; end if;
  if pg_temp.snapshot() is distinct from before_snapshot then raise exception 'a reseed with nothing astray wrote to threads, board_thread_counts or post_search'; end if;
end $$;

-- ---- 3. flagging `a` again sends the three back ----
do $$
declare
  answer jsonb := pg_temp.seeded('sta');
begin
  if pg_temp.staff_threads_on('sta') is distinct from 3::bigint then raise exception 'reseeding with a flagged again should send the three back to a, got % on a', pg_temp.staff_threads_on('sta'); end if;
  if (answer ->> 'placed') is distinct from '3' then raise exception 'reseeding with a flagged again should report placed 3, got %', answer ->> 'placed'; end if;
  if pg_temp.count_problem('sta') is not null then raise exception 'after flagging a again: %', pg_temp.count_problem('sta'); end if;
  if pg_temp.count_problem('stb') is not null then raise exception 'after flagging a again: %', pg_temp.count_problem('stb'); end if;
end $$;

-- ---- 4. dw.gripe's shape: the flag was moved by an older seed and the threads left behind, with a stale count on the old board ----
do $$
declare
  answer jsonb;
begin
  -- The older seed's statement and nothing more: the flag on b, the three still stored on a, and a's count as the old triggers left it (the staff's threads and some made before
  -- 0339's rule counted, a stray in another shard), b's count off by what it never received.
  update boards set is_system = false where is_system;
  update boards set is_system = true where slug = 'stb';
  if pg_temp.staff_threads_on('sta') is distinct from 3::bigint then raise exception 'the dw.gripe fixture should leave the three on a'; end if;
  update board_thread_counts set threads = case shard when 0 then 9 when 1 then 2 else 0 end where board = pg_temp.board('sta');
  update board_thread_counts set threads = case shard when 0 then 4 else 0 end where board = pg_temp.board('stb');
  if pg_temp.count_problem('sta') is null or pg_temp.count_problem('stb') is null then raise exception 'the dw.gripe fixture should start with counts that disagree: a % b %', pg_temp.count_problem('sta'), pg_temp.count_problem('stb'); end if;

  answer := pg_temp.seeded('stb');
  if pg_temp.staff_threads_on('stb') is distinct from 3::bigint then raise exception 'the seed should find the three astray though the flag did not move in this run, got % on b', pg_temp.staff_threads_on('stb'); end if;
  if (answer ->> 'placed') is distinct from '3' then raise exception 'the dw.gripe seed should report placed 3, got %', answer ->> 'placed'; end if;
  if pg_temp.count_problem('sta') is not null then raise exception 'dw.gripe, a: %', pg_temp.count_problem('sta'); end if;
  if pg_temp.count_problem('stb') is not null then raise exception 'dw.gripe, b: %', pg_temp.count_problem('stb'); end if;
  if exists (select 1 from board_thread_counts c where c.board in (pg_temp.board('sta'), pg_temp.board('stb')) and c.shard > 0 and c.threads <> 0) then raise exception 'dw.gripe: a count was left in a shard other than 0'; end if;
end $$;

-- ---- A past season's Turns thread is the staff's too ----
-- Every season's turns_thread, past seasons included (the design, section 2): a season that ended before the open one keeps its Turns thread on the system board.
do $$
declare
  first_start timestamptz := (select min(starts_at) from seasons);
  past uuid := pg_temp.mk('Past Turns', (select slug from boards where not is_system and slug in ('sta', 'stb') limit 1));
  placed_at uuid;
begin
  insert into seasons (number, starts_at, ends_at, turns_thread)
    values ((select max(number) + 1 from seasons), first_start - interval '60 days', first_start - interval '30 days', past);
  if not exists (select 1 from system_threads() s where s = past) then
    raise exception 'system_threads should answer a past season''s Turns thread';
  end if;
  if thread_place(past) is distinct from system_board() then
    raise exception 'thread_place should put a past season''s Turns thread on the system board, got %', thread_place(past);
  end if;
  select c.place into placed_at from thread_places_computed() c where c.thread = past;
  if placed_at is distinct from system_board() then
    raise exception 'thread_places_computed should put a past season''s Turns thread on the system board, got %', placed_at;
  end if;
end $$;
