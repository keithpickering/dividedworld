-- A ward Gimmick everywhere a card lands, and a Gimmick on one's own thread (supabase/migrations/0146_card_types.sql; docs/plans/2026-11-11-card-types-design.md,
-- section 5; plan Task 3). A live ward Gimmick on a cast's own target (a post, a character or a thread) turns the cast away when the card's rarity is at or below
-- its `upTo`, its printed flavor is in `flavors`, or its key is in `cards`, in the same words for every caster (cards.ts's wardWords); a Gimmick goes on a thread only if
-- one of the caster's own characters started it, and never on a board. The cards are this file's own (gw...), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The refusal's code too: a ward's is 42501.
create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('gwsalt', 'Salt Sieve', 'sweet', 'common', 'use', interval '7 days', '{post,character,thread}', '{"kind": "ward", "flavors": ["salty"]}'),
    ('gwname', 'Name Ward', 'sweet', 'common', 'use', interval '7 days', '{post}', '{"kind": "ward", "cards": ["sweetie"]}'),
    ('gwrare', 'Force Field', 'sweet', 'uncommon', 'use', interval '7 days', '{post}', '{"kind": "ward", "upTo": "uncommon"}'),
    ('gwvibes', 'Good Vibes', 'sweet', 'common', 'use', interval '1 day', '{post,character,thread}', '{"kind": "price", "flavors": ["salty"], "add": 100}'),
    ('gwboard', 'Board Vibes', 'sweet', 'common', 'use', interval '1 day', '{board}', '{"kind": "price", "flavors": ["salty"], "add": 100}'),
    ('gwchar', 'Gw Char Cast', 'salty', 'uncommon', 'cast', interval '1 day', '{character}', null),
    ('gwcharsweet', 'Gw Char Sweet', 'sweet', 'uncommon', 'cast', interval '1 day', '{character}', null),
    ('gwthread', 'Gw Thread Cast', 'salty', 'rare', 'cast', interval '1 day', '{thread}', null),
    ('gwmove', 'Gw Move', 'salty', 'uncommon', 'cast', null, '{post}', null),
    ('gwcrare', 'Rarity Ward', 'sweet', 'uncommon', 'use', interval '7 days', '{post,character,thread}', '{"kind": "ward", "upTo": "uncommon"}'),
    ('gwcname', 'Card Ward', 'sweet', 'uncommon', 'use', interval '7 days', '{post,character,thread}', '{"kind": "ward", "cards": ["gwchar", "gwthread"]}'),
    ('gwcharrare', 'Gw Char Rare', 'sweet', 'rare', 'cast', interval '1 day', '{character}', null),
    ('gwthreadlow', 'Gw Thread Low', 'sweet', 'common', 'cast', interval '1 day', '{thread}', null),
    ('gwthreadtop', 'Gw Thread Top', 'sweet', 'legendary', 'cast', interval '1 day', '{thread}', null)
  on conflict (key) do nothing;
end $$;

-- ---- A ward on a post: by flavor, by name and by rarity, each in its own words; a card it does not name lands ----
do $$
declare
  ann uuid := tests.account('gw-ann'); bob uuid := tests.account('gw-bob');
  a uuid := tests.character(ann, 'Gw Ann'); b uuid := tests.character(bob, 'Gw Bob');
  t uuid := tests.thread('Gw posts');
  p1 uuid := tests.post(a, t, 'Salt-warded.'); p2 uuid := tests.post(a, t, 'Name-warded.'); p3 uuid := tests.post(a, t, 'Rarity-warded.');
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'gwsalt', 'gwname', 'gwrare');
  perform pg_temp.hand(bob, 'blot', 'blot', 'sweetie', 'sweetie', 'sweetie', 'gwmove');
  perform tests.become_service();
  perform play_card(ann, 'gwsalt', a, p1, '{}', 0, '');
  perform play_card(ann, 'gwname', a, p2, '{}', 0, '');
  perform play_card(ann, 'gwrare', a, p3, '{}', 0, '');
  -- A Salty-flavor ward turns away a Salty cast, in the same words for anyone, and passes a Sweet one.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'blot', b, p1, '{}', ''));
  if why is distinct from '42501 this post''s Salt Sieve turns away Salty cards' then raise exception 'a Salty cast under a Salty ward: %', why; end if;
  perform play_card(bob, 'sweetie', b, p1, '{}', 0, '');
  -- A name ward turns away the named card and no other.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p2, '{}', ''));
  if why is distinct from '42501 this post''s Name Ward turns away Sweetie' then raise exception 'a named cast under a name ward: %', why; end if;
  perform play_card(bob, 'blot', b, p2, '{}', 0, '');
  -- A rarity ward turns away a common cast and passes a rarer one.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p3, '{}', ''));
  if why is distinct from '42501 this post''s Force Field turns away cards up to uncommon' then raise exception 'a common cast under a rarity ward: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- A ward on a character turns away a character cast; a ward on a thread turns away a thread cast and not a cast on a post under it ----
do $$
declare
  ann uuid := tests.account('gw-char-ann'); bob uuid := tests.account('gw-char-bob');
  a uuid := tests.character(ann, 'Gw Char Ann'); b uuid := tests.character(bob, 'Gw Char Bob');
  t uuid := tests.thread('Gw ward on a thread');
  first_post uuid := tests.post(a, t, 'Ann started this thread.');
  under uuid := tests.post(a, t, 'A post under the warded thread.');
  bobs uuid := tests.post(b, t, 'Bob''s post.');
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'gwsalt', 'gwsalt');
  perform pg_temp.hand(bob, 'gwchar', 'gwcharsweet', 'gwthread', 'blot');
  perform tests.become_service();
  -- On a character: Ann's character carries the sieve; Bob's Salty character cast is turned away, in the character's words, and a Sweet one lands.
  perform play_card(ann, 'gwsalt', a, a, '{}', 0, '', 'character', under);
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'gwchar', b, a, '{}', '', 'character', under));
  if why is distinct from '42501 this character''s Salt Sieve turns away Salty cards' then raise exception 'a Salty character cast under a ward on the character: %', why; end if;
  perform play_card(bob, 'gwcharsweet', b, a, '{}', 0, '', 'character', under);
  -- On a thread: Ann started it, so Ann may ward it; a Salty thread cast is turned away, and a Salty cast on a post under it lands, since a ward refuses on its own target only.
  perform play_card(ann, 'gwsalt', a, t, '{}', 0, '', 'thread', first_post);
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'gwthread', b, t, '{}', '', 'thread'));
  if why is distinct from '42501 this thread''s Salt Sieve turns away Salty cards' then raise exception 'a Salty thread cast under a ward on the thread: %', why; end if;
  perform play_card(bob, 'blot', b, under, '{}', 0, '');
  perform tests.unbecome();
end $$;

-- ---- Rarity and name wards beyond a post, a rarer card passing, and a ward on another target refusing nothing ----
do $$
declare
  ann uuid := tests.account('gw-rn-ann'); bob uuid := tests.account('gw-rn-bob');
  a uuid := tests.character(ann, 'Gw Rn Ann'); a3 uuid := tests.character(ann, 'Gw Rn Ann Three'); b uuid := tests.character(bob, 'Gw Rn Bob');
  t1 uuid := tests.thread('Gw rarity thread'); t2 uuid := tests.thread('Gw name thread');
  a_post uuid := tests.post(a, t1, 'Rarity-warded thread and character.'); a3_post uuid := tests.post(a3, t2, 'Name-warded thread and character.');
  bobs uuid := tests.post(b, t1, 'Bob''s post.');
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'gwcrare', 'gwcrare', 'gwcname', 'gwcname');
  perform pg_temp.hand(bob, 'gwcharsweet', 'gwcharrare', 'gwchar', 'gwthreadlow', 'gwthreadtop', 'gwthread');
  perform tests.become_service();
  perform play_card(ann, 'gwcrare', a, a, '{}', 0, '', 'character', a_post);
  perform play_card(ann, 'gwcrare', a, t1, '{}', 0, '', 'thread');
  perform play_card(ann, 'gwcname', a3, a3, '{}', 0, '', 'character', a3_post);
  perform play_card(ann, 'gwcname', a3, t2, '{}', 0, '', 'thread');
  -- Rarity, on a character: an uncommon cast is turned away, a rare one lands.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'gwcharsweet', b, a, '{}', '', 'character', a_post));
  if why is distinct from '42501 this character''s Rarity Ward turns away cards up to uncommon' then raise exception 'an uncommon cast on a rarity-warded character: %', why; end if;
  perform play_card(bob, 'gwcharrare', b, a, '{}', 0, '', 'character', a_post);
  -- Rarity, on a thread: a common cast is turned away, a legendary one lands.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'gwthreadlow', b, t1, '{}', '', 'thread'));
  if why is distinct from '42501 this thread''s Rarity Ward turns away cards up to uncommon' then raise exception 'a common cast on a rarity-warded thread: %', why; end if;
  perform play_card(bob, 'gwthreadtop', b, t1, '{}', 0, '', 'thread');
  -- Name, on a character and on a thread: the named card is turned away in its own words; ward on another target refuses nothing (a3 holds no rarity ward, t2 none).
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'gwchar', b, a3, '{}', '', 'character', a3_post));
  if why is distinct from '42501 this character''s Card Ward turns away Gw Char Cast' then raise exception 'a named cast on a card-warded character: %', why; end if;
  perform play_card(bob, 'gwcharsweet', b, a3, '{}', 0, '', 'character', a3_post);
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'gwthread', b, t2, '{}', '', 'thread'));
  if why is distinct from '42501 this thread''s Card Ward turns away Gw Thread Cast' then raise exception 'a named cast on a card-warded thread: %', why; end if;
  perform play_card(bob, 'gwthreadlow', b, t2, '{}', 0, '', 'thread');
  perform tests.unbecome();
end $$;

-- ---- A dead ward lets the cast through; one ward matching several ways says rarity first; of two live wards the oldest is named ----
do $$
declare
  ann uuid := tests.account('gw-dead-ann'); bob uuid := tests.account('gw-dead-bob');
  a uuid := tests.character(ann, 'Gw Dead Ann'); b uuid := tests.character(bob, 'Gw Dead Bob');
  t uuid := tests.thread('Gw dead wards');
  by_time uuid := tests.post(a, t, 'Ward ended by its time.'); by_end uuid := tests.post(a, t, 'Ward ended by an admin.'); by_catch uuid := tests.post(a, t, 'Ward marked caught.');
  both_ways uuid := tests.post(a, t, 'Ward matching by rarity, flavor and name.'); two uuid := tests.post(a, t, 'Two live wards.'); dead_char uuid := tests.post(a, t, 'Ended ward on a character.');
  w uuid;
  why text;
begin
  perform pg_temp.cards();
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('gwall', 'All Ways', 'sweet', 'common', 'use', interval '7 days', '{post}', '{"kind": "ward", "upTo": "common", "flavors": ["salty"], "cards": ["blot"]}'),
    ('gwflname', 'Flavor And Name', 'sweet', 'common', 'use', interval '7 days', '{post}', '{"kind": "ward", "flavors": ["salty"], "cards": ["blot"]}')
  on conflict (key) do nothing;
  perform pg_temp.hand(bob, 'blot', 'blot', 'blot', 'blot', 'blot', 'blot');
  -- A ward past its time (as a stored play, written as play_card would have written it then).
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'gwsalt', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() - interval '1 second'), by_time, now() - interval '7 days');
  -- A ward an admin ended (a card_end Act, as reverse_card writes it).
  w := tests.act(a, 'card', t, jsonb_build_object('card', 'gwsalt', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), by_end);
  perform set_config('kayfabb.card_end_writer', 'on', true);
  perform tests.act(null, 'card_end', t, '{"why": "reversed", "by": "admin"}', w);
  perform set_config('kayfabb.card_end_writer', '', true);
  -- A play marked caught holds no place.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'gwsalt', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'caught', gen_random_uuid()::text, 'ends', now() + interval '7 days'), by_catch);
  perform tests.become_service();
  perform play_card(bob, 'blot', b, by_time, '{}', 0, '');
  perform play_card(bob, 'blot', b, by_end, '{}', 0, '');
  perform play_card(bob, 'blot', b, by_catch, '{}', 0, '');
  perform tests.unbecome();
  -- One ward matching all three ways says rarity; matching flavor and name says flavor.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'gwall', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), both_ways);
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'gwflname', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), two, now() - interval '2 days');
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'gwall', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), two, now() - interval '1 day');
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'blot', b, both_ways, '{}', ''));
  if why is distinct from '42501 this post''s All Ways turns away cards up to common' then raise exception 'a ward matching three ways says rarity first: %', why; end if;
  -- Two live wards both match a Salty common cast: the older one, by flavor, is named, not the newer one's rarity.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'blot', b, two, '{}', ''));
  if why is distinct from '42501 this post''s Flavor And Name turns away Salty cards' then raise exception 'two live wards name the oldest: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- A Gimmick on a thread: the thread's first post is by the caster's own character, else refused; never on a board ----
do $$
declare
  ann uuid := tests.account('gw-own-ann'); bob uuid := tests.account('gw-own-bob');
  a uuid := tests.character(ann, 'Gw Own Ann'); a2 uuid := tests.character(ann, 'Gw Own Ann Two'); b uuid := tests.character(bob, 'Gw Own Bob');
  anns uuid := tests.thread('Ann''s thread'); bobs uuid := tests.thread('Bob''s thread');
  anns_first uuid := tests.post(a, anns, 'Ann started this.'); bobs_first uuid := tests.post(b, bobs, 'Bob started this.');
  played jsonb;
  why text;
  general uuid := (select id from boards where slug = 'general');
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'gwvibes', 'gwvibes', 'gwvibes', 'gwboard');
  perform pg_temp.hand(bob, 'gwvibes');
  perform tests.become_service();
  -- Refused on another character's thread, in plain words, the same whoever asks.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'gwvibes', a, bobs, '{}', '', 'thread'));
  if why is distinct from '42501 Good Vibes is used on a thread your own character started' then raise exception 'Good Vibes on another character''s thread: %', why; end if;
  if exists (select 1 from acts where kind = 'card' and thread = bobs) or (select count(*) from card_ledger where account = ann and kind = 'played') is distinct from 0 then raise exception 'a refused Gimmick wrote something'; end if;
  -- Only the character that started the thread may use a Gimmick on it, not another of the same player's characters: "your own character" is the caster's.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'gwvibes', a2, anns, '{}', '', 'thread'));
  if why is distinct from '42501 Good Vibes is used on a thread your own character started' then raise exception 'Good Vibes by another mask on this thread: %', why; end if;
  played := play_card(ann, 'gwvibes', a, anns, '{}', 0, '', 'thread');
  if played -> 'payload' ->> 'reach' is distinct from 'thread' or played -> 'payload' ->> 'thread' is distinct from anns::text then raise exception 'a Gimmick on one''s own thread lands there: %', played; end if;
  if not exists (select 1 from play_reach r where r.play = (played ->> 'id')::uuid and r.reach = 'thread' and r.thread = anns) then raise exception 'a Gimmick on a thread has its reach row'; end if;
  -- A use card at board reach is refused, whoever asks. No card in the catalog lists a board for a use card (card_kinds_problem refuses one), so this one is inserted by hand.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'gwboard', a, general, '{}', '', 'board'));
  if why is distinct from '22023 Board Vibes is never used on a board' then raise exception 'a use card on a board: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- A Move set face down does not land through a flavor ward on the quoting post (spring_facts, step 4b), and lands once the ward is gone ----
do $$
declare
  ann uuid := tests.account('gw-sp-ann'); bob uuid := tests.account('gw-sp-bob');
  a uuid := tests.character(ann, 'Gw Sp Ann'); b uuid := tests.character(bob, 'Gw Sp Bob');
  t uuid := tests.thread('Gw spring');
  p uuid := tests.post(a, t, 'A Move under this.');
  warded uuid := tests.post(b, t, 'Salt-warded quoting post.'); free uuid := tests.post(b, t, 'Unwarded quoting post.');
  the_set uuid; sprang jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'gwmove'); perform pg_temp.hand(bob, 'gwsalt');
  perform tests.become_service();
  the_set := (set_card(ann, 'gwmove', a, p, '{}', 0) ->> 'id')::uuid;
  perform play_card(bob, 'gwsalt', b, warded, '{}', 0, '');
  perform tests.unbecome();
  sprang := spring_traps('quote', p, warded);
  if sprang is not null or exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'set' = the_set::text) then raise exception 'a Salty Move landed through a Salty ward'; end if;
  sprang := spring_traps('quote', p, free);
  if sprang is null or not exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'set' = the_set::text) then raise exception 'an unwarded quote did not land the Move'; end if;
end $$;
