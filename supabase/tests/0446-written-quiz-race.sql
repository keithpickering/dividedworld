-- A visit's question written by two writers at once (supabase/migrations/0446_written_quiz.sql, write_visit_quiz; docs/plans/2026-11-22-written-quiz-plan.md, Task 1 and "Review focus").
-- A race, so it commits through dblink on purpose (the way 0445-owed-lines-race.sql does), and its world is committed first.
-- The staff run's write and the tick's, at once: one row stands, one writer is told it wrote it (`written` true), the other is told it did not and is handed the standing row.

do $$
begin
  perform tests.commit($sql$
    do $w$
    declare
      seed jsonb;
      u uuid;
      c uuid;
      t uuid;
      p uuid;
    begin
      seed := jsonb_build_object(
        'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
          'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
          'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
            'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
            'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15),
          'systemLines', jsonb_build_object('visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.')),
          'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
        'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'wr-boss',
          'staff', jsonb_build_array(
            jsonb_build_object('key', 'wr-boss', 'name', 'Race Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
            jsonb_build_object('key', 'wr-m1', 'name', 'Race Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 1),
              'quiz', jsonb_build_array(jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone'), 'answer', 'Stone')))),
          'firstStaff', jsonb_build_array('wr-m1'),
          'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
          'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
          'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
      perform seed_instance(seed);
      u := tests.account('wr-bob');
      c := tests.character(u, 'Wr Bob A');
      t := tests.thread('Wr race');
      p := tests.post(c, t, 'A raced post.');
      perform start_visit(p, 'wr-m1', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts'));
      create table public.wr_answers (who text, written boolean, question text, source text);
    end $w$;
  $sql$);
end $$;

do $$
declare
  v uuid := (select a.id from acts a where a.kind = 'visit');
  said text[];
  row visit_quizzes%rowtype;
begin
  if v is null or (select count(*) from visit_quizzes) <> 0 or (select quiz_at from visits_open where visit_act = v) is null then raise exception 'the race world has no pending quiz visit'; end if;
  said := tests.race_service(
    format($s$ insert into public.wr_answers select 'run', (w ->> 'written')::boolean, w ->> 'question', w ->> 'source' from (select write_visit_quiz(%L, 'model', 'Written by the run?', '["Yes", "No"]'::jsonb, 'Yes') as w) x $s$, v),
    format($s$ insert into public.wr_answers select 'tick', (w ->> 'written')::boolean, w ->> 'question', w ->> 'source' from (select write_visit_quiz(%L, 'bank', 'Written by the tick?', '["Maybe", "Perhaps"]'::jsonb, 'Maybe') as w) x $s$, v));
  if said[1] is not null or said[2] is not null then raise exception 'a racing write failed: %', said; end if;
  if (select count(*) from visit_quizzes where visit_act = v) is distinct from 1::bigint then raise exception 'two writers left % rows', (select count(*) from visit_quizzes where visit_act = v); end if;
  select * into row from visit_quizzes where visit_act = v;
  if (select count(*) from wr_answers) is distinct from 2::bigint or (select count(*) from wr_answers where written) is distinct from 1::bigint then
    raise exception 'not exactly one writer was told it wrote the row: %', (select jsonb_agg(to_jsonb(a)) from wr_answers a);
  end if;
  if exists (select 1 from wr_answers a where a.question is distinct from row.question or a.source is distinct from row.source) then
    raise exception 'a writer was not handed the standing row: % vs %', (select jsonb_agg(to_jsonb(a)) from wr_answers a), to_jsonb(row);
  end if;
  if (select who from wr_answers where written) is distinct from (case row.source when 'model' then 'run' else 'tick' end) then raise exception 'the winner is not the row''s writer'; end if;
  if (select quiz_at from visits_open where visit_act = v) is not null then raise exception 'the raced visit is still marked pending'; end if;
end $$;
