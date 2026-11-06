-- Visits (supabase/migrations/0103_visits.sql; the Mod Bots design, section 6; its plan, Task 6).
--
-- 1. The seed carries each persona's visit hours and challenge (staff_visit_traits), never a quiz answer.
-- 2. A post that breaks a rule in force goes up, and the board's beat Mod's visit starts on it (a `visit` Act). A rule never refuses a post: with no Mod on staff
--    no visit starts and the post is still up; a post by a staff character starts none; an edit starts none.
-- 3. A second charge on an open visit joins it (a `visit_join`), and the band is the highest; the same charge twice joins once.
-- 4. The window is the persona's hours clamped into modBots.visitHours, drawn by a hash of the post, so the same post draws the same window and challenge.
-- 5. The tick files an overdue visit (past ends_at + filingGraceMinutes) with the stock line; the points land once, by the highest band; a visit whose Mod has
--    left the staff files all the same.
-- 6. file_visit twice files once (and two sessions at once file once); a visit already ended returns its end.
-- 7. thread_page carries each post's visit with its charges and challenge, never an answer.

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

-- ---- 0a. Two sessions filing one visit at once file it once (first: the committed rows must not meet this file's own locks) ----
-- The Mod, the character, the post and the open visit are committed (a second session must read them); the two filings race on the visit's row.
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'vs-race@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Vs Racer', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%3$L, 'Vs Race Mod', 'vs-race-mod', 'persona', now());
    insert into threads (id, board, title) select %4$L, b.id, 'Vs race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%5$L, %2$L, 'post', %4$L, '{"body": "A racing post."}');
    set kayfabb.staff_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%6$L, %3$L, 'visit', %4$L, %5$L, jsonb_build_object(
      'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = %4$L), 'band', 'moderate', 'cause', 'patrol', 'about_act', %5$L::text)),
      'ends_at', now() - interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
    reset kayfabb.staff_writer;
  $sql$, u, c, m, t, p, v));
  said := tests.race_service(format('select file_visit(%L, ''One.'')', v), format('select file_visit(%L, ''Two.'')', v));
  if said[1] is not null or said[2] is not null then raise exception 'a racing filing failed: %', said; end if;
  if (select count(*) from acts where kind = 'visit_end' and target_act_id = v) is distinct from 1 then raise exception 'two sessions ended the visit % times', (select count(*) from acts where kind = 'visit_end' and target_act_id = v); end if;
  if (select count(*) from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text) is distinct from 1 then raise exception 'two sessions filed % infractions', (select count(*) from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text); end if;
  if warn_points(c) <> 4 then raise exception 'the racing filings moved the bar to %', warn_points(c); end if;
  perform tests.commit($sql$ delete from settings where key = 'warnBar' $sql$);
end $$;

-- ---- 0b. A join racing a filing never commits after the end: it waits for the filing, finds the visit ended and starts a fresh visit ----
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  tries integer := 0;
  got jsonb;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'vs-race2@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Vs Racer Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%3$L, 'Vs Race Mod Two', 'vs-race-mod2', 'persona', now());
    insert into threads (id, board, title) select %4$L, b.id, 'Vs race two' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%5$L, %2$L, 'post', %4$L, '{"body": "A racing post."}');
    set kayfabb.staff_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%6$L, %3$L, 'visit', %4$L, %5$L, jsonb_build_object(
      'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = %4$L), 'band', 'minor', 'cause', 'rule', 'about_act', %5$L::text)),
      'ends_at', now() + interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
    reset kayfabb.staff_writer;
  $sql$, u, c, m, t, p, v));
  perform extensions.dblink_connect('vj_h', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('vj_a', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('vj_h', 'begin');
  perform * from extensions.dblink('vj_h', format('select file_visit(%L, ''Filed.'')', v)) as x(r jsonb);
  perform extensions.dblink_send_query('vj_a', format('select /* vj_a */ start_visit(%L, ''vs-race-mod2'', %L::jsonb)', p,
    jsonb_build_object('rule_number', 2, 'board', (select board from threads where id = t), 'band', 'severe', 'cause', 'rule', 'about_act', p)));
  loop
    exit when exists (select 1 from pg_stat_activity a where a.query like '%/* vj_a */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock');
    tries := tries + 1;
    if tries > 400 then raise exception 'the join never waited on the filing'; end if;
    perform pg_sleep(0.025);
  end loop;
  perform extensions.dblink_exec('vj_h', 'commit');
  select r into got from extensions.dblink_get_result('vj_a') as x(r jsonb);
  perform extensions.dblink_disconnect('vj_h');
  perform extensions.dblink_disconnect('vj_a');
  if exists (select 1 from acts j where j.kind = 'visit_join' and j.target_act_id = v) then raise exception 'a join committed after the visit''s end (an orphan join)'; end if;
  if got ->> 'visit' is null or (got ->> 'visit')::uuid = v or (got ->> 'joined')::boolean then raise exception 'the waiting charge did not start a fresh visit: %', got; end if;
  if (select count(*) from visits_open where post = p) is distinct from 1 then raise exception 'the post should have exactly the fresh open visit'; end if;
  perform tests.commit($sql$ delete from settings where key = 'warnBar' $sql$);
end $$;

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

-- ---- 1. A breaking post goes up and starts a visit by the board's beat Mod; a clean one starts none; an edit starts none ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Shouter');
  t uuid := tests.thread('Visits');
  clean uuid := pg_temp.say(c, t, 'A perfectly quiet post.');
  loud uuid;
  v uuid;
  va acts%rowtype;
begin
  if pg_temp.visit_of(clean) is not null then raise exception 'a post that breaks nothing drew a visit'; end if;
  if not exists (select 1 from acts where id = clean and kind = 'post') then raise exception 'the clean post is missing'; end if;
  loud := pg_temp.say(c, t, 'THIS IS SHOUTED VERY LOUDLY');
  if not exists (select 1 from acts where id = loud and kind = 'post') then raise exception 'a breaking post did not go up: a rule never refuses a post'; end if;
  v := pg_temp.visit_of(loud);
  if v is null then raise exception 'a post that breaks Rule 1 drew no visit'; end if;
  select * into va from acts where id = v;
  if va.character is distinct from (select id from characters where staff = beat_of((select board from threads where id = t))) then raise exception 'the visit is not by the board''s beat Mod'; end if;
  if va.thread <> t or va.seq is not null then raise exception 'a visit sits in its post''s thread and takes no seq'; end if;
  if jsonb_array_length(va.payload -> 'charges') <> 1 or va.payload #>> '{charges,0,rule_number}' <> '1' or va.payload #>> '{charges,0,band}' <> 'minor'
     or va.payload #>> '{charges,0,cause}' <> 'rule' or (va.payload #>> '{charges,0,about_act}')::uuid <> loud then
    raise exception 'the visit''s charge is wrong: %', va.payload -> 'charges';
  end if;
  if va.payload #>> '{charges,0,rule}' is distinct from 'Rule 1: no all-caps posts' then raise exception 'the charge does not say its rule in words: %', va.payload #>> '{charges,0,rule}'; end if;
  if not exists (select 1 from visits_open o where o.visit_act = v and o.post = loud and o.ends_at = (va.payload ->> 'ends_at')::timestamptz) then raise exception 'the open visit has no row'; end if;
  if va.payload ->> 'line' is distinct from format('%s is looking at this post under Rule 1: no all-caps posts.', (select name from characters where id = va.character)) then
    raise exception 'the arrival line is not the stock line: %', va.payload ->> 'line';
  end if;
  -- Nothing about the owner: the visit and its charge name the post and the character only.
  if va.payload::text ~* (pg_temp.ann()::text) then raise exception 'a visit names an account'; end if;
  -- An edit is not checked: only a new post or a new thread is.
  perform tests.become(pg_temp.ann());
  perform edit_post(clean, c, 'AN EDITED POST, SHOUTED');
  perform tests.unbecome();
  if pg_temp.visit_of(clean) is not null then raise exception 'an edit drew a visit'; end if;
end $$;

-- ---- 2. Two rules broken at once: one visit, the second charge joins, and the band is the highest ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Double');
  t uuid := tests.thread('Joins');
  p uuid := pg_temp.say(c, t, 'FROBNICATE EVERYTHING');
  v uuid := pg_temp.visit_of(p);
  mod_ text;
  got jsonb;
begin
  if v is null then raise exception 'no visit'; end if;
  if (select count(*) from acts where kind = 'visit' and target_act_id = p) is distinct from 1 then raise exception 'two rules drew two visits on one post'; end if;
  if (select count(*) from acts where kind = 'visit_join' and target_act_id = v) is distinct from 1 then raise exception 'the second charge did not join: %', (select count(*) from acts where kind = 'visit_join' and target_act_id = v); end if;
  if (select count(*) from visits_open where post = p) is distinct from 1 then raise exception 'a post has more than one open visit'; end if;
  if (select j.payload ->> 'band' from acts j where j.kind = 'visit_join' and j.target_act_id = v) is distinct from 'severe' or (select j.payload #>> '{charge,rule_number}' from acts j where j.kind = 'visit_join' and j.target_act_id = v) is distinct from '2' then
    raise exception 'the join does not carry the severe Rule 2: %', (select j.payload from acts j where j.kind = 'visit_join' and j.target_act_id = v);
  end if;
  -- The same charge again joins nothing.
  mod_ := (select c2.staff from acts a join characters c2 on c2.id = a.character where a.id = v);
  got := start_visit(p, mod_, (select a.payload -> 'charges' -> 0 from acts a where a.id = v));
  if (select count(*) from acts where kind = 'visit_join' and target_act_id = v) is distinct from 1 then raise exception 'the same charge joined twice'; end if;
  -- Filing: one infraction, the highest band's points (severe: 7), carrying the highest band's rule.
  got := file_visit(v, null);
  if (select count(*) from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from 1 then raise exception 'filing did not write exactly one infraction'; end if;
  if (select i.payload ->> 'points' from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from '7' then raise exception 'the points are not the highest band''s'; end if;
  if (select i.payload ->> 'rule_number' from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from '2' then raise exception 'the infraction does not carry the highest band''s rule'; end if;
  if warn_points(c) <> 7 then raise exception 'the bar should hold 7, got %', warn_points(c); end if;
  if exists (select 1 from visits_open where post = p) then raise exception 'a filed visit is still open'; end if;
  -- A second filing is a no-op that returns the end.
  got := file_visit(v, 'Another line.');
  if (got ->> 'filed')::boolean is not false then raise exception 'a second filing says it filed: %', got; end if;
  if (select count(*) from acts where kind = 'visit_end' and target_act_id = v) is distinct from 1 then raise exception 'file_visit twice ended the visit twice'; end if;
  if (select count(*) from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from 1 then raise exception 'file_visit twice wrote two infractions'; end if;
  if warn_points(c) <> 7 then raise exception 'file_visit twice moved the bar'; end if;
  if (select payload ->> 'line' from acts where kind = 'visit_end' and target_act_id = v) not like '% filed this post under Rule 1: no all-caps posts; Rule 2: the word "frobnicate" is banned.' then
    raise exception 'the filing line is not the stock line filled with the charges: %', (select payload ->> 'line' from acts where kind = 'visit_end' and target_act_id = v);
  end if;
  if (select character from acts where kind = 'visit_end' and target_act_id = v) is not null or (select payload ->> 'outcome' from acts where kind = 'visit_end' and target_act_id = v) is distinct from 'filed' then
    raise exception 'a visit_end is of no character and says filed';
  end if;
  -- A visit_end is written only through end_visit.
  if pg_temp.refusal(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'visit_end', %L, %L, '{"visit_act": "%s", "outcome": "filed", "line": "x"}')$q$, t, v, v)) is null then
    raise exception 'a visit_end was written by hand';
  end if;
end $$;

-- ---- 3. The tick files an overdue visit with the stock line, and the points land; not before the grace is past ----
do $$
declare
  c uuid := tests.character(pg_temp.bob(), 'Vs Overdue');
  t uuid := tests.thread('Overdue');
  p uuid := pg_temp.say(c, t, 'SHOUTING ONCE MORE');
  v uuid := pg_temp.visit_of(p);
  ran jsonb;
begin
  if (select o.ends_at from visits_open o where o.visit_act = v) <= now() then raise exception 'a new visit is already over'; end if;
  ran := system_tick();
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) then raise exception 'the tick filed a visit that is not over'; end if;
  -- Over, but inside the grace: not yet.
  update visits_open set ends_at = now() - interval '5 minutes' where visit_act = v;
  ran := system_tick();
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) then raise exception 'the tick filed a visit inside its grace'; end if;
  -- The grace is the instance's setting, not a constant: at 30 minutes, 11 past the end is still inside it.
  update settings set value = jsonb_set(value, '{filingGraceMinutes}', '30') where key = 'modBots';
  update visits_open set ends_at = now() - interval '11 minutes' where visit_act = v;
  ran := system_tick();
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) then raise exception 'the tick ignored a filingGraceMinutes of 30'; end if;
  update settings set value = jsonb_set(value, '{filingGraceMinutes}', '10') where key = 'modBots';
  ran := system_tick();
  if not exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) then raise exception 'the tick did not file an overdue visit: %', ran; end if;
  if (ran ->> 'visits')::integer < 1 then raise exception 'the tick does not say it filed: %', ran; end if;
  if (select e.payload ->> 'line' from acts e where e.kind = 'visit_end' and e.target_act_id = v) is distinct from
     format('%s filed this post under Rule 1: no all-caps posts.', (select name from characters where id = (select character from acts where id = v))) then
    raise exception 'the tick did not use the stock line: %', (select e.payload ->> 'line' from acts e where e.kind = 'visit_end' and e.target_act_id = v);
  end if;
  if warn_points(c) <> 2 then raise exception 'a minor breach should leave 2 points, got %', warn_points(c); end if;
  ran := system_tick();
  if warn_points(c) <> 2 then raise exception 'a second tick filed again'; end if;
end $$;

-- ---- 4. The window stays inside the settings and is the same on a retry; the challenge is drawn the same way ----
do $$
declare
  c uuid := tests.character(pg_temp.bob(), 'Vs Windows');
  t uuid := tests.thread('Windows');
  p uuid;
  seen_one integer[] := '{}';
  h integer;
  q integer;
  qs integer[] := '{}';
begin
  for i in 1..40 loop
    p := tests.post(c, t, 'Quiet post number ' || i);
    h := extract(epoch from visit_window(p, 'vs-m1'))::integer / 3600;
    if h < 3 or h > 4 then raise exception 'vs-m1 (2 to 4 hours, settings 3 to 5) drew % hours', h; end if;
    if h <> extract(epoch from visit_window(p, 'vs-m1'))::integer / 3600 then raise exception 'a retry drew another window'; end if;
    seen_one := seen_one || h;
    h := extract(epoch from visit_window(p, 'vs-m2'))::integer / 3600;
    if h <> 5 then raise exception 'vs-m2 (6 to 9, settings 3 to 5) should draw 5, got %', h; end if;
    q := (visit_challenge(p, 'vs-m1') ->> 'question_index')::integer;
    if q is null or q not between 0 and 2 then raise exception 'the quiz question drawn is outside the 3: %', q; end if;
    if q is distinct from (visit_challenge(p, 'vs-m1') ->> 'question_index')::integer then raise exception 'a retry drew another question'; end if;
    qs := qs || q;
  end loop;
  if not (3 = any (seen_one) and 4 = any (seen_one)) then raise exception 'the window never varied across 40 posts: %', seen_one; end if;
  if array_length(array(select distinct x from unnest(qs) x), 1) < 2 then raise exception 'the quiz question never varied across 40 posts'; end if;
  if visit_challenge(p, 'vs-m2') is distinct from jsonb_build_object('kind', 'bribe', 'price', 50) then raise exception 'a bribe challenge is wrong: %', visit_challenge(p, 'vs-m2'); end if;
  -- The visit written for a post uses the same window and challenge.
  perform start_visit(p, 'vs-m1', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', p, 'predicate', 'noAllCaps', 'rule', 'Rule 1: no all-caps posts'));
  if (select (a.payload ->> 'ends_at')::timestamptz - a.created_at from acts a where a.kind = 'visit' and a.target_act_id = p) is distinct from visit_window(p, 'vs-m1') then
    raise exception 'start_visit did not use the drawn window';
  end if;
  if (select a.payload -> 'challenge' from acts a where a.kind = 'visit' and a.target_act_id = p) is distinct from visit_challenge(p, 'vs-m1') then raise exception 'start_visit did not use the drawn challenge'; end if;
end $$;

-- ---- 5. thread_page carries the visit with its charges and challenge, and never an answer ----
do $$
declare
  c uuid := tests.character(pg_temp.bob(), 'Vs Pager');
  t uuid := tests.thread('Paged');
  p uuid := pg_temp.say(c, t, 'FROBNICATE THE PAGE');
  v uuid := pg_temp.visit_of(p);
  page jsonb;
  seen jsonb;
begin
  perform tests.become(pg_temp.bob());
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  seen := (select e from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = p::text);
  if seen is null then raise exception 'the page does not carry the post''s visit: %', page -> 'visits'; end if;
  if seen ->> 'visit' <> v::text or jsonb_array_length(seen -> 'charges') <> 2 or seen #>> '{challenge,kind}' not in ('quiz', 'bribe', 'distraction') or seen -> 'end' <> 'null'::jsonb then
    raise exception 'the open visit is wrong on the page: %', seen;
  end if;
  if page::text ~* 'answer' then raise exception 'thread_page carries an answer: %', substring(page::text from '.{40}answer.{40}'); end if;
  if not exists (select 1 from jsonb_array_elements(page -> 'people') x where x #>> '{character,id}' = (select character from acts where id = v)::text) then raise exception 'the Mod is not among the page''s people'; end if;
  -- Filed, the page carries its end with the line.
  perform file_visit(v, 'Rule 2 was explained.');
  perform tests.become(pg_temp.bob());
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  seen := (select e from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = p::text);
  if seen #>> '{end,outcome}' <> 'filed' or seen #>> '{end,line}' <> 'Rule 2 was explained.' then raise exception 'a filed visit''s end is not on the page: %', seen; end if;
  if page::text ~* 'answer' then raise exception 'thread_page carries an answer once filed'; end if;
end $$;

-- ---- 6. A post by a staff character starts no visit ----
do $$
declare
  t uuid := tests.thread('Staff');
  sp uuid := (write_staff_act('vs-m2', 'post', t, null, '{"body": "A LOUD MOD POST, FROBNICATE"}') ->> 'id')::uuid;
begin
  perform draw_visits(sp);
  if pg_temp.visit_of(sp) is not null then raise exception 'a post by a staff character drew a visit'; end if;
  if start_visit(sp, 'vs-m1', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', sp)) is not null
     or pg_temp.visit_of(sp) is not null then
    raise exception 'start_visit visited a staff character''s post';
  end if;
end $$;

-- ---- 7. Ways out: a Mod that leaves the staff before it files still files by the tick, with the stock line ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Orphan');
  t uuid := tests.thread('Orphaned');
  p uuid := pg_temp.say(c, t, 'SHOUTING INTO THE VOID');
  v uuid := pg_temp.visit_of(p);
  mod_ text := (select c2.staff from acts a join characters c2 on c2.id = a.character where a.id = v);
  ran jsonb;
begin
  insert into staff_offices (staff, office, cause) values (mod_, 'benched', 'admin');
  update visits_open set ends_at = now() - interval '11 minutes' where visit_act = v;
  ran := system_tick();
  if not exists (select 1 from acts where kind = 'visit_end' and target_act_id = v and payload ->> 'outcome' = 'filed') then raise exception 'a visit whose Mod left the staff was never filed: %', ran; end if;
  if (select e.payload ->> 'line' from acts e where e.kind = 'visit_end' and e.target_act_id = v) not like '%filed this post under Rule 1%' then raise exception 'the orphaned visit did not file with the stock line'; end if;
  if (select i.payload ->> 'staff' from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from mod_ then raise exception 'the infraction does not name the Mod that visited'; end if;
  if warn_points(c) <> 2 then raise exception 'the points did not land'; end if;
  insert into staff_offices (staff, office, cause) values (mod_, 'mod', 'admin');
end $$;

-- ---- 8. With no Mod on staff the post still goes up and no visit starts ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Unwatched');
  t uuid := tests.thread('Unwatched');
  p uuid;
begin
  insert into staff_offices (staff, office, cause) values ('vs-m1', 'benched', 'admin'), ('vs-m2', 'benched', 'admin');
  if beat_of((select board from threads where id = t)) is not null then raise exception 'a Mod is still on staff'; end if;
  p := pg_temp.say(c, t, 'FROBNICATE WITH NOBODY WATCHING');
  if not exists (select 1 from acts where id = p and kind = 'post') then raise exception 'the post did not go up'; end if;
  if pg_temp.visit_of(p) is not null then raise exception 'a visit started with no Mod on staff'; end if;
  -- A new thread too.
  perform tests.become(pg_temp.ann());
  perform start_thread('general', c, 'Nobody watches', 'FROBNICATE STILL');
  perform tests.unbecome();
  if exists (select 1 from acts v where v.kind = 'visit' and v.target_act_id in (select id from acts where character = c and kind = 'post' and payload ->> 'body' = 'FROBNICATE STILL')) then
    raise exception 'a new thread drew a visit with no Mod on staff';
  end if;
  insert into staff_offices (staff, office, cause) values ('vs-m1', 'mod', 'admin'), ('vs-m2', 'mod', 'admin');
end $$;

-- ---- 9. A new thread's opening post is checked, and the tail hook is there and empty ----
do $$
declare
  c uuid := tests.character(pg_temp.bob(), 'Vs Opener');
  made jsonb;
  opener uuid;
begin
  if beat_of((select id from boards where slug = 'general')) is null then raise exception 'the Mods are not back'; end if;
  perform tests.become(pg_temp.bob());
  made := start_thread('general', c, 'A thread for shouting', 'OPENING WITH A SHOUT');
  perform tests.unbecome();
  opener := (made #>> '{act,id}')::uuid;
  if pg_temp.visit_of(opener) is null then raise exception 'a new thread''s opening post that breaks a rule drew no visit'; end if;
  if open_tail_staff(c) is not null then raise exception 'a character that failed no interception is under a tail'; end if;
end $$;

-- ---- 11. A trap set on a post springs when a visit starts on it (and the sprung trap ends the visit: 0108 shows it) ----
do $$
declare
  c uuid := tests.character(pg_temp.ann(), 'Vs Trapper');
  t uuid := tests.thread('Trapped');
  p uuid := tests.post(c, t, 'A quiet post with a trap under it.');
  setting_ uuid;
  v jsonb;
begin
  update settings set value = value || '{"bluffy.price": 25}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap, ward, lasts)
    values ('vs-trap', 'Vs Trap', 'pepperoni', 'bluffy.price', 'common', 'set', '{"trigger": {"on": "visit"}, "outcome": {"do": "nullify"}}', false, null) on conflict (key) do nothing;
  setting_ := tests.act(c, 'set', t, '{}', p);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (setting_, pg_temp.ann(), 'vs-trap', p, t, 1, now() + interval '1 day');
  v := start_visit(p, 'vs-m1', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', p));
  if v -> 'sprung' is null or not exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'trigger' = 'visit' and s.payload ->> 'set' = setting_::text) then
    raise exception 'a visit did not spring the trap set on its post: %', v;
  end if;
end $$;

-- ---- 12. A spin opener is checked like any post: too short, and a live title, each draw a visit that files an infraction ----
do $$
declare
  side uuid;
  c uuid := tests.character(tests.account('vs-cy'), 'Vs Spinner');
  t uuid;
  origin uuid;
  made jsonb;
  opener uuid;
  v uuid;
  page jsonb;
begin
  insert into boards (slug, name) values ('vs-side', 'Vs Side') returning id into side;
  insert into rule_predicates (key, param_kind, least, most, plain) values ('minLength', 'count', 1, 200, 'posts of at least {param} characters'), ('noDuplicateTitle', 'none', null, null, 'no duplicate thread titles')
    on conflict (key) do nothing;
  perform pg_temp.rule(side, 'minLength', '20'::jsonb, 'minor');
  perform pg_temp.rule(side, 'noDuplicateTitle', null, 'moderate');
  insert into threads (board, title) values (side, 'Vs live title') returning id into t;
  origin := tests.post(c, t, 'The origin post, long enough for anyone.');
  perform tests.become((select owner from characters where id = c));
  made := spin(origin, c, 'Vs fresh title', 'short');
  perform tests.unbecome();
  opener := (made #>> '{act,id}')::uuid;
  v := pg_temp.visit_of(opener);
  if v is null then raise exception 'a spin opener that breaks minLength drew no visit'; end if;
  perform file_visit(v, null);
  if (select i.payload ->> 'points' from acts i where i.kind = 'infraction' and i.payload ->> 'about_act' = opener::text) is distinct from '2' then raise exception 'the spin opener''s filing wrote no 2-point infraction'; end if;
  perform tests.become((select owner from characters where id = c));
  page := thread_page((made #>> '{thread,id}')::uuid, 1, null, 20, '{}');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = opener::text and e #>> '{end,outcome}' = 'filed') then raise exception 'thread_page does not carry a spin opener''s visit: %', page -> 'visits'; end if;
  -- A live title.
  perform tests.become((select owner from characters where id = c));
  made := spin(origin, c, 'Vs live title', 'A body that is long enough to pass.');
  perform tests.unbecome();
  opener := (made #>> '{act,id}')::uuid;
  v := pg_temp.visit_of(opener);
  if v is null or (select a.payload #>> '{charges,0,rule_number}' from acts a where a.id = v) is distinct from '2' then raise exception 'a spin opener with a live title drew no visit for Rule 2'; end if;
  perform file_visit(v, null);
  if (select i.payload ->> 'points' from acts i where i.kind = 'infraction' and i.payload ->> 'about_act' = opener::text) is distinct from '4' then raise exception 'the live-title infraction is not 4 points'; end if;
end $$;

-- ---- 13. Nothing starts while The System is off; a visit already open still files ----
do $$
declare
  c uuid := tests.character(tests.account('vs-di'), 'Vs Switch');
  t uuid := tests.thread('Switch');
  open_post uuid := pg_temp.say(c, t, 'SHOUTING BEFORE THE SWITCH');
  v uuid := pg_temp.visit_of(open_post);
  off_post uuid;
begin
  if v is null then raise exception 'no visit while The System is on'; end if;
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  off_post := pg_temp.say(c, t, 'SHOUTING AFTER THE SWITCH');
  if pg_temp.visit_of(off_post) is not null then raise exception 'a visit started while systemEnabled is false'; end if;
  update visits_open set ends_at = now() - interval '11 minutes' where visit_act = v;
  perform system_tick();
  if not exists (select 1 from acts where kind = 'visit_end' and target_act_id = v and payload ->> 'outcome' = 'filed') then raise exception 'an open visit was not filed with the switch off'; end if;
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
end $$;

-- ---- 14. The repeat path: one charge once; a reversed visit's rule can be charged again; premise charges are told apart by their words ----
do $$
declare
  c uuid := tests.character(tests.account('vs-ed'), 'Vs Repeat');
  t uuid := tests.thread('Repeat');
  p uuid := tests.post(c, t, 'A quiet post, charged by hand.');
  b uuid := (select board from threads where id = t);
  a jsonb := jsonb_build_object('rule_number', 1, 'board', b, 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts');
  got jsonb;
  v uuid;
begin
  got := start_visit(p, 'vs-m1', a);
  v := (got ->> 'visit')::uuid;
  got := start_visit(p, 'vs-m1', a);
  if (got ->> 'joined')::boolean is not false or (select count(*) from acts where kind = 'visit_join' and target_act_id = v) is distinct from 0 then raise exception 'the same rule twice made two charges: %', got; end if;
  -- Two different premise charges both land (the second joins), the same one twice does not.
  got := start_visit(p, 'vs-m1', jsonb_build_object('rule_number', null, 'board', b, 'band', 'minor', 'cause', 'report', 'about_act', p, 'rule', 'Premise: rudeness'));
  if (got ->> 'joined')::boolean is not true then raise exception 'a premise charge did not join: %', got; end if;
  got := start_visit(p, 'vs-m1', jsonb_build_object('rule_number', null, 'board', b, 'band', 'minor', 'cause', 'report', 'about_act', p, 'rule', 'Premise: spam'));
  if (got ->> 'joined')::boolean is not true then raise exception 'a second, different premise charge did not join: %', got; end if;
  got := start_visit(p, 'vs-m1', jsonb_build_object('rule_number', null, 'board', b, 'band', 'minor', 'cause', 'report', 'about_act', p, 'rule', 'Premise: spam'));
  if (got ->> 'joined')::boolean is not false then raise exception 'the same premise charge joined twice: %', got; end if;
  if jsonb_array_length(visit_charges(v)) <> 3 then raise exception 'the visit should hold 3 charges: %', visit_charges(v); end if;
  -- Filed, the rule is not charged again; reversed, it can be.
  perform file_visit(v, null);
  got := start_visit(p, 'vs-m1', a);
  if (got ->> 'repeat')::boolean is not true then raise exception 'a filed visit''s rule was charged again: %', got; end if;
end $$;
do $$
declare
  c uuid := tests.character(tests.account('vs-ed2'), 'Vs Reversed');
  t uuid := tests.thread('Reversed');
  p uuid := tests.post(c, t, 'A quiet post, reversed and charged again.');
  a jsonb := jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts');
  v uuid := (start_visit(p, 'vs-m1', a) ->> 'visit')::uuid;
  got jsonb;
begin
  perform end_visit(v, 'reversed', null, 'Reversed.');
  got := start_visit(p, 'vs-m1', a);
  if got ->> 'visit' is null or (got ->> 'visit')::uuid = v then raise exception 'a reversed visit barred the rule from being charged again: %', got; end if;
end $$;

-- ---- 15. One failing rule does not drop the others, and leaves a trace an admin can read; the post still goes up ----
do $$
declare
  bad uuid;
  c uuid := tests.character(tests.account('vs-flo'), 'Vs Unlucky');
  t uuid;
  p uuid;
  v uuid;
begin
  insert into boards (slug, name) values ('vs-bad', 'Vs Bad') returning id into bad;
  insert into rule_predicates (key, param_kind, plain) values ('noBranch', 'none', 'a rule with no check');
  perform pg_temp.rule(bad, 'noBranch', null, 'minor');
  perform pg_temp.rule(bad, 'minLength', '20'::jsonb, 'severe');
  insert into threads (board, title) values (bad, 'Vs bad thread') returning id into t;
  p := pg_temp.say(c, t, 'short');
  if not exists (select 1 from acts where id = p and kind = 'post') then raise exception 'the post did not go up'; end if;
  v := pg_temp.visit_of(p);
  if v is null or (select a.payload #>> '{charges,0,rule_number}' from acts a where a.id = v) is distinct from '2' then raise exception 'the other rule''s visit was dropped by the failing rule: %', (select payload from acts where id = v); end if;
  if not exists (select 1 from visit_draw_failures f where f.post_act = p and f.rule_number = 1 and f.error like '%no check for predicate noBranch%') then raise exception 'the failure left no trace: %', (select count(*) from visit_draw_failures); end if;
  if has_table_privilege('authenticated', 'visit_draw_failures', 'select') or has_table_privilege('anon', 'visit_draw_failures', 'select') then raise exception 'the failure table is readable by a client'; end if;
  if not (select relrowsecurity from pg_class where relname = 'visit_draw_failures') then raise exception 'the failure table has no RLS'; end if;
end $$;

-- ---- 16. A raw visit_end insert is refused, by a player's session and by a superuser's alike ----
do $$
declare
  c uuid := tests.character(tests.account('vs-gus'), 'Vs Forger');
  t uuid := tests.thread('Forged');
  p uuid := pg_temp.say(c, t, 'FORGING AN END');
  v uuid := pg_temp.visit_of(p);
  said text;
begin
  said := pg_temp.refusal(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'visit_end', %L, %L, '{"visit_act": "%s", "outcome": "reversed", "line": "x"}')$q$, t, v, v));
  if said is null or said not like '42501:%' then raise exception 'a raw visit_end was not refused as a forbidden write: %', said; end if;
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = v) or not exists (select 1 from visits_open where visit_act = v) then raise exception 'the forged end landed'; end if;
end $$;

-- ---- 17. The repeat-charge lookup is read by index: the post's visits by acts_visits_by_post, their joins by acts_visit_joins ----
do $$
declare
  plan text := '';
  ln record;
  p uuid := (select a.id from acts a where a.kind = 'post' limit 1);
begin
  -- The function pins its search_path, which keeps EXPLAIN from seeing inside it; its own body, without the pin, is what is explained.
  execute format('create function pg_temp.matches(post uuid, ch jsonb) returns setof integer language sql stable as %L', (select prosrc from pg_proc where proname = 'visit_charge_matches'));
  if not exists (select 1 from pg_proc where proname = 'visit_charge_matches' and proconfig @> array['search_path=public, pg_temp']) then raise exception 'visit_charge_matches does not pin its search_path'; end if;
  set local enable_seqscan = off;
  for ln in execute format('explain select * from pg_temp.matches(%L, %L::jsonb)', p, '{"cause": "rule", "rule_number": 1, "board": "x"}') loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  set local enable_seqscan = on;
  if plan not like '%acts_visits_by_post%' or plan not like '%acts_visit_joins%' or plan not like '%acts_one_visit_end%' or plan not like '%Index Cond%' then
    raise exception 'the repeat-charge lookup is not read by the visit, join and end indexes: %', plan;
  end if;
end $$;

-- ---- 18. thread_page drops anything but kind, question index and price from a challenge ----
do $$
declare
  c uuid := tests.character(tests.account('vs-hal'), 'Vs Leaky');
  t uuid := tests.thread('Leaky');
  p uuid := tests.post(c, t, 'A post under a leaky visit.');
  v uuid;
  page jsonb;
  ch jsonb;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  v := tests.act((select id from characters where staff = 'vs-m1'), 'visit', t, jsonb_build_object(
    'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p::text)),
    'ends_at', now() + interval '1 hour', 'line', 'Looking.',
    'challenge', jsonb_build_object('kind', 'quiz', 'question_index', 1, 'price', 5, 'answer', 'SECRET', 'answers', jsonb_build_array('SECRET'))), p);
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  ch := (select e -> 'challenge' from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = p::text);
  if ch is null or ch <> jsonb_build_object('kind', 'quiz', 'question_index', 1, 'price', 5) then raise exception 'the page''s challenge is not whitelisted: %', ch; end if;
  if page::text like '%SECRET%' then raise exception 'thread_page carried a planted answer'; end if;
end $$;

-- ---- 19. A visit that keeps failing is recorded and does not starve the rest: a poisoned filing does not stop a later one, and goes behind it next tick ----
do $$
declare
  c uuid := tests.character(tests.account('vs-ida'), 'Vs Starved');
  t uuid := tests.thread('Starved');
  bad_p uuid := pg_temp.say(c, t, 'SHOUTING, POISONED');
  good_p uuid := pg_temp.say(tests.character(tests.account('vs-ida2'), 'Vs Fine'), t, 'SHOUTING, FINE');
  bad uuid := pg_temp.visit_of(bad_p);
  good uuid := pg_temp.visit_of(good_p);
begin
  execute format($f$create function pg_temp.poison() returns trigger language plpgsql as $b$ begin
    if new.payload ->> 'visit_act' = %L then raise exception 'a poisoned filing'; end if; return new; end $b$ $f$, bad);
  create trigger vs_poison before insert on acts for each row when (new.kind = 'infraction') execute function pg_temp.poison();
  -- Both due, the poisoned one first; a cap of one a tick.
  insert into settings (key, value) values ('demandChecksPerTick', '1') on conflict (key) do update set value = '1';
  update visits_open set ends_at = now() - interval '3 hours' where visit_act = bad;
  update visits_open set ends_at = now() - interval '2 hours' where visit_act = good;
  perform system_tick();
  if not exists (select 1 from visit_file_failures f where f.visit_act = bad and f.error like '%a poisoned filing%') then raise exception 'the failed filing left no trace'; end if;
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id in (bad, good)) then raise exception 'a poisoned visit ended, or the cap was not one'; end if;
  perform system_tick();
  if not exists (select 1 from acts where kind = 'visit_end' and target_act_id = good) then raise exception 'a visit that keeps failing starved the one behind it'; end if;
  if exists (select 1 from acts where kind = 'visit_end' and target_act_id = bad) then raise exception 'the poisoned visit filed'; end if;
  perform system_tick();
  perform system_tick();
  if (select count(*) from visit_file_failures where visit_act = bad) is distinct from 1 or (select attempts from visit_file_failures where visit_act = bad) is distinct from (select attempts from visits_open where visit_act = bad) then
    raise exception 'a stuck visit should keep one failure row counting its attempts: %', (select jsonb_agg(to_jsonb(f)) from visit_file_failures f where f.visit_act = bad);
  end if;
  -- With room for both in a tick, the later one files in the same tick the earlier fails.
  update settings set value = '5' where key = 'demandChecksPerTick';
  drop trigger vs_poison on acts;
  delete from settings where key = 'demandChecksPerTick';
end $$;

-- ---- 20. Nothing raises out of draw_visits, even its first reads; the failure is recorded ----
do $$
declare
  c uuid := tests.character(tests.account('vs-jo'), 'Vs Unreadable');
  t uuid := tests.thread('Unreadable');
  p uuid := tests.post(c, t, 'A post whose reads fail.');
begin
  alter table settings rename column value to value_gone;
  perform draw_visits(p);
  alter table settings rename column value_gone to value;
  if not exists (select 1 from visit_draw_failures f where f.post_act = p and f.rule_number is null and f.error like '%value%') then raise exception 'a failure in draw_visits'' own reads left no trace'; end if;
end $$;

-- ---- 21. A visit that fails forever is dropped at the ceiling: reversed, a plain line, and nothing lands on the author ----
do $$
declare
  c uuid := tests.character(tests.account('vs-kay'), 'Vs Doomed');
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
  if not exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = v and e.payload ->> 'outcome' = 'reversed' and e.payload ->> 'line' = 'This visit could not be filed and was dropped.') then
    raise exception 'a visit that fails forever was not dropped at the ceiling';
  end if;
  if exists (select 1 from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text) or warn_points(c) is distinct from 0 then raise exception 'something landed on the author of a dropped visit'; end if;
  perform tests.become((select owner from characters where id = c));
  page := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(page -> 'visits') e where e ->> 'post' = p::text and e #>> '{end,outcome}' = 'reversed') then raise exception 'the post does not show its visit ended'; end if;
  drop trigger vs_poison2 on acts;
end $$;
