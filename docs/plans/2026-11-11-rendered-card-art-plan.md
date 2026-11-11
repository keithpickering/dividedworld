# Rendered card art: the plan

Record, written 2026-11-11. It carries out `docs/plans/2026-11-11-rendered-card-art-design.md`, and surveys the same
files. Tasks run in order. Each goes test first: the failing test and its red run, then the code.

## Task 1: the guard reads a raster canvas

Model: sonnet

Files: `tools/check-card-art.mjs`, `tools/test-card-art.mjs`.

The design's section 3. In `tools/check-card-art.mjs`:

- `CAPS` gains `'art.webp': 400 * KB`. The canvas is no longer one of the three files looped over as required:
  `folderFaults(dir)` reads `art.svg` and `art.webp`, and says, naming the folder, when neither is there ("missing a
  canvas; a card's art folder holds art.svg or art.webp, mark.svg and art.json") or both are ("holds art.svg and
  art.webp; a card has one canvas"). `mark.svg` and `art.json` are required as today.
- A new function `webpFaults(name, bytes)` returns the faults of a WebP read by its header alone, decoding nothing:
  - shorter than 30 bytes, or bytes 0-3 not `RIFF`, or bytes 8-11 not `WEBP`: "is not a WebP image";
  - the first chunk's tag (bytes 12-15) is `VP8 `, `VP8L` or `VP8X`, else "is not a WebP image this guard can read";
  - width and height, by chunk: `VP8 ` reads the start code `9d 01 2a` at bytes 23-25, then width and height as
    little-endian 16-bit values at 26 and 28, each masked to 14 bits; `VP8L` reads the signature byte `2f` at 20, then
    from the 32-bit little-endian value at 21, width is its low 14 bits plus 1 and height its next 14 bits plus 1;
    `VP8X` reads width as the 24-bit little-endian value at 24 plus 1 and height as the one at 27 plus 1. A missing
    start code or signature is "is not a WebP image this guard can read";
  - not exactly 1080 by 1680: "is W by H; a raster canvas is exactly 1080 by 1680";
  - `VP8X` with bit 1 (value 2) of the flags byte at 20 set: "is animated; a card's art is a still image".
- The size cap is applied to `art.webp` as it is to the others.
- `art.svg`'s own checks run only when it is there. The file's header comment is rewritten to say all of this, and what
  it does not catch (a right header over corrupt image data; EXIF and XMP chunks, inert in an `<img>`).

Tests to write first, in `tools/test-card-art.mjs`, each driven red before the code exists. `repo()`'s `files` map
takes a `Buffer` as well as a string. Fixtures are real images, made once with an encoder and held in the test as
base64: a 1080 by 1680 solid color as lossy (`VP8 `), lossless (`VP8L`) and extended (`VP8X`, an image with an alpha
channel saved lossy), and a 540 by 840 lossy one. A solid-color WebP at that size is a few hundred bytes.

Green (must pass):
- a folder whose canvas is `art.webp` (each of the three encodings), with no `art.svg`;
- a folder with `art.webp` and a file the guard does not read beside it (`scene.py`).

Poisons (each must fail, naming its fault):
- no canvas at all (neither file);
- both `art.svg` and `art.webp`;
- a PNG's bytes named `art.webp` (wrong magic);
- a WebP of 540 by 840;
- the lossy fixture with its width bytes altered to 1081;
- the extended fixture with its animation flag set;
- a valid file padded past 400 KB (pad after the header; the guard reads the header and the length);
- a file cut to 20 bytes;
- an `art.webp` whose first chunk tag is `ALPH`.

The existing tests stay green unchanged, except the "missing art.svg" one, whose words change with the message.

## Task 2: the face

Model: inline

Files: `engine/ui/cards/Postcard.tsx`, `engine/ui/cards/postcard.test.tsx`, `engine/ui/cards/types.ts`.

- Test first, in `postcard.test.tsx`'s "the canvas" block: the art `<img>` has `decoding="async"`. Red, then add the
  attribute to the `<img className="kb-postcard-art">` in `Postcard`.
- `CardArt.canvas`'s comment in `types.ts`: "The card's art, a URL the bundler resolved: an SVG on the 540 by 840
  canvas (TEMPLATE.canvas), or a WebP image of 1080 by 1680 (`specs/card-art.md`). It is decoration: the card's name
  and rules say the rest."

## Task 3: the scenes beside the art, and the art itself

Model: inline (it needs Blender, which only the main loop has set up)

Files: `instances/divided-world/ui/cards/rig.py` and, for each of the ten cards (`autocorrect`, `bluff`, `feelin-fab`,
`force-field`, `glitter-bomb`, `hall-pass`, `main-event`, `stick-around`, `trap-card`, `whoops`),
`instances/divided-world/ui/cards/<key>/scene.py` and `art.webp`; `art.svg` is deleted from each.

- Copy `docs/research/2026-11-11-card-renders/rig.py` to `instances/divided-world/ui/cards/rig.py`, and each card's
  scene (`autocorrect.py`, `bluff.py`, `fab.py`, `force.py`, `glitter.py`, `pass.py`, `main.py`, `stick.py`, `trap.py`,
  `whoops.py`) to its folder as `scene.py`. In each copy, the line that puts the script's own folder on the import path
  puts its parent there, where `rig.py` is. The research folder is not changed.
- In the copied `rig.py`, `render(path)` sets the image format from the path: `.webp` writes WebP at quality 90, and
  anything else PNG as before. The rig's header says a card's art is made with `python scene.py art.webp` at the
  defaults (`ART_SCALE=2`, which is 1080 by 1680).
- Render each card's `art.webp` from its `scene.py` at the settings the research README records for it (256 samples and
  `WHOOPS_MESH=170` for Whoops!, 200 samples for the rest), and delete its `art.svg`.
- Show: `node tools/check-card-art.mjs` passes over the ten folders, and each `art.webp`'s size.

## Task 4: the instance names the new files

Model: inline

Files: `instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/cards/README.md`.

- In `cards.ts`, each of the ten `import <name>Canvas from './cards/<key>/art.svg?url'` becomes `art.webp?url`. The
  file's tests (`instances/divided-world/ui/index.test.tsx` and the rest of `npm run test:ui`) are the check: run the
  instance's UI tests before and after.
- The art README is rewritten for both ways of making a card's art. It keeps the vector steps; adds the raster ones
  (a 1080 by 1680 WebP named `art.webp`, at most 400 KB, a still image, the subject in the upper half because the name
  plate starts a little over half way down); says what `scene.py` and `rig.py` are and how to render one
  (`pip install bpy==5.3.0 scipy`, then `python scene.py art.webp` from the card's folder; Whoops! needs scipy); says
  that the art file is what ships and the scene is how to make it again, and that nothing in the build holds one to the
  other; and replaces "Art is vector only for now; painted art waits on a later design." What the guard refuses is
  brought up to date.

## Task 5: the contract's words

Model: inline

Files: `specs/card-art.md`.

"An art set" says the canvas is `art.svg` or `art.webp`, exactly one, with the raster's rules (1080 by 1680, at most
400 KB, still). "What `tools/check-card-art.mjs` holds" gains the raster rules and what the guard does not catch for a
raster. "A variant is the same canvas" says the raster rule is now built, for a card's own canvas, and that a variant's
will be held to the same. The sentence that the design behind the spec is the card template design gains this design
beside it.

## Task 6: the whole build

Model: inline

`npm run build`, then `npm run test:e2e`. A red run gets its root cause found before a fix. Then the PR, with: the
guard's red runs, the ten files' sizes, the faces at four sizes with the shipped art (the research folder's
`mockup.cjs`, pointed at the real story with no swap), and `Design questions` listing the design's section 8.

## Review focus

- A WebP whose header is right and whose data is not: the guard passes it and the browser draws nothing. Is a card with
  no picture still a whole card at every size, as the design says?
- The guard's header reading against real files from another encoder (the fixtures are from one): does it misread a
  valid 1080 by 1680 WebP as some other size, or pass a wrong-sized one?
- Weight on the Vending Machine's first visit at a busy instance's roster, which the design accepts for ten cards.
- A scene and its art can drift, and nothing in the build says so: is the README's statement of that enough for the
  next person who edits a scene?
- The plates' words over the brightest renders (Feelin' Fab's cloud, Glitter Bomb's flash) at the phone and slot
  sizes, where the plate is a strip.
- Anything else that reads a card's canvas by its `.svg` name: a test fixture, a screenshot, a preload.
