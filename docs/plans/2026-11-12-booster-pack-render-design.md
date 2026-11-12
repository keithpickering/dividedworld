# A rendered pack under the page's light

Record, written 2026-11-12. A design session with the owner. It surveys the pack as the engine draws it
(`engine/ui/vending/PackArt.tsx`, `engine/ui/vending/pack.css`), where it is drawn (`engine/ui/vending/Vending.tsx`,
`engine/ui/vending/PackOpening.tsx`), what an instance gives for a pack (`InstanceUi.packs` in `engine/ui/types.ts`,
`instances/divided-world/ui/packs.ts`, `instances/divided-world/ui/packs/booster/`), the page's light
(`engine/ui/shine/loop.ts`, `engine/ui/shine/light.ts`), the art guard (`tools/check-card-art.mjs`), the art contract
(`specs/card-art.md`) and the rendered card art and card back designs
(`docs/plans/2026-11-11-rendered-card-art-design.md`, `docs/plans/2026-11-11-rendered-card-back-design.md`), which
this follows. The plan is `docs/plans/2026-11-12-booster-pack-render-plan.md`. The owner chose from an interactive
mockup, the bench (`docs/research/2026-11-12-booster-pack-bench/01-bench.html`). Where this design and the bench
disagree, this design wins on what is decided and the bench on how it looks and moves.

The owner: "Booster pack graphic is looking a bit lacking in detail next to the new blender renders for card art."

## 0. Where it starts

- **The Booster's art is a placeholder.** `instances/divided-world/ui/packs/booster/art.svg` is one four-color gradient,
  and says so in its comment.
- **The engine draws the rest.** `PackArt` lays the art as a background and clips it to ten zigzag teeth at each end;
  over it the stylesheet draws two seal lines, one fixed diagonal sheen, the instance's mark (the coin), the name on a
  dark plate, and the count ("5 cards"). `part="opened"` and `part="top"` cut the same wrapper along the engine's tear
  line, so any pack tears the same way.
- **It is drawn in two places:** a slot of the Vending Machine at 86px (zoomed with the slot), and the pack opening,
  whole and then as two torn parts, at 180px and up.
- **The page has a light.** The shine loop gives each registered canvas a light from the pointer, the scroll, the
  phone's tilt and a slow drift, pauses it out of view, and holds it at rest under reduced motion. Feelin' Fab's foil
  and Glitter Bomb's flakes are drawn by it.
- **The guard reads no pack folder.** `tools/check-card-art.mjs` reads cards and the card back.
- **No world is added.** The pack is a game piece on the glass's machine and opening screens; no screen or flow is new.

## 1. A render for the form, the page's light for the shine

**Decided** (the owner chose the recommendation of three): the pack's picture is a Blender render of the wrapper,
straight ahead and orthographic, lit evenly with no highlight of its own, and the highlight is drawn live by the
page's light.

Weighed: a render with its shine in the picture (matches the cards' detail, but the highlight never moves, and a
highlight that moves is how foil is told from a photo of foil); more drawn detail in the SVG with its gradient moved by
the light (lightest, sharp at any size, but flat beside the renders, which is the gap the owner named).

## 2. The highlight follows the film's shape

**Decided** (the owner, on the bench: "Wrinkle catching looks very nice"): the pack ships a second picture of the same
scene, its relief: which way each bit of film faces. The engine computes the highlight from it for each pixel, so the
light catches each pleat and the coin's rim as it moves.

Weighed: one picture and a soft band slid across it (no second file and no canvas, but the highlight ignores the
film's shape and reads as a glare laid on top).

**Decided** (the owner, on the first draft): the film is nearly pristine. "The effect is perfect but the pack looks a
bit like it went through a rock tumbler. A pack inside a machine would be relatively pristine." The scene keeps the
pleats the seals pull, the seals' ribs and the coin's emboss, and little else.

## 3. The picture's outline is the pack's

**Decided** (the owner chose the recommendation of two): a rendered pack is on a transparent ground, and that outline,
with its fine crimp teeth, is the pack's edge. The engine clips no zigzags over it. The engine still cuts its tear
line across the picture, so every pack tears the same way; the line falls just under the top seal. A pack with no
picture keeps today's clipped wrapper.

Weighed: the render filling the rectangle under the engine's ten teeth (one silhouette for every pack, but coarse
teeth cut across the render's fine ribs).

## 4. The name is in the render; the engine prints the count

**Decided** (the owner chose the recommendation of three): the render holds the coin and the pack's name as embossed
lettering, which the light catches. The engine prints only the count, where it sits today, in the instance's ink, with
the highlight passing over it. The count comes from the pack's rules (`pack.pulls.length`), so it stays true when the
rules change and the art does not. The scene leaves the count's band quiet.

Weighed: the engine printing name and count as ink (no lettering to model, but the name is flat ink and not part of
the foil); the render holding all three (most like a photographed pack, but a changed count means a new render, and
nothing can tell that the picture is out of date).

## 5. What an instance gives, and what holds it

The session's own; the owner confirmed the section.

A pack's folder, `instances/<name>/ui/packs/<key>/`, is a card's folder with one more file allowed:

- `art.svg` or `art.webp`, exactly one. An SVG is foil for the engine to crimp and print on, as today. A WebP is the
  whole pack, 1080 by 1680, on a transparent ground.
- `relief.webp`, optional and only beside an `art.webp`: the scene's normals in the camera's frame, 540 by 840, with
  the picture's outline as its alpha. Red is the normal's x, green its up, blue its lean toward the viewer, each from
  -1..1 into 0..1. Half the picture's size is enough: the highlight is soft, and it is what a draw's cost grows with.
- `mark.svg` and `art.json`, as a card's. The mark is drawn only on a pack with no picture.
- `scene.py`, where the picture is a render: how to make both files again, as a card's scene is.

`InstanceUi.packs[key].art` says which the engine is given: `canvas` (foil to print on) or `picture` (the whole pack),
and `relief` with a picture. The engine imports nothing of an instance; these are URLs the bundler resolved, as a
card's are.

`tools/check-card-art.mjs` reads each `instances/*/ui/packs/<key>/` as it reads a card's folder, and holds
`relief.webp` to its header: a still WebP of exactly 540 by 840, at most 200 KB, and never without an `art.webp`.

## 6. What the engine draws

The session's own; the owner confirmed the section.

- **With a picture**, `PackArt` draws the picture, contained in the pack's box and centered, the count over it, and,
  with a relief, one canvas over both. It draws no crimp, seal line, sheen, mark or name plate. The box keeps its size
  (a width and half as much again), so no layout moves.
- **The canvas holds only the light the highlight adds**, never the pack. The picture under it is an ordinary image, so
  a pack with no relief, a browser with no canvas, a relief that fails to load or cannot be read, and the moment before
  the relief has loaded all show the still pack, whole.
- **Without a picture**, `PackArt` is today's, to the pixel.
- **The torn parts.** `part="opened"` and `part="top"` clip the picture, the count and the canvas along the engine's
  tear line and nothing else. Each part lights only its own rows.
- **A sold-out slot** greys the whole pack by the filter it has today, the highlight with it.

## 7. The light

The session's own; the owner confirmed the section.

- The pack's canvas registers with the shine loop, so the pointer, the scroll, the phone's tilt, the idle drift, the
  pause out of view and the easing are the ones a shiny post has. Under reduced motion the light sits at rest and the
  highlight is drawn once, still.
- The highlight is the bench's: a tight glint and a broad soft one from the half vector of the light and the viewer
  against the film's normal, the light placed over the pack by the page's light. Its color is the bench's too: mostly
  white, a little of the foil's own color under it.
- A pack is a quiet host: it does not bring up the tip about tilting shiny posts, whose words are about posts.
- It is lit wherever `PackArt` draws a picture with a relief: the machine's slots and the opening.

**What it costs.** A draw touches the canvas's pixels: about 46,000 for a slot's pack at two device pixels to one, and
at most 540 by 840 (about 454,000) for the opening's, since the canvas never holds more pixels than the relief has. A
draw happens when the light moved or on the loop's idle cadence, only for a pack in view. The cost grows with packs on
screen, which the machine's slots and one opening bound, and never with players, characters, threads or Acts. The
relief is decoded once per address for the page and shared by every pack that shows it.

## 8. The rules it touches

- **No state is added** that a player, a character or a post can be put in, so there is no way out to name.
- **Nothing is computed from a private fact.** The picture and the relief are the same files for everyone, the light is
  computed in the viewer's browser from their own pointer, scroll and tilt, and nothing is sent.
- **Accessibility.** The pack stays decoration, hidden from a screen reader; the slot's own name says the pack, its
  price and its count. Reduced motion stills the highlight. No obstacle is added, so there is no accessible path to
  cost.
- **Portable.** Plain files and a canvas; no vendor is involved.

## 9. Open

- **The final picture is the owner's to approve.** The bench is a half-size draft with no name on it. The build
  renders the full picture and shows it in its PR; that PR waits on the owner's look at it.
- **The lettering's face.** The plan uses the glass's display face (Anton, in `instances/divided-world/ui/fonts/`). The
  owner may want a logo drawn for the pack instead; that would be new art, given later.
- **The loop off the main thread.** The foil's draw moved to a worker when it cost a busy scroll. The pack's draw is
  far smaller and stays on the page. If the machine's page is ever measured slow, the worker is where it goes.
