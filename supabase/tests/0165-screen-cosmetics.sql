-- Cosmetics on the screens (supabase/migrations/0158_screen_cosmetics.sql; the cosmetics plan, Tasks 6 and 8): the faces a screen function hands the web carry a character's
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
  pet uuid; belt uuid; medal uuid; ib uuid; r jsonb; face jsonb; before_n bigint; after_n bigint; i integer;
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
  face := (select x -> 'face' -> 'profile' from jsonb_array_elements(my_characters_page() -> 'characters') x where x ->> 'id' = a::text);
  if jsonb_array_length(face -> 'outfit') is distinct from 2 then raise exception 'my_characters_page: %', face; end if;
  -- The index carries it too.
  -- On a board of its own: another file's committed thread with no post (0036's race) sorts first on General, and its board then names no last character.
  perform tests.unbecome();
  insert into boards (slug, name) values ('sc-index', 'Sc Index');
  insert into threads (board, title) select id, 'Sc index' from boards where slug = 'sc-index' returning id into ib;
  perform tests.post(a, ib, 'On its own board.');
  perform tests.become(ann);
  if not exists (select 1 from jsonb_array_elements(index_page() -> 'characters') x where x -> 'profile' ? 'outfit') then raise exception 'index_page carries no outfit: %', index_page(); end if;
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

-- ---- The alerts page and the log name another character's profile with its cosmetics ----
select tests.unbecome();
do $$
declare
  me uuid := tests.account('sc-cid'); her uuid := tests.account('sc-dot');
  mine uuid := tests.character(me, 'Sc Cid'); dot uuid := tests.character(her, 'Sc Dot');
  t uuid := tests.thread('Sc pages'); base timestamptz := now() - interval '2 hours';
  pp uuid; cplay uuid; cend uuid; mp uuid;
begin
  insert into character_profiles (character) values (mine), (dot);
  pp := tests.post(dot, t, 'Dot posts.', base);
  cplay := tests.act(mine, 'card', t, '{"card": "splat"}', pp, base + interval '1 minute');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  cend := tests.act(null::uuid, 'card_end', t, '{"why": "reversed", "by": "admin"}', cplay, base + interval '2 minutes');
  perform set_config('kayfabb.card_end_writer', 'off', true);
  insert into alerts (account, kind, act, character, at) values (me, 'cardEnded', cend, mine, base + interval '3 minutes');
  mp := tests.post(mine, t, 'Cid posts.', base + interval '4 minutes');
  perform tests.act(dot, 'card', t, '{"card": "splat"}', mp, base + interval '5 minutes');
  perform tests.become(me);
  if not exists (select 1 from jsonb_array_elements(alerts_page(null) -> 'people') x where x -> 'profile' ? 'outfit') then raise exception 'alerts_page profiles carry no outfit: %', alerts_page(null) -> 'people'; end if;
  if not exists (select 1 from jsonb_array_elements(log_page(null) -> 'people') x where x -> 'profile' ? 'outfit') then raise exception 'log_page profiles carry no outfit: %', log_page(null) -> 'people'; end if;
  perform tests.unbecome();
end $$;

-- ---- An undebuted mask is not confirmed by its cosmetics: the answer is the one an unknown id gets ----
select tests.unbecome();
do $$
declare
  ann uuid := (select id from auth.users where email = 'sc-ann@test.invalid'); bob uuid := (select id from auth.users where email = 'sc-bob@test.invalid');
  u uuid := tests.character(bob, 'Sc Hidden'); a uuid := (select id from characters where name = 'Sc Ann');
begin
  update characters set debuted_at = null where id = u;
  insert into character_profiles (character, avatar_square, avatar_portrait, square_frame, portrait_frame, portrait_tallness) values (u, 'sq-u', 'po-u', '{"x": 0, "y": 0, "w": 1, "h": 1}', '{"x": 0, "y": 0, "w": 1, "h": 1}', 1.2);
  insert into gear_worn (character, layer, gear, x, y, w, turn) values (u, 0, 'sc-hat', 0.5, 0.1, 0.4, 0);
  perform tests.become(ann);
  if profile_cosmetics(u) is distinct from profile_cosmetics(gen_random_uuid()) then raise exception 'profile_cosmetics confirms an undebuted mask: %', profile_cosmetics(u); end if;
  if profile_cosmetics(u) is distinct from '{"outfit": [], "trophies": [], "portrait_tallness": null}'::jsonb then raise exception 'the constant shape: %', profile_cosmetics(u); end if;
  if profile_cosmetics(a) -> 'portrait_tallness' is null then raise exception 'a debuted mask shows its cosmetics'; end if;
  perform tests.unbecome(); perform tests.become(bob);
  if jsonb_array_length(profile_cosmetics(u) -> 'outfit') is distinct from 1 then raise exception 'the owner sees their own undebuted mask'; end if;
  perform tests.unbecome();
end $$;
