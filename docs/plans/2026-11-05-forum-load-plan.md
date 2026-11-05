# Forum load: plan

Record, written 2026-11-05. Carries out `docs/plans/2026-11-05-forum-load-design.md`. Every task goes test first: the
failing test and its red run, then the code. Run only the changed code's tests during a task (`npx vitest run <file>`,
`npm run test:sql`, `npm run test:engine`), and `npm run build` once after the last task. The spike's measurements and
its harness are `docs/research/2026-11-05-forum-load/`; rerun `measure.cjs` after Task 13 and put its table in the PR.

World: the board (the 2003 house style) for the meter, the address text and the two error pages. Nothing visible changes
in the glass. All of it is engine; no instance file changes.

A note for every task: a screen document's fields are typed as the existing `KayfaApi` methods' answers
(`Awaited<ReturnType<KayfaApi['tallies']>>` and so on), so the fake builds each document from its own methods and the
screens hydrate the stores they hydrate today, from the same shapes.

## Task 1. `useSignedIn` reads the player's session

Model: inline

**Files:** `engine/ui/mini.tsx` (`useSignedIn`), its callers unchanged.

`useSignedIn(api)` keeps its signature (seventeen screens call it) and returns `usePlayer().sessionKnown ?
usePlayer().session.signedIn : null`, asking the server nothing; the `api` argument stays unused, with a comment that
it is kept for the call sites. Every screen test already renders inside `PlayerProvider` (`engine/ui/test-world.tsx`);
one that does not is given it.

**Test first** (`engine/ui/mini.test.tsx`): a fake whose `session` is counted; rendering a component that calls
`useSignedIn` inside `PlayerProvider` makes exactly one `session` call (the provider's), and the hook answers `true`
once the provider knows. Red today: two calls.

## Task 2. `presence_box`, and `here` returns it

Model: sonnet

**Files:** `supabase/migrations/0092_presence_box.sql` (new), `supabase/tests/0094-presence-box.sql` (new),
`supabase/tests/0005-default-deny.sql` (`callable`).

`presence_box(in_kind text, in_place uuid) returns jsonb`, `language plpgsql stable security definer set search_path =
public, pg_temp`: the three box statements from `here` (`0084_staff_presence.sql`), moved unchanged, with the same
refusals for a missing thread, board or kind. `here` keeps its signature, marks as it does, and ends `return
presence_box(in_kind, in_place);`. Granted to `authenticated` only; added to `callable` with a comment. The migration's
header says what moved and that the answer is computed from `presence_listed`, public facts, as before.

**Test first:** for a thread, a board and the index, `presence_box` answers what `here` answers for a caller whose mask
is already present; `presence_box` writes no row (the `presence` row count and the caller's `seen_at` are unchanged);
anon is refused; a missing thread is refused with `kayfabb.refusal`. Red: no such function.

## Task 3. The screen functions' guard

Model: sonnet

**Files:** `supabase/tests/e2e/0016-screen-reads.ts` (new), `tools/check-web-reads.mjs` (export nothing new:
`ALLOWED_READS` and `ALLOWED_RPCS` are already exported).

A screen function is a function in `public` named `boot` or ending `_page`. For each, the test asserts:
1. `prosqlbody is not null` (a SQL-standard body, so its dependencies are recorded);
2. `prosecdef = false` (invoker) and `provolatile = 's'` (stable);
3. every relation it depends on (through `pg_depend`, a view's dependency reaching `pg_class` through `pg_rewrite`) and
   every function in `public` it depends on is in `ALLOWED_READS` or `ALLOWED_RPCS`, imported from
   `tools/check-web-reads.mjs`, and every such function is itself `stable` or `immutable`, so a screen function never
   reaches a write (`here`, `mark_read`);
4. it is executable by `authenticated` and not by `anon`.

The detection is one exported function in the file, `screenFaults(db) -> string[]`, each fault naming the function and
the predicate that failed.

**Poisons, in the same file, each in a transaction rolled back after:** a `poison_page()` that reads `characters` (a
private table); one that is `security definer`; one in `plpgsql`; one that calls `here`; one granted to `anon`. Each
must make `screenFaults` answer a fault naming it, and the test fails if one does not. With no screen function yet the
real check passes; Tasks 4 to 7 add functions it then holds.

## Task 4. `thread_page`

Model: sonnet

**Files:** `supabase/migrations/0093_thread_page.sql` (new), `supabase/tests/0095-thread-page.sql` (new),
`supabase/tests/0005-default-deny.sql`.

`thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb`, `language sql stable
security invoker set search_path = public, pg_temp begin atomic ... end`. Null when `thread_open` has no such thread.
Otherwise one object:

- `summary`: the `thread_open` row; `page`: the page landed on, from `in_seq` when given (`pageOf` in
  `engine/ui/thread/pages.ts`, `per_page` a page: the client passes `settings.postsPerPage`, and a `per_page` outside 1
  to 100 is refused with `kayfabb.refusal`, as `effects_above` refuses an oversized list), else `in_page`, clamped to
  1..last;
- `acts`: `acts_public` for the page's seq range, kinds not `edit` or `card`, by seq (as `acts` in
  `web/src/data/supabase.ts`);
- `people`: for the distinct characters of the acts and of the plays below: `characters_public` joined to
  `character_profiles`, `character_post_counts.posts`, `current_standings.standing`, their `class_reveals` and
  `turns_announced` rows (as `ensurePeople` in `engine/ui/thread/Thread.tsx` reads);
- `plays`: `acts_public` layers (`card`, `set`, `spring`) on the page's posts, at most `PLAYS_PER_POST` a post, as
  `cardsOnMany`; `above`: `effects_above(authors, thread, board)`;
- `faces`: `my_face_down` for the sets among them; `states`: `effect_state` and `releases`: the caller's releases, for
  plays whose card is in `effect_cards` (as `readEffects`, `engine/ui/cards/plays.ts`);
- `tallies`: `reaction_tallies`, and `mine`: `my_reactions`, for the acts and the plays; `spun`: `thread_list` by
  `origin_act_id` for them, as `spunFromMany` with `SPUN_FROM_MAX`;
- `reading`: the caller's `reading.furthest_seq` for the thread; `board`: the `boards_now` row; `following`:
  `following_thread(in_thread)`; `presence`: `presence_box('thread', in_thread)`; `unread`: `my_alerts_unread()`.

Every list is bounded by the page: at most 100 acts, their authors, their plays. Add `thread_page` to `callable`. The
migration's header states the bound, that it reads only public projections and the caller's own rows as the caller,
and that it writes nothing.

**Test first:** a thread of 45 posts seeded with `tests.post`, a play, a set, a reaction and a spin on page 2. As a
player, with `per_page => 20`: page 2's `acts` are seq 21 to 40; `per_page => 500` is refused; `in_seq => 42` lands on page 3; `in_page => 9` clamps to 3; each piece equals
the matching view read made directly in the test (the same rows, by id); `mine` holds only the caller's reactions and
`faces` only the caller's sets; a missing thread is null; anon is refused. Task 3's guard passes on it. Red: no such
function.

## Task 5. `board_page` and `index_page`

Model: sonnet

**Files:** `supabase/migrations/0094_board_index_pages.sql` (new), `supabase/tests/0096-board-index-pages.sql` (new),
`supabase/tests/0005-default-deny.sql`.

`board_page(in_slug text, in_page integer, effect_cards text[]) returns jsonb`: null when `boards_now` has no such slug
(or id); otherwise `board`, `total` (`board_counts.threads`), `page` (clamped), `threads` (`thread_list` by `last_at`
desc for the page, `THREADS_PER_PAGE` from `engine/ui/board/Board.tsx`), `pins` (`pinned_threads`, page 1 only),
`banner` (`effects_above('{}', null, board)`), their `states`, `releases`, `tallies` and `mine`, `reading` and `views`
for the listed threads, `characters` for every first and last poster and caster, `presence`
(`presence_box('board', board)`), `unread`. The same pieces in the same order as `BoardScreen`'s load today.

`index_page() returns jsonb`: `boards` as `boards()` reads them (each board's counts and newest thread, by the
`(board, last_at)` index, one row a board, through a lateral join instead of a request a board), `characters` for the
last posters, `presence` (`presence_box('index', null)`), `unread`.

**Test first:** two boards with threads; `board_page` page 1 and page 2 hold the right threads and page 1 alone the pins;
a page past the end clamps; a missing slug is null; `index_page` holds each board's newest thread and count; anon is
refused; the guard passes. Red: no such functions.

## Task 6. `profile_page` and `record_page`

Model: sonnet

**Files:** `supabase/migrations/0095_profile_record_pages.sql` (new), `supabase/tests/0097-profile-record-pages.sql`
(new), `supabase/tests/0005-default-deny.sql`.

`profile_page(in_character uuid) returns jsonb`: null when `characters_public` does not show the character; otherwise
everything `ProfileScreen`'s load reads (`engine/ui/profile/Profile.tsx`, its `useCharacter` and lines 67 to 69): the
character with its profile, `character_post_counts`, `standing_place`, the last settlement, the season, its class reveals
and announced Turns, its newest `PROFILE_ROWS` posts, spins and plays, its reveals (at most 50), and `unread`.

`record_page(in_character uuid, in_kind text, in_page integer) returns jsonb`: the same null; otherwise what
`RecordScreen`'s load reads for that kind and page (`engine/ui/profile/Record.tsx` lines 56 to 75, and the targets and
Turns' Acts `engine/ui/profile/record.ts` reads at lines 51 and 77), `RECORD_PAGE` rows, and `unread`. An unknown kind
answers as `all` does today.

**Test first:** a character with posts, a spin, a play, a reveal and a Turn: each piece equals the direct view read; an
undebuted character is null (as `characters_public` hides it today); paging and kinds; anon refused; the guard passes.
Red: no such functions.

## Task 7. `boot`

Model: sonnet

**Files:** `supabase/migrations/0096_boot.sql` (new), `supabase/tests/0098-boot.sql` (new),
`supabase/tests/0005-default-deny.sql`.

`boot() returns jsonb`: `settings` (`screen_settings.settings`), `account` (`whoami()`), `preferences` (the caller's
`account_preferences` row, or null), `characters` (`my_characters`, by name), `faces` (`characters_public` with
`character_profiles` for those characters), `wallet` (`my_wallet`), `cards` (`my_cards`), `boards` (as
`index_page`'s), `unread`, `nextSettlementAt` (`next_settlement_at()`), `lastSettledAt` and `newestSettlement` (what
`SettlementOnLoad` reads, `engine/ui/log/Settlement.tsx` 249 to 258: the newest settlement's end, from `settlements`
and the caller's own ledger as `log()` reads its first settlement). Signed in with no account yet, it answers `account:
null` and the public pieces. Granted to `authenticated`; a signed-out load reads `settings()` alone, as today.

**Test first:** a player with two characters, a wallet and a hand: each piece equals the direct read; another player's
characters are absent; a signed-in caller with no account gets `account` null; anon is refused; the guard passes. Red:
no such function.

## Task 8. The API: one call per screen

Model: sonnet

**Files:** `engine/ui/data/api.ts` (the types and `KayfaApi`), `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`,
`web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`, `tools/check-web-reads.mjs` (`ALLOWED_RPCS`).

Add `Boot`, `IndexPage`, `BoardPage`, `ThreadPage`, `ProfilePage`, `RecordPage`, each field typed as the matching method's
answer (section note above), and to `KayfaApi`: `boot()`, `indexPage()`, `boardPage(slug, page, effectCards)`,
`threadPage(thread, { page, seq }, perPage, effectCards)`, `profilePage(character)`, `recordPage(character, kind, page)`, and
`presenceBox(place)`. Each answers `null` where its function answers null. The adapter makes one `rpc` each and maps rows
with the converters it has (`toAct`, `toThread`, `toBoard`, the character mapper `characters` uses); `presenceBox` and
`here` share one mapper. The fake composes each document from its own methods, so the two backends agree by
construction on the fake's side and by Tasks 4 to 7's tests on the server's. Add the seven rpc names to `ALLOWED_RPCS`.

**Test first:** in `supabase.test.tsx`, each new method sends exactly one request, to `/rest/v1/rpc/<name>`, with the
arguments named, and maps a canned answer to the typed document (an Act's `currentPayload`, a thread's `lastSeq`); a
null answer is null. In `fake.test.tsx`, `threadPage` of the demo's long thread equals what the existing calls answer for
the same page. Red: no such methods.

## Task 9. The two error pages

Model: haiku

**Files:** `engine/ui/frame/Unavailable.tsx` (new), `engine/ui/frame/unavailable.css` (new),
`engine/ui/frame/Unavailable.test.tsx` (new), `engine/ui/frame/Unavailable.stories.tsx` (new).

Two components, `CannotDisplay({ address, onRetry })` and `CannotFind({ address })`, drawn in the board's frame (they
render inside `<main>`, as a screen does). Layout: a small gray "page" glyph drawn in CSS (no image, no Microsoft
mark), the heading, a 1px rule, the paragraphs, "Please try the following:", a bulleted list, a second rule, and a
footer line in gray. Verdana 13px for the body and bold 16px for the heading, black on white, links in the board's link
color. The exact strings, `{site}` being `ui.copy.siteName` and `{address}` the address asked for:

CannotDisplay:
- Heading: `The page cannot be displayed`
- `The page you are looking for is currently unavailable. {site} did not answer in time, or the connection dropped
  on the way.`
- `Please try the following:`
- List: `Click [Try again], or try again in a moment.` (the bracketed words are a button that calls `onRetry`);
  `Check that your connection is working.`; `Go [back to the index].` (a link to `/`); `Click your browser's Back
  button to return to the page you were on.`
- Footer: `Cannot load {address}`

CannotFind:
- Heading: `The page cannot be found`
- `The page you are looking for might have been removed, had its name changed, or never existed.`
- `Please try the following:`
- List: `If you typed the page address, make sure that it is spelled correctly.`; `Open the [index], and then look for
  links to the page you want.` (a link to `/`); `Click your browser's Back button to try another link.`
- Footer: `Page not found: {address}`

The heading is the page's `h1`; the button and links are keyboard reachable with the board's focus ring.

**Test first:** each renders its heading as `h1`, its strings exactly, its links to `/`, and `onRetry` is called by Try
again; axe finds no violation (`engine/ui/a11y.ts`). Red: no such file.

## Task 10. The router loads before it moves

Model: sonnet

**Files:** `engine/ui/router.tsx`, `engine/ui/routes.tsx`, `engine/ui/router.test.tsx`, `engine/ui/routes.test.tsx`.

- `Route` gains `load?(args: { params, query, hash, signal }) => Promise<unknown | null>` and `key?(params, query) =>
  string` (default: the path and query). `render` receives the loaded document as a second argument.
- `RouterProvider` holds two locations: `shown` (what the screens draw) and `pending` (`{ to, controller, startedAt }`
  or null). `navigate(to)` and `popstate` find the route; one with no loader, or whose key equals the shown route's key,
  moves at once as today. Otherwise it starts the load and leaves `shown` (and, for `navigate`, the address bar) as it
  is. When the load lands it pushes or replaces the history entry, then shows the new location with its document in one
  state update; `onMove` is told then, not at the click. A new navigation aborts the pending one's controller and its
  answer is dropped. Escape (a `keydown` on the window, not inside a text field or an open modal) aborts the pending
  load. A load past 20 s aborts and shows `CannotDisplay`. A load that throws shows `CannotDisplay` with Try again
  (the same navigation again); `null` shows `CannotFind`. An address no route matches shows `CannotFind`.
- `useNavigation()` answers `{ pending: { to, startedAt } | null, track(promise) }`: `track` lets a screen run the meter
  for a read it makes within its key (a thread's next page).
- `prefetch(to)` starts the load for an address without moving and keeps the answer 30 s, keyed by the address and the
  account (`useRouterAccount(id)` sets the account; a change empties every cache). A navigation finds a fresh prefetch,
  or the one still in flight, and uses it.
- The history cache: each entry's document and `scrollY`, under a key the router writes into `history.state` as `{ kb:
  key, state }` (a page's own state still reads through `Location.state`). Back or Forward to an entry cached less than
  five minutes ago shows it at once and restores its scroll after the swap; at most twenty entries, oldest dropped.
  `history.scrollRestoration = 'manual'` while the router is mounted.
- `Routes` renders the shown route with its document; its fallback is `CannotFind`.

**Test first** (`router.test.tsx`, with a loader that answers when the test resolves it):
- a click on a link to a loading route leaves the old screen drawn and the address unchanged until the load resolves,
  then both change in one render;
- a second click aborts the first (its signal is aborted, its late answer is never shown);
- Escape aborts and the old screen stays;
- a throwing load shows "The page cannot be displayed", and Try again loads again; `null` shows "The page cannot be
  found"; an unmatched address shows it too;
- a move within the key draws at once with no load;
- a prefetch answered before the click makes the click show the page with no second load call;
- Back to an entry left less than five minutes ago shows its document with no load call and restores its scroll; one
  older loads; a change of account empties the cache;
- at 20 s (fake timers) a pending load shows "The page cannot be displayed".
Red: today's router moves at once.

## Task 11. Links start their load early

Model: sonnet

**Files:** `engine/ui/router.tsx` (`Link`), `engine/ui/router.test.tsx`.

`Link` calls `prefetch(to)` after the pointer rests on it for 100 ms (a `pointerenter` timer cleared on `pointerleave`),
on `focus`, and on `pointerdown`; not for a modified click, an off-site link, a `target` or a `download`, and not when the
address's route has no loader.

**Test first** (fake timers): resting 100 ms starts one load; leaving at 60 ms starts none; focus starts one;
`pointerdown` starts one; a link to a glass route starts none. Red: no prefetch.

## Task 12. Boot: the first page draws once

Model: sonnet

**Files:** `web/src/App.tsx`, `web/src/App.test.tsx`, `engine/ui/player.tsx` (an optional `initial` prop),
`engine/ui/frame/Frame.tsx`, `engine/ui/frame/Hud.tsx`, `engine/ui/alerts/useAlertFeed.ts`, `engine/ui/tips/Tips.tsx`,
`engine/ui/log/Settlement.tsx` (`SettlementOnLoad`), `engine/ui/welcome/Welcome.tsx` (`SendToWelcome`), and a small
`engine/ui/boot.tsx` (new: `BootProvider`, `useBoot()`).

- `App` asks `api.session()` (its local half answers at once; signed out, it reads `settings()` alone, as today), then
  `api.boot()`, the first route's load and `api.estimate()` together, and renders when boot and the load have landed;
  the estimate is waited for until 600 ms after them, then left to land on its own. `aria-busy` stays on the empty
  `main` until then. A failed boot shows `CannotDisplay` in the bare page with Try again.
- `PlayerProvider initial={...}` starts from boot's session, characters, wallet, cards and estimate, and does not read
  them again on mount; its later refreshes are unchanged.
- `Frame` takes its boards from `useBoot()`; `Hud` its face from boot's `faces`; `Tips`, `SettlementOnLoad` and
  `SendToWelcome` their preferences and checks from boot. Each keeps its own read for a session that changes after boot
  (a sign-in on this page), and that read is the only one it makes.
- `useAlertFeed` takes the shown document's `unread` when the shown route has one, and reads `alertsUnread()` on a move
  only for a route without a loader (the glass), as today.

**Test first** (`App.test.tsx`, the fake counted): a first load of `/t/<id>` makes exactly one `boot`, one `threadPage`
and one `estimate` call, and no `preferences`, `boards`, `myCharacters`, `wallet`, `myCards`, `characters`, `alertsUnread`
or `nextSettlementAt` call; the banner's links, the HUD's name and the first post are in the same first render after
`aria-busy` clears. Red: today's separate reads.

## Task 13. The board screens draw their document

Model: sonnet

**Files:** `web/src/App.tsx` (`ROUTES`: the five loaders and keys), `engine/ui/index/Index.tsx`,
`engine/ui/board/Board.tsx`, `engine/ui/thread/Thread.tsx`, `engine/ui/presence/presence.ts`,
`engine/ui/thread/Follow.tsx`, `engine/ui/profile/Profile.tsx`, `engine/ui/profile/Record.tsx`, each screen's test, and
`engine/ui/cards/plays.ts` (a `hydrate` beside `readPlays` and `readAbove` that adds a document's plays, states and
releases with no read).

- The loaders: `/` → `indexPage()`; `/b/:slug` → `boardPage(slug, page, effectCards)`, key slug and page; `/t/:thread` →
  `threadPage(thread, { page, seq }, settings.postsPerPage, effectCards)`, key the thread; `/c/:id` → `profilePage(id)`; `/c/:id/record` →
  `recordPage(id, kind, page)`, key id, kind and page. Signed out, each loader answers a marker without a request and the
  screen draws the front door or the sign-in line as today. `effectCards` is `effectCards(ui)`, as the screens compute it.
- Each screen takes its document as a prop and fills its stores from it before its first render (a `useState`
  initializer, or a `useMemo` keyed on the document), so the first frame is whole; its own load effect goes. Board's
  `turning` state goes: a page turn is a navigation.
- Thread: the first page from the document (people, plays, tallies, mine, spun, reading, board, following, presence);
  its next-page read and its gap read call `threadPage` and are wrapped in `useNavigation().track`; its live channels,
  `markRead` and the heartbeat start after the first render, as now.
- Presence: `usePresence(place, snapshot)` shows the snapshot with the reader's HUD mask added (at the end of `names`
  when there are fewer than `presenceNames`, else `others + 1`; not when `presenceHidden` or already listed), then
  starts the heartbeat, whose answers replace it. `Follow` takes `following` from the document and reads only after its
  own button.

**Test first:** each screen's test renders it from a document with a fake that throws on every read but the ones the
screen makes after landing (`markRead`, `here`, live subscriptions), and finds its whole content in the first render;
Board page 2 is a navigation; the thread's next page calls `threadPage` once; the presence snapshot shows the HUD mask
added, and not when hidden. Then run `node docs/research/2026-11-05-forum-load/measure.cjs 100` with the harness up:
board → thread and index → board each show one wave and one burst. Red: today's effects.

## Task 14. The meter, the address and the cursor

Model: sonnet

**Files:** `engine/ui/frame/Loading.tsx` (new), `engine/ui/frame/Loading.test.tsx` (new),
`engine/ui/frame/Loading.stories.tsx` (new), `engine/ui/frame/frame.css`, `engine/ui/frame/Frame.tsx` (the banner).

- The banner's right side becomes the host text and the meter, as the spike's mock placement B
  (`docs/research/2026-11-05-forum-load/loading-bar.html`): a well 96 by 12 px, `background: #d4d0c8`, a 1px sunken
  border (`#808080` top and left, `#fff` bottom and right) with a 1px inner `#404040` shadow, and a fill of `#0a246a`
  blocks 8 px wide with 2 px gaps. These are the meter's own colors, a game piece's, so they are tokens in
  `frame.css` (`--kb-meter-face` and the rest), with a dark-theme set that keeps the well readable on the board's dark
  background; `engine/ui/contrast.ts` checks the fill against the face.
- Progress: from `useNavigation().pending`, or any `track`-ed read: 0 at the start, then `90 - (90 - p) * 0.82` every
  120 ms, 100 when it lands, held 250 ms ("Done"), then 0. A swap answered at once (a prefetch or the cache) shows only
  the full flash. With `prefers-reduced-motion` (or the account's motion setting, as `appearance.ts` applies it), the
  fill steps with no transition.
- The text reads `{host}` (from `location.host`) at rest and `Opening {host}{shortened path}…` while pending, where each
  path segment that is a UUID is cut to its first eight characters and `…`; CSS ellipsis cuts the rest on a narrow
  banner. The query and the fragment are not shown.
- While pending, `.kb-frame` gets `data-kb-loading` and `cursor: progress`; `<main>` gets `aria-busy="true"`. The meter
  is `role="progressbar"` with `aria-label="Loading the page"` and `aria-valuenow`; a visually hidden `role="status"`
  says `Page loaded` when a load lands, and nothing while at rest.

**Test first** (fake timers): pending shows `Opening dw.gripe/t/3f2a9c1e…` for a UUID address; the value rises toward
90 and never past it while pending; landing sets 100, then 0 after 250 ms; an instant swap never shows a value between 1
and 99; `aria-busy` and the cursor attribute follow the pending state; the status says `Page loaded`. The story is added
to the a11y sweep. Red: no such file.

## Task 15. The first script splits

Model: sonnet

**Files:** `web/src/App.tsx` (the glass screens, the admin queue and the vending machine through `React.lazy`, each
glass route inside a `Suspense` whose fallback is the glass page's empty `main`), and wherever the card effects are
imported eagerly (`instances/divided-world/ui/index.ts` registers them: each `CardUi.Effect` through a lazy import, the
engine's effect slot rendering it inside a `Suspense` with the post's text as the fallback, so a post never pops in
without its words).

**Test first:** `npx vite build web` into a scratch directory with the two public build variables set, as the spike did;
a test in `web/headers.test.tsx`'s style is not needed, but the PR states the first chunk's size before and after, and
the existing e2e suite passes. Red: one 1.2 MB chunk.

## Task 16. End to end

Model: sonnet

**Files:** `web/src/data/backend.ts` (in the end-to-end and development builds only, `?latency=<ms>` wraps the fake so
every promise answers that much later, as the spike's harness did; the Supabase branch returns before it reads the
address, as now), `e2e/load.spec.ts` (new).

With `?latency=300`: a click from a board to a thread keeps the board's list on screen and shows the meter and
`Opening …` until the thread lands, then the thread's first post and "Users browsing this thread" appear in the same
frame; a second click during the load lands on the second page; Back to the board shows it with no meter; an address
with a thread that does not exist shows "The page cannot be found". `npm run build` passes once, after this task.

## Review focus

- A screen function that reads one view more than the screen did (or a different column set) puts a fact in the
  browser the old reads did not: compare each document's fields with the reads it replaces, not only with the guard.
- `thread_page`'s and `board_page`'s cost on a busy instance: the plays, spins and tallies of a full page, and
  `effects_above` over twenty authors, in one statement. Check the plans use the indexes the old reads used.
- A prefetch or a cached Back must never carry one account's document to the next: the cache's account key, and a
  document in flight when the account changes.
- `history.state` now carries the router's key around a page's own state: every existing reader of `Location.state`
  (the glass's Back, `engine/ui/glass/back.ts`, and a profile's chosen character) must still read what it read.
- A screen hydrated from a document must not miss a live event that lands between the server reading the document and
  the screen subscribing: the thread's gap read is the way out today; confirm it still fires from the document's
  `lastSeq`.
- The presence snapshot with the reader's own mask added must match what the first heartbeat answers in the common
  case, or the box shifts once after landing.
- Escape aborting a load must not swallow Escape for a modal, the composer or the hand drawer.
