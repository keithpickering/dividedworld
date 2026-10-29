-- A pending Turn says when it takes effect (supabase/migrations/0014_next_settlement.sql): the end
-- of the window it was asked in, which the settlement that applies it is; and its player reads it,
-- nobody else. The screens' engine plan, Task 2.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('pend2-ann');
  bob uuid := tests.account('pend2-bob');
  turner uuid := tests.character(ann, 'Promised Turner', 'alpha', now() - interval '60 days');
  last_end timestamptz := (select max(ends_at) from settlements);
  said jsonb;
  promised timestamptz;
  s timestamptz;
  runs integer := 0;
begin
  -- Settled up to an hour ago, so the open window holds now. (An earlier file's committed race may
  -- have settled past now, which holds now too.)
  if last_end is null or last_end < now() - interval '1 hour' then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(coalesce(last_end, (select min(starts_at) from seasons)), now() - interval '1 hour', '[]');
    perform tests.unbecome();
  end if;

  perform tests.become(ann);
  said := turn(turner, 'beta', 'announced');
  promised := (said ->> 'takes_effect_at')::timestamptz;
  if promised is null or promised <= now() then raise exception 'a Turn says when it takes effect, after now: %', said; end if;
  if next_settlement_at() is distinct from promised then raise exception 'next_settlement_at() says what the Turn said: % and %', next_settlement_at(), promised; end if;
  -- Changed, it says the same.
  if (turn(turner, 'beta', 'silent') ->> 'takes_effect_at')::timestamptz is distinct from promised then raise exception 'a changed Turn moved its time'; end if;
  -- Its player reads it; nobody else does.
  if (select class_key from pending_turns where character = turner) is distinct from 'beta' then raise exception 'its player reads their pending Turn'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from pending_turns where character = turner) then raise exception 'another player read a pending Turn'; end if;
  perform tests.unbecome();

  -- The settlements that follow, a window at a time: it takes effect at the one it named.
  while exists (select 1 from pending_turns where character = turner) loop
    runs := runs + 1;
    if runs > 3 then raise exception 'the Turn never took effect'; end if;
    s := (select max(ends_at) from settlements);
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s, s + span_interval(setting('settlementLength')), '[]');
    perform tests.unbecome();
  end loop;
  if (select max(started_at) from class_history where character = turner) is distinct from promised then
    raise exception 'the Turn took effect at %, not at the % it promised', (select max(started_at) from class_history where character = turner), promised;
  end if;
end $$;

-- A Turn asked at `asked`: what next_settlement_at() promised for it, and when the settlements
-- that follow, a window at a time, actually made it take effect.
create function pg_temp.promise_kept(who uuid, name text, asked timestamptz) returns text language plpgsql as $$
declare
  turner uuid := tests.character(who, name, 'alpha', now() - interval '60 days');
  promised timestamptz;
  s timestamptz;
  runs integer := 0;
begin
  perform tests.become(who);
  perform turn(turner, 'beta', 'silent');
  perform tests.unbecome();
  update pending_turns set asked_at = asked where character = turner;
  promised := next_settlement_at(asked);
  while exists (select 1 from pending_turns where character = turner) loop
    runs := runs + 1;
    if runs > 10 then return format('%s never took effect', name); end if;
    s := (select max(ends_at) from settlements);
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s, s + span_interval(setting('settlementLength')), '[]');
    perform tests.unbecome();
  end loop;
  if (select max(started_at) from class_history where character = turner) is distinct from promised then
    return format('%s took effect at %s, not at the %s promised', name, (select max(started_at) from class_history where character = turner), promised);
  end if;
  return null;
end $$;

-- Runs missed, a Turn asked on a window's very end, and a season shortened past what is settled:
-- each promise is the settlement that applies it.
do $$
declare
  ann uuid := tests.account('pend2-kept');
  last_end timestamptz;
  len interval := span_interval(setting('settlementLength'));
  why text;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement((select min(starts_at) from seasons), now() - interval '1 hour', '[]');
    perform tests.unbecome();
  end if;
  -- Three and a half windows past the last settled one, as after missed runs.
  last_end := (select max(ends_at) from settlements);
  why := pg_temp.promise_kept(ann, 'Kept Missed', last_end + 3 * len + len / 2);
  if why is not null then raise exception 'after missed runs: %', why; end if;
  -- Exactly on a window's end: that window is already closed to it.
  last_end := (select max(ends_at) from settlements);
  if next_settlement_at(last_end + 2 * len) is distinct from last_end + 3 * len then raise exception 'a Turn asked on a window''s end is promised %', next_settlement_at(last_end + 2 * len); end if;
  why := pg_temp.promise_kept(ann, 'Kept Boundary', last_end + 2 * len);
  if why is not null then raise exception 'on a window''s end: %', why; end if;
  -- The season's length shortened past what is settled: the next window is whole, and ends it.
  last_end := (select max(ends_at) from settlements);
  update settings set value = '{"unit": "day", "count": 1}' where key = 'seasonLength';
  if (select starts_at + interval '1 day' from seasons where ends_at is null) >= last_end then raise exception 'this case needs a season longer than a day settled'; end if;
  if next_settlement_at(last_end + len / 2) is distinct from last_end + len then raise exception 'a shortened season''s next window is promised %', next_settlement_at(last_end + len / 2); end if;
  why := pg_temp.promise_kept(ann, 'Kept Shortened', last_end + len / 2);
  if why is not null then raise exception 'in a shortened season: %', why; end if;
end $$;

-- Where the next window is a season's first, its end is the first run's, which the cron decides:
-- unknown, and said as unknown (null), never guessed. Past a season's end, the same.
do $$
declare
  last_end timestamptz;
  ann uuid := tests.account('pend2-first');
  turner uuid := tests.character(ann, 'First Window Turner', 'alpha', now() - interval '60 days');
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement((select min(starts_at) from seasons), now() - interval '1 hour', '[]');
    perform tests.unbecome();
  end if;
  -- Inside a season: past its first window, which a block above may have just opened.
  update settings set value = '{"unit": "month", "count": 1000}' where key = 'seasonLength';
  if (select starts_at from seasons where ends_at is null) = (select max(ends_at) from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement((select max(ends_at) from settlements), (select max(ends_at) from settlements) + span_interval(setting('settlementLength')), '[]');
    perform tests.unbecome();
  end if;
  last_end := (select max(ends_at) from settlements);
  if next_settlement_at(last_end) is null then raise exception 'a window inside a season has a known end'; end if;
  -- The open season's length run out before the instant asked about.
  if next_settlement_at(last_end + interval '2000 months') is not null then raise exception 'a time past the season''s end was guessed'; end if;
  -- A season that begins where the last window ended: its first window ends at the first run.
  update seasons set ends_at = last_end where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), last_end);
  if next_settlement_at(last_end) is not null then raise exception 'a season''s first window guessed its end: %', next_settlement_at(last_end); end if;
  perform tests.become(ann);
  if (turn(turner, 'beta', 'silent') -> 'takes_effect_at') is distinct from 'null'::jsonb then raise exception 'a Turn in a season''s first window guessed its time'; end if;
  perform tests.unbecome();
end $$;
