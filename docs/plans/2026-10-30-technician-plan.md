# The Technician, a class for the calm quadrant: plan

Record, written 2026-10-30. The plan for `docs/plans/2026-10-30-technician-design.md` (issue #28). It is one build
session and one PR, carried out task by task, tests first, each red run recorded
(`.claude/skills/build-session/SKILL.md`).

**It starts once glass Part 2 (PR #49) is merged.** Tasks 3 to 5 edit what that PR builds: `ClassCards.tsx` and its
marks, `TurnDialog.tsx`, `InstanceUi.quadrantClasses`, `glass.json`'s classes and `e2e/boards/06-turn.ts`. Adding the
class (Task 2) puts a fifth card in that PR's four-column grid and its four-card board, so the class and the carousel
land together. A build session that finds #49 still open stops and says so; it does not build on #49's branch.

## The layers

- **Engine:** `ReceivedReaction.actAt` (`engine/rules/`), and the carousel in `engine/ui/characters/`. Neither names the
  Technician. The carousel reads the classes from `instance.classes` and the card width from the theme, never a count.
- **Instance:** the class, its settings, its look, marks, glass colors, words and the order
  (`instances/divided-world/`). They reach the engine through the interfaces that already carry the other four:
  `Instance.classes` and `Settings.economy`, and `InstanceUi.classLooks`, `quadrantClasses`, `reasonWords` and
  `glass.classes`. No interface is added.
- **Database:** nothing. `seed_instance` (`supabase/migrations/0004_schedule.sql`) adds a class kind from the
  instance's payload and merges the economy number by number, so the next seed writes `technician` and its two
  numbers. No migration.

## Tasks

### Task 1. The reacted Act's time, for a class

- `engine/rules/types.ts`: `ReceivedReaction` gains `readonly actAt: number`, the time the reacted Act was posted, with
  a doc comment: public, as every post shows its time.
- `engine/rules/settle.ts`: the `received` builder (the loop over `windowVotes` that pushes
  `{ act, actKind, quadrant, at, votes }`) adds `actAt: target.at`. `target` is already `actOf(v.act)`, so this adds no
  read.
- Every literal `ReceivedReaction` gains the field: `got` in `instances/divided-world/classes/classes.test.ts` (an
  `actAt` parameter defaulting to 0), and any other a type check finds.
- **Tests first,** in `engine/rules/settle.test.ts`, red against main:
  - A reaction in the window, on a post made two windows before it, reaches the post's author's class input with
    `actAt` equal to the post's time, not the window's start and not the reaction's time. **Poison:** `actAt: v.at`,
    which this test must fail.
  - A reaction on a card carries the card's own time.

### Task 2. The Technician's rules, its settings and the order

- New `instances/divided-world/classes/technician.ts`, in the shape of `heel.ts` and `lurker.ts`:
  - `key: 'technician'`, `name: 'Technician'`, and a header comment saying what it plays and citing the design.
  - A `READS` list that is also its `reads`: `'technician.evergreen'` and
    `{ key: 'technician.evergreenDays', whole: true, min: 1 }`.
  - `earn` returns:
    - `perVote(input, settings, 'calmPositive', 1, 'technician.respected')`;
    - one `technician.evergreen` earning for each received reaction with `actKind === 'post'`,
      `quadrant === 'calmPositive'` and `at - actAt >= evergreenDays * 86_400_000`. Its amount is
      `evergreen * r.votes`, so a negative share (a vote withdrawn) takes the bonus back. It names `act`, `quadrant`
      and `at: r.at`, so the live estimate shows it whole at the reaction;
    - `perVote(input, settings, 'excitedNegative', -1, 'technician.draggedIn')`.
- `instances/divided-world/classes/index.ts`: `[face, heel, jabroni, technician, lurker]`, and the header says the
  order is the order every screen draws.
- `instances/divided-world/classes/shared.ts`: its header's "the four classes" becomes "the classes".
- `instances/divided-world/settings.ts`: `economy` gains `'technician.evergreen': 5` and `'technician.evergreenDays': 3`,
  each with a comment in the style of the Lurker's.
- **Tests first,** in `instances/divided-world/classes/classes.test.ts`, red against main (the module missing is the
  first red):
  - **Order:** "the instance holds its classes and is whole" asserts
    `['face', 'heel', 'jabroni', 'technician', 'lurker']`, and `instanceProblems` finds nothing.
  - **Each line:**
    - Respected on posts and on cards.
    - Dragged in on posts and on cards.
    - The Technician is unmoved by hype and the groan.
  - **Evergreen:**
    - It pays on a post reacted to 3 days old to the millisecond, and not one millisecond before.
    - It never pays on a card, however old.
    - A negative share on an old post takes the bonus back.
    - A negative share on a young post takes nothing.
    - An override of `technician.evergreenDays` to 1 pays a 2-day-old post's reaction; one of `technician.evergreen`
      changes the amount.
  - **The settings:** an instance missing `technician.evergreenDays` is refused by `instanceProblems`, and so is one
    holding it at 0 or 2.5.
  - **Through the whole settlement** (`settle`): a calm vote on the Technician's 4-day-old post pays 15 hundredths
    under its two reasons. A Heel's post drawing the same vote is charged, so the foil holds both ways.
  - **Through the estimate** (`estimateForOwner`): the evergreen line is whole at the reaction's time.
  - **The existing tests:** "each class names what it paid in its own words" lists the three new reasons.
- Every test, story and e2e fixture that lists the classes or reads `instance.classes[n]` keeps passing under the new
  order. `classes[1]` is still the Heel; `supabase/tests/e2e/0002-actions.ts` and `0005-estimate.ts` are read for any
  index past it.

### Task 3. The Technician's look, the Lurker's violet and the words

- `instances/divided-world/ui/glass.json` `classes`:
  - `technician`: fill `#2ef0a0`, ink `#03141a`, large `#7dffc8`;
  - `lurker`: fill `#b97aff`, ink `#12051f`, large `#d4b0ff`.

  Then `node tools/check-glass-contrast.mjs --write` regenerates `e2e/glass-ceilings.json`, and its plain run passes.
  The guard is unchanged, so its poisons stand. Its class large-text poison is re-run against the Lurker's violet
  darkened to `#8a4dff`, which must fail on the turn recipe, to show the guard reads the new color.
- `instances/divided-world/ui/index.ts`:
  - **`quadrantClasses.calmPositive`** becomes `'technician'`.
  - **`classLooks.technician`:** a house-style green (`#1e8449`) with a grid pattern
    (`repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px), repeating-linear-gradient(90deg,
    transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)`), the design's section 2 description, and marks
    `{ label: 'Earns from the calm, hurt by heat', earns: ['calmPositive'], hurts: ['excitedNegative'] }`.
  - **`REASONS`** gains the three sentences of the design's section 2.
  - **The order:** `classLooks` is written in the classes' order.
- `engine/ui/glass/apply.ts`: `classLargeText`'s comment on the turn surface says "the classes' names", not "four
  classes".
- **Tests first,** in `instances/divided-world/ui/index.test.tsx`. Glass Part 2's tests already hold every class to a
  look and a glass color, and every quadrant to a different class. They go red from Task 2 alone, and that run is this
  task's red. Three tests are added, unless main already holds the first:
  - Every class has marks, and their label is not empty.
  - Calm wears the Technician, and the Lurker wears no quadrant.
  - Every reason the Technician returns (`technician.respected`, `.evergreen`, `.draggedIn`) has words of its own and
    not the fallback.
  - **Poison:** `quadrantClasses.calmPositive: 'lurker'`, which the first test must fail.

### Task 4. The class cards as a carousel

The design's section 3. `engine/ui/characters/ClassCards.tsx` and `characters.css`, used by `TurnDialog.tsx` and
`NewCharacter.tsx` as they are; neither changes beyond what the props below need.

- **The row.** `.kb-class-grid`'s `repeat(4, …)` becomes one row of cards at `--kb-class-card-width`, scrolling on the
  inline axis with `scroll-snap-type: x mandatory`, each card `scroll-snap-align: start`. The theme gives the width
  (216px on the Turn's desktop layout; on the phone layout, the row's width less a 64px peek). A fade mask is drawn at
  the trailing edge while more cards lie past it, and at the leading edge while cards lie before it.
- **The count and the arrows.** They sit on the legend's line, right-aligned: `1–4 of 5` and two buttons, "Earlier
  classes" and "More classes", each disabled at its end. Each arrow scrolls by one card's width and gap. All three are
  drawn only while the row overflows. The range is a pure function, `shownRange(scrollLeft, viewport, card, gap,
  count): { first, last }` in a new `engine/ui/characters/carousel.ts`, so it is tested without layout. The component
  reads the four inputs from the row on scroll and on resize (`ResizeObserver`).
- **Following the choice.** When the chosen radio changes, or gains focus, the row scrolls it whole into view
  (`scrollIntoView({ block: 'nearest', inline: 'nearest' })`), smooth unless `prefers-reduced-motion: reduce` or the
  glass's own motion setting says reduced, then `auto`. On mount, it scrolls to the chosen class, if any, without
  motion.
- **Nothing is hidden.** A card out of view keeps its radio in the tab order's one group and the accessibility tree:
  no `hidden`, `inert`, `aria-hidden` or `visibility` on it.
- **A long name.** `.kb-class-name` is set at the card's 40px and steps down to fit the card's width less the radio's
  corner (a container query on the card, `cqi`, clamped to 28px at the least). The 06 board's "TECHNICIAN" at 34px is
  what it yields at 216px.
- **Tests first**, red against main:
  - `engine/ui/characters/carousel.test.ts`:
    - `shownRange` at the start, mid-scroll and the end.
    - A row that fits every card shows them all.
    - A partly shown card is not counted as shown.
  - `engine/ui/characters/Characters.test.tsx`, with the Divided World instance:
    - The Turn offers five radios in one group in the order Face, Heel (Now), Jabroni, Technician, Lurker.
    - None of them is hidden from the accessibility tree.
    - The arrow buttons are named, and "Earlier classes" is disabled at the start.
  - `engine/ui/characters/NewCharacter.test.tsx`: the same five, nothing chosen.
  - `e2e/characters.spec.ts`, in a real browser:
    - At 1440: four cards and a peek, `1–4 of 5`.
    - Arrow Right from Jabroni to Technician, then to Lurker, scrolls Lurker whole into view and the count to
      `2–5 of 5`. "More classes" is then disabled.
    - Under `reducedMotion: 'reduce'` the scroll is instant: whole in view on the next frame.
    - The Technician's name box does not meet its radio's box.
    - At 390: one card whole and a peek, a swipe (`mouse.wheel` on the row's inline axis) snaps to the next card,
      and the page never scrolls sideways.
    - A Turn reopened on a pending Lurker opens with Lurker in view.
    - **Poison:** the row's cards given `visibility: hidden` when out of view, which the accessibility-tree check must
      fail.

### Task 5. The 06 board, and the documents

- Copy `docs/research/2026-10-30-technician/06-turn-carousel.html` over
  `docs/research/2026-10-29-two-worlds/06-turn.html`. In `docs/research/2026-10-29-two-worlds/README.md`, add an
  amendment under the existing ones: "Amended 2026-10-30, by the Technician design: `06-turn.html` is the carousel of
  five the owner approved", with a link to this plan.
- `e2e/boards/06-turn.ts`:
  - **The cards:** the class landmarks become the five in their order, and `jabroni`'s comparison stays full. The
    Technician's name is compared in full, since its large color is the board's; the Lurker's by box only, since it
    stands under the fade.
  - **New landmarks:** the count (`1–4 of 5`, full) and the two arrows (position).
  - **The departures comment:** the Lurker now differs from the board only under the fade.
  - **The run:** `e2e/boards.spec.ts`'s 06 case passes against the new board, and failed against the old board with
    the new build. Both runs are recorded.
- `docs/plans/2026-10-30-glass-to-the-boards-plan.md` section 7's "06 turn" paragraph names "the four class cards".
  That plan is a record, so it is left as written. The build's tail reports it.

## Review focus

- **Settled data from before the change.** Acts and votes an instance already holds: the reorder and the new class
  move no stored row. `class_kinds` gains a row at the next seed, and a character's class history never names a class
  it did not hold. Read `seed_instance` against a database seeded before the change.
- **The bonus at the edges.** Evergreen's take-back: a vote moved on day 5 that was cast on day 1 charges 0.05 it never
  paid (decided, the design's section 1). Read `payVotes`'s `at` for a taken-back share against that rule once more,
  and the log's words for it.
- **The estimate's evergreen line.** It must show whole at the reaction's own time, never apportioned over a crowd as
  a `valuing` line is.
- **A busy instance.** `actAt` is read from the Act already in hand, so the settlement's work grows with the rows read,
  as `settle.ts`'s header requires. The carousel renders every class: at ten classes it is ten cards, and a
  `ResizeObserver` and a scroll listener on one row.
- **The masks.** Nothing the carousel or the picker draws depends on a class a player does not own. The card marked
  Now is drawn only on its own player's Turn.
- **Contrast in the build, not only the guard.** The Lurker's violet large text on the turn surface, under the real
  smoke, in glass Part 2's rendered measurement (`e2e/glass-text.spec.ts`).
