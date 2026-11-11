-- Thread places, set-based, and one rule for "in force" (review of 0150, plan Task 1).
--
-- Lasting moves never expire, so open_moves keeps a row for each of them for good: it is not small on a busy instance, and 0150's thread_place, which scanned the
-- open moves for each thread, made a rebuild of every thread cost threads x lasting moves (twice over for the drift check). This migration:
--
--   thread_places_computed()    every thread's place at once: the in-force moveThread, mergeBoard and createBoard rows are read once, keyed by thread and by board; each
--                               board's resolution (a merge in force sends it on, a closed created board goes to its fallback or the first open non-system board, followed until
--                               a board is open, at most 50 steps) is one recursive pass over the boards; a thread is then one join. Cost: the moves in force, the boards and the
--                               threads, each read once, never a nested scan.
--   rebuild_thread_places(...)  for all threads (null): one update from thread_places_computed(). For named threads: thread_place of each, which has an indexed path.
--   thread_places_drift()       one thread_places_computed() joined to threads.
--   thread_place(thread)        for one thread: the in-force moveThread of the thread is one probe of acts_move_thread, a board's merge one probe of acts_merge_board, and a
--                               created board's end one probe of the unique index on a move_end's target. It answers as thread_places_computed() does (a test holds them equal).
--   acts_move_thread, acts_merge_board    partial expression indexes on the moves' params.
--
-- In force, one rule for every lasting kind: a lasting move is in force until it has any move_end (reversed, superseded or overturned), which is what open_moves holds.
-- So a createBoard ended for any reason closes its board (0150 read only `reversed`), and its threads go to its fallback, else the first open non-system board.
--
-- A param that is not a uuid, or names no board (a merge's `into`, a move's `board`, a fallback), makes that move no move at all: it is read as null, never an error.
-- The two functions the readers of a place share (safe_uuid, board_merge_into) are for the database alone, as 0150's are.
--
-- Not changed: a merge cycle is not refused here (queue or landing time, a later task); a cycle stops after 50 steps. board_thread_counts does not yet follow a thread
-- whose board changes (a later task).
-- Masks. Public facts only. Append-only. Ways out: a lasting move ends by reversal. Cost on a busy instance: see above; the rebuild of all threads is for a restore or a repair.

create function safe_uuid(v text) returns uuid
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
$$;

create index acts_move_thread on acts ((lower(payload #>> '{params,thread}'))) where kind = 'move' and payload ->> 'kind' = 'moveThread';
create index acts_merge_board on acts ((lower(payload #>> '{params,board}'))) where kind = 'move' and payload ->> 'kind' = 'mergeBoard';

-- The board a mergeBoard in force sends this one into (the latest, naming a board that exists), else null.
create function board_merge_into(in_board uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select safe_uuid(a.payload #>> '{params,into}')
  from acts a
  where a.kind = 'move' and a.payload ->> 'kind' = 'mergeBoard' and lower(a.payload #>> '{params,board}') = in_board::text
    and exists (select 1 from open_moves o where o.move_act = a.id)
    and exists (select 1 from boards d where d.id = safe_uuid(a.payload #>> '{params,into}'))
  order by a.created_at desc, a.id desc limit 1
$$;

-- A board is open unless a mergeBoard of it is in force or the createBoard that made it has ended, for any reason.
create or replace function board_is_open(in_board uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select board_merge_into(in_board) is null and not exists (
    select 1 from boards b join acts e on e.kind = 'move_end' and e.target_act_id = b.created_by_act where b.id = in_board
  )
$$;

-- One thread's place, by indexed probes.
create or replace function thread_place(in_thread uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  here uuid;
  moved uuid;
  hop uuid;
  fallback uuid;
  steps integer := 0;
begin
  select t.origin_board into here from threads t where t.id = in_thread;
  if here is null then return null; end if;
  select safe_uuid(a.payload #>> '{params,board}') into moved
  from acts a
  where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = in_thread::text
    and exists (select 1 from open_moves o where o.move_act = a.id)
    and exists (select 1 from boards d where d.id = safe_uuid(a.payload #>> '{params,board}'))
  order by a.created_at desc, a.id desc limit 1;
  if moved is not null then here := moved; end if;
  while steps < 50 and not board_is_open(here) loop
    steps := steps + 1;
    hop := board_merge_into(here);
    if hop is null then
      select safe_uuid(a.payload #>> '{params,fallback}') into fallback from boards b join acts a on a.id = b.created_by_act where b.id = here;
      hop := coalesce((select b.id from boards b where b.id = fallback and b.id <> here),
                      (select b.id from boards b where not b.is_system and board_is_open(b.id) order by b.created_at, b.id limit 1));
    end if;
    exit when hop is null or hop = here;
    here := hop;
  end loop;
  return here;
end $$;

-- Every thread's place at once.
create function thread_places_computed() returns table (thread uuid, place uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  mg as (
    select distinct on (m.src) m.src, m.dst from (
      select safe_uuid(a.payload #>> '{params,board}') as src, safe_uuid(a.payload #>> '{params,into}') as dst, a.created_at, a.id
      from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'mergeBoard'
    ) m
    where m.src is not null and exists (select 1 from boards d where d.id = m.dst)
    order by m.src, m.created_at desc, m.id desc
  ),
  bs as (
    select b.id, b.is_system, b.created_at, mg.dst as merged_into,
           (b.created_by_act is not null and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = b.created_by_act)) as made_ended,
           safe_uuid((select a.payload #>> '{params,fallback}' from acts a where a.id = b.created_by_act)) as fallback
    from boards b left join mg on mg.src = b.id
  ),
  first_open as (select x.id from bs x where x.merged_into is null and not x.made_ended and not x.is_system order by x.created_at, x.id limit 1),
  hop as (
    select x.id, (x.merged_into is not null or x.made_ended) as closed,
           coalesce(x.merged_into, case when x.made_ended then coalesce((select f.id from bs f where f.id = x.fallback and f.id <> x.id), (select id from first_open)) end) as nxt
    from bs x
  ),
  walk (board, cur, steps) as (
    select h.id, h.id, 0 from hop h
    union all
    select w.board, h.nxt, w.steps + 1 from walk w join hop h on h.id = w.cur where h.closed and h.nxt is not null and h.nxt <> w.cur and w.steps < 50
  ),
  placed as (select distinct on (w.board) w.board, w.cur from walk w order by w.board, w.steps desc),
  mt as (
    select distinct on (m.th) m.th, m.bd from (
      select safe_uuid(a.payload #>> '{params,thread}') as th, safe_uuid(a.payload #>> '{params,board}') as bd, a.created_at, a.id
      from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'moveThread'
    ) m
    where m.th is not null and exists (select 1 from boards d where d.id = m.bd)
    order by m.th, m.created_at desc, m.id desc
  )
  select t.id, p.cur from threads t left join mt on mt.th = t.id join placed p on p.board = coalesce(mt.bd, t.origin_board)
$$;

create or replace function rebuild_thread_places(which uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if which is null then
    with written as (
      update threads t set board = c.place from thread_places_computed() c where c.thread = t.id and t.board is distinct from c.place returning 1
    ) select count(*)::integer into changed from written;
  else
    with written as (
      update threads t set board = p.place from (select x.id, thread_place(x.id) as place from threads x where x.id = any (which)) p
      where t.id = p.id and p.place is not null and t.board is distinct from p.place returning 1
    ) select count(*)::integer into changed from written;
  end if;
  return changed;
end $$;

create or replace function thread_places_drift() returns table (thread uuid, stored uuid, rebuilt uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.board, c.place from threads t join thread_places_computed() c on c.thread = t.id where t.board is distinct from c.place
$$;

revoke execute on function safe_uuid(text), board_merge_into(uuid), thread_places_computed() from public, anon, authenticated;
grant execute on function safe_uuid(text), board_merge_into(uuid), thread_places_computed() to service_role;
