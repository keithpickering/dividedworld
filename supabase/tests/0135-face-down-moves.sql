-- Face-down Moves, the schema (supabase/migrations/0139_face_down_moves.sql): a back names the card its Trap Card waits for, or the
-- phrase its Move waits for, and only the setter reads either; a Gimmick's trap shape is a cast or a visit; a card a Trap Card took is
-- a `caught` row in the setter's card ledger; one function, card_held, is the hand. docs/plans/2026-11-07-face-down-moves-plan.md,
-- Task 3; the design is docs/plans/2026-11-07-face-down-moves-design.md, sections 4, 5 and 9. The cards are the engine's test set,
-- never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- A back names its catch or its phrase, never both; old rows hold neither ----
do $$
declare
  ann uuid := tests.account('fdm-ann');
  bob uuid := tests.account('fdm-bob');
  a uuid := tests.character(ann, 'Fdm Ann');
  t uuid := tests.thread('Face-down Moves');
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  why text;
begin
  update settings set value = value || '{"fdmtrap.price": 100, "fdmpass.price": 100, "fdmmove.price": 100, "fdmcatch.price": 100, "x.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values
    ('fdmtrap', 'Fdm Trap', 'salty', 'fdmtrap.price', 'uncommon', 'set', '{"trigger": {"on": "cast"}}'),
    ('fdmpass', 'Fdm Pass', 'sweet', 'fdmpass.price', 'uncommon', 'set', '{"trigger": {"on": "visit"}}'),
    ('fdmmove', 'Fdm Move', 'salty', 'fdmmove.price', 'common', 'cast', null),
    ('fdmcatch', 'Fdm Catch', 'salty', 'fdmcatch.price', 'rare', 'cast', null);
  p1 := tests.post(a, t); p2 := tests.post(a, t); p3 := tests.post(a, t); p4 := tests.post(a, t);
  s1 := tests.act(a, 'set', t, '{}', p1); s2 := tests.act(a, 'set', t, '{}', p2); s3 := tests.act(a, 'set', t, '{}', p3); s4 := tests.act(a, 'set', t, '{}', p4);

  -- A Trap Card names its catch.
  insert into face_down (play, account, card, config, post, thread, round, ends_at, catches)
  values (s1, ann, 'fdmtrap', '{"card": "fdmcatch"}', p1, t, 1, now() + interval '7 days', 'fdmcatch');
  -- A Move holds a phrase.
  insert into face_down (play, account, card, config, post, thread, round, ends_at, phrase)
  values (s2, ann, 'fdmmove', '{"phrase": "hello"}', p2, t, 1, now() + interval '7 days', 'hello');
  -- A row holds neither, as every back set before this did.
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s3, ann, 'fdmpass', p3, t, 1, now() + interval '7 days');

  -- Both is refused, by the table itself.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, catches, phrase) values (%L, %L, %L, %L, %L, 1, now(), %L, %L)',
    s4, ann, 'fdmtrap', p4, t, 'fdmcatch', 'hello'));
  if why is null or why not like '%face_down_one_of%' then raise exception 'a back with a catch and a phrase was stored: %', why; end if;
  -- A catch is a card kind of the instance.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, catches) values (%L, %L, %L, %L, %L, 1, now(), %L)',
    s4, ann, 'fdmtrap', p4, t, 'nosuchcard'));
  if why is null or why not like '%foreign key%' then raise exception 'a back named a card that is not one: %', why; end if;
  -- A phrase is not empty.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, phrase) values (%L, %L, %L, %L, %L, 1, now(), %L)',
    s4, ann, 'fdmmove', p4, t, ''));
  if why is null or why not like '%face_down_phrase%' then raise exception 'an empty phrase was stored: %', why; end if;
  -- Nothing updates a row, so a catch is never added to a back after it is set.
  why := pg_temp.refusal(format('update face_down set catches = %L where play = %L', 'fdmcatch', s3));
  if why is null then raise exception 'a face_down row was updated'; end if;

  -- The setter alone reads the catch and the phrase.
  perform tests.become(ann);
  if (select catches from my_face_down where play = s1) is distinct from 'fdmcatch' then raise exception 'the setter reads the named catch'; end if;
  if (select phrase from my_face_down where play = s2) is distinct from 'hello' then raise exception 'the setter reads the phrase'; end if;
  if exists (select 1 from my_face_down where play = s3 and (catches is not null or phrase is not null)) then raise exception 'an old back holds neither'; end if;
  if (select catches from face_down where play = s1) is distinct from 'fdmcatch' then raise exception 'the setter reads their own face_down row'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from my_face_down) or exists (select 1 from face_down) then raise exception 'another account reads a back, its catch or its phrase'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal('select catches, phrase from my_face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads my_face_down: %', why; end if;
  why := pg_temp.refusal('select catches from face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads face_down: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- card_kinds' trap shape: a Gimmick springs on a cast or a visit ----
do $$
declare why text;
begin
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('fdmbad1', 'Bad', 'salty', 'x.price', 'common', 'set', '{"trigger": {"on": "reply"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a reply trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('fdmbad2', 'Bad', 'salty', 'x.price', 'common', 'set', '{"trigger": {"on": "quote"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a quote trigger was stored (a Move''s is the engine''s): %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('fdmbad3', 'Bad', 'salty', 'x.price', 'common', 'set', '{"trigger": {"on": "reaction", "quadrant": "calmPositive"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a reaction trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('fdmbad4', 'Bad', 'salty', 'x.price', 'common', 'set', '{}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a trap with no trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('fdmbad5', 'Bad', 'salty', 'x.price', 'common', 'cast', '{"trigger": {"on": "cast"}}')$q$);
  if why is null then raise exception 'a Move with a trap was stored'; end if;

  -- The seed's check says the same, naming the card, in the engine's words (engine/rules/instance.ts).
  if card_kinds_problem('[{"key": "ok", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}},
                          {"key": "ok2", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "visit"}}},
                          {"key": "ok3", "rarity": "common", "play": "cast"}]') is not null then
    raise exception 'a valid Gimmick was refused: %', card_kinds_problem('[{"key": "ok", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}}]');
  end if;
  why := card_kinds_problem('[{"key": "r", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}}}]');
  if why is distinct from 'card "r" springs on "reply"; a Gimmick springs on cast or visit' then raise exception 'a reply trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "n", "rarity": "common", "play": "set", "trap": {}}]');
  if why is distinct from 'card "n" springs on nothing; a Gimmick springs on cast or visit' then raise exception 'a trap with no trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "e", "rarity": "common", "play": "set", "trap": {"trigger": {"on": 5}}}]');
  if why is distinct from 'card "e" springs on 5; a Gimmick springs on cast or visit' then raise exception 'a numeric trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "t", "rarity": "common", "play": "set", "trap": {"trigger": {}}}]');
  if why is distinct from 'card "t" springs on nothing; a Gimmick springs on cast or visit' then raise exception 'a trigger with no on: %', why; end if;
  why := card_kinds_problem('[{"key": "m", "rarity": "common", "play": "cast", "trap": {"trigger": {"on": "cast"}}}]');
  if why is distinct from 'card "m" has a trap, and only a Gimmick does' then raise exception 'a Move with a trap: %', why; end if;
end $$;

-- ---- card_held: bought and caught, less played; one count for every reader of a hand ----
do $$
declare
  ann uuid := tests.account('fdm-held-ann');
  bob uuid := tests.account('fdm-held-bob');
  a uuid := tests.character(ann, 'Held Ann');
  t uuid := tests.thread('Held');
  p uuid := tests.post(a, t);
  the_set uuid := tests.act(a, 'set', t, '{}', p);
  spring uuid := tests.act(a, 'spring', t, jsonb_build_object('card', 'sweetie', 'trigger', 'cast', 'outcome', jsonb_build_object('do', 'nullify'), 'set', the_set), p);
  why text;
begin
  if card_held(ann, 'sweetie') is distinct from 0 then raise exception 'an empty hand holds %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, price) select ann, 'sweetie', 'bought', 0 from generate_series(1, 2);
  -- A purchase reports the hand through the same count.
  insert into wallets (account, balance) values (ann, 500);
  if (buy_card(ann, 'splat', 100) ->> 'held')::integer is distinct from 1 then raise exception 'buy_card reports the hand: %', buy_card(ann, 'splat', 100); end if;
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'two bought hold %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, act, price) values (ann, 'sweetie', 'caught', spring, 0);
  if card_held(ann, 'sweetie') is distinct from 3 then raise exception 'a caught card is a card held: %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, act, price) values (ann, 'sweetie', 'played', tests.act(a, 'card', t, '{"card": "sweetie"}', p), 0);
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'a played card is spent: %', card_held(ann, 'sweetie'); end if;
  if card_held(ann, 'blot') is distinct from 0 or card_held(bob, 'sweetie') is distinct from 0 then raise exception 'a hand is one account''s, one card''s'; end if;

  -- A caught row is the spring's, and costs nothing; a bought one is neither.
  why := pg_temp.refusal(format('insert into card_ledger (account, card, kind, price) values (%L, %L, %L, 0)', ann, 'sweetie', 'caught'));
  if why is null then raise exception 'a caught card with no spring was stored'; end if;
  why := pg_temp.refusal(format('insert into card_ledger (account, card, kind, act, price) values (%L, %L, %L, %L, 0)', ann, 'sweetie', 'bought', spring));
  if why is null then raise exception 'a bought card with an Act was stored'; end if;

  -- The player's own screens count it the same way, and the log shows the row.
  perform tests.become(ann);
  if (select held from my_cards where card = 'sweetie') is distinct from 2 then raise exception 'my_cards: %', (select jsonb_agg(m) from my_cards m); end if;
  if (select count(*) from my_card_ledger where kind = 'caught' and card = 'sweetie' and act = spring) is distinct from 1::bigint then raise exception 'my_card_ledger shows the caught row'; end if;
  if (select springs from my_card_ledger where kind = 'caught') is not null then raise exception 'a caught row is not a set'; end if;
  -- A player calling the count reads their own hand, and another account's as a constant 0, never its real count.
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'a player cannot count their own hand'; end if;
  if card_held(bob, 'sweetie') is distinct from 0 then raise exception 'a player counted another account''s hand'; end if;
  perform tests.unbecome();
  insert into card_ledger (account, card, kind, price) values (bob, 'sweetie', 'bought', 0), (bob, 'sweetie', 'bought', 0), (bob, 'sweetie', 'bought', 0);
  perform tests.become(ann);
  if card_held(bob, 'sweetie') is distinct from 0 then raise exception 'a player counted another account''s hand, now that it holds some'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal(format('select card_held(%L, %L)', ann, 'sweetie'));
  if why is null or why not like 'permission denied%' then raise exception 'anon called card_held: %', why; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select held from my_cards where card = 'sweetie') is distinct from 3 or exists (select 1 from my_card_ledger where kind <> 'bought') then raise exception 'another account read a hand'; end if;
  perform tests.unbecome();
end $$;
