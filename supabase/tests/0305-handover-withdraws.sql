-- The handover withdraws the outgoing Boss's waiting moves (supabase/migrations/0358_handover_withdraws.sql; docs/plans/2026-11-13-rehearsal-patch-design.md, section 6).
--
-- A move that waits in the admin queue for structuralHoldHours can land after its Boss has left the chair, and a board move is never inherited, so the new Boss could not review it. hand_over refuses
-- for good every move of the outgoing Boss that is still waiting (not landed, not held, not refused), with the reason the admin queue shows, and posts nothing for it.
--
-- 1. The world (as 0188 builds it): a Boss with a waiting mergeBoard, a waiting nameSuccessor and a held renameBoard; two Mods, each with a waiting setRule.
-- 2. The season rolls over to another Boss: the Boss's two waiting rows are refused with the reason; the held row, the Mods' rows and the landed history are as they were, as are a row refused earlier and a row landed earlier.
-- 3. A tick after every go_live_at lands the Mods' rows and none of the Boss's, and nothing is posted for the Boss's.
-- 4. A Boss row already refused before the handover (a dependency or rule-clash refusal) and one already landed are left as they were, and the waiting rows are still withdrawn.
-- 5. Where the roster holds only the outgoing Boss and the season stays with it, nothing is withdrawn.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- ---- 0. The world ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 40,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 14),
      'phases', jsonb_build_object(
        'honeymoon', jsonb_build_object('days', 2, 'weeklyMoves', 2, 'bankCap', 4, 'moveExpiryMostDays', 7),
        'reign', jsonb_build_object('weeklyMoves', 5, 'bankCap', 10, 'moveExpiryMostDays', 28),
        'meltdown', jsonb_build_object('days', 3, 'weeklyMoves', 8, 'bankCap', 14, 'moveExpiryMostDays', 42)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'), 'bossFarewell', jsonb_build_array('Stock farewell.'), 'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('mergeBoard', 'the merging of a board into another', 'renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Hw Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'hw-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'hw-boss', 'name', 'Hw Boss', 'title', 'Boss', 'signature', 'a', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'hw-mod', 'name', 'Hw Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'hw-mod2', 'name', 'Hw Mod Two', 'title', 'Mod', 'signature', 'c')),
      'firstStaff', jsonb_build_array('hw-mod', 'hw-mod2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'nameSuccessor', 'structural', true),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('hw-admin'));
  insert into boards (slug, name, description) values ('hw-busy', 'Busy Place', 'Loud.'), ('hw-quiet', 'Quiet Place', 'Hushed.'), ('hw-gone', 'Gone Place', 'To be merged.');
  update seasons set starts_at = now() - interval '13 days' where ends_at is null;
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.meeting() returns bigint language sql as $$
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id
$$;
-- A move of a persona, due a minute ago and not yet landed (nothing has ticked): it is waiting.
create function pg_temp.queue(staff text, kind text, params jsonb, structural boolean, expires boolean default false) returns bigint language sql as $$
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (pg_temp.meeting(), staff, kind, params, null, 'because', now() - interval '1 minute', case when expires then now() + interval '2 days' end, structural) returning id
$$;
create function pg_temp.row(q bigint) returns queued_moves language sql as $$ select * from queued_moves where id = q $$;
create table pg_temp.ids (name text primary key, id bigint);
create function pg_temp.said_count() returns bigint language sql as $$
  select count(*) from acts a where a.kind = 'post' and a.thread = (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements')
$$;

-- ---- 1. A Boss with a waiting mergeBoard, a waiting nameSuccessor and a held renameBoard; each Mod with a waiting setRule ----
do $$
declare
  q bigint;
  m bigint;
  written uuid;
begin
  insert into pg_temp.ids select 'merge', pg_temp.queue('hw-boss', 'mergeBoard', jsonb_build_object('board', pg_temp.board('hw-gone'), 'into', pg_temp.board('hw-busy')), true);
  insert into pg_temp.ids select 'name', pg_temp.queue('hw-boss', 'nameSuccessor', jsonb_build_object('boss', 'hw-mod2'), true);
  q := pg_temp.queue('hw-boss', 'renameBoard', jsonb_build_object('board', pg_temp.board('hw-busy'), 'name', 'Louder Place', 'premise', 'Louder.', 'description', 'Louder still.'), true);
  update queued_moves set held_at = now(), held_by = (select id from auth.users where email = 'hw-admin@test.invalid') where id = q;
  insert into pg_temp.ids values ('held', q);
  -- Each Mod watches a board and may spend one; a Mod's rule is one move of its own, not the Boss's.
  m := pg_temp.meeting();
  insert into staff_orders (meeting, staff, boards, order_line, allowance) values (m, 'hw-mod', array[pg_temp.board('hw-busy')], 'Watch busy.', 1), (m, 'hw-mod2', array[pg_temp.board('hw-quiet')], 'Watch quiet.', 1);
  insert into pg_temp.ids select 'rule1', pg_temp.queue('hw-mod', 'setRule', jsonb_build_object('board', pg_temp.board('hw-busy'), 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), false, true);
  insert into pg_temp.ids select 'rule2', pg_temp.queue('hw-mod2', 'setRule', jsonb_build_object('board', pg_temp.board('hw-quiet'), 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), false, true);
  -- A Boss row refused before the handover, as a landing refusal makes it (a waiting row takes refused_at, failed_at and failure together), and one the tick already landed, with a real Act.
  q := pg_temp.queue('hw-boss', 'mergeBoard', jsonb_build_object('board', pg_temp.board('hw-quiet'), 'into', pg_temp.board('hw-busy')), true);
  update queued_moves set refused_at = now() - interval '2 hours', failed_at = now() - interval '2 hours', failure = 'its board was already gone' where id = q;
  insert into pg_temp.ids values ('refused', q);
  q := pg_temp.queue('hw-boss', 'renameBoard', jsonb_build_object('board', pg_temp.board('hw-quiet'), 'name', 'Hushed Place', 'premise', 'Hushed.', 'description', 'Hushed still.'), true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select c.id from characters c where c.staff = 'hw-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'renameBoard', 'params', jsonb_build_object('board', pg_temp.board('hw-quiet'), 'name', 'Hushed Place'), 'body', 'landed'), now() - interval '3 hours') returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  update queued_moves set landed_act = written where id = q;
  insert into pg_temp.ids values ('landed', q);
  create table pg_temp.before as select * from queued_moves where id in (select id from pg_temp.ids where name in ('refused', 'landed'));
  perform pg_temp.expect((select count(*) from queued_moves q2 where q2.landed_act is null and q2.refused_at is null) = 5, 'setup: five rows are not waiting or held');
end $$;

-- ---- 2. The season rolls over to another Boss ----
do $$
declare
  said_before bigint := pg_temp.said_count();
  merge_row queued_moves := pg_temp.row((select id from pg_temp.ids where name = 'merge'));
  new_boss text;
begin
  perform reveal_season(now() + interval '1 day');
  new_boss := (select boss from seasons where ends_at is null);
  perform pg_temp.expect(new_boss is not null and new_boss <> 'hw-boss', 'the handover did not seat another Boss: ' || coalesce(new_boss, 'nobody'));
  -- The Boss's two waiting rows are refused for good, with the reason the admin queue shows.
  perform pg_temp.expect((select count(*) from queued_moves q where q.id in (select id from pg_temp.ids where name in ('merge', 'name'))
      and q.refused_at is not null and q.failed_at = q.refused_at and q.failure = 'its Boss left the chair before it landed' and q.landed_act is null and q.held_at is null) = 2,
    'the outgoing Boss''s waiting moves were not withdrawn: ' || (select string_agg(q.kind || ':' || coalesce(q.failure, 'waiting'), ', ') from queued_moves q where q.staff = 'hw-boss'));
  -- The held row is the admins' to release: untouched.
  perform pg_temp.expect((select q.held_at is not null and q.refused_at is null and q.failed_at is null and q.failure is null and q.landed_act is null from pg_temp.row((select id from pg_temp.ids where name = 'held')) q),
    'the held row was touched');
  -- A Mod's own moves are left alone.
  perform pg_temp.expect((select count(*) from queued_moves q where q.id in (select id from pg_temp.ids where name in ('rule1', 'rule2')) and q.refused_at is null and q.failed_at is null and q.failure is null and q.landed_act is null and q.held_at is null) = 2,
    'a Mod''s waiting move was withdrawn');
  -- Nothing is posted for the withdrawn rows: the handover says its farewell and its welcome, and no more.
  perform pg_temp.expect(pg_temp.said_count() - said_before = 2, 'the handover posted ' || (pg_temp.said_count() - said_before) || ' posts, not the farewell and the arrival');
  perform pg_temp.expect(not exists (select 1 from acts a where a.payload ->> 'kind' in ('mergeBoard', 'nameSuccessor', 'renameBoard') and a.id <> (select landed_act from pg_temp.before where kind = 'renameBoard')), 'a move act exists for the withdrawn rows');
  perform pg_temp.expect((select (r.note is null) from season_handovers r where r.season = pg_temp.season()), 'the handover recorded a note: ' || (select r.note from season_handovers r where r.season = pg_temp.season()));
  -- The row refused before the handover keeps its own refusal and time; the landed row is as it was (and not refused); the two waiting Boss rows were still withdrawn above.
  perform pg_temp.expect((select count(*) from queued_moves q join pg_temp.before b using (id) where q.refused_at is not distinct from b.refused_at and q.failed_at is not distinct from b.failed_at
      and q.failure is not distinct from b.failure and q.landed_act is not distinct from b.landed_act and q.held_at is not distinct from b.held_at) = 2, 'a refused or landed row of the Boss was changed');
  perform pg_temp.expect((select q.failure = 'its board was already gone' and q.refused_at < now() - interval '1 hour' from pg_temp.row((select id from pg_temp.ids where name = 'refused')) q), 'the earlier refusal was overwritten');
  perform pg_temp.expect((select q.landed_act is not null and q.refused_at is null and q.failure is null from pg_temp.row((select id from pg_temp.ids where name = 'landed')) q), 'the landed row was refused');
  -- The withdrawn row is as it was but for the refusal.
  perform pg_temp.expect((select q.params = merge_row.params and q.go_live_at = merge_row.go_live_at and q.why = merge_row.why from pg_temp.row(merge_row.id) q), 'the withdrawn row''s own fields changed');
end $$;

-- ---- 3. A tick after every go_live_at lands the Mods' rows and none of the Boss's, and posts nothing for them ----
do $$
declare
  said_before bigint;
begin
  said_before := pg_temp.said_count();
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves q where q.id in (select id from pg_temp.ids where name in ('rule1', 'rule2')) and q.landed_act is not null) = 2,
    'the tick did not land the Mods'' rows: ' || (select string_agg(q.kind || ':' || coalesce(q.failure, 'waiting'), ', ') from queued_moves q where q.staff like 'hw-mod%'));
  perform pg_temp.expect((select count(*) from queued_moves q where q.staff = 'hw-boss' and q.landed_act is not null and q.id <> (select id from pg_temp.ids where name = 'landed')) = 0, 'the tick landed a move of the outgoing Boss');
  perform pg_temp.expect((select q.held_at is not null and q.landed_act is null from pg_temp.row((select id from pg_temp.ids where name = 'held')) q), 'the held row was landed or released by the tick');
  perform pg_temp.expect(not exists (select 1 from acts a where a.payload ->> 'kind' in ('mergeBoard', 'nameSuccessor', 'renameBoard') and a.id <> (select landed_act from pg_temp.before where kind = 'renameBoard')), 'the tick made a move act for the Boss''s rows');
  -- Whatever the tick posted is for the Mods' two rules.
  perform pg_temp.expect(pg_temp.said_count() - said_before <= 2, 'the tick posted more than the Mods'' two rules: ' || (pg_temp.said_count() - said_before));
end $$;

-- ---- 4. A world where the roster holds only the outgoing Boss: the season stays with it and nothing is withdrawn ----
do $$
declare
  boss text := (select boss from seasons where ends_at is null);
  q bigint;
  after_boss text;
begin
  -- Every other persona is retired, so the Boss is the whole roster.
  update characters set retired_at = now() where staff is not null and staff <> boss and retired_at is null;
  perform pg_temp.expect(boss_roster() = array[boss], 'setup: the roster is not the Boss alone: ' || boss_roster()::text);
  q := pg_temp.queue(boss, 'mergeBoard', jsonb_build_object('board', pg_temp.board('hw-quiet'), 'into', pg_temp.board('hw-busy')), true);
  -- The season that began at the last handover is a day long, so it ends by the settlement below.
  update settings set value = '{"unit": "day", "count": 1}' where key = 'seasonLength';
  perform reveal_season(now() + interval '3 days');
  after_boss := (select s.boss from seasons s where s.ends_at is null);
  perform pg_temp.expect(after_boss = boss, 'the season did not stay with its Boss: ' || coalesce(after_boss, 'nobody'));
  perform pg_temp.expect((select q2.refused_at is null and q2.failed_at is null and q2.failure is null from pg_temp.row(q) q2), 'a Boss that kept the chair had its waiting move withdrawn');
end $$;
