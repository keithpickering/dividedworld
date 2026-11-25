# Rendered gear: a piece of gear rendered from several sides, and worn facing one

Record, written 2026-11-23. A design session made with the owner; each section was confirmed by the owner before the
plan was written. The plan is `docs/plans/2026-11-23-rendered-gear-plan.md`. It surveys the cosmetics design
(`docs/plans/2026-11-04-cosmetics-design.md`), the rendered card art design
(`docs/plans/2026-11-11-rendered-card-art-design.md`), the gear's code (`engine/rules/cosmetics.ts`,
`engine/ui/gear/Outfit.tsx`, `engine/ui/wardrobe/`, `supabase/migrations/0205_gear.sql`, `0206_trophies.sql`,
`0210_screen_cosmetics.sql`), Divided World's gear (`instances/divided-world/gear.ts`, `ui/cosmetics.ts`, `ui/gear/`),
and the day's proof of concept (`docs/research/2026-11-23-gear-renders/README.md`).

The owner, opening it: "Experimenting with 3D renders for wardrobe gear. Does this look like something we would be able
to automate, similar to card art? The style is a bit more refined/modern." And, on angles: "typically something like
Glasses should be front-facing ... whereas something like a Hat at 3/4 achieves the same thing ... one fun thing about
using renders is that there'd technically be nothing stopping us from including a few different directions of each
item: front, both sides, both 3/4 views. So that's worth considering if we can make it repeatable."

## 0. Where it starts

- **An item's art is one SVG**, `instances/divided-world/ui/gear/<key>.svg`, all five of them placeholders. The instance
  hands the engine each item's URL and its `aspect`, height over width, read from the viewBox (`InstanceUi.gear`,
  `engine/ui/types.ts`). Nothing checks a gear SVG: `tools/check-card-art.mjs` reads cards, packs and backs only.
- **A worn piece** is `Piece` (`engine/rules/cosmetics.ts`): `gear`, the center `x` and `y` as fractions of the
  portrait, the width `w` as a fraction of its width, `turn` in degrees, and `layer`. It is a row of `gear_worn`, saved
  whole by `set_outfit` and checked by `piece_problem` (0205), and read by `profile_projection` (0206),
  `profile_cosmetics` (0210) and the web's direct read of `gear_worn` (`web/src/data/supabase.ts`).
- **The box a piece takes** is worked out in three places, each from the center and the aspect: `touchesSquare`
  (`Outfit.tsx`), `outfitOverhang` (`cosmetics.ts`) and `hit` (`engine/ui/wardrobe/moves.ts`).
- **The proof of concept.** The owner's cap (`hat.blend`) was rendered from five sides by turning the cap inside a fixed
  camera and light. Turned to the owner's own angle it reproduced the owner's render to within 1 of 255 on every pixel.
  Its record is `docs/research/2026-11-23-gear-renders/`.

## 1. An item ships up to five views

**Decided** (the owner chose the recommendation): the engine names five views, `front`, `three-quarter-left`,
`three-quarter-right`, `side-left` and `side-right`, named for the way the item's front points in the picture. Each
item ships any of them, at least one, and names its default. Glasses might ship the front and the two three-quarters,
since glasses in profile are a line; a cap ships all five.

Weighed: the instance naming its own views with its own labels ("backwards" for a cap), which makes the picker's words
and their order instance copy, and leaves the engine unable to say what "left" means.

## 2. Each view is cropped tight and knows its pivot

**Decided** (the owner, over the recommended shared frame: "If we need to store any metadata we might as well revert
to Option 2 ... tight crop for the handles but consistent pivot point. It's just one extra value").

- Each view is cropped to the item's own outline, so the dress-up page's handles hug what the player sees.
- **The pivot** is one point on the item, the place a player sets it on a head: for a cap, the middle of its band. Each
  view records where the pivot lands in its own picture, in pixels.
- **A piece's `x` and `y` place the pivot** on the portrait, and `turn` rotates about it. An SVG item with one view puts
  its pivot at its center, which is today's rule, so the placeholders sit as they do now.
- **One scale per item.** Every view of an item is rendered at one scale, so a view's size in pixels is its true size.
  A piece's `w` is the width of its item's default view; every other view is drawn at its own width in proportion.
  Switching views keeps the item's size and keeps its pivot where it was. Only the picture changes.

Weighed: one shared frame for every view of an item (no data, nothing jumps, but the front view's handles enclose empty
space, the cap filling about 57% of the frame's width); a tight crop centered on itself (the dome jumps sideways on a
switch, and, with views of different widths, either the item grows or a scale must be recorded anyway).

## 3. The file: transparent WebP, at most 1024 px

**Decided** (the owner chose the recommendation of three):

- A rendered view is `<view>.webp`: still, with an alpha channel, at most 1024 pixels on its longest side, and at most
  200 KB. An item is scaled so its widest view is 1024 px on its longest side, which covers the largest draw (a piece
  1.5 times the width of the profile's portrait) on a twice-density screen.
- A drawn view is `<view>.svg`, held to the card guard's safety reading. The size `views.json` gives it is its viewBox's.
- **`views.json`** beside the files holds the default view and, for each view, its `width`, `height` and `pivot`
  (`x`, `y`), in the picture's own pixels. It is the one extra value the owner accepted, and it is written by the rig
  (section 4), never by hand, for a rendered item.

Weighed: 2048 px (sharp on a 3x screen, about three times the weight, on every postbit that shows the piece); 512 px
(soft on the dress-up page).

**The guard.** `tools/check-gear-art.mjs` holds every gear folder of every instance to this. Gear SVGs, unchecked until
now, get the card art's safety reading. The safety reading and the WebP header reading move out of
`tools/check-card-art.mjs` into one module both guards import, so there is one copy of each.

## 4. Where an item's picture comes from: a model and the gear rig

**Decided** (the owner chose the recommendation of three):

- An item's folder holds **`model.blend`**: the mesh and its materials, its front toward +X, and an empty named `pivot`
  at the pivot. Nothing else in it is read.
- **`instances/divided-world/ui/gear/rig.py`** owns everything else, rebuilt from nothing each run so every item is lit
  alike: Eevee, the AgX view, a 50 mm camera pitched 6 degrees down and looking along -X, the one point light where
  `hat.blend` had it relative to its camera, the flat gray world, and a transparent film. These are `hat.blend`'s
  settings, rebuilt with the camera straight ahead (the "refined/modern" look the owner asked for, unlike the cards'
  saturated Standard view). The rig appends the model, sets it so its pivot is at the origin, places the camera far
  enough back that the model's widest turn fits, and for each view the item ships turns the model about the vertical
  axis (0, plus or minus 35.5 for three-quarter, plus or minus 90 for side), renders, crops to the alpha, scales the item
  to its 1024 px, and writes `<view>.webp` and `views.json`.
- The views an item ships and its default are the rig's input, in the item's folder, read and written back by the rig
  into `views.json`.
- **The three-quarter angle is the owner's own**, 35.5 degrees, the angle `hat.blend`'s camera had.
- As with card art, nothing in the build holds a render to its model: a render cannot run in CI, and a re-render is not
  byte-identical. The instance's gear README says the files are what ship and the model is how to make them again.

Weighed: each item a whole scene with its own camera and lights (one item may be relit, but every item's light rests
on copying it by hand); each item a script that builds its mesh, as most cards do (diffable, but a cap modeled in Python
is slow and the owner models by hand).

## 5. What ships first

**Decided** (the owner chose the recommendation): `hat.blend` becomes the Baseball Cap's `model.blend`, with its pivot
added and the two hidden helper meshes removed, and the cap ships all five views with three-quarter-right as its default
(the owner's own render). The other four items stay placeholders, each moved into its own folder as `front.svg` with
its pivot at its center, until their models exist.

## 6. Wearing a view

- **`Piece` gains `view`**: one of the five, or null for the item's default. `gear_worn` gains a nullable `view`
  column, checked against the five names. `piece_problem` names a bad one; `set_outfit` writes it;
  `profile_projection`, `profile_cosmetics` and the web's read carry it; an instance's export carries it as it carries
  the rest of the row.
- **A view the item does not ship** (an item that dropped a view after it was worn) is drawn as the item's default. The
  dress-up page sets such a piece's view to null when it loads, so a saved outfit is never refused for it.
- **The server checks only the name.** Which views an item ships is the instance's art, which the database does not
  hold; a view outside the item's set does no harm, because it is drawn as the default. The dress-up page offers only
  the item's own views.
- **One geometry.** The box a placed piece takes, turned about its pivot, is worked out once in
  `engine/rules/cosmetics.ts` and used by `Outfit`, `outfitOverhang` and the dress-up page's `hit`, in place of the
  three center-and-aspect copies there now.

## 7. The dress-up page's Facing row

**Decided** (the owner chose the recommendation over two "Face left" and "Face right" buttons):

- The Selected panel gains a **Facing** row under Bigger, Smaller and the Turns: one small picture of each view the
  item ships, in the order side-left, three-quarter-left, front, three-quarter-right, side-right, the worn one marked.
  It is a radio group labeled "Facing", each option named in words ("Side, facing left", "Three-quarter, facing left",
  "Front", "Three-quarter, facing right", "Side, facing right"), moved along by the arrow keys. Choosing one says so in
  the page's live words, as the other moves do. An item with one view shows no row.
- It is the glass, in the dress-up page's own look: a settings screen, so it meets the forum's standards (contrast,
  focus, keyboard, labels).
- The wardrobe carousel and the Random Event dialog show each item's default view.

## 8. The rules

- **A response never proves a private fact.** An outfit is public by character once the mask has debuted, and a view is
  part of it. Nothing here reads an account's holdings in a new way.
- **No player is ever stuck.** No state is added: a view is changed or a piece taken off at any time, and a view an item
  stops shipping falls back to its default.
- **The layers.** The engine holds the five names, the `view` field and column, the geometry, the Facing row and the
  guard. The instance holds the models, the rig, the files and `views.json`, carried by `InstanceUi.gear`, whose type
  changes from one URL and an aspect to a default view and up to five views, each a URL, a width, a height and a pivot.
  The engine never learns which items an instance has.
- **At a busy instance's scale.** A postbit fetches only the view each piece is worn in, one file per item and view,
  cached across every mask. The dress-up page fetches the selected item's views, at most five. Art weight grows with
  items times views, at most 200 KB a file, never with players, threads or Acts.
- **Portable by construction.** The new column is a plain column in plain SQL, and the export round-trip test is
  extended to a piece worn in a named view.

## 9. Open

- **The cap's line**, "Worn backwards, as the ancients intended.", is the owner's copy and stays; the cap renders worn
  forwards, and no view is a back view.
- **A back view**, for a cap worn backwards, is not one of the five. Adding one later is a sixth name in the engine's
  list and in the column's check.
- **The other four items' models**, the Minus World gear, are the owner's to make. Each lands by the same steps.
