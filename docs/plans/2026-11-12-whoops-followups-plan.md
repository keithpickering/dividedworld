# Whoops! ink field follow-ups: plan

Record, written 2026-11-12. The plan for `docs/plans/2026-11-12-whoops-followups-design.md`. One build session builds
it in one PR from `main`, which carries the ink field build (PR #532). The bench for the read-through level is
`docs/research/2026-11-12-whoops-followups/01-read-through.html`.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added, so there
is no poison to list; where a test's first red is a missing export, a poison of the finished code shows it bites, and
the PR says which. No migration and no SQL: nothing saved changes shape. One file is the engine's
(`engine/ui/cards/bands.ts`, with its test); every other file is the instance's (`instances/divided-world/`, `e2e/`).
The engine imports nothing from the instance, and the layers check holds that.

No state is added for a player, a character or a post, so there is no new way out to build. No response, payload,
Realtime event or timing sent anywhere is added: which bands a screen holds and how fast it builds are that screen's
own.

Paths below are in `instances/divided-world/cards/whoops/` unless they say otherwise.

## Task 1: the field: a grid's row offset, the dab's fade, the cover level

Model: sonnet

Files: `field.ts`, `field.test.ts`, `paint.ts` (two constants move out).

- **`Grid.row0`** (a whole number, 0 by default): the row of the post's lattice that the grid's row 0 is. A point's
  position down is `oy + (row0 + j) · step`, `oy` being the lattice's own first row's position, so a band's point is
  computed by the same arithmetic as the whole grid's and its values are equal bit for bit. Every place `field.ts`
  reads a row's position (`rectOf`, `discInto`, `beginPen`'s `segment`, `beginWash`'s `press`) goes through one helper,
  `rowY(g, j)`. `rectOf` returns rows in the grid's own numbering.
- **`bandGrid(box, density, row0, rows)`**: `rows` rows of `denseGrid(box, density)`'s lattice starting at `row0`
  (which may be −1 or run one past the end: the caller clips the apron to the lattice). `makeGrid` takes `row0`.
- **The dab's fade** (`beginWash`). The discs pressed are recorded while the path is shorter than `1.5R` (today `R`).
  At `end`, with `length < 1.5R`, the top-up is `max(0, WASH_TAKES − given) · fade`, where `fade` is 1 for
  `length ≤ R` and `(1.5R − length) / (0.5R)` past it. Name the 1.5 `DAB_FADE_ENDS`.
- **`THIN_FLOOR` and `THIN_SPAN`** move from `paint.ts` to `field.ts` (`paint.ts` re-exports them), because the model
  now reads them and must not import the canvas module.
- **`READ_THROUGH = 0.75`** and **`COVER_OVER = THIN_SPAN · (READ_THROUGH − THIN_FLOOR) / (1 − THIN_FLOOR)`**, exported.

Tests first, in `field.test.ts`:
- **Bands equal the whole.** A seeded splat and a mixed list of 40 strokes on a 390×1,400 box at density 1: the whole
  grid, and the same lattice as bands of 512 rows with one row of apron. Every band value equals the whole grid's at
  the same lattice point with `Object.is`, and so does every washed mark. Again at density 0.73.
- **A band far from a stroke visits nothing.** With `grid.work` set, a stroke 2,000px above a band adds 0 visits.
- **A drag never cleans less than a shorter one.** Over a uniform field of 3.0, straight washes of length
  0, 0.5R, R, 1.1R, 1.25R, 1.5R and 2R: the take under the end point is `WASH_TAKES` (±0.02) up to `R`, never rises
  with length, and changes by under 0.1 between neighbors 0.05R apart from `R` to `1.6R`. (Today's code is red on the
  last: about 0.6 at `R`.)
- **`COVER_OVER`** is 0.738 ± 0.001.

## Task 2: the model: lines the eye can read, and the sweep's pace

Model: sonnet

Files: `scrub.ts`, `scrub.test.ts`, `Effect.tsx` (the sweep's call), `Effect.test.tsx` (the sweep's time).

- **`LayerInk.covers(x, y)`**: whether the point's ink hides the words. The point's value is at least `THRESHOLD`, and,
  where a wash has lowered it, at least `THRESHOLD + COVER_OVER`. `valueAt`'s kept answer gains the point's washed mark
  (`replay` already clears and sets `scratch.washed[0]`); a point no line reaches is not washed.
- **`coveredLines`** asks `covers` where it asked `has`. Nothing else changes: `has`, `topLayer`, `washed`, `inkSpan`
  and clean still read ink at `THRESHOLD`.
- **`SWEEP_PX_S = 400`** replaces `SWEEP_SPEED`. `sweepStep` takes the pace as a share of the width a second
  (`speed`, a required argument after `dt`), and `Effect.tsx`'s `startSweep` passes `SWEEP_PX_S / box.w`. The header
  comments that say "a line a little under two seconds" are rewritten to say a hand's pace in px.

Tests first:
- **`scrub.test.ts`, "a line under ink thinned past reading is not covered".** One layer, a text line across the
  core. After washes that leave the line's ink above `THRESHOLD + COVER_OVER` the line is covered; after one more pass
  that leaves it between `THRESHOLD` and `THRESHOLD + COVER_OVER`, it is not covered, while `has` at its middle is
  still true and `washed` has not reached clean.
- **"unwashed thin ink still covers."** A line under a splat's arm whose value is between `THRESHOLD` and
  `THRESHOLD + COVER_OVER`, with no wash: covered.
- **"the sweep crosses 400px a second on any box."** `sweepStep` driven for one second at `SWEEP_PX_S / box.w` moves
  400px (±1) on a 358px box and on a 760px box, wrapping bands as it does today.
- **`Effect.test.tsx`, "held on, it clears a layer in about the time a hand takes".** Measure the sweep's fake time to
  clean on the test's box at the new pace, assert it within 1.25 times that measure and above 10 seconds, and rewrite
  the comments that say 86 seconds. The two-layer test's bounds follow.
- **`Effect.test.tsx`, "a line read through thinned ink is said".** With the sweep held, the polite region speaks a
  line while `data-kb-layers` still says `live` and that line's ink is not yet gone.

## Task 3: the engine's band watcher

Model: sonnet

Files: `engine/ui/cards/bands.ts` (new), `engine/ui/cards/bands.test.tsx` (new).

- **`bandsOf(h, bandPx)`**: the bands of a box `h` CSS px tall, top to bottom: `{ top, h }` each, `bandPx` tall, the
  last one what is left (never empty; a box of no height has no band).
- **`watchBands(host, box, bandPx, margin, onChange)`**: places one empty, absolutely positioned element per band in
  `host` (at `box.left`, `box.top + band.top`, `box.w` by `band.h`; `aria-hidden`, no pointer events, class
  `kb-band`), watches each with `watchInView` (`engine/ui/shine/inView.ts`) at `rootMargin: margin`, and calls
  `onChange(near)` with the sorted indexes of the near bands whenever the set changes, at most once a frame. It
  returns `{ update(box), stop() }`: `update` moves and re-counts the elements for a new box, and `stop` removes them
  and stops watching. Where the browser has no IntersectionObserver every band is near.
- It names no card and reads nothing about a post but its box.

Tests first, in `bands.test.tsx`, with a fake IntersectionObserver:
- `bandsOf(1300, 512)` is three bands, the last 276 tall; `bandsOf(512, 512)` is one; `bandsOf(0, 512)` is none.
- A 20,000px box makes 40 elements on one shared observer; marking elements 3 to 6 intersecting calls `onChange([3, 4,
  5, 6])` once.
- `update` with a shorter box removes the elements past it and reports a near set without them.
- `stop` removes every element and unobserves each.
- With no IntersectionObserver, `onChange` gets every index.

## Task 4: building a band, and the pace

Model: sonnet

Files: `build.ts`, `buildClient.ts`, `buildWorker.ts`, `build.test.ts`, `paint.ts` (`shadeField`), `paint.test.tsx`.

- **`shadeField`** takes the whole lattice's size (`whole: { cols, rows }`) and reads `grid.row0`: the gloss's center,
  its radius and the underside are placed from the whole post, with the pixel's row taken as `row0 + y`. A grid that is
  the whole lattice shades exactly as today.
- **`BuildInput`** gains `band: { row0, rows }` (the band's own rows, without apron). `buildLayer` builds
  `bandGrid` with one apron row each side, clipped to the lattice, runs the splat and the strokes, shades the band's
  own rows, and returns the field and washed marks **with** the apron rows (the page shades live strokes from them)
  and the image without them. The `MAX_CANVAS_PX` refusal becomes a refusal of a band of more than
  `BAND_MOST_PX` (2,000,000) points.
- **`Built.ms`**: the build's own time, read from an injected clock (`performance.now` by default) around the work,
  in the worker and on the page.
- **`estimateWork`** takes the band: the box term is the band's cells, and a stroke's term counts only the part of its
  reach inside the band's rows (a segment wholly outside costs 0). The weights stay.
- **The pace** (`buildClient.ts`): `pace` starts at 1. Each finished build with an estimate of at least 1ms of work
  sets `pace ← clamp(0.8 · pace + 0.2 · (ms · 1e6 / estimate), 0.25, 8)`. A band is built at once on the main thread
  when `estimate · pace < QUICK_MS · 1e6`, `QUICK_MS = 12`. `QUICK_WORK` is removed. `createBuildClient` takes `now`
  among its deps.
- **Keys.** `layerKey` gains the band's `row0` and a requester's token: `buildClient().requester()` returns a fresh
  token, and each Effect holds one. Two Effects with the same play, box and strokes no longer replace or cancel each
  other.

Tests first:
- **`paint.test.tsx`, "bands shade as the whole does".** The whole-post picture of a seeded layer with strokes, and
  the same layer built as bands of 512 at density 1 on a 390×1,400 box: the bands' image bytes, laid together, equal the
  whole's exactly. This is the test that would catch a lost apron row or a gloss placed by the band.
- **`build.test.ts`:** a build reports `ms` from the injected clock; the pace moves toward measured over estimated and
  stays within 0.25 and 8; with the pace at 4 a band estimated at 4ms goes to the worker and with it at 0.5 a band
  estimated at 20ms is built at once; two requesters with identical inputs each hear their own `onDone`, and one's
  `cancel` leaves the other's build out; `estimateWork` for a band no stroke reaches is the band's cells alone.
- The existing calibration test (`BOX_NS = 25` poison) is kept against the band's estimate.

## Task 5: the Effect holds bands

Model: sonnet

Files: `Effect.tsx`, `Effect.test.tsx`, `paint.ts`, `paint.test.tsx`, `whoops.css`.

Read `Effect.tsx`'s sections "the pictures" and "the canvas" first; this task replaces them.

- **Density.** `densityOf` goes. A layer's pictures are at `q = min(1, devicePixelRatio)`, as today, with no cap.
- **Bands.** `BAND_PX = 512`, `BAND_NEAR = '50% 0px'`. While the post is near and built, `watchBands` runs on the
  frame with the body's box, and the Effect keeps the near set. A band's rows are `round(BAND_PX · q)`.
- **Per near band, per layer that is not clean and faded:** one `<canvas>` on the page (class `kb-whoops-ink`,
  `data-kb-band`, `data-kb-layer`, `data-kb-effect-ink`, `aria-hidden`), placed over the band, in play order, and a
  `Pic` as today (grid, late strokes, dirty rectangle) whose canvas is that element. The composed canvas, `paint`,
  `PaintLayer`, `holdStandIns`, the slots, `paintedFor` and `painted` are removed. `paintSplat` stays for
  `ConfigForm.tsx`'s preview.
- **A band leaving the near set** lets its pics go (`dropPic`: the build cancelled, the grid dropped) and its canvases
  unmount. The post leaving lets everything go, as today.
- **The stand-in** (`paintStandIn`, rewritten): onto the band's layer canvas, each ball of the splat as a flat circle
  of radius `r` in the layer's ink (the ball's own center and radius, as `splatInto` places them), then the strokes as
  today, clipped to the band, with the stroke under the pointer and the sweep's open stroke included. It is drawn when
  the pic is asked for and again on each frame a stroke changes it while the build is out.
- **`arrive`** puts the build's image on the band's canvas and keeps the grid with its apron.
- **A live stroke** binds to the model once and to the grid of every held pic of its layer (`bindGrid` per band);
  `lineTo` and `lineEnd` go to each and mark each band's dirty rectangle. A pic that arrives later takes the open
  stroke from its first point, as today.
- **`flushPic`** shades the dirty rectangle from the band's grid (its apron gives the gradient at the band's edge)
  into a scratch sized to the band, and puts the rectangle grown by one point on the canvas.
- **A clean layer's fade** is the opacity of its canvases, set in the paint frame.
- **A save's own echo** is known by the splats' seeds (`was.seeds === layers.map(seed).join()`), where it compared the
  `splats` list itself, so an echo no longer rebuilds the layer. The tests that call `replay()` to force a rebuild are
  changed to change a state.
- **`data-kb-pictures`** counts held pics across bands; **`data-kb-bands`** lists the near bands, for tests.

Tests first, in `Effect.test.tsx` (the fake IntersectionObserver marks bands) and `paint.test.tsx`:
- **"a tall post holds only the bands near the viewport".** A 390×20,000 box with three layers and bands 3 to 6 near:
  canvases exist for those bands only, 12 in all, and the pixels held (canvas backing plus grids, read from a probe
  the Effect exports for tests) are under 12,000,000 bytes a layer.
- **"a band that leaves lets its picture go, and one that returns is built again with the strokes made meanwhile".**
- **"a stroke across a band's edge is drawn in both bands"**, and its pixels match a whole-post build of the same
  strokes at that seam (a poison that drops the apron, or `flushPic`'s one-point margin, turns it red).
- **"the stand-in is flat circles and holds no picture"**: while a build is out the band's canvas has ink where the
  splat's balls are, and nothing calls `paintSplat`.
- **"the sweep's open band shows in the stand-in"**.
- **"a save's echo does not rebuild"**: after a save's answer and its state arrive, no build is asked for and
  `data-kb-pictures` never falls.
- **"two posts with the same play do not cancel each other's builds"** (the requester token).
- The existing picture tests (stand-in then build, late strokes, resize while a build is out, a reader's strokes
  leaving and returning, clean layer let go) are kept, adapted to one band or more.

## Task 6: the suds over the near bands

Model: sonnet

Files: `Effect.tsx`, `suds.ts`, `suds.test.ts`, `Effect.test.tsx`.

- The suds canvas is placed over the span from the first near band's top to the last one's bottom and sized to it, at
  `min(MAX_DPR, devicePixelRatio)` lowered to keep it within `MAX_CANVAS_PX`. `suds.register` takes the span's offset
  in the box (`top`), and draws each particle at its box position less that offset. A change of the near set
  re-registers, as a change of box does, and the module keeps what is in the air.
- Test first: on a 390×20,000 box with bands 3 to 6 near, the suds canvas is 4 bands tall and a wash at a point in
  band 4 draws suds at that point's place on the page; a particle outside the span is not drawn and throws nothing.

## Task 7: e2e, stories, comments

Model: sonnet

Files: `e2e/whoops.spec.ts`, `e2e/hold.spec.ts`, `instances/divided-world/ui/whoops/Layers.board.stories.tsx`,
`instances/divided-world/cards/graffiti/Effect.test.tsx` where it drives the Whoops! layer, and the header comments of
every file the tasks above changed.

- **e2e helpers.** `inked` and `solidInk` read every `#post-41 canvas.kb-whoops-ink` and sum them, mapping a point to
  its band. The tests' meanings do not change.
- **A tall story.** `Layers.board.stories.tsx` gains a post about 12,000px tall with three layers.
- **e2e, "a tall post scrubs at its far end".** On the tall story: at load, no ink canvas exists below the third band;
  after scrolling to the bottom, the top bands' canvases are gone and the bottom ones exist; a scrub there lowers the
  summed alpha; the page's ink canvases never number more than 3 layers × 6 bands.
- **e2e, "Hold to scrub".** The pass counter is not touched (#549 keeps it); its time bound follows the new pace.
- **Comments.** The headers of `Effect.tsx`, `paint.ts`, `build.ts`, `buildClient.ts`, `scrub.ts` and `field.ts` say
  what the code now does, and name this design beside the ink field design. No word a player reads changes; the PR
  lists the copy it checked.
- **Issues.** The PR closes #548, checks off the seven items of #549 it took (design section 6) and leaves #549 open.

## Review focus

- **Seams.** A band's pixels at its first and last rows against the whole-post picture, under a live stroke as well as
  a build: the apron, `row0`, and the gloss placed by the whole post.
- **A band's build replays every stroke of its layer.** At 40,000 points and five bands near, what one scroll past a
  heavily drawn tall post costs the worker, and whether a queue of bands starves the band in view.
- **Bands coming and going mid-stroke.** A stroke open while its band leaves and returns, or while a band it crosses
  first arrives: nothing applied twice, nothing lost (#532's root cause was a stroke counted twice).
- **Memory on a real phone.** The probe counts typed arrays and canvas px; whether canvases that unmount are freed
  promptly on iOS, or need their width set to 0 first.
- **The pace.** A first build on a cold page, or one janky frame, moving the pace so that later bands block the main
  thread or never use the light path.
- **Read-through.** Lines released at `COVER_OVER` on real text: a line said to a screen reader while a sighted reader
  cannot yet read it, on the dark board and at 200% text size.
- **The sweep on a wide post and a narrow one.** 400px/s against the suds and the paint frame, and the keyboard path's
  time on a phone-width box.
- **The engine's band elements.** One element per 512px of every splatted post on a long thread page, and whether
  `watchBands` could be told a private fact (it is given a box and nothing else).
