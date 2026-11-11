-- A ride back: a Reversal whose trap has an outcome of kind ride (supabase/migrations/0151_card_payouts.sql; docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 4). It is set naming a Move and a
-- reaction quadrant; the cast of that Move on its post springs it as a catch does but lets the cast land: the cast takes its layer, carries `rode` (the set's Act) and no `caught`, the spring is
-- `did: rode` with its `quadrant` and writes no `caught` row in the setter's ledger, and the caster is told by trapStruck (the setter's account its actor, so a cast on one's own back tells nobody).
-- A cast of another card passes over the back; a cast a ward turns away never reaches it; a cast by the setter's own other mask springs it exactly the same; a catching back still catches; and the
-- spring's payload is held by its constraint. The cards are this file's own (rd...).

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
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
    ('rdchess', 'Rd Chess', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "outcome": {"kind": "ride", "share": 1}}', '{post}', null, null),
    ('rdcatch', 'Rd Catch', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null),
    ('rdmove', 'Rd Move', 'salty', 'uncommon', 'cast', null, '{post}', null, null),
    ('rdother', 'Rd Other', 'salty', 'common', 'cast', null, '{post}', null, null),
    ('rdward', 'Rd Ward', 'pepperoni', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "ward", "upTo": "uncommon"}')
  on conflict (key) do nothing;
end $$;

-- The facts of a spring Act as a test reads them.
create function pg_temp.spring_of(back uuid) returns jsonb language sql as $$
  select s.payload from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text
$$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rd-ann'); bob uuid := tests.account('rd-bob');
  a uuid := tests.character(ann, 'Rd Ann'); a2 uuid := tests.character(ann, 'Rd Ann Two'); b uuid := tests.character(bob, 'Rd Bob');
  t uuid := tests.thread('Rd ride');
  p uuid := tests.post(a, t, 'Chess.'); p2 uuid := tests.post(a, t, 'Passes.'); p3 uuid := tests.post(a, t, 'Warded.'); p4 uuid := tests.post(a, t, 'Own other mask.'); p5 uuid := tests.post(a, t, 'Catch.');
  back uuid; back2 uuid; back3 uuid; back4 uuid; back5 uuid; cast_ jsonb; cast_act uuid; sp jsonb; cp jsonb; why text; held_before integer; own_cast jsonb; own_cp jsonb; own_sp jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'rdchess', 'rdchess', 'rdchess', 'rdchess', 'rdcatch', 'rdward');
  perform pg_temp.hand(bob, 'rdmove', 'rdmove', 'rdmove', 'rdother', 'rdmove');
  perform pg_temp.hand(ann, 'rdmove');
  perform tests.become_service();

  -- A ride back is set naming its Move and a quadrant, or it is refused in words, writing and spending nothing.
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'rdchess', a, p, '{}', 'rdmove'));
  if why is distinct from '22023 this card names a reaction quadrant' then raise exception 'a ride back set with no quadrant: %', why; end if;
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'rdchess', a, p, '{"quadrant": "wide"}', 'rdmove'));
  if why is distinct from '22023 this card names a reaction quadrant' then raise exception 'a ride back set with a quadrant that is none: %', why; end if;
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'rdchess', a, p, '{"quadrant": "calmPositive"}'));
  if why is distinct from '22023 Rd Chess names no card to catch' then raise exception 'a ride back that names no card: %', why; end if;
  if exists (select 1 from acts where kind = 'set' and target_act_id = p) or card_held(ann, 'rdchess') is distinct from 4 then raise exception 'a refused ride back wrote or spent'; end if;
  back := (set_card(ann, 'rdchess', a, p, '{"quadrant": "excitedPositive"}', 0, 'rdmove') ->> 'id')::uuid;

  -- The named Move's cast springs it and lands as any cast does.
  held_before := card_held(bob, 'rdmove');
  cast_ := play_card(bob, 'rdmove', b, p, '{}', 0, '');
  cast_act := (cast_ ->> 'id')::uuid;
  select c.payload into cp from acts c where c.id = cast_act;
  if cp ->> 'layer' is distinct from '1' or cp ? 'caught' or cp ->> 'rode' is distinct from back::text then raise exception 'a cast that rode is not a landed cast carrying rode: %', cp; end if;
  if cast_ -> 'sprung' is null or cast_ -> 'sprung' -> 'payload' ->> 'did' is distinct from 'rode' then raise exception 'the answer does not say the back was ridden: %', cast_; end if;
  if card_held(bob, 'rdmove') is distinct from held_before - 1 then raise exception 'a cast that rode did not spend the caster''s card'; end if;
  sp := pg_temp.spring_of(back);
  if sp is null or sp ->> 'did' is distinct from 'rode' or sp ->> 'trigger' is distinct from 'cast' or sp ->> 'quadrant' is distinct from 'excitedPositive'
     or sp ->> 'by' is distinct from cast_act::text or sp ? 'caught' or sp ->> 'card' is distinct from 'rdchess' then
    raise exception 'the spring of a ridden back: %', sp;
  end if;
  if exists (select 1 from card_ledger where account = ann and kind = 'caught') then raise exception 'a ridden back wrote a caught row: the setter takes no card'; end if;
  if card_held(ann, 'rdmove') is distinct from 1 then raise exception 'the setter holds the cast Move after it was ridden'; end if;
  -- The cast is on the post as a live card; the back is over.
  if not exists (select 1 from jsonb_array_elements(card_target(p) -> 'effects') e where e ->> 'act' = cast_act::text) then raise exception 'the ridden cast is not a live card on the post'; end if;
  -- The caster is told by trapStruck, about their cast, and the setter by trapSprang (the alerts are read as the harness: no API role reads the table).
  perform tests.unbecome();
  if not exists (select 1 from alerts where kind = 'trapStruck' and account = bob and act = cast_act and character = b) then raise exception 'the caster of a ridden cast was not told'; end if;
  if not exists (select 1 from alerts where kind = 'trapSprang' and account = ann) then raise exception 'the setter of a ridden back was not told'; end if;
  perform tests.become_service();

  -- A cast of another card passes over the back: it lands, and the back stays set.
  back2 := (set_card(ann, 'rdchess', a, p2, '{"quadrant": "calmPositive"}', 0, 'rdmove') ->> 'id')::uuid;
  perform play_card(bob, 'rdother', b, p2, '{}', 0, '');
  if pg_temp.spring_of(back2) is not null then raise exception 'a cast of another card sprang the back'; end if;
  if not exists (select 1 from acts where kind = 'card' and target_act_id = p2 and payload ->> 'card' = 'rdother' and not (payload ? 'rode')) then raise exception 'the other card did not land plainly'; end if;

  -- A cast a ward turns away never reaches the back.
  perform play_card(ann, 'rdward', a, p3, '{}', 0, '');
  back3 := (set_card(ann, 'rdchess', a, p3, '{"quadrant": "boredNegative"}', 0, 'rdmove') ->> 'id')::uuid;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'rdmove', b, p3, '{}', ''));
  if why is null or why not like '42501%' then raise exception 'a warded cast was not turned away: %', why; end if;
  if pg_temp.spring_of(back3) is not null then raise exception 'a warded cast reached the back'; end if;

  -- A cast by the setter's own other mask springs it the same: the same payload, the same cast, and nobody is told of it.
  back4 := (set_card(ann, 'rdchess', a, p4, '{"quadrant": "excitedPositive"}', 0, 'rdmove') ->> 'id')::uuid;
  own_cast := play_card(ann, 'rdmove', a2, p4, '{}', 0, '');
  select c.payload into own_cp from acts c where c.id = (own_cast ->> 'id')::uuid;
  own_sp := pg_temp.spring_of(back4);
  if own_sp is null or own_sp ->> 'did' is distinct from 'rode' or own_sp ->> 'quadrant' is distinct from 'excitedPositive' then raise exception 'one''s own other mask did not ride the back: %', own_sp; end if;
  if (select array(select jsonb_object_keys(own_sp) order by 1)) is distinct from (select array(select jsonb_object_keys(sp) order by 1)) then raise exception 'a spring by one''s own mask is shaped differently: % / %', own_sp, sp; end if;
  if (select array(select jsonb_object_keys(own_cp) order by 1)) is distinct from (select array(select jsonb_object_keys(cp) order by 1)) then raise exception 'a cast by one''s own mask is shaped differently: % / %', own_cp, cp; end if;
  perform tests.unbecome();
  if exists (select 1 from alerts where kind = 'trapStruck' and act = (own_cast ->> 'id')::uuid) then raise exception 'a cast on one''s own back told its caster'; end if;
  perform tests.become_service();

  -- A catching back still catches.
  back5 := (set_card(ann, 'rdcatch', a, p5, '{}', 0, 'rdmove') ->> 'id')::uuid;
  perform play_card(bob, 'rdmove', b, p5, '{}', 0, '');
  sp := pg_temp.spring_of(back5);
  if sp is null or sp ->> 'did' is distinct from 'caught' or sp ? 'quadrant' or sp ->> 'caught' is null then raise exception 'a catching back no longer catches: %', sp; end if;
  if (select count(*) from card_ledger where account = ann and kind = 'caught' and card = 'rdmove') is distinct from 1::bigint then raise exception 'the caught card did not go to the setter'; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = p5 and payload ->> 'card' = 'rdmove' and not (payload ? 'caught')) then raise exception 'a caught cast landed as well'; end if;
end $$;

-- ---- The spring's payload is held: a ride names its quadrant, and a catch names none ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rd-c-ann'); a uuid := tests.character(ann, 'Rd C Ann');
  t uuid := tests.thread('Rd constraint'); p uuid := tests.post(a, t, 'Held.'); sset uuid; why text;
begin
  sset := tests.act(a, 'set', t, '{}', p);
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rdchess', 'trigger', 'cast', 'did', 'rode', 'set', %L, 'by', %L), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a rode spring with no quadrant was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rdchess', 'trigger', 'cast', 'did', 'rode', 'set', %L, 'by', %L, 'quadrant', 'wide'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a rode spring with a quadrant that is none was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rdcatch', 'trigger', 'cast', 'did', 'caught', 'set', %L, 'by', %L, 'caught', %L, 'quadrant', 'calmPositive'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a caught spring naming a quadrant was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rdchess', 'trigger', 'quote', 'did', 'rode', 'set', %L, 'by', %L, 'quadrant', 'calmPositive'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a rode spring on a quote was let in: %', why; end if;
  why := pg_temp.coded(format($q$select tests.act(%L, 'spring', %L, jsonb_build_object('card', 'rdchess', 'trigger', 'cast', 'did', 'rode', 'set', %L, 'by', %L, 'quadrant', 'calmPositive'), %L)$q$, a, t, sset::text, gen_random_uuid()::text, p));
  if why is not null then raise exception 'a rode spring with a quadrant was refused: %', why; end if;
  -- The index the settlement reads springs by.
  if not exists (select 1 from pg_indexes where indexname = 'acts_spring_by' and tablename = 'acts') then raise exception 'acts_spring_by is missing'; end if;
end $$;
