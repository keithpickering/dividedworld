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
  insert into standings (character, season, amount) values (a, open_season, 2000000000), (b, open_season, 1900000000), (c, open_season, 1900000000);
  insert into characters (owner, name, created_at) values (ann, 'Stand Waiting', s + interval '1 hour') returning id into waiting;

  perform tests.become(bob);
  perform auth.assert_impersonating();
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
  perform tests.unbecome();

  -- Its first settlement debuts it, and from then it is listed.
  perform set_config('role', 'service_role', true);
  perform apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  perform tests.become(bob);
  if (select standing from season_standings where character = waiting) is distinct from 0 then raise exception 'a character is listed from the settlement that debuts it'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  begin
    perform 1 from season_standings;
    raise exception 'a visitor read the standings';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;
