# Forum load: a click is one request and one whole page

Record, written 2026-11-05. A design session with the owner, after a spike they asked for in these words: "Pieces load
in asynchronously in the '03 forum screen, which makes sense since it's a react app, but breaks the illusion a bit.
Would be nice if we could have each screen pop in the whole thing at once"; "Navigating the forum is not as snappy as a
real php forum would be"; and "A loading indicator in the forum world would be good too; I think something deliberately
classic in the realm of an IE6 loading bar would be nice." In the session they set the aim: "we'll just simulate the
experience of using an old browser on one of those old PHP forums as much as possible." The spike's measurements are
`docs/research/2026-11-05-forum-load/README.md`; the plan that carries this design out is
`docs/plans/2026-11-05-forum-load-plan.md`.

World: the board (the 2003 house style) for everything a player sees here: the meter, the address text and the two
error pages (`docs/plans/2026-10-29-two-worlds-design.md`). The glass gains no visible change in this design.

## 0. Where it starts

Read from the code on 2026-11-05 (`main` at ef1a3d1):

- Each screen mounts, then reads its own data in an effect (`engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`,
  `engine/ui/thread/Thread.tsx`, `engine/ui/profile/Profile.tsx`, `engine/ui/profile/Record.tsx`). The router
  (`engine/ui/router.tsx`) changes the location at once, so the old screen unmounts at the click and the page is blank
  until the new one has read.
- Those reads depend on each other: a move to a thread is six waves of requests in a row before it draws (the session,
  the thread, its Acts, their authors' postbits, the plays, the tallies), and a move to a board is five. One whole wave
  is `useSignedIn` (`engine/ui/mini.tsx`) asking the server whether the reader is signed in, which `PlayerProvider`
  (`engine/ui/player.tsx`) already knows.
- The frame's board links (`engine/ui/frame/Frame.tsx`), the HUD (`engine/ui/frame/Hud.tsx`), the player's rows
  (`engine/ui/player.tsx`), tips, the settlement and welcome checks, presence and Follow each read for themselves, so
  a first load lands in seven or eight bursts. `preferences` is read five times on a first load.
- The script is one 1.2 MB chunk (366 KB gzipped).
- Loading writes nothing: a thread's views are counted from `mark_read` (`supabase/migrations/0023_views.sql`), not
  from a read. Presence is the one exception: `here` (`supabase/migrations/0084_staff_presence.sql`) marks the caller's
  mask and answers the box in one call.

## 1. How a click waits: route loaders

**Decided** (the owner chose route loaders). A route may declare a loader that returns everything its screen draws.
On a click the router starts the load and leaves the page as it is: the old screen stays mounted, drawn and clickable.
When the load lands, the address, the screen and the frame change together. A second click while a load is out cancels
the first and loads the second, as a 2003 browser did. Escape cancels a pending load and leaves the old page, as
IE's Stop did. A route with no loader renders as it does today, so the glass routes are untouched.

A route also says which part of its address names its document (its key). A move that keeps the key (a thread's
`#post-142` on a page already shown) is the screen's own, as today, and the screen can still run the meter for a read it
makes (the thread's next page, a gap of missed posts).

Weighed: React Suspense with `startTransition`, which keeps the old UI on screen too but leaves loading, cancelling and
progress implicit in React and needs a boundary in every screen and test, and is awkward across the board and glass
shells; and rendering the next screen hidden until every piece says it is ready, which is the smallest change but
breaks quietly the first time a piece forgets to report.

## 2. One request per screen

**Decided** (the owner chose a Postgres function per screen). `index_page()`, `board_page(slug, page)`,
`thread_page(thread, page, seq, per_page, effect_cards)`, `profile_page(character)` and `record_page(character, kind, page)` each
return one JSON document holding what today's chain of reads returns for that screen. The chain runs inside the
database, where each step costs milliseconds rather than a round trip. `thread_page` is also the read for a thread's next
page and for a gap's missing posts, so those are one request too.

How they stay inside the rules:

- **Plain SQL** ("Portable by construction"): `language sql` with a SQL-standard body (`begin atomic ... end`), so
  Postgres records every view and function a body reads.
- **As the caller**: each is `security invoker` and `stable`, so it sees exactly what the same reads from the browser
  see. Today's public reads are views that run as their owner and filter for themselves, over tables with row-level
  security, and an invoker function reading them is the browser reading them. A definer function, the repository's
  usual shape for an rpc, would skip the row-level security on the tables a screen reads directly (`reading`,
  `account_preferences`, `character_profiles`), so it is refused for these.
- **The same list of reads**: a test reads each screen function's recorded dependencies and fails unless every view
  and function it names is in `tools/check-web-reads.mjs`'s `ALLOWED_READS` or `ALLOWED_RPCS`, the list the browser is
  held to. One list ("Two lists that must agree are one list"). The test plants a function that reads a private table,
  one that is a definer and one in plpgsql, and is red on each ("A guard that has never been red is not known to work").
- **Bounded**: every piece is the shape the adapter reads today, by the same indexes, bounded by a page (a page of posts,
  a board's page of threads, a profile's rows), so a document's cost does not grow with the instance ("Weigh a design at
  the scale of a busy instance").

Weighed: loaders over today's calls, with no SQL, which gives the whole-page swap but keeps five or six round trips a
click; and an edge function per screen, which is one round trip from the browser but a trip per step from the function
to the database, with cold starts, and is less portable than SQL.

## 3. Boot: the frame and the HUD arrive with the page

**Decided** (the owner chose one boot document). On a first load `boot()` returns the instance's settings, the account,
its preferences, its characters (with the public face and profile of each, for the HUD), its wallet and hand, the
boards, unread alerts, the next settlement, and what the settlement and welcome checks need. It runs alongside the
first screen's load, and the page draws once, frame, HUD and screen together. Later clicks reuse what boot brought; the
Realtime events and the refreshes that exist today keep it current. The reads the HUD makes on every move (the unread
count) ride in each screen document instead, so the bell is as fresh as the page.

The estimate is an edge function, not SQL. **Decided** (the session's call, confirmed by the owner): the first paint
waits for it alongside boot for a short bound, then draws the HUD without it, and it fills in when it lands.

Weighed: the frame and HUD inside every screen document, always fresh but read again on every click; and leaving them
as they are, which keeps the first load's pop-in.

## 4. Loading never writes; presence arrives with the page

A load counts no view, marks nothing read and records no presence. That is what makes a load started on hover safe: a
hover is not a visit. `mark_read` and the presence heartbeat start when the page lands, as they do today when a screen
mounts.

**Decided** (the session's call, confirmed by the owner): the thread's and the board's documents carry a read-only
snapshot of the presence box. `here` is split into the mark and `presence_box(kind, place)`, the box alone, which
`here` returns after marking; the screen functions call `presence_box`. On landing the screen adds the reader's own HUD
mask to the snapshot on their own screen, at the end of the names or in the "and N others" count as the box's cap says,
unless that mask's presence is hidden or it is already listed, and starts the heartbeat, whose answers replace the
snapshot. "Users browsing this thread" is on the page when the page lands.

## 5. Starting early: hover, focus, press

**Decided** (the owner chose hover dwell and press). A link's load starts once the pointer has rested on it for about
100 ms, on keyboard focus, or at the latest on mouse-down or touch-start. The answer is kept about 30 seconds for the
click; a pointer sweeping across a list starts nothing. On a busy instance that is about one extra request per link a
reader really considers, each a bounded screen document.

Weighed: press only (no wasted request, less of the wait hidden), and none.

## 6. Back and Forward

**Decided** (the owner chose cached if recent). Back or Forward to a page left less than five minutes ago redraws its
document from memory at once, scrolled where the reader was, and the screen's live channels catch up from there. An
older entry loads like a click, with the meter. The cache is memory only, holds at most twenty entries, and is emptied
when the account changes; a browser reload always reads again. Scroll restoration becomes the router's own, since the
browser's would run before the page it restores is drawn.

Weighed: always reloading, which is never stale but slower than a 2003 browser's Back; and a cached page refreshed in
the background, which replaces the page under the reader, the pop-in this design removes.

## 7. The meter, the address and the cursor

**Decided** (the owner chose the banner placement, from the spike's mock `docs/research/2026-11-05-forum-load/loading-bar.html`,
placement B). Beside the banner's "dw.gripe", a small sunken well of navy blocks, the IE6 status bar's progress meter:

- It trickles toward 90% while a load is out, fills when the page lands, stays full for a moment (IE's "Done"), then
  empties. With one request per screen there is no truer measure to show; it never claims a page is loading when none
  is, and that is all it must be honest about.
- When the answer was already there (a hover's load, or the cache), the page swaps at once and the meter only flashes
  full. No delay is added for show (the session's call, confirmed by the owner).
- While a load is out the banner's address reads "Opening dw.gripe/t/3f2a9c1e…": the address clicked, with each long
  id cut to its first eight characters and an ellipsis, and the whole cut with an ellipsis where the banner is narrow.
  It names only the address, never which mask the reader plays.
- While a load is out the pointer over the page is the "working in background" cursor (`cursor: progress`); links stay
  clickable.
- For accessibility the meter is a `progressbar` with its value, the page is `aria-busy` while it loads, and a polite
  status says when it has loaded. With reduced motion the meter moves in steps with no march. Loading is no game
  obstacle, so "An accessible path costs what the obstacle costs" asks nothing more.

Deferred, by the owner's word: the navigation click sound, which belongs with gameplay audio and its settings, on its
idea board (#240).

## 8. When a page cannot be shown

**Decided** (the owner chose the error page, and asked that it be "a clear reference to the IE6 one, with an equivalent
'the page cannot be found' for 404s"). In the board's frame, laid out as IE6's error pages were (a heading, a rule, the
reasons, "Please try the following:" and a list, a gray footer line), in our own words and with no Microsoft name, logo
or icon:

- **The page cannot be displayed**: a load that failed after the adapter's one retry, or that ran past 20 seconds. Its
  ways out: Try again (loads the same address), Back to the index, and the browser's Back, which the cache answers.
- **The page cannot be found**: a thread, board or character that does not exist (or is not shown, as an undebuted
  character is not today), and an address no route matches. Its ways out: Back to the index and the browser's Back.

The address stays the one the reader asked for, as a browser's did. Both are out of character and say plainly what
happened ("The fiction may lie; the log never does"). Whether a thread, board or character "cannot be found" is decided
by the same public views as today, so the page proves nothing private.

## 9. Scope

**Decided** (the owner chose every board-world route): `/`, `/b/:slug`, `/t/:thread`, `/c/:id` and `/c/:id/record`
get loaders and screen documents in this plan. The glass routes keep today's behavior and share boot; their loaders,
and how the glass shows loading, are a later plan, after the glass work under way, so as not to collide with it. The
router, the cache, boot and the screen-function pattern are built for every route, so that plan adds screens, not
machinery. Signed out, a board route draws the front door or the sign-in line as today, with no screen function
called; the screen functions are granted to `authenticated` alone.

Also in this plan, because they are on the same path: `useSignedIn` reads the player's session; and the script is split
so the glass pages, the admin queue, the vending machine and the card effects load on demand.

## 10. The masks

Every response this design adds, and why none is computed from a private fact:

- The screen documents hold the same projections today's reads return, read through the same views as the caller, and
  the dependency test holds them to the browser's list. The caller's own rows in them (`my_reactions`, `my_face_down`,
  `reading`, the unread count, the releases) are the caller's own, as today.
- `presence_box` answers what `here` answers today, from `presence_listed`, which is computed from public facts
  (`supabase/migrations/0084_staff_presence.sql`'s header). Adding the reader's own mask happens on their screen only.
- `boot()` holds the caller's own account, preferences, characters, wallet and hand, and public facts.
- Timing: a document's time depends on the page's size and the caller's own rows, never on who owns another mask. The
  meter's progress is synthetic, from the clock alone. A hover's load is the reader's own request.
- A missing thread, board or character is "cannot be found" by the same public views as today.

## 11. Ways out

- A pending load ends when it lands, when it fails (the cannot-be-displayed page), at 20 seconds (the same page), when
  the reader clicks another link (that one loads), or on Escape (the old page stays).
- The two error pages each name their ways out (section 8).
- No state is added to a player, a character or a post.

## 12. Layers

All of it is engine: the router, the loaders, the cache, boot, the meter, the error pages, and the SQL. The banner's
address text reads the site's own host from the browser, and the error pages name the instance through
`ui.copy.siteName`; no interface is added and no instance file changes.

## 13. Open

- Measuring production before and after, with a trace switch in the Supabase adapter, was raised in the spike and not
  taken up here; a later session may add it.
- The glass's loaders and its own way of showing loading (section 9).
