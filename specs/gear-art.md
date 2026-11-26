# Gear art: the engine's contract

Current. This is what the engine holds a piece of gear's art to; the build enforces it with `tools/check-gear-art.mjs`,
whose self-test is `tools/test-gear-art.mjs`. The design behind it is `docs/plans/2026-11-23-rendered-gear-design.md`, a
record. The instance's guide to making the art is `instances/divided-world/ui/gear/README.md`.

## An art set

Every item of gear has an art set, one folder per item in an instance: `instances/<name>/ui/gear/<key>/`, where the key
is the item's in the rules. A plain file directly in `ui/gear/` (a README, the rig) is not a folder and the guard does
not read it, and neither does it read a folder there whose name could not be an item's key (lowercase words joined by
hyphens), such as the `__pycache__` Python leaves: that is a tool's leavings, not an item. The old layout, one flat
`ui/gear/<key>.svg`, is a fault.

- **`views.json`**, required: the item's default view and its views.
- **One picture for each view it lists**, `<view>.webp` or `<view>.svg`, exactly one of the two, and no other picture.
- Any other file in the folder (`model.blend`, `rig.json`) is the instance's, not a picture, and is not read.

An item is any folder with these, whether it was modeled, drawn, or made from another item's model in another color: a
color variant is its own item with its own key, its own `views.json` and its own pictures, and the engine does not know
which items are variants of which.

## The five views

The engine names five views, for the way the item's front points in the picture, in the order the dress-up page's Facing
row lists them (`GEAR_VIEWS` in `engine/rules/cosmetics.ts`):

| View | The item's front points |
| --- | --- |
| `side-left` | to the viewer's left, in profile |
| `three-quarter-left` | to the left, turned toward the viewer |
| `front` | at the viewer |
| `three-quarter-right` | to the right, turned toward the viewer |
| `side-right` | to the right, in profile |

An item ships any of them, at least one, and names one as its default. A piece may be worn in any of the five; a view the
item does not ship is drawn as the item's default, everywhere.

## `views.json`

```json
{
  "default": "three-quarter-right",
  "views": {
    "front": { "width": 1024, "height": 725, "pivot": { "x": 512, "y": 594 } },
    "three-quarter-right": { "width": 1000, "height": 700, "pivot": { "x": 480, "y": 560 } }
  }
}
```

- `default` is one of the `views`' keys.
- Each key of `views` is one of the five. Each view has `width` and `height`, whole numbers above 0, in pixels: the
  picture's own size (a WebP's, or an SVG's viewBox).
- `pivot` is `x` and `y`, numbers from 0 to `width` and from 0 to `height`: where the item sits on a head, in the
  picture's pixels, from its top left corner.
- At most 2 KB.

## What `x`, `y`, `w` and `turn` mean against the pivot

A worn piece (`Piece`, `engine/rules/cosmetics.ts`) places the pivot, not the center:

- `x` and `y` are where the pivot lands on the portrait, as fractions of its width and height.
- `w` is the width of the item's default view as a fraction of the portrait's width. An item has one scale: every other
  view is drawn at its own width in proportion (`w` times its width over the default view's), so switching views keeps the
  item's size and keeps the pivot where it was. Only the picture changes.
- `turn` is in degrees, clockwise, and turns the picture about the pivot.
- A drawn item with one view puts its pivot at its center, so it sits where a center-placed piece did.

`pieceExtent` and `pieceHolds` in `engine/rules/cosmetics.ts` are the one home of this geometry.

## The pictures

- A **WebP** (`<view>.webp`) is a rendered view: a still image with an alpha channel, transparent around the item, at
  most 1024 pixels on its longest side, at most 200 KB, and exactly the `width` and `height` `views.json` gives it.
  An item is scaled so that the longest side of its largest view is 1024. The guard reads its header and its length and
  decodes nothing, as for a card.
- An **SVG** (`<view>.svg`) is a drawn view: its root viewBox has the `width` and `height` `views.json` gives (its origin
  is free), it is at most 50 KB, and it passes the card art's safety reading (`safetyFaults` in
  `tools/art-files.mjs`): nothing in it runs or reaches out.

## What `tools/check-gear-art.mjs` holds

Run `node tools/check-gear-art.mjs [--root <directory>]`. For every item folder of every instance:

1. `views.json` is there, parses to an object, and has at least one view, each a key of the five; its `default` is one
   of them.
2. Each listed view has exactly one picture, and no picture is there for a view not listed.
3. Each view's `width` and `height` are whole numbers above 0 and its pivot is inside its picture.
4. Each WebP matches its `views.json` size, is at most 1024 on its longest side, has an alpha channel, is not animated
   and is at most 200 KB. Each SVG matches its viewBox and the safety reading, at most 50 KB.
5. A flat `ui/gear/<key>.svg` is a fault.

The guard does not read a model, a `rig.json` or the rig: a render is not compared with its model, because a render
needs Blender and two renders are not the same bytes. The art files are what ship.

## The rig and the models

An instance's rendered items are made by its rig, `instances/divided-world/ui/gear/rig.py`, from a `model.blend` in the
item's folder: the engine does not run it and does not know it. A model faces +X and has an empty named `pivot`. The
rig's output is `views.json` and the WebP files, and the engine reads only those.
