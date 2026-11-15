# Before Wave 1: the boards' fixed machine, one list of prices, and a trap that matches said truly: plan

Record, written 2026-11-15. Carries out section 1 of `docs/plans/2026-11-15-wave-1-cards-design.md`. One PR from
`main`.

**May start** after the stories-by-key build (PR #707, plan `docs/plans/2026-11-15-stories-by-key-plan.md`) merges:
both edit `engine/ui/story.tsx` and `engine/ui/vending/Packs.board.stories.tsx`. The three card plans of Wave 1 wait
for this one.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the
rules' tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched. This plan adds no migration, no card and no SQL.

**The layers.** Task 1 is the composition root's fixtures (`web/`, `.storybook/`) and one optional story parameter in
the engine (`engine/ui/story.tsx`), which names no instance. Task 2 is Divided World's tests. Task 3 is engine and
names no instance, card or flavor; the engine boundary check (`tools/check-engine-boundary.mjs`) holds throughout.

**No state is added**, and nothing here adds a response, payload, event or timing: Task 3 changes sentences that are
computed from a card's public rules.

## Task 1. The boards draw a fixed machine

Model: sonnet

**Files:** `web/src/data/fixtures/boards.ts` (`createBoardsFake`, and two new exports), `web/src/data/fixtures/boards.test.ts`,
`engine/ui/story.tsx` (`WorldParameters`), `.storybook/preview.tsx` (`withWorld`, the `createFake` call),
`engine/ui/vending/Packs.board.stories.tsx` (its `meta.parameters`), `engine/ui/admin/Machine.board.stories.tsx` (its
`meta.parameters`).

Today the fake builds its slots once from `instance.machine` (`engine/ui/data/fake.ts`, `slotRecs`), and the instance
computes that from the pool (`instances/divided-world/machine.ts`). So five board manifests move whenever a card is
added: `e2e/boards/07-vending.ts`, `e2e/boards/2026-11-05-backfill/33-settings-account.ts` (its phone side) and
`34-vending-info.ts`, `e2e/boards/2026-11-07-booster-packs/01-machine.ts` and `05-admin.ts`.

- In `boards.ts`, export `BOARD_SLOTS: readonly string[]`: the card keys of today's machine, in the machine's order,
  one key per line. Get them by printing `instance.machine` once (the Booster's slot is not in the list; it is always
  first). At `c6ca737e` that is the nine commons in name order (`autocorrect`, `below-the-fold`, `feelin-fab`,
  `hype-up`, `overreaction`, `stick-around`, `this`, `whoops`, `you-were-saying`) and then the 27 hidden cards by
  rarity and name; write what main holds when the task runs. The comment above it says: this is the machine the
  boards were drawn against; a card added to the instance later is not on it, on purpose, so no board moves
  (`docs/plans/2026-11-15-wave-1-cards-design.md`, section 1); the real machine's rule is held by
  `instances/divided-world/machine.test.ts`.
- Export `boardMachine(machine: Instance['machine']): Instance['machine']`: the pack slots of `machine` in their
  order, then, for each key of `BOARD_SLOTS`, that card's slot from `machine` as the instance has it (its
  availability and price). A key with no slot throws `Error('the boards\' machine names "<key>", and the instance
  sells no such card')`.
- `createBoardsFake` passes `instance: { ...instance, machine: boardMachine(instance.machine) }` to `createFake`.
- `WorldParameters` gains `readonly boardsMachine?: true`, documented: "The fake's machine is the composition root's
  fixed one for the boards, not the instance's computed one, so a story a board is matched against does not move when
  the instance gains a card. The engine names the flag and never the list."
- `withWorld` in `.storybook/preview.tsx`: where the story has a `world` and `boardsMachine`, the fake is made with
  `createFake({ instance: { ...instance, machine: boardMachine(instance.machine) }, settings: fallbackSettings })`.
  The `KayfaProvider` keeps the real `instance`: the machine's page and the admin's read their slots from the api.
- Set `boardsMachine: true` in the `meta.parameters` of the two stories named above.

Tests, red first, in `boards.test.ts`:

- `boardMachine(instance.machine)` holds the Booster first and then exactly `BOARD_SLOTS`, in order;
- given a machine with one more on-sale card slot inserted among the commons and one more hidden slot appended
  (build them from an existing slot with another key), `boardMachine` returns the same keys as before: the poison
  for "a new card moves a board";
- a `BOARD_SLOTS` key the machine lacks throws, naming the key (call the function with a machine that has had one
  slot removed);
- the fake of `createBoardsFake('07-vending')` answers `machine()` with the Booster and the nine commons in
  `BOARD_SLOTS`' order.

Then run the boards themselves, unchanged: `node tools/test-e2e.mjs` narrowed to `e2e/boards.spec.ts` (read the
tool's header for how to pass a file and a grep), for 07-vending, 33-settings-account, 34-vending-info and the four
booster-packs boards (01-machine, 02-reveal, 03-hit, 05-admin). **No manifest under `e2e/boards/` is edited by this
task**: the fixed list is today's machine, so each must pass as it stands. If one fails, the list or the wiring is
wrong; stop and find out which.

## Task 2. One list of prices, a card to a line

Model: haiku

**Files:** `instances/divided-world/cards/cards.test.ts` (the test `'the instance sells its cards at their prices'`
near line 28, and the test `'the Booster's hit pull gives uncommon 74, rare 24 and legendary 2, …'` near line 352),
`instances/divided-world/machine.test.ts` (`PRICES` and the test `"every card's slot has the price the machine always
sold it at"`).

Exact changes:

1. In `'the instance sells its cards at their prices'`, the expected array is written one card per line, in the order
   it has now (key order), with a trailing comma on every line and nothing between the lines, as the lists in
   `cards/index.ts` are:

   ```ts
   assert.deepEqual(cards.map((c) => [c.key, c.alignment, priceOf(c.key)]), [
     ['4d-chess', 'salty', 150],
     ['autocorrect', 'pepperoni', 100],
     // … every entry of today's line, unchanged, one per line …
     ['you-were-saying', 'pepperoni', 100],
   ]);
   ```

   Above it, one comment: "One card per line, sorted by key, as `cards/index.ts`: a new card's line goes to its place
   in key order."
2. In the Booster's hit-pull test, delete the line `assert.equal(cards.length, 36);`. Nothing else in that test
   changes; its last line already holds that the odds cover every uncommon, rare and legendary.
3. In `machine.test.ts`, delete `PRICES`, its comment and the test `"every card's slot has the price the machine
   always sold it at"`. The list in `cards.test.ts` holds every card's price through the machine's slot (`priceOf`),
   so the two were one list written twice.

No red run: this task removes and reformats tests. Run both files and show them green; show
`git diff --stat` touching only these two files.

## Task 3. A trap that matches is said from its match (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts` (a new `matchWords`, beside `wardWords`), `engine/rules/cards.test.ts`;
`engine/ui/cards/land.ts` (`springWords` and its comment), `engine/ui/cards/setform.test.tsx`;
`engine/ui/log/lines.ts` (`setWaits` and its comment) and the log's test file that covers `setWaits` (find it with
a search for `'for the card it names'`); `engine/ui/alerts/words.ts` (the `trapSprang` words for `did === 'caught'`,
and the `trapStruck` fallback's `named`) and its test file.

A cast trap either names its card (`CardRules.catches`) or has a `match` (`Match`: `flavors`, `upTo`). Four
sentences say "names" for both.

- `matchWords(match: Match, own: Rarity): string` in `engine/rules/cards.ts`: what a match takes, as a noun phrase.
  The rarity said is the lower of `match.upTo` and `own` (a back never takes a card rarer than itself:
  `spring_facts`, `0357_post_veils.sql`, "6b"), and it is left out when that is the rarest of `RARITIES`.
  - flavors and a rarity: `a Salty card, up to common`
  - two flavors: `a Salty or Pepperoni card, up to uncommon` (three: `a Sweet, Salty or Pepperoni card`)
  - no flavors: `a card up to common`; no flavors and the rarest rarity: `a card`
  The flavor is the alignment's own word capitalized, as `wardWords` does it (`capital`); the engine holds no list of
  flavor names beyond `ALIGNMENTS`.
- `springWords` (`land.ts`): for a set card that springs on a cast and has a `match`, `` `Waits for ${matchWords(…)}
  to be cast on this post, and takes it.` ``; a trap that names its card keeps today's sentence. `springWords`' `Pick`
  gains `rarity`; fix its callers' types.
- `setWaits` (`lines.ts`): on a cast, where the event has no `catches` and the card's rules have a `trap.match`,
  `` `for ${matchWords(…)}` ``. A row with a `catches` and a card with neither keep today's words.
- `alerts/words.ts`, the `trapSprang` alert, `did === 'caught'`: "A cast it was waiting for set it off, and the card
  is now in your hand." (true of a named card and a matched one). `did === 'rode'` keeps "the card it named": a ride
  always names.
- `alerts/words.ts`, the `trapStruck` fallback: `named` becomes `` `it was waiting for ${laid ?? 'your card'}` ``,
  so the detail reads "… set it face down 2 days before you cast it, and it was waiting for Whoops!."

Tests, red first:

- `cards.test.ts`: `matchWords` for each shape above, and that a match up to rare on a common card says "up to
  common".
- `setform.test.tsx`: a test set card with `match: { flavors: ['salty'], upTo: 'common' }` shows "Waits for a Salty
  card, up to common, to be cast on this post, and takes it." in `[data-kb-sets]`; the existing `Snare` test (a named
  card) passes unchanged.
- the log's test: a set row of a match card reads "It waits for a Salty card, up to common, and ends by itself if
  none comes."; a row with `catches` reads as before.
- the alerts' test: the two new sentences; the `rode` sentence unchanged.

Search the repository for each old sentence (`'for the card it names'`, `'the card it named set it off, and the
card'`, `'exactly'`) and update every test that pinned it, the instance's included
(`instances/divided-world/ui/index.test.tsx`, `engine/ui/tips/`). A sentence that is still true is left alone.

## Task 4. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. The PR's description says which boards were run in Task 1
and that no manifest changed.

## Review focus

- **The boards' machine is frozen, the real one is not.** The boards no longer show whether a new common fits the
  machine's grid (two columns, "N slots empty"): confirm `machine.test.ts` and `engine/ui/vending/Vending.test.tsx`
  still hold the rule and the grid, and that nothing else was relying on a board to catch a machine regression.
- **A card absent from the fake's machine.** With `boardsMachine`, the context's `instance.cards` holds cards the
  fake sells no slot for. Check the machine page's "isn't sold on its own" line and the pack's odds on the booster
  boards with a card added to the pool locally (do not commit it): the boards' compared boxes must not move.
- **The story parameter is opt-in.** Every story without `boardsMachine` keeps the computed machine; confirm no
  other board manifest is matched against a machine story.
- **Words a later card inherits.** `matchWords` is said for any match the engine accepts (`matchProblems`,
  `engine/rules/instance.ts`): read each shape aloud for a card that matches Pepperoni alone, and one with no flavor.
- **Old Acts.** No stored row changes; a set row written before this build is said with the new words only where its
  card has a match, and no such card exists yet.
