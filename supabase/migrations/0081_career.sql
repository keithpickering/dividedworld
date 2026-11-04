-- A persona's career (the staff roster design, section 3; its plan, Task 3).
--
-- A career is a fact, computed and never written: the seasons a persona led and the offices it held off the Boss's seat.
--   led      one entry per season whose Boss it was (`seasons.boss`): the season's number, when it began, when it ended (null while it is
--            open), and how the Boss was chosen (`season_handovers.how`; `seed` for a season that began with no handover, the first).
--   offices  one entry per row of its office log (`staff_offices`): the office, when it began, when the next row ended it (null for the
--            latest), and what caused it. The Boss's seat is never a row (0080), so it is in `led` and not here.
-- Oldest first; the readers sort and cut. All of it is public: the seasons are public, the log's rows are about staff characters, who
-- have no owner, and the admin who made a change is left out. A key that is no persona, or a persona that never served, has an empty career.
-- The function is the only road to the log, which no client reads: it is a security definer, with its search_path pinned.
--
-- It is also the digest role's to execute (0045): it reads staff, seasons and the log, nothing about a player.

create function staff_career(of_staff text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'led', coalesce((
      select jsonb_agg(jsonb_build_object('season', s.number, 'from', s.starts_at, 'until', s.ends_at, 'how', coalesce(h.how, 'seed')) order by s.number)
      from seasons s left join season_handovers h on h.season = s.id
      where s.boss = of_staff and exists (select 1 from characters c where c.staff = of_staff and c.staff_kind = 'persona')
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object('office', o.office, 'from', o.at, 'until', o.until, 'cause', o.cause) order by o.id)
      from (select r.id, r.office, r.at, r.cause, lead(r.at) over (order by r.id) as until from staff_offices r where r.staff = of_staff) o
    ), '[]'::jsonb))
$$;
revoke execute on function staff_career(text) from public;
grant execute on function staff_career(text) to anon, authenticated, kayfabb_digest;
