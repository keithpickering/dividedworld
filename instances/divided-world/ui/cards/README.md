# Making a card's art for Divided World

Cards here are played in the open, and the art is most of what a card is. This is how to make some. The engine's side of
it, with every number, is `specs/card-art.md`.

## What you make

Each card has a folder, `instances/divided-world/ui/cards/<key>/`, holding three files:

- the card's picture, its canvas: `art.svg` if you draw it as vector art, or `art.webp` if you paint or render it. One
  or the other, never both.
- `mark.svg`, a small square emblem for the card. Always vector.
- `art.json`, who you are and the terms you offer the art under.

Wherever the picture comes from, two things about the card's face decide how it reads:

- **Keep your subject in the upper half.** The card's name sits on a plate that starts a little over half way down at
  the two larger sizes, with the rules under it, so the lower part of the picture is texture behind words. Only at the
  two smallest sizes, where the plate is a strip at the foot, does the whole picture show.
- **Leave the top corners quiet.** The card's flavor and kind sit top left, and its rarity gem top right.

## A vector picture

1. **Download the template**, `engine/ui/cards/card-template.svg`, and open it in an SVG editor (Inkscape works well).
2. **Draw on the art layer.** The guides layer is locked; leave it alone. Everything fills the canvas, which is the
   540 by 840 rectangle inside the frame.
3. **Keep your subject in the focus zone**, the dashed box in the upper part. It is a guide, not a mask: glow, rings
   and splashes may run past it, and a transparent ground is fine. The game draws a dark ground and a soft glow in the
   card's color under your art.
4. **Treat the lower part as texture.** The name and rules sit on plates there (the hatched zone).
5. **Stay inside the keep-clear line**, the dotted line near the edge. No piece of your drawing crosses it.
6. **Export `art.svg`** with the viewBox `0 0 540 840`, as plain SVG. Delete the guides layer first. The template is
   the whole 600 by 900 card, so export only the canvas rectangle (its top left is at 30, 30), shifted so your file's
   coordinates start at 0, 0.

## A painted or rendered picture

1. **Make it 1080 by 1680 pixels**, exactly: twice the canvas, which is sharp at the largest card on any screen. The
   template's guides are the same shapes at twice the size.
2. **Fill the whole rectangle.** A raster picture covers the game's dark ground, so it has no transparent parts to rely
   on, and the card's rounded corners trim it.
3. **Save it as `art.webp`**, a still image, at most 400 KB. Quality 90 is what the cards here use, and a picture of
   this size comes to 90 to 160 KB at it.

## The cards' own pictures are 3D scenes

The cards here are rendered in Blender, in the manner of 1990s trading-card art, and each card's folder holds the
scene its picture came from: `scene.py`, a Python script that builds the scene from nothing and renders it. `rig.py`,
beside the folders, is what the scenes share. To make a card's picture again, from its folder:

```
python3 -m venv .venv
.venv/bin/pip install bpy==5.3.0 scipy
cd instances/divided-world/ui/cards/whoops
../../../../../.venv/bin/python scene.py art.webp
```

That is Blender's Python module, with no Blender install and no GPU; the full Blender build runs a scene too
(`blender -b -P scene.py -- art.webp`). A render takes three to eight minutes on four CPU cores. For a quick look
while changing a scene, `ART_SCALE=1 ART_SAMPLES=40` makes a half-size draft in under a minute: give a draft another
name, such as `draft.png`, since the guard refuses an `art.webp` of any other size, and do not commit it. Each scene's
other settings (a seed, a camera) are environment variables read at its top. Whoops! is the one scene that needs
`scipy`. Heat Magnet's fire is a fluid simulation, which fails inside the Python module, so that one scene needs the
full Blender build. Blender also writes a 24 MB file, `waveletNoiseTile.bin`, into the folder it is run from when it
simulates that fire; the repository ignores it, and it can be deleted.

Each scene's defaults are the settings its shipped picture was rendered at (the samples, Whoops!'s mesh, Heat Magnet's
simulation), so a scene run as above makes its picture again as it shipped.

**The art file is what ships; the scene is how to make it again.** Nothing in the build renders a scene or compares it
with its picture, because a render needs Blender and minutes of CPU, and two renders of one scene are not the same
bytes. So a change to a scene is finished only when the picture is rendered again and both are committed together.

The scenes began as one day's exploration, recorded with its drafts in `docs/research/2026-11-11-card-renders/`.

## The mark and the manifest

- **Draw `mark.svg`**, a square silhouette that still reads at 18 pixels wide. A full-art picture shrunk that small
  turns to mud, so the mark is its own drawing, and it is required.
- **Write `art.json`**:

  ```json
  { "credit": "Your name", "license": "The terms you offer the art under" }
  ```

  Both must be filled in. The credit is shown on the card sheet's foot line as "Art · Your name". Use your own name or
  handle, and describe the art, never a character.

Then **open a pull request** with the three files in the card's folder. Each card in the game already has a folder, so
new art for it replaces its picture. The owner approves art in review.

The repository has no license yet. The art here is the project's own, and the owner will give its license when the
repository has one.

## What the guard refuses

Check your folder before you open the pull request:

```
node tools/check-card-art.mjs
```

It refuses a folder with no picture, or with both `art.svg` and `art.webp`; a missing `mark.svg` or `art.json`; an
`art.svg` whose viewBox is not exactly `0 0 540 840`; an `art.webp` that is not a WebP image, is not exactly 1080 by
1680, is animated, or is over 400 KB; a `mark.svg` that is not square; an `art.json` that is not JSON or lacks a credit
or license; an SVG over its size cap (200 KB for the picture, 20 KB for the mark, 2 KB for the manifest); and anything
in an SVG that runs or fetches: scripts, `foreignObject`, `<image>`, `on...` attributes, `@import`, a `<!DOCTYPE>`,
`xml:base`, animation that rewrites a link, a character reference such as `&#106;` inside an attribute, and any link
or `url(...)` that points outside the file. It reads comments and titles too, so `<script` in a comment is refused as
well. Some editors write a `<!DOCTYPE>` line at the top of an export; delete it.

It reads only those files. Anything else in a card's folder, such as a `scene.py`, is yours.

This README and `rig.py` are files, not card folders, so the guard does not read them.
