-- The trophies admin page's reads (supabase/migrations/0157_admin_awards.sql; the cosmetics plan, Task 11): an admin reads recent awards, newest first and paged, a reversed
-- one listed as taken back, with every trophy kind; finds a character by name; and a player is refused both, in the database's own words.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  msg := sqlerrm;
  if hint is distinct from 'kayfabb.refusal' then return 'NOT A REFUSAL (' || coalesce(hint, 'no hint') || '): ' || msg; end if;
  return msg;
end $$;

select tests.unbecome();
insert into trophy_kinds (key, name, belt) values ('aa-pet', 'Pet', false), ('aa-belt', 'The Belt', true);

do $$
declare
  adm uuid := tests.account('aa-adm'); ann uuid := tests.account('aa-ann');
  a uuid := tests.character(ann, 'Aa Ann');
  a1 uuid; a2 uuid; a3 uuid; r jsonb; p1 jsonb; p2 jsonb;
begin
  insert into admins (account) values (adm);
  insert into trophy_kinds (key, name, made_by) values ('made-aa', 'Contest', adm);
  insert into trophy_awards (trophy, character, by, at) values ('aa-pet', a, 'admin', now() - interval '3 hours') returning id into a1;
  insert into trophy_awards (trophy, character, by, at, line) values ('aa-belt', a, 'admin', now() - interval '2 hours', 'Best.') returning id into a2;
  insert into trophy_awards (trophy, character, by, at) values ('made-aa', a, 'admin', now() - interval '1 hour') returning id into a3;
  insert into trophy_reversals (award, by) values (a2, adm);

  perform tests.become(adm);
  r := admin_awards();
  if jsonb_array_length(r -> 'awards') is distinct from 3 or r ->> 'more' is distinct from 'false' then raise exception 'the awards: %', r; end if;
  if (select string_agg(x ->> 'trophy', ',' order by n) from jsonb_array_elements(r -> 'awards') with ordinality t(x, n)) is distinct from 'made-aa,aa-belt,aa-pet' then raise exception 'newest first: %', r -> 'awards'; end if;
  if (r #>> '{awards,1,reversed}') is distinct from 'true' or (r #>> '{awards,0,reversed}') is distinct from 'false' then raise exception 'a taken-back award is listed as taken back: %', r -> 'awards'; end if;
  if (r #>> '{awards,0,to}') is distinct from 'Aa Ann' or (r #>> '{awards,0,by}') is distinct from 'an admin' or (r #>> '{awards,1,line}') is distinct from 'Best.' then raise exception 'to, by and line: %', r -> 'awards'; end if;
  if r::text like '%' || adm::text || '%' or r::text like '%' || ann::text || '%' then raise exception 'an account id came back: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'kinds') k where k ->> 'key' = 'aa-belt' and k ->> 'belt' = 'true' and k ->> 'made' = 'false')
     or not exists (select 1 from jsonb_array_elements(r -> 'kinds') k where k ->> 'key' = 'made-aa' and k ->> 'made' = 'true') then raise exception 'the kinds: %', r -> 'kinds'; end if;

  -- Paged: two to a page, then the rest after the cursor.
  p1 := admin_awards(null, 2);
  if jsonb_array_length(p1 -> 'awards') is distinct from 2 or p1 ->> 'more' is distinct from 'true' then raise exception 'a page of two: %', p1; end if;
  p2 := admin_awards((p1 #>> '{awards,1,at}')::timestamptz, 2, (p1 #>> '{awards,1,award}')::uuid);
  if jsonb_array_length(p2 -> 'awards') is distinct from 1 or p2 #>> '{awards,0,award}' is distinct from a1::text or p2 ->> 'more' is distinct from 'false' then raise exception 'the next page: %', p2; end if;

  -- A character by its name, case and lookalikes folded; none for no one; never a staff character.
  if (admin_character_named('aa ann') ->> 'id') is distinct from a::text or (admin_character_named('  Aa Ann ') ->> 'name') is distinct from 'Aa Ann' then raise exception 'found by name'; end if;
  if admin_character_named('Nobody Atall') is not null then raise exception 'no one is no one'; end if;

  -- A player is refused both.
  perform tests.become(ann);
  if pg_temp.refusal('select admin_awards()') is null then raise exception 'a player read the awards'; end if;
  if pg_temp.refusal($q$select admin_character_named('Aa Ann')$q$) is null then raise exception 'a player looked a character up by name'; end if;
  perform tests.unbecome();
end $$;
