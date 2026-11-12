# The Booster pack bench

Record, written 2026-11-12. It is the mockup the owner chose from in the design session that became
`docs/plans/2026-11-12-booster-pack-render-design.md`. Nothing here ships.

- `01-bench.html`: today's pack (redrawn from `engine/ui/vending/pack.css` as it stood), the draft render as a still,
  and the draft render under a light that follows the pointer and the scroll, each at the opening's 180px and the
  machine's 86px. Both pictures are inside the file. Its light is the page's own small loop, not the engine's.
- `scene.py`: the draft scene, with the cards' rig. From this folder, with Blender's Python module as
  `instances/divided-world/ui/cards/README.md` says:

  ```
  ART_SCALE=1 ART_SAMPLES=64 python scene.py base.webp
  PASS=normal ART_SCALE=1 python scene.py normal.webp
  ```

  The first is the pack's picture, lit evenly on a transparent ground. The second is which way each bit of the film
  faces, as a color: red is the normal's x, green its up, blue its lean toward the viewer, each from -1..1 into 0..1.

The owner's words on the first draft, whose film was crinkled all over: "the effect is perfect but the pack looks a
bit like it went through a rock tumbler. A pack inside a machine would be relatively pristine." The scene here is the
second draft: a nearly flat film with only the pleats the seals pull.

It is a half-size draft. The name is not on it, the pleats are rough, and the coin is flat ink with a raised rim.
