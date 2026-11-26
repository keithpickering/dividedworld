-- A spin picks its board (supabase/migrations/0443_spin_board.sql; docs/plans/2026-11-25-spin-board-plan.md, Task 1; docs/plans/2026-11-25-spin-board-design.md, sections 1 to 5).
--
-- 0. The migration exists at all (so a missing one fails here, on an assertion that names the function, and not on a fixture below): the new functions, one overload each of the replaced ones, their grants and search paths.
-- 1. spin_board(origin): the board an Act's spin lands on today: its thread's board, the first open board for The System's, null for an edit and for no Act.
-- 2. spin with no board lands where spin_board says (from a player board and from The System's); naming another open board it lands there, as a spin's thread and Act are otherwise.
-- 3. A named board that is missing, The System's, closed or barred is refused in its words and writes no thread and no Act; a bad origin is told of before a bad board; a spin from a barred board naming a free one lands;
--    today's board barred and none named is refused as before.
-- 4. apologize: naming the board it is barred from lands there and writes its apologies row; naming The System's board is refused.
-- 5. write_staff_spin: no board lands on today's board, a named one lands there, The System's is refused; a bar is not asked of a persona.
-- 6. spin_places: the default and the list (no system board, no closed board, in order), a barred board with its end and a bar with none; another player's character is refused.
-- 7. thread_open.origin_place ->> 'board': the origin's thread's board for a post, a play, a poll, a verdict and an announcement origin; absent for an Update origin; thread_list agrees; the columns are as they were.
-- The rows are this file's own (sb...).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

-- The migration's functions, named, before anything else is built on them.
do $$
begin
  if to_regprocedure('spin_board(uuid)') is null then raise exception 'spin_board(uuid) does not exist'; end if;
  if to_regprocedure('spin_places(uuid, uuid)') is null then raise exception 'spin_places(uuid, uuid) does not exist'; end if;
  if to_regprocedure('spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text)') is null then raise exception 'spin_written has no board_slug parameter'; end if;
  if to_regprocedure('spin(uuid, uuid, text, text, uuid[], uuid, text)') is null then raise exception 'spin has no board_slug parameter'; end if;
  if to_regprocedure('apologize(uuid, uuid, text, text, uuid[], text)') is null then raise exception 'apologize has no board_slug parameter'; end if;
  if to_regprocedure('write_staff_spin(text, uuid, text, text, jsonb, text)') is null then raise exception 'write_staff_spin has no board_slug parameter'; end if;
end $$;

-- The old signatures are gone, so a positional call has one function to find (a default on a second overload would make every old call ambiguous).
do $$
declare
  f text; n bigint;
begin
  foreach f in array array['spin_written', 'spin', 'apologize', 'write_staff_spin', 'spin_board', 'spin_places'] loop
    n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f);
    if n is distinct from 1 then raise exception '% has % overloads, wanted 1', f, n; end if;
  end loop;
  -- Grants as the plan gives them.
  perform pg_temp.expect(has_function_privilege('authenticated', 'spin_board(uuid)', 'execute') and has_function_privilege('service_role', 'spin_board(uuid)', 'execute')
    and not has_function_privilege('anon', 'spin_board(uuid)', 'execute'), 'spin_board: authenticated and service_role, not anon');
  perform pg_temp.expect(has_function_privilege('authenticated', 'spin_places(uuid, uuid)', 'execute') and not has_function_privilege('anon', 'spin_places(uuid, uuid)', 'execute'), 'spin_places: authenticated, not anon');
  perform pg_temp.expect(has_function_privilege('service_role', 'spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text)', 'execute')
    and not has_function_privilege('anon', 'spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text)', 'execute'), 'spin_written: service_role only');
  perform pg_temp.expect(has_function_privilege('authenticated', 'spin(uuid, uuid, text, text, uuid[], uuid, text)', 'execute') and not has_function_privilege('anon', 'spin(uuid, uuid, text, text, uuid[], uuid, text)', 'execute'), 'spin: authenticated, not anon');
  perform pg_temp.expect(has_function_privilege('authenticated', 'apologize(uuid, uuid, text, text, uuid[], text)', 'execute') and not has_function_privilege('anon', 'apologize(uuid, uuid, text, text, uuid[], text)', 'execute'), 'apologize: authenticated, not anon');
  perform pg_temp.expect(has_function_privilege('service_role', 'write_staff_spin(text, uuid, text, text, jsonb, text)', 'execute')
    and not has_function_privilege('authenticated', 'write_staff_spin(text, uuid, text, text, jsonb, text)', 'execute')
    and not has_function_privilege('anon', 'write_staff_spin(text, uuid, text, text, jsonb, text)', 'execute'), 'write_staff_spin: service_role only');
  -- Each is a security definer with its search path pinned and ending in pg_temp.
  for f in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('spin_written', 'spin', 'apologize', 'write_staff_spin', 'spin_board', 'spin_places')
             and not (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%' and c like '%pg_temp')) loop
    raise exception '% is not a security definer with its search_path ending in pg_temp', f;
  end loop;
end $$;

-- A statement run as an account (null: the service role; 'owner': as the test's own role); its first column as text, or 'ERROR: ' and the state and refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;
create function pg_temp.words(t timestamptz) returns text language sql as $$
  select to_char(date_trunc('minute', t + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
$$;
-- The thread a spin's answer made, and the board it is on.
create function pg_temp.thread_of(answer text) returns uuid language sql as $$ select (answer::jsonb -> 'thread' ->> 'id')::uuid $$;
create function pg_temp.board_of(th uuid) returns uuid language sql as $$ select board from threads where id = th $$;
-- The rows a refused call must leave alone.
create function pg_temp.rows() returns text language sql as $$ select (select count(*) from threads) || '/' || (select count(*) from acts) || '/' || (select count(*) from apologies) $$;

-- A group move that has landed, aimed at one board (the bar), with an expiry or none, and a demand where the move is one an apology answers.
create function pg_temp.bar(who uuid, on_board uuid, expires timestamptz, demand jsonb default null) returns uuid language plpgsql as $$
declare made uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act(pg_temp.f('kassie'), 'move', pg_temp.f('tsys'),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', who::text, 'group', 'trialMembers', 'board', on_board::text))
      || case when expires is not null then jsonb_build_object('expires_at', expires) else '{}'::jsonb end
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end);
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

-- ---- 0. The world ----
do $$
declare
  ann uuid := tests.account('sb-ann'); bob uuid := tests.account('sb-bob');
  a uuid := tests.character(ann, 'Sb Ann'); c uuid := tests.character(ann, 'Sb Mask'); d uuid := tests.character(ann, 'Sb Sorry'); e uuid := tests.character(ann, 'Sb Endless');
  b uuid := tests.character(bob, 'Sb Bob');
  kassie uuid; tsys uuid; mv_old uuid; mv_shut uuid; sys_post uuid;
  tgen uuid := tests.thread('Sb General Thread'); tgames uuid; tchat uuid;
  pgen uuid; pgames uuid; pchat uuid; ed uuid;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sb Kassie', 'sb-kassie', 'persona', now()) returning id into kassie;
  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict (key) do nothing;
  insert into move_kinds (key, structural, shapes_board, lasting) values ('createBoard', true, true, true) on conflict (key) do nothing;
  insert into demand_kinds (key) values ('apologyAccepted') on conflict (key) do nothing;
  insert into group_kinds (key, name, color, source, tone) values ('trialMembers', 'Trial Members', '#cc0000', 'conferred', 'punishment') on conflict (key) do nothing;
  insert into fx values ('ann', ann), ('bob', bob), ('a', a), ('c', c), ('d', d), ('e', e), ('b', b), ('kassie', kassie);

  -- The announcements thread sits on The System's board, and a staff post in it is the announcement.
  insert into threads (board, title) values (pg_temp.board('the-system'), 'Sb Announcements') returning id into tsys;
  insert into fx values ('tsys', tsys);
  perform set_config('kayfabb.staff_writer', 'on', true);
  sys_post := tests.act(kassie, 'post', tsys, '{"body": "An announcement."}');
  perform set_config('kayfabb.staff_writer', '', true);
  -- Boards, oldest first: Old (closed below, so General's turn is after Games), Games, Chat, Shut (closed); the fixtures' General is the newest. Each closed one is created by a move that is then ended.
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv_old := tests.act(kassie, 'move', tsys, '{"kind": "createBoard", "body": "Old.", "params": {}}');
  mv_shut := tests.act(kassie, 'move', tsys, '{"kind": "createBoard", "body": "Shut.", "params": {}}');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into boards (slug, name, description, created_at, created_by_act) values
    ('sb-old', 'Sb Old', 'Old.', '1999-01-01', mv_old), ('sb-games', 'Sb Games', 'Games.', '2001-01-01', null),
    ('sb-chat', 'Sb Chat', 'Chat.', '2001-02-01', null), ('sb-shut', 'Sb Shut', 'Shut.', '2001-03-01', mv_shut);
  perform end_move(mv_shut, 'reversed', 'test');
  insert into fx values ('mv_old', mv_old);

  insert into threads (board, title) values (pg_temp.board('sb-games'), 'Sb Games Thread') returning id into tgames;
  insert into threads (board, title) values (pg_temp.board('sb-chat'), 'Sb Chat Thread') returning id into tchat;
  pgen := tests.post(c, tgen, 'A post on General.'); pgames := tests.post(a, tgames, 'A post on Games.'); pchat := tests.post(c, tchat, 'A post on Chat.');
  ed := tests.act(c, 'edit', tgen, '{"body": "Edited."}', pgen);
  insert into fx values ('tgen', tgen), ('tgames', tgames), ('tchat', tchat), ('pgen', pgen), ('pgames', pgames), ('pchat', pchat), ('ed', ed), ('sys_post', sys_post);
  perform pg_temp.expect((select closed from boards_now where slug = 'sb-shut') and not (select closed from boards_now where slug = 'sb-games'), 'the fixture closed the wrong boards');
end $$;

-- ---- 1. spin_board ----
do $$
declare
  general uuid := pg_temp.board('general'); games uuid := pg_temp.board('sb-games'); chat uuid := pg_temp.board('sb-chat');
begin
  perform pg_temp.expect(spin_board(pg_temp.f('pgen')) = general, 'a post on a player board answers that board');
  perform pg_temp.expect(spin_board(pg_temp.f('pchat')) = chat, 'a post on another player board answers that board');
  -- Sb Old (1999) is the oldest board and open: it is where an Act on The System's board lands.
  perform pg_temp.expect(spin_board(pg_temp.f('sys_post')) = pg_temp.board('sb-old'), 'an Act on The System''s board answers the first open board');
  perform pg_temp.expect(spin_board(pg_temp.f('sys_post')) = players_board(), 'spin_board and players_board agree');
  perform end_move(pg_temp.f('mv_old'), 'reversed', 'test');
  perform pg_temp.expect((select closed from boards_now where slug = 'sb-old'), 'the fixture closed the oldest board');
  perform pg_temp.expect(spin_board(pg_temp.f('sys_post')) = games, 'with the oldest board closed, the next open one: ' || coalesce(spin_board(pg_temp.f('sys_post'))::text, 'null'));
  perform pg_temp.expect(spin_board(pg_temp.f('ed')) is null, 'an edit answers null');
  perform pg_temp.expect(spin_board(gen_random_uuid()) is null, 'a missing id answers null');
  perform pg_temp.expect(spin_board(null) is null, 'no id answers null');
  perform pg_temp.expect(pg_temp.as_val(pg_temp.f('ann'), format('select spin_board(%L)', pg_temp.f('pgen'))) = general::text, 'a player may ask');
end $$;

-- ---- 2. A spin with no board, and one that names another ----
do $$
declare
  ann uuid := pg_temp.f('ann'); c uuid := pg_temp.f('c');
  general uuid := pg_temp.board('general'); games uuid := pg_temp.board('sb-games'); chat uuid := pg_temp.board('sb-chat');
  r text; th uuid; sp record;
begin
  -- No board: where spin_board says, from a player board and from The System's.
  r := pg_temp.as_val(ann, format('select spin(%L, %L, %L, %L)', pg_temp.f('pgen'), c, 'Spun on General', 'Discuss.'));
  perform pg_temp.expect(r not like 'ERROR%', 'a spin with no board: ' || r);
  perform pg_temp.expect(pg_temp.board_of(pg_temp.thread_of(r)) = general, 'a spin with no board lands on its origin''s board');
  r := pg_temp.as_val(ann, format('select spin(%L, %L, %L, %L)', pg_temp.f('sys_post'), c, 'Spun from The System', 'Discuss.'));
  perform pg_temp.expect(r not like 'ERROR%', 'a spin of an announcement with no board: ' || r);
  perform pg_temp.expect(pg_temp.board_of(pg_temp.thread_of(r)) = spin_board(pg_temp.f('sys_post')), 'a spin of an announcement lands on the first open board');
  -- Naming another open board.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'Spun onto Chat', 'Discuss.', 'sb-chat'));
  perform pg_temp.expect(r not like 'ERROR%', 'a spin naming an open board: ' || r);
  th := pg_temp.thread_of(r);
  perform pg_temp.expect(pg_temp.board_of(th) = chat, 'a spin naming a board lands there');
  select a.kind, a.seq, a.target_act_id, a.character into sp from acts a where a.thread = th and a.seq = 1;
  perform pg_temp.expect(sp.kind = 'spin' and sp.target_act_id = pg_temp.f('pgen') and sp.character = c, 'the thread''s first Act is the spin, aimed at the origin, by the character');
  perform pg_temp.expect((select origin_act_id from threads where id = th) = pg_temp.f('pgen'), 'origin_act_id is the origin');
  perform pg_temp.expect((select count(*) from acts where thread = th) = 1, 'the thread holds the spin alone');
  -- Naming the board it would land on anyway.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'Spun onto General', 'Discuss.', 'general'));
  perform pg_temp.expect(r not like 'ERROR%' and pg_temp.board_of(pg_temp.thread_of(r)) = general, 'a spin naming its own board: ' || r);
  -- An announcement spun onto a named board.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('sys_post'), c, 'Announcement on Chat', 'Discuss.', 'sb-chat'));
  perform pg_temp.expect(r not like 'ERROR%' and pg_temp.board_of(pg_temp.thread_of(r)) = chat, 'an announcement spun onto a named board: ' || r);
  -- A null board_slug is no board.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => null)', pg_temp.f('pchat'), c, 'Spun, null board', 'Discuss.'));
  perform pg_temp.expect(r not like 'ERROR%' and pg_temp.board_of(pg_temp.thread_of(r)) = chat, 'a null board is no board: ' || r);
end $$;

-- ---- 3. Refusals of a named board, and the bar ----
do $$
declare
  ann uuid := pg_temp.f('ann'); a uuid := pg_temp.f('a'); c uuid := pg_temp.f('c');
  m uuid; until timestamptz := date_trunc('minute', now()) + interval '2 days 3 minutes';
  before text; r text; want text;
  chat uuid := pg_temp.board('sb-chat');
begin
  m := pg_temp.bar(a, pg_temp.board('sb-games'), until);
  perform pg_temp.expect(barred(a, pg_temp.board('sb-games')), 'the fixture barred Sb Ann from Sb Games');
  want := 'Sb Ann is barred from posting on Sb Games until ' || pg_temp.words(until);

  before := pg_temp.rows();
  -- A missing slug.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'No board', 'Body.', 'sb-nowhere'));
  perform pg_temp.expect(r = 'ERROR: P0002 there is no such board', 'a missing board: ' || r);
  -- The System's board.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'System board', 'Body.', 'the-system'));
  perform pg_temp.expect(r = 'ERROR: 42501 ' || (select n.name from boards_now n join boards b on b.id = n.id where b.slug = 'the-system') || ' is the staff''s own board; pick another board', 'The System''s board: ' || r);
  -- A closed board (Sb Shut was merged away by its move's end).
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'Closed board', 'Body.', 'sb-shut'));
  perform pg_temp.expect(r like 'ERROR: 55000 this board was closed, and its threads are in %; start your thread there instead', 'a closed board: ' || r);
  -- A board the character is barred from.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), a, 'Barred board', 'Body.', 'sb-games'));
  perform pg_temp.expect(r = 'ERROR: 55000 ' || want, 'a barred board: ' || r || ', wanted ' || want);
  -- A bad origin is told of before a bad board, a missing board before the bar.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', gen_random_uuid(), c, 'Bad origin', 'Body.', 'sb-nowhere'));
  perform pg_temp.expect(r = 'ERROR: P0002 there is no such Act to spin from', 'a bad origin before a bad board: ' || r);
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('ed'), c, 'Edit origin', 'Body.', 'sb-chat'));
  perform pg_temp.expect(r = 'ERROR: P0002 there is no such Act to spin from', 'an edit is no origin: ' || r);
  perform pg_temp.expect(pg_temp.rows() = before, 'a refused spin left a thread, an Act or an apology behind: ' || before || ' then ' || pg_temp.rows());

  -- Today's board barred and none named: refused as before, in the bar's words.
  r := pg_temp.as_val(ann, format('select spin(%L, %L, %L, %L)', pg_temp.f('pgames'), a, 'Barred here', 'Body.'));
  perform pg_temp.expect(r = 'ERROR: 55000 ' || want, 'a spin on the board one is barred from, naming none: ' || r);
  perform pg_temp.expect(pg_temp.rows() = before, 'that refusal left rows behind');

  -- From a post on the barred board, naming an open board it is not barred from: lands.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgames'), a, 'Out of the bar', 'Body.', 'sb-chat'));
  perform pg_temp.expect(r not like 'ERROR%', 'a spin out of a barred board onto a free one: ' || r);
  perform pg_temp.expect(pg_temp.board_of(pg_temp.thread_of(r)) = chat, 'it landed on the named board');
  -- The bar is per character: the other mask spins onto Games.
  r := pg_temp.as_val(ann, format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'The other mask', 'Body.', 'sb-games'));
  perform pg_temp.expect(r not like 'ERROR%' and pg_temp.board_of(pg_temp.thread_of(r)) = pg_temp.board('sb-games'), 'another mask is let onto the board: ' || r);
  -- Not the caller's character: refused by acting, before any board is read.
  r := pg_temp.as_val(pg_temp.f('bob'), format('select spin(origin => %L, through => %L, title => %L, body => %L, board_slug => %L)', pg_temp.f('pgen'), c, 'Not mine', 'Body.', 'sb-chat'));
  perform pg_temp.expect(r like 'ERROR:%' and r not like '%no such board%', 'a character that is not the caller''s: ' || r);
end $$;

-- ---- 4. apologize ----
do $$
declare
  ann uuid := pg_temp.f('ann'); d uuid := pg_temp.f('d'); games uuid := pg_temp.board('sb-games');
  m uuid; r text; before text; th uuid;
begin
  m := pg_temp.bar(d, games, now() + interval '2 days', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb));
  perform pg_temp.expect(barred(d, games), 'the fixture barred Sb Sorry');
  before := pg_temp.rows();
  -- The System's board is no place for one.
  r := pg_temp.as_val(ann, format('select apologize(in_move => %L, through => %L, title => %L, body => %L, board_slug => %L)', m, d, 'Sorry', 'Sorry.', 'the-system'));
  perform pg_temp.expect(r = 'ERROR: 42501 ' || (select n.name from boards_now n join boards b on b.id = n.id where b.slug = 'the-system') || ' is the staff''s own board; pick another board', 'an apology on The System''s board: ' || r);
  perform pg_temp.expect(pg_temp.rows() = before, 'a refused apology left rows behind');
  -- The board the apologizer is barred from is a place for one: the bar is not checked.
  r := pg_temp.as_val(ann, format('select apologize(in_move => %L, through => %L, title => %L, body => %L, board_slug => %L)', m, d, 'Sorry, here', 'Sorry.', 'sb-games'));
  perform pg_temp.expect(r not like 'ERROR%', 'an apology on the board it is barred from: ' || r);
  th := pg_temp.thread_of(r);
  perform pg_temp.expect(pg_temp.board_of(th) = games, 'the apology landed on the named board');
  perform pg_temp.expect(exists (select 1 from apologies x where x.move_act = m and x.character = d and x.state = 'pending' and x.apology_act = (r::jsonb -> 'act' ->> 'id')::uuid), 'the apologies row is written, pending, aimed at the apology');
  -- With no board, today's board: the move is on The System's board, so the first open board (a fresh move, a fresh day of waiting is not needed: the first apology was refused for nothing, this one is the second).
  perform pg_temp.expect((select board from threads where id = th) = games and (select origin_act_id from threads where id = th) = m, 'the apology''s thread is spun from the move');
end $$;

-- ---- 5. write_staff_spin ----
do $$
declare
  r jsonb; before text; chat uuid := pg_temp.board('sb-chat');
begin
  perform tests.become_service();
  -- No board: today's board, spin_board's answer, for a post on a player board and for an announcement.
  r := write_staff_spin('sb-kassie', pg_temp.f('pgames'), 'Staff spin', 'A word.');
  perform pg_temp.expect(pg_temp.board_of((r -> 'thread' ->> 'id')::uuid) = pg_temp.board('sb-games'), 'a persona''s spin with no board lands on the origin''s board');
  r := write_staff_spin('sb-kassie', pg_temp.f('sys_post'), 'Staff spin of an announcement', 'A word.');
  perform pg_temp.expect(pg_temp.board_of((r -> 'thread' ->> 'id')::uuid) = spin_board(pg_temp.f('sys_post')), 'a persona''s spin of an announcement lands on the first open board');
  -- A named board.
  r := write_staff_spin(staff_key => 'sb-kassie', origin => pg_temp.f('pgames'), title => 'Staff spin, named', body => 'A word.', board_slug => 'sb-chat');
  perform pg_temp.expect(pg_temp.board_of((r -> 'thread' ->> 'id')::uuid) = chat, 'a persona''s spin naming a board lands there');
  perform pg_temp.expect((select a.kind from acts a where a.thread = (r -> 'thread' ->> 'id')::uuid and a.seq = 1) = 'spin', 'its first Act is the spin');
  perform tests.unbecome();
  -- The refusals: The System's board, a missing one, a closed one, a bad origin; each leaves nothing behind. (A bar is not asked of a persona.)
  before := pg_temp.rows();
  perform pg_temp.expect(pg_temp.as_val(null, format('select write_staff_spin(staff_key => %L, origin => %L, title => %L, body => %L, board_slug => %L)', 'sb-kassie', pg_temp.f('pgames'), 'T', 'B', 'the-system'))
    = 'ERROR: 42501 ' || (select n.name from boards_now n join boards b on b.id = n.id where b.slug = 'the-system') || ' is the staff''s own board; pick another board', 'a persona''s spin onto The System''s board');
  perform pg_temp.expect(pg_temp.as_val(null, format('select write_staff_spin(staff_key => %L, origin => %L, title => %L, body => %L, board_slug => %L)', 'sb-kassie', pg_temp.f('pgames'), 'T', 'B', 'sb-nowhere'))
    = 'ERROR: P0002 there is no such board', 'a persona''s spin onto a missing board');
  perform pg_temp.expect(pg_temp.as_val(null, format('select write_staff_spin(staff_key => %L, origin => %L, title => %L, body => %L, board_slug => %L)', 'sb-kassie', pg_temp.f('pgames'), 'T', 'B', 'sb-shut')) like 'ERROR: 55000 %',
    'a persona''s spin onto a closed board');
  perform pg_temp.expect(pg_temp.as_val(null, format('select write_staff_spin(staff_key => %L, origin => %L, title => %L, body => %L, board_slug => %L)', 'sb-kassie', gen_random_uuid(), 'T', 'B', 'sb-nowhere'))
    = 'ERROR: P0002 there is no such Act to spin from', 'a bad origin before a bad board');
  perform pg_temp.expect(pg_temp.rows() = before, 'a refused persona''s spin left rows behind');
  -- A persona is not barred: a bar on Sb Kassie would not matter, and none is asked of her (she names the board a player is barred from).
  perform pg_temp.expect(pg_temp.as_val(null, format('select write_staff_spin(staff_key => %L, origin => %L, title => %L, body => %L, board_slug => %L) -> %L ->> %L is not null', 'sb-kassie', pg_temp.f('pgen'), 'Persona on Games', 'B', 'sb-games', 'thread', 'id')) = 'true',
    'a persona spins onto a board a player is barred from');
end $$;

-- ---- 6. spin_places ----
do $$
declare
  ann uuid := pg_temp.f('ann'); a uuid := pg_temp.f('a'); c uuid := pg_temp.f('c'); e uuid := pg_temp.f('e');
  games uuid := pg_temp.board('sb-games'); m_games uuid; m_end uuid; got jsonb; one jsonb; r text;
begin
  select o.move_act into m_games from bars_of(a) o where o.board = games limit 1;
  perform pg_temp.expect(m_games is not null, 'Sb Ann is barred from Sb Games');
  -- The default and the list, through a character that is not barred anywhere: no system board, no closed board, in index order.
  got := pg_temp.as_val(ann, format('select spin_places(%L, %L)', pg_temp.f('pgen'), c))::jsonb;
  perform pg_temp.expect(got ->> 'default' = 'general', 'the default is the origin''s board: ' || got::text);
  perform pg_temp.expect((select array_agg(x ->> 'slug' order by o) from jsonb_array_elements(got -> 'boards') with ordinality t(x, o)) = array['sb-games', 'sb-chat', 'general'],
    'the boards are the open player boards in order: ' || (got -> 'boards')::text);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(got -> 'boards') x where (x ->> 'barred')::boolean or x -> 'until' <> 'null'::jsonb), 'no board is barred for a free character: ' || got::text);
  perform pg_temp.expect((got -> 'boards' -> 0 ->> 'name') = 'Sb Games' and (got -> 'boards' -> 0) ? 'barred' and (got -> 'boards' -> 0) ? 'until', 'each board has a slug, name, barred and until');
  -- From an announcement: the first open board.
  perform pg_temp.expect(pg_temp.as_val(ann, format('select spin_places(%L, %L) ->> %L', pg_temp.f('sys_post'), c, 'default')) = 'sb-games', 'the default for an announcement is the first open board');
  -- A barred board is in the list, barred, with its end.
  got := pg_temp.as_val(ann, format('select spin_places(%L, %L)', pg_temp.f('pgames'), a))::jsonb;
  one := (select x from jsonb_array_elements(got -> 'boards') x where x ->> 'slug' = 'sb-games');
  perform pg_temp.expect((one ->> 'barred')::boolean and (one ->> 'until')::timestamptz = move_expires_at(m_games), 'a barred board says it is barred and until when: ' || one::text);
  perform pg_temp.expect(got ->> 'default' = 'sb-games', 'the default stays the board even when barred (the form says so)');
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(got -> 'boards') x where x ->> 'slug' <> 'sb-games' and (x ->> 'barred')::boolean), 'only the barred board is barred');
  -- A bar with no end.
  m_end := pg_temp.bar(e, pg_temp.board('general'), null);
  got := pg_temp.as_val(ann, format('select spin_places(%L, %L)', pg_temp.f('pgen'), e))::jsonb;
  one := (select x from jsonb_array_elements(got -> 'boards') x where x ->> 'slug' = 'general');
  perform pg_temp.expect((one ->> 'barred')::boolean and one -> 'until' = 'null'::jsonb, 'a bar with no end is barred, until null: ' || one::text);
  -- A rename in force shows (the name is boards_now's): not set up here, boards_now.name is read, not boards.name.
  perform pg_temp.expect((select x ->> 'name' from jsonb_array_elements(got -> 'boards') x where x ->> 'slug' = 'sb-chat') = (select name from boards_now where slug = 'sb-chat'), 'the name is boards_now''s');
  -- An origin that is no Act: default null, the list as it is.
  got := pg_temp.as_val(ann, format('select spin_places(%L, %L)', gen_random_uuid(), c))::jsonb;
  perform pg_temp.expect(got -> 'default' = 'null'::jsonb and jsonb_array_length(got -> 'boards') = 3, 'no such Act: no default, the list as it is: ' || got::text);
  got := pg_temp.as_val(ann, format('select spin_places(%L, %L)', pg_temp.f('ed'), c))::jsonb;
  perform pg_temp.expect(got -> 'default' = 'null'::jsonb, 'an edit has no default');
  -- Another player's character is refused by acting, in the same words whoever it belongs to.
  r := pg_temp.as_val(pg_temp.f('bob'), format('select spin_places(%L, %L)', pg_temp.f('pgen'), c));
  perform pg_temp.expect(r like 'ERROR:%', 'a character that is not the caller''s is refused: ' || r);
  r := pg_temp.as_val(null, format('select spin_places(%L, %L)', pg_temp.f('pgen'), c));
  perform pg_temp.expect(r like 'ERROR:%', 'the service role has no character to act as: ' || r);
  perform tests.become_anon();
  begin perform spin_places(pg_temp.f('pgen'), c); raise exception 'anon read spin_places'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- A spin and the read of its thread are two statements: a view cannot see a thread its own statement made.
create function pg_temp.place_of(origin uuid, through uuid, title text) returns jsonb language plpgsql as $$
declare th uuid := pg_temp.thread_of(spin_written(origin, through, title, 'B', false, '{}')::text); r jsonb;
begin select origin_place into r from thread_open where id = th; return r; end $$;

-- ---- 7. thread_open.origin_place's board ----
do $$
declare
  ann uuid := pg_temp.f('ann'); a uuid := pg_temp.f('a'); c uuid := pg_temp.f('c');
  general uuid := pg_temp.board('general'); games uuid := pg_temp.board('sb-games'); chat uuid := pg_temp.board('sb-chat'); sys uuid := pg_temp.board('the-system');
  kassie uuid := pg_temp.f('kassie'); play uuid; poll uuid; rep uuid; ver uuid; upd uuid; dev uuid;
  got jsonb; list jsonb; cols text[];
  function_cols text[] := array['id', 'board', 'title', 'origin_act_id', 'created_at', 'last_at', 'last_seq', 'replies', 'first_act', 'first_character', 'last_act', 'last_character', 'replies_this_week', 'origin_thread', 'origin_place'];
begin
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'thread_open';
  perform pg_temp.expect(cols = function_cols, 'thread_open has other columns than before: ' || cols::text);

  -- A post.
  got := pg_temp.place_of(pg_temp.f('pgames'), c, 'From a post');
  perform pg_temp.expect(got ->> 'kind' = 'post' and got ->> 'board' = games::text, 'a post origin names its thread''s board: ' || got::text);
  -- A play on a post (its origin's thread is where the play sits).
  play := tests.act(a, 'card', pg_temp.f('tgames'), '{"card": "sweetie"}', pg_temp.f('pgames'));
  got := pg_temp.place_of(play, c, 'From a play');
  perform pg_temp.expect(got ->> 'kind' = 'play' and got ->> 'board' = games::text, 'a play origin names its thread''s board: ' || got::text);
  -- A poll, and a verdict, on Chat.
  poll := tests.act(c, 'poll', pg_temp.f('tchat'), jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), pg_temp.f('pchat'));
  got := pg_temp.place_of(poll, a, 'From a poll');
  perform pg_temp.expect(got ->> 'kind' = 'poll' and got ->> 'board' = chat::text, 'a poll origin names its thread''s board: ' || got::text);
  perform set_config('kayfabb.report_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'report', pg_temp.f('tchat'), pg_temp.f('pchat'), '{"reason": "r"}') returning id into rep;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', pg_temp.f('tchat'), rep, jsonb_build_object('report_act', rep, 'verdict', 'dismissed', 'line', 'No.')) returning id into ver;
  perform set_config('kayfabb.report_writer', '', true);
  perform set_config('kayfabb.staff_writer', '', true);
  got := pg_temp.place_of(ver, c, 'From a verdict');
  perform pg_temp.expect(got ->> 'kind' = 'answer' and got ->> 'board' = chat::text, 'a verdict origin names its thread''s board: ' || got::text);
  -- An announcement: the board of The System's board.
  got := pg_temp.place_of(pg_temp.f('sys_post'), c, 'From an announcement');
  perform pg_temp.expect(got ->> 'kind' = 'post' and got ->> 'board' = sys::text, 'an announcement origin names The System''s board: ' || got::text);
  -- An Update names no board.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Sb Gabe', 'title', 'Made this.', 'avatar', 'gabe')));
  select id into dev from characters where staff_kind = 'developer';
  perform set_config('kayfabb.update_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  upd := tests.act(dev, 'update', (select (value #>> '{}')::uuid from settings where key = 'updatesThread'), '{"title": "Sb Headline", "body": "Body.", "changes": []}');
  perform set_config('kayfabb.update_writer', 'off', true);
  perform set_config('kayfabb.staff_writer', 'off', true);
  got := pg_temp.place_of(upd, c, 'From an update');
  perform pg_temp.expect(got ->> 'kind' = 'update' and not got ? 'board', 'an Update origin names no board: ' || got::text);
  perform pg_temp.expect(got = jsonb_build_object('kind', 'update', 'act', upd, 'title', 'Sb Headline'), 'an Update''s place is as it was: ' || got::text);
  -- thread_list is select * over thread_open and carries the same.
  perform pg_temp.expect(not exists (select 1 from thread_open o join thread_list l on l.id = o.id where o.origin_place is distinct from l.origin_place), 'thread_list agrees with thread_open');
  perform pg_temp.expect((select count(*) from thread_list where origin_place ? 'board') >= 5, 'thread_list carries the board');
  -- A thread not spun has no place at all.
  perform pg_temp.expect((select origin_place from thread_open where id = pg_temp.f('tgen')) is null, 'a thread that was not spun has no place');
end $$;
