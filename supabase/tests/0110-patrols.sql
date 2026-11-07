-- Patrols and the targeting cap (supabase/migrations/0108_patrols.sql; the Mod Bots design, section 8, "A busy instance" and "What could slip a mask"; its plan, Task 11).
--
-- 1. apply_meeting writes the answer's patrols (kept on the meeting record, Task 4) into the `patrols` table: a Mod not on staff and a time that is no time are skipped, a time is
--    moved into today (now to a day on), and past `patrolsPerDay` they are cut from the end. A retried meeting ("already applied") writes nothing twice.
-- 2. patrol_sample(boards, most): the newest posts on the Mod's beat boards by players, not under a visit (open or ended), bounded by `most` per thread and per board. It reads
--    public play only (the digest role owns it) and answers no owner, class or reactor.
-- 3. claim_patrol: a patrol that is due is claimed once (two sessions at once claim it once); one not yet due, or already claimed, is not.
-- 4. patrol_record and record_patrol_call keep what a patrol sampled, dropped and spent, once per call; a patrol has no Act, so its call's record is keyed by the patrol.
-- 5. staff_punishments(character, days): visits that patrols chose and backfires, filed or still open, from public Acts; a rule's visit, a player's report and a tail do not count.
-- 6. start_visit with cause 'patrol' refuses past `cap.punishments` in `cap.days` and records the drop on the patrol row; the other causes are never refused by the cap.
-- 7. The doors: all of these are the service's, and the patrol table is no client's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.memory() returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', 'wrestling', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;

-- A meeting's payload carrying these patrols on its record, where meet/core.ts keeps them.
create function pg_temp.payload(patrols jsonb) returns jsonb language sql as $$
  select jsonb_build_object('boss', 'pt-boss', 'weekly_moves', 0, 'bank_cap', 10, 'memory', pg_temp.memory(),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'orders', '[]'::jsonb, 'record', jsonb_build_object('patrols', patrols))
$$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text, at timestamptz default clock_timestamp()) returns uuid language sql as $$
  select tests.post(by_character, in_thread, body, at)
$$;

create function pg_temp.char(name text) returns uuid language sql as $$ select id from characters where characters.name = char.name $$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

create function pg_temp.charge(cause text, on_post uuid, band text default 'minor', patrol bigint default null) returns jsonb language sql as $$
  select jsonb_build_object('rule_number', null, 'board', (select t.board from acts a join threads t on t.id = a.thread where a.id = on_post), 'band', band, 'cause', cause,
    'about_act', on_post, 'rule', 'the premise of a board') || case when patrol is null then '{}'::jsonb else jsonb_build_object('patrol_id', patrol) end
$$;

-- A visit the way the database starts them, filed at once (so it is a punishment that landed).
create function pg_temp.filed(cause text, on_post uuid, patrol bigint default null) returns uuid language plpgsql as $$
declare started jsonb;
begin
  started := start_visit(on_post, 'pt-m1', pg_temp.charge(cause, on_post, 'minor', patrol));
  if started ->> 'visit' is null then return null; end if;
  perform file_visit((started ->> 'visit')::uuid, 'Filed.');
  return (started ->> 'visit')::uuid;
end $$;

-- ---- 0. The world: a Boss, two Mods, two boards, players, and the settings ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 1, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 3, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'), 'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'pt-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'pt-boss', 'name', 'Patrol Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'pt-m1', 'name', 'Patrol Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'pt-m2', 'name', 'Patrol Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'pt-m3', 'name', 'Patrol Member', 'title', 'Member', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', jsonb_build_array('pt-m1', 'pt-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into move_bank (staff, balance, as_of) values ('pt-boss', 6, now());
  insert into boards (slug, name) values ('pt-general', 'Patrol General'), ('pt-other', 'Patrol Other');
  perform tests.character(tests.account('pt-ann'), 'Pt Ann');
  perform tests.character(tests.account('pt-bob'), 'Pt Bob');
  perform tests.character(tests.account('pt-cy'), 'Pt Cy');
end $$;

-- ---- 1. apply_meeting writes the patrols: validated, clamped, cut to patrolsPerDay, and once ----
do $$
declare
  m bigint := (begin_meeting('2031-02-01T09:00:00Z') ->> 'meeting')::bigint;
  r jsonb;
  rows_n bigint;
  t0 timestamptz := clock_timestamp();
begin
  r := apply_meeting(m, pg_temp.payload(jsonb_build_array(
    jsonb_build_object('mod', 'pt-m1', 'at', (t0 - interval '3 hours')),
    jsonb_build_object('mod', 'nobody', 'at', (t0 + interval '1 hour')),
    jsonb_build_object('mod', 'pt-m3', 'at', (t0 + interval '1 hour')),
    jsonb_build_object('mod', 'pt-m2', 'at', 'noon-ish'),
    jsonb_build_object('mod', 'pt-m2', 'at', (t0 + interval '10 days')),
    jsonb_build_object('mod', 'pt-m1', 'at', (t0 + interval '2 hours')),
    jsonb_build_object('mod', 'pt-m2', 'at', (t0 + interval '3 hours')))));
  if r ->> 'status' is distinct from 'applied' then raise exception 'the meeting did not apply: %', r; end if;
  select count(*) into rows_n from patrols where meeting = m;
  if rows_n is distinct from 3::bigint then raise exception 'patrolsPerDay (3) patrols should be written, not %: %', rows_n, (select jsonb_agg(to_jsonb(p)) from patrols p where meeting = m); end if;
  -- In the answer's order, the invalid ones skipped: m1 (past, now), m2 (far, a day on), m1.
  if (select array_agg(staff order by n) from patrols where meeting = m) is distinct from array['pt-m1', 'pt-m2', 'pt-m1'] then
    raise exception 'the patrols written are not the valid ones in order: %', (select array_agg(staff order by n) from patrols where meeting = m);
  end if;
  if exists (select 1 from patrols where meeting = m and (at < now() or at > clock_timestamp() + interval '1 day' + interval '1 second')) then raise exception 'a patrol''s time was not moved into today'; end if;
  if (select at from patrols where meeting = m and n = 1) > clock_timestamp() + interval '1 second' then raise exception 'a time in the past should be now'; end if;
  if exists (select 1 from patrols where meeting = m and (ran_at is not null or sampled <> '{}' or dropped <> '[]'::jsonb)) then raise exception 'a new patrol is not clean'; end if;
  -- A retried meeting writes nothing twice.
  r := apply_meeting(m, pg_temp.payload(jsonb_build_array(jsonb_build_object('mod', 'pt-m1', 'at', t0))));
  if r ->> 'status' is distinct from 'already applied' then raise exception 'a retried meeting applied again: %', r; end if;
  if (select count(*) from patrols where meeting = m) is distinct from 3::bigint then raise exception 'a retried meeting wrote patrols twice'; end if;
  -- A meeting that carries none writes none.
  m := (begin_meeting('2031-02-02T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m, pg_temp.payload('[]'::jsonb));
  if exists (select 1 from patrols where meeting = m) then raise exception 'a meeting with no patrols wrote some'; end if;
  m := (begin_meeting('2031-02-03T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m, jsonb_set(pg_temp.payload('[]'::jsonb), '{record}', '{}'::jsonb));
  if exists (select 1 from patrols where meeting = m) then raise exception 'a meeting with no patrols key wrote some'; end if;
end $$;

-- ---- 2. patrol_sample: public play on the beat, newest first, not by staff, not under a visit ----
do $$
declare
  general uuid := pg_temp.board('pt-general');
  other uuid := pg_temp.board('pt-other');
  ann uuid := pg_temp.char('Pt Ann');
  bob uuid := pg_temp.char('Pt Bob');
  boss uuid := (select id from characters where staff = 'pt-boss');
  t1 uuid; t2 uuid; t3 uuid;
  p1 uuid; p2 uuid; p3 uuid; p_staff uuid; p_open uuid; p_filed uuid; p_other uuid; p_old uuid;
  got jsonb;
  base timestamptz := clock_timestamp() - interval '1 hour';
begin
  insert into threads (board, title) values (general, 'Sample one') returning id into t1;
  insert into threads (board, title) values (general, 'Sample two') returning id into t2;
  insert into threads (board, title) values (other, 'Sample elsewhere') returning id into t3;
  p_old := tests.post(bob, t1, 'The oldest.', base);
  p1 := tests.post(ann, t1, 'One.', base + interval '1 minute');
  p_open := tests.post(bob, t1, 'Under an open visit.', base + interval '2 minutes');
  p_filed := tests.post(bob, t1, 'Already filed.', base + interval '3 minutes');
  perform set_config('kayfabb.staff_writer', 'on', true);
  p_staff := tests.post(boss, t1, 'The Boss speaks.', base + interval '4 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  p2 := tests.post(ann, t2, 'Two.', base + interval '5 minutes');
  p3 := tests.post(bob, t2, 'Three.', base + interval '6 minutes');
  p_other := tests.post(bob, t3, 'On another board.', base + interval '7 minutes');
  perform start_visit(p_open, 'pt-m1', pg_temp.charge('rule', p_open));
  perform pg_temp.filed('rule', p_filed);

  got := patrol_sample(array[general], 10);
  if jsonb_typeof(got) is distinct from 'array' then raise exception 'the sample is no list: %', got; end if;
  if (select array_agg((x ->> 'act')::uuid order by ord) from jsonb_array_elements(got) with ordinality t(x, ord)) is distinct from array[p3, p2, p1, p_old] then
    raise exception 'the sample is not the beat''s player posts, newest first, free of visits and staff: %', got;
  end if;
  if got::text ~* (p_staff::text || '|' || p_open::text || '|' || p_filed::text || '|' || p_other::text) then raise exception 'the sample holds a post it should not: %', got; end if;
  if (got -> 0 ->> 'name') is distinct from 'Pt Bob' or (got -> 0 ->> 'body') is distinct from 'Three.' or (got -> 0 ->> 'title') is distinct from 'Sample two'
     or (got -> 0 ->> 'thread') is distinct from t2::text or (got -> 0 ->> 'board') is distinct from general::text then raise exception 'a sampled post is wrongly described: %', got -> 0;
  end if;
  -- Bounded: `most` posts however many there are.
  if jsonb_array_length(patrol_sample(array[general], 2)) is distinct from 2 then raise exception 'the sample is not cut to most'; end if;
  if (patrol_sample(array[general], 2) -> 0 ->> 'act')::uuid is distinct from p3 then raise exception 'the cut sample is not the newest'; end if;
  -- Two boards: the other board's post joins, newest first overall.
  if (patrol_sample(array[general, other], 1) -> 0 ->> 'act')::uuid is distinct from p_other then raise exception 'the sample did not span the beat''s boards'; end if;
  -- The boards of a sample, named, with the premise as the players see it now.
  if board_premises(array[general, other]) is distinct from (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'premise', b.premise) order by b.name, b.id) from boards_now b where b.id in (general, other)) then
    raise exception 'board_premises did not name the boards: %', board_premises(array[general, other]);
  end if;
  if board_premises('{}') is distinct from '[]'::jsonb then raise exception 'no boards gave premises'; end if;
  -- No boards, no sample; a board of no beat is not read.
  if patrol_sample('{}'::uuid[], 5) is distinct from '[]'::jsonb then raise exception 'no boards gave a sample'; end if;
  if patrol_sample(array[gen_random_uuid()], 5) is distinct from '[]'::jsonb then raise exception 'an unknown board gave a sample'; end if;
  -- Masks: no owner, class or reactor in anything it says.
  if got::text ~* (select string_agg(owner::text, '|') from characters where owner is not null) then raise exception 'the sample names an owner'; end if;
  if got::text ~* 'owner|class|reactor' then raise exception 'the sample speaks of a private fact: %', got; end if;
end $$;

-- ---- 3. claim_patrol: a due patrol once; a future one, never ----
do $$
declare
  m bigint := (begin_meeting('2031-02-04T09:00:00Z') ->> 'meeting')::bigint;
  due_id bigint;
  claimed jsonb;
  said text[];
begin
  -- Two due patrols and one not due. (The first meeting's patrols are due too: they are claimed first, oldest time first, then these.)
  update patrols set ran_at = now() where ran_at is null;
  perform apply_meeting(m, pg_temp.payload(jsonb_build_array(jsonb_build_object('mod', 'pt-m1', 'at', clock_timestamp()), jsonb_build_object('mod', 'pt-m2', 'at', clock_timestamp() + interval '5 hours'))));
  select id into due_id from patrols where meeting = m and n = 1;
  claimed := claim_patrol();
  if (claimed ->> 'id')::bigint is distinct from due_id or claimed ->> 'staff' is distinct from 'pt-m1' then raise exception 'the due patrol was not claimed: %', claimed; end if;
  if (select ran_at from patrols where id = due_id) is null then raise exception 'a claimed patrol has no ran_at'; end if;
  if claim_patrol() is not null then raise exception 'a claimed patrol, or one not yet due, was claimed'; end if;
  if (select ran_at from patrols where meeting = m and n = 2) is not null then raise exception 'a patrol not yet due was claimed'; end if;
end $$;

-- Two sessions claiming the one due patrol claim it once (committed rows: the race runs in sessions of its own).
do $$
declare
  m bigint;
  said text[];
  got int;
begin
  perform tests.commit($sql$
    insert into meetings (slot, started_at, finished_at, outcome) values ('2001-01-01T09:00:00Z', now(), now(), 'ok');
    insert into characters (name, staff, staff_kind, debuted_at) values ('Pt Race Mod', 'pt-race', 'persona', now());
    insert into patrols (meeting, n, staff, at) select id, 1, 'pt-race', now() - interval '1 minute' from meetings where slot = '2001-01-01T09:00:00Z';
  $sql$);
  said := tests.race_service('select claim_patrol()', 'select claim_patrol()');
  if said[1] is not null and said[1] like 'ERROR%' or said[2] is not null and said[2] like 'ERROR%' then raise exception 'a racing claim failed: %', said; end if;
  select count(*) into got from patrols where meeting = (select id from meetings where slot = '2001-01-01T09:00:00Z') and ran_at is not null;
  if got is distinct from 1 then raise exception 'the patrol was claimed % times', got; end if;
  perform tests.commit($sql$ update patrols set ran_at = now() where ran_at is null $sql$);
end $$;

-- ---- 4. patrol_record and record_patrol_call ----
do $$
declare
  pid bigint := (select id from patrols where staff = 'pt-m1' and ran_at is not null order by id limit 1);
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  r jsonb;
begin
  perform patrol_record(pid, array[p1, p2], '{"findings": 1}'::jsonb);
  if (select sampled from patrols where id = pid) is distinct from array[p1, p2] or (select outcome from patrols where id = pid) is distinct from '{"findings": 1}'::jsonb then raise exception 'patrol_record did not keep what was sampled'; end if;
  r := record_patrol_call(pid, 'pt-m1', '{"trims": [], "dropped": [], "calls": 1}');
  if (r ->> 'attempt')::integer is distinct from 1 then raise exception 'the first record is not attempt 1: %', r; end if;
  r := record_patrol_call(pid, 'pt-m1', '{"trims": [], "dropped": [], "calls": 1}');
  if (r ->> 'attempt')::integer is distinct from 2 then raise exception 'a second call of a patrol is not attempt 2: %', r; end if;
  if (select count(*) from staff_call_records where cause_patrol = pid and cause_act is null and duty = 'patrolJudge') is distinct from 2::bigint then raise exception 'the calls are not keyed by the patrol'; end if;
  -- A patrol that does not exist is refused; a Mod that does not exist is refused.
  if pg_temp.refusal(format('select record_patrol_call(-1, ''pt-m1'', ''{}'')')) is null then raise exception 'a record for no patrol was kept'; end if;
  if pg_temp.refusal(format('select record_patrol_call(%s, ''nobody'', ''{}'')', pid)) is null then raise exception 'a record for no Mod was kept'; end if;
end $$;

-- ---- 5. staff_punishments: what staff chose, from public Acts ----
do $$
declare
  general uuid := pg_temp.board('pt-general');
  cy uuid := pg_temp.char('Pt Cy');
  ann uuid := pg_temp.char('Pt Ann');
  t uuid;
  posts uuid[] := '{}';
  p uuid;
  i integer;
  v uuid;
begin
  -- (The cap is not under test here: raised out of the way, and put back below.)
  update settings set value = jsonb_set(value, '{cap,punishments}', '50') where key = 'modBots';
  insert into threads (board, title) values (general, 'Punishments') returning id into t;
  for i in 1..9 loop posts := posts || tests.post(cy, t, 'Cy post ' || i, clock_timestamp()); end loop;
  if staff_punishments(cy, 7) is distinct from 0 then raise exception 'a character with no visits has punishments'; end if;
  -- A rule's visit, a report's and a tail's do not count, filed or not.
  perform pg_temp.filed('rule', posts[1]);
  perform pg_temp.filed('report', posts[2]);
  perform pg_temp.filed('tail', posts[3]);
  if staff_punishments(cy, 7) is distinct from 0 then raise exception 'a rule break, a report or a tail counted: %', staff_punishments(cy, 7); end if;
  -- A patrol finding that filed counts; a backfire that filed counts.
  perform pg_temp.filed('patrol', posts[4]);
  if staff_punishments(cy, 7) is distinct from 1 then raise exception 'a filed patrol finding did not count: %', staff_punishments(cy, 7); end if;
  perform pg_temp.filed('backfire', posts[5]);
  if staff_punishments(cy, 7) is distinct from 2 then raise exception 'a filed backfire did not count: %', staff_punishments(cy, 7); end if;
  -- A patrol visit still open counts (it will land unless it is talked down), so a cap cannot be passed by visits in flight.
  perform start_visit(posts[6], 'pt-m1', pg_temp.charge('patrol', posts[6]));
  if staff_punishments(cy, 7) is distinct from 3 then raise exception 'an open patrol visit did not count: %', staff_punishments(cy, 7); end if;
  -- One that ended any way but filed does not (an interception ends it).
  v := (start_visit(posts[7], 'pt-m1', pg_temp.charge('patrol', posts[7])) ->> 'visit')::uuid;
  perform end_visit(v, 'reversed', null, 'Reversed.');
  if staff_punishments(cy, 7) is distinct from 3 then raise exception 'a reversed patrol visit counted: %', staff_punishments(cy, 7); end if;
  -- It is the character's own: another mask has none. And the window: none lands before "now" for a window of no days.
  if staff_punishments(ann, 7) is distinct from 0 then raise exception 'another character''s punishments counted'; end if;
  if staff_punishments(cy, 0) is distinct from 0 then raise exception 'a window of no days counted punishments'; end if;
  -- Nothing reads an owner: the function takes a character and answers a number.
  if staff_punishments(gen_random_uuid(), 7) is distinct from 0 then raise exception 'an unknown character has punishments'; end if;
  update settings set value = jsonb_set(value, '{cap,punishments}', '3') where key = 'modBots';
end $$;

-- ---- 6. The cap: past cap.punishments in cap.days, a patrol's visit is refused and the drop is recorded; the other causes are not ----
do $$
declare
  general uuid := pg_temp.board('pt-general');
  bob uuid := pg_temp.char('Pt Bob');
  m bigint := (begin_meeting('2031-02-05T09:00:00Z') ->> 'meeting')::bigint;
  pid bigint;
  t uuid;
  posts uuid[] := '{}';
  i integer;
  got jsonb;
  acts_before bigint;
begin
  perform apply_meeting(m, pg_temp.payload(jsonb_build_array(jsonb_build_object('mod', 'pt-m1', 'at', clock_timestamp()))));
  select id into pid from patrols where meeting = m and n = 1;
  insert into threads (board, title) values (general, 'The cap') returning id into t;
  for i in 1..8 loop posts := posts || tests.post(bob, t, 'Bob post ' || i, clock_timestamp()); end loop;
  -- Bob already has two punishments chosen by staff, so a third patrol visit lands, and a fourth is refused.
  perform pg_temp.filed('patrol', posts[1], pid);
  perform pg_temp.filed('backfire', posts[2]);
  got := start_visit(posts[3], 'pt-m1', pg_temp.charge('patrol', posts[3], 'minor', pid));
  if got ->> 'visit' is null then raise exception 'a patrol visit under the cap was refused: %', got; end if;
  if (select dropped from patrols where id = pid) is distinct from '[]'::jsonb then raise exception 'a visit under the cap was recorded as dropped'; end if;
  acts_before := (select count(*) from acts where kind = 'visit');
  got := start_visit(posts[4], 'pt-m1', pg_temp.charge('patrol', posts[4], 'severe', pid));
  if got ->> 'visit' is not null or (got ->> 'capped')::boolean is distinct from true then raise exception 'a patrol visit past the cap was not refused: %', got; end if;
  if (select count(*) from acts where kind = 'visit') is distinct from acts_before then raise exception 'a refused patrol visit wrote an Act'; end if;
  if (select jsonb_array_length(dropped) from patrols where id = pid) is distinct from 1
     or (select dropped -> 0 ->> 'post' from patrols where id = pid) is distinct from posts[4]::text
     or (select dropped -> 0 ->> 'why' from patrols where id = pid) is distinct from 'cap' then
    raise exception 'the drop is not recorded on the patrol: %', (select dropped from patrols where id = pid);
  end if;
  -- The same refusal again records once more only for another post; a retry on the same post records it once.
  got := start_visit(posts[4], 'pt-m1', pg_temp.charge('patrol', posts[4], 'severe', pid));
  if (select jsonb_array_length(dropped) from patrols where id = pid) is distinct from 1 then raise exception 'a retried drop was recorded twice: %', (select dropped from patrols where id = pid); end if;
  -- A rule's visit, a player's report and a tail still start at the cap, and a backfire too: only a patrol's choice is refused.
  if start_visit(posts[5], 'pt-m1', pg_temp.charge('rule', posts[5])) ->> 'visit' is null then raise exception 'a rule break was refused by the cap'; end if;
  if start_visit(posts[6], 'pt-m1', pg_temp.charge('report', posts[6])) ->> 'visit' is null then raise exception 'a report''s visit was refused by the cap'; end if;
  if start_visit(posts[7], 'pt-m1', pg_temp.charge('tail', posts[7])) ->> 'visit' is null then raise exception 'a tail''s visit was refused by the cap'; end if;
  if start_visit(posts[8], 'pt-m1', pg_temp.charge('backfire', posts[8])) ->> 'visit' is null then raise exception 'a backfire visit was refused by the cap'; end if;
  -- A patrol visit with no patrol named is still held to the cap (nothing to record on).
  got := start_visit(posts[4], 'pt-m1', pg_temp.charge('patrol', posts[4]));
  if got ->> 'visit' is not null then raise exception 'an unnamed patrol visit passed the cap'; end if;
  -- The cap is the instance's setting: raised, the visit starts.
  update settings set value = jsonb_set(value, '{cap,punishments}', '20') where key = 'modBots';
  got := start_visit(posts[4], 'pt-m1', pg_temp.charge('patrol', posts[4], 'minor', pid));
  if got ->> 'visit' is null then raise exception 'the cap did not follow the setting: %', got; end if;
end $$;

-- ---- 7. The doors ----
do $$
declare
  fn text;
begin
  foreach fn in array array['claim_patrol()', 'patrol_record(bigint, uuid[], jsonb)', 'record_patrol_call(bigint, text, jsonb)', 'staff_punishments(uuid, integer)', 'patrol_sample(uuid[], integer)', 'board_premises(uuid[])'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then raise exception '% is a client''s', fn; end if;
    if not has_function_privilege('service_role', fn, 'execute') then raise exception '% is not the service''s', fn; end if;
  end loop;
  if has_table_privilege('anon', 'patrols', 'select') or has_table_privilege('authenticated', 'patrols', 'select,insert,update,delete') then raise exception 'a client reaches the patrols'; end if;
  if not (select relrowsecurity from pg_class where oid = 'patrols'::regclass) then raise exception 'patrols has no row-level security'; end if;
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'patrol_sample(uuid[], integer)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'patrol_sample is not owned by the digest role'; end if;
end $$;
