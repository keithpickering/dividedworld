-- The group and bar reads use the move index (supabase/migrations/0138_group_reads.sql; final review B1, "Weigh a design at the scale of a busy instance"):
-- group_now's open-move probe, bars_of and bars_now each find a character's conferGroup moves through acts_group_moves (0129), so a busy instance's hundreds of moves in
-- force are never scanned to answer one character. Unlike 0125's gr5, which turns the sequential scan off and asks whether the index can be used, this runs with the planner
-- free to choose, over a busy instance's moves it has analyzed: a query the index cannot serve (a predicate missing `kind = 'move'`, a character cast to uuid) is planned as a
-- Seq Scan on open_moves or acts and fails here.
--
-- The fixture is a busy instance's, and that is what makes the answer this file's own. open_moves is 20,000 rows (some 130 pages), 400 of them group moves. At a few hundred
-- rows open_moves is three pages, and the planner rightly prices reading all three (a hash join over a sequential scan) within a few percent of one probe of its primary key
-- (a nested loop): which of the two it chose turned on the dead rows and page counts the files before this one left behind, so the check passed in the suite and failed
-- alone on a fresh database. At 20,000 the sequential scan costs many times the probe, in every statistics state.

create function pg_temp.plan(stmt text) returns text language plpgsql as $$
declare
  ln record;
  out text := '';
begin
  for ln in execute 'explain ' || stmt loop
    out := out || E'\n' || ln."QUERY PLAN";
  end loop;
  return out;
end $$;

-- The rows of a table this transaction has read so far, by any path: those a sequential or bitmap scan returned and those an index scan fetched. Counting only the first
-- would pass a probe that walks every group move in the index (a character cast to uuid, which the index's expression cannot serve).
create function pg_temp.rows_read(rel regclass) returns bigint language sql as $$
  select coalesce(pg_stat_get_xact_tuples_returned(rel), 0) + coalesce(pg_stat_get_xact_tuples_fetched(rel), 0)
$$;

do $$
declare
  boss uuid := tests.account('gp-boss');
  gm uuid := tests.character(boss, 'Gp Staff');
  target uuid := tests.character(boss, 'Gp Target');
  board uuid;
  thr uuid;
  plan text;
  n integer;
  i integer;
  idx0 bigint;
  om0 bigint;
  ac0 bigint;
begin
  insert into boards (slug, name) values ('gp-board', 'Gp Board') returning id into board;
  insert into threads (board, title) values (board, 'Gp thread') returning id into thr;
  -- 20,000 moves in force, as a busy instance has once lasting moves never expire (0318): every fiftieth confers a group, each on its own character, and the target's is
  -- one of those 400; the rest are moves of another kind. The Acts are written with the triggers off (a move is a staff character's Act, and the
  -- staff machinery is not what is under test) and each is put in force by hand, as acts_track_moves would.
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq)
  select gm, 'move', thr,
         case when g % 50 = 1 then jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', case when g = 1 then target else gen_random_uuid() end, 'group', 'trialMembers', 'board', board))
              else jsonb_build_object('kind', 'renameBoard', 'params', jsonb_build_object('board', board, 'name', 'Gp ' || g)) end, g
  from generate_series(1, 20000) g;
  insert into open_moves (move_act, landed_at) select id, created_at from acts where kind = 'move';
  set local session_replication_role = origin;
  if (select count(*) from open_moves) < 20000 then raise exception 'the seeded moves are not in force: %', (select count(*) from open_moves); end if;
  analyze acts;
  analyze open_moves;

  -- The functions are security definer and not inlined, so their plans are read as the transaction's own scan counters: each real call below must scan acts_group_moves and
  -- never read more than a few rows of open_moves or acts by any path (a sequential scan would read 20,000 a call, a walk of the index's group moves 400).
  perform pg_stat_force_next_flush();
  idx0 := coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0);
  om0 := pg_temp.rows_read('open_moves');
  ac0 := pg_temp.rows_read('acts');
  for i in 1..5 loop
    if group_now(target) is distinct from 'trialMembers' then raise exception 'group_now: %', group_now(target); end if;
  end loop;
  if coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0) - idx0 < 5 then raise exception 'group_now''s probe does not use acts_group_moves'; end if;
  if pg_temp.rows_read('open_moves') - om0 > 50 or pg_temp.rows_read('acts') - ac0 > 50 then
    raise exception 'group_now''s probe reads many rows of open_moves or acts (rows read: open_moves %, acts %)', pg_temp.rows_read('open_moves') - om0, pg_temp.rows_read('acts') - ac0;
  end if;

  idx0 := coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0);
  om0 := pg_temp.rows_read('open_moves');
  ac0 := pg_temp.rows_read('acts');
  select count(*) into n from bars_of(target);
  if n is distinct from 1 then raise exception 'bars_of target: %', n; end if;
  if not barred(target, board) then raise exception 'barred: the seeded bar is not read'; end if;
  if coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0) - idx0 < 2 then raise exception 'bars_of and barred do not use acts_group_moves'; end if;
  if pg_temp.rows_read('open_moves') - om0 > 50 or pg_temp.rows_read('acts') - ac0 > 50 then
    raise exception 'bars_of or barred reads many rows of open_moves or acts (rows read: open_moves %, acts %)', pg_temp.rows_read('open_moves') - om0, pg_temp.rows_read('acts') - ac0;
  end if;

  -- bars_now, a view that is inlined: a read of every bar starts from the index's rows (the view's `kind = 'move'` is what lets the planner use the partial index).
  plan := pg_temp.plan('select * from bars_now');
  if plan not like '%acts_group_moves%' or plan like '%Seq Scan on open_moves%' or plan like '%Seq Scan on acts%' then raise exception 'bars_now does not start from acts_group_moves: %', plan; end if;
end $$;
