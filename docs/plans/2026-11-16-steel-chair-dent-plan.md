Record, written 2026-11-16.

# Steel Chair's dent, in relief: plan

Carries out `docs/plans/2026-11-16-steel-chair-dent-design.md`. One PR from `main`. The look to match is
`docs/research/2026-11-16-steel-chair-dent/01-mock.png`, drawn by `01-mock.py` beside it; the recipe below is that
script's, put in the dent box's own coordinates, and `02-recipe.py` checks it against Task 1's tests over 200
seeds (all pass); `03-sheet.png` shows eight of its dents.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for `dent.test.ts`, `npx vitest run
<file>` for `Effect.test.tsx`, `npx playwright test e2e/steel-chair.spec.ts --trace off` for the browser). Run
`npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database,
bucket or connector is touched.

**The layers.** Everything here is Divided World's. **This build edits no file under `engine/` and adds no
migration.** If a task cannot be done without one, stop and ask the owner.

**What stays as built** (`docs/plans/2026-11-15-steel-chair-plan.md`): the throw, the chairs, the room, the sound,
the Lens; `dentPrimitives`, `hitZone`, `dentsOverlap`, `filterTrusted`, `seedOfIds`, `DENT_SCALE = 14`; the filter's
flood, its per-dent `feComponentTransfer` growth (`depthRef`) and its arithmetic sum; the two shading layers
(`.dw-chair-dents` multiplied, each `.dw-chair-dent` darkened among them; `.dw-chair-glows` screened, each
`.dw-chair-glow` lightened), placed by `placeLayer` and marked `data-kb-effect-ink`; forced colors hiding the shading
and the chairs.

## Task 1. The height map and its three images

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/dent.ts`, `dent.test.ts`, and the `dent.ts` line of
`tools/check-effect-canvas.mjs` (`CANVASES`).

**`DentShape`** (from `dentShape(playId)`, the same seeded generator `rng(seedOfIds(['dent', playId]))`, drawn in
this order): `rx`, `ry` (as today), `turn` (0 to 360, now only the crease's angle), `waves` (three `{ amp, phase }`
for the angular waves 2, 3 and 5: `amp` from −0.1 to 0.1, `phase` 0 to 2π), `lobes` (2 to 4, `2 + floor(3·rand())`,
each `{ u, v, radius, depth }`: a center at distance 0 to 0.3 from the middle at an angle 0 to 2π, `radius` 0.12 to
0.22, `depth` 0.3 to 0.6), `crumple` (a 9 by 9 lattice of values from −0.5 to 0.5). `outline` goes.

**`dentHeight(shape, width, height): Float32Array`**, `width × height` values, row by row, each sampled at a pixel's
center in the box's normalized coordinates `u`, `v` (−1 to 1 across the box, so an ellipse box gives an elliptical
dent), `ρ = hypot(u, v)`, `a = atan2(v, u)`:

- `r0 = 0.5 · (1 + Σ amp·cos(k·a + phase))` over the three waves;
- bowl `−exp(−2.2·(ρ / r0)²)`;
- each lobe `−depth · exp(−(dist / radius)²)`, `dist` from its center;
- the crease, with `θ` = `turn` in radians, `n = u·sin θ − v·cos θ`, `t = u·cos θ + v·sin θ`:
  `−0.15 · exp(−(n / 0.08)²) · exp(−(t / 0.4)²)` (softer than the mock's 0.2 and 0.055, which cut a hard seam through
  the bowl when this recipe was first drawn);
- the lip `+0.12 · exp(−((ρ − 1.05·r0) / 0.09)²)`;
- the crumple: the lattice interpolated with smoothstep weights at (`(u+1)/2·8`, `(v+1)/2·8`), times 0.012, times
  `clamp(−3·h, 0, 1)` where `h` is the sum so far;
- then the whole times `1 − smoothstep(0.8, 0.98, ρ)`, so every sample at `ρ ≥ 0.98` is exactly 0.

**The light.** `LIGHT`, the unit vector of `(−0.5, −0.6, 0.62)` (from the upper left and in front; screen `y` is
down). `HALF`, the unit vector of `LIGHT + (0, 0, 1)`. `RELIEF = 0.065`: a sample's normal is the unit vector of
`(−RELIEF·∂h/∂u, −RELIEF·∂h/∂v, 1)`, the slopes by central differences in `u`, `v` (one-sided at the edge), so the
look does not change with the box's size. `0.065` is the mock's `k = 22` put in these units; it is the one number
the owner may ask to tune in review.

**`dentShade(h, width, height): Uint8ClampedArray`** (RGBA, gray, opaque): `lam = N·LIGHT`, `flat = LIGHT.z`;
`g = (1 − 128/255) / (flat − min(lam))` over the map; a sample is `clamp(1 + (lam − flat)·g, 128/255, 1)`, as a byte.
So its darkest pixel is exactly 128 and flat metal is 255. (A map with no slope, which no shape gives, is all 255.)

**`dentLight(h, width, height): Uint8ClampedArray`** (RGBA, gray, opaque): soft
`max(0, lam − flat)`, scaled so its largest is 71/255; glint `max(0, (N·HALF)^P − HALF.z^P) / (1 − HALF.z^P)` with
`P = 40`, scaled so its largest is 140/255; a sample is `min(140, soft + glint)` as a byte, 0 where the metal is
flat. **The glint's bound:** the samples brighter than 71 are at most 4% of the samples with `ρ < 1`; while they are
more, `P` is multiplied by 1.5 (at most 8 times; after that the glint is scaled to 71, so the bound always holds).

**`dentBend(h, width, height): Uint8ClampedArray`** (RGBA, opaque, blue 128): the slope in the box's px
(`∂h/∂x`, `∂h/∂y`), scaled by one factor so that the largest of `|∂h/∂x|`, `|∂h/∂y|` over the map is 74 bytes; red
`128 + round(scale·∂h/∂x)`, green the same for `y`. The vector points uphill, away from the bowl's floor, which is
today's direction (the words are drawn in toward the middle; see the comment above `dentMap` today, kept and moved
here).

**`dentImages(play, box, density, toUrl = pixelsUrl): { bend, shade, light }`**: `box` is the dent's `DentPrimitive`;
the bend is made at `round(width) × round(height)` (the `feImage` stretches it), the shade and the light at those
times `density`, which the caller gives as `min(devicePixelRatio, 2)`, so no image passes 320 by 320. Kept in a
module cache keyed by `play|width|height|density`, at most 32 entries, the oldest dropped first (a `Map`'s order).
`pixelsUrl(px, w, h)` is the file's one canvas: it draws to a canvas and returns `toDataURL('image/png')`, or `''`
where there is no `document`. `dentMap`, `dentMapUrl` and their cache go.

**`tools/check-effect-canvas.mjs`**: `dent.ts` stays at count 1, its `why` becomes "a dent's height-map images (its
bend, shade and light), each at most 320 px square, drawn once per play and kept as URLs in a cache of 32 plays".

**Tests, red first** (`dent.test.ts`; the `dentMap` and `dentMapUrl` blocks go, the others stay):

- `dentShape`: the same id gives the same shape; three ids give three different shapes; every field in its range;
  2 to 4 lobes.
- `dentHeight` over 20 ids, at 160 by 140 and 120 by 160: the same id gives the same array; every sample with
  `ρ ≥ 0.98` is 0; the lowest sample lies within `ρ < 0.6`; the mean over `ρ < 0.3` is below 0 and below the mean over
  `0.5 < ρ < 0.7` (pressed in, with a lip).
- `dentShade`: the minimum byte is 128 (±1), the maximum 255; every pixel with `ρ ≥ 0.98` is 255; **lit as a hollow**:
  for each of the 20 ids the mean over `u < −0.1, v < −0.1, ρ < 0.5` is darker than over `u > 0.1, v > 0.1, ρ < 0.5`.
  Poison, recorded in the PR: flip `LIGHT`'s `x` and `y` and watch this one go red.
- `dentLight`: every byte ≤ 140; the bytes over 71 are at most 4% of the `ρ < 1` pixels; every pixel with
  `ρ ≥ 0.98` is 0; for each id its largest byte is at least 71 (there is light).
- `dentBend`: blue 128 and alpha 255 everywhere; every pixel with `ρ ≥ 0.98` is 128, 128; the largest channel offset
  is 73 to 75; outward on the whole: in 16 sectors of the ring `0.25 < ρ < 0.6`, the mean of the vector's dot with
  the outward direction is positive in at least 12.
- `dentImages`: with a counting `toUrl`, the same key twice calls it three times, not six; after 32 other keys the
  first is made again; the shade's and light's sizes are the box's times the density; `''` for each where there is
  no `document` (the default `toUrl`).

## Task 2. The effect draws the images

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `steel-chair.css`, `Effect.test.tsx`.

- **`Effect.tsx`**: import `dentImages` in place of `dentMapUrl`; drop `mapUrl`. In the render, after `prims`, each
  shown dent's images are `dentImages(d.play, prims[i], density)` with
  `density = Math.min(window.devicePixelRatio || 1, 2)`. Each dent's `feImage` takes its own `bend`;
  `filterOn` also needs every shown dent's `bend` to be non-empty. Drop `lone`, `edgeStyle`, `turnOf`, the crease
  layer and the four `--dark-*`, `--glow-*` variables. `shadeStyle(i)` is `boxStyle(i)` with
  `'--dw-dent-img': url("<shade>")`; `lightStyle(i)` is `boxStyle(i)` with `'--dw-glow-img': url("<light>")`; an empty
  address sets no variable. Rewrite the header's paragraph on the dents and the comment above `shapeOf` to say what
  is drawn now (a height map per play, its three images, one light).
- **`steel-chair.css`**: the crease rules go. The radial gradients go, with the translucent fallback discs: outside
  `@supports (mix-blend-mode: multiply)` the shading layers are `display: none` (an opaque gray image without a blend
  would cover the words; every current browser has the blend). Inside it, `.dw-chair-dent` is
  `background: var(--dw-dent-img, none) center / 100% 100% no-repeat` and `.dw-chair-glow` the same with
  `--dw-glow-img`, keeping their `darken` and `lighten`. Rewrite the shading's header comment to match.
- **`Effect.test.tsx`**: the `./dent.ts` mock returns fixed addresses from `dentImages` (`data:image/png;base64,` and
  `B`, `S`, `L` with the play id) in place of `dentMapUrl`. Replace the describe "a dent: its own shape and turn, its
  creases, and how its shading combines": three plays' dents each carry their own play's shade and light in
  `--dw-dent-img` and `--dw-glow-img`, and each `feImage` its own bend; the same play gives the same addresses on a
  second run; no `.dw-chair-creases` or `.dw-chair-crease-layer` is drawn, with one dent or three overlapping; the
  blend test keeps its two layers and their blends, reads `var(--dw-dent-img` in the `.dw-chair-dent` rule and no
  `radial-gradient` in the sheet, finds the shading `display: none` outside the `@supports` block, and keeps the
  forced-colors rule. Every other test stays and passes.

## Task 3. The browser

Model: sonnet

**Files:** `e2e/steel-chair.spec.ts`.

- `shading()` stops counting creases. In `theLineCanBeRead`, part (i) becomes: no crease element is in the content
  area. The test's name drops "no creases on overlapping dents". The darkness (ii) and contrast (iii) checks keep
  their bounds: one dent still takes the post to 0.50 at its darkest, overlapping dents still do not add, glyphs still
  keep 4.5:1. If one fails, find the cause before changing a bound, and a bound changed is the owner's question.
- The one-dark test reads the points from the gradient variables, which are gone. It compares instead, inside the
  dent's box, the plain post-colored pixels: the mean of the darkest tenth is darker than the bare picture's there,
  and the mean of the lightest tenth is lighter, by the margins it holds now.
- Run the whole spec in both projects. Put screenshots of the `one-light`, `one-dark` and `short-three` stories at
  rest in the PR, beside the mock, for the owner's eye.

## Review focus

- The dent must read as pressed in, never as a bump, for every play: the unit test pins the quadrants' mean, but only
  the stories show whether a lobe or crease on the lit side can flip it locally.
- Faint seams radiating from a dent's middle in `03-sheet.png` (the bowl's wobble meets at the center): the owner
  judges them on the stories.
- The glint over dark words on the light theme: bounded in area by test, judged by the owner on the stories.
- The bend normalized to its single steepest sample: a sharp crease or lobe sets the peak, which can leave the bowl
  itself bending the words less than today's dent did. Compare with the old dent on the long post.
- Plays already on a post (none deployed) get a new look from the same id; nothing stored changes.
- The cache: three `data:` images per play, 32 plays at most, made on the main thread when a run first draws a
  dent. On a thread of many dented posts, check the time spent per dent in a profile of the story.
- Safari and iPhone, where there is no bend: the shading alone must still read as a dent.
