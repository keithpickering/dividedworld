-- A character's two pages, each in one read (supabase/migrations/0095_profile_record_pages.sql; the forum-load plan, Task 6).
-- profile_page and record_page answer, piece by piece, what the views answer read directly as the same caller; a character
-- characters_public does not show is null (as it is today); kinds and pages window the character's Acts; an unknown kind
-- answers as `all`; a visitor is refused. The screen-function guard (supabase/tests/e2e/0016-screen-reads.ts) holds them
-- to the read lists.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- The fixture: Pam has 26 posts, a spin, a card play on a post of Quill's, a class reveal, an announced Turn (a tally
-- naming her) and a season reveal post; Quill has a post and has never done more; Waiting has not debuted.
create table pg_temp.pr (pam uuid, quill uuid, waiting uuid, viewer uuid, t uuid, quill_post uuid, play uuid, spin uuid, unmask uuid, tally uuid, reveal uuid);
grant all on pg_temp.pr to public;

do $$
declare
  pam_owner uuid := tests.account('pr-pam');
  quill_owner uuid := tests.account('pr-quill');
  viewer uuid := tests.account('pr-viewer');
  pam uuid := tests.character(pam_owner, 'Pr Pam', 'alpha', now() - interval '90 days');
  quill uuid := tests.character(quill_owner, 'Pr Quill', 'alpha', now() - interval '90 days');
  waiting uuid;
  t uuid := tests.thread('Pr thread');
  spun uuid := tests.thread('Pr spun');
  quill_post uuid;
  play uuid;
  spin uuid;
  unmasked jsonb;
  tally uuid;
  reveal uuid;
  i integer;
begin
  insert into characters (owner, name, created_at) values (quill_owner, 'Pr Waiting', now()) returning id into waiting;
  insert into class_history (character, class_key, started_at) values (waiting, 'alpha', now());
  quill_post := tests.post(quill, t, 'Quill first.', now() - interval '80 days');
  for i in 1..26 loop perform tests.post(pam, t, 'Pam post ' || i, now() - interval '60 days' + i * interval '1 hour'); end loop;
  spin := tests.act(pam, 'spin', spun, '{"title": "Pam spun"}', quill_post, now() - interval '30 days');
  play := tests.act(pam, 'card', t, '{"card": "splat"}', quill_post, now() - interval '20 days');
  perform tests.become(pam_owner);
  unmasked := unmask(pam, t, 'Pam says.');
  perform tests.unbecome();
  tally := tests.act(null, 'tally', tests.thread('Pr turns'), jsonb_build_object('season', 1, 'part', 1, 'of', 1, 'debuts', '[]'::jsonb,
    'turns', jsonb_build_array(jsonb_build_object('character', pam, 'name', 'Pr Pam', 'loudness', 'announced', 'was', 'alpha'))), null, now() - interval '10 days');
  reveal := tests.act(null, 'reveal', tests.thread('Pr reveals'), jsonb_build_object('character', pam, 'season', 0, 'place', 2), null, now() - interval '5 days');
  insert into pg_temp.pr values (pam, quill, waiting, viewer, t, quill_post, play, spin, (unmasked ->> 'id')::uuid, tally, reveal);
end $$;

-- ---- Each piece of the profile equals the direct read ----
do $$
declare
  f pg_temp.pr;
  doc jsonb;
  want jsonb;
begin
  select * into f from pg_temp.pr;
  perform tests.become(f.viewer);
  doc := profile_page(f.pam);
  if doc is null then raise exception 'a debuted character has no profile'; end if;
  if doc -> 'character' is distinct from (select to_jsonb(c) from (select id, name, joined, staff, office from characters_public where id = f.pam) c) then raise exception 'character: %', doc -> 'character'; end if;
  if doc -> 'counts' ->> 'posts' is distinct from '26' or doc -> 'counts' ->> 'spins' is distinct from '1' or doc -> 'counts' ->> 'cards' is distinct from '1' then raise exception 'counts: %', doc -> 'counts'; end if;
  if doc -> 'counts' is distinct from (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = f.pam) n) then raise exception 'counts differ from the view'; end if;
  if doc -> 'standing' is distinct from standing_place(f.pam) then raise exception 'standing: %', doc -> 'standing'; end if;
  if doc -> 'settled_at' is distinct from coalesce((select to_jsonb(max(ends_at)) from settlements), 'null'::jsonb) then raise exception 'settled_at: %', doc -> 'settled_at'; end if;
  if doc -> 'season' is distinct from (select to_jsonb(s) from current_season s) then raise exception 'season: %', doc -> 'season'; end if;
  if jsonb_array_length(doc -> 'reveals') is distinct from 1 or doc -> 'reveals' -> 0 ->> 'act' is distinct from f.unmask::text
     or doc -> 'reveals' is distinct from (select jsonb_agg(to_jsonb(r)) from (select act, character, class, at, via, thread from class_reveals where character = f.pam) r) then raise exception 'reveals: %', doc -> 'reveals'; end if;
  if jsonb_array_length(doc -> 'turns') is distinct from 1 or doc -> 'turns' -> 0 ->> 'act' is distinct from f.tally::text or doc -> 'turns' -> 0 ->> 'was' is distinct from 'alpha'
     or doc -> 'turns' is distinct from (select jsonb_agg(to_jsonb(r)) from (select act, character, at, was from turns_announced where character = f.pam) r) then raise exception 'turns: %', doc -> 'turns'; end if;
  -- The newest five of her posts, spins and plays: the play, the spin, then posts 26, 25, 24.
  want := (select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select * from acts_public where character = f.pam and kind in ('post', 'spin', 'card') order by created_at desc limit 5) a);
  if doc -> 'acts' is distinct from want or jsonb_array_length(doc -> 'acts') is distinct from 5 then raise exception 'acts: %', doc -> 'acts'; end if;
  if doc -> 'acts' -> 0 ->> 'id' is distinct from f.play::text or doc -> 'acts' -> 1 ->> 'id' is distinct from f.spin::text then raise exception 'the newest acts are out of order'; end if;
  -- The play's target and the Turn's tally, for placing links.
  if (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(doc -> 'targets') x) is distinct from (select array_agg(i::text order by i::text) from unnest(array[f.quill_post, f.tally]) i) then raise exception 'targets: %', doc -> 'targets'; end if;
  if doc -> 'seasons' is distinct from (select jsonb_agg(to_jsonb(a)) from acts_public a where a.id = f.reveal) then raise exception 'seasons: %', doc -> 'seasons'; end if;
  if doc -> 'unread' is distinct from to_jsonb(my_alerts_unread()) then raise exception 'unread: %', doc -> 'unread'; end if;
  -- A character that has done nothing: empty lists.
  doc := profile_page(f.quill);
  if doc is null or jsonb_array_length(doc -> 'turns') <> 0 or jsonb_array_length(doc -> 'reveals') <> 0 then raise exception 'quill: %', doc; end if;
  perform tests.unbecome();
end $$;

-- ---- A character that has not debuted, and one that does not exist, are null ----
do $$
declare f pg_temp.pr;
begin
  select * into f from pg_temp.pr;
  perform tests.become(f.viewer);
  if exists (select 1 from characters_public where id = f.waiting) then raise exception 'the fixture is wrong: the waiting character is shown'; end if;
  if profile_page(f.waiting) is not null or profile_page(gen_random_uuid()) is not null then raise exception 'a profile for a character characters_public hides'; end if;
  if record_page(f.waiting, 'all', 1) is not null or record_page(gen_random_uuid(), 'post', 1) is not null then raise exception 'a record for a character characters_public hides'; end if;
  perform tests.unbecome();
end $$;

-- ---- The record: kinds and pages ----
do $$
declare
  f pg_temp.pr;
  doc jsonb;
begin
  select * into f from pg_temp.pr;
  perform tests.become(f.viewer);
  -- Posts: pages of twenty, newest first.
  doc := record_page(f.pam, 'post', 1);
  if jsonb_array_length(doc -> 'acts') is distinct from 20 or doc -> 'kind' is distinct from '"post"' or doc -> 'page' is distinct from '1' then raise exception 'post page 1: %', doc; end if;
  if doc -> 'acts' is distinct from (select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select * from acts_public where character = f.pam and kind = 'post' order by created_at desc limit 20) a) then raise exception 'post page 1 differs from the view'; end if;
  if doc -> 'counts' ->> 'posts' is distinct from '26' then raise exception 'counts: %', doc -> 'counts'; end if;
  doc := record_page(f.pam, 'post', 2);
  if jsonb_array_length(doc -> 'acts') is distinct from 6 then raise exception 'post page 2: %', jsonb_array_length(doc -> 'acts'); end if;
  if doc -> 'acts' -> 5 -> 'payload' ->> 'body' is distinct from 'Pam post 1' then raise exception 'the oldest post is last'; end if;
  doc := record_page(f.pam, 'post', 3);
  if jsonb_array_length(doc -> 'acts') <> 0 then raise exception 'a page past the end holds acts'; end if;
  -- Spins and cards; the play's target comes with it.
  doc := record_page(f.pam, 'spin', 1);
  if jsonb_array_length(doc -> 'acts') is distinct from 1 or doc -> 'acts' -> 0 ->> 'id' is distinct from f.spin::text then raise exception 'spins: %', doc -> 'acts'; end if;
  doc := record_page(f.pam, 'card', 1);
  if jsonb_array_length(doc -> 'acts') is distinct from 1 or doc -> 'acts' -> 0 ->> 'id' is distinct from f.play::text
     or jsonb_array_length(doc -> 'targets') is distinct from 1 or doc -> 'targets' -> 0 ->> 'id' is distinct from f.quill_post::text then raise exception 'cards: %', doc; end if;
  -- Class statements: the reveal and the Turn, read whole, with the tally for the link; no Acts.
  doc := record_page(f.pam, 'class', 1);
  if jsonb_array_length(doc -> 'reveals') <> 1 or jsonb_array_length(doc -> 'turns') <> 1 or jsonb_array_length(doc -> 'acts') <> 0
     or doc -> 'targets' -> 0 ->> 'id' is distinct from f.tally::text then raise exception 'class: %', doc; end if;
  -- Seasons: the reveal post alone.
  doc := record_page(f.pam, 'seasons', 1);
  if jsonb_array_length(doc -> 'seasons') <> 1 or doc -> 'seasons' -> 0 ->> 'id' is distinct from f.reveal::text or jsonb_array_length(doc -> 'acts') <> 0 or jsonb_array_length(doc -> 'reveals') <> 0 then raise exception 'seasons: %', doc; end if;
  -- All: the extras (1 reveal, 1 Turn, 1 season reveal = 3) and the Acts window mergeWindow asks for.
  doc := record_page(f.pam, 'all', 1);
  if jsonb_array_length(doc -> 'reveals') <> 1 or jsonb_array_length(doc -> 'turns') <> 1 or jsonb_array_length(doc -> 'seasons') <> 1 then raise exception 'all extras: %', doc; end if;
  if jsonb_array_length(doc -> 'acts') is distinct from 20 then raise exception 'all page 1 acts: %', jsonb_array_length(doc -> 'acts'); end if;
  -- Page 2 reads from max(0, 20 - 3) = 17 for 20 + 20 - 17 = 23 rows; she has 26 + 1 + 1 = 28 Acts, so 11 remain after 17.
  doc := record_page(f.pam, 'all', 2);
  if jsonb_array_length(doc -> 'acts') is distinct from 11 then raise exception 'all page 2 acts: %', jsonb_array_length(doc -> 'acts'); end if;
  if doc -> 'acts' is distinct from (select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select * from acts_public where character = f.pam and kind in ('post', 'spin', 'card') order by created_at desc offset 17 limit 23) a) then raise exception 'all page 2 differs from the view'; end if;
  -- An unknown kind, a null kind and a page of 0 or null answer as `all` page 1.
  if record_page(f.pam, 'bogus', 0) is distinct from record_page(f.pam, 'all', 1) or record_page(f.pam, null, null) is distinct from record_page(f.pam, 'all', 1) then raise exception 'an unknown kind did not answer as all'; end if;
  if record_page(f.pam, 'post', 99999) ->> 'page' is distinct from '10000' then raise exception 'a huge page was not clamped'; end if;
  -- The character comes with the page; unread is the caller's.
  if doc -> 'character' ->> 'name' is distinct from 'Pr Pam' or doc -> 'unread' is distinct from to_jsonb(my_alerts_unread()) then raise exception 'character or unread: %', doc; end if;
  perform tests.unbecome();
end $$;

-- ---- Nothing is written ----
do $$
declare f pg_temp.pr; before bigint; after bigint;
begin
  select * into f from pg_temp.pr;
  select count(*) into before from acts;
  perform tests.become(f.viewer);
  perform profile_page(f.pam), record_page(f.pam, 'all', 1);
  perform tests.unbecome();
  select count(*) into after from acts;
  if before is distinct from after then raise exception 'a page wrote an Act'; end if;
end $$;

-- ---- A visitor is refused ----
do $$
declare f pg_temp.pr; why text;
begin
  select * into f from pg_temp.pr;
  perform tests.become_anon();
  why := pg_temp.refusal(format('select profile_page(%L)', f.pam));
  if why is null or why not like '42501%' then raise exception 'a visitor read a profile: %', why; end if;
  why := pg_temp.refusal(format('select record_page(%L, %L, 1)', f.pam, 'all'));
  if why is null or why not like '42501%' then raise exception 'a visitor read a record: %', why; end if;
  perform tests.unbecome();
end $$;
