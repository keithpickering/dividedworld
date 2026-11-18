Record, written 2026-11-17.

# Thick Skin softens a card being outdrawn: plan

Carries out `docs/plans/2026-11-17-thick-skin-outdrawn-design.md`. One PR from `main`, which closes #805.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run
<file>` for the screens'). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the
PR. No deployed database, bucket or connector is touched, and this build adds no migration: if a task cannot be done
without SQL, stop and ask the owner.

**The rule, whole.** An earning a class marks `ofWindow` is a loss the window's reactions caused together. Where its
amount is negative and its Act is the character's own, a cushion on the character or on the Act that is up at the
window's end (`from <= window.to < ends`) gives back its share, as it does for a reaction's loss at the reaction's
time. Divided World marks `face.stoleThunder`.

**The layers.** Task 1 is the engine's and names no class and no reason. Tasks 2 to 4 are Divided World's.

**The masks.** The plan adds no response, payload, Realtime event or timing. The cushion reads the earning character's
own class earnings and the cushion plays on that character or its Act, as today. The new `card.cushion` line is in the
earning player's own log and estimate, beside a loss line already there.

**States.** None added.

**Scale.** One more comparison for each negative earning of a character with a cushion on it.

**Beside the Face thunder plan** (`docs/plans/2026-11-18-face-thunder-plan.md`, not yet built): it changes the filter
on the same line of `face.ts` and this plan changes the earning that line returns. Whichever lands second keeps both.
The tests below charge the loss on a post with no reactions, which is charged under both rules.

## Task 1. The engine: a window's loss, and the cushion's second way

Model: sonnet

**Files:** `engine/rules/types.ts` (`Earning`), `engine/rules/settle.ts` (`settle`: the header comment's cushion
entry, the `Contribution` type, the line that pushes each class earning, and the cushion's loop),
`engine/rules/settle.test.ts`.

`Earning` gains, after `votes`:

```ts
  /**
   * A loss the window's reactions caused together on `act`, with no one reaction to name (a card outdrawn): it is charged as the window
   * settles, so a cushion softens it where it is up at the window's end. A class sets it on such a loss and on nothing else; with a
   * positive amount it is read by nothing.
   */
  readonly ofWindow?: true;
```

The comment on `Earning.votes` ends "an earning without it is never cushioned"; it becomes "an earning without it is
cushioned only as a window's loss (`ofWindow`)".

In `settle`:

- `Contribution` gains `ofWindow?: true`, and the push of each class earning carries it
  (`...(e.ofWindow ? { ofWindow: true as const } : {})`).
- The cushion's loop finds the moment first, then goes on as it does:

```ts
    for (const e of own) {
      if (!(e.amount < 0) || e.act === undefined || acts.get(e.act)?.character !== c.id) continue;
      /* The moment the loss was taken: a reaction's own time, or for a window's loss the window's end, when it is charged. */
      const when = e.votes! > 0 && e.at !== undefined ? e.at : e.ofWindow ? window.to : undefined;
      if (when === undefined) continue;
```

  with `when` in place of `e.at` in the comparison against `[g.from, g.ends)`, and the entry it pushes carrying
  `at` only where the earning has one (`...(e.at !== undefined ? { at: e.at } : {})`). An earning with `votes` and an
  `at` is read by its `at` whether or not it is marked.
- The header comment's cushion entry says the second way in the words of the rule above, and its sentence "an earning
  with no `votes` (a cost no reaction caused) is never cushioned" becomes true again by naming `ofWindow`.

**Tests first** (`settle.test.ts`, beside the cushion's tests, with one more stub class in `cushionWorld`: `tallied`,
which returns for each of its posts `{ reason: 'tallied.outdrawn', amount: -20, act, ofWindow: true }`, and a
character of that class in `cushionBoard`):

- A 0.5 cushion on the character that ends after `window.to`: `card.cushion` of 10 with `{ card, share: 0.5 }`, and
  its detail line names the Act and has no `at` and no quadrant.
- The cushion ends before `window.to`: none. It ends exactly at `window.to`: none.
- The cushion is played in the window's last hour, after everything else: 10.
- The cushion is on the Act (`onPostBy`) and not on the character: 10.
- Two cushions up at the window's end: the larger share alone, one entry.
- The stub returning the same earning with a positive amount: none. Without the mark: none (`costly` still gets
  none). Naming another character's Act: none.
- A `voted` loss with `votes` and an `at` inside a cushion that ended before `window.to` is still half given back:
  the reaction's way is unchanged. Every existing cushion test holds.
- The same input with its rows reversed settles to the same entries and details.
- The next window, with the cushion still up and the post now before the window: no `card.cushion` for it.
- With `{ sharedVote: false, halving: false }` and the window ending mid-day: the cushion line is there with the loss
  line, and with the stub's post removed neither is.
- `engine/rules/settle.scale.test.ts` holds.

**Poison, recorded in the PR:** read `e.at ?? window.to` for every negative earning (dropping the `ofWindow` test):
the "without the mark" case goes red.

## Task 2. The Face's loss is marked

Model: inline

**Files:** `instances/divided-world/classes/face.ts`, `instances/divided-world/classes/classes.test.ts`,
`instances/divided-world/cards/thick-skin.test.ts`, `instances/divided-world/cards/thick-skin.ts` (header comment
only).

`face.ts`: the `face.stoleThunder` earning gains `ofWindow: true`. Nothing else in the class changes. `heel.ts` is not
changed: its outdraw is a gain. `thick-skin.ts`'s comment says "half of each loss the character's class takes from
reactions, a reaction's or a whole window's".

**Tests first:**

- `classes.test.ts`, beside "Face's weakness: its card outdrawing the post it landed on": the earning has
  `ofWindow: true`, an `act`, and no `at` and no `votes`.
- `thick-skin.test.ts`, settled with the real instance. The file's `use` helper ends its play four hours before the
  window does; add a second helper whose play ends after `W_TO`. A Face (`tom-1`) plays `whoops` on `bob-1`'s post,
  which has no reactions, and `bob` leaves one `tomato` on the card:
  - Thick Skin up past the window's end: `face.stoleThunder` -20 and `card.cushion` 10 with
    `{ card: 'thick-skin', share: 0.5 }`.
  - Thick Skin ended before the window's end (the old helper): -20, and no cushion.
  - Thick Skin used after the card and after the reaction, still up at the window's end: 10.
  - A Heel in the same place with a Salty card: `heel.stoleThunder` 20 and no cushion.
  - `estimateForOwner(input, instance, 'tom')` with the cushion up: a `card.cushion` line on the card's Act with no
    `at`, and its lines add up to its entries.

## Task 3. The check: no class loss from reactions goes unread

Model: sonnet

**Files:** `instances/divided-world/ui/index.test.tsx` (it imports `REASON_KEYS`, which the rules' tests cannot),
beside "every reason a class pays reads as a sentence of its own".

One test, `every loss a class charges is one the cushion can read, or is named here`:

- Build one `ClassInput` that exercises every rule of every class: a received vote of +1 and one of -1 in each
  quadrant on a post and on a card (one aged past `technician.evergreenDays`), a played card that outdraws on
  another's Act (Sweet, Salty and Pepperoni, with `targetAfter` and `drawnAfter` filled), a Salty card landed, a held
  vote that pays `lurker.calledIt`, a spun thread past its repliers, more posts than `lurker.postsAllowed`, and a
  standing whose smaller side rose and one whose smaller side fell. Call each class's `earn` on it with the instance's
  settings.
- Every earning with a negative amount must be one of: positive `votes` and an `at`; `ofWindow` and an `act`;
  negative `votes` (a per-vote gain taken back); or a reason in the test's own list, which holds each with why:
  `lurker.postedTooMuch` ("no reaction causes it; the sheet says nothing lost for any other reason is given back") and
  `tweener.splitTheRoom` ("a gain taken back as the room stops being split").
- Every reason in that list must have been seen negative, so the list holds nothing stale.
- The reasons seen across all classes must equal the `REASON_KEYS` that begin with a class's key and a dot, so a rule
  added later with no row in the input fails here and not in play.

**Poisons, each recorded red in the PR and restored:**

1. Remove `ofWindow: true` from `face.stoleThunder`: red, naming the reason.
2. Remove `votes` from `tweener.shrugged`: red, naming the reason.
3. Remove the outdrawing card from the input: red, `face.stoleThunder` and `heel.stoleThunder` never seen.
4. Add to the test's list a reason no class returns (`face.neverCharged`): red, stale.

## Task 4. The words

Model: inline

**Files:** `instances/divided-world/ui/cards/thick-skin/ui.ts` (`describe`),
`instances/divided-world/ui/index.test.tsx` (the Thick Skin block).

`describe` gains one sentence after "and then it stops by itself.", with the constant `halved` the file already has:

> A loss counted from a whole settlement window's reactions, and not from one reaction, is halved where this card is
> still up when that window ends.

The tagline, summary, status, `logPlay`, the `card.cushion` words in `instances/divided-world/ui/index.ts` and the
card's mark in `engine/ui/cards/marks.ts` are true as they stand and are not changed. The sentence is a draft the owner
reads in the PR.

**Tests first:** the block's assertion of the whole `describe` string, with the sentence in. Its checks that the words
hold no "%" and no class's name hold.

## Task 5. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. `npm run test:sql` is not needed: no SQL changed.

## Review focus

- **Acts an instance already holds.** No ledger entry is rewritten. A window settled before this build and settled
  again by a retry after it would gain a `card.cushion` for an outdrawn loss; check how a retry of an already settled
  window is guarded, and that nothing settles a closed window twice.
- **A retry, and the next window.** The cushion for a window's loss must be the same on a second run of the same
  input, and must not appear in a later window that carries the cushion play and not the loss.
- **The estimate.** Its window ends now (`estimate_input`), so it cushions an outdrawn loss where the card is up now,
  and the settlement where it is up at the window's real end (the design, section 4.2, open). Check the estimate's
  words claim no more than an estimate, and that its lines still add up to its entries.
- **The engine learns no reason.** `settle.ts` must read `ofWindow` and never a reason's name or a class's key.
- **A mark that lies.** `ofWindow` on a cost no reaction caused would be cushioned. Check Task 3's test would catch a
  class setting it on such a cost, or say that it cannot and who reads a new mark.
- **The sheet's promise, again.** Read each class's `earn` against Task 3's input and confirm the input reaches every
  branch that returns a loss, since a branch the input does not reach is one the test cannot see.
- **A mask.** The new line's presence turns on the earning player's own card and own loss; check nothing in it
  differs with who owns the outdrawn Act or who reacted.
- **The words.** The sheet's new sentence against what is paid, in each order of card, reaction, Thick Skin and the
  window's end.
