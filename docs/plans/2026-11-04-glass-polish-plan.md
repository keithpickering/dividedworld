# The glass, polished: plan

Record, written 2026-11-04. Carries out `docs/plans/2026-11-04-glass-polish-design.md` (its sections are cited as §N).
Three phases, each its own PR, merged in order: Phase 1 (Tasks 1–6), Phase 2 (Tasks 7–10), Phase 3 (Tasks 11–14).
Every task is test first: the test named, its red run recorded, then the code, then the green run. A task that adds a
check adds its poisons in the same task. Screens are seen at 390px, 834px and 1440px in the demo world
(`npm run dev:web`), and each task's PR carries before and after screenshots of what it changed.

Engine and instance: everything is engine (`engine/ui/`, `e2e/`, `tools/`, `supabase/`) except where a task names an
instance file. No task makes the engine name an instance.

## Phase 1: the glass's layout

## Task 1. The calm feathers inward (§1)

Model: sonnet

**Files:** `engine/ui/glass/calm.css`, `engine/ui/glass/tokens.css`, `instances/divided-world/ui/glass.json` (if the
calm's tokens are the instance's there; otherwise the theme), `engine/ui/glass/calm.test.tsx`, `e2e/glass-text-page.ts`
(`calmOf`), `tools/check-glass-contrast.mjs` (its comment only).

- `.kb-calm::before` gets `inset: 0`, and its mask's ramps go from transparent at the edge to `currentColor` at the
  feather, as now. `.kb-calm` gains `padding: calc(var(--kb-glass-calm-feather) + var(--kb-glass-calm-pad))`, unless
  an element sets its own padding at least that large. Add `--kb-glass-calm-pad: 12px`, and under the phone layout
  (`:where(:root[data-kb-layout='phone'])`) `--kb-glass-calm-feather: 20px` and `--kb-glass-calm-pad: 10px`.
- Screens whose calmed element relied on having no padding (a heading set flush to a column) are adjusted in the same
  task so the column's left edge holds. Look at every `kb-calm` use (`grep -rn "kb-calm" engine/ui instances --include=*.tsx`)
  at the three widths.
- Rewrite the sentence in `check-glass-contrast.mjs` that says the feather sits outside the text's box. The model's
  numbers do not change.
- `calmOf` in `e2e/glass-text-page.ts` returns the element's border box as well (`element`), for Task 3.
- **Tests first** (red: the backing is inset by the negative feather):
  - `calm.test.tsx`: `.kb-calm::before`'s computed `inset` is 0, and `.kb-calm`'s padding is the feather plus the pad,
    on the main and the phone layouts.
  - `e2e/glass-text.spec.ts` stays green at every width (the interior is still where the text is).

## Task 2. The shared parts (§2)

Model: sonnet

**Files:** new `engine/ui/glass/PageHead.tsx`, `engine/ui/glass/Button.tsx` (exports `GlassButton`, `ButtonRow`), and
`engine/ui/glass/parts.css`; exported from `engine/ui/glass/index.ts`; new `engine/ui/glass/parts.test.tsx` and
`engine/ui/glass/Parts.board.stories.tsx`; `engine/ui/glass/tokens.css` for the control tokens.

- `PageHead({ title, eyebrow?, lead?, actions?, count? })`: an `h1` in the display face, the lead as a `p`, and
  actions as a `ButtonRow`. Layout is a wrapping flex row: the title is `flex: 0 1 auto` with `min-width: min(100%,
  max-content)`, and the lead is `flex: 1 1 18em`, so the lead goes under the title when it would be narrower than
  18em. The calm is on the title and the lead, as each screen has it today.
- `GlassButton({ kind = 'secondary', size = 'm', to?, ...button props })` renders a `<button>`, or the router's `Link`
  when `to` is set. It is skewed by `kb-glass-skew` with its label in `kb-glass-upright`. Its height, horizontal
  padding, type size and letter spacing come from `--kb-glass-control-{m,s}-{height,pad,size}`. Main layout: `m`
  48px, `s` 36px. Phone layout: `m` 40px with `--kb-glass-size-phone-body`, `s` 32px with
  `--kb-glass-size-phone-small`. The three kinds take their fills and borders from the existing tokens the primary
  (filled cyan), secondary (outlined) and quiet (text only) controls use today. `disabled` and `aria-disabled` look
  disabled and keep a 3:1 border.
- `ButtonRow({ children, align? })`: a flex row with `flex-wrap: wrap`, `align-items: stretch`, one gap token, and
  `white-space: nowrap` on each label, so a row breaks between controls and never inside one.
- **Tests first** (red: the modules do not exist):
  - `PageHead` renders one `h1`, and the lead is a `p` after it.
  - `GlassButton` with `to` is a link and without is a button. `kind` and `size` set `data-kb-kind` and `data-kb-size`.
    The upright span holds the label.
  - The story renders each kind and size, a row of three, and a head with a long lead, on the main and phone layouts.

## Task 3. The layout check (§3)

Model: sonnet

**Files:** new `e2e/glass-screens.ts` (the list of screens `e2e/glass-text.spec.ts` defines today as `PAGES`, its
dialogs and its `Screen` type, moved here, with both specs importing it), new `e2e/glass-layout.ts`,
`e2e/glass-layout.test.ts`, `e2e/glass-layout-page.ts` and `e2e/glass-layout.spec.ts`.

- `glass-layout.ts` exports `judgeLayout(facts: LayoutFacts): string[]`. It is pure, like `judge` in
  `e2e/glass-text.ts`, and names each refusal with the element's selector path and the screen. `LayoutFacts` holds
  the viewport, the text blocks (rect, font size, longest word's width), the scrolling containers, the rows of
  controls (each control's rect and computed font size, and whether it is a `GlassButton`), each control's nearest
  clipped panel (its rect and its `clip-path` polygon resolved to px), and each calm (backing rect, element border
  box). The five refusals are §3's 1–5, with a block narrower than `10 * fontSize` or than its longest word, and
  heights compared to within 1px.
- `glass-layout-page.ts` gathers the facts in the page (one `page.evaluate`, as `e2e/glass-text-page.ts` does).
- `glass-layout.spec.ts` visits every screen and dialog in `glass-screens.ts` at 390×844, 834×1112 and 1440×900, at
  text sizes 100, 125, 150 and 200 (set through the preference, as `e2e/glass-preferences.spec.ts` does), and expects
  `judgeLayout` to return nothing.
- **Tests first:** `glass-layout.test.ts` starts from a passing fact set and plants one poison per refusal, each red
  before `judgeLayout` exists and green once it catches it:
  - the lead of 0px by 547px (the phone My characters head as found);
  - a panel 20px past the viewport's right edge, plus a case where the same overflow inside a scrolling track passes;
  - Cancel 44px and 18px beside Reveal 48px and 21px;
  - a button whose top-right corner lies in its panel's 24px chamfer;
  - a backing 32px outside its element on every side (the calm before Task 1).
- Then run the spec on main's screens and record its red run in the PR: the list of refusals is Phase 1's worklist.
  Tasks 4–6 make it green. The spec is in `npm run test:e2e` from this task on. If it cannot be green by the end of
  the phase, the PR is not ready.

## Task 4. Every screen on the parts (§2)

Model: sonnet

**Files:** every glass screen's component and stylesheet. Find them with
`grep -rnoE 'kb-[a-z-]+ kb-glass-skew|kb-glass-skew kb-[a-z-]+' engine/ui instances --include=*.tsx` (36 classes at
3905bb7) and every `-head` block in the glass stylesheets: My characters, New character, Edit profile, Settings
(each section), Sign in and Register, Alerts, Updates, Guide, Welcome, My log, Settlement, Rankings and Season, the
Vending Machine's side, the hand drawer, the Turn, Reveal and Debut dialogs, the admin queue and Write an update.

- Each screen's head becomes a `PageHead`. Each skewed control that is a control (not a game piece, §2) becomes a
  `GlassButton` of the kind its look was, and each run of them a `ButtonRow`. The old classes and their CSS are
  removed, not left beside the new ones. A screen whose look needs more than the parts give says why in a comment at
  the rule that keeps it.
- In the Reveal modal (`engine/ui/characters/RevealModal.tsx`), Cancel and Reveal are one `ButtonRow`, Cancel
  `secondary` and Reveal `primary`, at one size.
- **Tests first:** the layout spec's refusals from Task 3 on these screens are the red. The existing component tests
  that find controls by role and name stay green unchanged (a test that found a control by its class is rewritten to
  find it by role).

## Task 5. My characters' carousel (§4)

Model: sonnet

**Files:** new `engine/ui/glass/Carousel.tsx` (from `engine/ui/characters/ClassCards.tsx`'s row: the shown range
from `engine/ui/characters/carousel.ts`'s `shownRange`, the arrows, the count, the fades, the glide and the
keyboard); `engine/ui/characters/ClassCards.tsx`, `engine/ui/characters/Characters.tsx` and
`engine/ui/characters/characters.css`; `engine/ui/characters/Characters.test.tsx`.

- `Carousel({ role: 'radiogroup' | 'tablist', label, items, value, onChange, renderItem, after? })`. As a radiogroup
  it is today's class cards, unchanged in behavior. As a tablist each item is a `role="tab"` with `aria-selected` and
  `aria-controls`; arrow keys move and select, and Home and End go to the first and last. It keeps every item
  reachable to a reader, as the class cards do today. `after` is an item drawn last that is no tab (New character).
- `ClassCards` draws its row with `Carousel role="radiogroup"`.
- `Characters` draws the roster with `Carousel role="tablist"`. The panel is `role="tabpanel"`, `aria-labelledby` the
  selected tab, and directly after the row. New character is `after`, its line "You have N open slots." The
  `kb-roster-empty` items go, with their CSS.
- **Tests first** (red: no tablist):
  - The roster is a tablist named "Roster, 2 of 6 slots used" with one tab per character, and the selected one has
    `aria-selected="true"`.
  - The panel is a tabpanel named by the selected character.
  - ArrowRight selects the next character and moves focus to it.
  - New character is a link after the tabs, its line naming the open slots, and no empty slot is drawn.
  - The class cards' existing carousel tests pass unchanged.

## Task 6. The Vending Machine's shelves and marquees (§5)

Model: sonnet

**Files:** `engine/ui/vending/Vending.tsx` (`Machine`), `engine/ui/vending/vending.css`,
`instances/divided-world/ui/vending/vending.css`, `engine/ui/types.ts` (`UiCopy`), `engine/ui/tips/problems.ts`
(`instanceUiProblems`, now also taking `copy`) and `engine/ui/tips/problems.test.ts`, `instances/divided-world/ui/index.ts`,
`engine/ui/vending/Vending.test.tsx` (or the file the Vending tests are in), `engine/ui/log/lines.test.tsx` if a test
names the shop.

- The slot is the postcard's face in a fixed box, the face scaled to fit as a whole (`transform: scale()` from the
  card's own width, so its layout is the full card's). Under it is a shelf edge (`.kb-vending-shelf`) holding the code
  and price and the info control. On the phone layout the info control is an icon `GlassButton` of size `s`, named
  "About <card name>".
- `UiCopy.marquees?: readonly string[]`. `Machine` picks one when it mounts (`useState(() => pick(marquees))`, with
  `pick` taking a random function from `useKayfa()` when the context provides one, else `Math.random`, so a test can
  fix it), and draws it on the marquee. With no list it draws `shopName`. The machine's group label stays `shopName`.
- `instanceUiProblems` refuses: `marquees` present and empty; an entry that is empty after trimming; an entry over
  20 characters.
- Divided World: `shopName: 'Vending Machine'` and `marquees` the design's twelve (§5), in that order.
- **Tests first:**
  - `problems.test.ts` (red: not checked): each refusal planted, and the instance's list passes.
  - The Vending test: with a fixed random the marquee shows the chosen entry, and the group is still named by
    `shopName`. With no list the marquee shows `shopName`.
  - The layout spec's Vending refusals from Task 3 are the red for the shelf.

## Phase 2: the board meeting the glass

## Task 7. The board at 1.25 (§7)

Model: sonnet

**Files:** `engine/ui/tokens.css` (`--kb-size-*`, `--kb-board-max`, and the comment on it),
`instances/divided-world/cards/whoops/scrub.ts` (`BOARD_MAX`, `BODY_PX` and the derivation's comment),
`e2e/board-width.spec.ts`, and any test or story that pins 960px, 12px or `REF_WIDTH`'s 790
(`grep -rn "960\|790\|12px" e2e engine instances --include=*.ts*`).

- Sizes: body 0.9375rem, small 0.859375rem, fine 0.78125rem, heading 1.171875rem, title 1.40625rem, logo
  1.5625rem. `--kb-board-max: 1200px`.
- `scrub.ts`: `BOARD_MAX = 1200`, `BODY_PX = 15`. `REF_WIDTH` becomes 988 (1198 less a postbit of 210), and the
  comment says why strokes kept in widths still land (§7).
- **Tests first** (red: 960):
  - `board-width.spec.ts` expects a column at most 1200px wide.
  - A Whoops! test: a stroke at the middle of the reference layout lands within one pixel of the middle of the post's
    body at 1440px.
  - `npm run test:e2e`'s Whoops! flows pass.

## Task 8. The double rule and the vignette (§8)

Model: sonnet

**Files:** `engine/ui/thread/thread.css` (`.kb-act`), `engine/ui/frame/frame.css` and `engine/ui/frame/Frame.tsx` (the
vignette's element, under the HUD), `engine/ui/tokens.css` (`--kb-vignette-color`, `--kb-vignette-edge`,
`--kb-vignette-foot`, engine defaults that draw nothing), `instances/divided-world/ui/theme.css` (Divided World's values),
`tools/check-theme.mjs` and `tools/test-theme.mjs` only if a vignette token needs a rule they do not have.

- `.kb-act { border-bottom: 4px double var(--kb-rule); }`, with `:last-child` keeping none.
- The vignette is one `aria-hidden` fixed element in the frame, `pointer-events: none`, stacked above the board and
  below the HUD (frame.css's HUD is `z-index: 30`). Its background is a radial gradient to `--kb-vignette-color` at
  `--kb-vignette-edge` opacity and a linear gradient from the foot to `--kb-vignette-foot` opacity over 220px. The
  starting values are the session's mockup: violet `#1e083c`, 0.32 at the corners, `#3c1478` at 0.28 at the foot. It is
  `display: none` under `[data-kb-contrast='high']`.
- **Tests first** (red: no vignette):
  - A frame test: one vignette element, `aria-hidden`, and none under High contrast.
  - `e2e/a11y.spec.ts` and the board's contrast test (`web/contrast.test.tsx`) stay green, so the vignette never lies
    under the column's text. Assert in `e2e/board-width.spec.ts` that the vignette's gradient is transparent inside
    the column at 1440px.

## Task 9. The field's model and its guard (§6)

Model: sonnet

**Files:** `engine/ui/types.ts` (`SmokeLayer` splits into `FieldLayer`, with frequency, octaves, seed, alpha, blur,
drift seconds and travel, and `LayerColor`, with color and opacity; `SmokeRecipe` becomes `{ colors, narrowColors?,
calm?, calmAll? }`; `GlassTheme.smoke` gains `field: { layers, narrow? }`), `instances/divided-world/ui/glass.json`,
`tools/check-glass-contrast.mjs`, `tools/test-glass-contrast.mjs` and `e2e/glass-ceilings.json`.

- Divided World's field: four layers, from the page recipe's two (`[0.0022, 0.004]` and `[0.003, 0.005]`) plus the
  third most recipes have (`[0.0034, 0.006]`), and one deeper, slower layer (`[0.0016, 0.0028]`). Each has its own
  seed, a blur of 18, and drift rates of 90s, 60s, 40s and 28s with travels of 80 to 160px. `narrow` is three layers
  at the cards recipe's narrow frequencies. Each recipe's `colors` keeps its own palette: the colors it has today on
  the layers it has, and opacity 0 on a layer it did not draw. The hud recipe takes the page's frequencies from the
  field, so its own scale goes.
- The guard composites, for each recipe, the field's layers in the recipe's colors and opacities, by the same model
  (§6). It also refuses: a recipe whose `colors` is not one per field layer (and `narrowColors` not one per narrow
  layer); a field over 4 layers or a narrow over 3; a drift without positive seconds and travel.
- Run `--write` and commit the new ceilings. In the PR, give the old and new worst numbers for every recipe beside each
  other.
- **Tests first** (red: no field): `test-glass-contrast.mjs` plants each new refusal (a recipe with one color too few,
  a fifth field layer, a fourth narrow layer, a drift of 0 seconds), and pins the new worst numbers.

## Task 10. The field's renderer (§6)

Model: sonnet

**Files:** new `engine/ui/glass/field.ts` (rasterizing a layer to a `blob:` URL, cached per field, width class and
device pixel ratio; the drift clock), `engine/ui/glass/Smoke.tsx` (rewritten to draw the field's layers as masked
elements), `engine/ui/glass/base.css` (the layer elements, the drift keyframes per layer, the color transition),
`engine/ui/frame/Hud.tsx` and `engine/ui/frame/frame.css` (the HUD tab and the hand drawer as windows),
`engine/ui/glass/Page.tsx`, `engine/ui/glass/Overlay.tsx`, `engine/ui/glass/Float.tsx`; `engine/ui/glass/smoke.test.tsx`
(or the existing Smoke test file); a new story `engine/ui/glass/Field.board.stories.tsx`; and a measurement script in
`tools/` only if the build session wants it kept. Otherwise the numbers go in the PR.

- `rasterize(layer, size, dpr)` draws an SVG of the layer's `feTurbulence`, a color matrix of white with the layer's
  alpha row, and its blur, at the viewport's size times `min(dpr, 2)`, to a canvas (`createImageBitmap` from the SVG
  as an image). It returns a `blob:` URL, cached and released when the field or the width class changes. Until the
  raster is ready, the ground shows: the page is legible before the smoke draws, as today.
- `Smoke({ surface })` draws one element per field layer: `position: absolute`, sized to the viewport, translated by
  minus the surface element's own viewport offset (read with `getBoundingClientRect` on mount, on resize and, for an
  overlay, when it is placed), `mask-image` the layer's URL, and `background-color` the recipe's color at its opacity,
  times a third under Low. Off draws none. The element keeps `data-kb-surface` and `data-kb-smoke` for the rendered
  measurement.
- The drift: each layer's keyframes move it by its travel. Its `animation-delay` is
  `-(performance.now() / 1000 % (2 * seconds))s`, so every window is in phase. It is stopped under Off, as today's
  `kb-smoke-drift` is.
- The color change: `transition: background-color var(--kb-motion-screen) var(--kb-motion-ease)` on each layer
  element, with `none` under Off. Until Task 12 defines them, the variables default to 400ms and `ease-in-out`.
- The HUD's tab and the hand drawer draw `Smoke` as today; they are now windows onto the field.
- **Tests first** (red: Smoke draws an `svg`):
  - Smoke draws one masked element per field layer with the recipe's colors, none under Off, and each at a third of
    its opacity under Low.
  - Moving from `surface="vending"` to `surface="log"` on one mounted `Page` changes each layer's background color
    without remounting the element (same node).
  - Two windows at different offsets have translations that differ by exactly their offset.
  - `e2e/glass-text.spec.ts` and `e2e/smoke.spec.ts` stay green against Task 9's ceilings.
  - Record frame times for the field story at 390px and 1440px, with drift on, in the PR (§6).

## Phase 3: motion

## Task 11. The Motion setting (§9)

Model: sonnet

**Files:** new migration `supabase/migrations/0079_motion_feel.sql` (or the next free version; the build refuses a
shared one), and a new SQL test after the last in `supabase/tests/`; `engine/ui/data/api.ts` (`Preferences['motion']`
gains `'snappy'`), `engine/ui/data/fake.ts` (`set_preferences`'s refusal), `engine/ui/appearance.ts`
(`AppearancePreference`, `resolveAppearance`, `applyAppearance`), `engine/ui/account/appearanceRows.tsx` (`MOTION`,
`MotionRow`'s sentence), `engine/ui/types.ts` (`UiCopy.reducedMotionCard`'s comment),
`engine/ui/account/Settings.tsx` and the welcome page's Before you start only if they name the labels, and their tests.

- The migration: `account_preferences.motion`'s check becomes `('system', 'reduce', 'full', 'snappy')`, and
  `set_preferences` (as 0068 last defined it, same signature) accepts `snappy` with the refusal's words "motion
  follows the system, or is off, smooth or snappy".
- `resolveAppearance`: `motion` is `'reduce' | 'full' | null` as now, with `snappy` resolving to `full`, and a new
  `feel: 'smooth' | 'snappy'` (`snappy` only for `snappy`). `applyAppearance` sets `data-kb-motion-feel` to the feel.
- `MOTION`: Follow my device (`system`), Off (`reduce`), Smooth (`full`), Snappy (`snappy`). The sentence: "Off stops
  every animation. A card's effect still happens: ${ui.copy.reducedMotionCard} Smooth and Snappy are two speeds of
  the same animations." The owner approves the copy in review.
- **Tests first** (red: `snappy` refused):
  - The SQL test: `set_preferences(motion => 'snappy')` saves, `'fast'` is refused with the new words, and a row
    holding `full` reads back `full`.
  - `appearance.test.ts`: `snappy` gives `data-kb-motion="full"` and `data-kb-motion-feel="snappy"`; `full` gives the
    feel `smooth`; `reduce` gives `reduce`; `system` sets neither override.
  - The Settings test finds the four choices by name.
  - The export round-trip (`supabase/tests/e2e/0003-export.ts`) carries a `snappy` row.

## Task 12. The feels and the prototype (§9)

Model: sonnet

**Files:** new `engine/ui/glass/motion.ts` (the feels' tokens, `useFeel()`, and the choreography's presets: `crossing`,
`screen`, `overlay`, `modal`, `stagger`, `swap`); `engine/ui/types.ts` (`GlassTheme.motion?`, each feel's tokens);
`engine/ui/glass/apply.ts` (writing a feel's durations and easings to the root as `--kb-motion-*`);
`engine/ui/glass/motion.test.ts`; new story `engine/ui/glass/Motion.board.stories.tsx`.

- A feel holds `enter`, `exit`, `screen` and `stagger` durations, an `ease` (a cubic-bezier) and an optional `spring`
  (stiffness, damping), an enter `distance` in px, `blur` in px, `scale`, and `mask: 'fade' | 'skew'`. Smooth's
  defaults: 380, 300, 420 and 30 ms, `cubic-bezier(0.22, 1, 0.36, 1)`, no spring, 16px, 6px, 0.98, `fade`. Snappy's:
  180, 140, 220 and 24 ms, a spring of stiffness 520 and damping 32, 24px, 0, 1, `skew`.
- `useFeel()` reads the root's `data-kb-motion` and `data-kb-motion-feel` and the device's `prefers-reduced-motion`,
  following changes, and returns `null` under Off. Every preset returns Motion props (`initial`, `animate`, `exit`,
  `transition`) that are empty under `null`, so a component spreads them with no branch of its own. `stagger(count)`
  caps the delay so the last item starts within `screen` (§9).
- The story plays the crossing out and back, a screen change left and right, an overlay from an anchor, a modal, a
  staggered screen of twenty rows, and the roster's swap, with a toolbar switch for Smooth, Snappy and Off.
- **Tests first** (red: no module):
  - Under Off every preset is empty.
  - `stagger(200)`'s last delay is at most `screen`.
  - Snappy's presets carry a `clip-path` and Smooth's do not.
  - An instance's `motion.smooth.enter` overrides the default, and the others stand.

## Task 13. The crossing and the screens (§9)

Model: sonnet

**Files:** `web/src/App.tsx` (the two worlds under one `AnimatePresence`), `engine/ui/glass/Page.tsx` (its content
keyed by path, with the direction taken from the tabs' order), `engine/ui/glass/MenuBar.tsx` (the selected tab's
underline as a shared `layoutId`), `engine/ui/frame/Hud.tsx` (it publishes the tab's rect for the crossing to start
from), `engine/ui/glass/shell.css`, `web/src/App.test.tsx`, and `e2e/focus.spec.ts` and `e2e/keyboard.spec.ts` if
they need an assertion of the inert exit.

- Board to glass: the glass page enters over the frame with `clip-path` from the HUD tab's rect, inset in px from the
  viewport's edges, to `inset(0)`, over the feel's `screen`. Glass to board reverses it into the HUD's bar. An Esc or a
  Back while a crossing runs reverses it from its current state (Motion animates from the current value).
- The exiting tree gets `inert` and `aria-hidden="true"` in the same render that starts its exit. `Page`'s focus move
  (its `useEffect` on `path`) runs at the start, as now.
- Between glass screens, the content leaves toward the old tab's side and enters from the new tab's, by the feel's
  `distance`. The tab underline is one element with a `layoutId`.
- **Tests first** (red: during the crossing two `main` elements are reachable):
  - In `App.test.tsx`, during a crossing exactly one `main` is in the accessibility tree, and the exiting tree is
    `inert`.
  - Under Off the crossing renders the new world in the same frame with no exit held.
  - In e2e at full motion, opening the menu and pressing Esc at once returns to the board with focus where it was
    (`e2e/focus.spec.ts`'s helper).

## Task 14. Overlays, staggers and the roster's swap (§9)

Model: sonnet

**Files:** `engine/ui/glass/Overlay.tsx`, `engine/ui/glass/Float.tsx`, `engine/ui/modal.tsx` and `engine/ui/modal.css`,
the hand drawer in `engine/ui/frame/Hud.tsx`, `engine/ui/glass/PageHead.tsx` and the panels Task 4 placed (the stagger),
`engine/ui/characters/Characters.tsx` (the panel's swap), `engine/ui/alerts/Toasts.tsx` and `engine/ui/tips/Spotlight.tsx`
(onto the feel's tokens), and their tests.

- Each overlay, float, modal and the hand drawer enters and exits by the feel's `overlay` or `modal` preset, from its
  anchor where it has one. The dimmed board fades in step. Every close plays its exit, with the closing element `inert`
  from the start; focus returns at the start, as `modal.tsx` does today.
- A screen's `PageHead`, then its panels, then their rows enter by `stagger`.
- The roster's panel swaps by `swap`, keyed by the selected character.
- Toasts and the spotlight take their durations and easings from `useFeel()`, so the setting moves them too.
- **Tests first** (red: an overlay is removed at once on close at full motion):
  - At full motion a closed overlay is `inert` and `aria-hidden` until its exit ends, then removed. Under Off it is
    removed at once.
  - The modal's focus still returns to its opener on close (the existing tests, unchanged).
  - `e2e/glass-text.spec.ts` and `e2e/glass-layout.spec.ts` measure after entrances settle: their page helper waits
    for no running animations (`document.getAnimations()` empty) before gathering facts.

## Review focus

- The calm's padding (Task 1) changes every glass screen's spacing. Check that no column's left edge moved and no
  screen's text now runs narrower than it did, at 390px especially.
- Task 4 removes 36 control classes. Check that a game piece (the Hand button, a class chip, an orb) was not made a
  `GlassButton`, and that no removed class is still named in a test, a story or an instance stylesheet.
- Whoops! strokes already saved on dw.gripe's test data are kept in widths of the 790px layout. Check that Task 7's
  988px layout puts them where they were drawn (the scale is uniform but for the 1px borders).
- The field's rasters (Task 10) are held per width class and device pixel ratio. Check that a resize, a rotation, or
  the smoke level changing releases the old `blob:` URLs, and that memory does not grow over a long session of crossings.
- Task 9 rewrites every recipe's worst pixel. Check the old and new numbers side by side in the PR, and that no
  surface's calm had to rise to pass.
- The crossing (Task 13) mounts both worlds for a moment. Check that the board's Realtime subscriptions and presence
  are not doubled by the glass mounting while the frame exits, and that presence never shows a character leaving and
  returning because of an animation.
- Motion must not tell anyone anything. Check that no duration, delay or animation in Phase 3 depends on a response's
  content or arrival, so a refusal and a success look the same until the words appear.
- A busy instance's long log or rankings page enters with a capped stagger. Check `stagger` at the largest page
  length the screens draw.
