-- The rewind: a card that shows a post as of an earlier point of its history, and freezes the post while it is up (docs/plans/2026-11-21-time-machine-plan.md, Task 2; design docs/plans/2026-11-21-time-machine-design.md, sections 3, 4, 6 and 7).
-- A rewind card is a cast card on a post alone, with a `lasts`, face up only; its configuration is `{ to }`, a version of the post (the post itself or one of its `edit` Acts), and its play writes `rewind_at`, the point that version names, into
-- its payload. While it is live the post shows as of that point, and no card up to the rewind's rarity (`card_kinds.rewind`) lands on the post. Each object here that already existed is copied whole from its latest version on main, with only the
-- change named. The first half of the migration (sections 1 to 8, 11) is the column, the checks, the point and the reads; the second half (12, post_rewind_plays, then place_cast, place_set, spring_traps, thread_page) follows.
--
--   1. card_kinds.rewind          new: text, the rarity a live rewind turns away (null for every card that is no rewind), with card_kinds_rewind_rarity, a check on the list rarity_rank reads (0054_card_plays.sql).
--   2. card_kinds_problem         copied whole from 0411_post_effects.sql: a rewind's sentences, each in the engine's words (engine/rules/instance.ts, rewindProblems). A seeded card's `rewind` is `{ upTo }`.
--   3. seed_instance              copied whole from 0411_post_effects.sql: `rewind` joins the card insert's columns, values and on-conflict update, from `e #>> '{rewind,upTo}'`.
--   4. rewind_point_at            new: the time a version of a post names (the post: its time plus editGrace, read as acts_public reads it; an edit saved after that: its own time; anything else: null).
--   5. rewind_point_problem       new: null where a point is offered (design, 4.1), else the engine's words, in order. Reads the post's versions from acts and its plays from play_post (0408_play_post.sql), as the kept rows hold what is in force.
--   6. live_rewind                new: the post's rewind plays in force (play_post's in-force test), latest played first, with the point each names. One probe of play_post_up.
--   7. rewind_refusal             new: the freeze's words (the engine's rewindWords) for the first live rewind that turns the incoming card away, or null; `passing` passes a rewind whose card is no rarer than it, as ward_refusal does.
--   8. rewind_view                new: { play, post, at, version } for a rewind play, the version built as play_moment (0375_spun_thread_reads.sql) builds its own, through public_payload and so shown_payload, so a hidden version shows the hidden placeholder.
--  11. card_target                copied whole from 0411_post_effects.sql: a post's effect carries `rewind: { upTo }` and the play's `at` where its card has one.
--  12. post_rewind_plays          new: the live rewind plays of each of a list of posts, set-based, granted as post_play_ids is (live_rewind is granted to no API role, and thread_page reads as the caller).
--   9. place_cast                 copied whole from 0411_post_effects.sql (the lockout, the cut, the pierce and the effects limit as they stand): a rewind card's point is asked of rewind_point_problem (a missing or malformed `to` gives the "pick a
--                                 point" words) and written as `rewind_at` beside `ends`; a rewind's own play meets no back (spring_traps is not called for it); rewind_refusal is asked right after the Ward for a Move (with the pierce's passing) and in the same place for a Use, before the stack and the limit, under the post's lock.
--  10. place_set                  copied whole from 0411_post_effects.sql: a rewind card is refused ("<name> is played face up and never set face down"); rewind_refusal is asked before anything is written.
--  13. spring_traps               copied whole from 0411_post_effects.sql: a post under a live rewind springs nothing on any trigger (the plan's place_cast-only skip would have let a quote, a staff quote or a visit spring a back on a rewound post); the back stays set.
--  15. face_down_never_writes, face_down_never_replies  copied whole from 0405_cut.sql and 0348_post_under.sql: "cast face up" becomes "played face up", the engine's words.
--  14. thread_page                copied whole from 0410_post_plays.sql: a top-level `rewinds` key, rewind_view of each live rewind play of the page's posts and of the ORIGIN post (the `rw` CTE over post_rewind_plays); empty when none.
--
-- Ways out: a rewind ends at its time (`lasts`), or by an admin (reverse_card), as any play on a post does; the freeze ends with it. Masks: every fact read is public (a post's versions, its plays and their times, the incoming card's rarity); the refusal and the view
-- are the same for every caller whoever owns the post or the playing character, and a version an admin hid stays hidden.
-- Cost at a busy instance's scale: live_rewind and the freeze are one probe of play_post_up (post, ends_at) over the post's own plays; rewind_point_problem reads one post's edits (acts_edits) and plays; rewind_view is two probes of acts by id and acts_edits.

-- ---- 1. card_kinds.rewind ----

alter table card_kinds add column rewind text;
alter table card_kinds add constraint card_kinds_rewind_rarity check (rewind is null or rewind in ('common', 'uncommon', 'rare', 'legendary'));

-- ---- 2. card_kinds_problem ----

-- card_kinds_problem (0411_post_effects), a rewind's sentences are added (engine/rules/instance.ts, rewindProblems). Everything else as 0411_post_effects wrote it. Its grants are as they were (replaced in place).
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
      -- A card has a rewind when the key is there and is not a JSON null, as seed_instance reads it.
      coalesce(e -> 'rewind', 'null'::jsonb) <> 'null'::jsonb as has_rewind,
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
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and coalesce(c.gimmick ->> 'kind' not in ('ward', 'earn', 'price', 'ride', 'noQuote', 'cushion', 'pierce'), true)
           then format('card "%s" has a gimmick of kind %s; a gimmick is ward, earn, price, ride, noQuote, cushion or pierce', c.key, coalesce(to_jsonb(c.gimmick ->> 'kind')::text, 'null')) end,
      -- A pierce (engine/rules/instance.ts, gimmickProblems and playProblems): an upTo that is a rarity, on a use card that reaches a character alone, no rarer than the card itself.
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and rarity_rank(c.gimmick ->> 'upTo') is null
           then format('card "%s" has a pierce up to %s; a rarity is common, uncommon, rare or legendary', c.key, coalesce(compact_json(c.gimmick -> 'upTo'), 'undefined')) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and c.play <> 'use' then format('card "%s" has a pierce and is not a use card', c.key) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and not c.character_alone then format('card "%s" has a pierce and reaches more than a character', c.key) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and rarity_rank(c.gimmick ->> 'upTo') > rarity_rank(c.rarity)
           then format('card "%s" has a pierce up to %s, rarer than the card', c.key, c.gimmick ->> 'upTo') end,
      -- A card that cuts (engine/rules/instance.ts, cutsProblems; the seed sends a default for what a card leaves out, a stack of 1, pins, writes, replies, keeps, scoresAs and surface false, needsMessage and veil empty, which read as left out here): an upTo that is a rarity no rarer than the card, on a cast card that reaches a post or a character, with no time up and no other effect.
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and rarity_rank(c.e #>> '{cuts,upTo}') is null
           then format('card "%s" has cuts up to %s; a rarity is common, uncommon, rare or legendary', c.key, coalesce(compact_json(c.e #> '{cuts,upTo}'), 'nothing')) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and c.play <> 'cast' then format('card "%s" has cuts and is not a cast card', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and rarity_rank(c.e #>> '{cuts,upTo}') > rarity_rank(c.rarity)
           then format('card "%s" has cuts up to %s, rarer than the card', c.key, c.e #>> '{cuts,upTo}') end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and jsonb_typeof(c.e -> 'reaches') = 'array' and exists (select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r not in ('post', 'character'))
           then format('card "%s" has cuts and reaches %s; a card that cuts reaches a post or a character', c.key,
                       (select string_agg(case r.v when 'thread' then 'a thread' when 'board' then 'a board' else to_jsonb(r.v)::text end, ' and ' order by r.n)
                        from jsonb_array_elements_text(c.e -> 'reaches') with ordinality r(v, n) where r.v not in ('post', 'character'))) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'lasts', 'null'::jsonb) <> 'null'::jsonb then format('card "%s" has cuts and a time up (lasts); a card that cuts is over when it lands', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'stack', 'null'::jsonb) not in ('null'::jsonb, '1'::jsonb) then format('card "%s" has cuts and a stack; a card that cuts is over when it lands and has none', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'pins', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then format('card "%s" has cuts and pins; a card that cuts is over when it lands and has none', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb then (select format('card "%s" has cuts and %s; a card that cuts has no other effect', c.key, o.said)
                            from (values (1, 'gimmick', 'a gimmick'), (2, 'skim', 'a skim'), (3, 'refunds', 'refunds'), (4, 'discipline', 'a discipline'), (5, 'writes', 'writes'), (6, 'replies', 'replies'),
                                         (7, 'keeps', 'keeps'), (8, 'scoresAs', 'scoresAs'), (9, 'draws', 'draws'), (10, 'drive', 'a drive'), (11, 'surface', 'a surface'), (12, 'veil', 'a veil'),
                                         (13, 'needsMessage', 'needsMessage')) o(n, k, said)
                            where coalesce(c.e -> o.k, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb) order by o.n limit 1) end,
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
      -- A trap's outcome: an object, on a set card that springs on a cast, of kind ride (with a share), refund (a kind alone) or lockout (hours alone).
      case when jsonb_typeof(c.trap) = 'object' and c.trap ? 'outcome' and jsonb_typeof(c.trap -> 'outcome') is distinct from 'object'
           then format('card "%s" has an outcome that is not an object', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and (c.play <> 'set' or c.trigger_on is distinct from 'cast')
           then format('card "%s" has an outcome, and only a set card that springs on a cast does', c.key) end,
      -- A ride that pays on every quadrant says `every: true` and may sit beside a match; `every` is true or left out, and is asked of a ride alone (a refund with an `every` is refused below, as a key beside its kind).
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride' and c.trap -> 'outcome' ? 'every'
             and c.trap -> 'outcome' -> 'every' is distinct from 'true'::jsonb
           then format('card "%s" has an outcome whose every is %s; every is true or left out', c.key, (c.trap -> 'outcome' -> 'every')::text) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' is distinct from 'ride' and c.trap #>> '{outcome,kind}' is distinct from 'refund' and c.trap #>> '{outcome,kind}' is distinct from 'lockout'
           then format('card "%s" has an outcome of kind %s; an outcome is ride, refund or lockout', c.key, coalesce((c.trap -> 'outcome' -> 'kind')::text, 'undefined')) end,
      -- A refund outcome takes a kind alone: the first key besides `kind` is named.
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'refund'
             and exists (select 1 from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind')
           then format('card "%s" has a refund outcome with %s; a refund outcome has a kind alone', c.key, (select k from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind' limit 1)) end,
      -- A lockout outcome takes a kind and hours alone (the first other key is named), and hours is a whole number from 1 to 168: the words of the engine's outcomeProblems (engine/rules/instance.ts). A number reads bare
      -- and anything else as its JSON, so "24" (a string) does not read as a valid 24; a missing hours has a sentence of its own.
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout'
             and exists (select 1 from jsonb_object_keys(c.trap -> 'outcome') k where k not in ('kind', 'hours'))
           then format('card "%s" has a lockout outcome with %s; a lockout outcome has hours alone', c.key, (select k from jsonb_object_keys(c.trap -> 'outcome') k where k not in ('kind', 'hours') limit 1)) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout' and not c.trap -> 'outcome' ? 'hours'
           then format('card "%s" has a lockout outcome with no hours; a lockout is a whole number of hours from 1 to 168', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout' and c.trap -> 'outcome' ? 'hours'
             and not coalesce(jsonb_typeof(c.trap -> 'outcome' -> 'hours') = 'number' and (c.trap -> 'outcome' ->> 'hours')::numeric = trunc((c.trap -> 'outcome' ->> 'hours')::numeric)
                              and (c.trap -> 'outcome' ->> 'hours')::numeric between 1 and 168, false)
           then format('card "%s" locks out for %s hours; a lockout is a whole number of hours from 1 to 168', c.key, (c.trap -> 'outcome' -> 'hours')::text) end,
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
      case when c.e -> 'scoresAs' = 'true'::jsonb and not c.character_alone then format('card "%s" scores as a class, and a card that does reaches a character alone', c.key) end,
      -- Draws an effect (engine/rules/instance.ts, instanceProblems): a boolean where given; the seed sends one for every card.
      case when c.e ? 'drawsEffect' and jsonb_typeof(c.e -> 'drawsEffect') <> 'boolean' then format('card "%s" has drawsEffect %s; drawsEffect is true or false', c.key, c.e -> 'drawsEffect') end
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
    -- engine/rules/instance.ts, rewindProblems (the Time Machine design, section 3): a cast card on a post alone, with a time up and a rarity to turn away, and none of what a rewind has no way to carry. The seed sends a default for what a card leaves
    -- out (a stack of 1, writes, replies, keeps, surface and addsReaction false), which read as left out here.
    union all
    select c.key, 800, format('card "%s" has a rewind, and only a cast card does', c.key) from c where c.has_rewind and c.play <> 'cast'
    union all
    select c.key, 801, format('card "%s" has a rewind, and a card with a rewind reaches a post alone', c.key) from c
    where c.has_rewind and not (jsonb_typeof(c.e -> 'reaches') = 'array' and c.e -> 'reaches' = '["post"]'::jsonb)
    union all
    select c.key, 802, format('card "%s" has a rewind, and a card with a rewind has a time up (lasts); a rewind ends at its time', c.key) from c
    where c.has_rewind and coalesce(c.e -> 'lasts', 'null'::jsonb) = 'null'::jsonb
    union all
    select c.key, 803, format('card "%s" has a rewind, and its upTo is one of common, uncommon, rare or legendary', c.key) from c
    where c.has_rewind and (jsonb_typeof(c.e -> 'rewind') is distinct from 'object' or rarity_rank(c.e #>> '{rewind,upTo}') is null)
    union all
    select c.key, 810 + o.n, format('card "%s" has a rewind, and a card with a rewind has no %s', c.key, o.said) from c
    cross join (values (1, 'gimmick', 'gimmick'), (2, 'veil', 'veil'), (3, 'addsReaction', 'reaction'), (4, 'writes', 'writes'), (5, 'replies', 'replies'), (6, 'draws', 'draws'), (7, 'drive', 'drive'), (8, 'surface', 'surface')) o(n, k, said)
    where c.has_rewind and coalesce(c.e -> o.k, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb)
  ) p where why is not null
$function$;

-- ---- 3. seed_instance ----

-- seed_instance (0411_post_effects), `rewind` joins the card insert's columns, values and on-conflict update, beside `draws_effect`. Everything else as 0411_post_effects wrote it. Its grants are as they were (replaced in place).
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
  listed text[];
  first_staff text[];
  departing text[];
  departed text[] := '{}';
  returned text[] := '{}';
  open_id bigint;
  boss_was text;
  handed text;
  mods_were bigint;
  retiring boolean := payload ? 'formerly' or payload ? 'withdrawn';
  moving record;
  copies bigint;
  renamed jsonb := '[]'::jsonb;
  withdrawn_out jsonb := '[]'::jsonb;
  strays uuid[];
  left_boards uuid[];
  placed integer := 0;
  counting record;
  on_list bigint;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- And then the offices lock, before any persona row is written: set_office and a handover take it first and then row-lock a persona, so a seed that took it after its persona upserts would wait on a row an admin
  -- holds while the admin waits on this lock. One order everywhere: seed lock, offices lock, rows.
  perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
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
  -- The three ways a card leaves (0404). A seed that carries `formerly` or `withdrawn` says where every card a seed wrote stands (from_seed), and is refused, naming the keys, where it does not: a key in none of cards, formerly and withdrawn,
  -- a key in more than one, a renaming into a card the seed does not list (or into itself; a name already gone may point at a withdrawn card, and needs no entry when the card its chain ends in is listed), a refund that is not a positive whole number, and a card that left listed as a card again (a card that comes back takes a new key).
  -- The refusal does not depend on who holds what. Nothing is written before it.
  if retiring then
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where k.from_seed and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e where e ->> 'key' = k.key)
      -- A renamed card is listed by name, under the card that carries it, so history never says "a card". The one name that needs no entry is a card that was renamed and whose chain then ended in a withdrawal that the payload lists:
      -- no card can carry that name, so there is no shape the instance could write for it.
      and not (k.gone_at is not null and exists (
        select 1 from card_now(k.key) n join jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w on w ->> 'key' = n.key where n.refund is not null));
    if unknown is not null then
      raise exception 'the seed lists % as no card, no former name and no withdrawn card: a card the database holds is listed as one of the three, never left out', unknown using errcode = '22023';
    end if;
    select string_agg(d.key, ', ' order by d.key) into unknown
    from (select x.key from (select e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e) x group by x.key having count(*) > 1) d;
    if unknown is not null then raise exception 'the seed lists % in more than one of its cards, former names and withdrawn cards: a card is in one', unknown using errcode = '22023'; end if;
    select string_agg(f.e ->> 'key' || ' (renamed to ' || coalesce(f.e ->> 'became', 'nothing') || ')', ', ' order by f.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e)
    where f.e ->> 'became' is null or f.e ->> 'became' = f.e ->> 'key'
       or not (exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) c where c ->> 'key' = f.e ->> 'became')
               -- a name already gone may point at a card the payload withdraws (its copies were that card's when it was refunded)
               or (exists (select 1 from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w where w ->> 'key' = f.e ->> 'became')
                   and exists (select 1 from card_kinds g where g.key = f.e ->> 'key' and g.gone_at is not null)));
    if unknown is not null then raise exception 'a card is renamed to another card the seed lists as a card, never to itself or to nothing: %', unknown using errcode = '22023'; end if;
    select string_agg(w.e ->> 'key', ', ' order by w.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e)
    where jsonb_typeof(w.e -> 'refund') is distinct from 'number' or (w.e ->> 'refund') !~ '^[1-9][0-9]{0,8}$';
    if unknown is not null then raise exception 'a withdrawn card is refunded a positive whole number of hundredths: %', unknown using errcode = '22023'; end if;
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where k.gone_at is not null and exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key);
    if unknown is not null then
      raise exception '% already left the game and cannot be listed as a card again: a card that comes back takes a new key', unknown using errcode = '22023';
    end if;
  end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface, from_seed, cuts, draws_effect, rewind)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false), true, nullif(e -> 'cuts', 'null'), coalesce((e ->> 'drawsEffect')::boolean, false), e #>> '{rewind,upTo}'
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface, from_seed = true, cuts = excluded.cuts, draws_effect = excluded.draws_effect, rewind = excluded.rewind;
  -- Out of print (0404): the flag sets retired_at, kept while it stays and cleared when it goes.
  update card_kinds k set retired_at = case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end
  from jsonb_array_elements(payload -> 'cards') e(c)
  where k.key = e.c ->> 'key' and k.retired_at is distinct from case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end;
  -- Renamed and withdrawn (0404): each key not yet gone is moved by card_leaves, once ever, and its copies are counted for the answer.
  if retiring then
    for moving in
      select f.e ->> 'key' as old, f.e ->> 'became' as became, null::integer as refund from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e) join card_kinds k on k.key = f.e ->> 'key' where k.gone_at is null
      union all
      select w.e ->> 'key', null, (w.e ->> 'refund')::integer from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e) join card_kinds k on k.key = w.e ->> 'key' where k.gone_at is null
      order by 1
    loop
      copies := card_leaves(moving.old, moving.became, moving.refund);
      if moving.became is not null then renamed := renamed || jsonb_build_object('from', moving.old, 'to', moving.became, 'copies', copies);
      else withdrawn_out := withdrawn_out || jsonb_build_object('key', moving.old, 'copies', copies, 'refunded', copies * moving.refund); end if;
    end loop;
  end if;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
  -- A pack kind the payload does not list is out of print, one it lists is not (0404; a payload with no `packs` says nothing of pack kinds): its slot is left out of the machine, and a sealed pack of it still opens.
  if retiring and payload ? 'packs' then
    update pack_kinds k set retired_at = x.want
    from (select p.key, case when l.key is null then coalesce(p.retired_at, now()) end as want
          from pack_kinds p left join (select distinct e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e) l on l.key = p.key) x
    where x.key = k.key and k.retired_at is distinct from x.want;
  end if;
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
  insert into boards (slug, name, description, is_system, created_at)
  select b.e ->> 'slug', b.e ->> 'name', coalesce(b.e ->> 'description', ''), coalesce(b.e ->> 'slug' = flagged, false),
         now() + make_interval(secs => b.i / 1000000.0)
  from jsonb_array_elements(payload -> 'boards') with ordinality b(e, i)
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
  -- The seed's roster is the whole staff (docs/plans/2026-11-21-departed-personas-design.md, sections 2 and 3). A persona the roster does not list, and that the seed has not already benched, is departing. This block runs last,
  -- after the persona files, the roster setting, the season and its first Boss and the announcements thread are in place, so a departing Boss's handover reads the roster this seed wrote and says its farewell in the thread.
  -- It runs after (and not inside) the `firstStaff` hire above, which hires only a persona with no office row: a persona the seed benched has one, so it is brought back here and only by a roster that lists it. A seed that
  -- lists no persona (a partial seed) is not a roster and benches nobody, as it leaves `bossRoster` as it was.
  listed := array(select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ->> 'key' is not null);
  first_staff := array(select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k);
  if cardinality(listed) > 0 then
    -- The offices lock is held since the top of this function, so what stands is what is read.
    select s.id, s.boss into open_id, boss_was from seasons s where s.ends_at is null;
    mods_were := (select count(*) from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null);
    -- A persona listed again after a seed benched it comes back first, so a Boss that is leaving can hand the chair to it: a Mod where firstStaff names it, else a member. A member row debuts nothing; a Mod row debuts it,
    -- as the firstStaff hire does.
    returned := array(
      select k from unnest(listed) k
      where exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null)
        and (select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = k order by o.id desc limit 1));
    insert into staff_offices (staff, office, cause) select k, case when k = any (first_staff) then 'mod' else 'member' end, 'seed' from unnest(returned) k;
    update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (returned) and c.staff = any (first_staff);
    departing := array(
      select c.staff from characters c
      where c.staff_kind = 'persona' and c.retired_at is null and c.staff <> all (listed)
        and not coalesce((select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = c.staff order by o.id desc limit 1), false)
      order by c.staff);
    -- The other departing personas first, so neither the rotation nor a standing nomination can seat one.
    insert into staff_offices (staff, office, cause) select k, 'benched', 'seed' from unnest(departing) k where k is distinct from boss_was;
    departed := array(select k from unnest(departing) k where k is distinct from boss_was);
    if boss_was is not null and boss_was = any (departing) then
      -- The early handover, in the open season: it refuses (and the seed with it, nothing written) where no one else can sit in the chair. Its farewell is posted before the bench below, since a benched persona writes nothing.
      perform hand_over(open_id, boss_was, now(), true);
      insert into staff_offices (staff, office, cause) values (boss_was, 'benched', 'seed');
      departed := departed || boss_was;
      select s.boss into handed from seasons s where s.id = open_id;
    end if;
    -- The staff is never empty: where a Mod stood before this seed and none stands now (it benched the last one, or the Boss's handover did), each listed firstStaff persona that is not the Boss is hired. If that still leaves none,
    -- the seed is refused. A staff that had no Mod before this seed is not this seed's doing, so it is left as it was (the firstStaff hire above is how a first seed gets its Mod).
    if mods_were > 0
       and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
      insert into staff_offices (staff, office, cause)
      select k, 'mod', 'seed' from unnest(first_staff) k
      where k = any (listed) and k is distinct from (select s.boss from seasons s where s.id = open_id)
        and exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null);
      update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (first_staff)
        and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod' and x.id = (select max(y.id) from staff_offices y where y.staff = c.staff));
      if not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
        raise exception 'the seed leaves no Mod Bot on staff: name one in firstStaff' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
    end if;
  end if;
  -- The staff's threads follow the flag (0407). Every thread of system_threads() is stored on system_board(); one that is not is a stray, left behind by a flag a seed moved, in this run or in an older
  -- one, so the strays are looked for on every seed and not only when the flag moves in this one. With none, nothing is written. Otherwise they are placed by rebuild_thread_places (its own lock and
  -- its refusal of a thread another writer moved), and then the counts of every board a stray left and of the system board are recounted by the rule thread_list lists by (backfill_board_counts, 0063):
  -- the threads in thread_list on the board, in shard 0, the other shards zero. The recount, and not a delta, because a board that held threads from before 0339's rule, or the Updates thread netted
  -- by hand, is not one rebuild_thread_places' deltas can be trusted to leave right, and the system board's arrivals are the ones it never counts.
  if system_board() is not null then
    -- One keyed probe for each of the staff's threads (system_thread_rows), and no second read of threads for its board: a reseed reads what the staff's threads are, not how many threads there are.
    select array_agg(r.id), array_agg(distinct r.board) into strays, left_boards
    from system_thread_rows() r where r.board is distinct from system_board();
    if strays is not null then
      placed := rebuild_thread_places(strays);
      left_boards := (select array_agg(x order by x) from (select unnest(left_boards) union select system_board()) u(x));
      perform 1 from board_thread_counts c where c.board = any (left_boards) order by c.board, c.shard for update;
      for counting in
        select b as board from unnest(left_boards) b order by b
      loop
        select count(*) into on_list from thread_list l where l.board = counting.board;
        update board_thread_counts c set threads = case when c.shard = 0 then on_list else 0 end
        where c.board = counting.board and c.threads is distinct from case when c.shard = 0 then on_list else 0 end;
      end loop;
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards),
    'retired', (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from card_kinds k where k.retired_at is not null), 'renamed', renamed, 'withdrawn', withdrawn_out,
    'departed', to_jsonb(departed), 'returned', to_jsonb(returned), 'handover', to_jsonb(handed), 'placed', placed);
end $function$;

-- ---- 4. rewind_point_at ----

-- The time a version of a post names (the design, 4.1). The post itself: its time plus the edit grace (an edit saved inside the grace is part of "as first posted", as acts_public's shown_edited_at treats it, and the grace is read as that view reads it).
-- An `edit` Act of this post saved after that time: its own time. An edit inside the grace, another post's edit, or anything that is no version of this post: null.
create function rewind_point_at(post uuid, version uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select case when v.id = p.id then p.created_at + g.grace
              when v.kind = 'edit' and v.target_act_id = p.id and v.created_at > p.created_at + g.grace then v.created_at end
  from acts p
  cross join (select coalesce(span_interval((select s.value from settings s where s.key = 'editGrace')), interval '0') as grace) g
  join acts v on v.id = rewind_point_at.version
  where p.id = rewind_point_at.post and post_kind(p.kind)
$$;
revoke execute on function rewind_point_at(uuid, uuid) from public, anon, authenticated, service_role;

-- ---- 5. rewind_point_problem ----

-- Why a version is no point to rewind a post to, in the engine's words and this order (engine/rules/rewind.ts, pointAt and rewindPoints), or null where it is offered. A point is offered when showing it would change the post: an edit was saved after the
-- point's time, or a play on the post, played after it, is still showing. A point later than now is not offered. "Still showing" is read from play_post: the play is in force (not over, its time not up), and it is a face-up play at the post's reach.
-- A face-down set (play_post.kind is the empty string, a back never naming its card) shows nothing, so it never makes a point worth offering; a back that sprang is over, and the card it played is its own play, except a back that sprang into a lockout (0412_lockout_play_post): it is in force while the lockout is, shows on the post, and is read here (`pp.sprung`). A play beyond a post (a character,
-- thread or board reach) is not on the post and is not read.
create function rewind_point_problem(post uuid, version uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p.id is null or v.id is null or not (v.id = p.id or (v.kind = 'edit' and v.target_act_id = p.id)) then 'pick a point from this post''s History'
    when v.id <> p.id and v.created_at <= p.created_at + g.grace then 'that version was saved in the edit grace window, so it is part of the post as first posted'
    -- `at <= now()` is redundant by construction (an Act is never written in the future, so nothing can be after a point still to come); it is kept as the guard that a point still to come is never offered.
    when not (at <= now() and (exists (select 1 from acts e where e.kind = 'edit' and e.target_act_id = p.id and e.created_at > at)
                               or exists (select 1 from play_post pp
                                          where pp.post = p.id and pp.over_at is null and (pp.ends_at is null or pp.ends_at > now()) and (pp.kind <> '' or pp.sprung) and pp.reach = 'post' and pp.played_at > at)))
      then 'this post shows the same at that point as it does now'
  end
  from (select 1) one
  cross join (select coalesce(span_interval((select s.value from settings s where s.key = 'editGrace')), interval '0') as grace) g
  left join acts p on p.id = rewind_point_problem.post and post_kind(p.kind)
  left join acts v on v.id = rewind_point_problem.version
  cross join lateral (select case when v.id = p.id then p.created_at + g.grace else v.created_at end as at) t
$$;
revoke execute on function rewind_point_problem(uuid, uuid) from public, anon, authenticated, service_role;

-- ---- 6. live_rewind ----

-- The rewind plays in force on a post, latest played first: the play, the rarity it turns away, its card, the point it names (`rewind_at`, written by place_cast) and when it ends. In force is play_post's own test, which already holds every way a play
-- ends (its time, a caught or taken-back play, an admin's end, a refund, a spent pierce, a cut). One probe of play_post_up by post.
create function live_rewind(post uuid) returns table (play uuid, up_to text, card text, at timestamptz, ends timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select pp.play, ck.rewind, ck.key, (a.payload ->> 'rewind_at')::timestamptz, pp.ends_at
  from play_post pp
  join card_kinds ck on ck.key = pp.kind and ck.rewind is not null
  join acts a on a.id = pp.play
  where pp.post = live_rewind.post and pp.over_at is null and (pp.ends_at is null or pp.ends_at > now()) and pp.reach = 'post'
  order by pp.played_at desc, pp.play desc
$$;
revoke execute on function live_rewind(uuid) from public, anon, authenticated, service_role;

-- ---- 7. rewind_refusal ----

-- The freeze's words (the engine's rewindWords, cards.ts), the same for every caster since a rewind is face up: the first live rewind, latest played first, whose rarity the incoming card is at or below. `passing` is a pierce's rarity, and a rewind
-- whose own card is at or below it is passed, as ward_refusal passes a ward. The time is written as refusal_time writes it, which place_cast's no-quote refusal uses and the engine's refusalTime mirrors. Null where nothing turns the card away.
create function rewind_refusal(post uuid, incoming card_kinds, passing text default null) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select format('this post''s %s turns away cards up to %s until %s', ck.name, l.up_to, refusal_time(l.ends))
  from live_rewind(rewind_refusal.post) with ordinality l(play, up_to, card, at, ends, n)
  join card_kinds ck on ck.key = l.card
  where rarity_rank(incoming.rarity) <= rarity_rank(l.up_to)
    and (passing is null or rarity_rank(ck.rarity) > rarity_rank(passing))
  order by l.n limit 1
$$;
revoke execute on function rewind_refusal(uuid, card_kinds, text) from public, anon, authenticated, service_role;

-- ---- 8. rewind_view ----

-- A rewind play's view: `{ play, post, at, version }`, where `version` is the post as it stood at the point, built as play_moment builds its version (act_projection of the post with the version's own words through public_payload, which is shown_payload, so
-- a version an admin hid shows the hidden placeholder, as History does): the latest version saved at or before the point. Null for an Act that is no live-or-ended rewind play on a post (a caught play never took, and names no point).
create function rewind_view(play uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
set plan_cache_mode = force_generic_plan
set jit = off
as $$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  point timestamptz;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
begin
  select * into k from acts a where a.id = rewind_view.play;
  if k.id is null or k.kind <> 'card' or k.target_act_id is null or k.payload ? 'caught' or coalesce(k.payload ->> 'reach', 'post') <> 'post'
     or not exists (select 1 from card_kinds ck where ck.key = k.payload ->> 'card' and ck.rewind is not null) then
    return null;
  end if;
  point := (k.payload ->> 'rewind_at')::timestamptz;
  select * into on_post from acts a where a.id = k.target_act_id;
  if point is null or not coalesce(post_kind(on_post.kind), false) then return null; end if;
  select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= point order by e.created_at desc, e.id desc limit 1;
  if v.id is null then v := on_post; end if;
  return jsonb_build_object('play', k.id, 'post', on_post.id, 'at', point,
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end));
end $$;
revoke execute on function rewind_view(uuid) from public, anon, authenticated, service_role;
grant execute on function rewind_view(uuid) to authenticated, service_role;

-- ---- 11. card_target ----

-- card_target (0411_post_effects), a post's effect carries `rewind: { upTo }` and when it was played (`at`) where its card has a rewind, as the engine's CardEffect.rewind reads it. Everything else as 0411_post_effects wrote it. Its grants are as they were (replaced in place).
create or replace function public.card_target(target uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind, 'author', a.character,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'forged', coalesce(a.current_payload -> 'forged', '[]'::jsonb),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'gimmick', ck.gimmick,
          -- The effect this play draws and counts toward the post's limit, and whether its author has cleared it for this version of the post (post_effects_up's test, effect_cleared).
          'drawing', case when ck.draws_effect then true end, 'cleared', case when ck.draws_effect and effect_cleared(k.id, post_version(a.id)) then true end,
          'ends', k.payload ->> 'ends', 'drive', dp.drive,
          'covered', case when ck.surface then (select bit_count(sf.cover) from surfaces sf where sf.play = k.id) end, 'closes', to_jsonb(dp.closes),
          'quadrant', case when ck.skim is not null then k.payload #>> '{config,quadrant}' end,
          -- A live rewind's rarity: the effect carries what the freeze turns away, the same for every caster (the engine's CardEffect.rewind).
          'rewind', case when ck.rewind is not null then jsonb_build_object('upTo', ck.rewind) end,
          -- And when it was played, so the engine's freeze names the latest-played of two live rewinds as live_rewind does (CardEffect.at).
          'at', case when ck.rewind is not null then k.created_at end)) as effect
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
  );
end
$function$;

-- ---- 12. post_rewind_plays ----

-- The live rewind plays of each of `posts`, set-based, for the page to read in one statement: the same plays live_rewind lists for one post (play_post's in-force test, two probes of play_post_up as post_play_ids makes them: no end, and an end ahead).
-- live_rewind is for the database's own functions and granted to no API role; thread_page reads as the caller, so it reads this, granted as post_play_ids is. The estimate of rows steers its callers to probe by post. `played_at` is the play's time, for the page to give the latest played first (design, section 3).
create function post_rewind_plays(posts uuid[]) returns table (post uuid, play uuid, played_at timestamptz)
language sql stable security definer set search_path = public, pg_temp rows 4 as $$
  select p.post, p.play, p.played_at from play_post p join card_kinds ck on ck.key = p.kind and ck.rewind is not null
  where p.post = any (post_rewind_plays.posts) and p.over_at is null and p.ends_at is null and p.reach = 'post'
  union all
  select p.post, p.play, p.played_at from play_post p join card_kinds ck on ck.key = p.kind and ck.rewind is not null
  where p.post = any (post_rewind_plays.posts) and p.over_at is null and p.ends_at > now() and p.reach = 'post'
$$;
revoke execute on function post_rewind_plays(uuid[]) from public, anon;
grant execute on function post_rewind_plays(uuid[]) to authenticated, service_role;

-- ---- 9. place_cast ----

-- place_cast (0411_post_effects): a rewind card names a point of the post's History (rewind_point_problem, in the engine's words) and writes it as `rewind_at` beside `ends`; and a post under a live rewind turns away every card up to its rarity, a
-- Move after the Ward (a pierce passing a rewind no rarer than it, as it passes a ward) and a Use in the same place, before the stack and the effects limit, under the post's lock. Everything else as 0411_post_effects wrote it, the lockout, the cut,
-- the pierce and the effects limit included. Its grants are as they were (replaced in place).
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
  shot_play uuid;
  shot_up_to text;
  shot_card text;
  shot_tried uuid[] := '{}';
  shot_try integer;
  passed_ward text;
  passed_back boolean := false;
  is_unban boolean;
  cut_play uuid;
  cut_words text;
  full_words text;
  frozen text;
  rewind_to uuid;
  rewind_why text;
  rewind_point timestamptz;
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
  -- Nor a card that ends a Gimmick: the Gimmick it names is a player's play, and a persona does not choose one (the Buzzkill design, section 2.5). Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.cuts is not null then
    raise exception 'a staff character casts no card that ends a Gimmick' using errcode = '42501';
  end if;
  -- A relief or an unban is over when it lands (card notes, Part 5): it leaves no effect, takes no place in a stack and has no time up, so it writes no `ends` and no play_reach row.
  is_relief := kind_of.discipline ->> 'kind' = 'relief';
  is_unban := coalesce(kind_of.discipline ->> 'kind' = 'unban', false);
  -- A card that cuts is over when it lands too: no `ends`, no play_reach row, no layer, no place in a stack. The play it names is read here only when it is a uuid (cut_refusal says the rest).
  is_instant := coalesce(kind_of.discipline ->> 'kind' in ('relief', 'unban'), false) or kind_of.cuts is not null;
  if kind_of.cuts is not null and config ->> 'play' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then cut_play := (config ->> 'play')::uuid; end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if not coalesce(post_kind(target_kind), false) then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- A character locked out of the post's thread plays nothing there. Asked here, before the ward, the back or anything written, so the Move that springs a lockout is not refused by the lockout it springs: the spring is
    -- written below, after this, and nothing after it asks again. It reads the public spring alone, so the same words come whoever owns the caster.
    perform not_locked_out(caster, in_thread);
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
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. The pierce loop never chooses the play a cut names: a cut spends no pierce on the Gimmick it ends (else reversing the cut would leave it ended by the pierce clause). (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce'
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords). A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      -- The freeze guards a play whose reach is the post, as the wards do and as the engine does (cards.ts, frozenRefusal): a card played from a rewound post at a character, a thread or a board is not on the post and is not turned away.
      -- A live rewind on the post turns away every card up to its rarity, in the same words for everyone (cards.ts's rewindWords), and a pierce passes a rewind whose card is no rarer than it. It sits right after the Ward and before
      -- the stack, the effects limit (post_room_words) and everything written: the post's row is held (above), as the limit is read under that same lock, so a rewind played at the same moment is seen by the card behind it. A rewind is face up,
      -- so the refusal reads public facts alone (the incoming card's rarity, the rewind's card and its time).
      frozen := rewind_refusal(target, kind_of, shot_up_to);
      if frozen is not null then raise exception '%', frozen using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against('post', target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- What the card's landing refuses on this post (land_refusal): public facts alone, the same words for every caster, and before anything is written.
      landing := land_refusal(kind_of, target, coalesce(config, '{}'));
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = land_refusal_code(landing); end if;
      -- A card that cuts: the Gimmick it names is up on this post and no rarer than its upTo (public plays and printed rarity alone, the same words for every caster). The post's row is held, so the Gimmicks are read as they stand.
      cut_words := cut_refusal(kind_of, 'post', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      -- A rewind names a point of this post's History: `to` is one of its versions, and showing that version must change what the post shows now (rewind_point_problem, the engine's words in the engine's order). A missing or malformed `to`
      -- is no version, so it gets the "pick a point" words and never a cast error. The point it names is written beside `ends` below, so the play is read as the post at that time for as long as it is up. The words read public facts alone
      -- (the post's versions and its plays), the same for every caster.
      if kind_of.rewind is not null then
        rewind_to := case when coalesce(config, '{}') ->> 'to' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (config ->> 'to')::uuid end;
        rewind_why := rewind_point_problem(target, rewind_to);
        if rewind_why is not null then raise exception '%', rewind_why using hint = 'kayfabb.refusal', errcode = '22023'; end if;
        rewind_point := rewind_point_at(target, rewind_to);
      end if;
    elsif kind_of.play = 'use' then
      -- A Use on the author's own post meets a live rewind's freeze as a Move does (a Use has no Ward asked of it and holds no pierce), in the same words and at the same place in the order, before the stack and the limit.
      frozen := rewind_refusal(target, kind_of);
      if frozen is not null then raise exception '%', frozen using hint = 'kayfabb.refusal', errcode = '42501'; end if;
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
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'instant');
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
    -- A play that draws an effect takes a slot on the post, and the post's row is held, so two plays racing for the last slot land one at a time (post_room_words, 0411).
    if kind_of.draws_effect then
      full_words := post_room_words(target);
      if full_words is not null then raise exception '%', full_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    end if;
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      -- A rewind's own play lands frozen (design 2.6 and 4.3): it names a point of the post and takes hold at once, so no back already face down there catches or springs on it (the back stays set, and springs later where a trigger meets
      -- it once the rewind is over). The next play on the post meets the back as it always did, but under the rewind spring_traps springs nothing.
      if kind_of.rewind is null then
        sprung := spring_traps('cast', target, written, card, actor => payer, passing => shot_up_to, locking => caster);
      end if;
      -- A back the pierce passed answers `passed` and wrote nothing: the cast met no back.
      if sprung ->> 'passed' = 'true' then passed_back := true; sprung := null; end if;
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
      -- The cast lands when no back caught it: it met none, or a back that rides, refunds or locks its caster out. The order is the Ward first (above), then the back, then the sign; a cast is handed back once at most.
      lands := sprung is null or sprung -> 'payload' ->> 'did' in ('rode', 'returned', 'lockedOut');
      if lands and payer is not null then
        if sprung -> 'payload' ->> 'did' = 'returned' then
          handed := jsonb_build_object('by', sprung -> 'payload' ->> 'set', 'card', sprung -> 'payload' ->> 'card');
        else
          -- The post's live refunds Gimmick: the latest play on this post whose card has refunds, is still up, names this card's flavor and has handed back fewer casts than its count. A card that cuts is never handed back by the Gimmick it names (the owner's answer, #965): the cutting card is consumed; a cut of another Gimmick is handed back by a refunds Gimmick still up as any Salty Move is. The post's row is locked
          -- above, so two casts are counted one after the other.
          select jsonb_build_object('by', k.id, 'card', k.payload ->> 'card') into handed
          from acts k join card_kinds rk on rk.key = k.payload ->> 'card'
          where k.kind = 'card' and k.target_act_id = target and coalesce(k.payload ->> 'reach', 'post') = 'post' and rk.refunds is not null
            and k.id is distinct from cut_play
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
      perform not_locked_out(caster, in_thread);
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
      perform not_locked_out(caster, in_thread);
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
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where (r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce') or (kind_of.cuts is not null and r.play = cut_play)
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only. A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against(reach, target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- A card that cuts: the Gimmick it names is up on this character and no rarer than its upTo, asked after the Ward and after the lock above.
      cut_words := cut_refusal(kind_of, 'character', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
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
    elsif is_unban then
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
                        when kind_of.cuts is not null then jsonb_build_object('instant', true)
                        else jsonb_build_object('instant', true, 'lifted', lifts) end
              when not lands then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              -- A card that cuts is over when it lands: no layer, so no place in a stack and nothing for acts_card_layers to collide on. A back that rode or locked its caster out is still named.
              when kind_of.cuts is not null then jsonb_build_object('instant', true)
                || case when rode then jsonb_build_object('rode', sprung -> 'payload' ->> 'set')
                        when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('lockedOut', sprung ->> 'id') else '{}'::jsonb end
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set')
              -- A lockout back's spring names the play (`by`); the play names the spring (`lockedOut`), so the caster's alert and log line read it on from the play as a ride's are read from `rode`.
              when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('layer', layer, 'lockedOut', sprung ->> 'id')
              else jsonb_build_object('layer', layer) end
      -- What handed the cast back to its caster's hand (the back's set play or the sign's play, with its card), as a public fact of the cast; the caster's ledger row below is the other half.
      || case when handed is not null then jsonb_build_object('handedBack', handed) else '{}'::jsonb end
      -- The Gimmick a landed cut ended (its play and its card), a public fact of the Move that card_cut_at reads; a play a back caught never lands and carries none.
      || case when kind_of.cuts is not null and lands then jsonb_build_object('cut', jsonb_build_object('play', cut_play, 'card', (select a.payload ->> 'card' from acts a where a.id = cut_play))) else '{}'::jsonb end
      -- The pierce the cast was made under, whether it lands or is caught: its play, its card, and the oldest ward it got past (a public fact of the Move, which the Lens line reads).
      || case when shot_play is not null then jsonb_build_object('pierce', jsonb_strip_nulls(jsonb_build_object('by', shot_play, 'card', shot_card, 'ward', passed_ward))) else '{}'::jsonb end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      -- A play a back caught never lands and is never in effect, so it holds no end (0370): settle.ts boosts and skims only with a play's `ends`.
      || case when reach = 'post' and kind_of.lasts is not null and lands then jsonb_build_object('ends', ends) else '{}'::jsonb end
      -- A rewind's point, the time its version names (rewind_point_at): live_rewind reads it back, and the post is shown as of it while the play is up.
      || case when reach = 'post' and rewind_point is not null and lands then jsonb_build_object('rewind_at', rewind_point) else '{}'::jsonb end
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
  elsif is_unban then
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
  -- A back a pierce passed tells the caster alone, in the same alert a caught cast writes with a sub of `passed`; the setter is told nothing (a spring that never was).
  if passed_back then perform write_alert(caster, 'trapStruck', 'passed', written); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

-- ---- 10. place_set ----

-- place_set (0411_post_effects): a rewind card is refused ("<name> is played face up and never set face down"), and a set on a post under a live rewind is refused in the freeze's words before anything is written. Everything else as 0411_post_effects
-- wrote it. Its grants are as they were (replaced in place).
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
  body_forged uuid[];
  off_board integer;
  nq_name text;
  nq_ends timestamptz;
  full_words text;
  frozen text;
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
  -- A rewind is played face up and never set: it names a point of the post's History and takes hold at once, never later on a post its caster did not choose (decideSet's words, cards.ts).
  if kind_of.rewind is not null then
    raise exception '% is played face up and never set face down', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
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
  perform not_locked_out(setter, in_thread);
  -- A live rewind on the post turns away a set of any card up to its rarity as it turns away a play (decideSet asks frozenRefusal at the same place), before anything is written. A back is never pierced, so no pierce is passed.
  frozen := rewind_refusal(target, kind_of);
  if frozen is not null then raise exception '%', frozen using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- The passage must be in the post's current words (its latest edit's body, else its own), read as the probe reads them. The post is public, so the refusal reads nothing private.
  if passage is not null then
    select p.current_payload ->> 'body', act_forged(p.current_payload) into body, body_forged from acts_public p where p.id = target;
    if not phrase_in(bbcode_plain(coalesce(body, ''), body_forged), passage) then raise exception 'that passage is not in this post''s words' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- Public, since the back is.
  -- A back is live until it springs, is taken back or its time passes; the three are public.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
             and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  -- A back holds a slot like a drawing effect, so a post at its limit takes none; the post's row is held above, so a play racing for the last slot lands one at a time (post_room_words, 0411).
  full_words := post_room_words(target);
  if full_words is not null then raise exception '%', full_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
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

-- ---- 13. spring_traps ----

-- spring_traps (0411_post_effects): a post under a live rewind springs no back, whatever the trigger; the back stays set. Everything else as 0411_post_effects wrote it. Its grants are as they were (replaced in place).
create or replace function spring_traps(trigger text, post uuid, by_act uuid, incoming_card text default null, held uuid[] default null, actor uuid default null, passing text default null, locking uuid default null) returns jsonb
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
  back_rarity text;
begin
  -- A post under a live rewind springs no back, on any trigger (a cast, a quote, a staff persona's quote, a visit, a reply, a reaction): the post is shown as it was, and nothing may happen to it that its readers could not see on it. The back stays
  -- set, untouched, and springs when the rewind ends and a trigger meets it, as a back does that no trigger met. Asked before the back is locked, so a rewound post never waits on one.
  if exists (select 1 from live_rewind(spring_traps.post)) then return null; end if;
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
      when 'post' then case when f.kind_skim then f.quadrant_ok and f.quadrant_up = 0 else f.up < f.kind_stack end and not f.warded and f.land_why is null and f.room
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
  did := case back_trigger when 'quote' then 'landed' when 'cast' then case f.kind_trap #>> '{outcome,kind}' when 'ride' then 'rode' when 'refund' then 'returned' when 'lockout' then 'lockedOut' else 'caught' end else 'ended' end;
  -- A pierce gets the cast past a catch no rarer than it: the back stays set and unsprung, and nothing is written or told (Cheap Shot's design, section 3.3). A ride or a refund springs as before.
  if trigger = 'cast' and did = 'caught' and passing is not null then
    select k.rarity into back_rarity from card_kinds k where k.key = fd.card;
    if rarity_rank(back_rarity) <= rarity_rank(passing) then return '{"passed": true}'::jsonb; end if;
  end if;
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
    -- A lockout locks the character that played the Move out of the back's thread until `until`, fixed now as a ban's is. `locking` is that character: the Move's Act is not written yet when it springs.
    'locks', case when did = 'lockedOut' then coalesce(locking, f.by_character)::text end,
    'until', case when did = 'lockedOut' then now() + make_interval(hours => (f.kind_trap #>> '{outcome,hours}')::int) end,
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

-- ---- 14. thread_page ----

-- thread_page (0410_post_plays): a top-level `rewinds` key, the list of rewind_view for each live rewind play on a post of the page, a reply drawn under one, or the ORIGIN post (one CTE over those ids; empty when none, and nothing once a rewind ends).
-- Everything else as 0410_post_plays wrote it. Its grants are as they were (replaced in place).
CREATE OR REPLACE FUNCTION public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) IS NULL) OR ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) < 1) OR (COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) > 100))) THEN screen_refusal('a page holds 1 to 100 posts'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH pp AS MATERIALIZED (
          SELECT COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1)) AS n
         ), s AS MATERIALIZED (
          SELECT o.id,
             o.board,
             o.title,
             o.origin_act_id,
             o.created_at,
             o.last_at,
             o.last_seq,
             o.replies,
             o.first_act,
             o.first_character,
             o.last_act,
             o.last_character,
             o.replies_this_week,
             o.origin_thread,
             o.origin_place,
             (GREATEST((1)::numeric, ceil(((o.last_seq)::numeric / (( SELECT pp.n
                    FROM pp))::numeric))))::integer AS last_page
            FROM thread_open o
           WHERE (o.id = thread_page.in_thread)
         ), pg AS MATERIALIZED (
          SELECT s.id,
             s.board,
             s.title,
             s.origin_act_id,
             s.created_at,
             s.last_at,
             s.last_seq,
             s.replies,
             s.first_act,
             s.first_character,
             s.last_act,
             s.last_character,
             s.replies_this_week,
             s.origin_thread,
             s.origin_place,
             s.last_page,
             LEAST(s.last_page, GREATEST(1, COALESCE(
                 CASE
                     WHEN (thread_page.in_seq IS NOT NULL) THEN (GREATEST((1)::numeric, ceil(((thread_page.in_seq)::numeric / (( SELECT pp.n
                        FROM pp))::numeric))))::integer
                     ELSE NULL::integer
                 END, thread_page.in_page, 1))) AS page
            FROM s
         ), rng AS MATERIALIZED (
          SELECT pg.id,
             pg.board,
             pg.title,
             pg.origin_act_id,
             pg.created_at,
             pg.last_at,
             pg.last_seq,
             pg.replies,
             pg.first_act,
             pg.first_character,
             pg.last_act,
             pg.last_character,
             pg.replies_this_week,
             pg.origin_thread,
             pg.origin_place,
             pg.last_page,
             pg.page,
             (((pg.page - 1) * ( SELECT pp.n
                    FROM pp)) + 1) AS first_seq,
             (pg.page * ( SELECT pp.n
                    FROM pp)) AS end_seq
            FROM pg
         ), range_acts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a,
             rng
           WHERE ((a.thread = rng.id) AND ((a.seq >= rng.first_seq) AND (a.seq <= rng.end_seq)) AND (a.kind <> ALL (ARRAY['edit'::text, 'card'::text])))
         ), drawn AS MATERIALIZED (
          SELECT r.id,
             r.seq,
             r.kind,
             u.play,
             u.parent
            FROM (range_acts r
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.parent
                    FROM post_under x
                   WHERE (x.reply = r.id)) u)
           WHERE (NOT card_ended(u.play))
         ), page_acts AS MATERIALIZED (
          SELECT r.id,
             r."character",
             r.kind,
             r.thread,
             r.target_act_id,
             r.seq,
             r.created_at,
             r.payload,
             r.current_payload,
             r.edited_at,
             r.shown_edited_at,
             r.untaken,
             r.ends_at,
             r.hidden,
             r.any_hidden,
             r.concealing,
             r.payload_hidden,
             r.payload_concealing
            FROM range_acts r
           WHERE (NOT (EXISTS ( SELECT 1
                    FROM drawn d
                   WHERE (d.id = r.id))))
         ), page_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.created_at
            FROM page_acts a
           WHERE post_kind(a.kind)
         ), nested AS MATERIALIZED (
          SELECT u.play,
             p.id AS parent,
             a.id,
             a."character",
             a.created_at,
             to_jsonb(a.*) AS act
            FROM ((page_posts p
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.reply
                    FROM post_under x
                   WHERE ((x.parent = p.id) AND (NOT card_ended(x.play)))) u)
              JOIN acts_public a ON ((a.id = u.reply)))
         ), posts AS MATERIALIZED (
          SELECT p.id,
             p."character",
             p.created_at
            FROM page_posts p
         UNION ALL
          SELECT n.id,
             n."character",
             n.created_at
            FROM nested n
         ), on_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM post_play_ids(ARRAY( SELECT p.id
                    FROM posts p)) x
         ), on_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM on_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM on_ids i)) r(r)
         ), on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM on_all o)))
         ), ends_on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE ((a.kind = 'card_end'::text) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o)))
         ), above AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM effects_above(ARRAY( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)), ( SELECT rng.id
                    FROM rng), ( SELECT rng.board
                    FROM rng)) x(play, reach, target, ends_at, act)
         ), kept_span AS MATERIALIZED (
          SELECT min(p.created_at) AS lo,
             max(p.created_at) AS hi
            FROM posts p
         ), kept_reach AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             COALESCE(x."character", x.thread, x.board) AS target,
             x.ends_at
            FROM play_reach x,
             kept_span s
           WHERE ((s.lo IS NOT NULL) AND (x.thread = ( SELECT rng.id
                    FROM rng)) AND (tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (x.ends_at <= now()))
         UNION ALL
          SELECT x.play,
             x.reach,
             x."character" AS target,
             x.ends_at
            FROM ((( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)) au
              CROSS JOIN kept_span s)
              CROSS JOIN LATERAL ( SELECT r.play,
                     r.reach,
                     r."character",
                     r.ends_at
                    FROM play_reach r
                   WHERE ((r."character" = au."character") AND (tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (r.ends_at <= now()))) x)
         ), kept_window AS MATERIALIZED (
          SELECT r.play,
             r.reach,
             r.target,
             r.ends_at,
             a.created_at AS started,
             to_jsonb(a.*) AS act,
             (a.payload ->> 'card'::text) AS card
            FROM (kept_reach r
              JOIN acts_public a ON ((a.id = r.play))),
             kept_span s
           WHERE ((a.created_at <= s.hi) AND (EXISTS ( SELECT 1
                    FROM posts p
                   WHERE ((a.created_at <= p.created_at) AND (p.created_at < r.ends_at) AND ((r.reach <> 'character'::text) OR (p."character" = r.target))))))
         ), kept AS MATERIALIZED (
          SELECT w.play,
             w.reach,
             w.target,
             w.ends_at,
             w.act
            FROM (kept_window w
              JOIN card_kinds ck ON (((ck.key = w.card) AND ck.keeps)))
           WHERE (NOT card_ended(w.play))
           ORDER BY w.started, w.play
          LIMIT 100
         ), played AS MATERIALIZED (
          SELECT o.id,
             o.kind,
             o."character",
             (o.payload ->> 'card'::text) AS card
            FROM on_posts o
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM above x
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM kept x
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (v.target_act_id) v.id,
             v.target_act_id AS post,
             v."character",
             v.created_at,
             v.payload
            FROM acts_public v
           WHERE ((v.kind = 'visit'::text) AND (v.target_act_id IN ( SELECT a.id
                    FROM page_acts a
                   WHERE (a.kind = ANY (ARRAY['post'::text, 'spin'::text]))
                 UNION ALL
                  SELECT n.id
                    FROM nested n)))
           ORDER BY v.target_act_id, v.created_at DESC, v.id DESC
         ), o_on AS MATERIALIZED (
          SELECT r.origin_act_id AS id
            FROM rng r
           WHERE ((r.origin_act_id IS NOT NULL) AND (EXISTS ( SELECT 1
                    FROM page_acts a
                   WHERE (a.id = r.first_act))))
         ), o_act AS MATERIALIZED (
          SELECT a.*
            FROM (o_on o
              JOIN acts_public a ON ((a.id = o.id)))
         ), o_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM (o_on o
              CROSS JOIN LATERAL post_play_ids(ARRAY[o.id]) x)
         ), o_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM o_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM o_ids i)) r(r)
         ), o_plays AS MATERIALIZED (
          SELECT a.*
            FROM acts_public a
           WHERE (EXISTS ( SELECT 1
                    FROM o_ids x)) AND (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM o_all o)))
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
         ), o_ends AS MATERIALIZED (
          SELECT e.*
            FROM acts_public e
           WHERE ((e.kind = 'card_end'::text) AND (e.target_act_id IN ( SELECT s.id
                    FROM o_shown s)))
         ), o_cast AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM o_act a
                 UNION
                  SELECT s."character"
                    FROM o_shown s
                 UNION
                  SELECT
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND ((a.payload ->> 'reach'::text) = 'character'::text)) THEN ((a.payload ->> 'character'::text))::uuid
                             ELSE NULL::uuid
                         END AS "character"
                    FROM o_act a) w
           WHERE (w.c IS NOT NULL)
         ), o_post AS MATERIALIZED (
          SELECT x.id
            FROM ( SELECT
                         CASE
                             WHEN post_kind(a.kind) THEN a.id
                             WHEN (a.kind = 'poll'::text) THEN a.target_act_id
                             WHEN (a.kind = 'ballot'::text) THEN ( SELECT q.target_act_id
                                FROM acts_public q
                               WHERE (q.id = a.target_act_id))
                             ELSE NULL::uuid
                         END AS id
                    FROM o_act a) x
           WHERE (x.id IS NOT NULL)
         ), pl_post AS MATERIALIZED (
          SELECT p.id
            FROM posts p
         UNION
          SELECT o.id
            FROM o_post o
         ), pl_cur AS MATERIALIZED (
          SELECT x.id AS post,
             l.id AS poll,
             l.created_at,
             ((l.payload ->> 'secret'::text))::boolean AS secret,
             to_jsonb(l.*) AS act
            FROM (pl_post x
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = 'poll'::text) AND (a.target_act_id = x.id))
                   ORDER BY a.created_at DESC, a.id DESC
                  LIMIT 1) l)
           WHERE (NOT (l.payload ? 'removed'::text))
         ), pl_polls AS MATERIALIZED (
          SELECT c.post,
             c.poll,
             c.created_at,
             c.secret,
             c.act,
             k.counts,
             k.voters,
             k.ends_at,
             k.closed,
             cl.j AS close,
             EXISTS (SELECT 1 FROM acts b WHERE b.kind = 'ballot'::text AND b.target_act_id = c.poll) AS balloted
            FROM ((pl_cur c
              CROSS JOIN LATERAL ( SELECT n.counts,
                     n.voters,
                     n.ends_at,
                     n.closed
                    FROM poll_counts n
                   WHERE (n.poll = c.poll)) k)
              LEFT JOIN LATERAL ( SELECT to_jsonb(e.*) AS j
                    FROM acts_public e
                   WHERE ((e.kind = 'poll_close'::text) AND (e.target_act_id = c.poll))
                  LIMIT 1) cl ON (true))
         ), pl_voters AS MATERIALIZED (
          SELECT p.post,
             p.poll,
             b.id AS act,
             b."character",
             (b.payload -> 'picks'::text) AS picks,
             b.created_at
            FROM ((pl_polls p
              CROSS JOIN LATERAL poll_voter_acts(p.poll, p.ends_at, 50) v(act))
              CROSS JOIN LATERAL ( SELECT x.id,
                     x."character",
                     x.payload,
                     x.created_at
                    FROM acts_public x
                   WHERE (x.id = v.act)) b)
           WHERE (NOT p.secret)
         ), pl_cast AS MATERIALIZED (
          SELECT DISTINCT v."character" AS c
            FROM pl_voters v
           WHERE (v."character" IS NOT NULL)
         ), pl_mine AS MATERIALIZED (
          SELECT m.act,
             m.poll,
             p.post,
             m."character",
             m.picks,
             m.created_at
            FROM (my_latest_ballots m
              JOIN pl_polls p ON ((p.poll = m.poll)))
           WHERE (m.created_at < p.ends_at)
         UNION ALL
          SELECT b.act,
             l.poll,
             p.post,
             l."character",
             b.picks,
             b.created_at
            FROM ((my_latest_ballots l
              JOIN pl_polls p ON ((p.poll = l.poll)))
              CROSS JOIN LATERAL ( SELECT m.act,
                     m.picks,
                     m.created_at
                    FROM my_ballots m
                   WHERE ((m.poll = l.poll) AND (m."character" = l."character") AND (m.created_at < p.ends_at))
                   ORDER BY m.created_at DESC, m.act DESC
                  LIMIT 1) b)
           WHERE (l.created_at >= p.ends_at)
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
         UNION
          SELECT a.id
            FROM o_act a
         UNION
          SELECT s.id
            FROM o_shown s
         UNION
          SELECT p.poll
            FROM pl_polls p
         ), who AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM page_acts a
                 UNION
                  SELECT n."character"
                    FROM nested n
                 UNION
                  SELECT p."character"
                    FROM played p
                 UNION
                  SELECT v."character"
                    FROM vis v) w
           WHERE (w.c IS NOT NULL)
         ), wanted_plays AS MATERIALIZED (
          SELECT p.id
            FROM played p
           WHERE (p.card = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         UNION
          SELECT s.id
            FROM o_shown s
           WHERE ((s.payload ->> 'card'::text) = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         ), heads AS MATERIALIZED (
          SELECT c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'locked_until', locked_out_until(c.id, thread_page.in_thread), 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                    FROM character_profiles p
                   WHERE (p."character" = c.id))) AS head
            FROM (( SELECT w.c
                    FROM who w
                 UNION
                  SELECT o.c
                    FROM o_cast o
                 UNION
                  SELECT v.c
                    FROM pl_cast v) k(id)
              CROSS JOIN LATERAL ( SELECT x.*
                    FROM characters_public x
                   WHERE (x.id = k.id)
                  OFFSET 0) c)
         ), spun AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             l.n
            FROM ( SELECT t.id,
                     t.board,
                     t.title,
                     t.origin_act_id,
                     t.created_at,
                     t.last_at,
                     t.last_seq,
                     t.replies,
                     t.first_act,
                     t.first_character,
                     t.last_act,
                     t.last_character,
                     t.replies_this_week,
                     t.origin_thread,
                     t.origin_place,
                     row_number() OVER (PARTITION BY t.origin_act_id ORDER BY t.created_at, t.id) AS n
                    FROM thread_list t
                   WHERE (t.origin_act_id IN ( SELECT i.id
                            FROM ids i))) l
           WHERE (l.n <= 200)
         ), rw AS MATERIALIZED (
          -- The live rewind plays of the page's posts (and the replies drawn under them) and of the ORIGIN post, from one set-based read (post_rewind_plays), as `on_ids` reads post_play_ids.
          SELECT r.post,
             r.play,
             r.played_at,
             rewind_view(r.play) AS view
            FROM post_rewind_plays(ARRAY( SELECT x.id
                    FROM ( SELECT p.id
                            FROM posts p
                         UNION
                          SELECT o.id
                            FROM o_on o) x)) r
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM rng))) THEN NULL::jsonb
             ELSE jsonb_build_object('summary', ( SELECT (to_jsonb(s.*) - 'last_page'::text)
                FROM s), 'page', ( SELECT rng.page
                FROM rng), 'acts', ( SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg((c.head || jsonb_build_object('posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id)))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM heads c
               WHERE (c.id IN ( SELECT w.c
                        FROM who w))), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                FROM ( SELECT to_jsonb(o.*) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                FROM post_kind_counts(ARRAY( SELECT p.id
                        FROM posts p)) k), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM above x), 'kept', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM kept x), 'under', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) ORDER BY ((n.act ->> 'seq'::text))::integer, n.id), '[]'::jsonb) AS "coalesce"
                FROM nested n), 'cut', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', ( SELECT pa.seq
                        FROM acts_public pa
                       WHERE (pa.id = d.parent))) ORDER BY d.seq), '[]'::jsonb) AS "coalesce"
                FROM drawn d
               WHERE (d.kind = 'post'::text)), 'visits', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('visit', v.id, 'post', v.post, 'mod', v."character", 'at', v.created_at, 'ends_at', (v.payload -> 'ends_at'::text), 'line', (v.payload -> 'line'::text), 'charges', ((v.payload -> 'charges'::text) || COALESCE(( SELECT jsonb_agg((j.payload -> 'charge'::text) ORDER BY j.created_at, j.id) AS jsonb_agg
                        FROM acts_public j
                       WHERE ((j.kind = 'visit_join'::text) AND (j.target_act_id = v.id))), '[]'::jsonb)), 'challenge', (jsonb_strip_nulls(jsonb_build_object('kind', (v.payload #>> '{challenge,kind}'::text[]), 'question_index', (v.payload #> '{challenge,question_index}'::text[]), 'price', (v.payload #> '{challenge,price}'::text[]))) || COALESCE(visit_quiz(v.id), '{}'::jsonb)), 'end', ( SELECT jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', (e.payload ->> 'outcome'::text), 'by_act', (e.payload -> 'by_act'::text), 'line', (e.payload -> 'line'::text)) AS jsonb_build_object
                        FROM acts_public e
                       WHERE ((e.kind = 'visit_end'::text) AND (e.target_act_id = v.id))
                      LIMIT 1), 'ruling', ( SELECT (r.payload ->> 'verdict'::text)
                        FROM ((acts_public i
                          JOIN acts_public ap ON (((ap.kind = 'appeal'::text) AND (ap.target_act_id = i.id))))
                          JOIN acts_public r ON (((r.kind = 'appeal_ruling'::text) AND (r.target_act_id = ap.id))))
                       WHERE ((i.kind = 'infraction'::text) AND ((i.payload ->> 'visit_act'::text) = (v.id)::text))
                      LIMIT 1)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
                FROM vis v), 'faces', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb) AS "coalesce"
                FROM my_face_down f
               WHERE (f.play IN ( SELECT p.id
                        FROM played p
                       WHERE (p.kind = 'set'::text)))), 'veiled', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', v.post, 'character', v."character", 'play', v.play, 'ends_at', v.ends_at) ORDER BY v.post), '[]'::jsonb) AS "coalesce"
                FROM my_veiled_posts v
               WHERE (v.post IN ( SELECT p.id
                        FROM posts p))), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb) AS "coalesce"
                FROM effect_state e
               WHERE (e.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'releases', ( SELECT COALESCE(jsonb_agg(r.play), '[]'::jsonb) AS "coalesce"
                FROM effect_releases r
               WHERE (r.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'spent', ( SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM (on_posts o
                  JOIN card_kinds ck ON (((ck.key = (o.payload ->> 'card'::text)) AND ((ck.discipline ->> 'kind'::text) = 'fall'::text))))
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
                FROM surfaces sf
               WHERE (sf.play IN ( SELECT o.id
                        FROM on_posts o
                       WHERE (o.kind = 'card'::text)))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
                FROM reaction_tallies t
               WHERE (t.act IN ( SELECT i.id
                        FROM ids i))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")), '[]'::jsonb) AS "coalesce"
                FROM my_reactions m
               WHERE (m.act IN ( SELECT i.id
                        FROM ids i))), 'polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                FROM pl_voters v), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p
               WHERE ((NOT p.secret) AND (p.voters > 50))), 'voterCast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                FROM heads h
               WHERE (h.id IN ( SELECT v.c
                        FROM pl_cast v))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                FROM pl_mine m), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
                FROM spun l), 'reading', ( SELECT r.furthest_seq
                FROM reading r
               WHERE (r.thread = thread_page.in_thread)
              LIMIT 1), 'board', ( SELECT jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act) AS jsonb_build_object
                FROM boards_now b
               WHERE (b.id = ( SELECT rng.board
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread(), 'rewinds', ( SELECT COALESCE(jsonb_agg(w.view ORDER BY w.played_at DESC, w.play DESC), '[]'::jsonb) AS "coalesce"
                FROM rw w
               WHERE (w.view IS NOT NULL))) ||
             CASE
                 WHEN (EXISTS ( SELECT 1
                    FROM o_on)) THEN jsonb_build_object('origin', jsonb_build_object('act', ( SELECT to_jsonb(a.*) AS to_jsonb
                        FROM o_act a), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.grp, x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                        FROM ( SELECT to_jsonb(s.*) AS j,
                                 0 AS grp,
                                 s.created_at,
                                 s.id
                                FROM o_shown s
                             UNION ALL
                              SELECT to_jsonb(e.*) AS to_jsonb,
                                 1,
                                 e.created_at,
                                 e.id
                                FROM o_ends e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                        FROM post_kind_counts(ARRAY( SELECT o.id
                                FROM o_on o)) k), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
                        FROM ( SELECT
                                 CASE
                                     WHEN ((r.origin_place ->> 'kind'::text) = 'play'::text) THEN COALESCE(NULLIF((r.origin_place -> 'at'::text), 'null'::jsonb),
                                     CASE
                                         WHEN ((r.origin_place #>> '{on,kind}'::text[]) = 'post'::text) THEN (r.origin_place -> 'on'::text)
                                         ELSE NULLIF((r.origin_place -> 'from'::text), 'null'::jsonb)
                                     END)
                                     WHEN ((r.origin_place ->> 'kind'::text) = ANY (ARRAY['poll'::text, 'ballot'::text])) THEN (r.origin_place -> 'on'::text)
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o
                             UNION
                              SELECT v."character"
                                FROM pl_voters v
                               WHERE ((v.post IN ( SELECT op.id
                                        FROM o_post op)) AND (EXISTS ( SELECT 1
                                        FROM o_act a
                                       WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text]))))))))) ||
                     CASE
                         WHEN (EXISTS ( SELECT 1
                            FROM o_act a
                           WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text])))) THEN jsonb_build_object('polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE (p.post IN ( SELECT op.id
                                    FROM o_post op))), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                            FROM pl_voters v
                           WHERE (v.post IN ( SELECT op.id
                                    FROM o_post op))), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE ((NOT p.secret) AND (p.voters > 50) AND (p.post IN ( SELECT op.id
                                    FROM o_post op)))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                            FROM pl_mine m
                           WHERE (m.post IN ( SELECT op.id
                                    FROM o_post op))))
                         ELSE '{}'::jsonb
                     END)
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;

-- ---- 15. face_down_never_writes, face_down_never_replies ----

-- The server's words agree with the engine's (engine/rules/cards.ts, decideSet): a card that can only be played face up is refused a back with "played", the copy rule's verb. face_down_never_writes is copied whole from 0405_cut.sql
-- and face_down_never_replies from 0348_post_under.sql (each the latest definition), with that one word changed. Their triggers and grants are as they were (replaced in place).
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
    raise exception '% writes, so it is played face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.discipline is not null then
    raise exception '% acts the moment it lands, so it is played face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.cuts is not null then
    raise exception '% is played face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.draws is not null or k.drive is not null or k.needs_message is not null or k.surface then
    raise exception '% is played face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return new;
end $function$;

create or replace function face_down_never_replies() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from card_kinds k where k.key = new.card and k.replies) then
    raise exception '% carries a reply, so it is played face up and never set face down', (select k.name from card_kinds k where k.key = new.card)
      using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return new;
end $$;

