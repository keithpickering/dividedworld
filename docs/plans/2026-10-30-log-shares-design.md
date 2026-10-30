# A settled log line, expanded into its posts: design

Record, written 2026-10-30. The design session for issue #25, with the owner. Its plan is
`docs/plans/2026-10-30-log-shares-plan.md`.

## The question

The log's settled lines are meant to expand into their Acts, naming which Act, which quadrant and how much (the
screens design, section 7; the web plan's Task 8). A `ledger` row is one reason's amount for one character in one
window (`supabase/migrations/0003_aura.sql`), and nothing the settlement keeps says which Acts it came from.

## What the code already does

`settle()` in `engine/rules/settle.ts` already returns `details`: per ledger entry, a line per Act, quadrant and
reaction time, in whole hundredths that add up to the entry. The settlement job (`supabase/functions/settle/core.ts`)
sends `apply_settlement` the entries and drops the details. So the expansion is not missing arithmetic; it is a
decision about which numbers a player may see.

## 1. What a post's amount is: a share, split by the estimate

**The mask the exact amounts would slip.** Each post's reaction counts are public (`reaction_tallies`). The exact
settled amount per post, beside them, lets its author count how many distinct players reacted to it: three 🔥 that
pay one vote are one player behind several masks. The settled per-reason totals already leak this in a quiet stretch,
which CLAUDE.md accepts for The System's scoring ("shows only each settled window's sums"); exact per-post amounts
would make it a daily reading of every post.

**Decided** (owner, 2026-10-30, "Share by reactions"): each post's line is a **share** of the reason's exact total,
split in proportion to what that post's reactions were worth in the live estimate (the settlement run with the shared
vote and the halving off, `estimateForOwner`'s valuation). The shares add up exactly to the ledger row. They tell the
player nothing past the reason's total: the weights are the estimate the player watched live through the window, and
the total is already shown. Nothing in a share is computed from who reacted.

Weighed: the settlement's exact per-post amounts (truest, and the leak above every day); the posts with no amounts
(no leak, and no "how much").

## 2. Where the shares come from: written at the settlement

**Decided** (owner, "Written at settlement"): the settlement computes the shares once per window and writes them as
append-only rows beside their ledger rows, in `apply_settlement`'s own transaction. A log view is one indexed read of
the player's own rows at any instance's size, and a share, like the ledger, never changes after the window is settled:
a later fix to the scoring code does not rewrite an old line ("Append-only").

Weighed: computing the shares on each view, which rereads a whole window's reactions per view and lets a code change
move old lines.

## 3. When the estimate and the settlement disagree about which post

Some reasons count distinct players (a spun thread's three other repliers, a crowd a Lurker called), and the estimate
counts reactions or characters in their place, so the estimate can value a different post from the one the settlement
paid for.

**Decided** (owner, "Estimate's posts, labeled"): a line's posts and shares always come from the estimate, and the
expansion says so in one plain sentence: "Each reason's total is exact. It is split across your posts by how the live
estimate valued their reactions." Where the estimate valued nothing for a reason in that window, the line names no
post and says "Scored over the whole window, not post by post." Naming the settlement's own posts would say which of
several threads crossed three distinct players, the leak section 1 ruled out.

Weighed: the settlement's posts (faithful, and the same leak); no expansion at all for those reasons.

The log stays true: it says what a share is, and its totals are the settlement's. "The fiction may lie; the log never
does" is a promise about what the log says, and the log says it is a split.

## 4. How the row opens

**Decided** (owner, "Whole row opens"): a settlement's row in the log, as the Log board draws it ("Scored as a Heel
for Oct 29: drew heat +0.20, stole thunder +0.20, polite shrug −0.05."), carries one Show posts control. It opens a
breakdown under the row, inside the table: each reason as a sub-heading with its exact total, its posts beneath it
with the quadrant's label, the share and the post's link, then the sentence of section 3. Closed, the row is the
board's. One control per settlement, one keypress.

Weighed: a disclosure on each reason inside the sentence (five controls in one cell for a five-reason settlement); a
page per settlement (another glass page, and the detail leaves the log that promises it).

The settlement's summary (the Settlement board) gains no expansion, so it still says nothing the log does not; its Open
my log opens the log on that settlement's row, open.

## 5. Settlements before this

A settlement applied before the shares were kept has none, and is never back-filled (the shares are fixed at the
settlement, and a backfill would value an old window under today's code). Its row's Show posts is absent, and its
details say, once, "This settlement was made before posts were kept with it." That is the plain truth and not a dead
end: every amount on the row is still there.

## Open

Nothing. The quadrant labels a share names are the instance's (`InstanceUi.quadrantLabels`), which are still
placeholders the owner will name (the web plan's brief, item 7).
