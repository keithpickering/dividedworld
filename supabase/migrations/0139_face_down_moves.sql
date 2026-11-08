-- Face-down Moves, the schema (docs/plans/2026-11-07-face-down-moves-plan.md, Task 3; the design is docs/plans/2026-11-07-face-down-moves-design.md, sections 4, 5 and 9).
-- The plan's later tasks append their sections to this file.
--
--   face_down.catches / face_down.phrase   the card a Trap Card waits for (a key of card_kinds), or the phrase a Move's landing needs in the quoting post's own words. A row holds at most one
--                           of them (face_down_one_of); a back set before this holds neither, and no row is updated to hold one (face_down's append-only triggers stay). A phrase is not empty.
--   card_kinds_trap_shape   a trap is {trigger: {on}} with `on` a cast or a visit: a Gimmick's alone. A Move's trigger is the engine's (a quote), never a card's; reaction, reply, outcomes,
--                           payouts and strikes are gone. NOT VALID because the only rows with the old shape are test cards (no instance is deployed); validating would stop this migration on a database that holds one, while every write to a card_kinds row, the seed's upsert included, is checked.
--   card_kinds_problem      holds engine/rules/instance.ts's rules again, in its words: "has a trap, and only a Gimmick does" and "springs on <on>; a Gimmick springs on cast or visit". That a cast Gimmick
--                           names a catch, and that a set phrase is a Move's, are functions of the engine's CardRules, so they stay with instanceProblems. seed_instance (0132) already writes
--                           `trap` as the instance gave it, so it is not replaced.
--   card_ledger.kind        gains `caught`: a card a Trap Card took, in the setter's own ledger; `act` is the spring, and it costs nothing, as a bought row has no Act and a played row has its card's.
--   card_held(account, card)   the one hand count: bought plus caught less played. play_card and set_card (0104) call it where they counted inline; so does my_cards. The booster packs plan
--                           (docs/plans/2026-11-04-booster-packs-plan.md) also gives the hand one function: whichever lands second adds its kind to the other's.
--   my_cards                reads the hand through card_held, still security_invoker and the caller's own rows.
--   my_face_down            returns `catches` and `phrase` (last) to the setter. my_card_ledger (0075) already returns every kind the caller's account holds, so a `caught` row reaches the log with
--                           no change to it.
--
-- Copied from their latest definitions: play_card (nine arguments) and set_card from 0104_warn_bar.sql, with the inline hand count replaced by card_held and nothing else changed, the lock order
-- (0075's header, steps 1 to 6) included: step 1 (the player's accounts row) is still taken before the count; card_held takes no lock. card_kinds_problem from 0108_interception.sql, my_face_down
-- from 0078_reply_passes.sql, my_cards from 0006_cards.sql. buy_card is 0006's, its reported `held` now from card_held; no inline count of a hand is left.
-- Masks. A back's catch and phrase are the setter's alone: face_down is read through its `own` policy and my_face_down through the caller's account, and neither is in an Act, a projection or
-- card_target. card_held answers a signed-in caller for their own account alone (any other account's count reads 0, a constant) and the definer functions that spend a card for the account they act for; no anon role executes it.
-- Ways out. Unchanged and none added by the schema: a back springs once or ends at setLasts; a caught card is a card in the setter's hand like any other.
-- Append-only. Nothing here updates a face_down or card_ledger row. A caught card is one more ledger row beside the caster's `played` row.

-- ------------------------------------------------------------------------------------------------------- face_down ----

alter table face_down
  add column catches text references card_kinds (key),
  add column phrase text,
  add constraint face_down_one_of check (catches is null or phrase is null),
  add constraint face_down_phrase check (phrase is null or btrim(phrase) <> '');

-- my_face_down (0078), with the named catch and the phrase last. The setter's own row, so the setter's log and set form may read what the back waits for.
create or replace view my_face_down as
  select f.play, f.card, f.config, f.post, f.thread, a.created_at as set_at, f.ends_at, s.id as spring, s.created_at as sprung_at,
    coalesce(s.created_at, case when f.ends_at <= now() then f.ends_at end) as ended_at, r.passed_at, f.catches, f.phrase
  from face_down f join acts a on a.id = f.play left join acts s on s.kind = 'spring' and (s.payload ->> 'set') = f.play::text
    left join face_down_reply r on r.play = f.play
  where f.account = auth.uid();

-- ------------------------------------------------------------------------------------------------------- the trap's shape ----

alter table card_kinds drop constraint card_kinds_trap_shape;
alter table card_kinds add constraint card_kinds_trap_shape check (trap is null or coalesce(trap #>> '{trigger,on}' in ('cast', 'visit'), false)) not valid;

-- card_kinds_problem (0108), holding instanceProblems's rules for a trap again: only a Gimmick has one, and it springs on a cast or a visit. The outcome, payout, strike and quadrant
-- rules, and the struck card's rarity, are gone with what they checked. Everything else as 0108 wrote it.
create or replace function card_kinds_problem(cards jsonb) returns text
language sql stable set search_path = public, pg_temp as $$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, e -> 'trap' as trap,
      e #>> '{trap,trigger,on}' as trigger_on, e
    from jsonb_array_elements(coalesce(cards, '[]')) e
  )
  select string_agg(why, '; ' order by key, n) from (
    select c.key, w.n, w.why from c, unnest(array[
      case when c.rarity is null then format('card "%s" has no rarity; a rarity is common, uncommon, rare or legendary', c.key)
           when rarity_rank(c.rarity) is null then format('card "%s" has the rarity "%s"; a rarity is common, uncommon, rare or legendary', c.key, c.rarity) end,
      case when c.play not in ('cast', 'use', 'set', 'keep') then format('card "%s" is played "%s"; a card is cast, used, set or kept', c.key, c.play) end,
      case when c.play = 'keep' then format('card "%s" is kept, and Keep is not built until it is designed', c.key) end,
      case when c.trap is not null and c.play <> 'set' then format('card "%s" has a trap, and only a Gimmick does', c.key) end,
      case when c.e ? 'ward' and jsonb_typeof(c.e -> 'ward') <> 'boolean' then format('card "%s" is a ward of %s; a ward is true or left out', c.key, c.e -> 'ward') end,
      case when coalesce((c.e ->> 'ward') = 'true', false) and c.play <> 'use' then format('card "%s" is a ward, and only a Use card is', c.key) end,
      case when coalesce((c.e ->> 'ward') = 'true', false) and c.play = 'use' and not c.e ? 'lasts' then format('card "%s" is a ward with no time up (lasts); a ward ends at its time', c.key) end,
      case when c.e ? 'lasts' and c.play <> 'use' and not coalesce(jsonb_typeof(c.e -> 'reaches') = 'array' and exists (
             select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r <> 'post'), false)
           then format('card "%s" has a time up (lasts), and only a Use card or a card reaching beyond a post does', c.key) end,
      -- The count is read as a number only once it is one: AND does not promise to read its sides in order.
      case when c.e ? 'lasts' and not coalesce(jsonb_typeof(c.e -> 'lasts') = 'object' and c.e #>> '{lasts,unit}' in ('day', 'week', 'month')
             and case when jsonb_typeof(c.e #> '{lasts,count}') = 'number'
                      then (c.e #>> '{lasts,count}')::numeric between 1 and 1000 and (c.e #>> '{lasts,count}')::numeric = trunc((c.e #>> '{lasts,count}')::numeric)
                      else false end, false)
           then format('card "%s" lasts %s; it must be a span: a unit of day, week or month and a whole count from 1 to 1000', c.key, c.e -> 'lasts') end,
      -- engine/rules/instance.ts, playProblems: a Gimmick springs on a cast or a visit. A Move's trigger is the engine's (a quote), never a card's.
      case when c.trap is not null and coalesce(c.trigger_on not in ('cast', 'visit'), true)
           then format('card "%s" springs on %s; a Gimmick springs on cast or visit', c.key, coalesce(nullif((c.trap #> '{trigger,on}')::text, 'null'), 'nothing')) end
    ]) with ordinality w(why, n)
  ) p where why is not null
$$;

-- ------------------------------------------------------------------------------------------------------- the hand ----

alter table card_ledger drop constraint card_ledger_kind_check;
alter table card_ledger add constraint card_ledger_kind_check check (kind in ('bought', 'played', 'caught'));
-- A played card and a caught card each name their Act (the play, the spring); a bought card names none.
alter table card_ledger drop constraint card_ledger_check;
alter table card_ledger add constraint card_ledger_check check ((kind in ('played', 'caught')) = (act is not null));

-- The cards an account holds of one kind: bought and caught, less played. The one count every reader of a hand uses. The definer functions that spend
-- a card (play_card, set_card) call it for the account they act for, with no session of a player's own (auth.uid() is null), and read the count. A view's
-- function is run as the signed-in caller, not as the view's owner, so my_cards needs the caller to be able to execute this; a signed-in caller therefore
-- meets the same count for their own account and a constant 0 for any other, which says nothing of whose hand is whose.
create function card_held(who uuid, of_card text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'caught')) - count(*) filter (where l.kind = 'played'))::integer
  from card_ledger l where l.account = who and l.card = of_card and (auth.uid() is null or who = auth.uid())
$$;
revoke execute on function card_held(uuid, text) from public, anon;
grant execute on function card_held(uuid, text) to authenticated, service_role;

-- my_cards (0006), counting through card_held. Still security_invoker, still the caller's own rows.
create or replace view my_cards with (security_invoker = true) as
  select l.card, card_held(auth.uid(), l.card) as held
  from (select distinct c.card from card_ledger c where c.account = auth.uid()) l;

-- play_card (0104), counting the hand with card_held. Everything else as 0104 wrote it.
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

-- set_card (0104), counting the hand with card_held. Everything else as 0104 wrote it.
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

-- buy_card (0006), reporting the hand through card_held. Everything else as 0006 wrote it.
create or replace function buy_card(who uuid, card text, price integer) returns jsonb
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
    'held', card_held(who, buy_card.card));
end $$;
