-- A Mod's moveThread (supabase/migrations/0424_staff_requests.sql, section 1; docs/plans/2026-11-24-staff-requests-plan.md, Task 1; design section 2).
--
-- 1. move_kinds.offices for moveThread is boss and mod once the migration has run, and a Mod's moveThread on beat (its thread's board and the board it goes to both on the Mod's beat) queues with no expiry and spends one of the allowance.
-- 2. Each board off the beat is refused with its words: the thread's board names the source, the target names the destination. A refusal spends nothing.
-- 3. A Mod's move cannot stay on a thread it is not given: a thread that does not exist is refused.
-- 4. The Boss's moveThread is as it was: queued by the guard without a beat check.
--
-- Section 2 (Task 3: the tables, the writes and the reads).
-- 5. staff_requests and staff_request_rulings: RLS on, no client's grants, an UPDATE, a DELETE and a TRUNCATE refused on both, and the view reads each request's latest ruling and, while waiting, when it lapses.
--    The queue (staff_requests_open): a confer joins it, a ruling takes it out in the same transaction, a reject never joins it; RLS on and no client's grant.
-- 6. apply_boss_move: its refusals, one debit however often a cause is retried (also with the bank empty, which only the early lookup of the cause answers), a structural move held for admins, the bank's weekly accrual
--    counted, the locks a meeting also takes held before the bank is read, and a moveThread to the board its thread is on refused with its words and no debit.
-- 7. rule_request: its refusals; a reject, a confer and a Mod's fulfill written once and replayed as written; a fulfill the guard refuses is a confer with the reason, the same whoever asked; a Boss's fulfill debits once.
-- 8. requests_waiting: oldest first, bounded, whole bodies, a hidden post and a ruled request left out.
-- 8b. What waits is read from the queue and not from the history: with many ruled requests behind, requests_waiting and the tick read a bounded number of rows of the record tables.
-- 9. requests_ruled: a meeting's answers, the bank's room, a refused fulfill as a reject with its reason, a request ruled once.
-- 10. system_tick lapses a waiting request at lapses_at and not a minute before, writes one reply, lapses a hidden request with no reply, and lapses with no reply while The System is off.
-- 10b. A request the tick cannot lapse goes behind the others, so one that keeps failing never holds the pass's one slot from the rest, and lapses when it can.
-- 11. The setting staffRequests and its poisons.
-- 11b. requests_waiting is owned by the digest role, which reads no private column of the request tables.
--
-- Section 2b (Task 4: the turn's call record).
-- 12. record_staff_call keeps a `ruling` duty keyed by a post, a second one is the next attempt, and a duty outside the list is still refused.
-- 13. The Boss's turn holds kinds back by the season it is now, not the one its latest meeting was held in.
-- 14. write_staff_turn writes the turn's ruling in its own transaction: post and request together; a refused ruling leaves the post and returns the refusal; a replay writes neither a second post nor a second request; a turn
--     rolled back after the post leaves neither; a turn with no ruling is as it was.
--
-- Section 4 (Task 7: the moderation log).
-- 15. moves_log lists a request for the staff member that ruled on it and for no other: its thread, its title, the request post's number, the first ruling, the office that ruled and the move's kind, and how a request
--     passed on ended (waiting with its lapse date, ruled by a meeting, lapsed); a Mod's confer and the Boss's are told apart; the row names no asker and nothing private.

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

create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'mm-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

create function pg_temp.memory(hobby text) returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;

create function pg_temp.order_for(mod text, boards jsonb, allowance integer, line text default null) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', boards, 'order', coalesce(line, 'Watch ' || mod || '''s boards.'), 'allowance', allowance, 'memory', pg_temp.memory('hobby of ' || mod))
$$;

create function pg_temp.meet(at text, orders jsonb) returns bigint language plpgsql as $$
declare m bigint := (begin_meeting(at::timestamptz) ->> 'meeting')::bigint;
begin
  perform apply_meeting(m, jsonb_build_object('boss', 'mm-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'orders', orders, 'record', '{}'::jsonb));
  return m;
end $$;

create function pg_temp.mv(board uuid, hours numeric default 48, predicate text default 'noAllCaps', why text default 'Shouting.') returns jsonb language sql as $$
  select jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', board, 'predicate', predicate, 'param', case when predicate = 'bannedWord' then to_jsonb('zzz'::text) else null end, 'band', 'minor'), 'expires_in_hours', hours, 'why', why)
$$;

-- ---- 0. The world: a Boss, two Mods on staff, a member, three boards, a thread with posts to be the causes ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule', 'moveThread', 'the moving of a thread to another board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mm-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'mm-boss', 'name', 'Move Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'mm-m1', 'name', 'Move Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', jsonb_build_array('mm-games')),
        jsonb_build_object('key', 'mm-m2', 'name', 'Move Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'mm-m3', 'name', 'Move Member Three', 'title', 'Member', 'signature', 'Hi', 'beats', jsonb_build_array('mm-games'))),
      'firstStaff', jsonb_build_array('mm-m1', 'mm-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
        jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  update characters set debuted_at = now() where staff = 'mm-m3';
  insert into staff_offices (staff, office, cause) values ('mm-m3', 'member', 'admin');
  insert into boards (slug, name, description) values ('mm-games', 'Games', 'Talk about games.'), ('mm-general', 'General', 'Talk about anything.'), ('mm-offtopic', 'Off Topic', 'Wander.');
  insert into move_bank (staff, balance, as_of) values ('mm-boss', 20, now());
  perform tests.account('mm-ann');
  perform tests.character((select id from auth.users where email = 'mm-ann@test.invalid'), 'Mm Poster');
  -- Mod One watches Games and may spend 2; Mod Two watches General and may spend 1.
  perform pg_temp.meet('2031-02-01T09:00:00Z', jsonb_build_array(
    pg_temp.order_for('mm-m1', jsonb_build_array(pg_temp.board('mm-games'), pg_temp.board('mm-offtopic')), 3, 'Crack down on bumping in Games.'),
    pg_temp.order_for('mm-m2', jsonb_build_array(pg_temp.board('mm-general')), 1)));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'mm-ann@test.invalid' $$;
-- A fresh post of a player's, to be a cause (any Act is one).
create function pg_temp.poster() returns uuid language sql as $$ select id from characters where name = 'Mm Poster' $$;
create function pg_temp.cause(label text) returns uuid language sql as $$
  select tests.post(pg_temp.poster(), tests.thread('Cause ' || label), 'A post.')
$$;

create function pg_temp.visit(staff text, post uuid, ends timestamptz, rule text default 'Rule 1: no all-caps posts') returns uuid language plpgsql as $$
declare t uuid := (select thread from acts where id = post);
begin
  return (write_staff_act(staff, 'visit', t, post, jsonb_build_object(
    'charges', jsonb_build_array(jsonb_build_object('rule', rule, 'rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', post::text)),
    'ends_at', ends, 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.')) ->> 'id')::uuid;
end $$;


create function pg_temp.thread_on(slug text, title text) returns uuid language sql as $$
  insert into threads (board, title) select b.id, title from boards b where b.slug = thread_on.slug returning id
$$;

create function pg_temp.mt(thread uuid, board uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', thread, 'board', board), 'expires_in_hours', 0, 'why', 'It belongs there.')
$$;

-- ---- 0b. The migration's own update changes an instance seeded before it ----
-- seed_instance writes offices from the catalog, so the world above already has boss and mod and would hide a migration that lost its `update move_kinds`. An instance seeded earlier has the Boss's alone: put that row back, then run the migration's update again from the file, and the row must be the Mod's too.
-- Only the lines between the migration's `-- begin: moveThread offices` and `-- end: moveThread offices` markers are replayed, and not the whole file: later sections of the migration create tables and would fail a second run, while this statement is the one that is safe to repeat. Delete the update from the migration and the extraction is empty, and the check below goes red.
-- The path is relative to the directory the suite runs from, the repository root (tools/test-sql.mjs); the extract goes to the system temp directory.
update move_kinds set offices = array['boss'] where key = 'moveThread';
do $$ begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss'] then raise exception 'the pre-0424 row was not set back'; end if;
end $$;
\set offices_file `echo "${TMPDIR:-/tmp}/kayfabb-0424-section-1-offices.sql"`
\set extracted `sed -n '/^-- begin: moveThread offices/,/^-- end: moveThread offices/p' supabase/migrations/0424_staff_requests.sql > "${TMPDIR:-/tmp}/kayfabb-0424-section-1-offices.sql"`
\i :offices_file
do $$ begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss', 'mod'] then raise exception 'the migration did not make moveThread a Mod''s: %', (select offices from move_kinds where key = 'moveThread'); end if;
end $$;

-- ---- 1. A Mod's moveThread on beat queues with no expiry and spends one ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  offtopic uuid := pg_temp.board('mm-offtopic');
  t uuid := pg_temp.thread_on('mm-games', 'Mt Wrong board');
  cause uuid := pg_temp.cause('mt1');
  got jsonb;
  q queued_moves%rowtype;
begin
  if (select offices from move_kinds where key = 'moveThread') is distinct from array['boss', 'mod'] then raise exception 'moveThread is not the Boss''s and a Mod''s: %', (select offices from move_kinds where key = 'moveThread'); end if;
  if mod_allowance('mm-m1') is distinct from 3 then raise exception 'the world: mm-m1 holds %', mod_allowance('mm-m1'); end if;
  got := apply_mod_move('mm-m1', pg_temp.mt(t, offtopic), cause);
  if got ->> 'move' is null or (got ->> 'queued')::boolean is distinct from true then raise exception 'a Mod''s moveThread on beat was not queued: %', got; end if;
  if got ->> 'trimmed' is not null then raise exception 'a lasting move was clamped to an expiry: %', got; end if;
  select * into q from queued_moves where id = (got ->> 'move')::bigint;
  if q.kind is distinct from 'moveThread' or q.staff is distinct from 'mm-m1' or q.expires_at is not null then raise exception 'the queued row is wrong (it keeps an expiry): %', to_jsonb(q); end if;
  if q.params ->> 'thread' is distinct from t::text or q.params ->> 'board' is distinct from offtopic::text then raise exception 'the params: %', to_jsonb(q); end if;
  if mod_allowance('mm-m1') is distinct from 2 then raise exception 'queueing did not spend one allowance: %', mod_allowance('mm-m1'); end if;
end $$;

-- ---- 2. Each board off the beat is refused with its words ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  general uuid := pg_temp.board('mm-general');
  offtopic uuid := pg_temp.board('mm-offtopic');
  on_games uuid := pg_temp.thread_on('mm-games', 'Mt Games thread');
  on_general uuid := pg_temp.thread_on('mm-general', 'Mt General thread');
  c2 uuid := pg_temp.cause('mt2');
  before_n bigint := (select count(*) from queued_moves);
  msg text;
  got jsonb;
begin
  -- The thread is on General (Mod Two's): the source is off Mod One's beat, though the target is on it.
  got := apply_mod_move('mm-m1', pg_temp.mt(on_general, offtopic), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null or got ->> 'reason' not like '%thread%board%' or got ->> 'reason' not like '%beat%' then raise exception 'a source off the beat was not refused with its words: %', got; end if;
  -- The thread is on Games, the target is General (Mod Two's): the destination is off the beat.
  got := apply_mod_move('mm-m1', pg_temp.mt(on_games, general), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null or got ->> 'reason' not like '%board it goes to%' or got ->> 'reason' not like '%beat%' then raise exception 'a target off the beat was not refused with its words: %', got; end if;
  -- The two refusals name which board: they differ.
  if apply_mod_move('mm-m1', pg_temp.mt(on_general, offtopic), c2) ->> 'reason' is not distinct from apply_mod_move('mm-m1', pg_temp.mt(on_games, general), c2) ->> 'reason' then raise exception 'the two refusals say the same thing'; end if;
  -- A thread that does not exist is refused too.
  got := apply_mod_move('mm-m1', pg_temp.mt(gen_random_uuid(), offtopic), c2);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a move of no thread was queued: %', got; end if;
  if (select count(*) from queued_moves) is distinct from before_n then raise exception 'a refusal wrote a row'; end if;
  if mod_allowance('mm-m1') is distinct from 2 then raise exception 'refusals spent the allowance: %', mod_allowance('mm-m1'); end if;
end $$;

-- ---- 3. The Boss's moveThread is as it was: no beat, no allowance ----
do $$
declare
  general uuid := pg_temp.board('mm-general');
  t uuid := pg_temp.thread_on('mm-games', 'Mt Boss moves this');
  m bigint := (select max(id) from meetings);
  q bigint;
  q2 bigint;
  nobody uuid;
begin
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mm-boss', 'moveThread', jsonb_build_object('thread', t, 'board', general), null, 'The Boss decides.', now(), now() + interval '48 hours', false) returning id into q;
  if (select expires_at from queued_moves where id = q) is not null then raise exception 'the Boss''s lasting move kept an expiry'; end if;
  if (select spent_order from queued_moves where id = q) is not null then raise exception 'the Boss''s move spent a Mod''s order'; end if;
  -- The beat check is a Mod's alone: the Boss's moveThread to a board no Mod's beat holds (Off Topic is Mod One's, so a fresh board is on nobody's) queues too.
  insert into boards (slug, name, description) values ('mm-nobody', 'Nobody''s', 'On no beat.') returning id into nobody;
  if exists (select 1 from staff_orders o where nobody = any (o.boards)) then raise exception 'the world: a Mod watches the new board'; end if;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mm-boss', 'moveThread', jsonb_build_object('thread', t, 'board', nobody), null, 'The Boss decides again.', now(), null, false) returning id into q2;
  if (select staff from queued_moves where id = q2) is distinct from 'mm-boss' then raise exception 'the Boss''s moveThread off every beat was not queued'; end if;
end $$;

-- ---- 4. A refused no-op, a replay of a lasting move, and a rule's clamp after the re-create ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  offtopic uuid := pg_temp.board('mm-offtopic');
  t uuid := pg_temp.thread_on('mm-games', 'Mt No-op and replay');
  c1 uuid := pg_temp.cause('mt4a');
  c2 uuid := pg_temp.cause('mt4b');
  c3 uuid := pg_temp.cause('mt4c');
  start_n integer := mod_allowance('mm-m1');
  before_n bigint := (select count(*) from queued_moves);
  first_try jsonb;
  again jsonb;
  ruled jsonb;
begin
  if start_n is distinct from 2 then raise exception 'the world: mm-m1 holds %', start_n; end if;
  -- A move to the board the thread is on is refused in plain words and spends nothing.
  again := apply_mod_move('mm-m1', pg_temp.mt(t, games), c1);
  if again ->> 'move' is not null or again ->> 'reason' is distinct from 'the thread is already on that board' then raise exception 'a move to the thread''s own board was not refused plainly: %', again; end if;
  if (select count(*) from queued_moves) is distinct from before_n or mod_allowance('mm-m1') is distinct from start_n then raise exception 'the no-op refusal wrote a row or spent the allowance'; end if;
  -- The same cause replayed for a lasting kind returns the first row, and the allowance is spent once.
  first_try := apply_mod_move('mm-m1', pg_temp.mt(t, offtopic), c2);
  again := apply_mod_move('mm-m1', pg_temp.mt(t, offtopic), c2);
  if (first_try ->> 'queued')::boolean is not true then raise exception 'the first move was not queued: %', first_try; end if;
  if (again ->> 'existing')::boolean is not true or (again ->> 'queued')::boolean is not false or again ->> 'move' is distinct from first_try ->> 'move' then raise exception 'the replay did not return the first row: % then %', first_try, again; end if;
  if mod_allowance('mm-m1') is distinct from start_n - 1 then raise exception 'a replayed lasting move spent more than once: %', mod_allowance('mm-m1'); end if;
  -- setRule still clamps its expiry (rules last at most ruleDaysMost = 7 days) beside the lasting branch.
  ruled := apply_mod_move('mm-m1', pg_temp.mv(games, 9999), c3);
  if (ruled ->> 'queued')::boolean is not true or (ruled #>> '{trimmed,expires_in_hours,after}')::numeric is distinct from 168 then raise exception 'setRule was not clamped to 168 hours: %', ruled; end if;
  if (select expires_at - go_live_at from queued_moves where id = (ruled ->> 'move')::bigint) is distinct from interval '168 hours' then raise exception 'the clamped rule kept the wrong expiry'; end if;
end $$;

-- =====================================================================================================================
-- Section 2 (Task 3)
-- =====================================================================================================================

-- A staff member's scene: a thread on a board, the persona's own post, a player's reply to it (the request post) and the persona's turn answering that reply. Returns the three ids.
create function pg_temp.scene(staff text, slug text, label text, asker uuid default null) returns jsonb language plpgsql as $$
declare
  t uuid := pg_temp.thread_on(slug, 'Req ' || label);
  who uuid := coalesce(asker, pg_temp.poster());
  p0 uuid;
  r uuid;
  tn uuid;
begin
  p0 := (write_staff_act(staff, 'post', t, null, jsonb_build_object('body', 'Staff opener ' || label)) ->> 'id')::uuid;
  r := tests.act(who, 'post', t, jsonb_build_object('body', 'Please move this thread ' || label), p0);
  tn := (write_staff_act(staff, 'post', t, r, jsonb_build_object('body', 'Turn reply ' || label)) ->> 'id')::uuid;
  return jsonb_build_object('thread', t, 'request', r, 'turn', tn);
end $$;

-- Whether this transaction holds the advisory lock a key names.
create function pg_temp.holds(key text) returns boolean language plpgsql as $$
declare k bigint := hashtextextended(key, 0);
begin
  return exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
    and l.classid::bigint = ((k >> 32) & 4294967295) and l.objid::bigint = (k & 4294967295) and l.objsubid = 1);
end $$;

create function pg_temp.bank(n numeric, ago interval default interval '0') returns void language plpgsql as $$
begin
  update move_bank set balance = n, as_of = now() - ago where staff = 'mm-boss';
end $$;

-- ---- 5. The world for Task 3, and the tables ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  seen text;
begin
  perform tests.account('mm-bob');
  perform tests.character((select id from auth.users where email = 'mm-bob@test.invalid'), 'Mm Asker Two');
  update settings set value = value || jsonb_build_object('requestLapsed', jsonb_build_array('{boss} says to {asker}: that request lapsed.')) where key = 'systemLines';
  insert into settings (key, value) values ('staffRequests', '{"daysMost": 3, "meetingMost": 10}') on conflict (key) do update set value = excluded.value;
  -- Fresh orders: Mod One watches Games and Off Topic with 3 to spend, Mod Two watches General with 2.
  perform pg_temp.meet('2031-02-08T09:00:00Z', jsonb_build_array(
    pg_temp.order_for('mm-m1', jsonb_build_array(games, pg_temp.board('mm-offtopic')), 3),
    pg_temp.order_for('mm-m2', jsonb_build_array(pg_temp.board('mm-general')), 2)));
  if mod_allowance('mm-m1') is distinct from 3 or mod_allowance('mm-m2') is distinct from 2 then raise exception 'the world: allowances % and %', mod_allowance('mm-m1'), mod_allowance('mm-m2'); end if;

  if (select count(*) from pg_class where relname in ('staff_requests', 'staff_request_rulings', 'staff_requests_open') and relrowsecurity) is distinct from 3 then raise exception 'a table has no RLS'; end if;
  if has_table_privilege('authenticated', 'staff_requests', 'select') or has_table_privilege('anon', 'staff_request_rulings', 'select')
     or has_table_privilege('authenticated', 'staff_requests_now', 'select') or has_table_privilege('authenticated', 'staff_requests_open', 'select')
     or has_table_privilege('anon', 'staff_requests_open', 'insert') then raise exception 'a client role reads a request table'; end if;
end $$;

do $$
declare
  sc jsonb := pg_temp.scene('mm-m1', 'mm-games', 'append');
  rid bigint;
  rid2 bigint;
  seen text;
  stmt text;
begin
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office)
  values ((sc ->> 'request')::uuid, (sc ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (sc ->> 'turn')::uuid, 'confer', 'mod') returning id into rid;
  if not exists (select 1 from staff_requests_open where request = rid) then raise exception 'a confer did not join the queue of what waits'; end if;
  insert into staff_request_rulings (request, ruling) values (rid, 'lapsed');
  if exists (select 1 from staff_requests_open where request = rid) then raise exception 'a ruled request is still in the queue of what waits'; end if;
  foreach stmt in array array[
    'update staff_requests set ruling = ''reject''', 'delete from staff_requests', 'truncate staff_requests',
    'update staff_request_rulings set ruling = ''reject''', 'delete from staff_request_rulings', 'truncate staff_request_rulings'] loop
    seen := pg_temp.refusal(stmt);
    if seen is null or (seen not like '%never edited or removed%' and stmt <> 'truncate staff_requests') then raise exception '% was not refused by the append-only guard: %', stmt, seen; end if;
  end loop;
  -- A request is ruled on once, and a ruling is one of the three words.
  seen := pg_temp.refusal(format('insert into staff_request_rulings (request, ruling) values (%s, %L)', rid, 'reject'));
  if seen is null or seen not like '23505%' then raise exception 'a second ruling on a request was not refused by its key: %', seen; end if;
  seen := pg_temp.refusal(format('insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (%L, %L, %L, %L, %L, %L, %L)',
    sc ->> 'request', sc ->> 'thread', pg_temp.poster(), 'mm-m1', sc ->> 'turn', 'grant', 'mod'));
  if seen is null or seen not like '23514%' then raise exception 'a ruling outside fulfill, reject and confer was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (%L, %L, %L, %L, %L, %L, %L)',
    sc ->> 'request', sc ->> 'thread', pg_temp.poster(), 'mm-m1', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '23505%' then raise exception 'a second row for one (staff, request) was not refused by its key: %', seen; end if;
  seen := pg_temp.refusal(format('insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values (%L, %L, %L, %L, %L, %L, %L)',
    sc ->> 'request', sc ->> 'thread', pg_temp.poster(), 'mm-m1', sc ->> 'turn', 'reject', 'member'));
  if seen is null or seen not like '23514%' then raise exception 'an office other than boss or mod was not refused: %', seen; end if;
  -- A later ruling is for a request that waited: a reject has none.
  sc := pg_temp.scene('mm-m1', 'mm-games', 'rejected');
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((sc ->> 'request')::uuid, (sc ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (sc ->> 'turn')::uuid, 'reject', 'mod') returning id into rid2;
  seen := pg_temp.refusal(format('insert into staff_request_rulings (request, ruling) values (%s, %L)', rid2, 'reject'));
  if seen is null or seen not like '23514%' then raise exception 'a ruling on a request that was never conferred was not refused: %', seen; end if;
  if exists (select 1 from staff_requests_open where request = rid2) then raise exception 'a reject joined the queue of what waits'; end if;
  -- The queue is no record: its rows are taken out by the rulings and by nothing a client can reach, but they are not held append-only.
  if exists (select 1 from pg_trigger t where t.tgrelid = 'staff_requests_open'::regclass and not t.tgisinternal and (t.tgname like '%append_only%' or t.tgname like '%no_update%')) then raise exception 'the queue is held append-only like a record'; end if;
  -- The view: ruled (lapsed) and so not waiting, no lapses_at.
  if (select (v.ruling, v.waiting, v.lapses_at is null) from staff_requests_now v where v.id = rid) is distinct from row('lapsed'::text, false, true) then
    raise exception 'the view does not read the latest ruling: %', (select to_jsonb(v) from staff_requests_now v where v.id = rid);
  end if;
end $$;

do $$
declare
  sc jsonb := pg_temp.scene('mm-m1', 'mm-games', 'view');
  rid bigint;
  v record;
begin
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at)
  values ((sc ->> 'request')::uuid, (sc ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (sc ->> 'turn')::uuid, 'confer', 'mod', now() - interval '1 day') returning id into rid;
  if (select o.at from staff_requests_open o where o.request = rid) is distinct from (select q.at from staff_requests q where q.id = rid) then raise exception 'the queue row does not carry the request''s time'; end if;
  select * into v from staff_requests_now x where x.id = rid;
  if v.ruling is distinct from 'confer' or v.waiting is not true or v.lapses_at is distinct from now() + interval '2 days' then
    raise exception 'a waiting request does not say when it lapses (daysMost 3, conferred a day ago): %', to_jsonb(v);
  end if;
end $$;

-- ---- 6. apply_boss_move ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  offtopic uuid := pg_temp.board('mm-offtopic');
  general uuid := pg_temp.board('mm-general');
  t uuid := pg_temp.thread_on('mm-games', 'Boss moves');
  c1 uuid := pg_temp.cause('b1');
  c2 uuid := pg_temp.cause('b2');
  c3 uuid := pg_temp.cause('b3');
  c4 uuid := pg_temp.cause('b4');
  r jsonb;
  again jsonb;
  seen text;
  rows_before bigint;
begin
  perform pg_temp.bank(5);
  -- Refusals: the cause must be an Act; a member and a Mod are no Boss; a move names its kind, params, why; a lasting kind needs no hours, any other does.
  seen := pg_temp.refusal(format('select apply_boss_move(%L, %L::jsonb, null, 0, 20)', 'mm-boss', pg_temp.mt(t, offtopic)));
  if seen is null or seen not like '22023%' then raise exception 'a Boss move with no cause was not refused: %', seen; end if;
  rows_before := (select count(*) from queued_moves);
  r := apply_boss_move('mm-m1', pg_temp.mt(t, offtopic), c1, 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is null then raise exception 'a Mod was let through apply_boss_move: %', r; end if;
  r := apply_boss_move('mm-boss', '"nope"'::jsonb, c1, 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is null then raise exception 'a move that is no object was not refused: %', r; end if;
  r := apply_boss_move('mm-boss', jsonb_build_object('kind', 'moveThread', 'params', jsonb_build_object('thread', t, 'board', offtopic), 'why', ''), c1, 0, 20);
  if (r ->> 'queued')::boolean is not false then raise exception 'a move with no why was not refused: %', r; end if;
  r := apply_boss_move('mm-boss', pg_temp.mv(games, null), c1, 0, 20);
  if (r ->> 'queued')::boolean is not false then raise exception 'a rule with no hours was not refused: %', r; end if;
  r := apply_boss_move('mm-boss', jsonb_build_object('kind', 'noSuchKind', 'params', '{}'::jsonb, 'why', 'x', 'expires_in_hours', 48), c1, 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is null then raise exception 'a kind outside the catalog was not refused as a reason: %', r; end if;
  if (select count(*) from queued_moves) is distinct from rows_before or (select balance from move_bank where staff = 'mm-boss') is distinct from 5 then raise exception 'a refusal wrote a row or spent the bank'; end if;
  -- The phase is named: a bank with no weekly or cap cannot be counted.
  seen := pg_temp.refusal(format('select apply_boss_move(%L, %L::jsonb, %L, null, null)', 'mm-boss', pg_temp.mt(t, offtopic), c1));
  if seen is null or seen not like '22023%' then raise exception 'a Boss move with no phase was not refused: %', seen; end if;

  -- A move is queued, spends one, and a retry of the same cause spends nothing and queues nothing.
  r := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), c2, 0, 20);
  if (r ->> 'queued')::boolean is not true or r ->> 'move' is null then raise exception 'the Boss move was not queued: %', r; end if;
  if (select (q.staff, q.cause_act, q.expires_at is null, q.structural, q.meeting) from queued_moves q where q.id = (r ->> 'move')::bigint)
     is distinct from row('mm-boss'::text, c2, true, false, (select max(m.id) from meetings m where m.finished_at is not null)) then
    raise exception 'the queued row is not the Boss''s lasting move for its cause: %', (select to_jsonb(q) from queued_moves q where q.id = (r ->> 'move')::bigint);
  end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 4 then raise exception 'the bank holds % after one move, not 4', (select balance from move_bank where staff = 'mm-boss'); end if;
  again := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), c2, 0, 20);
  if (again ->> 'queued')::boolean is not false or (again ->> 'existing')::boolean is not true or again ->> 'move' is distinct from r ->> 'move' then raise exception 'the retry did not return the first row: %', again; end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 4 or (select count(*) from queued_moves where cause_act = c2) is distinct from 1 then
    raise exception 'a retried Boss move spent again or queued again';
  end if;
  -- The locks: the bank's, and the meeting's own for a meeting still open (a meeting reads the bank under its lock, so a turn and a meeting at one minute are one after the other).
  if not pg_temp.holds('kayfabb.bank.mm-boss') then raise exception 'apply_boss_move does not hold the Boss''s bank lock'; end if;

  -- A structural move waits for admins as a meeting's does: go-live structuralHoldHours (24) out.
  r := apply_boss_move('mm-boss', jsonb_build_object('kind', 'renameBoard', 'params', jsonb_build_object('board', general, 'name', 'Everything'), 'expires_in_hours', 48, 'why', 'Plain.'), c3, 0, 20);
  if (r ->> 'queued')::boolean is not true then raise exception 'the structural move was not queued: %', r; end if;
  if (select (q.structural, q.go_live_at - now(), q.expires_at - q.go_live_at) from queued_moves q where q.id = (r ->> 'move')::bigint) is distinct from row(true, interval '24 hours', interval '48 hours') then
    raise exception 'the structural move is not held a day and live two: %', (select to_jsonb(q) from queued_moves q where q.id = (r ->> 'move')::bigint);
  end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 3 then raise exception 'the structural move did not spend one'; end if;

  -- The bank counts the weeks since it was written (7 a week, a day gone: one more), and is written at now.
  perform pg_temp.bank(0, interval '1 day');
  r := apply_boss_move('mm-boss', pg_temp.mt(t, general), c4, 7, 20);
  if (r ->> 'queued')::boolean is not true then raise exception 'a bank of one earned since its balance was written did not pay: %', r; end if;
  if (select (balance, as_of) from move_bank where staff = 'mm-boss') is distinct from row(0::numeric, now()) then raise exception 'the bank is not written at now with the move taken: %', (select to_jsonb(b) from move_bank b where staff = 'mm-boss'); end if;
  -- Nothing left: a reason, no row, no debit.
  rows_before := (select count(*) from queued_moves);
  r := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), pg_temp.cause('b5'), 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is null or (select count(*) from queued_moves) is distinct from rows_before then raise exception 'an empty bank was not refused with a reason: %', r; end if;

  -- A retry of a move already made is answered with the bank EMPTY: with the last move spent, only the lookup of the cause (before the bank is read) can say "existing", so that is the lookup under test.
  perform pg_temp.bank(1);
  r := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), pg_temp.cause('b6'), 0, 20);
  if (r ->> 'queued')::boolean is not true or (select balance from move_bank where staff = 'mm-boss') is distinct from 0 then raise exception 'the last move of the bank was not made and paid: %', r; end if;
  again := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), (select q.cause_act from queued_moves q where q.id = (r ->> 'move')::bigint), 0, 20);
  if (again ->> 'existing')::boolean is not true or (again ->> 'queued')::boolean is not false or again ->> 'move' is distinct from r ->> 'move' or again ->> 'reason' is not null then
    raise exception 'a retry with the bank empty did not return the first row: %', again;
  end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 0 then raise exception 'a retry with the bank empty changed the bank'; end if;

  -- A moveThread to the board its thread is on is refused with its words, and costs nothing (a Mod's is refused by the guard, section 1).
  perform pg_temp.bank(3);
  rows_before := (select count(*) from queued_moves);
  r := apply_boss_move('mm-boss', pg_temp.mt(t, games), pg_temp.cause('b7'), 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is distinct from 'the thread is already on that board' then raise exception 'a moveThread to the thread''s own board was not refused with its words: %', r; end if;
  if (select count(*) from queued_moves) is distinct from rows_before or (select balance from move_bank where staff = 'mm-boss') is distinct from 3 then raise exception 'a no-op moveThread was queued or paid'; end if;
end $$;

-- The meeting's lock, held for a meeting that is still open.
do $$
declare
  m bigint := (begin_meeting('2031-03-01T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  r jsonb;
begin
  perform pg_temp.bank(5);
  r := apply_boss_move('mm-boss', pg_temp.mt(pg_temp.thread_on('mm-games', 'Locks'), pg_temp.board('mm-offtopic')), pg_temp.cause('lock'), 0, 20);
  if (r ->> 'queued')::boolean is not true then raise exception 'the Boss move was not queued beside an open meeting: %', r; end if;
  if not pg_temp.holds('kayfabb.meeting.' || m) then raise exception 'apply_boss_move does not take the open meeting''s lock (kayfabb.meeting.%) before it reads the bank', m; end if;
  if (select q.meeting from queued_moves q where q.id = (r ->> 'move')::bigint) is not distinct from m then raise exception 'a move is filed under a meeting not yet held'; end if;
end $$;

-- ---- 7. rule_request ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  offtopic uuid := pg_temp.board('mm-offtopic');
  general uuid := pg_temp.board('mm-general');
  sc jsonb;
  other jsonb;
  r jsonb;
  again jsonb;
  bob uuid := (select id from characters where name = 'Mm Asker Two');
  seen text;
  base_n bigint := (select count(*) from staff_requests);
  allowance integer;
  reason_a text;
  reason_b text;
begin
  sc := pg_temp.scene('mm-m1', 'mm-games', 'rule');
  other := pg_temp.scene('mm-m1', 'mm-games', 'other');
  -- Refusals (22023): a ruling outside the three, a request that is no reply, one in another thread, a turn that is not the persona's, a persona that is no staff, a member's, a request of the persona's own.
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m1', sc ->> 'request', sc ->> 'turn', 'lapsed'));
  if seen is null or seen not like '22023%' then raise exception 'a ruling of lapsed was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m1', sc ->> 'request', sc ->> 'turn', 'grant', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'an unknown ruling was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m1', (select id from acts where thread = (sc ->> 'thread')::uuid and seq = 1), sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'a request that is no reply was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m1', other ->> 'request', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'a request in another thread than the turn was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m2', sc ->> 'request', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'a turn that is another persona''s was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m3', sc ->> 'request', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'a member persona ruling on a request was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-nobody', sc ->> 'request', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' and seen not like 'P0002%' then raise exception 'an unknown staff key was not refused: %', seen; end if;
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, null)', 'mm-m1', sc ->> 'turn', sc ->> 'turn', 'reject', 'mod'));
  if seen is null or seen not like '22023%' then raise exception 'the persona ruling on its own post was not refused: %', seen; end if;
  if (select count(*) from staff_requests) is distinct from base_n then raise exception 'a refusal wrote a request row'; end if;

  -- A reject changes nothing but the record, and is written once: the replay returns the first row, whatever it is asked.
  r := rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'reject', null);
  if r ->> 'ruling' is distinct from 'reject' or r ->> 'request' is null or (r ->> 'existing')::boolean is not false or r ->> 'move' is not null then raise exception 'the reject is not as written: %', r; end if;
  if (select (q.staff, q.thread, q.asker, q.turn_act, q.ruling, q.move) from staff_requests q where q.id = (r ->> 'request')::bigint)
     is distinct from row('mm-m1'::text, (sc ->> 'thread')::uuid, pg_temp.poster(), (sc ->> 'turn')::uuid, 'reject'::text, null::bigint) then
    raise exception 'the request row is not the reject''s: %', (select to_jsonb(q) from staff_requests q where q.id = (r ->> 'request')::bigint);
  end if;
  again := rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'confer', null);
  if again ->> 'request' is distinct from r ->> 'request' or again ->> 'ruling' is distinct from 'reject' or (again ->> 'existing')::boolean is not true then raise exception 'the replay did not return the first row: %', again; end if;
  if (select count(*) from staff_requests) is distinct from base_n + 1 then raise exception 'a replay wrote a second row'; end if;

  -- A confer is a row that waits, and the view says when it lapses.
  r := rule_request('mm-m1', (other ->> 'request')::uuid, (other ->> 'turn')::uuid, 'confer', null);
  if r ->> 'ruling' is distinct from 'confer' then raise exception 'the confer is not as written: %', r; end if;
  if (select (v.waiting, v.lapses_at) from staff_requests_now v where v.id = (r ->> 'request')::bigint) is distinct from row(true, now() + interval '3 days') then raise exception 'a new confer does not lapse in daysMost days'; end if;

  -- A Mod's fulfill on its beat: queued with the request post as its cause, the allowance spent once, a replay spends nothing.
  sc := pg_temp.scene('mm-m1', 'mm-games', 'grant');
  allowance := mod_allowance('mm-m1');
  r := rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic));
  if r ->> 'ruling' is distinct from 'fulfill' or r ->> 'move' is null or r ->> 'reason' is not null then raise exception 'the Mod''s fulfill was not granted: %', r; end if;
  if (select (q.staff, q.cause_act) from queued_moves q where q.id = (r ->> 'move')::bigint) is distinct from row('mm-m1'::text, (sc ->> 'request')::uuid) then raise exception 'the move''s cause is not the request post'; end if;
  if (select q.move from staff_requests q where q.id = (r ->> 'request')::bigint) is distinct from (r ->> 'move')::bigint then raise exception 'the request row does not name the move'; end if;
  if mod_allowance('mm-m1') is distinct from allowance - 1 then raise exception 'the fulfill did not spend one of the allowance'; end if;
  again := rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic));
  if again ->> 'request' is distinct from r ->> 'request' or (again ->> 'existing')::boolean is not true or again ->> 'move' is distinct from r ->> 'move' or mod_allowance('mm-m1') is distinct from allowance - 1 then
    raise exception 'the replay of a fulfill spent again or returned another row: %', again;
  end if;

  -- A fulfill the guard refuses (a thread off the Mod's beat) is a confer, with the reason returned; nothing is spent. Whoever asked, the words are the same.
  sc := pg_temp.scene('mm-m2', 'mm-games', 'offbeat');
  other := pg_temp.scene('mm-m2', 'mm-games', 'offbeat2', bob);
  allowance := mod_allowance('mm-m2');
  r := rule_request('mm-m2', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, general));
  again := rule_request('mm-m2', (other ->> 'request')::uuid, (other ->> 'turn')::uuid, 'fulfill', pg_temp.mt((other ->> 'thread')::uuid, general));
  if r ->> 'ruling' is distinct from 'confer' or r ->> 'move' is not null or r ->> 'reason' is null then raise exception 'a refused fulfill is not a confer with its reason: %', r; end if;
  if (select q.ruling from staff_requests q where q.id = (r ->> 'request')::bigint) is distinct from 'confer' then raise exception 'the refused fulfill was written as something other than confer'; end if;
  if r ->> 'reason' is distinct from again ->> 'reason' or again ->> 'ruling' is distinct from 'confer' then raise exception 'the refusal depends on who asked: % against %', r, again; end if;
  if mod_allowance('mm-m2') is distinct from allowance then raise exception 'a refused fulfill spent the allowance'; end if;
  -- A fulfill that names no move is a confer too, never a raise.
  sc := pg_temp.scene('mm-m1', 'mm-games', 'nomove');
  r := rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', null);
  if r ->> 'ruling' is distinct from 'confer' or r ->> 'reason' is null then raise exception 'a fulfill with no move was not a confer: %', r; end if;

  -- The Boss: a fulfill debits the bank once, a retry never twice; it needs the phase; an empty bank is a confer with its reason.
  perform pg_temp.bank(3);
  sc := pg_temp.scene('mm-boss', 'mm-games', 'boss');
  seen := pg_temp.refusal(format('select rule_request(%L, %L, %L, %L, %L::jsonb)', 'mm-boss', sc ->> 'request', sc ->> 'turn', 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic)));
  if seen is null or seen not like '22023%' then raise exception 'a Boss fulfill with no phase was not refused: %', seen; end if;
  if exists (select 1 from staff_requests where request_act = (sc ->> 'request')::uuid) then raise exception 'a refused Boss fulfill left a row'; end if;
  r := rule_request('mm-boss', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic), 0, 20);
  if r ->> 'ruling' is distinct from 'fulfill' or r ->> 'move' is null then raise exception 'the Boss''s fulfill was not granted: %', r; end if;
  again := rule_request('mm-boss', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic), 0, 20);
  if (again ->> 'existing')::boolean is not true or again ->> 'move' is distinct from r ->> 'move' then raise exception 'the retry of the Boss''s fulfill is not the first row: %', again; end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 2 then raise exception 'the Boss''s fulfill, retried, left % in the bank, not 2', (select balance from move_bank where staff = 'mm-boss'); end if;
  perform pg_temp.bank(0);
  sc := pg_temp.scene('mm-boss', 'mm-games', 'broke');
  r := rule_request('mm-boss', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, offtopic), 0, 20);
  if r ->> 'ruling' is distinct from 'confer' or r ->> 'reason' is null then raise exception 'a Boss fulfill with an empty bank was not a confer: %', r; end if;
  -- A Boss's confer takes it to the meeting, and a Boss's reject is a reject.
  sc := pg_temp.scene('mm-boss', 'mm-games', 'bossconfer');
  r := rule_request('mm-boss', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'confer', null);
  if r ->> 'ruling' is distinct from 'confer' then raise exception 'the Boss''s confer is not a confer: %', r; end if;
  -- A Boss's fulfill that moves a thread to the board it is on is a confer with the reason, and the bank keeps what it had.
  perform pg_temp.bank(2);
  sc := pg_temp.scene('mm-boss', 'mm-games', 'noop');
  r := rule_request('mm-boss', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sc ->> 'thread')::uuid, games), 0, 20);
  if r ->> 'ruling' is distinct from 'confer' or r ->> 'reason' is distinct from 'the thread is already on that board' or (select balance from move_bank where staff = 'mm-boss') is distinct from 2 then
    raise exception 'a Boss fulfill to the thread''s own board was not a confer with its reason and no debit: % (bank %)', r, (select balance from move_bank where staff = 'mm-boss');
  end if;
end $$;

-- ---- 8. requests_waiting ----
do $$
declare
  s1 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'w1');
  s2 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'w2');
  s3 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'w3');
  s4 jsonb := pg_temp.scene('mm-m2', 'mm-general', 'w4');
  s5 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'w5');
  x1 bigint; x2 bigint; x3 bigint; x4 bigint; x5 bigint;
  admin_a uuid := tests.account('mm-admin');
  got jsonb;
  long text := repeat('Whole words, never cut. ', 200);
  i integer;
begin
  -- Drain what the earlier sections left waiting: this section reads the queue's head, so it starts from a clean one.
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((s1 ->> 'request')::uuid, (s1 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s1 ->> 'turn')::uuid, 'confer', 'mod', now() - interval '1 hour') returning id into x1;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((s2 ->> 'request')::uuid, (s2 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s2 ->> 'turn')::uuid, 'confer', 'mod', now() - interval '3 hours') returning id into x2;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((s3 ->> 'request')::uuid, (s3 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s3 ->> 'turn')::uuid, 'confer', 'mod', now() - interval '2 hours') returning id into x3;
  -- Conferred by Mod Two, on a thread it was never asked about: it is still shown, with its own staff.
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((s4 ->> 'request')::uuid, (s4 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m2', (s4 ->> 'turn')::uuid, 'confer', 'mod', now() - interval '30 minutes') returning id into x4;
  -- A reject: never waiting.
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((s5 ->> 'request')::uuid, (s5 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s5 ->> 'turn')::uuid, 'reject', 'mod', now() - interval '5 hours') returning id into x5;

  got := requests_waiting(10);
  if jsonb_typeof(got) is distinct from 'array' or jsonb_array_length(got) is distinct from 4 then raise exception 'requests_waiting did not list the four waiting: %', got; end if;
  if (select array_agg((e ->> 'id')::bigint order by n) from jsonb_array_elements(got) with ordinality t(e, n)) is distinct from array[x2, x3, x1, x4] then
    raise exception 'requests_waiting is not oldest first by conferral: %', (select array_agg(e ->> 'id') from jsonb_array_elements(got) e);
  end if;
  if (select (e ->> 'thread', e ->> 'title', e ->> 'boardName', e ->> 'askerName', e ->> 'staff', e ->> 'staffName', e ->> 'requestAct', e ->> 'body')
      from jsonb_array_elements(got) e where (e ->> 'id')::bigint = x2)
     is distinct from row(s2 ->> 'thread', 'Req w2'::text, 'Games'::text, 'Mm Poster'::text, 'mm-m1'::text, 'Move Mod One'::text, s2 ->> 'request', 'Please move this thread w2'::text) then
    raise exception 'a waiting request does not carry its thread, title, board, asker, staff, request post and body: %', (select e from jsonb_array_elements(got) e where (e ->> 'id')::bigint = x2);
  end if;
  if (select (e ->> 'lapsesAt')::timestamptz from jsonb_array_elements(got) e where (e ->> 'id')::bigint = x2) is distinct from now() - interval '3 hours' + interval '3 days' then raise exception 'a waiting request does not say when it lapses'; end if;
  -- Bounded: the oldest `most`, however many wait; a nothing or less is none.
  if (select array_agg((e ->> 'id')::bigint order by n) from jsonb_array_elements(requests_waiting(2)) with ordinality t(e, n)) is distinct from array[x2, x3] then raise exception 'requests_waiting(2) is not the two oldest'; end if;
  if jsonb_array_length(requests_waiting(0)) is distinct from 0 or jsonb_array_length(requests_waiting(null)) is distinct from 0 then raise exception 'requests_waiting(0) or (null) is not empty'; end if;
  -- A post is read whole, as pool_read reads it: a long request is not cut.
  perform tests.act(pg_temp.poster(), 'edit', (s3 ->> 'thread')::uuid, jsonb_build_object('body', long), (s3 ->> 'request')::uuid);
  got := requests_waiting(10);
  if (select length(e ->> 'body') from jsonb_array_elements(got) e where (e ->> 'id')::bigint = x3) is distinct from length(long) then
    raise exception 'the request post is not read whole and as edited: % characters, not %', (select length(e ->> 'body') from jsonb_array_elements(got) e where (e ->> 'id')::bigint = x3), length(long);
  end if;
  -- A hidden post is left out (the tick lapses it), and so is a ruled request.
  insert into admins (account) values (admin_a);
  perform tests.become(admin_a);
  perform decide(null, (s1 ->> 'request')::uuid, 'hide', null, 'hidden');
  perform tests.unbecome();
  insert into staff_request_rulings (request, ruling) values (x4, 'reject');
  got := requests_waiting(10);
  if (select array_agg((e ->> 'id')::bigint order by n) from jsonb_array_elements(got) with ordinality t(e, n)) is distinct from array[x2, x3] then
    raise exception 'a hidden post or a ruled request is listed: %', (select array_agg(e ->> 'id') from jsonb_array_elements(got) e);
  end if;
  -- With the head hidden, `most` still fills from what follows it.
  perform tests.become(admin_a);
  perform decide(null, (s2 ->> 'request')::uuid, 'hide', null, 'hidden');
  perform tests.unbecome();
  if (select array_agg((e ->> 'id')::bigint) from jsonb_array_elements(requests_waiting(1)) e) is distinct from array[x3] then raise exception 'requests_waiting(1) did not skip a hidden head'; end if;
end $$;

-- ---- 8b. What waits is read from the queue, not from the history ----
-- Requests ruled long ago stay in staff_requests with their first ruling (a confer is still a confer there), so a read that walks the record tables from the oldest walks every request the game has ever had. The read here
-- is measured by the tuples this transaction reads of the two record tables (the statistics keep them per table), with hundreds of ruled confers behind three that wait: it reads a handful, not the history.
create function pg_temp.record_reads() returns bigint language sql as $$
  select coalesce(sum(coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), 0)::bigint from pg_stat_xact_user_tables where relname in ('staff_requests', 'staff_request_rulings')
$$;

do $$
declare
  t uuid := pg_temp.thread_on('mm-games', 'Many requests');
  p0 uuid;
  tn uuid;
  r uuid;
  i integer;
  history constant integer := 400;
  waiting_ids bigint[];
  hide_one uuid;
  hide_two uuid;
  before bigint;
  used bigint;
  got jsonb;
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  p0 := (write_staff_act('mm-m1', 'post', t, null, '{"body": "Staff opener, many."}') ->> 'id')::uuid;
  tn := (write_staff_act('mm-m1', 'post', t, p0, '{"body": "Turn reply, many."}') ->> 'id')::uuid;
  for i in 1..history + 3 loop
    r := tests.act(pg_temp.poster(), 'post', t, jsonb_build_object('body', 'Request number ' || i), p0, now() - interval '30 days' + i * interval '1 minute');
    insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values (r, t, pg_temp.poster(), 'mm-m1', tn, 'confer', 'mod', now() - interval '30 days' + i * interval '1 minute');
  end loop;
  -- The history: every request but the last three is ruled, and each keeps its first ruling, a confer.
  insert into staff_request_rulings (request, ruling) select q.id, 'reject' from staff_requests q where q.thread = t order by q.id limit history;
  waiting_ids := array(select v.id from staff_requests_now v where v.waiting order by v.id);
  if cardinality(waiting_ids) is distinct from 3 or (select count(*) from staff_requests q where q.thread = t and q.ruling = 'confer') is distinct from history + 3 then
    raise exception 'the history is not as planted: % waiting', waiting_ids;
  end if;
  analyze staff_requests;
  analyze staff_request_rulings;
  analyze staff_requests_open;

  before := pg_temp.record_reads();
  got := requests_waiting(2);
  used := pg_temp.record_reads() - before;
  if jsonb_array_length(got) is distinct from 2 or (got -> 0 ->> 'id')::bigint is distinct from waiting_ids[1] then raise exception 'requests_waiting does not give the oldest waiting request first: %', got; end if;
  if used > 20 then raise exception 'requests_waiting read % tuples of the record tables with % ruled requests behind 3 waiting: it walks the history', used, history; end if;

  -- Hidden posts at the queue's head cost one read each and nothing more: the scan stops at the `most` requests that are shown, and the thread, board and names are joined for those alone.
  -- (The rows are real: two of the three waiting have their posts hidden, so `requests_waiting(1)` passes two hidden rows to give the third.)
  hide_one := (select q.request_act from staff_requests q where q.id = waiting_ids[1]);
  hide_two := (select q.request_act from staff_requests q where q.id = waiting_ids[2]);
  perform tests.become((select u.id from auth.users u where u.email = 'mm-admin@test.invalid'));
  perform decide(null, hide_one, 'hide', null, 'hidden');
  perform decide(null, hide_two, 'hide', null, 'hidden');
  perform tests.unbecome();
  before := pg_temp.record_reads();
  got := requests_waiting(1);
  used := pg_temp.record_reads() - before;
  if jsonb_array_length(got) is distinct from 1 or (got -> 0 ->> 'id')::bigint is distinct from waiting_ids[3] then raise exception 'requests_waiting(1) did not skip two hidden heads: %', got; end if;
  if used > 12 then raise exception 'requests_waiting(1) read % tuples of the record tables for 2 hidden rows and 1 shown: its scan is not bounded by what it returns', used; end if;
  if requests_waiting_total() is distinct from 1 then raise exception 'the total counts a request whose post is hidden: %', requests_waiting_total(); end if;

  -- The tick's pass, the same: the three were conferred 30 days ago, so they are long due and it lapses them; it reads the queue and those three, never the history behind them.
  before := pg_temp.record_reads();
  perform system_tick();
  used := pg_temp.record_reads() - before;
  if used > 40 then raise exception 'the tick read % tuples of the record tables for 3 waiting requests with % ruled behind them: it walks the history', used, history; end if;
end $$;

-- ---- 8c. What the list reads for the rows it passes ----
-- Fifty requests at the queue's head have their posts hidden; three behind them are shown. requests_waiting(1) passes the fifty and lists the first shown one. Measured by the tuples this transaction reads of each table
-- (pg_stat_xact_user_tables): the one statement reads `characters` (behind characters_public, the names) about once for each row it passes, a per-row lookup of the asker's name and the conferring persona's for each row
-- (the first shape of requests_waiting, a loop) read it some eight times as often, and the bound below holds the one and refuses the other. `threads` and `boards` are a few either way (a hidden post is dropped before
-- they are joined in both shapes), so they are bounded only as a sanity check, and `acts` is read once for each row passed in both (to know whether its post is public), so it is not bounded here.
-- requests_waiting_total counts the same rows the list can show, and a waiting request the list cannot show is not counted.
create function pg_temp.table_reads() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(relname, coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), '{}') from pg_stat_xact_user_tables where relname in ('acts', 'threads', 'boards', 'characters')
$$;

do $$
declare
  t uuid := pg_temp.thread_on('mm-games', 'Hidden head');
  p0 uuid;
  tn uuid;
  r uuid;
  i integer;
  shown bigint[];
  before jsonb;
  used jsonb;
  got jsonb;
  total_before integer := requests_waiting_total();
  ghost uuid;
begin
  p0 := (write_staff_act('mm-m1', 'post', t, null, '{"body": "Staff opener, head."}') ->> 'id')::uuid;
  tn := (write_staff_act('mm-m1', 'post', t, p0, '{"body": "Turn reply, head."}') ->> 'id')::uuid;
  for i in 1..53 loop
    r := tests.act(pg_temp.poster(), 'post', t, jsonb_build_object('body', 'Head request ' || i), p0, now() - interval '1 hour' + i * interval '1 second');
    insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values (r, t, pg_temp.poster(), 'mm-m1', tn, 'confer', 'mod', now() - interval '1 hour' + i * interval '1 second');
    if i <= 50 then
      perform tests.become((select u.id from auth.users u where u.email = 'mm-admin@test.invalid'));
      perform decide(null, r, 'hide', null, 'hidden');
      perform tests.unbecome();
    end if;
  end loop;
  shown := array(select q.id from staff_requests q where q.thread = t order by q.id offset 50);
  if cardinality(shown) is distinct from 3 or (select count(*) from staff_requests_now v where v.thread = t and v.waiting) is distinct from 53 then raise exception 'the head is not as planted'; end if;
  analyze staff_requests;
  analyze staff_requests_open;
  analyze threads;
  analyze boards;
  analyze characters;

  before := pg_temp.table_reads();
  got := requests_waiting(1);
  used := (select jsonb_object_agg(k, (pg_temp.table_reads() ->> k)::bigint - coalesce((before ->> k)::bigint, 0)) from jsonb_object_keys(pg_temp.table_reads()) k);
  if jsonb_array_length(got) is distinct from 1 or (got -> 0 ->> 'id')::bigint is distinct from shown[1] then raise exception 'requests_waiting(1) did not skip fifty hidden heads: %', got; end if;

  if (used ->> 'characters')::bigint > 150 then raise exception 'requests_waiting(1) read % tuples of characters for 50 hidden rows and 1 shown: it looks names up more than once for each row it passes (%)', used ->> 'characters', used; end if;
  if (used ->> 'threads')::bigint > 40 or (used ->> 'boards')::bigint > 40 then raise exception 'requests_waiting(1) read too many threads or boards for 50 hidden rows and 1 shown: %', used; end if;

  -- The total is the list's count: 3 are shown; a waiting request the list cannot show (its asker is not a public character) is not counted.
  if requests_waiting_total() - total_before is distinct from 3 then raise exception 'the total is % more than before, not the 3 that are shown', requests_waiting_total() - total_before; end if;
  if jsonb_array_length(requests_waiting(500)) is distinct from requests_waiting_total() then raise exception 'the total (%) is not what the list holds (%)', requests_waiting_total(), jsonb_array_length(requests_waiting(500)); end if;
  -- A request whose post's author is not a public character (not debuted) is waiting but the list cannot show it, so the total does not count it either.
  perform tests.account('mm-ghost');
  perform tests.character((select id from auth.users where email = 'mm-ghost@test.invalid'), 'Mm Ghost');
  ghost := tests.act((select id from characters where name = 'Mm Ghost'), 'post', t, '{"body": "A request by a character the list cannot show."}', p0, now() - interval '30 minutes');
  update characters set debuted_at = null where name = 'Mm Ghost';
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values (ghost, t, (select id from characters where name = 'Mm Ghost'), 'mm-m1', tn, 'confer', 'mod', now() - interval '30 minutes');
  if not exists (select 1 from staff_requests_now v where v.request_act = ghost and v.waiting) then raise exception 'the ghost request is not waiting'; end if;
  if requests_waiting_total() - total_before is distinct from 3 then raise exception 'the total counts a waiting request the list cannot show: % more than before', requests_waiting_total() - total_before; end if;
  if requests_waiting_total() is distinct from jsonb_array_length(requests_waiting(500)) then raise exception 'the total (%) is not what the list holds (%)', requests_waiting_total(), jsonb_array_length(requests_waiting(500)); end if;
end $$;

-- ---- 9. requests_ruled ----
do $$
declare
  m bigint := (begin_meeting('2031-03-08T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  offtopic uuid := pg_temp.board('mm-offtopic');
  s1 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr1');
  s2 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr2');
  s3 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr3');
  s4 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr4');
  s5 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr5');
  s6 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'rr6');
  x1 bigint; x2 bigint; x3 bigint; x4 bigint; x5 bigint; x6 bigint;
  r jsonb;
  again jsonb;
  one jsonb;
  rows_before bigint;
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s1 ->> 'request')::uuid, (s1 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s1 ->> 'turn')::uuid, 'confer', 'mod') returning id into x1;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s2 ->> 'request')::uuid, (s2 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s2 ->> 'turn')::uuid, 'confer', 'mod') returning id into x2;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s3 ->> 'request')::uuid, (s3 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s3 ->> 'turn')::uuid, 'confer', 'mod') returning id into x3;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s4 ->> 'request')::uuid, (s4 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s4 ->> 'turn')::uuid, 'confer', 'mod') returning id into x4;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s5 ->> 'request')::uuid, (s5 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s5 ->> 'turn')::uuid, 'confer', 'mod') returning id into x5;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s6 ->> 'request')::uuid, (s6 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s6 ->> 'turn')::uuid, 'confer', 'mod') returning id into x6;
  rows_before := (select count(*) from queued_moves);

  -- Two fulfills against a room of one: the first is queued and paid, the second is cut and is a reject with the reason; a reject with a line; a refused fulfill is a reject with the guard's words.
  r := requests_ruled(m, jsonb_build_array(
    jsonb_build_object('id', x1, 'ruling', 'fulfill', 'move', pg_temp.mt((s1 ->> 'thread')::uuid, offtopic), 'line', '  Done, and done well.  '),
    jsonb_build_object('id', x2, 'ruling', 'fulfill', 'move', pg_temp.mt((s2 ->> 'thread')::uuid, offtopic), 'line', 'Also done.'),
    jsonb_build_object('id', x3, 'ruling', 'reject', 'line', 'No.'),
    jsonb_build_object('id', x4, 'ruling', 'fulfill', 'move', pg_temp.mt((s4 ->> 'thread')::uuid, (select board from threads where id = (s4 ->> 'thread')::uuid)), 'line', '')), 1);
  if (r ->> 'spent')::integer is distinct from 1 then raise exception 'the meeting is told to charge % moves, not 1: %', r ->> 'spent', r; end if;
  one := (select e from jsonb_array_elements(r -> 'rulings') e where (e ->> 'id')::bigint = x1);
  if one ->> 'ruling' is distinct from 'fulfill' or one ->> 'move' is null or one ->> 'postAct' is null or one ->> 'replyFailed' is not null then
    raise exception 'the granted ruling is not as the Boss posts it: %', one;
  end if;
  if (select (a.kind, a.thread, a.target_act_id, a.payload ->> 'body', a.character) from acts a where a.id = (one ->> 'postAct')::uuid)
     is distinct from row('post'::text, (s1 ->> 'thread')::uuid, (s1 ->> 'request')::uuid, 'Done, and done well.'::text, (select c.id from characters c where c.staff = 'mm-boss')) then
    raise exception 'the Boss''s reply is not its line, in the thread, quoting the request post: %', (select to_jsonb(a) from acts a where a.id = (one ->> 'postAct')::uuid);
  end if;
  if (select g.post_act from staff_request_rulings g where g.request = x1) is distinct from (one ->> 'postAct')::uuid then raise exception 'the ruling row does not name the Boss''s reply'; end if;
  if (select (q.staff, q.meeting, q.cause_act) from queued_moves q where q.id = (one ->> 'move')::bigint) is distinct from row('mm-boss'::text, m, (s1 ->> 'request')::uuid) then raise exception 'the granted move is not the Boss''s for this meeting and cause'; end if;
  one := (select e from jsonb_array_elements(r -> 'rulings') e where (e ->> 'id')::bigint = x2);
  -- The line was written for a grant: a fulfill that becomes a reject does not post it (here there is no stock line either, so no reply at all).
  if one ->> 'ruling' is distinct from 'reject' or one ->> 'move' is not null or one ->> 'reason' is null or one ->> 'postAct' is not null or one ->> 'replyFailed' is not null then raise exception 'the fulfill the bank could not pay is not a reject with its reason and no reply of the Boss''s line: %', one; end if;
  if exists (select 1 from acts a where a.thread = (s2 ->> 'thread')::uuid and a.payload ->> 'body' = 'Also done.') then raise exception 'the line written for a grant was posted under the refusal'; end if;
  one := (select e from jsonb_array_elements(r -> 'rulings') e where (e ->> 'id')::bigint = x3);
  if one ->> 'ruling' is distinct from 'reject' or (select a.payload ->> 'body' from acts a where a.id = (one ->> 'postAct')::uuid) is distinct from 'No.' or one ->> 'reason' is not null then raise exception 'the reject is not as the Boss posts it: %', one; end if;
  one := (select e from jsonb_array_elements(r -> 'rulings') e where (e ->> 'id')::bigint = x4);
  if one ->> 'ruling' is distinct from 'reject' or one ->> 'reason' is null or one ->> 'postAct' is not null or one ->> 'replyFailed' is not null then raise exception 'a refused fulfill with a blank line, in an instance with no stock line, is not a reject with no reply: %', one; end if;
  if (select count(*) from queued_moves) is distinct from rows_before + 1 then raise exception 'the meeting''s requests queued % moves, not 1', (select count(*) from queued_moves) - rows_before; end if;
  -- A fulfill that moves a thread to the board it is on is a reject with those words, with the room to pay for it (the bank is not charged: spent stays 0).
  one := requests_ruled(m, jsonb_build_array(jsonb_build_object('id', x6, 'ruling', 'fulfill', 'move', pg_temp.mt((s6 ->> 'thread')::uuid, (select board from threads where id = (s6 ->> 'thread')::uuid)), 'line', 'Moved.')), 5);
  if (one ->> 'spent')::integer is distinct from 0 or one #>> '{rulings,0,ruling}' is distinct from 'reject' or one #>> '{rulings,0,reason}' is distinct from 'the thread is already on that board' then
    raise exception 'a fulfill to the thread''s own board was not a reject with its words and no charge: %', one;
  end if;
  -- One row each, written once with what was ruled; a request the answer leaves out stays waiting.
  if (select array_agg(g.ruling order by g.request) from staff_request_rulings g where g.request in (x1, x2, x3, x4)) is distinct from array['fulfill', 'reject', 'reject', 'reject']::text[] then
    raise exception 'the rulings written are %', (select array_agg(g.ruling order by g.request) from staff_request_rulings g where g.request in (x1, x2, x3, x4));
  end if;
  if (select (g.move is not null, g.meeting) from staff_request_rulings g where g.request = x1) is distinct from row(true, m) then raise exception 'the granted ruling does not name its move and its meeting'; end if;
  if (select g.reason from staff_request_rulings g where g.request = x2) is null then raise exception 'the cut fulfill''s reason is not recorded'; end if;
  if (select v.waiting from staff_requests_now v where v.id = x5) is distinct from true or (select v.waiting from staff_requests_now v where v.id = x1) is distinct from false then raise exception 'what the meeting left out is not waiting, or what it ruled is'; end if;
  -- A ruled request is ruled once: the same answers again queue nothing, spend nothing, write nothing, and say why they skipped.
  again := requests_ruled(m, jsonb_build_array(jsonb_build_object('id', x1, 'ruling', 'fulfill', 'move', pg_temp.mt((s1 ->> 'thread')::uuid, offtopic), 'line', 'Again.'),
    jsonb_build_object('id', 99999999, 'ruling', 'reject', 'line', 'Nobody.')), 5);
  if (again ->> 'spent')::integer is distinct from 0 or jsonb_array_length(again -> 'rulings') is distinct from 0 or jsonb_array_length(again -> 'skipped') is distinct from 2
     or (select count(*) from queued_moves) is distinct from rows_before + 1 then raise exception 'an answer for a ruled or unknown request was not skipped: %', again; end if;
  -- An answer with a ruling that is neither is skipped, not guessed; answers past meetingMost (2) are not read.
  update settings set value = '{"daysMost": 3, "meetingMost": 2}' where key = 'staffRequests';
  again := requests_ruled(m, jsonb_build_array(
    jsonb_build_object('id', x5, 'ruling', 'confer', 'line', 'Hm.'),
    jsonb_build_object('id', x5, 'ruling', 'reject', 'line', 'First.'),
    jsonb_build_object('id', x5, 'ruling', 'reject', 'line', 'Again.')), 5);
  if jsonb_array_length(again -> 'rulings') is distinct from 1 or (select a.payload ->> 'body' from acts a where a.id = (again #>> '{rulings,0,postAct}')::uuid) is distinct from 'First.' or jsonb_array_length(again -> 'skipped') is distinct from 2 then raise exception 'the answers are not read as one ruling and two skips: %', again; end if;
  if requests_ruled(m, '[]'::jsonb, 5) is distinct from jsonb_build_object('spent', 0, 'rulings', '[]'::jsonb, 'skipped', '[]'::jsonb) then raise exception 'no answers are not a quiet result'; end if;
end $$;

-- ---- 10. The tick ----
do $$
declare
  a jsonb := pg_temp.scene('mm-m1', 'mm-games', 'lapseA');
  b jsonb := pg_temp.scene('mm-m1', 'mm-games', 'lapseB');
  c jsonb := pg_temp.scene('mm-m1', 'mm-games', 'lapseC');
  d jsonb := pg_temp.scene('mm-m1', 'mm-games', 'lapseD', (select id from characters where name = 'Mm Asker Two'));
  ra bigint; rb bigint; rc bigint; rd bigint;
  admin_a uuid := tests.account('mm-admin2');
  boss uuid := (select id from characters where staff = 'mm-boss');
  tick jsonb;
  replies_a integer;
begin
  -- Whatever the earlier sections left waiting is ruled, so this section counts only its own.
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  -- A is due at this instant, B a minute later, C's post is hidden (it lapses at once, with no reply), D is asked of by Bob.
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((a ->> 'request')::uuid, (a ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (a ->> 'turn')::uuid, 'confer', 'mod', now() - interval '3 days') returning id into ra;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((b ->> 'request')::uuid, (b ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (b ->> 'turn')::uuid, 'confer', 'mod', now() - interval '3 days' + interval '1 minute') returning id into rb;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((c ->> 'request')::uuid, (c ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (c ->> 'turn')::uuid, 'confer', 'mod', now()) returning id into rc;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((d ->> 'request')::uuid, (d ->> 'thread')::uuid, (select id from characters where name = 'Mm Asker Two'), 'mm-m1', (d ->> 'turn')::uuid, 'confer', 'mod', now() - interval '4 days') returning id into rd;
  insert into admins (account) values (admin_a);
  perform tests.become(admin_a);
  perform decide(null, (c ->> 'request')::uuid, 'hide', null, 'hidden');
  perform tests.unbecome();

  tick := system_tick();
  -- B is due a minute from now: it is neither lapsed nor out of the queue. Checked first, so a pass that lapses what is not yet due is named as that and not as a miscount.
  if exists (select 1 from staff_request_rulings g where g.request = rb) or (select v.waiting from staff_requests_now v where v.id = rb) is distinct from true then raise exception 'B lapsed a minute before lapses_at'; end if;
  if (tick ->> 'requestsLapsed')::integer is distinct from 3 then raise exception 'the tick lapsed % requests, not 3 (A, C and D): %', tick ->> 'requestsLapsed', tick; end if;
  if (select (g.ruling, g.post_act is not null) from staff_request_rulings g where g.request = ra) is distinct from row('lapsed'::text, true) then raise exception 'A did not lapse with a reply at lapses_at'; end if;
  if (select (g.ruling, g.post_act) from staff_request_rulings g where g.request = rc) is distinct from row('lapsed'::text, null::uuid) then raise exception 'a hidden request did not lapse with no reply'; end if;
  if exists (select 1 from acts x where x.character = boss and x.kind = 'post' and x.target_act_id = (c ->> 'request')::uuid) then raise exception 'the Boss replied to a hidden post'; end if;
  -- The reply: the Boss's, in the thread, to the request post, from the stock line with {boss} and {asker} filled; written once.
  if (select (x.character, x.thread, x.target_act_id, x.payload ->> 'body') from acts x where x.id = (select g.post_act from staff_request_rulings g where g.request = ra))
     is distinct from row(boss, (a ->> 'thread')::uuid, (a ->> 'request')::uuid, 'Move Boss says to Mm Poster: that request lapsed.'::text) then
    raise exception 'the lapse reply is not the stock line in the thread: %', (select to_jsonb(x) from acts x where x.id = (select g.post_act from staff_request_rulings g where g.request = ra));
  end if;
  if (select payload ->> 'body' from acts where id = (select g.post_act from staff_request_rulings g where g.request = (select id from staff_requests where request_act = (d ->> 'request')::uuid))) is distinct from 'Move Boss says to Mm Asker Two: that request lapsed.' then
    raise exception 'the lapse reply does not name the asker it is for';
  end if;
  replies_a := (select count(*) from acts x where x.character = boss and x.kind = 'post' and x.target_act_id = (a ->> 'request')::uuid);
  tick := system_tick();
  if replies_a is distinct from 1 or (select count(*) from acts x where x.character = boss and x.kind = 'post' and x.target_act_id = (a ->> 'request')::uuid) is distinct from 1
     or (select count(*) from staff_request_rulings g where g.request in (ra, rc, rd)) is distinct from 3 or (tick ->> 'requestsLapsed')::integer is distinct from 0 then
    raise exception 'a second tick lapsed again or replied again: %', tick;
  end if;

  -- The System off: a request still lapses (its way out is time), and says nothing.
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((b ->> 'request')::uuid, (b ->> 'thread')::uuid, pg_temp.poster(), 'mm-m2', (b ->> 'turn')::uuid, 'confer', 'mod', now() - interval '9 days') returning id into rb;
  tick := system_tick();
  if (tick ->> 'requestsLapsed')::integer is distinct from 1 or (select (g.ruling, g.post_act) from staff_request_rulings g where g.request = rb) is distinct from row('lapsed'::text, null::uuid) then
    raise exception 'a request did not lapse silently while The System is off: %', tick;
  end if;
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
end $$;

-- ---- 10b. A request the tick cannot lapse goes behind the others ----
-- The pass takes `demandChecksPerTick` requests, the oldest due first. One that keeps failing (here a trigger refuses its ruling) would be the oldest at every tick and hold the one slot for good, and the
-- request behind it would never lapse. It goes behind by its failure (failed_at), is counted (attempts), and is read again when nothing else is due; a request that can be lapsed again is lapsed.
create function pg_temp.refuse_ruling() returns trigger language plpgsql as $$
begin
  if new.request = current_setting('kayfabb.test_refused')::bigint then raise exception 'this ruling is refused for the test'; end if;
  return new;
end $$;

do $$
declare
  a jsonb := pg_temp.scene('mm-m1', 'mm-games', 'stuckA');
  b jsonb := pg_temp.scene('mm-m1', 'mm-games', 'stuckB');
  ra bigint; rb bigint;
  tick jsonb;
  was text := (select value #>> '{}' from settings where key = 'demandChecksPerTick');
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into settings (key, value) values ('demandChecksPerTick', '1'::jsonb) on conflict (key) do update set value = excluded.value;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((a ->> 'request')::uuid, (a ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (a ->> 'turn')::uuid, 'confer', 'mod', now() - interval '9 days') returning id into ra;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office, at) values ((b ->> 'request')::uuid, (b ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (b ->> 'turn')::uuid, 'confer', 'mod', now() - interval '8 days') returning id into rb;
  perform set_config('kayfabb.test_refused', ra::text, true);
  create trigger zz_refuse_ruling before insert on staff_request_rulings for each row execute function pg_temp.refuse_ruling();

  -- The first tick takes A (the oldest), which fails: recorded, behind, and B is not lapsed yet (one slot).
  tick := system_tick();
  if (tick ->> 'failed')::integer < 1 or (tick ->> 'requestsLapsed')::integer is distinct from 0 then raise exception 'the failing request was not counted as a failure and nothing else lapsed: %', tick; end if;
  if (select (o.failed_at is not null, o.attempts) from staff_requests_open o where o.request = ra) is distinct from row(true, 1) then raise exception 'the failure was not recorded on the request''s queue row: %', (select to_jsonb(o) from staff_requests_open o where o.request = ra); end if;
  if (select o.failed_at from staff_requests_open o where o.request = rb) is not null then raise exception 'a request that did not fail was marked as failed'; end if;
  -- The second takes B, which can be lapsed, though A is older: A does not hold the slot.
  tick := system_tick();
  if (tick ->> 'requestsLapsed')::integer is distinct from 1 or (select g.ruling from staff_request_rulings g where g.request = rb) is distinct from 'lapsed' then
    raise exception 'a request that keeps failing held the pass''s slot from the one behind it: %', tick;
  end if;
  -- Nothing else is due: A is read again (attempts 2) and is still waiting, with a meeting able to rule it.
  tick := system_tick();
  if (select (o.attempts, exists (select 1 from staff_request_rulings g where g.request = ra)) from staff_requests_open o where o.request = ra) is distinct from row(2, false) then
    raise exception 'the failing request was not read again once nothing else was due: %', (select to_jsonb(o) from staff_requests_open o where o.request = ra);
  end if;
  -- Its way out when the fault is gone: the next tick lapses it.
  drop trigger zz_refuse_ruling on staff_request_rulings;
  tick := system_tick();
  if (tick ->> 'requestsLapsed')::integer is distinct from 1 or (select g.ruling from staff_request_rulings g where g.request = ra) is distinct from 'lapsed' or exists (select 1 from staff_requests_open o where o.request = ra) then
    raise exception 'the request did not lapse once it could: %', tick;
  end if;
  if was is null then delete from settings where key = 'demandChecksPerTick'; else update settings set value = to_jsonb(was::integer) where key = 'demandChecksPerTick'; end if;
end $$;

-- ---- 11. The setting ----
do $$
declare
  poison jsonb;
  seen text;
begin
  if setting_staffrequests('{"daysMost": 3, "meetingMost": 10}'::jsonb) is not null or setting_staffrequests('{"daysMost": 1, "meetingMost": 1}'::jsonb) is not null then raise exception 'a good staffRequests was refused: %', setting_staffrequests('{"daysMost": 3, "meetingMost": 10}'::jsonb); end if;
  foreach poison in array array['{"daysMost": 0, "meetingMost": 10}', '{"daysMost": 3, "meetingMost": 0}', '{"daysMost": "3", "meetingMost": 10}', '{"daysMost": 1.5, "meetingMost": 10}', '{"daysMost": -1, "meetingMost": 10}',
    '{"daysMost": 3}', '{"meetingMost": 10}', '{"daysMost": 3, "meetingMost": 10, "extra": 1}', '"3"', '3', 'null', '[3, 10]', '{}']::jsonb[] loop
    if setting_staffrequests(poison) is null then raise exception 'the poison % passed setting_staffrequests', poison; end if;
    seen := pg_temp.refusal(format('update settings set value = %L::jsonb where key = %L', poison, 'staffRequests'));
    if seen is null or seen not like '23514%' or seen not like '%staffRequests is%' then raise exception 'the poison % was written to the settings row: %', poison, seen; end if;
  end loop;
  if (select value from settings where key = 'staffRequests') is distinct from '{"daysMost": 3, "meetingMost": 2}'::jsonb then raise exception 'a refused staffRequests changed the row'; end if;
  update settings set value = '{"daysMost": 5, "meetingMost": 20}' where key = 'staffRequests';
end $$;

-- ---- 11b. requests_waiting is the digest's ----
-- The digest role (0045) reads public relations only. requests_waiting is owned by it, so what it reads is what the role may read: the queue and the public columns of staff_requests. It works as the service role
-- calls it (the owner's reads, not the caller's), reads no column of `characters`, and a function the role owns cannot read the asker (a post's real author, even where it is veiled) or a move.
do $$
declare
  denied boolean;
  sc jsonb := pg_temp.scene('mm-m1', 'mm-games', 'digest');
  rid bigint;
  got jsonb;
begin
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'requests_waiting(integer)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'requests_waiting is not owned by kayfabb_digest'; end if;
  if not (select prosecdef from pg_proc where oid = 'requests_waiting(integer)'::regprocedure) then raise exception 'requests_waiting is not security definer'; end if;
  if has_function_privilege('authenticated', 'requests_waiting(integer)', 'execute') or has_function_privilege('anon', 'requests_waiting(integer)', 'execute') or not has_function_privilege('service_role', 'requests_waiting(integer)', 'execute') then
    raise exception 'requests_waiting is not the service role''s alone';
  end if;
  if has_table_privilege('kayfabb_digest', 'characters', 'select') or has_column_privilege('kayfabb_digest', 'characters', 'owner', 'select') or has_table_privilege('kayfabb_digest', 'staff_request_rulings', 'select')
     or has_column_privilege('kayfabb_digest', 'staff_requests', 'asker', 'select') or has_column_privilege('kayfabb_digest', 'staff_requests', 'move', 'select') then
    raise exception 'the digest role reads a private column of the request tables, or characters';
  end if;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((sc ->> 'request')::uuid, (sc ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (sc ->> 'turn')::uuid, 'confer', 'mod') returning id into rid;
  perform tests.become_service();
  got := requests_waiting(500);
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(got) e where (e ->> 'id')::bigint = rid and e ->> 'staffName' = 'Move Mod One' and e ->> 'askerName' = 'Mm Poster' and e ->> 'boardName' = 'Games') then
    raise exception 'the service role did not read the waiting request as the digest role: %', got;
  end if;
  grant create on schema public to kayfabb_digest;
  create function poison_asker() returns bigint language plpgsql security definer set search_path = public, pg_temp as $f$ begin return (select count(asker) from staff_requests); end $f$;
  alter function poison_asker() owner to kayfabb_digest;
  denied := false;
  begin perform poison_asker(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read staff_requests.asker'; end if;
  create function poison_rulings() returns bigint language plpgsql security definer set search_path = public, pg_temp as $f$ begin return (select count(*) from staff_request_rulings); end $f$;
  alter function poison_rulings() owner to kayfabb_digest;
  denied := false;
  begin perform poison_rulings(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read staff_request_rulings'; end if;
  drop function poison_asker(), poison_rulings();
  revoke create on schema public from kayfabb_digest;
end $$;

-- ---- 12. The turn's call record ----
do $$
declare
  post uuid := pg_temp.rule(pg_temp.board('mm-general'), 'noBumping');
  got jsonb;
begin
  got := record_staff_call(post, 'ruling', 'mm-boss', '{"ruling": "reject", "trims": []}');
  if (got ->> 'attempt')::integer is distinct from 1 then raise exception 'a ruling call record was not kept: %', got; end if;
  got := record_staff_call(post, 'ruling', 'mm-boss', '{"ruling": "reject", "trims": []}');
  if (got ->> 'attempt')::integer is distinct from 2 then raise exception 'a second ruling record was not the next attempt: %', got; end if;
  if pg_temp.refusal(format('select record_staff_call(%L, ''chatter'', ''mm-boss'', ''{}'')', post)) is null then raise exception 'a record for a duty outside the list was kept'; end if;
end $$;

-- ---- 13. The season a turn's move is held by ----
-- A turn's move is filed under the latest finished meeting, but the kinds the Boss holds back (an arc's beat not yet unlocked) are those of the season it is now: a meeting held in the season before has its own
-- events. Here the meeting was held in season 1 (beat `opened` unlocked there), and season 2, which began since, has not unlocked it: the Boss's moveThread is held back now, and not the meeting's season's.
do $$
declare
  t uuid := pg_temp.thread_on('mm-games', 'Seasons');
  offtopic uuid := pg_temp.board('mm-offtopic');
  m bigint;
  old_season bigint;
  new_season bigint;
  r jsonb;
begin
  perform pg_temp.bank(5);
  insert into persona_arcs (staff, beats, holds_back) values ('mm-boss', '[{"key": "opened", "mini": false}]'::jsonb, '[{"kind": "moveThread", "until": "opened"}]'::jsonb)
  on conflict (staff) do update set beats = excluded.beats, holds_back = excluded.holds_back;
  select s.id into old_season from seasons s where s.ends_at is null;
  update seasons set ends_at = now() - interval '2 days' where id = old_season;
  insert into seasons (number, starts_at, boss) values ((select max(number) + 1 from seasons), now() - interval '2 days', 'mm-boss') returning id into new_season;
  insert into meetings (slot, started_at, finished_at, outcome) values (now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', 'ok') returning id into m;
  if meeting_season(m) is distinct from old_season then raise exception 'the meeting is not in the old season (% against %)', meeting_season(m), old_season; end if;
  insert into arc_beat_events (season, staff, beat, event) values (old_season, 'mm-boss', 'opened', 'unlocked');
  if held_back_kinds('mm-boss', old_season) <> '{}'::text[] or held_back_kinds('mm-boss', new_season) is distinct from array['moveThread'] then raise exception 'the world: the arc does not hold back by season'; end if;

  r := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), pg_temp.cause('s1'), 0, 20);
  if (r ->> 'queued')::boolean is not false or r ->> 'reason' is distinct from 'the Boss does not use moveThread yet' then raise exception 'a kind this season has not unlocked was let through by the meeting''s season: %', r; end if;
  if (select balance from move_bank where staff = 'mm-boss') is distinct from 5 then raise exception 'a held-back kind was paid for'; end if;
  insert into arc_beat_events (season, staff, beat, event) values (new_season, 'mm-boss', 'opened', 'unlocked');
  r := apply_boss_move('mm-boss', pg_temp.mt(t, offtopic), pg_temp.cause('s2'), 0, 20);
  if (r ->> 'queued')::boolean is not true then raise exception 'a kind this season has unlocked was refused: %', r; end if;
end $$;

-- ---- 14. The turn and its ruling are one transaction ----
create function pg_temp.waiting(staff text, label text) returns jsonb language plpgsql as $$
declare
  t uuid := pg_temp.thread_on('mm-games', 'Turn ' || label);
  p0 uuid := (write_staff_act(staff, 'post', t, null, jsonb_build_object('body', 'Staff opener ' || label)) ->> 'id')::uuid;
  r uuid := tests.act(pg_temp.poster(), 'post', t, jsonb_build_object('body', 'Please, ' || label), p0, now() - interval '1 hour');
begin
  return jsonb_build_object('thread', t, 'reply', r);
end $$;

do $$
declare
  sid bigint;
  sc jsonb;
  got jsonb;
  seen text;
  offtopic uuid := pg_temp.board('mm-offtopic');
  posts bigint;
  reqs bigint;
  turns bigint;
begin
  perform write_sessions((now() at time zone 'UTC')::date, '[{"staff": "mm-m1", "start": 0, "end": 1440}]');
  sid := (select s.id from staff_sessions s where s.staff = 'mm-m1' order by s.id desc limit 1);
  if (select count(*) from pg_proc where proname = 'write_staff_turn') is distinct from 1 then raise exception 'write_staff_turn has more than one signature'; end if;

  -- A turn with no ruling is as it was: no ruling and no refusal in its answer, no request.
  sc := pg_temp.waiting('mm-m1', 'none');
  got := write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn.', 0);
  if got ? 'ruling' or got ? 'refused' or got -> 'post' ->> 'id' is null then raise exception 'a turn with no ruling answers a ruling: %', got; end if;
  if exists (select 1 from staff_requests where request_act = (sc ->> 'reply')::uuid) then raise exception 'a turn with no ruling wrote a request'; end if;

  -- A turn with a ruling writes the post and the request together; the request's turn is the new post.
  sc := pg_temp.waiting('mm-m1', 'confer');
  got := write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn that confers.', 0,
    jsonb_build_object('reply', sc ->> 'reply', 'ruling', 'confer', 'move', null));
  if got -> 'ruling' ->> 'ruling' is distinct from 'confer' or got ? 'refused' then raise exception 'the ruling was not written with the turn: %', got; end if;
  if (select q.turn_act from staff_requests q where q.request_act = (sc ->> 'reply')::uuid and q.staff = 'mm-m1') is distinct from (got -> 'post' ->> 'id')::uuid then raise exception 'the request does not name the new post as its turn: %', got; end if;
  if not exists (select 1 from pool_turns t where t.post_act = (got -> 'post' ->> 'id')::uuid) then raise exception 'the turn has no row'; end if;

  -- A refused ruling leaves the post and the turn, writes no request, and returns the refusal: a ruling outside the three (22023), and a reply that is no id (22P02).
  sc := pg_temp.waiting('mm-m1', 'refused');
  got := write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn whose ruling is refused.', 0,
    jsonb_build_object('reply', sc ->> 'reply', 'ruling', 'grant', 'move', null));
  if got -> 'refused' ->> 'code' is distinct from '22023' or got -> 'refused' ->> 'message' is null or got ? 'ruling' then raise exception 'a refused ruling was not returned as the refusal: %', got; end if;
  if not exists (select 1 from acts a where a.id = (got -> 'post' ->> 'id')::uuid and a.kind = 'post') or not exists (select 1 from pool_turns t where t.post_act = (got -> 'post' ->> 'id')::uuid)
     or not exists (select 1 from pool_answered x where x.reply = (sc ->> 'reply')::uuid) then raise exception 'a refused ruling took the post back: %', got; end if;
  if exists (select 1 from staff_requests where request_act = (sc ->> 'reply')::uuid) then raise exception 'a refused ruling wrote a request'; end if;
  sc := pg_temp.waiting('mm-m1', 'noid');
  got := write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn whose ruling names no reply.', 0,
    jsonb_build_object('reply', 'not an id', 'ruling', 'reject', 'move', null));
  if got -> 'refused' ->> 'code' is distinct from '22P02' or got -> 'post' ->> 'id' is null then raise exception 'a ruling with no id for its reply took the post or was not returned: %', got; end if;

  -- A replay writes neither a second post nor a second request: the replies are answered, and the turn is refused whole.
  sc := pg_temp.waiting('mm-m1', 'replay');
  got := write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn to replay.', 0,
    jsonb_build_object('reply', sc ->> 'reply', 'ruling', 'reject', 'move', null));
  select count(*) into posts from acts where thread = (sc ->> 'thread')::uuid;
  select count(*) into reqs from staff_requests;
  select count(*) into turns from pool_turns;
  seen := pg_temp.refusal(format('select write_staff_turn(%L, %s, %L, %L, %L::uuid[], %L, 0, %L::jsonb)', 'mm-m1', sid, sc ->> 'thread', sc ->> 'reply', array[sc ->> 'reply'], 'A turn to replay.',
    jsonb_build_object('reply', sc ->> 'reply', 'ruling', 'reject', 'move', null)));
  if seen is null or seen not like '55000%answered once%' then raise exception 'a replayed turn was not refused: %', seen; end if;
  if (select count(*) from acts where thread = (sc ->> 'thread')::uuid) is distinct from posts or (select count(*) from staff_requests) is distinct from reqs or (select count(*) from pool_turns) is distinct from turns then
    raise exception 'a replayed turn wrote a second post, turn or request'; end if;

  -- A transaction rolled back after the post leaves neither the post nor the request.
  sc := pg_temp.waiting('mm-m1', 'rollback');
  select count(*) into posts from acts where thread = (sc ->> 'thread')::uuid;
  select count(*) into reqs from staff_requests;
  begin
    perform write_staff_turn('mm-m1', sid, (sc ->> 'thread')::uuid, (sc ->> 'reply')::uuid, array[(sc ->> 'reply')::uuid], 'A turn that dies.', 0,
      jsonb_build_object('reply', sc ->> 'reply', 'ruling', 'reject', 'move', null));
    if (select count(*) from staff_requests) is distinct from reqs + 1 then raise exception 'the world: the ruling was not written'; end if;
    raise exception 'the run died' using errcode = 'P0001';
  exception when sqlstate 'P0001' then null;
  end;
  if (select count(*) from acts where thread = (sc ->> 'thread')::uuid) is distinct from posts or (select count(*) from staff_requests) is distinct from reqs
     or exists (select 1 from pool_answered x where x.reply = (sc ->> 'reply')::uuid) then raise exception 'a turn rolled back after its post left a post, a request or an answered reply'; end if;
end $$;

-- ---- 15. The meeting rules on requests (Task 5: migration section 3) ----
-- apply_meeting hands payload.requests to requests_ruled with the room the bank has left after the Boss's own moves, writes the rulings in its own transaction, charges what they spent in the one write of the balance, returns the rulings for the
-- Edge function, each with the Boss's reply written in the same transaction, and takes the Boss's bank lock before it reads the bank. A retry of the closed meeting writes, queues and charges nothing. system_digest returns the waiting requests, bounded by meetingMost.
do $$
declare
  m bigint;
  offtopic uuid := pg_temp.board('mm-offtopic');
  games uuid := pg_temp.board('mm-games');
  s1 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'am1');
  s2 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'am2');
  s3 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'am3');
  s4 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'am4');
  s5 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'am5');
  x1 bigint; x2 bigint; x3 bigint; x4 bigint; x5 bigint;
  r jsonb;
  again jsonb;
  dg jsonb;
  queued_before bigint;
  rulings_before bigint;
  rec jsonb;
  payload jsonb;
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s1 ->> 'request')::uuid, (s1 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s1 ->> 'turn')::uuid, 'confer', 'mod') returning id into x1;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s2 ->> 'request')::uuid, (s2 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s2 ->> 'turn')::uuid, 'confer', 'mod') returning id into x2;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s3 ->> 'request')::uuid, (s3 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s3 ->> 'turn')::uuid, 'confer', 'mod') returning id into x3;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s4 ->> 'request')::uuid, (s4 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s4 ->> 'turn')::uuid, 'confer', 'mod') returning id into x4;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s5 ->> 'request')::uuid, (s5 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s5 ->> 'turn')::uuid, 'confer', 'mod') returning id into x5;

  insert into settings (key, value) values ('digestThreads', '5'), ('digestExcerpts', '5'), ('digestExcerptChars', '280') on conflict (key) do nothing;
  -- The digest carries the waiting requests, oldest first, each with its thread's board, and no more than meetingMost of them.
  update settings set value = '{"daysMost": 3, "meetingMost": 4}' where key = 'staffRequests';
  dg := system_digest(now() - interval '1 day', now());
  if jsonb_array_length(dg -> 'requests') is distinct from 4 or (dg #>> '{requests,0,id}')::bigint is distinct from x1 or (dg #>> '{requests,0,board}')::uuid is distinct from games then
    raise exception 'the digest does not carry the 4 oldest waiting requests, with their boards: %', dg -> 'requests';
  end if;
  if dg #>> '{requests,0,body}' is distinct from 'Please move this thread am1' then raise exception 'the digest''s request is not the post whole: %', dg #>> '{requests,0}'; end if;
  -- The digest counts every waiting request, not only the ones it lists: 5 wait and 4 are listed, and the section says 1 more waits.
  if (dg ->> 'requestsWaiting')::integer is distinct from 5 or requests_waiting_total() is distinct from 5 then raise exception 'the digest does not count the 5 waiting requests: %, %', dg ->> 'requestsWaiting', requests_waiting_total(); end if;
  update settings set value = '{"daysMost": 3, "meetingMost": 10}' where key = 'staffRequests';

  -- A bank of 2, and a cap of 2 (so what the Mods return cannot add to it): the Boss's own move spends one, the first fulfill the other, the second fulfill is cut by the room and is a reject; a reject; an unknown id and a ruling of confer are skipped; one request is left out.
  perform pg_temp.bank(2);
  m := (begin_meeting('2031-05-01T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  queued_before := (select count(*) from queued_moves);
  rulings_before := (select count(*) from staff_request_rulings);
  payload := jsonb_build_object('boss', 'mm-boss', 'weekly_moves', 0, 'bank_cap', 2, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', jsonb_build_array(pg_temp.mt(pg_temp.thread_on('mm-games', 'Own move am'), offtopic) || jsonb_build_object('go_live_at', now())),
    'requests', jsonb_build_array(
      jsonb_build_object('id', x1, 'ruling', 'fulfill', 'move', pg_temp.mt((s1 ->> 'thread')::uuid, offtopic), 'line', 'Done.'),
      jsonb_build_object('id', x2, 'ruling', 'fulfill', 'move', pg_temp.mt((s2 ->> 'thread')::uuid, offtopic), 'line', 'Also done.'),
      jsonb_build_object('id', x3, 'ruling', 'reject', 'line', 'No.'),
      jsonb_build_object('id', 99999999, 'ruling', 'reject', 'line', 'Nobody.'),
      jsonb_build_object('id', x4, 'ruling', 'confer', 'line', 'Later.')),
    'record', '{}'::jsonb);
  r := apply_meeting(m, payload);
  if r ->> 'status' is distinct from 'applied' then raise exception 'the meeting was not applied: %', r; end if;
  if not pg_temp.holds('kayfabb.bank.mm-boss') then raise exception 'apply_meeting did not take the Boss''s bank lock'; end if;
  if (r ->> 'bank_before')::numeric is distinct from 2 or (r ->> 'bank_after')::numeric is distinct from 0 or (select balance from move_bank where staff = 'mm-boss') is distinct from 0::numeric then
    raise exception 'the bank was not charged 2 (one move, one request): %, balance %', r, (select balance from move_bank where staff = 'mm-boss');
  end if;
  if jsonb_array_length(r -> 'requests') is distinct from 3 then raise exception 'the meeting did not return 3 rulings to post: %', r -> 'requests'; end if;
  if (select e ->> 'ruling' from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x1) is distinct from 'fulfill'
     or (select e ->> 'ruling' from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x2) is distinct from 'reject'
     or exists (select 1 from jsonb_array_elements(r -> 'requests') e join acts a on a.id = (e ->> 'postAct')::uuid where (e ->> 'id')::bigint = x2 and a.payload ->> 'body' = 'Also done.') then
    raise exception 'the rulings are not as answered, or the cut fulfill is a reject that still posts the line written for a grant: %', r -> 'requests';
  end if;
  if (select count(*) from queued_moves) is distinct from queued_before + 2 then raise exception 'the meeting queued % moves, the Boss''s own and the granted request''s', (select count(*) from queued_moves) - queued_before; end if;
  if (select count(*) from staff_request_rulings) is distinct from rulings_before + 3 then raise exception 'the meeting wrote % rulings, not 3', (select count(*) from staff_request_rulings) - rulings_before; end if;
  if not exists (select 1 from queued_moves q where q.cause_act = (s1 ->> 'request')::uuid and q.meeting = m and q.staff = 'mm-boss' and q.kind = 'moveThread') then raise exception 'the granted request''s move is not queued for the meeting'; end if;
  select record -> 'requestsRuled' into rec from meetings where id = m;
  if (rec ->> 'ruled')::integer is distinct from 3 or (rec ->> 'spent')::integer is distinct from 1 or jsonb_array_length(rec -> 'skipped') is distinct from 2 then raise exception 'the meeting''s record of its requests: %', rec; end if;
  if (select v.waiting from staff_requests_now v where v.id = x4) is distinct from true or (select v.waiting from staff_requests_now v where v.id = x5) is distinct from true then raise exception 'a request the answer skipped or left out is not waiting'; end if;

  -- A retry: the meeting is closed, so nothing is queued, ruled or charged a second time, and no ruling is handed to be posted again.
  again := apply_meeting(m, payload);
  if again ->> 'status' is distinct from 'already applied' or again ? 'requests' then raise exception 'a closed meeting was applied again: %', again; end if;
  if (select count(*) from queued_moves) is distinct from queued_before + 2 or (select count(*) from staff_request_rulings) is distinct from rulings_before + 3
     or (select balance from move_bank where staff = 'mm-boss') is distinct from 0::numeric then raise exception 'a retried meeting queued, ruled or charged again'; end if;
  -- The same answers for a later meeting do not rule on a ruled request again.
  if requests_ruled(m, payload -> 'requests', 5) -> 'rulings' <> '[]'::jsonb then raise exception 'a ruled request was ruled again'; end if;
end $$;

-- ---- 14c. The bank the engine plans from is the bank SQL charges ----
-- The engine's repair (engine/system/meeting.test.ts, "the bank the requests pay from counts ...") plans, from a bank of 5: the Boss's own move 1, its own bundle of 2 parts, one fulfill 1, and the one Mod's allowance cut to
-- the 1 that is left. apply_meeting is handed exactly that answer and must pay exactly that: 4 queued for the Boss and 1 handed to the Mod, the balance 0, with nothing cut and nothing skipped.
do $$
declare
  offtopic uuid := pg_temp.board('mm-offtopic');
  s1 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'cc1');
  x1 bigint;
  m bigint;
  r jsonb;
  queued_before bigint := (select count(*) from queued_moves);
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s1 ->> 'request')::uuid, (s1 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s1 ->> 'turn')::uuid, 'confer', 'mod') returning id into x1;
  perform pg_temp.bank(5);
  m := (begin_meeting('2031-05-20T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  r := apply_meeting(m, jsonb_build_object('boss', 'mm-boss', 'weekly_moves', 0, 'bank_cap', 5, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', jsonb_build_array(pg_temp.mt(pg_temp.thread_on('mm-games', 'Own move cc'), offtopic) || jsonb_build_object('go_live_at', now())),
    'bundles', jsonb_build_array(jsonb_build_object('name', 'Pair', 'beat', null, 'parts', jsonb_build_array(
      pg_temp.mt(pg_temp.thread_on('mm-games', 'Bundle one cc'), offtopic) || jsonb_build_object('go_live_at', now()),
      pg_temp.mt(pg_temp.thread_on('mm-games', 'Bundle two cc'), offtopic) || jsonb_build_object('go_live_at', now())))),
    'requests', jsonb_build_array(jsonb_build_object('id', x1, 'ruling', 'fulfill', 'move', pg_temp.mt((s1 ->> 'thread')::uuid, offtopic), 'line', 'Granted.')),
    'orders', jsonb_build_array(pg_temp.order_for('mm-m1', '[]'::jsonb, 1)),
    'record', '{}'::jsonb));
  if r ->> 'status' is distinct from 'applied' then raise exception 'the meeting was not applied: %', r; end if;
  if (r ->> 'bank_before')::numeric is distinct from 5 or (r ->> 'bank_after')::numeric is distinct from 0 or (r ->> 'handed')::integer is distinct from 1 or (select balance from move_bank where staff = 'mm-boss') is distinct from 0::numeric then
    raise exception 'SQL did not pay what the engine planned (5 = 1 move + 2 bundle parts + 1 fulfill + 1 allowance): %', r;
  end if;
  if (select count(*) from queued_moves) is distinct from queued_before + 4 or r #>> '{requests,0,ruling}' is distinct from 'fulfill' then raise exception 'the meeting did not queue the own move, the 2 parts and the granted request: %', r; end if;
  if (select record #>> '{bundlesSkipped}' from meetings where id = m) is not null and (select jsonb_array_length(record -> 'bundlesSkipped') from meetings where id = m) > 0 then raise exception 'a bundle the engine paid for was skipped'; end if;
end $$;

-- ---- 15b. The Boss's reply is written with the ruling, in the meeting's transaction ----
-- A ruling's reply is a post quoting the request in its thread, written before the ruling row, which names it (post_act): the Boss's own line when it gave one, else the stock line (requestGranted or requestRefused, filled and
-- one of the key's lines); one that cannot be written (here: a refusal by a trigger) leaves the ruling with no post_act and the reason on the row; a rolled-back meeting leaves no ruling and no reply; a retried meeting writes no second one.
create function pg_temp.refuse_reply() returns trigger language plpgsql as $$
begin
  if new.payload ->> 'body' = 'FAILME' then raise exception 'test: the reply was refused'; end if;
  return new;
end $$;
do $$
declare
  m bigint;
  offtopic uuid := pg_temp.board('mm-offtopic');
  boss_id uuid := (select c.id from characters c where c.staff = 'mm-boss');
  s1 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm1');
  s2 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm2');
  s3 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm3');
  s4 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm4');
  s5 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm5');
  s6 jsonb := pg_temp.scene('mm-m1', 'mm-games', 'bm6');
  x1 bigint; x2 bigint; x3 bigint; x4 bigint; x5 bigint; x6 bigint;
  r jsonb;
  one jsonb;
  payload jsonb;
  posts_before bigint;
  acts_before bigint;
  body text;
begin
  insert into staff_request_rulings (request, ruling) select v.id, 'reject' from staff_requests_now v where v.waiting;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s1 ->> 'request')::uuid, (s1 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s1 ->> 'turn')::uuid, 'confer', 'mod') returning id into x1;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s2 ->> 'request')::uuid, (s2 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s2 ->> 'turn')::uuid, 'confer', 'mod') returning id into x2;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s3 ->> 'request')::uuid, (s3 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s3 ->> 'turn')::uuid, 'confer', 'mod') returning id into x3;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s4 ->> 'request')::uuid, (s4 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s4 ->> 'turn')::uuid, 'confer', 'mod') returning id into x4;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s5 ->> 'request')::uuid, (s5 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s5 ->> 'turn')::uuid, 'confer', 'mod') returning id into x5;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, office) values ((s6 ->> 'request')::uuid, (s6 ->> 'thread')::uuid, pg_temp.poster(), 'mm-m1', (s6 ->> 'turn')::uuid, 'confer', 'mod') returning id into x6;
  update settings set value = value || jsonb_build_object('requestGranted', jsonb_build_array('{boss} grants {asker}.'), 'requestRefused', jsonb_build_array('{boss} refuses {asker}.')) where key = 'systemLines';
  create trigger zz_refuse_reply before insert on acts for each row execute function pg_temp.refuse_reply();

  -- A fulfill with no line (the stock line, granted), a reject with the Boss's own line, a reject with none (the stock line, refused), and a reject whose reply is refused.
  perform pg_temp.bank(5);
  m := (begin_meeting('2031-06-01T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  payload := jsonb_build_object('boss', 'mm-boss', 'weekly_moves', 0, 'bank_cap', 5, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb,
    'requests', jsonb_build_array(
      jsonb_build_object('id', x1, 'ruling', 'fulfill', 'move', pg_temp.mt((s1 ->> 'thread')::uuid, offtopic)),
      jsonb_build_object('id', x2, 'ruling', 'reject', 'line', 'Own words.'),
      jsonb_build_object('id', x3, 'ruling', 'reject'),
      jsonb_build_object('id', x4, 'ruling', 'reject', 'line', 'FAILME')),
    'record', '{}'::jsonb);
  r := apply_meeting(m, payload);
  if r ->> 'status' is distinct from 'applied' then raise exception 'the meeting was not applied: %', r; end if;
  one := (select e from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x1);
  body := (select a.payload ->> 'body' from acts a where a.id = (one ->> 'postAct')::uuid);
  if body is distinct from 'Mm Boss grants Mm Asker.' and body is distinct from (select c.name from characters c where c.staff = 'mm-boss') || ' grants ' || (select k.name from characters k where k.id = (select a.character from acts a where a.id = (s1 ->> 'request')::uuid)) || '.' then
    raise exception 'the granted ruling with no line is not replied to with the stock line, filled: %', body;
  end if;
  if (select (a.kind, a.thread, a.target_act_id, a.character) from acts a where a.id = (one ->> 'postAct')::uuid) is distinct from row('post'::text, (s1 ->> 'thread')::uuid, (s1 ->> 'request')::uuid, boss_id) then
    raise exception 'the reply is not the Boss''s post in the thread quoting the request post';
  end if;
  if (select g.post_act from staff_request_rulings g where g.request = x1) is distinct from (one ->> 'postAct')::uuid then raise exception 'the ruling row does not name the reply'; end if;
  one := (select e from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x2);
  if (select a.payload ->> 'body' from acts a where a.id = (one ->> 'postAct')::uuid) is distinct from 'Own words.' then raise exception 'the Boss''s own line was not used'; end if;
  one := (select e from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x3);
  body := (select a.payload ->> 'body' from acts a where a.id = (one ->> 'postAct')::uuid);
  if body is null or body !~ ' refuses ' or body ~ '[{}]' then raise exception 'a reject with no line is not replied to with the stock line, filled: %', body; end if;
  -- The reply that is refused: the ruling stands, with no post_act, no reply in the thread, the reason on the row and in the result.
  one := (select e from jsonb_array_elements(r -> 'requests') e where (e ->> 'id')::bigint = x4);
  if one ->> 'ruling' is distinct from 'reject' or one ->> 'postAct' is not null or one ->> 'replyFailed' not like 'the Boss''s reply was not posted: %test: the reply was refused%' then
    raise exception 'a reply that is refused did not leave the ruling alone, with its reason: %', one;
  end if;
  if (select (g.ruling, g.post_act is null, g.reason like 'the Boss''s reply was not posted:%') from staff_request_rulings g where g.request = x4) is distinct from row('reject'::text, true, true) then
    raise exception 'the ruling row of the refused reply is not a reject with no post_act and the reason';
  end if;
  if exists (select 1 from acts a where a.thread = (s4 ->> 'thread')::uuid and a.payload ->> 'body' = 'FAILME') then raise exception 'the refused reply was written anyway'; end if;
  if (select v.waiting from staff_requests_now v where v.id = x4) then raise exception 'a ruled request whose reply failed is still waiting'; end if;

  -- A fulfill the queue refuses (a thread moved to the board it is already on), with a line written for a grant: the reply is the stock refusal, never the line, and the ruling says why.
  one := requests_ruled(m, jsonb_build_array(jsonb_build_object('id', x6, 'ruling', 'fulfill', 'move', pg_temp.mt((s6 ->> 'thread')::uuid, (select board from threads where id = (s6 ->> 'thread')::uuid)), 'line', 'Granted, loudly!')), 5) -> 'rulings' -> 0;
  body := (select a.payload ->> 'body' from acts a where a.id = (one ->> 'postAct')::uuid);
  if one ->> 'ruling' is distinct from 'reject' or one ->> 'reason' is null or body is null or body !~ ' refuses ' or body ~ 'loudly' then
    raise exception 'a fulfill turned into a reject is not replied to with the stock refusal, without the grant line: %, body %', one, body;
  end if;

  -- A retry writes no second reply, ruling or charge.
  acts_before := (select count(*) from acts a where a.character = boss_id);
  if apply_meeting(m, payload) ->> 'status' is distinct from 'already applied' or (select count(*) from acts a where a.character = boss_id) is distinct from acts_before then raise exception 'a retried meeting wrote a second reply'; end if;
  if (select count(*) from staff_request_rulings g where g.request in (x1, x2, x3, x4)) is distinct from 4 then raise exception 'a retried meeting wrote a second ruling'; end if;

  -- A meeting rolled back after it ruled leaves neither the ruling nor the reply, and the request still waits.
  perform pg_temp.bank(5);
  m := (begin_meeting('2031-06-08T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  acts_before := (select count(*) from acts a where a.character = boss_id);
  posts_before := (select count(*) from staff_request_rulings);
  begin
    perform apply_meeting(m, jsonb_set(payload, '{requests}', jsonb_build_array(jsonb_build_object('id', x5, 'ruling', 'reject', 'line', 'Rolled back.'))));
    if (select count(*) from acts a where a.character = boss_id) is distinct from acts_before + 1 then raise exception 'the world: the reply was not written'; end if;
    raise exception 'the meeting died' using errcode = 'P0001';
  exception when sqlstate 'P0001' then null;
  end;
  if (select count(*) from acts a where a.character = boss_id) is distinct from acts_before or (select count(*) from staff_request_rulings) is distinct from posts_before
     or (select v.waiting from staff_requests_now v where v.id = x5) is distinct from true then raise exception 'a rolled-back meeting left a ruling or a reply'; end if;
  drop trigger zz_refuse_reply on acts;
end $$;

-- ---- 15. The moderation log lists requests ----
do $$
declare
  offtopic uuid := pg_temp.board('mm-offtopic');
  asker uuid := pg_temp.poster();
  sg jsonb; sr jsonb; sc jsonb; sb jsonb; sl jsonb;
  qid bigint;
  r record;
  n_before bigint := (select count(*) from moves_log where kind = 'request');
begin
  -- Five requests: the Boss's granted one, a Mod's refusal, its confer (ruled by a meeting later), a lapsed confer, and the Boss's confer (waiting).
  perform pg_temp.bank(5);
  sg := pg_temp.scene('mm-boss', 'mm-games', 'log granted');
  perform rule_request('mm-boss', (sg ->> 'request')::uuid, (sg ->> 'turn')::uuid, 'fulfill', pg_temp.mt((sg ->> 'thread')::uuid, offtopic), 0, 20);
  sr := pg_temp.scene('mm-m1', 'mm-games', 'log refused');
  perform rule_request('mm-m1', (sr ->> 'request')::uuid, (sr ->> 'turn')::uuid, 'reject', null);
  sc := pg_temp.scene('mm-m1', 'mm-games', 'log ruled');
  perform rule_request('mm-m1', (sc ->> 'request')::uuid, (sc ->> 'turn')::uuid, 'confer', null);
  sl := pg_temp.scene('mm-m1', 'mm-games', 'log lapsed');
  perform rule_request('mm-m1', (sl ->> 'request')::uuid, (sl ->> 'turn')::uuid, 'confer', null);
  sb := pg_temp.scene('mm-boss', 'mm-games', 'log boss');
  perform rule_request('mm-boss', (sb ->> 'request')::uuid, (sb ->> 'turn')::uuid, 'confer', null);

  if (select count(*) from moves_log where kind = 'request') is distinct from n_before + 5 then raise exception 'moves_log lists % new requests, not 5', (select count(*) from moves_log where kind = 'request') - n_before; end if;
  -- Only for the staff member that ruled.
  if exists (select 1 from moves_log where kind = 'request' and staff = 'mm-m2' and thread in ((sg ->> 'thread')::uuid, (sr ->> 'thread')::uuid, (sc ->> 'thread')::uuid, (sl ->> 'thread')::uuid)) then raise exception 'a request is listed for a Mod that did not rule on it'; end if;
  if (select count(*) from moves_log where kind = 'request' and staff = 'mm-m1' and thread in ((sr ->> 'thread')::uuid, (sc ->> 'thread')::uuid, (sl ->> 'thread')::uuid)) is distinct from 3
     or (select count(*) from moves_log where kind = 'request' and staff = 'mm-boss' and thread in ((sg ->> 'thread')::uuid, (sb ->> 'thread')::uuid)) is distinct from 2 then
    raise exception 'the requests are not listed one for each, for their own staff member';
  end if;

  -- A granted one (the Boss's, whose seat it held): the request post's number, the thread's title, the first ruling, the office, the move's kind; nothing ended it.
  select * into r from moves_log where id = (sg ->> 'request')::uuid and staff = 'mm-boss';
  if r.kind is distinct from 'request' or r.thread is distinct from (sg ->> 'thread')::uuid or r.at is null or r.demand is not null or r.expires_at is not null or r.ended_why is not null or r.kept_by is not null
     or r.params -> 'post' is distinct from to_jsonb((select seq from acts where id = (sg ->> 'request')::uuid))
     or r.params ->> 'title' is distinct from 'Req log granted' or r.params ->> 'thread' is distinct from sg ->> 'thread'
     or r.params ->> 'ruling' is distinct from 'fulfill' or r.params ->> 'by' is distinct from 'boss' or r.params ->> 'move_kind' is distinct from 'moveThread' or r.params ->> 'ruled' is distinct from 'fulfill' or r.params ->> 'lapses_at' is not null then
    raise exception 'a granted request is wrong in the log: %', to_jsonb(r);
  end if;
  -- The row carries no private fact: its params are exactly these keys, and nothing in the row names the asker or its owner.
  if (select array_agg(k order by k) from jsonb_object_keys(r.params) k) is distinct from array['by', 'lapses_at', 'move_kind', 'post', 'ruled', 'ruling', 'thread', 'title'] then raise exception 'a request row carries other keys: %', r.params; end if;
  if to_jsonb(r)::text like '%' || asker::text || '%' or to_jsonb(r)::text like '%' || (select owner::text from characters where id = asker) || '%' then raise exception 'a request row names its asker or the asker''s account: %', to_jsonb(r); end if;
  -- A refusal: no move, no end. A confer by a Mod passes it to the Boss; the Boss's takes it to the meeting.
  select * into r from moves_log where id = (sr ->> 'request')::uuid and staff = 'mm-m1';
  if r.params ->> 'ruling' is distinct from 'reject' or r.params ->> 'by' is distinct from 'mod' or r.params ->> 'move_kind' is not null or r.ended_why is not null or r.params ->> 'ruled' is distinct from 'reject' then raise exception 'a refused request is wrong in the log: %', to_jsonb(r); end if;
  select * into r from moves_log where id = (sc ->> 'request')::uuid and staff = 'mm-m1';
  if r.params ->> 'ruling' is distinct from 'confer' or r.params ->> 'by' is distinct from 'mod' or r.ended_why is not null or r.ended_at is not null or r.params ->> 'ruled' is not null
     or (r.params ->> 'lapses_at')::timestamptz is distinct from (select v.lapses_at from staff_requests_now v where v.request_act = (sc ->> 'request')::uuid) then
    raise exception 'a waiting confer is wrong in the log (waiting, with its lapse date): %', to_jsonb(r);
  end if;
  select * into r from moves_log where id = (sb ->> 'request')::uuid and staff = 'mm-boss';
  if r.params ->> 'ruling' is distinct from 'confer' or r.params ->> 'by' is distinct from 'boss' or r.ended_why is not null then raise exception 'the Boss''s confer is wrong in the log: %', to_jsonb(r); end if;

  -- The office is the one the ruling was made in, recorded when it was made: seasons.boss is filled in after a season opens, so a ruling read back from it would say 'mod' for the Boss's own.
  update seasons set boss = null where boss = 'mm-boss';
  if (select count(*) from moves_log where kind = 'request' and staff = 'mm-boss' and params ->> 'by' = 'boss' and thread in ((sg ->> 'thread')::uuid, (sb ->> 'thread')::uuid)) is distinct from 2
     or exists (select 1 from moves_log where kind = 'request' and staff = 'mm-m1' and params ->> 'by' is distinct from 'mod' and thread in ((sr ->> 'thread')::uuid, (sc ->> 'thread')::uuid, (sl ->> 'thread')::uuid)) then
    raise exception 'a request ruled by the Boss does not say boss once seasons.boss is not filled in, or a Mod''s says boss: %', (select jsonb_agg(jsonb_build_array(staff, params ->> 'by')) from moves_log where kind = 'request' and thread in ((sg ->> 'thread')::uuid, (sr ->> 'thread')::uuid, (sc ->> 'thread')::uuid, (sl ->> 'thread')::uuid, (sb ->> 'thread')::uuid));
  end if;

  -- A meeting's ruling and a lapse each end a confer, with a new row beside it.
  qid := (select id from staff_requests where request_act = (sc ->> 'request')::uuid and staff = 'mm-m1');
  insert into staff_request_rulings (request, ruling, move) values (qid, 'fulfill', (select max(id) from queued_moves));
  select * into r from moves_log where id = (sc ->> 'request')::uuid and staff = 'mm-m1';
  if r.ended_why is distinct from 'fulfill' or r.ended_at is null or r.params ->> 'ruling' is distinct from 'confer' or r.params ->> 'ruled' is distinct from 'fulfill' or r.params ->> 'lapses_at' is not null then raise exception 'a confer the meeting granted is wrong in the log: %', to_jsonb(r); end if;
  qid := (select id from staff_requests where request_act = (sl ->> 'request')::uuid and staff = 'mm-m1');
  insert into staff_request_rulings (request, ruling) values (qid, 'lapsed');
  select * into r from moves_log where id = (sl ->> 'request')::uuid and staff = 'mm-m1';
  if r.ended_why is distinct from 'lapsed' or r.params ->> 'ruled' is distinct from 'lapsed' or r.params ->> 'lapses_at' is not null then raise exception 'a lapsed confer is wrong in the log: %', to_jsonb(r); end if;

  -- The clients read it, as every row of the log.
  if not has_table_privilege('anon', 'moves_log', 'select') or not has_table_privilege('authenticated', 'moves_log', 'select') then raise exception 'moves_log is not readable by the clients'; end if;
end $$;

-- ---- 15b. A staff member's requests are paged by an index ----
-- The request branch of moves_log is read for one staff key, newest first by (at, request_act), a page at a time: staff_requests_staff_at serves that keyset, so a busy instance's page is read from the index and
-- never from all the requests the staff member has ruled on. Planned with the sequential scan off (as 0036 does): on a table this small the planner scans whatever the indexes are.
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare ln record; out text := '';
begin
  for ln in execute 'explain ' || q loop out := out || E'\n' || ln."QUERY PLAN"; end loop;
  return out;
end $$;

do $$
declare plan text;
begin
  analyze staff_requests; analyze staff_request_rulings; analyze staff_requests_open;
  set local enable_seqscan = off;
  plan := pg_temp.plan_of('select * from staff_requests q where q.staff = ''mm-m1'' and (q.at, q.request_act) < (now(), ''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid) order by q.at desc, q.request_act desc limit 21');
  if plan !~ 'Index (Only )?Scan.* on staff_requests\y' or plan ~ 'Sort' or plan ~ 'Seq Scan on staff_requests\y' then raise exception 'the staff member''s keyset page is not served by an index in order: %', plan; end if;
  plan := pg_temp.plan_of('select * from moves_log where kind = ''request'' and staff = ''mm-m2'' and (at < now() or (at = now() and id < ''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid)) order by at desc, id desc limit 21');
  if plan !~ 'staff_requests_staff_at' then raise exception 'moves_log''s request branch does not read staff_requests by staff_requests_staff_at (a staff member with few requests among many): %', plan; end if;
  reset enable_seqscan;
end $$;
