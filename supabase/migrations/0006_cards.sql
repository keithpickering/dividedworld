-- Cards and the Vending Machine: buying a card, playing it on a post, and the state an effect
-- keeps (Whoops!'s strokes).
--
-- Task 10 of docs/plans/2026-10-28-core-loop-engine-plan.md; the design's sections 7, 8 and
-- 10. A card's own rules (its play price, whether it lands, its configuration, its state) are
-- the instance's TypeScript, which this SQL cannot run; so the three writes here are the
-- service role's, called by the act Edge Function after it has decided the request with those
-- rules and asked the database, as the player, who they are (whoami()). What this file holds
-- whatever that code does:
--   - a card is bought at the Vending Machine's price, from a wallet that holds it, or not at all;
--   - a card is played only by a player who holds one, through a character they play, on a
--     post that does not already carry it, from a wallet that covers its price;
--   - an effect's state is saved only by the author of the post it landed on, and is bounded;
--   - the card ledger is never edited ("Append-only"), and every wallet change is recorded.
-- Who holds which cards is the player's alone ("cards need no owner but the player").

create table card_ledger (
  id bigint generated always as identity primary key,
  account uuid not null references accounts (id),
  card text not null references card_kinds (key),
  kind text not null check (kind in ('bought', 'played')),
  act uuid references acts (id),
  price integer not null check (price >= 0),
  at timestamptz not null default now(),
  check ((kind = 'played') = (act is not null))
);
create index card_ledger_account on card_ledger (account, card);
create trigger card_ledger_no_update before update or delete on card_ledger for each row execute function ledger_append_only();
create trigger card_ledger_no_truncate before truncate on card_ledger for each statement execute function ledger_append_only();
alter table card_ledger enable always trigger card_ledger_no_update;
alter table card_ledger enable always trigger card_ledger_no_truncate;

-- The state an effect keeps: one row per card played, rewritten as its target's author saves it.
-- Not an Act and never one's payload: a splat washed away a stroke at a time is a state that
-- changes often, and lives in a row of its own ("Append-only").
create table effect_state (
  play uuid primary key references acts (id),
  state jsonb not null check (octet_length(state::text) <= 262144),
  saved_by uuid not null references characters (id),
  saved_at timestamptz not null default now()
);

-- The cards a player holds: bought, less played.
create view my_cards with (security_invoker = true) as
  select card, (count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played'))::integer as held
  from card_ledger where account = auth.uid() group by card;

-- A wallet debit that is refused, not floored, when the wallet does not hold it.
create function wallet_spend(who uuid, amount integer, what text, about uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare was integer;
begin
  if amount is null or amount < 0 then raise exception 'a price is a whole amount, at least zero' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into wallets (account) values (who) on conflict (account) do nothing;
  select balance into was from wallets where account = who for update;
  if was < amount then
    raise exception 'that costs %, and your wallet holds %', amount, was using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  if amount = 0 then return was; end if;
  update wallets set balance = was - amount where account = who;
  insert into wallet_events (account, kind, change, balance_after, ref) values (who, what, -amount, was - amount, about);
  return was - amount;
end $$;

-- The caller's account, for the Edge Function to make a service write as them.
create function whoami() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from accounts a where a.id = auth.uid()
$$;

-- What a card's rules read about a post: its kind, its current text's length, the cards already
-- on it. All public.
create function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'effects', coalesce((select jsonb_agg(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id) order by k.created_at)
                         from acts k where k.kind = 'card' and k.target_act_id = a.id), '[]'))
  from acts_public a where a.id = target
$$;

-- Which card a play is, for its rules to read the state saved on it.
create function card_of_play(play uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select a.payload ->> 'card' from acts a where a.id = play and a.kind = 'card'
$$;

create function buy_card(who uuid, card text, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  listed integer;
  left_over integer;
begin
  if not exists (select 1 from card_kinds where key = card) then raise exception 'the Vending Machine has no card "%"', card using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- Its price is the economy setting the card names: what the settings rows hold now, a whole
  -- number however it is written (20 and 20.0 alike), as the engine reads it.
  select (setting('economy') ->> k.price_setting)::numeric::integer into listed from card_kinds k where k.key = card;
  if listed is null or listed <= 0 then raise exception 'the settings give "%" no price', card using errcode = 'P0002'; end if;
  if price is distinct from listed then raise exception 'the price is %, not %', listed, price using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  left_over := wallet_spend(who, listed, 'purchase', null);
  insert into card_ledger (account, card, kind, price) values (who, card, 'bought', listed);
  return jsonb_build_object('card', card, 'balance', left_over,
    'held', (select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') from card_ledger l where l.account = who and l.card = buy_card.card));
end $$;

create function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  target_kind text;
  in_thread uuid;
  written uuid;
begin
  if not exists (select 1 from characters c where c.id = through and c.owner = who) then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = play_card.card;
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select a.kind, a.thread into target_kind, in_thread from acts a where a.id = target;
  if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- One of each card per post: said here, and held by acts_one_card_per_post when two land at once.
  if exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card) then
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  begin
    insert into acts (character, kind, thread, target_act_id, payload)
    values (through, 'card', in_thread, target, jsonb_build_object('card', card, 'config', coalesce(config, '{}'))) returning id into written;
  exception when unique_violation then
    -- Another player's play of the same card landed on the post between the check and this write.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written);
end $$;

-- One card of each kind per post, held as a constraint too: two plays at once cannot both land.
create unique index acts_one_card_per_post on acts (target_act_id, (payload ->> 'card')) where kind = 'card';

create function save_effect_state(who uuid, through uuid, on_play uuid, state jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare author uuid;
begin
  if not exists (select 1 from characters c where c.id = through and c.owner = who) then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  select t.character into author from acts k join acts t on t.id = k.target_act_id where k.id = on_play and k.kind = 'card';
  if author is null then raise exception 'there is no such card on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if author <> through then raise exception 'only the post''s author saves what is on it' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Timed when written, after any save it waited on, so the newest saved_at is the state kept.
  insert into effect_state as e (play, state, saved_by, saved_at) values (on_play, state, through, clock_timestamp())
  on conflict on constraint effect_state_pkey do update set state = excluded.state, saved_by = excluded.saved_by, saved_at = clock_timestamp();
  return (select jsonb_build_object('play', e.play, 'thread', (select thread from acts where id = on_play), 'state', e.state, 'saved_at', e.saved_at)
          from effect_state e where e.play = on_play);
end $$;

alter table card_ledger enable row level security;
alter table effect_state enable row level security;
revoke all on card_ledger, effect_state, my_cards from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on card_ledger, my_cards to authenticated;
create policy own on card_ledger for select to authenticated using (account = auth.uid());
-- Every reader loads the author's version.
grant select on effect_state to authenticated;
create policy read on effect_state for select to authenticated using (true);

-- The economy row holds the cards' prices (card_kinds.price_setting names each), so it is
-- checked when it is written, never when a purchase meets it: an object of numbers, with a price
-- for every card, each a whole number above 0 that an integer holds. A row that fails names what
-- is wrong and changes nothing; the numbers the classes read are checked by the engine the same
-- way (engine/rules/instance.ts), so a settlement refuses a row that lacks one and the way out is
-- the same: write the row whole again, or seed the instance.
create function economy_holds(economy jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(economy) is distinct from 'object' then 'the economy is an object of named numbers'
    else (select string_agg(format('"%s" is not a number', e.key), ', ' order by e.key) from jsonb_each(economy) e where jsonb_typeof(e.value) <> 'number')
  end
$$;
create function price_holds(economy jsonb, price_setting text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  -- Never null: a price that is missing is a price that does not hold.
  select coalesce(jsonb_typeof(economy -> price_setting) = 'number'
     and (economy ->> price_setting)::numeric = trunc((economy ->> price_setting)::numeric)
     and (economy ->> price_setting)::numeric > 0 and (economy ->> price_setting)::numeric <= 2147483647, false)
$$;
create function settings_economy_whole() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare why text;
begin
  if tg_op = 'DELETE' then
    if old.key = 'economy' and exists (select 1 from card_kinds) then raise exception 'the economy holds the cards'' prices; replace it, never delete it' using errcode = '23514'; end if;
    return old;
  end if;
  if new.key <> 'economy' then return new; end if;
  -- An insert that meets the row already there becomes an update (seed_instance merges), and is
  -- checked as one, on the merged value.
  if tg_op = 'INSERT' and exists (select 1 from settings where key = 'economy') then return new; end if;
  why := economy_holds(new.value);
  if why is not null then raise exception 'economy: %', why using errcode = '23514'; end if;
  select string_agg(format('%s (%s)', k.price_setting, k.key), ', ' order by k.key) into why from card_kinds k where not price_holds(new.value, k.price_setting);
  if why is not null then raise exception 'economy: no whole price above 0 for %', why using errcode = '23514'; end if;
  return new;
end $$;
create trigger settings_economy_whole before insert or update or delete on settings for each row execute function settings_economy_whole();
create function card_kinds_priced() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not price_holds((select value from settings where key = 'economy'), new.price_setting) then
    raise exception 'card "%" is priced by economy "%", which the economy does not hold as a whole number above 0', new.key, new.price_setting using errcode = '23514';
  end if;
  return new;
end $$;
create trigger card_kinds_priced before insert or update on card_kinds for each row execute function card_kinds_priced();

revoke execute on function economy_holds(jsonb), price_holds(jsonb, text), settings_economy_whole(), card_kinds_priced() from public, anon, authenticated;
revoke execute on function wallet_spend(uuid, integer, text, uuid), buy_card(uuid, text, integer),
  play_card(uuid, text, uuid, uuid, jsonb, integer), save_effect_state(uuid, uuid, uuid, jsonb), whoami(), card_target(uuid), card_of_play(uuid)
  from public, anon, authenticated;
grant execute on function buy_card(uuid, text, integer), play_card(uuid, text, uuid, uuid, jsonb, integer),
  save_effect_state(uuid, uuid, uuid, jsonb), card_target(uuid) to service_role;
grant execute on function whoami(), card_target(uuid), card_of_play(uuid) to authenticated;
