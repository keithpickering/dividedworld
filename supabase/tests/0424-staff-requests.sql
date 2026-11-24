-- A Mod's moveThread (supabase/migrations/0424_staff_requests.sql, section 1; docs/plans/2026-11-24-staff-requests-plan.md, Task 1; design section 2).
--
-- 1. move_kinds.offices for moveThread is boss and mod once the migration has run, and a Mod's moveThread on beat (its thread's board and the board it goes to both on the Mod's beat) queues with no expiry and spends one of the allowance.
-- 2. Each board off the beat is refused with its words: the thread's board names the source, the target names the destination. A refusal spends nothing.
-- 3. A Mod's move cannot stay on a thread it is not given: a thread that does not exist is refused.
-- 4. The Boss's moveThread is as it was: queued by the guard without a beat check.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'mm-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

create function pg_temp.memory(hobby text) returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;

create function pg_temp.order_for(mod text, boards jsonb, allowance integer, line text default null) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', boards, 'order', coalesce(line, 'Watch ' || mod || '''s boards.'), 'allowance', allowance, 'memory', pg_temp.memory('hobby of ' || mod))
$$;

create function pg_temp.meet(at text, orders jsonb) returns bigint language plpgsql as $$
declare m bigint := (begin_meeting(at::timestamptz) ->> 'meeting')::bigint;
begin
  perform apply_meeting(m, jsonb_build_object('boss', 'mm-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'orders', orders, 'record', '{}'::jsonb));
  return m;
end $$;

create function pg_temp.mv(board uuid, hours numeric default 48, predicate text default 'noAllCaps', why text default 'Shouting.') returns jsonb language sql as $$
  select jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', board, 'predicate', predicate, 'param', case when predicate = 'bannedWord' then to_jsonb('zzz'::text) else null end, 'band', 'minor'), 'expires_in_hours', hours, 'why', why)
$$;

-- ---- 0. The world: a Boss, two Mods on staff, a member, three boards, a thread with posts to be the causes ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule', 'moveThread', 'the moving of a thread to another board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mm-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'mm-boss', 'name', 'Move Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'mm-m1', 'name', 'Move Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', jsonb_build_array('mm-games')),
        jsonb_build_object('key', 'mm-m2', 'name', 'Move Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'mm-m3', 'name', 'Move Member Three', 'title', 'Member', 'signature', 'Hi', 'beats', jsonb_build_array('mm-games'))),
      'firstStaff', jsonb_build_array('mm-m1', 'mm-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  update characters set debuted_at = now() where staff = 'mm-m3';
  insert into staff_offices (staff, office, cause) values ('mm-m3', 'member', 'admin');
  insert into boards (slug, name, description) values ('mm-games', 'Games', 'Talk about games.'), ('mm-general', 'General', 'Talk about anything.'), ('mm-offtopic', 'Off Topic', 'Wander.');
  insert into move_bank (staff, balance, as_of) values ('mm-boss', 20, now());
  perform tests.account('mm-ann');
  perform tests.character((select id from auth.users where email = 'mm-ann@test.invalid'), 'Mm Poster');
  -- Mod One watches Games and may spend 2; Mod Two watches General and may spend 1.
  perform pg_temp.meet('2031-02-01T09:00:00Z', jsonb_build_array(
    pg_temp.order_for('mm-m1', jsonb_build_array(pg_temp.board('mm-games'), pg_temp.board('mm-offtopic')), 3, 'Crack down on bumping in Games.'),
    pg_temp.order_for('mm-m2', jsonb_build_array(pg_temp.board('mm-general')), 1)));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'mm-ann@test.invalid' $$;
-- A fresh post of a player's, to be a cause (any Act is one).
create function pg_temp.poster() returns uuid language sql as $$ select id from characters where name = 'Mm Poster' $$;
create function pg_temp.cause(label text) returns uuid language sql as $$
  select tests.post(pg_temp.poster(), tests.thread('Cause ' || label), 'A post.')
$$;

create function pg_temp.visit(staff text, post uuid, ends timestamptz, rule text default 'Rule 1: no all-caps posts') returns uuid language plpgsql as $$
declare t uuid := (select thread from acts where id = post);
begin
  return (write_staff_act(staff, 'visit', t, post, jsonb_build_object(
    'charges', jsonb_build_array(jsonb_build_object('rule', rule, 'rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', post::text)),
    'ends_at', ends, 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.')) ->> 'id')::uuid;
end $$;


create function pg_temp.thread_on(slug text, title text) returns uuid language sql as $$
  insert into threads (board, title) select b.id, title from boards b where b.slug = thread_on.slug returning id
$$;

create function pg_temp.mt(thread uuid, board uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', thread, 'board', board), 'expires_in_hours', 0, 'why', 'It belongs there.')
$$;

-- ---- 0b. The migration's own update changes an instance seeded before it ----
-- seed_instance writes offices from the catalog, so the world above already has boss and mod and would hide a migration that lost its `update move_kinds`. An instance seeded earlier has the Boss's alone: put that row back, then run the migration again from the file (its section 1 is create or replace and an update, so it replays), and the row must be the Mod's too.
-- The path is relative to the directory the suite runs from, the repository root (tools/test-sql.mjs).
update move_kinds set offices = array['boss'] where key = 'moveThread';
do $$ begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss'] then raise exception 'the pre-0424 row was not set back'; end if;
end $$;
\i supabase/migrations/0424_staff_requests.sql
do $$ begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss', 'mod'] then raise exception 'the migration did not make moveThread a Mod''s: %', (select offices from move_kinds where key = 'moveThread'); end if;
end $$;

-- ---- 1. A Mod's moveThread on beat queues with no expiry and spends one ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  offtopic uuid := pg_temp.board('mm-offtopic');
  t uuid := pg_temp.thread_on('mm-games', 'Mt Wrong board');
  cause uuid := pg_temp.cause('mt1');
  got jsonb;
  q queued_moves%rowtype;
begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss', 'mod'] then raise exception 'moveThread is not the Boss''s and a Mod''s: %', (select offices from move_kinds where key = 'moveThread'); end if;
  if mod_allowance('mm-m1') is distinct from 3 then raise exception 'the world: mm-m1 holds %', mod_allowance('mm-m1'); end if;
  got := apply_mod_move('mm-m1', pg_temp.mt(t, offtopic), cause);
  if got ->> 'move' is null or (got ->> 'queued')::boolean is distinct from true then raise exception 'a Mod''s moveThread on beat was not queued: %', got; end if;
  if got ->> 'trimmed' is not null then raise exception 'a lasting move was clamped to an expiry: %', got; end if;
  select * into q from queued_moves where id = (got ->> 'move')::bigint;
  if q.kind is distinct from 'moveThread' or q.staff is distinct from 'mm-m1' or q.expires_at is not null then raise exception 'the queued row is wrong (it keeps an expiry): %', to_jsonb(q); end if;
  if q.params ->> 'thread' is distinct from t::text or q.params ->> 'board' is distinct from offtopic::text then raise exception 'the params: %', to_jsonb(q); end if;
  if mod_allowance('mm-m1') is distinct from 2 then raise exception 'queueing did not spend one allowance: %', mod_allowance('mm-m1'); end if;
end $$;

-- ---- 2. Each board off the beat is refused with its words ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  general uuid := pg_temp.board('mm-general');
  offtopic uuid := pg_temp.board('mm-offtopic');
  on_games uuid := pg_temp.thread_on('mm-games', 'Mt Games thread');
  on_general uuid := pg_temp.thread_on('mm-general', 'Mt General thread');
  c2 uuid := pg_temp.cause('mt2');
  before_n bigint := (select count(*) from queued_moves);
  msg text;
  got jsonb;
begin
  -- The thread is on General (Mod Two's): the source is off Mod One's beat, though the target is on it.
  got := apply_mod_move('mm-m1', pg_temp.mt(on_general, offtopic), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null or got ->> 'reason' not like '%thread%board%' or got ->> 'reason' not like '%beat%' then raise exception 'a source off the beat was not refused with its words: %', got; end if;
  -- The thread is on Games, the target is General (Mod Two's): the destination is off the beat.
  got := apply_mod_move('mm-m1', pg_temp.mt(on_games, general), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null or got ->> 'reason' not like '%board it goes to%' or got ->> 'reason' not like '%beat%' then raise exception 'a target off the beat was not refused with its words: %', got; end if;
  -- The two refusals name which board: they differ.
  if apply_mod_move('mm-m1', pg_temp.mt(on_general, offtopic), c2) ->> 'reason' is not distinct from apply_mod_move('mm-m1', pg_temp.mt(on_games, general), c2) ->> 'reason' then raise exception 'the two refusals say the same thing'; end if;
  -- A thread that does not exist is refused too.
  got := apply_mod_move('mm-m1', pg_temp.mt(gen_random_uuid(), offtopic), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a move of no thread was queued: %', got; end if;
  if (select count(*) from queued_moves) is distinct from before_n then raise exception 'a refusal wrote a row'; end if;
  if mod_allowance('mm-m1') is distinct from 2 then raise exception 'refusals spent the allowance: %', mod_allowance('mm-m1'); end if;
end $$;

-- ---- 3. The Boss's moveThread is as it was: no beat, no allowance ----
do $$
declare
  general uuid := pg_temp.board('mm-general');
  t uuid := pg_temp.thread_on('mm-games', 'Mt Boss moves this');
  m bigint := (select max(id) from meetings);
  q bigint;
  q2 bigint;
  nobody uuid;
begin
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mm-boss', 'moveThread', jsonb_build_object('thread', t, 'board', general), null, 'The Boss decides.', now(), now() + interval '48 hours', false) returning id into q;
  if (select expires_at from queued_moves where id = q) is not null then raise exception 'the Boss''s lasting move kept an expiry'; end if;
  if (select spent_order from queued_moves where id = q) is not null then raise exception 'the Boss''s move spent a Mod''s order'; end if;
  -- The beat check is a Mod's alone: the Boss's moveThread to a board no Mod's beat holds (Off Topic is Mod One's, so a fresh board is on nobody's) queues too.
  insert into boards (slug, name, description) values ('mm-nobody', 'Nobody''s', 'On no beat.') returning id into nobody;
  if exists (select 1 from staff_orders o where nobody = any (o.boards)) then raise exception 'the world: a Mod watches the new board'; end if;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mm-boss', 'moveThread', jsonb_build_object('thread', t, 'board', nobody), null, 'The Boss decides again.', now(), null, false) returning id into q2;
  if (select staff from queued_moves where id = q2) is distinct from 'mm-boss' then raise exception 'the Boss''s moveThread off every beat was not queued'; end if;
end $$;
