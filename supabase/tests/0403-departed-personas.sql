-- A persona that leaves the roster leaves the staff (supabase/migrations/0403_departed_personas.sql; docs/plans/2026-11-21-departed-personas-plan.md, Task 2; its design, sections 2 and 3).
--
-- The seed's roster is the whole staff: a persona it does not list is benched (cause seed), and a departing Boss is handed over at once, in the open season, before it is benched. Each scenario below starts from the same
-- world (a Boss `a`, a member `b`, a Mod `c`, a persona `w` that never debuted, and a retired `r`, so nothing is ever seated from it) and puts it back by raising a sentinel inside its own block, which Postgres rolls back.
--
-- 1. A reseed without `b`: `b` is benched (cause seed), keeps its character and its posts, cannot be written as, and is off boss_roster(). A second identical reseed writes no office row.
-- 2. A reseed without `w`, which never debuted: it gets the bench row, is still not debuted, and is off boss_roster().
-- 3. A reseed without `a`, the Boss (and `w`, benched first): the season goes on (same id, same end), a departure handover seats `b` or `c` (never a departing persona), `a`'s farewell is posted before its bench, `a` is benched, and the
--    seed's answer names the new Boss.
-- 4. A reseed without `a` and with no other Boss that can be seated: refused with the reason, and nothing was written (no office row, no handover, no announcement), `a` still the Boss.
-- 5. A reseed that drops `c`, the only Mod: with firstStaff naming `b`, `b` is hired and `c` benched; with firstStaff naming only `c`, refused with the no-Mod reason, and nothing was written.
-- 5c. A staff with no Mod before the seed is left as it was: benching a member refuses nothing.
-- 6. set_office('b', 'mod') after (1) is refused with the roster reason, and a persona an admin benched comes back by set_office as it always did.
-- 7. A reseed that lists `b` again: `b` is a member (a Mod where firstStaff names it), and a third identical reseed writes no office row.
-- 8. Two identical reseeds after a departure: the second writes no office row and no handover.
-- 7b. A persona the seed lists again is back before a leaving Boss's handover, so it can take the chair.
-- 9. A seed that lists no persona at all leaves the staff as it was (a partial seed is not a roster).
-- 10. A retired persona that leaves the roster gets no bench row and is not in `departed`.
-- 11. A staff entry with no key is refused by the persona upsert (a character needs a name) before the departure block, so no null reaches `listed`; the null filter there is a second line.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- A seed whose roster is `keys` (in order), `first` as firstStaff, `boss` as firstBoss.
create function pg_temp.seed(keys text[], first text[], boss text default 'a') returns jsonb language plpgsql as $$
begin
  return seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 200,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 14),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'), 'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Dp Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', boss,
      'staff', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'name', 'P ' || k, 'title', 'Persona', 'signature', 'sig ' || k) order by o), '[]'::jsonb) from unnest(keys) with ordinality u(k, o)),
      'firstStaff', to_jsonb(first),
      'moves', '[]'::jsonb, 'demands', '[]'::jsonb)));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;
create function pg_temp.boss() returns text language sql as $$ select boss from seasons where ends_at is null $$;
create function pg_temp.offices() returns bigint language sql as $$ select count(*) from staff_offices $$;
create function pg_temp.handovers() returns bigint language sql as $$ select count(*) from season_handovers $$;
create function pg_temp.said() returns bigint language sql as $$ select count(*) from acts a where a.kind = 'post' and a.thread = pg_temp.ann() $$;
-- The latest office row of a persona: 'benched/seed', 'mod/seed', or null where it has none.
create function pg_temp.latest(k text) returns text language sql as $$
  select o.office || '/' || o.cause from staff_offices o where o.staff = k order by o.id desc limit 1
$$;
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.as_admin() returns void language sql as $$ select tests.become((select id from auth.users where email = 'dp-admin@test.invalid')) $$;
create function pg_temp.in_roster(k text) returns boolean language sql as $$ select k = any (boss_roster()) $$;

-- ---- 0. The world ----
do $$
begin
  perform pg_temp.seed(array['a', 'b', 'c', 'w', 'r'], array['c']);
  insert into admins (account) values (tests.account('dp-admin'));
  -- `b` is a member: an admin's set_office debuts it. `r` is retired, so the rotation never seats it.
  perform pg_temp.as_admin();
  perform set_office('b', 'member');
  perform tests.unbecome();
  update characters set retired_at = now() where staff = 'r';
  perform pg_temp.expect(pg_temp.boss() = 'a', 'the world has no Boss a');
  perform pg_temp.expect((select o.office from staff_office_now o where o.staff = 'c') = 'mod' and (select o.office from staff_office_now o where o.staff = 'b') = 'member'
    and (select o.office from staff_office_now o where o.staff = 'w') = 'waiting', 'the world is not a Boss, a member, a Mod and a waiting persona');
  perform pg_temp.expect(pg_temp.in_roster('b') and pg_temp.in_roster('w') and not pg_temp.in_roster('r'), 'the world''s roster is not b and w, without the retired r: ' || boss_roster()::text);
  -- A post of `b`'s, to be kept.
  perform write_staff_act('b', 'post', pg_temp.ann(), null, jsonb_build_object('body', 'b was here'));
end $$;

-- ---- 1. A reseed without b benches it ----
do $$
declare
  was bigint;
begin
  begin
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'benched/seed', 'b is not benched by the seed: ' || coalesce(pg_temp.latest('b'), 'no row'));
    perform pg_temp.expect(exists (select 1 from characters c where c.staff = 'b' and c.debuted_at is not null) and exists (select 1 from acts a join characters c on c.id = a.character where c.staff = 'b' and a.payload ->> 'body' = 'b was here'),
      'b lost its character or its post');
    perform pg_temp.expect(pg_temp.refused('select write_staff_act(''b'', ''post'', pg_temp.ann(), null, ''{"body":"still here"}''::jsonb)') is not null, 'a benched b still writes');
    perform pg_temp.expect(not pg_temp.in_roster('b') and pg_temp.in_roster('w') and pg_temp.in_roster('c'), 'boss_roster() does not leave out exactly b: ' || boss_roster()::text);
    perform pg_temp.expect(pg_temp.boss() = 'a', 'the Boss changed for a member''s leaving');
    was := pg_temp.offices();
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.offices() = was, 'a second identical reseed wrote office rows');
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 2. A reseed without w, which never debuted ----
do $$
begin
  begin
    perform pg_temp.seed(array['a', 'b', 'c', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.latest('w') is not distinct from 'benched/seed', 'w is not benched by the seed: ' || coalesce(pg_temp.latest('w'), 'no row'));
    perform pg_temp.expect((select c.debuted_at from characters c where c.staff = 'w') is null, 'the seed debuted w to bench it');
    perform pg_temp.expect(not pg_temp.in_roster('w') and pg_temp.in_roster('b'), 'boss_roster() does not leave out exactly w: ' || boss_roster()::text);
    perform pg_temp.expect((select o.office from staff_office_now o where o.staff = 'w') = 'waiting', 'a never-debuted w no longer reads waiting');
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 3. A reseed without a, the Boss ----
do $$
declare
  season_before record;
  season_after record;
  answer jsonb;
  new_boss text;
  ho record;
  farewell_at timestamptz;
begin
  begin
    select id, ends_at into season_before from seasons where ends_at is null;
    answer := pg_temp.seed(array['b', 'c', 'r'], array['c'], 'b');
    select id, ends_at into season_after from seasons where ends_at is null;
    perform pg_temp.expect(season_after.id = season_before.id and season_after.ends_at is not distinct from season_before.ends_at, 'the season did not go on');
    new_boss := pg_temp.boss();
    perform pg_temp.expect(new_boss in ('b', 'c'), 'the new Boss is not b or c (never a departing persona, never the retired r): ' || coalesce(new_boss, 'nobody'));
    select * into ho from season_handovers h where h.season = season_before.id and h.cause = 'departure';
    perform pg_temp.expect(ho.id is not null and ho.outgoing = 'a' and ho.boss = new_boss, 'there is no departure handover from a to the new Boss: ' || coalesce(to_jsonb(ho)::text, 'none'));
    perform pg_temp.expect(pg_temp.latest('a') is not distinct from 'benched/seed', 'a is not benched by the seed: ' || coalesce(pg_temp.latest('a'), 'no row'));
    -- a's farewell (the stock line) was posted, and before the bench row was written: write_staff_act refuses a benched persona (scenario 1), so a post that exists was written before the bench. The clock cannot show it,
    -- since every `now()` in one transaction is the same instant; the office rows' ids show the handover row precedes the bench row.
    select a.created_at into farewell_at from acts a join characters c on c.id = a.character where c.staff = 'a' and a.kind = 'post' and a.thread = pg_temp.ann() and a.payload ->> 'body' = 'Farewell from P a.';
    perform pg_temp.expect(farewell_at is not null, 'a''s farewell was not posted: ' || (select string_agg(a.payload ->> 'body', ' | ') from acts a where a.thread = pg_temp.ann()));
    perform pg_temp.expect((select o.id from staff_offices o where o.staff = 'a' and o.office = 'benched')
      > (select o.id from staff_offices o where o.staff = 'a' and o.cause = 'handover'), 'a''s bench is not after its handover office row');
    perform pg_temp.expect(answer ->> 'handover' is not distinct from new_boss and answer -> 'departed' = '["w", "a"]'::jsonb and answer -> 'returned' = '[]'::jsonb, 'the answer does not name the departure: ' || answer::text);
    perform pg_temp.expect(not pg_temp.in_roster('a') and pg_temp.in_roster(new_boss), 'boss_roster() lists a or lacks the new Boss: ' || boss_roster()::text);
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 4. A departing Boss with no Boss to take the chair is refused, and nothing is written ----
do $$
declare
  offices_was bigint := pg_temp.offices();
  handovers_was bigint := pg_temp.handovers();
  said_was bigint := pg_temp.said();
  acts_was bigint := (select count(*) from acts);
  moves_was bigint := (select count(*) from open_moves);
  banks_was bigint := (select count(*) from move_bank);
  why text;
begin
  -- Only the retired r is listed: a, b, c and w all leave, and no one in the roster can be seated.
  why := pg_temp.refused('select pg_temp.seed(array[''r''], array[]::text[], ''r'')');
  perform pg_temp.expect(why like '55000 the open season''s Boss a has left the roster, and no Boss in it can take the chair%', 'the seed was not refused with the reason: ' || coalesce(why, 'it went through'));
  perform pg_temp.expect(pg_temp.offices() = offices_was and pg_temp.handovers() = handovers_was and pg_temp.said() = said_was, 'the refused seed wrote something');
  perform pg_temp.expect((select count(*) from acts) = acts_was and (select count(*) from open_moves) = moves_was and (select count(*) from move_bank) = banks_was,
    'the refused seed spent a nomination, ended a move or wrote a bank row');
  perform pg_temp.expect(pg_temp.boss() = 'a' and pg_temp.latest('a') is null and pg_temp.latest('b') = 'member/admin', 'the refused seed moved the Boss or benched a persona');
end $$;

-- ---- 5. A reseed that drops the only Mod ----
do $$
declare
  offices_was bigint := pg_temp.offices();
  why text;
begin
  begin
    perform pg_temp.seed(array['a', 'b', 'w', 'r'], array['b']);
    perform pg_temp.expect(pg_temp.latest('c') is not distinct from 'benched/seed', 'c is not benched');
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'mod/seed' and (select o.office from staff_office_now o where o.staff = 'b') = 'mod', 'b is not hired as the Mod: ' || coalesce(pg_temp.latest('b'), 'no row'));
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
  -- firstStaff names only c, which has left: no Mod can be hired, and the seed is refused with nothing written.
  why := pg_temp.refused('select pg_temp.seed(array[''a'', ''b'', ''w'', ''r''], array[''c'']::text[])');
  perform pg_temp.expect(why like '55000 the seed leaves no Mod Bot on staff: name one in firstStaff%', 'the seed was not refused for leaving no Mod: ' || coalesce(why, 'it went through'));
  perform pg_temp.expect(pg_temp.offices() = offices_was and pg_temp.latest('c') = 'mod/seed', 'the refused seed wrote office rows');
end $$;

-- ---- 5c. A staff that had no Mod before the seed is not the seed's doing: benching a member refuses nothing and hires no one ----
do $$
begin
  begin
    insert into staff_offices (staff, office, cause) values ('c', 'benched', 'admin');
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'benched/seed' and pg_temp.latest('c') is not distinct from 'benched/admin', 'the seed did not bench b alone: ' || coalesce(pg_temp.latest('b'), 'no row') || ', ' || coalesce(pg_temp.latest('c'), 'no row'));
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 6. set_office and a persona the seed benched ----
do $$
declare
  why text;
begin
  begin
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    perform pg_temp.as_admin();
    why := pg_temp.refused('select set_office(''b'', ''mod'')');
    perform tests.unbecome();
    perform pg_temp.expect(why like '55000 that persona left the instance''s roster; a seed that lists it brings it back%', 'set_office did not refuse the roster reason: ' || coalesce(why, 'it went through'));
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'benched/seed', 'the refused set_office wrote a row');
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
  -- An admin's own bench of a Mod is undone by set_office as it always was (a second Mod stands first, since the last is never benched).
  begin
    perform pg_temp.as_admin();
    perform set_office('b', 'mod');
    perform set_office('c', 'benched');
    perform set_office('c', 'mod');
    perform tests.unbecome();
    perform pg_temp.expect(pg_temp.latest('c') is not distinct from 'mod/admin', 'an admin''s bench and unbench of c did not stand: ' || coalesce(pg_temp.latest('c'), 'no row'));
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 7. A reseed that lists b again, and 8. identical reseeds write nothing ----
do $$
declare
  was bigint;
  answer jsonb;
begin
  begin
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    answer := pg_temp.seed(array['a', 'b', 'c', 'w', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'member/seed' and (select o.office from staff_office_now o where o.staff = 'b') = 'member' and pg_temp.in_roster('b'), 'b did not come back a member: ' || coalesce(pg_temp.latest('b'), 'no row'));
    perform pg_temp.expect(answer -> 'returned' = '["b"]'::jsonb and answer -> 'departed' = '[]'::jsonb, 'the answer does not name b as returned: ' || answer::text);
    was := pg_temp.offices();
    perform pg_temp.seed(array['a', 'b', 'c', 'w', 'r'], array['c']);
    perform pg_temp.expect(pg_temp.offices() = was, 'a third identical reseed wrote an office row');
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
  -- Where firstStaff names it, it comes back a Mod.
  begin
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    perform pg_temp.seed(array['a', 'b', 'c', 'w', 'r'], array['b', 'c']);
    perform pg_temp.expect(pg_temp.latest('b') is not distinct from 'mod/seed' and (select o.office from staff_office_now o where o.staff = 'b') = 'mod', 'b did not come back a Mod: ' || coalesce(pg_temp.latest('b'), 'no row'));
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
  -- 8. After a departure: the second identical seed writes no office row and no handover.
  begin
    perform pg_temp.seed(array['b', 'c', 'r'], array['c'], 'b');
    was := pg_temp.offices();
    answer := pg_temp.seed(array['b', 'c', 'r'], array['c'], 'b');
    perform pg_temp.expect(pg_temp.offices() = was and (select count(*) from season_handovers h where h.cause = 'departure') = 1, 'the second identical seed wrote an office row or a handover');
    perform pg_temp.expect(answer -> 'departed' = '[]'::jsonb and answer -> 'handover' = 'null'::jsonb, 'the second seed answered a departure: ' || answer::text);
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 7b. A persona listed again can take the chair of a Boss that leaves in the same seed ----
do $$
declare
  answer jsonb;
begin
  begin
    perform pg_temp.seed(array['a', 'c', 'w', 'r'], array['c']);
    -- b comes back, and a leaves, in one seed: the roster lists b and c, and c is the only Mod, so only b can be the Boss.
    answer := pg_temp.seed(array['b', 'c', 'r'], array['c'], 'b');
    perform pg_temp.expect(pg_temp.boss() is not distinct from 'b' and answer ->> 'handover' is not distinct from 'b' and answer -> 'returned' = '["b"]'::jsonb, 'the returning b did not take the chair: ' || answer::text);
    perform pg_temp.expect((select o.office from staff_office_now o where o.staff = 'c') = 'mod', 'c is not still the Mod');
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 9. A seed with no persona is not a roster ----
do $$
declare
  was bigint := pg_temp.offices();
begin
  perform pg_temp.seed(array[]::text[], array[]::text[]);
  perform pg_temp.expect(pg_temp.offices() = was and pg_temp.boss() = 'a', 'a seed with no persona changed the staff');
end $$;

-- ---- 10. A retired persona that leaves the roster gets no bench row and is not departed ----
do $$
declare
  answer jsonb;
begin
  begin
    answer := pg_temp.seed(array['a', 'b', 'c', 'w'], array['c']);
    perform pg_temp.expect(pg_temp.latest('r') is null, 'the retired r was benched: ' || coalesce(pg_temp.latest('r'), 'no row'));
    perform pg_temp.expect(answer -> 'departed' = '[]'::jsonb, 'the answer names a retired persona as departed: ' || answer::text);
    raise exception using errcode = 'RB999', message = 'rolled back';
  exception when sqlstate 'RB999' then null;
  end;
end $$;

-- ---- 11. A staff entry with no key is refused before the roster is read; it never makes a null that stops anyone departing ----
do $$
declare
  why text;
begin
  why := pg_temp.refused('select pg_temp.seed(array[''a'', ''c'', ''w'', ''r'', null], array[''c'']::text[])');
  perform pg_temp.expect(why is not null, 'a keyless staff entry went through the seed');
  raise notice 'keyless entry refused first by: %', why;
end $$;
