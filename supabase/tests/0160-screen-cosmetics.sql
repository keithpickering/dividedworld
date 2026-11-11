-- Cosmetics on the screens (supabase/migrations/0155_screen_cosmetics.sql; the cosmetics plan, Tasks 6 and 8): the faces a screen function hands the web carry a character's
-- portrait tallness, outfit (pieces in layer order) and shown trophies (shown awards, then held belts), as profile_projection does. A thread page's post carries its author's;
-- a reversed award leaves the page at once; a mask with no portrait wears nothing; and the cosmetics are computed once per distinct author on the page, never per post.
-- The other screens read the same helper (profile_cosmetics), checked here on the board page, the index, the profile and the boot.

select tests.unbecome();
-- Per-function call counts in this transaction (a superuser's setting, made before the test becomes a player).
set local track_functions = 'all';
insert into gear_kinds (key, rarity) values ('sc-hat', 'common'), ('sc-stache', 'common');
insert into trophy_kinds (key, name, belt) values ('sc-pet', 'Pet', false), ('sc-belt', 'The Belt', true), ('sc-medal', 'Medal', false);

do $$
declare
  ann uuid := tests.account('sc-ann'); bob uuid := tests.account('sc-bob'); boss uuid := tests.account('sc-admin');
  a uuid := tests.character(ann, 'Sc Ann'); b uuid := tests.character(bob, 'Sc Bob');
  t uuid := tests.thread('Fifty'); bd uuid := (select board from threads where id = t);
  pet uuid; belt uuid; medal uuid; r jsonb; face jsonb; before_n bigint; after_n bigint; i integer;
begin
  insert into admins (account) values (boss);
  -- Ann has a tall portrait, two pieces (written out of layer order) and a shown award and a held belt; Bob has a profile and no portrait.
  insert into character_profiles (character, avatar_square, avatar_portrait, square_frame, portrait_frame, portrait_tallness)
    values (a, 'sq-a', 'po-a', '{"x": 0, "y": 0, "w": 1, "h": 1}', '{"x": 0, "y": 0, "w": 1, "h": 1}', 1.5);
  insert into character_profiles (character) values (b);
  insert into gear_worn (character, layer, gear, x, y, w, turn) values (a, 2, 'sc-stache', 0.5, 0.6, 0.3, 10), (a, 0, 'sc-hat', 0.5, 0.1, 0.4, 0);
  insert into trophy_awards (trophy, character, by) values ('sc-pet', a, 'admin') returning id into pet;
  insert into trophy_awards (trophy, character, by) values ('sc-belt', a, 'admin') returning id into belt;
  insert into trophy_awards (trophy, character, by) values ('sc-medal', a, 'admin') returning id into medal;
  insert into trophies_shown (character, award, position) values (a, pet, 0), (a, medal, 1);
  for i in 1..50 loop perform tests.post(case when i % 2 = 0 then b else a end, t, 'Post ' || i); end loop;

  perform tests.become(ann);
  r := thread_page(t, 1, null, 50, '{}');
  face := (select x -> 'profile' from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a::text);
  if (face ->> 'portrait_tallness')::numeric is distinct from 1.5 then raise exception 'tallness: %', face; end if;
  if (select string_agg(p ->> 'gear', ',' order by ord) from jsonb_array_elements(face -> 'outfit') with ordinality q(p, ord)) is distinct from 'sc-hat,sc-stache'
     or (face #>> '{outfit,1,layer}') is distinct from '2' or (face #>> '{outfit,0,turn}') is distinct from '0' then raise exception 'the outfit in layer order: %', face -> 'outfit'; end if;
  if (select string_agg(p ->> 'trophy', ',' order by ord) from jsonb_array_elements(face -> 'trophies') with ordinality q(p, ord)) is distinct from 'sc-pet,sc-medal,sc-belt' then
    raise exception 'shown awards in order, then the held belt: %', face -> 'trophies'; end if;
  if (face #>> '{trophies,2,held}') is distinct from 'true' then raise exception 'the belt is held: %', face -> 'trophies'; end if;
  -- The same as profile_projection says.
  perform tests.unbecome(); perform tests.become_service();
  if (face - 'title' - 'signature' - 'avatar_square' - 'avatar_portrait' - 'square_frame' - 'portrait_frame' - 'pip_style' - 'pronouns' - 'character')
     is distinct from (profile_projection(a) - 'title' - 'signature' - 'avatar_square' - 'avatar_portrait' - 'square_frame' - 'portrait_frame' - 'pip_style' - 'pronouns' - 'character') then
    raise exception 'the page and profile_projection disagree: % / %', face, profile_projection(a); end if;
  perform tests.unbecome(); perform tests.become(ann);

  -- A mask with a profile and no portrait wears nothing and shows nothing.
  face := (select x -> 'profile' from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = b::text);
  if face -> 'outfit' is distinct from '[]'::jsonb or face -> 'trophies' is distinct from '[]'::jsonb or face -> 'portrait_tallness' is distinct from 'null'::jsonb then
    raise exception 'a mask with no portrait: %', face; end if;

  -- Once per distinct author: 50 posts by 2 characters call the helper twice.
  select coalesce(sum(f.calls), 0) into before_n from pg_stat_xact_user_functions f where f.funcname = 'profile_cosmetics';
  perform thread_page(t, 1, null, 50, '{}');
  select coalesce(sum(f.calls), 0) into after_n from pg_stat_xact_user_functions f where f.funcname = 'profile_cosmetics';
  if after_n - before_n is distinct from 2 then raise exception 'profile_cosmetics ran % times for 2 authors on 50 posts', after_n - before_n; end if;

  -- The other screens carry it: the profile, a board's and the index's faces, and the boot's own.
  face := profile_page(a) -> 'profile';
  if (face ->> 'portrait_tallness')::numeric is distinct from 1.5 or jsonb_array_length(face -> 'outfit') is distinct from 2 or jsonb_array_length(face -> 'trophies') is distinct from 3 then raise exception 'profile_page: %', face; end if;
  face := record_page(a, 'all', 1) -> 'profile';
  if jsonb_array_length(face -> 'outfit') is distinct from 2 then raise exception 'record_page: %', face; end if;
  face := (select x -> 'profile' from jsonb_array_elements(board_page((select slug from boards where id = bd), 1, '{}') -> 'characters') x where x ->> 'id' = a::text);
  if jsonb_array_length(face -> 'outfit') is distinct from 2 or jsonb_array_length(face -> 'trophies') is distinct from 3 then raise exception 'board_page: %', face; end if;
  face := (select x -> 'profile' from jsonb_array_elements(boot() -> 'faces') x where x ->> 'name' = 'Sc Ann');
  if jsonb_array_length(face -> 'outfit') is distinct from 2 or jsonb_array_length(face -> 'trophies') is distinct from 3 then raise exception 'boot faces: %', face; end if;
  face := (select x -> 'profile' from jsonb_array_elements(my_characters_page() -> 'characters') x where x -> 'face' ->> 'id' = a::text);
  face := (select x -> 'face' -> 'profile' from jsonb_array_elements(my_characters_page() -> 'characters') x where x ->> 'id' = a::text);
  if jsonb_array_length(face -> 'outfit') is distinct from 2 then raise exception 'my_characters_page: %', face; end if;
  perform tests.unbecome();

  -- A reversed award leaves the next page at once, and the belt with it.
  perform tests.become(boss);
  perform reverse_award(pet); perform reverse_award(belt);
  perform tests.unbecome(); perform tests.become(ann);
  r := thread_page(t, 1, null, 50, '{}');
  face := (select x -> 'profile' from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a::text);
  if (select string_agg(p ->> 'trophy', ',' order by ord) from jsonb_array_elements(face -> 'trophies') with ordinality q(p, ord)) is distinct from 'sc-medal' then
    raise exception 'a reversed award is gone: %', face -> 'trophies'; end if;
  perform tests.unbecome();
end $$;
