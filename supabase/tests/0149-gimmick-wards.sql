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
    ('gwmove', 'Gw Move', 'salty', 'uncommon', 'cast', null, '{post}', null)
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
  -- Accepted on one's own, by the character that started it and by another of the player's characters? Only the character that started it: "your own character" is the caster's.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'gwvibes', a2, anns, '{}', '', 'thread'));
  if why is distinct from '42501 Good Vibes is used on a thread your own character started' then raise exception 'Good Vibes by another mask on this thread: %', why; end if;
  played := play_card(ann, 'gwvibes', a, anns, '{}', 0, '', 'thread');
  if played -> 'payload' ->> 'reach' is distinct from 'thread' or played -> 'payload' ->> 'thread' is distinct from anns::text then raise exception 'a Gimmick on one''s own thread lands there: %', played; end if;
  if not exists (select 1 from play_reach r where r.play = (played ->> 'id')::uuid and r.reach = 'thread' and r.thread = anns) then raise exception 'a Gimmick on a thread has its reach row'; end if;
  -- A use card at board reach is refused, whoever asks.
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
