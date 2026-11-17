-- What a spun thread's page, a play's moment, a character card's reach, the log's views, the counts and the writes' claim read of its opening post (supabase/migrations/0375_spun_thread_reads.sql;
-- docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 2; design docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, sections 1 to 3, 5 and 7). 0374 let a card land on the opening post
-- of a spun thread (a `spin` Act); every read that asked "is this a post?" by hand still answered no, so a play that had landed was drawn nowhere. The cards are this file's own (rd...), never an instance's:
-- Rdeffect is the card an instance draws an effect for (it saves a state).
--
--  1. thread_page on S (a spun thread whose opening post Ann's character wrote, with one reply by Bob's) after the plays of C1, C3, C5, C7, C8 and C10 and one with a saved state: `plays`, `faces` (to the
--     setter alone), `states`, `under` and `above` are what the same plays give on a plain thread's first post, differing only in ids. A third reader sees no face-down card.
--  2. An author veil cast on the opening post: `veiled` is the plain thread's, for Ann alone.
--  3. play_moment of the play of C1 answers, and a thread spun from that play has an origin moment.
--  4. card_target_reach('character', Ann's character, the opening Act) names the thread and the board above it.
--  5. The log's views: an admin's end of a play on Ann's opening post is hers as `onMine`, a written tail on it is hers, and Bob reads neither.
--  6. The counts: an author veil on the opening post moves one spin, and no post, from Ann's character to the stand-in, and back when the veil ends.
--  7. claim_card_writes for a writing play on Bob's reply in S holds the opening post's words in `before`.
--  8. post_kind: authenticated may execute it (thread_page and the log's two views call it as the signed-in player); anon may not.
-- The read budget (plan, Task 2): this file's fixture is a handful of Acts, smaller than 0372-origin-scale.sql's, so that file's counts are the budget and are not repeated here.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, lasts, gimmick) values
    ('rdpost', 'Rd Post', 'sweet', 'common', 'cast', 1, '{post}', false, null, null),
    ('rdgimmick', 'Rd Gimmick', 'sweet', 'common', 'use', 1, '{post}', false, interval '7 days', '{"kind": "ward", "flavors": ["pepperoni"]}'),
    ('rdset', 'Rd Set', 'sweet', 'common', 'cast', 1, '{post}', false, null, null),
    ('rdreply', 'Rd Reply', 'salty', 'rare', 'cast', 1, '{post}', true, null, null),
    ('rdchar', 'Rd Character', 'pepperoni', 'uncommon', 'cast', 1, '{character}', false, interval '7 days', null),
    ('rdthreadg', 'Rd Thread Gimmick', 'sweet', 'common', 'use', 1, '{thread}', false, interval '1 day', '{"kind": "ward", "flavors": ["pepperoni"]}'),
    ('rdeffect', 'Rd Effect', 'sweet', 'rare', 'cast', 1, '{post}', false, null, null),
    ('rdend', 'Rd End', 'sweet', 'common', 'cast', 1, '{post}', false, null, null)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('rdscribe', 'Rd Scribe', 'salty', 'uncommon', 'cast', 3, true) on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('rdveil', 'Rd Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null)
  on conflict (key) do nothing;
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The stand-in, as seed_instance makes it.
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

-- A spin as `who`, through `through`, from `origin`, at `at_post` (null for none); the Act's id.
create function pg_temp.spun_at(who uuid, through uuid, origin uuid, at_post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin => origin, through => through, title => 'Rd spun ' || left(gen_random_uuid()::text, 6), body => 'The opening post.', at_post => at_post);
  perform tests.unbecome();
  return (made -> 'act' ->> 'id')::uuid;
end $$;

-- Three players and a character each: Ann (the author of every opening post), Bob (who replies and casts) and Cat (a third reader, and a caster).
create function pg_temp.people() returns jsonb language plpgsql as $$
declare
  tag text := left(gen_random_uuid()::text, 8);
  ann uuid := tests.account('rd-ann-' || tag); bob uuid := tests.account('rd-bob-' || tag); cat uuid := tests.account('rd-cat-' || tag);
begin
  return jsonb_build_object('ann', ann, 'bob', bob, 'cat', cat,
    'a', tests.character(ann, 'Rd Ann ' || tag), 'b', tests.character(bob, 'Rd Bob ' || tag), 'c', tests.character(cat, 'Rd Cat ' || tag));
end $$;

-- A thread with an opening post Ann's character wrote and one reply by Bob's: the spun thread S (the opening post is a `spin` Act, from a post of Bob's) or a plain thread (a `post` Act).
create function pg_temp.thread_of(spun boolean, ppl jsonb) returns jsonb language plpgsql as $$
declare
  a uuid := (ppl ->> 'a')::uuid; b uuid := (ppl ->> 'b')::uuid;
  origin_thread uuid; origin_post uuid; open uuid; t uuid; reply uuid;
begin
  if spun then
    origin_thread := tests.thread('Rd origin ' || left(gen_random_uuid()::text, 6));
    origin_post := tests.post(b, origin_thread, 'The post that is spun.');
    open := pg_temp.spun_at((ppl ->> 'ann')::uuid, a, origin_post, null);
    t := (select thread from acts where id = open);
  else
    t := tests.thread('Rd plain ' || left(gen_random_uuid()::text, 6));
    open := tests.post(a, t, 'The opening post.');
  end if;
  reply := tests.post(b, t, 'Bob replies.');
  return jsonb_build_object('t', t, 'open', open, 'reply', reply);
end $$;

-- The plays of C1, C3, C5, C7, C8 and C10, and one with a saved state, on a thread of thread_of's; every id, in the order shape() labels them.
create function pg_temp.play_all(spun boolean, ppl jsonb) returns jsonb language plpgsql as $$
declare
  ann uuid := (ppl ->> 'ann')::uuid; bob uuid := (ppl ->> 'bob')::uuid; a uuid := (ppl ->> 'a')::uuid; b uuid := (ppl ->> 'b')::uuid;
  w jsonb := pg_temp.thread_of(spun, ppl);
  t uuid := (w ->> 't')::uuid; open uuid := (w ->> 'open')::uuid; reply uuid := (w ->> 'reply')::uuid;
  p_post uuid; p_gimmick uuid; p_set uuid; p_reply uuid; p_char uuid; p_thread uuid; p_effect uuid; new_reply uuid;
begin
  perform pg_temp.hand(bob, 'rdpost', 'rdreply', 'rdchar', 'rdeffect');
  perform pg_temp.hand(ann, 'rdgimmick', 'rdset', 'rdthreadg');
  p_post := (play_card(bob, 'rdpost', b, open, '{}', 0, '') ->> 'id')::uuid;
  p_gimmick := (play_card(ann, 'rdgimmick', a, open, '{}', 0, '') ->> 'id')::uuid;
  p_set := (set_card(ann, 'rdset', a, open, '{}', 0) ->> 'id')::uuid;
  p_reply := (play_card(bob, 'rdreply', b, open, '{}', 0, '', reply => 'Cutting in under the opening post.') ->> 'id')::uuid;
  new_reply := (select (payload ->> 'reply')::uuid from acts where id = p_reply);
  p_char := (play_card(bob, 'rdchar', b, a, '{}', 0, '', 'character', open) ->> 'id')::uuid;
  p_thread := (play_card(ann, 'rdthreadg', a, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  p_effect := (play_card(bob, 'rdeffect', b, open, '{}', 0, '') ->> 'id')::uuid;
  perform save_effect_state(ann, a, p_effect, '{"strokes": [], "washed": 0.5}');
  return jsonb_build_object('t', t, 'open', open, 'reply', reply, 'p_post', p_post, 'p_gimmick', p_gimmick, 'p_set', p_set, 'p_reply', p_reply, 'p_char', p_char, 'p_thread', p_thread, 'p_effect', p_effect,
    'new_reply', new_reply);
end $$;

-- The ids of play_all's answer and the characters, in a fixed order: what shape() labels.
create function pg_temp.labels(w jsonb, ppl jsonb) returns uuid[] language sql as $$
  select array[(w ->> 'open')::uuid, (w ->> 'reply')::uuid, (w ->> 't')::uuid, (w ->> 'p_post')::uuid, (w ->> 'p_gimmick')::uuid, (w ->> 'p_set')::uuid, (w ->> 'p_reply')::uuid, (w ->> 'p_char')::uuid,
               (w ->> 'p_thread')::uuid, (w ->> 'p_effect')::uuid, (w ->> 'new_reply')::uuid, (ppl ->> 'a')::uuid, (ppl ->> 'b')::uuid, (ppl ->> 'c')::uuid]
$$;

-- A section of a page as text, one entry for each element, with the ids a build labeled named by their place, every other id and every time made one word, and the entries in order of their text:
-- two sections are the same up to ids when their shapes are equal.
create function pg_temp.shape(sec jsonb, labeled uuid[]) returns text[] language plpgsql as $$
declare e jsonb; s text; out text[] := '{}'; i integer;
begin
  for e in select value from jsonb_array_elements(sec) loop
    s := e::text;
    for i in 1 .. coalesce(array_length(labeled, 1), 0) loop
      if labeled[i] is not null then s := replace(s, labeled[i]::text, '<' || i || '>'); end if;
    end loop;
    s := regexp_replace(s, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
    s := regexp_replace(s, '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}(:[0-9]{2})?)', '<ts>', 'g');
    -- The names a play carries (a character's, a thread's) are made from a random tag in this file's fixtures, so the tag is not part of the shape.
    s := regexp_replace(s, 'Rd (Ann|Bob|Cat) [0-9a-f]{8}', 'Rd \1', 'g');
    s := regexp_replace(s, 'Rd (spun|plain) [0-9a-f]{6}', 'Rd thread', 'g');
    out := out || s;
  end loop;
  return coalesce((select array_agg(x order by x) from unnest(out) x), '{}');
end $$;

-- The thread_page document as `acct` reads it, with Rdeffect the card an instance draws an effect for.
create function pg_temp.page(acct uuid, t uuid) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become(acct);
  d := thread_page(t, 1, null, 20, array['rdeffect']);
  perform tests.unbecome();
  return d;
end $$;

-- ---- 1. the plays on the opening post, drawn as on any first post ----
do $$
declare
  pps jsonb := pg_temp.people(); ppp jsonb := pg_temp.people(); cat uuid := (pps ->> 'cat')::uuid;
  ws jsonb; wp jsonb; ls uuid[]; lp uuid[]; ds jsonb; dp jsonb; as_ann_s jsonb; as_ann_p jsonb; sec text;
begin
  perform pg_temp.cards();
  -- Each thread has characters of its own, so a card that stacks once on a character is played on each.
  ws := pg_temp.play_all(true, pps); wp := pg_temp.play_all(false, ppp);
  ls := pg_temp.labels(ws, pps); lp := pg_temp.labels(wp, ppp);
  if (select kind from acts where id = (ws ->> 'open')::uuid) is distinct from 'spin' or (select kind from acts where id = (wp ->> 'open')::uuid) is distinct from 'post' then
    raise exception '1 the fixture is a spun thread and a plain one';
  end if;
  ds := pg_temp.page(cat, (ws ->> 't')::uuid); dp := pg_temp.page(cat, (wp ->> 't')::uuid);

  -- plays: each play on the opening post, and the same as the plain thread's.
  if not (select coalesce(array_agg(x ->> 'id'), '{}') @> array[ws ->> 'p_post', ws ->> 'p_gimmick', ws ->> 'p_reply', ws ->> 'p_effect'] from jsonb_array_elements(ds -> 'plays') x) then
    raise exception '1 plays holds each play on the opening post, and lacks %', (select string_agg(k, ', ') from unnest(array['p_post', 'p_gimmick', 'p_reply', 'p_effect']) k
                                                                                 where not exists (select 1 from jsonb_array_elements(ds -> 'plays') x where x ->> 'id' = ws ->> k));
  end if;
  if pg_temp.shape(ds -> 'plays', ls) is distinct from pg_temp.shape(dp -> 'plays', lp) then
    raise exception '1 plays differ from a plain first post''s: % against %', pg_temp.shape(ds -> 'plays', ls), pg_temp.shape(dp -> 'plays', lp);
  end if;

  -- under: the reply of C7 drawn under the opening Act.
  if jsonb_array_length(ds -> 'under') is distinct from 1 or ds -> 'under' -> 0 ->> 'parent' is distinct from ws ->> 'open' or ds -> 'under' -> 0 ->> 'play' is distinct from ws ->> 'p_reply'
     or ds -> 'under' -> 0 -> 'act' ->> 'id' is distinct from ws ->> 'new_reply' then
    raise exception '1 under holds the reply of C7 with the opening Act as its parent: %', ds -> 'under';
  end if;
  if pg_temp.shape(ds -> 'under', ls) is distinct from pg_temp.shape(dp -> 'under', lp) then raise exception '1 under differs from a plain first post''s: % against %', pg_temp.shape(ds -> 'under', ls), pg_temp.shape(dp -> 'under', lp); end if;

  -- above: the character play of C8 and the thread play of C10.
  if not (select coalesce(array_agg(x ->> 'play'), '{}') @> array[ws ->> 'p_char', ws ->> 'p_thread'] from jsonb_array_elements(ds -> 'above') x) then
    raise exception '1 above holds the character play of C8 and the thread play of C10: %', ds -> 'above';
  end if;
  if pg_temp.shape(ds -> 'above', ls) is distinct from pg_temp.shape(dp -> 'above', lp) then raise exception '1 above differs from a plain first post''s: % against %', pg_temp.shape(ds -> 'above', ls), pg_temp.shape(dp -> 'above', lp); end if;

  -- states: the saved state of the play drawn for an effect.
  if jsonb_array_length(ds -> 'states') is distinct from 1 or ds -> 'states' -> 0 ->> 'play' is distinct from ws ->> 'p_effect' or ds -> 'states' -> 0 -> 'state' is distinct from '{"strokes": [], "washed": 0.5}'::jsonb then
    raise exception '1 states holds the saved state of the effect play: %', ds -> 'states';
  end if;
  if pg_temp.shape(ds -> 'states', ls) is distinct from pg_temp.shape(dp -> 'states', lp) then raise exception '1 states differ from a plain first post''s'; end if;

  -- faces: the face-down card is its setter's alone, as on any post.
  if jsonb_array_length(ds -> 'faces') is distinct from 0 or jsonb_array_length(dp -> 'faces') is distinct from 0 then raise exception '1 a third reader sees a face-down card: % %', ds -> 'faces', dp -> 'faces'; end if;
  as_ann_s := pg_temp.page((pps ->> 'ann')::uuid, (ws ->> 't')::uuid); as_ann_p := pg_temp.page((ppp ->> 'ann')::uuid, (wp ->> 't')::uuid);
  if jsonb_array_length(as_ann_s -> 'faces') is distinct from 1 or as_ann_s -> 'faces' -> 0 ->> 'play' is distinct from ws ->> 'p_set' or as_ann_s -> 'faces' -> 0 ->> 'card' is distinct from 'rdset' then
    raise exception '1 the setter sees the face-down card on the opening post: %', as_ann_s -> 'faces';
  end if;
  if pg_temp.shape(as_ann_s -> 'faces', ls) is distinct from pg_temp.shape(as_ann_p -> 'faces', lp) then raise exception '1 faces differ from a plain first post''s'; end if;
end $$;

-- ---- 2. an author veil on the opening post is the author's to see, as on any post ----
do $$
declare
  ppl jsonb := pg_temp.people(); ann uuid := (ppl ->> 'ann')::uuid; bob uuid := (ppl ->> 'bob')::uuid; cat uuid := (ppl ->> 'cat')::uuid; b uuid := (ppl ->> 'b')::uuid;
  ws jsonb; wp jsonb; vs uuid; vp uuid; ls uuid[]; lp uuid[]; ds jsonb; dp jsonb; ts jsonb; tp jsonb;
begin
  perform pg_temp.cards(); perform pg_temp.stand();
  ws := pg_temp.thread_of(true, ppl); wp := pg_temp.thread_of(false, ppl);
  perform pg_temp.hand(bob, 'rdveil', 'rdveil');
  vs := (play_card(bob, 'rdveil', b, (ws ->> 'open')::uuid, '{}', 0, '') ->> 'id')::uuid;
  vp := (play_card(bob, 'rdveil', b, (wp ->> 'open')::uuid, '{}', 0, '') ->> 'id')::uuid;
  ls := array[(ws ->> 'open')::uuid, vs, (ws ->> 't')::uuid, (ppl ->> 'a')::uuid]; lp := array[(wp ->> 'open')::uuid, vp, (wp ->> 't')::uuid, (ppl ->> 'a')::uuid];
  ds := pg_temp.page(ann, (ws ->> 't')::uuid); dp := pg_temp.page(ann, (wp ->> 't')::uuid);
  if jsonb_array_length(ds -> 'veiled') is distinct from 1 or ds -> 'veiled' -> 0 ->> 'post' is distinct from ws ->> 'open' or ds -> 'veiled' -> 0 ->> 'play' is distinct from vs::text
     or ds -> 'veiled' -> 0 ->> 'character' is distinct from ppl ->> 'a' then
    raise exception '2 veiled holds the author veil cast on the opening post: %', ds -> 'veiled';
  end if;
  if pg_temp.shape(ds -> 'veiled', ls) is distinct from pg_temp.shape(dp -> 'veiled', lp) then raise exception '2 veiled differs from a plain first post''s: % against %', pg_temp.shape(ds -> 'veiled', ls), pg_temp.shape(dp -> 'veiled', lp); end if;
  ts := pg_temp.page(cat, (ws ->> 't')::uuid); tp := pg_temp.page(cat, (wp ->> 't')::uuid);
  if jsonb_array_length(ts -> 'veiled') is distinct from 0 or jsonb_array_length(tp -> 'veiled') is distinct from 0 then raise exception '2 a third reader is told of the veil: %', ts -> 'veiled'; end if;
end $$;

-- ---- 3. the moment of a play on the opening post, and a thread spun from that play ----
do $$
declare
  ppl jsonb := pg_temp.people(); bob uuid := (ppl ->> 'bob')::uuid; cat uuid := (ppl ->> 'cat')::uuid; b uuid := (ppl ->> 'b')::uuid; c uuid := (ppl ->> 'c')::uuid;
  w jsonb; play uuid; got jsonb; s2 uuid; t2 uuid; doc jsonb;
begin
  perform pg_temp.cards();
  w := pg_temp.thread_of(true, ppl);
  perform pg_temp.hand(bob, 'rdpost');
  play := (play_card(bob, 'rdpost', b, (w ->> 'open')::uuid, '{}', 0, '') ->> 'id')::uuid;
  perform tests.become(cat);
  got := play_moment(play);
  perform tests.unbecome();
  if got is null or got -> 'version' ->> 'id' is distinct from w ->> 'open' or got -> 'layers' -> 0 -> 'act' ->> 'id' is distinct from play::text then
    raise exception '3 play_moment of a play on the opening post names the opening Act and the play: %', got;
  end if;
  s2 := pg_temp.spun_at(cat, c, play, null);
  t2 := (select thread from acts where id = s2);
  doc := pg_temp.page(cat, t2);
  if jsonb_typeof(doc -> 'origin' -> 'moment') is distinct from 'object' then raise exception '3 a thread spun from that play has an origin moment: %', doc -> 'origin' -> 'moment'; end if;
  if doc -> 'origin' -> 'moment' is distinct from got then raise exception '3 the origin''s moment is play_moment''s: % against %', doc -> 'origin' -> 'moment', got; end if;
end $$;

-- ---- 4. the reach of a character card cast from the opening post ----
do $$
declare
  ppl jsonb := pg_temp.people(); bob uuid := (ppl ->> 'bob')::uuid; a uuid := (ppl ->> 'a')::uuid; w jsonb; got jsonb;
begin
  w := pg_temp.thread_of(true, ppl);
  perform tests.become(bob);
  got := card_target_reach('character', a, (w ->> 'open')::uuid);
  perform tests.unbecome();
  if got -> 'above' -> 'thread' is null or got -> 'above' -> 'board' is null then
    raise exception '4 a character card reaches Ann''s character with the thread and the board above it, from her opening post: %', got;
  end if;
end $$;

-- ---- 5. the log's views: an end of a play and a written tail on the opening post ----
do $$
declare
  ppl jsonb := pg_temp.people(); ann uuid := (ppl ->> 'ann')::uuid; bob uuid := (ppl ->> 'bob')::uuid; cat uuid := (ppl ->> 'cat')::uuid; c uuid := (ppl ->> 'c')::uuid; a uuid := (ppl ->> 'a')::uuid;
  adm uuid := tests.account('rd-admin-' || left(gen_random_uuid()::text, 8));
  w jsonb; ended uuid; n integer;
begin
  perform pg_temp.cards();
  w := pg_temp.thread_of(true, ppl);
  insert into admins (account) values (adm);
  perform pg_temp.hand(cat, 'rdend');
  ended := (play_card(cat, 'rdend', c, (w ->> 'open')::uuid, '{}', 0, '') ->> 'id')::uuid;
  perform tests.become(adm); perform reverse_card(ended); perform tests.unbecome();
  perform tests.become(ann);
  select count(*) into n from my_cards_ended e where e.play = ended and e.side = 'onMine' and e."character" = a and e.reach = 'post';
  if n is distinct from 1 then raise exception '5 Ann reads an admin''s end of a play on her opening post as onMine (rows: %)', n; end if;
  perform tests.become(bob);
  if exists (select 1 from my_cards_ended e where e.play = ended) then raise exception '5 Bob reads an end of a play on a post that is not his'; end if;
  perform tests.unbecome();
end $$;

do $$
declare
  ppl jsonb := pg_temp.people(); ann uuid := (ppl ->> 'ann')::uuid; bob uuid := (ppl ->> 'bob')::uuid; c uuid := (ppl ->> 'c')::uuid;
  w jsonb; written uuid; n integer;
begin
  perform pg_temp.cards();
  w := pg_temp.thread_of(true, ppl);
  -- A writing play on the opening post, with the text a worker leaves (as the tests of 0149 do).
  written := tests.act(c, 'card', (w ->> 't')::uuid, jsonb_build_object('card', 'rdscribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), (w ->> 'open')::uuid);
  insert into card_texts (play, version, text) values (written, (w ->> 'open')::uuid, 'a tail on the opening post');

  perform tests.become(ann);
  select count(*) into n from my_posts_written_on x where x.play = written and x.post = (w ->> 'open')::uuid and x.opening and not x.failed;
  if n is distinct from 1 then raise exception '5 Ann reads the written tail on her opening post (rows: %)', n; end if;
  perform tests.become(bob);
  if exists (select 1 from my_posts_written_on x where x.play = written) then raise exception '5 Bob reads a tail written on a post that is not his'; end if;
  perform tests.unbecome();
end $$;

-- ---- 6. the counts: an author veil on the opening post moves a spin ----
do $$
declare
  ppl jsonb := pg_temp.people(); bob uuid := (ppl ->> 'bob')::uuid; a uuid := (ppl ->> 'a')::uuid; b uuid := (ppl ->> 'b')::uuid;
  adm uuid := tests.account('rd-admin-' || left(gen_random_uuid()::text, 8));
  stand uuid; w jsonb; veil uuid; a0 jsonb; s0 jsonb; a1 jsonb; s1 jsonb;
begin
  perform pg_temp.cards(); stand := pg_temp.stand();
  insert into admins (account) values (adm);
  w := pg_temp.thread_of(true, ppl);
  a0 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = a) n);
  s0 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = stand) n);
  if a0 is distinct from '{"posts": 0, "spins": 1, "cards": 0}'::jsonb then raise exception '6 the fixture: Ann''s character has written one spin and no post: %', a0; end if;
  perform pg_temp.hand(bob, 'rdveil');
  veil := (play_card(bob, 'rdveil', b, (w ->> 'open')::uuid, '{}', 0, '') ->> 'id')::uuid;
  a1 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = a) n);
  s1 := (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = stand) n);
  if a1 is distinct from jsonb_build_object('posts', a0 -> 'posts', 'spins', (a0 ->> 'spins')::integer - 1, 'cards', a0 -> 'cards') then
    raise exception '6 an author veil on the opening post takes one spin and no post from the author: % (was %)', a1, a0;
  end if;
  if s1 is distinct from jsonb_build_object('posts', s0 -> 'posts', 'spins', (s0 ->> 'spins')::integer + 1, 'cards', s0 -> 'cards') then
    raise exception '6 an author veil on the opening post gives one spin and no post to the stand-in: % (was %)', s1, s0;
  end if;
  perform tests.become(adm); perform reverse_card(veil); perform tests.unbecome();
  if (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = a) n) is distinct from a0
     or (select to_jsonb(n) from (select coalesce(sum(posts), 0) as posts, coalesce(sum(spins), 0) as spins, coalesce(sum(cards), 0) as cards from character_counts_shown where character = stand) n) is distinct from s0 then
    raise exception '6 the counts are whole again when the veil ends';
  end if;
end $$;

-- ---- 7. a writing play on Bob's reply is handed the opening post's words ----
do $$
declare
  ppl jsonb := pg_temp.people(); cat uuid := (ppl ->> 'cat')::uuid; c uuid := (ppl ->> 'c')::uuid; w jsonb; play uuid; got jsonb; job jsonb; ann_name text;
begin
  perform pg_temp.cards();
  w := pg_temp.thread_of(true, ppl);
  ann_name := (select name from characters where id = (ppl ->> 'a')::uuid);
  perform pg_temp.hand(cat, 'rdscribe');
  play := (play_card(cat, 'rdscribe', c, (w ->> 'reply')::uuid, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  perform tests.become_service();
  got := claim_card_writes(10, (w ->> 'reply')::uuid);
  perform tests.unbecome();
  select j into job from jsonb_array_elements(got) j where j ->> 'play' = play::text;
  if job is null then raise exception '7 the writing play on Bob''s reply is claimed: %', got; end if;
  if not exists (select 1 from jsonb_array_elements(job -> 'before') x where x ->> 'name' = ann_name and x ->> 'body' = 'The opening post.') then
    raise exception '7 before holds the opening post''s author and words: %', job -> 'before';
  end if;
end $$;

-- ---- 8. post_kind: where it may be called ----
-- thread_page is a security invoker, and my_cards_ended and my_posts_written_on call post_kind as the role that reads them, so authenticated may execute it. The block asserts that authenticated may and that anon may not; the function reads nothing and takes one text.
do $$
begin
  if not has_function_privilege('authenticated', 'post_kind(text)', 'execute') then raise exception '8 thread_page runs as the signed-in player, so authenticated may execute post_kind'; end if;
  if has_function_privilege('anon', 'post_kind(text)', 'execute') then raise exception '8 a visitor may execute post_kind'; end if;
end $$;

-- ---- 9. post_veils stays insert-only on a restore too ----
-- 0375 turns post_veils_no_update off for its one fill of post_kind and on again. 0357 declared both guards `enable always`, so that they fire under
-- session_replication_role = replica, which is how an import writes; a plain `enable` would leave a veil open to an update or a delete there.
do $$
declare bad text := '';
  r record;
begin
  for r in select t.tgname from pg_trigger t where t.tgrelid = 'public.post_veils'::regclass and t.tgname in ('post_veils_no_update', 'post_veils_no_truncate') and t.tgenabled <> 'A'
  loop bad := bad || format(' trigger %s does not fire always;', r.tgname); end loop;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.post_veils'::regclass and t.tgname in ('post_veils_no_update', 'post_veils_no_truncate')) is distinct from 2 then
    bad := bad || ' an append-only trigger is missing;';
  end if;
  if bad <> '' then raise exception '9 post_veils is insert-only on a restore too:%', bad; end if;
end $$;
