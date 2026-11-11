# Card art as 3D renders: a first exploration

Written 2026-11-11. It records one session's exploration, at the owner's asking, of 1990s-style 3D renders as card
art: what was rendered, with what, and how to render it again. It is a record: nothing here is shipped, and the cards
still show the vector art in `instances/divided-world/ui/cards/`.

## What is here

Three scenes, each a Python script that builds a Blender scene from nothing and renders it, and the image it gave:

| Card | Scene | Render | After |
| --- | --- | --- | --- |
| Whoops! | `whoops.py` | `whoops.png` | the card's placeholder `art.svg`, with the splat the game itself draws |
| Stick Around | `stick.py` | `stick-around.png` | Minus World's original icon: a pointer caught in a web, in a wood |
| Feelin' Fab | `fab.py` | `feelin-fab.png` | Minus World's original icon: a grinning cloud under a rainbow |

`rig.py` is what the three share: the scene reset, the Standard view transform (saturated, with no filmic roll-off,
which is most of the period look), materials, lights, the card's camera and the render call.

The scenes are the source. No `.blend` file is committed: each script rebuilds its scene in seconds, and the Whoops!
scene saved as a `.blend` is 75 MB. To get one to open in Blender, set `ART_BLEND` (below).

## Rendering one again

The scripts run on Blender's Python module, with no Blender install and no GPU:

```
python3 -m venv .venv
.venv/bin/pip install bpy==5.3.0 scipy
.venv/bin/python docs/research/2026-11-11-card-renders/fab.py out/feelin-fab.png
```

The last argument is where the image goes. These were made with Python 3.13, bpy 5.3.0 and Cycles on four CPU cores;
a full render took five to eight minutes and a draft under one.

Environment variables, all optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `ART_SCALE` | `2` | The image is 540 by 840, the card's canvas, times this. `1` for a draft. |
| `ART_SAMPLES` | `256` | Cycles samples. `40` is enough to judge a draft. The committed images used 256 (Whoops!) and 200. |
| `ART_BLEND` | unset | A path: the built scene is also saved there as a `.blend`. |
| `WHOOPS_SEED` | `7` | The seed of the main splat; the others are drawn from seeds beside it. |
| `WHOOPS_MESH` | `130` | Mesh points per world unit. The committed image used `170`; `90` for a draft. |
| `WHOOPS_TILT` | `9` | How far the camera leans off straight-on, in degrees. |
| `STICK_SEED` | `4` | The web's and the wood's random layout. |
| `STICK_FSTOP` | `0.22` | The background's blur: lower is blurrier. |

Every scene puts the card on a plane 5.4 wide by 8.4 tall, centered on the origin, so one unit is 100 px of the canvas
and a position can be read off the card template (`engine/ui/cards/card-template.svg`).

## Notes on each

**Whoops!** `whoops.py` carries a Python port of `makeSplat` and the metaball field from
`instances/divided-world/cards/whoops/splat.ts`, so the outline is the one a seed draws in play. The port is a copy
made on this date and nothing holds it to the game's: if the splat changes, this does not follow. The ink's height is
found by solving a Poisson equation inside the outline, which gives a half-round bead for a droplet or a run and a
flat pool with a rounded lip for the body. The runs down the wall are this scene's own; the live effect has none.

**Stick Around.** The trees are cylinders and spheres on purpose: the owner found the rudimentary wood right for the
period. Two strands are thrown over the pointer so it reads as held.

**Feelin' Fab.** The rainbow is six glossy pipes; the cloud is one ellipsoid for the face with lumps around its rim.

## What using these on cards would need

Card art is vector only today: `tools/check-card-art.mjs` refuses an `<image>` in `art.svg`, and the art README says
painted art waits on a later design. Shipping a render on a card is that design's to settle (the format, its size cap,
how a mark is drawn, and whether a scene script is part of a card's folder).
