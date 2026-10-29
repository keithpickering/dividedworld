-- Seasons, Turns and the reveal (supabase/migrations/0007_seasons.sql). Plan Task 12.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Everything another player can read, as one value, to see whether a Turn changed any of it.
create function pg_temp.public_view() returns text language sql as $$
  select concat_ws('|',
    (select coalesce(jsonb_agg(c order by c.id), '[]')::text from characters_public c),
    (select coalesce(jsonb_agg(a order by a.id), '[]')::text from acts_public a),
    (select coalesce(jsonb_agg(t order by t.id), '[]')::text from threads t),
    (select coalesce(jsonb_agg(s order by s.character, s.season), '[]')::text from standings s),
    (select coalesce(jsonb_agg(z order by z.id), '[]')::text from seasons z),
    (select coalesce(jsonb_agg(r order by r.act, r.kind), '[]')::text from reaction_tallies r))
$$;

-- Settle the next window, a day long, as the job does, as the service.
create function pg_temp.settle_day() returns jsonb language plpgsql as $f$
declare
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  w jsonb := next_settlement_window(s + interval '1 day');
  said jsonb;
begin
  perform set_config('role', 'service_role', true);
  said := apply_settlement((w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz, '[]');
  perform tests.unbecome();
  return said || w;
end $f$;

do $$
declare
  ann uuid := tests.account('turn-ann');
  bob uuid := tests.account('turn-bob');
  a uuid := tests.character(ann, 'Turncoat', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Steadfast', 'alpha', now() - interval '60 days');
  before text;
  said jsonb;
  why text;
begin
  -- A Turn, silent or loud, writes no public Act and changes nothing another player can read
  -- while it waits for the settlement (supabase/tests/0017-masks.sql settles it).
  perform tests.become(bob);
  before := pg_temp.public_view();
  perform tests.unbecome();
  perform tests.become(ann);
  said := turn(a, 'beta', 'announced');
  if said - 'takes_effect_at' <> '{"pending": true, "class": "beta", "loudness": "announced"}' or not said ? 'takes_effect_at' then raise exception 'a Turn waits, and says so to its player: %', said; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if pg_temp.public_view() <> before then raise exception 'a waiting Turn changed what another player can read'; end if;
  -- And the rest of what a Turn cannot be.
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'beta', 'silent')) is distinct from 'you do not play that character' then raise exception 'a Turn of another''s character'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if coalesce(pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'alpha', 'silent')), '') not like '%already%' then raise exception 'a Turn to the class it holds'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'ghost', 'silent')) is null then raise exception 'a Turn to no class'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'beta', 'shouted')) is null then raise exception 'a Turn of no loudness'; end if;
  perform tests.unbecome();
  -- A Turn inside the cooldown is refused, and the refusal says when it can be made: the
  -- cooldown after the last Turn took effect.
  insert into class_history (character, class_key, started_at) values (b, 'beta', now() - interval '10 days');
  perform tests.become(bob);
  why := pg_temp.refusal(format('select turn(%L, %L, %L)', b, 'alpha', 'silent'));
  if why is null then raise exception 'a Turn inside the cooldown went through'; end if;
  if why !~ 'can Turn again at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z' then raise exception 'the refusal should say when: %', why; end if;
  if substring(why from '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')::timestamptz is distinct from date_trunc('second', now() - interval '10 days' + interval '30 days') then
    raise exception 'the time it names should be the cooldown after the last Turn: %', why;
  end if;
  perform tests.unbecome();
end $$;

-- ---- The reveal: every character's season, silent Turns included; who plays them, never ----
do $$
declare
  ann uuid := tests.account('rev-ann');
  a uuid := tests.character(ann, 'Revealed One', 'alpha', now() - interval '200 days');
  m uuid := tests.character(ann, 'Made Midseason', 'beta', now() - interval '50 days');
  next_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_start timestamptz := next_start + interval '1 day' - interval '3 months';
  settled jsonb;
  reveal uuid;
  in_thread uuid;
  entry jsonb;
  cast_size integer;
begin
  -- The open season's three months run out at the next window's end; a silent Turn in it ten days before.
  update settings set value = '{"unit": "month", "count": 3}' where key = 'seasonLength';
  update seasons set starts_at = season_start where ends_at is null;
  insert into class_history (character, class_key, started_at) values (a, 'beta', next_start - interval '10 days');
  cast_size := (select count(*) from characters where debuted_at is not null and debuted_at < next_start + interval '1 day');
  settled := pg_temp.settle_day();
  if settled ->> 'revealed' is null then raise exception 'a season past its length is revealed by the settlement of its last window: %', settled; end if;
  select seasons.reveal_act into reveal from seasons where number = (settled ->> 'revealed')::integer;
  select thread into in_thread from acts where id = reveal;
  if (select kind from acts where id = reveal) is distinct from 'reveal' or (select character from acts where id = reveal) is not null then raise exception 'the reveal is The System''s own Act'; end if;
  if (select title from threads where id = in_thread) not like 'Season % The Reveal' then raise exception 'the reveal''s thread is titled in the instance''s words'; end if;
  -- One Act per character after the reveal's own, so no row grows with the cast.
  if (select (payload ->> 'characters')::integer from acts where id = reveal) is distinct from cast_size then raise exception 'the reveal counts the cast that debuted before it'; end if;
  if (select count(*) from acts where thread = in_thread and kind = 'reveal') is distinct from 1 + cast_size then
    raise exception 'the reveal should hold every character, one Act each';
  end if;
  select payload into entry from acts where thread = in_thread and payload ->> 'character' = a::text;
  if (select jsonb_agg(c ->> 'class') from jsonb_array_elements(entry -> 'classes') c) is distinct from '["alpha", "beta"]' then
    raise exception 'the reveal should show the class held at the start and the silent Turn: %', entry;
  end if;
  -- The class held as the season began counts from the season's start: the Turn before it was
  -- an earlier season's to reveal.
  if (entry -> 'classes' -> 0 ->> 'from')::timestamptz <> season_start then raise exception 'the first class should count from the season''s start: %', entry; end if;
  if exists (select 1 from acts where thread = in_thread and payload::text like '%' || ann || '%') then raise exception 'the reveal named a player'; end if;
  -- A character made inside the season shows the season's start as its first class's, not when
  -- it was made: masks made in one sitting would show themselves one player's.
  select payload into entry from acts where thread = in_thread and payload ->> 'name' = 'Made Midseason';
  if (entry -> 'classes' -> 0 ->> 'from')::timestamptz is distinct from season_start then raise exception 'the reveal showed when a character was made: %', entry; end if;
  -- The reveal is reacted to like any Act (0015).
  perform tests.become(ann);
  if pg_temp.refusal(format('select react(%L, %L, %L)', reveal, a, 'up')) is not null then
    raise exception 'reacting to the reveal is refused: %', pg_temp.refusal(format('select react(%L, %L, %L)', reveal, a, 'up'));
  end if;
  perform tests.unbecome();
  if (select count(*) from seasons where ends_at is null) is distinct from 1 then raise exception 'one season is open after the reveal'; end if;
  if (select starts_at from seasons where ends_at is null) is distinct from (select max(ends_at) from seasons) then raise exception 'the next season opens as the last ends'; end if;
  if pg_temp.settle_day() ->> 'revealed' is not null then raise exception 'a season just opened is not due'; end if;
end $$;

-- ---- Only the settlement reveals; a player Turns only through turn() ----
do $$
declare refused boolean := false;
begin
  perform tests.become(tests.account('rev-nosy'));
  begin perform reveal_season(now()); exception when insufficient_privilege then refused := true; end;
  perform tests.unbecome();
  if not refused then raise exception 'a player called reveal_season()'; end if;
end $$;

-- ---- The words The System needs cannot be lost, and their absence is said, not a null title ----
do $$
declare why text;
begin
  why := pg_temp.refusal($q$update settings set value = value - 'revealTitle' where key = 'copy'$q$);
  if why is null or why not like '%revealTitle%' then raise exception 'copy lost a key: %', why; end if;
  if pg_temp.refusal($q$delete from settings where key = 'copy'$q$) is null then raise exception 'copy was deleted'; end if;
  alter table settings disable trigger settings_copy_kept;
  delete from settings where key = 'copy';
  why := pg_temp.refusal('select copy_of(''revealTitle'', 1)');
  if why is null or why not like '%copy.revealTitle%' then raise exception 'missing words should be named: %', why; end if;
end $$;
