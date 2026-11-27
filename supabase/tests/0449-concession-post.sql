-- A talked-down Mod posts its concession in the thread (supabase/migrations/0449_concession_post.sql; docs/plans/2026-11-24-concession-post-design.md; its plan, Task 1).
--
-- What 0451_outcome_posts.sql replaced (the talk-down's post, the concession row and its pending mark, write_visit_concession, post_concession, visit_concession_post) is asserted in 0451-outcome-posts.sql and its race file; what stands is asserted here:
-- 2a. The line is drawn from the visit's id alone (concession_line_index), negative hashes included.
-- 10. visit_concessions, visit_concession_posts and staff_concessions refuse what they must and no client role reads them (the tables stand as written).
-- 11. The modBots check refuses a missing or negative concessionsPerDay and a concessionWriteMinutes of 0, each naming the field; a stored row without them is given them.
-- Beside: the seed's staff_concessions and a reseed's replacement.

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

-- A visit's concession and its post's record, as 0449 wrote them (nothing writes them now): rows for the refusals below to meet.
do $$
declare
  v uuid := pg_temp.visit(tests.post(pg_temp.chr('Cp Bob A'), tests.thread('Cp tables'), 'A post.'), 'cp-m2');
begin
  insert into visit_concessions (visit_act, source, body) values (v, 'model', 'A line.');
  insert into visit_concession_posts (visit_act, source, error) values (v, 'stock', 'planted');
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
  if has_function_privilege('authenticated', 'pending_concessions(integer)', 'execute') or has_function_privilege('anon', 'pending_concessions(integer)', 'execute')
     or has_function_privilege('authenticated', 'concession_calls_today()', 'execute') or has_function_privilege('authenticated', 'backfill_visit_concessions()', 'execute') then
    raise exception 'a client can call a concession writer or a staff read';
  end if;
  if not (has_function_privilege('service_role', 'pending_concessions(integer)', 'execute')
          and has_function_privilege('service_role', 'concession_calls_today()', 'execute')) then
    raise exception 'the service cannot call a concession function';
  end if;
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
