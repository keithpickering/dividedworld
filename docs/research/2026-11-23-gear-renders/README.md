# Gear as 3D renders, from more than one side: a proof of concept

Written 2026-11-23. It records one session's proof, at the owner's asking, that a piece of wardrobe gear modeled in
Blender can be rendered from several directions with the same light, so a player can pick which way it faces. It is a
record: nothing here is shipped. The design it led to is `docs/plans/2026-11-23-rendered-gear-design.md`.

## What is here

| File | What it is |
| --- | --- |
| `hat.blend` | The owner's cap, modeled by hand: one mesh (`Sphere.001`) with its brim toward +X, one point light, a flat gray world, Eevee and the AgX view. Its camera orbits about 35 degrees round the cap. Two hidden helper meshes are left as the owner made them. |
| `views.py` | The proof. It swings the camera and the light together about the dome's vertical axis until the camera looks straight at the brim, then turns the cap itself for each view. |
| `verify-original.png` | `hat.blend` rendered as the owner left it, at half size. |
| `verify-turned.png` | The same picture made the other way round: the rig swung to face the brim and the cap turned 35.5 degrees. |
| `sheet.png` | The five views (side and three-quarter both ways, and front), transparent and cropped to one shared frame, above each one worn at the same place on a placeholder portrait. |

## What it showed

- **Turning the item reproduces the orbiting camera.** `verify-turned.png` differs from `verify-original.png` by
  0.007 of 255 on average per channel, and by at most 1 on any pixel. The world is a flat color, the same from every
  direction, so only the camera and the point light had to move.
- **The light holds across views.** The rig never moves after it is swung, so the lit side of the dome is the same side
  of the picture in every view. A mirrored render would have moved the light to the other side.
- **The pivot is the dome's axis**, measured from the mesh (the center of its top half in plan, 0.044 along x). Turning
  about the object's origin would have swung the dome sideways between views.
- **One shared frame is wide.** The side views' brims set it, so the front view fills about 57% of its width. The
  design chose a tight crop for each view with its pivot recorded instead.

## To make it again

With Blender 4.5 installed:

```
blender -b hat.blend -P views.py -- <out-folder> verify 50
blender -b hat.blend -P views.py -- <out-folder> views
```

The first writes `verify-turned.png` at half size; render `hat.blend` itself at 50% for the original to compare. The
second writes the five transparent views at 1920 by 1080. The cropping and the sheet were done with Pillow in the
session and are not kept as scripts.
