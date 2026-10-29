-- Preferences, profiles and avatars. The screens' engine plan, Task 7; the screens' design,
-- sections 4 (the postbit, pips, avatars) and 12 (themes, motion).
--
-- A player's preferences are theirs alone: the theme, the postbit's layout and motion, saved to
-- the account so they follow the player across devices. A character's profile is public once it
-- has debuted: its title, its signature, its avatar's keys and crop frames, and its pip style.
-- When a profile was last set is kept and never shown: two masks retitled a minute apart would
-- show themselves one player's. The pip styles are the instance's, seeded with it; a profile names
-- one. An avatar's bytes are checked and stored by the avatar Edge Function
-- (supabase/functions/avatar/), which then writes its keys here as the service, for the player.
--
-- None of this is an Act: a profile is a state its player sets, as a wallet is. Its way out is
-- none needed; a player changes it again whenever they like.

create table pip_styles (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  name text not null,
  full_image text not null,
  empty_image text not null
);

create table account_preferences (
  account uuid primary key references accounts (id),
  -- 'system' follows the device's light or dark; any other is a theme's name.
  theme text not null default 'system' check (theme ~ '^[a-z][a-z0-9-]{0,39}$'),
  postbit text not null default 'side' check (postbit in ('side', 'stacked')),
  motion text not null default 'system' check (motion in ('system', 'reduce', 'full'))
);

create table character_profiles (
  character uuid primary key references characters (id),
  title text not null default '' check (char_length(title) <= 40),
  -- BBCode, as a post is, read by the same parser (engine/bbcode/).
  signature text not null default '' check (char_length(signature) <= 500),
  -- Storage keys in the avatars bucket: the re-encoded original, its square crop and its portrait
  -- crop, each a random name. Each frame is where its crop was cut from the original, in fractions
  -- of its width and height, so a player recrops without uploading again.
  avatar_source text,
  avatar_square text,
  avatar_portrait text,
  square_frame jsonb,
  portrait_frame jsonb,
  -- Every instance seeds a "default" style (instanceProblems holds it), before any profile is set.
  pip_style text not null default 'default' references pip_styles (key),
  updated_at timestamptz not null default now(),
  -- A portrait needs a square, and a square an original it was cut from; a square alone fills the
  -- tall slot too (the screens' design, section 4).
  check ((avatar_portrait is null or avatar_square is not null) and (avatar_square is null or avatar_source is not null)
     and (avatar_portrait is null) = (portrait_frame is null) and (avatar_square is null) = (square_frame is null))
);

-- seed_instance (0016), writing the instance's pip styles. Everything else as 0016 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
begin
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's stack and whether it is seeded are the code's, as its name and price are.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

create function set_preferences(theme text default null, postbit text default null, motion text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full') then raise exception 'motion follows the system, or is reduced or full' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences as p (account, theme, postbit, motion)
  values (caller, coalesce(theme, 'system'), coalesce(postbit, 'side'), coalesce(motion, 'system'))
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion)
  returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion);
end $$;

-- A profile's public columns, named: when it was set is not one.
create function profile_projection(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_source', p.avatar_source,
    'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame,
    'pip_style', p.pip_style)
  from character_profiles p where p.character = of_character
$$;

-- A character's title, signature and pip style, set by its player.
create function set_profile(through uuid, title text, signature text, pip_style text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform acting(through);
  if char_length(coalesce(title, '')) > 40 then raise exception 'a title is at most 40 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(coalesce(signature, '')) > 500 then raise exception 'a signature is at most 500 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if not exists (select 1 from pip_styles s where s.key = coalesce(set_profile.pip_style, 'default')) then
    raise exception 'there is no pip style "%"', pip_style using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into character_profiles as p (character, title, signature, pip_style) values (through, coalesce(title, ''), coalesce(signature, ''), coalesce(pip_style, 'default'))
  on conflict (character) do update set title = excluded.title, signature = excluded.signature, pip_style = excluded.pip_style, updated_at = now();
  return profile_projection(through);
end $$;

-- A crop frame: where a crop was cut, in fractions of the original's width and height, inside it.
create function frame_holds(frame jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(frame) = 'object'
    and (select count(*) from jsonb_object_keys(frame)) = 4
    and (select bool_and(jsonb_typeof(frame -> k) = 'number') from unnest(array['x', 'y', 'w', 'h']) k)
    and (frame ->> 'x')::numeric >= 0 and (frame ->> 'y')::numeric >= 0 and (frame ->> 'w')::numeric > 0 and (frame ->> 'h')::numeric > 0
    and (frame ->> 'x')::numeric + (frame ->> 'w')::numeric <= 1 and (frame ->> 'y')::numeric + (frame ->> 'h')::numeric <= 1, false)
$$;

-- An avatar's keys, written by the service for `who` once the avatar function has checked and
-- stored its files. `source` is null for a recrop of the original already kept; `portrait` and its
-- frame are null for a square alone. Returns the keys it replaced, for the function to remove from
-- the bucket.
create function set_avatar(who uuid, through uuid, source text, square text, portrait text, square_frame jsonb, portrait_frame jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was character_profiles%rowtype;
  kept_source text;
begin
  perform played_by(through, who);
  if square is null or (portrait is null) <> (portrait_frame is null) then raise exception 'an avatar has a square crop, and a portrait crop with its frame or neither' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not frame_holds(square_frame) or (portrait is not null and not frame_holds(portrait_frame)) then raise exception 'a crop frame lies inside its picture' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select * into was from character_profiles where character = through for update;
  kept_source := coalesce(source, was.avatar_source);
  if kept_source is null then raise exception 'an avatar is cut from a picture; send it' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into character_profiles as p (character, avatar_source, avatar_square, avatar_portrait, square_frame, portrait_frame)
  values (through, kept_source, square, portrait, square_frame, portrait_frame)
  on conflict (character) do update set avatar_source = excluded.avatar_source, avatar_square = excluded.avatar_square, avatar_portrait = excluded.avatar_portrait,
    square_frame = excluded.square_frame, portrait_frame = excluded.portrait_frame, updated_at = now();
  return jsonb_build_object('profile', profile_projection(through), 'replaced', to_jsonb(array_remove(array[
    case when source is not null and was.avatar_source is distinct from source then was.avatar_source end,
    case when was.avatar_square is distinct from square then was.avatar_square end,
    case when was.avatar_portrait is distinct from portrait then was.avatar_portrait end], null)));
end $$;

-- The bucket the avatar function stores into, where Supabase Storage is installed. Public: an
-- avatar is shown to every reader, under a random name that says nothing of its character. It
-- takes WebP alone, no larger than the avatar function's largest file (LIMITS in its core.ts).
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $b$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('avatars', 'avatars', true, 1500000, array['image/webp']) on conflict (id) do nothing$b$;
  end if;
end $$;

alter table pip_styles enable row level security;
alter table account_preferences enable row level security;
alter table character_profiles enable row level security;
revoke all on pip_styles, account_preferences, character_profiles from anon, authenticated;
grant select on pip_styles to authenticated;
create policy read on pip_styles for select to authenticated using (true);
grant select on account_preferences to authenticated;
create policy own on account_preferences for select to authenticated using (account = auth.uid());
-- Public once the character has debuted, and never when it was set.
grant select (character, title, signature, avatar_source, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style) on character_profiles to authenticated;
create policy read on character_profiles for select to authenticated
  using (exists (select 1 from characters_public c where c.id = character_profiles.character));

revoke execute on function profile_projection(uuid), frame_holds(jsonb), set_avatar(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function set_avatar(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
revoke execute on function set_preferences(text, text, text), set_profile(uuid, text, text, text) from public, anon;
grant execute on function set_preferences(text, text, text), set_profile(uuid, text, text, text) to authenticated;
