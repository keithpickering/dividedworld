-- The Vending Machine's catalog, packs and the hand (supabase/migrations/0119_machine.sql; docs/plans/2026-11-04-booster-packs-plan.md, Task 2):
-- slots with a price and an availability, packs rolled when they are bought, and one function that counts a hand. As the service role
-- the act Edge Function calls them as, and as a player where the player reads.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('mc-ann');
  bob uuid := tests.account('mc-bob');
  a uuid := tests.character(ann, 'Machinist');
  b uuid := tests.character(bob, 'Handless');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'A post to play a card on.');
  s_open uuid; s_out uuid; s_hidden uuid; s_pack uuid; s_hidden_pack uuid;
  odds jsonb;
  why text;
  rolled text[]; again text[];
  bought jsonb;
  pack_row packs;
  rares integer := 0;
  firsts integer := 0;
  card_a text;
  s_solo uuid;
  before_held integer;
  ann_held integer;
  ledger_rows integer;
begin
  -- The vocabulary: cards of each rarity, a pack that pulls from them, and a slot of each availability.
  insert into card_kinds (key, name, alignment, rarity) values
    ('mc-com-1', 'Common One', 'sweet', 'common'), ('mc-com-2', 'Common Two', 'sweet', 'common'),
    ('mc-unc-1', 'Uncommon One', 'salty', 'uncommon'), ('mc-rare-1', 'Rare One', 'salty', 'rare');
  odds := '[{"weights": {"common": 85, "uncommon": 15}}, {"weights": {"common": 85, "uncommon": 15}}, {"weights": {"common": 85, "uncommon": 15}},
            {"weights": {"common": 85, "uncommon": 15}}, {"weights": {"uncommon": 75, "rare": 25}}]';
  insert into pack_kinds (key, pulls, leaves) values ('mc-pack', odds, '{}'), ('mc-hid-pack', odds, '{mc-com-1}');
  insert into machine_slots (position, card, availability, price) values (9001, 'mc-com-1', 'onSale', 200) returning id into s_open;
  insert into machine_slots (position, card, availability, price) values (9002, 'mc-com-2', 'soldOut', 200) returning id into s_out;
  insert into machine_slots (position, card, availability, price) values (9003, 'mc-unc-1', 'hidden', 200) returning id into s_hidden;
  insert into machine_slots (position, pack, availability, price) values (9004, 'mc-pack', 'onSale', 300) returning id into s_pack;
  insert into machine_slots (position, pack, availability, price) values (9005, 'mc-hid-pack', 'hidden', 300) returning id into s_hidden_pack;
  insert into wallets (account, balance) values (ann, 600), (bob, 600);

  -- A slot sold out, a slot hidden, and a stale price are each refused in plain words, the same for every caller, and write nothing.
  perform tests.become_service();
  foreach why in array array['ann', 'bob'] loop
    declare who uuid := case why when 'ann' then ann else bob end;
    begin
      if pg_temp.refusal(format('select buy_card(%L, %L, 200)', who, s_out)) is distinct from 'this slot is sold out' then raise exception 'a sold out slot: %', pg_temp.refusal(format('select buy_card(%L, %L, 200)', who, s_out)); end if;
      if pg_temp.refusal(format('select buy_pack(%L, %L, 300)', who, s_hidden_pack)) is distinct from 'the machine has no such slot' then raise exception 'a hidden slot: %', pg_temp.refusal(format('select buy_pack(%L, %L, 300)', who, s_hidden_pack)); end if;
      if pg_temp.refusal(format('select buy_card(%L, %L, 200)', who, s_hidden)) is distinct from 'the machine has no such slot' then raise exception 'a hidden card slot: %', pg_temp.refusal(format('select buy_card(%L, %L, 200)', who, s_hidden)); end if;
      if pg_temp.refusal(format('select buy_card(%L, %L, 200)', who, gen_random_uuid())) is distinct from 'the machine has no such slot' then raise exception 'a slot that does not exist reads as a hidden one'; end if;
      if pg_temp.refusal(format('select buy_card(%L, %L, 100)', who, s_open)) is distinct from 'the price is now 2.00, not 1.00' then raise exception 'a stale price: %', pg_temp.refusal(format('select buy_card(%L, %L, 100)', who, s_open)); end if;
      if pg_temp.refusal(format('select buy_pack(%L, %L, 250)', who, s_pack)) is distinct from 'the price is now 3.00, not 2.50' then raise exception 'a stale pack price: %', pg_temp.refusal(format('select buy_pack(%L, %L, 250)', who, s_pack)); end if;
      if pg_temp.refusal(format('select buy_card(%L, %L, 300)', who, s_pack)) is distinct from 'this slot sells a pack, not a card' then raise exception 'a pack slot bought as a card'; end if;
      if pg_temp.refusal(format('select buy_pack(%L, %L, 200)', who, s_open)) is distinct from 'this slot sells a card, not a pack' then raise exception 'a card slot bought as a pack'; end if;
    end;
  end loop;
  if exists (select 1 from card_ledger where account in (ann, bob)) or exists (select 1 from packs) or exists (select 1 from wallet_events where account in (ann, bob))
     or (select sum(balance) from wallets where account in (ann, bob)) is distinct from 1200 then
    raise exception 'a refused purchase wrote something';
  end if;

  -- A card bought from its slot: the wallet is debited and the hand counts it.
  bought := buy_card(ann, s_open, 200);
  if bought ->> 'card' is distinct from 'mc-com-1' or (bought ->> 'balance')::integer is distinct from 400 or (bought ->> 'held')::integer is distinct from 1 then raise exception 'buy_card: %', bought; end if;
  if (select change from wallet_events where account = ann and kind = 'purchase') is distinct from -200 then raise exception 'the purchase is recorded'; end if;

  -- A pack: the same checks, then the roll. A seed fixes it, and five pulled rows are written in pull order.
  perform setseed(0.42);
  rolled := roll_pack(odds, '{}');
  perform setseed(0.42);
  again := roll_pack(odds, '{}');
  if rolled is distinct from again or cardinality(rolled) is distinct from 5 then raise exception 'a fixed seed rolls the same pack: % vs %', rolled, again; end if;
  perform setseed(0.42);
  bought := buy_pack(ann, s_pack, 300);
  if (bought ->> 'balance')::integer is distinct from 100 then raise exception 'buy_pack debits the wallet: %', bought; end if;
  select * into pack_row from packs where account = ann;
  if pack_row.id is distinct from (bought ->> 'pack')::uuid or pack_row.price is distinct from 300 or pack_row.odds is distinct from odds
     or pack_row.pack is distinct from 'mc-pack' or pack_row.slot is distinct from s_pack or pack_row.opened_at is null or pack_row.bought_at is null then
    raise exception 'the pack row: %', to_jsonb(pack_row);
  end if;
  if pack_row.contents is distinct from rolled or (select array_agg(c) from jsonb_array_elements_text(bought -> 'contents') c) is distinct from rolled then
    raise exception 'the contents are the roll, in pull order: % / % / %', pack_row.contents, bought -> 'contents', rolled;
  end if;
  if (select array_agg(card order by id) from card_ledger where pack = pack_row.id and kind = 'pulled') is distinct from rolled
     or (select count(*) from card_ledger where pack = pack_row.id and kind = 'pulled' and price = 0 and account = ann and act is null) is distinct from 5 then
    raise exception 'one pulled row per pull, in order, priced 0: %', (select jsonb_agg(l) from card_ledger l where pack = pack_row.id);
  end if;
  if (select change from wallet_events where account = ann and kind = 'purchase' order by id desc limit 1) is distinct from -300 then raise exception 'the pack purchase is recorded'; end if;
  -- (Other files commit cards of their own, so a pull is read by the rarity of what it gave.)
  if (select count(*) from unnest(rolled[1:4]) k join card_kinds c on c.key = k where c.rarity in ('common', 'uncommon')) is distinct from 4 then raise exception 'a pull that cannot roll a rare, or a legendary, rolled one: %', rolled; end if;
  if (select rarity from card_kinds where key = rolled[5]) not in ('uncommon', 'rare') then raise exception 'the hit pull is an uncommon or a rare: %', rolled; end if;

  -- Over 2,000 rolls with a fixed seed, the hit pull's rare share is between 20% and 30%.
  perform setseed(0.7);
  for i in 1..2000 loop
    rolled := roll_pack(odds, '{}');
    if (select rarity from card_kinds where key = rolled[5]) = 'rare' then rares := rares + 1; end if;
  end loop;
  if rares < 400 or rares > 600 then raise exception 'the hit pull rolled % rares in 2000', rares; end if;
  -- A card a pack leaves out is never in it.
  perform setseed(0.7);
  for i in 1..200 loop
    if 'mc-com-1' = any (roll_pack(odds, '{mc-com-1}')) then raise exception 'a card a pack leaves out was rolled'; end if;
  end loop;
  -- A pull with no eligible card is refused in words, naming the rarity.
  why := pg_temp.refusal($q$select roll_pack('[{"weights": {"mythic": 1}}]', '{}')$q$);
  if why is null or why not like '%mythic%' then raise exception 'a pull with no card to give: %', why; end if;

  -- card_held counts bought + pulled - played, and a played pulled card leaves the hand.
  -- A pack that can give one card only (every other is left out), so that the card pulled is one this file can play.
  insert into pack_kinds (key, pulls, leaves) values ('mc-solo', '[{"weights": {"common": 1}}]', (select array_agg(key) from card_kinds where key <> 'mc-com-2'));
  insert into machine_slots (position, pack, availability, price) values (9006, 'mc-solo', 'onSale', 100) returning id into s_solo;
  bought := buy_pack(ann, s_solo, 100);
  card_a := (bought -> 'contents') ->> 0;
  if card_a is distinct from 'mc-com-2' or jsonb_array_length(bought -> 'contents') is distinct from 1 then raise exception 'a pack that leaves out every other card: %', bought; end if;
  select count(*) filter (where kind in ('bought', 'pulled')) into before_held from card_ledger where account = ann and card = card_a;
  if before_held < 1 then raise exception 'the pulled card is held: %', before_held; end if;
  if card_held(ann, card_a) is distinct from before_held then raise exception 'card_held counts bought and pulled: % vs %', card_held(ann, card_a), before_held; end if;
  perform play_card(ann, card_a, a, p, '{}', 0);
  if card_held(ann, card_a) is distinct from before_held - 1 then raise exception 'a played pulled card leaves the hand: %', card_held(ann, card_a); end if;
  if card_held(ann, 'mc-com-1') is distinct from (select count(*) filter (where kind in ('bought', 'pulled')) - count(*) filter (where kind = 'played') from card_ledger where account = ann and card = 'mc-com-1')::integer then
    raise exception 'card_held for the bought card';
  end if;
  if card_held(bob, card_a) is distinct from 0 then raise exception 'a card nobody gave bob'; end if;
  -- play_card and set_card refuse a card the hand does not hold, and count a pulled card as held.
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0)', bob, card_a, b, p, '{}')) not like 'you hold no%' then raise exception 'a card bob does not hold was played'; end if;
  perform tests.unbecome();

  -- A player reads their own hand and packs, and nobody's else; and calls none of the writes.
  perform tests.become(ann);
  if (select held from my_cards where card = card_a) is distinct from before_held - 1 then raise exception 'my_cards counts the hand: %', (select jsonb_agg(m) from my_cards m); end if;
  if (select count(*) from my_packs) is distinct from 2 or (select contents from my_packs where id = pack_row.id) is distinct from pack_row.contents then raise exception 'my_packs holds the caller''s packs'; end if;
  if pg_temp.refusal(format('select buy_card(%L, %L, 200)', ann, s_open)) is null then raise exception 'a player called buy_card directly'; end if;
  if pg_temp.refusal(format('select buy_pack(%L, %L, 300)', ann, s_pack)) is null then raise exception 'a player called buy_pack directly'; end if;
  if pg_temp.refusal('select * from machine_slots') is null then raise exception 'a player read the slots, hidden ones with them'; end if;
  ann_held := card_held(ann, 'mc-com-1');
  if ann_held < 1 then raise exception 'ann still holds the card bought: %', ann_held; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if card_held(ann, 'mc-com-1') is distinct from 0 then raise exception 'a player counted another''s hand: % of %', card_held(ann, 'mc-com-1'), ann_held; end if;
  if exists (select 1 from my_cards) or exists (select 1 from my_packs) or exists (select 1 from packs) or exists (select 1 from card_ledger) then raise exception 'another player read whose packs and cards are whose'; end if;
  perform tests.unbecome();

  -- machine_now is what players see: every slot but a hidden one, the same for a visitor and a player.
  perform tests.become_anon();
  if pg_temp.refusal(format('select card_held(%L, %L)', ann, 'mc-com-1')) is null then raise exception 'a visitor called card_held'; end if;
  if (select count(*) from machine_now where slot in (s_open, s_out, s_pack)) is distinct from 3 then raise exception 'the machine shows its slots'; end if;
  if exists (select 1 from machine_now where slot in (s_hidden, s_hidden_pack)) then raise exception 'machine_now lists a hidden slot'; end if;
  if (select availability from machine_now where slot = s_out) is distinct from 'soldOut' or (select price from machine_now where slot = s_open) is distinct from 200
     or (select rarity from machine_now where slot = s_open) is distinct from 'common' or (select pack from machine_now where slot = s_pack) is distinct from 'mc-pack'
     or (select position from machine_now where slot = s_pack) is distinct from 9004 then
    raise exception 'machine_now: %', (select jsonb_agg(m) from machine_now m where slot in (s_open, s_out, s_pack));
  end if;
  if pg_temp.refusal('select * from pack_kinds') is not null then raise exception 'a pack''s odds are public'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if exists (select 1 from machine_now where slot in (s_hidden, s_hidden_pack)) then raise exception 'machine_now lists a hidden slot to a player'; end if;
  perform tests.unbecome();

  -- A packs row cannot be updated, deleted or truncated.
  if pg_temp.refusal(format('update packs set price = 1 where id = %L', pack_row.id)) is null then raise exception 'a pack was updated'; end if;
  if pg_temp.refusal(format('update packs set opened_at = null where id = %L', pack_row.id)) is null then raise exception 'a pack was resealed'; end if;
  if pg_temp.refusal(format('delete from packs where id = %L', pack_row.id)) is null then raise exception 'a pack was deleted'; end if;
  if pg_temp.refusal('truncate packs') is null then raise exception 'packs were truncated'; end if;
  if pg_temp.refusal('update card_ledger set price = 1 where kind = ''pulled''') is null then raise exception 'a pulled row was updated'; end if;
  -- A pulled row names its pack, and only a pulled row does.
  if pg_temp.refusal(format('insert into card_ledger (account, card, kind, price) values (%L, %L, ''pulled'', 0)', ann, 'mc-com-1')) is null then raise exception 'a pulled row with no pack'; end if;
  if pg_temp.refusal(format('insert into card_ledger (account, card, kind, price, pack) values (%L, %L, ''bought'', 0, %L)', ann, 'mc-com-1', pack_row.id)) is null then raise exception 'a bought row naming a pack'; end if;

  -- A slot holds one item, a price above 0, and a position of its own.
  if pg_temp.refusal($q$insert into machine_slots (position, card, pack, availability, price) values (9100, 'mc-com-1', 'mc-pack', 'onSale', 100)$q$) is null then raise exception 'a slot with two items'; end if;
  if pg_temp.refusal($q$insert into machine_slots (position, availability, price) values (9101, 'onSale', 100)$q$) is null then raise exception 'a slot with no item'; end if;
  if pg_temp.refusal($q$insert into machine_slots (position, card, availability, price) values (9102, 'mc-unc-1', 'onSale', 0)$q$) is null then raise exception 'a free slot'; end if;
  if pg_temp.refusal($q$insert into machine_slots (position, card, availability, price) values (9001, 'mc-rare-1', 'onSale', 100)$q$) is null then raise exception 'two slots at one position'; end if;
  if pg_temp.refusal($q$insert into machine_slots (position, card, availability, price) values (9103, 'mc-rare-1', 'free', 100)$q$) is null then raise exception 'an availability that is none of the three'; end if;
  -- Two positions swapped in one statement (the unique constraint is deferrable).
  update machine_slots set position = case id when s_open then 9002 else 9001 end where id in (s_open, s_out);
  if (select position from machine_slots where id = s_open) is distinct from 9002 then raise exception 'positions did not swap'; end if;
end $$;

-- ---- A re-seed adds the slots the instance names and leaves every one an admin changed ----
do $$
declare
  cards jsonb;
  seeded jsonb;
  before_max integer;
begin
  insert into card_kinds (key, name, alignment, rarity) values ('rs-one', 'Re One', 'sweet', 'common'), ('rs-two', 'Re Two', 'sweet', 'common');
  cards := jsonb_build_array(
    jsonb_build_object('key', 'rs-one', 'name', 'Re One', 'alignment', 'sweet', 'rarity', 'common', 'stack', 1, 'seeded', false),
    jsonb_build_object('key', 'rs-two', 'name', 'Re Two', 'alignment', 'sweet', 'rarity', 'common', 'stack', 1, 'seeded', false));
  seeded := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', cards,
    'packs', jsonb_build_array(jsonb_build_object('key', 'rs-pack', 'pulls', jsonb_build_array(jsonb_build_object('weights', jsonb_build_object('common', 1))), 'leaves', '[]'::jsonb)),
    'machine', jsonb_build_array(
      jsonb_build_object('pack', 'rs-pack', 'availability', 'onSale', 'price', 300),
      jsonb_build_object('card', 'rs-one', 'availability', 'onSale', 'price', 100),
      jsonb_build_object('card', 'rs-two', 'availability', 'hidden', 'price', 400)));
  select coalesce(max(position), 0) into before_max from machine_slots;
  perform seed_instance(seeded);
  if (select array_agg(coalesce(card, pack) order by position) from machine_slots where position > before_max) is distinct from array['rs-pack', 'rs-one', 'rs-two'] then
    raise exception 'a seed adds its slots at the end, in the instance''s order: %', (select jsonb_agg(s order by position) from machine_slots s where position > before_max);
  end if;
  if (select pulls from pack_kinds where key = 'rs-pack') is distinct from '[{"weights": {"common": 1}}]'::jsonb then raise exception 'a seed writes the pack''s pulls'; end if;
  -- An admin sets a price, sells one out and moves a slot; the same seed again changes none of it and adds nothing.
  update machine_slots set price = 777, availability = 'soldOut', position = position + 50 where card = 'rs-one';
  update pack_kinds set pulls = '[{"weights": {"common": 2}}]' where key = 'rs-pack';
  perform seed_instance(seeded);
  if (select price from machine_slots where card = 'rs-one') is distinct from 777 or (select availability from machine_slots where card = 'rs-one') is distinct from 'soldOut' then
    raise exception 'a re-seed overwrote an admin''s slot';
  end if;
  if (select position from machine_slots where card = 'rs-one') is distinct from before_max + 52 then raise exception 'a re-seed moved a slot'; end if;
  if (select count(*) from machine_slots where card in ('rs-one', 'rs-two') or pack = 'rs-pack') is distinct from 3 then raise exception 'a re-seed added a slot twice'; end if;
  -- The pack's pulls are the instance's code, written again.
  if (select pulls from pack_kinds where key = 'rs-pack') is distinct from '[{"weights": {"common": 1}}]'::jsonb then raise exception 'a re-seed did not write the pack''s pulls again'; end if;
end $$;
