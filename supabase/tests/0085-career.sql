-- A persona's career (supabase/migrations/0083_career.sql; the staff roster design, section 3; its plan, Task 3): the seasons it led
-- and the offices it held off the Boss's seat, computed from `seasons.boss`, `season_handovers` and the office log, public to anyone, and
-- the digest role's to read. The poison is a career that reads a season another persona led: both are named below.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cr-ann',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'cr-ann', 'name', 'Cr Ann', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'cr-bob', 'name', 'Cr Bob', 'title', 'Boss', 'signature', 'b'),
        jsonb_build_object('key', 'cr-cat', 'name', 'Cr Cat', 'title', 'Mod', 'signature', 'c'),
        jsonb_build_object('key', 'cr-dot', 'name', 'Cr Dot', 'title', 'Waiting', 'signature', 'd')),
      'firstStaff', jsonb_build_array('cr-cat'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('cr-admin'));
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
  -- The seed wrote its office rows when the first season began, not later.
  alter table staff_offices disable trigger user;
  update staff_offices set at = (select starts_at from seasons where ends_at is null) where cause = 'seed';
  alter table staff_offices enable always trigger staff_offices_no_update;
  alter table staff_offices enable always trigger staff_offices_no_truncate;
  update settings set value = '["cr-ann", "cr-bob", "cr-cat", "cr-dot"]'::jsonb where key = 'bossRoster';
end $$;

create function pg_temp.career(k text) returns jsonb language sql as $$ select staff_career(k) $$;
create function pg_temp.roll() returns jsonb language sql as $$
  select reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day')
$$;
create function pg_temp.admin_sets(k text, o text) returns void language plpgsql as $$
begin
  perform tests.become((select id from auth.users where email = 'cr-admin@test.invalid'));
  perform set_office(k, o);
  perform tests.unbecome();
end $$;
create function pg_temp.led_seasons(k text) returns text language sql as $$
  select coalesce(string_agg(e ->> 'season', ',' order by (e ->> 'season')::int), '') from jsonb_array_elements(staff_career(k) -> 'led') e $$;

-- ---- At the seed: the first Boss has led the open season, with no end and no handover; a mod has an office row; others have nothing ----
do $$
declare
  c jsonb := pg_temp.career('cr-ann');
begin
  if jsonb_array_length(c -> 'led') is distinct from 1 or (c -> 'led' -> 0 ->> 'season')::int is distinct from 1 then raise exception 'the first Boss''s career at the seed: %', c; end if;
  if c -> 'led' -> 0 -> 'until' is distinct from 'null'::jsonb then raise exception 'the open season has an end: %', c; end if;
  if c -> 'led' -> 0 ->> 'how' is distinct from 'seed' then raise exception 'the first season was not the seed''s: %', c; end if;
  if (c -> 'led' -> 0 ->> 'since')::timestamptz is distinct from (select starts_at from seasons where number = 1) then raise exception 'the season began elsewhere: %', c; end if;
  if jsonb_array_length(c -> 'offices') <> 0 then raise exception 'a Boss''s seat is an office row: %', c; end if;
  c := pg_temp.career('cr-cat');
  if jsonb_array_length(c -> 'led') <> 0 or c -> 'offices' -> 0 ->> 'office' is distinct from 'mod' or c -> 'offices' -> 0 ->> 'cause' is distinct from 'seed'
     or c -> 'offices' -> 0 -> 'until' is distinct from 'null'::jsonb then raise exception 'the first mod''s career: %', c; end if;
  if pg_temp.career('cr-dot') is distinct from '{"led": [], "offices": []}'::jsonb then raise exception 'a persona that never served has a career: %', pg_temp.career('cr-dot'); end if;
  if pg_temp.career('nobody-at-all') is distinct from '{"led": [], "offices": []}'::jsonb then raise exception 'a stranger has a career'; end if;
end $$;

-- ---- A handover, then the bench: the outgoing Boss is a member, then benched; the new Boss has led a season by rotation ----
do $$
declare
  a jsonb;
  b jsonb;
  s1 seasons%rowtype;
begin
  perform pg_temp.roll();
  select * into s1 from seasons where number = 1;
  perform pg_temp.admin_sets('cr-ann', 'benched');
  a := pg_temp.career('cr-ann');
  b := pg_temp.career('cr-bob');
  if jsonb_array_length(a -> 'led') is distinct from 1 or (a -> 'led' -> 0 ->> 'until')::timestamptz is distinct from s1.ends_at then raise exception 'Season 1''s end: %', a; end if;
  if (select string_agg(o ->> 'office' || ':' || (o ->> 'cause'), ',' order by ord) from jsonb_array_elements(a -> 'offices') with ordinality x(o, ord)) is distinct from 'member:handover,benched:admin' then
    raise exception 'the outgoing Boss''s offices: %', a;
  end if;
  if (a -> 'offices' -> 0 ->> 'until') is distinct from (a -> 'offices' -> 1 ->> 'since') or a -> 'offices' -> 1 -> 'until' is distinct from 'null'::jsonb then
    raise exception 'an office ends where the next begins and the latest is open: %', a;
  end if;
  if jsonb_array_length(b -> 'led') is distinct from 1 or b -> 'led' -> 0 ->> 'season' is distinct from '2' or b -> 'led' -> 0 ->> 'how' is distinct from 'rotation' then raise exception 'the new Boss''s career: %', b; end if;
  if jsonb_array_length(b -> 'offices') <> 0 then raise exception 'the new Boss has office rows: %', b; end if;
  -- The poison: a season is in one career only, the one that led it.
  if pg_temp.led_seasons('cr-ann') is distinct from '1' or pg_temp.led_seasons('cr-bob') is distinct from '2' then
    raise exception 'a career read a season another persona led: ann % bob %', pg_temp.led_seasons('cr-ann'), pg_temp.led_seasons('cr-bob');
  end if;
  if position('"season": 2' in a::text) > 0 or position('"season": 1' in b::text) > 0 then raise exception 'a career holds another persona''s season'; end if;
end $$;

-- ---- A mod between two seasons led: Cat led Season 3 after being a mod; Bob was a mod in between (Season 2 was his, then he stepped down) ----
do $$
declare
  c jsonb;
begin
  perform pg_temp.roll();
  if pg_temp.led_seasons('cr-cat') is distinct from '3' then raise exception 'rotation did not seat the mod: % (boss %)', pg_temp.led_seasons('cr-cat'), (select boss from seasons where ends_at is null); end if;
  c := pg_temp.career('cr-cat');
  if (select string_agg(o ->> 'office' || ':' || (o ->> 'cause'), ',' order by ord) from jsonb_array_elements(c -> 'offices') with ordinality x(o, ord)) is distinct from 'mod:seed' then raise exception 'the mod''s office rows: %', c; end if;
  -- The Boss's seat is not an office, and a persona is not two things at once: the mod row ends where the season it leads begins.
  if (c -> 'offices' -> 0 ->> 'until')::timestamptz is distinct from (select starts_at from seasons where number = 3) then
    raise exception 'the mod row did not end where the persona became Boss: % (season 3 began %)', c, (select starts_at from seasons where number = 3);
  end if;
  c := pg_temp.career('cr-bob');
  if pg_temp.led_seasons('cr-bob') is distinct from '2' or (select string_agg(o ->> 'office' || ':' || (o ->> 'cause'), ',') from jsonb_array_elements(c -> 'offices') o) is distinct from 'mod:handover' then raise exception 'the outgoing Boss''s career: %', c; end if;
end $$;

-- ---- Who may read it: anyone, and the digest role; it is a function of the persona and holds no admin's name ----
do $$
declare
  t text;
begin
  foreach t in array array['anon', 'authenticated', 'kayfabb_digest'] loop
    if not has_function_privilege(t, 'staff_career(text)', 'execute') then raise exception '% cannot read a career', t; end if;
  end loop;
  if has_function_privilege('public', 'staff_career(text)', 'execute') and not has_function_privilege('anon', 'staff_career(text)', 'execute') then raise exception 'grants are off'; end if;
  perform tests.become_anon();
  if jsonb_array_length(staff_career('cr-ann') -> 'led') is distinct from 1 then raise exception 'a visitor reads a different career'; end if;
  perform tests.unbecome();
  if (select proconfig from pg_proc where oid = 'staff_career(text)'::regprocedure) is distinct from array['search_path=public, pg_temp', 'plan_cache_mode=force_generic_plan', 'jit=off'] then raise exception 'search_path is not pinned and the plan fixed: %', (select proconfig from pg_proc where oid = 'staff_career(text)'::regprocedure); end if;
  if staff_career('cr-ann')::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-' or position((select id from auth.users where email = 'cr-admin@test.invalid')::text in staff_career('cr-ann')::text) > 0 then
    raise exception 'a career holds an id (the cause ''admin'' is a word, not the admin): %', staff_career('cr-ann');
  end if;
end $$;

-- ---- Every instant is UTC whatever the session's time zone ----
do $$
declare
  c jsonb;
begin
  set local timezone = 'Pacific/Auckland';
  c := staff_career('cr-ann');
  if c -> 'led' -> 0 ->> 'since' !~ 'Z$' then raise exception 'an instant is not UTC under a non-UTC session: %', c; end if;
  if (c -> 'led' -> 0 ->> 'since')::timestamptz is distinct from (select starts_at from seasons where number = 1) then raise exception 'the instant shifted under a non-UTC session: %', c; end if;
  if c -> 'led' -> 0 ->> 'since' is distinct from to_char((select starts_at from seasons where number = 1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') then raise exception 'the instant is not in UTC: %', c; end if;
end $$;
