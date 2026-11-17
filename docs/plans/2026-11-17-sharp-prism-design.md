# Sharp prism: design

Record, written 2026-11-17. A design session with the owner, started from the owner's question of the day: "Is there a way for
Feelin' Fab Level 3's res to be increased? Seems a bit blocky". The mockup, the bench and their numbers are
`docs/research/2026-11-17-sharp-prism/`. Read on `origin/main` at `acbbc2b4`.

This design has no plan of its own. The owner's pick is to fold it into step 4 of the effect tiles
(`docs/plans/2026-11-16-effect-tiles-design.md`, section 7: Feelin' Fab and Glitter Bomb move onto the tiled layer). That
design writes each step's plan once the step before it has merged, against the layer as built, and only step 1 has merged.
So step 4's design session reads this design beside the tiles design and writes one plan for both. This design says what
level 3 becomes; step 4's session says in which tasks.

## 1. Why level 3 reads blocky

The foil gives each 3 CSS px cell one color and stretches that grid over the canvas with bilinear smoothing
(`engine/ui/shine/foil.ts`). On a body bigger than its words the cell coarsens to about 6 px and the density halves
(`engine/ui/cards/body.ts` `paintScale`). The prism's facets are a jittered Voronoi with a pitch of 17 CSS px (`FACET`), so
a facet is 3 to 6 cells across: its edge is a staircase, the smoothing blurs the staircase, and a seam is a whole cell
darkened. The pearl and the bands are soft gradients, and the grid does not show in them. Only the prism has hard edges.

## 2. What level 3 looks like (the owner's pick, from the mockup)

- **The facets** stay cracked ice: a seeded jittered Voronoi at the same pitch, each facet tilted its own way (`nx`, `ny`)
  with its own phase (`ph`). They are drawn at the canvas's full density, with no grid between them and the screen.
- **A facet is one flat color**, from today's per-cell arithmetic sampled at the facet's center: its hue
  (`seed + ph * 0.45 + rr * 1.6`), its turn with the light (`0.55 * (nx * lx + ny * ly) + 0.25 * lx`), its flash
  (`exp(-|n - light|^2 / 0.07) * 0.7`) and the band's clamp through `finishRow`. Across a facet, `rr * 1.6` moves the hue
  about 0.045, which does not show (the mockup).
- **A seam is 1 CSS px, with a soft fringe** (the owner's pick). A device pixel within half a CSS px of the bisector between
  its facet and the nearest other one is the seam: the facet's color scaled by today's factor (0.94 on a light board, 0.78
  on a dark one) and its flash halved, as today's seam cell is. A pixel beyond that by up to one device pixel is the fringe:
  halfway between face and seam, in linear light, before the clamp. That antialiases the seam at a density of 1 and of 2
  for no work a frame. Face, seam and fringe each go through `finishRow`, so all three stay in the readable band, as every
  cell does today.
- **The starbursts** are unchanged.
- **Levels 1 and 2** (the pearl and the bands) are unchanged and keep the cell grid.

Weighed and not chosen:

- **Finer cells for the prism** (1.5 px, no coarsening). The smallest change, but the work grows with the square of the
  cell, and today's render already sits near its bound under CI load (issue #472).
- **Facets as shapes** (`Path2D` polygons, filled and stroked each frame). The sharpest at any zoom, and it looks the same
  as the pick, but rasterizing a few hundred paths a frame costs 21 ms for one 988 by 300 post at a density of 2, over the
  16 ms the worker has for every post in view (the research's table).
- **Hard 1 px seams.** What the mockup showed. They're the cheapest, and at a density of 2 they look clean, but at 1 they
  may look jagged, and the fringe costs nothing a frame.
- **No seams.** Facets meet edge to edge. That's a cleaner stained glass, but less like cracked ice.

## 3. How it is drawn

What no light moves is the facets' geometry; what the light moves is only each facet's three colors. So the split is the
one the foil already makes, carried to the device pixel:

- **The map, once per tile, layout and density.** For each device pixel of a tile, an index into a color table:
  `3 * facet + {0 face, 1 seam, 2 fringe}`, with the facet numbered locally to the tile. A `Uint16Array`: a tile is at
  most 1,200 by 512 CSS px, which holds about 2,100 facets and their neighbors, so about 7,000 entries, under 65,536.
- **The facets, by grid cell.** A tile must not need the whole post's facets, so each 17 px grid cell's center and tilt
  come from a generator seeded by the post's seed and that cell's column and row, not from one sequence run over the
  box. A tile reads the cells it covers and one ring around them. This changes which facets a seed gives (the pinned
  bytes change anyway, section 6), and a post's facets no longer reshuffle when it is resized.
- **The build, by scanline, in the worker.** The mockup searched the 3 by 3 nearby centers for every pixel (120 ms for a
  tile at a density of 2). The build walks each row of pixels and changes facet only where the row crosses a bisector,
  so most pixels cost a comparison. How fast it is on CI is step 4's to measure (section 8).
- **A frame.** For the tile's facets, the three colors each (today's arithmetic, then `finishRow` on a row of
  `3 * facets`), then one pass that writes each pixel's color from the table into an `ImageData`, `putImageData`, and the
  starbursts over it. The layer draws its tiles one after another, so one `ImageData` of a tile's size serves every tile
  of the layer. A draw handed a span writes only the span's rows, as today's draw does.

Memory, at the tiles design's largest tile (2,457,600 canvas px): the map is 4.9 MB a tile, and the shared `ImageData` is
9.8 MB a layer. At four tiles held that is about 29 MB a layer beyond its canvases. Today's foil holds a grid of a few
hundred KB. Step 4 weighs that against the tiles design's figure (section 8). A tile released frees its map.

Weighed and not chosen: the map in a `Uint32Array` with global facet numbers (what the mockup did: simpler, but twice the
memory, and it needs the whole post's facets).

## 4. Until a tile's map is ready (the owner's pick)

A tile whose map is not built yet draws today's soft prism, the cell grid at its coarse cell, with the same seed's colors,
and draws the sharp prism from the first frame after its map is ready. So a tile is never bare and never flashes; the soft
prism is the stand-in. The cell grid stays in the foil anyway for levels 1 and 2, so the stand-in adds no code path. This
holds after a resize too: the old map goes, the soft prism shows, and the new map takes over.

Weighed and not chosen: bare until the map is ready (simplest, but the foil pops in late in a fast scroll); building maps
for tiles just outside the view (bare only on a jump, at more memory, and the tiles layer already decides what is held).

## 5. Cost, measured (the research)

Software raster, median ms a draw of one post, today against the lookup with 1 px seams: 375 by 230 at density 2, 1.4
against 0.8; 988 by 300 at 2, 4.5 against 1.8; 720 by 1,000 at 2, 10.7 against 4.2. The lookup is about two and a half
times faster than today at every size measured, and it draws at full density where today's draws at half on a tall body. The
fringe adds a third table entry per facet and no work per pixel. The cost moves to memory (section 3) and to the build
(section 4).

## 6. The tests that change

- **The pinned bytes.** `engine/ui/shine/foil.test.ts` holds each pattern's bytes by digest. The prism's digests change and
  are taken again, and the poison (one stop moved by one step) still turns them red.
- **The band.** `sampleFoil` returns the prism's face, seam and fringe colors for every facet at the sampled lights, and the
  band check reads them as it reads cells today. A poison: a seam computed after the clamp instead of before it falls
  under the light board's floor and turns the check red.
- **The render bound.** The "988 by 300 under 4 ms" test times the prism's frame (the table and the lookup pass) with its
  map built, and the map's build is timed on its own, with the bound step 4 measures.
- **Never bare.** A test of the switch: a tile drawn before its map is ready shows the soft prism, the frame after the map
  is ready shows the sharp one, and no frame between them is cleared and left empty.
- **The geometry.** The map gives every pixel a facet, a pixel's facet is the nearest center, seams lie where facets meet,
  and a tile's edge pixels agree with the neighboring tile's (no seam drawn along a tile's edge).

## 7. The rules

- **Engine and instance.** The map, the build, the lookup and the seam's arithmetic are the engine's
  (`engine/ui/shine/foil.ts`). The palette and the glint stay Divided World's (`instances/divided-world/ui/feelin-fab/
  Effect.tsx`). Nothing new crosses the boundary.
- **An effect fills the post, border to border.** The foil still fills the content area, now in tiles. Nothing here changes
  which box it fills.
- **Private facts.** The seed is the post's id and the plays' ids, as today. No response, payload, Realtime event or timing
  is added, and the build's time depends only on the box.
- **States.** None is added. The soft prism shown during the build is a frame of drawing, not a state of the post.
- **An accessible path costs what the obstacle costs.** The foil is decoration, never an obstacle. Reduced motion still
  holds the light at rest and draws once. The words keep the band (section 2).
- **Scale.** The cost is the tiles', which is the window's, not the post's or the thread's.

## 8. For step 4's design session

- Plan this beside the move onto tiles, in one plan: the foil worker draws a tile, so the map is built and held per tile
  in the worker.
- Measure the scanline build on CI, and set its bound and the frame bound from that.
- Weigh the memory in section 3 against the tiles design's figure, and say whether the layer's held-tile count or the
  shared `ImageData` changes for it.
- Re-weigh `paintScale` and `paintShare` for the prism: the sharp prism draws at full density by design, so the prism no
  longer takes `paintScale`'s lower density or coarser cell.

## 9. Open

- **The build's speed on CI** is not measured: the mockup's build was the slow search, not the scanline.
- **Whether the soft prism stays as the stand-in** once builds are measured, or whether a build fast enough to finish in the
  frame a tile is held makes it unneeded.
- **A real phone.** Every number is from a desktop container. Issue #722 still asks for a phone profile.
