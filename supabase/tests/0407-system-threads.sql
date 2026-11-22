-- The staff's threads live on the system board (supabase/migrations/0407_system_threads_follow_the_flag.sql; docs/plans/2026-11-22-system-threads-follow-the-flag-plan.md, Task 1).
-- system_threads() is the threads the instance itself makes (the announcements thread, the Updates thread and each season's Turns thread). thread_place and thread_places_computed
-- put every one of them on system_board(), whichever board the thread was started on and whatever a move says, so moving the flag moves them.

-- Two boards, `a` flagged. The fixture's own system board is unflagged first (boards_one_system allows one).
update boards set is_system = false where is_system;
insert into boards (slug, name, is_system) values ('sta', 'A', true);
insert into boards (slug, name) values ('stb', 'B');
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.mk(title text, on_slug text) returns uuid language sql as $$
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id
$$;
insert into settings (key, value) values
  ('systemAnnouncements', to_jsonb(pg_temp.mk('Announcements', 'sta')::text)),
  ('updatesThread', to_jsonb(pg_temp.mk('Updates', 'sta')::text));
update seasons set turns_thread = pg_temp.mk('Turns', 'sta') where number = 1;
select pg_temp.mk('Ordinary', 'sta');

-- ---- system_threads(): the three, and nothing else ----
do $$
declare
  want uuid[] := array[(select id from threads where title = 'Announcements'), (select id from threads where title = 'Updates'), (select id from threads where title = 'Turns')];
  got uuid[];
begin
  select array_agg(x order by x) into got from system_threads() x;
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
  written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload)
  values ((select id from characters where staff = 'st-boss'), 'move', ann,
          jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', ann, 'board', pg_temp.board('sta')), 'body', 'landed')) returning id into written;
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
  if (select count(*) from threads t where t.id in (select system_threads()) and t.board is distinct from system_board()) is distinct from 0::bigint then raise exception 'a system thread is stored off the system board'; end if;
end $$;
