# Making a piece of gear's art for Divided World

A character wears gear on the portrait, and a player picks which way each piece faces. So an item is a few pictures of
one thing, not one picture. This is how to make them. The engine's side of it, with every number, is
`specs/gear-art.md`.

## What an item's folder holds

Each item has a folder, `instances/divided-world/ui/gear/<key>/`, holding:

- **a picture for each view the item ships**: `front`, `three-quarter-left`, `three-quarter-right`, `side-left` and
  `side-right`, each `<view>.webp` (a render) or `<view>.svg` (a drawing), never both for one view. At least one view,
  and a cap ships all five; glasses might ship only the front and the two three-quarters, since glasses in profile are
  a line.
- **`views.json`**, which names the item's default view and gives each view's width, height and pivot in pixels. For a
  rendered item the rig writes it; for a drawn one you write it by hand.
- **`model.blend`**, for an item that is rendered: the Blender model the pictures came from.
- **`rig.json`**, optional: an item's own camera pitch (see Seen from higher, below), and for a color variant of
  another item, which model it uses (see Color variants below), since a variant has no model of its own.

The **pivot** is the one point of the item a player sets on a head: for a cap, the middle of its band. A piece's
position places the pivot on the portrait, and turning the piece turns it about the pivot, so switching views keeps the
cap where the player put it.

## A rendered item

1. **Model it in Blender 4.5**, with its front toward +X. Real-world proportions do not matter: the rig measures the
   model and lights it in proportion. Only the mesh and its materials are read; anything else in the file is ignored by
   the rig, so delete the camera, the light, helper meshes and any object that is hidden in render before you save.
2. **Add an empty named `pivot`** where the item sits on a head: on the item's vertical axis (a cap's dome axis), at
   the height of its band. The rig turns the item about the vertical axis through this point.
3. **Save it as `model.blend`** in the item's folder. The repository ignores `.blend` files except
   `ui/gear/<key>/model.blend`.
4. **Run the rig**, from `instances/divided-world/ui/gear/`:

   ```
   blender -b -P rig.py -- baseball-cap --views front,three-quarter-right,three-quarter-left,side-right,side-left --default three-quarter-right
   ```

   `--views` and `--default` are needed only the first time: afterward the rig reads them from the item's `views.json`.
   It needs Blender 4.5 and nothing else (it uses Blender's own Python and numpy). Eevee renders on the CPU in about a
   minute per view when there is no GPU.
5. **Look at the pictures**, then commit the model, the `.webp` files and `views.json` together.

The rig builds its scene from nothing each time, so every item is lit alike: Eevee with the AgX view, a flat gray
world, one point light and a 50 mm camera pitched 6 degrees down, placed as the owner's cap scene had them and scaled to
the item's size. The numbers and where they came from are in `rig.py`'s header. For each view it turns the item about
its vertical axis (0 degrees for the front, 35.5 for a three-quarter and 90 for a side), renders at 2048 pixels,
crops each view to its outline, scales all of an item's views by one factor so the largest is 1024 pixels on its longest
side, and writes the WebP (quality 90) and `views.json`. The research it came from, with the proof that turning the
item reproduces an orbiting camera, is `docs/research/2026-11-23-gear-renders/README.md`.

### Seen from higher

The camera's 6 degrees suits a cap, whose shape is its sides. An item whose top is what reads, such as a top hat, can
give its own pitch in a `rig.json` in its folder:

```json
{ "pitch": 25 }
```

`pitch` is how far below the horizon the camera looks, from 0 to 60 degrees. The rig swings the camera up round the
horizontal axis through the pivot, and nothing else: the light stays where it is, so the item is lit as every other
item is and its top catches more of the light. A color variant takes its base item's pitch unless its own `rig.json`
gives one. Every item worn on one portrait is seen from its own height, so keep a pitch for an item that needs it.

**The files are what ship; the model is how to make them again.** Nothing in the build renders a model or compares it
with its pictures, because a render needs Blender and minutes of CPU, and two renders of one model are not the same
bytes. So a change to a model is finished only when the item is rendered again and both are committed together. The
guard, `tools/check-gear-art.mjs`, reads the pictures and `views.json` and never the model.

## Color variants

A color of an item is its own item, a folder of its own with its own key (`baseball-cap-green`), its own `views.json`
and its own pictures, so a character wears one and the engine knows nothing about colors. It has **no `model.blend`**:
it has a `rig.json`,

```json
{ "model": "baseball-cap", "hue": 120, "recolor": ["hat"] }
```

where `model` is the key of the item whose model it uses, `hue` is the turn in degrees, and `recolor` names the objects
in that model to recolor. The rig loads the base item's model, turns the hue of every color stop of every Color Ramp
node in the materials of those objects (HSV hue; saturation and value are kept unless the lift below is given), and renders the same views the base
ships, with the same default. A material the named objects share with another object turns with it: the Baseball Cap's
button shares the hat's material and turns with it, and the Plumber's Cap's emblem has its own material and does not.
Run it as for any item, after the base has been rendered (the variant takes its views from the base's `views.json`):

```
blender -b -P rig.py -- baseball-cap-green
```

A plain hue turn keeps every stop's lightness, so a color whose stops are dark reads dull at some hues (a yellow made
from a red ramp reads mustard). Two optional fields lift the recolored stops toward 1: `"value": f` and `"saturation": f`,
each from 0 (no lift, the default) to 1, make a stop's HSV value v (or saturation s) become `1 - (1 - v) * (1 - f)`. The
lift keeps the order of the stops, so a dark stop stays darker than a light one and the shading is kept. The yellow caps
use it: `{ "model": "baseball-cap", "hue": 55, "value": 0.9, "saturation": 1, "recolor": ["hat"] }`. If a color looks
wrong, change `hue`, `value` or `saturation` and render again rather than touching the model.

## A drawn item

An item that is not modeled yet is a drawing: one `front.svg` and a `views.json` you write by hand,

```json
{ "default": "front", "views": { "front": { "width": 200, "height": 120, "pivot": { "x": 100, "y": 60 } } } }
```

where `width` and `height` are the SVG's viewBox and the pivot is at its center unless the item has a better place to
sit. An SVG is held to the card art's safety reading: nothing in it runs or reaches out.

## The items here

`baseball-cap` and `plumbers-cap` are the owner's models, each beside its pictures, and each has four color variants:
green, blue, yellow and purple. `nostalgic-hat` (a top hat with a sprig of mistletoe) was modeled in a session from the
owner's sprite and finished by the owner, who placed the sprig and redrew the berries; it ships all five views with
`three-quarter-left` as its default, the side its sprig is on, seen from a pitch of 25 degrees. The other items are drawings until their models exist.
