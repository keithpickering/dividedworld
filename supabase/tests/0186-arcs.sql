-- Arcs: beats, conditions, beat state (supabase/migrations/0228_arcs.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 5; design sections 2, 3 and 7).
--
-- A persona's arc is a list of beats; each has an unlock (conditions the code checks, each read from public facts only), and the tick writes `unlocked` once every condition holds,
-- and `lapsed` for an optional beat the season ends on. `played` is written by the meeting (Task 6); here it is written by hand, as the meeting will. The names: `arc_beat_events` and
-- `persona_arcs` are the arc's tables, and have nothing to do with `staff_beats` or a Mod Bot's patrol beat (the boards it watches).
--
-- THE CHECK AND ITS POISON. `beat_condition_holds` has a branch for every row of `condition_kinds` and raises `no check for condition %` for a key with none; section 1 walks the catalog
-- as the database holds it. Its poison is a planted catalog row with no branch: run this file with
--     PGOPTIONS='-c kayfabb.poison=noPoison'
-- and it plants `noPoison` before the walk, and must fail with `no check for condition noPoison`. Without it the file passes. The same goes for the masks check (section 9): it is
-- driven red on a function planted with a word it must find.

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

-- ---- 0. The world: a Boss with an arc of every shape, a persona that is not the Boss with conditions that hold, and the settings the clock reads ----
do $$
declare
  seed jsonb;
  boss_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign')), 'due', jsonb_build_object('phase', 'reign', 'daysIntoPhase', 7)),
    jsonb_build_object('key', 'picking', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split'))),
    jsonb_build_object('key', 'late', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'daysBeforeEnd', 7), jsonb_build_object('kind', 'beatLanded', 'beat', 'split')), 'due', jsonb_build_object('daysBeforeEnd', 2)),
    jsonb_build_object('key', 'opt', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))),
    jsonb_build_object('key', 'lap', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'boardActivity', 'board', jsonb_build_object('role', 'fangames', 'beat', 'split'), 'days', 7, 'above', jsonb_build_object('role', 'minus', 'beat', 'split')))),
    jsonb_build_object('key', 'rev', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'moveReversed'))),
    jsonb_build_object('key', 'met', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'demandResolved', 'outcome', 'met'))),
    jsonb_build_object('key', 'fail', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'demandResolved', 'outcome', 'failed'))),
    jsonb_build_object('key', 'again', 'mini', true, 'repeatable', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))),
    jsonb_build_object('key', 'once', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))),
    -- Beats that never unlock by themselves (they wait on a beat that waits on itself), so section 3 can drive the guard by hand.
    jsonb_build_object('key', 'never', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'g-once', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'g-again', 'mini', true, 'repeatable', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'g-lapse', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    -- Beats section 16b plays by hand to read beatLanded over every mix of a bundle's parts (#459); they never unlock by themselves.
    jsonb_build_object('key', 'r-held', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-allheld', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-refused', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-reversed', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-failed', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-waiting', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-nobundle', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))),
    jsonb_build_object('key', 'r-again', 'mini', true, 'repeatable', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never'))));
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'seasonLength', jsonb_build_object('unit', 'day', 'count', 90),
      'phases', jsonb_build_object(
        'honeymoon', jsonb_build_object('days', 14, 'weeklyMoves', 2, 'bankCap', 4, 'moveExpiryMostDays', 7),
        'reign', jsonb_build_object('weeklyMoves', 5, 'bankCap', 10, 'moveExpiryMostDays', 28),
        'meltdown', jsonb_build_object('days', 21, 'weeklyMoves', 8, 'bankCap', 14, 'moveExpiryMostDays', 42)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.'),
        'moveMet', jsonb_build_array('Met: {move}.'), 'moveExpired', jsonb_build_array('Over: {move}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another',
        'renameBoard', 'the renaming of a board to "{name}"')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ar-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ar-boss', 'name', 'Arc Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'arc', boss_arc,
          'holdsBack', jsonb_build_array(jsonb_build_object('kind', 'createBoard', 'until', 'split')), 'phaseDays', '{}'::jsonb),
        jsonb_build_object('key', 'ar-other', 'name', 'Other Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'arc', jsonb_build_array(jsonb_build_object('key', 'other-beat', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign')))),
          'holdsBack', '[]'::jsonb, 'phaseDays', jsonb_build_object('honeymoon', 3)),
        jsonb_build_object('key', 'ar-plain', 'name', 'Plain Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'conditions', jsonb_build_array(
        jsonb_build_object('key', 'phase', 'plain', 'a phase has begun, or the season is near its end'),
        jsonb_build_object('key', 'beatLanded', 'plain', 'an earlier beat''s bundle has landed'),
        jsonb_build_object('key', 'boardActivity', 'plain', 'a board''s posts over some days are above or below a number or another board'),
        jsonb_build_object('key', 'moveReversed', 'plain', 'an admin reversed one of the Boss''s moves'),
        jsonb_build_object('key', 'demandResolved', 'plain', 'one of the Boss''s moves'' demands was met or failed'))));
  perform seed_instance(seed);
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('ar-admin'));
end $$;

create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
-- Where the open season stands: it began this many days ago.
create function pg_temp.began(days numeric) returns void language sql as $$
  update seasons set starts_at = now() - make_interval(secs => (days * 86400)::double precision) where ends_at is null
$$;
create function pg_temp.holds(staff text, cond jsonb) returns boolean language plpgsql as $$ begin return beat_condition_holds(staff, pg_temp.season(), cond); end $$;
create function pg_temp.state(beat text, staff text default 'ar-boss') returns text language sql as $$
  select e.event from arc_beat_events e where e.season = pg_temp.season() and e.staff = state.staff and e.beat = state.beat order by e.id desc limit 1
$$;
create function pg_temp.n(beat text, event text default null, staff text default 'ar-boss') returns bigint language sql as $$
  select count(*) from arc_beat_events e where e.season = pg_temp.season() and e.staff = n.staff and e.beat = n.beat and (n.event is null or e.event = n.event)
$$;
create function pg_temp.total() returns bigint language sql as $$ select count(*) from arc_beat_events $$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.part(bundle uuid, bname text, role text, kind text, params jsonb, wait interval default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, 'ar-boss', kind, params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0'), kind in ('createBoard', 'mergeBoard'), bundle, bname, role) returning id into q;
  return q;
end $$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
-- A landed move of a staff member's, as a landed move is written; `demand` may be null.
create function pg_temp.landed(who text, new_name text, demand jsonb) returns uuid language plpgsql as $$
begin
  return (write_staff_act(who, 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.',
      'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
      'demand', demand))) ->> 'id')::uuid;
end $$;

-- ---- 1. The list: a branch for every key the catalog holds, and the seed is the catalog ----
do $$
declare
  k record;
  sample jsonb;
  said text;
begin
  perform pg_temp.expect((select count(*) from condition_kinds) = 5, 'the seed did not carry five conditions (twice is once): ' || (select count(*) from condition_kinds));
  perform pg_temp.expect((select plain from condition_kinds where key = 'moveReversed') = 'an admin reversed one of the Boss''s moves', 'a condition lost its words');
  if current_setting('kayfabb.poison', true) = 'noPoison' then
    insert into condition_kinds (key, plain) values ('noPoison', 'a condition the function has no branch for');
  end if;
  for k in select key from condition_kinds order by key loop
    sample := case k.key
      when 'phase' then '{"kind": "phase", "phase": "honeymoon"}'
      when 'beatLanded' then '{"kind": "beatLanded", "beat": "split"}'
      when 'boardActivity' then jsonb_build_object('kind', 'boardActivity', 'board', pg_temp.board('general'), 'days', 7, 'above', 1)
      when 'moveReversed' then '{"kind": "moveReversed"}'
      when 'demandResolved' then '{"kind": "demandResolved", "outcome": "met"}'
      else jsonb_build_object('kind', k.key) end;
    said := pg_temp.refusal(format('select pg_temp.holds(%L, %L)', 'ar-boss', sample));
    perform pg_temp.expect(said is null, 'beat_condition_holds has no check for ' || k.key || ': ' || coalesce(said, ''));
  end loop;
  -- A key outside the catalog is refused, naming it; so is a condition that is no object.
  said := pg_temp.refusal(format('select pg_temp.holds(%L, %L)', 'ar-boss', '{"kind": "weather"}'));
  perform pg_temp.expect(said like '%no check for condition weather%', 'an unknown condition was not refused by name: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal(format('select pg_temp.holds(%L, %L)', 'ar-boss', '"phase"'));
  perform pg_temp.expect(said is not null, 'a condition that is no object was allowed');
end $$;

-- ---- 2. The seed: one row a persona, with its beats, held-back kinds and phase days; a reseed rewrites them; a condition the catalog lacks is refused ----
do $$
declare
  said text;
begin
  perform pg_temp.expect((select count(*) from persona_arcs) = 3, 'persona_arcs is not one row a persona: ' || (select count(*) from persona_arcs));
  perform pg_temp.expect((select jsonb_array_length(beats) from persona_arcs where staff = 'ar-boss') = 22, 'the Boss''s beats were not seeded');
  perform pg_temp.expect((select beats -> 0 ->> 'key' from persona_arcs where staff = 'ar-boss') = 'split', 'the beats are not in the persona''s order');
  perform pg_temp.expect((select holds_back from persona_arcs where staff = 'ar-boss') = '[{"kind": "createBoard", "until": "split"}]'::jsonb, 'the held-back kinds were not seeded');
  perform pg_temp.expect((select phase_days from persona_arcs where staff = 'ar-other') = '{"honeymoon": 3}'::jsonb, 'the phase days were not seeded');
  perform pg_temp.expect((select beats from persona_arcs where staff = 'ar-plain') = '[]'::jsonb, 'a persona with no arc has beats');
  -- The briefs and templates are the instance's, read by the meeting in code; the database holds only what it checks.
  perform pg_temp.expect(not (select beats::text like '%brief%' from persona_arcs where staff = 'ar-boss'), 'a brief was seeded');
  -- No client reads these.
  perform pg_temp.expect(not has_table_privilege('authenticated', 'persona_arcs', 'select') and not has_table_privilege('anon', 'persona_arcs', 'select')
    and not has_table_privilege('authenticated', 'arc_beat_events', 'select') and not has_table_privilege('anon', 'condition_kinds', 'select'), 'a client can read the arcs');
  -- An arc naming a condition the catalog lacks is refused by the seed.
  said := pg_temp.refusal($q$select seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('staff', jsonb_build_array(jsonb_build_object('key', 'ar-boss', 'name', 'Arc Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb,
      'arc', jsonb_build_array(jsonb_build_object('key', 'x', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'weather')))))))))$q$);
  perform pg_temp.expect(said like '%weather%', 'a seed with an unknown condition was not refused by name: ' || coalesce(said, 'allowed'));
end $$;

-- ---- 3. beat_events is insert-only, and a beat moves unlocked, then played or lapsed, once ----
do $$
declare
  s bigint := pg_temp.season();
  said text;
  b uuid := gen_random_uuid();
  q bigint;
begin
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'split', 'played'));
  perform pg_temp.expect(said is not null and said like '%unlocked%', 'a beat was played before it unlocked: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'no-such-beat', 'unlocked'));
  perform pg_temp.expect(said like '%no beat%', 'a beat the persona lacks was unlocked: ' || coalesce(said, 'allowed'));
  -- An import writes as a replica, before the persona's beats are in: a row for a beat the persona lacks is carried as written, and the log still refuses an edit.
  perform set_config('session_replication_role', 'replica', true);
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'no-such-beat', 'unlocked'));
  perform pg_temp.expect(said is null, 'an import was refused a beat event whose persona it had not yet written: ' || coalesce(said, ''));
  said := pg_temp.refusal('update arc_beat_events set event = ''lapsed''');
  perform pg_temp.expect(said like '%only ever added%', 'a replica edited a beat event: ' || coalesce(said, 'allowed'));
  perform set_config('session_replication_role', 'origin', true);
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'split', 'tired'));
  perform pg_temp.expect(said is not null, 'an unknown event was allowed');
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event, bundle) values (%s, %L, %L, %L, %L)', s, 'ar-boss', 'g-once', 'unlocked', b));
  perform pg_temp.expect(said is not null, 'a bundle on an unlocked event was allowed');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-once', 'unlocked');
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'g-once', 'unlocked'));
  perform pg_temp.expect(said like '%already unlocked%', 'a beat was unlocked twice: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event, bundle) values (%s, %L, %L, %L, %L)', s, 'ar-boss', 'g-once', 'played', b));
  perform pg_temp.expect(said like '%no part%', 'a played beat named a bundle that has no part of the persona''s: ' || coalesce(said, 'allowed'));
  q := pg_temp.part(b, 'Some bundle', 'one', 'createBoard', pg_temp.mkboard('Guard Board'), interval '30 days');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'g-once', 'played', b);
  -- Once played, a beat that is not repeatable cannot unlock again, and cannot lapse; a repeatable one can unlock again.
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'g-once', 'unlocked'));
  perform pg_temp.expect(said like '%not repeatable%', 'a beat that is not repeatable unlocked again: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'g-once', 'lapsed'));
  perform pg_temp.expect(said is not null, 'a played beat lapsed');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-again', 'unlocked');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-again', 'played');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-again', 'unlocked');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-again', 'played');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-lapse', 'unlocked');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-lapse', 'lapsed');
  said := pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'ar-boss', 'g-lapse', 'unlocked'));
  perform pg_temp.expect(said is not null, 'a lapsed beat unlocked again');
  -- Insert-only: no update, no delete, no truncate, whoever asks.
  said := pg_temp.refusal('update arc_beat_events set at = now()');
  perform pg_temp.expect(said like '%only ever added%', 'an event was updated: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal('delete from arc_beat_events');
  perform pg_temp.expect(said like '%only ever added%', 'an event was deleted: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal('truncate arc_beat_events');
  perform pg_temp.expect(said like '%only ever added%', 'the events were truncated: ' || coalesce(said, 'allowed'));
  perform pg_temp.expect((select count(*) from pg_trigger t where t.tgrelid = 'public.arc_beat_events'::regclass and not t.tgisinternal and t.tgenabled = 'A') = 4, 'a guard of arc_beat_events does not fire always');
end $$;
-- The rest of the file uses other beats: these are the guard's alone, and the tick never unlocks them.

-- ---- 4. The clock: a phase has begun, or the season is within N days of its end, with the persona's own phase days ----
do $$
begin
  perform pg_temp.began(0);
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "honeymoon"}'), 'the honeymoon has not begun on the first day');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "reign"}'), 'the reign has begun on the first day');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "daysBeforeEnd": 7}'), 'a season of 90 days is within 7 of its end on the first day');
  perform pg_temp.began(5);
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "reign"}'), 'the reign began after 5 days of a 14 day honeymoon');
  perform pg_temp.expect(pg_temp.holds('ar-other', '{"kind": "phase", "phase": "reign"}'), 'a persona with a 3 day honeymoon is not in its reign after 5 days');
  perform pg_temp.began(15);
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "reign"}'), 'the reign has not begun after the honeymoon');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "meltdown"}'), 'the meltdown has begun in the middle of the season');
  perform pg_temp.began(70);
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "meltdown"}'), 'the meltdown (the last 21 days) has not begun at day 70');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "phase", "daysBeforeEnd": 25}'), 'day 70 is not within 25 days of the end');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "daysBeforeEnd": 15}'), 'day 70 is within 15 days of the end');
  -- Both together: both must hold.
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "meltdown", "daysBeforeEnd": 15}'), 'both parts of a phase condition were not required');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "phase", "phase": "meltdown", "daysBeforeEnd": 25}'), 'both parts held and the condition did not');
  perform pg_temp.began(0);
end $$;

-- ---- 5. The tick: unlocking writes once, reads the season's Boss alone, and does nothing while The System is off ----
do $$
declare
  before_n bigint;
begin
  perform pg_temp.began(15);
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  before_n := pg_temp.total();
  perform system_tick();
  perform pg_temp.expect(pg_temp.total() = before_n, 'the tick wrote a beat event while The System is off');
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('split') = 'unlocked' and pg_temp.n('split') = 1, 'split did not unlock at the reign: ' || coalesce(pg_temp.state('split'), 'nothing'));
  perform pg_temp.expect(pg_temp.state('opt') = 'unlocked', 'an optional beat did not unlock');
  perform pg_temp.expect(pg_temp.state('picking') is null, 'picking unlocked before the split landed');
  perform pg_temp.expect(pg_temp.state('late') is null, 'late unlocked at day 15 of 90');
  perform pg_temp.expect(pg_temp.state('lap') is null and pg_temp.state('rev') is null and pg_temp.state('met') is null and pg_temp.state('fail') is null, 'a mini-arc unlocked with nothing to unlock it');
  -- Only the season's Boss is read: the other persona's condition holds, and nothing is written for it.
  perform pg_temp.expect(pg_temp.holds('ar-other', '{"kind": "phase", "phase": "reign"}') and pg_temp.n('other-beat', null, 'ar-other') = 0, 'a persona that is not the Boss had its beats read');
  -- Once is once: ticks again write nothing more for a beat already unlocked.
  before_n := pg_temp.total();
  perform system_tick();
  perform system_tick();
  perform pg_temp.expect(pg_temp.total() = before_n, 'a beat unlocked twice with nothing played: ' || (pg_temp.total() - before_n) || ' more');
  perform pg_temp.expect(pg_temp.state('once') = 'unlocked' and pg_temp.state('again') = 'unlocked', 'the reign did not unlock the two mini-arcs that wait on it');
  perform pg_temp.expect(pg_temp.n('never') = 0 and pg_temp.n('g-lapse', 'unlocked') = 1, 'a beat that waits on itself unlocked');
end $$;

-- ---- 6. beatLanded and the board a beat's part made: the bundle's parts must all have landed ----
do $$
declare
  s bigint := pg_temp.season();
  b uuid := gen_random_uuid();
  q1 bigint;
  q2 bigint;
  minus uuid;
  fang uuid;
begin
  q1 := pg_temp.part(b, 'The Split', 'minus', 'createBoard', pg_temp.mkboard('World Minus One'));
  q2 := pg_temp.part(b, 'The Split', 'fangames', 'createBoard', pg_temp.mkboard('Fangame Palace'));
  -- The meeting writes `played` with the bundle it queued. Before it lands, the beat has not landed, and no role has a board.
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'split', 'played', b);
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "split"}'), 'a beat whose bundle waits has landed');
  perform pg_temp.expect(beat_role_board(s, 'ar-boss', 'split', 'minus') is null, 'a role has a board before its part landed');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "picking"}'), 'a beat that was never played has landed');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "ghost"}'), 'a beat of nobody''s has landed');
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = q1) and (select landed_act is not null from queued_moves where id = q2), 'the parts did not land');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "split"}'), 'a beat whose bundle landed has not landed');
  -- The same tick that landed the parts unlocked what waited on them.
  perform pg_temp.expect(pg_temp.state('picking') = 'unlocked', 'picking did not unlock in the tick that landed the split: ' || coalesce(pg_temp.state('picking'), 'nothing'));
  perform pg_temp.expect(pg_temp.state('late') is null, 'late unlocked 75 days before the end');
  minus := (select id from boards where slug = 'world-minus-one');
  fang := (select id from boards where slug = 'fangame-palace');
  perform pg_temp.expect(beat_role_board(s, 'ar-boss', 'split', 'minus') = minus, 'the role minus is not the board its part made');
  perform pg_temp.expect(beat_role_board(s, 'ar-boss', 'split', 'fangames') = fang, 'the role fangames is not the board its part made');
  perform pg_temp.expect(beat_role_board(s, 'ar-boss', 'split', 'nowhere') is null and beat_role_board(s, 'ar-boss', 'picking', 'minus') is null, 'a role no part has, or a beat never played, has a board');
end $$;

-- ---- 7. boardActivity: posts per board over the last N days, above or below a number or another board, reading the board each thread is on ----
do $$
declare
  s bigint := pg_temp.season();
  a uuid := tests.character(tests.account('ar-p1'), 'Arc Ann');
  b uuid := tests.character(tests.account('ar-p2'), 'Arc Bo');
  minus uuid := pg_temp.board('world-minus-one');
  fang uuid := pg_temp.board('fangame-palace');
  t uuid;
  i integer;
  fangref jsonb := '{"role": "fangames", "beat": "split"}';
  minusref jsonb := '{"role": "minus", "beat": "split"}';
begin
  -- Empty boards: nothing is above nothing.
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', fangref, 'days', 7, 'above', minusref)), '0 is above 0');
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', fang, 'days', 7, 'below', 1)), 'an empty board is not below 1');
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('lap') is null, 'a mini-arc unlocked on two empty boards');
  -- Fangames: 3 posts now; minus: 1 now and 5 ten days ago (outside a 7 day window, inside 14).
  insert into threads (board, title) values (fang, 'Fangame thread') returning id into t;
  for i in 1..3 loop perform tests.post(a, t, 'Post ' || i, now() - make_interval(hours => i)); end loop;
  insert into threads (board, title) values (minus, 'Minus thread now') returning id into t;
  perform tests.post(b, t, 'Now', now() - interval '1 hour');
  insert into threads (board, title) values (minus, 'Minus thread old') returning id into t;
  for i in 1..5 loop perform tests.post(b, t, 'Old ' || i, now() - interval '10 days' - make_interval(mins => i)); end loop;
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', fang, 'days', 7, 'above', 2)), '3 posts are not above 2');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', fang, 'days', 7, 'above', 3)), '3 posts are above 3 (above is strict)');
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', minus, 'days', 7, 'below', 2)), '1 post is not below 2');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', minus, 'days', 14, 'below', 2)), 'posts 10 days old were not counted in a 14 day window');
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', minus, 'days', 14, 'above', 5)), 'a 14 day window did not count 6 posts');
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', fangref, 'days', 7, 'above', minusref)), '3 is not above 1 by role');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', minusref, 'days', 7, 'above', fangref)), '1 is above 3 by role');
  perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', minus, 'days', 7, 'below', fang)), '1 is not below 3 by id');
  -- A role no part made, a board that does not exist, and a board that is no uuid are false, not errors.
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', '{"role": "nowhere", "beat": "split"}'::jsonb, 'days', 7, 'below', 100)), 'a role no part made has posts');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', gen_random_uuid(), 'days', 7, 'below', 100)), 'a board that does not exist has posts');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', 'general', 'days', 7, 'below', 100)), 'a board that is no uuid has posts');
  -- Only the board a thread is on now: the system board's and others' posts are not counted here.
  -- A board of its own: General is not empty here, since an earlier file's race tests commit posts to it through dblink, which this file's rollback cannot take back.
  insert into boards (slug, name) values ('ar-quiet', 'Ar Quiet');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', jsonb_build_object('kind', 'boardActivity', 'board', pg_temp.board('ar-quiet'), 'days', 7, 'above', 0)), 'posts on other boards were counted');
  -- The mini-arc: unlocked by the next tick, once.
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('lap') = 'unlocked' and pg_temp.n('lap') = 1, 'the mini-arc did not unlock when its board out-posted the other: ' || coalesce(pg_temp.state('lap'), 'nothing'));
  perform system_tick();
  perform pg_temp.expect(pg_temp.n('lap') = 1, 'the mini-arc unlocked twice');
end $$;

-- ---- 8. moveReversed and demandResolved: this Boss's moves, this season ----
do $$
declare
  mv uuid;
  other uuid;
  favor uuid;
  gone uuid;
  kept uuid;
  d jsonb := jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', 5));
begin
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "moveReversed"}') and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "met"}')
    and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "failed"}'), 'a move that was never reversed or resolved says so');
  -- Another persona's move, reversed, is no one of this Boss's.
  update characters set debuted_at = now() where staff = 'ar-other' and debuted_at is null;
  other := pg_temp.landed('ar-other', 'Other Name', null);
  perform end_move(other, 'reversed', 'admin');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "moveReversed"}'), 'another persona''s reversed move counted');
  -- A move that ended by itself is no reversal, and a favor (no demand) that expired is no failed demand.
  favor := pg_temp.landed('ar-boss', 'Favor Name', null);
  perform end_move(favor, 'expired', 'expiry');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "moveReversed"}') and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "failed"}'), 'an expired favor counted as a reversal or a failed demand');
  -- A met demand; an expired demand is a failed one.
  kept := pg_temp.landed('ar-boss', 'Kept Name', d);
  perform end_move(kept, 'met', 'demand');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "met"}') and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "failed"}'), 'a met demand was not read as met alone');
  gone := pg_temp.landed('ar-boss', 'Gone Name', d);
  perform end_move(gone, 'expired', 'expiry');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "failed"}'), 'an expired demand was not read as failed');
  -- An admin's reversal of this Boss's move.
  mv := pg_temp.landed('ar-boss', 'Reversed Name', null);
  perform end_move(mv, 'reversed', 'admin');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "moveReversed"}'), 'an admin''s reversal of the Boss''s move was not read');
  -- This season only: a season that begins after those ends has none of them.
  update seasons set starts_at = now() + interval '1 hour' where ends_at is null;
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "moveReversed"}') and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "met"}')
    and not pg_temp.holds('ar-boss', '{"kind": "demandResolved", "outcome": "failed"}'), 'a reversal or a demand from before the season counted');
  perform pg_temp.began(15);
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('rev') = 'unlocked', 'an admin''s reversal of the Boss''s move did not unlock its mini-arc: ' || coalesce(pg_temp.state('rev'), 'nothing'));
  perform pg_temp.expect(pg_temp.state('met') = 'unlocked' and pg_temp.state('fail') = 'unlocked', 'met and fail did not unlock: ' || coalesce(pg_temp.state('met'), 'nothing') || ' ' || coalesce(pg_temp.state('fail'), 'nothing'));
end $$;

-- ---- 9. A repeatable mini-arc unlocks again after it is played; the other does not; the season's end lapses the optional beats once ----
do $$
declare
  s bigint := pg_temp.season();
  before_n bigint;
begin
  -- Both mini-arcs are played, as the meeting will play them; the tick unlocks the repeatable one again while its condition holds, and the other stays played.
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'again', 'played');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'once', 'played');
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('again') = 'unlocked' and pg_temp.n('again', 'unlocked') = 2, 'a repeatable mini-arc did not unlock again after it was played: ' || pg_temp.n('again', 'unlocked'));
  perform pg_temp.expect(pg_temp.state('once') = 'played' and pg_temp.n('once', 'unlocked') = 1, 'a mini-arc that is not repeatable unlocked again');
  -- Late: within 7 days of the end, the split having landed, the due beat unlocks.
  perform pg_temp.began(85);
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('late') = 'unlocked', 'late did not unlock within 7 days of the end');
  -- The season's end: optional beats still unlocked lapse; a due beat does not; a played one does not; nothing new unlocks.
  perform pg_temp.began(91);
  before_n := pg_temp.total();
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('opt') = 'lapsed' and pg_temp.state('picking') = 'lapsed', 'an optional beat did not lapse at the season''s end');
  perform pg_temp.expect(pg_temp.state('lap') = 'lapsed' and pg_temp.state('rev') = 'lapsed' and pg_temp.state('met') = 'lapsed' and pg_temp.state('fail') = 'lapsed' and pg_temp.state('again') = 'lapsed', 'an unplayed mini-arc did not lapse at the season''s end');
  perform pg_temp.expect(pg_temp.state('g-lapse') = 'lapsed' and pg_temp.state('g-again') = 'played' and pg_temp.state('g-once') = 'played', 'a beat the guard test left changed state at the season''s end');
  perform pg_temp.expect(pg_temp.state('late') = 'unlocked', 'a due beat lapsed (it is required, not optional)');
  perform pg_temp.expect(pg_temp.state('split') = 'played' and pg_temp.state('once') = 'played' and pg_temp.state('never') is null, 'a played beat lapsed, or a beat that never unlocked did');
  perform pg_temp.expect(pg_temp.total() - before_n = 7, 'the season''s end wrote ' || (pg_temp.total() - before_n) || ' events, not the 7 lapses');
  -- Once: another tick writes nothing.
  before_n := pg_temp.total();
  perform system_tick();
  perform system_tick();
  perform pg_temp.expect(pg_temp.total() = before_n, 'a beat lapsed twice');
end $$;

-- ---- 10. The bound: the board count is one read of the indexes, never a scan of the posts ----
-- The property: no Seq Scan; the board's threads reached by an Index Cond on the board and the window; the posts by an Index Cond on the thread. No index is named, because the
-- planner's pick among the indexes that can serve it depends on the database's rows.
create function pg_temp.reads_by_ranges(plan text) returns boolean language sql as $$
  select plan !~* 'seq scan' and plan ~* 'index cond: \(\(board = \S+\) and \(last_at' and plan ~* 'index cond: \(+thread = t\.id'
$$;
do $$
declare
  -- The statement arc_board_posts runs, copied here so its plan can be read: the board's threads active in the window by (board, last_at desc), then each one's posts in the window by thread and time.
  stmt constant text := $q$select count(*) from threads t join acts p on p.thread = t.id and p.kind = 'post' and p.character is not null and p.created_at >= since where t.board = in_board and t.last_at >= since$q$;
  plan text := '';
  r record;
begin
  perform pg_temp.expect(position(stmt in regexp_replace(pg_get_functiondef('arc_board_posts(uuid, integer)'::regprocedure), '\s+', ' ', 'g')) > 0, 'the statement read here is not the one arc_board_posts runs');
  -- A small test database would read a table in order whatever indexes there are; with that off, the plan says which indexes the statement can use at all.
  set local enable_seqscan = off;
  -- Threads have other indexes that lead with the board (threads_board, threads_board_title), and on a database that has had a full run's rows the planner may take one for a
  -- board equality alone. They are dropped here, inside this transaction, so the plan shows whether the statement can use the (board, last_at) index at all.
  for r in select indexname::text as indexname from pg_indexes where schemaname = 'public' and tablename = 'threads' and indexname <> 'threads_board_last_at' and indexdef ~ '\(board[,)]' loop
    execute format('drop index %I', r.indexname);
  end loop;
  -- The indexes that could serve the posts some other way (by time alone, or thread-first but read whole by skipping the character) go too, rolled back with this transaction, so the plan
  -- shows whether a range per board and per thread exists at all.
  drop index acts_thread_posts, acts_posts_by_time, acts_recent_posts, acts_created;
  plan := '';
  for r in execute 'explain (costs off) ' || replace(replace(stmt, 'in_board', quote_literal(pg_temp.board('fangame-palace')) || '::uuid'), 'since', 'now() - interval ''7 days''') loop
    plan := plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform pg_temp.expect(pg_temp.reads_by_ranges(plan), 'the board count and the posts of its threads are not read by index ranges: ' || plan);
  -- Driven red: with index and bitmap scans off the planner reads both tables in order, and the same predicate must say so (restored after).
  set local enable_seqscan = on;
  set local enable_indexscan = off;
  set local enable_bitmapscan = off;
  plan := '';
  for r in execute 'explain (costs off) ' || replace(replace(stmt, 'in_board', quote_literal(pg_temp.board('fangame-palace')) || '::uuid'), 'since', 'now() - interval ''7 days''') loop
    plan := plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform pg_temp.expect(plan ~* 'seq scan' and not pg_temp.reads_by_ranges(plan), 'the plan check did not fail on a seq scan: ' || plan);
  set local enable_seqscan = off;
  set local enable_indexscan = on;
  set local enable_bitmapscan = on;
end $$;

-- ---- 11. The masks: nothing the conditions read is a private fact. A grep of each definition finds no owner, account or reaction; the grep is driven red on a planted function ----
create function pg_temp.leaks(proc regprocedure) returns text language sql as $$
  select string_agg(distinct m[1], ',') from regexp_matches(lower(pg_get_functiondef(proc)), '(owner|account|reaction)', 'g') m
$$;
create function pg_temp.poisoned() returns integer language sql as $$ select count(*)::integer from reaction_tallies $$;
do $$
declare
  p regprocedure;
begin
  perform pg_temp.expect(pg_temp.leaks('pg_temp.poisoned()'::regprocedure) = 'reaction', 'the masks check did not find the word it exists to find');
  for p in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace and proname in ('beat_condition_holds', 'arc_board', 'arc_board_posts', 'arc_season_span', 'beat_role_board', 'arc_pass', 'arc_pass_for', 'arc_latest_states', 'beat_is_due', 'held_back_kinds', 'arc_for_meeting') loop
    perform pg_temp.expect(pg_temp.leaks(p) is null, p::text || ' reads a private fact: ' || pg_temp.leaks(p));
  end loop;
  perform pg_temp.expect((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('beat_condition_holds', 'arc_board', 'arc_board_posts', 'arc_season_span', 'beat_role_board', 'arc_pass', 'arc_pass_for', 'arc_latest_states', 'beat_is_due', 'held_back_kinds', 'arc_for_meeting')) = 11, 'a function the masks check reads is missing');
  -- Every definer function here pins its search path, and no client can call one.
  perform pg_temp.expect(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('beat_condition_holds', 'arc_board', 'arc_board_posts', 'arc_season_span', 'beat_role_board', 'arc_pass', 'arc_pass_for', 'arc_latest_states', 'beat_is_due', 'held_back_kinds', 'arc_for_meeting', 'arc_beat_events_guard')
    and (not prosecdef or not exists (select 1 from unnest(proconfig) c where c = 'search_path=public, pg_temp'))), 'an arc function is not a definer with a pinned search path');
  perform pg_temp.expect(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('beat_condition_holds', 'arc_board', 'arc_board_posts', 'arc_season_span', 'beat_role_board', 'arc_pass', 'arc_pass_for', 'arc_latest_states', 'beat_is_due', 'held_back_kinds', 'arc_for_meeting')
    and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))), 'a client can call an arc function');
end $$;

-- ---- 12. A phase has begun: and stays begun. The honeymoon has begun from the season's first instant, the reign once the honeymoon is over, the meltdown in the season's last days ----
do $$
declare
  r record;
begin
  -- (day of the season, phase, has begun) for the instance's 14 day honeymoon and 21 day meltdown of a 90 day season.
  for r in select * from (values
    (0, 'honeymoon', true), (0, 'reign', false), (0, 'meltdown', false),
    (13, 'honeymoon', true), (13, 'reign', false), (13, 'meltdown', false),
    (15, 'honeymoon', true), (15, 'reign', true), (15, 'meltdown', false),
    (68, 'reign', true), (68, 'meltdown', false),
    (70, 'honeymoon', true), (70, 'reign', true), (70, 'meltdown', true)
  ) t(day, ph, begun) loop
    perform pg_temp.began(r.day);
    perform pg_temp.expect(pg_temp.holds('ar-boss', jsonb_build_object('kind', 'phase', 'phase', r.ph)) = r.begun, format('on day %s the %s has %sbegun, and the condition says otherwise', r.day, r.ph, case when r.begun then '' else 'not ' end));
  end loop;
  perform pg_temp.began(0);
end $$;

-- ---- 13. The held-back kinds: a kind is held until the beat it names has unlocked ----
do $$
declare
  s bigint := pg_temp.season();
begin
  update persona_arcs set holds_back = '[{"kind": "createBoard", "until": "split"}, {"kind": "moveThread", "until": "never"}, {"kind": "mergeBoard", "until": "late"}]' where staff = 'ar-boss';
  -- split unlocked in section 5 and late in section 9; `never` has not.
  perform pg_temp.expect(held_back_kinds('ar-boss', s) = array['moveThread'], 'the held kinds are not the one whose beat has not unlocked: ' || coalesce(held_back_kinds('ar-boss', s)::text, 'null'));
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'never', 'unlocked');
  perform pg_temp.expect(held_back_kinds('ar-boss', s) = '{}', 'a kind is held after its beat unlocked: ' || held_back_kinds('ar-boss', s)::text);
  perform pg_temp.expect(held_back_kinds('ar-other', s) = '{}' and held_back_kinds('ar-plain', s) = '{}' and held_back_kinds('nobody', s) = '{}', 'a persona that holds nothing back, or none, holds back a kind');
  -- A season in which nothing has unlocked holds back every kind it names (a season that has not begun its arc).
  perform pg_temp.expect(held_back_kinds('ar-boss', s + 1000) = array['createBoard', 'moveThread', 'mergeBoard'], 'a season with no events does not hold every kind back: ' || held_back_kinds('ar-boss', s + 1000)::text);
end $$;

-- ---- 14. The due point: past it once the phase's day, the days into it, or the days before the end have come (any one of those named) ----
do $$
declare
  s bigint := pg_temp.season();
  r record;
begin
  -- (day of the season, due point, past it)
  for r in select * from (values
    (15, '{"phase": "reign", "daysIntoPhase": 7}'::jsonb, false), (22, '{"phase": "reign", "daysIntoPhase": 7}', true),
    (85, '{"daysBeforeEnd": 2}', false), (89, '{"daysBeforeEnd": 2}', true),
    (60, '{"phase": "meltdown"}', false), (70, '{"phase": "meltdown"}', true),
    (2, '{"phase": "honeymoon", "daysIntoPhase": 3}', false), (4, '{"phase": "honeymoon", "daysIntoPhase": 3}', true),
    (15, '{"phase": "reign"}', true), (5, '{"phase": "reign"}', false),
    (30, '{"phase": "reign", "daysIntoPhase": 7, "daysBeforeEnd": 2}', true), (89, '{"phase": "meltdown", "daysIntoPhase": 40, "daysBeforeEnd": 2}', true)
  ) t(day, due, past) loop
    perform pg_temp.began(r.day);
    perform pg_temp.expect(beat_is_due('ar-boss', s, r.due) = r.past, format('on day %s the due point %s is %spast, and the evaluator says otherwise', r.day, r.due, case when r.past then '' else 'not ' end));
  end loop;
  perform pg_temp.expect(beat_is_due('ar-boss', s, 'null'::jsonb) is false and beat_is_due('ar-boss', s, '{}'::jsonb) is false, 'a beat with no due point is due');
  -- The Boss's unlocked, unplayed beats with their due state, and what it holds back: the one read the meeting makes. Day 89: `late` (due two days before the end) is unlocked and past its point;
  -- `never` was unlocked by hand in section 13 and has none.
  perform pg_temp.began(89);
  perform pg_temp.expect(arc_for_meeting('ar-boss', s) = jsonb_build_object('beats', jsonb_build_array(
      jsonb_build_object('key', 'late', 'mini', false, 'due', true), jsonb_build_object('key', 'never', 'mini', false, 'due', false)),
    'heldBack', '[]'::jsonb), 'the meeting''s read is not the unlocked, unplayed beats with their due state: ' || arc_for_meeting('ar-boss', s)::text);
  -- Before the due point the same beat is not due; a played beat is not listed; a persona with no arc reads empty.
  perform pg_temp.began(80);
  perform pg_temp.expect((arc_for_meeting('ar-boss', s) -> 'beats' -> 0 ->> 'due')::boolean is false, 'late is due before its point');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'never', 'played');
  perform pg_temp.expect(arc_for_meeting('ar-boss', s) -> 'beats' = '[{"key": "late", "mini": false, "due": false}]'::jsonb, 'a played beat is still listed: ' || (arc_for_meeting('ar-boss', s) -> 'beats')::text);
  perform pg_temp.expect(arc_for_meeting('ar-plain', s) = '{"beats": [], "heldBack": []}'::jsonb and arc_for_meeting('nobody', s) = '{"beats": [], "heldBack": []}'::jsonb, 'a persona with no arc has beats');
  -- A lapsed beat is not listed either (`rev` lapsed in section 9): the meeting's read and the pass share one definition of a beat's state.
  perform pg_temp.expect(not (arc_for_meeting('ar-boss', s) -> 'beats')::text like '%"rev"%', 'a lapsed beat is listed');
end $$;

-- ---- 15. A persona's own phase days: a day that is no number falls back to the instance's, a fraction is made whole, and the engine's caps hold, as phaseAt holds them ----
do $$
declare
  s bigint := pg_temp.season();
  r record;
  got interval;
begin
  perform pg_temp.began(0);
  for r in select * from (values
    ('{"honeymoon": null}'::jsonb, interval '14 days'), ('{"honeymoon": "three"}', interval '14 days'), ('{"honeymoon": true}', interval '14 days'), ('{}', interval '14 days'),
    ('{"honeymoon": 2.5}', interval '2 days'), ('{"honeymoon": 0}', interval '1 day'), ('{"honeymoon": -4}', interval '1 day'), ('{"honeymoon": 500}', interval '42 days'), ('{"honeymoon": 3}', interval '3 days')
  ) t(days, expect) loop
    update persona_arcs set phase_days = r.days where staff = 'ar-other';
    select x.honeymoon_ends - x.starts_at into got from arc_season_span('ar-other', s) x;
    perform pg_temp.expect(got = r.expect, format('phase days %s gave a honeymoon of %s, not %s', r.days, got, r.expect));
  end loop;
  update persona_arcs set phase_days = '{"meltdown": 500}' where staff = 'ar-other';
  perform pg_temp.expect((select x.ends_at - x.meltdown_starts from arc_season_span('ar-other', s) x) = interval '42 days', 'a meltdown over the cap was not cut to it');
  update persona_arcs set phase_days = '{"honeymoon": 3}' where staff = 'ar-other';
end $$;

-- ---- 16. beatLanded: a beat with no bundle has landed once played; a repeatable beat is read at its latest play ----
do $$
declare
  s bigint := pg_temp.season();
  b uuid := gen_random_uuid();
begin
  -- `once` was played in section 9 with no bundle.
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "once"}'), 'a played beat with no bundle has not landed');
  -- g-again was played twice with no bundle (section 3); a third play queues a bundle that waits, and the beat is not landed until it is.
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "g-again"}'), 'a repeatable beat played with no bundle has not landed');
  perform pg_temp.part(b, 'Replay', 'one', 'createBoard', pg_temp.mkboard('Replay Board'), interval '30 days');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'g-again', 'unlocked');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'g-again', 'played', b);
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "g-again"}'), 'a replay whose bundle waits was read as landed by an earlier play');
end $$;

-- The tick may already have unlocked a beat that waits on one played earlier in this file; the guard refuses a second `unlocked`, so unlock only a beat still locked.
create function pg_temp.unlock(beat text) returns void language sql as $$
  insert into arc_beat_events (season, staff, beat, event) select pg_temp.season(), 'ar-boss', unlock.beat, 'unlocked' where pg_temp.state(unlock.beat) is distinct from 'unlocked'
$$;
-- ---- 16b. beatLanded under the owner's rule (#459): played, every part not held or refused has landed, and at least one has ----
do $$
declare
  s bigint := pg_temp.season();
  adm uuid := (select id from auth.users where email = 'ar-admin@test.invalid');
  b uuid;
  q1 bigint;
  q2 bigint;
begin
  -- One part held, one landed: landed.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Held one', 'one', 'createBoard', pg_temp.mkboard('Held One A'));
  q2 := pg_temp.part(b, 'Held one', 'two', 'createBoard', pg_temp.mkboard('Held One B'));
  update queued_moves set held_at = now(), held_by = adm where id = q1;
  perform pg_temp.unlock('r-held');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-held', 'played', b);
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-held"}'), 'a beat landed while its other part still waits');
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = q2) and (select landed_act is null from queued_moves where id = q1), 'the free part did not land, or the held one did');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-held"}'), 'a beat with one part held and the other landed has not landed');

  -- Every part held: not landed.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'All held', 'one', 'createBoard', pg_temp.mkboard('All Held A'));
  q2 := pg_temp.part(b, 'All held', 'two', 'createBoard', pg_temp.mkboard('All Held B'));
  update queued_moves set held_at = now(), held_by = adm where bundle = b;
  perform pg_temp.unlock('r-allheld');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-allheld', 'played', b);
  perform system_tick();
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-allheld"}'), 'a beat whose every part is held has landed');

  -- One part refused, one landed: landed.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Refused one', 'one', 'createBoard', pg_temp.mkboard('Refused One A'));
  q2 := pg_temp.part(b, 'Refused one', 'two', 'createBoard', pg_temp.mkboard('Refused One B'));
  update queued_moves set refused_at = now(), failed_at = now(), failure = 'refused for the test' where id = q1;
  perform pg_temp.unlock('r-refused');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-refused', 'played', b);
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = q2), 'the other part did not land');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-refused"}'), 'a beat with one part refused and the other landed has not landed');

  -- A landed part reversed afterward still counts as landed: it did land, and the reversal is an Act beside it. One of two reversed, then both.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Reversed one', 'one', 'createBoard', pg_temp.mkboard('Reversed One A'));
  q2 := pg_temp.part(b, 'Reversed one', 'two', 'createBoard', pg_temp.mkboard('Reversed One B'));
  perform pg_temp.unlock('r-reversed');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-reversed', 'played', b);
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves where bundle = b and landed_act is not null) = 2, 'both parts should have landed');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-reversed"}'), 'a beat whose parts landed has not landed');
  perform end_move((select landed_act from queued_moves where id = q1), 'reversed', 'admin');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-reversed"}'), 'a beat with one landed part later reversed was read as not landed');
  perform end_move((select landed_act from queued_moves where id = q2), 'reversed', 'admin');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-reversed"}'), 'a beat whose every landed part was later reversed was read as not landed');

  -- A failure the tick will retry is not a refusal: that part is still waiting.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Failed one', 'one', 'createBoard', pg_temp.mkboard('Failed One A'), interval '30 days');
  q2 := pg_temp.part(b, 'Failed one', 'two', 'createBoard', pg_temp.mkboard('Failed One B'));
  update queued_moves set failed_at = now(), failure = 'a failure the tick retries' where id = q1;
  perform pg_temp.unlock('r-failed');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-failed', 'played', b);
  perform system_tick();
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-failed"}'), 'a part that failed and will be retried was read as refused');

  -- One part waiting, one landed: not landed.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Waiting one', 'one', 'createBoard', pg_temp.mkboard('Waiting One A'), interval '30 days');
  q2 := pg_temp.part(b, 'Waiting one', 'two', 'createBoard', pg_temp.mkboard('Waiting One B'));
  perform pg_temp.unlock('r-waiting');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-waiting', 'played', b);
  perform system_tick();
  perform pg_temp.expect((select landed_act is not null from queued_moves where id = q2) and (select landed_act is null from queued_moves where id = q1), 'one part should have landed and one waited');
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-waiting"}'), 'a beat with a part still waiting has landed');

  -- A beat with no bundle, played: landed.
  perform pg_temp.unlock('r-nobundle');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'ar-boss', 'r-nobundle', 'played');
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-nobundle"}'), 'a played beat with no bundle has not landed');

  -- A repeatable beat is read at its latest play: a landed first play, then a replay whose only part is held.
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Again one', 'one', 'createBoard', pg_temp.mkboard('Again One A'));
  perform pg_temp.unlock('r-again');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-again', 'played', b);
  perform system_tick();
  perform pg_temp.expect(pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-again"}'), 'the first play did not land');
  b := gen_random_uuid();
  q1 := pg_temp.part(b, 'Again two', 'one', 'createBoard', pg_temp.mkboard('Again Two A'));
  update queued_moves set held_at = now(), held_by = adm where id = q1;
  perform pg_temp.unlock('r-again');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (s, 'ar-boss', 'r-again', 'played', b);
  perform pg_temp.expect(not pg_temp.holds('ar-boss', '{"kind": "beatLanded", "beat": "r-again"}'), 'a replay whose only part is held was read as landed by the earlier play');
end $$;

-- ---- 17. The season's close: the lapses of its last days are written for the closed season's Boss, and only once ----
do $$
declare
  old_season bigint := pg_temp.season();
  before_n bigint;
  closed jsonb;
begin
  -- `late` is due, unlocked and unplayed: in the open season past its planned end it is left (a meeting may still come); `never` was played.
  perform pg_temp.began(91);
  perform system_tick();
  perform pg_temp.expect((select e.event from arc_beat_events e where e.season = old_season and e.staff = 'ar-boss' and e.beat = 'late' order by e.id desc limit 1) = 'unlocked', 'a due beat lapsed in the open season');
  -- reveal_season closes the season and opens the next; the tick then lapses what was still unlocked, due beats too.
  closed := reveal_season(now());
  perform pg_temp.expect(closed is not null and pg_temp.season() <> old_season, 'the season did not close: ' || coalesce(closed::text, 'null'));
  before_n := (select count(*) from arc_beat_events where season = old_season);
  perform system_tick();
  perform pg_temp.expect((select e.event from arc_beat_events e where e.season = old_season and e.staff = 'ar-boss' and e.beat = 'late' order by e.id desc limit 1) = 'lapsed',
    'the closed season''s last unlocked beat did not lapse: ' || coalesce((select e.event from arc_beat_events e where e.season = old_season and e.staff = 'ar-boss' and e.beat = 'late' order by e.id desc limit 1), 'nothing'));
  perform pg_temp.expect((select count(*) from arc_beat_events where season = old_season) = before_n + 1, 'the close wrote ' || ((select count(*) from arc_beat_events where season = old_season) - before_n) || ' events, not the one lapse');
  -- A played beat stays played, and once is once.
  perform pg_temp.expect((select e.event from arc_beat_events e where e.season = old_season and e.beat = 'never' order by e.id desc limit 1) = 'played', 'a played beat lapsed at the close');
  before_n := (select count(*) from arc_beat_events);
  perform system_tick();
  perform system_tick();
  perform pg_temp.expect((select count(*) from arc_beat_events) = before_n, 'the closed season lapsed twice');
end $$;
