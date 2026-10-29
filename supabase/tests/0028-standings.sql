-- The season's standings (supabase/migrations/0021_characters_listed.sql): every character that
-- has debuted, ranked by its settled standing in the open season; one waiting to debut is in no
-- row until the settlement that debuts it. The screens' engine plan, Task 9.

do $$
declare
  ann uuid := tests.account('stand-ann');
  bob uuid := tests.account('stand-bob');
  a uuid := tests.character(ann, 'Stand Top');
  b uuid := tests.character(bob, 'Stand Second');
  c uuid := tests.character(bob, 'Stand Tied');
  zero uuid := tests.character(ann, 'Stand Nothing Yet');
  waiting uuid;
  open_season bigint := (select id from seasons where ends_at is null);
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
begin
  insert into standings (character, season, amount) values (a, open_season, 2000000000), (b, open_season, 1900000000), (c, open_season, 1900000000)
  on conflict (season, character) do update set amount = excluded.amount;  -- a debut wrote each a row at 0 (0030's roster)
  insert into characters (owner, name, created_at) values (ann, 'Stand Waiting', s + interval '1 hour') returning id into waiting;

  -- The view is the ranking's definition, read here as its owner: no client reads it (below), and a player's
  -- page of it is standings_page (0030), held to it in supabase/tests/0037-standings-page.sql.
  if exists (select 1 from season_standings where character = waiting or name = 'Stand Waiting') then raise exception 'a character waiting to debut is listed'; end if;
  -- Ranked by settled standing, ties sharing a place; other files' characters stand below these two.
  if (select jsonb_agg(jsonb_build_array(name, standing, place) order by place, name) from season_standings where character in (a, b, c))
     is distinct from '[["Stand Top", 2000000000, 1], ["Stand Second", 1900000000, 2], ["Stand Tied", 1900000000, 2]]'::jsonb then
    raise exception 'the standings rank by settled standing, ties sharing a place: %', (select jsonb_agg(to_jsonb(x)) from season_standings x where character in (a, b, c));
  end if;
  if (select (standing, place) from season_standings where character = zero) is distinct from (0, 1 + (select count(*) from season_standings where standing > 0)) then
    raise exception 'a debuted character with nothing settled stands at 0, below every standing above it';
  end if;
  if (select count(*) from information_schema.columns where table_name = 'season_standings') is distinct from 4::bigint then raise exception 'the standings say only a character, its name, its standing and its place'; end if;

  -- Its first settlement debuts it, and from then it is listed.
  perform set_config('role', 'service_role', true);
  perform apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  if (select standing from season_standings where character = waiting) is distinct from 0 then raise exception 'a character is listed from the settlement that debuts it'; end if;
  -- Between seasons, the season that ended last, as it stood.
  update seasons set ends_at = greatest(now(), starts_at + interval '1 second') where id = open_season;
  if (select standing from season_standings where character = a) is distinct from 2000000000 then raise exception 'between seasons the last season''s standings are shown'; end if;
  perform tests.become_anon();
  begin
    perform 1 from season_standings;
    raise exception 'a visitor read the standings';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
  -- Nor does a player: the view ranks every debuted character with a window, whatever page is asked of it, so
  -- no client runs it. A player reads a page through standings_page (0030), whose cost is the page.
  perform tests.become(bob);
  begin
    perform 1 from season_standings;
    raise exception 'a player read season_standings, the window over every debuted character';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;
