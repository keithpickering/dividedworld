-- Orders, beats, allowances and the Mods' memory (supabase/migrations/0103_orders.sql; the Mod Bots design, sections 2 and 3; its plan, Task 4).
--
-- 1. The seed carries each persona's beat preferences (staff_beats), once however often it runs.
-- 2. beat_of: a board named by a Mod's latest order; else a Mod whose beat preference matches the board's slug, then the one with the fewest
--    boards, then the first by key; and it answers whenever a Mod is on staff.
-- 3. apply_meeting writes the orders, charges the bank for the allowances, writes each Mod's memory, skips what the queue would refuse (a rule
--    in conflict) without failing the meeting, and clamps what a Mod may hold.
-- 4. The queue guard: a move needs an office its kind names, a Mod's rule needs a board of its beat and an allowance left.
-- 5. mod_allowance: what a Mod has not spent, not counting a rule the tick refused at landing or an admin held.
-- 6. The Boss's bank: unspent allowances return before the next meeting, never above the cap, exactly once; a retried meeting does nothing; a
--    failed meeting returns nothing; a Mod off staff has its unspent allowance returned all the same.

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

-- A setRule move in force, as the tick will have landed it.
create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'od-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

create function pg_temp.rule_move(on_board uuid, predicate text, param jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', 'minor'),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', on_board, 'count', 5)), 'go_live_at', now(), 'expires_in_hours', 24, 'why', 'Because.')
$$;

create function pg_temp.memory(hobby text, opinions jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', opinions, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;

create function pg_temp.order_for(mod text, boards jsonb, allowance integer, mem jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', boards, 'order', 'Watch ' || mod || '''s boards.', 'allowance', allowance)
    || case when mem is null then '{}'::jsonb else jsonb_build_object('memory', mem) end
$$;

create function pg_temp.payload(moves jsonb, orders jsonb, cap integer default 10) returns jsonb language sql as $$
  select jsonb_build_object('boss', 'od-boss', 'weekly_moves', 0, 'bank_cap', cap,
    'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', moves, 'orders', orders, 'record', '{}'::jsonb)
$$;

create function pg_temp.bank() returns numeric language sql as $$ select balance from move_bank where staff = 'od-boss' $$;

create function pg_temp.queue(who text, on_board uuid, in_meeting bigint, kind text default 'setRule') returns bigint language sql as $$
  insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
  values (in_meeting, who, kind,
    case kind when 'setRule' then jsonb_build_object('board', on_board, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor')
              else jsonb_build_object('board', on_board, 'name', 'Renamed', 'premise', 'p', 'description', 'd') end,
    'Because.', now() + interval '1 hour', now() + interval '2 days', kind = 'renameBoard')
  returning id
$$;

-- ---- 0. The world: a Boss, two Mods on staff, a member, three boards, and the settings the meeting reads ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'od-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'od-boss', 'name', 'Order Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'od-m1', 'name', 'Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', jsonb_build_array('games', 'nowhere')),
        jsonb_build_object('key', 'od-m2', 'name', 'Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'od-m3', 'name', 'Member Three', 'title', 'Member', 'signature', 'Hi', 'beats', jsonb_build_array('games'))),
      'firstStaff', jsonb_build_array('od-m1', 'od-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'minLength', 'param', 'count', 'least', 1, 'most', 200, 'plain', 'posts of at least {param} characters'),
        jsonb_build_object('key', 'maxLength', 'param', 'count', 'least', 20, 'most', 20000, 'plain', 'posts of at most {param} characters'),
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'),
        jsonb_build_object('key', 'requiredWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'every post says "{param}"'))));
  perform seed_instance(seed);
  -- A reseed with changed beats replaces them: the persona's list is the seed's, once.
  perform seed_instance(seed);
  if (select array_agg(slug order by slug) from staff_beats where staff = 'od-m1') is distinct from array['games', 'nowhere'] then
    raise exception 'the seed did not carry od-m1''s beats once: %', (select array_agg(slug) from staff_beats where staff = 'od-m1');
  end if;
  seed := jsonb_set(seed, '{system,staff,1,beats}', jsonb_build_array('games'));
  perform seed_instance(seed);
  if (select array_agg(slug order by slug) from staff_beats where staff = 'od-m1') is distinct from array['games'] then raise exception 'a reseed did not replace the beats'; end if;
  if exists (select 1 from staff_beats where staff = 'od-boss') then raise exception 'a persona with no beats has beat rows'; end if;
  -- od-m3 holds the member office; od-m1 and od-m2 are Mods from the seed.
  update characters set debuted_at = now() where staff = 'od-m3';
  insert into staff_offices (staff, office, cause) values ('od-m3', 'member', 'admin');
  insert into boards (slug, name) values ('games', 'Games'), ('od-general', 'General'), ('od-offtopic', 'Off Topic');
  insert into move_bank (staff, balance, as_of) values ('od-boss', 6, now());
  perform tests.account('od-admin');
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

-- ---- 1. beat_of: named first; else the preference; else the fewest boards, then the key; it always answers while a Mod is on staff ----
do $$
declare
  games uuid := pg_temp.board('games');
  general uuid := pg_temp.board('od-general');
  offtopic uuid := pg_temp.board('od-offtopic');
  m bigint;
begin
  -- No orders: a preference match answers (od-m1 likes the slug games); no match: both hold none, so the first by key.
  if beat_of(games) is distinct from 'od-m1' then raise exception 'a board matching a Mod''s preference is not its beat: %', beat_of(games); end if;
  if beat_of(general) is distinct from 'od-m1' then raise exception 'with no orders and no preference the first Mod by key answers: %', beat_of(general); end if;
  if beat_of(gen_random_uuid()) is distinct from 'od-m1' then raise exception 'beat_of did not answer for an unknown board'; end if;
  if beat_of(null) is distinct from 'od-m1' then raise exception 'beat_of did not answer for no board'; end if;
  -- A member is no Mod: od-m3 likes games and is never the answer.
  if beat_of(games) = 'od-m3' then raise exception 'a member answered for a beat'; end if;
  -- It answers while any Mod is on staff, and only a Mod: bench od-m1, and od-m2 answers for everything.
  insert into staff_offices (staff, office, cause) values ('od-m1', 'benched', 'admin');
  if beat_of(games) is distinct from 'od-m2' or beat_of(general) is distinct from 'od-m2' then raise exception 'a benched Mod answered for a beat'; end if;
  insert into staff_offices (staff, office, cause) values ('od-m2', 'benched', 'admin');
  if beat_of(games) is not null then raise exception 'beat_of answered with no Mod on staff'; end if;
  insert into staff_offices (staff, office, cause) values ('od-m1', 'mod', 'admin'), ('od-m2', 'mod', 'admin');
  if beat_of(games) is distinct from 'od-m1' then raise exception 'rehired Mods did not answer'; end if;

  -- A partial order: od-m1 holds general; od-m2 nothing named. The named board is od-m1's; offtopic (no preference) goes to the Mod with the fewest
  -- boards, which is od-m2; games (a preference of od-m1) stays od-m1's although od-m1 holds more.
  m := (begin_meeting('2031-01-01T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m, pg_temp.payload('[]', jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 0))));
  if beat_of(general) is distinct from 'od-m1' then raise exception 'a board named by the latest order is not that Mod''s: %', beat_of(general); end if;
  if beat_of(offtopic) is distinct from 'od-m2' then raise exception 'a board nobody likes did not go to the Mod with the fewest boards: %', beat_of(offtopic); end if;
  if beat_of(games) is distinct from 'od-m1' then raise exception 'a preference match lost to the board count: %', beat_of(games); end if;
  -- An order naming a board takes it from a preference: od-m2 names games.
  m := (begin_meeting('2031-01-02T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m, pg_temp.payload('[]', jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 0), pg_temp.order_for('od-m2', jsonb_build_array(games), 0))));
  if beat_of(games) is distinct from 'od-m2' then raise exception 'a named board did not beat a preference: %', beat_of(games); end if;
  -- With no Mod's preference matching and both holding one board, the first by key.
  if beat_of(offtopic) is distinct from 'od-m1' then raise exception 'equal boards did not fall to the first by key: %', beat_of(offtopic); end if;
end $$;

-- ---- 2. The world for the meetings below: three boards, a rule in force on games, and a clean slate of orders ----
-- (The two meetings above wrote orders for od-m1 and od-m2 with allowance 0; their bank effect is zero.)

-- ---- 3. apply_meeting: orders, memory, the bank, clamps, a rule in conflict skipped ----
do $$
declare
  games uuid := pg_temp.board('games');
  general uuid := pg_temp.board('od-general');
  offtopic uuid := pg_temp.board('od-offtopic');
  boss_char uuid := (select id from characters where staff = 'od-boss');
  m bigint;
  r jsonb;
  mt meetings%rowtype;
begin
  update move_bank set balance = 6, as_of = now() where staff = 'od-boss';
  perform pg_temp.rule(games, 'requiredWord', '"zzz"');
  m := (begin_meeting('2031-01-03T09:00:00Z') ->> 'meeting')::bigint;
  -- The Boss makes one rule that is whole and one that clashes with the rule in force (it would be refused by the queue); orders: od-m1 asks for 5
  -- (the most is 3), names general, a board twice, and a board that does not exist; od-m2 names general again (stays with od-m1) and offtopic; a
  -- member and a stranger are skipped.
  r := apply_meeting(m, pg_temp.payload(
    jsonb_build_array(pg_temp.rule_move(general, 'noAllCaps'), pg_temp.rule_move(games, 'bannedWord', '"ZZZ"')),
    jsonb_build_array(
      pg_temp.order_for('od-m1', jsonb_build_array(general, general, gen_random_uuid()), 5,
        pg_temp.memory('crosswords', jsonb_build_array(jsonb_build_object('character', boss_char, 'score', 2, 'note', 'Fine.'), jsonb_build_object('character', gen_random_uuid(), 'score', 1, 'note', 'Who?')))),
      pg_temp.order_for('od-m2', jsonb_build_array(general, offtopic), 1, pg_temp.memory('birds')),
      pg_temp.order_for('od-m3', jsonb_build_array(games), 2, pg_temp.memory('nope')),
      pg_temp.order_for('nobody', '[]', 2))));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 1 then raise exception 'a rule in conflict failed or was queued: %', r; end if;
  if (select count(*) from queued_moves where meeting = m) is distinct from 1::bigint then raise exception 'the conflicting rule was queued'; end if;
  select * into mt from meetings where id = m;
  if jsonb_array_length(mt.record -> 'rulesSkipped') is distinct from 1 or mt.record #>> '{rulesSkipped,0,why}' not like 'Rule 1 requires the word%' then raise exception 'the skipped rule is not on the meeting''s record: %', mt.record; end if;
  -- od-m1: 3 (clamped), general only; od-m2: 1, offtopic only. Bank: 6 - 1 move - (3 + 1) = 1.
  if (select allowance || boards::text from staff_orders where meeting = m and staff = 'od-m1') is distinct from format('3{%s}', general) then
    raise exception 'od-m1''s order: %', (select to_jsonb(o) from staff_orders o where meeting = m and staff = 'od-m1'); end if;
  if (select allowance || boards::text from staff_orders where meeting = m and staff = 'od-m2') is distinct from format('1{%s}', offtopic) then
    raise exception 'od-m2''s order: %', (select to_jsonb(o) from staff_orders o where meeting = m and staff = 'od-m2'); end if;
  if (select count(*) from staff_orders where meeting = m) is distinct from 2::bigint then raise exception 'orders for a member or a stranger were written'; end if;
  if (select order_line from staff_orders where meeting = m and staff = 'od-m1') is distinct from 'Watch od-m1''s boards.' then raise exception 'the order''s line'; end if;
  if pg_temp.bank() is distinct from 1::numeric then raise exception 'the bank was not charged for moves and allowances: %', pg_temp.bank(); end if;
  if mt.bank_before is distinct from 6::numeric or mt.bank_after is distinct from 1::numeric then raise exception 'the closed row''s bank: % %', mt.bank_before, mt.bank_after; end if;
  -- Memory: each Mod's, with only the public characters kept; a member's was never written.
  if (select body #>> '{hobby,name}' from staff_memory where staff = 'od-m1' and meeting = m) is distinct from 'crosswords' then raise exception 'od-m1''s memory'; end if;
  if (select jsonb_array_length(body -> 'opinions') from staff_memory where staff = 'od-m1' and meeting = m) is distinct from 1 then raise exception 'a memory named a character who is not public'; end if;
  if (select body #>> '{hobby,name}' from staff_memory where staff = 'od-m2' and meeting = m) is distinct from 'birds' then raise exception 'od-m2''s memory'; end if;
  if exists (select 1 from staff_memory where staff in ('od-m3', 'nobody')) then raise exception 'a memory was written for a Mod not on staff'; end if;
  if mod_allowance('od-m1') is distinct from 3 or mod_allowance('od-m2') is distinct from 1 or mod_allowance('od-m3') is distinct from 0 then raise exception 'mod_allowance after the orders'; end if;
  -- The orders are an append-only log.
  if pg_temp.refusal($q$ update staff_orders set allowance = 9 $q$) is null or pg_temp.refusal($q$ delete from staff_orders $q$) is null then raise exception 'staff_orders was edited'; end if;
end $$;

-- ---- 4. The guard ----
do $$
declare
  general uuid := pg_temp.board('od-general');
  offtopic uuid := pg_temp.board('od-offtopic');
  games uuid := pg_temp.board('games');
  m bigint := (select max(id) from meetings where outcome = 'ok');
begin
  -- Offices: a member makes no move; a Mod makes no rename (the Boss's alone); the Boss makes both.
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s)', 'od-m3', general, m)) not like '23514%' then raise exception 'a member queued a move'; end if;
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s, %L)', 'od-m1', general, m, 'renameBoard')) not like '23514%' then raise exception 'a Mod queued a rename'; end if;
  -- A Mod's rule needs a board, and one of its beat.
  if pg_temp.refusal(format('select pg_temp.queue(%L, null, %s)', 'od-m1', m)) not like '23514%' then raise exception 'a Mod queued a rule on every board'; end if;
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s)', 'od-m1', offtopic, m)) not like '23514%' then raise exception 'a Mod queued a rule off its beat'; end if;
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s)', 'od-m2', general, m)) not like '23514%' then raise exception 'a Mod queued a rule on another Mod''s board'; end if;
  -- A Mod's rule on its beat lands in the queue and spends one: od-m2 holds 1 and spends it.
  perform pg_temp.queue('od-m2', offtopic, m);
  if mod_allowance('od-m2') is distinct from 0 then raise exception 'a queued rule did not spend the allowance: %', mod_allowance('od-m2'); end if;
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s)', 'od-m2', offtopic, m)) not like '23514%' then raise exception 'a Mod with no allowance left queued a rule'; end if;
  -- The Boss still queues anywhere, with no allowance: the Boss's bank is the apply's.
  perform pg_temp.queue('od-boss', games, m);
  -- A caller cannot plant the order a row spends against: a Boss's row lands with none.
  insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, spent_order)
  values (m, 'od-boss', 'setRule', jsonb_build_object('board', games, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'Because.', now() + interval '1 hour', now() + interval '2 days', false,
    (select max(id) from staff_orders));
  if exists (select 1 from queued_moves where staff = 'od-boss' and spent_order is not null) then raise exception 'a Boss row kept a planted spent_order'; end if;
  perform pg_temp.queue('od-boss', null, m);
end $$;

-- ---- 4b. One statement cannot spend what is not there: od-m1 holds 3, and four rows in one insert are refused whole; three are queued ----
do $$
declare
  general uuid := pg_temp.board('od-general');
  m bigint := (select max(id) from meetings where outcome = 'ok');
  five text := format($q$ insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
    select %s, 'od-m1', 'setRule', jsonb_build_object('board', %L::uuid, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor'), 'Because.', now() + interval '1 hour', now() + interval '2 days', false
    from generate_series(1, %%s) $q$, m, general);
  said text;
begin
  said := pg_temp.refusal(format(five, 4));
  if said is null or said not like '23514%' then raise exception 'four rules from an allowance of three were queued by one statement: %', said; end if;
  if mod_allowance('od-m1') is distinct from 3 or exists (select 1 from queued_moves where staff = 'od-m1') then raise exception 'a refused statement left rows behind'; end if;
  begin
    execute format(five, 3);
    if mod_allowance('od-m1') is distinct from 0 then raise exception 'three rows from one statement left an allowance of %', mod_allowance('od-m1'); end if;
    if (select count(*) from queued_moves where staff = 'od-m1' and spent_order = (select max(id) from staff_orders where staff = 'od-m1')) is distinct from 3::bigint then
      raise exception 'the rows are not stamped with the order they spend against'; end if;
    raise exception 'rollback' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null; end;
  if mod_allowance('od-m1') is distinct from 3 then raise exception 'the test left rows behind'; end if;
end $$;

-- ---- 5. mod_allowance does not count a rule the tick refused at landing, nor one an admin held ----
do $$
declare
  general uuid := pg_temp.board('od-general');
  offtopic uuid := pg_temp.board('od-offtopic');
  m bigint := (select max(id) from meetings where outcome = 'ok');
  q1 bigint; q2 bigint;
  admin uuid := tests.account('od-admin2');
begin
  -- od-m2 spent its one on offtopic (above); the tick refuses it at landing: the allowance is whole again.
  update queued_moves set refused_at = now(), failed_at = now(), failure = 'Rule 1 already says that' where staff = 'od-m2' and kind = 'setRule';
  if mod_allowance('od-m2') is distinct from 1 then raise exception 'a rule refused at landing still counts: %', mod_allowance('od-m2'); end if;
  -- od-m1 holds 3: it queues two; an admin holds one.
  q1 := pg_temp.queue('od-m1', general, m);
  q2 := pg_temp.queue('od-m1', general, m);
  if mod_allowance('od-m1') is distinct from 1 then raise exception 'two queued rules leave %', mod_allowance('od-m1'); end if;
  update queued_moves set held_at = now(), held_by = admin where id = q2;
  if mod_allowance('od-m1') is distinct from 2 then raise exception 'a held rule still counts: %', mod_allowance('od-m1'); end if;
  -- Spent stays spent when the rule lands or fails for a reason that may pass.
  update queued_moves set failed_at = now(), failure = 'the thread is missing' where id = q1;
  if mod_allowance('od-m1') is distinct from 2 then raise exception 'a rule that failed to land and will be tried again stopped counting: %', mod_allowance('od-m1'); end if;
  -- od-m1: granted 3, q1 counts (failed, may be retried), q2 held: 2 unspent. od-m2: 1 unspent (its rule was refused).
end $$;

-- ---- 6. The Boss's bank: returned once, never above the cap; a retry does nothing; a failure returns nothing ----
do $$
declare
  games uuid := pg_temp.board('games');
  general uuid := pg_temp.board('od-general');
  offtopic uuid := pg_temp.board('od-offtopic');
  m bigint;
  r jsonb;
  orders_before bigint;
  denied text;
  sq bigint;
begin
  -- Unspent: od-m1 2, od-m2 1 = 3. The bank holds 1. A cap of 3 returns 2 of the 3 (1 + 3 would be 4, above the cap).
  if pg_temp.bank() is distinct from 1::numeric then raise exception 'the bank before: %', pg_temp.bank(); end if;
  m := (begin_meeting('2031-01-04T09:00:00Z') ->> 'meeting')::bigint;
  -- One move (1) and an order for od-m1 of 2 (od-m2 is left out: its beat and line are carried, its allowance 0): 3 - 1 - 2 = 0.
  r := apply_meeting(m, pg_temp.payload(jsonb_build_array(pg_temp.rule_move(general, 'noAllCaps')), jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 2)), 3));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'bank_after')::numeric is distinct from 0::numeric then raise exception 'the returned allowances were not capped: %', r; end if;
  if pg_temp.bank() is distinct from 0::numeric then raise exception 'the bank after: %', pg_temp.bank(); end if;
  -- The omitted Mod's order was carried: its boards (minus any another order claimed), its line, and an allowance of 0 (what it had was returned).
  if (select allowance || boards::text || order_line from staff_orders where meeting = m and staff = 'od-m2') is distinct from format('0{%s}Watch od-m2''s boards.', offtopic) then
    raise exception 'od-m2''s carried order: %', (select to_jsonb(o) from staff_orders o where meeting = m and staff = 'od-m2'); end if;
  if mod_allowance('od-m2') is distinct from 0 or mod_allowance('od-m1') is distinct from 2 then raise exception 'the allowances after the meeting: % %', mod_allowance('od-m1'), mod_allowance('od-m2'); end if;
  select count(*) into orders_before from staff_orders;

  -- A retry of the same meeting returns and charges nothing, and writes nothing.
  r := apply_meeting(m, pg_temp.payload(jsonb_build_array(pg_temp.rule_move(general, 'noAllCaps')), jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 3)), 3));
  if r ->> 'status' is distinct from 'already applied' then raise exception 'a retry was applied: %', r; end if;
  if pg_temp.bank() is distinct from 0::numeric or (select count(*) from staff_orders) is distinct from orders_before or mod_allowance('od-m1') is distinct from 2 then
    raise exception 'a retried meeting returned or charged again: bank % orders % allowance %', pg_temp.bank(), (select count(*) from staff_orders), mod_allowance('od-m1'); end if;

  -- A meeting that fails in the database (three moves the bank cannot pay: od-m1's 2 return) rolls back whole: nothing returned, nothing written.
  m := (begin_meeting('2031-01-05T09:00:00Z') ->> 'meeting')::bigint;
  denied := pg_temp.refusal(format('select apply_meeting(%s, %L::jsonb)', m, pg_temp.payload(jsonb_build_array(pg_temp.rule_move(general, 'noAllCaps'), pg_temp.rule_move(general, 'noAllCaps'), pg_temp.rule_move(general, 'noAllCaps')), jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 3)))));
  if denied is null or denied not like '23514%' then raise exception 'moves the bank cannot pay were applied: %', denied; end if;
  if pg_temp.bank() is distinct from 0::numeric or (select count(*) from staff_orders) is distinct from orders_before or mod_allowance('od-m1') is distinct from 2
     or (select finished_at from meetings where id = m) is not null then
    raise exception 'a failed meeting left something behind: bank % allowance %', pg_temp.bank(), mod_allowance('od-m1'); end if;
  -- A meeting closed failed or rejected returns nothing either.
  perform fail_meeting(m, 'failed', 'the model failed', '{}');
  if pg_temp.bank() is distinct from 0::numeric or mod_allowance('od-m1') is distinct from 2 then raise exception 'a failed meeting returned an allowance'; end if;

  -- The next meeting returns od-m1's 2 once: the bank is 2, all handed back out to od-m1 (2). Had the failed meeting returned them too, the bank would hold 2.
  m := (begin_meeting('2031-01-06T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m, pg_temp.payload('[]', jsonb_build_array(pg_temp.order_for('od-m1', jsonb_build_array(general), 2), pg_temp.order_for('od-m2', jsonb_build_array(offtopic), 0))));
  if (r ->> 'bank_after')::numeric is distinct from 0::numeric or pg_temp.bank() is distinct from 0::numeric then raise exception 'the allowance was returned twice, or not at all: %', r; end if;

  -- A Mod off staff has its unspent allowance returned all the same, and is not returned again by the next meeting.
  insert into staff_offices (staff, office, cause) values ('od-m1', 'benched', 'admin');
  if mod_allowance('od-m1') is distinct from 0 then raise exception 'a benched Mod holds an allowance'; end if;
  if pg_temp.refusal(format('select pg_temp.queue(%L, %L, %s)', 'od-m1', general, m)) not like '23514%' then raise exception 'a benched Mod queued a rule'; end if;
  m := (begin_meeting('2031-01-07T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m, pg_temp.payload('[]', '[]'));
  if pg_temp.bank() is distinct from 2::numeric then raise exception 'a benched Mod''s unspent allowance did not return: %', pg_temp.bank(); end if;
  if (select allowance || boards::text from staff_orders where meeting = m and staff = 'od-m1') is distinct from '0{}' then raise exception 'a benched Mod''s beat was carried'; end if;
  m := (begin_meeting('2031-01-08T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m, pg_temp.payload('[]', '[]'));
  if pg_temp.bank() is distinct from 2::numeric then raise exception 'the benched Mod''s allowance returned a second time: %', pg_temp.bank(); end if;
  -- A board its beat once held is now another Mod's by plain code.
  if beat_of(general) is distinct from 'od-m2' then raise exception 'a benched Mod''s board was not given to the Mod on staff: %', beat_of(general); end if;
  -- Nothing is lost to the Mods: the bank never holds a fraction of what was handed away.
  if exists (select 1 from staff_orders where allowance < 0) then raise exception 'a negative allowance'; end if;
end $$;

-- ---- 6b. A Mod that queues between the meeting's read and its apply does not fail the meeting; the allowances are trimmed, and what returned is what was added ----
do $$
declare
  offtopic uuid := pg_temp.board('od-offtopic');
  m bigint;
  r jsonb;
begin
  m := (begin_meeting('2031-01-09T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m, pg_temp.payload('[]', jsonb_build_array(pg_temp.order_for('od-m2', jsonb_build_array(offtopic), 2))));
  if pg_temp.bank() is distinct from 0::numeric or mod_allowance('od-m2') is distinct from 2 then raise exception 'the setup: bank %, allowance %', pg_temp.bank(), mod_allowance('od-m2'); end if;
  -- The Edge Function read an unspent 2 (a bank of 2); then the Mod queued one.
  perform pg_temp.queue('od-m2', offtopic, m);
  m := (begin_meeting('2031-01-10T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m, pg_temp.payload('[]', jsonb_build_array(pg_temp.order_for('od-m2', jsonb_build_array(offtopic), 2)), 10));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'handed')::integer is distinct from 1 then raise exception 'the allowance was not trimmed to the bank: %', r; end if;
  if (select allowance from staff_orders where meeting = m and staff = 'od-m2') is distinct from 1 or pg_temp.bank() is distinct from 0::numeric then raise exception 'the trimmed order or the bank'; end if;
  if (select (record #>> '{allowances,trimmed}')::integer from meetings where id = m) is distinct from 1
     or (select (record #>> '{allowances,clamped}')::integer from meetings where id = m) is distinct from 0 then raise exception 'the trim is not recorded: %', (select record from meetings where id = m); end if;
  -- od-m2 holds 1 unspent. With a cap of 0 nothing can be added to the bank, and the record says what was added, not the sum.
  m := (begin_meeting('2031-01-11T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m, pg_temp.payload('[]', '[]', 0));
  if (select (record #>> '{allowances,returned}')::numeric from meetings where id = m) is distinct from 0::numeric or pg_temp.bank() is distinct from 0::numeric then
    raise exception 'returned records the uncapped sum: %', (select record from meetings where id = m); end if;
end $$;

-- ---- 7. No client reaches any of it ----
do $$
begin
  if has_table_privilege('authenticated', 'staff_orders', 'select') or has_table_privilege('anon', 'staff_beats', 'select') then raise exception 'a client reads orders or beats'; end if;
  if has_function_privilege('authenticated', 'beat_of(uuid)', 'execute') or has_function_privilege('anon', 'mod_allowance(text)', 'execute') then raise exception 'a client calls beat_of or mod_allowance'; end if;
  if not has_function_privilege('service_role', 'beat_of(uuid)', 'execute') or not has_function_privilege('service_role', 'mod_allowance(text)', 'execute') then raise exception 'the service role cannot call beat_of or mod_allowance'; end if;
end $$;
