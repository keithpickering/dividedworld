# A post's plays: one read the rules bound, and a limit on the effects a post draws

Record, written 2026-11-21. A design session with the owner. It merges two designs written a few hours apart on 2026-11-20
that did not know of each other and cannot both be built: `docs/plans/2026-11-20-post-effects-design.md` (package 5 of #845,
and #86's last item) and `docs/plans/2026-11-20-post-layers-design.md` (#871). Both rewrote how `thread_page` reads the plays
on a post, both changed `place_cast`, `place_set` and the Lens, and both claimed migration 0379. This design supersedes both
and their plans; they stay as records. The plan is `docs/plans/2026-11-21-post-plays-plan.md`.

## 0. What was found

- **The two were rivals on the read only.** Post-effects also carries a rule (a limit on drawing effects) that post-layers
  has no answer to and does not conflict with.
- **Post-layers has the better contract.** A page that holds the plays in force, two stand-ins and a count for each kind
  draws the same marks, in the same order, as one that holds the whole history. Post-effects' "newest 8 ended" does not:
  the marks count and order what the store holds (`counted`, `engine/ui/cards/Marks.tsx`), so a kind's ×N would undercount
  and a kind whose plays all ended long ago would leave the post.
- **Post-effects has the better cost.** Its read is bounded by the rules at any age of a post. Post-layers read a post's
  whole play history on every view, with a tally lookup for each play, behind a gate that proved only "no sequential scan".
  The repository already holds the ORIGIN box's read to a row bound (`supabase/tests/0372-origin-scale.sql`), which that
  gate would have loosened.
- **Post-effects' kept row was already stale.** It kept each play's end by triggers that listed the ways a play ends.
  `supabase/migrations/0400_pierce.sql` added one a day later (a cast that spends a pierce play), and the Buzzkill plan
  (`docs/plans/2026-11-21-buzzkill-plan.md`) adds another. A list of enders written into triggers drifts.
- **Post-layers' rule dropped plays the page carries.** It kept only plays at post reach. A character card's Act targets
  the post it was played from and a thread card's the thread's first post (`place_cast`), and `thread_page`'s `on_posts`
  carries them with no filter on reach: among them every heart and Unban, which are on no other part of the page.
- **What is in force has more ways to end than either design listed.** Time, caught, instant, an admin's end, a refund, a
  pierce spent, a spring, a take back, a back's own time, and a drive's close, which is the one end that moves later (each
  play that joins a drive pushes its close on). A spent fall is over on the screen and still holds its place in the stack.
- **An ended play can still draw.** A post's effects are handed every held play that was not caught, ended by an admin,
  untaken or face down, and each effect judges its own end (`engine/ui/cards/Effects.tsx`). Whodunnit? draws its "wore off"
  line from a play whose time is up; Steel Chair drops its dent.
- **A sprung back is a kind of its own on the screen** (`isBack`, `engine/ui/cards/plays.ts`): each is its own mark and
  Lens tab, named for the card it became. A much-quoted post holds one for every spring it ever had.
- **Draw only grows.** `react` is the one writer of `reaction_tallies` and only adds; no thread is deleted. No play's tally
  is withheld from any reader: a totals veil is on a post, never on a play. The post's own tally is the one total that can
  be withheld (`my_totals_withheld`).
- **The Who rows have a design of their own** (`docs/plans/2026-11-20-lens-who-rows-design.md`, #873, not built): Who splits
  into Up now and Ended, and the foot of Ended is where this design's pager stands.

## 1. What a page reads for a post (decided: in force, stand-ins and counts, as post-layers)

For each post a page shows, and for a spun thread's ORIGIN box alike, the page reads:

1. **Every play that holds a place.** A `card` Act whose target is the post, at any reach, that is not caught, not instant,
   not ended (an admin's end, a refund, a pierce spent), and whose time is ahead or unset; for a drive card, only while its
   drive is open; and a `set` whose back is live (its time ahead, not sprung, not taken back). For plays at post reach this
   is the set `place_cast` counts as up, and a test holds the two equal. It is bounded by the instance's stacks, never by
   the post's age.
2. **Two stand-ins for each kind:** its newest play and its most-drawn play (public reaction sums plus threads spun, ties
   to the newest), each a full Act with the Acts that end or spring it, whether it is over or not.
3. **A count for each kind:** how many plays of it the post has had, and how many took.

A kind is a card's key. Every card back is one kind to the server, and it never names the card a back hides.

**An ended play draws only as its kind's newest.** What an effect leaves after its end (Whodunnit?'s line) is drawn from the
kind's newest play, which the page always holds. A card that leaves something after its end leaves it once, for its newest
play.

**Card backs (decided: two on the page, the rest paged).** The page carries the live back, the newest sprung back and the
most-drawn sprung back, each drawn as its own mark as today. Earlier sprung backs are paged from the newest sprung back's
Lens tab (section 3). A back that ran out or was taken back unsprung is drawn nowhere, as today (`shownPlays`), and is
neither sent nor counted. Weighed: no pager for backs (the one kind whose history a post could not show), and every sprung
back kept on the page (the read grows with every spring).

**The ORIGIN box** reads the same set. Its `more` flag and its "More than 20 cards" note go: the counts say more than they
did.

**Amended 2026-11-22 (the owner's answer to #993).** A sprung back that #984 keeps up now while its lockout is live is carried too: `play_post.lock_until` holds the lockout's end, and the page reads a post's sprung backs whose lockout is ahead. The back stays over for the stack, the limit and the counts.

Weighed, from the two designs: everything with no cap (a page costs the history of every famous post on it); the newest N
(a Whoops! of three years ago that is still inked falls out); post-effects' in force plus the newest 8 ended (the marks
miscount, a kind leaves the post, and the most-drawn play of a kind is lost, so billing changes as plays end).

Why the stand-ins are enough is post-layers' argument and stands: a kind takes the place of its first billed play
(`kindsOf`, `engine/ui/cards/marks.ts`), billing is most drawn first and then newest (`engine/ui/cards/billing.ts`), and a
kind's first billed play over its whole history is one of its plays in force or its most-drawn play. A kind is spent when
every play of it is over (`kindSpent`), and every play not over is in force and held, so spent is judged the same.

## 2. Kept rows, held to the Acts by a check (decided: kept rows, parity-checked)

The owner chose kept rows over post-layers' computed read (which the owner had agreed to there, before its cost was weighed
against 0372's row bound) and over a split that kept only the plays in force and the counts.

- **`play_post`**: one row for each `card` or `set` Act that targets a post. It holds the post, the kind, when it was
  played, its end by time (`ends_at`: the play's own `ends`, a back's time, a drive play's close), the moment an event
  ended it (`over_at`: caught or instant at its landing, an admin's end, a refund, the cast that spent it, a spring, a take
  back), whether it took, whether a back sprang, and how much it has drawn. A play is in force while `over_at` is null and
  `ends_at` is null or ahead.
- **`post_kinds`**: one row for each post and kind, with how many plays it has had and how many took.
- **They are a play's state, not the play.** No Act is touched ("Append-only").

**One definition.** A single SQL function, `play_row(play)`, computes a play's row from the Acts and the rows beside them,
reading `card_ended` and the other predicates the rules already use. The triggers hold no rule: each only names the play an
insert touched (the play itself; the play a `card_end` targets; the back a `spring` or `take_back` names; the play a refund
names; the pierce play a cast spends; the plays of the drive a new play joins) and calls one `refresh_play_post(play)`,
which writes `play_row`'s answer and moves the kind's counts by the difference. A new way a play ends changes `play_row`
and adds one line that names the play touched.

**The check.** `play_post_drift()` lists every kept row that differs from `play_row`, every play with no row, and every
`post_kinds` row that differs from a count of `play_post`. It is the guard against a missed writer:

- its SQL test ends a play in each way there is and asserts no drift, then plants a miss (an end written with the triggers
  off) and shows the same assertion go red;
- it runs after the end-to-end files, over everything they committed, so a feature that adds an ender and exercises it
  anywhere fails the build until `play_row` and the triggers know it;
- the rehearsal asserts it where a run ends;
- an import refuses a database that drifts;
- it is a function, so an admin can ask a deployed instance.

**Draw.** A play's `drawn` is the sum of its public tallies plus the threads spun from it. A trigger on `reaction_tallies`
and one on `threads` add to it; both only grow. The post's own tally is never read into it.

**Export.** The two tables are exported and imported as every table is (`tools/export-instance.mjs`), so an import writes
them as they were and its last step is the drift check.

**At a busy instance's scale.** A page reads, for each post, one probe for the plays in force and two for each kind the
post has had: bounded by the instance's stacks and its number of cards, at any age of the post. A test in 0372's form holds
it to a row bound on a post of 5,000 plays, and goes red with an index withheld. What it costs to write: each play and each
end writes one more row and moves one counter, and each reaction to a play (never to a post) updates one more row and one
index entry.

Weighed: computed on read (no second copy and nothing to drift, but every view of a famous post reads its whole history and
a tally for each play); the split (no triggers on reactions or spins, but the most expensive part of the read still grows
with history); post-effects' triggers that each carried a rule (already missing pierce).

## 3. The Lens's Who pages a kind's older plays (decided: by kind, newest first, on a press)

Post-layers' pager, in the place the Who-rows design left for it: the foot of the Ended group. This plan is built after
that one.

- While a kind's count is more than the rows the Lens holds, the Ended group ends with **Show older plays (N more)**. A
  press reads the kind's next 20 ended plays, newest first, by a cursor on (date, id), with their ends, public tallies,
  spun threads, casters and the reader's own reactions, so a paged row folds, unfolds, reacts and spins as any ended row
  does. When none are left the button is gone.
- "Ended · N" and the mark's ×N read the kind's count, not the rows held.
- A page's rows keep the order they came in and are never re-sorted into billing order, so the list does not move under
  the reader. Focus moves to the first new row.
- **Card backs.** The newest sprung back's tab is where earlier sprung backs page in, as ended rows that each name the card
  the back became.
- A read that fails leaves the rows and says so on the button, which reads again when pressed.

The Lens is the glass: these words are plain and out of character.

Weighed: post-effects' one pager for the whole post by end date (tabs appear as pages land, and its rows carried no tallies
or casters, so they could not react or spin); the whole history at the first unfold; an infinite scroll inside the Lens.

## 4. The limit (decided in post-effects; carried, with corrections)

**A post holds at most `postEffects` drawing effects in force.** An engine rule; the number is the instance's. What the
owner decided there stands:

- **What counts:** on the post itself, a play in force of a card whose rules say it draws (`CardRules.drawsEffect`) unless
  it is cleared, and a live card back whatever it hides. A mark-only card, a play that is over, and every effect falling
  from the post's character, thread or board do not count.
- **Cleared plays count as they draw now.** A play that un-clears on a full post draws over the limit and is never refused
  after the fact; the overshoot is bounded by the cards' stacks.
- **Backs hold a slot alike,** so the count proves nothing about a hidden card. A Set is refused on a full post. A Move
  springs onto a quoting post only where it has room there, as it already must have room in its card's stack, and
  otherwise leaves its back set.
- **The number:** `Settings.postEffects`, whole, 1 to 16, tuned in the running instance. Divided World ships 8. Lowering it
  refuses new plays on posts above it and changes nothing on them.
- **Where it is held:** the engine's decisions (`decidePlay`, `decideUse`, `decideSet`), so the act function, the play
  form, the ghost marks and the Mod Bots' pool all hold it; and the database, under the lock `place_cast` and `place_set`
  already take on the post, so two plays racing for the last slot cannot both land. The Mod Bots' offer leaves drawing
  cards out when the post it would quote is full.
- **What the player sees:** nothing until a post is full. Then a drawing card's ghost mark is not drawn and the play form
  says why, in the words the server refuses with: "This post already shows 8 effects, the most it takes. A slot opens when
  one ends, is ended by an admin, or its author clears it."

The weighed alternatives for each are in post-effects' section 3 and are not repeated. What changes:

- **The count reads the kept rows.** `post_effects_up(post)` counts the post's `play_post` rows in force at post reach
  whose kind draws and is not cleared, and its live back. Post-effects' own `play_post` and its ended-play triggers go.
- **Fifteen cards draw.** Kick Me, a Use on a post with an `Effect`, was missing from the list.
- **You Were Saying can be cleared.** Its saved state is the version of the post its author erased the tail for, and an
  edit brings the tail back with no save. So a card's `cleared` answers yes, no, or "for this version of the post", and the
  count compares that version with the post's current one. Whoops! and Autocorrect answer from `clean` as before. This
  settles post-effects' first open question for the three cards that can be cleared today.
- **Names.** `CardRules.draws` already means what the server draws one of at each play (Jimmy Wails), so the declaration is
  `drawsEffect` and the rules' view of a post carries `drawing` and `cleared`.

## 5. What goes

- `thread_page`'s "oldest 8" (`on_posts`) and its ORIGIN box's "oldest 20" and `more`.
- `PLAYS_PER_POST`, `CARDS_SHOWN`, `cardsOn` and `cardsOnMany`, and with them the fake's page-wide share and the three
  client re-reads that took eight.
- Post-effects' "Show earlier plays" and `ENDED_PER_POST`; post-layers' read computed over a post's history and its gate.

## 6. The masks

- **Kinds, counts and draw are public.** A count is of public Acts by their public kind. A back counts as a back: its kind
  never names its card, on the page, in a count or in a Who page. Draw is public sums and public threads; nothing reads who
  reacted, and the post's own tally, the one total a reader can be barred from, is never mixed into a play's draw or
  compared on the server.
- **The limit** counts public plays and backs alike. A refusal's words and timing are the same for every caster. Whether a
  Move springs onto a full post depends on whether its card draws, which is the same kind of fact the stack's room test at
  a spring already shows, and no more.
- **A Who page is the same for every caller** but for the caller's own reactions, which are theirs alone. Its cost depends
  on the post and the kind, never on who owns a play.
- **The kept tables are read by no one.** They grant nothing to `anon` or `authenticated`; the functions that read them
  return Acts from `acts_public`, so concealment holds as in `thread_page`.

## 7. Ways out

One state is added: a full post. The post and its words are untouched, and the refusal names how a slot opens (a play's
time, an admin's end, its author's clearing). A play that un-clears over the limit is a post drawing one more, and ends as
that play ends. A Who page that fails says so and reads again on a press.

## 8. The layers

Engine: the two tables, `play_row`, the drift check, the reads, the pager, the limit, its setting and bounds, `drawsEffect`
and the refusal's words. The SQL knows no card's key. Instance: which cards declare `drawsEffect` and their `cleared`
answers (Whoops!, Autocorrect, You Were Saying), and the number 8 in Divided World's settings. `drawsEffect` (rules) and
`Effect` (screens) say one thing in two layers that cannot import each other, and `instanceUiProblems` holds them equal
both ways.

## 9. Open

- Whether the ORIGIN box, which draws a play's moment, should mark plays as of that moment and not as of now. It marks them
  as of now today, and this design keeps that.
- What #317's measurements show once a post is bounded at 8 drawing effects. That issue is unchanged by this design.
- The screen caps a play's spun threads at 200 when it bills (`SPUN_FROM_MAX`); the kept `drawn` does not. Past 200 spins
  on one play the server's most-drawn pick and the screen's billing could differ. Left as it is.
- A spent fall holds its place in the stack and is over on the screen. This design keeps both and sends it as in force.
