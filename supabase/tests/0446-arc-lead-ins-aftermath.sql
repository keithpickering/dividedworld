-- Lead-ins, aftermath and the new conditions (supabase/migrations/0446_arc_lead_ins_aftermath.sql; docs/plans/2026-11-25-arc-announcements-plan.md, Task 2; its design, sections 6, 7 and 8b).
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
  values (m, who, 'createBoard', params, null, 'because', now() - interval '1 minute' + coalesce(wait, interval '0'), now() - interval '1 minute' + coalesce(wait, interval '0'), true, bundle, bname, role) returning id into q;
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
      'arc', jsonb_build_array(jsonb_build_object('key', 'split', 'unlock', '[]'::jsonb, 'leadIn', jsonb_build_object('unlock', jsonb_build_array(jsonb_build_object('kind', 'noSuchLeadIn')))))))))$q$);
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
declare
  split_held uuid := gen_random_uuid();
begin
  -- `not` alone holds from the season's first day: the beat has not landed yet (the instance check refuses a beat whose every condition is negated).
  perform pg_temp.began(3);
  perform pg_temp.expect(pg_temp.holds('al-lead', '{"kind": "beatLanded", "beat": "split", "not": true}'), 'a beat that was never played has landed');
  perform system_tick();
  perform pg_temp.expect(pg_temp.state('al-lead', 'solo') is null, 'solo was already unlocked by an earlier tick'); -- it unlocks below, once; day 3 ticks ran above with no solo
end $$;
