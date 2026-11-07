# Glass load: plan

Record, written 2026-11-07. Carries out `docs/plans/2026-11-07-glass-load-design.md`. Every task goes test first: the
failing test and its red run, then the code. Run only the changed code's tests during a task (`npx vitest run <file>`,
`npm run test:sql`, `npm run test:engine`), and `npm run build` once after the last task. The spinner's mock is
`docs/research/2026-11-07-glass-load/spinner.html` (option C, Signal).

World: the glass for the spinner, the busy button and the two glass error screens. All of it is engine; no instance
file changes.

Two notes for every task:

- A screen document's fields are typed as the existing `KayfaApi` methods' answers (`Awaited<ReturnType<KayfaApi['log']>>`
  and so on), as the forum-load plan's are, so the fake builds each document from its own methods and the screens
  hydrate the stores they hydrate today, from the same shapes.
- Migrations take the next free numbers when the task is built (migrations and tests share one sequence; on main at
  the time of writing the next free is 0115). Each new function is added to `callable` in
  `supabase/tests/0005-default-deny.sql` with a comment, and is held by `supabase/tests/e2e/0016-screen-reads.ts`, which
  finds it by its `_page` name.

## Task 1. A navigation names its source

Model: sonnet

**Files:** `engine/ui/router.tsx` (`navigate`, `Pending`, `Navigation.pending`, `Link`), `engine/ui/router.test.tsx`.

- `navigate(to, options)` takes `source?: string`. `Navigation.pending` becomes `{ to, startedAt, source: string | null }`.
  A popstate's pending has `source: null`.
- `Link` takes `source?: string` and, when none is given, names its own (`useId()`); its click passes it.
- A new hook, `usePendingFrom(source: string | undefined): boolean`, is true while a load is out whose source is
  `source`. A same-key move or a route with no loader commits at once and is never pending, as now.
- A move that the source started and that lands, fails or is cancelled ends its pending, as now.

**Test first:** two `Link`s to the same loading route; pressing the second makes `usePendingFrom` true for the second's
source and false for the first's; landing makes both false; Escape makes both false; `navigate(to, { source: 'x' })`
makes `usePendingFrom('x')` true; a popstate's load has no source. Red: no `source`.

## Task 2. The Signal spinner and the busy button

Model: sonnet

**Files:** `engine/ui/glass/Spinner.tsx` (new), `engine/ui/glass/spinner.css` (new), `engine/ui/glass/Button.tsx`,
`engine/ui/glass/parts.css`, `engine/ui/glass/parts.test.tsx`, `engine/ui/glass/Parts.board.stories.tsx`.

- `Spinner` draws the mock's option C: four bars, 4 by 18 px with 3 px gaps, each `skewX(-10deg)` and
  `transform-origin: bottom`, rising from `scaleY(0.3)` to `1` over 1000 ms with a 120 ms step between bars, in
  `currentColor`. It is `aria-hidden`. Under `:root[data-kb-motion='reduce']` (which `appearance.ts` sets for Off and the
  device's reduced motion) no animation runs and the bars stand at 0.4, 0.6, 0.8 and 1, lit. The colors are
  `currentColor`; the file names no color (`tools/check-ui-tokens.mjs`).
- `GlassButton` takes `busy?: boolean`. Its upright span becomes `display: inline-grid`, holding the label and the
  spinner in one cell (`grid-area: 1 / 1`), so its width is the label's. `busy` sets `aria-busy="true"`, fades the
  label to 0 and the spinner to 1 over 180 ms (no transition under reduce), sets `cursor: progress`, and makes a press
  do nothing (a button's `onClick` is not called; a link's navigation is not started). It does not set `disabled`, so
  focus stays on the button.
- A `GlassButton` with `to` is busy, as well, while `usePendingFrom` its own source is true (Task 1): it gives its
  `Link` a `useId()` source and reads it.

**Test first:** in `parts.test.tsx`, a busy button keeps its accessible name, has `aria-busy`, ignores a click, and its
label and spinner share one grid cell; a `to` button is busy while its load is out and not after; under
`data-kb-motion='reduce'` the spinner's bars have no animation. The story shows each kind busy and is in the a11y sweep.
Red: no `busy`.

## Task 3. The glass's controls and page show the wait

Model: sonnet

**Files:** `engine/ui/glass/MenuBar.tsx`, `engine/ui/glass/MenuBar.test.tsx`, `engine/ui/glass/shell.css`,
`engine/ui/glass/Page.tsx`, `engine/ui/glass/Page.test.tsx`, `engine/ui/glass/Link.tsx` (new), `engine/ui/frame/Hud.tsx`,
`engine/ui/glass/back.ts` (`useBackToBoard`).

- **Menu bar.** Each tab names its own source and, while it is pending, shows the `Spinner` after its label (a slot
  whose width eases from 0 to 22 px; at once under reduce) and takes `data-kb-pending`. Back to the board names a
  source, and Esc's `back()` passes Back's. The menu bar's `isAdmin()` read goes: it takes `useBoot()?.admin`, and reads
  only where boot is null, as `useIsAdmin` (`engine/ui/mini.tsx`) does. A load out whose source is none of the menu
  bar's and none drawn on the page (a `navigate` with no source) shows the `Spinner` at the menu bar's end: the menu bar
  shows it when `pending` is out with `source === null` or a source no mounted control has claimed (each pending-aware
  control registers its source in a small set the menu bar reads through context).
- **Text links.** `GlassLink` (new, `engine/ui/glass/Link.tsx`) is the router's `Link` with the `Spinner` after its text
  while it is pending. The glass screens' plain `Link`s (listed in the survey: `Characters.tsx:371, 397`,
  `ProfileEdit.tsx:78`, `Settings.tsx:194`, `Season.tsx:82, 94, 101, 146`, `Vending.tsx:294, 337`, `Alerts.tsx:75`,
  `Updates.tsx:110`, `Log.tsx:51, 255`, `Settlement.tsx:144`, `Contact.tsx:32`, `guide/render.tsx:36-37`) become
  `GlassLink`. A hash link within the page (`Guide.tsx:127`) stays a `Link`.
- **HUD.** The avatar, orbs and alerts links and the Menu button name sources and show the `Spinner` while pending (the
  Menu button's `navigate` passes its source). The board's meter runs as now.
- **Page.** `Page` keys its `Leaving` by the router's `shown.key` where the route has one, else the path, so a change of
  key swaps the screen and plays the entrance; the direction is kept within one tab. Its scroll-to-top and focus run on
  the same key. While `pending` is out the page's `main` is `aria-busy` and the page takes `cursor: progress`; a
  visually hidden `role="status"` says `Screen loaded` when a load lands, and nothing at rest.

**Test first:** in `MenuBar.test.tsx`, a tab pressed toward a loading route shows the spinner and `data-kb-pending`
until it lands; Esc's load is Back's; with boot holding `admin: true` the Admin tab shows with no `isAdmin` call; a
`navigate` with no source shows the end spinner. In `Page.test.tsx`, a key change within one path replays the entrance
(`enterScreen` called again); `aria-busy` follows `pending`; the status says `Screen loaded`. Red: none of it.

## Task 4. The glass's two error screens

Model: haiku

**Files:** `engine/ui/glass/Unavailable.tsx` (new), `engine/ui/glass/unavailable.css` (new),
`engine/ui/glass/Unavailable.test.tsx` (new), `engine/ui/glass/Unavailable.stories.tsx` (new), `engine/ui/routes.tsx`.

- `Routes` takes an optional `failures?: { display: (p: { address: string; onRetry: () => void }) => ReactNode; find: (p:
  { address: string }) => ReactNode }`; without it, it draws `CannotDisplay` and `CannotFind` as now.
- `GlassCannotDisplay` draws, in the glass's `PageHead` and a `.kb-glass-cut-panel`: the title `This screen didn't
  load`, the line `The server didn't answer, or it took longer than 20 seconds. Loading a screen changes nothing, so
  nothing was lost.`, and a `ButtonRow` with a primary `GlassButton` `Try again` (`onRetry`) and a secondary `Back to
  the board` (`useBackToBoard`).
- `GlassCannotFind` draws the title `There's nothing here`, the line `Nothing on this address can be shown: it may never
  have existed, or it has gone.`, and a primary `Back to the board`.
- Neither names the address's ids; both are plain text in the glass's own voice.

**Test first:** each renders its title, its line and its buttons; Try again calls `onRetry`; `Routes` with `failures`
draws the glass screen for a failed load and without it the board's. The story is in the a11y sweep. Red: no such
file.

## Task 5. `my_characters_page`

Model: sonnet

**Files:** a new migration `NNNN_my_characters_page.sql`, a new test `NNNN-my-characters-page.sql`,
`supabase/tests/0005-default-deny.sql`.

`my_characters_page() returns jsonb`, `language sql stable security invoker set search_path = public, pg_temp begin
atomic ... end`. One object, `characters`: for each row of `my_characters`, by name, its `characters_public` row joined
to its `character_profiles` row (the shape of `boot`'s `faces` piece, `supabase/migrations/0097_boot.sql`), its
`character_post_counts` row, its `current_standings.standing`, its `class_reveals` rows and its `turns_announced` rows;
and `nextSettlementAt`, `next_settlement_at()`. It is the read of both `/characters` and `/characters/edit`, so picking
another character needs none. The header states the bound (the caller's own characters), that every piece is a public
projection or the caller's own row read as the caller, and that it writes nothing.

**Test first:** a player with three characters, one debuted with a reveal and a Turn announced, posts on two: every
piece equals the matching view read made directly in the test, by id; another player's characters are absent; a
caller with no account gets an empty list; anon is refused; the guard passes on it. Red: no such function.

## Task 6. `season_page`

Model: sonnet

**Files:** a new migration `NNNN_season_page.sql`, a new test `NNNN-season-page.sql`,
`supabase/tests/0005-default-deny.sql`.

`season_page(in_tab text, in_season integer, in_character uuid, in_page integer) returns jsonb`, the same shape of
function. One object: `season` (`current_season`); for `in_tab = 'news'`, `news`, the first page of `season_news()`;
otherwise `finished` (`finished_seasons()`), and either, for no `in_season` or the current one, `standings`
(`standings_page`, the page clamped as `engine/ui/rankings/Rankings.tsx` clamps it), `size` (`season_size`), and the
`class_reveals` and `turns_announced` of the page's characters; or, for a finished season, `place`
(`result_place(in_season, in_character)` when a character is given) and `results` (`results_page` for `in_page`, or for
the page `place` lands on when no page is given, as `Rankings.tsx:280-284` reads it). A finished season that does not
exist answers null. `lastSettledAt` and the caller's characters come from boot and are not repeated. Bounded by a
page.

**Test first:** a season with 30 ranked characters: `rankings` page 2 equals `standings_page` page 2 and its
reveals and Turns; `news` equals `season_news()`; a finished season with a character lands on that character's page; a
season that does not exist is null; anon is refused; the guard passes. Red: no such function.

## Task 7. `alerts_page`

Model: sonnet

**Files:** a new migration `NNNN_alerts_page.sql`, a new test `NNNN-alerts-page.sql`,
`supabase/tests/0005-default-deny.sql`.

`alerts_page(in_before timestamptz) returns jsonb`: `alerts` (`my_alerts(in_before)`), `seenAt` (the caller's
`account_preferences.alerts_seen_at`), `openedAt` (`my_account_opened()`), `acts` (the `acts_public` rows the alerts
name and, in up to three rounds, those they quote, as `actsAround` in `engine/ui/alerts/useAlerts.ts:52-68` reads them:
a recursive CTE bounded at depth three), `people` (`characters_public` with `character_profiles` for those Acts'
authors), `openings` (the opening Acts of the alerts' threads, as `openingActs`), and `reading` (the caller's `reading`
rows for those threads). It writes nothing: `see_alerts` stays the screen's write on landing. Bounded by a page of
alerts, the rounds by three.

**Test first:** a follower with alerts on two threads, one alert's Act quoting a post that quotes another: the Acts
equal `actsAround`'s three rounds; a fourth-level quote is absent; `seenAt` is the caller's; another player's alerts are
absent; `in_before` pages; anon is refused; the guard passes. Red: no such function.

## Task 8. `updates_page` and `queue_page`

Model: sonnet

**Files:** a new migration `NNNN_updates_queue_pages.sql`, a new test `NNNN-updates-queue-pages.sql`,
`supabase/tests/0005-default-deny.sql`.

- `updates_page(in_update uuid, in_before timestamptz, in_handover_season integer) returns jsonb`: `updates`
  (`updates(in_before)`); for the open update (`in_update`, else the newest), `tallies` (`reaction_tallies`) and `mine`
  (`my_reactions`) of its Act; and, when `in_handover_season` is given and `is_admin()`, `queue` (`admin_queue()`).
- `queue_page() returns jsonb`: null unless `is_admin()`; otherwise `queue` (`admin_queue()`), `boardNames` (as
  `boardNames` reads `boards_now` and `boards`), `bosses` (`boss_roster_names()`) and `contact` (`admin_contact()`).
  The boards come from boot.

**Test first:** `updates_page` for an update with reactions equals the direct reads, and `mine` holds only the
caller's; `queue` is absent for a player and present for an admin writing a handover; `queue_page` is null for a
player and equals the four reads for an admin; anon is refused; the guard passes on both. Red: no such functions.

## Task 9. `log_page`

Model: sonnet

**Files:** a new migration `NNNN_log_page.sql`, a new test `NNNN-log-page.sql`, `supabase/tests/0005-default-deny.sql`.

`log_page(in_before timestamptz) returns jsonb`: `sources`, the thirteen reads `log` makes today
(`web/src/data/supabase.ts:1452-1475`), each its view's rows newest first at or before `in_before`, at most `LOG_ROWS`
(200) rows, with the same columns and filters; `shares`, the `my_ledger_shares` rows of the settlements read, whole;
and the pieces `around` (`engine/ui/log/useLog.ts:50-104`) reads for them, computed over every row read: the Acts they
name and the up to two rounds those follow (`acts_public`), the `effect_state` of the plays, the characters named
(`characters_public`, `character_profiles`), the threads (`thread_open`) and the boards (`boards_now`), the caller's
characters' `current_standings` and `turns_announced`, and `current_season`. The page is still cut on the client by
`readLogPage` (`engine/ui/data/log-page.ts`), which takes the sources from the document; a page that would not move its
cursor makes its second read "at instant" as now, a second request on that rare page (the design, section 9). The
estimate is not in it.

**Test first:** a player with two settlements, card plays, an infraction and a ban: each source equals the view read
made directly in the test with the same filter and limit; the shares are the settlements' whole; the Acts, threads and
boards are those `around` reads for the same rows; another player's rows are absent; anon is refused; the guard
passes. Red: no such function.

## Task 10. The API: one call per glass screen

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`, `web/src/data/supabase.ts`,
`web/src/data/supabase.test.tsx`, `tools/check-web-reads.mjs` (`ALLOWED_RPCS`), `engine/ui/data/log-page.ts`.

Add `MyCharactersPage`, `SeasonPage`, `AlertsPage`, `UpdatesPage`, `QueuePage`, `LogPage`, and to `KayfaApi`:
`myCharactersPage()`, `seasonPage(tab, season, character, page)`, `alertsPage(before)`, `updatesPage(update, before,
handoverSeason)`, `queuePage()`, `logPage(before)`. Each answers null where its function does. The adapter makes one
`rpc` each and maps rows with the converters it has; `logPage` hands its sources to `readLogPage` through a reader that
answers the first range from the document and any "at instant" range by the views as now. The fake composes each
document from its own methods. Add the six names to `ALLOWED_RPCS`.

**Test first:** in `supabase.test.tsx`, each new method sends one request to `/rest/v1/rpc/<name>` with its arguments
named and maps a canned answer; null is null; `logPage` on a page that would not move sends its second read. In
`fake.test.tsx`, `logPage` of the demo player equals what `log` and `around` answer. Red: no such methods.

## Task 11. The glass routes load: characters, season, contact, settings

Model: sonnet

**Files:** `web/src/App.tsx` (`routesFor`, the lazy screens), `engine/ui/glass-docs.ts` (new: the glass loaders and keys,
beside `engine/ui/screen-docs.ts`, with its test), `engine/ui/characters/Characters.tsx`,
`engine/ui/profile-edit/ProfileEdit.tsx`, `engine/ui/profile-edit/ProfilePreview.tsx`, `engine/ui/season/Season.tsx`,
`engine/ui/rankings/Rankings.tsx`, `engine/ui/contact/Contact.tsx`, `engine/ui/account/Settings.tsx`,
`engine/ui/account/Invites.tsx`, `engine/ui/account/SignIn.tsx`, `engine/ui/account/session.ts`, each screen's test.

- **The chunk is part of the load.** Each lazy glass screen is made with a `lazyScreen(importer)` that returns the
  `lazy` component and a `preload()`; a glass route's loader runs `preload()` beside its document read
  (`Promise.all`), so a landed route never shows the Suspense fallback. A glass route with no document (New character,
  Vending, Guide, Sign-in, Welcome, Settings' other sections) still gets a loader that is `preload()` alone, so its first
  visit is whole too.
- **Loaders and keys:** `/characters` and `/characters/edit` → `myCharactersPage()`, one key for both (`'/characters'`),
  so a move between them and a change of chosen character load nothing; `/season` → `seasonPage(...)` from `?tab`,
  `?season`, `?character`, `?page`, keyed by all four; `/contact` → `adminContact()`; `/settings` → `invites()` when
  `?section=account`, else nothing, keyed by the section. Signed out, each answers the signed-out marker with no request
  and the screen draws its sign-in line as today; Contact reads signed out, as now.
- **The screens draw their document.** Each takes `doc` as a prop and fills its state from it before its first render;
  its load effect goes, and so does its empty `aria-busy` block. Characters and Edit profile read their faces, counts,
  standings, reveals and Turns from the document; `ProfilePreview` takes them as props. Rankings' paging and the
  season select are navigations (they change the key). A refresh after an action (`player.refresh()`, a Turn) reads
  `myCharactersPage()` again through the router's retry of the shown key, not the old reads.
- **Boot's reads are taken from boot.** Invites' `isAdmin()` is `useIsAdmin`; Settings' and Sign-in's `useSession` reads
  `usePlayer()`'s session; Season's and Rankings' `myCharacters()` and `lastSettledAt()` are the player's and boot's.

**Test first:** each screen's test renders it from a document with a fake that throws on every read the screen no
longer makes, and finds its whole content in the first render; a Season tab change and a Rankings page are a load (a
`seasonPage` call, the tab pending); Characters → Edit profile makes no read; Contact signed out makes one
`adminContact` call. A loader test: a lazy screen's chunk and document are awaited together. Red: today's effects.

## Task 12. The glass routes load: alerts, updates, the queue, the log

Model: sonnet

**Files:** `web/src/App.tsx`, `engine/ui/glass-docs.ts`, `engine/ui/alerts/Alerts.tsx`, `engine/ui/alerts/useAlerts.ts`,
`engine/ui/updates/Updates.tsx`, `engine/ui/admin/Queue.tsx`, `engine/ui/admin/AdminContact.tsx`,
`engine/ui/log/Log.tsx`, `engine/ui/log/Settlement.tsx`, `engine/ui/log/useLog.ts`, `engine/ui/welcome/Welcome.tsx`,
each screen's test.

- **Loaders and keys:** `/alerts` → `alertsPage(null)`; `/updates` → `updatesPage(?update, null, ?season when
  ?write=handover)`, keyed by `?update` and `?write`; `/admin/queue` → `queuePage()`, a null answer drawing the screen's
  "The admin queue is for admins." as now (not "can't be found", since the address exists); `/log` and
  `/log/settlement` → `logPage(null)` beside `estimate()`, the estimate given its short bound as boot's is
  (`web/src/App.tsx`, the first load) and filling in when it lands.
- **The screens draw their document,** as in Task 11. `useLog` and `useAlerts` take a first page from the document and
  keep their paging; their first-read effects go. The Queue's refresh after an action reads `queuePage()` once instead
  of its four reads. Updates' open update hydrates its tallies from the document and keeps its Realtime subscription.
- **Writes on landing stay writes on landing:** `seeAlerts`, `seeSettlement` and `seeWelcome` run after the page has
  landed, as now, never in a loader (a hover is not a visit).
- **Boot's reads are taken from boot:** Updates' and the Queue's `isAdmin()`, Alerts' and Welcome's `preferences()`
  (`usePreferenceSaves` given boot's preferences as `supplied`), and the Log's and Alerts' `myCharacters()` and
  `nextSettlementAt()`.

**Test first:** as Task 11's: each screen whole in its first render from a document, with a fake that throws on the
reads it no longer makes; a hover on the Log tab makes one `log_page` and no `see_*` call; `/admin/queue` as a player
draws the admins line with one `queuePage` call. Red: today's effects.

## Task 13. Reads inside a screen spin and enter

Model: sonnet

**Files:** `engine/ui/glass/enter.ts`, `engine/ui/glass/enter.test.tsx`, `engine/ui/log/Log.tsx`, `engine/ui/log/useLog.ts`,
`engine/ui/alerts/Alerts.tsx`, `engine/ui/alerts/useAlerts.ts`, `engine/ui/season/Season.tsx` (`NewsPanel`),
`engine/ui/updates/Updates.tsx`.

- `enterRows(feel, rows: HTMLElement[]): () => void` in `enter.ts`: the rows a press brought, staggered as a screen's
  rows are (`stagger` over their count, at most `MAX_ROWS`, only those in the window), and nothing under Off.
- "Show older lines" (Log), the alerts' older page, "Show earlier news" (Season) and "Show earlier updates" each call
  their page function with the cursor through `useNavigation().track`, show their `GlassButton` busy while it is out,
  and, when it lands, pass the rows they added to `enterRows` (the new rows are marked by the render that adds them,
  `data-kb-new`, and found in a layout effect). Season's and Updates' buttons, which have no busy state today, get it.
- A row that arrives any other way (a Realtime tally, a refresh after an action) does not enter.

**Test first:** in `enter.test.tsx`, `enterRows` animates only the rows given, in order, and none under Off; in the Log's
test, "Show older lines" is busy until its `logPage` call lands and the new lines are handed to `enterRows`. Red: no
`enterRows`.

## Task 14. Overlays open whole

Model: sonnet

**Files:** `engine/ui/glass/prepared.ts` (new) and its test, `engine/ui/characters/RevealOverlay.tsx`,
`engine/ui/characters/Characters.tsx`, `engine/ui/cards/PlayForm.tsx`, `engine/ui/cards/PlayActions.tsx`,
`engine/ui/cards/play.tsx`, `engine/ui/cards/Forms.tsx`, `engine/ui/cards/Lens.tsx`, `engine/ui/cards/Visit.tsx`,
`engine/ui/cards/Moment.tsx`, their tests.

- `usePrepared<T>(read: (signal: AbortSignal) => Promise<T>)` answers `{ data, busy, failed, open, early, cancel }`:
  `early` (for the trigger's pointer rest of 100 ms and focus, as `Link` does) starts the read and keeps its answer 30
  seconds; `open()` uses that answer, or starts the read and opens when it lands; while it is out the trigger is
  `busy` (Task 2) and Escape cancels; a read that fails sets `failed`, which the trigger's caller shows as a plain line
  under it (`That didn't load. Try again.`) until the next press. The overlay mounts only with `data`, so its
  entrance plays over finished content.
- **The reveal overlay** takes its boards from `useBoot()` (reading `boards()` only where boot is null), so it opens
  at once with no read; its threads for a chosen board and "Show older threads" show a `Spinner` beside the select and
  make the button busy.
- **The play form** opens through `usePrepared` over its `actsById([post])`; its trigger in `PlayActions` spins.
- **The Lens's tabs:** Report (`reportsLeft`, `beatMod`), Appeal (`act(infraction)`) and Visit (`visitStory`,
  `tallies`, `myReactions`) each read before their tab shows, their tab button busy meanwhile; their in-form
  `aria-busy` and "Reading…" lines go. The moment's button is busy over `playMoment`, and "Loading the moment…" goes.
- **The ban appeal** opens through `usePrepared` over `myBan()`, and "Reading the ban." goes.

**Test first:** in `prepared.test.tsx`, `early` then `open` makes one read and opens at once; `open` alone is busy
until it lands; Escape cancels and nothing opens; a failure shows the line. In each overlay's test, the overlay's first
render holds its whole content. Red: no such hook.

## Task 15. Every glass wait is a busy button

Model: haiku

**Files, each control named:** `engine/ui/account/SignIn.tsx:165, 178, 179` (the `Sending…` and `Checking the code…`
lines go; the status keeps only errors), `engine/ui/account/OpenAccount.tsx:66, 71, 72`,
`engine/ui/account/Invites.tsx:134, 142`, `engine/ui/characters/NewCharacter.tsx:97`,
`engine/ui/characters/Characters.tsx:249, 328, 342`, `engine/ui/characters/TurnDialog.tsx:157`,
`engine/ui/characters/DebutDialog.tsx:62`, `engine/ui/characters/RevealOverlay.tsx:128`,
`engine/ui/profile-edit/ProfileEdit.tsx:157`, `engine/ui/profile-edit/Cropper.tsx:247`,
`engine/ui/admin/WriteUpdate.tsx:144`, `engine/ui/admin/AdminContact.tsx:145, 147` (the `Saving…` line goes),
`engine/ui/admin/Queue.tsx:195, 243, 314, 516`, `engine/ui/cards/Lens.tsx:365`, `engine/ui/cards/Forms.tsx:143, 252`,
`engine/ui/vending/Vending.tsx:184`, `engine/ui/alerts/Alerts.tsx:207`. The line numbers are main's at b16f21c; the
control is the one at or next to that line whose `disabled` or `aria-disabled` is its wait flag.

Each such `GlassButton` takes `busy={flag}` in place of `disabled={flag}` (or `aria-disabled={flag}`); a `disabled` that
also stands for something other than the wait (an empty field) keeps that part, as `disabled={!ready}` beside
`busy={sending}`. A control that is not a `GlassButton` today becomes one, with the kind its styling matches
(`primary` for a filled control, else `secondary`). `NewCharacter`'s create button stays busy through the move it
makes: its `navigate` passes the button's source (Task 1), and it reads `busy={creating || pendingFromMe}`. The board's
own buttons (`NewThread`, `Composer`, `EditPost`, `SpinForm`) are the board's and do not change.

**Test first:** in each file's test, the control is `aria-busy` while its write is out, keeps its label as its name,
and ignores a second press; Sign-in shows no `Sending…`. Red: `disabled`, no `aria-busy`.

## Task 16. End to end

Model: sonnet

**Files:** `e2e/glass-load.spec.ts` (new); the `?latency=` switch the forum-load plan added (`web/src/data/backend.ts`).

With `?latency=300`: from a board, the HUD avatar shows its spinner and the board stays until My characters lands, then
the crossing opens over a complete roster (its panels present in the first frame of the glass, by a check in the same
animation frame the glass mounts); from My characters, pressing the Log tab keeps the roster and spins the tab, and the
Log's lines are present when its entrance starts; a hover on the Log tab and then a press shows no spinner; Escape
during a load leaves the old screen; the reveal overlay opens with its boards; a failed load (the latency switch's
`?fail=log_page`, added here in the development and end-to-end builds only) shows "This screen didn't load" and Try
again loads it; with Motion Off the spinner's bars do not move. `npm run build` passes once, after this task.

## Review focus

- A glass document that holds one view more than the screen read (or another column set) puts a fact in the browser
  the old reads did not: compare each document's fields with the reads it replaces, not only with the guard.
- `log_page` computes `around`'s pieces over every row read, not only the page's cut: confirm the extra rows are the
  caller's own and public Acts, and its cost at 13 × 200 rows on a busy player's log.
- `alerts_page`'s recursive CTE must stop at depth three and use `acts_public`'s indexes; a quote cycle must not loop.
- A prefetch on hover must never write: no `see_alerts`, `see_settlement`, `see_welcome` or `mark_read` in a loader, and
  the cache must not carry one account's glass document to the next.
- The crossing reads the HUD tab's rect in the render that changes the world (`web/src/App.tsx`, `glassMotion`): now that
  the world changes when a load lands, not at the press, check the rect is still the HUD's and the board's hold limit
  still holds.
- Keying `Page`'s screen by the route's key: a key change mid-entrance, focus on a key change, and a move within one tab
  (Characters ↔ Edit profile share a key) must not replay the menu bar's slide.
- A busy `GlassButton` with `to` must stop being busy when its load is replaced, cancelled or fails, or it spins forever.
- The menu bar's end spinner must not show beside a tab already spinning: the registry of claimed sources.
