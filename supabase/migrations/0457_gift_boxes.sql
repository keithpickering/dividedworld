-- A card wrapped in another, in the database (docs/plans/2026-11-27-season-two-cards-plan.md, Task 5; design docs/plans/2026-11-27-season-two-cards-design.md, sections 1.4, 6 and 9).
-- A card whose rules say `wraps` is cast face up on a post with a second card from the caster's hand, the gift, and the caster's configuration of it. The gift is private until the post's author opens the box (`open_gift`), when it lands on the post as a
-- play of the giver's character through the post's own checks, or goes back to the giver's hand with the refusal's words. Each object here is copied whole from its latest definition on main (found across the migrations, not only the plan's files), with only the change named.
--
--   1. card_kinds.wraps         boolean not null default false.
--   2. card_kinds_problem       copied whole from 0413_rewind.sql: a card that wraps is a cast card, one to a post (stack 1), with no time up, reaching a post alone (engine/rules/instance.ts, wrapsProblems; the engine's words).
--   3. gift_box                 the gift's private row, as face_down is (0054): read by the giver's account alone, never edited (ledger_append_only triggers), row security so an account reads its own rows. An opened or ended box is told by its open_gift or card_end Act.
--   4. the open_gift Act        acts_kind_check and acts_seq_check (0395's lists) gain the kind; acts_take_seq (0395), play_post_on_act (0408, and its trigger's kinds), card_ended (0405), play_row (0434) and post_plays (0410) read an open as the box's end.
--                               The admin-ended feeds (my_cards_ended, admin_queue, log_page) keep reading `card_end` alone: an open is no admin's end, as the fake's reads keep it.
--   5. seed_instance            copied whole from 0454_final_clears.sql: `wraps` joins the card insert from the seed's `wraps`.
--   6. place_cast, play_card    copied whole from 0454_final_clears.sql and 0438_board_cards_on_their_board.sql (the old signatures are dropped; the new ones add trailing defaults, so every caller works as it did). See the section's own comment.
--   7. open_gift                new: security definer, the service role's (as play_card is) for the account the Edge Function names.
--   8. reverse_card             copied whole from 0423_rulings_alerts.sql: an unopened present an admin ends gives its gift back to the giver (a `returned` ledger row naming the end); an opened one is refused in plain words.
--   9. self_kinds, act_self_characters   copied whole from 0455_live_lists_and_self.sql: `open_gift` pokes the opener and the giver's character's owner, the box's own character, whose hand changes on a return.
--  9b. the veil's cover  post_veils_cover and acts_veil_cover, copied whole from 0395_polls.sql: an open is the post's author's Act on the box, whose target is the box and not the post, so the author veil's cover reads it through its box to the post (as a draw or a wash is read through its card), live and, for an open written before the veil landed, at the cast.
--  10. the "still up" readers  play_moment (0375), spin_moment (0368), search_post_cards (0117), kind_plays (0410), thread_page (0456) and pool_thread (0420), each copied whole: an open is the box's end for them. lockout_ends is unchanged (a lockout is a spring; a box is no spring).
--
-- Owner decisions built here (and in the fake, engine/ui/data/fake.ts, which mirrors them):
--   (a) #1264: the gift lands at the open on the post's own checks alone (the post's slots, its stack, its wards, a rewind and the gift's own landing rules), whatever has happened to the giver since: no ban of the caster, no lockout (place_cast skips not_locked_out
--       when its marker names an open), no hand and no wallet (the gift was paid for and held at the wrap).
--   (b) #1270: a present is refused, in plain words, on a post whose character no account owns (a staff character's, a Mod Bot's): nobody could open it. A present on the giver's own post is allowed.
--   (c) giftProblem's refusal of a gift that needs words of its own (a message, a reply, a surface) holds in the server too, and so does its refusal of a card that writes (an open buys no write tokens and meets no old voice, so the job would only refund).
-- Carried findings: the box's slot is freed before the gift is tried (the open Act is written first, in a block of its own; the kept play_post row reads it at once), so a one-slot post takes an effect-drawing gift from an effect-drawing box; the wrap writes a card-ledger
-- row for the gift card of its own (the box's row carries the box's price alone, the gift's the gift's extra price); a gift a trap catches at the open counts as landed (did `landed`, the gift's own Act carries `caught`).
--
-- The price: `play_card`'s `price` is the box's plus the gift's play price on the target as the caller computed it, checked as any play price is (0 to the wallet's cap), and `gift_price` is the gift's part of it. The gift's configuration is checked by the
-- Edge Function with the gift's own rules (as every card's is); the database holds it to 4 KB. A box a trap catches at the wrap holds nothing: the gift stays in the hand and only the box's price is charged.
-- Locks, in one order everywhere: the caster's (opener's) account, then the post's row, then the box's Act row, then its gift_box row. reverse_card takes the box's Act row and then its gift_box row, the same way round; a card ledger insert takes no stronger lock on an
-- account than the `for no key update` the callers hold.
-- Ways out: an unopened present waits for its author, who opens it at any time, or for an admin, who ends it and hands the gift back; a gift that cannot land goes back to its giver at once, with the reason in the open Act. Masks: the box's Act, its payload and every
-- read another account can make hold no gift key, configuration or price (gift_box and the ledger are the giver's alone); open_gift's refusal to anyone but the author is computed from the caller's own characters and answers in the same time.
-- Cost at a busy instance's scale: a box adds one gift_box row and a ledger row for the gift; an open adds two Acts at most and the landing's own reads; nothing here grows with players, characters or Acts.

-- ---- 1. card_kinds.wraps ----

alter table card_kinds add column wraps boolean not null default false;

-- ---- 2. card_kinds_problem ----

-- Copied whole from 0413_rewind.sql, its latest definition; the wraps sentences are added at the end, each in the engine's words (engine/rules/instance.ts, wrapsProblems). Its grants are as they were (replaced in place).
CREATE OR REPLACE FUNCTION public.card_kinds_problem(cards jsonb)
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
    -- engine/rules/instance.ts, wrapsProblems (the season two design, section 1.4): a card that wraps another is a cast card, one to a post, with no time up, reaching a post alone. The seed sends `wraps: false` for every other card, which reads as left out.
    union all
    select c.key, 900, format('card "%s" wraps %s; wraps is true or left out', c.key, compact_json(c.e -> 'wraps')) from c
    where coalesce(c.e -> 'wraps', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, 'true'::jsonb)
    union all
    select c.key, 901, format('card "%s" wraps a card, and a present is a cast card', c.key) from c
    where coalesce(c.e -> 'wraps', 'null'::jsonb) = 'true'::jsonb and c.play <> 'cast'
    union all
    select c.key, 902, format('card "%s" wraps a card, and a present stacks at most 1', c.key) from c
    where coalesce(c.e -> 'wraps', 'null'::jsonb) = 'true'::jsonb and coalesce(c.e -> 'stack', 'null'::jsonb) not in ('null'::jsonb, '1'::jsonb)
    union all
    select c.key, 903, format('card "%s" wraps a card, and a present has no time up: nothing returns the gift from a box that wears off', c.key) from c
    where coalesce(c.e -> 'wraps', 'null'::jsonb) = 'true'::jsonb and coalesce(c.e -> 'lasts', 'null'::jsonb) <> 'null'::jsonb
    union all
    select c.key, 904, format('card "%s" wraps a card, and a card that wraps reaches a post alone', c.key) from c
    where coalesce(c.e -> 'wraps', 'null'::jsonb) = 'true'::jsonb and coalesce(c.e -> 'reaches', '["post"]'::jsonb) is distinct from '["post"]'::jsonb
  ) p where why is not null
$function$;

-- ---- 3. gift_box ----

-- What an unopened present holds, as `face_down` holds a back: read by the giver's account alone, never edited. The box is the play's Act (the Act holds no gift key, configuration or price); `paid` is the gift's own extra price, charged at the wrap and
-- written again nowhere. An opened box is told by its `open_gift` Act and an ended one by its `card_end`, so the row is the record of what was wrapped, kept as it was.
create table gift_box (
  box uuid primary key references acts(id),
  account uuid not null references accounts(id),
  card text not null references card_kinds(key),
  config jsonb not null default '{}'::jsonb,
  paid bigint not null check (paid >= 0),
  at timestamptz not null default now()
);
create index gift_box_account on gift_box (account);
create trigger gift_box_no_update before update or delete on gift_box for each row execute function ledger_append_only();
create trigger gift_box_no_truncate before truncate on gift_box for each statement execute function ledger_append_only();
alter table gift_box enable always trigger gift_box_no_update;
alter table gift_box enable always trigger gift_box_no_truncate;
alter table gift_box enable row level security;
revoke all on gift_box from public, anon, authenticated;
grant select on gift_box to authenticated;
create policy own on gift_box for select to authenticated using (account = auth.uid());

-- ---- 4. the open_gift Act ----

-- The kind joins the Act kinds as `spring` was: no seq (acts_seq_check, acts_take_seq), a character (the post's author, who opens), a target (the box).
alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close', 'open_gift'));
alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal',
  'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close', 'open_gift'));
-- acts_take_seq, copied whole from its latest definition (0395_polls.sql): `open_gift` takes no seq.
CREATE OR REPLACE FUNCTION public.acts_take_seq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close', 'open_gift') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $function$;

-- play_post_on_act, copied whole from 0408_play_post.sql (no later migration redefines it): an open of a box ends the box's play as an admin's end does, so the kept row reads it as over.
CREATE OR REPLACE FUNCTION public.play_post_on_act()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.kind in ('card', 'set') then
    -- The play itself (a card whose kind has a drive also refreshes the drive's other plays, inside refresh_play_post).
    if new.target_act_id is not null then perform refresh_play_post(new.id); end if;
    -- The pierce this card spent.
    if new.kind = 'card' and new.payload ? 'pierce' then perform refresh_play_post((new.payload #>> '{pierce,by}')::uuid); end if;
    -- The Gimmick this card cut.
    if new.kind = 'card' and new.payload ? 'cut' then perform refresh_play_post((new.payload #>> '{cut,play}')::uuid); end if;
  elsif new.kind in ('card_end', 'open_gift') then
    -- The play the admin ended (or the box its author opened), and what it cut: an admin's end of a cutting play brings the cut play back.
    perform refresh_play_post(new.target_act_id);
    -- A lockout's spring an admin ended: the back it names holds no lockout now (lock_until).
    perform refresh_play_post((t2.payload ->> 'set')::uuid) from acts t2 where t2.id = new.target_act_id and t2.kind = 'spring';
    perform refresh_play_post((t.payload #>> '{cut,play}')::uuid) from acts t where t.id = new.target_act_id and t.kind = 'card' and t.payload ? 'cut';
  else
    -- A spring and a take-back: the back they name.
    perform refresh_play_post((new.payload ->> 'set')::uuid);
  end if;
  return null;
end $function$;

drop trigger play_post_on_act on acts;
create trigger play_post_on_act after insert on acts for each row when (new.kind in ('card', 'set', 'card_end', 'spring', 'take_back', 'open_gift')) execute function play_post_on_act();

-- card_ended, copied whole from 0405_cut.sql: a box its author opened is over, as one an admin ended is. Every reader of "in force" asks this, so the slot, the stack, a drive and a ward all read the open at once.
CREATE OR REPLACE FUNCTION public.card_ended(play uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from acts e where e.kind in ('card_end', 'open_gift') and e.target_act_id = card_ended.play)
      or exists (select 1 from card_write_refunds r where r.play = card_ended.play)
      or exists (select 1 from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = card_ended.play::text)
      or card_cut_at(card_ended.play) is not null
$function$;

-- play_row, copied whole from 0434_reads_bounded_on_any_plan.sql: a card play's `over_at` is the time of the first of its end Acts, an open of a box included, so play_post (and post_effects_up, which counts a post's slots from it) frees the box's slot at the open.
CREATE OR REPLACE FUNCTION public.play_row(play uuid)
 RETURNS play_post
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET enable_seqscan TO 'off'
AS $function$
declare
  r play_post;
begin
    select a.id, a.target_act_id,
           case when a.kind = 'card' then coalesce(a.payload ->> 'card', '') else '' end,
           case when a.kind = 'card' then coalesce(a.payload ->> 'reach', 'post') else 'post' end,
           a.created_at,
           case when a.kind = 'set' then coalesce((ls.payload ->> 'until')::timestamptz, f.ends_at)
                else least((a.payload ->> 'ends')::timestamptz, pr.ends_at,
                           case when ck.drive is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and not (a.payload ? 'caught') then
                             (select coalesce(max(k.created_at) filter (where not card_ended(k.id)), max(k.created_at)) from acts k
                              where k.kind = 'card' and k.target_act_id = a.target_act_id and k.payload ->> 'card' = a.payload ->> 'card' and not (k.payload ? 'caught')
                                and coalesce(k.payload ->> 'reach', 'post') = 'post' and coalesce(k.payload ->> 'drive', k.id::text) = coalesce(a.payload ->> 'drive', a.id::text))
                             + span_interval(ck.drive -> 'lasts') end) end,
           case when a.kind = 'set' and ls.id is not null then
                  (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = ls.id)
                when a.kind = 'set' then
                  least((select min(s.created_at) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
                        (select min(tb.created_at) from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = a.id::text))
                else
                  least(case when a.payload ? 'caught' or a.payload ? 'instant' then a.created_at end,
                        (select min(e.created_at) from acts e where e.kind in ('card_end', 'open_gift') and e.target_act_id = a.id),
                        rf.at,
                        (select min(c.created_at) from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = a.id::text),
                        card_cut_at(a.id)) end,
           rf.play is null,
           a.kind = 'set' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
           coalesce((select sum(t.count) from reaction_tallies t where t.act = a.id), 0)::integer + (select count(*) from threads th where th.origin_act_id = a.id)::integer,
           case when a.kind = 'set' then (select min((s.payload ->> 'until')::timestamptz) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                                                                     and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = s.id)) end
    into r
    from acts a
    left join face_down f on f.play = a.id and a.kind = 'set'
    left join lateral (select s.id, s.payload from acts s where a.kind = 'set' and s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                        order by s.created_at, s.id limit 1) ls on true
    left join play_reach pr on pr.play = a.id and a.kind = 'card'
    left join card_write_refunds rf on rf.play = a.id and a.kind = 'card'
    left join card_kinds ck on ck.key = a.payload ->> 'card' and a.kind = 'card'
    where a.id = play_row.play and a.kind in ('card', 'set') and a.target_act_id is not null;
  return r;
end $function$;

-- post_plays, copied whole from 0410_post_plays.sql: a play's ends are its card_end and, for a box, its open_gift, which the page's plays reader reads as the box's end. The admin-ended feeds (my_cards_ended, admin_queue, log_page) are left as they were: an open is no admin's end.
CREATE OR REPLACE FUNCTION public.post_plays(posts uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
begin
  if cardinality(post_plays.posts) > 200 then raise exception 'ask for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return (
    with ids as materialized (
      select x.post, x.play from post_play_ids(post_plays.posts) x
    ), plays as materialized (
      select a.* from acts_public a where a.kind in ('card', 'set') and a.id = any (array(select i.play from ids i))
    ), riders as materialized (
      select a.* from acts_public a where a.kind in ('spring', 'take_back') and a.id = any (array(select r from play_rider_ids(array(select i.play from ids i)) r))
    ), ends as materialized (
      select a.* from acts_public a where a.kind in ('card_end', 'open_gift') and a.target_act_id in (select p.id from plays p union all select r.id from riders r)
    )
    select jsonb_build_object(
      'plays', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from (select * from plays union all select * from riders union all select * from ends) x), '[]'::jsonb),
      'counts', coalesce((select jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) order by k.post, k.card nulls first) from post_kind_counts(post_plays.posts) k), '[]'::jsonb))
  );
end $function$;

-- ---- 5. seed_instance ----

-- Copied whole from 0454_final_clears.sql, its latest definition: `wraps` joins the card insert's columns, values and on-conflict update from the seed's `wraps`. Grants as they were.
CREATE OR REPLACE FUNCTION public.seed_instance(payload jsonb)
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
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface, from_seed, cuts, draws_effect, rewind, event_only, clears_for_good, wraps)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false), true, nullif(e -> 'cuts', 'null'), coalesce((e ->> 'drawsEffect')::boolean, false), e #>> '{rewind,upTo}', coalesce((e ->> 'eventOnly')::boolean, false), coalesce((e ->> 'clearsForGood')::boolean, false), coalesce((e ->> 'wraps')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface, from_seed = true, cuts = excluded.cuts, draws_effect = excluded.draws_effect, rewind = excluded.rewind, event_only = excluded.event_only, clears_for_good = excluded.clears_for_good, wraps = excluded.wraps;
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
    insert into gear_kinds (key, rarity, event_only) select e ->> 'key', e ->> 'rarity', coalesce((e ->> 'eventOnly')::boolean, false) from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity, event_only = excluded.event_only;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text, rarity, item) select e ->> 'key', e ->> 'outcome', e ->> 'text', coalesce(e ->> 'rarity', 'common'), nullif(e ->> 'item', '') from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text, rarity = excluded.rarity, item = excluded.item;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
    -- A line that names an item names one the instance holds, of the kind its outcome gives, and is at least as rare as it (the design, sections 1 and 2), naming the first such line.
    select format('the event line "%s" names %s "%s", which the instance does not hold', l.key, case l.outcome when 'gear' then 'gear' else 'a card' end, l.item) into unknown
    from event_lines l left join gear_kinds g on l.outcome = 'gear' and g.key = l.item left join card_kinds ck on l.outcome = 'card' and ck.key = l.item
    where l.item is not null and case l.outcome when 'gear' then g.key is null else ck.key is null end
    order by l.key limit 1;
    if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
    select format('the event line "%s" is %s but the %s it names, "%s", is %s: an event is at least as rare as its item', l.key, l.rarity, case l.outcome when 'gear' then 'gear' else 'card' end, l.item, coalesce(g.rarity, ck.rarity)) into unknown
    from event_lines l left join gear_kinds g on l.outcome = 'gear' and g.key = l.item left join card_kinds ck on l.outcome = 'card' and ck.key = l.item
    where l.item is not null
      and array_position(array['common', 'uncommon', 'rare', 'legendary'], l.rarity) < array_position(array['common', 'uncommon', 'rare', 'legendary'], coalesce(g.rarity, ck.rarity))
    order by l.key limit 1;
    if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
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
  -- A persona's stock concessions (the concession post's design): its lines, kept where no client can read them. The seed's list is the persona's whole set, so a reseed replaces what an earlier seed wrote,
  -- for every persona the seed lists (one that lists none ends with none).
  delete from staff_concessions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into staff_concessions (staff, idx, line)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.l #>> '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'concessions') = 'array' then e -> 'concessions' else '[]'::jsonb end) with ordinality x(l, n);
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
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p,
                   jsonb_array_elements(coalesce(p -> 'arc', '[]') || coalesce(p -> 'aftermath', '[]')) b,
                   jsonb_array_elements(coalesce(b -> 'unlock', '[]') || case when jsonb_typeof(b #> '{leadIn,unlock}') = 'array' then b #> '{leadIn,unlock}' else '[]'::jsonb end) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  -- `lead_ins` is {beat key: the lead-in's unlock} of the arc's beats that have one, and `aftermath` the persona's aftermath beats as the arc's are kept (key, mini, unlock, and a lead-in's unlock): never a brief or a mood.
  insert into persona_arcs (staff, beats, holds_back, phase_days, lead_ins, aftermath)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}'),
         (select coalesce(jsonb_object_agg(b.value ->> 'key', b.value #> '{leadIn,unlock}'), '{}'::jsonb)
          from jsonb_array_elements(coalesce(e -> 'arc', '[]')) b where jsonb_typeof(b.value #> '{leadIn,unlock}') = 'array'),
         (select coalesce(jsonb_agg(jsonb_build_object('key', a.value -> 'key', 'mini', coalesce(a.value -> 'mini', 'true'::jsonb), 'repeatable', false, 'unlock', coalesce(a.value -> 'unlock', '[]'::jsonb))
                                    || case when jsonb_typeof(a.value #> '{leadIn,unlock}') = 'array' then jsonb_build_object('leadIn', jsonb_build_object('unlock', a.value #> '{leadIn,unlock}')) else '{}'::jsonb end
                                    order by a.ord), '[]'::jsonb)
          from jsonb_array_elements(coalesce(e -> 'aftermath', '[]')) with ordinality a(value, ord))
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

-- ---- 6. place_cast and play_card ----

-- place_cast, copied whole from 0454_final_clears.sql, its latest definition (the old signature is dropped, since the new one adds trailing defaults). It gains `gift_card`, `gift_config`, `gift_price` and `as_id`:
--   * a wrapper without a gift, a gift on any other card, a gift that is no card, a wrapper, not a Move on a post, a card that needs words of its own or one that writes are refused in plain words (giftProblem's, engine/rules/cards.ts);
--   * a present on a post no account owns is refused in plain words (owner decision, #1270); the giver's own post is allowed;
--   * `gift_box` is written beside the box's Act, once, when the box lands;
--   * `as_id` names the Act's id ahead (open_gift writes the open Act, which names the gift, before the gift is tried);
--   * a landing that names an open in its marker asks the post's own checks alone: no lockout of the caster (owner decision, #1264). It never asked a ban, a hand or a wallet.
drop function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb DEFAULT '{}'::jsonb, in_board_thread uuid DEFAULT NULL::uuid, gift_card text DEFAULT NULL::text, gift_config jsonb DEFAULT NULL::jsonb, gift_price integer DEFAULT 0, as_id uuid DEFAULT NULL::uuid)
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
  written uuid := coalesce(place_cast.as_id, gen_random_uuid());
  gift_kind card_kinds%rowtype;
  -- A gift's landing at an open names the open in its marker: it is the post's own checks alone, whatever has happened to its giver since.
  opening boolean := coalesce(place_cast.marker ? 'opened', false);
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
  -- A card wrapped in another (design 1.4): a wrapper carries a gift and no other card does; the gift is one a present may hold, in giftProblem's words (engine/rules/cards.ts). The gift's own configuration is the Edge Function's to read with the card's rules,
  -- as every card's is; the hand's check and the price are play_card's. Left in the order the fake answers them.
  if kind_of.wraps and gift_card is null then raise exception '% holds a card: choose the card to wrap in it', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not kind_of.wraps and gift_card is not null then raise exception 'only a present holds a card, and % is not one', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if gift_card is not null then
    if reach is distinct from 'post' then raise exception 'a present is left on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    select * into gift_kind from card_kinds k where k.key = gift_card;
    if gift_kind.key is null then raise exception 'there is no card "%"', gift_card using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
    if gift_kind.wraps then raise exception 'a present can''t hold another present' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if gift_kind.play <> 'cast' or not ('post' = any (gift_kind.reaches)) then raise exception 'a present holds a Move that is cast on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if gift_kind.needs_message is not null or gift_kind.replies or gift_kind.surface then raise exception 'a present can''t hold a card that needs words of its own' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if gift_kind.writes then raise exception 'a present can''t hold a card that writes' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if octet_length(coalesce(gift_config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
    if payer is null then raise exception 'a staff character''s card holds no gift' using errcode = '22023'; end if;
  end if;
  -- The gift's own extra price is part of the price the caller computed, and nothing else is.
  if coalesce(gift_price, 0) < 0 or (gift_card is null and coalesce(gift_price, 0) <> 0) or coalesce(gift_price, 0) > coalesce(price, 0) then
    raise exception 'a gift''s price is between 0 and what the play costs' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
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
    -- Only a post's author opens its box, so a post no account owns (a staff character's) is turned away at the wrap, in the same words for every caster: who is on staff is public. The giver's own post is allowed.
    if gift_card is not null and not exists (select 1 from characters c where c.id = author and c.owner is not null) then
      raise exception 'a present is left on a player''s post, since only its author can open it' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    -- A character locked out of the post's thread plays nothing there. Asked here, before the ward, the back or anything written, so the Move that springs a lockout is not refused by the lockout it springs: the spring is
    -- written below, after this, and nothing after it asks again. It reads the public spring alone, so the same words come whoever owns the caster.
    if not opening then perform not_locked_out(caster, in_thread); end if;
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
    -- A card that clears for good holds no place in its stack once its author has cleared it for every version of the post (effect_cleared with no version; the layer still counts it, so none is taken twice).
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)
                             and not (kind_of.clears_for_good and effect_cleared(k.id, null))),
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
      -- The card is written in a thread on the board it lands on, the one the caster named: a thread's place is public, and so are the words, the same for every caller. A board with no thread at all is told to start one;
      -- a thread of another board, one that does not exist and none named are told to pick one. The caster is held to the thread's lockout as for any play in it.
      if in_board_thread is null or not exists (select 1 from threads t where t.id = in_board_thread and t.board = target) then
        if not exists (select 1 from threads t where t.board = target) then
          raise exception 'start a thread on % first', target_name using hint = 'kayfabb.refusal', errcode = '22023';
        end if;
        raise exception 'pick a thread on % to play it in', target_name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      in_thread := in_board_thread;
      perform not_locked_out(caster, in_thread);
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
  -- What a wrapped card is, kept for its giver alone (gift_box): written beside the box's Act once, when the box landed (a box a trap caught holds nothing, and the gift stays in the hand).
  if gift_card is not null and lands then
    insert into gift_box (box, account, card, config, paid) values (written, payer, gift_card, coalesce(gift_config, '{}'::jsonb), coalesce(gift_price, 0));
  end if;
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
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb, uuid, text, jsonb, integer, uuid) from public, anon, authenticated;

-- play_card, copied whole from 0438_board_cards_on_their_board.sql, its latest definition (the old signature is dropped). It gains `gift_card`, `gift_config` and `gift_price`: the giver holds the wrapped card too; `price` is the box's plus the gift's extra price
-- as the caller computed it (checked as any play price is: between 0 and the wallet's cap), and `gift_price` is the part of it that is the gift's; the box's ledger row carries the box's own price and the gift's has its own, so neither hints at the other.
drop function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[], uuid);
CREATE OR REPLACE FUNCTION public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid, version uuid DEFAULT NULL::uuid, tokens integer DEFAULT NULL::integer, reply text DEFAULT NULL::text, framing uuid[] DEFAULT '{}'::uuid[], in_board_thread uuid DEFAULT NULL::uuid, gift_card text DEFAULT NULL::text, gift_config jsonb DEFAULT NULL::jsonb, gift_price integer DEFAULT 0)
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
  carries boolean := coalesce((select k.replies from card_kinds k where k.key = play_card.card), false);
  reply_id uuid;
  in_thread uuid;
  under jsonb;
  caught boolean;
begin
  if version is not null and reach = 'post' then
    perform 1 from accounts where id = who for no key update;
    perform 1 from acts a where a.id = target and post_kind(a.kind) for no key update;
    if found and post_version(target) is distinct from version then
      raise exception 'the post was edited; look again' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A kind that replies carries a reply with a word in it, within the length a post takes, and lands on a post; any other kind is given none.
  if carries then
    if reply is null or reply !~ phrase_word_class() then raise exception 'write the reply this card carries' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    perform within('body', reply, 'postMaxLength');
    if reach <> 'post' then raise exception 'this card lands on %', reach_list('{post}') using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    reply_id := gen_random_uuid();
  elsif reply is not null then
    raise exception 'only a card that carries a reply takes one' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform require_old_voice(card);
  perform require_write_tokens(card, tokens);
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  held := card_held(who, play_card.card);
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  -- A play that also posts takes the locks of a post that quotes the parent, in post()'s order and before its card is inserted (the header's lock order): the parent's row (2),
  -- then its live backs, the thread and the count rows (lock_for_quote, 2b to 5). A target that is no post is place_cast's to refuse.
  if carries then
    select a.thread into in_thread from acts a where a.id = target and post_kind(a.kind) for no key update;
    if in_thread is not null then perform lock_for_quote(through, in_thread, target); end if;
  end if;
  played := place_cast(through, card, target, config, said, reach, from_post, who, price,
    (case when tokens is null then '{}'::jsonb else jsonb_build_object('tokens', tokens) end)
    || (case when carries then jsonb_build_object('reply', reply_id) else '{}'::jsonb end), in_board_thread, gift_card, gift_config, coalesce(gift_price, 0));
  written := (played ->> 'id')::uuid;
  -- A box a trap caught holds nothing: the gift stays in the hand and is not charged.
  caught := played -> 'payload' ? 'caught';
  -- A wrapped card is held too (the same hand, the same account lock): the giver pays for both cards and the gift's own price on this post, all at the wrap. Asked after place_cast's refusals of the gift itself, as the fake answers them; a refusal here undoes the box with the rest of the transaction.
  if gift_card is not null and card_held(who, gift_card) < 1 then raise exception 'you hold no "%" card to wrap; the Vending Machine sells them', gift_card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  -- A cast that landed (a ride lets it) writes its reply and the row that draws it under the parent; a caught one writes none, and the id its Act names is no post's.
  if carries and not (played -> 'payload' ? 'caught') then
    perform write_reply(through, in_thread, reply, framing, reply_id);
    insert into post_under (play, parent, reply, thread) values (written, target, reply_id, in_thread);
    under := jsonb_build_object('parent', target, 'play', written, 'act', act_projection(reply_id));
  end if;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price - case when caught then coalesce(gift_price, 0) else 0 end, 'play', written);
  -- The box's row carries the box's own price; the wrapped card has a row of its own beside it, at the extra price it costs on this post.
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price - coalesce(gift_price, 0));
  if gift_card is not null and not caught then
    insert into card_ledger (account, card, kind, act, price) values (who, gift_card, 'played', written, coalesce(gift_price, 0));
  end if;
  return played || case when under is not null then jsonb_build_object('under', under) else '{}'::jsonb end;
end $function$;
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[], uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[], uuid, text, jsonb, integer) to service_role;

-- ---- 7. open_gift ----

-- The post's author opens a box. Locks in the order the header's lists state: the opener's account, then the post, then the box's Act and its gift_box row (reverse_card takes the box's Act and then its row, the same way round).
-- The open Act is written first, naming the gift's id ahead, inside a block of its own, so the box's slot is free (play_row, post_effects_up) when the gift is tried; then the gift is landed through place_cast as a cast by the giver's character, at no price,
-- with the open in its marker. A landing refused in a game refusal rolls the block back, open Act and all, and the open is written again as `returned` with the refusal's words, and the card goes back to the giver's hand (a `returned` ledger row, as a refund
-- outcome writes). Anything else is no refusal and is raised. Nothing is edited: the open Act is written once, with its outcome.
create function open_gift(who uuid, box uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b acts%rowtype;
  post_character uuid;
  held gift_box%rowtype;
  open_id uuid;
  gift_id uuid := gen_random_uuid();
  landed jsonb;
  said text;
  hint text;
begin
  select a.* into b from acts a
  where a.id = open_gift.box and a.kind = 'card' and a.target_act_id is not null and not (a.payload ? 'caught') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    and exists (select 1 from card_kinds k where k.key = a.payload ->> 'card' and k.wraps);
  if not found then raise exception 'there is no present to open' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform 1 from accounts where id = who for no key update;
  select a.character into post_character from acts a where a.id = b.target_act_id for no key update;
  if not exists (select 1 from characters c where c.id = post_character and c.owner = who) then
    raise exception 'only this post''s author can open it' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  perform 1 from acts a where a.id = b.id for no key update;
  select * into held from gift_box g where g.box = b.id for update;
  if not found then raise exception 'there is no present to open' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if card_ended(b.id) then raise exception 'this present was already opened or ended' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  begin
    insert into acts (character, kind, thread, target_act_id, payload)
    values (post_character, 'open_gift', b.thread, b.id, jsonb_build_object('box', b.id, 'did', 'landed', 'gift', gift_id, 'why', null)) returning id into open_id;
    landed := place_cast(b.character, held.card, b.target_act_id, held.config, '', 'post', null, held.account, 0, jsonb_build_object('opened', open_id), null, null, null, 0, gift_id);
  exception when others then
    get stacked diagnostics said = message_text, hint = pg_exception_hint;
    if hint is distinct from 'kayfabb.refusal' then raise; end if;
    landed := null;
  end;
  if landed is null then
    insert into acts (character, kind, thread, target_act_id, payload)
    values (post_character, 'open_gift', b.thread, b.id, jsonb_build_object('box', b.id, 'did', 'returned', 'gift', null, 'why', said)) returning id into open_id;
    insert into card_ledger (account, card, kind, act, price) values (held.account, held.card, 'returned', open_id, 0);
  end if;
  return jsonb_build_object('box', b.id, 'did', case when landed is null then 'returned' else 'landed' end, 'why', said, 'open', act_projection(open_id), 'gift', landed);
end $$;
revoke execute on function open_gift(uuid, uuid) from public, anon, authenticated;
grant execute on function open_gift(uuid, uuid) to service_role;

-- ---- 7b. the author veil covers an open ----

-- An open is the post's author's Act with the box as its target, and the box's character is the giver's, so 0371's cover (the Act's character is the character of the Act's target post) never held it, and the open showed the true author
-- through acts_public, post_plays, kind_plays, thread_page, play_moment and spin_moment, and the act function's broadcast. Both halves of the cover read an open through its box to the post, as they read a draw or a wash through its card:
-- acts_veil_cover covers an open written while a veil is live, post_veils_cover the opens the author wrote before it landed. Each copied whole from 0395_polls.sql (its latest definition); the changes are the two lines marked "0457".
create or replace function post_veils_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform veil_cover_lock(new.post);
  insert into post_veil_cover (act, play)
  select new.post, new.play
  union
  -- The author's Acts on the post, in two selects so that each reaches an index of its own: acts_target is partial (kind <> 'edit') and acts_edits holds the edits (kind = 'edit'); one select over both is a scan of the author's Acts.
  select a.id, new.play from acts a
  where a.target_act_id = new.post and a.character = new.author and a.kind not in ('post', 'spin', 'edit')
  union
  select a.id, new.play from acts a
  where a.target_act_id = new.post and a.character = new.author and a.kind = 'edit'
  union
  select d.id, new.play from acts k join acts d on d.target_act_id = k.id
  where k.kind = 'card' and k.target_act_id = new.post and d.kind in ('draw', 'wash') and d.character = new.author
  union
  -- 0457: the opens the author wrote on the boxes left on the post (acts_target holds each by its box).
  select o.id, new.play from acts k join acts o on o.target_act_id = k.id
  where k.kind = 'card' and k.target_act_id = new.post and o.kind = 'open_gift' and o.character = new.author
  union
  select b.id, new.play from acts p join acts b on b.target_act_id = p.id and b.kind = 'ballot' and b."character" = new.author
  where p.kind = 'poll' and p.target_act_id = new.post
  union
  select k.id, new.play from acts p join acts k on k.target_act_id = p.id and k.kind = 'poll_close' and k."character" = new.author
  where p.kind = 'poll' and p.target_act_id = new.post
  union
  select c.card, new.play from post_veil_cards c where c.post = new.post and c.author = new.author
  on conflict do nothing;
  return null;
end $$;

create or replace function acts_veil_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tgt record;
  pst uuid;
  pc uuid;
begin
  select t.id, t.kind, t.target_act_id into tgt from acts t where t.id = new.target_act_id;
  if new.kind in ('draw', 'wash', 'open_gift') and tgt.kind = 'card' then pst := tgt.target_act_id;  -- 0457: an open is read through its box
  elsif new.kind in ('ballot', 'poll_close') and tgt.kind = 'poll' then pst := tgt.target_act_id;
  else pst := tgt.id; end if;
  select a.character into pc from acts a where a.id = pst;
  if pc is not null and pc = new.character then
    perform veil_cover_lock(pst);
    insert into post_veil_cover (act, play)
    select new.id, v.play from post_veils v
    where v.post = pst and v.veil = 'author' and v.author = new.character and v.ends_at > now()
    on conflict do nothing;
  end if;
  return null;
end $$;

-- ---- 8. reverse_card ----

-- Copied whole from 0423_rulings_alerts.sql, its latest definition: an end of an opened box is refused in plain words, and an unopened one gives its gift back to the giver's hand. Grants as they were.
CREATE OR REPLACE FUNCTION public.reverse_card(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p acts%rowtype;
  written uuid;
  target uuid;
begin
  perform only_admins('ends a card');
  -- The play's row is locked, so two admins at once write one end between them and the second sees the first's.
  select * into p from acts a where a.id = play and (a.kind = 'card' or (a.kind = 'spring' and a.payload ->> 'did' = 'lockedOut')) for no key update;
  if not found then raise exception 'that is not a card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.kind = 'spring' then
    -- A sprung lockout: over once its `until` has passed. It has no caught, ends, reach, keeps or refunds: those are a card play's.
    if (p.payload ->> 'until')::timestamptz <= now() then
      raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
      raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  else
  if p.payload ? 'caught' then raise exception 'that card was caught by a trap, so it never landed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- An unopened present's row is locked after the play's, as open_gift locks them, so an end and an open at once are one after the other; an opened one is the author's, no admin's to end.
  perform 1 from gift_box g where g.box = p.id for update;
  if exists (select 1 from acts o where o.kind = 'open_gift' and o.target_act_id = p.id) then
    raise exception 'that present was already opened' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- A play of a kind that keeps still counts on the posts it was up over after its time (thread_page's `kept`), so an admin may end it then.
  if ((p.payload ->> 'ends')::timestamptz <= now() or exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now()))
     and not coalesce((select ck.keeps from card_kinds ck where ck.key = p.payload ->> 'card'), false) then
    raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
    raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from card_write_refunds r where r.play = p.id) then
    raise exception 'That card didn''t take, so there is nothing of it on this post.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- A play a card that cuts ended: the card that did it is named, since ending that card is what brings this one back (card_cut_at reads the cutting plays an admin has not ended).
  if card_cut_at(p.id) is not null then
    raise exception 'a % already ended that card; end that card to bring this one back',
      (select ck.name from acts c join card_kinds ck on ck.key = c.payload ->> 'card'
       where c.kind = 'card' and (c.payload -> 'cut' ->> 'play') = p.id::text and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)
       order by c.created_at, c.id limit 1)
      using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Any other way a play is over (a pierce a cast spent): it is not an admin's to end again.
  if card_ended(p.id) then raise exception 'that card is already over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'card_end', p.thread, p.id, jsonb_build_object('why', 'reversed', 'by', 'admin')) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  -- An unopened present ended by an admin gives its gift back to the giver's hand, as a refund outcome does: a `returned` row naming the end.
  insert into card_ledger (account, card, kind, act, price) select g.account, g.card, 'returned', written, 0 from gift_box g where g.box = p.id;
  -- The caster's alert (Task 4; for a lockout, the setter's, as the spring is the setter's Act): one, in this transaction, for the caster's own player, about the card_end. write_alert writes none
  -- for a staff character (no owner), so a staff play's end tells nobody. `acting` is null: the admin is not told apart from the caster.
  perform write_alert(p.character, 'cardEnded', null, written, null);
  -- The target's alert (Task 5; design section 3), found as my_cards_ended finds the target side: the post's author at post reach, the character at character reach, the thread's starter at thread reach,
  -- the locked character for a lockout, and none at board reach. `acting` is the caster's owner, so a play on one's own other mask tells the caster alone.
  if p.kind = 'spring' then
    target := (p.payload ->> 'locks')::uuid;
  else
    select case coalesce(pr.reach, 'post')
             when 'post' then (select x.character from acts x where x.id = p.target_act_id)
             when 'character' then pr.character
             when 'thread' then (select o.character from acts o where o.thread = pr.thread and o.seq = 1)
           end
      into target from (select 1) one left join play_reach pr on pr.play = p.id;
  end if;
  perform write_alert(target, 'cardEnded', 'onYours', written, (select c.owner from characters c where c.id = p.character));
  -- The answer carries the play, and for a play beyond a post its reach, so the act function can broadcast the end on `reach`.
  return act_projection(written) || jsonb_strip_nulls(jsonb_build_object('play', p.id,
    'reach', case when p.payload ->> 'reach' in ('character', 'thread', 'board') then p.payload ->> 'reach' end));
end $function$;

-- ---- 9. self_kinds and act_self_characters ----

-- Both copied whole from 0455_live_lists_and_self.sql: `open_gift` is a kind that changes what my_characters shows of a giver's character (its hand on a return) and of the opener, so both are poked. supabase/tests/0455-live-lists-and-self.sql holds the two lists to acts_kind_check's own.
CREATE OR REPLACE FUNCTION public.self_kinds()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array['appeal_ruling', 'ban', 'card_end', 'infraction', 'move', 'move_end', 'open_gift', 'spring', 'unmask']
$function$;

CREATE OR REPLACE FUNCTION public.act_self_characters(in_act uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recursive chain (id, hop) as (
    select a.id, 0 from acts a where a.id = in_act
    union all
    select t.id, c.hop + 1
    from chain c join acts a on a.id = c.id and a.kind in ('move_end', 'card_end', 'appeal_ruling', 'appeal')
    join acts t on t.id = a.target_act_id
    where c.hop < 2
  )
  select distinct w.character from (
    select self_uuid(a.payload ->> 'character') as character from chain c join acts a on a.id = c.id
    union all select self_uuid(a.payload #>> '{params,character}') from chain c join acts a on a.id = c.id
    union all select self_uuid(a.payload ->> 'locks') from chain c join acts a on a.id = c.id
    union all select a.character from chain c join acts a on a.id = c.id where c.hop = 0 and a.kind = 'unmask'
    union all select self_uuid(b.payload ->> 'character') from chain c join ban_lifts l on l.play = c.id join acts b on b.id = l.ban
    -- An open names the opener (its own character) and the box's character, the giver's, whose hand a return changes (open_gift).
    union all select a.character from chain c join acts a on a.id = c.id where c.hop = 0 and a.kind = 'open_gift'
    union all select b.character from chain c join acts a on a.id = c.id and a.kind = 'open_gift' join acts b on b.id = a.target_act_id where c.hop = 0
  ) w where w.character is not null
$function$;

-- ---- 10. The readers that decide whether a play is still up ----

-- Each copied whole from its latest definition (named below), with only the end Acts changed: a box its author opened is over for them as one an admin ended is (`kind in ('card_end', 'open_gift')`), as post_plays and card_ended read it.
-- The admin-ended feeds (admin_queue, log_page, my_cards_ended) keep `card_end` alone, and so does lockout_ends, which reads a lockout's spring: a present is a cast on a post that springs none, so an open frees no lockout.
-- Grants and settings as each definition states them; replaced in place (pool_thread is owned by kayfabb_digest, which the alter below restates).

-- play_moment: from 0375_spun_thread_reads.sql.
CREATE OR REPLACE FUNCTION public.play_moment(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  recorded boolean;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- A play beyond a post that began before this one ends at most its reach's reachLasts after it began (play_card), so before this
  -- play's time plus that bound: each probe of play_reach reads the plays live then and none begun since, however old the play is.
  -- (An instance that lowers reachLasts later bounds an older moment by the lower span; a play that outlived it is left off that
  -- moment's list of plays above, which is words on the frame.)
  bound record;
begin
  select * into k from acts a where a.id = play_moment.play;
  -- A play on a post, or on a character (cast from the post that is its target_act_id). A thread's and a board's play are no play on a post.
  if k.id is not null and k.kind in ('card', 'set', 'spring') and k.target_act_id is not null and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') then
    select * into on_post from acts a where a.id = k.target_act_id;
  end if;
  if not coalesce(post_kind(on_post.kind), false) then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post's author as the projection shows it: the plays above are those at the character shown, so a post whose author is hidden has none at its author's reach.
  on_post.character := shown_author(on_post.id, on_post.character);
  select * into v from acts a where a.id = (select m.post_version from play_moments m where m.play = k.id);
  recorded := v.id is not null;
  if not recorded then
    select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= k.created_at
    order by e.created_at desc, e.id desc limit 1;
    if v.id is null then v := on_post; end if;
  end if;
  select t.board into on_board from threads t where t.id = on_post.thread;
  -- An instance seeded without reachLasts (settings_reach_hold makes it whole once written) bounds nothing, rather than reading none.
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    -- The rows' order is for a stable answer only: a caught play and its spring share a transaction's time, so readers order the layers
    -- themselves (inPlayOrder) and find a caught play's spring by its set, never by this order.
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from play_moment_layers l join acts_public a on a.id = l.layer where l.play = k.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind in ('card_end', 'open_gift') and e.created_at <= k.created_at
                     and e.target_act_id in (select k.id union all select l.layer from play_moment_layers l where l.play = k.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < k.created_at
        and not exists (select 1 from acts e where e.kind in ('card_end', 'open_gift') and e.target_act_id = r.play and e.created_at <= k.created_at)), '[]'::jsonb),
    'recorded', recorded,
    'at', k.created_at);
end $function$;

-- spin_moment: from 0368_client_reads_plan_once.sql.
CREATE OR REPLACE FUNCTION public.spin_moment(spin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
declare
  s acts%rowtype;
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- As play_moment bounds the plays above: a play beyond a post that began before the spin ends at most its reach's reachLasts after it began.
  bound record;
begin
  select * into s from acts a where a.id = spin_moment.spin and a.kind = 'spin' and a.payload ? 'at';
  if s.id is null or not exists (select 1 from spin_moments m where m.spin = s.id) then
    raise exception 'that spin names no post' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  select * into k from acts a where a.id = s.target_act_id;
  select * into on_post from acts a where a.id = (s.payload ->> 'at')::uuid;
  -- The post's author as the projection shows it, as play_moment reads it: a post whose author is hidden has nothing listed at its author's reach.
  on_post.character := shown_author(on_post.id, on_post.character);
  select * into v from acts a where a.id = (select m.post_version from spin_moments m where m.spin = s.id);
  select t.board into on_board from threads t where t.id = on_post.thread;
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from spin_moment_layers l join acts_public a on a.id = l.layer where l.spin = s.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind in ('card_end', 'open_gift') and e.created_at <= s.created_at
                     and e.target_act_id in (select k.id union all select l.layer from spin_moment_layers l where l.spin = s.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < s.created_at and r.play <> k.id
        and not exists (select 1 from acts e where e.kind in ('card_end', 'open_gift') and e.target_act_id = r.play and e.created_at <= s.created_at)), '[]'::jsonb),
    'recorded', true,
    'at', s.created_at);
end $function$;

-- search_post_cards: from 0117_search.sql.
CREATE OR REPLACE FUNCTION public.search_post_cards(act uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select jsonb_agg(l.card order by l.created_at, l.id)
    from (select o.payload ->> 'card' as card, o.created_at, o.id from acts_public o
          where o.kind in ('card', 'spring') and o.target_act_id = $1 and coalesce(o.payload ->> 'reach', 'post') = 'post'
            and not exists (select 1 from acts_public e where e.kind in ('card_end', 'open_gift') and e.target_act_id = o.id)
          order by o.created_at, o.id limit 8) l), '[]'::jsonb)
$function$;

-- kind_plays: from 0410_post_plays.sql.
CREATE OR REPLACE FUNCTION public.kind_plays(post uuid, card text, before_at timestamp with time zone, before_id uuid, size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
declare
  lim integer := greatest(1, least(coalesce(kind_plays.size, 20), 50));
begin
  return (
    with page as materialized (
      select x.play, x.at from kind_play_ids(kind_plays.post, kind_plays.card, kind_plays.before_at, kind_plays.before_id, lim + 1) x order by x.at desc, x.play desc
    ), shown as materialized (
      select x.play, x.at from page x order by x.at desc, x.play desc limit lim
    ), plays as materialized (
      select a.* from acts_public a where a.kind in ('card', 'set') and a.id = any (array(select s.play from shown s))
    ), riders as materialized (
      select a.* from acts_public a where a.kind in ('spring', 'take_back') and a.id = any (array(select r from play_rider_ids(array(select s.play from shown s)) r))
    ), ends as materialized (
      select a.* from acts_public a where a.kind in ('card_end', 'open_gift') and a.target_act_id in (select p.id from plays p union all select r.id from riders r)
    ), ids as materialized (
      select p.id from plays p union select r.id from riders r union select e.id from ends e
    ), casters as materialized (
      select distinct x.c from (select p."character" as c from plays p union select r."character" from riders r) x where x.c is not null
    ), heads as materialized (
      select c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until,
                                                                'locked_until', locked_out_until(c.id, (select t.thread from acts_public t where t.id = kind_plays.post)), 'group', c."group"),
                                'profile', (select (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait,
                                                                       'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                                            from character_profiles p where p."character" = c.id)) as head
      from casters k cross join lateral (select x.* from characters_public x where x.id = k.c offset 0) c
    ), spun as materialized (
      select l.* from thread_list l where l.origin_act_id in (select s.play from shown s)
    )
    select jsonb_build_object(
      'plays', coalesce((select jsonb_agg(x.j order by x.grp, x.ord, x.created_at, x.id)
                         from (select to_jsonb(p.*) as j, 0 as grp, row_number() over (order by s.at desc, s.play desc) as ord, p.created_at, p.id from plays p join shown s on s.play = p.id
                               union all select to_jsonb(r.*), 1, 0, r.created_at, r.id from riders r
                               union all select to_jsonb(e.*), 2, 0, e.created_at, e.id from ends e) x), '[]'::jsonb),
      'tallies', coalesce((select jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)) from reaction_tallies t where t.act in (select i.id from ids i)), '[]'::jsonb),
      'mine', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")) from my_reactions m where m.act in (select i.id from ids i)), '[]'::jsonb),
      'spun', coalesce((select jsonb_agg(to_jsonb(l.*) order by l.created_at, l.id) from spun l), '[]'::jsonb),
      'cast', coalesce((select jsonb_agg(h.head order by h.id) from heads h), '[]'::jsonb),
      'next', case when (select count(*) from page) > lim then (select jsonb_build_object('at', s.at, 'id', s.play) from shown s order by s.at, s.play limit 1) end)
  );
end $function$;

-- thread_page: from 0456_surface_coats.sql.
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
         UNION ALL
          -- The board cards written in this thread, which sit on no post (target_act_id is null): from this page's first Act up to the next page's first (page 1 from the start, the last page to the end), at most 100.
          -- Read as the page reads every play, through acts_public, by id, in on_posts below; the page's `plays` leave them out and `boardCards` is made of them.
          SELECT b.b AS id
            FROM rng,
             board_card_ids(rng.id, rng.page, rng.first_seq, rng.end_seq) b(b)
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
           WHERE ((a.kind = ANY (ARRAY['card_end'::text, 'open_gift'::text])) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o
                   WHERE (o.target_act_id IS NOT NULL))))
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
         ), answers_on AS MATERIALIZED (
          SELECT o.visit_act,
             o.post_act,
             o.at
            FROM outcome_page_rows(ARRAY(( SELECT p.id
                    FROM posts p))) o
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (u.id) u.id,
             u.post,
             u."character",
             u.created_at,
             u.payload
            FROM (( SELECT DISTINCT ON (v.target_act_id) v.id,
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
                   ORDER BY v.target_act_id, v.created_at DESC, v.id DESC)
                 UNION ALL
                  SELECT v.id,
                     v.target_act_id,
                     v."character",
                     v.created_at,
                     v.payload
                    FROM acts_public v
                   WHERE ((v.kind = 'visit'::text) AND (v.id IN ( SELECT x.visit_act
                            FROM answers_on x)))) u
           ORDER BY u.id
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
           WHERE ((e.kind = ANY (ARRAY['card_end'::text, 'open_gift'::text])) AND (e.target_act_id IN ( SELECT s.id
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
                FROM rng), 'boardCards', ( SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM on_posts o
               WHERE (o.target_act_id IS NULL)), 'acts', ( SELECT COALESCE(jsonb_agg((CASE WHEN post_kind(a.kind) THEN to_jsonb(a.*) || jsonb_build_object('version', post_current_version(a.id)) ELSE to_jsonb(a.*) END) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
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
                       WHERE (o.target_act_id IS NOT NULL)
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
                      LIMIT 1), 'answers', COALESCE(( SELECT jsonb_agg(x.post_act ORDER BY x.at, x.post_act) AS jsonb_agg
                        FROM answers_on x
                       WHERE (x.visit_act = v.id)), '[]'::jsonb)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
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
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', sf.covered, 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
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

-- pool_thread: from 0420_hot_posts.sql.
CREATE OR REPLACE FUNCTION public.pool_thread(in_thread uuid, most integer, chars integer, also uuid, more uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with page as (
    select a.id, a.seq, a.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body,
           length(coalesce(a.current_payload ->> 'body', '')) > greatest(chars, 1) as cut
    from acts_public a join characters_public c on c.id = a.character
    where a.thread = in_thread
      and ((a.kind = 'post'
            and (a.id = also or a.id = any (coalesce(more[1:50], '{}'::uuid[]))
                 or a.id in (select n.id from acts_public n where n.thread = in_thread and n.kind = 'post'
                             order by n.created_at desc, n.id desc limit greatest(most, 0))))
           -- The thread's spin Act is its first post, always shown (the opener a reply is to), whatever `most` is; a thread nobody spun has none.
           or (a.seq = 1 and a.kind = 'spin'))
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('act', p.id, 'name', p.name, 'pronouns', p.pronouns, 'body', p.body, 'cut', p.cut) order by p.created_at, p.id) from page p), '[]'::jsonb),
    'walls', coalesce((select jsonb_agg(jsonb_build_object('play', k.id, 'card', k.payload ->> 'card',
                                                           'about', 'a post by ' || p.name || coalesce(' (#' || p.seq || ')', '')) order by p.created_at, p.id, k.id)
                       from page p join surfaces s on s.post = p.id join acts_public k on k.id = s.play
                       where not exists (select 1 from acts_public e where e.kind in ('card_end', 'open_gift') and e.target_act_id = k.id)
                         and not exists (select 1 from card_write_refunds r where r.play = k.id)), '[]'::jsonb))
$function$;
alter function pool_thread(uuid, integer, integer, uuid, uuid[]) owner to kayfabb_digest;
