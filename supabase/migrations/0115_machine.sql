-- The Vending Machine's catalog, packs and the hand (docs/plans/2026-11-04-booster-packs-plan.md, Task 2; the design's sections 2, 4 and 5).
--
-- Prices move off the cards and onto slots. A slot sells one item, a card or a pack, in a place on the grid, on sale, sold out or hidden, at
-- a price in hundredths of an orb; seed_instance adds the slots an instance names that the database does not hold and never changes one it
-- does (an admin's choices stand). A pack is a list of pulls the instance's code gives; it is rolled on the server when it is bought, and the
-- cards it gave are written to the card ledger as `pulled` rows beside a row in `packs`. One function, card_held, counts a hand.
--
--   - machine_slots is read by nobody but through machine_now, which holds no hidden slot, the same for every caller;
--   - a purchase is refused from the slot alone, in the same words for everyone, and a refusal writes nothing;
--   - packs and the pulled rows are the buyer's own to read, as card_ledger is, and are never edited ("Append-only").
-- Way out of the states this touches: a sold out or hidden slot is an admin's to change (the machine's admin page, a later task); nothing is added
-- to a player, a character or a post.

-- ------------------------------------------------------------------------------------------------- packs and slots ----

-- Whether the pulls of a pack hold: a list of pulls, each with the weights of the rarities it can roll, positive whole numbers.
create function pack_pulls_problem(pulls jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(pulls) is distinct from 'array' or jsonb_array_length(pulls) < 1 then 'a pack is a list of at least one pull'
    else (select format('pull %s rolls no rarity by a positive whole weight', e.i)
          from jsonb_array_elements(pulls) with ordinality e(pull, i)
          where jsonb_typeof(e.pull -> 'weights') is distinct from 'object'
             or not exists (select 1 from jsonb_each(e.pull -> 'weights'))
             or exists (select 1 from jsonb_each(e.pull -> 'weights') w
                        where jsonb_typeof(w.value) is distinct from 'number' or (w.value #>> '{}')::numeric <> trunc((w.value #>> '{}')::numeric) or (w.value #>> '{}')::numeric < 1)
          order by e.i limit 1)
  end
$$;

-- A pack an instance sells: its pulls in reveal order (the last is the hit pull), and the cards it leaves out. The instance's code, seeded.
create table pack_kinds (
  key text primary key check (key <> ''),
  pulls jsonb not null check (pack_pulls_problem(pulls) is null),
  leaves text[] not null default '{}'
);

-- A slot of the machine. Which item, where, whether it is for sale and at what price are an admin's to change, so a seed adds a slot and
-- never writes over one. `position` is unique and deferrable so that two slots can swap places in one statement.
create table machine_slots (
  id uuid primary key default gen_random_uuid(),
  position integer not null,
  card text unique references card_kinds (key),
  pack text unique references pack_kinds (key),
  availability text not null check (availability in ('onSale', 'soldOut', 'hidden')),
  price integer not null check (price > 0),
  constraint machine_slots_one_item check ((card is null) <> (pack is null)),
  constraint machine_slots_position unique (position) deferrable initially immediate
);

-- A pack as it was bought: its price and the pulls as they stood that day, and the cards it gave. Opened in the same insert today; a sealed
-- pack, later, is a row whose `opened_at` is null and whose cards are written to the ledger when it is opened. Append-only, like card_ledger.
create table packs (
  id uuid primary key default gen_random_uuid(),
  account uuid not null references accounts (id),
  slot uuid references machine_slots (id),
  pack text not null references pack_kinds (key),
  price integer not null check (price > 0),
  odds jsonb not null,
  contents text[] not null check (cardinality(contents) >= 1),
  bought_at timestamptz not null default now(),
  opened_at timestamptz
);
create index packs_account on packs (account, bought_at);
create trigger packs_no_update before update or delete on packs for each row execute function ledger_append_only();
create trigger packs_no_truncate before truncate on packs for each statement execute function ledger_append_only();
alter table packs enable always trigger packs_no_update;
alter table packs enable always trigger packs_no_truncate;

-- A pulled row names the pack it came from, and only a pulled row does; a pulled row costs nothing, its pack row holds the price.
alter table card_ledger drop constraint card_ledger_kind_check;
alter table card_ledger add constraint card_ledger_kind_check check (kind in ('bought', 'played', 'pulled'));
alter table card_ledger add column pack uuid references packs (id);
alter table card_ledger add constraint card_ledger_pulled_from_pack check ((kind = 'pulled') = (pack is not null));
alter table card_ledger add constraint card_ledger_pulled_is_free check (kind <> 'pulled' or price = 0);

-- ------------------------------------------------------------------------------------------ the data migration ----

-- An instance that already holds a catalog: a slot for each card in card_kinds, ordered by key, on sale, at the price its economy setting held. The
-- Booster's slot is added by the next seed, at the end of the grid after the cards. On an instance that already held cards every card is put on sale
-- at its old price, and an admin hides any the instance's catalog hides (Main Event) on the machine's page; a seed never updates an existing slot.
-- Then the prices leave the economy row and the cards.
insert into machine_slots (position, card, availability, price)
select row_number() over (order by k.key), k.key, 'onSale', (setting('economy') ->> k.price_setting)::numeric::integer
from card_kinds k
where price_holds(setting('economy'), k.price_setting);

-- The economy row no longer holds prices, so the check that every card has one goes (settings_economy_whole, 0006). It still holds only
-- numbers, and is replaced, never deleted, while cards read it.
create or replace function settings_economy_whole() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare why text;
begin
  if tg_op = 'DELETE' then
    if old.key = 'economy' and exists (select 1 from card_kinds) then raise exception 'the economy holds the numbers the cards read; replace it, never delete it' using errcode = '23514'; end if;
    return old;
  end if;
  if new.key <> 'economy' then return new; end if;
  -- An insert that meets the row already there becomes an update (seed_instance merges), and is checked as one, on the merged value.
  if tg_op = 'INSERT' and exists (select 1 from settings where key = 'economy') then return new; end if;
  why := economy_holds(new.value);
  if why is not null then raise exception 'economy: %', why using errcode = '23514'; end if;
  return new;
end $$;

-- Each price key out of the economy row, unless a card also reads it.
update settings s set value = s.value - coalesce((
    select array_agg(k.price_setting) from card_kinds k where not exists (select 1 from card_kinds r where k.price_setting = any (r.reads))), '{}')
where s.key = 'economy' and jsonb_typeof(s.value) = 'object';

-- screen_settings (0084), whose `cardEconomy` is now the keys the cards read and no prices: a price is a slot's.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'staffGroup');

drop trigger card_kinds_priced on card_kinds;
drop function card_kinds_priced();
alter table card_kinds drop column price_setting;
drop function price_holds(jsonb, text);

-- ------------------------------------------------------------------------------------------------- the hand ----

-- How many of a card a player holds: rows in (bought, pulled) less rows out (played). The one place a hand is counted. Not a definer: the ledger's
-- own policy shows a caller their own rows only, so asking for another's hand counts nothing. A new kind of row in (a gift, a trade) is one line here.
create function card_held(who uuid, card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'pulled')) - count(*) filter (where l.kind = 'played'))::integer
  from card_ledger l where l.account = card_held.who and l.card = card_held.card
$$;

-- The cards a player holds, each counted by card_held.
create or replace view my_cards with (security_invoker = true) as
  select h.card, card_held(auth.uid(), h.card) as held
  from (select distinct l.card from card_ledger l where l.account = auth.uid()) h;

-- ----------------------------------------------------------------------------------------------- the machine ----

-- The machine as players see it: every slot but a hidden one, with its place, its item, a card's rarity, whether it is for sale and its price.
-- Public and the same for every caller. A later migration layers the Boss's moves over it.
create view machine_now as
  select s.id as slot, s.position, s.card, s.pack, k.rarity, s.availability, s.price
  from machine_slots s left join card_kinds k on k.key = s.card
  where s.availability <> 'hidden';

-- A price as the refusals say it: hundredths of an orb as orbs.
create function orbs(hundredths integer) returns text
language sql immutable set search_path = public, pg_temp as $$
  select to_char(hundredths / 100.0, 'FM999999990.00')
$$;

-- What a purchase meets at a slot, from the slot alone and in the same words for every caller: the slot as machine_now shows it, or a refusal.
-- A hidden slot and one that does not exist are alike.
create function slot_for_sale(slot uuid, wants text, price integer) returns machine_now
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_now;
begin
  -- Locked against an admin's change landing between this read and the purchase.
  perform 1 from machine_slots s where s.id = slot_for_sale.slot for share;
  select * into seen from machine_now m where m.slot = slot_for_sale.slot;
  if seen.slot is null then raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if wants = 'card' and seen.card is null then raise exception 'this slot sells a pack, not a card' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if wants = 'pack' and seen.pack is null then raise exception 'this slot sells a card, not a pack' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if seen.availability = 'soldOut' then raise exception 'this slot is sold out' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  if price is distinct from seen.price then
    raise exception 'the price is now %, not %', orbs(seen.price), case when price is null then 'nothing' else orbs(price) end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return seen;
end $$;

-- The roll of a pack: for each pull, a rarity by weight, then a card uniformly among the cards of that rarity less those the pack leaves out.
-- It reads no account and no character, only random() (so setseed() fixes it in a test) and the catalog.
create function roll_pack(pulls jsonb, leaves text[]) returns text[]
language plpgsql set search_path = public, pg_temp as $$
declare
  pull jsonb;
  total numeric;
  r numeric;
  upto numeric;
  w record;
  picked_rarity text;
  eligible integer;
  picked text;
  got text[] := '{}';
begin
  for pull in select e.pull from jsonb_array_elements(pulls) with ordinality e(pull, i) order by e.i loop
    select sum((x.value #>> '{}')::numeric) into total from jsonb_each(pull -> 'weights') x;
    r := random() * total;
    upto := 0;
    picked_rarity := null;
    for w in select x.key, (x.value #>> '{}')::numeric as weight from jsonb_each(pull -> 'weights') x order by x.key loop
      upto := upto + w.weight;
      if r < upto then picked_rarity := w.key; exit; end if;
    end loop;
    select count(*) into eligible from card_kinds k where k.rarity = picked_rarity and k.key <> all (leaves);
    if eligible = 0 then raise exception 'this pack has no % card to give', picked_rarity using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
    select k.key into picked from card_kinds k where k.rarity = picked_rarity and k.key <> all (leaves) order by k.key offset floor(random() * eligible)::integer limit 1;
    got := got || picked;
  end loop;
  return got;
end $$;

drop function buy_card(uuid, text, integer);

-- A card bought from its slot, at the price the slot shows now, from a wallet that holds it.
create function buy_card(who uuid, slot uuid, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_now;
  left_over integer;
begin
  seen := slot_for_sale(slot, 'card', price);
  left_over := wallet_spend(who, seen.price, 'purchase', null);
  insert into card_ledger (account, card, kind, price) values (who, seen.card, 'bought', seen.price);
  return jsonb_build_object('card', seen.card, 'balance', left_over, 'held', card_held(who, seen.card));
end $$;

-- A pack bought from its slot: the same checks, then the roll. One transaction spends the wallet, rolls the pulls, writes the pack with the pulls as
-- they stand and one `pulled` row per card, in pull order. Returns the pack's id and its kind, its contents in pull order, and the wallet's balance.
create function buy_pack(who uuid, slot uuid, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_now;
  pk pack_kinds;
  rolled text[];
  made uuid;
  left_over integer;
begin
  seen := slot_for_sale(slot, 'pack', price);
  select * into pk from pack_kinds k where k.key = seen.pack;
  rolled := roll_pack(pk.pulls, pk.leaves);
  left_over := wallet_spend(who, seen.price, 'purchase', null);
  insert into packs (account, slot, pack, price, odds, contents, opened_at) values (who, seen.slot, pk.key, seen.price, pk.pulls, rolled, now()) returning id into made;
  insert into card_ledger (account, card, kind, price, pack) select who, c.card, 'pulled', 0, made from unnest(rolled) with ordinality c(card, i) order by c.i;
  return jsonb_build_object('pack', made, 'kind', pk.key, 'contents', to_jsonb(rolled), 'balance', left_over);
end $$;

-- The caller's own packs, for the log.
create view my_packs with (security_invoker = true) as
  select p.id, p.slot, p.pack, p.price, p.odds, p.contents, p.bought_at, p.opened_at from packs p where p.account = auth.uid();

-- --------------------------------------------------------------------------------------------- access ----

alter table pack_kinds enable row level security;
alter table machine_slots enable row level security;
alter table packs enable row level security;
revoke all on pack_kinds, machine_slots, packs, machine_now, my_packs from public, anon, authenticated;
-- A pack's odds are the game's plain rules, shown on its slot.
grant select on pack_kinds to anon, authenticated;
create policy read on pack_kinds for select to anon, authenticated using (true);
grant select on machine_now to anon, authenticated;
grant select on packs, my_packs to authenticated;
create policy own on packs for select to authenticated using (account = auth.uid());

-- pack_pulls_problem stays PUBLIC's: a CHECK calls it, and it is pure and reads no table (0080).
revoke execute on function orbs(integer), slot_for_sale(uuid, text, integer), roll_pack(jsonb, text[]) from public, anon, authenticated;
revoke execute on function buy_card(uuid, uuid, integer), buy_pack(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function buy_card(uuid, uuid, integer), buy_pack(uuid, uuid, integer) to service_role;
revoke execute on function card_held(uuid, text) from public, anon;
grant execute on function card_held(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------- the writes that counted a hand ----
-- Each as its latest definition wrote it (play_card and set_card 0104, place_cast 0108, seed_instance 0108), with the count now card_held, a staff Cast's
-- base price the card's slot, and the seed adding packs and slots. Create or replace keeps each one's grants.

-- play_card and set_card (0104).
CREATE OR REPLACE FUNCTION public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held integer;
  said text := coalesce(message, '');
  played jsonb;
  written uuid;
begin
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  held := card_held(who, play_card.card);
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  played := place_cast(through, card, target, config, said, reach, from_post, who, price);
  written := (played ->> 'id')::uuid;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return played;
end $function$;

CREATE OR REPLACE FUNCTION public.set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held integer;
  placed jsonb;
  written uuid;
begin
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from accounts where id = who for no key update;
  held := card_held(who, set_card.card);
  if coalesce(held, 0) < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  placed := place_set(through, card, target, config, who, price);
  written := (placed ->> 'id')::uuid;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return placed;
end $function$;


-- place_cast (0108).
create or replace function place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded record;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  base integer;
  staff_caster boolean;
begin
  select c.staff is not null into staff_caster from characters c where c.id = caster;
  if staff_caster is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  -- Nobody pays for a staff character's card, and a player's is always paid for: the two must agree before anything is written.
  if staff_caster is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select * into kind_of from card_kinds k where k.key = place_cast.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play = 'set' then raise exception '% is set face down on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play not in ('cast', 'use') then raise exception '% is not played on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not (reach = any (kind_of.reaches)) then
    raise exception 'this card lands on %', reach_list(kind_of.reaches) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- A live ward on the post turns away a cast at or below its rarity, in the same words for everyone (cards.ts's wardWords).
    if kind_of.play = 'cast' then
      select wk.name, wk.rarity into warded from acts w join card_kinds wk on wk.key = w.payload ->> 'card'
      where w.kind = 'card' and w.target_act_id = target and wk.ward and not (w.payload ? 'caught') and coalesce(w.payload ->> 'reach', 'post') = 'post'
        and (w.payload ->> 'ends' is null or (w.payload ->> 'ends')::timestamptz > now()) and not card_ended(w.id)
        and rarity_rank(kind_of.rarity) <= rarity_rank(wk.rarity)
      order by rarity_rank(wk.rarity) desc limit 1;
      if warded.name is not null then
        raise exception 'this post''s % turns away cards up to %', warded.name, warded.rarity using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
    if up >= kind_of.stack then
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    if kind_of.play = 'cast' then
      -- A staff Cast is worth its base price to a trap that catches it (spring_traps), the price of the card's slot (0 for a card with none) and no one's wallet.
      base := case when payer is null then coalesce((select s.price from machine_slots s where s.card = place_cast.card), 0) else price end;
      sprung := spring_traps('cast', target, written, null, kind_of.rarity, payer, base);
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      select a.thread into in_thread from acts_public a where a.id = from_post and a.kind = 'post' and a.character = target;
      if in_thread is null then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      select a.id into on_post from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select b.name into target_name from boards_now b where b.id = target;
      select t.id into in_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
      if in_thread is null then
        raise exception 'there is no announcements thread to play a board card in yet' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
      on_post := null;
      -- One board card at a time, of any card.
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now() and not card_ended(r.play);
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    select count(*) into up from play_reach r join acts k on k.id = r.play
    where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
      and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
    if up >= kind_of.stack then
      where_words := 'this ' || reach;
      if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
  end if;

  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name)
              when sprung is not null then jsonb_build_object('caught', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when reach = 'post' and kind_of.play = 'use' and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- seed_instance (0108), also seeding packs and the machine's slots, and no longer a card's price.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0115). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0115). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The name of the member group every persona is in, which the instance gives.
  insert into settings (key, value)
  select 'staffGroup', payload -> 'system' -> 'staffGroup' where jsonb_typeof(payload -> 'system' -> 'staffGroup') = 'object'
  on conflict (key) do update set value = excluded.value;
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '' from made m;
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
