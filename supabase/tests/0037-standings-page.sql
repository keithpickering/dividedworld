-- A page of the season's standings costs the page, never the season (the screens' web plan, review of
-- PR #24): standings_page (supabase/migrations/0030_screens_reads.sql) gives the rows season_standings
-- (0021) gives, in its order and with its places, without ranking every debuted character. It reads
-- one range of standings_season_amount, which holds a row for every debuted character in the season
-- the standings read (the roster: a debut and a new season write the rows), so the characters with
-- nothing settled are rows at 0 like any other and no page walks the characters to find them.
--
-- The race comes first, before this file's own transaction has debuted anyone: the roster's lock is
-- taken by every debut, and a season opened here would wait for this file's transaction itself.

-- ---- a character that debuts while a season opens has its row in the new season ----
-- A debut and a new season's roster run in different transactions. The season's roster reads the
-- debuted characters; a debut that has not committed yet is not among them, and its own row went to
-- the season it could see. So the roster waits for the debuts in flight, and a debut that comes after
-- waits for the new season to commit. Here the debut is held open (session a) while a season opens
-- (session b); without the wait, b's roster misses a's character and the new season has no row for it.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  tries integer := 0;
  has_row boolean;
begin
  perform tests.commit($sql$
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000b1', 'roster-race@test.invalid');
    insert into accounts (id) values ('00000000-0000-4000-8000-0000000000b1');
  $sql$);
  perform extensions.dblink_connect('roster_a', url);
  perform extensions.dblink_connect('roster_b', url);
  perform extensions.dblink_exec('roster_a', 'begin');
  perform extensions.dblink_exec('roster_a', $sql$insert into characters (owner, name, debuted_at) values ('00000000-0000-4000-8000-0000000000b1', 'Roster Race', now())$sql$);
  perform extensions.dblink_exec('roster_b', 'begin');
  perform extensions.dblink_send_query('roster_b', $sql$do $b$ begin
    set local lock_timeout = '20s';
    update seasons set ends_at = clock_timestamp() where ends_at is null;
    insert into seasons (number, starts_at) select max(number) + 1, clock_timestamp() from seasons;
  end $b$ $sql$);
  -- b has either finished (it did not wait) or is waiting on a lock, before a commits.
  loop
    exit when extensions.dblink_is_busy('roster_b') = 0
      or exists (select 1 from pg_locks l where not l.granted and l.database = (select oid from pg_database where datname = current_database()));
    tries := tries + 1;
    if tries > 400 then raise exception 'the season''s session neither finished nor waited'; end if;
    perform pg_sleep(0.025);
  end loop;
  perform extensions.dblink_exec('roster_a', 'commit');
  perform * from extensions.dblink_get_result('roster_b') as r(status text);
  perform * from extensions.dblink_get_result('roster_b') as r(status text);
  select x.has into has_row from extensions.dblink('roster_b', $sql$
    select exists (select 1 from standings s join characters c on c.id = s.character
                   where c.name = 'Roster Race' and s.season = (select id from seasons where ends_at is null))
  $sql$) as x(has boolean);
  -- b never commits: the new season was only ever b's.
  perform extensions.dblink_exec('roster_b', 'rollback');
  perform extensions.dblink_disconnect('roster_a');
  perform extensions.dblink_disconnect('roster_b');
  if not has_row then raise exception 'a character that debuted while a season opened has no row in the new season''s standings'; end if;
end $$;

-- The ranking as season_standings lists it, ordered by place and then name, read as the view's owner: no
-- client reads the view (0030 revokes it), so the comparison takes it before turning back into the player.
create function pg_temp.ranked() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(x.character, x.name, x.standing, x.place) order by x.place, x.name), '[]') from season_standings x
$$;
-- The page of that ranking standings_page(o, l) should be, and what it is, as two values.
create function pg_temp.page_wanted(ranked jsonb, o integer, l integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e order by i), '[]') from jsonb_array_elements(ranked) with ordinality r(e, i) where i > o and i <= o + l
$$;
create function pg_temp.page_got(o integer, l integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(p.character, p.name, p.standing, p.place) order by p.n), '[]')
  from standings_page(o, l) with ordinality as p(character, name, standing, place, n)
$$;
-- Every page of every size from 1 to 7, and one past the end, read as the player `who` against the ranking.
create function pg_temp.every_page(why text, who uuid) returns void language plpgsql as $$
declare
  ranked jsonb;
  total integer;
  l integer;
  o integer;
begin
  perform tests.unbecome();
  ranked := pg_temp.ranked();
  total := jsonb_array_length(ranked);
  perform tests.become(who);
  for l in 1..7 loop
    o := 0;
    while o <= total + l loop
      if pg_temp.page_got(o, l) is distinct from pg_temp.page_wanted(ranked, o, l) then
        raise exception '%: the page at offset % of % rows is % but the ranking says %', why, o, l, pg_temp.page_got(o, l), pg_temp.page_wanted(ranked, o, l);
      end if;
      o := o + l;
    end loop;
  end loop;
end $$;

-- ---- standings_page is season_standings, a page at a time ----
do $$
declare
  ann uuid := tests.account('pg-ann');
  bob uuid := tests.account('pg-bob');
  open_season bigint := (select id from seasons where ends_at is null);
  top uuid := tests.character(ann, 'Pg Top');
  tied_a uuid := tests.character(bob, 'Pg Tied A');
  tied_b uuid := tests.character(bob, 'Pg Tied B');
  tied_c uuid := tests.character(ann, 'Pg Tied C');
  zero_row uuid := tests.character(ann, 'Pg Zero Settled');
  nothing_a uuid := tests.character(ann, 'Pg Nothing A');
  nothing_b uuid := tests.character(bob, 'Pg Nothing B');
  owes uuid := tests.character(bob, 'Pg Owes');
  owes_same uuid := tests.character(ann, 'Pg Owes Same');
  owes_more uuid := tests.character(bob, 'Pg Owes More');
  waiting uuid;
  i integer;
  got jsonb;
  total integer;
  why text;
begin
  -- Settled as a settlement settles them: an upsert onto whatever row the character has.
  insert into standings (character, season, amount) values
    (top, open_season, 900), (tied_a, open_season, 300), (tied_b, open_season, 300), (tied_c, open_season, 300), (zero_row, open_season, 0),
    (owes, open_season, -200), (owes_same, open_season, -200), (owes_more, open_season, -700)
  on conflict (season, character) do update set amount = excluded.amount;
  -- A crowd with ties at every amount, some with nothing settled at all.
  for i in 1..30 loop
    perform tests.character(tests.account(format('pg-crowd-%s', i)), format('Pg Crowd %s', lpad(i::text, 2, '0')));
  end loop;
  insert into standings (character, season, amount)
  select c.id, open_season, ((substr(c.name, 10)::integer % 7) - 3) * 100 from characters c where c.name like 'Pg Crowd %' and substr(c.name, 10)::integer % 5 <> 0
  on conflict (season, character) do update set amount = excluded.amount;
  insert into characters (owner, name, created_at) values (ann, 'Pg Waiting', now()) returning id into waiting;
  select count(*) into total from season_standings;

  perform tests.become(bob);
  perform auth.assert_impersonating();
  perform pg_temp.every_page('the open season', bob);
  -- The cases by name: three tied at 300 split over pages of two share place 2; no row and a settled 0 alike stand at 0; debts last.
  if pg_temp.page_got(1, 2) -> 1 ->> 3 is distinct from '2' or pg_temp.page_got(3, 2) -> 0 ->> 3 is distinct from '2' then
    raise exception 'ties split across a page boundary share their place: % then %', pg_temp.page_got(1, 2), pg_temp.page_got(3, 2);
  end if;
  if not exists (select 1 from standings_page(0, 1000) p where p.character = nothing_a and p.standing = 0) then raise exception 'a debuted character with nothing settled is listed at 0'; end if;
  if (select p.character from standings_page(total - 1, 1) p) is distinct from owes_more then raise exception 'the largest debt is last'; end if;
  if exists (select 1 from standings_page(0, 1000) p where p.character = waiting) then raise exception 'a character waiting to debut is listed'; end if;
  if pg_temp.page_got(total, 5) <> '[]' or pg_temp.page_got(total + 100, 5) <> '[]' then raise exception 'a page past the end is empty'; end if;
  if pg_temp.page_got(0, 0) <> '[]' then raise exception 'a page of no rows is empty'; end if;
  if jsonb_array_length(pg_temp.page_got(0, 5000)) > 1000 then raise exception 'a page is at most 1,000 rows, however many are asked for'; end if;
  perform tests.unbecome();

  -- A character that debuts later is listed, at 0; a renamed one moves to its new name's place among its ties.
  update characters set debuted_at = now() where id = waiting;
  update characters set name = 'Pg Tied 0', name_key = name_skeleton('Pg Tied 0'), name_look = name_look('Pg Tied 0') where id = tied_c;
  perform tests.become(bob);
  perform pg_temp.every_page('after a debut and a rename', bob);
  if (select p.n from standings_page(0, 1000) with ordinality p(c, nm, st, pl, n) where p.c = tied_a)
     is distinct from 1 + (select p.n from standings_page(0, 1000) with ordinality p(c, nm, st, pl, n) where p.c = tied_c) then
    raise exception 'a renamed character is ordered by its new name, just ahead of Pg Tied A: %', pg_temp.page_got(0, 8);
  end if;
  perform tests.unbecome();

  -- A new season, nothing settled: every debuted character at 0, all in first place.
  update seasons set ends_at = greatest(now(), starts_at + interval '1 second') where id = open_season;
  insert into seasons (number, starts_at) select max(number) + 1, greatest(now(), (select ends_at from seasons where id = open_season)) from seasons;
  perform tests.become(bob);
  perform pg_temp.every_page('a new season', bob);
  if exists (select 1 from standings_page(0, 1000) p where p.standing <> 0 or p.place <> 1) then raise exception 'a season with nothing settled has everyone at 0, in first place'; end if;
  if (select count(*) from standings_page(0, 1000)) is distinct from (select characters::bigint from season_size) then raise exception 'a new season lists every debuted character: % of %', (select count(*) from standings_page(0, 1000)), (select characters from season_size); end if;
  perform tests.unbecome();

  -- Between seasons, the one that ended last, as it stood.
  update seasons set ends_at = greatest(now(), starts_at + interval '1 second') + interval '1 second' where ends_at is null;
  perform tests.become(bob);
  perform pg_temp.every_page('between seasons', bob);
  perform tests.unbecome();

  -- A visitor does not read it.
  perform tests.become_anon();
  why := null;
  begin perform standings_page(0, 5); exception when insufficient_privilege then why := 'refused'; end;
  if why is distinct from 'refused' then raise exception 'a visitor read the standings'; end if;
  perform tests.unbecome();
end $$;

-- ---- a page reads the page, from the index, and never ranks the season ----
-- The function's own body, its parameters set, EXPLAINed: with the sequential scan off (as in 0034 and
-- 0036) for whether an index can serve it at all, and ANALYZEd over a season of 400 characters for how
-- many rows it touches. A page of 10 at offset 50 touches the 60 rows up to its end (index-only), and the
-- rows ahead of its first one when that one's place must be counted; never the 400.
do $$
declare
  open_season bigint := standings_season();  -- the block above left the instance between seasons
  body text := (select prosrc from pg_proc where proname = 'standings_page');
  plan text;
  analyzed jsonb;
  touched bigint;
  ln record;
begin
  -- A player runs a few characters at most, so the season is 400 players' one each.
  perform tests.character(tests.account(format('px-%s', g)), format('Px %s', lpad(g::text, 3, '0'))) from generate_series(1, 400) g;
  insert into standings (character, season, amount)
  select c.id, open_season, (substr(c.name, 4)::integer / 3) from characters c where c.name like 'Px %'
  on conflict (season, character) do update set amount = excluded.amount;
  analyze standings;
  analyze characters;
  set local enable_seqscan = off;
  body := replace(replace(body, 'page_offset', '50'), 'page_limit', '10');

  plan := '';
  for ln in execute 'explain ' || body loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan ~ 'Seq Scan on (standings|characters)\y' or plan not like '%standings_season_amount%' then
    raise exception 'a page of the standings is not read from standings_season_amount: %', plan;
  end if;
  if plan ~ '\ycharacters\y' then raise exception 'a page of the standings reads the characters (the ranking''s join): %', plan; end if;

  execute 'explain (analyze, format json) ' || body into analyzed;
  -- Every row any scan of standings or characters returned, over all its loops.
  select coalesce(sum((n ->> 'Actual Rows')::numeric * (n ->> 'Actual Loops')::numeric), 0)::bigint into touched
  from jsonb_path_query(analyzed, 'strict $.**') n
  where jsonb_typeof(n) = 'object' and n ->> 'Relation Name' in ('standings', 'characters');
  if touched > 2 * 60 then raise exception 'a page of 10 at offset 50 touched % rows of a season of 400: %', touched,
    (select jsonb_agg(jsonb_build_object('node', n ->> 'Node Type', 'index', n ->> 'Index Name', 'rows', n -> 'Actual Rows', 'loops', n -> 'Actual Loops', 'cond', n -> 'Index Cond'))
     from jsonb_path_query(analyzed, 'strict $.**') n where jsonb_typeof(n) = 'object' and n ->> 'Relation Name' in ('standings', 'characters')); end if;

  -- The checks go red without the index: the same body is served by the season's primary-key range,
  -- every row of the season sorted, and the plan no longer names the index the check looks for.
  drop index standings_season_amount;
  plan := '';
  for ln in execute 'explain ' || body loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan like '%standings_season_amount%' then raise exception 'the index is dropped and the plan still names it, so the check above cannot tell: %', plan; end if;
  set local enable_seqscan = on;
end $$;
