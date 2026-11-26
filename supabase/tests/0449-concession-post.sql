-- A talked-down Mod posts its concession in the thread (supabase/migrations/0449_concession_post.sql; docs/plans/2026-11-24-concession-post-design.md; its plan, Task 1).
--
-- 1. A quiz visit with a `model` concession, answered right: the visit ends intercepted; one `post` Act by the Mod in the visit's thread, quoting the visited post, its body the concession with `{who}` the interceptor's name; one visit_concession_posts row.
-- 2. A bribe visit with no concession row, paid: the post is a stock line of that persona's, `{who}` filled; the row says `stock`. The line is drawn from the visit's id alone (concession_line_index), negative hashes included.
-- 3. A distraction (a card cast at thread reach): the same through distract_visits, by the caster's name.
-- 4. A wrong quiz answer, a filing, a trap, a reversal and a drop each write no concession post.
-- 5. write_visit_concession after the visit was talked down writes nothing; the thread holds one concession post.
-- 6. A Mod's character locked out of the thread: the interception still succeeds and ends the visit, the wallet is as today, no post is written, and the row holds the refusal. The same with the persona benched.
-- 7. A name holding `{who}` is put in once.
-- 8. pending_concessions answers a bribe visit 14 minutes old and not one 15 minutes old, nor any quiz visit; the tick, with the switch on and off, writes `none` past the window (and a quiz's `none` with its bank row).
-- 9. The backfill: a visit opened before the migration has a `none` row, open and ended alike; talked down, it posts its stock.
-- 10. visit_concessions, visit_concession_posts and staff_concessions refuse what they must and no client role reads them.
-- 11. The modBots check refuses a missing or negative concessionsPerDay and a concessionWriteMinutes of 0, each naming the field; a stored row without them is given them.
-- 12. A player's reply to the concession post is found waiting by pool_waiting_in_thread for that Mod, with nothing changed in it.
-- Beside: the table's body rules, post_concession's single post and its `no concession`, the seed's staff_concessions and a reseed's replacement.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'cp-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'cp-bob@test.invalid' $$;
create function pg_temp.eve() returns uuid language sql as $$ select id from auth.users where email = 'cp-eve@test.invalid' $$;
create function pg_temp.chr(n text) returns uuid language sql as $$ select id from characters where name = n $$;
create function pg_temp.modchar(staff text) returns uuid language sql as $$ select id from characters where characters.staff = modchar.staff $$;
create function pg_temp.wallet(a uuid) returns integer language sql as $$ select balance from wallets where account = a $$;

create function pg_temp.visit(p uuid, staff text) returns uuid language sql as $$
  select (start_visit(p, staff, jsonb_build_object('rule_number', 1, 'board', (select t.board from acts a join threads t on t.id = a.thread where a.id = p),
    'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid
$$;

create function pg_temp.end_of(visit uuid) returns acts language sql as $$ select * from acts where kind = 'visit_end' and target_act_id = visit $$;

create function pg_temp.try(through uuid, visit uuid, answer text default null) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  perform tests.become((select owner from characters where id = through));
  got := intercept(through, visit, answer);
  perform tests.unbecome();
  return got;
end $$;

-- A visit made older by some minutes (and five seconds, since an Act's time is the clock's and a little after the transaction's now()): its Act's time and both pending marks that copy it.
create function pg_temp.age(visit uuid, minutes integer) returns void language plpgsql as $$
begin
  alter table acts disable trigger acts_no_update;
  update acts set created_at = created_at - make_interval(mins => minutes, secs => 5) where id = visit;
  alter table acts enable always trigger acts_no_update;
  update visits_open set quiz_at = quiz_at - make_interval(mins => minutes, secs => 5) where visit_act = visit and quiz_at is not null;
  update visits_open set concession_at = concession_at - make_interval(mins => minutes, secs => 5) where visit_act = visit and concession_at is not null;
end $$;

-- The posts a Mod's concession wrote in a thread: its `post` Acts that quote a post that has a visit.
create function pg_temp.concession_posts(in_thread uuid) returns bigint language sql as $$
  select count(*) from acts p where p.kind = 'post' and p.thread = in_thread and p.character in (select id from characters where staff is not null)
    and exists (select 1 from acts v where v.kind = 'visit' and v.target_act_id = p.target_act_id and v.character = p.character)
$$;

create function pg_temp.modbots(extra jsonb default '{}', minus text[] default '{}') returns jsonb language sql as $$
  select ((jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
    'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
    'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15,
    'concessionsPerDay', 60, 'concessionWriteMinutes', 15)) || extra) - minus
$$;

-- ---- 11. The modBots check names the field it refuses (first: it needs no world) ----
do $$
declare
  why text;
begin
  if setting_modbots(pg_temp.modbots()) is not null then raise exception 'the good modBots was refused: %', setting_modbots(pg_temp.modbots()); end if;
  if setting_modbots(pg_temp.modbots('{"concessionsPerDay": 0}')) is not null then raise exception 'a concessionsPerDay of 0 (the stock always) was refused'; end if;
  if setting_modbots(pg_temp.modbots('{"concessionWriteMinutes": 1}')) is not null then raise exception 'a concessionWriteMinutes of 1 was refused'; end if;
  why := setting_modbots(pg_temp.modbots(minus => array['concessionsPerDay']));
  if why is null or why !~ '"concessionsPerDay" is not' then raise exception 'a missing concessionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"concessionsPerDay": -1}'));
  if why is null or why !~ '"concessionsPerDay" is not' then raise exception 'a negative concessionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"concessionsPerDay": 1.5}'));
  if why is null or why !~ '"concessionsPerDay" is not' then raise exception 'a fractional concessionsPerDay was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots(minus => array['concessionWriteMinutes']));
  if why is null or why !~ '"concessionWriteMinutes" is not' then raise exception 'a missing concessionWriteMinutes was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"concessionWriteMinutes": 0}'));
  if why is null or why !~ '"concessionWriteMinutes" is not' then raise exception 'a concessionWriteMinutes of 0 was not refused by name: %', why; end if;
  why := setting_modbots(pg_temp.modbots('{"concessionWriteMinutes": "15"}'));
  if why is null or why !~ '"concessionWriteMinutes" is not' then raise exception 'a string concessionWriteMinutes was not refused by name: %', why; end if;
  -- The shape names both fields.
  if setting_modbots('1'::jsonb) !~ 'concessionWriteMinutes' or setting_modbots('1'::jsonb) !~ 'concessionsPerDay' then raise exception 'the shape does not name the new fields: %', setting_modbots('1'::jsonb); end if;
end $$;

-- ---- 0. The world: a Boss, a quiz Mod, two bribe Mods (one with no lines), a distraction Mod, and three players ----
create function pg_temp.seed(m2_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', pg_temp.modbots(),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cp-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'cp-boss', 'name', 'Concession Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'cp-m1', 'name', 'Concession Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 2),
          'quiz', jsonb_build_array(
            jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone', 'Dust'), 'answer', 'Stone'),
            jsonb_build_object('question', 'Which is the loudest?', 'choices', jsonb_build_array('Drum', 'Mouse'), 'answer', 'Drum')),
          'concessions', jsonb_build_array('Stock quiz line for {who}.', 'Another quiz line, {who}.', 'A third quiz line.')),
        jsonb_build_object('key', 'cp-m2', 'name', 'Concession Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50),
          'concessions', m2_lines),
        jsonb_build_object('key', 'cp-m3', 'name', 'Concession Mod Three', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
          'concessions', jsonb_build_array('{who} wins. This time.', 'Fine, {who}, the card works.', 'The card is noted, {who}.')),
        jsonb_build_object('key', 'cp-m4', 'name', 'Concession Mod Four', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'cp-m5', 'name', 'Concession Mod Five', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
          'concessions', jsonb_build_array('{who} again.', 'Five concedes to {who}.', 'Noted, {who}.'))),
      'firstStaff', jsonb_build_array('cp-m1', 'cp-m2', 'cp-m3', 'cp-m4', 'cp-m5'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))))
$$;

do $$
begin
  perform seed_instance(pg_temp.seed('["{who} yields. Grudgingly.", "Fine, {who}. You may pass.", "{who}, this once.", "I concede, {who}.", "Take it, {who}."]'::jsonb));
  perform tests.account('cp-ann');
  perform tests.account('cp-bob');
  perform tests.account('cp-eve');
  insert into wallets (account, balance) values (pg_temp.ann(), 500), (pg_temp.bob(), 500), (pg_temp.eve(), 500);
  perform tests.character(pg_temp.bob(), 'Cp Bob A');
  perform tests.character(pg_temp.ann(), 'Cp Ann A');
  perform tests.character(pg_temp.ann(), 'Cp Ann B');
  perform tests.character(pg_temp.eve(), 'Cp Eve A');
end $$;

-- ---- Beside: the seed keeps the lines where no client reads them, and a reseed replaces them ----
do $$
declare
  why text;
begin
  if (select count(*) from staff_concessions where staff = 'cp-m2') is distinct from 5::bigint then raise exception 'the seed did not carry the five lines: %', (select count(*) from staff_concessions where staff = 'cp-m2'); end if;
  if (select line from staff_concessions where staff = 'cp-m2' and idx = 0) is distinct from '{who} yields. Grudgingly.' or (select line from staff_concessions where staff = 'cp-m2' and idx = 4) is distinct from 'Take it, {who}.' then
    raise exception 'the lines are stored wrong: %', (select jsonb_agg(to_jsonb(q) order by q.idx) from staff_concessions q where q.staff = 'cp-m2');
  end if;
  if exists (select 1 from staff_concessions where staff = 'cp-m4') then raise exception 'a persona with no lines has lines'; end if;
  -- A reseed replaces them, once, and a reseed that gives none leaves none.
  perform seed_instance(pg_temp.seed('["Only one now, {who}."]'::jsonb));
  if (select count(*) from staff_concessions where staff = 'cp-m2') is distinct from 1::bigint then raise exception 'a reseed did not replace the lines'; end if;
  perform seed_instance(pg_temp.seed('[]'::jsonb));
  if exists (select 1 from staff_concessions where staff = 'cp-m2') then raise exception 'a reseed with no lines left lines'; end if;
  perform seed_instance(pg_temp.seed('["{who} yields. Grudgingly.", "Fine, {who}. You may pass.", "{who}, this once.", "I concede, {who}.", "Take it, {who}."]'::jsonb));
  if (select count(*) from staff_concessions where staff = 'cp-m2') is distinct from 5::bigint then raise exception 'the reseed did not restore the lines'; end if;
  -- A blank or an over-long line is refused by the table.
  why := pg_temp.refusal('insert into staff_concessions (staff, idx, line) values (''cp-m4'', 0, ''   '')');
  if why is null or why !~ '^23514' then raise exception 'a blank line was accepted: %', why; end if;
  why := pg_temp.refusal(format('insert into staff_concessions (staff, idx, line) values (''cp-m4'', 0, %L)', repeat('x', 281)));
  if why is null or why !~ '^23514' then raise exception 'a 281-character line was accepted: %', why; end if;
end $$;

-- ---- 2a. The line is drawn from the visit's id alone, a negative hash included ----
do $$
begin
  -- Fixed ids: the same index on any database. (-4542749600888758786 is the hash of ...02: a naive modulo would answer -1.)
  if concession_line_index('00000000-0000-0000-0000-000000000001', 5) is distinct from 0 then raise exception 'index of ...01 over 5: %', concession_line_index('00000000-0000-0000-0000-000000000001', 5); end if;
  if concession_line_index('00000000-0000-0000-0000-000000000002', 5) is distinct from 4 then raise exception 'index of ...02 over 5 (a negative hash): %', concession_line_index('00000000-0000-0000-0000-000000000002', 5); end if;
  if concession_line_index('00000000-0000-0000-0000-000000000004', 5) is distinct from 4 then raise exception 'index of ...04 over 5: %', concession_line_index('00000000-0000-0000-0000-000000000004', 5); end if;
  if concession_line_index('00000000-0000-0000-0000-000000000002', 1) is distinct from 0 then raise exception 'index over 1 is not 0'; end if;
  if concession_line_index('00000000-0000-0000-0000-000000000002', 0) is not null then raise exception 'an index over no lines is not null'; end if;
  for i in 1..200 loop
    if concession_line_index(gen_random_uuid(), 7) not between 0 and 6 then raise exception 'an index fell outside its lines'; end if;
  end loop;
end $$;

-- ---- 1. A quiz visit with a model concession, answered right: one post, quoting the visited post, {who} filled ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  mod uuid := pg_temp.modchar('cp-m1');
  t uuid := tests.thread('Cp quiz');
  p uuid := tests.post(author, t, 'A post a quiz Mod visited.');
  v uuid := pg_temp.visit(p, 'cp-m1');
  got jsonb;
  w0 integer := pg_temp.wallet(pg_temp.ann());
  r visit_concession_posts%rowtype;
  posted acts%rowtype;
  n_posts bigint := (select count(*) from acts where kind = 'post');
begin
  if (select concession_at from visits_open where visit_act = v) is null then raise exception 'a quiz visit with no concession row is not marked pending'; end if;
  perform write_visit_quiz(v, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  if (write_visit_concession(v, 'model', 'Well played, {who}. Carry on.', null) ->> 'written')::boolean is distinct from true then raise exception 'the concession was not written'; end if;
  got := pg_temp.try(ann, v, 'Stone');
  if (got ->> 'succeeded')::boolean is not true or (got ->> 'ended')::boolean is not true then raise exception 'the right answer did not end the visit: %', got; end if;
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'the visit did not end intercepted'; end if;
  select * into r from visit_concession_posts where visit_act = v;
  if r.visit_act is null or r.source is distinct from 'model' or r.post_act is null or r.error is not null then raise exception 'the post record is wrong: %', to_jsonb(r); end if;
  select * into posted from acts where id = r.post_act;
  if posted.kind is distinct from 'post' or posted.character is distinct from mod or posted.thread is distinct from t or posted.target_act_id is distinct from p then
    raise exception 'the concession post is wrong: %', to_jsonb(posted);
  end if;
  if posted.payload ->> 'body' is distinct from 'Well played, Cp Ann A. Carry on.' then raise exception 'the body is wrong: %', posted.payload ->> 'body'; end if;
  if (select count(*) from acts where kind = 'post') is distinct from n_posts + 1 then raise exception 'the talk-down wrote % posts', (select count(*) from acts where kind = 'post') - n_posts; end if;
  if (select count(*) from visit_concession_posts where visit_act = v) is distinct from 1::bigint then raise exception 'not one post record'; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 then raise exception 'a quiz changed a wallet'; end if;
end $$;

-- ---- 2. A bribe visit with no concession row, paid: a stock line, {who} filled; the row says stock ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  mod uuid := pg_temp.modchar('cp-m2');
  t uuid := tests.thread('Cp bribe');
  p uuid := tests.post(author, t, 'A post a bribable Mod visited.');
  v uuid := pg_temp.visit(p, 'cp-m2');
  got jsonb;
  w0 integer := pg_temp.wallet(pg_temp.ann());
  r visit_concession_posts%rowtype;
  posted acts%rowtype;
  expected text;
begin
  if (select concession_at from visits_open where visit_act = v) is null then raise exception 'a bribe visit with no row is not marked pending'; end if;
  got := pg_temp.try(ann, v);
  if (got ->> 'ended')::boolean is not true then raise exception 'the bribe did not end the visit: %', got; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 50 then raise exception 'the bribe was not spent'; end if;
  select * into r from visit_concession_posts where visit_act = v;
  if r.source is distinct from 'stock' or r.post_act is null or r.error is not null then raise exception 'the post record is wrong: %', to_jsonb(r); end if;
  select * into posted from acts where id = r.post_act;
  if posted.character is distinct from mod or posted.thread is distinct from t or posted.target_act_id is distinct from p or posted.kind is distinct from 'post' then raise exception 'the stock post is wrong: %', to_jsonb(posted); end if;
  select replace(l.line, '{who}', 'Cp Ann A') into expected from staff_concessions l where l.staff = 'cp-m2' order by l.idx offset concession_line_index(v, 5) limit 1;
  if posted.payload ->> 'body' is distinct from expected then raise exception 'the stock line is not the one the visit draws: % vs %', posted.payload ->> 'body', expected; end if;
  if posted.payload ->> 'body' ~ '[{}]' then raise exception 'a token was left in the post: %', posted.payload ->> 'body'; end if;
  -- The post stood on the post's author's page as any reply to it: a post in the thread quoting the visited post.
  if (select count(*) from acts x where x.kind = 'post' and x.target_act_id = p) is distinct from 1::bigint then raise exception 'the visited post has not one reply'; end if;
end $$;

-- ---- 3. A distraction: a card cast at thread reach ends the visit, and the Mod posts, by the caster's name ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  caster uuid := pg_temp.chr('Cp Ann B');
  mod uuid := pg_temp.modchar('cp-m3');
  t uuid := tests.thread('Cp distraction');
  p uuid := tests.post(author, t, 'A post a distractable Mod visited.');
  q uuid := tests.post(author, t, 'Another post it visited.');
  v uuid := pg_temp.visit(p, 'cp-m3');
  v2 uuid := pg_temp.visit(q, 'cp-m3');
  played jsonb;
  r visit_concession_posts%rowtype;
  posted acts%rowtype;
  expected text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, gimmick, lasts, reaches, pins, trap) values ('cp-th', 'Cp Thread', 'sweet', 'common', 'cast', 3, null, interval '1 day', '{thread}', false, null) on conflict (key) do nothing;
  played := place_cast(caster, 'cp-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' or (pg_temp.end_of(v2)).payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'the distraction did not end both visits'; end if;
  for r in select * from visit_concession_posts where visit_act in (v, v2) order by visit_act loop
    if r.source is distinct from 'stock' or r.post_act is null or r.error is not null then raise exception 'the post record is wrong: %', to_jsonb(r); end if;
    select * into posted from acts where id = r.post_act;
    if posted.character is distinct from mod or posted.thread is distinct from t or posted.kind is distinct from 'post' then raise exception 'the distraction post is wrong: %', to_jsonb(posted); end if;
    if posted.target_act_id is distinct from (select a.target_act_id from acts a where a.id = r.visit_act) then raise exception 'the post does not quote the visited post'; end if;
    select replace(l.line, '{who}', 'Cp Ann B') into expected from staff_concessions l where l.staff = 'cp-m3' order by l.idx offset concession_line_index(r.visit_act, 3) limit 1;
    if posted.payload ->> 'body' is distinct from expected then raise exception 'the stock line is wrong: % vs %', posted.payload ->> 'body', expected; end if;
  end loop;
  if (select count(*) from visit_concession_posts where visit_act in (v, v2)) is distinct from 2::bigint then raise exception 'not two post records'; end if;
  -- A second cast ends nothing and posts nothing.
  perform place_cast(caster, 'cp-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  if (select count(*) from visit_concession_posts where visit_act in (v, v2)) is distinct from 2::bigint then raise exception 'a second cast posted again'; end if;
end $$;

-- ---- 4. A wrong answer, a filing, a trap, a reversal and a drop each write no concession post ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  t uuid := tests.thread('Cp no posts');
  vq uuid := pg_temp.visit(tests.post(author, t, 'Wrong answer.'), 'cp-m1');
  vf uuid := pg_temp.visit(tests.post(author, t, 'Filed.'), 'cp-m2');
  vr uuid := pg_temp.visit(tests.post(author, t, 'Reversed.'), 'cp-m2');
  vd uuid := pg_temp.visit(tests.post(author, t, 'Dropped.'), 'cp-m2');
  pt uuid := tests.post(author, t, 'Trapped.');
  vt uuid;
  sset uuid;
  n_posts bigint := (select count(*) from acts where kind = 'post');
  got jsonb;
  o text;
begin
  perform write_visit_quiz(vq, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  perform write_visit_concession(vq, 'model', 'Never said, {who}.', null);
  got := pg_temp.try(ann, vq, 'Moss');
  -- A trap: a visit trap set on the post springs as the visit starts and ends it (start_visit's own path).
  insert into card_kinds (key, name, alignment, rarity, play, trap, gimmick, lasts) values ('cp-vtrap', 'Cp Visit Trap', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}', null, null) on conflict (key) do nothing;
  sset := tests.act(author, 'set', t, '{}', pt);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (sset, pg_temp.bob(), 'cp-vtrap', pt, t, 1, now() + interval '1 day');
  vt := pg_temp.visit(pt, 'cp-m2');
  if (pg_temp.end_of(vt)).payload ->> 'outcome' is distinct from 'trapped' then raise exception 'the trap did not end the visit trapped: %', to_jsonb(pg_temp.end_of(vt)); end if;
  -- A drop: a visit that cannot file ends `dropped` at the tick's ceiling.
  execute $f$create function pg_temp.poison_filing() returns trigger language plpgsql as $b$ begin
    if new.payload ->> 'visit_act' = current_setting('cp.dropping') then raise exception 'a forever failing filing'; end if; return new; end $b$ $f$;
  perform set_config('cp.dropping', vd::text, true);
  create trigger cp_poison_filing before insert on acts for each row when (new.kind = 'infraction') execute function pg_temp.poison_filing();
  update visits_open set ends_at = now() - interval '2 hours', attempts = 9 where visit_act = vd;
  perform system_tick();
  drop trigger cp_poison_filing on acts;
  if (pg_temp.end_of(vd)).payload ->> 'outcome' is distinct from 'dropped' then raise exception 'the tick did not drop the visit: %', to_jsonb(pg_temp.end_of(vd)); end if;
  if (got ->> 'succeeded')::boolean is not false then raise exception 'a wrong answer succeeded: %', got; end if;
  perform end_visit(vf, 'filed', null, 'Filed.');
  -- A reversal: no live path writes `reversed` any more (the tick's drop is `dropped`, below), so end_visit is the only way to write one.
  perform end_visit(vr, 'reversed', null, 'Reversed.');
  if (select count(*) from acts where kind = 'post') is distinct from n_posts then raise exception 'a visit that did not end intercepted wrote % posts', (select count(*) from acts where kind = 'post') - n_posts; end if;
  if exists (select 1 from visit_concession_posts where visit_act in (vq, vf, vt, vr, vd)) then raise exception 'a post record was written for a visit that was not talked down'; end if;
  -- A real filing too, through file_visit.
  declare vfile uuid := pg_temp.visit(tests.post(author, t, 'Filed for real.'), 'cp-m2');
  begin
    perform file_visit(vfile, 'Filed it.');
    -- (A filing writes its own line, so only the concession's record is asked.)
    if exists (select 1 from visit_concession_posts where visit_act = vfile) or exists (select 1 from visit_concessions where visit_act = vfile and source = 'model') then raise exception 'a filing posted a concession'; end if;
  end;
end $$;

-- ---- 5. write_visit_concession after the talk-down writes nothing; the thread holds one concession post ----
do $$
declare
  t uuid := (select thread from acts where kind = 'post' and payload ->> 'body' = 'A post a bribable Mod visited.');
  v uuid := (select a.id from acts a where a.kind = 'visit' and a.thread = t);
  got jsonb;
begin
  got := write_visit_concession(v, 'model', 'Too late.', null);
  if got is distinct from '{"written": false, "ended": true}'::jsonb then raise exception 'a write after the talk-down answered %', got; end if;
  if exists (select 1 from visit_concessions where visit_act = v) then raise exception 'a late write was kept'; end if;
  if pg_temp.concession_posts(t) is distinct from 1::bigint then raise exception 'the thread holds % concession posts', pg_temp.concession_posts(t); end if;
  -- An ended-by-filing visit refuses it too, and a visit that is no visit is refused.
  got := write_visit_concession((select a.id from acts a join acts tp on tp.id = a.target_act_id where a.kind = 'visit' and tp.payload ->> 'body' = 'Filed.'), 'none', null, 'window');
  if (got ->> 'ended')::boolean is not true or (got ->> 'written')::boolean is not false then raise exception 'a filed visit took a concession: %', got; end if;
  if pg_temp.refusal(format('select write_visit_concession(%L, ''none'', null, ''window'')', (select id from acts where kind = 'post' limit 1))) !~ '^P0002' then raise exception 'a post was taken for a visit'; end if;
end $$;

-- ---- 5b. A second write of an open visit's concession writes nothing and answers the row that stands; the body rules are the table's ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  t uuid := tests.thread('Cp twice');
  v uuid := pg_temp.visit(tests.post(author, t, 'A twice post.'), 'cp-m2');
  got jsonb;
  why text;
begin
  got := write_visit_concession(v, 'model', 'First, {who}.', null);
  if (got ->> 'written')::boolean is not true or got ->> 'source' is distinct from 'model' or got ->> 'body' is distinct from 'First, {who}.' then raise exception 'the first write answered %', got; end if;
  got := write_visit_concession(v, 'none', null, 'window');
  if (got ->> 'written')::boolean is not false or got ->> 'source' is distinct from 'model' or got ->> 'body' is distinct from 'First, {who}.' then raise exception 'the second write answered %', got; end if;
  if (select concession_at from visits_open where visit_act = v) is not null then raise exception 'a written visit is still pending'; end if;
  -- The body rules.
  declare v2 uuid := pg_temp.visit(tests.post(author, t, 'A rules post.'), 'cp-m2');
  begin
    why := pg_temp.refusal(format('select write_visit_concession(%L, ''model'', null, null)', v2));
    if why is null or why !~ '^23514' then raise exception 'a model row with no body was accepted: %', why; end if;
    why := pg_temp.refusal(format('select write_visit_concession(%L, ''model'', ''   '', null)', v2));
    if why is null or why !~ '^23514' then raise exception 'a model row with a blank body was accepted: %', why; end if;
    why := pg_temp.refusal(format('select write_visit_concession(%L, ''none'', ''Some words.'', ''window'')', v2));
    if why is null or why !~ '^23514' then raise exception 'a none row with a body was accepted: %', why; end if;
    why := pg_temp.refusal(format('select write_visit_concession(%L, ''model'', %L, null)', v2, repeat('x', 281)));
    if why is null or why !~ '^23514' then raise exception 'a 281-character body was accepted: %', why; end if;
    why := pg_temp.refusal(format('select write_visit_concession(%L, ''maybe'', null, null)', v2));
    if why is null or why !~ '^23514' then raise exception 'a source of maybe was accepted: %', why; end if;
    if exists (select 1 from visit_concessions where visit_act = v2) then raise exception 'a refused write left a row'; end if;
    got := write_visit_concession(v2, 'model', repeat('x', 280), null);
    if (got ->> 'written')::boolean is not true then raise exception 'a 280-character body was refused: %', got; end if;
  end;
end $$;

-- ---- 3b. A cast that ends visits of two Mods posts their concessions in the Mods' character order, whatever order the visits were made in ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  caster uuid := pg_temp.chr('Cp Ann B');
  t uuid := tests.thread('Cp order');
  lo text; hi text;
  v_hi uuid; v_lo uuid;
  seq_lo integer; seq_hi integer;
begin
  select (array_agg(c.staff order by c.id))[1], (array_agg(c.staff order by c.id))[2] into lo, hi from characters c where c.staff in ('cp-m3', 'cp-m5');
  -- The higher-id Mod's visit is made first, so the order the visits end in is the opposite of the character order.
  v_hi := pg_temp.visit(tests.post(author, t, 'High first.'), hi);
  v_lo := pg_temp.visit(tests.post(author, t, 'Low second.'), lo);
  perform place_cast(caster, 'cp-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  if (select count(*) from visit_concession_posts where visit_act in (v_hi, v_lo) and post_act is not null) is distinct from 2::bigint then raise exception 'one cast did not post two concessions'; end if;
  select a.seq into seq_lo from visit_concession_posts r join acts a on a.id = r.post_act where r.visit_act = v_lo;
  select a.seq into seq_hi from visit_concession_posts r join acts a on a.id = r.post_act where r.visit_act = v_hi;
  if seq_lo > seq_hi then raise exception 'the concessions were posted out of the Mods'' character order (lo %, hi %)', seq_lo, seq_hi; end if;
end $$;

-- ---- 6. A Mod locked out of the thread, or benched: the talk-down stands, nothing is posted, the row holds the refusal ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  mod uuid := pg_temp.modchar('cp-m2');
  t uuid := tests.thread('Cp lockout');
  p uuid := tests.post(author, t, 'A locked-out Mod''s post.');
  v uuid;
  sset uuid;
  got jsonb;
  w0 integer;
  n_posts bigint;
  r visit_concession_posts%rowtype;
  tails0 bigint;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, stack, replies) values
    ('cp-lk', 'Cp Lock', 'pepperoni', 'rare', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty", "pepperoni"], "upTo": "rare"}, "outcome": {"kind": "lockout", "hours": 24}}', '{post}', null, null, 1, false)
  on conflict (key) do nothing;
  v := pg_temp.visit(p, 'cp-m2');
  sset := tests.act(author, 'set', t, '{}', p);
  perform tests.act(author, 'spring', t, jsonb_build_object('card', 'cp-lk', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', mod::text, 'until', (now() + interval '1 day')::text), p);
  if locked_out_until(mod, t) is null then raise exception 'the Mod is not locked out of the thread'; end if;
  w0 := pg_temp.wallet(pg_temp.ann());
  n_posts := (select count(*) from acts where kind = 'post');
  tails0 := (select count(*) from tails);
  got := pg_temp.try(ann, v);
  if (got ->> 'succeeded')::boolean is not true or (got ->> 'ended')::boolean is not true then raise exception 'the interception failed with the Mod locked out: %', got; end if;
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'the visit did not end intercepted'; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 50 then raise exception 'the wallet is not as today'; end if;
  if (select count(*) from tails) is distinct from tails0 then raise exception 'the talk-down made a tail'; end if;
  if (select count(*) from acts where kind = 'post') is distinct from n_posts then raise exception 'a post was written for a Mod that is locked out'; end if;
  select * into r from visit_concession_posts where visit_act = v;
  if r.visit_act is null or r.post_act is not null or r.error is null or r.error !~ 'locked out' or r.source is distinct from 'stock' then raise exception 'the refusal was not recorded: %', to_jsonb(r); end if;
  if (select count(*) from acts where kind = 'intercept' and payload ->> 'visit_act' = v::text) is distinct from 1::bigint then raise exception 'the intercept Act did not stand'; end if;

  -- The same with the persona benched.
  t := tests.thread('Cp benched');
  v := pg_temp.visit(tests.post(author, t, 'A benched Mod''s post.'), 'cp-m2');
  insert into staff_offices (staff, office, cause) values ('cp-m2', 'benched', 'admin');
  w0 := pg_temp.wallet(pg_temp.ann());
  n_posts := (select count(*) from acts where kind = 'post');
  got := pg_temp.try(ann, v);
  if (got ->> 'ended')::boolean is not true then raise exception 'the interception failed with the persona benched: %', got; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 50 then raise exception 'the wallet is not as today (benched)'; end if;
  if (select count(*) from acts where kind = 'post') is distinct from n_posts then raise exception 'a benched persona posted'; end if;
  select * into r from visit_concession_posts where visit_act = v;
  if r.post_act is not null or r.error is null or r.error !~ 'writes nothing' then raise exception 'the benched refusal was not recorded: %', to_jsonb(r); end if;
  insert into staff_offices (staff, office, cause) values ('cp-m2', 'mod', 'admin');
end $$;

-- ---- 6b. A post that fails after its Act was inserted rolls back only the post: the talk-down, the wallet and the record stand ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  mod uuid := pg_temp.modchar('cp-m2');
  t uuid := tests.thread('Cp planted');
  p uuid := tests.post(author, t, 'A post whose concession fails late.');
  v uuid := pg_temp.visit(p, 'cp-m2');
  w0 integer := pg_temp.wallet(pg_temp.ann());
  tails0 bigint := (select count(*) from tails);
  posts0 bigint := (select count(*) from acts where kind = 'post');
  counts0 integer := (select posts from character_post_counts_base where character = mod);
  acts0 bigint;
  got jsonb;
  r visit_concession_posts%rowtype;
begin
  execute format($f$create function pg_temp.plant_post() returns trigger language plpgsql as $b$ begin raise exception 'planted after the post' using errcode = 'P0001'; end $b$ $f$);
  execute format('create trigger cp_plant_post after insert on acts for each row when (new.kind = %L and new.character = %L) execute function pg_temp.plant_post()', 'post', mod);
  acts0 := (select count(*) from acts);
  got := pg_temp.try(ann, v);
  drop trigger cp_plant_post on acts;
  if (got ->> 'succeeded')::boolean is not true or (got ->> 'ended')::boolean is not true then raise exception 'the talk-down failed with the post failing late: %', got; end if;
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'the visit end did not stand'; end if;
  if (select count(*) from acts where kind = 'intercept' and payload ->> 'visit_act' = v::text) is distinct from 1::bigint then raise exception 'the intercept Act did not stand'; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 50 then raise exception 'the wallet did not stand'; end if;
  if (select count(*) from tails) is distinct from tails0 then raise exception 'a tail was written'; end if;
  if (select count(*) from acts where kind = 'post') is distinct from posts0 then raise exception 'a partial post Act remains'; end if;
  -- Exactly the talk-down's own Acts (the intercept and the visit's end) were added: nothing of the failed post.
  if (select count(*) from acts) is distinct from acts0 + 2 then raise exception 'the talk-down added % Acts (two wanted)', (select count(*) from acts) - acts0; end if;
  if (select posts from character_post_counts_base where character = mod) is distinct from counts0 then raise exception 'the Mod''s post count moved with a post that was rolled back'; end if;
  select * into r from visit_concession_posts where visit_act = v;
  if r.visit_act is null or r.post_act is not null or r.error !~ 'planted after the post' then raise exception 'the refusal was not recorded: %', to_jsonb(r); end if;
end $$;

-- ---- 7. A name holding {who} is put in once ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  odd uuid := tests.character(pg_temp.eve(), 'Cp {who} Eve');
  t uuid := tests.thread('Cp braces');
  v uuid := pg_temp.visit(tests.post(author, t, 'A braces post.'), 'cp-m2');
  body text;
begin
  perform pg_temp.try(odd, v);
  select a.payload ->> 'body' into body from visit_concession_posts r join acts a on a.id = r.post_act where r.visit_act = v;
  if body is null then raise exception 'no post for the odd name'; end if;
  if length(body) - length(replace(body, '{who}', '')) is distinct from 5 then raise exception 'the name was filled again or not at all: %', body; end if;
  if body !~ 'Cp \{who\} Eve' then raise exception 'the name is not in the post: %', body; end if;
end $$;

-- ---- Beside: one post per visit, and a Mod with no line and no body records `no concession` ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  t uuid := tests.thread('Cp none');
  v uuid := pg_temp.visit(tests.post(author, t, 'A post the line-less Mod visited.'), 'cp-m4');
  n_posts bigint := (select count(*) from acts where kind = 'post');
  r visit_concession_posts%rowtype;
begin
  perform pg_temp.try(ann, v);
  select * into r from visit_concession_posts where visit_act = v;
  if r.visit_act is null or r.post_act is not null or r.error is distinct from 'no concession' then raise exception 'a Mod with nothing to say was not recorded as such: %', to_jsonb(r); end if;
  if (select count(*) from acts where kind = 'post') is distinct from n_posts then raise exception 'a Mod with nothing to say posted'; end if;
  if (pg_temp.end_of(v)).payload ->> 'outcome' is distinct from 'intercepted' then raise exception 'the visit did not end'; end if;
end $$;

-- ---- 5c. A filled body is cut at the instance's post length: many {who} in a line grow it by the name each time ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  big uuid := tests.character(pg_temp.eve(), repeat('W', 40));
  t uuid := tests.thread('Cp long');
  v uuid := pg_temp.visit(tests.post(author, t, 'A post for a long body.'), 'cp-m4');
  body text;
  most integer;
  was jsonb;
begin
  insert into staff_concessions (staff, idx, line) values ('cp-m4', 0, repeat('{who}', 56));
  was := (select value from settings where key = 'postMaxLength');
  if was is null then raise exception 'the world holds no postMaxLength'; end if;
  -- Below the 2,240 characters the line fills to, so the cut is what is asked.
  update settings set value = '300'::jsonb where key = 'postMaxLength';
  most := 300;
  perform pg_temp.try(big, v);
  update settings set value = was where key = 'postMaxLength';
  select a.payload ->> 'body' into body from visit_concession_posts r join acts a on a.id = r.post_act where r.visit_act = v;
  if body is null then raise exception 'no post for the long line: %', (select error from visit_concession_posts where visit_act = v); end if;
  if char_length(body) > most then raise exception 'the body (% characters) is longer than postMaxLength (%)', char_length(body), most; end if;
end $$;

-- ---- 8. pending_concessions: a bribe visit 14 minutes old is listed, one 15 minutes old is not, nor a quiz visit; the tick writes none past the window ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  t uuid := tests.thread('Cp pending');
  v14 uuid := pg_temp.visit(tests.post(author, t, 'Fourteen.'), 'cp-m2');
  v15 uuid := pg_temp.visit(tests.post(author, t, 'Fifteen.'), 'cp-m2');
  vnew uuid := pg_temp.visit(tests.post(author, t, 'Brand new.'), 'cp-m3');
  vq uuid := pg_temp.visit(tests.post(author, t, 'Quiz.'), 'cp-m1');
  vqp uuid := pg_temp.visit(tests.post(author, t, 'Quiz past the window.'), 'cp-m1');
  voff uuid := pg_temp.visit(tests.post(author, t, 'Switch off.'), 'cp-m2');
  vmod uuid := pg_temp.visit(tests.post(author, t, 'Written first.'), 'cp-m2');
  got uuid[];
  r record;
  tick jsonb;
  was jsonb := (select value from settings where key = 'systemEnabled');
begin
  if (select (value ->> 'concessionWriteMinutes')::integer from settings where key = 'modBots') is distinct from 15 then raise exception 'the world does not hold concessionWriteMinutes = 15'; end if;
  perform pg_temp.age(v14, 14);
  perform pg_temp.age(v15, 15);
  perform pg_temp.age(voff, 15);
  perform pg_temp.age(vmod, 20);
  perform pg_temp.age(vq, 14);
  perform pg_temp.age(vqp, 15);
  perform write_visit_concession(vmod, 'model', 'Written first, {who}.', null);
  -- The staff run's list, before any tick: oldest first, the shape pending_quizzes answers.
  select array_agg(x.visit_act order by x.started_at, x.visit_act) into got from pending_concessions(100) x where x.visit_act in (v14, v15, vnew, vq, vqp, voff, vmod);
  if got is distinct from array[v14, vnew] then raise exception 'pending_concessions answered % (want the 14-minute and the new one)', got; end if;
  select * into r from pending_concessions(100) x where x.visit_act = v14;
  if r.staff is distinct from 'cp-m2' or r.post_act is null or r.thread is distinct from t or r.board is null or r.board_name is null or r.charges is null or r.started_at is null then raise exception 'pending_concessions is the wrong shape: %', to_jsonb(r); end if;
  if (select count(*) from pending_concessions(1)) is distinct from 1::bigint or (select count(*) from pending_concessions(0)) is distinct from 0::bigint or (select count(*) from pending_concessions(-3)) is distinct from 0::bigint then raise exception 'pending_concessions ignores its limit'; end if;
  if (select visit_act from pending_concessions(1)) is not distinct from vnew and exists (select 1 from pending_concessions(100) x where x.visit_act = v14 and x.started_at < (select started_at from pending_concessions(100) y where y.visit_act = vnew)) then raise exception 'pending_concessions is not oldest first'; end if;
  -- The tick, with the switch on.
  tick := system_tick();
  if (select count(*) from visit_concessions where visit_act in (v14, vnew)) is distinct from 0::bigint then raise exception 'the tick wrote a concession for a visit inside its window'; end if;
  if (select source from visit_concessions where visit_act = v15) is distinct from 'none' or (select why from visit_concessions where visit_act = v15) is distinct from 'window' or (select body from visit_concessions where visit_act = v15) is not null then raise exception 'the tick did not write none/window at 15 minutes (switch on)'; end if;
  if (select source from visit_concessions where visit_act = vmod) is distinct from 'model' then raise exception 'the tick overwrote a model concession'; end if;
  if (tick ->> 'concessionsLapsed')::integer is distinct from 2 then raise exception 'the tick did not count the lapsed concessions (voff is not due yet, vmod is written): %', tick; end if;
  -- The quiz visit 15 minutes old: its bank row and its none row, in the one step; the 14-minute one has neither.
  if (select source from visit_quizzes where visit_act = vqp) is distinct from 'bank' or (select why from visit_concessions where visit_act = vqp) is distinct from 'window' then raise exception 'a quiz visit past its window was not given its bank row and its none row'; end if;
  if exists (select 1 from visit_quizzes where visit_act = vq) or exists (select 1 from visit_concessions where visit_act = vq) then raise exception 'a quiz visit inside its window was written'; end if;
  -- The switch off: the same.
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  perform pg_temp.age(v14, 1);
  perform pg_temp.age(vq, 1);
  tick := system_tick();
  if (select source from visit_concessions where visit_act = v14) is distinct from 'none' or (select why from visit_concessions where visit_act = v14) is distinct from 'window' then raise exception 'the tick did not write none with the switch off'; end if;
  if (select source from visit_quizzes where visit_act = vq) is distinct from 'bank' or (select why from visit_concessions where visit_act = vq) is distinct from 'window' then raise exception 'the tick did not write a quiz visit''s bank row and none row with the switch off'; end if;
  if exists (select 1 from visit_concessions where visit_act = vnew) then raise exception 'a visit still inside its window was written with the switch off'; end if;
  update settings set value = was where key = 'systemEnabled';
  -- Nothing past its window is left pending.
  if exists (select 1 from visits_open where concession_at is not null and concession_at <= now() - interval '15 minutes') then raise exception 'a visit past its time is still pending after the tick'; end if;
  -- The quiz visit whose question the staff run wrote first is left as it stands (no bank row), but its concession is settled `none`.
  declare vfirst uuid := pg_temp.visit(tests.post(author, t, 'Quiz written first.'), 'cp-m1');
  begin
    perform write_visit_quiz(vfirst, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
    perform pg_temp.age(vfirst, 20);
    perform system_tick();
    if (select source from visit_quizzes where visit_act = vfirst) is distinct from 'model' then raise exception 'the tick overwrote a model question'; end if;
    -- Its concession is still settled: the question the staff run wrote does not carry the concession, so the tick writes `none` for the quiz visit past quizWriteMinutes.
    if (select source from visit_concessions where visit_act = vfirst) is distinct from 'none' or (select why from visit_concessions where visit_act = vfirst) is distinct from 'window' then raise exception 'the tick did not write none for a quiz visit whose question the staff run wrote'; end if;
  end;
end $$;

-- ---- 8c. A quiz visit's concession lapses at quizWriteMinutes, whether or not its question was written; a non-quiz visit's at concessionWriteMinutes ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  t uuid := tests.thread('Cp quiz window');
  vq20 uuid := pg_temp.visit(tests.post(author, t, 'Quiz twenty.'), 'cp-m1');
  vq31 uuid := pg_temp.visit(tests.post(author, t, 'Quiz thirty-one.'), 'cp-m1');
  vq31m uuid := pg_temp.visit(tests.post(author, t, 'Quiz thirty-one, model concession.'), 'cp-m1');
  vb20 uuid := pg_temp.visit(tests.post(author, t, 'Bribe twenty.'), 'cp-m2');
  tick jsonb;
  was jsonb := (select value from settings where key = 'modBots');
begin
  update settings set value = value || '{"quizWriteMinutes": 30}'::jsonb where key = 'modBots';
  perform write_visit_quiz(vq20, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  perform write_visit_quiz(vq31, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  perform write_visit_quiz(vq31m, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  perform write_visit_concession(vq31m, 'model', 'Said by the run, {who}.', null);
  perform pg_temp.age(vq20, 20);
  perform pg_temp.age(vq31, 31);
  perform pg_temp.age(vq31m, 31);
  perform pg_temp.age(vb20, 20);
  tick := system_tick();
  if exists (select 1 from visit_concessions where visit_act = vq20) then raise exception 'a quiz visit inside quizWriteMinutes (20 of 30) was settled'; end if;
  if (select why from visit_concessions where visit_act = vq31) is distinct from 'window' or (select source from visit_concessions where visit_act = vq31) is distinct from 'none' then raise exception 'a quiz visit past quizWriteMinutes with a written question got no none row'; end if;
  if (select source from visit_concessions where visit_act = vq31m) is distinct from 'model' then raise exception 'the tick overwrote a written quiz concession'; end if;
  if (select why from visit_concessions where visit_act = vb20) is distinct from 'window' then raise exception 'a bribe visit past concessionWriteMinutes was not settled'; end if;
  if exists (select 1 from visit_quizzes where visit_act in (vq31) and source <> 'model') then raise exception 'the tick banked a question the run had written'; end if;
  if pg_temp.refusal(format('select count(*) from pending_concessions(100) x where x.visit_act = %L', vq20)) is not null then raise exception 'pending_concessions failed'; end if;
  if exists (select 1 from pending_concessions(100) x where x.visit_act in (vq20, vq31)) then raise exception 'pending_concessions listed a quiz visit'; end if;
  update settings set value = was where key = 'modBots';
end $$;

-- ---- 8b. A failing visit does not stop the tick's other visits ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  t uuid := tests.thread('Cp tick best effort');
  v uuid := pg_temp.visit(tests.post(author, t, 'Due.'), 'cp-m2');
  tick jsonb;
begin
  perform pg_temp.age(v, 15);
  tick := system_tick();
  if (select why from visit_concessions where visit_act = v) is distinct from 'window' then raise exception 'the due visit was not written'; end if;
  if tick ? 'concessionsLapsed' is not true then raise exception 'the answer does not count the lapsed concessions: %', tick; end if;
  -- Nothing due is left to count the second time.
  if (system_tick() ->> 'concessionsLapsed')::integer is distinct from 0 then raise exception 'a second tick lapsed the same visit'; end if;
end $$;

-- ---- 9. The backfill: a visit opened before the migration has a none row, open and ended alike; talked down, it posts its stock ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  t uuid := tests.thread('Cp backfill');
  v_open uuid := pg_temp.visit(tests.post(author, t, 'A held open post.'), 'cp-m2');
  v_ended uuid := pg_temp.visit(tests.post(author, t, 'A held ended post.'), 'cp-m2');
  v_quiz uuid := pg_temp.visit(tests.post(author, t, 'A held quiz post.'), 'cp-m1');
  v_done uuid := pg_temp.visit(tests.post(author, t, 'A visit already written.'), 'cp-m2');
  n integer;
  got jsonb;
  r visit_concession_posts%rowtype;
  expected text;
begin
  perform end_visit(v_ended, 'filed', null, 'Filed.');
  perform write_visit_concession(v_done, 'model', 'Kept as written, {who}.', null);
  if exists (select 1 from visit_concessions where visit_act in (v_open, v_ended, v_quiz)) then raise exception 'the held visits already have rows'; end if;
  n := backfill_visit_concessions();
  if n < 3 then raise exception 'the backfill wrote % rows, not at least 3', n; end if;
  if (select count(*) from visit_concessions where visit_act in (v_open, v_ended, v_quiz) and source = 'none' and why = 'before' and body is null) is distinct from 3::bigint then raise exception 'the backfill did not cover the open, the ended and the quiz visit'; end if;
  if (select source from visit_concessions where visit_act = v_done) is distinct from 'model' then raise exception 'the backfill touched a visit that had its row'; end if;
  if (select concession_at from visits_open where visit_act = v_open) is not null then raise exception 'a backfilled open visit is still pending'; end if;
  if backfill_visit_concessions() is distinct from 0 then raise exception 'the backfill is not idempotent'; end if;
  -- Every visit there is has a row.
  if exists (select 1 from acts a where a.kind = 'visit' and not exists (select 1 from visit_concessions c where c.visit_act = a.id)) then raise exception 'a visit is left with no row after the backfill'; end if;
  -- Talked down, it posts its stock.
  got := pg_temp.try(ann, v_open);
  if (got ->> 'ended')::boolean is not true then raise exception 'the held visit was not talked down: %', got; end if;
  select * into r from visit_concession_posts where visit_act = v_open;
  if r.source is distinct from 'stock' or r.post_act is null then raise exception 'a backfilled visit did not post its stock: %', to_jsonb(r); end if;
  select replace(l.line, '{who}', 'Cp Ann A') into expected from staff_concessions l where l.staff = 'cp-m2' order by l.idx offset concession_line_index(v_open, 5) limit 1;
  if (select payload ->> 'body' from acts where id = r.post_act) is distinct from expected then raise exception 'the backfilled visit posted the wrong line'; end if;
end $$;

-- ---- 10. The tables refuse updates, deletes and truncates (the first two) and no client reads any of the three ----
do $$
declare
  v uuid := (select visit_act from visit_concessions where source = 'model' limit 1);
  vp uuid := (select visit_act from visit_concession_posts limit 1);
  why text;
  tbl text;
begin
  why := pg_temp.refusal(format('update visit_concessions set body = ''Changed.'' where visit_act = %L', v));
  if why is null or why !~ '^P0001: a visit''s concession is never edited or removed' then raise exception 'an update of visit_concessions was not refused: %', why; end if;
  why := pg_temp.refusal(format('delete from visit_concessions where visit_act = %L', v));
  if why is null or why !~ '^P0001: a visit''s concession is never edited or removed' then raise exception 'a delete of visit_concessions was not refused: %', why; end if;
  why := pg_temp.refusal('truncate visit_concessions');
  if why is null or why !~ '^P0001: a visit''s concession is never edited or removed' then raise exception 'a truncate of visit_concessions was not refused: %', why; end if;
  why := pg_temp.refusal(format('update visit_concession_posts set error = ''Changed.'' where visit_act = %L', vp));
  if why is null or why !~ '^P0001: a visit''s concession post is never edited or removed' then raise exception 'an update of visit_concession_posts was not refused: %', why; end if;
  why := pg_temp.refusal(format('delete from visit_concession_posts where visit_act = %L', vp));
  if why is null or why !~ '^P0001: a visit''s concession post is never edited or removed' then raise exception 'a delete of visit_concession_posts was not refused: %', why; end if;
  why := pg_temp.refusal('truncate visit_concession_posts');
  if why is null or why !~ '^P0001: a visit''s concession post is never edited or removed' then raise exception 'a truncate of visit_concession_posts was not refused: %', why; end if;
  -- The append-only triggers fire whatever the session says.
  if (select count(*) from pg_trigger t where t.tgrelid in ('visit_concessions'::regclass, 'visit_concession_posts'::regclass) and not t.tgisinternal and t.tgenabled = 'A' and t.tgname ~ 'no_(update|truncate)') is distinct from 4::bigint then
    raise exception 'the append-only triggers are not enabled always';
  end if;
  foreach tbl in array array['visit_concessions', 'visit_concession_posts', 'staff_concessions'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then raise exception '% has no row security', tbl; end if;
    if has_table_privilege('authenticated', tbl, 'select') or has_table_privilege('anon', tbl, 'select')
       or has_table_privilege('authenticated', tbl, 'insert') or has_table_privilege('anon', tbl, 'insert')
       or has_table_privilege('authenticated', tbl, 'update') or has_table_privilege('anon', tbl, 'update')
       or has_table_privilege('authenticated', tbl, 'delete') or has_table_privilege('anon', tbl, 'delete') then raise exception 'a client can touch %', tbl; end if;
    perform tests.become(pg_temp.ann());
    why := pg_temp.refusal(format('select * from %I', tbl));
    perform tests.unbecome();
    if why is null or why !~ '^42501' then raise exception 'a signed-in player read %: %', tbl, why; end if;
    perform tests.become(pg_temp.ann());
    why := pg_temp.refusal(format('delete from %I', tbl));
    perform tests.unbecome();
    if why is null or why !~ '^42501' then raise exception 'a signed-in player deleted from %: %', tbl, why; end if;
    perform tests.become_anon();
    why := pg_temp.refusal(format('select * from %I', tbl));
    perform tests.unbecome();
    if why is null or why !~ '^42501' then raise exception 'an anonymous caller read %: %', tbl, why; end if;
  end loop;
  -- The service-only functions, and the one no client or service calls.
  if has_function_privilege('authenticated', 'write_visit_concession(uuid, text, text, text)', 'execute') or has_function_privilege('anon', 'write_visit_concession(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'pending_concessions(integer)', 'execute') or has_function_privilege('anon', 'pending_concessions(integer)', 'execute')
     or has_function_privilege('authenticated', 'concession_calls_today()', 'execute') or has_function_privilege('authenticated', 'backfill_visit_concessions()', 'execute') then
    raise exception 'a client can call a concession writer or a staff read';
  end if;
  if not (has_function_privilege('service_role', 'write_visit_concession(uuid, text, text, text)', 'execute') and has_function_privilege('service_role', 'pending_concessions(integer)', 'execute')
          and has_function_privilege('service_role', 'concession_calls_today()', 'execute')) then
    raise exception 'the service cannot call a concession function';
  end if;
  if has_function_privilege('authenticated', 'post_concession(uuid, uuid)', 'execute') or has_function_privilege('anon', 'post_concession(uuid, uuid)', 'execute')
     or has_function_privilege('service_role', 'post_concession(uuid, uuid)', 'execute') or has_function_privilege('public', 'post_concession(uuid, uuid)', 'execute') then
    raise exception 'post_concession can be called from outside';
  end if;
  if (select p.prosecdef and p.proconfig::text ~ 'pg_temp' from pg_proc p where p.oid = 'post_concession(uuid, uuid)'::regprocedure) is not true then raise exception 'post_concession is not security definer with a pinned search path'; end if;
  -- intercept stays a player's door.
  if not has_function_privilege('authenticated', 'intercept(uuid, uuid, text)', 'execute') then raise exception 'intercept is no longer a player''s door'; end if;
end $$;

-- ---- 11b. concession_calls_today counts the ledger's concession calls; the duty is one a call's record may take ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  t uuid := tests.thread('Cp ledger');
  p uuid := tests.post(author, t, 'A recorded post.');
  v uuid := pg_temp.visit(p, 'cp-m2');
  n0 integer := concession_calls_today();
  cols text;
begin
  select string_agg(a.attname, ',' order by a.attnum) into cols from pg_attribute a where a.attrelid = 'model_calls'::regclass and a.attnum > 0 and not a.attisdropped;
  if concession_calls_today() is distinct from n0 then raise exception 'concession_calls_today moved on its own'; end if;
  perform record_staff_call(v, 'concession', 'cp-m2', '{"source": "none", "why": "window", "trims": [], "calls": 0}');
  if (select duty from staff_call_records where cause_act = v) is distinct from 'concession' then raise exception 'the duty concession was not taken by a call record'; end if;
end $$;

-- ---- 11c. A stored modBots row without the new fields is given them, each on its own; a row that has them is left as it was ----
do $$
declare
  was jsonb := (select value from settings where key = 'modBots');
  old jsonb := was - 'concessionsPerDay' - 'concessionWriteMinutes';
  got jsonb;
  n integer;
begin
  perform set_config('kayfabb.seeding', 'on', true);
  -- Both missing: written as a deployed row was, under the held check's old shape, so the held trigger is stood down for the plant.
  alter table settings disable trigger settings_held;
  update settings set value = old where key = 'modBots';
  alter table settings enable trigger settings_held;
  if setting_modbots(old) is null then raise exception 'the planted row already passes the check'; end if;
  n := migrate_modbots_concession_fields();
  if current_setting('kayfabb.seeding', true) is distinct from 'on' then raise exception 'the migration left kayfabb.seeding as %, not on', current_setting('kayfabb.seeding', true); end if;
  select value into got from settings where key = 'modBots';
  if n is distinct from 1 or got -> 'concessionWriteMinutes' is distinct from '15'::jsonb or got -> 'concessionsPerDay' is distinct from '0'::jsonb or setting_modbots(got) is not null then raise exception 'the row was not migrated: % / %', n, got; end if;
  -- One missing: only that one is added, the other keeps its value.
  alter table settings disable trigger settings_held;
  update settings set value = old || '{"concessionsPerDay": 7}' where key = 'modBots';
  alter table settings enable trigger settings_held;
  perform migrate_modbots_concession_fields();
  select value into got from settings where key = 'modBots';
  if got -> 'concessionsPerDay' is distinct from '7'::jsonb or got -> 'concessionWriteMinutes' is distinct from '15'::jsonb then raise exception 'a field the row held was changed, or the missing one not added: %', got; end if;
  -- Called with the setting off, it is off again afterwards.
  alter table settings disable trigger settings_held;
  update settings set value = old where key = 'modBots';
  alter table settings enable trigger settings_held;
  perform set_config('kayfabb.seeding', 'off', true);
  if migrate_modbots_concession_fields() is distinct from 1 then raise exception 'the row to migrate was not migrated with the setting off'; end if;
  if current_setting('kayfabb.seeding', true) is distinct from 'off' then raise exception 'the migration left kayfabb.seeding as %, not off', current_setting('kayfabb.seeding', true); end if;
  perform set_config('kayfabb.seeding', 'on', true);
  -- A row that has both is left as it was.
  update settings set value = was where key = 'modBots';
  if migrate_modbots_concession_fields() is distinct from 0 or (select value from settings where key = 'modBots') is distinct from was then raise exception 'a complete row was touched'; end if;
  perform set_config('kayfabb.seeding', 'off', true);
end $$;

-- ---- 12. A player's reply to the concession post is found waiting for the Mod, and nothing in it is changed ----
do $$
declare
  poster uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  mod uuid := pg_temp.modchar('cp-m3');
  t uuid := tests.thread('Cp reply');
  p uuid := tests.post(poster, t, 'A post for a reply to the concession.');
  v uuid := pg_temp.visit(p, 'cp-m3');
  caster uuid := pg_temp.chr('Cp Ann B');
  conc uuid;
  reply uuid;
  since timestamptz := now() - interval '2 days';
  before_acts bigint;
  before_answered bigint := (select count(*) from pool_answered);
begin
  perform place_cast(caster, 'cp-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  conc := (select post_act from visit_concession_posts where visit_act = v);
  if conc is null then raise exception 'no concession post to reply to'; end if;
  if exists (select 1 from pool_waiting_in_thread(t, array['cp-m3'], since) w where w.act is not null) then raise exception 'something waited before any reply'; end if;
  reply := tests.act(poster, 'post', t, jsonb_build_object('body', 'A reply to the concession.'), conc);
  before_acts := (select count(*) from acts);
  if (select count(*) from pool_waiting_in_thread(t, array['cp-m3'], since) w where w.act = reply and w.staff = 'cp-m3' and w.author = poster) is distinct from 1::bigint then
    raise exception 'a reply to the concession post is not found waiting for its Mod: %', (select jsonb_agg(to_jsonb(w)) from pool_waiting_in_thread(t, array['cp-m3'], since) w);
  end if;
  if (select count(*) from acts) is distinct from before_acts or (select count(*) from pool_answered) is distinct from before_answered then raise exception 'finding the reply changed something'; end if;
  -- The concession post itself waits for no one: a Mod's post to a post is not a reply to the Mod.
  if exists (select 1 from pool_waiting_in_thread(t, array['cp-m3'], since) w where w.act = conc) then raise exception 'the concession post counted as waiting'; end if;
end $$;

-- ---- 13. visit_concession_post: the concession post's id, for anyone, and nothing else ----
do $$
declare
  author uuid := pg_temp.chr('Cp Bob A');
  ann uuid := pg_temp.chr('Cp Ann A');
  t uuid := tests.thread('Cp public read');
  v_done uuid := pg_temp.visit(tests.post(author, t, 'Talked down, and posted.'), 'cp-m2');
  v_open uuid := pg_temp.visit(tests.post(author, t, 'Not talked down.'), 'cp-m2');
  v_refused uuid := pg_temp.visit(tests.post(author, t, 'Talked down, post refused.'), 'cp-m4');
  posted uuid;
  got uuid;
  why text;
begin
  perform pg_temp.try(ann, v_done);
  execute format($f$create function pg_temp.plant_refusal() returns trigger language plpgsql as $b$ begin raise exception 'planted refusal' using errcode = 'P0001'; end $b$ $f$);
  execute format('create trigger cp_plant_refusal after insert on acts for each row when (new.kind = %L and new.character = %L) execute function pg_temp.plant_refusal()', 'post', pg_temp.modchar('cp-m4'));
  perform pg_temp.try(ann, v_refused);
  drop trigger cp_plant_refusal on acts;
  select r.post_act into posted from visit_concession_posts r where r.visit_act = v_done;
  if posted is null then raise exception 'the world posted no concession'; end if;
  if (select r.error from visit_concession_posts r where r.visit_act = v_refused) is null then raise exception 'the refused visit has no error recorded'; end if;
  -- Signed in and anonymous callers alike are answered the post's id, and nothing from a refused or missing row.
  perform tests.become(pg_temp.ann());
  got := visit_concession_post(v_done);
  perform tests.unbecome();
  if got is distinct from posted then raise exception 'a player was answered % (want %)', got, posted; end if;
  perform tests.become_anon();
  got := visit_concession_post(v_done);
  if got is distinct from posted then raise exception 'an anonymous caller was answered % (want %)', got, posted; end if;
  if visit_concession_post(v_open) is not null then raise exception 'a visit not talked down answered a post'; end if;
  if visit_concession_post(v_refused) is not null then raise exception 'a refused post answered an id'; end if;
  if visit_concession_post(gen_random_uuid()) is not null then raise exception 'an unknown visit answered a post'; end if;
  why := pg_temp.refusal('select * from visit_concession_posts');
  perform tests.unbecome();
  if why is null or why !~ '^42501' then raise exception 'an anonymous caller read the table: %', why; end if;
  if has_function_privilege('public', 'visit_concession_post(uuid)', 'execute') is not true and not has_function_privilege('anon', 'visit_concession_post(uuid)', 'execute') then raise exception 'anon cannot call it'; end if;
  if not has_function_privilege('authenticated', 'visit_concession_post(uuid)', 'execute') or not has_function_privilege('service_role', 'visit_concession_post(uuid)', 'execute') then raise exception 'a signed-in caller or the service cannot call it'; end if;
  if pg_get_function_result('visit_concession_post(uuid)'::regprocedure) is distinct from 'uuid' then raise exception 'it answers more than an id'; end if;
end $$;
