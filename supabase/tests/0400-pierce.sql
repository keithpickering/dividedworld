-- The pierce Gimmick kind (supabase/migrations/0400_pierce.sql; docs/plans/2026-11-20-cheap-shot-plan.md, Task 2; design docs/plans/2026-11-20-cheap-shot-design.md, sections 3.1 to 3.3).
-- A pierce, used on a player's own character, gets that character's next cast past every live ward, and every set card that would catch it, whose card is no rarer than its `upTo`; that cast spends it.
--   * The catalog: card_kinds_gimmick_kind takes 'pierce', and card_kinds_problem refuses a pierce with no or an unknown upTo, on a card that is not a use card, that reaches more than a character, or whose upTo is
--     rarer than the card, each in the engine's words (engine/rules/instance.ts).
--   * The cast: with a pierce up, a common Move lands on a post under an uncommon ward (the ward's rarity is its card's printed one) and its payload names the pierce play, the card and the ward's card; under a rare
--     ward it is turned away as before and the pierce stays live; past a common catching back it lands with no spring and the caster's account (never the setter's) has a `trapStruck` alert with sub `passed`; a rare
--     catching back catches it as before, and a ride back rides as before. A cast spends the pierce (card_ended), so a second finds the ward again. A Use, and a Move landing from a quote, read no pierce.
--   * The probe: card_ended's pierce probe is one lookup of acts_pierce_by; wards_against is the ward_refusal predicate without its limit and is called by no API role.
-- The cards are this file's own (pc...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 6)
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, stack) values
    ('pcpierce', 'Pc Pierce', 'pepperoni', 'uncommon', 'use', null, '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1),
    ('pcward', 'Pc Ward', 'pepperoni', 'uncommon', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
    ('pcwardrare', 'Pc Ward Rare', 'pepperoni', 'rare', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
    ('pcwardb', 'Pc Ward B', 'pepperoni', 'uncommon', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
    ('pcwardx', 'Pc Ward X', 'pepperoni', 'uncommon', 'use', null, '{post,character,thread}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
    ('pcchar', 'Pc Char Cast', 'salty', 'common', 'cast', null, '{character}', interval '1 day', null, 6),
    ('pcthreadc', 'Pc Thread Cast', 'salty', 'common', 'cast', null, '{thread}', interval '1 day', null, 6),
    ('pccatchunc', 'Pc Catch Uncommon', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null, 1),
    ('pcmove', 'Pc Move', 'salty', 'common', 'cast', null, '{post}', null, null, 6),
    ('pccatch', 'Pc Catch', 'salty', 'common', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null, 1),
    ('pccatchrare', 'Pc Catch Rare', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null, 1),
    ('pcride', 'Pc Ride', 'salty', 'common', 'set', '{"trigger": {"on": "cast"}, "outcome": {"kind": "ride", "share": 1, "every": true}}', '{post}', null, null, 1)
  on conflict (key) do nothing;
end $$;

-- The play of a pierce on `who`'s character `ch`, used from the character's own post `from_post`.
create function pg_temp.pierce(who uuid, ch uuid, from_post uuid) returns uuid language sql as $$
  select (play_card(who, 'pcpierce', ch, ch, '{}', 0, '', 'character', from_post) ->> 'id')::uuid
$$;

-- ---- The catalog takes a pierce and refuses each bad one, in the engine's words ----
select tests.unbecome();
do $$
declare
  why text; got text;
  good constant jsonb := '{"key": "pcgood", "rarity": "uncommon", "play": "use", "reaches": ["character"], "lasts": {"unit": "day", "count": 3}, "gimmick": {"kind": "pierce", "upTo": "uncommon"}}';
begin
  -- The table's own constraint takes the kind (the seeded cards above are the rows it let in) and still refuses another.
  if not exists (select 1 from card_kinds where key = 'pcpierce') then perform pg_temp.cards(); end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick) values ('pcbad', 'Pc Bad', 'salty', 'common', 'use', '{character}', interval '1 day', '{"kind": "pierceish", "upTo": "common"}')$q$);
  if why is null or why not like '23514%card_kinds_gimmick_kind%' then raise exception 'a gimmick of an unknown kind was let in the catalog: %', why; end if;

  got := card_kinds_problem(jsonb_build_array(good));
  if got is not null then raise exception 'a good pierce was refused: %', got; end if;

  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{gimmick}', '{"kind": "pierce"}')));
  if got is distinct from 'card "pcgood" has a pierce up to undefined; a rarity is common, uncommon, rare or legendary' then raise exception 'a pierce with no upTo: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{gimmick}', '{"kind": "pierce", "upTo": "mythic"}')));
  if got is distinct from 'card "pcgood" has a pierce up to "mythic"; a rarity is common, uncommon, rare or legendary' then raise exception 'a pierce up to mythic: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{play}', '"cast"')));
  if got is null or got not like '%card "pcgood" has a pierce and is not a use card%' then raise exception 'a pierce on a cast card: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["post"]')));
  if got is distinct from 'card "pcgood" has a pierce and reaches more than a character' then raise exception 'a pierce on a post: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["character", "thread"]')));
  if got is distinct from 'card "pcgood" has a pierce and reaches more than a character' then raise exception 'a pierce on a character and a thread: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{gimmick,upTo}', '"rare"')));
  if got is distinct from 'card "pcgood" has a pierce up to rare, rarer than the card' then raise exception 'a pierce up to rare on an uncommon card: %', got; end if;
  -- A pierce up to a rarity at or below its own is fine, and the kind list's sentence names it.
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{gimmick,upTo}', '"common"')));
  if got is not null then raise exception 'a pierce up to common on an uncommon card was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{gimmick,kind}', '"hex"')));
  if got is distinct from 'card "pcgood" has a gimmick of kind "hex"; a gimmick is ward, earn, price, ride, noQuote, cushion or pierce' then raise exception 'the kinds a gimmick may be: %', got; end if;
end $$;

-- ---- The cast: a pierce gets a Move past a ward whose card is no rarer than its upTo, and the cast spends it ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pc-ann'); bob uuid := tests.account('pc-bob');
  a uuid := tests.character(ann, 'Pc Ann'); b uuid := tests.character(bob, 'Pc Bob');
  t uuid := tests.thread('Pc pierce');
  pa uuid := tests.post(a, t, 'Ann''s own post.');
  w1 uuid := tests.post(b, t, 'Under an uncommon ward.'); w2 uuid := tests.post(b, t, 'Under a rare ward.'); w3 uuid := tests.post(b, t, 'Clean.');
  pierce uuid; pierce2 uuid; ward uuid; c jsonb; cp jsonb; why text; why0 text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pcpierce', 'pcmove', 'pcward');
  perform pg_temp.hand(bob, 'pcward', 'pcwardrare');
  perform tests.become_service();

  ward := (play_card(bob, 'pcward', b, w1, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(bob, 'pcwardrare', b, w2, '{}', 0, '');
  -- With no pierce, the uncommon ward turns the Move away.
  why0 := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcmove', a, w1, '{}', ''));
  if why0 is null or why0 not like '42501%Pc Ward%' then raise exception 'a warded Move with no pierce was not turned away: %', why0; end if;
  perform tests.unbecome();
  if (select count(*) from wards_against('post', w1, (select k from card_kinds k where k.key = 'pcmove'))) is distinct from 1::bigint then raise exception 'wards_against did not name the one ward'; end if;
  perform tests.become_service();

  -- The pierce is played on the caster's own character, from its own post.
  pierce := pg_temp.pierce(ann, a, pa);
  if card_ended(pierce) then raise exception 'a fresh pierce was ended'; end if;
  if exists (select 1 from acts k where k.id = pierce and k.payload ? 'pierce') then raise exception 'a pierce play read a pierce'; end if;

  -- Under a rare ward the Move is turned away with the ward's words, and the pierce is still live.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcmove', a, w2, '{}', ''));
  if why is null or why not like '42501%Pc Ward Rare%turns away cards up to common' then raise exception 'a Move under a rare ward was not turned away: %', why; end if;
  if card_ended(pierce) then raise exception 'a refused cast spent the pierce'; end if;

  -- Under the uncommon ward it lands, names the pierce, its card and the ward's card, and the pierce is spent.
  c := play_card(ann, 'pcmove', a, w1, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce', 'ward', 'pcward') or cp ? 'caught' then raise exception 'the cast past a ward did not name the pierce: %', cp; end if;
  if not card_ended(pierce) then raise exception 'the cast did not spend the pierce'; end if;

  -- A second cast finds the ward again, and has no pierce on it.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcmove', a, w1, '{}', ''));
  if why is null or why not like '42501%Pc Ward%' then raise exception 'a second cast after the pierce was spent got past the ward: %', why; end if;

  -- A character can use another at once, and a cast on a clean post spends it with no ward named.
  pierce2 := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, w3, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'pierce' is distinct from jsonb_build_object('by', pierce2::text, 'card', 'pcpierce') then raise exception 'a cast on a clean post did not name the new pierce alone: %', cp; end if;
  if not card_ended(pierce2) then raise exception 'a cast on a clean post did not spend the pierce'; end if;
  c := play_card(ann, 'pcmove', a, w3, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'pierce' then raise exception 'a cast with no pierce up carried one: %', cp; end if;
end $$;

-- ---- A catching back: a common one is passed (nothing written, nothing told to the setter), a rare one catches as before, a ride back rides as before ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pc-b-ann'); bob uuid := tests.account('pc-b-bob');
  a uuid := tests.character(ann, 'Pc B Ann'); b uuid := tests.character(bob, 'Pc B Bob');
  t uuid := tests.thread('Pc backs');
  pa uuid := tests.post(a, t, 'Ann''s own post.');
  q1 uuid := tests.post(b, t, 'A common back.'); q2 uuid := tests.post(b, t, 'A rare back.'); q3 uuid := tests.post(b, t, 'A ride back.');
  a2 uuid := tests.character(ann, 'Pc B Ann Two'); q4 uuid := tests.post(b, t, 'An uncommon back.'); q5 uuid := tests.post(a2, t, 'Ann''s own other mask''s back.');
  back1 uuid; back2 uuid; back3 uuid; back4 uuid; back5 uuid; pierce uuid; c jsonb; cp jsonb; sp jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pcpierce', 'pcmove');
  perform pg_temp.hand(bob, 'pccatch', 'pccatchrare', 'pcride', 'pccatchunc');
  perform pg_temp.hand(ann, 'pccatch');
  perform tests.become_service();
  back1 := (set_card(bob, 'pccatch', b, q1, '{}', 0, 'pcmove') ->> 'id')::uuid;
  back2 := (set_card(bob, 'pccatchrare', b, q2, '{}', 0, 'pcmove') ->> 'id')::uuid;
  back3 := (set_card(bob, 'pcride', b, q3, '{}', 0, 'pcmove') ->> 'id')::uuid;
  back4 := (set_card(bob, 'pccatchunc', b, q4, '{}', 0, 'pcmove') ->> 'id')::uuid;
  back5 := (set_card(ann, 'pccatch', a2, q5, '{}', 0, 'pcmove') ->> 'id')::uuid;

  -- The common back is passed: the Move lands, no spring is written, the back is still set, and only the caster's account is told, with sub `passed`.
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, q1, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'caught' or cp ->> 'layer' is null or cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce') then raise exception 'the cast past a common back is not a landed cast naming the pierce: %', cp; end if;
  if c ? 'sprung' then raise exception 'the answer carried a spring for a passed back: %', c; end if;
  if exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'set' = back1::text) then raise exception 'a passed back wrote a spring'; end if;
  if not exists (select 1 from face_down f where f.play = back1 and f.ends_at > now()) then raise exception 'a passed back is no longer set'; end if;
  perform tests.unbecome();
  if (select count(*) from alerts where account = ann and kind = 'trapStruck' and sub = 'passed') is distinct from 1::bigint then raise exception 'the caster was not told once that the back was passed: %', (select jsonb_agg(to_jsonb(x)) from alerts x); end if;
  if (select count(*) from alerts where account = ann and kind = 'trapStruck') is distinct from 1::bigint then raise exception 'the caster has another trapStruck'; end if;
  if exists (select 1 from alerts where account = bob and kind in ('trapStruck', 'trapSprang')) then raise exception 'the setter was told of a passed back: %', (select jsonb_agg(to_jsonb(x)) from alerts x where account = bob); end if;
  if exists (select 1 from card_ledger l where l.account = bob and l.kind = 'caught') then raise exception 'a passed back took a card'; end if;
  if not card_ended(pierce) then raise exception 'the cast past a back did not spend the pierce'; end if;
  perform tests.become_service();
  -- With the pierce spent, the same back catches the next Move as it always did.
  c := play_card(ann, 'pcmove', a, q1, '{}', 0, '');
  if c -> 'sprung' -> 'payload' ->> 'did' is distinct from 'caught' then raise exception 'with no pierce the common back did not catch: %', c; end if;

  -- A rare back is not passed by a pierce up to uncommon: it catches, and the pierce is spent by the cast it was named on.
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, q2, '{}', 0, '');
  sp := (select s.payload from acts s where s.kind = 'spring' and s.payload ->> 'set' = back2::text);
  if sp is null or sp ->> 'did' is distinct from 'caught' then raise exception 'a rare back was passed by an uncommon pierce: %', sp; end if;
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ->> 'caught' is null or cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce') then raise exception 'the caught cast did not name the pierce: %', cp; end if;
  if not card_ended(pierce) then raise exception 'a caught cast did not spend the pierce'; end if;

  -- A ride back springs `rode` as before, whatever the pierce.
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, q3, '{}', 0, '');
  sp := (select s.payload from acts s where s.kind = 'spring' and s.payload ->> 'set' = back3::text);
  if sp is null or sp ->> 'did' is distinct from 'rode' then raise exception 'a ride back did not ride under a pierce: %', sp; end if;
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ->> 'rode' is distinct from back3::text or cp -> 'pierce' ->> 'by' is distinct from pierce::text then raise exception 'the ridden cast: %', cp; end if;

  -- The boundary: an UNCOMMON back is passed by an uncommon pierce (a back no rarer than the pierce's upTo), so the test is at or below, not below.
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, q4, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'caught' or cp ->> 'layer' is null or cp -> 'pierce' ->> 'by' is distinct from pierce::text then raise exception 'an uncommon back was not passed by an uncommon pierce: %', cp; end if;
  if exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'set' = back4::text) then raise exception 'a passed uncommon back wrote a spring'; end if;
  if not exists (select 1 from face_down f where f.play = back4 and f.ends_at > now()) then raise exception 'a passed uncommon back is no longer set'; end if;

  -- The setter is the caster's own other mask: the pass is the same, and the caster is told as for any back (the alert reads no setter).
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, q5, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'caught' or cp ->> 'layer' is null or cp -> 'pierce' ->> 'by' is distinct from pierce::text then raise exception 'a back of one''s own other mask was not passed: %', cp; end if;
  if exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'set' = back5::text) then raise exception 'a passed own-mask back wrote a spring'; end if;
  perform tests.unbecome();
  if (select count(*) from alerts where account = ann and kind = 'trapStruck' and sub = 'passed') is distinct from 3::bigint then raise exception 'the caster was not told of each passed back (common, uncommon, own mask): %', (select jsonb_agg(to_jsonb(x)) from alerts x where account = ann); end if;
end $$;

-- ---- The reach branch, the oldest ward named, and a staff caster ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pc-r-ann'); bob uuid := tests.account('pc-r-bob');
  a uuid := tests.character(ann, 'Pc R Ann'); b uuid := tests.character(bob, 'Pc R Bob');
  t uuid := tests.thread('Pc reach');
  pa uuid := tests.post(a, t, 'Ann''s own post.'); bfirst uuid := tests.post(b, t, 'Bob started this.');
  two uuid := tests.post(b, t, 'Two live wards.');
  tb uuid := tests.thread('Pc reach, Bob''s thread'); tbfirst uuid := tests.post(b, tb, 'Bob started this thread.');
  pierce uuid; c jsonb; cp jsonb; why text; ward_play uuid; staff uuid; r jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pcpierce', 'pcchar', 'pcthreadc', 'pcmove');
  perform pg_temp.hand(bob, 'pcwardx');
  perform tests.become_service();

  -- A ward on Bob's character turns a character cast away; a pierce gets it past, names the ward, and is spent.
  ward_play := (play_card(bob, 'pcwardx', b, b, '{}', 0, '', 'character', bfirst) ->> 'id')::uuid;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'pcchar', a, b, '{}', '', 'character', bfirst));
  if why is null or why not like '42501%Pc Ward X%' then raise exception 'a character cast under a character ward with no pierce: %', why; end if;
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcchar', a, b, '{}', 0, '', 'character', bfirst);
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce', 'ward', 'pcwardx') then raise exception 'the character cast past a ward did not name the pierce: %', cp; end if;
  if not card_ended(pierce) then raise exception 'the character cast did not spend the pierce'; end if;

  -- The same at a thread: Bob's own thread is warded, a thread cast is turned away, and under a pierce it lands.
  perform play_card(bob, 'pcwardx', b, tb, '{}', 0, '', 'thread', tbfirst);
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'pcthreadc', a, tb, '{}', '', 'thread'));
  if why is null or why not like '42501%Pc Ward X%' then raise exception 'a thread cast under a thread ward with no pierce: %', why; end if;
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcthreadc', a, tb, '{}', 0, '', 'thread');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce', 'ward', 'pcwardx') then raise exception 'the thread cast past a ward did not name the pierce: %', cp; end if;
  if not card_ended(pierce) then raise exception 'the thread cast did not spend the pierce'; end if;
  perform tests.unbecome();

  -- Two live wards on a post, both passed: the older one is named. The newer ward (pcward, played a day ago) is inserted first and the older (pcwardb, played two days ago) second, so insertion order disagrees with created_at.
  perform tests.act(b, 'card', t, jsonb_build_object('card', 'pcward', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), two, now() - interval '1 day');
  perform tests.act(b, 'card', t, jsonb_build_object('card', 'pcwardb', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), two, now() - interval '2 days');
  perform tests.become_service();
  pierce := pg_temp.pierce(ann, a, pa);
  c := play_card(ann, 'pcmove', a, two, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'pierce' is distinct from jsonb_build_object('by', pierce::text, 'card', 'pcpierce', 'ward', 'pcwardb') then raise exception 'the oldest of two passed wards was not the one named: %', cp; end if;

  -- A staff caster reads no pierce: a pierce is up on a character that is a staff character's (set up by hand, since no player can play one there), and its cast is still turned away by the ward.
  perform tests.unbecome();
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pc R Staff', 'pc-r-staff', 'persona', now()) returning id into staff;
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.act(staff, 'card', t, jsonb_build_object('card', 'pcpierce', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '3 days', 'reach', 'character', 'character', staff), pa);
  perform set_config('kayfabb.staff_writer', '', true);
  insert into play_reach (play, reach, character, ends_at)
    select k.id, 'character', staff, now() + interval '3 days' from acts k where k.character = staff and k.kind = 'card' and k.payload ->> 'card' = 'pcpierce';
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}}, "turns": {"waitHours": 48, "perThread": 2, "perSession": 4}, "charsPerDay": 780000, "readMost": 40000, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  perform tests.become_service();
  why := pg_temp.coded(format('select staff_play_card(%L, %L, %L)', 'pc-r-staff', 'pcmove', two));
  if why is null or why not like '42501%turns away%' then raise exception 'a staff cast read a pierce and got past a ward: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- A Use and a Move landing from a quote read no pierce; the probe is one lookup of its index; the helper is no API's ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pc-u-ann'); bob uuid := tests.account('pc-u-bob');
  a uuid := tests.character(ann, 'Pc U Ann'); b uuid := tests.character(bob, 'Pc U Bob');
  t uuid := tests.thread('Pc uses');
  pa uuid := tests.post(a, t, 'Ann''s own post. The punchline, and zebra stripes.'); pa2 uuid := tests.post(a, t, 'Ann''s other post.');
  pierce uuid; use_play uuid; the_set uuid; quoting uuid; landed jsonb; plan_line text; plan_text text := '';
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pcpierce', 'pcmove', 'pcward');
  perform tests.become_service();
  pierce := pg_temp.pierce(ann, a, pa);

  -- A Use by the pierce's own caster leaves it live and carries no pierce.
  use_play := (play_card(ann, 'pcward', a, pa2, '{}', 0, '') ->> 'id')::uuid;
  if card_ended(pierce) or exists (select 1 from acts k where k.id = use_play and k.payload ? 'pierce') then raise exception 'a Use read or spent the pierce'; end if;

  -- A Move set face down on Ann's own post, landing from Bob's quote, leaves it live too and carries no pierce.
  the_set := (set_card(ann, 'pcmove', a, pa, '{}', 0) ->> 'id')::uuid;
  quoting := tests.post(b, t, 'Quoting. [quote=' || pa || ']the punchline[/quote]');
  perform tests.unbecome();
  landed := spring_traps('quote', pa, quoting);
  if landed is null or landed -> 'payload' ->> 'did' is distinct from 'landed' then raise exception 'the Move did not land from the quote: %', landed; end if;
  if card_ended(pierce) then raise exception 'a Move landing from a quote spent the pierce'; end if;
  if exists (select 1 from acts k where k.kind = 'card' and k.thread = t and k.payload ? 'pierce') then raise exception 'a Use or a landed Move carries a pierce'; end if;

  -- The probe of a spent pierce is one lookup of acts_pierce_by (a partial expression index), not a scan of the Acts.
  -- It is judged on the Acts of a board that has been played on, analyzed here: a fresh instance's `acts` holds a handful of
  -- rows with no statistics, on which the planner prefers another partial index (acts_origin_plays) for the same kinds.
  insert into acts (character, kind, thread, payload) select a, 'post', t, jsonb_build_object('body', 'Filler ' || g) from generate_series(1, 3000) g;
  analyze acts;
  perform set_config('enable_seqscan', 'off', true);
  for plan_line in execute format($q$explain select 1 from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = %L$q$, pierce::text) loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  perform set_config('enable_seqscan', 'on', true);
  if plan_text not like '%acts_pierce_by%' then raise exception 'the pierce probe does not use acts_pierce_by: %', plan_text; end if;
  raise notice 'pierce probe plan: %', plan_text;

  -- wards_against is no API role's, as ward_refusal is not.
  if has_function_privilege('authenticated', 'wards_against(text, uuid, card_kinds)', 'execute') or has_function_privilege('anon', 'wards_against(text, uuid, card_kinds)', 'execute')
     or has_function_privilege('service_role', 'wards_against(text, uuid, card_kinds)', 'execute') then raise exception 'wards_against is granted to an API role'; end if;
  if has_function_privilege('authenticated', 'ward_refusal(text, uuid, card_kinds, text)', 'execute') or has_function_privilege('service_role', 'ward_refusal(text, uuid, card_kinds, text)', 'execute') then raise exception 'ward_refusal is granted to an API role'; end if;
  if has_function_privilege('authenticated', 'spring_traps(text, uuid, uuid, text, uuid[], uuid, text, uuid)', 'execute') or has_function_privilege('service_role', 'spring_traps(text, uuid, uuid, text, uuid[], uuid, text, uuid)', 'execute') then raise exception 'spring_traps is granted to an API role'; end if;
  -- card_ended keeps the grant it had.
  if not has_function_privilege('authenticated', 'card_ended(uuid)', 'execute') then raise exception 'card_ended lost its grant'; end if;
end $$;
