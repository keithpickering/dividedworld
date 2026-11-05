-- Gabe's to-do (the staff roster design, section 11; its plan, Task 11).
--
-- A handover that changes the Boss leaves a to-do in the admin queue: "Season N opens with a new Boss. Write the announcement." The
-- announcement is an admin's to write, on the Updates page; no model writes or drafts any of it. The to-do carries the handover's plain facts
-- (the new Boss and the office it held before, the outgoing Boss and the office it holds now, how the Boss was chosen, when it landed) so the
-- form can be filled in.
--
-- Ways out: the to-do clears by itself when an update is posted after the handover landed (computed, never written, so nothing can stay
-- cleared that should not), or when an admin dismisses it. A dismissal is a row in `handover_dismissals`, written once and never edited,
-- one per season; dismissing twice is answered and writes nothing more. No client reads the table: admin_queue and dismiss_handover_todo,
-- both an admin's alone, are its doors.

create table handover_dismissals (
  season bigint primary key references season_handovers (season),
  admin uuid not null,
  at timestamptz not null default now()
);
alter table handover_dismissals enable row level security;
revoke all on handover_dismissals from public, anon, authenticated;

create function handover_dismissals_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a dismissal is never edited or removed (%); it is written once', tg_op using errcode = 'P0001';
end $$;
create trigger handover_dismissals_no_update before update or delete on handover_dismissals for each row execute function handover_dismissals_append_only();
create trigger handover_dismissals_no_truncate before truncate on handover_dismissals for each statement execute function handover_dismissals_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table handover_dismissals enable always trigger handover_dismissals_no_update;
alter table handover_dismissals enable always trigger handover_dismissals_no_truncate;
revoke execute on function handover_dismissals_append_only() from public, anon, authenticated;

-- An admin puts a to-do away without an update. The season is named by its number, as the page names it. A season whose handover did not
-- change the Boss has no to-do and is refused in words; a to-do already dismissed is answered and writes nothing.
create function dismiss_handover_todo(season_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid bigint;
begin
  perform only_admins('dismisses a to-do');
  select c.season into sid from season_boss_changes c where c.number = season_number;
  if sid is null then
    raise exception 'there is no to-do for season %: its handover did not change the Boss', season_number using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into handover_dismissals (season, admin) values (sid, auth.uid()) on conflict (season) do nothing;
  return jsonb_build_object('season', season_number);
end $$;
revoke execute on function dismiss_handover_todo(integer) from public, anon;
grant execute on function dismiss_handover_todo(integer) to authenticated;

-- admin_queue (0053), gaining `todos`. Everything else as 0053 wrote it; the owner and grants are kept.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
  todos jsonb;
  latest_update timestamptz;
begin
  perform only_admins('reads the queue');

  -- The Bosses that can take a nomination's seat, by the roster's own rule and order (boss_roster): not retired, debuted.
  select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name) order by r.ord), '[]'::jsonb) into roster
  from unnest(boss_roster()) with ordinality r(staff, ord) join characters c on c.staff = r.staff;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure, 'replacedAt', q.replaced_at,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', case when o.progress is null then jsonb_build_object('checkedAt', null)
                              else o.progress || jsonb_build_object('checkedAt', o.checked_at) end) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name,
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name,
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  -- The to-dos (the staff roster design, section 11): each handover that changed the Boss, until an update is posted after it landed or an
  -- admin dismisses it. "An update after it" is one read of the newest update (the acts_updates index, 0062) against each handover's instant.
  latest_update := (select a.created_at from acts a where a.kind = 'update' order by a.created_at desc, a.id desc limit 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'season', t.number, 'boss', t.boss, 'bossName', bc.name,
           'bossWas', (select o.office from staff_offices o where o.staff = t.boss and o.at <= t.landed_at order by o.id desc limit 1),
           'outgoing', t.outgoing, 'outgoingName', oc.name, 'outgoingOffice', (select n.office from staff_office_now n where n.staff = t.outgoing),
           'how', h.how, 'landedAt', t.landed_at) order by t.landed_at desc, t.number desc), '[]'::jsonb) into todos
  from season_boss_changes t
  join season_handovers h on h.season = t.season
  join characters bc on bc.staff = t.boss
  left join characters oc on oc.staff = t.outgoing
  where (latest_update is null or latest_update <= t.landed_at)
    and not exists (select 1 from handover_dismissals d where d.season = t.season);

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'ended', ended, 'roster', roster, 'todos', todos,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'ended', ended_more));
end $$;
