-- Card plays, traps and wards: every card names the one way it is played (Cast, Use, Set, or Keep, which is not built), carries
-- a rarity, and may be a trap (a Set card's) or a ward (a Use card's). docs/plans/2026-11-01-card-plays-plan.md, Tasks 2, 3 and 5;
-- docs/plans/2026-11-01-card-mechanic-design.md, sections 1 to 5, 9 and 11.
--
-- Two new Acts:
--   set     a card set face down on a post by the post's own author. Its payload is {} and nothing else: which card it is lives in
--           face_down, read by the setter's account alone, so a Bluff's set Act and a trap's are the same bytes but for their ids
--           and times. It takes no place in its thread, as a card does not.
--   spring  the reveal: a trap sprung, by the setter's character on the trapped post, naming the card, the trigger, the outcome,
--           the set it ends (`set`), the Act that sprang it (`by`) and, for a catch, the play it caught (`caught`). Public.
--
-- A face-down card is live while its ends_at is ahead and no spring names its set. A spring ends it; time ends it by itself;
-- nothing is ever updated (face_down is never edited, as a ledger is not). A face-down card's ways out: it springs once, or it
-- ends at setLasts. A ward's: it ends at its card's lasts, written in its play's payload when it lands. A caught play is a finished
-- Act whose card is spent, and it takes no layer, so the post can carry that card again.
--
-- A trap never refuses, delays or rolls back the write that springs it (design, section 4). spring_traps is called inside
-- play_card, react and post, after each has checked everything it refuses on, and raises for nothing a well-formed write brings:
-- a strike that cannot land leaves the trap set, a trap that does not match does nothing. supabase/tests/0059-card-plays.sql
-- holds that, with every trigger.
--
-- The masks (design, section 11). Every trap check is the same reads whatever card is face down: one probe of face_down by its
-- post through its index, the row locked, its card's kind read, and the spring index probed; a Bluff and a trap waiting on another
-- trigger then do nothing alike. A refusal reads only public facts: the author of the post, the ward on it, the card's rarity, a
-- live card back. Pay out credits the setter's account read from face_down, and no response carries the amount or the account.
--
-- Locks, in one order everywhere: the caster's account, then the target post, then the post's face_down row, then the wallets,
-- both in account order where a payout moves two. set_card takes the same first two and writes face_down after, so it never waits
-- on a face_down row another write holds.
--
-- On an instance that already holds plays: every card kind is common and a Cast until it is seeded again, and no Act changes. A
-- Whoops! or Stick Around play has no `caught` and keeps its layer, as before.

-- ------------------------------------------------------------------------------ card kinds ----

-- The rarities, in order: a trap catches, and a ward turns away, a card at or below its own.
create function rarity_rank(rarity text) returns integer
language sql immutable set search_path = public, pg_temp as $$
  select array_position(array['common', 'uncommon', 'rare', 'legendary'], rarity)
$$;

alter table card_kinds
  add column rarity text not null default 'common' check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  add column play text not null default 'cast' check (play in ('cast', 'use', 'set', 'keep')),
  add column trap jsonb,
  add column ward boolean not null default false,
  add column lasts interval,
  add constraint card_kinds_trap_set check (trap is null or play = 'set'),
  add constraint card_kinds_ward_use check (not ward or play = 'use'),
  add constraint card_kinds_lasts_use check (lasts is null or play = 'use'),
  add constraint card_kinds_no_keep check (play <> 'keep'),
  add constraint card_kinds_trap_shape check (trap is null or (
    trap #>> '{trigger,on}' in ('cast', 'reaction', 'reply', 'quote')
    and (trap #>> '{trigger,on}' <> 'reaction' or trap #>> '{trigger,quadrant}' in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))
    and trap #>> '{outcome,do}' in ('nullify', 'payout', 'strike')
    and (trap #>> '{outcome,do}' <> 'payout' or trap #>> '{trigger,on}' = 'cast')
    and (trap #>> '{outcome,do}' <> 'strike' or (trap #>> '{trigger,on}' in ('reply', 'quote') and jsonb_typeof(trap #> '{outcome,card}') = 'string'))) is true);

-- What is wrong with a seed's cards, as instanceProblems (engine/rules/instance.ts) says it, or null. The table's checks hold the
-- same shape for any writer; this names the card for the one who seeds.
create function card_kinds_problem(cards jsonb) returns text
language sql stable set search_path = public, pg_temp as $$
  select string_agg(why, '; ' order by key) from (
    select e ->> 'key' as key, unnest(array[
      case when e ->> 'rarity' is null then format('card "%s" has no rarity; a rarity is common, uncommon, rare or legendary', e ->> 'key')
           when rarity_rank(e ->> 'rarity') is null then format('card "%s" has the rarity "%s"; a rarity is common, uncommon, rare or legendary', e ->> 'key', e ->> 'rarity') end,
      case when coalesce(e ->> 'play', 'cast') not in ('cast', 'use', 'set', 'keep') then format('card "%s" is played "%s"; a card is cast, used, set or kept', e ->> 'key', e ->> 'play') end,
      case when e ->> 'play' = 'keep' then format('card "%s" is kept, and Keep is not built until it is designed', e ->> 'key') end,
      case when e ? 'trap' and coalesce(e ->> 'play', 'cast') <> 'set' then format('card "%s" has a trap, and only a Set card does', e ->> 'key') end,
      case when coalesce((e ->> 'ward')::boolean, false) and coalesce(e ->> 'play', 'cast') <> 'use' then format('card "%s" is a ward, and only a Use card is', e ->> 'key') end,
      case when e ? 'lasts' and coalesce(e ->> 'play', 'cast') <> 'use' then format('card "%s" has a time up (lasts), and only a Use card does', e ->> 'key') end,
      case when e #>> '{trap,trigger,on}' = 'visit' then format('card "%s" springs on a visit, which is not wired until the staff build adds Mod Bot visits', e ->> 'key') end,
      case when e #>> '{trap,outcome,do}' = 'strike' and not exists (select 1 from jsonb_array_elements(cards) s where s ->> 'key' = e #>> '{trap,outcome,card}')
             and not exists (select 1 from card_kinds k where k.key = e #>> '{trap,outcome,card}')
           then format('card "%s" strikes with "%s", which the instance does not have', e ->> 'key', e #>> '{trap,outcome,card}') end,
      case when e #>> '{trap,outcome,do}' = 'strike' and rarity_rank(e ->> 'rarity') < (
             select rarity_rank(s ->> 'rarity') from jsonb_array_elements(cards) s where s ->> 'key' = e #>> '{trap,outcome,card}' limit 1)
           then format('card "%s" strikes with "%s", which is rarer than the trap (%s)', e ->> 'key', e #>> '{trap,outcome,card}', e ->> 'rarity') end
    ]) as why
    from jsonb_array_elements(coalesce(cards, '[]')) e
  ) p where why is not null
$$;

-- A Use card's time up is a span the seed gives as the engine does ({unit, count}); span_interval reads none as null.

-- ------------------------------------------------------------------------------ the setting ----

-- setLasts, how long every Set stays set, is a span like a season's length (0007's trigger, now with it).
create or replace function settings_spans_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key in ('settlementLength', 'seasonLength', 'turnCooldown', 'setLasts') and not (
       jsonb_typeof(new.value) = 'object' and new.value ->> 'unit' in ('day', 'week', 'month')
       and jsonb_typeof(new.value -> 'count') = 'number' and (new.value ->> 'count')::numeric >= 1
       and (new.value ->> 'count')::numeric <= 1000
       and (new.value ->> 'count')::numeric = trunc((new.value ->> 'count')::numeric)) then
    raise exception '% is a span: a unit of day, week or month and a whole count from 1 to 1000', new.key using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------- the new Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring'));
-- (acts_check1 needs no change: a set and a spring each name their post, so neither is among the kinds that point at nothing.
-- acts_character_null needs none: each is a character's.)
-- A set and a spring take no place in their thread, as a card does not (0035).
alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring'));
-- A set says nothing about its card. (`is true`: a check that is null passes.)
alter table acts add constraint acts_set_payload check (kind <> 'set' or payload = '{}'::jsonb);
alter table acts add constraint acts_spring_payload check (kind <> 'spring' or (
  jsonb_typeof(payload -> 'card') = 'string'
  and payload ->> 'trigger' in ('cast', 'reaction', 'reply', 'quote', 'visit')
  and jsonb_typeof(payload -> 'outcome') = 'object'
  and jsonb_typeof(payload -> 'set') = 'string'
  and coalesce(jsonb_typeof(payload -> 'by'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'caught'), 'null') in ('string', 'null')
  and payload - array['card', 'trigger', 'outcome', 'set', 'by', 'caught'] = '{}'::jsonb) is true);
-- One spring per set: what makes "springs once" a constraint and finds a set's spring by index.
create unique index acts_one_spring on acts ((payload ->> 'set')) where kind = 'spring';
-- A post's card backs, for card_target and the trap probe's way back from a post.
create index acts_sets on acts (target_act_id) where kind = 'set';

create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;


-- acts_well_formed (0051), with a set and a spring held to their posts; everything else as 0051 wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'unmask' and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an unmask names the class its character holds' using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;


-- --------------------------------------------------------------------------- face down ----

-- Which card a set is: the setter's account's alone, as a class is. `post` and `thread` are the set's, kept here so the trap probe
-- is one index read by post (and a reply's by thread). `round` is the post's count of sets, so a post holds one face-down card
-- at a time: set_card counts under the post's lock, and the unique index refuses a writer that skipped it. `config` is the struck
-- card's configuration for a trap that strikes, else the Set card's own. Never edited ("A spring ends it ... never by an UPDATE").
create table face_down (
  play uuid primary key references acts (id),
  account uuid not null references accounts (id),
  card text not null references card_kinds (key),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 4096),
  post uuid not null references acts (id),
  thread uuid not null references threads (id),
  round integer not null check (round >= 1),
  ends_at timestamptz not null,
  unique (post, round)
);
create index face_down_thread on face_down (thread, ends_at);
create index face_down_account on face_down (account);
create trigger face_down_no_update before update or delete on face_down for each row execute function ledger_append_only();
create trigger face_down_no_truncate before truncate on face_down for each statement execute function ledger_append_only();
alter table face_down enable always trigger face_down_no_update;
alter table face_down enable always trigger face_down_no_truncate;
alter table face_down enable row level security;
revoke all on face_down from public, anon, authenticated;
grant select on face_down to authenticated;
create policy own on face_down for select to authenticated using (account = auth.uid());

-- The caller's own face-down cards, for the hand and the log: which card, on which post, when it was set and until when, whether it
-- sprang, and when it ended (`ended_at`: its spring, or its time once that has passed; null while it is live). The log reads its ends
-- by `ended_at`. Its cost is the caller's own sets, through face_down_account and the spring index.
create view my_face_down as
  select f.play, f.card, f.config, f.post, f.thread, a.created_at as set_at, f.ends_at, s.id as spring, s.created_at as sprung_at,
    coalesce(s.created_at, case when f.ends_at <= now() then f.ends_at end) as ended_at
  from face_down f join acts a on a.id = f.play left join acts s on s.kind = 'spring' and (s.payload ->> 'set') = f.play::text
  where f.account = auth.uid();
revoke all on my_face_down from public, anon, authenticated;
grant select on my_face_down to authenticated;

-- The caller's own plays a trap caught, for the log's line: the card, the post, the trap's card and its spring (public by then), what
-- the play cost and what the caller paid for the card at the machine, the latest purchase of it at or before the play. Never the
-- trap's setter or their account. Its cost is the caller's own card ledger.
create view my_caught as
  select k.id as play, l.card, k.target_act_id as post, l.at, s.payload ->> 'card' as trap, s.id as spring, l.price,
    (select b.price from card_ledger b where b.account = l.account and b.card = l.card and b.kind = 'bought' and b.at <= l.at
     order by b.at desc, b.id desc limit 1) as bought_price
  from card_ledger l
  join acts k on k.id = l.act and k.kind = 'card' and k.payload ? 'caught'
  join acts s on s.kind = 'spring' and (s.payload ->> 'set') = k.payload ->> 'caught'
  where l.account = auth.uid() and l.kind = 'played';
revoke all on my_caught from public, anon, authenticated;
grant select on my_caught to authenticated;

-- A trap's payout is a wallet event of its own kind.
alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap'));

-- -------------------------------------------------------------------------------- springing ----

-- A post's face-down card, sprung by `trigger` if it is a trap waiting on it. `by_act` is the Act that sprang it (the cast, the
-- reply, the quote; none for a reaction), `quadrant` a reaction's, `incoming_rarity` a cast's card's, and `caster` and `price` the
-- caster's account and what their wallet pays for the cast, which a payout moves to the setter. Returns the spring Act's projection,
-- with a strike's card play under `struck`, or null. The reads are the same for every card face down: the row is locked, its card's kind read and the spring index probed,
-- whether it springs or not.
create function spring_traps(trigger text, post uuid, by_act uuid, quadrant text default null, incoming_rarity text default null,
                             caster uuid default null, price integer default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  kind_of card_kinds%rowtype;
  struck card_kinds%rowtype;
  setter_character uuid;
  springs boolean;
  outcome text;
  sprung uuid;
  struck_play uuid;
  layer integer;
begin
  select f.* into fd from face_down f
  where f.post = spring_traps.post and f.ends_at > now()
  order by f.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  select * into kind_of from card_kinds k where k.key = fd.card;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  springs := kind_of.trap #>> '{trigger,on}' is not distinct from trigger
    and (trigger <> 'reaction' or kind_of.trap #>> '{trigger,quadrant}' is not distinct from quadrant)
    and (trigger <> 'cast' or coalesce(rarity_rank(incoming_rarity) <= rarity_rank(kind_of.rarity), false));
  if not springs then return null; end if;
  outcome := kind_of.trap #>> '{outcome,do}';
  select a.character into setter_character from acts a where a.id = fd.play;
  if outcome = 'strike' then
    select * into struck from card_kinds k where k.key = kind_of.trap #>> '{outcome,card}';
    -- A strike that cannot land leaves the trap set: its target already carries its stack of the card.
    select count(*) + 1 into layer from acts k
    where k.kind = 'card' and k.target_act_id = by_act and k.payload ->> 'card' = struck.key and not (k.payload ? 'caught');
    if struck.key is null or by_act is null or layer > struck.stack
       or (select a.kind from acts a where a.id = by_act) is distinct from 'post' then return null; end if;
  end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'outcome', kind_of.trap -> 'outcome', 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and outcome in ('nullify', 'payout') then by_act::text end))) returning id into sprung;
  if outcome = 'payout' and coalesce(price, 0) > 0 and caster is not null then
    -- Both wallets, in account order, so two players' casts on each other's traps cannot wait on each other.
    insert into wallets (account) values (caster), (fd.account) on conflict (account) do nothing;
    perform 1 from wallets w where w.account in (caster, fd.account) order by w.account for update;
    perform wallet_move(fd.account, price, 'trap', null, sprung);
  elsif outcome = 'strike' then
    insert into acts (character, kind, thread, target_act_id, payload)
    select setter_character, 'card', a.thread, by_act, jsonb_build_object('card', struck.key, 'layer', layer, 'message', '', 'spring', sprung::text,
      'config', case when struck.seeded then fd.config - 'seed' else fd.config end)
      || case when struck.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
    from acts a where a.id = by_act returning id into struck_play;
    -- The struck card's play goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(struck_play));
  end if;
  return act_projection(sprung);
end $$;

-- ------------------------------------------------------------------------------- set_card ----

-- A card set face down, by the service for `who` (the act function decides it with the card's rules first, as it does a play):
-- by the post's own author, from a hand that holds the card, on a post with no live card back, from a wallet that covers its price.
create function set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  kind_of card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = set_card.card;
  if coalesce(held, 0) < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select * into kind_of from card_kinds k where k.key = set_card.card;
  if kind_of.play is distinct from 'set' then raise exception '% is not set face down; it is played another way', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from through then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Public, since the back is.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at)
    values (written, who, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')));
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written);
end $$;

-- ------------------------------------------------------------------------------ play_card ----

-- play_card (0016), for a Cast and a Use: a Use goes on a post of the caller's character's own and carries its end; a Cast is turned
-- away by a live ward that covers its rarity, before the stack is counted; and a Cast on a post with a card back runs the trap
-- check, so a caught cast is written with `caught` naming the set, takes no layer, and is spent all the same. A Set card is set,
-- through set_card. The answer is the play's projection, with the spring's (`sprung`) where it sprang one. Everything else as 0016.
create or replace function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded record;
  sprung jsonb;
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = play_card.card;
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select * into kind_of from card_kinds k where k.key = play_card.card;
  if kind_of.play = 'set' then raise exception '% is set face down on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play not in ('cast', 'use') then raise exception '% is not played on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play = 'use' and author is distinct from through then
    raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  -- A live ward on the post turns away a cast at or below its rarity, in the same words for everyone (cards.ts's wardWords).
  if kind_of.play = 'cast' then
    select wk.name, wk.rarity into warded from acts w join card_kinds wk on wk.key = w.payload ->> 'card'
    where w.kind = 'card' and w.target_act_id = target and wk.ward and not (w.payload ? 'caught')
      and (w.payload ->> 'ends' is null or (w.payload ->> 'ends')::timestamptz > now())
      and rarity_rank(kind_of.rarity) <= rarity_rank(wk.rarity)
    order by rarity_rank(wk.rarity) desc limit 1;
    if warded.name is not null then
      raise exception 'this post''s % turns away cards up to %', warded.name, warded.rarity using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
  end if;
  select count(*) + 1 into layer from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught');
  if layer > kind_of.stack then
    if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if kind_of.play = 'cast' then sprung := spring_traps('cast', target, written, null, kind_of.rarity, who, price); end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, through, 'card', in_thread, target, jsonb_build_object('card', card, 'message', said,
      'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end)
      || case when sprung is not null then jsonb_build_object('caught', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.play = 'use' and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end);
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------------------- card_target ----

-- card_target (0006), with each effect's ward and end, and a post's card backs as `{card: null, faceDown: true, ends}`, never naming
-- their card: a back ends when it springs or at its time, whichever comes first, and its time is setLasts after it was set, the same
-- for every card. A caught play is no effect: it takes no layer and does nothing.
create or replace function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'ward', case when ck.ward then ck.rarity end, 'ends', k.payload ->> 'ends')) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught')
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
  from acts_public a where a.id = target
$$;

-- --------------------------------------------------------------------- the writes that spring ----

-- react (0015), with the reaction trap check after the reaction is written: a trap waiting on the reaction's quadrant springs, and
-- the answer carries the spring (`sprung`). Everything else as 0015 wrote it.
create or replace function react(target uuid, through uuid, reaction text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
  sprung jsonb;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  if not exists (select 1 from reaction_kinds k where k.key = reaction) then
    raise exception 'there is no reaction "%"', reaction using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The System's own Acts (a tally, the reveal) have no author, and no author's owner to hold the
  -- caller apart from: they are reacted to like any Act, and pay nobody (settle.ts).
  select a.kind, c.owner into target_kind, author_owner
  from acts a left join characters c on c.id = a.character where a.id = target;
  if target_kind is null then
    raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if target_kind = 'edit' then raise exception 'an edit is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The author's owner now: a character changing hands is not in this slice, and the session
  -- that adds it decides what becomes of reactions between its old and new owner's characters.
  if author_owner = caller then
    raise exception 'your characters cannot react to each other' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;

  select coalesce(array_agg(r.kind order by r.slot), '{}') into held
  from reactions r where r.act = target and r.reactor_account = caller;
  -- The lowest free slot, so a slot given back (a reaction removed, later) is taken again rather
  -- than colliding for ever. The slot only makes two reactions at once collide; the cap is held
  -- by the count above, so lowering reactionCap later leaves existing reactions as they are.
  select min(g) into free_slot from generate_series(1, cardinality(held) + 1) g
  where not exists (select 1 from reactions r where r.act = target and r.reactor_account = caller and r.slot = g);
  if reaction = any (held) then
    raise exception 'you have already left that reaction here' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if cardinality(held) >= cap then
    raise exception 'you have left % reactions here, the most there are', cap using hint = 'kayfabb.refusal', errcode = '23514';
  end if;

  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot)
    values (target, through, caller, reaction, free_slot);
  exception when unique_violation then
    -- Another reaction of this player's landed between the read above and this write.
    raise exception 'you reacted here twice at once; try again' using hint = 'kayfabb.refusal', errcode = '40001';
  end;
  insert into reaction_tallies (act, kind, count) values (target, reaction, 1)
  on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  -- After every refusal: a trap never refuses the reaction that springs it.
  if target_kind = 'post' then sprung := spring_traps('reaction', target, null, (select k.quadrant from reaction_kinds k where k.key = reaction)); end if;

  return jsonb_build_object('act', target, 'thread', (select thread from acts where id = target),
    'tally', (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target))
    || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- post (0013), with the quote and reply trap checks after the post is written: a quoted post's quote trap springs, and so does a
-- reply trap on the newest earlier post in the thread by another character whose card back is live. Every live back in the thread
-- that is not the poster's own is read, newest first, in the same way whatever its card, until one springs. The answer carries the
-- spring (`sprung`), and a strike's card lands on this post. Everything else as 0013 wrote it.
create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  if quoting is not null then sprung := spring_traps('quote', quoting, written); end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.thread = in_thread and f.ends_at > now() and p.character <> through and p.id <> written
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written);
      exit when sprung is not null;
    end loop;
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ----------------------------------------------------------------------- the settlement ----

-- A staff side is a staff character's own Act, and only that (0043 counted a card on a staff post too): a card on a staff post now
-- earns its caster by class, judged against the post (#122). settlement_input and estimate_input name such a post an unscored
-- target, with its reactions, and settle.ts pays it and its reactors nothing. A card on a staff post is in the input once, as its
-- caster's Act; the post is in it once, as the unscored target. Every other staff Act is left out as before, in systemActs.
create or replace function is_staff_side(author uuid, kind text, target uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from characters c where c.id = author and c.staff is not null)
$$;

-- settlement_input (0043), with a staff post a window's card landed on as an unscored target, and a spring as a play of its card on
-- the trapped post (its card, its target, and the earlier plays a reaction to the target reaches). Everything else as 0043 wrote it.
create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end),
  reacted as (select distinct act from win_reactions),
  earlier_reactions as (select r.* from reactions r join reacted x on x.act = r.act where r.created_at < window_start),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring')
    union select id from first_posts
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start)),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character) order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- What earlier windows paid for each vote this window's reactions touch.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', p.account, 'act', p.act, 'weight', p.weight, 'shares', p.shares) order by p.account, p.act)
      from paid_votes p join (select distinct act, reactor_account from win_reactions) w on w.act = p.act and w.reactor_account = p.account), '[]'))
$$;

-- estimate_input (0043), the same changes for the owner's estimate, so the two never disagree. Everything else as 0043 wrote it.
create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with
  mine as (select id from characters where owner = account),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from acts a join characters c on c.id = a.character join touched t on t.id = a.id
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start)),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but a player's to their own character's, and none
  -- on The System's own Acts: the settlement pays nobody for those (Task 3), and the tally every
  -- player reacts to would hand each caller who reacted to it every other player's reaction.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and r.reactor_account is distinct from c.owner
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character) order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;

-- ---------------------------------------------------------------------------- the seed ----

-- seed_instance (0051), writing each card's rarity, play, trap, ward and time up, and refusing the pairings instanceProblems
-- refuses. Everything else as 0051 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's play, rarity, trap, ward and time up (0054), checked as instanceProblems checks them, each naming the card.
  select card_kinds_problem(payload -> 'cards') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are; so
  -- are its rarity, its play, its trap, whether it is a ward and how long a Use of it is up.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads, rarity, play, trap, ward, lasts)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts;
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
  -- The instance's staff (0043), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board) select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false) from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the Bosses of the seed's staff, in the order it lists them, so the rotation has one to follow. A seed with no
  -- Boss leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord) where e.value ->> 'kind' = 'boss'
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
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;


revoke execute on function rarity_rank(text), card_kinds_problem(jsonb),
  spring_traps(text, uuid, uuid, text, text, uuid, integer), set_card(uuid, text, uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function set_card(uuid, text, uuid, uuid, jsonb, integer) to service_role;
