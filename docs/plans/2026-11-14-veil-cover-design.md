# The veil's cover is stored

Record, written 2026-11-14. The design session with the owner, after the release of
`docs/plans/2026-11-13-plan-once-design.md` (migration `0368_client_reads_plan_once.sql`) left thread pages on the
deployed instance as slow as before, with statement timeouts. Its plan is `docs/plans/2026-11-14-veil-cover-plan.md`.
Each decision below was asked one at a time and answered by the owner, except where a section says it is the session's
own choice. The owner confirmed the summary before the plan was written.

## 1. What was found

The owner attached the deployed instance's 5xx log (`/rpc/thread_page` and `/rpc/index_page` answering 500, Postgres
cancelling statements with 57014) and ran three read-only probes on the instance for the session. The rest was measured
by replaying every migration through 0368 on Postgres on localhost, 16.15 and 17.11, with a thread of the deployed
shape (33 posts, 34 card plays).

- **A kept plan lives and dies with its connection.** On a fresh connection thread_page's first call takes 250 to 550
  ms locally, the figure from before 0368; later calls on that connection take about 16 ms. The plan-once tests read the
  plan a connection's first call builds, never what that first call costs.
- **A cancelled call keeps nothing.** thread_page is one statement. Three calls cut off by a statement timeout while
  planning left the fourth as slow as the first.
- **On the instance** (the owner's probe: thread_page twice in one statement, as a signed-in account): first call 5,169
  ms, second 155 ms, with 0368 applied, 108 Acts, Postgres 17.11. A page load sends several reads at once, each on a
  connection of its own (the API holds 8), and a call that passes the caller's statement timeout is cancelled and
  leaves its connection cold.
- **One read of the view is not the cost.** On the instance `acts_public` read once plans in 22.5 ms, and `acts_base`
  (the same view without the veil) in 5.5 ms. thread_page reads the view about a dozen times in one statement and costs
  as much as 230 single reads there, against about 30 locally.
- **Not the Postgres version.** On 17.11 on localhost a cold thread_page takes about 310 ms, as on 16.
- **Planning the page is memory.** One cold thread_page takes a connection's resident memory from about 30 MB to a peak
  of about 190 MB; with `acts_public` as it was before `0357_post_veils.sql` the peak is about 95 MB. After five page
  reads (index, boot, board, thread, one direct read) a connection holds about 200 MB, 26 MB of it kept plans.
- **The instance has no memory to spare.** Its dashboard shows about 430 MB of RAM, about as much again in swap all
  day, and 1.36 GB committed (marked severe). A planning burst of 190 MB there has to push something to disk first.
  The graph is hourly and shows no step at the deploy of 0357, so it shows an instance at its limit, and does not by
  itself prove the timing.

So the regression is 0357's `acts_public`, as the plan-once design found, but what it costs the instance is the memory
its planning takes, on every connection's first call, and keeping plans does not remove a first call.

## 2. Where the fix goes: the veil's cover is stored (the owner's choice)

Measured on 17.11, thread_page planned again on a warm connection (`discard plans`), and the connection's peak
resident memory on a cold call:

| `acts_public` | planning | peak |
|---|---|---|
| today (0357) | 230 ms | 192 MB |
| the cover stored, live read from `post_veils_live` (chosen) | 130 ms | 118 MB |
| no veil at all (`acts_base`'s shape, before 0357) | 70 ms | 95 MB |
| the view as the bare table | 50 ms | 84 MB |

Weighed:
- **Store the cover** (chosen). A table holds one row for each Act a veil covers. `acts_public` keeps its two selects
  over `acts` in one appendrel (0357's header, "THE SHAPE IS THE POINT": a read by character stays an index read), and
  each select asks one question of the table where it asked about fourteen subqueries. Every reader of the view gains,
  the client's own selects included.
- **Pages read the view less.** thread_page and the other page reads rewritten to read `acts_public` once. The veil is
  untouched, but every page function is rewritten, the client's selects gain nothing, and the next change to the view
  brings the cost back. With the cover stored it is worth at most the gap between the chosen row and the bare table.
  Open (§7).
- **Both.** Not chosen: the second part's gain is small beside what it reopens.

The owner's concern, recorded: a drop from 260 ms to 120 ms locally would not be felt against load times over ten
seconds. The answer the measurements give is that the instance's multiple is not constant; it grows with the memory a
statement's planning takes, and the cover takes most of 0357's addition away. Before 0357 the instance planned this
page on every call and answered in about 250 ms.

## 3. Kept plans stay (the owner's choice)

Nothing in 0368 is reverted. Weighed: planning on every call again (no plan memory held between calls, every call the
same, about 250 ms on the instance before 0357), and keeping the plans with a check that bounds a cold call's memory or
planning work (not chosen; §7). What a kept plan costs is memory a connection holds, about 15 MB for five page types
with the cover stored: it grows with the page types a connection has served and is fixed by the number of page
functions, never by players or Acts. A warm connection answers in about 20 ms where planning takes 130.

## 4. How the cover knows a veil has ended: it asks `post_veils_live` (the owner's choice)

A cover row says which Act a veil play covers, and nothing about whether the veil is up. Whether it is live is read
from `post_veils_live`, as every other reader of a veil does (`author_veiled`, `shown_author`, the counts,
thread_page's `veiled`, `my_veiled_posts`), so there is one definition of live. Weighed:
- **A second insert-only table of ended veils**, written when an admin's end or a refund lands on a veil play, that
  `post_veils_live` reads in place of its search of `acts`: 112 ms and 108 MB, and every reader of a veil cheaper, but
  a second stored copy that must agree with the Acts.
- **Cover rows deleted when their veil ends early**: 105 ms and 103 MB, but the one place a veil's record is removed,
  and an end that is ever undone would have to write the rows again.

## 5. What a cover row is, and who writes it (the session's own choice, confirmed by the owner)

`post_veil_cover (act, play)`, insert-only by the append-only pair `post_veils` has, read by no API role. For an author
veil play V on post P whose author is A, the covered Acts are exactly those 0357's second select names:

1. P itself.
2. An Act of A's that targets P and is neither a post nor a spin (an edit, a set, a take-back, a use card, its spring).
3. A draw or a wash of A's whose target is a card that targets P.
4. A card in `post_veil_cards` for (P, A).

Rows are written in the transaction of the row that causes them, by three triggers, so no writer function is written
again:
- **on `post_veils`**, for an author veil: the rows of 1 to 4 for every Act that exists.
- **on `acts`**, for a new Act of kinds 2 and 3 whose character is the post's own: a row for each author veil on that
  post whose `ends_at` has not passed. Only the time is asked, never whether an admin ended the play: a row for an ended
  veil is read as not live, and nothing has to be written if an end is ever undone.
- **on `post_veil_cards`**: a row for each such veil on the card's post and author.

A veil landing and its author acting on the post at the same moment each cannot see the other's uncommitted row, and
`edit_post` takes no lock on the post. So the trigger on `post_veils` and the trigger on `acts` (only when the new
Act's character is the post's own) take one transaction-level advisory lock keyed on the post before they read, and
each reads after it has the lock. Weighed: a row lock on the post, which the lock order of 0357 (post, then
visits_open, then character) places before locks a writer already holds by the time its Act is inserted.

The migration fills the table for every author veil an instance holds whose time has not passed. Triggers on `acts`
already keep the counts and the quote references this way (`acts_count_character`, `acts_quote_refs`). The triggers are
not `enable always`, so an import, which writes as a replica, carries the exported rows and fires none.

## 6. What the change keeps

- **The projection.** `acts_public` answers the same rows and columns for every reader as today. A test holds it to
  0357's derivation, Act by Act (the plan, Task 1), and is driven red once with the trigger off.
- **Append-only.** The table is insert-only; nothing is edited or deleted, and no Act changes.
- **No player is ever stuck.** No state a player, a character or a post can be put in is added. A veil ends as it does
  today, at its time or at an admin's end, and the author is shown again by the same read with nothing written.
- **The masks.** The view asks nothing about who is reading. The trigger on `acts` does its extra read and insert only
  when the new Act's character is the character of the post it is on: a comparison of two characters, never of who
  owns one, and the one player who could time it is the one acting. The advisory lock is held by a veil's landing and
  by its author's own Acts on the post; another character's Act on the post never waits on it.
- **Scale.** An Act's insert gains one probe by key (the post it targets) and, for the post's own author, one probe of
  `post_veils_post`. The table grows with veils and with what an author does to a veiled post.
- **Layers.** All of it is engine; no instance content is involved and no interface changes.
- **Portable.** Plain SQL. The table is exported and imported with the others, and the round trip holds it.

## 7. Open

- **Pages reading the view once** (§2). Worth at most about 50 ms of planning and 25 MB locally once the cover is
  stored. A design of its own if the instance's figures after this lands ask for it.
- **A bound on a cold call** (§3): a check on Postgres 17 that fails when a page read's first call on a connection
  takes more than a set amount of memory or planning work. Not chosen now; it is the guard this regression did not
  have.
- **The instance's size.** At the level before 0357 an instance that lives in swap is still at its limit. Whether the
  deployed instance moves up a compute size is the owner's, outside this design.
- **Postgres on localhost is 16; the instance and CI run 17.** It made no difference to these measurements. The
  session measured on 17.11 from a binary of its own; the container could be moved to 17.
- **After this is deployed**, the owner's two probes say whether it worked: thread_page twice in one statement (first
  and second call), and the dashboard's memory graph. A build session touches no deployed database.
- **The API's pool.** How long the deployed API keeps an idle connection was not read (the session's query asked as a
  role that cannot see other sessions). It decides how often a call is a first call.
