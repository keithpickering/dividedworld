-- A Mod's move confers a group (supabase/migrations/0124_mod_groups.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 13).
--
-- 1. apply_mod_move queues a Mod's punishment on a board of its beat with the apology demand, spending one allowance; without the demand the guard refuses it; the guard still
--    refuses a favor, a board off the Mod's beat and a held character.
-- 2. mod_group_context lists the conferred catalog and exactly the held and the capped characters, to the service role only.

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


-- ---- 1. apply_mod_move ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  general uuid := pg_temp.board('gm-general');
  target uuid := pg_temp.who('Target');
  other uuid := pg_temp.who('Other');
  r jsonb;
  cause1 uuid;
  cause2 uuid;
  cause3 uuid;
  mv jsonb;
  stored jsonb;
begin
  cause1 := pg_temp.landed('gm-boss', pg_temp.who('C1'), 'teachersPet');
  cause2 := pg_temp.landed('gm-boss', pg_temp.who('C2'), 'teachersPet');
  cause3 := pg_temp.landed('gm-boss', pg_temp.who('C3'), 'teachersPet');
  mv := jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', target, 'group', 'trialMembers', 'board', games),
                           'expires_in_hours', 48, 'why', 'Cool off.', 'demand', pg_temp.apology());
  -- The demand the move carries is the demand the queue holds.
  r := apply_mod_move('gm-m1', mv, cause1);
  if (r ->> 'queued')::boolean is distinct from true then raise exception 'a Mod''s punishment on its beat is queued: %', r; end if;
  select q.demand into stored from queued_moves q where q.id = (r ->> 'move')::bigint;
  if stored is distinct from pg_temp.apology() then raise exception 'the queue holds the move''s demand: %', stored; end if;
  if order_unspent('gm-m1') is distinct from 2 then raise exception 'it spent one allowance of three: %', order_unspent('gm-m1'); end if;
  -- Without the apology, a punishment that bars a board is refused.
  r := apply_mod_move('gm-m1', (mv - 'demand') || jsonb_build_object('params', mv -> 'params' || jsonb_build_object('character', other)), cause2);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' not like '%apologyAccepted%' then raise exception 'a bar with no apology is refused: %', r; end if;
  -- A favor is refused, a board off the beat is refused, a held character is refused.
  r := apply_mod_move('gm-m1', mv || jsonb_build_object('params', mv -> 'params' || jsonb_build_object('character', other, 'group', 'teachersPet')), cause2);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' not like '%never a favor%' then raise exception 'a Mod''s favor is refused: %', r; end if;
  r := apply_mod_move('gm-m1', mv || jsonb_build_object('params', mv -> 'params' || jsonb_build_object('character', other, 'board', general)), cause2);
  if (r ->> 'queued')::boolean is not false then raise exception 'a board off the beat is refused: %', r; end if;
  r := apply_mod_move('gm-m1', mv, cause3);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' not like '%already in a group%' then raise exception 'a held character is refused: %', r; end if;
  -- Another Mod, another beat: its own punishment queues too.
  r := apply_mod_move('gm-m2', mv || jsonb_build_object('params', mv -> 'params' || jsonb_build_object('character', other, 'board', general)), cause2);
  if (r ->> 'queued')::boolean is not true then raise exception 'setup: %', r; end if;
end $$;

-- ---- 2. mod_group_context ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  held uuid := pg_temp.who('Held');
  capped uuid := pg_temp.who('Capped');
  plain uuid := pg_temp.who('Plain');
  r jsonb;
  got text;
begin
  r := mod_group_context();
  if r -> 'conferred' is distinct from jsonb_build_array(jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'tone', 'punishment'),
                                                      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'tone', 'favor')) then
    raise exception 'the conferred catalog: %', r -> 'conferred';
  end if;
  perform pg_temp.landed('gm-boss', held, 'teachersPet', interval '1 hour', null, pg_temp.posts_on(games), interval '1 day', interval '3 days');
  perform pg_temp.landed('gm-boss', capped, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m1', capped, 'trialMembers', interval '3 days', games, pg_temp.apology(), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', capped, 'trialMembers', interval '4 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  r := mod_group_context() -> 'characters';
  if not exists (select 1 from jsonb_array_elements(r) e where e = jsonb_build_object('id', held, 'capped', false, 'held', true))
     or not exists (select 1 from jsonb_array_elements(r) e where e = jsonb_build_object('id', capped, 'capped', true, 'held', false))
     or exists (select 1 from jsonb_array_elements(r) e where e ->> 'id' = plain::text) then
    raise exception 'exactly the held and the capped are listed: %', r;
  end if;
  perform tests.become(pg_temp.ann());
  got := pg_temp.refusal('select mod_group_context()');
  perform tests.unbecome();
  if got is null then raise exception 'a player read mod_group_context'; end if;
end $$;
