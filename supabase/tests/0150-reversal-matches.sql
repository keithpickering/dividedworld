-- Reversals: what place_set refuses and what a cast back springs on (supabase/migrations/0146_card_types.sql; docs/plans/2026-11-11-card-types-design.md, section 4;
-- plan Task 4). A set card with no trap, a named catch rarer than the set card, a `match` rarer than it, and a match beside a named catch are each refused in the
-- engine's words; a back springs on a cast when it names the card or when its match (a flavor list, a rarity ceiling) holds and the card is at or below the back's own rarity;
-- and every back a cast meets does the same reads before it decides. The cards are this file's own (tb...), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('tbcollector', 'Tb Collector', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null),
    ('tbsalty', 'Tb Salty Match', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null),
    ('tbrarity', 'Tb Rarity Match', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"upTo": "common"}}', '{post}', null),
    ('tbtoohigh', 'Tb Too High', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"upTo": "rare"}}', '{post}', null),
    ('tbnotrap', 'Tb No Trap', 'pepperoni', 'common', 'set', null, '{post}', null),
    ('tbmove', 'Tb Move', 'salty', 'common', 'cast', null, '{post}', null),
    ('tbsaltyc', 'Tb Salty Common', 'salty', 'common', 'cast', null, '{post}', null),
    ('tbsaltyu', 'Tb Salty Uncommon', 'salty', 'uncommon', 'cast', null, '{post}', null),
    ('tbsaltyr', 'Tb Salty Rare', 'salty', 'rare', 'cast', null, '{post}', null),
    ('tbpep', 'Tb Pepperoni', 'pepperoni', 'common', 'cast', null, '{post}', null),
    ('tbsweetc', 'Tb Sweet Common', 'sweet', 'common', 'cast', null, '{post}', null)
  on conflict (key) do nothing;
end $$;

-- ---- place_set's refusals, each in its own words, each before anything is written ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tb-ann'); a uuid := tests.character(ann, 'Tb Ann');
  t uuid := tests.thread('Tb refusals'); p uuid := tests.post(a, t, 'Backed.');
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tbnotrap', 'tbcollector', 'tbcollector', 'tbsalty', 'tbtoohigh', 'tbrarity');
  perform tests.become_service();

  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'tbnotrap', a, p, '{}'));
  if why is distinct from 'Tb No Trap has no trap to spring' then raise exception 'a set card with no trap: %', why; end if;

  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'tbcollector', a, p, '{}', 'tbsaltyr'));
  if why is distinct from 'Tb Collector names cards up to uncommon' then raise exception 'a named catch rarer than the set card: %', why; end if;

  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'tbtoohigh', a, p, '{}', null));
  if why is distinct from 'Tb Too High names cards up to uncommon' then raise exception 'a match rarer than the set card: %', why; end if;

  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'tbsalty', a, p, '{}', 'tbsaltyc'));
  if why is distinct from 'Tb Salty Match names a card or matches cards, never both' then raise exception 'a match beside a named catch: %', why; end if;

  -- A cast Reversal with neither a named catch nor a match still names no card to catch.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'tbcollector', a, p, '{}'));
  if why is distinct from 'Tb Collector names no card to catch' then raise exception 'a Reversal with nothing to wait for: %', why; end if;

  if exists (select 1 from acts where kind = 'set' and target_act_id = p) then raise exception 'a refused set wrote a back'; end if;
  if card_held(ann, 'tbnotrap') is distinct from 1 or card_held(ann, 'tbcollector') is distinct from 2 or card_held(ann, 'tbtoohigh') is distinct from 1 then raise exception 'a refused set spent a card'; end if;

  -- Clean: a named catch at or below the card's rarity, and a match with no catch.
  perform set_card(ann, 'tbcollector', a, p, '{}', 0, 'tbsaltyu');
  if not exists (select 1 from acts where kind = 'set' and target_act_id = p) then raise exception 'a clean Reversal was not set'; end if;
end $$;

-- ---- A flavor match catches a Salty cast and passes a Pepperoni one; the caught card is the setter's ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tb-fl-ann'); bob uuid := tests.account('tb-fl-bob');
  a uuid := tests.character(ann, 'Tb Fl Ann'); b uuid := tests.character(bob, 'Tb Fl Bob');
  t uuid := tests.thread('Tb flavor'); p uuid := tests.post(a, t, 'Backed.');
  back uuid; spring jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tbsalty');
  perform pg_temp.hand(bob, 'tbpep', 'tbsaltyc', 'tbsweetc');
  perform tests.become_service();
  back := (set_card(ann, 'tbsalty', a, p, '{}', 0) ->> 'id')::uuid;

  -- Pepperoni and Sweet pass through: each lands as a card on the post, and the back stays set.
  perform play_card(bob, 'tbpep', b, p, '{}', 0, '');
  perform play_card(bob, 'tbsweetc', b, p, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a Pepperoni or a Sweet cast sprang a Salty match'; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and not (payload ? 'caught')) is distinct from 2::bigint then raise exception 'the passing casts did not land'; end if;

  -- A Salty cast is caught.
  spring := play_card(bob, 'tbsaltyc', b, p, '{}', 0, '');
  if not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text and payload ->> 'did' = 'caught' and payload ->> 'trigger' = 'cast') then raise exception 'a Salty cast was not caught'; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'tbsaltyc' and not (payload ? 'caught')) then raise exception 'a caught cast landed as well'; end if;
  if card_held(ann, 'tbsalty') is distinct from 0 or card_held(ann, 'tbsaltyc') is distinct from 1 then raise exception 'the caught card did not go to the setter: % %', card_held(ann, 'tbsalty'), card_held(ann, 'tbsaltyc'); end if;
  if card_held(bob, 'tbsaltyc') is distinct from 0 then raise exception 'the caster kept the caught card'; end if;
end $$;

-- ---- A rarity ceiling, and a back never matches above its own rarity ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tb-ra-ann'); bob uuid := tests.account('tb-ra-bob');
  a uuid := tests.character(ann, 'Tb Ra Ann'); b uuid := tests.character(bob, 'Tb Ra Bob');
  t uuid := tests.thread('Tb rarity');
  p1 uuid := tests.post(a, t, 'Ceiling.'); p2 uuid := tests.post(a, t, 'Own rarity.');
  back1 uuid; back2 uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tbrarity', 'tbsalty');
  perform pg_temp.hand(bob, 'tbsaltyr', 'tbsaltyu', 'tbsaltyc', 'tbsaltyr', 'tbsaltyu');
  perform tests.become_service();
  back1 := (set_card(ann, 'tbrarity', a, p1, '{}', 0) ->> 'id')::uuid;
  back2 := (set_card(ann, 'tbsalty', a, p2, '{}', 0) ->> 'id')::uuid;

  -- tbrarity: up to common. An uncommon and a rare cast pass; a common one is caught.
  perform play_card(bob, 'tbsaltyu', b, p1, '{}', 0, '');
  perform play_card(bob, 'tbsaltyr', b, p1, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back1::text) then raise exception 'a card above the ceiling sprang the back'; end if;
  perform play_card(bob, 'tbsaltyc', b, p1, '{}', 0, '');
  if not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back1::text) then raise exception 'a card at the ceiling did not spring the back'; end if;

  -- tbsalty has no ceiling of its own and is uncommon: a rare Salty cast passes it, an uncommon one is caught.
  perform play_card(bob, 'tbsaltyr', b, p2, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back2::text) then raise exception 'a card rarer than the back sprang it'; end if;
  perform play_card(bob, 'tbsaltyu', b, p2, '{}', 0, '');
  if not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back2::text) then raise exception 'a card at the back''s own rarity did not spring it'; end if;
end $$;

-- ---- A named catch still springs on its card alone, and a catch that misses springs nothing ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tb-nm-ann'); bob uuid := tests.account('tb-nm-bob');
  a uuid := tests.character(ann, 'Tb Nm Ann'); b uuid := tests.character(bob, 'Tb Nm Bob');
  t uuid := tests.thread('Tb named'); p uuid := tests.post(a, t, 'Named.');
  back uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tbcollector');
  perform pg_temp.hand(bob, 'tbsaltyc', 'tbpep');
  perform tests.become_service();
  back := (set_card(ann, 'tbcollector', a, p, '{}', 0, 'tbsaltyc') ->> 'id')::uuid;
  perform play_card(bob, 'tbpep', b, p, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a card the back did not name sprang it'; end if;
  perform play_card(bob, 'tbsaltyc', b, p, '{}', 0, '');
  if not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text and payload ->> 'by' is not null) then raise exception 'the named card did not spring it, or the spring does not say what sprang it'; end if;
end $$;

-- ---- Every back a cast meets does the same reads before it decides: a named catch that misses, a match that misses, a Move back, and a back that springs ----
create function pg_temp.calls(f regprocedure) returns bigint language sql as $$ select coalesce(pg_stat_get_xact_function_calls(f::oid), 0) $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tb-ev-ann'); bob uuid := tests.account('tb-ev-bob');
  a uuid := tests.character(ann, 'Tb Ev Ann'); b uuid := tests.character(bob, 'Tb Ev Bob');
  t uuid := tests.thread('Tb even');
  p1 uuid := tests.post(a, t, 'Named miss.'); p2 uuid := tests.post(a, t, 'Match miss.'); p3 uuid := tests.post(a, t, 'Move back.'); p4 uuid := tests.post(a, t, 'Springs.');
  backs uuid[]; posts uuid[]; fd face_down; f spring_facts; by_act uuid := gen_random_uuid();
  w bigint; r bigint; c bigint; ws bigint[] := '{}'; rs bigint[] := '{}'; cs bigint[] := '{}'; shape text[] := '{}'; i integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tbcollector', 'tbsalty', 'tbmove', 'tbsalty');
  perform tests.become_service();
  backs := array[(set_card(ann, 'tbcollector', a, p1, '{}', 0, 'tbsaltyc') ->> 'id')::uuid, (set_card(ann, 'tbsalty', a, p2, '{}', 0) ->> 'id')::uuid,
                 (set_card(ann, 'tbmove', a, p3, '{}', 0) ->> 'id')::uuid, (set_card(ann, 'tbsalty', a, p4, '{}', 0) ->> 'id')::uuid];
  perform tests.unbecome();
  perform set_config('track_functions', 'all', true);
  -- The incoming card is a Pepperoni one: it misses the named catch and the flavor match, is no Move's concern, and the last back is asked with a Salty one so that it does spring.
  for i in 1 .. 4 loop
    select * into fd from face_down where play = backs[i];
    w := pg_temp.calls('ward_refusal(text, uuid, card_kinds)'::regprocedure);
    r := pg_temp.calls('rarity_rank(text)'::regprocedure);
    c := pg_temp.calls('card_ended(uuid)'::regprocedure);
    f := spring_facts(fd, 'cast', by_act, case when i = 4 then 'tbsaltyc' else 'tbpep' end);
    ws := ws || (pg_temp.calls('ward_refusal(text, uuid, card_kinds)'::regprocedure) - w);
    rs := rs || (pg_temp.calls('rarity_rank(text)'::regprocedure) - r);
    cs := cs || (pg_temp.calls('card_ended(uuid)'::regprocedure) - c);
    shape := shape || (f.caught::text);
  end loop;
  perform set_config('track_functions', 'none', true);
  if (select count(distinct x) from unnest(ws) x) is distinct from 1::bigint or (select count(distinct x) from unnest(rs) x) is distinct from 1::bigint or (select count(distinct x) from unnest(cs) x) is distinct from 1::bigint then
    raise exception 'the backs did not cost the same reads: ward % rarity % ended %', ws, rs, cs;
  end if;
  if shape is distinct from array['false', 'false', 'false', 'true'] then raise exception 'the facts decided wrongly: %', shape; end if;
end $$;
