-- The Mod's one move and the filing run's doors (supabase/migrations/0104_mod_moves.sql; the Mod Bots design, sections 2 and 6; its plan, Task 7).
--
-- 1. apply_mod_move queues a Mod's move as the Mod's: go-live now, inside the queue guard, the allowance spent by queueing it, the cause Act on the row.
-- 2. It acts once: a retry of the same cause (the filing run crashed between its two calls, or two runs raced) queues nothing a second time and spends nothing.
-- 3. It writes nothing and says why when the guard refuses (no allowance, off the beat, a kind the office does not make, a malformed rule, a Mod not on staff).
-- 4. A rule a Mod sets lasts at most modBots.ruleDaysMost days in SQL too: apply_mod_move clamps and says so; the guard refuses a direct row past it.
-- 5. cause_act never changes, and one cause queues one move for a Mod.
-- 6. filings_due: only visits whose time is past and still open, oldest first, bounded; it names no owner. mod_standing, rules_in_force and filing_calls_today.
-- 7. The doors are the service's alone, and the staff schedule is the settings trigger's.

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
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule')),
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
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
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
    pg_temp.order_for('mm-m1', jsonb_build_array(pg_temp.board('mm-games')), 2, 'Crack down on bumping in Games.'),
    pg_temp.order_for('mm-m2', jsonb_build_array(pg_temp.board('mm-general')), 1)));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'mm-ann@test.invalid' $$;
-- A fresh post of a player's, to be a cause (any Act is one).
create function pg_temp.poster() returns uuid language sql as $$ select id from characters where name = 'Mm Poster' $$;
create function pg_temp.cause(label text) returns uuid language sql as $$
  select tests.post(pg_temp.poster(), tests.thread('Cause ' || label), 'A post.')
$$;

-- ---- 1. A Mod's move is queued as the Mod's, now, and spends the allowance ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  cause uuid := pg_temp.cause('one');
  got jsonb;
  q queued_moves%rowtype;
begin
  if mod_allowance('mm-m1') is distinct from 2 then raise exception 'the world: mm-m1 holds %', mod_allowance('mm-m1'); end if;
  got := apply_mod_move('mm-m1', pg_temp.mv(games, 48), cause);
  if got ->> 'move' is null or (got ->> 'queued')::boolean is distinct from true then raise exception 'the move was not queued: %', got; end if;
  select * into q from queued_moves where id = (got ->> 'move')::bigint;
  if q.staff is distinct from 'mm-m1' or q.kind is distinct from 'setRule' or q.structural or q.cause_act is distinct from cause then raise exception 'the queued row is wrong: %', to_jsonb(q); end if;
  if q.go_live_at > now() + interval '5 seconds' or q.go_live_at < now() - interval '5 seconds' then raise exception 'the move does not go live now: %', q.go_live_at; end if;
  if q.expires_at is distinct from q.go_live_at + interval '48 hours' then raise exception 'the expiry is not 48 hours after go-live: % %', q.go_live_at, q.expires_at; end if;
  if q.why is distinct from 'Shouting.' or q.params ->> 'board' is distinct from games::text or q.params ->> 'predicate' is distinct from 'noAllCaps' then raise exception 'the params: %', to_jsonb(q); end if;
  if q.spent_order is distinct from (select max(o.id) from staff_orders o where o.staff = 'mm-m1') or q.meeting is distinct from (select o.meeting from staff_orders o where o.id = q.spent_order) then
    raise exception 'the row is charged to the wrong order: %', to_jsonb(q);
  end if;
  if mod_allowance('mm-m1') is distinct from 1 then raise exception 'queueing did not spend the allowance: %', mod_allowance('mm-m1'); end if;
  if got ->> 'trimmed' is not null then raise exception 'a move within the cap says it was trimmed: %', got; end if;

  -- ---- 2. A retry of the same cause queues nothing and spends nothing ----
  got := apply_mod_move('mm-m1', pg_temp.mv(games, 48), cause);
  if (got ->> 'move')::bigint is distinct from q.id or (got ->> 'queued')::boolean is distinct from false or (got ->> 'existing')::boolean is distinct from true then raise exception 'a retry did not find its move: %', got; end if;
  if (select count(*) from queued_moves where staff = 'mm-m1' and cause_act = cause) is distinct from 1::bigint then raise exception 'a retry queued the move twice'; end if;
  if mod_allowance('mm-m1') is distinct from 1 then raise exception 'a retry spent a second allowance: %', mod_allowance('mm-m1'); end if;
  -- Even a retry whose move differs (a model answers differently the second time) finds the first and queues no other.
  got := apply_mod_move('mm-m1', pg_temp.mv(games, 24, 'bannedWord', 'Another.'), cause);
  if (got ->> 'move')::bigint is distinct from q.id or (select count(*) from queued_moves where staff = 'mm-m1' and cause_act = cause) is distinct from 1::bigint then raise exception 'a different retry queued a second move: %', got; end if;
end $$;

-- ---- 3. The allowance runs out, and a refusal writes nothing and says why ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  general uuid := pg_temp.board('mm-general');
  offtopic uuid := pg_temp.board('mm-offtopic');
  c2 uuid := pg_temp.cause('two');
  c3 uuid := pg_temp.cause('three');
  before_n bigint := (select count(*) from queued_moves);
  got jsonb;
begin
  got := apply_mod_move('mm-m1', pg_temp.mv(games, 24, 'bannedWord', 'Second.'), c2);
  if got ->> 'move' is null then raise exception 'the second allowance was not spent: %', got; end if;
  if mod_allowance('mm-m1') is distinct from 0 then raise exception 'mm-m1 should be out of allowance: %', mod_allowance('mm-m1'); end if;
  before_n := (select count(*) from queued_moves);
  got := apply_mod_move('mm-m1', pg_temp.mv(games), c3);
  if got ->> 'move' is not null or (got ->> 'queued')::boolean is distinct from false or got ->> 'reason' not like '%allowance%' then raise exception 'a Mod with no allowance queued a move or did not say why: %', got; end if;
  if (select count(*) from queued_moves) is distinct from before_n then raise exception 'a refusal wrote a row'; end if;
  -- Mod Two holds 1: off its beat (Games is Mod One's), a kind its office does not make, a malformed rule and a house rule are each refused, and none spends the one it has.
  got := apply_mod_move('mm-m2', pg_temp.mv(games), c3);
  if got ->> 'move' is not null or got ->> 'reason' not like '%beat%' then raise exception 'a move off the beat: %', got; end if;
  got := apply_mod_move('mm-m2', jsonb_build_object('kind', 'renameBoard', 'params', jsonb_build_object('board', general, 'name', 'X', 'premise', 'p', 'description', 'd'), 'expires_in_hours', 48, 'why', 'No.'), c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a Mod queued a rename: %', got; end if;
  got := apply_mod_move('mm-m2', pg_temp.mv(general, 48, 'noSuchPredicate'), c3);
  if got ->> 'move' is not null or got ->> 'reason' not like '%malformed%' then raise exception 'a malformed rule: %', got; end if;
  got := apply_mod_move('mm-m2', jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'expires_in_hours', 48, 'why', 'House.'), c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a Mod made a house rule: %', got; end if;
  got := apply_mod_move('mm-m2', jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', general, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'expires_in_hours', 48, 'why', '   '), c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a move with a blank why was queued: %', got; end if;
  got := apply_mod_move('mm-m2', pg_temp.mv(general, 48) - 'expires_in_hours', c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a move with no expiry was queued: %', got; end if;
  if mod_allowance('mm-m2') is distinct from 1 then raise exception 'refusals spent the allowance: %', mod_allowance('mm-m2'); end if;
  -- A member, a stranger and a Boss-less key are refused too; the Boss is not a Mod and has no allowance to spend this way.
  got := apply_mod_move('mm-m3', pg_temp.mv(games), c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a member queued a move: %', got; end if;
  got := apply_mod_move('nobody-at-all', pg_temp.mv(games), c3);
  if got ->> 'move' is not null or got ->> 'reason' is null then raise exception 'a stranger queued a move: %', got; end if;
  if pg_temp.refusal(format('select apply_mod_move(%L, %L::jsonb, null)', 'mm-m2', pg_temp.mv(general))) is null then raise exception 'a move with no cause was queued'; end if;
  if pg_temp.refusal(format('select apply_mod_move(%L, %L::jsonb, gen_random_uuid())', 'mm-m2', pg_temp.mv(general))) is null then raise exception 'a move whose cause is no Act was queued'; end if;
  if (select count(*) from queued_moves) is distinct from before_n then raise exception 'a refusal wrote a row'; end if;
  -- Mod Two spends its one on its own beat, and the move is its own.
  got := apply_mod_move('mm-m2', pg_temp.mv(general), c3);
  if got ->> 'move' is null or mod_allowance('mm-m2') is distinct from 0 then raise exception 'mm-m2 could not spend its allowance: %', got; end if;
end $$;

-- ---- 4. A Mod's rule lasts at most ruleDaysMost days, in SQL ----
do $$
declare
  games uuid := pg_temp.board('mm-games');
  c4 uuid := pg_temp.cause('four');
  m bigint;
  got jsonb;
  q queued_moves%rowtype;
  said text;
begin
  -- A fresh order for Mod One: 3 more.
  m := pg_temp.meet('2031-02-02T09:00:00Z', jsonb_build_array(pg_temp.order_for('mm-m1', jsonb_build_array(games), 3), pg_temp.order_for('mm-m2', jsonb_build_array(pg_temp.board('mm-general')), 0)));
  if mod_allowance('mm-m1') is distinct from 3 then raise exception 'mm-m1 should hold 3: %', mod_allowance('mm-m1'); end if;
  -- apply_mod_move clamps an expiry past the cap and says so.
  got := apply_mod_move('mm-m1', pg_temp.mv(games, 500), c4);
  select * into q from queued_moves where id = (got ->> 'move')::bigint;
  if q.expires_at is distinct from q.go_live_at + interval '7 days' then raise exception 'a 500-hour rule was not held to 7 days: % to %', q.go_live_at, q.expires_at; end if;
  if got #>> '{trimmed,expires_in_hours,before}' is distinct from '500' or got #>> '{trimmed,expires_in_hours,after}' is distinct from '168' then raise exception 'the clamp is not recorded: %', got; end if;
  -- The guard holds it too, for a row that did not come through apply_mod_move: 8 days is refused, exactly 7 is queued.
  said := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
    values (%s, 'mm-m1', 'setRule', jsonb_build_object('board', %L::uuid, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'Because.', now(), now() + interval '8 days', false)$q$, m, games));
  if said is null or said not like '23514%' or said not like '%at most 7 days%' then raise exception 'a Mod''s rule past the cap was queued directly: %', said; end if;
  said := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
    values (%s, 'mm-m1', 'setRule', jsonb_build_object('board', %L::uuid, 'predicate', 'bannedWord', 'param', 'zzz', 'band', 'minor'), 'Because.', now(), now() + interval '7 days', false)$q$, m, games));
  if said is not null then raise exception 'a Mod''s rule at exactly the cap was refused: %', said; end if;
  -- The Boss is not held to a Mod's cap: its phase bounds it, and its own rule of 30 days queues.
  said := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
    values (%s, 'mm-boss', 'setRule', jsonb_build_object('board', %L::uuid, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'Because.', now(), now() + interval '30 days', false)$q$, m, games));
  if said is not null then raise exception 'the Boss was held to a Mod''s cap: %', said; end if;
end $$;

-- ---- 5. cause_act never changes, and one cause queues one move for a Mod ----
do $$
declare
  c5 uuid := pg_temp.cause('five');
  other uuid := pg_temp.cause('six');
  qid bigint := (select id from queued_moves where staff = 'mm-m1' and cause_act is not null order by id limit 1);
  said text;
begin
  said := pg_temp.refusal(format('update queued_moves set cause_act = %L where id = %s', other, qid));
  if said is null or said not like '23514%' then raise exception 'a queued move''s cause was changed: %', said; end if;
  said := pg_temp.refusal(format('update queued_moves set cause_act = null where id = %s', qid));
  if said is null then raise exception 'a queued move''s cause was taken away'; end if;
  said := pg_temp.refusal(format($q$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, cause_act)
    select meeting, staff, kind, params, why, go_live_at, expires_at, structural, cause_act from queued_moves where id = %s$q$, qid));
  if said is null or said not like '23505%' then raise exception 'one cause queued two moves for a Mod: %', said; end if;
  -- A move not caused by an Act (a meeting's) has no cause and any number of them queue.
  if exists (select 1 from queued_moves where staff = 'mm-boss' and cause_act is not null) then raise exception 'a Boss''s move carries a cause'; end if;
  perform c5;
end $$;

-- ---- 6. filings_due, mod_standing, rules_in_force, filing_calls_today ----
create function pg_temp.visit(staff text, post uuid, ends timestamptz, rule text default 'Rule 1: no all-caps posts') returns uuid language plpgsql as $$
declare t uuid := (select thread from acts where id = post);
begin
  return (write_staff_act(staff, 'visit', t, post, jsonb_build_object(
    'charges', jsonb_build_array(jsonb_build_object('rule', rule, 'rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', post::text)),
    'ends_at', ends, 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.')) ->> 'id')::uuid;
end $$;

do $$
declare
  games uuid := pg_temp.board('mm-games');
  general uuid := pg_temp.board('mm-general');
  c uuid := pg_temp.poster();
  t1 uuid; p_old uuid; p_new uuid; p_future uuid; p_failed uuid;
  v_old uuid; v_new uuid; v_future uuid; v_failed uuid;
  due jsonb;
  mine jsonb;
begin
  insert into threads (board, title) values (games, 'Filing thread') returning id into t1;
  p_old := tests.post(c, t1, 'FIRST SHOUT');
  p_new := tests.post(c, t1, 'SECOND SHOUT');
  p_future := tests.post(c, t1, 'THIRD SHOUT');
  p_failed := tests.post(c, t1, 'FOURTH SHOUT');
  v_old := pg_temp.visit('mm-m1', p_old, now() - interval '3 hours');
  v_new := pg_temp.visit('mm-m1', p_new, now() - interval '1 minute');
  v_future := pg_temp.visit('mm-m1', p_future, now() + interval '2 hours');
  v_failed := pg_temp.visit('mm-m1', p_failed, now() - interval '2 hours');
  update visits_open set failed_at = now(), attempts = 1 where visit_act = v_failed;
  due := filings_due(50);
  mine := (select jsonb_agg(e order by ord) from jsonb_array_elements(due) with ordinality x(e, ord) where (e ->> 'visit')::uuid in (v_old, v_new, v_future, v_failed));
  if jsonb_array_length(mine) is distinct from 2 then raise exception 'filings_due should list the two due, open visits that have not failed: %', mine; end if;
  if (mine -> 0 ->> 'visit')::uuid is distinct from v_old or (mine -> 1 ->> 'visit')::uuid is distinct from v_new then raise exception 'filings_due is not oldest first: %', mine; end if;
  if mine -> 0 ->> 'staff' is distinct from 'mm-m1' or (mine -> 0 ->> 'post')::uuid is distinct from p_old or (mine -> 0 ->> 'thread')::uuid is distinct from t1 then raise exception 'the due visit''s facts: %', mine -> 0; end if;
  if mine -> 0 #>> '{board,name}' is distinct from 'Games' or mine -> 0 #>> '{board,premise}' is distinct from 'Talk about games.' or (mine -> 0 #>> '{board,id}')::uuid is distinct from games then raise exception 'the board: %', mine -> 0 -> 'board'; end if;
  if mine -> 0 #>> '{charges,0,rule}' is distinct from 'Rule 1: no all-caps posts' then raise exception 'the charges: %', mine -> 0 -> 'charges'; end if;
  -- Never before its time: the visit with two hours to run is not listed even though it is open.
  if exists (select 1 from jsonb_array_elements(due) e where (e ->> 'visit')::uuid = v_future) then raise exception 'filings_due listed a visit before its end'; end if;
  -- The limit bounds it.
  if jsonb_array_length(filings_due(1)) is distinct from 1 then raise exception 'filings_due ignored its limit'; end if;
  -- Nothing about an owner.
  if due::text ~* (pg_temp.ann()::text) or due::text ~* 'owner' then raise exception 'filings_due names an owner: %', due; end if;
  -- A filed visit is no longer due.
  perform file_visit(v_old, 'Filed.');
  if exists (select 1 from jsonb_array_elements(filings_due(50)) e where (e ->> 'visit')::uuid = v_old) then raise exception 'a filed visit is still due'; end if;

  -- mod_standing: the office, what is left, the Boss's order, the beat's boards.
  mine := mod_standing('mm-m1');
  if mine ->> 'office' is distinct from 'mod' or (mine ->> 'allowance')::integer is distinct from mod_allowance('mm-m1') or mine ->> 'order' is distinct from 'Watch mm-m1''s boards.' then raise exception 'mod_standing: %', mine; end if;
  if not (mine -> 'beat') @> jsonb_build_array(jsonb_build_object('id', games, 'name', 'Games')) then raise exception 'the beat is missing Games: %', mine; end if;
  if mine -> 'beat' @> jsonb_build_array(jsonb_build_object('id', general, 'name', 'General')) then raise exception 'the beat holds a board of the other Mod: %', mine; end if;
  if mod_standing('mm-m3') ->> 'office' is distinct from 'member' or (mod_standing('mm-m3') ->> 'allowance')::integer is distinct from 0 or jsonb_array_length(mod_standing('mm-m3') -> 'beat') is distinct from 0 then raise exception 'a member''s standing: %', mod_standing('mm-m3'); end if;
  if mod_standing('nobody-at-all') ->> 'office' is not null then raise exception 'a stranger has an office: %', mod_standing('nobody-at-all'); end if;

  -- rules_in_force: the board's rules and the house's, numbered.
  perform pg_temp.rule(games, 'noAllCaps', null, 'minor');
  perform pg_temp.rule(games, 'bannedWord', '"zzz"'::jsonb, 'severe');
  perform pg_temp.rule(null, 'noAllCaps', null, 'moderate');
  mine := rules_in_force(games);
  if jsonb_array_length(mine) is distinct from 3 then raise exception 'rules_in_force should hold the board''s two and the house''s one: %', mine; end if;
  if (select count(*) from jsonb_array_elements(mine) e where e ->> 'board' is null) is distinct from 1::bigint then raise exception 'the house rule is missing: %', mine; end if;
  if not exists (select 1 from jsonb_array_elements(mine) e where e ->> 'predicate' = 'bannedWord' and e ->> 'param' = 'zzz' and e ->> 'band' = 'severe' and (e ->> 'number')::integer = 2) then raise exception 'the numbered rule is missing: %', mine; end if;
  if jsonb_array_length(rules_in_force(general)) is distinct from 1 then raise exception 'General holds only the house rule: %', rules_in_force(general); end if;

  -- filing_calls_today: the instance-wide count of today's filing calls, not yesterday's, not another duty's.
  insert into model_calls (at, duty, staff, provider, model, cost_microdollars, outcome) values
    (now(), 'filing', 'mm-m1', 'fake', 'fake', 0, 'ok'), (now(), 'filing', 'mm-m2', 'fake', 'fake', 0, 'failed'), (now(), 'chatter', 'mm-m2', 'fake', 'fake', 0, 'ok'),
    (date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 minute', 'filing', 'mm-m1', 'fake', 'fake', 0, 'ok');
  if filing_calls_today() is distinct from (select count(*)::integer from model_calls where duty = 'filing' and at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') or filing_calls_today() < 2 then
    raise exception 'filing_calls_today: %', filing_calls_today();
  end if;
end $$;

-- ---- 7. The doors are the service's, and the schedule is the settings trigger's ----
do $$
declare
  who text; denied boolean; fn text; cmd text; sched text;
  call_move text := format('select apply_mod_move(%L, %L::jsonb, gen_random_uuid())', 'mm-m1', pg_temp.mv(gen_random_uuid()));
begin
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    foreach fn in array array[
      call_move, 'select filings_due(5)', 'select mod_standing(''mm-m1'')',
      'select rules_in_force(gen_random_uuid())', 'select filing_calls_today()', 'select schedule_staff()'] loop
      denied := false;
      begin execute fn; exception when insufficient_privilege then denied := true; end;
      if not denied then raise exception '% can call %', who, fn; end if;
    end loop;
    perform tests.unbecome();
  end loop;
  if (select count(*) from pg_trigger where tgname = 'settings_reschedule_staff' and not tgisinternal) is distinct from 1::bigint then raise exception 'the modBots setting does not reschedule the filing run'; end if;
  update settings set value = jsonb_set(value, '{filingCron}', '"7,37 * * * *"') where key = 'modBots';
  select schedule, command into sched, cmd from cron.job where jobname = 'kayfabb-staff';
  if sched is distinct from '7,37 * * * *' then raise exception 'the filing run is scheduled at %', sched; end if;
  if cmd !~ '/functions/v1/staff' or cmd !~ 'kayfabb_jobs_key' or cmd ~ 'kayfabb_service_key' then raise exception 'the filing job: %', cmd; end if;
  delete from vault.decrypted_secrets where name in ('kayfabb_functions_url', 'kayfabb_service_key', 'kayfabb_jobs_key');
  delete from net.http_request_queue;
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the filing job sent a request with no secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'https://project.example');
  insert into vault.decrypted_secrets values ('kayfabb_jobs_key', 'sb_secret_jobs');
  execute cmd;
  if (select count(*) from net.http_request_queue) is distinct from 1::bigint then raise exception 'the filing job did not send once with both secrets'; end if;
end $$;
