-- The reads behind the Mod Bots' screens (supabase/migrations/0111_mod_screens.sql; the Mod Bots design, section 9; its plan, Task 13).
--
-- 1. my_infractions, my_bans, my_reports and my_appeals return the caller's own characters' rows and nobody else's: a second player reads none of the first's, and a visitor reads none.
-- 2. Each says which Act did what, when it drops off and how it ended, and names no account.
-- 3. my_reports_left counts each of the caller's characters' reports since UTC midnight against reportsPerDay, a failed refund freeing a slot, and shows nobody else's; beat_mod_name
--    names the Mod on a board's beat; thread_page's visits carry the ruling of an appeal heard on their infraction.
-- 4. presence_box lists a Mod on an open visit in the thread, once, with its post's number, whether or not it posted; a visit that ended lists none.
-- 5. moves_log lists a Mod's visits, the reports it judged and the appeals it heard, each with how it ended; every row it had before is still there.
-- 6. The doors: the four views my_reports_left and beat_mod_name are a signed-in player's, and no client can write what they read.

create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;
create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('ms-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Ms ' || label);
end $$;
create function pg_temp.appeal(c uuid, punishment uuid, plea text default 'I did nothing wrong.') returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = c));
  made := open_appeal(c, punishment, plea);
  perform tests.unbecome();
  return made;
end $$;
create function pg_temp.report(c uuid, post_act uuid, reason text default 'rude') returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = c));
  made := open_report(c, post_act, reason);
  perform tests.unbecome();
  return made;
end $$;
create function pg_temp.rows(view_name text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %I', view_name) into n;
  return n;
end $$;
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 0. The world: a Boss, two Mods on staff, the settings, players ----
do $$
declare
  seed jsonb;
  general uuid := (select id from boards where slug = 'general');
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ms-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ms-boss', 'name', 'Screens Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ms-m1', 'name', 'Screens Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'ms-m2', 'name', 'Screens Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('ms-m1', 'ms-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  if beat_of(general) is distinct from 'ms-m1' then raise exception 'the world: the beat Mod of General is %', beat_of(general); end if;
  if current_boss() is distinct from 'ms-boss' then raise exception 'the world: the Boss is %', current_boss(); end if;
end $$;

-- ---- 1 and 2. The log's views: the caller's own characters' rows, said fully, and nobody else's ----
do $$
declare
  ann uuid := pg_temp.player('ann');
  bob uuid := pg_temp.player('bob');
  t uuid := tests.thread('Screens one');
  p1 uuid := pg_temp.say(ann, t, 'ann one');
  p2 uuid := pg_temp.say(ann, t, 'ann two');
  pb uuid := pg_temp.say(bob, t, 'bob one');
  hit jsonb;
  filled jsonb;
  ap jsonb;
  rp jsonb;
  v uuid;
  closed jsonb;
  who uuid;
  seen text;
  r record;
begin
  ap := pg_temp.report(ann, pb, 'no reason');
  -- The filing of a visit puts the infraction on the bar (infract, as file_visit does); ann's post p1 is two points.
  hit := infract(ann, 'moderate', p1, 'ms-m1', 2);
  filled := infract(ann, 'severe', p2, 'ms-m1', 3);
  if filled ->> 'ban' is null then raise exception 'the bar did not fill: %', filled; end if;
  -- A report by bob on ann's post, judged; a report by ann on bob's post, open.
  rp := pg_temp.report(bob, p1, 'it is rude');
  perform close_report((rp ->> 'report')::uuid, 'dismissed', 'Hmph.', null, 'ms-m1');
  -- An appeal by ann of the ban, ruled upheld by the Boss.
  closed := pg_temp.appeal(ann, (filled ->> 'ban')::uuid, 'It was a mistake.');
  perform close_appeal((closed ->> 'appeal')::uuid, 'upheld', 'No.', 'ms-boss');

  -- ann reads her own.
  perform tests.become((select owner from characters where id = ann));
  select * into r from my_infractions where infraction = (hit ->> 'infraction')::uuid;
  if r.character is distinct from ann or r.band is distinct from 'moderate' or r.points is distinct from 4 or r.rule_number is distinct from 2 or r.mod_name is distinct from 'Screens Mod One'
     or r.post is distinct from p1 or r.post_seq is null or r.thread is distinct from t or r.expires_at < now() + interval '13 days' or r.emptied_at is null or r.rule is null then
    raise exception 'my_infractions says the wrong thing: %', to_jsonb(r);
  end if;
  if (select count(*) from my_infractions where character = ann) is distinct from 2::bigint then raise exception 'ann reads % infractions', (select count(*) from my_infractions); end if;
  select * into r from my_bans where ban = (filled ->> 'ban')::uuid;
  if r.character is distinct from ann or r.days is distinct from 1 or r.until is null or r.until <= now() or r.infraction is distinct from (filled ->> 'infraction')::uuid or r.rule is null then raise exception 'my_bans says the wrong thing: %', to_jsonb(r); end if;
  select * into r from my_reports where report = (ap ->> 'report')::uuid;
  if r.character is distinct from ann or r.post is distinct from pb or r.verdict is not null or r.verdict_at is not null or r.refund is not null or r.post_seq is null then raise exception 'my_reports says the wrong thing for an open report: %', to_jsonb(r); end if;
  if exists (select 1 from my_reports where report = (rp ->> 'report')::uuid) then raise exception 'ann reads a report bob made'; end if;
  select * into r from my_appeals where appeal = (closed ->> 'appeal')::uuid;
  if r.character is distinct from ann or r.punishment is distinct from (filled ->> 'ban')::uuid or r.punishment_kind is distinct from 'ban' or r.verdict is distinct from 'upheld' or r.hearer_name is distinct from 'Screens Boss' or r.post_seq is distinct from (select seq from acts where id = p2) or r.ruled_at is null then
    raise exception 'my_appeals says the wrong thing: %', to_jsonb(r);
  end if;
  
  perform tests.unbecome();

  -- bob reads his own report and none of ann's rows.
  perform tests.become((select owner from characters where id = bob));
  select * into r from my_reports where report = (rp ->> 'report')::uuid;
  if r.character is distinct from bob or r.verdict is distinct from 'dismissed' or r.mod_name is distinct from 'Screens Mod One' or r.verdict_at is null then raise exception 'my_reports says the wrong thing for a judged report: %', to_jsonb(r); end if;
  if pg_temp.rows('my_infractions') <> 0 or pg_temp.rows('my_bans') <> 0 or pg_temp.rows('my_appeals') <> 0 then raise exception 'bob reads ann''s punishments'; end if;
  if (select count(*) from my_reports) is distinct from 1::bigint then raise exception 'bob reads a report that is not his: %', (select count(*) from my_reports); end if;
  perform tests.unbecome();

  -- A visitor reads nothing at all (no grant), and no account or owner is in any row.
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from my_infractions') is null or pg_temp.refusal('select count(*) from my_bans') is null or pg_temp.refusal('select count(*) from my_reports') is null or pg_temp.refusal('select count(*) from my_appeals') is null then
    raise exception 'a visitor read a log view';
  end if;
  perform tests.unbecome();
  who := (select owner from characters where id = ann);
  if exists (select 1 from information_schema.columns where table_name in ('my_infractions', 'my_bans', 'my_reports', 'my_appeals') and column_name in ('owner', 'account', 'class')) then raise exception 'a log view names an account or a class'; end if;
end $$;

-- ---- 3. my_reports_left: the quota of the caller's own characters, a failed refund freeing a slot ----
do $$
declare
  ann uuid := pg_temp.player('cat');
  bob uuid := pg_temp.player('dan');
  t uuid := tests.thread('Screens three');
  p uuid := pg_temp.say(bob, t, 'a post to report');
  p2 uuid := pg_temp.say(bob, t, 'another');
  rp jsonb;
  mine integer;
begin
  perform tests.become((select owner from characters where id = ann));
  if (select "left" from my_reports_left where character = ann) is distinct from 3 then raise exception 'a fresh character has % reports, not 3', (select "left" from my_reports_left where character = ann); end if;
  perform tests.unbecome();
  rp := pg_temp.report(ann, p);
  perform pg_temp.report(ann, p2);
  perform tests.become((select owner from characters where id = ann));
  if (select "left" from my_reports_left where character = ann) is distinct from 1 then raise exception 'two reports left % of 3', (select "left" from my_reports_left where character = ann); end if;
  perform tests.unbecome();
  -- The judgment of the first failed: its price goes back and its slot is free again.
  perform refund_report((rp ->> 'report')::uuid);
  perform tests.become((select owner from characters where id = ann));
  mine := (select "left" from my_reports_left where character = ann);
  perform tests.unbecome();
  if mine is distinct from 2 then raise exception 'a refunded report did not free its slot: %', mine; end if;
  -- Another player reads none of ann's rows, only their own.
  perform tests.become((select owner from characters where id = bob));
  if exists (select 1 from my_reports_left where character = ann) or (select count(*) from my_reports_left) is distinct from 1::bigint then raise exception 'bob reads a quota that is not his'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from my_reports_left') is null then raise exception 'a visitor read a quota'; end if;
  perform tests.unbecome();
  if exists (select 1 from pg_proc where proname = 'reports_left_today') then raise exception 'the old quota function is still there'; end if;
end $$;

-- ---- 3b. beat_mod_name: the public name of the Mod on a board's beat, and the board's ----
do $$
declare
  c uuid := pg_temp.player('ivy');
  gen uuid := (select id from boards where slug = 'general');
  got jsonb;
begin
  perform tests.become((select owner from characters where id = c));
  got := beat_mod_name(gen);
  perform tests.unbecome();
  if got ->> 'mod' is distinct from 'Screens Mod One' or got ->> 'board' is null then raise exception 'the beat Mod is wrong: %', got; end if;
  if beat_mod_name(gen_random_uuid()) is not null then raise exception 'a board that is none has a beat Mod'; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select beat_mod_name(%L)', gen)) is null then raise exception 'a visitor read a beat'; end if;
  perform tests.unbecome();
end $$;

-- ---- 3c. thread_page's visits carry the ruling of the appeal heard on the infraction a visit filed ----
do $$
declare
  c uuid := pg_temp.player('jon');
  t uuid := tests.thread('Screens three c');
  p uuid := pg_temp.say(c, t, 'a post to be filed');
  v uuid;
  inf uuid;
  ap jsonb;
  page jsonb;
begin
  v := (start_visit(p, 'ms-m1', jsonb_build_object('rule_number', 2, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 2: No double posting')) ->> 'visit')::uuid;
  perform file_visit(v, 'Filed.');
  inf := (select id from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text);
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if (select x ->> 'ruling' from jsonb_array_elements(page -> 'visits') x where x ->> 'visit' = v::text) is not null then raise exception 'a visit with no appeal carries a ruling'; end if;
  ap := pg_temp.appeal(c, inf, 'Please.');
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if (select x ->> 'ruling' from jsonb_array_elements(page -> 'visits') x where x ->> 'visit' = v::text) is not null then raise exception 'an appeal with no ruling carries one'; end if;
  perform close_appeal((ap ->> 'appeal')::uuid, 'overturned', 'Fine.', 'ms-m1');
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if (select x ->> 'ruling' from jsonb_array_elements(page -> 'visits') x where x ->> 'visit' = v::text) is distinct from 'overturned' then raise exception 'the ruling is not on the visit: %', page -> 'visits'; end if;
end $$;

-- ---- 4. presence_box lists a Mod on an open visit, once, with its post ----
do $$
declare
  c uuid := pg_temp.player('eve');
  t uuid := tests.thread('Screens four');
  p uuid := pg_temp.say(c, t, 'to be visited');
  v uuid;
  box jsonb;
  mod_id uuid := (select id from characters where staff = 'ms-m1');
  entry jsonb;
begin
  box := presence_box('thread', t);
  if exists (select 1 from jsonb_array_elements(box -> 'names') n where n ->> 'id' = mod_id::text) then raise exception 'a Mod with no visit and no post is listed'; end if;
  v := (start_visit(p, 'ms-m1', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
  box := presence_box('thread', t);
  select n into entry from jsonb_array_elements(box -> 'names') n where n ->> 'id' = mod_id::text;
  if entry is null or (entry ->> 'visit_post')::integer is distinct from (select seq from acts where id = p) or (entry ->> 'staff')::boolean is not true then raise exception 'a Mod on a visit is not listed with its post: %', box; end if;
  if (select count(*) from jsonb_array_elements(box -> 'names') n where n ->> 'id' = mod_id::text) is distinct from 1::bigint then raise exception 'the Mod is listed twice'; end if;
  -- The same Mod posts in the thread too: still one name.
  perform write_staff_act('ms-m1', 'post', t, null, '{"body": "A word."}'::jsonb);
  box := presence_box('thread', t);
  if (select count(*) from jsonb_array_elements(box -> 'names') n where n ->> 'id' = mod_id::text) is distinct from 1::bigint or (box -> 'others')::text::integer < 0 then raise exception 'a Mod that posted and visits is listed twice: %', box; end if;
  -- A player's name never carries a visit_post.
  if exists (select 1 from jsonb_array_elements(box -> 'names') n where n ? 'visit_post' and n ->> 'id' <> mod_id::text) then raise exception 'a name that is no Mod carries a visit'; end if;
  -- The other kinds of place do not list it for a visit.
  if exists (select 1 from jsonb_array_elements(presence_box('index', null) -> 'names') n where n ->> 'id' = mod_id::text) then raise exception 'the index lists a Mod'; end if;
  -- The visit ends: the tag goes.
  perform end_visit(v, 'reversed');
  box := presence_box('thread', t);
  if exists (select 1 from jsonb_array_elements(box -> 'names') n where n ? 'visit_post') then raise exception 'an ended visit is still listed: %', box; end if;
end $$;

-- ---- 5. moves_log lists a Mod's visits, reports and appeals with how each ended ----
do $$
declare
  c uuid := pg_temp.player('fay');
  d uuid := pg_temp.player('gus');
  t uuid := tests.thread('Screens five');
  p uuid := pg_temp.say(c, t, 'one');
  q uuid := pg_temp.say(c, t, 'two');
  v1 uuid; v2 uuid; rp jsonb; hit jsonb; ap jsonb;
  r record;
  n0 bigint := (select count(*) from moves_log where staff = 'ms-m1' and kind not in ('visit', 'report', 'appeal'));
begin
  v1 := (start_visit(p, 'ms-m1', jsonb_build_object('rule_number', 2, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 2: No double posting')) ->> 'visit')::uuid;
  v2 := (start_visit(q, 'ms-m1', jsonb_build_object('rule_number', 2, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', q, 'rule', 'Rule 2: No double posting')) ->> 'visit')::uuid;
  perform file_visit(v1, 'Filed.');
  select * into r from moves_log where id = v1;
  if r.staff is distinct from 'ms-m1' or r.kind is distinct from 'visit' or r.ended_why is distinct from 'filed' or r.ended_at is null or (r.params ->> 'post')::integer is distinct from (select seq from acts where id = p) or r.params ->> 'rule' is distinct from 'Rule 2: No double posting' then
    raise exception 'a filed visit is wrong in the log: %', to_jsonb(r);
  end if;
  select * into r from moves_log where id = v2;
  if r.kind is distinct from 'visit' or r.ended_why is not null or r.ended_at is not null then raise exception 'an open visit is wrong in the log: %', to_jsonb(r); end if;
  rp := pg_temp.report(d, q, 'bad');
  perform close_report((rp ->> 'report')::uuid, 'dismissed', 'Hmph.', null, 'ms-m1');
  select * into r from moves_log where kind = 'report' and thread = t;
  if r.staff is distinct from 'ms-m1' or r.ended_why is distinct from 'dismissed' or (r.params ->> 'post')::integer is distinct from (select seq from acts where id = q) then raise exception 'a judged report is wrong in the log: %', to_jsonb(r); end if;
  hit := (select jsonb_build_object('infraction', i.id) from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v1::text);
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid, 'Please.');
  perform close_appeal((ap ->> 'appeal')::uuid, 'overturned', 'Fine.', 'ms-m1');
  select * into r from moves_log where kind = 'appeal' and thread = t;
  if r.staff is distinct from 'ms-m1' or r.ended_why is distinct from 'overturned' or r.params ->> 'punishment' is distinct from 'infraction' or (r.params ->> 'post')::integer is distinct from (select seq from acts where id = p) then raise exception 'a heard appeal is wrong in the log: %', to_jsonb(r); end if;
  if (select count(*) from moves_log where staff = 'ms-m1' and kind not in ('visit', 'report', 'appeal')) is distinct from n0 then raise exception 'the log changed what it listed of moves'; end if;
  if (select count(*) from moves_log where kind = 'visit' and thread = t) is distinct from 2::bigint then raise exception 'visits listed: %', (select count(*) from moves_log where kind = 'visit' and thread = t); end if;
end $$;

-- ---- 6. The doors ----
do $$
declare
  ann uuid := pg_temp.player('hal');
begin
  if has_function_privilege('anon', 'beat_mod_name(uuid)', 'execute') or not has_function_privilege('authenticated', 'beat_mod_name(uuid)', 'execute') then raise exception 'beat_mod_name is not a signed-in player''s'; end if;
  if has_table_privilege('anon', 'my_reports_left', 'select') or not has_table_privilege('authenticated', 'my_reports_left', 'select') then raise exception 'my_reports_left is not a signed-in player''s'; end if;
  if has_table_privilege('anon', 'my_infractions', 'select') or has_table_privilege('anon', 'my_bans', 'select') or has_table_privilege('anon', 'my_reports', 'select') or has_table_privilege('anon', 'my_appeals', 'select') then raise exception 'a visitor can read a log view'; end if;
  if not has_table_privilege('authenticated', 'my_infractions', 'select') or not has_table_privilege('authenticated', 'my_appeals', 'select') then raise exception 'a player cannot read a log view'; end if;
  if has_table_privilege('authenticated', 'my_infractions', 'insert') or has_table_privilege('authenticated', 'my_reports', 'update') or has_table_privilege('authenticated', 'my_bans', 'delete') then raise exception 'a player can write a log view'; end if;
end $$;
