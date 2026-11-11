# Rendered card art: a card's canvas may be a raster image

Record, written 2026-11-11. It surveys the card template design (`docs/plans/2026-11-05-card-template-design.md`), the
engine's art contract (`specs/card-art.md`), the art guard (`tools/check-card-art.mjs`), the card face
(`engine/ui/cards/Postcard.tsx`), Divided World's card art (`instances/divided-world/ui/cards/`), and the day's
exploration of 3D renders as card art (`docs/research/2026-11-11-card-renders/README.md`).

The owner, on seeing the renders under the card's own plates: "I would like to end up replacing the existing card art
with the ones from this session."

## 0. Where it starts

- **A card's art set** is a folder, `instances/<name>/ui/cards/<key>/`, holding `art.svg` (the canvas, viewBox
  `0 0 540 840`), `mark.svg` (a square emblem that reads at 18px) and `art.json` (credit and license).
  `tools/check-card-art.mjs` holds every folder to that, and refuses anything in an SVG that runs or fetches, `<image>`
  among them.
- **The card template design decided the required set is SVG**, and left raster to variants: "a variant's canvas may be
  SVG or a raster image at 1080 by 1680 (twice the canvas, enough for the largest size on a 2× screen) ... The raster
  rule is written here for the variant design to build." Nothing builds it yet. The instance's art README says "Art is
  vector only for now; painted art waits on a later design."
- **The face** draws the canvas as one `<img class="kb-postcard-art">` filling the canvas with `object-fit: cover`
  (`engine/ui/cards/postcard.css`), under the plates. `CardArt.canvas` (`engine/ui/cards/types.ts`) is a URL the bundler
  resolved; `instances/divided-world/ui/cards.ts` imports each card's `art.svg?url`.
- **The renders.** Fifteen card scenes and three of Minus World's spells were made on this date as Blender scenes, each
  a Python script that builds and renders its picture at 1080 by 1680. Ten are cards on main. The owner saw those ten on
  the real face at all four sizes (`docs/research/2026-11-11-card-renders/on-cards-sheet.png`), asked for the ones whose
  subject sat under the name plate to be recomposed, and then asked for the art to be replaced.

## 1. The required canvas may be raster

**Decided** (the owner's ask, above): a card's canvas is `art.svg` **or** `art.webp`, exactly one. This changes the card
template design's "the required set is SVG": the default art of a card may now be a raster image, not only a
variant's. The mark stays an SVG, for the reason that design gave (a raster mark is mud at 18px), and `art.json` is
unchanged.

Weighed: wrapping the render in an SVG `<image>` (the guard refuses `<image>` because an SVG that fetches is the thing
it exists to stop; a data URI inside one would be a megabyte of base64 in a text file); waiting for the variant design
(the owner wants the default art replaced, and a variant is by definition not the default).

## 2. The file: one WebP at 1080 by 1680

**Decided** (the owner chose the recommendation of three): `art.webp`, 1080 by 1680, one file per card.

- **Size.** The ten renders are about 2 MB each as PNG and 86 to 154 KB as WebP at quality 90, measured on five of them
  on this date. The cap is 400 KB, which leaves room for a busier picture and is checked.
- **One size serves all four.** The largest face is 276 CSS px wide, so 1080 px covers it on a 3× screen. A half-size
  copy for the three smaller sizes was offered (30 to 60 KB each) and declined: two files a card and a `srcset` in the
  engine, to save about 100 KB a card once.
- **Still, not moving.** An animated WebP is refused. A card's motion is the engine's (the shine, the foil), never its
  art file's.

Weighed: PNG (lossless, 20 MB for ten cards); AVIF (smaller again, but Blender does not write it, so every render
would need a second tool).

## 3. What the guard holds a raster canvas to

`tools/check-card-art.mjs` reads `art.webp` by its header alone; it decodes nothing. For every card folder:

1. Exactly one canvas: `art.svg` or `art.webp`. Neither, or both, is a fault that names the folder.
2. `art.webp` starts `RIFF`....`WEBP`, and its first chunk is `VP8 ` (lossy), `VP8L` (lossless) or `VP8X` (extended).
3. Its width and height, read from that chunk, are exactly 1080 and 1680.
4. It is not animated: a `VP8X` whose animation flag is set is refused.
5. It is at most 400 KB.
6. `art.svg`, where that is the canvas, is held to everything it is today. `mark.svg` and `art.json` are unchanged.

A WebP runs nothing and fetches nothing, so there is no safety reading as there is for an SVG. What the guard does not
catch: a file whose header is right and whose image data is corrupt (the browser draws nothing, and the card's name and
rules still say everything, since the art is decoration); and metadata chunks (EXIF, XMP) in an extended file, which are
inert in an `<img>`.

Other files in a card folder are not read, as today. That is what lets a scene script sit beside its art (section 5).

## 4. The face

The face needs no new piece: the `<img>` already draws any image the browser can. Two changes:

- `CardArt.canvas`'s words in `engine/ui/cards/types.ts` say what it may now be.
- The art `<img>` gains `decoding="async"`, so a 1080 by 1680 decode never holds up the frame a card is first drawn in.
  It stays eager: a card in a pack opening must not pop in late, and every art file is content-hashed by the bundler and
  cached.

The engine's ground and glow under the canvas are still drawn; an opaque render covers them, as a full-art SVG does.

**The plates over a render.** The owner looked at the ten at all four sizes. At the sheet and fan sizes the name plate
starts a little over half way down, so a picture's subject belongs in the upper half; seven scenes were recomposed for
that on this date, and Main Event lost a sign that said the card's name twice. The plates carry their own fill, so their
words do not depend on what is under them.

## 5. Where a scene lives

**Decided** (the owner chose the recommendation of two): each card's scene sits beside its art, as
`instances/divided-world/ui/cards/<key>/scene.py`, with the rig they share at
`instances/divided-world/ui/cards/rig.py`. Source beside output: to change a card's picture is to edit its scene and
render it again into the same folder.

- The scenes are **copies** of the ones in `docs/research/2026-11-11-card-renders/`, which stays as it is: a record of
  the exploration, with the scenes for cards not yet on main and the three spells. From this change on, the card
  folders' copies are the ones that are kept up.
- `rig.render` writes WebP when the path it is given ends `.webp` (Blender writes it itself, at the quality the rig
  sets), so one command makes a card's art: `python scene.py art.webp`, under Blender's Python module or the full
  build.
- **Nothing in the build holds a scene to its art.** A render cannot run in CI (it needs Blender and minutes of CPU),
  and a re-render is not byte-identical. So the relation is stated, in the instance's art README, and can drift: a scene
  edited and never rendered. The README says the art file is what ships and the scene is how to make it again. This is
  named here because CLAUDE.md's "Two lists that must agree are one list" says a stated relation drifts; the owner
  accepted it by choosing this layout, and section 8 lists it for the reviewer.

Weighed: leaving the scenes in the research folder (shipped art's source would live in a record, which is never
edited).

## 6. Credit and license

**Decided** (the owner chose the recommendation of three): every card's `art.json` stays as it is, crediting "Divided
World" under the project's own terms. The license is still the owner's to give when the repository has one.

## 7. The layers

- **Engine:** the guard and its self-test (`tools/`), `specs/card-art.md`, `CardArt.canvas`'s words, and the `<img>`'s
  `decoding`. The engine learns that a canvas may be raster; it never learns which instance's is.
- **Instance** (`instances/divided-world/`): ten `art.webp` files in place of ten `art.svg`, ten `scene.py`, one
  `rig.py`, the imports in `ui/cards.ts`, and the art README.

No page, payload, event or timing is added, so nothing here could be computed from a private fact. No state a player,
character or post can be put in is added.

**At a busy instance's scale.** Art weight grows with the number of cards in an instance, never with players, threads
or Acts. The Vending Machine shows every card on sale, so it fetches every canvas once: about 1.3 MB for ten cards
where the vector art was under 100 KB, then cached. A roster of fifty cards would be about 6 MB on that screen's first
visit. That is the cost the owner weighed when declining the half-size copy; if a roster grows to where it hurts, the
half-size copy and `loading="lazy"` on the machine's slots are the next step, and the guard's exact-size rule is where
that would be added.

## 8. Open

- **The five cards not on main** (Publicity Tour, Heat Magnet, Class Clown, Good Vibes, You Were Saying?) have renders
  and scenes in the research folder and no card folder on main. Each gets its `art.webp` and `scene.py` when its branch
  lands, by the same steps; that is each branch's change, not this one's.
- **Stick Around's mark** is a pin, after its placeholder art; its picture is now a pointer in a web. The other nine
  marks draw the card's effect and still fit. Whether to redraw that one mark is the owner's.
- **The license**, as before.
- **Variants** are still the variant design's. This change builds the raster rule that design wrote; a variant's canvas
  will be held to it by the same guard.
