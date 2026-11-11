-- A skim: a cast card whose play pays its caster a share of a vote for the votes its post draws in a quadrant the play names
-- (supabase/migrations/0151_card_payouts.sql; docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 4). What is held here is the play, never the pay (the settlement's, Task 5):
-- the play names one of the four reaction quadrants, lasts a time out as a Use does (`ends`), is one live play of the card per quadrant on a post, and lands on a post of the caster's own other
-- mask exactly as on a stranger's (every case is run as the two players, with the same answer); card_target sends the quadrant of a live play; a face-down skim card lands from its back
-- only where it could have been cast; and the seed's check (card_kinds_problem) is red on each poisoned card, in the engine's words, and green on a good one. The cards are this file's own (pa...).

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
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, skim, stack) values
    ('pamooch', 'Pa Mooch', 'salty', 'uncommon', 'cast', null, '{post}', interval '7 days', '{"share": 0.1}', 4),
    ('pamove', 'Pa Move', 'salty', 'uncommon', 'cast', null, '{post}', null, null, 1)
  on conflict (key) do nothing;
end $$;

-- ---- A skim lands with its end a week out, names its quadrant, and is one live play per quadrant on the post ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pa-ann'); bob uuid := tests.account('pa-bob');
  a uuid := tests.character(ann, 'Pa Ann'); b uuid := tests.character(bob, 'Pa Bob'); b2 uuid := tests.character(bob, 'Pa Bob Two');
  t uuid := tests.thread('Pa skim');
  p uuid := tests.post(a, t, 'A stranger''s post.'); own uuid := tests.post(b2, t, 'Bob''s own other mask''s post.');
  landed jsonb; own_landed jsonb; why text; own_why text; pl jsonb; own_pl jsonb; effects jsonb; played integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'pamooch', 'pamooch', 'pamooch', 'pamooch', 'pamooch', 'pamooch', 'pamooch');
  perform tests.become_service();

  -- The play lands, with its layer and its end a week out, as a Use's is written.
  landed := play_card(bob, 'pamooch', b, p, '{"quadrant": "excitedPositive"}', 0, '');
  select a2.payload into pl from acts a2 where a2.id = (landed ->> 'id')::uuid;
  if (pl ->> 'ends')::timestamptz is distinct from now() + interval '7 days' then raise exception 'a skim play does not carry its end a week out: %', pl; end if;
  if pl ->> 'layer' is distinct from '1' or pl ? 'caught' or pl #>> '{config,quadrant}' is distinct from 'excitedPositive' then raise exception 'a skim play is not an ordinary card play with its configuration: %', pl; end if;

  -- The same on a post of the caster's own other mask: it lands as it does on a stranger's, and nothing in what comes back says whose the post is.
  own_landed := play_card(bob, 'pamooch', b, own, '{"quadrant": "excitedPositive"}', 0, '');
  select a2.payload into own_pl from acts a2 where a2.id = (own_landed ->> 'id')::uuid;
  if (select array(select jsonb_object_keys(pl) order by 1)) is distinct from (select array(select jsonb_object_keys(own_pl) order by 1)) then
    raise exception 'a skim on one''s own other mask''s post is shaped differently: % / %', pl, own_pl;
  end if;
  if (select array(select jsonb_object_keys(landed) order by 1)) is distinct from (select array(select jsonb_object_keys(own_landed) order by 1)) then
    raise exception 'the answers to a skim on a stranger''s and on one''s own other mask''s post differ: % / %', landed, own_landed;
  end if;

  -- A second on the same quadrant is refused, in the same words, on either post; one on another quadrant lands on each.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, p, '{"quadrant": "excitedPositive"}', ''));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, own, '{"quadrant": "excitedPositive"}', ''));
  if why is distinct from '23505 this post already carries that card for that quadrant' then raise exception 'a second skim on one quadrant: %', why; end if;
  if own_why is distinct from why then raise exception 'a refusal on one''s own other mask''s post is told apart: % / %', own_why, why; end if;
  perform play_card(bob, 'pamooch', b, p, '{"quadrant": "calmPositive"}', 0, '');
  perform play_card(bob, 'pamooch', b, own, '{"quadrant": "calmPositive"}', 0, '');
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'pamooch') is distinct from 2::bigint then raise exception 'the other quadrant did not land beside the first'; end if;

  -- A play with no quadrant, or one that is not a quadrant, is refused in the same words on either post, and writes nothing and spends nothing.
  select count(*) into played from card_ledger where account = bob and kind = 'played';
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, p, '{}', ''));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, own, '{}', ''));
  if why is distinct from '22023 this card names a reaction quadrant' or own_why is distinct from why then raise exception 'a skim with no quadrant: % / %', why, own_why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, p, '{"quadrant": "sideways"}', ''));
  if why is distinct from '22023 this card names a reaction quadrant' then raise exception 'a skim naming no quadrant: %', why; end if;
  if (select count(*) from card_ledger where account = bob and kind = 'played') is distinct from played::bigint then raise exception 'a refused skim spent a card'; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'pamooch') is distinct from 2::bigint then raise exception 'a refused skim wrote a play'; end if;

  -- A card that is no skim keeps its own stack, whatever its configuration says.
  perform pg_temp.hand(bob, 'pamove', 'pamove');
  perform play_card(bob, 'pamove', b, p, '{"quadrant": "excitedPositive"}', 0, '');
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamove', b, p, '{"quadrant": "calmPositive"}', ''));
  if why is distinct from '23505 this post already carries that card' then raise exception 'a card that is no skim lost its stack: %', why; end if;

  -- card_target sends the quadrant of a live skim play, and none for a card that is no skim.
  effects := card_target(p) -> 'effects';
  if (select count(*) from jsonb_array_elements(effects) e where e ->> 'card' = 'pamooch' and e ->> 'quadrant' in ('excitedPositive', 'calmPositive') and e ? 'ends') is distinct from 2::bigint then
    raise exception 'card_target does not send a skim play''s quadrant and end: %', effects;
  end if;
  if exists (select 1 from jsonb_array_elements(effects) e where e ->> 'card' = 'pamove' and e ? 'quadrant') then raise exception 'card_target sent a quadrant for a card that is no skim'; end if;
end $$;

-- ---- After the first ends by its time, a new one on its quadrant lands; an admin's end frees it as well ----
select tests.unbecome();
do $$
declare
  bob uuid := tests.account('pa-t-bob'); ann uuid := tests.account('pa-t-ann');
  a uuid := tests.character(ann, 'Pa T Ann'); b uuid := tests.character(bob, 'Pa T Bob');
  t uuid := tests.thread('Pa time');
  p uuid := tests.post(a, t, 'Old Mooch.'); q uuid := tests.post(a, t, 'Ended Mooch.');
  old uuid; ended uuid; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'pamooch', 'pamooch', 'pamooch');
  -- A Mooch from eight days ago, its week passed.
  old := tests.act(b, 'card', t, jsonb_build_object('card', 'pamooch', 'message', '', 'config', '{"quadrant": "boredNegative"}'::jsonb, 'layer', 1, 'ends', now() - interval '1 day'), p, now() - interval '8 days');
  perform tests.become_service();
  perform play_card(bob, 'pamooch', b, p, '{"quadrant": "boredNegative"}', 0, '');
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'pamooch') is distinct from 2::bigint then raise exception 'a new skim on a quadrant whose last one ended by its time did not land'; end if;
  if (select payload ->> 'layer' from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'pamooch' order by created_at desc, id desc limit 1) is distinct from '2' then raise exception 'the new skim did not take the next layer'; end if;

  -- One an admin ended frees its quadrant.
  perform tests.unbecome();
  ended := tests.act(b, 'card', t, jsonb_build_object('card', 'pamooch', 'message', '', 'config', '{"quadrant": "calmPositive"}'::jsonb, 'layer', 1, 'ends', now() + interval '3 days'), q, now() - interval '1 day');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, ended, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pamooch', b, q, '{"quadrant": "calmPositive"}', ''));
  if why is not null then raise exception 'a skim on a quadrant an admin freed was refused: %', why; end if;
end $$;

-- ---- A face-down skim card lands from its back on a quoting post only where it could have been cast ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pa-f-ann'); bob uuid := tests.account('pa-f-bob');
  a uuid := tests.character(ann, 'Pa F Ann'); b uuid := tests.character(bob, 'Pa F Bob');
  t uuid := tests.thread('Pa face down');
  p uuid := tests.post(a, t, 'Backed with a Mooch.'); q1 uuid := tests.post(b, t, 'Quote one.'); q2 uuid := tests.post(b, t, 'Quote two.');
  back uuid; sprung jsonb; landed uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pamooch', 'pamooch');
  perform tests.become_service();
  back := (set_card(ann, 'pamooch', a, p, '{"quadrant": "excitedNegative"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  -- A quoting post that already carries a live Mooch on that quadrant: the back stays set, as a Move that cannot land does.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'pamooch', 'message', '', 'config', '{"quadrant": "excitedNegative"}'::jsonb, 'layer', 1, 'ends', now() + interval '2 days'), q1);
  sprung := spring_traps('quote', p, q1);
  if sprung is not null then raise exception 'a face-down skim landed on a post already carrying that quadrant: %', sprung; end if;
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a back that could not land sprang'; end if;
  -- A quoting post with none: it lands, with its end a week out and its configuration.
  sprung := spring_traps('quote', p, q2);
  if sprung is null then raise exception 'a face-down skim did not land on a post free of that quadrant'; end if;
  landed := (sprung -> 'struck' ->> 'id')::uuid;
  if not exists (select 1 from acts where id = landed and target_act_id = q2 and payload ->> 'card' = 'pamooch' and payload #>> '{config,quadrant}' = 'excitedNegative'
                 and (payload ->> 'ends')::timestamptz = now() + interval '7 days') then
    raise exception 'the landed skim is not written as a cast one is: %', (select payload from acts where id = landed);
  end if;
end $$;

-- ---- A face-down skim card lands beside a live skim of another quadrant; a back holding a bad quadrant stays set ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pa-g-ann'); bob uuid := tests.account('pa-g-bob');
  a uuid := tests.character(ann, 'Pa G Ann'); b uuid := tests.character(bob, 'Pa G Bob');
  t uuid := tests.thread('Pa face down two');
  p uuid := tests.post(a, t, 'Backed with a Mooch.'); q1 uuid := tests.post(b, t, 'Quote one.');
  p2 uuid := tests.post(a, t, 'Backed badly.'); q2 uuid := tests.post(b, t, 'Quote two.');
  back uuid; sprung jsonb; landed uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pamooch', 'pamooch');
  perform tests.become_service();
  back := (set_card(ann, 'pamooch', a, p, '{"quadrant": "excitedNegative"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  -- A live Mooch on another quadrant of the quoting post leaves this quadrant free: the back lands.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'pamooch', 'message', '', 'config', '{"quadrant": "calmPositive"}'::jsonb, 'layer', 1, 'ends', now() + interval '2 days'), q1);
  sprung := spring_traps('quote', p, q1);
  if sprung is null then raise exception 'a face-down skim did not land beside a live skim of another quadrant'; end if;
  landed := (sprung -> 'struck' ->> 'id')::uuid;
  if not exists (select 1 from acts where id = landed and target_act_id = q1 and payload #>> '{config,quadrant}' = 'excitedNegative') then raise exception 'the landed skim names the wrong quadrant'; end if;
  -- A back whose configuration names no quadrant of the four stays set when it is quoted, as a Move that cannot land does.
  perform pg_temp.hand(ann, 'pamooch');
  perform tests.become_service();
  back := (set_card(ann, 'pamooch', a, p2, '{"quadrant": "nonsense"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  sprung := spring_traps('quote', p2, q2);
  if sprung is not null then raise exception 'a face-down skim with a bad quadrant landed: %', sprung; end if;
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a back with a bad quadrant sprang'; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = q2) then raise exception 'a bad quadrant wrote a play'; end if;
end $$;

-- ---- The seed's check: red on each poisoned card, in the engine's words, then green ----
create function pg_temp.problem(card jsonb) returns text language sql as $$ select card_kinds_problem(jsonb_build_array(card)) $$;

do $$
declare
  poison constant jsonb := jsonb_build_array(
    jsonb_build_array('{"key": "pr1", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "ride", "share": 0}}',
      'card "pr1" has a ride of 0; share is above 0 and at most 1'),
    jsonb_build_array('{"key": "pr2", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "ride"}}',
      'card "pr2" has a ride with no share; share is above 0 and at most 1'),
    jsonb_build_array('{"key": "pr3", "rarity": "common", "play": "use", "reaches": ["character"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "ride", "share": 0.5}}',
      'card "pr3" has a ride, and a card with a ride reaches a post alone'),
    jsonb_build_array('{"key": "pr4", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "boost"}}',
      'card "pr4" has a gimmick of kind "boost"; a gimmick is ward, earn, price or ride'),
    jsonb_build_array('{"key": "pr5", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "match": {"upTo": "common"}, "outcome": {"kind": "ride", "share": 1}}}',
      'card "pr5" has an outcome beside a match; a ride outcome names its card (catches)'),
    jsonb_build_array('{"key": "pr6", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "visit"}, "outcome": {"kind": "ride", "share": 1}}}',
      'card "pr6" has an outcome, and only a set card that springs on a cast does'),
    jsonb_build_array('{"key": "pr7", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "outcome": {"kind": "catch", "share": 1}}}',
      'card "pr7" has an outcome of kind "catch"; an outcome is ride'),
    jsonb_build_array('{"key": "pr8", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "outcome": {"kind": "ride", "share": 0}}}',
      'card "pr8" has an outcome of share 0; share is above 0 and at most 1'),
    jsonb_build_array('{"key": "pr9", "rarity": "uncommon", "play": "use", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "ward", "upTo": "common"}, "skim": {"share": 0.1}}',
      'card "pr9" has a skim, and only a cast card does'),
    jsonb_build_array('{"key": "pra", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "skim": {"share": 0.1}}',
      'card "pra" has a skim with no time up (lasts); a skim ends at its time'),
    jsonb_build_array('{"key": "prb", "rarity": "uncommon", "play": "cast", "reaches": ["post", "thread"], "lasts": {"unit": "day", "count": 1}, "skim": {"share": 0.1}}',
      'card "prb" has a skim, and a card with a skim reaches a post alone'),
    jsonb_build_array('{"key": "prc", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "lasts": {"unit": "day", "count": 1}, "skim": {"share": 2}}',
      'card "prc" has a skim of 2; share is above 0 and at most 1'),
    jsonb_build_array('{"key": "prd", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "lasts": {"unit": "day", "count": 1}, "skim": {"share": 0.1}, "writes": true}',
      'card "prd" has a skim and writes; a card with a skim does not write'),
    jsonb_build_array('{"key": "pre", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "scoresAs": true}',
      'card "pre" scores as a class, and a card that does reaches a character alone'),
    jsonb_build_array('{"key": "prf", "rarity": "uncommon", "play": "cast", "reaches": ["character"], "lasts": {"unit": "day", "count": 2}, "scoresAs": false}',
      'card "prf" has scoresAs false; scoresAs is true or left out'),
    jsonb_build_array('{"key": "prg", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "lasts": {"unit": "day", "count": 1}}',
      'card "prg" has a time up (lasts), and only a Use card or a card reaching beyond a post does')
  );
  good constant jsonb := jsonb_build_array(
    '{"key": "ok1", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "skim": {"share": 0.1}}',
    '{"key": "ok2", "rarity": "legendary", "play": "cast", "reaches": ["character"], "lasts": {"unit": "day", "count": 2}, "scoresAs": true}',
    '{"key": "ok3", "rarity": "uncommon", "play": "use", "reaches": ["post"], "lasts": {"unit": "week", "count": 1}, "gimmick": {"kind": "ride", "share": 0.5}}',
    '{"key": "ok4", "rarity": "uncommon", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "outcome": {"kind": "ride", "share": 1}}}'
  );
  p jsonb; got text; g jsonb;
begin
  for p in select * from jsonb_array_elements(poison) loop
    got := pg_temp.problem((p ->> 0)::jsonb);
    if got is null or position((p ->> 1) in got) = 0 then raise exception 'the seed check did not refuse % in the engine''s words (%): %', p -> 0, p ->> 1, got; end if;
  end loop;
  for g in select * from jsonb_array_elements(good) loop
    got := pg_temp.problem((g #>> '{}')::jsonb);
    if got is not null then raise exception 'the seed check refused a good card %: %', g, got; end if;
  end loop;
  -- A card that is no ride, skim or scored-as one is refused for none of these.
  if pg_temp.problem('{"key": "ok5", "rarity": "common", "play": "cast", "reaches": ["post"]}') is not null then raise exception 'a plain card was refused'; end if;
end $$;

-- ---- The catalog's own checks hold the pairings the seed's check does ----
select tests.unbecome();
do $$
declare why text;
begin
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, skim, lasts) values ('pbskim', 'Pb', 'salty', 'common', 'use', '{post}', '{"share": 0.1}', interval '1 day')$q$);
  if why is null or why not like '23514%card_kinds_skim_cast%' then raise exception 'a skim on a use card was let in the catalog: %', why; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, skim) values ('pbskim2', 'Pb', 'salty', 'common', 'cast', '{post}', '{"share": 0.1}')$q$);
  if why is null or why not like '23514%card_kinds_skim_cast%' then raise exception 'a skim with no lasts was let in the catalog: %', why; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, scores_as) values ('pbscore', 'Pb', 'salty', 'common', 'cast', '{post}', true)$q$);
  if why is null or why not like '23514%card_kinds_scores_as_cast%' then raise exception 'scores_as on a post card was let in the catalog: %', why; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick) values ('pbride', 'Pb', 'salty', 'common', 'use', '{post,character}', interval '1 day', '{"kind": "ride", "share": 0.5}')$q$);
  if why is null or why not like '23514%card_kinds_ride_post%' then raise exception 'a ride on a character card was let in the catalog: %', why; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, trap) values ('pboutcome', 'Pb', 'salty', 'common', 'set', '{post}', '{"trigger": {"on": "visit"}, "outcome": {"kind": "ride", "share": 1}}')$q$);
  if why is null or why not like '23514%card_kinds_outcome_set%' then raise exception 'an outcome on a visit trap was let in the catalog: %', why; end if;
end $$;

-- ---- A key that opens with a digit can be met (the catalog's check and meet_card agree) ----
do $$
declare ann uuid := tests.account('pa-m-ann'); said jsonb; why text;
begin
  perform tests.become(ann);
  said := meet_card('4d-chess');
  if said -> 'cards_met' is distinct from '["4d-chess"]'::jsonb then raise exception 'a card whose key opens with a digit was not kept as met: %', said; end if;
  why := pg_temp.coded($q$select meet_card('-chess')$q$);
  if why is distinct from '22023 a card is named in lowercase words joined by hyphens' then raise exception 'a key opening with a hyphen: %', why; end if;
end $$;
