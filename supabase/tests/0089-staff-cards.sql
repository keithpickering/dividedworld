-- The staff card path (supabase/migrations/0086_staff_cards.sql; the staff roster design, section 7; its plan, Task 7).
-- A pool persona plays a card through staff_play_card and staff_set_card, which take the same rules a player's play does (place_cast and
-- place_set, the inner halves of play_card and set_card), pay nothing, and refuse a persona that is waiting or benched, a card above
-- `pool.cardRarityMost`, and a Set whose trap pays out. A player's trap that catches a staff Cast pays the card's base price as a wallet
-- event of kind 'trapSystem'. A trap set by staff springs on a player's write without refusing it, and the staff flag the spring opens is
-- closed again before the player's own Act is checked. The poisons: a staff Cast with a payer is refused (the staff writer passes none),
-- and a spring on a staff trap with the flag left closed refuses the player's reply (red before spring_traps opens it).

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sc-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'sc-boss', 'name', 'Sc Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'sc-mod', 'name', 'Sc Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'sc-wait', 'name', 'Sc Wait', 'title', 'Waiting', 'signature', 'c'),
        jsonb_build_object('key', 'sc-bench', 'name', 'Sc Bench', 'title', 'Bench', 'signature', 'd')),
      'firstStaff', jsonb_build_array('sc-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  -- A persona on the bench: debuted, then benched by the office log (cause admin, no admin named).
  update characters set debuted_at = now() where staff = 'sc-bench';
  insert into staff_offices (staff, office, cause) values ('sc-bench', 'benched', 'admin');
  -- The pool plays up to uncommon.
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, trap, ward, lasts) values
    ('snare', 'Snare', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "payout"}}', false, null),
    ('catcher', 'Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}', false, null),
    ('bluffy', 'Bluffy', 'pepperoni', 'common', 'set', null, false, null),
    ('grandie', 'Grandie', 'sweet', 'legendary', 'cast', null, false, null),
    ('shield', 'Shield', 'sweet', 'uncommon', 'use', null, true, interval '7 days'),
    ('hook', 'Hook', 'salty', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}', false, null);
  -- What each is worth to a trap that catches a staff Cast of it is its slot's price (place_cast, 0115).
  insert into machine_slots (position, card, availability, price) values
    (21, 'snare', 'onSale', 150), (22, 'catcher', 'onSale', 100), (23, 'bluffy', 'onSale', 25), (24, 'grandie', 'onSale', 100), (25, 'shield', 'onSale', 150), (26, 'hook', 'onSale', 100);
end $$;

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;
create function pg_temp.staff_char(k text) returns uuid language sql as $$ select id from characters where staff = k $$;
create function pg_temp.staff_post(k text, in_thread uuid, body text) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, null, jsonb_build_object('body', body)) ->> 'id')::uuid
$$;

-- ---- A staff Cast lands as a player's does: layers, the stack, wards; and it costs nothing and is nobody's ----
do $$
declare
  ann uuid := tests.account('sc-ann'); a uuid := tests.character(ann, 'Sc Ann');
  t uuid := tests.thread('Staff casts');
  p uuid := tests.post(a, t, 'A post for a Cast.'); p2 uuid := tests.post(a, t, 'A warded post.'); p3 uuid := tests.post(a, t, 'For a Blot.');
  r jsonb; said text; layer2 jsonb;
begin
  perform pg_temp.hand(ann, 'shield');
  perform tests.become_service();
  r := staff_play_card('sc-mod', 'sweetie', p, '{}', 'Sweet of me.');
  perform tests.unbecome();
  if (select a2.kind || ':' || a2.character::text || ':' || a2.target_act_id::text from acts a2 where a2.id = (r ->> 'id')::uuid)
       is distinct from 'card:' || pg_temp.staff_char('sc-mod')::text || ':' || p::text then
    raise exception 'a staff Cast is a card Act by the persona on the post: %', r;
  end if;
  if r -> 'payload' ->> 'card' is distinct from 'sweetie' or r -> 'payload' ->> 'message' is distinct from 'Sweet of me.' or (r -> 'payload' ->> 'layer')::int is distinct from 1 then
    raise exception 'a staff Cast carries its card, message and first layer: %', r;
  end if;
  if exists (select 1 from card_ledger where act = (r ->> 'id')::uuid) or exists (select 1 from wallet_events where ref = (r ->> 'id')::uuid) then
    raise exception 'a staff Cast was charged to a ledger or a wallet';
  end if;
  -- Its stack: Sweetie takes one to a post, in the words a player gets.
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'sweetie', p));
  perform tests.unbecome();
  if said is null or said !~ '^23505 this post already carries that card' then raise exception 'a second Sweetie on one post: %', said; end if;
  -- Blot takes three: the layers go on, each drawn from a seed the server chooses.
  perform tests.become_service();
  r := staff_play_card('sc-mod', 'blot', p3, '{"color": "red"}');
  layer2 := staff_play_card('sc-boss', 'blot', p3, '{"color": "blue"}');
  perform tests.unbecome();
  if (r -> 'payload' ->> 'layer')::int is distinct from 1 or (layer2 -> 'payload' ->> 'layer')::int is distinct from 2 or not (r -> 'payload' ? 'seed') then
    raise exception 'staff Blots take layers 1 and 2, seeded: % / %', r, layer2;
  end if;
  -- A ward: a Shield the post's author used turns a staff Cast away as it would a player's.
  perform play_card(ann, 'shield', a, p2, '{}', 0, '');
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'sweetie', p2));
  perform tests.unbecome();
  if said is null or said !~ '^42501 this post''s Shield turns away cards up to uncommon' then raise exception 'a warded post took a staff Cast: %', said; end if;
  -- The message and a post that is not a post are refused as for a player.
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L, %L, %L)', 'sc-mod', 'blot', p3, '{}', repeat('x', 201)));
  perform tests.unbecome();
  if said is null or said !~ '^22001' then raise exception 'a 201-character message: %', said; end if;
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'sweetie', t));
  perform tests.unbecome();
  if said is null then raise exception 'a staff Cast landed on something that is not a post'; end if;
  -- A card that is a Set is not played here, and a card that does not exist is no card.
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'bluffy', p));
  perform tests.unbecome();
  if said is null or said !~ 'set face down' then raise exception 'a Set was played as a Cast: %', said; end if;
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'no-such-card', p));
  perform tests.unbecome();
  if said is null or said !~ '^P0002' then raise exception 'a card that does not exist was played: %', said; end if;
end $$;

-- ---- A staff Set of a Bluff lands face down, for no one; a Set that pays out is refused; so is a rare card ----
do $$
declare
  ann uuid := tests.account('sc-ann2'); a uuid := tests.character(ann, 'Sc Ann Two');
  t uuid := tests.thread('Staff sets');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post to set a card on.'); sp2 uuid := pg_temp.staff_post('sc-mod', t, 'And a second one.');
  pp uuid := tests.post(a, t, 'A player''s post.');
  r jsonb; said text; before_acts bigint;
begin
  perform tests.become_service();
  r := staff_set_card('sc-mod', 'bluffy', sp);
  perform tests.unbecome();
  if (select x.kind || ':' || x.character::text || ':' || x.target_act_id::text from acts x where x.id = (r ->> 'id')::uuid) is distinct from 'set:' || pg_temp.staff_char('sc-mod')::text || ':' || sp::text then
    raise exception 'a staff Set is a set Act by the persona on its own post: %', r;
  end if;
  if r::text like '%bluffy%' then raise exception 'a staff Set names its card: %', r; end if;
  if (select f.card || ':' || coalesce(f.account::text, 'none') from face_down f where f.play = (r ->> 'id')::uuid) is distinct from 'bluffy:none' then
    raise exception 'a staff Set is a face-down row with no account';
  end if;
  if not exists (select 1 from face_down_reply fr where fr.play = (r ->> 'id')::uuid) then raise exception 'a staff Set has no reply moment'; end if;
  if exists (select 1 from card_ledger where act = (r ->> 'id')::uuid) then raise exception 'a staff Set was charged'; end if;
  -- One card face down to a post; and only on the persona's own post.
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'bluffy', sp));
  perform tests.unbecome();
  if said is null or said !~ '^23505 this post already holds a card face down' then raise exception 'a second card on one back: %', said; end if;
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'bluffy', pp));
  perform tests.unbecome();
  if said is null or said !~ '^42501' then raise exception 'a staff Set on a player''s post: %', said; end if;
  -- A trap that pays out is not offered: a staff character has no wallet. Nothing is written.
  select count(*) into before_acts from acts where kind = 'set';
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'snare', sp2));
  perform tests.unbecome();
  if said is null or said !~ '^55000 Snare pays out' then raise exception 'a staff Set of Trap Card (a payout trap): %', said; end if;
  if (select count(*) from acts where kind = 'set') is distinct from before_acts then raise exception 'a refused staff Set wrote an Act'; end if;
  -- A nullify trap is allowed: it pays nobody. Rare is above uncommon.
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'catcher', sp2));
  perform tests.unbecome();
  if said is null or said !~ '^55000 Catcher is above the rarity the pool plays' then raise exception 'a rare Set under an uncommon cap: %', said; end if;
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'grandie', pp));
  perform tests.unbecome();
  if said is null or said !~ '^55000 Grandie is above the rarity the pool plays' then raise exception 'a legendary Cast under an uncommon cap: %', said; end if;
  -- The cap moves with the setting: at common, an uncommon card is refused and a common one is not.
  update settings set value = jsonb_set(value, '{cardRarityMost}', '"common"') where key = 'pool';
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'hook', sp2));
  perform tests.unbecome();
  if said is null or said !~ '^55000 Hook is above' then raise exception 'an uncommon Set under a common cap: %', said; end if;
  perform tests.become_service();
  perform staff_set_card('sc-mod', 'bluffy', sp2);
  perform tests.unbecome();
  said := pg_temp.refused($q$update settings set value = jsonb_set(value, '{cardRarityMost}', '"mythic"') where key = 'pool'$q$);
  if said is null or said !~ '^23514' then raise exception 'a pool cap that is no rarity was stored: %', said; end if;
  said := pg_temp.refused($q$update settings set value = jsonb_set(value, '{cardRarityMost}', '3') where key = 'pool'$q$);
  if said is null or said !~ '^23514' then raise exception 'a pool cap that is a number was stored: %', said; end if;
  update settings set value = jsonb_set(value, '{cardRarityMost}', '"uncommon"') where key = 'pool';
end $$;

-- ---- A waiting, a benched or an unknown persona plays nothing; the doors are the service role's alone ----
do $$
declare
  ann uuid := tests.account('sc-ann3'); a uuid := tests.character(ann, 'Sc Ann Three');
  t uuid := tests.thread('Silent staff');
  pp uuid := tests.post(a, t, 'A player''s post.');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post.');
  said text;
begin
  perform tests.become_service();
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-wait', 'sweetie', pp));
  if said is null or said !~ '^55000 a waiting persona writes nothing' then raise exception 'a waiting persona played a card: %', said; end if;
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-bench', 'sweetie', pp));
  if said is null or said !~ '^55000 a benched persona writes nothing' then raise exception 'a benched persona played a card: %', said; end if;
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-nobody', 'sweetie', pp));
  if said is null or said !~ '^P0002' then raise exception 'an unknown persona played a card: %', said; end if;
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-bench', 'bluffy', sp));
  if said is null or said !~ '^55000 a benched persona writes nothing' then raise exception 'a benched persona set a card: %', said; end if;
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-wait', 'bluffy', sp));
  if said is null or said !~ '^55000 a waiting persona writes nothing' then raise exception 'a waiting persona set a card: %', said; end if;
  perform tests.unbecome();
  -- No player and no visitor reaches either door, or the inner functions.
  perform tests.become(ann);
  said := pg_temp.refused(format('select staff_play_card(%L, %L, %L)', 'sc-mod', 'sweetie', pp));
  if said is null or said !~ '^42501' then raise exception 'a player called staff_play_card: %', said; end if;
  said := pg_temp.refused(format('select place_cast(%L, %L, %L, %L, %L, %L, null, null, 0)', pg_temp.staff_char('sc-mod'), 'sweetie', pp, '{}', '', 'post'));
  if said is null or said !~ '^42501' then raise exception 'a player called place_cast: %', said; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  said := pg_temp.refused(format('select staff_set_card(%L, %L, %L)', 'sc-mod', 'bluffy', sp));
  if said is null or said !~ '^42501' then raise exception 'a visitor called staff_set_card: %', said; end if;
  perform tests.unbecome();
  perform tests.become_service();
  said := pg_temp.refused(format('select place_set(%L, %L, %L, %L, null, 0)', pg_temp.staff_char('sc-mod'), 'bluffy', sp, '{}'));
  perform tests.unbecome();
  if said is null or said !~ '^42501' then raise exception 'the service role called place_set directly: %', said; end if;
end $$;

-- ---- A player's trap that catches a staff Cast pays the card's base price as trapSystem, whatever the trapper holds ----
do $$
declare
  ann uuid := tests.account('sc-trapper-a'); a uuid := tests.character(ann, 'Sc Trapper A');
  bob uuid := tests.account('sc-trapper-b'); b uuid := tests.character(bob, 'Sc Trapper B');
  cat uuid := tests.account('sc-trapper-c'); c uuid := tests.character(cat, 'Sc Trapper C');
  t uuid := tests.thread('Caught staff');
  pa uuid := tests.post(a, t, 'Trapped A.'); pb uuid := tests.post(b, t, 'Trapped B.'); pc uuid := tests.post(c, t, 'Trapped C.');
  ra jsonb; rb jsonb; rc jsonb;
begin
  perform pg_temp.hand(ann, 'snare'); perform pg_temp.hand(bob, 'snare'); perform pg_temp.hand(cat, 'catcher');
  insert into wallets (account, balance) values (ann, 0), (bob, 300), (cat, 0);
  perform set_card(ann, 'snare', a, pa, '{}', 0);
  perform set_card(bob, 'snare', b, pb, '{}', 0);
  perform set_card(cat, 'catcher', c, pc, '{}', 0);
  perform tests.become_service();
  ra := staff_play_card('sc-mod', 'sweetie', pa, '{}', '');
  rb := staff_play_card('sc-mod', 'sweetie', pb, '{}', '');
  rc := staff_play_card('sc-mod', 'sweetie', pc, '{}', '');
  perform tests.unbecome();
  if ra -> 'payload' ->> 'caught' is null or rb -> 'payload' ->> 'caught' is null or rc -> 'payload' ->> 'caught' is null then
    raise exception 'a staff Cast was not caught: % / % / %', ra, rb, rc;
  end if;
  -- The base price of Sweetie (the economy's 100), to a trapper holding nothing and to one holding 300: the same.
  if (select w.change || ':' || w.ref::text || ':' || coalesce(w.settlement::text, 'none') from wallet_events w where w.account = ann and w.kind = 'trapSystem')
       is distinct from '100:' || (ra -> 'sprung' ->> 'id') || ':none'
     or (select w.change from wallet_events w where w.account = bob and w.kind = 'trapSystem') is distinct from 100 then
    raise exception 'a caught staff Cast pays its base price: %', (select jsonb_agg(to_jsonb(w)) from wallet_events w where w.kind like 'trap%');
  end if;
  if (select balance from wallets where account = ann) is distinct from 100 or (select balance from wallets where account = bob) is distinct from 400 then
    raise exception 'the payout reached the wallets: % / %', (select balance from wallets where account = ann), (select balance from wallets where account = bob);
  end if;
  -- No wallet paid it, no kind 'trap' event, no ledger row for the staff play; a nullify trap pays nothing.
  if exists (select 1 from wallet_events where kind = 'trap' and account in (ann, bob, cat)) then raise exception 'a staff catch wrote a player-paid trap event'; end if;
  if exists (select 1 from wallet_events where account = cat and kind = 'trapSystem') then raise exception 'a nullify trap was paid'; end if;
  if exists (select 1 from card_ledger where act in ((ra ->> 'id')::uuid, (rb ->> 'id')::uuid, (rc ->> 'id')::uuid)) then raise exception 'a caught staff play has a ledger row'; end if;
  -- The trapper reads it from their own wallet events; nobody else does.
  perform tests.become(ann);
  if (select change from my_wallet_events where kind = 'trapSystem') is distinct from 100 then raise exception 'the trapper does not read the payout'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from my_wallet_events where kind = 'trapSystem' and change = 100 and balance_after = 100) then raise exception 'another player reads the first trapper''s payout'; end if;
  perform tests.unbecome();
  -- The cast was caught: it took no layer, so the same card lands on that post again.
  perform tests.become_service();
  if (staff_play_card('sc-mod', 'sweetie', pc, '{}', '') -> 'payload' ->> 'caught') is not null then raise exception 'a spent nullify trap caught a second cast'; end if;
  perform tests.unbecome();
end $$;

-- ---- A trapper at the wallet cap is credited what the wallet took, and the event says so ----
do $$
declare
  ann uuid := tests.account('sc-capped'); a uuid := tests.character(ann, 'Sc Capped');
  t uuid := tests.thread('Caught staff at the cap');
  pa uuid := tests.post(a, t, 'Trapped at the cap.');
  cap integer := (setting('walletCap'))::integer; r jsonb;
begin
  perform pg_temp.hand(ann, 'snare');
  insert into wallets (account, balance) values (ann, cap - 30);
  perform set_card(ann, 'snare', a, pa, '{}', 0);
  perform tests.become_service();
  r := staff_play_card('sc-mod', 'sweetie', pa, '{}', '');
  perform tests.unbecome();
  if (select w.change || ':' || w.overflow || ':' || w.balance_after from wallet_events w where w.account = ann and w.kind = 'trapSystem')
       is distinct from '30:70:' || cap then
    raise exception 'a capped trapper is credited what fit, with the rest as overflow: %', (select jsonb_agg(to_jsonb(w)) from wallet_events w where w.account = ann);
  end if;
end $$;

-- ---- A trap set by staff springs on a player's reply without refusing it, and the staff flag closes behind it ----
-- The poison, planted and observed: with both `set_config('kayfabb.staff_writer', 'on', true)` lines removed from spring_traps in 0086
-- (the flag left closed), this block fails at the player's reply with `a staff character acts only through the game's own moves` raised by
-- acts_well_formed() inside spring_traps' insert of the spring (psql line 330 of the file as then run); restored, it passes.
do $$
declare
  bob uuid := tests.account('sc-replier'); b uuid := tests.character(bob, 'Sc Replier');
  t uuid := tests.thread('A staff trap');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post with a hook under it.');
  mod uuid := pg_temp.staff_char('sc-mod');
  set_act uuid; replied jsonb; struck jsonb; said text;
begin
  perform tests.become_service();
  set_act := (staff_set_card('sc-mod', 'hook', sp, '{"color": "red"}') ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob);
  replied := post(t, b, 'A reply to the staff post.');
  perform tests.unbecome();
  if replied ->> 'id' is null then raise exception 'the reply was not written: %', replied; end if;
  if replied -> 'sprung' -> 'payload' ->> 'card' is distinct from 'hook' or replied -> 'sprung' -> 'payload' ->> 'set' is distinct from set_act::text then
    raise exception 'the staff trap did not spring on the reply: %', replied;
  end if;
  struck := replied -> 'sprung' -> 'struck';
  if struck is null then struck := replied -> 'sprung'; end if;
  if (select x.kind || ':' || x.character::text || ':' || x.target_act_id::text || ':' || (x.payload ->> 'card') from acts x
      where x.kind = 'card' and x.payload ->> 'spring' = replied -> 'sprung' ->> 'id')
       is distinct from 'card:' || mod::text || ':' || (replied ->> 'id') || ':blot' then
    raise exception 'the strike is a staff Blot on the reply: %', replied;
  end if;
  if (select x.character from acts x where x.id = (replied -> 'sprung' ->> 'id')::uuid) is distinct from mod then raise exception 'the spring is the staff setter''s'; end if;
  -- The flag is shut again: a staff character still cannot be written as, by anything that did not open it.
  if coalesce(current_setting('kayfabb.staff_writer', true), '') = 'on' then raise exception 'the staff flag was left open after a spring'; end if;
  said := pg_temp.refused(format('insert into acts (character, kind, thread, payload) values (%L, ''post'', %L, ''{"body": "Passing as staff."}'')', mod, t));
  if said is null or said !~ 'a staff character acts only through the game''s own moves' then raise exception 'a write passed as staff after a spring: %', said; end if;
  -- The struck post's author is alerted that a trap struck (trapStruck goes to the struck post's author, a player, whoever set the
  -- trap); the staff setter has no owner, so nothing is written for it.
  if (select count(*) from alerts where kind = 'trapStruck' and account = bob
        and act = (select x.id from acts x where x.payload ->> 'spring' = replied -> 'sprung' ->> 'id')) is distinct from 1 then
    raise exception 'the player a staff trap struck was not alerted: %', (select jsonb_agg(to_jsonb(al)) from alerts al where al.account = bob);
  end if;
  if exists (select 1 from alerts where kind in ('trapStruck', 'trapSprang') and account is distinct from bob
               and act in ((replied -> 'sprung' ->> 'id')::uuid, (select x.id from acts x where x.payload ->> 'spring' = replied -> 'sprung' ->> 'id'))) then
    raise exception 'a staff trap wrote an alert for someone but the struck player';
  end if;
  -- It sprang once: the hook is spent.
  perform tests.become(bob);
  if (post(t, b, 'And another.') -> 'sprung') is not null then raise exception 'the staff trap sprang twice'; end if;
  perform tests.unbecome();
end $$;

-- ---- The staff flag a spring opens is put back to what it was: inside a staff write it stays open ----
do $$
declare
  ann uuid := tests.account('sc-nested'); a uuid := tests.character(ann, 'Sc Nested');
  t uuid := tests.thread('A staff cast on a staff trap');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post carrying a Catcher.');
  bp uuid := pg_temp.staff_post('sc-boss', t, 'A staff post carrying a Bluff.');
  r jsonb;
begin
  -- Plant a nullify trap of the staff's own for the staff to meet (catcher is rare: lifted for this setup alone).
  update settings set value = jsonb_set(value, '{cardRarityMost}', '"rare"') where key = 'pool';
  perform tests.become_service();
  perform staff_set_card('sc-mod', 'catcher', sp);
  update settings set value = jsonb_set(value, '{cardRarityMost}', '"uncommon"') where key = 'pool';
  r := staff_play_card('sc-boss', 'sweetie', sp, '{}', '');
  perform tests.unbecome();
  if r -> 'payload' ->> 'caught' is null then raise exception 'a staff Cast did not meet the staff trap: %', r; end if;
  if exists (select 1 from wallet_events where kind = 'trapSystem' and ref = (r -> 'sprung' ->> 'id')::uuid) then raise exception 'a staff trap on a staff Cast was paid'; end if;
  if coalesce(current_setting('kayfabb.staff_writer', true), '') = 'on' then raise exception 'the staff flag stayed open after staff_play_card'; end if;
end $$;

-- ---- The poison: a staff Cast with a payer, a player's play with none, a price on a free play, and a back that disagrees ----
do $$
declare
  ann uuid := tests.account('sc-poison'); a uuid := tests.character(ann, 'Sc Poison');
  t uuid := tests.thread('Poisons');
  pp uuid := tests.post(a, t, 'A player''s post.');
  ap uuid := tests.post(a, t, 'Another.');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post.');
  mod uuid := pg_temp.staff_char('sc-mod');
  said text; setting_act uuid; before_acts bigint;
begin
  select count(*) into before_acts from acts;
  perform set_config('kayfabb.staff_writer', 'on', true);
  said := pg_temp.refused(format('select place_cast(%L, %L, %L, %L, %L, %L, null, %L, 0)', mod, 'sweetie', pp, '{}', '', 'post', ann));
  if said is null or said !~ '^22023' then raise exception 'a staff Cast with a payer was placed: %', said; end if;
  said := pg_temp.refused(format('select place_cast(%L, %L, %L, %L, %L, %L, null, null, 5)', mod, 'sweetie', pp, '{}', '', 'post'));
  if said is null or said !~ '^22023' then raise exception 'a staff Cast with a price was placed: %', said; end if;
  said := pg_temp.refused(format('select place_cast(%L, %L, %L, %L, %L, %L, null, null, 0)', a, 'sweetie', pp, '{}', '', 'post'));
  if said is null or said !~ '^22023' then raise exception 'a player''s Cast with no payer was placed: %', said; end if;
  said := pg_temp.refused(format('select place_set(%L, %L, %L, %L, %L, 0)', mod, 'bluffy', sp, '{}', ann));
  if said is null or said !~ '^22023' then raise exception 'a staff Set with a payer was placed: %', said; end if;
  said := pg_temp.refused(format('select place_set(%L, %L, %L, %L, null, 0)', a, 'bluffy', ap, '{}'));
  if said is null or said !~ '^22023' then raise exception 'a player''s Set with no payer was placed: %', said; end if;
  perform set_config('kayfabb.staff_writer', '', true);
  if (select count(*) from acts) is distinct from before_acts then raise exception 'a refused place wrote an Act'; end if;
  -- face_down.account is null exactly when the setter is staff, whoever writes the row.
  perform set_config('kayfabb.staff_writer', 'on', true);
  setting_act := tests.act(mod, 'set', t, '{}', sp);
  perform set_config('kayfabb.staff_writer', '', true);
  said := pg_temp.refused(format('insert into face_down (play, account, card, post, thread, round, ends_at) values (%L, %L, ''bluffy'', %L, %L, 1, now() + interval ''1 day'')', setting_act, ann, sp, t));
  if said is null or said !~ '^23514' then raise exception 'a staff back with an account was stored: %', said; end if;
  setting_act := tests.act(a, 'set', t, '{}', pp);
  said := pg_temp.refused(format('insert into face_down (play, account, card, post, thread, round, ends_at) values (%L, null, ''bluffy'', %L, %L, 1, now() + interval ''1 day'')', setting_act, pp, t));
  if said is null or said !~ '^23514' then raise exception 'a player''s back with no account was stored: %', said; end if;
end $$;

-- ---- A player's play is charged exactly as before, and a refused play charges nothing ----
do $$
declare
  ann uuid := tests.account('sc-pay'); a uuid := tests.character(ann, 'Sc Payer');
  bob uuid := tests.account('sc-pay-b'); b uuid := tests.character(bob, 'Sc Payer B');
  t uuid := tests.thread('Charges');
  p uuid := tests.post(b, t, 'A post to cast on.'); warded uuid := tests.post(b, t, 'A warded post.'); mine uuid := tests.post(a, t, 'Ann''s own post.');
  mine2 uuid := tests.post(a, t, 'Ann''s second post.');
  r jsonb; said text; events bigint; ledger bigint;
begin
  perform pg_temp.hand(ann, 'sweetie', 'bluffy', 'sweetie', 'bluffy');
  perform pg_temp.hand(bob, 'shield');
  insert into wallets (account, balance) values (ann, 300), (bob, 0);
  perform play_card(bob, 'shield', b, warded, '{}', 0, '');
  -- A play: the wallet down by exactly the price, a ledger row at it, a wallet event naming the Act.
  r := play_card(ann, 'sweetie', a, p, '{}', 75, 'Hi.');
  if (select balance from wallets where account = ann) is distinct from 225 then raise exception 'a player''s Cast cost %', 300 - (select balance from wallets where account = ann); end if;
  if (select l.price from card_ledger l where l.act = (r ->> 'id')::uuid and l.account = ann and l.kind = 'played') is distinct from 75 then raise exception 'the ledger row of a Cast'; end if;
  if (select w.change || ':' || w.kind || ':' || w.ref::text from wallet_events w where w.account = ann and w.kind = 'play') is distinct from '-75:play:' || (r ->> 'id') then
    raise exception 'the wallet event of a Cast: %', (select jsonb_agg(to_jsonb(w)) from wallet_events w where w.account = ann);
  end if;
  -- A Set: the same.
  r := set_card(ann, 'bluffy', a, mine, '{}', 25);
  if (select balance from wallets where account = ann) is distinct from 200 then raise exception 'a player''s Set cost %', 225 - (select balance from wallets where account = ann); end if;
  if (select l.price from card_ledger l where l.act = (r ->> 'id')::uuid and l.account = ann and l.kind = 'played') is distinct from 25 then raise exception 'the ledger row of a Set'; end if;
  -- Refused anywhere after the hand check: nothing is spent, and the card stays in the hand.
  select count(*) into events from wallet_events where account = ann;
  select count(*) into ledger from card_ledger where account = ann and kind = 'played';
  said := pg_temp.refused(format('select play_card(%L, %L, %L, %L, %L, 75, %L)', ann, 'sweetie', a, warded, '{}', ''));
  if said is null or said !~ 'turns away' then raise exception 'a Cast on a warded post: %', said; end if;
  said := pg_temp.refused(format('select play_card(%L, %L, %L, %L, %L, 75, %L)', ann, 'bluffy', a, p, '{}', ''));
  if said is null or said !~ 'set face down on your own post' then raise exception 'a Set played as a Cast: %', said; end if;
  said := pg_temp.refused(format('select set_card(%L, %L, %L, %L, %L, 25)', ann, 'bluffy', a, p, '{}'));
  if said is null or said !~ '^42501' then raise exception 'a Set on another''s post: %', said; end if;
  said := pg_temp.refused(format('select set_card(%L, %L, %L, %L, %L, 25)', ann, 'sweetie', a, mine2, '{}'));
  if said is null or said !~ 'is not set face down' then raise exception 'a Cast set face down: %', said; end if;
  if (select balance from wallets where account = ann) is distinct from 200 or (select count(*) from wallet_events where account = ann) is distinct from events
     or (select count(*) from card_ledger where account = ann and kind = 'played') is distinct from ledger then
    raise exception 'a refused play charged: wallet %, events %, ledger %', (select balance from wallets where account = ann), (select count(*) from wallet_events where account = ann), (select count(*) from card_ledger where account = ann and kind = 'played');
  end if;
  -- Before the hand check: a price that is too high, and no card in hand.
  said := pg_temp.refused(format('select play_card(%L, %L, %L, %L, %L, 99999, %L)', ann, 'sweetie', a, mine2, '{}', ''));
  if said is null or said !~ '^22023 a play costs between 0 and the wallet' then raise exception 'a price over the cap: %', said; end if;
  said := pg_temp.refused(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'splat', a, mine2, '{}', ''));
  if said is null or said !~ '^P0001 you hold no "splat" card' then raise exception 'a card not in hand: %', said; end if;
  if (select balance from wallets where account = ann) is distinct from 200 then raise exception 'a refused play at the door charged'; end if;
end $$;

-- ---- A staff Cast carries the pool's marker when given one, and nothing when not; a player's play never does ----
do $$
declare
  ann uuid := tests.account('sc-ann-marker'); a uuid := tests.character(ann, 'Sc Ann Marker');
  t uuid := tests.thread('Staff markers');
  p uuid := tests.post(a, t, 'A post for a marked Cast.');
  sp uuid := pg_temp.staff_post('sc-mod', t, 'A staff post for a Set.');
  cast_act jsonb; set_act jsonb; plain jsonb;
begin
  perform tests.become_service();
  cast_act := staff_play_card('sc-mod', 'sweetie', p, '{}', '', '2030-03-04');
  set_act := staff_set_card('sc-mod', 'bluffy', sp);
  perform tests.unbecome();
  if (select x.payload ->> 'pool' from acts x where x.id = (cast_act ->> 'id')::uuid) is distinct from '2030-03-04' then raise exception 'a marked Cast has no marker: %', cast_act; end if;
  -- A Set's payload is empty (acts_set_payload); it is tied to its post by landing on it.
  if (select x.payload ->> 'card' from acts x where x.id = (cast_act ->> 'id')::uuid) is distinct from 'sweetie' then raise exception 'the marker displaced the card'; end if;
  perform tests.become_service();
  plain := staff_play_card('sc-boss', 'blot', p, '{"color": "red"}');
  perform tests.unbecome();
  if (select x.payload ? 'pool' from acts x where x.id = (plain ->> 'id')::uuid) then raise exception 'an unmarked staff Cast carries a marker'; end if;
  if exists (select 1 from acts x where x.kind in ('card', 'set') and x.payload ? 'pool' and x.character not in (select id from characters where staff is not null)) then
    raise exception 'a player''s play carries a pool marker';
  end if;
end $$;
