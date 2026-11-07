# Face-down Moves: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-face-down-moves-design.md`. One build session builds it
in one PR from `main`, after the design's PR is merged. The build PR says `Closes #233`, and links #55 and #226.

Every task is test first: name the test, record its red run, then write the code. The one check this plan adds
(Task 4) arrives with its self-test.

**Migrations.** One migration, `NNNN_face_down_moves.sql`, taking the next free number in `supabase/migrations/`
(0118 as this is written). Its SQL tests take the next free numbers in `supabase/tests/` (0119 on). Each function it
replaces is copied from its latest definition, found with `grep -l "function <name>\|view <name>"
supabase/migrations/*.sql` before copying; as this is written those are `spring_traps` (0092), `place_cast` and
`card_kinds_problem` (0108), `post`, `react`, `play_card` and `set_card`'s hand checks (0104), `place_set` and
`staff_set_card` (0086), `start_visit` (0110), `write_staff_act` (0109), `my_face_down` (0078), `my_card_ledger`
(0075) and `seed_instance` (0108). Everything a copied function does that this plan does not name stays as written, its
lock order included (0075's header, steps 1 to 6). A task that finds a function taking a later lock before an earlier
one stops and asks before widening the change.

**The layers.** The engine names no card. Divided World's cards, the kind words (Move, Gimmick, Ward), Hall Pass's art
and every line of copy are the instance's, through `CardRules`, `CardUi` and `UiCopy`. The boundary check holds.

## The words this plan uses

- A **Move** is a card whose play is `cast`: it may be cast, or set face down to spring on a quote.
- A **Gimmick** is a card whose play is `set`: set only, springing on its own trigger (`CardRules.trap.trigger`), or
  never (Bluff).

## Task 1. The rules: Moves can be set, Gimmicks' triggers, Trap Card's named catch (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`.

- `Trigger` becomes `{ on: 'cast' } | { on: 'visit' }`, a Gimmick's alone; `TRIGGERS` follows. A Move's trigger is the
  engine's (`quote`), never a card's. `reaction` and `reply` go.
- `Outcome` and `OUTCOMES` go. `CardRules.trap` becomes `{ readonly trigger: Trigger }`. What a spring does is the
  engine's per trigger: a Move on a quote lands; a cast Gimmick catches the card its configuration names and takes it;
  a visit Gimmick ends the visit.
- `CardRules.catches?(config: Config): string`: the key of the card a cast Gimmick waits for (Trap Card's). A cast
  Gimmick must have it (`instanceProblems`).
- `CardRules.setPhrase?(config: Config): string`: a phrase a Move's landing needs, found in the quoting post's own
  words (Autocorrect's).
- `decideSet(rules, settings, target, effects, config, cards, now)` accepts a Move and a Gimmick, and refuses a Use as
  today. The configuration is the card's own (`validateConfig`). A named catch must be one of `cards` that can be cast on
  a post, refused in plain words otherwise ("Trap Card names a card that is cast on a post"). It returns
  `{ price: 0, config, catches, phrase }`, from `catches?.(config)` and `setPhrase?.(config)`. One live back per post and
  the post-reach rule stay.
- `instanceProblems`: a trap only on a Gimmick; a Gimmick's trigger is `cast` or `visit`; `catches` exactly on a cast
  Gimmick; `setPhrase` only on a Move. The old messages about outcomes, strikes and quadrants go.

**Tests first** (`cards.test.ts`, `instance.test.ts`): `decideSet` sets a Move and returns its phrase; a Trap Card
naming Whoops! returns `catches: 'whoops'`; one naming a Use or an unknown key is refused; a Use is refused;
`instanceProblems` refuses each malformed shape above by name. **Red:** today's `decideSet` refuses every Move
("Whoops! is cast").

## Task 2. Divided World's cards: Trap Card names its catch, Hall Pass, Autocorrect's phrase (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/trap-card.ts`, `bluff.ts`, `autocorrect.ts`, a new `hall-pass.ts`,
`index.ts`, `cards.test.ts`; `instances/divided-world/settings.ts` and `settings.test.ts`.

- **Trap Card:** `trap: { trigger: { on: 'cast' } }`; its configuration is `{ card: string }`, checked as a key of
  1 to 64 characters (the instance's list is `decideSet`'s to check); `catches: (c) => c.card`. Its `staffOptions`
  give a persona the named card as an enum of the instance's keys, built in `cards/index.ts` after the list exists so
  `trap-card.ts` imports no other card. Its header cites the design, section 4.
- **Hall Pass** (`hall-pass`, Sweet, uncommon, `set`, `trap: { trigger: { on: 'visit' } }`, `priceKey:
  'hallPass.price'`, nothing more to play). Its header cites the design, section 4.
- **Autocorrect:** `setPhrase: (c) => c.phrase`.
- **Settings:** `hallPass.price` 150.
- `cards/index.ts` lists Hall Pass; its header names the three Gimmicks.

**Tests first** (`cards.test.ts`, `settings.test.ts`): the instance passes `instanceProblems`; Trap Card catches the card
it names; Hall Pass is a Gimmick on a visit; Autocorrect's phrase is its set phrase; the economy holds `hallPass.price`.
**Red:** the instance has no `hall-pass`.

## Task 3. The schema: the named catch, the phrase, the stolen card, one hand count (SQL)

Model: sonnet

**Files:** the migration; a test `supabase/tests/NNNN-face-down-moves.sql`.

- `face_down` gains `catches text references card_kinds (key)` and `phrase text`, with a check that a row holds at most
  one of them. Old rows hold neither. Nothing updates a `face_down` row; its append-only triggers stay.
- `card_kinds`' trap shape is `{trigger: {on}}`, `on` in `cast` or `visit`. `seed_instance` writes it, and
  `card_kinds_problem` holds Task 1's rules again, in the same words.
- `card_ledger.kind` gains `caught`: a card a Trap Card took. `act` is the spring.
- **One hand count.** `card_held(account uuid, card text) returns integer`: `bought` plus `caught` less `played`. Every
  inline count (in `play_card`, `set_card` and their staff and warn-bar copies, 0086 and 0104, and `my_cards`) calls it.
  The booster packs plan (`docs/plans/2026-11-04-booster-packs-plan.md`) also gives the hand one function: whichever
  lands second adds its kind to the other's.
- `my_face_down` returns `catches` and `phrase` to the setter; `my_card_ledger` returns `caught` rows.

**Tests first:** a Trap Card row with a named catch, refused with both a catch and a phrase; `card_held` counts a
`caught` row; the setter alone reads `catches` and `phrase` from `my_face_down`, and another account reads neither
(default-deny, as `supabase/tests/0005-default-deny.sql` does). **Red:** `face_down` has no `catches` column.

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

## Task 5. Setting a Move and naming a catch (SQL, the act function)

Model: sonnet

**Files:** the migration (`set_card`, `place_set`, `staff_set_card`); `supabase/functions/act/core.ts` and its test;
`supabase/functions/chatter/core.ts` and its test; `engine/rules/actions.ts` (`setCard`); `engine/ui/data/api.ts`
(`setCard`) and `engine/ui/data/fake.ts`.

- `set_card(account, card, character, post, config, price, catches, phrase)` and `place_set` take what `decideSet`
  returned. A Move or a Gimmick sets; a Use is refused; `catches` only for a cast Gimmick, and it must be a card kind
  that is cast. The refusals are Task 1's words.
- The act function decides with `decideSet` and passes its `catches` and `phrase`. Both come from the card's own rules,
  never from the caller's request.
- A persona sets Gimmicks only, as `chatter/core.ts` offers today. It drops today's filter on a paying trap (nothing pays
  out now), so Trap Card is offered with its `staffOptions`, and Hall Pass is not offered (`staffOffers`), since a Mod Bot
  visits only players' posts. `staff_set_card` takes the named catch.

**Tests first:** a player sets Whoops! and Glitter Bomb; a Trap Card naming Whoops! stores `catches`; the act function
refuses one naming Force Field in its own words; the stored row holds Autocorrect's phrase; a persona's Trap Card stores
its named catch. **Red:** `set_card` refuses a Move.

## Task 6. Springing: a quote lands a Move, Trap Card catches its card, Hall Pass ends a visit (SQL)

Model: sonnet

**Files:** the migration (`spring_traps`, `place_cast`, `post`, `react`, `start_visit`, `write_staff_act`, a new
`lay_sprung`); the test file from Task 3; rewrites of `supabase/tests/0059-card-plays.sql`,
`0077-trap-locks.sql`, `0089-staff-cards.sql`, `0107-visits.sql` and `0110-interception.sql` where they set test
cards on reply, reaction, payout or strike; `0080-reply-passes.sql` is removed with what it tests.

- `spring_traps(trigger, post, by_act, incoming_card, held)`. A back's trigger is `quote` for a Move and its card's
  `trap` for a Gimmick. Its decision:
  - **quote:** lays a Move on the quoting post, its character, its thread or its board, by the card's first reach
    (`card_kinds.reaches[1]`), when its phrase, if any, is `phrase_in(bbcode_plain(body), phrase)`.
  - **cast:** springs when `incoming_card` is the back's `catches`. The cast is caught (its Act's `caught`, as today).
    A player's caught card, or a copy of a staff cast's, is written to the setter's ledger as `caught`; a staff setter
    takes nothing.
  - **visit:** a Hall Pass ends the visit, as today's visit traps do.
- **Even work.** Before deciding, every back met does the same reads: the setter's character, the card's kind, the
  stack at the would-be target and reach, a board's live card, the named catch compared with the incoming card, and
  `phrase_in` (with an empty phrase for a back with none, which matches nothing and costs the same). Only then is
  anything written. The migration header names each read and says it is made for every back.
- `lay_sprung(setter, card, config, target, reach, spring)`: writes the card Act as `place_cast` would, with no payer, no
  price, no message and the spring marked (`payload.spring`), and refuses nothing: every check that could refuse was a
  read above, and a failed one returns null before anything is written, leaving the back set.
- `post()` meets only the quoted post's back (its reply probe, `face_down_reply`'s writes and the thread scan go).
  `face_down_reply` and its policies are dropped. `react()` springs nothing. `place_cast` passes the incoming card's key
  and no price or caster, since nothing pays out.
- `write_staff_act`: a pool post that quotes a post springs its back like any quote (#233), taking the lock order's
  steps 3 to 5 before its insert, as `post()` does. A Move landing on a staff post or character is a card on staff like
  any other (the card mechanic design, section 9).

**Tests first** (the new file, races first as 0059's are): a quote lands a set Whoops! on the quoting post and a set
Glitter Bomb on its character; a quote without Autocorrect's phrase lands nothing and the back stays, and the next quote
with it lands the strips; a full stack leaves the back set; a Trap Card naming Whoops! catches a cast Whoops! into the
setter's hand (`card_held`) and lets a Feelin' Fab pass, staying set; a rare cast is caught when named; a staff cast
named is copied; a Hall Pass ends a visit; a pool post quoting a trapped post springs it (#233); a cast on a back holding
a Move, a reaction and a plain reply spring nothing; and the even-work assertion: a Bluff, a Trap Card naming another
card, a Move that cannot land and a back that springs each make the same reads, counted as `0077-trap-locks.sql` counts
them. **Red:** today's `spring_traps` reads the card's own outcome and never steals.

## Task 7. The struck player feels it: alerts, the log and the Lens (engine, instance)

Model: sonnet

**Files:** `engine/ui/alerts/words.ts` and `words.test.tsx`; `engine/ui/log/lines.ts` and its tests;
`engine/ui/cards/lens-words.ts` and `lens-words.test.ts`; `engine/ui/types.ts` (`UiCopy`); `instances/divided-world/ui/index.ts`.

- `trapStruck` names the setter's character, says the card was set face down and how long before it sprang, and that
  the quote set it off. A caught caster's alert (a `trapStruck` on the caught play) says a Trap Card named their exact
  card and that it is now the setter's. The plain line is the engine's; the instance may give it a voice
  (`UiCopy.alerts`), which may gloat and never bluffs.
- The log: the setter's `set` line says what the back waits for ("to spring on a quote", "for a Whoops!", "for a Mod
  Bot's visit"); `sprung` says what it landed on or caught, and that the caught card is in their hand; `caught` says the
  card went to the setter, naming the setter's character; `struck` says a quote set it off. The `payout` and `passed`
  lines go, and the rows that were written under them still read through their old words.
- The Lens on a card Act with `payload.spring` says "Set face down by Pipewrench on 5 November; sprang when Spritey quoted
  it" above the card's own rows.

**Tests first:** each line and alert above for a quote spring, a catch and a Hall Pass; a caught caster's alert names
the setter's character and never an account. **Red:** today's `trapStruck` says "A trap struck".

## Task 8. The play form: Play it now or Set face down (engine, the glass)

Model: sonnet

**Files:** `engine/ui/cards/PlayForm.tsx`, `forms.css` and `forms.test.tsx` (or `play.test.tsx`, where the form's tests
live); `engine/ui/cards/PlayActions.tsx` and its tests; `engine/ui/cards/play.tsx`.

- Arming a Move draws ghost marks on others' posts and on the player's own. A Gimmick's marks are on the player's own
  posts only, as today's Sets are.
- On one's own post, a Move's form opens with a two-way choice at the top, **Play it now** and **Set face down**, a radio
  pair with a visible label and keyboard focus. Set swaps the price and message rows for what the set does ("Springs
  when someone quotes this post, and lands on" the quoting post, its writer, its thread or its board, by the card's
  reach) and keeps the card's own settings (`CardUi.ConfigForm`). Under it: "Ends by itself in N days" from `setLasts`.
- A Gimmick's form opens as Set, with no choice, and says what it does. Trap Card's `ConfigForm` is a picker of every
  card that can be cast on a post, with each card's face, not only the setter's hand.
- The ghost's name follows the choice ("Set Whoops! face down on post 41").
- Its ways out are the form's as today: Cancel, Close, Esc, the post's link, and the play.

**Tests first:** the choice shows only on one's own post and only for a Move; Set sends a set; a Gimmick opens as Set;
Trap Card's picker offers every castable post card and no Use; the choice and the picker are reachable by keyboard and
labeled. **Red:** a Move armed on one's own post offers no Set.

**Before building,** run impeccable's `shape` step with the owner on the form's new rows and Trap Card's picker, briefed
on the glass's look (`docs/plans/2026-10-29-two-worlds-design.md`, section 4, and
`docs/research/2026-10-29-two-worlds/05-cards.html`), and write the confirmed brief into the PR.

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
color, tagline, summary and describe.

**Tests first:** `node tools/check-card-art.mjs` fails on the empty folder, then passes. Render it at the fan's and the
sheet's sizes and look before committing.

## Task 11. The glass's words: the Strategy Guide and the cards' copy (instance)

Model: sonnet

**Files:** `instances/divided-world/guide/strategy-guide.md`; `instances/divided-world/ui/cards.ts`; the guide's tests
(`engine/ui/guide/markdown.test.ts` where they read the instance).

- The guide's "Cast, Use, Set" bullet becomes the three kinds: a Move is cast on a target or set face down on your own
  post to spring on whoever quotes it; a Gimmick is only set; a Ward guards your own post. It says every card back looks
  the same.
- Each Move's `describe` gains one sentence on setting it. Trap Card's says you name the exact card, any card, and take
  it when it is cast on your post. Bluff's no longer compares itself to Trap Card, and says it might be any card.

This is glass copy, committed for the owner's approval in review (CLAUDE.md, "The fiction may lie; the log never
does"). **Tests first:** the generated card list in the guide holds Hall Pass.

## Task 12. The export round-trips the new rows (SQL, e2e)

Model: haiku

**Files:** `supabase/tests/e2e/0003-export.ts`; the export's table list wherever it is held.

Seed a Move set with a phrase, a cast a Trap Card caught (its `caught` ledger row), and a Hall Pass ending a visit; the
export holds each, and an import of it is the same forum. `face_down_reply` leaves the export's list.

**Tests first:** the round trip with the new rows. **Red:** the export has no `caught` ledger row to carry.

## Last. The full build, the pictures and the final review

`npm run typecheck` and `npm run build:ci` green; screenshots of the play form in both choices, Trap Card's picker, the
card faces with their kind tags and Hall Pass's art, at the glass's sizes, attached to the PR. The final reviewer reads
the Review focus below.

## Ways out of the states this touches

- A face-down Move or Gimmick: springs once, or ends by itself at `setLasts`; a Move that cannot land waits for the next
  quote or its time.
- A caught play: a finished Act; its card is the setter's, or spent where the setter is staff.
- A visit a Hall Pass ended: finished, as today.

## The masks

- A back's card, named catch and phrase are read only by the setter's account (`my_face_down`). The Set Act, its
  Realtime event, `card_target` and the thread page carry none of them.
- Every write that meets a back makes the same reads whatever the back holds (Task 6), so its timing is not computed
  from the back.
- The steal writes to the setter's ledger only. The caught caster learns the setter's character, which the spring
  already shows, and never an account.
- No refusal in this plan reads who owns a character.

## Review focus

- **Even work across every back.** A Bluff, a Trap Card naming another card, a Move whose phrase is absent, a Move whose
  stack is full, and a back that springs: the same reads, in the same order, before the decision (Task 6).
- **The phrase matcher's two languages** agree on every fixture, and the fixtures reach the case folds where JavaScript
  and Postgres part (Task 4).
- **`write_staff_act`'s new trap path** takes the lock order and cannot deadlock against a player's cast on the same
  post (0075's races, run with a pool post).
- **Acts and rows an instance already holds:** old Trap Card backs name no card and catch nothing; old `payout` and
  `passed` log lines still read; nothing edits a `face_down` row.
- **The steal and the masks:** casting on one's own other mask's Trap Card gives the card back to the same account, and
  nothing in the answer, the alert or the log names an account.
- **A staff cast caught** makes one copy per catch, bounded by the pool's one card per post and its rarity cap; a Mod
  Bot's Trap Card spends the card it catches.
- **The hand count** is `card_held` everywhere; no inline count of `bought` less `played` is left.
