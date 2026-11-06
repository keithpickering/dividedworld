-- A season's results (supabase/migrations/0099_season_results.sql; docs/plans/2026-11-06-season-end-design.md, sections 1 to 3): the season's end
-- writes no post. It freezes the season as one row per character in season_results, the names as they stood, the places, the standings and what
-- each player made public; the rows are never edited or removed; Season News, the profile and the record read them; the screens read a past season
-- 50 rows at a time. The reveal Acts a season's end used to write are copied into the table once, for a database that predates it.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing relation below).
do $$
begin
  if to_regclass('season_results') is null then raise exception 'season_results exists'; end if;
  if to_regprocedure('results_page(integer,integer)') is null or to_regprocedure('result_place(integer,uuid)') is null or to_regprocedure('finished_seasons()') is null then
    raise exception 'the three reads exist';
  end if;
end $$;

-- ---- A seed: a Boss, the stock lines, a day-long season that began long ago ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'rosterRecentExcluded', 1,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sr-a',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'sr-a', 'name', 'Sr A', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'sr-b', 'name', 'Sr B', 'title', 'Boss', 'signature', 'b')),
      'firstStaff', '[]'::jsonb, 'moves', '[]'::jsonb, 'demands', '[]'::jsonb)));
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

create table pg_temp.sr (spritey uuid, pipe uuid, gloom uuid, hooli uuid, season_id bigint, threads_before bigint, ended timestamptz);

-- ---- A season played and ended: one row per debuted character, in standing order, with names as they stood ----
do $$
declare
  ann uuid := tests.account('sr-ann');
  bob uuid := tests.account('sr-bob');
  cat uuid := tests.account('sr-cat');
  t0 timestamptz := (select starts_at from seasons where ends_at is null);
  in_season bigint := (select id from seasons where ends_at is null);
  sprit uuid; gloom uuid; hooli uuid; pipe uuid;
  th uuid := tests.thread('Chatter');
  rolled jsonb;
  before_threads bigint;
  before_reveals bigint := (select count(*) from acts where kind = 'reveal');
  ended timestamptz;
begin
  sprit := tests.character(ann, 'Spritey', 'alpha', t0 + interval '1 hour');
  pipe := tests.character(ann, 'Pipewrench', 'alpha', t0 + interval '1 hour');
  gloom := tests.character(bob, 'Gloomba', 'alpha', t0 + interval '1 hour');
  hooli := tests.character(cat, 'Mrs. Hooligan', 'alpha', t0 + interval '1 hour');
  -- Spritey's player revealed its class in the season; Gloomba's Turned silently (to beta) and made nothing public; Pipewrench's Turn was announced.
  perform write_unmask(sprit, th, 'act', t0 + interval '2 hours', 'Alpha, and proud.');
  insert into class_history (character, class_key, started_at) values (gloom, 'beta', t0 + interval '5 hours');
  insert into standings (character, season, amount) values (sprit, in_season, 650), (gloom, in_season, 400), (hooli, in_season, 300), (pipe, in_season, 100)
  on conflict (season, character) do update set amount = excluded.amount;
  perform post_tally(in_season, '[]'::jsonb, jsonb_build_array(jsonb_build_object('character', pipe, 'name', 'Pipewrench', 'loudness', 'revealed', 'was', 'alpha', 'since', t0)), t0 + interval '4 hours');
  before_threads := (select count(*) from threads);
  ended := t0 + interval '1 day';
  rolled := reveal_season(ended);
  if rolled is null then raise exception 'the season did not roll over'; end if;
  if (rolled ->> 'results')::integer is distinct from 4 or (rolled ->> 'season')::integer is distinct from 1 or rolled ? 'thread' or rolled ? 'act' then
    raise exception 'the season''s end answers its season and the rows it wrote: %', rolled;
  end if;
  insert into pg_temp.sr values (sprit, pipe, gloom, hooli, in_season, before_threads, ended);
  if (select count(*) from threads) is distinct from before_threads then raise exception 'a season''s end opens no thread'; end if;
  if (select count(*) from acts where kind = 'reveal') is distinct from before_reveals then raise exception 'a season''s end writes no reveal Act'; end if;
  if (select reveal_act from seasons where id = in_season) is not null then raise exception 'the season points at no reveal Act'; end if;
  if (select results_at from seasons where id = in_season) is distinct from now() then raise exception 'the results landed in this transaction: %', (select results_at from seasons where id = in_season); end if;
  if (select results_at from seasons where ends_at is null) is not null then raise exception 'the season just opened has no results'; end if;
end $$;

do $$
declare f pg_temp.sr;
begin
  select * into f from pg_temp.sr;
  if (select array_agg(name order by place, name) from season_results where season = f.season_id) is distinct from array['Spritey', 'Gloomba', 'Mrs. Hooligan', 'Pipewrench'] then
    raise exception 'one row per character, by final standing: %', (select jsonb_agg(to_jsonb(r)) from season_results r where season = f.season_id);
  end if;
  if (select array_agg(place order by place) from season_results where season = f.season_id) is distinct from array[1, 2, 3, 4] then raise exception 'places'; end if;
  if (select array_agg(standing order by place) from season_results where season = f.season_id) is distinct from array[650, 400, 300, 100] then raise exception 'standings'; end if;
  -- Spritey's reveal is public; Pipewrench's announced Turn is public with the class it left; Gloomba's silent Turn is nowhere.
  if (select jsonb_array_length(shown) from season_results where character = f.spritey) is distinct from 1
     or (select shown #>> '{0,class}' from season_results where character = f.spritey) is distinct from 'alpha' then raise exception 'the reveal is in shown'; end if;
  if (select shown #>> '{0,kind}' || (shown #>> '{0,was}') from season_results where character = f.pipe) is distinct from 'turnalpha' then raise exception 'an announced Turn is in shown with the class it left'; end if;
  if (select shown from season_results where character = f.gloom) is distinct from '[]'::jsonb or (select shown from season_results where character = f.hooli) is distinct from '[]'::jsonb then
    raise exception 'a silent Turn and a quiet season show nothing';
  end if;
  if exists (select 1 from season_results where season = f.season_id and to_jsonb(season_results)::text like '%beta%') then raise exception 'the silent Turn took its class into the results'; end if;
  -- A rename afterwards leaves the row as the season ended.
  update characters set name = 'Spritey Renamed' where id = f.spritey;
  if (select name from season_results where character = f.spritey) is distinct from 'Spritey' then raise exception 'a rename changed a frozen name'; end if;
  if (select name from standings where character = f.spritey and season = f.season_id) is not distinct from 'Spritey' then raise exception 'the fixture is wrong: the standings follow renames'; end if;
  update characters set name = 'Spritey' where id = f.spritey;
end $$;

-- ---- Rows are never edited or removed, not even with triggers off in the session ----
do $$
declare f pg_temp.sr; why text;
begin
  select * into f from pg_temp.sr;
  why := pg_temp.refusal(format('update season_results set standing = 0 where character = %L', f.spritey));
  if why is null or why not like '%season_results%' then raise exception 'update refused by the guard: %', why; end if;
  why := pg_temp.refusal(format('delete from season_results where character = %L', f.spritey));
  if why is null or why not like '%season_results%' then raise exception 'delete refused by the guard: %', why; end if;
  why := pg_temp.refusal('truncate season_results');
  if why is null or why not like '%season_results%' then raise exception 'truncate refused by the guard: %', why; end if;
  set local session_replication_role = replica;
  why := pg_temp.refusal(format('update season_results set standing = 0 where character = %L', f.spritey));
  set local session_replication_role = origin;
  if why is null then raise exception 'a session in replica mode edited a result'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'season_results'::regclass and not tgisinternal and tgenabled = 'A') is distinct from 2 then
    raise exception 'both guards fire always';
  end if;
  if has_table_privilege('authenticated', 'season_results', 'insert') or has_table_privilege('authenticated', 'season_results', 'update') or has_table_privilege('authenticated', 'season_results', 'delete')
     or not has_table_privilege('authenticated', 'season_results', 'select') or has_table_privilege('anon', 'season_results', 'select') then
    raise exception 'players read the results and write none; visitors read none';
  end if;
end $$;

-- ---- apply_settlement reads only the season's number from a reveal ----
do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'apply_settlement') !~ 'revealed'
     or (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'apply_settlement') ~ 'reveal_act|season_results' then
    raise exception 'apply_settlement reads only the revealed season''s number';
  end if;
end $$;

-- ---- Season News: the results item, from the table ----
do $$
declare f pg_temp.sr; n record; mark timestamptz; items integer;
begin
  select * into f from pg_temp.sr;
  select * into n from season_news(null, 50) x where x.kind = 'results' and x.season = 1;
  if n.kind is null then raise exception 'season news gives the results item'; end if;
  if n.act is not null or n.thread is not null or n.seq is not null then raise exception 'a results item links no Act: %', to_jsonb(n); end if;
  if n.count is distinct from 4 or n.at is distinct from (select results_at from seasons where id = f.season_id) then raise exception 'the results item: %', to_jsonb(n); end if;
  if (select array_agg(e ->> 'name' order by (e ->> 'place')::int) from jsonb_array_elements(n.detail -> 'top') e) is distinct from array['Spritey', 'Gloomba', 'Mrs. Hooligan'] then
    raise exception 'the top three, by place: %', n.detail;
  end if;
  if n.detail #>> '{top,0,shown,0,class}' is distinct from 'alpha' then raise exception 'what is public is in the top three: %', n.detail; end if;
  if (select count(*) from news_landed where kind not in ('tally', 'announcements')) is distinct from 0 or pg_temp.refusal($q$insert into news_landed (act, kind) select id, 'results' from acts limit 1$q$) is null then
    raise exception 'news_landed holds tallies and announcements alone';
  end if;
  -- The alert counts it once, after the mark and not before.
  mark := n.at - interval '1 second';
  items := (select count(*) from season_news(null, 50) where at > mark);
  if items <= 10 and alerts_news_unread(mark) is distinct from items then raise exception 'the unread count is the items after the mark (%): %', items, alerts_news_unread(mark); end if;
  if alerts_news_unread(n.at) is distinct from 0 then raise exception 'nothing is newer than the results: %', alerts_news_unread(n.at); end if;
  if (select count(*) from alerts_news(mark + interval '2 seconds', 50) where kind = 'seasonNews' and sub = 'results') is distinct from 1 then raise exception 'one results alert'; end if;
  -- It is announced on reach as it lands.
  if not exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'results' and payload ->> 'season' = '1') then
    raise exception 'the results are announced on reach: %', (select jsonb_agg(payload) from broadcasts_due where topic = 'reach');
  end if;
end $$;

-- ---- The reads: finished seasons, a page of 50, a character's place ----
do $$
declare
  f pg_temp.sr;
  viewer uuid := tests.account('sr-viewer');
  s2 bigint; i integer; denied text; p integer;
  last_spot uuid;
  big_owner uuid := tests.account('sr-big');
begin
  select * into f from pg_temp.sr;
  -- A second finished season of 60 characters.
  insert into seasons (number, starts_at, ends_at, results_at) values (50, '1990-01-01', '1990-02-01', '1990-02-01') returning id into s2;
  for i in 1..60 loop
    insert into characters (owner, name, created_at, debuted_at)
    values (big_owner, 'Big ' || lpad(i::text, 3, '0'), now() - interval '40 days', now() - interval '40 days');
  end loop;
  insert into season_results (season, character, name, place, standing)
  select s2, c.id, c.name, (substring(c.name from 5))::integer, 1000 - (substring(c.name from 5))::integer from characters c where c.name like 'Big %';
  perform tests.become(viewer);
  if (select array_agg(number order by ord) from (select number, row_number() over () ord from finished_seasons()) x) is distinct from array[50, 1] then
    raise exception 'finished seasons, newest first: %', (select jsonb_agg(to_jsonb(x)) from finished_seasons() x);
  end if;
  if (select characters from finished_seasons() where number = 50) is distinct from 60 or (select characters from finished_seasons() where number = 1) is distinct from 4 then raise exception 'finished seasons count their characters'; end if;
  if (select count(*) from results_page(50, 1)) is distinct from 50 or (select count(*) from results_page(50, 2)) is distinct from 10 or (select count(*) from results_page(50, 3)) is distinct from 0 then
    raise exception 'a page is 50 rows';
  end if;
  if (select name from results_page(50, 2) order by place limit 1) is distinct from 'Big 051' or (select max(place) from results_page(50, 1)) is distinct from 50 then raise exception 'pages follow the places'; end if;
  if (select count(*) from results_page(1, 1)) is distinct from 4 or (select name from results_page(1, 1) order by place limit 1) is distinct from 'Spritey' then raise exception 'the first season''s page'; end if;
  if (select count(*) from results_page(1, 0)) is distinct from 4 or (select count(*) from results_page(99, 1)) is distinct from 0 then raise exception 'a page below 1 is 1; an unknown season is empty'; end if;
  select id into last_spot from characters where name = 'Big 051';
  p := result_place(50, last_spot);
  if p is distinct from 50 then raise exception 'a character''s place in the order, counted from 0: %', p; end if;
  if result_place(50, f.spritey) is not null or result_place(99, last_spot) is not null then raise exception 'no row, no index'; end if;
  if result_place(1, f.pipe) is distinct from 3 then raise exception 'result_place in the first season: %', result_place(1, f.pipe); end if;
  perform tests.unbecome();
  perform tests.become_anon();
  denied := pg_temp.refusal('select * from results_page(50, 1)');
  if denied is null or denied not like '42501%' then raise exception 'a visitor reads no results page: %', denied; end if;
  denied := pg_temp.refusal('select result_place(50, gen_random_uuid())');
  if denied is null or denied not like '42501%' then raise exception 'a visitor reads no result place: %', denied; end if;
  denied := pg_temp.refusal('select * from finished_seasons()');
  if denied is null or denied not like '42501%' then raise exception 'a visitor reads no finished seasons: %', denied; end if;
  perform tests.unbecome();
end $$;

-- ---- A page costs a page: the order is read from an index on (season, place, ...) ----
do $$
declare ln record; plan text := '';
begin
  set local enable_seqscan = off;
  for ln in explain select * from season_results where season = (select id from seasons where number = 50) order by place, name, character limit 50 loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan !~ 'season_results_by_place' or plan ~ 'Sort' then raise exception 'a results page is read in order from season_results_by_place:%', plan; end if;
end $$;

-- ---- The profile and the record read the table ----
do $$
declare f pg_temp.sr; doc jsonb; viewer uuid := tests.account('sr-viewer');
begin
  select * into f from pg_temp.sr;
  perform tests.become(viewer);
  doc := profile_page(f.spritey);
  if doc -> 'seasons' is distinct from jsonb_build_array(jsonb_build_object('season', 1, 'place', 1, 'standing', 650, 'at', (select results_at from seasons where number = 1))) then
    raise exception 'the profile''s seasons come from the table: %', doc -> 'seasons';
  end if;
  doc := record_page(f.spritey, 'seasons', 1);
  if doc -> 'seasons' is distinct from jsonb_build_array(jsonb_build_object('season', 1, 'place', 1, 'standing', 650, 'at', (select results_at from seasons where number = 1))) then
    raise exception 'the record''s seasons come from the table: %', doc -> 'seasons';
  end if;
  if profile_page(f.hooli) -> 'seasons' -> 0 ->> 'place' is distinct from '3' then raise exception 'a place per season'; end if;
  -- A season with no results is not listed.
  insert into seasons (number, starts_at, ends_at) values (60, '1990-03-01', '1990-04-01');
  if jsonb_array_length(profile_page(f.spritey) -> 'seasons') is distinct from 1 then raise exception 'a season without results is not listed'; end if;
  perform tests.unbecome();
end $$;

-- ---- The backfill: a reveal thread an earlier season's end wrote comes back as rows with the date it landed ----
do $$
declare
  ann uuid := tests.account('sr-old');
  a uuid; b uuid; s bigint; th uuid; hdr uuid; landed timestamptz := now() - interval '90 days';
begin
  a := tests.character(ann, 'Old Ann', 'alpha', now() - interval '200 days');
  b := tests.character(ann, 'Old Bea', 'alpha', now() - interval '200 days');
  insert into seasons (number, starts_at, ends_at) values (70, '1990-05-01', '1990-06-01') returning id into s;
  th := tests.thread('Season 70: The Reveal');
  hdr := tests.act(null, 'reveal', th, jsonb_build_object('season', 70, 'from', now() - interval '100 days', 'to', now() - interval '91 days', 'body', 'Every mask.', 'characters', 2), null, landed);
  perform tests.act(null, 'reveal', th, jsonb_build_object('season', 70, 'character', a, 'name', 'Old Ann Then', 'place', 1, 'standing', 55,
    'shown', jsonb_build_array(jsonb_build_object('kind', 'reveal', 'class', 'alpha', 'via', 'act'))), null, landed);
  -- Written before the shown list: it carried every class instead.
  -- And before the places were written: no place and no standing, the season's standings say them.
  perform tests.act(null, 'reveal', th, jsonb_build_object('season', 70, 'character', b, 'name', 'Old Bea Then',
    'classes', jsonb_build_array(jsonb_build_object('from', landed, 'class', 'alpha'))), null, landed);
  insert into standings (character, season, amount) values (b, s, 5), (a, s, 55) on conflict (season, character) do update set amount = excluded.amount;
  update seasons set reveal_act = hdr where id = s;
  if exists (select 1 from season_results where season = s) then raise exception 'the fixture is wrong: the season is already copied'; end if;
  perform backfill_season_results();
  if (select array_agg(name order by place) from season_results where season = s) is distinct from array['Old Ann Then', 'Old Bea Then'] then raise exception 'the old reveal comes back as rows: %', (select jsonb_agg(to_jsonb(r)) from season_results r where season = s); end if;
  if (select standing from season_results where season = s and character = a) is distinct from 55 or (select jsonb_array_length(shown) from season_results where character = a and season = s) is distinct from 1 then raise exception 'standing and shown are copied'; end if;
  if (select shown from season_results where character = b and season = s) is distinct from '[]'::jsonb then raise exception 'a season revealed before the shown list shows nothing'; end if;
  if (select place || '/' || standing from season_results where character = b and season = s) is distinct from '2/5' then raise exception 'a season revealed before the places were written takes them from the standings: %', (select place || '/' || standing from season_results where character = b and season = s); end if;
  if (select results_at from seasons where id = s) is distinct from landed then raise exception 'the results landed when the header was written: %', (select results_at from seasons where id = s); end if;
  -- Run again, it changes nothing; a season whose results the end wrote itself is not copied from anywhere.
  perform backfill_season_results();
  if (select count(*) from season_results where season = s) is distinct from 2 then raise exception 'the backfill is idempotent'; end if;
  -- The thread and its Acts are as they were written, and still draw.
  if (select count(*) from acts where thread = th) is distinct from 3 then raise exception 'the old Acts are left alone'; end if;
  if (select kind from season_news(null, 50) where season = 70 and kind = 'results') is distinct from 'results' then raise exception 'an old season''s results are news too'; end if;
end $$;

-- ---- The words The System needs: the Promos thread's title ----
do $$
declare why text;
begin
  why := pg_temp.refusal($q$update settings set value = value - 'announcementsThreadTitle' where key = 'copy'$q$);
  if why is null or why not like '%announcementsThreadTitle%' then raise exception 'copy lost its thread title: %', why; end if;
  why := pg_temp.refusal($q$update settings set value = value || '{"announcementsThreadTitle": " "}' where key = 'copy'$q$);
  if why is null or why not like '%announcementsThreadTitle%' then raise exception 'copy gave a blank title: %', why; end if;
  -- The reveal's words are no longer asked for.
  perform set_config('kayfabb.test_copy', (select value::text from settings where key = 'copy'), true);
  update settings set value = jsonb_build_object('announcementsThreadTitle', 'Season {season}: Promos') where key = 'copy';
  if copy_of('announcementsThreadTitle', 4) is distinct from 'Season 4: Promos' then raise exception 'copy_of fills the season'; end if;
end $$;
