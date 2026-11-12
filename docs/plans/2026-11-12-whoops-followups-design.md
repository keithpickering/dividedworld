# Whoops! ink field follow-ups: design

Record, written 2026-11-12. A design session with the owner, on the five questions the ink field build left for the
owner (#548) and the review findings of that build (#549; the build is PR #532, its design
`docs/plans/2026-11-12-whoops-ink-field-design.md`). Each section says what was decided, what else was weighed, and why.
The plan is `docs/plans/2026-11-12-whoops-followups-plan.md`. The bench the owner chose the read-through level from is
`docs/research/2026-11-12-whoops-followups/01-read-through.html`.

## 0. Where it starts

- **A post near the viewport holds everything for its whole body.** `Effect.tsx` watches its frame with an
  IntersectionObserver (`rootMargin: '100% 0px'`): a post more than a screen away holds no canvas and no grid. A post
  that is near holds, for its whole box: the ink canvas and the suds canvas at the screen's density, and for each layer a
  picture canvas, a Float32 field with its washed marks, and the stand-in's painted splat. The page also holds up to
  three stand-in slot canvases and a shading scratch.
- **The box is capped by lowering its density.** `densityOf` and `paintSplat` hold a canvas to `MAX_CANVAS_PX` (4M px)
  by drawing a tall post at a lower density (0.71 for 390×20,000), so a tall post is softer than a short one.
- **The count.** The final review of #532 counted about 250MB for three layers on one post at the cap, about 176MB of
  it canvas backing. iOS fails silently at sizes like that.
- **The owner's starting guess** (2026-11-12): "Generally occlusion culling with IntersectionObserver is a good answer
  for this kind of thing but that's a guess." The build already culls by post. What is left is one tall post, which
  is near as a whole while a screen of it shows.

## 1. Memory: a post's pictures are held in bands

**Decided.** A post's pictures are cut into horizontal bands, and only the bands near the viewport hold anything.
- **Bands.** The body's box is cut into bands `BAND_PX` (512) tall, the last one shorter. A band is near while it lies
  within half a screen of the viewport (`rootMargin: '50% 0px'`). On a phone that is at most about five bands at once,
  however tall the post is.
- **What a near band holds.** For each layer that still has ink: one canvas, which is on the page, and one field grid
  with its washed marks. The layers are stacked canvases, one over another in play order, and the browser composites
  them. A layer fading after it is washed clean fades by its canvases' opacity.
- **What goes.** The composed ink canvas, the stand-in's slot canvases, the painted splat kept per layer, and the
  whole-post shading scratch (a band's scratch is at most a band). `MAX_CANVAS_PX` no longer bounds the ink: nothing is
  sized to the post, so a tall post is drawn at the density a short one is.
- **One lattice.** Every band's grid is a run of rows of the post's one lattice of points (the points
  `denseGrid(box, q)` would have), with one row of apron above and below for the shading's gradient. The field
  operations take the whole box, as today, so a point's value does not depend on which band holds it. A grid gains a
  row offset (`row0`), and a point's position is computed from its row in the whole lattice, so a band's values are the
  whole grid's, bit for bit. The gloss and the darker underside are placed by the whole post's size. A test holds this:
  the bands' pixels, laid together, equal a whole-post build's, byte for byte.
- **Each band is built on its own**, in the worker or on the page (section 2), from the layer's splat and every stroke
  in order. A stroke far from the band costs its points and no grid visits. A band that comes near is built before it
  is seen, most of the time, because near reaches half a screen past the viewport.
- **A live stroke** goes to the model, as today, and to the grid of every held band of its layer by the same operation.
  Each band shades only the rectangle the stroke changed in it.
- **The model stays whole.** `LayerInk`'s cells (12.5px apart, about 50,000 for the tallest post) are held while the
  post is near, as today. The washed share, clean, the layer a stroke scrubs, the sweep and the lines under ink read
  the model and never a band.
- **The suds** keep one canvas, placed over the span of the near bands and sized to it, at the screen's density
  lowered where needed to stay within `MAX_CANVAS_PX`. Suds are thrown where the pointer or the sweep is, which is in a
  near band.
- **The band watcher is the engine's.** `engine/ui/cards/bands.ts`, beside `bodyBox`: it cuts a box into bands, places
  one empty element per band in a host, watches them through the engine's shared observer
  (`engine/ui/shine/inView.ts`), and says which are near. It knows no card. Whoops! is built on it now.

**What it comes to.** For three layers on a phone (390px wide, five bands held): about 27MB of layers and 16MB of suds,
about 45MB, at any post height, against about 250MB. On a 1,000px-wide desktop post about 105MB, again at any height.

- **Alternative weighed: trim what is held** (rejected). Let the painted splat and the slots go once the build
  arrives, and hold the field as `Uint16`. About 250MB becomes about 130MB. Memory still grows with the post up to the
  cap, the tall post stays soft, and iOS's failure is only further off.
- **Alternative weighed: bands for the canvases, one whole field per layer** (rejected). About 90MB. It needs the same
  seam work as full banding and keeps the cap, the soft tall post and a whole-post build.
- **Alternative weighed: one composed canvas per band, with the layers' pictures off the page** (rejected by the
  owner). About 20MB more on a phone, for e2e pixel reads that change less.

**The stand-in.** While a band's build is out, the band's layer canvas shows a stand-in drawn straight onto it: each
ball of the splat as a flat circle in the layer's ink, then the strokes as today (a pen flat in its ink, a wash taking
`STAND_IN_WASH`), the open sweep band's stroke included. It costs almost nothing and holds nothing. For the moment it
shows, the ink has no shading and is a little thinner where blobs join. The build's picture replaces it.
- **Alternative weighed: the model's cells** (rejected). Exact to what counts as ink, and blocky.
- **Alternative weighed: keep the painted splat, band-sized** (rejected). Closest to the final picture, at about 50ms a
  band a layer on the main thread at page load.

**Glitter Bomb** has the same shape and no cap: its two canvases under the words are sized to the whole body at up to
2 per CSS px, about 250MB for a 390×20,000 post of solid text, and past iOS's canvas limit. It is decoration, so it
fails to bare words. The owner decided: the band watcher is shared, and Glitter Bomb moving onto it is a design of its
own (#557), because its flakes, burst and cling need their own answers. Graffiti's wall is held to `MAX_CANVAS_PX` by
the same lowered density (`instances/divided-world/cards/graffiti/spray.ts`); it is noted on #557 and not changed here.

## 2. The light path measures itself

**Decided.** Which builds run on the main thread is decided from this device's own measured pace, against a fixed
budget.
- Every build reports how long it took (`ms`), from the worker and from the page.
- The page keeps one `pace`: a running average of measured time over estimated work (`estimateWork`, whose weights stay
  as relative costs), starting at 1 and held between 0.25 and 8.
- A band is built on the main thread, before its first frame, only when its estimate times the pace is under
  `QUICK_MS` (12). Otherwise it goes to the worker and the stand-in shows meanwhile. `QUICK_WORK` goes.
- The pace is this page's own timing of its own work. It is sent nowhere and reads nothing private.

- **Alternative weighed: worker only** (rejected). One path fewer, and every splatted post in view at page load shows
  the stand-in for a moment.
- **Alternative weighed: tune by hand on a device** (rejected). One number for every device, right for the one it was
  tuned on.

## 3. A short wash's top-up fades out

**Decided.** A wash whose path is shorter than `R` (2r) is a dab, topped up at its end to a whole pass. The top-up now
shrinks in a straight line from all of it at `R` to none at `1.5R`, so a drag a little longer never cleans less than a
shorter one. A tap and a full pass are unchanged. The model and the painter share `beginWash`, so they still agree.

- **Alternative weighed: leave the step** (rejected). A drag just over `R` takes about 0.6 less under its end than a
  tap: a place where doing more cleans less.
- **Alternative weighed: no top-up** (rejected). A tap on a phone would feel like it did nothing.

## 4. The sweep moves at a hand's pace

**Decided.** "Hold to scrub" moves at `SWEEP_PX_S` (400) CSS px a second on every screen, where it moved at 0.55 of the
box's width a second. `WASH_TAKES` stays 1.5: the obstacle is unchanged.

**Why.** A hand's speed is in px, not in shares of a box. The old pace was 418px/s on a 760px desktop post and 197px/s
on a 358px phone post. The session simulated a tidy hand (the 30px brush, rows 20px apart, only over ink, scrubbing
until the layer is clean at 95%) against the sweep on the same seven splats, with the build's own model. Medians:

| Box | Sweep, old pace | Hand at 300px/s | at 600px/s | at 1,000px/s |
| --- | --- | --- | --- | --- |
| Phone 358×420 | 47s | 34s | 17s | 10s |
| Phone 358×900 | 93s | 67s | 34s | 20s |
| Desktop 760×240 | 31s | 47s | 23s | 14s |
| Desktop 760×600 | 66s | 100s | 50s | 30s |

The hand's speeds are the session's assumption, not a measurement. At 400px/s the desktop sweep stays about where it
was and the phone's takes about half as long, inside the hand's range on both, as "An accessible path costs what the
obstacle costs" asks. 400 is a tidy 600px/s hand slowed for a real hand's wasted motion.

- **Alternative weighed: leave it** (rejected). On a phone the keyboard and switch path costs about 1.4 to 4.7 times a
  finger's.
- **Alternative weighed: time a real hand first** (rejected by the owner). The build would wait on one number.

## 5. A line is uncovered when the eye can read it

**Decided.** A point under washed ink stops covering a line once that ink is thinned below `READ_THROUGH` (75%)
opacity. In the field that is the threshold plus `THIN_SPAN · (0.75 − THIN_FLOOR) / (1 − THIN_FLOOR)`, about 0.74:
roughly half a wash pass before the hole opens. Ink no wash has touched is drawn whole and always covers. Only the
lines under ink change: the washed share, clean, the layer a stroke scrubs and the sweep still read ink at the
threshold.

**Why one number.** The session first proposed a rule by contrast, a cover level for each ink from the board's own
colors, and told the owner pale ink shows the words much sooner than dark ink. The bench showed that was wrong. At one
opacity every ink, pale or dark, on the light or the dark board, gives nearly the same contrast of the words seen
through it: about 1.3:1 at 90%, 1.6 to 1.9 at 80%, 2.1 to 2.7 at 70%, 2.9 to 3.8 at 60%. So one opacity releases a
line at almost the moment a contrast would, and reads no colors from the board. At 75% the words are plainly readable
(about 2:1), and at 80% they are not yet.

- **Alternative weighed: release at 85%** (rejected). A screen reader would be given lines a sighted reader must
  squint for.
- **Alternative weighed: release at 65%** (rejected). A screen reader would wait longer than a determined eye.
- **Alternative weighed: by contrast, per ink** (rejected, above).
- **Alternative weighed: leave it** (rejected). The screen reader's path would cost more than the eye's for every
  thinned line.
- **Alternative weighed: raise the thinning floor so nobody reads through** (rejected). It undoes the see-through look
  the owner chose on the ink field bench.

## 6. The review findings this takes, and those it leaves

Banding rewrites the picture code, so the plan takes the seven findings of #549 that lie in it:
- the painted splat held after the build arrives (section 1: nothing is kept);
- the stand-in's splat shaded on the main thread (section 1: flat circles);
- two Effects sharing one build key (each requester's key carries its own token);
- no test on `flushPic`'s one-point margin (the byte-for-byte test, and one on a live stroke's rectangle at a band's
  edge);
- `estimateWork` calibrated in Node (section 2);
- a save's own echo rebuilding the layer (the echo is known by the splats' seeds, where it compared the list itself);
- the sweep's current band missing from the stand-in (section 1).

The other seven stay open in #549, for a plan of their own: a long scrub's replay cost, `fitStroke` moving a dense pen
line by more than a quarter of a brush, the e2e pass counter, the `unanswered` save markers, the fake's `saveEffect`
running no `validateState`, the point budget under back-and-forth scrubs, and the e2e's check after
`3 × SAVE_AFTER_MS`.

## 7. The rules

- **Masks (CLAUDE.md, "A response never proves a private fact").** No response, payload or Realtime event is added,
  and nothing saved changes shape. Which bands a screen holds follows that screen's own scroll. A build's time and the
  pace are local and grow with a post's strokes and the device, both of which are public or the reader's own.
- **Ways out (CLAUDE.md, "No player is ever stuck").** No state is added for a player, a character or a post. A splat
  ends as it does today. A band whose build fails keeps its stand-in, which still shows the ink, takes strokes and is
  counted by the model, so cleaning never depends on a build.
- **The fiction and the log.** No word a player reads changes. The card's rules text and the Lens's stay true.
- **Accessibility (CLAUDE.md, "An accessible path costs what the obstacle costs").** Sections 4 and 5 are that rule
  applied: the sweep costs a hand's time on every screen, and a screen reader is given a line when the eye can read it.
  Reduced motion changes nothing here.
- **The layers (CLAUDE.md, "KayfaBB never knows which instance it runs").** `engine/ui/cards/bands.ts` is the engine's
  and knows no card. Everything else is the instance's, in `instances/divided-world/cards/whoops/`. The engine imports
  nothing from the instance.
- **A busy instance.** Memory and work follow the screen: the bands near the viewport, across every post on the page.
  A page of many short splatted posts holds what it held before, less the composed canvas and the painted splats. A
  band's build replays the layer's strokes (at most 40,000 points), which is the cost that grows, and it runs once a
  band comes near. The band elements are one empty element per 512px of a splatted post, on one shared observer.
- **Append-only.** Nothing is saved differently; no Act is touched.
- **American English** for every word a player reads; none changes.

## 8. Open

- **`SWEEP_PX_S`, `READ_THROUGH`, `BAND_PX`, the near margin and `QUICK_MS`** are named constants. The sweep's pace
  rests on assumed hand speeds; the owner may tune it once a real hand has been timed.
- **Glitter Bomb and Graffiti on bands:** #557.
- **The seven findings left in #549** (section 6).
- **Filled shapes** stay #540.
