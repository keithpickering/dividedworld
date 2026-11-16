# Effect tiles: design

Record, written 2026-11-16. A design session with the owner, started from finding F2 of Hot Box's final review (PR
#713; the first item of issue #722) and the owner's report of lag with Graffiti on a post near 20,000 characters. Its
first plan is `docs/plans/2026-11-16-effect-tiles-step-1-plan.md`. The measurement it rests on is
`docs/research/2026-11-15-effect-canvas-bench/01-bench.html`.

## 1. Why

A card's effect that draws on a canvas fills the post's whole content area (the owner, 2026-11-06 and 2026-11-15:
`engine/ui/cards/body.ts`). A post is at most 20,000 characters, which on a phone can be tens of thousands of px tall.
Read on `origin/main` at `b869b5f1`, the effects bound that five ways:

| Effect | Its canvases | What bounds them |
|---|---|---|
| Hot Box (`instances/divided-world/ui/hot-box/Effect.tsx`) | one over the whole body | 16,000,000 px, by lowering the density; every frame clears and refills all of it |
| Graffiti (`instances/divided-world/cards/graffiti/Effect.tsx`, `spray.ts`) | the wall and the suds over the whole body, and a halo layer of the same size made and released at every paint | 4,000,000 px each, by lowering the density; every move of a scrub repaints every stroke of the wall |
| Whoops! (`instances/divided-world/cards/whoops/Effect.tsx`) | the ink in bands of 512 px near the viewport (`engine/ui/cards/bands.ts`), the suds over the span of those bands | bands at a density of at most 1, repainted by dirty rectangle; the suds at 4,000,000 px |
| Feelin' Fab, Glitter Bomb (`instances/divided-world/ui/feelin-fab/Effect.tsx`, `glitter-bomb/Effect.tsx`) | one over the whole body, handed to a worker where it can be | `paintScale` and `paintShare` (`engine/ui/cards/body.ts`) and the shine loop's span hold the redraw; nothing holds the pixels: 720 by 20,000 at a density of 2 is a canvas of about 14,000,000 px |
| Autocorrect (`instances/divided-world/cards/autocorrect/Effect.tsx`) | a paper canvas per line a strip crosses, and one residue canvas over every strip's span | the residue at 4,000,000 px with a floor of half density, repainted whole |

Each effect also finds and measures the body itself, watches the viewport itself, and runs its own frames. So the
cost of a frame and the memory held grow with the post, the next card writes a sixth way, and there is no one figure
a new effect can be tested against.

### What the bench measured

The bench draws stand-ins for two effects' frames (not their code): Hot Box's, every frame, and Graffiti's, one
repaint for each move of a scrub with 80 strokes on the wall. Each is drawn on one canvas the size of the post, as
built today, and on tiles 1,024 px tall of which only those within 200 px of the viewport exist. Headless Chromium on
the owner's machine, 40 frames a run; no phone was profiled. `gap` is the time between animation frames.

| Profile | Post, CSS px | Hot Box whole | Hot Box tiled | Graffiti whole | Graffiti tiled |
|---|---|---|---|---|---|
| Software raster, density 1 (as CI) | 720 by 1,000 | 0.7 Mpx, gap 16.7 ms | 16.7 ms | 580 ms a repaint | 585 ms |
| | 720 by 8,000 | 5.8 Mpx, gap 16.7 ms (95th percentile 33.4) | 16.7 ms | 504 ms | 106 ms |
| | 720 by 20,000 | 14.4 Mpx, gap 33.2 ms (95th percentile 50) | 16.7 ms | 387 ms | 44 ms |
| GPU, density 2 | 720 by 1,000 | 2.9 Mpx, gap 16.7 ms | 16.7 ms | 190 ms | 203 ms |
| | 720 by 8,000 | 16 Mpx, gap 16.7 ms (95th percentile 33.5) | 16.7 ms | 233 ms | 38 ms |
| | 720 by 20,000 | 40 frames not done in 60 s | 16.7 ms | 195 ms | 14 ms |
| GPU, 390 wide, density 3, CPU slowed 4 times | 390 by 2,000 | gap 16.7 ms (95th percentile 50) | 16.7 ms | 1,283 ms | 592 ms |
| | 390 by 8,000 | 12.5 Mpx, gap 16.7 ms | 16.7 ms | 1,228 ms | 189 ms |
| | 390 by 40,000 | 40 frames not done in 60 s | 16.7 ms | the tab crashed | not reached |

Two things follow. A whole-post canvas redrawn every frame fails outright on a very long post, and tiles hold it at
the screen's rate at every length. Graffiti's cost is the strokes more than the pixels: tiling helps a long post only
because fewer strokes fall in the tiles near the view, and a dense stretch (the 1,000 px rows) is as slow tiled as
whole. Graffiti needs its paint kept, not repainted (section 4).

## 2. The shape: an engine tiled layer (the owner's pick)

The engine owns a tiled layer. It finds and measures the post's content area, cuts it into tiles of a fixed height,
holds a canvas only for each tile near the viewport, releases a tile that leaves, sets the density, and runs one frame
schedule for every layer on the page. An effect hands it a painter that draws in the content area's own coordinates
and never sizes a canvas. Each effect keeps its own layer at its own depth among the post's elements.

Weighed and not chosen:

- **Each effect fixed by hand** (Hot Box and Graffiti take up `watchBands` themselves). The least change; it leaves
  five ways, three pixel caps and no figure to test a new effect against.
- **One canvas shared by every effect**, for a post or for the page. The effects lie at different depths around the
  words: Feelin' Fab's foil under them, Graffiti's wall beneath the other cards, ink over the words, and what the
  engine lifts over the ink above that (`engine/ui/thread/thread.css`, `data-kb-effect-ink` and `data-kb-over-ink`),
  so one surface cannot be both under and over. They redraw at different rates, so Hot Box's every frame would
  composite Graffiti's wall and Whoops!'s ink again, or each keeps its own buffer and the memory is the same. A canvas
  the size of the viewport, fixed to it, is drawn on the main thread and trails the compositor's scroll: in a fast
  scroll Hot Box's smoke would slide off the words it covers, and the obstacle could be read around. What is worth
  sharing is the measuring, the watching and the frames, and the layer shares those.

## 3. The tile, and the figure (the owner's pick)

A tile is 512 CSS px tall (the last of a box is what is left) and drawn at a density of at most 2. The board's column
is at most 1,200 px wide (`--kb-board-max`, `e2e/board-width.spec.ts`), so the largest tile is 1,200 by 512 CSS px:
2,400 by 1,024, **2,457,600 canvas px**, about 9.8 MB. That is under the 4,000,000 px past which a canvas fails
silently on iOS (`instances/divided-world/cards/whoops/paint.ts`), at every width, so a long post is never drawn
soft. Where a box is somehow wider than 1,200 px the layer lowers the density until the tile is 2,400 px across, so
the figure holds whatever the layout. An effect may ask for a lower density (Whoops!'s ink asks for 1) and never a
higher one.

A tile is held while it lies within 256 px of the viewport, above or below. The most tiles one layer holds is
`ceil((viewport height + 512) / 512) + 1`: four in a window 900 px tall. The figure is each layer's: a post under three
canvas effects holds three layers' tiles. Across posts it is bounded by the window, since a tile far from the view is
released whichever post it belongs to.

512 px is Whoops!'s band (`BAND_PX`), so its ink moves onto the layer without a change to its lattice.

Weighed and not chosen: tiles 1,024 px tall (half the canvases and seams, but a full-width tile at a density of 2 is
4,915,200 px, over the cap, so a wide post on a dense screen is drawn soft and the figure is no longer one number); a
height chosen per post to meet a fixed pixel count (the same memory for every tile, but no fixed height).

## 4. Two ways a layer is painted

- **Every frame** (Hot Box's smoke): while the layer's loop is on, the engine calls the painter for each held tile
  each frame. The effect turns the loop off when nothing moves (reduced motion, a post waved clear, a moment).
- **Kept** (Graffiti's wall, the owner's pick): a tile is painted when it is first held and when the effect says a
  part of the box is stale, and the effect may draw straight into held tiles between those. A layer may hold more
  than one canvas to a tile: Graffiti's holds two, the halos beneath and the cores above, painted from the wall's
  Acts. A live scrub cuts its newest segment into both, in the tiles it touches: one short line a move, however many
  strokes the wall holds. A wash erases at full strength, so a path cut piece by piece is the path cut whole, and the
  kept tiles are the picture a repaint from the Acts gives. A tile that leaves and returns is painted from the Acts,
  which hold this screen's scrubs, so nothing is lost. The halo layer made and released at every paint goes.

  Weighed and not chosen for Graffiti: a repaint clipped to a rectangle around the brush (one canvas a tile and one
  paint path, but a move still walks every stroke that passes near the brush, so a heavily tagged spot stays slow);
  tiles alone (a long post is faster, a dense wall is not: the bench's 203 ms).

One `requestAnimationFrame` serves every layer on the page and stops when no layer has a loop on or a stale tile, so
an idle page costs nothing.

## 5. An obstacle is never bare (decided in the session, for the owner's eye)

A tile is held only once the browser has said it is near, and an IntersectionObserver answers a frame or more late.
An effect that hides words (Hot Box) must not show them in that gap, or a fast scroll through a long smoked post
reads it. So:

- The layer's first tiles are found from the box and the window in the same layout pass that makes the layer, and
  painted in it. The observer keeps the set after that.
- Every tile's place has a stand-in: the element the layer already lays over each band to watch it. It is marked far
  while no painted tile covers it and held once one does, and an effect may style the far mark. Hot Box's is the
  fog's flat color, so a band that scrolls in before its tile is painted shows fog with no puffs for a frame, never
  words. A stand-in is a plain colored box and costs the compositor nothing to scroll.

This adds no state a player, a character or a post can be put in.

## 6. The guards (the owner's pick: all three)

1. **The pixels, exactly.** A unit test of the layer's arithmetic: for a box 1,200 px wide and 40,000 tall, at a
   density of 2 and of 3, no tile is over 2,457,600 canvas px and no more tiles are held than section 3's count; a
   box wider than 1,200 px lowers the density to the same figure; a tile released has no pixels.
2. **No canvas outside the layer.** `tools/check-effect-canvas.mjs`, with `tools/test-effect-canvas.mjs` driving it
   red on a planted canvas: a `<canvas>`, `createElement('canvas')`, `OffscreenCanvas` or
   `transferControlToOffscreen` in `engine/ui` or an instance is refused outside the layer and a list that names each
   file, how many, and why (a sprite, a config preview, Autocorrect's per-line paper). Until step 5 the list also
   names each effect not yet moved, with the step that moves it; each step deletes its own line, and a line for a
   file that no longer makes one is stale and fails. It also holds that every instance effect on the layer has an
   entry in the budget stories below, so a new effect cannot skip the third guard.
3. **The frames, measured.** A Playwright spec over a story for each effect on the layer, on a post of 20,000
   characters, in the desktop and phone projects. Scrolled top to bottom, it asserts the pixels as held in a real
   page (no canvas in a post body over the figure, none held far from the view), that the layers' own time in a
   frame keeps a 95th percentile under 8 ms (half a frame, leaving the rest to the page), and, for an effect that
   hides words, that no band in view is ever without its tile or its stand-in. It logs the gap between frames and
   does not assert it.

   A correction to what the owner was told in the session: the gap is not a bound `e2e/shine.spec.ts` asserts. That
   spec logs it and asserts the loop's own time instead, since issue #318 found the gap misses on CI's software
   renderer for reasons that are not the code's. This spec does the same. Two poisons are stories of their own, as
   the shine spec's are: a painter that takes 25 ms turns the own-time check red, and a canvas the size of the post
   turns the pixel check red.

## 7. Every canvas effect moves, in five steps (the owner's pick)

One plan and one PR a step, in this order. A step's plan is written by a design session once the step before it has
merged, against the layer as built, because a plan written against an interface nobody has built yet names functions
that may not survive the build. The first is written now.

1. **The layer, its guards, and Hot Box** (`docs/plans/2026-11-16-effect-tiles-step-1-plan.md`). Proves the
   every-frame way. Closes the first item of issue #722.
2. **Graffiti.** Proves the kept way: two canvases a tile, the scrub cut in, the suds on a layer of their own, the
   halo scratch gone. `hitAt` stays the model's and is not read from pixels.
3. **Whoops!.** Its ink bands and its suds go onto the layer; its own measuring and its own use of `watchBands` go.
   `bands.ts` is then the layer's alone.
4. **Feelin' Fab and Glitter Bomb.** The largest step: a tile's canvas handed to the foil worker, the shine loop
   (`engine/ui/shine/loop.ts`) deciding when a layer draws, and `paintScale` re-weighed, since a tile near the view
   costs what it costs whatever the body's height.
5. **Autocorrect's residue.** Its per-line paper canvases are a line's size and stay, named in the check's list.

At the end the check's list holds no effect waiting, and no file in an instance sizes a canvas to a post.

Weighed and not chosen: the obstacles alone, with a pixel cap on the shine effects (two systems remain, and a long
foiled post is drawn soft); Hot Box and Graffiti alone (Whoops! keeps a second copy of the idea and the shine effects'
memory stays unheld).

## 8. The rules

- **Engine and instance.** The layer, its frame schedule and its unit test are the engine's
  (`engine/ui/cards/`). A painter, a stand-in's style and a budget story are an instance's. The layer names no card
  and reads nothing of a post but its box. The check and the spec are neither.
- **Private facts.** The layer computes nothing from one: it reads a box, the window and the frame clock. No
  response, payload, Realtime event or timing is added.
- **States.** None is added.
- **An accessible path costs what the obstacle costs.** Nothing here changes what an effect asks of a reader: Hot
  Box's clearings, its held sweep and its forced-colors path keep their model and their pace. Under forced colors
  Hot Box draws no canvas and makes no layer.
- **Scale.** The layer's cost is the window's, not the post's, the thread's or the instance's: it is the point of
  the design.

## 9. Open

- **Hot Box's puffs on a long post.** `puffs` gives a box at most 160, so a post many screens tall has few in view.
  That is as built today and step 1 does not change it; whether a long post should be as smoky as a short one is the
  owner's to say when the long story is looked at.
- **The own-time budget of 8 ms** is the session's figure, not a measured one. Step 1's build records what the
  stories measure on CI; if Hot Box misses it there, the build asks rather than raising it.
- **A real phone.** Every number here is from a desktop machine. Issue #722 still asks for a profile of the long
  story on a phone.
