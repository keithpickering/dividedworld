-- Face-down Moves (docs/plans/2026-11-07-face-down-moves-plan.md; the design is docs/plans/2026-11-07-face-down-moves-design.md). One migration for the whole plan: this file is
-- written section by section, one task at a time, so more sections follow the ones below; each section opens with a rule line naming its task.
--
-- Section: the schema (Task 3; design sections 4, 5 and 9).
--
--   face_down.catches / face_down.phrase   the card a Trap Card waits for (a key of card_kinds), or the phrase a Move's landing needs in the quoting post's own words. A row holds at most one
--                           of them (face_down_one_of); a back set before this holds neither, and no row is updated to hold one (face_down's append-only triggers stay). A phrase is not empty.
--   card_kinds_trap_shape   a trap is {trigger: {on}} with `on` a cast or a visit: a Gimmick's alone. A Move's trigger is the engine's (a quote), never a card's; reaction, reply, outcomes,
--                           payouts and strikes are gone. NOT VALID because the only rows with the old shape are test cards (no instance is deployed); validating would stop this migration on a database that holds one, while old card_kinds rows are never rechecked, only a row written again (the seed's upsert included) is checked.
--   card_kinds_problem      holds engine/rules/instance.ts's rules again, in its words: "has a trap, and only a Gimmick does" and "springs on <on>; a Gimmick springs on cast or visit". That a cast Gimmick
--                           names a catch, and that a set phrase is a Move's, are functions of the engine's CardRules, so they stay with instanceProblems. seed_instance (0132) already writes
--                           `trap` as the instance gave it, so it is not replaced.
--   card_ledger.kind        gains `caught`: a card a Trap Card took, in the setter's own ledger; `act` is the spring, and it costs nothing, as a bought row has no Act and a played row has its card's.
--   card_held(account, card)   is the one hand count: bought plus caught less played. It is security invoker, so a signed-in caller counts their own rows (card_ledger's `own` policy) and reads 0 for
--                           any other account's, while play_card, set_card and buy_card (definer) get the true count of the account they act for. play_card and set_card (0104) call it where they
--                           counted inline; so does my_cards. The booster packs plan (docs/plans/2026-11-04-booster-packs-plan.md) also gives the hand one function: whichever lands second adds its kind to the other's.
--   my_cards                reads the hand through card_held, still security_invoker and the caller's own rows.
--   my_face_down            returns `catches` and `phrase` (last) to the setter. my_card_ledger (0075) already returns every kind the caller's account holds, so a `caught` row reaches the log with
--                           no change to it.
--
-- Copied from their latest definitions: play_card (nine arguments) from 0104_warn_bar.sql (and set_card, in the setting section below), with the inline hand count replaced by card_held and nothing else changed, the lock order
-- (0075's header, steps 1 to 6) included: step 1 (the player's accounts row) is still taken before the count; card_held takes no lock. card_kinds_problem from 0108_interception.sql, my_face_down
-- from 0078_reply_passes.sql, my_cards from 0006_cards.sql. buy_card is 0006's, its reported `held` now from card_held; no inline count of a hand is left.
-- Masks. A back's catch and phrase are the setter's alone: face_down is read through its `own` policy and my_face_down through the caller's account, and neither is in an Act, a projection or
-- card_target. card_held answers a signed-in caller for their own account alone (row security: any other account's count reads 0) and the definer functions that spend a card for the account they act for; no anon role executes it.
-- Ways out. Unchanged and none added by the schema: a back springs once or ends at setLasts; a caught card is a card in the setter's hand like any other.
-- Append-only. Nothing here updates a face_down or card_ledger row. A caught card is one more ledger row beside the caster's `played` row.
--
-- Section: setting a Move (Task 5; design sections 1, 4 and 5).
--
--   set_card(who, card, through, target, config, price, catches, phrase)   and place_set(setter, card, target, config, payer, price, catches, phrase) take what the engine's decideSet
--                           returned (engine/rules/cards.ts): a Move (cast) or a Gimmick (set) is set face down, a Use is refused ("<card> is used on your own post"), and the back stores
--                           `catches` and `phrase`. `catches` is a cast Gimmick's alone and must name a card kind that is cast on a post ("<card> names a card that is cast on a post"); `phrase` is a
--                           Move's alone and is not blank ("<card> needs a phrase to wait for"). Both default to null, so a caller that sets a card with neither (a Bluff, a visit Gimmick, a back from before
--                           this) is unchanged. A cast Gimmick set with no catch is refused ("<card> names no card to catch", Task 6: the spring reads only a named catch, so such a back could catch nothing); a back set that way before this still exists, names none and catches nothing. The act function (supabase/functions/act/core.ts) passes the
--                           two from the card's own rules; set_card is callable by the service role alone, so a caller's request never reaches them.
--   staff_set_card(staff_key, card, target, config, catches)   takes the named catch. A persona sets Gimmicks only ("<card> is not a Gimmick; a persona sets Gimmicks", and "<card> waits for a Mod Bot's visit; a persona sets none" for a visit Gimmick, which the pool never offers either: staffOffers), and the refusal of a trap that
--                           pays out is gone with the payout.
--
-- Copied from their latest definitions: set_card from 0104_warn_bar.sql (its hand counted by card_held, Task 3), place_set and staff_set_card from 0086_staff_cards.sql. Everything they do that is not named
-- above stays as written, the lock order included (0075's header, steps 1 to 6): set_card takes the player's accounts row (1), place_set the target post's acts row (2), and nothing here takes a later lock before
-- an earlier one. The new reads (card_kinds) take no lock. place_set refuses in its own order, which differs from decideSet's (the act function always runs decideSet first, so a player meets decideSet's words).
-- Masks. A refusal reads the card's own kind and the named card's, public facts, and never who owns a character. The stored catch and phrase are the setter's alone (Task 3).
-- Ways out. A back set here springs once or ends at setLasts, as every back does.

-- Section: springing (Task 6; design sections 2, 3, 4, 5 and 7).
--
--   spring_traps(trigger, post, by_act, incoming_card, held, actor)   A back's trigger is `quote` for a Move (a card whose play is cast, set face down) and its card's `trap.trigger.on` for a Gimmick. A quote lays the Move on the
--                           quoting post, its character, its thread or its board, by the card's first reach (card_kinds.reaches[1]), when its phrase, if any, is in the quoting post's own words (phrase_in(bbcode_plain(body), phrase));
--                           a cast springs when `incoming_card` is the back's `catches`: the cast is caught (its Act's `caught`, as before), the caught card is written to the setter's ledger as `caught` (act = the spring), a staff
--                           setter takes nothing, and a staff cast is copied; a visit springs a Hall Pass, which ends the visit as every visit trap did. A cast on a back holding a Move, a reaction and a plain reply spring nothing.
--                           It no longer pays: the outcome, the payout, the strike, the reaction and reply triggers and the price and caster arguments are gone; the old eight-argument function is dropped.
--   spring_facts(back, trigger, by_act, incoming_card)   EVEN WORK. Every read spring_traps makes before it decides is made here, for every back it meets, whatever the back holds and whether or not it springs: (1) the setter's
--                           character (its author, retired_at, debuted_at, owner, staff); (2) the card's kind; (3) the Act that met the back (kind, character, thread, board, words), the thread's first post and the announcements
--                           thread; (4) the stack at the would-be target and reach: the plays of the back's own card up on the Act (a post's stack and its next layer) AND, whatever the reach, up on the Act's character, thread and
--                           board (a play beyond a post's), counted as place_cast counts them; the reach the card takes is chosen from values already read, never by which query runs; (5) the board's live card; (6) the named
--                           catch (a back with none reads its own card's row, so the read finds one row either way), compared with the incoming card; (7) phrase_probe over the Act's words (phrase_in returns early for no phrase, so a back with
--                           none would skip the fold and the pattern compile a back with one pays; phrase_probe folds the words and builds, compiles and runs a pattern of one shape for every back, a no-phrase back's built around its own id with a contradiction no text can satisfy, so it never matches and answers false: the work is the same whether a back holds a phrase or which, so its time says nothing of the card; its cost is bounded by the post's length, stated at a busy instance's scale in the phrase section).
--                           Only then is anything decided, and only a spring writes more, and a spring is a public Act. The time a write takes is never computed from what is face down ("A response never proves a private fact");
--                           supabase/tests/0135-face-down-moves.sql counts the reads of a Bluff, a Trap Card naming another card, a Move that cannot land, a Move whose phrase is absent and a back that springs, as 0077-trap-locks.sql does.
--                           (4b) A live Ward on the Act that would turn away a cast of the back's card (place_cast's rule: the highest live Ward's rarity, read for every back) makes a Move unable to land, and the back stays set.
--   lay_sprung(setter, card, config, target, reach, spring, from_post)   writes the card Act as place_cast would, through the setter's character: no payer, no price, no message, `payload.spring` set to the spring. It refuses nothing:
--                           every check that could refuse was a read in spring_facts, and a failed one returned null before anything was written, leaving the back set. (A seventh argument, the quoting post, is the post a card on a
--                           character hangs on; the plan's six had no place for it.) A sprung card does not call distract_visits (place_cast's thread reach talks down a Mod's open visit for its caster's attempt): a spring is not
--                           the setter's attempt at the Mod, and the visit a Hall Pass ends is ended by its own spring.
--   the spring Act's payload   acts_spring_payload now takes either shape: the old (an `outcome` object, no `did`, any of the old triggers) or the new, `did` one of landed (quote), caught (cast) and ended (visit) beside card, trigger, set,
--                           by and, for a cast, caught. A spring written before this keeps its old payload; no row is rewritten. Readers of `payload.outcome` (engine/ui/log/lines.ts) read the new `did` in Task 7.
--   post(), write_staff_act()   meet only the quoted post's back. post()'s reply probe, its face_down_reply reads and writes and its scan of the thread's backs are gone. write_staff_act: a pool post that quotes a post springs its back like
--                           any quote (#233), taking steps 3 to 5 of the lock order before its insert as post() does (lock_for_quote, below); a Move that lands on a staff post or character is a card on staff like any other.
--   react()                 springs nothing (who reacted is private, so a card can neither land on nor by it).
--   place_cast()            passes the incoming card's key and no price or caster, and tells a caught caster with a trapStruck on the caught play. It passes its payer as `actor` (a sixth argument the plan did not list), used as
--                           write_alert's actor alone: the player whose own other mask's back sprang is not told of it, as before (0063); spring_traps' other callers leave it to auth.uid(), and nothing is paid or priced from it.
--   face_down_reply         dropped with its trigger functions and policies; my_face_down keeps `passed_at` as a column that is always null, so the log page's reader of it (setPasses) reads none and the screens written against it
--                           still read. A reader of passed_at (engine/ui/log, web/src/data) goes in Task 7.
--   my_card_ledger          `springs` is true for a Move set face down as well (it springs on a quote), still null for a row that is not a set.
--
-- Lock order (0075's header, steps 1 to 6; nothing here takes a later lock before an earlier one). lock_for_quote(poster, thread, quoting) takes, for post() and for write_staff_act's quote: [2b, only when the quoted post holds a live back, a
-- public fact] the poster's `characters` row and the thread's board's row, both `for no key update`; 3, the quoted post's live unsprung back; 4, the thread row; 5, the count rows of the poster and the back's setter. Then the insert, then
-- spring_traps (3 again, held), whose spring is neither counted nor numbered and whose landed card is written through the setter, whose count row (5) is held. Step 2b is new: a Move that lands on a character or a board is laid under it, so a
-- play_card at the same character or board (which takes the same row, then its count row) and a second quote springing a Move there are laid one at a time, as place_cast lays them; a thread's is step 4's row, and a post's stack is the new
-- post's alone (it is not committed). 2b comes before everything a quote takes after it, and play_card takes it before step 5 too, so the two never cross. place_cast on a post is unchanged: 1, 2, 3 (spring_traps, now also a ledger insert for the
-- setter, which waits on nothing), 5. react takes none of 3 to 6 any more. start_visit is unchanged, and so is its order: write_staff_act's `visit` Act takes neither a seq (4) nor a count row (5), then spring_traps takes 3 and nothing after it
-- waits. The spring's trapSprang alert is written with the quoting player (auth.uid()) as its actor, as post() did, and a cast's with its payer.
--
-- Masks. The spring names the card, the trigger and the setter's character, public once it springs; the setter's ledger row carries the account's own card and no answer to anyone else carries an account. No refusal reads who owns a
-- character: a Move that cannot land returns null as a Bluff does. The reads are the same for every back (above).
-- Ways out. A back springs once, or ends at setLasts; a Move that cannot land waits for the next quote or its time. A caught play is a finished Act; its card is the setter's, or spent where the setter is staff.
--
-- Section: the phrase matcher (Task 4; design section 6, "Autocorrect on a quote").
--
--   phrase_in(plain, phrase)   whether the phrase is in the text as a whole word, at least once, case-folded as JavaScript folds it. It MIRRORS engine/bbcode/phrase.ts
--                            (phraseIn over occurrences) for the database to ask inside the write that springs a back; the text it is given is bbcode_plain(body) (0117), which
--                            mirrors visibleText(parse(body)), so a phrase in a quote, code, a link or an image is in nothing. A null or empty phrase, or one with no letter or
--                            digit, is in nothing.
--
-- The pair is one list in two languages ("Two lists that must agree are one list"): engine/bbcode/phrase.fixtures.ts is read by engine/bbcode/phrase.test.ts against
-- phraseIn(visibleText(parse(body)), phrase), and tools/phrase-sql.mjs makes supabase/tests/0136-phrase.sql from it, which asserts phrase_in(bbcode_plain(body), phrase) on every
-- fixture; tools/check-phrase-sql.mjs holds that file to exactly what the fixtures make, and tools/test-phrase-sql.mjs drives the check red.
--
-- Where Postgres parts from JavaScript, the SQL is made to agree with the TypeScript. JavaScript's `i` flag with `u` folds by Unicode's simple case folding; Postgres's lower() is
-- a lowercase, which differs in two ways. (1) Letters that share a capital but have several small forms (final sigma ς and σ, long s ſ and s, the micro sign µ and μ, the
-- Greek symbol forms ϐ ϑ ϰ ϱ ϕ ϖ ϵ, iota's U+0345 and U+1FBE, ẛ, and the old Cyrillic small forms U+1C80 to U+1C88) are one letter to JavaScript and several to lower(), so
-- phrase_fold maps each to the form lower() gives their capital. (2) The dotted capital I (U+0130) lowercases to a plain i in Postgres's locales, but JavaScript's simple folding
-- leaves it alone (and leaves the dotless ı alone too), so phrase_fold sets it aside first as a private-use character that lower() never touches: İ then matches only İ.
-- Sharp s is not "ss" on either side (simple folding keeps ß, and folds ẞ to it), so nothing is needed for it. Letters added to Unicode after the Postgres in use was built
-- (lower() does not know them) are folded by neither side and so can differ from Node's table until Postgres is rebuilt; none of them is in a living script's everyday text.
-- "A letter or a digit" is JavaScript's \p{L}\p{N}, written out as a class (phrase_word_class), never the locale's [[:alnum:]], which counts combining marks as letters.
-- Cost. The pattern is built per phrase around the whole word class, and Postgres keeps only its last 32 compiled patterns, so a phrase it has not just seen costs
-- about 0.7 ms to compile and one it has about 0.03 ms (measured on 2000 calls). A quote meets one back, the quoted post's, so a write asks phrase_in at most once, whatever
-- the instance's size; nothing scans every live back for it.

-- ------------------------------------------------------------------------------------------------------- face_down ----

alter table face_down
  add column catches text references card_kinds (key),
  add column phrase text,
  add constraint face_down_one_of check (catches is null or phrase is null),
  add constraint face_down_phrase check (phrase is null or btrim(phrase) <> '');

-- my_face_down (0078), with the named catch and the phrase last. The setter's own row, so the setter's log and set form may read what the back waits for.
create or replace view my_face_down as
  select f.play, f.card, f.config, f.post, f.thread, a.created_at as set_at, f.ends_at, s.id as spring, s.created_at as sprung_at,
    coalesce(s.created_at, case when f.ends_at <= now() then f.ends_at end) as ended_at, null::timestamptz as passed_at, f.catches, f.phrase
  from face_down f join acts a on a.id = f.play left join acts s on s.kind = 'spring' and (s.payload ->> 'set') = f.play::text
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

-- The cards an account holds of one kind: bought and caught, less played. The one count every reader of a hand uses. It is security invoker: a signed-in caller
-- runs it under card_ledger's `own` policy, so they count their own rows and read 0 for another account's, a constant that says nothing of whose hand is whose; the definer
-- functions that spend a card (play_card, set_card, buy_card, and later spring_traps inside post(), where auth.uid() is the quoting player and not the setter) run it as the
-- function's owner and get the true count of the account they act for.
create function card_held(who uuid, of_card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'caught')) - count(*) filter (where l.kind = 'played'))::integer
  from card_ledger l where l.account = who and l.card = of_card
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

-- ------------------------------------------------------------------------------------------------------- the phrase matcher ----

-- The case fold JavaScript's `i` flag with `u` applies, as a function of the text (see the header). Immutable: it reads nothing but its argument.
create or replace function phrase_fold(t text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select translate(
    lower(translate(t, U&'\0130', U&'\E000')),
    U&'\017F\03C2\03D0\03F5\03D1\0345\1FBE\03F0\00B5\03D6\03F1\03D5\1E9B\1C80\1C81\1C82\1C83\1C84\1C85\1C86\1C87\1C88',
    U&'\0073\03C3\03B2\03B5\03B8\03B9\03B9\03BA\03BC\03C0\03C1\03C6\1E61\0432\0434\043E\0441\0442\0442\044A\0463\A64B'
  )
$$;

-- Whether a character is a letter or a digit, as JavaScript's \p{L}\p{N} says: a regular-expression character class, written out because Postgres has no property classes and its
-- [[:alnum:]] is the locale's own (glibc's counts combining vowel signs as letters and leaves out Unicode's other numbers, so the two disagree on whole scripts). The ranges are
-- Unicode 17's, the release Node 22 reads, as bbcode_plain_url_ok's are; engine/bbcode/phrase.test.ts reads this class back out of this file and holds it, over every code point,
-- to /[\p{L}\p{N}]/u, so a Node that learns a new letter fails there until this carries it.
create or replace function phrase_word_class() returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select '[\u0030-\u0039\u0041-\u005a\u0061-\u007a\u00aa\u00b2-\u00b3\u00b5\u00b9-\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376-\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u0660-\u0669\u066e-\u066f\u0671-\u06d3\u06d5\u06e5-\u06e6\u06ee-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07c0-\u07ea\u07f4-\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u0870-\u0887\u0889-\u088f\u08a0-\u08c9\u0904-\u0939\u093d\u0950\u0958-\u0961\u0966-\u096f\u0971-\u0980\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc-\u09dd\u09df-\u09e1\u09e6-\u09f1\u09f4-\u09f9\u09fc\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33\u0a35-\u0a36\u0a38-\u0a39\u0a59-\u0a5c\u0a5e\u0a66-\u0a6f\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0-\u0ae1\u0ae6-\u0aef\u0af9\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3d\u0b5c-\u0b5d\u0b5f-\u0b61\u0b66-\u0b6f\u0b71-\u0b77\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0be6-\u0bf2\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c5c-\u0c5d\u0c60-\u0c61\u0c66-\u0c6f\u0c78-\u0c7e\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cdc-\u0cde\u0ce0-\u0ce1\u0ce6-\u0cef\u0cf1-\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d58-\u0d61\u0d66-\u0d78\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0de6-\u0def\u0e01-\u0e30\u0e32-\u0e33\u0e40-\u0e46\u0e50-\u0e59\u0e81-\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2-\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0ed0-\u0ed9\u0edc-\u0edf\u0f00\u0f20-\u0f33\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f-\u1049\u1050-\u1055\u105a-\u105d\u1061\u1065-\u1066\u106e-\u1070\u1075-\u1081\u108e\u1090-\u1099\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1369-\u137c\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u1711\u171f-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u17e0-\u17e9\u17f0-\u17f9\u1810-\u1819\u1820-\u1878\u1880-\u1884\u1887-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1946-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u19d0-\u19da\u1a00-\u1a16\u1a20-\u1a54\u1a80-\u1a89\u1a90-\u1a99\u1aa7\u1b05-\u1b33\u1b45-\u1b4c\u1b50-\u1b59\u1b83-\u1ba0\u1bae-\u1be5\u1c00-\u1c23\u1c40-\u1c49\u1c4d-\u1c7d\u1c80-\u1c8a\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5-\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2070-\u2071\u2074-\u2079\u207f-\u2089\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2150-\u2189\u2460-\u249b\u24ea-\u24ff\u2776-\u2793\u2c00-\u2ce4\u2ceb-\u2cee\u2cf2-\u2cf3\u2cfd\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u3192-\u3195\u31a0-\u31bf\u31f0-\u31ff\u3220-\u3229\u3248-\u324f\u3251-\u325f\u3280-\u3289\u32b1-\u32bf\u3400-\u4dbf\u4e00-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7dc\ua7f1-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua830-\ua835\ua840-\ua873\ua882-\ua8b3\ua8d0-\ua8d9\ua8f2-\ua8f7\ua8fb\ua8fd-\ua8fe\ua900-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf-\ua9d9\ua9e0-\ua9e4\ua9e6-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa50-\uaa59\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5-\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabe2\uabf0-\uabf9\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00010000-\U0001000b\U0001000d-\U00010026\U00010028-\U0001003a\U0001003c-\U0001003d\U0001003f-\U0001004d\U00010050-\U0001005d\U00010080-\U000100fa\U00010107-\U00010133\U00010140-\U00010178\U0001018a-\U0001018b\U00010280-\U0001029c\U000102a0-\U000102d0\U000102e1-\U000102fb\U00010300-\U00010323\U0001032d-\U0001034a\U00010350-\U00010375\U00010380-\U0001039d\U000103a0-\U000103c3\U000103c8-\U000103cf\U000103d1-\U000103d5\U00010400-\U0001049d\U000104a0-\U000104a9\U000104b0-\U000104d3\U000104d8-\U000104fb\U00010500-\U00010527\U00010530-\U00010563\U00010570-\U0001057a\U0001057c-\U0001058a\U0001058c-\U00010592\U00010594-\U00010595\U00010597-\U000105a1\U000105a3-\U000105b1\U000105b3-\U000105b9\U000105bb-\U000105bc\U000105c0-\U000105f3\U00010600-\U00010736\U00010740-\U00010755\U00010760-\U00010767\U00010780-\U00010785\U00010787-\U000107b0\U000107b2-\U000107ba\U00010800-\U00010805\U00010808\U0001080a-\U00010835\U00010837-\U00010838\U0001083c\U0001083f-\U00010855\U00010858-\U00010876\U00010879-\U0001089e\U000108a7-\U000108af\U000108e0-\U000108f2\U000108f4-\U000108f5\U000108fb-\U0001091b\U00010920-\U00010939\U00010940-\U00010959\U00010980-\U000109b7\U000109bc-\U000109cf\U000109d2-\U00010a00\U00010a10-\U00010a13\U00010a15-\U00010a17\U00010a19-\U00010a35\U00010a40-\U00010a48\U00010a60-\U00010a7e\U00010a80-\U00010a9f\U00010ac0-\U00010ac7\U00010ac9-\U00010ae4\U00010aeb-\U00010aef\U00010b00-\U00010b35\U00010b40-\U00010b55\U00010b58-\U00010b72\U00010b78-\U00010b91\U00010ba9-\U00010baf\U00010c00-\U00010c48\U00010c80-\U00010cb2\U00010cc0-\U00010cf2\U00010cfa-\U00010d23\U00010d30-\U00010d39\U00010d40-\U00010d65\U00010d6f-\U00010d85\U00010e60-\U00010e7e\U00010e80-\U00010ea9\U00010eb0-\U00010eb1\U00010ec2-\U00010ec7\U00010f00-\U00010f27\U00010f30-\U00010f45\U00010f51-\U00010f54\U00010f70-\U00010f81\U00010fb0-\U00010fcb\U00010fe0-\U00010ff6\U00011003-\U00011037\U00011052-\U0001106f\U00011071-\U00011072\U00011075\U00011083-\U000110af\U000110d0-\U000110e8\U000110f0-\U000110f9\U00011103-\U00011126\U00011136-\U0001113f\U00011144\U00011147\U00011150-\U00011172\U00011176\U00011183-\U000111b2\U000111c1-\U000111c4\U000111d0-\U000111da\U000111dc\U000111e1-\U000111f4\U00011200-\U00011211\U00011213-\U0001122b\U0001123f-\U00011240\U00011280-\U00011286\U00011288\U0001128a-\U0001128d\U0001128f-\U0001129d\U0001129f-\U000112a8\U000112b0-\U000112de\U000112f0-\U000112f9\U00011305-\U0001130c\U0001130f-\U00011310\U00011313-\U00011328\U0001132a-\U00011330\U00011332-\U00011333\U00011335-\U00011339\U0001133d\U00011350\U0001135d-\U00011361\U00011380-\U00011389\U0001138b\U0001138e\U00011390-\U000113b5\U000113b7\U000113d1\U000113d3\U00011400-\U00011434\U00011447-\U0001144a\U00011450-\U00011459\U0001145f-\U00011461\U00011480-\U000114af\U000114c4-\U000114c5\U000114c7\U000114d0-\U000114d9\U00011580-\U000115ae\U000115d8-\U000115db\U00011600-\U0001162f\U00011644\U00011650-\U00011659\U00011680-\U000116aa\U000116b8\U000116c0-\U000116c9\U000116d0-\U000116e3\U00011700-\U0001171a\U00011730-\U0001173b\U00011740-\U00011746\U00011800-\U0001182b\U000118a0-\U000118f2\U000118ff-\U00011906\U00011909\U0001190c-\U00011913\U00011915-\U00011916\U00011918-\U0001192f\U0001193f\U00011941\U00011950-\U00011959\U000119a0-\U000119a7\U000119aa-\U000119d0\U000119e1\U000119e3\U00011a00\U00011a0b-\U00011a32\U00011a3a\U00011a50\U00011a5c-\U00011a89\U00011a9d\U00011ab0-\U00011af8\U00011bc0-\U00011be0\U00011bf0-\U00011bf9\U00011c00-\U00011c08\U00011c0a-\U00011c2e\U00011c40\U00011c50-\U00011c6c\U00011c72-\U00011c8f\U00011d00-\U00011d06\U00011d08-\U00011d09\U00011d0b-\U00011d30\U00011d46\U00011d50-\U00011d59\U00011d60-\U00011d65\U00011d67-\U00011d68\U00011d6a-\U00011d89\U00011d98\U00011da0-\U00011da9\U00011db0-\U00011ddb\U00011de0-\U00011de9\U00011ee0-\U00011ef2\U00011f02\U00011f04-\U00011f10\U00011f12-\U00011f33\U00011f50-\U00011f59\U00011fb0\U00011fc0-\U00011fd4\U00012000-\U00012399\U00012400-\U0001246e\U00012480-\U00012543\U00012f90-\U00012ff0\U00013000-\U0001342f\U00013441-\U00013446\U00013460-\U000143fa\U00014400-\U00014646\U00016100-\U0001611d\U00016130-\U00016139\U00016800-\U00016a38\U00016a40-\U00016a5e\U00016a60-\U00016a69\U00016a70-\U00016abe\U00016ac0-\U00016ac9\U00016ad0-\U00016aed\U00016b00-\U00016b2f\U00016b40-\U00016b43\U00016b50-\U00016b59\U00016b5b-\U00016b61\U00016b63-\U00016b77\U00016b7d-\U00016b8f\U00016d40-\U00016d6c\U00016d70-\U00016d79\U00016e40-\U00016e96\U00016ea0-\U00016eb8\U00016ebb-\U00016ed3\U00016f00-\U00016f4a\U00016f50\U00016f93-\U00016f9f\U00016fe0-\U00016fe1\U00016fe3\U00016ff2-\U00016ff6\U00017000-\U00018cd5\U00018cff-\U00018d1e\U00018d80-\U00018df2\U0001aff0-\U0001aff3\U0001aff5-\U0001affb\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155\U0001b164-\U0001b167\U0001b170-\U0001b2fb\U0001bc00-\U0001bc6a\U0001bc70-\U0001bc7c\U0001bc80-\U0001bc88\U0001bc90-\U0001bc99\U0001ccf0-\U0001ccf9\U0001d2c0-\U0001d2d3\U0001d2e0-\U0001d2f3\U0001d360-\U0001d378\U0001d400-\U0001d454\U0001d456-\U0001d49c\U0001d49e-\U0001d49f\U0001d4a2\U0001d4a5-\U0001d4a6\U0001d4a9-\U0001d4ac\U0001d4ae-\U0001d4b9\U0001d4bb\U0001d4bd-\U0001d4c3\U0001d4c5-\U0001d505\U0001d507-\U0001d50a\U0001d50d-\U0001d514\U0001d516-\U0001d51c\U0001d51e-\U0001d539\U0001d53b-\U0001d53e\U0001d540-\U0001d544\U0001d546\U0001d54a-\U0001d550\U0001d552-\U0001d6a5\U0001d6a8-\U0001d6c0\U0001d6c2-\U0001d6da\U0001d6dc-\U0001d6fa\U0001d6fc-\U0001d714\U0001d716-\U0001d734\U0001d736-\U0001d74e\U0001d750-\U0001d76e\U0001d770-\U0001d788\U0001d78a-\U0001d7a8\U0001d7aa-\U0001d7c2\U0001d7c4-\U0001d7cb\U0001d7ce-\U0001d7ff\U0001df00-\U0001df1e\U0001df25-\U0001df2a\U0001e030-\U0001e06d\U0001e100-\U0001e12c\U0001e137-\U0001e13d\U0001e140-\U0001e149\U0001e14e\U0001e290-\U0001e2ad\U0001e2c0-\U0001e2eb\U0001e2f0-\U0001e2f9\U0001e4d0-\U0001e4eb\U0001e4f0-\U0001e4f9\U0001e5d0-\U0001e5ed\U0001e5f0-\U0001e5fa\U0001e6c0-\U0001e6de\U0001e6e0-\U0001e6e2\U0001e6e4-\U0001e6e5\U0001e6e7-\U0001e6ed\U0001e6f0-\U0001e6f4\U0001e6fe-\U0001e6ff\U0001e7e0-\U0001e7e6\U0001e7e8-\U0001e7eb\U0001e7ed-\U0001e7ee\U0001e7f0-\U0001e7fe\U0001e800-\U0001e8c4\U0001e8c7-\U0001e8cf\U0001e900-\U0001e943\U0001e94b\U0001e950-\U0001e959\U0001ec71-\U0001ecab\U0001ecad-\U0001ecaf\U0001ecb1-\U0001ecb4\U0001ed01-\U0001ed2d\U0001ed2f-\U0001ed3d\U0001ee00-\U0001ee03\U0001ee05-\U0001ee1f\U0001ee21-\U0001ee22\U0001ee24\U0001ee27\U0001ee29-\U0001ee32\U0001ee34-\U0001ee37\U0001ee39\U0001ee3b\U0001ee42\U0001ee47\U0001ee49\U0001ee4b\U0001ee4d-\U0001ee4f\U0001ee51-\U0001ee52\U0001ee54\U0001ee57\U0001ee59\U0001ee5b\U0001ee5d\U0001ee5f\U0001ee61-\U0001ee62\U0001ee64\U0001ee67-\U0001ee6a\U0001ee6c-\U0001ee72\U0001ee74-\U0001ee77\U0001ee79-\U0001ee7c\U0001ee7e\U0001ee80-\U0001ee89\U0001ee8b-\U0001ee9b\U0001eea1-\U0001eea3\U0001eea5-\U0001eea9\U0001eeab-\U0001eebb\U0001f100-\U0001f10c\U0001fbf0-\U0001fbf9\U00020000-\U0002a6df\U0002a700-\U0002b81d\U0002b820-\U0002cead\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a\U00031350-\U00033479]'
$$;

create or replace function phrase_in(plain text, phrase text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when plain is null or phrase is null or phrase !~ phrase_word_class() then false
    else phrase_fold(plain) ~ ('(?<!' || phrase_word_class() || ')'
                               || regexp_replace(phrase_fold(phrase), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
                               || '(?!' || phrase_word_class() || ')')
  end
$$;

-- phrase_probe(plain, phrase, token): phrase_in's answer, by the same work whether or not there is a phrase. It folds the text, builds a pattern from the folded phrase (or, for no phrase, from the token, the back's own id) between the
-- same word-edge assertions, and runs it; a pattern with no phrase carries a contradiction (an assertion that 'a' is and is not next) that no text can satisfy, so it never matches, and its answer is ANDed with whether there is a phrase.
create or replace function phrase_probe(plain text, phrase text, token text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when plain is null then false else
    (phrase_fold(plain) ~ ('(?<!' || phrase_word_class() || ')' || case when r.real then '' else '(?=a)(?!a)' end
                           || regexp_replace(phrase_fold(case when r.real then phrase else token end), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
                           || '(?!' || phrase_word_class() || ')')) and r.real end
  from (select phrase is not null and phrase ~ phrase_word_class() as real) r
$$;

-- Called by the write that springs a back, never by the API's anonymous or digest roles (0117 granted bbcode_plain the same way).
revoke execute on function phrase_word_class(), phrase_fold(text), phrase_in(text, text) from public, anon;
grant execute on function phrase_word_class(), phrase_fold(text), phrase_in(text, text) to authenticated, service_role;
-- phrase_probe is spring_facts' alone (a definer function that runs it as its owner), so no API role holds it.
revoke execute on function phrase_probe(text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------- setting a Move ----

drop function set_card(uuid, text, uuid, uuid, jsonb, integer);
drop function place_set(uuid, text, uuid, jsonb, uuid, integer);
drop function staff_set_card(text, text, uuid, jsonb);

-- place_set (0086), taking what decideSet returned. A Move or a Gimmick sets and a Use is refused, in decideSet's words; a catch is a cast Gimmick's and names a card cast on a post; a phrase is a Move's and is
-- not blank. The face_down row holds both. Everything else as 0086 wrote it. Callable by no API role.
create function place_set(setter uuid, card text, target uuid, config jsonb, payer uuid, price integer, catches text default null, phrase text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind_of card_kinds%rowtype;
  named card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
  staff_setter boolean;
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
  -- A Gimmick that waits for a cast waits for a card; one set with none could catch nothing, and its setter would not know (the spring, Task 6, reads only a named catch).
  if catches is null and kind_of.play = 'set' and kind_of.trap #>> '{trigger,on}' = 'cast' then
    raise exception '% names no card to catch', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null then
    if kind_of.play is distinct from 'set' or kind_of.trap #>> '{trigger,on}' is distinct from 'cast' then
      raise exception '% catches no card', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select * into named from card_kinds k where k.key = place_set.catches;
    if named.key is null or named.play is distinct from 'cast' or not ('post' = any (named.reaches)) then
      raise exception '% names a card that is cast on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  if phrase is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% waits for no phrase', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if btrim(phrase) = '' then raise exception '% needs a phrase to wait for', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from setter then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Public, since the back is.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (setter, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, phrase)
    values (written, payer, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')), place_set.catches, place_set.phrase);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  return act_projection(written);
end $$;
revoke execute on function place_set(uuid, text, uuid, jsonb, uuid, integer, text, text) from public, anon, authenticated, service_role;

-- set_card (0104), counting the hand with card_held (Task 3) and passing the catch and the phrase on. Everything else as 0104 wrote it; the grants as 0054 gave them.
create function set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, catches text default null, phrase text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
  placed := place_set(through, card, target, config, who, price, set_card.catches, set_card.phrase);
  written := (placed ->> 'id')::uuid;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return placed;
end $$;
revoke execute on function set_card(uuid, text, uuid, uuid, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function set_card(uuid, text, uuid, uuid, jsonb, integer, text, text) to service_role;

-- staff_set_card (0086), taking the named catch. A persona sets Gimmicks only, and no trap pays out now, so the payout refusal is gone. Everything else as 0086 wrote it.
create function staff_set_card(staff_key text, card text, target uuid, config jsonb default '{}', catches text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  kind_of card_kinds%rowtype;
  flag text;
  placed jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona plays a card' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  select * into kind_of from card_kinds k where k.key = staff_set_card.card;
  if kind_of.key is null then raise exception 'there is no such card' using errcode = 'P0002'; end if;
  if not coalesce(rarity_rank(kind_of.rarity) <= rarity_rank(setting('pool') #>> '{cardRarityMost}'), false) then
    raise exception '% is above the rarity the pool plays', kind_of.name using errcode = '55000';
  end if;
  if kind_of.play is distinct from 'set' then raise exception '% is not a Gimmick; a persona sets Gimmicks', kind_of.name using errcode = '55000'; end if;
  if kind_of.trap #>> '{trigger,on}' = 'visit' then raise exception '% waits for a Mod Bot''s visit; a persona sets none', kind_of.name using errcode = '55000'; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  placed := place_set(who, card, target, coalesce(config, '{}'), null, 0, staff_set_card.catches, null);
  perform set_config('kayfabb.staff_writer', flag, true);
  return placed;
end $$;
revoke execute on function staff_set_card(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function staff_set_card(text, text, uuid, jsonb, text) to service_role;

-- ------------------------------------------------------------------------------------------------------- springing ----

-- The spring Act's payload names what the spring did (`did`) where it used to carry the card's outcome (an object). A spring written before this keeps its old payload (rows are never rewritten),
-- so the check accepts either shape: the old one with an `outcome` object and no `did`, or the new one with a `did` that agrees with its trigger.
alter table acts drop constraint acts_spring_payload;
alter table acts add constraint acts_spring_payload check (kind <> 'spring' or (
  jsonb_typeof(payload -> 'card') = 'string'
  and payload ->> 'trigger' in ('cast', 'reaction', 'reply', 'quote', 'visit')
  and coalesce(jsonb_typeof(payload -> 'outcome') = 'object', false) <> (payload ? 'did')
  and (not (payload ? 'did') or (payload ->> 'trigger', payload ->> 'did') in (('quote', 'landed'), ('cast', 'caught'), ('visit', 'ended')))
  and jsonb_typeof(payload -> 'set') = 'string'
  and coalesce(jsonb_typeof(payload -> 'by'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'caught'), 'null') in ('string', 'null')
  and payload - array['card', 'trigger', 'outcome', 'did', 'set', 'by', 'caught'] = '{}'::jsonb) is true);

-- my_card_ledger (0075), with `springs` true for a Move set face down too (it springs on a quote), and still null for a row that is not a set. Everything else as 0075 wrote it.
create or replace view my_card_ledger as
  select l.card, l.kind, l.act, l.price, l.at,
         case when l.kind = 'played' and a.kind = 'set' then k.trap is not null or k.play = 'cast' end as springs
  from card_ledger l
  left join card_kinds k on k.key = l.card
  left join acts a on a.id = l.act
  where l.account = auth.uid();
revoke all on my_card_ledger from anon, public;
grant select on my_card_ledger to authenticated;

-- ---- spring_facts: the reads every back makes, before anything is decided ----
-- What spring_traps reads of a back it meets, for every back alike. The shape of the answer is the same whatever is face down; only its values differ.

create type spring_facts as (
  setter_character uuid, setter_owner uuid, setter_staff boolean, setter_retired timestamptz, setter_debuted timestamptz,
  kind_play text, kind_trap jsonb, kind_stack integer, kind_seeded boolean,
  by_kind text, by_character uuid, by_thread uuid, by_board uuid, by_body text, first_post uuid, announce_thread uuid,
  reach text, target uuid,
  up integer, layer integer, reach_up integer, live_board timestamptz,
  warded boolean, caught boolean, phrase_hit boolean
);

create function spring_facts(fd face_down, trigger text, by_act uuid, incoming_card text) returns spring_facts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f spring_facts;
  k card_kinds%rowtype;
  named text;
  in_character integer;
  in_thread integer;
  in_board integer;
  ward_rank integer;
begin
  -- 1. The setter's character, and what decides whether it can act (retired, not debuted), who it belongs to and whether it is staff.
  select a.character into f.setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into f.setter_retired, f.setter_debuted, f.setter_owner, f.setter_staff from characters c where c.id = f.setter_character;
  -- 2. The back's card kind.
  select * into k from card_kinds x where x.key = fd.card;
  f.kind_play := k.play; f.kind_trap := k.trap; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, a.payload ->> 'body', t.board into f.by_kind, f.by_character, f.by_thread, f.by_body, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and a.kind = 'post';
  select t.id into f.announce_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
  -- 4. The stack at the would-be target and reach, for every reach: the plays of the card still up on the Act (a post's), the layer to go on from, and the plays of it still up on
  -- the Act's character, thread and board (a play beyond a post's), counted as place_cast counts them. Which reach the card takes is then a choice among values already read.
  f.target := case f.reach when 'post' then by_act when 'character' then f.by_character when 'thread' then f.by_thread else f.by_board end;
  -- Each play found is asked whether an admin ended it, whatever card it is (card_ended is a read of its own, and the subquery cannot be flattened away, so it is made for every play found and not only
  -- for the ones of this back's card): which card is counted is chosen after the reads.
  select count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended),
         greatest(coalesce(max(l.layer) filter (where l.card is not distinct from fd.card), 0), count(*) filter (where l.card is not distinct from fd.card)) + 1
    into f.up, f.layer
  from (select k2.payload ->> 'card' as card, (k2.payload ->> 'ends')::timestamptz as ends, (k2.payload ->> 'layer')::integer as layer, card_ended(k2.id) as ended
        from acts k2 where k2.kind = 'card' and k2.target_act_id = by_act and not (k2.payload ? 'caught') and coalesce(k2.payload ->> 'reach', 'post') = 'post' offset 0) l;
  select count(*) filter (where l.card = fd.card and not l.ended and l.character = f.by_character), count(*) filter (where l.card = fd.card and not l.ended and l.thread = f.by_thread),
         count(*) filter (where l.card = fd.card and not l.ended and l.board = f.by_board)
    into in_character, in_thread, in_board
  from (select k2.payload ->> 'card' as card, r.character, r.thread, r.board, card_ended(r.play) as ended
        from play_reach r join acts k2 on k2.id = r.play
        where r.ends_at > now() and (r.character = f.by_character or r.thread = f.by_thread or r.board = f.by_board) offset 0) l;
  f.reach_up := case f.reach when 'character' then in_character when 'thread' then in_thread else in_board end;
  -- 4b. The live Ward on the Act, the highest one's rarity, whatever the card: place_cast turns a cast away at or below it, and a Move does not land through it either.
  select max(rarity_rank(wk.rarity)) into ward_rank from acts w join card_kinds wk on wk.key = w.payload ->> 'card'
  where w.kind = 'card' and w.target_act_id = by_act and wk.ward and not (w.payload ? 'caught') and coalesce(w.payload ->> 'reach', 'post') = 'post'
    and (w.payload ->> 'ends' is null or (w.payload ->> 'ends')::timestamptz > now()) and not card_ended(w.id);
  f.warded := ward_rank is not null and rarity_rank(k.rarity) <= ward_rank;
  -- 5. A board's live card, whatever the card's reach.
  select max(r.ends_at) into f.live_board from play_reach r where r.board = f.by_board and r.ends_at > now() and not card_ended(r.play);
  -- 6. The named catch (a back with none reads its own card's row, so the read finds one row either way: a null key would be a read of nothing), compared with the incoming card.
  select x.key into named from card_kinds x where x.key = coalesce(fd.catches, fd.card);
  f.caught := fd.catches is not null and fd.catches = incoming_card and named is not null;
  -- 7. The phrase against the Act's own words: phrase_probe folds the words and compiles and runs a pattern of one shape for every back, a back with no phrase included (its pattern is built around its own id and cannot match).
  f.phrase_hit := coalesce(phrase_probe(bbcode_plain(f.by_body), fd.phrase, fd.play::text), false);
  return f;
end $$;
revoke execute on function spring_facts(face_down, text, uuid, text) from public, anon, authenticated, service_role;

-- ---- lay_sprung: a Move lands from its back ----
-- Writes the card Act as place_cast would, through the setter's character, with no payer, no price and no message, and marks it as sprung (`payload.spring`). It refuses nothing: every check that could
-- have refused (the stack, the board's live card, the first post, the announcements thread) was a read in spring_facts, and a failed one returned before anything was written. Returns the card's Act.

create function lay_sprung(setter uuid, card text, config jsonb, target uuid, reach text, spring uuid, from_post uuid) returns uuid
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
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if staff_setter then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (id, character, kind, thread, target_act_id, payload)
  values (written, setter, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', '',
    'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end, 'spring', spring::text)
    || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name) else jsonb_build_object('layer', layer) end
    || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end);
  if staff_setter then perform set_config('kayfabb.staff_writer', flag, true); end if;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  return written;
end $$;
revoke execute on function lay_sprung(uuid, text, jsonb, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;

-- ---- spring_traps ----
-- Decides on the facts spring_facts read, and only then writes.

drop function spring_traps(text, uuid, uuid, text, text, uuid, integer, uuid[]);
create function spring_traps(trigger text, post uuid, by_act uuid, incoming_card text default null, held uuid[] default null, actor uuid default null) returns jsonb
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
begin
  select x.* into fd from face_down x
  where x.post = spring_traps.post and x.ends_at > now() and (held is null or x.play = any (held))
  order by x.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  -- The same reads for every back, before anything is decided.
  f := spring_facts(fd, trigger, by_act, incoming_card);
  -- The decision, from the locals. A Move springs on a quote; a Gimmick on its own trigger, or never (a Bluff).
  back_trigger := case f.kind_play when 'cast' then 'quote' else f.kind_trap #>> '{trigger,on}' end;
  springs := back_trigger is not distinct from trigger
    and case trigger when 'quote' then fd.phrase is null or f.phrase_hit when 'cast' then f.caught when 'visit' then true else false end;
  -- A Move lands on what quoted it, at its first reach, if it can: its stack there has room, a board has no live card, the thread has its first post and a board card its thread.
  lands := coalesce(f.by_kind = 'post' and case f.reach
      when 'post' then f.up < f.kind_stack and not f.warded
      when 'character' then f.by_character is not null and f.reach_up < f.kind_stack
      when 'thread' then f.first_post is not null and f.reach_up < f.kind_stack
      else f.by_board is not null and f.announce_thread is not null and f.live_board is null and f.reach_up < f.kind_stack end, false);
  if not springs then return null; end if;
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its back stays set until its time, and the write that met it lands as if no
  -- back were there (acts_well_formed would refuse the spring, and with it the write). A Move that cannot land leaves its back set for the next quote.
  if f.setter_retired is not null or f.setter_debuted is null then return null; end if;
  if back_trigger = 'quote' and not lands then return null; end if;
  did := case back_trigger when 'quote' then 'landed' when 'cast' then 'caught' else 'ended' end;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if f.setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (f.setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'did', did, 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' then by_act::text end))) returning id into sprung;
  if f.setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
  perform write_alert(f.setter_character, 'trapSprang', null, sprung, coalesce(actor, auth.uid()));
  if back_trigger = 'quote' then
    laid := lay_sprung(f.setter_character, fd.card, fd.config, f.target, f.reach, sprung, by_act);
    perform write_alert(f.by_character, 'trapStruck', null, laid, f.setter_owner);
    -- The landed card goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(laid));
  elsif back_trigger = 'cast' and fd.account is not null then
    -- The caught card is the setter's: one more row in their own ledger, beside the caster's `played` row. A staff setter has no hand and takes nothing.
    insert into card_ledger (account, card, kind, act, price) values (fd.account, incoming_card, 'caught', sprung, 0);
  end if;
  return act_projection(sprung);
end $$;
revoke execute on function spring_traps(text, uuid, uuid, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- ---- lock_for_quote: the lock order's steps for a write that may spring a quote ----
-- Takes, in the order 0075's header wrote, the locks a post needs before it inserts: the quoted post's live, unsprung back (a spring is public, and acts_one_spring finds it by index), then the
-- thread the post's `seq` comes from, then the count rows of the poster and of the back's setter, each made first where it is missing. It returns the plays it locked, which spring_traps takes as
-- `held`: only a back this write locked springs. Which rows it locks is computed from public facts alone (a live, unsprung back, the character that set it), never from the card.
-- Before step 3 it takes two more rows, only when the quoted post holds a live back (a public fact): the poster's `characters` row and the thread's board's row, `for no key update`. A Move that
-- lands on the quoting post's character or board is laid under them, so a play_card at the same character or board, which takes the same row and then its count row, and a second quote springing
-- a Move there, are laid one at a time and each counts the last (the stack, and a board's one live card). They come ahead of every step 3 to 6 lock a quote takes and are held by nothing a quote
-- waits on after them: play_card's character and board reaches take the same row and then step 5, never the other way round.
create function lock_for_quote(poster uuid, in_thread uuid, quoting uuid) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  locked uuid[];
  setters uuid[];
  on_board uuid;
begin
  if quoting is not null and exists (select 1 from face_down f where f.post = quoting and f.ends_at > now()
       and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)) then
    select t.board into on_board from threads t where t.id = in_thread;
    perform 1 from characters c where c.id = poster for no key update;
    perform 1 from boards b where b.id = on_board for no key update;
  end if;
  -- Step 3: the quoted post's live, unsprung back, in `play` order, in one statement.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.setter), '{}') into locked, setters
  from (select f.play, a.character as setter from face_down f join acts a on a.id = f.play
        where f.post = quoting and f.ends_at > now()
          and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
        order by f.play for update of f) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || poster) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || poster) order by character for update;
  return locked;
end $$;
revoke execute on function lock_for_quote(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---- post ----
-- post (0130), meeting only the quoted post's back: the reply probe, face_down_reply's reads and writes, and the scan of the thread's backs are gone. The locks are lock_for_quote's. Everything else as 0130 wrote it.
CREATE OR REPLACE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  locked uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform not_barred(through, on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- Steps 3 to 5 of the lock order, for the quoted post's back (lock_for_quote).
  locked := lock_for_quote(through, in_thread, quoting);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (spring_traps' `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

-- ---- write_staff_act ----
-- write_staff_act (0137), a pool post that quotes a post springs its back like any quote (#233): it takes steps 3 to 5 of the lock order before its insert, as post() does, and meets only that back.
-- A Move that lands on a staff post or character is a card on staff like any other. Everything else as 0137 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
  stamped jsonb := payload;
  quoting boolean := kind = 'post' and target is not null;
  locked uuid[];
  sprung jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict', 'appeal_ruling') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a verdict or a ruling, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  -- A move says which office made it, as the office stood when it landed.
  if kind = 'move' and held in ('boss', 'mod') and not (payload ? 'office') then
    stamped := payload || jsonb_build_object('office', held);
  end if;
  -- A pool post that quotes: the quoted post's back, the thread and the count rows, in the lock order, before the insert.
  if quoting then locked := lock_for_quote(who, write_staff_act.thread, target); end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, write_staff_act.thread, target, stamped) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  if quoting then sprung := spring_traps('quote', target, written, held => locked); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ---- place_cast ----
-- place_cast (0108), the card's key given to spring_traps and neither a price nor a caster, since nothing pays out; and a caught caster told on the caught play. Everything else as 0108 wrote it. Create or replace
-- keeps 0108's grants (none to an API role); the revoke is stated again.
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
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it. Nothing pays out, so
      -- spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      sprung := spring_traps('cast', target, written, card, actor => payer);
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
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;
-- ---- react ----
-- react (0104), springing nothing: who reacted is a private fact, and a card cannot land on or by it (the design, section 2). Everything else as 0104 wrote it.
CREATE OR REPLACE FUNCTION public.react(target uuid, through uuid, reaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  perform not_banned(through);
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
  -- A reaction springs nothing: who reacted is a private fact, so no card lands on or by it (face-down Moves, design section 2).

  return jsonb_build_object('act', target, 'thread', (select thread from acts where id = target),
    'tally', (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target));
end $function$;

-- ---- the reply moment is gone ----
-- face_down_reply recorded the first post by another character in a back's thread: the reply trigger it served is gone (design, section 2), and with it the table, its row-once trigger, its backfill and
-- the policies it held. my_face_down keeps a `passed_at` column that is always null, so the readers written against it (the log page's pass lines) read none and are not broken; no instance holds a
-- back that was passed.
drop table face_down_reply;
drop function face_down_reply_once();
drop function face_down_reply_backfill();
