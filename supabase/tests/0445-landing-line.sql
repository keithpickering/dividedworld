-- A move's landing line, written ahead (supabase/migrations/0445_persona_lines.sql, part 3; docs/plans/2026-11-25-persona-lines-plan.md, Task 5; design section 1.4).
--
-- 1. apply_meeting (a Boss's move) and apply_mod_move (a Mod's) store the move's `line` on its queued row; a move with none, or a blank one, stores null.
-- 2. A line over 280 characters is refused by the column's check (the engine trims before it): a direct insert, and a Mod's move, which is refused with the reason.
-- 3. system_tick lands a queued move with its own line, its tokens filled as a stock line's are ({move}, {board}, {rule}, {boss}).
-- 5. A line is cut to 280 characters where it is stored (a meeting's plain move, a Mod's move; a bundle part carries none), never refusing the paid answer; 280 multibyte characters are kept; a token the key is not given lands literal.
-- 4. A queued move with no line lands with the speaker's stock line (a rule's is ruleSet): the persona's own set, else the instance's, else the move's plain words.

create function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '%: got "%", wanted "%"', label, got, want; end if;
end $$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

create function pg_temp.memory(hobby text) returns jsonb language sql as $$
  select jsonb_build_object('hobby', jsonb_build_object('name', hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
    'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb)
$$;

create function pg_temp.order_for(mod text, boards jsonb, allowance integer) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', boards, 'order', 'Watch ' || mod || '''s boards.', 'allowance', allowance, 'memory', pg_temp.memory('hobby of ' || mod))
$$;

-- A meeting as the Boss, with the moves it makes (each a setRule on a board, live now).
create function pg_temp.meet(at text, orders jsonb, moves jsonb) returns bigint language plpgsql as $$
declare m bigint := (begin_meeting(at::timestamptz) ->> 'meeting')::bigint;
begin
  perform apply_meeting(m, jsonb_build_object('boss', 'll-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', moves, 'orders', orders, 'record', '{}'::jsonb));
  return m;
end $$;

create function pg_temp.mv(board uuid, predicate text, line jsonb default null, hours numeric default 48) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'setRule', 'params', jsonb_build_object('board', board, 'predicate', predicate, 'param', null, 'band', 'minor'), 'expires_in_hours', hours, 'why', 'Shouting.',
    'go_live_at', now()) || case when line is not null then jsonb_build_object('line', line) else '{}'::jsonb end
$$;

create function pg_temp.sets(instance jsonb, personas jsonb) returns void language plpgsql as $$
begin
  delete from settings where key in ('systemLines', 'personaLines');
  if instance is not null then insert into settings (key, value) values ('systemLines', instance); end if;
  if personas is not null then insert into settings (key, value) values ('personaLines', personas); end if;
end $$;

create function pg_temp.landed_body(q bigint) returns text language sql as $$
  select a.payload ->> 'body' from queued_moves m join acts a on a.id = m.landed_act where m.id = q
$$;

-- ---- 0. The world: a Boss and a Mod watching a board ----
do $$
declare seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 6, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'll-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'll-boss', 'name', 'Line Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'll-m1', 'name', 'Line Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', jsonb_build_array('ll-games'))),
      'firstStaff', jsonb_build_array('ll-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'noExclaim', 'param', 'none', 'least', null, 'most', null, 'plain', 'no shouting'),
        jsonb_build_object('key', 'noBlank', 'param', 'none', 'least', null, 'most', null, 'plain', 'no blank posts'),
        jsonb_build_object('key', 'noLong', 'param', 'none', 'least', null, 'most', null, 'plain', 'no long posts'),
        jsonb_build_object('key', 'noShort', 'param', 'none', 'least', null, 'most', null, 'plain', 'no short posts'),
        jsonb_build_object('key', 'noEmpty', 'param', 'none', 'least', null, 'most', null, 'plain', 'no empty posts'),
        jsonb_build_object('key', 'noTall', 'param', 'none', 'least', null, 'most', null, 'plain', 'no tall posts'),
        jsonb_build_object('key', 'noP0', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p0'),
        jsonb_build_object('key', 'noP1', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p1'),
        jsonb_build_object('key', 'noP2', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p2'),
        jsonb_build_object('key', 'noP3', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p3'),
        jsonb_build_object('key', 'noP4', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p4'),
        jsonb_build_object('key', 'noP5', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p5'),
        jsonb_build_object('key', 'noP6', 'param', 'none', 'least', null, 'most', null, 'plain', 'no p6'))));
  perform seed_instance(seed);
  insert into boards (slug, name, description) values ('ll-games', 'Games', 'Talk about games.');
  insert into move_bank (staff, balance, as_of) values ('ll-boss', 20, now());
  perform tests.account('ll-ann');
  perform tests.character((select id from auth.users where email = 'll-ann@test.invalid'), 'Ll Poster');
  perform pg_temp.sets('{"ruleSet": ["Instance: {move}."]}', '{"ll-boss": {"ruleSet": ["Boss own: {move}."]}, "ll-m1": {"ruleSet": ["Mod own: {move}."]}}');
end $$;

create function pg_temp.cause(label text) returns uuid language sql as $$
  select tests.post((select id from characters where name = 'Ll Poster'), tests.thread('Cause ' || label), 'A post.')
$$;

-- ---- 1. apply_meeting stores a Boss's line; none or blank is null ----
create table pg_temp.made (label text primary key, q bigint);
do $$
declare
  games uuid := pg_temp.board('ll-games');
  m bigint;
begin
  m := pg_temp.meet('2031-02-01T09:00:00Z', jsonb_build_array(jsonb_build_object('mod', 'll-m1', 'boards', jsonb_build_array(games), 'order', 'Watch.', 'allowance', 6, 'memory', pg_temp.memory('h'))),
    jsonb_build_array(pg_temp.mv(games, 'noAllCaps', to_jsonb('The Boss says {move} on {board}, {boss}.'::text)), pg_temp.mv(games, 'noExclaim'), pg_temp.mv(games, 'noBlank', to_jsonb('   '::text))));
  if (select count(*) from queued_moves where meeting = m) is distinct from 3 then raise exception 'the meeting did not queue three moves: %', (select jsonb_agg(to_jsonb(q)) from queued_moves q where meeting = m); end if;
  insert into pg_temp.made select 'boss-line', q.id from queued_moves q where q.meeting = m and q.line is not null;
  perform pg_temp.expect('the Boss''s line is stored', (select q.line from queued_moves q where q.id = (select q from pg_temp.made where label = 'boss-line')), 'The Boss says {move} on {board}, {boss}.');
  if (select count(*) from queued_moves q where q.meeting = m and q.line is null) is distinct from 2 then raise exception 'a move with no line, or a blank one, did not store null: %', (select jsonb_agg(q.line) from queued_moves q where q.meeting = m); end if;
  insert into pg_temp.made select 'boss-none', min(q.id) from queued_moves q where q.meeting = m and q.line is null;
end $$;

-- ---- 2. apply_mod_move stores a Mod's line ----
do $$
declare
  games uuid := pg_temp.board('ll-games');
  got jsonb;
begin
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noLong', to_jsonb('Mod {move}: {boss} has nothing to do with it.'::text)), pg_temp.cause('mod line'));
  if (got ->> 'queued')::boolean is distinct from true then raise exception 'the Mod''s move was not queued: %', got; end if;
  insert into pg_temp.made values ('mod-line', (got ->> 'move')::bigint);
  perform pg_temp.expect('the Mod''s line is stored', (select q.line from queued_moves q where q.id = (got ->> 'move')::bigint), 'Mod {move}: {boss} has nothing to do with it.');
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noShort'), pg_temp.cause('mod none'));
  if (got ->> 'queued')::boolean is distinct from true then raise exception 'the Mod''s move with no line was not queued: %', got; end if;
  insert into pg_temp.made values ('mod-none', (got ->> 'move')::bigint);
  if (select q.line from queued_moves q where q.id = (got ->> 'move')::bigint) is not null then raise exception 'a Mod''s move with no line stored one'; end if;
end $$;

-- ---- 3. A line over 280 characters is refused by the column's check ----
do $$
declare
  games uuid := pg_temp.board('ll-games');
  r text;
  got jsonb;
begin
  update queued_moves set line = repeat('x', 280) where id = (select q from pg_temp.made where label = 'boss-none');
  update queued_moves set line = null where id = (select q from pg_temp.made where label = 'boss-none');
  r := pg_temp.refusal(format('update queued_moves set line = %L where id = %s', repeat('x', 281), (select q from pg_temp.made where label = 'boss-none')));
  if r is null or r not like '23514:%' then raise exception 'a 281-character line was not refused by the check: %', r; end if;
  -- A Mod's 281-character line is cut to 280 where apply_mod_move stores it (0445 fix), not refused.
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noP0', to_jsonb(repeat('y', 281))), pg_temp.cause('mod long'));
  if (got ->> 'queued')::boolean is distinct from true or (select char_length(q.line) from queued_moves q where q.id = (got ->> 'move')::bigint) is distinct from 280 then raise exception 'a Mod''s 281-character line was not queued cut to 280: %', got; end if;
  if exists (select 1 from queued_moves where char_length(line) > 280) then raise exception 'a line over 280 is stored'; end if;
end $$;

-- ---- 4. The tick lands each with its own line, filled, or with the speaker's stock line ----
do $$
declare
  ran jsonb;
begin
  ran := system_tick();
  if (ran ->> 'landed')::integer is distinct from 6 or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'the tick did not land the six moves (the cut Mod line is the sixth): % %', ran, (select jsonb_agg(jsonb_build_object('s', q.staff, 'l', q.line, 'f', q.failure, 'h', q.held_at, 'g', q.go_live_at, 'la', q.landed_act)) from queued_moves q); end if;
  perform pg_temp.expect('the Boss''s line lands, filled', pg_temp.landed_body((select q from pg_temp.made where label = 'boss-line')), 'The Boss says a rule on Games, Line Boss.');
  perform pg_temp.expect('the Mod''s line lands, filled', pg_temp.landed_body((select q from pg_temp.made where label = 'mod-line')), 'Mod a rule: Line Mod has nothing to do with it.');
  perform pg_temp.expect('no line: the Boss''s stock line', pg_temp.landed_body((select q from pg_temp.made where label = 'boss-none')), 'Boss own: a rule.');
  perform pg_temp.expect('no line: the Mod''s stock line', pg_temp.landed_body((select q from pg_temp.made where label = 'mod-none')), 'Mod own: a rule.');
end $$;

-- ---- 5. No line, no persona set: the instance's, then the move's words ----
do $$
declare
  games uuid := pg_temp.board('ll-games');
  got jsonb;
  q bigint;
begin
  perform pg_temp.sets('{"ruleSet": ["Instance: {move}."]}', null);
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noEmpty', to_jsonb(''::text)), pg_temp.cause('instance'));
  q := (got ->> 'move')::bigint;
  if q is null then raise exception 'the Mod''s move was not queued: %', got; end if;
  perform system_tick();
  perform pg_temp.expect('no line, no persona set: the instance''s line', pg_temp.landed_body(q), 'Instance: a rule.');
  perform pg_temp.sets(null, null);
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noTall'), pg_temp.cause('plain'));
  q := (got ->> 'move')::bigint;
  if q is null then raise exception 'the Mod''s plain move was not queued: %', got; end if;
  perform system_tick();
  perform pg_temp.expect('no line and neither set: the move''s words', pg_temp.landed_body(q), 'a rule');
end $$;

-- ---- 6. A line is cut where it is stored (a bundle part carries none): a plain move's 300-character line, 280 emoji, a token the key is not given ----
do $$
declare
  games uuid := pg_temp.board('ll-games');
  m bigint;
  got jsonb;
  qid bigint;
begin
  perform pg_temp.sets(null, null);
  update move_bank set balance = 20, as_of = now() where staff = 'll-boss';
  m := (begin_meeting('2031-03-01T09:00:00Z'::timestamptz) ->> 'meeting')::bigint;
  perform apply_meeting(m, jsonb_build_object('boss', 'll-boss', 'weekly_moves', 0, 'bank_cap', 20, 'memory', pg_temp.memory('wrestling'),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', jsonb_build_array(
      pg_temp.mv(games, 'noP1', to_jsonb(repeat('a', 300))),
      pg_temp.mv(games, 'noP2', to_jsonb(repeat(E'\U0001F600', 280))),
      pg_temp.mv(games, 'noP3', to_jsonb('Hello {mod}.'::text))),
    'bundles', jsonb_build_array(jsonb_build_object('name', 'Pair', 'beat', null, 'parts', jsonb_build_array(
      pg_temp.mv(games, 'noP4', to_jsonb('Part {move}.'::text)), pg_temp.mv(games, 'noP5', to_jsonb(repeat('b', 300)))))),
    'orders', jsonb_build_array(jsonb_build_object('mod', 'll-m1', 'boards', jsonb_build_array(games), 'order', 'Watch.', 'allowance', 3, 'memory', pg_temp.memory('h'))),
    'record', '{}'::jsonb));
  if (select count(*) from queued_moves where meeting = m) is distinct from 5 then raise exception 'the meeting did not queue five moves: %', (select jsonb_agg(to_jsonb(q)) from queued_moves q where meeting = m); end if;
  perform pg_temp.expect('a 300-character plain line is cut to 280', (select char_length(q.line)::text from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP1'), '280');
  perform pg_temp.expect('280 emoji are kept whole', (select char_length(q.line)::text from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP2'), '280');
  -- A bundle part carries no line (the engine's bundle part has none): a line sent on one is not stored.
  if (select q.line from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP4') is not null then raise exception 'a bundle part stored a line'; end if;
  if (select q.bundle from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP4') is null then raise exception 'the part is not in a bundle'; end if;
  if (select q.line from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP5') is not null then raise exception 'a bundle part stored a 300-character line'; end if;
  got := apply_mod_move('ll-m1', pg_temp.mv(games, 'noP6', to_jsonb(repeat('c', 300))), pg_temp.cause('mod cut'));
  if (got ->> 'queued')::boolean is distinct from true then raise exception 'a Mod''s 300-character line was not queued: %', got; end if;
  perform pg_temp.expect('a Mod''s 300-character line is cut to 280', (select char_length(q.line)::text from queued_moves q where q.id = (got ->> 'move')::bigint), '280');
  qid := (select q.id from queued_moves q where q.meeting = m and q.params ->> 'predicate' = 'noP3');
  perform system_tick();
  perform pg_temp.expect('a token the key is not given lands literal', pg_temp.landed_body(qid), 'Hello {mod}.');
end $$;

-- ---- 7. A Boss's fulfill of a staff request (apply_boss_move, through boss_move_queue) stores the move's line: written, blank as none, cut to 280 ----
do $$
declare
  games uuid;
  got jsonb;
begin
  insert into boards (slug, name, description) values ('ll-fresh', 'Fresh', 'A board with no rules yet.');
  games := pg_temp.board('ll-fresh');
  update move_bank set balance = 20, as_of = now() where staff = 'll-boss';
  got := apply_boss_move('ll-boss', pg_temp.mv(games, 'noP0', to_jsonb('Boss fulfills {move}, says {boss}.'::text)), pg_temp.cause('boss fulfill'), 0, 20);
  if (got ->> 'queued')::boolean is distinct from true then raise exception 'the Boss''s fulfill was not queued: %', got; end if;
  perform pg_temp.expect('a Boss''s fulfill stores its line', (select q.line from queued_moves q where q.id = (got ->> 'move')::bigint), 'Boss fulfills {move}, says {boss}.');
  got := apply_boss_move('ll-boss', pg_temp.mv(games, 'noP1', to_jsonb('   '::text)), pg_temp.cause('boss blank'), 0, 20);
  if (got ->> 'queued')::boolean is distinct from true or (select q.line from queued_moves q where q.id = (got ->> 'move')::bigint) is not null then raise exception 'a Boss''s fulfill with a blank line did not store null: %', got; end if;
  got := apply_boss_move('ll-boss', pg_temp.mv(games, 'noP2', to_jsonb(repeat('z', 300))), pg_temp.cause('boss long'), 0, 20);
  if (got ->> 'queued')::boolean is distinct from true then raise exception 'a Boss''s fulfill with a long line was not queued: %', got; end if;
  perform pg_temp.expect('a Boss''s 300-character line is cut to 280', (select char_length(q.line)::text from queued_moves q where q.id = (got ->> 'move')::bigint), '280');
end $$;
