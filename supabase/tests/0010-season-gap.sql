-- A gap between two seasons (supabase/migrations/0003_aura.sql, 0004_schedule.sql): the next
-- window steps over it, and apply_settlement() accepts exactly that gap. In a file of its own,
-- since it ends season 1.

-- ---- A gap between two seasons is stepped over, by the next window and by apply_settlement ----
do $$
declare
  last_end timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  w jsonb;
  said jsonb;
begin
  update seasons set ends_at = last_end where number = 1;
  insert into seasons (number, starts_at) values (2, last_end + interval '3 days');
  if next_settlement_window(last_end + interval '1 day') is not null then raise exception 'nothing to settle inside the gap'; end if;
  w := next_settlement_window(last_end + interval '4 days');
  if (w ->> 'start')::timestamptz <> last_end + interval '3 days' then raise exception 'the window should start at the next season''s start: %', w; end if;
  -- A season begun after a gap falls in step with the run too: its first window ends at the run.
  if (next_settlement_window(last_end + interval '3 days 6 hours') ->> 'end')::timestamptz is distinct from last_end + interval '3 days 6 hours' then
    raise exception 'a season after a gap should end its first window at the run';
  end if;
  set local role service_role;
  said := apply_settlement((w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz, '[]');
  reset role;
  if not (said ->> 'applied')::boolean then raise exception 'the window after the gap should apply: %', said; end if;
end $$;
