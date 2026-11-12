-- A thread's stored board (supabase/migrations/0171_thread_places.sql; docs/plans/2026-11-06-fangame-split-design.md, section 4; plan Task 1).
-- threads.board is where a thread is now, derived: threads.origin_board is where it was started and never changes, and thread_place computes the board from the
-- origin and the lasting moves in force. rebuild_thread_places writes the computed board where the stored one differs; thread_places_drift lists the threads where
-- they differ. All three are for service_role and the tick alone.

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;

-- A second board, three threads (two on General, one on it), made the ordinary way (start_thread would need a player; the trigger is what is under test).
insert into boards (slug, name) values ('elsewhere', 'Elsewhere');
create function pg_temp.mk(title text, on_slug text) returns uuid language sql as $$
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id
$$;
select pg_temp.mk('One', 'general'), pg_temp.mk('Two', 'general'), pg_temp.mk('Three', 'elsewhere');

-- ---- origin_board: every thread's equals its board, and a thread made later takes its board without being told ----
do $$
begin
  if (select count(*) from threads t where t.origin_board is distinct from t.board) is distinct from 0::bigint then
    raise exception 'a thread''s origin_board is not its board: %', (select array_agg(t.title) from threads t where t.origin_board is distinct from t.board);
  end if;
  if (select count(*) from threads) < 3 then raise exception 'the fixture holds no threads'; end if;
  if (select is_nullable from information_schema.columns where table_name = 'threads' and column_name = 'origin_board') is distinct from 'NO' then
    raise exception 'threads.origin_board is not required';
  end if;
  if (select col_description('threads'::regclass, a.attnum) from pg_attribute a where a.attrelid = 'threads'::regclass and a.attname = 'board') not ilike '%derived%' then
    raise exception 'the comment on threads.board does not say it is derived';
  end if;
end $$;

-- ---- refused updates: origin_board never changes, whoever asks, in any replication role, and each refusal is the trigger's own ----
do $$
declare
  t uuid := (select id from threads where title = 'One');
  refused integer := 0;
  state text;
  msg text;
begin
  begin update threads set origin_board = pg_temp.board('elsewhere') where id = t;
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state = 'P0001' and msg like '%origin_board never changes%' then refused := refused + 1; else raise exception 'refused by something else: % %', state, msg; end if; end;
  begin update threads set origin_board = null where id = t;
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state = 'P0001' and msg like '%origin_board never changes%' then refused := refused + 1; else raise exception 'refused by something else: % %', state, msg; end if; end;
  set local session_replication_role = replica;
  begin update threads set origin_board = pg_temp.board('elsewhere') where id = t;
  exception when others then get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state = 'P0001' and msg like '%origin_board never changes%' then refused := refused + 1; else raise exception 'refused by something else: % %', state, msg; end if; end;
  set local session_replication_role = origin;
  if refused <> 3 then raise exception 'an update of origin_board was allowed % time(s) of 3', 3 - refused; end if;
  update threads set origin_board = origin_board where id = t;
  if (select origin_board from threads where id = t) is distinct from pg_temp.board('general') then raise exception 'origin_board moved'; end if;
end $$;

-- ---- who may run them ----
do $$
declare
  fn text;
begin
  foreach fn in array array['thread_place(uuid)', 'rebuild_thread_places(uuid[])', 'thread_places_drift()', 'thread_places_computed()', 'board_merge_into(uuid)', 'safe_uuid(text)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('public', fn, 'execute') then
      raise exception '% is callable by a client', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then raise exception '% is not callable by service_role', fn; end if;
  end loop;
end $$;

-- ---- rebuild: with no lasting move in force it changes no row ----
do $$
declare
  changed integer;
  before_rows text := (select string_agg(t.id::text || t.board::text, ',' order by t.id) from threads t);
begin
  changed := rebuild_thread_places();
  if changed <> 0 then raise exception 'rebuild_thread_places changed % row(s) with no lasting move in force', changed; end if;
  if (select string_agg(t.id::text || t.board::text, ',' order by t.id) from threads t) is distinct from before_rows then raise exception 'rebuild moved a thread'; end if;
  if rebuild_thread_places(array[(select id from threads where title = 'One')]) <> 0 then raise exception 'rebuild of one thread changed a row'; end if;
  if thread_place((select id from threads where title = 'Three')) is distinct from pg_temp.board('elsewhere') then raise exception 'a thread with no move in force is on its origin'; end if;
end $$;

-- ---- stored equals rebuilt: no drift; and the poison, a board changed by hand, is the one row drift lists ----
do $$
declare
  t uuid := (select id from threads where title = 'Two');
  row record;
begin
  if exists (select 1 from thread_places_drift()) then raise exception 'drift on a fresh fixture: %', (select count(*) from thread_places_drift()); end if;
  -- The poison: a thread's board changed by hand, with no move behind it.
  set local session_replication_role = replica;  -- threads.board is written only by rebuild_thread_places (0192), but for a session in replica mode
  update threads set board = pg_temp.board('elsewhere') where id = t;
  set local session_replication_role = origin;
  select * into row from thread_places_drift();
  if not found or row.thread is distinct from t or row.stored is distinct from pg_temp.board('elsewhere') or row.rebuilt is distinct from pg_temp.board('general') then
    raise exception 'drift did not list the hand-edited thread: %', row;
  end if;
  if (select count(*) from thread_places_drift()) is distinct from 1::bigint then raise exception 'drift lists more than the one poisoned thread'; end if;
  -- A rebuild of another thread leaves it; a rebuild of it (or of all) heals it, once.
  if rebuild_thread_places(array[(select id from threads where title = 'One')]) <> 0 or not exists (select 1 from thread_places_drift()) then raise exception 'a rebuild of one thread touched another'; end if;
  if rebuild_thread_places() <> 1 then raise exception 'rebuild did not write the one differing row'; end if;
  if exists (select 1 from thread_places_drift()) then raise exception 'drift remains after a rebuild'; end if;
end $$;

-- ---- the lasting moves in force, as the design states them (Task 2 lands them; here a move Act is written by hand and the kinds are rows of the test's own) ----
insert into move_kinds (key, structural, shapes_board, lasting) values ('moveThread', false, false, true), ('mergeBoard', true, true, true), ('createBoard', true, true, true)
on conflict (key) do update set lasting = true;
insert into characters (name, staff, staff_kind, debuted_at) values ('Test Boss', 'tp-boss', 'persona', now());
create function pg_temp.land(kind text, params jsonb, at timestamptz default now()) returns uuid language plpgsql as $$
declare
  written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select id from characters where staff = 'tp-boss'), 'move', (select id from threads where title = 'One'), jsonb_build_object('kind', kind, 'params', params, 'body', 'landed'), at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.end_it(move uuid, why text) returns void language plpgsql as $$
begin
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) select null, 'move_end', a.thread, a.id, jsonb_build_object('why', why, 'by', 'test') from acts a where a.id = move;
  perform set_config('kayfabb.move_end_writer', '', true);
end $$;
insert into boards (slug, name) values ('third', 'Third'), ('fourth', 'Fourth');

do $$
declare
  one uuid := (select id from threads where title = 'One');
  move uuid;
  merge uuid;
  merge2 uuid;
begin
  -- A moveThread in force puts the thread on its board; the latest one wins; ended, the thread is back on its origin.
  move := pg_temp.land('moveThread', jsonb_build_object('thread', one, 'board', pg_temp.board('third')), now() - interval '2 hours');
  if thread_place(one) is distinct from pg_temp.board('third') then raise exception 'a moveThread in force did not place the thread'; end if;
  merge := pg_temp.land('moveThread', jsonb_build_object('thread', one, 'board', pg_temp.board('fourth')), now() - interval '1 hour');
  if thread_place(one) is distinct from pg_temp.board('fourth') then raise exception 'the later moveThread did not win'; end if;
  perform pg_temp.end_it(merge, 'reversed');
  if thread_place(one) is distinct from pg_temp.board('third') then raise exception 'with the later moveThread ended, the earlier did not place the thread'; end if;
  perform pg_temp.end_it(move, 'reversed');
  if thread_place(one) is distinct from pg_temp.board('general') then raise exception 'with every moveThread ended, the thread is not back on its origin'; end if;
  -- A mergeBoard in force sends the threads of the board into the other, followed until a board is open: General into Third, Third into Fourth.
  merge := pg_temp.land('mergeBoard', jsonb_build_object('board', pg_temp.board('general'), 'into', pg_temp.board('third')), now() - interval '30 minutes');
  if thread_place(one) is distinct from pg_temp.board('third') then raise exception 'a mergeBoard did not send the thread into the other board'; end if;
  merge2 := pg_temp.land('mergeBoard', jsonb_build_object('board', pg_temp.board('third'), 'into', pg_temp.board('fourth')), now() - interval '20 minutes');
  if thread_place(one) is distinct from pg_temp.board('fourth') then raise exception 'a merge into a board that was itself merged was not followed'; end if;
  perform pg_temp.end_it(merge2, 'reversed');
  if thread_place(one) is distinct from pg_temp.board('third') then raise exception 'reversing the second merge did not reopen Third'; end if;
  perform pg_temp.end_it(merge, 'reversed');
  if thread_place(one) is distinct from pg_temp.board('general') then raise exception 'reversing the merge did not return the thread'; end if;
  if thread_place(gen_random_uuid()) is not null then raise exception 'a thread that does not exist has a place'; end if;
end $$;

-- ---- a lasting move is in force until it has any move_end; createBoard, moveThread and mergeBoard answer the same way ----
-- Every state below also holds the single-thread function to the set-based one: after a rebuild, thread_place(t) is the stored board for every thread.
create function pg_temp.agree(label text) returns void language plpgsql as $$
begin
  perform rebuild_thread_places();
  if exists (select 1 from threads t where t.board is distinct from thread_place(t.id)) then
    raise exception '% : thread_place disagrees with the rebuild for %', label, (select array_agg(t.title) from threads t where t.board is distinct from thread_place(t.id));
  end if;
  if exists (select 1 from thread_places_drift()) then raise exception '%: drift after a rebuild', label; end if;
end $$;
create function pg_temp.made(slug text, fallback uuid) returns uuid language plpgsql as $$
declare
  mv uuid := pg_temp.land('createBoard', jsonb_build_object('name', slug, 'premise', 'p', 'description', 'd') || case when fallback is null then '{}'::jsonb else jsonb_build_object('fallback', fallback) end);
begin
  insert into boards (slug, name, created_by_act) values (slug, slug, mv);
  return mv;
end $$;

do $$
declare
  a uuid; b uuid; c uuid;
  t_in uuid; t_moved uuid; m uuid;
begin
  perform pg_temp.agree('start');
  -- A reversed createBoard with a fallback: its threads go to the fallback.
  a := pg_temp.made('ma', pg_temp.board('fourth'));
  t_in := pg_temp.mk('In A', 'ma');
  if thread_place(t_in) is distinct from pg_temp.board('ma') then raise exception 'a thread on a live created board is not on it'; end if;
  perform pg_temp.end_it(a, 'reversed');
  if thread_place(t_in) is distinct from pg_temp.board('fourth') then raise exception 'a reversed createBoard did not send its thread to the fallback'; end if;
  perform pg_temp.agree('reversed with fallback');
  -- With none: the instance's first open non-system board (General, the oldest).
  b := pg_temp.made('mb', null);
  t_in := pg_temp.mk('In B', 'mb');
  perform pg_temp.end_it(b, 'reversed');
  if thread_place(t_in) is distinct from pg_temp.board('general') then raise exception 'a reversed createBoard with no fallback did not send its thread to the first open board'; end if;
  perform pg_temp.agree('reversed without fallback');
  -- Ended any other way, it closes the board all the same.
  c := pg_temp.made('mc', pg_temp.board('third'));
  t_in := pg_temp.mk('In C', 'mc');
  perform pg_temp.end_it(c, 'overturned');
  if thread_place(t_in) is distinct from pg_temp.board('third') then raise exception 'a createBoard ended overturned did not close its board'; end if;
  perform pg_temp.agree('overturned');
  c := pg_temp.made('md', pg_temp.board('third'));
  t_in := pg_temp.mk('In D', 'md');
  perform pg_temp.end_it(c, 'superseded');
  if thread_place(t_in) is distinct from pg_temp.board('third') then raise exception 'a createBoard ended superseded did not close its board'; end if;
  -- A moveThread onto a board that has since been merged follows the merge; onto a created board that has since ended it no longer counts, and the thread goes back to where it was.
  t_moved := pg_temp.mk('Moved', 'general');
  m := pg_temp.land('moveThread', jsonb_build_object('thread', t_moved, 'board', pg_temp.board('third')), now() - interval '3 minutes');
  perform pg_temp.land('mergeBoard', jsonb_build_object('board', pg_temp.board('third'), 'into', pg_temp.board('fourth')), now() - interval '2 minutes');
  if thread_place(t_moved) is distinct from pg_temp.board('fourth') then raise exception 'a moveThread onto a board since merged did not follow the merge'; end if;
  perform pg_temp.agree('moved onto a merged board');
  a := pg_temp.made('me', pg_temp.board('elsewhere'));
  t_moved := pg_temp.mk('Moved again', 'general');
  perform pg_temp.land('moveThread', jsonb_build_object('thread', t_moved, 'board', pg_temp.board('me')), now() - interval '1 minute');
  if thread_place(t_moved) is distinct from pg_temp.board('me') then raise exception 'a moveThread onto a live created board'; end if;
  perform pg_temp.end_it(a, 'reversed');
  if thread_place(t_moved) is distinct from pg_temp.board('general') then raise exception 'a moveThread onto a board since reversed did not go back to where the thread was'; end if;
  perform pg_temp.agree('moved onto a reversed board');
end $$;

-- ---- a malformed param is no such move, never an error ----
do $$
declare
  t uuid := (select id from threads where title = 'Two');
begin
  perform pg_temp.land('moveThread', jsonb_build_object('thread', t, 'board', 'not-a-uuid'));
  perform pg_temp.land('moveThread', jsonb_build_object('thread', 'nonsense', 'board', pg_temp.board('third')));
  perform pg_temp.land('mergeBoard', jsonb_build_object('board', pg_temp.board('elsewhere'), 'into', 'nonsense'));
  perform pg_temp.land('mergeBoard', jsonb_build_object('board', 'nonsense', 'into', pg_temp.board('third')));
  perform pg_temp.agree('malformed');
  if thread_place(t) is distinct from (select origin_board from threads where id = t) then raise exception 'a malformed move placed a thread'; end if;
end $$;
