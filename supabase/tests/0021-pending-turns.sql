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

  -- The settlements that follow, a day at a time: it takes effect at the one it named.
  while exists (select 1 from pending_turns where character = turner) loop
    runs := runs + 1;
    if runs > 3 then raise exception 'the Turn never took effect'; end if;
    s := (select max(ends_at) from settlements);
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s, s + interval '1 day', '[]');
    perform tests.unbecome();
  end loop;
  if (select max(started_at) from class_history where character = turner) is distinct from promised then
    raise exception 'the Turn took effect at %, not at the % it promised', (select max(started_at) from class_history where character = turner), promised;
  end if;
end $$;
