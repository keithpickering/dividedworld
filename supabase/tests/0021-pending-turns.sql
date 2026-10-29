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
  w jsonb;
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
    -- The window the job would settle once a whole length has passed: cut at its season's end.
    w := next_settlement_window((select max(ends_at) from settlements) + span_interval(setting('settlementLength')));
    perform set_config('role', 'service_role', true);
    perform apply_settlement((w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz, '[]');
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

-- A season whose end falls inside the open window: the window ends with the season, and a Turn
-- asked in it is promised the season's end, which is when it takes effect (0014's cap; #11).
do $$
declare
  ann uuid := tests.account('pend2-short');
  turner uuid := tests.character(ann, 'Short Window Turner', 'alpha', now() - interval '60 days');
  last_end timestamptz;
  season_end timestamptz;
  said jsonb;
  why text;
begin
  -- A long season, past its first window, whose end the cron decides.
  update settings set value = '{"unit": "month", "count": 1000}' where key = 'seasonLength';
  if not exists (select 1 from settlements) or (select starts_at from seasons where ends_at is null) = (select max(ends_at) from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)), coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)) + span_interval(setting('settlementLength')), '[]');
    perform tests.unbecome();
  end if;
  last_end := (select max(ends_at) from settlements);
  season_end := last_end + span_interval(setting('settlementLength')) / 2;
  update seasons set ends_at = season_end where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), season_end);
  if next_settlement_at(last_end + interval '1 minute') is distinct from season_end then
    raise exception 'a Turn in a season''s last, short window is promised %, not the season''s end %', next_settlement_at(last_end + interval '1 minute'), season_end;
  end if;
  perform tests.become(ann);
  said := turn(turner, 'beta', 'silent');
  perform tests.unbecome();
  if (said ->> 'takes_effect_at')::timestamptz is distinct from season_end then raise exception 'turn() promises the season''s end: %', said; end if;
  delete from pending_turns where character = turner;
  why := pg_temp.promise_kept(ann, 'Kept Season End', last_end + interval '1 minute');
  if why is not null then raise exception 'in a season''s last, short window: %', why; end if;
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

-- ---- A Turn names the class it Turns to (show_to), from (show_from), both, or neither; naming
-- the class it Turns to writes the character's unmask Act after the tally (the class reveal
-- plan, Task 2) ----
do $$
declare
  ann uuid := tests.account('show-ann');
  bob uuid := tests.account('show-bob');
  watcher uuid := tests.character(bob, 'Watches Turns', 'alpha', now() - interval '60 days');
  plain uuid := tests.character(ann, 'Turns Plainly', 'alpha', now() - interval '60 days');
  from_only uuid := tests.character(ann, 'Names What It Was', 'alpha', now() - interval '60 days');
  to_only uuid := tests.character(ann, 'Names What It Is', 'alpha', now() - interval '60 days');
  named_both uuid := tests.character(ann, 'Names Both', 'alpha', now() - interval '60 days');
  window_end timestamptz := coalesce((select max(ends_at) from settlements), now()) + interval '1 minute';
  first_tally uuid;
  tally acts%rowtype;
  said jsonb;
  entry jsonb;
  u acts%rowtype;
begin
  perform tests.become(ann);
  said := turn(plain, 'beta', 'announced', false, false);
  if said - 'takes_effect_at' is distinct from '{"pending": true, "class": "beta", "loudness": "announced", "show_from": false, "show_to": false}'::jsonb then raise exception 'a Turn says how loud it is: %', said; end if;
  perform turn(from_only, 'beta', 'announced', true, false);
  perform turn(to_only, 'beta', 'announced', false, true);
  perform turn(named_both, 'beta', 'announced', true, true);
  -- A silent Turn names nothing; asking it to is refused.
  if pg_temp.refusal(format('select turn(%L, %L, %L, true, false)', plain, 'beta', 'silent')) is distinct from 'a silent Turn names no class' then raise exception 'a silent Turn named its old class'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L, false, true)', plain, 'beta', 'silent')) is distinct from 'a silent Turn names no class' then raise exception 'a silent Turn named its new class'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L, false, false)', plain, 'beta', 'revealed')) is distinct from 'a Turn is silent or announced' then raise exception 'the new form takes no "revealed"'; end if;
  if (select (show_from, show_to) from pending_turns where character = named_both) is distinct from (true, true) then raise exception 'its player reads what their Turn will name'; end if;
  perform tests.unbecome();
  update pending_turns set asked_at = window_end - interval '30 seconds' where character in (plain, from_only, to_only, named_both);
  first_tally := masks_change(window_end);
  select * into tally from acts where id = first_tally;
  select x into entry from jsonb_array_elements(tally.payload -> 'turns') x where x ->> 'character' = plain::text;
  if entry is distinct from jsonb_build_object('character', plain, 'name', 'Turns Plainly', 'loudness', 'announced') then raise exception 'a plain announced Turn names no class: %', entry; end if;
  select x into entry from jsonb_array_elements(tally.payload -> 'turns') x where x ->> 'character' = from_only::text;
  if entry ->> 'was' is distinct from 'alpha' or entry ? 'class' then raise exception 'a Turn naming its old class names it alone: %', entry; end if;
  select x into entry from jsonb_array_elements(tally.payload -> 'turns') x where x ->> 'character' = to_only::text;
  if entry ->> 'class' is distinct from 'beta' or entry ? 'was' then raise exception 'a Turn naming its new class names it alone: %', entry; end if;
  select x into entry from jsonb_array_elements(tally.payload -> 'turns') x where x ->> 'character' = named_both::text;
  if (entry ->> 'was', entry ->> 'class') is distinct from ('alpha'::text, 'beta'::text) then raise exception 'a Turn naming both names both: %', entry; end if;
  -- Naming the new class writes the character's unmask, after the tally, dated at it.
  for u in select * from acts where kind = 'unmask' and character in (to_only, named_both) loop
    if u.thread is distinct from tally.thread or u.seq <= tally.seq or u.created_at is distinct from window_end or u.payload is distinct from '{"class": "beta", "message": "", "via": "turn"}'::jsonb then
      raise exception 'a Turn naming its new class is unmasked after its tally, dated at it: %', to_jsonb(u);
    end if;
  end loop;
  if (select count(*) from acts where kind = 'unmask' and character in (to_only, named_both)) is distinct from 2::bigint then raise exception 'each Turn naming its new class writes one unmask'; end if;
  if exists (select 1 from acts where kind = 'unmask' and character in (plain, from_only)) then raise exception 'a Turn naming only its old class, or none, wrote an unmask'; end if;
  if (select (class, at, via) from class_reveals where character = to_only) is distinct from ('beta'::text, window_end, 'turn'::text) then raise exception 'class_reveals reads a Turn''s unmask'; end if;
  -- Reacted to and spun by another player, as any reveal is.
  select * into u from acts where kind = 'unmask' and character = to_only;
  perform tests.become(bob);
  perform react(u.id, watcher, 'up');
  perform spin(u.id, watcher, 'That Turn', '');
  perform tests.unbecome();
  if (select count from reaction_tallies where act = u.id and kind = 'up') is distinct from 1 then raise exception 'a Turn''s unmask is reacted to'; end if;
  if not exists (select 1 from threads where origin_act_id = u.id and board = players_board()) then raise exception 'a thread is spun from a Turn''s unmask, on the players'' board'; end if;
end $$;

-- ---- The old three-argument turn() still takes an older client's "revealed": announced, naming its old class ----
do $$
declare
  ann uuid := tests.account('show-old');
  old uuid := tests.character(ann, 'Older Client', 'alpha', now() - interval '60 days');
  said jsonb;
begin
  perform tests.become(ann);
  said := turn(old, 'beta', 'revealed');
  perform tests.unbecome();
  if (said ->> 'loudness', (said ->> 'show_from')::boolean, (said ->> 'show_to')::boolean) is distinct from ('announced'::text, true, false) then raise exception 'an older client''s revealed Turn is announced with its old class: %', said; end if;
  if (select (loudness, show_from, show_to) from pending_turns where character = old) is distinct from ('announced'::text, true, false) then raise exception 'it waits as announced, naming its old class'; end if;
end $$;
