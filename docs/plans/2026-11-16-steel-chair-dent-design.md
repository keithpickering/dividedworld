Record, written 2026-11-16.

# Steel Chair's dent, in relief: design

A design session with the owner, started from a screenshot of a dented post and a photo of dented sheet metal the
owner gave as the target: "irregular, soft edges, maybe even use the light/shine layer to make it look more 3D". The
mock the owner approved ("looks perfect") is `docs/research/2026-11-16-steel-chair-dent/01-mock.png`, drawn by
`01-mock.py` beside it. Its plan is `docs/plans/2026-11-16-steel-chair-dent-plan.md`. It changes what
`docs/plans/2026-11-15-steel-chair-plan.md` Task 4 built for the dent and nothing else of the card.

## 1. Why the dent reads as a ball

Read on `main` at `0cea681d`:

- **The light is turned at random.** Each dent's shade and light are radial gradients placed opposite each other at
  an angle from its play's id (`dentShape(...).turn`, `--dark-x` and the rest in `Effect.tsx`). A reader takes light
  to come from above. A hollow lit from above is dark on its upper inner wall and bright on its lower; a bump is the
  reverse. With a random turn about half the dents are lit as bumps, and the owner's screenshot is one.
- **The edge is hard.** The gradient is cut by an uneven `border-radius` before it has faded, so an ellipse's outline
  shows. Dented metal has none.
- **The bend and the shading disagree.** The bend is one round map (`dentMap`) stretched to the dent's box; the
  shading is drawn separately and turned. They cannot describe the same surface.

## 2. One height map per dent (decided)

Each dent is a field of heights, from which everything drawn is derived, so the bend and the shading always agree.

- **Seeded from the play's id alone**, as the shape is today: the same for every reader and replay; where the dent
  lands stays the run's.
- **The recipe is the mock's**: a bowl whose radius wobbles around its edge (three angular waves); two to four
  smaller knuckle lobes inside it; one soft trough where the seat's edge struck, at the play's angle; a low raised lip
  just outside the bowl; faint crumple, fading to nothing toward the rim. The height is windowed to zero before the
  box's edge, so no outline can show.
- **The box is today's.** `dentPrimitives` (at most 160 px, at most 60% of the post's width, axes within 15% of
  round), `hitZone` and `dentsOverlap` are unchanged. The map is generated at the box's own width and height, not
  stretched from a circle.

## 3. Three images from the map (decided)

- **The bend**: the map's slope as red and green, scaled so its strongest channel offset is today's (about 74 of 127
  at `DENT_SCALE` 14), so no word bends further than it does now. The words still sink toward the middle. Each dent's
  `feImage` takes its own play's bend; the growth over 90 ms and the arithmetic sum of overlapping dents are as built.
- **The shade**: gray, multiplied, from one fixed light from the upper left. Its darkest pixel is exactly 128 (the
  post at 50%, today's cap), and white wherever the metal is flat.
- **The light**: gray, screened. Soft light at most 71 (28%, today's cap). A specular glint may reach 140 (55%), on
  at most 4% of the dent's footprint, so it can cover a letter or two and never a word.
- Drawn at a density of at most 2 (at most 320 by 320 px), through one canvas helper, kept as `data:` addresses
  (allowed by `web/headers.ts` `img-src`) in a cache of at most 32 plays.

## 4. Choices weighed

- **Overlap: per dent (the owner's pick)** against one height map for the whole post. The owner asked whether the
  effect-tiles work (`docs/plans/2026-11-16-effect-tiles-design.md`) changes the answer; it does, toward per dent. A
  post-wide map is a canvas the size of the post, which that design's guard (`tools/check-effect-canvas.mjs`) keeps
  off every effect outside the tiled layer, and the word-bending filter reads its map from one image address, which
  tiles held only near the view cannot give. Per dent, the images are a dent's size whatever the post's length, the
  kind of small canvas that check's list allows (`dent.ts` is on it today). Overlapping shading stays capped as built:
  `darken` among the shades, `lighten` among the lights.
- **Light: fixed upper left (the owner's pick)** against a light jittered within the upper arc per play. One light
  makes every dent read as pressed in; variety comes from each dent's shape.
- **Creases: baked into the metal (the owner's pick)** against none, or keeping the two CSS lines. Every dent gets
  the seat-edge trough in its height map, shaded and bending the words like the rest. The crease layer and the rule
  that only a lone dent has creases go.
- **Strength: the mock's glint, kept small (the owner's pick)** against today's 28% cap on all light.

## 5. The rules

- **Layers.** Instance only: `instances/divided-world/ui/steel-chair/`, `e2e/steel-chair.spec.ts`, and one line of
  `tools/check-effect-canvas.mjs`. No engine file, no migration.
- **Private facts.** The map is computed from the play's id, which is public. No response, payload, Realtime event or
  timing is added.
- **States.** None is added; the dent's way out (it ends with its play, 3 days) is unchanged.
- **An effect fills the post.** Unchanged: the shading layers fill the content area; each dent is placed in it as
  today. The dent marks a point, it does not fill the box.
- **Accessibility.** The dent hides nothing; the words stay readable and selectable. The shade's cap is today's and
  the glint's is the owner's, bounded in area. Forced colors still hides the shading and keeps the bend. Reduced motion
  and a moment still draw each dent at full depth at once.
- **Scale.** Three images per live play, at most three plays a post, made once per play and cached; the cost is a
  dent's pixels, not the post's, the thread's or the instance's.
- **Safari.** Where `filterTrusted()` is false there is no bend, and the shading is the whole dent; it gains the most.

## 6. Open

- **The recipe's numbers** (bowl size, lobe depths, the relief that sets how steep the walls look, the glint's
  sharpness) are the mock's starting values. The owner judges them on the stories in review.
- **A glint over dark words on the light theme** washes out a letter or two under it; the owner accepted that for the
  metal's look. The e2e contrast checks measure the darkest glyph, so they do not see it; the owner looks.
