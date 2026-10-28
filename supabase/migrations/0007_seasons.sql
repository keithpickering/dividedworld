-- Seasons, Turns and the reveal.
--
-- Task 12 of docs/plans/2026-10-28-core-loop-engine-plan.md; the design's sections 1 and 3.
-- seasons itself is 0003's (standings are per season). This adds:
--   - turn(): a character's change of class, mid-season, as loud as its player chooses. Silent
--     writes only the private class history; announced posts a public Turn Act that never says
--     to what; revealed posts one that names the class it Turned from, and since when. A Turn
--     inside the cooldown is refused, and the refusal says when it can be made.
--   - reveal_season(): at a season's end, The System posts every character's class history that
--     season, silent Turns included, closes the season and opens the next. Who plays a
--     character is never revealed. The reveal is The System's own Act, the one Act with no
--     character, since The System plays no mask; pg_cron calls it every hour and it does
--     nothing until the season's length has passed.
-- The words The System uses are the instance's (its `copy`, seeded into settings), never this
-- file's.

-- A span setting ({unit, count}) as an interval, so "3 months" stays three months.
create function span_interval(span jsonb) returns interval
language sql immutable set search_path = public, pg_temp as $$
  select (span ->> 'count')::integer * case span ->> 'unit' when 'day' then interval '1 day' when 'week' then interval '1 week' when 'month' then interval '1 month' end
$$;

-- One of the instance's words, with {season} filled in.
create function copy_of(key text, season_number integer) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select replace(setting('copy') ->> key, '{season}', season_number::text)
$$;

-- The board The System posts on: the instance's first.
create function system_board() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from boards order by created_at, slug limit 1
$$;

alter table seasons add column turns_thread uuid references threads (id);
alter table seasons add column reveal_act uuid references acts (id);

create function turn(through uuid, to_class text, loudness text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text;
  since timestamptz;
  last_turn timestamptz;
  next_allowed timestamptz;
  open_season seasons%rowtype;
  in_thread uuid;
  written uuid;
begin
  perform acting(through);
  if loudness is null or loudness not in ('silent', 'announced', 'revealed') then
    raise exception 'a Turn is silent, announced, or revealed' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One Turn of a character's at a time.
  perform 1 from characters where id = through for no key update;
  select class_key, started_at into was, since from class_history where character = through order by started_at desc limit 1;
  if was = to_class then raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The cooldown runs from the last Turn; a character's first class is not a Turn.
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  insert into class_history (character, class_key) values (through, to_class);
  if loudness = 'silent' then return jsonb_build_object('turned', true, 'loudness', 'silent'); end if;

  select * into open_season from seasons where ends_at is null for no key update;
  in_thread := open_season.turns_thread;
  if in_thread is null then
    insert into threads (board, title) values (system_board(), copy_of('turnsThreadTitle', coalesce(open_season.number, 0))) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = open_season.id;
  end if;
  insert into acts (character, kind, thread, payload)
  values (through, 'turn', in_thread, case loudness
    when 'revealed' then jsonb_build_object('was', was, 'since', since)
    else '{}'::jsonb end) returning id into written;
  return jsonb_build_object('turned', true, 'loudness', loudness, 'act', act_projection(written));
end $$;

create function reveal_season() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  ended timestamptz := now();
  in_thread uuid;
  written uuid;
  history jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('kayfabb.reveal_season'));
  select * into s from seasons where ends_at is null;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  -- Every character's classes this season: the one it held as the season began, and each Turn
  -- in it, silent ones included. Characters by id; who plays them, never.
  select coalesce(jsonb_agg(jsonb_build_object('character', c.id, 'name', c.name, 'classes', (
      select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', h.started_at) order by h.started_at)
      from class_history h
      where h.character = c.id and h.started_at < ended
        and h.started_at >= coalesce((select max(started_at) from class_history x where x.character = c.id and x.started_at <= s.starts_at), s.starts_at)
    )) order by c.name), '[]')
  into history
  from characters c where c.created_at < ended;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended);
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  insert into acts (character, kind, thread, payload)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', history)) returning id into written;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;

select cron.schedule('kayfabb-reveal', '23 * * * *', 'select public.reveal_season()');

revoke execute on function span_interval(jsonb), copy_of(text, integer), system_board(), reveal_season() from public, anon, authenticated;
revoke execute on function turn(uuid, text, text) from public, anon;
grant execute on function turn(uuid, text, text) to authenticated;
