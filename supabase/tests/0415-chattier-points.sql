-- The meeting's talking points (supabase/migrations/0415_chattier_staff.sql, section 3; docs/plans/2026-11-22-chattier-staff-plan.md, Task 5; the design's section 4).
-- apply_meeting writes one staff_points row for each persona in a posting office (the Boss, a Mod, a member) that the answer gave a line, in the same transaction as the orders: a refused apply writes none, a key
-- that is benched, waiting or no persona is skipped, a second line for one key is skipped, a blank line is skipped, a line over 200 characters is cut, and a second apply of the same meeting writes none.

create function pg_temp.payload(boss text, moves jsonb, points jsonb) returns jsonb language sql as $$
  select jsonb_build_object('boss', boss, 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'wrestling', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('wrestling', 'pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', moves, 'points', points, 'record', jsonb_build_object('trims', '[]'::jsonb))
$$;

do $$
declare
  general uuid;
  slot1 timestamptz := '2026-01-01T09:00:00Z';
  m1 bigint;
  r jsonb;
  mv jsonb;
  denied boolean;
  long_line text := repeat('talk ', 46);
  pts jsonb;
  rec jsonb;
begin
  select id into general from boards where slug = 'general';
  insert into characters (name, staff, staff_kind, debuted_at) values
    ('Pt Boss', 'pt-boss', 'persona', now()), ('Pt Mod', 'pt-mod', 'persona', now()), ('Pt Member', 'pt-member', 'persona', now()),
    ('Pt Bench', 'pt-bench', 'persona', now()), ('Pt Wait', 'pt-wait', 'persona', null);
  insert into staff_offices (staff, office, cause) values ('pt-mod', 'mod', 'admin'), ('pt-bench', 'benched', 'admin');
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict (key) do nothing;
  insert into settings (key, value) values ('structuralHoldHours', '24'), ('meetingCron', '"23 9 * * *"') on conflict (key) do update set value = excluded.value;
  update seasons set boss = 'pt-boss' where ends_at is null;
  m1 := (begin_meeting(slot1) ->> 'meeting')::bigint;
  mv := jsonb_build_object('kind', 'renameBoard',
    'params', jsonb_build_object('board', general, 'name', 'Pirate Puns Palace', 'premise', 'About puns', 'description', 'Welcome'),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 5)),
    'go_live_at', now(), 'expires_in_hours', 48, 'why', 'Because.');
  pts := jsonb_build_array(
    jsonb_build_object('staff', 'pt-boss', 'line', 'Keep the peace, loudly.'),
    jsonb_build_object('staff', 'pt-mod', 'line', long_line),
    jsonb_build_object('staff', 'pt-member', 'line', '  Needle the Boss.  '),
    jsonb_build_object('staff', 'pt-member', 'line', 'A second line for one key.'),
    jsonb_build_object('staff', 'pt-bench', 'line', 'Benched, so no.'),
    jsonb_build_object('staff', 'pt-wait', 'line', 'Waiting, so no.'),
    jsonb_build_object('staff', 'pt-nobody', 'line', 'Not a persona.'),
    jsonb_build_object('staff', 'pt-boss', 'line', '   '),
    to_jsonb('not an object'::text),
    jsonb_build_object('staff', 7, 'line', 'Not a key.'));

  -- A refused apply (the bank cannot pay for the move) writes no talking points: they are written with the orders, in the one transaction.
  denied := false;
  begin perform apply_meeting(m1, pg_temp.payload('pt-boss', jsonb_build_array(mv), pts)); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a Boss with no bank spent a move'; end if;
  if exists (select 1 from staff_points where meeting = m1) then raise exception 'a refused apply left talking points behind'; end if;

  insert into move_bank (staff, balance, as_of) values ('pt-boss', 3, now());
  r := apply_meeting(m1, pg_temp.payload('pt-boss', jsonb_build_array(mv), pts));
  if r ->> 'status' is distinct from 'applied' then raise exception 'apply: %', r; end if;
  if (select count(*) from staff_points where meeting = m1) is distinct from 3::bigint then
    raise exception 'the talking points of the Boss, the Mod and the member were not written, alone: %', (select jsonb_agg(to_jsonb(p)) from staff_points p where meeting = m1);
  end if;
  if (select line from staff_points where meeting = m1 and staff = 'pt-boss') is distinct from 'Keep the peace, loudly.' then raise exception 'the Boss''s line: a blank second line took its place'; end if;
  if (select line from staff_points where meeting = m1 and staff = 'pt-member') is distinct from 'Needle the Boss.' then raise exception 'a member''s line is kept, trimmed of its blanks, and the first one stands'; end if;
  if (select char_length(line) from staff_points where meeting = m1 and staff = 'pt-mod') is distinct from 200 then raise exception 'a line over 200 characters was not cut to 200'; end if;
  select record -> 'pointsWritten' into rec from meetings where id = m1;
  if rec is distinct from jsonb_build_object('written', 3, 'skipped', 7, 'trimmed', 1) then raise exception 'the meeting''s record of its points: %', rec; end if;
  if (select count(*) from queued_moves where meeting = m1) is distinct from 1::bigint then raise exception 'the move was not queued with the points'; end if;

  -- A second apply of the same meeting writes none: a retry cannot write a persona's line twice.
  r := apply_meeting(m1, pg_temp.payload('pt-boss', '[]'::jsonb, jsonb_build_array(jsonb_build_object('staff', 'pt-mod', 'line', 'Another line.'))));
  if r ->> 'status' is distinct from 'already applied' then raise exception 'a closed meeting was applied again: %', r; end if;
  if (select count(*) from staff_points where meeting = m1) is distinct from 3::bigint or exists (select 1 from staff_points where line = 'Another line.') then
    raise exception 'an apply of a closed meeting wrote talking points';
  end if;

  -- The newest meeting's line is the one read (staff_points_latest), and a persona it left out has none.
  if staff_points_latest('pt-member') is distinct from 'Needle the Boss.' then raise exception 'the latest talking points are not read: %', staff_points_latest('pt-member'); end if;
  if staff_points_latest('pt-bench') is not null then raise exception 'a persona the meeting left out has talking points'; end if;

  -- No other meeting wrote any.
  if exists (select 1 from staff_points where meeting <> m1) then raise exception 'talking points of another meeting'; end if;
end $$;

do $$
declare
  m2 bigint;
  r jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pq Boss', 'pq-boss', 'persona', now());
  update seasons set boss = 'pq-boss' where ends_at is null;
  insert into move_bank (staff, balance, as_of) values ('pq-boss', 3, now());
  m2 := (begin_meeting('2026-01-02T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m2, pg_temp.payload('pq-boss', '[]'::jsonb, to_jsonb('not a list'::text)));
  if r ->> 'status' is distinct from 'applied' or exists (select 1 from staff_points where meeting = m2) then raise exception 'points that are not a list: %', r; end if;
  m2 := (begin_meeting('2026-01-03T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m2, pg_temp.payload('pq-boss', '[]'::jsonb, 'null'::jsonb) - 'points');
  if r ->> 'status' is distinct from 'applied' or exists (select 1 from staff_points where meeting = m2) then raise exception 'a payload with no points: %', r; end if;
end $$;
