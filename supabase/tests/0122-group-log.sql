-- The log's group lines (supabase/migrations/0122_group_log.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 11).
--
-- 1. my_group_moves gives a player a row for each conferGroup move on their own characters, and no one else's; a visitor reads none.
-- 2. A row carries what the line needs: the group, the board and its name, the check, the office the move landed under (its stamp), and an expiry read through move_expires_at.
-- 3. Each end shows (met, expired, reversed, unmet, overturned) with who ended it; a move still running has none.
-- 4. An appeal's ruling on the move shows its verdict, when and the end it set, each of the four verdicts.
-- 5. A move of another kind is not a row, and a row never names another member of a group.

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;
create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

create function pg_temp.landed(staff text, who uuid, grp text, ago interval default interval '1 day', board uuid default null, demand jsonb default null,
                               expires_in interval default interval '4 days', check_at timestamptz default null) returns uuid language plpgsql as $$
declare
  made uuid;
  at timestamptz := clock_timestamp() - ago;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'office', case when staff = 'gl-mod' then 'mod' else 'boss' end,
      'params', jsonb_strip_nulls(jsonb_build_object('character', who::text, 'group', grp, 'board', board::text, 'checkAt', check_at)))
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end
      || case when expires_in is not null then jsonb_build_object('expires_at', at + expires_in) else '{}'::jsonb end,
    null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

-- A ruling on a move, written as the Mod Bots' bans are (0109): an appeal Act by the player's character, then an appeal_ruling Act by the staff member on it. The appeal guard
-- of 0109 knows only infractions and bans until Task 14 teaches open_appeal a group move, so it is switched off for the two inserts, inside this file's transaction.
create function pg_temp.ruled(who uuid, m uuid, staff text, verdict text, until_at timestamptz default null) returns uuid language plpgsql as $$
declare
  ap uuid;
  ru uuid;
begin
  alter table acts disable trigger acts_appeal_guard;
  perform set_config('kayfabb.appeal_writer', 'on', true);
  ap := tests.act(who, 'appeal', pg_temp.announcements(), jsonb_build_object('plea', 'I did nothing wrong.'), m);
  perform set_config('kayfabb.appeal_writer', '', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  ru := tests.act((select id from characters c where c.staff = ruled.staff), 'appeal_ruling', pg_temp.announcements(),
    jsonb_build_object('appeal_act', ap, 'verdict', verdict, 'points_delta', 0, 'line', 'Ruled.') || case when until_at is not null then jsonb_build_object('until', until_at) else '{}'::jsonb end, ap);
  perform set_config('kayfabb.staff_writer', '', true);
  alter table acts enable trigger acts_appeal_guard;
  return ru;
end $$;

do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment'),
      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'color', '#c2408f', 'source', 'conferred', 'tone', 'favor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'gl-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'gl-boss', 'name', 'Gl Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'gl-mod', 'name', 'Gl Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('gl-mod'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into boards (slug, name, description) values ('gl-general', 'General', 'Talk about anything.');
end $$;

do $$
declare
  general uuid := pg_temp.board('gl-general');
  one uuid := tests.character(tests.account('gl-one'), 'Gl One');
  mask uuid := tests.character(pg_temp.owner(one), 'Gl One Mask');
  two uuid := tests.character(tests.account('gl-two'), 'Gl Two');
  apology jsonb := jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb);
  check_at timestamptz := clock_timestamp() + interval '2 days';
  pun uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '1 day', general, apology, interval '4 days');
  fav uuid := pg_temp.landed('gl-mod', mask, 'teachersPet', interval '1 day', null, apology, interval '5 days', check_at);
  theirs uuid := pg_temp.landed('gl-boss', two, 'trialMembers', interval '1 day', general, apology);
  m_met uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '9 days', null, apology);
  m_exp uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '8 days', null, null, interval '1 day');
  m_rev uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '7 days');
  m_unm uuid := pg_temp.landed('gl-mod', mask, 'teachersPet', interval '6 days', null, apology, interval '9 days', clock_timestamp() - interval '5 days');
  m_ovr uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '5 days');
  m_red uuid := pg_temp.landed('gl-boss', one, 'trialMembers', interval '4 days', null, null, interval '8 days');
  m_inc uuid := pg_temp.landed('gl-boss', mask, 'trialMembers', interval '3 days', null, null, interval '4 days');
  m_upl uuid := pg_temp.landed('gl-mod', mask, 'trialMembers', interval '2 days', null, null, interval '4 days');
  r record;
  n integer;
  red_until timestamptz := clock_timestamp() - interval '1 day';
  inc_until timestamptz := clock_timestamp() + interval '6 days';
  lost text;
  ann uuid := pg_temp.announcements();
begin
  -- A move of another kind is not a row.
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.act((select id from characters c where c.staff = 'gl-boss'), 'move', pg_temp.announcements(), jsonb_build_object('kind', 'setRule', 'body', 'x', 'params', jsonb_build_object('character', one::text)));
  perform set_config('kayfabb.staff_writer', '', true);

  perform end_move(m_met, 'met', 'demand');
  perform end_move(m_exp, 'expired', 'expiry');
  perform end_move(m_rev, 'reversed', 'admin');
  perform end_move(m_unm, 'unmet', 'check');
  perform end_move(m_ovr, 'overturned', 'appeal');
  perform pg_temp.ruled(one, m_red, 'gl-boss', 'reduced', red_until);
  perform end_move(m_red, 'expired', 'appeal');
  perform pg_temp.ruled(mask, m_inc, 'gl-boss', 'increased', inc_until);
  perform pg_temp.ruled(mask, m_upl, 'gl-mod', 'upheld');
  perform pg_temp.ruled(one, m_ovr, 'gl-boss', 'overturned');

  -- 1. The caller's own characters, both masks, and no one else's.
  perform tests.become(pg_temp.owner(one));
  select count(*) into n from my_group_moves;
  if n is distinct from 10 then raise exception 'the player sees % group moves of their own; there are 10', n; end if;
  if exists (select 1 from my_group_moves where move = theirs) then raise exception 'a player sees a move on another player''s character'; end if;
  if exists (select 1 from my_group_moves where character = two) then raise exception 'a player sees another player''s character in the log'; end if;
  if (select count(*) from my_group_moves where character = mask) is distinct from 4::bigint then raise exception 'the other mask''s moves are not all here'; end if;
  perform tests.unbecome();
  perform tests.become(pg_temp.owner(two));
  select count(*) into n from my_group_moves;
  if n is distinct from 1 or not exists (select 1 from my_group_moves where move = theirs and character = two) then raise exception 'the other player sees % rows, not just their own', n; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if has_table_privilege('anon', 'my_group_moves', 'select') then raise exception 'a visitor can read my_group_moves'; end if;
  perform tests.unbecome();

  -- 2. What a line needs.
  perform tests.become(pg_temp.owner(one));
  select * into r from my_group_moves where move = pun;
  if r.character is distinct from one or r."group" is distinct from 'trialMembers' or r.board is distinct from general or r.board_name is distinct from 'General' or r.demand is distinct from 'apologyAccepted'
     or r.thread is distinct from ann or r.seq is null or r.office is distinct from 'boss' or r.check_at is not null or r.ended_why is not null or r.ruling is not null then
    raise exception 'a punishment row is wrong: %', to_jsonb(r);
  end if;
  if r.expires_at is distinct from move_expires_at(pun) or r.expires_at is null then raise exception 'the row''s end is not move_expires_at: %', to_jsonb(r); end if;
  select * into r from my_group_moves where move = fav;
  if r.office is distinct from 'mod' or r.board is not null or r.board_name is not null or r.check_at is distinct from check_at or r."group" is distinct from 'teachersPet' then
    raise exception 'a favor row is wrong: %', to_jsonb(r);
  end if;
  if exists (select 1 from my_group_moves m where m.move not in (pun, fav, m_met, m_exp, m_rev, m_unm, m_ovr, m_red, m_inc, m_upl)) then raise exception 'a row that is not a group move is here'; end if;

  -- 3. Each end.
  for r in select * from my_group_moves where ended_why is not null loop
    lost := case r.move when m_met then 'met/demand' when m_exp then 'expired/expiry' when m_rev then 'reversed/admin' when m_unm then 'unmet/check' when m_ovr then 'overturned/appeal' when m_red then 'expired/appeal' end;
    if lost is distinct from r.ended_why || '/' || r.ended_by or r.ended_at is null then raise exception 'an end is wrong for %: %', r.move, to_jsonb(r); end if;
  end loop;
  if (select count(*) from my_group_moves where ended_why is not null) is distinct from 6::bigint then raise exception 'the wrong number of ended moves'; end if;

  -- 4. Rulings, and the expiry read through the ruling.
  select * into r from my_group_moves where move = m_red;
  if r.ruling is distinct from 'reduced' or r.ruled_until is distinct from red_until or r.ruled_at is null or r.expires_at is distinct from red_until then raise exception 'reduced: %', to_jsonb(r); end if;
  select * into r from my_group_moves where move = m_inc;
  if r.ruling is distinct from 'increased' or r.ruled_until is distinct from inc_until or r.expires_at is distinct from inc_until then raise exception 'increased: %', to_jsonb(r); end if;
  select * into r from my_group_moves where move = m_upl;
  if r.ruling is distinct from 'upheld' or r.ruled_until is not null or r.expires_at is distinct from move_expires_at(m_upl) then raise exception 'upheld: %', to_jsonb(r); end if;
  select * into r from my_group_moves where move = m_ovr;
  if r.ruling is distinct from 'overturned' or r.ended_why is distinct from 'overturned' then raise exception 'overturned: %', to_jsonb(r); end if;
  perform tests.unbecome();

  -- 5. A row names no one else: its columns are the character's own and public facts about the move.
  if exists (select 1 from information_schema.columns where table_name = 'my_group_moves' and column_name in ('owner', 'account', 'members', 'others')) then
    raise exception 'the view has a column that could name someone else';
  end if;
end $$;
