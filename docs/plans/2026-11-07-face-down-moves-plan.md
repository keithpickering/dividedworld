# Face-down Moves: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-face-down-moves-design.md`. One build session builds it
in one PR from `main`, after the design's PR is merged. The build PR says `Closes #233`, and links #55 and #226.

Every task is test first: name the test, record its red run, then write the code. The one check this plan adds
(Task 4) arrives with its self-test.

**Migrations.** One migration, `NNNN_face_down_moves.sql`, taking the next free number in `supabase/migrations/`
(0118 as this is written). Its SQL tests take the next free numbers in `supabase/tests/` (0119 on). Each function it
replaces is copied from its latest definition, found with `grep -l "function <name>\|view <name>"
supabase/migrations/*.sql` before copying; as this is written those are `spring_traps` (0092), `place_cast` and
`card_kinds_problem` (0108), `post`, `react`, `play_card` and `set_card`'s hand checks (0104), `place_set`,
`staff_set_card` (0086), `start_visit` (0110), `write_staff_act` (0109), `my_face_down` (0078), `my_card_ledger`
(0075) and `seed_instance` (0108). Everything a copied function does that this plan does not name stays as written, its
lock order included (0075's header, steps 1 to 6). A task that finds a function taking a later lock before an earlier
one stops and asks before widening the change.

**The layers.** The engine names no card. Divided World's cards, the kind words (Move, Gimmick, Ward), Hall Pass's art
and every line of copy are the instance's, through `CardRules`, `CardUi` and `UiCopy`. The boundary check holds.

## The words this plan uses

- A **Move** is a card whose play is `cast`: it may be cast, or set face down with a trigger.
- A **Gimmick** is a card whose play is `set`: set only, its trigger its own (`CardRules.trap.trigger`) or none (Bluff).
- A **chosen trigger** is a Move's, stored on its `face_down` row. A **card's trigger** is a Gimmick's, read from
  `card_kinds.trap`.

## Task 1. The rules: Moves can be set, two chosen triggers, retired cards (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`.

- `Trigger` becomes `{ on: 'cast' } | { on: 'quote' } | { on: 'visit' }`; `TRIGGERS` follows. `reaction` and `reply` go.
- `export type ChosenTrigger = 'cast' | 'quote'` and `CHOSEN_TRIGGERS`. A Gimmick's trigger may be `cast` or `visit`.
- `Outcome` and `OUTCOMES` go. `CardRules.trap` becomes `{ readonly trigger: Trigger }`, a Gimmick's alone. What a
  spring does is the engine's per trigger: a cast is caught and its card taken, a quote lands the card, a visit ends.
- `CardRules.setOn?: readonly ChosenTrigger[]`: the triggers a Move may be set on, both unless it says.
- `CardRules.setPhrase?(config: Config): string`: a phrase a Move's landing needs, found in the quoting post's own
  words (Autocorrect's). A Move with one is set on `quote` only (`instanceProblems` holds that).
- `CardRules.retired?: true`: the machine does not sell it, and its plays are the ones it had.
- `export function triggersFor(rules: CardRules): readonly ChosenTrigger[]`: the triggers the set form offers, a Move's
  `setOn` or both. A post Move set on cast only catches; it is still offered, and the form says so. A Gimmick or a Use
  gives `[]`.
- `decideSet(rules, settings, target, effects, config, trigger, now)`: for a Gimmick, `trigger` must be absent; for a
  Move, one of `triggersFor(rules)`, refused in plain words otherwise ("Whoops! is set on a cast or a quote"). The
  configuration is the card's own (`validateConfig`); the `cards` argument goes, since nothing strikes with another
  card. It returns `{ price: 0, config, trigger, phrase }`, where `phrase` is `setPhrase?.(config)`. A Use is refused
  as today. One live back per post and the post-reach rule stay.
- `instanceProblems`: a trap only on a Gimmick; a Gimmick's trigger is `cast` or `visit`; `setOn` only on a Move, a
  non-empty subset of `CHOSEN_TRIGGERS`; `setPhrase` only with `setOn` exactly `['quote']`; `retired` on any card. The
  old messages about outcomes, strikes and quadrants go.

**Tests first** (`cards.test.ts`, `instance.test.ts`): `decideSet` sets a Move on `cast` and on `quote`, refuses a
trigger outside `setOn`, refuses a trigger on a Gimmick and a missing one on a Move, refuses a Use, returns
`setPhrase`'s phrase; `instanceProblems` refuses each malformed shape above by name, and accepts a retired card.
**Red:** today's `decideSet` refuses every Move ("Whoops! is cast").

## Task 2. Divided World's cards: Trap Card retired, Hall Pass, Autocorrect on a quote (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/trap-card.ts`, `bluff.ts`, `autocorrect.ts`, a new `hall-pass.ts`,
`index.ts`, `cards.test.ts`; `instances/divided-world/settings.ts` and `settings.test.ts`.

- **Trap Card:** `retired: true`, `trap: { trigger: { on: 'cast' } }`. Its header says it is retired, why, and what a
  held copy still does.
- **Hall Pass** (`hall-pass`, Sweet, uncommon, `set`, `trap: { trigger: { on: 'visit' } }`, `priceKey:
  'hallPass.price'`, nothing more to play). Its header cites the design, section 4.
- **Autocorrect:** `setOn: ['quote']`, `setPhrase: (c) => c.phrase`.
- **Settings:** `hallPass.price` 150, beside `trapCard.price`, which stays for the retired card's history.
- `cards/index.ts` lists Hall Pass; its header names the Gimmicks.

**Tests first** (`cards.test.ts`, `settings.test.ts`): the instance passes `instanceProblems`; Hall Pass is a Gimmick on
a visit; Trap Card is retired; Autocorrect is set on quote only with its phrase; the economy holds `hallPass.price`.
**Red:** the instance has no `hall-pass`.

## Task 3. The schema: chosen triggers, the stolen card, one hand count, retired kinds (SQL)

Model: sonnet

**Files:** the migration; a test `supabase/tests/NNNN-face-down-moves.sql`.

- `face_down` gains `trigger text` (null for a Gimmick, which reads its card's) and `phrase text`, with a check: a
  trigger is `cast` or `quote`, and a phrase only with `quote`. Old rows are null in both and read their card's trigger.
  Nothing updates a `face_down` row; its append-only triggers stay.
- `card_kinds` gains `set_on text[]` (null for a Gimmick or a Use) and `retired boolean not null default false`.
  `seed_instance` writes both from the instance's cards (Task 1's fields), and its trap shape is `{trigger: {on}}`.
  `card_kinds_problem` holds Task 1's rules again, in the same words.
- `card_ledger.kind` gains `caught`: a card a back took. `act` is the spring.
- **One hand count.** `card_held(account uuid, card text) returns integer`: `bought` plus `caught` less `played`. Every
  inline count (in `play_card`, `set_card` and their staff and warn-bar copies, 0086 and 0104, and `my_cards`) calls it.
  The booster packs plan (`docs/plans/2026-11-04-booster-packs-plan.md`) also gives the hand one function: whichever
  lands second adds its kind to the other's.
- `buy_card` refuses a retired card: "Trap Card is no longer sold".
- `my_face_down` returns `trigger` and `phrase` to the setter; `my_card_ledger` returns `caught` rows.

**Tests first:** a Move set row with each trigger, refused with an unknown trigger and with a phrase on `cast`;
`card_held` counts a `caught` row; `buy_card` refuses Trap Card; the setter alone reads `trigger` and `phrase` from
`my_face_down`, and another account reads neither (default-deny, as `supabase/tests/0005-default-deny.sql` does).
**Red:** `face_down` has no `trigger` column.

## Task 4. One phrase matcher in two languages (engine, instance, tools)

Model: sonnet

**Files:** a new `engine/bbcode/phrase.ts` and `phrase.fixtures.ts` and `phrase.test.ts`;
`instances/divided-world/cards/autocorrect/match.ts`; the migration (`phrase_in(plain text, phrase text)
returns boolean`); new `tools/phrase-sql.mjs`, `tools/check-phrase-sql.mjs`, `tools/test-phrase-sql.mjs`; the generated
`supabase/tests/NNNN-phrase.sql`; `tools/build.mjs`'s `STEPS`.

Autocorrect's whole-word, case-folded finder (`occurrences`) moves to `engine/bbcode/phrase.ts`, unchanged, and
`autocorrect/match.ts` imports it. The SQL `phrase_in` asks the same question of `bbcode_plain(body)` (0117), which
already mirrors `visibleText(parse(body))`. The pair is held as `bbcode_plain` is: the fixtures are read by
`phrase.test.ts` against the TypeScript, `tools/phrase-sql.mjs` makes the SQL test from them, `check-phrase-sql.mjs`
holds that file to exactly what the fixtures make, and `test-phrase-sql.mjs` drives the check red on a hand-edited
SQL test. The fixtures cover at least: a phrase at the start and the end, inside a longer word (no match), next to
punctuation, in a quote (no match), in code and in a link (no match), mixed case, accented and non-Latin letters, a
digit beside it, and the case folds where JavaScript's `i` and Postgres's `~*` are known to part (dotless i, sharp s,
final sigma). Where they part, the SQL is made to agree with the TypeScript, never the other way.

**Tests first:** `phrase.test.ts` over the fixtures; the generated SQL test; the check's self-test. **Red:** `phrase_in`
does not exist; the poisoned SQL test fails the check.

## Task 5. Setting a Move (SQL, the act function)

Model: sonnet

**Files:** the migration (`set_card`, `place_set`); `supabase/functions/act/core.ts` and its test;
`engine/rules/actions.ts` (`setCard`); `engine/ui/data/api.ts` (`setCard`) and `engine/ui/data/fake.ts`.

- `set_card(account, card, character, post, config, price, trigger, phrase)` and `place_set` take the chosen trigger
  and the phrase. A Move needs a trigger in its `set_on`; a Gimmick takes none; a Use is refused; a retired Move sets as
  any other. The words for a refusal are Task 1's.
- The act function decides with `decideSet` and passes its `trigger` and `phrase`. The phrase comes from the card's own
  rules, never from the caller's request.
- `staff_set_card` is unchanged in behavior: a persona sets Gimmicks only (`supabase/functions/chatter/core.ts` already
  offers only `set` cards for a Set). Hall Pass is not offered to a persona (`staffOffers`), since a Mod Bot visits
  only players' posts.

**Tests first:** a player sets Whoops! on quote and Glitter Bomb on cast; the act function refuses a Move with no
trigger in its own words; the stored row holds Autocorrect's phrase. **Red:** `set_card` refuses a Move.

## Task 6. Springing: catch and steal, land on a quote, a Hall Pass ends a visit (SQL)

Model: sonnet

**Files:** the migration (`spring_traps`, `place_cast`, `post`, `react`, `start_visit`, `write_staff_act`, a new
`lay_sprung`); the test file from Task 3; rewrites of `supabase/tests/0059-card-plays.sql`,
`0077-trap-locks.sql`, `0089-staff-cards.sql`, `0107-visits.sql` and `0110-interception.sql` where they set test
cards on reply, reaction, payout or strike; `0080-reply-passes.sql` is removed with what it tests.

- `spring_traps(trigger, post, by_act, incoming_rarity, held)` reads a back's trigger as `coalesce(f.trigger,
  kind.trap #>> '{trigger,on}')`. Its decision:
  - **cast:** springs when the incoming card is at or below the back's card's rarity. The cast is caught (its Act's
    `caught`, as today). A player's caught card is written to the setter's ledger as `caught`; a staff cast's makes a
    new copy the same way. A staff setter takes nothing (no hand). A back whose card reaches a character also lays it
    on the caster.
  - **quote:** lays the back's card on the quoting post, its character, its thread or its board, by the card's first
    reach (`card_kinds.reaches[1]`), when its phrase, if any, is `phrase_in(bbcode_plain(body), phrase)`.
  - **visit:** a Gimmick on a visit ends it, as today.
- **Even work.** Before deciding, every back met does the same reads: the setter's character, the card's kind, the
  stack at the would-be target and reach, a board's live card, and `phrase_in` (with an empty phrase for a back with
  none, which matches nothing and costs the same). Only then is anything written. The migration header names each
  read and says it is made for every back.
- `lay_sprung(setter, card, config, target, reach, spring)`: writes the card Act as `place_cast` would, with no payer, no
  price, no message and the spring marked (`payload.spring`), and refuses nothing: every check that could refuse was a
  read above, and a failed one returns null before anything is written, leaving the back set.
- `post()` meets only the quoted post's back (its reply probe, `face_down_reply`'s writes and the thread scan go).
  `face_down_reply` and its policies are dropped. `react()` springs nothing. `place_cast` passes no price or caster, since
  nothing pays out.
- `write_staff_act`: a pool post that quotes a post springs its back like any quote (#233), taking the lock order's
  steps 3 to 5 before its insert, as `post()` does. A Move landing on a staff post or character is a card on staff like
  any other (the card mechanic design, section 9).

**Tests first** (the new file, races first as 0059's are): a cast caught by a set Whoops! lands caught and the caught
card is in the setter's hand (`card_held`); a rarer cast passes and the back stays; a staff cast caught makes a copy; a
quote lands a set Whoops! on the quoting post and a set Glitter Bomb on its character; a quote without Autocorrect's
phrase lands nothing and the back stays, and the next quote with it lands the strips; a full stack leaves the back set;
a Hall Pass ends a visit; a pool post quoting a trapped post springs it (#233); a reaction and a plain reply spring
nothing; and the even-work assertion: a Bluff, a back on the other trigger, a back that cannot land and a back that
springs each make the same reads, counted as `0077-trap-locks.sql` counts them. **Red:** today's `spring_traps` reads
the card's own outcome and never steals.

## Task 7. The struck player feels it: alerts, the log and the Lens (engine, instance)

Model: sonnet

**Files:** `engine/ui/alerts/words.ts` and `words.test.tsx`; `engine/ui/log/lines.ts` and its tests;
`engine/ui/cards/lens-words.ts` and `lens-words.test.ts`; `engine/ui/types.ts` (`UiCopy`); `instances/divided-world/ui/index.ts`.

- `trapStruck` names the setter's character, says the card was set face down and how long before it sprang, and names
  what set it off ("when you quoted their post", "when you cast Whoops! on it"). A caught caster's alert (a
  `trapStruck` on the caught play) says the card is now the setter's. The plain line is the engine's; the instance may
  give it a voice (`UiCopy.alerts`), which may gloat and never bluffs.
- The log: the setter's `set` line names the chosen trigger ("set face down on your post #41, to spring on a quote");
  `sprung` says what it landed on or caught, and that the caught card is in their hand; `caught` says the card went to
  the setter, naming the setter's character; `struck` names the trigger. The `payout` and `passed` lines go, and the
  rows that were written under them still read through their old words.
- The Lens on a card Act with `payload.spring` says "Set face down by Pipewrench on 5 November; sprang when Spritey quoted
  it" above the card's own rows.

**Tests first:** each line and alert above for a quote spring, a cast catch and a Hall Pass; a caught caster's alert
names the setter's character and never an account. **Red:** today's `trapStruck` says "A trap struck".

## Task 8. The play form: Play it now or Set face down (engine, the glass)

Model: sonnet

**Files:** `engine/ui/cards/PlayForm.tsx`, `forms.css` and `forms.test.tsx` (or `play.test.tsx`, where the form's tests
live); `engine/ui/cards/PlayActions.tsx` and its tests; `engine/ui/cards/play.tsx`.

- Arming a Move draws ghost marks on others' posts and on the player's own (`PlayActions.tsx`'s set branch reads
  `triggersFor`). A Gimmick's marks are on the player's own posts only, as today's Sets are.
- On one's own post, the form opens with a two-way choice at the top, **Play it now** and **Set face down**, a radio pair
  with a visible label and keyboard focus. Set swaps the price and message rows for the trigger picker (a radio group
  of `triggersFor`, each said plainly: "someone casts a card on this post (catches it; you take the card)",
  "someone quotes this post") and keeps the card's own settings (`CardUi.ConfigForm`). Under it: where the card will
  land for the chosen trigger and reach, and "Ends by itself in N days" from `setLasts`.
- A Gimmick's form opens as Set, with no choice and no picker, and says what it does.
- The ghost's name follows the choice ("Set Whoops! face down on post 41").
- Its ways out are the form's as today: Cancel, Close, Esc, the post's link, and the play.

**Tests first:** the choice shows only on one's own post and only for a Move; Set sends the chosen trigger; the picker
offers only `triggersFor`; a Gimmick opens as Set with no picker; the choice and the picker are reachable by keyboard
and labeled. **Red:** a Move armed on one's own post offers no Set.

**Before building,** run impeccable's `shape` step with the owner on the form's new rows, briefed on the glass's look
(`docs/plans/2026-10-29-two-worlds-design.md`, section 4, and `docs/research/2026-10-29-two-worlds/05-cards.html`), and
write the confirmed brief into the PR.

## Task 9. The kind tag: Move, Gimmick, Ward (engine, instance)

Model: inline

**Files:** `engine/ui/cards/faces.ts` (`playWord`), `engine/ui/cards/Postcard.tsx`, `engine/ui/types.ts` (`UiCopy`),
`instances/divided-world/ui/index.ts`, `engine/ui/cards/faces.test.tsx`.

`playWord` reads the instance's kind words, `UiCopy.cardKinds?: Readonly<Record<'cast' | 'set' | 'use', string>>`, and
falls back to today's capitalized play. Divided World's are Move, Gimmick and Ward. The face's spoken name follows.

**Tests first:** Whoops!'s face says Move, Bluff's Gimmick, Force Field's Ward; an instance without the words keeps
Cast, Set and Use. **Red:** Whoops! says Cast.

## Task 10. Hall Pass's art set (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/cards/hall-pass/art.svg`, `mark.svg`, `art.json` (new);
`instances/divided-world/ui/cards.ts`.

A full-art canvas to the card template (`docs/plans/2026-11-05-card-template-plan.md`, "The shapes, exactly"): a hall
pass on a lanyard, held up to a Mod Bot's red visor, in Sweet's color, the subject in the focus zone, the lower third
texture. Its mark reads at 18px. `art.json` credits "Divided World" as the others do. `cards.ts` gives Hall Pass its
color, tagline, summary and describe, and Trap Card's entry says it is retired.

**Tests first:** `node tools/check-card-art.mjs` fails on the empty folder, then passes. Render it at the fan's and the
sheet's sizes and look before committing.

## Task 11. The glass's words: the Strategy Guide and the cards' copy (instance)

Model: sonnet

**Files:** `instances/divided-world/guide/strategy-guide.md`; `instances/divided-world/ui/cards.ts`; the guide's tests
(`engine/ui/guide/markdown.test.ts` where they read the instance).

- The guide's "Cast, Use, Set" bullet becomes the three kinds: a Move is cast on a target or set face down on your own
  post to spring on a cast or a quote; a Gimmick is only set; a Ward guards your own post. It says plainly what a cast
  catch does (the caught card is the setter's) and that every card back looks the same.
- Each Move's `describe` gains one sentence on setting it, from its `triggersFor`; Trap Card's says it is retired and
  no longer sold; Bluff's no longer compares itself to Trap Card, and says it might be any card.

This is glass copy, committed for the owner's approval in review (CLAUDE.md, "The fiction may lie; the log never
does"). **Tests first:** the generated card list in the guide holds Hall Pass and no Trap Card price.

## Task 12. The export round-trips the new rows (SQL, e2e)

Model: haiku

**Files:** `supabase/tests/e2e/0003-export.ts`; the export's table list wherever it is held.

Seed a Move set on quote with a phrase, a cast caught by a back (its `caught` ledger row), and a Hall Pass ending a
visit; the export holds each, and an import of it is the same forum. `face_down_reply` leaves the export's list.

**Tests first:** the round trip with the new rows. **Red:** the export's "each table holds something" guard has no
`caught` ledger row.

## Last. The full build, the pictures and the final review

`npm run typecheck` and `npm run build:ci` green; screenshots of the play form in both choices, a Gimmick's form, the
card faces with their kind tags and Hall Pass's art, at the glass's sizes, attached to the PR. The final reviewer reads
the Review focus below.

## Ways out of the states this touches

- A face-down Move or Gimmick: springs once, or ends by itself at `setLasts`; one that cannot land waits for the next
  trigger or its time.
- A caught play: a finished Act; its card is the setter's.
- A visit a Hall Pass ended: finished, as today.
- A retired card in a hand: it can still be set, so it is never a dead card.

## The masks

- A back's card, trigger and phrase are read only by the setter's account (`my_face_down`). The Set Act, its Realtime
  event, `card_target` and the thread page carry none of them.
- Every write that meets a back makes the same reads whatever the back holds (Task 6), so its timing is not computed
  from the back.
- The steal writes to the setter's ledger only. The caught caster learns the setter's character, which the spring
  already shows, and never an account.
- No refusal in this plan reads who owns a character.

## Review focus

- **Even work across every back.** A Bluff, a back on the other trigger, a back whose phrase is absent, a back whose stack
  is full, and a back that springs: the same reads, in the same order, before the decision (Task 6).
- **The phrase matcher's two languages** agree on every fixture, and the fixtures reach the case folds where JavaScript
  and Postgres part (Task 4).
- **`write_staff_act`'s new trap path** takes the lock order and cannot deadlock against a player's cast on the same
  post (0075's races, run with a pool post).
- **Acts and rows an instance already holds:** old backs with no stored trigger read their card's; Trap Card's backs
  catch and steal now; old `payout` and `passed` log lines still read; nothing edits a `face_down` row.
- **The steal and the masks:** casting on one's own other mask's back gives the card back to the same account, and
  nothing in the answer, the alert or the log names an account.
- **A staff cast caught** makes one copy per catch, bounded by the pool's one card per post and its rarity cap.
- **The hand count** is `card_held` everywhere; no inline count of `bought` less `played` is left.
