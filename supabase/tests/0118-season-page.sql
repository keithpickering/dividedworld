-- season_page(tab, season, character, page) (supabase/migrations/0117_season_page.sql; the glass-load design, section 7; its plan, Task 6): /season in
-- one read. Each piece equals the matching read made directly: the standings page (and the reveals and Turns of its characters), the news, the
-- finished seasons, a finished season's results and the page a linked character's row lands on. A season that does not exist is null, and a visitor
-- is refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  viewer uuid := tests.account('sp-viewer');
  owner uuid;
  who uuid[] := '{}';
  c uuid;
  i integer;
  t uuid := tests.thread('Sp thread');
  finished bigint;
  target uuid;
  doc jsonb;
  want jsonb;
  why text;
begin
  -- Sixty ranked characters (two pages of the standings), each a different standing.
  for i in 1..60 loop
    if i % 6 = 1 then owner := tests.account('sp-owner-' || i); end if;
    c := tests.character(owner, 'Sp C' || lpad(i::text, 2, '0'), 'alpha', now() - interval '90 days');
    who := who || c;
    update standings set amount = 1000 - i * 7 where character = c and season = (select id from current_season);
  end loop;
  -- A reveal and an announced Turn for characters on page 2.
  perform tests.become((select ch.owner from characters ch where ch.id = who[55]));
  perform unmask(who[55], t, 'Fifty-five says.');
  perform tests.unbecome();
  perform write_announce(who[56], tests.thread('Sp turns'), 'turn', 'alpha', null, now() - interval '10 days');
  -- A news item.
  insert into characters (owner, name, created_at, debut_loudness) values (tests.account('sp-debut'), 'Sp Debut', now() - interval '2 hours', 'announced') returning id into c;
  insert into class_history (character, class_key, started_at) values (c, 'alpha', now() - interval '2 hours');
  perform masks_change(now() - interval '1 hour');
  -- A finished season whose table has the sixty, the 55th at index 54: page 2.
  insert into seasons (number, starts_at, ends_at, results_at) values (90, '1990-01-01', '1990-02-01', '1990-02-01') returning id into finished;
  for i in 1..60 loop
    insert into season_results (season, character, name, place, standing) values (finished, who[i], 'Sp C' || lpad(i::text, 2, '0'), i, 1000 - i);
  end loop;
  target := who[55];

  perform tests.become(viewer);

  -- Rankings, page 2 of the current season.
  doc := season_page('rankings', null, null, 2);
  if doc -> 'season' is distinct from (select to_jsonb(s) from current_season s) then raise exception 'season: %', doc -> 'season'; end if;
  if (doc ->> 'page')::integer is distinct from 2 then raise exception 'page: %', doc -> 'page'; end if;
  if doc -> 'standings' is distinct from (select jsonb_agg(to_jsonb(s) order by s.place, s.name) from standings_page(50, 50) s) then raise exception 'standings page 2: %', doc -> 'standings'; end if;
  if jsonb_array_length(doc -> 'standings') < 10 then raise exception 'page 2 holds the rest of the season: %', doc -> 'standings'; end if;
  if (doc ->> 'size')::integer is distinct from (select characters from season_size) then raise exception 'size: %', doc -> 'size'; end if;
  if doc -> 'finished' is distinct from (select jsonb_agg(to_jsonb(f) order by f.number desc) from finished_seasons() f) or jsonb_array_length(doc -> 'finished') is distinct from 1 then raise exception 'finished: %', doc -> 'finished'; end if;
  if doc -> 'reveals' is distinct from (select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
       select act, character, class, at, via, thread from class_reveals where character in (select character from standings_page(50, 50))) r)
     or jsonb_array_length(doc -> 'reveals') is distinct from 1 then
    raise exception 'reveals of the page''s characters: %', doc -> 'reveals';
  end if;
  if doc -> 'turns' is distinct from (select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
       select act, character, at, was from turns_announced where character in (select character from standings_page(50, 50))) r)
     or jsonb_array_length(doc -> 'turns') is distinct from 1 then
    raise exception 'turns of the page''s characters: %', doc -> 'turns';
  end if;
  if doc ? 'news' or doc ? 'results' then raise exception 'a standings page holds no news and no results: %', (select array_agg(k) from jsonb_object_keys(doc) k); end if;
  -- The page is clamped; none is the first; the current season named is the same.
  if (season_page('rankings', null, null, 0) ->> 'page')::integer is distinct from 1 or (season_page('rankings', null, null, null) ->> 'page')::integer is distinct from 1
     or (season_page('rankings', null, null, 99999) ->> 'page')::integer is distinct from 10000 then raise exception 'the page is clamped'; end if;
  if season_page('rankings', (select number from current_season), null, 2) is distinct from doc then raise exception 'the current season named is the standings'; end if;
  if season_page('rankings', null, null, 1) -> 'standings' is distinct from (select jsonb_agg(to_jsonb(s) order by s.place, s.name) from standings_page(0, 50) s) then raise exception 'standings page 1'; end if;

  -- News.
  doc := season_page('news', null, null, null);
  if doc -> 'news' is distinct from (select jsonb_agg(to_jsonb(n)) from season_news(null, 20) n) or jsonb_array_length(doc -> 'news') < 1 then raise exception 'news: %', doc -> 'news'; end if;
  if doc -> 'season' is distinct from (select to_jsonb(s) from current_season s) then raise exception 'news season: %', doc -> 'season'; end if;
  if doc ? 'standings' or doc ? 'finished' then raise exception 'a news page holds no standings'; end if;

  -- A finished season: with a character, the page its row lands on (index 54: page 2); with a page, that page.
  doc := season_page('rankings', 90, target, null);
  if (doc ->> 'place')::integer is distinct from result_place(90, target) or (doc ->> 'place')::integer is distinct from 54 then raise exception 'place: %', doc -> 'place'; end if;
  if (doc ->> 'page')::integer is distinct from 2 then raise exception 'the page the character''s row lands on: %', doc -> 'page'; end if;
  if doc -> 'results' is distinct from (select jsonb_agg(to_jsonb(r)) from results_page(90, 2) r) or jsonb_array_length(doc -> 'results') is distinct from 10 then raise exception 'results: %', doc -> 'results'; end if;
  if doc -> 'finished' is distinct from (select jsonb_agg(to_jsonb(f) order by f.number desc) from finished_seasons() f) then raise exception 'finished with results: %', doc -> 'finished'; end if;
  if doc ? 'standings' then raise exception 'a finished season holds no standings'; end if;
  doc := season_page('rankings', 90, who[3], null);
  if (doc ->> 'page')::integer is distinct from 1 or doc -> 'results' is distinct from (select jsonb_agg(to_jsonb(r)) from results_page(90, 1) r) then raise exception 'a character on page 1'; end if;
  doc := season_page('rankings', 90, target, 1);
  if (doc ->> 'page')::integer is distinct from 1 or doc -> 'results' is distinct from (select jsonb_agg(to_jsonb(r)) from results_page(90, 1) r) then raise exception 'a page asked wins'; end if;
  doc := season_page('rankings', 90, null, null);
  if doc -> 'place' is distinct from 'null'::jsonb or (doc ->> 'page')::integer is distinct from 1 then raise exception 'no character, no place: %', doc; end if;
  doc := season_page('rankings', 90, viewer, null);
  if doc -> 'place' is distinct from 'null'::jsonb then raise exception 'a character with no row is unplaced: %', doc -> 'place'; end if;

  -- A season that does not exist is null.
  if season_page('rankings', 4242, null, null) is not null then raise exception 'a season that does not exist answers null'; end if;
  perform tests.unbecome();

  -- A visitor is refused.
  perform tests.become_anon();
  why := pg_temp.refusal('select season_page(''rankings'', null, null, 1)');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused season_page(), got %', why; end if;
end $$;
