-- The conferGroup move in SQL, the cap and the favor's check (supabase/migrations/0125_group_moves.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 5).
--
-- 1. queued_moves_guard refuses a conferGroup move one rule at a time, each in plain words; a good punishment and a good favor are accepted.
-- 2. The targeting cap: staff_punishments counts landed and unheld queued group punishments, whoever made them; a fourth is refused, the window passes, a favor is not counted.
-- 3. demand_params_problem and demand_progress have a case for apologyAccepted (an accepted apology row); the apologies table exists.
-- 4. acts_move_end_payload and end_move take `unmet` and `overturned`; say_move_end says both in their own stock lines.
-- 5. system_line names a conferred group by its name (a derived groupName), falling back to its key.
-- 6. move_expires_at; system_tick's expiry pass reads it; the favor pass strips an unmet favor at its check and leaves a met one to its expiry.
-- 7. reverse_move on a group move returns the character to its rung; bars_now shows a board's bars and only those.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

create function pg_temp.memory(hobby text) returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;
create function pg_temp.order_for(mod text, boards jsonb, allowance integer) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', boards, 'order', 'Watch ' || mod || '''s boards.', 'allowance', allowance, 'memory', pg_temp.memory('hobby of ' || mod))
$$;
create function pg_temp.meet(at text, orders jsonb) returns bigint language plpgsql as $$
declare m bigint := (begin_meeting(at::timestamptz) ->> 'meeting')::bigint;
begin
  perform apply_meeting(m, jsonb_build_object('boss', 'gm-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'orders', orders, 'record', '{}'::jsonb));
  return m;
end $$;

-- ---- 0. The world: a Boss, two Mods (one watching Games), a ladder and two conferred groups, three boards ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveUnmet', jsonb_build_array('Withdrawn, {move}.'),
        'moveOverturned', jsonb_build_array('Overturned, {move}.'), 'moveReversed', jsonb_build_array('Reversed, {move}.'), 'moveExpired', jsonb_build_array('Over, {move}.')),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"', 'setRule', 'a rule')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment'),
      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'color', '#c2408f', 'source', 'conferred', 'tone', 'favor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'gm-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'gm-boss', 'name', 'Group Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'gm-m1', 'name', 'Group Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', jsonb_build_array('gm-games')),
        jsonb_build_object('key', 'gm-m2', 'name', 'Group Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', jsonb_build_array('gm-m1', 'gm-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into boards (slug, name, description) values ('gm-games', 'Games', 'Talk about games.'), ('gm-general', 'General', 'Talk about anything.');
  insert into move_bank (staff, balance, as_of) values ('gm-boss', 20, now());
  perform pg_temp.meet('2031-02-01T09:00:00Z', jsonb_build_array(
    pg_temp.order_for('gm-m1', jsonb_build_array(pg_temp.board('gm-games')), 3),
    pg_temp.order_for('gm-m2', jsonb_build_array(pg_temp.board('gm-general')), 3)));
  perform tests.account('gm-ann');
  insert into admins (account) values (tests.account('gm-admin'));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'gm-ann@test.invalid' $$;
create function pg_temp.who(label text) returns uuid language sql as $$ select tests.character(tests.account('gm-p-' || label), 'Gm ' || label) $$;
create function pg_temp.meeting() returns bigint language sql as $$
  select id from meetings order by id desc limit 1
$$;

-- Queue a conferGroup move as `staff`; returns the guard's refusal, or null when it was queued. Go-live is now; the expiry three days on.
create function pg_temp.queue(staff text, params jsonb, demand jsonb default null, expires interval default interval '3 days') returns text language plpgsql as $$
begin
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (pg_temp.meeting(), staff, 'conferGroup', params, demand, 'because', now(), now() + expires, false);
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.apology() returns jsonb language sql as $$ select jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb) $$;
create function pg_temp.posts_on(board uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 1))
$$;

-- A group move that has landed (as an Act), created `ago` ago, ending in the move_end `why` when given.
create function pg_temp.landed(staff text, who uuid, grp text, ago interval default interval '0', board uuid default null, demand jsonb default null,
                               check_in interval default null, expires_in interval default interval '3 days', ended text default null) returns uuid language plpgsql as $$
declare
  made uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.',
      'params', jsonb_strip_nulls(jsonb_build_object('character', who::text, 'group', grp, 'board', board::text,
        'checkAt', case when check_in is not null then to_char((clock_timestamp() - ago + check_in) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end)))
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end
      || case when expires_in is not null then jsonb_build_object('expires_at', clock_timestamp() - ago + expires_in) else '{}'::jsonb end,
    null, clock_timestamp() - ago);
  perform set_config('kayfabb.staff_writer', '', true);
  if ended is not null then perform end_move(made, ended, 'test'); end if;
  return made;
end $$;

-- ---- 1. The guard, one refusal at a time ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  general uuid := pg_temp.board('gm-general');
  who uuid;
  got text;
  staffc uuid;
  check_at text := to_char((now() + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  late_at text := to_char((now() + interval '4 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  early_at text := to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  who := pg_temp.who('One');
  staffc := (select id from characters where staff = 'gm-m2');

  got := pg_temp.queue('gm-boss', jsonb_build_object('character', gen_random_uuid(), 'group', 'trialMembers'));
  if got is distinct from 'a group move names a member who has debuted' then raise exception 'no such character: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', staffc, 'group', 'trialMembers'));
  if got is distinct from 'a group move never names a staff member' then raise exception 'a staff character: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'members'));
  if got is distinct from 'a group move names a conferred group, and "members" is not one' then raise exception 'a rung: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'nonesuch'));
  if got is distinct from 'a group move names a conferred group, and "nonesuch" is not one' then raise exception 'an unknown group: %', got; end if;

  -- A board only by a punishment, and only a board of the players.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'board', games, 'checkAt', check_at), pg_temp.posts_on(games));
  if got is distinct from 'only a punishment bars a board' then raise exception 'a favor with a board: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', system_board()), pg_temp.apology());
  if got is distinct from 'a group move bars a board of the players, not The System''s' then raise exception 'the system board: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', gen_random_uuid()), pg_temp.apology());
  if got is distinct from 'a group move bars a board of the players, not The System''s' then raise exception 'no such board: %', got; end if;

  -- The apology demand: a barring punishment carries it, nothing else does.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', games));
  if got is distinct from 'a punishment that bars a board carries the demand apologyAccepted' then raise exception 'a bar with no apology: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', games), pg_temp.posts_on(games));
  if got is distinct from 'a punishment that bars a board carries the demand apologyAccepted' then raise exception 'a bar with another demand: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers'), pg_temp.apology());
  if got is distinct from 'only a punishment that bars a board carries the demand apologyAccepted' then raise exception 'an apology with no bar: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', check_at), pg_temp.apology());
  if got is distinct from 'only a punishment that bars a board carries the demand apologyAccepted' then raise exception 'a favor with an apology: %', got; end if;

  -- A favor's check, and a punishment's lack of one.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet'), pg_temp.posts_on(games));
  if got is distinct from 'a favor carries a checkAt between its go-live and its expiry' then raise exception 'a favor with no check: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', late_at), pg_temp.posts_on(games));
  if got is distinct from 'a favor carries a checkAt between its go-live and its expiry' then raise exception 'a check after the expiry: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', early_at), pg_temp.posts_on(games));
  if got is distinct from 'a favor carries a checkAt between its go-live and its expiry' then raise exception 'a check before the go-live: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', 'tomorrow-ish'), pg_temp.posts_on(games));
  if got is distinct from 'a favor carries a checkAt between its go-live and its expiry' then raise exception 'a check that is no time: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', check_at));
  if got is distinct from 'a favor carries the demand its check reads' then raise exception 'a favor with no demand: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'checkAt', check_at));
  if got is distinct from 'a punishment carries no checkAt' then raise exception 'a punishment with a check: %', got; end if;

  -- A Mod confers a punishment that bars a board on its beat, and nothing else.
  got := pg_temp.queue('gm-m1', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', check_at), pg_temp.posts_on(games));
  if got is distinct from 'a Mod confers a punishment, never a favor' then raise exception 'a Mod''s favor: %', got; end if;
  got := pg_temp.queue('gm-m1', jsonb_build_object('character', who, 'group', 'trialMembers'));
  if got is distinct from 'a Mod''s move names the board it watches' then raise exception 'a Mod''s punishment with no board: %', got; end if;
  got := pg_temp.queue('gm-m1', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', general), pg_temp.apology());
  if got is distinct from 'that board is not on gm-m1''s beat' then raise exception 'a Mod off its beat: %', got; end if;
  if exists (select 1 from queued_moves where kind = 'conferGroup') then raise exception 'a refused move left a row'; end if;

  -- The good ones: a Boss's punishment with a bar and an apology, a Boss's favor, a Mod's punishment on its beat, a punishment with no bar and another demand.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', games), pg_temp.apology());
  if got is not null then raise exception 'a good punishment was refused: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', pg_temp.who('Two'), 'group', 'teachersPet', 'checkAt', check_at), pg_temp.posts_on(games));
  if got is not null then raise exception 'a good favor was refused: %', got; end if;
  got := pg_temp.queue('gm-m1', jsonb_build_object('character', pg_temp.who('Three'), 'group', 'trialMembers', 'board', games), pg_temp.apology());
  if got is not null then raise exception 'a Mod''s good punishment was refused: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', pg_temp.who('Four'), 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is not null then raise exception 'a punishment with no bar and another demand was refused: %', got; end if;

  -- One group move at a time: queued unheld, or in force.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers'));
  if got is distinct from 'that character is already in a group a move put it in' then raise exception 'a second move beside a queued one: %', got; end if;
  update queued_moves set held_at = now(), held_by = tests.account('gm-holder') where params ->> 'character' = who::text;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers'));
  if got is not null then raise exception 'a held move still blocked another: %', got; end if;
  perform pg_temp.landed('gm-boss', pg_temp.who('Five'), 'trialMembers');
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', (select id from characters where name = 'Gm Five'), 'group', 'trialMembers'));
  if got is distinct from 'that character is already in a group a move put it in' then raise exception 'a second move beside one in force: %', got; end if;
  perform end_move((select o.move_act from open_moves o join acts a on a.id = o.move_act where a.payload #>> '{params,character}' = (select id::text from characters where name = 'Gm Five')), 'expired', 'test');
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', (select id from characters where name = 'Gm Five'), 'group', 'trialMembers'));
  if got is not null then raise exception 'an ended move still blocked another: %', got; end if;
end $$;

-- ---- 2. The cap: three punishments in seven days, from a Boss or a Mod, landed or queued; a fourth is refused; the window passes; a favor is not counted ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  who uuid := pg_temp.who('Capped');
  other uuid := pg_temp.who('Windowed');
  mixed uuid := pg_temp.who('Queued');
  shouted uuid := pg_temp.who('Shouted');
  got text;
begin
  perform pg_temp.landed('gm-boss', who, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m1', who, 'trialMembers', interval '3 days', games, pg_temp.apology(), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', who, 'trialMembers', interval '4 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-boss', who, 'teachersPet', interval '1 day', null, pg_temp.posts_on(games), interval '1 hour', interval '1 hour', 'expired');
  if staff_punishments(who, 7) is distinct from 3 then raise exception 'three punishments (and no favor) are counted: %', staff_punishments(who, 7); end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is distinct from 'Gm Capped has been punished 3 times in 7 days, the most staff may' then raise exception 'a fourth punishment: %', got; end if;
  got := pg_temp.queue('gm-m1', jsonb_build_object('character', who, 'group', 'trialMembers', 'board', games), pg_temp.apology());
  if got is distinct from 'Gm Capped has been punished 3 times in 7 days, the most staff may' then raise exception 'a Mod''s fourth punishment: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', who, 'group', 'teachersPet', 'checkAt', to_char((now() + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), pg_temp.posts_on(games));
  if got is not null then raise exception 'a favor is not a punishment, the cap does not stop it: %', got; end if;

  -- The window passes: a punishment made eight days ago is not counted.
  perform pg_temp.landed('gm-boss', other, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m1', other, 'trialMembers', interval '3 days', games, pg_temp.apology(), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', other, 'trialMembers', interval '8 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  if staff_punishments(other, 7) is distinct from 2 then raise exception 'a punishment past the window is counted: %', staff_punishments(other, 7); end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', other, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is not null then raise exception 'the window passed and the move was still refused: %', got; end if;
  if staff_punishments(other, 7) is distinct from 3 then raise exception 'a queued unheld punishment is counted: %', staff_punishments(other, 7); end if;
  update queued_moves set held_at = now(), held_by = tests.account('gm-holder2') where params ->> 'character' = other::text;
  if staff_punishments(other, 7) is distinct from 2 then raise exception 'a held punishment is counted: %', staff_punishments(other, 7); end if;

  -- The guard keeps one form of the ids, as a rule's board is kept: an uppercase character and board are stored in lowercase, so every reader (the landed-Act count, the index) finds the move.
  perform pg_temp.landed('gm-boss', shouted, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', shouted, 'trialMembers', interval '3 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', upper(shouted::text), 'group', 'trialMembers', 'board', upper(games::text)), pg_temp.apology());
  if got is not null then raise exception 'an uppercase character and board were refused: %', got; end if;
  if (select q.params ->> 'character' from queued_moves q where lower(q.params ->> 'character') = shouted::text) is distinct from shouted::text
     or (select q.params ->> 'board' from queued_moves q where lower(q.params ->> 'character') = shouted::text) is distinct from games::text then
    raise exception 'the guard kept the ids as given: %', (select q.params from queued_moves q where lower(q.params ->> 'character') = shouted::text);
  end if;
  -- That move lands as the tick writes it (the queued params as stored), and it counts with the two before it: a fourth is refused.
  perform pg_temp.landed('gm-boss', (select (q.params ->> 'character')::uuid from queued_moves q where lower(q.params ->> 'character') = shouted::text), 'trialMembers', interval '1 day', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  update queued_moves set landed_act = (select a.id from acts a where a.kind = 'move' and a.payload #>> '{params,character}' = shouted::text order by a.created_at desc limit 1) where lower(params ->> 'character') = shouted::text;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', upper(shouted::text), 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is distinct from 'Gm Shouted has been punished 3 times in 7 days, the most staff may' then raise exception 'an uppercase-named punishment is not counted toward the cap: %', got; end if;

  -- An overturned one is not counted (as an infraction an appeal overturned is not).
  perform pg_temp.landed('gm-boss', mixed, 'trialMembers', interval '1 day', null, pg_temp.posts_on(games), null, interval '1 day', 'overturned');
  if staff_punishments(mixed, 7) is distinct from 0 then raise exception 'a punishment overturned on appeal is counted: %', staff_punishments(mixed, 7); end if;
end $$;

-- ---- 3. apologyAccepted: the demand's params, its progress, and the table ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  who uuid := pg_temp.who('Sorry');
  move uuid;
  said uuid;
  prog jsonb;
begin
  if demand_params_problem(pg_temp.apology()) is not null then raise exception 'an apologyAccepted demand with empty params is malformed: %', demand_params_problem(pg_temp.apology()); end if;
  if demand_params_problem(jsonb_build_object('kind', 'apologyAccepted', 'params', 'not an object')) is distinct from 'params' then
    raise exception 'an apologyAccepted demand with params that are no object was accepted';
  end if;
  move := pg_temp.landed('gm-boss', who, 'trialMembers', interval '1 hour', games, pg_temp.apology());
  prog := demand_progress(move);
  if prog is distinct from jsonb_build_object('done', 0, 'of', 1, 'met', false) then raise exception 'no apology yet: %', prog; end if;
  said := tests.post(who, tests.thread('Sorry thread'), 'I am sorry.');
  insert into apologies (move_act, apology_act, character, state) values (move, said, who, 'pending');
  if (demand_progress(move) ->> 'met')::boolean then raise exception 'a pending apology met the demand'; end if;
  update apologies set state = 'rejected' where move_act = move;
  if (demand_progress(move) ->> 'met')::boolean then raise exception 'a rejected apology met the demand'; end if;
  update apologies set state = 'accepted' where move_act = move;
  prog := demand_progress(move);
  if prog is distinct from jsonb_build_object('done', 1, 'of', 1, 'met', true) then raise exception 'an accepted apology meets the demand: %', prog; end if;
  if pg_temp.refusal(format($q$insert into apologies (move_act, apology_act, character, state) values (%L, %L, %L, 'sulking')$q$, move, said, who)) is null then
    raise exception 'an apology took a state outside the four';
  end if;
  if has_table_privilege('authenticated', 'apologies', 'select') or has_table_privilege('anon', 'apologies', 'select') then raise exception 'a client can read apologies'; end if;
end $$;

-- ---- 4. The two new ends, and the words that say them ----
do $$
declare
  who uuid := pg_temp.who('Ended');
  a uuid;
  b uuid;
begin
  a := pg_temp.landed('gm-boss', who, 'teachersPet', interval '1 hour', null, pg_temp.posts_on(pg_temp.board('gm-games')), interval '10 minutes');
  if (end_move(a, 'unmet', 'check') ->> 'ended')::boolean is not true then raise exception 'end_move refused unmet'; end if;
  if (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = a) is distinct from 'unmet' then raise exception 'unmet was not written'; end if;
  b := pg_temp.landed('gm-boss', pg_temp.who('Ended Two'), 'trialMembers', interval '1 hour');
  if (end_move(b, 'overturned', 'appeal') ->> 'ended')::boolean is not true then raise exception 'end_move refused overturned'; end if;
  if (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = b) is distinct from 'overturned' then raise exception 'overturned was not written'; end if;
  if pg_temp.refusal(format($q$select end_move(%L, 'sulked', 'test')$q$, pg_temp.landed('gm-boss', pg_temp.who('Ended Three'), 'trialMembers'))) not like 'a move ends as%' then
    raise exception 'end_move took a reason outside its list';
  end if;
  perform say_move_end(a, 'unmet');
  if not exists (select 1 from acts where kind = 'post' and thread = pg_temp.announcements() and payload ->> 'body' = 'Withdrawn, moving a member into "Teacher''s Pet".') then
    raise exception 'unmet is said in moveUnmet, naming the group: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
  perform say_move_end(b, 'overturned');
  if not exists (select 1 from acts where kind = 'post' and thread = pg_temp.announcements() and payload ->> 'body' = 'Overturned, moving a member into "Trial Members".') then
    raise exception 'overturned is said in moveOverturned, naming the group: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
end $$;

-- ---- 5. system_line names a conferred group by its name, and by its key where no row has it ----
do $$
declare
  line text;
begin
  line := system_line('moveUnmet', 'conferGroup', jsonb_build_object('character', gen_random_uuid(), 'group', 'trialMembers'), 'gm-boss');
  if line is distinct from 'Withdrawn, moving a member into "Trial Members".' then raise exception 'the group is named by its name: %', line; end if;
  line := system_line('moveUnmet', 'conferGroup', jsonb_build_object('character', gen_random_uuid(), 'group', 'longGone'), 'gm-boss');
  if line is distinct from 'Withdrawn, moving a member into "longGone".' then raise exception 'a group with no row is named by its key: %', line; end if;
  -- A kind that does not derive it is as it was: the token stays unfilled rather than becoming the group's name.
  line := system_line('moveUnmet', 'setRule', jsonb_build_object('group', 'trialMembers'), 'gm-boss');
  if line like '%Trial Members%' then raise exception 'a kind that derives no groupName was given one: %', line; end if;
end $$;

-- ---- 6. move_expires_at, and the tick: expiry, and the favor's check ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  expiring uuid := pg_temp.who('Expiring');
  met uuid := pg_temp.who('Met');
  unmet uuid := pg_temp.who('Unmet');
  early uuid := pg_temp.who('Early');
  erring uuid := pg_temp.who('Erring');
  m_err uuid;
  poster uuid := pg_temp.who('Poster');
  m_exp uuid;
  m_met uuid;
  m_unmet uuid;
  m_early uuid;
  m_plain uuid;
  ends timestamptz;
  before_n bigint;
  games_thread uuid;
begin
  insert into threads (board, title) values (games, 'Gm games thread') returning id into games_thread;
  m_plain := pg_temp.landed('gm-boss', pg_temp.who('Plain'), 'trialMembers', interval '0', null, pg_temp.posts_on(games), null, interval '2 days');
  ends := move_expires_at(m_plain);
  if ends is distinct from (select (payload ->> 'expires_at')::timestamptz from acts where id = m_plain) then raise exception 'move_expires_at is the move''s own expiry: %', ends; end if;
  if move_expires_at(gen_random_uuid()) is not null then raise exception 'move_expires_at of nothing is null'; end if;

  -- Expiry, as before: a move past its expiry ends expired.
  m_exp := pg_temp.landed('gm-boss', expiring, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day');
  -- A favor whose check came, met by a post since it landed: kept. One whose check came with nothing done: ended unmet. One whose check has not come: untouched.
  m_met := pg_temp.landed('gm-boss', met, 'teachersPet', interval '3 hours', null, pg_temp.posts_on(games), interval '2 hours', interval '2 days');
  perform tests.post(poster, games_thread, 'Posting on Games.', now() - interval '1 hour');
  m_unmet := pg_temp.landed('gm-boss', unmet, 'teachersPet', interval '3 hours', null, pg_temp.posts_on(pg_temp.board('gm-general')), interval '2 hours', interval '2 days');
  m_early := pg_temp.landed('gm-boss', early, 'teachersPet', interval '1 hour', null, pg_temp.posts_on(games), interval '5 hours', interval '2 days');
  -- A favor whose demand cannot be evaluated at its check is not stripped on that evidence; it is read again.
  insert into demand_kinds (key) values ('poisonKind');
  m_err := pg_temp.landed('gm-boss', erring, 'teachersPet', interval '3 hours', null, jsonb_build_object('kind', 'poisonKind', 'params', '{}'::jsonb), interval '2 hours', interval '2 days');
  before_n := (select count(*) from acts where kind = 'post' and payload ->> 'body' = 'Withdrawn, moving a member into "Teacher''s Pet".');
  perform system_tick();
  -- A second tick strips nothing twice: one unmet end, one line.
  perform system_tick();
  if (select count(*) from acts where kind = 'move_end' and target_act_id = m_unmet) is distinct from 1::bigint then raise exception 'a second tick ended the unmet favor again'; end if;
  if (select count(*) from acts where kind = 'post' and payload ->> 'body' = 'Withdrawn, moving a member into "Teacher''s Pet".') is distinct from before_n + 1 then
    raise exception 'a second tick said the withdrawal again: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
  if not exists (select 1 from open_moves where move_act = m_met) then raise exception 'a favor met by its check was ended'; end if;
  if exists (select 1 from open_moves where move_act = m_unmet) then raise exception 'a favor unmet at its check was kept'; end if;
  if (select payload ->> 'why' || '/' || (payload ->> 'by') from acts where kind = 'move_end' and target_act_id = m_unmet) is distinct from 'unmet/check' then
    raise exception 'the unmet favor ended as %', (select payload from acts where kind = 'move_end' and target_act_id = m_unmet);
  end if;
  if not exists (select 1 from open_moves where move_act = m_err) then raise exception 'a favor whose demand failed to evaluate was stripped'; end if;
  if not exists (select 1 from open_moves where move_act = m_early) then raise exception 'a favor before its check was ended'; end if;
  if exists (select 1 from open_moves where move_act = m_exp) then raise exception 'the expiry pass no longer ends an expired move'; end if;
  if (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = m_exp) is distinct from 'expired' then raise exception 'an expired move ended as something else'; end if;
  if not exists (select 1 from open_moves where move_act = m_plain) then raise exception 'a move in force was ended'; end if;
  if (select count(*) from acts where kind = 'post' and payload ->> 'body' = 'Withdrawn, moving a member into "Teacher''s Pet".') is distinct from before_n + 1 then
    raise exception 'the Boss says the favor is withdrawn, naming the group, once: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;

  -- The met favor is left to its expiry: once that passes, it ends expired.
  perform pg_temp.landed('gm-boss', pg_temp.who('Lapsing'), 'teachersPet', interval '3 hours', null, pg_temp.posts_on(games), interval '2 hours', interval '1 hour');
  perform system_tick();
  if exists (select 1 from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'conferGroup' and (a.payload ->> 'expires_at')::timestamptz <= now()) then
    raise exception 'a move past its expiry is still in force';
  end if;
end $$;

-- ---- 7. reverse_move on a group move, and bars_now ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  who uuid := pg_temp.who('Barred');
  fav uuid := pg_temp.who('Favored');
  nobar uuid := pg_temp.who('Unbarred');
  admin uuid := (select id from auth.users where email = 'gm-admin@test.invalid');
  move uuid;
  got text;
  seen record;
begin
  move := pg_temp.landed('gm-boss', who, 'trialMembers', interval '1 hour', games, pg_temp.apology(), null, interval '2 days');
  perform pg_temp.landed('gm-boss', fav, 'teachersPet', interval '1 hour', null, pg_temp.posts_on(games), interval '1 day', interval '2 days');
  perform pg_temp.landed('gm-boss', nobar, 'trialMembers', interval '1 hour', null, pg_temp.posts_on(games), null, interval '2 days');
  select "group" into got from characters_public where id = who;
  if got is distinct from 'trialMembers' then raise exception 'the barred character is in its group: %', coalesce(got, 'null'); end if;

  select * into seen from bars_now where character = who;
  if seen is null or seen.board is distinct from games or seen.move_act is distinct from move or seen."group" is distinct from 'trialMembers'
     or seen.expires_at is distinct from move_expires_at(move) then
    raise exception 'bars_now shows the bar: %', to_jsonb(seen);
  end if;
  if (select count(*) from bars_now where character in (who, fav, nobar)) is distinct from 1::bigint then raise exception 'bars_now shows only moves that bar a board: %', (select jsonb_agg(to_jsonb(b)) from bars_now b); end if;
  -- A signed-in player and a visitor read it; it names what the move's public Act already says.
  perform tests.become(pg_temp.ann());
  if (select count(*) from bars_now where character in (who, fav, nobar)) is distinct from 1::bigint then raise exception 'a player cannot read bars_now'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if (select count(*) from bars_now where character in (who, fav, nobar)) is distinct from 1::bigint then raise exception 'a visitor cannot read bars_now'; end if;
  perform tests.unbecome();

  -- An admin reverses it: the character is back on its rung, and the bar is gone.
  perform tests.become(admin);
  perform reverse_move(move);
  perform tests.unbecome();
  select "group" into got from characters_public where id = who;
  if got is distinct from 'members' then raise exception 'a reversed group move returns the character to its rung, not %', coalesce(got, 'null'); end if;
  if exists (select 1 from bars_now where character = who) then raise exception 'a reversed move still bars'; end if;
  if (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = move) is distinct from 'reversed' then raise exception 'the reversal was not written'; end if;
end $$;
