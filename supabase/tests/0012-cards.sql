-- Cards and the Vending Machine (supabase/migrations/0006_cards.sql), as the service role the
-- act Edge Function calls them as. Plan Task 10.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('card-ann');
  bob uuid := tests.account('card-bob');
  a uuid := tests.character(ann, 'Carder');
  b uuid := tests.character(bob, 'Carded');
  t uuid := tests.thread();
  p uuid := tests.post(b, t, repeat('x', 1200));
  q uuid := tests.post(b, t, 'Another.');
  played jsonb;
  the_play uuid;
  why text;
begin
  insert into wallets (account, balance) values (ann, 150), (bob, 0);
  perform tests.become_service();

  -- Buying with too little Aura is refused and writes nothing.
  why := pg_temp.refusal(format('select buy_card(%L, %L, %L)', bob, 'splat', 100));
  if why is null then raise exception 'a card was bought with an empty wallet'; end if;
  if why not like '%holds 0%' then raise exception 'the refusal should say what the wallet holds: %', why; end if;
  if exists (select 1 from card_ledger where account = bob) or exists (select 1 from wallet_events where account = bob) then
    raise exception 'a refused purchase wrote something';
  end if;

  -- A card is bought at the Vending Machine's price, and no other.
  if pg_temp.refusal(format('select buy_card(%L, %L, %L)', ann, 'splat', 1)) is null then raise exception 'a card was bought at a price of the caller''s choosing'; end if;
  if pg_temp.refusal(format('select buy_card(%L, %L, %L)', ann, 'nothing', 100)) is null then raise exception 'a card that does not exist was bought'; end if;
  if (buy_card(ann, 'splat', 100) ->> 'balance')::integer <> 50 then raise exception 'buying debits the wallet'; end if;
  if (select change from wallet_events where account = ann and kind = 'purchase') is distinct from -100 then raise exception 'the purchase is recorded'; end if;

  -- Playing: a card held, through a character played, on a post, once per post, from a wallet that covers it.
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'sweetie', a, p, '{}', 0)) is null then raise exception 'a card not held was played'; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', b, p, '{}', 0)) is null then raise exception 'a card was played through another''s character'; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', a, p, '{}', 60)) is null then raise exception 'a play the wallet cannot cover went through'; end if;
  if exists (select 1 from acts where kind = 'card') then raise exception 'a refused play left an Act'; end if;
  played := play_card(ann, 'splat', a, p, '{"color": "red"}', 50);
  the_play := (played ->> 'id')::uuid;
  if played ->> 'kind' <> 'card' or (played ->> 'target_act_id')::uuid <> p or played -> 'payload' ->> 'card' <> 'splat' then raise exception 'a play: %', played; end if;
  if (select balance from wallets where account = ann) is distinct from 0 then raise exception 'the play price is debited'; end if;
  if (select held from (select card, (count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played')) as held from card_ledger where account = ann group by card) h where card = 'splat') is distinct from 0 then
    raise exception 'a played card is no longer held';
  end if;
  update wallets set balance = 300 where account = ann;
  perform buy_card(ann, 'splat', 100);
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', a, p, '{}', 0));
  if why is null then raise exception 'a post took the same card twice'; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', a, the_play, '{}', 0)) is null then raise exception 'a card was played on a card'; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', a, q, '{}', 0)) is not null then raise exception 'a card on another post should land'; end if;
  if (select ref from wallet_events where account = ann and kind = 'play' order by id limit 1) is distinct from the_play then raise exception 'a play''s wallet event names the card''s Act'; end if;
  perform buy_card(ann, 'sweetie', 100);
  if coalesce(pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'sweetie', a, q, jsonb_build_object('sentence', repeat('x', 5000)), 0)), '') not like '%4 KB%' then
    raise exception 'an oversize configuration was stored';
  end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, null)', ann, 'sweetie', a, q, '{}')) is null then raise exception 'a play with no price went through'; end if;

  -- Only the post's author saves an effect's state; the caster cannot, nor anyone through another's character.
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, a, the_play, '{"strokes": []}'));
  if why is distinct from 'only the post''s author saves what is on it' then raise exception 'the caster saved strokes: %', why; end if;
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, b, the_play, '{"strokes": []}')) is null then raise exception 'strokes were saved through another''s character'; end if;
  if (save_effect_state(bob, b, the_play, '{"strokes": [{"color": "red", "width": 4, "points": [[0.1, 0.1]]}]}') -> 'state' -> 'strokes') is null then raise exception 'the author saves'; end if;
  perform pg_sleep(0.01);
  perform save_effect_state(bob, b, the_play, '{"strokes": []}');
  if (select saved_at from effect_state where effect_state.play = the_play) <= now() then raise exception 'a save is timed from its transaction''s start'; end if;
  if (select state from effect_state where effect_state.play = the_play) is distinct from '{"strokes": []}' then raise exception 'the author washes it clean'; end if;
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, b, the_play, jsonb_build_object('strokes', repeat('x', 300000)))) is null then
    raise exception 'an oversize state was saved';
  end if;
  perform tests.unbecome();

  -- A player reads their own cards; every reader reads the author's version; nobody but the service writes.
  perform tests.become(ann);
  if (select held from my_cards where card = 'splat') is distinct from 0 then raise exception 'my_cards: %', (select jsonb_agg(m) from my_cards m); end if;
  if pg_temp.refusal(format('select buy_card(%L, %L, %L)', ann, 'splat', 100)) is null then raise exception 'a player called buy_card directly'; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', a, q, '{}', 0)) is null then raise exception 'a player called play_card directly'; end if;
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, a, the_play, '{}')) is null then raise exception 'a player called save_effect_state directly'; end if;
  if whoami() <> ann then raise exception 'whoami() is the caller'; end if;
  if (card_target(p) ->> 'length')::integer <> 1200 or jsonb_array_length(card_target(p) -> 'effects') <> 1 then raise exception 'card_target: %', card_target(p); end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from card_ledger where account = ann) or exists (select 1 from my_cards) then raise exception 'another player read whose cards are whose'; end if;
  if not exists (select 1 from effect_state where effect_state.play = the_play) then raise exception 'every reader loads the author''s version'; end if;
  perform tests.unbecome();
end $$;

-- ---- The price is a setting: the economy row an admin tunes is what the Vending Machine charges ----
do $$
declare
  eve uuid := tests.account('card-eve');
begin
  insert into wallets (account, balance) values (eve, 100);
  update settings set value = jsonb_set(value, '{splat.price}', '40') where key = 'economy';
  perform tests.become_service();
  if pg_temp.refusal(format('select buy_card(%L, %L, %L)', eve, 'splat', 100)) is null then raise exception 'a card was bought at a price the settings no longer hold'; end if;
  if (buy_card(eve, 'splat', 40) ->> 'balance')::integer is distinct from 60 then raise exception 'a card is bought at the price its setting holds'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two plays of one card on one post at once: one lands, the other is refused in words ----
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-card-a@test.invalid'), (%2$L, 'race-card-b@test.invalid'), (%3$L, 'race-card-c@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name) values (%4$L, %1$L, 'Race Card A'), (%5$L, %2$L, 'Race Card B'), (%6$L, %3$L, 'Race Card C');
    insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha'), (%6$L, 'alpha');
    insert into threads (id, board, title) select %7$L, id, 'Race card' from boards where slug = 'general';
    insert into acts (id, character, kind, thread) values (%8$L, %6$L, 'post', %7$L);
    insert into wallets (account, balance) values (%1$L, 100), (%2$L, 100);
    insert into card_ledger (account, card, kind, price) values (%1$L, 'splat', 'bought', 100), (%2$L, 'splat', 'bought', 100);
  $sql$, ann, bob, cat, a, b, c, t, p));
  said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0)', ann, 'splat', a, p, '{}'), format('select play_card(%L, %L, %L, %L, %L, 0)', bob, 'splat', b, p, '{}'));
  if (select count(*) from acts where kind = 'card' and target_act_id = p) is distinct from 1 then raise exception 'one card of a kind landed twice: %', said; end if;
  if (said[1] is null) = (said[2] is null) then raise exception 'exactly one play should be refused: %', said; end if;
  if coalesce(said[1], said[2]) <> 'this post already carries that card' then raise exception 'the loser should be refused in words: %', said; end if;
  if (select count(*) from card_ledger where card = 'splat' and kind = 'played' and account in (ann, bob)) is distinct from 1 then raise exception 'the refused play kept its card'; end if;
end $$;
