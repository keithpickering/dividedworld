-- The group and bar reads use the move index (supabase/migrations/0134_group_reads.sql; final review B1, "Weigh a design at the scale of a busy instance"):
-- group_now's open-move probe, bars_of and bars_now each find a character's conferGroup moves through acts_group_moves (0125), so a busy instance's hundreds of moves in
-- force are never scanned to answer one character. Unlike 0125's gr5, which turns the sequential scan off and asks whether the index can be used, this EXPLAINs with the planner
-- free to choose, over a few hundred open moves it has analyzed: a query the index cannot serve (a predicate missing `kind = 'move'`, a character cast to uuid) is planned as a
-- Seq Scan on open_moves or acts and fails here.

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
  -- 400 moves in force, each on its own character; the target's is one of them. The Acts are written with the triggers off (a move is a staff character's Act, and the
  -- staff machinery is not what is under test) and each is put in force by hand, as acts_track_moves would.
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq)
  select gm, 'move', thr, jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', case when g = 1 then target else gen_random_uuid() end, 'group', 'trialMembers', 'board', board)), g
  from generate_series(1, 400) g;
  insert into open_moves (move_act, landed_at) select id, created_at from acts where kind = 'move';
  set local session_replication_role = origin;
  if (select count(*) from open_moves) < 400 then raise exception 'the seeded moves are not in force: %', (select count(*) from open_moves); end if;
  analyze acts;
  analyze open_moves;

  -- The functions are security definer and not inlined, so their plans are read as the transaction's own scan counters: each real call below must scan acts_group_moves and
  -- never read more than a few rows of open_moves or acts (a sequential scan of the 400 seeded would read 400 a call).
  perform pg_stat_force_next_flush();
  idx0 := coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0);
  om0 := coalesce(pg_stat_get_xact_tuples_returned('open_moves'::regclass), 0);
  ac0 := coalesce(pg_stat_get_xact_tuples_returned('acts'::regclass), 0);
  for i in 1..5 loop
    if group_now(target) is distinct from 'trialMembers' then raise exception 'group_now: %', group_now(target); end if;
  end loop;
  if coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0) - idx0 < 5 then raise exception 'group_now''s probe does not use acts_group_moves'; end if;
  if coalesce(pg_stat_get_xact_tuples_returned('open_moves'::regclass), 0) - om0 > 50 or coalesce(pg_stat_get_xact_tuples_returned('acts'::regclass), 0) - ac0 > 50 then
    raise exception 'group_now''s probe reads many rows of open_moves or acts (rows read: open_moves %, acts %)', pg_stat_get_xact_tuples_returned('open_moves'::regclass) - om0, pg_stat_get_xact_tuples_returned('acts'::regclass) - ac0;
  end if;

  idx0 := coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0);
  om0 := coalesce(pg_stat_get_xact_tuples_returned('open_moves'::regclass), 0);
  ac0 := coalesce(pg_stat_get_xact_tuples_returned('acts'::regclass), 0);
  select count(*) into n from bars_of(target);
  if n is distinct from 1 then raise exception 'bars_of target: %', n; end if;
  if not barred(target, board) then raise exception 'barred: the seeded bar is not read'; end if;
  if coalesce(pg_stat_get_xact_numscans('acts_group_moves'::regclass), 0) - idx0 < 2 then raise exception 'bars_of and barred do not use acts_group_moves'; end if;
  if coalesce(pg_stat_get_xact_tuples_returned('open_moves'::regclass), 0) - om0 > 50 or coalesce(pg_stat_get_xact_tuples_returned('acts'::regclass), 0) - ac0 > 50 then
    raise exception 'bars_of or barred reads many rows of open_moves or acts (rows read: open_moves %, acts %)', pg_stat_get_xact_tuples_returned('open_moves'::regclass) - om0, pg_stat_get_xact_tuples_returned('acts'::regclass) - ac0;
  end if;

  -- bars_now, a view that is inlined: a read of every bar starts from the index's rows (the view's `kind = 'move'` is what lets the planner use the partial index).
  plan := pg_temp.plan('select * from bars_now');
  if plan not like '%acts_group_moves%' or plan like '%Seq Scan on open_moves%' or plan like '%Seq Scan on acts%' then raise exception 'bars_now does not start from acts_group_moves: %', plan; end if;
end $$;
