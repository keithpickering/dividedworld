# Glass load: a screen arrives whole, and its entrance plays over it

Record, written 2026-11-07. A design session with the owner, after the glass's motion merged. In their words: "the outro
animations look really nice, really noticeable, smooth. The intro animations can't really be seen because I assume at
the time the animation is playing, the components on that screen are not actually loaded in. If we introduced
preloading and popping in a whole kind of route at once, that would probably let us apply the intro animation to the
completed screen"; "that applies anywhere we're fetching data after a component mounts, mainly on a new screen, but I
assume it could also happen on modal open events"; and "we could have in the glass a loading spinner, because that's
more game-like." It takes up what the forum-load design left open (`docs/plans/2026-11-05-forum-load-design.md`,
sections 9 and 13: "the glass's loaders and its own way of showing loading"). The plan that carries it out is
`docs/plans/2026-11-07-glass-load-plan.md`; the spinner mock the owner chose from is
`docs/research/2026-11-07-glass-load/spinner.html`.

World: the glass (`docs/plans/2026-10-29-two-worlds-design.md`) for the spinner, the busy button and the two glass
error screens. The board gains nothing visible: its IE6 meter runs as it does for any load.

## 0. Where it starts

Read from the code on 2026-11-07 (`main` at b16f21c):

- The router can load before it moves (`engine/ui/router.tsx`: `load`, `key`, prefetch on rest, focus and press, the
  history cache, Escape), and the five board routes use it (`web/src/App.tsx`, `routesFor`). Every glass route is
  render only, so it commits at once.
- Each glass screen mounts and then reads in an effect, showing an empty `aria-busy` block until it lands
  (`engine/ui/characters/Characters.tsx:145`, `engine/ui/log/Log.tsx:281` and a dozen more). The lazy screen chunks
  (`web/src/App.tsx:45-59`) add a Suspense fallback on a first visit.
- The entrance (`engine/ui/glass/enter.ts`) staggers only what is on the page when the screen mounts, from
  `Page`'s layout effect on `[path]` (`engine/ui/glass/Page.tsx:65-70`). So it plays over an empty column, and the rows
  that land later appear plainly. That is the gap the owner saw. `Page` keys its screen by path alone, so a change of
  query (a Season tab, a Settings section, `?page=`) swaps nothing and plays nothing.
- Some reads chain: Log is six waves (`engine/ui/log/useLog.ts`), Alerts three, Season's Rankings three, the admin queue
  two, Edit profile two. Several re-read what boot already holds (`isAdmin`, `preferences`, `myCharacters`,
  `nextSettlementAt`, the session).
- Overlays that read on open: the reveal overlay's threads (`engine/ui/characters/RevealOverlay.tsx`), the play form
  (`engine/ui/cards/PlayForm.tsx`), the Lens's report and appeal tabs and its visit tab and moment
  (`engine/ui/cards/Forms.tsx`, `Visit.tsx`, `Moment.tsx`), and the ban appeal (`Forms.tsx`, `BanAppeal`). The move
  notice already reads before it opens.
- No glass control shows a wait other than by going disabled; Sign-in says "Sending…" and the admin contact
  "Saving…".

## 1. How a glass move waits

**Decided** (the owner chose "stay, spin, then move"). The glass routes get loaders, as the board's have. On a press
the old screen stays drawn and clickable and the control pressed shows the spinner. When the whole screen is ready, its
document and its lazy chunk loaded side by side, the router commits, and the outgoing screen's exit and the incoming
screen's entrance play together over the finished screen. A link's load starts on rest, focus or press, as the board's
do. Escape cancels; another press replaces the load; Back and Forward within five minutes draw from the cache at once.
The crossing between the board and the glass is a move like any other: it opens from the HUD tab when the glass
screen's document lands.

Weighed: moving at once and spinning in the new screen's place (instant answer to a press, but every slow load shows an
empty glass); holding briefly and then moving (two behaviors to learn and test).

## 2. Where the spinner shows

**Decided** (the session's call, confirmed by the owner). The control that started the load spins: a glass button, a
menu-bar tab, a HUD control, Back to the board, or a plain text link in the glass, where the spinner follows the text.
The router learns which control by a `source` each navigation names; `Link` names its own, and the few calls that
navigate by hand name the control they stand for (the Season tabs' arrow keys name the tab moved to, Esc on the glass
names Back to the board); that mechanism is the session's, from the code read after the owner confirmed. A write that ends in a move (Create character, then My characters) keeps its button busy
until the next screen lands. On the board the IE6 meter runs for any load, a crossing included, and the HUD control
pressed spins too, since the HUD is the glass's piece. A glass page with a load out whose source is not on it (a
navigation from code that names none) shows the spinner at the end of its menu bar, so a wait is never invisible (the session's call, after confirmation;
the owner reviews it with the plan).

## 3. The spinner and the busy button

**Decided** (the owner chose Signal, option C of the mock). Four bars on the glass's slant rise in a wave, in the color
of what they sit on (the neon on a tab, the ink on a primary button), from the glass's tokens. With Motion Off, or the
device's reduced motion, the bars stand still and lit in a rising step, so a wait still reads as a wait.

`GlassButton` gains `busy`. The label and the spinner share one grid cell, so the button keeps the label's width; the
label fades out and the spinner in (and back), which the owner allowed: "fading the label entirely to display the
spinner (and vice versa) is acceptable". A busy button is `aria-busy`, keeps its label as its accessible name, and
takes no second press. **Decided** (the owner: every glass wait): it is used for loads and for writes, so "Sending…",
"Checking the code…" and "Saving…" become the spinner on their buttons, and every glass control that goes disabled while
it waits on the server today takes `busy` instead.

## 4. Overlays and modals

**Decided** (the owner chose "button spins, opens whole"). An overlay that reads opens only once its data has landed:
the trigger spins meanwhile, rest or focus on the trigger starts the read early, and Escape cancels. Its entrance then
plays over finished content. An overlay that opens by itself (the settlement summary, the move notice) loads before it
appears, as the move notice already does. A read inside an open overlay that a press starts (the reveal overlay's
threads for a chosen board, "Show older threads") spins that control.

## 5. Reads inside a screen

**Decided** (the session's call, confirmed by the owner). A route's key names what its document is, so a press that
changes the key (a Season tab, a Settings section, a Rankings page) is a load: the tab or link spins and the new
content enters, with no menu-bar slide, since it is the same tab. A read a press starts within a key ("Show older
lines" on the Log, older alerts, earlier news and updates) is handed to the router's `track`, spins its button, and the
rows it brings enter by the stagger. Rows that arrive by Realtime or a refresh after an action still appear plainly.

## 6. First load and failures

**Decided** (the session's call, confirmed by the owner). A fresh load at a glass address waits for boot and the screen
together, as a board address does, and the whole page then enters. A glass load that fails or runs past 20 seconds
shows a glass screen, not the board's IE6 page: plain, out of character, with Try again and Back to the board. A thing
that is not there (a season that does not exist) shows a glass "can't be found" with Back to the board. Both are the
glass's plain voice ("The fiction may lie; the log never does"); the owner approves their words in review.

## 7. One request per screen

**Decided** (the owner chose a screen function each). Each glass screen that reads gets one `*_page` function, plain SQL
with a SQL-standard body, `security invoker`, `stable`, granted to `authenticated`, and held by the screen-function
guard (`supabase/tests/e2e/0016-screen-reads.ts`) to the browser's list of reads. Each piece is the shape the adapter
reads today, by the same views, so the screens hydrate the stores they hydrate now.

What each screen reads, from the survey on 2026-11-07:

| Route | Document | Holds |
| --- | --- | --- |
| `/characters`, `/characters/edit` | `my_characters_page()` | for each of the caller's characters: the public face and profile, post counts, standing, class reveals, Turns announced |
| `/season` | `season_page(tab, season, character, page)` | the season; for Rankings, the finished seasons and the current standings page (with reveals and Turns) or a finished season's results; for News, the first page of news |
| `/alerts` | `alerts_page(before)` | a page of alerts, the Acts they point at (and the up to three rounds of Acts those quote), their authors, the threads' opening Acts, the caller's reading, `alertsSeenAt`, the account's opening date |
| `/updates` | `updates_page(update, before, handover_season)` | a page of updates; the open update's tallies and the caller's reactions; for an admin writing a handover, the queue |
| `/admin/queue` | `queue_page()` | the queue, board names, the boss roster, the admin contact; refused for a non-admin, which the screen shows as it does today |
| `/log`, `/log/settlement` | `log_page(before)` | what `readLogPage` and `around` read today, the estimate excepted |

Where a screen's whole read is already one request it is its document: Contact (`adminContact()`, readable signed
out) and the Settings account section (`invites()`). The screens that read nothing boot does not hold get no loader:
New character, Vending, Guide, Sign-in, Settings' other sections and Welcome (whose `seeWelcome` is a write on
landing, as now). The estimate is an edge function, so the Log's loader reads it beside `log_page`, through the
adapter's cache, as boot does.

On the path, and so in this plan: the glass's reads of what boot holds are taken from boot (`isAdmin` in the menu bar,
Updates, Invites and the queue; `preferences` in Settings, Welcome and Alerts; `myCharacters` in Season, Alerts and the
Log; `useSession` in Settings and Sign-in reads the player's session).

Weighed: loaders over today's calls in parallel (no SQL, two to five requests a move and two patterns of route), and a
mix by screen.

## 8. The rules

- **The masks** (CLAUDE.md, "A response never proves a private fact"). Every document holds the projections today's
  reads return, read as the caller, held by the guard to the browser's list; the caller's own rows in them are the
  caller's own. The glass-polish design said "no animation waits for a response"
  (`docs/plans/2026-11-04-glass-polish-design.md`, sections 9 and 10). This design changes that on purpose: an entrance
  now waits for the caller's own screen document, whose time depends on the page's size and the caller's own rows,
  never on who owns another mask, exactly as a board page's does. The spinner's motion is a constant of the clock. A
  refusal (the queue for a non-admin) is about the caller's own account.
- **Ways out** (CLAUDE.md, "No player is ever stuck"). A wait ends when it lands, fails (the glass error screen, with
  Try again and Back to the board), runs past 20 seconds (the same), is replaced by another press, or is cancelled with
  Escape; an overlay's wait the same, minus the error screen (its trigger stops spinning and a plain line under it
  says the read failed, with the trigger to press again; the session's call, after confirmation). No state is added to a player, a character or a post.
- **Accessibility** (CLAUDE.md, "An accessible path costs what the obstacle costs"). Loading is no game obstacle. The
  glass page is `aria-busy` while a load is out and a polite status says when the screen has loaded; a busy control is
  `aria-busy` and keeps its name; with Motion Off nothing moves.
- **The layers** (CLAUDE.md, "KayfaBB never knows which instance it runs"). All engine: the loaders, the screen
  functions, the source, the spinner, the busy button, the error screens. The spinner draws in the glass's tokens; no
  instance file changes and no interface is added.
- **Portable** (CLAUDE.md, "Portable by construction"). The screen functions are plain SQL.
- **A busy instance** (CLAUDE.md, "Weigh a design at the scale of a busy instance"). Every document is bounded: a page
  of alerts, updates, news, standings or log lines, or the caller's own characters. Prefetch on rest costs one bounded
  request per link a player considers, as on the board.

## 9. Open

- The spinner's period and the bars' heights are starting numbers, to be tuned once seen in place.
- Whether the Log's second read "at instant" (`log-page.ts`) belongs inside `log_page` or stays a second request on
  the rare page that needs it is the build's to measure; the plan starts with it inside.
