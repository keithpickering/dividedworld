-- Avatars: two crops, public, swept. The clues design, section 5; the clues plan, Task 4.
--
-- An avatar is a portrait crop (256 to 512 wide, 1 to 2 times as tall) and a square crop cut from
-- inside the portrait, both public by URL (supabase/functions/avatar/core.ts). The uncropped
-- original is no longer kept: what a player cropped away is stored nowhere. A profile written
-- before this keeps its two crops, and its original is handed to the sweep. A profile with a square
-- and no portrait stays valid, the square filling the tall slot, until its player uploads again.
--
-- The bucket is public: Storage answers a file's read with Last-Modified, when it was written,
-- which is a clue, never proof (CLAUDE.md, "A response never proves a private fact"; the design,
-- section 1). Its files' names are random and no policy lets anyone list it, so a file is found
-- only through a name a profile gives or a player shares.
--
-- Files no row names (a replaced avatar whose removal failed, a write whose answer was lost, the
-- originals below) are removed by tools/sweep-avatars.mjs, an operator's tool: each file no profile
-- names and written more than an hour ago, so one stored a moment before its profile is written is
-- never taken. Its way out is that sweep.

-- The originals profiles held before this, for the sweep, which removes each file and its row here.
create table avatar_orphans (
  key text primary key,
  since timestamptz not null default now()
);
alter table avatar_orphans enable row level security;
revoke all on avatar_orphans from anon, authenticated;

insert into avatar_orphans (key) select avatar_source from character_profiles where avatar_source is not null on conflict do nothing;
-- The check that held a square to its original goes with the column; the rest of it stays.
alter table character_profiles drop column avatar_source;
alter table character_profiles add check ((avatar_portrait is null or avatar_square is not null)
  and (avatar_portrait is null) = (portrait_frame is null) and (avatar_square is null) = (square_frame is null));

-- 0019's, naming no original.
create or replace function profile_projection(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature,
    'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame,
    'pip_style', p.pip_style)
  from character_profiles p where p.character = of_character
$$;

-- An avatar's keys, written by the service for `who` once the avatar function has checked and
-- stored its files (0019's, without an original). `portrait` and its frame are null for a recrop,
-- which keeps the portrait. The character's row is locked before the profile is read, so two first
-- avatars at once, which find no profile row to lock, go one after the other, and the second
-- returns the first's files as replaced. Returns the keys it replaced, for the function to remove.
drop function set_avatar(uuid, uuid, text, text, text, jsonb, jsonb);
create function set_avatar(who uuid, through uuid, square text, portrait text, square_frame jsonb, portrait_frame jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was character_profiles%rowtype;
  kept_portrait text;
begin
  perform played_by(through, who);
  if square is null or (portrait is null) <> (portrait_frame is null) then raise exception 'an avatar has a square crop, and a portrait crop with its frame or neither' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not frame_holds(square_frame) or (portrait is not null and not frame_holds(portrait_frame)) then raise exception 'a crop frame lies inside its picture' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from characters where id = through for no key update;
  select * into was from character_profiles where character = through for update;
  kept_portrait := coalesce(portrait, was.avatar_portrait);
  if kept_portrait is null then raise exception 'an avatar is cut from a portrait; send it' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into character_profiles as p (character, avatar_square, avatar_portrait, square_frame, portrait_frame)
  values (through, square, kept_portrait, square_frame, coalesce(portrait_frame, was.portrait_frame))
  on conflict (character) do update set avatar_square = excluded.avatar_square, avatar_portrait = excluded.avatar_portrait,
    square_frame = excluded.square_frame, portrait_frame = excluded.portrait_frame, updated_at = now();
  return jsonb_build_object('profile', profile_projection(through), 'replaced', to_jsonb(array_remove(array[
    case when was.avatar_square is distinct from square then was.avatar_square end,
    case when portrait is not null and was.avatar_portrait is distinct from portrait then was.avatar_portrait end], null)));
end $$;

-- The bucket, public by URL and listed by nobody: no policy on storage.objects is written, here or
-- before, so a listing finds nothing. It takes WebP alone, no larger than the avatar function's
-- largest file (LIMITS in its core.ts; supabase/tests/e2e/0006-avatar-bucket.ts holds the two
-- together). A bucket of that name already there is held to the same.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $b$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('avatars', 'avatars', true, 400000, array['image/webp'])
      on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$b$;
  end if;
end $$;

revoke execute on function profile_projection(uuid), set_avatar(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function set_avatar(uuid, uuid, text, text, jsonb, jsonb) to service_role;
