Record, written 2026-11-17.

# Thick Skin softens a card being outdrawn: design

A design session, with the owner reached through the dispatching session. It completes one rule of the cushion in
`docs/plans/2026-11-16-settlement-design.md` (section 3.2) for issue #805, which the final review of Thick Skin
(PR #795) found. Its plan is `docs/plans/2026-11-17-thick-skin-outdrawn-plan.md`. It is one rule completed, not a
redesign of the cushion.

## 1. What is missing today

Thick Skin's words say half of what a character loses from reactions is given back. The cushion in
`engine/rules/settle.ts` gives back a share of an earning only where the earning has a negative amount, positive
`votes`, an `at`, and an `act` that is the character's own, with `at` inside a cushion play's `[from, ends)`.

One class loss in Divided World is caused by reactions and carries neither `votes` nor `at`: `face.stoleThunder`
(`instances/divided-world/classes/face.ts`), charged when a card the Face played on another player's Act drew more
votes in the window than that Act did. It comes from comparing two totals over a window, so there is no one reaction
to name and no one time. The guard skips it, and the tagline, the sheet and the `card.cushion` log line are untrue for
that case.

## 2. Decided by the owner

1. **The loss is cushioned** (issue #805, option 1): "I think a Face's loss for being outdrawn makes sense to cover if
   it's a straightforward change. It makes the card easier to understand, any loss due to others' reactions is
   softened". Weighed and not chosen: narrowing the words to "a loss for a reaction's vote", which keeps the code and
   makes the card harder to say.
2. **The moment that decides is the moment the window settles**, when the loss is charged, not the moment the Face
   played the card. Weighed: the play's time (a cushion used after the card was played would never cover it, though
   the reactions that caused the loss came while it was up); the time of the last vote on the card (a time the class is
   not handed, and one that moves with every reaction).

The change is straightforward: an earning carries a marker, and the cushion's guard reads it with the window's end. No
SQL changes, and no input changes.

## 3. How the engine knows

**`Earning` (`engine/rules/types.ts`) gains `ofWindow?: true`.** A class sets it on a loss that the window's reactions
caused together, with no one reaction to name. It says a fact about the earning and nothing about any card. The engine
never reads a reason's name, so it learns nothing of the instance's ("KayfaBB never knows which instance it runs").
`face.stoleThunder` sets it; that is the instance's whole change to its rules.

The cushion's guard then has two ways to find the moment a loss was taken:

- **A reaction's loss**, as today: positive `votes` and an `at`. The moment is `at`.
- **A window's loss**: `ofWindow`, and no reaction's moment by the line above. The moment is the window's end,
  `window.to`.

Everything else in the guard is as it is: a negative amount, an `act`, the Act being the character's own, the moment
inside `[from, ends)` of a cushion on the character or on the Act, the largest share of those that apply, and
`tidy(-share * amount)` as `card.cushion` with `{ card, share }`. The entry it writes for a window's loss names the
Act and carries no `at` and no quadrant, as the loss beside it carries none.

Weighed and rejected: the class setting `at` and `votes` on the loss itself, so the guard need not change. `votes` is
"the signed votes of the one reaction it pays for", and there is no one reaction. `at` gives the live estimate a timed
line at a moment no reaction landed, and changes which detail line the loss is. A class is handed its stretch's end and
not the window's, so a character that Turned in the window would be read at the Turn. The engine knows the window's
end; the class does not need to.

## 4. The moment, in `settle.ts` terms

"The moment that window settles" is `window.to`, the instant the window closes. The time the settlement job happens to
run is not in the input and would differ between a run and its retry, so it is never read.

- **Against `[from, ends)`.** A cushion is up for a window's loss where `from <= window.to` and `window.to < ends`.
  Every play in the input was made before `window.to`, so the first always holds, and the rule is: **the cushion ends
  after the window does.** A cushion that ends exactly at the window's end is not up, as a reaction at the instant a
  cushion ends is not cushioned.
- **What that means in play.** A Thick Skin used in the last minute of a window covers every card of that character
  outdrawn in that window. One that ran out an hour before the window closed covers none, though the votes came while
  it was up. The owner chose this; the sheet says it (section 6).
- **An admin ending the card.** A play an admin ended before the window's end is not in the input, so it cushions
  nothing, which agrees with "up at the window's end". One ended after the window's end is in that window's input on a
  retry as it was on the first run (`settlement_input` reads `card_end` Acts before `window_end` only).

### 4.1 The loss taken back, and replay

- **A play is judged once.** `settle` builds `cardsPlayed` from the plays made in the window only, and no later window
  judges them again (the Face thunder design, section 1, "One window"). So a settled outdrawn loss is never taken back
  by a later window, and there is no later comparison that could flip.
- **The cushion is derived from the loss in the same run.** It is computed from the class's own earnings of that run
  and stored nowhere else. A run in which the comparison goes the other way has no loss earning, and so no cushion:
  the two appear and disappear together. This is unlike a reaction's loss, where a later reaction by the same voter
  can shrink a cushioned share (the settlement design, section 3.2); nothing of that kind exists here.
- **A retry of the same window** reads the same input and `settle` is pure, so the totals are the same. The comparison
  reads `window.to` and the play's `ends`, both input values, and rows are read in the canonical order.
- **A later window** carries the cushion play while it is still up, and carries no loss for the earlier window's
  cards, so it pays nothing for them a second time.
- **The live estimate** is `settle` run on the window so far, whole, each time it is asked for. A card that outdraws
  now and not ten minutes later shows the loss and its cushion now, and neither later.

### 4.2 Open: the estimate's window ends now

`estimate_input` sets the window's end to now, so the estimate cushions an outdrawn loss where the card is up now. If
it ends before the window really closes, the settlement gives nothing back and the estimate said otherwise. The
estimate can already say an outdraw the settlement does not charge; it is an estimate, and the settled log is exact.
Sending the scheduled end of the window to the estimate would fix it and is a change to `estimate_input` that this
design does not make. Recorded as open.

## 5. Every other class loss

Read from each class's `earn` in `instances/divided-world/classes/`:

| Negative earning | What causes it | Carries |
|---|---|---|
| `face.boredTheRoom`, `heel.shrugged`, `jabroni.takenSincerely`, `technician.draggedIn`, `tweener.shrugged` | one reaction's vote | `votes`, `at`: cushioned today |
| `face.stoleThunder` | the window's reactions together | nothing today; `ofWindow` after this |
| `lurker.postedTooMuch` | the character's own posts, no reaction | nothing, and never cushioned: the sheet's "nothing it loses for any other reason" |
| `tweener.splitTheRoom`, below zero | a gain taken back as the room stops being split | `at`, no `votes`: no loss, never cushioned |
| any per-vote gain, below zero (`lurker.cardDrew`, `face.cheered` and the like) | a vote that moved away | negative `votes`: no loss, never cushioned |

So `face.stoleThunder` is the only one. `heel.stoleThunder` and `jabroni.soldTheL` are gains. The two designs waiting
to be built add no loss a reaction causes (section 9).

**The check the review proposed holds up**, in this form: every negative earning a class returns either carries what
the cushion needs (positive `votes` and an `at`, or `ofWindow`), is a per-vote gain taken back (negative `votes`), or
has its reason in a short list the test holds with the reason each is there (`lurker.postedTooMuch`: no reaction
causes it; `tweener.splitTheRoom`: a gain taken back; and `tweener.outvoted`, a refund taken back, once the Tweener
plan is built). It is driven over one input per class that exercises every
rule, and it also asserts that every class reason the instance has words for was seen, so a rule added later cannot go
unread. Its poisons are in the plan.

## 6. The words

Read against what is paid once this is built:

| Where | Words | True? |
|---|---|---|
| Tagline | "Lose half as much from reactions." | yes |
| Status | "Loses half as much from reactions" | yes |
| Summary | "Used on your own character. For 3 days, what it loses from reactions is halved." | yes |
| The play's log line | "What that character loses from reactions is halved until it ends." | yes |
| `card.cushion` log line | "Thick Skin: half of each loss from a reaction, given back" | yes |
| The card's mark (`engine/ui/cards/marks.ts`) | "Gives back 50% of each loss a reaction causes." | yes |
| Sheet | "For 3 days, whenever a reaction to something that character did costs it Aura, half of that loss is given back, and then it stops by itself. ..." | not for one case |

The sentences are read as they stand on main after PR #808. The sheet's one untrue case: reactions land on a card while Thick Skin is
up, Thick Skin ends, and then the window closes and charges the outdrawn loss whole. So the sheet gains one sentence,
after "and then it stops by itself.", naming no class as its tests require:

> A loss counted from a whole settlement window's reactions, and not from one reaction, is halved where this card is
> still up when that window ends.

"Settlement window" is the Strategy Guide's own term (the Lurker's `hurtsBy`). It is a draft the owner approves in the
build's review. Nothing else changes.

## 7. The masks

- **Nothing new is read.** The cushion reads the earning character's own class earnings and the cushion plays on that
  character or its own Act. It reads no other character's class, and nothing about who owns the outdrawn Act beyond
  what the loss itself already turned on.
- **Who can watch.** The new `card.cushion` line is in the earning player's own log and estimate, beside the loss it
  softens, which is already there. Nobody else is shown either.
- **No response, payload, Realtime event or timing is added.**

## 8. The layers, states and scale

- **Engine:** the `ofWindow` field and the guard's second way. **Instance:** the Face's earning sets the field; the
  sheet's sentence; the check over the classes.
- **States:** none added. Thick Skin's own state ends by itself, as built.
- **Scale:** one more comparison per own negative earning of a character with a cushion on it; nothing new is indexed
  or read from the database.

## 9. Beside the two designs waiting to be built

Both merged to main with PR #810 and neither is built.

**The Face's stolen thunder** (`docs/plans/2026-11-18-face-thunder-design.md`) narrows when `face.stoleThunder` is
charged: not where the room booed the outdrawn Act, and not where that Act is a cast that reads as Salty. It leaves
the earning itself as it is. The two sit together with nothing more to decide:

- **A loss that is still charged is still cushioned,** by the rule of section 3, at the window's end.
- **A waived loss has nothing to cushion.** The class returns no earning, the cushion is derived from the class's
  earnings (section 4.1), and so nothing is given back for a charge that was never made.
- That plan's migration changes what `settlement_input` and `estimate_input` send for a play's target. This design
  reads none of it and changes no SQL.

**Lit the fuse** (`docs/plans/2026-11-18-tweener-catalyst-design.md`, section 5) cuts the Tweener's refund,
`tweener.outvoted`, by the share of the largest cushion that has covered the spark, so that a cushion and the refund
never sum past the loss. This design does not touch that clause:

- The Tweener has no window's loss, so nothing of its is marked `ofWindow`, and what a cushion gives a Tweener is what
  it gives today. The bound "a cushion gives back at most its share of a loss" holds for a window's loss too.
- That plan says `tweener.outvoted` "carries no `votes`, so no cushion reads it". That stays true: an earning with
  neither `votes` nor `ofWindow` is read by no cushion, and a refund taken back (below zero) is no loss.
- `cushioned` is read from the cushion plays in the input, which this design does not change.

**Which build goes first.** The three are separate builds: this one is the cushion's loop and one field, the Face's is
what a play is scored against, with a migration, and the Tweener's is debates, with another. This design's tasks do
not belong inside the Face's build, which closes a different question and would hide #805's fix in it.

Recommended: **this build first.** It is the smallest, adds no migration, and its check (section 5) then holds the
other two to it without anyone remembering: each of them adds a required field to what a class is handed
(`PlayedCard.targetLean`, `ClassInput.debates`), so the check's input stops compiling until it is filled, and the
Tweener's two new reasons fail the check until its input reaches them and `tweener.outvoted` is named in its list. In
the other order nothing breaks: this build then fills those fields itself, and the plan says how.
