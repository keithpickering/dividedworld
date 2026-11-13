-- The discipline cards: the catalog, a play that is over at once, relief and the lift (docs/plans/2026-11-11-card-notes-part-5-plan.md, Tasks 2, 3 and 4; the design docs/plans/2026-11-11-card-notes-design.md,
-- "Happy Heart, Super Happy Heart, Ultra Happy Heart", "Take the Fall" and "Tattle-Tale"). Written in sections, one for each task, as 0148_card_types.sql is.
--
-- A card with a `discipline` does something to the staff's discipline of its target, one of a fixed list of four kinds the code maps to an effect with limits (The System acts; it never destroys what a player wrote):
--   relief  on a character: takes its oldest live points off its warn bar, the least band or all of them        unban  on a character: ends every ban running on it
--   fall    on another character's post: the next filing lands on the caster (section 3)                       watch  on a character: weights it up in a patrol's draw while it lasts (migration B)
-- A relief and an unban are over when they land: no time up, no stack, no play_reach row; they leave rows beside their play (warn_reliefs, ban_lifts) and the reads below subtract them. The Act is never changed.
--
-- ===================================================================================================== Section 1 (Task 2) ====
-- The catalog, a play that is over at once, relief and the lift.
--   1. card_kinds                  gains `discipline`; checks: null or an object of one of the four kinds, only where play = 'cast', a time up for a watch alone. card_kinds_beyond_lasts (0055) lets a relief and an
--                                  unban reach a character with no time up. card_kinds_problem and card_reach_problem say the same in the engine's words (instance.ts, disciplineProblems and reachProblems);
--                                  seed_instance writes the column.
--   2. face_down_never_writes      widened (as 0153 and 0343 widened it): a card with a discipline is cast face up and never set face down, in the words the engine's decideSet gives. place_cast refuses a staff caster.
--   3. warn_reliefs, ban_lifts     the rows, append-only, nobody's to read or write (row-level security on, no grant), written only by place_cast.
--   4. card_relief, live_infractions, warn_points, ban_ends, banned_until, my_bans, punishment_running   the reads: a bar counts each infraction less its relief and its cards' relief; a ban ends at the least of its own end (an appeal's
--                                  ruling read in place of it) and the time of the first live lift. An admin's end of the play (card_ended) takes it out of both, computed. infract's ladder count is not changed:
--                                  a lifted ban still counts toward the next.
--   5. card_target_reach           the character branch also carries the character's bar and ban, public facts the engine's disciplineRefusal reads (warnPoints, bannedUntil).
--   6. place_cast                  a staff target is refused; a relief on an empty bar and an unban on a character not banned are refused before anything is written (play_card spends after, in the same transaction, so a
--                                  refused card is not spent); a relief or an unban writes no `ends`, no play_reach row and takes no stack place; its payload says `instant` and what it took or lifted; the rows follow the Act.
--                                  The ward test still runs.
-- reverse_card is unchanged: an instant play has no `ends` and no play_reach row, so an admin may end it at any time.
--
-- Ways out: a refused heart writes and spends nothing. Points a heart took off and a ban an Unban ended need none to leave: an admin's end of the play (reverse_card) puts them back, computed. A card with a discipline
-- is never set face down (nothing to take back).
-- Privacy: a refusal reads the target's public bar and bans (both are on every postbit) and its public staff flag, so it is the same words, price and timing whoever owns the caster or the target; the relief rows name
-- public Acts and are read by nobody.
-- Cost at a busy instance's scale: warn_points (through live_infractions, which it inlines) gains one probe of warn_reliefs (by infraction) for each live infraction, and a character's bar holds a handful of them; banned_until gains one probe of ban_lifts for each ban
-- of the character. A heart reads the character's infractions through acts_infractions and writes at most as many rows as it has live infractions; an unban writes one row for each running ban.

-- -------------------------------------------------------------------------------------------------------- the catalog ----

alter table card_kinds add column discipline jsonb;
alter table card_kinds add constraint card_kinds_discipline check (
  discipline is null or (
    jsonb_typeof(discipline) = 'object' and coalesce(discipline ->> 'kind' in ('relief', 'unban', 'fall', 'watch'), false) and play = 'cast'
    and ((discipline ->> 'kind' = 'watch') = (lasts is not null))));
-- A card beyond a post needs a time up, except a relief or an unban, which are over when they land. The null is made false: a check passes on null.
alter table card_kinds drop constraint card_kinds_beyond_lasts;
alter table card_kinds add constraint card_kinds_beyond_lasts check (reaches = '{post}' or lasts is not null or coalesce(discipline ->> 'kind' in ('relief', 'unban'), false));

-- card_kinds_problem (0316's), with the discipline rules in the engine's words, each naming the card; everything else as 0316 wrote it.
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
      -- A cast card that reaches a character alone may carry an earn (engine/rules/instance.ts, playProblems).
      case when c.gimmick is not null and c.play <> 'use' and not (c.play = 'cast' and c.gimmick ->> 'kind' = 'earn' and c.character_alone)
           then format('card "%s" has a gimmick, and only a use card has one, or a cast card on a character an earn', c.key) end,
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
      -- A skim card's time up is its own (Part 6 of the card notes): it lasts though it reaches a post alone.
      case when c.e ? 'lasts' and c.play <> 'use' and not c.beyond and not c.e ? 'skim'
           then format('card "%s" has a time up (lasts), and only a Use card or a card reaching beyond a post does', c.key) end,
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

-- card_reach_problem (0348's), a relief or an unban reaching a character with no time up; everything else as 0348 wrote it.
create or replace function public.card_reach_problem(cards jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, e -> 'reaches' as reaches, e -> 'lasts' as lasts, e -> 'pins' as pins, e #>> '{discipline,kind}' as dkind
    from jsonb_array_elements(coalesce(cards, '[]')) e where e ? 'reaches'
  ), shaped as (
    select c.*, jsonb_typeof(c.reaches) = 'array' and jsonb_array_length(c.reaches) between 1 and 4
      and not exists (select 1 from jsonb_array_elements(c.reaches) r where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('post', 'character', 'thread', 'board'))
      and (select count(distinct r) from jsonb_array_elements(c.reaches) r) = jsonb_array_length(c.reaches) as ok
    from c
  ), beyond as (
    select s.key, r.reach, r.n from shaped s, unnest(array['character', 'thread', 'board']) with ordinality r(reach, n)
    where s.ok and s.reaches ? r.reach
  )
  select string_agg(why, '; ' order by key, n) from (
    select s.key, 0 as n, format('card "%s" reaches %s; a card reaches a list of post, character, thread or board, each once', s.key, compact_json(s.reaches)) as why
    from shaped s where not s.ok
    union all
    select s.key, 1, format('card "%s" is set face down, and a Set lands only on a post', s.key)
    from shaped s where s.ok and s.play = 'set' and exists (select 1 from beyond b where b.key = s.key)
    union all
    select s.key, 3, format('card "%s" pins %s; only a card that reaches a thread pins, and pins is true or left out', s.key, compact_json(s.pins))
    from shaped s where s.ok and s.pins is not null and s.pins <> 'false'::jsonb and (s.pins <> 'true'::jsonb or not s.reaches ? 'thread')
    union all
    -- A relief or an unban has no time up: it is over when it lands, and leaves no effect beyond a post to end (card notes, Part 5).
    select s.key, 2, format('card "%s" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time', s.key)
    from shaped s where s.ok and s.lasts is null and coalesce(s.dkind not in ('relief', 'unban'), true) and exists (select 1 from beyond b where b.key = s.key)
    union all
    select b.key, 10 + 2 * b.n, format('card "%s" reaches a %s, which takes a card of %s or rarer; it is %s', b.key, b.reach, floor.rarity, s.rarity)
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachRarity') ->> b.reach as rarity) floor
    where rarity_rank(s.rarity) < rarity_rank(floor.rarity)
    union all
    select b.key, 11 + 2 * b.n, format('card "%s" lasts %s, longer than a %s effect may (reachLasts.%s, %s)', b.key, span_words(s.lasts), b.reach, b.reach, span_words(bound.span))
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachLasts') -> b.reach as span) bound
    -- A time up that is no span is card_kinds_problem's to name; it is read as an interval only once it is one.
    where s.lasts is not null and case when span_holds(s.lasts) and span_holds(bound.span) then span_interval(s.lasts) > span_interval(bound.span) else false end
  ) p where why is not null
$function$;

-- seed_instance (0348's), with the column written from the payload beside `gimmick`; everything else as 0348 wrote it.
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
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, surface = excluded.surface;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
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
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $function$;

-- face_down_never_writes (0343's), also refusing a back for a card with a discipline, in the sentence the engine's decideSet says for it; everything else as 0343 wrote it.
create or replace function public.face_down_never_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare k card_kinds;
begin
  select * into k from card_kinds c where c.key = new.card;
  if k.writes then
    raise exception '% writes, so it is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.discipline is not null then
    raise exception '% acts the moment it lands, so it is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.draws is not null or k.drive is not null or k.needs_message is not null or k.surface then
    raise exception '% is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------------------------------------- the rows ----

-- What a relief took off each infraction, and which ban an unban lifted: one row for each (play, infraction) and (play, ban). Append-only, as card_texts is; nobody's to read or write.
create table warn_reliefs (
  play uuid not null references acts (id),
  infraction uuid not null references acts (id),
  points integer not null check (points >= 1),
  primary key (play, infraction)
);
create index warn_reliefs_by_infraction on warn_reliefs (infraction);
create table ban_lifts (
  play uuid not null references acts (id),
  ban uuid not null references acts (id),
  primary key (play, ban)
);
create index ban_lifts_by_ban on ban_lifts (ban);

create function discipline_rows_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a relief or a lift is never edited; an admin''s end of the play undoes it' using errcode = '55000';
end $$;
create trigger warn_reliefs_no_update before update or delete on warn_reliefs for each row execute function discipline_rows_append_only();
create trigger warn_reliefs_no_truncate before truncate on warn_reliefs for each statement execute function discipline_rows_append_only();
create trigger ban_lifts_no_update before update or delete on ban_lifts for each row execute function discipline_rows_append_only();
create trigger ban_lifts_no_truncate before truncate on ban_lifts for each statement execute function discipline_rows_append_only();
-- The truncate guards fire on a restore too, as card_texts' does.
alter table warn_reliefs enable always trigger warn_reliefs_no_truncate;
alter table ban_lifts enable always trigger ban_lifts_no_truncate;
revoke execute on function discipline_rows_append_only() from public, anon, authenticated;
alter table warn_reliefs enable row level security;
alter table ban_lifts enable row level security;
revoke all on warn_reliefs, ban_lifts from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------- the reads ----

-- What the cards took off an infraction's points: the sum of its warn_reliefs rows whose play an admin has not ended. warn_points subtracts it beside infraction_relief (0109); the infraction Act is never touched.
-- Executable by signed-in players, as infraction_relief is (0111): a function a view calls is executed with the privileges of whoever reads the view.
create function card_relief(infraction uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(w.points), 0)::integer from warn_reliefs w where w.infraction = card_relief.infraction and not card_ended(w.play)
$$;
revoke execute on function card_relief(uuid) from public, anon;
grant execute on function card_relief(uuid) to authenticated, service_role;

-- The infractions a character's bar counts now, each with what is left of it after an appeal (infraction_relief) and after the cards' relief (card_relief), never below zero: not expired, and landed after the character's last
-- ban. warn_points sums it and a heart's walk in place_cast takes from it, oldest first, so the two read one predicate and cannot drift apart. A plain SQL function with no `set` clause, so a caller inlines it and
-- warn_points' plan is the one it had (acts_infractions by the character, then acts_bans for its last ban); it is the owner's alone to call (revoked below), and it runs with its caller's privileges and search_path.
create function live_infractions(who uuid) returns table (id uuid, created_at timestamptz, points integer, left_over integer)
language sql stable as $$
  select i.id, i.created_at, (i.payload ->> 'points')::integer,
         greatest(0, (i.payload ->> 'points')::integer - public.infraction_relief(i.id) - public.card_relief(i.id))
  from public.acts i
  where i.kind = 'infraction' and i.payload ->> 'character' = who::text
    and (i.payload ->> 'expires_at')::timestamptz > now()
    and i.created_at > coalesce((select max(b.created_at) from public.acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text), '-infinity'::timestamptz)
$$;
revoke execute on function live_infractions(uuid) from public, anon, authenticated, service_role;

-- warn_points (0104), the sum of what is left of each live infraction (live_infractions); everything else as 0104 wrote it.
create or replace function warn_points(who uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.left_over), 0)::integer from live_infractions(who) l
$$;

-- When a ban ends: its own end, an appeal's ruling on it read in place of that (the newest ruling that names an end; overturned: it ended when the ruling landed, reduced or increased: the end the ruling names),
-- and no later than the time of the first lift of it whose play an admin has not ended. `least` ignores a null, so a ban with no lift ends when it said. This is banned_until's read of one ban (0109), my_bans' `until` (0157)
-- and punishment_running's, so the three agree.
create function ban_ends(ban uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select least(e.ends, l.lifted_at)
  from acts b
  cross join lateral (
    select coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                     where a.kind = 'appeal' and a.target_act_id = b.id and r.payload ? 'until' order by r.created_at desc, r.id desc limit 1),
                    (b.payload ->> 'until')::timestamptz) as ends
  ) e
  cross join lateral (
    select min(k.created_at) as lifted_at from ban_lifts x join acts k on k.id = x.play where x.ban = b.id and not card_ended(k.id)
  ) l
  where b.id = ban_ends.ban and b.kind = 'ban'
$$;
revoke execute on function ban_ends(uuid) from public, anon;
grant execute on function ban_ends(uuid) to authenticated, service_role;

-- banned_until (0109), reading each ban's end through ban_ends; everything else as 0109 wrote it.
create or replace function banned_until(who uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select max(e.ends)
  from acts b
  cross join lateral (select ban_ends(b.id) as ends) e
  where b.kind = 'ban' and b.payload ->> 'character' = who::text and e.ends > now()
$$;

-- my_bans (0157), its `until` read through ban_ends; its columns are as 0157 wrote them.
create or replace view my_bans as
  select b.id as ban, c.id as character, b.created_at as at, (b.payload ->> 'days')::integer as days,
         ban_ends(b.id) as until,
         (b.payload ->> 'infraction_act')::uuid as infraction, punishment_words((b.payload ->> 'infraction_act')::uuid) as rule, b.thread,
         (select r.payload ->> 'verdict' from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
          where a.kind = 'appeal' and a.target_act_id = b.id order by r.created_at desc, r.id desc limit 1) as ruling,
         (b.payload ->> 'until')::timestamptz as own_until
  from characters c
  join acts b on b.kind = 'ban' and b.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- punishment_running (0135), a ban running while ban_ends is still ahead; everything else as 0135 wrote it.
create or replace function punishment_running(punishment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case p.kind
      when 'infraction' then (p.payload ->> 'expires_at')::timestamptz > now()
        and p.created_at > coalesce((select max(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = p.payload ->> 'character'), '-infinity'::timestamptz)
      when 'move' then exists (select 1 from open_moves o where o.move_act = p.id) and coalesce(move_expires_at(p.id) > now(), true)
      else ban_ends(p.id) > now()
    end
    from acts p where p.id = punishment_running.punishment and p.kind in ('infraction', 'ban', 'move')), false)
$$;

-- card_target_reach (0055's), a character target also answering its bar and its ban: warn_points and banned_until are public (on every postbit), and the engine's disciplineRefusal reads them before a
-- relief or an unban is sent; place_cast decides again. Everything else as 0055 wrote it.
create or replace function public.card_target_reach(reach text, target uuid, from_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  got jsonb;
  t_thread uuid;
  t_board uuid;
  t_character uuid;
begin
  if reach = 'post' then
    got := card_target(target);
    if got is null then return null; end if;
    select a.character, a.thread, th.board into t_character, t_thread, t_board from acts a join threads th on th.id = a.thread where a.id = target;
    return got || jsonb_build_object('above', jsonb_strip_nulls(jsonb_build_object(
      'character', case when t_character is not null then reach_effects('character', t_character) end,
      'thread', reach_effects('thread', t_thread), 'board', reach_effects('board', t_board))));
  elsif reach = 'character' then
    if not exists (select 1 from characters c where c.id = target) then return null; end if;
    select a.thread, th.board into t_thread, t_board from acts_public a join threads th on th.id = a.thread
    where a.id = from_post and a.kind = 'post' and a.character = target;
    return jsonb_build_object('reach', 'character', 'character', target, 'effects', reach_effects('character', target),
      'warnPoints', warn_points(target), 'bannedUntil', banned_until(target),
      'above', jsonb_strip_nulls(jsonb_build_object('thread', case when t_thread is not null then reach_effects('thread', t_thread) end,
                                                    'board', case when t_board is not null then reach_effects('board', t_board) end)));
  elsif reach = 'thread' then
    select th.board into t_board from threads th where th.id = target;
    if t_board is null then return null; end if;
    return jsonb_build_object('reach', 'thread', 'thread', target, 'effects', reach_effects('thread', target),
      'above', jsonb_build_object('board', reach_effects('board', t_board)));
  elsif reach = 'board' then
    if not exists (select 1 from boards b where b.id = target) then return null; end if;
    return jsonb_build_object('reach', 'board', 'board', target, 'effects', reach_effects('board', target), 'above', '{}'::jsonb);
  end if;
  return null;
end $function$;

-- ------------------------------------------------------------------------------------------------------- place_cast ----

-- place_cast (0317's), with the discipline cards: see the header, sections 1 and 3 (the fall's refusals, marked Task 4). A staff caster is refused in plain words (no refusal hint, 42501) as a staff caster of an earn is; a staff target, an empty bar and a character
-- not banned are refused with the refusal hint; a relief or an unban skips the stack, `ends` and the play_reach row. The ward test is unchanged and runs first. Everything else as 0317 wrote it.
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
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- Task 4 (section 3), taking the fall: a fall is played on a player's post, and on another character's. Both read public facts of the post's author (a staff flag, a character: who wrote a post is public),
    -- and compare characters, never accounts, so a second mask of the author's account may take the fall and no refusal differs with who owns the caster or the author. The stack count below is as for any card.
    if kind_of.discipline ->> 'kind' = 'fall' then
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
    end if;
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
              when sprung is not null and not rode then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      || case when reach = 'post' and (kind_of.play = 'use' or kind_of.skim is not null) and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  if kind_of.surface and reach = 'post' and (sprung is null or rode) then perform open_surface(written); end if;
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

-- ===================================================================================================== Section 2 (Task 3) ====
-- The reads for the log: what the cards did to an infraction and to a ban, in the caller's own rows.
--   my_infractions   gains, as its last columns, card_relief (the points the cards took off it: card_relief(i.id), 0 where none) and fall_play (the play that took the fall, read from the infraction's payload key
--                    `fall_play`; null where no card did, and until section 3 writes one).
--   my_bans          gains lifted_at and lifted_card: when the first lift of it whose play an admin has not ended landed, and the key of that card; null where no card acted (the same play ban_ends reads).
--   log_page         carries the four and (section 3) `falls`, whole from 0340 (its inf and bn reads list their columns, so the new ones are named); nothing else in it changes.
-- Both views stay the caller's own characters' (c.owner = auth.uid()): the rows add nothing about anyone else, and the card's key and time are on its public play. The grants stay as they were.
-- Ways out: reads only, nothing to leave. Cost: the lift lateral in my_bans runs once for each ban the caller owns, before the sort and the limit (a player's bans are few), each one probe of ban_lifts by ban; card_relief's
-- one probe of warn_reliefs runs once for each infraction the caller owns, likewise (a bar holds a handful, and a player's infractions across seasons are few).

-- my_infractions (0111), whole from its latest definition with card_relief and fall_play last.
create or replace view my_infractions as
  select i.id as infraction, c.id as character, i.created_at as at, i.payload ->> 'band' as band, (i.payload ->> 'points')::integer as points,
         (i.payload ->> 'rule_number')::integer as rule_number, punishment_words(i.id) as rule,
         (select m.name from characters m where m.staff = i.payload ->> 'staff') as mod_name,
         (i.payload ->> 'about_act')::uuid as post, (select p.seq from acts p where p.id = (i.payload ->> 'about_act')::uuid) as post_seq, i.thread,
         (i.payload ->> 'expires_at')::timestamptz as expires_at, infraction_relief(i.id) as relief,
         (select min(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = c.id::text and b.created_at > i.created_at) as emptied_at,
         card_relief(i.id) as card_relief,
         (i.payload ->> 'fall_play')::uuid as fall_play
  from characters c
  join acts i on i.kind = 'infraction' and i.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- my_bans (section 1's), with lifted_at and lifted_card last: the first live lift of the ban, ordered as ban_ends reads it (an admin's end of the lifting play takes it out).
create or replace view my_bans as
  select b.id as ban, c.id as character, b.created_at as at, (b.payload ->> 'days')::integer as days,
         ban_ends(b.id) as until,
         (b.payload ->> 'infraction_act')::uuid as infraction, punishment_words((b.payload ->> 'infraction_act')::uuid) as rule, b.thread,
         (select r.payload ->> 'verdict' from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
          where a.kind = 'appeal' and a.target_act_id = b.id order by r.created_at desc, r.id desc limit 1) as ruling,
         (b.payload ->> 'until')::timestamptz as own_until,
         l.lifted_at, l.lifted_card
  from characters c
  join acts b on b.kind = 'ban' and b.payload ->> 'character' = c.id::text
  left join lateral (
    select k.created_at as lifted_at, k.payload ->> 'card' as lifted_card from ban_lifts x join acts k on k.id = x.play
    where x.ban = b.id and not card_ended(k.id) order by k.created_at, k.id limit 1
  ) l on true
  where c.owner = auth.uid();

-- Task 4 (section 3): my_falls_taken, the author's log row for a fall taken for one of its posts: an infraction that names a `fall_play` and is about a post by one of the caller's characters. `character` is the
-- author, and the character the infraction landed on is named only by its public name (the play is a public Act). A caller's own caster's infraction is in my_infractions and not here. Nothing here is computed from an
-- owner but the caller's own: `c.owner = auth.uid()` is the author's. Cost: led by acts_fall_spent (the infractions that took a fall, which is one for each filing that met a fall), each with a primary-key probe of its post and its
-- author; a page of the log reads at most 200 of them, newest first.
create view my_falls_taken as
  select i.id as infraction, c.id as character, i.created_at as at, p.id as post, p.seq as post_seq, i.thread, punishment_words(i.id) as rule,
         (i.payload ->> 'points')::integer as points, (select m.name from characters m where m.staff = i.payload ->> 'staff') as mod_name,
         (select k.name from characters k where k.id = (i.payload ->> 'character')::uuid) as taker_name
  from acts i
  join acts p on p.id = (i.payload ->> 'about_act')::uuid
  join characters c on c.id = p.character and c.owner = auth.uid()
  where i.kind = 'infraction' and i.payload ? 'fall_play';
revoke all on my_falls_taken from public, anon, authenticated;
grant select on my_falls_taken to authenticated;

-- log_page (0340), whole, with the four columns named in its inf and bn reads.
create or replace function log_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive
  mine as (
    select m.id, m.class_since from my_characters m
  ), lg as materialized (
    select l.settlement, l.starts_at, l.ends_at, l.character, l.reason, l.amount, l.shares_kept, l.params
    from my_ledger l where in_before is null or l.ends_at <= in_before
    order by l.ends_at desc, l.settlement, l.character, l.reason limit 200
  ), wl as materialized (
    select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
    from my_wallet_events e where in_before is null or e.at <= in_before
    order by e.at desc, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after limit 200
  ), cd as materialized (
    select c.card, c.kind, c.act, c.price, c.at, c.springs, c.pack, c.repriced
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price, c.pack limit 200
  ), pk as materialized (
    select p.id, p.pack, p.price, p.repriced, p.contents, p.bought_at
    from my_packs p where in_before is null or p.bought_at <= in_before
    order by p.bought_at desc, p.id limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), wr as materialized (
    select w.play, w.post, w.version, w.failed, w.opening, w.over, w.at
    from my_posts_written_on w where in_before is null or w.at <= in_before
    order by w.at desc, w.play, w.version limit 200
  ), dr as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_draws r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), wd as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_walls_drawn_on r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at, f.ended_by
    from my_face_down f where f.ended_at is not null and (in_before is null or f.ended_at <= in_before)
    order by f.ended_at desc, f.play limit 200
  ), sp as materialized (
    select f.play, f.card, f.post, f.ends_at, f.passed_at
    from my_face_down f where f.passed_at is not null and f.spring is null and (in_before is null or f.passed_at <= in_before)
    order by f.passed_at desc, f.play limit 200
  ), ca as materialized (
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.at
    from my_caught c where in_before is null or c.at <= in_before
    order by c.at desc, c.play limit 200
  ), en as materialized (
    select e.card_end, e.play, e.card, e.at, e.side, e.reach, e.target_name, e.post_author_name, e.caster_name, e.character
    from my_cards_ended e where in_before is null or e.at <= in_before
    order by e.at desc, e.card_end limit 200
  ), inf as materialized (
    select i.infraction, i.character, i.at, i.band, i.points, i.rule_number, i.rule, i.mod_name, i.post, i.post_seq, i.thread, i.expires_at, i.relief, i.emptied_at, i.card_relief, i.fall_play
    from my_infractions i where in_before is null or i.at <= in_before
    order by i.at desc, i.infraction limit 200
  ), bn as materialized (
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread, b.ruling, b.own_until, b.lifted_at, b.lifted_card
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), fl as materialized (
    select f.infraction, f.character, f.at, f.post, f.post_seq, f.thread, f.rule, f.points, f.mod_name, f.taker_name
    from my_falls_taken f where in_before is null or f.at <= in_before
    order by f.at desc, f.infraction limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until, g.ruled_office
    from my_group_moves g where in_before is null or g.at <= in_before
    order by g.at desc, g.move limit 200
  ), rp as materialized (
    select r.report, r.character, r.at, r.post, r.post_seq, r.thread, r.verdict, r.verdict_at, r.mod_name, r.refund
    from my_reports r where in_before is null or r.at <= in_before
    order by r.at desc, r.report limit 200
  ), ap as materialized (
    select a.appeal, a.character, a.at, a.punishment, a.punishment_kind, a.post_seq, a.thread, a.verdict, a.ruled_at, a.points_delta, a.hearer_name, a.refund
    from my_appeals a where in_before is null or a.at <= in_before
    order by a.at desc, a.appeal limit 200
  ), cs as materialized (
    select c.kind, c.id, c.at, c.character, c.outcome, c.item, c.text, c.copies, c.trophy, c.name, c.by, c.by_name, c.season, c.place, c.line, c.to_name
    from cosmetic_log_rows(in_before, 200) c
    order by c.at desc, c.kind, c.id
  ), sh as materialized (
    select s.settlement, s.character, s.reason, s.act, s.quadrant, s.amount, s.card
    from my_ledger_shares s where s.settlement in (select x.settlement from lg x)
  ), sa as materialized (
    select s.settlement, s.character, s.named_class, s.play, s.card, s.starts_at, s.ends_at
    from my_scored_as s where in_before is null or s.ends_at <= in_before
    order by s.ends_at desc, s.settlement, s.character limit 200
  ), tn as materialized (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character in (select m.id from mine m)
  ), named(id) as (
    -- actsNamed (engine/ui/log/lines.ts) over every row read; the Turns are the latest one of each character, the one announced as its class began.
    select x.act from sh x where x.act is not null
    union select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at))
    union select x.act from cd x where x.act is not null
    union select x.play from po x union select x.post from po x where x.post is not null
    union select x.play from wr x union select x.post from wr x
    union select x.play from dr x union select x.post from dr x
    union select x.play from wd x union select x.post from wd x
    union select x.play from sv x union select x.post from sv x where x.post is not null
    union select x.post from se x where x.post is not null union select x.spring from se x where x.spring is not null
    union select x.post from sp x where x.post is not null
    union select x.play from ca x union select x.post from ca x where x.post is not null
    union select x.play from en x
    union select x.ref from wl x where x.kind in ('bribe', 'gift_out', 'gift_in') and x.ref is not null
  ), walk(id, depth) as (
    -- actsFollowed, twice: what the Acts read lead to. A loop costs the two rounds as a chain does.
    select n.id, 0 from named n
    union
    select f.id, w.depth + 1
    from walk w
    join acts_public a on a.id = w.id
    cross join lateral (values
      (case when a.kind in ('card', 'spring', 'set', 'donation') then a.target_act_id end),
      (case when a.kind = 'intercept' and a.payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'visit_act')::uuid end),
      (case when a.kind in ('spring', 'card') and a.payload ->> 'spring' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'spring')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'caught' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'caught')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'by')::uuid end)
    ) f(id)
    where w.depth < 2 and f.id is not null
  ), ac as materialized (
    select a.* from acts_public a where a.id in (select w.id from walk w)
  ), reach as materialized (
    -- A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so its target is named here.
    select a.payload ->> 'reach' as kind,
           case when a.payload ->> (a.payload ->> 'reach') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> (a.payload ->> 'reach'))::uuid end as target
    from ac a
    where a.kind = 'card' and jsonb_typeof(a.payload -> 'targetName') is distinct from 'string' and a.payload ->> 'reach' in ('character', 'thread', 'board')
  ), pe(id) as (
    select a.character from ac a where a.character is not null and a.character not in (select m.id from mine m)
    union select x.character from dr x where x.character not in (select m.id from mine m)
    union select x.character from wd x where x.character not in (select m.id from mine m)
    union select r.target from reach r where r.kind = 'character' and r.target is not null and r.target not in (select m.id from mine m)
  ), th(id) as (
    select a.thread from ac a where a.id in (select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at)))
    union select r.target from reach r where r.kind = 'thread' and r.target is not null
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character, x.reason) from lg x), '[]'::jsonb),
      'wallet', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) from wl x), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price, x.pack) from cd x), '[]'::jsonb),
      'packs', coalesce((select jsonb_agg(to_jsonb(x) order by x.bought_at desc, x.id) from pk x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'writes', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play, x.version) from wr x), '[]'::jsonb),
      'draws', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from dr x), '[]'::jsonb),
      'wallsDrawn', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from wd x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
      'falls', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from fl x), '[]'::jsonb),
      'groupMoves', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.move) from gm x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.report) from rp x), '[]'::jsonb),
      'appeals', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.appeal) from ap x), '[]'::jsonb),
      'cosmetics', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.kind, x.id) from cs x), '[]'::jsonb)),
    'shares', coalesce((select jsonb_agg(to_jsonb(x) order by x.settlement desc, x.character, x.reason, x.card, x.act, x.quadrant) from sh x), '[]'::jsonb),
    'scoredAs', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character) from sa x), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id::text collate "C") from thread_open t where t.id in (select h.id from th h)), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(to_jsonb(b) order by b.id::text collate "C") from (
      select n.id, n.slug, n.name, n.description, n.is_system, n.move_act from boards_now n
      where n.id in (select r.target from reach r where r.kind = 'board' and r.target is not null)) b), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) order by s.character::text collate "C") from (
      select c.character, c.standing from current_standings c where c.character in (select m.id from mine m)) s), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'season', (select to_jsonb(s) from current_season s limit 1)
  );
end;

-- ===================================================================================================== Section 3 (Task 4) ====
-- Taking the fall: a card of kind `fall`, cast on another character's post, waits there; the first filing of a visit to the post lands its infraction on the character that cast it.
--   1. acts_infraction_payload   allows a `fall_play` key (a uuid); acts_fall_spent finds the infractions that name a play, for file_visit's "no infraction names it" and the page's `spent`.
--   2. infract, acts_warn_guard  an infraction may be about a post that is not `who`'s when it names `who`'s own fall play on that post. The lock on `who`, the points, the ban and its ladder are `who`'s.
--   3. file_visit                after the end, the oldest live unspent fall on the post (not caught, not ended by an admin) gives its caster the filing; with none, or one infract would refuse, as before. It takes the post's row
--                                first, as place_cast does, so a cast racing a filing either takes it or stays unspent, never both. Lock order, everywhere: the post's row, the visit's open row, the character infract locks.
--   4. close_appeal              an `increased` verdict names the punished infraction's fall_play, so the increase lands on the same character. open_appeal already reads the infraction's own character:
--                                only the caster may appeal it, and the author is told it is no punishment of theirs.
--   5. place_cast                (section 1, marked Task 4) a fall on a staff character's post and a fall on one's own character's post are refused, in plain words, before anything is spent.
--   6. card_target               names the post's `author`. thread_page names `spent`. my_falls_taken and log_page's `falls` tell the author's player (section 2, marked Task 4).
-- Ways out: a fall waits on a post until a filing spends it or an admin ends it (reverse_card); it holds nobody: the author and the caster post as before. The caster's points and ban are any infraction's:
-- they drop off by themselves, the ban ends by itself, the caster may appeal, an admin may end it.
-- Privacy: nothing here reads who owns a character. The filing reads the post's plays (public Acts) and a staff flag (public); the refusals compare characters; the page's `spent` and card_target's `author` are public
-- projections; my_falls_taken is the author's own and names the caster by its public name.
-- Cost: file_visit gains one read of the post's plays (acts_layers, 0072) and, for a fall play found, one probe of acts_fall_spent; thread_page one probe of the visit's infractions for each fall play on the page.

-- acts_infraction_payload (0104's), with a `fall_play` key. A relaxation, so the rows already there pass it: added not valid, then validated (a lock that does not stop writes).
alter table acts drop constraint acts_infraction_payload;
alter table acts add constraint acts_infraction_payload check (kind <> 'infraction' or (
  payload - 'character' - 'band' - 'points' - 'rule_number' - 'board' - 'about_act' - 'visit_act' - 'staff' - 'expires_at' - 'fall_play' = '{}'::jsonb
  and jsonb_typeof(payload -> 'character') = 'string' and payload ->> 'character' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and payload ->> 'band' in ('minor', 'moderate', 'severe')
  and jsonb_typeof(payload -> 'points') = 'number' and payload ->> 'points' ~ '^[1-9][0-9]{0,8}$'
  and (jsonb_typeof(payload -> 'rule_number') = 'null' or (jsonb_typeof(payload -> 'rule_number') = 'number' and payload ->> 'rule_number' ~ '^[0-9]{1,9}$'))
  and jsonb_typeof(payload -> 'board') = 'string' and payload ->> 'board' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(payload -> 'about_act') = 'string' and payload ->> 'about_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (jsonb_typeof(payload -> 'visit_act') = 'null' or (jsonb_typeof(payload -> 'visit_act') = 'string' and payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and jsonb_typeof(payload -> 'staff') = 'string' and payload ->> 'staff' <> ''
  and jsonb_typeof(payload -> 'expires_at') = 'string'
  and (not payload ? 'fall_play' or (jsonb_typeof(payload -> 'fall_play') = 'string' and payload ->> 'fall_play' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) is true) not valid;
alter table acts validate constraint acts_infraction_payload;
create index acts_fall_spent on acts ((payload ->> 'fall_play')) where kind = 'infraction' and payload ? 'fall_play';

-- infract (0109's), with a last argument `fall_play`: with it the post need not be `who`'s, and the infraction names the play. A new signature, so the old is dropped; its callers (file_visit, close_appeal) are
-- written again below. Everything else (the lock on `who`, the points, the ban and its ladder, which are `who`'s) as 0109 wrote it. A banned `who` is warned all the same, with or without a fall: infract has
-- never refused a banned character.
drop function public.infract(uuid, text, uuid, text, integer, uuid);
create function public.infract(who uuid, band text, about_act uuid, staff text, rule_number integer DEFAULT NULL::integer, visit_act uuid DEFAULT NULL::uuid, fall_play uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bar jsonb;
  pts integer;
  in_thread uuid;
  on_board uuid;
  at timestamptz;
  inf uuid;
  total integer;
  made uuid;
  season_no integer;
  prior integer;
  steps jsonb;
  days integer;
  ends timestamptz;
  ban_at timestamptz;
begin
  if band is null or band not in ('minor', 'moderate', 'severe') then raise exception 'there is no band "%"; a breach is minor, moderate or severe', coalesce(band, '') using errcode = '22023'; end if;
  if staff is null or staff = '' then raise exception 'an infraction names the Mod that filed it' using errcode = '22023'; end if;
  perform 1 from characters c where c.id = who and c.staff is null for no key update;
  if not found then raise exception 'there is no player character to warn' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if fall_play is null then
    select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = about_act and a.kind in ('post', 'spin') and a.character = who;
    if in_thread is null then raise exception 'an infraction is for a post this character wrote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  else
    -- A fall (card notes, Part 5): the post is another's, and the play is this character's own card Act of a fall kind on that very post, on the post's reach. Only who and where are held to the play: whether
    -- an admin has ended it since, or a filing spent it, is for the caller to decide (file_visit takes a live one; an appeal's `increased` names the one the first infraction named).
    select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread
    where a.id = about_act and a.kind in ('post', 'spin')
      and exists (select 1 from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
                  where k.id = fall_play and k.kind = 'card' and k.character = who and k.target_act_id = a.id and coalesce(k.payload ->> 'reach', 'post') = 'post' and ck.discipline ->> 'kind' = 'fall');
    if in_thread is null then raise exception 'a fall is the play of a fall card by this character, on the post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if visit_act is not null and not exists (select 1 from acts v where v.id = visit_act) then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The time and the bar are taken with the row held: a filing that waited for another's ban lands after it, and sees its bar.
  at := clock_timestamp();
  bar := setting('warnBar');
  pts := (bar -> 'bands' ->> band)::integer;
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', in_thread,
    jsonb_build_object('character', who, 'band', band, 'points', pts, 'rule_number', rule_number, 'board', on_board, 'about_act', about_act, 'visit_act', visit_act,
                       'staff', staff, 'expires_at', at + span_interval(bar -> 'decay'))
      || case when fall_play is not null then jsonb_build_object('fall_play', fall_play) else '{}'::jsonb end, at)
  returning id into inf;
  total := warn_points(who);
  if total >= (bar ->> 'size')::integer then
    -- This season's bans of this character, this one counting: a new season has none, so the ladder starts again. A ban an appeal overturned is not counted.
    -- With no season open (between one and the next) it is the latest season's; 0 only where no season was ever made.
    season_no := coalesce((select max(s.number) from seasons s), 0);
    select count(*) into prior from acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text and (b.payload ->> 'season')::integer = season_no
      and not exists (select 1 from acts ap join acts r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                      where ap.kind = 'appeal' and ap.target_act_id = b.id and r.payload ->> 'verdict' = 'overturned');
    steps := bar -> 'banDays';
    days := (steps ->> least(prior, jsonb_array_length(steps) - 1))::integer;
    ban_at := greatest(clock_timestamp(), at + interval '1 microsecond');
    ends := ban_at + make_interval(days => days);
    insert into acts (character, kind, thread, payload, created_at)
    values (null, 'ban', in_thread, jsonb_build_object('character', who, 'days', days, 'until', ends, 'infraction_act', inf, 'season', season_no), ban_at)
    returning id into made;
    total := 0;
  end if;
  perform set_config('kayfabb.warn_writer', '', true);
  return jsonb_build_object('infraction', inf, 'points', pts, 'warn_points', total, 'ban', made, 'until', ends);
end $function$;
revoke execute on function public.infract(uuid, text, uuid, text, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.infract(uuid, text, uuid, text, integer, uuid, uuid) to service_role;

-- acts_warn_guard (0104's), an infraction about a post of its character's or naming a `fall_play` that is that character's own play on the post; everything else as 0104 wrote it.
CREATE OR REPLACE FUNCTION public.acts_warn_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(current_setting('kayfabb.warn_writer', true), '') <> 'on' then
    raise exception 'an infraction or a ban is written only through infract' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not exists (select 1 from characters c where c.id = (new.payload ->> 'character')::uuid and c.staff is null) then
    raise exception 'an infraction or a ban is against a player''s character' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'infraction' then
    perform (new.payload ->> 'expires_at')::timestamptz;
    -- A post of the character's, or one whose fall the character took: the play it names is its own card Act of a fall kind on that post (the same test infract makes).
    if not exists (select 1 from acts p where p.id = (new.payload ->> 'about_act')::uuid and p.kind in ('post', 'spin') and p.thread = new.thread
                   and (p.character = (new.payload ->> 'character')::uuid
                        or (new.payload ? 'fall_play' and exists (select 1 from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
                                                                    where k.id = (new.payload ->> 'fall_play')::uuid and k.kind = 'card' and k.character = (new.payload ->> 'character')::uuid
                                                                      and k.target_act_id = p.id and coalesce(k.payload ->> 'reach', 'post') = 'post' and ck.discipline ->> 'kind' = 'fall')))) then
      raise exception 'an infraction is about a post of that character''s, or one whose fall it took, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'visit_act') = 'string' and not exists (select 1 from acts v where v.id = (new.payload ->> 'visit_act')::uuid) then
      raise exception 'an infraction names a visit that is an Act' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    perform (new.payload ->> 'until')::timestamptz;
    if not exists (select 1 from acts i where i.id = (new.payload ->> 'infraction_act')::uuid and i.kind = 'infraction'
                   and i.payload ->> 'character' = new.payload ->> 'character' and i.thread = new.thread) then
      raise exception 'a ban follows an infraction of the same character, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $function$;

-- file_visit (0105's), after the end, giving a live fall's caster the infraction (Task 4); everything else as 0105 wrote it, and the lock order said inside.
CREATE OR REPLACE FUNCTION public.file_visit(visit_act uuid, line text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v acts%rowtype;
  charges jsonb;
  top jsonb;
  who uuid;
  mod_key text;
  said text;
  ended jsonb;
  hit jsonb;
  author uuid;
  fall uuid;
  taker uuid;
begin
  select * into v from acts a where a.id = file_visit.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The lock order, here and in every writer a fall meets: the post's row (place_cast takes it to lay a play on the post, so a fall cast and a filing are laid one after the other, and the one that goes second
  -- sees the first), then the visit's open row (the row end_visit takes: the end and the infraction are one decision, and the one that waits finds the visit ended), then the row of the character the
  -- infraction lands on (infract). A play on a character takes that character's row alone, and nothing here waits on a row it already holds in another order. `for no key update` is place_cast's own mode, so the two
  -- conflict; it does not conflict with a key share (a foreign key) or a read, and a writer that takes the post's row for share (a visit's start) waits for this one to finish and is waited for in turn, never both
  -- holding one and wanting the other, as long as it takes the post's row before the open row, as this does.
  perform 1 from acts p where p.id = v.target_act_id for no key update;
  perform 1 from visits_open o where o.visit_act = v.id for update;
  charges := visit_charges(v.id);
  top := (select c from jsonb_array_elements(charges) with ordinality e(c, n)
          order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc, n limit 1);
  mod_key := (select c.staff from characters c where c.id = v.character);
  said := coalesce(nullif(btrim(coalesce(line, '')), ''), visit_line('visitFiled', mod_key, charges));
  ended := end_visit(v.id, 'filed', null, said);
  if not (ended ->> 'ended')::boolean then
    return jsonb_build_object('filed', false, 'end_act', ended -> 'end_act', 'outcome', ended ->> 'outcome');
  end if;
  author := (select a.character from acts a where a.id = v.target_act_id);
  who := author;
  -- Task 4 (section 3), taking the fall: the oldest live play of a fall card on the post's own reach that no infraction names, not caught (a caught play holds no place) and not ended by an admin; its caster takes
  -- the filing in the author's place. The play is a public Act, so nothing here reads an owner. A caster infract would refuse where it would not refuse the author (a staff character now: infract warns a player
  -- character alone; a character that is gone cannot be, an Act's character being a foreign key) takes no fall: the filing lands on the author as if there were none, and the play stays unspent. A caster who is
  -- banned now takes it, as infract warns a banned character today. The post's row is held (above), so nothing spends this play or lays another between this read and the infraction.
  select k.id, k.character into fall, taker
  from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.discipline ->> 'kind' = 'fall'
  where k.kind = 'card' and k.target_act_id = v.target_act_id and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught') and not card_ended(k.id)
    and not exists (select 1 from acts i where i.kind = 'infraction' and i.payload ? 'fall_play' and i.payload ->> 'fall_play' = k.id::text)
  order by k.created_at, k.id limit 1;
  if fall is not null and taker is distinct from author and exists (select 1 from characters c where c.id = taker and c.staff is null) then
    who := taker;
  else
    fall := null;
  end if;
  hit := infract(who, top ->> 'band', v.target_act_id, mod_key, nullif(top ->> 'rule_number', '')::integer, v.id, fall);
  return jsonb_build_object('filed', true, 'end_act', ended -> 'end_act') || hit;
end $function$;

-- close_appeal (0135's), its `increased` verdict naming the punished infraction's fall_play to infract; everything else as 0135 wrote it.
CREATE OR REPLACE FUNCTION public.close_appeal(appeal_act uuid, verdict text, line text DEFAULT NULL::text, staff text DEFAULT NULL::text, most_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ap acts%rowtype;
  pun acts%rowtype;
  ruling acts%rowtype;
  mod_key text;
  who uuid;
  appellant text;
  said text := left(btrim(coalesce(close_appeal.line, '')), 280);
  v text := close_appeal.verdict;
  pts integer;
  delta integer := 0;
  payload jsonb;
  hit jsonb;
  new_until timestamptz;
  days integer;
  paid record;
  amount integer := 0;
  written uuid;
  key text;
  own_end timestamptz;
  length interval;
  most_all numeric;
  most numeric;
  ended boolean := false;
begin
  select * into ap from acts a where a.id = close_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The appeal's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  select * into ruling from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id;
  if found then
    -- The ruling's own numbers, so a retry after a lost answer reports the true outcome.
    return jsonb_build_object('closed', false, 'existing', true, 'ruling_act', ruling.id, 'verdict', ruling.payload ->> 'verdict', 'line', ruling.payload ->> 'line',
      'points_delta', (ruling.payload ->> 'points_delta')::integer,
      'refunded_amount', coalesce((select f.amount from appeal_refunds f where f.appeal_act = ap.id and f.why = 'overturned'), 0))
      || case when ruling.payload ? 'until' then jsonb_build_object('until', ruling.payload ->> 'until') else '{}'::jsonb end;
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if v is null or v not in ('overturned', 'upheld', 'reduced', 'increased') then
    raise exception 'an appeal is answered with overturned, upheld, reduced or increased, not %', coalesce(v, 'nothing') using errcode = '22023';
  end if;
  select * into pun from acts a where a.id = ap.target_act_id;
  -- A move ends under its own lock (end_move's): the ruling, the tick and an apology's end are then one after another, and a move one of them ended is seen as ended here.
  if pun.kind = 'move' then perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(pun.id::text)); end if;
  -- The punishment ran out while the appeal waited: nothing is left to rule on, and an increase must not revive it. No ruling; the price comes back (the appeal stays used).
  if not punishment_running(pun.id) then
    perform refund_appeal(ap.id, 'expired');
    return jsonb_build_object('closed', false, 'refunded', true, 'expired', true, 'reason', 'that punishment had already run out before the appeal was heard, so nothing was ruled and your Aura is back');
  end if;
  mod_key := appeal_hearer(pun.id);
  if mod_key is null then raise exception 'no one is on staff to hear an appeal' using errcode = '55000'; end if;
  if close_appeal.staff is not null and close_appeal.staff <> mod_key then
    raise exception 'this appeal is heard by someone else now' using errcode = '55000';
  end if;
  who := ap.character;
  appellant := (select c.name from characters c where c.id = who);

  if pun.kind = 'move' then
    own_end := (pun.payload ->> 'expires_at')::timestamptz;
    -- A move that ends only by an apology or an admin has no length to halve or add to: the model's other verdicts are written as upheld, in the stock line.
    if own_end is null and v in ('reduced', 'increased') then v := 'upheld'; said := ''; end if;
  end if;
  payload := jsonb_build_object('appeal_act', ap.id, 'verdict', v);

  if pun.kind = 'infraction' then
    pts := (pun.payload ->> 'points')::integer;
    if v = 'overturned' then delta := -pts;
    elsif v = 'reduced' then delta := -least(pts, greatest(1, (pts + 1) / 2));
    elsif v = 'increased' then
      -- One more infraction of the same band for the same post: at most one band's points, and a full bar bans. A fall's infraction names its play again, so the increase lands on the same character, the one who appealed (Task 4).
      hit := infract(who, pun.payload ->> 'band', (pun.payload ->> 'about_act')::uuid, mod_key, nullif(pun.payload ->> 'rule_number', '')::integer, nullif(pun.payload ->> 'visit_act', '')::uuid, nullif(pun.payload ->> 'fall_play', '')::uuid);
      delta := (hit ->> 'points')::integer;
      payload := payload || jsonb_build_object('infraction_act', hit ->> 'infraction');
    end if;
  elsif pun.kind = 'move' then
    -- Its length is from its landing to its own end. A reduction ends it at landing plus half the length (the end may be behind us); an increase adds half the length, but
    -- never past the phase's most days from landing (the smaller of the phase's number and the instance's own).
    length := own_end - pun.created_at;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + length / 2;
    elsif v = 'increased' then
      -- The instance's setting is the outer limit (setting() raises where it is missing); the phase's number, where the call has one, can only lower it.
      most_all := (setting('moveExpiryMostDays') #>> '{}')::numeric;
      most := greatest(1, least(coalesce(close_appeal.most_days, most_all), most_all));
      new_until := own_end + least(length / 2, greatest(interval '0', most * interval '1 day' - length));
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  else
    -- A ban: its length is its days; a reduction counts half of them from the ban's start, an increase runs half of them past its end.
    days := (pun.payload ->> 'days')::integer;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + days * interval '12 hours';
    elsif v = 'increased' then new_until := (pun.payload ->> 'until')::timestamptz + days * interval '12 hours';
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  end if;

  key := 'appeal' || initcap(v);
  said := coalesce(nullif(said, ''), appeal_line(key, mod_key, appellant));
  payload := payload || jsonb_build_object('points_delta', delta, 'line', said);
  written := (write_staff_act(mod_key, 'appeal_ruling', ap.thread, ap.id, payload) ->> 'id')::uuid;

  -- A move's effect: overturned ends it at once; a reduction that has already run its course ends it now. Each is end_move's, so a move something else just ended is not ended twice.
  if pun.kind = 'move' then
    if v = 'overturned' then
      ended := (end_move(pun.id, 'overturned', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'overturned'); end if;
    elsif v = 'reduced' and new_until <= now() then
      ended := (end_move(pun.id, 'expired', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'expired'); end if;
    end if;
  end if;

  -- An overturned appeal gets its price back.
  if v = 'overturned' then
    select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
    amount := coalesce(paid.price, 0);
    insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, 'overturned');
    if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  end if;
  return jsonb_build_object('closed', true, 'ruling_act', written, 'verdict', v, 'staff', mod_key, 'line', said, 'points_delta', delta, 'refunded_amount', amount)
    || case when new_until is not null then jsonb_build_object('until', new_until) else '{}'::jsonb end
    || case when ended then jsonb_build_object('ended', true) else '{}'::jsonb end
    || case when hit is not null then jsonb_build_object('infraction', hit ->> 'infraction', 'ban', hit -> 'ban') else '{}'::jsonb end;
end $function$;

-- card_target (0348's), also naming the post's author: who wrote a post is a public fact of the Act, and the engine compares it with the caster (a character, never an account) before it sends a fall. Everything else as 0348 wrote it.
CREATE OR REPLACE FUNCTION public.card_target(target uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind, 'author', a.character,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'gimmick', ck.gimmick, 'ends', k.payload ->> 'ends', 'drive', dp.drive,
          'covered', case when ck.surface then (select bit_count(sf.cover) from surfaces sf where sf.play = k.id) end, 'closes', to_jsonb(dp.closes),
          'quadrant', case when ck.skim is not null then k.payload #>> '{config,quadrant}' end)) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        -- One grouped read of the post's drive plays: each play's drive, and that drive's close (its latest play plus the card's `lasts`).
        left join (select d.id, d.drive, max(d.created_at) over (partition by d.card, d.drive) + span_interval(dk.drive -> 'lasts') as closes
                   from drive_plays(a.id) d join card_kinds dk on dk.key = d.card) dp on dp.id = k.id
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and not card_ended(k.id) and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, tb.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        left join acts tb on tb.kind = 'take_back' and (tb.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
    -- Where the target is a reply a play in force draws under its parent (post_under): the parent, and no key for any other post.
    || coalesce((select jsonb_build_object('under', u.parent) from post_under u where u.reply = a.id and not card_ended(u.play)), '{}'::jsonb)
  from acts_public a where a.id = target
$function$;

-- thread_page (0349's, whole), carrying `spent`: the page's fall plays a filing took. Everything else as 0349 wrote it.
create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  -- The range's numbers, read through acts_public once: the page's Acts and the numbers drawn elsewhere both come from this one pass (a screen function may read no relation below the
  -- public projections, tools/check-web-reads.mjs).
  range_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  -- A range number whose Act is the reply of a post_under row in force: drawn under its parent, not at its number. A lateral probe of the unique index on `reply`, one for each
  -- number of the range and so no more than 100: the planner cannot turn it into a hash over the whole table. `not card_ended` is the one in-force rule, here and in `nested`.
  drawn as materialized (
    select r.id, r.seq, r.kind, u.play, u.parent
    from range_acts r cross join lateral (select x.play, x.parent from post_under x where x.reply = r.id) u
    where not card_ended(u.play)
  ),
  page_acts as materialized (
    select r.* from range_acts r
    where not exists (select 1 from drawn d where d.id = r.id)
  ),
  page_posts as materialized (select a.id, a.character, a.created_at from page_acts a where a.kind = 'post'),
  -- The replies drawn under the page's posts (post_under_parent), each read through acts_public as the page's own Acts are, so the conduct layer's concealment holds for a nested
  -- reply as for any post. A reply takes none under it, so one level, and at most one under each post (stack 1). `act` is the Act as `acts` holds one.
  nested as materialized (
    select u.play, p.id as parent, a.id, a.character, a.created_at, to_jsonb(a) as act
    from page_posts p
    cross join lateral (select x.play, x.reply from post_under x where x.parent = p.id and not card_ended(x.play)) u
    join acts_public a on a.id = u.reply
  ),
  -- What the plays, visits, tallies, people and spun threads are read for: the page's posts and the replies drawn under them.
  posts as materialized (
    select p.id, p.character, p.created_at from page_posts p
    union all
    select n.id, n.character, n.created_at from nested n
  ),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- The plays of a kind that keeps, at thread reach on this thread, that wore off by time (not one an admin ended), whose window (the play's date to its end) holds the date of one of
  -- the page's posts: they still count on those posts, so the page carries them beside `above`, in its shape. The range of play_reach_thread (ended, and ended after the
  -- page's earliest post), the Act by primary key through acts_public (dated no later than the page's latest post, then the window), and only for what survives that the kind (`keeps`). At most 100, oldest first.
  kept_span as materialized (select min(p.created_at) as lo, max(p.created_at) as hi from posts p),
  -- The reach-specific part, and the one place a later reach adds to: a character reach's rows (play_reach_character) join here with a `union all` of a second select of this shape;
  -- everything below reads whatever rows it gives.
  kept_reach as materialized (
    select x.play, x.reach, coalesce(x.character, x.thread, x.board) as target, x.ends_at
    from play_reach x, kept_span s
    where x.thread = (select rng.id from rng) and x.ends_at <= now() and x.ends_at > s.lo
  ),
  kept_window as materialized (
    select r.play, r.reach, r.target, r.ends_at, a.created_at as started, to_jsonb(a) as act, a.payload ->> 'card' as card
    from kept_reach r join acts_public a on a.id = r.play, kept_span s
    where a.created_at <= s.hi
      and exists (select 1 from posts p where a.created_at <= p.created_at and p.created_at < r.ends_at)
  ),
  kept as materialized (
    select w.play, w.reach, w.target, w.ends_at, w.act
    from kept_window w
    join card_kinds ck on ck.key = w.card and ck.keeps
    where not card_ended(w.play)
    order by w.started, w.play limit 100
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from kept x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin') union all select n.id from nested n)
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select n.id from nested n union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select n.character from nested n union select p.character from played p union select v.character from vis v) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p.character)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'kept', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from kept x),
    -- The replies drawn under the page's posts, and the numbers of this page's range whose Act is drawn under a post elsewhere. Public projections: the same for every caller.
    'under', (select coalesce(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) order by (n.act ->> 'seq')::integer, n.id), '[]'::jsonb) from nested n),
    'cut', (select coalesce(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', (select pa.seq from acts_public pa where pa.id = d.parent)) order by d.seq), '[]'::jsonb) from drawn d where d.kind = 'post'),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object(
        'visit', v.id, 'post', v.post, 'mod', v.character, 'at', v.created_at, 'ends_at', v.payload -> 'ends_at', 'line', v.payload -> 'line',
        'charges', (v.payload -> 'charges') || coalesce((select jsonb_agg(j.payload -> 'charge' order by j.created_at, j.id) from acts_public j where j.kind = 'visit_join' and j.target_act_id = v.id), '[]'::jsonb),
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}'))
          || coalesce(visit_quiz(v.id), '{}'::jsonb),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1),
        -- Read through acts_public as the rest of the page is (e2e/0016 holds a screen to the public projections).
        'ruling', (select r.payload ->> 'verdict' from acts_public i
                   join acts_public ap on ap.kind = 'appeal' and ap.target_act_id = i.id
                   join acts_public r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                   where i.kind = 'infraction' and i.payload ->> 'visit_act' = v.id::text limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    -- The plays of a fall card among the page's plays on posts that a filing has spent: the ones an infraction names as its `fall_play` (card notes, Part 5). A public projection, read through acts_public as the
    -- visits above are: the same for every caller. The probe is made for a fall play alone (card_kinds says which), from the post's visits (acts_visits_by_post) to their infractions.
    'spent', (select coalesce(jsonb_agg(o.id order by o.created_at, o.id), '[]'::jsonb)
              from on_posts o join card_kinds ck on ck.key = o.payload ->> 'card' and ck.discipline ->> 'kind' = 'fall'
              where o.kind = 'card' and exists (select 1 from acts_public v join acts_public i on i.kind = 'infraction' and i.payload ->> 'visit_act' = v.id::text
                                                where v.kind = 'visit' and v.target_act_id = o.target_act_id and i.payload ->> 'fall_play' = o.id::text)),
    'surfaces', (select coalesce(jsonb_object_agg(sf.play::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb)
                 from surfaces sf where sf.play in (select o.id from on_posts o where o.kind = 'card')),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;
