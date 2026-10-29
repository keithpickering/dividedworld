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

-- An estimate kept is given again inside its hold, never after it, never to another account, and
-- never once a settlement has been applied since it was made; each answer says when it was made
-- and when to ask again.
do $$
declare
  ann uuid := tests.account('estk-ann');
  bob uuid := tests.account('estk-bob');
  given jsonb;
begin
  perform tests.become_service();
  given := estimate_keep(ann, '{"entries": [], "lines": [{"amount": 10}]}', 30, '3000-01-01');
  if given - 'asOf' - 'freshAfter' is distinct from '{"entries": [], "lines": [{"amount": 10}]}'::jsonb
     or (given ->> 'freshAfter')::timestamptz is distinct from (given ->> 'asOf')::timestamptz + interval '30 seconds'
     or (given ->> 'asOf')::timestamptz is distinct from (select made_at from estimates where account = ann) then
    raise exception 'an answer says when it was made and when to ask again: %', given;
  end if;
  if estimate_kept(ann, 30) is distinct from given then raise exception 'a kept estimate is given again inside its hold, as it was given'; end if;
  if estimate_kept(bob, 30) is not null then raise exception 'another account was given a kept estimate'; end if;
  perform tests.unbecome();
  -- A settlement of an earlier window leaves it be.
  insert into settlements (starts_at, ends_at, season, applied_at) values ('2999-01-01', '2999-01-02', (select min(id) from seasons), clock_timestamp());
  perform tests.become_service();
  if estimate_kept(ann, 30) is distinct from given then raise exception 'a settlement of an earlier window took a kept estimate'; end if;
  perform tests.unbecome();
  -- A settlement of the kept answer's window ends it, even one whose transaction began before the
  -- answer was kept and committed after it.
  insert into settlements (starts_at, ends_at, season, applied_at) values ('3000-01-01', '3000-01-02', (select min(id) from seasons), clock_timestamp() - interval '1 second');
  perform tests.become_service();
  if estimate_kept(ann, 30) is not null then raise exception 'a kept estimate read before a settlement of its window committed was given again after it'; end if;
  perform tests.unbecome();
  delete from settlements where starts_at in ('2999-01-01', '3000-01-01');
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

-- A window opened between milliseconds: estimate_input answers its start exactly (windowStart),
-- the estimate function keeps the answer with it unchanged (estimate/core.ts), and the settlement
-- that opened the window never counts as one of it. A start carried as whole milliseconds would
-- fall short of a settlement ending 0.3 ms past one, and no answer would ever be kept.
do $$
declare
  ann uuid := tests.account('estk-micro');
  -- In the open season, past whatever the earlier blocks and files settled.
  s timestamptz := greatest((select max(ends_at) from settlements), (select starts_at from seasons where ends_at is null));
  opened timestamptz := date_trunc('second', s) + interval '1 hour 0.0003 seconds';
  input jsonb;
  given jsonb;
begin
  insert into settlements (starts_at, ends_at, season) select s, opened, id from seasons where ends_at is null;
  input := estimate_input(ann, opened + interval '1 minute');
  if (input ->> 'windowStart')::timestamptz is distinct from opened then raise exception 'estimate_input answers its window''s start exactly: % against %', input ->> 'windowStart', opened; end if;
  perform tests.become_service();
  given := estimate_keep(ann, '{"entries": [], "lines": []}', 30, (input ->> 'windowStart')::timestamptz);
  if estimate_kept(ann, 30) is distinct from given then raise exception 'a kept estimate is given again in a window opened between milliseconds'; end if;
  perform tests.unbecome();
end $$;

-- The System's own Acts are read as The System's and no further: a caller who reacted to the
-- night's tally and spun from it is not handed every other reaction on it, nor a key for each of
-- its reactors, since the settlement pays nobody for them. The tally is still named, so a spin
-- from it is read as from The System.
do $$
declare
  w timestamptz := greatest((select max(ends_at) from settlements), (select starts_at from seasons where ends_at is null));
  ann uuid := tests.account('estk-sys-ann');
  a uuid := tests.character(ann, 'Estk Sys Ann', 'alpha', w - interval '10 days');
  t uuid;
  spun uuid;
  tally uuid;
  other uuid;
  input jsonb;
begin
  insert into threads (board, title) values (system_board(), 'Tallied') returning id into t;
  insert into acts (character, kind, thread, payload, created_at) values (null, 'tally', t, '{}', w + interval '1 minute') returning id into tally;
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (tally, a, ann, 'up', 1, w + interval '2 minutes');
  for i in 1..5 loop
    other := tests.account('estk-sys-' || i);
    insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at)
    values (tally, tests.character(other, 'Estk Sys ' || i, 'alpha', w - interval '10 days'), other, 'up', 1, w + interval '3 minutes');
  end loop;
  insert into threads (board, title, origin_act_id) values (players_board(), 'Spun from the tally', tally) returning id into spun;
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (a, 'spin', spun, tally, '{"title": "Spun from the tally", "body": ""}', w + interval '4 minutes');
  input := estimate_input(ann, w + interval '1 hour');
  if input is null then raise exception 'the open window is estimated'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'reactions') r where r ->> 'act' = tally::text) then
    raise exception 'the reactions to The System''s own Act were read for the estimate: %', input -> 'reactions';
  end if;
  if jsonb_array_length(input -> 'characters') <> 1 then raise exception 'a key was made for each reactor to The System''s own Act: %', input -> 'characters'; end if;
  if not (input -> 'systemActs') ? tally::text then raise exception 'The System''s own Act is still named as its: %', input -> 'systemActs'; end if;
end $$;
