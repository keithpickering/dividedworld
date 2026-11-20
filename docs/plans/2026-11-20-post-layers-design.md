# Post layers: a famous post keeps its newest plays

Record, written 2026-11-20. A design session with the owner, started from the famous-post stress test
(`engine/ui/cards/FamousPost.board.stories.tsx`) and issue #871. The plan is `docs/plans/2026-11-20-post-layers-plan.md`.

## 0. What was found

- **Every reader takes the oldest N.** A thread page reads at most eight plays a post, oldest first (`on_posts` in
  `thread_page`, supabase/migrations/0375_spun_thread_reads.sql). Its ORIGIN box reads the oldest twenty and a `more` flag
  (`o_plays`, `o_shown`). Three client re-reads of one post take eight: the effect retry (engine/ui/cards/Effects.tsx), a
  post's history tails (engine/ui/thread/lines.tsx) and the play form's read after no answer (engine/ui/cards/PlayForm.tsx).
- **Eight was a stack bound, and history is not a stack.** `PLAYS_PER_POST` (engine/ui/cards/plays.ts) says eight is "more
  than any card stacks on one post". A stack counts only plays still up (`place_cast`, 0374; `landsOn`,
  engine/rules/cards.ts), so a post's ended plays pile up without limit. Past eight in its history, a post loses its newest
  plays from the page, the ones in force included: their effects are not drawn, their marks are missing, and nobody can
  react to, spin from or end them from the post.
- **The fake reads differently.** The fake's thread page and the Supabase client's `cardsOnMany` share one limit across
  the page (eight times its posts, oldest first across all of them), not eight a post. The stress test had to pad its
  thread with replies to see every play.
- **The Who rows are heavy** (#873): about 170px a play with four buttons. That is the Lens's look and is not this design.
  Here it only means that a kind's whole history is never drawn at once.

## 1. What a page reads for a post (decided: in force, plus stand-ins and counts)

For each post a page shows, it reads:

1. **Every play in force:** what the server's stack rule counts as up (a card play, on the post at post reach, not caught,
   not ended by an admin or refunded (`card_ended`), not instant, its `ends` null or still ahead), and a card back whose
   `face_down` row is still live. This set is bounded by the instance's stacks, never by the post's age.
2. **Two stand-ins for each kind:** its most-drawn play (the public reaction tally's sum plus the threads spun from it,
   `drawnOf`, engine/ui/cards/billing.ts) and its newest play, each sent as a full Act, whether it is over or not, with the
   Acts that end or spring it.
3. **Counts for each kind:** how many plays of the kind the post has had, and how many of those took.

Weighed:
- *Everything, no cap.* Correct, but a page then costs the whole history of every famous post on it, on every view.
  Fails "Weigh a design at the scale of a busy instance".
- *The newest N instead of the oldest.* Still wrong: a Whoops! from three years ago that is still inked falls out once
  eight newer plays have run out.

Why the stand-ins are enough: billing orders a post's plays most drawn first, then newest, and a kind takes the place of
its first billed play (`kindsOf`, engine/ui/cards/marks.ts). A kind's first billed play over its whole history is either
one of its plays in force or its most-drawn play (ties to its newest), so billing over what the page holds orders the
kinds exactly as billing over the full history would. The mark's corner sign ("a play here has drawn more than the
post") reads the same plays for the same reason. A kind that is wholly over still has its newest play, so its mark and its
Lens say how and when it ended.

Weighed for the history: a summary row per kind with no Acts (lighter, but the mark, billing and the Lens tab would each
draw from two shapes), and the server sending the kind order outright (smallest, but billing moves into SQL and a live
play's place has to be reconciled with it).

## 2. The Lens's Who pages a kind's older plays (decided: newest first, on a press)

Who lists the plays the page holds first, in today's order (a stacking card's by layer, top first; any other by billing).
Below them, while the kind's count is more than the rows held, a **Show older plays** button reads the kind's next
twenty ended plays, newest first, by a cursor on (date, id), with their ends, public tallies, spun threads, the reader's own
reactions and their casters, so each row reacts and spins as a held row does. The button names how many are left. When
none are, it is gone.

Weighed: the whole history at the first unfold (one read, but a peek at a 2,000-play kind costs 2,000 rows), and an
infinite scroll inside the Lens (the same read, but a floating panel that grows under the pointer, and a keyboard user tabs
to the end to load).

## 3. One definition of a post's plays (decided: two SQL functions, one mirror each in the fake)

- **`post_layers(posts uuid[])`**: §1's set for many posts in one pass. `thread_page` calls it for the page's posts and for
  its ORIGIN box, whose `more` flag goes (the counts say more than it did). The client's three single-post re-reads call it
  as an RPC.
- **`kind_plays(post, card, before_at, before_id, size)`**: §2's page.
- The fake keeps one function for each, which every fake reader calls, so the fake reads per post as the database does.
- `cardsOn` and `cardsOnMany` lose their only callers and are removed. Their `limit` existed for the cap.

Weighed: the rule kept inline in `thread_page` with RPCs written beside it (the `n <= 8` line has already been copied
across nineteen migrations), and the client re-reads left uncapped (unbounded on a famous post, and the effect retry runs
by itself).

## 4. Computed on read (decided), gated by its plan

`post_layers` finds each kind's stand-ins and counts by reading the post's whole play history through an index on
(`target_act_id`, card, `created_at`, `id`), joined to `reaction_tallies` and the spun-thread index. A famous post costs
index rows on each view, never payloads. The gate is the repository's own form for a bounded read
(supabase/tests/0036-bounded-reads.sql): an EXPLAIN with sequential scans off shows an index serves every part of it, and
the check goes red with the index withheld. A 5,000-play post checks the stand-ins and counts are right. The time on the
local database is written in the PR, not asserted (a millisecond bound flakes in CI). The owner agreed to this in place
of a time bound.

Weighed: a summary row per (post, kind) kept by triggers on plays, ends, reactions and spins. Reads cost the kinds alone,
but it is a second copy of what the Acts hold, a hot row on exactly the famous post, and a missed trigger (a reversal, a
refund) leaves a count quietly wrong. It is the way out if the plan's gate ever fails, and is not designed now.

## 5. The masks

- **Counts and kinds are public.** A post's plays are public Acts. A count is of public Acts by their public kind: a card
  back counts as a back (its card is the setter's private fact), and a back that sprang is still counted as a back, the
  spring Act that names its card riding with it as it does today.
- **Drawn is public.** The most-drawn stand-in is picked from `reaction_tallies` (public sums) and threads spun (public).
  Nothing reads who reacted.
- **A Who page is the same for every caller,** but for the caller's own reactions (`mine`, theirs alone, as the page's are).
  Its cost depends on the post and the kind, never on who owns a play.

## 6. Ways out

No state is added. A Who page that fails to read leaves the rows it had and says so plainly on the button, which reads again
when pressed.

## 7. Layers

All engine. The SQL knows no card's key: a back is a play with no card, which the client draws as `CARD_BACK`. No instance
interface changes.

## 8. Open

- Whether the ORIGIN box, which draws a play's moment, should mark plays as of that moment rather than as of now. It marks
  them as of now today, and this design keeps that.
- The Who row's look on a long list (#873).
