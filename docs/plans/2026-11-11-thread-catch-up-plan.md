# Thread catch-up: plan

Record, written 2026-11-11. A bug fix built straight from its issue, at the owner's word, with no design session: two
checklist lines of issue #271 that name one defect, "F3: after a drawn page, only posts are caught up" and "Card plays
can be missed between the page read and the subscription". The other lines of #271 are left alone. Built in one PR
from `main`.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no new
check needs a poison. No migration, no new server read and no new RPC: the fix reads `thread_page`, the read the
screen already makes. No deployed database, bucket or connector is touched.

## The bug

A thread screen is drawn from a document (`thread_page`, read by the router), and only then opens its live channels
(`subscribeThread`, `subscribeReach`). Whatever lands between the server's read and the channel being joined is in
neither. `engine/ui/thread/Thread.tsx` has one catch-up for that window: it reads the thread's summary and, where
`lastSeq` has moved past what the document knew, reads the pages beyond. So only Acts that take a `seq` are caught
up. A card play, a card set face down, a spring, a `card_end`, an edit, a tally, a saved effect state and a play
beyond a post take no `seq` and move nothing in the summary (`acts_take_seq`, 0148), so each waits for a reload.

The window is not small. The router keeps a prefetched document for 30 seconds and a Back entry for 5 minutes
(`engine/ui/router.tsx`, `PREFETCH_KEPT_MS`, `ENTRY_KEPT_MS`), and the forum-load design
(`docs/plans/2026-11-05-forum-load-design.md`, section 6) says of a document redrawn from memory that "the screen's
live channels catch up from there". They do not, beyond posts.

## The root cause

Two things, both confirmed on `main` at 9210b06c.

1. **The catch-up asks the wrong question.** It asks "did `lastSeq` move?", which only a placed Act answers. Nothing
   the summary carries moves for an unplaced Act, a tally or a saved state, so no cheap check can find them.
2. **The catch-up does not know when the channel is joined.** `subscribeThread` returns at once; the real adapter
   (`web/src/data/supabase.ts`, `join`) then reads the session, authorizes and subscribes, and tells nobody when the
   channel is joined. The catch-up fires from an effect on mount, so on the real backend it can read before the
   channel hears anything, and an Act that lands between that read and the join is lost as before. The fake
   (`engine/ui/data/fake.ts`) hears from the moment `subscribeThread` returns, so it has never shown this: the fake
   and the real one disagree.

## The fix

**The catch-up reads again the pages the screen draws, once its channels are joined.** `thread_page` is, by
construction, everything a thread page draws: the posts with their current words, the plays on them with their ends,
the plays above them, the card backs, the saved states, the tallies, the visits. `absorb` already takes a page into
the stores, and every store merge is idempotent (`plays.add`, `plays.setStates`, `tallies.merge`, `mine.merge`). So
reading the drawn pages again after the join catches up every kind the page draws, and a kind added to the page later
(the card notes' Parts 2 to 6 name `thread_page`) is caught up with no change here. An Act kind the page does not
draw is not this fix's: `take_back` (0148) is in no page read and no door calls it yet, so the day it is drawn it
joins `thread_page` and is caught up with the rest.

What a page read cannot say by presence, it says by absence: a play above the posts (a thread's, a board's, a
character's) that an admin ended, or that left with a thread's move, is no longer in the page's `above`, and no
`card_end` comes with it. The screen remembers which plays each page's `above` held; one that a later read of the
same page no longer holds is marked ended in the plays store.

**A listener is told when its channel is joined.** `ThreadListener` and `ReachListener` gain `onJoined`, called when
the channel is joined and again each time it rejoins after a drop. The catch-up runs on it, so a dropped connection
is caught up by the same path as a fresh page: what was missed while not joined is one defect, whichever way the
channel came to be not joined. The fake gains the same moment: a listener hears nothing until it is joined, as in
Realtime, and a test can hold the join.

**Considered and not built:** a read of "what changed since T". It needs a server clock in the document, a new index
on `acts (thread, created_at)` and a new screen function, and it still could not answer for tallies and saved
states, which are not Acts. The page read answers for all of them and is already there.

**At a busy instance's scale.** The catch-up is one `thread_page` per drawn page per join, in place of today's one
`thread_open` per mount: the same number of requests on opening a thread, each heavier. `thread_page` is bounded by
the page, not the thread or the instance (at most 100 posts, 8 plays a post, 200 spun threads, and index probes for
each), so a thread view costs two bounded page reads whatever the instance holds. A reader who has continued through
n pages and then drops and rejoins reads n pages, one at a time, never in parallel; n is the pages that reader chose
to load. Catch-ups never stack: one runs at a time, and a join that arrives during a run asks for one more run after
it, however many arrive. A read that fails is asked again twice, at the gap read's pace (`GAP_FILL_MS`, doubling),
then left: a reload or the next join reads it.

**No private fact.** The catch-up is the reader's own `thread_page`, the security-invoker read the document came
from, sent for every reader alike once their channel joins. No payload, event or delay is added on the server, and
when the read is sent depends on nothing but the reader's own channel.

**The meter.** The read of pages already drawn is quiet (not on the router's meter): the reader asked for nothing.
A read of pages beyond the drawn tail, for posts that landed in the window, stays on the meter as it is today.

## Task 1. A listener knows when its channel is joined

Model: sonnet

**Files:** `engine/ui/data/api.ts` (`ThreadListener`, `ReachListener`), `web/src/data/supabase.ts` (`join`,
`subscribeThread`, `subscribeReach`), `web/src/data/supabase.test.tsx`, `engine/ui/data/fake.ts`
(`subscribeThread`, `subscribeReach`, `send`'s deliveries to them, `broadcast`), `engine/ui/data/fake.test.ts` (or
the fake's existing test file).

- `ThreadListener.onJoined?: () => void` and `ReachListener.onJoined?: () => void`, documented: the channel is
  joined and events are heard from now; called again each time the channel rejoins after a drop; what landed while it
  was not joined is the listener's to read.
- Real: `join` takes an optional `joined` callback per listener. The topic remembers whether it is joined
  (`channel.subscribe((status) => …)`: `SUBSCRIBED` sets it and calls every listener's callback; any other status
  clears it). A listener added to a topic already joined is called in a microtask, if still listening.
  `subscribeThread` and `subscribeReach` pass `l.onJoined`. The other topics pass nothing and behave as before.
- Fake: a thread or reach listener is joined in a microtask after it subscribes, and `onJoined` is called then, if it
  is still subscribed. An event is delivered only to listeners that are joined. `fake.broadcast.holdJoins()` keeps new
  listeners unjoined until `fake.broadcast.join()`, which joins them (and calls `onJoined`); `fake.broadcast.rejoin()`
  calls `onJoined` again on every joined thread and reach listener, as a rejoin after a drop does.

**Tests first** (red runs recorded):

- `supabase.test.tsx`: `onJoined` is not called before the channel reports `SUBSCRIBED`, is called when it does, and
  again on a second `SUBSCRIBED`; a second listener on a joined topic is told in a microtask; a listener that left is
  not told. The same for `subscribeReach`.
- The fake's tests: an event sent while joins are held reaches no listener; after `join()` the listener has had
  `onJoined` and hears the next event; `rejoin()` calls `onJoined` again; an unsubscribed listener is never told.

## Task 2. The catch-up reads the drawn pages again

Model: sonnet

**Depends on:** Task 1.

**Files:** `engine/ui/thread/Thread.tsx`, `engine/ui/thread/Thread.test.tsx`, `engine/ui/cards/plays.ts`
(`setEnded`), `engine/ui/cards/plays.test.ts`, and a test helper where the existing ones need the join
(`engine/ui/test-world.tsx`).

- `plays.setEnded(plays: readonly Id[]): boolean`: marks each play reversed in place, as its `card_end` would
  (one not yet held is remembered as ended, as an early `card_end` is); true when anything changed.
- `absorb` remembers, per page number, the ids of the plays in that page's `above`. When a page absorbed before is
  absorbed again, the ids it held and no longer holds go to `plays.setEnded`.
- The catch-up effect is replaced. It runs when both the thread channel and the reach channel have reported
  `onJoined`, and again on any later `onJoined` of either. One run:
  1. for each page from `firstPage` to `lastPage` as the feed stands, `api.threadPage(thread, { page }, P,
     effectList)` with no meter, then `absorb`; each Act of the page that is shown or held goes through
     `dispatch({ type: 'live', act })` (an edit is the newer version, by `newer`); the rest go through
     `dispatch({ type: 'fill', acts })` if the tail is loaded;
  2. if the tail is loaded and the last read's `thread.lastSeq` lies beyond the last drawn page, the pages beyond are
     read as today (`readPage({ seq })`, on the meter) and filled;
  3. a page that is not the tail still gets step 1 (its posts' plays, edits and tallies) and never step 2 (what lies
     beyond it comes from its own next-page read, as today).
  One run at a time; a join during a run asks for exactly one more. A failed read is asked again twice at
  `GAP_FILL_MS`, doubling, then left. Nothing is dispatched after the screen is gone.
- `api.thread` is no longer called by the catch-up: the summary comes with the page.
- The comment above the effect is rewritten to say what is caught up and why, and the note that a tally "is not
  re-read here" goes, since it now is.

**Tests first** (red runs recorded), in `Thread.test.tsx`, each built on the existing `landed(w, at, allowed,
between)` helper, whose `between` writes with the fake's muted seeds or with a real write that nobody hears:

- a card played on a shown post in the window shows its mark with no later live event;
- a card set face down in the window shows its back; one sprung in the window shows revealed;
- a play on a shown post ended by an admin in the window (`card_end`) is drawn ended;
- a post edited in the window shows its new words;
- a reaction made in the window shows in the tally;
- a saved effect state written in the window is the state shown;
- a play beyond a post (thread reach) made in the window is drawn, and one in the document that was ended in the
  window is no longer drawn;
- the same card play on a page that is not the last is caught up, and no page beyond it is read;
- the post catch-up still holds (the existing tests at "a post written after the server read the document…"),
  adapted to the page read: a post in the window is held behind the bar;
- with joins held (`holdJoins`), nothing is read until the join; a card played after mount and before the join is
  caught up by the read the join starts (this is the case the fake could not show before);
- `rejoin()` reads the drawn pages again, and two rejoins during one run make one more run, not two;
- a catch-up read that fails is asked again and lands; after three failures nothing more is asked;
- the read count: a landed page makes exactly one `threadPage` call (the catch-up's) and no `thread` call, and the
  router's meter does not show for it.
- `plays.test.ts`: `setEnded` marks a held play reversed, remembers one not yet held, and reports whether anything
  changed.

Existing tests that count reads or hold them (`holdReads`, the "exactly 1 `threadPage` and 1 `thread`" test, the
live-channel test that expects one `threadPage({ seq: 46 })`) are changed to the new counts, each change named in the
report.

## Task 3. The window in a browser

Model: sonnet

**Depends on:** Task 2.

**Files:** `e2e/thread-catch-up.spec.ts` (new).

The e2e build runs on the fake (`playwright.config.ts`), driven through `globalThis.__kbFake`. Two cases, each red
on `main`:

- **A cached Back.** Open a thread, follow the link to its board, then through `page.evaluate` seed a card play on
  one of the thread's posts, an edit of another and a reaction (no listener is on the thread, so nothing is heard),
  and go Back. The document is drawn from memory; the card's mark, the new words and the tally show without a
  reload.
- **Between the read and the subscription.** With `fake.broadcast.holdJoins()` set before the click, open the
  thread, seed a card play on a shown post once the page is drawn, then `fake.broadcast.join()`: the mark shows
  without a reload.

## Review focus

- Every kind the thread page draws is caught up: read `thread_page`'s keys against `absorb` and the catch-up, and
  name any key whose change in the window would not reach the screen.
- The fake and the real adapter agree on the join: neither delivers to a listener before `onJoined`, both call it
  again on a rejoin, neither calls it for a listener that left.
- Nothing stacks at a busy instance's scale: one catch-up at a time, pages read one after another, the retry
  bounded.
- A play marked ended by absence is never one still in force: the comparison is between two reads of the same page.
- The catch-up moves nothing the reader is looking at: no scroll, no focus change, no announcement of posts already
  announced, no meter.
