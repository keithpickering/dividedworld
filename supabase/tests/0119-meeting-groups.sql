-- The meeting confers groups (supabase/migrations/0119_meeting_groups.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 8).
--
-- 1. meeting_context carries `groups`: the conferred catalog (key, name, tone) and no rung; the characters listed are exactly the held and the capped, each with the group it
--    is in now, and nobody else. Held: a group move in force, or queued and not held (a held one frees the character). Capped: staff_punishments at the cap, a favor and a
--    punishment past the window not counted. A staff character is never listed.
-- 2. apply_meeting lands a conferGroup move whose checkAt passes the guard: a check inside the favor's window is kept as written; one that the later landing has put outside
--    it (the answer's clock was earlier) is moved to half the favor's life; a punishment that bars a board lands with its apology demand.

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


-- ---- 1. meeting_context: the catalog, the held and the capped ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  r jsonb;
  held uuid := pg_temp.who('Held');
  queued uuid := pg_temp.who('QueuedOne');
  freed uuid := pg_temp.who('Freed');
  capped uuid := pg_temp.who('Capped');
  windowed uuid := pg_temp.who('Windowed');
  plain uuid := pg_temp.who('Plain');
  staffc uuid := (select id from characters where staff = 'gm-m2');
  got text;
  entry jsonb;
begin
  r := meeting_context() -> 'groups';
  if r -> 'conferred' is distinct from jsonb_build_array(jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'tone', 'punishment'),
                                                      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'tone', 'favor')) then
    raise exception 'the conferred catalog (rungs left out): %', r -> 'conferred';
  end if;
  if r -> 'characters' is distinct from '[]'::jsonb then raise exception 'nobody is held or capped yet: %', r -> 'characters'; end if;

  -- Held: in force.
  perform pg_temp.landed('gm-boss', held, 'teachersPet', interval '1 hour', null, pg_temp.posts_on(games), interval '1 day', interval '3 days');
  -- Held: queued and not held; freed when an admin holds it.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', queued, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is not null then raise exception 'setup: %', got; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', freed, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is not null then raise exception 'setup: %', got; end if;
  update queued_moves set held_at = now(), held_by = tests.account('gm-holder') where params ->> 'character' = freed::text;
  -- Capped: three punishments in the window (one not in force any more), one outside it and a favor are not counted.
  perform pg_temp.landed('gm-boss', capped, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m1', capped, 'trialMembers', interval '3 days', games, pg_temp.apology(), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', capped, 'trialMembers', interval '4 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-boss', windowed, 'trialMembers', interval '2 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m1', windowed, 'trialMembers', interval '3 days', games, pg_temp.apology(), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-m2', windowed, 'trialMembers', interval '8 days', null, pg_temp.posts_on(games), null, interval '1 day', 'expired');
  perform pg_temp.landed('gm-boss', plain, 'teachersPet', interval '2 days', null, pg_temp.posts_on(games), interval '1 hour', interval '1 hour', 'expired');

  r := meeting_context() -> 'groups' -> 'characters';
  if jsonb_array_length(r) is distinct from 3 then raise exception 'exactly the held (in force, queued) and the capped are listed: %', r; end if;
  entry := (select e from jsonb_array_elements(r) e where e ->> 'id' = held::text);
  if entry is distinct from jsonb_build_object('id', held, 'capped', false, 'held', true) then
    raise exception 'a character in force: %', entry;
  end if;
  entry := (select e from jsonb_array_elements(r) e where e ->> 'id' = queued::text);
  if entry is distinct from jsonb_build_object('id', queued, 'capped', false, 'held', true) then raise exception 'a character queued and unheld: %', entry; end if;
  entry := (select e from jsonb_array_elements(r) e where e ->> 'id' = capped::text);
  if entry is distinct from jsonb_build_object('id', capped, 'capped', true, 'held', false) then raise exception 'a capped character: %', entry; end if;
  if exists (select 1 from jsonb_array_elements(r) e where e ->> 'id' in (freed::text, windowed::text, plain::text, staffc::text)) then
    raise exception 'a held-by-admin move, two punishments in the window, a lapsed favor or a staff character is listed: %', r;
  end if;
  -- The listing agrees with what the guard would refuse.
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', capped, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is null then raise exception 'the guard let a listed capped character through'; end if;
  got := pg_temp.queue('gm-boss', jsonb_build_object('character', held, 'group', 'trialMembers'), pg_temp.posts_on(games));
  if got is null then raise exception 'the guard let a listed held character through'; end if;
  -- The reference list's groups: character_groups names the group each shown character is in now (a rung's or a conferred group's name), by id, for ids that are characters.
  r := character_groups(jsonb_build_array(held, plain, gen_random_uuid(), 'not a uuid', null));
  if (select e ->> 'group' from jsonb_array_elements(r) e where e ->> 'id' = held::text) is distinct from 'Teacher''s Pet'
     or (select e ->> 'group' from jsonb_array_elements(r) e where e ->> 'id' = plain::text) is distinct from 'Members'
     or jsonb_array_length(r) is distinct from 2 then
    raise exception 'character_groups: %', r;
  end if;
  if character_groups('"x"') is distinct from '[]'::jsonb then raise exception 'character_groups of a non-list'; end if;
  -- One cap in one place: mod_cap reads the setting, and falls back to the one default when the setting is not there.
  if mod_cap() is distinct from '{"punishments": 3, "days": 7}'::jsonb then raise exception 'mod_cap: %', mod_cap(); end if;
  delete from settings where key = 'modBots';
  if mod_cap() is distinct from '{"punishments": 3, "days": 7}'::jsonb then raise exception 'mod_cap with no setting: %', mod_cap(); end if;
  got := pg_temp.refusal('select staff_punishments(' || quote_literal(capped::text) || '::uuid, (mod_cap() ->> ''days'')::integer)');
  if got is not null then raise exception 'mod_cap is unusable: %', got; end if;
  -- Only the service role reads it (as before).
  perform tests.become(pg_temp.ann());
  got := pg_temp.refusal('select meeting_context()');
  if got is null then raise exception 'a player read the meeting''s context'; end if;
  got := pg_temp.refusal('select character_groups(''[]'')');
  perform tests.unbecome();
  if got is null then raise exception 'a player read character_groups'; end if;
end $$;

-- ---- 2. apply_meeting lands a conferGroup move with its checkAt ----
do $$
declare
  games uuid := pg_temp.board('gm-games');
  pet uuid := pg_temp.who('Pet');
  stale uuid := pg_temp.who('Stale');
  bad uuid := pg_temp.who('Bad');
  barred uuid := pg_temp.who('Barred');
  m bigint;
  q record;
  inside text := to_char((now() + interval '1 day 1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  early text := to_char((now() - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  r jsonb;
begin
  m := (begin_meeting('2031-02-08T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  r := apply_meeting(m, jsonb_build_object('boss', 'gm-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'orders', '[]'::jsonb, 'record', '{}'::jsonb,
    'moves', jsonb_build_array(
      jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', pet, 'group', 'teachersPet', 'checkAt', inside), 'demand', pg_temp.posts_on(games),
        'go_live_at', now() + interval '1 hour', 'expires_in_hours', 72, 'why', 'A favor.'),
      jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', stale, 'group', 'teachersPet', 'checkAt', early), 'demand', pg_temp.posts_on(games),
        'go_live_at', now() + interval '1 hour', 'expires_in_hours', 72, 'why', 'A favor whose check the clock outran.'),
      jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', bad, 'group', 'teachersPet', 'checkAt', 'someday'), 'demand', pg_temp.posts_on(games),
        'go_live_at', now() + interval '1 hour', 'expires_in_hours', 72, 'why', 'A favor whose check is no time.'),
      jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', barred, 'group', 'trialMembers', 'board', games), 'demand', pg_temp.apology(),
        'go_live_at', now() + interval '1 hour', 'expires_in_hours', 72, 'why', 'A punishment.'))));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 4 then raise exception 'the meeting was not applied whole: %', r; end if;

  select * into q from queued_moves x where x.meeting = m and x.params ->> 'character' = pet::text;
  if q.params ->> 'checkAt' is distinct from inside then raise exception 'a check inside the window is kept as written: %', q.params; end if;
  if (q.params ->> 'checkAt')::timestamptz <= q.go_live_at or (q.params ->> 'checkAt')::timestamptz >= q.expires_at then raise exception 'the kept check is outside the favor''s life'; end if;

  select * into q from queued_moves x where x.meeting = m and x.params ->> 'character' = stale::text;
  if abs(extract(epoch from (q.params ->> 'checkAt')::timestamptz - (q.go_live_at + (q.expires_at - q.go_live_at) / 2))) > 0.01 then
    raise exception 'a check outside the window is moved to half the favor''s life: % (live % to %)', q.params ->> 'checkAt', q.go_live_at, q.expires_at;
  end if;
  select * into q from queued_moves x where x.meeting = m and x.params ->> 'character' = bad::text;
  if abs(extract(epoch from (q.params ->> 'checkAt')::timestamptz - (q.go_live_at + (q.expires_at - q.go_live_at) / 2))) > 0.01 then raise exception 'a check that is no time is moved to half: %', q.params; end if;

  select * into q from queued_moves x where x.meeting = m and x.params ->> 'character' = barred::text;
  if q.demand ->> 'kind' is distinct from 'apologyAccepted' or q.params ->> 'board' is distinct from games::text or q.params ? 'checkAt' then
    raise exception 'a punishment with a bar lands with its apology and no check: % %', q.params, q.demand;
  end if;
  if (select count(*) from queued_moves x where x.meeting = m and x.kind = 'conferGroup') is distinct from 4 then raise exception 'four group moves are queued'; end if;
end $$;
