-- A ride that pays on every quadrant (supabase/migrations/0392_ride_every.sql; docs/plans/2026-11-20-whoopee-cushion-plan.md, Task 2): a set card with a match (`up to common`) and a ride outcome whose `every` is true. It takes no
-- configuration and names no card to catch; the first card it matches cast on its post springs it, the cast lands as usual carrying `rode` and its layer and no `caught`, and the spring is `did: rode` with no `quadrant`
-- (the pay is read in every quadrant, the settlement's). A card it does not match passes over it and the back stays live. The spring's constraint takes a rode spring with no quadrant and still refuses a caught one that names
-- one; the seed's check takes the card and refuses an `every` that is not true. The cards are this file's own (rw...).

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
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, stack) values
    ('rwcushion', 'Rw Cushion', 'pepperoni', 'common', 'set', '{"trigger": {"on": "cast"}, "match": {"upTo": "common"}, "outcome": {"kind": "ride", "share": 0.25, "every": true}}', '{post}', null, null, 1),
    ('rwcommon', 'Rw Common', 'salty', 'common', 'cast', null, '{post}', null, null, 3),
    ('rwunc', 'Rw Uncommon', 'sweet', 'uncommon', 'cast', null, '{post}', null, null, 1)
  on conflict (key) do nothing;
end $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rw-ann'); bob uuid := tests.account('rw-bob');
  a uuid := tests.character(ann, 'Rw Ann'); b uuid := tests.character(bob, 'Rw Bob');
  t uuid := tests.thread('Rw every');
  p uuid := tests.post(a, t, 'Cushioned.');
  back uuid; cast_ jsonb; cast_act uuid; cp jsonb; sp jsonb; cast2 jsonb; cast2_act uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'rwcushion');
  perform pg_temp.hand(bob, 'rwunc', 'rwcommon', 'rwcommon');
  perform tests.become_service();

  -- Set with no configuration and no card named.
  back := (set_card(ann, 'rwcushion', a, p, '{}', 0) ->> 'id')::uuid;

  -- A card above common passes over it: it lands plainly and the back stays live.
  perform play_card(bob, 'rwunc', b, p, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'an uncommon cast sprang a back that matches up to common'; end if;
  if not exists (select 1 from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'rwunc' and not (payload ? 'rode')) then raise exception 'the uncommon cast did not land plainly'; end if;

  -- A common cast springs it and lands as usual.
  cast_ := play_card(bob, 'rwcommon', b, p, '{}', 0, '');
  cast_act := (cast_ ->> 'id')::uuid;
  select c.payload into cp from acts c where c.id = cast_act;
  if cp ->> 'layer' is null or cp ? 'caught' or cp ->> 'rode' is distinct from back::text then raise exception 'a cast that rode is not a landed cast carrying rode and a layer: %', cp; end if;
  select s.payload into sp from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text;
  if sp is null or sp ->> 'did' is distinct from 'rode' or sp ->> 'trigger' is distinct from 'cast' or sp ? 'quadrant' or sp ? 'caught'
     or sp ->> 'by' is distinct from cast_act::text or sp ->> 'card' is distinct from 'rwcushion' then
    raise exception 'the spring of a ridden every back: %', sp;
  end if;
  if exists (select 1 from card_ledger where account = ann and kind = 'caught') then raise exception 'a ridden every back wrote a caught row'; end if;
  perform tests.unbecome();
  if not exists (select 1 from alerts where kind = 'trapStruck' and account = bob and act = cast_act and character = b) then raise exception 'the caster of a ridden every cast was not told'; end if;
  perform tests.become_service();

  -- The back is spent: a second common cast lands with no spring.
  cast2 := play_card(bob, 'rwcommon', b, p, '{}', 0, '');
  cast2_act := (cast2 ->> 'id')::uuid;
  if (select count(*) from acts where kind = 'spring' and (payload ->> 'set') = back::text) is distinct from 1::bigint then raise exception 'a spent every back sprang again'; end if;
  if exists (select 1 from acts c where c.id = cast2_act and c.payload ? 'rode') then raise exception 'a cast after the back was spent carries rode'; end if;
end $$;

-- ---- The spring's payload: a rode spring may name no quadrant; a caught one still may not name one ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rw-c-ann'); a uuid := tests.character(ann, 'Rw C Ann');
  t uuid := tests.thread('Rw constraint'); p uuid := tests.post(a, t, 'Held.'); sset uuid; why text;
begin
  sset := tests.act(a, 'set', t, '{}', p);
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rwcushion', 'trigger', 'cast', 'did', 'caught', 'set', %L, 'by', %L, 'caught', %L, 'quadrant', 'calmPositive'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a caught spring naming a quadrant was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rwcushion', 'trigger', 'cast', 'did', 'rode', 'set', %L, 'by', %L, 'quadrant', 'wide'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a rode spring with a quadrant that is none was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rwcushion', 'trigger', 'cast', 'did', 'rode', 'set', %L, 'by', %L), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is not null then raise exception 'a rode spring with no quadrant was refused: %', why; end if;
end $$;

-- ---- The seed's check ----
do $$
begin
  if card_kinds_problem(jsonb_build_array((select jsonb_build_object('key', k.key, 'rarity', k.rarity, 'play', k.play, 'reaches', k.reaches, 'trap', k.trap) from card_kinds k where k.key = 'rwcushion'))) is not null then
    raise exception 'the seed check refused the cushion card: %', card_kinds_problem(jsonb_build_array((select jsonb_build_object('key', k.key, 'rarity', k.rarity, 'play', k.play, 'reaches', k.reaches, 'trap', k.trap) from card_kinds k where k.key = 'rwcushion')));
  end if;
end $$;
