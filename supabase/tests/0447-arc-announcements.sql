-- Announcements, the staff pin and the recap (supabase/migrations/0447_arc_announcements.sql; docs/plans/2026-11-25-arc-announcements-plan.md, Task 3, part 1; its design, sections 1, 3, 4 and 8).
--
--   * A payload that plays an announced beat opens a staff thread (the Boss's post at seq 1), pins it and writes the arc_announcements row; the beat's bundle lands in that thread, and a bundle with no
--     announcement opens its move thread as 0437 wrote it (a played bundle with no announcement, as an instance holds before this migration, still lands where it did).
--   * staff_stickies lists a board's pinned threads while the season is open, and none after a roll-over; an admin unpins, a player is refused, and a thread with no live pin is refused in plain words.
--   * An announcement for a beat the meeting did not play (named by no bundle, or whose bundle was refused) is skipped with the beat named; a meeting applied again, and a meeting whose bundle was refused
--     and played properly after, give one thread, one pin and one row.
--   * An aftermath beat of the predecessor is played by the successor (by its plain key or after:<pred>:<key>), its event written under after:<pred>:<key>, its authored bundle queued, announced and landed in its thread;
--     a part's role of the predecessor's beat ({role, beat, of: 'predecessor'}) is accepted by the queue's guard and resolved at landing.
--   * The recap is kept beside the farewell and handoff within the window, trimmed to 300 characters (recorded), and checked by the table.
--
-- The world is planted as fixture rows: personas in a seed, plays and handovers written as the meeting and hand_over write them. Nothing here reads the instance's content.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 0. The world: a Boss with announced and unannounced beats (one repeatable), a predecessor with aftermath beats, and its successor ----
create function pg_temp.persona(k text, arc jsonb default '[]', aftermath jsonb default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('key', k, 'name', k, 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'arc', arc, 'aftermath', aftermath, 'holdsBack', '[]'::jsonb, 'phaseDays', '{}'::jsonb))
$$;
do $$
declare
  seed jsonb;
  never jsonb := jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never-lands'));
  reign jsonb := jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'));
  boss_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', reign),
    jsonb_build_object('key', 'picking', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split'))),
    jsonb_build_object('key', 'plain', 'mini', true, 'repeatable', false, 'unlock', reign),
    jsonb_build_object('key', 'solo', 'mini', true, 'repeatable', false, 'unlock', reign),
    jsonb_build_object('key', 'again', 'mini', true, 'repeatable', true, 'unlock', reign));
  pred_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', never),
    jsonb_build_object('key', 'everything', 'mini', false, 'repeatable', false, 'unlock', never));
  honeymoon jsonb := jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon'));
  pred_after jsonb := jsonb_build_array(
    jsonb_build_object('key', 'restore', 'mini', true, 'unlock', honeymoon),
    jsonb_build_object('key', 'tidy', 'mini', true, 'unlock', honeymoon));
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 400, 'farewellWindowHours', 36,
      'bundleMostParts', 4, 'bundleAuthoredMostParts', 8, 'seasonLength', jsonb_build_object('unit', 'day', 'count', 90),
      'phases', jsonb_build_object(
        'honeymoon', jsonb_build_object('days', 14, 'weeklyMoves', 2, 'bankCap', 4, 'moveExpiryMostDays', 7),
        'reign', jsonb_build_object('weeklyMoves', 5, 'bankCap', 10, 'moveExpiryMostDays', 28),
        'meltdown', jsonb_build_object('days', 21, 'weeklyMoves', 8, 'bankCap', 14, 'moveExpiryMostDays', 42)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.'),
        'bossFarewell', jsonb_build_array('Stock farewell.'), 'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'An Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'an-boss',
      'staff', jsonb_build_array(
        pg_temp.persona('an-boss', boss_arc), pg_temp.persona('an-pred', pred_arc, pred_after), pg_temp.persona('an-succ'),
        pg_temp.persona('an-m1'), pg_temp.persona('an-m2')),
      'firstStaff', jsonb_build_array('an-pred', 'an-succ', 'an-m1', 'an-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'conditions', jsonb_build_array(
        jsonb_build_object('key', 'phase', 'plain', 'a phase has begun, or the season is near its end'),
        jsonb_build_object('key', 'beatLanded', 'plain', 'an earlier beat''s bundle has landed'),
        jsonb_build_object('key', 'boardActivity', 'plain', 'a board''s posts over some days are above or below a number or another board'),
        jsonb_build_object('key', 'moveReversed', 'plain', 'an admin reversed one of the Boss''s moves'),
        jsonb_build_object('key', 'demandResolved', 'plain', 'one of the Boss''s moves'' demands was met or failed'))));
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('an-admin'));
  perform tests.account('an-player');
  insert into boards (slug, name, created_at) values ('elsewhere', 'Elsewhere', now() - interval '9 days');
  -- The season began a month ago: the honeymoon is over, so the reign has begun.
  update seasons set starts_at = now() - interval '30 days' where ends_at is null;
end $$;

create function pg_temp.acct(label text) returns uuid language sql as $$ select id from auth.users where email = label || '@test.invalid' $$;
create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.boss(k text) returns void language sql as $$ update seasons set boss = k where ends_at is null $$;
create function pg_temp.began(days numeric) returns void language sql as $$
  update seasons set starts_at = now() - make_interval(secs => (days * 86400)::double precision) where ends_at is null
$$;
create function pg_temp.state(staff text, beat text) returns text language sql as $$
  select e.event from arc_beat_events e where e.season = pg_temp.season() and e.staff = state.staff and e.beat = state.beat order by e.id desc limit 1
$$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
-- A part as the meeting sends it.
create function pg_temp.p(role text, kind text, params jsonb, why text default 'Because.') returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('role', role, 'kind', kind, 'params', params, 'why', why, 'go_live_at', now(), 'expires_in_hours', 0))
$$;
-- An announcement as the meeting sends it.
create function pg_temp.ann(beat text, title text, body text, pitch text default 'A pitch.', push text default 'A push.') returns jsonb language sql as $$
  select jsonb_build_object('beat', beat, 'title', title, 'body', body, 'pitch', pitch, 'push', push)
$$;
-- A meeting applied for `who`, its answer holding `bundles`, `anns` and whatever else `extra` adds; leaves the meeting and its payload in pg_temp.last.
create table pg_temp.last (meeting bigint, payload jsonb, result jsonb);
create function pg_temp.apply(who text, bundles jsonb, anns jsonb default '[]', extra jsonb default '{}') returns jsonb language plpgsql as $$
declare
  m bigint;
  r jsonb;
  pl jsonb;
begin
  insert into move_bank (staff, balance, as_of) values (who, 5, now()) on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  pl := jsonb_build_object('boss', who, 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'Done.'),
    'moves', '[]'::jsonb, 'bundles', bundles, 'announcements', anns, 'record', '{}'::jsonb) || extra;
  m := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  r := apply_meeting(m, pl);
  insert into pg_temp.last values (m, pl, r);
  return r;
end $$;
create function pg_temp.record(key text) returns jsonb language sql as $$ select m.record -> record.key from meetings m where m.id = (select max(meeting) from pg_temp.last) $$;
-- The hold a structural part waits out has run: the guard refuses to move a go-live, so it is switched off for the one update that stands for the day passing.
create function pg_temp.hold_over(bundle_name text) returns void language plpgsql as $$
begin
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where queued_moves.bundle_name = hold_over.bundle_name and landed_act is null;
  alter table queued_moves enable trigger queued_moves_guard;
end $$;
create function pg_temp.landed_in(bundle_name text) returns uuid[] language sql as $$
  select coalesce(array_agg(distinct a.thread), '{}') from queued_moves q join acts a on a.id = q.landed_act where q.bundle_name = landed_in.bundle_name
$$;
create function pg_temp.staff_threads() returns bigint language sql as $$ select count(*) from threads where staff_placed $$;
-- A part queued straight, as a predecessor's played bundle is (0446's fixture), live a minute ago.
create function pg_temp.part(who text, bundle uuid, bname text, role text, params jsonb) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, who, 'createBoard', params, null, 'because', now() - interval '1 minute', now() - interval '1 minute', true, bundle, bname, role) returning id into q;
  return q;
end $$;
create function pg_temp.play(who text, beat text, bundle uuid default null) returns void language plpgsql as $$
begin
  insert into arc_beat_events (season, staff, beat, event) values (pg_temp.season(), who, beat, 'unlocked');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (pg_temp.season(), who, beat, 'played', bundle);
end $$;

-- ---- 1. Playing an announced beat: a staff thread, the Boss's post at seq 1, the pin and the row; the bundle's two parts land in it ----
do $$
declare
  r jsonb;
  row arc_announcements;
  th uuid;
  first_act record;
  before_threads bigint;
begin
  perform arc_pass();
  perform pg_temp.expect(pg_temp.state('an-boss', 'split') = 'unlocked', 'setup: the reign has begun, so the Split has unlocked');
  before_threads := pg_temp.staff_threads();
  r := pg_temp.apply('an-boss',
    jsonb_build_array(jsonb_build_object('name', 'The Split', 'beat', 'split', 'parts', jsonb_build_array(
      pg_temp.p('minus', 'createBoard', pg_temp.mkboard('Minus One')), pg_temp.p('fan', 'createBoard', pg_temp.mkboard('Fangames'))))),
    jsonb_build_array(pg_temp.ann('split', 'Improvement Initiative #1: World -1', 'Per the board''s ongoing efforts, World -1.', 'World -1 opens soon.', 'You announced World -1.')));
  perform pg_temp.expect(r ->> 'status' = 'applied' and r -> 'beats_played' = '["split"]'::jsonb, 'the meeting was not applied with the Split played: ' || r::text);
  select * into row from arc_announcements where staff = 'an-boss' and beat = 'split';
  perform pg_temp.expect(row.id is not null, 'the Split was announced with no arc_announcements row: ' || pg_temp.record('announcementsSkipped')::text);
  perform pg_temp.expect(row.season = pg_temp.season() and row.title = 'Improvement Initiative #1: World -1' and row.pitch = 'World -1 opens soon.' and row.push = 'You announced World -1.' and not row.repeatable,
    'the row does not carry the title, pitch and push as sent: ' || to_jsonb(row)::text);
  th := row.thread;
  perform pg_temp.expect(pg_temp.staff_threads() = before_threads + 1, 'the announcement did not open exactly one staff thread');
  perform pg_temp.expect((select t.staff_placed and t.board = system_board() and t.title = row.title from threads t where t.id = th), 'the announcement thread is not a staff thread on the system board under its title');
  select a.id, a.seq, a.kind, a.payload ->> 'body' as body, c.staff into first_act from acts a join characters c on c.id = a.character where a.thread = th order by a.seq limit 1;
  perform pg_temp.expect(first_act.seq = 1 and first_act.kind = 'post' and first_act.staff = 'an-boss' and first_act.body = 'Per the board''s ongoing efforts, World -1.' and first_act.id = row.act,
    'the announcement post is not the Boss''s at seq 1: ' || to_jsonb(first_act)::text);
  perform pg_temp.expect((select count(*) from acts where thread = th) = 1, 'the thread holds more than the announcement');
  perform pg_temp.expect((select count(*) from staff_pin_events where thread = th and event = 'pinned' and season = pg_temp.season() and by is null) = 1, 'the thread was not pinned once, by the system');
  perform pg_temp.expect((select array_agg(s.thread) from staff_stickies(system_board()) s) = array[th], 'staff_stickies does not list the announcement thread');
  perform pg_temp.expect(pg_temp.record('announcementsWritten') -> 0 ->> 'thread' = th::text and pg_temp.record('announcementsSkipped') = '[]'::jsonb, 'the meeting record does not say what was written');
  perform pg_temp.expect(pg_temp.state('an-boss', 'split') = 'played', 'the Split is not played');

  -- The parts wait out their hold; the first lands in the announcement thread, and so does the second, a day later, and no move thread is opened.
  before_threads := pg_temp.staff_threads();
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where bundle_name = 'The Split' and role = 'minus';
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves where bundle_name = 'The Split' and landed_act is not null) = 1, 'the first part of the Split did not land: ' || (select string_agg(coalesce(failure, 'none'), '; ') from queued_moves where bundle_name = 'The Split'));
  perform pg_temp.hold_over('The Split');
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves where bundle_name = 'The Split' and landed_act is not null) = 2, 'the second part of the Split did not land');
  perform pg_temp.expect(pg_temp.landed_in('The Split') = array[th], 'the Split''s parts did not land in the announcement thread: ' || pg_temp.landed_in('The Split')::text);
  perform pg_temp.expect(pg_temp.staff_threads() = before_threads, 'a move thread was opened beside the announcement thread');
  perform pg_temp.expect((select array_agg(a.seq order by a.seq) from acts a where a.thread = th) = array[1, 2, 3], 'the thread''s Acts are not the announcement and the two landings');
end $$;

-- ---- 2. A bundle with no announcement opens its move thread as before, and a later part finds it again ----
do $$
declare
  r jsonb;
  mt uuid;
  before_threads bigint;
begin
  perform arc_pass();
  perform pg_temp.expect(pg_temp.state('an-boss', 'picking') = 'unlocked', 'setup: the Split landed, so picking unlocked');
  r := pg_temp.apply('an-boss', jsonb_build_array(jsonb_build_object('name', 'Picking', 'beat', 'picking', 'parts', jsonb_build_array(
    pg_temp.p(null, 'createBoard', pg_temp.mkboard('Pick A')), pg_temp.p(null, 'createBoard', pg_temp.mkboard('Pick B'))))));
  perform pg_temp.expect(r -> 'beats_played' = '["picking"]'::jsonb, 'picking was not played: ' || r::text);
  perform pg_temp.expect(not exists (select 1 from arc_announcements where beat = 'picking') and pg_temp.record('announcementsWritten') = '[]'::jsonb, 'an unannounced beat was announced');
  before_threads := pg_temp.staff_threads();
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where bundle_name = 'Picking' and (params ->> 'name') = 'Pick A';
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  perform pg_temp.expect(pg_temp.staff_threads() = before_threads + 1, 'the first part of an unannounced bundle did not open a move thread');
  mt := (pg_temp.landed_in('Picking'))[1];
  perform pg_temp.hold_over('Picking');
  perform system_tick();
  perform pg_temp.expect(pg_temp.landed_in('Picking') = array[mt] and pg_temp.staff_threads() = before_threads + 1, 'the later part did not land in the thread the first part opened: ' || pg_temp.landed_in('Picking')::text);
  perform pg_temp.expect(not exists (select 1 from arc_announcements where thread = mt) and not exists (select 1 from staff_pin_events where thread = mt), 'a move thread was announced or pinned');
  perform pg_temp.expect((select title from threads where id = mt) = move_thread_title('createBoard', (select params from queued_moves where bundle_name = 'Picking' and params ->> 'name' = 'Pick A'), 'an-boss'), 'the move thread is not titled as 0437 titles it');
end $$;

-- ---- 3. A beat with no bundle is announced too; a repeat of the meeting writes nothing twice ----
do $$
declare
  r jsonb;
  m bigint;
  pl jsonb;
  n_thr bigint;
  n_rows bigint;
  n_pin bigint;
  n_acts bigint;
begin
  r := pg_temp.apply('an-boss', jsonb_build_array(jsonb_build_object('beat', 'plain', 'parts', '[]'::jsonb)),
    jsonb_build_array(pg_temp.ann('plain', 'A plain memo', 'Only words.')));
  perform pg_temp.expect(exists (select 1 from arc_announcements where beat = 'plain' and staff = 'an-boss'), 'a beat with no bundle was not announced: ' || pg_temp.record('announcementsSkipped')::text);
  select meeting, payload into m, pl from pg_temp.last order by meeting desc limit 1;
  n_thr := pg_temp.staff_threads(); n_rows := (select count(*) from arc_announcements); n_pin := (select count(*) from staff_pin_events); n_acts := (select count(*) from acts);
  r := apply_meeting(m, pl);
  perform pg_temp.expect(r ->> 'status' = 'already applied', 'a repeat of the meeting was applied again: ' || r::text);
  perform pg_temp.expect(pg_temp.staff_threads() = n_thr and (select count(*) from arc_announcements) = n_rows and (select count(*) from staff_pin_events) = n_pin and (select count(*) from acts) = n_acts,
    'a repeat of the meeting wrote a thread, a row, a pin or an Act');
end $$;

-- ---- 4. An announcement for a beat the meeting did not play is skipped with the beat named; so is one for a beat nobody has ----
do $$
declare
  r jsonb;
  n_thr bigint := pg_temp.staff_threads();
  n_rows bigint := (select count(*) from arc_announcements);
begin
  r := pg_temp.apply('an-boss', '[]'::jsonb, jsonb_build_array(pg_temp.ann('solo', 'Solo memo', 'Words.'), pg_temp.ann('nope', 'Nope memo', 'Words.')));
  perform pg_temp.expect(r ->> 'status' = 'applied', 'an announcement for an unplayed beat failed the meeting: ' || r::text);
  perform pg_temp.expect(pg_temp.record('announcementsSkipped') -> 0 ->> 'beat' = 'solo' and pg_temp.record('announcementsSkipped') -> 0 ->> 'why' like '%"solo"%not played%', 'the unplayed beat was not named: ' || pg_temp.record('announcementsSkipped')::text);
  perform pg_temp.expect(pg_temp.record('announcementsSkipped') -> 1 ->> 'beat' = 'nope', 'the unknown beat was not named: ' || pg_temp.record('announcementsSkipped')::text);
  perform pg_temp.expect(pg_temp.staff_threads() = n_thr and (select count(*) from arc_announcements) = n_rows, 'a thread or a row was written for a beat that was not played');
  -- A malformed announcement is skipped as well.
  r := pg_temp.apply('an-boss', '[]'::jsonb, '["not an object"]'::jsonb);
  perform pg_temp.expect(jsonb_array_length(pg_temp.record('announcementsSkipped')) = 1 and r ->> 'status' = 'applied', 'a malformed announcement was not skipped: ' || pg_temp.record('announcementsSkipped')::text);
end $$;

-- ---- 5. A bundle with a refused part plays nothing and announces nothing; played properly after, it gives one thread, one pin, one row ----
do $$
declare
  r jsonb;
  n_thr bigint := pg_temp.staff_threads();
  n_pin bigint := (select count(*) from staff_pin_events);
  n_rows bigint := (select count(*) from arc_announcements);
  bad jsonb;
  good jsonb;
begin
  -- The second part names nothing the board's rules could build, so the queue refuses it, and the first part's insert goes with it.
  bad := jsonb_build_array(jsonb_build_object('name', 'Solo', 'beat', 'solo', 'parts', jsonb_build_array(pg_temp.p('a', 'createBoard', pg_temp.mkboard('Solo A')), pg_temp.p('b', 'createBoard', '{}'::jsonb))));
  good := jsonb_build_array(jsonb_build_object('name', 'Solo', 'beat', 'solo', 'parts', jsonb_build_array(pg_temp.p('a', 'createBoard', pg_temp.mkboard('Solo A')))));
  r := pg_temp.apply('an-boss', bad, jsonb_build_array(pg_temp.ann('solo', 'Solo memo', 'Words.')));
  perform pg_temp.expect(jsonb_array_length(pg_temp.record('bundlesSkipped')) = 1, 'setup: the bundle with a refused part was not skipped: ' || pg_temp.record('bundlesSkipped')::text);
  perform pg_temp.expect(pg_temp.state('an-boss', 'solo') = 'unlocked' and not exists (select 1 from queued_moves where bundle_name = 'Solo'), 'a refused bundle left a played beat or a part behind');
  perform pg_temp.expect(pg_temp.staff_threads() = n_thr and (select count(*) from staff_pin_events) = n_pin and (select count(*) from arc_announcements) = n_rows
    and pg_temp.record('announcementsSkipped') -> 0 ->> 'beat' = 'solo', 'a refused bundle was announced: ' || pg_temp.record('announcementsSkipped')::text);
  r := pg_temp.apply('an-boss', good, jsonb_build_array(pg_temp.ann('solo', 'Solo memo', 'Words.')));
  perform pg_temp.expect(pg_temp.staff_threads() = n_thr + 1 and (select count(*) from staff_pin_events) = n_pin + 1 and (select count(*) from arc_announcements) = n_rows + 1,
    'the beat played after a refused bundle did not give one thread, one pin and one row');
end $$;

-- ---- 6. A repeatable beat announces once for each play; a row is insert-only, and no play is announced twice ----
do $$
declare
  r jsonb;
  b jsonb := jsonb_build_array(jsonb_build_object('beat', 'again', 'parts', '[]'::jsonb));
  msg text;
begin
  perform arc_pass();
  r := pg_temp.apply('an-boss', b, jsonb_build_array(pg_temp.ann('again', 'Again, one', 'First time.')));
  perform pg_temp.expect((select repeatable from arc_announcements where beat = 'again'), 'a repeatable beat''s row does not say so');
  perform arc_pass();
  perform pg_temp.expect(pg_temp.state('an-boss', 'again') = 'unlocked', 'setup: the repeatable beat did not unlock again');
  r := pg_temp.apply('an-boss', b, jsonb_build_array(pg_temp.ann('again', 'Again, two', 'Second time.')));
  perform pg_temp.expect((select count(*) from arc_announcements where beat = 'again') = 2, 'a repeatable beat was not announced for its second play: ' || pg_temp.record('announcementsSkipped')::text);
  msg := pg_temp.refusal('update arc_announcements set title = ''Changed''');
  perform pg_temp.expect(msg like 'P0001%only ever added%', 'an announcement was edited: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('delete from arc_announcements');
  perform pg_temp.expect(msg like 'P0001%only ever added%', 'an announcement was deleted: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('truncate arc_announcements');
  perform pg_temp.expect(msg like 'P0001%only ever added%', 'announcements were truncated: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('insert into arc_announcements (season, staff, beat, thread, act, title, play) select season, staff, beat, thread, act, title, play from arc_announcements where beat = %L limit 1', 'split'));
  perform pg_temp.expect(msg like '23505%', 'one play was announced twice: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('insert into arc_announcements (season, staff, beat, thread, act, title, play) select season, staff, %L, thread, act, title, 999999 from arc_announcements where beat = %L limit 1', 'split', 'split'));
  perform pg_temp.expect(msg like '23514%not one of%', 'an announcement was written for a play that does not exist: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('update staff_pin_events set event = ''unpinned''');
  perform pg_temp.expect(msg like 'P0001%only ever added%', 'a pin event was edited: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('delete from staff_pin_events');
  perform pg_temp.expect(msg like 'P0001%only ever added%', 'a pin event was deleted: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('insert into arc_announcements (season, staff, beat, thread, act, title, play, pitch) select season, staff, beat, thread, act, title, play + 1000, repeat(%L, 201) from arc_announcements limit 1', 'x'));
  perform pg_temp.expect(msg like '23514%', 'a pitch over 200 characters was kept: ' || coalesce(msg, 'allowed'));
end $$;

-- ---- 7. The caller's own bounds: a pitch over 200 and a push over 300 are cut and recorded, never a lost announcement ----
do $$
declare
  r jsonb;
begin
  -- Through the repeatable beat, which can be played again.
  perform arc_pass();
  r := pg_temp.apply('an-boss', jsonb_build_array(jsonb_build_object('beat', 'again', 'parts', '[]'::jsonb)),
    jsonb_build_array(pg_temp.ann('again', 'Again, three', 'Third time.', repeat('p', 250), repeat('q', 350))));
  perform pg_temp.expect((select char_length(pitch) = 200 and char_length(push) = 300 from arc_announcements where title = 'Again, three'), 'the pitch and the push were not cut to their bounds');
  perform pg_temp.expect(jsonb_array_length(pg_temp.record('announcementsTrims')) = 2 and pg_temp.record('announcementsTrims') -> 0 ->> 'path' = 'announcements.again.pitch', 'the trims were not recorded: ' || pg_temp.record('announcementsTrims')::text);
  -- A body over postMaxLength (400 here) is cut as the minutes are.
  perform arc_pass();
  r := pg_temp.apply('an-boss', jsonb_build_array(jsonb_build_object('beat', 'again', 'parts', '[]'::jsonb)), jsonb_build_array(pg_temp.ann('again', 'Again, four', repeat('w', 500))));
  perform pg_temp.expect((select char_length(a.payload ->> 'body') = 400 from acts a join arc_announcements n on n.act = a.id where n.title = 'Again, four'), 'the body was not cut to postMaxLength');
end $$;

-- ---- 8. The pin: staff_stickies lists it for its board, an admin unpins it, a player is refused, and a thread with no live pin is refused in plain words ----
do $$
declare
  th uuid := (select thread from arc_announcements where beat = 'split');
  other uuid := (select thread from arc_announcements where beat = 'plain');
  msg text;
  e record;
begin
  perform pg_temp.expect((select count(*) from staff_stickies(system_board())) >= 3 and (select array_agg(s.thread order by s.pinned_at) from staff_stickies(system_board()) s)[1] = th, 'the stickies are not listed oldest first');
  perform pg_temp.expect(not exists (select 1 from staff_stickies((select id from boards where slug = 'elsewhere'))), 'a board with no staff thread lists a sticky');
  -- A player is refused; so is a visitor.
  perform tests.become(pg_temp.acct('an-player'));
  msg := pg_temp.refusal(format('select unpin_staff_thread(%L)', th));
  perform pg_temp.expect(msg like '42501%only an admin%', 'a player unpinned a staff thread: ' || coalesce(msg, 'allowed'));
  perform tests.become_anon();
  msg := pg_temp.refusal(format('select unpin_staff_thread(%L)', th));
  perform pg_temp.expect(msg like '42501%', 'a visitor called unpin_staff_thread: ' || coalesce(msg, 'allowed'));
  perform tests.unbecome();
  -- The stickies are a signed-in read (board_page runs as its caller and asks); a visitor is refused.
  perform tests.become_anon();
  msg := pg_temp.refusal('select * from staff_stickies(system_board())');
  perform pg_temp.expect(msg like '42501%', 'a visitor called staff_stickies: ' || coalesce(msg, 'allowed'));
  perform tests.unbecome();
  -- An admin unpins it; the pin is gone from the list, and the unpin is recorded with the admin.
  perform tests.become(pg_temp.acct('an-admin'));
  perform unpin_staff_thread(th);
  perform tests.unbecome();
  select * into e from staff_pin_events where thread = th order by id desc limit 1;
  perform pg_temp.expect(e.event = 'unpinned' and e."by" = pg_temp.acct('an-admin') and e.season = pg_temp.season(), 'the unpin is not recorded with the admin: ' || to_jsonb(e)::text);
  perform pg_temp.expect(not exists (select 1 from staff_stickies(system_board()) s where s.thread = th) and exists (select 1 from staff_stickies(system_board()) s where s.thread = other), 'the unpin did not take that thread alone off the list');
  -- Unpinned already, never pinned, and not a thread at all: the same plain refusal.
  perform tests.become(pg_temp.acct('an-admin'));
  msg := pg_temp.refusal(format('select unpin_staff_thread(%L)', th));
  perform pg_temp.expect(msg like 'P0002%That thread has no live pin.', 'an unpinned thread was unpinned again: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format('select unpin_staff_thread(%L)', (select min(id::text)::uuid from threads where not staff_placed)));
  perform pg_temp.expect(msg like 'P0002%That thread has no live pin.', 'a thread never pinned was unpinned: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal('select unpin_staff_thread(gen_random_uuid())');
  perform pg_temp.expect(msg like 'P0002%That thread has no live pin.', 'no thread was unpinned: ' || coalesce(msg, 'allowed'));
  perform tests.unbecome();
end $$;

-- ---- 9. The aftermath: the successor plays the predecessor's beats, announced, its bundle landing in the thread, and a role of the predecessor's beat resolving ----
do $$
declare
  s bigint := pg_temp.season();
  b uuid := gen_random_uuid();
  r jsonb;
  minus uuid;
  th_restore uuid;
  th_tidy uuid;
  t uuid;
  moved uuid;
  msg text;
  qid bigint;
begin
  -- The predecessor served this season and played its Split: its board made, landed.
  perform pg_temp.boss('an-pred');
  perform pg_temp.part('an-pred', b, 'Pred Split', 'minus', pg_temp.mkboard('Pred Minus'));
  perform system_tick();
  perform pg_temp.play('an-pred', 'split', b);
  minus := beat_role_board(s, 'an-pred', 'split', 'minus');
  perform pg_temp.expect(minus is not null, 'setup: the predecessor''s Split made no board');
  insert into threads (board, title) values ((select id from boards where slug = 'elsewhere'), 'A thread to tidy') returning id into t;
  insert into handoffs (season, staff, farewell, note) values (s, 'an-pred', 'Bye.', '');
  insert into season_handovers (season, outgoing, boss, how, cause) values (s, 'an-pred', 'an-succ', 'rotation', 'departure');
  perform pg_temp.boss('an-succ');
  perform pg_temp.began(3);
  perform pg_temp.expect((select staff from arc_predecessor('an-succ', s)) = 'an-pred', 'setup: the predecessor is not seated');
  perform arc_pass_for('an-succ', s, false);
  perform pg_temp.expect(pg_temp.state('an-succ', 'after:an-pred:restore') = 'unlocked' and pg_temp.state('an-succ', 'after:an-pred:tidy') = 'unlocked', 'setup: the aftermath beats did not unlock for the successor');
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(arc_for_meeting('an-succ', s) -> 'beats') e where e ->> 'key' = 'restore' and (e ->> 'aftermath')::boolean and e ->> 'predecessor' = 'an-pred'), 'arc_for_meeting does not list the aftermath beat by its plain key');

  -- The plain key, with its authored bundle and an announcement that names it the same way.
  r := pg_temp.apply('an-succ', jsonb_build_array(jsonb_build_object('name', 'Restoration', 'beat', 'restore', 'parts', jsonb_build_array(pg_temp.p('restored', 'createBoard', pg_temp.mkboard('General Again'))))),
    jsonb_build_array(pg_temp.ann('restore', 'Restoration: getting things out of World -1', 'We will put things back.', 'Putting things back.', 'You announced the restoration.')));
  perform pg_temp.expect(r ->> 'status' = 'applied' and r -> 'beats_played' = '["restore"]'::jsonb, 'the aftermath beat was not played: ' || r::text || pg_temp.record('bundlesSkipped')::text);
  perform pg_temp.expect(pg_temp.state('an-succ', 'after:an-pred:restore') = 'played' and pg_temp.state('an-succ', 'restore') is null, 'the played event is not under after:<pred>:<key>');
  perform pg_temp.expect((select bundle is not null from arc_beat_events where staff = 'an-succ' and beat = 'after:an-pred:restore' and event = 'played'), 'the played event carries no bundle');
  perform pg_temp.expect(exists (select 1 from queued_moves where staff = 'an-succ' and bundle_name = 'Restoration'), 'the aftermath bundle was not queued');
  perform pg_temp.expect((select balance from move_bank where staff = 'an-succ') = 5, 'an authored aftermath bundle cost the bank');
  select thread into th_restore from arc_announcements where staff = 'an-succ' and beat = 'after:an-pred:restore';
  perform pg_temp.expect(th_restore is not null, 'the aftermath beat was not announced: ' || pg_temp.record('announcementsSkipped')::text);
  perform pg_temp.expect((select count(*) from staff_stickies(system_board()) s where s.thread = th_restore) = 1, 'the aftermath announcement is not pinned');
  perform pg_temp.hold_over('Restoration');
  perform system_tick();
  perform pg_temp.expect(pg_temp.landed_in('Restoration') = array[th_restore], 'the aftermath bundle did not land in its announcement thread: ' || pg_temp.landed_in('Restoration')::text);

  -- The full form names the beat too; its bundle moves a thread into the board the predecessor's Split made, by the role of the predecessor's beat.
  r := pg_temp.apply('an-succ', jsonb_build_array(jsonb_build_object('name', 'Tidying', 'beat', 'after:an-pred:tidy', 'parts', jsonb_build_array(
      pg_temp.p(null, 'moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus', 'beat', 'split', 'of', 'predecessor')))))),
    jsonb_build_array(pg_temp.ann('after:an-pred:tidy', 'Tidying up', 'A few threads at a time.')));
  perform pg_temp.expect(r -> 'beats_played' = '["after:an-pred:tidy"]'::jsonb and pg_temp.state('an-succ', 'after:an-pred:tidy') = 'played', 'the full form did not play the aftermath beat: ' || r::text || pg_temp.record('bundlesSkipped')::text);
  select thread into th_tidy from arc_announcements where staff = 'an-succ' and beat = 'after:an-pred:tidy';
  perform pg_temp.expect(th_tidy is not null and th_tidy <> th_restore, 'the second aftermath beat has no thread of its own');
  select id into qid from queued_moves where bundle_name = 'Tidying';
  perform pg_temp.expect((select params -> 'board' from queued_moves where id = qid) = '{"role": "minus", "beat": "split", "of": "predecessor"}'::jsonb, 'the queue rewrote the role of the predecessor''s beat');
  perform pg_temp.hold_over('Tidying');
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where id = qid;
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = qid), 'the part naming the predecessor''s role did not land: ' || (select coalesce(failure, 'no failure') from queued_moves where id = qid));
  perform pg_temp.expect(pg_temp.landed_in('Tidying') = array[th_tidy], 'the tidy part did not land in its announcement thread');
  perform pg_temp.expect(thread_place(t) = minus, 'the thread was not moved into the predecessor''s board');

  -- The queue refuses a role of the predecessor's beat that names nothing, and keys it does not know.
  msg := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
    values ((select max(id) from meetings), 'an-succ', 'moveThread', %L, 'because', now(), null, false, gen_random_uuid(), 'Bad', null)$q$,
    jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'nope', 'beat', 'split', 'of', 'predecessor'))::text));
  perform pg_temp.expect(msg like '23514%nope%', 'a role the predecessor''s beat never made was queued: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
    values ((select max(id) from meetings), 'an-succ', 'moveThread', %L, 'because', now(), null, false, gen_random_uuid(), 'Bad', null)$q$,
    jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus', 'of', 'predecessor'))::text));
  perform pg_temp.expect(msg like '23514%nothing more%', 'an of with no beat was queued: ' || coalesce(msg, 'allowed'));
  msg := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
    values ((select max(id) from meetings), 'an-succ', 'moveThread', %L, 'because', now(), null, false, gen_random_uuid(), 'Bad', null)$q$,
    jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'minus', 'beat', 'split', 'of', 'successor'))::text));
  perform pg_temp.expect(msg like '23514%nothing more%', 'an of that is not the predecessor was queued: ' || coalesce(msg, 'allowed'));
end $$;

-- ---- 9b. A part that cannot land in its announcement thread does not wait forever; an announcement thread cannot be moved off the board, so it stays landed in ----
-- An announced bundle's part, queued straight (as pg_temp.part queues a predecessor's), with its announcement written by hand: a thread, its post, the played event and the row.
create function pg_temp.announced(who text, beat text, title text) returns table (bundle uuid, thread uuid, first_part bigint) language plpgsql as $$
declare
  th uuid := open_staff_thread(who, title);
  a uuid := (write_staff_act(who, 'post', th, null, jsonb_build_object('body', 'Words.')) ->> 'id')::uuid;
  b uuid := gen_random_uuid();
  q bigint := pg_temp.part(who, b, title, 'one', pg_temp.mkboard(title));
begin
  perform pg_temp.play(who, beat, b);
  insert into arc_announcements (season, staff, beat, thread, act, title, play, repeatable)
  values (pg_temp.season(), who, beat, th, a, title, (select max(e.id) from arc_beat_events e where e.staff = who and e.beat = announced.beat and e.event = 'played'), true);
  insert into staff_pin_events (thread, season, event) values (th, pg_temp.season(), 'pinned');
  return query select b, th, q;
end $$;
create function pg_temp.refuse_moves_in(th uuid) returns void language plpgsql as $$
begin
  execute format($f$create function pg_temp.refuse_in() returns trigger language plpgsql as $t$
    begin if new.kind = 'move' and new.thread = %L then raise exception 'this thread takes no more moves'; end if; return new; end $t$ $f$, th);
  create trigger zz_refuse_in before insert on acts for each row execute function pg_temp.refuse_in();
end $$;
do $$
declare
  b uuid;
  th uuid;
  q1 bigint;
  q2 bigint;
  fb uuid;
  other uuid;
  mv bigint;
begin
  update persona_arcs set beats = jsonb_build_array(jsonb_build_object('key', 'fall1', 'mini', true, 'repeatable', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))),
    jsonb_build_object('key', 'fall2', 'mini', true, 'repeatable', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign')))) where staff = 'an-succ';
  select * into b, th, q1 from pg_temp.announced('an-succ', 'fall1', 'Fall back one');
  perform pg_temp.refuse_moves_in(th);
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = q1), 'a part the announcement thread refused sits due: ' || coalesce((select failure from queued_moves where id = q1), 'no failure'));
  select a.thread into fb from queued_moves q join acts a on a.id = q.landed_act where q.id = q1;
  perform pg_temp.expect(fb <> th and (select staff_placed from threads where id = fb), 'the part did not land in a staff thread of its own: ' || fb::text);
  perform pg_temp.expect((select failure like 'landed in a thread of its own%this thread takes no more moves%' from queued_moves where id = q1), 'the fall-back was not recorded on the part: ' || coalesce((select failure from queued_moves where id = q1), 'none'));
  perform pg_temp.expect(exists (select 1 from staff_stickies(system_board()) s where s.thread = th), 'the announcement lost its pin');
  -- The bundle's next part joins the first one's thread, not a third.
  q2 := pg_temp.part('an-succ', b, 'Fall back one', 'two', pg_temp.mkboard('Fall Two'));
  perform system_tick();
  perform pg_temp.expect((select a.thread from queued_moves q join acts a on a.id = q.landed_act where q.id = q2) = fb, 'the second part did not follow the first out of the refusing thread');
  drop trigger zz_refuse_in on acts;

  -- A move of the announcement thread to another board.
  select * into b, th, q1 from pg_temp.announced('an-succ', 'fall2', 'Moved announcement');
  other := (select id from boards where slug = 'elsewhere');
  mv := (select m.id from (select pg_temp.part('an-succ', gen_random_uuid(), 'Mover', null, pg_temp.mkboard('Mover')) as id) m);
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set kind = 'moveThread', params = jsonb_build_object('thread', th, 'board', other), structural = false where id = mv;
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  -- No move can take a staff thread off The System's board (the lasting-move check refuses it), so the thread cannot be moved by play: the move is refused for good, the thread stays on its board with its pin,
  -- and a later part of the announced bundle lands in it.
  perform pg_temp.expect((select refused_at is not null and landed_act is null and failure like '%never moved%' from queued_moves where id = mv), 'moving an announcement thread was not refused: ' || coalesce((select failure from queued_moves where id = mv), 'no failure'));
  perform pg_temp.expect(thread_place(th) = system_board() and exists (select 1 from staff_stickies(system_board()) s where s.thread = th), 'the announcement thread left the system board or lost its pin');
  q2 := pg_temp.part('an-succ', b, 'Moved announcement', 'two', pg_temp.mkboard('Moved Board'));
  perform system_tick();
  perform pg_temp.expect((select a.thread from queued_moves q join acts a on a.id = q.landed_act where q.id = q2) = th and (select failure is null from queued_moves where id = q2), 'a part did not land in the announcement thread: ' || coalesce((select failure from queued_moves where id = q2), 'no failure'));
end $$;

-- ---- 10. The recap: kept beside the farewell and handoff within the window, cut to 300 (recorded), checked by the table ----
do $$
declare
  s bigint := pg_temp.season();
  r jsonb;
  msg text;
begin
  msg := pg_temp.refusal(format('insert into handoffs (season, staff, recap) values (%L, %L, repeat(%L, 301))', s, 'an-succ', 'r'));
  perform pg_temp.expect(msg like '23514%', 'a recap over 300 characters was stored: ' || coalesce(msg, 'allowed'));
  -- Far from the season's end: the recap is dropped with the rest, and the meeting says so.
  r := pg_temp.apply('an-succ', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('recap', 'Too early.'));
  perform pg_temp.expect(not exists (select 1 from handoffs where recap = 'Too early.') and pg_temp.record('handoffSkipped') -> 0 ->> 'why' = 'inFarewellWindow', 'a recap outside the window was stored');
  -- Within it: a recap alone writes a row, and a long one is cut and the cut recorded.
  perform pg_temp.began(89);
  r := pg_temp.apply('an-succ', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('recap', '  I did a thing. It was fine.  '));
  perform pg_temp.expect((select h.recap from handoffs_latest h where h.season = s and h.staff = 'an-succ') = 'I did a thing. It was fine.', 'the recap was not stored: ' || coalesce((select h.recap from handoffs_latest h where h.season = s and h.staff = 'an-succ'), 'none'));
  r := pg_temp.apply('an-succ', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('recap', repeat('long ', 100), 'farewell', 'So long.', 'handoff', 'A note.'));
  perform pg_temp.expect((select char_length(h.recap) = 300 and h.farewell = 'So long.' and h.note = 'A note.' from handoffs_latest h where h.season = s and h.staff = 'an-succ'), 'the long recap was not cut to 300 beside the farewell and note');
  perform pg_temp.expect(pg_temp.record('handoffTrims') @> '[{"path": "recap", "predicate": "maxLength(300)"}]'::jsonb, 'the recap trim was not recorded: ' || pg_temp.record('handoffTrims')::text);
  -- A later meeting with no recap leaves it standing, as the farewell and the note stand; one with a blank recap too.
  r := pg_temp.apply('an-succ', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('handoff', 'A newer note.', 'recap', '   '));
  perform pg_temp.expect((select char_length(h.recap) = 300 and h.note = 'A newer note.' from handoffs_latest h where h.season = s and h.staff = 'an-succ'), 'a later meeting displaced the recap');
  -- Not a string: none.
  r := pg_temp.apply('an-succ', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('recap', 5, 'handoff', 'Another note.'));
  perform pg_temp.expect((select char_length(h.recap) = 300 from handoffs_latest h where h.season = s and h.staff = 'an-succ'), 'a recap that was not text displaced the recap');
end $$;

-- ---- 10b. The plot so far: arc_plot, pool_record's plot / push / leadIns, meeting_context's plot / leadIns ----
-- Each read is asked by name and answers null when the migration lacks it, so a missing function fails an assertion and not a call.
create function pg_temp.plot(k text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  if to_regprocedure('arc_plot(text)') is null then return null; end if;
  execute 'select arc_plot($1)' into j using k;
  return j;
end $$;
-- The seated handover moves back or forward in time; the table's rows are only ever added by hand_over, so the fixture edits the one it planted.
create function pg_temp.handed_over(days numeric) returns void language sql as $$
  update season_handovers set at = now() - make_interval(secs => (days * 86400)::double precision) where boss = 'an-succ' and outgoing = 'an-pred'
$$;
create function pg_temp.a_thread() returns uuid language sql as $$ select id from threads order by created_at, id limit 1 $$;
-- The block's edits (the handover's date, a persona's days, a recap, a lead-in) are undone by the block's own end: a subtransaction that raises RB000 is the rollback.
do $$
declare
  s bigint := pg_temp.season();
  j jsonb;
  mc jsonb;
  pr jsonb;
  ids uuid[];
  pushes jsonb;
begin
 begin
  perform pg_temp.expect((select count(*) from arc_announcements where season = s) between 3 and 12, 'setup: the season holds ' || (select count(*) from arc_announcements where season = s) || ' announcements, not between 3 and 12');

  -- Within the honeymoon after the handover that seated the sitting Boss: last season is there, its Boss named, with the fallback's facts where no recap was written.
  perform pg_temp.handed_over(1);
  j := pg_temp.plot('an-m1');
  perform pg_temp.expect(j is not null and jsonb_typeof(j -> 'last') = 'object', 'the plot has no last season a day after a handover: ' || coalesce(j::text, 'no arc_plot'));
  perform pg_temp.expect(j #>> '{last,boss}' = 'an-pred' and j #>> '{last,name}' = 'an-pred' and jsonb_typeof(j #> '{last,recap}') = 'null' and jsonb_typeof(j #> '{last,facts}') = 'object' and j #> '{last,facts}' ? 'beats',
    'last season is not the outgoing Boss with no recap and its facts: ' || (j -> 'last')::text);
  -- Every reader reads the same plot.
  perform pg_temp.expect(pg_temp.plot('an-succ') = j and pg_temp.plot('an-pred') = j and pg_temp.plot(null) = j, 'the plot differs with its reader');
  -- The initiatives are the open season's announcements, oldest first, each with its Boss.
  select array_agg(a.thread order by a.at, a.id) into ids from arc_announcements a where a.season = s;
  perform pg_temp.expect((select array_agg((e ->> 'thread')::uuid order by n) from jsonb_array_elements(j -> 'initiatives') with ordinality x(e, n)) = ids, 'the initiatives are not the open season''s announcements oldest first: ' || (j -> 'initiatives')::text);
  perform pg_temp.expect((select bool_and(e ->> 'boss' = a.staff and e ->> 'beat' = a.beat and e ->> 'title' = a.title and e ->> 'pitch' = a.pitch and not e ? 'push' and not e ? 'act')
    from jsonb_array_elements(j -> 'initiatives') e join arc_announcements a on a.thread = (e ->> 'thread')::uuid), 'an initiative is not {beat, title, pitch, thread, boss}');
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(j -> 'initiatives') e where e ->> 'boss' = 'an-boss') and exists (select 1 from jsonb_array_elements(j -> 'initiatives') e where e ->> 'boss' = 'an-succ'),
    'the plot leaves out a departed Boss''s initiative or the sitting Boss''s');

  -- The recap of the outgoing Boss's season stands in the plot when it was written; the facts are then not carried.
  insert into handoffs (season, staff, farewell, note, recap) values (s, 'an-pred', 'Bye.', '', 'I restored nothing.');
  j := pg_temp.plot('an-m1');
  perform pg_temp.expect(j #>> '{last,recap}' = 'I restored nothing.' and jsonb_typeof(j #> '{last,facts}') = 'null', 'the recap is not last season''s line: ' || (j -> 'last')::text);

  -- The honeymoon's length is the sitting Boss's: the instance's 14 days, then its persona's own.
  perform pg_temp.handed_over(13);
  perform pg_temp.expect(jsonb_typeof(pg_temp.plot('an-m1') -> 'last') = 'object', 'last season is gone on the 13th day of a 14-day honeymoon');
  perform pg_temp.handed_over(15);
  perform pg_temp.expect(jsonb_typeof(pg_temp.plot('an-m1') -> 'last') = 'null' and jsonb_typeof(pg_temp.plot('an-m1') -> 'initiatives') = 'array', 'last season is still there after the honeymoon: ' || (pg_temp.plot('an-m1') -> 'last')::text);
  update persona_arcs set phase_days = '{"honeymoon": 20}'::jsonb where staff = 'an-succ';
  perform pg_temp.expect(jsonb_typeof(pg_temp.plot('an-m1') -> 'last') = 'object', 'a persona''s own honeymoon length was not read');
  update persona_arcs set phase_days = '{"honeymoon": 3}'::jsonb where staff = 'an-succ';
  perform pg_temp.handed_over(5);
  perform pg_temp.expect(jsonb_typeof(pg_temp.plot('an-m1') -> 'last') = 'null', 'a persona''s shorter honeymoon was not read');
  update persona_arcs set phase_days = '{}'::jsonb where staff = 'an-succ';
  perform pg_temp.handed_over(1);

  -- pool_record: the plot for every persona; the push and the lead-ins for the sitting Boss alone, and only for what the sitting Boss announced.
  pr := pool_record(pg_temp.a_thread(), 'an-succ');
  perform pg_temp.expect(pr -> 'plot' is not null and pr -> 'plot' = pg_temp.plot('an-succ'), 'the Boss''s pool record carries no plot: ' || pr::text);
  select coalesce(jsonb_agg(a.push order by a.at, a.id), '[]') into pushes from arc_announcements a where a.season = s and a.staff = 'an-succ' and a.push <> '';
  perform pg_temp.expect(pushes <> '[]'::jsonb and pr -> 'push' = pushes, 'the Boss''s push is not its own announcements'' pushes oldest first: ' || coalesce((pr -> 'push')::text, 'none') || ' vs ' || pushes::text);
  perform pg_temp.expect(not (pr -> 'push') @> '"You announced World -1."'::jsonb, 'the sitting Boss was given a departed Boss''s push');
  perform pg_temp.expect(pr -> 'leadIns' = to_jsonb(arc_lead_ins('an-succ', s)), 'the Boss''s lead-ins are not arc_lead_ins'' keys: ' || coalesce((pr -> 'leadIns')::text, 'none'));
  for pr in select pool_record(pg_temp.a_thread(), k) from unnest(array['an-m1', 'an-m2', 'an-pred', 'an-boss']) k loop
    perform pg_temp.expect(pr -> 'plot' = pg_temp.plot('an-m1') and not pr ? 'push' and not pr ? 'leadIns', 'a persona that is not the Boss was given the push or lead-ins, or no plot: ' || pr::text);
  end loop;

  -- The Boss's meeting: the plot and the lead-ins.
  mc := meeting_context();
  perform pg_temp.expect(mc -> 'plot' is not null and mc -> 'plot' = pg_temp.plot('an-succ'), 'meeting_context carries no plot');
  perform pg_temp.expect(mc -> 'leadIns' = to_jsonb(arc_lead_ins('an-succ', s)) and jsonb_typeof(mc -> 'leadIns') = 'array', 'meeting_context carries no lead-ins: ' || coalesce((mc -> 'leadIns')::text, 'none'));

  -- A live lead-in (the predecessor's aftermath beat the successor has not played, its phase begun) reaches the Boss's pool record and meeting, and no other persona's.
  update persona_arcs set aftermath = aftermath || jsonb_build_array(jsonb_build_object('key', 'extra', 'mini', true,
    'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never-lands')),
    'leadIn', jsonb_build_object('unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon'))))) where staff = 'an-pred';
  perform pg_temp.expect(arc_lead_ins('an-succ', s) = array['after:an-pred:extra'], 'setup: the lead-in is not live: ' || arc_lead_ins('an-succ', s)::text);
  pr := pool_record(pg_temp.a_thread(), 'an-succ');
  perform pg_temp.expect(pr -> 'leadIns' = '["after:an-pred:extra"]'::jsonb, 'the Boss''s pool record does not carry its live lead-in: ' || coalesce((pr -> 'leadIns')::text, 'none'));
  perform pg_temp.expect(not pool_record(pg_temp.a_thread(), 'an-m1') ? 'leadIns', 'a Mod was given the Boss''s lead-ins');
  perform pg_temp.expect(meeting_context() -> 'leadIns' = '["after:an-pred:extra"]'::jsonb, 'meeting_context does not carry the live lead-in');
  raise exception using errcode = 'RB000', message = 'put the fixture back';
exception when sqlstate 'RB000' then null;
 end;
end $$;

-- ---- 10c. The size of the plot at a busy instance: the latest 12 initiatives, oldest first, and the push likewise ----
do $$
declare
  s bigint := pg_temp.season();
  th uuid := (select thread from arc_announcements where season = s order by id limit 1);
  j jsonb;
  pr jsonb;
  k integer;
begin
 begin
  -- Thirty more rows, as a Boss that announced every beat of a long file would leave (the guard wants a played event for each: the fixture plays them).
  perform set_config('session_replication_role', 'replica', true);
  for k in 1..30 loop
    insert into arc_announcements (season, staff, beat, thread, act, title, pitch, push, play, repeatable)
      select s, 'an-succ', 'busy' || k, th, a.act, 'Initiative ' || k, 'Pitch ' || k, 'Push ' || k, -k, true from arc_announcements a where a.thread = th limit 1;
  end loop;
  perform set_config('session_replication_role', 'origin', true);
  j := pg_temp.plot('an-m1');
  perform pg_temp.expect(jsonb_array_length(j -> 'initiatives') = 12, 'the plot is not capped at 12 initiatives: ' || jsonb_array_length(j -> 'initiatives'));
  perform pg_temp.expect(j #>> '{initiatives,11,title}' = 'Initiative 30' and j #>> '{initiatives,0,title}' = 'Initiative 19', 'the cap did not keep the latest, oldest first: ' || (j -> 'initiatives' -> 0)::text);
  pr := pool_record(pg_temp.a_thread(), 'an-succ');
  perform pg_temp.expect(jsonb_array_length(pr -> 'push') = 12 and pr #>> '{push,11}' = 'Push 30' and pr #>> '{push,0}' = 'Push 19', 'the push is not the latest 12 pushes, oldest first: ' || (pr -> 'push')::text);
  raise exception using errcode = 'RB000', message = 'put the fixture back';
exception when sqlstate 'RB000' then null;
 end;
end $$;

-- ---- 10d. board_page: page 1 of the system board lists the stickies, as thread_list gives each row; no other page or board does; an unpinned thread leaves them ----
create function pg_temp.page(slug text, pg integer) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform tests.become(pg_temp.acct('an-player'));
  j := board_page(slug, pg, array[]::text[]);
  perform tests.unbecome();
  return j;
end $$;
do $$
declare
  sb uuid := system_board();
  slug text := (select b.slug from boards b where b.id = system_board());
  want uuid[];
  j jsonb;
  row_ jsonb;
  th uuid;
  pg integer;
begin
  perform tests.character(pg_temp.acct('an-player'), 'An Reader');
  -- Enough threads on the board that it has a second page.
  insert into threads (board, title) select sb, 'Filler ' || n from generate_series(1, 25) n;
  select array_agg(x.thread order by x.n) into want from staff_stickies(sb) with ordinality x(thread, pinned_at, n);
  perform pg_temp.expect(cardinality(want) >= 2, 'setup: the system board has ' || coalesce(cardinality(want), 0) || ' stickies');

  j := pg_temp.page(slug, 1);
  perform pg_temp.expect(jsonb_typeof(j -> 'stickies') = 'array', 'board_page has no stickies: ' || coalesce((j -> 'stickies')::text, 'none'));
  perform pg_temp.expect((select array_agg((e ->> 'id')::uuid order by n) from jsonb_array_elements(j -> 'stickies') with ordinality x(e, n)) = want, 'page 1 does not list the board''s stickies in staff_stickies'' order');
  -- Each is the row thread_list gives (what `threads` and `pins` carry), and none takes a page slot: the page still holds 20 rows.
  for row_ in select e from jsonb_array_elements(j -> 'stickies') e loop
    perform pg_temp.expect(row_ = (select to_jsonb(l.*) from thread_list l where l.id = (row_ ->> 'id')::uuid), 'a sticky is not its thread_list row: ' || row_::text);
  end loop;
  perform pg_temp.expect(jsonb_array_length(j -> 'threads') = 20 and (j -> 'pins') = '[]'::jsonb, 'the stickies took a slot of the page or were counted among the pins');
  -- The page's rows are thread_list's own (its exclusions and order), with an unlisted thread and the Updates thread on the board, on both pages: board_page_ids stands for the view's WHERE.
  insert into threads (board, title) values (sb, 'Unlisted one') returning id into th;
  insert into unlisted_threads (thread) values (th);
  insert into threads (board, title) values (sb, 'The updates thread') returning id into th;
  insert into settings (key, value) values ('updatesThread', to_jsonb(th::text)) on conflict (key) do update set value = excluded.value;
  for pg in 1 .. 2 loop
    j := pg_temp.page(slug, pg);
    perform pg_temp.expect((select array_agg((e ->> 'id')::uuid order by n) from jsonb_array_elements(j -> 'threads') with ordinality x(e, n))
      is not distinct from (select array_agg(q.id order by q.rn) from (select l.id, row_number() over (order by l.last_at desc) rn from thread_list l where l.board = sb order by l.last_at desc offset (pg - 1) * 20 limit 20) q),
      'page ' || pg || ' of the board is not thread_list''s page: ' || (j -> 'threads')::text);
  end loop;
  -- The stickies' authors are in the page's characters, so the rows can be drawn.
  perform pg_temp.expect((select count(distinct c ->> 'id') from jsonb_array_elements(j -> 'characters') c where (c ->> 'id')::uuid in (select first_character from thread_list where id = any (want))) >= 1, 'the stickies'' authors are not in the page''s characters');

  -- Page 2 of the same board, and another board's page 1: none.
  perform pg_temp.expect((pg_temp.page(slug, 2) -> 'page')::integer = 2 and pg_temp.page(slug, 2) -> 'stickies' = '[]'::jsonb, 'page 2 lists stickies: ' || coalesce((pg_temp.page(slug, 2) -> 'stickies')::text, 'none'));
  perform pg_temp.expect(pg_temp.page('elsewhere', 1) -> 'stickies' = '[]'::jsonb, 'another board lists the system board''s stickies');

  -- An admin unpins one: it leaves the page's stickies, and the thread is still on the board.
  th := want[1];
  perform tests.become(pg_temp.acct('an-admin'));
  perform unpin_staff_thread(th);
  perform tests.unbecome();
  j := pg_temp.page(slug, 1);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(j -> 'stickies') e where (e ->> 'id')::uuid = th) and jsonb_array_length(j -> 'stickies') = cardinality(want) - 1, 'an unpinned thread stayed in the stickies');
  perform pg_temp.expect(exists (select 1 from threads where id = th and board = sb), 'setup: unpinning moved the thread');
end $$;

-- ---- 10f. admin_staff_pins: an admin lists the open season's live staff pins on every board, oldest first, with each title; a player is refused; an unpinned thread leaves ----
create function pg_temp.pins_as(label text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become(pg_temp.acct(label));
  r := (select coalesce(jsonb_agg(jsonb_build_object('thread', p.thread, 'title', p.title) order by p.n), '[]'::jsonb) from admin_staff_pins() with ordinality p(thread, title, pinned_at, n));
  perform tests.unbecome();
  return r;
exception when others then
  perform tests.unbecome();
  return to_jsonb('refused ' || sqlstate);
end $$;
do $$
declare
  msg text;
  live uuid[];
  th uuid;
begin
  if to_regprocedure('admin_staff_pins()') is null then raise exception 'no admin_staff_pins'; end if;
  select array_agg(p.thread order by p.id) into live from (
    select distinct on (e.thread) e.thread, e.id, e.event from staff_pin_events e where e.season = pg_temp.season() order by e.thread, e.id desc) p where p.event = 'pinned';
  perform pg_temp.expect(cardinality(live) >= 2, 'setup: the season has ' || coalesce(cardinality(live), 0) || ' live pins');
  perform pg_temp.expect(jsonb_array_length(pg_temp.pins_as('an-admin')) = cardinality(live), 'the admin does not see every live pin: ' || pg_temp.pins_as('an-admin')::text);
  perform pg_temp.expect((select bool_and(pg_temp.pins_as('an-admin') @> jsonb_build_array(jsonb_build_object('thread', t.id, 'title', t.title))) from threads t where t.id = any (live)), 'a pin is listed without its title');
  perform pg_temp.expect((select array_agg((e ->> 'thread')::uuid order by n) from jsonb_array_elements(pg_temp.pins_as('an-admin')) with ordinality y(e, n)) = (select array_agg(thread order by n) from staff_stickies(system_board()) with ordinality z(thread, pinned_at, n)),
    'the admin''s list is not in pin order');
  perform pg_temp.expect(pg_temp.pins_as('an-player') = '"refused 42501"'::jsonb, 'a player read the staff pins: ' || pg_temp.pins_as('an-player')::text);
  perform tests.become_anon();
  msg := pg_temp.refusal('select * from admin_staff_pins()');
  perform tests.unbecome();
  perform pg_temp.expect(msg like '42501%', 'a visitor called admin_staff_pins: ' || coalesce(msg, 'allowed'));
  th := live[1];
  perform tests.become(pg_temp.acct('an-admin'));
  perform unpin_staff_thread(th);
  perform tests.unbecome();
  perform pg_temp.expect(not pg_temp.pins_as('an-admin') @> jsonb_build_array(jsonb_build_object('thread', th)) and jsonb_array_length(pg_temp.pins_as('an-admin')) = cardinality(live) - 1, 'an unpinned thread stayed in the admin''s list');
end $$;

-- ---- 10e. The masks: the new reads hold no owner, account or reaction word (board_page, which reads the reader's own reactions for the cards' marks, is held to `owner` alone); driven red on a planted read ----
create function pg_temp.leaks(proc regprocedure, words text default '(owner|account|reaction)') returns text language sql as $$
  select string_agg(distinct m[1], ',') from regexp_matches(lower(pg_get_functiondef(proc)), words, 'g') m
$$;
create function pg_temp.poisoned() returns integer language sql as $$ select count(distinct c.owner)::integer from characters c $$;
-- apply_meeting and system_tick predate this check and read other things (a meeting's moves, the bank, requests, a move's own alerts), so only the hunks this migration added are held to the words: the announcement
-- sub-block of apply_meeting, and the routing hunk of system_tick. `hunk` finds one by its first and last words in the definition; a hunk it cannot find is a failure, so a rewording cannot let it escape.
create function pg_temp.leaks_hunk(proc regprocedure, pat text) returns text language sql as $$
  select coalesce((select string_agg(distinct m[1], ',') from regexp_matches(substring(lower(pg_get_functiondef(proc)) from pat), '(owner|account|reaction)', 'g') m), case when substring(lower(pg_get_functiondef(proc)) from pat) is null then 'hunk missing' end)
$$;
create function pg_temp.poisoned_hunk() returns integer language plpgsql as $$
begin
  -- hunk begins
  perform count(distinct c.owner) from characters c;
  -- hunk ends
  return 1;
end $$;
do $$
declare
  p regprocedure;
begin
  perform pg_temp.expect(pg_temp.leaks('pg_temp.poisoned()'::regprocedure) = 'owner', 'the masks check did not find an owner read');
  perform pg_temp.expect(pg_temp.leaks_hunk('pg_temp.poisoned_hunk()'::regprocedure, '-- hunk begins.*?-- hunk ends') = 'owner', 'the hunk check did not find an owner read in a planted hunk');
  perform pg_temp.expect(pg_temp.leaks_hunk('pg_temp.poisoned_hunk()'::regprocedure, '-- no such hunk.*?-- hunk ends') = 'hunk missing', 'the hunk check passed a hunk it could not find');
  perform pg_temp.expect(pg_temp.leaks_hunk('apply_meeting(bigint,jsonb)'::regprocedure, 'for ann in select.*?\n  if spent > floor') is null, 'apply_meeting''s announcement sub-block reads a private fact or was not found: ' || pg_temp.leaks_hunk('apply_meeting(bigint,jsonb)'::regprocedure, 'for ann in select.*?\n  if spent > floor'));
  perform pg_temp.expect(pg_temp.leaks_hunk('system_tick()'::regprocedure, 'ann_mt := null;.*?landed_act = written where id = due.id;') is null, 'system_tick''s routing hunk reads a private fact or was not found: ' || pg_temp.leaks_hunk('system_tick()'::regprocedure, 'ann_mt := null;.*?landed_act = written where id = due.id;'));
  for p in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace and proname in ('arc_plot', 'staff_stickies', 'board_page_ids', 'arc_beat_key', 'admin_staff_pins', 'unpin_staff_thread', 'arc_announcements_guard', 'staff_pin_events_guard') loop
    perform pg_temp.expect(pg_temp.leaks(p) is null, p::text || ' reads a private fact: ' || pg_temp.leaks(p));
  end loop;
  perform pg_temp.expect((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('arc_plot', 'staff_stickies', 'board_page_ids', 'arc_beat_key', 'admin_staff_pins', 'unpin_staff_thread', 'arc_announcements_guard', 'staff_pin_events_guard')) = 8, 'a function the masks check reads is missing');
  for p in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace and proname in ('pool_record', 'meeting_context', 'board_page') loop
    perform pg_temp.expect(pg_temp.leaks(p, '(owner)') is null, p::text || ' reads a character''s owner: ' || pg_temp.leaks(p, '(owner)'));
  end loop;
  -- board_page joins staff_stickies against thread_list on its hottest read: the planner is told it returns a handful of rows, not the default thousand.
  perform pg_temp.expect((select prorows from pg_proc where proname = 'staff_stickies') = 5, 'staff_stickies has no row estimate: ' || (select prorows from pg_proc where proname = 'staff_stickies'));
  -- system_tick finds a bundle's announcement through the event that played the bundle: one probe by bundle, not a read of every event.
  perform pg_temp.expect(exists (select 1 from pg_indexes where tablename = 'arc_beat_events' and indexdef like '%(bundle)%WHERE%bundle IS NOT NULL%'), 'arc_beat_events has no index by bundle');
  perform pg_temp.expect(not has_function_privilege('anon', 'arc_plot(text)', 'execute') and not has_function_privilege('authenticated', 'arc_plot(text)', 'execute'), 'a client can call arc_plot');
end $$;

-- ---- 11. A roll-over ends the pins with their season: the open season holds none of them ----
do $$
declare
  n bigint := (select count(*) from staff_stickies(system_board()));
begin
  perform pg_temp.expect(n >= 3, 'setup: the season still holds pins');
  perform reveal_season(now() + interval '1 day');
  perform pg_temp.expect((select count(*) from seasons where ends_at is null and id <> (select max(season) from staff_pin_events)) = 1, 'setup: the season did not roll over');
  perform pg_temp.expect(not exists (select 1 from staff_stickies(system_board())), 'a pin outlived its season');
  perform pg_temp.expect((select count(*) from staff_pin_events where event = 'pinned') >= n, 'the roll-over wrote to or took away the pin events');
end $$;

-- ---- 12. After the roll-over the plot holds no initiative of the old season, and the board lists no sticky ----
do $$
begin
  perform pg_temp.expect(jsonb_array_length(pg_temp.plot('an-m1') -> 'initiatives') = 0, 'the new season''s plot holds the old season''s initiatives: ' || (pg_temp.plot('an-m1') -> 'initiatives')::text);
  perform pg_temp.expect(pool_record(pg_temp.a_thread(), 'an-m1') -> 'plot' -> 'initiatives' = '[]'::jsonb, 'a pool record holds the old season''s initiatives');
  perform pg_temp.expect(pg_temp.page((select b.slug from boards b where b.id = system_board()), 1) -> 'stickies' = '[]'::jsonb, 'the board lists a sticky of the closed season');
  perform pg_temp.expect(pg_temp.pins_as('an-admin') = '[]'::jsonb, 'the admin''s list holds a pin of the closed season: ' || pg_temp.pins_as('an-admin')::text);
end $$;
