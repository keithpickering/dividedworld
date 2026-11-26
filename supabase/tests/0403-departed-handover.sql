-- One handover row per handover, and a departure (supabase/migrations/0403_departed_personas.sql; docs/plans/2026-11-21-departed-personas-plan.md, Task 1; its design, section 3).
--
-- A persona that left the instance's roster and sits in the Boss's chair is handed over at once, in the open season, by the same hand_over a roll-over runs. So a season can hold two handovers: season_handovers is
-- keyed by its own id, says why in `cause` (rollover or departure), and every reader that took "the handover of a season" now takes a handover.
--
-- 1. A roll-over writes one row, cause rollover, and every reader answers as before: the to-do, the news, the predecessor, the career.
-- 2. hand_over(open season, Boss, now(), true) with another Boss on the roster: a second row in the same season (cause departure, how rotation), a new Boss, the outgoing Boss's office, its waiting moves withdrawn,
--    the farewell and the arrival posted; the career lists both terms.
-- 3. The departure's to-do is its own (its handover's id, the open season); dismissing it leaves the roll-over's; a handover that kept the Boss is refused.
-- 4. predecessor_handoff() and pool_context().predecessor name the departed Boss.
-- 5. season_news shows bossLeft and bossArrived in the open season for a departure, and the roll-over's bossLeft in the season before.
-- 6. An inherited board move that landed 10 days before a departure, with inheritanceGraceDays = 3, is not ended by the next tick, and is ended by a tick 3 days after the departure.
-- 7. The migration on rows already held: not here (this database ran it on empty tables); e2e/0031-handover-table-on-held-rows.ts runs the migration's own table part on old-shape rows.
-- 8. A departure where the roster holds no other Boss is refused with the reason, and no row, office or announcement is written.
-- 9. A roll-over whose handover fails still writes its fallback row (reveal_season's `on conflict` names the one-roll-over-per-season index).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- ---- 0. The world: a Boss and two Mods in the roster, a season of 14 days that began 15 days ago ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 200,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 14),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'), 'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'nameSuccessor', 'the naming of a successor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Dp Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'dp-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'dp-boss', 'name', 'Dp Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'dp-mod', 'name', 'Dp Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'dp-mod2', 'name', 'Dp Mod Two', 'title', 'Mod', 'signature', 'c')),
      'firstStaff', jsonb_build_array('dp-mod', 'dp-mod2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true), jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('dp-admin'));
  update seasons set starts_at = now() - interval '15 days' where ends_at is null;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;
create function pg_temp.open_season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.boss() returns text language sql as $$ select boss from seasons where ends_at is null $$;
create function pg_temp.as_admin() returns void language sql as $$ select tests.become((select id from auth.users where email = 'dp-admin@test.invalid')) $$;
-- The to-dos, as an admin reads them.
create function pg_temp.todos() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_admin();
  r := admin_queue() -> 'todos';
  perform tests.unbecome();
  return r;
end $$;
create function pg_temp.dismiss(handover bigint) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_admin();
  r := dismiss_handover_todo(handover);
  perform tests.unbecome();
  return r;
end $$;
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.said_count() returns bigint language sql as $$
  select count(*) from acts a where a.kind = 'post' and a.thread in (select sh.thread from season_handovers sh where sh.thread is not null)
$$;
create function pg_temp.meeting() returns bigint language sql as $$
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id
$$;
-- A move of a Boss landed at a given time (an Act written in the past, as the tick would have in its day).
create function pg_temp.land(by_staff text, kind text, params jsonb, at timestamptz) returns uuid language plpgsql as $$
declare
  written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select c.id from characters c where c.staff = by_staff), 'move', pg_temp.ann(), jsonb_build_object('kind', kind, 'params', params, 'body', 'landed'), at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create table pg_temp.ids (name text primary key, id bigint, who text);

-- ---- 1. A roll-over writes one row, cause rollover, and every reader answers as before ----
do $$
declare
  rows_n integer;
  h record;
  t jsonb;
  todo jsonb;
  pred jsonb;
  career jsonb;
  new_boss text;
begin
  perform reveal_season(now());
  new_boss := pg_temp.boss();
  perform pg_temp.expect(new_boss is not distinct from 'dp-mod', 'the roll-over did not seat the next Boss in the roster: ' || coalesce(new_boss, 'nobody'));
  select count(*) into rows_n from season_handovers where season = pg_temp.open_season();
  perform pg_temp.expect(rows_n = 1, 'a roll-over wrote ' || rows_n || ' handover rows, not one');
  select * into h from season_handovers where season = pg_temp.open_season();
  perform pg_temp.expect(h.cause is not distinct from 'rollover' and h.id is not null and h.how is not distinct from 'rotation' and h.outgoing is not distinct from 'dp-boss' and h.boss is not distinct from 'dp-mod',
    'the roll-over row is not (rollover, rotation, dp-boss to dp-mod): ' || to_jsonb(h)::text);
  insert into pg_temp.ids values ('rollover', h.id, null);
  -- The to-do: this handover's, with its cause, naming the season it opened and the outgoing Boss; the note and the facts are of season 1, which the outgoing Boss served.
  t := pg_temp.todos();
  perform pg_temp.expect(jsonb_array_length(t) = 1, 'the roll-over did not make one to-do: ' || t::text);
  todo := t -> 0;
  perform pg_temp.expect((todo ->> 'handover')::bigint is not distinct from h.id and todo ->> 'cause' is not distinct from 'rollover' and (todo ->> 'season')::integer is not distinct from 2
    and todo ->> 'outgoing' is not distinct from 'dp-boss' and todo ->> 'boss' is not distinct from 'dp-mod' and todo ->> 'how' is not distinct from 'rotation' and todo ? 'facts',
    'the roll-over''s to-do does not carry its handover, cause, season, Bosses and how: ' || todo::text);
  -- The predecessor, the pool's, and the career.
  pred := predecessor_handoff();
  perform pg_temp.expect(pred ->> 'staff' is not distinct from 'dp-boss' and (pred ->> 'season')::integer is not distinct from 1, 'the new Boss was not handed the season before: ' || coalesce(pred::text, 'null'));
  perform pg_temp.expect(pool_context() ->> 'predecessor' is not distinct from 'dp-boss', 'the pool''s predecessor is not the outgoing Boss: ' || (pool_context() ->> 'predecessor'));
  career := staff_career('dp-boss') -> 'led';
  perform pg_temp.expect(jsonb_array_length(career) = 1 and career -> 0 ->> 'season' is not distinct from '1' and career -> 0 ->> 'how' is not distinct from 'seed' and career -> 0 ->> 'until' is not null,
    'the first Boss''s career is not season 1, from the seed: ' || career::text);
  career := staff_career('dp-mod') -> 'led';
  perform pg_temp.expect(jsonb_array_length(career) = 1 and career -> 0 ->> 'season' is not distinct from '2' and career -> 0 ->> 'how' is not distinct from 'rotation' and career -> 0 ->> 'until' is null,
    'the new Boss''s career is not season 2, by rotation, still going: ' || career::text);
  -- The news: the arrival in season 2, the departure in season 1.
  perform pg_temp.expect(exists (select 1 from season_news() n where n.kind = 'bossArrived' and n.season = 2 and n.name is not distinct from 'Dp Mod'), 'the news does not say Dp Mod arrived in season 2');
  perform pg_temp.expect(exists (select 1 from season_news() n where n.kind = 'bossLeft' and n.season = 1 and n.name is not distinct from 'Dp Boss'), 'the news does not say Dp Boss left season 1');
end $$;

-- ---- 2. A departure: a second row in the same season, the chair handed on at once ----
do $$
declare
  boss_before text := pg_temp.boss();
  said_before bigint := pg_temp.said_count();
  waiting bigint;
  answer jsonb;
  h record;
  o record;
  career jsonb;
begin
  perform pg_temp.expect(boss_before is not distinct from 'dp-mod', 'setup: the Boss is not dp-mod');
  -- A move of the Boss, due a minute ago and not yet landed: waiting.
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (pg_temp.meeting(), 'dp-mod', 'renameBoard', jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', 'Never Named', 'premise', 'p', 'description', 'd'), null, 'because', now() - interval '1 minute', null, true)
  returning id into waiting;
  answer := hand_over(pg_temp.open_season(), 'dp-mod', now(), true);
  perform pg_temp.expect(answer ->> 'boss' is not distinct from 'dp-mod2' and answer ->> 'how' is not distinct from 'rotation', 'the departure did not seat dp-mod2 by rotation: ' || answer::text);
  perform pg_temp.expect((select count(*) from season_handovers where season = pg_temp.open_season()) = 2, 'the open season does not hold two handover rows');
  select * into h from season_handovers where season = pg_temp.open_season() order by id desc limit 1;
  perform pg_temp.expect(h.cause is not distinct from 'departure' and h.how is not distinct from 'rotation' and h.outgoing is not distinct from 'dp-mod' and h.boss is not distinct from 'dp-mod2' and h.arrival_act is not null,
    'the departure row is not (departure, rotation, dp-mod to dp-mod2, with an arrival): ' || to_jsonb(h)::text);
  insert into pg_temp.ids values ('departure', h.id, null);
  perform pg_temp.expect(current_boss() is not distinct from 'dp-mod2' and pg_temp.boss() is not distinct from 'dp-mod2', 'the Boss now is not dp-mod2');
  -- The outgoing Boss's office: a Mod, since no other Mod stands (dp-boss is a member, dp-mod2 is the Boss), written at the handover.
  select * into o from staff_offices where staff = 'dp-mod' order by id desc limit 1;
  perform pg_temp.expect(o.office is not distinct from 'mod' and o.cause is not distinct from 'handover' and o.season is not distinct from pg_temp.open_season(), 'the outgoing Boss''s office is not mod, by the handover: ' || to_jsonb(o)::text);
  -- Its waiting move is withdrawn for good, with the reason the queue shows.
  perform pg_temp.expect((select q.refused_at is not null and q.failure is not distinct from 'its Boss left the chair before it landed' and q.landed_act is null from queued_moves q where q.id = waiting), 'the outgoing Boss''s waiting move was not withdrawn');
  -- The farewell (the stock line, no handoff was written) and the arrival, as posts of the announcements, the arrival being the row's.
  perform pg_temp.expect(pg_temp.said_count() - said_before = 2, 'the departure posted ' || (pg_temp.said_count() - said_before) || ' posts, not the farewell and the arrival');
  perform pg_temp.expect((select c.staff is not distinct from 'dp-mod2' and a.payload ->> 'body' is not distinct from 'Hello from Dp Mod Two.' from acts a join characters c on c.id = a.character where a.id = h.arrival_act), 'the arrival act is not the new Boss''s hello');
  perform pg_temp.expect(exists (select 1 from acts a join characters c on c.id = a.character where c.staff = 'dp-mod' and a.kind = 'post' and a.thread in (select sh.thread from season_handovers sh where sh.thread is not null) and a.payload ->> 'body' is not distinct from 'Farewell from Dp Mod.'), 'the outgoing Boss''s farewell was not posted');
  -- The roll-over's row is as it was.
  perform pg_temp.expect((select r.cause is not distinct from 'rollover' and r.boss is not distinct from 'dp-mod' from season_handovers r where r.id = (select id from pg_temp.ids where name = 'rollover')), 'the roll-over row changed');
  -- The career: the first term (opened with dp-mod, until the departure) and the second (from the departure, still going), each its own entry.
  career := staff_career('dp-mod') -> 'led';
  perform pg_temp.expect(jsonb_array_length(career) = 1 and career -> 0 ->> 'season' is not distinct from '2' and career -> 0 ->> 'how' is not distinct from 'rotation' and career -> 0 ->> 'until' is not null,
    'the departed Boss''s career is not season 2 until the departure: ' || career::text);
  perform pg_temp.expect((career -> 0 ->> 'until')::timestamptz is not distinct from h.landed_at, 'the departed Boss''s term does not end at the departure: ' || career::text);
  career := staff_career('dp-mod2') -> 'led';
  perform pg_temp.expect(jsonb_array_length(career) = 1 and career -> 0 ->> 'season' is not distinct from '2' and career -> 0 ->> 'how' is not distinct from 'rotation' and career -> 0 ->> 'until' is null
    and (career -> 0 ->> 'since')::timestamptz is not distinct from h.landed_at, 'the new Boss''s career is not season 2 from the departure, still going: ' || career::text);
end $$;

-- ---- 2b. Handoffs are read per Boss: the new Boss's meeting in the farewell window does not stand for the departed Boss's ----
create function pg_temp.apply(boss text, farewell text, handoff text) returns jsonb language plpgsql as $$
declare
  pl jsonb;
begin
  insert into move_bank (staff, balance, as_of) values (boss, 1, now()) on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  pl := jsonb_build_object('boss', boss, 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'Done.'),
    'moves', '[]'::jsonb, 'bundles', '[]'::jsonb, 'record', '{}'::jsonb)
    || case when farewell is not null then jsonb_build_object('farewell', farewell) else '{}'::jsonb end
    || case when handoff is not null then jsonb_build_object('handoff', handoff) else '{}'::jsonb end;
  return apply_meeting((begin_meeting(clock_timestamp()) ->> 'meeting')::bigint, pl);
end $$;
do $$
declare
  s bigint := pg_temp.open_season();
  todo jsonb;
  pred jsonb;
  row_new handoffs%rowtype;
begin
  -- The departed Boss wrote a farewell and a note in this season; the farewell window is wide, so the new Boss's meeting is in it.
  insert into handoffs (season, staff, farewell, note) values (s, 'dp-mod', 'Mod farewell', 'Mod note');
  insert into settings (key, value) values ('farewellWindowHours', '720') on conflict (key) do update set value = excluded.value;
  perform pg_temp.apply('dp-mod2', null, 'New note');
  select * into row_new from handoffs where season = s and staff = 'dp-mod2';
  perform pg_temp.expect(row_new.note is not distinct from 'New note', 'the new Boss''s handoff was not written: ' || coalesce(to_jsonb(row_new)::text, 'no row'));
  -- (b) The new Boss's first row does not carry the departed Boss's farewell.
  perform pg_temp.expect(nullif(row_new.farewell, '') is null, 'the new Boss''s row carries the departed Boss''s farewell: ' || row_new.farewell);
  perform pg_temp.expect((select count(*) from handoffs_latest where season = s) = 2, 'handoffs_latest does not hold one row per Boss for the season');
  -- (a) The departure's to-do and the predecessor show the departed Boss's note, never the new Boss's.
  todo := (select t from jsonb_array_elements(pg_temp.todos()) t where t ->> 'cause' = 'departure');
  perform pg_temp.expect(todo ->> 'note' is not distinct from 'Mod note', 'the departure''s to-do does not show the departed Boss''s note: ' || coalesce(todo::text, 'no to-do'));
  pred := predecessor_handoff();
  perform pg_temp.expect(pred ->> 'note' is not distinct from 'Mod note', 'the predecessor''s note is not the departed Boss''s: ' || coalesce(pred::text, 'null'));
  -- The roll-over's to-do is of season 1, which dp-boss served and wrote nothing in: no note, and not the new Boss's.
  perform pg_temp.expect((select t ->> 'note' from jsonb_array_elements(pg_temp.todos()) t where t ->> 'cause' = 'rollover') is null, 'the roll-over''s to-do shows a note nobody wrote');
  -- The departed Boss's farewell is the one said at the departure's handover (say_farewell reads it by its Boss).
  perform pg_temp.expect((select count(*) from handoffs_latest h where h.season = s and h.staff = 'dp-mod' and h.farewell = 'Mod farewell') = 1, 'the departed Boss''s farewell does not stand');
end $$;

-- ---- 3. The departure's to-do is its own; dismissing it leaves the roll-over's; a handover that kept the Boss has none ----
do $$
declare
  t jsonb := pg_temp.todos();
  dep bigint := (select id from pg_temp.ids where name = 'departure');
  rol bigint := (select id from pg_temp.ids where name = 'rollover');
  todo jsonb;
  r jsonb;
  kept bigint;
  said text;
begin
  perform pg_temp.expect(jsonb_array_length(t) = 2, 'a roll-over and a departure did not make two to-dos: ' || t::text);
  todo := t -> 0;
  perform pg_temp.expect((todo ->> 'handover')::bigint is not distinct from dep and todo ->> 'cause' is not distinct from 'departure' and (todo ->> 'season')::integer is not distinct from 2
    and todo ->> 'outgoing' is not distinct from 'dp-mod' and todo ->> 'boss' is not distinct from 'dp-mod2' and todo ->> 'how' is not distinct from 'rotation' and todo ? 'facts',
    'the departure''s to-do is not its own: ' || todo::text);
  perform pg_temp.expect((t -> 1 ->> 'handover')::bigint is not distinct from rol and t -> 1 ->> 'cause' is not distinct from 'rollover', 'the roll-over''s to-do was lost: ' || t::text);
  -- Dismissing the departure's clears it alone.
  r := pg_temp.dismiss(dep);
  perform pg_temp.expect((r ->> 'handover')::bigint is not distinct from dep and r ->> 'season' is not distinct from '2', 'the dismissal did not say what it dismissed: ' || r::text);
  t := pg_temp.todos();
  perform pg_temp.expect(jsonb_array_length(t) = 1 and (t -> 0 ->> 'handover')::bigint is not distinct from rol, 'dismissing the departure''s to-do did not leave the roll-over''s: ' || t::text);
  perform pg_temp.expect((select count(*) from handover_dismissals) = 1 and (select d.handover from handover_dismissals d) is not distinct from dep and (select d.season from handover_dismissals d) is not distinct from pg_temp.open_season(),
    'the dismissal was not written once, for the departure, in the open season');
  r := pg_temp.dismiss(dep);
  perform pg_temp.expect((select count(*) from handover_dismissals) = 1, 'a second dismissal wrote a second row');
  -- A roll-over that kept the Boss changed nothing: no to-do, and a dismissal of it is refused in words.
  insert into season_handovers (season, outgoing, boss, how) values ((select id from seasons where number = 1), 'dp-boss', 'dp-boss', 'unchanged') returning id into kept;
  said := pg_temp.refused('select pg_temp.dismiss(' || kept || ')');
  perform pg_temp.expect(said like 'P0002%no to-do for that handover%', 'a handover that kept the Boss was not refused in words: ' || coalesce(said, 'accepted'));
  perform pg_temp.expect((select count(*) from handover_dismissals) = 1 and jsonb_array_length(pg_temp.todos()) = 1, 'the refused dismissal changed something');
  delete from season_handovers where id = kept;
  -- A dismissal's kept season is its handover's: a row naming another season is refused by the key, and the rows held are unchanged.
  said := pg_temp.refused('insert into handover_dismissals (season, handover, admin) select (select id from seasons where number = 1), ' || rol || ', (select admin from handover_dismissals limit 1)');
  perform pg_temp.expect(said like '23503%', 'a dismissal whose season is not its handover''s was accepted: ' || coalesce(said, 'accepted'));
  perform pg_temp.expect((select count(*) from handover_dismissals) = 1, 'the refused mismatched dismissal left a row');
end $$;

-- ---- 4. The predecessor is the departed Boss ----
do $$
declare
  pred jsonb := predecessor_handoff();
begin
  perform pg_temp.expect(pred ->> 'staff' is not distinct from 'dp-mod' and (pred ->> 'season')::integer is not distinct from 2, 'the new Boss was not handed the departed Boss''s own season: ' || coalesce(pred::text, 'null'));
  perform pg_temp.expect(pred -> 'facts' ? 'created', 'the departed Boss''s season has no facts: ' || coalesce(pred::text, 'null'));
  perform pg_temp.expect(pool_context() ->> 'predecessor' is not distinct from 'dp-mod', 'the pool''s predecessor is not the departed Boss: ' || (pool_context() ->> 'predecessor'));
end $$;

-- ---- 5. The news: the departure in the open season ----
do $$
begin
  perform pg_temp.expect(exists (select 1 from season_news() n where n.kind = 'bossLeft' and n.season = 2 and n.name is not distinct from 'Dp Mod'), 'the news does not say Dp Mod left season 2: ' || (select string_agg(n.kind || ':' || n.season || ':' || coalesce(n.name, '-'), ', ') from season_news() n));
  perform pg_temp.expect(exists (select 1 from season_news() n where n.kind = 'bossArrived' and n.season = 2 and n.name is not distinct from 'Dp Mod Two'), 'the news does not say Dp Mod Two arrived in season 2');
  perform pg_temp.expect((select count(*) from season_news() n where n.kind = 'bossLeft') = 2 and (select count(*) from season_news() n where n.kind = 'bossArrived') = 2, 'the news does not hold both handovers, each way');
  perform pg_temp.expect((select count(*) from season_news() n where n.kind = 'bossLeft' and n.season = 1 and n.name is not distinct from 'Dp Boss') = 1, 'the roll-over''s bossLeft moved out of season 1');
end $$;

-- ---- 6. The new Boss's grace counts from the departure ----
do $$
declare
  dep bigint := (select id from pg_temp.ids where name = 'departure');
  m uuid;
begin
  -- The season began 12 days ago, so the old clock (the season's start) is long past; an inherited board move landed 10 days ago, the departed Boss's before it left.
  update seasons set ends_at = now() - interval '12 days' where number = 1;
  update seasons set starts_at = now() - interval '12 days' where ends_at is null;
  m := pg_temp.land('dp-boss', 'renameBoard', jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', 'Old Oak', 'premise', 'p', 'description', 'd'), now() - interval '10 days');
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = m) and move_owner(m) is distinct from pg_temp.boss(), 'setup: the move is not an inherited one in force');
  perform system_tick();
  perform pg_temp.expect(exists (select 1 from open_moves where move_act = m) and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = m),
    'the tick ended an inherited move on the day of the departure, before the new Boss''s grace: ' || (select e.payload::text from acts e where e.kind = 'move_end' and e.target_act_id = m));
  -- Three days (and a minute) after the departure, the move is past its grace.
  update season_handovers set at = now() - interval '3 days 1 minute' where id = dep;
  perform system_tick();
  perform pg_temp.expect((select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = m) is not distinct from jsonb_build_object('why', 'superseded', 'by', 'inheritance'),
    'the tick did not end the inherited move after the grace: ' || coalesce((select e.payload::text from acts e where e.kind = 'move_end' and e.target_act_id = m), 'in force'));
  update season_handovers set at = now() where id = dep;
end $$;

-- ---- 7. The migration on rows already held ----
-- Not here: this database ran the migration on empty tables, and a copy of its lines in a scratch schema would be a subject built by the test. e2e/0031-handover-table-on-held-rows.ts runs the migration's own table part
-- (between its two marker comments) on old-shape rows.

-- ---- 9. A roll-over whose handover fails still writes its fallback row ----
-- (Before 8, which retires the other personas.) A trigger refuses every row but the fallback's, so hand_over fails and reveal_season writes the row that keeps the season with its Boss.
create function pg_temp.poison() returns trigger language plpgsql as $$
begin
  if new.note is null or new.note not like 'the handover failed:%' then raise exception 'poisoned: this handover cannot be written'; end if;
  return new;
end $$;
do $$
declare
  boss_before text := pg_temp.boss();
  fallback record;
begin
  create trigger season_handovers_poison before insert on season_handovers for each row execute function pg_temp.poison();
  perform reveal_season(now() + interval '3 days');
  drop trigger season_handovers_poison on season_handovers;
  select * into fallback from season_handovers where season = pg_temp.open_season();
  perform pg_temp.expect(fallback.id is not null and fallback.cause is not distinct from 'rollover' and fallback.how is not distinct from 'unchanged' and fallback.note like 'the handover failed: %poisoned%' and fallback.boss is not distinct from boss_before,
    'the failed roll-over did not leave its fallback row: ' || coalesce(to_jsonb(fallback)::text, 'no row'));
  perform pg_temp.expect(pg_temp.boss() is not distinct from boss_before, 'the failed roll-over did not keep the season with its Boss');
end $$;

-- ---- 8. A departure where the roster holds no other Boss is refused, and nothing is written ----
do $$
declare
  boss text := pg_temp.boss();
  rows_before bigint := (select count(*) from season_handovers);
  offices_before bigint := (select count(*) from staff_offices);
  said_before bigint := pg_temp.said_count();
  said text;
begin
  -- Every other persona is retired, so the Boss is the whole roster.
  update characters set retired_at = now() where staff is not null and staff <> boss and retired_at is null;
  perform pg_temp.expect(boss_roster() = array[boss], 'setup: the roster is not the Boss alone: ' || boss_roster()::text);
  said := pg_temp.refused(format('select hand_over(%s, %L, now(), true)', pg_temp.open_season(), boss));
  perform pg_temp.expect(said is not distinct from '55000 the open season''s Boss ' || boss || ' has left the roster, and no Boss in it can take the chair', 'the departure was not refused with the reason: ' || coalesce(said, 'accepted'));
  perform pg_temp.expect((select count(*) from season_handovers) = rows_before and (select count(*) from staff_offices) = offices_before and pg_temp.said_count() = said_before and pg_temp.boss() is not distinct from boss,
    'the refused departure wrote something');
end $$;
