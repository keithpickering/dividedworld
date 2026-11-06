# Whoops! refinements: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-whoops-refinements-design.md`. One build session builds it
in one PR from `main`. The look and the motion are the Whoops! bench (`docs/research/2026-11-06-whoops-bench/01-bench.html`),
which the owner approved on 2026-11-06. Its numbers are the defaults unless this plan names others. Where the bench and
the design disagree, the design wins on what is decided and the bench on how it looks.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. No migration
and no SQL: `effect_state` keeps its 256 KiB bound, and the database never reads a stroke's shape.

The layers: Task 6 is engine (`engine/ui/reactions/`, `engine/ui/spin/`, `engine/ui/thread/thread.css`, and a comment in
`engine/ui/tokens.css`). Every other task is the instance's (`instances/divided-world/`, `e2e/`).

## Task 1: the splat is a field of balls, kept round

Model: sonnet

Files: `instances/divided-world/cards/whoops/splat.ts`, `splat.test.ts`.

- Replace `Splat` (path, blob, circles) with this:

  ```ts
  export interface Ball { readonly x: number; readonly y: number; readonly r: number } // design box 1.25 × 1
  export interface Splat { readonly balls: readonly Ball[]; readonly placement: { cx: number; cy: number } }
  export interface Box { readonly w: number; readonly h: number } // the body's box on this screen, CSS px
  export const DESIGN = { w: 1.25, h: 1 } as const;
  export const THRESHOLD = 0.42;
  ```

- `makeSplat(seed)` is the bench's `makeSplat` (as published in the research file), with the same constants.
- `unitPx(box)`: `√(box.w · box.h / 1.25)`, how many px a design unit is on this screen. A ball's center in px is
  `(x / 1.25 · w, y · h)`, and its kernel reach is `2r · unitPx`.
- `fieldAt(splat, box, u, v)`: the summed field at the point `(u·w, v·h)` px, each ball adding `(1 − d²/R²)³` within `R`.
- `covers(splat, box, u, v)`: `fieldAt(…) >= THRESHOLD`.
- `fieldGrid(splat, box, density)`: a `Float32Array` over `ceil(w·density) × ceil(h·density)` pixels, each ball touching
  only the pixels within its reach. Painting uses it (Task 4).
- Keep `mulberry32`, `rgbOf`, `luminance`, `shading`, `contrast` and the named-color table unchanged.

Tests first, in `splat.test.ts`. Replace the outline's tests with these:
- **Seeding.** One seed gives the same balls twice, and two seeds give different ones. Nothing reads `Math.random`
  (spy on it).
- **The threshold.** A lone ball's edge sits at its radius: `covers` is true just inside `r · unitPx` px and false just
  outside it.
- **Kept round.** For one droplet ball, its covered extent across equals its extent down in px, within a pixel, on a
  988×330 box and on a 390×1200 box.
- **Whole body.** On both boxes, at least 70% of a 20×20 grid of points across the box is covered, and the box's center
  is.
- **Rounded joins.** Along a line from the core's center out through an arm's first bead, the field never dips below the
  threshold between them: the arm is joined, with no notch.
- **Cost.** `fieldGrid` for a 390×1200 box at density 1 finishes in under 250ms in Node (a guard against an all-pixels
  loop per ball).

## Task 2: what the card keeps of a stroke

Model: sonnet

Files: `instances/divided-world/cards/whoops.ts`, `instances/divided-world/cards/cards.test.ts`.

- `STROKES` becomes `{ most: 200, points: 500, totalPoints: 12_000, widest: 1, deepest: 1 }`.
- `validateState` checks the shape in the design's section 3:
  - `aspect` is required, finite, from 0.001 to 1000, and kept to three significant figures.
  - `width` is in (0, 1], kept to a ten-thousandth, and refused when that rounds to 0.
  - Each point is across 0 to 1 and down 0 to 1, kept to a ten-thousandth.
- The refusal words name the predicate that failed, as today's do.
- Update the file's header comment: strokes are in shares of the post body's box, not widths of a fixed layout.

Tests first, in `cards.test.ts`:
- **The largest save fits.** Rewrite "the most strokes Whoops! saves fit the database's bound" with each point at its
  longest (`[0.123456789, 0.987654321]`), `width: 0.99994321` and `aspect: 0.00123456`.
  - Assert it fits in 262,144 bytes as Postgres writes it.
  - If it does not, lower `STROKES.totalPoints` to the largest round thousand that fits, and say so in the PR.
- **Rounding.** Rewrite "a stroke's points and width are kept to a thousandth" for a ten-thousandth, with `aspect` kept to
  three significant figures (`2.34567` → `2.35`, `0.0123456` → `0.0123`).
- **Refusals.** Each is refused by name:
  - a missing `aspect`;
  - `aspect: 0` and `aspect: 5000`;
  - a point down at 1.2;
  - `width: 1.5`;
  - `width: 0.00004`.
- **The kept table.** The existing `ink` and `wash` fixtures in the validation test become valid shares, with `aspect`.

## Task 3: the layer model in the body's box

Model: sonnet

Files: `instances/divided-world/cards/whoops/scrub.ts`, `scrub.test.ts`, `lines.ts`.

- **Remove the fixed layout's exports:** `REF_WIDTH`, `BODY_GUTTER`, `MAX_SCALE`, `layoutOf`, `toLayout`, `px` and the
  derivation comment. Keep the reasoning that survives in a short header: what a share of the box is, and why the brush
  is in px.
- **Measures in px:** `BRUSH_PX = 30`, `PEN_PX = 9`, `ROW_PX = 22.5`, `SWEEP_BRUSH_ROWS = 1.15`, `CELL_PX = 12.5`,
  `BUCKET_PX = 50`, `MIN_STEP_PX = 5`. `SWEEP_SPEED = 0.55` stays, now in shares of the box's width a second.
- **`Stroke`** gains `aspect` (Task 2's shape).
- **`fitStroke(stroke)`** keeps points to the box (0 to 1 both ways) to a ten-thousandth, and `aspect` to three
  significant figures. It thins by a `minStep` in shares that the caller passes from `MIN_STEP_PX` and the box.
- **`LayerInk`** is constructed as `new LayerInk(splat, strokes, box)`:
  - The grid's cells are `CELL_PX` square in px, laid over the box, from 0 to 1 both ways. Ink past the box is never
    counted. That is what today's `region` was for; it is now always the box.
  - A segment is kept with its two radii in shares of the box: across `width / 2`, down `width / 2 · aspect`. A share of
    the height is a share of the height on any box, so this is the same ellipse in shares everywhere. In px on this
    box it is `width / 2 · box.w` by `width / 2 · aspect · box.h`.
  - Distances are tested after scaling into the ellipse's unit circle.
  - `has`, `washed`, `inkSpan`, `inkNear`, `wash`, `pen` and the buckets keep their meaning.
- **`bandsOf(box)`**: the centers of rows `ROW_PX` tall down the box, in shares.
- **`topLayer`, `sweepStep` and `coveredLines`** keep their contracts, in shares.
- **`lines.ts`:** `readLines(root, box)` reads word boxes relative to the box's origin and divides by `box.w` across and
  `box.h` down. `SAME_LINE` is a quarter row in px.

Tests first, in `scrub.test.ts`. Remove the reference-width and layout tests, and add these:
- **The brush follows the drawer's box.** A dab made on a 988×330 box (`width = 30/988`, `aspect = 988/330`) washes a
  round dab 30px across there. On a 390×1200 box the same dab washes an ellipse about 11.8px across by 109px down
  (radii `15 · 390/988` and `15 · 1200/330`), as the design's formula gives. Assert the extent with `has`.
- **Ink past the box is never counted.** Washing every cell of the box reaches clean.
- **The share only rises.** Washing row by row with `bandsOf` and `sweepStep` raises the share every step until clean.
- **The sweep's pace.** Kept: 0.55 of the box a second, a line at a time, never all at once.
- **Pen strokes and stroke order.** A pen stroke written over a wash is ink again, and a wash after it removes it
  (today's tests, moved to shares).
- **Covered lines.** `coveredLines` marks a line covered at half its length under ink, in shares.
- **A drawing keeps its place.** A stroke's points land at the same shares on two boxes, and its washed cells on each
  match the shares it passed.

## Task 4: painting wet ink

Model: sonnet

Files: `instances/divided-world/cards/whoops/paint.ts`, `ConfigForm.tsx`, `ConfigForm.test.tsx`.

- **`paintSplat(splat, color, box, density)`** returns a canvas of the splat painted from `fieldGrid`, as the bench's
  `renderSplat` does:
  - anti-aliased edge from the signed distance;
  - the meniscus (3.5 CSS px, slope 1.5);
  - light from `(−0.45, −0.65, 0.62)`;
  - specular power 60 at `0.55 + 0.45 · (1 − L)`;
  - a pale ink's rim, `0.5 · L` over 1.6 CSS px;
  - the broad gloss and the underside.
  `density` is at most 1. The Effect caches one per layer per box (Task 5).
- **`paint(canvas, geometry, layers)`** keeps its job: each layer composited through the one shared scratch canvas, then
  drawn in its alpha. It now draws the cached splat canvas scaled to the ink canvas. Each stroke is a path in px of this
  box, with the stroke's ellipse: transform so the brush is circular, then `lineWidth` in that space. A wash is
  `destination-out` with a `shadowBlur` of 2.5 device px, so its edge is soft as on the bench. A pen is `source-over` in
  its color.
- **`Geometry`** becomes `{ dpr, box, top, left }`. `left` and `top` are where the box's origin lies in the canvas's frame
  (Task 5).
- **`ConfigForm`'s preview** is a `<canvas>` painted by `paintSplat` for a fixed seed on a 360×220 box. It keeps
  `data-kb-edge-shadow` and the other attributes its test reads, set from `shading()`.

Tests first:
- **In `ConfigForm.test.tsx`:** the preview is a canvas, and still says its shading for a dark and a pale ink.
- **In a new `paint.test.ts`,** with a stub 2D context recording calls (the pattern `Effect.test.tsx` already uses for
  its canvas tests):
  - `paint` draws one image per live layer and none for a layer at alpha 0.
  - A wash is drawn with `destination-out`.
  - A pen is drawn with `source-over` in its color.
  - A stroke from a box of another aspect is drawn under a non-uniform transform whose ratio is the formula's.
- **Pixels.** `paintSplat`'s pixels are covered where `covers` says and transparent where the field is far below the
  threshold. Check with a tiny box under a canvas stub that keeps `ImageData`, or skip with a note where jsdom has no
  canvas (the e2e in Task 9 sees the pixels).

## Task 5: the Effect in the body's box

Model: sonnet

Files: `instances/divided-world/cards/whoops/Effect.tsx`, `whoops.css`, `Effect.test.tsx`.

- **No fixed layout.** The layout element keeps no width, transform or padding. `whoops.css` drops the frame's
  `margin-inline` bleed and the `[style*="width"]` rule.
- **The box.**
  - In the thread (`place === 'thread'`), the box is the cell (`.kb-act-main`, found at each measure, as today), its
    padding box: `cell.clientWidth × cell.clientHeight`. The frame's offset in it is measured from the two rects.
  - In the ORIGIN box, the box is the frame.
  - The `ResizeObserver` follows both.
  - `size` becomes `{ box: Box, left, top }`.
- **The ink canvas** is positioned in the frame at `left: −left, top: −top` and sized to the box. Its density is
  `min(MAX_DPR, devicePixelRatio, √(4_000_000 / (w·h)))`. The `band` computation goes.
- **Splats.**
  - Each layer's painted splat is cached by `(seed, color, w, h)` while the post is near, and let go with the grids when
    it leaves.
  - `LayerInk` is built with the box.
  - The grids are rebuilt when the box changes, as they are today when the height does.
- **Input surface.**
  - In the thread, pointer and touch listeners go on the cell, added in an effect and removed on cleanup or when the cell
    changes.
  - In the ORIGIN box they go on the frame (as today).
  - A press whose target is inside `[data-kb-over-ink]` starts nothing.
  - The click-swallowing after a stroke stays, on the same element.
- **Mouse and pen:** pointer events, as today, in shares of the box. The brush's share is `BRUSH_PX / box.w`, and
  `aspect = box.w / box.h`.
- **Touch: the design's section 6, exactly.**
  - Touch events, with `touchmove` non-passive.
  - The states: `wait`, `wipe`, `page`.
  - Constants: `HOLD_MS = 180`, `SLOP_PX = 8`.
  - On hold: a suds puff, and `navigator.vibrate?.(8)` in a try.
  - Once wiping, `preventDefault` on each cancelable `touchmove`.
  - A second finger is the page's.
  - A tap washes a dab.
  - Pointer events whose type is `touch` are ignored, so a finger is never read twice.
  - The frame and the cell keep `touch-action: pan-y pinch-zoom`, so a sideways swipe never waits on the browser.
- **The sweep** reads `bandsOf(box)`, with its brush at `SWEEP_BRUSH_ROWS · ROW_PX / box.w` (and its aspect).
- **Lines.** `readLines(layout, box)` at each rebuild.
- **The suds and the cursor** are Tasks 7 and 8's modules. The Effect calls `suds.wash(...)`, `suds.puff(...)` and
  `cursor.over(...)`, and hosts its suds canvas inside the frame, over the ink and under what is lifted. `z-index` is
  `data-kb-effect-ink`'s, and the canvas comes later in order.

Tests first, in `Effect.test.tsx`:
- **Rewrite** "the post's words are laid out at the body's width at the board's max and scaled…": the layout has no
  transform or fixed width at 390px or at 988px.
- **Rewrite** "a stroke saved at the board's max uncovers the same words read at 390px": a stroke saved on a 988×330 box
  lands at the same shares on a 390×1100 box, and a dab there is an ellipse by the formula.
- **Add** "a press beside the reactions row, on ink, starts a stroke": render inside a `.kb-act-main` with a fit-content
  `[data-kb-over-ink]` sibling. Then "a press on a chip inside `[data-kb-over-ink]` starts nothing, and the chip's click
  goes through".
- **Add the touch tests,** with `TouchEvent` and fake timers:
  - A quick vertical swipe from ink washes nothing, and its `touchmove` is not prevented.
  - A sideways swipe washes, and its later `touchmove`s are prevented.
  - A hold of 180ms then a vertical drag washes, its `touchmove`s are prevented, and the puff is thrown.
  - A tap washes one dab.
  - A second finger stops the wipe.
  - Under reduced motion the hold still grabs, with no puff.
- **Add** "the ink canvas holds at most 4 million pixels": a 390×20000 body gets a density under 1.
- **Keep** every other test's meaning, moved to shares. The save, retry, debounce, clean, moment and view tests change
  only in the coordinates they use.

## Task 6: the engine marks what it lifts

Model: inline

Files: `engine/ui/reactions/Reactions.tsx`, `engine/ui/spin/SpunInto.tsx`, `engine/ui/thread/thread.css`,
`engine/ui/tokens.css`, `engine/ui/reactions/Reactions.test.tsx`, `engine/ui/thread/Thread.test.tsx`.

- `data-kb-over-ink` goes on the board's reactions row (`look` not `"glass"`) and on the spun line's `<p>`.
- In `thread.css`, replace `.kb-act-main > .kb-reactions, .kb-act-main > .kb-spun` with
  `.kb-act-main [data-kb-over-ink]`, which sets `position: relative; z-index: 2; width: fit-content; max-width: 100%`.
- Update the comments in `thread.css` (the `.kb-act-main` block) and `tokens.css` (`--kb-board-max`) that describe
  Whoops!'s fixed layout: the board's max no longer sets any layout of Whoops!'s.

Tests first:
- **`Reactions.test.tsx`:** the board's row carries `data-kb-over-ink`, and the glass row does not.
- **`Thread.test.tsx`:** a post's spun line carries it.

The fit-content width is seen in Task 9's e2e, since jsdom has no layout.

## Task 7: the suds

Model: sonnet

Files: `instances/divided-world/cards/whoops/suds.ts` (new), `suds.test.ts` (new); `Effect.tsx` uses it.

- **One particle pool and one animation loop for the page,** made on first use and stopped when it is empty. It is
  capped at 900 particles; past the cap the oldest lather goes first.
- **Each post registers its suds canvas** with its box and density, and unregisters on unmount or when it leaves the
  viewport. Its particles go with it.
- **The particle kinds** are bubble, lather, wet sheen, running drip, pop ring and spray, with the bench's spawn rates,
  lives, motions and sprites:
  - running drips at 2×: chance `2 · travel / 140` over ink, 0.35 of that off it;
  - lather life `2.2 · (0.55 to 1.45)` s;
  - bubbles `travel / 16` per move.
  - The sprites are made once: twelve bubble frames, foam, and drop, and the foam and drop again ink-tinted per ink.
- **The API:**
  - `wash(host, from, to, overInk)` and `puff(host, at)`;
  - `register(host, canvas, box, density)` and `unregister(host)`.
- **A frame that throws never stops the loop:** the next frame is asked for first.
- **Reduced motion** (`motionReduced()`) spawns nothing.

Tests first, in `suds.test.ts`, with a fake `requestAnimationFrame` and a stub canvas:
- A wash over ink spawns bubbles, lather and, over enough travel, drips. Off ink there are fewer drips.
- Under reduced motion nothing is spawned.
- The pool never passes 900, and lather is dropped first.
- The loop stops when the pool and every sheen are empty, and starts again on the next wash.
- A host that unregisters drops its particles, and its canvas is never drawn again.
- A draw that throws once does not stop the loop.

In `Effect.test.tsx`, rewrite "the brush throws soap suds" to observe `suds.wash` being called, and keep "under reduced
motion there are none".

## Task 8: the sponge and the pen

Model: sonnet

Files: `instances/divided-world/cards/whoops/cursor.ts` (new), `cursor.test.ts` (new), `whoops.css`; `Effect.tsx` uses it.

- **One sponge (the bench's SVG), one pen and one drips canvas fixed to the window** for the page, made on first need
  and removed when no host has used them for a while.
- **`cursor.over(host, event, mode)`:**
  - `mode` is `'sponge'`, `'pen'` or `null`.
  - It shows or hides the drawn cursor and sets `cursor: none` on the host only while one is shown.
  - It acts only when `(hover: hover) and (pointer: fine)` matches and `event.pointerType === 'mouse'`.
- **`cursor.press(down)`** squishes the sponge.
- **The drips:** `2 · (0.9 + speed/260 + (pressed ? 1.4 : 0))` a second, falling under 900 px/s² for 0.9s.
- **The pen** is a felt-tip drawn in the layer's ink at the same scale, its tip at the pointer.
- **Reduced motion:** the sponge still shows, but sheds no drips and does not squish.
- **The Effect decides the mode on each pointer move:**
  - `null` inside `[data-kb-over-ink]`;
  - otherwise `'pen'` when the author's tool is ink and any layer is live;
  - otherwise `'sponge'` when `topLayer` has ink under the pointer;
  - otherwise `null`.
  - While a stroke is under way the mode is kept.

Tests first, in `cursor.test.ts`, with `matchMedia` stubbed:
- A mouse over ink shows the sponge and hides the system cursor on the host, and over a lifted element it shows neither.
- A touch or pen pointer never shows it.
- Without a fine pointer it never shows.
- The pen mode shows the pen in the ink's color.
- Leaving the host restores the system cursor.
- Under reduced motion no drop is spawned.

## Task 9: e2e, stories and the boards

Model: sonnet

Files: `e2e/whoops.spec.ts`, `instances/divided-world/ui/whoops/*.board.stories.tsx`, `e2e/boards/01-main.ts`'s comments.

**`e2e/whoops.spec.ts`:**
- **Remove** "the post-body layout is 988px wide and centered on the body at 1440px".
- **Keep** "its words are as wide as an unsplatted post's" at 1440px, and add the same at a 390px viewport: the words'
  computed font size is the board's 15px. That is the point of this design.
- **Add:**
  - At 390px, the ink canvas covers the body's padding box.
  - A sideways drag on the phone viewport (touch, through CDP's `Input.dispatchTouchEvent`) washes.
  - A quick vertical swipe scrolls and washes nothing.
  - A hold then a vertical drag washes and does not scroll.
- **Add** at 1440px: a mouse press on ink to the right of the reactions row's last chip starts a stroke, and the reactions
  row's width is its chips'.
- **Add:** with a mouse over ink, the sponge is visible and the body's cursor is `none`. Over the React button the sponge
  is hidden.
- **Keep** the Stick Around and forced-colors tests, moved to the new geometry.

**Stories.** `Layers.board.stories.tsx` and `Lens.board.stories.tsx` build `PARTLY` from `BRUSH`. Rebuild it in shares
with `aspect`.

**Boards.** `e2e/boards/01-main.ts`'s comment that #41's body "is laid out at the width the post body has at the board's
1200px" is updated: #41 now breaks its lines as any post does. Its manifest already does not compare the splat's pixels.

## Task 10: tidy and the docs

Model: inline

- **Every comment that names the fixed layout:** `grep -rn "REF_WIDTH\|reference width\|fixed layout\|988"` over
  `instances/divided-world` and `engine/ui`. Update each to the body's box, or remove it with the code it described.
- **`PRODUCT.md`:** check that its Whoops! lines still say what is true.
- **The full build:** `npm run typecheck`, then `npm run build:ci`, green.

## Review focus

- **A tall phone post.** The ink canvas, the painted splat cache and the field grid on a 390×20,000 body: memory held,
  time to build, and whether the 4-million-pixel cap holds on every path that sizes a canvas.
- **Touch on iOS Safari,** which the bench was not run on: the non-passive `touchmove` must refuse the scroll once a
  press becomes a wipe, and a quick vertical swipe must never leave a dab.
- **The listeners on the cell.** They are added to an element the engine owns (`.kb-act-main`). They must be removed on
  unmount, on a Stick Around takeover moving the words into its view, and when the post leaves the viewport, and two
  effects on one post must not both take one press.
- **`data-kb-over-ink`.** Any other control the engine draws over a post's ink in future must carry it, or it becomes
  unwipeable or unclickable. The attribute is the only list, so check none is missed today (the Lens host, a mark in the
  body).
- **Saved states from before** (seed data, stories, the SQL test's opaque states in `supabase/tests/0023-cards-screens.sql`).
  They are dropped when read, never crash a post, and nothing still writes the old shape.
- **A busy page.** Twenty splatted posts with one being washed: one particle pool, only near posts holding canvases, and
  no animation loop running once the suds are gone.
- **The washed share differs a little between screens.** The author's clean mark is still decided where the author
  washes, and a reader is never told their post is clean when ink remains on their own screen.
