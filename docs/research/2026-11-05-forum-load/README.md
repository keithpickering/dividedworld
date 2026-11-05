# Forum load performance: a spike

Record, written 2026-11-05. It surveys how the board pages (the "'03 forum" in the frame: index, board, thread) load
on `main` at ef1a3d1, and why a move between them is slower and choppier than a PHP forum's. It is input
for a design session, not a plan: no code in `engine/` or `web/` changed. The owner asked three things: that a screen
appear whole instead of in pieces, whether the slowness is the architecture or the server (Netlify, or Supabase on a
nano instance), and for a deliberately classic loading bar.

## What was measured, and how

The deployed site sits behind Netlify's password, and the Supabase connector in the spike's session reaches another
project, not Divided World's, so nothing here is read from production. Instead the dev app ran on the in-memory
backend with every `KayfaApi` call delayed by a fixed time standing for one round trip (`vite.spike.config.mjs` wraps
`createBackend()` in a proxy; `measure.cjs` drives Chromium and records each call's start and end, and each burst of
DOM changes). Every `KayfaApi` call on these screens is one HTTP request to PostgREST or more run together, so the
call trace is the request waterfall's shape. Its depth is what matters: the time a move takes is about the number of
waves of requests that wait on each other, times one round trip.

To rerun it: start `npx vite --config docs/research/2026-11-05-forum-load/vite.spike.config.mjs`, then
`node docs/research/2026-11-05-forum-load/measure.cjs 100` (the argument is the delay per call in ms).

## What a move does today (100 ms per call)

| Move | Calls | Waves before the page draws | First content | Last answer |
| --- | --- | --- | --- | --- |
| index → board | 10 | 5 (session · board · threads · pinned + effects above · reading + views + characters) | ~570 ms | ~670 ms |
| board → thread | 18 | 6 (session · thread · acts + reading + prefs + board · 5 postbit reads · plays · tallies + reactions + spins) | ~680 ms | ~785 ms |
| thread → index | 5 | 3 (session · boards · characters) | ~400 ms | ~500 ms |
| a cold load of a thread | 37 | 8, after the 1.2 MB script | — | ~1.8 s after the script runs |

`board-to-thread-filmstrip.png` is the board → thread move at 150 ms per call, frames at about 0.15, 0.37, 0.6, 1.04,
1.27 and 1.6 s. The old page is gone at once, the page is blank for about a second with no sign that anything is
happening, the thread lands, and "Users browsing this thread" and the follow button land a beat after it.

## Findings

**1. It is mostly the architecture.** A PHP forum is one round trip per page: the server runs its queries next to the
database and sends finished HTML. Here the browser is the one running the queries, and they depend on each other (the
thread's summary says which page of Acts to read, the Acts say whose postbits to read, the postbits and plays say which
tallies to read), so a thread is six round trips in a row before it can draw. Whatever one round trip costs, browser
to Supabase and back plus PostgREST and the query, a move costs about six of them. At a realistic 100 to 200 ms per wave
that is 0.6 to 1.2 s a move, where the same server could answer one request in 0.1 to 0.2 s.

**2. The nano instance multiplies it but is not the cause.** A nano has a shared CPU and a small connection pool, so
each wave is slower than it would be on a larger instance, and the cold load's widest wave (12 requests at once) is the
one most likely to queue. A bigger instance would make each of the six waves shorter; it would not make them fewer.
Netlify serves only the static files, which are cached immutably after the first visit, so it is in no move's path.

**3. One whole wave is a question every screen already knows the answer to.** Every board screen calls `useSignedIn`
(`engine/ui/mini.tsx`), which calls `api.session()`, which is `auth.getSession()` plus the `whoami` rpc: a full round
trip, on every move, before the screen asks for its own data. `PlayerProvider` (`engine/ui/player.tsx`) already holds
the session. Reading it from there removes one wave from every move, about a sixth of a thread move and a fifth of a
board move, with no design question attached.

**4. Pieces arrive separately because each component fetches for itself.** The thread screen already gathers its own
reads before drawing its posts (good), but the frame's links (`Frame.tsx`), the HUD's face and next settlement
(`Hud.tsx`), the player's characters, wallet and hand (`player.tsx`), tips, the settlement check, the welcome check and
presence each read on their own when they mount, so a cold load lands in 7 or 8 bursts. On a move between board pages
the frame stays mounted, so the burst count drops to 3 or 4, but the routed screen is unmounted the moment the address
changes, so the page goes blank first.

**5. The same data is read several times.** A cold load asks for `preferences` five times, `session` three times and
`boards` twice; the thread asks for `preferences` and `board` again on every move. None is cached between screens.

**6. A cold load also waits on a 1.2 MB script (366 KB gzipped), one chunk with every screen in it,** then on
`settings`, then on the session, before the first screen's reads begin. The glass pages, the admin queue, the vending
machine and the card effects could be split out of the first chunk.

## What would get to "one round trip, whole page"

In order of what each buys; the first is free, the rest want a design session.

1. **Drop the session wave.** `useSignedIn` reads `usePlayer().session` instead of asking the server. One fewer round
   trip on every move.
2. **Keep the old page until the new one is ready, then swap it whole.** This is what a 2003 browser did, and it is
   most of the illusion on its own: the forum never shows an empty page or a page in pieces, because the page you were
   on stays put (with the loading bar running) until the next one is complete. In React 19 that is a navigation
   wrapped in `startTransition`, with each screen reading its data through a promise it `use()`s inside a `Suspense`
   boundary: React keeps the old screen on display until the new one stops suspending. The frame, the HUD and the
   secondary pieces (presence, follow) would join the same boundary, or be read in the same request, so nothing
   lands a beat late. The router (`engine/ui/router.tsx`) and each board screen's load effect change shape for this.
3. **One request per screen.** A Postgres function per screen (`thread_page(thread, page)`, `board_page(slug, page)`,
   `index_page()`) that returns everything the screen draws as one JSON document: the summary, the Acts, the postbits,
   the plays, the tallies, the reader's own reactions. The dependency chain then runs inside the database, a few
   milliseconds per step instead of a round trip each. This is the change that makes a move one round trip, as a PHP
   forum's is, and it is where the nano stops mattering much. It stays inside the rules: plain SQL ("Portable by
   construction"); it must read the same public projections the adapter reads today, as `security invoker` so RLS
   still applies, with `tools/check-web-reads.mjs` extended to hold it ("A response never proves a private fact"); and
   each read inside it keeps the bounded, indexed shape the adapter's reads have now ("Weigh a design at the scale of a
   busy instance"). The fake (`engine/ui/data/fake.ts`) gains the same calls so the UI tests keep running.
4. **Start the read on hover.** A link to a board page can start its screen's request on `pointerenter` or `focus`,
   so a click often finds the answer already there. With item 3 that is one cheap request per hover.
5. **Share what does not change between screens.** Preferences, the boards list and the board a thread is on are read
   once per session (and refreshed by the Realtime events that already exist), not once per screen.
6. **Split the first script.** Load the glass pages, admin and the card effects on demand, so the first page's script
   is a fraction of 1.2 MB.

Items 2 and 3 are the design: 2 is the illusion, 3 is the speed. Either helps alone; together a move is one request and
one swap.

## The loading bar

`loading-bar.html` is a clickable mock (`loading-bar-mock.png` is two frames of it): a sunken gray well of navy blocks
that march in, the IE6 status bar's progress meter. Two placements:

- **A, a status bar on the seam above the Game HUD**, with "Opening page http://dw.gripe/general..." on its left,
  the meter, and an "Internet" zone, as IE6 drew its own at the window's foot. The most period-true, but it puts a
  strip of chrome between the board and the HUD while it shows (it could appear only while a page loads).
- **B, a small meter in the banner beside "dw.gripe"**: quieter, always in the same place, and it never covers the
  board.

Both pair with item 2: the bar runs while the old page stays put, then the new page lands whole and the status reads
"Done". The meter trickles toward 90% while the read is out and fills when it lands, as IE's did; with one request per
screen there is no truer measure of progress to show. It is chrome around the fiction, not a statement in it, so it
needs no honesty beyond not lying about whether a page is loading. For accessibility the meter is a `progressbar` with
a value, the page is `aria-busy` while it loads, a polite status says when it is done, and reduced motion fills it in
steps with no march ("An accessible path costs what the obstacle costs" asks nothing more here: loading is not a game
obstacle).

## Questions for the design session

- Which placement, A or B, or a third (the HUD's own seam)?
- Should the old page stay interactive while the next one loads (a 2003 browser let you click another link, which
  cancelled the first), or dim?
- Per-screen functions (item 3) for the three board screens first, with the glass pages after, or all screens at once?
- Is it worth measuring production before building, with a trace switch in the Supabase adapter (`?trace` logging
  each request's time) that the owner turns on from a browser, so the design is weighed against real round trips?
