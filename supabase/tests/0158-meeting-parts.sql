-- A meeting part that fails leaves its fields as they were (supabase/migrations/0158_meeting_parts.sql;
-- docs/plans/2026-11-11-provider-schemas-design.md, section 4; the plan's Task 5).
--
-- The meeting is three calls (the Boss's answer, its memory and its profile), and a part that failed arrives as no `memory` or no `profile` in the payload. apply_meeting then
-- writes no staff_memory row and no staff_profiles row for the Boss: both tables are append-only, so "as it was" is the last row, which staff_memory_latest and the newest
-- staff_profiles row still say. The bank and the moves are applied whichever part is missing.
--
-- 1. Both parts are written, and the move and the bank land.
--    (Poison: a guard that drops one part when the other is present. The test is red on "a meeting with both parts wrote no memory" or "no profile".)
-- 2. No memory: no staff_memory row for the meeting, the latest memory unchanged, the profile, the move and the bank landing.
--    (Poison: the memory insert unguarded. The test is red on the not-null violation of staff_memory.body, as the first red run showed.)
-- 3. No profile: no staff_profiles row for the meeting, the newest profile unchanged, the memory, the move and the bank landing.
--    (Poison: the profile insert unguarded. The test is red on "a meeting without a profile wrote one".)
-- 4. Neither, each sent as a value that is not an object: the memory a JSON string, the profile a JSON string. Nothing of either is written.
--    (Poison: the profile guard loosened to `payload -> 'profile' is not null`. The test is red on "a meeting with neither part wrote a row", since the
--    JSON string passes a null check and the insert runs.)

create function pg_temp.memory(hobby text) returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;
create function pg_temp.profile(mood text) returns jsonb language sql as $$
  select jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', mood, 'signature', 'It is decided.')
$$;
create function pg_temp.rename(board uuid, name text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'renameBoard',
    'params', jsonb_build_object('board', board, 'name', name, 'premise', 'About ' || name, 'description', 'Welcome to ' || name),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 5)),
    'go_live_at', now() + interval '48 hours', 'expires_in_hours', 48, 'why', 'Because.')
$$;
-- The payload of one meeting: the Boss's answer always, and the memory and the profile only when given.
create function pg_temp.payload(general uuid, name text, memory jsonb, profile jsonb) returns jsonb language sql as $$
  select jsonb_build_object('boss', 'mp-boss', 'weekly_moves', 0, 'bank_cap', 10, 'moves', jsonb_build_array(pg_temp.rename(general, name)), 'record', '{}'::jsonb)
    || case when memory is null then '{}'::jsonb else jsonb_build_object('memory', memory) end
    || case when profile is null then '{}'::jsonb else jsonb_build_object('profile', profile) end
$$;

do $$
declare
  general uuid;
  m1 bigint; m2 bigint; m3 bigint; m4 bigint;
  bank numeric;
  r jsonb;
begin
  select id into general from boards where slug = 'general';
  insert into characters (name, staff, staff_kind, debuted_at) values ('Mp Boss', 'mp-boss', 'persona', now());
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict (key) do nothing;
  insert into settings (key, value) values ('structuralHoldHours', '24') on conflict (key) do update set value = excluded.value;
  update seasons set boss = 'mp-boss' where ends_at is null;
  insert into move_bank (staff, balance, as_of) values ('mp-boss', 8, now());

  -- Both parts: both are written, as before; one move is queued and one move's cost leaves the bank.
  m1 := (begin_meeting('2031-03-01T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m1, pg_temp.payload(general, 'First Name', pg_temp.memory('wrestling'), pg_temp.profile('smug')));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 1 then raise exception 'both parts: %', r; end if;
  if staff_memory_latest('mp-boss') -> 'hobby' ->> 'name' is distinct from 'wrestling' then raise exception 'a meeting with both parts wrote no memory'; end if;
  if (select count(*) from staff_profiles where meeting = m1 and mood = 'smug') is distinct from 1::bigint then raise exception 'a meeting with both parts wrote no profile'; end if;
  if (select count(*) from queued_moves where meeting = m1) is distinct from 1::bigint then raise exception 'both parts: the move was not queued'; end if;
  if (select balance from move_bank where staff = 'mp-boss') is distinct from 7::numeric then raise exception 'both parts: the bank was not debited'; end if;

  -- No memory: the Boss's latest memory is the last row it was, and no row is written for this meeting; the profile is written; the move and the bank land.
  m2 := (begin_meeting('2031-03-02T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m2, pg_temp.payload(general, 'Second Name', null, pg_temp.profile('cheerful')));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 1 then raise exception 'no memory: %', r; end if;
  if exists (select 1 from staff_memory where meeting = m2) then raise exception 'a meeting without a memory wrote one'; end if;
  if staff_memory_latest('mp-boss') -> 'hobby' ->> 'name' is distinct from 'wrestling' then raise exception 'a meeting without a memory changed the latest one'; end if;
  if (select count(*) from staff_profiles where meeting = m2 and mood = 'cheerful') is distinct from 1::bigint then raise exception 'no memory: the profile was not written'; end if;
  if (select count(*) from queued_moves where meeting = m2) is distinct from 1::bigint then raise exception 'no memory: the move was not queued'; end if;
  if (select balance from move_bank where staff = 'mp-boss') is distinct from 6::numeric then raise exception 'no memory: the bank was not debited'; end if;
  if (select outcome from meetings where id = m2) is distinct from 'ok' then raise exception 'no memory: the meeting did not close ok'; end if;

  -- No profile: the newest profile row is the last one it was, and none is written for this meeting; the memory is written; the move and the bank land.
  m3 := (begin_meeting('2031-03-03T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m3, pg_temp.payload(general, 'Third Name', pg_temp.memory('chess'), null));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 1 then raise exception 'no profile: %', r; end if;
  if exists (select 1 from staff_profiles where meeting = m3) then raise exception 'a meeting without a profile wrote one'; end if;
  if (select meeting from staff_profiles where staff = 'mp-boss' order by at desc, id desc limit 1) is distinct from m2 then raise exception 'a meeting without a profile changed the newest one'; end if;
  if staff_memory_latest('mp-boss') -> 'hobby' ->> 'name' is distinct from 'chess' then raise exception 'no profile: the memory was not written'; end if;
  if (select count(*) from queued_moves where meeting = m3) is distinct from 1::bigint then raise exception 'no profile: the move was not queued'; end if;
  if (select balance from move_bank where staff = 'mp-boss') is distinct from 5::numeric then raise exception 'no profile: the bank was not debited'; end if;

  -- Neither (a part that is not an object, a JSON string for both, counts as missing too): nothing of either is written, the rest lands.
  m4 := (begin_meeting('2031-03-04T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m4, pg_temp.payload(general, 'Fourth Name', null, null) || jsonb_build_object('memory', 'nope', 'profile', 'nope'));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 1 then raise exception 'neither: %', r; end if;
  if exists (select 1 from staff_memory where meeting = m4) or exists (select 1 from staff_profiles where meeting = m4) then raise exception 'a meeting with neither part wrote a row'; end if;
  if staff_memory_latest('mp-boss') -> 'hobby' ->> 'name' is distinct from 'chess' then raise exception 'neither: the latest memory moved'; end if;
  if (select balance from move_bank where staff = 'mp-boss') is distinct from 4::numeric then raise exception 'neither: the bank was not debited'; end if;
end $$;
