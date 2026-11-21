-- The Turn cooldown is never shorter than a settlement window (issue #931, the owner's decision of 2026-11-21; plan docs/plans/2026-11-21-turn-cooldown-floor-plan.md, Task 2).
--
-- A character never Turns twice within one settlement window: a turnCooldown shorter than settlementLength is refused. A window opens at the last one's
-- close and closes at its opening plus span_interval(settlementLength) (scored_as_window, 0151), and a Turn's next is at its own time plus
-- span_interval(turnCooldown) (0074), so the cooldown covers the window when every moment of a window plus the cooldown is at or past its close:
--   both in months, the counts compare: month addition keeps order (a day past a month's end is clamped to its last day), so t + M months >= o + N months
--     for every t >= o whenever M >= N, and a 1-month cooldown covers a 1-month window;
--   otherwise they compare in days, a week 7, and a month at its shortest (28 days) in the cooldown and its longest (31) in the window.
-- engine/rules/instance.ts (cooldownCoversWindow) is the same; supabase/tests/0399-turn-cooldown-floor.sql holds both sides to the same cases.
--
-- The pair is held once, at the end of the transaction that writes either row (a deferred constraint trigger), never against the other row as it stands
-- mid-write: seed_instance (0397) writes every setting in key order, turnCooldown before settlementLength, so a reseed from one good pair to another
-- (60 days against 45, to 7 against 1) passes through a pair that is refused, and a check on each write would refuse the reseed. settings_held holds each
-- row on its own as before, so a row that is there is a span; a pair with a row missing holds nothing. No instance is deployed, so no row is migrated.

-- Whether a Turn cooldown covers a settlement window, both spans as setting_span holds them. Pure: it reads no row.
create or replace function turn_cooldown_covers(cooldown jsonb, win jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case when cooldown ->> 'unit' = 'month' and win ->> 'unit' = 'month' then (cooldown ->> 'count')::integer >= (win ->> 'count')::integer
    else (cooldown ->> 'count')::integer * case cooldown ->> 'unit' when 'week' then 7 when 'month' then 28 else 1 end
      >= (win ->> 'count')::integer * case win ->> 'unit' when 'week' then 7 when 'month' then 31 else 1 end end
$$;
revoke execute on function turn_cooldown_covers(jsonb, jsonb) from public, anon, authenticated;

-- The pair as it stands when the transaction that wrote one of its rows ends; the refusal names the row written, as settings_held's do.
create or replace function settings_turn_cooldown_floor() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  cooldown jsonb := (select g.value from settings g where g.key = 'turnCooldown');
  win jsonb := (select g.value from settings g where g.key = 'settlementLength');
begin
  if cooldown is null or win is null or turn_cooldown_covers(cooldown, win) then return null; end if;
  raise exception '% is %', new.key, case new.key when 'turnCooldown' then 'a span no shorter than settlementLength' else 'a span no longer than turnCooldown' end
    || ', a month counting 28 days in the cooldown and 31 in the window' using errcode = '23514';
end $$;
revoke execute on function settings_turn_cooldown_floor() from public, anon, authenticated;

create constraint trigger settings_turn_cooldown_floor after insert or update on settings deferrable initially deferred
  for each row when (new.key in ('turnCooldown', 'settlementLength')) execute function settings_turn_cooldown_floor();
