-- The author's veil (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 2; design docs/plans/2026-11-11-card-notes-design.md, section 2, "Whodunnit?").
--
-- A cast card whose kind has `veil = 'author'` withholds the post's author from every read while it is up, and shows the one stand-in character in its place, for every reader alike: the author included. What is veiled is
-- the post and what its own author did to it that is no content of its own (its edits, a set, a take-back, a use card, its spring); the author's replies are not (a quote of it, a spin from it, a reply elsewhere), since who wrote what, and
-- when, is the game's own clue: a post or a spin is veiled only by a veil cast on it directly.
-- One mechanism: `post_veils`, a row per veil play, written with the play and never edited, and `acts_public`, which answers the stand-in for the veiled rows. The sections:
--
--     1. the catalog       card_kinds.veil and card_kinds.adds_reaction (Task 5 reads the second), the two checks that pair them with a cast card on a post, and card_kinds_problem in the engine's words.
--                          A cast on a post may end: place_cast and lay_sprung write `ends` whenever the card has `lasts` (a use card's and a skim's alone before), and the refusal of a time up on a cast is gone.
--     2. the stand-in      characters_staff_kind_check takes 'anonymous' and one index holds the one of it; seed_instance makes it once, as it makes the developer (the setting `anonymousAvatar`); characters_public.office
--                          says 'anonymous'; stand_in() is its id. The staff lists that would take it for a Mod Bot's persona (the presence box, the pool's signals, the digest's `staff` flag) leave it out.
--     3. post_veils        the table (insert-only, by its own append-only pair, read by no API role), post_veils_live (a veil is live while its time has not passed and no admin has ended its play), author_veiled,
--                          author_veil_ends and shown_author.
--     4. acts_public       two selects over `acts` in one appendrel (the rows that are not veiled as they are, then the veiled rows each with the stand-in as `character`), under main's concealment, with an ungranted view `acts_base` that is
--                          today's acts_public (the true character) to compare it with. No select asks who is reading: the projection is the same for every reader. `acts.character` is no longer granted to
--                          `authenticated` (and `payload`, as 0340_conduct left it; every other column is granted), so no read goes around the view; the readers the revoke broke are moved below.
--     5. landing           land_refusal (what a card's landing refuses on a post, read for every back a quote meets, whatever the card) and land_rows (what a landed post play writes beside its Act), called by place_cast
--                          for a cast and by lay_sprung for a Move landing on a quote. spring_facts reads land_refusal, spring_traps lands a Move only when it has nothing to say. TASK 5 EXTENDS THESE TWO in a later
--                          migration (the reaction card's configuration and its row); the places are marked `Task 5` below.
--     5b. the counts       character_post_counts is a view that counts a veiled post (and its author's cards on it, nothing else of kind post or spin) for the stand-in and not for its author while the veil is live, for every reader; the stored
--                          table is character_post_counts_base, written by the trigger as before and read by no API role. group_now (the groups' posts rung, display only) reads the same figure (character_counts_shown), so a group and a count agree;
--                          profile_page, record_page and my_characters_page are made again over the view.
--     6. the reads         thread_open, my_cards_ended (now the caller's own rows, as my_reactions is), play_moment, group_now (the stand-in has no group), card_target_reach, start_visit, open_report, thread_page (`veiled`),
--                          my_veiled_posts (the author's own rows), my_group_moves (a security-invoker view that read `acts.character`, which the revoke broke), presence_listed, pool_named, pool_signals,
--                          my_draws (0317; the washer of a drawing on a veiled post, who is its author, shown as the stand-in) and system_digest (the staff lists that would take the stand-in for a persona).
--                          spin_written, spin and spin_moment (0351, a spin pressed at a post): the post pressed must be the play's character's as the projection shows it, so a spin is refused at a veiled post in the
--                          one sentence any other post gets; spin takes the post `for share` before the character (the lock order below); and land_refusal refuses a veil on a post a spin was pressed at (acts_spin_at).
--     7. the model        claim_card_writes names the stand-in as the author of the post a writing card lands on, so the words a model writes are written without the true author's name.
--
-- Masks ("A response never proves a private fact"): every read of an Act answers from the post's public play (the veil play is on the post) and never from who owns a character; the stand-in is one character for every
-- veiled post on the instance; every refusal reads public Acts (a staff post, a visit) and is the same for every caster. The author's own fact comes only from my_veiled_posts, the caller's own rows, as a setter's
-- face-down card does from my_face_down. The held answers of a refused cast name no one.
--
-- Ways out: a veil ends by itself at its time (three days for Whodunnit?) or at an admin's end (reverse_card), and the author is shown again by the same read, with nothing written. A post a Mod Bot will not visit, and a report that
-- is refused, end when the veil does, and the refusal says when. A cast refused (a staff post, a visited post) is refused before it is written; the caster keeps the card.
--
-- Each function below is copied from its latest definition, named in the comment above it, changing only what that comment names; lock order and `set search_path` are as written there.
-- Lock order, for the post, the visits and the character: POST, THEN visits_open, THEN CHARACTER, in every function that takes more than one (a visit's filing takes the post's row, then visits_open, then in infract the post's author's
-- character). place_cast's character branch is the one this migration moves to it: the post a card on a character is played from is taken `for share` before the target character's row, where it was taken after (0317), so a card cast
-- from post P onto its author and a filing on P meet at the post and never hold one row each and wait on the other (supabase/tests/0166-post-veils.sql, section 13 (d), holds a third session getting the character's row while the card waits).
-- spin is the second: the post a spin is pressed at is taken `for share` before not_banned takes the spinner's character (section 13 (e) and (g)). lock_for_quote is the third: a quote that meets a live back takes the
-- quoted post `for share` before its face-down rows and the characters (post, then face_down, as place_set takes them), so a back springing on it and a veil cast on it are laid one at a time (section 13 (f)).


-- ===================================================================================== 1. the catalog ====
-- `veil` is what a cast card on a post withholds while it is up ('author': the post's author; 'totals': its reaction totals, Task 4), `adds_reaction` is whether its play adds a reaction kind to the one post (Task 5). The
-- engine's CardRules.veil and CardRules.reaction, as flags: SQL never knows which card. The pairings are the engine's (playProblems): a card with either is a cast card on a post alone; a veil ends at its time (has `lasts`); a
-- reaction neither writes nor is seeded; and a card has one of the two.
alter table card_kinds add column veil text check (veil in ('author', 'totals'));
alter table card_kinds add column adds_reaction boolean not null default false;
-- A cast on a post may end (a skim, a veil): the table's own refusal of a time up on a cast that reaches a post alone goes, as the engine's does (playProblems). A set card with one is still refused.
alter table card_kinds drop constraint card_kinds_lasts_use;
alter table card_kinds add constraint card_kinds_lasts_use check (lasts is null or play in ('use', 'cast') or reaches <> '{post}' or skim is not null);
alter table card_kinds add constraint card_kinds_veil_post check (veil is null or (play = 'cast' and reaches = '{post}' and lasts is not null and not adds_reaction));
alter table card_kinds add constraint card_kinds_reaction_post check (not adds_reaction or (play = 'cast' and reaches = '{post}' and not writes and not seeded));

-- ===================================================================================== 2. the stand-in ====
-- The one character shown in place of a veiled post's author: a staff character of a third kind (the developer is the second), no owner, no class, no wallet, no standing, debuted when the seed made it.
alter table characters drop constraint characters_staff_kind_check;
alter table characters add constraint characters_staff_kind_check check (staff_kind in ('persona', 'developer', 'anonymous'));
-- The one of it, found by this same index: stand_in() is a probe, never a read of every character.
create unique index characters_one_anonymous on characters (staff_kind) where staff_kind = 'anonymous';

-- characters_public (0128_groups), saying `office` 'anonymous' for the stand-in as it says 'developer' for the developer. Everything else as 0128 wrote it.
create or replace view characters_public as
  select c.id, c.name, date_trunc('month', c.debuted_at at time zone 'UTC')::date as joined, c.staff,
    case when c.staff is null then null when c.staff_kind in ('developer', 'anonymous') then c.staff_kind else o.office end as office,
    warn_points(c.id) as warn_points, banned_until(c.id) as banned_until, group_now(c.id) as "group"
  from characters c left join staff_office_now o on o.staff = c.staff
  where c.debuted_at is not null;

-- The stand-in's id: stable, and null on a database seeded with none. For no API role.
create function stand_in() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from characters c where c.staff_kind = 'anonymous'
$$;

-- card_kinds_problem (0316_card_notes_part_4), with the refusal of a cast on a post that has a time up gone, and the veil's and the reaction's refusals in the engine's words (instance.ts, playProblems and veilProblems).
-- Everything else as 0316 wrote it.

create or replace function card_kinds_problem(cards jsonb) returns text
language sql stable set search_path = public, pg_temp as $$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, nullif(e -> 'trap', 'null') as trap,
      e #>> '{trap,trigger,on}' as trigger_on, e -> 'gimmick' as gimmick, e,
      case when jsonb_typeof(e -> 'reaches') = 'array' then exists (select 1 from jsonb_array_elements_text(e -> 'reaches') r where r <> 'post') else false end as beyond,
      coalesce(e -> 'reaches' = '["character"]'::jsonb, false) as character_alone,
      -- A card has a veil when the key is there and is not a JSON null: seed_instance reads a null through nullif as no veil, and this agrees.
      coalesce(e -> 'veil', 'null'::jsonb) <> 'null'::jsonb as has_veil
    from jsonb_array_elements(coalesce(cards, '[]')) e
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
  ) p where why is not null
$$;

-- seed_instance (0348_post_under, which is 0332_arcs with the card kinds' `replies` and `keeps` written), writing each card's `veil` and whether it adds a reaction (both the code's, so a re-seed that drops one clears it), and making the anonymous poster once, as it makes the developer.
-- Everything else as 0348 wrote it.

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
  -- are its rarity, its play, its trap (with its match), its gimmick, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface;
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
  -- The anonymous poster (0400): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
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
      insert into settings (key, value) values ('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;


-- ===================================================================================== 3. post_veils ====
-- One row per veil play, written by land_rows beside the play's Act and never edited: `post` is the post it is on, `author` that post's own character (which never changes, so a read finds the veiled Acts by it without
-- reading the post), `caster_account` the account that played it (null for a staff caster) for Task 4's totals, `ends_at` the time the play's own `ends` says. Insert-only, by the append-only pair play_reach has (0055),
-- on a restore too. No API role reads it: every reader is a view or a function that owns its rights.
create table post_veils (
  play uuid primary key references acts (id),
  post uuid not null references acts (id),
  veil text not null check (veil in ('author', 'totals')),
  author uuid not null references characters (id),
  caster_account uuid references accounts (id),
  ends_at timestamptz not null
);
create index post_veils_post on post_veils (post, veil, ends_at);
create index post_veils_ends on post_veils (veil, ends_at);

create function post_veils_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a veil is never edited; it ends at its time' using errcode = '55000';
end $$;
create trigger post_veils_no_update before update or delete on post_veils for each row execute function post_veils_append_only();
create trigger post_veils_no_truncate before truncate on post_veils for each statement execute function post_veils_append_only();
alter table post_veils enable always trigger post_veils_no_update;
alter table post_veils enable always trigger post_veils_no_truncate;
alter table post_veils enable row level security;
revoke all on post_veils from public, anon, authenticated, service_role;

-- post_veil_cards: the card a veiled post's own back laid. A back set on P by P's author springs on a quote Q and lay_sprung writes a card Act on Q whose `character` is the setter and whose payload names the spring Act, which
-- targets P: a join (card, its `spring`, the spring's target) says the card's author is P's author, and the card is on Q and not on P, so no derived row of the veil reaches it. When a back springs while an author veil is live on
-- its post, lay_sprung writes the card's row here (one per card: the card, the post whose author set it, that author), and acts_public shows the card under the stand-in for as long as that veil is live, as it shows the spring.
-- A veil cast after a back has sprung is refused (land_refusal), so every card that is the author's and names a veiled post's spring is a row here. Insert-only by the same pair, read by no API role.
create table post_veil_cards (
  card uuid primary key references acts (id),
  post uuid not null references acts (id),
  author uuid not null references characters (id)
);
create index post_veil_cards_post on post_veil_cards (post);

-- The spins pressed at a post (0351 writes the post in the spin's `at`), for land_refusal's probe: a post's few spins, as acts_spring_by (0151) holds a quote's springs. A partial index on the spins that name a post, so
-- it grows with those spins alone.
create index acts_spin_at on acts ((payload ->> 'at')) where kind = 'spin' and payload ? 'at';
create trigger post_veil_cards_no_update before update or delete on post_veil_cards for each row execute function post_veils_append_only();
create trigger post_veil_cards_no_truncate before truncate on post_veil_cards for each statement execute function post_veils_append_only();
alter table post_veil_cards enable always trigger post_veil_cards_no_update;
alter table post_veil_cards enable always trigger post_veil_cards_no_truncate;
alter table post_veil_cards enable row level security;
revoke all on post_veil_cards from public, anon, authenticated, service_role;

-- A veil is live while its time has not passed and no admin has ended its play (a card_end, or a write that failed and was refunded: card_ended, 0149, whose two reads are written out here). One read of the two, for every
-- reader below. It calls no function of its own: a view's tables are read with its owner's rights but its functions are run as the caller, and the readers of acts_public include roles that were granted none (the digest's,
-- whose reviewed list of functions (0050-digest.sql) is not widened for this).
create view post_veils_live as
  select v.play, v.post, v.veil, v.author, v.caster_account, v.ends_at
  from post_veils v
  where v.ends_at > now()
    and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = v.play)
    and not exists (select 1 from card_write_refunds r where r.play = v.play);
revoke all on post_veils_live from public, anon, authenticated, service_role;

-- When the post's author stops being hidden: the latest end among its live author veils, null where none is up. One probe of post_veils_post.
create function author_veil_ends(act uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select max(v.ends_at) from post_veils_live v where v.post = author_veil_ends.act and v.veil = 'author'
$$;
create function author_veiled(act uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post_veils_live v where v.post = author_veiled.act and v.veil = 'author')
$$;
-- The character a post is shown under: the stand-in while an author veil is up on the Act, else its own. For every reader alike.
create function shown_author(act uuid, "character" uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from post_veils_live v where v.post = shown_author.act and v.veil = 'author') then stand_in() else shown_author."character" end
$$;

-- ===================================================================================== 4. acts_public ====
-- acts_public is two layers, each the other's own rules and neither reading who is asking:
--   * CONCEALMENT, main's (0340_conduct, which the conduct work made acts_public say): for every row, a hidden version's body is null, a body that quotes a hidden post is served as its layer (or null with `concealing` until the layer
--     exists), and `hidden`, `any_hidden`, `concealing`, `payload_hidden` and `payload_concealing` say so. It keys on the Act's own id alone (the admin decisions on its post, conduct_decisions; the quote layer of its words), never on the
--     reader: version_hidden, quote_hidden, conceal_layer and shown_payload take an Act or a payload and answer the same for every caller. A bar on an account (suspend, ban) changes no row of this view.
--   * THE VEIL, this plan's: the `character` column. Where an author veil is live, the stand-in instead of the true character (below).
-- acts_base is acts_public as 0340_conduct wrote it: concealment as it does it, the true character, one select, and no API role reads it. It is what the veil's tests compare acts_public against, column for column, row for row (every
-- column but `character` is acts_base's on every row). acts_public is then the concealment over a union of two selects over `acts` that carry the `character` alone (and the booleans `g` and `ok` that say which select a row
-- belongs to):
--   1. every row that is not veiled: no live author veil is on the row itself, and the row is not one of the Acts the veil derives (below).
--   2. the veiled rows, each with the stand-in as `character`: the post itself (by its key), and the Acts its author made on it (a target in the live veils' posts, and that post's author behind it), any but an edit and an edit
--      apart (so that each arm has the index of its own: acts_target is partial, without edits, and acts_edits holds them), and the draws and washes by that author on a wall (0317) on that post. A wash is the post's own
--      character's alone, so it names the author wherever it is read (surface_acts, a broadcast, my_draws' cut rows); a draw is any character's, and the author's own is hidden with the rest of what the author made on the post.
--      The wall's play is the Act the draw targets and its target the post: found through the cards on the live veils' posts (an index read of acts_target), so a read pays for it only while an author veil is up.
-- WHAT A VEIL ON A POST COVERS. The post itself, and what its author did to it that is no content of its own: an edit, a set, a take-back, a use card, its spring (the derived Acts, which every read of an Act agrees on).
-- And the card a back of the author's laid from that spring on a quote (post_veil_cards, written by lay_sprung while the veil is live): it is the setter's and names the spring, which targets the post, so it is shown under the stand-in too. It never
-- covers an Act of kind `post` or `spin` that targets the post (the author's own quote of it, a spin from it): those are posts and threads of their own, listed as such by thread_open's first and last poster, indexed by
-- post_search and counted by character_post_counts as posts and spins, and each of those reads probes the veil on the Act itself alone. They are the author's own replies elsewhere in kind (who quoted what is the game's
-- clue, and anyone may quote the post, so a quote proves nothing), and are veiled by a veil cast on them directly and by nothing else. So an Act is in exactly one of the selects, whatever veils a post and its quotes hold: the
-- first select's `ok` is the second's negated, and the checks are `exists`, so two veils on one post do not repeat it.
-- A veiled post's concealment is the post's own: its row, its edits and the rest of what is derived from it are concealed (or not) as the same Act is in acts_base, because the concealment is computed from the row's true id, whichever
-- select the row came out of; the stand-in is only ever the `character`, in a hidden version as in a shown one. Nothing here asks who is reading: the projection is the same for every reader, so an Act broadcast from act_projection in
-- the author's own session carries the stand-in too. The stand-in is read by a subquery and not by stand_in(): the functions a view calls are run as its reader.
--
-- THE SHAPE IS THE POINT. Each select reads `acts` alone, with no WHERE and no join, and carries no more than the columns it needs: what makes a row its select's is a boolean (`ok`, and for the veiled select `g`, whether any
-- author veil is live) the one WHERE outside the union asks. Postgres reads a union of selects that are each one table with no WHERE as one appendrel: the outer WHERE is carried into each select as a qual, a join that asks
-- acts_public for an id is an index probe into each, and an ordered read with a limit is a merge of each select's own index order. The concealment is main's own lateral joins, once, over the union (as main reads them over
-- `acts`): they are joins to the appendrel, not inside a select, so the appendrel is still one. A select with a WHERE of its own, or a join inside it, is read whole when it is joined or ordered, and an earlier version of this view
-- (two selects, the veiled ones driven from the veils outward) turned a profile's newest five Acts into every Act of that character and a page's reads into scans of the thread, as supabase/tests/0166-post-veils.sql (section 8) and
-- 0075-play-moments.sql hold. A later one (five selects, one for each kind of veiled row) read right and planned wrong once the concealment was over it: each probe by id is one index scan a select, five where main's has one, and
-- a join of a page's ids to acts_public (log_page's walk, in supabase/tests/0166-surface-log.sql) was costed past a hash join of the whole union, which pays the concealment's probes for every Act of the instance in every pass of the
-- walk. The veiled rows are one select, the kinds of veiled row its arms. What the view does cost is planning (it names `acts` in each select and in each edit's subquery, so a statement that reads it opens more of acts'
-- indexes to plan than it did), which supabase/tests/0075-play-moments.sql and 0065-alerts-read.sql count.
create view acts_base as
  select a.id, a.character, a.kind, a.thread, a.target_act_id, a.seq, a.created_at,
         shown_payload(a.payload, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, a.payload), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > a.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when a.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = a.id) end as untaken,
         case when a.kind = 'set' then (select f.ends_at from face_down f where f.play = a.id) end as ends_at,
         h.cur as hidden,
         a.kind = 'post' and quote_hidden(a.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing,
         h.own as payload_hidden,
         not h.own and co.refs and not co.ready as payload_concealing
  from acts a
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = a.id
    order by x.created_at desc, x.id desc limit 1
  ) e on a.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, a.id) end as cur
    from (select a.kind in ('post', 'edit') and version_hidden(a.id, case when a.kind = 'edit' then a.target_act_id else a.id end) as own) o
  ) h
  cross join lateral conceal_layer(a.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null;
revoke all on acts_base from public, anon, authenticated, service_role;

create or replace view acts_public as
  select u.id, u."character", u.kind, u.thread, u.target_act_id, u.seq, u.created_at,
         shown_payload(u.payload, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, u.payload), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > u.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when u.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = u.id) end as untaken,
         case when u.kind = 'set' then (select f.ends_at from face_down f where f.play = u.id) end as ends_at,
         h.cur as hidden,
         u.kind = 'post' and quote_hidden(u.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing,
         h.own as payload_hidden,
         not h.own and co.refs and not co.ready as payload_concealing
  from (
    select a.id, a."character" as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, not exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.id)
             and not (a.kind not in ('post', 'spin') and exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.target_act_id and v.author = a.character))
             and not (a.kind in ('draw', 'wash') and a.target_act_id = any (array(select c.id from acts c where c.kind = 'card' and c.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author'))))
                      and exists (select 1 from acts c join post_veils_live v on v.veil = 'author' and v.post = c.target_act_id and v.author = a.character where c.id = a.target_act_id))
             and not (a.kind = 'card' and a.id = any (array(select c.card from post_veil_cards c join post_veils_live v on v.veil = 'author' and v.post = c.post and v.author = c.author))) as ok
    from acts a
    union all
    select a.id, (select k.id from characters k where k.staff_kind = 'anonymous') as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           exists (select 1 from post_veils_live v where v.veil = 'author') as g, a.id = any (array(select v.post from post_veils_live v where v.veil = 'author'))
             or (a.kind not in ('post', 'spin', 'edit') and a.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author')) and exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.target_act_id and v.author = a.character))
             or (a.kind = 'edit' and a.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author')) and exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.target_act_id and v.author = a.character))
             or (a.kind in ('draw', 'wash') and a.target_act_id = any (array(select c.id from acts c where c.kind = 'card' and c.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author'))))
                 and exists (select 1 from acts c join post_veils_live v on v.veil = 'author' and v.post = c.target_act_id and v.author = a.character where c.id = a.target_act_id))
             or (a.kind = 'card' and a.id = any (array(select c.card from post_veil_cards c join post_veils_live v on v.veil = 'author' and v.post = c.post and v.author = c.author))) as ok
    from acts a
  ) u
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = u.id
    order by x.created_at desc, x.id desc limit 1
  ) e on u.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, u.id) end as cur
    from (select u.kind in ('post', 'edit') and version_hidden(u.id, case when u.kind = 'edit' then u.target_act_id else u.id end) as own) o
  ) h
  cross join lateral conceal_layer(u.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null
  where u.g and u.ok;

-- `acts` was granted to `authenticated` whole (0001, policy `read using (true)`), so its `character` could be read around any view; 0340_conduct took `payload` from that grant (the words are read through acts_public, which empties a hidden
-- version's and the quotes of it). Every column but those two is granted now; the policy stays, and this migration does not hand `payload` back (the grant is the columns the table has less the two). A security-invoker reader of
-- `acts.character` fails loudly (my_cards_ended was one, below); a column added to acts later is granted by the migration that adds it, as every public column is.
revoke select on acts from authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a where a.attrelid = 'public.acts'::regclass and a.attnum > 0 and not a.attisdropped and a.attname not in ('character', 'payload');
  execute format('grant select (%s) on acts to authenticated', cols);
end $$;

-- effect_state (0006) kept `saved_by`, the character who saved a play's state, and was granted whole to `authenticated` under a policy of `using (true)`. Only a post's true author saves what is on it (save_effect_state), so
-- `saved_by` is the post's author: after a veil, `select saved_by from effect_state where play = <a play on the post>` named it to anyone (a save made before the veil as much as one made after), and the `effect` broadcast hands every
-- reader the play's id to look it up with. Nothing a player reads needs it: every reader of the table (the client's own select, the screens' functions and views, the play's moment) asks for play, state and saved_at, and
-- the broadcast carries the play and its time. So the column is taken from the grant, as acts.character is, and the three others stay granted (a column added to effect_state later is granted by the migration that adds it).
revoke select on effect_state from authenticated;
grant select (play, state, saved_at) on effect_state to authenticated;

-- The author's own rows, as my_face_down is the setter's: a live author veil on a post whose character the caller's account owns. The author's player learns that a post shown under the stand-in is theirs from here, and
-- from nothing a reader without the account can reach. Owner rights, filtered by auth.uid() as my_reactions is (0018): the table is read by no API role.
create view my_veiled_posts as
  select v.post, v.author as character, v.play, v.ends_at
  from post_veils_live v
  where v.veil = 'author' and v.author in (select c.id from characters c where c.owner = auth.uid());
revoke all on my_veiled_posts from public, anon, authenticated, service_role;
grant select on my_veiled_posts to authenticated;


-- ===================================================================================== 5. landing ====
-- land_refusal(kind_of, post, config): what a card's landing on a post refuses, in plain words, or null. Read only, from public facts, and the same for every caster; place_cast raises its words (42501) before anything is
-- written, and spring_facts reads it for every back a quote meets so a Move that cannot land stays set. It does the same reads whatever the card is (the post's author's staff flag, the visits that name it, the
-- stand-in) and only then asks what this card refuses, so a back that is a veil, a reaction card or any other Move costs the same reads in the same order.
--   An author veil is refused on a post by a staff character ("a post by the staff keeps its name": the staff are known to be staff, and a visit's record names its Mod), on a post any Mod Bot visit names (its
--   record names the author), on a post a card at character reach was played from (its Act and its play_reach row name the author), and where the forum has no stand-in to show. Every other public Act that points at a
--   post and names its author is downstream of a visit (an infraction, a ban, an appeal, a verdict, an interception are written only through one), so the visit's refusal holds them.
--   A spring that names the post's author is the last: when a face-down card whose Who is "only these" springs on a quote, spring_traps writes a public spring Act whose `for` is the quoter's character and whose `by` is the
--   quote, so the record already names the quote's author, and a veil cast on it afterwards would hide a name that is on the record ("a card that sprang on this post names its author"). One probe of acts_spring_by
--   (0151: the spring Acts, found by `by`, a post a quote's few springs), filtered for a `for`, the same for every caster and read whatever the card is; a landed author veil's own spring omits `for` (spring_traps) and
--   leaves nothing to refuse.
--   A reply cut in under another post (a Line Cutter's, 0348) is the second: the play's Act names it and its caster, so a veil is refused on it ("a card cut this post in under another"), and on a post whose own author cut one in under it.
--   The other way round, a card that replies is refused on a veiled post, for every caster ("this post's author is hidden until ..."): see the body.
--   A spin pressed at the post (0351's `at`) is another: the spin's thread shows the play's character and the post, and spin_written lets it through only for a post of that character, so the record names the author
--   ("a spin was pressed at this post"); the other way round, a spin is refused at a veiled post (spin_written, below). One probe of acts_spin_at.
--   A back of the post's own author that has sprung is the next: its card on the quote is the author's and names the spring, which targets this post ("a card set on this post has sprung"), by the post's backs (the key of face_down)
--   and each one's spring (acts_one_spring), for every caster, a cast and a spring alike. A back that was caught, ended or taken back lays no card, and one still face down is covered by the derived veil as its set is.
--   TASK 5 adds a reaction card's refusals here (its configuration, an emoji the forum already has, a key the post already holds), after these.
create function land_refusal(kind_of card_kinds, post uuid, config jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  by_staff boolean;
  visited boolean;
  played boolean;
  named boolean;
  sprung boolean;
  cut boolean;
  cut_own boolean;
  pressed boolean;
  stood uuid;
begin
  select c.staff is not null into by_staff from acts a join characters c on c.id = a.character where a.id = land_refusal.post;
  visited := exists (select 1 from acts v where v.kind = 'visit' and v.target_act_id = land_refusal.post);
  -- A card at character reach is stored with target_act_id = the post it was played from, and its payload and its play_reach row name that post's author: a public Act that points at the post and names its
  -- author, made by any character (the author's own too, whose `character` the projection changes and whose payload it does not). One probe of acts_target, which holds a post's few targeting Acts.
  played := exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = land_refusal.post and k.payload ->> 'reach' = 'character');
  -- A spring Act that carries the quoter (`for`) and names this post as the quote it sprang on (`by`): one probe of acts_spring_by.
  named := exists (select 1 from acts s where s.kind = 'spring' and s.payload ->> 'by' = land_refusal.post::text and s.payload ? 'for');
  -- A back of the post's own author that sprang on a quote laid a card of the author's on that quote, and that card's payload names the spring, which targets this post: a public Act that ties the author to the post, and
  -- one the derived veil cannot reach (the card is on the quote). The post's backs by the key (post, round) of face_down, and for each its spring by acts_one_spring (the unique index on the spring's `set`): a few probes of
  -- two keys, never the post's targeting Acts or the instance's springs. `landed` is a back that laid a card: a caught or an ended one lays none.
  sprung := exists (select 1 from face_down f join acts s on s.kind = 'spring' and s.payload ->> 'set' = f.play::text where f.post = land_refusal.post and s.payload ->> 'did' = 'landed');
  -- A reply a Line Cutter play cut in under a post (post_under, 0348): its card Act is the caster's (`character`), on the parent (its target, so no derived veil reaches it), and its payload names the reply, so the record says
  -- whose reply it is: a public Act that names the author of the post it names. One probe of the unique index on `reply`; a row stays when the play ends, as the Act does.
  cut := exists (select 1 from post_under u where u.reply = land_refusal.post);
  -- The same record for the parent: where its own author cut a reply in under it, the derived veil would show that card Act under the stand-in and the reply (a post, which the derived veil never covers) under its true
  -- author, and say they are one. One probe of post_under_parent, the post's few replies, and the authors of the two posts (public, as the posts are).
  cut_own := exists (select 1 from post_under u join acts r on r.id = u.reply join acts q on q.id = u.parent where u.parent = land_refusal.post and r.character = q.character);
  -- A spin pressed at the post (0351): the spin's thread shows the play's character and the post, and the spin went through only because the post is that character's, so the record names its author. One probe of
  -- acts_spin_at, a post's few spins.
  pressed := exists (select 1 from acts s where s.kind = 'spin' and s.payload ? 'at' and s.payload ->> 'at' = land_refusal.post::text);
  stood := stand_in();
  if kind_of.replies and author_veiled(land_refusal.post) then
    -- The other half of it, for every caster alike: a post whose author is hidden takes no reply cut in under it (the author's own would be the leak above, and a refusal that told the author from anyone else would be one too).
    return 'this post''s author is hidden until ' || refusal_time(author_veil_ends(land_refusal.post)) || '; no reply is cut in under it before then';
  end if;
  if kind_of.veil = 'author' then
    if by_staff then return 'a post by the staff keeps its name'; end if;
    if visited then return 'a Mod Bot has been to this post, so its author is on the record'; end if;
    if played then return 'a card played from this post names its author, so the author is on the record'; end if;
    if named then return 'a card that sprang on this post names its author, so the author is on the record'; end if;
    if sprung then return 'a card set on this post has sprung, so its author is on the record'; end if;
    if cut then return 'a card cut this post in under another, so its author is on the record'; end if;
    if cut_own then return 'its author cut a reply in under this post, so the author is on the record'; end if;
    if pressed then return 'a spin was pressed at this post, so its author is on the record'; end if;
    if stood is null then return 'this forum has no one to stand in for an author'; end if;
  end if;
  return null;
end $$;

-- land_rows(play, kind_of, post, config, caster): what a landed play on a post needs beside its Act. For a veil card, its post_veils row: the post's own character, the caster's account (null for staff) and the end the
-- play's own payload carries. place_cast calls it after its insert when the cast was not caught, and lay_sprung for a Move landing on a quote, so a veil is written once, in the transaction of the play it belongs to.
--   TASK 5 adds a reaction card's post_reaction_kinds row here, after this one.
create function land_rows(play uuid, kind_of card_kinds, post uuid, config jsonb, caster uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if kind_of.veil is not null then
    insert into post_veils (play, post, veil, author, caster_account, ends_at)
    select land_rows.play, land_rows.post, kind_of.veil, a.character, (select c.owner from characters c where c.id = land_rows.caster), (k.payload ->> 'ends')::timestamptz
    from acts a, acts k where a.id = land_rows.post and k.id = land_rows.play
    on conflict on constraint post_veils_pkey do nothing;
  end if;
end $$;
revoke execute on function land_refusal(card_kinds, uuid, jsonb), land_rows(uuid, card_kinds, uuid, jsonb, uuid) from public, anon, authenticated, service_role;

-- spring_facts says what the landing refuses (`land_why`) and what the card withholds (`kind_veil`, read with the card's own row, so no read is added), beside everything it already says.
alter type spring_facts add attribute land_why text;
alter type spring_facts add attribute kind_veil text;

-- spring_facts (0340_conduct), reading what the landing would refuse (`land_why`, from land_refusal) for every back whatever it holds, and the card's `kind_veil` from the row it already reads. Everything else as 0340 wrote it (its
-- hidden-version reads: the Act's own words with every quote cut out, and a hidden version's body read as null).

create or replace function spring_facts(fd face_down, trigger text, by_act uuid, incoming_card text) returns spring_facts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f spring_facts;
  k card_kinds%rowtype;
  named text;
  in_character integer;
  in_thread integer;
  in_board integer;
  walked_plain text;
  raw_body text;
  walked_excerpt text;
  ic card_kinds%rowtype;
  m jsonb;
  ic_rank integer;
  up_rank integer;
  own_rank integer;
  flavor_ok boolean;
  matched boolean;
begin
  -- 1. The setter's character, and what decides whether it can act (retired, not debuted), who it belongs to and whether it is staff.
  select a.character into f.setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into f.setter_retired, f.setter_debuted, f.setter_owner, f.setter_staff from characters c where c.id = f.setter_character;
  -- 2. The back's card kind.
  select * into k from card_kinds x where x.key = fd.card;
  f.kind_play := k.play; f.kind_trap := k.trap; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.kind_skim := k.skim is not null; f.kind_scores := k.scores_as; f.kind_veil := k.veil;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, case when coalesce(version_hidden(a.id), false) then null else a.payload ->> 'body' end, t.board into f.by_kind, f.by_character, f.by_thread, raw_body, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and a.kind = 'post';
  select t.id into f.announce_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
  -- 4. The stack at the would-be target and reach, for every reach: the plays of the card still up on the Act (a post's), the layer to go on from, and the plays of it still up on
  -- the Act's character, thread and board (a play beyond a post's), counted as place_cast counts them. Which reach the card takes is then a choice among values already read.
  f.target := case f.reach when 'post' then by_act when 'character' then f.by_character when 'thread' then f.by_thread else f.by_board end;
  -- Each play found is asked whether an admin ended it, whatever card it is (card_ended is a read of its own, and the subquery cannot be flattened away, so it is made for every play found and not only
  -- for the ones of this back's card): which card is counted is chosen after the reads.
  select count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended),
         greatest(coalesce(max(l.layer) filter (where l.card is not distinct from fd.card), 0), count(*) filter (where l.card is not distinct from fd.card)) + 1,
         count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended and l.quadrant is not distinct from (fd.config ->> 'quadrant'))
    into f.up, f.layer, f.quadrant_up
  from (select k2.payload ->> 'card' as card, (k2.payload ->> 'ends')::timestamptz as ends, (k2.payload ->> 'layer')::integer as layer, card_ended(k2.id) as ended,
               k2.payload #>> '{config,quadrant}' as quadrant
        from acts k2 where k2.kind = 'card' and k2.target_act_id = by_act and not (k2.payload ? 'caught') and coalesce(k2.payload ->> 'reach', 'post') = 'post' offset 0) l;
  f.quadrant_ok := (fd.config ->> 'quadrant') = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']);
  -- The window a scored-as play would name, and whether the quoting character already has a class named for it: a play of any scored-as card made at or after the last settled window's end, not ended.
  select w.opens, w.closes, w.why into f.window_opens, f.window_closes, f.window_why from scored_as_window(now()) w;
  f.class_ok := exists (select 1 from class_kinds ck where ck.key = fd.config ->> 'class');
  select count(*) filter (where l.card = fd.card and not l.ended and l.character = f.by_character), count(*) filter (where l.card = fd.card and not l.ended and l.thread = f.by_thread),
         count(*) filter (where l.card = fd.card and not l.ended and l.board = f.by_board),
         count(*) filter (where l.scores and not l.ended and l.character = f.by_character and l.at >= (select max(x.ends_at) from settlements x)) > 0
    into in_character, in_thread, in_board, f.class_taken
  from (select k2.payload ->> 'card' as card, r.character, r.thread, r.board, card_ended(r.play) as ended, k2.created_at as at, coalesce(ck.scores_as, false) as scores
        from play_reach r join acts k2 on k2.id = r.play left join card_kinds ck on ck.key = k2.payload ->> 'card'
        where r.ends_at > now() and (r.character = f.by_character or r.thread = f.by_thread or r.board = f.by_board) offset 0) l;
  f.reach_up := case f.reach when 'character' then in_character when 'thread' then in_thread else in_board end;
  -- 4b. Whether a live ward Gimmick on the Act turns the card away: place_cast turns a cast away by the same test (ward_refusal), and a Move does not land through it either.
  f.warded := ward_refusal('post', by_act, k) is not null;
  -- 4c. What the card's landing refuses on the Act (land_refusal): the same reads, from public facts, for every back whatever it holds. A Move that is refused here does not land and its back stays set.
  f.land_why := land_refusal(k, by_act, fd.config);
  -- 5. A board's live card, whatever the card's reach.
  select max(r.ends_at) into f.live_board from play_reach r where r.board = f.by_board and r.ends_at > now() and not card_ended(r.play);
  -- 6. The named catch (a back with none reads its own card's row, so the read finds one row either way: a null key would be a read of nothing), compared with the incoming card.
  select x.key into named from card_kinds x where x.key = coalesce(fd.catches, fd.card);
  -- 6b. The back's match, and the incoming card's printed row, for every back whatever it holds (a back with no match reads the same row and asks the same questions of an empty one): the card's
  -- flavor in the match's `flavors`, its rarity at or below the match's `upTo` and at or below the back's own card's. A cast back springs on the card it names or on one its match holds.
  select * into ic from card_kinds x where x.key = incoming_card;
  m := case when jsonb_typeof(k.trap -> 'match') = 'object' then k.trap -> 'match' else '{}'::jsonb end;
  ic_rank := rarity_rank(ic.rarity); up_rank := rarity_rank(coalesce(m ->> 'upTo', 'legendary')); own_rank := rarity_rank(k.rarity);
  flavor_ok := case when jsonb_typeof(m -> 'flavors') = 'array' then (m -> 'flavors') ? ic.alignment else true end;
  matched := jsonb_typeof(k.trap -> 'match') = 'object' and ic.key is not null and flavor_ok and ic_rank <= up_rank and ic_rank <= own_rank;
  f.caught := (fd.catches is not null and fd.catches = incoming_card and named is not null) or coalesce(matched, false);
  -- 7. ONE walk of the Act's words for every back: its own visible words, and the excerpt of the quotes of the back's post (null for a cast or a visit, whose by_act holds no words). A function in a FROM
  -- clause runs once however many columns are taken from it, and both are taken here, so the walk costs the same whatever the back holds.
  select w.plain, w.excerpt, w.unquoted into walked_plain, walked_excerpt, f.by_body from bbcode_walk(raw_body, fd.post) w;
  -- A quote of a post an admin hid carries its words, so the Quotes condition does not read them (the Act's own words, with every quote cut out, are all `by_body` and Says read).
  if coalesce(quote_hidden(fd.post), false) then walked_excerpt := ''; end if;
  if raw_body is null then f.by_body := null; end if;
  -- 8. Both probes, for every back, whatever it holds: phrase_probe folds the text and compiles and runs a pattern of one shape (a back with no such condition has a pattern built around its own id, which
  -- cannot match), the Says over the Act's own words and the Quotes, on a token of its own, over the excerpt. And the Who check, against an empty list for Anyone.
  f.phrase_hit := coalesce(phrase_probe(walked_plain, fd.phrase, fd.play::text), false);
  f.passage_hit := coalesce(phrase_probe(walked_excerpt, fd.passage, fd.play::text || 'p'), false);
  f.who_hit := coalesce(f.by_character = any (coalesce(fd.who, '{}')), false);
  return f;
end $$;

-- spring_traps (0317_surfaces): a Move on a post lands only when land_refusal has nothing to say of the post it would land on, as it lands only when its stack has room and no ward turns it away.
-- A landed author veil writes no `for` (it would name the author of the post the veil hides). Everything else, the lock order included, as 0317 wrote it.

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
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its back stays set until its time, and the write that met it lands as if no
  -- back were there (acts_well_formed would refuse the spring, and with it the write). A Move that cannot land leaves its back set for the next quote.
  if f.setter_retired is not null or f.setter_debuted is null then return null; end if;
  if back_trigger = 'quote' and not lands then return null; end if;
  did := case back_trigger when 'quote' then 'landed' when 'cast' then case when f.kind_trap #>> '{outcome,kind}' = 'ride' then 'rode' else 'caught' end else 'ended' end;
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

revoke execute on function spring_facts(face_down, text, uuid, text) from public, anon, authenticated, service_role;

-- lay_sprung (0317_surfaces), writing `ends` on a play on a post whenever its card has a time up (a skim's alone before), and calling land_rows for a play on a post, as place_cast does.
-- Everything else as 0317 wrote it.

create or replace function lay_sprung(setter uuid, card text, config jsonb, target uuid, reach text, spring uuid, from_post uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind_of card_kinds%rowtype;
  staff_setter boolean;
  in_thread uuid;
  on_post uuid;
  layer integer;
  ends timestamptz;
  target_name text;
  written uuid := gen_random_uuid();
  flag text;
  w_opens timestamptz;
  w_closes timestamptz;
  draft face_down_draws%rowtype;
begin
  select * into kind_of from card_kinds k where k.key = lay_sprung.card;
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if reach = 'post' then
    select a.thread into in_thread from acts a where a.id = target;
    on_post := target;
    select greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1 into layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post';
  elsif reach = 'character' then
    select c.name into target_name from characters c where c.id = target;
    select a.thread into in_thread from acts a where a.id = from_post;
    on_post := from_post;
  elsif reach = 'thread' then
    select t.title into target_name from threads t where t.id = target;
    in_thread := target;
    select a.id into on_post from acts a where a.thread = target and a.seq = 1;
  else
    select b.name into target_name from boards_now b where b.id = target;
    select t.id into in_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
    on_post := null;
  end if;
  if reach <> 'post' then
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
    if kind_of.scores_as then
      select w.opens, w.closes into w_opens, w_closes from scored_as_window(now()) w;
      ends := w_closes;
    end if;
  elsif kind_of.lasts is not null then
    -- A card with a time up lands on a post with its `ends`, as place_cast writes it (a skim, a veil).
    ends := now() + kind_of.lasts;
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if staff_setter then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (id, character, kind, thread, target_act_id, payload)
  values (written, setter, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', '',
    'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end, 'spring', spring::text)
    || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name) else jsonb_build_object('layer', layer) end
    || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) when reach = 'post' and kind_of.lasts is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end
    || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end);
  if staff_setter then perform set_config('kayfabb.staff_writer', flag, true); end if;
  -- The card carries its setter, and its payload names the spring, which targets the post the back was set on: while an author veil is live on that post, the card is shown under the stand-in as the spring is (post_veil_cards,
  -- read by acts_public and the counts), and the true name returns with the veil. Written here, in the transaction of the card it describes, from the live veils of the spring's post.
  insert into post_veil_cards (card, post, author)
  select distinct written, v.post, v.author
  from acts s join post_veils_live v on v.veil = 'author' and v.post = s.target_act_id and v.author = lay_sprung.setter
  where s.id = lay_sprung.spring
  on conflict on constraint post_veil_cards_pkey do nothing;
  -- What a landed play on a post needs beside its Act (a veil's row): the same writer place_cast calls.
  if reach = 'post' then perform land_rows(written, kind_of, target, coalesce(config, '{}'), setter); end if;
  if kind_of.surface and reach = 'post' then
    select d.* into draft from face_down_draws d where d.play = (select (s.payload ->> 'set')::uuid from acts s where s.id = lay_sprung.spring);
    perform open_surface(written, coalesce(draft.most_live, 48));
    if draft.play is not null then
      if bit_count(draft.cells) <= draft.most then perform surface_apply(written, setter, 'draw', draft.payload, draft.cells, draft.most); end if;
      delete from face_down_draws d where d.play = draft.play;
    end if;
  end if;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  return written;
end $$;

revoke execute on function lay_sprung(uuid, text, jsonb, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;

-- place_cast (0317_surfaces), with four additions. (a) At post reach a cast card meets land_refusal (a staff post, a post a Mod Bot has been to) before anything is written, in the same words for every caster.
-- (b) A post play of a card with a time up writes `ends` whatever the card is, where a use card's and a skim's alone did. (c) A card that lands on a post calls land_rows after its Act (a veil's row), except a play a back caught.
-- (d) At character reach the stand-in is no target, and the post the card is played from is locked before the character's row (the header's lock order). Everything else, the lock order included, as 0317 wrote it. Callable by no API role, as before.

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
  landing text;
  shown uuid;
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

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
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
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = '42501'; end if;
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
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      -- The lock order is post, then visits_open, then character, everywhere (a visit's filing takes the post's row first and, in infract, its author's character after): the post the card is played from is held `for share`
      -- before the target character's row, so a card on a character and a filing on that post never hold one each and wait on the other. (Before 0400 the character came first.)
      perform 1 from acts a where a.id = from_post and a.kind = 'post' for share;
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      -- The stand-in is shown in place of an author, so a card on it would be a card on whoever it stands for.
      if target is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      -- The post it is played from is held `for share` before it is read: a veil cast on that post (which takes the row `for no key update`) checks for a card played from it after taking it, so the card and the veil
      -- are laid one at a time, and whichever is second reads what the first left (a veiled post is not its character's, so the card is refused; a post a card was played from takes no veil). The post's row is
      -- held already (above, before the character's), and a veil cast holds the post's row and takes no character's row, so the order closes no cycle.
      select a.thread, a.character into in_thread, shown from acts_public a where a.id = from_post and a.kind = 'post';
      -- A post under a live author veil is shown under the stand-in to everyone, so a card on a character played from it is a card on the stand-in whoever the caster names, the post's author included: one refusal, in the
      -- words and the code a third player meets naming the stand-in itself, and the same whoever owns the post. (A post that is not veiled is refused as it was, for a character that is not its own.)
      if shown is not null and shown is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      if in_thread is null or shown is distinct from target then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
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

  -- A card that needs words refuses a blank message in its own words, after the landing's refusals as the engine says them (decided, engine/rules/cards.ts); the message is trimmed as casterMessage trims it.
  if kind_of.needs_message is not null and btrim(said, E' \t\r\n\f\v') = '' then
    raise exception '%', kind_of.needs_message using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', (case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end) - case when kind_of.draws is not null then array['drawn'] else '{}'::text[] end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name)
              when sprung is not null and not rode then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      || case when reach = 'post' and kind_of.lasts is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- What a landed play on a post needs beside its Act (a veil's row): not for a play a back caught, which never lands.
  if reach = 'post' and (sprung is null or rode) then perform land_rows(written, kind_of, on_post, coalesce(config, '{}'), caster); end if;
  if kind_of.surface and reach = 'post' and (sprung is null or rode) then perform open_surface(written); end if;
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
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;


-- ===================================================================================== 5b. the counts ====
-- character_post_counts (0030) is publicly readable, and profile_page and record_page return it as `counts` and thread_page as `posts`: it counted a veiled post for its author, so a profile that lists one post fewer than its
-- count says proved the author has a hidden post. The count a player reads is now the projection, as acts_public is, for every reader alike: the stored table is renamed character_post_counts_base (the trigger and the lock still
-- write and take it, as before, and no API role reads it), and the count is a view over it that, while an author veil is live, takes the post, and the cards its author made on it, from the author and gives them to the stand-in.
-- Nothing stored moves when a veil lands or ends (no job runs then): the live veils are read with the count, a few rows by post_veils_ends, and the author's count is whole again by itself when the veil's time passes or an
-- admin ends its play.
-- WHAT IS MOVED IS EXACTLY WHAT acts_public SHOWS UNDER THE STAND-IN, because a profile lists what its count says, and a count that moved a row the list still shows (or the other way round) proves the author has a hidden
-- post. The count is of the Acts acts_count_character counts (a post, a spin, a card), and the projection shows under the stand-in the post itself (a post) and the cards its author made on it (a card): never a post or a
-- spin of the author's own that targets it (a quote of it, a spin from it), which acts_public leaves with the author and which moves with a veil cast on it directly (as a post of its own).
alter table character_post_counts rename to character_post_counts_base;
drop policy read_public on character_post_counts_base;
revoke all on character_post_counts_base from public, anon, authenticated;

-- What each live author veil takes: the veiled post, and the cards its author made on it (one row per post, whatever number of veils it holds). The stand-in is found by its index, as acts_public finds it.
create view character_veiled_counts as
  select v.author, 1 as posts,
         ((select count(*) from acts k where k.kind = 'card' and k.target_act_id = v.post and k.character = v.author)
          + (select count(*) from post_veil_cards c join acts k on k.id = c.card
             where c.post = v.post and c.author = v.author
               and not exists (select 1 from post_veils_live w where w.veil = 'author' and w.post = k.target_act_id and w.author = c.author)))::integer as cards
  from (select distinct l.post, l.author from post_veils_live l where l.veil = 'author') v;
-- And the change to each character's count: minus for the author, plus for the stand-in.
create view character_count_moves as
  select s.character, sum(s.posts)::integer as posts, sum(s.cards)::integer as cards
  from (
    select v.author as character, -v.posts as posts, -v.cards as cards from character_veiled_counts v
    union all
    select (select k.id from characters k where k.staff_kind = 'anonymous') as character, v.posts, v.cards from character_veiled_counts v
  ) s
  group by s.character;
-- The count as the projection shows it: the stored row (found by its key) with the change added, and the stand-in's change where the stand-in has no stored row (it never acts). Read by character_post_counts, which is what a
-- player reads, and by group_now, which is what the group a player reads is made from, so a group and a count are one figure at every moment.
create view character_counts_shown as
  select u.character, u.posts, u.spins, u.cards
  from (
    select b.character, b.posts + coalesce(m.posts, 0) as posts, b.spins as spins, b.cards + coalesce(m.cards, 0) as cards
    from character_post_counts_base b
    left join character_count_moves m on m.character = b.character
    union all
    select m.character, m.posts, 0, m.cards
    from character_count_moves m
    where m.character = (select k.id from characters k where k.staff_kind = 'anonymous')
      and not exists (select 1 from character_post_counts_base b where b.character = m.character)
  ) u;
-- What a player reads: readable as the character is, as 0031's policy said: only once it is in characters_public. (group_now reads the view above, which has no such condition: characters_public calls group_now.)
create view character_post_counts as
  select u.character, u.posts, u.spins, u.cards
  from character_counts_shown u
  where exists (select 1 from characters_public p where p.id = u.character);
revoke all on character_veiled_counts, character_count_moves, character_counts_shown, character_post_counts from public, anon, authenticated, service_role;
grant select on character_post_counts to authenticated, service_role;

-- The writers keep the stored count true, so they name the stored table: acts_count_character and backfill_character_post_counts (0030), and lock_for_quote (0148), which makes and locks the rows of a quote's setters and
-- its poster. Each is as it was written, with the table's new name.
create or replace function acts_count_character() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p integer := case when new.kind = 'post' then 1 else 0 end;
  s integer := case when new.kind = 'spin' then 1 else 0 end;
  k integer := case when new.kind = 'card' then 1 else 0 end;
begin
  insert into character_post_counts_base as c (character, posts, spins, cards) values (new.character, p, s, k)
  on conflict (character) do update set posts = c.posts + p, spins = c.spins + s, cards = c.cards + k;
  return new;
end $$;

create or replace function backfill_character_post_counts() returns void
language sql set search_path = public, pg_temp as $$
  insert into character_post_counts_base (character, posts, spins, cards)
  select a.character, count(*) filter (where a.kind = 'post'), count(*) filter (where a.kind = 'spin'), count(*) filter (where a.kind = 'card')
  from acts a where a.kind in ('post', 'spin', 'card') and a.character is not null group by a.character
  on conflict (character) do update set posts = excluded.posts, spins = excluded.spins, cards = excluded.cards
$$;

-- lock_for_quote (0148)
create or replace function lock_for_quote(poster uuid, in_thread uuid, quoting uuid) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  locked uuid[];
  setters uuid[];
  on_board uuid;
  seen uuid[];
begin
  -- The live backs seen now, which decide step 2b. A back that appears after this is found at step 3 without its 2b rows held, and does not spring on this write.
  seen := array(select f.play from face_down f where f.post = quoting and f.ends_at > now()
                and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
                and not exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = f.play::text));
  if cardinality(seen) > 0 then
    -- The quoted post first, `for share`, when a live back may spring on it (the lock order: post, then face_down, as place_set takes them; then the characters): a veil cast on the post takes its row `for no key update`
    -- and then asks land_refusal whether a back of it has sprung, and lay_sprung asks whether the post is veiled when it lays the back's card. Held here, the two are laid one at a time, and whichever is second sees the
    -- first: the cast is refused for the spring, or the card is shown under the stand-in (post_veil_cards). 0166-post-veils.sql, race 13 (f).
    perform 1 from acts a where a.id = quoting for share;
    select t.board into on_board from threads t where t.id = in_thread;
    perform 1 from characters c where c.id = poster for no key update;
    perform 1 from boards b where b.id = on_board for no key update;
  end if;
  -- Step 3: the quoted post's live, unsprung back, in `play` order, in one statement.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.setter), '{}') into locked, setters
  from (select f.play, a.character as setter from face_down f join acts a on a.id = f.play
        where f.post = quoting and f.ends_at > now()
          and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
          and not exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = f.play::text)
        order by f.play for update of f) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts_base (character)
  select distinct c from unnest(setters || poster) c order by c on conflict do nothing;
  perform 1 from character_post_counts_base where character = any (setters || poster) order by character for update;
  -- Only a back seen before step 2b springs: one that appeared since stays set for the next quote.
  return array(select u from unnest(locked) u where u = any (seen));
end $$;
revoke execute on function lock_for_quote(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- group_now (0138_group_reads), reading the count as the projection shows it (character_counts_shown, the figure character_post_counts is made of), so the group every read shows (characters_public."group", the thread page's
-- people, the presence box) and the count a player reads agree at every moment: a character whose count sits exactly on a rung's threshold drops a rung while one of its posts is veiled and returns at the veil's end, the
-- same clue the profile's list already gives (a group that held while the count above it dropped would be a mismatch anyone could read, computed from the post's veil). The stand-in itself has none (null). A group is display only: it is read, never written (nothing
-- stored moves with it; no Act, alert or ledger row is written for it; it pays or costs nothing and gates nothing), so following the count changes what is shown and nothing else. The posts rung is the one place the groups
-- read a count. Everything else as 0138 wrote it.

create or replace function group_now(in_character uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  posts integer;
  holds boolean;
  open_group text;
begin
  -- The stand-in a veil shows is no scored character, holds no rung and is no Mod Bot: no group, so no screen draws a bar (the postbit's) or a Group row (the profile's) for it, and none can say it is staff.
  if exists (select 1 from characters c where c.id = in_character and c.staff_kind = 'anonymous') then return null; end if;
  -- A group a move confers wins while the move is open (open_moves: the moves in force). Found by the character's own index (acts_group_moves, 0129) and joined to open_moves
  -- by its primary key, so the cost is the character's moves and not the instance's.
  select a.payload #>> '{params,group}' into open_group
  from acts a join open_moves o on o.move_act = a.id
  where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,character}' = in_character::text
  order by o.landed_at desc, o.move_act desc limit 1;
  if open_group is not null then return open_group; end if;
  -- Else the highest rung whose condition holds, the highest first; the default rung holds for every character, so the walk ends.
  for r in select k.key, k.condition, k.at_least from group_kinds k where k.source = 'ladder' order by k.rung desc loop
    holds := case r.condition
      when 'default' then true
      when 'posts' then coalesce((select n.posts from character_counts_shown n where n.character = in_character), 0) >= r.at_least
      when 'seasons' then (select count(*) from season_results x where x.character = in_character) >= r.at_least
      when 'staff' then exists (
        select 1 from characters c left join staff_office_now o on o.staff = c.staff
        where c.id = in_character and c.staff is not null and (c.staff_kind = 'developer' or o.office in ('boss', 'mod')))
      else null end;
    if holds is null then
      raise exception 'group "%" has condition kind %, which group_now has no case for', r.key, coalesce(r.condition, 'null') using errcode = '22023';
    end if;
    if holds then return r.key; end if;
  end loop;
  return null;
end $$;

-- profile_page, record_page and my_characters_page (profile_page and record_page: 0340_conduct, which made 0210's text again so that `a.*` of acts_public holds `hidden` and the rest; my_characters_page: 0210_screen_cosmetics), written again whole and unchanged: each reads the counts in a `begin atomic` body, which holds the relation it was made over, so the three are made again to
-- hold the view that now has the name.
create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), acts5 as (
    -- PROFILE_ROWS (engine/ui/profile/record.ts): the newest few of its own Acts, with no count.
    select a.* from acts_public a
    where a.character = in_character and a.kind in ('post', 'spin', 'card')
    order by a.created_at desc limit 5
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r where r.character = in_character
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character = in_character
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character) n),
    'standing', standing_place(in_character),
    'settled_at', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'season', (select to_jsonb(s) from current_season s limit 1),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts5 a), '[]'::jsonb),
    -- The card plays' target posts and the Turns' tallies, placed with one batched read (playLinks, turnLinks).
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts5 a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from (
      select f.number as season, r.place, r.standing, f.results_at as at
      from season_results r join seasons_finished f on f.id = r.season
      where r.character = in_character
      order by f.results_at desc, f.number desc limit 50) a), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), k as (
    select case when in_kind in ('all', 'post', 'spin', 'card', 'class', 'seasons') then in_kind else 'all' end as kind,
           least(greatest(coalesce(in_page, 1), 1), 10000) as page
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r, k
    where r.character = in_character and k.kind in ('all', 'class')
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t, k
    where t.character = in_character and k.kind in ('all', 'class')
  ), seasons_read as (
    select f.number as season, r.place, r.standing, f.results_at as at
    from season_results r join seasons_finished f on f.id = r.season, k
    where k.kind in ('all', 'seasons') and r.character = in_character
    order by f.results_at desc, f.number desc limit 50
  ), w as (
    -- The window of the character's own Acts: for `all`, from `max(0, offset - extras)` for `offset + 20 - from` rows
    -- (the extras are merged in by the client, `mergeWindow`); for one kind, the page itself; for class and seasons, none.
    select case k.kind when 'all' then array['post', 'spin', 'card'] when 'post' then array['post'] when 'spin' then array['spin']
                       when 'card' then array['card'] else array[]::text[] end as kinds,
           case when k.kind = 'all' then greatest(0, (k.page - 1) * 20 - ((select count(*) from rv) + (select count(*) from tn) + (select count(*) from seasons_read)))
                else (k.page - 1) * 20 end as from_row,
           case when k.kind = 'all' then (k.page - 1) * 20 + 20 else 20 end as base
    from k
  ), acts_read as (
    -- The kinds as an init plan, so the planner keeps the ordered scan of the character's Acts with the limit pushed down.
    select a.* from acts_public a
    where a.character = in_character and a.kind = any (((select kinds from w)::text[]))
    order by a.created_at desc
    offset (select from_row from w)
    limit (select case when k.kind = 'all' then w.base - w.from_row else 20 end from w, k)
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'kind', (select kind from k),
    'page', (select page from k),
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    -- RecordScreen reads the counters for all, post, spin and card only.
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character and (select kind from k) in ('all', 'post', 'spin', 'card')) n),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from seasons_read a), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts_read a), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts_read a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function my_characters_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'characters', coalesce((
      select jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'face', (
            select to_jsonb(cp) || jsonb_build_object('profile', (
              select to_jsonb(p) || profile_cosmetics(p.character) from (
                select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
                from character_profiles r where r.character = cp.id) p))
            from characters_public cp where cp.id = c.id),
          'counts', (select to_jsonb(n) from (select k.character, k.posts, k.spins, k.cards from character_post_counts k where k.character = c.id) n),
          'standing', (select s.standing from current_standings s where s.character = c.id),
          'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
            select v.act, v.character, v.class, v.at, v.via, v.thread from class_reveals v where v.character = c.id) r), '[]'::jsonb),
          'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from (
            select u.act, u.character, u.at, u.was from turns_announced u where u.character = c.id) t), '[]'::jsonb))
        order by c.name)
      from my_characters c), '[]'::jsonb),
    'nextSettlementAt', next_settlement_at()
  );
end;

-- ===================================================================================== 6. the reads ====
-- Each is copied from its latest definition, named above it, changing only what is named there.

-- my_cards_ended (0340_conduct) was a security-invoker view reading acts_public as the caller (0340 moved it there from `acts`, whose `payload` a player is no longer granted), and its `k.character = mine.id` is then the shown character, which a veil changes; so it is now the caller's own rows with owner rights over `acts` as 0092 wrote them. It is now the caller's own rows with owner rights, as my_reactions is: every branch starts
-- at the caller's own characters (`mine`, filtered by auth.uid()), so it reads what it read before; the post's author is named as the read shows it (what shown_author says, written out: a view's functions are run as its reader), and so is the caster of a card laid on the caller's post, read from acts_public by the play's id (a veiled post's own back lays a card that is shown under the stand-in while the veil is live, post_veil_cards; the caller's own `cast` rows keep the caller's own character). Everything else as 0092 wrote it (0340's only change was the source it read, which owner rights make unneeded), columns in the
-- same order; the grant is the same.
alter view my_cards_ended set (security_invoker = false);
create or replace view my_cards_ended as
  with mine as (select c.id from characters c where c.owner = auth.uid()),
  plays as (
    select e.id as card_end, k.id as play, k.payload ->> 'card' as card, e.created_at as at, 'cast'::text as side,
           k.character as caster, coalesce(pr.reach, 'post') as reach, k.target_act_id, k.payload ->> 'targetName' as named,
           pr.character as reach_character, pr.thread as reach_thread, pr.board as reach_board, k.character as mine_character
    from mine
    join acts k on k.character = mine.id and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    left join play_reach pr on pr.play = k.id
    where pr.play is not null or coalesce(k.payload ->> 'reach', 'post') = 'post'
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'post', k.target_act_id, null, null, null, null, p.character
    from mine
    join acts p on p.character = mine.id and p.kind = 'post'
    join acts k on k.target_act_id = p.id and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where coalesce(k.payload ->> 'reach', 'post') = 'post' and not exists (select 1 from play_reach x where x.play = k.id)
      and k.character not in (select id from mine)
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'character', k.target_act_id, k.payload ->> 'targetName', pr.character, null, null, pr.character
    from mine
    join play_reach pr on pr.character = mine.id
    join acts k on k.id = pr.play and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where k.character not in (select id from mine)
    union all
    select e.id, k.id, k.payload ->> 'card', e.created_at, 'onMine', k.character, 'thread', k.target_act_id, k.payload ->> 'targetName', null, pr.thread, null, o.character
    from mine
    join acts o on o.character = mine.id and o.seq = 1
    join play_reach pr on pr.thread = o.thread
    join acts k on k.id = pr.play and k.kind = 'card'
    join acts e on e.target_act_id = k.id and e.kind = 'card_end'
    where k.character not in (select id from mine)
  )
  select pl.card_end, pl.play, pl.card, pl.at, pl.side, pl.reach,
         case pl.reach
           when 'character' then coalesce(pl.named, (select cp.name from characters_public cp where cp.id = pl.reach_character))
           when 'thread' then coalesce(pl.named, (select th.title from threads th where th.id = pl.reach_thread))
           when 'board' then coalesce(pl.named, (select bd.name from boards bd where bd.id = pl.reach_board))
         end as target_name,
         case when pl.reach = 'post' then (select cp.name from acts pa join characters_public cp on cp.id = case when exists (select 1 from post_veils_live sv where sv.post = pa.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else pa.character end where pa.id = pl.target_act_id) end as post_author_name,
         case when pl.side = 'cast' then (select cp.name from characters_public cp where cp.id = pl.caster)
              else (select cp.name from acts_public ap join characters_public cp on cp.id = ap."character" where ap.id = pl.play) end as caster_name,
         pl.mine_character as character
  from plays pl;

-- thread_open (0351_spin_at_post, which is 0152_origin_place_board_now's with `from` and `at` in the play's origin place), naming the stand-in as a thread's first and last poster where a post's author is hidden (shown_author). thread_list is select * from it and follows. Everything else as 0351 wrote it.

create or replace view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, case when exists (select 1 from post_veils_live sv where sv.post = f.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else f.character end as first_character,
         l.id as last_act, case when exists (select 1 from post_veils_live sv where sv.post = l.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else l.character end as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread,
         case
           when o.id is null then null
           when o.kind = 'update' then jsonb_build_object('kind', 'update', 'act', o.id, 'title', o.payload ->> 'title')
           when o.kind in ('card', 'set', 'spring') then jsonb_build_object(
             'kind', 'play',
             'card', case when o.kind = 'set' then null else o.payload ->> 'card' end,
             'on', case
               when r.play is not null then case r.reach
                 when 'character' then jsonb_build_object('kind', 'character', 'id', r.character, 'name', rc.name)
                 when 'thread' then jsonb_build_object('kind', 'thread', 'id', r.thread, 'title', rt.title)
                 when 'board' then (select jsonb_build_object('kind', 'board', 'slug', n.slug, 'name', n.name) from boards_now n where n.id = r.board)
               end
               when p.kind = 'update' then jsonb_build_object('kind', 'update', 'act', p.id, 'title', p.payload ->> 'title')
               when p.seq is not null then jsonb_build_object('kind', 'post', 'thread', p.thread, 'title', pt.title, 'seq', p.seq)
               else null
             end,
             'from', case when cf.seq is not null then jsonb_build_object('kind', 'post', 'thread', cf.thread, 'title', cft.title, 'seq', cf.seq) else null end,
             'at', case when sp.seq is not null then jsonb_build_object('kind', 'post', 'thread', sp.thread, 'title', spt.title, 'seq', sp.seq) else null end)
           when o.seq is not null then jsonb_build_object('kind', 'post', 'thread', o.thread, 'title', ot.title, 'seq', o.seq)
           else null
         end as origin_place
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread
  left join acts p on p.id = o.target_act_id and o.kind in ('card', 'set', 'spring') and coalesce(o.payload ->> 'reach', 'post') = 'post'
  left join threads pt on pt.id = p.thread
  left join play_reach r on r.play = o.id
  left join characters_public rc on rc.id = r.character
  left join threads rt on rt.id = r.thread
  -- The cast-from post of a play on a character, and the post a spin was pressed at: each a probe by primary key that finds nothing for any other thread.
  left join acts cf on cf.id = o.target_act_id and o.kind = 'card' and o.payload ->> 'reach' = 'character'
  left join threads cft on cft.id = cf.thread
  left join acts sp on sp.id = case when f.kind = 'spin' then (f.payload ->> 'at')::uuid end
  left join threads spt on spt.id = sp.thread
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');

-- play_moment (0352_character_play_moment, which is 0340_conduct's reading a play on a character and answering `at`), reading the post's author as acts_public shows it (shown_author), so a moment of a play on a post whose author
-- is hidden carries nothing at its author's reach. Everything else as 0352 wrote it.

create or replace function public.play_moment(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  if on_post.kind is distinct from 'post' then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
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
                   where e.kind = 'card_end' and e.created_at <= k.created_at
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
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= k.created_at)), '[]'::jsonb),
    'recorded', recorded,
    'at', k.created_at);
end $function$;

revoke execute on function play_moment(uuid) from public, anon, authenticated;
grant execute on function play_moment(uuid) to authenticated;

-- spin_written (0351_spin_at_post), with the post a spin is pressed at held to its author as the projection shows it (shown_author): a post whose author is hidden is by the
-- stand-in, so a spin pressed at it is refused in the one sentence every other failed predicate gives, whoever wrote it. Were the true author read, a spin that went through
-- would name who wrote a veiled post. A spin refused for this is made again once the name is back (the veil ends by itself), or made without the post. Everything else as 0351
-- wrote it.

create or replace function spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[], at_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post a spin is pressed at: a post by the character a landed, live play was cast on. Public facts only; one sentence for every predicate that fails.
  if at_post is not null then
    if not exists (
      select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
      where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
        and r.reach = 'character' and p.kind = 'post' and shown_author(p.id, p.character) = r.character
        and r.ends_at > now()
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
    ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin,
          jsonb_build_object('title', title, 'body', coalesce(body, '')) || case when at_post is not null then jsonb_build_object('at', at_post) else '{}'::jsonb end)
  returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;
revoke execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid) from public, anon, authenticated;

-- spin (0351_spin_at_post), taking the post pressed `for share` before the character's row (above). Everything else as 0351 wrote it.

CREATE OR REPLACE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text, framing uuid[] DEFAULT '{}'::uuid[], at_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform acting(through);
  -- The post pressed is held `for share` before anything else is taken (the lock order is post, then visits_open, then character): not_banned takes the character's row, and a veil cast on the post takes the post's
  -- row `for no key update` and then checks for a spin pressed at it, as spin_written checks the post for a veil after this. So the two are laid one at a time, and whichever is first, the second is refused.
  if at_post is not null then perform 1 from acts a where a.id = at_post for share; end if;
  perform not_banned(through);
  return spin_written(origin, through, title, body, true, framing, at_post);
end $function$;
revoke execute on function spin(uuid, uuid, text, text, uuid[], uuid) from public, anon;
grant execute on function spin(uuid, uuid, text, text, uuid[], uuid) to authenticated;

-- spin_moment (0351_spin_at_post), reading the post's author as play_moment does (shown_author), so a spin's moment of a post whose author is hidden lists nothing at its
-- author's reach. Everything else as 0351 wrote it.

create or replace function spin_moment(spin uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
                   where e.kind = 'card_end' and e.created_at <= s.created_at
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
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= s.created_at)), '[]'::jsonb),
    'recorded', true,
    'at', s.created_at);
end $$;
revoke execute on function spin_moment(uuid) from public, anon, authenticated;
grant execute on function spin_moment(uuid) to authenticated;

-- card_target_reach (0055_card_reach), reading a post's author as the projection shows it: a post whose author is hidden has no `above.character`, so what is up at its author's reach is neither drawn on it
-- nor priced into a card played on it. Everything else as 0055 wrote it.

create or replace function card_target_reach(reach text, target uuid, from_post uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  got jsonb;
  t_thread uuid;
  t_board uuid;
  t_character uuid;
begin
  if reach = 'post' then
    got := card_target(target);
    if got is null then return null; end if;
    select shown_author(a.id, a.character), a.thread, th.board into t_character, t_thread, t_board from acts a join threads th on th.id = a.thread where a.id = target;
    return got || jsonb_build_object('above', jsonb_strip_nulls(jsonb_build_object(
      'character', case when t_character is not null then reach_effects('character', t_character) end,
      'thread', reach_effects('thread', t_thread), 'board', reach_effects('board', t_board))));
  elsif reach = 'character' then
    if not exists (select 1 from characters c where c.id = target) then return null; end if;
    select a.thread, th.board into t_thread, t_board from acts_public a join threads th on th.id = a.thread
    where a.id = from_post and a.kind = 'post' and a.character = target;
    return jsonb_build_object('reach', 'character', 'character', target, 'effects', reach_effects('character', target),
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
end $$;

revoke execute on function card_target_reach(text, uuid, uuid) from public, anon;
grant execute on function card_target_reach(text, uuid, uuid) to authenticated, service_role;

-- start_visit (0131_meeting_groups), returning null for a post whose author is hidden, as it does for a staff post, so no rule, patrol, tail, report or backfire opens a visit there. Everything else as 0131 wrote it.
-- The post's row is taken `for share` before that check (and before the advisory lock and the open row below it: the post's row comes first, as place_cast takes it first), so a visit opening and a veil cast on the post are laid
-- one at a time: place_cast takes the same row `for no key update`, which conflicts with a share lock, and checks the visits after it, as this checks the veils. Whichever is second waits for the first's commit and then reads
-- what it left (a veiled post: null; a visited post: the cast's refusal), so a post never holds both. Nothing that holds the visit's locks asks for a post's row afterwards, and a caster waiting here holds nothing a visit
-- wants (place_cast at post reach takes the post's row, then the back's face-down row, and no visit lock), so the order cannot close a cycle.

create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
  cap jsonb;
  patrol bigint;
begin
  select a.id, a.thread, t.board, a.character as author, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin') for share of a;
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return null; end if;
  -- No Mod Bot visits a post while its author is hidden: a visit names the author in its record and its filing, which is a read carrying the author. The same as a staff post: null, nothing written.
  if author_veiled(post_act) then return null; end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  -- The targeting cap (the Mod Bots design, section 8): a patrol's finding is refused for a character that staff has already punished `cap.punishments` times in `cap.days`
  -- (staff_punishments, from public Acts: patrol findings and backfires that landed or are still open). Nothing is shown to anyone; the drop is recorded on the patrol's
  -- row, once per post. Only a patrol's choice meets it: a rule break, a player's report and a tail are never refused. The character's own lock makes the count and the
  -- visit one decision, so two patrols at once do not both pass a cap with room for one.
  if ch ->> 'cause' = 'patrol' then
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.cap:' || p.author::text, 0));
    cap := mod_cap();
    if staff_punishments(p.author, (cap ->> 'days')::integer) >= (cap ->> 'punishments')::integer then
      if charge ->> 'patrol_id' ~ '^[0-9]{1,18}$' then
        patrol := (charge ->> 'patrol_id')::bigint;
        update patrols x set dropped = x.dropped || jsonb_build_array(jsonb_build_object('post', post_act, 'why', 'cap', 'staff', start_visit.staff))
        where x.id = patrol and not x.dropped @> jsonb_build_array(jsonb_build_object('post', post_act::text, 'why', 'cap'));
      end if;
      return jsonb_build_object('visit', null, 'capped', true);
    end if;
  end if;
  -- The open row is taken for update: a filing (or any end) holding it makes this wait, and then it finds the visit gone and decides afresh, never joining a visit that
  -- has ended.
  select o.visit_act into open_visit from visits_open o where o.post = post_act for update;
  same := visit_charge_repeats(post_act, ch);
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it, and the sprung trap ends the visit (trapped, by the spring): its Acts stay.
  sprung := spring_traps('visit', post_act, written);
  if sprung is not null then
    perform end_visit(written, 'trapped', (sprung ->> 'id')::uuid, 'A trap set on this post sprang as the visit began, and the visit ended.');
  end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- open_report (0114_staff_refusal_words), refusing a post whose author is hidden beside its refusal of a staff post, before anything is paid. Everything else as 0114 wrote it.

create or replace function open_report(through uuid, post uuid, reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  p record;
  bots jsonb := coalesce((select s.value from settings s where s.key = 'modBots'), '{}'::jsonb);
  price integer := coalesce((bots ->> 'reportPrice')::integer, 25);
  per_day integer := coalesce((bots ->> 'reportsPerDay')::integer, 3);
  budget integer := coalesce((bots ->> 'judgmentsPerDay')::integer, 60);
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  said text := btrim(coalesce(reason, ''));
  mod_key text;
  rid uuid;
  board record;
  me text;
begin
  caller := acting(through);
  perform not_banned(through);
  if regexp_replace(said, '[\s ​-‍⁠　﻿]', '', 'g') = '' then
    raise exception 'say why you are reporting this post' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if char_length(said) > 280 then
    raise exception 'a reason is at most 280 characters' using hint = 'kayfabb.refusal', errcode = '22001';
  end if;
  if not coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false) then
    raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = open_report.post and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then raise exception 'a post by the staff is not reported' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- A report asks a Mod Bot to visit, which names the author: refused while the author is hidden, before anything is paid, in words that say when. Public, and the same for every reporter.
  if author_veiled(open_report.post) then
    raise exception 'this post''s author is hidden until %; report it after', refusal_time(author_veil_ends(open_report.post)) using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  mod_key := beat_of(p.board);
  if mod_key is null then raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000'; end if;

  -- The checks and the write are one decision: one lock for the instance, taken before the count of the day is read.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.reports', 0));
  -- The instance's budget first, and before anything is paid: one count (the ledger's judgments and the reports in flight), and the same words for everyone.
  if judgment_load_today() >= budget then
    raise exception 'the Mods have heard all the reports they will today; reports open again after midnight UTC' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- This character's quota, and only this character's: a report refunded for a failed judgment is not one of the day's (the player may report again); one swept for
  -- never being judged is.
  if (select count(*) from acts r where r.kind = 'report' and r.character = open_report.through and r.created_at >= day_start
        and not exists (select 1 from report_refunds f where f.report_act = r.id and f.why = 'failed')) >= per_day then
    raise exception 'this character has made its % reports for today', per_day using hint = 'kayfabb.refusal', errcode = '55000';
  end if;

  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'report', p.thread, open_report.post, jsonb_build_object('reason', said)) returning id into rid;
  perform set_config('kayfabb.report_writer', '', true);
  perform wallet_spend(caller, price, 'report', rid);

  select b.id, b.name, b.premise into board from boards_now b where b.id = p.board;
  select c.name into me from characters c where c.id = through;
  return jsonb_build_object('report', rid, 'post', open_report.post, 'thread', p.thread, 'staff', mod_key, 'price', price, 'reason', said,
    'board', jsonb_build_object('id', board.id, 'name', board.name, 'premise', board.premise),
    'reporter', jsonb_build_object('id', through, 'name', me));
end $$;

revoke execute on function open_report(uuid, uuid, text) from public, anon;
grant execute on function open_report(uuid, uuid, text) to authenticated, service_role;

-- thread_page (0349_thread_page_under, which is 0340_conduct's text with the nested replies, `under`, `cut` and `kept`), also answering `veiled`: the caller's own veiled posts among the page's, its nested replies included (my_veiled_posts), beside `faces`. Everything else as 0349 wrote it.

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
    -- The caller's own veiled posts among the page's: the author's player learns that a post shown under the stand-in is theirs from here alone (my_veiled_posts, their own rows).
    'veiled', (select coalesce(jsonb_agg(jsonb_build_object('post', v.post, 'character', v.character, 'play', v.play, 'ends_at', v.ends_at) order by v.post), '[]'::jsonb)
               from my_veiled_posts v where v.post in (select p.id from posts p)),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
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

revoke all on function thread_page(uuid, integer, integer, integer, text[]) from public, anon;
grant execute on function thread_page(uuid, integer, integer, integer, text[]) to authenticated;

-- presence_listed (0084_staff_presence), listing no stand-in: it is a staff character whose posts acts_public shows, and a box that listed it for presenceWindow after a hidden post would put "Anonymous" among the staff that
-- were just here. Everything else as 0084 wrote it.

create or replace view presence_listed as
  select c.id, c.name, p.place_kind, p.place, p.board, p.place_since, p.online_since, p.seen_at, false as staff
  from presence p join characters c on c.id = p.character
  where c.debuted_at is not null and c.retired_at is null
    and not exists (select 1 from presence_hidden h where h.character = p.character)
  union all
  select c.id, c.name, 'thread'::text, a.thread, t.board, a.last_at, a.last_at, a.last_at, true
  from characters c
  cross join lateral (
    select x.thread, max(x.created_at) as last_at
    from acts_public x
    where x.character = c.id and x.kind = 'post'
      and x.created_at >= now() - coalesce(span_interval((select s.value from settings s where s.key = 'presenceWindow')), interval '0')
    group by x.thread
  ) a
  join threads t on t.id = a.thread
  where c.staff is not null and c.staff_kind not in ('developer', 'anonymous') and c.debuted_at is not null and c.retired_at is null;

revoke all on presence_listed from anon, authenticated;

-- pool_named and pool_signals (0088_pool_signals), leaving the stand-in out of the staff they list: a Mod Bot persona is chosen from these, and the stand-in is no persona. Everything else as 0088 wrote it (owner and grants kept).

create or replace function pool_named(timestamptz, timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  names as (
    select cp.staff, regexp_replace(name_skeleton(cp.name), '\s+', ' ', 'g') as folded
    from characters_public cp
    where cp.staff is not null and cp.office is distinct from 'developer' and cp.office is distinct from 'anonymous'
  ),
  pat as (
    select '(?<![[:alnum:]])(' || string_agg(regexp_replace(n.folded, '([^[:alnum:][:space:]])', '\\\1', 'g'), '|' order by length(n.folded) desc, n.folded)
           || ')(?![[:alnum:]])' as re
    from names n where n.folded <> ''
  ),
  posts as (
    select p.id, p.thread, p.created_at, c.staff as author_staff, regexp_replace(coalesce(p.current_payload ->> 'body', ''), '\s+', ' ', 'g') as body
    from acts_public p join characters_public c on c.id = p.character
    where p.kind = 'post' and p.created_at >= $1 and p.created_at < $2
  ),
  -- The folds work a character at a time and never reach across a space, so a post's folded words are its words' folds put back with the
  -- spaces between: each distinct word of the day is folded once, not each occurrence. The test file holds this to the folds themselves.
  folded as materialized (
    select w.word, name_skeleton(w.word) as folded
    from (select x.word from posts p cross join lateral unnest(string_to_array(p.body, ' ')) x(word) group by x.word) w
  ),
  words as (
    select p.id, p.thread, p.created_at, p.author_staff,
           (select string_agg(f.folded, ' ' order by x.n) from unnest(string_to_array(p.body, ' ')) with ordinality x(word, n) join folded f on f.word = x.word) as folded
    from posts p
  ),
  hits as (
    select distinct p.id, p.thread, p.created_at, n.staff
    from words p
    cross join pat
    cross join lateral regexp_matches(p.folded, pat.re, 'g') m
    join names n on n.folded = m[1]
    where n.staff is distinct from p.author_staff
  ),
  ranked as (
    select h.*, row_number() over (partition by h.staff order by h.created_at desc, h.id desc) as rn, count(*) over (partition by h.staff) as n from hits h
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff', r.staff, 'act', r.id, 'thread', r.thread, 'n', r.n) order by r.staff, r.created_at desc, r.id desc), '[]'::jsonb)
  from ranked r where r.rn <= 5
$$;

create or replace function pool_signals(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  days integer := coalesce(((setting('pool') ->> 'priorityDays'))::integer, 28);
  boss text := current_boss();
  hours numeric;
  result jsonb;
begin
  if since is null or until is null or until <= since then
    raise exception 'signals cover a window that ends after it starts' using errcode = '22023';
  end if;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  -- The window's move_end and move_keep Acts, each with the move's owner when it fell: move_owner (0051) for an end, the latest keep
  -- else the writer; for a keep, the owner before it (the latest earlier keep, else the writer). Read from the public views, as the
  -- role may; supabase/tests/0090-pool-signals.sql checks an end's owner against move_owner itself.
  ev as (
    select e.id as act, e.thread, e.created_at, e.target_act_id as move,
           case when e.kind = 'move_keep' then 'kept' else e.payload ->> 'why' end as how,
           e.payload ->> 'by' as by_whom,
           coalesce(
             (select kc.staff from acts_public k join characters_public kc on kc.id = k.character
               where k.kind = 'move_keep' and k.target_act_id = e.target_act_id
                 and (e.kind = 'move_end' or (k.created_at, k.id) < (e.created_at, e.id))
               order by k.created_at desc, k.id desc limit 1),
             (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move')) as owner,
           (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move') as maker
    from acts_public e
    where e.kind in ('move_end', 'move_keep') and e.created_at >= since and e.created_at < until
  )
  select jsonb_build_object(
    'named', pool_named(since, until),
    'quoted', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', q.staff, 'act', q.act, 'thread', q.thread, 'n', q.n) order by q.staff, q.created_at desc, q.act desc), '[]'::jsonb)
      from (
        select tc.staff, w.id as act, w.thread, w.created_at,
               row_number() over (partition by tc.staff order by w.created_at desc, w.id desc) as rn,
               count(*) over (partition by tc.staff) as n
        from acts_public w
        join acts_public tgt on tgt.id = w.target_act_id
        join characters_public tc on tc.id = tgt.character
        where w.kind = 'post' and w.created_at >= since and w.created_at < until and w.character is not null
          and tgt.kind = 'post' and tc.staff is not null and tc.office is distinct from 'developer' and tc.office is distinct from 'anonymous' and w.character <> tgt.character
      ) q where q.rn <= 5),
    'legacy', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', l.owner, 'maker', l.maker, 'move', l.move, 'act', l.act, 'thread', l.thread, 'how', l.how, 'n', l.n) order by l.maker, l.created_at desc, l.act desc), '[]'::jsonb)
      from (
        select v.*, row_number() over (partition by v.maker order by v.created_at desc, v.act desc) as rn, count(*) over (partition by v.maker) as n
        from ev v where v.owner is not null and v.maker is not null and (v.owner is distinct from boss or v.maker is distinct from boss)
      ) l where l.rn <= 5),
    'reversals', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', v.owner, 'move', v.move, 'act', v.act, 'thread', v.thread) order by v.created_at desc, v.act desc), '[]'::jsonb)
      from ev v where v.owner is not distinct from boss and v.owner is not null and v.how = 'reversed' and v.by_whom = 'admin'),
    'handovers', (
      select coalesce(jsonb_agg(jsonb_build_object('season', h.season, 'outgoing', h.outgoing, 'boss', h.boss, 'how', h.how, 'at', h.landed_at,
                                                   'act', arr.id, 'thread', arr.thread) order by h.landed_at, h.season), '[]'::jsonb)
      from season_handovers h left join acts_public arr on arr.id = h.arrival_act where h.landed_at >= since and h.landed_at < until),
    'hot', (
      select coalesce(jsonb_agg(jsonb_build_object('thread', x.thread, 'board', x.board, 'heat', x.heat, 'starter', x.starter,
                                                   'starterStaff', x.starter_staff, 'staffStarted', x.starter_staff is not null,
                                                   'authors', x.authors, 'boardMaker', null) order by x.posts desc, x.thread), '[]'::jsonb)
      from (
        select tl.id as thread, tl.board, h.posts, round(h.posts / hours, 2) as heat, tl.first_character as starter, sc.staff as starter_staff,
               (select coalesce(jsonb_agg(jsonb_build_object('character', a.character, 'posts', a.n) order by a.n desc, a.character), '[]'::jsonb)
                from (select p.character, count(*) as n from acts_public p
                      where p.thread = tl.id and p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
                      group by p.character order by n desc, p.character limit 10) a) as authors
        from (
          select p.thread, count(*) as posts from acts_public p
          where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
          group by p.thread
        ) h
        join thread_list tl on tl.id = h.thread
        left join characters_public sc on sc.id = tl.first_character and sc.office is distinct from 'developer' and sc.office is distinct from 'anonymous'
        order by h.posts desc, tl.id
        limit threads_cap
      ) x),
    'tallies', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', t.staff, 'posts', t.posts, 'reactions', t.reactions) order by t.staff), '[]'::jsonb)
      from (
        select c.staff, count(a.id) as posts, coalesce(sum(r.n), 0)::bigint as reactions
        from characters_public c
        left join acts_public a on a.character = c.id and a.kind = 'post' and a.created_at >= until - days * interval '1 day' and a.created_at < until
        left join lateral (select sum(tt.count) as n from reaction_tallies tt where tt.act = a.id) r on true
        where c.staff is not null and c.office is distinct from 'developer' and c.office is distinct from 'anonymous'
        group by c.staff
      ) t)
  ) into result;
  return result;
end $$;

-- system_digest (0325_digest_boards), reporting the stand-in as the plain character it is shown as, not as staff. Everything else as 0325 wrote it (owner and grants kept).

create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, k.quadrant, sum(t.count)::integer as n
    from w join reaction_tallies t on t.act = w.id join reaction_kinds k on k.key = t.kind
    group by w.thread, k.quadrant
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.created_at
    from w left join reaction_tallies t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies t on t.act = a.id
    join reaction_kinds k on k.key = t.kind
    where mm.dkind = 'quadrantOnBoard' and k.quadrant = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- my_draws (0317_surfaces), naming the washer of a drawing as the post shows its author: a wash is the post's own character's alone, so on a post whose author is hidden the washer is the author, and the caller's log
-- would say who it is. A cut row's `character` is what shown_author(post, washer) says, the stand-in while an author veil is live and the washer as before when none is, written out here (the functions a view calls are run as its reader, who may not run shown_author), against the list of live veils' posts read once, not a probe for each row. Everything else as 0317 wrote it (the caller's own drawings,
-- the same columns, the same grants).
create or replace view my_draws as
  select m.act, 'draw'::text as kind, m.play, m.post, m.character, c.id as mine, m.at, m.cells
  from characters c
  join surface_marks m on m.character = c.id and m.kind = 'draw'
  where c.owner = auth.uid()
  union all
  select u.wash, 'cut'::text, u.play, u.post, case when u.post = any (array(select v.post from post_veils_live v where v.veil = 'author')) then (select k.id from characters k where k.staff_kind = 'anonymous') else u.washer end, c.id, u.at, sum(u.took)::integer
  from characters c
  join surface_cuts u on u.drawer = c.id
  where c.owner = auth.uid()
    and not exists (select 1 from characters x where x.id = u.washer and x.owner = auth.uid())
  group by u.wash, u.play, u.post, u.washer, c.id, u.at;

-- my_group_moves (0340_conduct, which is 0157's reading acts_public, since a signed-in player is granted no `acts.payload` there), a security-invoker view that read `ru.*` of the appeal's ruling and so asked for `acts.character`, which a signed-in
-- player is no longer granted here either: it reads the two columns it shows, through acts_public. Everything else as 0340 wrote it (the caller's own rows, security invoker; none of these Acts is a post, so acts_public's concealment holds them as they were).

create or replace view my_group_moves with (security_invoker = true) as
  select m.id as move, c.id as character, m.created_at as at, m.thread, m.seq, m.payload #>> '{params,group}' as "group",
         case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end as board,
         (select b.name from boards_now b where b.id = case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end) as board_name,
         move_expires_at(m.id) as expires_at, case when jsonb_typeof(m.payload -> 'expires_at') = 'string' then (m.payload ->> 'expires_at')::timestamptz end as landed_until,
         case when jsonb_typeof(m.payload #> '{params,checkAt}') = 'string' then (m.payload #>> '{params,checkAt}')::timestamptz end as check_at,
         m.payload #>> '{demand,kind}' as demand,
         coalesce(nullif(m.payload ->> 'office', ''), 'boss') as office,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         r.payload ->> 'verdict' as ruling, r.created_at as ruled_at,
         case when jsonb_typeof(r.payload -> 'until') = 'string' then (r.payload ->> 'until')::timestamptz end as ruled_until,
         nullif(r.payload ->> 'office', '') as ruled_office
  from characters c
  join acts_public m on m.kind = 'move' and m.payload ->> 'kind' = 'conferGroup' and m.payload #>> '{params,character}' = c.id::text
  left join acts_public e on e.kind = 'move_end' and e.target_act_id = m.id
  left join lateral (
    select ru.payload, ru.created_at from acts_public ap join acts_public ru on ru.kind = 'appeal_ruling' and ru.target_act_id = ap.id
    where ap.kind = 'appeal' and ap.target_act_id = m.id order by ru.created_at desc, ru.id desc limit 1
  ) r on true
  where c.owner = auth.uid();


-- ===================================================================================== 7. search ====
-- post_search keeps the true `character` (its indexes and the plans 0117 was tuned on are untouched), and a signed-in player is no longer granted the column: the search shows a veiled post under the stand-in
-- and finds it by the stand-in, through the two functions that run the built text, now definers (their text is built from typed literals alone, every value through %L, so what they run as the owner is
-- never a caller's). The conditions and the select lists are the ones that change; search_matches_sql, search_walk_sql and search_match_conds stay invokers, as 0117 wrote them, and run as the definer that
-- calls them. search_thread_matches counts by author as the conditions do, so it reads the column and is a definer too. Nothing differs by who asks: a veil is a public fact of the post.
revoke select on post_search from authenticated;
grant select (act, thread, board, first, created_at, words) on post_search to authenticated;

-- search_match_conds (0117_search), with the author condition read through the veil: for an author that is not the stand-in, the author's posts that no live author veil is on; for the stand-in, the posts a live
-- author veil is on (author_veiled's probe, written out). Everything else as 0117 wrote it.
create or replace function search_match_conds(al text, tsq tsquery, author uuid, from_at timestamptz, to_at timestamptz, titles_only boolean)
returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  conds text[] := '{}';
begin
  if tsq is not null and numnode(tsq) = 0 then
    conds := conds || 'false'::text;                  -- only stop words or symbols: no lexeme to find, so nothing is found
  elsif tsq is not null then
    conds := conds || format('%I.words @@ %L::tsquery', al, tsq::text);
    if titles_only then conds := conds || format('ts_filter(%I.words, %L) @@ %L::tsquery', al, '{a}', tsq::text); end if;
  end if;
  -- A post under a live author veil is the stand-in's, and its true author's no more: a search by the author does not find it and a search by the stand-in does. The condition is author_veiled's own probe of
  -- post_veils_post, written out as a (not) exists and not as a call: a call to a function is a filter the planner can only guess the share of, and with the guess it turned the walk's per-match probe (one row
  -- read to find a thread's next match) into a read of the thread's rest, a sort, on a table 0116's bounds were measured on; an exists is an anti-join it costs from post_veils' own statistics.
  if author is not null then
    if author is not distinct from stand_in() then conds := conds || format('exists (select 1 from post_veils_live v where v.post = %I.act and v.veil = %L)', al, 'author');
    else conds := conds || format('%I."character" = %L::uuid', al, author) || format('not exists (select 1 from post_veils_live v where v.post = %I.act and v.veil = %L)', al, 'author'); end if;
  end if;
  if from_at is not null then conds := conds || format('%I.created_at >= %L::timestamptz', al, from_at); end if;
  if to_at is not null then conds := conds || format('%I.created_at < %L::timestamptz', al, to_at); end if;
  if titles_only then conds := conds || format('%I.first', al); end if;
  return conds;
end $$;

-- search_matches_sql (0117_search), giving shown_author(p.act, p."character") as `character` in its two select lists. Everything else as 0117 wrote it.
create or replace function search_matches_sql(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, newest boolean, after_at timestamptz, after_act uuid, lim integer)
returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  tsq tsquery := case when btrim(coalesce(q, '')) = '' then null else websearch_to_tsquery(search_lang(), q) end;
  dir text := case when coalesce(newest, true) then 'desc' else 'asc' end;
  updates uuid := search_updates_thread();
  conds text[] := array['true'] || search_match_conds('p', tsq, author, from_at, to_at, titles_only);
begin
  if after_at is not null then
    conds := conds || format('(p.created_at, p.act) %s (%L::timestamptz, %L::uuid)', case when dir = 'desc' then '<' else '>' end, after_at,
                             coalesce(after_act, case when dir = 'desc' then 'ffffffff-ffff-ffff-ffff-ffffffffffff' else '00000000-0000-0000-0000-000000000000' end::uuid));
  end if;
  if updates is not null then conds := conds || format('p.thread <> %L::uuid', updates); end if;
  -- With a word and a board the board is asked for as its text, which only post_search_board_words and post_search_first_words hold; with no word it is the column, which the keyset btrees walk.
  if board is not null then conds := conds || case when tsq is null then format('p.board = %L::uuid', board) else format('p.board::text = %L', board::text) end; end if;
  -- An author with no board: the author's own posts are the bound. The word's index is closed to the plan (the word is read through a concatenation, which no index holds), so the only way to the matches is the author's
  -- index, post_search_character, whose rows are the author's own (A), and not the word's matches in every board, which the planner chose for a common word when it had no statistics for the author's column.
  if tsq is not null and author is not null and board is null then
    conds := array_replace(conds, format('p.words @@ %L::tsquery', tsq::text), format('(p.words || %L::tsvector) @@ %L::tsquery', '', tsq::text));
  end if;
  if tsq is null or not (board is not null or coalesce(titles_only, false)) then
    -- The matches in order, off the keyset btrees (post_search_newest and its board, first-post and character siblings): the walk stops at `lim`. With no word, the filters alone, bounded by the rows it passes, which they
    -- keep to a share of the table. With a word and neither a board nor titles only, the word is a filter on that walk or the planner finds its matches through the word's index and sorts them, and either way a broad
    -- word costs what a narrow one does: a common word finds its `lim` matches at the newest rows (the page or the pool, whatever the instance holds), a rare one reads the few rows it is in (post_search_words).
    -- With a word and an author, the word is closed to every index (above), so this walk goes down the author's keyset btree (post_search_character) and stops at `lim`: a common word reads about the page, a rare one
    -- reads the author's posts (A) to find its few, the price of a plan that no statistics can turn toward the word's matches in every board.
    return format('select p.act, p.thread, p.board, t.title, shown_author(p.act, p."character") as "character", p.created_at, p.words from post_search p join threads t on t.id = p.thread where %s order by p.created_at %s, p.act %s limit %s',
                  array_to_string(conds, ' and '), dir, dir, greatest(coalesce(lim, 0), 0)::integer);
  end if;
  -- With a word and a board, or titles only: the word's matches in that board, or in the first posts, are found first and ordered after. The matches are a `materialized` CTE with no ORDER BY, so the only plans open to the
  -- planner for it are the ones that find the matches (the GIN indexes on the word, with the board where one is given, or its first posts), and none of them can walk a keyset btree in time order and drop rows that do not
  -- hold the word. Without this the order by ... limit offered the planner that walk, and whether it took it depended on its estimate of how common the word is: a rare word estimated common, in a board with none of it, read
  -- every post of the board to find nothing (supabase/tests/0116-search.sql, BOUND-2). Now the rows read are the filter's own matches (M) at most, whatever the statistics say: the worst case of a word found in
  -- every post of the board is the cost of sorting M; a request asks for its page and for its count separately (search_posts, search_threads), so it sorts M twice. A board or titles only is what keeps M to a share of the instance; with
  -- neither, M is the word's matches in every board, and sorting them is the cost the walk above does not pay. The thread's title is joined after the limit, to the rows that stay.
  return format('with m as materialized (select p.act, p.thread, p.board, shown_author(p.act, p."character") as "character", p.created_at, p.words from post_search p where %s) '
                'select o.act, o.thread, o.board, t.title, o."character", o.created_at, o.words '
                'from (select * from m order by m.created_at %s, m.act %s limit %s) o join threads t on t.id = o.thread order by o.created_at %s, o.act %s',
                array_to_string(conds, ' and '), dir, dir, greatest(coalesce(lim, 0), 0)::integer, dir, dir);
end $$;

-- search_matches and search_walk (0117_search), definers with the search_path pinned ending in pg_temp, as the text they run is typed literals alone. Their bodies are as 0117 wrote them; the grants are 0117's.
create or replace function search_matches(p_q text, p_author uuid, p_board uuid, p_from_at timestamptz, p_to_at timestamptz, p_titles_only boolean, p_newest boolean, p_after_at timestamptz, p_after_act uuid, p_lim integer)
returns table (act uuid, thread uuid, board uuid, title text, "character" uuid, created_at timestamptz, words tsvector)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query execute search_matches_sql(p_q, p_author, p_board, p_from_at, p_to_at, p_titles_only, p_newest, p_after_at, p_after_act, p_lim);
end $$;

create or replace function search_walk(p_q text, p_author uuid, p_board uuid, p_from_at timestamptz, p_to_at timestamptz, p_titles_only boolean, p_newest boolean, p_after_at timestamptz, p_after_act uuid, p_want integer, p_budget integer)
returns table (act uuid, thread uuid, board uuid, title text, "character" uuid, created_at timestamptz, stop boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  read_n integer := 0;
  kept integer := 0;
  last_at timestamptz;
  last_act uuid;
begin
  if coalesce(p_want, 0) <= 0 or coalesce(p_budget, 0) <= 0 then return; end if;
  for r in execute search_walk_sql(p_q, p_author, p_board, p_from_at, p_to_at, p_titles_only, p_newest, p_after_at, p_after_act, p_budget) loop
    if read_n >= p_budget then          -- a match beyond the budget: the walk stopped short, and resumes after the last match it read
      act := last_act; thread := null; board := null; title := null; "character" := null; created_at := last_at; stop := true;
      return next;
      return;
    end if;
    read_n := read_n + 1; last_at := r.created_at; last_act := r.act;
    if r.is_key then
      act := r.act; thread := r.thread; board := r.board; title := r.title; "character" := r."character"; created_at := r.created_at; stop := false;
      return next;
      kept := kept + 1;
      if kept >= p_want then return; end if;
    end if;
  end loop;
end $$;

-- search_thread_matches (0117_search), a definer, counting a thread's matches by author through the veil as search_match_conds does. Everything else as 0117 wrote it.
create or replace function search_thread_matches(thread uuid, tsq tsquery, author uuid, from_at timestamptz, to_at timestamptz, titles_only boolean) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) from (
    select 1 from post_search p2
    where p2.thread = $1
      and ($2 is null or p2.words @@ $2)
      and (not coalesce($6, false) or $2 is null or ts_filter(p2.words, '{a}') @@ $2)
      and ($3 is null or case when $3 is not distinct from stand_in() then author_veiled(p2.act) else p2."character" = $3 and not author_veiled(p2.act) end)
      and p2.created_at >= coalesce($4, '-infinity') and p2.created_at < coalesce($5, 'infinity')
      and (not coalesce($6, false) or exists (select 1 from acts_public f where f.id = p2.act and f.seq = 1))
    limit 101) z
$$;


-- ===================================================================================== 7. the model ====
-- claim_card_writes (0340_conduct, which is 0149's with the post's words read in their public form), naming the post's author as acts_public shows it (shown_author): the stand-in while an author veil is up on the post, else the character.
-- The model is handed the author's name for the post a writing card lands on, and what it writes is posted, so a model handed a veiled post's true author could write that name into words everyone reads ("The model reads the stand-in too,
-- since its words are posted", the plan's decisions). The job carries a name and nothing else of the author (no id, pronouns, class, group or owner), and the posts shown before it come from acts_public and characters_public, which
-- already name the stand-in. The inner join is safe: a veil is only ever cast while the stand-in exists (land_refusal). Everything else as 0340 wrote it; its grants (service role alone, 0149) are kept by the replacement.
-- Every other road a model reads a post's author by was read at its latest definition and says so in supabase/tests/0166-post-veils.sql, section 15: pool_thread, patrol_sample, system_digest, pool_signals and card_target_reach read
-- acts_public (the stand-in), a veiled post is never visited, reported or sampled, and the rest name characters and no post's author.

create or replace function claim_card_writes(most integer, only_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nearby integer := coalesce((((select s.value from settings s where s.key = 'pool') ->> 'chatterThreadPosts'))::integer, 8);
  claimed jsonb;
begin
  delete from card_writes w where w.play in (
    select x.play from card_writes x where card_ended(x.play) and (claim_card_writes.only_post is null or x.post = claim_card_writes.only_post) for update skip locked);
  with picked as materialized (
    select c.play from card_writes c join acts a on a.id = c.play
    where (c.claimed_until is null or c.claimed_until < clock_timestamp()) and c.not_before <= clock_timestamp() and not card_ended(c.play)
      and (claim_card_writes.only_post is null or c.post = claim_card_writes.only_post)
      and not exists (select 1 from card_writes e join acts ea on ea.id = e.play
                      where e.post = c.post and e.play <> c.play and not card_ended(e.play) and (ea.created_at, ea.id) < (a.created_at, a.id))
    order by c.queued_at, c.play limit greatest(claim_card_writes.most, 0) for update of c skip locked
  ), taken as (
    update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes', attempts = w.attempts + 1, version = post_version(w.post)
    from picked where w.play = picked.play
    returning w.play, w.post, w.version, w.attempts, w.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'play', t.play, 'version', t.version, 'post', t.post, 'thread', pa.thread, 'attempts', t.attempts,
      'card', pl.payload ->> 'card', 'config', coalesce(pl.payload -> 'config', '{}'::jsonb), 'tokens', (pl.payload ->> 'tokens')::integer,
      'author', ch.name, 'body', own_words(case when version_hidden(v.id, pa.id) then null else v.payload ->> 'body' end), 'title', th.title,
      'before', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'body', x.body) order by x.seq), '[]'::jsonb)
                 from (select n.seq, cn.name,
                              own_words(case when n.hidden then null else coalesce((select e.payload ->> 'body' from acts e where e.kind = 'edit' and e.target_act_id = n.id order by e.created_at desc, e.id desc limit 1), na.payload ->> 'body') end) as body
                       from acts_public n join acts na on na.id = n.id join characters_public cn on cn.id = n.character
                       where n.thread = pa.thread and n.kind = 'post' and n.seq < pa.seq
                       order by n.seq desc limit greatest(nearby, 0)) x),
      'earlier', (select coalesce(jsonb_agg(jsonb_build_object('play', q.id, 'text', q.text) order by q.created_at, q.id), '[]'::jsonb)
                  from (select ea.id, ea.created_at,
                          coalesce((select x.text from card_texts x where x.play = ea.id and x.version = t.version and x.text is not null),
                                   (select x.text from card_texts x where x.play = ea.id and x.text is not null order by x.created_at desc, x.id desc limit 1)) as text
                        from live_writing_plays(t.post) lp join acts ea on ea.id = lp
                        where (ea.created_at, ea.id) < (pl.created_at, pl.id)) q
                  where q.text is not null)
    ) order by t.queued_at, t.play), '[]'::jsonb) into claimed
  from taken t
  join acts pl on pl.id = t.play
  join acts pa on pa.id = t.post
  join characters ch on ch.id = shown_author(pa.id, pa.character)
  join threads th on th.id = pa.thread
  join acts v on v.id = t.version;
  return claimed;
end $$;


-- ===================================================================================== grants ====
-- Every helper above is for no API role: the views that read the veils own their rights and call none of them (a view's functions are run as its reader, so acts_public, thread_open and
-- my_cards_ended write out what stand_in() and shown_author() say), and the definer functions that call them own theirs. land_refusal and land_rows are called by place_cast and the springs alone.
revoke execute on function stand_in(), shown_author(uuid, uuid), author_veil_ends(uuid), author_veiled(uuid), post_veils_append_only() from public, anon, authenticated, service_role;

-- The three helpers that build and run a search's text (0117 granted them to signed-in players, who never call them: the screens' reads go through search_matches and search_walk, definers that run them as their owner)
-- now call stand_in() and shown_author(), which no API role may execute, so a direct call by a player could only fail. They are for no API role, as the helpers above are.
revoke execute on function search_match_conds(text, tsquery, uuid, timestamptz, timestamptz, boolean), search_matches_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer),
  search_walk_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
