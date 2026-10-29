-- The live estimate's window (supabase/migrations/0017_estimate.sql) is the one the next
-- settlement reads (next_settlement_window, 0004): from the last settled end, or the next season's
-- start where a gap between seasons holds that instant, and never past its season's end. The
-- screens' engine plan, Task 5.

do $$
declare
  ann uuid := tests.account('estw-ann');
  s timestamptz;
  w jsonb;
  ms constant numeric := 1000;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement((select min(starts_at) from seasons), (select min(starts_at) from seasons) + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  s := (select max(ends_at) from settlements);
  w := estimate_input(ann, s + interval '6 hours') -> 'window';
  if (w ->> 'from')::numeric is distinct from extract(epoch from s) * ms or (w ->> 'to')::numeric is distinct from extract(epoch from s + interval '6 hours') * ms then
    raise exception 'inside a season, the window runs from the last settled end to now: %', w;
  end if;
  -- A gap: the season ended where the last window did, and the next begins two days on.
  update seasons set ends_at = s where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), s + interval '2 days');
  if estimate_input(ann, s + interval '1 day') is not null then raise exception 'inside a gap there is no window to estimate'; end if;
  w := estimate_input(ann, s + interval '2 days 6 hours') -> 'window';
  if (w ->> 'from')::numeric is distinct from extract(epoch from s + interval '2 days') * ms then raise exception 'after a gap the window begins at the next season''s start: %', w; end if;
  -- The season's length runs out a day in: the window stops there.
  update settings set value = '{"unit": "day", "count": 1}' where key = 'seasonLength';
  w := estimate_input(ann, s + interval '5 days') -> 'window';
  if (w ->> 'to')::numeric is distinct from extract(epoch from s + interval '3 days') * ms then raise exception 'the window never runs past its season''s end: %', w; end if;
end $$;

-- An estimate kept is given again inside its hold, never after it, and never to another account.
do $$
declare
  ann uuid := tests.account('estk-ann');
  bob uuid := tests.account('estk-bob');
begin
  perform tests.become_service();
  perform estimate_keep(ann, '{"entries": [], "lines": [{"amount": 10}]}');
  if estimate_kept(ann, 30) is distinct from '{"entries": [], "lines": [{"amount": 10}]}'::jsonb then raise exception 'a kept estimate is given again inside its hold'; end if;
  if estimate_kept(bob, 30) is not null then raise exception 'another account was given a kept estimate'; end if;
  perform tests.unbecome();
  update estimates set made_at = clock_timestamp() - interval '31 seconds' where account = ann;
  perform tests.become_service();
  if estimate_kept(ann, 30) is not null then raise exception 'a kept estimate past its hold was given again'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  begin
    perform 1 from estimates;
    raise exception 'a player read the kept estimates';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;
