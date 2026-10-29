-- Every screen's per-view read is bounded by the page, never by an instance's history (the screens'
-- web plan, review of PR #24): a board's thread count, the number of debuted characters and a
-- character's place are counters or index ranges, and each read a screen makes is served by an index.
-- supabase/migrations/0030_screens_reads.sql (boards.thread_count, debuted_count, standing_place) and
-- 0003's standings (the new index standings_season_amount).
--
-- The plans are EXPLAINed with the sequential scan off, as in 0034: on a table this small the planner
-- scans whatever the indexes are, so the question is whether an index can serve the read at all. A plan
-- that still says "Seq Scan on acts|threads|characters|standings" has no index to use. The last block
-- withholds the index and the counters and shows that the same checks go red.

create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare ln record; out text := '';
begin
  for ln in execute 'explain ' || q loop out := out || E'\n' || ln."QUERY PLAN"; end loop;
  return out;
end $$;

-- The plan names a sequential scan of one of the tables whose size grows with an instance's history.
create function pg_temp.scans(plan text) returns boolean language sql as $$
  select plan ~ 'Seq Scan on (acts|threads|characters|standings|boards)\y'
$$;

-- ---- a board's thread count is a counter, kept by a trigger and backfilled ----
do $$
declare
  general uuid := (select id from boards where slug = 'general');
  system uuid := (select id from boards where slug = 'the-system');
  before_general integer := (select thread_count from boards where slug = 'general');
begin
  perform tests.thread('Bounded one');
  perform tests.thread('Bounded two');
  if (select thread_count from boards where id = general) is distinct from before_general + 2 then raise exception 'a thread started on a board counts: %', (select thread_count from boards where id = general); end if;
  if (select thread_count from boards where id = system) is distinct from (select count(*)::integer from threads where board = system) then raise exception 'another board''s count does not move'; end if;
  -- Zeroed and replayed, the backfill says what the trigger kept.
  update boards set thread_count = 0;
  perform backfill_board_counts();
  if exists (select 1 from boards b where b.thread_count is distinct from (select count(*)::integer from threads t where t.board = b.id)) then
    raise exception 'the backfill counts every board''s threads: %', (select jsonb_agg(to_jsonb(b)) from boards b);
  end if;
end $$;

-- ---- the number of debuted characters is a counter, kept by a trigger and backfilled ----
do $$
declare
  ann uuid := tests.account('bd-ann');
  start_n integer := (select characters from debuted_count);
  waiting uuid;
begin
  if start_n is distinct from (select count(*)::integer from characters where debuted_at is not null) then raise exception 'the counter starts at the debuted characters: %', start_n; end if;
  perform tests.character(ann, 'Bd Debuted');
  if (select characters from debuted_count) is distinct from start_n + 1 then raise exception 'a character created debuted counts'; end if;
  insert into characters (owner, name, created_at) values (ann, 'Bd Waiting', now()) returning id into waiting;
  if (select characters from debuted_count) is distinct from start_n + 1 then raise exception 'a character waiting to debut does not count'; end if;
  update characters set debuted_at = now() where id = waiting;
  if (select characters from debuted_count) is distinct from start_n + 2 then raise exception 'a character that debuts counts, once'; end if;
  update characters set retired_at = now() where id = waiting;
  update characters set debuted_at = now() where id = waiting;
  if (select characters from debuted_count) is distinct from start_n + 2 then raise exception 'a change that does not debut it moves nothing'; end if;
  update debuted_count set characters = 0;
  perform backfill_debuted_count();
  if (select characters from debuted_count) is distinct from (select count(*)::integer from characters where debuted_at is not null) then raise exception 'the backfill counts the debuted characters'; end if;
  if (select count(*) from debuted_count) is distinct from 1::bigint then raise exception 'one counter row, always'; end if;
end $$;

-- ---- standing_place agrees with the ranking it replaces, ties and negatives included ----
do $$
declare
  ann uuid := tests.account('sp-ann');
  bob uuid := tests.account('sp-bob');
  top uuid := tests.character(ann, 'Sp Top');
  tied_a uuid := tests.character(bob, 'Sp Tied A');
  tied_b uuid := tests.character(bob, 'Sp Tied B');
  nothing uuid := tests.character(ann, 'Sp Nothing');
  zero_row uuid := tests.character(ann, 'Sp Zero Row');
  owes uuid := tests.character(bob, 'Sp Owes');
  owes_more uuid := tests.character(bob, 'Sp Owes More');
  owes_same uuid := tests.character(ann, 'Sp Owes Same');
  waiting uuid;
  open_season bigint := (select id from seasons where ends_at is null);
  r record;
  got jsonb;
  total integer;
  why text;
begin
  insert into standings (character, season, amount) values
    (top, open_season, 900), (tied_a, open_season, 300), (tied_b, open_season, 300), (zero_row, open_season, 0),
    (owes, open_season, -200), (owes_more, open_season, -700), (owes_same, open_season, -200);
  insert into characters (owner, name, created_at) values (ann, 'Sp Waiting', now()) returning id into waiting;
  select count(*) into total from season_standings;

  perform tests.become(bob);
  perform auth.assert_impersonating();
  -- Every debuted character, against the view that ranks them all.
  for r in select * from season_standings loop
    got := standing_place(r.character);
    if got is distinct from jsonb_build_object('standing', r.standing, 'place', r.place, 'of', total) then
      raise exception 'standing_place of % is % but the ranking says standing %, place %, of %', r.name, got, r.standing, r.place, total;
    end if;
  end loop;
  -- The cases by name: ties share a place; no row stands at 0; a debt stands below every character with no row.
  if (standing_place(tied_b) ->> 'place')::integer is distinct from 2 then raise exception 'ties share the place above them'; end if;
  if (standing_place(nothing) ->> 'standing')::integer is distinct from 0 then raise exception 'no row stands at 0'; end if;
  if (standing_place(owes) ->> 'place')::integer is distinct from (select count(*) from season_standings where standing >= 0) + 1 then raise exception 'a negative standing is below every standing at or above 0, the characters with no row among them: %', standing_place(owes); end if;
  if (standing_place(owes_same) ->> 'place')::integer is distinct from (standing_place(owes) ->> 'place')::integer then raise exception 'equal debts share a place'; end if;
  if (standing_place(owes_more) ->> 'place')::integer is distinct from (standing_place(owes) ->> 'place')::integer + 2 then raise exception 'a larger debt is below the two smaller ones'; end if;
  -- A character waiting to debut and a character that does not exist answer alike (nothing), so the answer proves neither.
  if standing_place(waiting) is not null or standing_place(gen_random_uuid()) is not null then raise exception 'a waiting or unknown character has no standing'; end if;
  perform tests.unbecome();

  -- A visitor does not read it.
  perform tests.become_anon();
  why := null;
  begin perform standing_place(top); exception when insufficient_privilege then why := 'refused'; end;
  if why is distinct from 'refused' then raise exception 'a visitor read a standing'; end if;
  perform tests.unbecome();

  -- Its row is the function's: the counter and the standings are not tables a player reads.
  perform tests.become(bob);
  why := null;
  begin perform 1 from debuted_count; exception when insufficient_privilege then why := 'refused'; end;
  if why is distinct from 'refused' then raise exception 'a player read the counter table'; end if;
  if (select characters from season_size) is distinct from total then raise exception 'the season size is the counter: %', (select characters from season_size); end if;
  perform tests.unbecome();
end $$;

-- ---- every per-view read is served by an index ----
do $$
declare
  ann uuid := tests.account('ix-ann');
  a uuid := tests.character(ann, 'Ix Ann');
  th uuid := tests.thread('Indexed');
  open_season bigint := (select id from seasons where ends_at is null);
  board_id uuid := (select board from threads where id = th);
  plan text;
  q text;
  mine integer := 50;
  fn text := (select prosrc from pg_proc where proname = 'standing_place');
begin
  perform tests.post(a, th, 'One');
  insert into standings (character, season, amount) values (a, open_season, mine);
  set local enable_seqscan = off;

  -- A page of postbits' standings: the standings' primary key, one probe per character.
  plan := pg_temp.plan_of(format('select character, amount from standings where season = %s and character in (%L, %L)', open_season, a, gen_random_uuid()));
  if pg_temp.scans(plan) or plan not like '%standings_pkey%' then raise exception 'a page of postbits'' standings is not read from standings_pkey: %', plan; end if;

  -- A profile's place: the two ranges standing_place counts, both from the (season, amount) index alone.
  foreach q in array array[
    format('select count(*) from standings s where s.season = %s and s.amount > %s', open_season, mine),
    format('select count(*) from standings s where s.season = %s and s.amount <= %s', open_season, -mine)
  ] loop
    plan := pg_temp.plan_of(q);
    if pg_temp.scans(plan) or plan not like '%standings_season_amount%' then raise exception 'a character''s place is not counted from standings_season_amount: %', plan; end if;
  end loop;
  -- The function counts exactly those two ranges (a rewrite that counts characters or ranks them all has to change this file).
  if fn not like '%s.amount > mine%' or fn not like '%s.amount <= mine%' or fn like '%rank()%' or fn like '%season_standings%' then
    raise exception 'standing_place counts the two index ranges and the counter, and nothing else: %', fn;
  end if;

  -- A board's page: its counter is one row of boards, its threads the (board, last_at) index (0034 reads the list itself).
  plan := pg_temp.plan_of(format('select thread_count from boards where id = %L', board_id));
  if pg_temp.scans(plan) then raise exception 'a board''s thread count is read from its row: %', plan; end if;
  plan := pg_temp.plan_of(format('select * from thread_list where board = %L order by last_at desc limit 20 offset 20', board_id));
  if pg_temp.scans(plan) or plan not like '%threads_board_last_at%' then raise exception 'a board''s page is not read from threads_board_last_at: %', plan; end if;

  -- A profile's latest rows and a record's page: the character's Acts by time, with no count.
  plan := pg_temp.plan_of(format('select * from acts_public where character = %L and kind in (%L, %L, %L) order by created_at desc limit 5', a, 'post', 'spin', 'card'));
  if pg_temp.scans(plan) or plan not like '%acts_character%' then raise exception 'a character''s latest Acts are not read from acts_character: %', plan; end if;
  plan := pg_temp.plan_of(format('select character, posts, spins, cards from character_post_counts where character = %L', a));
  if pg_temp.scans(plan) then raise exception 'a character''s counts are not read from its row: %', plan; end if;
  plan := pg_temp.plan_of('select characters from season_size');
  if plan ~ 'Seq Scan on characters' then raise exception 'the season size is read from the counter, never counted: %', plan; end if;

  -- The standings screen is the one read that ranks everyone, a page of it at a time. Its plan reads every
  -- debuted character (a window over all of them), which is the screen's job; it is not asserted bounded.

  -- The checks above go red when the index is withheld: with standings_season_amount dropped, the same
  -- count is served by the season's primary-key range plus a filter (every row of the season), and the
  -- plan no longer names the index, which is what the check looks for.
  drop index standings_season_amount;
  plan := pg_temp.plan_of(format('select count(*) from standings s where s.season = %s and s.amount > %s', open_season, mine));
  if plan like '%standings_season_amount%' then raise exception 'the index is dropped and the plan still names it, so the check above cannot tell: %', plan; end if;
  set local enable_seqscan = on;
end $$;
