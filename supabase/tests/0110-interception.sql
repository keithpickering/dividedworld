-- Interception, tails and the visit trap (supabase/migrations/0108_interception.sql; the Mod Bots design, sections 6 and 7 and "What could slip a mask"; its plan, Task 9).
--
-- 1. The seed carries a quiz persona's questions, choices and answers to a table no client can read (staff_quiz_questions), and refuses a quiz that cannot be played.
-- 2. thread_page shows a visit's question and its choices, never which is right.
-- 3. intercept(through, visit, answer): a quiz answered right ends the visit (visit_end intercepted, by the intercept Act); answered wrong it tails the interceptor. One
--    attempt per character per visit; the author may intercept their own post's visit; a banned character is refused; a visit already over is refused.
-- 4. A bribe spends its price (wallet_events kind 'bribe') and ends the visit; a short wallet is refused before anything is written or spent.
-- 5. A visit that is talked down by a card, not an answer, is refused by intercept().
-- 6. A card Cast at thread reach ends the open visits of distraction-weak Mods on that thread, once per caster, and no other Mod's.
-- 7. A tail: the interceptor's next post draws a visit for Obstruction (minor, cause tail); the tail ends when that visit does, or by itself when its time is past,
--    whether or not its Mod is still on staff.
-- 8. A visit trap springs when a visit starts on its post and ends the visit (visit_end trapped, by the spring); the card checks accept a visit trigger.
-- 9. The doors: intercept is a player's, the tables are no client's, and no client can write an intercept.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'ic-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'ic-bob@test.invalid' $$;
create function pg_temp.eve() returns uuid language sql as $$ select id from auth.users where email = 'ic-eve@test.invalid' $$;
create function pg_temp.wallet(a uuid) returns integer language sql as $$ select coalesce((select balance from wallets where account = a), 0) $$;
create function pg_temp.chr(n text) returns uuid language sql as $$ select id from characters where name = n $$;

-- A player says something through the real post(), as the account that owns the character.
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

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

-- What the same call is refused with ('' if it was not), as the account that owns the character.
create function pg_temp.tried(through uuid, visit uuid, answer text default null) returns text language plpgsql as $$
declare why text;
begin
  perform tests.become((select owner from characters where id = through));
  why := pg_temp.refusal(format('select intercept(%L, %L, %L)', through, visit, answer));
  perform tests.unbecome();
  return why;
end $$;

-- The right choice of the question a quiz visit drew (what no client can read).
create function pg_temp.right(visit uuid) returns text language sql as $$
  select q.answer from acts v join characters m on m.id = v.character join staff_quiz_questions q on q.staff = m.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer where v.id = visit
$$;
create function pg_temp.wrong(visit uuid) returns text language sql as $$
  select c from acts v join characters m on m.id = v.character join staff_quiz_questions q on q.staff = m.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer,
    jsonb_array_elements_text(q.choices) c where v.id = visit and c <> q.answer order by c limit 1
$$;
create function pg_temp.end_of(visit uuid) returns acts language sql as $$ select e from acts e where e.kind = 'visit_end' and e.target_act_id = visit $$;

-- ---- 0a. Two posts by a tailed character at once draw one Obstruction visit between them, and spend the tail once (first: the committed rows must not meet this file's own locks) ----
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  p0 uuid := gen_random_uuid(); v0 uuid := gen_random_uuid(); i0 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); k uuid := gen_random_uuid();
  was jsonb := (select s.value from settings s where s.key = 'systemEnabled');
  said text[];
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
    insert into auth.users (id, email) values (%1$L, 'ic-race@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Ic Racer', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%3$L, 'Ic Race Mod', 'ic-race-mod', 'persona', now());
    insert into staff_offices (staff, office, cause) values ('ic-race-mod', 'mod', 'admin');
    insert into threads (id, board, title) select %4$L, b.id, 'Ic race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%5$L, %2$L, 'post', %4$L, '{"body": "An old post."}'), (%8$L, %2$L, 'post', %4$L, '{"body": "A racing post."}'), (%9$L, %2$L, 'post', %4$L, '{"body": "Another racing post."}');
    set kayfabb.staff_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%6$L, %3$L, 'visit', %4$L, %5$L, jsonb_build_object(
      'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = %4$L), 'band', 'minor', 'cause', 'patrol', 'about_act', %5$L::text)),
      'ends_at', now() + interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
    reset kayfabb.staff_writer;
    set kayfabb.intercept_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%7$L, %2$L, 'intercept', %4$L, %5$L, jsonb_build_object('visit_act', %6$L::text, 'kind', 'distraction', 'succeeded', false));
    reset kayfabb.intercept_writer;
    insert into tails (id, character, staff, intercept_act, until) values (%10$L, %2$L, 'ic-race-mod', %7$L, now() + interval '1 hour');
  $sql$, u, c, m, t, p0, v0, i0, p1, p2, k));
  said := tests.race_service(format('select draw_visits(%L)', p1), format('select draw_visits(%L)', p2));
  if said[1] is not null or said[2] is not null then raise exception 'a racing draw failed: %', said; end if;
  if (select count(*) from acts a where a.kind = 'visit' and a.target_act_id in (p1, p2)) is distinct from 1::bigint then
    raise exception 'two posts at once drew % Obstruction visits', (select count(*) from acts a where a.kind = 'visit' and a.target_act_id in (p1, p2));
  end if;
  if (select count(*) from tail_visits where tail = k) is distinct from 1::bigint then raise exception 'the tail was spent % times', (select count(*) from tail_visits where tail = k); end if;
  -- The racing Mod is put off the staff and the setting put back, so no later file finds either.
  perform tests.commit(format($sql$ insert into staff_offices (staff, office, cause) values ('ic-race-mod', 'benched', 'admin'); %s $sql$,
    case when was is null then 'delete from settings where key = ''systemEnabled'';' else format('update settings set value = %L where key = ''systemEnabled'';', was) end));
end $$;

-- ---- 0. The world: a Boss, three Mods (a quiz, a bribe, a distraction), three players ----
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
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ic-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ic-boss', 'name', 'Intercept Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ic-m1', 'name', 'Intercept Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 2),
          'quiz', jsonb_build_array(
            jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone', 'Dust'), 'answer', 'Stone'),
            jsonb_build_object('question', 'Which is the loudest?', 'choices', jsonb_build_array('Drum', 'Mouse'), 'answer', 'Drum'))),
        jsonb_build_object('key', 'ic-m2', 'name', 'Intercept Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'ic-m3', 'name', 'Intercept Mod Three', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'))),
      'firstStaff', jsonb_build_array('ic-m1', 'ic-m2', 'ic-m3'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  perform tests.account('ic-ann');
  perform tests.account('ic-bob');
  perform tests.account('ic-eve');
  insert into wallets (account, balance) values (pg_temp.ann(), 500), (pg_temp.bob(), 500), (pg_temp.eve(), 10);
  perform tests.character(pg_temp.bob(), 'Ic Bob A');
  perform tests.character(pg_temp.ann(), 'Ic Ann A');
  perform tests.character(pg_temp.ann(), 'Ic Ann B');
  perform tests.character(pg_temp.eve(), 'Ic Eve A');
  if beat_of(general) is null then raise exception 'the world: nobody is on the beat of General'; end if;
end $$;

-- ---- 1. The seed keeps the answers where no client can read them, and refuses a quiz that cannot be played ----
do $$
declare
  seed jsonb;
  why text;
begin
  if (select count(*) from staff_quiz_questions where staff = 'ic-m1') is distinct from 2::bigint then raise exception 'the seed did not carry the quiz''s two questions: %', (select count(*) from staff_quiz_questions); end if;
  if (select answer from staff_quiz_questions where staff = 'ic-m1' and idx = 0) is distinct from 'Stone' or (select choices from staff_quiz_questions where staff = 'ic-m1' and idx = 1) is distinct from '["Drum", "Mouse"]'::jsonb then
    raise exception 'the quiz is stored wrong: %', (select jsonb_agg(to_jsonb(q)) from staff_quiz_questions q);
  end if;
  if exists (select 1 from staff_visit_traits where challenge::text ~* 'answer|Stone') then raise exception 'an answer is in the traits'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'staff_quiz_questions'::regclass) then raise exception 'staff_quiz_questions has no row security'; end if;
  if has_table_privilege('authenticated', 'staff_quiz_questions', 'select') or has_table_privilege('anon', 'staff_quiz_questions', 'select') then raise exception 'a client can read the quiz''s answers'; end if;
  -- A reseed replaces the quiz, once.
  seed := (select jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'system', jsonb_build_object(
    'staff', jsonb_build_array(jsonb_build_object('key', 'ic-m1', 'name', 'Intercept Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
      'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 2),
      'quiz', jsonb_build_array(
        jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone', 'Dust'), 'answer', 'Stone'),
        jsonb_build_object('question', 'Which is the loudest?', 'choices', jsonb_build_array('Drum', 'Mouse'), 'answer', 'Drum')))))));
  perform seed_instance(seed);
  if (select count(*) from staff_quiz_questions where staff = 'ic-m1') is distinct from 2::bigint then raise exception 'a reseed doubled the quiz'; end if;
  -- Refused: the answer is not a choice; too few questions; no quiz for a quiz persona; a quiz for a bribe persona; a choice twice; a single choice.
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,quiz,0,answer}', '"Pebble"')));
  if why is null or why not like '%answer%' then raise exception 'an answer that is no choice was accepted: %', why; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,quiz}', (seed #> '{system,staff,0,quiz}') - 1)));
  if why is null then raise exception 'a quiz shorter than its challenge was accepted'; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0}', (seed #> '{system,staff,0}') - 'quiz')));
  if why is null then raise exception 'a quiz persona with no quiz was accepted'; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,challenge}', '{"kind": "bribe", "price": 5}')));
  if why is null then raise exception 'a quiz for a bribe persona was accepted'; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,quiz,0,choices}', '["Stone", "Stone"]')));
  if why is null then raise exception 'a choice twice was accepted'; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,quiz,1,choices}', '["Drum"]')));
  if why is null then raise exception 'a single choice was accepted'; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(jsonb_set(seed, '{system,staff,0,quiz,0,choices}', '["Moss", " Stone", "Dust"]'), '{system,staff,0,quiz,0,answer}', '" Stone"')));
  if why is null or why not like '%space%' then raise exception 'a choice with leading space was accepted: %', why; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,quiz,0,question}', '"Which is the oldest? "')));
  if why is null or why not like '%space%' then raise exception 'a question with trailing space was accepted: %', why; end if;
  if (select count(*) from staff_quiz_questions where staff = 'ic-m1') is distinct from 2::bigint then raise exception 'a refused seed changed the quiz'; end if;
end $$;

-- ---- 2. thread_page shows the question and its choices, never which is right ----
do $$
declare
  c uuid := pg_temp.chr('Ic Bob A');
  t uuid := tests.thread('Ic page');
  p uuid := tests.post(c, t, 'A quiet post.');
  v uuid := pg_temp.visit(p, 'ic-m1');
  page jsonb;
  seen jsonb;
  bribe_v uuid;
begin
  perform tests.become(pg_temp.ann());
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  seen := (select e from jsonb_array_elements(page -> 'visits') e where e ->> 'visit' = v::text);
  if seen #>> '{challenge,kind}' is distinct from 'quiz' or seen #>> '{challenge,question}' is null or jsonb_typeof(seen #> '{challenge,choices}') is distinct from 'array' then
    raise exception 'the page does not carry the quiz''s question and choices: %', seen -> 'challenge';
  end if;
  if (select q.question from staff_quiz_questions q where q.staff = 'ic-m1' and q.idx = (seen #>> '{challenge,question_index}')::integer) is distinct from seen #>> '{challenge,question}' then raise exception 'the page shows another question'; end if;
  if page::text ~* '"answer"' then raise exception 'thread_page carries an answer key'; end if;
  -- visit_quiz answers for a visit and nothing else: a post, a character or a made-up id gets nothing, so the bank cannot be walked.
  bribe_v := pg_temp.visit(tests.post(c, t, 'A bribe post.'), 'ic-m2');
  perform tests.become(pg_temp.ann());
  if visit_quiz(v) is distinct from jsonb_build_object('question', seen #>> '{challenge,question}', 'choices', seen #> '{challenge,choices}') then raise exception 'visit_quiz does not answer for its visit: %', visit_quiz(v); end if;
  if visit_quiz(p) is not null or visit_quiz(c) is not null or visit_quiz(gen_random_uuid()) is not null then raise exception 'visit_quiz answered for something that is no visit'; end if;
  if visit_quiz(bribe_v) is not null then raise exception 'visit_quiz answered for a visit that asks no question'; end if;
  perform tests.unbecome();
  if (seen #> '{challenge,choices}') is distinct from (select q.choices from staff_quiz_questions q where q.staff = 'ic-m1' and q.idx = (seen #>> '{challenge,question_index}')::integer) then raise exception 'the choices are not the question''s'; end if;
end $$;

-- ---- 3. A quiz: right ends the visit, wrong tails; one attempt per character; the author may intercept; a visit over is refused ----
do $$
declare
  author uuid := pg_temp.chr('Ic Bob A');
  ann_a uuid := pg_temp.chr('Ic Ann A');
  ann_b uuid := pg_temp.chr('Ic Ann B');
  eve uuid := pg_temp.chr('Ic Eve A');
  t uuid := tests.thread('Ic quiz');
  p uuid := tests.post(author, t, 'Another quiet post.');
  v uuid := pg_temp.visit(p, 'ic-m1');
  got jsonb;
  i acts%rowtype;
  e acts%rowtype;
  why text;
  n0 bigint := (select count(*) from acts where kind = 'intercept');
  seq0 integer := (select next_seq from threads where id = t);
begin
  -- A wrong answer: public, failed, and a tail on the interceptor for tailHours.
  got := pg_temp.try(ann_a, v, pg_temp.wrong(v));
  if (got ->> 'succeeded')::boolean is distinct from false then raise exception 'a wrong answer succeeded: %', got; end if;
  select * into i from acts where id = (got ->> 'intercept')::uuid;
  if i.kind is distinct from 'intercept' or i.character is distinct from ann_a or i.target_act_id is distinct from p or i.thread is distinct from t or i.seq is not null
     or i.payload ->> 'visit_act' is distinct from v::text or i.payload ->> 'kind' is distinct from 'quiz' or (i.payload ->> 'succeeded')::boolean is distinct from false then
    raise exception 'the failed interception Act is wrong: %', to_jsonb(i);
  end if;
  if not exists (select 1 from acts_public a where a.id = i.id) then raise exception 'an interception is not a public Act'; end if;
  if not exists (select 1 from visits_open where visit_act = v) or exists (select 1 from acts x where x.kind = 'visit_end' and x.target_act_id = v) then raise exception 'a wrong answer ended the visit'; end if;
  if (select count(*) from tails where character = ann_a and intercept_act = i.id and staff = 'ic-m1') is distinct from 1::bigint then raise exception 'a wrong answer did not tail the interceptor'; end if;
  if (select abs(extract(epoch from (t2.until - t2.created_at)) - 86400) from tails t2 where t2.intercept_act = i.id) > 5 then raise exception 'a tail is not modBots.tailHours long'; end if;
  if open_tail_staff(ann_a) is distinct from 'ic-m1' then raise exception 'the open tail is not found: %', open_tail_staff(ann_a); end if;
  if open_tail_staff(ann_b) is not null then raise exception 'a tail followed the account, not the character'; end if;
  -- One attempt per character, right or wrong; another mask of the same player may try.
  why := pg_temp.tried(ann_a, v, pg_temp.right(v));
  if why is null or why not like '%already tried%' then raise exception 'a second attempt by one character was not refused: %', why; end if;
  if (select count(*) from acts where kind = 'intercept') is distinct from n0 + 1 then raise exception 'a refusal wrote an Act'; end if;
  -- A character the caller does not play is refused like one that does not exist.
  perform tests.become(pg_temp.eve());
  why := pg_temp.refusal(format('select intercept(%L, %L, %L)', ann_b, v, 'x'));
  perform tests.unbecome();
  perform tests.become(pg_temp.eve());
  if why is null or why is distinct from pg_temp.refusal(format('select intercept(%L, %L, %L)', gen_random_uuid(), v, 'x')) then raise exception 'a character the caller does not play was not refused like one that does not exist: %', why; end if;
  perform tests.unbecome();
  -- The right answer, by the author of the post itself: the visit ends, by the interception.
  got := pg_temp.try(author, v, pg_temp.right(v));
  if (got ->> 'succeeded')::boolean is distinct from true then raise exception 'the right answer failed: %', got; end if;
  e := pg_temp.end_of(v);
  if e.payload ->> 'outcome' is distinct from 'intercepted' or e.payload ->> 'by_act' is distinct from got ->> 'intercept' then raise exception 'the visit did not end intercepted by the interception: %', e.payload; end if;
  if exists (select 1 from visits_open where visit_act = v) then raise exception 'an intercepted visit is still open'; end if;
  if (select count(*) from tails where character = author) is distinct from 0::bigint then raise exception 'a right answer tailed'; end if;
  -- Over: refused in the same words for everyone.
  why := pg_temp.tried(ann_b, v, pg_temp.right(v));
  if why is null or why not like '%over%' then raise exception 'a visit that is over took an attempt: %', why; end if;
  if pg_temp.tried(eve, v, pg_temp.right(v)) is distinct from why then raise exception 'the refusal differs by who asks'; end if;
  if (select next_seq from threads where id = t) is distinct from seq0 then raise exception 'an interception moved the thread''s seq'; end if;
  -- No answer, an answer on no visit.
  v := pg_temp.visit(tests.post(author, t, 'Yet another quiet post.'), 'ic-m1');
  if pg_temp.tried(eve, v, null) is null then raise exception 'a quiz with no answer was taken'; end if;
  if pg_temp.tried(eve, gen_random_uuid(), 'x') is null then raise exception 'a visit that is not there was taken'; end if;
  -- An answer that is none of the choices shown, or is far too long, is refused in the same plain words for everyone, and writes nothing.
  why := pg_temp.tried(eve, v, 'Pebble');
  if why is null or why not like '%pick one of the answers shown%' then raise exception 'an answer that is no choice was taken: %', why; end if;
  if pg_temp.tried(ann_b, v, 'Pebble') is distinct from why or pg_temp.tried(ann_b, v, repeat('x', 300)) is distinct from why or pg_temp.tried(eve, v, repeat('x', 300)) is distinct from why then
    raise exception 'the refusal of an answer that is no choice differs: %', why;
  end if;
  if exists (select 1 from acts x where x.kind = 'intercept' and x.payload ->> 'visit_act' = v::text) then
    raise exception 'a refused answer left something behind';
  end if;
  if (select count(*) from acts where kind = 'intercept') is distinct from n0 + 2 then raise exception 'a refusal wrote an Act'; end if;
end $$;

-- ---- 4. A bribe spends its price and ends the visit; a short wallet is refused before anything is written ----
do $$
declare
  author uuid := pg_temp.chr('Ic Bob A');
  ann_a uuid := pg_temp.chr('Ic Ann A');
  eve uuid := pg_temp.chr('Ic Eve A');
  t uuid := tests.thread('Ic bribe');
  p uuid := tests.post(author, t, 'A post to be bought off.');
  v uuid := pg_temp.visit(p, 'ic-m2');
  got jsonb;
  w0 integer := pg_temp.wallet(pg_temp.ann());
  n0 bigint := (select count(*) from acts where kind = 'intercept');
  e0 bigint := (select count(*) from wallet_events where kind = 'bribe');
  why text;
  ev wallet_events%rowtype;
begin
  why := pg_temp.tried(eve, v);
  if why is null or why not like '%costs 50%' then raise exception 'a short wallet was not refused: %', why; end if;
  if (select count(*) from acts where kind = 'intercept') is distinct from n0 or (select count(*) from wallet_events where kind = 'bribe') is distinct from e0
     or pg_temp.wallet(pg_temp.eve()) is distinct from 10 or not exists (select 1 from visits_open where visit_act = v) or exists (select 1 from tails where character = eve and created_at > now() - interval '1 minute') then
    raise exception 'a refused bribe left something behind';
  end if;
  got := pg_temp.try(ann_a, v);
  if (got ->> 'succeeded')::boolean is distinct from true then raise exception 'a bribe failed: %', got; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 50 then raise exception 'the bribe was not spent: % -> %', w0, pg_temp.wallet(pg_temp.ann()); end if;
  select * into ev from wallet_events where kind = 'bribe' and ref = (got ->> 'intercept')::uuid;
  if ev.change is distinct from -50 or ev.account is distinct from pg_temp.ann() then raise exception 'the wallet event is wrong: %', to_jsonb(ev); end if;
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' or (pg_temp.end_of(v)).payload ->> 'by_act' is distinct from got ->> 'intercept' then raise exception 'a bribe did not end the visit by the interception'; end if;
  if (select payload ->> 'kind' from acts where id = (got ->> 'intercept')::uuid) is distinct from 'bribe' then raise exception 'the intercept Act is not a bribe'; end if;
  -- The bribe goes nowhere: no wallet gained.
  if (select sum(change) from wallet_events where kind = 'bribe' and ref = (got ->> 'intercept')::uuid) is distinct from -50::bigint then raise exception 'a bribe was paid to someone'; end if;
end $$;

-- ---- 5. A banned character is refused; a visit that a card talks down takes no answer ----
do $$
declare
  eve uuid := pg_temp.chr('Ic Eve A');
  author uuid := pg_temp.chr('Ic Bob A');
  t uuid := tests.thread('Ic banned');
  p uuid := tests.post(author, t, 'A post.');
  v uuid := pg_temp.visit(p, 'ic-m2');
  d uuid := pg_temp.visit(tests.post(author, t, 'A post for a distraction.'), 'ic-m3');
  mine uuid;
  why text;
  n0 bigint := (select count(*) from acts where kind = 'intercept');
begin
  mine := tests.post(pg_temp.chr('Ic Ann B'), t, 'A post of Ann B''s.');
  perform infract(pg_temp.chr('Ic Ann B'), 'severe', mine, 'ic-m1');
  perform infract(pg_temp.chr('Ic Ann B'), 'severe', mine, 'ic-m1');
  perform infract(pg_temp.chr('Ic Ann B'), 'severe', mine, 'ic-m1');
  if banned_until(pg_temp.chr('Ic Ann B')) is null then raise exception 'the world: Ann B is not banned'; end if;
  why := pg_temp.tried(pg_temp.chr('Ic Ann B'), v);
  if why is null or why not like '%banned%' then raise exception 'a banned character intercepted: %', why; end if;
  why := pg_temp.tried(pg_temp.chr('Ic Ann A'), d, 'anything');
  if why is null or why not like '%card%' then raise exception 'a distraction-weak visit took an answer: %', why; end if;
  if (select count(*) from acts where kind = 'intercept') is distinct from n0 then raise exception 'a refusal wrote an Act'; end if;
end $$;

-- ---- 6. A card Cast at thread reach ends the distraction-weak visits on the thread, once per caster, and no other Mod's ----
do $$
declare
  author uuid := pg_temp.chr('Ic Bob A');
  caster uuid := pg_temp.chr('Ic Ann A');
  t uuid := tests.thread('Ic distraction');
  other uuid := tests.thread('Ic elsewhere');
  p1 uuid := tests.post(author, t, 'First post under a distractable Mod.');
  p2 uuid := tests.post(author, t, 'Second post under a quiz Mod.');
  p3 uuid := tests.post(author, t, 'Third post under a distractable Mod, quiet.');
  p4 uuid := tests.post(author, other, 'A post on another thread.');
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; vv uuid;
  played jsonb;
  tails0 bigint := (select count(*) from tails where character = pg_temp.chr('Ic Ann A'));
  i acts%rowtype;
  e acts%rowtype;
begin
  update settings set value = value || '{"ic.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, stack, ward, lasts, reaches, pins, trap)
    values ('ic-th', 'Ic Thread', 'sweet', 'ic.price', 'common', 'cast', 3, false, interval '1 day', '{thread}', false, null) on conflict (key) do nothing;
  v1 := pg_temp.visit(p1, 'ic-m3');
  v2 := pg_temp.visit(p2, 'ic-m1');
  v3 := pg_temp.visit(p3, 'ic-m3');
  v4 := pg_temp.visit(p4, 'ic-m3');
  played := place_cast(caster, 'ic-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  for vv in select x from unnest(array[v1, v3]) x loop
    e := pg_temp.end_of(vv);
    if e.payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'a distraction-weak visit on the thread was not ended: %', to_jsonb(e); end if;
    select * into i from acts where id = (e.payload ->> 'by_act')::uuid;
    if i.kind is distinct from 'intercept' or i.character is distinct from caster or i.payload ->> 'kind' is distinct from 'distraction' or (i.payload ->> 'succeeded')::boolean is distinct from true
       or i.payload ->> 'visit_act' is distinct from e.payload ->> 'visit_act' or i.thread is distinct from t then
      raise exception 'the distraction Act is wrong: %', to_jsonb(i);
    end if;
  end loop;
  if (pg_temp.end_of(v2)).id is not null then raise exception 'a quiz Mod''s visit was ended by a distraction'; end if;
  if (pg_temp.end_of(v4)).id is not null then raise exception 'a visit on another thread was ended'; end if;
  if (select count(*) from tails where character = caster) is distinct from tails0 then raise exception 'a distraction tailed'; end if;
  -- A second cast ends nothing more, and a visit that starts after it is not ended by the old card.
  perform place_cast(caster, 'ic-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  if (select count(*) from acts where kind = 'intercept' and character = caster and payload ->> 'kind' = 'distraction') is distinct from 2::bigint then raise exception 'a second cast wrote more attempts'; end if;
  -- Another caster ends a visit that started since: one per character per visit.
  v1 := pg_temp.visit(tests.post(author, t, 'Fourth post under a distractable Mod.'), 'ic-m3');
  perform place_cast(pg_temp.chr('Ic Eve A'), 'ic-th', t, '{}', '', 'thread', null, pg_temp.eve(), 0);
  if (pg_temp.end_of(v1)).id is null then raise exception 'a later cast by another character did not end the new visit'; end if;
  if (select count(*) from acts where kind = 'intercept' and payload ->> 'visit_act' = v1::text) is distinct from 1::bigint then raise exception 'one visit took two attempts from one cast'; end if;
end $$;

-- ---- 7. A tail: the next post draws Obstruction; the tail ends with that visit, or by itself, with its Mod gone or not ----
do $$
declare
  eve uuid := pg_temp.chr('Ic Eve A');
  author uuid := pg_temp.chr('Ic Bob A');
  t uuid := tests.thread('Ic tail');
  p0 uuid := tests.post(author, t, 'A post that is visited.');
  v0 uuid := pg_temp.visit(p0, 'ic-m1');
  got jsonb;
  p uuid;
  p2 uuid;
  v uuid;
  ch jsonb;
  who text;
begin
  got := pg_temp.try(eve, v0, pg_temp.wrong(v0));
  if (got ->> 'succeeded')::boolean is distinct from false then raise exception 'the world: eve was not tailed'; end if;
  if open_tail_staff(eve) is distinct from 'ic-m1' then raise exception 'eve is not tailed: %', open_tail_staff(eve); end if;
  -- Her next post draws a visit for Obstruction (minor, cause tail).
  p := pg_temp.say(eve, t, 'A perfectly quiet post by a tailed character.');
  v := (select a.id from acts a where a.kind = 'visit' and a.target_act_id = p);
  if v is null then raise exception 'a tailed character''s post drew no visit'; end if;
  ch := (select (a.payload -> 'charges' -> 0) from acts a where a.id = v);
  if ch ->> 'cause' is distinct from 'tail' or ch ->> 'band' is distinct from 'minor' or ch ->> 'rule' is distinct from 'Obstruction' or ch -> 'rule_number' is distinct from 'null'::jsonb then raise exception 'the tail''s charge is wrong: %', ch; end if;
  if (select c.staff from acts a join characters c on c.id = a.character where a.id = v) is distinct from 'ic-m1' then raise exception 'Obstruction was not drawn by the Mod the tail names'; end if;
  -- A tail draws exactly one visit: it is spent, and another post while that visit is open draws none.
  if open_tail_staff(eve) is not null then raise exception 'a tail that drew its visit is still open'; end if;
  p2 := pg_temp.say(eve, t, 'A second quiet post while the Obstruction visit is open.');
  if exists (select 1 from acts a where a.kind = 'visit' and a.target_act_id = p2) then raise exception 'a tail drew a second visit'; end if;
  -- The visit files: the tail is over, and her next post draws nothing.
  perform file_visit(v, null);
  if open_tail_staff(eve) is not null then raise exception 'a tail outlived the visit it drew'; end if;
  p := pg_temp.say(eve, t, 'Another quiet post, after the tail.');
  if exists (select 1 from acts a where a.kind = 'visit' and a.target_act_id = p) then raise exception 'a post after the tail drew a visit'; end if;
  if (select warn_points(eve)) is distinct from 2 then raise exception 'Obstruction did not land its points: %', warn_points(eve); end if;
end $$;

do $$
declare
  ann_b uuid := tests.character(pg_temp.bob(), 'Ic Bob B');
  eve uuid := pg_temp.chr('Ic Eve A');
  author uuid := pg_temp.chr('Ic Bob A');
  t uuid := tests.thread('Ic lapse');
  v0 uuid;
  v1 uuid;
  mine uuid;
  p uuid;
  v uuid;
  who text;
begin
  -- A tail runs out by itself. (Made as a failed interception would have: its Act, then its row.)
  perform set_config('kayfabb.intercept_writer', 'on', true);
  v0 := pg_temp.visit(tests.post(author, t, 'Old visit one.'), 'ic-m1');
  insert into acts (character, kind, thread, target_act_id, payload) select eve, 'intercept', t, a.target_act_id, jsonb_build_object('visit_act', v0, 'kind', 'quiz', 'answer', 'Dust', 'succeeded', false)
    from acts a where a.id = v0 returning id into mine;
  perform set_config('kayfabb.intercept_writer', '', true);
  -- The tail created two days ago for a day: lapsed. A tail's row is never edited, so the past one is written as such.
  insert into tails (character, staff, intercept_act, until, created_at) values (eve, 'ic-m1', mine, now() - interval '1 day', now() - interval '2 days');
  if open_tail_staff(eve) is not null then raise exception 'a tail whose time is past is open'; end if;
  p := pg_temp.say(eve, t, 'A post after a lapsed tail.');
  if exists (select 1 from acts a where a.kind = 'visit' and a.target_act_id = p) then raise exception 'a lapsed tail drew a visit'; end if;
  -- A tail whose Mod has been fired: it ends by itself at its time, and until then the Obstruction visit is drawn by whoever is on the beat, and files.
  perform set_config('kayfabb.intercept_writer', 'on', true);
  v1 := pg_temp.visit(tests.post(author, t, 'Old visit two.'), 'ic-m2');
  insert into acts (character, kind, thread, target_act_id, payload) select ann_b, 'intercept', t, a.target_act_id, jsonb_build_object('visit_act', v1, 'kind', 'bribe', 'succeeded', false)
    from acts a where a.id = v1 returning id into mine;
  perform set_config('kayfabb.intercept_writer', '', true);
  insert into tails (character, staff, intercept_act, until) values (ann_b, 'ic-m2', mine, now() + interval '1 hour');
  insert into staff_offices (staff, office, cause) values ('ic-m2', 'benched', 'admin');
  if open_tail_staff(ann_b) is distinct from 'ic-m2' then raise exception 'the open tail of a benched Mod is not found'; end if;
  p := pg_temp.say(ann_b, t, 'A post by a character tailed by a Mod who has gone.');
  v := (select a.id from acts a where a.kind = 'visit' and a.target_act_id = p);
  if v is null then raise exception 'a tail whose Mod was fired drew no visit while it was open'; end if;
  select c.staff into who from acts a join characters c on c.id = a.character where a.id = v;
  if who = 'ic-m2' or who is null then raise exception 'the benched Mod drew a visit: %', who; end if;
  perform file_visit(v, null);
  if open_tail_staff(ann_b) is not null then raise exception 'the fired Mod''s tail did not end with its visit'; end if;
  insert into staff_offices (staff, office, cause) values ('ic-m2', 'mod', 'admin');
end $$;

-- ---- 8. A visit trap springs when a visit starts on its post and ends it ----
do $$
declare
  c uuid := pg_temp.chr('Ic Ann A');
  t uuid := tests.thread('Ic trapped');
  p uuid := tests.post(c, t, 'A quiet post with a trap under it.');
  setting_ uuid;
  v jsonb;
  e acts%rowtype;
  why text;
begin
  update settings set value = value || '{"ic.trap": 25}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap, ward, lasts)
    values ('ic-trap', 'Ic Trap', 'pepperoni', 'ic.trap', 'common', 'set', '{"trigger": {"on": "visit"}}', false, null);
  setting_ := tests.act(c, 'set', t, '{}', p);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (setting_, pg_temp.ann(), 'ic-trap', p, t, 1, now() + interval '1 day');
  v := start_visit(p, 'ic-m1', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', p));
  if v -> 'sprung' is null then raise exception 'a visit did not spring the trap set on its post: %', v; end if;
  e := pg_temp.end_of((v ->> 'visit')::uuid);
  if e.payload ->> 'outcome' is distinct from 'trapped' or e.payload ->> 'by_act' is distinct from v #>> '{sprung,id}' then raise exception 'a sprung trap did not end the visit trapped by the spring: %', to_jsonb(e); end if;
  if exists (select 1 from visits_open where post = p) then raise exception 'a trapped visit is still open'; end if;
  if warn_points(c) is distinct from 0 then raise exception 'a trapped visit landed points'; end if;
  if not exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'trigger' = 'visit' and s.payload ->> 'set' = setting_::text) then raise exception 'there is no spring'; end if;
  -- The spring says what it did: the visit ended.
  if (select s.payload ->> 'did' from acts s where s.kind = 'spring' and s.payload ->> 'trigger' = 'visit' and s.payload ->> 'set' = setting_::text) is distinct from 'ended' then raise exception 'the spring does not say it ended the visit'; end if;
  -- The card checks accept a visit trigger, in the table, the seed's check and the function that names it.
  if card_kinds_problem('[{"key": "x", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "visit"}}}]') is not null then
    raise exception 'a visit trigger is refused: %', card_kinds_problem('[{"key": "x", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "visit"}}}]');
  end if;
  -- A reply or a reaction is no trigger a card carries any more (a Move springs on a quote, which is the engine's).
  if card_kinds_problem('[{"key": "x", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}}}]') is null then raise exception 'a reply trigger was accepted'; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('ic-trap2', 'Ic Trap Two', 'pepperoni', 'ic.trap', 'common', 'set', '{"trigger": {"on": "reaction"}}')$s$);
  if why is null then raise exception 'the table took a reaction trigger'; end if;
  if exists (select 1 from pg_proc where proname = 'visit_traps_wired') then raise exception 'the check that stood in for the wiring is still there'; end if;
end $$;

-- ---- 9. The doors ----
do $$
declare
  c uuid := pg_temp.chr('Ic Ann A');
  t uuid := tests.thread('Ic doors');
  p uuid := tests.post(pg_temp.chr('Ic Bob A'), t, 'A post.');
  v uuid := pg_temp.visit(p, 'ic-m1');
  why text;
begin
  if has_function_privilege('anon', 'intercept(uuid, uuid, text)', 'execute') then raise exception 'a visitor can intercept'; end if;
  if not has_function_privilege('authenticated', 'intercept(uuid, uuid, text)', 'execute') then raise exception 'a player cannot intercept'; end if;
  if has_table_privilege('authenticated', 'tails', 'select') or has_table_privilege('anon', 'tails', 'select') or has_table_privilege('authenticated', 'tail_visits', 'select') then raise exception 'a client can read the tails'; end if;
  if not (select c2.relrowsecurity from pg_class c2 where c2.oid = 'tails'::regclass) or not (select c2.relrowsecurity from pg_class c2 where c2.oid = 'tail_visits'::regclass) then raise exception 'a tails table has no row security'; end if;
  perform tests.become(pg_temp.ann());
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''intercept'', %L, %L, %L)', c, t, p,
    jsonb_build_object('visit_act', v, 'kind', 'quiz', 'answer', 'Stone', 'succeeded', true)));
  perform tests.unbecome();
  if why is null then raise exception 'a client wrote an intercept'; end if;
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''intercept'', %L, %L, %L)', c, t, p,
    jsonb_build_object('visit_act', v, 'kind', 'quiz', 'answer', 'Stone', 'succeeded', true)));
  if why is null or why not like '%only through%' then raise exception 'an intercept written past the function was not refused by the guard: %', why; end if;
  why := pg_temp.refusal(format('select intercept(%L, %L, %L)', c, v, 'Stone'));
  if why is null or why not like '%sign in%' then raise exception 'a call with no session was not refused: %', why; end if;
end $$;
