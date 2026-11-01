# Card plays, traps and wards: plan (Part 1)

Record, written 2026-11-01. Part 1 of `docs/plans/2026-11-01-card-mechanic-design.md`: its sections 1 to 6, 9, 10 and the
masks and ways out that go with them. It is built by one build session in one PR. The PR says `Closes #122`, and it
links #55 and #132 without closing them, since #55's card condition and #132's other children stay open. Part 2 (reach,
#34) is `docs/plans/2026-11-01-card-reach-plan.md`, built after this merges.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so there is no
poison to plant beyond the refusals each test drives red. The engine/instance boundary check runs in the build as always:
nothing in `engine/` or `supabase/` names Trap Card, Force Field, Bluff, Whoops! or Stick Around, and the engine's tests use
test cards of their own. One migration, `supabase/migrations/0054_card_plays.sql`, is written across Tasks 2 and 3 and
committed with its SQL test, `supabase/tests/0059-card-plays.sql`. Every SQL test runs against Postgres on localhost.
What a player reads is in American English, in the design's words.

## Task 1. Rarity, plays, traps and wards in the card interface (engine)

**Files:** `engine/rules/cards.ts`, `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts` (`instanceProblems`),
`engine/rules/actions.ts`; tests in a new `engine/rules/cards.test.ts`, `engine/rules/instance.test.ts` and
`engine/rules/actions.test.ts`.

- `Rarity = 'common' | 'uncommon' | 'rare' | 'legendary'`, with `RARITIES` in that order and `atOrBelow(a, b)`.
- `Play = 'cast' | 'use' | 'set' | 'keep'`.
- `Trigger` is one of:
  - `{ on: 'cast' }`
  - `{ on: 'reaction', quadrant }`
  - `{ on: 'reply' }`
  - `{ on: 'quote' }`
  - `{ on: 'visit' }`
- `Outcome` is one of:
  - `{ do: 'nullify' }`
  - `{ do: 'payout' }`
  - `{ do: 'strike', card: string }`
- `CardRules` gains:
  - `rarity: Rarity`, required
  - `play?: Play`, `'cast'` unless said
  - `trap?: { trigger; outcome }`, a Set card's alone; a Set card with none is a bluff
  - `ward?: true`, a Use card's alone
  - `lasts?: Span`, a Use card's time up
- `Settings` gains `setLasts: Span`.
- `decidePlay` refuses before the card's own `canApply` when a live ward on the target covers the card's rarity, in the
  design's words ("this post's Force Field turns away cards up to uncommon"). `CardEffect` gains `ward?: Rarity` and
  `ends?: string`, filled by `card_target` (Task 2).
- `decideSet(rules, settings, target, effects, config)`:
  - refuses a card that is not a Set, and a post that already holds a face-down card
  - for a strike, checks the struck card's configuration with that card's own `validateConfig` and returns it
- `decideUse` refuses a card that is not a Use. That the target is the player's own is SQL's to hold, since only SQL
  reads who wrote it.
- `instanceProblems` refuses each of these, naming the card:
  - a `trap` on a card that is not a Set
  - a `ward` or `lasts` on a card that is not a Use
  - a strike naming a card the instance does not have, or one rarer than the trap
  - a `visit` trigger, until the staff build wires visits; the refusal says so
  - a `keep` card, until Keep is designed
  - a missing `rarity`
  - a `setLasts` that is not a span

Tests first:
- `decidePlay` is refused by a ward of the card's rarity and passes under a rarer card.
- An ended ward (its `ends` past) refuses nothing.
- `decideSet` refuses a second face-down card and a Cast card.
- A strike's configuration is checked by the struck card's rules.
- Each of `instanceProblems`' new refusals, each driven red by an instance that holds the defect.

## Task 2. Schema, Set, Use and wards (SQL)

**Files:** `supabase/migrations/0054_card_plays.sql` (new); test `supabase/tests/0059-card-plays.sql` (new).

- `card_kinds` gains:
  - `rarity`, checked to the four
  - `play`, checked to the four
  - `trap jsonb`, null unless a Set
  - `ward boolean`
  - `lasts interval`
- `seed_instance` (latest, `0051_succession.sql`) writes the new columns from the instance's cards, and checks the same
  pairings `instanceProblems` does.
- Act kinds gain `set` (targets a post, payload `{}` and nothing else) and `spring` (targets the trapped post, payload
  `{card, trigger, outcome, caught?, by}`).
  - Following 0046's pattern, the kind check, the target check and a payload check for each are rewritten.
  - `acts_count_character` counts neither, so a post count says nothing new.
- `face_down` (play pk references acts, account, card, config jsonb, ends_at):
  - RLS: select for its own account only; no client writes
  - a unique index on its post (through the play), so a post holds one face-down card
- `set_card(who, card, through, target, config)`, service only:
  - checks `played_by` and that `through` wrote `target`
  - checks the hand holds the card, and that it is a Set
  - refuses a second face-down card on the post, in plain words
  - writes the `set` Act, then the `face_down` row with `ends_at = now() + setLasts`, then the card ledger's `played` row
- `play_card` (latest, 0016) gains:
  - the play check: a Cast through `play_card`, a Use through it with `through` the target's author
  - the ward check before the stack check, refusing a cast at or below a live ward's rarity in the words of Task 1
  - Use rows' end written in `payload.ends`, a fact of the play when it lands
- `card_target` (0006) gives each effect its `ward` and `ends`. A `set` Act shows as `{card: null, faceDown: true, ends}`
  and never names its card.
- `my_face_down` view: the caller's own `face_down` rows, for the hand and the log.

Tests first:
- `set_card` through a character that did not write the post is refused.
- A second Set on a post is refused, and so is a Set with no card in hand.
- `face_down` is unreadable by another account and by anon.
- A `set` Act's projection, its Realtime row and `card_target` carry no card key.
- A cast under a live ward of its rarity is refused, and is not refused once the ward ends.
- A Use through someone else's post is refused.
- A Bluff's `set` Act and a Trap Card's are byte-for-byte the same shape.

## Task 3. Springing (SQL)

**Files:** `supabase/migrations/0054_card_plays.sql`, `supabase/tests/0059-card-plays.sql`.

- `spring_traps(trigger text, post uuid, by_act uuid, quadrant text, incoming_rarity text)` returns the spring Act or null.
  It locks the post's `face_down` row if one is live. If the row is a trap whose trigger matches, and (for a cast) whose
  rarity is at or above the incoming card's, it writes the outcome:
  - **nullify:** the `spring` Act, with `caught` = the incoming play
  - **payout:** the same, then `wallet_move` to the setter's account by the play's price, with a `wallet_events` kind
    `trap` (the kind check is extended), capped by the wallet's cap as `wallet_move` already caps
  - **strike:** writes the struck card's `card` Act by the setter's character on `by_act`'s post, with the configuration
    kept on `face_down`, a seed if the card is seeded, and its layer. If the stack is full, it writes nothing and the trap
    stays set
- A spring ends the `face_down` row by a `spring` Act pointing at its `set` Act, never by an UPDATE. A row is live while
  `ends_at > now()` and no `spring` names it.
- `play_card` calls it before writing the cast, so the cast's Act is written with `payload.caught` = the set Act when
  caught. It is spent all the same (ledger and price), and the cast's effect is drawn as caught.
- `react` (latest, 0015) calls it with `reaction` and the quadrant. `post` (latest, 0013) calls it with `quote` for a quoted
  post, and with `reply` for the newest earlier post in the thread by another character that holds a live reply trap.
- None of these raise for a trap. An error inside `spring_traps` is a bug, and the test proves no trap path raises on a
  well-formed write.

Tests first:
- A Trap Card catches a common Whoops!, and the caster's ledger, the wallet event and the setter's wallet move by exactly
  the play's price, capped at the cap.
- A legendary test card passes over an uncommon trap, and the trap stays set.
- A Bluff and a trap waiting on another trigger leave a cast untouched, and do the same reads.
- Each trigger springs its test trap once, and only once.
- An ended trap springs nothing.
- A strike onto a full stack leaves the trap set.
- A reaction and a post on a trapped post are never refused by the trap.
- Two casts at once on one trapped post: exactly one is caught.

## Task 4. The act function: Set and Use (Edge Function, engine)

**Files:** `engine/rules/actions.ts` (`setCard`, `useCard`), `supabase/functions/act/core.ts` (`runAction`); tests in
`engine/rules/actions.test.ts` and `supabase/functions/act/core.test.ts`.

- `setCard` and `useCard` decide with Task 1's rules, priced like a play (`needsTarget`).
- `live()` broadcasts a `set` Act as `card_target` shows it, with no card key.
- A strike's configuration is validated here and passed to `set_card`.

Tests first:
- A Set request's broadcast and answer carry no card key.
- A Use on a post under someone else's character is refused by SQL and answered with its words.
- A strike's bad configuration is refused before SQL.

## Task 5. Staff posts earn, and springs settle (SQL, engine)

**Files:** `supabase/migrations/0054_card_plays.sql` (`is_staff_side`, `settlement_input`, both latest at 0043),
`engine/rules/settle.ts`; tests `engine/rules/settle.test.ts` and `supabase/tests/0059-card-plays.sql`.

- `is_staff_side` no longer counts a card on a staff post as staff side. `settlement_input` adds `unscoredTargets`: each
  staff post a window's card landed on, with its reactions as for any Act, and its author marked staff.
- `settle.ts` reads a card's target from the window's Acts or from `unscoredTargets`, pays the card's caster by class, and
  pays a staff target nobody.
- A `spring` Act settles as a play of its trap card on the trapped post (its alignment, its target).
- A caught play settles as the play it is.

Tests first:
- A Heel's Salty card that draws more than a Boss's post earns the Heel's +0.20, and the Boss earns nothing.
- A Face's Sweet card outdrawn by the Boss post pays its −0.20.
- A `spring` Act's reactions pay its setter by class.
- A settlement holding none of these is unchanged against the existing fixtures (`settle.scale.test.ts` holds).

## Task 6. The log (engine)

**Files:** `supabase/migrations/0054_card_plays.sql` (`my_caught`: the caller's plays that were caught, with the trap's
card), `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`, `engine/ui/log/lines.ts`; tests
`engine/ui/log/lines.test.tsx` and `web/src/data/supabase.test.tsx`.

- New line kinds: `set`, `sprung`, `caught`, `struck`, `setEnded`, `payout`, in the design's section 10 words.
- A caught play's line says its whole cost, read from the caller's own card ledger.
- `my_caught` answers only the caller's own plays, and a spring is public by then.

Tests first:
- Each line kind's words.
- No line names an owner or a reactor.
- `my_caught` is empty for another account's caught play.

## Task 7. The screens (engine)

The glass, the game's own interface (`docs/plans/2026-10-29-two-worlds-design.md`), plain and never in character.

**Files:** `engine/ui/cards/types.ts` (`CardPlay.faceDown`, `.caught`, `.ends`), `engine/ui/cards/plays.ts`,
`engine/ui/cards/Marks.tsx` and `marks.ts`, `engine/ui/cards/Lens.tsx`, `engine/ui/cards/land.ts` and `PlayActions.tsx`,
`engine/ui/cards/Hand.tsx`, `engine/ui/cards/Postcard.tsx`, `engine/ui/cards/PlayForm.tsx`, `engine/ui/vending/Vending.tsx`;
tests beside each.

- **The card back.** One mark for any face-down card: the engine's own back art, the same for every card. The Lens's Who row
  reads "A card set face down by PIPEWRENCH", with when it was set and when it ends. On the setter's own screen, the face
  of their card is shown under the back, from `my_face_down`.
- **A caught play** shows as its card's mark, dimmed, with "Caught by a Trap Card" in the Lens and no effect drawn.
- **A ward** is a mark with its card's art, and its Lens line says what it turns away and when it ends.
- **Arming a Set or a Use** draws ghost marks only on posts by the reader's own characters, decided on the reader's screen.
  A Set's ghost reads "Set Trap Card face down on post 41". A Use's ghost reads "Use Force Field on post 41".
- **Rarity and play** on a card's face and in the Vending Machine's slot: a corner gem per rarity and the play's word
  ("Set"). Neither uses color alone.
- **The play form** for a Set with a strike holds the struck card's own `ConfigForm`.
- Live: a `set` broadcast adds a back; a `spring` broadcast reveals it in place and never reorders marks.

Tests first:
- A back's accessible name and Lens are the same for a trap and a Bluff, for any reader but the setter.
- Ghost marks for a Set appear on own posts only.
- A caught play draws no effect.
- The rarity gem has a text name.
- A spring arriving live keeps the mark order.

## Task 8. Trap Card, Force Field and Bluff (instance)

**Files:** `instances/divided-world/cards/trap-card.ts`, `force-field.ts`, `bluff.ts` (new), `instances/divided-world/cards/index.ts`,
`whoops.ts` and `stick-around.ts` (rarity), `instances/divided-world/settings.ts` (prices, `setLasts`),
`instances/divided-world/ui/cards.ts` (art, `describe`, `summary`); tests `instances/divided-world/cards/cards.test.ts`
and `instances/divided-world/settings.test.ts`.

- **Trap Card:** uncommon, Salty, Set; `{ trigger: { on: 'cast' }, outcome: { do: 'payout' } }`. Price 1.50.
- **Force Field:** uncommon, Sweet, Use, ward, lasts 7 days. Price 1.50.
- **Bluff:** common, Pepperoni, Set, no trap. Price 0.25.
- **Whoops!** and **Stick Around:** common.
- `setLasts`: 7 days. The prices are starting numbers.

Tests first:
- The instance passes `instanceProblems`.
- Bluff's and Trap Card's Set requests are identical but for the card key, which never leaves the service.

## Task 9. Stories and shots for the owner's word

**Files:** stories beside Task 7's files, and shots under `docs/research/2026-11-01-card-plays-shots/` (new).

The card back, a caught play, a ward, a Set's ghost marks, the rarity gem on a card face and a slot, at 1440 and 390, light
and dark. The PR waits on the owner's word on them. Changes go in as amendments to this plan.

## Last. The full build and the final review

`npm run typecheck` and `npm run build:ci`, with output. The final reviewer reads this plan's Review focus.

## Ways out of the states this touches

- A face-down card: springs once, or ends at `setLasts` by itself.
- A ward: ends at its card's `lasts`.
- A caught play: finished; nothing to clear.
- A strike's card: its own card's way out (Whoops! is always readable and washable).

## Review focus

- Every path that writes a cast, a reaction or a post now runs `spring_traps`. Check that no trap path can raise and refuse
  a player's own write, and that the lock order (account, then post, then `face_down`) cannot deadlock against a concurrent
  `set_card`.
- A face-down card's key must never reach a client: the `set` Act's projection, Realtime, `card_target`, `cardsOnMany`, the
  digest's reads (0045) and an export. Check each.
- A Bluff and a trap that does not match must do the same reads, so a write's timing does not name the card.
- Pay out credits the setter's account, read from `face_down`. Check that no response to the caster carries the amount or
  the account.
- `is_staff_side`'s change touches every settlement. Check that staff Acts are still left out, and that a card on a staff
  post is counted once.
- Acts an instance already holds: Whoops! and Stick Around plays get rarity through `card_kinds`, and nothing in an existing
  Act changes. Check that an export from before 0054 imports and round-trips.
