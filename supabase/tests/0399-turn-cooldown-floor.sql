-- The Turn cooldown is never shorter than a settlement window (supabase/migrations/0399_turn_cooldown_floor.sql; issue #931; plan
-- docs/plans/2026-11-21-turn-cooldown-floor-plan.md, Task 2). The deferred constraint trigger settings_turn_cooldown_floor holds the pair as it
-- stands once its transaction ends: both in months, the counts compare; otherwise days, a week 7, a month 28 in the cooldown and 31 in the window.
-- engine/rules/instance.ts (cooldownCoversWindow) holds the same cases.
--  1. Deferred, as a seed and an admin's transaction meet it: a pair that is refused only on the way is taken, and a pair refused at the end is refused.
--  2. Each write alone (the check made immediate, so it fires at the end of each statement): its refusal in its sentence, each case from both sides.

create function pg_temp.say(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Writes the pair, the window first when it is no longer than the stored cooldown and the cooldown first otherwise, so a good pair is never refused on the way.
create function pg_temp.pair(cooldown text, win text) returns void language plpgsql as $$
begin
  update settings set value = '{"unit": "month", "count": 1000}' where key = 'turnCooldown';
  update settings set value = win::jsonb where key = 'settlementLength';
  update settings set value = cooldown::jsonb where key = 'turnCooldown';
end $$;

-- 1. Deferred, first, so the check is as the trigger is made (initially deferred) and nothing here has set it: the pair is held once, at the transaction's end, so a seed
-- (which writes turnCooldown before settlementLength) may pass through a refused pair.

do $$
declare
  got text;
begin
  -- A good pair stored before it, cooldown first so no write on the way is refused: 60 days against 45.
  update settings set value = '{"unit": "day", "count": 60}' where key = 'turnCooldown';
  update settings set value = '{"unit": "day", "count": 45}' where key = 'settlementLength';
  -- A reseed to 7 days against 1 day: the cooldown lands first, under the stored 45-day window, then the window.
  got := pg_temp.say('update settings set value = ''{"unit": "day", "count": 7}'' where key = ''turnCooldown''');
  if got is not null then raise exception 'a reseed was refused on the way, at the cooldown: %', got; end if;
  update settings set value = '{"unit": "day", "count": 1}' where key = 'settlementLength';
  got := pg_temp.say('set constraints settings_turn_cooldown_floor immediate');
  if got is not null then raise exception 'a reseed to a good pair was refused on the way: %', got; end if;
  execute 'set constraints settings_turn_cooldown_floor deferred';
  -- A pair still refused at the end is refused when the check fires.
  update settings set value = '{"unit": "week", "count": 2}' where key = 'settlementLength';
  got := pg_temp.say('set constraints settings_turn_cooldown_floor immediate');
  if got is distinct from '23514: settlementLength is a span no longer than turnCooldown, a month counting 28 days in the cooldown and 31 in the window' then
    raise exception 'a bad pair at the end was taken: %', got;
  end if;
  -- The refused write stays in this transaction (only the check's own statement rolled back), so the pair is put back before section 2.
  update settings set value = '{"unit": "day", "count": 1}' where key = 'settlementLength';
  update settings set value = '{"unit": "day", "count": 30}' where key = 'turnCooldown';
end $$;

-- 2. Each write alone: the check made immediate, so it fires at the end of each statement.
set constraints settings_turn_cooldown_floor immediate;

do $$
declare
  got text;
  c record;
begin
  -- The fixtures' pair is held.
  if (select value from settings where key = 'turnCooldown') is distinct from '{"unit": "day", "count": 30}'::jsonb then raise exception 'the fixtures moved'; end if;

  -- A cooldown written shorter than the stored window is refused, in its sentence.
  update settings set value = '{"unit": "week", "count": 1}' where key = 'settlementLength';
  got := pg_temp.say('update settings set value = ''{"unit": "day", "count": 6}'' where key = ''turnCooldown''');
  if got is distinct from '23514: turnCooldown is a span no shorter than settlementLength, a month counting 28 days in the cooldown and 31 in the window' then
    raise exception 'six days against a week: %', got;
  end if;
  -- A window written longer than the stored cooldown is refused, in its sentence.
  update settings set value = '{"unit": "day", "count": 6}' where key = 'settlementLength';
  update settings set value = '{"unit": "day", "count": 6}' where key = 'turnCooldown';
  got := pg_temp.say('update settings set value = ''{"unit": "week", "count": 1}'' where key = ''settlementLength''');
  if got is distinct from '23514: settlementLength is a span no longer than turnCooldown, a month counting 28 days in the cooldown and 31 in the window' then
    raise exception 'a week against six days: %', got;
  end if;

  -- The cases of instance.test.ts, from each side: refused pairs refuse both writes, good pairs take both.
  for c in select * from (values
    ('{"unit": "day", "count": 30}', '{"unit": "month", "count": 1}', false),
    ('{"unit": "month", "count": 1}', '{"unit": "month", "count": 2}', false),
    ('{"unit": "month", "count": 1}', '{"unit": "day", "count": 29}', false),
    ('{"unit": "month", "count": 1}', '{"unit": "day", "count": 30}', false),
    ('{"unit": "day", "count": 31}', '{"unit": "month", "count": 1}', true),
    ('{"unit": "month", "count": 1}', '{"unit": "week", "count": 4}', true),
    ('{"unit": "month", "count": 1}', '{"unit": "month", "count": 1}', true),
    ('{"unit": "week", "count": 1}', '{"unit": "day", "count": 7}', true),
    ('{"unit": "day", "count": 30}', '{"unit": "day", "count": 1}', true)
  ) v(cooldown, win, good) loop
    -- The cooldown side: the window stands, the cooldown is written.
    perform pg_temp.pair('{"unit": "month", "count": 1000}', c.win);
    got := pg_temp.say(format('update settings set value = %L where key = ''turnCooldown''', c.cooldown));
    if c.good and got is not null then raise exception 'cooldown % against window % was refused: %', c.cooldown, c.win, got; end if;
    if not c.good and (got is null or got not like '23514: turnCooldown is a span no shorter than settlementLength%') then raise exception 'cooldown % against window % was taken: %', c.cooldown, c.win, got; end if;
    -- The window side: the cooldown stands, the window is written.
    update settings set value = '{"unit": "day", "count": 1}' where key = 'settlementLength';
    update settings set value = c.cooldown::jsonb where key = 'turnCooldown';
    got := pg_temp.say(format('update settings set value = %L where key = ''settlementLength''', c.win));
    if c.good and got is not null then raise exception 'window % against cooldown % was refused: %', c.win, c.cooldown, got; end if;
    if not c.good and (got is null or got not like '23514: settlementLength is a span no longer than turnCooldown%') then raise exception 'window % against cooldown % was taken: %', c.win, c.cooldown, got; end if;
  end loop;

  -- A pair with a row missing holds nothing: a window written against a cooldown missing its row is taken (settings_held holds each row that is there).
  delete from settings where key = 'turnCooldown';
  got := pg_temp.say('update settings set value = ''{"unit": "month", "count": 12}'' where key = ''settlementLength''');
  if got is not null then raise exception 'a window against no cooldown was refused: %', got; end if;
  -- And a cooldown written against a window missing its row.
  delete from settings where key = 'settlementLength';
  insert into settings (key, value) values ('turnCooldown', '{"unit": "day", "count": 30}');
  got := pg_temp.say('update settings set value = ''{"unit": "day", "count": 1}'' where key = ''turnCooldown''');
  if got is not null then raise exception 'a cooldown against no window was refused: %', got; end if;

  -- The helper is the trigger's alone: no API role runs it.
  if has_function_privilege('anon', 'turn_cooldown_covers(jsonb, jsonb)', 'execute') or has_function_privilege('authenticated', 'turn_cooldown_covers(jsonb, jsonb)', 'execute') then
    raise exception 'an API role may run turn_cooldown_covers';
  end if;
end $$;

