-- Owed lines: the tables, the debt and the grace (supabase/migrations/0442_persona_lines.sql, part 2; docs/plans/2026-11-25-persona-lines-plan.md, Task 4; design sections 1.1, 1.3, 3 and 4).
--
-- 1. A move that ends owes its key by its maker and posts nothing; pay_owed_line(id, 'Hi.') posts it as the maker and pays `voiced`; a second call writes nothing.
-- 2. A superseded end is owed by the current Boss, and facts.maker is the move's staff.
-- 3. A request's lapse owes requestLapsed by the Boss, its ruling has no post_act, and staff_requests_now shows the paid act.
-- 4. A handover owes bossArrival by the new Boss; season_news shows the arrival once it is paid, and the handover's row records it.
-- 5. The tick's grace pays `stock` from the speaker's set at grace + 1 minute and leaves a line at grace - 1 minute.
-- 6. A speaker that cannot post pays `unsaid` with a reason, and the line leaves the queue.
-- 7. With The System off, the grace pays `unsaid` and posts nothing.
-- 8. No client reads lines_owed, lines_owed_open or lines_paid, and none of the functions is a client's to call.
-- 9. The staff run's reads: owed_lines_due (a jsonb array, oldest first, failed rows last, with the office now) and standing_order_line_calls_today; staff_call_records takes the duty standingOrderLine.

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

-- Sets the instance's lines and the personas' (null removes the row's value: neither set).
create function pg_temp.sets(instance jsonb, personas jsonb) returns void language plpgsql as $$
begin
  insert into settings (key, value) values ('systemLines', coalesce(instance, '{}'::jsonb)) on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('personaLines', coalesce(personas, '{}'::jsonb)) on conflict (key) do update set value = excluded.value;
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


create function pg_temp.owed(cause uuid, key text) returns bigint language sql as $$
  select max(o.id) from lines_owed o where o.cause_act = owed.cause and o.line_key = owed.key
$$;
create function pg_temp.posts_in(t uuid) returns bigint language sql as $$ select count(*) from acts a where a.thread = posts_in.t and a.kind = 'post' $$;
-- A move of a staff member's, as a landed move is written, in a thread of its own.
create function pg_temp.move_of(staff_key text, thread uuid) returns uuid language plpgsql as $$
declare mv uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act((select id from characters where staff = staff_key), 'move', thread,
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor')), null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return mv;
end $$;

-- ---- 1. A met move owes its line by its maker, and posts nothing ----
do $$
declare
  th uuid := tests.thread('Owed one');
  mv uuid := pg_temp.move_of('tl-a', th);
  oid bigint;
  paid jsonb;
  again jsonb;
  posted uuid;
begin
  perform pg_temp.sets('{"moveMet": ["Instance met {move}."]}', null);
  perform say_move_end(mv, 'met');
  oid := pg_temp.owed(mv, 'moveMet');
  if oid is null then raise exception 'a met move owed nothing'; end if;
  if (select (o.staff, o.thread, o.facts ->> 'maker', o.facts ->> 'why', o.facts ->> 'move') from lines_owed o where o.id = oid) is distinct from row('tl-a'::text, th, 'tl-a'::text, 'met'::text, mv::text) then
    raise exception 'the owed line is not the maker''s, in the move''s thread, with its facts: %', (select to_jsonb(o) from lines_owed o where o.id = oid);
  end if;
  if not exists (select 1 from lines_owed_open where owed = oid) then raise exception 'the owed line is not in the queue'; end if;
  if pg_temp.posts_in(th) <> 0 then raise exception 'the end posted before it was paid'; end if;
  paid := pay_owed_line(oid, 'Hi.');
  if pg_temp.posts_in(th) <> 1 then raise exception 'paying did not post once'; end if;
  posted := (paid ->> 'act')::uuid;
  perform pg_temp.expect('the paid body', pg_temp.body(posted), 'Hi.');
  if (select a.character from acts a where a.id = posted) is distinct from (select c.id from characters c where c.staff = 'tl-a') then raise exception 'the post is not the maker''s'; end if;
  if (select (p.how, p.act) from lines_paid p where p.owed = oid) is distinct from row('voiced'::text, posted) then raise exception 'the payment is not voiced with the act'; end if;
  if exists (select 1 from lines_owed_open where owed = oid) then raise exception 'a paid line is still in the queue'; end if;
  again := pay_owed_line(oid, 'Again.');
  if pg_temp.posts_in(th) <> 1 or (again ->> 'act')::uuid is distinct from posted or (select count(*) from lines_paid where owed = oid) is distinct from 1::bigint then raise exception 'a second call wrote something: %', again; end if;
  again := pay_owed_line(oid, null);
  if pg_temp.posts_in(th) <> 1 then raise exception 'a null-body second call wrote something'; end if;
end $$;

-- ---- 2. A superseded move is owed by the current Boss; the maker is the old Boss ----
do $$
declare
  th uuid := tests.thread('Owed two');
  mv uuid := pg_temp.move_of('tl-a', th);
  oid bigint;
  paid jsonb;
begin
  perform pg_temp.sets(null, '{"tl-b": {"moveSuperseded": ["B-set {boss} ended {move}."]}}');
  perform say_move_end(mv, 'superseded');
  oid := pg_temp.owed(mv, 'moveSuperseded');
  if (select (o.staff, o.facts ->> 'maker') from lines_owed o where o.id = oid) is distinct from row('tl-b'::text, 'tl-a'::text) then
    raise exception 'a superseded end is not the Boss''s with the old maker: %', (select to_jsonb(o) from lines_owed o where o.id = oid);
  end if;
  paid := pay_owed_line(oid, null);
  perform pg_temp.expect('the stock line of the poster''s set, naming the maker', pg_temp.body((paid ->> 'act')::uuid), 'B-set Tl Aye ended a rule.');
  perform pg_temp.expect('paid from stock', (select p.how from lines_paid p where p.owed = oid), 'stock');
end $$;

-- ---- 3. A lapse owes requestLapsed; the ruling has no post_act; the request's read shows the paid act ----
do $$
declare
  th uuid := tests.thread('Owed lapse');
  asker uuid := tests.character(tests.account('tl-p-lapser'), 'Tl Lapser');
  req uuid := tests.post(asker, th, 'Please do something?');
  turn uuid;
  rid bigint;
  tick jsonb;
  oid bigint;
  paid jsonb;
begin
  perform pg_temp.sets('{"requestLapsed": ["{boss} says to {asker}: lapsed."]}', null);
  perform set_config('kayfabb.staff_writer', 'on', true);
  turn := tests.post((select id from characters where staff = 'tl-a'), th, 'I will ask the Boss.');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (req, th, asker, 'tl-a', turn, 'confer', 'mod') returning id into rid;
  update staff_requests_open set at = now() - interval '4 days' where request = rid;
  tick := system_tick();
  if (tick ->> 'requestsLapsed')::integer < 1 then raise exception 'the tick lapsed nothing: %', tick; end if;
  if (select g.post_act from staff_request_rulings g where g.request = rid) is not null or not exists (select 1 from staff_request_rulings g where g.request = rid and g.ruling = 'lapsed') then
    raise exception 'the lapse ruling is missing or has a post_act';
  end if;
  oid := (select o.id from lines_owed o where o.request = rid and o.line_key = 'requestLapsed');
  if oid is null then raise exception 'the lapse owed nothing'; end if;
  if (select (o.staff, o.thread, o.target, o.facts ->> 'asker') from lines_owed o where o.id = oid) is distinct from row('tl-b'::text, th, req, 'Tl Lapser'::text) then
    raise exception 'the lapse is not the Boss''s, in the request''s thread, quoting it: %', (select to_jsonb(o) from lines_owed o where o.id = oid);
  end if;
  if (select v.post_act from staff_requests_now v where v.id = rid) is not null then raise exception 'the request reads a post before it is paid'; end if;
  paid := pay_owed_line(oid, null);
  perform pg_temp.expect('the lapse line', pg_temp.body((paid ->> 'act')::uuid), 'Tl Bee says to Tl Lapser: lapsed.');
  if (select a.target_act_id from acts a where a.id = (paid ->> 'act')::uuid) is distinct from req then raise exception 'the lapse line does not quote the request'; end if;
  if (select v.post_act from staff_requests_now v where v.id = rid) is distinct from (paid ->> 'act')::uuid then raise exception 'the request does not read the paid act'; end if;
  if (select g.post_act from staff_request_rulings g where g.request = rid) is not null then raise exception 'a ruling row was edited'; end if;
end $$;

-- ---- 4. A handover owes bossArrival by the new Boss; season_news shows it once paid ----
do $$
declare
  open_id bigint := (select id from seasons where ends_at is null);
  answer jsonb;
  h record;
  oid bigint;
  paid jsonb;
  seen record;
begin
  perform pg_temp.sets('{"bossArrival": ["Hello from {boss}."], "bossFarewell": ["Farewell from {boss}."]}', null);
  answer := hand_over(open_id, 'tl-b', now(), true);
  if answer ->> 'boss' is null or answer ->> 'boss' = 'tl-b' then raise exception 'the handover seated no new Boss: %', answer; end if;
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  oid := (select o.id from lines_owed o where o.line_key = 'bossArrival' and o.facts ->> 'handover' = h.id::text);
  if oid is null then raise exception 'the handover owed no arrival: %', (select jsonb_agg(to_jsonb(o)) from lines_owed o where o.line_key = 'bossArrival'); end if;
  if (select (o.staff, o.thread) from lines_owed o where o.id = oid) is distinct from row(answer ->> 'boss', h.thread) then raise exception 'the arrival is not the new Boss''s, in the handover''s thread'; end if;
  if exists (select 1 from acts a join characters c on c.id = a.character where a.thread = h.thread and c.staff = answer ->> 'boss') then raise exception 'the arrival was posted before it was paid'; end if;
  if h.arrival_act is not null then raise exception 'the row records an arrival that was not posted'; end if;
  if exists (select 1 from season_news(null, 20) n where n.kind = 'bossArrived' and n.thread = h.thread and n.act is not null) then raise exception 'season_news shows an arrival before it is paid'; end if;
  paid := pay_owed_line(oid, null);
  select * into seen from season_news(null, 20) n where n.kind = 'bossArrived' and n.thread = h.thread;
  if seen.act is distinct from (paid ->> 'act')::uuid or seen.quote is distinct from 'Hello from ' || (select c.name from characters c where c.staff = answer ->> 'boss') || '.' then
    raise exception 'season_news does not show the paid arrival: %', to_jsonb(seen);
  end if;
  if (select x.arrival_act from season_handovers x where x.id = h.id) is distinct from (paid ->> 'act')::uuid then raise exception 'the handover does not record the paid arrival'; end if;
  if (select count(*) from season_news(null, 20) n where n.kind = 'bossArrived' and n.thread = h.thread) is distinct from 1::bigint then raise exception 'the arrival is not shown once'; end if;
end $$;

-- ---- 5. The tick's grace: stock at grace + 1 minute, nothing at grace - 1 minute ----
do $$
declare
  th uuid := tests.thread('Owed grace');
  late uuid := pg_temp.move_of('tl-a', th);
  early uuid := pg_temp.move_of('tl-a', th);
  late_id bigint;
  early_id bigint;
  tick jsonb;
  grace integer := 15;
begin
  insert into settings (key, value) values ('owedLines', jsonb_build_object('graceMinutes', grace, 'perDay', 60, 'perRun', 20)) on conflict (key) do update set value = excluded.value;
  perform pg_temp.sets(null, '{"tl-a": {"moveExpired": ["A expired {move}."]}}');
  perform say_move_end(late, 'expired');
  perform say_move_end(early, 'expired');
  late_id := pg_temp.owed(late, 'moveExpired');
  early_id := pg_temp.owed(early, 'moveExpired');
  update lines_owed_open set at = now() - make_interval(mins => grace + 1) where owed = late_id;
  update lines_owed_open set at = now() - make_interval(mins => grace - 1) where owed = early_id;
  tick := system_tick();
  if (select (p.how) from lines_paid p where p.owed = late_id) is distinct from 'stock' then raise exception 'the late line was not paid from stock: %', tick; end if;
  perform pg_temp.expect('the speaker''s set', (select pg_temp.body(p.act) from lines_paid p where p.owed = late_id), 'A expired a rule.');
  if exists (select 1 from lines_paid p where p.owed = early_id) or not exists (select 1 from lines_owed_open where owed = early_id) then raise exception 'the early line was paid before its grace'; end if;
  tick := system_tick();
  if (select count(*) from lines_paid p where p.owed in (late_id, early_id)) is distinct from 1::bigint then raise exception 'a second tick paid again or early'; end if;
end $$;

-- ---- 6. A speaker that cannot post pays unsaid with a reason, and leaves the queue ----
do $$
declare
  th uuid := tests.thread('Owed benched');
  mv uuid := pg_temp.move_of('tl-c', th);
  oid bigint;
  paid jsonb;
begin
  perform pg_temp.sets('{"moveUnmet": ["Instance unmet {move}."]}', null);
  perform say_move_end(mv, 'unmet');
  oid := pg_temp.owed(mv, 'moveUnmet');
  insert into staff_offices (staff, office, cause) values ('tl-c', 'benched', 'admin');
  paid := pay_owed_line(oid, 'Anything.');
  if (select (p.how, p.act is null, nullif(p.reason, '') is not null) from lines_paid p where p.owed = oid) is distinct from row('unsaid'::text, true, true) then
    raise exception 'a speaker that cannot post did not pay unsaid with a reason: %', (select to_jsonb(p) from lines_paid p where p.owed = oid);
  end if;
  if exists (select 1 from lines_owed_open where owed = oid) or pg_temp.posts_in(th) <> 0 then raise exception 'the unsaid line is still queued or posted'; end if;
end $$;

-- ---- 7. The System off: the grace pays unsaid and posts nothing ----
do $$
declare
  th uuid := tests.thread('Owed off');
  mv uuid := pg_temp.move_of('tl-a', th);
  oid bigint;
begin
  perform pg_temp.sets('{"moveReversed": ["Instance reversed {move}."]}', null);
  perform say_move_end(mv, 'reversed');
  oid := pg_temp.owed(mv, 'moveReversed');
  update lines_owed_open set at = now() - interval '16 minutes' where owed = oid;
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  perform system_tick();
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
  if (select (p.how, p.act is null, p.reason) from lines_paid p where p.owed = oid) is distinct from row('unsaid'::text, true, 'The System is off'::text) then
    raise exception 'the grace with The System off did not pay unsaid: %', (select to_jsonb(p) from lines_paid p where p.owed = oid);
  end if;
  if pg_temp.posts_in(th) <> 0 then raise exception 'a post was written with The System off'; end if;
end $$;

-- ---- 8. No client reads the tables or runs the functions ----
do $$
declare
  t text;
  f text;
begin
  foreach t in array array['lines_owed', 'lines_owed_open', 'lines_paid'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then raise exception '% has no row level security', t; end if;
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') or has_table_privilege('public', t, 'select') then raise exception 'a client can select from %', t; end if;
  end loop;
  if pg_temp.refusal('delete from lines_owed') is null then raise exception 'lines_owed took a delete'; end if;
  if pg_temp.refusal('delete from lines_paid') is null then raise exception 'lines_paid took a delete'; end if;
  if pg_temp.refusal('update lines_paid set reason = ''x''') is null then raise exception 'lines_paid took an update'; end if;
  if pg_temp.refusal('update lines_owed set staff = staff') is null then raise exception 'lines_owed took an update'; end if;
  foreach f in array array['owe_line(text,text,uuid,uuid,uuid,bigint,jsonb)', 'owed_lines_due(integer)', 'pay_owed_line(bigint,text)', 'standing_order_line_calls_today()', 'pay_owed_unsaid(bigint,text)', 'owed_grace_minutes()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') or has_function_privilege('public', f, 'execute') then raise exception 'a client can run %', f; end if;
  end loop;
  foreach f in array array['owed_lines_due(integer)', 'pay_owed_line(bigint,text)', 'standing_order_line_calls_today()'] loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'the staff run cannot run %', f; end if;
  end loop;
  foreach f in array array['owe_line(text,text,uuid,uuid,uuid,bigint,jsonb)', 'pay_owed_line(bigint,text)'] loop
    if not exists (select 1 from pg_proc p where p.oid = f::regprocedure and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) then raise exception '% is not security definer with its search_path pinned', f; end if;
  end loop;
end $$;

-- ---- 9. The staff run's reads ----
do $$
declare
  th uuid := tests.thread('Owed reads');
  a uuid := pg_temp.move_of('tl-a', th);
  b uuid := pg_temp.move_of('tl-a', th);
  c uuid := pg_temp.move_of('tl-a', th);
  ia bigint;
  ib bigint;
  ic bigint;
  due jsonb;
  before integer := standing_order_line_calls_today();
begin
  perform pg_temp.sets('{"moveMet": ["Instance met {move}."]}', null);
  delete from lines_owed_open where owed in (select owed from lines_owed_open);
  perform say_move_end(a, 'met');
  perform say_move_end(b, 'met');
  perform say_move_end(c, 'met');
  ia := pg_temp.owed(a, 'moveMet'); ib := pg_temp.owed(b, 'moveMet'); ic := pg_temp.owed(c, 'moveMet');
  update lines_owed_open set at = now() - interval '3 minutes', failed_at = now() where owed = ia;
  update lines_owed_open set at = now() - interval '2 minutes' where owed = ib;
  update lines_owed_open set at = now() - interval '1 minutes' where owed = ic;
  due := owed_lines_due(2);
  if jsonb_typeof(due) <> 'array' or jsonb_array_length(due) <> 2 then raise exception 'owed_lines_due is not an array of two: %', due; end if;
  if (due -> 0 ->> 'id')::bigint <> ib or (due -> 1 ->> 'id')::bigint <> ic then raise exception 'owed_lines_due is not oldest first with failed rows last: %', due; end if;
  if (due -> 0) - 'facts' - 'thread' - 'cause_act' - 'id' - 'staff' - 'line_key' - 'office' <> '{}'::jsonb then raise exception 'owed_lines_due carries more than the run needs: %', due -> 0; end if;
  if due -> 0 ->> 'office' is distinct from (select f.office from staff_office_now f where f.staff = 'tl-a') or due -> 0 ->> 'staff' is distinct from 'tl-a' or due -> 0 ->> 'line_key' is distinct from 'moveMet' or (due -> 0 ->> 'cause_act')::uuid is distinct from b then raise exception 'owed_lines_due row: %', due -> 0; end if;
  if jsonb_array_length(owed_lines_due(10)) <> 3 then raise exception 'a failed row is not read after the others'; end if;
  if (owed_lines_due(10) -> 2 ->> 'id')::bigint <> ia then raise exception 'the failed row is not last'; end if;
  if jsonb_array_length(owed_lines_due(0)) <> 0 then raise exception 'most 0 returned rows'; end if;
  -- The day's calls are counted from the ledger.
  perform record_model_call(jsonb_build_object('duty', 'standingOrderLine', 'staff', 'tl-a', 'provider', 'anthropic', 'model', 'claude-haiku-4-5', 'cost_microdollars', 1, 'outcome', 'ok'));
  if standing_order_line_calls_today() <> before + 1 then raise exception 'the day''s standingOrderLine calls are not counted: % then %', before, standing_order_line_calls_today(); end if;
  -- staff_call_records takes the duty.
  perform record_staff_call(b, 'standingOrderLine', 'tl-a', '{}'::jsonb);
  if not exists (select 1 from staff_call_records r where r.duty = 'standingOrderLine') then raise exception 'staff_call_records did not take the duty standingOrderLine'; end if;
end $$;
