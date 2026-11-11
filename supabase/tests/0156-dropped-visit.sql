-- A dropped visit (supabase/migrations/0150_dropped_visit.sql; docs/plans/2026-11-11-plain-words-plan.md, Task 6).
--
-- A visit that cannot be filed after ten tries ends `dropped` with the stock line (it ended `reversed` before, which read as an admin's act); end_visit and the visit_end
-- payload take five outcomes and refuse a sixth; and a charge on a dropped visit matches as one on a reversed visit did, so the rule can be charged again.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

-- A setRule move in force, as the tick will have landed it.
create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'vs-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

-- A player says something through the real post(), as the account that owns the character.
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

create function pg_temp.visit_of(post_act uuid) returns uuid language sql as $$
  select v.id from acts v where v.kind = 'visit' and v.target_act_id = post_act order by v.created_at, v.id limit 1
$$;

-- ---- 0. The world: a Boss, two Mods on staff (a quiz and a bribe), two players, the settings, two rules on General ----
do $$
declare
  seed jsonb;
  general uuid := (select id from boards where slug = 'general');
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'vs-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'vs-boss', 'name', 'Visit Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        -- Its hours (2 to 4) are clamped into the settings' 3 to 5: the window is 3 or 4 hours.
        jsonb_build_object('key', 'vs-m1', 'name', 'Visit Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 2, 'most', 4), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 3),
          'quiz', jsonb_build_array(
            jsonb_build_object('question', 'Which is first?', 'choices', jsonb_build_array('One', 'Two'), 'answer', 'One'),
            jsonb_build_object('question', 'Which is second?', 'choices', jsonb_build_array('One', 'Two'), 'answer', 'Two'),
            jsonb_build_object('question', 'Which is third?', 'choices', jsonb_build_array('Three', 'Four'), 'answer', 'Three'))),
        -- Its hours (6 to 9) are clamped to 5.
        jsonb_build_object('key', 'vs-m2', 'name', 'Visit Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 6, 'most', 9), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('vs-m1', 'vs-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  -- A reseed replaces a persona's traits, once.
  perform seed_instance(seed);
  if (select count(*) from staff_visit_traits where staff like 'vs-%') is distinct from 2 then raise exception 'the seed did not carry two personas'' traits once: %', (select count(*) from staff_visit_traits); end if;
  if (select (visit_least, visit_most, challenge)::text from staff_visit_traits where staff = 'vs-m1') is distinct from '(2,4,"{""kind"": ""quiz"", ""questions"": 3}")' then
    raise exception 'vs-m1''s traits are wrong: %', (select (visit_least, visit_most, challenge)::text from staff_visit_traits where staff = 'vs-m1');
  end if;
  -- A seed that carries a quiz answer is refused, and so is a challenge of no kind: answers are the interception's, and never here.
  if pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,1,challenge}', '{"kind": "quiz", "questions": 3, "answers": ["a"]}'))) is null then
    raise exception 'a seed that carries quiz answers was accepted';
  end if;
  if pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,1,challenge}', '{"kind": "riddle"}'))) is null then raise exception 'a challenge of no kind was accepted'; end if;
  if pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,1,visitHours}', '{"least": 5, "most": 2}'))) is null then raise exception 'visit hours that run backward were accepted'; end if;
  -- Two rules on General: no all-caps (Rule 1, minor) and the word frobnicate banned (Rule 2, severe).
  perform pg_temp.rule(general, 'noAllCaps', null, 'minor');
  perform pg_temp.rule(general, 'bannedWord', '"frobnicate"'::jsonb, 'severe');
  perform tests.account('vs-ann');
  perform tests.account('vs-bob');
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'vs-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'vs-bob@test.invalid' $$;


-- ---- 1. A visit that fails to file ten times ends dropped, with the line, and nothing lands on the author ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Doomed');
  t uuid := tests.thread('Doomed');
  p uuid := pg_temp.say(c, t, 'SHOUTING, FOREVER FAILING');
  v uuid := pg_temp.visit_of(p);
  page jsonb;
begin
  execute format($f$create function pg_temp.poison2() returns trigger language plpgsql as $b$ begin
    if new.payload ->> 'visit_act' = %L then raise exception 'a forever failing filing'; end if; return new; end $b$ $f$, v);
  create trigger vs_poison2 before insert on acts for each row when (new.kind = 'infraction') execute function pg_temp.poison2();
  update visits_open set ends_at = now() - interval '2 hours', attempts = 8 where visit_act = v;
  perform system_tick();
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) then raise exception 'a visit was dropped before the ceiling'; end if;
  perform system_tick();
  if not exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = v and e.payload ->> 'outcome' = 'dropped' and e.payload ->> 'line' = 'This visit could not be filed and was dropped.') then
    raise exception 'a visit that fails forever did not end dropped at the ceiling: %', (select payload from acts where kind = 'visit_end' and target_act_id = v);
  end if;
  if exists (select 1 from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text) or warn_points(c) is distinct from 0 then raise exception 'something landed on the author of a dropped visit'; end if;
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = p::text and e #>> '{end,outcome}' = 'dropped') then raise exception 'the post does not show its visit dropped'; end if;
  drop trigger vs_poison2 on acts;
end $$;

-- ---- 2. end_visit takes the five outcomes and refuses a sixth, naming all five ----
do $$
declare
  c uuid := tests.character(pg_temp.bob(), 'Vs Outcomes');
  t uuid := tests.thread('Outcomes');
  p uuid := pg_temp.say(c, t, 'SHOUTING, TO BE ENDED');
  v uuid := pg_temp.visit_of(p);
  said text;
begin
  said := pg_temp.refusal(format('select end_visit(%L, ''vanished'', null, ''x'')', v));
  if said is null then raise exception 'end_visit took an outcome outside the five'; end if;
  if said not like '%filed, intercepted, trapped, reversed or dropped%' then raise exception 'the refusal does not name all five outcomes: %', said; end if;
  if (end_visit(v, 'dropped', null, 'Dropped.') ->> 'ended')::boolean is not true then raise exception 'end_visit refused dropped'; end if;
  if (select payload ->> 'outcome' from acts where kind = 'visit_end' and target_act_id = v) is distinct from 'dropped' then raise exception 'the end did not say dropped'; end if;
end $$;

-- ---- 3. A charge on a dropped visit matches as one on a reversed visit did: the rule can be charged again ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Dropped');
  t uuid := tests.thread('Dropped');
  p uuid := tests.post(c, t, 'A quiet post, dropped and charged again.');
  a jsonb := jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts');
  v uuid := (start_visit(p, 'vs-m1', a) ->> 'visit')::uuid;
  got jsonb;
begin
  if (select count(*) from visit_charge_matches(p, a)) is distinct from 1 then raise exception 'an open visit''s charge did not match'; end if;
  perform end_visit(v, 'dropped', null, 'Dropped.');
  if exists (select 1 from visit_charge_matches(p, a)) then raise exception 'a dropped visit''s charge still matched'; end if;
  got := start_visit(p, 'vs-m1', a);
  if got ->> 'visit' is null or (got ->> 'visit')::uuid = v then raise exception 'a dropped visit barred the rule from being charged again: %', got; end if;
end $$;

-- ---- 4. A Mod's log says dropped for an end the tick wrote before `dropped` existed (reversed, no by_act), and keeps reversed for one an Act ended ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Old Shape');
  t uuid := tests.thread('Old shape');
  p1 uuid := pg_temp.say(c, t, 'SHOUTING, OLD SHAPE ONE');
  p2 uuid := pg_temp.say(c, t, 'SHOUTING, OLD SHAPE TWO');
  v1 uuid := pg_temp.visit_of(p1);
  v2 uuid := pg_temp.visit_of(p2);
begin
  -- Written as an old tick wrote it: the writer flag is the guard end_visit sets, and the payload is the old shape.
  perform set_config('kayfabb.visit_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'visit_end', t, v1, jsonb_build_object('visit_act', v1, 'outcome', 'reversed', 'line', 'This visit could not be filed and was dropped.'));
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'visit_end', t, v2, jsonb_build_object('visit_act', v2, 'outcome', 'reversed', 'by_act', p1, 'line', 'An admin ended it.'));
  perform set_config('kayfabb.visit_writer', '', true);
  if (select ended_why from moves_log where id = v1) is distinct from 'dropped' then raise exception 'the log did not read the old dropped shape as dropped: %', (select ended_why from moves_log where id = v1); end if;
  if (select ended_why from moves_log where id = v2) is distinct from 'reversed' then raise exception 'the log did not keep reversed for an end with a by_act: %', (select ended_why from moves_log where id = v2); end if;
end $$;
