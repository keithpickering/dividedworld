-- describe_board and replace_queued_description (supabase/migrations/0099_describe_board.sql; the Mod Bots design, section 1, "Admin overrides";
-- its plan, Task 2). An admin replaces a board's description without touching the Boss's words: a waiting rename carries the replacement and
-- lands it as a `describe` Act beside the rename's `move` Act; a board's current description is the latest describe, else the move's own.
-- Every reader reads boards_now, so each is proved here: board_page, index_page, boot and thread_page.

do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('It is done: {move}.'),
        'moveMet', jsonb_build_array('Met: {move}.'),
        'moveExpired', jsonb_build_array('Expired: {move}.'),
        'moveReversed', jsonb_build_array('Overruled: {move}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'db-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'db-boss', 'name', 'Describe Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('db-admin'));
  perform tests.account('db-player');
end $$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

create function pg_temp.queue(who text, new_name text, boss_words text) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, who, 'renameBoard',
    jsonb_build_object('board', (select id from boards where slug = 'db-board'), 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', boss_words),
    null, 'because ' || new_name, now() - interval '1 minute', now() + interval '3 days', true) returning id into q;
  return q;
end $$;

-- What every reader of boards_now says the board's description is, in one list: the view, board_page, index_page, boot and thread_page.
create function pg_temp.seen() returns text[] language plpgsql as $$
declare
  b uuid := (select id from boards where slug = 'db-board');
  t uuid := (select id from threads where board = b limit 1);
  r text[];
begin
  perform tests.become((select id from auth.users where email = 'db-player@test.invalid'));
  r := array[
    (select description from boards_now where id = b),
    board_page('db-board', 1, array[]::text[]) -> 'board' ->> 'description',
    (select x ->> 'description' from jsonb_array_elements(index_page() -> 'boards') x where x ->> 'id' = b::text),
    (select x ->> 'description' from jsonb_array_elements(boot() -> 'boards') x where x ->> 'id' = b::text),
    thread_page(t, 1, null, 20, array[]::text[]) -> 'board' ->> 'description'];
  perform tests.unbecome();
  return r;
end $$;

create function pg_temp.all_say(want text, what text) returns void language plpgsql as $$
declare s text[] := pg_temp.seen();
begin
  if s is distinct from array[want, want, want, want, want] then raise exception '% should read "%" on every screen, but they read %', what, want, s; end if;
end $$;

do $$
declare
  b uuid;
  t uuid;
  p uuid := (select id from auth.users where email = 'db-player@test.invalid');
  ch uuid;
begin
  insert into boards (slug, name, description) values ('db-board', 'Describe Board', 'Base words.') returning id into b;
  insert into threads (board, title) values (b, 'A thread here') returning id into t;
  ch := tests.character(p, 'Describe Poster');
  perform tests.post(ch, t, 'Hello.');
  perform pg_temp.all_say('Base words.', 'a board never described');
end $$;

-- ---- A player or a visitor is refused by both functions ----
do $$
declare
  b uuid := (select id from boards where slug = 'db-board');
  p uuid := (select id from auth.users where email = 'db-player@test.invalid');
  q bigint := pg_temp.queue('db-boss', 'Gate Garden', 'Boss words.');
  got text;
begin
  perform tests.become(p);
  got := pg_temp.refusal(format('select describe_board(%L, %L)', b, 'Player words.'));
  if got is distinct from '42501' then raise exception 'a player described a board: %', got; end if;
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, 'Player words.'));
  if got is distinct from '42501' then raise exception 'a player replaced a description: %', got; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  got := pg_temp.refusal(format('select describe_board(%L, %L)', b, 'Visitor words.'));
  if got is distinct from '42501' then raise exception 'a visitor described a board: %', got; end if;
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, 'Visitor words.'));
  if got is distinct from '42501' then raise exception 'a visitor replaced a description: %', got; end if;
  perform tests.unbecome();
  if (select admin_description from queued_moves where id = q) is not null then raise exception 'a refused replacement was stored'; end if;
  if exists (select 1 from acts where kind = 'describe') then raise exception 'a refused description wrote an Act'; end if;
  perform pg_temp.all_say('Base words.', 'a board nobody could describe');
end $$;

-- ---- A queued replacement: stored, replaced by a second, refused when empty or too long ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'db-admin@test.invalid');
  q bigint := (select id from queued_moves where params ->> 'name' = 'Gate Garden');
  first_at timestamptz;
  got text;
begin
  perform tests.become(admin);
  perform replace_queued_description(q, 'First admin words.');
  perform tests.unbecome();
  if (select admin_description is distinct from 'First admin words.' or described_by is distinct from admin or described_at is null from queued_moves where id = q) then
    raise exception 'the replacement did not record its words, its admin and its time';
  end if;
  first_at := (select described_at from queued_moves where id = q);
  if (select params ->> 'description' from queued_moves where id = q) is distinct from 'Boss words.' then raise exception 'the Boss''s words on the row changed'; end if;
  perform pg_sleep(0.01);
  perform tests.become(admin);
  perform replace_queued_description(q, 'Second admin words.');
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, ''));
  if got is distinct from '22023' then raise exception 'an empty description was accepted: %', got; end if;
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, E' \t\n '));
  if got is distinct from '22023' then raise exception 'a description of whitespace was accepted: %', got; end if;
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, repeat('x', 2001)));
  if got is distinct from '22023' then raise exception 'a 2001-character description was accepted: %', got; end if;
  perform replace_queued_description(q, repeat('y', 2000));
  perform replace_queued_description(q, 'Second admin words.');
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', -1, 'Nowhere.'));
  if got is distinct from 'P0002' then raise exception 'a row that is not there took a description: %', got; end if;
  perform tests.unbecome();
  if (select admin_description is distinct from 'Second admin words.' or described_at <= first_at from queued_moves where id = q) then
    raise exception 'a second call did not replace the first';
  end if;
  perform tests.become(admin);
  if (select w ->> 'adminDescription' from jsonb_array_elements(admin_queue() -> 'waiting') w where (w ->> 'id')::bigint = q) is distinct from 'Second admin words.' then
    raise exception 'the admin queue does not show the replacement';
  end if;
  perform tests.unbecome();
  perform pg_temp.all_say('Base words.', 'a board whose rename is still waiting');
end $$;

-- ---- A held row refuses a replacement ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'db-admin@test.invalid');
  q bigint := pg_temp.queue('db-boss', 'Held Hedge', 'Held Boss words.');
  got text;
begin
  perform tests.become(admin);
  perform hold_move(q);
  got := pg_temp.refusal(format('select replace_queued_description(%s, %L)', q, 'Too late.'));
  perform tests.unbecome();
  if got is distinct from '55000' then raise exception 'a held row took a replacement: %', got; end if;
  if (select admin_description from queued_moves where id = q) is not null then raise exception 'a held row stored a replacement'; end if;
end $$;

-- ---- The rename lands: the replacement is a describe Act after the move Act, and the Boss's words stay on the move ----
do $$
declare
  b uuid := (select id from boards where slug = 'db-board');
  q bigint := (select id from queued_moves where params ->> 'name' = 'Gate Garden');
  mv uuid;
  d acts%rowtype;
begin
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  if mv is null then raise exception 'the tick did not land the rename'; end if;
  if (select payload #>> '{params,description}' from acts where id = mv) is distinct from 'Boss words.' then raise exception 'the Boss''s words changed on the move Act'; end if;
  select * into d from acts where kind = 'describe' and payload ->> 'board' = b::text;
  if d.id is null then raise exception 'landing the rename wrote no describe Act'; end if;
  if (select count(*) from acts where kind = 'describe') <> 1 then raise exception 'one describe Act expected, got %', (select count(*) from acts where kind = 'describe'); end if;
  if d.character is not null or d.target_act_id is distinct from mv or d.payload ->> 'move_act' is distinct from mv::text
     or d.payload ->> 'description' is distinct from 'Second admin words.' then
    raise exception 'the describe Act is wrong: %', to_jsonb(d);
  end if;
  -- Every signed-in player reads an Act's payload: it says an admin did it, never which account.
  if d.payload ->> 'by' is distinct from 'admin' or d.payload ? 'admin'
     or d.payload::text like '%' || (select described_by::text from queued_moves where id = q) || '%'
     or d.payload::text like '%' || (select id::text from auth.users where email = 'db-admin@test.invalid') || '%' then
    raise exception 'the describe Act''s payload names an account or not "by admin": %', d.payload;
  end if;
  if d.created_at <= (select created_at from acts where id = mv) then raise exception 'the describe Act is not after the move Act'; end if;
  if (select move_act from boards_now where id = b) is distinct from mv then raise exception 'the board does not name the rename'; end if;
  perform pg_temp.all_say('Second admin words.', 'a board whose rename landed with a replacement');
  if (select name from boards_now where id = b) is distinct from 'Gate Garden' then raise exception 'the rename''s name was lost'; end if;
end $$;

-- ---- A describe after landing wins; it is the latest of them ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'db-admin@test.invalid');
  b uuid := (select id from boards where slug = 'db-board');
  mv uuid := (select landed_act from queued_moves where params ->> 'name' = 'Gate Garden');
begin
  perform tests.become(admin);
  perform describe_board(b, 'After words.');
  perform tests.unbecome();
  perform pg_temp.all_say('After words.', 'a board described after its rename landed');
  if (select payload ->> 'move_act' from acts where kind = 'describe' order by created_at desc, id desc limit 1) is distinct from mv::text then
    raise exception 'a describe while a rename is open should name that rename';
  end if;
  if (select payload #>> '{params,description}' from acts where id = mv) is distinct from 'Boss words.' then raise exception 'describing the board changed the move Act'; end if;
end $$;

-- ---- The rename ends: describes naming it stop showing, and the base description returns ----
do $$
declare
  b uuid := (select id from boards where slug = 'db-board');
  mv uuid := (select landed_act from queued_moves where params ->> 'name' = 'Gate Garden');
begin
  perform end_move(mv, 'reversed', 'admin');
  if (select move_act from boards_now where id = b) is not null then raise exception 'an ended rename still names the board'; end if;
  perform pg_temp.all_say('Base words.', 'a board whose described rename ended');
  -- A describe naming a rename no longer in force would never show: it is refused where it is written, whoever writes it.
  if pg_temp.refusal(format('select write_describe(%L, %L, %L)', b, 'Too late.', mv)) is distinct from '23514' then
    raise exception 'a describe naming an ended rename was written';
  end if;
  if exists (select 1 from acts where kind = 'describe' and payload ->> 'description' = 'Too late.') then raise exception 'the refused describe left an Act'; end if;
  if (select name from boards_now where id = b) is distinct from 'Describe Board' then raise exception 'the old name did not return'; end if;
end $$;

-- ---- With no rename open, a describe names no move and shows; a later rename's own words win over it; its end returns it ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'db-admin@test.invalid');
  b uuid := (select id from boards where slug = 'db-board');
  q bigint := pg_temp.queue('db-boss', 'Second Square', 'Second Boss words.');
  mv uuid;
begin
  perform tests.become(admin);
  perform describe_board(b, 'Standing words.');
  perform tests.unbecome();
  if (select payload ->> 'move_act' from acts where kind = 'describe' order by created_at desc, id desc limit 1) is not null
     or (select target_act_id from acts where kind = 'describe' order by created_at desc, id desc limit 1) is not null then
    raise exception 'a describe with no rename open should name no move';
  end if;
  perform pg_temp.all_say('Standing words.', 'a board described with no rename open');
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  if mv is null then raise exception 'the second rename did not land'; end if;
  if exists (select 1 from acts where kind = 'describe' and payload ->> 'move_act' = mv::text) then raise exception 'a rename with no replacement wrote a describe Act'; end if;
  perform pg_temp.all_say('Second Boss words.', 'a board renamed again with no replacement');
  perform end_move(mv, 'reversed', 'admin');
  perform pg_temp.all_say('Standing words.', 'a board whose second rename ended');
end $$;

-- ---- A describe is written only by the two functions, and a board that is not there is refused ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'db-admin@test.invalid');
  b uuid := (select id from boards where slug = 'db-board');
  ann uuid := (select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements');
  got text;
begin
  got := pg_temp.refusal(format($q$insert into acts (character, kind, thread, payload) values (null, 'describe', %L, jsonb_build_object('description', 'Forged.', 'move_act', null, 'by', 'admin', 'board', %L))$q$, ann, b));
  if got is distinct from '42501' then raise exception 'a describe was written outside its functions: %', got; end if;
  perform tests.become(admin);
  got := pg_temp.refusal(format('select describe_board(%L, %L)', b, E'\n\t'));
  if got is distinct from '22023' then raise exception 'a description of whitespace was accepted: %', got; end if;
  got := pg_temp.refusal(format('select describe_board(%L, %L)', gen_random_uuid(), 'Nowhere.'));
  if got is distinct from 'P0002' then raise exception 'a board that is not there was described: %', got; end if;
  got := pg_temp.refusal(format('select describe_board(%L, %L)', b, repeat('x', 2001)));
  if got is distinct from '22023' then raise exception 'a 2001-character description was accepted: %', got; end if;
  perform tests.unbecome();
  perform pg_temp.all_say('Standing words.', 'a board after refused descriptions');
end $$;

-- ---- A describe that cannot be written takes its rename with it, and both land together once the fault is gone ----
create function pg_temp.fault() returns trigger language plpgsql as $$ begin raise exception 'a planted fault in writing a describe'; end $$;

do $$
declare
  b uuid := (select id from boards where slug = 'db-board');
  q bigint := pg_temp.queue('db-boss', 'Fault Field', 'Fault Boss words.');
  mv uuid;
begin
  update queued_moves set admin_description = 'Fault admin words.', described_by = (select id from auth.users where email = 'db-admin@test.invalid'), described_at = now() where id = q;
  create trigger plant_fault before insert on acts for each row when (new.kind = 'describe') execute function pg_temp.fault();
  perform system_tick();
  if (select landed_act from queued_moves where id = q) is not null or exists (select 1 from acts where kind = 'move' and payload #>> '{params,name}' = 'Fault Field') then
    raise exception 'a rename landed without its describe';
  end if;
  if (select failure from queued_moves where id = q) is null then raise exception 'the failure was not recorded on the row'; end if;
  if exists (select 1 from acts where kind = 'describe' and payload ->> 'description' = 'Fault admin words.') then raise exception 'a describe landed without its rename'; end if;
  perform pg_temp.all_say('Standing words.', 'a board whose rename failed to land');
  drop trigger plant_fault on acts;
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  if mv is null then raise exception 'the rename did not land once the fault was gone'; end if;
  if (select count(*) from acts where kind = 'move' and payload #>> '{params,name}' = 'Fault Field') <> 1
     or (select count(*) from acts where kind = 'describe' and payload ->> 'description' = 'Fault admin words.' and payload ->> 'move_act' = mv::text) <> 1 then
    raise exception 'exactly one move and one describe expected after the fault';
  end if;
  perform pg_temp.all_say('Fault admin words.', 'a board whose rename landed late with its replacement');
end $$;
