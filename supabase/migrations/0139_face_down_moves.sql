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
--                           this) is unchanged, and a cast Gimmick set with no catch names none and catches nothing, as an old Trap Card does. The act function (supabase/functions/act/core.ts) passes the
--                           two from the card's own rules; set_card is callable by the service role alone, so a caller's request never reaches them.
--   staff_set_card(staff_key, card, target, config, catches)   takes the named catch. A persona sets Gimmicks only ("<card> is a Move; a persona sets Gimmicks"), and the refusal of a trap that
--                           pays out is gone with the payout.
--
-- Copied from their latest definitions: set_card from 0104_warn_bar.sql (its hand counted by card_held, Task 3), place_set and staff_set_card from 0086_staff_cards.sql. Everything they do that is not named
-- above stays as written, the lock order included (0075's header, steps 1 to 6): set_card takes the player's accounts row (1), place_set the target post's acts row (2), and nothing here takes a later lock before
-- an earlier one. The new reads (card_kinds) take no lock.
-- Masks. A refusal reads the card's own kind and the named card's, public facts, and never who owns a character. The stored catch and phrase are the setter's alone (Task 3).
-- Ways out. A back set here springs once or ends at setLasts, as every back does.

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

-- Called by the write that springs a back, never by the API's anonymous or digest roles (0117 granted bbcode_plain the same way).
revoke execute on function phrase_word_class(), phrase_fold(text), phrase_in(text, text) from public, anon;
grant execute on function phrase_word_class(), phrase_fold(text), phrase_in(text, text) to authenticated, service_role;

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
  if catches is not null and phrase is not null then raise exception 'a back waits for a card or a phrase, never both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
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
    -- Its reply moment, waiting for the first post by another character (a row for every card alike, a Bluff's too).
    insert into face_down_reply (play, thread) values (written, in_thread);
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
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  placed := place_set(who, card, target, coalesce(config, '{}'), null, 0, staff_set_card.catches, null);
  perform set_config('kayfabb.staff_writer', flag, true);
  return placed;
end $$;
revoke execute on function staff_set_card(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function staff_set_card(text, text, uuid, jsonb, text) to service_role;
