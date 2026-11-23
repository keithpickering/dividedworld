-- The refund outcome and the refunds field (supabase/migrations/0397_refund_outcome.sql; docs/plans/2026-11-20-refund-outcome-plan.md, Task 2; design docs/plans/2026-11-20-refund-outcome-design.md, section 3).
-- Two ways a cast goes back to its caster's hand, both written in place_cast where the cast lands, both the same two things: the cast's own Act carries `handedBack: {by, card}` and the caster's account gets a
-- `returned` row in card_ledger naming the cast's Act (price 0), so card_held is what it was before the cast.
--   * A refund back (rfgift, a set card with a match and `outcome: {kind: refund}`): the first card it matches springs it, `did: returned` with no `quadrant`; the cast lands with its layer and no `caught`,
--     and is handed back; the back is spent. A staff cast has no hand to hand a card to, so it passes over a refund back and the back stays live.
--   * A refunds Gimmick (rfsign, a use card on a post with a time up and `refunds: {flavors: [salty], count: 3}`): while it is up, the first three salty casts that land on its post are handed back; a staff cast
--     takes no kick; a cast a back catches or a ward turns away takes none; a cast is handed back once at most. The masks: one account's other character is refunded exactly as a stranger is.
-- The spring's constraint takes a returned spring with no quadrant and refuses one that names a quadrant; card_kinds_refunds_use holds the column's pairings; the seed carries the column. The cards are this file's own (rf...).

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
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, refunds, stack) values
    ('rfgift', 'Rf Gift', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["sweet"], "upTo": "uncommon"}, "outcome": {"kind": "refund"}}', '{post}', null, null, null, 1),
    ('rfsign', 'Rf Sign', 'pepperoni', 'common', 'use', null, '{post}', interval '3 days',
      '{"kind": "earn", "flat": 1, "quadrants": ["excitedNegative", "boredNegative"]}', '{"flavors": ["salty"], "count": 3}', 1),
    ('rfsignsweet', 'Rf Sign Sweet', 'pepperoni', 'common', 'use', null, '{post}', interval '3 days',
      '{"kind": "earn", "flat": 1, "quadrants": ["excitedNegative", "boredNegative"]}', '{"flavors": ["sweet"], "count": 3}', 1),
    ('rfward', 'Rf Ward', 'pepperoni', 'uncommon', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', null, 1),
    ('rfsweet', 'Rf Sweet', 'sweet', 'common', 'cast', null, '{post}', null, null, null, 4),
    ('rfrare', 'Rf Rare', 'sweet', 'rare', 'cast', null, '{post}', null, null, null, 2),
    ('rfsalty', 'Rf Salty', 'salty', 'common', 'cast', null, '{post}', null, null, null, 6),
    ('rfcatch', 'Rf Catch', 'salty', 'common', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null, null, 1)
  on conflict (key) do nothing;
end $$;

-- The facts of a spring Act as a test reads them.
create function pg_temp.spring_of(back uuid) returns jsonb language sql as $$
  select s.payload from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text
$$;
-- How many casts a play has handed back, and the returned rows an account holds.
create function pg_temp.kicks(play uuid) returns bigint language sql as $$
  select count(*) from acts k where k.kind = 'card' and k.payload #>> '{handedBack,by}' = play::text
$$;
create function pg_temp.returned(who uuid, cast_act uuid) returns bigint language sql as $$
  select count(*) from card_ledger l where l.account = who and l.kind = 'returned' and l.act = cast_act
$$;
create function pg_temp.rows(who uuid) returns bigint language sql as $$
  select count(*) from card_ledger l where l.account = who
$$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rf-ann'); bob uuid := tests.account('rf-bob');
  a uuid := tests.character(ann, 'Rf Ann'); a2 uuid := tests.character(ann, 'Rf Ann Two'); b uuid := tests.character(bob, 'Rf Bob');
  staff uuid;
  t uuid := tests.thread('Rf refund');
  p1 uuid := tests.post(a, t, 'Gift.'); p2 uuid := tests.post(a, t, 'Sign.'); p3 uuid := tests.post(a, t, 'Own other mask.'); p4 uuid := tests.post(a, t, 'Staff on a sign.');
  p5 uuid := tests.post(a, t, 'Staff on a gift.'); p6 uuid := tests.post(a, t, 'Caught.'); p7 uuid := tests.post(a, t, 'Warded.');
  back uuid; back5 uuid; back6 uuid; sign uuid; sign3 uuid; sign4 uuid; sign6 uuid; sign7 uuid;
  c jsonb; c_act uuid; cp jsonb; sp jsonb; first_cp jsonb; why text; held_before integer; ann_rows bigint; ledger_rows bigint; n integer; r jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'rfgift', 'rfgift', 'rfsign', 'rfsign', 'rfsign', 'rfsign', 'rfsign', 'rfcatch', 'rfward', 'rfsalty');
  perform pg_temp.hand(bob, 'rfrare', 'rfsweet', 'rfsweet', 'rfsweet', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty');
  perform pg_temp.hand(ann, 'rfsalty', 'rfsalty', 'rfsalty', 'rfsalty', 'rfsweet');
  perform tests.become_service();

  -- ---- A refund back: set with no configuration, the first matching cast springs it and is handed back ----
  back := (set_card(ann, 'rfgift', a, p1, '{}', 0) ->> 'id')::uuid;
  -- A card the match does not reach (a rare one) passes over it: no spring.
  perform play_card(bob, 'rfrare', b, p1, '{}', 0, '');
  if pg_temp.spring_of(back) is not null then raise exception 'a rare cast sprang a back that matches up to uncommon'; end if;
  held_before := card_held(bob, 'rfsweet');
  ann_rows := pg_temp.rows(ann);
  c := play_card(bob, 'rfsweet', b, p1, '{}', 0, '');
  c_act := (c ->> 'id')::uuid;
  select x.payload into cp from acts x where x.id = c_act;
  sp := pg_temp.spring_of(back);
  if sp is null or sp ->> 'did' is distinct from 'returned' or sp ->> 'trigger' is distinct from 'cast' or sp ? 'quadrant' or sp ? 'caught'
     or sp ->> 'by' is distinct from c_act::text or sp ->> 'card' is distinct from 'rfgift' then
    raise exception 'the spring of a refund back: %', sp;
  end if;
  if cp ->> 'layer' is null or cp ? 'caught' or cp ->> 'rode' is not null then raise exception 'a handed back cast is not a landed cast with a layer: %', cp; end if;
  if cp -> 'handedBack' is distinct from jsonb_build_object('by', back::text, 'card', 'rfgift') then raise exception 'the cast does not say what handed it back: %', cp; end if;
  if pg_temp.returned(bob, c_act) is distinct from 1::bigint then raise exception 'the caster has no returned row naming the cast'; end if;
  if not exists (select 1 from card_ledger l where l.account = bob and l.kind = 'returned' and l.act = c_act and l.card = 'rfsweet' and l.price = 0) then raise exception 'the returned row names another card or a price'; end if;
  if card_held(bob, 'rfsweet') is distinct from held_before then raise exception 'a handed back cast cost its caster a card: % -> %', held_before, card_held(bob, 'rfsweet'); end if;
  if pg_temp.rows(ann) is distinct from ann_rows then raise exception 'a refund back wrote a row in the setter''s ledger'; end if;
  if exists (select 1 from card_ledger where account = ann and kind = 'caught') then raise exception 'a refund back wrote a caught row'; end if;
  if not exists (select 1 from jsonb_array_elements(card_target(p1) -> 'effects') e where e ->> 'act' = c_act::text) then raise exception 'the handed back cast is not a live card on the post'; end if;
  -- The back is spent: a second cast lands with no spring and no hand back, and it costs its card.
  held_before := card_held(bob, 'rfsweet');
  c := play_card(bob, 'rfsweet', b, p1, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if (select count(*) from acts where kind = 'spring' and (payload ->> 'set') = back::text) is distinct from 1::bigint then raise exception 'a spent refund back sprang again'; end if;
  if cp ? 'handedBack' or pg_temp.returned(bob, (c ->> 'id')::uuid) <> 0 then raise exception 'a cast after the back was spent was handed back: %', cp; end if;
  if card_held(bob, 'rfsweet') is distinct from held_before - 1 then raise exception 'a cast after the back was spent did not cost its card'; end if;

  -- ---- A refunds Gimmick: the first three salty casts on its post are handed back, the fourth is not ----
  sign := (play_card(ann, 'rfsign', a, p2, '{}', 0, '') ->> 'id')::uuid;
  held_before := card_held(bob, 'rfsalty');
  for n in 1..4 loop
    c := play_card(bob, 'rfsalty', b, p2, '{}', 0, '');
    c_act := (c ->> 'id')::uuid;
    select x.payload into cp from acts x where x.id = c_act;
    if n = 1 then first_cp := cp; end if;
    if n <= 3 then
      if cp -> 'handedBack' is distinct from jsonb_build_object('by', sign::text, 'card', 'rfsign') or cp ->> 'layer' is null or cp ? 'caught' then raise exception 'cast % on a live sign was not handed back by it: %', n, cp; end if;
      if pg_temp.returned(bob, c_act) is distinct from 1::bigint then raise exception 'cast % on a live sign wrote no returned row', n; end if;
    else
      if cp ? 'handedBack' or pg_temp.returned(bob, c_act) <> 0 then raise exception 'the fourth cast on a sign with three kicks was handed back: %', cp; end if;
    end if;
  end loop;
  if pg_temp.kicks(sign) is distinct from 3::bigint then raise exception 'the sign handed back % casts, not 3', pg_temp.kicks(sign); end if;
  if card_held(bob, 'rfsalty') is distinct from held_before - 1 then raise exception 'four casts, three handed back, did not cost one card: % -> %', held_before, card_held(bob, 'rfsalty'); end if;
  -- A casts of another flavor is not handed back by it (the sign names salty).
  c := play_card(bob, 'rfsweet', b, p2, '{}', 0, '');
  if (select x.payload ? 'handedBack' from acts x where x.id = (c ->> 'id')::uuid) then raise exception 'a sweet cast was handed back by a sign that names salty'; end if;

  -- ---- The masks: one account's other character is refunded exactly as a stranger is ----
  sign3 := (play_card(ann, 'rfsign', a, p3, '{}', 0, '') ->> 'id')::uuid;
  ann_rows := pg_temp.rows(ann);
  c := play_card(ann, 'rfsalty', a2, p3, '{}', 0, '');
  c_act := (c ->> 'id')::uuid;
  select x.payload into cp from acts x where x.id = c_act;
  if cp -> 'handedBack' is distinct from jsonb_build_object('by', sign3::text, 'card', 'rfsign') then raise exception 'one''s own other mask was not refunded by one''s own sign: %', cp; end if;
  if (select array(select jsonb_object_keys(cp) order by 1)) is distinct from (select array(select jsonb_object_keys(first_cp) order by 1)) then raise exception 'a refund to one''s own mask is shaped differently: % / %', cp, first_cp; end if;
  if pg_temp.returned(ann, c_act) is distinct from 1::bigint then raise exception 'one''s own other mask''s cast wrote no returned row'; end if;

  -- ---- A staff cast is never handed back, and takes no kick; a staff cast passes over a refund back ----
  insert into characters (name, staff, staff_kind, debuted_at) values ('Rf Staff', 'rf-staff', 'persona', now()) returning id into staff;
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}}, "turns": {"waitHours": 48, "perThread": 2, "perSession": 4, "perDay": 60}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  sign4 := (play_card(ann, 'rfsign', a, p4, '{}', 0, '') ->> 'id')::uuid;
  ledger_rows := (select count(*) from card_ledger);
  r := staff_play_card('rf-staff', 'rfsalty', p4);
  select x.payload into cp from acts x where x.id = (r ->> 'id')::uuid;
  if cp ? 'handedBack' or cp ->> 'layer' is null then raise exception 'a staff cast was handed back, or did not land: %', cp; end if;
  if (select count(*) from card_ledger) is distinct from ledger_rows then raise exception 'a staff cast wrote a ledger row'; end if;
  if pg_temp.kicks(sign4) <> 0 then raise exception 'a staff cast used a kick of the sign'; end if;
  back5 := (set_card(ann, 'rfgift', a, p5, '{}', 0) ->> 'id')::uuid;
  r := staff_play_card('rf-staff', 'rfsweet', p5);
  select x.payload into cp from acts x where x.id = (r ->> 'id')::uuid;
  if pg_temp.spring_of(back5) is not null then raise exception 'a staff cast sprang a refund back'; end if;
  if cp ? 'handedBack' or cp ? 'caught' or cp ->> 'layer' is null then raise exception 'a staff cast on a refund back is not a plain landed cast: %', cp; end if;
  -- The back is still live: the next player's cast springs it.
  c := play_card(ann, 'rfsweet', a2, p5, '{}', 0, '');
  sp := pg_temp.spring_of(back5);
  if sp is null or sp ->> 'did' is distinct from 'returned' then raise exception 'the refund back did not stay live over a staff cast: %', sp; end if;

  -- ---- A back that catches takes the cast, and nothing is refunded ----
  sign6 := (play_card(ann, 'rfsign', a, p6, '{}', 0, '') ->> 'id')::uuid;
  back6 := (set_card(ann, 'rfcatch', a, p6, '{}', 0, 'rfsalty') ->> 'id')::uuid;
  held_before := card_held(bob, 'rfsalty');
  c := play_card(bob, 'rfsalty', b, p6, '{}', 0, '');
  c_act := (c ->> 'id')::uuid;
  select x.payload into cp from acts x where x.id = c_act;
  sp := pg_temp.spring_of(back6);
  if sp is null or sp ->> 'did' is distinct from 'caught' then raise exception 'the catching back did not catch: %', sp; end if;
  if cp ? 'handedBack' or cp ->> 'caught' is null or pg_temp.returned(bob, c_act) <> 0 then raise exception 'a caught cast was handed back: %', cp; end if;
  if pg_temp.kicks(sign6) <> 0 then raise exception 'a caught cast used a kick'; end if;
  if card_held(bob, 'rfsalty') is distinct from held_before - 1 then raise exception 'a caught cast was refunded'; end if;

  -- ---- A ward turns the cast away first, and the sign's count is unchanged ----
  perform play_card(ann, 'rfward', a, p7, '{}', 0, '');
  sign7 := (play_card(ann, 'rfsign', a, p7, '{}', 0, '') ->> 'id')::uuid;
  held_before := card_held(bob, 'rfsalty');
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'rfsalty', b, p7, '{}', ''));
  if why is null or why not like '42501%' then raise exception 'a warded cast was not turned away: %', why; end if;
  if pg_temp.kicks(sign7) <> 0 or card_held(bob, 'rfsalty') is distinct from held_before then raise exception 'a warded cast used a kick or cost a card'; end if;
end $$;

-- ---- A cast is handed back once at most, and only by a sign that is up ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rf-o-ann'); bob uuid := tests.account('rf-o-bob');
  a uuid := tests.character(ann, 'Rf O Ann'); b uuid := tests.character(bob, 'Rf O Bob');
  t uuid := tests.thread('Rf once');
  q1 uuid := tests.post(a, t, 'Back and sign.'); q2 uuid := tests.post(a, t, 'Timed out.'); q3 uuid := tests.post(a, t, 'Ended.');
  back uuid; sign uuid; c jsonb; c_act uuid; cp jsonb; sp jsonb; ended_sign uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'rfgift', 'rfsignsweet', 'rfsign', 'rfsign');
  perform pg_temp.hand(bob, 'rfsweet', 'rfsweet', 'rfsalty', 'rfsalty');
  perform tests.become_service();

  -- One post with a refund back and a sign that both cover the cast: the back hands it back, the sign gives no kick, and exactly one row is written.
  back := (set_card(ann, 'rfgift', a, q1, '{}', 0) ->> 'id')::uuid;
  sign := (play_card(ann, 'rfsignsweet', a, q1, '{}', 0, '') ->> 'id')::uuid;
  c := play_card(bob, 'rfsweet', b, q1, '{}', 0, '');
  c_act := (c ->> 'id')::uuid;
  select x.payload into cp from acts x where x.id = c_act;
  sp := pg_temp.spring_of(back);
  if sp is null or sp ->> 'did' is distinct from 'returned' then raise exception 'the refund back did not spring on a cast the sign also covers: %', sp; end if;
  if cp -> 'handedBack' is distinct from jsonb_build_object('by', back::text, 'card', 'rfgift') then raise exception 'the cast was not handed back by the back: %', cp; end if;
  if pg_temp.returned(bob, c_act) is distinct from 1::bigint then raise exception 'a cast handed back by the back wrote % returned rows, not one', pg_temp.returned(bob, c_act); end if;
  if pg_temp.kicks(sign) <> 0 then raise exception 'a cast handed back by the back used a kick of the sign'; end if;
  -- The back is spent, so the next sweet cast is handed back by the sign.
  c := play_card(bob, 'rfsweet', b, q1, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp -> 'handedBack' is distinct from jsonb_build_object('by', sign::text, 'card', 'rfsignsweet') then raise exception 'the sign did not hand back the cast after the back was spent: %', cp; end if;
  if pg_temp.kicks(sign) is distinct from 1::bigint then raise exception 'the sign has % kicks used, not 1', pg_temp.kicks(sign); end if;

  -- A sign whose time has passed hands nothing back (a play written with an `ends` already behind it).
  ended_sign := tests.act(a, 'card', t, jsonb_build_object('card', 'rfsign', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 hour'), q2);
  c := play_card(bob, 'rfsalty', b, q2, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'handedBack' or pg_temp.returned(bob, (c ->> 'id')::uuid) <> 0 or pg_temp.kicks(ended_sign) <> 0 then raise exception 'a sign whose time had passed handed a cast back: %', cp; end if;

  -- A sign an admin has ended (reverse_card) hands nothing back: its end Act makes card_ended true.
  sign := (play_card(ann, 'rfsign', a, q3, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  insert into admins (account) values (ann);
  perform tests.become(ann);
  perform reverse_card(sign);
  perform tests.unbecome();
  perform tests.become_service();
  if not card_ended(sign) then raise exception 'the sign is not ended after its end Act'; end if;
  c := play_card(bob, 'rfsalty', b, q3, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (c ->> 'id')::uuid;
  if cp ? 'handedBack' or pg_temp.returned(bob, (c ->> 'id')::uuid) <> 0 or pg_temp.kicks(sign) <> 0 then raise exception 'a sign that was ended handed a cast back: %', cp; end if;
end $$;

-- ---- The spring's payload: a returned spring names no quadrant ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rf-c-ann'); a uuid := tests.character(ann, 'Rf C Ann');
  t uuid := tests.thread('Rf constraint'); p uuid := tests.post(a, t, 'Held.'); sset uuid; why text;
begin
  sset := tests.act(a, 'set', t, '{}', p);
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rfgift', 'trigger', 'cast', 'did', 'returned', 'set', %L, 'by', %L, 'quadrant', 'calmPositive'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a returned spring naming a quadrant was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rfgift', 'trigger', 'cast', 'did', 'returned', 'set', %L, 'by', %L), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is not null then raise exception 'a returned spring with no quadrant was refused: %', why; end if;
  -- A returned spring is a cast's alone.
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rfgift', 'trigger', 'quote', 'did', 'returned', 'set', %L, 'by', %L), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a returned spring on a quote was let in: %', why; end if;
end $$;

-- ---- The column's pairing, and the seed's check and carry ----
do $$
declare why text; got text; kept jsonb;
begin
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, refunds) values ('rfbad', 'Rf Bad', 'salty', 'common', 'cast', '{post}', '{"flavors": ["salty"], "count": 1}')$q$);
  if why is null or why not like '23514%card_kinds_refunds_use%' then raise exception 'refunds on a cast card was let in the catalog: %', why; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick, refunds) values ('rfbad', 'Rf Bad', 'salty', 'common', 'use', '{post,character}', interval '1 day', '{"kind": "earn", "flat": 1}', '{"flavors": ["salty"], "count": 1}')$q$);
  if why is null or why not like '23514%card_kinds_refunds_use%' then raise exception 'refunds on a card that reaches beyond a post was let in the catalog: %', why; end if;
  -- (A use card with a gimmick and no time up is refused by card_kinds_gimmick_lasts first; the seed's check says the refunds words for it.)

  -- The seed's check takes both cards, as the engine's words say.
  got := card_kinds_problem(jsonb_build_array(
    '{"key": "rfsign", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "day", "count": 3}, "gimmick": {"kind": "earn", "flat": 1}, "refunds": {"flavors": ["salty"], "count": 3}}'::jsonb,
    '{"key": "rfgift", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "match": {"flavors": ["sweet"], "upTo": "uncommon"}, "outcome": {"kind": "refund"}}}'::jsonb));
  if got is not null then raise exception 'the seed check refused the refund cards: %', got; end if;

  -- The seed carries the field: a seeded card's refunds are the column, and a card without them has none.
  perform seed_instance(jsonb_build_object(
    'settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(
      '{"key": "rfseeded", "name": "Rf Seeded", "alignment": "pepperoni", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "day", "count": 3}, "gimmick": {"kind": "earn", "flat": 1}, "refunds": {"flavors": ["salty", "sweet"], "count": 2}}'::jsonb,
      '{"key": "rfplain", "name": "Rf Plain", "alignment": "salty", "rarity": "common", "play": "cast"}'::jsonb)));
  select k.refunds into kept from card_kinds k where k.key = 'rfseeded';
  if kept is distinct from '{"flavors": ["salty", "sweet"], "count": 2}'::jsonb then raise exception 'the seed did not carry refunds: %', kept; end if;
  if (select k.refunds from card_kinds k where k.key = 'rfplain') is not null then raise exception 'a card with no refunds was seeded with some'; end if;
  -- Seeding again with changed refunds updates the column (on conflict), and leaving them out clears it.
  perform seed_instance(jsonb_build_object(
    'settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(
      '{"key": "rfseeded", "name": "Rf Seeded", "alignment": "pepperoni", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "day", "count": 3}, "gimmick": {"kind": "earn", "flat": 1}, "refunds": {"flavors": ["pepperoni"], "count": 4}}'::jsonb,
      '{"key": "rfplain", "name": "Rf Plain", "alignment": "salty", "rarity": "common", "play": "cast"}'::jsonb)));
  select k.refunds into kept from card_kinds k where k.key = 'rfseeded';
  if kept is distinct from '{"flavors": ["pepperoni"], "count": 4}'::jsonb then raise exception 'seeding again did not update refunds: %', kept; end if;
  perform seed_instance(jsonb_build_object(
    'settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(
      '{"key": "rfseeded", "name": "Rf Seeded", "alignment": "pepperoni", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "day", "count": 3}, "gimmick": {"kind": "earn", "flat": 1}}'::jsonb)));
  if (select k.refunds from card_kinds k where k.key = 'rfseeded') is not null then raise exception 'seeding again without refunds kept them'; end if;
end $$;
