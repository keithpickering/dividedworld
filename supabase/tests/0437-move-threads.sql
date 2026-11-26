-- Each decision in a thread of its own, on the staff's board (supabase/migrations/0437_move_threads.sql; docs/plans/2026-11-24-staff-board-threads-plan.md, Task 4; the design, section 6).
--
-- 1. A seed that names no announcements thread makes none, and an instance that has one keeps it, still in system_thread_rows(); it takes nothing new.
-- 2. A landed move opens a staff thread on the system board (staff_placed), the move at seq 1, titled by `systemThreadTitles` for its kind and by its plain words where it has none.
-- 3. A bundle's parts share one thread, whether they land in one tick or two, and a refused first part still leaves one thread to find or open. A move's end follows it there.
-- 4. A handover opens one thread: the farewell, then the arrival, recorded on its row; season_news finds the arrival's quote there.
-- 5. An admin's description of a board with no rename in force opens a thread of its own (a stock first post, then the describe Act); with a rename it is written in the rename's thread.
-- 6. The flag: moving the system board carries every staff thread, by both placements, and a moveThread naming a staff thread is refused. The placements read the flag from the row, never the set of
--    staff threads, so a few thousand of them change no answer and add no join (the definitions are checked for it).
-- 7. A staff thread is counted exactly as thread_list lists it, so the system board's page total never drifts from its list.
-- 8. With The System off, nothing lands.
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

-- ---- 0. The world: a Boss and two Mods, the instance's words for titles and lines, and no announcements thread in the seed ----
do $$
declare
  seed jsonb;
begin
  -- An earlier file's committed state may hold an announcements thread (and staff threads, and moves due); this file names none, makes its own below, and counts staff threads relative to what it finds.
  delete from settings where key = 'systemAnnouncements';
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'postMaxLength', 200, 'titleMaxLength', 60,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 14),
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('It is done: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.'),
        'bossFarewell', jsonb_build_array('Stock farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'),
        'boardDescription', jsonb_build_array('{boss} has described {board}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'createBoard', 'the making of a board named "{name}"',
        'moveThread', 'the moving of a thread to another board', 'mergeBoard', 'the merging of a board into another'),
      'systemThreadTitles', jsonb_build_object('renameBoard', 'Renamed: {move}', 'moveThread', 'Moved: {move}')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('firstBoss', 'mt-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'mt-boss', 'name', 'Mt Boss', 'title', 'Boss', 'signature', 'a', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'mt-mod', 'name', 'Mt Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'mt-mod2', 'name', 'Mt Mod Two', 'title', 'Mod', 'signature', 'c')),
      'firstStaff', jsonb_build_array('mt-mod', 'mt-mod2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'createBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('mt-admin'));
  update settings set value = jsonb_set(value, '{handoverThreadTitle}', to_jsonb('Handover: {boss} for season {season}'::text), true) where key = 'copy';
  insert into settings (key, value) select 'copy', jsonb_build_object('handoverThreadTitle', 'Handover: {boss} for season {season}') where not exists (select 1 from settings where key = 'copy');
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where slug = board.slug $$;
create function pg_temp.mkthread(title text, on_slug text) returns uuid language sql as $$
  insert into threads (board, title) values (pg_temp.board(on_slug), title) returning id
$$;
create function pg_temp.season() returns bigint language sql as $$ select id from seasons where ends_at is null $$;
create function pg_temp.admin() returns uuid language sql as $$ select id from auth.users where email = 'mt-admin@test.invalid' $$;
-- A move waiting to land, as apply_meeting queues it, live a minute ago unless told otherwise (a bundle's id, name and role make it a part).
create function pg_temp.queue(kind text, params jsonb, bundle uuid default null, role text default null, live interval default interval '-1 minute', who text default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
  values (m, coalesce(who, current_boss()), kind, params, null, 'because', now() + live, now() + live + case when kind in ('createBoard', 'moveThread', 'mergeBoard') then interval '0' else interval '3 days' end, kind in ('createBoard', 'mergeBoard', 'renameBoard'), bundle, case when bundle is not null then 'The Test Bundle' end, role) returning id into q;
  return q;
end $$;
create function pg_temp.rename(new_name text) returns jsonb language sql as $$
  select jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'About ' || new_name, 'description', 'Words for ' || new_name)
$$;
create function pg_temp.mkboard(name text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'premise', 'About ' || name, 'description', 'The ' || name || ' board.')
$$;
create function pg_temp.qrow(q bigint) returns queued_moves language sql as $$ select * from queued_moves where id = q $$;
-- A waiting part made due, as the passing of its hour would: the guard holds a queued move's times, so the test sets them past it.
create function pg_temp.due(q bigint) returns void language plpgsql as $$
begin
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute', expires_at = null where id = q;
  alter table queued_moves enable trigger queued_moves_guard;
end $$;
create function pg_temp.thread_of(q bigint) returns uuid language sql as $$ select a.thread from queued_moves m join acts a on a.id = m.landed_act where m.id = q $$;
create function pg_temp.listed(board uuid) returns bigint language sql as $$ select count(*) from thread_list l where l.board = listed.board $$;
create function pg_temp.counted(board uuid) returns bigint language sql as $$ select coalesce((select c.threads from board_counts c where c.board = counted.board), 0)::bigint $$;

-- ---- 1. No announcements thread was made; an instance that has one keeps it, and nothing is written in it ----
create table pg_temp.ann (thread uuid, acts bigint);
do $$
declare
  ann uuid;
begin
  perform pg_temp.expect(not exists (select 1 from settings where key = 'systemAnnouncements'), 'a seed that names no announcements title made an announcements thread');
  -- An instance that has one: made as the seed made it.
  insert into threads (board, title) values (system_board(), 'Official Announcements') returning id into ann;
  insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann::text));
  insert into pg_temp.ann values (ann, 0);
  perform pg_temp.expect(ann in (select system_threads()) and ann in (select r.id from system_thread_rows() r), 'the announcements thread is not in the staff''s set');
  perform pg_temp.expect(not exists (select 1 from threads where id = ann and staff_placed), 'the announcements thread was flagged as a staff thread');
end $$;

-- ---- 2. A landed move opens a staff thread of its own: the move at seq 1, titled by its kind ----
do $$
declare
  q bigint := pg_temp.queue('renameBoard', pg_temp.rename('Toast Palace'));
  q2 bigint := pg_temp.queue('renameBoard', pg_temp.rename('Toast Palace Two'));
  t uuid;
  t2 uuid;
  act uuid;
  ran jsonb;
  before_n bigint;
begin
  ran := system_tick();
  perform pg_temp.expect((ran ->> 'landed')::integer = 2 and (ran ->> 'failed')::integer = 0, 'the tick did not land the two moves: ' || ran::text);
  perform pg_temp.expect(not ran ? 'noThread', 'the tick still answers noThread');
  act := (pg_temp.qrow(q)).landed_act;
  t := pg_temp.thread_of(q);
  t2 := pg_temp.thread_of(q2);
  perform pg_temp.expect(t is not null and t2 is not null and t <> t2, 'two moves did not each open a thread of their own');
  perform pg_temp.expect(t <> (select thread from pg_temp.ann), 'the move landed in the announcements thread');
  perform pg_temp.expect((select th.board = system_board() and th.staff_placed and th.origin_board = system_board() from threads th where th.id = t), 'the move''s thread is not a staff thread on the system board');
  perform pg_temp.expect((select a.seq from acts a where a.id = act) = 1 and (select count(*) from acts a where a.thread = t) = 1, 'the move is not the only Act, at seq 1, of its thread');
  perform pg_temp.expect((select a.character from acts a where a.id = act) = (select c.id from characters c where c.staff = 'mt-boss'), 'the move is not the Boss''s');
  -- Titled by its kind: the instance's title with its tokens filled ({move}: the move's plain words, with its params in them).
  perform pg_temp.expect((select th.title from threads th where th.id = t) is not distinct from 'Renamed: the renaming of a board to "Toast Palace"', 'the move''s thread is titled ' || (select th.title from threads th where th.id = t));
  -- Listed on the system board, as the board's archive.
  perform pg_temp.expect(exists (select 1 from thread_list l where l.id = t and l.board = system_board()), 'the move''s thread is not listed on the system board');
  perform pg_temp.expect(thread_place(t) = system_board() and (select c.place from thread_places_computed() c where c.thread = t) = system_board(), 'the placements do not put the move''s thread on the system board');
  -- Nothing new in the announcements thread.
  perform pg_temp.expect((select count(*) from acts a where a.thread = (select thread from pg_temp.ann)) = 0, 'a move was written in the announcements thread');
  -- Again: nothing more lands, and no thread is opened for a move already landed.
  before_n := (select count(*) from threads where staff_placed);
  perform system_tick();
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n, 'a second tick opened threads: ' || ((select count(*) from threads where staff_placed) - before_n));
  -- Its end follows it into the same thread.
  perform end_move(act, 'reversed', 'test');
  perform say_move_end(act, 'reversed');
  -- The line is owed (0442) and paid from stock here, as the tick's grace pays it.
  perform pay_owed_line(o.owed, null) from lines_owed_open o order by o.owed;
  -- A move landed and ended in one tick is never dated before itself: the move is stamped by the clock (write_staff_act), so its end is too (end_move).
  perform pg_temp.expect((select e.created_at from acts e where e.kind = 'move_end' and e.target_act_id = act) >= (select m.created_at from acts m where m.id = act),
    'a move''s end is dated before the move it ends: ' || (select e.created_at from acts e where e.kind = 'move_end' and e.target_act_id = act) || ' < ' || (select m.created_at from acts m where m.id = act));
  perform pg_temp.expect((select count(*) from acts a where a.thread = t and a.kind = 'post' and a.payload ->> 'body' like 'Reversed: %') = 1, 'the move''s end was not said in its thread');
  -- And the Boss's end line, written after the end in the same transaction, is dated no earlier than it: every staff Act is stamped by the clock, so one transaction's Acts read in the order they were written.
  perform pg_temp.expect((select l.created_at from acts l where l.thread = t and l.kind = 'post' and l.payload ->> 'body' like 'Reversed: %')
    >= (select e.created_at from acts e where e.kind = 'move_end' and e.target_act_id = act),
    'the Boss''s end line is dated before the move''s end: ' || (select l.created_at from acts l where l.thread = t and l.kind = 'post' and l.payload ->> 'body' like 'Reversed: %') || ' < ' || (select e.created_at from acts e where e.kind = 'move_end' and e.target_act_id = act));
  perform pg_temp.expect((select count(*) from acts a where a.thread = t) = 3, 'the move''s thread holds ' || (select count(*) from acts a where a.thread = t) || ' Acts, not the move, its end and the line');
end $$;

-- A kind the instance has no title for is titled by its plain words, capitalized, and the title is cut to titleMaxLength.
do $$
declare
  q bigint := pg_temp.queue('createBoard', pg_temp.mkboard('A Board With A Name Long Enough To Pass The Sixty Character Title Limit For Sure'));
  t uuid;
begin
  perform system_tick();
  t := pg_temp.thread_of(q);
  perform pg_temp.expect(t is not null, 'the createBoard did not land: ' || coalesce((pg_temp.qrow(q)).failure, 'no failure'));
  perform pg_temp.expect((select th.title from threads th where th.id = t) = left('The making of a board named "A Board With A Name Long Enough To Pass The Sixty Character Title Limit For Sure"', 60),
    'a kind with no title is titled ' || (select th.title from threads th where th.id = t));
end $$;

-- ---- 3. A bundle: its parts share a thread, in one tick or two; a refused first part leaves the thread to find or open ----
do $$
declare
  b uuid := gen_random_uuid();
  t uuid := pg_temp.mkthread('Resolved', 'general');
  q1 bigint;
  q2 bigint;
begin
  q1 := pg_temp.queue('createBoard', pg_temp.mkboard('Together'), b, 'made');
  q2 := pg_temp.queue('moveThread', jsonb_build_object('thread', t, 'board', jsonb_build_object('role', 'made')), b, 'move');
  perform system_tick();
  perform pg_temp.expect((pg_temp.qrow(q1)).landed_act is not null and (pg_temp.qrow(q2)).landed_act is not null, 'the bundle''s parts did not both land: ' || coalesce((pg_temp.qrow(q2)).failure, 'no failure'));
  perform pg_temp.expect(pg_temp.thread_of(q1) = pg_temp.thread_of(q2), 'the parts of a bundle that landed in one tick did not share a thread');
  perform pg_temp.expect((select count(*) from acts a where a.thread = pg_temp.thread_of(q1) and a.kind = 'move') = 2, 'the bundle''s thread does not hold both moves');
  -- The thread's title is the first part's (the bundle's first move).
  perform pg_temp.expect((select th.title from threads th where th.id = pg_temp.thread_of(q1)) = 'The making of a board named "Together"', 'the bundle''s thread is not titled by its first move');
end $$;
do $$
declare
  b uuid := gen_random_uuid();
  q1 bigint;
  q2 bigint;
  t1 uuid;
begin
  -- The first part is due now and the second an hour from now, so they land in two ticks: the later one waits for nothing, and joins the earlier one's thread.
  q1 := pg_temp.queue('createBoard', pg_temp.mkboard('Apart'), b, 'a');
  q2 := pg_temp.queue('createBoard', pg_temp.mkboard('Apart Two'), b, 'b', interval '1 hour');
  perform system_tick();
  t1 := pg_temp.thread_of(q1);
  perform pg_temp.expect(t1 is not null and (pg_temp.qrow(q2)).landed_act is null, 'the first part did not land alone');
  perform pg_temp.due(q2);
  perform system_tick();
  perform pg_temp.expect((pg_temp.qrow(q2)).landed_act is not null, 'the second part did not land: ' || coalesce((pg_temp.qrow(q2)).failure, 'no failure'));
  perform pg_temp.expect(pg_temp.thread_of(q2) = t1, 'a part that landed in a later tick did not join the bundle''s thread');
end $$;
do $$
declare
  b uuid := gen_random_uuid();
  victim uuid := pg_temp.mkthread('Victim', 'general');
  q1 bigint;
  q2 bigint;
  q3 bigint;
  before_n bigint := (select count(*) from threads where staff_placed);
begin
  -- The first part is refused at landing (a moveThread naming a staff thread); the second, not built on it, opens the thread, and the third finds it.
  insert into boards (slug, name) values ('mt-dest', 'Destination') on conflict do nothing;
  q1 := pg_temp.queue('moveThread', jsonb_build_object('thread', victim, 'board', pg_temp.board('mt-dest')), b, null);
  -- The thread becomes a staff thread after the move was queued (the queue refuses one that is already), as the instance's own threads can after one is queued against them.
  update threads set staff_placed = true where id = victim;
  before_n := (select count(*) from threads where staff_placed);
  q2 := pg_temp.queue('createBoard', pg_temp.mkboard('After The Refusal'), b, 'a');
  q3 := pg_temp.queue('createBoard', pg_temp.mkboard('After The Refusal Two'), b, 'b', interval '1 hour');
  perform system_tick();
  perform pg_temp.expect((pg_temp.qrow(q1)).landed_act is null and (pg_temp.qrow(q1)).refused_at is not null, 'a moveThread naming a staff thread was not refused: ' || to_jsonb(pg_temp.qrow(q1))::text);
  perform pg_temp.expect((pg_temp.qrow(q1)).failure like '%the staff''s own%', 'the refusal does not say why: ' || coalesce((pg_temp.qrow(q1)).failure, 'nothing'));
  perform pg_temp.expect(pg_temp.thread_of(q2) is not null and (select count(*) from threads where staff_placed) = before_n + 1, 'the refused part opened a thread, or the second did not');
  perform pg_temp.due(q3);
  perform system_tick();
  perform pg_temp.expect(pg_temp.thread_of(q3) = pg_temp.thread_of(q2), 'the third part did not find the thread the second opened');
end $$;

-- A part that fails inside write_staff_act, after its thread was opened, leaves no orphan thread: the open is inside the part's own block, so the failure takes it back. A trigger plays the failing write.
create function pg_temp.fail_moves() returns trigger language plpgsql as $$
begin
  if current_setting('mt.fail_moves', true) = 'on' and new.kind = 'move' then raise exception 'planted: the move cannot be written' using errcode = '55000'; end if;
  return new;
end $$;
create trigger mt_fail_moves before insert on acts for each row execute function pg_temp.fail_moves();
do $$
declare
  q bigint := pg_temp.queue('renameBoard', pg_temp.rename('Orphan Palace'));
  before_n bigint := (select count(*) from threads where staff_placed);
  ran jsonb;
begin
  perform set_config('mt.fail_moves', 'on', true);
  ran := system_tick();
  perform set_config('mt.fail_moves', 'off', true);
  perform pg_temp.expect((ran ->> 'failed')::integer >= 1 and (pg_temp.qrow(q)).landed_act is null and (pg_temp.qrow(q)).failure like '%planted%', 'the planted failure did not fail the part: ' || ran::text || ' ' || to_jsonb(pg_temp.qrow(q))::text);
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n, 'a part that failed after its thread was opened left ' || ((select count(*) from threads where staff_placed) - before_n) || ' orphan staff threads');
  -- The row is put out of the later ticks' way.
  update queued_moves set refused_at = now() where id = q;
end $$;
drop trigger mt_fail_moves on acts;

-- ---- 4. A handover opens one thread: the farewell, then the arrival; season_news finds the quote there ----
do $$
declare
  open_id bigint := pg_temp.season();
  answer jsonb;
  h record;
  ht uuid;
  before_n bigint := (select count(*) from threads where staff_placed);
  quote text;
begin
  answer := hand_over(open_id, 'mt-boss', now(), true);
  -- The line is owed (0442) and paid from stock here, as the tick's grace pays it.
  perform pay_owed_line(o.owed, null) from lines_owed_open o order by o.owed;
  perform pg_temp.expect(answer ->> 'boss' is distinct from 'mt-boss' and answer ->> 'boss' is not null, 'the handover seated no new Boss: ' || answer::text);
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  ht := h.thread;
  perform pg_temp.expect(ht is not null, 'the handover recorded no thread');
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n + 1, 'the handover opened ' || ((select count(*) from threads where staff_placed) - before_n) || ' threads');
  perform pg_temp.expect((select th.staff_placed and th.board = system_board() from threads th where th.id = ht), 'the handover''s thread is not a staff thread on the system board');
  perform pg_temp.expect((select th.title from threads th where th.id = ht) = 'Handover: ' || (select c.name from characters c where c.staff = answer ->> 'boss') || ' for season ' || (select number from seasons where id = open_id),
    'the handover''s thread is titled ' || (select th.title from threads th where th.id = ht));
  perform pg_temp.expect((select string_agg(a.payload ->> 'body', ' | ' order by a.seq) from acts a where a.thread = ht) = 'Stock farewell from Mt Boss. | Hello from ' || (select c.name from characters c where c.staff = answer ->> 'boss') || '.',
    'the handover''s thread reads ' || (select string_agg(a.payload ->> 'body', ' | ' order by a.seq) from acts a where a.thread = ht));
  perform pg_temp.expect((select a.character from acts a where a.thread = ht and a.seq = 1) = (select c.id from characters c where c.staff = 'mt-boss'), 'the farewell is not the outgoing Boss''s');
  perform pg_temp.expect(h.arrival_act = (select a.id from acts a where a.thread = ht and a.seq = 2), 'the row''s arrival is not the second post');
  perform pg_temp.expect((select count(*) from acts a where a.thread = (select thread from pg_temp.ann)) = 0, 'the handover wrote in the announcements thread');
  select n.quote into quote from season_news(null, 20) n where n.kind = 'bossArrived' and n.thread = ht;
  perform pg_temp.expect(quote = 'Hello from ' || (select c.name from characters c where c.staff = answer ->> 'boss') || '.', 'season_news did not find the arrival in the handover''s thread: ' || coalesce(quote, 'nothing'));
  select n.quote into quote from season_news(null, 20) n where n.kind = 'bossLeft' and n.thread = ht;
  perform pg_temp.expect(quote = 'Stock farewell from Mt Boss.', 'season_news did not find the farewell in the handover''s thread: ' || coalesce(quote, 'nothing'));
end $$;
-- A handover with nothing to say (no stock lines) opens no empty thread and still writes its row.
do $$
declare
  was jsonb := (select value from settings where key = 'systemLines');
  before_n bigint := (select count(*) from threads where staff_placed);
  open_id bigint := pg_temp.season();
  boss text := current_boss();
  h record;
begin
  update settings set value = '{}'::jsonb where key = 'systemLines';
  perform hand_over(open_id, boss, now(), true);
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  perform pg_temp.expect(h.thread is null and (select count(*) from threads where staff_placed) = before_n, 'a handover with nothing to say opened a thread');
  update settings set value = was where key = 'systemLines';
end $$;

-- A handover whose posts all fail (a planted failure of every staff post) opens no thread: none is listed, none is recorded, and nothing a player wrote is touched.
create function pg_temp.fail_posts() returns trigger language plpgsql as $$
begin
  if current_setting('mt.fail_posts', true) = 'on' and new.kind = 'post' then raise exception 'planted: the post cannot be written' using errcode = '55000'; end if;
  return new;
end $$;
create trigger mt_fail_posts before insert on acts for each row execute function pg_temp.fail_posts();
do $$
declare
  before_n bigint := (select count(*) from threads where staff_placed);
  before_all bigint := (select count(*) from threads);
  open_id bigint := pg_temp.season();
  boss text := current_boss();
  h record;
begin
  perform set_config('mt.fail_posts', 'on', true);
  perform hand_over(open_id, boss, now(), true);
  perform set_config('mt.fail_posts', 'off', true);
  select * into h from season_handovers x where x.season = open_id order by x.id desc limit 1;
  perform pg_temp.expect(h.boss is not null and h.boss is distinct from boss, 'the handover did not seat a new Boss');
  perform pg_temp.expect(h.thread is null and h.arrival_act is null, 'a handover whose posts failed recorded a thread: ' || coalesce(h.thread::text, 'none'));
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n and (select count(*) from threads) = before_all, 'a handover whose posts failed left an empty staff thread');
end $$;
drop trigger mt_fail_posts on acts;

-- ---- 5. An admin's description of a board with no rename in force opens a thread; with a rename in force it is written in the rename's thread ----
do $$
declare
  b uuid := pg_temp.board('general');
  before_n bigint := (select count(*) from threads where staff_placed);
  answer jsonb;
  t uuid;
  boss text := current_boss();
  q bigint;
  rename_act uuid;
begin
  -- The renames above were reversed or are still in force; end any in force on `general` so the description names no move.
  perform end_move(o.move_act, 'reversed', 'test') from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'renameBoard' and a.payload #>> '{params,board}' = b::text;
  perform tests.become(pg_temp.admin());
  answer := describe_board(b, 'Plain words from an admin.');
  perform tests.unbecome();
  perform pg_temp.expect(answer ->> 'move_act' is null, 'the description named a move');
  t := (select a.thread from acts a where a.id = (answer ->> 'act')::uuid);
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n + 1 and (select th.staff_placed from threads th where th.id = t), 'the description did not open a staff thread');
  perform pg_temp.expect((select string_agg(a.kind, ',' order by a.seq) from acts a where a.thread = t) = 'post,describe', 'the description''s thread holds ' || (select string_agg(a.kind, ',' order by a.seq) from acts a where a.thread = t));
  perform pg_temp.expect((select a.payload ->> 'body' from acts a where a.thread = t and a.seq = 1) = (select c.name from characters c where c.staff = boss) || ' has described ' || (select name from boards_now where id = b) || '.', 'the first post is not the stock line: ' || (select a.payload ->> 'body' from acts a where a.thread = t and a.seq = 1));
  perform pg_temp.expect((select a.character from acts a where a.thread = t and a.seq = 1) = (select c.id from characters c where c.staff = boss), 'the first post is not the Boss''s');
  perform pg_temp.expect((select th.title from threads th where th.id = t) like 'Renamed: %', 'the description''s thread is titled ' || (select th.title from threads th where th.id = t));
  perform pg_temp.expect((select description from boards_now where id = b) = 'Plain words from an admin.', 'the description did not take');
  -- With a rename in force it is written in the rename's own thread, and opens none.
  q := pg_temp.queue('renameBoard', pg_temp.rename('Described Palace'));
  perform system_tick();
  rename_act := (pg_temp.qrow(q)).landed_act;
  perform pg_temp.expect(rename_act is not null, 'the rename did not land');
  before_n := (select count(*) from threads where staff_placed);
  perform tests.become(pg_temp.admin());
  answer := describe_board(b, 'Words beside the rename.');
  perform tests.unbecome();
  perform pg_temp.expect((answer ->> 'move_act')::uuid = rename_act and (select a.thread from acts a where a.id = (answer ->> 'act')::uuid) = pg_temp.thread_of(q) and (select count(*) from threads where staff_placed) = before_n,
    'a description beside a rename did not follow it into its thread');
  perform pg_temp.expect((select count(*) from acts a where a.thread = (select thread from pg_temp.ann)) = 0, 'a description wrote in the announcements thread');
end $$;

-- With no Boss seated, a description that needs a thread refuses, and says plainly how an admin seats one (the seed's firstBoss, or the next handover); nothing is written.
do $$
declare
  b uuid := pg_temp.board('mt-dest');
  was text := current_boss();
  said text;
  before_n bigint := (select count(*) from threads where staff_placed);
begin
  update seasons set boss = null where ends_at is null;
  said := pg_temp.refusal(format('select write_describe(%L::uuid, %L, null)', b, 'Words for no one.'));
  update seasons set boss = was where ends_at is null;
  perform pg_temp.expect(said like '55000:%no Boss%', 'the description with no Boss did not refuse: ' || coalesce(said, 'it did not'));
  perform pg_temp.expect(said like '%firstBoss%' and said like '%handover%', 'the refusal names no way to seat a Boss: ' || said);
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n, 'a refused description opened a thread');
end $$;

-- ---- 6. The flag: the placements carry every staff thread, the settings' and seasons' threads still follow it, and a moveThread naming a staff thread is refused ----
do $$
declare
  staff_t uuid;
  other_board uuid;
  was_system uuid := system_board();
  said text;
  ordinary uuid := pg_temp.mkthread('Ordinary', 'general');
  n bigint;
  defs text;
begin
  select th.id into staff_t from threads th where th.staff_placed order by th.created_at limit 1;
  -- Every staff thread is in system_threads() and none is in the small set; system_thread_rows() holds none that is stored on the system board (the seed has nothing to do for it).
  perform pg_temp.expect((select count(*) from system_threads() r where r in (select id from threads where staff_placed)) = (select count(*) from threads where staff_placed), 'system_threads misses a staff thread');
  perform pg_temp.expect(not exists (select 1 from system_thread_rows() r where r.id in (select id from threads where staff_placed) and r.board = system_board()), 'system_thread_rows holds a staff thread already on the system board');
  perform pg_temp.expect(not exists (select 1 from instance_threads() i where i in (select id from threads where staff_placed)), 'the small set holds a staff thread');
  -- A few thousand staff threads, flagged as the writer flags them: nothing about the answers changes, and the definitions read the flag, not a set.
  insert into threads (board, title, staff_placed) select was_system, 'Bulk ' || g, true from generate_series(1, 3000) g;
  select count(*) into n from threads where staff_placed;
  perform pg_temp.expect(n >= 3000, 'the bulk staff threads were not made');
  select string_agg(pg_get_functiondef(p.oid), ' ') into defs from pg_proc p where p.proname in ('thread_place', 'thread_places_computed', 'lasting_move_problem') and p.pronamespace = 'public'::regnamespace;
  perform pg_temp.expect(defs like '%staff_placed%' and defs not like '%system_threads()%', 'the placements do not read the flag, or read the whole set of the staff''s threads');
  -- The flag moves to another board: both placements carry every staff thread (bulk ones too) and no ordinary thread.
  insert into boards (slug, name) values ('mt-other', 'Other');
  other_board := pg_temp.board('mt-other');
  update boards set is_system = false where is_system;
  update boards set is_system = true where id = other_board;
  perform pg_temp.expect(thread_place(staff_t) = other_board, 'thread_place did not carry a staff thread with the flag');
  perform pg_temp.expect((select count(*) from thread_places_computed() c join threads t on t.id = c.thread where t.staff_placed and c.place is distinct from other_board) = 0, 'thread_places_computed left a staff thread behind');
  perform pg_temp.expect(thread_place(ordinary) = pg_temp.board('general') and (select c.place from thread_places_computed() c where c.thread = ordinary) = pg_temp.board('general'), 'an ordinary thread followed the flag');
  perform pg_temp.expect(thread_place((select thread from pg_temp.ann)) = other_board, 'the announcements thread did not follow the flag');
  -- The rebuild places them (the seed's own call), and nothing drifts.
  perform rebuild_thread_places((select array_agg(r.id) from system_thread_rows() r where r.board is distinct from other_board));
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after the rebuild: ' || (select count(*) from thread_places_drift()));
  perform pg_temp.expect(not exists (select 1 from threads t where t.staff_placed and t.board is distinct from other_board), 'a staff thread is stored off the system board');
  -- A moveThread naming a staff thread is refused, by the one function every lasting move reads, whether or not its stored board is the system board.
  said := lasting_move_problem('moveThread', jsonb_build_object('thread', staff_t, 'board', pg_temp.board('general')));
  perform pg_temp.expect(said is not null, 'a moveThread naming a staff thread was allowed');
  perform pg_temp.expect(lasting_move_problem('moveThread', jsonb_build_object('thread', ordinary, 'board', pg_temp.board('elsewhere'))) is distinct from said, 'an ordinary thread was refused as a staff thread is');
  -- The flag goes back.
  update boards set is_system = false where is_system;
  update boards set is_system = true where id = was_system;
  perform rebuild_thread_places((select array_agg(r.id) from system_thread_rows() r where r.board is distinct from was_system));
  perform pg_temp.expect(not exists (select 1 from thread_places_drift()), 'drift after the flag went back');
end $$;

-- ---- 7. A staff thread is counted as thread_list lists it ----
do $$
declare
  sys uuid := system_board();
  counted_before bigint := pg_temp.counted(sys);
  listed_before bigint := pg_temp.listed(sys);
  q bigint;
begin
  q := pg_temp.queue('renameBoard', pg_temp.rename('Counted Corner'));
  perform system_tick();
  perform pg_temp.expect(pg_temp.thread_of(q) is not null, 'the move did not land');
  perform pg_temp.expect(pg_temp.listed(sys) = listed_before + 1, 'the system board''s list did not gain the move''s thread');
  perform pg_temp.expect(pg_temp.counted(sys) = counted_before + 1, 'the system board''s count did not follow its list: ' || counted_before || ' to ' || pg_temp.counted(sys));
  perform pg_temp.expect(pg_temp.counted(sys) - pg_temp.listed(sys) = counted_before - listed_before, 'the system board''s count and list drifted apart');
end $$;

-- ---- 8. With The System off, nothing lands ----
do $$
declare
  q bigint := pg_temp.queue('renameBoard', pg_temp.rename('Off Office'));
  before_n bigint := (select count(*) from threads where staff_placed);
  ran jsonb;
begin
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  ran := system_tick();
  perform pg_temp.expect((ran ->> 'landed')::integer = 0 and (pg_temp.qrow(q)).landed_act is null, 'a move landed while The System was off: ' || ran::text);
  perform pg_temp.expect((select count(*) from threads where staff_placed) = before_n, 'a thread was opened while The System was off');
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
  ran := system_tick();
  perform pg_temp.expect((pg_temp.qrow(q)).landed_act is not null, 'the move did not land once The System was on again');
end $$;

-- ---- 9. The pieces are not a client's ----
do $$
begin
  perform pg_temp.expect(not has_function_privilege('authenticated', 'open_staff_thread(text, text)', 'execute') and not has_function_privilege('anon', 'open_staff_thread(text, text)', 'execute')
    and has_function_privilege('service_role', 'open_staff_thread(text, text)', 'execute'), 'open_staff_thread is executable by the wrong roles');
  perform pg_temp.expect(not has_function_privilege('authenticated', 'move_thread_title(text, jsonb, text)', 'execute') and not has_function_privilege('authenticated', 'say_in_thread(text, text, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'say_farewell(text, bigint, boolean, uuid)', 'execute'), 'a title or a thread writer is executable by a client');
  perform pg_temp.expect(to_regprocedure('say_in_announcements(text, text)') is null, 'say_in_announcements is still there');
end $$;

-- ---- 10. A title takes its move's own parameters, as its words do (Task 8): a board made is named in its thread's title ----
do $$
begin
  update settings set value = value || '{"createBoard": "New board: {name}", "awardTrophy": "{trophyName} goes to {characterName}"}'::jsonb where key = 'systemThreadTitles';
  perform pg_temp.expect(move_thread_title('createBoard', '{"name": "Lodge"}'::jsonb, 'mt-boss') = 'New board: Lodge',
    'a title fills its move''s parameters: ' || coalesce(move_thread_title('createBoard', '{"name": "Lodge"}'::jsonb, 'mt-boss'), 'null'));
end $$;

-- ---- 11. Divided World's own eleven titles, rendered through their moves' parameters, leave no token unfilled (the Task 8 spec review) ----
-- The titles are copied from instances/divided-world/system/index.ts's threadTitles; each kind gets the parameters its move carries, and the values it names must show in the words.
do $$
declare
  titles jsonb := jsonb_build_object(
    'renameBoard', '{board} is now {name}', 'nameSuccessor', 'On the matter of succession', 'setRule', 'New rule in {board}', 'conferGroup', 'Welcome to {groupName}',
    'pullSlot', 'Machine notice: a card is pulled', 'repriceSlot', 'Machine notice: new prices', 'flashSale', 'Flash sale!', 'createBoard', 'New board: {name}',
    'moveThread', 'A thread moves to {board}', 'mergeBoard', '{board} is closing', 'awardTrophy', '{trophyName} goes to {characterName}');
  b text := (select name from boards_now where id = pg_temp.board('general'));
  gen text := pg_temp.board('general')::text;
  wants jsonb := jsonb_build_object(
    'renameBoard', jsonb_build_array(b, 'Lodge'), 'nameSuccessor', jsonb_build_array('succession'), 'setRule', jsonb_build_array(b), 'conferGroup', jsonb_build_array('Knights'),
    'pullSlot', jsonb_build_array('card is pulled'), 'repriceSlot', jsonb_build_array('new prices'), 'flashSale', jsonb_build_array('Flash sale'), 'createBoard', jsonb_build_array('Lodge'),
    'moveThread', jsonb_build_array(b), 'mergeBoard', jsonb_build_array(b), 'awardTrophy', jsonb_build_array('Golden Mop', 'Mt Boss'));
  paramsets jsonb := jsonb_build_object(
    'renameBoard', jsonb_build_object('board', gen, 'name', 'Lodge'), 'nameSuccessor', jsonb_build_object('successor', 'mt-mod'),
    'setRule', jsonb_build_object('board', gen, 'predicate', 'maxLength', 'param', '100'), 'conferGroup', jsonb_build_object('group', 'knights', 'groupName', 'Knights'),
    'pullSlot', jsonb_build_object('slot', 'one'), 'repriceSlot', jsonb_build_object('slot', 'one', 'percent', 5), 'flashSale', jsonb_build_object('slot', 'one', 'hours', 6),
    'createBoard', jsonb_build_object('name', 'Lodge'), 'moveThread', jsonb_build_object('thread', gen, 'board', gen), 'mergeBoard', jsonb_build_object('board', gen, 'into', gen),
    'awardTrophy', jsonb_build_object('trophy', 'mop', 'trophyName', 'Golden Mop', 'character', 'mt-boss', 'characterName', 'Mt Boss'));
  k text;
  w text;
  said text;
begin
  update settings set value = titles where key = 'systemThreadTitles';
  perform pg_temp.expect((select count(*) from jsonb_object_keys(titles)) = 11, 'the test does not hold the eleven titles');
  for k in select jsonb_object_keys(titles) loop
    said := move_thread_title(k, paramsets -> k, 'mt-boss');
    perform pg_temp.expect(said is not null and said not like '%{%' and said not like '%}%', 'the title of ' || k || ' has a token left unfilled: ' || coalesce(said, 'null'));
    for w in select jsonb_array_elements_text(wants -> k) loop
      perform pg_temp.expect(position(w in said) > 0, 'the title of ' || k || ' does not show "' || w || '": ' || said);
    end loop;
  end loop;
end $$;

-- ---- 12. A number or a boolean param fills a title as its digits or its word, and a param left out leaves nothing the test did not ask for ----
do $$
declare said text;
begin
  update settings set value = '{"repriceSlot": "Prices cut {percent}%", "flashSale": "Flash sale for {hours} hours: {slot}", "pullSlot": "Pulled {on}"}'::jsonb where key = 'systemThreadTitles';
  said := move_thread_title('repriceSlot', '{"slot": "one", "percent": 25}'::jsonb, 'mt-boss');
  perform pg_temp.expect(said = 'Prices cut 25%', 'a number fills a title as its digits: ' || coalesce(said, 'null'));
  said := move_thread_title('repriceSlot', '{"slot": "one", "percent": 12.5}'::jsonb, 'mt-boss');
  perform pg_temp.expect(said = 'Prices cut 12.5%', 'a fraction fills as written: ' || coalesce(said, 'null'));
  said := move_thread_title('flashSale', '{"slot": "one", "hours": 6}'::jsonb, 'mt-boss');
  perform pg_temp.expect(said like 'Flash sale for 6 hours: %', 'the number is filled: ' || coalesce(said, 'null'));
  said := move_thread_title('pullSlot', '{"slot": "one", "on": true}'::jsonb, 'mt-boss');
  perform pg_temp.expect(said = 'Pulled true', 'a boolean fills as its word: ' || coalesce(said, 'null'));
end $$;
