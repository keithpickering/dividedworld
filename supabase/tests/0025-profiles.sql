-- Preferences, profiles and avatars (supabase/migrations/0019_profiles.sql, 0025_avatars.sql): a player's own
-- preferences, read by that account alone; a character's profile, set by its player and read by
-- every signed-in player once it has debuted, never with when it was set; a pip style the instance
-- has; and the avatar's two crops, written by the service for the character's player, one first
-- avatar after another. The screens' engine plan, Task 7; the clues plan, Task 4.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('prof-ann');
  bob uuid := tests.account('prof-bob');
  a uuid := tests.character(ann, 'Profiled');
  b uuid := tests.character(bob, 'Profiler');
  waiting uuid;
  said jsonb;
begin
  insert into characters (owner, name) values (ann, 'Not Yet') returning id into waiting;

  -- Preferences: the account's own.
  perform tests.become(ann);
  said := set_preferences('dark', 'stacked', 'reduce');
  if said is distinct from '{"theme": "dark", "motion": "reduce", "postbit": "stacked", "smoke": "full", "contrast": "standard", "text_size": 100, "cards_met": []}'::jsonb then raise exception 'preferences are saved: %', said; end if;
  if (select (theme, postbit, motion) from account_preferences) is distinct from ('dark'::text, 'stacked'::text, 'reduce'::text) then raise exception 'its own account reads its preferences'; end if;
  -- One left out keeps what it was.
  said := set_preferences(null, 'side', null);
  if said is distinct from '{"theme": "dark", "motion": "reduce", "postbit": "side", "smoke": "full", "contrast": "standard", "text_size": 100, "cards_met": []}'::jsonb then raise exception 'a preference left out is kept: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(null, 'sideways', null)$q$) is distinct from 'the postbit is side or stacked' then raise exception 'a postbit that is neither'; end if;
  if pg_temp.refusal($q$select set_preferences(null, null, 'fast')$q$) is distinct from 'motion follows the system, or is reduced or full' then raise exception 'a motion that is none of them'; end if;
  if pg_temp.refusal($q$select set_preferences('Not A Theme!', null, null)$q$) is distinct from 'a theme is named in lowercase words joined by hyphens' then raise exception 'a theme name that is not one'; end if;

  -- A profile: set by the character's player.
  said := set_profile(a, 'The Profiled One', '[b]Signed.[/b]', 'stars');
  if said ->> 'title' is distinct from 'The Profiled One' or said ->> 'pip_style' is distinct from 'stars' then raise exception 'a profile is saved: %', said; end if;
  if pg_temp.refusal(format('select set_profile(%L, %L, %L, %L)', a, '', '', 'sparkles')) is distinct from 'there is no pip style "sparkles"' then raise exception 'an unknown pip style'; end if;
  if pg_temp.refusal(format('select set_profile(%L, %L, %L, %L)', a, repeat('t', 41), '', 'default')) is distinct from 'a title is at most 40 characters' then raise exception 'a 41-character title'; end if;
  if pg_temp.refusal(format('select set_profile(%L, %L, %L, %L)', a, '', repeat('s', 501), 'default')) is distinct from 'a signature is at most 500 characters' then raise exception 'a 501-character signature'; end if;
  if pg_temp.refusal(format('select set_profile(%L, %L, %L, %L)', b, 'Mine now', '', 'default')) is distinct from 'you do not play that character' then raise exception 'a player set another''s profile'; end if;
  if pg_temp.refusal(format('select set_profile(%L, %L, %L, %L)', waiting, 'Early', '', 'default')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character''s profile was set'; end if;
  perform tests.unbecome();

  -- Every signed-in player reads it; nobody reads when it was set, or another's preferences.
  perform tests.become(bob);
  perform auth.assert_impersonating();
  if (select title from character_profiles where character = a) is distinct from 'The Profiled One' then raise exception 'a profile is read by every signed-in player'; end if;
  if pg_temp.refusal('select updated_at from character_profiles') is null then raise exception 'when a profile was set was read'; end if;
  if exists (select 1 from account_preferences) then raise exception 'another account read preferences'; end if;
  if (select count(*) from pip_styles) < 2 then raise exception 'the pip styles are read by every player'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from character_profiles') is null then raise exception 'a visitor read profiles'; end if;
  perform tests.unbecome();

  -- The avatar's keys, written by the service for the player: two crops, and the replaced keys
  -- come back, to remove.
  perform tests.become_service();
  said := set_avatar(ann, a, 'sq-1.webp', 'pt-1.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0.1, "y": 0, "w": 0.5, "h": 1}');
  if said -> 'replaced' is distinct from '[]'::jsonb then raise exception 'a first avatar replaces nothing: %', said; end if;
  if said -> 'profile' ? 'avatar_source' then raise exception 'a profile names no original: %', said; end if;
  -- A recrop sends a square alone, and keeps the portrait and its frame.
  said := set_avatar(ann, a, 'sq-2.webp', null, '{"x": 0, "y": 0.2, "w": 1, "h": 0.5}', null);
  if said -> 'replaced' is distinct from '["sq-1.webp"]'::jsonb then raise exception 'a recrop replaces the square alone: %', said; end if;
  if (select (avatar_portrait, portrait_frame) from character_profiles where character = a) is distinct from ('pt-1.webp'::text, '{"x": 0.1, "y": 0, "w": 0.5, "h": 1}'::jsonb) then raise exception 'a recrop keeps the portrait'; end if;
  -- A new portrait replaces both crops.
  said := set_avatar(ann, a, 'sq-3.webp', 'pt-3.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}');
  if said -> 'replaced' is distinct from '["sq-2.webp", "pt-1.webp"]'::jsonb then raise exception 'a new upload replaces both crops: %', said; end if;
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, %L, %L, %L)', bob, a, 'x.webp', 'y.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}', '{"x": 0, "y": 0, "w": 1, "h": 1}')) is distinct from 'you do not play that character' then raise exception 'an avatar set for another''s character'; end if;
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, %L, %L, %L)', ann, a, 'x.webp', 'y.webp', '{"x": 0.6, "y": 0, "w": 0.5, "h": 1}', '{"x": 0, "y": 0, "w": 1, "h": 1}')) is distinct from 'a crop frame lies inside its picture' then raise exception 'a frame off its picture'; end if;
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, %L, %L, null)', ann, a, 'x.webp', 'y.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}')) is distinct from 'an avatar has a square crop, and a portrait crop with its frame or neither' then raise exception 'a portrait with no frame'; end if;
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, null, %L, null)', ann, a, 'z.webp', '{"x": 0, "y": 0, "w": 1, "h": 1, "note": "anything at all"}')) is distinct from 'a crop frame lies inside its picture' then raise exception 'a frame carrying more than where it was cut'; end if;
  perform tests.unbecome();
  -- No avatar yet: a recrop has no portrait to be cut from.
  perform tests.become_service();
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, null, %L, null)', bob, b, 'x.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}')) is distinct from 'an avatar is cut from a portrait; send it' then raise exception 'a square with no portrait to be cut from'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, %L, %L, %L)', ann, a, 'x.webp', 'y.webp', '{}', '{}')) is null then raise exception 'a player wrote an avatar''s keys past the function that checks its bytes'; end if;
  perform tests.unbecome();
end $$;

-- ---- The instance's pip styles arrive with its seed, and stay ----
do $$
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb,
    'pipStyles', jsonb_build_array(jsonb_build_object('key', 'default', 'name', 'Plain', 'full', 'f.svg', 'empty', 'e.svg'), jsonb_build_object('key', 'hearts', 'name', 'Hearts', 'full', 'h.svg', 'empty', 'o.svg'))));
  if (select (name, full_image) from pip_styles where key = 'default') is distinct from ('Plain'::text, 'f.svg'::text) then raise exception 'a seeded pip style is written'; end if;
  if not exists (select 1 from pip_styles where key = 'hearts') or not exists (select 1 from pip_styles where key = 'stars') then raise exception 'a new style is added, and one the seed no longer names is kept'; end if;
end $$;

-- ---- A waiting character's profile is read by nobody, its own player included, until it debuts ----
-- No action writes one (set_profile and set_avatar refuse a character still waiting), so the row
-- is written here as the owner, as an import or an admin's repair might.
do $$
declare
  ann uuid := tests.account('wait-prof-ann');
  bob uuid := tests.account('wait-prof-bob');
  waiting uuid;
  seen bigint;
begin
  insert into characters (owner, name) values (ann, 'Waiting Profile') returning id into waiting;
  insert into character_profiles (character, title) values (waiting, 'Not yet');
  perform tests.become(bob);
  select count(*) into seen from character_profiles where character = waiting;
  perform tests.unbecome();
  if seen <> 0 then raise exception 'another player read a waiting character''s profile'; end if;
  perform tests.become(ann);
  select count(*) into seen from character_profiles where character = waiting;
  perform tests.unbecome();
  if seen <> 0 then raise exception 'a waiting character''s profile was read before its debut'; end if;
  update characters set debuted_at = now() where id = waiting;
  perform tests.become(bob);
  select count(*) into seen from character_profiles where character = waiting;
  perform tests.unbecome();
  if seen <> 1 then raise exception 'a debuted character''s profile is read by every player'; end if;
end $$;

-- ---- A profile with a square and no portrait, written before 0025, stays valid; a recrop of it
-- has no portrait, and its player uploads again ----
do $$
declare
  ann uuid := tests.account('legacy-sq-ann');
  a uuid := tests.character(ann, 'Square Alone');
begin
  insert into character_profiles (character, avatar_square, square_frame) values (a, 'old-sq.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}');
  perform tests.become_service();
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, null, %L, null)', ann, a, 'x.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}')) is distinct from 'an avatar is cut from a portrait; send it' then raise exception 'a recrop of a square alone'; end if;
  if (set_avatar(ann, a, 'new-sq.webp', 'new-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}') -> 'replaced') is distinct from '["old-sq.webp"]'::jsonb then raise exception 'an upload over a square alone replaces it'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two first avatars at once: one after the other, the second naming the first's files as replaced ----
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  said text[];
  answers jsonb;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-avatar@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Race Avatar', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha');
    create table tests.avatar_answers (said jsonb);
    grant usage on schema tests to service_role;
    grant insert on tests.avatar_answers to service_role;
  $sql$, ann, a));
  said := tests.race_service(
    format('insert into tests.avatar_answers select set_avatar(%L, %L, %L, %L, %L, %L)', ann, a, 'one-sq.webp', 'one-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}'),
    format('insert into tests.avatar_answers select set_avatar(%L, %L, %L, %L, %L, %L)', ann, a, 'two-sq.webp', 'two-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}'));
  if said[1] is not null or said[2] is not null then raise exception 'two first avatars at once: %', said; end if;
  select jsonb_agg(x.said -> 'replaced' order by x.said -> 'replaced') into answers from tests.avatar_answers x;
  -- Whichever came second names the first's files, so none is left that no profile names unreported.
  if (select avatar_square from character_profiles where character = a) = 'two-sq.webp' then
    if answers is distinct from '[[], ["one-sq.webp", "one-pt.webp"]]'::jsonb then raise exception 'the second first avatar names the first''s files: %', answers; end if;
  elsif answers is distinct from '[[], ["two-sq.webp", "two-pt.webp"]]'::jsonb then
    raise exception 'the second first avatar names the first''s files: %', answers;
  end if;
  -- The committed profile names files no Storage holds; it goes, so a later export is not asked for them.
  perform tests.commit(format($sql$ delete from character_profiles where character = %L; $sql$, a));
end $$;
