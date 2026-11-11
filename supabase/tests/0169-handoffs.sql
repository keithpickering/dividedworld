-- The farewell and the handoff (supabase/migrations/0172_handoffs.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 8; design section 6).
--
-- The season's end and the handover are one transaction, and no model runs inside it, so the Boss's last words are written at its last meeting: a farewell, in character, and a handoff
-- note, out of character. apply_meeting stores them in `handoffs` (insert-only; the latest row of a season stands) when the meeting is within farewellWindowHours of the season's end, and
-- nowhere else. hand_over posts the stored farewell as the outgoing Boss's post in place of the stock line, and the stock line when none is stored. The new Boss's meeting is handed the
-- facts the code computes (`handoff_facts`, a pure read of public play) and the outgoing Boss's note, for inheritanceGraceDays after the handover. When the last meeting failed the stock
-- line stands and the note is the facts alone. No grant lets a player read any of it; admins read it in the queue.
--
-- The world: a Boss, two Mod Bots, a Boss that makes a board and merges another and plays a beat in season 1, posts on three boards.

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

-- ---- 0. The world ----
do $$
declare
  seed jsonb;
  boss_arc jsonb := jsonb_build_array(jsonb_build_object('key', 'split', 'mini', false, 'repeatable', false, 'unlock', jsonb_build_array(jsonb_build_object('kind', 'phase', 'phase', 'reign'))));
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 40, 'farewellWindowHours', 36,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 14),
      'phases', jsonb_build_object(
        'honeymoon', jsonb_build_object('days', 2, 'weeklyMoves', 2, 'bankCap', 4, 'moveExpiryMostDays', 7),
        'reign', jsonb_build_object('weeklyMoves', 5, 'bankCap', 10, 'moveExpiryMostDays', 28),
        'meltdown', jsonb_build_object('days', 3, 'weeklyMoves', 8, 'bankCap', 14, 'moveExpiryMostDays', 42)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'bossFarewell', jsonb_build_array('Stock farewell.'), 'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('createBoard', 'the making of a board named "{name}"', 'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Hf Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'hf-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'hf-boss', 'name', 'Hf Boss', 'title', 'Boss', 'signature', 'a', 'beats', '[]'::jsonb, 'arc', boss_arc, 'holdsBack', '[]'::jsonb, 'phaseDays', '{}'::jsonb),
        jsonb_build_object('key', 'hf-mod', 'name', 'Hf Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'hf-mod2', 'name', 'Hf Mod Two', 'title', 'Mod', 'signature', 'c')),
      'firstStaff', jsonb_build_array('hf-mod', 'hf-mod2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'conditions', jsonb_build_array(jsonb_build_object('key', 'phase', 'plain', 'a phase has begun, or the season is near its end'))));
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('hf-admin'));
  perform tests.account('hf-player');
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.queue(kind text, params jsonb) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'hf-boss', kind, params, null, 'because', now() - interval '1 minute', now() - interval '1 minute', true) returning id into q;
  return q;
end $$;
create function pg_temp.land(q bigint) returns uuid language plpgsql as $$
declare
  r queued_moves;
begin
  perform system_tick();
  select * into r from queued_moves where id = q;
  if r.landed_act is null then raise exception 'the move did not land: refused % failure %', r.refused_at, r.failure; end if;
  return r.landed_act;
end $$;
create function pg_temp.posts(by_c uuid, on_slug text, n integer) returns void language plpgsql as $$
declare
  t uuid;
  i integer;
begin
  insert into threads (board, title) values (pg_temp.board(on_slug), 'Thread on ' || on_slug) returning id into t;
  for i in 1..n loop perform tests.post(by_c, t, 'Post ' || i, now() + i * interval '1 minute'); end loop;
end $$;
-- A meeting of the Boss applied with a farewell and a handoff in its answer; returns the apply's result and leaves the meeting's id in pg_temp.last.
create table pg_temp.last (meeting bigint, result jsonb);
create function pg_temp.apply(boss text, farewell text, handoff text) returns jsonb language plpgsql as $$
declare
  m bigint;
  r jsonb;
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
  m := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  r := apply_meeting(m, pl);
  insert into pg_temp.last values (m, r);
  return r;
end $$;
-- The words the persona has posted in the announcements thread, oldest first (one instant in a test, so the order is the words').
create function pg_temp.said_by(staff text) returns text[] language sql as $$
  select coalesce(array_agg(a.payload ->> 'body' order by a.payload ->> 'body'), '{}') from acts a
  where a.kind = 'post' and a.character = (select c.id from characters c where c.staff = said_by.staff)
    and a.thread = (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements')
$$;

-- Season 1: begun 13 days ago, so it ends in a day, inside the 36 hours the farewell window is.
do $$
declare
  acct uuid; acct2 uuid; a uuid; b uuid; q bigint;
begin
  -- The facts count what happened from the season's start. Other files commit boards, posts and moves of their own (the race tests), all before this transaction began, so the season begins
  -- now: the play below is the whole of what the facts see.
  update seasons set starts_at = now() where ends_at is null;
  acct := tests.account('hf-a'); acct2 := tests.account('hf-b');
  a := tests.character(acct, 'Hf Ann'); b := tests.character(acct2, 'Hf Bo');
  insert into boards (slug, name, description) values ('busy', 'Busy Place', 'Loud.'), ('quiet', 'Quiet Place', 'Hushed.'), ('gone', 'Gone Place', 'To be merged.');
  -- Toast Corner is made, and Gone Place is merged into Busy Place, both in season 1; the Boss plays its beat.
  q := pg_temp.queue('createBoard', jsonb_build_object('name', 'Toast Corner', 'premise', 'Toast.', 'description', 'A new board.'));
  perform pg_temp.land(q);
  -- Zed Corner is made and then reversed: its move has ended, so the board is closed.
  q := pg_temp.queue('createBoard', jsonb_build_object('name', 'Zed Corner', 'premise', 'Zzz.', 'description', 'A short-lived board.'));
  perform end_move(pg_temp.land(q), 'reversed', 'admin');
  q := pg_temp.queue('mergeBoard', jsonb_build_object('board', pg_temp.board('gone'), 'into', pg_temp.board('busy')));
  perform pg_temp.land(q);
  -- The season is young, so the tick has not unlocked the beat; it unlocks and the Boss plays it.
  insert into arc_beat_events (season, staff, beat, event) values (pg_temp.season(), 'hf-boss', 'split', 'unlocked');
  insert into arc_beat_events (season, staff, beat, event) values (pg_temp.season(), 'hf-boss', 'split', 'played');
  insert into boards (slug, name, description) select 'extra-' || i, 'Extra ' || i, 'Nobody comes.' from generate_series(1, 8) i;
  perform pg_temp.posts(a, 'busy', 5);
  perform pg_temp.posts(b, 'quiet', 1);
  perform pg_temp.posts(a, 'toast-corner', 2);
end $$;

-- ---- 1. The table is insert-only, no client's, and the latest row of a season stands ----
do $$
declare
  s bigint := pg_temp.season();
  one bigint; two bigint;
begin
  insert into handoffs (season, staff, farewell, note) values (s, 'hf-boss', 'first farewell', 'first note') returning id into one;
  insert into handoffs (season, staff, farewell, note) values (s, 'hf-boss', 'second farewell', 'second note') returning id into two;
  perform pg_temp.expect((select h.farewell from handoffs_latest h where h.season = s) = 'second farewell' and (select count(*) from handoffs_latest h where h.season = s) = 1,
    'the latest row of a season does not stand alone');
  perform pg_temp.expect(pg_temp.refusal(format('update handoffs set note = ''x'' where id = %s', two)) like 'P0001%', 'a handoff was edited');
  perform pg_temp.expect(pg_temp.refusal(format('delete from handoffs where id = %s', one)) like 'P0001%', 'a handoff was deleted');
  perform pg_temp.expect(pg_temp.refusal('truncate handoffs') like 'P0001%', 'handoffs was truncated');
  perform pg_temp.expect(pg_temp.refusal(format('insert into handoffs (season, staff, farewell, note) values (%s, ''hf-nobody'', null, '''')', s)) like '23503%', 'a handoff by no one was written');
  perform pg_temp.expect(pg_temp.refusal(format('insert into handoffs (season, staff, farewell, note) values (%s, ''hf-boss'', null, repeat(''n'', 2001))', s)) like '23514%', 'a note past 2000 characters was written');
  perform tests.unbecome();
  -- No player reads any of it: not as a visitor, not as a signed-in player, and neither role holds a grant on the table or its view.
  perform tests.become_anon();
  perform pg_temp.expect(pg_temp.refusal('select * from handoffs') like '42501%', 'a visitor read handoffs');
  perform pg_temp.expect(pg_temp.refusal('select * from handoffs_latest') like '42501%', 'a visitor read handoffs_latest');
  perform pg_temp.expect(pg_temp.refusal('select handoff_facts(1)') like '42501%', 'a visitor called handoff_facts');
  perform tests.unbecome();
  perform tests.become((select id from auth.users where email = 'hf-player@test.invalid'));
  perform pg_temp.expect(pg_temp.refusal('select * from handoffs') like '42501%', 'a player read handoffs');
  perform pg_temp.expect(pg_temp.refusal('select * from handoffs_latest') like '42501%', 'a player read handoffs_latest');
  perform pg_temp.expect(pg_temp.refusal('select handoff_facts(1)') like '42501%', 'a player called handoff_facts');
  perform tests.unbecome();
  perform pg_temp.expect(not exists (select 1 from information_schema.role_table_grants g where g.table_name in ('handoffs', 'handoffs_latest') and g.grantee in ('anon', 'authenticated', 'public')),
    'a grant on handoffs reaches an API role');
end $$;

-- ---- 2. The facts: boards made, merged and closed; beats played; moves in force; the busiest and quietest boards. A pure read of public play ----
do $$
declare
  s bigint := pg_temp.season();
  f jsonb;
  before_rows bigint;
begin
  select (select count(*) from acts) + (select count(*) from handoffs) + (select count(*) from arc_beat_events) into before_rows;
  f := handoff_facts(s);
  perform pg_temp.expect((select count(*) from acts) + (select count(*) from handoffs) + (select count(*) from arc_beat_events) = before_rows, 'handoff_facts wrote a row');
  perform pg_temp.expect(f = handoff_facts(s), 'handoff_facts is not the same read twice');
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(f) k) = array['beats', 'busiest', 'closed', 'created', 'merged', 'moves', 'quietest'], 'the facts hold more or less than the seven lists: ' || f::text);
  perform pg_temp.expect((select array_agg(e ->> 'name') from jsonb_array_elements(f -> 'created') e) = array['Toast Corner', 'Zed Corner'], 'the boards made are not Toast Corner and Zed Corner: ' || (f -> 'created')::text);
  perform pg_temp.expect((select array_agg(e ->> 'name' || '>' || (e ->> 'intoName')) from jsonb_array_elements(f -> 'merged') e) = array['Gone Place>Busy Place'], 'the merge is not Gone Place into Busy Place: ' || (f -> 'merged')::text);
  perform pg_temp.expect((select array_agg(e ->> 'name') from jsonb_array_elements(f -> 'closed') e) = array['Zed Corner'], 'the board whose move ended is not the one board closed: ' || (f -> 'closed')::text);
  perform pg_temp.expect((select array_agg(e ->> 'beat') from jsonb_array_elements(f -> 'beats') e) = array['split'], 'the beat played is not listed: ' || (f -> 'beats')::text);
  perform pg_temp.expect((select array_agg(distinct e ->> 'kind' order by e ->> 'kind') from jsonb_array_elements(f -> 'moves') e where e ->> 'kind' in ('createBoard', 'mergeBoard')) = array['createBoard', 'mergeBoard']
    and (select bool_and(e ? 'kind' and e ? 'landedAt') from jsonb_array_elements(f -> 'moves') e), 'the moves in force do not hold the two lasting moves: ' || (f -> 'moves')::text);
  perform pg_temp.expect(f -> 'busiest' -> 0 ->> 'name' = 'Busy Place' and (f -> 'busiest' -> 0 ->> 'posts')::integer = 5, 'the busiest board is not Busy Place with 5: ' || (f -> 'busiest')::text);
  perform pg_temp.expect(jsonb_array_length(f -> 'busiest') = 5 and jsonb_array_length(f -> 'quietest') = 5, 'the lists are not five and five: ' || (f -> 'busiest')::text || (f -> 'quietest')::text);
  perform pg_temp.expect((select bool_and((e ->> 'posts')::integer = 0) from jsonb_array_elements(f -> 'quietest') e), 'the quietest five are not the boards with no posts: ' || (f -> 'quietest')::text);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(f -> 'busiest') b join jsonb_array_elements(f -> 'quietest') q on b ->> 'board' = q ->> 'board'), 'a board is on both lists');
  perform pg_temp.expect((select array_agg((e ->> 'posts')::integer order by ord) from jsonb_array_elements(f -> 'busiest') with ordinality x(e, ord)) = (select array_agg(n order by n desc) from (select (e ->> 'posts')::integer as n from jsonb_array_elements(f -> 'busiest') e) z), 'the busiest list is not busiest first');
  -- A closed board is not on either list, and neither is The System's.
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(f -> 'busiest' || (f -> 'quietest')) e where e ->> 'name' = 'Gone Place' or (e ->> 'board')::uuid = (select id from boards where is_system)), 'a closed or system board is ranked');
  -- Nothing private: no owner, account, class or reaction is in the read.
  perform pg_temp.expect(f::text !~* '(account|owner|class|reaction)', 'the facts name something private: ' || f::text);
  -- A season with no play is empty lists, not an error.
  perform pg_temp.expect((handoff_facts(s + 1000) -> 'created') = '[]'::jsonb, 'a season that does not exist is not empty lists');
  perform tests.unbecome();
end $$;

-- ---- 3. The meeting is told to write them only within farewellWindowHours of the season's end ----
do $$
declare
  c jsonb;
begin
  update seasons set starts_at = now() - interval '5 days' where ends_at is null;
  c := meeting_context();
  perform pg_temp.expect(c -> 'handoffFacts' = 'null'::jsonb or not c ? 'handoffFacts', 'a meeting nine days out is shown the handoff facts: ' || coalesce((c -> 'handoffFacts')::text, ''));
  -- The database holds the line: a farewell sent outside the window is stored nowhere, and the meeting says so.
  perform pg_temp.apply('hf-boss', 'Too early!', 'Too early, note.');
  perform pg_temp.expect(not exists (select 1 from handoffs h where h.farewell = 'Too early!'), 'a farewell outside the window was stored');
  perform pg_temp.expect((select m.record #>> '{handoffSkipped,0,why}' from meetings m where m.id = (select max(meeting) from pg_temp.last)) = 'inFarewellWindow', 'a farewell outside the window left no record');
  update seasons set starts_at = now() - interval '13 days' where ends_at is null;
  c := meeting_context();
  perform pg_temp.expect(jsonb_typeof(c -> 'handoffFacts') = 'object' and (c -> 'handoffFacts' -> 'created' -> 0 ->> 'name') = 'Toast Corner', 'a meeting within the window is not shown the facts: ' || coalesce((c -> 'handoffFacts')::text, ''));
  perform tests.unbecome();
end $$;

-- ---- 4. apply_meeting stores them, trimmed to postMaxLength (40) and 2000, as a row beside the ones before it; a meeting that gives neither writes none ----
do $$
declare
  s bigint := pg_temp.season();
  n_before bigint;
  r jsonb;
begin
  select count(*) into n_before from handoffs where season = s;
  perform pg_temp.apply('hf-boss', null, null);
  perform pg_temp.expect((select count(*) from handoffs where season = s) = n_before, 'a meeting with no farewell and no handoff wrote a row');
  r := pg_temp.apply('hf-boss', repeat('So long. ', 10), repeat('Mind the fangame board. ', 120));
  perform pg_temp.expect((select count(*) from handoffs where season = s) = n_before + 1, 'a meeting with a farewell did not write one row');
  perform pg_temp.expect((select length(h.farewell) from handoffs_latest h where h.season = s) = 40, 'the farewell was not trimmed to postMaxLength: ' || (select h.farewell from handoffs_latest h where h.season = s));
  perform pg_temp.expect((select length(h.note) from handoffs_latest h where h.season = s) = 2000, 'the note was not trimmed to 2000');
  perform pg_temp.expect((select jsonb_array_length(m.record -> 'handoffTrims') from meetings m where m.id = (select max(meeting) from pg_temp.last)) = 2, 'the two trims were not recorded on the meeting');
  perform pg_temp.expect((select h.staff from handoffs_latest h where h.season = s) = 'hf-boss' and (select h.meeting from handoffs_latest h where h.season = s) = (select max(meeting) from pg_temp.last), 'the row does not name the Boss and the meeting');
  -- The words as they stand now are the ones the handover posts.
  perform pg_temp.apply('hf-boss', 'Farewell, you lovely lot.', 'Merge the fangame board into World -1 first.');
  perform pg_temp.expect((select h.farewell from handoffs_latest h where h.season = s) = 'Farewell, you lovely lot.', 'the later meeting''s farewell does not stand');
  -- A later meeting that writes only a note keeps the farewell the earlier one wrote, and one that writes only a farewell keeps the note: silence displaces nothing.
  perform pg_temp.apply('hf-boss', null, 'An interim note.');
  perform pg_temp.expect((select h.farewell from handoffs_latest h where h.season = s) = 'Farewell, you lovely lot.' and (select h.note from handoffs_latest h where h.season = s) = 'An interim note.',
    'a later note lost the farewell: ' || (select h.farewell || ' / ' || h.note from handoffs_latest h where h.season = s));
  perform pg_temp.apply('hf-boss', 'Farewell, you lovely lot.', null);
  perform pg_temp.expect((select h.farewell from handoffs_latest h where h.season = s) = 'Farewell, you lovely lot.' and (select h.note from handoffs_latest h where h.season = s) = 'An interim note.',
    'a later farewell lost the note: ' || (select h.farewell || ' / ' || h.note from handoffs_latest h where h.season = s));
  perform pg_temp.apply('hf-boss', null, 'Merge the fangame board into World -1 first.');
  perform pg_temp.expect((select h.farewell from handoffs_latest h where h.season = s) = 'Farewell, you lovely lot.', 'the restored note lost the farewell');
  perform tests.unbecome();
end $$;

-- ---- 5. hand_over posts the stored farewell as the outgoing Boss's post, in place of the stock line ----
do $$
declare
  s1 bigint := pg_temp.season();
  new_boss text;
begin
  perform reveal_season(now() + interval '1 day');
  new_boss := (select boss from seasons where ends_at is null);
  perform pg_temp.expect(new_boss is not null and new_boss <> 'hf-boss', 'the handover did not seat a new Boss: ' || coalesce(new_boss, 'nobody'));
  perform pg_temp.expect(pg_temp.said_by('hf-boss') = array['Farewell, you lovely lot.'], 'the stored farewell was not posted as the outgoing Boss''s: ' || pg_temp.said_by('hf-boss')::text);
  perform pg_temp.expect(not exists (select 1 from acts a where a.kind = 'post' and a.payload ->> 'body' = 'Stock farewell.'), 'the stock line was posted beside the farewell');
  perform pg_temp.expect(pg_temp.said_by(new_boss) = array['Hello from ' || (select name from characters where staff = new_boss) || '.'], 'the arrival post is not the stock arrival');
  perform tests.unbecome();
end $$;

-- ---- 6. The new Boss's meeting is handed the facts and the note, for inheritanceGraceDays after the handover ----
do $$
declare
  c jsonb;
  new_boss text := (select boss from seasons where ends_at is null);
begin
  c := meeting_context();
  perform pg_temp.expect(c #>> '{predecessor,staff}' = 'hf-boss', 'the new Boss is not handed its predecessor: ' || coalesce((c -> 'predecessor')::text, 'nothing'));
  perform pg_temp.expect(c #>> '{predecessor,note}' = 'Merge the fangame board into World -1 first.', 'the predecessor''s note is not handed over: ' || coalesce((c -> 'predecessor')::text, 'nothing'));
  perform pg_temp.expect(c #>> '{predecessor,facts,created,0,name}' = 'Toast Corner', 'the predecessor''s facts are not handed over: ' || coalesce((c #> '{predecessor,facts}')::text, 'nothing'));
  perform pg_temp.expect(c #> '{predecessor}' ? 'farewell' is false, 'the farewell is handed over as if it were a note');
  -- Past the grace, nothing: the handover is four days old.
  update season_handovers set at = now() - interval '4 days' where season = (select id from seasons where ends_at is null);
  perform pg_temp.expect(c -> 'predecessor' <> 'null'::jsonb, 'setup: the predecessor was already absent');
  perform pg_temp.expect(meeting_context() -> 'predecessor' = 'null'::jsonb or not meeting_context() ? 'predecessor', 'a Boss four days in is still handed the note (inheritanceGraceDays is 3)');
  update season_handovers set at = now() where season = (select id from seasons where ends_at is null);
  -- The Boss that wrote it is not handed it again where the seat was not changed.
  update season_handovers set boss = outgoing, how = 'unchanged' where season = (select id from seasons where ends_at is null);
  perform pg_temp.expect(meeting_context() -> 'predecessor' = 'null'::jsonb or not meeting_context() ? 'predecessor', 'a Boss that kept its seat is handed its own note');
  update season_handovers set boss = new_boss, how = 'rotation' where season = (select id from seasons where ends_at is null);
  perform tests.unbecome();
end $$;

-- ---- 7. The admins read the note and the facts in the handover's to-do; a player reads neither ----
do $$
declare
  t jsonb;
begin
  perform tests.become((select id from auth.users where email = 'hf-admin@test.invalid'));
  t := admin_queue() -> 'todos' -> 0;
  perform tests.unbecome();
  perform pg_temp.expect(t ->> 'note' = 'Merge the fangame board into World -1 first.', 'the to-do does not carry the note: ' || coalesce(t::text, 'no to-do'));
  perform pg_temp.expect(t #>> '{facts,created,0,name}' = 'Toast Corner', 'the to-do does not carry the facts: ' || coalesce(t::text, 'no to-do'));
  perform tests.become((select id from auth.users where email = 'hf-player@test.invalid'));
  perform pg_temp.expect(pg_temp.refusal('select admin_queue()') like '42501%', 'a player read the to-do');
  perform tests.unbecome();
end $$;

-- ---- 8. When the last meeting failed: the stock line stands, and the note is the facts alone ----
do $$
declare
  c jsonb;
  boss2 text;
  next_boss text;
begin
  boss2 := (select boss from seasons where ends_at is null);
  -- Season 2 ends in a day. Its Boss's last meeting failed, so no handoff row was written for it.
  -- Seasons do not overlap, so season 2 began where season 1 ended; a one-day season ends a day on, and its Boss's last meeting failed.
  update settings set value = '{"unit": "day", "count": 1}' where key = 'seasonLength';
  insert into meetings (started_at, slot, finished_at, outcome, error) values (now(), clock_timestamp(), now(), 'failed', 'the model did not answer');
  perform pg_temp.expect(not exists (select 1 from handoffs h where h.season = pg_temp.season()), 'setup: season 2 already has a handoff');
  perform reveal_season(now() + interval '2 days');
  next_boss := (select boss from seasons where ends_at is null);
  perform pg_temp.expect(next_boss is not null and next_boss <> boss2, 'the second handover did not change the Boss: ' || coalesce(next_boss, 'nobody'));
  perform pg_temp.expect('Stock farewell.' = any (pg_temp.said_by(boss2)), 'with no stored farewell the stock line did not stand: ' || pg_temp.said_by(boss2)::text);
  c := meeting_context();
  perform pg_temp.expect(c #>> '{predecessor,staff}' = boss2, 'the third Boss is not handed its predecessor: ' || coalesce((c -> 'predecessor')::text, 'nothing'));
  perform pg_temp.expect(c #> '{predecessor,note}' = 'null'::jsonb, 'the note is not absent: ' || (c -> 'predecessor')::text);
  perform pg_temp.expect(jsonb_typeof(c #> '{predecessor,facts}') = 'object' and (c #> '{predecessor,facts}') ? 'created', 'the facts alone are not handed over: ' || (c -> 'predecessor')::text);
  perform tests.unbecome();
end $$;

-- ---- 9. A farewell the post cannot take falls back to the stock line, and the handover still lands ----
do $$
declare
  boss3 text := (select boss from seasons where ends_at is null);
begin
  -- Blank words are no farewell.
  insert into handoffs (season, staff, farewell, note) values (pg_temp.season(), boss3, '   ', 'A note, with no farewell.');
  perform reveal_season(now() + interval '3 days');
  perform pg_temp.expect((select boss from seasons where ends_at is null) is not null, 'the handover did not land');
  perform pg_temp.expect('Stock farewell.' = any (pg_temp.said_by(boss3)), 'a blank farewell did not leave the stock line: ' || pg_temp.said_by(boss3)::text);
  perform tests.unbecome();
end $$;

-- ---- 10. A closed season's facts are bounded by its end: a move made after it closed is not in them ----
do $$
declare
  s1 bigint := (select min(id) from seasons);
  before_f jsonb;
  after_f jsonb;
begin
  before_f := handoff_facts(s1);
  perform pg_temp.expect(jsonb_array_length(before_f -> 'created') = 2 and jsonb_array_length(before_f -> 'moves') >= 2, 'setup: season 1 does not hold its two lasting moves: ' || before_f::text);
  -- The season is made to have closed before those moves landed: everything they did is after its end.
  update seasons set ends_at = now() - interval '1 hour' where id = s1;
  after_f := handoff_facts(s1);
  perform pg_temp.expect(after_f -> 'created' = '[]'::jsonb and after_f -> 'merged' = '[]'::jsonb, 'a move made after the season closed is in its facts: ' || after_f::text);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(after_f -> 'moves') e where e ->> 'kind' in ('createBoard', 'mergeBoard')), 'a move in force that landed after the season closed is in its facts: ' || (after_f -> 'moves')::text);
end $$;
