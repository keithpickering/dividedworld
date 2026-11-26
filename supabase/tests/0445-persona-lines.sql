-- A persona's stock lines and the settings that hold them (supabase/migrations/0445_persona_lines.sql, part 1; docs/plans/2026-11-25-persona-lines-plan.md, Task 3; design sections 1.2 and 1.5).
--
-- 1. system_line picks from the set of the speaker: the persona's own `personaLines`, else the instance's `systemLines`, else the move's plain words as it always has.
--    `speaker` names the set where the poster is not the staff key whose name fills `{boss}`.
-- 2. visit_line, report_line and appeal_line, each with its staff key, and boss_request_reply with its Boss, pick the same way (and say the plain words, or say nothing, where neither set has the key).
-- 3. say_in_thread's existence check reads the speaker's set: a line only the persona has is said, and one nobody has is not.
-- 4. say_move_end (owing its line, paid here from stock): a superseded end said by the current Boss reads the Boss's set with `{boss}` naming the move's maker; any other end reads the maker's.
-- 5. settings_held refuses personaLines that is not an object of objects of non-empty lists of non-blank lines, and owedLines that is not {graceMinutes 1..1440, perDay 0..10000, perRun 1..200} as whole numbers.
-- 6. stock_lines is no client's to call.

create function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '%: got "%", wanted "%"', label, got, want; end if;
end $$;

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

-- Sets the instance's lines and the personas' (null deletes the row: that set is absent, as before 0445).
create function pg_temp.sets(instance jsonb, personas jsonb) returns void language plpgsql as $$
begin
  if instance is null then delete from settings where key = 'systemLines';
  else insert into settings (key, value) values ('systemLines', instance) on conflict (key) do update set value = excluded.value; end if;
  if personas is null then delete from settings where key = 'personaLines';
  else insert into settings (key, value) values ('personaLines', personas) on conflict (key) do update set value = excluded.value; end if;
end $$;

create function pg_temp.body(act uuid) returns text language sql as $$ select a.payload ->> 'body' from acts a where a.id = act $$;

-- ---- 0. The world: a Boss (tl-b) and two Mods (tl-a, tl-c) ----
do $$
declare seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Instance: {move}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule', 'renameBoard', 'the renaming of a board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Pl Gabe', 'title', 'Made this. Sorry.'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'tl-b',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'tl-b', 'name', 'Tl Bee', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'tl-a', 'name', 'Tl Aye', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'tl-c', 'name', 'Tl Cee', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('tl-a', 'tl-c'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
                                 jsonb_build_object('key', 'renameBoard', 'structural', true), jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  if current_boss() is distinct from 'tl-b' then raise exception 'the world: the Boss is %', current_boss(); end if;
end $$;

-- ---- 1. system_line: the persona's set, the instance's, then the move's words ----
do $$
begin
  perform pg_temp.sets('{"moveLanded": ["Instance: {move}."]}', '{"tl-a": {"moveLanded": ["A says {move}."]}}');
  perform pg_temp.expect('the persona''s own set', system_line('moveLanded', 'setRule', '{}', 'tl-a'), 'A says a rule.');
  perform pg_temp.expect('a staff with no set gets the instance''s line', system_line('moveLanded', 'setRule', '{}', 'tl-c'), 'Instance: a rule.');
  perform pg_temp.expect('a key the persona has no line for gets the instance''s', system_line('moveLanded', 'setRule', '{}', 'tl-b'), 'Instance: a rule.');
  perform pg_temp.expect('the speaker''s set, not the staff key''s', system_line('moveLanded', 'setRule', '{}', 'tl-c', 'tl-a'), 'A says a rule.');
  perform pg_temp.expect('the speaker''s set, named', system_line('moveLanded', 'setRule', '{}', 'tl-a', speaker => 'tl-c'), 'Instance: a rule.');
  -- A persona's set with other keys but not this one is no set for this key.
  perform pg_temp.sets('{"moveLanded": ["Instance: {move}."]}', '{"tl-a": {"moveMet": ["A met."]}}');
  perform pg_temp.expect('a persona with other keys falls to the instance', system_line('moveLanded', 'setRule', '{}', 'tl-a'), 'Instance: a rule.');
  perform pg_temp.sets(null, null);
  if exists (select 1 from settings where key in ('systemLines', 'personaLines')) then raise exception 'a null set left its row behind'; end if;
  perform pg_temp.expect('neither row exists: the move''s words', system_line('moveLanded', 'setRule', '{}', 'tl-a'), 'a rule');
  perform pg_temp.expect('neither row exists, another staff', system_line('moveLanded', 'setRule', '{}', 'tl-c'), 'a rule');
  perform pg_temp.expect('neither row exists: visit_line', visit_line('visitFiled', 'tl-a', '[]'), 'Tl Aye filed this post under a breach of the rules.');
  if say_in_thread('tl-a', 'bossArrival', tests.thread('Persona none')) is not null then raise exception 'neither row exists, yet say_in_thread said something'; end if;
  perform pg_temp.expect('neither set: the move''s words', system_line('moveLanded', 'setRule', '{}', 'tl-a'), 'a rule');
  perform pg_temp.expect('neither set, another staff', system_line('moveLanded', 'setRule', '{}', 'tl-c'), 'a rule');
  perform pg_temp.sets(null, '{"tl-a": {"moveLanded": ["A says {move}."]}}');
  perform pg_temp.expect('a persona''s set with no instance set', system_line('moveLanded', 'setRule', '{}', 'tl-a'), 'A says a rule.');
  perform pg_temp.expect('another persona with no instance set', system_line('moveLanded', 'setRule', '{}', 'tl-c'), 'a rule');
end $$;

-- ---- 1b. stock_lines, called directly with poisoned settings: each falls through to the next set, or returns null ----
do $$
declare
  poison text;
begin
  -- systemLines is no held setting, and personaLines is held by a trigger that replica mode does not fire, so a scalar can be put where an object belongs.
  perform set_config('session_replication_role', 'replica', true);
  perform pg_temp.sets(null, null);
  foreach poison in array array['"a string"', '3', '{"moveLanded": "a string"}', '{"moveLanded": 3}', '{"moveLanded": []}', '{"moveLanded": [7, "x"]}', '{"moveLanded": [null]}', '[]', 'null'] loop
    perform pg_temp.sets(poison::jsonb, null);
    if stock_lines('moveLanded', 'tl-a') is not null then raise exception 'systemLines % was read as a set: %', poison, stock_lines('moveLanded', 'tl-a'); end if;
    perform pg_temp.sets(poison::jsonb, '{"tl-a": {"moveLanded": ["Persona."]}}');
    perform pg_temp.expect('a persona''s line wins over poisoned systemLines ' || poison, stock_lines('moveLanded', 'tl-a') ->> 0, 'Persona.');
    perform pg_temp.sets('{"moveLanded": ["Instance."]}', null);
  end loop;
  foreach poison in array array['"a string"', '3', '{"tl-a": "a string"}', '{"tl-a": 3}', '{"tl-a": {"moveLanded": "a string"}}', '{"tl-a": {"moveLanded": []}}', '{"tl-a": {"moveLanded": [7]}}', '{"tl-a": {"moveLanded": [null, "x"]}}', '[["moveLanded"]]'] loop
    perform pg_temp.sets('{"moveLanded": ["Instance."]}', poison::jsonb);
    perform pg_temp.expect('personaLines ' || poison || ' falls through to the instance''s', stock_lines('moveLanded', 'tl-a') ->> 0, 'Instance.');
    perform pg_temp.sets(null, poison::jsonb);
    if stock_lines('moveLanded', 'tl-a') is not null then raise exception 'personaLines % was read as a set: %', poison, stock_lines('moveLanded', 'tl-a'); end if;
  end loop;
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.sets(null, null);
end $$;

-- ---- 2. visit_line, report_line, appeal_line and boss_request_reply ----
do $$
declare
  charges jsonb := jsonb_build_array(jsonb_build_object('rule', 'Rule 1'));
  thread uuid := tests.thread('Persona thread');
  who uuid := tests.character(tests.account('tl-p-asker'), 'Tl Asker');
  asked uuid;
  said uuid;
begin
  perform pg_temp.sets('{"visitFiled": ["Instance visit {mod}."], "reportDismissed": ["Instance report {mod}/{reporter}."], "appealUpheld": ["Instance appeal {mod}/{appellant}."], "requestGranted": ["Instance grant {boss}/{asker}."]}',
    '{"tl-a": {"visitFiled": ["A visit {mod}."], "reportDismissed": ["A report {mod}/{reporter}."], "appealUpheld": ["A appeal {mod}/{appellant}."], "requestGranted": ["A grant {boss}."]}}');
  perform pg_temp.expect('visit, the persona', visit_line('visitFiled', 'tl-a', charges), 'A visit Tl Aye.');
  perform pg_temp.expect('visit, the instance', visit_line('visitFiled', 'tl-c', charges), 'Instance visit Tl Cee.');
  perform pg_temp.expect('report, the persona', report_line('reportDismissed', 'tl-a', 'Rep'), 'A report Tl Aye/Rep.');
  perform pg_temp.expect('report, the instance', report_line('reportDismissed', 'tl-c', 'Rep'), 'Instance report Tl Cee/Rep.');
  perform pg_temp.expect('appeal, the persona', appeal_line('appealUpheld', 'tl-a', 'App'), 'A appeal Tl Aye/App.');
  perform pg_temp.expect('appeal, the instance', appeal_line('appealUpheld', 'tl-c', 'App'), 'Instance appeal Tl Cee/App.');
  asked := tests.post(who, thread, 'Please?');
  said := boss_request_reply('tl-a', thread, asked, 'requestGranted', null);
  perform pg_temp.expect('request reply, the persona', pg_temp.body(said), 'A grant Tl Aye.');
  said := boss_request_reply('tl-c', thread, asked, 'requestGranted', null);
  if said is null or pg_temp.body(said) not like 'Instance grant Tl Cee/%' then raise exception 'request reply, the instance: %', pg_temp.body(said); end if;

  perform pg_temp.sets(null, null);
  perform pg_temp.expect('visit, neither', visit_line('visitFiled', 'tl-a', charges), 'Tl Aye filed this post under Rule 1.');
  perform pg_temp.expect('report, neither', report_line('reportDismissed', 'tl-a', 'Rep'), 'Tl Aye read Rep''s report and dismissed it.');
  perform pg_temp.expect('appeal, neither', appeal_line('appealUpheld', 'tl-a', 'App'), 'Tl Aye heard App''s appeal and upheld it.');
  if boss_request_reply('tl-a', thread, asked, 'requestGranted', null) is not null then raise exception 'a request reply with neither set said something'; end if;
end $$;

-- ---- 3. say_in_thread reads the speaker's set for its existence check ----
do $$
declare thread uuid := tests.thread('Persona arrivals');
begin
  perform pg_temp.sets(null, '{"tl-a": {"bossArrival": ["A arrives."]}}');
  if say_in_thread('tl-a', 'bossArrival', thread) is null then raise exception 'a line only the persona has was not said'; end if;
  if say_in_thread('tl-c', 'bossArrival', thread) is not null then raise exception 'a line nobody has for the speaker was said'; end if;
  perform pg_temp.sets('{"bossArrival": ["Instance arrives."]}', null);
  if say_in_thread('tl-c', 'bossArrival', thread) is null then raise exception 'the instance''s line was not said'; end if;
end $$;

-- ---- 4. say_move_end: the poster's set, {boss} the maker ----
do $$
declare
  mv uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act((select id from characters where staff = 'tl-a'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor')), null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.sets(null, '{"tl-a": {"moveSuperseded": ["A-set {boss}."], "moveMet": ["A-set met {boss}."]}, "tl-b": {"moveSuperseded": ["B-set {boss} ended {move}."]}}');
  perform say_move_end(mv, 'superseded');
  perform pay_owed_line((select max(o.id) from lines_owed o where o.cause_act = mv and o.line_key = 'moveSuperseded'), null);
  if not exists (select 1 from acts where kind = 'post' and thread = pg_temp.announcements() and payload ->> 'body' = 'B-set Tl Aye ended a rule.') then
    raise exception 'a superseded end did not read the poster''s set: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
  perform say_move_end(mv, 'met');
  perform pay_owed_line((select max(o.id) from lines_owed o where o.cause_act = mv and o.line_key = 'moveMet'), null);
  if not exists (select 1 from acts where kind = 'post' and thread = pg_temp.announcements() and payload ->> 'body' = 'A-set met Tl Aye.') then
    raise exception 'an end by the maker did not read the maker''s set: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
end $$;

-- ---- 5. settings_held: personaLines and owedLines ----
do $$
declare
  r text;
  poison text;
begin
  perform pg_temp.sets(null, null);
  for poison in select unnest(array[
    '[{"moveLanded": ["x"]}]',
    '{"tl-a": {"moveLanded": "a string"}}',
    '{"tl-a": "a string"}',
    '{"tl-a": {"moveLanded": []}}',
    '{"tl-a": {"moveLanded": ["fine", "   "]}}',
    '{"tl-a": {"moveLanded": [3]}}',
    '"words"'])
  loop
    r := pg_temp.refusal(format($q$insert into settings (key, value) values ('personaLines', %L) on conflict (key) do update set value = excluded.value$q$, poison));
    if r is null or r not like '23514:%' or r not like '%personaLines%' then raise exception 'personaLines % was not refused as a setting: %', poison, r; end if;
  end loop;
  r := pg_temp.refusal($q$insert into settings (key, value) values ('personaLines', '{"tl-a": {"moveLanded": ["Fine {move}."]}, "tl-c": {}}') on conflict (key) do update set value = excluded.value$q$);
  if r is not null then raise exception 'a good personaLines was refused: %', r; end if;

  for poison in select unnest(array[
    '{"graceMinutes": 0, "perDay": 10, "perRun": 5}',
    '{"graceMinutes": 1441, "perDay": 10, "perRun": 5}',
    '{"graceMinutes": 30, "perDay": -1, "perRun": 5}',
    '{"graceMinutes": 30, "perDay": 10001, "perRun": 5}',
    '{"graceMinutes": 30, "perDay": 10, "perRun": 0}',
    '{"graceMinutes": 30, "perDay": 10, "perRun": 201}',
    '{"graceMinutes": 30, "perDay": 10, "perRun": 2.5}',
    '{"graceMinutes": 30.5, "perDay": 10, "perRun": 5}',
    '{"graceMinutes": 30, "perDay": 10}',
    '{"graceMinutes": "30", "perDay": 10, "perRun": 5}',
    '[30, 10, 5]'])
  loop
    r := pg_temp.refusal(format($q$insert into settings (key, value) values ('owedLines', %L) on conflict (key) do update set value = excluded.value$q$, poison));
    if r is null or r not like '23514:%' or r not like '%owedLines%' then raise exception 'owedLines % was not refused as a setting: %', poison, r; end if;
  end loop;
  foreach poison in array array['{"graceMinutes": 1, "perDay": 0, "perRun": 1}', '{"graceMinutes": 1440, "perDay": 10000, "perRun": 200}', '{"graceMinutes": 30, "perDay": 40, "perRun": 20}'] loop
    r := pg_temp.refusal(format($q$insert into settings (key, value) values ('owedLines', %L) on conflict (key) do update set value = excluded.value$q$, poison));
    if r is not null then raise exception 'a good owedLines % was refused: %', poison, r; end if;
  end loop;
end $$;

-- ---- 6. stock_lines is no client's to call ----
do $$
begin
  if has_function_privilege('anon', 'stock_lines(text, text)', 'execute') or has_function_privilege('authenticated', 'stock_lines(text, text)', 'execute')
     or has_function_privilege('public', 'stock_lines(text, text)', 'execute') then
    raise exception 'a client can run stock_lines';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'stock_lines' and p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) then
    raise exception 'stock_lines is not stable, security definer, with its search_path pinned';
  end if;
end $$;
