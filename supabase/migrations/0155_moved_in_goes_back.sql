-- Threads moved into a reversed board go back (design section 4: a reversed createBoard sends threads moved in "back to where they were").
--
-- A moveThread whose target is a created board whose createBoard has ended (any end, as 0151's one rule for a closed made board) no longer counts in a thread's place, as a move onto a
-- board that is not there never did. The thread then takes its earlier move's board (a superseded move counts, 0153) or its origin. Only a thread STARTED in the board goes to its
-- fallback, or to the first open non-system board. A moveThread onto a board later merged still follows the merge, which carries its threads. thread_place and thread_places_computed
-- are redefined from 0153 and agree (0156 and 0158 hold them equal). end_move's rebuild set already covers these threads: threads_touching_board reads every moveThread Act that names
-- the ended board, and those stored on it.

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
  select t.id, p.cur from threads t left join mt on mt.th = t.id join placed p on p.board = coalesce(mt.bd, t.origin_board)
$$;

-- moves_log (0154), the latest end told by its seq in the move's thread before its id: the two ends of a move can be written in one transaction, with one created_at.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         move_expires_at(a.id) as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join lateral (select x.* from acts x where x.kind = 'move_end' and x.target_act_id = a.id order by x.created_at desc, x.seq desc nulls last, x.id desc limit 1) e on true
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         e.payload ->> 'outcome', null::text, e.created_at, null::text, null::timestamptz
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta')
           || case when pu.kind = 'move' then jsonb_build_object('group', pu.payload #>> '{params,group}', 'until', u.payload ->> 'until') else '{}'::jsonb end,
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null;
