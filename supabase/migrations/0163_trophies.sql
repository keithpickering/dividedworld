-- Trophies and belts (the cosmetics design, docs/plans/2026-11-04-cosmetics-design.md; the plan, Task 3).
--
-- A trophy is a standing fact about a character, given by the season's end, by the Boss, by a met demand or by an admin, and taken back by an admin alone. Nothing here
-- is edited: an award is a row, a taking back is a row beside it (trophy_reversals), and an award with a reversal no longer stands. A belt is a trophy a kind says has
-- one holder at a time: the holder is whoever's standing award of it is the latest, so giving it to a second character takes it from the first and taking that back
-- returns it, with no row changed. What a character shows is read by a lookup of its own awards, never a walk of all of them (trophy_awards_by_character), and a
-- belt's holder by one probe of its kind's awards in time order (trophy_awards_by_trophy).
--
-- The masks. Who gave what is public in words ("the season", "Sighbot, the Boss", "a met demand", "an admin": never which admin), so no client reads the tables: the
-- awards, the reversals (which name the admin) and the shown set are read through trophies_of, belt_lineage and profile_projection, and only the kinds' public columns
-- are granted. A met demand's credit is read from public Acts and their public tallies (demand_contributors), never from who reacted.
--
-- Where the instance's catalog lives in SQL. `Instance.trophies` (engine/rules/cosmetics.ts TrophyCatalog) arrives in the seed; seed_instance writes each kind to trophy_kinds
-- and its place in the lists the engine keeps as three columns of the kind it names: `season_place` (1 to 3, the kind given for that place), `boss_gives` (a kind the Boss
-- may give) and `demand_met` (the kind every counted character gets when a move's demand is met). Two kinds never share a place and one kind is the met demand's, held by
-- unique indexes. An admin-made kind has a generated key that begins `made-`, which an instance's key never does (the table and the seed both refuse it), and none of the three.

-- ------------------------------------------------------------------------------------------------------------- the tables ----

create table trophy_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  name text not null check (char_length(name) between 1 and 60),
  line text check (line is null or char_length(line) <= 200),
  belt boolean not null default false,
  -- The admin's account for a kind made on the admin page, null for the instance's. Never granted to a client.
  made_by uuid references accounts (id),
  -- The file's key in the `trophies` bucket (made by the trophy-art function); null for the instance's, whose art is its UI's.
  art text check (art is null or art ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$'),
  season_place smallint check (season_place between 1 and 3),
  boss_gives boolean not null default false,
  demand_met boolean not null default false,
  check ((made_by is not null) = (key like 'made-%')),
  check (made_by is null or (season_place is null and not boss_gives and not demand_met))
);
create unique index trophy_kinds_one_place on trophy_kinds (season_place) where season_place is not null;
create unique index trophy_kinds_one_demand on trophy_kinds ((true)) where demand_met;

-- An award. `act` is the move's Act for a Boss's and a met demand's, `season` the season for a season's place. Append-only, as the ledgers are.
create table trophy_awards (
  id uuid primary key default gen_random_uuid(),
  trophy text not null references trophy_kinds (key),
  character uuid not null references characters (id),
  at timestamptz not null default clock_timestamp(),
  by text not null check (by in ('season', 'boss', 'demand', 'admin')),
  act uuid references acts (id),
  season bigint references seasons (id),
  line text check (line is null or char_length(line) <= 200),
  check ((by in ('boss', 'demand')) = (act is not null)),
  check ((by = 'season') = (season is not null))
);
create index trophy_awards_by_character on trophy_awards (character, at desc, id desc);
create index trophy_awards_by_trophy on trophy_awards (trophy, at desc, id desc);
-- A move credits a character once for a trophy, and a season gives a character one place.
create unique index trophy_awards_once_per_move on trophy_awards (act, trophy, character) where act is not null;
create unique index trophy_awards_once_per_season on trophy_awards (season, character) where season is not null;

-- A taking back, by an admin's account (which no client reads). An award with a row here no longer stands.
create table trophy_reversals (
  award uuid primary key references trophy_awards (id),
  at timestamptz not null default clock_timestamp(),
  by uuid not null references accounts (id)
);

-- What a character shows on its postbit: at most `cosmetics.trophies.shownMost`, in the order the player gave (show_trophies holds the count).
create table trophies_shown (
  character uuid not null references characters (id),
  award uuid primary key references trophy_awards (id),
  position integer not null check (position >= 0),
  unique (character, position)
);

-- Awards that could not be written, kept for an admin (trophy_award_failures()), who can give the trophy by hand: a met demand's (`move_act`; the tick ends the move all the
-- same) or a season's places (`season`; the season ends all the same). Exactly one is set.
create table trophy_award_failures (
  id uuid primary key default gen_random_uuid(),
  move_act uuid unique references acts (id),
  season bigint unique references seasons (id),
  error text not null,
  at timestamptz not null default now(),
  check (num_nonnulls(move_act, season) = 1)
);

create trigger trophy_awards_no_update before update or delete on trophy_awards for each row execute function ledger_append_only();
create trigger trophy_awards_no_truncate before truncate on trophy_awards for each statement execute function ledger_append_only();
create trigger trophy_reversals_no_update before update or delete on trophy_reversals for each row execute function ledger_append_only();
create trigger trophy_reversals_no_truncate before truncate on trophy_reversals for each statement execute function ledger_append_only();
alter table trophy_awards enable always trigger trophy_awards_no_update;
alter table trophy_awards enable always trigger trophy_awards_no_truncate;
alter table trophy_reversals enable always trigger trophy_reversals_no_update;
alter table trophy_reversals enable always trigger trophy_reversals_no_truncate;

-- Never to a staff character, whoever writes the row.
create function trophy_awards_not_staff() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character is never given a trophy' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function trophy_awards_not_staff() from public, anon, authenticated;
create trigger trophy_awards_not_staff before insert on trophy_awards for each row execute function trophy_awards_not_staff();

alter table trophy_kinds enable row level security;
alter table trophy_awards enable row level security;
alter table trophy_reversals enable row level security;
alter table trophies_shown enable row level security;
alter table trophy_award_failures enable row level security;
revoke all on trophy_kinds, trophy_awards, trophy_reversals, trophies_shown, trophy_award_failures from public, anon, authenticated;
-- The kinds are public except who made one.
grant select (key, name, line, belt, art) on trophy_kinds to authenticated;
create policy read on trophy_kinds for select to authenticated using (true);

-- ------------------------------------------------------------------------------------------------------------ the reads ----

-- One standing award as a screen shows it: the kind's name, line and art, who gave it in plain words, and for a belt whether it is held now. Never which admin.
-- A belt is held by the character whose standing award of it is the latest: one probe of the kind's awards in time order, stopping at the first without a reversal.
create function trophy_item(a trophy_awards) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('award', a.id, 'trophy', a.trophy, 'name', k.name, 'line', coalesce(a.line, k.line), 'art', k.art, 'belt', k.belt, 'at', a.at,
    'by', case a.by when 'season' then 'the season' when 'demand' then 'a met demand' when 'admin' then 'an admin'
           else coalesce((select c.name || ', the Boss' from acts x join characters c on c.id = x.character where x.id = a.act), 'the Boss') end,
    'season', (select s.number from seasons s where s.id = a.season),
    'held', case when k.belt then a.id = (select x.id from trophy_awards x where x.trophy = a.trophy
                                            and not exists (select 1 from trophy_reversals r where r.award = x.id)
                                          order by x.at desc, x.id desc limit 1) end)
  from trophy_kinds k where k.key = a.trophy
$$;
revoke execute on function trophy_item(trophy_awards) from public, anon, authenticated;

-- A page of a character's trophies, newest first: its standing awards only, as {awards: [...], more: boolean}. `before` and `before_id` continue after the last award of the
-- page before, by its (`at`, id): awards sharing one `at` are neither skipped nor repeated across a page edge. With `before` alone the page continues from the awards strictly
-- older than it. `most` is the page's size, at least 1 and at most 100. Read through trophy_awards_by_character.
create function trophies_of(of_character uuid, before timestamptz default null, most integer default 50, before_id uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with page as (
    select a.id, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
    where a.character = of_character
      and (before is null or a.at < before or (before_id is not null and a.at = before and a.id < before_id))
      and not exists (select 1 from trophy_reversals r where r.award = a.id)
    order by a.at desc, a.id desc
    limit least(greatest(coalesce(most, 50), 1), 100) + 1
  )
  select jsonb_build_object(
    'awards', coalesce((select jsonb_agg(trophy_item(a) order by p.n) from page p join trophy_awards a on a.id = p.id where p.n <= least(greatest(coalesce(most, 50), 1), 100)), '[]'::jsonb),
    'more', exists (select 1 from page p where p.n > least(greatest(coalesce(most, 50), 1), 100)))
$$;
revoke execute on function trophies_of(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function trophies_of(uuid, timestamptz, integer, uuid) to authenticated;

-- A belt's line of holders: each standing award of it in order, when the reign began and when it ended (the next standing award's time, null for the holder now).
create function belt_lineage(trophy_key text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  is_belt boolean;
begin
  select k.belt into is_belt from trophy_kinds k where k.key = trophy_key;
  if is_belt is null then raise exception 'there is no trophy "%"', trophy_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if not is_belt then raise exception '"%" is not a belt', trophy_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('award', q.id, 'character', q.character, 'name', q.name, 'began', q.at, 'ended', q.ended) order by q.at, q.id), '[]'::jsonb)
          from (select a.id, a.character, c.name, a.at, lead(a.at) over (order by a.at, a.id) as ended
                from trophy_awards a join characters c on c.id = a.character
                where a.trophy = trophy_key and not exists (select 1 from trophy_reversals r where r.award = a.id)) q);
end $$;
revoke execute on function belt_lineage(text) from public, anon;
grant execute on function belt_lineage(text) to authenticated;

-- What a character's postbit and page show: the awards it shows (its own choice, in its order) and then every belt it holds. A lookup by character: its own awards
-- by trophy_awards_by_character, each belt's holder by one probe of trophy_awards_by_trophy.
create function trophy_shelf(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(q.item order by q.grp, q.ord, q.at desc), '[]'::jsonb)
  from (
    select trophy_item(a) as item, 0 as grp, s.position as ord, a.at
    from trophies_shown s join trophy_awards a on a.id = s.award
    where s.character = of_character and not exists (select 1 from trophy_reversals r where r.award = a.id)
    union all
    select i.item, 1, 0, a.at
    from trophy_awards a join trophy_kinds k on k.key = a.trophy and k.belt, lateral (select trophy_item(a) as item) i
    where a.character = of_character and not exists (select 1 from trophy_reversals r where r.award = a.id)
      and (i.item ->> 'held')::boolean and not exists (select 1 from trophies_shown s where s.award = a.id)
  ) q
$$;
revoke execute on function trophy_shelf(uuid) from public, anon, authenticated;

-- profile_projection (0162), also carrying `trophies`. Everything else as 0162 wrote it.
create or replace function profile_projection(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature,
    'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame,
    'pip_style', p.pip_style, 'pronouns', p.pronouns, 'portrait_tallness', p.portrait_tallness,
    'outfit', coalesce((select jsonb_agg(jsonb_build_object('gear', w.gear, 'x', w.x, 'y', w.y, 'w', w.w, 'turn', w.turn, 'layer', w.layer) order by w.layer)
                        from gear_worn w where w.character = p.character), '[]'::jsonb),
    'trophies', trophy_shelf(p.character))
  from character_profiles p where p.character = of_character
$$;

-- --------------------------------------------------------------------------------------------------------- showing them ----

-- A player chooses which of a character's standing awards its postbit shows, in order: `awards` is the whole set, replacing the one before, at most
-- `cosmetics.trophies.shownMost`. The service calls it for the account whoami() names, as set_outfit is called.
create function show_trophies(who uuid, through uuid, awards uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer := (setting('cosmetics') #>> '{trophies,shownMost}')::integer;
  one uuid;
  n integer;
begin
  perform played_by(through, who);
  if awards is null then raise exception 'the awards shown are a list' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  n := coalesce(cardinality(awards), 0);
  if n > most then raise exception '% trophies are shown; at most %', n, most using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if n <> (select count(distinct x) from unnest(awards) x) then raise exception 'a trophy is shown once' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from characters where id = through for no key update;
  -- `for no key update`, which conflicts with reverse_award's `for share` (two `for share` never wait on each other): a reversal and a show are serialized, so a
  -- show never keeps an award that a reversal has just taken back. The race needs two sessions; supabase/tests/e2e/0023-show-vs-reverse.ts holds them.
  perform 1 from trophy_awards where id = any (awards) order by id for no key update;
  foreach one in array awards loop
    if not exists (select 1 from trophy_awards a where a.id = one and a.character = through) then
      raise exception 'that trophy is not this character''s' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if exists (select 1 from trophy_reversals r where r.award = one) then
      raise exception 'that trophy has been taken back' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end loop;
  delete from trophies_shown where character = through;
  insert into trophies_shown (character, award, position) select through, t.a, (t.o - 1)::integer from unnest(awards) with ordinality t(a, o);
  return jsonb_build_object('shown', n);
end $$;
revoke execute on function show_trophies(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function show_trophies(uuid, uuid, uuid[]) to service_role;

-- ------------------------------------------------------------------------------------------------------ the admin's hand ----

-- An admin gives a trophy to a character. The answer is the same whoever plays it, and a staff character is refused as the table refuses it, and one that has not debuted as the Boss's landing refuses it.
create function award_trophy(trophy_key text, of_character uuid, said text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  its_staff text;
  its_debut timestamptz;
  made uuid;
begin
  perform only_admins('gives a trophy');
  if not exists (select 1 from trophy_kinds k where k.key = trophy_key) then raise exception 'there is no trophy "%"', trophy_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  said := nullif(btrim(said), '');
  if char_length(said) > 200 then raise exception 'a trophy''s words are at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select staff, debuted_at into its_staff, its_debut from characters where id = of_character;
  if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if its_staff is not null then raise exception 'a staff character is never given a trophy' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- A character that has not debuted is no one's to name yet: a belt on it would put its name on a public page (the belt's lineage, the Boss's reference).
  if its_debut is null then raise exception 'that character has not debuted' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into trophy_awards (trophy, character, by, line) values (trophy_key, of_character, 'admin', said) returning id into made;
  return jsonb_build_object('award', made);
end $$;
revoke execute on function award_trophy(text, uuid, text) from public, anon;
grant execute on function award_trophy(text, uuid, text) to authenticated;

-- An admin takes an award back. It no longer stands: it leaves the character's trophies and its shown set, and a belt it took returns to the holder before.
create function reverse_award(of_award uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  taken uuid;
begin
  perform only_admins('takes a trophy back');
  perform 1 from trophy_awards where id = of_award for share;
  if not found then raise exception 'there is no such trophy' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into trophy_reversals (award, by) values (of_award, signed_in_account()) on conflict (award) do nothing returning award into taken;
  if taken is null then raise exception 'that trophy was already taken back' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  delete from trophies_shown where award = of_award;
  return jsonb_build_object('reversed', of_award);
end $$;
revoke execute on function reverse_award(uuid) from public, anon;
grant execute on function reverse_award(uuid) to authenticated;

-- The characters a failed demand's trophy was for, as the admin's read lists them; null where the demand cannot be read now (demand_contributors raised), so that one
-- failure row never makes the admin's read of every other row fail. The row keeps its stored error, and the admin can give the trophy by hand.
create function trophy_failure_characters(move uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from characters c where c.id = any (demand_contributors(move))), '[]'::jsonb);
exception when others then
  return null;
end $$;
revoke execute on function trophy_failure_characters(uuid) from public, anon, authenticated;

-- The awards that could not be written, newest first, for an admin to give by hand: the move's Act (a met demand's) or the season's number, the kind, the characters
-- it was for, and the error.
create function trophy_award_failures() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the trophies that could not be given');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'move', f.move_act, 'season', (select s.number from seasons s where s.id = f.season), 'at', f.at, 'error', f.error,
      'trophy', case when f.move_act is not null then (select k.key from trophy_kinds k where k.demand_met) end,
      'characters', case when f.move_act is not null
        then trophy_failure_characters(f.move_act)
        else coalesce((select jsonb_agg(jsonb_build_object('id', r.character, 'name', r.name, 'place', r.place) order by r.place, r.name) from season_results r where r.season = f.season and r.place <= 3), '[]'::jsonb) end)
      order by f.at desc, f.id desc) from trophy_award_failures f), '[]'::jsonb);
end $$;
revoke execute on function trophy_award_failures() from public, anon;
grant execute on function trophy_award_failures() to authenticated;

-- An admin makes a trophy of their own: a name, words, and a file the trophy-art function stored (its key; none for a kind with no picture) and whether it is a belt.
-- The key is generated, so it never meets an instance's.
create function make_trophy(trophy_name text, said text default null, art_key text default null, is_belt boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made text := 'made-' || gen_random_uuid();
  stored boolean := true;
begin
  perform only_admins('makes a trophy');
  trophy_name := btrim(trophy_name);
  if trophy_name is null or char_length(trophy_name) not between 1 and 60 then raise exception 'a trophy''s name is 1 to 60 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  said := nullif(btrim(said), '');
  if char_length(said) > 200 then raise exception 'a trophy''s words are at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if art_key is not null then
    if art_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$' then raise exception 'that is not the key of a stored picture' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Where Storage is installed, the file is there. A database that cannot be asked takes the key as given: the picture is the admin's to check.
    if to_regclass('storage.objects') is not null then
      begin
        execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''trophies'' and o.name = $1)' into stored using art_key;
      exception when insufficient_privilege then stored := true;
      end;
      if not stored then raise exception 'no picture is stored under that key' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    end if;
  end if;
  insert into trophy_kinds (key, name, line, belt, made_by, art) values (made, trophy_name, said, coalesce(is_belt, false), signed_in_account(), art_key);
  return jsonb_build_object('trophy', made);
end $$;
revoke execute on function make_trophy(text, text, text, boolean) from public, anon;
grant execute on function make_trophy(text, text, text, boolean) to authenticated;

-- ------------------------------------------------------------------------------------------------------------ the bucket ----

-- The trophies bucket, as avatars is (0025): public by URL, listed by nobody (no policy on storage.objects is written), WebP alone, at most 16 KB (the trophy-art
-- function's own bound, supabase/functions/trophy-art/core.ts) and 48 by 48 pixels, which that function checks and Storage cannot.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $b$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('trophies', 'trophies', true, 16384, array['image/webp'])
      on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$b$;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------------- a met demand ----

-- The apology's Act is public, so the digest role may read which Act it was; the character is read from that Act as every other author is.
grant select (apology_act) on apologies to kayfabb_digest;

-- Who a met demand credits: the characters whose public Acts made it, read as demand_progress (0129) reads them, kind by kind, from the Acts since the move landed. Staff are
-- left out as the count leaves them out. It reads public Acts and their public tallies (reaction_tallies) and never `reactions`: who reacted is private, and a character that
-- only reacted is credited with nothing. It is the digest role's, as demand_progress is, so the database refuses it the owner and the reactor even by mistake (0046).
--   postsOnBoard                the authors of the first `count` posts since the landing
--   distinctCharactersOnBoard   the first `count` characters to post since the landing
--   quadrantOnBoard             the authors of posts since the landing that drew the quadrant on their public tally
--   characterPostsInThread      that character
--   crossQuote                  each of the pair whose reply quoted the other and drew the reactions
--   apologyAccepted             the characters whose apology was accepted
create function demand_contributors(move_act uuid) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  landed timestamptz;
  demand jsonb;
  p jsonb;
  total integer;
  who uuid[];
begin
  select a.created_at, a.payload -> 'demand' into landed, demand from acts_public a where a.id = move_act and a.kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  if demand is null or jsonb_typeof(demand) <> 'object' then return '{}'; end if;
  p := demand -> 'params';
  case demand ->> 'kind'
    when 'postsOnBoard' then
      total := (p ->> 'count')::integer;
      select coalesce(array_agg(distinct s.character), '{}') into who from (
        select a.character from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        order by a.created_at, a.id limit total) s;
    when 'distinctCharactersOnBoard' then
      total := (p ->> 'count')::integer;
      select coalesce(array_agg(f.character), '{}') into who from (
        select a.character, min(a.created_at) as first_at from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        group by a.character order by min(a.created_at), a.character limit total) f;
    when 'quadrantOnBoard' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from acts_public a
      join thread_list tl on tl.id = a.thread
      join characters_public c on c.id = a.character
      join reaction_tallies t on t.act = a.id
      join reaction_kinds k on k.key = t.kind
      where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null and k.quadrant = p ->> 'quadrant' and t.count > 0;
    when 'characterPostsInThread' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from acts_public a join characters_public c on c.id = a.character
      where a.kind = 'post' and a.thread = (p ->> 'thread')::uuid and a.character = (p ->> 'character')::uuid and a.created_at > landed and c.staff is null;
    when 'crossQuote' then
      select coalesce(array_agg(d.quoter), '{}') into who
      from (values ((p ->> 'a')::uuid, (p ->> 'b')::uuid), ((p ->> 'b')::uuid, (p ->> 'a')::uuid)) d (quoter, quoted)
      join characters_public c on c.id = d.quoter and c.staff is null
      where exists (
        select 1 from acts_public r
        join acts_public q on q.id = r.target_act_id
        where r.kind = 'post' and r.created_at > landed and r.character = d.quoter and q.kind = 'post' and q.character = d.quoted
          and (select coalesce(sum(t.count), 0) from reaction_tallies t where t.act = r.id) >= (p ->> 'reactions')::integer);
    when 'apologyAccepted' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from apologies x join acts_public a on a.id = x.apology_act join characters_public c on c.id = a.character
      where x.move_act = demand_contributors.move_act and x.state = 'accepted' and c.staff is null;
    else
      raise exception 'there is no demand kind "%"', coalesce(demand ->> 'kind', '') using errcode = '22023';
  end case;
  return who;
end $$;
grant create on schema public to kayfabb_digest;
alter function demand_contributors(uuid) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function demand_contributors(uuid) from public, anon, authenticated;
grant execute on function demand_contributors(uuid) to service_role;
-- The tick's owner calls it through award_demand_trophies, as it calls demand_progress_or_error (0048).
do $$ begin execute format('grant execute on function demand_contributors(uuid) to %I', current_user); end $$;

-- The met demand's trophy to each character that made it. An instance with no trophy for a met demand gives none. Run by the tick in a block of its own.
create function award_demand_trophies(move_act uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text := (select k.key from trophy_kinds k where k.demand_met);
  who uuid[];
  given integer;
begin
  if kind is null then return 0; end if;
  who := demand_contributors(move_act);
  insert into trophy_awards (trophy, character, by, act)
  select kind, c, 'demand', move_act from unnest(who) c
  on conflict do nothing;
  get diagnostics given = row_count;
  return given;
end $$;
revoke execute on function award_demand_trophies(uuid) from public, anon, authenticated;

-- -------------------------------------------------------------------------------- a standing of 0 or below takes no place (#492) ----

-- The owner's answer on #492 (option 2): a mask whose season standing is 0 or below gets no place and no season place trophy, and the results list it unplaced.
-- Places count only the standings above zero, densely (#453): standings 500, 0 and 0 give one place 1 and two unplaced, where every idle mask shared the
-- last place before, and a season where most masks did nothing gave each a Runner-Up. A row's place is null where it is unplaced (season_results.place loses its
-- not null; its check still holds for a place that is written). The live standings place the same way (standing_place, standings_page, season_standings, below), since
-- between seasons they show the very table the results froze, and one place means one thing on every screen.
--
-- The table's order is its standings' order: by standing, highest first, then name, then id. Places are dense by standing, so the placed rows come first in
-- place order and the unplaced follow them by standing (0 before a standing below it), which an order on a nullable place could only say with a second key.
-- season_results_by_standing replaces season_results_by_place, so a page is still read in order from an index with the limit pushed down, and a character's
-- index in the order is two counts of index ranges: the rows standing above it, and those at its standing ahead of it by name and id. A row written before
-- #492 keeps the place it was written with ("Append-only"); its standing orders it as the place did, the places having been ranked by standing.
alter table season_results alter column place drop not null;
drop index season_results_by_place;
create index season_results_by_standing on season_results (season, standing desc, name, character);

-- results_page (0099), in the table's order: the placed first, by place, then the unplaced by standing. Everything else as 0099 wrote it.
create or replace function results_page(in_season integer, page integer) returns table ("character" uuid, name text, place integer, standing integer, shown jsonb)
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select r.character, r.name, r.place, r.standing, r.shown
  from season_results r
  -- The season's id as an init plan, so the order is read from the index (season_results_by_standing) with the limit pushed down, as a join would not.
  where r.season = (select f.id from seasons_finished f where f.number = in_season)
  order by r.standing desc, r.name, r.character
  offset (least(greatest(coalesce(page, 1), 1), 10000) - 1) * 50 limit 50;
end;

-- result_place (0099), the character's index in that order: the rows standing above it, and those at its standing ahead of it by name and id, each counted
-- from a range of season_results_by_standing. Null where the season has no row for it, as before.
create or replace function result_place(in_season integer, in_character uuid) returns integer
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select ((select count(*) from season_results r where r.season = f.id and r.standing > x.standing)
        + (select count(*) from season_results r where r.season = f.id and r.standing = x.standing and (r.name, r.character) < (x.name, x.character)))::integer
  from seasons_finished f join season_results x on x.season = f.id and x.character = in_character
  where f.number = in_season;
end;

-- season_news (0100), its results item's `top` the season's first three placed rows: a podium of the masks that placed, so a season where one mask stood
-- above zero shows one. Read from season_results_by_standing, where the placed rows come first. Everything else as 0100 wrote it.
create or replace function season_news(before timestamptz default null, most integer default 20) returns setof season_news_row
language sql stable security definer set search_path = public, pg_temp as $$
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id and r.place is not null order by r.standing desc, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, h.number - 1, 'bossFarewell' from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      select a.id, a.thread, a.seq, a.payload ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) p on true
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first
$$;
revoke execute on function season_news(timestamptz, integer) from public, anon;
grant execute on function season_news(timestamptz, integer) to authenticated;

-- ------------------------------------------------------------------------------------------------------ the season's places ----

-- reveal_season (0099), also giving the season's places a trophy each (below the results' insert, in its transaction), and numbering the places densely (#453):
-- standings 100, 90, 90 and 80 are places 1, 2, 2 and 3, so a tie never costs the next mask its place ("otherwise we are punishing people for doing well just
-- because somebody else did exactly as well"). Only a standing above zero is placed (#492, below): a standing of 0 or below is written with no place, so it takes
-- no place trophy and its player no alert of one. The live standings number them the same way (below). Everything else as 0099 wrote it.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  new_season bigint;
  written integer;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended) returning id into new_season;
  begin
    perform hand_over(new_season, s.boss, ended);
  exception when others then
    raise warning 'reveal_season: the handover of season % failed: % (%)', s.number + 1, sqlerrm, sqlstate;
    -- The season keeps its outgoing Boss rather than none, where that much can still be done.
    begin
      update seasons set boss = s.boss where id = new_season and boss is null;
      insert into season_handovers (season, outgoing, boss, how, note, at)
      values (new_season, s.boss, s.boss, case when s.boss is null then 'none' else 'unchanged' end, left('the handover failed: ' || sqlerrm, 1000), ended)
      on conflict (season) do nothing;
    exception when others then null;
    end;
  end;
  -- Each character in order of final standing, with its place and its standing, and only what its player made public in the season (`shown`): its
  -- reveals, and its announced Turns with the class each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into the next season, a clue rather than a stated fact
  -- (the class reveal design, section 5). A Turn that took effect at this very end is the next season's, as before. At one instant a Turn comes before
  -- the reveal it wrote (0028), as its tally stands before it in the thread. A character that debuts at this very settlement played no part in the
  -- season, and is the next one's.
  insert into season_results (season, character, name, place, standing, shown)
    select s.id, c.id, c.name, case when coalesce(st.amount, 0) > 0 then dense_rank() over (order by coalesce(st.amount, 0) desc) end, coalesce(st.amount, 0),
        coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended and c.staff is null
    order by coalesce(st.amount, 0) desc, c.name, c.id;
  get diagnostics written = row_count;
  update seasons set results_at = now(), results_count = written where id = s.id;
  -- The season's places (0163): each character at place 1 to 3 gets the trophy the instance gives for that place. Places are season_results' own, dense (#453), so a tie shares
  -- one and the next mask takes the next place, as the table shows it: 100, 90, 90, 80 give a Champion, two Runner-Up and a Third. An unplaced row (#492) joins no kind:
  -- 500, 0, 0 give one Champion and nothing else. Staff are not in season_results, and the table refuses them besides. In the results' transaction, but a failure here does not end it.
  -- In a block of its own: the season ends whatever happens here. A failure is a warning and a row (trophy_award_failures) for an admin, who can give the places by hand.
  begin
    insert into trophy_awards (trophy, character, by, season)
    select k.key, r.character, 'season', s.id from season_results r join trophy_kinds k on k.season_place = r.place
    where r.season = s.id and r.place <= 3;
  exception when others then
    raise warning 'reveal_season: the places of season % were not given trophies: % (%)', s.number, sqlerrm, sqlstate;
    begin
      insert into trophy_award_failures (season, error) values (s.id, left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (season) do update set error = excluded.error, at = now();
    exception when others then null;
    end;
  end;
  perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'results', 'season', s.number, 'act', null, 'at', now()));
  return jsonb_build_object('season', s.number, 'results', written);
end $$;

-- ---------------------------------------------------------------------------------- a place is dense everywhere (#453) ----

-- The owner's answer on #453: "Dense ranking for both makes sense, otherwise we are punishing people for doing well just because somebody else did
-- exactly as well." A season's results and its place trophies number places densely (reveal_season, above), and the live standings number them the
-- same way, so a place means one thing on every screen: standings 100, 90, 90 and 80 are places 1, 2, 2 and 3 on the standings, on a profile, in the
-- results and on the trophies. Between seasons the standings show the season that ended last, as it stood, which is the very table its results froze;
-- two numberings of one table would contradict each other on two screens. The ranking's definition (season_standings), a character's place
-- (standing_place) and a page of the standings (standings_page) change together, and so does the old reveals' backfill, which gave a place where an old
-- reveal Act wrote none. A place written in an old reveal Act is what that Act said and stays as written ("Append-only").
--
-- A dense place is one more than the number of distinct standings above, where it was one more than the characters above. The distinct amounts are
-- counted by walking standings_season_amount from one amount to the next lower one, a probe of the index each (a loose index scan), so the count costs
-- the distinct amounts above, never the characters standing at them: at a busy instance's scale, where many masks share a standing (every one with
-- nothing settled stands at 0), that is fewer probes than the characters 0030 counted. Since the roster (0030) every debuted character has a row from
-- its debut and in every season that opens, so the distinct amounts are the rows' own.

-- season_standings (0021), its places dense, and a standing of 0 or below unplaced (#492). Everything else as 0021 wrote it.
create or replace view season_standings as
  select c.id as character, c.name, coalesce(s.amount, 0) as standing,
    case when coalesce(s.amount, 0) > 0 then dense_rank() over (order by coalesce(s.amount, 0) desc) end as place
  from characters c
  left join standings s on s.character = c.id
    and s.season = coalesce((select id from seasons where ends_at is null), (select id from seasons order by starts_at desc limit 1))
  where c.debuted_at is not null;

-- standing_place (0030), its place one more than the distinct standings above, and none for a standing of 0 or below (#492), which walks nothing: at a busy
-- instance most masks stand at 0, and theirs costs one probe. Everything else as 0030 wrote it.
create or replace function standing_place(of_character uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  open_season bigint := standings_season();
  size integer := (select coalesce(sum(d.characters), 0) from debuted_count d);
  mine integer;
  ahead bigint;
begin
  if not exists (select 1 from characters c where c.id = of_character and c.debuted_at is not null) then return null; end if;
  mine := coalesce((select s.amount from standings s where s.season = open_season and s.character = of_character), 0);
  if mine <= 0 then return jsonb_build_object('standing', mine, 'place', null, 'of', size); end if;
  -- The distinct standings above, walked down the index from the highest: each step is the next lower amount still above this one.
  with recursive above(amount) as (
    (select s.amount from standings s where s.season = open_season and s.amount > mine order by s.amount desc limit 1)
    union all
    select (select s.amount from standings s where s.season = open_season and s.amount > mine and s.amount < a.amount order by s.amount desc limit 1)
    from above a where a.amount is not null
  )
  select count(a.amount) into ahead from above a;
  return jsonb_build_object('standing', mine, 'place', ahead + 1, 'of', size);
end $$;

-- standings_page (0030), its places dense: the page's first row stands one past the distinct standings above it (the same walk as standing_place's),
-- and each row after it one place lower for each new standing on the page. A row at 0 or below has no place (#492), and a page that starts there walks
-- nothing. Everything else as 0030 wrote it.
create or replace function standings_page(page_offset integer, page_limit integer)
returns table ("character" uuid, name text, standing integer, place bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive start as materialized (
    select s.amount, s.name from standings s
    where s.season = (select standings_season())
    order by s.amount desc, s.name
    offset greatest(page_offset, 0) limit 1
  ), page as materialized (
    select x.character, x.name, x.amount, row_number() over (order by x.amount desc, x.name) as n
    from ((select s.character, s.name, s.amount from standings s
           where s.season = (select standings_season()) and s.amount = (select amount from start) and s.name >= (select name from start)
           order by s.name limit least(greatest(page_limit, 0), 1000))
          union all
          (select s.character, s.name, s.amount from standings s
           where s.season = (select standings_season()) and s.amount < (select amount from start)
           order by s.amount desc, s.name limit least(greatest(page_limit, 0), 1000))) x
    order by x.amount desc, x.name
    limit least(greatest(page_limit, 0), 1000)
  ), above(amount) as (
    (select s.amount from standings s where s.season = (select standings_season()) and s.amount > (select amount from start) and (select amount from start) > 0
     order by s.amount desc limit 1)
    union all
    select (select s.amount from standings s
            where s.season = (select standings_season()) and s.amount > (select amount from start) and s.amount < a.amount order by s.amount desc limit 1)
    from above a where a.amount is not null
  ), head as materialized (
    select 1 + (select count(a.amount) from above a) as place
  )
  select p.character, p.name, p.amount, case when p.amount > 0 then h.place + dense_rank() over (order by p.amount desc) - 1 end
  from page p cross join head h
  order by p.n
$$;

-- backfill_season_results (0099), its places for a season revealed before the places were written dense, as reveal_season's are, and none for a
-- standing of 0 or below (#492), whatever an old reveal Act wrote: the Act stays as written, and the row places as every other does. Everything else
-- as 0099 wrote it.
create or replace function backfill_season_results() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into season_results (season, character, name, place, standing, shown)
  select f.season, f.character, f.name, case when f.standing > 0 then coalesce(f.place, dense_rank() over (partition by f.season order by f.standing desc)) end, f.standing, f.shown
  from (
    select s.id as season, c.id as character, r.payload ->> 'name' as name, (r.payload ->> 'place')::integer as place,
           coalesce((r.payload ->> 'standing')::integer, st.amount, 0) as standing,
           case when jsonb_typeof(r.payload -> 'shown') = 'array' then r.payload -> 'shown' else '[]'::jsonb end as shown
    from seasons s
    join acts h on h.id = s.reveal_act
    join acts r on r.thread = h.thread and r.kind = 'reveal' and r.payload ?& array['character', 'name']
    join characters c on c.id = (r.payload ->> 'character')::uuid
    left join standings st on st.season = s.id and st.character = c.id
  ) f
  on conflict (season, character) do nothing;
  update seasons s set results_at = coalesce(
    (select n.landed_at from news_landed n where n.act = s.reveal_act and n.kind = 'results'),
    (select h.created_at from acts h where h.id = s.reveal_act)),
    results_count = (select count(*) from season_results r where r.season = s.id)
  where s.reveal_act is not null and s.results_at is null
$$;

-- ----------------------------------------------------------------------------------------------------------- the tick ----

-- system_tick (0154, which drops a visit it cannot file as `dropped`), also writing a met demand's trophies once the move is ended `met` (step 3, in a block of its own).
-- Everything else as 0154 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  clash text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  unmet integer := 0;
  awards_failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  check_at timestamptz;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(due.params ->> 'board', '')::uuid, due.params ->> 'predicate', nullif(due.params -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, due.params, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := move_expires_at(inforce.move_act);
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover (or after it landed, if later), ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor')
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, season_start) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and not (a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null) and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then
          met := met + 1;
          -- The met demand's trophy to each character that made it (0163), in a block of its own: the move is ended whatever happens here. A failure is a warning, a row
          -- (trophy_award_failures) and a count in the tick's answer, and an admin can give the trophy by hand.
          begin
            perform award_demand_trophies(inforce.move_act);
          exception when others then
            awards_failed := awards_failed + 1;
            raise warning 'system_tick: the trophies for move % were not given: % (%)', inforce.move_act, sqlerrm, sqlstate;
            begin
              insert into trophy_award_failures (move_act, error) values (inforce.move_act, left(sqlerrm || ' (' || sqlstate || ')', 500))
              on conflict (move_act) do update set error = excluded.error, at = now();
            exception when others then null;
            end;
          end;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  -- 3b. Favors: a favor is a group conferred with a check (`params.checkAt`) and the demand it reads. It is not ended `met` by the pass above: a favor met is kept to its
  -- expiry. At its check, one whose demand is not met is stripped, `unmet`, and the Boss says so. A demand that cannot be evaluated (progress carries an `error`) is no evidence:
  -- the favor is left and read again at the next turn. The moves in force that carry a check are a handful; one past its check is read at most once in `demandCheckMinutes`, the
  -- least recently checked first, and none once the budget is spent. One already recorded met (open_moves.progress) is not read again: a demand only ever grows, and the favor
  -- is kept to its expiry.
  for inforce in
    select o.move_act, a.payload from open_moves o join acts a on a.id = o.move_act
    where a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null and (o.checked_at is null or o.checked_at <= now() - check_every)
      and coalesce((o.progress ->> 'met')::boolean, false) is not true
      -- Only a favor whose check has come (the case keeps a malformed time from being cast: the guard refuses one, and a move written any other way must not stop the tick).
      and case when a.payload #>> '{params,checkAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (a.payload #>> '{params,checkAt}')::timestamptz end <= now()
    order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      check_at := (inforce.payload #>> '{params,checkAt}')::timestamptz;
      if check_at <= now() then
        update open_moves set checked_at = now() where move_act = inforce.move_act;
        checked := checked + 1;
        counted := demand_progress_or_error(inforce.move_act);
        if not (counted ? 'error') then update open_moves set progress = counted where move_act = inforce.move_act; end if;
        if counted ? 'error' then
          failed := failed + 1;
          raise warning 'system_tick: favor % could not be read at its check: % ', inforce.move_act, counted ->> 'error';
        elsif not coalesce((counted ->> 'met')::boolean, false) then
          did_end := (end_move(inforce.move_act, 'unmet', 'check') ->> 'ended')::boolean;
          if did_end then unmet := unmet + 1; perform say_move_end(inforce.move_act, 'unmet'); end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: favor % was not checked: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent, at most `demandChecksPerTick` (the tick's one count for work per run; visits have no setting of their own); one that has failed goes behind the
  -- rest, by its last failure; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.failed_at nulls first, o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
      -- Recorded, and sent behind the others (the order above), so a visit that keeps failing never starves the rest.
      update visits_open set failed_at = now(), attempts = attempts + 1 where visit_act = late.visit_act returning attempts into tries;
      insert into visit_file_failures (visit_act, attempts, error) values (late.visit_act, coalesce(tries, 1), left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (visit_act) do update set attempts = excluded.attempts, error = excluded.error, at = now();
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (ended `dropped`, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'budget', out_of_time,
    'noThread', enabled and ann is null, 'awardsFailed', awards_failed);
end $$;

-- ------------------------------------------------------------------------------------------------------------- the seed ----

-- seed_instance (0162), also writing the instance's trophy kinds and where the catalog's lists point. Everything else as 0162 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, how long a Use of it is up, where it reaches, whether it pins, whether it writes, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, lasts, reaches, pins, writes, skim, scores_as, draws, drive, needs_message)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', '')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  -- The instance's trophy kinds (0163): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
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
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
