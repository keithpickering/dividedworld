Record, written 2026-11-20.

# Higher stakes on the left: a balance pass on the classes: plan

Carries out `docs/plans/2026-11-20-class-balance-design.md`. One PR from `main`.

**Order with work in flight.** `docs/plans/2026-11-18-tweener-catalyst-plan.md` is being built and changes
`instances/divided-world/classes/tweener.ts`, `engine/rules/settle.ts`, `engine/rules/types.ts`, and
`settlement_input` and `estimate_input`. This plan starts from a `main` that holds the catalyst. Task 6's migration
copies both functions from the newest migration that defines them (`grep -ln "function settlement_input"
supabase/migrations/*.sql | tail -1`), never from `0378_target_lean.sql` by name.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run
<file>` for the screens', `npm run test:sql` for the migration). Run `npm run typecheck` and `npm run build` once after
the last task, with the tail in the PR. No deployed database, bucket or connector is touched; SQL is tested against
Postgres on localhost.

**The layers.** Task 6 is the engine's and names no class. Every other task is Divided World's.

**The masks.** No response, payload, Realtime event or timing is added. The reveal perk reads `class_history` in the
settlement and in the caller's own estimate only (design, section 7).

**States.** None added.

**Scale.** Tasks 1 to 5 change what a class's rules compute from what they are already given, each linear in it. Task
6 adds each input character's `unmask` times, a handful of rows a character read through the `acts_unmask` index, and
one pass over a character's earnings.

## Task 1. The Heel's heat and the Jabroni's groan pay double

Model: sonnet

**Files:** `instances/divided-world/classes/shared.ts` (`perVote`), `heel.ts`, `jabroni.ts`,
`instances/divided-world/settings.ts` (`economy`), `instances/divided-world/classes/classes.test.ts`,
`instances/divided-world/cards/cards.test.ts` (its `amountFor(heel, 'heel.drewHeat')` case expects one vote today).

- `perVote` takes one more argument, `weight` (a number of votes' worth for each vote, default 1), and pays
  `sign * weight * settings.vote * r.votes`. Its header comment says so.
- `economy` gains, beside the classes' other numbers:
  ```ts
  /** What one vote of heat pays the Heel, in votes' worth. */
  'heel.heatVotes': 2,
  /** What one vote of the groan pays the Jabroni, in votes' worth. */
  'jabroni.groanVotes': 2,
  ```
- The Heel reads `heel.heatVotes` (add it to `reads`) and passes it as the weight of `heel.drewHeat`; `heel.shrugged`
  stays at 1. The Jabroni reads `jabroni.groanVotes` for `jabroni.drewTheGroan`; `jabroni.takenSincerely` stays at 1.
  Each is a `reads` entry `{ key, min: 0 }` (`EconomyRead`, `engine/rules/types.ts`), so a negative rate is refused.
- The header comments of both classes say the reward is two votes' worth and why (design, section 1).

**Tests first:** a Heel with one heat vote and one calm vote nets `2 * vote - vote`; a Jabroni with one groan and one
hype nets the same; with `heel.heatVotes` overridden to 1.5, one heat vote pays 15. Every other class's earnings in
`classes.test.ts` are unchanged.

## Task 2. A wrong call costs the Lurker

Model: sonnet

**Files:** `instances/divided-world/classes/lurker.ts`, `instances/divided-world/classes/classes.test.ts`.

- Beside `lurker.calledIt`, a held vote that meets the same timing (`rank` within `lurker.earlyPlayers`,
  `othersBefore < crowd`, `othersNow >= crowd`) with `h.endsUp !== null && h.quadrant !== h.endsUp` earns
  `{ reason: 'lurker.misread', amount: -earlyMatch * h.share, act: h.act, quadrant: h.quadrant, at: h.reactedAt }`.
  No `votes`: it is not a reaction the character received, so no cushion reads it (design, section 5).
- The header comment says a miss costs what a hit pays, and that a tie costs nothing.

**Tests first:** an early vote in the quadrant the post ends up in pays `earlyMatch`, one in another quadrant costs
it; a post that ties costs nothing; a vote split over three quadrants, one of them right, nets `-earlyMatch / 3`; a
miss before the crowd arrives costs nothing yet and costs in the window the crowd arrives; a Thick Skin up on the
Lurker gives nothing back on a miss (use the cushion fixture in `engine/rules/settle.test.ts` as a pattern).

## Task 3. The Face's lift and the Tweener's stir halve

Model: sonnet

**Files:** `instances/divided-world/classes/face.ts`, `instances/divided-world/classes/tweener.ts`,
`instances/divided-world/classes/classes.test.ts`.

- In each, take the plays that pay (a lift with `targetAfter.excitedPositive > 0`; a stir whose `smallerSide` is above
  nothing), order them by the play's `at`, and multiply the n-th (from 0) by `settings.halving ** n`. A play that pays
  nothing is not in the chain.
- Both header comments say so and point at the design's section 6.

**Tests first:** a Face's three Fabs on three posts, each drawing two later hype votes, pay `2v`, `v` and `v/2`; a dud
Fab between them does not halve the next; the same for three stirs; one lift in each of two windows each pays in
full.

## Task 4. Pop Steal

Model: sonnet

**Files:** `instances/divided-world/cards/pop-steal.ts` (new), `instances/divided-world/cards/index.ts` (one line in
each of its runs, as its header says), `instances/divided-world/ui/cards/pop-steal/` (new: `ui.ts`, `ui.test.tsx`,
`scene.py`, `art.webp`, `mark.svg`, `art.json`), `instances/divided-world/ui/cards.ts`,
`instances/divided-world/cards/cards.test.ts` (its table of key, flavor and price).

- `pop-steal.ts` is `rope-break.ts` with `key: 'pop-steal'`, `name: 'Pop Steal'`, `alignment: 'salty'` and
  `match: { flavors: ['sweet'], upTo: 'common' }`, price 100. Its header comment names the design's section 4 and says
  it is Rope Break's mirror.
- `ui.ts` follows Rope Break's: Salty's colors (copy them from a built Salty Reversal's `ui.ts`, e.g. Card Collector's),
  the same status every Reversal has, and words from its rules:
  - tagline: `Steal the pop.`
  - summary: `Set face down on your post. Catches the first Sweet common cast there, and takes it into your hand.`
  - `describe`: Rope Break's sentence with the flavor read from Pop Steal's own `trap.match`.
- The art follows `instances/divided-world/ui/cards/README.md`: a `scene.py` built on `rig.py`, rendered to
  `art.webp` at 1080 by 1680, under 400 KB. Its subject is the build's to propose in the PR, with the design's
  suggestion as a start. `art.json` credits it as the other scenes' do. The owner approves the art and the words in
  review.

**Tests first:** the instance check passes with Pop Steal in it; a Salty common cast on a post holding Pop Steal passes
over it, and a Sweet common is caught and goes to the setter's hand (copy Rope Break's tests and flip the flavor; find
them with `grep -rln "rope-break" instances engine supabase --include=*.test.*`); `ui.test.tsx` holds its words to its
rules as Rope Break's does.

## Task 5. The Starter Pack takes Hype-Up for Rope Break

Model: inline

**Files:** `instances/divided-world/packs.ts`, `instances/divided-world/packs.test.ts`.

- `contents` becomes `['feelin-fab', 'hype-up', 'steel-chair', 'whoops', 'this', 'autocorrect']`, and the comment above
  it names this design beside the Starter Pack's.
- `packs.test.ts` adds that the starter holds no Reversal that catches a Salty card, so a pack cannot again tax the
  Salty classes without a test saying so.

**Tests first:** the new test, red on the old contents. The existing tests (six cards, two of each flavor, each free to
play somewhere) stay green.

## Task 6. The reveal perk, in the engine

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`, `InputCharacter`, `Earning`), `engine/rules/instance.ts` (the settings
check beside `halving`), `engine/rules/settle.ts` (`settle`: the header comment, and a block after the `card.boost`
block), `engine/rules/settle.test.ts`, a new migration redefining `settlement_input` and `estimate_input`,
`supabase/tests/` (the settlement input's SQL test; find it by `grep -rln "settlement_input" supabase/tests`), and
`instances/divided-world/settings.ts` (`revealPerk: 0.2`).

```ts
// Settings
  /** What a character's earnings from reactions count more while its reveal is current, as a share (0.2 is a fifth). 0 for none. */
  readonly revealPerk: number;

// InputCharacter
  /** The times of the character's reveals (its `unmask` Acts) before the window's end, oldest first. */
  readonly reveals?: readonly number[];

// Earning
  /** A reaction to the character's own Acts, or its own early call, caused it: the reveal perk reads it. */
  readonly fromReactions?: true;
```

- **Current at a time `t`:** the character has a reveal at `u <= t`, and no entry of its `classes` starts in
  `(u, t]` after the latest such `u`. A Turn with a reveal writes its class row and its `unmask` at one moment, so that
  reveal is current.
- **The entry:** for each of the character's own earnings with `fromReactions`, a positive `amount`, and an `at` at
  which the reveal is current, push `{ reason: 'reveal.perk', amount: tidy(e.amount * settings.revealPerk), params: {
  share: settings.revealPerk }, act, quadrant, at }` with no class. It reads the class's earnings as returned (the
  `own` slice), so no boost, cushion or payout is perked, and a perk is never cushioned.
- **The check:** `revealPerk` is a number from 0 to 1.
- **The migration:** each character in both functions gains `'reveals'`, the epoch milliseconds of its `unmask` Acts
  created before `window_end`, ordered. In `estimate_input`, a character not the caller's gets `[]`, as its `classes`
  does.

**Tests first:** a character revealed before the window earns a fifth more on a flagged earning, and nothing on an
unflagged one or a loss; a silent Turn after the reveal ends it from the Turn's time, inside the window; a new reveal
after the Turn starts it again; a reveal made at a Turn's moment is current; `revealPerk: 0` pushes nothing; a Thick
Skin up gives nothing back on the perk entry; the check refuses `-0.1` and `1.5` (poison each); the SQL test reads a
character's reveals from `settlement_input` and none for another player's character from `estimate_input`.

## Task 7. Which earnings the reveal perk reads

Model: sonnet

**Files:** `instances/divided-world/classes/shared.ts`, `face.ts`, `heel.ts`, `jabroni.ts`, `technician.ts`,
`tweener.ts`, `lurker.ts`, `instances/divided-world/classes/classes.test.ts`.

- `perVote` sets `fromReactions: true` on a positive earning. The others set it on exactly the design's list
  (section 2): `technician.evergreen`, `tweener.splitTheRoom`, `lurker.calledIt` and `lurker.cardDrew`. Nothing else.
- A test holds the list: it runs each class over a fixture that makes every one of its reasons, and asserts which
  reasons carry the flag. It names the design's section 2, so a new reason is a decision.

**Tests first:** that test, red before the flags.

## Task 8. The words

Model: sonnet

**Files:** `instances/divided-world/ui/index.ts` (`REASONS`, the class descriptions, and the list of economy keys each
states), `instances/divided-world/ui/index.test.tsx`, `instances/divided-world/guide/strategy-guide.md`.

- `REASONS` gains:
  - `'lurker.misread'`: `Misread it: among the first to react to a post that then drew a crowd another way`.
  - `'reveal.perk'`: a function of `share` saying, for 0.2, `Playing it openly: a fifth more on what reactions earned
    while the character's reveal was current` (use `fractionWords`, as `card.cushion` does).
- The Heel's and Jabroni's descriptions say the reward is double, from `heel.heatVotes` and `jabroni.groanVotes`
  (add them to the keys each description states, so the retune test covers them). The Lurker's `hurtsBy` adds early
  calls that go the other way.
- The Strategy Guide: under Classes, a sentence that the Heel and the Jabroni earn double from their corners because
  those are the hard ones to draw; under Reveals, the sentence "Revealing doesn't earn or cost anything directly" is
  replaced by the perk (a fifth more from reactions while the reveal is current, ended by any Turn, until a new
  reveal); the Lurker's paragraph, if it has one, names the miss. The glass's copy is plain and true; the owner
  approves it in review.

**Tests first:** the existing test that every reason has words goes red on the two new reasons; the retune test goes
red on the new keys.

## Review focus

- Ledger rows already settled are not touched; a window settled before the PR keeps its numbers. Check no task
  rewrites history or re-settles a window.
- The reveal perk's "current" across a window with a Turn inside it, a reveal inside it, and both: the times are
  compared at the earning's own `at`, never the window's.
- Whether any earning flagged `fromReactions` is computed from another player's Act (a lift, a stir), which section 2
  leaves out.
- The estimate: a bystander's estimate reads no one's reveals, and the caller's own perk shows only on the caller's
  characters.
- A Lurker's split vote: the hit and the misses must sum to the share-weighted net, never charge a whole vote twice.
- Collusion at 2×: the season review reads it; nothing in code can, and no test should pretend to.
