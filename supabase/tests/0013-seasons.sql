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

do $$
declare
  ann uuid := tests.account('turn-ann');
  bob uuid := tests.account('turn-bob');
  a uuid := tests.character(ann, 'Turncoat', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Steadfast', 'alpha', now() - interval '60 days');
  c uuid := tests.character(bob, 'First Reveal', 'alpha', now() - interval '10 days');
  before text;
  said jsonb;
  why text;
begin
  -- A silent Turn writes no public Act and changes nothing another player can read.
  perform tests.become(bob);
  before := pg_temp.public_view();
  perform tests.unbecome();
  perform tests.become(ann);
  perform pg_sleep(0.01);
  said := turn(a, 'beta', 'silent');
  if said <> '{"turned": true, "loudness": "silent"}' then raise exception 'a silent Turn: %', said; end if;
  if (select class_key from class_history where character = a order by started_at desc limit 1) is distinct from 'beta' then raise exception 'the Turn is in the class history'; end if;
  -- Timed when it was made, after any reveal it waited on, never from the transaction's start.
  if (select max(started_at) from class_history where character = a) <= now() then raise exception 'a Turn is timed from its transaction''s start'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if pg_temp.public_view() <> before then raise exception 'a silent Turn changed what another player can read'; end if;

  -- Bob's first Turn is not inside any cooldown, and is announced: a public Act that never says to what.
  said := turn(b, 'beta', 'announced');
  if said -> 'act' ->> 'kind' <> 'turn' or said -> 'act' -> 'payload' <> '{}' then raise exception 'an announced Turn says nothing of either class: %', said; end if;
  if said::text like '%beta%' or said::text like '%alpha%' then raise exception 'an announced Turn named a class'; end if;
  -- The season's first announced Turn opens its Turns thread, and says so for its board.
  if said -> 'thread' ->> 'id' is distinct from said -> 'act' ->> 'thread' then raise exception 'the Turn that opens the Turns thread returns it: %', said; end if;
  perform tests.unbecome();

  -- A Turn inside the cooldown is refused, and the refusal says when it can be made.
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'alpha', 'silent'));
  if why is null then raise exception 'a Turn inside the cooldown went through'; end if;
  if why !~ 'can Turn again at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z' then raise exception 'the refusal should say when: %', why; end if;
  if substring(why from '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')::timestamptz not between now() + interval '30 days' - interval '1 minute' and clock_timestamp() + interval '30 days' then
    raise exception 'the time it names should be the cooldown after the last Turn: %', why;
  end if;
  -- And the rest of what a Turn cannot be.
  if pg_temp.refusal(format('select turn(%L, %L, %L)', b, 'alpha', 'silent')) is distinct from 'you do not play that character' then raise exception 'a Turn of another''s character'; end if;
  perform tests.unbecome();
  update class_history set started_at = started_at - interval '31 days' where character = a and class_key = 'beta';
  perform tests.become(ann);
  if coalesce(pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'beta', 'silent')), '') not like '%already%' then raise exception 'a Turn to the class it holds'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'ghost', 'silent')) is null then raise exception 'a Turn to no class'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'alpha', 'shouted')) is null then raise exception 'a Turn of no loudness'; end if;
  -- Revealed: the class it Turned from, and since when.
  said := turn(a, 'alpha', 'revealed');
  if said ? 'thread' then raise exception 'a Turn into a Turns thread already open returned it again'; end if;
  if said -> 'act' -> 'payload' ->> 'was' <> 'beta' or said -> 'act' -> 'payload' ->> 'since' is null then raise exception 'a revealed Turn names what it was: %', said; end if;
  if said::text like '%"alpha"%' then raise exception 'a revealed Turn said what it Turned to'; end if;
  perform tests.unbecome();
  -- A character's first revealed Turn says since when no closer than the season it was made in:
  -- the moment it was made would show which masks were made in one sitting.
  perform tests.become(bob);
  said := turn(c, 'beta', 'revealed');
  perform tests.unbecome();
  if (said -> 'act' -> 'payload' ->> 'since')::timestamptz is distinct from (select max(starts_at) from seasons where starts_at <= (select created_at from characters where id = c)) then
    raise exception 'a first revealed Turn showed when its character was made: % (made %)', said -> 'act' -> 'payload', (select created_at from characters where id = c);
  end if;
end $$;

-- ---- The reveal: every character's season, silent Turns included; who plays them, never ----
do $$
declare
  ann uuid := tests.account('rev-ann');
  a uuid := tests.character(ann, 'Revealed One', 'alpha', now() - interval '200 days');
  m uuid := tests.character(ann, 'Made Midseason', 'beta', now() - interval '50 days');
  said jsonb;
  entry jsonb;
begin
  -- The open season began 100 days ago, past its three months; a silent Turn in it ten days ago.
  update seasons set starts_at = now() - interval '100 days' where ends_at is null;
  insert into class_history (character, class_key, started_at) values (a, 'beta', now() - interval '10 days');
  said := reveal_season();
  if said is null then raise exception 'a season past its length should be revealed'; end if;
  if said -> 'act' ->> 'kind' <> 'reveal' or said -> 'act' ->> 'character' is not null then raise exception 'the reveal is The System''s own Act: %', said -> 'act'; end if;
  if said -> 'thread' ->> 'title' not like 'Season % The Reveal' then raise exception 'the reveal''s thread is titled in the instance''s words: %', said -> 'thread'; end if;
  -- One Act per character after the reveal's own, so no row grows with the cast.
  if (said -> 'act' -> 'payload' ->> 'characters')::integer <> (select count(*) from characters) then raise exception 'the reveal counts the cast: %', said -> 'act'; end if;
  if (select count(*) from acts where thread = (said -> 'thread' ->> 'id')::uuid and kind = 'reveal') is distinct from 1 + (select count(*) from characters) then
    raise exception 'the reveal should hold every character, one Act each';
  end if;
  select payload into entry from acts where thread = (said -> 'thread' ->> 'id')::uuid and payload ->> 'character' = a::text;
  if (select jsonb_agg(c ->> 'class') from jsonb_array_elements(entry -> 'classes') c) is distinct from '["alpha", "beta"]' then
    raise exception 'the reveal should show the class held at the start and the silent Turn: %', entry;
  end if;
  -- The class held as the season began counts from the season's start: the Turn before it was
  -- an earlier season's to reveal.
  if (entry -> 'classes' -> 0 ->> 'from')::timestamptz <> now() - interval '100 days' then raise exception 'the first class should count from the season''s start: %', entry; end if;
  if exists (select 1 from acts where thread = (said -> 'thread' ->> 'id')::uuid and payload::text like '%' || ann || '%') then raise exception 'the reveal named a player'; end if;
  -- A character made inside the season shows the season's start as its first class's, not when
  -- it was made: masks made in one sitting would show themselves one player's.
  select payload into entry from acts where thread = (said -> 'thread' ->> 'id')::uuid and payload ->> 'name' = 'Made Midseason';
  if (entry -> 'classes' -> 0 ->> 'from')::timestamptz is distinct from now() - interval '100 days' then raise exception 'the reveal showed when a character was made: %', entry; end if;
  -- The next season is open, from the instant the last ended, and nothing is due yet.
  -- Nobody reacts to The System's own Acts, and the refusal says so plainly.
  perform tests.become(ann);
  if pg_temp.refusal(format('select react(%L, %L, %L)', said -> 'act' ->> 'id', a, 'up')) is distinct from 'nobody reacts to The System''s own Acts' then
    raise exception 'reacting to the reveal: %', pg_temp.refusal(format('select react(%L, %L, %L)', said -> 'act' ->> 'id', a, 'up'));
  end if;
  perform tests.unbecome();
  if (select count(*) from seasons where ends_at is null) is distinct from 1 then raise exception 'one season is open after the reveal'; end if;
  if (select starts_at from seasons where ends_at is null) is distinct from (select max(ends_at) from seasons) then raise exception 'the next season opens as the last ends'; end if;
  if reveal_season() is not null then raise exception 'a season just opened is not due'; end if;
  if not exists (select 1 from cron.job where jobname = 'kayfabb-reveal') then raise exception 'the reveal is scheduled'; end if;
end $$;

-- ---- Only the service reveals; a player Turns only through turn() ----
do $$
declare refused boolean := false;
begin
  perform tests.become(tests.account('rev-nosy'));
  begin perform reveal_season(); exception when insufficient_privilege then refused := true; end;
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
