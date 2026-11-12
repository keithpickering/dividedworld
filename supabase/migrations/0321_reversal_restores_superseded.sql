-- A reversed moveThread restores the move it superseded (plan Task 2, the coordinator's reading of section 4).
--
-- A thread's place from moveThreads is the latest landed moveThread of it that has not been ended as reversed or overturned. An end as superseded does not take a move out of
-- that reckoning, so when the move that superseded it is reversed the earlier move's board applies again. For every other purpose a superseded move stays ended (it is not in
-- open_moves, it is not in force, nothing writes a new Act for it). thread_place and thread_places_computed are redefined from 0154 and keep agreeing (0327 holds them equal).
-- Several moves land in one tick's transaction with one created_at, so the latest is told by the Act's seq in its thread (the announcements thread's, in landing order) before its id.
-- end_move's rebuild set is unchanged: a moveThread's end rebuilds its own thread, which is the only thread whose place it can change; a merge or created board's set already reads
-- every moveThread Act naming a board, ended or not.
-- The reversal's words stay true: the move_end says why 'reversed' by 'admin' and the log reads "reversed by an admin"; the in-character line (moveReversed) says the move is undone and
-- names no board; the kind's own words say where the thread went, never that it went home. Cost: the all-threads rebuild reads the moveThread Acts (a partial index's worth), not open_moves.

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
    and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
    and exists (select 1 from boards d where d.id = safe_uuid(a.payload #>> '{params,board}'))
  order by a.created_at desc, a.seq desc nulls last, a.id desc limit 1;
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

create or replace function thread_places_computed() returns table (thread uuid, place uuid)
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
      select safe_uuid(a.payload #>> '{params,thread}') as th, safe_uuid(a.payload #>> '{params,board}') as bd, a.created_at, a.seq, a.id
      from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread'
        and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
    ) m
    where m.th is not null and exists (select 1 from boards d where d.id = m.bd)
    order by m.th, m.created_at desc, m.seq desc nulls last, m.id desc
  )
  select t.id, p.cur from threads t left join mt on mt.th = t.id join placed p on p.board = coalesce(mt.bd, t.origin_board)
$$;
