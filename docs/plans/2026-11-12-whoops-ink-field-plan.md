# Whoops! ink in the field: plan

Record, written 2026-11-12. The plan for `docs/plans/2026-11-12-whoops-ink-field-design.md`. One build session builds it
in one PR from `main`. The look is the ink field bench (`docs/research/2026-11-12-whoops-ink-field/01-bench.html`) with
the owner's choices as its defaults: the field pen, "Melts in", a 16px pen, joins as the splat's beads, a bulb and
flicked drops, and "Some of it each pass". Its numbers are the defaults unless this plan names others. Where the bench
and the design disagree, the design wins on what is decided and the bench on how it looks. The bench's other settings
(the one-pass cap, a dry cut, a raised ridge, the field at 2 per CSS px) are not built.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. No migration
and no SQL: `effect_state` keeps its 256 KiB bound, and the database never reads a stroke's shape. Every file is the
instance's (`instances/divided-world/`, `e2e/`); the engine is not touched.

## Task 1: the field operations, pure

Model: sonnet

Files: `instances/divided-world/cards/whoops/field.ts` (new), `field.test.ts` (new). No DOM and no canvas.

- **The operations** run over a set of sample points laid out as a grid: `cols × rows` points, `step` CSS px apart, the
  first at `(step / 2, step / 2)` in the box, values in a typed array. The painter's grid is one (step `1 / density`),
  `LayerInk`'s cells another (step `CELL_PX`), and a single point a third (one point at its own position). One
  implementation serves all three, so they cannot disagree.
- **`splatInto(grid, splat, box)`**: the splat's field at every point, as `fieldGrid` (`splat.ts`) computes it.
- **A pen line** (`penLine`): a line's pieces (strokes joined by `continues`) in one scope. Each segment adds
  `(1 − d²/R²)³` within `R = 2r`, `d` measured after scaling down by the brush's down-to-across ratio, as `paint.ts`'s
  `trace` does. Within the scope a point takes the most any segment gives it, not the sum (the bench's `smax`). The
  scope is a sparse map of the points it touched, cleared when the line ends. It returns the rectangle it touched.
- **The ends** (`endsOf(line, box)`): the bench's `endsOf`, with two changes. The drop count is the stroke's saved `drops`,
  not the last step's length. The seed is an FNV-1a hash of the saved points' integers (ten-thousandths) in order. A
  bulb of `1.35r` at the last point when the line is at least `4r` long. Each drop at `r · (2.6 + 2.2j + 2u)` past the
  end, within ±0.25 rad of the last direction, radius `r · (0.35 + 0.35u)`. Each ball is added as a splat ball is.
- **A wash** (`washLine`): the bench's `washTake`. A disc every `h = max(1, r / 3)` px along the path, the leftover
  distance carried across segments and across `continues` pieces. Each disc takes `w · (1 − d²/R²)³` within `R = 2r`,
  where `w = WASH_TAKES · h / ((32 / 35) · R)`, and no value goes below zero. A line of one point is a dab: one disc of
  `w`, topped up by `WASH_TAKES − w` when it ends. Every point it lowers is marked washed.
- **Constants**, exported and named: `WASH_TAKES = 1.5`, `END_BULB = 1.35`, `DROPS_MOST = 3`, `FIELD_MOST = 16`.
- **`fieldAtPoint(splat, box, strokes, x, y)`**: the field at one point, by the same operations over a one-point grid,
  with every stroke that reaches the point replayed in order.

Tests first, in `field.test.ts`:
- **A lone line's edge is its radius.** A straight 16px pen line on an empty box: the field is at least `THRESHOLD` at
  `r − 0.5` px from its path and below it at `r + 0.5`, on a 988×330 box and a 390×1200 box (with the stroke's `aspect`
  from the first, so the brush is an ellipse on the second).
- **No bulge at its own points.** Along a polyline of 30 points at 5px, the field on its center line varies by under 2%.
- **A join is rounded.** Where a line meets the splat's edge, the field at the meeting point is above both alone.
- **One line in pieces is one line.** A 1,200-point line cut by `fitStroke` gives the same field (within 1e-6) as the
  same points as one stroke, and gets one bulb.
- **Ends from saved data.** The same stroke gives the same balls twice. A stroke with `drops: 0` gets the bulb alone; a
  line shorter than `4r` gets none. Moving one saved point moves the drops; the drop count does not change.
- **One pass takes `WASH_TAKES`.** A straight wash across a uniform field of 3.0 lowers its center line to 1.5 ± 0.05,
  whether its points are 5px or 25px apart.
- **Passes add.** Three passes over a thin arm's value (0.7) and the core's (3.0): the arm is at 0 after one, the core
  above zero after one and at 0 after two passes at 1.5 each.
- **A dab is one pass.** A one-point wash lowers its center by `WASH_TAKES`.
- **Never below zero**, and every point lowered is marked washed.
- **Order matters.** Pen, then wash: the wash takes the pen's ink. Wash, then pen: the pen's line is whole.
- **The point agrees with the grid.** For a seeded splat and a mixed list of 40 strokes, `fieldAtPoint` at 200 random
  points equals the dense grid's value at the same points (grid at density 1, points on grid centers) within 1e-4.
- **Cost.** 12,000 points of 30px wash on a 754×438 box build in under 1.5s in Node, and 12,000 points of 16px pen in
  under 600ms (a guard against a loop over the whole box per segment; the bench measured about 0.6s and 0.2s in Chromium).

## Task 2: what the card keeps of a stroke

Model: sonnet

Files: `instances/divided-world/cards/whoops/points.ts` (new), `points.test.ts` (new),
`instances/divided-world/cards/whoops.ts`, `instances/divided-world/cards/cards.test.ts`,
`instances/divided-world/cards/whoops/scrub.ts` (`Stroke`, `fitStroke`, `fits`), `scrub.test.ts`, `Effect.tsx` (`savedOf`).

- **`points.ts`**: `encodePoints(points: Pt[]): string` and `decodePoints(s: string): Pt[] | null`. The first point as
  two unsigned 16-bit integers in ten-thousandths, then each next point's difference as two signed 16-bit integers,
  little-endian, all base64url with no padding. `decodePoints` returns null for a string that is not base64url, whose
  length is not a whole number of points, or whose points leave 0 to 10,000.
- **The saved stroke** (in `whoops.ts` and `scrub.ts`):

  ```ts
  type SavedStroke =
    | { tool: 'wash'; width: number; aspect: number; points: string; continues?: true }
    | { tool: 'ink'; color: string; width: number; aspect: number; points: string; continues?: true; drops?: 0 | 1 | 2 | 3 };
  ```

  In memory a `Stroke` keeps decoded points (`Pt[]`) and the same `continues` and `drops`.
- **`STROKES`** becomes `{ most: 200, points: 500, totalPoints: 40_000, widest: 1, deepest: 1 }`.
- **`validateState`** decodes each stroke's points and refuses: a `points` that is not a string or does not decode
  ("a stroke's points are packed as the card writes them"), more than 500 points in one stroke or 40,000 in all, a
  `continues` that is not `true`, a `continues` on the first stroke or on a stroke whose tool, width or aspect differs
  from the one before it or whose first point is not that stroke's last ("a continued stroke starts where the last
  ended"), and a `drops` that is not a whole number 0 to 3 or is on a wash. An old-shape stroke (points as an array) is
  refused by the first rule. It normalizes as today and writes the points back encoded.
- **`fitStroke`** simplifies before it cuts: Ramer–Douglas–Peucker over the points in the drawer's px (`x · w`,
  `y · w / aspect`, with `w` any positive width, since the tolerance is a share of it), tolerance `width · w / 8` (a
  quarter of the radius), keeping the first and last points. Then the `MIN_STEP_PX` thinning and the 500-point cut, as
  today. Each piece after the first gets `continues: true`, and only the last keeps `drops`.
- **`savedOf`** (`Effect.tsx`) decodes and drops what does not decode, as it drops a malformed stroke today.

Tests first:
- **`points.test.ts`**: a round trip of 500 random points to a ten-thousandth; a one-point stroke; a jump from 0 to
  10,000 and back; null for a bad character, a length off by one byte, and a difference that leaves the box.
- **The largest save fits** (`cards.test.ts`, where today's test of the largest save lives): 200 strokes and 40,000
  points, every stroke an ink stroke with a seven-character color, `continues`, `drops: 3`, the widest width and an
  aspect of three figures, every point's difference the largest. Written as `JSON.stringify` and as Postgres writes jsonb
  (a space after each `:` and `,`), it stays under 262,144 bytes with 5% to spare. If it does not, lower `totalPoints`
  to the largest thousand that fits and say so in the PR.
- **Refusals**: each of the refusals above, with its words; and an old-shape state is refused.
- **Simplification** (`scrub.test.ts`): 200 points along a straight line become 2; a circle of 400 points keeps its
  shape within a quarter of the radius at every original point; the first and last points are kept; a dab stays a dab.
- **Pieces**: a 1,200-point stroke becomes pieces whose first points are the last ones before them, every piece after the
  first `continues`, `drops` on the last alone.

## Task 3: the layer's model reads the field

Model: sonnet

Files: `instances/divided-world/cards/whoops/scrub.ts` (`LayerInk`), `scrub.test.ts`.

- **`LayerInk`** keeps its constructor (`splat, strokes, box`) and what the Effect reads: `has`, `washed`, `inkSpan`,
  `inkNear`, and `topLayer` and `coveredLines` beside it. Inside, it holds a cell grid of the field (Task 1, step
  `CELL_PX`) instead of `alive`. A cell has ink while its value is at least `THRESHOLD`. `counted` is a cell the splat or a
  pen ever brought to the threshold.
- **`has(x, y)`** replays at the point only the strokes whose reach touches its bucket (the buckets `LayerInk` keeps
  today, now filed by stroke and in order), over the splat's field at that point (memoized as today).
- **Live strokes**: `wash(points, width, aspect)` and `pen(points, width, aspect)` give way to `begin(stroke)`, which
  returns `{ to(p: Pt): void; end(drops?: number): void }`. `to` applies the segment from the last point; `end` closes the
  pen's scope, adds its ends, or tops up a dab. The constructor builds through the same calls.
- **`PEN_PX`** becomes 16.

Tests first, in `scrub.test.ts` (the old mask tests that no longer hold are replaced, and the PR lists them):
- **The model and the painter agree.** For a seeded splat and 40 strokes, every cell's ink equals `fieldAtPoint(...) >=
  THRESHOLD` at its center.
- **A thin arm clears in one pass**, and the core's center does not: one pass of the 30px brush across the core leaves
  the cell at its center inked, and three passes clear it.
- **`washed` grows with each pass** over the core, strictly, until it is clean.
- **The pen's ends count.** A pen line's bulb makes `has` true at its center, past the line's end.
- **`has` after a dab** is false at the dab's center over an arm and true over the core.
- **The sweep makes as many passes as the ink needs.** Driving `sweepStep` with the model's `inkSpan` and the sweep's
  brush over a seeded splat, the sweep is idle only once `washed` reaches the clean share, and it passes some band more
  than once on the way.
- **The sweep's pace is a hand's.** Over a band of the core, one sweep pass takes `WASH_TAKES` under its center, as a hand
  pass does.

## Task 4: shading the field

Model: sonnet

Files: `instances/divided-world/cards/whoops/paint.ts`, `paint.test.tsx`, `ConfigForm.tsx` if its call changes.

- **`shadeField(grid, washed, color, density, rect, out: ImageData)`**: `paintSplat`'s shading over a rectangle of the
  grid, with the gloss and the underside computed in the same loop (the bench's `shadeRect`, which matches `paintSplat`'s
  `source-atop` pass), and the thinning on washed points: opacity times `min(1, 0.35 + 0.65 · (v − T) / 1.2)`. Constants
  `THIN_FLOOR = 0.35` and `THIN_SPAN = 1.2`, named. The rectangle grows by one point each way for the gradient.
- **`paintSplat`** stays for `ConfigForm.tsx`: the splat's grid alone, through `shadeField`.
- **`paint`** composes each layer's picture as it is given, bottom to top, at its alpha. It no longer draws strokes.
- **`paintStandIn`**: today's `paint` for one layer (the cached splat, pen strokes flat in the layer's ink, each wash with
  `destination-out` at `STAND_IN_WASH = 0.5` and the 2.5px blur), for a layer whose build has not arrived (Task 5).

Tests first, in `paint.test.tsx` (its canvas stand-in as today):
- **The splat alone looks as it did.** `shadeField` over the splat's grid writes the same pixels as the old
  `paintSplat` within 1 per channel, at a few hundred sampled pixels (take the old function's output as a fixture in the
  red run, before it is replaced).
- **Thinned ink is see-through.** A washed point at `v = T + 0.2` has opacity under 0.5 of an unwashed point's at the
  same `v`.
- **A rectangle's shading equals the whole's.** Shading a rectangle after an operation equals shading the whole grid,
  inside the rectangle.
- **The stand-in** draws a pen stroke and a wash in order, with the wash's `globalAlpha` at `STAND_IN_WASH`.

## Task 5: building a layer off the main thread

Model: sonnet

Files: `instances/divided-world/cards/whoops/build.ts` (new: `buildLayer`, pure, no DOM),
`buildWorker.ts` (new), `buildClient.ts` (new), `build.test.ts` (new).

- **`buildLayer({ seed, color, box, density, strokes })`** returns `{ field: Uint16Array, washed: Uint8Array, image:
  ImageData-shaped { width, height, data } }`: the splat, every stroke in order (Task 1), shaded (Task 4). The field is
  the value times 4096, held to `FIELD_MOST`.
- **`estimateWork(box, density, strokes)`**: the box's points plus each segment's reach area, in point visits.
  `QUICK_WORK = 2_000_000`, named; a layer under it is built on the main thread.
- **`buildClient.ts`** follows the foil worker's pattern (`engine/ui/shine/foilClient.ts`), without importing it: one
  worker for the page, started with the first heavy build and ended a while after the last; one build in flight per
  layer key (`play id | box | density | strokes' count and last point`), a newer one replacing the waiting one; a build
  for a key no longer wanted is dropped on arrival. The buffers come back transferred. Where `Worker` is missing or fails
  to start, the build runs on the main thread in the next frame.

Tests first, in `build.test.ts`:
- **The worker's build is the main thread's.** `buildLayer` called directly and through the client (with a fake worker
  that runs it on a message) give equal arrays.
- **Latest wins.** Two builds for one layer while one is in flight: the second replaces the first, and the first's answer
  is dropped.
- **A post that left** has its waiting build dropped and its answer ignored.
- **The light path** is taken under `QUICK_WORK` and the worker under none.
- **Rounding.** The `Uint16Array` field read back is within 1/8192 of the float one.

## Task 6: the Effect draws from the field

Model: sonnet

Files: `instances/divided-world/cards/whoops/Effect.tsx`, `Effect.test.tsx`, `cursor.ts` if the pen's tip needs moving.

- **A layer's picture** is its build (Task 5), cached by the layer key while the post is near and let go with it, with the
  grids kept beside it. Until it arrives the layer is drawn by `paintStandIn`.
- **A live stroke** goes to the layer's `LayerInk` (`begin`/`to`/`end`) and, when the grid is there, to the grid by the
  same operation, shading again only the rectangle it touched (`shadeField`) and putting that rectangle on the layer's
  canvas. Without the grid, the stroke is queued and applied when it arrives.
- **The pen's drops**: at lift, the pointer's speed over its last 50ms (from the events' timestamps),
  `drops = min(3, floor(speed / DROPS_SPEED))`, `DROPS_SPEED = 900` px/s, named. A tap or a touch that ends still
  counts its speed the same way.
- **Kept strokes** go through `fitStroke` (simplified, cut, `continues`, `drops`) as today, and are saved encoded.
- **`paintNow`** composes the layers' pictures (`paint`), each the build or the stand-in.

Tests first, in `Effect.test.tsx`:
- **A stroke reaches the picture.** A pen stroke on a light layer changes the canvas inside its rectangle and nowhere
  else.
- **The stand-in, then the build.** With the build held back, the layer is drawn by the stand-in; when it is released,
  by the build; a stroke made between is in both.
- **Drops from speed.** A fast lift saves `drops` above 0, a slow one 0.
- **What is saved** is encoded, simplified and within `fits`.
- **A post that leaves** lets its grids go (the cache is empty) and builds again when it returns.

## Task 7: the bench's look in the running game, and tidy

Model: sonnet

Files: `e2e/whoops.spec.ts`, `instances/divided-world/ui/whoops/Layers.board.stories.tsx`, the card's comments.

- **e2e**: an author writes a line out of the splat's edge, and the line's end has a bulb past the line's width (read
  from the canvas's alpha); a reader scrubs the core once and it is see-through and not gone, then three times and it is
  gone; "Hold to scrub" clears a splat and passes some line more than once.
- **Stories**: a layer with pen lines and scrubbed holes, for the board.
- **Comments.** The header comments of `scrub.ts`, `paint.ts`, `Effect.tsx` and `splat.ts` say what is now true: the
  model is the field, a wash takes some each pass, a stroke's points are packed. Each names this design.
- **Copy.** Every word a player reads about Whoops! is checked to stay true (the card's text in
  `instances/divided-world/ui/cards.ts`, the Lens's words). The design found none that needs to change; the PR says so or
  lists what did.
- **File an issue** for filled shapes (design section 4), linking the design.

## Review focus

- **A tall phone post.** On a 390×20,000 body, with three layers: the grids' memory (`Uint16Array` and `Uint8Array` per
  layer beside the canvas), the time to build in the worker, and that the stand-in shows at once.
- **The worker's lifetime.** Builds for posts that left are dropped, no buffer is used after it was transferred, and the
  worker ends when no post needs it.
- **A stroke made while its layer builds** is applied once, to the grid that arrives, never twice and never lost.
- **The model and the picture.** Any path that changes one without the other (a resize, a reader's strokes on a post that
  left and came back, a save's echo) leaves the washed share and the drawing disagreeing.
- **Points from before** (seed data, stories, the SQL tests' opaque states) are dropped when read and never crash a post,
  and nothing still writes the array shape.
- **Simplification on the author's screen**: what the author sees after a reload differs from what they drew by under a
  quarter of a brush, and no stroke's pieces lose their `continues`.
- **Cleaning time.** Washing a whole splat clean by hand, and by "Hold to scrub", on a phone-sized post: about how long
  each takes, for the owner to judge `WASH_TAKES` against.
