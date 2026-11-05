# Backfilling the boards: plan

Record, written 2026-11-05. Carries out `docs/plans/2026-11-05-backfill-boards-design.md` (its sections are cited as
§N). The boards are `docs/research/2026-11-05-backfill/` (14 to 40), written by its `gen.mjs`; where a board and the
design disagree, the design wins on what is decided and the board on how it looks.

**When it is built.** The boards are drawn on #202's head (c2553b3), which has since merged. A build session starts
from main, with whatever of the polish's Phases 2 and 3 has merged by then; a board
that the polish has since changed under it is a question to the owner, not a silent departure. Task 11's card info
waits for the card template plan (`docs/plans/2026-11-05-card-template-plan.md`) to merge. Three PRs, merged in order:
Phase 1 (Tasks 1 to 5, the machinery), Phase 2 (Tasks 6 to 9), Phase 3 (Tasks 10 to 13).

Every task is test first: the test named, its red run recorded, then the code, then the green run. A task that adds a
check adds its poisons in the same task. A task that holds a screen to a board writes that board's manifest
(`e2e/boards/…`, a default-exported `BoardManifest`, as `e2e/boards/01-main.ts` is) and takes the board out of
`PENDING` in the same change (Task 1); the manifest's first run against today's screen is the task's red run. Each
task's PR carries before and after screenshots at 390, 834 and 1440 of what it changed.

**Engine and instance.** Everything is engine (`engine/ui/`, `e2e/`, `tools/`) except where a task names an instance
file. Two tasks change an interface an instance fills: Task 7 (`ClassLook` gains `hurtsBy`) and Task 9 (`CardUi` gains
`status`). No task makes the engine name an instance.

**Copy.** New player-facing words are drafts the owner approves in review: they are listed in their task, and the PR
lists them again under "Copy for review".

## Phase 1: the machinery

## Task 1. The new boards in the board match, and the boards not yet built (§1.1, §1.4)

Model: sonnet

**Files:** `e2e/boards.spec.ts` (`BOARD_FOLDERS`, `PENDING`, the board-file loop), `e2e/board-match.ts`
(`boardsToRun`), `e2e/board-match.test.ts`.

- Add `docs/research/2026-11-05-backfill` to `BOARD_FOLDERS`. Add `PENDING` entries for its 27 boards (14 to 40), each
  naming the task of this plan that builds it, as `PENDING`'s comment asks ("the part … that builds it").
- Add the three folders of designs not built yet, `docs/research/2026-11-04-booster-packs`,
  `docs/research/2026-11-04-cosmetics` and `docs/research/2026-11-05-card-template`, with every board of theirs in
  `PENDING`, naming its plan (`docs/plans/2026-11-04-booster-packs-plan.md`, `…-cosmetics-plan.md`,
  `…-card-template-plan.md`). Their `.src.html` files are generator sources, not boards: the loop skips a name ending
  `.src.html`.
- **Board ids from a later folder.** Booster packs and cosmetics both draw a `05-admin.html`, so a bare file name no
  longer names one board. A board in the first two folders keeps its bare id (no manifest is renamed); a board in any
  folder after them is `<folder>/<name>`, and its manifest is `e2e/boards/<folder>/<name>.ts`. The duplicate check
  stays, over the ids.
- `PENDING`'s comment changes from the glass build plan to "the plan, and its task, that builds it".
- **Tests first** (`e2e/board-match.test.ts`, `boardsToRun` and the id rule as pure functions): a folder with a
  `.src.html` beside its board yields one id; two later folders each with `05-admin.html` yield two ids; a board in a
  later folder with neither a manifest nor a `PENDING` entry is a problem named by its id; a `PENDING` entry that has a
  manifest is a problem (as today). Red: the id rule does not exist.

## Task 2. Every glass screen names its board (§1.4)

Model: sonnet

**Files:** `e2e/glass-screens.ts` (`Screen`, every entry of `PAGES`, `OVERLAYS`, `FIXTURE_OVERLAYS`, `STORIES`,
`SETTLEMENT`), `e2e/board-match.ts` (a new `screensWithoutBoards`), `e2e/board-match.test.ts`, `e2e/boards.spec.ts`.

- `Screen` gains `readonly board: string | { readonly none: string }`: the id of the board the screen is held to, or why
  it has none (a sentence, never empty). Every entry gets one. The map, from §1 and the batches: Sign in `14-sign-in`;
  Register `15-register`; Reach a person `16-contact`; the HUD signed out `17-front-door`; Welcome `19-welcome`; Strategy
  Guide `20-guide`; New character `23-new-character`; the Debut dialog choosing how `24-debut`, dropping now `40-debut-now`; the Reveal modal `25-reveal`; Edit profile `26-edit-profile`; the
  three Lens stories `28-lens` and `29-lens-states`; My log before anything has settled `30-log-empty`; the log story with
  a settlement's posts open `31-log-open`; Settings › Account `33-settings-account`; the Vending Machine's card info
  `34-vending-info`; the HUD past its cap `35-hud-cap`; the admin queue `37-admin-queue`; and the screens the two-worlds
  and alerts boards already hold by their ids. A screen held by two boards names the one its manifest compares on.
- `screensWithoutBoards(screens, ids, pending)` returns a problem for: a screen with neither; a `board` that is no
  board's id; a `{ none }` with an empty or whitespace reason. A board in `PENDING` counts as a board (a screen may name
  a board its task has not built yet).
- `e2e/boards.spec.ts`'s first test also asserts `screensWithoutBoards(...)` is empty.
- **Tests first** (`e2e/board-match.test.ts`): each of the three poisons above is one problem, named by the screen's
  name; a screen naming a `PENDING` board is none. Red: the function does not exist.
- The phone boards (18, 22, 27, 32, 36, 39) are held by their batch's tasks at 390; `glass-screens.ts`'s screens are
  measured at every width, so a screen names its 1440 board and the phone board is compared by the same manifest file's
  second export (`export const phone: BoardManifest`), which `boards.spec.ts` runs at 390 by 844.

## Task 3. Region calms (§3)

Model: sonnet

**Files:** `engine/ui/glass/Smoke.tsx`, a new `engine/ui/glass/Calm.tsx` (`CalmRegion`, `useCalmRegions`),
`engine/ui/glass/calm.css`, `engine/ui/glass/tokens.css`, `engine/ui/glass/contrast.css`, `engine/ui/glass/calm.test.tsx`,
`e2e/glass-layout.ts` (refusals 5 and 6), `e2e/glass-layout.test.ts`, `e2e/glass-text-page.ts` (`calmOf`),
`tools/check-glass-contrast.mjs` (its comment only), and every screen that uses `kb-calm`
(`grep -rln "kb-calm" engine/ui instances --include=*.tsx`: 32 files, 167 uses on c2553b3).

- **The calm becomes a mask on the smoke.** `Smoke` draws, in its own `<svg>`, a `<mask>` whose white field holds one
  rect per registered region, filled black at the calm's opacity (`--kb-glass-calm-opacity`, or the surface's own, as
  `useSurfaceStyle` sets it today) and blurred by an `feGaussianBlur` of `--kb-glass-calm-feather` (the token becomes
  60px; the phone's 30px). The smoke's layers are drawn through that mask, as the boards draw theirs. The ground is
  never masked: a calm only takes smoke away, so it can never paint over content, and nothing can clip it but the
  smoke's own frame.
- **A region** is a `CalmRegion` (`as` any element, default `div`): it registers its border box with the nearest
  `Smoke` through context (a `ResizeObserver` and the page's scroll, coalesced to one `requestAnimationFrame`), in the
  smoke's own coordinates, and unregisters on unmount. A page has a few: its column, its aside, a dialog's body, each HUD
  panel. A region's rect is its box inset by nothing; the blur's falloff lies outside it, so every word inside the box is
  on the full calm, which is what `check-glass-contrast.mjs`'s model already says of a calm.
- **The screens move onto regions.** Each `kb-calm` use becomes part of a region that holds it. Where #202 capped the
  feather (under a title, in a dialog, on the phone), the cap goes: the blur is outside the region and costs no space.
  `kb-calm`, `--kb-calm-feather` and the caps leave `calm.css`; `check-css-classes` then refuses a stale `kb-calm`.
- **High contrast** (`contrast.css`): every region's rect is drawn at opacity 1 with no blur, so the smoke stays only at
  the screen's edges, as today's high contrast does.
- **The layout check.** Refusal 5 (a calm cut) and refusal 6 (a calm painted over content) are retired: a mask on the
  smoke can do neither. In their place, one refusal: **a text node on the glass outside every region's box**, on a
  surface that is `calmAll`, since that is the promise the contrast model rests on. Its poison in
  `e2e/glass-layout.test.ts`: a paragraph placed beside, not inside, its page's column region.
- **Tests first.** `calm.test.tsx`: a `CalmRegion` inside a `Smoke` puts one rect in its mask at the region's box, and
  removing it removes the rect (red: no component); the mask's blur reads `--kb-glass-calm-feather`; under high contrast
  the rect's opacity is 1 and its blur 0. `e2e/glass-layout.test.ts`: the new refusal, red on its poison. The e2e
  glass-text run is the proof the softness costs no contrast: it must pass unchanged at every screen, width and text size.
  If a screen cannot reach its ceiling with a soft region, the build stops and asks the owner (§3), and never hardens the
  calm.
- Measure the scroll cost on the Main board's moment at 390 with the CPU throttled 4x (Chromium's
  `Emulation.setCPUThrottlingRate`): the regions' rAF must not drop a frame while scrolling. Record the numbers in the PR.

## Task 4. A chamfered piece draws its border on the cut (§4, the owner's first nit)

Model: sonnet

**Files:** `engine/ui/welcome/welcome.css`, `engine/ui/updates/updates.css`, `engine/ui/guide/guide.css`,
`engine/ui/front-door/front-door.css`, and every other stylesheet that sets a `clip-path: polygon(` on a rule with a
border (on c2553b3: `engine/ui/log/settlement.css`, `engine/ui/vending/vending.css`, `engine/ui/cards/moment.css`,
`engine/ui/cards/lens.css`, `engine/ui/cards/marks.css`, `engine/ui/alerts/toasts.css`, `engine/ui/orbs/orbs-board.css`,
`instances/divided-world/cards/autocorrect/autocorrect.css`: read each, since some already draw the cut by hand), a new
`tools/check-chamfer-borders.mjs` and `tools/test-chamfer-borders.mjs`, `tools/build.mjs` (`STEPS`).

- Each clipped, bordered piece takes `engine/ui/glass/base.css`'s `.kb-glass-cut-panel`, `-dialog` or `-button` (the
  element is the border's color, cut; its `::after` is the panel one border in, cut by the line moved in by 0.5858 of the
  border), with its own `--kb-cut` and `--kb-border`. A piece whose ground is not `--kb-glass-panel` sets it on its
  `::after`. A hand-drawn cut that already runs its border along the diagonal (the Lens's plates, the marks) keeps it if
  the check below passes it.
- **The check** reads every `.css` under `engine/` and `instances/` (outside `engine/ui/glass/base.css`) and refuses a
  rule that sets both a `clip-path` with `polygon(` and any `border` or `border-*` width other than `0`/`none`, naming
  the file, the selector and the line. A rule may opt out with a comment on the line above,
  `/* chamfer: border drawn on the cut by <how> */`, which the check requires to say how.
- **Tests first** (`tools/test-chamfer-borders.mjs`): a rule with `clip-path: polygon(…)` and `border: 1px solid` is
  refused; the same rule with the opt-out comment that says how is passed; an opt-out comment with nothing after the
  colon is refused; a `polygon` with no border is passed; a border with an `inset()` clip is passed. Red: the check does
  not exist. `STEPS` gains the test, then the check, as `tools/build.mjs`'s comment says.
- e2e: the board match for 19 (Welcome) and 38 (Write update) holds the pieces' boxes; a computed-style test in
  `e2e/glass-dialogs.spec.ts` (or its own spec) reads that the welcome letter's `::after` has a `clip-path` and its
  element a background, on each of the four named pieces.

## Task 5. The menu bar holds nine tabs on one row (§8)

Model: sonnet

**Files:** `engine/ui/glass/MenuBar.tsx`, `engine/ui/glass/shell.css`, `engine/ui/glass/MenuBar.test.tsx`, a test in
`e2e/glass-layout-page.spec.ts` or its own spec.

- At 1440 the bar holds Back to the board and nine tabs (an admin's) on one row: the tabs' padding and letter-spacing
  step down as the count grows (the boards: 13px and 1.5px past five, 10px and 1px past eight). Where they still do not
  fit, the row scrolls sideways as the phone's does, fading at the edge where more wait, the current tab scrolled into
  view (#202's behavior on the phone). The bar is never two rows.
- **Tests first:** an e2e at 1440, signed in as an admin (`open(page, { …, asAdmin: true })`), reads that the bar's
  height equals a non-admin's and that every tab's top is the same; red on c2553b3 (140px against 84px). At 834 with nine
  tabs, the row scrolls and the current tab's box lies inside the bar's.

## Phase 2: the door, onboarding and characters

## Task 6. The door (§2; boards 14 to 18)

Model: sonnet

**Files:** `engine/ui/account/SignIn.tsx` and its stylesheet, `engine/ui/contact/Contact.tsx` and its stylesheet,
`engine/ui/frame/Hud.tsx` (the signed-out branch) and `engine/ui/frame/frame.css`, their tests; manifests
`e2e/boards/2026-11-05-backfill/14-sign-in.ts` … `18-door-phone.ts`.

- **Sign in and Register:** the form in a 680px column (lead, the field or fields, Send a code); the other ways in as an
  aside in the right column: on Sign in "New here?" with Register as a secondary GlassButton, on Register "Already
  playing?" with Sign in; both with "Stuck?" and Reach a person. The duplicate Register link and the parenthesized one in
  the lead go. The 18+ check is the glass checkbox (`accent-color` the neon, 30px), its line regular weight, the
  acknowledgement a note under it. On the phone the aside stacks under the form.
- **Reach a person:** each link a row in the Settings idiom (`.row`: the label in the label column, the link in the
  other); Discord as a secondary GlassButton, an email address as the link itself.
- **The signed-out HUD** in the signed-in HUD's frame (`Hud.tsx`'s panels, not a strip of its own): the "?" in the mask
  panel with "Who will you play as?" and the pitch; the Aura notch with six empty sockets and its line; Sign in
  (secondary) and Register with an invite (primary) as one ButtonRow, "No invite? Ask someone who plays." under it, by
  `registrationMode` as today. On the phone, the board's sheet.
- **Copy for review:** Sign in's lead "No password. We email you a code and a link; either one signs you in."; Register's
  "… either one makes your account."; "Registering takes an invite from someone who plays. The same email code signs you
  in after."; "Sign in with the email you registered."; "No code arrived, or the link has expired. The admins can
  help."; the invite note "Registration is by invite for now. Your invite link filled this in."; the notch's "No mask,
  no Aura, no hand yet. Your first character fills them."; "Open the Discord".
- **Tests first:** the screens' unit tests for the aside's headings and the single Register link (red: two links); the
  manifests' first runs (red: the aside and the HUD's notch are missing).

## Task 7. Onboarding (§4; boards 19 to 22)

Model: sonnet

**Files:** `engine/ui/welcome/Welcome.tsx` and `welcome.css`, `engine/ui/guide/Guide.tsx` and `guide.css`,
`engine/ui/tips/Spotlight.tsx` and `tips.css`, `engine/ui/frame/Hud.tsx` and `frame.css` (the phone's mask name), their
tests; manifests `19-welcome.ts` … `22-onboarding-phone.ts`.

- **Headings as written.** The welcome letter's heading and the guide's section headings drop `text-transform:
  uppercase`; each is set as the instance writes it, Anton, one line at 1440. Page titles, labels and buttons keep their
  capitals.
- **Before you start on the phone:** each setting is a full-width block: its label, its options wrapping whole (no option
  breaks inside its label: `white-space: nowrap` on the option's text), its note under them.
- **The tour's tip** stands on the glass's ground (`--kb-glass-ground`, not a lighter gray) with the violet edge, drawn on
  its cut (Task 4); the page behind is blurred as well as dimmed (`backdrop-filter: blur(5px)` on the dim, off under
  reduced transparency where the platform says so), so the cut-out is the one sharp thing. **The arrow meets the tip's
  edge**: `.kb-tips-arrow` starts one border above the tip's foot, not about 5px below it (the owner's second nit); an
  e2e reads the gap between the tip's box and the arrow's and requires it to be at most 0 (red: about 5px at 1440).
- **The stray cyan square** at the phone tour's top-left (390, step 1): find its cause first (a cut-out or a ring drawn at
  (0, 0) before its target is measured is the guess), write the test that sees it (a screenshot's top-left 12px holds no
  neon pixel while the tour is open, or the cut-out's box is never at (0, 0) with a zero size), see it red, then fix.
- **The phone HUD's mask name** is never cut: the name takes the row's width and wraps or shrinks to fit before it
  truncates (the board: "MRS. HOOLIGAN" whole beside Hand). An e2e at 390 reads that the name's `scrollWidth` equals its
  `clientWidth` for the demo's longest name (red: "NEWCOME", "STORY RE").
- **Tests first** as named; the manifests' first runs.

## Task 8. Characters (§5, §9; boards 23 to 27 and 40)

Model: sonnet

**Files:** `engine/ui/types.ts` (`ClassLook`), `engine/ui/characters/ClassCards.tsx`, `NewCharacter.tsx`,
`DebutDialog.tsx`, `DebutChoice.tsx`, `RevealOverlay.tsx`, `Characters.tsx`, `characters.css`,
`engine/ui/profile-edit/ProfileEdit.tsx` and its stylesheet, the instance's class looks
(`instances/divided-world/` where `ClassLook.description` is set: `grep -rn "description:" instances/divided-world/ui`),
`engine/ui/tips/problems.ts` (`instanceUiProblems`), their tests; manifests `23-new-character.ts` … `27-characters-phone.ts`, `40-debut-now.ts`.

- **A class card's earns and hurts.** `ClassLook` gains `hurtsBy: (economy, settlementLength) => string`, and
  `description` says only how the class earns. The instance's five split at their own "Hurt by" (no words change).
  `ClassCards` sets `hurtsBy` under `description` in the hurt color (`--kb-glass-hurt` if the theme has it; else the
  board's #ff8fb1, added as a token and held by the contrast check at 4.5:1 on the card). `instanceUiProblems` refuses a
  class with no `hurtsBy`, or whose `description` still says "Hurt by" (red on the instance as it stands).
- **New character:** the lead under the title (PageHead's `lead`, not beside it); every section 44px from the next (a
  token, `--kb-glass-section-gap`, used by the dialogs too); the footer: one line saying what will happen beside Cancel and
  Make the character, as the Turn board's footer.
- **The Debut dialog, both forms** (choosing how, dropping now): How loud is one row of three (two-column grid gone); on the phone it stacks, and the
  dialog is a sheet with its buttons at its foot.
- **The Reveal modal:** Board and Thread one row of two equal fields; every count on its field's own line, right-aligned,
  the field's hint at its left (a shared `FieldCount` part, used by New character, Edit profile and Write update too).
- **Edit profile:** two columns at 1440: the fields on the left; on the right "What everyone will see", the postbit as the
  board draws it (`engine/ui/board/`'s postbit, given the form's values; never saved, never sent), following what is
  typed. The picture is chosen with a secondary GlassButton labeled "Choose a picture" (a visually hidden `<input
  type="file">` it labels), beside the two crops' frames.
- **My characters' title on the phone:** the count on its own line under the title, never broken (a line of its own, not
  a span in the heading's run).
- **The carousel's arrows** clear the row's clip: a skewed control at a clipping edge keeps its lean inside (the owner's
  nit on batch 3); held by the layout check's cut-control refusal at 1440, which the manifest's run sees.
- **Copy for review:** the footers' lines ("Waiting Wanda is on the board as soon as you make it, and The System announces
  it. Its class stays yours alone.", "It debuts at the next settlement, in 7 h 42 min. Until then you can drop it now
  instead.", "The reveal is checked by The System and posted at once.", "Waiting Wanda goes on the board at once and can post at once, instead
  of at the next settlement."): each is built from the form's state, and the
  task lists every variant it can say; Edit profile's "Under the name on every post." and "The preview follows what you
  type. Nothing changes on the board until you save."
- **Tests first:** `problems.test` (the split), `ClassCards` (two paragraphs, the second the hurt), the dialogs' unit
  tests, the manifests.

## Task 9. The Lens's words (§6, the owner's second nit)

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`CardView`'s comments, `CardUi.status`), `engine/ui/cards/plays.ts`
(`defaultView`), `engine/ui/cards/Lens.tsx`, a new `engine/ui/cards/lens-words.ts` (the checks, pure),
`engine/ui/cards/lens-words.test.ts`, `engine/ui/tips/problems.ts`, `instances/divided-world/ui/cards.ts`,
`instances/divided-world/cards/whoops/Effect.tsx`, `instances/divided-world/ui/stick-around/Effect.tsx`,
`instances/divided-world/cards/autocorrect/Effect.tsx`.

- **The roles**, written into `CardView`'s and `CardUi`'s comments as §6 states them: the tab is the name; `state` is what
  the card is doing to this reader on this post now, a short status, never a sentence and never how it ends; `ends` is the
  way out, present whenever the card holds the reader or covers the post; a play's note is that play's part only;
  `report` only where there is more; `hint` the first-meet line.
- `CardUi` gains `status?: string`, the status a card with no live view of its own shows; `defaultView` uses it in place of
  `summary`, and a play with an `ends` time (`Use.ends`) gives the view an `ends` ("Ends Nov 7, 9:14 PM", in the reader's
  zone). A face-down card's status is the engine's alone, the same for every card that can be face down ("Face down on
  this post"), so a Bluff and a Trap Card read alike (CLAUDE.md, "A response never proves a private fact").
- **The checks** (`lens-words.ts`, run by `instanceUiProblems` over every card's `status`, and by each effect's own tests
  over the views it can show): a `state` or `status` is refused if it holds a sentence (a `.`, `!` or `?` followed by more
  words, or a `:`), or runs past 6 words; a view that holds the reader (`EffectProps`'s held state) or covers the post
  (`CardUi.takeover`) with no `ends` is refused. **Poisons** in `lens-words.test.ts`: Stick Around's present `state`
  (a sentence), a status of eight words, a covering view with no `ends`; each refused by name, red before the check exists.
- **The rewrite**, drafts for the owner's review (the PR lists them under "Copy for review"):

  | Card | Today's heading (`state`) | New `state` / `status` | New `ends` |
  |---|---|---|---|
  | Stick Around, holding | "Holds you on this post until you check the caster's sentence, or break free for this visit" | "Holding you on this post" | "Ends when you check the caster's sentence, scroll past either end of the post, or press Break free." |
  | Stick Around, author | "It never holds you: you wrote this post" | "Not holding you · you wrote it" | (none) |
  | Stick Around, caster | "It never holds you: you played it" | "Not holding you · you played it" | (none) |
  | Stick Around, over | "It will not hold you again" | "Done holding you" | (none) |
  | Stick Around, broke free | "You broke free this visit" | "Broke free this visit" | (none) |
  | Whoops!, live | "3 layers · top: Gloomba's yellow, 41% washed" | "41% washed for you" (the mark's progress) | as today; to the author, "Ends on your screen when you scrub every layer off. As its author, you can wash it for everyone." |
  | Autocorrect | "3 strips, 1 peeled" | as today | "Ends on your screen as you peel each strip." |
  | Force Field | its summary | "Turning away cards up to {rarity}" | "Ends {when}" |
  | Glitter Bomb | its summary | "Sparkling every post of theirs" | "Ends {when}" |
  | Main Event | its summary | "Pinned to the top of its board" | "Ends {when}" |
  | Feelin' Fab | its summary | "{n} of 3 stacked" | (none) |
  | Trap Card, Bluff (face up, to their owner) | their summaries | "Set, face down to everyone else" | (none) |

  A Whoops! play's note stays its own ("Layer 3 of 3, on top · 41% washed"), which is why the heading no longer repeats it.
- **Tests first:** each effect's existing tests gain the new words (red), then the checks above.

## Phase 3: the Lens, the log, account and admin

## Task 10. The Lens and My log (§6; boards 28 to 32)

Model: sonnet

**Files:** `engine/ui/cards/Lens.tsx`, `engine/ui/cards/lens.css`, `engine/ui/cards/PlayActions.tsx`,
`engine/ui/glass/Float.tsx` (if the Lens's size is set there), `engine/ui/log/Log.tsx`, `engine/ui/log/log.css`, their
tests; manifests `28-lens.ts`, `29-lens-states.ts` (compared from the panel's own corner, `origin`), `30-log-empty.ts` …
`32-lens-log-phone.ts`.

- **The Lens's frame:** docked at the right from the page's top (16px) to 16px above the HUD's top, 460px wide at 1440
  (narrower where the page is, never under 360); its bar (tabs and Close) fixed and its body scrolling, with a fade at its
  foot while more lies below (the fade only while `scrollTop + clientHeight < scrollHeight`). On the phone a sheet that
  ends above the HUD and scrolls inside. Nothing is cut: an e2e at 1440 and 390 scrolls the body to its end and reads
  that its last control's box lies inside the panel's and above the HUD (red on c2553b3).
- **The tabs:** the current tab filled in the card's ink, the others outlined; one row that scrolls sideways with a fade
  where more wait and the current tab scrolled into view (the owner's choice). A post with five kinds is a story
  (`boards-01-lens--five-kinds`, added to `e2e/glass-screens.ts` with board `28-lens`'s tab strip held by the manifest).
- **The buttons:** a play's actions as a two-by-two grid of equal secondary buttons; the author's tools as one row with
  Hold to scrub, under the label "Your tools, as the author".
- **My log, before anything has settled:** the table keeps its head and draws one row ("Nothing yet", and when the first
  line comes: "Nothing has settled for {name} yet. Its first settlement, in {time}, is the first line here."); on the
  phone, that row is the first card. **Copy for review**: that sentence.
- **A settlement's posts open:** every nested amount in the Aura column; the Wallet column empty there; on the phone each
  post's kind beside its link.
- **The log's character tabs on the phone:** one row that scrolls, the current one in view.
- **Tests first:** the Lens's unit tests (the current tab's state, the grid), the e2e above, Log's unit tests (the empty
  row, the column of each nested amount), the manifests.

## Task 11. Account and the HUD's cap (§7; boards 33 to 36)

Model: sonnet

**Files:** `engine/ui/account/Settings.tsx`, `engine/ui/account/Invites.tsx`, `engine/ui/account/account.css`,
`engine/ui/vending/Vending.tsx` (the card info) and `vending.css`, `engine/ui/orbs/Orbs.tsx`, `engine/ui/orbs/fill.ts`,
`engine/ui/frame/Hud.tsx`, their tests; manifests `33-settings-account.ts` … `36-account-phone.ts`.

- **Settings › Account:** Reach a person moves under the section rail, ruled off. The invites' list is held to the board
  as the build draws it (a row per invite: its code, its state and when, Reissue while unused); Make an invite follows the
  list. A story or fixture with two invites (one open, one used) gives the screen the board's state.
- **The card info** (after the card template plan merges): the card's face, `Postcard` at the sheet's size, beside its
  rules; never an image of its own (the owner). The title at the dialog frame's heading size; above it the slot and the
  card's kind. The price in words: "{price} to buy" and, for a card whose price depends on the post, "· more to play on a
  long post" (from `CardUi`'s existing price-depends rule, never a "+" alone). On the phone, a sheet with the face above
  the rules. **Copy for review**: "to buy", "more to play on a long post".
- **The HUD past its cap:** the figure once ("+0.85 EST. PAST THE CAP") and the way out under it, the orbs' own words
  ("Spend some before the settlement, or it won't fit.", `engine/ui/orbs/Orbs.board.stories.tsx`), on both sizes; the
  phone's plus-in-an-orb gains the same line. **Tests first:** `Orbs`/`Hud` unit tests reading the line at 1440 and 390
  (red: no line; the figure twice).

## Task 12. Admin (§8; boards 37 to 39)

Model: sonnet

**Files:** `engine/ui/admin/Queue.tsx`, `engine/ui/admin/queue.css`, `engine/ui/admin/admin-contact.css` and the contact
links' component, `engine/ui/admin/WriteUpdate.tsx`, `engine/ui/updates/Updates.tsx`, `engine/ui/updates/updates.css`,
their tests; manifests `37-admin-queue.ts` … `39-admin-phone.ts`.

- **The queue first:** To do, Waiting to land, In force, Ended, then How players reach you as its own section, ruled off.
  A fixture with a move waiting and one in force (the mock's sample) gives the screen the board's state.
- **The contact links:** each row's two fields labeled in view (Label, Address); Remove shows "Remove" and keeps "Remove
  link {n}" as its accessible name (a visually hidden span, as Invites' Reissue does). The same for Write update's
  changes.
- **Write update:** the form in the glass's chamfered piece (Task 4's classes), its labels in the field label's color, and
  under it "What everyone will see": the update as the Updates page draws it (the same component, given the form's
  values; never saved).
- **Tests first:** Queue's unit test for the sections' order (red: How players reach you first); the labels'; the
  preview's; the manifests.

## Task 13. Every board in (§1)

Model: inline

- `PENDING` holds only the boards of designs not built yet (booster packs, cosmetics, the card template), each naming its
  plan. Every backfill board has a manifest; every `glass-screens.ts` entry names a board or why none.
- The full runs, each on a fresh server (#202's lesson: `KB_E2E_PORT`): `e2e/boards.spec.ts`, glass-layout, glass-text,
  glass-hover, glass-dialogs, a11y; `npm run build`. Their counts in the PR.

## Review focus

- **Region calms at scroll.** Every region re-registers its box on scroll through one rAF; a long page with many regions
  (the log, the guide) on a slow phone must not drop frames, and a region whose box is stale for a frame must not leave
  text on uncalmed smoke (the glass-text run measures settled frames only).
- **The contrast model's promise.** The new layout refusal (text outside every region) is what keeps
  `check-glass-contrast.mjs`'s calmed-worst number true; a region added without text, or text added outside a region,
  is where it could slip.
- **A face-down card's status.** The Lens must say the same of a Bluff and a Trap Card to every reader but their owner,
  in words, ends and timing; a status that differs would prove a private fact.
- **The board ids rule.** A later folder's board id is `<folder>/<name>`; an existing manifest renamed by mistake would
  silently stop comparing a board the owner approved.
- **Copy drafts.** Every new line is a draft; the PR lists them all, and none ships unapproved.
- **The card info's dependency.** Task 11's card info builds on the card template plan's `Postcard`; built before it, it
  would hold a face the owner has replaced.
