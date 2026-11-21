-- The refund outcome and the refunds field (docs/plans/2026-11-20-refund-outcome-plan.md, Task 2; design docs/plans/2026-11-20-refund-outcome-design.md, section 3), for Kick Me and Pay It Forward.
-- Each object here is copied whole from its latest version, with only the change named.
--
--   1. card_kinds.refunds      a new jsonb column and its constraint card_kinds_refunds_use: refunds are on a use card that reaches a post alone and has a time up. card_kinds_outcome_set (0151) is dropped and added again
--                              taking an outcome of kind ride or refund (a gap in the plan: the catalog refused the refund card's own row).
--   2. card_kinds_problem      copied whole from 0392_ride_every.sql (its latest): an outcome is ride or refund (the kind refusal says both, in the engine's words); a refund outcome takes a kind alone and
--                              a ride's share and its `every` are asked of a ride alone; and the refunds checks of the engine's refundsProblems (engine/rules/instance.ts), each in its words. Its grants are as they were (replaced in place).
--   3. seed_instance           copied whole from 0377_sealed_packs.sql (its latest): `refunds` joins the card insert's columns, values and its on-conflict update, beside `gimmick`.
--   4. acts_spring_payload     dropped and added again from 0392_ride_every.sql's, with ('cast', 'returned') added to the (trigger, did) pairs. Its quadrant lines are 0392's, unchanged: a returned spring names
--                              no quadrant. It only loosens, so every spring already written still passes.
--   5. spring_traps            copied whole from 0357_post_veils.sql (its latest): a cast trap whose outcome is a refund springs `did: returned` (a ride `rode`, any other `caught`), and does not spring on a cast with
--                              no paying account (a staff cast), so a refund back stays set over it. It writes no card_ledger row for a returned spring: place_cast writes the refund's. Its grants are as they were.
--   6. place_set               copied whole from 0392_ride_every.sql (its latest): the refusal "this card names a reaction quadrant" is asked of a ride outcome alone (not of a refund), and still not of a ride that
--                              says `every: true`. Its grants are as they were (replaced in place).
--   7. place_cast              copied whole from 0374_cards_on_a_spun_thread.sql (its latest): a new local `lands` (no spring, or a ride or a refund) replaces each (sprung is null or rode) test; a new local
--                              `handed` names what hands a landed cast on a post back to a non-staff caster, the refund back's own spring or else the post's live refunds Gimmick with a kick left and the cast's flavor;
--                              the cast's payload carries `handedBack` and the caster's ledger gets a `returned` row naming the cast. Its grants are as they were.
--
-- Ways out and masks: nothing new is a state (a refund back is spent when it springs, taken back or timed out as any back; a refunds Gimmick ends at its time or an admin's hand), and nothing reads who owns
-- a character beyond what each function read before. A staff caster is told apart from a player by its public staff flag, and the handing back depends on nothing private: a post's live refunds play, the cast's
-- printed flavor and the casts already handed back by that play are public.

-- ---- 1. card_kinds.refunds ----

alter table card_kinds add column refunds jsonb;
alter table card_kinds add constraint card_kinds_refunds_use check (refunds is null or (play = 'use' and reaches = '{post}' and lasts is not null));

-- card_kinds_outcome_set (0151) holds that an outcome is on a set card that springs on a cast and is of kind ride; it now takes refund too (a gap in the plan, which named the new column's constraint alone:
-- the catalog refused the refund card's own row). It only loosens, so every row already there passes.
alter table card_kinds drop constraint card_kinds_outcome_set;
alter table card_kinds add constraint card_kinds_outcome_set check (trap is null or jsonb_typeof(trap) <> 'object' or not trap ? 'outcome'
  or (play = 'set' and trap #>> '{trigger,on}' = 'cast' and jsonb_typeof(trap -> 'outcome') = 'object' and trap #>> '{outcome,kind}' in ('ride', 'refund')));

-- ---- 2. card_kinds_problem ----

create or replace function public.card_kinds_problem(cards jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, nullif(e -> 'trap', 'null') as trap,
      e #>> '{trap,trigger,on}' as trigger_on, e -> 'gimmick' as gimmick, e,
      case when jsonb_typeof(e -> 'reaches') = 'array' then exists (select 1 from jsonb_array_elements_text(e -> 'reaches') r where r <> 'post') else false end as beyond,
      coalesce(e -> 'reaches' = '["character"]'::jsonb, false) as character_alone,
      coalesce(coalesce(e -> 'reaches', 'null'::jsonb) in ('null'::jsonb, '["post"]'::jsonb), false) as post_alone,
      -- A card has a veil when the key is there and is not a JSON null: seed_instance reads a null through nullif as no veil, and this agrees.
      coalesce(e -> 'veil', 'null'::jsonb) <> 'null'::jsonb as has_veil,
      nullif(e -> 'discipline', 'null') as disc
    from jsonb_array_elements(coalesce(cards, '[]')) e
  ), dc as (
    -- A discipline of a kind the engine knows (the rest is said once, below): its kind, how its card is named in a sentence, and the one reach it takes.
    select c.key, c.e, c.disc, c.play, c.disc ->> 'kind' as kind, case when c.disc ->> 'kind' = 'unban' then 'an unban' else 'a ' || (c.disc ->> 'kind') end as a,
           case when c.disc ->> 'kind' = 'fall' then 'post' else 'character' end as reach_word
    from c where jsonb_typeof(c.disc) = 'object' and c.disc ->> 'kind' in ('relief', 'unban', 'fall', 'watch')
  ), eco as (
    -- The economy and the wallet's cap as the settings hold them now: a drive's gifts and overhead are economy numbers, read when the seed is checked and again at each gift.
    select coalesce((select s.value from settings s where s.key = 'economy' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb) as v,
           (select (s.value #>> '{}')::numeric from settings s where s.key = 'walletCap') as cap
  ), dv as (
    select c.key, c.e, c.e -> 'drive' as d, format('card "%s" has a drive', c.key) as who from c where c.e ? 'drive'
  ), dobj as (
    select dv.*, coalesce(jsonb_typeof(dv.d -> 'lasts') = 'object' and dv.d #>> '{lasts,unit}' in ('hour', 'day', 'week')
             and case when jsonb_typeof(dv.d #> '{lasts,count}') = 'number'
                      then (dv.d #>> '{lasts,count}')::numeric between 1 and 1000 and (dv.d #>> '{lasts,count}')::numeric = trunc((dv.d #>> '{lasts,count}')::numeric)
                      else false end, false) as span_ok
    from dv where jsonb_typeof(dv.d) = 'object'
  ), gifts as (
    select dobj.key, dobj.who, g.v, g.n from dobj, jsonb_array_elements(case when jsonb_typeof(dobj.d -> 'gifts') = 'array' then dobj.d -> 'gifts' else '[]'::jsonb end) with ordinality g(v, n)
  ), draws as (
    select c.key, d.v, d.n from c, jsonb_array_elements(case when jsonb_typeof(c.e -> 'draws') = 'array' then c.e -> 'draws' else '[]'::jsonb end) with ordinality d(v, n)
  )
  select string_agg(why, '; ' order by key, n) from (
    select c.key, w.n, w.why from c, unnest(array[
      case when c.rarity is null then format('card "%s" has no rarity; a rarity is common, uncommon, rare or legendary', c.key)
           when rarity_rank(c.rarity) is null then format('card "%s" has the rarity "%s"; a rarity is common, uncommon, rare or legendary', c.key, c.rarity) end,
      case when c.play not in ('cast', 'use', 'set', 'keep') then format('card "%s" is played "%s"; a card is cast, used, set or kept', c.key, c.play) end,
      case when c.play = 'keep' then format('card "%s" is kept, and Keep is not built until it is designed', c.key) end,
      case when c.trap is not null and c.play <> 'set' then format('card "%s" has a trap, and only a set card has one', c.key) end,
      case when c.play = 'set' and c.trap is null then format('card "%s" is a set card with no trap', c.key) end,
      -- A cast card that reaches a character alone, or a post alone, may carry an earn (engine/rules/instance.ts, playProblems). A post alone is no `reaches` or exactly ["post"].
      case when c.gimmick is not null and c.play <> 'use' and not (c.play = 'cast' and coalesce(c.gimmick ->> 'kind' = 'earn', false) and (c.character_alone or c.post_alone))
           then format('card "%s" has a gimmick, and only a use card has one, or a cast card on a character alone or a post alone an earn', c.key) end,
      -- An earn on a cast card on a post ends at its time; one on a character already needs a time up, as every effect beyond a post does (card_reach_problem).
      case when c.play = 'cast' and c.gimmick ->> 'kind' = 'earn' and c.post_alone and not c.e ? 'lasts'
           then format('card "%s" has an earn with no time up (lasts); an earn on a cast card ends at its time', c.key) end,
      case when c.play = 'use' and c.gimmick is null then format('card "%s" is a use card with no gimmick', c.key) end,
      case when c.play = 'use' and c.gimmick is not null and jsonb_typeof(c.gimmick) <> 'object' then format('card "%s" has a gimmick that is not an object', c.key) end,
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and coalesce(c.gimmick ->> 'kind' not in ('ward', 'earn', 'price', 'ride', 'noQuote', 'cushion'), true)
           then format('card "%s" has a gimmick of kind %s; a gimmick is ward, earn, price, ride, noQuote or cushion', c.key, coalesce(to_jsonb(c.gimmick ->> 'kind')::text, 'null')) end,
      case when c.play = 'use' and not c.e ? 'lasts' then format('card "%s" is a use card with no time up (lasts); a use card ends at its time', c.key) end,
      case when c.play = 'use' and jsonb_typeof(c.e -> 'reaches') = 'array' and exists (
             select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r not in ('post', 'character', 'thread'))
           then format('card "%s" is a use card and reaches %s; a use card reaches a post, a character or a thread', c.key,
             (select string_agg(case when r.v = 'board' then 'a board' else to_jsonb(r.v)::text end, ' and ' order by r.n)
              from jsonb_array_elements_text(c.e -> 'reaches') with ordinality r(v, n) where r.v not in ('post', 'character', 'thread'))) end,
      -- A cast on a post may end (a skim, a veil), so only a set card (or a keep) with a time up and no reach beyond a post is refused: instance.ts, playProblems.
      case when c.e ? 'lasts' and c.play not in ('use', 'cast') and not c.beyond
           then format('card "%s" has a time up (lasts), and only a use card, a cast card or a card reaching beyond a post does', c.key) end,
      -- The count is read as a number only once it is one: AND does not promise to read its sides in order.
      case when c.e ? 'lasts' and not coalesce(jsonb_typeof(c.e -> 'lasts') = 'object' and c.e #>> '{lasts,unit}' in ('hour', 'day', 'week', 'month')
             and case when jsonb_typeof(c.e #> '{lasts,count}') = 'number'
                      then (c.e #>> '{lasts,count}')::numeric between 1 and 1000 and (c.e #>> '{lasts,count}')::numeric = trunc((c.e #>> '{lasts,count}')::numeric)
                      else false end, false)
           then format('card "%s" lasts %s; it must be a span: a unit of hour, day, week or month and a whole count from 1 to 1000', c.key, c.e -> 'lasts') end,
      -- engine/rules/instance.ts, playProblems: a set card springs on a cast or a visit. A Move's trigger is the engine's (a quote), never a card's.
      case when c.trap is not null and coalesce(c.trigger_on not in ('cast', 'visit'), true)
           then format('card "%s" springs on %s; a set card springs on cast or visit', c.key, coalesce(nullif((c.trap #> '{trigger,on}')::text, 'null'), 'nothing')) end,
      -- Part 6 of the card notes (instance.ts: playProblems, outcomeProblems, skimProblems), each in the engine's words.
      -- A ride gimmick: its share, and a card with one reaches a post alone. (gimmickProblems is asked of a use card alone.)
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'ride'
           then card_share_problem(format('card "%s"', c.key), c.gimmick, 'a ride', 'a ride of') end,
      case when c.gimmick ->> 'kind' = 'ride' and c.beyond then format('card "%s" has a ride, and a card with a ride reaches a post alone', c.key) end,
      -- A no-quote stops quotes of the post it is on: a card that has one names a post alone, or names nothing (a post by default).
      case when c.gimmick ->> 'kind' = 'noQuote' and c.e ? 'reaches' and c.e -> 'reaches' is distinct from '["post"]'::jsonb
           then format('card "%s" stops quotes, and a card that stops quotes reaches a post alone', c.key) end,
      -- A trap's outcome: an object, on a set card that springs on a cast, of kind ride (with a share) or refund (a kind alone).
      case when jsonb_typeof(c.trap) = 'object' and c.trap ? 'outcome' and jsonb_typeof(c.trap -> 'outcome') is distinct from 'object'
           then format('card "%s" has an outcome that is not an object', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and (c.play <> 'set' or c.trigger_on is distinct from 'cast')
           then format('card "%s" has an outcome, and only a set card that springs on a cast does', c.key) end,
      -- A ride that pays on every quadrant says `every: true` and may sit beside a match; `every` is true or left out, and is asked of a ride alone (a refund with an `every` is refused below, as a key beside its kind).
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride' and c.trap -> 'outcome' ? 'every'
             and c.trap -> 'outcome' -> 'every' is distinct from 'true'::jsonb
           then format('card "%s" has an outcome whose every is %s; every is true or left out', c.key, (c.trap -> 'outcome' -> 'every')::text) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' is distinct from 'ride' and c.trap #>> '{outcome,kind}' is distinct from 'refund'
           then format('card "%s" has an outcome of kind %s; an outcome is ride or refund', c.key, coalesce((c.trap -> 'outcome' -> 'kind')::text, 'undefined')) end,
      -- A refund outcome takes a kind alone: the first key besides `kind` is named.
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'refund'
             and exists (select 1 from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind')
           then format('card "%s" has a refund outcome with %s; a refund outcome has a kind alone', c.key, (select k from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind' limit 1)) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride'
           then card_share_problem(format('card "%s"', c.key), c.trap -> 'outcome', 'an outcome', 'an outcome of share') end,
      -- A skim: an object with a share, on a cast card that reaches a post alone, lasts and does not write.
      case when c.e ? 'skim' and jsonb_typeof(c.e -> 'skim') is distinct from 'object' then format('card "%s" has a skim that is not an object', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' then card_share_problem(format('card "%s"', c.key), c.e -> 'skim', 'a skim', 'a skim of') end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.play <> 'cast' then format('card "%s" has a skim, and only a cast card does', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.beyond then format('card "%s" has a skim, and a card with a skim reaches a post alone', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and not c.e ? 'lasts' then format('card "%s" has a skim with no time up (lasts); a skim ends at its time', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and coalesce((c.e ->> 'writes')::boolean, false) then format('card "%s" has a skim and writes; a card with a skim does not write', c.key) end,
      -- Refunds (instance.ts, refundsProblems): an object on a use card that reaches a post alone and lasts, whose flavors are one or more distinct alignments and whose count is a whole number from 1 to 10.
      case when c.e ? 'refunds' and jsonb_typeof(c.e -> 'refunds') is distinct from 'object' then format('card "%s" has refunds that are not an object', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and c.play <> 'use' then format('card "%s" has refunds, and only a use card does', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has refunds, and a card with refunds reaches a post alone', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not c.e ? 'lasts' then format('card "%s" has refunds with no time up (lasts)', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not coalesce(jsonb_typeof(c.e -> 'refunds' -> 'flavors') = 'array' and jsonb_array_length(c.e -> 'refunds' -> 'flavors') > 0
             and not exists (select 1 from jsonb_array_elements(c.e -> 'refunds' -> 'flavors') fl where jsonb_typeof(fl) is distinct from 'string' or fl #>> '{}' not in ('sweet', 'salty', 'pepperoni'))
             and (select count(distinct fl) from jsonb_array_elements(c.e -> 'refunds' -> 'flavors') fl) = jsonb_array_length(c.e -> 'refunds' -> 'flavors'), false)
           then format('card "%s" has refunds whose flavors are %s; flavors are one or more of sweet, salty and pepperoni', c.key, coalesce(compact_json(c.e -> 'refunds' -> 'flavors'), 'undefined')) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not coalesce(case when jsonb_typeof(c.e -> 'refunds' -> 'count') = 'number'
                      then (c.e #>> '{refunds,count}')::numeric between 1 and 10 and (c.e #>> '{refunds,count}')::numeric = trunc((c.e #>> '{refunds,count}')::numeric)
                      else false end, false)
           then format('card "%s" has refunds whose count is %s; count is a whole number from 1 to 10', c.key, coalesce(compact_json(c.e -> 'refunds' -> 'count'), 'undefined')) end,
      -- Part 3 of the card notes (instance.ts: veilProblems), each in the engine's words. A veil or a reaction is a cast card on a post alone; a veil is author or totals and ends at its time (lasts); a
      -- reaction neither writes nor is seeded; a card has one of the two. `addsReaction` is the flag the seed sends (the engine's `reaction`), a boolean.
      case when c.has_veil and c.play <> 'cast' then format('card "%s" has a veil, and only a cast card does', c.key) end,
      case when c.has_veil and c.e -> 'reaches' is not null and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has a veil, and a card with a veil reaches a post alone', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and c.play <> 'cast' then format('card "%s" has a reaction, and only a cast card does', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and c.e -> 'reaches' is not null and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has a reaction, and a card with a reaction reaches a post alone', c.key) end,
      case when c.has_veil and coalesce(c.e ->> 'veil' not in ('author', 'totals'), true) then format('card "%s" has a veil of %s; a veil is author or totals', c.key, c.e -> 'veil') end,
      case when c.has_veil and not c.e ? 'lasts' then format('card "%s" has a veil with no time up (lasts); a veil ends at its time', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and coalesce((c.e ->> 'writes')::boolean, false) then format('card "%s" has a reaction and writes; a card with a reaction does not write', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and coalesce((c.e ->> 'seeded')::boolean, false) then format('card "%s" has a reaction and is seeded; a card with a reaction is not', c.key) end,
      case when c.has_veil and c.e -> 'addsReaction' = 'true'::jsonb then format('card "%s" has both a veil and a reaction; a card has one of the two', c.key) end,
      -- Scores as: true or left out, on a cast card that reaches a character alone.
      case when c.e ? 'scoresAs' and c.e -> 'scoresAs' is distinct from 'true'::jsonb then format('card "%s" has scoresAs %s; scoresAs is true or left out', c.key, c.e -> 'scoresAs') end,
      case when c.e -> 'scoresAs' = 'true'::jsonb and c.play <> 'cast' then format('card "%s" scores as a class, and only a cast card does', c.key) end,
      case when c.e -> 'scoresAs' = 'true'::jsonb and not c.character_alone then format('card "%s" scores as a class, and a card that does reaches a character alone', c.key) end
    ]) with ordinality w(why, n)
    -- engine/rules/instance.ts, drawProblems: a draw is a list of distinct keys the server can store on a play.
    union all
    select c.key, 101, format('card "%s" draws %s; draws is a list of keys', c.key, compact_json(c.e -> 'draws')) from c where c.e ? 'draws' and jsonb_typeof(c.e -> 'draws') <> 'array'
    union all
    select c.key, 102, format('card "%s" draws nothing; a card with a draw lists at least one key, or leaves draws out', c.key) from c
    where jsonb_typeof(c.e -> 'draws') = 'array' and jsonb_array_length(c.e -> 'draws') = 0
    union all
    select d.key, 110 + d.n, format('card "%s" draws %s; a draw is lowercase letters, digits and hyphens, 1 to 40', d.key, compact_json(d.v)) from draws d
    where jsonb_typeof(d.v) <> 'string' or d.v #>> '{}' !~ '^[a-z0-9-]{1,40}$'
    union all
    select d.key, 200 + min(d.n), format('card "%s" draws "%s" twice', d.key, d.v #>> '{}') from draws d
    where jsonb_typeof(d.v) = 'string' group by d.key, d.v #>> '{}' having count(*) > 1
    -- engine/rules/instance.ts, driveProblems: a Cast reaching a post alone, a span of at most 30 days, and gifts and an overhead that are economy numbers in range.
    union all
    select dv.key, 300, dv.who || ', and only a cast card does' from dv where coalesce(dv.e ->> 'play', 'cast') <> 'cast'
    union all
    select dv.key, 301, dv.who || ', and a drive card reaches a post alone' from dv where coalesce(dv.e -> 'reaches', '["post"]'::jsonb) is distinct from '["post"]'::jsonb
    union all
    select dv.key, 302, dv.who || ' that is not an object of lasts, gifts and overhead' from dv where jsonb_typeof(dv.d) <> 'object'
    union all
    select o.key, 303, format('%s that lasts %s; it must be a span: a unit of hour, day or week and a whole count from 1 to 1000', o.who, coalesce(compact_json(o.d -> 'lasts'), 'undefined')) from dobj o where not o.span_ok
    union all
    -- A drive's unit is never a month (span_interval counts a calendar month, the engine's spanMs thirty days), so the bound is the same in both.
    select o.key, 303, format('%s that lasts %s, longer than the 30 days a drive may', o.who, span_words(o.d -> 'lasts')) from dobj o where o.span_ok and span_interval(o.d -> 'lasts') > interval '30 days'
    union all
    select o.key, 304, o.who || ' with no gift amounts (gifts); a drive lists the economy keys of at least one' from dobj o
    where jsonb_typeof(o.d -> 'gifts') is distinct from 'array' or jsonb_array_length(o.d -> 'gifts') = 0
    union all
    select g.key, 350 + min(g.n), format('%s that lists gift "%s" twice', min(g.who), g.v #>> '{}') from gifts g
    where jsonb_typeof(g.v) = 'string' group by g.key, g.v #>> '{}' having count(*) > 1
    union all
    select g.key, 400 + g.n, format('%s gift %s, which is not a number the economy holds', g.who, compact_json(g.v)) from gifts g, eco
    where jsonb_typeof(g.v) <> 'string' or jsonb_typeof(eco.v -> (g.v #>> '{}')) is distinct from 'number'
    union all
    select g.key, 400 + g.n, format('%s gift %s of %s; a gift is a positive whole number of hundredths, at most the wallet''s cap (%s)', g.who, compact_json(g.v), eco.v ->> (g.v #>> '{}'), eco.cap)
    from gifts g, eco
    where jsonb_typeof(g.v) = 'string' and jsonb_typeof(eco.v -> (g.v #>> '{}')) = 'number'
      and ((eco.v ->> (g.v #>> '{}'))::numeric <> trunc((eco.v ->> (g.v #>> '{}'))::numeric) or (eco.v ->> (g.v #>> '{}'))::numeric < 1 or (eco.v ->> (g.v #>> '{}'))::numeric > eco.cap)
    union all
    select o.key, 500, format('%s overhead %s, which is not a number the economy holds', o.who, coalesce(compact_json(o.d -> 'overhead'), 'undefined')) from dobj o, eco
    where jsonb_typeof(o.d -> 'overhead') is distinct from 'string' or jsonb_typeof(eco.v -> (o.d ->> 'overhead')) is distinct from 'number'
    union all
    select o.key, 500, format('%s overhead of %s; it is a whole number from 0 to 100', o.who, eco.v ->> (o.d ->> 'overhead')) from dobj o, eco
    where jsonb_typeof(o.d -> 'overhead') = 'string' and jsonb_typeof(eco.v -> (o.d ->> 'overhead')) = 'number'
      and ((eco.v ->> (o.d ->> 'overhead'))::numeric <> trunc((eco.v ->> (o.d ->> 'overhead'))::numeric) or (eco.v ->> (o.d ->> 'overhead'))::numeric < 0 or (eco.v ->> (o.d ->> 'overhead'))::numeric > 100)
    -- engine/rules/instance.ts, needsMessageProblems: the words a blank message is refused with are a sentence, and only a cast or a use carries a message to need.
    union all
    select c.key, 600, format('card "%s" needsMessage %s; it is the sentence a blank message is refused with', c.key, compact_json(c.e -> 'needsMessage')) from c
    where c.e ? 'needsMessage' and jsonb_typeof(c.e -> 'needsMessage') <> 'string'
    union all
    select c.key, 601, format('card "%s" needs a message, and its refusal is empty', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and btrim(c.e ->> 'needsMessage') = ''
    union all
    select c.key, 602, format('card "%s" needsMessage is longer than 200 characters', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and char_length(c.e ->> 'needsMessage') > 200
    union all
    select c.key, 603, format('card "%s" needs a message, and only a cast or a use carries one', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and c.play = 'set'
    -- engine/rules/instance.ts, disciplineProblems (card notes, Part 5): one of four kinds on a cast card with no other effect, reaching the one reach its kind takes.
    -- The seed always carries a stack (1 unless the card says), so a relief's or an unban's stack is said only above 1; every other field is as the engine reads it.
    union all
    select c.key, 700, format('card "%s" has a discipline that is not an object with a kind', c.key) from c where c.disc is not null and jsonb_typeof(c.disc) <> 'object'
    union all
    select c.key, 701, format('card "%s" has the discipline kind %s; a discipline is relief, unban, fall or watch', c.key, coalesce((c.disc -> 'kind')::text, 'undefined')) from c
    where jsonb_typeof(c.disc) = 'object' and coalesce(c.disc ->> 'kind' not in ('relief', 'unban', 'fall', 'watch'), true)
    union all
    select d.key, 702, format('card "%s" has a discipline, and only a cast card does', d.key) from dc d where d.play <> 'cast'
    union all
    select d.key, 710 + f.n, format('card "%s" has %s and %s; a card with a discipline has no other effect', d.key, d.a, f.said)
    from dc d cross join lateral (values
      (1, 'writes', d.e ->> 'writes' = 'true'), (2, 'replies', d.e ->> 'replies' = 'true'), (3, 'keeps', d.e ->> 'keeps' = 'true'),
      (4, 'a skim', nullif(d.e -> 'skim', 'null') is not null), (5, 'scoresAs', d.e -> 'scoresAs' = 'true'::jsonb),
      (6, 'a gimmick', nullif(d.e -> 'gimmick', 'null') is not null), (7, 'draws', nullif(d.e -> 'draws', 'null') is not null),
      (8, 'a drive', nullif(d.e -> 'drive', 'null') is not null), (9, 'needsMessage', nullif(d.e -> 'needsMessage', 'null') is not null),
      (10, 'a surface', d.e ->> 'surface' = 'true')) f(n, said, present)
    where f.present
    union all
    select d.key, 730, format('card "%s" has %s, and %s reaches a %s alone', d.key, d.a, d.a, d.reach_word) from dc d
    where coalesce(d.e -> 'reaches', '["post"]'::jsonb) is distinct from jsonb_build_array(d.reach_word)
    union all
    select d.key, 731, format('card "%s" has a relief of %s; relief takes the lightestBand or all', d.key, coalesce((d.disc -> 'points')::text, 'undefined')) from dc d
    where d.kind = 'relief' and coalesce(d.disc ->> 'points' not in ('lightestBand', 'all'), true)
    union all
    select d.key, 740 + f.n, format('card "%s" has %s and %s; %s is over when it lands and has none', d.key, d.a, f.said, d.a)
    from dc d cross join lateral (values
      (1, 'a time up', nullif(d.e -> 'lasts', 'null') is not null), (2, 'a stack', coalesce((d.e ->> 'stack')::integer > 1, false)), (3, 'pins', d.e ->> 'pins' = 'true')) f(n, said, present)
    where d.kind in ('relief', 'unban') and f.present
    union all
    select d.key, 750, format('card "%s" has a fall, and a fall has a stack of 1', d.key) from dc d where d.kind = 'fall' and coalesce((d.e ->> 'stack')::integer <> 1, false)
    union all
    select d.key, 751, format('card "%s" has a fall and a time up; a fall lasts until a filing spends it', d.key) from dc d where d.kind = 'fall' and nullif(d.e -> 'lasts', 'null') is not null
    union all
    select d.key, 760, format('card "%s" has a watch with no time up (lasts); a watch ends at its time', d.key) from dc d where d.kind = 'watch' and nullif(d.e -> 'lasts', 'null') is null
    union all
    select d.key, 761, format('card "%s" has a watch of weight %s; weight is a number above 1 and at most 10', d.key, coalesce((d.disc -> 'weight')::text, 'none')) from dc d
    where d.kind = 'watch' and not coalesce(jsonb_typeof(d.disc -> 'weight') = 'number' and (d.disc ->> 'weight')::numeric > 1 and (d.disc ->> 'weight')::numeric <= 10, false)
  ) p where why is not null
$function$;

-- ---- 3. seed_instance ----

create or replace function public.seed_instance(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
  was text := current_setting('kayfabb.seeding', true);
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
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
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text) select e ->> 'key', e ->> 'outcome', e ->> 'text' from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
  end if;
  -- The instance's trophy kinds (0206): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The welcome pack's backfill (0377): every account with a character and no welcome pack yet gets one, when `startingPack` names a fixed pack. One insert with a semi-join to characters
  -- (characters_owner) and an anti-join to packs (packs_one_welcome), which writes nothing on a second seed; the unique index makes it once ever, so a seed racing a character's creation
  -- grants once, and an instance that changes `startingPack` later gives no second.
  insert into packs (account, pack, price, contents, source)
  select a.id, k.key, 0, k.contents, 'welcome'
  from pack_kinds k
  join accounts a on exists (select 1 from characters c where c.owner = a.id)
  where k.key = welcome_pack_kind()
    and not exists (select 1 from packs w where w.account = a.id and w.source = 'welcome')
  on conflict (account) where source = 'welcome' do nothing;
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
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
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
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, lasting, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false), coalesce((e ->> 'lasting')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = excluded.lasting, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The conditions that unlock a beat (0332), as the engine lists them (engine/system/conditions.ts). A reseed upserts; a condition is never removed, since a persona's arc may name it.
  insert into condition_kinds (key, plain)
  select e ->> 'key', e ->> 'plain' from jsonb_array_elements(coalesce(payload -> 'system' -> 'conditions', '[]')) e
  on conflict (key) do update set plain = excluded.plain;
  -- A persona's arc (0332): one row each, rewritten by a reseed. An arc naming a condition the catalog lacks is refused, naming it: the check that no beat waits on a condition nothing reads.
  unknown := (select string_agg(distinct c ->> 'kind', ', ')
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p, jsonb_array_elements(coalesce(p -> 'arc', '[]')) b, jsonb_array_elements(coalesce(b -> 'unlock', '[]')) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into persona_arcs (staff, beats, holds_back, phase_days)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  perform seed_setting('bossRoster', r.roster)
  from (select jsonb_agg(e.value ->> 'key' order by e.ord) as roster
        from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
        having count(*) > 0) r;
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
     and setting_thread('systemAnnouncements') is null then
    insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id into opened;
    perform seed_setting('systemAnnouncements', to_jsonb(opened::text));
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      perform seed_setting('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'));
    end if;
    if setting_thread('updatesThread') is null then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      perform seed_setting('updatesThread', to_jsonb(opened::text));
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  -- The anonymous poster (0357): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
  -- rewritten on every seed when the seed names them, the avatar's asset key the instance's to change. What an admin wrote is never written over. A seed with none makes none, and stand_in() is then null (land_refusal
  -- refuses a veil until one exists); seed.ts always sends one, the engine's own when the instance names none.
  if jsonb_typeof(payload -> 'anonymous') = 'object' then
    if payload -> 'anonymous' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'anonymous' -> 'pronouns')) then
      raise exception 'the anonymous poster has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'anonymous' ->> 'name', 'anonymous', 'anonymous', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'anonymous' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'anonymous' -> 'pronouns'), new_pronouns()) from made m;
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'anonymous' -> 'pronouns')
    from characters c
    where payload -> 'anonymous' ? 'pronouns' and c.staff = 'anonymous' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'anonymous' -> 'pronouns');
    if nullif(payload -> 'anonymous' ->> 'avatar', '') is not null then
      perform seed_setting('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'));
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $function$;

-- ---- 4. acts_spring_payload ----

-- acts_spring_payload (0317), a rode spring may name no quadrant.
alter table acts drop constraint acts_spring_payload;
alter table acts add constraint acts_spring_payload check (kind <> 'spring' or (
  jsonb_typeof(payload -> 'card') = 'string'
  and payload ->> 'trigger' in ('cast', 'reaction', 'reply', 'quote', 'visit')
  and coalesce(jsonb_typeof(payload -> 'outcome') = 'object', false) <> (payload ? 'did')
  and (not (payload ? 'did') or (payload ->> 'trigger', payload ->> 'did') in (('quote', 'landed'), ('cast', 'caught'), ('cast', 'rode'), ('cast', 'returned'), ('visit', 'ended')))
  and jsonb_typeof(payload -> 'set') = 'string'
  and coalesce(jsonb_typeof(payload -> 'by'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'caught'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'when'), 'object') = 'object'
  and coalesce((payload -> 'when') - array['says', 'passage'] = '{}'::jsonb, true)
  and coalesce(jsonb_typeof(payload -> 'for'), 'string') = 'string'
  -- A quadrant is only on a rode spring, naming the quadrant its pay is read in; a ride that pays on every quadrant names none.
  and (not (payload ? 'quadrant') or coalesce(payload ->> 'did' = 'rode', false))
  and (not (payload ? 'quadrant') or payload ->> 'quadrant' in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))
  and coalesce(jsonb_typeof(payload -> 'drawn'), 'boolean') = 'boolean'
  and payload - array['card', 'trigger', 'outcome', 'did', 'set', 'by', 'caught', 'when', 'for', 'quadrant', 'drawn'] = '{}'::jsonb) is true);

-- ---- 5. spring_traps ----

-- spring_traps (0357_post_veils), a refund back returns the cast to its caster: `did` is returned, and a cast with no paying account (a staff cast) passes over it. Everything else as 0357 wrote it.

create or replace function spring_traps(trigger text, post uuid, by_act uuid, incoming_card text default null, held uuid[] default null, actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  f spring_facts;
  back_trigger text;
  springs boolean;
  lands boolean;
  did text;
  sprung uuid;
  laid uuid;
  flag text;
  held_when jsonb;
begin
  select x.* into fd from face_down x
  where x.post = spring_traps.post and x.ends_at > now() and (held is null or x.play = any (held))
    and not exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = x.play::text)
  order by x.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  if exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = fd.play::text) then return null; end if;
  -- The same reads for every back, before anything is decided.
  f := spring_facts(fd, trigger, by_act, incoming_card);
  -- The decision, from the locals. A Move springs on a quote that meets every condition its back holds; a Gimmick on its own trigger, or never (a Bluff).
  back_trigger := case f.kind_play when 'cast' then 'quote' else f.kind_trap #>> '{trigger,on}' end;
  springs := back_trigger is not distinct from trigger
    and case trigger when 'quote' then (fd.phrase is null or f.phrase_hit) and (fd.passage is null or f.passage_hit) and (fd.who is null or f.who_hit <> fd.who_except)
                     when 'cast' then f.caught when 'visit' then true else false end;
  -- A Move lands on what quoted it, at its first reach, if it can: its stack there has room, a board has no live card, the thread has its first post and a board card its thread.
  -- A skim card's stack is one live play per quadrant (its quadrant is a quadrant and free); a scored-as card lands only when its class is one, its window can be named and has no other.
  lands := coalesce(f.by_kind = 'post' and case f.reach
      when 'post' then case when f.kind_skim then f.quadrant_ok and f.quadrant_up = 0 else f.up < f.kind_stack end and not f.warded and f.land_why is null
      when 'character' then f.by_character is not null and f.reach_up < f.kind_stack and (not f.kind_scores or (f.class_ok and f.window_why is null and not f.class_taken))
      when 'thread' then f.first_post is not null and f.reach_up < f.kind_stack
      else f.by_board is not null and f.announce_thread is not null and f.live_board is null and f.reach_up < f.kind_stack end, false);
  if not springs then return null; end if;
  -- A staff cast has no hand to hand a card back to, so a refund back passes over it and stays set; the caster's staff flag is public.
  if back_trigger = 'cast' and f.kind_trap #>> '{outcome,kind}' = 'refund' and actor is null then return null; end if;
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its back stays set until its time, and the write that met it lands as if no
  -- back were there (acts_well_formed would refuse the spring, and with it the write). A Move that cannot land leaves its back set for the next quote.
  if f.setter_retired is not null or f.setter_debuted is null then return null; end if;
  if back_trigger = 'quote' and not lands then return null; end if;
  did := case back_trigger when 'quote' then 'landed' when 'cast' then case f.kind_trap #>> '{outcome,kind}' when 'ride' then 'rode' when 'refund' then 'returned' else 'caught' end else 'ended' end;
  -- What the quote met, to be shown: the Says phrase and the passage the back held (the setter chose them to be matched, and the spring says so), and the quoter only where the Who was Only these.
  -- An Anyone but list, and with it who it spared, is never written.
  held_when := case when trigger = 'quote' then jsonb_strip_nulls(jsonb_build_object('says', fd.phrase, 'passage', fd.passage)) end;
  if held_when = '{}'::jsonb then held_when := null; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if f.setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (f.setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'did', did, 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and did = 'caught' then by_act::text end,
    'drawn', case when back_trigger = 'quote' then surface_draft_fits(fd.play) end,
    'quadrant', case when did = 'rode' then fd.config ->> 'quadrant' end,
    'when', held_when,
    -- `for` is the quoter where the Who was Only these: a clue the setter chose, public as the quote's author. A landed author veil hides that author, so its spring never names the quoter (the screens read the quote's
    -- own character, which is the stand-in while the veil is up, and `for` only where the quote could not be read).
    'for', case when trigger = 'quote' and fd.who is not null and not fd.who_except and f.kind_veil is distinct from 'author' then f.by_character::text end))) returning id into sprung;
  if f.setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
  perform write_alert(f.setter_character, 'trapSprang', null, sprung, coalesce(actor, auth.uid()));
  if back_trigger = 'quote' then
    laid := lay_sprung(f.setter_character, fd.card, fd.config, f.target, f.reach, sprung, by_act);
    perform write_alert(f.by_character, 'trapStruck', null, laid, f.setter_owner);
    -- The landed card goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(laid));
  elsif back_trigger = 'cast' and fd.account is not null and did = 'caught' then
    -- The caught card is the setter's: one more row in their own ledger, beside the caster's `played` row. A staff setter has no hand and takes nothing.
    insert into card_ledger (account, card, kind, act, price) values (fd.account, incoming_card, 'caught', sprung, 0);
  end if;
  return act_projection(sprung);
end $$;

revoke execute on function spring_traps(text, uuid, uuid, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- ---- 6. place_set ----

create or replace function public.place_set(setter uuid, card text, target uuid, config jsonb, payer uuid, price integer, catches text DEFAULT NULL::text, phrase text DEFAULT NULL::text, passage text DEFAULT NULL::text, named uuid[] DEFAULT NULL::uuid[], who_except boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  kind_of card_kinds%rowtype;
  caught_kind card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
  staff_setter boolean;
  body text;
  off_board integer;
  nq_name text;
  nq_ends timestamptz;
begin
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if staff_setter is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  if staff_setter is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select * into kind_of from card_kinds k where k.key = place_set.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play is distinct from 'cast' and kind_of.play is distinct from 'set' then
    raise exception '% is %', kind_of.name, case kind_of.play when 'use' then 'used on your own post' else 'kept in the hand' end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A set card with no trap could never spring, and its setter would not know (decideSet's words). It is refused at seed time too; this is for a row that held one before.
  if kind_of.play = 'set' and kind_of.trap is null then
    raise exception '% has no trap to spring', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A Reversal that waits for a cast waits for a named card or for a match; one set with neither could catch nothing, and its setter would not know. Naming and matching are one or the other.
  if catches is null and kind_of.play = 'set' and kind_of.trap #>> '{trigger,on}' = 'cast' and jsonb_typeof(kind_of.trap -> 'match') is distinct from 'object' then
    raise exception '% names no card to catch', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null and jsonb_typeof(kind_of.trap -> 'match') = 'object' then
    raise exception '% names a card or matches cards, never both', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A ride is read in a quadrant, which the setter names when setting it; a ride that pays on every quadrant names none, and a refund is read in none.
  if kind_of.play = 'set' and kind_of.trap #>> '{outcome,kind}' = 'ride'
     and kind_of.trap -> 'outcome' -> 'every' is distinct from 'true'::jsonb
     and not coalesce(coalesce(config, '{}') ->> 'quadrant' = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
    raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A match reaches only cards at or below its own rarity, and so does a name (decideSet's words).
  if jsonb_typeof(kind_of.trap -> 'match') = 'object' and kind_of.trap #>> '{match,upTo}' is not null
     and rarity_rank(kind_of.trap #>> '{match,upTo}') > rarity_rank(kind_of.rarity) then
    raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null then
    if kind_of.play is distinct from 'set' or kind_of.trap #>> '{trigger,on}' is distinct from 'cast' then
      raise exception '% catches no card', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select * into caught_kind from card_kinds k where k.key = place_set.catches;
    if caught_kind.key is null or caught_kind.play is distinct from 'cast' or not ('post' = any (caught_kind.reaches)) then
      raise exception '% names a card that is cast on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if rarity_rank(caught_kind.rarity) > rarity_rank(kind_of.rarity) then
      raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  if phrase is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% waits for no phrase', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if btrim(phrase) = '' then raise exception '% needs a phrase to wait for', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The engine's bound (SET_PHRASE_MOST, engine/rules/cards.ts, which decideSet holds in the same words): phrase_pattern is one length for every back only up to it.
    if char_length(phrase) > 100 then raise exception '% waits for a phrase of at most 100 characters', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- The conditions of a Move (design sections 3 and 4). A Gimmick takes none.
  if passage is not null or named is not null or who_except is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% takes no conditions', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if passage is not null then
    if btrim(passage) = '' or phrase_norm(passage) = '' then raise exception 'the passage needs a letter or a digit' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if char_length(passage) > 100 then raise exception 'the passage is at most 100 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if (named is null) is distinct from (who_except is null) then
    raise exception 'a list of characters comes with Only these or Anyone but these' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if named is not null then
    if cardinality(named) not between 1 and 5 then raise exception 'a list names one to five characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The same message for an id that is missing and one that has not debuted: what is read is the debut alone, as suggest_characters reads `characters`, never the owner.
    select min(i) into off_board from generate_subscripts(named, 1) i
    where named[i] is null or not exists (select 1 from characters c where c.id = named[i] and c.debuted_at is not null);
    if off_board is not null then raise exception '% is not a character on the board', off_board using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if (select count(distinct x) from unnest(named) x) <> cardinality(named) then raise exception 'a character is named once in a list' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if not coalesce(post_kind(target_kind), false) then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from setter then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- The passage must be in the post's current words (its latest edit's body, else its own), read as the probe reads them. The post is public, so the refusal reads nothing private.
  if passage is not null then
    select p.current_payload ->> 'body' into body from acts_public p where p.id = target;
    if not phrase_in(bbcode_plain(coalesce(body, '')), passage) then raise exception 'that passage is not in this post''s words' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- Public, since the back is.
  -- A back is live until it springs, is taken back or its time passes; the three are public.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
             and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  -- A post that holds a live No quote takes no back until it ends (public: the play is a face-up card on the post). The refusal names the card and its end, the same for every setter.
  select n.name, n.ends into nq_name, nq_ends from no_quote_on(target) n order by n.ends desc limit 1;
  if nq_name is not null then
    raise exception 'this post''s % stops quotes until %, so no card is set face down here until then', nq_name, refusal_time(nq_ends) using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (setter, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, phrase, passage, who, who_except)
    values (written, payer, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')), place_set.catches, place_set.phrase,
            place_set.passage, place_set.named, place_set.who_except);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  return act_projection(written);
end $function$;

-- ---- 7. place_cast ----

create or replace function public.place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded text;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  staff_caster boolean;
  drive_id uuid;
  drive_up integer;
  quad text;
  w_why text;
  w_opens timestamptz;
  w_closes timestamptz;
  last_settled timestamptz;
  rode boolean := false;
  is_instant boolean;
  is_relief boolean;
  lightest integer;
  took integer;
  relief_rows jsonb;
  lifts jsonb;
  landing text;
  shown uuid;
  lands boolean := true;
  handed jsonb;
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
  -- A Gimmick never goes on a board, whatever its card lists (the catalog check refuses a card that lists one).
  if kind_of.play = 'use' and reach = 'board' then
    raise exception '% is never used on a board', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A staff character casts no card that carries a gimmick (a cast earn): the settlement leaves a staff character's Acts out, so the play's Lens would claim a boost that is never paid. Plain words, no refusal hint:
  -- a pool persona is never offered one (cards.ts, staffOffers), so this is for a caller that skipped the offer.
  if staff_caster and kind_of.play = 'cast' and kind_of.gimmick is not null then
    raise exception 'a staff character casts no card that carries an earn' using errcode = '22023';
  end if;
  -- Nor a card with a discipline: infract refuses a staff character, and the staff's rulings are The System's own, which these are player moves around. Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.play = 'cast' and kind_of.discipline is not null then
    raise exception 'a staff character casts no card that has a discipline' using errcode = '42501';
  end if;
  -- A relief or an unban is over when it lands (card notes, Part 5): it leaves no effect, takes no place in a stack and has no time up, so it writes no `ends` and no play_reach row.
  is_relief := kind_of.discipline ->> 'kind' = 'relief';
  is_instant := coalesce(kind_of.discipline ->> 'kind' in ('relief', 'unban'), false);

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if not coalesce(post_kind(target_kind), false) then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- Task 4 (section 3), taking the fall: a fall is played on a post whose author is not hidden, on a player's post, and on another character's. Both read public facts of the post's author (a staff flag, a character: who wrote a post is public),
    -- and compare characters, never accounts, so a second mask of the author's account may take the fall and no refusal differs with who owns the caster or the author. The stack count below is as for any card.
    if kind_of.discipline ->> 'kind' = 'fall' then
      -- A post under a live author veil (0357) is shown under the stand-in to everyone, and a fall is all about whose post it is: the refusals below compare the caster with the TRUE author, so the author's own
      -- masks would meet the own-post words while every other caster's fall landed. So while the veil is up a fall is refused first, in one sentence and one code for every caster alike, before anything is
      -- paid or written (no Mod Bot visits a veiled post, so a fall there could not be taken before the veil ends in any case). The time is the veil's own end, public as the veil is.
      if author_veiled(target) then
        raise exception 'this post''s author is hidden until %; nobody takes the fall for it before then', refusal_time(author_veil_ends(target)) using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      if exists (select 1 from characters c where c.id = author and c.staff is not null) then
        raise exception '% is played on a player''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if author is not distinct from caster then
        raise exception '% is played on another character''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- A card that stops quotes is not laid on a post that holds a card face down: a back springs on a quote, and the two would pull against each other. A back is live by the predicate place_set uses (public, since
    -- the back is); the post's row is locked above and place_set takes the same row first, so the two are laid one at a time.
    if kind_of.play = 'use' and kind_of.gimmick ->> 'kind' = 'noQuote'
       and exists (select 1 from face_down f where f.post = target and f.ends_at > now()
                   and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
                   and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
      raise exception '% stops quotes, and this post holds a card face down; take that card back first', kind_of.name using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords).
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      -- What the card's landing refuses on this post (land_refusal): public facts alone, the same words for every caster, and before anything is written.
      landing := land_refusal(kind_of, target, coalesce(config, '{}'));
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = land_refusal_code(landing); end if;
    end if;
    -- A card with a time up ends at it, whatever it holds (a skim, a veil, a use card): the stack below and the end both read the play's `ends`.
    if kind_of.lasts is not null then ends := now() + kind_of.lasts; end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    -- A skim card names the reaction quadrant it skims, one of the four, in its configuration.
    quad := coalesce(config, '{}') ->> 'quadrant';
    if kind_of.skim is not null and not coalesce(quad = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
      raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
    -- A drive card's stack is counted in the post's open drive only: the drive whose latest play, plus the card's `lasts`, is still ahead. A play joins it, or opens a drive of its own id.
    if kind_of.drive is not null then
      select d.drive, count(*) into drive_id, drive_up from drive_plays(target, card) d
      group by d.drive having max(d.created_at) + span_interval(kind_of.drive -> 'lasts') > now()
      order by max(d.created_at) desc limit 1;
      if drive_id is null then
        drive_id := written;
        up := 0;
      else
        up := drive_up;
        if up >= kind_of.stack then raise exception 'this post''s drive already carries % appeals', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      end if;
    end if;
    if kind_of.skim is not null then
      -- A skim card's stack is one live play of it per quadrant on the post (the plays still up, as above), whatever the card's `stack` says.
      select count(*) into up from acts k
      where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
        and coalesce(k.payload ->> 'reach', 'post') = 'post' and k.payload #>> '{config,quadrant}' = quad
        and (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id);
      if up >= 1 then raise exception 'this post already carries that card for that quadrant' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    elsif up >= kind_of.stack then
      if kind_of.surface then raise exception 'This post is already a wall. Draw on it instead.' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      sprung := spring_traps('cast', target, written, card, actor => payer);
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
      -- The cast lands when no back caught it: it met none, or a back that rides or refunds. The order is the Ward first (above), then the back, then the sign; a cast is handed back once at most.
      lands := sprung is null or sprung -> 'payload' ->> 'did' in ('rode', 'returned');
      if lands and payer is not null then
        if sprung -> 'payload' ->> 'did' = 'returned' then
          handed := jsonb_build_object('by', sprung -> 'payload' ->> 'set', 'card', sprung -> 'payload' ->> 'card');
        else
          -- The post's live refunds Gimmick: the latest play on this post whose card has refunds, is still up, names this card's flavor and has handed back fewer casts than its count. The post's row is locked
          -- above, so two casts are counted one after the other.
          select jsonb_build_object('by', k.id, 'card', k.payload ->> 'card') into handed
          from acts k join card_kinds rk on rk.key = k.payload ->> 'card'
          where k.kind = 'card' and k.target_act_id = target and coalesce(k.payload ->> 'reach', 'post') = 'post' and rk.refunds is not null
            and (k.payload ->> 'ends')::timestamptz > now() and not card_ended(k.id)
            and rk.refunds -> 'flavors' ? kind_of.alignment
            and (select count(*) from acts h where h.kind = 'card' and h.target_act_id = target and h.payload #>> '{handedBack,by}' = k.id::text) < (rk.refunds ->> 'count')::integer
          order by k.created_at desc, k.id desc limit 1;
        end if;
      end if;
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      -- The lock order is post, then visits_open, then character, everywhere (a visit's filing takes the post's row first and, in infract, its author's character after): the post the card is played from is held `for share`
      -- before the target character's row, so a card on a character and a filing on that post never hold one each and wait on the other. (Before 0357 the character came first.)
      perform 1 from acts a where a.id = from_post and post_kind(a.kind) for share;
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      -- The stand-in is shown in place of an author, so a card on it would be a card on whoever it stands for.
      if target is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      -- The post it is played from is held `for share` before it is read: a veil cast on that post (which takes the row `for no key update`) checks for a card played from it after taking it, so the card and the veil
      -- are laid one at a time, and whichever is second reads what the first left (a veiled post is not its character's, so the card is refused; a post a card was played from takes no veil). The post's row is
      -- held already (above, before the character's), and a veil cast holds the post's row and takes no character's row, so the order closes no cycle.
      select a.thread, a.character into in_thread, shown from acts_public a where a.id = from_post and post_kind(a.kind);
      -- A post under a live author veil is shown under the stand-in to everyone, so a card on a character played from it is a card on the stand-in whoever the caster names, the post's author included: one refusal, in the
      -- words and the code a third player meets naming the stand-in itself, and the same whoever owns the post. (A post that is not veiled is refused as it was, for a character that is not its own.)
      if shown is not null and shown is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      if in_thread is null or shown is distinct from target then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      -- A card with a discipline lands on a player's character, never a staff character: who is on staff is public, and the words are the same for every caller.
      if kind_of.discipline is not null and exists (select 1 from characters c where c.id = target and c.staff is not null) then
        raise exception '% lands on a player''s character', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      select a.id, a.character into on_post, author from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      -- A Gimmick on a thread is a match stipulation, so only on a thread the caster's own character started. Who started a thread is public, and the refusal says nothing of anyone else's.
      if kind_of.play = 'use' and author is distinct from caster then
        raise exception '% is used on a thread your own character started', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select b.name into target_name from boards_now b where b.id = target;
      in_thread := setting_thread('systemAnnouncements');
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
    -- A scored-as card on a character names a class the instance has and a window that can be named, once for the character in that window. The window is public (settlements, seasons, settings).
    if kind_of.scores_as then
      if not exists (select 1 from class_kinds ck where ck.key = coalesce(config, '{}') ->> 'class') then
        raise exception 'there is no such class' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      select w.opens, w.closes, w.why into w_opens, w_closes, w_why from scored_as_window(now()) w;
      if w_why is not null then raise exception '%', w_why using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      select max(x.ends_at) into last_settled from settlements x;
      if exists (select 1 from play_reach r join acts k on k.id = r.play join card_kinds sk on sk.key = k.payload ->> 'card'
                 where r.character = target and sk.scores_as and k.created_at >= last_settled and not card_ended(k.id)) then
        raise exception 'this character already has a class named for the window after the next settlement' using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
    end if;
    -- A relief or an unban reads the character's public bar or bans with its row held (the lock infract takes, so a filing and a heart on one character go one after the other), and is
    -- refused before anything is spent or written, in the same words for every caller (a bar and a ban are public: warn_points and banned_until are on every postbit).
    if is_relief then
      -- The lightest band is the least of the three band values the settings hold; a bar with fewer points than the card takes gives what it has. The walk is read once, in one statement: the live infractions
      -- (live_infractions, the predicate warn_points sums), oldest first, each giving what is left on it until the card has taken what it says. `took` is the sum of those rows and the rows are what is
      -- written below, so the Act's words and its relief rows cannot disagree (an appeal's ruling takes no lock on the character and may land between two reads).
      lightest := (select min(v::integer) from jsonb_each_text(setting('warnBar') -> 'bands') b(k, v));
      select jsonb_agg(jsonb_build_object('infraction', w.id, 'points', w.pts) order by w.created_at, w.id), coalesce(sum(w.pts), 0)::integer into relief_rows, took
      from (
        select l.id, l.created_at,
               least(l.left_over, greatest(0, least(case when kind_of.discipline ->> 'points' = 'all' then sum(l.left_over) over () else lightest end, sum(l.left_over) over ())
                                                    - (sum(l.left_over) over (order by l.created_at, l.id) - l.left_over))) as pts
        from live_infractions(target) l where l.left_over > 0
      ) w where w.pts > 0;
      if took = 0 then raise exception 'this character''s warn bar is empty' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    elsif is_instant then
      -- Every ban running on the character, by the end each has now: a late filing can lay a second.
      select jsonb_agg(jsonb_build_object('ban', x.id, 'until', x.ends) order by x.created_at, x.id) into lifts
      from (select b.id, b.created_at, ban_ends(b.id) as ends from acts b where b.kind = 'ban' and b.payload ->> 'character' = target::text) x where x.ends > now();
      if lifts is null then raise exception 'this character is not banned' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    if not is_instant then
      select count(*) into up from play_reach r join acts k on k.id = r.play
      where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
        and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
      if up >= kind_of.stack then
        where_words := 'this ' || reach;
        if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
        raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
      ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
      -- A scored-as play lasts until its window closes, not a time from now.
      if kind_of.scores_as then ends := w_closes; end if;
    end if;
  end if;

  -- A card that needs words refuses a blank message in its own words, after the landing's refusals as the engine says them (decided, engine/rules/cards.ts); the message is trimmed as casterMessage trims it.
  if kind_of.needs_message is not null and btrim(said, E' \t\r\n\f\v') = '' then
    raise exception '%', kind_of.needs_message using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', (case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end) - case when kind_of.draws is not null then array['drawn'] else '{}'::text[] end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'targetName', target_name)
                || case when not is_instant then jsonb_build_object('ends', ends)
                        when is_relief then jsonb_build_object('instant', true, 'took', took)
                        else jsonb_build_object('instant', true, 'lifted', lifts) end
              when not lands then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      -- What handed the cast back to its caster's hand (the back's set play or the sign's play, with its card), as a public fact of the cast; the caster's ledger row below is the other half.
      || case when handed is not null then jsonb_build_object('handedBack', handed) else '{}'::jsonb end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      -- A play a back caught never lands and is never in effect, so it holds no end (0370): settle.ts boosts and skims only with a play's `ends`.
      || case when reach = 'post' and kind_of.lasts is not null and lands then jsonb_build_object('ends', ends) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- A cast handed back returns to its caster's hand: a `returned` row naming the cast, as a take-back writes (card_held counts it). Written beside the Act, once, whichever of the back or the sign handed it.
  if handed is not null then
    insert into card_ledger (account, card, kind, act, price) values (payer, card, 'returned', written, 0);
  end if;
  -- What a landed play on a post needs beside its Act (a veil's row): not for a play a back caught, which never lands.
  if reach = 'post' and lands then perform land_rows(written, kind_of, on_post, coalesce(config, '{}'), caster); end if;
  if kind_of.surface and reach = 'post' and lands then perform open_surface(written); end if;
  if reach <> 'post' and not is_instant then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- What a relief took, and what an unban lifted, as rows beside the play (the play's own Act is never changed): the rows the walk above gave, the ones `took` is the sum of; an unban lifts each ban it found.
  if is_relief then
    insert into warn_reliefs (play, infraction, points) select written, (e ->> 'infraction')::uuid, (e ->> 'points')::integer from jsonb_array_elements(relief_rows) e;
  elsif is_instant then
    insert into ban_lifts (play, ban) select written, (e ->> 'ban')::uuid from jsonb_array_elements(lifts) e;
  end if;
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated;

