Record, written 2026-11-13.

# Below the Fold folds the whole row: plan

Carries out `docs/plans/2026-11-13-fold-the-row-design.md`. A post wearing a live Below the Fold is drawn as a full-width
bar in the theme's header tokens (square avatar, name, `#seq`, the post's marks, "Show post" and a chevron), and it
unfolds like a newspaper. The engine learns `CardUi.foldsRow` and `EffectProps.fold`; the post's cells move into an inner
grid. Line numbers are as read at `5761bcce`. Read the function, not the line.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no check
needs a poison. No migration and nothing in `supabase/` changes. The engine boundary check
(`tools/check-engine-boundary.mjs`) holds throughout: engine tests use a fixture card of their own, never Divided World's.
No deployed database, bucket or connector is touched.

**The world.** The bar is drawn on a post, so it is the board's world (`docs/plans/2026-10-29-two-worlds-design.md`): the
header band a 2003 table's `th` wears, in the theme's `--kb-head-*` tokens. The Lens's words are the glass's, plain.

## Task 1. The post's cells move into an inner grid (engine)

Model: sonnet

The row has to move as one sheet, so the grid that is `<article class="kb-act">` today becomes an always-present inner
`<div class="kb-act-grid">` holding the same cells in the same order. The article keeps its id, `tabIndex`, label,
`data-kb-*` attributes, parity, `--kb-rail` and the spacer between posts (`.kb-act + .kb-act`). The visually hidden
`<h2>` and the cut line (`.kb-act-cutline`) stay direct children of the article, before the grid. Nothing looks
different after this task.

**Files:**
- `engine/ui/thread/Post.tsx`, `PostArticle` (about line 298): wrap the postbit, `.kb-act-meta`, `.kb-act-main` and
  `Actions`' output in `<div className="kb-act-grid">`.
- `engine/ui/thread/thread.css`: `.kb-act`'s `display: grid`, the columns, the areas, the rows, the `column-gap` and the
  `background: var(--kb-grid)` move to `.kb-act-grid`; the unmask, stacked and phone variants become
  `.kb-act[data-kb-kind="unmask"] > .kb-act-grid`, `.kb-act[data-kb-postbit="stacked"] > .kb-act-grid` and the
  `@media (max-width: 40em)` block's counterparts; every `.kb-act > X` cell rule (lines 87, 153-154, 179, 201, 206, 210,
  312-313, 334-335) becomes `.kb-act-grid > X`. `isolation: isolate` moves to `.kb-act-grid` (the stacking notes in the
  comment at line 157 are about the cells' stack, which is now the grid's); the comment says so.
- `engine/ui/cards/marks.css:231`: `.kb-act > .kb-postbit[data-kb-callout-row]` becomes `.kb-act-grid > …`.
- `engine/ui/shine/landing.ts`, `landPost` (line 247): the cells are the grid's children. It reads
  `article.querySelector(':scope > .kb-act-grid')` and iterates that element's children; an article with no grid (a
  front-door post, below) keeps iterating its own. Its header comment says which.
- `engine/ui/cards/Moment.tsx:141`: `closest('article')?.querySelector(':scope > .kb-act-meta')` becomes
  `':scope > .kb-act-grid > .kb-act-meta, :scope > .kb-act-meta'` (the front door's post has no grid).
- `engine/ui/thread/Thread.test.tsx:2493`: the rule it looks for is `.kb-act-grid > .kb-act-meta[data-kb-landed]`.
- Grep the repository for `.kb-act >`, `kb-act > `, `closest('article')` and `article.children` once more before
  finishing, and carry every hit the same way.

The front door (`engine/ui/front-door/FrontDoor.tsx`, line 68) draws `.kb-act-meta` in an article of its own; it is
not touched and keeps no grid.

Tests first:
- `Thread.test.tsx`: a post's article has exactly one `.kb-act-grid` child, and the postbit, meta, main, foot and panels
  are its children in that order; the `<h2>` is the article's first child. Red before the change.
- `engine/ui/shine/landing` test (beside the existing one): `landPost` on an article with a grid registers the grid's
  cells and not the grid itself. Red first.
- The board stories that compare screenshots (`e2e/board-stories.test.ts`'s list, run by the a11y and board specs)
  pass unchanged: the run before and after is in the PR. `e2e/post-layers.spec.ts` passes unchanged.

## Task 2. `CardUi.foldsRow` and `EffectProps.fold` (engine)

Model: sonnet

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/Effects.tsx`, `engine/ui/thread/fold.tsx` (new),
`engine/ui/tips/problems.ts`, `engine/ui/cards/Effects.test.tsx`, `engine/ui/tips/problems` test.

- `CardUi.foldsRow?: true`, documented: "A live play of this card on a post folds the post's whole row behind a bar the
  engine draws (thread/fold.tsx). The card's effect is given `fold` where the post has a row, and draws its own fold
  where it has none (`EffectProps.fold`)."
- `EffectProps.fold?: { readonly open: boolean; readonly toggle: () => void }`, documented: the row's state for this
  reader and the press that changes it, given only to a card with `foldsRow` on its post's own reach, and only in a
  thread's post (absent in the ORIGIN box, the front door, a moment and History).
- `engine/ui/thread/fold.tsx` exports `RowFoldCtx` (a React context of `{ open, toggle } | null`, null by default) and
  `useRowFold()`.
- `PostEffects` (Effects.tsx, the `wrapIn` loop near line 244) reads `useRowFold()` and passes
  `fold={rowFold}` to a `BoundEffect` when `rowFold !== null`, `reach === 'post'` and the card has `foldsRow`.
  `BoundEffect`'s props carry it through. `StillEffect`, `MomentEffects` and `VersionEffects` never pass it.
- `instanceUiProblems` (problems.ts) gains `foldsRowProblems`: a card with `foldsRow` must have an `Effect` (it draws
  the fold where there is no row) and must not be a `takeover` (a takeover lifts the post out of the row the fold
  hides).

Tests first:
- `Effects.test.tsx`: with a fixture card `{ key: 'folder', foldsRow: true, Effect }` played on a post, inside
  `RowFoldCtx.Provider value={{ open: false, toggle }}` the effect is given `fold` with those values; outside a
  provider it is given none; a card without `foldsRow` is never given it; a play of the card on the thread's reach is
  never given it. Red first.
- problems test: a `foldsRow` card with no `Effect` and one that is a `takeover` are each named. Red first.

## Task 3. The row folds behind the bar (engine)

Model: sonnet

**Files:** `engine/ui/thread/Post.tsx` (`PostArticle`), `engine/ui/thread/FoldBar.tsx` (new),
`engine/ui/thread/fold.css` (new, imported by FoldBar.tsx), `engine/ui/postbit/Postbit.tsx` (an exported
`SquareAvatar`), `engine/ui/thread/Thread.test.tsx` or a new `engine/ui/thread/fold.test.tsx`.

**Whether a post folds.** In `PostArticle`, `folding` is true where the post (`act.kind === 'post' || act.kind ===
'spin'`) has a play on its own reach, among `livePlays(usePlays(plays, act.id).plays, now)` (plays.ts:106), whose card's
`CardUi` has `foldsRow`. `now` re-reads as the other live checks in Post.tsx do, so an admin's reversal unfolds the row
when the post next renders. A fold that lands live (Realtime) folds the row then.

**The state.** `const [open, setOpen] = useState(false)` in `PostArticle`: the reader's own, in the page's memory.
Nothing is saved, sent or counted. `toggle` flips it. The article provides `RowFoldCtx` with `{ open, toggle }` while
`folding`, and `null` otherwise.

**The article while folding:**
- `data-kb-fold="folded"` or `data-kb-fold="open"` on the article.
- `<FoldBar>` is drawn first inside the article, after the `<h2>` and the cut line, before `.kb-act-grid`.
- The post's `marks` are given to `FoldBar` and not drawn in `.kb-act-meta`: the same node in one place for the fold's
  whole life, folded or open, so a press never remounts them.
- `.kb-act-grid` gets an id (`post-<seq>-row`) and, at rest when folded, the `hidden` attribute (so its cells leave the
  tab order and the accessibility tree), and stays mounted.

**`FoldBar`** (`{ person, name, spoken, seq, open, toggle, marks, controls }`, where `controls` is the grid's id):
- A `div.kb-fold-bar` with `data-kb-over-ink`, `position: relative`, laid out as a flex row: `SquareAvatar` (24px,
  `aria-hidden`), the name (`.kb-fold-name`, truncated with an ellipsis), `#seq` (`.kb-fold-seq`, the dim weight),
  a flexible gap, the marks (`.kb-fold-marks`, `position: relative; z-index: 1`), then the toggle.
- The toggle is `<button type="button" className="kb-fold-toggle" aria-expanded={open} aria-controls={controls}
  aria-label={`${open ? 'Hide' : 'Show'} post #${seq} by ${spoken}`}>` holding the visible words "Show post" or "Hide
  post" and the chevron (an inline SVG, `aria-hidden`, pointing down when folded and up when open: a rotation of 180
  degrees, no transition under reduced motion). Its `::after` is `content: ''; position: absolute; inset: 0`, so a
  press anywhere on the bar but a mark is the toggle's.
- No avatar and no name where the post has no `person` (a staff post): the staff word stands as the name, with the
  postbit-system's initial-less look.
- `SquareAvatar` (Postbit.tsx, exported beside `Avatar`): the character's `avatarSquare`; else the portrait, cropped to
  a square from its top (`object-fit: cover; object-position: top`); else the initial on the postbit's `kb-postbit-none`
  ground. It wears no outfit. It is given the same `person` the postbit is, so a veiled post's bar shows the stand-in.

**`fold.css`:**
- `.kb-fold-bar`: `background: var(--kb-head-bg); color: var(--kb-head-fg); text-shadow: var(--kb-head-shadow);
  font: bold var(--kb-size-small) / 1.3 var(--kb-font-mono)`; `padding: 0.35em 1% 0.35em 0.5em`; `gap: 0.75em`; a
  crease under it, `box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 3px 4px -1px rgb(0 0 0 / 0.55)`, which
  `position: relative; z-index: 2` keeps over the swinging row; `min-height: 44px` under `(pointer: coarse)`.
- `.kb-fold-toggle`: no ground or border of its own, the bar's ink and font, `cursor: pointer`; its focus ring is the
  engine's `:focus-visible` in `--kb-head-focus`, drawn on the whole bar (`.kb-fold-bar:has(.kb-fold-toggle:focus-visible)
  { outline: 2px solid var(--kb-head-focus); outline-offset: -3px }`).
- `.kb-fold-seq` and the toggle's words at `font-weight: normal; opacity: 0.8`; the 24px avatar with a 1px
  `var(--kb-rule)` outline.
- `@media (forced-colors: active)`: the bar takes `ButtonFace`/`ButtonText` with a 1px `ButtonText` border; the chevron
  `ButtonText`.
- `@media (max-width: 40em)`: the name truncates before the toggle's words do.
- The article while folding has no spacer change: the bar sits where the post's top would.

**Focus.** When the row folds while focus is inside `.kb-act-grid` (an effect's control, the Lens's press reached by
keyboard), focus moves to the toggle. Opening moves no focus.

Tests first (Testing Library, with the fixture `folder` card of Task 2 in a test instance):
1. A post with a live `folder` play draws the bar with the avatar, the name, `#seq` and "Show post", the toggle
   `aria-expanded="false"`, and `.kb-act-grid` hidden; a post without one draws no bar. Red first.
2. A press opens it: `aria-expanded="true"`, "Hide post", the grid shown; a second press folds. Enter and Space too.
3. The marks are inside `.kb-fold-bar` and not in `.kb-act-meta`, folded and open; the same mark element survives a
   press (a ref kept across it is still connected).
4. A cell's state survives a press: an `EffectProps` fixture effect with a counter keeps its count across fold and open.
5. A veiled post (the stand-in `person`) draws the stand-in's name and avatar on the bar.
6. A reversed play (`livePlays` drops it) draws no bar and an unhidden grid.
7. Focus inside the grid moves to the toggle when the row folds.
8. The toggle's accessible name is "Show post #12 by Spritey" folded and "Hide post #12 by Spritey" open.

## Task 4. The newspaper unfold (engine)

Model: sonnet

**Files:** `engine/ui/thread/FoldBar.tsx` (or a `useFoldMotion` beside it in `fold.tsx`), `engine/ui/thread/fold.css`,
`engine/ui/thread/fold.test.tsx`.

- **No wrapper.** A wrapper that came and went with the fold would change the grid's parent and remount every cell when
  a fold lands or is reversed live. So the motion runs on the elements that are always there: the article
  (`data-kb-fold-moving` while a motion runs, which sets `perspective: 900px` on it) and the grid (`transform-origin: top
  center`, and `overflow: hidden` only while `data-kb-fold-moving`). The shade is the grid's `::after` (absolute over
  it, `linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.1))`, `pointer-events: none`, `z-index: 5`), its opacity
  `var(--kb-fold-shade, 0)`, a custom property the motion animates. Task 3's test 4 holds identity.
- **Open**, with `animate` from `motion` (`motion/react` is already imported by engine/ui/glass): remove `hidden`, read
  the grid's height, then together: the grid's `height` from `0` to that height (about 560 ms, ease
  `[0.2, 0.8, 0.2, 1]`); its `rotateX` from `-88deg` to `0` on a spring (stiffness about 170, damping about 18, so it
  settles with a small overshoot); `--kb-fold-shade` from 1 to 0. At the end the inline height, transform and shade are
  removed and `data-kb-fold-moving` with them, so nothing is left on at rest (a transform makes the grid a containing
  block for fixed descendants, as motion.ts's header warns of filters).
- **Fold**: the reverse, about 380 ms, ease `[0.55, 0, 0.75, 0.2]`, no spring; at the end the grid takes `hidden` and
  the inline styles are removed.
- **A press during a motion** reverses it from where it is: the running animations are stopped and the new ones start
  from the current values. `open` is the state at once, so `aria-expanded` and the words never wait on the motion.
- **Reduced motion:** where `currentFeel()` (engine/ui/glass/motion.ts) is `'off'`, read through `useFeel` so a change
  in Settings applies at once, nothing animates: the grid is shown or hidden at the press.
- In jsdom (tests) `animate` is not run: the hook takes the reduced path where `matchMedia` or `Element.animate` is
  missing, as the glass's tests do.

Tests first:
- Under `data-kb-motion="reduce"` on the root, a press shows the grid at once (no `hidden` after the press, no
  transform on the grid). Red first.
- After an open completes (mock `animate` resolving at once), the grid has no inline `transform`, `height` or
  `--kb-fold-shade`, and the article no `data-kb-fold-moving`.
- The grid element is the same node before a fold lands, while it is folded, and after the play is reversed.

## Task 5. Below the Fold uses the row (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/cards.ts` (Below the Fold's `CardUi`: `foldsRow: true`),
`instances/divided-world/ui/below-the-fold/Effect.tsx`, `fold.css`, `Effect.test.tsx`,
`instances/divided-world/ui/below-the-fold/Fold.board.stories.tsx`.

**The effect:**
- Given `fold` (a thread's post): it draws `children` and nothing else. Its `show` view is today's with `fold.open` in
  place of its own `open`: `state` "Folded for you" or "Open for you", `ends` `LENS_ENDS`, `yours` while folded, one
  control `{ kind: 'press', label: fold.open ? 'Hide post' : 'Show post', run: fold.toggle }`. `met()` once, on mount.
- Without `fold` (the ORIGIN box, the front door, a moment, History): today's bar inside the words, as it is.
- The header comment says which it is where, and names this design.

**`fold.css`** (the in-words bar where there is no row): restyled to the header tokens to match the row's bar:
`--kb-head-bg`, `--kb-head-fg`, `--kb-head-shadow`, bold mono small; the words "Show post"/"Hide post" first and the
chevron (the same inline SVG shape as the engine's, its own copy) on the right, pointing down folded and up open; the
focus ring in `--kb-head-focus`. `--kb-salty` leaves the arrow (it is no longer read on the dark band). The 44px coarse
pointer floor and the forced-colors block stay.

Tests first, in `Effect.test.tsx`:
1. Given `fold={{ open: false, toggle }}`: no `.dw-fold-bar` is drawn, the children are visible, and `show` got
   "Folded for you" with a "Show post" control whose `run` is `toggle`. Given `open: true`: "Open for you", "Hide post".
   Red first.
2. Without `fold`: every existing test still passes, with the bar's new markup (the chevron after the words).
3. The Lens word rules pass for both views given `fold` (`lens-words.ts`).

The stories: `Folded` and `Opened`, light and dark, keep their ids (`e2e/board-stories.test.ts` lists them), now showing
the row's bar. A `Reduced` story (light) sets `data-kb-motion="reduce"` as `engine/ui/cards/Reach.board.stories.tsx`
does. The header comment names this design.

## Task 6. The fold in a browser

Model: sonnet

**Files:** `e2e/fold.spec.ts`, `e2e/board-stories.test.ts` (the `Reduced` story id), and `e2e/focus.spec.ts` only if
its Below the Fold purchase (line 480) is affected (it should not be).

`fold.spec.ts`'s `bar` locator becomes `page.getByRole('button', { name: /^(Show|Hide) post #\d+ by /u })`, and
`body` the folded article's `.kb-act-grid`. Tests first, each red against the build of Task 5 without Tasks 3 and 4
where it can be:
1. The folded post shows the bar and none of its words, **and none of its postbit** (the post's `.kb-postbit` is
   hidden); a press shows them; the bar stays, reading "Hide post".
2. The bar's avatar, name and `#41` are visible; the bar is the full width of the posts' list (within 1px).
3. A mark on the bar opens the post's Lens without unfolding the row (`aria-expanded` stays false).
4. Tab reaches the toggle and Enter opens it; Shift+Tab from the first control inside the opened row returns to the
   toggle.
5. With `reducedMotion: 'reduce'` emulated, a press shows the row in the same frame (no `transform` on the grid once
   `settled`).
6. Without reduced motion, the open settles with the grid at rest (no inline transform, no fixed height) after
   `settled(page)`.
7. axe finds nothing on the folded and the open post, light and dark, as today.
8. At 390 px wide, the bar is at least 44 px tall and its name truncates rather than wrapping.

Then the full build, `npm run build`, with its tail in the PR.

## Review focus

- **Every reader of a post's cells** after Task 1: a selector or query that took the article's direct children (CSS,
  `landPost`, `Moment.tsx`, the callout's row measure, Whoops!'s measure of `.kb-act-main`, tests) and now misses them
  silently. A miss here draws nothing wrong in a test and a wrong layer in a browser.
- **The stacking contexts** after `isolation` moves to the grid: the marks strip and the callout hang over the words,
  gear reaches under, glitter lies on a cell; and now the marks hang from the bar while folding. `e2e/post-layers.spec.ts`
  holds the old three; the bar's marks over the opened row's first line are new.
- **A transform left on at rest** (Task 4): a fixed descendant (Stick Around's lifted post, a Lens or a popover anchored
  in the row) would be trapped by a leftover `transform` on the grid.
- **Stick Around on a folded post**: its `holdScreen(inView)` sees a hidden grid as out of view, so it does not hold the
  screen until the row is opened; check that it then holds, and lets go when the row is folded again.
- **A fold that lands or is reversed live**, while the reader has the row open, an editor open in it, or focus in it:
  the grid must keep its identity (no remount) when the bar appears or goes, and a fold landing on a post being edited
  folds it with the editor still mounted.
- **A veiled post** (Whodunnit?): the bar must show the stand-in, never the author's own name or avatar.
- **Many folded posts on a page**: one bar each and no observer or animation per post at rest; motion only runs on a
  press.
