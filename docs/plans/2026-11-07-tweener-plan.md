# The Tweener, a class that earns by splitting the room: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-tweener-design.md` (issue #29). It is one build session
and one PR, carried out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`). The
PR says `Closes #29`.

## The layers

- **Engine** (`engine/rules/`, `engine/ui/`): `ClassInput.standings`, `PlayedCard.drawnAfter` and `ClassMarks.splits`.
  None names the Tweener: a standing is any Act's votes, and a split mark is any pair of side-by-side quadrants.
- **Instance** (`instances/divided-world/`): the class's rules, its place in the order, its look, marks, glass colors,
  words and hint. They reach the engine through the interfaces that carry the other five: `Instance.classes`,
  `InstanceUi.classLooks`, `reasonWords`, `glass.classes` and `guide.hints`. The Tweener reads no economy number.
- **Database:** one migration, `supabase/migrations/0113_tweener_standings.sql`: `settlement_input()` carries every
  reactor's paid vote on each Act touched in the window, and `paid_votes` gains an index by Act. `seed_instance` adds
  the class kind from the instance's payload, as it did for the Technician, so no migration names it. The migration's
  and its SQL test's numbers (0113, 0115) are the next free ones on 2026-11-07; a build session that finds them taken
  takes the next free ones.

## The masks

Every new value is computed inside the settlement, the scoring exception "A response never proves a private fact"
names, and leaves it only as a settled window's sums on the Tweener's own ledger and log. `standings` and `drawnAfter`
name no player. The live estimate (`estimateForOwner`) runs with the shared vote off, so each reaction is its own voter
and nothing live groups reactions into players. The design's section 8 names the one accepted exposure.

## Tasks

### Task 1. A character's standings, and the crowd a card drew

Model: sonnet

- `engine/rules/types.ts`:
  - `export type Standing = Readonly<Record<Quadrant, number>>`, doc comment: one other player's vote on an Act as it
    stood, its weight times each quadrant's share; it names no player.
  - `export interface ActStanding { readonly act: string; readonly actKind: ActKind; readonly at: number; readonly before: readonly Standing[]; readonly now: readonly Standing[] }`:
    `before` is each other player's vote at the window's start, `now` at its end, a player with no vote then left out;
    `at` is the time of the latest reaction in the window that moved a vote on the Act.
  - `ClassInput` gains `readonly standings: readonly ActStanding[]`, the character's own Acts with a vote moved in the
    window.
  - `PlayedCard` gains `readonly drawnAfter: { readonly at: number; readonly now: readonly Standing[] } | null`: the
    votes, at the window's end, of the players whose first reaction to the target came after the play, the caster's
    and the target author's players left out; `at` the latest of those reactions. Null on a play that does not hold
    the target for its player (below), on a play beyond a post, and where no such player reacted. There is no
    `before`: the play is in the window, so every player it drew arrived in the window, as the Face's lift reads it.
- `engine/rules/settle.ts`, in `settle()`:
  - **Standings.** After `payVotes`, per Act the window's votes touched (owner's own excluded already, unscored and
    System Acts excluded as `received` excludes them): `before` is the Act's paid votes from `input.paid`
    (`weight × shares[q]`); `now` is `before` with each pair `payVotes` returned (`paid`) put in its place. With the
    shared vote off (the estimate), `input.paid` is not read: `before` is each reaction on the Act before
    `window.from` as a voter of its own at a whole vote (1 in its quadrant), and `now` adds the window's. Built in one
    pass over the votes, indexed by Act, as `onAct` is, so the work grows with the rows read. Pushed to the Act's
    author's character, and given to its class through `inside(...)` by `at`, as `received` is.
  - **The crowd a card drew.** A second holder map beside `holder`: per target and caster's player, the earliest play
    of any alignment (an earlier window's included). For each window play that holds its target this way, the players
    whose first reaction to the target (`onAct`'s `first`) is after the play, neither the caster's player
    (`v.owner`) nor the author's, each with their `now` vote from the target's standing.
  - `empty` (the skip of a character with nothing in its input) also reads `standings`.
- Every literal `ClassInput` and `PlayedCard` gains the fields: `input()` and the card helper in
  `instances/divided-world/classes/classes.test.ts`, `engine/rules/settle.scale.test.ts`, and any other a type check
  finds.
- **Tests first,** in `engine/rules/settle.test.ts`, each red against main:
  - A post with an earlier window's 🔥 from player A and this window's 🍅 from B: the author's standing has `before`
    `[A's vote]` and `now` both, each at its weight. **Poison:** `before` read from the window's votes only (A
    missing), which this test must fail.
  - A player whose reactions there are 🔥 and 🍅 stands as half and half in one Standing, not two.
  - A halved vote (the author's second Act a player voted on in the window) stands at its halved weight.
  - The author's own player's reactions are in no standing.
  - The estimate: `estimateForOwner`'s settle sees two reactions by one player as two Standings at a whole vote each.
  - The crowd: a Sweet card on B's post, then C reacts 🔥 and D 🍅, with A (who reacted before the card) moving to 🍅:
    `drawnAfter.now` holds C and D and not A. **Poison:** reading every vote after the card's time, which counts A.
  - A second card by the same player on the same post, of another alignment, has `drawnAfter: null`.
- The scale test (`settle.scale.test.ts`) keeps its bound with `counting` also summing each standing's lengths.

### Task 2. Every reactor's paid vote in the settlement input

Model: sonnet

- `supabase/migrations/0113_tweener_standings.sql`:
  - `create index paid_votes_act on paid_votes (act);` (the primary key leads by account).
  - `create or replace function settlement_input(...)` as `0092_card_end.sql` wrote it, with one change: `'paid'`
    reads `paid_votes p join reacted r on r.act = p.act` (every reactor's paid vote on each Act with a reaction in the
    window) in place of the join on `(act, reactor_account)` from `win_reactions`. The header comment says why
    (`docs/plans/2026-11-07-tweener-design.md`, section 9) and that everything else is as 0092 wrote it.
  - `estimate_input` is not changed: the estimate does not read `paid`.
- `apply_settlement`'s check (`0073_core_loop_answers.sql`) refuses a paid vote whose weight differs from the stored
  one. `payVotes` returns only the pairs it touched, so the untouched rows it was given are never written back; the
  test below holds that.
- **Tests first,** `supabase/tests/0115-tweener-standings.sql`, against Postgres on localhost, red before the
  migration:
  - A post with an earlier settled vote by A and a window reaction by B: `settlement_input` for the window holds A's
    paid vote. **Poison:** the old join, under which A's row is missing.
  - A's row is not in the input for a window in which nobody reacted to that post.
  - The query plan for `paid` on a seeded busy fixture uses `paid_votes_act` (as earlier tests read a plan).
- The export round-trip test is unchanged: no table or column is added.

### Task 3. A split mark on the reaction map

Model: sonnet

- `engine/ui/types.ts`: `ClassMarks` gains `readonly splits?: readonly [Quadrant, Quadrant]`, doc comment: two
  quadrants the class earns from together, by their balance; drawn as two cells each half-filled toward the other and
  joined by a bar; the pair must sit side by side on the map.
- `engine/ui/characters/ClassCards.tsx`, `Marks`: a cell in `splits` renders
  `<span className="kb-class-mark" data-kb-mark="splits" data-kb-toward="right|left" />`, `right` for the left cell of
  the pair in `MAP`'s order and `left` for the right one, before the `earns` test. One bar element after the cells
  (`<span className="kb-class-split-bar" aria-hidden="true" />`) where the class has `splits`. The marks' `role="img"`
  and label are unchanged.
- `engine/ui/characters/characters.css`: `[data-kb-mark='splits']` with a 1.5px solid `--kb-class-fill` edge and the
  half fill toward its partner (`linear-gradient(90deg, transparent 50%, var(--kb-class-fill) 50%)` and mirrored);
  `.kb-class-split-bar` placed on the gap between the top row's cells in `--kb-class-fill`, sized in `rem` as the cells
  are. `engine/ui/guide/guide.css` sizes it where it sizes the guide's marks (phone included).
- `engine/ui/guide/markers.tsx`: the legend gains a line after "calls":
  `earns from the balance between two (the smaller side)`, its glyph the left half-cell.
- `engine/ui/tips/problems.ts`, `classLookProblems`: a class whose `splits` names a quadrant the instance lacks, two
  equal quadrants, a pair not adjacent in one row of `MAP`, or a quadrant also in its `earns`, `hurts` or `calls`, is
  named. **Poisons** in its test: `['excitedNegative', 'calmPositive']` (a diagonal), `['boredNegative', 'boredNegative']`,
  and a split quadrant also in `hurts`; each must be named.
- **Tests first:** `ClassCards`' test draws a class with `splits: ['excitedNegative', 'excitedPositive']` as two
  `splits` cells facing each other and one bar, with the label as the image's name; the guide's test draws the legend
  line. The glass's legibility and layout checks (`engine/ui/glass/board.test.tsx` and the e2e a11y suite) pass with
  the new cells.

### Task 4. The Tweener's rules, and the order

Model: sonnet

- `instances/divided-world/classes/tweener.ts`, its header comment the design's sections 1 to 4 in brief:

  ```ts
  import type { ClassRules, Earning, Quadrant, Standing } from '../../../engine/rules/types.ts';

  /** The smaller of the hype and heat sides: each vote counted once, by its net lean between the two. */
  export function smallerSide(votes: readonly Standing[]): number {
    let hype = 0;
    let heat = 0;
    for (const v of votes) {
      const lean = v.excitedPositive - v.excitedNegative;
      if (lean > 0) hype += lean; else heat -= lean;
    }
    return Math.min(hype, heat);
  }
  const nothing = (x: number) => Math.abs(x) < 1e-12;
  const SHRUG: readonly Quadrant[] = ['calmPositive', 'boredNegative'];

  export const tweener: ClassRules = {
    key: 'tweener',
    name: 'Tweener',
    earn: (input, settings) => [
      ...input.standings
        .map((s): Earning => ({ reason: 'tweener.splitTheRoom', amount: settings.vote * 2 * (smallerSide(s.now) - smallerSide(s.before)), act: s.act, at: s.at }))
        .filter((e) => !nothing(e.amount)),
      ...input.cardsPlayed
        .filter((c) => c.onOthers && c.drawnAfter)
        .map((c): Earning => ({ reason: 'tweener.stirredThePot', amount: settings.vote * 2 * smallerSide(c.drawnAfter!.now), act: c.act, at: c.drawnAfter!.at }))
        .filter((e) => !nothing(e.amount)),
      ...input.received
        .filter((r) => SHRUG.includes(r.quadrant))
        .map((r): Earning => ({ reason: 'tweener.shrugged', amount: -0.5 * settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at })),
    ],
  };
  ```

- `instances/divided-world/classes/index.ts`: `[face, heel, jabroni, technician, tweener, lurker]`, the header saying
  the order is the owner's (the Lurker last).
- **Tests first,** in `instances/divided-world/classes/classes.test.ts`, red before the file exists:
  - The order is `['face', 'heel', 'jabroni', 'technician', 'tweener', 'lurker']`.
  - 6 hype against 6 heat, new this window, pays `12 × vote`; 10 against 2 pays `4 × vote`; 12 against 0 pays nothing.
  - A Standing of half hype and half heat (one player's hedge) pays nothing. **Poison:** summing the shares by
    quadrant before taking the smaller side, which pays it.
  - 🔥🔥🍅 from one player and 🍅 from another: hype ⅓, heat 1, pays `⅔ × vote`.
  - A post at 6 against 6 before the window that draws 6 more hype pays nothing; one whose heat grows from 2 to 6
    against 10 hype pays `8 × vote`; a heat vote moving to hype takes its part back (negative).
  - Each calm-positive and bored-negative vote costs half a vote; an excited one costs nothing.
  - Stirred the pot pays on another's post, not on its own (`onOthers` false), and nothing with `drawnAfter: null`.
  - Retuning `vote` scales every line.
- `instances/divided-world/settings.test.ts` and `instanceProblems` pass unchanged: the class reads no economy number.

### Task 5. The Tweener's look, words and hint

Model: haiku

Reads only the files named. Every string below is the owner's to approve in review (CLAUDE.md, "The fiction may lie;
the log never does": the glass's copy is committed and approved by the owner).

- `instances/divided-world/ui/index.ts`:
  - `reasonWords`, after the Technician's:
    - `'tweener.splitTheRoom': 'Split the room: hype and heat on its post or card, paid on the smaller side, each player counted once by where they lean'`
    - `'tweener.stirredThePot': 'Stirred the pot: hype and heat drawn to another\'s post by players who came after its card, paid on the smaller side'`
    - `'tweener.shrugged': 'Shrugged off: calm or bored reactions to its posts and cards'`
  - `classLooks`, between `technician` and `lurker`:
    `tweener: { color: '#d63ab8', pattern: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px), repeating-linear-gradient(-45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'Splits the room. Earns when a post or card draws hype and heat in equal measure, and when its card sets someone else\'s post arguing.', hurtsBy: () => 'Hurt by the shrug: calm or bored reactions.', marks: { label: 'Earns from a room split between hype and heat, hurt by the shrug', splits: ['excitedNegative', 'excitedPositive'], hurts: ['boredNegative', 'calmPositive'] } }`
- `instances/divided-world/ui/glass.json`, `classes`, between `technician` and `lurker`:
  `"tweener": { "fill": "#ff4fd8", "ink": "#1a0316", "large": "#ffa3ec" }`. If the glass's contrast check refuses a
  value, the session moves it the least that passes and says so in the PR; it does not change the hue.
- `instances/divided-world/guide/hints.ts`: `tweener: 'Say the thing half the room will hate.'`, between the
  Technician's and the Lurker's.
- The Strategy Guide's classes are drawn from the instance at `<!-- kayfabb:classes -->`; its prose is unchanged.

### Task 6. The screens and boards that count the classes

Model: sonnet

- Every test or board that lists the classes takes the sixth: `engine/ui/characters/Characters.test.tsx`,
  `NewCharacter.test.tsx`, `engine/ui/modal.test.tsx`, `engine/ui/data/fake.test.tsx`,
  `engine/ui/guide/markdown.test.ts`, `engine/ui/log/lines.test.tsx`, `engine/ui/cards/lens.test.tsx`,
  `engine/ui/season/Season.board.stories.tsx`, `web/src/data/fixtures/boards.ts` and its test, `e2e/boards/06-turn.ts`,
  `e2e/boards/2026-11-05-backfill/23-new-character.ts`, `e2e/characters.spec.ts` and `e2e/glass-ceilings.json`. A
  test that asserts a count reads it from `instance.classes`, never a literal, where it can.
- The Turn's carousel takes six with no change to `Carousel.tsx`: the e2e boards at 1440 and on the phone show the
  Tweener card reached by the arrows and by the keys.
- The board screenshots the owner reviews: the Turn and New character with the Tweener card chosen, desktop and phone,
  and the Strategy Guide's classes, attached to the PR.

## Review focus

- Acts an instance already holds: the first settlement after the merge reads every reactor's paid vote on each touched
  Act; a Tweener's post with history settles only the difference since its last settlement, never its whole history at
  once. (A character who Turns into the Tweener is paid the change from the window it holds the class, from the vote
  as it stood then.)
- The widened `paid` is never written back: `apply_settlement`'s weight check must not see an untouched row change.
- The cost at a busy instance's scale: a viral post touched every day reads all its reactors' paid votes each
  settlement. The scale test's bound and the index's use in the plan.
- A mask slipping: no response, Realtime event or estimate line computed from how reactions group into players; the
  estimate's split must come from per-reaction voters.
- Stirred the pot's holder: a player with a Sweet and a Salty card on one post is paid once, by the earliest.
- The split mark's legibility at 200% text and on the phone, and in forced colors (issue #63 already names the glass's
  filled buttons there).
