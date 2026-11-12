-- The author's veil (supabase/migrations/0400_post_veils.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 2; engine/rules/cards.ts, CardRules.veil).
-- A cast card with `veil = 'author'` on a post withholds its author from every read while it is up: acts_public answers the one stand-in character for the post and for every Act its own author
-- made on it, to every reader alike, and the author's own screens learn it is theirs only from my_veiled_posts. The cards are this file's own (vl...).
--
--  1. The catalog: card_kinds_problem holds the veil's refusals in the engine's words; a cast with `lasts` on a post writes `ends`.
--  2. A cast lands a post_veils row, ends at its time, and a second is refused while it is up; one lands again once it has ended.
--  3. acts_public shows the stand-in for the post and for its author's Acts on it, and the true character for everything else; the same after the time and after an admin's end, the true one again.
--  4. The refusals (a staff post, a post a Mod Bot has been to), a Mod Bot's visit and a report while it is up, and no card on the stand-in.
--  5. A face-down veil lands on the post that quotes it, and veils that post's author; one that cannot land (a staff post, a visited post, a post a card was played from) stays set.
--  6. acts.character is no longer readable by a signed-in player, and the readers that needed it still answer.
--  7. my_veiled_posts holds the author's own rows and nobody else's; thread_page carries them.
--  8. Bounded reads: with a live veil in the table, reads by character, by thread and seq and by id keep their indexes, and so does a count's.
--  9. A card played from a post (at character reach) names its author: no veil lands on that post, from a cast or a spring, and none is played from a veiled one.
-- 10. The staff lists, the pool's signals and the digest leave the stand-in out of the staff.
-- 11. The counts: character_post_counts counts a veiled post for the stand-in while the veil is up, for every reader, and the author's own count is whole again by itself.
-- 12. The groups are The System's own scoring: group_now reads the stored count, so a veil never moves a character's group, though the count a player reads drops for as long as it is up.
--  0. The seed makes the stand-in once, and office says so (first, since the sections after it make the stand-in themselves).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A statement run as a signed-in account: 'ok' when it went through, else the refusal's code and words.
create function pg_temp.as_(account uuid, stmt text) returns text language plpgsql as $$
begin
  perform tests.become(account);
  begin
    execute stmt;
  exception when others then
    perform tests.unbecome();
    return sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
  return 'ok';
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The stand-in, as seed_instance makes it (section 9 holds the seed itself).
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('vlauthor', 'Vl Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null),
    ('vltotals', 'Vl Blind', 'salty', 'uncommon', 'cast', '{post}', interval '3 days', 'totals', 1, null),
    ('vlmove', 'Vl Plain', 'sweet', 'common', 'cast', '{post}', null, null, 1, null),
    ('vlonce', 'Vl Once', 'sweet', 'common', 'cast', '{post}', interval '2 days', null, 1, null),
    ('vluse', 'Vl Use', 'salty', 'uncommon', 'use', '{post}', interval '7 days', null, 1, '{"kind": "ward", "cards": ["vlnothing"]}'),
    ('vlchar', 'Vl Char', 'salty', 'uncommon', 'cast', '{character}', interval '1 day', null, 1, null),
    ('vlself', 'Vl Self', 'sweet', 'uncommon', 'use', '{character}', interval '1 day', null, 1, '{"kind": "ward", "cards": ["vlnothing"]}')
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, trap, stack) values
    ('vltrap', 'Vl Trap', 'salty', 'uncommon', 'set', '{post}', '{"trigger": {"on": "cast"}}', 1)
  on conflict (key) do nothing;
end $$;

-- The veil rows on the posts of a thread (a file runs in one transaction, so a global count would meet the sections before it).
create function pg_temp.veils_in(in_thread uuid) returns integer language plpgsql as $$
begin
  return (select count(*)::integer from post_veils v join acts a on a.id = v.post where a.thread = in_thread);
end $$;

-- A statement's plan, with sequential scans off: the question is whether an index can serve the read at all.
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare ln record; out text := '';
begin
  for ln in execute 'explain ' || q loop out := out || E'\n' || ln."QUERY PLAN"; end loop;
  return out;
end $$;

-- Shared buffers (hit or read) one statement touches, from EXPLAIN (ANALYZE, BUFFERS), as 0075-play-moments.sql measures; run a few times first so a plan's first catalog reads are not counted.
create function pg_temp.buffers_of(call_sql text) returns bigint language plpgsql as $$
declare plan jsonb;
begin
  for i in 1..8 loop execute call_sql; end loop;
  execute 'explain (analyze, buffers, format json) ' || call_sql into plan;
  return coalesce((plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0);
end $$;

-- ---- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below) ----
select tests.unbecome();
do $$
begin
  if to_regclass('post_veils') is null then raise exception 'post_veils exists'; end if;
  if to_regclass('acts_base') is null then raise exception 'acts_base exists'; end if;
  if to_regclass('my_veiled_posts') is null then raise exception 'my_veiled_posts exists'; end if;
  if to_regprocedure('stand_in()') is null then raise exception 'stand_in() exists'; end if;
  if to_regprocedure('shown_author(uuid,uuid)') is null then raise exception 'shown_author(uuid, uuid) exists'; end if;
  if to_regprocedure('author_veiled(uuid)') is null then raise exception 'author_veiled(uuid) exists'; end if;
  if to_regprocedure('land_rows(uuid,card_kinds,uuid,jsonb,uuid)') is null then raise exception 'land_rows(uuid, card_kinds, uuid, jsonb, uuid) exists'; end if;
  if to_regprocedure('land_refusal(card_kinds,uuid,jsonb)') is null then raise exception 'land_refusal(card_kinds, uuid, jsonb) exists'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'veil') then raise exception 'card_kinds.veil exists'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'adds_reaction') then raise exception 'card_kinds.adds_reaction exists'; end if;
  -- No API role runs the helpers or reads the table.
  -- A view's functions are run as its caller, so the views that need stand_in() and shown_author() (acts_public, thread_open, my_cards_ended) write out what they say; none of the helpers is for an API role.
  if has_function_privilege('authenticated', 'stand_in()', 'execute') or has_function_privilege('authenticated', 'shown_author(uuid,uuid)', 'execute') or has_function_privilege('anon', 'stand_in()', 'execute')
     or has_function_privilege('authenticated', 'author_veiled(uuid)', 'execute') or has_function_privilege('authenticated', 'author_veil_ends(uuid)', 'execute')
     or has_function_privilege('authenticated', 'land_rows(uuid,card_kinds,uuid,jsonb,uuid)', 'execute') or has_function_privilege('authenticated', 'land_refusal(card_kinds,uuid,jsonb)', 'execute') then
    raise exception 'an API role can run a veil helper';
  end if;
  if has_table_privilege('authenticated', 'post_veils', 'select') or has_table_privilege('anon', 'post_veils', 'select') or has_table_privilege('authenticated', 'acts_base', 'select') then
    raise exception 'an API role can read post_veils or acts_base';
  end if;
end $$;

-- ---- 0. The seed makes the stand-in once, and its office is plain (first: a file is one transaction, and every later section makes the stand-in as the seed would) ----
select tests.unbecome();
do $$
declare
  seed jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'anonymous', jsonb_build_object('name', 'Anonymous', 'title', 'Could be anyone.', 'avatar', 'nobody'));
  who uuid; n integer;
begin
  perform seed_instance(seed - 'anonymous');
  if exists (select 1 from characters where staff_kind = 'anonymous') then raise exception 'a seed with no stand-in made one'; end if;
  if stand_in() is not null then raise exception 'stand_in() answered with no stand-in made'; end if;
  perform seed_instance(seed);
  select id into who from characters where staff_kind = 'anonymous';
  if who is null then raise exception 'the seed made no stand-in'; end if;
  if (select (c.name, c.staff, c.owner is null, c.debuted_at is not null) from characters c where c.id = who)::text is distinct from '(Anonymous,anonymous,t,t)' then raise exception 'the stand-in is a staff character with the seed''s name, no owner, debuted'; end if;
  if (select title from character_profiles where character = who) is distinct from 'Could be anyone.' then raise exception 'the stand-in''s tagline is its profile title'; end if;
  if (select value #>> '{}' from settings where key = 'anonymousAvatar') is distinct from 'nobody' then raise exception 'the stand-in''s avatar key is recorded'; end if;
  if stand_in() is distinct from who then raise exception 'stand_in() is not the stand-in'; end if;
  if (select cp.office from characters_public cp where cp.id = who) is distinct from 'anonymous' then raise exception 'the stand-in''s office is %', (select cp.office from characters_public cp where cp.id = who); end if;
  -- Once: a reseed makes no second, and a second cannot be made.
  perform seed_instance(seed);
  select count(*) into n from characters where staff_kind = 'anonymous';
  if n is distinct from 1 then raise exception 'a reseed made % stand-ins', n; end if;
  begin insert into characters (name, staff, staff_kind, debuted_at) values ('Second Anon', 'anon-two', 'anonymous', now()); raise exception 'a second stand-in was made';
  exception when unique_violation then null; end;
  -- A seed's card carries its veil and its reaction flag into the table, and a card that breaks the pairings is refused with the card's name.
  perform seed_instance(seed || jsonb_build_object('cards', jsonb_build_array(
    jsonb_build_object('key', 'seeded-veil', 'name', 'Seeded Veil', 'alignment', 'salty', 'rarity', 'rare', 'play', 'cast', 'reaches', jsonb_build_array('post'), 'lasts', jsonb_build_object('unit', 'day', 'count', 3), 'veil', 'totals', 'addsReaction', false),
    jsonb_build_object('key', 'seeded-react', 'name', 'Seeded React', 'alignment', 'salty', 'rarity', 'common', 'play', 'cast', 'reaches', jsonb_build_array('post'), 'stack', 3, 'addsReaction', true))));
  if (select (k.veil, k.adds_reaction) from card_kinds k where k.key = 'seeded-veil')::text is distinct from '(totals,f)' or (select (k.veil, k.adds_reaction) from card_kinds k where k.key = 'seeded-react')::text is distinct from '(,t)' then
    raise exception 'the seed carried the flags wrong: %', (select jsonb_agg(to_jsonb(k)) from card_kinds k where k.key like 'seeded-%');
  end if;
  begin
    perform seed_instance(seed || jsonb_build_object('cards', jsonb_build_array(
      jsonb_build_object('key', 'seeded-bad', 'name', 'Seeded Bad', 'alignment', 'salty', 'rarity', 'rare', 'play', 'cast', 'reaches', jsonb_build_array('post'), 'veil', 'author'))));
    raise exception 'a seed with a veil and no time up was accepted';
  exception when sqlstate '22023' then
    if sqlerrm not like '%card "seeded-bad" has a veil with no time up (lasts); a veil ends at its time%' then raise; end if;
  end;
end $$;

-- ---- 1. The catalog ----
do $$
declare
  base jsonb := jsonb_build_object('rarity', 'rare', 'play', 'cast', 'reaches', jsonb_build_array('post'), 'lasts', jsonb_build_object('unit', 'day', 'count', 3));
  why text;
begin
  -- A good veil, and a good reaction, are refused nothing.
  if card_kinds_problem(jsonb_build_array(base || '{"key": "ok-veil", "veil": "author"}'::jsonb)) is not null then raise exception 'a good veil was refused: %', card_kinds_problem(jsonb_build_array(base || '{"key": "ok-veil", "veil": "author"}'::jsonb)); end if;
  if card_kinds_problem(jsonb_build_array(base - 'lasts' || '{"key": "ok-react", "addsReaction": true}'::jsonb)) is not null then raise exception 'a good reaction card was refused: %', card_kinds_problem(jsonb_build_array(base - 'lasts' || '{"key": "ok-react", "addsReaction": true}'::jsonb)); end if;
  -- A cast with a time up on a post alone is no longer refused (a skim, a veil); a set card with one still is.
  if card_kinds_problem(jsonb_build_array(base || '{"key": "ok-lasts"}'::jsonb)) is not null then raise exception 'a cast on a post with lasts was refused: %', card_kinds_problem(jsonb_build_array(base || '{"key": "ok-lasts"}'::jsonb)); end if;
  why := card_kinds_problem(jsonb_build_array(base || '{"key": "bad-set", "play": "set", "trap": {"trigger": {"on": "cast"}}}'::jsonb));
  if why is distinct from 'card "bad-set" has a time up (lasts), and only a use card, a cast card or a card reaching beyond a post does' then raise exception 'a set card with lasts: %', why; end if;

  -- Each poison, in the engine's words (engine/rules/instance.ts, veilProblems).
  why := card_kinds_problem(jsonb_build_array(base || '{"key": "p1", "veil": "author", "play": "use", "gimmick": {"kind": "noQuote"}}'::jsonb));
  if why is null or why not like '%card "p1" has a veil, and only a cast card does%' then raise exception 'a veil on a use card: %', why; end if;
  why := card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "p2", "veil": "author"}'::jsonb));
  if why is distinct from 'card "p2" has a veil with no time up (lasts); a veil ends at its time' then raise exception 'a veil with no lasts: %', why; end if;
  why := card_kinds_problem(jsonb_build_array(base || '{"key": "p3", "veil": "totals", "reaches": ["thread"]}'::jsonb));
  if why is null or why not like '%card "p3" has a veil, and a card with a veil reaches a post alone%' then raise exception 'a veil reaching a thread: %', why; end if;
  why := card_kinds_problem(jsonb_build_array(base || '{"key": "p4", "veil": "author", "addsReaction": true}'::jsonb));
  if why is distinct from 'card "p4" has both a veil and a reaction; a card has one of the two' then raise exception 'a veil with a reaction: %', why; end if;
  why := card_kinds_problem(jsonb_build_array(base || '{"key": "p5", "veil": "everyone"}'::jsonb));
  if why is distinct from 'card "p5" has a veil of "everyone"; a veil is author or totals' then raise exception 'a veil of another word: %', why; end if;
  why := card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "p6", "addsReaction": true, "writes": true}'::jsonb));
  if why is distinct from 'card "p6" has a reaction and writes; a card with a reaction does not write' then raise exception 'a reaction that writes: %', why; end if;
  why := card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "p7", "addsReaction": true, "seeded": true}'::jsonb));
  if why is distinct from 'card "p7" has a reaction and is seeded; a card with a reaction is not' then raise exception 'a reaction that is seeded: %', why; end if;
  why := card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "p8", "addsReaction": true, "play": "use", "gimmick": {"kind": "noQuote"}}'::jsonb));
  if why is null or why not like '%card "p8" has a reaction, and only a cast card does%' then raise exception 'a reaction on a use card: %', why; end if;
  why := card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "p9", "addsReaction": true, "reaches": ["character"]}'::jsonb));
  if why is null or why not like '%card "p9" has a reaction, and a card with a reaction reaches a post alone%' then raise exception 'a reaction reaching a character: %', why; end if;
  -- The table holds the same pairings.
  begin
    insert into card_kinds (key, name, alignment, rarity, play, reaches, veil) values ('vlbad', 'Vl Bad', 'salty', 'rare', 'cast', '{post}', 'author');
    raise exception 'a veil with no lasts was stored';
  exception when check_violation then null; end;
  begin
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil) values ('vlbad', 'Vl Bad', 'salty', 'rare', 'cast', '{thread}', interval '1 day', 'totals');
    raise exception 'a veil on a thread was stored';
  exception when check_violation then null; end;
  begin
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil) values ('vlbad', 'Vl Bad', 'salty', 'rare', 'cast', '{post}', interval '1 day', 'both');
    raise exception 'a veil of another word was stored';
  exception when check_violation then null; end;
end $$;

-- ---- 2. A cast veil lands, ends at its time, and is the post's one; a second lands once the first is over ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vl-ann'); bob uuid := tests.account('vl-bob');
  a uuid := tests.character(ann, 'Vl Ann'); b uuid := tests.character(bob, 'Vl Bob');
  t uuid := tests.thread('Vl lands');
  p uuid := tests.post(a, t, 'Whose words are these?'); over uuid := tests.post(a, t, 'Its veil is over.'); p3 uuid := tests.post(a, t, 'A plain cast.');
  stand uuid := pg_temp.stand();
  vp uuid; old uuid; again uuid; got text; v record;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlauthor', 'vlauthor', 'vlmove');
  perform tests.become_service();
  vp := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  select * into v from post_veils x where x.play = vp;
  if v.play is null then raise exception 'a cast veil wrote no post_veils row'; end if;
  if (v.post, v.veil, v.author, v.caster_account) is distinct from (p, 'author'::text, a, bob) then raise exception 'the veil row is wrong: %', to_jsonb(v); end if;
  if v.ends_at is distinct from now() + interval '3 days' then raise exception 'a veil ends in three days, not %', v.ends_at; end if;
  if (select (k.payload ->> 'ends')::timestamptz from acts k where k.id = vp) is distinct from v.ends_at then raise exception 'the play''s own ends and the veil''s differ'; end if;
  if (select count(*) from post_veils) is distinct from 1 then raise exception 'one veil, one row'; end if;
  -- It is the post's: a second is refused while it is up, in the stack's words.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, p, '{}', ''));
  if got is distinct from '23505 this post already carries that card' then raise exception 'a second veil while one is up: %', got; end if;
  perform tests.unbecome();
  if (select count(*) from post_veils) is distinct from 1 then raise exception 'a refused second veil wrote a row'; end if;
  -- A card with no time up writes no veil row, and its play carries no ends.
  perform tests.become_service();
  again := (play_card(bob, 'vlmove', b, p3, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if exists (select 1 from post_veils x where x.play = again) or (select k.payload ? 'ends' from acts k where k.id = again) then raise exception 'a plain cast wrote a veil row or an end'; end if;
  -- A cast with a time up on a post ends at it, whatever it holds: its play carries `ends` (the stack and the end both read it).
  perform pg_temp.hand(bob, 'vlonce');
  perform tests.become_service();
  again := (play_card(bob, 'vlonce', b, p3, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select (k.payload ->> 'ends')::timestamptz from acts k where k.id = again) is distinct from now() + interval '2 days' then raise exception 'a cast with lasts ends at its time'; end if;
  if exists (select 1 from post_veils x where x.play = again) then raise exception 'a cast with lasts and no veil wrote a veil row'; end if;

  -- A veil whose time has passed holds no place: a second lands, and the row is its own.
  old := tests.act(b, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 day'), over, now() - interval '4 days');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (old, over, 'author', a, bob, now() - interval '1 day');
  perform tests.become_service();
  again := (play_card(bob, 'vlauthor', b, over, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select count(*) from post_veils x where x.post = over) is distinct from 2 or not exists (select 1 from post_veils x where x.play = again and x.ends_at > now()) then raise exception 'a veil after the first one''s end did not land'; end if;

  -- A veil row is written once, with its Act, and never edited.
  begin update post_veils set ends_at = now() where post_veils.play = vp; raise exception 'a veil row was edited'; exception when others then if sqlerrm = 'a veil row was edited' then raise; end if; end;
  begin delete from post_veils where post_veils.play = vp; raise exception 'a veil row was deleted'; exception when others then if sqlerrm = 'a veil row was deleted' then raise; end if; end;
end $$;

-- ---- 3. What the readers show: the stand-in for the post and its author's Acts on it, the true character for the rest ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vr-ann'); bob uuid := tests.account('vr-bob'); ray uuid := tests.account('vr-ray'); adm uuid := tests.account('vr-admin');
  a uuid := tests.character(ann, 'Vr Ann'); b uuid := tests.character(bob, 'Vr Bob'); r uuid := tests.character(ray, 'Vr Ray');
  t uuid := tests.thread('Vr reads');
  first uuid := tests.post(r, t, 'Opening.'); p uuid := tests.post(a, t, 'Whose words are these?'); reply uuid := tests.post(a, t, 'A reply of the same hand.');
  quoted uuid; edit uuid; used uuid; back uuid; theirs uuid; veil uuid; setter uuid;
  stand uuid := pg_temp.stand(); other uuid := tests.post(b, t, 'Bob''s own post.');
  got uuid;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(ann, 'vluse', 'vlmove');
  perform pg_temp.hand(bob, 'vlauthor', 'vlmove');
  -- Before the veil: everything shows its own character.
  perform tests.become(ray);
  if (select a2.character from acts_public a2 where a2.id = p) is distinct from a then raise exception 'before a veil the post shows its author'; end if;
  perform tests.unbecome();
  -- Bob quotes the post, Ann edits it, uses a card on it and sets one face down on it, and Bob casts a plain card on it.
  quoted := tests.act(b, 'post', t, jsonb_build_object('body', 'Quoting it.'), p);
  edit := tests.act(a, 'edit', t, jsonb_build_object('body', 'Whose words are these, reworded?'), p);
  perform tests.become_service();
  used := (play_card(ann, 'vluse', a, p, '{}', 0, '') ->> 'id')::uuid;
  setter := (set_card(ann, 'vlmove', a, p, '{}', 0) ->> 'id')::uuid;
  theirs := (play_card(bob, 'vlmove', b, p, '{}', 0, '') ->> 'id')::uuid;
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();

  -- Every reader sees the stand-in for the post and for Ann's Acts on it.
  perform tests.become(ray);
  if (select count(*) from acts_public x where x.id in (p, edit, used, setter) and x.character = stand) is distinct from 4 then
    raise exception 'the post, its edit, a card and a set by its author do not all show the stand-in: %', (select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'character', x.character)) from acts_public x where x.id in (p, edit, used, setter));
  end if;
  if (select x.character from acts_public x where x.id = reply) is distinct from a then raise exception 'a reply of the author''s own shows the stand-in'; end if;
  if (select x.character from acts_public x where x.id = quoted) is distinct from b then raise exception 'another character''s quote of it shows the stand-in'; end if;
  if (select x.character from acts_public x where x.id = theirs) is distinct from b or (select x.character from acts_public x where x.id = veil) is distinct from b then raise exception 'another character''s card on it shows the stand-in'; end if;
  if (select x.character from acts_public x where x.id = first) is distinct from r then raise exception 'an unrelated post shows the stand-in'; end if;
  -- By character: Ann's posts leave out the veiled one, and the stand-in's holds it; by thread and seq the post is in its place, once.
  if exists (select 1 from acts_public x where x.character = a and x.id in (p, edit, used, setter)) then raise exception 'Ann''s own Acts still hold the veiled ones'; end if;
  if (select count(*) from acts_public x where x.character = stand and x.thread = t) is distinct from 4 then raise exception 'the stand-in holds % Acts', (select count(*) from acts_public x where x.character = stand and x.thread = t); end if;
  if (select count(*) from acts_public x where x.thread = t and x.seq = (select y.seq from acts y where y.id = p)) is distinct from 1 then raise exception 'the post is read once by its place'; end if;
  if (select count(*) from acts_public x where x.id = p) is distinct from 1 or (select count(*) from acts_public x where x.target_act_id = p) is distinct from 6 then raise exception 'a read by id or by target repeats or loses a row'; end if;
  if (select count(*) from (select x.id from acts_public x group by x.id having count(*) > 1) d) > 0 then raise exception 'acts_public repeats a row'; end if;
  perform tests.unbecome();
  -- The projection every action broadcasts is the same one, whoever wrote it.
  if (act_projection(p) ->> 'character')::uuid is distinct from stand then raise exception 'act_projection shows the author'; end if;
  perform tests.become(ann);
  if (select x.character from acts_public x where x.id = p) is distinct from stand then raise exception 'the author reads the post under a name of their own'; end if;
  perform tests.unbecome();
  if (author_veiled(p) is not true) or author_veiled(reply) is not false or author_veiled(quoted) is not false then raise exception 'author_veiled says %, %, %', author_veiled(p), author_veiled(reply), author_veiled(quoted); end if;
  if shown_author(p, a) is distinct from stand or shown_author(reply, a) is distinct from a then raise exception 'shown_author is wrong'; end if;

  -- acts_public is acts_base with the stand-in in place of the true character on the veiled rows and nothing else: every other column is the same on every row.
  if exists (select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at from acts_base where thread = t
            except select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at from acts_public where thread = t)
     or exists (select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at from acts_public where thread = t
            except select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at from acts_base where thread = t) then
    raise exception 'acts_public differs from acts_base in a column other than character';
  end if;
  if (select count(*) from acts_base b join acts_public x on x.id = b.id where b.thread = t and x.character is distinct from b.character) is distinct from 4 then raise exception 'the veiled rows are not the four whose character differs'; end if;
  -- An admin's end shows the author again, in every one of those.
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  if (select count(*) from acts_public x where x.id in (p, edit, used, setter) and x.character = a) is distinct from 4 then raise exception 'after an admin''s end the author is still hidden'; end if;
  if exists (select 1 from acts_public x where x.character = stand and x.thread = t) then raise exception 'after an admin''s end the stand-in still holds Acts'; end if;
  if author_veiled(p) is not false then raise exception 'author_veiled holds after an admin''s end'; end if;

  -- After the time: a veil whose end has passed shows the author again as well (rows written with their times already past).
  declare
    gone uuid := tests.post(a, t, 'Its veil wore off.'); ended uuid;
  begin
    ended := tests.act(b, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 hour'), gone, now() - interval '3 days');
    insert into post_veils (play, post, veil, author, caster_account, ends_at) values (ended, gone, 'author', a, bob, now() - interval '1 hour');
    if (select x.character from acts_public x where x.id = gone) is distinct from a then raise exception 'after the time the author is still hidden'; end if;
  end;
end $$;

-- ---- 4. The refusals, the Mod Bots and the stand-in as a target ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vf-ann'); bob uuid := tests.account('vf-bob'); adm uuid := tests.account('vf-admin');
  a uuid := tests.character(ann, 'Vf Ann'); b uuid := tests.character(bob, 'Vf Bob');
  t uuid := tests.thread('Vf refusals');
  stand uuid := pg_temp.stand();
  bot uuid; botpost uuid; seen uuid; clean uuid; visit uuid; veil uuid; got text; spent_before integer; reports_before integer;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(bob, 'vlauthor', 'vlauthor', 'vlauthor', 'vlchar');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Vf Bot', 'vf-bot', 'persona', now()) returning characters.id into bot;
  seen := tests.post(a, t, 'A Mod Bot has been here.'); clean := tests.post(a, t, 'Nobody has.');
  perform set_config('kayfabb.staff_writer', 'on', true);
  botpost := tests.post(bot, t, 'An official word.');
  perform set_config('kayfabb.staff_writer', '', true);
  -- A visit names the post: the Mod Bot has been to it. (A visit is the staff character's Act on a post of a player's.)
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
    values (bot, 'visit', t, seen, jsonb_build_object('ends_at', now() + interval '3 hours', 'charges', jsonb_build_array(jsonb_build_object('rule_number', null, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', seen::text, 'rule', 'the premise')), 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.')) returning id into visit;
  perform set_config('kayfabb.staff_writer', '', true);

  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, botpost, '{}', ''));
  if got is distinct from '42501 a post by the staff keeps its name' then raise exception 'a veil on a staff post: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, seen, '{}', ''));
  if got is distinct from '42501 a Mod Bot has been to this post, so its author is on the record' then raise exception 'a veil on a visited post: %', got; end if;
  perform tests.unbecome();
  if exists (select 1 from post_veils v where v.post in (botpost, seen)) or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id in (botpost, seen)) then raise exception 'a refused veil wrote something'; end if;
  -- The same words for every caster: the author casts on their own post just as well.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, clean, '{}', ''));
  if got is not null then raise exception 'a veil on a clean post: %', got; end if;
  perform tests.unbecome();
  veil := (select v.play from post_veils v where v.post = clean);
  if veil is null then raise exception 'the clean post took the veil'; end if;

  -- While the author is hidden no Mod Bot visits the post, however it is charged; a post that is not veiled is visited as before.
  perform tests.become_service();
  got := start_visit(clean, 'vf-bot', jsonb_build_object('rule_number', null, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', clean, 'rule', 'the premise'))::text;
  perform tests.unbecome();
  if got is not null then raise exception 'start_visit answered % for a post whose author is hidden', got; end if;
  if exists (select 1 from acts v where v.kind = 'visit' and v.target_act_id = clean) then raise exception 'a visit opened on a post whose author is hidden'; end if;

  -- It cannot be reported until then, and nothing is spent: the words name when.
  insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
  spent_before := (select count(*) from wallet_events);
  reports_before := (select count(*) from acts r where r.kind = 'report');
  got := pg_temp.as_(ann, format('select open_report(%L, %L, %L)', a, clean, 'It is rude.'));
  if got is distinct from '55000 this post''s author is hidden until ' || refusal_time(now() + interval '3 days') || '; report it after' then raise exception 'a report of a veiled post: %', got; end if;
  if (select count(*) from wallet_events) is distinct from spent_before or (select count(*) from acts r where r.kind = 'report') is distinct from reports_before then raise exception 'a refused report spent or wrote something'; end if;

  -- No card is played on the stand-in.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'vlchar', b, stand, '{}', '', 'character', clean));
  perform tests.unbecome();
  if got is distinct from '22023 no card is played on a stand-in' then raise exception 'a card on the stand-in: %', got; end if;

  -- When the veil is ended, the post is visited and reported as any is.
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  perform tests.become_service();
  got := start_visit(clean, 'vf-bot', jsonb_build_object('rule_number', null, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', clean, 'rule', 'the premise'))::text;
  perform tests.unbecome();
  if got is null then raise exception 'a visit after the veil ended returned nothing'; end if;
end $$;

-- ---- 5. A face-down veil lands on the post that quotes it, and veils that post's author ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vb-ann'); bob uuid := tests.account('vb-bob'); cy uuid := tests.account('vb-cy');
  a uuid := tests.character(ann, 'Vb Ann'); b uuid := tests.character(bob, 'Vb Bob'); c uuid := tests.character(cy, 'Vb Cy');
  t uuid := tests.thread('Vb backs');
  stand uuid := pg_temp.stand();
  held uuid := tests.post(a, t, 'A back lies here.'); held2 uuid := tests.post(a, t, 'Another back lies here.');
  back uuid; quote jsonb; q uuid; bot uuid; got text; landed uuid; made jsonb; botq uuid;
  held3 uuid; visq uuid; fd face_down%rowtype; why text; held4 uuid; playq uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'vlauthor', 'vlauthor', 'vlauthor', 'vlauthor', 'vlchar');
  perform tests.become_service();
  back := (set_card(ann, 'vlauthor', a, held, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  if pg_temp.veils_in(t) <> 0 then raise exception 'a card set face down veiled a post before it landed'; end if;
  -- Bob quotes the post: the card lands on Bob's post, and Bob's post is veiled, not Ann's.
  perform tests.become(bob);
  made := post(t, b, 'Quoting the back.', held);
  perform tests.unbecome();
  q := (made ->> 'id')::uuid;
  select v.play into landed from post_veils v where v.post = q;
  if landed is null then raise exception 'a face-down veil did not land on the quoting post: %', made; end if;
  if (select (v.veil, v.author, v.caster_account) from post_veils v where v.play = landed)::text is distinct from format('(author,%s,%s)', b, ann) then raise exception 'the landed veil is wrong: %', (select to_jsonb(v) from post_veils v where v.play = landed); end if;
  if (select k.payload ->> 'ends' from acts k where k.id = landed) is null or (select (k.payload ->> 'ends')::timestamptz from acts k where k.id = landed) is distinct from (select v.ends_at from post_veils v where v.play = landed) then raise exception 'the landed play and its veil disagree on the end'; end if;
  if (select x.character from acts_public x where x.id = q) is distinct from stand then raise exception 'the quoting post shows its author'; end if;
  if (select x.character from acts_public x where x.id = held) is distinct from a then raise exception 'the post that held the back is veiled'; end if;
  if (select x.character from acts_public x where x.id = landed) is distinct from a then raise exception 'the setter''s own landed card shows the stand-in'; end if;
  if pg_temp.veils_in(t) <> 1 then raise exception 'the spring wrote % veil rows', pg_temp.veils_in(t); end if;

  -- A staff post that quotes it does not carry the card: the back stays set, and the quote is written as any is.
  back := null;
  perform tests.become_service();
  back := (set_card(ann, 'vlauthor', a, held2, '{}', 0) ->> 'id')::uuid;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Vb Bot', 'vb-bot', 'persona', now()) returning characters.id into bot;
  made := write_staff_act('vb-bot', 'post', t, held2, '{"body": "A pool reply."}');
  perform tests.unbecome();
  botq := (made ->> 'id')::uuid;
  if botq is null or exists (select 1 from post_veils v where v.post = botq) or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text) then raise exception 'a staff post took a veil: %', made; end if;
  if not exists (select 1 from face_down f where f.play = back) or (select x.character from acts_public x where x.id = botq) is distinct from bot then raise exception 'the back that could not land was spent or the staff post was veiled'; end if;
  -- The same words, read directly: land_refusal answers for a staff post and a visited one, null for a post that is neither, and the same reads for any card.
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), botq, '{}') is distinct from 'a post by the staff keeps its name' then raise exception 'land_refusal for a staff post'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlmove'), botq, '{}') is not null then raise exception 'land_refusal refuses a plain card on a staff post'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), held, '{}') is not null then raise exception 'land_refusal refuses a post that is clean'; end if;

  -- A post a Mod Bot visit names does not take a veil either, on the spring path: the back is set on `held3`, the post that quotes it has been visited, and spring_facts says so (land_why) and the spring does not
  -- land: nothing is written for it, and the back stays set.
  held3 := tests.post(a, t, 'A third back lies here.');
  visq := tests.post(b, t, 'A quote a Mod Bot has been to.');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
    values (bot, 'visit', t, visq, jsonb_build_object('ends_at', now() + interval '3 hours', 'charges', jsonb_build_array(jsonb_build_object('rule_number', null, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', visq::text, 'rule', 'the premise')), 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  back := (set_card(ann, 'vlauthor', a, held3, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  select * into fd from face_down f where f.play = back;
  why := (spring_facts(fd, 'quote', visq, null)).land_why;
  made := spring_traps('quote', held3, visq, null, null, null);
  if why is distinct from 'a Mod Bot has been to this post, so its author is on the record' then raise exception 'spring_facts land_why for a visited quote: %', why; end if;
  if made is not null or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text) then raise exception 'a spring landed a veil on a visited post: %', made; end if;
  if exists (select 1 from post_veils v where v.post = visq) or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = visq) then raise exception 'a veil that could not land wrote something'; end if;
  if not exists (select 1 from face_down f where f.play = back) or (select x.character from acts_public x where x.id = visq) is distinct from b then raise exception 'the back that could not land was spent, or the visited post was veiled'; end if;

  -- Nor does a post a card was played from: Ann plays a card on Bob's character from the post that quotes her back, and the back does not land there.
  held4 := tests.post(a, t, 'A fourth back lies here.');
  playq := tests.post(b, t, 'A quote a card was played from.');
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'vlchar', a, b, '{}', '', 'character', playq));
  back := (set_card(ann, 'vlauthor', a, held4, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  if got is not null then raise exception 'a card on a character from its post: %', got; end if;
  select * into fd from face_down f where f.play = back;
  why := (spring_facts(fd, 'quote', playq, null)).land_why;
  made := spring_traps('quote', held4, playq, null, null, null);
  if why is distinct from 'a card played from this post names its author, so the author is on the record' then raise exception 'spring_facts land_why for a quote a card was played from: %', why; end if;
  if made is not null or exists (select 1 from post_veils v where v.post = playq) or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text) then raise exception 'a spring landed a veil on a post a card was played from: %', made; end if;
end $$;

-- ---- 6. acts.character is no longer readable; the readers that needed it answer from the projection ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vc-ann'); bob uuid := tests.account('vc-bob');
  a uuid := tests.character(ann, 'Vc Ann'); b uuid := tests.character(bob, 'Vc Bob');
  t uuid := tests.thread('Vc grants');
  stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'Whose words are these?'); q uuid := tests.post(b, t, 'A reply.');
  veil uuid; shown uuid; got text; ended jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlauthor', 'vlmove');
  perform pg_temp.hand(ann, 'vlmove');
  perform tests.become(ann);
  got := pg_temp.coded('select character from acts limit 1');
  if got is null or got not like '42501%' then raise exception 'a signed-in player read acts.character: %', coalesce(got, 'no refusal'); end if;
  got := pg_temp.coded('select a.character from acts a join acts_public p on p.id = a.id limit 1');
  if got is null or got not like '42501%' then raise exception 'a join read acts.character: %', coalesce(got, 'no refusal'); end if;
  got := pg_temp.coded('select * from acts limit 1');
  if got is null or got not like '42501%' then raise exception 'select * read acts.character: %', coalesce(got, 'no refusal'); end if;
  -- The other columns are as readable as ever.
  got := pg_temp.coded('select id, kind, thread, target_act_id, seq, created_at, payload from acts limit 1');
  if got is not null then raise exception 'a column other than character was refused: %', got; end if;
  perform tests.unbecome();

  -- The caster's log of an ended play still lists the caster's own, and names the post's author as the read shows it.
  perform tests.become_service();
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  shown := (play_card(ann, 'vlmove', a, q, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, veil, '{"why": "reversed", "by": "admin"}');
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, shown, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
  perform tests.become(bob);
  select jsonb_agg(to_jsonb(e)) into ended from my_cards_ended e where e.side = 'cast';
  perform tests.unbecome();
  if ended is null or jsonb_array_length(ended) is distinct from 1 or (ended -> 0 ->> 'play')::uuid is distinct from veil or (ended -> 0 ->> 'character')::uuid is distinct from b then raise exception 'my_cards_ended for the caster: %', ended; end if;
  -- After the end the post's author is named again; while a veil is up the name is the stand-in's (a live veil, a second post).
  if ended -> 0 ->> 'post_author_name' is distinct from 'Vc Ann' then raise exception 'the ended play names %, after the end', ended -> 0 ->> 'post_author_name'; end if;
  perform tests.become(ann);
  select jsonb_agg(to_jsonb(e)) into ended from my_cards_ended e where e.side = 'onMine';
  perform tests.unbecome();
  if ended is null or jsonb_array_length(ended) is distinct from 1 or (ended -> 0 ->> 'character')::uuid is distinct from a then raise exception 'my_cards_ended on the author''s posts: %', ended; end if;
end $$;

-- ---- 7. The author's own screens ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vm-ann'); bob uuid := tests.account('vm-bob'); ray uuid := tests.account('vm-ray');
  a uuid := tests.character(ann, 'Vm Ann'); a2 uuid := tests.character(ann, 'Vm Ann Two'); b uuid := tests.character(bob, 'Vm Bob'); r uuid := tests.character(ray, 'Vm Ray');
  t uuid := tests.thread('Vm screens');
  stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'Whose words are these?'); q uuid := tests.post(b, t, 'Another post.');
  veil uuid; page jsonb; rows jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlauthor');
  perform tests.become_service();
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  -- The author's row is the author's alone: the player who owns the mask, whichever of their masks wrote it; nobody else's, the caster's included.
  perform tests.become(ann);
  select jsonb_agg(to_jsonb(v)) into rows from my_veiled_posts v;
  if rows is null or jsonb_array_length(rows) is distinct from 1 or (rows -> 0 ->> 'post')::uuid is distinct from p or (rows -> 0 ->> 'character')::uuid is distinct from a
     or (rows -> 0 ->> 'play')::uuid is distinct from veil or (rows -> 0 ->> 'ends_at')::timestamptz is distinct from now() + interval '3 days' then
    raise exception 'my_veiled_posts for the author: %', rows;
  end if;
  page := thread_page(t, 1, null, null, null);
  if page -> 'veiled' is null or jsonb_array_length(page -> 'veiled') is distinct from 1 or (page -> 'veiled' -> 0 ->> 'post')::uuid is distinct from p or (page -> 'veiled' -> 0 ->> 'character')::uuid is distinct from a then
    raise exception 'thread_page carries the author''s veiled post: %', page -> 'veiled';
  end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from my_veiled_posts) or jsonb_array_length(thread_page(t, 1, null, null, null) -> 'veiled') is distinct from 0 then raise exception 'the caster read the author''s veiled post'; end if;
  perform tests.unbecome();
  perform tests.become(ray);
  if exists (select 1 from my_veiled_posts) or jsonb_array_length(thread_page(t, 1, null, null, null) -> 'veiled') is distinct from 0 then raise exception 'a third player read the author''s veiled post'; end if;
  -- The page's own people never name the author, whoever reads it.
  if (thread_page(t, 1, null, null, null))::text like '%' || a::text || '%' or (thread_page(t, 1, null, null, null))::text like '%Vm Ann%' then raise exception 'the page names the author to a third player'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  begin perform 1 from my_veiled_posts; raise exception 'a visitor read my_veiled_posts'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- ---- 8. Bounded reads: a live veil in the table does not take an index from a read ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vp-ann'); bob uuid := tests.account('vp-bob');
  a uuid := tests.character(ann, 'Vp Ann'); b uuid := tests.character(bob, 'Vp Bob');
  t uuid := tests.thread('Vp plans');
  stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'Whose words are these?');
  veil uuid; plan text; q text; touched bigint;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlauthor');
  insert into acts (character, kind, thread, payload)
    select a, 'post', t, jsonb_build_object('body', 'Filler ' || n) from generate_series(1, 3000) n;
  perform tests.become_service();
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  analyze acts;
  analyze post_veils;
  set local enable_seqscan = off;
  -- By character, by thread and seq, by id: each is served by an index of acts, and the veils are found by their own.
  foreach q in array array[
    format('select * from acts_public where character = %L order by created_at desc limit 5', a),
    format('select * from acts_public where thread = %L and seq between 1 and 20 and kind not in (''edit'', ''card'')', t),
    format('select * from acts_public where id = %L', p),
    format('select * from acts_public where target_act_id = %L and kind in (''card'', ''set'', ''spring'')', p),
    format('select * from acts_public where target_act_id = %L and kind = ''edit''', p)] loop
    plan := pg_temp.plan_of(q);
    if plan ~ 'Seq Scan on acts\y' then raise exception 'a read of acts_public scans acts: % %', q, plan; end if;
    if plan !~ 'post_veils' then raise exception 'a read of acts_public does not probe the veils: % %', q, plan; end if;
  end loop;
  reset enable_seqscan;
  -- And by what they touch, which a plan's shape does not say: with 3,000 posts by the author and a live veil, a profile's newest five, the stand-in's own newest five, a join that asks for a page's twenty Acts by
  -- their ids and a page by thread and seq are each a few probes and never the author's or the thread's rows. (A union that is read whole when it is ordered or joined passes the plans above and fails here.)
  touched := pg_temp.buffers_of(format('select * from acts_public where character = %L and kind in (''post'', ''spin'', ''card'') order by created_at desc limit 5', a));
  raise notice 'a profile''s newest five touch % buffers', touched;
  if touched > 120 then raise exception 'a profile''s newest five touch % buffers with 3,000 posts by the author', touched; end if;
  touched := pg_temp.buffers_of(format('select * from acts_public where character = %L and kind in (''post'', ''spin'', ''card'') order by created_at desc limit 5', stand));
  raise notice 'the stand-in''s newest five touch % buffers', touched;
  if touched > 120 then raise exception 'the stand-in''s newest five touch % buffers', touched; end if;
  touched := pg_temp.buffers_of(format('select to_jsonb(x) from (select id from acts where thread = %L and seq between 100 and 119) r join acts_public x on x.id = r.id', t));
  raise notice 'twenty Acts joined by id touch % buffers', touched;
  if touched > 800 then raise exception 'twenty Acts joined to acts_public by id touch % buffers', touched; end if;
  touched := pg_temp.buffers_of(format('select * from acts_public where thread = %L and seq between 100 and 119 and kind not in (''edit'', ''card'')', t));
  raise notice 'a page by thread and seq touches % buffers', touched;
  if touched > 300 then raise exception 'a page by thread and seq touches % buffers', touched; end if;
  set local enable_seqscan = off;
  -- The veils the second branch walks are the live ones, by their index, never a scan of acts.
  plan := pg_temp.plan_of('select * from acts_public where false or id = ''00000000-0000-0000-0000-000000000000''');
  if plan ~ 'Seq Scan on acts\y' then raise exception 'a read by an absent id scans acts: %', plan; end if;
  -- The stand-in is found by an index, not by reading every character.
  plan := pg_temp.plan_of('select c.id from characters c where c.staff_kind = ''anonymous''');
  if plan ~ 'Seq Scan on characters\y' then raise exception 'finding the stand-in scans characters: %', plan; end if;
  -- A character's count is read by the key of its stored row and adjusted from the live veils (a few rows, by their own index): it stays on that key with a veil in the table, and touches a handful of buffers.
  plan := pg_temp.plan_of(format('select character, posts, spins, cards from character_post_counts where character = %L', a));
  if plan !~ 'character_post_counts_pkey' or plan ~ 'Seq Scan on character_post_counts' then raise exception 'a count read does not stay on its key: %', plan; end if;
  if plan !~ 'post_veils' then raise exception 'a count read does not adjust from the live veils: %', plan; end if;
  reset enable_seqscan;
  touched := pg_temp.buffers_of(format('select character, posts, spins, cards from character_post_counts where character = %L', a));
  raise notice 'a count read touches % buffers', touched;
  if touched > 60 then raise exception 'a count read touches % buffers', touched; end if;
  touched := pg_temp.buffers_of(format('select character, posts from character_post_counts where character in (%L, %L)', a, stand));
  raise notice 'two counts read touch % buffers', touched;
  /* Two counts are two reads of the stored rows' heap and of the live veils, plus the one walk of the veils both share. This file's own writes leave many versions of a counted row in the heap (nothing vacuums inside a
     test's transaction), so the read walks them, and the planner's choice between an index and a bitmap scan of them moves a few buffers with the rows around it: 88 on the branch before 0195 to 0316 were merged
     in, 96 after, a read that stays on the key and on the veils' index either way (the plan checks above). The bound is the shape (a few dozen buffers a count, never a scan of the table), not the margin. */
  if touched > 130 then raise exception 'two counts read touch % buffers', touched; end if;
end $$;

-- ---- 9. A card played from a post names its author: no veil on that post, and none played from a veiled post ----
-- (After section 8, whose buffer counts hold the veils the sections before it left up in this file's one transaction.)
-- A card at character reach is stored with target_act_id = the post it is played from, and its payload (`character`, `targetName`) and its play_reach row name the post's author: a public Act that points at the post and
-- names its author, made by anyone (the author's own too: the projection changes its `character` and not its payload). So a veil is refused on such a post, in the words the visit's refusal uses, and the other way round
-- while a veil is up: a card at character reach from the veiled post targets the stand-in, which no card is played on.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vg-ann'); bob uuid := tests.account('vg-bob'); cy uuid := tests.account('vg-cy');
  a uuid := tests.character(ann, 'Vg Ann'); b uuid := tests.character(bob, 'Vg Bob'); c uuid := tests.character(cy, 'Vg Cy');
  t uuid := tests.thread('Vg named');
  stand uuid := pg_temp.stand();
  named uuid := tests.post(a, t, 'A card is played from here.'); own uuid := tests.post(a, t, 'My own card is played from here.'); clean uuid := tests.post(a, t, 'Nothing is played from here.');
  got text; words text := '42501 a card played from this post names its author, so the author is on the record'; veil uuid; plays integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlchar'); perform pg_temp.hand(ann, 'vlself'); perform pg_temp.hand(cy, 'vlauthor', 'vlauthor', 'vlauthor', 'vlchar');
  -- Bob plays a card on Ann's character from her post; Ann uses her own on her character from hers.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'vlchar', b, a, '{}', '', 'character', named));
  if got is not null then raise exception 'a card on a character from its post: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'vlself', a, a, '{}', '', 'character', own));
  if got is not null then raise exception 'a use card on its own character from its post: %', got; end if;
  perform tests.unbecome();
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = named and k.payload ->> 'reach' = 'character' and k.payload ->> 'character' = a::text) is distinct from 1 then
    raise exception 'the character card is not stored as a play from the post naming its character'; end if;

  -- Neither post takes a veil, from any caster, and nothing is written for it; a post nothing was played from does, and the same words come from land_refusal.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, named, '{}', ''));
  if got is distinct from words then raise exception 'a veil on a post a card was played from: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, own, '{}', ''));
  if got is distinct from words then raise exception 'a veil on a post its author used a card from: %', got; end if;
  perform tests.unbecome();
  if exists (select 1 from post_veils v where v.post in (named, own)) or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id in (named, own) and k.payload ->> 'card' = 'vlauthor') then
    raise exception 'a refused veil wrote something'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), named, '{}') is distinct from substr(words, 7) or land_refusal((select k from card_kinds k where k.key = 'vlmove'), named, '{}') is not null then
    raise exception 'land_refusal for a post a card was played from'; end if;
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, clean, '{}', ''));
  perform tests.unbecome();
  if got is not null then raise exception 'a veil on a post no card was played from: %', got; end if;
  veil := (select v.play from post_veils v where v.post = clean);
  if veil is null then raise exception 'the clean post took no veil'; end if;

  -- While it is up, a card at character reach from the veiled post names the stand-in or the author, and is refused either way, in words every caster meets; nothing is written.
  plays := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = clean);
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', cy, 'vlchar', c, stand, '{}', '', 'character', clean));
  if got is distinct from '22023 no card is played on a stand-in' then raise exception 'a character card from a veiled post, on the stand-in: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', cy, 'vlchar', c, a, '{}', '', 'character', clean));
  if got is distinct from '22023 a card on a character is played from one of its posts' then raise exception 'a character card from a veiled post, on its author: %', got; end if;
  perform tests.unbecome();
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = clean) is distinct from plays then raise exception 'a refused card from a veiled post wrote something'; end if;
end $$;

-- ---- 10. The stand-in is no persona: the lists that are of staff leave it out, and the model reads it as the plain character it is shown as ----
-- The pool's and the digest's windows are read over a day a long time ago, where this file's rows are the only ones (a database that has run the suite holds committed rows from now, and the digest caps what it lists).
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vs-ann'); bob uuid := tests.account('vs-bob'); ray uuid := tests.account('vs-ray');
  a uuid := tests.character(ann, 'Vs Ann'); b uuid := tests.character(bob, 'Vs Bob'); r uuid := tests.character(ray, 'Vs Ray');
  t uuid := tests.thread('Vs staff lists');
  stand uuid := pg_temp.stand();
  long_ago timestamptz := now() - interval '400 days';
  recent uuid := tests.post(a, t, 'Whose words are these?');
  old uuid := tests.post(a, t, 'Whose words are these, Anonymous?', long_ago);
  q uuid; box jsonb; sig jsonb; dig jsonb; entry jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'vlauthor', 'vlauthor');
  insert into settings (key, value) values ('digestThreads', '3'), ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "common", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('digestExcerpts', '20'), ('digestExcerptChars', '280') on conflict (key) do update set value = excluded.value;
  perform tests.become_service();
  perform play_card(bob, 'vlauthor', b, recent, '{}', 0, '');
  perform play_card(bob, 'vlauthor', b, old, '{}', 0, '');
  perform tests.unbecome();
  q := tests.act(b, 'post', t, jsonb_build_object('body', 'Quoting the hidden post, Anonymous.'), old, long_ago + interval '1 minute');
  -- The presence box: a staff character is listed for presenceWindow after its own post there; the stand-in is not one.
  perform tests.become(ray);
  box := presence_box('thread', t);
  perform tests.unbecome();
  if box::text like '%Anonymous%' or jsonb_array_length(box -> 'names') <> 0 then raise exception 'the staff presence box lists the stand-in: %', box; end if;
  -- The pool's signals: nobody is asked to answer the stand-in, whether it is quoted or named, and it has no tally among the personas'. (pool_named is among them: the quote above says "Anonymous", which would name a persona of that name.)
  perform tests.become_service();
  sig := pool_signals(long_ago - interval '1 hour', long_ago + interval '1 hour');
  perform tests.unbecome();
  if sig::text like '%anonymous%' then raise exception 'the pool''s signals name the stand-in as staff: %', sig; end if;
  -- The digest: the stand-in is a character the model reads, and it is not staff.
  perform tests.become_service();
  dig := system_digest(long_ago - interval '1 hour', long_ago + interval '1 hour');
  perform tests.unbecome();
  select e into entry from jsonb_array_elements(dig -> 'characters') e where e ->> 'id' = stand::text;
  if entry is null or entry -> 'staff' is distinct from 'false'::jsonb then raise exception 'the digest reads the stand-in as staff, or not at all: %', entry; end if;
  if exists (select 1 from jsonb_array_elements(dig -> 'characters') e where e ->> 'id' = a::text) then raise exception 'the digest names the author'; end if;
end $$;

-- ---- 11. The counts: while a veil is up, a veiled post is counted for the stand-in and not for its author, in every read a player can make; it goes back by itself ----
-- character_post_counts is publicly readable and returned by profile_page (`counts`), record_page and thread_page (`posts`): a count that still held a veiled post would prove, against a profile that lists one post fewer, that its
-- author has a hidden post. The projection is one: the same for every reader, computed in the read from the live veils (no job runs when a veil ends, so nothing stored moves), and the unadjusted count is read by no API role.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vq-ann'); cy uuid := tests.account('vq-cy'); ray uuid := tests.account('vq-ray'); adm uuid := tests.account('vq-admin');
  a uuid := tests.character(ann, 'Vq Ann'); c uuid := tests.character(cy, 'Vq Cy'); r uuid := tests.character(ray, 'Vq Ray');
  t uuid := tests.thread('Vq counts'); t2 uuid := tests.thread('Vq spun');
  stand uuid := pg_temp.stand();
  p1 uuid := tests.post(a, t, 'A post that stays.'); p2 uuid := tests.post(a, t, 'A post that is veiled.'); p3 uuid := tests.post(a, t, 'A post whose veil is over.');
  veil uuid; spun uuid; used uuid; shown jsonb; rec jsonb; page jsonb; past uuid; got text; s0 jsonb;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(cy, 'vlauthor'); perform pg_temp.hand(ann, 'vluse');
  -- The author has used a card of hers on the post and spun a thread from it, each of them an Act of hers on the post, which the veil shows under the stand-in.
  perform tests.become_service();
  used := (play_card(ann, 'vluse', a, p2, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  spun := tests.act(a, 'spin', t2, jsonb_build_object('title', 'Spun', 'body', 'From the veiled post.'), p2);
  -- A veil that is over (its row says so) holds nothing back.
  past := tests.act(c, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 day'), p3, now() - interval '4 days');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (past, p3, 'author', a, cy, now() - interval '1 day');

  -- (The stand-in already stands for the veils of this file's earlier sections, which are still up: its count is read as it is, and the change is what the assertions below hold.)
  perform tests.become(ray);
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  s0 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_post_counts where character = stand) n);
  perform tests.unbecome();
  if shown is distinct from '{"posts": 3, "spins": 1, "cards": 1}'::jsonb then raise exception 'the count before the veil: %', shown; end if;

  perform tests.become_service();
  veil := (play_card(cy, 'vlauthor', c, p2, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();

  -- Every read of a count, as a third player: the author's loses the veiled post and the Acts of hers on it, the stand-in's holds them.
  perform tests.become(ray);
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  if shown is distinct from '{"posts": 2, "spins": 0, "cards": 0}'::jsonb then raise exception 'the author''s count while the veil is up: %', shown; end if;
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = stand) n);
  if shown is distinct from jsonb_build_object('posts', (s0 ->> 'posts')::integer + 1, 'spins', (s0 ->> 'spins')::integer + 1, 'cards', (s0 ->> 'cards')::integer + 1) then raise exception 'the stand-in''s count while the veil is up: % (was %)', shown, s0; end if;
  if (select count(*) from character_post_counts where character in (a, stand)) is distinct from 2 then raise exception 'a count is read twice or not at all'; end if;
  -- The counts a page returns are the same, and each is the number of rows the page's own lists hold: the author's profile lists the posts it counts.
  rec := record_page(a, 'post', 1);
  if (rec -> 'counts' ->> 'posts')::integer is distinct from 2 or jsonb_array_length(rec -> 'acts') is distinct from 2 then raise exception 'the author''s record: % lists % posts', rec -> 'counts', jsonb_array_length(rec -> 'acts'); end if;
  rec := record_page(stand, 'post', 1);
  if (rec -> 'counts' ->> 'posts')::integer is distinct from (s0 ->> 'posts')::integer + 1 or jsonb_array_length(rec -> 'acts') is distinct from least((s0 ->> 'posts')::integer + 1, 20)
     or not exists (select 1 from jsonb_array_elements(rec -> 'acts') x where x ->> 'id' = p2::text) then
    raise exception 'the stand-in''s record: % lists % posts', rec -> 'counts', jsonb_array_length(rec -> 'acts');
  end if;
  if (profile_page(a) -> 'counts') is distinct from jsonb_build_object('character', a, 'posts', 2, 'spins', 0, 'cards', 0) then raise exception 'the author''s profile counts: %', profile_page(a) -> 'counts'; end if;
  if (profile_page(stand) -> 'counts') is distinct from jsonb_build_object('character', stand, 'posts', (s0 ->> 'posts')::integer + 1, 'spins', (s0 ->> 'spins')::integer + 1, 'cards', (s0 ->> 'cards')::integer + 1) then raise exception 'the stand-in''s profile counts: %', profile_page(stand) -> 'counts'; end if;
  page := thread_page(t, 1, null, null, null);
  if (select (x ->> 'posts')::integer from jsonb_array_elements(page -> 'people') x where x -> 'character' ->> 'id' = a::text) is distinct from 2
     or (select (x ->> 'posts')::integer from jsonb_array_elements(page -> 'people') x where x -> 'character' ->> 'id' = stand::text) is distinct from (s0 ->> 'posts')::integer + 1 then
    raise exception 'the page''s people count the veiled post wrongly: %', page -> 'people';
  end if;
  perform tests.unbecome();

  -- The author's own player reads the same, and the unadjusted count is read by no API role (the base table is not granted, and has no policy that lets a read through).
  perform tests.become(ann);
  if (select posts from character_post_counts where character = a) is distinct from 2 then raise exception 'the author reads her own count differently'; end if;
  perform tests.unbecome();
  got := pg_temp.as_(ray, 'select posts from character_post_counts_base');
  if got is null or got = 'ok' then raise exception 'a signed-in player read the unadjusted counts: %', got; end if;
  if has_table_privilege('authenticated', 'character_post_counts_base', 'select') or has_table_privilege('anon', 'character_post_counts_base', 'select') or has_table_privilege('anon', 'character_post_counts', 'select') then
    raise exception 'an API role can read the unadjusted counts, or a visitor the counts';
  end if;
  -- The writers keep the stored count true: the next post of hers is counted once, under her own name.
  perform tests.post(a, t, 'Another post.');
  perform tests.become(ray);
  if (select posts from character_post_counts where character = a) is distinct from 3 or (select posts from character_post_counts where character = stand) is distinct from (s0 ->> 'posts')::integer + 1 then raise exception 'a new post of the author''s is miscounted while the veil is up'; end if;
  perform tests.unbecome();

  -- An admin's end gives every count back at once, and nothing stored moved.
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  perform tests.become(ray);
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  if shown is distinct from '{"posts": 4, "spins": 1, "cards": 1}'::jsonb then raise exception 'the author''s count after the veil was ended: %', shown; end if;
  if (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_post_counts where character = stand) n) is distinct from s0 then raise exception 'the stand-in keeps a count after the veil was ended'; end if;
  if (profile_page(a) -> 'counts' ->> 'posts')::integer is distinct from 4 then raise exception 'the author''s profile after the end: %', profile_page(a) -> 'counts'; end if;
  perform tests.unbecome();
end $$;

-- ---- 12. The groups read the truth: a veil never moves a character's group ----
-- group_now is The System's own scoring (the ladder's posts rung), not a player's read, so it reads character_post_counts_base: a character whose count sits exactly at a rung's threshold keeps the rung
-- while one of its posts is veiled, though the count a player reads (character_post_counts) is one lower for as long as the veil is up.
select tests.unbecome();
do $$
declare
  zed uuid := tests.account('vq-gzed'); cy uuid := tests.account('vq-gcy');
  z uuid := tests.character(zed, 'Vq GZed'); c uuid := tests.character(cy, 'Vq GCy');
  t uuid := tests.thread('Vq group');
  p1 uuid := tests.post(z, t, 'The first post.'); p2 uuid := tests.post(z, t, 'The second post, veiled.');
  veil uuid; before_group text; shown integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(cy, 'vlauthor');
  -- A ladder of this test's own, above whatever the database holds: a default rung and a posts rung that Zed meets with exactly two posts.
  insert into group_kinds (key, name, color, source, rung, condition) values ('vgLow', 'Vg Low', '#101010', 'ladder', 91, 'default');
  insert into group_kinds (key, name, color, source, rung, condition, at_least) values ('vgHigh', 'Vg High', '#202020', 'ladder', 92, 'posts', 2);
  before_group := group_now(z);
  if before_group is distinct from 'vgHigh' then raise exception 'the character at the threshold is not in the rung before any veil: %', before_group; end if;
  perform tests.become_service();
  veil := (play_card(cy, 'vlauthor', c, p2, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  -- A player's read of the count drops by the veiled post; the System's reading of it does not.
  shown := (select posts from character_post_counts where character = z);
  if shown is distinct from 1 then raise exception 'the count a player reads should hide the veiled post: %', shown; end if;
  if group_now(z) is distinct from 'vgHigh' then raise exception 'a veil moved the group: % while the post is veiled', group_now(z); end if;
end $$;
