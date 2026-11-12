# Gear as renders: a spike

Record, written 2026-11-12. The owner asked whether the Blender renders that made the cards' art and the Booster pack
would work for equippable Gear, and gave four pieces of Minus World art to try: glasses, a cigar and two mustaches.
Nothing here ships; the instance's Gear is still the placeholders in `instances/divided-world/ui/gear/`.

- `reference.png`: the owner's flat art, as given.
- `scene.py`: one script that builds and renders any of the four, with the cards' rig. From this folder, with Blender's
  Python module as `instances/divided-world/ui/cards/README.md` says, plus `scipy` and `shapely`:

  ```
  python scene.py glasses glasses.png
  ```

  The other names are `cigar`, `mustache-a` and `mustache-b`. `GEAR_PX` is the picture's width (1024) and
  `ART_SAMPLES` the samples (96). Each takes under a minute on four CPU cores.
- `glasses.png`, `cigar.png`, `mustache-a.png`, `mustache-b.png`: the renders, on a transparent ground.
- `bench.html` and `bench.png`: the renders beside the flat art, worn on a portrait at three sizes, and on a light
  ground.

## How each was made

- **Every piece** is seen straight on by an orthographic camera with a transparent film, so the picture is the piece
  and nothing else, and its edge is the renderer's own antialiased alpha.
- **The mustaches** are tubes of changing width laid flat (a spine with a radius at each point), raised into a height
  field with strands running along them. One function makes both from a list of spines.
- **The glasses** are a 2D outline (lens shapes, grown into rims, joined with a bridge and two wings) extruded with a
  rounded edge, with steel rivets and a lens that is clear but for a sheen.
- **The cigar** is turned about its length, with a painted spiral leaf, a band with a seal, lumpy ash and a glowing
  coal, and is turned 24 degrees so the lit end faces the viewer as it does in the flat art.

## What the spike found

- **It works.** Gear is a single object on a transparent ground, which is the easy case for this pipeline: no
  backdrop, no composition, and a render in under a minute against a card's three to eight.
- **The pieces hold their shape when worn small.** At 88 pixels of portrait the strands and the leaf are gone, and the
  outline and color still say what each piece is.
- **A render sits differently on a drawn portrait than flat art does.** It has its own light, from the upper left, and
  the portrait under it has another or none.
- **Rough in this draft:** the mustaches came out lighter and glossier than the flat art; the scalloped one's tufts
  read as beads; the glasses' lens sheen grays what is behind it a little; the handlebar's brow is flatter than the
  drawing's.
- **Not tried:** a piece that wraps a head (a hat), where a straight-on view may not be enough; a normal pass so the
  page's light could move across a piece as it does the pack.
