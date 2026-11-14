Record, written 2026-11-14.

# One card to a folder, and the machine by rule: plan

Carries out `docs/plans/2026-11-14-base-set-design.md`, section 4 (cited as §4.N). One build session builds it in one PR
from `main`. Where a number here differs from the design, the design wins.

**Start only after THIS has merged** (`docs/plans/2026-11-13-this-plan.md`), which itself follows Hype-Up
(`docs/plans/2026-11-13-hype-up-on-a-post-plan.md`). Both edit the files this plan moves (design, §1). If either is
not on `main` when this build starts, stop and tell the owner.

Every task goes test first: the failing test, its red run shown, then the code. A task that only moves code (Tasks 1,
3) has no behavior to drive red; instead it records the suite's test count before and after the move, and the two must
be equal. During a task run only the tests for the changed code (`node --experimental-strip-types
--no-warnings=ExperimentalWarning --test <file>` for a `.test.ts`, `npx vitest run <file>` for a `.test.tsx`). Run
`npm run build` once after the last task.

**Layers.** Every task is Divided World's (`instances/divided-world/`), except the sweep in Task 2, which may touch the
e2e board fixtures, `web/src/data/fixtures/` and `tools/rehearse/` where they read the machine. No engine file changes,
no migration is added, and nothing touches a database. No check (`tools/check-*.mjs`) is added, so no poison pair is
needed; Task 2's price table gets a poisoned red run of its own.

**The masks, ways out, a busy instance.** Nothing here adds a response, payload, event, timing or state (§4.4).

The order: 1, 2, 3, 4, 5.

## Task 1. Each card's rules tests in their own file (§4.1)

Model: sonnet.

Files: `instances/divided-world/cards/cards.test.ts`; new `instances/divided-world/cards/test-kit.ts`; new
`instances/divided-world/cards/<key>.test.ts` for each card that has tests of its own; the existing
`instances/divided-world/cards/laugh-track.test.ts` and `instances/divided-world/cards/you-were-saying.test.ts`.

- Before moving anything, record the suite's count: `npm run test:engine 2>&1 | grep -E '^# (tests|pass|fail)'`.
- `test-kit.ts` takes the helpers more than one card's tests use: `priceOf`, `post`, and any other `const` or
  function at the top of `cards.test.ts` that two or more of the moved tests read. It exports them. It holds no test.
- **A test moves to `<key>.test.ts` when it is about one card**: its name or comment names that card, and it imports or
  reads that card's rules and no other card's. A card that already has a test file (Laugh Track, You Were Saying?)
  gets its moved tests appended to that file.
- **A test stays in `cards.test.ts` when it is about the pool**: it reads `cards`, `instance`, `instanceProblems`, or
  two or more cards (the ordered key, flavor and price list at its top; the staff options; Card Collector's and 4D
  Chess's enums; the ward and price Gimmicks tested against several casts). `cards.test.ts`'s header comment says it
  holds the tests about the whole pool and that a card's own tests are in `<key>.test.ts`.
- A test is moved whole and unchanged except its imports. No assertion is edited, merged or dropped.
- After the move, record the count again. The two counts and both `pass` lines go in the PR. They must be equal, and
  `fail` must be 0.

## Task 2. A card's price in its file, and the machine by rule (§4.3)

Model: sonnet.

Files: every `instances/divided-world/cards/<key>.ts` that is a card (not `publicity.ts`, `wiping.ts` or a helper);
`instances/divided-world/cards/index.ts`; `instances/divided-world/machine.ts`; new
`instances/divided-world/machine.test.ts`; `instances/divided-world/cards/cards.test.ts` (its first test's price
column); and the sweep's files below.

**Tests first**, in `machine.test.ts` (node's `test` and `assert/strict`, as `cards/cards.test.ts`), importing
`machine` from `./machine.ts`, `cards` from `./cards/index.ts`, and `RARITIES` and `playOf` from
`../../engine/rules/cards.ts`:

1. The first slot is `{ item: { pack: 'booster' }, availability: 'onSale', price: 300 }`.
2. The slots after it that are on sale are exactly the common cards, in this order: `cast` cards, then `set`, then
   `use` (`playOf`), each group ordered by `name` with `localeCompare(b.name, 'en')`.
3. The rest are every uncommon, rare and legendary card, each `availability: 'hidden'`, ordered by `RARITIES.indexOf`,
   then by name as in 2.
4. Every card in `cards` has exactly one slot, and every card slot names a card in `cards`.
5. **Every card's price is today's.** A literal table of `[key, price]` for every card, written from `machine.ts` as it
   stands on the branch's base, before any change (THIS's and the reworked Hype-Up's prices included, as their plans
   left them). Each card's slot has that price.

Red runs: tests 2 and 3 fail on today's `machine.ts` on their assertions (today the uncommons are on sale, in hand
order). Test 5 passes before the change. Give it a red run anyway: after the change, edit one card file's `price`
(Whoops! to 101), run test 5, record the red run in the PR, and put the price back.

**Then the code:**

- Each card file gains `export const price: Hundredths = <today's price>;` beside its rules, with `Hundredths`
  imported from `engine/rules/types.ts`, and a one-line comment that this is what the Vending Machine sells it for.
- `cards/index.ts` imports each card's `price` under the card's name (`import { whoops, price as whoopsPrice } from
  './whoops.ts';`) and exports, beside `cards`, `export const prices: ReadonlyMap<string, Hundredths>`, built from the
  same list so the two cannot disagree ("Two lists that must agree are one list"): the list `listed` becomes pairs
  `[rules, price]`, `cards` maps the first of each, and `prices` maps key to the second. Card Collector's and 4D
  Chess's wrapped rules (`staffOptions`) replace their base in `cards` as today; their prices come from the base card's
  file. The list's order is untouched in this task (Task 5 sorts it).
- `machine.ts` computes `machine` from `cards` and `prices`: the Booster slot first (its price, 300, stays a literal
  in `machine.ts`), then the rule of tests 2 and 3. It stays `deepFreeze`d. Its header comment is rewritten to say the
  rule and why (the owner's words in the design, §0.4 and §0.5), and drops the slot-by-slot history.
- `cards.test.ts`'s first test (keys, flavors and prices in order) keeps its keys and flavors; its prices now come
  through `priceOf`, which reads the machine and so is unchanged.

**The sweep.** Uncommon cards that were on sale are now hidden, so anything that buys one from the seeded machine, or
draws the grid, changes:

- `grep -rn "onSale\|instance.machine\|machine" e2e/ web/src/data/fixtures/ tools/rehearse/ supabase/tests/
  instances/divided-world/ui/ --include=*.ts --include=*.tsx --include=*.sql`, and for each card key that was on sale
  and is now hidden (the design's §4.3 list), `grep -rn "'<key>'"` in the same places, read for a purchase or a grid.
- A fixture or test that buys a now-hidden card from the machine buys a common instead where the card did not matter,
  or sets that slot `onSale` in its own setup where it did (as an admin can). It never changes the rule.
- A board story or snapshot of the Vending Machine is redrawn from the new seed (`e2e/boards/07-vending.ts` and what
  reads it); say in the PR which images changed and that the grid is now the Booster and the commons.
- List every file the sweep touched in the PR, each with one line on why.

## Task 3. Each card's screen entry in its own module (§4.1)

Model: sonnet.

Files: `instances/divided-world/ui/cards.ts`; new `instances/divided-world/ui/cards/words.ts`; new
`instances/divided-world/ui/cards/<key>/ui.ts` for every card; `instances/divided-world/ui/index.test.tsx` (its import
of `spanWords`).

- Before moving anything, record the screen suite's count: `npx vitest run instances/ 2>&1 | grep -E 'Tests'`.
- `words.ts` takes every helper in `ui/cards.ts` that more than one entry reads (`setMoveWords`, `spanWords`, `weighted`,
  `earnWords`, `priceAdd`, `skimShare`, `tollShare`, `rideShare`, `quadrantOf`, `quadrantNames`, `classWords`,
  `setLastsWords`, `orbs`, `listWords`, and any other the build finds read by two entries) and exports them. A helper
  read by one entry alone moves into that card's `ui.ts` (`giftAmounts` and `giftOverhead` go to Jimmy Wails's).
- Each card's `ui.ts` exports `export const ui: CardUi` (the entry as it stands in `cardsUi`, unchanged), imports its
  art from its own folder (`./art.webp?url`, `./mark.svg?url`, `./art.json`), and holds its own `lazy(...)` Effect,
  ConfigForm and Compose declarations, so each stays its own chunk as today. Its imports of the card's rules point at
  `../../../cards/<key>.ts`.
- `ui/cards.ts` keeps its header comment (reworded to say an entry lives in `ui/cards/<key>/ui.ts`), imports each
  card's `ui` under the card's name (`import { ui as whoopsUi } from './cards/whoops/ui.ts';`), and builds `cardsUi`
  from them. It re-exports `spanWords` from `./cards/words.ts`, or `ui/index.test.tsx` imports it from there; pick one
  and say which. The list's order is untouched in this task (Task 5 sorts it).
- An entry's text, functions and fields are moved unchanged: no copy is edited.
- `tools/check-card-art.mjs` must still pass (`node tools/check-card-art.mjs`); it reads only a folder's art files.
- After the move, record the count again, with `npm run typecheck`. The counts must be equal and the run green; both go
  in the PR.

## Task 4. Each card's screen tests in its own file, and the face-down table as a rule (§4.1, §4.2)

Model: sonnet.

Files: `instances/divided-world/ui/index.test.tsx`; new `instances/divided-world/ui/cards/<key>/ui.test.tsx` for each
card that has screen tests of its own.

- **The face-down landing table** (`index.test.tsx`, the `lands` object near line 121) becomes a rule. For every card
  in `cards` with `playOf(c) === 'cast'` that can be set face down (the engine's `faceUpOnly` is false for it), its
  `describe` holds the set-face-down sentence ending "lands on <X> at no further cost, using up the card.", where X is
  `the quoting post` when it reaches a post, `the quoting post's character` when it reaches a character, and `the
  quoting post's thread` when it reaches a thread (`reachesOf`).
  - **First**, with the table still there, add an assertion that the rule's map, restricted to the table's keys,
    deep-equals the table. Run it green and record it in the PR, then delete the table and that assertion.
  - If the rule finds a settable cast card whose `describe` lacks the sentence, that is a gap the table hid. Do not
    edit the card's copy. File an issue naming the card and quoting its `describe`, and list the card in a
    `const notYet = new Set([...])` beside the rule with the issue's number in a comment, so the rule skips it until the
    issue is fixed.
  - Red run: before writing the rule's code path, break one card's reach in a scratch copy (Whoops!'s `reaches` to
    `['character']`), run the rule, record the red run, and revert.
- **A test about one card's screen entry moves to that card's `ui.test.tsx`**, by the same test as Task 1 (it names
  and reads that card alone). Tests about the whole instance's screens stay in `index.test.tsx`. Moved tests are moved
  whole and unchanged except their imports.
- Record the screen suite's count before and after, as in Task 3; the after count is the before count minus the table's
  one test plus the rule's one test.

## Task 5. The two lists, one card per line, sorted (§4.2)

Model: inline.

Files: `instances/divided-world/cards/index.ts`; `instances/divided-world/ui/cards.ts`;
`instances/divided-world/cards/cards.test.ts`; `instances/divided-world/ui/index.test.tsx`.

**Tests first:**

- In `cards.test.ts`: the keys of `cards` are sorted by plain string comparison (`[...keys].sort()` equals `keys`).
- In `index.test.tsx`: the keys of `cardsUi` are sorted the same way, and they are exactly the keys of `cards` (one
  screen entry per card, none spare).
- The pool test at the top of `cards.test.ts` (keys, flavors and prices in order) lists them in sorted order.

Red run: the sort tests fail on today's hand order, on their assertions.

**Then the code:**

- `cards/index.ts`: one import line per card and one list line per card, each sorted by key, one card per line, with no
  other code between the lines of either run. Card Collector's and 4D Chess's wrappers stay below the list, as now.
  The header comment is rewritten to say what the file is and how a card is added: its rules and `price` in
  `cards/<key>.ts`, its tests in `cards/<key>.test.ts`, its screen entry in `ui/cards/<key>/ui.ts`, and one line in
  each of this file's two runs and `ui/cards.ts`'s two runs, at its place in key order. It names the design
  (`docs/plans/2026-11-14-base-set-design.md`) for why. It drops the per-card history.
- `ui/cards.ts`: the same, one import line per card and one list line per card, sorted by key.
- Keys sort by plain string comparison, so `4d-chess` comes first. Keep it that way; the design's slot table
  (§2) uses the same order.

## Review focus

- **A test lost in a move.** Tasks 1, 3 and 4 move hundreds of lines of tests; read the before and after counts in the
  PR, and spot-check that no moved file is outside the runners' globs (`instances/**/*.test.ts` for `test:engine`,
  Vitest's include for `.test.tsx`).
- **A machine on an instance that already holds slots.** `seed_instance` never touches a slot the database already
  holds, so a deployed instance would keep its uncommons on sale. No instance is deployed; say so in the PR rather than
  reaching for a migration.
- **Code splitting.** Moving each `lazy(...)` into a card's `ui.ts` must keep every Effect, form and Compose in its own
  chunk; compare the build's chunk list before and after.
- **Import cycles.** `machine.ts` now imports `cards/index.ts`, and per-card `ui.ts` files import rules. Check nothing
  imports back into `ui/cards.ts` or `machine.ts` in a cycle.
- **Two lists that must agree.** The one-entry-per-card test (Task 5) and the slot test (Task 2, test 4) are what hold
  rules, screen and machine to one set of cards; make sure each is red when a card is missing from one side.
