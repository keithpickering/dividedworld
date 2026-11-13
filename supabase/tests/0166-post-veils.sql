-- The author's veil (supabase/migrations/0400_post_veils.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 2; engine/rules/cards.ts, CardRules.veil).
-- A cast card with `veil = 'author'` on a post withholds its author from every read while it is up: acts_public answers the one stand-in character for the post and for every Act its own author
-- made on it, to every reader alike, and the author's own screens learn it is theirs only from my_veiled_posts. The cards are this file's own (vl...).
--
--  1. The catalog: card_kinds_problem holds the veil's refusals in the engine's words; a cast with `lasts` on a post writes `ends`.
--  2. A cast lands a post_veils row, ends at its time, and a second is refused while it is up; one lands again once it has ended.
--  3. acts_public shows the stand-in for the post and for its author's Acts on it, and the true character for everything else; the same after the time and after an admin's end, the true one again.
-- 3b. The derived veil covers the author's Acts that are no content of their own (an edit, a set, a card), never a post or a spin of theirs: each Act is read once, and every read agrees on it.
--  4. The refusals (a staff post, a post a Mod Bot has been to), a Mod Bot's visit and a report while it is up, and no card on the stand-in.
--  5. A face-down veil lands on the post that quotes it, and veils that post's author; one that cannot land (a staff post, a visited post, a post a card was played from) stays set.
--  5c. A post a spring names its author on (a public spring Act whose `for` is the quoter) takes no veil, from a cast or a spring.
--  6. acts.character is no longer readable by a signed-in player, and the readers that needed it still answer.
--  7. my_veiled_posts holds the author's own rows and nobody else's; thread_page carries them.
--  8. Bounded reads: with a live veil in the table, reads by character, by thread and seq and by id keep their indexes, and so does a count's.
--  9. A card played from a post (at character reach) names its author: no veil lands on that post, from a cast or a spring, and none is played from a veiled one.
-- 10. The staff lists, the pool's signals and the digest leave the stand-in out of the staff.
-- 11. The counts: character_post_counts counts a veiled post for the stand-in while the veil is up, for every reader, and the author's own count is whole again by itself.
-- 12. The shown group follows the shown count: group_now reads the same projection as the count a player reads, so a character at a rung's threshold drops a rung while one of its posts is veiled and both return at the end.
-- 15. The model is handed the stand-in for a veiled post's author: claim_card_writes names it, and the table of every road a model reads a post's author by says which reads the stand-in and which cannot reach a veiled post.
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

-- ---- 13. Races (first: the committed rows must not meet this file's own locks, as 0107-visits.sql has it): a veil cast, a visit opening and a card played from the post are laid one at a time on the post's row ----
-- A veil is refused on a post a Mod Bot has visited and on a post a card at character reach was played from, and a visit and such a card are refused or nulled on a veiled post: each check reads Acts another session may be
-- writing, so the three take the post's row (the cast `for no key update`, the other two `for share`, which conflicts with it) before they check, and the two orders both end with one of the facts and never both. The rows the
-- racers read are committed (tests.commit), the way 0107-visits.sql does it; the veil cards are committed under keys of their own and removed after. The first two races are real functions: the holder opens a visit (or plays
-- a card from the post) and does not commit, and the cast must wait for it, then be refused in the words of what it found. The last two hold the lock the cast takes, and the visit and the card must wait for it.
create function pg_temp.parked(tag text, conn text) returns text language plpgsql as $$
declare tries integer := 0;
begin
  loop
    -- A transaction reads one snapshot of pg_stat_activity until it is cleared, so a session that has begun to wait since the last look is not seen.
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity a where a.query like '%/* ' || tag || ' */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock') then return 'waiting'; end if;
    if extensions.dblink_is_busy(conn) = 0 then return 'finished'; end if;
    tries := tries + 1;
    if tries > 400 then return 'neither'; end if;
    perform pg_sleep(0.025);
  end loop;
end $$;

select tests.unbecome();
do $$
declare
  u uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  board uuid; charge jsonb; seen text; got text; res jsonb; vis uuid; named uuid;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'vv-author@test.invalid'), (%2$L, 'vv-caster@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Vv Author', now(), now()), (%4$L, %2$L, 'Vv Caster', now(), now()), (%11$L, %1$L, 'Vv Author Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now()), (%11$L, 'alpha', now());
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%5$L, 'Vv Mod', 'vv-mod', 'persona', now());
    insert into threads (id, board, title) select %6$L, b.id, 'Vv race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%7$L, %3$L, 'post', %6$L, '{"body": "A post to visit."}'), (%8$L, %3$L, 'post', %6$L, '{"body": "A post to play from."}'),
      (%9$L, %3$L, 'post', %6$L, '{"body": "A post a visit waits on."}'), (%10$L, %11$L, 'post', %6$L, '{"body": "A post a card waits on."}');
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values
      ('vvveil', 'Vv Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1),
      ('vvname', 'Vv Name', 'salty', 'uncommon', 'cast', '{character}', interval '1 day', null, 1);
  $sql$, u, u2, a, c, m, t, p1, p2, p3, p4, a2));
  board := (select th.board from threads th where th.id = t);
  charge := jsonb_build_object('rule_number', null, 'board', board, 'band', 'minor', 'cause', 'rule', 'about_act', p1, 'rule', 'the premise');
  perform extensions.dblink_connect('vv_h', url);
  perform extensions.dblink_connect('vv_v', url);

  -- (a) A Mod Bot's visit opens on the post and does not commit; a veil cast on it waits for the visit, and is refused for it when it commits (and never lands).
  perform extensions.dblink_exec('vv_h', 'begin');
  perform * from extensions.dblink('vv_h', format('select start_visit(%L, ''vv-mod'', %L::jsonb)', p1, charge)) as x(r jsonb);
  perform extensions.dblink_send_query('vv_v', format('select /* vv_a */ place_cast(%L, ''vvveil'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p1, u2));
  seen := pg_temp.parked('vv_a', 'vv_v');
  perform extensions.dblink_exec('vv_h', 'commit');
  begin perform * from extensions.dblink_get_result('vv_v') as x(r jsonb); got := null; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform * from extensions.dblink_get_result('vv_v') as x(r jsonb);   -- the end of the answer: the session is free for the next command
  if seen is distinct from 'waiting' then raise exception 'a veil cast did not wait for a visit opening on the post (it %)', seen; end if;
  if got is distinct from '42501 a Mod Bot has been to this post, so its author is on the record' then raise exception 'the veil cast after the visit committed: %', got; end if;
  if exists (select 1 from post_veils v where v.post = p1) then raise exception 'a veil landed on a post a visit had opened on'; end if;

  -- (b) A card at character reach is played from the post and does not commit; a veil cast on that post waits, and is refused for the card.
  perform extensions.dblink_exec('vv_h', 'begin');
  perform * from extensions.dblink('vv_h', format('select place_cast(%L, ''vvname'', %L, ''{}'', '''', ''character'', %L, %L, 0)', c, a, p2, u2)) as x(r jsonb);
  perform extensions.dblink_send_query('vv_v', format('select /* vv_b */ place_cast(%L, ''vvveil'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p2, u2));
  seen := pg_temp.parked('vv_b', 'vv_v');
  perform extensions.dblink_exec('vv_h', 'commit');
  begin perform * from extensions.dblink_get_result('vv_v') as x(r jsonb); got := null; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform * from extensions.dblink_get_result('vv_v') as x(r jsonb);   -- the end of the answer: the session is free for the next command
  if seen is distinct from 'waiting' then raise exception 'a veil cast did not wait for a card being played from the post (it %)', seen; end if;
  if got is distinct from '42501 a card played from this post names its author, so the author is on the record' then raise exception 'the veil cast after the card committed: %', got; end if;
  if exists (select 1 from post_veils v where v.post = p2) then raise exception 'a veil landed on a post a card was played from'; end if;

  -- (c) The cast's own lock is held (the post's row, no key update); a visit opening on the post waits for it, and finds the post as the cast left it.
  perform extensions.dblink_exec('vv_h', 'begin');
  perform * from extensions.dblink('vv_h', format('select id from acts where id = %L for no key update', p3)) as x(r uuid);
  perform extensions.dblink_send_query('vv_v', format('select /* vv_c */ start_visit(%L, ''vv-mod'', %L::jsonb)', p3, jsonb_set(charge, '{about_act}', to_jsonb(p3::text))));
  seen := pg_temp.parked('vv_c', 'vv_v');
  perform extensions.dblink_exec('vv_h', 'commit');
  select r into res from extensions.dblink_get_result('vv_v') as x(r jsonb);
  perform * from extensions.dblink_get_result('vv_v') as x(r jsonb);
  if seen is distinct from 'waiting' then raise exception 'a visit opening did not wait for a cast holding the post (it %)', seen; end if;
  if res ->> 'visit' is null then raise exception 'the visit that waited did not open once the post was free: %', res; end if;

  -- (d) The same for a card at character reach played from the post.
  perform extensions.dblink_exec('vv_h', 'begin');
  perform * from extensions.dblink('vv_h', format('select id from acts where id = %L for no key update', p4)) as x(r uuid);
  perform extensions.dblink_send_query('vv_v', format('select /* vv_d */ place_cast(%L, ''vvname'', %L, ''{}'', '''', ''character'', %L, %L, 0)', c, a2, p4, u2));
  seen := pg_temp.parked('vv_d', 'vv_v');
  perform extensions.dblink_exec('vv_h', 'commit');
  select (r ->> 'id')::uuid into named from extensions.dblink_get_result('vv_v') as x(r jsonb);
  perform * from extensions.dblink_get_result('vv_v') as x(r jsonb);
  if seen is distinct from 'waiting' then raise exception 'a card played from the post did not wait for a cast holding it (it %)', seen; end if;
  if named is null then raise exception 'the card that waited was not played once the post was free'; end if;

  perform extensions.dblink_disconnect('vv_h');
  perform extensions.dblink_disconnect('vv_v');
  perform tests.commit($sql$ delete from card_kinds where key in ('vvveil', 'vvname'); delete from settings where key = 'warnBar' $sql$);
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
  -- A JSON null veil seeds as a card with none (the same reading as card_kinds_problem's).
  perform seed_instance(seed || jsonb_build_object('cards', jsonb_build_array(
    jsonb_build_object('key', 'seeded-null', 'name', 'Seeded Null', 'alignment', 'salty', 'rarity', 'common', 'play', 'cast', 'reaches', jsonb_build_array('post'), 'veil', null))));
  if (select k.veil from card_kinds k where k.key = 'seeded-null') is not null then raise exception 'a JSON null veil seeded a veil'; end if;
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
  -- A JSON null veil is no veil (seed_instance reads it through nullif as one): the problem list agrees, whatever else the card is (a use card here, which a veil would refuse, and a cast card with no `lasts`, which a veil would refuse too).
  if card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "ok-null", "veil": null}'::jsonb)) is not null then raise exception 'a JSON null veil was refused as a veil: %', card_kinds_problem(jsonb_build_array((base - 'lasts') || '{"key": "ok-null", "veil": null}'::jsonb)); end if;
  if card_kinds_problem(jsonb_build_array(base || '{"key": "ok-null2", "veil": null, "play": "use", "gimmick": {"kind": "noQuote"}}'::jsonb)) is not null then raise exception 'a JSON null veil on a use card was refused as a veil: %', card_kinds_problem(jsonb_build_array(base || '{"key": "ok-null2", "veil": null, "play": "use", "gimmick": {"kind": "noQuote"}}'::jsonb)); end if;
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

  -- acts_public is acts_base (main's acts_public, 0340_conduct: concealment and all, the true character) with the stand-in in place of the true character on the veiled rows and nothing else: every other column, the concealment's five included, is the same on every row.
  if exists (select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_base where thread = t
            except select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_public where thread = t)
     or exists (select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_public where thread = t
            except select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_base where thread = t) then
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

-- ---- 3b. The derived veil covers the author's Acts that are no content of their own, never a post or a spin of theirs: each Act is read once, and every read agrees on it ----
-- A veil on P hides P and what its author did to P (an edit, a set, a take-back, a use card, its spring). The author's own quote of P (Q) and a spin from P are posts and threads of their own: they stay the author's, in
-- acts_public, in a thread's last poster, in search and in the counts alike (who quoted what is the game's clue, and anyone may quote P), until a veil is cast on Q itself. Each Act is then read once, whatever mix of veils.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vo-ann'); bob uuid := tests.account('vo-bob'); ray uuid := tests.account('vo-ray'); adm uuid := tests.account('vo-admin');
  a uuid := tests.character(ann, 'Vo Ann'); b uuid := tests.character(bob, 'Vo Bob'); r uuid := tests.character(ray, 'Vo Ray');
  t uuid := tests.thread('Vo quotes'); t2 uuid := tests.thread('Vo spun');
  stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'Whose words are these? zebrafish');
  q uuid; spun uuid; edit uuid; qedit uuid; used uuid; qveil uuid; pveil uuid; old uuid; extra uuid; veil2 uuid;
  s0 jsonb; shown jsonb; rec jsonb; got text;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(ann, 'vluse'); perform pg_temp.hand(bob, 'vlauthor', 'vlauthor');
  q := tests.act(a, 'post', t, jsonb_build_object('body', 'Quoting my own words, zebrafish.'), p);
  spun := tests.act(a, 'spin', t2, jsonb_build_object('title', 'Spun', 'body', 'From my own post.'), p);
  edit := tests.act(a, 'edit', t, jsonb_build_object('body', 'Whose words are these, reworded? zebrafish'), p);
  qedit := tests.act(a, 'edit', t, jsonb_build_object('body', 'Quoting my own words, reworded. zebrafish'), q);
  perform tests.become_service();
  used := (play_card(ann, 'vluse', a, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  s0 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_post_counts where character = stand) n);

  -- Only P is veiled. Its edit and use card are the stand-in's; the author's own quote Q, its edit and the spin are the author's, in every read.
  perform tests.become_service();
  pveil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(ray);
  if (select count(*) from acts_public x where x.id in (p, edit, used) and x.character = stand) is distinct from 3 then raise exception 'P, its edit and its card are not all the stand-in''s'; end if;
  if (select x.character from acts_public x where x.id = q) is distinct from a or (select x.character from acts_public x where x.id = spun) is distinct from a
     or (select x.character from acts_public x where x.id = qedit) is distinct from a then
    raise exception 'the author''s own quote, its edit or the spin shows the stand-in in acts_public while only P is veiled: %', (select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'character', x.character)) from acts_public x where x.id in (q, spun, qedit));
  end if;
  if (select o.last_character from thread_open o where o.id = t) is distinct from a or (select o.first_character from thread_open o where o.id = t) is distinct from stand then
    raise exception 'the thread''s first and last poster disagree with acts_public: %', (select to_jsonb(o) from thread_open o where o.id = t);
  end if;
  if (select m.character from search_matches('zebrafish', null, null, null, null, false, true, null, null, 20) m where m.act = q) is distinct from a
     or (select m.character from search_matches('zebrafish', null, null, null, null, false, true, null, null, 20) m where m.act = p) is distinct from stand then
    raise exception 'search shows the quote or the veiled post under the wrong character';
  end if;
  -- The counts move exactly what the projection hides: P as a post, the author's card on it as a card, nothing else (not Q, not the spin), and each profile list holds what its count says.
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  if shown is distinct from '{"posts": 1, "spins": 1, "cards": 0}'::jsonb then raise exception 'the author''s count with only P veiled: %', shown; end if;
  if (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_post_counts where character = stand) n)
     is distinct from jsonb_build_object('posts', (s0 ->> 'posts')::integer + 1, 'spins', (s0 ->> 'spins')::integer, 'cards', (s0 ->> 'cards')::integer + 1) then
    raise exception 'the stand-in''s count with only P veiled: % (was %)', (select to_jsonb(n) from character_post_counts n where n.character = stand), s0;
  end if;
  foreach got in array array['post', 'spin', 'card'] loop
    rec := record_page(a, got, 1);
    if jsonb_array_length(rec -> 'acts') is distinct from (rec -> 'counts' ->> (got || 's'))::integer then raise exception 'the author''s % list holds % rows and its count says %', got, jsonb_array_length(rec -> 'acts'), rec -> 'counts'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(profile_page(a) -> 'acts') x where x ->> 'id' in (q::text, spun::text)) is distinct from 2 or (profile_page(a) -> 'counts' ->> 'posts')::integer is distinct from 1 then
    raise exception 'the author''s profile: % lists the quote and the spin, and counts %', profile_page(a) -> 'acts', profile_page(a) -> 'counts';
  end if;
  perform tests.unbecome();

  -- A second veil on P, one that ended and one more that is live (as two kinds of veil may be): P is read once, in every read.
  old := tests.act(b, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 2, 'ends', now() - interval '1 day'), p, now() - interval '4 days');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (old, p, 'author', a, bob, now() - interval '1 day');
  extra := tests.act(b, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 3, 'ends', now() + interval '1 day'), p);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (extra, p, 'author', a, bob, now() + interval '1 day');
  -- A veil is cast on Q itself, with an edit by its author on it: Q and its edit are the stand-in's, each once, and P's rows stay once.
  veil2 := tests.act(b, 'card', t, jsonb_build_object('card', 'vlauthor', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '3 days'), q);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (veil2, q, 'author', a, bob, now() + interval '3 days');
  perform tests.become(ray);
  if (select count(*) from (select x.id from acts_public x where x.thread = t group by x.id having count(*) > 1) d) > 0 then
    raise exception 'acts_public repeats a row by thread: %', (select jsonb_agg(x.id) from (select x.id from acts_public x where x.thread = t group by x.id having count(*) > 1) x);
  end if;
  foreach got in array array[p::text, q::text, edit::text, qedit::text, used::text] loop
    if (select count(*) from acts_public x where x.id = got::uuid) is distinct from 1 then raise exception 'a read of % by id returns % rows', got, (select count(*) from acts_public x where x.id = got::uuid); end if;
  end loop;
  if (select count(*) from acts_public x where x.id in (p, q, edit, qedit, used) and x.character = stand) is distinct from 5 then raise exception 'with P and Q both veiled the five are not all the stand-in''s'; end if;
  if (select x.character from acts_public x where x.id = spun) is distinct from a then raise exception 'the spin is hidden by a veil on its source'; end if;
  if (select o.last_character from thread_open o where o.id = t) is distinct from stand then raise exception 'the last poster is Q, veiled, and shows %', (select o.last_character from thread_open o where o.id = t); end if;
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  if shown is distinct from '{"posts": 0, "spins": 1, "cards": 0}'::jsonb then raise exception 'the author''s count with P and Q veiled: %', shown; end if;
  rec := record_page(a, 'post', 1);
  if jsonb_array_length(rec -> 'acts') is distinct from 0 or (rec -> 'counts' ->> 'posts')::integer is distinct from 0 then raise exception 'the author''s posts list and count with P and Q veiled: %', rec; end if;
  perform tests.unbecome();
  if (select count(*) from acts_public x where x.target_act_id = p) is distinct from (select count(*) from acts_base x where x.target_act_id = p)
     or (select count(*) from acts_public x where x.target_act_id = q) is distinct from (select count(*) from acts_base x where x.target_act_id = q)
     or (select count(*) from acts_public x where x.thread = t) is distinct from (select count(*) from acts_base x where x.thread = t) then
    raise exception 'acts_public has a different number of rows than acts_base';
  end if;
  -- An admin's end of Q's veil gives Q back to its author and leaves P's.
  perform tests.become(adm); perform reverse_card(veil2); perform tests.unbecome();
  if (select x.character from acts_public x where x.id = q) is distinct from a or (select x.character from acts_public x where x.id = p) is distinct from stand then raise exception 'ending the veil on Q did not give Q back alone'; end if;
  -- Nothing of this section is left up for the sections after it (section 8 counts the buffers a read of the stand-in's Acts touches, and the stand-in's rows are what a live veil adds to it).
  perform tests.become(adm); perform reverse_card(pveil); perform reverse_card(extra); perform tests.unbecome();
  if exists (select 1 from acts_public x where x.id in (p, edit, used) and x.character = stand) then raise exception 'P is still veiled after every veil on it was ended'; end if;
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

-- ---- 5b. A spring that lands a veil names no one: the public rows it writes carry neither the quoter's id nor its name, whatever the back's Who ----
-- spring_traps writes `for` (the quoting character) into the public spring Act when the back's Who is "only these", which any other card shows as the clue the setter chose. For a veil it would name the author of the post the
-- veil has just hidden, so a landed author veil omits it (the quote is read through acts_public, which gives the stand-in).
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vw-ann'); cy uuid := tests.account('vw-cy'); ray uuid := tests.account('vw-ray'); adm uuid := tests.account('vw-admin');
  a uuid := tests.character(ann, 'Vw Ann'); c uuid := tests.character(cy, 'Vw Cy'); r uuid := tests.character(ray, 'Vw Ray');
  t uuid := tests.thread('Vw spring');
  stand uuid := pg_temp.stand();
  held uuid := tests.post(a, t, 'A back lies here.'); held2 uuid := tests.post(a, t, 'Another back lies here.');
  back uuid; back2 uuid; made jsonb; q uuid; spring uuid; laid uuid; seen text; who_sees uuid; ids uuid[]; page text; pf record;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'vlauthor', 'vlmove');
  insert into admins (account) values (adm);
  -- A face-down Whodunnit? whose Who is only these: Cy's character.
  perform tests.become_service();
  back := (set_card(ann, 'vlauthor', a, held, '{}', 0, null, null, null, array[c], false) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cy);
  made := post(t, c, 'Quoting the back.', held);
  perform tests.unbecome();
  q := (made ->> 'id')::uuid;
  select s.id into spring from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text;
  select k.id into laid from acts k where k.kind = 'card' and (k.payload ->> 'spring') = spring::text;
  if spring is null or laid is null or not exists (select 1 from post_veils v where v.post = q and v.play = laid) then raise exception 'the face-down veil did not land on the quote: %', made; end if;
  if (select x.character from acts_public x where x.id = q) is distinct from stand then raise exception 'the quote of a landed veil shows its author'; end if;
  -- No row a signed-in player may read names the quoter: the spring Act, the card it laid, the play's reach, the alerts and the pages that carry them, read as the setter, as a third player and as a visitor to the thread.
  foreach who_sees in array array[ann, ray] loop
    perform tests.become(who_sees);
    seen := coalesce((select jsonb_agg(to_jsonb(x))::text from acts_public x where x.target_act_id in (held, q) or x.id in (q, spring, laid) or x.thread = t), '')
         || coalesce((select jsonb_agg(to_jsonb(x))::text from play_reach x where x.play = laid), '')
         || coalesce((select jsonb_agg(to_jsonb(al))::text from alerts al), '')
         || alerts_page(null)::text || log_page(null)::text || thread_page(t, 1, null, null, null)::text;
    perform tests.unbecome();
    if seen like '%' || c::text || '%' or seen like '%Vw Cy%' then
      raise exception 'a landed veil names the quoter to %: %', (case when who_sees = ann then 'the setter' else 'a third player' end), substring(seen from position(c::text in seen) - 160 for 400);
    end if;
  end loop;
  -- The spring says what it always says of the back and nothing of who quoted: no `for` and no other key that names a character.
  if (select s.payload ? 'for' from acts s where s.id = spring) then raise exception 'the spring of a landed veil carries the quoter in `for`'; end if;
  if (select (s.payload ->> 'did', s.payload ->> 'trigger', s.payload ->> 'by', s.payload ->> 'set') from acts s where s.id = spring)::text is distinct from format('(landed,quote,%s,%s)', q, back) then raise exception 'the spring of a landed veil is not as it was: %', (select s.payload from acts s where s.id = spring); end if;
  -- Every other card's spring keeps naming the quoter where its Who was only these: a plain Move set the same way.
  perform tests.become_service();
  back2 := (set_card(ann, 'vlmove', a, held2, '{}', 0, null, null, null, array[c], false) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cy);
  made := post(t, c, 'Quoting the other back.', held2);
  perform tests.unbecome();
  if (select s.payload ->> 'for' from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back2::text) is distinct from c::text then raise exception 'a plain Move''s spring no longer names the quoter where the Who was only these'; end if;
  perform tests.become(adm); perform reverse_card(laid); perform tests.unbecome();
end $$;

-- ---- 5c. A post a spring names its author on takes no veil: the public spring Act carries the quoter in `for` ----
-- When a face-down card whose Who is "only these" springs on a quote, spring_traps writes a public spring Act whose `for` is the quoter's character and whose `by` is the quote: a public Act that points at the quote and
-- names its author. A veil cast on that quote afterwards would hide an author the record already names, so land_refusal refuses it ("the same for every caster", a cast and a spring alike: both read land_refusal), by one probe of
-- acts_spring_by (0151), the index on the springs' `by`, filtered for a `for`. A spring that names no one (a Who of anyone, a landed veil's own) leaves the quote free to take one.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vz-ann'); bob uuid := tests.account('vz-bob'); cy uuid := tests.account('vz-cy');
  a uuid := tests.character(ann, 'Vz Ann'); b uuid := tests.character(bob, 'Vz Bob'); c uuid := tests.character(cy, 'Vz Cy');
  t uuid := tests.thread('Vz spring');
  stand uuid := pg_temp.stand();
  held uuid := tests.post(a, t, 'A back lies here.'); held2 uuid := tests.post(a, t, 'Another back lies here.');
  back uuid; back2 uuid; made jsonb; q uuid; q2 uuid; got text; words text := '42501 a card that sprang on this post names its author, so the author is on the record'; plan text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'vlmove', 'vlmove'); perform pg_temp.hand(bob, 'vlauthor', 'vlauthor'); perform pg_temp.hand(cy, 'vlauthor');
  -- A plain Move whose Who is only Cy's character: it springs on Cy's quote, and the public spring Act names Cy in `for`.
  perform tests.become_service();
  back := (set_card(ann, 'vlmove', a, held, '{}', 0, null, null, null, array[c], false) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cy);
  made := post(t, c, 'Quoting the back.', held);
  perform tests.unbecome();
  q := (made ->> 'id')::uuid;
  if (select s.payload ->> 'for' from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text and (s.payload ->> 'by') = q::text) is distinct from c::text then raise exception 'the spring did not name the quoter: %', made; end if;
  -- A veil cast on that quote is refused, in the same words for the quoter's own player and for anyone else, and nothing is written; land_refusal says the same for a cast and a spring.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, q, '{}', ''));
  if got is distinct from words then raise exception 'a veil on a quote a spring names: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, q, '{}', ''));
  if got is distinct from words then raise exception 'the quoter''s own veil on their quote a spring names: %', got; end if;
  perform tests.unbecome();
  if exists (select 1 from post_veils v where v.post = q) or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = q and k.payload ->> 'card' = 'vlauthor') then raise exception 'a refused veil wrote something'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), q, '{}') is distinct from substr(words, 7) or land_refusal((select k from card_kinds k where k.key = 'vlmove'), q, '{}') is not null then
    raise exception 'land_refusal for a post a spring names'; end if;
  -- A spring that names no one leaves the quote free: the same Move with a Who of anyone springs with no `for`, and the veil lands on that quote.
  perform tests.become_service();
  back2 := (set_card(ann, 'vlmove', a, held2, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cy);
  made := post(t, c, 'Quoting the other back.', held2);
  perform tests.unbecome();
  q2 := (made ->> 'id')::uuid;
  if not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'by') = q2::text and not s.payload ? 'for') then raise exception 'the spring of a Who of anyone was not written without `for`'; end if;
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'vlauthor', b, q2, '{}', ''));
  perform tests.unbecome();
  if got is not null then raise exception 'a veil on a quote whose spring names no one: %', got; end if;
  if not exists (select 1 from post_veils v where v.post = q2) or (select x.character from acts_public x where x.id = q2) is distinct from stand then raise exception 'the veil on a quote whose spring names no one did not land'; end if;
  -- One bounded indexed read: with sequential scans off the probe is served by acts_spring_by.
  set local enable_seqscan = off;
  plan := pg_temp.plan_of(format('select exists (select 1 from acts s where s.kind = ''spring'' and s.payload ->> ''by'' = %L and s.payload ? ''for'')', q::text));
  reset enable_seqscan;
  if plan not like '%acts_spring_by%' then raise exception 'the spring probe does not use acts_spring_by: %', plan; end if;
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
  got := pg_temp.coded('select id, kind, thread, target_act_id, seq, created_at from acts limit 1');
  if got is not null then raise exception 'a column other than character was refused: %', got; end if;
  -- `payload` is not granted either, and stays so (0340_conduct took it: the words are read through acts_public, which empties a hidden version's); this migration does not give it back.
  got := pg_temp.coded('select payload from acts limit 1');
  if got is null or got not like '42501%' then raise exception 'a signed-in player read acts.payload: %', coalesce(got, 'no refusal'); end if;
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
  -- post_veils_live (0400) anti-joins the live veils with the card_end Acts and with card_write_refunds, and every read of acts_public runs it. Nothing analyzes card_write_refunds in a test database, so the planner
  -- estimates it from its pages, and after the suite's earlier files those hold the dead rows they rolled back: the plan then reads the relation whole (a hash anti join over a sequential scan of it) where, told it holds
  -- nothing, it probes its key once per veil. That is why the stand-in's read below counted 87 to 95 buffers on a fresh database and 107 to 132 in full-suite runs: replaying every file before this one into a database and
  -- running this file on a copy of it read 133 without the analyze below and 111 with it (the heap's other leftovers, dead entries in acts_one_card_end and its not-all-visible heap fetches, move it a little more).
  analyze card_write_refunds;
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
  -- Main's concealment (0340_conduct) is in every read of acts_public: per row, the probes of conduct_decisions and quote_refs that acts_base pays too (127 buffers for this same read of acts_base, 429 for the twenty by id below and
  -- 380 for the page by thread and seq, measured in this file's state). The bounds are those plus what the veil adds (the second select's probes of the live veils, six of them up here), and stay an order of magnitude under a read of the rows.
  if touched > 200 then raise exception 'a profile''s newest five touch % buffers with 3,000 posts by the author', touched; end if;
  touched := pg_temp.buffers_of(format('select * from acts_public where character = %L and kind in (''post'', ''spin'', ''card'') order by created_at desc limit 5', stand));
  raise notice 'the stand-in''s newest five touch % buffers', touched;
  -- 200 is the margin over the 132 the full suite has measured, for the heap's state; the guard is the shape (the plan checks above: no sequential scan of acts, the veils' index probed) and this bound's order of
  -- magnitude: a read of the union whole, or of the author's 3,000 posts to find the stand-in's, pins a buffer per row, in the thousands.
  if touched > 300 then raise exception 'the stand-in''s newest five touch % buffers', touched; end if;
  touched := pg_temp.buffers_of(format('select to_jsonb(x) from (select id from acts where thread = %L and seq between 100 and 119) r join acts_public x on x.id = r.id', t));
  raise notice 'twenty Acts joined by id touch % buffers', touched;
  if touched > 1000 then raise exception 'twenty Acts joined to acts_public by id touch % buffers', touched; end if;
  touched := pg_temp.buffers_of(format('select * from acts_public where thread = %L and seq between 100 and 119 and kind not in (''edit'', ''card'')', t));
  raise notice 'a page by thread and seq touches % buffers', touched;
  if touched > 600 then raise exception 'a page by thread and seq touches % buffers', touched; end if;
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
  -- The bound is 100 (it was 60). Measured: 40 buffers when this file runs alone, 42 after the suite as it stood before card notes Part 2, and 62 to 71 in the full suite on main's 0344 to 0349 (68 on GitHub's merge). What moved is state the earlier
  -- files leave, and the heap's layout under this file's own 3,000 posts (which update the author's stored count row 3,000 times in this transaction, so the key's read walks the row's versions): the files main changed before this one add to
  -- it, each alone (0135 7 buffers, 0107 4, 0059 1, the rest none; 12 together), and none of them is on the read's path. With that state the planner also reads post_veils_live's `not exists (acts_one_card_end)` as a merge anti join over the
  -- whole index (10 buffers with the 9 ends this file has made) where it probes each live veil's play with fewer; `offset 0` on the two probes was tried and takes it off the count read (71 to 63) but turns the reads of acts_public above into
  -- per-row subplans (a page by thread and seq 165 to 287), so the view is left as it is. The guard is the shape above (the stored row's key, the live veils' index, no scan of the count table) and an order of magnitude: a read of the author's
  -- 3,000 posts pins thousands of buffers. 100 is a margin of about 30 over the 71 the worst state measured, as the bounds of the reads above are over theirs.
  if touched > 100 then raise exception 'a count read touches % buffers', touched; end if;
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
  perform pg_temp.hand(bob, 'vlchar'); perform pg_temp.hand(ann, 'vlself', 'vlchar'); perform pg_temp.hand(cy, 'vlauthor', 'vlauthor', 'vlauthor', 'vlchar');
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
  if got is distinct from '22023 no card is played on a stand-in' then raise exception 'a character card from a veiled post, on its author: %', got; end if;
  -- The post shows the stand-in to everyone, so whoever is named as its character meets the one refusal (the code and the words a third player meets): the author's own player, who names the author, and a player who names
  -- any other character, and what is said does not depend on who owns the post. (The false "played from one of its posts" is for a post that is not veiled.)
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'vlchar', a, a, '{}', '', 'character', clean));
  if got is distinct from '22023 no card is played on a stand-in' then raise exception 'the author''s own character card from their veiled post: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', cy, 'vlchar', c, b, '{}', '', 'character', clean));
  if got is distinct from '22023 no card is played on a stand-in' then raise exception 'a character card from a veiled post, on a third character: %', got; end if;
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
  -- The author has used a card of hers on the post (an Act of hers on it, which the veil shows under the stand-in) and spun a thread from it (a thread of her own, which stays hers and stays counted as hers).
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

  -- Every read of a count, as a third player: the author's loses the veiled post and her card on it (not her spin), the stand-in's holds them.
  perform tests.become(ray);
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = a) n);
  if shown is distinct from '{"posts": 2, "spins": 1, "cards": 0}'::jsonb then raise exception 'the author''s count while the veil is up: %', shown; end if;
  shown := (select to_jsonb(n) from (select posts, spins, cards from character_post_counts where character = stand) n);
  if shown is distinct from jsonb_build_object('posts', (s0 ->> 'posts')::integer + 1, 'spins', (s0 ->> 'spins')::integer, 'cards', (s0 ->> 'cards')::integer + 1) then raise exception 'the stand-in''s count while the veil is up: % (was %)', shown, s0; end if;
  if (select count(*) from character_post_counts where character in (a, stand)) is distinct from 2 then raise exception 'a count is read twice or not at all'; end if;
  -- The counts a page returns are the same, and each is the number of rows the page's own lists hold: the author's profile lists the posts it counts.
  rec := record_page(a, 'post', 1);
  if (rec -> 'counts' ->> 'posts')::integer is distinct from 2 or jsonb_array_length(rec -> 'acts') is distinct from 2 then raise exception 'the author''s record: % lists % posts', rec -> 'counts', jsonb_array_length(rec -> 'acts'); end if;
  rec := record_page(stand, 'post', 1);
  if (rec -> 'counts' ->> 'posts')::integer is distinct from (s0 ->> 'posts')::integer + 1 or jsonb_array_length(rec -> 'acts') is distinct from least((s0 ->> 'posts')::integer + 1, 20)
     or not exists (select 1 from jsonb_array_elements(rec -> 'acts') x where x ->> 'id' = p2::text) then
    raise exception 'the stand-in''s record: % lists % posts', rec -> 'counts', jsonb_array_length(rec -> 'acts');
  end if;
  if (profile_page(a) -> 'counts') is distinct from jsonb_build_object('character', a, 'posts', 2, 'spins', 1, 'cards', 0) then raise exception 'the author''s profile counts: %', profile_page(a) -> 'counts'; end if;
  if (profile_page(stand) -> 'counts') is distinct from jsonb_build_object('character', stand, 'posts', (s0 ->> 'posts')::integer + 1, 'spins', (s0 ->> 'spins')::integer, 'cards', (s0 ->> 'cards')::integer + 1) then raise exception 'the stand-in''s profile counts: %', profile_page(stand) -> 'counts'; end if;
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

-- ---- 12. The shown group follows the shown count: a character at a rung's threshold drops a rung while one of its posts is veiled, and both return together ----
-- A group is shown live (characters_public."group", the thread page's people, the presence box) and is display only (nothing a group changes writes an Act, an alert or a ledger row, pays or costs anything, or gates what a
-- character may do: it is read, never written), so it follows the same projection as the count a player reads. A group that held while the count above it dropped would be a mismatch anyone could read at any time, computed from
-- the post's private veil; the drop at the veil's start and the return at its end are the clue the profile's list already gives.
select tests.unbecome();
do $$
declare
  zed uuid := tests.account('vq-gzed'); cy uuid := tests.account('vq-gcy'); adm uuid := tests.account('vq-gadmin');
  z uuid := tests.character(zed, 'Vq GZed'); c uuid := tests.character(cy, 'Vq GCy');
  t uuid := tests.thread('Vq group');
  p1 uuid := tests.post(z, t, 'The first post.'); p2 uuid := tests.post(z, t, 'The second post, veiled.');
  veil uuid; shown integer; page jsonb;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(cy, 'vlauthor');
  -- A ladder of this test's own, above whatever the database holds: a default rung and a posts rung that Zed meets with exactly two posts.
  insert into group_kinds (key, name, color, source, rung, condition) values ('vgLow', 'Vg Low', '#101010', 'ladder', 91, 'default');
  insert into group_kinds (key, name, color, source, rung, condition, at_least) values ('vgHigh', 'Vg High', '#202020', 'ladder', 92, 'posts', 2);
  if group_now(z) is distinct from 'vgHigh' or (select cp."group" from characters_public cp where cp.id = z) is distinct from 'vgHigh' or (select n.posts from character_post_counts n where n.character = z) is distinct from 2 then
    raise exception 'the character at the threshold is not in the rung before any veil: %', group_now(z);
  end if;
  perform tests.become_service();
  veil := (play_card(cy, 'vlauthor', c, p2, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  -- The count a player reads drops by the veiled post, and the group every read shows drops with it: the two agree at every moment.
  shown := (select posts from character_post_counts where character = z);
  if shown is distinct from 1 then raise exception 'the count a player reads should hide the veiled post: %', shown; end if;
  if group_now(z) is distinct from 'vgLow' or (select cp."group" from characters_public cp where cp.id = z) is distinct from 'vgLow' then
    raise exception 'the group still shows the rung the hidden post earned: group_now % while the count reads %', group_now(z), shown;
  end if;
  perform tests.become(zed);
  page := thread_page(t, 1, null, null, null);
  perform tests.unbecome();
  if (select x -> 'character' ->> 'group' from jsonb_array_elements(page -> 'people') x where x -> 'character' ->> 'id' = z::text) is distinct from 'vgLow' then
    raise exception 'the thread page shows another group than the count: %', page -> 'people';
  end if;
  -- And both come back together at the end of the veil.
  perform tests.become(adm); perform reverse_card(veil); perform tests.unbecome();
  if (select posts from character_post_counts where character = z) is distinct from 2 or group_now(z) is distinct from 'vgHigh' or (select cp."group" from characters_public cp where cp.id = z) is distinct from 'vgHigh' then
    raise exception 'after the veil the count and the group are not back together: % and %', (select posts from character_post_counts where character = z), group_now(z);
  end if;
end $$;

-- ---- 14. Main's concealment (0340_conduct) and the veil compose: a veiled post an admin hides, and one that quotes a hidden post ----
-- acts_public is concealment over a union that changes `character` alone (0400, section 4), so for every row the concealment is acts_base's, and nothing the concealment answers names the author: a hidden veiled post is hidden under
-- the stand-in, its edit's words are withheld as any edit's are, and a veiled post that quotes a hidden one is served as its layer, never its words, as any quoter is.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vk-ann'); bob uuid := tests.account('vk-bob'); adm uuid := tests.account('vk-admin'); rdr uuid := tests.account('vk-rdr');
  a uuid := tests.character(ann, 'Vk Ann'); b uuid := tests.character(bob, 'Vk Bob'); r uuid := tests.character(rdr, 'Vk Rdr');
  t uuid := tests.thread('Vk conduct');
  stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'A veiled post an admin hides, zebrafish.'); e uuid; hid uuid := tests.post(r, t, 'Hidden words, quokka.');
  q uuid := tests.post(a, t, format('[quote=%s]Hidden words, quokka.[/quote] and mine, a veiled quoter.', hid));
  veil uuid; got record; n integer;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  perform pg_temp.hand(bob, 'vlauthor', 'vlauthor');
  perform tests.become_service();
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(bob, 'vlauthor', b, q, '{}', 0, '');
  perform tests.unbecome();
  perform tests.become(adm);
  perform decide(null, p, 'hide', null, 'a veiled post');
  perform decide(null, hid, 'hide', null, 'the quoted one');
  perform tests.unbecome();
  e := tests.act(a, 'edit', t, jsonb_build_object('body', 'The veiled post, reworded, zebrafish.'), p, now() + interval '1 hour');
  perform tests.become(rdr);
  -- The hidden veiled post: the stand-in, hidden, no words; its edit shows the stand-in too and its words are the hidden post's (the post is hidden outright, so its edit is withheld until an admin approves).
  select x.character, x.hidden, x.payload_hidden, x.current_payload ->> 'body' as cur, x.payload::text as raw into got from acts_public x where x.id = p;
  if got.character is distinct from stand or got.hidden is not true or got.payload_hidden is not true or got.cur is not null or got.raw like '%zebrafish%' then
    raise exception 'a hidden veiled post is not hidden under the stand-in: %', got; end if;
  select x.character, x.hidden, x.payload_hidden, x.payload::text as raw into got from acts_public x where x.id = e;
  if got.character is distinct from stand or got.hidden is not true or got.payload_hidden is not true or got.raw like '%zebrafish%' then
    raise exception 'the edit of a hidden veiled post is not hidden under the stand-in: %', got; end if;
  -- The veiled quoter of a hidden post: the stand-in, and the words are the layer's or nothing (concealing), never the hidden words.
  select x.character, x.current_payload::text as cur, x.concealing, x.payload_concealing into got from acts_public x where x.id = q;
  if got.character is distinct from stand or got.cur like '%quokka%' then raise exception 'a veiled quoter of a hidden post: %', got; end if;
  perform tests.unbecome();
  -- Every row, with the concealment's own columns, is acts_base's but for the character, and the character differs on the veiled rows alone: the post, its edit and the quoter, and no other Act of the thread.
  if exists (select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_base where thread = t
             except select id, kind, thread, target_act_id, seq, created_at, payload, current_payload, edited_at, shown_edited_at, untaken, ends_at, hidden, any_hidden, concealing, payload_hidden, payload_concealing from acts_public where thread = t) then
    raise exception 'acts_public differs from acts_base in a column other than character with a hidden veiled post'; end if;
  select count(*) into n from acts_base b join acts_public x on x.id = b.id where b.thread = t and x.character is distinct from b.character;
  -- The stand-in has no group, a staff one included: it is no Mod Bot and holds no rung, so no read draws a bar or a Group row for it (the profile page's and the postbit's character carry null).
  perform tests.become(rdr);
  if group_now(stand) is not null or (select cp."group" from characters_public cp where cp.id = stand) is not null or (profile_page(stand) -> 'character' ->> 'group') is not null then
    raise exception 'the stand-in has a group: %, %', group_now(stand), (profile_page(stand) -> 'character' ->> 'group'); end if;
  perform tests.unbecome();
  if n is distinct from 3 then raise exception 'the rows whose character differs are % and should be the three: the post, its edit and the quoter (the veil cards are Bob''s, whose character no veil changes)', n; end if;
end $$;

-- ---- 15. The model is handed the stand-in for a veiled post's author ----
-- The words a model writes are posted, so a model handed a veiled post's true author can write that name into them ("The model reads the stand-in too, since its words are posted", the plan's decisions). claim_card_writes (0149, 0340)
-- handed the model `'author', ch.name` of the post's own character; it hands the name acts_public shows now (shown_author), and nothing else about the author (a job carries a name and no id, pronouns, class or group).
-- THE ROADS A MODEL READS A POST'S AUTHOR BY (every function a model's role may run, or an Edge Function feeds to a prompt, read at its latest definition; settlement and the other code-only scoring read the truth and are not here):
--   claim_card_writes (write)         HANDED THE TRUE AUTHOR ('author', ch.name) before 0400; now shown_author's character, probed below. Its `before` posts read acts_public and characters_public: the stand-in, probed below.
--   pool_thread (chatter, staff: the visit, report and appeal judges, the thread a Mod Bot answers)
--                                     reads acts_public joined to characters_public: the stand-in; probed below.
--   patrol_sample (the patrol)        reads acts_public and keeps `characters_public.staff is null`: the stand-in is staff, so a veiled post is never sampled; probed below.
--   system_digest (the meeting)       every read is acts_public / characters_public / thread_list: the stand-in (section 10 probes its `characters`, and below its excerpts).
--   pool_signals, pool_named          acts_public and thread_open (first and last poster by shown author): the stand-in, and the stand-in is not staff (section 10).
--   card_target, card_target_reach    the post's words through acts_public (no author), the effects above it on shown_author's character (0400).
--   start_visit, file_visit, filings_due, open_report
--                                     a post under a live author veil is never visited and never reported (0400, section 4 of this file), so nothing about it reaches a judge.
--   open_appeal, close_appeal         the appellant is the caller's own character, appealing a punishment (an infraction or a ban, written only through a visit; a visited post takes no veil, section 4; or a move on a character).
--   pending_apologies                 an apology is the punished character's own spin, no veiled post.
--   conceal_due                       the engine's parser, no model: the words of an Act, no author.
--   character_faces, public_characters, character_groups, trophy_award_facts, boss_trophies, mod_*, meeting_context, staff_*
--                                     ids the staff's own memory holds (written from what a model was shown) or no post at all: characters_public names, never a post's author.
do $$
declare
  ann uuid := tests.account('vx-ann'); bob uuid := tests.account('vx-bob'); cas uuid := tests.account('vx-cas'); ray uuid := tests.account('vx-ray');
  a uuid := tests.character(ann, 'Vx Ann'); b uuid := tests.character(bob, 'Vx Bob'); c uuid := tests.character(cas, 'Vx Cas'); r uuid := tests.character(ray, 'Vx Ray');
  stand uuid := pg_temp.stand();
  stand_name text := (select k.name from characters k where k.id = pg_temp.stand());
  long_ago timestamptz := now() - interval '400 days';
  bd uuid; t uuid; before_post uuid; veiled_before uuid; p uuid;
  veil uuid; got jsonb; job jsonb; read jsonb; sample jsonb; dig jsonb;
begin
  -- A board of its own, so the patrol's sample (the newest threads of the boards it is given) reads this file's posts alone.
  insert into boards (slug, name) values ('vx-model', 'Vx Model') returning id into bd;
  insert into threads (board, title) values (bd, 'Vx model') returning id into t;
  before_post := tests.post(r, t, 'A plain post before, vxneighbor.', long_ago + interval '1 minute');
  veiled_before := tests.post(a, t, 'A veiled post before, vxveiledbefore.', long_ago + interval '2 minutes');
  p := tests.post(a, t, 'The words a model will write on, vxtarget.', long_ago + interval '3 minutes');
  perform pg_temp.cards();
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '20'), ('digestExcerptChars', '280') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('vx-scribe', 'Vx Scribe', 'salty', 'uncommon', 'cast', 3, true) on conflict do nothing;
  insert into admins (account) values (ray) on conflict do nothing;
  perform pg_temp.hand(bob, 'vlauthor', 'vlauthor');
  perform tests.become_service();
  veil := (play_card(bob, 'vlauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(bob, 'vlauthor', b, veiled_before, '{}', 0, '');
  perform tests.unbecome();
  perform tests.act(c, 'card', t, jsonb_build_object('card', 'vx-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, now());

  -- claim_card_writes: the model's job names the post's author as every reader sees it, the stand-in; its true name is nowhere in the job, `before` included (the neighbor that is veiled too).
  perform tests.become_service();
  got := claim_card_writes(5, p);
  perform tests.unbecome();
  job := got -> 0;
  if jsonb_array_length(got) is distinct from 1 or job ->> 'body' is distinct from 'The words a model will write on, vxtarget.' then raise exception 'the claim carries no job for the veiled post, so the test proves nothing: %', got; end if;
  if job ->> 'author' is distinct from stand_name then raise exception 'claim_card_writes hands the model % as the author of a veiled post, and the stand-in is %: %', job ->> 'author', stand_name, job; end if;
  if got::text like '%Vx Ann%' or got::text like '%' || a::text || '%' then raise exception 'claim_card_writes hands the model the true author of a veiled post: %', got; end if;
  if exists (select 1 from jsonb_each(job) e where e.key in ('id', 'character', 'pronouns', 'class', 'group', 'owner', 'account')) then raise exception 'a claimed job carries a field about the author beyond its name: %', job; end if;
  if (select string_agg(x ->> 'name', ',' order by ord) from jsonb_array_elements(job -> 'before') with ordinality as b(x, ord)) is distinct from 'Vx Ray,' || stand_name then
    raise exception 'the posts shown before a veiled post name the wrong authors: %', job -> 'before'; end if;
  -- pool_thread: the thread a Mod Bot's model is shown names the stand-in for the veiled post before.
  perform tests.become_service();
  read := pool_thread(t, 10, 200, null);
  perform tests.unbecome();
  if read::text like '%Vx Ann%' or (select x ->> 'name' from jsonb_array_elements(read -> 'posts') x where x ->> 'act' = veiled_before::text) is distinct from stand_name then
    raise exception 'pool_thread names the true author of a veiled post: %', read; end if;
  -- patrol_sample: a veiled post is not sampled (the stand-in is staff), and nothing names its author.
  perform tests.become_service();
  sample := patrol_sample(array[bd], 20);
  perform tests.unbecome();
  if sample::text like '%Vx Ann%' or exists (select 1 from jsonb_array_elements(sample) x where x ->> 'act' = veiled_before::text) then raise exception 'patrol_sample reaches a veiled post: %', sample; end if;
  if not exists (select 1 from jsonb_array_elements(sample) x where x ->> 'act' = before_post::text) then raise exception 'patrol_sample reads nothing of the thread, so the test proves nothing: %', sample; end if;
  -- system_digest (over a window a long time ago, where this section's posts are the only ones): the excerpts name the stand-in for the veiled post before, never its author.
  perform tests.become_service();
  dig := system_digest(long_ago - interval '1 hour', long_ago + interval '1 hour');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(dig -> 'excerpts') x where x ->> 'act' = veiled_before::text) or exists (select 1 from jsonb_array_elements(dig -> 'excerpts') x where x ->> 'act' in (veiled_before::text, p::text) and x ->> 'character' is distinct from stand::text) then
    raise exception 'the digest names the author of a veiled post: %', dig -> 'excerpts'; end if;
  -- The same read when no veil is up: the true author again (the veil ends by an admin here; it ends by itself at its time as well, section 3).
  perform tests.become(ray);
  perform reverse_card(veil);
  perform tests.unbecome();
  update card_writes set claimed_until = null where post = p;
  perform tests.become_service();
  got := claim_card_writes(5, p);
  perform tests.unbecome();
  if got -> 0 ->> 'author' is distinct from 'Vx Ann' then raise exception 'claim_card_writes does not name the author again once the veil has ended: %', got; end if;
end $$;

-- ---- 16. A card that replies (Line Cutter, 0348) and a thread-reach play (Feelin' Glam, 0349) beside a veil ----
-- A cut-in reply is a post of the caster's, drawn under its parent while the play is in force. What names whom: the play's card Act is the caster's (its `character`), on the parent (its target), and its payload names the reply
-- (`reply`); post_under holds play, parent, reply and thread; the reply is a post of the caster's. So:
--   (a) a veil on the PARENT, whoever cut in: nothing about the reply names the parent's author, unless the author cut in themselves (c).
--   (b) a veil on the REPLY: the card Act (target: the parent, so no derived veil reaches it) says whose reply it is, as a card played from a post at character reach does: the veil is refused, ended play or not.
--   (c) the parent's own author cuts in under their veiled post: the derived veil would show the card Act under the stand-in and the reply (a post, which the derived veil never covers) under its true author, which says the
--       author is the stand-in; so a Line Cutter is refused on a veiled post, for every caster alike, and a veil is refused on a post its own author cut a reply in under.
--   (d) a thread-reach play (a Feelin' Glam) names a thread and its caster; what it draws on a post is keyed on the thread, never on the post's author, so a veiled post takes it as any post does and nothing names the author.
select tests.unbecome();
insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, keeps, lasts, veil) values
  ('vcucut', 'Vcu Cut', 'pepperoni', 'rare', 'cast', 3, '{post}', true, false, null, null),
  ('vcuglam', 'Vcu Glam', 'sweet', 'rare', 'cast', 2, '{thread}', false, true, interval '7 days', null);
do $$
declare
  ann uuid := tests.account('vcu-ann'); bob uuid := tests.account('vcu-bob'); cy uuid := tests.account('vcu-cy'); ray uuid := tests.account('vcu-ray');
  a uuid := tests.character(ann, 'Vcu Ann'); b uuid := tests.character(bob, 'Vcu Bob'); c uuid := tests.character(cy, 'Vcu Cy'); r uuid := tests.character(ray, 'Vcu Ray');
  stand uuid := pg_temp.stand();
  t uuid := tests.thread('Vcu cut'); p1 uuid := tests.post(a, t, 'Veiled before the cut-in.'); p2 uuid := tests.post(a, t, 'Cut in under first, veiled after.'); p3 uuid := tests.post(a, t, 'Own cut-in, veiled after.');
  p4 uuid := tests.post(a, t, 'Veiled first, then someone cuts in.'); other uuid := tests.post(r, t, 'A plain post.');
  t2 uuid; v5 uuid; got text; played jsonb; k2 uuid; r2 uuid; k3 uuid; r3 uuid; doc jsonb; row jsonb; words text;
  hit text := 'Vcu Ann';
begin
  perform pg_temp.cards();
  insert into wallets (account, balance) values (ann, 100), (bob, 100), (cy, 100) on conflict do nothing;
  perform pg_temp.hand(bob, 'vcucut', 'vcucut', 'vcuglam'); perform pg_temp.hand(ann, 'vcucut', 'vcucut', 'vcuglam'); perform pg_temp.hand(cy, 'vlauthor', 'vlauthor', 'vlauthor', 'vlauthor', 'vlauthor');
  perform tests.become_service();
  -- Bob cuts a reply in under p2 and under p3; Ann cuts one in under p3, her own post, before any veil.
  played := play_card(bob, 'vcucut', b, p2, '{}', 0, '', reply => 'Bob cuts in under p2.'); k2 := (played ->> 'id')::uuid; r2 := (played #>> '{under,act,id}')::uuid;
  played := play_card(ann, 'vcucut', a, p3, '{}', 0, '', reply => 'Ann cuts in under her own p3.'); k3 := (played ->> 'id')::uuid; r3 := (played #>> '{under,act,id}')::uuid;
  perform tests.unbecome();

  -- (a) A veil on the parent of Bob's cut-in: the page, the Acts and every read of the reply name Bob and the post's id, and nothing names Ann.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, p2, '{}', ''));
  perform tests.unbecome();
  if got is not null then raise exception '(a) a veil on a post another character cut in under: %', got; end if;
  perform tests.become(ray);
  doc := thread_page(t, 1, null, 20, '{vcucut}');
  perform tests.unbecome();
  if doc #>> '{under,0,parent}' is null or not exists (select 1 from jsonb_array_elements(doc -> 'under') u where u ->> 'parent' = p2::text and u #>> '{act,character}' = b::text) then
    raise exception '(a) the page draws Bob''s reply under the veiled post: %', doc -> 'under'; end if;
  -- Ann's id and name are nowhere in the rows that describe p2's cut-in: under, the card Act, the reply, the people, the page's plays.
  if (select jsonb_agg(u) from jsonb_array_elements(doc -> 'under') u where u ->> 'parent' = p2::text)::text like '%' || a::text || '%' or (select jsonb_agg(u) from jsonb_array_elements(doc -> 'under') u where u ->> 'parent' = p2::text)::text like '%' || hit || '%' then
    raise exception '(a) under names the veiled post''s author: %', doc -> 'under'; end if;
  if (select jsonb_agg(to_jsonb(x)) from acts_public x where x.id in (k2, r2))::text like '%' || a::text || '%' or (select jsonb_agg(to_jsonb(x)) from post_under x where x.reply = r2)::text like '%' || a::text || '%'
     or (select jsonb_agg(to_jsonb(x)) from play_reach x where x.play = k2)::text like '%' || a::text || '%' then
    raise exception '(a) a row of the cut-in names the veiled post''s author'; end if;
  if (select x.character from acts_public x where x.id = p2) is distinct from stand then raise exception '(a) the veiled post shows the stand-in'; end if;

  -- (b) A veil on the reply itself is refused: the card Act names the reply and its caster. Refused in the words every caster meets, nothing written; an ended play changes nothing.
  words := '42501 a card cut this post in under another, so its author is on the record';
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, r2, '{}', ''));
  perform tests.unbecome();
  if got is distinct from words then raise exception '(b) a veil on a cut-in reply: %', got; end if;
  if exists (select 1 from post_veils v where v.post = r2) then raise exception '(b) a refused veil wrote a row'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), r2, '{}') is distinct from substr(words, 7) or land_refusal((select k from card_kinds k where k.key = 'vltotals'), r2, '{}') is not null then
    raise exception '(b) land_refusal for a cut-in reply: a totals veil names no one, and an author veil is refused'; end if;
  insert into admins (account) values (ray) on conflict do nothing;
  perform tests.become(ray); perform reverse_card(k2); perform tests.unbecome();
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, r2, '{}', ''));
  perform tests.unbecome();
  if got is distinct from words then raise exception '(b) an ended Line Cutter still names the reply''s author: %', got; end if;

  -- (c) Ann's own cut-in under her own post p3: a veil on p3 is refused (the card Act would show the stand-in, and the reply its true author).
  words := '42501 its author cut a reply in under this post, so the author is on the record';
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, p3, '{}', ''));
  perform tests.unbecome();
  if got is distinct from words then raise exception '(c) a veil on a post its own author cut in under: %', got; end if;
  if land_refusal((select k from card_kinds k where k.key = 'vlauthor'), p3, '{}') is distinct from substr(words, 7) then raise exception '(c) land_refusal for a post its author cut in under'; end if;
  -- And a Line Cutter on a post that is veiled: refused for the author and for anyone else, in the same words, nothing written, the card kept.
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, p4, '{}', ''));
  perform tests.unbecome();
  if got is not null then raise exception '(c) the veil on p4: %', got; end if;
  words := '42501 this post''s author is hidden until ' || refusal_time(author_veil_ends(p4)) || '; no reply is cut in under it before then';
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L, %L, %L, %L)', ann, 'vcucut', a, p4, '{}', '', 'post', null, null, null, 'The author cuts in.'));
  if got is distinct from words then raise exception '(c) the author''s Line Cutter on their veiled post: %', got; end if;
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L, %L, %L, %L)', bob, 'vcucut', b, p4, '{}', '', 'post', null, null, null, 'A stranger cuts in.'));
  if got is distinct from words then raise exception '(c) a stranger''s Line Cutter on a veiled post: %', got; end if;
  perform tests.unbecome();
  if exists (select 1 from post_under u where u.parent = p4) or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = p4 and k.payload ->> 'card' = 'vcucut') then raise exception '(c) a refused Line Cutter wrote something'; end if;
  if card_held(ann, 'vcucut') is distinct from 1 then raise exception '(c) the refused play kept its card'; end if;

  -- (d) Feelin' Glam from a plain post, on a thread whose only post by Ann is veiled: the play's Act names its caster and the page draws it for every post of the thread; no row names Ann.
  t2 := tests.thread('Vcu glam'); v5 := tests.post(a, t2, 'The veiled post of the glam thread.'); other := tests.post(r, t2, 'A plain post.');
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cy, 'vlauthor', c, v5, '{}', ''));
  played := play_card(bob, 'vcuglam', b, t2, '{}', 0, '', 'thread', other);
  perform tests.unbecome();
  if got is not null then raise exception '(d) the veil on the glam thread''s post: %', got; end if;
  perform tests.become(ray);
  doc := thread_page(t2, 1, null, 20, '{vcuglam}');
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(doc -> 'above') x where x #>> '{act,id}' = played ->> 'id') then raise exception '(d) the page carries the thread play above its posts: %', doc -> 'above'; end if;
  if doc::text like '%' || hit || '%' or doc::text like '%' || a::text || '%' then raise exception '(d) the page of a thread with a veiled post and a thread play names the post''s author: %', doc; end if;
  if (select jsonb_agg(to_jsonb(x)) from acts_public x where x.id = (played ->> 'id')::uuid)::text like '%' || a::text || '%' or (select jsonb_agg(to_jsonb(x)) from play_reach x where x.play = (played ->> 'id')::uuid)::text like '%' || a::text || '%' then
    raise exception '(d) a thread-reach play names the author of a veiled post in its thread'; end if;
  -- Played from the veiled post by its own author: the card Act is one of the author's Acts on it (the derived veil: the stand-in), and the page still names no one.
  perform tests.become_service();
  played := play_card(ann, 'vcuglam', a, t2, '{}', 0, '', 'thread', v5);
  perform tests.unbecome();
  if (select x.character from acts_public x where x.id = (played ->> 'id')::uuid) is distinct from stand then raise exception '(d) the author''s thread play from the veiled post shows the stand-in'; end if;
  perform tests.become(ray);
  doc := thread_page(t2, 1, null, 20, '{vcuglam}');
  perform tests.unbecome();
  if doc::text like '%' || hit || '%' or doc::text like '%' || a::text || '%' then raise exception '(d) the page names the author of the veiled post after the author''s own thread play: %', doc; end if;
end $$;
