-- Scored as: a cast card on a character that names a class the character is scored as for the window after the next settlement
-- (supabase/migrations/0151_card_payouts.sql; docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 4). The play names a class the instance has; the window it names (scored_as_window) must be
-- nameable (the next settlement's time is known, and the season does not end at it); a character has one class named per window, by any scored-as card, unless an admin ended the play; the
-- play's `starts` and `ends` (and its play_reach end) are the window's two edges; and nothing but the play is written (no Turn, no class_history row). A face-down scored-as card lands from its back
-- only where it could have been cast. Every refusal is run as the two players (a stranger's character and one's own other mask) with the same answer. The cards are this file's own (sf...).
--
-- The suite's earlier files may leave a settlement committed, even one dated after now(), so this file never assumes the last settlement's date: it reads it (`last_end`), and where it needs a play that was
-- "made in the open window" it writes one dated just after that settlement (sf_named), as a play made then would be. The file ends by moving the season on, so that no window can be named.

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
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, scores_as, stack) values
    ('sfoff', 'Sf Off', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', true, 5),
    ('sfoff2', 'Sf Off Two', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', true, 5)
  on conflict (key) do nothing;
end $$;

-- A scored-as play made at `at` on a character, written as place_cast writes one (its Act and its reach row).
create function pg_temp.sf_named(by_character uuid, target uuid, thread uuid, post uuid, at timestamptz, closes timestamptz) returns uuid language plpgsql as $$
declare act uuid;
begin
  act := tests.act(by_character, 'card', thread, jsonb_build_object('card', 'sfoff', 'message', '', 'config', '{"class": "beta"}'::jsonb, 'reach', 'character', 'character', target,
    'ends', closes, 'starts', closes - interval '1 day', 'targetName', 'x'), post, at);
  insert into play_reach (play, reach, character, ends_at) values (act, 'character', target, closes);
  return act;
end $$;

-- The last settled window's end: this file's own settlement where the suite left none.
create function pg_temp.last_end() returns timestamptz language plpgsql as $$
begin
  if not exists (select 1 from settlements) then
    insert into settlements (starts_at, ends_at, season) values (now() - interval '29 hours', now() - interval '5 hours', (select id from seasons where ends_at is null));
  end if;
  return (select max(ends_at) from settlements);
end $$;

-- ---- Race: a quote that springs a face-down Off Day on its own character, and a cast of the same on that character at once ----
-- Races first, so the rows they commit wait on nothing this file has written. The quote lands the back's play on the quoting character (spring_traps -> spring_facts -> lay_sprung) and the cast lands one on it
-- (place_cast); a character has one class named per window, so whichever lands second must find the first. Both read "none named" unless the two are laid one at a time, which is the lock on the character's
-- row: place_cast takes it as the target's, and the quote takes it as the poster's (lock_for_quote's step 2b, taken whenever the quoted post holds a live back, a public fact), before spring_facts reads
-- `class_taken`. Whichever lands, the character carries exactly one, the quote is never refused, and nothing deadlocks. The window needs a settlement behind it, committed here where the suite left none and
-- removed again after. A cast that lost is refused by either rule: "already has a class named" where the suite's last settlement is not after now(), and, where it is (a play made now is then
-- before the last settled window's end, so the one-per-window rule never sees it), the stack rule's "already carries that card" on the back's play; what is held is the count of plays naming the window.
do $$
declare
  setter uuid := gen_random_uuid(); caster uuid := gen_random_uuid(); quoter uuid;
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid(); q uuid; qpost uuid; x uuid; qquote uuid;
  t uuid := gen_random_uuid();
  made boolean := false;
  said text[];
  round integer;
  landed bigint;
begin
  if not exists (select 1 from settlements) then
    perform tests.commit(format($sql$insert into settlements (starts_at, ends_at, season) values (now() - interval '29 hours', now() - interval '5 hours', (select id from seasons where ends_at is null))$sql$));
    made := true;
  end if;
  perform tests.commit(format($sql$
    insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, scores_as, stack) values
      ('sfrace', 'Sf Race', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', true, 1) on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'sf-race-setter-' || %1$L || '@test.invalid'), (%2$L, 'sf-race-caster-' || %2$L || '@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Sf Race Setter', now(), now()), (%4$L, %2$L, 'Sf Race Caster', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into threads (id, board, title) select %5$L, b.id, 'Sf race' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'sfrace', 'bought', 0 from generate_series(1, 12);
    insert into card_ledger (account, card, kind, price) select %2$L, 'sfrace', 'bought', 0 from generate_series(1, 12);
  $sql$, setter, caster, s, c, t));
  for round in 1 .. 12 loop
    q := gen_random_uuid(); qpost := gen_random_uuid(); x := gen_random_uuid(); quoter := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%5$L, 'sf-race-quoter-' || %5$L || '@test.invalid');
      insert into accounts (id) values (%5$L);
      insert into characters (id, owner, name, created_at, debuted_at) values (%1$L, %5$L, 'Sf Race Quoter ' || %6$s, now(), now());
      insert into class_history (character, class_key, started_at) values (%1$L, 'alpha', now());
      insert into acts (id, character, kind, thread, payload) values (%2$L, %1$L, 'post', %4$L, '{"body": "Soon to be named."}'), (%3$L, %7$L, 'post', %4$L, '{"body": "Backed."}');
      do $d$ begin perform set_card(%8$L, 'sfrace', %7$L, %3$L, '{"class": "beta"}', 0); end $d$;
    $sql$, q, qpost, x, t, quoter, round, s, setter));
    said := tests.race_as(quoter, format('select post(%L, %L, %L, %L)', t, q, 'Quoting it.', x),
                          null, format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', caster, 'sfrace', c, q, '{"class": "alpha"}', '', 'character', qpost));
    if said[1] is not null then raise exception 'a quote that lands an Off Day was refused, round %: %', round, said[1]; end if;
    if said[2] is not null and said[2] not like '%already has a class named%' and said[2] not like '%already carries that card%' then raise exception 'a cast of an Off Day racing a quote, round %: %', round, said[2]; end if;
    select count(*) into landed from acts where kind = 'card' and payload ->> 'card' = 'sfrace' and payload ->> 'reach' = 'character' and payload ->> 'character' = q::text;
    if landed is distinct from 1::bigint then
      raise exception 'a quote and a cast at once on one character, round %: the character has % class(es) named for the window (cast said %, back sprang %)', round, landed, said[2],
        exists (select 1 from acts where kind = 'spring' and target_act_id = x);
    end if;
    -- Whichever won, the other lost cleanly: a refused cast means the back landed; a landed cast means the back is still set.
    if (said[2] is not null) is distinct from exists (select 1 from acts where kind = 'spring' and target_act_id = x) then
      raise exception 'a quote and a cast at once, round %: cast said %, back sprang %', round, said[2], exists (select 1 from acts where kind = 'spring' and target_act_id = x);
    end if;
  end loop;
  if made then perform tests.commit('delete from settlements'); end if;
end $$;

-- ---- The class, the window, one per window, and what is written ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sf-ann'); bob uuid := tests.account('sf-bob');
  a uuid := tests.character(ann, 'Sf Ann'); a2 uuid := tests.character(ann, 'Sf Ann Two'); a3 uuid := tests.character(ann, 'Sf Ann Three'); b uuid := tests.character(bob, 'Sf Bob', 'beta');
  t uuid := tests.thread('Sf window'); p uuid := tests.post(a, t, 'Ann.'); p2 uuid := tests.post(a2, t, 'Ann two.'); p3 uuid := tests.post(a3, t, 'Ann three.');
  last_end timestamptz := pg_temp.last_end(); opens timestamptz := next_settlement_at(); closes timestamptz;
  landed jsonb; own_landed jsonb; pl jsonb; own_pl jsonb; why text; own_why text; reach_end timestamptz;
  acts_before bigint; hist_before bigint; pending_before bigint; witness uuid;
begin
  if opens is null or opens <= last_end then raise exception 'this file''s window is not nameable here: % after %', opens, last_end; end if;
  closes := opens + interval '1 day';
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'sfoff', 'sfoff', 'sfoff', 'sfoff', 'sfoff2', 'sfoff2');
  perform pg_temp.hand(ann, 'sfoff', 'sfoff', 'sfoff');
  perform tests.become_service();

  -- An unknown class, or none, is refused in the same words on either target.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a, '{"class": "gamma"}', '', 'character', p));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'sfoff', a, a2, '{"class": "gamma"}', '', 'character', p2));
  if why is distinct from '22023 there is no such class' or own_why is distinct from why then raise exception 'an Off Day naming no class: % / %', why, own_why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a, '{}', '', 'character', p));
  if why is distinct from '22023 there is no such class' then raise exception 'an Off Day naming nothing: %', why; end if;

  -- Where the season ends at the next settlement, there is no window after it to name.
  perform tests.unbecome();
  update seasons set ends_at = opens where ends_at is null;
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a, '{"class": "beta"}', '', 'character', p));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'sfoff', a, a2, '{"class": "beta"}', '', 'character', p2));
  if why is distinct from '55000 this season ends at the next settlement, so there is no window after it to name' or own_why is distinct from why then raise exception 'an Off Day at a season''s end: % / %', why, own_why; end if;
  perform tests.unbecome();
  update seasons set ends_at = null where number = 1;
  perform tests.become_service();

  -- A play lands: its window is the one after the next settlement, and it writes the play and nothing else.
  select count(*) into acts_before from acts; select count(*) into hist_before from class_history; select count(*) into pending_before from pending_turns;
  landed := play_card(bob, 'sfoff', b, a, '{"class": "beta"}', 0, '', 'character', p);
  select c.payload into pl from acts c where c.id = (landed ->> 'id')::uuid;
  if (pl ->> 'starts')::timestamptz is distinct from opens or (pl ->> 'ends')::timestamptz is distinct from closes or pl ->> 'reach' is distinct from 'character' or pl #>> '{config,class}' is distinct from 'beta' then
    raise exception 'an Off Day does not carry its window: %', pl;
  end if;
  select r.ends_at into reach_end from play_reach r where r.play = (landed ->> 'id')::uuid;
  if reach_end is distinct from closes then raise exception 'the play_reach end is not the window''s close: %', reach_end; end if;
  if (select count(*) from acts) is distinct from acts_before + 1 then raise exception 'an Off Day wrote more than its play: % Acts', (select count(*) from acts) - acts_before; end if;
  if (select count(*) from class_history) is distinct from hist_before or (select count(*) from pending_turns) is distinct from pending_before then raise exception 'an Off Day touched the target''s classes or Turns'; end if;
  if (select class_key from class_now(a, 'infinity')) is distinct from 'alpha' then raise exception 'an Off Day changed the target''s class'; end if;

  -- On one's own other mask it lands as on a stranger's, with the same shape.
  own_landed := play_card(ann, 'sfoff', a, a2, '{"class": "beta"}', 0, '', 'character', p2);
  select c.payload into own_pl from acts c where c.id = (own_landed ->> 'id')::uuid;
  if (select array(select jsonb_object_keys(own_pl) order by 1)) is distinct from (select array(select jsonb_object_keys(pl) order by 1)) then raise exception 'an Off Day on one''s own other mask is shaped differently: % / %', own_pl, pl; end if;
  if (own_pl ->> 'starts')::timestamptz is distinct from opens or (own_pl ->> 'ends')::timestamptz is distinct from closes then raise exception 'an Off Day on one''s own other mask names another window: %', own_pl; end if;
  if (select array(select jsonb_object_keys(landed) order by 1)) is distinct from (select array(select jsonb_object_keys(own_landed) order by 1)) then raise exception 'the answers differ with the target''s owner: % / %', landed, own_landed; end if;

  -- A character with a class named in the open window (a play made just after the last settlement): a second is refused, by the same or another scored-as card, in the same words whoever casts it.
  witness := pg_temp.sf_named(b, a3, t, p3, last_end + interval '1 hour', closes);
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a3, '{"class": "alpha"}', '', 'character', p3));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'sfoff', a, a3, '{"class": "alpha"}', '', 'character', p3));
  if why is distinct from '23505 this character already has a class named for the window after the next settlement' or own_why is distinct from why then raise exception 'a second Off Day in a window: % / %', why, own_why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff2', b, a3, '{"class": "alpha"}', '', 'character', p3));
  if why is distinct from '23505 this character already has a class named for the window after the next settlement' then raise exception 'another scored-as card in the same window: %', why; end if;
  if exists (select 1 from acts where kind = 'card' and payload ->> 'card' = 'sfoff2') or card_held(bob, 'sfoff2') is distinct from 2 then raise exception 'a refused Off Day wrote a play or spent a card'; end if;

  -- An admin's end of that play frees the window.
  perform tests.unbecome();
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, witness, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff2', b, a3, '{"class": "alpha"}', '', 'character', p3));
  if why is not null then raise exception 'an Off Day after an admin ended the one for the window was refused: %', why; end if;
end $$;

-- ---- A face-down Off Day lands from its back only where the cast could have: the window nameable and none named yet ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sf-f-ann'); bob uuid := tests.account('sf-f-bob');
  a uuid := tests.character(ann, 'Sf F Ann'); b uuid := tests.character(bob, 'Sf F Bob'); c uuid := tests.character(bob, 'Sf F Bob Two'); d uuid := tests.character(bob, 'Sf F Bob Three');
  t uuid := tests.thread('Sf face down');
  p1 uuid := tests.post(a, t, 'Backed one.'); p2 uuid := tests.post(a, t, 'Backed two.'); p3 uuid := tests.post(a, t, 'Backed three.');
  q1 uuid := tests.post(b, t, 'Quote one.'); q2 uuid := tests.post(c, t, 'Quote two.'); q3 uuid := tests.post(d, t, 'Quote three.');
  last_end timestamptz := pg_temp.last_end(); opens timestamptz := next_settlement_at(); closes timestamptz := next_settlement_at() + interval '1 day';
  back1 uuid; back2 uuid; back3 uuid; sprung jsonb; landed uuid; pl jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'sfoff', 'sfoff2', 'sfoff');
  perform tests.become_service();
  back1 := (set_card(ann, 'sfoff', a, p1, '{"class": "beta"}', 0) ->> 'id')::uuid;
  back2 := (set_card(ann, 'sfoff2', a, p2, '{"class": "beta"}', 0) ->> 'id')::uuid;
  back3 := (set_card(ann, 'sfoff', a, p3, '{"class": "gamma"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  -- The quoting character has none named: it lands, with the window's two edges.
  sprung := spring_traps('quote', p1, q1);
  if sprung is null then raise exception 'a face-down Off Day did not land on a character with none named'; end if;
  landed := (sprung -> 'struck' ->> 'id')::uuid;
  select x.payload into pl from acts x where x.id = landed;
  if (pl ->> 'starts')::timestamptz is distinct from opens or (pl ->> 'ends')::timestamptz is distinct from closes or pl ->> 'reach' is distinct from 'character' then raise exception 'the landed Off Day does not carry its window: %', pl; end if;
  if (select r.ends_at from play_reach r where r.play = landed) is distinct from closes or not exists (select 1 from play_reach r where r.play = landed and r.character = b) then raise exception 'the landed Off Day is not on the quoting character through the window''s close'; end if;
  -- A quoting character with a class already named for the window (a play made just after the last settlement): the back stays set, as a Move that cannot land does.
  perform pg_temp.sf_named(a, c, t, q2, last_end + interval '1 hour', closes);
  sprung := spring_traps('quote', p2, q2);
  if sprung is not null then raise exception 'a face-down Off Day landed in a window that had one named: %', sprung; end if;
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back2::text) then raise exception 'a back that could not land sprang'; end if;
  -- A class the instance lacks never lands (it would stop the settlement), whoever quotes.
  sprung := spring_traps('quote', p3, q3);
  if sprung is not null then raise exception 'a face-down Off Day naming no class landed: %', sprung; end if;
end $$;

-- ---- The stack meets the window: a card of stack 2 names the next window while this one's play is still up; a card of stack 1 does not ----
-- A play's play_reach end is its window's close, so after the settlement that opens a window the play that named it is still up until the settlement that closes it, and the character's next play (naming the window
-- after) finds one up. Stack 2 has room for that one and a third at the settlement after; stack 1 refuses it with the stack's own words ("this character already carries that card"), not the window's. This file cannot
-- let time pass, so the settlements are written as the settlements that close each window and the passing of W1's close is written on the first play's reach row (append-only, so with triggers off for that one write, as time passing would end it). The settlements are taken out again, as the next block reads the open window.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sf-k-ann'); bob uuid := tests.account('sf-k-bob');
  a1 uuid := tests.character(ann, 'Sf K Ann One'); a2 uuid := tests.character(ann, 'Sf K Ann Two'); b uuid := tests.character(bob, 'Sf K Bob');
  t uuid := tests.thread('Sf stack'); p1 uuid := tests.post(a1, t, 'One.'); p2 uuid := tests.post(a2, t, 'Two.');
  last_end timestamptz := pg_temp.last_end(); opens timestamptz := next_settlement_at(); first_ jsonb; second_ jsonb; third_ jsonb; why text; pl jsonb; reach_ends timestamptz;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, scores_as, stack) values
    ('sfstk1', 'Sf Stack One', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', true, 1),
    ('sfstk2', 'Sf Stack Two', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', true, 2);
  perform pg_temp.hand(bob, 'sfstk1', 'sfstk1', 'sfstk2', 'sfstk2', 'sfstk2');
  perform tests.become_service();
  -- W0: both cards name the window after the next settlement (W1).
  first_ := play_card(bob, 'sfstk2', b, a2, '{"class": "beta"}', 0, '', 'character', p2);
  perform play_card(bob, 'sfstk1', b, a1, '{"class": "beta"}', 0, '', 'character', p1);
  -- S1 closes W0: the next play names W2 and finds W1's still up. Stack 2 takes it; stack 1 refuses it, in the stack's words.
  perform tests.unbecome();
  insert into settlements (starts_at, ends_at, season) values (last_end, opens, (select id from seasons where ends_at is null));
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfstk1', b, a1, '{"class": "alpha"}', '', 'character', p1));
  if why is distinct from '23505 this character already carries that card' then raise exception 'a second play of a stack-1 card while the first is up: %', why; end if;
  second_ := play_card(bob, 'sfstk2', b, a2, '{"class": "alpha"}', 0, '', 'character', p2);
  select c.payload into pl from acts c where c.id = (second_ ->> 'id')::uuid;
  if (pl ->> 'starts')::timestamptz is distinct from opens + interval '1 day' or (pl ->> 'ends')::timestamptz is distinct from opens + interval '2 days' then
    raise exception 'a stack-2 play after the next settlement does not name the window after it: %', pl;
  end if;
  -- A third while both are up: the stack's words, and only they.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfstk2', b, a2, '{"class": "alpha"}', '', 'character', p2));
  if why is distinct from '23505 this character already carries 2 of that card, the most it takes' then raise exception 'a third play of a stack-2 card while two are up: %', why; end if;
  -- S2 closes W1: its play is no longer up (its reach ended at W1's close), and a third lands, naming W3.
  perform tests.unbecome();
  insert into settlements (starts_at, ends_at, season) values (opens, opens + interval '1 day', (select id from seasons where ends_at is null));
  alter table play_reach disable trigger play_reach_no_update;
  update play_reach set ends_at = now() - interval '1 minute' where play = (first_ ->> 'id')::uuid;
  alter table play_reach enable trigger play_reach_no_update;
  perform tests.become_service();
  third_ := play_card(bob, 'sfstk2', b, a2, '{"class": "beta"}', 0, '', 'character', p2);
  select c.payload into pl from acts c where c.id = (third_ ->> 'id')::uuid;
  if (pl ->> 'starts')::timestamptz is distinct from opens + interval '2 days' or (pl ->> 'ends')::timestamptz is distinct from opens + interval '3 days' then
    raise exception 'a stack-2 play after the second settlement does not name the window after it: %', pl;
  end if;
  -- The settlements this block wrote go, so the next block reads the open window as it was.
  perform tests.unbecome();
  delete from settlements where ends_at >= opens;
end $$;

-- ---- After the next settlement the window after it is the next one: the same character takes another, naming the window after that ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sf-s-ann'); bob uuid := tests.account('sf-s-bob');
  a uuid := tests.character(ann, 'Sf S Ann'); b uuid := tests.character(bob, 'Sf S Bob');
  t uuid := tests.thread('Sf next'); p uuid := tests.post(a, t, 'Ann.');
  last_end timestamptz := pg_temp.last_end(); opens timestamptz := next_settlement_at(); second_ jsonb; pl jsonb; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'sfoff', 'sfoff');
  perform pg_temp.sf_named(b, a, t, p, last_end + interval '1 hour', opens + interval '1 day');
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a, '{"class": "beta"}', '', 'character', p));
  if why is distinct from '23505 this character already has a class named for the window after the next settlement' then raise exception 'a second in the window: %', why; end if;
  -- The settlement that closes the open window passes: the play made before it names the window that has now begun, and the next names the one after.
  perform tests.unbecome();
  insert into settlements (starts_at, ends_at, season) values (last_end, opens, (select id from seasons where ends_at is null));
  perform tests.become_service();
  second_ := play_card(bob, 'sfoff', b, a, '{"class": "beta"}', 0, '', 'character', p);
  select c.payload into pl from acts c where c.id = (second_ ->> 'id')::uuid;
  if (pl ->> 'starts')::timestamptz is distinct from opens + interval '1 day' or (pl ->> 'ends')::timestamptz is distinct from opens + interval '2 days' then
    raise exception 'an Off Day after the next settlement does not name the window after it: %', pl;
  end if;
end $$;

-- ---- Where the next settlement's time is not known (a season's first window), no window can be named: the same words for every target, and a face-down card stays set ----
-- Last in the file: it ends the first season and begins a second at a date past every settlement, so no later block could read the earlier state.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sf-n-ann'); bob uuid := tests.account('sf-n-bob');
  a uuid := tests.character(ann, 'Sf N Ann'); b uuid := tests.character(bob, 'Sf N Bob'); b2 uuid := tests.character(bob, 'Sf N Bob Two');
  t uuid := tests.thread('Sf unknown'); p uuid := tests.post(a, t, 'Ann.'); pb uuid := tests.post(b2, t, 'Bob''s other.'); q uuid := tests.post(b, t, 'Quoting.');
  turn timestamptz := '3000-01-01T00:00:00Z'; why text; own_why text; back uuid; sprung jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'sfoff', 'sfoff');
  perform pg_temp.hand(ann, 'sfoff');
  insert into settlements (starts_at, ends_at, season) values (turn - interval '1 day', turn, (select id from seasons where ends_at is null));
  update seasons set ends_at = turn where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), turn);
  if next_settlement_at() is not null then raise exception 'this file means to be at a season''s first window: %', next_settlement_at(); end if;
  perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, a, '{"class": "beta"}', '', 'character', p));
  own_why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'sfoff', b, b2, '{"class": "beta"}', '', 'character', pb));
  if why is distinct from '55000 the next settlement''s time is not known yet, so no window can be named; play it after that settlement' then raise exception 'an Off Day where no window can be named: %', why; end if;
  if own_why is distinct from why then raise exception 'a refusal on one''s own other mask is told apart: % / %', own_why, why; end if;
  if exists (select 1 from acts where kind = 'card' and payload ->> 'card' = 'sfoff' and created_at >= turn - interval '1 day') or card_held(bob, 'sfoff') is distinct from 2 then raise exception 'a refused Off Day wrote or spent'; end if;

  -- A face-down Off Day stays set when its quote arrives: the window cannot be named.
  back := (set_card(ann, 'sfoff', a, p, '{"class": "beta"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  sprung := spring_traps('quote', p, q);
  if sprung is not null then raise exception 'a face-down Off Day landed where no window can be named: %', sprung; end if;
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a back that could not land sprang'; end if;
end $$;
