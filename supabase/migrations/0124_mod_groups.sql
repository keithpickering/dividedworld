-- A Mod's one move may confer a group (docs/plans/2026-11-06-member-groups-plan.md, Task 13).
--   apply_mod_move     (0106) also queues the move's `demand`. A rule has none; a group punishment that bars a board carries `apologyAccepted`, which the guard (0117) requires of it and
--                      which a Mod's move had no way to carry. Everything else as 0106 wrote it: the guard still decides the office, the beat, the allowance, the favor and the cap.
--   mod_group_context  what the staff function tells a Mod's call about groups: the conferred catalog {key, name, tone} and the characters no group move may name now, capped or
--                      held, as meeting_context (0119) lists them for the Boss. Public data only (a character's name and id, never who plays it); the service role reads it.
-- Masks. Neither reads an owner, a class or a reactor. Ways out. Adds no state: a group move ends as 0117 wrote.

create or replace function apply_mod_move(staff text, move jsonb, cause_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text;
  params jsonb;
  hours numeric;
  most numeric := coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * 24;
  least numeric := coalesce((select (s.value #>> '{}')::numeric from settings s where s.key = 'moveExpiryLeastHours'), 24);
  why text;
  ord staff_orders%rowtype;
  existing bigint;
  made bigint;
  trimmed jsonb := '{}'::jsonb;
  lives timestamptz := now();
  demand jsonb;
begin
  if apply_mod_move.cause_act is null or not exists (select 1 from acts a where a.id = apply_mod_move.cause_act) then
    raise exception 'a Mod''s move names the Act that drew it' using errcode = '22023';
  end if;
  -- The Mod's own lock, the one the queue guard takes for the allowance: the check for an earlier move of this cause and the insert are one decision.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || apply_mod_move.staff, 0));
  select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
  if found then return jsonb_build_object('move', existing, 'queued', false, 'existing', true); end if;

  if jsonb_typeof(move) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move is no object'); end if;
  kind := move ->> 'kind';
  params := move -> 'params';
  if kind is null or jsonb_typeof(params) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move names its kind and its params'); end if;
  -- The demand is an object or none; the guard says whether this kind may carry this one.
  demand := case when jsonb_typeof(move -> 'demand') = 'object' then move -> 'demand' end;
  why := left(btrim(regexp_replace(coalesce(move ->> 'why', ''), '\s+', ' ', 'g')), 200);
  if why = '' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says why'); end if;
  if jsonb_typeof(move -> 'expires_in_hours') is distinct from 'number' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says how many hours it lasts'); end if;
  hours := round((move ->> 'expires_in_hours')::numeric);
  if hours > most then
    trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', most));
    hours := most;
  elsif hours < least then
    trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', least));
    hours := least;
  end if;
  -- A move does not ride on a filing that never happened: a visit ended any way but filed (talked down, trapped, reversed) draws no move.
  if exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = apply_mod_move.cause_act and e.payload ->> 'outcome' is distinct from 'filed') then
    return jsonb_build_object('move', null, 'queued', false, 'reason', 'that visit ended and was never filed, so it draws no move');
  end if;
  select * into ord from staff_orders o where o.staff = apply_mod_move.staff order by o.id desc limit 1;
  if not found then return jsonb_build_object('move', null, 'queued', false, 'reason', apply_mod_move.staff || ' has had no order from the Boss'); end if;

  begin
    -- The guard decides: the office, the beat, the allowance, the cap and the rule itself. It stamps the order the move spends against.
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, cause_act)
    values (ord.meeting, apply_mod_move.staff, kind, params, demand, why, lives, lives + make_interval(hours => hours::integer),
            coalesce((select k.structural from move_kinds k where k.key = kind), false), apply_mod_move.cause_act)
    returning id into made;
  exception
    when unique_violation then
      select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
      return jsonb_build_object('move', existing, 'queued', false, 'existing', true);
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or data_exception then
      -- The guard's refusals and a malformed move (a cast, a null, a wrong type) are refusals: the filing it rode in on is not left open to pay for the call again. Anything
      -- else (a lock timeout, a deadlock, a failing trigger, a resource error) is not a verdict on the move, and raises: the visit stays open and the next run tries again.
      return jsonb_build_object('move', null, 'queued', false, 'reason', case when sqlstate in ('23514', '23502') then sqlerrm else 'the move is malformed' end);
  end;
  return jsonb_build_object('move', made, 'queued', true, 'existing', false) || case when trimmed = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('trimmed', trimmed) end;
end $$;

create function mod_group_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'conferred', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'tone', g.tone) order by g.tone desc, g.key) from group_kinds g where g.source = 'conferred'), '[]'),
    -- The same two kinds meeting_context (0119) lists, by the same reads: only held and capped characters, a handful at a busy instance's scale, never every character.
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'capped', x.capped, 'held', x.held) order by x.id)
      from (select k.id, k.held, k.capped from (
          select c.id, h.id is not null as held,
            staff_punishments(c.id, cap.days) >= cap.punishments as capped
          from characters_public c
          left join (select distinct lower(a.payload #>> '{params,character}')::uuid as id from open_moves o join acts a on a.id = o.move_act
                      where a.payload ->> 'kind' = 'conferGroup'
                     union
                     select distinct lower(q.params ->> 'character')::uuid from queued_moves q
                      where q.kind = 'conferGroup' and q.landed_act is null and q.held_at is null and q.refused_at is null) h on h.id = c.id
          cross join (select (mod_cap() ->> 'punishments')::integer as punishments, (mod_cap() ->> 'days')::integer as days) cap
          where c.staff is null
            and (h.id is not null
                 or c.id in (select (i.payload ->> 'character')::uuid from acts i
                             where i.kind = 'infraction' and i.created_at >= clock_timestamp() - make_interval(days => cap.days))
                 or c.id in (select p.character from visits_open o join acts p on p.id = o.post)
                 or c.id in (select (m.payload #>> '{params,character}')::uuid from acts m
                             where m.kind = 'move' and m.payload ->> 'kind' = 'conferGroup' and m.created_at >= clock_timestamp() - make_interval(days => cap.days)))
        ) k where k.held or k.capped) x), '[]'))
$$;

revoke execute on function mod_group_context() from public, anon, authenticated;
grant execute on function mod_group_context() to service_role;
