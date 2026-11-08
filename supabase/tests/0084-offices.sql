-- Offices and the office log (supabase/migrations/0082_offices.sql; the staff roster design, section 2; its plan, Task 2).
-- Every staff persona is one kind of character. The Boss's office is computed from the season; every other office is the
-- latest row of an append-only log, a persona that never held an office is waiting and has not debuted, and an admin moves a
-- persona between member, benched and mod.

-- ---- A seed: five personas; the first Boss and the first staff debut, the rest wait ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 2, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'),
        'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'of-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'of-boss', 'name', 'Of Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'of-mod', 'name', 'Of Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'of-w1', 'name', 'Of W One', 'title', 'Waiting', 'signature', 'c'),
        jsonb_build_object('key', 'of-w2', 'name', 'Of W Two', 'title', 'Waiting', 'signature', 'd'),
        jsonb_build_object('key', 'of-w3', 'name', 'Of W Three', 'title', 'Waiting', 'signature', 'e')),
      'firstStaff', jsonb_build_array('of-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('of-admin'));
  perform tests.account('of-player');
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

create function pg_temp.office(k text) returns text language sql as $$ select office from staff_office_now where staff = k $$;
create function pg_temp.debuted(k text) returns boolean language sql security definer as $$ select debuted_at is not null from characters where staff = k $$;
create function pg_temp.logged_admin(k text) returns uuid language sql security definer as $$ select admin from staff_offices where staff = k order by id desc limit 1 $$;
create function pg_temp.rows(k text) returns text language sql security definer as $$
  select coalesce(string_agg(office || ':' || cause, ',' order by id), '') from staff_offices where staff = k $$;
-- (Read as the superuser's definer: a waiting persona's row is not readable by the admin's own role, which is the point.)
create function pg_temp.roster_with_names(roster text[]) returns jsonb language sql security definer as $$
  select jsonb_agg(jsonb_build_object('staff', r.staff, 'name', c.name, 'office', o.office) order by r.ord)
  from unnest(roster) with ordinality r(staff, ord) join characters c on c.staff = r.staff join staff_office_now o on o.staff = r.staff $$;
create function pg_temp.boss() returns text language sql as $$ select boss from seasons where ends_at is null $$;
create function pg_temp.roll() returns jsonb language sql as $$
  select reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day')
$$;
create function pg_temp.meeting() returns bigint language sql as $$
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id
$$;
create function pg_temp.queue_nomination(from_staff text, to_staff text) returns bigint language sql as $$
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (pg_temp.meeting(), from_staff, 'nameSuccessor', jsonb_build_object('boss', to_staff), null, 'because', now() + interval '1 hour', null, true) returning id
$$;
create function pg_temp.admin_sets(k text, o text) returns void language plpgsql as $$
begin
  perform tests.become((select id from auth.users where email = 'of-admin@test.invalid'));
  perform set_office(k, o);
  perform tests.unbecome();
end $$;
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- ---- A seed leaves every persona but the first Boss and the first staff waiting, undebuted and unseen ----
do $$
declare
  seen text;
begin
  if (select count(*) from characters where staff_kind = 'persona') is distinct from 5 then raise exception 'the seed made % personas, not 5', (select count(*) from characters where staff_kind = 'persona'); end if;
  if exists (select 1 from characters where staff in ('of-w1', 'of-w2', 'of-w3') and debuted_at is not null) then raise exception 'a waiting persona debuted at the seed'; end if;
  if exists (select 1 from characters where staff in ('of-boss', 'of-mod') and debuted_at is null) then raise exception 'the first Boss or the first staff did not debut'; end if;
  if exists (select 1 from characters_public where staff in ('of-w1', 'of-w2', 'of-w3')) then raise exception 'a waiting persona is in characters_public'; end if;
  if (select count(*) from characters_public where staff in ('of-boss', 'of-mod')) is distinct from 2 then raise exception 'the debuted personas are not in characters_public'; end if;
  if pg_temp.office('of-boss') is distinct from 'boss' or pg_temp.office('of-mod') is distinct from 'mod'
     or pg_temp.office('of-w1') is distinct from 'waiting' then
    raise exception 'offices after the seed: %', (select string_agg(staff || '=' || office, ',' order by staff) from staff_office_now);
  end if;
  seen := (select office from characters_public where staff = 'of-boss');
  if seen is distinct from 'boss' or (select office from characters_public where staff = 'of-mod') is distinct from 'mod' then raise exception 'characters_public does not show the office: %', seen; end if;
  -- The seed writes the log once, for the first staff.
  if pg_temp.rows('of-mod') is distinct from 'mod:seed' or exists (select 1 from staff_offices where staff <> 'of-mod') then raise exception 'the seed wrote % rows', (select count(*) from staff_offices); end if;
  -- The staff group is the ladder's staff rung (0128): the seed writes no staffGroup setting, and screen_settings carries none an older seed left, so an instance seeded before it still boots.
  if exists (select 1 from settings where key = 'staffGroup') then raise exception 'the seed wrote a staffGroup setting: %', (select value from settings where key = 'staffGroup'); end if;
  insert into settings (key, value) values ('staffGroup', '{"name": "Old Cores"}'::jsonb);
  if (select settings from screen_settings) ? 'staffGroup' then raise exception 'screen_settings still carries staffGroup'; end if;
  if not ((select settings from screen_settings) ? 'groups') then raise exception 'screen_settings lost groups'; end if;
  delete from settings where key = 'staffGroup';
  if exists (select 1 from jsonb_array_elements((select settings from screen_settings) -> 'groups') g where not g ? 'staff') then raise exception 'a group in screen_settings does not say whether it is the staff rung'; end if;
  -- staff_now lists exactly the mods; the Boss's office is never a row.
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'of-mod' then raise exception 'staff_now should hold of-mod alone: %', (select string_agg(staff, ',') from staff_now); end if;
  -- A reseed hires no one again and debuts no one.
  perform seed_instance((select jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'system', jsonb_build_object(
      'firstBoss', 'of-boss', 'firstStaff', jsonb_build_array('of-mod'), 'staff', jsonb_build_array(
        jsonb_build_object('key', 'of-boss', 'name', 'Of Boss'), jsonb_build_object('key', 'of-mod', 'name', 'Of Mod'), jsonb_build_object('key', 'of-w1', 'name', 'Of W One'))))));
  if (select count(*) from staff_offices) is distinct from 1 then raise exception 'a reseed wrote office rows'; end if;
  if exists (select 1 from characters where staff = 'of-w1' and debuted_at is not null) then raise exception 'a reseed debuted a waiting persona'; end if;
end $$;

-- ---- The office log refuses an update, a delete and a truncate; no client reaches it; the poisons are refused ----
do $$
declare
  dev uuid;
  said text;
  seen text;
begin
  said := pg_temp.refused('update staff_offices set office = ''member''');
  if said is null then raise exception 'an office row was updated'; end if;
  said := pg_temp.refused('delete from staff_offices');
  if said is null then raise exception 'an office row was deleted'; end if;
  said := pg_temp.refused('truncate staff_offices');
  if said is null then raise exception 'the office log was truncated'; end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.staff_offices'::regclass and t.tgname in ('staff_offices_no_update', 'staff_offices_no_truncate') and t.tgenabled = 'A') is distinct from 2 then
    raise exception 'the office log''s append-only triggers must fire always';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.staff_offices'::regclass) then raise exception 'staff_offices has no row-level security'; end if;
  foreach seen in array array['anon', 'authenticated'] loop
    if has_table_privilege(seen, 'public.staff_offices', 'select,insert,update,delete') then raise exception '% reaches staff_offices', seen; end if;
    if not has_table_privilege(seen, 'public.staff_office_now', 'select') then raise exception '% cannot read staff_office_now', seen; end if;
  end loop;
  -- Poison: an office row for a key no character has, for the developer, and one naming boss.
  said := pg_temp.refused('insert into staff_offices (staff, office, cause) values (''nobody-at-all'', ''member'', ''admin'')');
  if said is null then raise exception 'an office row named a staff member who is not one'; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gabe', 'gabe', 'developer', now()) returning id into dev;
  said := pg_temp.refused('insert into staff_offices (staff, office, cause) values (''gabe'', ''mod'', ''admin'')');
  if said is null or said !~ 'developer' then raise exception 'the developer was given an office: %', said; end if;
  said := pg_temp.refused('insert into staff_offices (staff, office, cause) values (''of-w1'', ''boss'', ''admin'')');
  if said is null or said !~ '^23514' then raise exception 'an office row named boss: %', said; end if;
  said := pg_temp.refused('insert into staff_offices (staff, office, cause) values (''of-w1'', ''member'', ''because'')');
  if said is null or said !~ '^23514' then raise exception 'an office row had an unknown cause: %', said; end if;
  -- The developer's characters_public office is its own, and the view has no row for it.
  if (select office from characters_public where staff = 'gabe') is distinct from 'developer' then raise exception 'the developer''s office is not shown as developer'; end if;
  if exists (select 1 from staff_office_now where staff = 'gabe') then raise exception 'staff_office_now holds the developer'; end if;
  if to_regclass('public.staff_changes') is not null then raise exception 'staff_changes outlived the copy'; end if;
  -- A player's character shows no office.
  if exists (select 1 from characters_public p join characters c on c.id = p.id where c.staff is null and p.office is not null) then raise exception 'a player''s character shows an office'; end if;
end $$;

-- ---- set_office: admins only; waiting to member debuts; member to benched; the Boss and the last mod are refused ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'of-admin@test.invalid');
  player uuid := (select id from auth.users where email = 'of-player@test.invalid');
  denied boolean := false;
  said text;
begin
  perform tests.become(player);
  begin perform set_office('of-w1', 'member'); exception when insufficient_privilege then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'a player moved a persona between offices'; end if;
  perform tests.become_anon();
  denied := false;
  begin perform set_office('of-w1', 'member'); exception when insufficient_privilege then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'a visitor moved a persona between offices'; end if;
  if pg_temp.office('of-w1') is distinct from 'waiting' then raise exception 'a refused call moved a persona'; end if;

  perform tests.become(admin);
  -- Waiting to member debuts it, quietly.
  perform set_office('of-w1', 'member');
  if pg_temp.office('of-w1') is distinct from 'member' or not pg_temp.debuted('of-w1') then raise exception 'waiting to member did not debut: %', pg_temp.office('of-w1'); end if;
  if pg_temp.rows('of-w1') is distinct from 'member:admin' or pg_temp.logged_admin('of-w1') is distinct from admin then raise exception 'the admin''s word was not logged with the admin: %', pg_temp.rows('of-w1'); end if;
  if not exists (select 1 from characters_public where staff = 'of-w1' and office = 'member') then raise exception 'a debuted persona is not in characters_public'; end if;
  -- Member to benched, and a benched persona is off staff, silent and still a character.
  perform set_office('of-w1', 'benched');
  if pg_temp.office('of-w1') is distinct from 'benched' then raise exception 'the bench did not take: %', pg_temp.office('of-w1'); end if;
  -- A reseed leaves a benched persona benched.
  perform tests.unbecome();
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'system', jsonb_build_object(
      'firstBoss', 'of-boss', 'firstStaff', jsonb_build_array('of-mod', 'of-w1'), 'staff', jsonb_build_array(
        jsonb_build_object('key', 'of-boss', 'name', 'Of Boss'), jsonb_build_object('key', 'of-mod', 'name', 'Of Mod'), jsonb_build_object('key', 'of-w1', 'name', 'Of W One')))));
  perform tests.become(admin);
  if pg_temp.office('of-w1') is distinct from 'benched' then raise exception 'a reseed rehired a benched persona: %', pg_temp.office('of-w1'); end if;
  -- Refusals, each naming its predicate.
  said := pg_temp.refused('select set_office(''of-boss'', ''benched'')');
  if said is null or said !~ 'Boss' then raise exception 'the season''s Boss was benched: %', said; end if;
  said := pg_temp.refused('select set_office(''of-boss'', ''mod'')');
  if said is null or said !~ 'Boss' then raise exception 'the season''s Boss was hired as a mod: %', said; end if;
  said := pg_temp.refused('select set_office(''of-mod'', ''benched'')');
  if said is null or said !~ 'last' then raise exception 'the last mod was benched: %', said; end if;
  said := pg_temp.refused('select set_office(''of-mod'', ''member'')');
  -- (a fire is a demotion to member, by the same rule: the last mod stays)
  if said is null or said !~ 'last' then raise exception 'the last mod was fired by an admin: %', said; end if;
  said := pg_temp.refused('select set_office(''of-w2'', ''benched'')');
  if said is null or said !~ 'waiting' then raise exception 'a waiting persona was benched: %', said; end if;
  said := pg_temp.refused('select set_office(''of-w2'', ''boss'')');
  if said is null or said !~ 'office' then raise exception 'an office of boss was set: %', said; end if;
  said := pg_temp.refused('select set_office(''gabe'', ''member'')');
  if said is null then raise exception 'the developer was moved'; end if;
  said := pg_temp.refused('select set_office(''nobody'', ''member'')');
  if said is null then raise exception 'a stranger was moved'; end if;
  said := pg_temp.refused('select set_office(''of-w1'', ''benched'')');
  if said is null then raise exception 'a persona was moved to the office it holds'; end if;
  if pg_temp.office('of-boss') is distinct from 'boss' or pg_temp.office('of-mod') is distinct from 'mod' then raise exception 'a refusal moved a persona'; end if;
  -- Benched to member, member to mod (an admin's hire), then the first mod may go to the bench.
  perform set_office('of-w1', 'member');
  perform set_office('of-w1', 'mod');
  perform set_office('of-mod', 'benched');
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'of-w1' then raise exception 'staff_now after the hire and the bench: %', (select string_agg(staff, ',') from staff_now); end if;
  perform set_office('of-mod', 'member');
  perform set_office('of-mod', 'mod');
  -- A waiting persona hired straight away is debuted by it.
  perform set_office('of-w3', 'mod');
  if not pg_temp.debuted('of-w3') or pg_temp.office('of-w3') is distinct from 'mod' then raise exception 'a hire from waiting did not debut'; end if;
  perform set_office('of-w3', 'member');
  perform tests.unbecome();
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'of-mod,of-w1' then raise exception 'staff_now should list exactly the mods: %', (select string_agg(staff, ',') from staff_now); end if;
end $$;

-- ---- write_staff_act refuses a waiting persona and a benched one ----
do $$
declare
  t uuid := tests.thread();
  said text;
begin
  said := pg_temp.refused(format('select write_staff_act(''of-w2'', ''post'', %L, null, ''{"body": "hi"}'')', t));
  if said is null or said !~ 'waiting' then raise exception 'a waiting persona posted: %', said; end if;
  perform pg_temp.admin_sets('of-w3', 'benched');
  said := pg_temp.refused(format('select write_staff_act(''of-w3'', ''post'', %L, null, ''{"body": "hi"}'')', t));
  if said is null or said !~ 'benched' then raise exception 'a benched persona posted: %', said; end if;
  said := pg_temp.refused(format('select write_staff_act(''of-w1'', ''post'', %L, null, ''{"body": "hi"}'')', t));
  if said is not null then raise exception 'a mod could not post: %', said; end if;
  said := pg_temp.refused(format('select write_staff_act(''of-boss'', ''post'', %L, null, ''{"body": "hi"}'')', t));
  if said is not null then raise exception 'the Boss could not post: %', said; end if;
  perform pg_temp.admin_sets('of-w3', 'member');
  said := pg_temp.refused(format('select write_staff_act(''of-w3'', ''post'', %L, null, ''{"body": "hi"}'')', t));
  if said is not null then raise exception 'a member could not post: %', said; end if;
end $$;

-- ---- The nomination and the successor are any unretired persona that is not benched, waiting ones included ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'of-admin@test.invalid');
  roster text[];
  said text;
begin
  perform pg_temp.admin_sets('of-w3', 'benched');
  roster := boss_roster();
  if roster is distinct from array['of-boss', 'of-mod', 'of-w1', 'of-w2'] then raise exception 'the roster should hold all but the benched: %', roster; end if;
  if 'of-w3' = any (roster) then raise exception 'a benched persona is on the roster'; end if;
  -- The meeting is offered the database's own list: the roster without the Boss.
  if meeting_context() -> 'successors' is distinct from '["of-mod", "of-w1", "of-w2"]'::jsonb then raise exception 'the meeting''s successors: %', meeting_context() -> 'successors'; end if;
  -- The admin's Boss list is the same roster with names (a waiting persona's name included, which no client can read from
  -- characters_public), in the roster's order, and nobody else reads it.
  perform tests.become(admin);
  if boss_roster_names() is distinct from pg_temp.roster_with_names(roster) then raise exception 'the admin''s Boss list is not the roster: %', boss_roster_names(); end if;
  if not boss_roster_names() @> '[{"staff": "of-w2", "name": "Of W Two", "office": "waiting"}]'::jsonb then raise exception 'the waiting persona is not named: %', boss_roster_names(); end if;
  perform tests.unbecome();
  perform tests.become((select id from auth.users where email = 'of-player@test.invalid'));
  said := pg_temp.refused('select boss_roster_names()');
  perform tests.unbecome();
  if said is null or said !~ '^42501' then raise exception 'a player read the Boss list: %', said; end if;
  perform tests.become_anon();
  said := pg_temp.refused('select boss_roster_names()');
  perform tests.unbecome();
  if said is null or said !~ '^42501' then raise exception 'a visitor read the Boss list: %', said; end if;
  -- The waiting persona is a nomination's target; the developer is not, and no Boss names itself. (A benched nominee is turned away at the
  -- handover, which nominated_boss answers with the rotation, as it does a retired one.)
  perform pg_temp.queue_nomination('of-boss', 'of-w2');
  said := pg_temp.refused('select pg_temp.queue_nomination(''of-boss'', ''gabe'')');
  if said is null then raise exception 'the developer was nominated'; end if;
  said := pg_temp.refused('select pg_temp.queue_nomination(''of-boss'', ''of-boss'')');
  if said is null then raise exception 'a Boss named itself'; end if;
end $$;

-- ---- A handover to a waiting persona debuts it; the outgoing Boss is a member; the last mod is never lost ----
do $$
declare
  hand season_handovers%rowtype;
  n bigint;
begin
  -- State: of-boss is the Boss; of-mod and of-w1 are mods; of-w2 waits; of-w3 is benched. The rotation's order puts the waiting persona next.
  perform pg_temp.admin_sets('of-w3', 'member');
  update settings set value = '["of-boss", "of-w2", "of-mod", "of-w1", "of-w3"]'::jsonb where key = 'bossRoster';
  if (select count(*) from staff_now) is distinct from 2 then raise exception 'the handover starts with two mods'; end if;
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'of-w2' then raise exception 'the rotation did not seat the waiting persona: %', pg_temp.boss(); end if;
  select * into hand from season_handovers where season = (select id from seasons where ends_at is null);
  if hand.how is distinct from 'rotation' then raise exception 'the handover recorded %', to_jsonb(hand); end if;
  if not pg_temp.debuted('of-w2') then raise exception 'the waiting successor did not debut'; end if;
  if not exists (select 1 from characters_public where staff = 'of-w2' and office = 'boss') then raise exception 'the new Boss is not shown as the Boss'; end if;
  if pg_temp.office('of-boss') is distinct from 'member' then raise exception 'the outgoing Boss should read member: %', pg_temp.office('of-boss'); end if;
  if pg_temp.rows('of-boss') is distinct from 'member:handover' or (select season from staff_offices where staff = 'of-boss') is distinct from (select id from seasons where ends_at is null) then
    raise exception 'the outgoing Boss''s row: %', pg_temp.rows('of-boss');
  end if;
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'of-mod,of-w1' then raise exception 'the mods changed by a handover that left two: %', (select string_agg(staff, ',') from staff_now); end if;
  -- A handover that leaves no mod makes the outgoing Boss a mod: first the mods are made one, which then becomes the Boss.
  perform pg_temp.admin_sets('of-w1', 'member');
  update settings set value = '["of-w2", "of-mod", "of-w1", "of-boss", "of-w3"]'::jsonb where key = 'bossRoster';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'of-mod' then raise exception 'the rotation did not seat the last mod: %', pg_temp.boss(); end if;
  if pg_temp.office('of-w2') is distinct from 'mod' or pg_temp.rows('of-w2') is distinct from 'mod:handover' then raise exception 'the outgoing Boss should be the mod when the staff would be empty: % %', pg_temp.office('of-w2'), pg_temp.rows('of-w2'); end if;
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'of-w2' then raise exception 'staff_now after the fallback: %', (select string_agg(staff, ',') from staff_now); end if;
  select count(*) into n from staff_offices where staff = 'of-mod' and cause = 'handover';
  if n <> 0 then raise exception 'the incoming Boss was given a log row: the Boss''s office is computed'; end if;
end $$;

-- ---- A reseed that adds a waiting persona to firstStaff hires it as a mod and debuts it ----
do $$
declare
  late jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'system', jsonb_build_object(
      'firstBoss', 'of-boss', 'firstStaff', jsonb_build_array('of-mod'), 'staff', jsonb_build_array(
        jsonb_build_object('key', 'of-boss', 'name', 'Of Boss'), jsonb_build_object('key', 'of-mod', 'name', 'Of Mod'), jsonb_build_object('key', 'of-w4', 'name', 'Of W Four'))));
begin
  perform seed_instance(late);
  if pg_temp.office('of-w4') is distinct from 'waiting' or pg_temp.debuted('of-w4') then raise exception 'a persona outside firstStaff did not wait'; end if;
  perform seed_instance(jsonb_set(late, '{system,firstStaff}', '["of-mod", "of-w4"]'));
  if pg_temp.rows('of-w4') is distinct from 'mod:seed' then raise exception 'the reseed did not hire the waiting persona: %', pg_temp.rows('of-w4'); end if;
  if not pg_temp.debuted('of-w4') or pg_temp.office('of-w4') is distinct from 'mod' then raise exception 'a persona the seed seats as a mod is %, debuted %', pg_temp.office('of-w4'), pg_temp.debuted('of-w4'); end if;
  if not exists (select 1 from characters_public where staff = 'of-w4' and office = 'mod') then raise exception 'the seeded mod is not in characters_public'; end if;
end $$;

-- ---- A handover never counts the outgoing Boss as the mod that keeps the staff from being empty ----
do $$
begin
  -- State: of-mod (a mod before it was seated) is the Boss; of-w2 and of-w4 are mods. The staff is of-w2 alone, then of-w2 succeeds it.
  perform pg_temp.admin_sets('of-w4', 'member');
  if pg_temp.boss() is distinct from 'of-mod' or (select string_agg(staff, ',') from staff_now) is distinct from 'of-w2' then
    raise exception 'the state before the handover: % %', pg_temp.boss(), (select string_agg(staff, ',') from staff_now);
  end if;
  update settings set value = '0'::jsonb where key = 'rosterRecentExcluded';
  update settings set value = '["of-mod", "of-w2", "of-boss", "of-w1", "of-w3", "of-w4"]'::jsonb where key = 'bossRoster';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'of-w2' then raise exception 'the only other mod did not succeed: %', pg_temp.boss(); end if;
  if pg_temp.office('of-mod') is distinct from 'mod' then raise exception 'the outgoing Boss counted itself and became %, leaving the staff empty', pg_temp.office('of-mod'); end if;
  if not exists (select 1 from staff_now) then raise exception 'staff_now is empty after the handover'; end if;
end $$;

-- ---- A nomination and a replacement refuse a persona the roster leaves out, benched or retired ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'of-admin@test.invalid');
  q bigint;
  said text;
begin
  perform pg_temp.admin_sets('of-w3', 'benched');
  said := pg_temp.refused('select pg_temp.queue_nomination(pg_temp.boss(), ''of-w3'')');
  if said is null or said !~ 'roster' then raise exception 'a benched persona was nominated: %', said; end if;
  q := pg_temp.queue_nomination(pg_temp.boss(), 'of-w1');
  perform tests.become(admin);
  said := pg_temp.refused(format('select replace_successor(%s, ''of-w3'')', q));
  perform tests.unbecome();
  if said is null or said !~ 'roster' then raise exception 'a benched persona replaced a successor: %', said; end if;
  update characters set retired_at = now() where staff = 'of-w4';
  said := pg_temp.refused('select pg_temp.queue_nomination(pg_temp.boss(), ''of-w4'')');
  if said is null or said !~ 'roster' then raise exception 'a retired persona was nominated: %', said; end if;
  perform tests.become(admin);
  said := pg_temp.refused(format('select replace_successor(%s, ''of-w4'')', q));
  perform tests.unbecome();
  if said is null or said !~ 'roster' then raise exception 'a retired persona replaced a successor: %', said; end if;
  if (select params ->> 'boss' from queued_moves where id = q) is distinct from 'of-w1' then raise exception 'a refused replacement changed the nomination'; end if;
  update characters set retired_at = null where staff = 'of-w4';
  perform pg_temp.admin_sets('of-w3', 'member');
end $$;

-- ---- The last-mod check does not count a retired persona ----
do $$
declare
  said text;
begin
  -- of-mod is the one live mod; of-w4 is a mod too, but retired.
  perform pg_temp.admin_sets('of-w4', 'mod');
  update characters set retired_at = now() where staff = 'of-w4';
  said := pg_temp.refused('select pg_temp.admin_sets(''of-mod'', ''benched'')');
  if said is null or said !~ 'last' then raise exception 'the last live mod was benched beside a retired one: %', said; end if;
  update characters set retired_at = null where staff = 'of-w4';
  perform pg_temp.admin_sets('of-w4', 'member');
end $$;

-- ---- A handover does not count a retired mod as the mod that keeps the staff from being empty ----
do $$
begin
  -- State: of-w2 is the Boss and of-mod the only mod, now retired. Rotation hands over to of-w1.
  if pg_temp.boss() is distinct from 'of-w2' then raise exception 'the state before the handover: %', pg_temp.boss(); end if;
  update characters set retired_at = now() where staff = 'of-mod';
  update settings set value = '["of-w2", "of-w1", "of-boss", "of-w3", "of-w4", "of-mod"]'::jsonb where key = 'bossRoster';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'of-w1' then raise exception 'the handover went to %', pg_temp.boss(); end if;
  if pg_temp.office('of-w2') is distinct from 'mod' then raise exception 'the outgoing Boss counted a retired mod and became %, leaving no live mod', pg_temp.office('of-w2'); end if;
  if not exists (select 1 from staff_now where staff = 'of-w2') then raise exception 'staff_now does not list the outgoing Boss'; end if;
  update characters set retired_at = null where staff = 'of-mod';
end $$;

-- ---- Nominating a waiting persona is accepted by the guard and by a replacement ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'of-admin@test.invalid');
  q bigint;
begin
  -- of-w5 waits (undebuted), and is on boss_roster().
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'system', jsonb_build_object(
      'firstBoss', 'of-boss', 'firstStaff', jsonb_build_array('of-mod'), 'staff', jsonb_build_array(
        jsonb_build_object('key', 'of-boss', 'name', 'Of Boss'), jsonb_build_object('key', 'of-mod', 'name', 'Of Mod'), jsonb_build_object('key', 'of-w1', 'name', 'Of W One'),
        jsonb_build_object('key', 'of-w5', 'name', 'Of W Five')))));
  if pg_temp.office('of-w5') is distinct from 'waiting' then raise exception 'of-w5 should wait: %', pg_temp.office('of-w5'); end if;
  if 'of-w5' <> all (boss_roster()) then raise exception 'a waiting persona is not on the roster: %', boss_roster(); end if;
  -- The guard accepts a waiting nominee outright (it raises otherwise), and an admin may replace another nominee with a waiting one.
  perform pg_temp.queue_nomination('of-w1', 'of-w5');
  q := pg_temp.queue_nomination('of-w1', 'of-mod');
  perform tests.become(admin);
  perform replace_successor(q, 'of-w5');
  perform tests.unbecome();
  if (select params ->> 'boss' from queued_moves where id = q) is distinct from 'of-w5' then raise exception 'the waiting persona did not replace the successor'; end if;
end $$;
