-- A Mod writes its quiz question for each visit (supabase/migrations/0446_written_quiz.sql; docs/plans/2026-11-22-written-quiz-design.md, section 3; its plan, Task 1).
--
-- 1. A quiz visit opens with no row: visit_quiz answers {"pending": true}, intercept refuses a quiz answer with the pending message and writes nothing, and the same character can try again once a question is written.
-- 2. write_visit_quiz: visit_quiz answers the question and choices and never the answer or source; a right answer intercepts; a wrong one tails.
-- 3. A second write for the same visit writes nothing and answers the row that stands.
-- 4. The tick, with quizWriteMinutes = 15: a pending visit 14 minutes old stays pending; at 15 the bank row is written, with the switch on and off.
-- 5. A reseed that changes the persona's bank leaves a visit's row as it was.
-- 6. The backfill: a quiz visit opened before the migration has a bank row after it, open and ended alike.
-- 7. visit_quizzes refuses an update, a delete and a truncate; no client reads it; the reads are service-only.
-- 8. The modBots check refuses a missing or negative quizQuestionsPerDay and a quizWriteMinutes of 0, each naming the field.
-- Beside: pending_quizzes' shape and order, quiz_calls_today, and the duty quizQuestion on a call's record.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'wq-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'wq-bob@test.invalid' $$;
create function pg_temp.eve() returns uuid language sql as $$ select id from auth.users where email = 'wq-eve@test.invalid' $$;
create function pg_temp.chr(n text) returns uuid language sql as $$ select id from characters where name = n $$;

-- A visit by a Mod on a post, as the tick or a report would start it.
create function pg_temp.visit(p uuid, staff text) returns uuid language sql as $$
  select (start_visit(p, staff, jsonb_build_object('rule_number', 1, 'board', (select t.board from acts a join threads t on t.id = a.thread where a.id = p),
    'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid
$$;

-- An interception, as the account that owns the character.
create function pg_temp.try(through uuid, visit uuid, answer text default null) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  perform tests.become((select owner from characters where id = through));
  got := intercept(through, visit, answer);
  perform tests.unbecome();
  return got;
end $$;

create function pg_temp.tried(through uuid, visit uuid, answer text default null) returns text language plpgsql as $$
declare why text;
begin
  perform tests.become((select owner from characters where id = through));
  why := pg_temp.refusal(format('select intercept(%L, %L, %L)', through, visit, answer));
  perform tests.unbecome();
  return why;
end $$;

-- Makes a visit older by some minutes: its Act's time and the pending mark that copies it (a test stands the append-only trigger down for the one update, which a rollback gives back).
create function pg_temp.age(visit uuid, minutes integer) returns void language plpgsql as $$
begin
  alter table acts disable trigger acts_no_update;
  update acts set created_at = created_at - make_interval(mins => minutes) where id = visit;
  alter table acts enable always trigger acts_no_update;
  update visits_open set quiz_at = quiz_at - make_interval(mins => minutes) where visit_act = visit and quiz_at is not null;
end $$;

create function pg_temp.modbots(extra jsonb default '{}', minus text[] default '{}') returns jsonb language sql as $$
  select ((jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
    'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
    'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15)) || extra) - minus
$$;

-- ---- 8. The modBots check names the field it refuses (first: it needs no world) ----
do $$
declare
  why text;
begin
  if setting_modbots(pg_temp.modbots()) is not null then raise exception 'the good modBots was refused: %', setting_modbots(pg_temp.modbots()); end if;
  if setting_modbots(pg_temp.modbots('{"quizQuestionsPerDay": 0}')) is not null then raise exception 'a quizQuestionsPerDay of 0 (the bank always) was refused'; end if;
  if setting_modbots(pg_temp.modbots('{"quizWriteMinutes": 1}')) is not null then raise exception 'a quizWriteMinutes of 1 was refused'; end if;
  why := setting_modbots(pg_temp.modbots(minus => array['quizQuestionsPerDay']));
  if why is null or why !~ '"quizQuestionsPerDay" is not' then raise exception 'a missing quizQuestionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"quizQuestionsPerDay": -1}'));
  if why is null or why !~ '"quizQuestionsPerDay" is not' then raise exception 'a negative quizQuestionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"quizQuestionsPerDay": 1.5}'));
  if why is null or why !~ '"quizQuestionsPerDay" is not' then raise exception 'a fractional quizQuestionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots(minus => array['quizWriteMinutes']));
  if why is null or why !~ '"quizWriteMinutes" is not' then raise exception 'a missing quizWriteMinutes was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"quizWriteMinutes": 0}'));
  if why is null or why !~ '"quizWriteMinutes" is not' then raise exception 'a quizWriteMinutes of 0 was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"quizWriteMinutes": "15"}'));
  if why is null or why !~ '"quizWriteMinutes" is not' then raise exception 'a string quizWriteMinutes was not refused by name: %', why; end if;
end $$;

-- ---- 0. The world: a Boss, a quiz Mod and three players ----
create function pg_temp.seed(first_question text) returns jsonb language sql as $$
  select jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', pg_temp.modbots(),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'wq-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'wq-boss', 'name', 'Quiz Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'wq-m1', 'name', 'Quiz Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 2),
          'quiz', jsonb_build_array(
            jsonb_build_object('question', first_question, 'choices', jsonb_build_array('Moss', 'Stone', 'Dust'), 'answer', 'Stone'),
            jsonb_build_object('question', 'Which is the loudest?', 'choices', jsonb_build_array('Drum', 'Mouse'), 'answer', 'Drum')))),
      'firstStaff', jsonb_build_array('wq-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))))
$$;

do $$
begin
  perform seed_instance(pg_temp.seed('Which is the oldest?'));
  perform tests.account('wq-ann');
  perform tests.account('wq-bob');
  perform tests.account('wq-eve');
  insert into wallets (account, balance) values (pg_temp.ann(), 500), (pg_temp.bob(), 500), (pg_temp.eve(), 10);
  perform tests.character(pg_temp.bob(), 'Wq Bob A');
  perform tests.character(pg_temp.ann(), 'Wq Ann A');
  perform tests.character(pg_temp.eve(), 'Wq Eve A');
end $$;

-- ---- 1. A quiz visit opens pending; intercept refuses and spends nothing; the same character tries again once the question is written ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  ann uuid := pg_temp.chr('Wq Ann A');
  t uuid := tests.thread('Wq pending');
  p uuid := tests.post(author, t, 'A quiet post.');
  v uuid := pg_temp.visit(p, 'wq-m1');
  why text;
  n_acts bigint := (select count(*) from acts where kind = 'intercept');
  n_tails bigint := (select count(*) from tails);
  w0 integer := (select balance from wallets where account = pg_temp.ann());
  got jsonb;
  page jsonb;
begin
  if (select quiz_at from visits_open where visit_act = v) is distinct from (select created_at from acts where id = v) then
    raise exception 'a quiz visit with no row is not marked pending on its open row';
  end if;
  perform tests.become(pg_temp.ann());
  if visit_quiz(v) is distinct from '{"pending": true}'::jsonb then raise exception 'a visit with no row did not answer pending: %', visit_quiz(v); end if;
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if (select e #> '{challenge,pending}' from jsonb_array_elements(page -> 'visits') e where e ->> 'visit' = v::text) is distinct from 'true'::jsonb
     or (select e #> '{challenge,question}' from jsonb_array_elements(page -> 'visits') e where e ->> 'visit' = v::text) is not null then
    raise exception 'the page does not show a pending quiz as pending: %', page -> 'visits';
  end if;
  why := pg_temp.tried(ann, v, 'Stone');
  if why is distinct from '55000: the question is still being written; try again in a few minutes' then raise exception 'a quiz answer on a pending visit was not refused with the message: %', why; end if;
  -- The same words for a wrong, an empty and a made-up answer: nothing about the question leaks while there is none.
  if pg_temp.tried(ann, v, 'Nonsense') is distinct from why or pg_temp.tried(ann, v, null) is distinct from why then raise exception 'the pending refusal differs by answer'; end if;
  if (select count(*) from acts where kind = 'intercept') is distinct from n_acts or (select count(*) from tails) is distinct from n_tails
     or (select balance from wallets where account = pg_temp.ann()) is distinct from w0 then
    raise exception 'a refused pending answer wrote an Act, a tail or moved a wallet';
  end if;
  -- The question arrives; the same character tries again, and the one try is still theirs.
  perform write_visit_quiz(v, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  got := pg_temp.try(ann, v, 'Dust');
  if (got ->> 'succeeded')::boolean is distinct from false then raise exception 'the retried answer was not a wrong answer: %', got; end if;
  if (select count(*) from tails where character = ann and staff = 'wq-m1') is distinct from 1::bigint then raise exception 'the retried wrong answer did not tail'; end if;
end $$;

-- ---- 2. A written question: shown without its answer; right ends the visit; wrong tails ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  ann uuid := pg_temp.chr('Wq Ann A');
  eve uuid := pg_temp.chr('Wq Eve A');
  t uuid := tests.thread('Wq written');
  p1 uuid := tests.post(author, t, 'One quiet post.');
  p2 uuid := tests.post(author, t, 'Another quiet post.');
  v1 uuid := pg_temp.visit(p1, 'wq-m1');
  v2 uuid := pg_temp.visit(p2, 'wq-m1');
  made jsonb;
  seen jsonb;
  page jsonb;
  got jsonb;
begin
  made := write_visit_quiz(v1, 'model', 'Which wall is blue?', '["Red", "Blue", "Green"]'::jsonb, 'Blue');
  if (made ->> 'written')::boolean is not true or made ->> 'source' is distinct from 'model' then raise exception 'write_visit_quiz did not write: %', made; end if;
  if (select quiz_at from visits_open where visit_act = v1) is not null then raise exception 'a written quiz is still marked pending'; end if;
  perform tests.become(pg_temp.ann());
  seen := visit_quiz(v1);
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if seen is distinct from jsonb_build_object('question', 'Which wall is blue?', 'choices', '["Red", "Blue", "Green"]'::jsonb) then raise exception 'visit_quiz does not answer the written question: %', seen; end if;
  if seen::text ~* 'answer|source|pending' then raise exception 'visit_quiz leaks the answer or the source: %', seen; end if;
  if page::text ~* '"answer"' or page::text ~* '"source"' then raise exception 'thread_page carries an answer key or a source'; end if;
  if (select e #>> '{challenge,question}' from jsonb_array_elements(page -> 'visits') e where e ->> 'visit' = v1::text) is distinct from 'Which wall is blue?' then
    raise exception 'the page shows another question than the row''s';
  end if;
  -- A right answer intercepts.
  got := pg_temp.try(ann, v1, 'Blue');
  if (got ->> 'succeeded')::boolean is not true or (got ->> 'ended')::boolean is not true then raise exception 'a right answer did not intercept: %', got; end if;
  if not exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = v1 and e.payload ->> 'outcome' = 'intercepted') then raise exception 'a right answer did not end the visit'; end if;
  -- A wrong one tails, as today. An answer that is not one of the shown choices is refused, as today.
  perform write_visit_quiz(v2, 'bank', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  if pg_temp.tried(eve, v2, 'Pebble') !~ '^22023: pick one of the answers shown' then raise exception 'an answer outside the choices was not refused'; end if;
  got := pg_temp.try(eve, v2, 'Moss');
  if (got ->> 'succeeded')::boolean is not false then raise exception 'a wrong answer succeeded: %', got; end if;
  if (select count(*) from tails where character = eve) is distinct from 1::bigint then raise exception 'a wrong answer did not tail'; end if;
  if not exists (select 1 from visits_open where visit_act = v2) then raise exception 'a wrong answer ended the visit'; end if;
end $$;

-- ---- 3. A second write writes nothing and answers the row that stands ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  t uuid := tests.thread('Wq twice');
  v uuid := pg_temp.visit(tests.post(author, t, 'A twice post.'), 'wq-m1');
  first jsonb;
  second jsonb;
  not_quiz uuid := tests.post(author, t, 'Not a visit.');
begin
  first := write_visit_quiz(v, 'model', 'First question?', '["A", "B"]'::jsonb, 'A');
  second := write_visit_quiz(v, 'bank', 'Second question?', '["C", "D", "E"]'::jsonb, 'E');
  if (second ->> 'written')::boolean is not false then raise exception 'a second write claimed to write: %', second; end if;
  if second - 'written' is distinct from first - 'written' then raise exception 'the second write did not answer the standing row: % vs %', first, second; end if;
  if (select count(*) from visit_quizzes where visit_act = v) is distinct from 1::bigint or (select question from visit_quizzes where visit_act = v) is distinct from 'First question?' then
    raise exception 'the second write changed the row';
  end if;
  -- Refused: a post that is no visit; a bad shape (one choice, five, a repeat, an answer not among them, an empty question).
  if pg_temp.refusal(format('select write_visit_quiz(%L, ''bank'', ''Q?'', ''["A", "B"]''::jsonb, ''A'')', not_quiz)) !~ '^P0002: there is no such quiz visit' then raise exception 'a write for a post was not refused'; end if;
  if pg_temp.refusal(format('select write_visit_quiz(%L, ''bank'', ''Q?'', ''["A", "B"]''::jsonb, ''A'')', gen_random_uuid())) is null then raise exception 'a write for nothing was accepted'; end if;
  declare
    v3 uuid := pg_temp.visit(tests.post(author, t, 'A shape post.'), 'wq-m1');
  begin
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''model'', ''Q?'', ''["A"]''::jsonb, ''A'')', v3)) is null then raise exception 'one choice was accepted'; end if;
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''model'', ''Q?'', ''["A", "B", "C", "D", "E"]''::jsonb, ''A'')', v3)) is null then raise exception 'five choices were accepted'; end if;
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''model'', ''Q?'', ''["A", "A"]''::jsonb, ''A'')', v3)) is null then raise exception 'a repeated choice was accepted'; end if;
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''model'', ''Q?'', ''["A", "B"]''::jsonb, ''C'')', v3)) is null then raise exception 'an answer outside the choices was accepted'; end if;
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''model'', '' '', ''["A", "B"]''::jsonb, ''A'')', v3)) is null then raise exception 'an empty question was accepted'; end if;
    if pg_temp.refusal(format('select write_visit_quiz(%L, ''guess'', ''Q?'', ''["A", "B"]''::jsonb, ''A'')', v3)) is null then raise exception 'a source of guess was accepted'; end if;
    if exists (select 1 from visit_quizzes where visit_act = v3) then raise exception 'a refused write left a row'; end if;
  end;
end $$;

-- ---- 4. The tick falls back to the bank at quizWriteMinutes, with the switch on and with it off ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  t uuid := tests.thread('Wq tick');
  v_on uuid := pg_temp.visit(tests.post(author, t, 'A tick post on.'), 'wq-m1');
  v_off uuid := pg_temp.visit(tests.post(author, t, 'A tick post off.'), 'wq-m1');
  v_young uuid := pg_temp.visit(tests.post(author, t, 'A young post.'), 'wq-m1');
  tick jsonb;
  bank jsonb;
  row visit_quizzes%rowtype;
  was jsonb := (select value from settings where key = 'systemEnabled');
begin
  if (select (value ->> 'quizWriteMinutes')::integer from settings where key = 'modBots') is distinct from 15 then raise exception 'the world does not hold quizWriteMinutes = 15'; end if;
  perform pg_temp.age(v_on, 14);
  perform pg_temp.age(v_off, 14);
  tick := system_tick();
  if exists (select 1 from visit_quizzes where visit_act in (v_on, v_off, v_young)) then raise exception 'the tick wrote a question for a visit 14 minutes old'; end if;
  if (visit_quiz(v_on)) is distinct from '{"pending": true}'::jsonb then raise exception 'a visit 14 minutes old stopped being pending'; end if;
  -- At 15 minutes, with the switch on.
  perform pg_temp.age(v_on, 1);
  tick := system_tick();
  select * into row from visit_quizzes where visit_act = v_on;
  bank := bank_quiz_for(v_on);
  if row.visit_act is null or row.source is distinct from 'bank' or row.question is distinct from bank ->> 'question' or row.choices is distinct from bank -> 'choices' or row.answer is distinct from bank ->> 'answer' then
    raise exception 'the tick did not write the bank question at 15 minutes (switch on): % / %', to_jsonb(row), bank;
  end if;
  if (tick ->> 'quizzesBanked')::integer is distinct from 1 then raise exception 'the tick did not count the banked question: %', tick; end if;
  if exists (select 1 from visit_quizzes where visit_act in (v_off, v_young)) then raise exception 'the tick wrote a question for a visit that was not due'; end if;
  -- At 15 minutes, with the switch off.
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  perform pg_temp.age(v_off, 1);
  tick := system_tick();
  if (select source from visit_quizzes where visit_act = v_off) is distinct from 'bank' then raise exception 'the tick did not write the bank question with the switch off'; end if;
  update settings set value = was where key = 'systemEnabled';
  -- A question the staff run wrote first is left as it stands.
  perform pg_temp.age(v_young, 20);
  perform write_visit_quiz(v_young, 'model', 'A model question?', '["Yes", "No"]'::jsonb, 'Yes');
  tick := system_tick();
  if (select source from visit_quizzes where visit_act = v_young) is distinct from 'model' then raise exception 'the tick overwrote a model question'; end if;
  -- Nothing pending is left behind the tick.
  if exists (select 1 from visits_open where quiz_at is not null and quiz_at <= now() - interval '15 minutes') then raise exception 'a visit past its time is still pending after the tick'; end if;
end $$;

-- ---- 5. A reseed that changes the bank leaves a visit's row as it was ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  t uuid := tests.thread('Wq reseed');
  v uuid := pg_temp.visit(tests.post(author, t, 'A reseed post.'), 'wq-m1');
  before_row visit_quizzes%rowtype;
  idx integer := (select (payload #>> '{challenge,question_index}')::integer from acts where id = v);
begin
  perform pg_temp.age(v, 15);
  perform system_tick();
  select * into before_row from visit_quizzes where visit_act = v;
  if before_row.source is distinct from 'bank' then raise exception 'the world did not bank the visit: %', to_jsonb(before_row); end if;
  perform seed_instance(pg_temp.seed('Which is the very oldest of them all?'));
  if (select question from staff_quiz_questions where staff = 'wq-m1' and idx = 0) is distinct from 'Which is the very oldest of them all?' then raise exception 'the reseed did not change the bank'; end if;
  if (select to_jsonb(q) from visit_quizzes q where q.visit_act = v) is distinct from to_jsonb(before_row) then raise exception 'a reseed changed a visit''s row'; end if;
  perform tests.become(pg_temp.ann());
  if visit_quiz(v) is distinct from jsonb_build_object('question', before_row.question, 'choices', before_row.choices) then raise exception 'visit_quiz shows the reseeded bank for a banked visit'; end if;
  perform tests.unbecome();
  -- (Both of the bank's questions are used across the file's visits, so the draw of idx 0 is not assumed: the row equals the question the bank held when it was written.)
  if idx = 0 and before_row.question = 'Which is the very oldest of them all?' then raise exception 'the row holds the reseeded question'; end if;
end $$;

-- ---- 6. The backfill: a quiz visit opened before the migration has a bank row after it, open and ended alike ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  t uuid := tests.thread('Wq backfill');
  v_open uuid := pg_temp.visit(tests.post(author, t, 'A held open post.'), 'wq-m1');
  v_ended uuid := pg_temp.visit(tests.post(author, t, 'A held ended post.'), 'wq-m1');
  v_done uuid := pg_temp.visit(tests.post(author, t, 'A visit already banked.'), 'wq-m1');
  n integer;
  r visit_quizzes%rowtype;
  q staff_quiz_questions%rowtype;
begin
  -- Visits opened as they were before the migration: no row. (A new visit is pending, so these stand for them.)
  perform end_visit(v_ended, 'filed', null, 'Filed.');
  perform write_visit_quiz(v_done, 'model', 'Kept as written?', '["Yes", "No"]'::jsonb, 'Yes');
  if exists (select 1 from visit_quizzes where visit_act in (v_open, v_ended)) then raise exception 'the held visits already have rows'; end if;
  n := backfill_visit_quizzes();
  if n < 2 then raise exception 'the backfill wrote % rows, not at least 2', n; end if;
  for r in select * from visit_quizzes where visit_act in (v_open, v_ended) loop
    select * into q from staff_quiz_questions s where s.staff = 'wq-m1' and s.idx = (select (payload #>> '{challenge,question_index}')::integer from acts where id = r.visit_act);
    if r.source is distinct from 'bank' or r.question is distinct from q.question or r.choices is distinct from q.choices or r.answer is distinct from q.answer then
      raise exception 'the backfilled row is not the bank question: %', to_jsonb(r);
    end if;
  end loop;
  if (select count(*) from visit_quizzes where visit_act in (v_open, v_ended)) is distinct from 2::bigint then raise exception 'the backfill did not cover the open and the ended visit'; end if;
  if (select source from visit_quizzes where visit_act = v_done) is distinct from 'model' then raise exception 'the backfill touched a visit that had its row'; end if;
  if (select quiz_at from visits_open where visit_act = v_open) is not null then raise exception 'a backfilled open visit is still pending'; end if;
  if backfill_visit_quizzes() is distinct from 0 then raise exception 'the backfill is not idempotent'; end if;
  -- visit_quiz answers for the ended one, as before.
  if visit_quiz(v_ended) is distinct from jsonb_build_object('question', q.question, 'choices', q.choices) and visit_quiz(v_ended) ->> 'question' is null then raise exception 'visit_quiz does not answer for an ended visit'; end if;
end $$;

-- ---- 7. The table is append-only and no client's; the reads are the service's ----
do $$
declare
  v uuid := (select visit_act from visit_quizzes limit 1);
  why text;
begin
  why := pg_temp.refusal(format('update visit_quizzes set question = ''Changed?'' where visit_act = %L', v));
  if why is null or why !~ '^P0001: a visit''s question is never edited or removed' then raise exception 'an update was not refused: %', why; end if;
  why := pg_temp.refusal(format('delete from visit_quizzes where visit_act = %L', v));
  if why is null or why !~ '^P0001: a visit''s question is never edited or removed' then raise exception 'a delete was not refused: %', why; end if;
  why := pg_temp.refusal('truncate visit_quizzes');
  if why is null or why !~ '^P0001: a visit''s question is never edited or removed' then raise exception 'a truncate was not refused: %', why; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'visit_quizzes'::regclass) then raise exception 'visit_quizzes has no row security'; end if;
  if has_table_privilege('authenticated', 'visit_quizzes', 'select') or has_table_privilege('anon', 'visit_quizzes', 'select')
     or has_table_privilege('authenticated', 'visit_quizzes', 'insert') or has_table_privilege('anon', 'visit_quizzes', 'insert') then raise exception 'a client can touch visit_quizzes'; end if;
  perform tests.become(pg_temp.ann());
  why := pg_temp.refusal('select * from visit_quizzes');
  perform tests.unbecome();
  if why is null or why !~ '^42501' then raise exception 'a signed-in player read visit_quizzes: %', why; end if;
  -- The service-only functions.
  if has_function_privilege('authenticated', 'write_visit_quiz(uuid, text, text, jsonb, text)', 'execute') or has_function_privilege('anon', 'write_visit_quiz(uuid, text, text, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'bank_quiz_for(uuid)', 'execute') or has_function_privilege('authenticated', 'pending_quizzes(integer)', 'execute')
     or has_function_privilege('authenticated', 'quiz_calls_today()', 'execute') or has_function_privilege('authenticated', 'backfill_visit_quizzes()', 'execute') then
    raise exception 'a client can call a quiz writer or a staff read';
  end if;
  if not (has_function_privilege('service_role', 'write_visit_quiz(uuid, text, text, jsonb, text)', 'execute') and has_function_privilege('service_role', 'bank_quiz_for(uuid)', 'execute')
          and has_function_privilege('service_role', 'pending_quizzes(integer)', 'execute') and has_function_privilege('service_role', 'quiz_calls_today()', 'execute')) then
    raise exception 'the service cannot call a quiz function';
  end if;
  -- visit_quiz and intercept stay the players' doors.
  if not has_function_privilege('authenticated', 'intercept(uuid, uuid, text)', 'execute') then raise exception 'intercept is no longer a player''s door'; end if;
end $$;

-- ---- Beside: pending_quizzes, quiz_calls_today and the call's record ----
do $$
declare
  author uuid := pg_temp.chr('Wq Bob A');
  t uuid := tests.thread('Wq pending list');
  p1 uuid := tests.post(author, t, 'Pending one.');
  p2 uuid := tests.post(author, t, 'Pending two.');
  v1 uuid := pg_temp.visit(p1, 'wq-m1');
  v2 uuid := pg_temp.visit(p2, 'wq-m1');
  r record;
  n integer;
  c0 integer := quiz_calls_today();
begin
  perform pg_temp.age(v2, 5);
  perform pg_temp.age(v1, 2);
  select * into r from pending_quizzes(100) limit 1;
  if r.visit_act is distinct from v2 then raise exception 'pending_quizzes is not oldest first: %', r.visit_act; end if;
  if r.staff is distinct from 'wq-m1' or r.post_act is distinct from p2 or r.thread is distinct from t or r.board is distinct from (select board from threads where id = t)
     or r.board_name is null or jsonb_typeof(r.charges) is distinct from 'array' or jsonb_array_length(r.charges) < 1 or r.started_at is distinct from (select created_at from acts where id = v2) then
    raise exception 'pending_quizzes row is wrong: %', to_jsonb(r);
  end if;
  if (select count(*) from pending_quizzes(1)) is distinct from 1::bigint or (select count(*) from pending_quizzes(0)) is distinct from 0::bigint then raise exception 'pending_quizzes ignores its limit'; end if;
  perform write_visit_quiz(v2, 'model', 'Written?', '["Yes", "No"]'::jsonb, 'Yes');
  if exists (select 1 from pending_quizzes(100) x where x.visit_act = v2) or not exists (select 1 from pending_quizzes(100) x where x.visit_act = v1) then raise exception 'pending_quizzes lists a written quiz or misses a pending one'; end if;
  -- The ledger's quizQuestion calls today, and no other duty's.
  insert into model_calls (duty, staff, provider, model, cost_microdollars) values ('quizQuestion', 'wq-m1', 'fake', 'fake-light', 10), ('filing', 'wq-m1', 'fake', 'fake-light', 10);
  if quiz_calls_today() is distinct from c0 + 1 then raise exception 'quiz_calls_today counted % more, not 1', quiz_calls_today() - c0; end if;
  -- The duty is one a call's record may carry.
  n := (record_staff_call(v1, 'quizQuestion', 'wq-m1', '{"source": "bank", "why": "the call failed", "trims": [], "calls": 1}'::jsonb) ->> 'attempt')::integer;
  if n is distinct from 1 then raise exception 'the quizQuestion record was not the first attempt'; end if;
end $$;
