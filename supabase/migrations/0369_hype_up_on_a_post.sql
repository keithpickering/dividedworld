-- Hype-Up on a post: a cast card that reaches a post alone may carry an earn (docs/plans/2026-11-13-hype-up-on-a-post-design.md; docs/plans/2026-11-13-hype-up-on-a-post-plan.md, Task 2).
-- Until now the only gimmick a card that is not a use card could carry was an earn on a character alone (0316). Hype-Up is a common Sweet Move cast on one post, and it earns by the earn's own rules for as long as it lasts.
--
--   1. card_kinds_gimmick_use  dropped and added again: a cast earn reaches a character alone or a post alone. card_kinds_gimmick_lasts (0148) is unchanged and already requires a time up of any card with a gimmick,
--                              so the catalog refuses a cast earn on a post with no `lasts`.
--   2. card_kinds_problem      copied whole from 0361_discipline_cards.sql: the gimmick rule accepts a post alone beside a character alone, in the engine's new words, and a cast earn on a post alone with no time up
--                              (lasts) is refused in the engine's words (engine/rules/instance.ts, playProblems). Today's playProblems and this function have no time-up rule on a cast card to exempt, so there is none to change.
-- Nothing else changes in SQL. card_kinds_lasts_use (0357) already lets a cast card hold a time up, place_cast (0361) already writes `ends` for any card with `lasts` and counts only the plays still up toward the stack,
-- and lay_sprung (0357) writes `ends` on a sprung card with `lasts` as a cast does, so a second Hype-Up on a post is refused while one is live and lands after its end, a sprung one lands on the quoting post with `ends`,
-- and settlement_input carries the play with its target and `ends` as it does any card on a post (supabase/tests/0369-post-earn-casts.sql).
--
-- Ways out: the card ends at its time (`lasts`), by an admin (reverse_card), and a refused play writes and spends nothing. Masks: the play is a public Act on a post, and what it earns is settled as any earn is, from the
-- settlement's own reads; nothing here reads who owns a character.

alter table card_kinds drop constraint card_kinds_gimmick_use;
alter table card_kinds add constraint card_kinds_gimmick_use check (gimmick is null or play = 'use' or (play = 'cast' and gimmick ->> 'kind' = 'earn' and reaches in ('{character}', '{post}')));

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
      case when c.gimmick is not null and c.play <> 'use' and not (c.play = 'cast' and c.gimmick ->> 'kind' = 'earn' and (c.character_alone or c.post_alone))
           then format('card "%s" has a gimmick, and only a use card has one, or a cast card on a character alone or a post alone an earn', c.key) end,
      -- An earn on a cast card on a post ends at its time; one on a character already needs a time up, as every effect beyond a post does (card_reach_problem).
      case when c.play = 'cast' and c.gimmick ->> 'kind' = 'earn' and c.post_alone and not c.e ? 'lasts'
           then format('card "%s" has an earn with no time up (lasts); an earn on a cast card ends at its time', c.key) end,
      case when c.play = 'use' and c.gimmick is null then format('card "%s" is a use card with no gimmick', c.key) end,
      case when c.play = 'use' and c.gimmick is not null and jsonb_typeof(c.gimmick) <> 'object' then format('card "%s" has a gimmick that is not an object', c.key) end,
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and coalesce(c.gimmick ->> 'kind' not in ('ward', 'earn', 'price', 'ride', 'noQuote'), true)
           then format('card "%s" has a gimmick of kind %s; a gimmick is ward, earn, price, ride or noQuote', c.key, coalesce(to_jsonb(c.gimmick ->> 'kind')::text, 'null')) end,
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
      -- A trap's outcome: an object, on a set card that springs on a cast, beside no match, of kind ride and a share.
      case when jsonb_typeof(c.trap) = 'object' and c.trap ? 'outcome' and jsonb_typeof(c.trap -> 'outcome') is distinct from 'object'
           then format('card "%s" has an outcome that is not an object', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and (c.play <> 'set' or c.trigger_on is distinct from 'cast')
           then format('card "%s" has an outcome, and only a set card that springs on a cast does', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap ? 'match'
           then format('card "%s" has an outcome beside a match; a ride outcome names its card (catches)', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' is distinct from 'ride'
           then format('card "%s" has an outcome of kind %s; an outcome is ride', c.key, coalesce((c.trap -> 'outcome' -> 'kind')::text, 'undefined')) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride'
           then card_share_problem(format('card "%s"', c.key), c.trap -> 'outcome', 'an outcome', 'an outcome of share') end,
      -- A skim: an object with a share, on a cast card that reaches a post alone, lasts and does not write.
      case when c.e ? 'skim' and jsonb_typeof(c.e -> 'skim') is distinct from 'object' then format('card "%s" has a skim that is not an object', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' then card_share_problem(format('card "%s"', c.key), c.e -> 'skim', 'a skim', 'a skim of') end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.play <> 'cast' then format('card "%s" has a skim, and only a cast card does', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.beyond then format('card "%s" has a skim, and a card with a skim reaches a post alone', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and not c.e ? 'lasts' then format('card "%s" has a skim with no time up (lasts); a skim ends at its time', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and coalesce((c.e ->> 'writes')::boolean, false) then format('card "%s" has a skim and writes; a card with a skim does not write', c.key) end,
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
