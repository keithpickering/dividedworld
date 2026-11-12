-- Trophies and belts (supabase/migrations/0206_trophies.sql; the cosmetics plan, Task 3). The kinds are this file's own (tt-...), seeded as an instance seeds its catalog;
-- the engine's words for a trophy's givers are held here by their SQL twins.

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

-- Any error at all, for the guards that raise no refusal of a player's.
create function pg_temp.error(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then return sqlerrm;
end $$;

-- Whether a function's source reads the `reactions` relation (a from or a join), not the word in a comment or a demand's own parameter.
create function pg_temp.names_reactions(src text) returns boolean language sql as $$
  select src ~* '\m(from|join)\s+(public\.)?reactions\M'
$$;

-- The names of some characters, in order. Taking the ids as an argument keeps the function that found them out of the query's plan, where a stable function is run
-- once to estimate it, before the rows this transaction has just written are in its snapshot.
create function pg_temp.names(ids uuid[]) returns text language sql as $$
  select string_agg(c.name, ',' order by c.name) from characters c where c.id = any (ids)
$$;

-- The trophy a character holds, by kind, in trophies_of's answer.
create function pg_temp.has(of_character uuid, kind text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(trophies_of(of_character) -> 'awards') t where t ->> 'trophy' = kind)
$$;
create function pg_temp.held(of_character uuid, kind text) returns boolean language sql as $$
  select (select (t ->> 'held')::boolean from jsonb_array_elements(trophies_of(of_character) -> 'awards') t where t ->> 'trophy' = kind limit 1)
$$;

select tests.unbecome();
insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 15, "dayMost": 4, "outcomes": {"line": 70, "gear": 20, "card": 10}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
  on conflict (key) do update set value = excluded.value;

-- ---- A seed: the catalog's kinds, its places, the Boss's kinds and the met demand's; a Boss, the stock lines, a day-long season that began long ago ----
do $$
declare
  catalog jsonb := jsonb_build_object('kinds', jsonb_build_array(
      jsonb_build_object('key', 'tt-champion', 'name', 'Champion', 'line', 'First.'),
      jsonb_build_object('key', 'tt-runner-up', 'name', 'Runner-Up'),
      jsonb_build_object('key', 'tt-third', 'name', 'Third', 'line', 'Third.'),
      jsonb_build_object('key', 'tt-pet', 'name', 'Pet'),
      jsonb_build_object('key', 'tt-belt', 'name', 'The Belt', 'line', 'One at a time.', 'belt', true),
      jsonb_build_object('key', 'tt-met', 'name', 'Met It')),
    'seasonPlaces', jsonb_build_array('tt-champion', 'tt-runner-up', 'tt-third'), 'boss', jsonb_build_array('tt-pet', 'tt-belt'), 'demandMet', 'tt-met');
  base jsonb := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'rosterRecentExcluded', 1,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'),
        'moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met: {move}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'tt-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'tt-boss', 'name', 'Tt Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'tt-other', 'name', 'Tt Other', 'title', 'Boss', 'signature', 'b')),
      'firstStaff', '[]'::jsonb, 'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'quadrantOnBoard'), jsonb_build_object('key', 'distinctCharactersOnBoard'),
        jsonb_build_object('key', 'characterPostsInThread'), jsonb_build_object('key', 'crossQuote'), jsonb_build_object('key', 'apologyAccepted'))));
  admin_made uuid := tests.account('tt-maker');
begin
  perform seed_instance(base || jsonb_build_object('trophies', catalog));
  if (select string_agg(key || ':' || coalesce(season_place::text, '-'), ',' order by key) from trophy_kinds where made_by is null and key like 'tt-%')
     is distinct from 'tt-belt:-,tt-champion:1,tt-met:-,tt-pet:-,tt-runner-up:2,tt-third:3' then
    raise exception 'a seed writes its kinds and their places: %', (select string_agg(key || ':' || coalesce(season_place::text, '-'), ',' order by key) from trophy_kinds where key like 'tt-%');
  end if;
  if (select string_agg(key, ',' order by key) from trophy_kinds where boss_gives) is distinct from 'tt-belt,tt-pet' then raise exception 'the Boss''s kinds are flagged'; end if;
  if (select key from trophy_kinds where demand_met) is distinct from 'tt-met' then raise exception 'the met demand''s kind is flagged'; end if;
  if (select belt from trophy_kinds where key = 'tt-belt') is distinct from true or (select belt from trophy_kinds where key = 'tt-pet') is distinct from false then raise exception 'a belt is flagged'; end if;
  if (select line from trophy_kinds where key = 'tt-runner-up') is not null then raise exception 'a kind with no line has none'; end if;
  perform seed_instance(base || jsonb_build_object('trophies', catalog));
  -- A reseed moves nothing it should not: a changed list drops a kind nothing names, keeps one an award names, and a place re-pointed does not meet its old one.
  perform seed_instance(base || jsonb_build_object('trophies', jsonb_set(catalog, '{kinds}', (catalog -> 'kinds') || jsonb_build_array(jsonb_build_object('key', 'tt-extra', 'name', 'Extra')))));
  if not exists (select 1 from trophy_kinds where key = 'tt-extra') then raise exception 'a reseed adds a kind'; end if;
  perform seed_instance(base || jsonb_build_object('trophies', catalog || jsonb_build_object('seasonPlaces', jsonb_build_array('tt-third', 'tt-champion', 'tt-runner-up'))));
  if (select season_place from trophy_kinds where key = 'tt-third') is distinct from 1 or (select season_place from trophy_kinds where key = 'tt-runner-up') is distinct from 3 then raise exception 'a reseed re-points the places'; end if;
  perform seed_instance(base || jsonb_build_object('trophies', catalog));
  if exists (select 1 from trophy_kinds where key = 'tt-extra') then raise exception 'a reseed drops a kind nothing names'; end if;
  -- A kind an award names is never dropped.
  perform seed_instance(base || jsonb_build_object('trophies', jsonb_set(catalog, '{kinds}', (catalog -> 'kinds') || jsonb_build_array(jsonb_build_object('key', 'tt-named', 'name', 'Named')))));
  insert into trophy_awards (trophy, character, by) values ('tt-named', tests.character(tests.account('tt-namer'), 'Tt Namer'), 'admin');
  perform seed_instance(base || jsonb_build_object('trophies', catalog));
  if not exists (select 1 from trophy_kinds where key = 'tt-named') then raise exception 'a reseed dropped a kind an award names'; end if;
  -- A seed with no catalog touches none. An admin's kind is left alone by a seed; an instance key that begins "made-" is refused; a catalog naming a kind it lacks is refused.
  perform tests.unbecome();
  insert into trophy_kinds (key, name, made_by) values ('made-0001', 'Kept', admin_made);
  perform seed_instance(base || jsonb_build_object('trophies', catalog));
  perform seed_instance(base);
  if not exists (select 1 from trophy_kinds where key = 'made-0001') then raise exception 'a seed touched an admin''s kind'; end if;
  if pg_temp.error(format('select seed_instance(%L)', (base || jsonb_build_object('trophies', jsonb_set(catalog, '{kinds}', (catalog -> 'kinds') || jsonb_build_array(jsonb_build_object('key', 'made-9', 'name', 'Mine')))))::text))
     is distinct from 'a trophy key begins "made-" only on the admin page: made-9' then raise exception 'an instance key that begins made-: %', pg_temp.error(format('select seed_instance(%L)', (base || jsonb_build_object('trophies', jsonb_set(catalog, '{kinds}', (catalog -> 'kinds') || jsonb_build_array(jsonb_build_object('key', 'made-9', 'name', 'Mine')))))::text)); end if;
  if pg_temp.error(format('select seed_instance(%L)', (base || jsonb_build_object('trophies', catalog || jsonb_build_object('demandMet', 'tt-nope')))::text)) is distinct from 'the trophy catalog names kinds it does not define: tt-nope' then
    raise exception 'a catalog naming a kind it lacks';
  end if;
  if (select season_place from trophy_kinds where key = 'tt-champion') is distinct from 1 then raise exception 'a refused seed changed the places'; end if;
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

-- ---- A belt awarded to B while A holds it: A no longer holds it, B does; taking B's back returns it; the lineage lists A then B ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tt-ann'); bob uuid := tests.account('tt-bob'); boss uuid := tests.account('tt-admin');
  a uuid := tests.character(ann, 'Tt Ann'); b uuid := tests.character(bob, 'Tt Bob');
  award_a uuid; award_b uuid; lineage jsonb; shelf jsonb; said text;
begin
  insert into admins (account) values (boss);
  perform tests.become(boss);
  award_a := (award_trophy('tt-belt', a, 'First holder.') ->> 'award')::uuid;
  if pg_temp.held(a, 'tt-belt') is distinct from true then raise exception 'the first holder holds the belt'; end if;
  award_b := (award_trophy('tt-belt', b) ->> 'award')::uuid;
  if pg_temp.held(a, 'tt-belt') is distinct from false then raise exception 'the belt given to B is not A''s: %', trophies_of(a); end if;
  if pg_temp.held(b, 'tt-belt') is distinct from true then raise exception 'the belt given to B is B''s: %', trophies_of(b); end if;
  if pg_temp.has(a, 'tt-belt') is distinct from true then raise exception 'A keeps the award it once held, as not held'; end if;
  lineage := belt_lineage('tt-belt');
  -- Newest reign first, as {reigns, more}: B's reign (still going), then A's, ended as B's began; each says in plain words how it began, never which admin.
  if jsonb_array_length(lineage -> 'reigns') is distinct from 2 or lineage #>> '{reigns,1,character}' is distinct from a::text or lineage #>> '{reigns,0,character}' is distinct from b::text
     or lineage #>> '{reigns,1,ended}' is distinct from lineage #>> '{reigns,0,began}' or lineage #>> '{reigns,0,ended}' is not null or lineage #>> '{reigns,1,name}' is distinct from 'Tt Ann'
     or lineage ->> 'more' is distinct from 'false' then
    raise exception 'belt_lineage lists B then A, A''s reign ending as B''s began: %', lineage;
  end if;
  if lineage #>> '{reigns,0,by}' is distinct from 'an admin' or lineage #>> '{reigns,1,by}' is distinct from 'an admin' or lineage::text like '%' || boss::text || '%' then raise exception 'a reign says how it began, never which admin: %', lineage; end if;
  -- Paged as trophies_of is: one at a time, the cursor the last reign's (began, award).
  lineage := belt_lineage('tt-belt', null, 1);
  if jsonb_array_length(lineage -> 'reigns') is distinct from 1 or lineage ->> 'more' is distinct from 'true' or lineage #>> '{reigns,0,character}' is distinct from b::text then raise exception 'the first page of one reign: %', lineage; end if;
  lineage := belt_lineage('tt-belt', (lineage #>> '{reigns,0,began}')::timestamptz, 1, (lineage #>> '{reigns,0,award}')::uuid);
  if jsonb_array_length(lineage -> 'reigns') is distinct from 1 or lineage ->> 'more' is distinct from 'false' or lineage #>> '{reigns,0,character}' is distinct from a::text or lineage #>> '{reigns,0,ended}' is null then raise exception 'the second page: %', lineage; end if;
  if jsonb_array_length(belt_lineage('tt-belt', null, 0) -> 'reigns') is distinct from 1 or jsonb_array_length(belt_lineage('tt-belt', null, 100000) -> 'reigns') is distinct from 2 then raise exception 'a page holds at least one and at most 100'; end if;
  -- An admin's award carries no link and the award is not shown until its character chooses it.
  if (select t -> 'move' from jsonb_array_elements(trophies_of(b) -> 'awards') t where t ->> 'trophy' = 'tt-belt') is distinct from 'null'::jsonb then raise exception 'an admin''s award has no move: %', trophies_of(b); end if;
  if (select t ->> 'shown' from jsonb_array_elements(trophies_of(b) -> 'awards') t where t ->> 'trophy' = 'tt-belt') is distinct from 'false' then raise exception 'an award not chosen is not shown: %', trophies_of(b); end if;
  -- The words: the line of the award wins over the kind's; who gave it is "an admin", never which.
  if (select t ->> 'line' from jsonb_array_elements(trophies_of(a) -> 'awards') t where t ->> 'trophy' = 'tt-belt') is distinct from 'First holder.' then raise exception 'an award''s own line is shown: %', trophies_of(a); end if;
  if (select t ->> 'line' from jsonb_array_elements(trophies_of(b) -> 'awards') t where t ->> 'trophy' = 'tt-belt') is distinct from 'One at a time.' then raise exception 'the kind''s line is shown otherwise: %', trophies_of(b); end if;
  if (select t ->> 'by' from jsonb_array_elements(trophies_of(b) -> 'awards') t where t ->> 'trophy' = 'tt-belt') is distinct from 'an admin' then raise exception 'an admin''s award says "an admin"'; end if;
  if trophies_of(b)::text like '%' || boss::text || '%' then raise exception 'which admin gave it is in the answer'; end if;
  -- Taking B's back returns the belt to A, and B shows nothing.
  perform reverse_award(award_b);
  if pg_temp.held(a, 'tt-belt') is distinct from true then raise exception 'reversing B''s award does not return the belt to A: %', trophies_of(a); end if;
  if pg_temp.has(b, 'tt-belt') then raise exception 'a reversed award leaves B''s trophies'; end if;
  if jsonb_array_length(belt_lineage('tt-belt') -> 'reigns') is distinct from 1 or belt_lineage('tt-belt') #>> '{reigns,0,ended}' is not null then raise exception 'a reversed award leaves the lineage: %', belt_lineage('tt-belt'); end if;
  said := pg_temp.refusal(format('select reverse_award(%L)', award_b));
  if said is distinct from 'that trophy was already taken back' then raise exception 'reversing twice: %', said; end if;
  said := pg_temp.refusal(format('select reverse_award(%L)', gen_random_uuid()));
  if said is distinct from 'there is no such trophy' then raise exception 'reversing what does not exist: %', said; end if;
  said := pg_temp.refusal('select belt_lineage(''tt-pet'')');
  if said is distinct from '"tt-pet" is not a belt' then raise exception 'the lineage of a kind that is no belt: %', said; end if;
  said := pg_temp.refusal('select belt_lineage(''tt-nope'')');
  if said is distinct from 'there is no trophy "tt-nope"' then raise exception 'the lineage of no kind: %', said; end if;
  perform tests.unbecome();
  -- Both are read through the service's functions: the tables are no client's.
  perform tests.become(ann);
  if pg_temp.error('select count(*) from trophy_awards') not like 'permission denied%' then raise exception 'a player read trophy_awards'; end if;
  if pg_temp.error('select count(*) from trophy_reversals') not like 'permission denied%' then raise exception 'a player read trophy_reversals'; end if;
  if pg_temp.error('select count(*) from trophies_shown') not like 'permission denied%' then raise exception 'a player read trophies_shown'; end if;
  if pg_temp.error('select made_by from trophy_kinds') not like 'permission denied%' then raise exception 'a player read who made a kind'; end if;
  if (select count(*) from trophy_kinds where key like 'tt-%') is distinct from 7::bigint then raise exception 'the kinds are public: %', (select count(*) from trophy_kinds); end if;
  if jsonb_array_length(trophies_of(a) -> 'awards') is distinct from 1 then raise exception 'any player reads a character''s trophies'; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select trophies_of(%L)', a)) is null then raise exception 'a visitor read trophies'; end if;
  perform tests.unbecome();
end $$;

-- ---- The shelf: shown awards, then every belt held; a reversed award leaves at once ----
select tests.unbecome();
do $$
declare
  cat uuid := tests.account('tt-cat'); dan uuid := tests.account('tt-dan'); boss uuid := tests.account('tt-admin2');
  c uuid := tests.character(cat, 'Tt Cat'); d uuid := tests.character(dan, 'Tt Dan');
  pet uuid; third uuid; champion uuid; belt uuid; other uuid; extra uuid; shelf jsonb; said text;
begin
  insert into admins (account) values (boss);
  insert into character_profiles (character) values (c), (d);
  perform tests.become(boss);
  pet := (award_trophy('tt-pet', c) ->> 'award')::uuid;
  third := (award_trophy('tt-third', c) ->> 'award')::uuid;
  champion := (award_trophy('tt-champion', c) ->> 'award')::uuid;
  extra := (award_trophy('tt-met', c) ->> 'award')::uuid;
  belt := (award_trophy('tt-belt', c) ->> 'award')::uuid;
  other := (award_trophy('tt-pet', d) ->> 'award')::uuid;
  perform tests.become_service();
  if profile_projection(c) -> 'trophies' is distinct from '[]'::jsonb and jsonb_array_length(profile_projection(c) -> 'trophies') is distinct from 1 then raise exception 'before any is shown only the belt shows: %', profile_projection(c) -> 'trophies'; end if;
  if profile_projection(c) #>> '{trophies,0,trophy}' is distinct from 'tt-belt' then raise exception 'a belt held shows with nothing chosen: %', profile_projection(c) -> 'trophies'; end if;
  -- show_trophies: three shown, in the player's order; a fourth is refused, and another character's, and a repeat.
  perform show_trophies(cat, c, array[third, pet, champion]);
  shelf := profile_projection(c) -> 'trophies';
  if (select string_agg(t ->> 'trophy', ',') from jsonb_array_elements(shelf) t) is distinct from 'tt-third,tt-pet,tt-champion,tt-belt' then raise exception 'the shown awards in order, then the belt: %', shelf; end if;
  -- `shown` is whether the character's posts show the award: its own choice, public as the posts are.
  if (select string_agg(t ->> 'trophy' || '=' || (t ->> 'shown'), ',' order by t ->> 'trophy') from jsonb_array_elements(trophies_of(c) -> 'awards') t)
     is distinct from 'tt-belt=false,tt-champion=true,tt-met=false,tt-pet=true,tt-third=true' then raise exception 'each award says whether it is shown: %', trophies_of(c); end if;
  said := pg_temp.refusal(format('select show_trophies(%L, %L, %L)', cat, c, array[third, pet, champion, extra]));
  if said is distinct from '4 trophies are shown; at most 3' then raise exception 'a fourth shown: %', said; end if;
  said := pg_temp.refusal(format('select show_trophies(%L, %L, %L)', cat, c, array[third, other]));
  if said is distinct from 'that trophy is not this character''s' then raise exception 'another character''s award: %', said; end if;
  said := pg_temp.refusal(format('select show_trophies(%L, %L, %L)', cat, c, array[third, third]));
  if said is distinct from 'a trophy is shown once' then raise exception 'the same award twice: %', said; end if;
  said := pg_temp.refusal(format('select show_trophies(%L, %L, %L)', dan, c, array[third]));
  if said is distinct from 'you do not play that character' then raise exception 'another player''s show_trophies: %', said; end if;
  if (select count(*) from trophies_shown where character = c) is distinct from 3::bigint then raise exception 'a refused show_trophies changed the shown set'; end if;
  -- A shown belt is shown once, in its place.
  perform show_trophies(cat, c, array[belt, pet]);
  if (select string_agg(t ->> 'trophy', ',') from jsonb_array_elements(profile_projection(c) -> 'trophies') t) is distinct from 'tt-belt,tt-pet' then raise exception 'a shown belt is not listed twice: %', profile_projection(c) -> 'trophies'; end if;
  perform show_trophies(cat, c, array[pet, third]);
  -- A reversed award leaves profile_projection's trophies at once, and its place in the shown set.
  perform tests.become(boss);
  perform reverse_award(pet);
  perform tests.become_service();
  if (select string_agg(t ->> 'trophy', ',') from jsonb_array_elements(profile_projection(c) -> 'trophies') t) is distinct from 'tt-third,tt-belt' then raise exception 'a reversed award is still on the shelf: %', profile_projection(c) -> 'trophies'; end if;
  said := pg_temp.refusal(format('select show_trophies(%L, %L, %L)', cat, c, array[pet]));
  if said is distinct from 'that trophy has been taken back' then raise exception 'showing a reversed award: %', said; end if;
  -- The belt passes to Dan: it leaves Cat's shelf at once and is on Dan's.
  perform tests.become(boss);
  perform award_trophy('tt-belt', d);
  perform tests.become_service();
  if (select string_agg(t ->> 'trophy', ',') from jsonb_array_elements(profile_projection(c) -> 'trophies') t) is distinct from 'tt-third' then raise exception 'a belt lost is still on the shelf: %', profile_projection(c) -> 'trophies'; end if;
  if (select string_agg(t ->> 'trophy', ',' order by t ->> 'trophy') from jsonb_array_elements(profile_projection(d) -> 'trophies') t) is distinct from 'tt-belt' then raise exception 'a belt won is on the shelf: %', profile_projection(d) -> 'trophies'; end if;
  -- A character with no profile row is no projection, as before.
  perform show_trophies(cat, c, '{}');
  if (select count(*) from trophies_shown where character = c) is distinct from 0::bigint then raise exception 'an empty list shows nothing'; end if;
  -- Callable by the service alone: a player cannot name another account.
  perform tests.become(cat);
  if pg_temp.refusal(format('select show_trophies(%L, %L, %L)', cat, c, '{}'::uuid[])) is null then raise exception 'a player called show_trophies'; end if;
  perform tests.unbecome();
end $$;

-- ---- The lookups are by character and by trophy: the indexes serve them ----
create function pg_temp.explain_lines(stmt text) returns setof text language plpgsql as $$
declare l text;
begin
  for l in execute 'explain ' || stmt loop return next l; end loop;
end $$;

select tests.unbecome();
do $$
declare
  eve uuid := tests.account('tt-eve'); e uuid := tests.character(eve, 'Tt Eve');
  plan text; page jsonb; nxt jsonb; tie uuid;
begin
  insert into trophy_awards (trophy, character, by) select 'tt-pet', e, 'admin' from generate_series(1, 300);
  analyze trophy_awards;
  -- With a scan off the table, what the planner reaches for is the index that serves the question.
  perform set_config('enable_seqscan', 'off', true);
  plan := (select string_agg(l, ' ') from pg_temp.explain_lines(format('select a.id from trophy_awards a where a.character = %L', e)) l);
  if plan not like '%trophy_awards_by_character%' then raise exception 'a character''s awards are a lookup by character: %', plan; end if;
  plan := (select string_agg(l, ' ') from pg_temp.explain_lines('select a.id from trophy_awards a where a.trophy = ''tt-belt'' order by a.at desc, a.id desc limit 1') l);
  if plan not like '%trophy_awards_by_trophy%' then raise exception 'a belt''s holder is a probe of the kind''s awards in time order: %', plan; end if;
  perform set_config('enable_seqscan', 'on', true);
  -- A page: newest first, at most `most` (capped at 100), and whether there are more; `before` continues from the last one's time.
  page := trophies_of(e);
  if jsonb_array_length(page -> 'awards') is distinct from 50 or (page ->> 'more')::boolean is distinct from true then raise exception 'a page is 50 by default, with more to come: %', page; end if;
  if jsonb_array_length(trophies_of(e, null, 100000) -> 'awards') is distinct from 100 then raise exception 'a page is capped at 100'; end if;
  if jsonb_array_length(trophies_of(e, null, 0) -> 'awards') is distinct from 1 then raise exception 'a page holds at least one'; end if;
  page := trophies_of(e, null, 3);
  if jsonb_array_length(page -> 'awards') is distinct from 3 or (page ->> 'more')::boolean is distinct from true then raise exception 'most is how many: %', page; end if;
  nxt := trophies_of(e, ((page -> 'awards' -> 2) ->> 'at')::timestamptz, 3);
  if (nxt -> 'awards' -> 0 ->> 'award') is not distinct from (page -> 'awards' -> 2 ->> 'award') or (nxt -> 'awards' -> 0 ->> 'at')::timestamptz >= ((page -> 'awards' -> 2) ->> 'at')::timestamptz then raise exception 'before continues after the last of the page: %', nxt; end if;
  if (select count(distinct x ->> 'award') from jsonb_array_elements((page -> 'awards') || (nxt -> 'awards')) x) is distinct from 6::bigint then raise exception 'pages do not overlap'; end if;
  -- Awards at one identical time, paged one at a time by (time, id): none skipped, none repeated.
  tie := tests.character(eve, 'Tt Tie');
  insert into trophy_awards (trophy, character, by, at) select 'tt-pet', tie, 'admin', timestamptz '2030-01-01' from generate_series(1, 5);
  declare
    cur jsonb := trophies_of(tie, null, 1);
    seen_ids text[] := '{}';
    i integer := 0;
  begin
    loop
      seen_ids := seen_ids || (cur -> 'awards' -> 0 ->> 'award');
      i := i + 1;
      exit when not (cur ->> 'more')::boolean or i >= 5;
      cur := trophies_of(tie, (cur -> 'awards' -> 0 ->> 'at')::timestamptz, 1, (cur -> 'awards' -> 0 ->> 'award')::uuid);
    end loop;
    if (select count(distinct x) from unnest(seen_ids) x) is distinct from 5 or (select count(*) from trophy_awards where character = tie
         and id::text = any (seen_ids)) is distinct from 5::bigint then raise exception 'paging awards of one time skipped or repeated: %', seen_ids; end if;
    if (cur ->> 'more')::boolean is distinct from false then raise exception 'the last tied award is the last: %', cur; end if;
  end;
  if (trophies_of(e, null, 500) ->> 'more')::boolean is distinct from true then raise exception 'there are 200 past a page of 100'; end if;
  if (trophies_of(e, (select min(at) from trophy_awards where character = e) + interval '1 microsecond', 10) ->> 'more')::boolean is distinct from false
     or jsonb_array_length(trophies_of(e, (select min(at) from trophy_awards where character = e) + interval '1 microsecond', 10) -> 'awards') is distinct from 1 then raise exception 'the last page says there is no more'; end if;
end $$;

-- ---- The season's places: ties share a place, the next mask takes the next place (dense, #453), and a place past third gets nothing ----
create table pg_temp.ts (c1 uuid, c2 uuid, c3 uuid, c4 uuid, c5 uuid);
select tests.unbecome();
do $$
declare
  t0 timestamptz := (select starts_at from seasons where ends_at is null);
  s1 bigint := (select id from seasons where ends_at is null);
  p1 uuid := tests.account('ts-1'); p2 uuid := tests.account('ts-2'); p3 uuid := tests.account('ts-3');
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  ended timestamptz := t0 + interval '1 day';
  s2 bigint; s3 bigint; seen jsonb; adm uuid := tests.account('ts-adm');
begin
  c1 := tests.character(p1, 'Ts One', 'alpha', t0 + interval '1 hour'); c2 := tests.character(p2, 'Ts Two', 'alpha', t0 + interval '1 hour');
  c3 := tests.character(p3, 'Ts Three', 'alpha', t0 + interval '1 hour'); c4 := tests.character(p1, 'Ts Four', 'alpha', t0 + interval '1 hour');
  c5 := tests.character(p2, 'Ts Five', 'alpha', t0 + interval '1 hour');
  insert into pg_temp.ts values (c1, c2, c3, c4, c5);
  -- A tie at second: places 1, 2, 2, 3, 4, dense (#453: a tie never costs the next mask its place). Two Runner-Up and a Third for the next: the trophy follows the table.
  insert into standings (character, season, amount) values (c1, s1, 700), (c2, s1, 500), (c3, s1, 500), (c4, s1, 300), (c5, s1, 100)
  on conflict (season, character) do update set amount = excluded.amount;
  if reveal_season(ended) is null then raise exception 'the season did not roll over'; end if;
  if (select string_agg(c.name || '=' || r.place, ',' order by r.place, c.name) from season_results r join characters c on c.id = r.character where r.season = s1 and c.name like 'Ts %')
     is distinct from 'Ts One=1,Ts Three=2,Ts Two=2,Ts Four=3,Ts Five=4' then
    raise exception 'a tie at second places the next mask third (1, 2, 2, 3, 4; #453): %', (select string_agg(c.name || '=' || r.place, ',' order by r.place, c.name) from season_results r join characters c on c.id = r.character where r.season = s1 and c.name like 'Ts %');
  end if;
  if (select string_agg(a.trophy || '=' || c.name, ',' order by a.trophy, c.name) from trophy_awards a join characters c on c.id = a.character where a.season = s1)
     is distinct from 'tt-champion=Ts One,tt-runner-up=Ts Three,tt-runner-up=Ts Two,tt-third=Ts Four' then
    raise exception 'a tie at second writes two Runner-Up and, the places being 1, 2, 2, 3, a Third (#453): %', (select string_agg(a.trophy || '=' || c.name, ',' order by a.trophy, c.name) from trophy_awards a join characters c on c.id = a.character where a.season = s1);
  end if;
  if exists (select 1 from trophy_awards a where a.season = s1 and a.by is distinct from 'season') or exists (select 1 from trophy_awards a join characters c on c.id = a.character where c.staff is not null) then raise exception 'season awards are the season''s, and none is a staff character''s'; end if;
  if (select t ->> 'by' from jsonb_array_elements(trophies_of(c1) -> 'awards') t where t ->> 'trophy' = 'tt-champion') is distinct from 'the season' then raise exception 'a season award says "the season"'; end if;
  if (select (t ->> 'season')::integer from jsonb_array_elements(trophies_of(c1) -> 'awards') t where t ->> 'trophy' = 'tt-champion') is distinct from 1 then raise exception 'a season award names its season'; end if;
  if (select t -> 'move' from jsonb_array_elements(trophies_of(c1) -> 'awards') t where t ->> 'trophy' = 'tt-champion') is distinct from 'null'::jsonb then raise exception 'a season award names no move'; end if;
  -- The next season: a tie at first. Places 1, 1, 2, 3, 4 (#453): two Champion, one Runner-Up, and a Third for the next.
  s2 := (select id from seasons where ends_at is null);
  insert into standings (character, season, amount) values (c1, s2, 500), (c2, s2, 500), (c3, s2, 300), (c4, s2, 200), (c5, s2, 100)
  on conflict (season, character) do update set amount = excluded.amount;
  if reveal_season(ended + interval '1 day') is null then raise exception 'the second season did not roll over'; end if;
  if (select string_agg(c.name || '=' || r.place, ',' order by r.place, c.name) from season_results r join characters c on c.id = r.character where r.season = s2 and c.name like 'Ts %')
     is distinct from 'Ts One=1,Ts Two=1,Ts Three=2,Ts Four=3,Ts Five=4' then
    raise exception 'a tie at first places the next mask second (1, 1, 2, 3, 4; #453): %', (select string_agg(c.name || '=' || r.place, ',' order by r.place, c.name) from season_results r join characters c on c.id = r.character where r.season = s2 and c.name like 'Ts %');
  end if;
  if (select string_agg(a.trophy || '=' || c.name, ',' order by a.trophy, c.name) from trophy_awards a join characters c on c.id = a.character where a.season = s2)
     is distinct from 'tt-champion=Ts One,tt-champion=Ts Two,tt-runner-up=Ts Three,tt-third=Ts Four' then
    raise exception 'a tie at first writes two Champion, one Runner-Up and one Third (#453): %', (select string_agg(a.trophy || '=' || c.name, ',' order by a.trophy, c.name) from trophy_awards a join characters c on c.id = a.character where a.season = s2);
  end if;
  if (select count(*) from trophy_awards where character = c1 and trophy = 'tt-champion') is distinct from 2::bigint then raise exception 'a character can win a place in two seasons'; end if;
  -- The awards cannot be written: the season still ends, with its results, and the failure is kept for an admin, who can read it and give the places by hand.
  -- c1 stands above zero, so the season has a place to give (#492: a season where every mask stands at 0 gives none, and has no award to fail).
  insert into standings (character, season, amount) select c1, id, 1 from seasons where ends_at is null on conflict (season, character) do update set amount = excluded.amount;
  s3 := (select id from seasons where ends_at is null);
  alter table trophy_awards add constraint tt_poison check (false) not valid;
  if pg_temp.error(format('select reveal_season(%L)', ended + interval '2 days')) is not null then raise exception 'a season whose awards could not be written did not end: %', pg_temp.error(format('select reveal_season(%L)', ended + interval '2 days')); end if;
  alter table trophy_awards drop constraint tt_poison;
  if (select ends_at from seasons where id = s3) is null or (select count(*) from seasons where ends_at is null) is distinct from 1::bigint then raise exception 'a season with its awards unwritten did not end'; end if;
  if not exists (select 1 from season_results where season = s3) or exists (select 1 from trophy_awards where season = s3) then raise exception 'the results stand and no award was half-written'; end if;
  if (select count(*) from trophy_award_failures where season = s3 and move_act is null) is distinct from 1::bigint then raise exception 'the failed season is recorded'; end if;
  insert into admins (account) values (adm);
  perform tests.become(adm);
  seen := trophy_award_failures() -> 'failures';
  if jsonb_array_length(seen) is distinct from 1 or (seen -> 0 ->> 'season')::bigint is distinct from (select number from seasons where id = s3) or seen -> 0 ->> 'move' is not null or seen -> 0 ->> 'error' not like '%tt_poison%' then raise exception 'an admin reads the failed season: %', seen; end if;
  perform tests.become(p1);
  if pg_temp.refusal('select trophy_award_failures()') is null then raise exception 'a player read the award failures'; end if;
  perform tests.unbecome();
end $$;

-- ---- A standing of 0 or below takes no place and no trophy (#492): places count standings above zero, densely ----
-- The owner's answer on #492 (option 2): a mask whose season standing is 0 or below is listed unplaced, with no place and no season place trophy, and
-- no alert of one; the masks above zero are placed densely (#453). The live standings number places the same way, since between seasons they show the
-- very table the results froze.
select tests.unbecome();
do $$
declare
  t0 timestamptz := (select starts_at from seasons where ends_at is null);
  sa bigint := (select id from seasons where ends_at is null);
  na integer := (select number from seasons where ends_at is null);
  sb bigint; nb integer;
  pz uuid[] := array[]::uuid[]; cz uuid[] := array[]::uuid[];
  top uuid; tie1 uuid; tie2 uuid; zero1 uuid; zero2 uuid; below uuid;
  i integer; seen jsonb; viewer uuid := tests.account('tz-viewer');
begin
  top := tests.character(tests.account('tz-top'), 'Tz Top', 'alpha', t0 + interval '1 hour');
  for i in 1..5 loop
    pz := pz || tests.account('tz-idle-' || i);
    cz := cz || tests.character(pz[i], 'Tz Idle ' || i, 'alpha', t0 + interval '1 hour');
  end loop;
  -- One mask at 500 and five at 0: one place 1 and five unplaced.
  insert into standings (character, season, amount) values (top, sa, 500) on conflict (season, character) do update set amount = excluded.amount;
  insert into standings (character, season, amount) select c, sa, 0 from unnest(cz) c on conflict (season, character) do update set amount = excluded.amount;
  -- Live, as the season stands: the mask above zero is first, and a mask at 0 holds no place on the standings, its place, or the view.
  if (standing_place(top) ->> 'place')::integer is distinct from 1 then raise exception 'a standing above zero is placed live: %', standing_place(top); end if;
  if standing_place(cz[1]) -> 'place' is distinct from 'null'::jsonb or (standing_place(cz[1]) ->> 'standing')::integer is distinct from 0 then
    raise exception 'a standing of 0 holds no place live, and still says its standing (#492): %', standing_place(cz[1]);
  end if;
  if (select count(*) from season_standings v where v.character = any (cz) and v.place is null) is distinct from 5::bigint or (select place from season_standings where character = top) is distinct from 1::bigint then
    raise exception 'season_standings places a standing of 0 (#492): %', (select jsonb_agg(to_jsonb(v)) from season_standings v where v.character = any (cz || top));
  end if;
  if (select count(*) from standings_page(0, 1000) p where p.character = any (cz) and p.place is null) is distinct from 5::bigint or (select p.place from standings_page(0, 1000) p where p.character = top) is distinct from 1::bigint then
    raise exception 'standings_page places a standing of 0 (#492): %', (select jsonb_agg(to_jsonb(p)) from standings_page(0, 1000) p where p.character = any (cz || top));
  end if;
  if reveal_season(t0 + interval '1 day') is null then raise exception 'the season did not roll over'; end if;
  if (select place from season_results where season = sa and character = top) is distinct from 1 then raise exception 'the mask at 500 is first'; end if;
  if (select count(*) from season_results where season = sa and character = any (cz) and place is null and standing = 0) is distinct from 5::bigint then
    raise exception 'the five at 0 are unplaced (#492): %', (select jsonb_agg(to_jsonb(r)) from season_results r where r.season = sa and r.character = any (cz));
  end if;
  if exists (select 1 from season_results where season = sa and standing <= 0 and place is not null) then raise exception 'no standing of 0 or below has a place (#492)'; end if;
  if (select string_agg(a.trophy, ',') from trophy_awards a where a.season = sa) is distinct from 'tt-champion' or (select character from trophy_awards where season = sa) is distinct from top then
    raise exception 'one Champion only, and no place trophy to a standing of 0 (#492): %', (select jsonb_agg(to_jsonb(a)) from trophy_awards a where a.season = sa);
  end if;
  if exists (select 1 from alerts where account = any (pz) and kind = 'trophy') then raise exception 'an idle mask''s player was alerted to a trophy (#492)'; end if;
  if (select count(*) from alerts where account = (select owner from characters where id = top) and kind = 'trophy') is distinct from 1::bigint then raise exception 'the Champion''s player is alerted once'; end if;
  -- Season News: the podium is the placed masks alone.
  seen := (select n.detail -> 'top' from season_news(null, 50) n where n.kind = 'results' and n.season = na);
  if jsonb_array_length(seen) is distinct from 1 or seen -> 0 ->> 'character' is distinct from top::text then raise exception 'the results item''s top is the placed masks alone (#492): %', seen; end if;

  -- The next season: a tie above zero beside zeros and a standing below zero. 300, 300, 0, 0, -20: two places 1 and three unplaced, two Champions, no Runner-Up.
  sb := (select id from seasons where ends_at is null);
  nb := (select number from seasons where ends_at is null);
  tie1 := cz[1]; tie2 := cz[2]; zero1 := cz[3]; zero2 := cz[4]; below := cz[5];
  insert into standings (character, season, amount) values (tie1, sb, 300), (tie2, sb, 300), (zero1, sb, 0), (zero2, sb, 0), (below, sb, -20), (top, sb, 0)
  on conflict (season, character) do update set amount = excluded.amount;
  if standing_place(below) -> 'place' is distinct from 'null'::jsonb or (standing_place(below) ->> 'standing')::integer is distinct from -20 then raise exception 'a standing below zero holds no place live (#492): %', standing_place(below); end if;
  if (standing_place(tie2) ->> 'place')::integer is distinct from 1 then raise exception 'a tie above zero shares place 1: %', standing_place(tie2); end if;
  if (select string_agg(p.name || '=' || coalesce(p.place::text, '-'), ',' order by p.standing desc, p.name) from standings_page(0, 1000) p where p.character = any (cz || top))
     is distinct from 'Tz Idle 1=1,Tz Idle 2=1,Tz Idle 3=-,Tz Idle 4=-,Tz Top=-,Tz Idle 5=-' then
    raise exception 'standings_page: a tie above zero shares 1, and 0 and below are unplaced (#492): %', (select string_agg(p.name || '=' || coalesce(p.place::text, '-'), ',' order by p.standing desc, p.name) from standings_page(0, 1000) p where p.character = any (cz || top));
  end if;
  if reveal_season(t0 + interval '2 days') is null then raise exception 'the next season did not roll over'; end if;
  if (select string_agg(c.name || '=' || coalesce(r.place::text, '-'), ',' order by r.standing desc, c.name) from season_results r join characters c on c.id = r.character where r.season = sb and c.name like 'Tz %')
     is distinct from 'Tz Idle 1=1,Tz Idle 2=1,Tz Idle 3=-,Tz Idle 4=-,Tz Top=-,Tz Idle 5=-' then
    raise exception 'a tie above zero shares place 1 beside zeros and a negative, all unplaced (#492): %', (select string_agg(c.name || '=' || coalesce(r.place::text, '-'), ',' order by r.standing desc, c.name) from season_results r join characters c on c.id = r.character where r.season = sb and c.name like 'Tz %');
  end if;
  if (select string_agg(a.trophy || '=' || c.name, ',' order by c.name) from trophy_awards a join characters c on c.id = a.character where a.season = sb)
     is distinct from 'tt-champion=Tz Idle 1,tt-champion=Tz Idle 2' then
    raise exception 'two Champions for the tie, and nothing for 0 or below (#492): %', (select string_agg(a.trophy || '=' || c.name, ',' order by c.name) from trophy_awards a join characters c on c.id = a.character where a.season = sb);
  end if;
  if exists (select 1 from alerts where account = any (pz[3:5]) and kind = 'trophy') then raise exception 'a mask at 0 or below was alerted to a trophy (#492)'; end if;

  -- The reads: a page lists the placed first, then the unplaced by standing, then name; the lowest standing is last.
  perform tests.become(viewer);
  if (select count(*) from results_page(nb, 1) r where r.character = any (cz) and r.place is null) is distinct from 3::bigint then
    raise exception 'results_page lists three unplaced, with no place (#492): %', (select jsonb_agg(to_jsonb(r)) from results_page(nb, 1) r);
  end if;
  if result_place(nb, tie1) is distinct from 0 or result_place(nb, tie2) is distinct from 1 then raise exception 'the placed masks come first: %, %', result_place(nb, tie1), result_place(nb, tie2); end if;
  if result_place(nb, below) is distinct from (select results_count - 1 from seasons where id = sb) then raise exception 'the standing below zero is last: % of %', result_place(nb, below), (select results_count from seasons where id = sb); end if;
  if not (result_place(nb, zero1) > result_place(nb, tie2) and result_place(nb, zero1) < result_place(nb, zero2) and result_place(nb, zero2) < result_place(nb, below)) then
    raise exception 'unplaced masks follow the placed, by standing and then name: %, %, %', result_place(nb, zero1), result_place(nb, zero2), result_place(nb, below);
  end if;
  if (select array_agg(r.character order by o) from results_page(nb, 1) with ordinality as r(character, name, place, standing, shown, o) where r.character = any (cz || top))
     is distinct from array[tie1, tie2, zero1, zero2, top, below] then
    raise exception 'results_page orders the placed, then the unplaced by standing and name: %', (select jsonb_agg(to_jsonb(r)) from results_page(nb, 1) r);
  end if;
  if (select (e ->> 'place') from jsonb_array_elements(profile_page(below) -> 'seasons') e where (e ->> 'season')::integer = nb) is not null
     or not exists (select 1 from jsonb_array_elements(profile_page(below) -> 'seasons') e where (e ->> 'season')::integer = nb and e -> 'place' = 'null'::jsonb and (e ->> 'standing')::integer = -20) then
    raise exception 'the profile lists an unplaced season with no place and its standing (#492): %', profile_page(below) -> 'seasons';
  end if;
  seen := (select n.detail -> 'top' from season_news(null, 50) n where n.kind = 'results' and n.season = nb);
  if (select string_agg(e ->> 'name', ',' order by e ->> 'name') from jsonb_array_elements(seen) e) is distinct from 'Tz Idle 1,Tz Idle 2' then raise exception 'the podium is the two Champions alone (#492): %', seen; end if;
  perform tests.unbecome();
end $$;

-- ---- The podium costs three rows, however many masks are unplaced (#492, the delta review's D1) ----
-- season_news's results item reads a season's first three placed rows from season_results_by_standing. Placed rows are exactly those standing above
-- zero, so the read names `standing > 0`, which the index can hold as its condition and stop at the third. `place is not null` alone is a filter on the
-- heap: a season with fewer than three placed rows (at a busy instance, one where most masks did nothing) reads every row of the season to find none.
-- The read is taken from season_news's own definition, so this is the plan of the code as written: a season of 20,000 unplaced rows and one placed,
-- as the review measured it, and the plan holds `standing` in its index condition and removes no row by a filter.
do $$
declare ln record; plan text := ''; podium text; season bigint;
begin
  podium := substring(pg_get_functiondef('season_news(timestamptz,integer)'::regprocedure) from '\((select r\.\* from season_results r where r\.season = s\.id [^()]* limit 3)\)');
  if podium is null then raise exception 'season_news reads its podium as this check expects: %', pg_get_functiondef('season_news(timestamptz,integer)'::regprocedure); end if;
  insert into seasons (number, starts_at, ends_at) values (9000, '1990-01-01', '1990-01-02') returning id into season;
  -- Rows of masks that need not exist: the plan reads season_results alone, and a restore writes the table this way.
  perform set_config('session_replication_role', 'replica', true);
  insert into season_results (season, character, name, place, standing)
  select season, gen_random_uuid(), 'Podium ' || g, case when g = 1 then 1 end, case when g = 1 then 500 else 0 end from generate_series(1, 20000) g;
  perform set_config('session_replication_role', 'origin', true);
  analyze season_results;
  for ln in execute 'explain (analyze, costs off, timing off, summary off) ' || replace(podium, 's.id', season::text) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan !~ 'Index Cond: [^\n]*standing' or plan ~ 'Rows Removed by Filter: [0-9]{3,}' then
    raise exception 'the podium reads its three rows from an index condition on standing, not every unplaced row:%', plan;
  end if;
end $$;

-- ---- A met demand credits the characters whose Acts made it; reading who reacted gets a reactor nothing ----
create function pg_temp.landed(on_board uuid, demand jsonb) returns uuid language plpgsql as $$
begin
  return (write_staff_act('tt-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.',
      'params', jsonb_build_object('board', on_board, 'name', 'Renamed', 'premise', 'The subject', 'description', 'About it'), 'demand', demand))) ->> 'id')::uuid;
end $$;

select tests.unbecome();
do $$
declare
  seen jsonb;
  ann uuid := tests.account('td-ann'); bob uuid := tests.account('td-bob'); cat uuid := tests.account('td-cat'); dan uuid := tests.account('td-dan'); eve uuid := tests.account('td-eve');
  a uuid := tests.character(ann, 'Td Ann'); b uuid := tests.character(bob, 'Td Bob'); c uuid := tests.character(cat, 'Td Cat'); d uuid := tests.character(dan, 'Td Dan');
  reactor uuid := tests.character(eve, 'Td Reactor');
  boss uuid := (select id from characters where staff = 'tt-boss');
  board uuid; th uuid; later timestamptz := now() + interval '10 minutes';
  early uuid; pa uuid; pb uuid; pc uuid; pboss uuid; pr uuid; pq uuid;
  mv uuid; mv_pb uuid; mv_distinct uuid; mv_char uuid; mv_cross uuid; mv_apology uuid; mv_quad uuid;
  who uuid[]; ran jsonb;
  src text;
begin
  insert into boards (slug, name, description) values ('td-board', 'Td Board', 'x') returning id into board;
  insert into threads (board, title) values (board, 'Td thread') returning id into th;
  -- The Boss's own post and a character that posted before the landing: neither counts.
  early := tests.post(c, th, 'Before.', now() - interval '1 hour');
  insert into reaction_tallies (act, kind, count) values (early, 'up', 9);
  mv_quad := pg_temp.landed(board, jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', board, 'quadrant', 'excitedPositive', 'count', 3)));
  mv_pb := pg_temp.landed(board, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 2)));
  mv_distinct := pg_temp.landed(board, jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', jsonb_build_object('board', board, 'count', 2)));
  mv_char := pg_temp.landed(board, jsonb_build_object('kind', 'characterPostsInThread', 'params', jsonb_build_object('character', b, 'thread', th)));
  mv_cross := pg_temp.landed(board, jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', a, 'b', b, 'reactions', 1)));
  mv_apology := pg_temp.landed(board, jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb));
  -- After the landing: Ann and Bob post, Bob's post draws the quadrant, Ann's too; Cat posts and draws nothing. The reactor posts nothing and reacts to both.
  pa := tests.post(a, th, 'Ann.', later);
  pb := tests.post(b, th, 'Bob.', later + interval '1 minute');
  pc := tests.post(c, th, 'Cat.', later + interval '2 minutes');
  perform set_config('kayfabb.staff_writer', 'on', true);
  pboss := tests.post(boss, th, 'The Boss posts.', later + interval '3 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into reaction_tallies (act, kind, count) values (pa, 'up', 1), (pb, 'wow', 1), (pb, 'up', 1), (pboss, 'up', 5), (pc, 'boo', 4);
  insert into reactions (act, reactor_character, reactor_account, kind, slot) values (pa, reactor, eve, 'up', 1), (pb, reactor, eve, 'wow', 1), (pc, reactor, eve, 'meh', 1), (pboss, reactor, eve, 'up', 2);
  -- Bob quotes Ann and Ann quotes Bob, each reply drawing a reaction.
  pq := tests.act(b, 'post', th, jsonb_build_object('body', 'Bob quotes.'), pa, later + interval '4 minutes');
  pr := tests.act(a, 'post', th, jsonb_build_object('body', 'Ann quotes.'), pb, later + interval '5 minutes');
  insert into reaction_tallies (act, kind, count) values (pq, 'meh', 1), (pr, 'meh', 1);
  -- An apology Dan made, accepted.
  insert into apologies (move_act, apology_act, character, state) select mv_apology, tests.post(d, th, 'Sorry.', later + interval '6 minutes'), d, 'accepted';

  -- The function's own reading, kind by kind.
  src := pg_temp.names(demand_contributors(mv_quad));
  if src is distinct from 'Td Ann,Td Bob' then raise exception 'quadrantOnBoard credits the authors of posts that drew the quadrant, not the reactor, the Boss or Cat: %', src; end if;
  src := pg_temp.names(demand_contributors(mv_pb));
  if src is distinct from 'Td Ann,Td Bob' then raise exception 'postsOnBoard credits the authors of the first posts counted (Ann and Bob): %', src; end if;
  src := pg_temp.names(demand_contributors(mv_distinct));
  if src is distinct from 'Td Ann,Td Bob' then raise exception 'distinctCharactersOnBoard credits the first characters to post: %', src; end if;
  if demand_contributors(mv_char) is distinct from array[b] then raise exception 'characterPostsInThread credits that character: %', demand_contributors(mv_char); end if;
  src := pg_temp.names(demand_contributors(mv_cross));
  if src is distinct from 'Td Ann,Td Bob' then raise exception 'crossQuote credits the pair: %', src; end if;
  if demand_contributors(mv_apology) is distinct from array[d] then raise exception 'apologyAccepted credits the apologizing character: %', demand_contributors(mv_apology); end if;
  if reactor = any (demand_contributors(mv_quad)) or reactor = any (demand_contributors(mv_pb)) or reactor = any (demand_contributors(mv_cross)) then raise exception 'a reactor who authored nothing was credited'; end if;
  if boss = any (demand_contributors(mv_quad)) or boss = any (demand_contributors(mv_pb)) then raise exception 'a staff character was credited'; end if;
  if c = any (demand_contributors(mv_quad)) then raise exception 'a character whose only post drew the other quadrant, and an earlier post, was credited'; end if;
  if pg_temp.refusal(format('select demand_contributors(%L)', gen_random_uuid())) is null then raise exception 'a move that does not exist was read'; end if;

  -- The body names no `reactions` relation, and the matcher that says so finds one where there is one (a check that has only ever passed is not known to work).
  src := pg_get_functiondef('demand_contributors(uuid)'::regprocedure);
  if not pg_temp.names_reactions('select 1 from reactions r join reaction_tallies t on true') or not pg_temp.names_reactions('select 1 from reaction_tallies t join public.reactions r on true')
     or pg_temp.names_reactions('select 1 from reaction_tallies t where (p ->> ''reactions'')::integer > 0') then
    raise exception 'the matcher for a read of reactions does not match';
  end if;
  if pg_temp.names_reactions(src) then raise exception 'demand_contributors reads the reactions relation'; end if;
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'demand_contributors(uuid)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'demand_contributors is not owned by kayfabb_digest'; end if;
  if has_function_privilege('authenticated', 'demand_contributors(uuid)', 'execute') or has_function_privilege('anon', 'demand_contributors(uuid)', 'execute') or not has_function_privilege('service_role', 'demand_contributors(uuid)', 'execute') then
    raise exception 'demand_contributors is executable by the wrong roles';
  end if;

  -- The tick: the move is met and ended; each character that made it has the trophy, once, naming the move.
  update open_moves set checked_at = null;
  ran := system_tick();
  if not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = mv_quad and e.payload ->> 'why' = 'met') then raise exception 'the quadrant demand did not end met: %', ran; end if;
  if (select string_agg(c2.name, ',' order by c2.name) from trophy_awards a join characters c2 on c2.id = a.character where a.act = mv_quad and a.trophy = 'tt-met' and a.by = 'demand')
     is distinct from 'Td Ann,Td Bob' then raise exception 'a met demand credits the authors of the posts that drew the quadrant: %', (select string_agg(c2.name, ',' order by c2.name) from trophy_awards a join characters c2 on c2.id = a.character where a.act = mv_quad);
  end if;
  if exists (select 1 from trophy_awards a where a.character in (reactor, boss, c)) then raise exception 'the reactor, the Boss or Cat was given a trophy'; end if;
  if (ran ->> 'awardsFailed')::integer is distinct from 0 then raise exception 'the tick counted failed awards: %', ran; end if;
  if (select t ->> 'by' from jsonb_array_elements(trophies_of(a) -> 'awards') t where t ->> 'trophy' = 'tt-met' limit 1) is distinct from 'a met demand' then raise exception 'a met demand''s award says so'; end if;
  -- It links to the move: its Act, its thread and its number there, and nothing else of the Act.
  -- Read by the award's own id: Ann holds other tt-met awards from earlier blocks, and in one transaction they share a time, so
  -- "the first tt-met" would be whichever the id tie-break put first.
  if (select t -> 'move' from jsonb_array_elements(trophies_of(a) -> 'awards') t
       where t ->> 'award' = (select w.id::text from trophy_awards w where w.act = mv_quad and w.character = a))
     is distinct from (select jsonb_build_object('act', x.id, 'thread', x.thread, 'seq', x.seq) from acts_public x where x.id = mv_quad) then
    raise exception 'a met demand''s award links to its move: %', trophies_of(a);
  end if;
  perform system_tick();
  if (select count(*) from trophy_awards where act = mv_quad) is distinct from 2::bigint then raise exception 'a later tick gave the trophies again'; end if;

  -- When the awards cannot be written, the move is still ended, and the failure is kept.
  mv := pg_temp.landed(board, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 1)));
  perform tests.post(a, th, 'After the second landing.', later + interval '20 minutes');
  alter table trophy_awards add constraint tt_poison check (false) not valid;
  update open_moves set checked_at = null;
  ran := system_tick();
  if not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = mv and e.payload ->> 'why' = 'met') then raise exception 'a move whose trophies failed was not ended: %', ran; end if;
  if (ran ->> 'awardsFailed')::integer is distinct from 1 or (ran ->> 'met')::integer is distinct from 1 then raise exception 'the failure is counted in the tick''s answer: %', ran; end if;
  if (select count(*) from trophy_award_failures where move_act = mv) is distinct from 1::bigint then raise exception 'the failed move is recorded'; end if;
  if exists (select 1 from trophy_awards where act = mv) then raise exception 'a failed award left a row'; end if;
  alter table trophy_awards drop constraint tt_poison;
  -- An admin reads it, with the move, the trophy, the characters and the error; a player does not.
  insert into trophy_award_failures (move_act, error) select a.id, 'tt_unreadable' from acts a where a.kind = 'post' limit 1;
  update trophy_award_failures set at = now() - interval '2 hours' where season is not null;
  update trophy_award_failures set at = now() - interval '1 hour' where move_act = mv;
  update trophy_award_failures set at = now() where error = 'tt_unreadable';
  insert into admins (account) values (tests.account('td-adm'));
  perform tests.become((select id from auth.users where email = 'td-adm@test.invalid'));
  if (select count(*) from jsonb_array_elements(trophy_award_failures() -> 'failures') f where f ->> 'move' = mv::text and f ->> 'trophy' = 'tt-met' and f ->> 'error' like '%tt_poison%'
        and jsonb_array_length(f -> 'characters') > 0) is distinct from 1::bigint then raise exception 'an admin reads the failed demand: %', trophy_award_failures(); end if;
  -- Newest first, over rows whose times differ (a transaction's now() is one instant, so they are set): the season's failure, the move's, and a third whose move
  -- cannot be read (a post's Act is no move, so demand_contributors raises). That one must not make the admin's read fail: it is listed, its characters null.
  seen := trophy_award_failures() -> 'failures';
  if jsonb_array_length(seen) is distinct from 3 then raise exception 'one failure row made the admin read lose the others: %', seen; end if;
  if (select string_agg(f ->> 'error', ',' order by n) from jsonb_array_elements(seen) with ordinality t(f, n)) not like 'tt_unreadable,%tt_poison%,%tt_poison%' then raise exception 'newest first: %', seen; end if;
  if seen -> 0 -> 'characters' is distinct from 'null'::jsonb or seen -> 0 ->> 'error' <> 'tt_unreadable' then raise exception 'an unreadable demand''s characters are null: %', seen -> 0; end if;
  if jsonb_typeof(seen -> 1 -> 'characters') is distinct from 'array' or jsonb_typeof(seen -> 2 -> 'characters') is distinct from 'array' then raise exception 'the readable failures keep their characters: %', seen; end if;
  if (seen -> 1 ->> 'move') is distinct from mv::text then raise exception 'the move failure is second: %', seen; end if;
  perform tests.become(ann);
  if pg_temp.refusal('select trophy_award_failures()') is null then raise exception 'a player read the award failures'; end if;
  perform tests.unbecome();
end $$;

-- ---- A kind with no met-demand trophy gives none, and the move still ends ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tn-ann'); a uuid := tests.character(ann, 'Tn Ann');
  board uuid; th uuid; mv uuid;
begin
  insert into boards (slug, name, description) values ('tn-board', 'Tn Board', 'x') returning id into board;
  insert into threads (board, title) values (board, 'Tn thread') returning id into th;
  update trophy_kinds set demand_met = false;
  mv := pg_temp.landed(board, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 1)));
  perform tests.post(a, th, 'Hi.', now() + interval '5 minutes');
  update open_moves set checked_at = null;
  if (system_tick() ->> 'awardsFailed')::integer is distinct from 0 then raise exception 'no kind is no failure'; end if;
  if not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = mv and e.payload ->> 'why' = 'met') then raise exception 'the move did not end'; end if;
  if exists (select 1 from trophy_awards where act = mv) then raise exception 'a trophy was given with no kind for it'; end if;
end $$;

-- ---- The awards and their takings back are never edited; a player cannot give, take back or make; no staff character is given one ----
select tests.unbecome();
do $$
declare
  fay uuid := tests.account('ta-fay'); gus uuid := tests.account('ta-gus'); hal uuid := tests.account('ta-hal'); boss uuid := tests.account('ta-admin');
  f uuid := tests.character(fay, 'Ta Fay'); g uuid := tests.character(gus, 'Ta Gus');
  staff uuid := (select id from characters where staff = 'tt-boss');
  award uuid; said text; made jsonb; art_key text := 'tt-art-1.webp'; waiting uuid;
begin
  insert into characters (owner, name) values (hal, 'Ta Waiting') returning id into waiting;
  insert into admins (account) values (boss);
  perform tests.become(boss);
  award := (award_trophy('tt-pet', f) ->> 'award')::uuid;
  perform reverse_award(award);
  perform tests.unbecome();
  said := pg_temp.error('update trophy_awards set line = ''x''');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'an update of an award: %', said; end if;
  said := pg_temp.error('delete from trophy_awards');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a delete of an award: %', said; end if;
  said := pg_temp.error('truncate trophy_awards cascade');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a truncate of the awards: %', said; end if;
  said := pg_temp.error('update trophy_reversals set at = now()');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'an update of a reversal: %', said; end if;
  said := pg_temp.error('delete from trophy_reversals');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a delete of a reversal: %', said; end if;
  said := pg_temp.error('truncate trophy_reversals');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a truncate of the reversals: %', said; end if;
  -- Not even in replica mode, as a restore runs.
  perform set_config('session_replication_role', 'replica', true);
  said := pg_temp.error('update trophy_awards set line = ''x''');
  perform set_config('session_replication_role', 'origin', true);
  if said is null then raise exception 'an award was edited in replica mode'; end if;
  -- A player: refused, in the words of the others, and nothing is written.
  perform tests.become(gus);
  said := pg_temp.refusal(format('select award_trophy(%L, %L)', 'tt-pet', g));
  if said is distinct from 'only an admin gives a trophy' then raise exception 'a player gave a trophy: %', said; end if;
  said := pg_temp.refusal(format('select reverse_award(%L)', award));
  if said is distinct from 'only an admin takes a trophy back' then raise exception 'a player took a trophy back: %', said; end if;
  said := pg_temp.refusal('select make_trophy(''Mine'')');
  if said is distinct from 'only an admin makes a trophy' then raise exception 'a player made a trophy: %', said; end if;
  if pg_temp.error('insert into trophy_awards (trophy, character, by) values (''tt-pet'', ''' || g || ''', ''admin'')') not like 'permission denied%' then raise exception 'a player wrote an award'; end if;
  perform tests.become(boss);
  -- An admin is refused a staff character, an unknown kind and an unknown character, in words that name no account.
  said := pg_temp.refusal(format('select award_trophy(%L, %L)', 'tt-pet', staff));
  if said is distinct from 'a staff character is never given a trophy' then raise exception 'a staff character was given a trophy: %', said; end if;
  -- A character that has not debuted is refused, in plain words, and no award is written (a belt on a mask nobody has met would name it in the Boss's reference).
  said := pg_temp.refusal(format('select award_trophy(%L, %L)', 'tt-belt', waiting));
  if said is distinct from 'that character has not debuted' then raise exception 'an undebuted character was given a trophy: %', said; end if;
  said := pg_temp.refusal(format('select award_trophy(%L, %L)', 'tt-nope', g));
  if said is distinct from 'there is no trophy "tt-nope"' then raise exception 'an unknown kind: %', said; end if;
  said := pg_temp.refusal(format('select award_trophy(%L, %L)', 'tt-pet', gen_random_uuid()));
  if said is distinct from 'there is no such character' then raise exception 'an unknown character: %', said; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(award_trophy('tt-pet', f)) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(award_trophy('tt-pet', g)) k) then raise exception 'the answer is not the same for two players'; end if;
  perform tests.unbecome();
  said := pg_temp.error(format('insert into trophy_awards (trophy, character, by) values (%L, %L, %L)', 'tt-pet', staff, 'admin'));
  if said is distinct from 'a staff character is never given a trophy' then raise exception 'a direct write to a staff character: %', said; end if;
  if pg_temp.error(format('insert into trophy_awards (trophy, character, by) values (%L, %L, %L)', 'tt-pet', g, 'bogus')) is null then raise exception 'a giver that is no giver'; end if;
  if pg_temp.error(format('insert into trophy_awards (trophy, character, by) values (%L, %L, %L)', 'tt-pet', g, 'demand')) is null then raise exception 'a met demand with no move'; end if;
  -- make_trophy: an admin's kind has a generated key, and the art is a stored picture's key.
  perform tests.become(boss);
  said := pg_temp.refusal(format('select make_trophy(%L, null, %L)', 'Pictured', art_key));
  if said is distinct from 'no picture is stored under that key' then raise exception 'a picture that is not stored: %', said; end if;
  said := pg_temp.refusal(format('select make_trophy(%L, null, %L)', 'Pictured', '../x'));
  if said is distinct from 'that is not the key of a stored picture' then raise exception 'a key that is no key: %', said; end if;
  said := pg_temp.refusal(format('select make_trophy(%L)', repeat('x', 61)));
  if said is distinct from 'a trophy''s name is 1 to 60 characters' then raise exception 'a name too long: %', said; end if;
  perform tests.unbecome();
  insert into storage.objects (bucket_id, name) values ('trophies', art_key);
  perform tests.become(boss);
  made := make_trophy('Pictured', 'By hand.', art_key, true);
  if made ->> 'trophy' not like 'made-%' then raise exception 'an admin''s kind has a generated key: %', made; end if;
  if (select art || '/' || belt::text || '/' || coalesce(line, '') from trophy_kinds where key = made ->> 'trophy') is distinct from 'tt-art-1.webp/true/By hand.' then raise exception 'the kind''s columns'; end if;
  perform award_trophy(made ->> 'trophy', f);
  if (select (t ->> 'art') from jsonb_array_elements(trophies_of(f) -> 'awards') t where t ->> 'trophy' = made ->> 'trophy') is distinct from art_key then raise exception 'an admin-made kind shows its art'; end if;
  perform tests.unbecome();
  if (select made_by from trophy_kinds where key = made ->> 'trophy') is distinct from boss then raise exception 'the kind names the admin who made it'; end if;
  if pg_temp.error('insert into trophy_kinds (key, name) values (''made-x'', ''Sneaky'')') is null then raise exception 'a made- key with no maker'; end if;
  if pg_temp.error('insert into trophy_kinds (key, name, made_by) values (''tt-x'', ''Sneaky'', ''' || boss || ''')') is null then raise exception 'an admin kind with an instance key'; end if;
  -- The bucket: public by URL, listed by nobody, WebP alone, at most 16 KB.
  if (select to_jsonb(b) - 'name' from storage.buckets b where id = 'trophies') is distinct from '{"id": "trophies", "public": true, "file_size_limit": 16384, "allowed_mime_types": ["image/webp"]}'::jsonb then
    raise exception 'the trophies bucket: %', (select to_jsonb(b) from storage.buckets b where id = 'trophies');
  end if;
end $$;

-- ---- Two reigns that began at the same instant, a page of one: the award breaks the tie, so none is skipped or repeated ----
select tests.unbecome();
do $$
declare
  eve uuid := tests.account('tt-tiea'); fay uuid := tests.account('tt-tieb');
  e uuid := tests.character(eve, 'Tt Tie A'); f uuid := tests.character(fay, 'Tt Tie B');
  tie timestamptz := now() + interval '1 day'; seen uuid[] := '{}'; page jsonb; n int := 0; total int;
begin
  insert into trophy_awards (trophy, character, at, by) values ('tt-belt', e, tie, 'admin'), ('tt-belt', f, tie, 'admin');
  total := jsonb_array_length(belt_lineage('tt-belt') -> 'reigns');
  page := belt_lineage('tt-belt', null, 1);
  loop
    n := n + 1;
    if (page #>> '{reigns,0,award}')::uuid = any (seen) then raise exception 'a tie at a page edge repeated a reign: %', page; end if;
    seen := seen || (page #>> '{reigns,0,award}')::uuid;
    exit when page ->> 'more' = 'false' or n > total + 1;
    page := belt_lineage('tt-belt', (page #>> '{reigns,0,began}')::timestamptz, 1, (page #>> '{reigns,0,award}')::uuid);
  end loop;
  if cardinality(seen) is distinct from total or total < 3 then raise exception 'paging one at a time over a tie skipped a reign: % of %', cardinality(seen), total; end if;
  if (select count(*) from unnest(seen) s where s in (select id from trophy_awards where at = tie)) is distinct from 2::bigint then raise exception 'both tied reigns are paged once each'; end if;
end $$;
