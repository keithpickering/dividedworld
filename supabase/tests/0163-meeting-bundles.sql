-- The meeting queues beats and bundles (supabase/migrations/0166_meeting_bundles.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 6; design sections 2, 3, 5 and 9).
--
-- meeting_context hands the meeting the Boss's arc (`arc`: the beats unlocked and not played, with whether each is due, and the kinds still held back). apply_meeting queues what the
-- answer's `bundles` hold, each all or nothing: an authored bundle (a beat's, named by its `beat`) at no cost to the bank, a composed one at one move a part, every part under one bundle id
-- and one name, and writes `played` to arc_beat_events in the same transaction, with the bundle it queued. A bundle the queue would refuse, a beat that is not unlocked, a kind held
-- back and a bundle the bank cannot pay are each skipped and recorded on the meeting, and cost nothing; one bad bundle never fails the whole answer.
--
-- A role of an earlier beat (`{role, beat}`) names the board that beat's bundle made, read from the landed Acts. The queue's guard resolves it (it must already have landed), records the
-- move that made the board among what the part depends on, and the tick resolves it again at landing.
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

-- ---- 0. The world: a Boss with an arc (a beat with a bundle, one with none, one that names a role of the first), and two kinds held back until a beat unlocks ----
do $$
declare
  seed jsonb;
  boss_arc jsonb := jsonb_build_array(
    jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))),
    jsonb_build_object('key', 'picking', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split'))),
    jsonb_build_object('key', 'everything', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'split')),
      'due', jsonb_build_object('daysBeforeEnd', 2)),
    jsonb_build_object('key', 'epilogue', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'everything'))),
    jsonb_build_object('key', 'later', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'beatLanded', 'beat', 'later'))));
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'seasonLength', jsonb_build_object('unit', 'day', 'count', 90), 'bundleMostParts', 4, 'bundleAuthoredMostParts', 8,
      'phases', jsonb_build_object(
        'honeymoon', jsonb_build_object('days', 14, 'weeklyMoves', 2, 'bankCap', 4, 'moveExpiryMostDays', 7),
        'reign', jsonb_build_object('weeklyMoves', 5, 'bankCap', 10, 'moveExpiryMostDays', 28),
        'meltdown', jsonb_build_object('days', 21, 'weeklyMoves', 8, 'bankCap', 14, 'moveExpiryMostDays', 42)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mb-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'mb-boss', 'name', 'Meeting Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'arc', boss_arc,
          'holdsBack', jsonb_build_array(jsonb_build_object('kind', 'createBoard', 'until', 'split'), jsonb_build_object('kind', 'moveThread', 'until', 'later')), 'phaseDays', '{}'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'conditions', jsonb_build_array(
        jsonb_build_object('key', 'phase', 'plain', 'a phase has begun, or the season is near its end'),
        jsonb_build_object('key', 'beatLanded', 'plain', 'an earlier beat''s bundle has landed'),
        jsonb_build_object('key', 'boardActivity', 'plain', 'a board''s posts over some days are above or below a number or another board'),
        jsonb_build_object('key', 'moveReversed', 'plain', 'an admin reversed one of the Boss''s moves'),
        jsonb_build_object('key', 'demandResolved', 'plain', 'one of the Boss''s moves'' demands was met or failed'))));
  perform seed_instance(seed);
  insert into boards (slug, name, created_at) values ('elsewhere', 'Elsewhere', now() - interval '9 days');
  update boards set created_at = now() - interval '10 days' where slug = 'general';
  insert into admins (account) values (tests.account('mb-admin'));
  -- The season began a month ago: the honeymoon is over, so the reign has begun.
  update seasons set starts_at = now() - interval '30 days' where ends_at is null;
end $$;

create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.state(beat text) returns text language sql as $$
  select e.event from arc_beat_events e where e.season = pg_temp.season() and e.staff = 'mb-boss' and e.beat = state.beat order by e.id desc limit 1
$$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
-- A part as the meeting sends it.
create function pg_temp.p(role text, kind text, params jsonb, why text default 'Because.') returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('role', role, 'kind', kind, 'params', params, 'why', why, 'go_live_at', now(), 'expires_in_hours', 0))
$$;
-- A meeting applied with the bank at `bank`, its answer holding `moves` and `bundles`; returns the apply's result and leaves the meeting's id in pg_temp.last.
create table pg_temp.last (meeting bigint, result jsonb);
create function pg_temp.apply(bundles jsonb, bank numeric default 0, moves jsonb default '[]', rec jsonb default '{}', mtg bigint default null) returns jsonb language plpgsql as $$
declare
  m bigint;
  r jsonb;
  pl jsonb;
begin
  insert into move_bank (staff, balance, as_of) values ('mb-boss', bank, now()) on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  pl := jsonb_build_object('boss', 'mb-boss', 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'Done.'),
    'moves', moves, 'bundles', bundles, 'record', rec);
  m := coalesce(mtg, (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint);
  r := apply_meeting(m, pl);
  insert into pg_temp.last values (m, r);
  return r;
end $$;
create function pg_temp.record(key text) returns jsonb language sql as $$ select m.record -> record.key from meetings m where m.id = (select max(meeting) from pg_temp.last) $$;
create function pg_temp.rows(bundle_name text) returns bigint language sql as $$ select count(*) from queued_moves where bundle_name = rows.bundle_name $$;

-- ---- 1. The arc the meeting reads: the beat that has unlocked, due or not, and the kind still held back ----
do $$
declare
  arc jsonb;
begin
  perform arc_pass();
  arc := meeting_context() -> 'arc';
  perform pg_temp.expect(pg_temp.state('split') = 'unlocked', 'setup: the reign has begun, so the first beat has unlocked: ' || coalesce(pg_temp.state('split'), 'none'));
  perform pg_temp.expect(jsonb_array_length(arc -> 'beats') = 1 and arc #>> '{beats,0,key}' = 'split' and (arc #>> '{beats,0,due}')::boolean is false, 'meeting_context did not hand over the unlocked beat alone: ' || arc::text);
  perform pg_temp.expect(arc -> 'heldBack' = '["moveThread"]'::jsonb, 'the held-back kinds are not those whose beat has not unlocked: ' || (arc -> 'heldBack')::text);
  perform pg_temp.expect(not (arc::text like '%picking%') and not (arc::text like '%everything%') and not (arc::text like '%later%') and not (arc::text like '%brief%'), 'the meeting read a beat that is locked, or a brief: ' || arc::text);
end $$;

-- ---- 2. An authored bundle: a beat's parts queue as one bundle at no cost to the bank, and the beat is played, with the bundle ----
do $$
declare
  r jsonb;
  b uuid;
  n integer;
begin
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'The Split', 'beat', 'split', 'parts', jsonb_build_array(
    pg_temp.p('minus', 'createBoard', pg_temp.mkboard('World -1')),
    pg_temp.p('fangames', 'createBoard', pg_temp.mkboard('Platformer Palace') || jsonb_build_object('fallback', null))))), 0);
  perform pg_temp.expect(r ->> 'status' = 'applied' and (r ->> 'queued')::integer = 2 and (r ->> 'bank_before')::numeric = 0 and (r ->> 'bank_after')::numeric = 0, 'a beat''s bundle was not queued at no cost: ' || r::text);
  select count(distinct bundle), min(bundle::text)::uuid into n, b from queued_moves where bundle_name = 'The Split';
  perform pg_temp.expect(n = 1 and pg_temp.rows('The Split') = 2, 'the parts did not share one bundle id: ' || n);
  perform pg_temp.expect((select array_agg(role order by id) from queued_moves where bundle = b) = array['minus', 'fangames'], 'the parts lost their roles or their order');
  perform pg_temp.expect(pg_temp.state('split') = 'played', 'the beat was not played');
  perform pg_temp.expect((select bundle from arc_beat_events where season = pg_temp.season() and staff = 'mb-boss' and beat = 'split' and event = 'played') = b, 'played did not carry the bundle the meeting queued');
  perform pg_temp.expect((select count(*) from move_bank where staff = 'mb-boss' and balance = 0) = 1, 'the bank was charged for an authored bundle');
  perform pg_temp.expect(pg_temp.record('bundlesSkipped') = '[]'::jsonb, 'something was skipped: ' || pg_temp.record('bundlesSkipped')::text);
  -- The beat has been played: it is not read again, and naming it again is skipped.
  perform pg_temp.expect(not ((meeting_context() -> 'arc' -> 'beats')::text like '%split%'), 'a played beat is read again');
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'The Split', 'beat', 'split', 'parts', jsonb_build_array(pg_temp.p('a', 'createBoard', pg_temp.mkboard('Again'))))), 0);
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and pg_temp.rows('The Split') = 2 and jsonb_array_length(pg_temp.record('bundlesSkipped')) = 1, 'a played beat was played again: ' || pg_temp.record('bundlesSkipped')::text);
end $$;

-- ---- 3. What is skipped costs nothing and fails nothing: a beat not unlocked, a part the queue refuses, a kind held back, too many parts, a bank that cannot pay ----
do $$
declare
  r jsonb;
  skipped jsonb;
  before_n bigint := (select count(*) from queued_moves);
begin
  -- A beat that is locked is no beat to play (the database holds the line whatever the caller sent); the authored cost is no loophole for a beat that is not unlocked.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Sneak', 'beat', 'everything', 'parts', jsonb_build_array(pg_temp.p('a', 'createBoard', pg_temp.mkboard('Sneaky'))))), 5);
  skipped := pg_temp.record('bundlesSkipped');
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and (select count(*) from queued_moves) = before_n and pg_temp.state('everything') is null, 'a locked beat was played: ' || r::text);
  perform pg_temp.expect(jsonb_array_length(skipped) = 1 and skipped #>> '{0,index}' = '0' and skipped #>> '{0,name}' = 'Sneak' and skipped #>> '{0,why}' like '%not unlocked%', 'the locked beat was not recorded: ' || skipped::text);
  -- A beat that is not the persona's.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Nobody', 'beat', 'nobody', 'parts', jsonb_build_array(pg_temp.p('a', 'createBoard', pg_temp.mkboard('Nobody'))))), 5);
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and jsonb_array_length(pg_temp.record('bundlesSkipped')) = 1, 'a beat the persona lacks was played');
  -- A composed bundle that names a kind held back (moveThread, until a beat that has not unlocked), and a plain move of that kind.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Held', 'beat', null, 'parts', jsonb_build_array(
      pg_temp.p('a', 'createBoard', pg_temp.mkboard('Held A')), pg_temp.p(null, 'moveThread', jsonb_build_object('thread', gen_random_uuid(), 'board', jsonb_build_object('role', 'a')))))), 5,
    jsonb_build_array(pg_temp.p(null, 'moveThread', jsonb_build_object('thread', gen_random_uuid(), 'board', pg_temp.board('general')))));
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and (r ->> 'bank_after')::numeric = 5 and (select count(*) from queued_moves) = before_n, 'a held-back kind was queued or charged: ' || r::text);
  perform pg_temp.expect(pg_temp.record('bundlesSkipped') #>> '{0,why}' like '%held back%' and pg_temp.record('heldBackSkipped') #>> '{0,kind}' = 'moveThread', 'the held kind was not recorded: ' || pg_temp.record('bundlesSkipped')::text || pg_temp.record('heldBackSkipped')::text);
  -- A part the queue refuses (a role no earlier part makes) loses the whole bundle and nothing else: the meeting still applies, and no part of it is left.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Broken', 'beat', null, 'parts', jsonb_build_array(
      pg_temp.p('a', 'createBoard', pg_temp.mkboard('Broken A')), pg_temp.p(null, 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'zzz'), 'into', pg_temp.board('general')))))), 5);
  perform pg_temp.expect(r ->> 'status' = 'applied' and (r ->> 'queued')::integer = 0 and pg_temp.rows('Broken') = 0 and (select count(*) from queued_moves) = before_n, 'a refused part left a part of its bundle, or failed the meeting: ' || r::text);
  perform pg_temp.expect(pg_temp.record('bundlesSkipped') #>> '{0,why}' like '%zzz%', 'the refusal''s reason was not recorded: ' || pg_temp.record('bundlesSkipped')::text);
  -- Past bundleMostParts (4) a composed bundle is skipped; an authored one may hold more.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Five', 'beat', null, 'parts', jsonb_build_array(
    pg_temp.p('a', 'createBoard', pg_temp.mkboard('F1')), pg_temp.p('b', 'createBoard', pg_temp.mkboard('F2')), pg_temp.p('c', 'createBoard', pg_temp.mkboard('F3')), pg_temp.p('d', 'createBoard', pg_temp.mkboard('F4')),
    pg_temp.p('e', 'createBoard', pg_temp.mkboard('F5'))))), 9);
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and pg_temp.rows('Five') = 0 and pg_temp.record('bundlesSkipped') #>> '{0,why}' like '%at most 4%', 'a composed bundle over bundleMostParts was queued: ' || pg_temp.record('bundlesSkipped')::text);
  -- A bank that cannot pay one move a part: skipped, and the bank is as it was.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Dear', 'beat', null, 'parts', jsonb_build_array(
    pg_temp.p('a', 'createBoard', pg_temp.mkboard('D1')), pg_temp.p('b', 'createBoard', pg_temp.mkboard('D2'))))), 1);
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and (r ->> 'bank_after')::numeric = 1 and pg_temp.record('bundlesSkipped') #>> '{0,why}' like '%bank%', 'a bundle the bank cannot pay was queued: ' || r::text || pg_temp.record('bundlesSkipped')::text);
  -- An empty composed bundle is nothing.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Empty', 'beat', null, 'parts', '[]'::jsonb)), 5);
  perform pg_temp.expect((r ->> 'queued')::integer = 0 and jsonb_array_length(pg_temp.record('bundlesSkipped')) = 1, 'an empty composed bundle was not skipped');
end $$;

-- ---- 4. A composed bundle queues at its parts' cost, with no beat played; the second part waits on the first ----
do $$
declare
  r jsonb;
  b uuid;
  plays bigint := (select count(*) from arc_beat_events where event = 'played');
begin
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'A story', 'beat', null, 'parts', jsonb_build_array(
    pg_temp.p('a', 'createBoard', pg_temp.mkboard('Story Board')),
    pg_temp.p(null, 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'a'), 'into', pg_temp.board('elsewhere')))))), 5);
  perform pg_temp.expect((r ->> 'queued')::integer = 2 and (r ->> 'bank_before')::numeric = 5 and (r ->> 'bank_after')::numeric = 3, 'a composed bundle was not charged one move a part: ' || r::text);
  select bundle into b from queued_moves where bundle_name = 'A story' limit 1;
  perform pg_temp.expect(pg_temp.rows('A story') = 2 and (select count(distinct bundle) from queued_moves where bundle_name = 'A story') = 1, 'the parts did not share a bundle');
  perform pg_temp.expect((select depends_on = array[(select id from queued_moves where bundle = b and role = 'a')] from queued_moves where bundle = b and kind = 'mergeBoard'), 'the second part does not depend on the first');
  perform pg_temp.expect((select count(*) from arc_beat_events where event = 'played') = plays, 'a composed bundle played a beat');
  perform pg_temp.expect((select staff from queued_moves where bundle = b limit 1) = 'mb-boss' and (select meeting from queued_moves where bundle = b limit 1) = (select max(meeting) from pg_temp.last), 'the parts are not the Boss''s, from this meeting');
end $$;

-- ---- 5. A role of an earlier beat: the guard resolves it, records what it builds on, and the tick lands it on the real boards ----
do $$
declare
  minus uuid;
  fan uuid;
  q bigint;
  msg text;
  landed uuid;
  made uuid;
  dep bigint[];
begin
  -- Setup: the split bundle's parts are waiting out the admin hold, as a structural move does.
  perform pg_temp.expect((select count(*) from queued_moves where bundle_name = 'The Split' and landed_act is null) = 2, 'setup: the split is still waiting out its hold');
  -- Before the beat's bundle has landed, a part that names its role is refused: there is no board yet.
  msg := pg_temp.refusal($q$
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
    values ((select max(meeting) from pg_temp.last), 'mb-boss', 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'fangames', 'beat', 'split'), 'into', jsonb_build_object('role', 'minus', 'beat', 'split')),
      null, 'because', now(), null, true, gen_random_uuid(), 'Early', null)$q$);
  perform pg_temp.expect(msg like '23514%split%', 'a role of a beat that has made no board was queued: ' || coalesce(msg, 'allowed'));
  -- Their hold has run: the guard refuses to move a go-live, so it is switched off for the one update that stands for the day passing, and back on.
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where bundle_name = 'The Split';
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves where bundle_name = 'The Split' and landed_act is not null) = 2, 'the split did not land: ' || (select string_agg(coalesce(failure, 'none'), '; ') from queued_moves where bundle_name = 'The Split'));
  minus := beat_role_board(pg_temp.season(), 'mb-boss', 'split', 'minus');
  fan := beat_role_board(pg_temp.season(), 'mb-boss', 'split', 'fangames');
  perform pg_temp.expect(minus is not null and fan is not null and minus <> fan and (select name from boards where id = minus) = 'World -1', 'beat_role_board does not resolve the split''s roles');
  -- The beat has landed: what waited on it unlocks (the pass runs in the tick).
  perform pg_temp.expect(pg_temp.state('everything') = 'unlocked' and pg_temp.state('picking') = 'unlocked', 'the beats that wait on the split did not unlock: ' || coalesce(pg_temp.state('everything'), 'none'));
  -- Now the meeting plays the beat that names the split's roles, through apply_meeting: the parts are queued, depending on what made the boards.
  perform pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Everything', 'beat', 'everything', 'parts', jsonb_build_array(
    pg_temp.p('final', 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'fangames', 'beat', 'split'), 'into', jsonb_build_object('role', 'minus', 'beat', 'split')))))), 0);
  perform pg_temp.expect(pg_temp.state('everything') = 'played' and pg_temp.rows('Everything') = 1, 'the beat naming a role of the split was not queued and played: ' || coalesce(pg_temp.record('bundlesSkipped')::text, ''));
  select q.id, q.depends_on into q, dep from queued_moves q where bundle_name = 'Everything';
  perform pg_temp.expect(dep @> array[(select id from queued_moves where bundle_name = 'The Split' and role = 'minus'), (select id from queued_moves where bundle_name = 'The Split' and role = 'fangames')]
    and cardinality(dep) = 2, 'the part does not depend on the two parts that made the boards: ' || coalesce(dep::text, 'null'));
  -- It lands on the real boards, the Act says which, and the dependency is recorded for an admin's reversal to follow (the same stand-in for a day's wait).
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where id = q;
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  select landed_act into landed from queued_moves where id = q;
  perform pg_temp.expect(landed is not null, 'the part naming another beat''s roles did not land: ' || (select coalesce(failure, 'waiting') from queued_moves where id = q));
  perform pg_temp.expect((select a.payload #>> '{params,board}' from acts a where a.id = landed) = fan::text and (select a.payload #>> '{params,into}' from acts a where a.id = landed) = minus::text, 'the landed Act does not name the boards the roles stand for');
  perform pg_temp.expect((select closed and merged_into = minus from boards_now where id = fan), 'the fangame board was not merged into World -1');
  perform pg_temp.expect((select count(*) from move_dependencies where act = landed) = 2, 'the dependencies were not recorded at landing');
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'the landing left drift');
  -- An admin's reversal of the board's creation follows the merge.
  made := (select landed_act from queued_moves where bundle_name = 'The Split' and role = 'fangames');
  perform tests.become((select id from auth.users where email = 'mb-admin@test.invalid'));
  perform reverse_move(made);
  perform tests.unbecome();
  perform pg_temp.expect(exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = landed and e.payload ->> 'why' = 'reversed'), 'reversing the board''s creation did not reverse the merge that builds on it');
  -- The beat with no bundle is played with no parts, and its event carries none.
  perform pg_temp.apply(jsonb_build_array(jsonb_build_object('name', '', 'beat', 'picking', 'parts', '[]'::jsonb)), 0,
    '[]', jsonb_build_object('beatsDefaulted', jsonb_build_array('picking'), 'trims', jsonb_build_array(jsonb_build_object('path', 'beats.picking', 'predicate', 'playedWithDefaults', 'before', 0, 'after', 1))));
  perform pg_temp.expect(pg_temp.record('beatsDefaulted') = '["picking"]'::jsonb and pg_temp.record('beatsPlayed') = '["picking"]'::jsonb and pg_temp.record('trims') @> '[{"predicate": "playedWithDefaults"}]'::jsonb,
    'the record lost a beat that was played with its defaults: ' || pg_temp.record('beatsDefaulted')::text || pg_temp.record('trims')::text);
  perform pg_temp.expect((select (result ->> 'queued')::integer = 0 and result -> 'beats_played' = '["picking"]'::jsonb from pg_temp.last order by meeting desc limit 1), 'the result does not say which beats were played');
  perform pg_temp.expect(pg_temp.state('picking') = 'played' and (select bundle from arc_beat_events where beat = 'picking' and event = 'played') is null, 'a beat with no bundle was not played with no bundle');
  perform pg_temp.expect(pg_temp.record('bundlesSkipped') = '[]'::jsonb, 'a bundle-less beat was skipped: ' || pg_temp.record('bundlesSkipped')::text);
end $$;

-- ---- 6. The record says what was played: a bundle the database skipped is not "played with its defaults" ----
do $$
declare
  r jsonb;
begin
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', 'Later', 'beat', 'later', 'parts', '[]'::jsonb)), 5, '[]',
    jsonb_build_object('beatsDefaulted', jsonb_build_array('later'), 'trims', jsonb_build_array(jsonb_build_object('path', 'beats.later', 'predicate', 'playedWithDefaults', 'before', 0, 'after', 1),
      jsonb_build_object('path', 'moves[0].why', 'predicate', 'maxLength(200)', 'before', 201, 'after', 200))));
  perform pg_temp.expect(r -> 'beats_played' = '[]'::jsonb, 'a locked beat was played: ' || r::text);
  perform pg_temp.expect(pg_temp.record('beatsDefaulted') = '[]'::jsonb and pg_temp.record('beatsPlayed') = '[]'::jsonb, 'the record says a skipped beat was played with its defaults: ' || pg_temp.record('beatsDefaulted')::text);
  perform pg_temp.expect(not (pg_temp.record('trims') @> '[{"predicate": "playedWithDefaults"}]'::jsonb) and pg_temp.record('trims') @> '[{"predicate": "maxLength(200)"}]'::jsonb,
    'the record kept a played-with-defaults trim for a beat that was not played, or lost another trim: ' || pg_temp.record('trims')::text);
end $$;

-- ---- 7. The meeting's season, everywhere: a meeting held in one season and applied or landed after the next has opened ----
do $$
declare
  m bigint;
  old_season bigint := pg_temp.season();
  q bigint;
  r jsonb;
  landed uuid;
  minus uuid := beat_role_board(pg_temp.season(), 'mb-boss', 'split', 'minus');
begin
  perform arc_pass();
  perform pg_temp.expect(pg_temp.state('epilogue') = 'unlocked', 'setup: the beat that waits on the landed one has not unlocked: ' || coalesce(pg_temp.state('epilogue'), 'none'));
  -- The meeting is held a minute ago, in the season that then ran; the season closes and the next opens before it is applied.
  m := (begin_meeting(now() - interval '1 minute') ->> 'meeting')::bigint;
  update seasons set ends_at = now() - interval '30 seconds' where id = old_season;
  insert into seasons (number, starts_at, boss) values (2, now() - interval '30 seconds', 'mb-boss');
  perform pg_temp.expect(meeting_season(m) = old_season and pg_temp.season() <> old_season, 'setup: the meeting is not in the season that closed');
  -- The guard reads the role in the meeting's season, as the tick does.
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, 'mb-boss', 'mergeBoard', jsonb_build_object('board', jsonb_build_object('role', 'minus', 'beat', 'split'), 'into', pg_temp.board('elsewhere')), null, 'because', now() - interval '1 minute', null, true, gen_random_uuid(), 'Late', null)
  returning id into q;
  perform pg_temp.expect((select cardinality(depends_on) = 1 from queued_moves where id = q), 'the part does not depend on the move that made the board');
  -- The beat's played event is the meeting's season's too.
  r := pg_temp.apply(jsonb_build_array(jsonb_build_object('name', '', 'beat', 'epilogue', 'parts', '[]'::jsonb)), 0, '[]', '{}', m);
  perform pg_temp.expect(r -> 'beats_played' = '["epilogue"]'::jsonb, 'the beat was not played in the season the meeting was held in: ' || r::text || pg_temp.record('bundlesSkipped')::text);
  perform pg_temp.expect((select e.season = old_season from arc_beat_events e where e.beat = 'epilogue' and e.event = 'played'), 'the played event is not in the meeting''s season');
  -- Landing reads the same season (the tick's pass then lapses what the closed season left unlocked, which is why the beat is played first).
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where id = q;
  alter table queued_moves enable trigger queued_moves_guard;
  perform system_tick();
  select landed_act into landed from queued_moves where id = q;
  perform pg_temp.expect(landed is not null and (select a.payload #>> '{params,board}' from acts a where a.id = landed) = minus::text, 'the part did not land on the board the earlier beat made: ' || (select coalesce(failure, 'waiting') from queued_moves where id = q));
end $$;
