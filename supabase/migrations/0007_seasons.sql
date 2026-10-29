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

-- The settings that are spans are spans, held so when they are written: a length of nothing, a
-- unit no interval knows, or a count past what span_interval reads, would stop every window or
-- season silently. A thousand months is longer than any instance runs.
create function settings_spans_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key in ('settlementLength', 'seasonLength', 'turnCooldown') and not (
       jsonb_typeof(new.value) = 'object' and new.value ->> 'unit' in ('day', 'week', 'month')
       and jsonb_typeof(new.value -> 'count') = 'number' and (new.value ->> 'count')::numeric >= 1
       and (new.value ->> 'count')::numeric <= 1000
       and (new.value ->> 'count')::numeric = trunc((new.value ->> 'count')::numeric)) then
    raise exception '% is a span: a unit of day, week or month and a whole count from 1 to 1000', new.key using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_spans_hold before insert or update on settings for each row execute function settings_spans_hold();

-- One of the instance's words, with {season} filled in. Words the instance never gave are an
-- error naming them, never a thread with no title; the settings trigger below keeps a seeded
-- instance from losing them, so the way out of this error is the seed that gives them.
create function copy_of(word text, season_number integer) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  words text := (select value ->> word from settings where key = 'copy');
begin
  if words is null or btrim(words) = '' then
    raise exception 'the instance gives no words for copy.%; seed them', word using errcode = 'P0002';
  end if;
  return replace(words, '{season}', season_number::text);
end $$;

-- The words The System needs are always there once given.
create function settings_copy_complete() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare missing text;
begin
  if new.key <> 'copy' then return new; end if;
  select string_agg(k, ', ') into missing from unnest(array['turnsThreadTitle', 'revealTitle', 'revealBody']) k
  where jsonb_typeof(new.value -> k) is distinct from 'string' or btrim(new.value ->> k) = '';
  if missing is not null then raise exception 'copy is missing %', missing using errcode = '23514'; end if;
  return new;
end $$;
create trigger settings_copy_complete before insert or update on settings for each row execute function settings_copy_complete();
create function settings_copy_kept() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.key = 'copy' then raise exception 'copy cannot be deleted, only replaced' using errcode = '23514'; end if;
  return old;
end $$;
create trigger settings_copy_kept before delete on settings for each row execute function settings_copy_kept();

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
  opened jsonb;
  written uuid;
begin
  perform acting(through);
  -- A Turn and the reveal never overlap, so a reveal holds every Turn made before it.
  perform pg_advisory_xact_lock_shared(hashtext('kayfabb.reveal_season'));
  if loudness is null or loudness not in ('silent', 'announced', 'revealed') then
    raise exception 'a Turn is silent, announced, or revealed' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One Turn of a character's at a time.
  perform 1 from characters where id = through for no key update;
  select class_key, started_at into was, since from class_history where character = through order by started_at desc limit 1;
  -- A revealed Turn says since when. For the class a character was made with, that is no closer
  -- than the start of the season it was made in: the moment it was made would show which masks
  -- were made in one sitting, which is to say whose (as reveal_season() below holds it too).
  if since = (select min(started_at) from class_history where character = through) then
    since := coalesce((select max(starts_at) from seasons where starts_at <= since), (select min(starts_at) from seasons));
  end if;
  if was = to_class then raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The cooldown runs from the last Turn; a character's first class is not a Turn.
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  -- Timed from now, after the lock, never from the transaction's start: a Turn that waited out
  -- a reveal falls in the season the reveal opened, not the one it closed.
  insert into class_history (character, class_key, started_at) values (through, to_class, clock_timestamp());
  if loudness = 'silent' then return jsonb_build_object('turned', true, 'loudness', 'silent'); end if;

  select * into open_season from seasons where ends_at is null for no key update;
  if open_season.id is null then
    -- Unreachable once an instance is seeded (seed_instance() opens the first season, and the
    -- reveal opens each next one at once); said rather than filed under no season.
    raise exception 'no season is open to announce a Turn in' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  in_thread := open_season.turns_thread;
  if in_thread is null then
    insert into threads (board, title) values (system_board(), copy_of('turnsThreadTitle', open_season.number)) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = open_season.id;
    opened := thread_projection(in_thread);
  end if;
  insert into acts (character, kind, thread, payload)
  values (through, 'turn', in_thread, case loudness
    when 'revealed' then jsonb_build_object('was', was, 'since', since)
    else '{}'::jsonb end) returning id into written;
  -- The season's Turns thread, the first time a Turn opens it, so its board hears of it.
  return jsonb_build_object('turned', true, 'loudness', loudness, 'act', act_projection(written))
    || case when opened is null then '{}'::jsonb else jsonb_build_object('thread', opened) end;
end $$;

create function reveal_season() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  ended timestamptz := now();
  in_thread uuid;
  written uuid;
begin
  perform pg_advisory_xact_lock(hashtext('kayfabb.reveal_season'));
  select * into s from seasons where ends_at is null;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended);
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  -- The reveal's own Act says what the season was; each character's classes this season follow
  -- it as an Act of their own, so the reveal is many small rows at any size of cast, never one
  -- payload holding all of them. Characters by name; who plays them, never.
  insert into acts (character, kind, thread, payload)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', (select count(*) from characters where created_at < ended))) returning id into written;
  -- The class held as the season began counts from the season's start, not from when it was
  -- taken: an earlier season's Turn was that season's to reveal. So does a character's first
  -- class, which was taken when it was made: masks made in one sitting would show themselves one
  -- player's. Only a Turn shows its time.
  insert into acts (character, kind, thread, payload)
  select null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'character', c.id, 'name', c.name, 'classes', (
      select jsonb_agg(jsonb_build_object('class', h.class_key, 'from',
        case when h.started_at <= s.starts_at or h.started_at = (select min(started_at) from class_history f where f.character = c.id) then s.starts_at else h.started_at end) order by h.started_at)
      from class_history h
      where h.character = c.id and h.started_at < ended
        and h.started_at >= coalesce((select max(started_at) from class_history x where x.character = c.id and x.started_at <= s.starts_at), s.starts_at)
    ))
  from characters c where c.created_at < ended
  order by c.name, c.id;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;

select cron.schedule('kayfabb-reveal', '23 * * * *', 'select public.reveal_season()');

revoke execute on function span_interval(jsonb), copy_of(text, integer), system_board(), reveal_season(), settings_spans_hold(),
  settings_copy_complete(), settings_copy_kept() from public, anon, authenticated;
revoke execute on function turn(uuid, text, text) from public, anon;
grant execute on function turn(uuid, text, text) to authenticated;
