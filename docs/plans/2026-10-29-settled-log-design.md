# The settled log: how a settled line expands into its Acts

Record, written 2026-10-29. A design session with the owner on issue #25, which the web plan's build (PR #24,
`docs/plans/2026-10-29-screens-web-plan.md`, Task 8) raised: the log's settled lines were to expand into their Acts,
"naming which Act, which quadrant and how much", but a `ledger` row (`supabase/migrations/0003_aura.sql`) is only
`(settlement, account, character, reason, amount)`, and nothing the settlement writes says which Acts a reason's amount
came from. Each question was put to the owner one at a time, with alternatives and a recommendation, and the whole was
confirmed before the plan was written. The plan is `docs/plans/2026-10-29-settled-log-plan.md`.

## What the code held

`settle()` (`engine/rules/settle.ts`) already computes `details`: for each ledger entry, one line per Act, quadrant and
reaction time, in whole hundredths shared out by largest remainder so that they add up to the entry exactly. The
settlement job (`supabase/functions/settle/core.ts`) sends `apply_settlement()` only the entries, so the details are
dropped. Recording them was never the hard part. Showing them was.

The screens design (section 7) had accepted "the per-Act settled amounts a settled line expands into" as a day-after
aggregate. The clues design rewrote the masks' rule after it: its one exception now lets The System's scoring show "only
each settled window's sums" (CLAUDE.md, "A response never proves a private fact"). An exact per-Act or per-reaction
settled amount is not a window's sum. Set beside a post's public tally, it says what the live preview was made an
estimate to hide: two reactions came from one player (each counts half), or a reactor had also reacted to the
character's earlier post (the halving). It says it a day late, but the rule is about proof, not timing.

## 1. What a settled line expands into

**Decided:** the day's estimate, frozen at the settlement, and one line that reconciles it with what settled.

```
Settled Oct 30 · Pipewrench          +0.30
  Drew heat                          +0.35  [-]
    Hot take: Wart is... 🔥 2:03pm    +0.10
    Hot take: Wart is... 🔥 3:00pm    +0.10
    Hot take: Wart is... 🔥 4:00pm    +0.10
    Re: Subcon           🔥 5:00pm    +0.10
    Re: Subcon           🔥 5:01pm    +0.10
    One vote per player per Act,
    and the halving                   -0.15
  Polite shrugs                      -0.05  [+]
```

- Each frozen line is an Act, its quadrant and the time of the one reaction it values, as a whole vote alone: the lines
  the player watched in the open window, as the estimate stood when the window closed.
- The reason's amount is the settlement's, exact. The reconciling line is the difference between it and the frozen
  lines' sum, said once per reason in plain words, and drawn only where it is not zero.
- Whatever counts players rather than reactions moves the difference: the shared vote, the halving, a vote paid in an
  earlier window, a post's reactors counted by player for the Lurker's call. The line's words name the two the player
  meets most, and a short help note under the log says the rest.

The owner first asked whether a log like this works against a player keeping their class hidden. It does not: the log is
seen only by its own player (`ledger` and `wallet_events` are read through `own` policies). What others see is each
character's settled standing, which moves once per settlement by that window's total. That is the open secret the
core-loop design accepted (its section 4) and is untouched here. This question is only about what a player's own log
lets them work out about the anonymous players who reacted to them.

Weighed:

- **Exact per Act and quadrant**, with no reaction times. The rule's exception would have widened to "sums per Act". A
  player would see which post was halved and, against its public tally, could link reactors a day late.
- **Exact per reaction**, which `settle()` already computes. This is the most exact and the most revealing: two lines of
  +0.03 and +0.02 a minute apart say one player left both.
- **Apportioning** the settled total across the Acts in proportion to their whole votes, rejected without being put:
  each line would claim an amount its Act did not earn, against "The fiction may lie; the log never does" and the clues
  design's "the estimate never says a reaction earned what it did not".

## 2. A reason that settled to nothing

**Decided:** it stays in the settlement at 0.00, its frozen lines beneath it and the reconciling line taking them to
zero. A Lurker who watched "Called it +0.10" all day, on a post whose first three reactions came from only two players,
sees why the call did not pay. It tells them no more than the reason's settled sum does: a reason with no ledger row
already said the same.

Weighed: listing only reasons that moved Aura, so that the day's line vanished at the settlement without a word.

The reverse also happens. A reason can settle to an amount the estimate never showed, when counting by player makes a
call the per-reaction count did not. That reason is listed with no frozen lines and the whole amount on the reconciling
line.

## 3. Where it is recorded

**Decided:** a table of its own, written with the window.

- `settled_lines`: settlement, account, character, reason, Act, quadrant, the reaction's time, and the amount in whole
  hundredths. It is append-only, and each player reads only their own rows. A line is not a ledger row and needs none: a
  reason that settled to 0.00 has lines and no ledger row.
- `apply_settlement()` takes the lines and writes them in the window's own transaction, so a window settled once has
  its lines once, and a retried window writes neither twice. `settlements.lines_kept` says whether the window kept its
  lines.
- The settlement job runs the engine twice on the one input it reads: `settle()` for the entries, and a new
  `estimateLines()` for every player's frozen lines, which is `settle()` with the shared vote and the halving off and a
  card's lift split into one line per vote, as the live estimate does. `estimateForOwner()` becomes `estimateLines()`
  filtered to one player, so the live estimate and the frozen lines are one function and cannot drift.

Weighed: computing the lines when the log is read, by running the estimate again on a past window. Rejected, because a
past window cannot be read again as it was: `paid_votes` rows move on with later windows, an admin may tune the economy,
and a class's code may change. A log whose past lines change with them would lie. Storing the lines is also what the
export carries ("Portable by construction").

## 4. Settlements from before this ships

Windows settled before the migration have no lines. Their `lines_kept` is false, and the log shows their reasons' totals
with "No breakdown was kept for this settlement." It never shows a made-up breakdown. They are not filled in afterwards,
for the reason in section 3. The game has no players yet, so on a deployed instance these are test windows, but the
log handles them truthfully all the same.

## 5. The sequencing

**Decided:** the log is built here, in this plan's one PR. PR #24 merges without its Task 8, and this plan's build
amends the web plan to say where Task 8 went. The screen is then built against the real read. This plan starts after
PR #24 is merged.

Weighed: building only the engine half here and finishing Task 8 back in PR #24, which would have kept #24 open until
this merged.

## 6. The masks

- The frozen lines are computed with the shared vote and the halving off. With them off, no amount depends on how
  anyone's reactions group into players (`SettleOptions`, `engine/rules/settle.ts`). The only grouping read is the line's
  own player's: their own reactions kept off their card's lift, which they know. These are the same inputs the live
  estimate already shows its player.
- A reason's settled amount is the window's sum, the rule's one exception.
- The reconciling line is the difference of those two, so it adds nothing to them.
- No Realtime event is added. The settlement's answer and timing are unchanged, apart from a payload that grows with the
  window, which only the service sees. The new reads are a player's own rows, by `auth.uid()`.

## 7. At a busy instance's scale

- A window keeps about one line per reaction it valued, plus one per card, spin and call. That is linear in the
  window's reactions, the same order as `paid_votes`, and the export carries it.
- `apply_settlement()`'s argument grows the same way. `settlement_input()`'s answer, which the job already reads in one
  call, is of the same order.
- `estimateForOwner()` splits a card's lift by scanning every reaction in the input for each lift line. For one player
  that cost is bounded; for every player at once it is the product of two lists. `estimateLines()` indexes the reactions
  by Act once, and the settlement's scale test holds it.
- The log reads a page of settlements and their reasons. A reason's lines are read only when it is expanded, through an
  index that leads with the player and the settlement.

## 8. The layers

Engine: the table and its SQL, `estimateLines()`, the settlement job, the log's read in the screens' API, and the log
screen (`engine/ui/log/`) with its out-of-character words, including the reconciling line, since the shared vote and the
halving are engine rules. Instance: each reason's words, through `reasonWords`, which the web plan already adds.

## Ways out

This adds no state a player, a character or a post can be put in. A settlement with no lines kept is a fact about a
window, shown plainly.

## Open

- The reconciling line's exact words and the help note's are written in the build with the out-of-character copy, held
  to "One vote per player per Act, and the halving" in meaning. The owner reads them in the PR.
- Whether a season review (core-loop design, Open) reads `settled_lines` beside `settlement_class_totals`.
