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
  if said - 'takes_effect_at' <> '{"pending": true, "class": "beta", "loudness": "announced", "show_from": false, "show_to": false}' or not said ? 'takes_effect_at' then raise exception 'a Turn waits, and says so to its player: %', said; end if;
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

-- ---- The reveal: every character in order of final standing, with its place and standing, and
-- only what its player made public in the season: its reveals and its announced Turns, an old class
-- where the Turn named it. Unrevealed classes and silent Turns roll over; who plays them, never
-- (supabase/migrations/0029_reveal_rolls_over.sql; the class reveal plan, Task 3) ----
do $$
declare
  ann uuid := tests.account('rev-ann');
  bob uuid := tests.account('rev-bob');
  a uuid := tests.character(ann, 'Revealed One', 'alpha', now() - interval '200 days');
  m uuid := tests.character(ann, 'Made Midseason', 'beta', now() - interval '50 days');
  says uuid := tests.character(bob, 'Says It All', 'alpha', now() - interval '200 days');
  t uuid := tests.thread('Where it was said');
  next_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_start timestamptz := next_start + interval '1 day' - interval '3 months';
  told_at timestamptz := next_start - interval '2 days';
  settled jsonb;
  reveal uuid;
  in_thread uuid;
  entry jsonb;
  unmasked jsonb;
  tally uuid;
  cast_size integer;
  standings_in_order boolean;
begin
  -- The open season's three months run out at the next window's end; a silent Turn in it ten days before.
  update settings set value = '{"unit": "month", "count": 3}' where key = 'seasonLength';
  update seasons set starts_at = season_start where ends_at is null;
  insert into class_history (character, class_key, started_at) values (a, 'beta', next_start - interval '10 days');
  -- Bob's character reveals itself in the season, then Turns, announced naming both classes, which
  -- writes its unmask at the tally's instant, after the tally.
  unmasked := write_unmask(says, t, 'act', season_start + interval '1 day', 'Alpha, and proud.');
  perform tests.become(bob);
  perform turn(says, 'beta', 'announced', true, true);
  perform tests.unbecome();
  update pending_turns set asked_at = told_at - interval '1 hour' where character = says;
  tally := masks_change(told_at);
  -- Outside the season, and so in no part of its reveal: a reveal and an announced Turn before it
  -- began, and a reveal and a tally at the very instant it ends, which are the next season's.
  perform write_unmask(says, t, 'act', season_start - interval '1 day', 'Before.');
  insert into acts (character, kind, thread, payload, created_at)
  select null, 'tally', in_season.turns_thread, jsonb_build_object('season', in_season.number, 'part', 1, 'of', 1, 'debuts', '[]'::jsonb,
      'turns', jsonb_build_array(jsonb_build_object('character', says, 'name', 'Says It All', 'loudness', 'announced', 'was', 'gamma', 'since', season_start))), x.at
  from seasons in_season, (values (season_start - interval '1 day'), (next_start + interval '1 day')) x(at) where in_season.ends_at is null;
  perform write_unmask(says, t, 'act', next_start + interval '1 day', 'At the end.');
  -- Final standings: Made Midseason first, then Says It All, then Revealed One.
  insert into standings (character, season, amount) select x.c, s.id, x.amount from seasons s, (values (m, 30), (says, 20), (a, 10)) x(c, amount)
  where s.ends_at is null on conflict (season, character) do update set amount = excluded.amount;
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
  -- In order of final standing, each with its place.
  select bool_and(ok) into standings_in_order from (
    select (payload ->> 'standing')::integer <= coalesce(lag((payload ->> 'standing')::integer) over (order by seq), 2147483647)
       and (payload ->> 'place')::integer >= coalesce(lag((payload ->> 'place')::integer) over (order by seq), 1) as ok
    from acts where thread = in_thread and kind = 'reveal' and id <> reveal) o;
  if not standings_in_order then raise exception 'the reveal''s characters are in order of final standing'; end if;
  if (select array_agg(payload ->> 'name' order by seq) from acts where thread = in_thread and payload ->> 'character' in (a::text, m::text, says::text))
     is distinct from array['Made Midseason', 'Says It All', 'Revealed One'] then
    raise exception 'the reveal''s characters are in order of final standing';
  end if;
  -- A character whose player made nothing public: its place and standing, and no class. A silent Turn appears nowhere.
  select payload into entry from acts where thread = in_thread and payload ->> 'character' = a::text;
  if entry - 'place' is distinct from jsonb_build_object('season', (settled ->> 'revealed')::integer, 'character', a, 'name', 'Revealed One', 'standing', 10, 'shown', '[]'::jsonb) then
    raise exception 'a character whose player made nothing public is revealed with its place and standing alone: %', entry;
  end if;
  if (entry ->> 'place')::integer is distinct from (select count(*) + 1 from standings s where s.season = (select id from seasons where number = (settled ->> 'revealed')::integer) and s.amount > 10)::integer then
    raise exception 'its place is its rank by final standing: %', entry;
  end if;
  if exists (select 1 from acts where thread = in_thread and payload::text like '%beta%' and payload ->> 'character' <> says::text) then raise exception 'the reveal said what a silent Turn took'; end if;
  select payload into entry from acts where thread = in_thread and payload ->> 'character' = m::text;
  if entry -> 'shown' is distinct from '[]'::jsonb or entry ? 'classes' then raise exception 'a character made mid-season with nothing public shows nothing: %', entry; end if;
  -- What its player made public, dated, in order: the reveal, then the Turn announced with its old class.
  select payload into entry from acts where thread = in_thread and payload ->> 'character' = says::text;
  -- At one instant, the Turn's tally before the unmask it wrote, as they stand in the thread.
  if entry -> 'shown' is distinct from jsonb_build_array(
       jsonb_build_object('kind', 'reveal', 'act', unmasked ->> 'id', 'at', season_start + interval '1 day', 'class', 'alpha', 'via', 'act'),
       jsonb_build_object('kind', 'turn', 'act', tally, 'at', told_at, 'was', 'alpha', 'since', season_start),
       jsonb_build_object('kind', 'reveal', 'act', (select id from acts where kind = 'unmask' and character = says and payload ->> 'via' = 'turn'), 'at', told_at, 'class', 'beta', 'via', 'turn')) then
    raise exception 'the reveal shows what its player made public in the season, dated, in order: %', entry -> 'shown';
  end if;
  if exists (select 1 from acts where thread = in_thread and (payload::text like '%' || ann || '%' or payload::text like '%' || bob || '%')) then raise exception 'the reveal named a player'; end if;
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
