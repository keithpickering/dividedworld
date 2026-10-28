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
  before text;
  said jsonb;
  why text;
begin
  -- A silent Turn writes no public Act and changes nothing another player can read.
  perform tests.become(bob);
  before := pg_temp.public_view();
  perform tests.unbecome();
  perform tests.become(ann);
  said := turn(a, 'beta', 'silent');
  if said <> '{"turned": true, "loudness": "silent"}' then raise exception 'a silent Turn: %', said; end if;
  if (select class_key from class_history where character = a order by started_at desc limit 1) <> 'beta' then raise exception 'the Turn is in the class history'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if pg_temp.public_view() <> before then raise exception 'a silent Turn changed what another player can read'; end if;

  -- Bob's first Turn is not inside any cooldown, and is announced: a public Act that never says to what.
  said := turn(b, 'beta', 'announced');
  if said -> 'act' ->> 'kind' <> 'turn' or said -> 'act' -> 'payload' <> '{}' then raise exception 'an announced Turn says nothing of either class: %', said; end if;
  if said::text like '%beta%' or said::text like '%alpha%' then raise exception 'an announced Turn named a class'; end if;
  perform tests.unbecome();

  -- A Turn inside the cooldown is refused, and the refusal says when it can be made.
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'alpha', 'silent'));
  if why is null then raise exception 'a Turn inside the cooldown went through'; end if;
  if why !~ 'can Turn again at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z' then raise exception 'the refusal should say when: %', why; end if;
  if substring(why from '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')::timestamptz not between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days' then
    raise exception 'the time it names should be the cooldown after the last Turn: %', why;
  end if;
  -- And the rest of what a Turn cannot be.
  if pg_temp.refusal(format('select turn(%L, %L, %L)', b, 'alpha', 'silent')) is distinct from 'you do not play that character' then raise exception 'a Turn of another''s character'; end if;
  perform tests.unbecome();
  update class_history set started_at = started_at - interval '31 days' where character = a and class_key = 'beta';
  perform tests.become(ann);
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'beta', 'silent')) not like '%already%' then raise exception 'a Turn to the class it holds'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'ghost', 'silent')) is null then raise exception 'a Turn to no class'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', a, 'alpha', 'shouted')) is null then raise exception 'a Turn of no loudness'; end if;
  -- Revealed: the class it Turned from, and since when.
  said := turn(a, 'alpha', 'revealed');
  if said -> 'act' -> 'payload' ->> 'was' <> 'beta' or said -> 'act' -> 'payload' ->> 'since' is null then raise exception 'a revealed Turn names what it was: %', said; end if;
  if said::text like '%"alpha"%' then raise exception 'a revealed Turn said what it Turned to'; end if;
  perform tests.unbecome();
end $$;

-- ---- The reveal: every character's season, silent Turns included; who plays them, never ----
do $$
declare
  ann uuid := tests.account('rev-ann');
  a uuid := tests.character(ann, 'Revealed One', 'alpha', now() - interval '200 days');
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
  select e into entry from jsonb_array_elements(said -> 'act' -> 'payload' -> 'characters') e where e ->> 'character' = a::text;
  if entry is null then raise exception 'the reveal should hold every character'; end if;
  if (select jsonb_agg(c ->> 'class') from jsonb_array_elements(entry -> 'classes') c) <> '["alpha", "beta"]' then
    raise exception 'the reveal should show the class held at the start and the silent Turn: %', entry;
  end if;
  if said::text like '%' || ann || '%' then raise exception 'the reveal named a player'; end if;
  -- The next season is open, from the instant the last ended, and nothing is due yet.
  if (select count(*) from seasons where ends_at is null) <> 1 then raise exception 'one season is open after the reveal'; end if;
  if (select starts_at from seasons where ends_at is null) <> (select max(ends_at) from seasons) then raise exception 'the next season opens as the last ends'; end if;
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
