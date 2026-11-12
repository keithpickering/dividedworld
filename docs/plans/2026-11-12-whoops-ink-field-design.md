# Whoops! ink in the field: design

Record, written 2026-11-12. A design session with the owner. The author's "Write in ink" pen was a flat line drawn over
the painted splat, and a wash was a mask cut out of it. In this design both are operations on the splat's own field of
balls (`docs/plans/2026-11-06-whoops-refinements-design.md`, section 2), applied in the order they were made and shaded
once. Pen ink then melts into the splat like one of its own arms, and a wash takes ink away the way scrubbing does, a
little each pass. The prototype the owner chose from is `docs/research/2026-11-12-whoops-ink-field/01-bench.html`; its
defaults are the owner's choices. The plan is `docs/plans/2026-11-12-whoops-ink-field-plan.md`.

## 0. Where it starts

- **Painting** (`instances/divided-world/cards/whoops/paint.ts`). `paintSplat` shades the splat's field as wet ink and the
  Effect caches it per layer and box. `paint` then draws each stroke over that picture, in order: a wash with
  `destination-out` and a 2.5px blur, a pen stroke as a flat `strokeStyle` line in the layer's ink.
- **The model** (`scrub.ts`, `LayerInk`). A grid of cells 12.5px apart says whether each still has ink: the splat's
  outline, then each stroke in order, a wash clearing the cells it reaches and a pen setting them. `has(x, y)` asks the
  last segment that reaches a point. It decides which layer a stroke scrubs, the washed share, clean, and the lines under
  ink.
- **The pen** is 9px (`PEN_PX`), the wash's brush 30px (`BRUSH_PX`).
- **What is saved** (`whoops.ts`, `validateState`). Each stroke's points are a JSON array of pairs to a ten-thousandth,
  at most 12,000 points in all, about 16 bytes a point. The bound the state must fit is `effect_state`'s 256 KiB
  (`supabase/migrations/0026_whoops_legacy.sql`). Only the post's author's strokes are saved; a reader's stay on their
  own screen.

## 1. The pen adds to the field

A pen stroke adds a field around its path: `amp · (1 − d²/R²)³` within `R`, where `d` is the distance to the path, measured
in the space where the stroke's brush is round (the stroke's `aspect`, as today). With `R = 2r` and `amp = 1`, a lone stroke's
edge lies exactly at its radius `r`, as a lone ball's does. So:
- **A line on its own** is exactly as wide as the pen.
- **A line that meets the splat or another line** adds to the field there, and the join is rounded the way the splat's
  beads join its core.
- **Within one line the segments take the most, not the sum**, so a line does not bulge at its own points.
- **Over unwashed ink of the same color the pen melts in** and is not seen, as the same ink would be. The owner chose this
  over a raised ridge that would catch the light.
- **The pen is 16px.** The owner chose it on the bench, over 9px.

**The end of a line** gets a bulb: a ball of `1.35r` at its last point, when the line is at least `4r` long. A line lifted
fast throws 1 to 3 droplets past its end, along its last direction, as the splat's arms do. How many is decided when the
pen lifts, from how fast it was moving, and saved with the stroke (`drops`, section 4). Where the drops land is seeded
from the stroke's saved points, so every reader on every visit sees the same ones.

**A long line saved in pieces is one line.** `fitStroke` cuts a drag into strokes of at most 500 points. A piece after
the first is saved with `continues: true`. The pieces of a line share one "most, not the sum" scope, so nothing bulges
at a cut, and only the last piece gets the bulb and the drops.

- **Alternative weighed: keep the flat line** (rejected). It stops square at the splat's edge and has no meniscus, so it
  reads as a marker on top of the ink.
- **Alternative weighed: field only where the pen meets the splat's edge** (rejected). It saves little: the cost is the
  first build, not the drawing.
- **Alternative weighed: a raised ridge over ink** (rejected by the owner). The bench showed it.

## 2. The wash takes some ink each pass

A wash takes ink by how far the brush travels, as a sponge does. Along its path it presses a disc every third of its
radius. Each disc takes a share of `WASH_TAKES` (1.5), falling off as a ball's field does (`(1 − d²/R²)³` within
`R = 2r`), so that one straight pass takes `WASH_TAKES` under its center however densely the points were kept. Each pass
back over a spot takes as much again, and the field never goes below zero.

What this does to play, on the bench's splats:
- **A thin arm** (field about 0.7) clears in one pass.
- **The core** (field about 2.3 at the median, 4.4 at the 90th percentile, up to about 8.5) takes two to six passes.
- **Thinned ink turns see-through** as it goes, so a reader sees that a pass did something before a hole opens. Where a
  wash has touched, the ink's opacity is `min(1, 0.35 + 0.65 · (v − T) / 1.2)`, `v` being the field and `T` the threshold.
  Ink no wash has touched is drawn as today.
- **A washed hole's edge gets the wet rim** that the splat's own edge has, because it is an edge of the same field.

The owner chose this because cleaning had been too easy. It is more physical than a smaller sponge. With the field pen it
also lets an author draw fine-edged shapes into the splat.

- **Alternative weighed: all of it in one pass** (the bench's other setting, today's rule). The wash caps the field at
  `T · exp((d − r) / 4px)`, so its edge is exactly the brush's. Rejected by the owner.
- **Alternative weighed: a smaller sponge** (the owner's earlier idea). It makes cleaning slower without making it feel
  more like scrubbing.

**The accessible sweep** ("Hold to scrub") takes the same ink per pass as a hand: it washes with the same field
operation. Its loop already goes round to the first band after the last, and stops only when no band has ink
(`sweepStep`), so it makes as many passes as the ink needs. It takes about as long as a hand scrubbing at its pace, as
CLAUDE.md asks ("An accessible path costs what the obstacle costs").

**`WASH_TAKES` and the thinning curve are the bench's numbers.** They are the owner's to tune once the build runs on a
real post; the plan keeps each one a named constant.

## 3. One model for drawing and for counting

`LayerInk` stops being a separate on/off model. It runs the same field operations as the painter, at the points it asks
about:
- **The cells** (12.5px apart, as today) hold the field's value at their centers. A cell has ink while its value is at
  least the threshold. The washed share and clean read the cells, as today: a layer's counted cells are those the splat
  or a pen ever inked.
- **`has(x, y)`** works out the field at that one point by replaying, in order, only the operations that reach it (the
  bucket index `LayerInk` already keeps). So the layer a stroke scrubs, the lines under ink and the sweep's spans agree
  with what is drawn, the pen's bulbs and drops included.
- **Thinned ink still counts as ink** until it is below the threshold. A line under see-through ink is still under ink.

The painter and the model share one implementation of the operations, in a pure module (`field.ts`). A test holds them
together: the painter's grid read at a cell's center equals the model's cell, within the grid's rounding.

## 4. What is saved

The strokes are a state row (`effect_state`) that each save replaces; no Act is edited ("Append-only").

- **The points are packed.** A stroke's `points` becomes a base64url string: the first point as two unsigned 16-bit
  integers (ten-thousandths of the box), then each next point as two signed 16-bit differences, little-endian. That is 4
  bytes a point, about 5.3 characters, against about 16 today.
- **Each stroke is simplified when it is saved.** `fitStroke` drops the points that lie within a quarter of the brush's
  radius of the line through their neighbors (Ramer–Douglas–Peucker, measured in the drawer's px), keeping the first and
  the last. Smooth and straight runs shrink a lot; a dense scribble shrinks little. The author's own screen keeps what
  it drew until it next builds the layer, and the difference is under a quarter of a brush.
- **`continues: true`** marks a piece of a line after the first (section 1).
- **`drops`** (0 to 3) on a pen stroke: how many droplets its end throws. Read from the pointer's speed over its last
  50ms as it lifted: `min(3, floor(speed / 900 px/s))`, a bench number the owner may tune.
- **The limit rises from 12,000 points to 40,000** in all, within the same 256 KiB. The plan's test writes the largest
  state the card accepts and checks it fits with room to spare, and lowers the limit if it does not.
- **States saved in the old shape are dropped when read,** as the refinements design did with its own change: no
  instance is deployed and there are no players (CLAUDE.md, "Nobody is waiting on a hotfix"; the Merging bullet still
  says no instance is deployed). The card refuses the old shape on save.

**Filled shapes are not in this design.** The owner raised it: a dense scribble that fills an enclosed area could be kept
as its outline. It is a separate concern (a new saved shape and a step that decides what is solid) and is filed as an
issue of its own, to design when a drawing first needs it.

## 5. Building a layer, and what shows meanwhile

A layer's picture is now its splat and every stroke on it, shaded once. Measured on the bench, the heaviest post the card
allows (12,000 points, before this design raised the limit) took about 190ms of pen or 580ms of wash to build on a desktop,
and about 0.55s or 2.1s on a phone-speed CPU. Live drawing costs about 0.1ms a step, because only the strip around the
new segment is shaded again.

So:
- **A light layer is built on the main thread** when it is first needed, before its first frame. Light means an estimated
  work under `QUICK_WORK` pixel visits, a constant the plan names and the bench tunes (about 10 to 20ms).
- **A heavy layer is built in a worker.** Until the worker answers, the layer is drawn the old way: the cached splat, the
  pen strokes as flat lines, each wash as a partial cut (`destination-out` at `STAND_IN_WASH`, 0.5), so thick ink scrubbed
  once looks thinned rather than gone. When the build arrives, the picture is replaced. The owner chose this
  progressive enhancement over showing the splat alone or nothing.
- **A stroke made while its layer is still building** is drawn the old way too, and queued; it is applied to the grid
  when the grid arrives.
- **One worker serves the page**, as the foil worker does (`engine/ui/shine/foilClient.ts`). A layer's newer build
  replaces its waiting one, and a build for a post that has left the viewport is dropped. Where a worker cannot start,
  the build runs on the main thread in the next frame, with the stand-in shown for that frame.

The grids are kept while the post is near, as the painted canvas is, and let go with it:
- **The field** as a `Uint16Array` (the value times 4096, held to at most 16). Half of a `Float32Array`'s memory; the
  rounding (about 0.0001) is far under what the shading can show.
- **Where a wash has touched**, as a `Uint8Array`, for the thinning.

## 6. The rules

- **Masks (CLAUDE.md, "A response never proves a private fact").** No response, payload, Realtime event or timing is
  added. The saved state gains `continues` and `drops`, which come from the author's own drawing. A layer's build time
  grows with its strokes, which are public play.
- **Ways out.** No new state is added for a character or a post. A splat ends as it does today: washed clean on the
  reader's screen, by the author for everyone, or by an admin's "End this card". The quick vertical swipe is still the
  reader's way past ink that fills a phone screen. Cleaning takes longer and is never impossible: every pass takes ink,
  and clean is reached at the instance's share (`whoops.clean`, 95).
- **The fiction and the log.** Nothing in the log or the Lens's words changes. The card's rules text ("a reader can scrub
  the ink away on their own screen; the post's author can wash it away for everyone") stays true.
- **Accessibility.** The sweep takes the same ink per pass as a hand and makes as many passes as the ink needs (section
  2). Reduced motion changes nothing here: nothing added moves on its own.
- **The layers (CLAUDE.md, "KayfaBB never knows which instance it runs").** Everything is the instance's, in
  `instances/divided-world/cards/whoops/` and `instances/divided-world/cards/whoops.ts`. The engine is not touched;
  the worker follows the foil worker's pattern without importing it.
- **A busy instance.** The cost grows with a post's strokes and box, never with players or Acts. Only near posts hold
  grids, and only the post being drawn on does work per frame.
- **Graffiti** shares the touch rules (`instances/divided-world/cards/wiping.ts`), not the ink. Its wall's washing is
  unchanged. Making its wash take a little each pass would be a design of its own.
- **American English** for every word a player reads.

## 7. Open

- **`WASH_TAKES`, the thinning curve, the drops' speed and `QUICK_WORK`** are bench numbers, for the owner to tune on a
  real post.
- **Filled shapes** for dense scribbles (section 4): an issue of its own.
- **Graffiti's wash** taking a little each pass (section 6): not proposed.
