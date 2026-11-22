-- The staff's threads live on the system board (docs/plans/2026-11-22-system-threads-follow-the-flag-plan.md; issue #983).
--
-- The announcements thread, the Updates thread and each season's Turns thread are the instance's own: made by the seed and the tick, written to by The System and never by a player.
-- They were placed like any thread, by the board they were started on, so an instance whose system flag moved to another board left them behind on the old one. A thread the instance
-- itself makes is now on system_board() wherever it was started, whatever a move or a merge says: moving the flag moves them, and a move cannot take them off it.
--
-- system_threads() is the set, written once: setting_thread('systemAnnouncements'), setting_thread('updatesThread') and every season's turns_thread, without nulls or duplicates. It is
-- security definer with execute revoked from every API role, as setting_thread is; its callers are security definer.
--
-- thread_place and thread_places_computed are written whole from 0323 and agree for every thread (0180 holds them equal; thread_places_drift reads the computed set and needs no change).
-- The set is small (two threads and one a season), so the computed set reads it once, as a left join.
--
-- The meeting's moveThread (0403's offer and repair, and its landing, all read lasting_move_problem, as every lasting move has since 0320) is refused for a thread of the staff's by that
-- one function: its moveThread branch turned away only a thread whose stored board or origin was the system board, which a thread left behind by a moved flag is not.

create function system_threads() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x from (
    select setting_thread('systemAnnouncements') as x
    union select setting_thread('updatesThread')
    union select s.turns_thread from seasons s
  ) u where x is not null
$$;
revoke execute on function system_threads() from public, anon, authenticated, service_role;

-- thread_place (0323), a thread in system_threads() is on the system board before the origin, the moves and the merges are read. Everything else as 0323 wrote it.
create or replace function thread_place(in_thread uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  here uuid;
  moved uuid;
  hop uuid;
  fallback uuid;
  steps integer := 0;
begin
  -- A thread the instance itself makes is on the system board, whatever its origin, a move or a merge says.
  if in_thread in (select system_threads()) and system_board() is not null then return system_board(); end if;
  select t.origin_board into here from threads t where t.id = in_thread;
  if here is null then return null; end if;
  select safe_uuid(a.payload #>> '{params,board}') into moved
  from acts a
  where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = in_thread::text
    and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
    and exists (select 1 from boards d where d.id = safe_uuid(a.payload #>> '{params,board}')
                and not exists (select 1 from acts x where x.kind = 'move_end' and x.target_act_id = d.created_by_act))
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

-- thread_places_computed (0323), the final select places a thread in system_threads() on the system board. Everything else as 0323 wrote it.
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
    where m.th is not null and exists (select 1 from boards d where d.id = m.bd
                                       and not exists (select 1 from acts x where x.kind = 'move_end' and x.target_act_id = d.created_by_act))
    order by m.th, m.created_at desc, m.seq desc nulls last, m.id desc
  )
  select t.id, case when st.id is not null and sb.id is not null then sb.id else p.cur end
  from threads t left join mt on mt.th = t.id join placed p on p.board = coalesce(mt.bd, t.origin_board)
    left join system_threads() st(id) on st.id = t.id cross join (select system_board() as id) sb
$$;

-- lasting_move_problem (0320), a moveThread naming a thread in system_threads() is refused. Everything else as 0320 wrote it.
create or replace function lasting_move_problem(in_kind text, params jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  th record;
  src uuid;
  dst uuid;
  target uuid;
  fb uuid;
  hop uuid;
  steps integer := 0;
begin
  if in_kind = 'createBoard' then
    if jsonb_typeof(params -> 'name') is distinct from 'string' or btrim(params ->> 'name') = '' then return 'a new board needs a name'; end if;
    if char_length(params ->> 'name') > 200 then return 'a board''s name is at most 200 characters'; end if;
    if jsonb_typeof(params -> 'premise') is distinct from 'string' or btrim(params ->> 'premise') = '' then return 'a new board needs a premise'; end if;
    if jsonb_typeof(params -> 'description') is distinct from 'string' or btrim(params ->> 'description') = '' then return 'a new board needs a description'; end if;
    if params -> 'fallback' is not null and params -> 'fallback' <> 'null'::jsonb then
      fb := safe_uuid(params ->> 'fallback');
      if fb is null or not exists (select 1 from boards b where b.id = fb and not b.is_system and board_is_open(b.id)) then
        return 'a new board''s fallback is an open board of the players';
      end if;
    end if;
  elsif in_kind = 'moveThread' then
    select t.id, t.board, t.origin_board into th from threads t where t.id = safe_uuid(params ->> 'thread');
    if th.id is null then return 'there is no such thread to move'; end if;
    if exists (select 1 from boards b where b.is_system and b.id in (th.board, th.origin_board)) then return 'a thread on The System''s own board is never moved'; end if;
    if th.id in (select system_threads()) then return 'that thread is the staff''s own and stays on their board'; end if;
    target := safe_uuid(params ->> 'board');
    if target is null or not exists (select 1 from boards b where b.id = target) then return 'there is no such board to move the thread to'; end if;
    if exists (select 1 from boards b where b.id = target and b.is_system) then return 'a thread is never moved onto The System''s own board'; end if;
    if not board_is_open(target) then return 'that board is closed, so a thread cannot be moved onto it'; end if;
  elsif in_kind = 'mergeBoard' then
    src := safe_uuid(params ->> 'board');
    dst := safe_uuid(params ->> 'into');
    if src is null or not exists (select 1 from boards b where b.id = src) then return 'there is no such board to merge'; end if;
    if dst is null or not exists (select 1 from boards b where b.id = dst) then return 'there is no such board to merge it into'; end if;
    if src = dst then return 'a board is never merged into itself'; end if;
    if exists (select 1 from boards b where b.is_system and b.id in (src, dst)) then return 'The System''s own board is never merged or merged into'; end if;
    -- A cycle: the board it would merge into is already sent, by merges in force, on to this one.
    hop := dst;
    while hop is not null and steps < 50 loop
      if hop = src then return 'a board is never merged into one that is already merged into it'; end if;
      hop := board_merge_into(hop);
      steps := steps + 1;
    end loop;
    if not board_is_open(src) then return 'that board is already closed'; end if;
    if not board_is_open(dst) then return 'a board is never merged into a closed board'; end if;
  end if;
  return null;
end $$;
