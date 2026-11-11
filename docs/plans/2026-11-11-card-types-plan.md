# Card types: Moves, Reversals and Gimmicks: plan

Record, written 2026-11-11. The plan for `docs/plans/2026-11-11-card-types-design.md`. One build session builds it in one
PR from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. This plan adds no `check-*.mjs`. The
new validations in `instanceProblems` and `card_kinds_problem` are each driven red by a poisoned card in their tests
(listed in Tasks 1 and 3).

**Migrations.** One migration, `NNNN_card_types.sql`, taking the next free number in `supabase/migrations/` (0146 as
this is written). Its SQL tests take the next free numbers in `supabase/tests/` (0148 on). Each function it replaces is
copied from its latest definition, found case-insensitively: some were last redefined in upper case, so search with
`grep -il "function public.<name>\|function <name>" supabase/migrations/*.sql`. As this is written they are:

| Function | Latest definition |
|---|---|
| `play_card` | 0139:295 |
| `place_cast`, `card_kinds_problem`, `card_held`, `staff_set_card`, `my_card_ledger` | 0142 |
| `place_set`, `set_card`, `spring_facts`, `spring_traps`, `my_face_down` | 0144 |
| `card_target`, `reach_effects`, `effects_above`, `estimate_input` | 0092 |
| `seed_instance` | 0139:506 |
| `settlement_input` | 0116:22 |
| the Act kind check | `acts_kind_check`, 0109 |

Everything a copied function does that this plan does not name stays as written, its lock order included. A task that
finds a function taking a later lock before an earlier one stops and asks before widening the change.

**No instance is deployed.** A local database is rebuilt from the migrations (`supabase db reset`), so no row of Bluff's
or of `card_kinds.ward` survives into the new schema. The migration still says what it does to rows a database holds
(Task 3).

**The layers.** The engine names no card, kind word or reaction. Gimmick effects and Reversal matches are engine types
on `CardRules`. Divided World's cards choose them; its kind words, art and copy come through `CardUi` and `UiCopy`. The
boundary check holds.

## The words this plan uses

- A **Move** is a card whose play is `cast`.
- A **Reversal** is a card whose play is `set`.
- A **Gimmick** is a card whose play is `use`.
- A **back** (a trap) is any card lying face down, a Move or a Reversal.
- The engine's own strings and comments say "a set card" and "a use card", never the instance's words.

## Task 1. The rules: Gimmick effects, Reversal matches, no unsprung set card (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`.

**Gimmick effects.**
- `CardRules.ward?: true` goes. In its place, `CardRules.gimmick?: GimmickEffect`, a union:
  - `{ kind: 'ward'; upTo?: Rarity; flavors?: readonly Alignment[]; cards?: readonly string[] }`, with at least one of
    the three;
  - `{ kind: 'earn'; quadrants?: readonly Quadrant[]; reactions?: readonly string[]; by: number }`, with at least one of
    `quadrants` and `reactions`, and `0 < by <= 1`;
  - `{ kind: 'price'; flavors: readonly Alignment[]; add: Hundredths }`, with `add` a positive integer.
- `CardEffect.ward?: Rarity` becomes `CardEffect.gimmick?: GimmickEffect`, carried for a live use card's play.

**The ward check.**
- `decidePlay` (cards.ts:231) keeps its place: a live ward on the target's own reach refuses before the card's rules.
- It now asks `wardTurnsAway(effect, rules)`: the card's rarity is at or below `upTo`, or its printed `alignment` is in
  `flavors`, or its key is in `cards`.
- `wardWords` (cards.ts:111) says whichever matched, in plain words. Examples:
  - "this post's Force Field turns away cards up to uncommon"
  - "this post's {name} turns away Salty cards"
  - "this post's {name} turns away Whoops!"

  `nameOf` names a card.

**The price.**
- `decided` (cards.ts:202) adds every live price effect on the target, or on a reach above it (`effectsOnTarget` already
  joins them), whose `flavors` hold the incoming card's printed alignment.
- The price is `max(0, playPrice + sum)`.
- `decideUse` and `decideSet` never take a surcharge.

**Reversals.**
- `CardRules.trap` becomes `{ trigger: Trigger; match?: Match }`. `Match` is `{ flavors?: readonly Alignment[];
  upTo?: Rarity }` and is only for a cast trigger. A cast Reversal either names its card through `catches` or has a
  `match`, never both.
- `decideSet` (cards.ts:273) refuses:
  - a named card rarer than the Reversal ("{name} names cards up to {rarity}");
  - a `match.upTo` rarer than the Reversal.
- A set card with no `trap` is refused. The "a Gimmick with none is a bluff" case and its comments go (cards.ts:132-137).

**`instanceProblems`** (instance.ts:437-448) refuses each of the following. Each item is a poisoned card that drives the
test red first:
- a use card with no `gimmick`;
- a `gimmick` on a card that is not a use card;
- a use card with no `lasts`;
- a use card that reaches a board, or reaches anything outside post, character and thread;
- a set card with no `trap`;
- a `trap.match` on a visit trigger, or both `catches` and `match` on one card;
- an empty `ward`; an `earn` with `by` of 0 or above 1; an `earn` naming no quadrant and no reaction; an `earn` naming
  a reaction the instance does not have;
- a `price` with `add` of 0, or with no flavors.

Its strings move to the engine's words: "only a set card has a trap", "a set card springs on cast or visit", and so on.

**Tests** in `cards.test.ts`:
- a ward by rarity, by flavor (Pepperoni is its own flavor), and by name, each refusing with its words;
- a ward on a thread does not refuse a cast on a post under it;
- a price effect on a thread raising a Salty cast on a post under it, and leaving a Sweet one alone;
- a price never below zero;
- a Reversal naming a card above its rarity refused;
- a set card with no trap refused.

## Task 2. Settlement: a spring scores on what sprang it, and Earn (engine, instance)

Model: sonnet

**Files:** `engine/rules/types.ts`, `engine/rules/settle.ts`, `engine/rules/settle.test.ts`,
`instances/divided-world/classes/shared.ts`, `instances/divided-world/classes/{lurker,technician,tweener}.ts`, the
classes' tests.

**Spring scoring.**
- `InputAct` (types.ts:340) gains `by?: string`, the Act that sprang a `spring`.
- In the play loop (settle.ts:378-414), a spring with `by` is scored against `actOf(by)` in place of its trapped post:
  - A `by` that is a staff Act or visit (not among the scored Acts) is a staff target: `{ id, character: null }`, so
    `onOthers` holds, as `unscoredTargets` does for a staff post.
  - A spring with no `by` (older rows) keeps its trapped post.
- `targetAfter`, `outdraws` and `LandedCard` then read the caught cast or the visit.
- The header comment (settle.ts:31-32) says so.

**Reaction kind.**
- `ReceivedReaction` (types.ts:422) gains `kind: string`, filled where settle.ts:290-295 builds `received` (the
  reaction's own `kind` from `InputReaction`).
- `Earning` gains `kind?: string`.
- `perVote` (classes/shared.ts:8) carries `kind` from the reaction. So does every earning in lurker, technician and
  tweener that is built from a single reaction.

**Earn.**
- `InputAct` gains `ends?: number` (a use card's `payload.ends`) and `on?: string` (the character a character-reach play
  is on).
- After each character's class earnings are computed, settlement finds that character's live Earn Gimmicks: use-card
  Acts whose card has `gimmick.kind === 'earn'`, on the character itself (`on`) or on one of its posts (`target`),
  admin-ended plays already left out of the input.
- For every earning with `amount > 0` that meets all of the following, it adds an earning with reason `card.boost`,
  `params: { card }`, `act` the earning's act, and amount `tidy(amount * by)`:
  - its `act` is the character's (or is the boosted post);
  - its `at` falls in `[the Gimmick's at, ends)`;
  - its quadrant is in `quadrants`, or its `kind` is in `reactions`.
- An earning with no `at` or no quadrant is never boosted.
- Two live Earn Gimmicks on one character each boost on their own.
- `card.boost` is an engine reason; the instance words it (Task 8).

**Tests** in `settle.test.ts`:
- **Spring scoring.**
  - A Salty spring catching another player's cast, outdrawing it, earns a Heel `heel.stoleThunder` (or the reason
    heel.ts uses).
  - The same spring on one's own other mask's cast earns nothing.
  - A Sweet visit spring that draws hype earns a Face.
  - A spring with no `by` scores as before.
- **Earn.**
  - +10% on a Technician's calm-positive earnings inside the window, and none outside it.
  - None on a negative earning.
  - A reaction-kind boost (`laughing`) leaves another excited-positive reaction alone.
  - An admin-ended Earn Gimmick boosts nothing.

## Task 3. The schema: Gimmicks in the catalog, the ward everywhere, Gimmicks on one's own thread (SQL)

Model: sonnet

**Files:** the migration, `supabase/functions/_shared/seed.ts` and its test, SQL tests.

**The catalog.**
- `card_kinds`: drop `ward boolean`, add `gimmick jsonb` (null for every card but a use card). `trap` holds `match` when
  a card has one.
- `seed_instance` and `seed.ts:44-46` send `gimmick` in place of `ward`.
- `card_kinds_problem` (0142:136) holds what Task 1's `instanceProblems` holds that SQL can check, in the engine's words:
  - a use card has a gimmick and `lasts`;
  - only a use card has a gimmick;
  - a set card has a trap;
  - a gimmick's kind is ward, earn or price;
  - a use card reaches post, character or thread.

  Poisons in its SQL test: a use card with no gimmick, a gimmick on a cast card, a set card with no trap, a use card
  reaching a board.

**The ward in SQL.**
- `card_target` (0092:464), `reach_effects` (0092:434) and `effects_above` (0092:444) carry
  `'gimmick', ck.gimmick` for a live use card's play in place of `'ward', …`.
- `place_cast` (0142:755-765) turns away a cast at every reach, where today it does so at post reach only. A live ward
  Gimmick on the cast's own target turns it away when any of these holds:
  - the cast card's rarity is at or below `upTo`;
  - its alignment is in `flavors`;
  - its key is in `cards`.

  The words are `wardWords`' (Task 1) and the errcode is 42501, as today.
- `spring_facts`' step 4b (0144:657-661) uses the same test for a Move landing on a warded quoting post.

**One's own thread.**
- `place_cast`, for a use card at thread reach, refuses unless the thread's first post is by the caster's character:
  "% is used on a thread your own character started" (42501).
- A use card at board reach is refused. No card is one, and the catalog check refuses one.
- `distract_visits` still runs for a thread-reach play (0142:849), so a Gimmick on one's own thread distracts a Mod Bot
  visiting it, as the staff design intended for a Use on a thread.

**SQL tests:**
- a Salty-flavor ward refusing a Salty cast and passing a Sweet one;
- a name ward;
- a ward on a character refusing a character cast;
- Good Vibes refused on another character's thread and accepted on one's own;
- a use card refused on a board.

## Task 4. Reversals, take-back and the hand (SQL)

Model: sonnet

**Files:** the migration, SQL tests.

**Matches.**
- `place_set` (0144:481) refuses:
  - a set card with no trap;
  - a named catch rarer than the set card ("% names cards up to %");
  - a set card's `match` on a set card that also names a catch.
- `spring_facts` / `spring_traps` (0144:614/693) spring a cast back when either holds:
  - `fd.catches = incoming_card`;
  - the back's card has a `match`, and the incoming card's alignment is in `match.flavors` (when given) and its rarity
    is at or below `match.upTo` (when given) and at or below the set card's own rarity.

  **The reads stay even.** Every back the cast meets does the same reads in the same order before the decision, the
  incoming card's alignment and rarity included.

**Take-back.**
- A new function `take_back(who uuid, through uuid, set_act uuid)` (who = account, through = the acting character),
  under the locks `set_card` takes, in its order. It refuses, in this order:
  - a set Act that is not the caller's own back;
  - a back already sprung, taken back or past its time.

  The second refusal says only that "there is no face-down card to take back there".
- It writes:
  - an Act of a new kind `take_back` by the back's post's author, on that post, with payload `{ set }` and no card;
  - a `card_ledger` row of a new kind `returned`, with `act` the take-back Act and price 0.
- `acts_kind_check` gains `take_back`, with a payload check that `set` is the post's live back.
- `card_ledger_kind_check` and `card_ledger_check` (0142:172-175) gain `returned`, which carries an act.

**A back's end.** A back is ended by its spring, a take-back naming it, or `ends_at <= now()`. Each of these readers says
so:
- `card_target`
- `place_set`'s live check
- `spring_traps`
- `my_face_down.ended_at`, with a new `ended_by` of `sprung`, `taken back` or `time`

**The hand.** `card_held` (0142:182) counts:

> bought + pulled + caught + returned − played + the account's backs whose time passed unsprung and not taken back

The last term is read from `face_down` and is never written, as an ended back writes nothing today.
`my_card_ledger` (0142:386) shows a time-ended back as a `returned` line at its `ends_at`.

**Settlement input.** `settlement_input` (0116:22) and `estimate_input` (0092:608) send:
- `by` for a `spring` (`payload->>'by'`);
- `ends` for a use card's play (`payload->>'ends'`);
- `on` for a character-reach play (the character it is on).

**SQL tests:**
- Card Collector naming a rare refused;
- a flavor match catching a Salty cast and passing a Pepperoni one;
- take-back returning the card and ending the back;
- a second take-back refused;
- a take-back by another account refused, with the same words as a back that does not exist;
- a cast on a taken-back post springing nothing;
- `card_held` after a back's time passes;
- `settlement_input` carrying `by`, `ends` and `on`.

## Task 5. The act function, the API and the fake backend (engine, functions)

Model: sonnet

**Files:**
- `engine/rules/actions.ts` (the `ACTIONS` table, :189)
- `supabase/functions/act/core.ts` and its test
- `engine/ui/data/api.ts` (`KayfaApi`, :2169-2175)
- `engine/ui/data/fake.ts` and its tests
- `web/src/data/supabase.ts` and its test, where the API is wired

**The work:**
- A `take_back` action: the acting character and the set Act. Its RPC is `take_back`.
- `KayfaApi.takeBack(character, set)`.
- `act/core.ts:157-191` passes the target's effects with their `gimmick` into `decidePlay`, so the price it sends
  `play_card` holds Good Vibes' surcharge.
- `fake.ts` mirrors Tasks 3 and 4:
  - `card_target` and reach effects carry `gimmick` (fake.ts:1412-1436);
  - a ward by flavor or name;
  - a use card refused on another's thread;
  - take-back, and the hand's count after a back's time;
  - a match spring.

**Tests:**
- `core.test.ts`: a Salty cast on a post under a Good Vibes thread is priced 25 above its play price.
- `fake.test.tsx`: take-back, and the hand after a back ends.

## Task 6. Divided World's cards (instance)

Model: sonnet

**Files:**
- `instances/divided-world/cards/` (index.ts, the card files, cards.test.ts)
- `instances/divided-world/machine.ts`
- `instances/divided-world/ui/cards.ts`
- every file the Bluff sweep below names

**Card Collector.**
- `trap-card.ts` becomes `card-collector.ts`, key `card-collector`, name "Card Collector", still uncommon and Salty.
- `instances/divided-world/cards/trap-card/` (ConfigForm, CSS) becomes `card-collector/`.
- Its ConfigForm offers only cast-on-post cards at or below uncommon. Today it offers every one (`castable`,
  `engine/ui/cards/PlayForm.tsx:136`); the filter is the Reversal's rarity, read from its rules.
- Every `'trap-card'` key moves. The files and counts as this is written:
  - marks.test.ts 1, cards.test.ts 9, index.ts 2, ConfigForm.tsx 2 and its test 1
  - machine.ts 1, ui/cards.ts 5, ui/index.test.tsx 2
  - functions/act/core.test.ts 2, functions/chatter/core.test.ts 3
  - tests/e2e/0015-a-day-of-the-staff.ts 2
- The staff pool's `staffOptions` (index.ts:23-30) names only cards Card Collector may name.

**The other moved cards.**
- **Hall Pass:** `trap: { trigger: { on: 'visit' } }`, as today.
- **Force Field:** `gimmick: { kind: 'ward', upTo: 'uncommon' }`, `lasts` 7 days.

**New cards.** Each new card is `play: 'use'`, uncommon, with machine price 150 (the other uncommons' price):

| Card | Flavor | Reaches | Lasts | Gimmick |
|---|---|---|---|---|
| `publicity-tour` | Sweet | `['character']` | 36 hours | `earn`, quadrants `excitedPositive` and `calmPositive`, `by` 0.1 |
| `heat-magnet` | Salty | `['character']` | 36 hours | `earn`, quadrants `excitedNegative` and `boredNegative`, `by` 0.1 |
| `class-clown` | Pepperoni | `['character']` | 36 hours | `earn`, reactions `laughing` and `eye-roll`, `by` 0.5 |
| `good-vibes` | Sweet | `['thread']` | 3 days | `price`, flavors `['salty']`, `add` 25 |

`instance.settings.reachLasts` must allow 36 hours at character reach and 3 days at thread reach. Check it, and raise it
in the instance's settings if it is lower.

**Bluff is deleted:**
- `cards/bluff.ts`, its entry in `index.ts` (L11, L21), its machine slot (machine.ts:14), its `CardUi` (ui/cards.ts:26-28,
  145) and `ui/cards/bluff/`.
- Publicity Tour takes Bluff's machine slot (C1), and the other three take the next free slots. Check that the grid has
  room before adding slots.
- **Where a test, fixture or board uses a Bluff as "a back that does nothing"**, it now sets a common Move face down,
  with a Who condition naming only a retired test character so it never springs.
- **Where it tests Bluff itself**, the test goes.
- The files, from the survey of this repository as written:
  - engine/system/meeting.test.ts; engine/ui/admin/Machine.test.tsx
  - engine/ui/tips/problems.test.ts; engine/ui/vending/PackOpening{,.animations}.test.tsx
  - engine/rules/actions.ts:259 (comment); engine/rules/cards.test.ts
  - engine/system/chatter.test.ts
  - engine/ui/cards/{Backs.board.stories.tsx, PlayForm.tsx:322, backs.test.tsx, marks.css:256, marks.test.ts, marks.ts:69,
    plays.ts:24, postcard.test.tsx, setform.test.tsx}
  - engine/ui/data/api.ts:1047; engine/ui/guide/markdown.test.ts
  - engine/ui/log/{lines.ts:180,597, lines.test.tsx}
  - instances/divided-world/cards/{hall-pass.ts, cards.test.ts, trap-card/ConfigForm.test.tsx}
  - instances/divided-world/ui/index.test.tsx; supabase/functions/{act,chatter}/core.test.ts
  - web/src/data/supabase.test.tsx
  - the SQL tests 0017, 0059, 0075, 0077, 0089, 0096, 0106, 0135, 0145 and 0146
  - e2e/boards/07-vending.ts:86 and e2e/boards/2026-11-07-booster-packs/01-machine.ts:51

  Re-run `grep -rin "bluff" --include=*.ts --include=*.tsx --include=*.sql --include=*.css engine instances supabase web
  e2e` until only the general word ("never bluffs") remains. Migrations' comments are records and stay.

**Tests:**
- `cards.test.ts`: the card list (L24), the machine's slots (L38-39), the staff pool loop (L335-387) and the booster
  odds (L423-432; the uncommons are now eight) follow.
- `ui/index.test.tsx:182-184`: `cardsUi` keys equal the rules' keys.

## Task 7. The new cards' art (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/cards/{publicity-tour,heat-magnet,class-clown,good-vibes}/` (art.svg, mark.svg,
art.json each), `instances/divided-world/ui/cards.ts`, and `trap-card/` renamed to `card-collector/`.

**The work:**
- Placeholder art in the existing style, by the folder README's rules (`instances/divided-world/ui/cards/README.md`):
  - a canvas and a mark per card, in the card's color;
  - `art.json`'s credit reads "Divided World (placeholder)".
- Each `CardUi` entry gets its `describe`, `summary`, `tagline` and `logPlay`, in plain words. Examples:
  - Publicity Tour: "Used on your own character. For 36 hours, positive reactions to it earn 10% more."
  - Good Vibes: "Used on a thread your own character started. For 3 days, Salty Moves cost 0.25 more to play there."
- **The test:** `ui/index.test.tsx:109-130` (every card has art) and the still contract (`ui/still.test.tsx`).

## Task 8. The screens: frames, ghosts on one's own thread, take-back, the log (engine, instance, the glass)

Model: sonnet

**Files:**
- `engine/ui/cards/Postcard.tsx`, `postcard.css`
- `engine/ui/cards/PlayActions.tsx`, `engine/ui/thread/Post.tsx`
- `engine/ui/cards/Lens.tsx`, `marks.ts`, `PlayForm.tsx`
- `engine/ui/log/lines.ts` and their tests and stories
- `instances/divided-world/ui/index.ts` (`REASONS`, :62-92)

**The frames** (the design's section 9).
- `Postcard` adds `data-kb-play={face.play}` to the face (never to `PostcardBack`).
- `postcard.css` draws each type's frame:
  - `cast`: the solid ring today.
  - `set`: a second ring outside the first, and a folded corner at the bottom left.
  - `use`: a dashed ring.
- The lines are at least 1.5px at every size, so they hold at the hand's three sizes.
- Forced-colors keeps them (postcard.css:360-367).
- **The test:** `postcard.test.tsx` asserts the attribute per play and none on a back.
- The pictures go to the PR (the Last task).

**Ghosts.**
- `ReachAt` (PlayActions.tsx:85) gains `starter: Id | null`. `ThreadHead` (Post.tsx:263) passes
  `summary.firstCharacter`.
- `ReachGhost` (L114) hides a use card's ghost:
  - on a thread whose `starter` is not among `actingCharacters`;
  - on any board.
- `effect()` (L151) carries `gimmick` from the card's rules, so a ward or price above reaches `landingOn`. Today the
  ward is dropped there.
- `effectsOf` (`engine/ui/cards/land.ts:25`) carries `gimmick` in place of `ward`.
- **Tests** in `reach.test.tsx`: no Gimmick ghost on another's thread head, and one on one's own.

**Take-back.**
- The Lens of one's own back (Lens.tsx, the face-down view) gains a "Take back" control in the glass, with plain words:
  "Take this card back into your hand. The card back leaves the post."
- It calls `takeBack` and closes on success.
- `marks.ts:83-84`'s `wardWords(rarity, ends)` becomes `gimmickWords(effect, ends)` for the Lens status of a live
  Gimmick. Examples:
  - "Turns away cards up to uncommon until Tuesday."
  - "Salty Moves cost 0.25 more here until Friday."
  - "Earns 10% more from some reactions until Thursday."
- **Tests** in `lens.test.tsx`: the control on one's own back only, and the call.

**The play form.**
- Where a price effect raises the play, PlayForm's price row says why: "Good Vibes adds 0.25 in this thread."
- **The test** is in `forms.test.tsx`.

**The log** (lines.ts; "The fiction may lie; the log never does").
- **`setEnded`** (L757-758) becomes "nothing sprang it, and it came back to your hand".
- **A take-back line:** "You took back {card} from post N."
- **The caught and visit lines** use the Reversal's name; no line says "Gimmick".
- **`wardEnded`** (L620-628) becomes a Gimmick-ended line for every Gimmick.
- **Settlement rows read `card.boost`** through the instance's `REASONS`: "{card} added {amount}". `REASON_KEYS`
  gains it.
- **Tests** in `lines.test.tsx` cover each line.

## Task 9. The words: the kind tag, the engine's strings, the Strategy Guide (engine, instance)

Model: inline

**Files:**
- `instances/divided-world/ui/index.ts:154`
- `engine/rules/instance.ts`, the migration's `staff_set_card`
- the comments named below
- `instances/divided-world/guide/strategy-guide.md`, `instances/divided-world/ui/index.test.tsx:96-101`
- `engine/ui/tips/problems.test.ts:198`
- the e2e boards' labels

**The work:**
- `cardKinds` is `{ cast: 'Move', set: 'Reversal', use: 'Gimmick' }`.
- `staff_set_card`'s refusal (0142:358) says "% is not a set card; a persona sets set cards".
- The comments listed by the survey move to the engine's words:
  - cards.ts L92, 132-137, 249-250, 294, 340, 425
  - land.ts L87
  - PlayForm.tsx L70, 130, 157, 184
  - faces.ts L44, 57
  - PlayActions.tsx L106
  - lines.ts L180
  - api.ts L2173
  - fake.ts L1403, 1492, 1516, 3642
  - cards/types.ts L187
- The e2e boards' accessible names follow: "common Move", "uncommon Reversal", "uncommon Gimmick".
- **The Strategy Guide's "Move, Gimmick, Ward" bullet** (L101) is rewritten from the design's sections 1, 2, 4, 5 and 6,
  in the instance's developer voice: three types, flavor as face or heel, a back might be any Move or Reversal, and a
  face-down card comes back. L112's "A Gimmick takes no conditions" becomes "A Reversal takes no conditions". The
  owner approves the Guide's words in review.

## Task 10. The export round-trips the new rows (SQL, e2e)

Model: haiku

**File:** `supabase/tests/e2e/0003-export.ts`.

Its fixture (L85-160) gains:
- a test card kind with a `gimmick` (ward by flavor);
- a set card with a `match`;
- a `take_back` Act and its `returned` ledger row;
- a back whose time passed unsprung.

The round trip compares them like every other row.

## Last. The full build, the pictures and the final review

- `npm run typecheck` and `npm run build:ci` are green.
- Screenshots go to the PR: the three frames at every card size, a Gimmick's ghost on one's own thread head, the
  take-back control, the play form's surcharge line, and the four new cards' faces.
- The final reviewer reads the Review focus below.

## Ways out of the states this touches

- A face-down card springs once, is taken back, or ends at `setLasts`. The last two return it to the hand.
- A Gimmick ends at its `lasts` (capped by `reachLasts` beyond a post), or by an admin's end.
- A cast a ward turns away is refused before it is written; the caster keeps the card and the money.
- A caught cast is a finished Act, as today.

## The masks

- A ward's refusal and a Reversal's match read only what is printed on the incoming card. The refusal is the same for
  every caster.
- The own-thread check reads the thread's first character, which is public, against the caller's own characters.
- `take_back`'s refusals for another's back and for no back are the same words, and its reads do not depend on what the
  card is.
- A time-ended back writes nothing. Its return is read only by the setter's own `card_held` and `my_card_ledger`.
- Spring scoring and Earn read who owns what only inside settlement, which shows each window's sums.

## Review focus

- **Even work across every back.** With matches by flavor and rarity, every back a cast meets still does the same reads
  in the same order before deciding: a named catch that misses, a match that misses, a Move back, and a back that
  springs (Task 4).
- **The hand's count.** `card_held` never counts a back twice:
  - one taken back after its time passed;
  - one that springs in the same second its time ends;
  - an account with many ended backs, read at a busy instance's scale (it is read on every play).
- **Spring scoring on old rows.** A spring with no `by` scores as before. A spring on one's own other mask's cast scores
  for no class. A visit spring's staff target never lands on a character.
- **Earn's edges.** It is never applied to a negative earning or to an earning with no time. It is only applied inside
  the Gimmick's window, for that character's or post's own Acts. It never stacks into a loss.
- **The own-thread check** reads the thread's first post. Check it against a thread whose first post was later edited,
  spun or moved, and against a staff-started thread.
- **The ward at every reach** in `place_cast` agrees with `decidePlay` on the same fixtures. A ward on a thread never
  refuses a post under it.
- **The Bluff sweep** leaves no test asserting a back that can never spring, and no live string naming Bluff.
