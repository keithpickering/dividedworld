-- Which season the standings read is one rule, written once: standings_season() (supabase/migrations/
-- 0030_screens_reads.sql), the open season, else the one that started last. A profile's place
-- (standing_place), the standings screen's page (standings_page) and a page of postbits' amounts
-- (current_standings, which the web adapter reads with `.in('character', ids)`) each call it, and so does
-- the season a screen names beside them (current_season: "Season 3" over the standings it ranks); none
-- keeps a season expression of its own: three copies of a rule are three rules the first time one is
-- edited, and a postbit that read one season while the profile beside it read another would show two
-- standings for one character. season_standings (0021, on main) keeps its own copy as the definition the
-- SQL tests compare against; 0030 does not replace it.

-- ---- each reader calls the rule, and none writes it again ----
do $$
declare
  r record;
  bad text := '';
begin
  for r in
    select 'function ' || p.proname as what, p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('standing_place', 'standings_page', 'characters_join_standings', 'backfill_standings_roster')
    union all
    select 'view ' || c.relname, pg_get_viewdef(c.oid) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('current_standings', 'current_season')
  loop
    if r.body !~* 'standings_season\s*\(' then bad := bad || format(E'\n  %s does not call standings_season()', r.what); end if;
    -- current_season's job is the season row standings_season() names, so it reads seasons by that id and no other way.
    if r.what = 'view current_season' then
      if r.body !~* 'id\s*=\s*standings_season\s*\(' then bad := bad || E'\n  view current_season reads seasons other than by the id standings_season() names'; end if;
    elsif r.body ~* 'from\s+(public\.)?seasons\M' then bad := bad || format(E'\n  %s reads seasons itself, a second copy of the rule', r.what); end if;
  end loop;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'current_standings') then
    bad := bad || E'\n  there is no current_standings view for a page of postbits to read its amounts through';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'current_season') then
    bad := bad || E'\n  there is no current_season view for a screen to name the season the standings read';
  end if;
  if bad <> '' then raise exception 'the season the standings read is written more than once:%', bad; end if;
end $$;

-- ---- a postbit's amount, a profile's standing and the page's agree, in every season layout ----
create function pg_temp.agree(why text, who uuid) returns void language plpgsql as $$
declare
  r record;
begin
  perform tests.become(who);
  for r in
    select p.character, p.standing as on_page, (standing_place(p.character) ->> 'standing')::integer as on_profile,
           (select s.standing from current_standings s where s.character = p.character) as on_postbit
    from standings_page(0, 1000) p
  loop
    if r.on_postbit is distinct from r.on_page or r.on_profile is distinct from r.on_page then
      raise exception '%: character % stands at % on the page, % on its profile and % on its postbits', why, r.character, r.on_page, r.on_profile, r.on_postbit;
    end if;
  end loop;
  if (select count(*) from current_standings) is distinct from (select count(*) from standings_page(0, 1000)) then
    raise exception '%: current_standings holds % rows and the page %', why, (select count(*) from current_standings), (select count(*) from standings_page(0, 1000));
  end if;
  perform tests.unbecome();
end $$;

do $$
declare
  ann uuid := tests.account('ss-ann');
  bob uuid := tests.account('ss-bob');
  first_season bigint := (select id from seasons where ends_at is null);
  second_season bigint;
  a uuid := tests.character(ann, 'Ss A');
  b uuid := tests.character(bob, 'Ss B');
  why text;
begin
  insert into standings (character, season, amount) values (a, first_season, 50), (b, first_season, -20)
  on conflict (season, character) do update set amount = excluded.amount;
  perform pg_temp.agree('the open season', bob);

  -- The season ends and the next is made ahead of its start: the next is the open one, and every reader reads it.
  update seasons set ends_at = greatest(now(), starts_at + interval '1 second') + interval '1 hour' where id = first_season;
  insert into seasons (number, starts_at) select max(number) + 1, (select ends_at from seasons where id = first_season) + interval '1 day' from seasons
  returning id into second_season;
  insert into standings (character, season, amount) values (a, second_season, 7) on conflict (season, character) do update set amount = excluded.amount;
  perform pg_temp.agree('a next season made ahead of its start', bob);
  perform tests.become(bob);
  if (select s.standing from current_standings s where s.character = a) is distinct from 7 then
    raise exception 'current_standings reads the season standings_season() names (%), not another', standings_season();
  end if;
  perform tests.unbecome();

  -- Between seasons: the one that started last.
  update seasons set ends_at = starts_at + interval '1 day' where id = second_season;
  perform pg_temp.agree('between seasons', bob);

  -- A visitor reads none of it.
  perform tests.become_anon();
  why := null;
  begin perform 1 from current_standings; exception when insufficient_privilege then why := 'refused'; end;
  if why is distinct from 'refused' then raise exception 'a visitor read current_standings'; end if;
  perform tests.unbecome();
end $$;

-- ---- a page of postbits' amounts costs the page: a probe of the standings' key per character ----
do $$
declare
  ids uuid[];
  plan text := '';
  ln record;
begin
  perform tests.character(tests.account(format('sp-%s', g)), format('Sp %s', lpad(g::text, 3, '0'))) from generate_series(1, 300) g;
  analyze standings;
  select array_agg(c.id) into ids from (select id from characters where name like 'Sp %' order by name limit 20) c;
  set local enable_seqscan = off;
  for ln in execute format('explain select character, standing from current_standings where character = any (%L::uuid[])', ids) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  reset enable_seqscan;
  if plan ~* 'seq scan' then raise exception 'a page of postbits'' amounts scans the standings: %', plan; end if;
  if plan !~* 'index' then raise exception 'a page of postbits'' amounts is not an index probe: %', plan; end if;
end $$;

-- ---- the season a screen names is the season its standings read, whatever the numbers say ----
-- A season's number is not tied to when it started, so "the highest number" is a rule of its own: a season
-- numbered past the rest that ran before them all must not be the one a screen names over this season's standings.
do $$
declare
  why text;
begin
  insert into seasons (number, starts_at, ends_at)
  select max(number) + 10, (select min(starts_at) from seasons) - interval '20 days', (select min(starts_at) from seasons) - interval '10 days' from seasons;
  perform tests.become(tests.account('ss-cal'));
  if (select id from current_season) is distinct from standings_season() then
    raise exception 'current_season names season % while the standings read season %', (select id from current_season), standings_season();
  end if;
  if (select count(*) from current_season) is distinct from 1 then raise exception 'current_season holds % rows, not one', (select count(*) from current_season); end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := null;
  begin perform 1 from current_season; exception when insufficient_privilege then why := 'refused'; end;
  if why is distinct from 'refused' then raise exception 'a visitor read current_season'; end if;
  perform tests.unbecome();
end $$;
