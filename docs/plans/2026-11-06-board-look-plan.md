# The 2003 board look: plan

Record, written 2026-11-06. Carries out `docs/plans/2026-11-06-board-look-design.md`. Where this plan and the design
disagree, the design wins on what is decided and the boards on how it looks. The boards are
`docs/research/2026-11-06-board-look/` (written by its `gen.mjs`, each with its `.png`); `00-look.html` is round one's
switchable board and the tribute themes' reference.

## The layers

- **The engine** (`engine/ui/`, `engine/system/`, `supabase/`) gains the token vocabulary, the period table, the Chrome
  button, the folder icons, the post's three cells, the Information box, the staff postbit on a staff character's post, the
  theme preview's build step, the theme and mode split, and Settings › The board. It names no instance and no theme.
- **Divided World** (`instances/divided-world/`) supplies the Silver house theme, the four tribute themes, the 80×15
  badges' words, the staff board's name, description and tag, the role word ("The Boss"), the word for an unsigned Act's
  author, and the game's word for itself in the glass ("the game").
- Interfaces that carry it: `InstanceUi.themes` (`engine/ui/types.ts`, `ThemeOption`, which gains `preview`),
  `InstanceUi.copy` (`UiCopy`, which gains the keys Task 11 names), `Instance.boards` (`instances/divided-world/index.ts`),
  and the board's own data.

## The board match

Each task that builds a board's screen adds its manifest under `e2e/boards/2026-11-06-board-look/` (one per light board,
held by `e2e/board-match.ts` as `e2e/boards/2026-11-05-backfill/` are) and adds the folder to `BOARD_FOLDERS` in
`e2e/boards.spec.ts` with Task 3. A dark board and a tribute look are compared on colors only, by the contrast test
(`web/contrast.test.tsx`) and the reviewer's eye; their places are the light board's. Task 6 moves the board-world
landmarks of `e2e/boards/01-main.ts` (the thread's type, the postbit, the post line, the crumb and pager) to
`04-thread`'s manifest; 01-main keeps the HUD, the hand and the game's pieces.

Verdana and Courier New are not installed where CI renders; the boards were drawn on their substitutes, and a manifest
compares the build on the same machine, so the two agree. Where a measured nudge depends on Verdana's metrics (Task 3's
mini avatar), the build measures it in a story test on the font the page loads.

## Task 1. The token vocabulary, and a contrast check that reads gradients (engine)

Model: sonnet

**Files:** `engine/ui/tokens.css`; `engine/ui/contrast.ts` and `engine/ui/contrast.test.tsx`; `tools/check-theme.mjs` and
`tools/test-theme.mjs`.

`tokens.css` gains the period skin's tokens, each with a default that draws today's black-and-white board exactly, so an
instance that sets none of them looks as it does now:

| Token | What it paints | Default (light / dark) |
|---|---|---|
| `--kb-grid` | the gap between cells (`cellspacing`) | `--kb-rule` |
| `--kb-frame` | a table's and the banner's outer edge | `--kb-rule` |
| `--kb-row-1`, `--kb-row-2`, `--kb-row-3` | alternating rows; counts, post feet, labels | `--kb-bg` |
| `--kb-head-bg`, `--kb-head-fg`, `--kb-head-shadow` | the column heads' band | `--kb-bg`, `--kb-fg`, `none` |
| `--kb-bar-bg`, `--kb-bar-fg`, `--kb-bar-shadow` | the light band: a section's heading | `--kb-bg`, `--kb-fg`, `none` |
| `--kb-banner-bg`, `--kb-logo-fg`, `--kb-logo-shadow` | the banner | `--kb-bg`, `--kb-fg`, `none` |
| `--kb-nav-bg`, `--kb-nav-fg` | the boards' bar | `--kb-bg`, `--kb-link` |
| `--kb-link-hover` | a link under the pointer | `--kb-link` |
| `--kb-input-bg`, `--kb-input-edge`, `--kb-input-shadow` | text boxes | `--kb-bg`, `--kb-rule`, `none` |
| `--kb-button-bg`, `--kb-button-edge`, `--kb-button-fg`, `--kb-button-fg-shadow`, `--kb-button-case`, `--kb-button-radius` | the Chrome button (Task 4) | today's bordered box: `--kb-bg`, `--kb-rule`, `--kb-fg`, `none`, `none`, `0` |
| `--kb-button-primary-bg`, `--kb-button-primary-fg` | a form's one primary button | `--kb-fg`, `--kb-bg` |
| `--kb-icon-ink`, `-back`, `-front`, `-new`, `-hi`, `-line`, `-hot` | the folder and nav icons (Task 5) | black and white |
| `--kb-badge-a`, `--kb-badge-a-fg`, `--kb-badge-b`, `--kb-badge-b-fg` | the footer's 80×15 badges | `--kb-fg`, `--kb-bg`, `--kb-bg`, `--kb-fg` |
| `--kb-scrollbar-thumb`, `--kb-scrollbar-track` | the page's scrollbar (`scrollbar-color`) | `auto` |

A background token may hold a gradient or a layered background. `contrast.ts` reads a token's color stops when its value
is a gradient (`linear-`, `radial-`, `repeating-`) and checks a text pair against every stop, taking the worst, so a
band's lettering is held on its darkest and lightest ends. `PAIRS` gains: `--kb-fg` on each row, `--kb-muted` on each
row, `--kb-link` on each row, `--kb-head-fg` on `--kb-head-bg`, `--kb-bar-fg` on `--kb-bar-bg`, `--kb-nav-fg` on
`--kb-nav-bg`, `--kb-logo-fg` on `--kb-banner-bg` (3:1, large text), `--kb-button-fg` on `--kb-button-bg`,
`--kb-button-primary-fg` on `--kb-button-primary-bg`, `--kb-fg` on `--kb-input-bg`, and `--kb-badge-a-fg` on
`--kb-badge-a` and its b pair (decorative and hidden from assistive tech, so 3:1).

`check-theme.mjs` already admits any `--kb-*` declaration; it gains one refusal: a token whose value names `url(` (a
theme's art must be the instance's own file, never a fetch, since an outside image can watch who reads a page, the
screens design, section 12).

**Tests first:** a theme whose head band runs `#fff` to `#2b2b2b` under `--kb-head-fg: #fff` fails on the light stop;
the defaults pass and draw today's board (a story test compares `getComputedStyle` of a thread table before and after);
`test-theme.mjs` poisons a theme with `--kb-banner-bg: url(https://example.com/x.gif)` and watches the check refuse it.

## Task 2. The Silver house theme (instance)

Model: haiku

**Files:** `instances/divided-world/ui/theme.css`; `PRODUCT.md`.

Set every Task 1 token for light and dark to the values in `docs/research/2026-11-06-board-look/gen.mjs` (`LIGHT` and
`DARK`, and the button, input and chip tokens added for batch 2), in the theme file's four blocks as
`engine/ui/tokens.css` says. Keep the theme's orbs, game colors and vignette as they are. The `ThemeOption` name becomes
"House". In `PRODUCT.md`'s Brand Commitments, "black and white" becomes "black, white and grays (the Silver house
theme: a gradient band behind the column heads, alternating rows, a charcoal dark mode), with Chrome image buttons", and
a sentence says the board offers the instance's tribute themes and that The System is never a voice in a player's copy
(the design's section 7). The PR that carries this waits on the owner (CLAUDE.md, Merging), since PRODUCT.md is the
owner's.

**Tests first:** `web/contrast.test.tsx` passes the house theme in both modes against Task 1's pairs.

## Task 3. The period table, the banner and the footer (engine)

Model: sonnet

**Files:** `engine/ui/base.css` (`.kb-table`); `engine/ui/frame/Frame.tsx`, `frame.css`; `engine/ui/index/Index.tsx`,
`index.css`; `engine/ui/presence/` (the Who is online box); `engine/ui/mini.tsx` (`Mini`); `engine/ui/types.ts`
(`UiCopy.badges`); `instances/divided-world/ui/index.ts`; `e2e/boards.spec.ts`; manifests `01-index`.

The look is boards `01-index` and `01-index-dark`.
- **`.kb-table`** draws as `cellspacing="1"` did: `border-collapse: separate; border-spacing: 1px`, the table's own
  background `--kb-grid`, its edge `--kb-frame`; `th` on `--kb-head-bg`; rows alternate `--kb-row-1` and `--kb-row-2`;
  a count cell (`.kb-num`) on `--kb-row-3` with tabular figures. A section heading (Who is online, Users browsing) is an
  `h2` in a cell on `--kb-bar-bg`. The index draws no icon column and no category row.
- **The banner and the boards' bar are one block**: the logo on `--kb-banner-bg`, the board links on `--kb-nav-bg` under
  it, each with its icon (Task 5's `home` and `board`).
- **The footer** ends every board page: "Powered by KayfaBB" and the instance's badges (`UiCopy.badges`, each a pair of
  short words; Divided World's are GAME ON, MASKS ON, KILTER OFF), in the 80×15 shape, hidden from assistive tech, set in
  a pixel face the instance serves from its own files (Silkscreen, OFL, beside the glass's fonts in
  `instances/divided-world/ui/fonts/`). It links nothing on the glass.
- **A mini avatar and its name are one unit** (`Mini` and its callers): an inline flex centered on the name's capitals,
  the nudge measured on the loaded Verdana.
- Selection, the focus ring and `scrollbar-color` read their tokens.

**Tests first:** the index's table has no icon column; Who is online's heading is an `h2`; the footer's badges are
`aria-hidden` and their words come from `UiCopy.badges`; the board match's `01-index` manifest.

## Task 4. The Chrome button (engine)

Model: sonnet

**Files:** `engine/ui/base.css` (`.kb-button`); the board's buttons and link-buttons (`engine/ui/board/Board.tsx`,
`NewThread.tsx`, `engine/ui/thread/Post.tsx`, `Follow.tsx`, `engine/ui/composer/Composer.tsx`, `Toolbar.tsx`, the pager in
`Thread.tsx` and `engine/ui/mini.tsx`); stories.

The look is boards `02-board`, `04-thread`, `05-reply`, `06-new-thread`. `.kb-button` is the 2003 Photoshop button: the
`--kb-button-*` tokens, a 1px edge, an inner highlight, a soft drop shadow, bold Verdana with a glow, its case from
`--kb-button-case` (lowercase in Silver; the accessible name is the copy's own). Two sizes (`data-kb-size="small"` for a
post's actions, the toolbar and Unfollow). `data-kb-primary` (Send, Start thread) takes `--kb-button-primary-*`.
`aria-expanded="true"` or `aria-current` draws it pressed in (an inset shadow), for Start a thread while its form is
open and the record's current kind (Task 9). A post's Quote, Spin thread, Edit and History, now `kb-link-button`, become
small buttons. Hover lightens; focus shows the board's ring.

**Tests first:** a post's actions are buttons named in the copy's case; Start a thread has `aria-expanded` and draws
pressed while open; Send is the reply form's one `data-kb-primary`.

## Task 5. The folder icons, the legend and the nav icons (engine)

Model: sonnet

**Files:** `engine/ui/board/Icons.tsx` (new), `Board.tsx` (`ThreadRow`, the legend), `board.css`; `engine/ui/frame/Frame.tsx`;
manifest `02-board`.

The look is board `02-board`; the drawing is `gen.mjs`'s `ICONS` and `px()`. Each icon is an inline SVG drawn at its
viewBox's own whole-pixel size (24×20 folders, 16×14 nav icons, 14×14 Start a thread), every stroke on a half pixel,
never scaled, filled from the `--kb-icon-*` tokens. A thread row's status cell draws one folder from `isNew` and `isHot`:
new (a sheet in a dark folder), old (an empty light folder), either with the flame; its state as visually hidden text
("New", "New, hot", "Hot", "No new posts"), replacing the NEW and HOT chips (`.kb-flag`). The legend under the list is a
table row in `--kb-row-3`: New posts, No new posts, and "Hot: {n} replies this week" from `settings.hotReplies`. It names
no pin. Pinned threads keep their own `tbody` above the rest, split by a 4px row in `--kb-row-3`.

**Tests first:** a row new and hot draws the flame and names "New, hot"; a retuned `hotReplies` changes the legend's
number; the legend names no card; the `02-board` manifest.

## Task 6. A thread: the post's three cells (engine)

Model: sonnet

**Files:** `engine/ui/thread/Thread.tsx`, `Post.tsx`, `thread.css`; `engine/ui/postbit/postbit.css`; `e2e/boards/01-main.ts`;
manifests `04-thread`, `05-reply`.

The look is boards `04-thread` and `05-reply`.
- **A post is three cells of one color**: the post line (when, the post's marks, its permalink) in a cell of its own
  ruled edge to edge as a band for the marks; the words; the actions. Posts alternate `--kb-row-1` and `--kb-row-2`, and
  a 4px `--kb-row-3` row splits one from the next. The postbit spans the three.
- **The crumb names the board**: Index › its board › the thread, the board's name from the frame's board list by
  `ThreadSummary.board`.
- **The pager's current page** is a small band on `--kb-head-bg`.
- **Unfollow** shares the bottom pager's row, at its right.
- The reactions on a post are drawn by the reaction-marks build (the owner's in-progress work: a skewed glass tile, the
  emoji and a condensed count); this task changes no reaction and keeps their place under the words.

**Tests first:** the crumb links the thread's board; the post line is its own cell; the `04-thread` and `05-reply`
manifests; 01-main still passes with its board-world landmarks moved.

## Task 7. The reply box and New thread (engine)

Model: sonnet

**Files:** `engine/ui/board/NewThread.tsx`; `engine/ui/composer/Editor.tsx`, `Composer.tsx`, `composer.css`; tests;
manifest `06-new-thread`.

The look is boards `05-reply` and `06-new-thread`. **New thread's first post uses `Editor.tsx`** (the design, section 3,
decided with the owner): the toolbar, Preview, the count, and Ctrl+Enter or Command+Enter, its hint reading "Ctrl+Enter or
Command+Enter starts it". Both forms open under a light band (Reply, Start a thread), say who is posting, draw their text
box inset (`--kb-input-*`), and keep one primary button.

**Tests first:** New thread previews its first post; Ctrl+Enter starts the thread; the `06-new-thread` manifest.

## Task 8. The phone (engine)

Model: sonnet

**Files:** `engine/ui/board/Board.tsx`, `board.css`; `engine/ui/index/Index.tsx`, `index.css`; `engine/ui/postbit/Postbit.tsx`,
`postbit.css`, `dates.ts`; `engine/ui/profile/Profile.tsx`, `Record.tsx`, `profile.css`; manifests `03-phone`, `07-phone`,
`10-phone` (each at 390).

The look is the phone boards. A thread row's counts fold into one line ("169 replies · 4 views · last: Pipewrench, Oct
5"), and the index's the same ("3 threads · last: …"). The stacked postbit drops Posts and Joined (the design, section 3,
decided with the owner). A date in the current year drops its year on the phone. A record row's date stacks above it.
The toolbar's nine buttons and the record's six kinds fit one row. Boards is a Chrome button in the banner.

**Tests first:** at 390 a thread row's counts are one line; the stacked postbit has no Posts; a date this year has no
year at 390 and has one at 1440; the three phone manifests.

## Task 9. A profile and its record (engine)

Model: sonnet

**Files:** `engine/ui/profile/Profile.tsx`, `Record.tsx`, `profile.css`; `docs/plans/2026-11-04-cosmetics-plan.md` (Task 10's
look); manifests `08-profile`, `09-record`.

The look is boards `08-profile` and `09-record`. The profile's facts are rows of a table under an "About {name}" band,
each fact's label a row header in `--kb-row-3`, right-aligned and bold: Title, Rank, Aura this season, Place, Posts,
Threads spun, Cards played, Joined, Class, each fact's words and links as now. The signature closes the card under a
short rule. The record's five rows share one table with its band and heads, See the full record at its right. The full
record's kind filter is a row of small Chrome buttons, the current one pressed (`aria-current`).

The cosmetics plan's Task 10 line "The look is boards 01 and 03." gains "; the profile's, in the house theme,
`docs/research/2026-11-06-board-look/08-profile.html`" (the Wearing row, the trophy case table and the belt's lineage as
that board draws them).

**Tests first:** each fact is a row with a row header; the record's current kind has `aria-current`; the two manifests
(drawn without the cosmetics parts, which are the cosmetics plan's to build).

## Task 10. The staff on the board: the move notice, a staff profile, the Boss's postbit (engine)

Model: sonnet

**Files:** `engine/ui/board/MoveNotice.tsx`, `move.css`; `engine/ui/profile/Staff.tsx`, `profile.css`;
`engine/ui/postbit/Postbit.tsx`, `StaffBadge.tsx`; manifests `11-move-notice`, `14-staff`, `15-phone`.

The look is boards `11-move-notice`, `14-staff` and `15-phone`.
- **The move notice** is a table: a light band reading "Announcement from {Boss}" (a link), the Boss's words, its top
  reactions; the glass label on the band's corner, breaking the frame, as now. On the phone each label segment keeps its
  words whole and Way out wraps under the label.
- **A staff profile** takes Task 9's card: its badges, title, interests, favorite members, mood, career, posts and joined
  as label rows; its signature and the plain note under it; the moderation log as one full-width table under the card
  (When, What it did, How it ended), paged as now.
- **A staff character's postbit** (any post a staff character signs) shows its name, its badges, its title, its avatar
  and its posts and joined, and no rank.

**Tests first:** a staff postbit draws no pips; the log is one table under the card; the two manifests.

## Task 11. Who speaks: The System leaves the copy (engine, instance)

Model: sonnet

**Files:** `engine/ui/types.ts` (`UiCopy`); `instances/divided-world/ui/index.ts`, `instances/divided-world/index.ts`
(`boards`); `engine/system/moves.ts` (the labels); `engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`,
`MoveNotice.tsx`, `engine/ui/thread/Thread.tsx`, `Post.tsx`, `engine/ui/spin/Origin.tsx`, `engine/ui/characters/previews.ts`,
`footers.ts`, `reveal.ts`, `TurnDialog.tsx`, `DebutChoice.tsx`, `engine/ui/log/lines.ts`, `Settlement.tsx`,
`engine/ui/season/Season.tsx`, `engine/ui/composer/Composer.tsx` (`SystemBoardNote`), `engine/ui/data/fake.ts`; the tests and
fixtures that name the board's slug.

The design's section 7. `UiCopy` gains `roleWord` ("The Boss"), `staffWord` ("The staff", an unsigned Act's author and
the index's last-post name for one), `gameWord` ("the game"), and `staffBoardTag` ("Staff post here; you react and
spin"). Each string `engine/ui/` hard-codes as "The System" today moves to these keys or to the board's own data:
- the index's tag and its last-post name; the board's read-only note ("Only the staff post here. You can react to what
  they say, and spin a thread from it."); a thread's and a post's name for a null character;
- the move labels in `engine/system/moves.ts` become templates on the actor's role: "{role} renamed this board", "{role}
  named its successor", the role from `roleWord` (a Mod Bot's move, when Mod Bots move, from its own role word);
- the glass's plain voice: "The game paid you {n} Aura", "checked by the game", and the debut and Turn copy
  (`DebutChoice.tsx`, `TurnDialog.tsx`, `footers.ts`) takes the words #281's plan gives it, an announcement being the
  character's own Promo; where #281 has not landed when this task is built, it says "The board announces it" and names
  no one; Season News's "Its first words, on {board}:" from the
  board's name.
Admin screens (`engine/ui/admin/Queue.tsx`) keep "The System's moves".

Divided World's staff board becomes name "Staff Announcements", description "Where the staff post. Reply by spinning a
thread.", slug `announcements` (the address shows no "the-system"); General's description becomes "Anything and
everything. The staff are watching." The seed never renames an existing board (`0091_seed_reaction_kinds.sql`'s upsert
leaves the name), and no instance is deployed, so no migration renames one; a fixture or test naming `the-system` is
updated (a mechanical pass, `haiku` may take it as a sub-step).

**Tests first:** `engine/ui/` holds no "The System" in a player-facing string (a grep test that reads every `.ts` and
`.tsx` under `engine/ui/` except `admin/`, tests and comments, poisoned once with a planted string); the move label reads
"The Boss renamed this board"; a null-character Act's postbit reads `staffWord`.

## Task 12. Withdrawn

The Boss signing the reveal and the tally is replaced by the season end design and plan
(`docs/plans/2026-11-06-season-end-design.md` and its plan, #281), which builds the season's results in the glass and the
characters' `announce` Acts. Nothing of it is built here. The tasks after it keep their numbers, so a reference to Task
13 to 17 still holds.

## Task 13. The errors (engine)

Model: sonnet

**Files:** `engine/ui/frame/Unavailable.tsx`, `unavailable.css`, its tests and stories; manifests `16-not-found`,
`17-cannot-display`, `18-phone`.

The look is boards `16-not-found` and `17-cannot-display`. `CannotFind` becomes the forum's Information box: the light
band reading "Information"; the message, the page's `h1`, naming what was asked for by the address's first segment
(`/t/`: "The thread you requested does not exist."; `/b/`: "The board you requested does not exist."; `/c/`: "The
character you requested does not exist."; any other: "There is no page at this address."); "If you followed a link here,
it may be mistyped or out of date."; "Click here to return to the index", the whole sentence the link; "Address: …" in a
foot cell. `CannotDisplay` keeps its words and its pastiche as a sheet inside the frame, white in light and charcoal in
dark (its own colors, not the theme's: it is the browser's page).

**Tests first:** `/t/x` names the thread; `/nope` says there is no page; the h1 is the message; the three manifests.

## Task 14. A theme's preview, read from its file (tools, engine, instance)

Model: sonnet

**Files:** `tools/check-theme.mjs` (export its parse), `tools/theme-preview.mjs` (new) and `tools/test-theme-preview.mjs`;
`web/vite.config.ts`; `engine/ui/types.ts` (`ThemeOption.preview`); `instances/divided-world/ui/index.ts`.

A theme file imported as `theme.css?preview` becomes, at build time, a module of its preview tokens per mode (the banner,
nav, head, grid, rows, link and fg values the picker's miniature reads), parsed by the same code `check-theme.mjs` uses, so
the preview and the theme are one list (CLAUDE.md, "Two lists that must agree are one list"). `ThemeOption` gains
`preview: { light?: ThemePreview; dark?: ThemePreview }`, which the instance fills from that import beside each `href`.

**Tests first:** the preview of the house theme's light block carries its `--kb-head-bg`; `test-theme-preview.mjs`
poisons a theme with a preview token missing from the file and watches the build refuse it; the pair travels together
(`check-*`/`test-*`, the build's rule).

## Task 15. A theme and a mode, held apart (SQL, engine)

Model: sonnet

**Files:** `supabase/migrations/NNNN_board_mode.sql` and its SQL test; `engine/ui/appearance.ts` and its test;
`engine/ui/account/preferences.ts`; `engine/ui/data/api.ts`, `fake.ts`, the Supabase adapter.

`account_preferences` gains `mode text not null default 'system' check (mode in ('system','light','dark'))`, and
`set_preferences` takes it. `theme` keeps its column and its check, and its meaning narrows to which theme: `default`
(the instance's first theme, so the engine names none) or a theme's key. The migration rewrites each row once: `system`
becomes `default` with mode `system`; `light` and `dark` become `default` with that mode; any other key stays, with mode
`system`. `AppearancePreference` gains `mode`; `resolveAppearance` takes the theme from `theme` and the mode from
`mode`, and a one-mode theme fixes the mode whatever `mode` says, keeping `mode` stored, so choosing the house theme
again returns the player's own mode.

**Tests first:** a stored `dark` theme reads back as `default` in dark; Hot Rod with `mode = 'light'` resolves to
dark and keeps `light` stored; the SQL test's migration of both old values.

## Task 16. Settings › The board (engine, glass)

Model: sonnet

**Files:** `engine/ui/account/Settings.tsx`, `appearanceRows.tsx`, `account.css`; `engine/ui/account/ThemePicker.tsx` (new)
and its test and story; `engine/ui/welcome/Welcome.tsx` (Before you start); `e2e/glass-screens.ts`; manifests
`19-theme-picker`, `20-theme-picker-one-mode`, `21-theme-picker-phone`.

The look is boards 19 to 21. Settings gains the section "The board" between Accessibility and Notifications
(`SECTIONS`, `?section=board`), and Accessibility loses its board row. The section holds:
- **Theme**: the chosen theme's preview (the board's first screen in miniature, drawn from `ThemeOption.preview` in the
  resolved mode), then one tile per theme (a thumbnail, its name, its modes: "Light and dark", "Light only", "Dark
  only") as one radio group; a choice applies at once and saves, as `ThemeRow` does now. "Applies to the board at once,
  on every device you sign in on."
- **Mode**: Follow my device, Light, Dark, as the glass's skewed radios. For a one-mode theme the row is held to its
  mode, the others disabled, and the note says why: "{name} comes in {mode} only, so the board stays {mode} whatever your
  device says. Choose {house} for light and dark." Otherwise: "The 2003 board stays 2003 whichever you choose. Only its
  look changes. The game's own pieces (orbs, cards, reactions, marks) keep theirs."
- On the phone the preview drops its last-post column, the tiles are a three-column grid, and Mode's choices stack.
- The welcome page's Before you start shows the tiles alone, sharing the control.

`e2e/glass-screens.ts` gains "Settings › The board" held to `2026-11-06-board-look/19-theme-picker`.

**Tests first:** arrows move between the tiles and the choice saves; a one-mode theme disables the other modes and says
so; the preview's banner carries the chosen theme's token; the three manifests; the layout and text runs read the new
screen.

## Task 17. The tribute themes (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/themes/blue-steel.css`, `midnight.css`, `hot-rod.css`, `fan-site.css` (new);
`instances/divided-world/ui/index.ts` (`themes`); `web/contrast.test.tsx`.

The looks are round one's board (`00-look.html`, the `LOOKS` table: `steel`, `midnight`, `hotrod`, `fansite`) as the
owner amended them: Blue Steel light only; Midnight dark only; Hot Rod dark only, its flames and its gray pillow-shaded
buttons (`--kb-button-bg` a radial gradient, `--kb-button-case: none`, black lettering); Fan Site in classic MFGG blue,
dark only, its tiled page drawn from plain shapes and its column heads in the grid-of-squares texture. A one-mode theme
sets its tokens on `:root` and in both dark blocks alike. Each passes Task 1's pairs; where a round-one value falls short
the task darkens or lightens it to the nearest passing value and says so in the PR. Fan Site's name is open (the design's
Open); the build ships it as "Fan Site" until the owner names it.

**Tests first:** each theme passes the contrast test in its modes; `check-theme.mjs` passes each file; the picker lists
five tiles.

## Ways out

The only state this plan adds is a one-mode theme holding the board's mode, and its way out is on the screen where it
shows: the note names the house theme, which holds both. A missing page names the index and the browser's Back.

## The masks

- A theme's preview is built from the instance's public theme files; it reads nothing about a player.
- The folder icon's new state is the reader's own reading row, as the NEW chip is now.

## Review focus

- Task 11's `staffWord` on an unsigned Act: the old reveal and tally Acts still draw, named as the staff, after #281's
  build stops writing them.
- Task 15's migration of stored `light` and `dark` themes: a player's choice survives as the house theme in that mode,
  and an instance whose first theme is not named "house" still resolves (the engine names no theme).
- Task 1's gradient parsing: a token holding several layers (Fan Site's head band) is read stop by stop, and a value it
  cannot parse fails the check rather than passing.
- The contrast floor on Chrome buttons in every theme: the label sits on a gradient with a hard midline, and both halves
  must carry it.
- A thread page at a busy instance draws each folder icon and each mini avatar inline per row; the icons are a handful
  of rects, but a 20-row board page and a 20-post thread should not grow their payload by more than the icons' markup.
- Task 11's sweep: no player-facing "The System" left in `engine/ui/`, and no instance's words left in the engine.
- The board match's move of 01-main's board-world landmarks to `04-thread`: nothing 01-main held is left uncompared.
