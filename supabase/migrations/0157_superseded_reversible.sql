-- A superseded move can still be reversed (plan Task 2: "reversing the first returns it to its origin").
--
-- A move had one end (acts_one_move_end). A lasting move superseded by a later one then could not be reversed by an admin, which left no way to undo it. Now a move has at most one
-- superseded end and at most one other end (the unique index is on the target and whether the end is a supersession), and end_move takes a second end only for a lasting move
-- already ended as superseded, and only as reversed or overturned. It is a new move_end Act; nothing is updated.
--
-- Readers of a move's ends, checked: open_moves (acts_track_moves deletes by target on any end, so a second end deletes nothing; rebuild_open_moves reads "has any end"), thread_place and
-- thread_places_computed (0156: reversed or overturned takes a move out of the reckoning, superseded does not), board_is_open and the closed-board reads (a createBoard is never
-- superseded, so it has one end), moves_log (below: one row per move, with its latest end, so a move with two ends is one row that reads its final state), my_group_moves (conferGroup only,
-- never lasting, so one end), and the windowed readers (digest, admin queue log, pool signals), which list each end as its own event with its own why and time, and so show the
-- supersession and the reversal as two true events.

drop index acts_one_move_end;
create unique index acts_one_move_end on acts (target_act_id, ((payload ->> 'why') = 'superseded')) where kind = 'move_end';

-- end_move (0155), a lasting move superseded taking one later end. Everything else as 0155 wrote it.
create or replace function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
  lasting boolean;
  first_before uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed', 'superseded', 'spent', 'unmet', 'overturned') then raise exception 'a move ends as met, expired, reversed, superseded, spent, unmet or overturned, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  lasting := coalesce((select k.lasting from move_kinds k where k.key = m.payload ->> 'kind'), false);
  -- A move has one end of each class: superseded, and any other. A lasting move ended as superseded may take one later end, reversed or overturned, so an admin can undo
  -- any lasting move after it lands (a new move_end Act beside the first, never an update). Any other second end is refused, as before.
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act and ((e.payload ->> 'why' = 'superseded') = (why = 'superseded')) limit 1;
  if existing is null and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = move_act)
     and not (lasting and why in ('reversed', 'overturned')
              and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = move_act and e.payload ->> 'why' <> 'superseded')) then
    select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act limit 1;
  end if;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  if lasting then first_before := first_open_board(); end if;
  -- A tick that read the old expiry before a ruling moved it is too late: the ruling is a fact of the lock's holder, read here under the lock.
  if why = 'expired' and exists (select 1 from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                                 where a.kind = 'appeal' and a.target_act_id = move_act and (r.payload ->> 'until')::timestamptz > now()) then
    return jsonb_build_object('act', null, 'ended', false, 'extended', true);
  end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by)) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  if lasting then perform lasting_rebuild(move_act, first_before); end if;
  return jsonb_build_object('act', written, 'ended', true);
end $$;

-- moves_log (0135), a move read with its latest end, so a move with two ends is one row. Columns and every other row as 0135 wrote them.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         move_expires_at(a.id) as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join lateral (select x.* from acts x where x.kind = 'move_end' and x.target_act_id = a.id order by x.created_at desc, x.id desc limit 1) e on true
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

