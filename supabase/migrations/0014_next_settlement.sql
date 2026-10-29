-- When the next settlement comes, so a pending Turn can say when it takes effect: My characters
-- shows it, and the answer to a Turn names it. The screens' engine plan, Task 2; a Turn waits for
-- the settlement since the fix round's Task F (0007's turn() and masks_change()).
--
-- The open window ends a whole settlement length after the last settled one, at the first such
-- end after the instant asked about, and never past its season's end (next_settlement_window,
-- 0004, cuts its windows the same way). A season's first window is the exception: it ends at the
-- first run, whose minute the cron decides and SQL does not read, so its end is unknown, and said
-- as unknown (null), never guessed. A Turn asked then takes effect at that first run all the same.
-- Public: when The System settles is the same for everyone.

create function next_settlement_at(at timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  last_end timestamptz := (select max(ends_at) from settlements);
  s seasons%rowtype;
  season_end timestamptz;
  len interval := span_interval(setting('settlementLength'));
  end_at timestamptz;
begin
  if last_end is null then return null; end if;
  -- The season the next window is in, and whether that window is its first.
  select * into s from seasons where starts_at <= last_end and (ends_at is null or ends_at > last_end);
  if s.id is null or s.starts_at = last_end then return null; end if;
  season_end := coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')));
  end_at := last_end + len;
  while end_at <= at and end_at < season_end loop end_at := end_at + len; end loop;
  end_at := least(end_at, season_end);
  -- Past the season's end, the next window is the next season's first.
  if end_at <= at then return null; end if;
  return end_at;
end $$;

-- turn() (0007), its answer naming when the Turn takes effect. Everything else as 0007 wrote it.
create or replace function turn(through uuid, to_class text, loudness text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text;
  last_turn timestamptz;
  next_allowed timestamptz;
begin
  perform acting(through);
  if loudness is null or loudness not in ('silent', 'announced', 'revealed') then
    raise exception 'a Turn is silent, announced, or revealed' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform 1 from characters where id = through for no key update;
  select class_key into was from class_now(through, 'infinity');
  if was = to_class then
    if exists (select 1 from pending_turns where character = through) then
      raise exception 'this character already is one: withdraw its waiting Turn to keep it' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  insert into pending_turns (character, class_key, loudness) values (through, to_class, loudness)
  on conflict (character) do update set class_key = excluded.class_key, loudness = excluded.loudness, asked_at = clock_timestamp();
  -- Read at the moment it was asked, as masks_change() reads asked_at.
  return jsonb_build_object('pending', true, 'class', to_class, 'loudness', loudness, 'takes_effect_at', next_settlement_at(clock_timestamp()));
end $$;

revoke execute on function next_settlement_at(timestamptz) from public, anon;
grant execute on function next_settlement_at(timestamptz) to authenticated;
