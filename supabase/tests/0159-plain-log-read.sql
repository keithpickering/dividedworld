-- What the log's read carries (supabase/migrations/0153_plain_log_read.sql; docs/plans/2026-11-11-plain-words-plan.md, Task 7).
--
-- 1. write_staff_act stamps `office` on an appeal_ruling as it does on a move; a ruling written without a stamp stays without one.
-- 2. my_group_moves says which office heard the latest ruling (`ruled_office`): the Boss's, though the move's own `office` is the Mod's that has since left staff.
--    A ruling with no stamp reads null; no default stands in for it.
-- 3. my_bans says the verdict of the ruling on the ban's appeal (`ruling`) and the ban's own end (`own_until`), and its `until` is the latest ruling's.
-- 4. my_caught and log_page answer no bought_price.

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
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'office', case when staff = 'pl-mod' then 'mod' else 'boss' end,
      'params', jsonb_strip_nulls(jsonb_build_object('character', who::text, 'group', grp, 'board', board::text, 'checkAt', check_at)))
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end
      || case when expires_in is not null then jsonb_build_object('expires_at', at + expires_in) else '{}'::jsonb end,
    null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

-- Run a statement as an account (null: the service role); its first column as text, or 'ERROR: ' and the refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

-- The appeal and its ruling through the real doors (0135): the player's open_appeal, the service's close_appeal. Each is an assertion that the door took it.
create function pg_temp.opened(c uuid, m uuid) returns uuid language plpgsql as $$
declare r text := pg_temp.as_val(pg_temp.owner(c), format('select open_appeal(%L, %L, %L) ->> %L', c, m, 'I did nothing wrong.', 'appeal'));
begin
  if r like 'ERROR:%' then raise exception 'open_appeal refused a group punishment of the character''s own: %', r; end if;
  return r::uuid;
end $$;
create function pg_temp.closed(ap uuid, verdict text) returns void language plpgsql as $$
declare r text := pg_temp.as_val(null, format('select close_appeal(%L, %L, %L, null, null)', ap, verdict, 'A line.'));
begin
  if r like 'ERROR:%' then raise exception 'close_appeal refused: %', r; end if;
end $$;
create function pg_temp.ruled(c uuid, m uuid, verdict text) returns void language plpgsql as $$
begin
  perform pg_temp.closed(pg_temp.opened(c, m), verdict);
end $$;

-- A ban on a character, behind the infraction it follows (an infraction needs a post of the character's own, in the thread).
create function pg_temp.banned(c uuid, t uuid, at timestamptz, until timestamptz, days integer) returns uuid language plpgsql as $$
declare p uuid := tests.post(c, t, 'A post ' || gen_random_uuid(), at); i uuid;
begin
  perform set_config('kayfabb.warn_writer', 'on', true);
  i := tests.act(null::uuid, 'infraction', t, jsonb_build_object('character', c, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t), 'about_act', p, 'visit_act', null, 'staff', 'pl-mod', 'expires_at', (at + interval '14 days')::text), null, at);
  return tests.act(null::uuid, 'ban', t, jsonb_build_object('character', c, 'days', days, 'until', until::text, 'infraction_act', i, 'season', 1), null, at);
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
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'pl-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'pl-boss', 'name', 'Gl Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'pl-mod', 'name', 'Gl Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('pl-mod'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into settings (key, value) values ('moveExpiryMostDays', '90') on conflict (key) do update set value = '90';
  insert into boards (slug, name, description) values ('pl-general', 'General', 'Talk about anything.');
end $$;


do $$
declare
  general uuid := pg_temp.board('pl-general');
  one uuid := tests.character(tests.account('pl-one'), 'Pl One');
  mask uuid := tests.character(pg_temp.owner(one), 'Pl One Mask');
  m_mod uuid := pg_temp.landed('pl-mod', one, 'trialMembers', interval '3 days', null, null, interval '20 days');
  m_old uuid := pg_temp.landed('pl-mod', one, 'trialMembers', interval '2 days', null, null, interval '20 days');
  m_boss uuid := pg_temp.landed('pl-boss', mask, 'trialMembers', interval '1 day', null, null, interval '20 days');
  r record;
  ap uuid;
  stamped jsonb;
  doc jsonb;
begin
  insert into wallets (account, balance) values (pg_temp.owner(one), 500) on conflict (account) do update set balance = excluded.balance;
  -- 1. A ruling by the Boss on a Mod's move, written through the staff door, carries the office the Boss held.
  ap := pg_temp.opened(one, m_mod);
  insert into staff_offices (staff, office, cause) values ('pl-mod', 'member', 'admin');
  perform pg_temp.closed(ap, 'overturned');
  stamped := (select payload from acts where kind = 'appeal_ruling' and target_act_id = ap);
  if stamped ->> 'office' is distinct from 'boss' then raise exception 'a ruling is stamped with its hearer''s office: %', stamped; end if;

  -- 2. ruled_office is the hearer's office, the move's `office` the maker's.
  perform tests.become(pg_temp.owner(one));
  select * into r from my_group_moves where move = m_mod;
  if r.office is distinct from 'mod' or r.ruled_office is distinct from 'boss' then
    raise exception 'a Mod''s move ruled by the Boss: office %, ruled_office %', r.office, r.ruled_office;
  end if;
  -- A ruling written before the stamp existed reads null, whatever office the move was made under.
  perform tests.unbecome();
  perform set_config('kayfabb.appeal_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  ap := tests.act(one, 'appeal', pg_temp.announcements(), jsonb_build_object('plea', 'No.'), m_old, clock_timestamp());
  perform tests.act((select id from characters c where c.staff = 'pl-boss'), 'appeal_ruling', pg_temp.announcements(),
    jsonb_build_object('appeal_act', ap, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Old.'), ap, clock_timestamp());
  perform set_config('kayfabb.appeal_writer', '', true);
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become(pg_temp.owner(one));
  select * into r from my_group_moves where move = m_old;
  if r.ruling is distinct from 'upheld' or r.ruled_office is not null then raise exception 'an unstamped ruling names no hearer: ruling %, ruled_office %', r.ruling, r.ruled_office; end if;
  -- A move with no ruling has no hearer either.
  select * into r from my_group_moves where move = m_boss;
  if r.ruled_office is not null then raise exception 'a move with no ruling names a hearer: %', r.ruled_office; end if;
  perform tests.unbecome();
end $$;

do $$
declare
  one uuid := tests.character(tests.account('pl-ban-one'), 'Pl Ban One');
  mask uuid := tests.character(pg_temp.owner(one), 'Pl Ban Mask');
  t uuid := tests.thread('Pl bans');
  at timestamptz := clock_timestamp() - interval '10 days';
  b_none uuid; b_over uuid; b_red uuid; b_inc uuid; b_two uuid; b_mask uuid;
  appeal uuid;
  r record;
  boss uuid := (select id from characters c where c.staff = 'pl-boss');
  doc jsonb;
begin
  b_none := pg_temp.banned(one, t, at, at + interval '4 days', 4);
  b_over := pg_temp.banned(one, t, at + interval '1 minute', at + interval '4 days', 4);
  b_red := pg_temp.banned(one, t, at + interval '2 minutes', at + interval '4 days', 4);
  b_inc := pg_temp.banned(one, t, at + interval '3 minutes', at + interval '4 days', 4);
  b_two := pg_temp.banned(one, t, at + interval '4 minutes', at + interval '4 days', 4);
  b_mask := pg_temp.banned(mask, t, at + interval '5 minutes', at + interval '2 days', 2);
  perform set_config('kayfabb.appeal_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  -- One ruling each: overturned (ends at once), reduced (shorter), increased (longer); one ban appealed twice, the later ruling's end the one read.
  appeal := tests.act(one, 'appeal', t, jsonb_build_object('plea', 'No.'), b_over, at + interval '1 hour');
  perform tests.act(boss, 'appeal_ruling', t, jsonb_build_object('appeal_act', appeal, 'verdict', 'overturned', 'points_delta', 0, 'line', 'x', 'until', (at + interval '1 hour')::text), appeal, at + interval '2 hours');
  appeal := tests.act(one, 'appeal', t, jsonb_build_object('plea', 'No.'), b_red, at + interval '1 hour');
  perform tests.act(boss, 'appeal_ruling', t, jsonb_build_object('appeal_act', appeal, 'verdict', 'reduced', 'points_delta', 0, 'line', 'x', 'until', (at + interval '2 days')::text), appeal, at + interval '2 hours');
  appeal := tests.act(one, 'appeal', t, jsonb_build_object('plea', 'No.'), b_inc, at + interval '1 hour');
  perform tests.act(boss, 'appeal_ruling', t, jsonb_build_object('appeal_act', appeal, 'verdict', 'increased', 'points_delta', 0, 'line', 'x', 'until', (at + interval '6 days')::text), appeal, at + interval '2 hours');
  appeal := tests.act(one, 'appeal', t, jsonb_build_object('plea', 'First.'), b_two, at + interval '1 hour');
  perform tests.act(boss, 'appeal_ruling', t, jsonb_build_object('appeal_act', appeal, 'verdict', 'reduced', 'points_delta', 0, 'line', 'x', 'until', (at + interval '2 days')::text), appeal, at + interval '2 hours');
  appeal := tests.act(one, 'appeal', t, jsonb_build_object('plea', 'Second.'), b_two, at + interval '3 hours');
  perform tests.act(boss, 'appeal_ruling', t, jsonb_build_object('appeal_act', appeal, 'verdict', 'increased', 'points_delta', 0, 'line', 'x', 'until', (at + interval '7 days')::text), appeal, at + interval '4 hours');
  perform set_config('kayfabb.appeal_writer', '', true);
  perform set_config('kayfabb.staff_writer', '', true);

  perform tests.become(pg_temp.owner(one));
  select * into r from my_bans where ban = b_none;
  if r.ruling is not null or r.own_until is distinct from r.until then raise exception 'a ban with no appeal reads no ruling and its own end: %', to_jsonb(r); end if;
  select * into r from my_bans where ban = b_over;
  if r.ruling is distinct from 'overturned' or r.own_until is distinct from at + interval '4 days' or r.until is distinct from at + interval '1 hour' then raise exception 'overturned: %', to_jsonb(r); end if;
  select * into r from my_bans where ban = b_red;
  if r.ruling is distinct from 'reduced' or r.own_until is distinct from at + interval '4 days' or r.until is distinct from at + interval '2 days' then raise exception 'reduced: %', to_jsonb(r); end if;
  select * into r from my_bans where ban = b_inc;
  if r.ruling is distinct from 'increased' or r.own_until is distinct from at + interval '4 days' or r.until is distinct from at + interval '6 days' then raise exception 'increased: %', to_jsonb(r); end if;
  select * into r from my_bans where ban = b_two;
  if r.ruling is distinct from 'increased' or r.until is distinct from at + interval '7 days' then raise exception 'a ban appealed twice reads the later ruling: %', to_jsonb(r); end if;
  if (select count(*) from my_bans where ban in (b_none, b_over, b_red, b_inc, b_two)) is distinct from 5::bigint then raise exception 'a ban is more than one row'; end if;
  -- The other mask's ban is its own row, with its own end.
  select * into r from my_bans where ban = b_mask;
  if r.character is distinct from mask or r.ruling is not null then raise exception 'the other mask''s ban: %', to_jsonb(r); end if;

  -- log_page carries the new columns and the row is no wider than the view.
  doc := log_page(null);
  if (select x ->> 'ruling' from jsonb_array_elements(doc #> '{sources,bans}') x where x ->> 'ban' = b_over::text) is distinct from 'overturned'
     or (select x ->> 'own_until' from jsonb_array_elements(doc #> '{sources,bans}') x where x ->> 'ban' = b_over::text) is null then
    raise exception 'log_page bans do not carry ruling and own_until: %', doc #> '{sources,bans}';
  end if;
  if not (doc #> '{sources,groupMoves}' = '[]'::jsonb or (doc #> '{sources,groupMoves,0}') ? 'ruled_office') then raise exception 'log_page groupMoves lack ruled_office'; end if;
  perform tests.unbecome();
end $$;

-- 4. The machine's price of a caught card is not a column of the caller's read.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'my_caught' and column_name = 'bought_price') then raise exception 'my_caught still carries bought_price'; end if;
  if pg_get_functiondef('log_page(timestamptz)'::regprocedure) like '%bought_price%' then raise exception 'log_page still selects bought_price'; end if;
  if not has_table_privilege('authenticated', 'my_caught', 'select') or has_table_privilege('anon', 'my_caught', 'select') then raise exception 'my_caught grants changed'; end if;
end $$;
