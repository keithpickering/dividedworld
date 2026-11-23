# The Big Reveal, a curtain over a whole post: plan

Record, written 2026-11-23. Carries out `docs/plans/2026-11-23-big-reveal-design.md`. One PR from `main`.

**May start** once the design and this plan merge. Task 5 waits on the owner's three sound takes in
`docs/research/2026-11-23-big-reveal/sounds/`; every other task can be built before they arrive, and the PR is not
opened until Task 5 is done.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the
rules' tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched.

**The layers.** Tasks 1 to 3 change the engine, and nothing they add names a card or Divided World: the words are
"covers the row", "cover", "covered". Tasks 4 to 8 are Divided World's, carried in through `CardRules` and `CardUi`.
**No migration**: `stack`, `drawsEffect` and `rarity` reach `card_kinds` through `seed_instance`
(`supabase/functions/_shared/seed.ts`), and the price is decided in TypeScript.

**The world.** The curtain is a game piece on the board, drawn in its fabric's color; the post under it stays the
house style. The play form and the Lens are the engine's glass.

**Names used below.** Key `big-reveal`, between `below-the-fold` and `blind-study` in every sorted list. Rules in
`instances/divided-world/cards/big-reveal.ts`; screens in `instances/divided-world/ui/big-reveal/`; classes begin
`dw-reveal`. Effect CSS sits in that folder, never directly in `ui/` (`tools/check-theme.mjs` reads `ui/*.css` as
themes).

## Task 1. `playPrice` sees the target's effects

Model: sonnet

**Files:** `engine/rules/cards.ts` (`CardRules.playPrice` at about l.471, `decidePlay` at about l.610),
`engine/ui/cards/PlayForm.tsx` (`ownPrice`, about l.208), `engine/ui/cards/faces.ts` (`extraOf`, about l.129),
`instances/divided-world/cards/you-were-saying/ConfigForm.tsx` (l.52), and the rules' tests beside `cards.ts`.

- The signature becomes `playPrice(settings, target, config, effects: readonly CardEffect[]): Hundredths`. Its doc
  comment says the effects are the target's own and above it, as `canApply` is given them, all public.
- `decidePlay` passes its `effects`. `PlayForm` passes the same `effects` it builds from `plays` (about l.361) for the
  post it prices. `faces.ts` passes `[]`: a face shows what the first play on a bare post adds. You Were Saying's form
  passes `[]` (its price does not read them).
- Every card's `playPrice` keeps working unchanged: a function with fewer parameters is still assignable.

Tests, red first: in the rules' tests, a test card whose `playPrice` returns 100 times the number of its own live plays
in `effects`. `decidePlay` on a post carrying two of them prices 200, and an ended one is not counted by the card's own
filter (the test card filters with `isLive`). In `PlayForm`'s test, the surcharge row shows the price for a post that
already carries the test card.

## Task 2. `coversRow`: a card that covers the whole row

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`CardUi`, `EffectProps`), a new `engine/ui/thread/cover.tsx`,
`engine/ui/thread/Post.tsx` (about l.262-349), `engine/ui/cards/Effects.tsx` (`nestOrder` at about l.402, `wrapIn`
at about l.261-285), `engine/ui/tips/problems.ts` (beside `foldsRowProblems`, l.129), their tests
(`engine/ui/cards/Effects.test.tsx`, `engine/ui/tips/problems.test.ts`, `engine/ui/thread/Post.test.tsx` or the
nearest existing Post test).

What it adds:

- `CardUi.coversRow?: true` and `CardUi.Cover?: ComponentType<CoverProps>`. The doc comment: a live play of this card
  on a post covers the post's whole row in a thread; the engine mounts `Cover` over the row and holds the reader's
  state; where a post has no row, the card's `Effect` covers the content area itself.
- `cover.tsx` holds:
  - `interface RowCover { readonly shut: number; readonly total: number; readonly open: () => void; readonly encore: () => void }`.
    `total` is the number of live covering plays on the post's own reach. `shut` is how many are still shut for this
    reader, from `total` down to 0.
  - `RowCoverCtx` and `useRowCover()`, like `RowFoldCtx` in `engine/ui/thread/fold.tsx`.
  - `CoveredCtx`, a context of one boolean, `true` while any cover over this post is shut, with an exported provider
    so a card's `Effect` can provide it where there is no row.
  - `CoverProps`: `{ plays: readonly CardPlay[] /* by layer, latest outermost first */, cover: RowCover, post: Id }`.
- `Post.tsx`: `covering` is computed the way `folding` is (a live own-reach play of a `coversRow` card). The state is
  `useState(0)`, the number this reader has opened, capped at `total`. A new play landing raises `total`, so a new
  curtain is shut for a reader who had opened the rest. Encore sets it back to 0. The page's memory alone. Inside
  `.kb-act-grid`, when `shut > 0`, the engine draws a host `div.kb-row-cover` positioned over the whole grid and
  mounts the card's `Cover` in it; the grid's other children get `inert` while `shut > 0`. `RowCoverCtx` and
  `CoveredCtx` wrap the grid. With a fold too, the fold's bar stays outside the grid, so it is outermost.
- `EffectProps.cover?: RowCover`, given by `wrapIn` only to a `coversRow` card on its post's own reach where
  `useRowCover()` is not null (as `fold` is given). `EffectProps.covered: boolean`, read from `CoveredCtx` by
  `BoundEffect` and given to every effect.
- `nestOrder` returns a fourth group, `covers`, outermost, outside `takeovers`; a card that covers the row is never in
  `rest` or `takeovers`. Its header comment says so.
- `problems.ts`, `coversRowProblems`: a `coversRow` card must have both `Cover` and `Effect`, must not be a `takeover`,
  and must not also set `foldsRow`.

Tests, red first:

- `nestOrder` puts a covering card outside a takeover and outside a card played after it.
- A post with a covering play draws the card's `Cover` over the row, makes the postbit and words inert, and gives
  `covered: true` to another effect on the post. `open()` once with one play removes the cover, lifts `inert` and gives
  `covered: false`. With two plays, the first `open()` leaves `shut: 1`. `encore()` shuts both again.
- A fold and a cover on one post: the fold's bar is drawn outside the grid, and the cover inside it.
- `instanceUiProblems` names a `coversRow` card with no `Cover`, one that is a takeover, and one that also folds.
  Each is its own poisoned input, and each is seen red before the check is written.

## Task 3. Effects that start on sight wait while the post is covered

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `instances/divided-world/ui/glitter-bomb/Effect.tsx`,
`instances/divided-world/ui/hot-box/Effect.tsx`, `instances/divided-world/ui/laugh-track/watch.ts` (and its
`Effect.tsx`), `instances/divided-world/ui/stick-around/Effect.tsx` and `takeover.ts`, and each one's test. Read every
other `IntersectionObserver` user under `instances/` and `engine/ui/` (`grep -rln IntersectionObserver`) and list in
the PR any that start an effect on sight and are not in this list.

Each reads `covered` from its `EffectProps` and treats a covered post as out of view. Nothing is armed, thrown, burst,
rolled in, murmured or taken over while `covered` is true. When it turns false with the post in view, it starts as if
the post had just scrolled in. Steel Chair's Throw again, while covered, does nothing.

Tests, red first: for each, render with `covered: true` and the post in view (the test's observer stub), and assert
nothing started; flip to `false` and assert it starts once.

## Task 4. The card's rules

Model: haiku

**Files:** `instances/divided-world/cards/big-reveal.ts`, `instances/divided-world/cards/big-reveal.test.ts`,
`instances/divided-world/cards/index.ts` (one import and one `listed` line, sorted), `instances/divided-world/cards/cards.test.ts`
(the prices table: `['big-reveal', 'pepperoni', 150]`), `instances/divided-world/settings.ts` (`economy`).

`big-reveal.ts`, opening with a header comment that names the design:

```ts
export const FABRICS = {
  red: { name: 'Red', dark: '#af0000', mid: '#ee0000', light: '#f73434' },
  'royal-blue': { name: 'Royal Blue', dark: '#0a1f6b', mid: '#1f3fbf', light: '#4a6bef' },
  purple: { name: 'Purple', dark: '#3b0a5c', mid: '#6a1b9a', light: '#9c4dcc' },
  emerald: { name: 'Emerald', dark: '#04402a', mid: '#0b7a4b', light: '#2fb37a' },
  gold: { name: 'Gold', dark: '#7a5a00', mid: '#c9a000', light: '#f2d24a' },
  black: { name: 'Black', dark: '#050505', mid: '#1c1c1c', light: '#3a3a3a' },
} as const;
export type Fabric = keyof typeof FABRICS;
```

`bigReveal: CardRules<{ fabric: Fabric }>`:

- Basics: `key: 'big-reveal'`, `name: 'The Big Reveal'`, `alignment: 'pepperoni'`, `rarity: 'uncommon'`,
  `reaches: ['post']`, `stack: 3`, `drawsEffect: {}`.
- `reads`: `[{ key: 'bigReveal.secondAdd', whole: true, min: 0 }, { key: 'bigReveal.thirdAdd', whole: true, min: 0 }]`.
- `staffConfigs`: one `{ fabric }` for each fabric.
- `validateConfig`: a config whose `fabric` is a key of `FABRICS` gives `ok({ fabric })`. A missing `fabric` gives
  `ok({ fabric: 'red' })`. Anything else refuses `'the curtain is one of the listed fabrics'`. No other key is kept.
- `canApply`: `landsOn(bigReveal, target, effects, now)`.
- `playPrice(settings, target, _config, effects)`: on a post, count the live own-reach plays of `big-reveal` in
  `effects` (`isLive`, reach unset or `'post'`). 0 of them gives 0, 1 gives `economyOf(settings, 'bigReveal.secondAdd')`,
  and 2 or more gives `economyOf(settings, 'bigReveal.thirdAdd')`. Off a post, 0.
- `export const price: Hundredths = 150`.

`settings.ts` economy: `'bigReveal.secondAdd': 100`, `'bigReveal.thirdAdd': 200`.

Tests, red first:

- The fields, as `cards.test.ts` checks Below the Fold's (l.235).
- The price table row.
- A fourth curtain refuses with `landsOn`'s words.
- Prices of 0, 100 and 200 for a bare post, one curtain and two curtains, and 0 again when the one curtain has ended.
- An override of `bigReveal.secondAdd` reaches the price (as the test at `cards.test.ts` l.95 does for another card).
- `validateConfig` accepts each fabric, defaults to red, and refuses `'#ff0000'` and `'Red'`.

## Task 5. The sounds

Model: haiku

**Waits on** the owner's three takes in `docs/research/2026-11-23-big-reveal/sounds/` (a record, left as it is). If
they are not there, this task stops and asks; nothing else is used in their place.

**Files:** `instances/divided-world/ui/sounds/big-reveal-drumroll.mp3`, `big-reveal-whoosh.mp3`,
`big-reveal-tada.mp3`, `instances/divided-world/ui/sounds/sounds.json`, `instances/divided-world/ui/sounds.ts`,
`instances/divided-world/ui/index.test.tsx` (the sounds table).

- Cut each with `ffmpeg`, as `docs/plans/2026-11-15-steel-chair-plan.md` Task 2 does. The drumroll is cut at a point
  where it loops without a click, and is checked by playing it looped in a story. The whoosh and tada are trimmed to
  their sound, each under 300 KB.
- `sounds.json` gets three entries with `source: "ElevenLabs Sound Effects"`, and the `license` and `maker` strings the
  existing entries carry, copied exactly. Then `node tools/measure-sounds.mjs` writes `lufs`, `peak` and `sha256`, and
  `node tools/check-sounds.mjs` passes.
- `sounds.ts` gets three slots, ink `'var(--kb-pepperoni)'`:
  - `big-reveal.drumroll`, caption `'Drumroll'`, with `loop` set.
  - `big-reveal.whoosh`, caption `'Curtain whooshes open'`.
  - `big-reveal.tada`, caption `'Ta-da!'`.

Tests, red first: the sounds table in `index.test.tsx` grows by the three keys and captions.

## Task 6. The curtain on screen

Model: sonnet

**Files:**

- `instances/divided-world/ui/cards/big-reveal/ui.ts`
- `instances/divided-world/ui/cards.ts` (one line, sorted)
- `instances/divided-world/ui/index.test.tsx` if it lists cards
- `instances/divided-world/ui/moment.test.tsx` (the drawn and unreactive lists at l.84 and l.174)
- in `instances/divided-world/ui/big-reveal/`:
  - `Curtain.tsx` (the drawing and its motion, shared by both places)
  - `Cover.tsx`
  - `Effect.tsx`
  - `ConfigForm.tsx`
  - `confetti.ts`
  - `reveal.css`
  - `BigReveal.board.stories.tsx`
  - tests beside each

The curtain (`Curtain.tsx`):

- **Shape.** Two halves drawn from the pleat shape of `docs/research/2026-11-23-big-reveal/minus-world/curtain.svg`,
  three pleats each, stretched to the covered box's height. Each pleat's gradient is the fabric's dark, mid, light, mid
  and dark shades at the drawing's stops (0.05, 0.24, 0.50, 0.75, 0.95). Along the top edge, a row of swags drawn from
  `curtain-draped.svg`, enough to span the width, in the fabric's shades with the gold trim kept gold.
- **Drawing.** Drawn as inline SVG or CSS gradients, never by loading the research files at run time.
- **Under it.** The next curtain in the stack, if any, then the post.
- **Spotlights.** Two soft ellipses. While the drumroll plays they trace a figure 8 (a lemniscate) over the curtain's
  visible part, about 3 s per lap, out of phase with each other. At rest they sit still, dim, either side of the middle.
- **The button.** The curtain is one `button` covering the box, with `data-kb-over-ink`. Its label is "Open the
  curtain", plus ", 1 of 3" where `total` is above 1, counting from the outermost. Focus shows a visible ring inside
  the box.
- **Drumroll.** The `big-reveal.drumroll` loop, in group `big-reveal`, with the play's id. With a mouse, it starts on a
  gesture by Laugh Track's rule (`instances/divided-world/ui/laugh-track/Effect.tsx`, the document `pointermove` record
  and `moved`) and stops on leave. On touch (no mouse position known, a coarse pointer), it plays while the curtain
  crosses the reader's line (the `laughTrack.line` card setting, read the way `laugh-track/watch.ts` reads it) and
  stops when it leaves. It stops on open and on unmount.
- **Opening press.**
  - It opens on `click`, or on Enter or Space.
  - A click opens nothing if the text selection is not collapsed, if the pointer moved more than 10 CSS px since
    `pointerdown`, or if the page scrolled since `pointerdown`. That last one is the latent drag, such as a tap that
    only stops a fling.
  - On open: stop the drumroll, play `big-reveal.whoosh` and then `big-reveal.tada` (group `big-reveal`, voices 2).
    The halves translate out left and right and the swags up over 750 ms (ease-in), then confetti, then `cover.open()`
    (or the Effect's own count) once the halves are out.
- **Confetti.** Built in `confetti.ts` as a pure function of a seed, the play's id, so tests can pin it.
  - About 120 pieces, small rectangles in the fabric's light shade, gold and white.
  - Thrown up from the bottom edge and falling within the covered box over about 2 s, on one canvas with
    `pointer-events: none`, then removed.
  - It may cross the box's top border on its way up: that is the joke of a burst.
- **Reduced motion** (`useFeel() === 'off'`). The press still opens it. The halves are removed at once, the spotlights
  stand still, and no confetti. Both sounds still play.
- **Forced colors.** The curtain is a solid `CanvasText` panel with "Open the curtain" in `Canvas`, so the post stays
  hidden and the press is the same.

`Cover.tsx`, the row cover the engine mounts (Task 2): it draws the outermost shut curtain from `plays`, in its fabric,
and the next one under it so it shows as the halves part.

`Effect.tsx`:

- **With `cover` (a thread post).** It draws `children` alone and only reports to the Lens.
- **Without `cover`** (the ORIGIN box, the front door, a moment, History):
  - It draws the curtain over its nearest `[data-kb-content-area]` box, border to border, the ORIGIN box's area under
    its band included.
  - It keeps its own count of opened curtains in state.
  - It wraps its children in the engine's `CoveredCtx` provider while any is shut.
- **The Lens** (`show`, as `instances/divided-world/ui/below-the-fold/Effect.tsx` does):
  - `state` is `'Curtain N of M shut for you'` while any is shut, or `'Open for you'`. It is `'Shut for you'` when M
    is 1.
  - `controls` holds `{ kind: 'press', label: 'Open the curtain', run }` while any is shut, and
    `{ kind: 'press', label: 'Encore', run: encore }` once all are open.
  - `yours` is true while shut.
- **`met()`** is called on the first draw, as Below the Fold calls it.

`ConfigForm.tsx`: a radiogroup of the six fabrics, each a swatch of its mid shade with its name, default Red, styled as
Hot Box's form (`instances/divided-world/ui/hot-box/ConfigForm.tsx`) without its free picker.

`ui.ts`:

- `art`: `{ color: '#ee0000', ink: '#1a0000', canvas, mark, credit, tagline: 'Hide it behind a curtain. Ta-da!' }`.
- `summary`: `'Hangs a curtain over a post, author and all. Each reader opens it with a press, to a drumroll.'`
- `status`: `(plays) => plays.length > 1 ? \`${plays.length} curtains stacked\` : 'Behind a curtain'`.
- `hint`: `'Press the curtain to see the post.'`
- `Effect`, `Cover` (both lazy), `ConfigForm`.
- `coversRow: true`.
- `sounds`: the three keys.
- `tag`: the play's fabric's mid shade.
- `describe(settings)`: "A Pepperoni card, uncommon. It hangs a curtain in the fabric you choose over a post, author and
  all. A drumroll plays while a reader points at it, and one press opens it, with a ta-da and confetti. Each reader
  opens it for themselves, and the post's effects start only then. Up to 3 curtains stack, each opened in turn; the
  second costs {secondAdd} more to play and the third {thirdAdd} more." The two numbers are read from
  `settings.economy` with `orbs()`, never written in.
- `logPlay(config)`: `It hung a ${FABRICS[fabric].name} curtain over the post.`

Tests, red first:

- `confetti.ts` gives the same pieces for the same seed.
- **Curtain button.** It has its label with and without a stack. It opens on Enter and on Space. A click after a
  12 px move opens nothing, as does a click after a scroll and a click ending a selection. Under reduced motion it opens
  at once with no confetti canvas.
- **Sound.**
  - The drumroll loop starts on a moved pointer, not on an enter at the last-known position.
  - On a touch-only page it starts when the line crosses the curtain.
  - Whoosh and tada play on open.
- **Effect without cover.** It covers the content area, provides `covered`, and the Lens state and controls move from
  "Shut for you" with Open to "Open for you" with Encore, and back on Encore.
- **The fabrics.** The form submits each fabric and defaults to Red.
- **Words.** `describe` reads the two numbers from settings, and the `tagline` and `status` fit `lens-words.ts`'s
  limits.

Stories:

- one curtain, closed and opened
- three stacked, in Red, Royal Blue and Gold
- with Below the Fold
- over Steel Chair, which throws only when opened
- reduced motion
- forced colors
- in the ORIGIN box

Each story is added to `e2e/board-stories.test.ts` as its siblings are.

## Task 7. The card's art

Model: sonnet

**Files:** `instances/divided-world/ui/cards/big-reveal/art.webp` (1080×1680), `mark.svg`, `art.json`
(`credit: "Divided World"`, the CC0 license string Hot Box's carries), and `scene.blend`, as `ui/cards/hot-box/` holds
them, made by `docs/plans/2026-11-11-rendered-card-art-design.md` and `specs/card-art.md`.

- **The scene.** It follows `docs/research/2026-11-23-big-reveal/card-art-reference.png`: red curtains drawn back by
  gold tiebacks, a dark backdrop, a bare wooden stage, and a white chicken with a red comb in a spotlight.
- **The mark.** The two tied-back curtain halves as a square emblem.

`node tools/check-card-art.mjs` passes. The art is shown to the owner in the PR as an image, and is theirs to approve.

## Task 8. Browser checks

Model: sonnet

**Files:** `e2e/big-reveal.spec.ts`, `e2e/origin-effects.spec.ts` (one case).

- **In a thread, with a mouse.**
  - The row, postbit included, is hidden under the curtain and not reachable by Tab past the curtain's button.
  - Moving the mouse onto it starts the drumroll caption.
  - A click opens it. The tada caption shows, and the post's name and words are visible and pressable.
  - Encore in the Lens shuts it again.
- **Three stacked.** Three presses are needed, each showing the next fabric, and the third shows the post.
- **On a phone** (a Playwright device), scrolling the post through the line shows the drumroll caption.
  - A swipe that starts on the curtain scrolls and does not open it.
  - A tap opens it.
- **Keyboard alone.** Tab to the curtain, then Enter, opens it.
- **Reduced motion** (`reducedMotion: 'reduce'`). One press, and no confetti canvas.
- **Below the Fold on the same post.** The bar, then the curtain, then the post.
- **ORIGIN box.** The curtain fills the box under its band and opens on a press. Add this case to
  `e2e/origin-effects.spec.ts`.
- `tools/check-effect-blend.mjs` and `tools/check-effect-canvas.mjs` pass over the new stories.

## Review focus

- **Effects that start on sight.** Task 3's list may miss one: one that fires under a shut curtain (a sound or a throw
  behind it) gives the reveal away.
- **Price race.** `playPrice` is read as the post stands when the play is decided. Two casters racing for the second
  slot can both pay the second curtain's price; check that SQL's stack check still refuses a fourth, and that nothing
  else reads the new argument as if it were current.
- **Stacking on an open post.** A new play landing on a post a reader has opened must shut only the new curtain for
  them (`total` rises, the count opened does not). A reader whose open count is above a lower `total`, after an admin
  ends a play, must not be left with a negative or stuck count.
- **The latent drag.** The click guard against a press that only ends a fling or a scroll has to hold on iOS Safari
  and Android Chrome, where `click` after a momentum stop differs.
- **`inert` on the row.** It must lift on open and on Encore's re-shut. A cover left mounted after its last play ends
  would leave the post unreachable, which is a dead end.
- **Cost on a busy page.** A thread of many curtained posts: one confetti canvas at a time, the drumroll loop in one
  group, and spotlights animated only while their curtain is in view.
- **Masks.** Nothing about opening is sent, and the price reads only the post's public effects.
