-- Lead-ins, aftermath and the new conditions (supabase/migrations/0447_arc_lead_ins_aftermath.sql; docs/plans/2026-11-25-arc-announcements-plan.md, Task 2; its design, sections 6, 7 and 8b).
--
--   * persona_arcs holds `lead_ins` ({beat key: unlock}) and `aftermath` (the beats a successor plays), and seed_instance writes both from the roster, never a brief.
--   * `phase` with `daysIntoPhase` holds once that many days of the phase have passed; a lead-in shows from the honeymoon's second week, not its first, and stops once its beat unlocks.
--   * arc_predecessor reads the handover that seated a Boss: the outgoing Boss and the season it served (the same season for a departure, the season before for a roll-over), and never an earlier Boss
--     after a departure and a roll-over in the same pair of seasons.
--   * `beatLanded` with `of: 'predecessor'` reads the predecessor's beat in its season by the same landed rule; with `not` it is the negation, and for a predecessor's beat only once the answer is
--     settled (a part still waiting is neither landed nor not landed), so two exclusive aftermath beats never both unlock. With no predecessor it is false either way.
--   * {role, beat, of: 'predecessor'} resolves to the board the predecessor's bundle made, and to none once that board is merged or reversed (an own beat's role is read as it always was).
--   * arc_pass_for records an aftermath beat of the predecessor's persona under the current Boss as `after:<predecessor>:<key>`, once, and lapses it at the season's end; arc_for_meeting lists it with
--     `aftermath: true` and its predecessor, and `leadIns` from arc_lead_ins.
--
-- The world is planted as fixture rows: personas in a seed, plays written as the meeting writes them, handovers inserted as hand_over writes them. Nothing here reads the instance's content.

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

-- ---- 0. The world: a Boss with a lead-in, predecessors shaped as FanGaME is (a Split, Everything is World -1, and the two aftermath beats), their successors, and a chain of three Bosses ----
create function pg_temp.persona(k text, arc jsonb default '[]', aftermath jsonb default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('key', k, 'name', k, 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'arc', arc, 'aftermath', aftermath, 'holdsBack', '[]'::jsonb, 'phaseDays', '{}'::jsonb))
$$;
do $$
declare
  seed jsonb;
  never jsonb := jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'never-lands'));
  -- What a predecessor plays: two beats that never unlock by themselves, so the test writes their plays by hand as the meeting does.
  pred_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', never),
    jsonb_build_object('key', 'everything', 'mini', false, 'repeatable', false, 'unlock', never),
    jsonb_build_object('key', 'a-only', 'mini', false, 'repeatable', false, 'unlock', never),
    jsonb_build_object('key', 'side', 'mini', false, 'repeatable', false, 'unlock', never));
  -- FanGaME-shaped: restore when his Everything landed, unfinished when his Split landed and Everything did not. `brief` is what the instance holds in code, and the database must not keep it.
  fan_after jsonb := jsonb_build_array(
    jsonb_build_object('key', 'restore', 'mini', true, 'brief', 'Put it all back.',
      'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'everything', 'of', 'predecessor'), jsonb_build_object('kind', 'phase', 'phase', 'honeymoon')),
      'leadIn', jsonb_build_object('unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon', 'daysIntoPhase', 3)), 'brief', 'Something is wrong with the place.', 'mood', 'uneasy')),
    jsonb_build_object('key', 'unfinished', 'mini', true, 'brief', 'Finish the cleanup.',
      'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split', 'of', 'predecessor'), jsonb_build_object('kind', 'beatLanded', 'beat', 'everything', 'of', 'predecessor', 'not', true))));
  chain_a_after jsonb := jsonb_build_array(
    jsonb_build_object('key', 'from-a', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'a-only', 'of', 'predecessor'))));
  chain_b_after jsonb := jsonb_build_array(
    jsonb_build_object('key', 'from-b', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'side', 'of', 'predecessor'))),
    jsonb_build_object('key', 'from-b-a', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'a-only', 'of', 'predecessor'))));
  lead_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign')),
      'leadIn', jsonb_build_object('unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon', 'daysIntoPhase', 7)), 'brief', 'Something nags.', 'mood', 'restless')),
    jsonb_build_object('key', 'epilogue', 'mini', false, 'repeatable', false,
      'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'meltdown'), jsonb_build_object('kind', 'beatLanded', 'beat', 'split', 'not', true))),
    jsonb_build_object('key', 'solo', 'mini', true, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split', 'not', true))));
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
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'al-lead',
      'staff', jsonb_build_array(
        pg_temp.persona('al-lead', lead_arc),
        pg_temp.persona('al-pr1', pred_arc, fan_after), pg_temp.persona('al-pr2', pred_arc, fan_after), pg_temp.persona('al-pr3', pred_arc, fan_after),
        pg_temp.persona('al-pr4', pred_arc, fan_after), pg_temp.persona('al-pr5', pred_arc, fan_after),
        pg_temp.persona('al-s1'), pg_temp.persona('al-s2'), pg_temp.persona('al-s3'), pg_temp.persona('al-s4'), pg_temp.persona('al-s5'),
        pg_temp.persona('al-dep', pred_arc), pg_temp.persona('al-dsc'),
        pg_temp.persona('al-ca', pred_arc, chain_a_after), pg_temp.persona('al-cb', pred_arc, chain_b_after), pg_temp.persona('al-cc')),
      'firstStaff', jsonb_build_array('al-pr1', 'al-pr2', 'al-pr3', 'al-pr4', 'al-pr5', 'al-dep', 'al-ca', 'al-cb', 'al-cc', 'al-s1', 'al-s2', 'al-s3', 'al-s4', 'al-s5', 'al-dsc'),
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
  insert into admins (account) values (tests.account('al-admin'));
end $$;

create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
-- Where the open season stands: it began this many days ago.
create function pg_temp.began(days numeric) returns void language sql as $$
  update seasons set starts_at = now() - make_interval(secs => (days * 86400)::double precision) where ends_at is null
$$;
create function pg_temp.boss(k text) returns void language sql as $$ update seasons set boss = k where ends_at is null $$;
create function pg_temp.holds(staff text, cond jsonb, sn bigint default null) returns boolean language plpgsql as $$
begin return beat_condition_holds(staff, coalesce(sn, pg_temp.season()), cond); end $$;
create function pg_temp.state(staff text, beat text, sn bigint default null) returns text language sql as $$
  select e.event from arc_beat_events e where e.season = coalesce(state.sn, pg_temp.season()) and e.staff = state.staff and e.beat = state.beat order by e.id desc limit 1
$$;
create function pg_temp.pass(staff text, sn bigint default null) returns jsonb language sql as $$ select arc_pass_for(pass.staff, coalesce(pass.sn, pg_temp.season()), false) $$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
create function pg_temp.part(who text, bundle uuid, bname text, role text, params jsonb, wait interval default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, who, 'createBoard', params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0') + case when wait is null then interval '0' else interval '1 day' end, true, bundle, bname, role) returning id into q;
  return q;
end $$;
-- A beat played, as the meeting writes it: unlocked, then played with the bundle it queued.
create function pg_temp.play(who text, beat text, bundle uuid default null) returns void language plpgsql as $$
begin
  insert into arc_beat_events (season, staff, beat, event) values (pg_temp.season(), who, beat, 'unlocked');
  insert into arc_beat_events (season, staff, beat, event, bundle) values (pg_temp.season(), who, beat, 'played', bundle);
end $$;
-- A handover, as hand_over writes its row.
create function pg_temp.handover(sn bigint, outgoing text, boss text, cause text) returns void language sql as $$
  insert into season_handovers (season, outgoing, boss, how, cause) values (sn, outgoing, boss, 'rotation', cause)
$$;

-- ---- 1. The seed writes both columns from the roster, and never a brief ----
do $$
declare
  lead record;
  fan record;
  said text;
begin
  select * into lead from persona_arcs where staff = 'al-lead';
  perform pg_temp.expect(lead.lead_ins = jsonb_build_object('split', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon', 'daysIntoPhase', 7))),
    'the seed did not write the beat''s lead-in unlock under its key: ' || lead.lead_ins::text);
  perform pg_temp.expect(lead.aftermath = '[]'::jsonb, 'a persona with no aftermath was given one');
  perform pg_temp.expect((select a.lead_ins = '{}'::jsonb from persona_arcs a where a.staff = 'al-pr1'), 'a persona with no lead-in has some');
  select * into fan from persona_arcs where staff = 'al-pr1';
  perform pg_temp.expect(jsonb_array_length(fan.aftermath) = 2 and fan.aftermath -> 0 ->> 'key' = 'restore' and fan.aftermath -> 1 ->> 'key' = 'unfinished', 'the seed did not write the two aftermath beats in order: ' || fan.aftermath::text);
  perform pg_temp.expect(jsonb_array_length(fan.aftermath -> 1 -> 'unlock') = 2 and fan.aftermath -> 0 #>> '{leadIn,unlock,0,daysIntoPhase}' = '3', 'an aftermath beat lost its unlock or its lead-in unlock');
  perform pg_temp.expect(fan.aftermath::text !~ 'brief|mood|Put it all back', 'the database kept a brief or a mood: ' || fan.aftermath::text);
  perform pg_temp.expect((select count(*) from persona_arcs where staff = 'al-pr1') = 1, 'a reseed wrote a persona''s row twice');
  -- An aftermath beat or a lead-in naming a condition the catalog lacks is refused, as an arc's is.
  said := pg_temp.refusal($q$select seed_instance(jsonb_build_object('system', jsonb_build_object('staff', jsonb_build_array(
    jsonb_build_object('key', 'al-pr1', 'name', 'al-pr1', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'arc', '[]'::jsonb,
      'aftermath', jsonb_build_array(jsonb_build_object('key', 'x', 'unlock', jsonb_build_array(jsonb_build_object('kind', 'noSuchCondition')))))))))$q$);
  perform pg_temp.expect(said like '%noSuchCondition%', 'an aftermath beat named a condition the catalog lacks: ' || coalesce(said, 'allowed'));
  said := pg_temp.refusal($q$select seed_instance(jsonb_build_object('system', jsonb_build_object('staff', jsonb_build_array(
    jsonb_build_object('key', 'al-lead', 'name', 'al-lead', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb,
      'arc', jsonb_build_array(jsonb_build_object('key', 'split', 'unlock', '[]'::jsonb,
        'leadIn', jsonb_build_object('unlock', jsonb_build_array(jsonb_build_object('kind', 'noSuchLeadIn'))))))))))$q$);
  perform pg_temp.expect(said like '%noSuchLeadIn%', 'a lead-in named a condition the catalog lacks: ' || coalesce(said, 'allowed'));
  perform pg_temp.expect((select lead_ins <> '{}'::jsonb from persona_arcs where staff = 'al-lead'), 'a refused seed rewrote a row');
end $$;

-- ---- 2. daysIntoPhase, and a lead-in: in the honeymoon's second week and not its first, and over once its beat unlocks ----
do $$
begin
  perform pg_temp.boss('al-lead');
  -- A phase's days: held from the phase's start, with the persona's own phase days (the honeymoon here is the instance's 14).
  perform pg_temp.began(3);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "phase", "phase": "honeymoon"}'), 'the honeymoon has not begun at day 3');
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "phase", "phase": "honeymoon", "daysIntoPhase": 7}'), 'seven days into the honeymoon at day 3');
  perform pg_temp.began(8);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "phase", "phase": "honeymoon", "daysIntoPhase": 7}'), 'not seven days into the honeymoon at day 8');
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "phase", "phase": "reign", "daysIntoPhase": 0}'), 'the reign began at day 8');
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "phase", "daysIntoPhase": 1}'), 'days into no phase held');
  perform pg_temp.began(15);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "phase", "phase": "reign", "daysIntoPhase": 0}') and not pg_temp.holds('al-lead', '{"kind": "phase", "phase": "reign", "daysIntoPhase": 2}'),
    'the reign at day 15 is not one day in');
  perform pg_temp.began(17);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "phase", "phase": "reign", "daysIntoPhase": 2}'), 'the reign at day 17 is not two days in');
  perform pg_temp.began(75);
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "phase", "phase": "meltdown", "daysIntoPhase": 10}') and pg_temp.holds('al-lead', '{"kind": "phase", "phase": "meltdown", "daysIntoPhase": 5}'),
    'the meltdown began on day 69; day 75 is six days in');
  -- A due point already read daysIntoPhase (beat_is_due, 0333) and still does.
  perform pg_temp.began(10);
  perform pg_temp.expect(beat_is_due('al-lead', pg_temp.season(), '{"phase": "honeymoon", "daysIntoPhase": 7}'), 'a due point 7 days into the honeymoon is not past at day 10');
end $$;
do $$
begin
  -- The lead-in: not in the first week, shown in the second, over once the beat unlocks (at the reign, day 14).
  perform pg_temp.began(3);
  perform system_tick();
  perform pg_temp.expect(arc_lead_ins('al-lead', pg_temp.season()) = '{}'::text[], 'a lead-in showed in the honeymoon''s first week: ' || arc_lead_ins('al-lead', pg_temp.season())::text);
  perform pg_temp.expect(arc_for_meeting('al-lead', pg_temp.season()) -> 'leadIns' = '[]'::jsonb, 'the meeting reads a lead-in in the first week');
  perform pg_temp.began(8);
  perform system_tick();
  perform pg_temp.expect(arc_lead_ins('al-lead', pg_temp.season()) = array['split'], 'the lead-in did not show in the honeymoon''s second week: ' || arc_lead_ins('al-lead', pg_temp.season())::text);
  perform pg_temp.expect(arc_for_meeting('al-lead', pg_temp.season()) -> 'leadIns' = '["split"]'::jsonb, 'the meeting does not read the lead-in');
  perform pg_temp.expect(pg_temp.state('al-lead', 'split') is null, 'the beat unlocked in the honeymoon');
  perform pg_temp.began(15);
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-lead', 'split') = 'unlocked', 'the beat did not unlock at the reign');
  perform pg_temp.expect(arc_lead_ins('al-lead', pg_temp.season()) = '{}'::text[], 'the lead-in went on after its beat unlocked');
  -- A persona with no lead-in, and no season or no persona, read none.
  perform pg_temp.expect(arc_lead_ins('al-s1', pg_temp.season()) = '{}'::text[] and arc_lead_ins(null, pg_temp.season()) = '{}'::text[] and arc_lead_ins('al-lead', null) = '{}'::text[], 'a persona with no lead-in has one');
end $$;

-- ---- 3. beatLanded with `not`, in a Boss's own arc: it never lifts a phase condition it is paired with ----
do $$
begin
  -- `not` alone holds from the season's first day: the beat has not landed yet (the instance check refuses a beat whose every condition is negated).
  perform pg_temp.began(3);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "beatLanded", "beat": "split", "not": true}'), 'a beat that was never played has landed');
  perform pg_temp.expect(pg_temp.state('al-lead', 'solo') = 'unlocked', 'a beat whose only condition is a negated beatLanded did not unlock on the first days');
  -- Paired with a phase that has not begun, it unlocks nothing: the negation holds and the phase does not.
  perform pg_temp.expect(pg_temp.state('al-lead', 'epilogue') is null, 'epilogue unlocked before the meltdown');
  perform pg_temp.began(40);
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-lead', 'epilogue') is null, 'epilogue unlocked at day 40, before the meltdown');
  perform pg_temp.began(75);
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-lead', 'epilogue') = 'unlocked', 'epilogue did not unlock in the meltdown with the split unlanded');
  -- A `not` that is false (the beat landed) keeps a beat locked even once its phase has come.
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "beatLanded", "beat": "solo", "not": true}') is null, 'a condition read null');
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "beatLanded", "beat": "split", "of": "predecessor", "not": true}'), 'a Boss with no predecessor holds a negated predecessor condition');
  perform pg_temp.expect(not pg_temp.holds('al-lead', '{"kind": "beatLanded", "beat": "split", "of": "predecessor"}'), 'a Boss with no predecessor holds a predecessor condition');
  perform pg_temp.expect(pg_temp.refusal($q$select beat_condition_holds('al-lead', (select id from seasons where ends_at is null), '{"kind": "beatLanded", "beat": "split", "of": "successor"}')$q$) like '%predecessor%', 'an unknown `of` was read');
end $$;

-- ---- 4. The FanGaME shape: two aftermath beats, and the three outcomes of a predecessor ----
-- Each predecessor plays as the Boss (the tick lands only the Boss's moves), then a departure row names its successor in this season.
do $$
declare
  b uuid;
  e uuid;
  q bigint;
begin
  perform pg_temp.began(10);
  -- al-pr1: Split landed, Everything is World -1 landed.
  perform pg_temp.boss('al-pr1');
  b := gen_random_uuid(); e := gen_random_uuid();
  perform pg_temp.part('al-pr1', b, 'Split', 'minus', pg_temp.mkboard('P1 Minus'));
  perform pg_temp.part('al-pr1', b, 'Split', 'fangames', pg_temp.mkboard('P1 Fangames'));
  perform pg_temp.part('al-pr1', e, 'Everything', 'all', pg_temp.mkboard('P1 All'));
  perform system_tick();
  perform pg_temp.play('al-pr1', 'split', b);
  perform pg_temp.play('al-pr1', 'everything', e);
  -- al-pr2: Split landed, Everything never played.
  perform pg_temp.boss('al-pr2');
  b := gen_random_uuid();
  perform pg_temp.part('al-pr2', b, 'Split', 'minus', pg_temp.mkboard('P2 Minus'));
  perform system_tick();
  perform pg_temp.play('al-pr2', 'split', b);
  -- al-pr3: Split played and held in full, so it never landed; nothing else.
  perform pg_temp.boss('al-pr3');
  b := gen_random_uuid();
  q := pg_temp.part('al-pr3', b, 'Split', 'minus', pg_temp.mkboard('P3 Minus'));
  update queued_moves set held_at = now(), held_by = (select id from auth.users where email = 'al-admin@test.invalid') where id = q;
  perform pg_temp.play('al-pr3', 'split', b);
  -- al-pr4: Split landed; Everything played with its only part held.
  perform pg_temp.boss('al-pr4');
  b := gen_random_uuid(); e := gen_random_uuid();
  perform pg_temp.part('al-pr4', b, 'Split', 'minus', pg_temp.mkboard('P4 Minus'));
  q := pg_temp.part('al-pr4', e, 'Everything', 'all', pg_temp.mkboard('P4 All'));
  update queued_moves set held_at = now(), held_by = (select id from auth.users where email = 'al-admin@test.invalid') where id = q;
  perform system_tick();
  perform pg_temp.play('al-pr4', 'split', b);
  perform pg_temp.play('al-pr4', 'everything', e);
  -- al-pr5: Split landed; Everything played, its part still waiting (due in 30 days).
  perform pg_temp.boss('al-pr5');
  b := gen_random_uuid(); e := gen_random_uuid();
  perform pg_temp.part('al-pr5', b, 'Split', 'minus', pg_temp.mkboard('P5 Minus'));
  perform pg_temp.part('al-pr5', e, 'Everything', 'all', pg_temp.mkboard('P5 All'), interval '30 days');
  perform system_tick();
  perform pg_temp.play('al-pr5', 'split', b);
  perform pg_temp.play('al-pr5', 'everything', e);
  perform pg_temp.expect((select count(*) from queued_moves where staff in ('al-pr1', 'al-pr2', 'al-pr4', 'al-pr5') and landed_act is not null) = 6, 'the fixture bundles did not land as planned: ' || (select count(*) from queued_moves where landed_act is not null));
  -- Each successor is seated in this season by a departure: the predecessor served this very season.
  perform pg_temp.handover(pg_temp.season(), 'al-pr1', 'al-s1', 'departure');
  perform pg_temp.handover(pg_temp.season(), 'al-pr2', 'al-s2', 'departure');
  perform pg_temp.handover(pg_temp.season(), 'al-pr3', 'al-s3', 'departure');
  perform pg_temp.handover(pg_temp.season(), 'al-pr4', 'al-s4', 'departure');
  perform pg_temp.handover(pg_temp.season(), 'al-pr5', 'al-s5', 'departure');
  perform pg_temp.boss('al-s1');
end $$;
do $$
declare
  s bigint := pg_temp.season();
  r record;
begin
  select * into r from arc_predecessor('al-s1', s);
  perform pg_temp.expect(r.staff = 'al-pr1' and r.season = s, 'the predecessor of a departure is not the departed Boss in the same season: ' || coalesce(r.staff, 'none'));
  perform pg_temp.expect(not exists (select 1 from arc_predecessor('al-lead', s)), 'a Boss nobody handed over to has a predecessor');
  perform pg_temp.expect(not exists (select 1 from arc_predecessor('al-pr1', s)), 'a Boss that handed over has a predecessor it never had');
  perform pg_temp.expect(not exists (select 1 from arc_predecessor(null, s)), 'no one has a predecessor');

  -- Before any pass: lead-in of the aftermath's `restore` (honeymoon, day 10, three days in) shows under the successor's event key.
  perform pg_temp.expect(arc_lead_ins('al-s1', s) = array['after:al-pr1:restore'], 'the aftermath lead-in did not show under the key its event takes: ' || arc_lead_ins('al-s1', s)::text);
  perform pg_temp.expect(arc_lead_ins('al-s3', s) = array['after:al-pr3:restore'], 'a lead-in is read from its own conditions, for a Boss whose predecessor''s beat was held');

  -- Both landed: only restore.
  perform pg_temp.pass('al-s1');
  perform pg_temp.expect(pg_temp.state('al-s1', 'after:al-pr1:restore') = 'unlocked' and pg_temp.state('al-s1', 'after:al-pr1:unfinished') is null, 'both landed did not unlock only restore');
  perform pg_temp.expect(arc_lead_ins('al-s1', s) = '{}'::text[], 'the aftermath lead-in went on after its beat unlocked');
  -- Split landed, Everything never played: only unfinished.
  perform pg_temp.pass('al-s2');
  perform pg_temp.expect(pg_temp.state('al-s2', 'after:al-pr2:unfinished') = 'unlocked' and pg_temp.state('al-s2', 'after:al-pr2:restore') is null, 'split landed and everything did not did not unlock only unfinished');
  -- Split played and held: neither, and it never will.
  perform pg_temp.pass('al-s3');
  perform pg_temp.expect(pg_temp.state('al-s3', 'after:al-pr3:restore') is null and pg_temp.state('al-s3', 'after:al-pr3:unfinished') is null, 'a predecessor whose split was held unlocked an aftermath beat');
  -- Split landed, Everything held: unfinished (held is settled: it will not land).
  perform pg_temp.pass('al-s4');
  perform pg_temp.expect(pg_temp.state('al-s4', 'after:al-pr4:unfinished') = 'unlocked' and pg_temp.state('al-s4', 'after:al-pr4:restore') is null, 'an everything held did not leave only unfinished');
  -- Everything's part still waiting: neither, so the two exclusive beats cannot both unlock.
  perform pg_temp.pass('al-s5');
  perform pg_temp.expect(pg_temp.state('al-s5', 'after:al-pr5:restore') is null and pg_temp.state('al-s5', 'after:al-pr5:unfinished') is null, 'a beat still waiting to land unlocked an aftermath beat');
  perform pg_temp.expect(not pg_temp.holds('al-s5', '{"kind": "beatLanded", "beat": "everything", "of": "predecessor", "not": true}', s) and not pg_temp.holds('al-s5', '{"kind": "beatLanded", "beat": "everything", "of": "predecessor"}', s),
    'a waiting beat was read as landed or as not landed');
  -- Once is once.
  perform pg_temp.expect((pg_temp.pass('al-s1') ->> 'unlocked')::integer = 0 and (select count(*) from arc_beat_events where staff = 'al-s1') = 1, 'a second pass unlocked again');
  -- An aftermath beat is never the Boss's own: the successor has no beat of that key, and an event for it is refused.
  perform pg_temp.expect(pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'al-s1', 'restore', 'unlocked')) like '%no beat%', 'a plain key stood for an aftermath beat');
  perform pg_temp.expect(pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'al-s1', 'after:al-pr2:restore', 'unlocked')) like '%no beat%', 'an aftermath beat of a Boss that did not hand over to this one was written');
  perform pg_temp.expect(pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'al-s1', 'after:al-pr1:nothing', 'unlocked')) like '%no beat%', 'an aftermath beat the predecessor lacks was written');
  perform pg_temp.expect(pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s, 'al-s1', 'after:al-pr1:restore', 'played')) is null, 'the unlocked aftermath beat could not be played');
end $$;

-- ---- 5. What the meeting reads: the unlocked aftermath beats, flagged, with their predecessor ----
do $$
declare
  s bigint := pg_temp.season();
  m jsonb;
begin
  m := arc_for_meeting('al-s2', s);
  perform pg_temp.expect(m -> 'beats' = jsonb_build_array(jsonb_build_object('key', 'unfinished', 'mini', true, 'due', false, 'aftermath', true, 'predecessor', 'al-pr2')), 'the meeting reads: ' || (m -> 'beats')::text);
  perform pg_temp.expect(m -> 'leadIns' = '["after:al-pr2:restore"]'::jsonb and m ? 'heldBack', 'the meeting''s read lost a key: ' || m::text);
  -- Played, it is no longer offered.
  perform pg_temp.expect(arc_for_meeting('al-s1', s) -> 'beats' = '[]'::jsonb, 'a played aftermath beat is still offered');
  perform pg_temp.expect(arc_for_meeting('al-s3', s) -> 'beats' = '[]'::jsonb, 'a held predecessor''s beat is offered');
  -- An own beat is listed as it was, with no aftermath flag.
  perform pg_temp.expect(arc_for_meeting('al-lead', s) -> 'beats' -> 0 ? 'aftermath' is false, 'an own beat carries an aftermath flag');
end $$;

-- ---- 6. A role of the predecessor's: its board, and none once it is reversed or merged ----
do $$
declare
  s bigint := pg_temp.season();
  minus uuid := (select id from boards where slug = 'p2-minus');
  said text;
begin
  perform pg_temp.expect(minus is not null, 'fixture board missing');
  perform pg_temp.expect(arc_board(s, 'al-s2', '{"role": "minus", "beat": "split", "of": "predecessor"}') = minus, 'the predecessor''s role did not resolve to its board');
  perform pg_temp.expect(beat_role_board(s, 'al-s2', 'split', 'minus', 'predecessor') = minus, 'beat_role_board did not resolve the predecessor''s role');
  perform pg_temp.expect(arc_board(s, 'al-s2', '{"role": "minus", "beat": "split"}') is null, 'a role with no `of` read the predecessor''s beat');
  perform pg_temp.expect(arc_board(s, 'al-s2', '{"role": "nowhere", "beat": "split", "of": "predecessor"}') is null and arc_board(s, 'al-s2', '{"role": "minus", "beat": "everything", "of": "predecessor"}') is null,
    'a role the predecessor never made has a board');
  perform pg_temp.expect(arc_board(s, 'al-lead', '{"role": "minus", "beat": "split", "of": "predecessor"}') is null, 'a Boss with no predecessor has its board');
  perform pg_temp.expect(beat_role_board(s, 'al-pr2', 'split', 'minus') = minus, 'the four-argument call reads an own beat as it always did');
  -- The board's own boardActivity reading follows the same refs.
  perform pg_temp.expect(arc_board(s, 'al-s2', to_jsonb(minus::text)) = minus, 'a board by id stopped resolving');
  -- Once the predecessor's board is reversed, the role is none; an own beat's role is read as it was.
  perform end_move((select q.landed_act from queued_moves q where q.staff = 'al-pr2' and q.role = 'minus'), 'reversed', 'admin');
  perform pg_temp.expect(arc_board(s, 'al-s2', '{"role": "minus", "beat": "split", "of": "predecessor"}') is null, 'a reversed board of the predecessor still resolves');
  perform pg_temp.expect(beat_role_board(s, 'al-pr2', 'split', 'minus') = minus, 'an own beat''s role changed with the board reversed');
  -- A board that is not reversed is still there for the same Boss's other role.
  perform pg_temp.expect(arc_board(s, 'al-s1', '{"role": "fangames", "beat": "split", "of": "predecessor"}') = (select id from boards where slug = 'p1-fangames'), 'the other board did not resolve');
  said := pg_temp.refusal($q$select beat_condition_holds('al-s1', (select id from seasons where ends_at is null), '{"kind": "boardActivity", "days": 7, "board": {"role": "fangames", "beat": "split", "of": "predecessor"}, "above": 0}')$q$);
  perform pg_temp.expect(said is null, 'boardActivity could not read the predecessor''s board: ' || coalesce(said, ''));
end $$;

-- ---- 7. A departure mid-season reads the departed Boss's beats in the same season; an aftermath beat's own earlier beats are read under its key ----
do $$
declare
  s bigint := pg_temp.season();
  b uuid := gen_random_uuid();
begin
  -- al-dep played its split as the Boss, then left: its successor reads the same season.
  perform pg_temp.boss('al-dep');
  perform pg_temp.part('al-dep', b, 'Split', 'minus', pg_temp.mkboard('Dep Minus'));
  perform system_tick();
  perform pg_temp.play('al-dep', 'split', b);
  perform pg_temp.handover(s, 'al-dep', 'al-dsc', 'departure');
  perform pg_temp.boss('al-dsc');
  perform pg_temp.expect(pg_temp.holds('al-dsc', '{"kind": "beatLanded", "beat": "split", "of": "predecessor"}', s), 'a departure''s successor did not read the departed Boss''s beat in the same season');
  perform pg_temp.expect(not pg_temp.holds('al-dsc', '{"kind": "beatLanded", "beat": "split", "of": "predecessor", "not": true}', s), 'the negation held for a beat that landed');
  perform pg_temp.expect(pg_temp.holds('al-dsc', '{"kind": "beatLanded", "beat": "everything", "of": "predecessor", "not": true}', s), 'the negation did not hold for a beat never played, by a predecessor that has gone');
  perform pg_temp.expect(not pg_temp.holds('al-dsc', '{"kind": "beatLanded", "beat": "split"}', s), 'the successor''s own beat of that key landed');
end $$;
do $$
declare
  s bigint := pg_temp.season();
begin
  -- Inside an aftermath beat, a condition with no `of` names an earlier aftermath beat of the same list, which is read under the successor's own event key (after:<pred>:<key>).
  -- Planted as a fixture row beside the seeded ones: `second` waits on `first` having landed (played with no bundle), `first` waits on nothing but the honeymoon.
  update persona_arcs set aftermath = jsonb_build_array(
    jsonb_build_object('key', 'first', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'honeymoon'))),
    jsonb_build_object('key', 'second', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'first'))),
    jsonb_build_object('key', 'role', 'mini', true, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'boardActivity', 'days', 7, 'board', jsonb_build_object('role', 'nope', 'beat', 'first'), 'above', 0))))
  where staff = 'al-dep';
  perform pg_temp.pass('al-dsc', s);
  perform pg_temp.expect(pg_temp.state('al-dsc', 'after:al-dep:first') = 'unlocked' and pg_temp.state('al-dsc', 'after:al-dep:second') is null, 'an aftermath beat waiting on an earlier one unlocked with it, or the first did not');
  insert into arc_beat_events (season, staff, beat, event) values (s, 'al-dsc', 'after:al-dep:first', 'played');
  perform pg_temp.pass('al-dsc', s);
  perform pg_temp.expect(pg_temp.state('al-dsc', 'after:al-dep:second') = 'unlocked', 'an aftermath beat did not read the successor''s own play of the earlier aftermath beat');
  perform pg_temp.expect(pg_temp.state('al-dsc', 'after:al-dep:role') is null, 'an aftermath beat''s role with no `of` resolved to a board that is not there');
  -- The same beat key in the predecessor's own arc is another thing: `split` here is the departed Boss's, and the plain reading would find none under the successor.
end $$;

-- ---- 8. A departure followed by a roll-over: the predecessor is the Boss that handed over to the current one, never an earlier one ----
do $$
declare
  s bigint := pg_temp.season();
  b uuid := gen_random_uuid();
  r record;
begin
  -- A is the Boss; it plays a-only and lands its split, then departs. B is seated by the departure, plays side and not split, and passes at the roll-over to C.
  perform pg_temp.boss('al-ca');
  perform pg_temp.part('al-ca', b, 'Split', 'minus', pg_temp.mkboard('A Minus'));
  perform system_tick();
  perform pg_temp.play('al-ca', 'split', b);
  perform pg_temp.play('al-ca', 'a-only');
  perform pg_temp.handover(s, 'al-ca', 'al-cb', 'departure');
  perform pg_temp.boss('al-cb');
  perform pg_temp.play('al-cb', 'side');
  -- B is seated: A's beat a-only unlocks B's from-a, and A's aftermath exists only for B.
  perform pg_temp.pass('al-cb');
  perform pg_temp.expect(pg_temp.state('al-cb', 'after:al-ca:from-a') = 'unlocked', 'the departure''s successor did not unlock the aftermath of the beat that landed');
  -- The roll-over: the season closes, the next opens with C seated by B's hand-over.
  update seasons set ends_at = now(), boss = 'al-cb' where ends_at is null;
  insert into seasons (number, starts_at, boss) select max(number) + 1, (select ends_at from seasons where ends_at is not null order by number desc limit 1), 'al-cc' from seasons;
  perform pg_temp.handover(pg_temp.season(), 'al-cb', 'al-cc', 'rollover');
  select * into r from arc_predecessor('al-cc', pg_temp.season());
  perform pg_temp.expect(r.staff = 'al-cb' and r.season = s, 'after a departure and a roll-over C''s predecessor is not B in the season before: ' || coalesce(r.staff, 'none') || ' ' || coalesce(r.season::text, ''));
  select * into r from arc_predecessor('al-cb', pg_temp.season());
  perform pg_temp.expect(r.staff = 'al-ca' and r.season = s, 'B''s own predecessor changed with the roll-over');
  perform pg_temp.expect(pg_temp.holds('al-cc', '{"kind": "beatLanded", "beat": "side", "of": "predecessor"}'), 'C did not read B''s beat in the season B served');
  perform pg_temp.expect(not pg_temp.holds('al-cc', '{"kind": "beatLanded", "beat": "a-only", "of": "predecessor"}'), 'C read the Boss before B');
  perform pg_temp.expect(not pg_temp.holds('al-cc', '{"kind": "beatLanded", "beat": "split", "of": "predecessor"}') and pg_temp.holds('al-cc', '{"kind": "beatLanded", "beat": "split", "of": "predecessor", "not": true}'),
    'C read A''s landed split');
  perform pg_temp.expect(arc_board(pg_temp.season(), 'al-cc', '{"role": "minus", "beat": "split", "of": "predecessor"}') is null and (select id from boards where slug = 'a-minus') is not null,
    'C resolved a board A made');
  -- The tick makes the pass for the new Boss: `from-b` unlocks under C's key; `from-b-a` (A's beat) does not.
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-cc', 'after:al-cb:from-b') = 'unlocked' and pg_temp.state('al-cc', 'after:al-cb:from-b-a') is null, 'the tick did not unlock the aftermath of the Boss that handed over, and only that');
  perform pg_temp.expect(arc_for_meeting('al-cc', pg_temp.season()) -> 'beats' = jsonb_build_array(jsonb_build_object('key', 'from-b', 'mini', true, 'due', false, 'aftermath', true, 'predecessor', 'al-cb')), 'the meeting does not read the aftermath of the roll-over');
  -- The season before closed with B's from-a unlocked: the pass lapses it, once.
  -- (that tick also made the closed season's pass for its last Boss.)
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-cb', 'after:al-ca:from-a', s) = 'lapsed', 'an aftermath beat did not lapse at the season''s end');
  perform pg_temp.expect((select count(*) from arc_beat_events where staff = 'al-cb' and beat = 'after:al-ca:from-a' and event = 'lapsed') = 1, 'it lapsed twice');
  -- An aftermath beat is read only in the season its Boss was seated in: a later season with the same row finds none.
  perform pg_temp.expect(arc_lead_ins('al-cc', pg_temp.season()) = '{}'::text[], 'a lead-in showed for a Boss with none');
  update seasons set ends_at = now() + interval '1 day' where ends_at is null;
  insert into seasons (number, starts_at) select max(number) + 1, now() + interval '1 day' from seasons;
  perform pg_temp.expect(not exists (select 1 from arc_predecessor('al-cc', (select max(id) from seasons)) p where p.seated = (select max(id) from seasons)), 'a Boss seated before the season is read as seated in it');
end $$;

-- ---- 9. A Boss kept on past the season it was seated in: its predecessor's aftermath is not its own in the next season ----
-- al-cc was seated in season 2 and is still Boss in season 3 (the seat was kept at the roll-over). The handover row still names al-cb, but the aftermath is for the season of the handover only.
do $$
declare
  s3 bigint := (select max(id) from seasons);
  said text;
begin
  update persona_arcs set aftermath = jsonb_set(aftermath, '{0,leadIn}', '{"unlock": [{"kind": "phase", "phase": "honeymoon"}]}'::jsonb) where staff = 'al-cb';
  perform pg_temp.expect((select p.staff from arc_predecessor('al-cc', s3) p) = 'al-cb' and not exists (select 1 from arc_predecessor('al-cc', s3) p where p.seated = s3), 'the fixture is not a Boss kept on');
  -- Every condition of from-b holds (B's side beat landed) and its lead-in holds, so only the seat check keeps them out.
  -- Run as a replica, where the guard lets any row through, so that the pass's own check is what is read and the guard cannot hide its absence.
  perform set_config('session_replication_role', 'replica', true);
  perform pg_temp.pass('al-cc', s3);
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.expect(not exists (select 1 from arc_beat_events where season = s3 and staff = 'al-cc'), 'a kept-on Boss unlocked an aftermath beat in a later season');
  perform pg_temp.expect(arc_lead_ins('al-cc', s3) = '{}'::text[], 'a kept-on Boss showed an aftermath lead-in in a later season: ' || arc_lead_ins('al-cc', s3)::text);
  perform pg_temp.expect(pg_temp.refusal(format('insert into arc_beat_events (season, staff, beat, event) values (%s, %L, %L, %L)', s3, 'al-cc', 'after:al-cb:from-b', 'unlocked')) like '%no beat%', 'an aftermath event was written for a Boss kept on');
  -- An event that is there anyway (an import writes as a replica) is not offered to the meeting.
  perform set_config('session_replication_role', 'replica', true);
  insert into arc_beat_events (season, staff, beat, event) values (s3, 'al-cc', 'after:al-cb:from-b', 'unlocked');
  perform set_config('session_replication_role', 'origin', true);
  perform pg_temp.expect(arc_for_meeting('al-cc', s3) -> 'beats' = '[]'::jsonb, 'the meeting was offered an aftermath beat in a later season: ' || (arc_for_meeting('al-cc', s3) -> 'beats')::text);
end $$;
