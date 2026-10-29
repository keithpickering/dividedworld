-- Seasons, Turns, the tally and the reveal.
--
-- Task 12 of docs/plans/2026-10-28-core-loop-engine-plan.md, the design's sections 1 and 3, and
-- the fix round's Task F (the owner's answers 16 and 17, on #4: masks change at the tally).
-- seasons itself is 0003's (standings are per season). This adds:
--   - turn(): a character's change of class, mid-season, as loud as its player chooses. It waits
--     for the next settlement (pending_turns), and its player may change it or withdraw it
--     (withdraw_turn) until then; it takes effect, and its cooldown starts, at the settlement. A
--     Turn inside the cooldown is refused, and the refusal says when it can be made.
--   - masks_change(): run by every settlement (0003's apply_settlement). The characters made in
--     its window debut, the Turns asked in it take effect, and The System posts the tally: one
--     Act naming the debuts and the loud Turns. An announced Turn never says to what; a revealed
--     one names the class it Turned from, and since when. Everything that happened to masks in
--     a day lands together, at the window's end, so nobody's sitting can be picked out of it.
--   - reveal_season(): run by the settlement of a season's last window. The System posts every
--     character's class history that season, silent Turns included, closes the season and opens
--     the next. Who plays a character is never revealed.
--   - broadcasts_due: what The System posts, waiting to reach its readers live. The settlement
--     writes it in the same transaction as the Acts, and the settle function sends it and clears
--     it (due_broadcasts, broadcasts_sent), so a run that fails between the two leaves it for the
--     next run, and a window that is applied once queues its broadcasts once.
-- The tally and the reveal are The System's own Acts, the only Acts with no character, since The
-- System plays no mask. The words The System uses are the instance's (its `copy`, seeded into
-- settings), never this file's.

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

-- A Turn waiting for the next settlement: one per character, its player's to change or withdraw.
-- Its way out is that settlement, or its player.
create table pending_turns (
  character uuid primary key references characters (id),
  class_key text not null references class_kinds (key),
  loudness text not null check (loudness in ('silent', 'announced', 'revealed')),
  asked_at timestamptz not null default clock_timestamp()
);

-- What The System posted, waiting to reach its readers live (the header says why it waits here).
-- A row is kept until a send takes it, however many runs that is: the next run after a failed
-- send comes a cron period later. Sending is at least once (a run that dies between a send and
-- broadcasts_sent sends again), and a client keeps an Act by its id, so a repeat changes nothing.
create table broadcasts_due (
  id bigint generated always as identity primary key,
  topic text not null,
  event text not null,
  payload jsonb not null,
  made_at timestamptz not null default now()
);

create function broadcast_later(topic text, event text, payload jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into broadcasts_due (topic, event, payload) values (topic, event, payload)
$$;

-- The broadcasts waiting, oldest first, at most `most` of them, for the settle function to send.
create function due_broadcasts(most integer default 500) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'topic', b.topic, 'event', b.event, 'payload', b.payload) order by b.id)
    from (select * from broadcasts_due order by id limit greatest(most, 0)) b), '[]');
end $$;

-- The ids sent, as a JSON list, which every caller (PostgREST, a test's psql) passes alike.
create function broadcasts_sent(ids jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare gone integer;
begin
  delete from broadcasts_due where id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(ids, '[]')) x);
  get diagnostics gone = row_count;
  return gone;
end $$;

-- A character's class now, and since when as a revealed Turn says it: for the class it was made
-- with, no closer than the start of the season it was made in, since the moment it was made
-- would show which masks were made in one sitting, which is to say whose.
create function class_now(who uuid, at timestamptz) returns table (class_key text, since timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.class_key,
    case when h.started_at = (select min(started_at) from class_history f where f.character = who)
      then coalesce((select max(starts_at) from seasons where starts_at <= h.started_at), (select min(starts_at) from seasons))
      else h.started_at end
  from class_history h where h.character = who and h.started_at <= at
  order by h.started_at desc limit 1
$$;

create function turn(through uuid, to_class text, loudness text) returns jsonb
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
  -- One Turn of a character's at a time, and none while a settlement makes one take effect
  -- (masks_change locks the same row), so the cooldown is read from what took effect.
  perform 1 from characters where id = through for no key update;
  select class_key into was from class_now(through, 'infinity');
  if was = to_class then raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The cooldown runs from the last Turn's taking effect; a character's first class is not a Turn.
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  -- Asked again before the settlement, it is the same Turn, changed.
  insert into pending_turns (character, class_key, loudness) values (through, to_class, loudness)
  on conflict (character) do update set class_key = excluded.class_key, loudness = excluded.loudness, asked_at = clock_timestamp();
  return jsonb_build_object('pending', true, 'class', to_class, 'loudness', loudness);
end $$;

create function withdraw_turn(through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform acting(through);
  perform 1 from characters where id = through for no key update;
  delete from pending_turns where character = through;
  if not found then raise exception 'no Turn of that character is waiting' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  return jsonb_build_object('withdrawn', true);
end $$;

-- What a settlement does to masks, at its window's end, in its transaction: debuts, Turns, and
-- the tally that names them. Run once per window, since apply_settlement() runs it only when it
-- writes the window's settlement row.
create function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  open_season seasons%rowtype;
  debuts jsonb;
  turns jsonb := '[]';
  r record;
  in_thread uuid;
  written uuid;
begin
  -- The characters made in the window (or, made while a run read it, in one before) debut.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name
  ) select coalesce(jsonb_agg(jsonb_build_object('character', id, 'name', name) order by name, id), '[]') into debuts from d;
  -- The Turns asked in it take effect at its end; the rows of their characters are locked first,
  -- in one order, so a turn() racing this one waits and then reads what took effect.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  for r in select p.character, p.class_key, p.loudness, c.name from pending_turns p join characters c on c.id = p.character
           where p.asked_at < window_end order by c.name, c.id loop
    if r.loudness <> 'silent' then
      turns := turns || jsonb_build_array(jsonb_build_object('character', r.character, 'name', r.name, 'loudness', r.loudness)
        || case when r.loudness = 'revealed' then (select jsonb_build_object('was', n.class_key, 'since', n.since) from class_now(r.character, window_end) n) else '{}'::jsonb end);
    end if;
    insert into class_history (character, class_key, started_at) values (r.character, r.class_key, window_end);
    delete from pending_turns where character = r.character;
  end loop;
  if jsonb_array_length(debuts) = 0 and jsonb_array_length(turns) = 0 then return null; end if;

  select * into open_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1 for no key update;
  in_thread := open_season.turns_thread;
  if in_thread is null then
    insert into threads (board, title) values (system_board(), copy_of('turnsThreadTitle', open_season.number)) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = open_season.id;
    perform broadcast_later('board:' || (select board from threads where id = in_thread), 'thread', thread_projection(in_thread));
  end if;
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'tally', in_thread, jsonb_build_object('season', open_season.number, 'debuts', debuts, 'turns', turns), window_end)
  returning id into written;
  perform broadcast_later('thread:' || in_thread, 'act', act_projection(written));
  return written;
end $$;

-- A season's end, at its last window's end: every character's season, then the next season.
-- Run by apply_settlement() for that window, once.
create function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  in_thread uuid;
  written uuid;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended);
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  perform broadcast_later('board:' || (select board from threads where id = in_thread), 'thread', thread_projection(in_thread));
  -- The reveal's own Act says what the season was; each character's classes this season follow
  -- it as an Act of their own, so the reveal is many small rows at any size of cast, never one
  -- payload holding all of them. Characters by name; who plays them, never. A character that
  -- debuts at this very settlement played no part in the season, and is the next one's.
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', (select count(*) from characters where debuted_at < ended)), ended) returning id into written;
  perform broadcast_later('thread:' || in_thread, 'act', act_projection(written));
  -- The class held as the season began counts from the season's start, not from when it was
  -- taken: an earlier season's Turn was that season's to reveal. So does a character's first
  -- class, which was taken when it was made: masks made in one sitting would show themselves one
  -- player's. A Turn shows the settlement it took effect at, never the minute it was asked.
  insert into acts (character, kind, thread, payload, created_at)
    select null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'character', c.id, 'name', c.name, 'classes', (
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from',
          case when h.started_at <= s.starts_at or h.started_at = (select min(started_at) from class_history f where f.character = c.id) then s.starts_at else h.started_at end) order by h.started_at)
        from class_history h
        where h.character = c.id and h.started_at < ended
          and h.started_at >= coalesce((select max(started_at) from class_history x where x.character = c.id and x.started_at <= s.starts_at), s.starts_at)
      )), ended
    from characters c where c.debuted_at < ended
    order by c.name, c.id;
  -- Each in the thread's order, in a statement of its own, which sees the rows the one above wrote.
  insert into broadcasts_due (topic, event, payload)
  select 'thread:' || in_thread, 'act', act_projection(a.id) from acts a where a.thread = in_thread and a.id <> written order by a.seq;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;

alter table pending_turns enable row level security;
alter table broadcasts_due enable row level security;
revoke all on pending_turns, broadcasts_due from anon, authenticated;
-- A player reads their own characters' waiting Turns, and nobody else's.
grant select (character, class_key, loudness) on pending_turns to authenticated;
create policy own on pending_turns for select to authenticated
  using (exists (select 1 from characters c where c.id = pending_turns.character and c.owner = auth.uid()));

revoke execute on function span_interval(jsonb), copy_of(text, integer), system_board(), class_now(uuid, timestamptz),
  masks_change(timestamptz), reveal_season(timestamptz), broadcast_later(text, text, jsonb), due_broadcasts(integer), broadcasts_sent(jsonb),
  settings_spans_hold(), settings_copy_complete(), settings_copy_kept() from public, anon, authenticated;
grant execute on function due_broadcasts(integer), broadcasts_sent(jsonb) to service_role;
revoke execute on function turn(uuid, text, text), withdraw_turn(uuid) from public, anon;
grant execute on function turn(uuid, text, text), withdraw_turn(uuid) to authenticated;
