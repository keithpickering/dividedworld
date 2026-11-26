-- Owed lines: the tables, the debt and the grace (supabase/migrations/0445_persona_lines.sql, part 2; docs/plans/2026-11-25-persona-lines-plan.md, Task 4; design sections 1.1, 1.3, 3 and 4).
--
-- 1. A move that ends owes its key by its maker and posts nothing; pay_owed_line(id, 'Hi.') posts it as the maker and pays `voiced`; a second call writes nothing.
-- 2. A superseded end is owed by the current Boss, and facts.maker is the move's staff.
-- 3. A request's lapse owes requestLapsed by the Boss, its ruling has no post_act, and staff_requests_now shows the paid act.
-- 4. A handover owes bossArrival by the new Boss; season_news shows the arrival once it is paid, and the handover's row records it.
-- 5. The tick's grace pays `stock` from the speaker's set at grace + 1 minute and leaves a line at grace - 1 minute.
-- 6. A speaker that cannot post pays `unsaid` with a reason, and the line leaves the queue.
-- 7. With The System off, the grace pays `unsaid` and posts nothing.
-- 8. No client reads lines_owed, lines_owed_open or lines_paid, and none of the functions is a client's to call.
-- 6b. A speaker locked out of the thread pays unsaid as well.
-- 9. The staff run's reads: owed_lines_due (a jsonb array, oldest first, failed rows last, with the office now) and standing_order_line_calls_today; staff_call_records takes the duties standingOrderLine and apologyJudge.
-- 10. A line whose payment raises transiently goes behind the rest and is paid on a later tick; transient failures alone never make it unsaid, however many.
-- 11. A lapse paid after its request was hidden pays unsaid ('the request is no longer public') and posts nothing.

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
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15, 'concessionsPerDay', 60, 'concessionWriteMinutes', 15),
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

-- A landed move's own why, as the queue keeps it: a queued row whose landed_act is the move's Act.
create function pg_temp.why_of(mv uuid, staff_key text, why text) returns void language plpgsql as $$
declare m bigint := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
begin
  -- The queue's guard judges the rule as a meeting would; this row only has to exist to be the move's record.
  set local session_replication_role = replica;
  insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
  values (m, staff_key, 'setRule', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), why_of.why, now(), now() + interval '1 day', false);
  update queued_moves set landed_act = why_of.mv where meeting = m and staff = staff_key and landed_act is null;
  set local session_replication_role = origin;
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
  perform pg_temp.why_of(mv, 'tl-a', 'Too many shouting posts.');
  perform say_move_end(mv, 'met');
  oid := pg_temp.owed(mv, 'moveMet');
  if oid is null then raise exception 'a met move owed nothing'; end if;
  if (select (o.staff, o.thread, o.facts ->> 'maker') from lines_owed o where o.id = oid) is distinct from row('tl-a'::text, th, 'tl-a'::text) then
    raise exception 'the owed line is not the maker''s, in the move''s thread: %', (select to_jsonb(o) from lines_owed o where o.id = oid);
  end if;
  -- The facts are what the voiced prompt reads: the move's plain words (never its Act's id), the move's own why, and the end in plain words.
  if (select o.facts ->> 'move' from lines_owed o where o.id = oid) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' then raise exception 'facts.move is an Act id: %', (select o.facts from lines_owed o where o.id = oid); end if;
  perform pg_temp.expect('facts.move is the move''s plain words', (select o.facts ->> 'move' from lines_owed o where o.id = oid), system_line_fill(null, 'setRule', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'tl-a'));
  perform pg_temp.expect('facts.why is the move''s own why', (select o.facts ->> 'why' from lines_owed o where o.id = oid), 'Too many shouting posts.');
  perform pg_temp.expect('facts.ended is the end in plain words', (select o.facts ->> 'ended' from lines_owed o where o.id = oid), 'it was met');
  perform pg_temp.expect('the end is owed against the move''s Act', (select o.cause_act::text from lines_owed o where o.id = oid), mv::text);
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

-- ---- 6b. A speaker locked out of the thread pays unsaid, and posts nothing ----
do $$
declare
  th uuid := tests.thread('Owed locked out');
  a uuid := tests.character(tests.account('tl-p-locker'), 'Tl Locker');
  held uuid := tests.post(a, th, 'Held.');
  mv uuid := pg_temp.move_of('tl-a', th);
  oid bigint;
  before_n bigint := pg_temp.posts_in(th);
begin
  perform pg_temp.sets('{"moveMet": ["Instance met {move}."]}', null);
  perform tests.act(a, 'spring', th, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', th, '{}', held)::text,
    'locks', (select id from characters where staff = 'tl-a')::text, 'until', (now() + interval '1 day')::text), held);
  if locked_out_until((select id from characters where staff = 'tl-a'), th) is null then raise exception 'the world: the Mod is not locked out of the thread'; end if;
  perform say_move_end(mv, 'met');
  oid := pg_temp.owed(mv, 'moveMet');
  perform pay_owed_line(oid, 'Anything.');
  if (select (p.how, p.act is null, p.reason like '%locked out of this thread%') from lines_paid p where p.owed = oid) is distinct from row('unsaid'::text, true, true) then
    raise exception 'a speaker locked out of the thread did not pay unsaid with the lockout as its reason: %', (select to_jsonb(p) from lines_paid p where p.owed = oid);
  end if;
  if exists (select 1 from lines_owed_open where owed = oid) or pg_temp.posts_in(th) is distinct from before_n then raise exception 'the locked-out line is still queued or was posted'; end if;
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
  why text;
begin
  foreach t in array array['lines_owed', 'lines_owed_open', 'lines_paid'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then raise exception '% has no row level security', t; end if;
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') or has_table_privilege('public', t, 'select') then raise exception 'a client can select from %', t; end if;
  end loop;
  foreach f in array array['anon', 'authenticated'] loop
    foreach t in array array['lines_owed', 'lines_owed_open', 'lines_paid'] loop
      execute format('set local role %I', f);
      why := pg_temp.refusal(format('select count(*) from %I', t));
      reset role;
      if why is null or why not like '42501:%' then raise exception '% could read %: %', f, t, why; end if;
    end loop;
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
  -- And every duty a staff run records, the apology judge's among them (#1140: supabase/functions/staff/apology.ts records apologyJudge).
  perform record_staff_call(b, 'apologyJudge', 'tl-a', '{}'::jsonb);
  if not exists (select 1 from staff_call_records r where r.duty = 'apologyJudge') then raise exception 'staff_call_records did not take the duty apologyJudge'; end if;
end $$;

-- ---- 10. A transient failure sends a line behind the rest; it is paid on a later tick, and never unsaid for failing ----
create function pg_temp.flaky() returns trigger language plpgsql as $$
begin
  if new.kind = 'post' and new.thread::text = current_setting('owed.fail_thread', true) then
    raise exception 'a lock timeout, as the staff post could meet' using errcode = '55P03';
  end if;
  return new;
end $$;

do $$
declare
  ta uuid := tests.thread('Owed flaky a');
  tb uuid := tests.thread('Owed flaky b');
  ma uuid := pg_temp.move_of('tl-a', ta);
  mb uuid := pg_temp.move_of('tl-a', tb);
  mc uuid := pg_temp.move_of('tl-a', tb);
  md uuid := pg_temp.move_of('tl-a', tb);
  ia bigint; ib bigint; ic bigint; id_ bigint;
  i integer;
  tick jsonb;
begin
  perform pg_temp.sets('{"moveMet": ["Instance met {move}."]}', null);
  delete from lines_owed_open where owed in (select owed from lines_owed_open);
  perform say_move_end(ma, 'met'); perform say_move_end(mb, 'met'); perform say_move_end(mc, 'met');
  ia := pg_temp.owed(ma, 'moveMet'); ib := pg_temp.owed(mb, 'moveMet'); ic := pg_temp.owed(mc, 'moveMet');
  update lines_owed_open set at = now() - interval '40 minutes' where owed = ia;
  update lines_owed_open set at = now() - interval '35 minutes' where owed = ib;
  update lines_owed_open set at = now() - interval '30 minutes' where owed = ic;
  create trigger owed_flaky before insert on acts for each row execute function pg_temp.flaky();
  perform set_config('owed.fail_thread', ta::text, false);
  tick := system_tick();
  if (select count(*) from lines_paid p where p.owed in (ib, ic) and p.how = 'stock') is distinct from 2::bigint then raise exception 'the lines behind the failing one were not paid: %', tick; end if;
  if exists (select 1 from lines_paid p where p.owed = ia) then raise exception 'a line that failed transiently was paid on the first failure'; end if;
  if (select (o.attempts, o.failed_at is not null) from lines_owed_open o where o.owed = ia) is distinct from row(1, true) then raise exception 'the failure was not recorded on the queue row: %', (select to_jsonb(o) from lines_owed_open o where o.owed = ia); end if;
  -- A line owed later is read before the one that failed.
  perform say_move_end(md, 'met');
  id_ := pg_temp.owed(md, 'moveMet');
  update lines_owed_open set at = now() - interval '20 minutes' where owed = id_;
  if (owed_lines_due(10) -> 0 ->> 'id')::bigint is distinct from id_ or (owed_lines_due(10) -> 1 ->> 'id')::bigint is distinct from ia then raise exception 'the failed line is not behind the others: %', owed_lines_due(10); end if;
  -- Many more failures: still queued, never unsaid.
  for i in 1..7 loop
    perform system_tick();
  end loop;
  if (select o.attempts from lines_owed_open o where o.owed = ia) < 6 then raise exception 'the failing line was not tried on each tick'; end if;
  if exists (select 1 from lines_paid p where p.owed = ia) then raise exception 'transient failures alone paid the line: %', (select to_jsonb(p) from lines_paid p where p.owed = ia); end if;
  -- The failure passes: a later tick pays it from stock.
  perform set_config('owed.fail_thread', '', false);
  perform system_tick();
  if (select p.how from lines_paid p where p.owed = ia) is distinct from 'stock' then raise exception 'the line was not paid from stock once the failure passed: %', (select to_jsonb(p) from lines_paid p where p.owed = ia); end if;
  drop trigger owed_flaky on acts;
end $$;

-- ---- 11. A lapse paid after its request was hidden pays unsaid and posts nothing ----
do $$
declare
  th uuid := tests.thread('Owed lapse hidden');
  asker uuid := tests.character(tests.account('tl-p-hidden'), 'Tl Hidden');
  req uuid := tests.post(asker, th, 'Do a thing?');
  admin_a uuid := tests.account('tl-p-admin');
  turn uuid;
  rid bigint;
  oid bigint;
  paid jsonb;
  before_n bigint;
begin
  perform pg_temp.sets('{"requestLapsed": ["{boss} says to {asker}: lapsed."]}', null);
  perform set_config('kayfabb.staff_writer', 'on', true);
  turn := tests.post((select id from characters where staff = 'tl-a'), th, 'I will ask the Boss.');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (req, th, asker, 'tl-a', turn, 'confer', 'mod') returning id into rid;
  update staff_requests_open set at = now() - interval '4 days' where request = rid;
  perform system_tick();
  oid := (select o.id from lines_owed o where o.request = rid and o.line_key = 'requestLapsed');
  if oid is null then raise exception 'the lapse owed nothing'; end if;
  before_n := pg_temp.posts_in(th);
  insert into admins (account) values (admin_a) on conflict do nothing;
  perform tests.become(admin_a);
  perform decide(null, req, 'hide', null, 'hidden');
  perform tests.unbecome();
  if staff_request_post_public(req) then raise exception 'the world: the request is still public'; end if;
  paid := pay_owed_line(oid, 'A voiced lapse.');
  if (select (p.how, p.act is null, p.reason) from lines_paid p where p.owed = oid) is distinct from row('unsaid'::text, true, 'the request is no longer public'::text) then
    raise exception 'a lapse for a hidden request was not paid unsaid: %', (select to_jsonb(p) from lines_paid p where p.owed = oid);
  end if;
  if pg_temp.posts_in(th) is distinct from before_n then raise exception 'a lapse line was posted for a hidden request'; end if;
end $$;

-- ---- 12. The staff run is not handed a hidden request's words: owed_lines_due leaves the asker and the body off a lapse whose request is no longer public, and keeps the row, so pay_owed_line pays it unsaid ----
do $$
declare
  th uuid := tests.thread('Owed lapse due hidden');
  asker uuid := tests.character(tests.account('tl-p-duehid'), 'Tl Duehid');
  req uuid := tests.post(asker, th, 'A secret request body?');
  admin_a uuid := (select u.id from auth.users u where u.email = 'tl-p-admin@test.invalid');
  turn uuid;
  rid bigint;
  oid bigint;
  row_ jsonb;
begin
  perform pg_temp.sets('{"requestLapsed": ["{boss} says to {asker}: lapsed."]}', null);
  perform set_config('kayfabb.staff_writer', 'on', true);
  turn := tests.post((select id from characters where staff = 'tl-a'), th, 'I will ask the Boss.');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (req, th, asker, 'tl-a', turn, 'confer', 'mod') returning id into rid;
  update staff_requests_open set at = now() - interval '4 days' where request = rid;
  perform system_tick();
  oid := (select o.id from lines_owed o where o.request = rid and o.line_key = 'requestLapsed');
  if oid is null then raise exception 'the lapse owed nothing'; end if;
  select r into row_ from jsonb_array_elements(owed_lines_due(100)) r where (r ->> 'id')::bigint = oid;
  if row_ -> 'facts' ->> 'body' is distinct from 'A secret request body?' or row_ -> 'facts' ->> 'asker' is distinct from 'Tl Duehid' then
    raise exception 'a public request''s facts are not handed over: %', row_;
  end if;
  insert into admins (account) values (admin_a) on conflict do nothing;
  perform tests.become(admin_a);
  perform decide(null, req, 'hide', null, 'hidden');
  perform tests.unbecome();
  select r into row_ from jsonb_array_elements(owed_lines_due(100)) r where (r ->> 'id')::bigint = oid;
  if row_ is null then raise exception 'the row of a hidden request left the queue read'; end if;
  if row_ -> 'facts' ? 'body' or row_ -> 'facts' ? 'asker' or row_::text like '%secret request%' or row_::text like '%Duehid%' then
    raise exception 'owed_lines_due handed the staff run a hidden request''s words: %', row_;
  end if;
end $$;

-- ---- 13. A lapse's words are read at due time: a request edited after the lapse is handed over as it reads now ----
do $$
declare
  th uuid := tests.thread('Owed lapse edited');
  asker uuid := tests.character(tests.account('tl-p-edited'), 'Tl Edited');
  req uuid := tests.post(asker, th, 'The first words?');
  turn uuid;
  rid bigint;
  oid bigint;
  row_ jsonb;
begin
  perform pg_temp.sets('{"requestLapsed": ["{boss} says to {asker}: lapsed."]}', null);
  perform set_config('kayfabb.staff_writer', 'on', true);
  turn := tests.post((select id from characters where staff = 'tl-a'), th, 'I will ask the Boss.');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (req, th, asker, 'tl-a', turn, 'confer', 'mod') returning id into rid;
  update staff_requests_open set at = now() - interval '4 days' where request = rid;
  perform system_tick();
  oid := (select o.id from lines_owed o where o.request = rid and o.line_key = 'requestLapsed');
  if oid is null then raise exception 'the lapse owed nothing'; end if;
  perform pg_temp.expect('the stored copy is the words at the lapse', (select o.facts ->> 'body' from lines_owed o where o.id = oid), 'The first words?');
  perform tests.act(asker, 'edit', th, '{"body": "The second words?"}', req);
  select r into row_ from jsonb_array_elements(owed_lines_due(100)) r where (r ->> 'id')::bigint = oid;
  perform pg_temp.expect('owed_lines_due hands the request as it reads now', row_ -> 'facts' ->> 'body', 'The second words?');
  perform pg_temp.expect('the asker is read now too', row_ -> 'facts' ->> 'asker', 'Tl Edited');
  perform pg_temp.expect('the stored copy stays as the record', (select o.facts ->> 'body' from lines_owed o where o.id = oid), 'The first words?');
end $$;

-- ---- 14. hand_over's pay-at-once branch: no farewell said (no words, no bossFarewell line) and a bossArrival line pays the arrival from stock at once, as the thread's one post; with no arrival line at all no thread is kept ----
do $$
declare
  open_id bigint := (select id from seasons where ends_at is null);
  out_boss text := current_boss();
  answer jsonb;
  h record;
begin
  if farewell_words(out_boss, open_id, true) is not null then raise exception 'the world: the outgoing Boss has farewell words'; end if;
  perform pg_temp.sets('{"bossArrival": ["Arrived: {boss}."]}', null);
  if stock_lines('bossFarewell', out_boss) is not null then raise exception 'the world: the outgoing Boss has a farewell line'; end if;
  answer := hand_over(open_id, out_boss, now(), true);
  if answer ->> 'boss' is null or answer ->> 'boss' = out_boss then raise exception 'the handover seated no new Boss: %', answer; end if;
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  if h.thread is null then raise exception 'the handover kept no thread: %', to_jsonb(h); end if;
  if pg_temp.posts_in(h.thread) is distinct from 1::bigint then raise exception 'the thread does not hold exactly one post: %', pg_temp.posts_in(h.thread); end if;
  perform pg_temp.expect('the arrival was paid from stock', (select p.how from lines_owed w join lines_paid p on p.owed = w.id where w.line_key = 'bossArrival' and w.facts ->> 'handover' = h.id::text), 'stock');
  if h.arrival_act is null or h.arrival_act is distinct from (select p.act from lines_owed w join lines_paid p on p.owed = w.id where w.line_key = 'bossArrival' and w.facts ->> 'handover' = h.id::text) then
    raise exception 'the handover does not record the arrival it paid: %', to_jsonb(h);
  end if;
  perform pg_temp.expect('the arrival is the stock line', pg_temp.body(h.arrival_act), 'Arrived: ' || (select c.name from characters c where c.staff = answer ->> 'boss') || '.');

  -- No arrival line at all (neither set): nothing can be posted, so no thread is kept and the row records none.
  perform pg_temp.sets(null, null);
  delete from settings where key = 'systemLines';
  out_boss := current_boss();
  answer := hand_over(open_id, out_boss, now(), false);
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  if h.thread is not null or h.arrival_act is not null then raise exception 'a handover with nothing to say kept a thread: %', to_jsonb(h); end if;
  if exists (select 1 from lines_owed w where w.line_key = 'bossArrival' and w.facts ->> 'handover' = h.id::text) then raise exception 'a handover with no arrival line owed one'; end if;
end $$;
