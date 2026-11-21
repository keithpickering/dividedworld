-- The Turn cooldown is never shorter than a settlement window (supabase/migrations/0399_turn_cooldown_floor.sql; issue #931; plan
-- docs/plans/2026-11-21-turn-cooldown-floor-plan.md, Task 2). settings_held holds whichever of turnCooldown and settlementLength is written
-- against the other as it stands: both in months, the counts compare; otherwise days, a week 7, a month 28 in the cooldown and 31 in the window.
-- engine/rules/instance.ts (cooldownCoversWindow) holds the same cases.

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
    if not c.good and got not like '23514: turnCooldown is a span no shorter than settlementLength%' then raise exception 'cooldown % against window % was taken: %', c.cooldown, c.win, got; end if;
    -- The window side: the cooldown stands, the window is written.
    update settings set value = '{"unit": "day", "count": 1}' where key = 'settlementLength';
    update settings set value = c.cooldown::jsonb where key = 'turnCooldown';
    got := pg_temp.say(format('update settings set value = %L where key = ''settlementLength''', c.win));
    if c.good and got is not null then raise exception 'window % against cooldown % was refused: %', c.win, c.cooldown, got; end if;
    if not c.good and got not like '23514: settlementLength is a span no longer than turnCooldown%' then raise exception 'window % against cooldown % was taken: %', c.win, c.cooldown, got; end if;
  end loop;

  -- A stored row that is not a span is its own refusal, never this one: a window written against a cooldown missing its row is taken.
  delete from settings where key = 'turnCooldown';
  got := pg_temp.say('update settings set value = ''{"unit": "month", "count": 12}'' where key = ''settlementLength''');
  if got is not null then raise exception 'a window against no cooldown was refused: %', got; end if;
end $$;
