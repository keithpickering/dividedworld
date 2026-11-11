# Card art as 3D renders: a first exploration

Written 2026-11-11. It records one session's exploration, at the owner's asking, of 1990s-style 3D renders as card
art: what was rendered, with what, and how to render it again. It is a record: nothing here is shipped, and the cards
still show the vector art in `instances/divided-world/ui/cards/`.

## What is here

Fifteen scenes, each a Python script that builds a Blender scene from nothing and renders it, and the image it gave.
Ten are the roster on this date; four are the cards the card types design adds
(`docs/plans/2026-11-11-card-types-design.md`, on the branch `ccr-6e9dbc56-yk0hx6`); one is You Were Saying?
(`docs/plans/2026-11-07-you-were-saying-design.md`, on the branch `ccr-2060b266-6z9hps`). Neither branch was on main
when this was written:

| Card | Scene | Render | After |
| --- | --- | --- | --- |
| Whoops! | `whoops.py` | `whoops.png` | the card's placeholder `art.svg`, with the splat the game itself draws |
| Stick Around | `stick.py` | `stick-around.png` | Minus World's original icon: a pointer caught in a web, in a wood |
| Feelin' Fab | `fab.py` | `feelin-fab.png` | Minus World's original icon: a grinning cloud under a rainbow |
| Autocorrect | `autocorrect.py` | `autocorrect.png` | the placeholder `art.svg`: label tape over a post's words |
| Bluff | `bluff.py` | `bluff.png` | the placeholder `art.svg`: a card held face down, in smoke |
| Force Field | `force.py` | `force-field.png` | the placeholder `art.svg`: a dome of light, a card bouncing off |
| Glitter Bomb | `glitter.py` | `glitter-bomb.png` | the placeholder `art.svg`: an envelope going off |
| Hall Pass | `pass.py` | `hall-pass.png` | the placeholder `art.svg`: a pass on a lanyard, held up to a Mod Bot |
| Main Event | `main.py` | `main-event.png` | the placeholder `art.svg`: a title belt under the house lights |
| Trap Card | `trap.py` | `trap-card.png` | the placeholder `art.svg`: a trap with a card for bait |
| Publicity Tour | `tour.py` | `publicity-tour.png` | the owner's idea: a red carpet as its walker sees it, flashbulbs in the dark |
| Heat Magnet | `heat.py` | `heat-magnet.png` | the owner's idea: a big magnet on fire, in the dark |
| Class Clown | `clown.py` | `class-clown.png` | the owner's idea: a wig, a nose and a horn, floating on many colors |
| Good Vibes | `vibes.py` | `good-vibes.png` | this session's: a lava lamp, and a salt shaker with its surcharge on a tag |
| You Were Saying? | `saying.py` | `you-were-saying.png` | this session's: an old beige computer going on with a post in green |

Three more are not cards of this game. The owner sent three of Minus World's spell icons to see them in the same
style, and then each icon's name and alt text, which the scenes were revised from:

| Spell | Scene | Render | The icon's alt text |
| --- | --- | --- | --- |
| Overreaction | `overreaction.py` | `overreaction.png` | "A Godzilla sized :^) emoji sits in the midst of a destroyed metropolis. It has unknowingly tipped skyscrapers with its immense size. Smoke from the leveled buildings sits behind it." |
| Hot Box | `hotbox.py` | `hot-box.png` | "a stoned emoji with bloodshot eyes sits among puffy clouds." |
| Whodunnit | `whodunnit.py` | `whodunnit.png` | "a generic anonymous detective lurks stealthily against a brick wall in the dead of a rainy night." |

`rig.py` is what they all share: the scene reset, the Standard view transform (saturated, with no filmic roll-off,
which is most of the period look), materials, lights, the card's camera, the render call, and the small shapes the scenes are built from (tubes, slabs,
rounded outlines, stars, raised letters, turned shapes, blocks).

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
| `ART_SAMPLES` | `256` | Cycles samples. `40` is enough to judge a draft. The committed images used 256 (Whoops!) and 200 (the rest). |
| `ART_BLEND` | unset | A path: the built scene is also saved there as a `.blend`. |
| `WHOOPS_SEED` | `7` | The seed of the main splat; the others are drawn from seeds beside it. |
| `WHOOPS_MESH` | `130` | Mesh points per world unit. The committed image used `170`; `90` for a draft. |
| `WHOOPS_TILT` | `9` | How far the camera leans off straight-on, in degrees. |
| `STICK_SEED` | `4` | The web's and the wood's random layout. |
| `STICK_FSTOP` | `0.22` | The background's blur: lower is blurrier. |
| `BLUFF_SEED` | `5` | Where the smoke's balls sit. |
| `GLITTER_SEED` | `11` | Where the glitter has got to. |
| `AUTOCORRECT_SEED` | `2` | The lengths of the post's words. |
| `TOUR_SEED` | `8` | Where the crowd stands and whose cameras flash. |
| `HEAT_SEED` | `6` | How the flames sway, and the embers. |
| `HEAT_STYLE` | `tongues` | `tongues` is flat cartoon fire; `volume` is soft fire shaped by noise; `fluid` is simulated fire. The last two are far slower. |
| `HEAT_CACHE`, `HEAT_RES`, `HEAT_FRAMES` | none, `64`, `60` | For `fluid` only: an empty folder the simulation bakes into (required), its resolution, and how many frames it runs before the picture is taken. |
| `HEAT_FIRE` | `1.0` | The fire's brightness, either style. |
| `CLOWN_SEED` | `9` | The wig's curls and the confetti. |
| `CLOWN_TWIST` | `0.5` | How tightly the backdrop's vortex winds: 0 is straight rays, over 1 is nearly rings. |
| `CLOWN_EYE_X`, `CLOWN_EYE_Z` | `0.9`, `2.7` | Where the vortex's eye is on the card. |
| `VIBES_SEED` | `4` | The soft lights in the room and the spilled salt. |
| `SAYING_SEED` | `3` | The lengths of the words on the screen and past it. |
| `OVERREACTION_SEED` | `5` | The smoke, the rubble, and which windows are lit. |
| `HAZY_SEED` | `7` | Hot Box: where the smoke's balls sit. |
| `WHODUNNIT_SEED` | `2` | Which bricks are missing or pale, and the rain. |

Every scene but Whoops! puts the card on the xz plane, 5.4 wide by 8.4 tall and centered on the origin, with the
camera looking along +y, so one unit is 100 px of the canvas and a position can be read off the card template
(`engine/ui/cards/card-template.svg`). Whoops! lies on the xy plane with its camera above it. A scene with a floor
raises its camera a few degrees (`rig.camera`'s `elev`), which moves things a little off those positions.

## Notes on each

**Whoops!** `whoops.py` carries a Python port of `makeSplat` and the metaball field from
`instances/divided-world/cards/whoops/splat.ts`, so the outline is the one a seed draws in play. The port is a copy
made on this date and nothing holds it to the game's: if the splat changes, this does not follow. The ink's height is
found by solving a Poisson equation inside the outline, which gives a half-round bead for a droplet or a run and a
flat pool with a rounded lip for the body. The runs down the wall are this scene's own; the live effect has none.

**Stick Around.** The trees are cylinders and spheres on purpose: the owner found the rudimentary wood right for the
period. Two strands are thrown over the pointer so it reads as held.

**Feelin' Fab.** The rainbow is six glossy pipes; the cloud is one ellipsoid for the face with lumps around its rim.

**The other seven** were made in one pass after the owner approved the first three, each from its placeholder
`art.svg`, in its alignment's color: orange for Pepperoni, cyan for Sweet, pink for Salty. They had two or three
drafts each and no review by the owner on this date. Bluff, Hall Pass and Trap Card are face-down cards in play; the
art here is the card's own face, as its placeholder's is.

**The four new cards** had the same two or three drafts and no review. Publicity Tour is the one scene with real depth:
its camera stands on the carpet with a 28 mm lens, so nothing in it sits at card positions. Heat Magnet's flames are
flat tongues drawn three deep, the cartoon fire of the period. Good Vibes had no idea
from the owner: the card makes Salty Moves cost 0.25 orbs more in a thread, so the scene is a calm thing sending rings
out across a floor and a salt shaker at their edge with "+0.25" on a tag. The figure on the tag is the design's on
this date and is part of the picture: if the price changes, the tag is wrong.

**Two were changed the same day, on the owner's notes.** Class Clown's backdrop was straight rays; it is now a vortex
after the owner's own Feelin' Fab swirl, a twist in the backdrop's shader, and the kit is lit harder and edged from
behind so it stands off it. Heat Magnet's first fire was pure light at strengths well over white, which blew the
picture out; the tongues are now graded up their length and held under white (`heat-magnet.png`). The owner also asked
after later-style fire from a fluid simulation. The fluid solver fails inside the `bpy` module (its own scripts raise errors and the process aborts), so
`HEAT_STYLE=volume` was made first: columns of light in a volume, shaped by noise and not simulated
(`heat-magnet-volume.png`, at 64 samples), which the owner liked. The owner then allowed the full Blender build to be
fetched, where the solver works, and `HEAT_STYLE=fluid` is that: a real simulation, baked and then rendered
(`heat-magnet-fluid.png`). Its settings are the owner's pick of the tests: a wall of flame, over white in its heart,
which this session had first tuned away from as overexposed. The owner: "it's pretty much what I want." It runs only under the full build:

```
HEAT_STYLE=fluid HEAT_CACHE=/some/empty/folder blender -b -P docs/research/2026-11-11-card-renders/heat.py -- out/heat-magnet-fluid.png
```

Every other scene runs under either. The full build is Blender 5.3.0 for Linux from download.blender.org.

**You Were Saying?** The old voice is drawn as an old beige computer. On its screen a post starts in amber, the
author's, and goes on in green with a block cursor, the colors the card's design gives the tail in play (Courier with
a green tint); the green then runs off the glass and out into the room, the design's "terminal bleed".

## The renders on the card face

The owner asked to see the renders under the card's own plates and words. `on-cards-sheet.png` is the ten cards on
main at the sheet size (276 px wide), and `on-cards-small.png` the same ten at the fan, phone and slot sizes. The
frame, plates, words and sizes are the engine's `Postcard`, drawn by its own story; only each picture is swapped, in
the page, so nothing in the game was changed to make them. The five cards on other branches and the three spells have
no face on this branch and are not in them.

To make them again, with Storybook running (`npm run storybook`):

```
mkdir -p out/faces
node docs/research/2026-11-11-card-renders/mockup.cjs out/faces
python3 docs/research/2026-11-11-card-renders/mockup-sheets.py out/faces out/on-cards-sheet.png out/on-cards-small.png
```

The second step needs Pillow. What they show, on this date:

- At the sheet and fan sizes the name plate starts a little over half way down, so only the upper half of a render is
  seen. Stick Around, Trap Card, Force Field, Main Event and Autocorrect keep their subject clear of it.
- Feelin' Fab loses its sun and hills at those sizes, Whoops! its runs, Bluff its gloved hand, Glitter Bomb the lower
  half of its envelope, and Hall Pass the lower half of its pass. Each still reads; the lower part shows only at the
  phone and slot sizes, where the plate is a strip at the foot.
- The gem in the top right corner sits over Force Field's sky near its bouncing card and over Hall Pass's lanyard.
- Main Event's sign says the card's name, which the plate then says again.
- Trap Card's trap is small in its frame at every size.

**After the owner saw the sheets**, seven scenes were recomposed so their subject sits above the name plate: Whoops!
(the splat higher and smaller, so its runs end above the plate), Bluff, Glitter Bomb and Hall Pass (raised), Main
Event (its sign removed, the belt larger and higher), Trap Card (the camera closer), and Feelin' Fab, which the owner
also asked to see from below and at a truer sunset: its camera now stands low in the grass looking up at the cloud,
with a banded sunset sky, the sun going down behind far hills, and daisies on a near one. The two sheets here were made
before that and show the first compositions.

**The art then shipped** (`docs/plans/2026-11-11-rendered-card-art-design.md`): each of the ten cards' scenes was copied
beside its art as `scene.py`, and its picture rendered from there as `art.webp`. `shipped-cards-sheet.png` and
`shipped-cards-small.png` are the engine's own Postcard story with that art, nothing swapped, at the four sizes. From
that change on, the copies in the card folders are the ones kept up, and the scenes here are the record of this day.

While that change was open, main deleted Bluff, renamed Trap Card to Card Collector and gained Publicity Tour, Heat
Magnet, Class Clown and Good Vibes. So the sheets show thirteen cards: Bluff's picture ships nowhere, the trap is Card
Collector's, and the four new cards wear their renders too (Good Vibes and Class Clown pulled back so their subjects
clear the name plate, Heat Magnet as the simulated fire). Measured on the sheet-size faces, white rules text against
the plate's own ground is 8.8 to 1 at the median on Heat Magnet, the brightest picture, and 13 to 1 or better on the
rest.

## What using these on cards would need

Card art is vector only today: `tools/check-card-art.mjs` refuses an `<image>` in `art.svg`, and the art README says
painted art waits on a later design. Shipping a render on a card is that design's to settle (the format, its size cap,
how a mark is drawn, and whether a scene script is part of a card's folder).
