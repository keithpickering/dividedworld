-- Moves, demands and the board's name from Acts (supabase/migrations/0046_moves.sql; the system plan, Task 8; the system
-- design, sections 3, 7 and 9). A move is a staff character's Act; what a board is called now is computed from the moves in
-- force; a move's end is a null-character Act written once, by one writer; a demand's progress is read by a role that sees
-- public relations only. The poison for the two lists: a demand kind seeded with no SQL case makes the per-row test raise.

-- A staff Boss, The System's board's thread, and a move written as the tick will write it, at a time of the test's choosing.
create function pg_temp.boss() returns uuid language plpgsql as $$
declare made uuid;
begin
  select id into made from characters where staff = 'mv-boss';
  if made is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Mv Boss', 'mv-boss', 'boss', now()) returning id into made; end if;
  return made;
end $$;
create function pg_temp.announcements() returns uuid language plpgsql as $$
declare made uuid;
begin
  select t.id into made from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements';
  if made is null then insert into threads (board, title) select id, 'Announcements' from boards where is_system returning id into made; end if;
  return made;
end $$;
create function pg_temp.move(on_board uuid, new_name text, demand jsonb, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act(pg_temp.boss(), 'move', pg_temp.announcements(),
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
      'params', jsonb_build_object('board', on_board, 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
      'demand', demand, 'expires_at', at + interval '3 days')), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
-- A move's end written at a time of the test's choosing, past end_move, as the one writer's setting allows.
create function pg_temp.end_at(move uuid, why text, at timestamptz, by text default 'tick') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'move_end', pg_temp.announcements(), move, jsonb_build_object('why', why, 'by', by), at) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return written;
end $$;

-- Every move still in force ended, so that one section's moves are not the next one's boards: each section leaves the board names as it found them.
create function pg_temp.end_all() returns void language plpgsql as $$
declare m uuid;
begin
  for m in select move_act from open_moves loop perform end_move(m, 'expired', 'test'); end loop;
end $$;

-- ---- The catalogs: seeded by seed_instance, upserted on a reseed, and none without a `system` ----
do $$
declare
  seed jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('staff', '[]'::jsonb, 'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true), jsonb_build_object('key', 'lockThread', 'structural', false)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'crossQuote'))));
begin
  perform seed_instance(seed - 'system');
  if exists (select 1 from move_kinds) or exists (select 1 from demand_kinds) then raise exception 'a seed without system seeded a move or a demand'; end if;
  perform seed_instance(seed);
  if (select string_agg(key || ':' || structural, ',' order by key) from move_kinds) is distinct from 'lockThread:false,renameBoard:true' then
    raise exception 'move_kinds are %', (select string_agg(key || ':' || structural, ',' order by key) from move_kinds);
  end if;
  if (select string_agg(key, ',' order by key) from demand_kinds) is distinct from 'crossQuote,postsOnBoard' then raise exception 'demand_kinds are wrong'; end if;
  -- A reseed upserts: a changed flag is written, nothing is duplicated.
  perform seed_instance(jsonb_set(seed, '{system,moves}', jsonb_build_array(jsonb_build_object('key', 'lockThread', 'structural', true))));
  if (select count(*) from move_kinds) is distinct from 2 or (select structural from move_kinds where key = 'lockThread') is distinct from true then raise exception 'a reseed did not upsert move_kinds'; end if;
  -- The catalogs the rest of this file builds on are its own.
  delete from move_kinds;
  delete from demand_kinds;
  perform pg_temp.end_all();
end $$;

-- ---- The shape: what an Act of each new kind must be ----
do $$
declare
  ann uuid := tests.account('mv-shape-a');
  pc uuid := tests.character(ann, 'Mv Player');
  boss uuid := pg_temp.boss();
  sys uuid := pg_temp.announcements();
  general uuid := (select id from boards where slug = 'general');
  post uuid := tests.post(pc, tests.thread());
  mv uuid;
  payload jsonb;
  bad text;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict do nothing;
  payload := jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
    'params', jsonb_build_object('board', general, 'name', 'Pointless Toast Palace', 'premise', 'Toast.', 'description', 'A board about toast.'),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 3)),
    'expires_at', now() + interval '3 days');

  -- A move is a staff character's Act, written by write_staff_act as the Boss, pointing at nothing.
  mv := (write_staff_act('mv-boss', 'move', sys, null, payload) ->> 'id')::uuid;
  if (select kind || character::text from acts where id = mv) is distinct from 'move' || boss::text then raise exception 'write_staff_act did not write a move as the Boss'; end if;
  if (select target_act_id from acts where id = mv) is not null then raise exception 'a move points at something'; end if;

  -- A move by a player's character raises: with the staff writer off, and with it on.
  begin perform tests.act(pc, 'move', sys, payload); raise exception 'a player character wrote a move';
  exception when insufficient_privilege then null; end;
  perform set_config('kayfabb.staff_writer', 'on', true);
  begin perform tests.act(pc, 'move', sys, payload); raise exception 'a player character wrote a move with the staff setting on';
  exception when insufficient_privilege then null; end;
  -- A move with no character is no move (only a tally, a reveal and a move_end have none).
  begin insert into acts (character, kind, thread, payload) values (null, 'move', sys, payload); raise exception 'a move with no character was written';
  exception when check_violation then null; end;
  -- A payload of the wrong shape, a kind or a demand outside the catalogs, an expiry that is no time.
  foreach bad in array array['{"kind": "renameBoard", "params": []}', '{"params": {}}', '{"kind": "renameBoard", "params": {}, "demand": 3}', '{"kind": "renameBoard", "params": {}, "expires_at": 7}'] loop
    begin perform tests.act(boss, 'move', sys, bad::jsonb); raise exception 'a malformed move payload was written: %', bad;
    exception when check_violation then null; end;
  end loop;
  begin perform tests.act(boss, 'move', sys, jsonb_set(payload, '{kind}', '"shout"')); raise exception 'a move of a kind outside move_kinds was written';
  exception when check_violation then null; end;
  begin perform tests.act(boss, 'move', sys, jsonb_set(payload, '{demand,kind}', '"shout"')); raise exception 'a move with a demand outside demand_kinds was written';
  exception when check_violation then null; end;
  begin perform tests.act(boss, 'move', sys, jsonb_set(payload, '{expires_at}', '"soon"')); raise exception 'a move with an expiry that is no time was written';
  exception when invalid_datetime_format or check_violation then null; end;
  perform set_config('kayfabb.staff_writer', '', true);
  -- A move needs no demand and no expiry (a nomination has neither).
  perform write_staff_act('mv-boss', 'move', sys, null, jsonb_build_object('kind', 'renameBoard', 'params', '{}'::jsonb));

  -- A move_end has one writer, end_move: a direct insert is refused without its setting.
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', sys, mv, '{"why": "met", "by": "tick"}'); raise exception 'a move_end was written outside end_move';
  exception when insufficient_privilege then null; end;
  -- With the setting: no character, a move for its target, a reason of the three, and a "by".
  perform set_config('kayfabb.move_end_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  begin insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'move_end', sys, mv, '{"why": "met", "by": "tick"}'); raise exception 'a move_end had a character';
  exception when check_violation then null; end;
  perform set_config('kayfabb.staff_writer', '', true);
  begin insert into acts (character, kind, thread, payload) values (null, 'move_end', sys, '{"why": "met", "by": "tick"}'); raise exception 'a move_end with no target was written';
  exception when check_violation then null; end;
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', sys, mv, '{"why": "bored", "by": "tick"}'); raise exception 'a move_end with a reason outside the three was written';
  exception when check_violation then null; end;
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', sys, mv, '{"why": "met"}'); raise exception 'a move_end with no "by" was written';
  exception when check_violation then null; end;
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', sys, post, '{"why": "met", "by": "tick"}'); raise exception 'a move_end of a post was written';
  exception when check_violation then null; end;
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', tests.thread(), mv, '{"why": "met", "by": "tick"}'); raise exception 'a move_end in another thread than its move was written';
  exception when check_violation then null; end;
  perform set_config('kayfabb.move_end_writer', '', true);
  perform pg_temp.end_all();
end $$;

-- ---- A landed rename shows in boards_now; its end brings the old name back; one end per move ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  other uuid;
  a uuid;
  b uuid;
  first_end jsonb;
  again jsonb;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  update boards set description = 'The first premise.' where id = general;
  insert into boards (slug, name, description) values ('other-board', 'Other', 'Other premise.') returning id into other;

  -- Before any move: the board's own row, its description its first premise, and no move.
  if (select name || '|' || premise || '|' || description || '|' || coalesce(move_act::text, '-') from boards_now where id = general) is distinct from 'General|The first premise.|The first premise.|-' then
    raise exception 'boards_now before a move is %', (select to_jsonb(bn) from boards_now bn where bn.id = general);
  end if;

  -- The earlier rename is the board's name; a later one replaces it; ending the later brings the earlier back; ending that brings the board's own.
  a := pg_temp.move(general, 'Pointless Toast Palace', null, now() - interval '2 days');
  if (select name || '|' || premise || '|' || description || '|' || (move_act = a)::text from boards_now where id = general) is distinct from 'Pointless Toast Palace|The subject of Pointless Toast Palace|About Pointless Toast Palace|true' then
    raise exception 'a landed rename is not in boards_now: %', (select to_jsonb(bn) from boards_now bn where bn.id = general);
  end if;
  b := pg_temp.move(general, 'Pirate Puns Palace', null, now() - interval '1 day');
  if (select name from boards_now where id = general) is distinct from 'Pirate Puns Palace' or (select move_act from boards_now where id = general) is distinct from b then raise exception 'the latest rename is not shown'; end if;
  -- Nothing was written to boards, and no other board changed.
  if (select name from boards where id = general) is distinct from 'General' then raise exception 'a rename wrote to boards'; end if;
  if exists (select 1 from boards_now n join boards o on o.id = n.id where n.id <> general and ((n.name, n.description) is distinct from (o.name, o.description) or n.move_act is not null)) then
    raise exception 'a rename of one board changed another';
  end if;

  first_end := end_move(b, 'reversed', 'admin');
  if (first_end ->> 'ended')::boolean is not true or (select kind || coalesce(character::text, '-') from acts where id = (first_end ->> 'act')::uuid) is distinct from 'move_end-' then
    raise exception 'end_move wrote %', first_end;
  end if;
  if (select name || '|' || (move_act = a)::text from boards_now where id = general) is distinct from 'Pointless Toast Palace|true' then raise exception 'ending the later rename did not bring the earlier back'; end if;
  if (select payload from acts where id = (first_end ->> 'act')::uuid) is distinct from '{"why": "reversed", "by": "admin"}' then raise exception 'the end is %', (select payload from acts where id = (first_end ->> 'act')::uuid); end if;

  perform end_move(a, 'expired', 'tick');
  if (select name || '|' || premise || '|' || description || '|' || coalesce(move_act::text, '-') from boards_now where id = general) is distinct from 'General|The first premise.|The first premise.|-' then
    raise exception 'an ended rename did not bring the old name back: %', (select to_jsonb(n) from boards_now n where n.id = general);
  end if;

  -- A second end on one move: end_move returns the first, writing nothing and changing nothing; a direct second insert raises.
  again := end_move(b, 'met', 'tick');
  if (again ->> 'act') is distinct from (first_end ->> 'act') or (again ->> 'ended')::boolean is not false then raise exception 'a second end_move was %', again; end if;
  if (select count(*) from acts where kind = 'move_end' and target_act_id = b) is distinct from 1 then raise exception 'a move has more than one end'; end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  begin insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', (select thread from acts where id = b), b, '{"why": "met", "by": "tick"}'); raise exception 'a second move_end on one move was written';
  exception when unique_violation then null; end;
  perform set_config('kayfabb.move_end_writer', '', true);

  -- end_move refuses what is no move, a reason outside the three, and a missing "by".
  begin perform end_move(gen_random_uuid(), 'met', 'tick'); raise exception 'end_move ended a move that does not exist'; exception when no_data_found then null; end;
  begin perform end_move((select id from acts where kind = 'post' limit 1), 'met', 'tick'); raise exception 'end_move ended a post'; exception when no_data_found or invalid_parameter_value then null; end;
  begin perform end_move(pg_temp.move(other, 'Other Palace', null, now()), 'bored', 'tick'); raise exception 'end_move took a reason outside the three'; exception when invalid_parameter_value then null; end;
  begin perform end_move(pg_temp.move(other, 'Other Palace', null, now()), 'met', ''); raise exception 'end_move took an empty "by"'; exception when invalid_parameter_value then null; end;
  perform pg_temp.end_all();
end $$;

-- ---- The queue: a row to land, held or landed in place, and nothing else changed ----
do $$
declare
  boss uuid := pg_temp.boss();
  general uuid := (select id from boards where slug = 'general');
  meeting bigint;
  q bigint;
  admin uuid := tests.account('mv-queue-admin');
  row_ jsonb;
  mv uuid;
  at timestamptz := now() + interval '1 day';
begin
  insert into move_kinds (key, structural) values ('renameBoard', true), ('lockThread', false) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict do nothing;
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), now(), now(), 'ok') returning id into meeting;
  row_ := jsonb_build_object('board', general, 'name', 'Queued Palace', 'premise', 'p', 'description', 'd');

  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (meeting, 'mv-boss', 'renameBoard', row_, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 1)), repeat('w', 200), at, at + interval '3 days', true) returning id into q;
  -- A reason over 200 characters; a demand outside the catalog; a flag that disagrees with the catalog; an expiry before the landing; an unknown move kind.
  begin insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, repeat('w', 201), at, at + interval '1 day', true); raise exception 'a reason of 201 characters was queued';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, '{"kind": "shout", "params": {}}', 'w', at, at + interval '1 day', true); raise exception 'a demand outside the catalog was queued';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, 'w', at, at + interval '1 day', false); raise exception 'a structural move was queued as not structural';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, 'w', at, at, true); raise exception 'a move that expires as it lands was queued';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'shout', row_, 'w', at, at + interval '1 day', true); raise exception 'a move outside move_kinds was queued';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural) values (meeting, 'nobody', 'renameBoard', row_, 'w', at, at + interval '1 day', true); raise exception 'a move by no staff member was queued';
  exception when foreign_key_violation then null; end;

  -- A demand whose params cannot be checked is refused at the door, as a landed move's is: a row the tick could never land would fail every minute.
  begin insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, '{"kind": "postsOnBoard", "params": {"count": 1}}', 'w', at, at + interval '1 day', true); raise exception 'a queued demand with no board was queued';
  exception when check_violation then null; end;
  begin insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural) values (meeting, 'mv-boss', 'renameBoard', row_, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 0)), 'w', at, at + interval '1 day', true); raise exception 'a queued demand of zero posts was queued';
  exception when check_violation then null; end;

  -- Only held_at, held_by and landed_act move, each once, and a held move is not a landed one. The tick also writes the failure it met
  -- landing a row (failed_at and failure, together), and nothing else.
  begin update queued_moves set failed_at = now() where id = q; raise exception 'a failure was recorded with no reason';
  exception when check_violation then null; end;
  update queued_moves set failed_at = now(), failure = 'it did not land' where id = q;
  update queued_moves set failed_at = now(), failure = 'it still did not land' where id = q;
  if (select failure from queued_moves where id = q) is distinct from 'it still did not land' then raise exception 'a later failure did not overwrite the earlier one'; end if;
  begin update queued_moves set kind = 'lockThread' where id = q; raise exception 'a queued move''s kind was changed';
  exception when check_violation then null; end;
  begin update queued_moves set go_live_at = at - interval '1 day' where id = q; raise exception 'a queued move''s time was changed';
  exception when check_violation then null; end;
  begin update queued_moves set held_at = now() where id = q; raise exception 'a move was held by no one';
  exception when check_violation then null; end;
  update queued_moves set held_at = now(), held_by = admin where id = q;
  begin update queued_moves set landed_act = (select id from acts limit 1) where id = q; raise exception 'a held move was landed';
  exception when check_violation then null; end;

  insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
  values (meeting, 'mv-boss', 'renameBoard', row_, 'w', at, at + interval '1 day', true) returning id into q;
  mv := pg_temp.move(general, 'Queued Palace', null, now());
  update queued_moves set landed_act = mv where id = q;
  begin update queued_moves set landed_act = pg_temp.move(general, 'Another', null, now()) where id = q; raise exception 'a landed move landed again';
  exception when check_violation then null; end;
  begin update queued_moves set held_at = now(), held_by = admin where id = q; raise exception 'a landed move was held';
  exception when check_violation then null; end;

  -- The tick finds what is due by an index on the rows still waiting, and a log reads one staff member's moves by another.
  if not exists (select 1 from pg_indexes where tablename = 'queued_moves' and indexname = 'queued_moves_due' and indexdef like '%(go_live_at)%' and indexdef like '%landed_act IS NULL%' and indexdef like '%held_at IS NULL%') then
    raise exception 'the tick has no index on the queued moves still waiting';
  end if;
  perform pg_temp.end_all();
end $$;

-- ---- demand_progress: a case for every demand kind, counting only Acts after the move landed ----
create function pg_temp.each_demand(fixtures jsonb, landed timestamptz) returns integer language plpgsql as $$
declare
  k text;
  mv uuid;
  p jsonb;
  seen integer := 0;
begin
  for k in select key from demand_kinds order by key loop
    if fixtures -> k is null then raise exception 'no fixture for the demand kind %', k; end if;
    mv := pg_temp.move((fixtures #>> '{postsOnBoard,board}')::uuid, 'Fixture ' || k, jsonb_build_object('kind', k, 'params', fixtures -> k), landed);
    p := demand_progress(mv);
    if jsonb_typeof(p -> 'done') <> 'number' or jsonb_typeof(p -> 'of') <> 'number' or jsonb_typeof(p -> 'met') <> 'boolean' then raise exception 'demand_progress for % is %', k, p; end if;
    seen := seen + 1;
  end loop;
  return seen;
end $$;

do $$
declare
  boss uuid := pg_temp.boss();
  general uuid;
  other uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  tg uuid;
  tother uuid;
  land timestamptz := now() - interval '1 hour';
  old_post uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; pother uuid; c4_old uuid; c4_new uuid;
  r1 uuid; r2 uuid; old_c1 uuid;
  mv uuid;
  fixtures jsonb;
  poisoned boolean := false;
  n integer;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard'), ('distinctCharactersOnBoard'), ('quadrantOnBoard'), ('characterPostsInThread'), ('crossQuote') on conflict do nothing;
  -- Boards of their own, so no Act another section wrote counts here.
  insert into boards (slug, name, description) values ('progress-main', 'Progress Main', 'x') returning id into general;
  insert into threads (board, title) values (general, 'Progress thread') returning id into tg;
  insert into boards (slug, name, description) values ('progress-other', 'Progress Other', 'x') returning id into other;
  insert into threads (board, title) values (other, 'Elsewhere') returning id into tother;
  c1 := tests.character(tests.account('mv-p1'), 'Mv P1'); c2 := tests.character(tests.account('mv-p2'), 'Mv P2');
  c3 := tests.character(tests.account('mv-p3'), 'Mv P3'); c4 := tests.character(tests.account('mv-p4'), 'Mv P4');

  -- Before the landing: c1's post (it earned 5 reactions), and c4's post; none of it counts.
  old_post := tests.post(c1, tg, 'Before.', land - interval '10 minutes');
  c4_old := tests.post(c4, tg, 'Before, too.', land - interval '5 minutes');
  insert into reaction_tallies (act, kind, count) values (old_post, 'up', 5);
  fixtures := jsonb_build_object(
    'postsOnBoard', jsonb_build_object('board', general, 'count', 3),
    'distinctCharactersOnBoard', jsonb_build_object('board', general, 'count', 3),
    'quadrantOnBoard', jsonb_build_object('board', general, 'quadrant', 'excitedPositive', 'count', 4),
    'characterPostsInThread', jsonb_build_object('character', c4, 'thread', tg),
    'crossQuote', jsonb_build_object('a', c1, 'b', c2, 'reactions', 4));

  -- After it: two posts by c1 and one by c2 on the board, the Boss's own post, a post elsewhere.
  p1 := tests.post(c1, tg, 'One.', land + interval '1 minute');
  p2 := tests.post(c1, tg, 'Two.', land + interval '2 minutes');
  p3 := tests.post(c2, tg, 'Three.', land + interval '3 minutes');
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.post(boss, tg, 'The Boss posts.', land + interval '4 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  pother := tests.post(c3, tother, 'Elsewhere.', land + interval '5 minutes');
  insert into reaction_tallies (act, kind, count) values (p1, 'up', 3), (p1, 'wow', 1), (p1, 'boo', 2), (pother, 'up', 9);

  -- postsOnBoard: three after the landing (the old post, the Boss's and the other board's are not counted).
  mv := pg_temp.move(general, 'Posts', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 5)), land);
  if demand_progress(mv) is distinct from '{"done": 3, "of": 5, "met": false}' then raise exception 'postsOnBoard is %', demand_progress(mv); end if;
  mv := pg_temp.move(general, 'Posts', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 3)), land);
  if demand_progress(mv) is distinct from '{"done": 3, "of": 3, "met": true}' then raise exception 'postsOnBoard is %', demand_progress(mv); end if;
  -- distinctCharactersOnBoard: c1 and c2.
  mv := pg_temp.move(general, 'Distinct', jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', fixtures -> 'distinctCharactersOnBoard'), land);
  if demand_progress(mv) is distinct from '{"done": 2, "of": 3, "met": false}' then raise exception 'distinctCharactersOnBoard is %', demand_progress(mv); end if;
  -- quadrantOnBoard: 3 up and 1 wow are excitedPositive on a new post; the boo, the old post's 5 and the other board's 9 are not.
  mv := pg_temp.move(general, 'Quadrant', jsonb_build_object('kind', 'quadrantOnBoard', 'params', fixtures -> 'quadrantOnBoard'), land);
  if demand_progress(mv) is distinct from '{"done": 4, "of": 4, "met": true}' then raise exception 'quadrantOnBoard is %', demand_progress(mv); end if;
  mv := pg_temp.move(general, 'Quadrant', jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_set(fixtures -> 'quadrantOnBoard', '{count}', '6')), land);
  if demand_progress(mv) is distinct from '{"done": 4, "of": 6, "met": false}' then raise exception 'quadrantOnBoard of 6 is %', demand_progress(mv); end if;
  mv := pg_temp.move(general, 'Quadrant', jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', general, 'quadrant', 'excitedNegative', 'count', 4)), land);
  if demand_progress(mv) is distinct from '{"done": 2, "of": 4, "met": false}' then raise exception 'excitedNegative is %', demand_progress(mv); end if;
  -- characterPostsInThread: c4's only post is from before the landing.
  mv := pg_temp.move(general, 'Thread', jsonb_build_object('kind', 'characterPostsInThread', 'params', fixtures -> 'characterPostsInThread'), land);
  if demand_progress(mv) is distinct from '{"done": 0, "of": 1, "met": false}' then raise exception 'characterPostsInThread is %', demand_progress(mv); end if;
  -- crossQuote: c1 replies to c2's post and it draws 4; c2 replies to c1's post and it draws 3, one short.
  r1 := tests.act(c1, 'post', tg, '{"body": "Quoting c2"}', p3, land + interval '8 minutes');
  insert into reaction_tallies (act, kind, count) values (r1, 'up', 4);
  r2 := tests.act(c2, 'post', tg, '{"body": "Quoting c1"}', p2, land + interval '9 minutes');
  insert into reaction_tallies (act, kind, count) values (r2, 'up', 2), (r2, 'wow', 1);
  -- A third character quoting c2, however loved, is not c1 quoting c2.
  insert into reaction_tallies (act, kind, count) values (tests.act(c3, 'post', tg, '{"body": "c3 quotes c2"}', p3, land + interval '9 minutes'), 'up', 40);
  mv := pg_temp.move(general, 'Cross', jsonb_build_object('kind', 'crossQuote', 'params', fixtures -> 'crossQuote'), land);
  if demand_progress(mv) is distinct from '{"done": 1, "of": 2, "met": false}' then raise exception 'crossQuote is %', demand_progress(mv); end if;
  -- A reply before the landing, quoting the other, counts for nothing.
  old_c1 := tests.act(c2, 'post', tg, '{"body": "Early"}', old_post, land - interval '2 minutes');
  insert into reaction_tallies (act, kind, count) values (old_c1, 'up', 40);
  if demand_progress(mv) is distinct from '{"done": 1, "of": 2, "met": false}' then raise exception 'a reply before the landing counted: %', demand_progress(mv); end if;

  -- Then the board fills: c3 posts, c4 posts in the thread, c2's reply draws one more.
  p4 := tests.post(c3, tg, 'Four.', land + interval '6 minutes');
  c4_new := tests.post(c4, tg, 'Now c4.', land + interval '7 minutes');
  insert into reaction_tallies (act, kind, count) values (r2, 'meh', 1), (p4, 'up', 2);
  mv := pg_temp.move(general, 'Distinct', jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', fixtures -> 'distinctCharactersOnBoard'), land);
  if demand_progress(mv) is distinct from '{"done": 3, "of": 3, "met": true}' then raise exception 'distinctCharactersOnBoard is %', demand_progress(mv); end if;
  mv := pg_temp.move(general, 'Thread', jsonb_build_object('kind', 'characterPostsInThread', 'params', fixtures -> 'characterPostsInThread'), land);
  if demand_progress(mv) is distinct from '{"done": 1, "of": 1, "met": true}' then raise exception 'characterPostsInThread is %', demand_progress(mv); end if;
  mv := pg_temp.move(general, 'Cross', jsonb_build_object('kind', 'crossQuote', 'params', fixtures -> 'crossQuote'), land);
  if demand_progress(mv) is distinct from '{"done": 2, "of": 2, "met": true}' then raise exception 'crossQuote is %', demand_progress(mv); end if;
  -- A move with no demand has nothing to meet.
  mv := pg_temp.move(general, 'No demand', null, land);
  if demand_progress(mv) is distinct from '{"done": 0, "of": 0, "met": false}' then raise exception 'a move with no demand is %', demand_progress(mv); end if;

  -- An Act that is no move, and a demand whose kind has no case, raise.
  begin perform demand_progress(p1); raise exception 'demand_progress took a post'; exception when no_data_found then null; end;
  insert into demand_kinds (key) values ('vanishing') on conflict do nothing;
  mv := pg_temp.move(general, 'Vanishing', '{"kind": "vanishing", "params": {}}', land);
  begin perform demand_progress(mv); raise exception 'demand_progress took a demand kind with no case'; exception when invalid_parameter_value then null; end;
  delete from demand_kinds where key = 'vanishing';

  -- The two lists are one: for every row of demand_kinds, a fixture move with that demand evaluates without raising.
  n := pg_temp.each_demand(fixtures, land);
  if n <> 5 then raise exception 'the per-row test saw % demand kinds', n; end if;
  -- THE POISON: a demand kind seeded with no SQL case makes the per-row test raise, and a row removed makes it pass again.
  insert into demand_kinds (key) values ('poison') on conflict do nothing;
  begin perform pg_temp.each_demand(fixtures || '{"poison": {}}', land); exception when invalid_parameter_value then poisoned := true; end;
  if not poisoned then raise exception 'a demand kind with no case did not make the per-row test raise'; end if;
  delete from demand_kinds where key = 'poison';
  if pg_temp.each_demand(fixtures, land) <> 5 then raise exception 'the per-row test is red after the poison was removed'; end if;
  -- And a kind with a case but no fixture here is the test's own failure, said so.
  insert into demand_kinds (key) values ('crossQuote2') on conflict do nothing;
  begin perform pg_temp.each_demand(fixtures, land); raise exception 'a kind with no fixture passed the per-row test'; exception when raise_exception then if sqlerrm not like 'no fixture for the demand kind crossQuote2' then raise; end if; end;
  delete from demand_kinds where key = 'crossQuote2';
  perform pg_temp.end_all();
end $$;

-- ---- What clients reach: the two views, and nothing of the queue or the catalogs ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  ann uuid := tests.account('mv-client');
  t text;
  r text;
  denied boolean;
  mv uuid;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  mv := pg_temp.move(general, 'Client Palace', null, now() - interval '1 hour');
  foreach r in array array['anon', 'authenticated'] loop
    if r = 'anon' then perform tests.become_anon(); else perform tests.become(ann); end if;
    if (select name from boards_now where id = general) is distinct from 'Client Palace' then raise exception '% cannot read boards_now', r; end if;
    if not exists (select 1 from moves_log where id = mv) then raise exception '% cannot read moves_log', r; end if;
    foreach t in array array['queued_moves', 'move_kinds', 'demand_kinds'] loop
      denied := false;
      begin execute format('select 1 from %I limit 1', t); exception when insufficient_privilege then denied := true; end;
      if not denied then raise exception '% can read %', r, t; end if;
    end loop;
    foreach t in array array['end_move(uuid,text,text)', 'demand_progress(uuid)'] loop
      if has_function_privilege(r, t, 'execute') then raise exception '% can execute %', r, t; end if;
    end loop;
    perform tests.unbecome();
  end loop;
  foreach t in array array['end_move(uuid,text,text)', 'demand_progress(uuid)'] loop
    if not has_function_privilege('service_role', t, 'execute') then raise exception 'service_role cannot execute %', t; end if;
  end loop;
  -- demand_progress is the digest role's: owned by it, security definer, and the role reaches no queue or catalog.
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'demand_progress(uuid)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'demand_progress is not owned by kayfabb_digest'; end if;
  if not (select prosecdef from pg_proc where oid = 'demand_progress(uuid)'::regprocedure) then raise exception 'demand_progress is not security definer'; end if;
  foreach t in array array['queued_moves', 'move_kinds', 'demand_kinds'] loop
    if has_table_privilege('kayfabb_digest', t, 'select,insert,update,delete') then raise exception 'the digest role reaches %', t; end if;
  end loop;
  if not has_table_privilege('kayfabb_digest', 'boards_now', 'select') then raise exception 'the digest role cannot read the board names'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- moves_log: newest first, with how each ended, and an index to page one staff member's moves ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  other_boss uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  base timestamptz := now() - interval '10 days';
  rows_ jsonb;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Mv Other Boss', 'mv-other', 'boss', now()) returning id into other_boss;
  m1 := pg_temp.move(general, 'Log One', null, base);
  m2 := pg_temp.move(general, 'Log Two', null, base + interval '1 day');
  m3 := pg_temp.move(general, 'Log Three', null, base + interval '2 days');
  perform set_config('kayfabb.staff_writer', 'on', true);
  m4 := tests.act(other_boss, 'move', pg_temp.announcements(), '{"kind": "renameBoard", "params": {}}', null, base + interval '3 days');
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.end_at(m2, 'expired', base + interval '2 days 12 hours');
  perform end_move(m3, 'reversed', 'admin');

  select jsonb_agg(jsonb_build_object('id', l.id, 'staff', l.staff, 'kind', l.kind, 'why', l.ended_why, 'by', l.ended_by, 'ended', l.ended_at is not null) order by l.at desc, l.id desc) into rows_
  from moves_log l where l.id in (m1, m2, m3, m4);
  if rows_ is distinct from jsonb_build_array(
      jsonb_build_object('id', m4, 'staff', 'mv-other', 'kind', 'renameBoard', 'why', null, 'by', null, 'ended', false),
      jsonb_build_object('id', m3, 'staff', 'mv-boss', 'kind', 'renameBoard', 'why', 'reversed', 'by', 'admin', 'ended', true),
      jsonb_build_object('id', m2, 'staff', 'mv-boss', 'kind', 'renameBoard', 'why', 'expired', 'by', 'tick', 'ended', true),
      jsonb_build_object('id', m1, 'staff', 'mv-boss', 'kind', 'renameBoard', 'why', null, 'by', null, 'ended', false)) then
    raise exception 'moves_log is %', rows_;
  end if;
  if (select params ->> 'name' from moves_log where id = m1) is distinct from 'Log One' or (select demand from moves_log where id = m1) is not null then raise exception 'moves_log does not carry the params'; end if;
  -- One staff member's page, newest first by (at, id): the keyset a client pages by.
  if (select array_agg(id order by at desc, id desc) from moves_log where staff = 'mv-boss' and id in (m1, m2, m3, m4)) is distinct from array[m3, m2, m1] then raise exception 'one staff member''s moves are not newest first'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'acts' and indexname = 'acts_moves' and indexdef like '%created_at DESC, id DESC%' and indexdef like '%kind = ''move''%') then
    raise exception 'no index serves one staff member''s moves newest first';
  end if;
  -- What reads "the moves in force" reads open_moves, so it is exactly the moves with no end: a landed move is in it, an ended one is not.
  if exists (select 1 from acts a where a.kind = 'move' and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id) and not exists (select 1 from open_moves o where o.move_act = a.id))
     or exists (select 1 from open_moves o join acts e on e.kind = 'move_end' and e.target_act_id = o.move_act)
     or not exists (select 1 from open_moves where move_act = m1) or exists (select 1 from open_moves where move_act = m2) then
    raise exception 'open_moves is not the moves in force';
  end if;
  perform pg_temp.end_all();
end $$;

-- ---- The digest lists the moves in force and those ended in its window, capped, in-force first ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  other uuid;
  base timestamptz := '2040-06-01T12:00:00Z';
  ann uuid := tests.account('mv-digest');
  c uuid := tests.character(ann, 'Mv Digest');
  t uuid := tests.thread('Digest thread');
  m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  d jsonb;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict do nothing;
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '2'), ('digestExcerptChars', '50') on conflict (key) do update set value = excluded.value;
  insert into boards (slug, name, description) values ('digest-other', 'Digest Other', 'x') returning id into other;
  perform tests.post(c, t, 'In the window.', base);
  -- In force from before the window; ended in the window; ended before the window; in force from inside it.
  m1 := pg_temp.move(general, 'Digest Palace', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 3)), base - interval '5 hours');
  m2 := pg_temp.move(other, 'Ended In Window', null, base - interval '3 hours');
  m3 := pg_temp.move(other, 'Ended Before', null, base - interval '6 hours');
  m4 := pg_temp.move(other, 'In Force Late', null, base - interval '30 minutes');
  perform pg_temp.end_at(m2, 'expired', base - interval '10 minutes');
  perform pg_temp.end_at(m3, 'met', base - interval '5 hours');

  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  -- Capped at digestExcerpts = 2: the two in force, the newest landed first; the ended one is cut.
  if jsonb_array_length(d -> 'moves') <> 2 or (d #>> '{moves,0,act}')::uuid <> m4 or (d #>> '{moves,1,act}')::uuid <> m1 then raise exception 'the capped moves are %', d -> 'moves'; end if;
  if d #> '{moves,1,progress}' is distinct from '{"done": 1, "of": 3, "met": false}' or d #>> '{moves,1,kind}' <> 'renameBoard' or d #>> '{moves,1,demand,kind}' <> 'postsOnBoard' or d #>> '{moves,1,params,name}' <> 'Digest Palace' then
    raise exception 'a move in the digest lacks its kind, params, demand or progress: %', d #> '{moves,1}';
  end if;
  if coalesce(d #> '{moves,0,ended}', 'null'::jsonb) <> 'null'::jsonb then raise exception 'a move in force has an end: %', d #> '{moves,0}'; end if;
  -- The thread's board is named as boards_now names it.
  if d #>> '{threads,0,board}' is distinct from 'Digest Palace' then raise exception 'the digest names the board %, not its name now', d #>> '{threads,0,board}'; end if;

  update settings set value = '5' where key = 'digestExcerpts';
  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  if (select array_agg((e ->> 'act')::uuid) from jsonb_array_elements(d -> 'moves') e) is distinct from array[m4, m1, m2] then raise exception 'the moves are %', d -> 'moves'; end if;
  if d #>> '{moves,2,ended,why}' <> 'expired' or d #>> '{moves,2,ended,by}' <> 'tick' or (d #>> '{moves,2,ended,at}')::timestamptz <> base - interval '10 minutes' then raise exception 'an ended move does not say how and when: %', d #> '{moves,2}'; end if;
  -- A move reversed by an admin in the window is listed as reversed: the Director learns of it from the digest.
  perform pg_temp.end_at(m4, 'reversed', base + interval '30 minutes', 'admin');
  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = m4 and e #>> '{ended,why}' = 'reversed' and e #>> '{ended,by}' = 'admin') then raise exception 'a reversed move is not in the digest: %', d -> 'moves'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- A demand's params are held at the door: the keys its kind needs, of the right types ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  bad jsonb;
  mv uuid;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard'), ('distinctCharactersOnBoard'), ('quadrantOnBoard'), ('characterPostsInThread'), ('crossQuote') on conflict do nothing;
  for bad in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('kind', 'postsOnBoard'),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general)),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 0)),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', -2)),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 1.5)),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 'three')),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', '3')),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', 'not a uuid', 'count', 3)),
    jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', jsonb_build_object('count', 3)),
    jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', general, 'count', 4)),
    jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', general, 'quadrant', 7, 'count', 4)),
    jsonb_build_object('kind', 'characterPostsInThread', 'params', jsonb_build_object('character', c1)),
    jsonb_build_object('kind', 'characterPostsInThread', 'params', jsonb_build_object('character', c1, 'thread', 'x')),
    jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', c1, 'b', c2)),
    jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', c1, 'b', c2, 'reactions', 0)),
    jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', c1, 'b', c1, 'reactions', 6)),
    jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', c1, 'b', upper(c1::text), 'reactions', 6)))) loop
    begin
      mv := pg_temp.move(general, 'Malformed', bad, now());
      raise exception 'a move with the demand % was written', bad;
    exception when check_violation then perform set_config('kayfabb.staff_writer', '', true); end;
  end loop;
  -- Well-formed ones, uppercase uuids included, land; a kind with no case here is not this check's to judge (the poison seeds one).
  mv := pg_temp.move(general, 'Fine one', jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', c1, 'b', c2, 'reactions', 6)), now());
  mv := pg_temp.move(general, 'Fine two', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', upper(general::text), 'count', 2)), now());
  perform pg_temp.end_all();
end $$;

-- ---- One malformed landed move does not stop the digest ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  base timestamptz := '2041-06-01T12:00:00Z';
  good uuid; broken uuid; notnum uuid; notuuid uuid;
  d jsonb;
  p jsonb;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict do nothing;
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '10'), ('digestExcerptChars', '50') on conflict (key) do update set value = excluded.value;
  good := pg_temp.move(general, 'Good Palace', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 3)), base - interval '2 hours');
  -- Moves that landed malformed (before the door's check, or restored from an export): the check is off for these writes only.
  alter table acts disable trigger acts_well_formed;
  broken := pg_temp.move(general, 'No Count', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general)), base - interval '90 minutes');
  notnum := pg_temp.move(general, 'Word Count', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', general, 'count', 'many')), base - interval '80 minutes');
  notuuid := pg_temp.move(general, 'Bad Board', jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', 'nope', 'b', general, 'reactions', 6)), base - interval '70 minutes');
  alter table acts enable trigger acts_well_formed;
  begin perform demand_progress(broken); raise exception 'demand_progress took a demand with no count'; exception when invalid_parameter_value then null; end;
  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  if jsonb_array_length(d -> 'moves') <> 4 then raise exception 'the digest lists % moves, not 4: %', jsonb_array_length(d -> 'moves'), d -> 'moves'; end if;
  select e -> 'progress' into p from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = good;
  if p is distinct from '{"done": 0, "of": 3, "met": false}' then raise exception 'the good move beside the bad ones has progress %', p; end if;
  foreach p in array array[(select e -> 'progress' from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = broken),
                           (select e -> 'progress' from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = notnum),
                           (select e -> 'progress' from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = notuuid)] loop
    if p ->> 'error' is null or p -> 'met' is distinct from 'false'::jsonb or p -> 'done' is distinct from '0'::jsonb or p -> 'of' is distinct from '0'::jsonb then
      raise exception 'a malformed move is not listed with its error: %', p;
    end if;
  end loop;
  if (select e #>> '{progress,error}' from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = notuuid) is distinct from '22P02' then raise exception 'the error is the SQLSTATE'; end if;
  if (select e #>> '{progress,error}' from jsonb_array_elements(d -> 'moves') e where (e ->> 'act')::uuid = broken) is distinct from '22023' then raise exception 'the error of a missing count is not 22023'; end if;
  -- The wrapper is the digest role's, as the evaluator is, and no client reaches it.
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'demand_progress_or_error(uuid)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'demand_progress_or_error is not owned by kayfabb_digest'; end if;
  if has_function_privilege('anon', 'demand_progress_or_error(uuid)', 'execute') or has_function_privilege('authenticated', 'demand_progress_or_error(uuid)', 'execute')
     or not has_function_privilege('service_role', 'demand_progress_or_error(uuid)', 'execute') then raise exception 'demand_progress_or_error is granted wrongly'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- An uppercase board uuid in a landed rename still shows ----
do $$
declare
  b uuid;
  mv uuid;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into boards (slug, name, description) values ('upper-board', 'Upper Board', 'x') returning id into b;
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act(pg_temp.boss(), 'move', pg_temp.announcements(), jsonb_build_object('kind', 'renameBoard', 'body', 'x',
    'params', jsonb_build_object('board', upper(b::text), 'name', 'Shouted Palace', 'premise', 'p', 'description', 'd')), null, now());
  perform set_config('kayfabb.staff_writer', '', true);
  if (select name from boards_now where id = b) is distinct from 'Shouted Palace' then raise exception 'a rename with an uppercase board uuid does not show'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- open_moves can be rebuilt (an admin runs it after a partial restore) ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  m1 uuid; m2 uuid; ended uuid; post uuid;
  n integer;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  perform pg_temp.end_all();
  m1 := pg_temp.move(general, 'Rebuild One', null, now() - interval '2 hours');
  m2 := pg_temp.move(general, 'Rebuild Two', null, now() - interval '1 hour');
  ended := pg_temp.move(general, 'Rebuild Ended', null, now() - interval '3 hours');
  perform end_move(ended, 'expired', 'test');
  post := tests.post(tests.character(tests.account('mv-rebuild'), 'Mv Rebuild'), tests.thread());
  if has_function_privilege('anon', 'rebuild_open_moves()', 'execute') or has_function_privilege('authenticated', 'rebuild_open_moves()', 'execute')
     or not has_function_privilege('service_role', 'rebuild_open_moves()', 'execute') then raise exception 'rebuild_open_moves is granted wrongly'; end if;
  if rebuild_open_moves() <> 0 then raise exception 'a rebuild of a consistent table changed rows'; end if;
  delete from open_moves where move_act = m1;
  n := rebuild_open_moves();
  if n <> 1 or not exists (select 1 from open_moves where move_act = m1 and landed_at = (select created_at from acts where id = m1)) then raise exception 'a deleted row was not restored (changed %, row %)', n, (select to_jsonb(o) from open_moves o where o.move_act = m1); end if;
  insert into open_moves (move_act, landed_at) values (ended, now());
  n := rebuild_open_moves();
  if n <> 1 or exists (select 1 from open_moves where move_act = ended) then raise exception 'a stale row of an ended move was not removed'; end if;
  insert into open_moves (move_act, landed_at) values (post, now());
  delete from open_moves where move_act = m2;
  n := rebuild_open_moves();
  if n <> 2 or exists (select 1 from open_moves where move_act = post) or not exists (select 1 from open_moves where move_act = m2) then raise exception 'a row of an Act that is no move was not removed with another restored'; end if;
  n := rebuild_open_moves();
  if n <> 0 then raise exception 'a second rebuild changed % rows', n; end if;
  select count(*) into n from open_moves;
  if n <> 2 then raise exception 'open_moves holds % rows, not the two moves in force', n; end if;
  perform pg_temp.end_all();
end $$;
