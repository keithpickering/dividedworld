# Sharp prism: mockup and bench

Record, written 2026-11-17. Surveyed `engine/ui/shine/foil.ts` on `origin/main` at `acbbc2b4`, to answer whether Feelin' Fab
level 3's prism can be drawn sharp within the shine budgets. The design that follows from it is
`docs/plans/2026-11-17-sharp-prism-design.md`.

## Why level 3 reads blocky

The prism's facets are a seeded jittered Voronoi with a pitch of 17 CSS px (`FACET`). The foil gives each 3 CSS px cell one
color and stretches that grid over the canvas with bilinear smoothing; on a body bigger than its words the cell coarsens to
about 6 px and the density halves (`engine/ui/cards/body.ts` `paintScale`). A facet is 3 to 6 cells across, so its edge is a
staircase, and a seam is a whole cell (3 to 6 px) darkened on one side. The pearl and the bands are soft gradients and hide
the grid; the prism has hard edges and shows it.

## What was tried

`foil-mockup.patch` applies to `engine/ui/shine/foil.ts` and adds two mockup modes for the prism, beside today's:

- **Shapes** (`sharp: true`): each facet's polygon is clipped from the box by its neighbors' bisectors once per layout, kept
  as a `Path2D`, and each frame fills every polygon in one flat color and strokes its seam.
- **Lookup** (`lookup: true`): once per layout and density, every device pixel is given its facet and whether it lies within
  half a seam's width of the bisector to the second-nearest center. Each frame computes one face color and one seam color per
  facet (today's arithmetic, through `finishRow`), and fills the pixels by one table lookup each, then `putImageData`.

In both, a facet's color is today's per-cell arithmetic sampled at the facet's center: its hue (`seed + ph * 0.45 + rr * 1.6`),
its turn with the light, its flash and the band's clamp. Across a 17 px facet `rr * 1.6` moves the hue about 0.045, which
does not show.

`01-mockup.html` is the page shown to the owner (self-contained; `main.ts` and `page.html` are its source, built with
esbuild). `02-still.png` is a still of an earlier build of it, with the Shapes mode in the right column; the page now draws
the Lookup mode there, which looks the same.

## Numbers

Headless Chromium as installed in the session container, software raster (as CI), `bench.ts` built with esbuild and run by
`bench.cjs`. Median of 60 draws after 20 warm-up draws, each followed by a one-pixel `getImageData` so the canvas's raster
counts. ms per draw of one post:

| Box (CSS px) | Density | Today | Shapes, 1 px seams | Shapes, no seams | Lookup, 1 px seams |
|---|---|---|---|---|---|
| 375 x 230 | 1 | 0.60 | 2.50 | 1.80 | 0.20 |
| 375 x 230 | 2 | 1.40 | 8.30 | 2.40 | 0.80 |
| 988 x 300 | 1 | 1.40 | 6.40 | 6.00 | 0.60 |
| 988 x 300 | 2 | 4.50 | 21.40 | 8.90 | 1.80 |
| 720 x 1000 | 1 | 4.20 | 17.80 | 12.30 | 1.30 |
| 720 x 1000 | 2 | 10.70 | 53.50 | 20.80 | 4.20 |

The Today and Lookup columns were measured in one run and Shapes in another; Today's figures agreed between the runs within
0.4 ms. The owner's own machine, on the mockup page's 375 x 230 panels (on-screen canvases, not the bench), read about 0.5 ms
today, 0.25 ms for today's tall-post case and about 3 ms for Shapes.

The Lookup's first draw builds the map, by a search per pixel over the 3 x 3 nearby centers: 129.5 ms for 988 x 300 at
density 2, 259 ms for 720 x 1000 at 2, 120 ms for 720 x 512 at 2 (one tile's height). It holds the map (here a `Uint32Array`)
and a full-size `ImageData`, 8 bytes a device pixel: 9.5 MB for 988 x 300 at 2.

## What it showed

- Shapes is out: at 988 x 300 at density 2 one post costs 21 ms, more than the 16 ms the foil worker has for every post in
  view (`e2e/shine.spec.ts` `WORK_BUDGET`). Its cost is the canvas rasterizing a few hundred paths and strokes a frame.
- Lookup is about two and a half times faster than today at every size, draws at full density, and looks the same as
  Shapes. Its costs move from the frame to the layout: memory that grows with the device pixels, and a map built before the
  first sharp draw.
- The Lookup's seams are hard-edged. At density 2 that does not show; at density 1 it was not judged.
