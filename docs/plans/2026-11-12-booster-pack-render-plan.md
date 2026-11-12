# A rendered pack under the page's light: the plan

Record, written 2026-11-12. It carries out `docs/plans/2026-11-12-booster-pack-render-design.md`, and surveys the same
files. Tasks run in order. Each goes test first: the failing test and its red run, then the code. The bench
(`docs/research/2026-11-12-booster-pack-bench/01-bench.html`) is how the light looks and moves; its script's `draw` is
the formula Task 2 ports.

Layers: Tasks 1 to 3 and 5 are engine and tools, and name no instance. Task 4 is Divided World's. What carries the
instance's content into the engine is `InstanceUi.packs[key].art`, URLs the bundler resolved.

## Task 1: the guard reads a pack's folder

Model: sonnet

Files: `tools/check-card-art.mjs`, `tools/test-card-art.mjs`.

- `webpFaults(name, bytes)` takes the size it holds the file to as a third argument, `[width, height]`, defaulting to
  `RASTER`; its size message names that size. Its callers are unchanged.
- A new `packFaults(dir)` for `instances/<name>/ui/packs/<key>/`: everything `folderFaults(dir)` holds a card's folder
  to, with its own "holds" sentence (`PACK_HOLDS`: "a pack's art folder holds art.svg or art.webp, mark.svg and
  art.json, and may hold relief.webp beside art.webp"), and then `relief.webp` where it exists: at most 200 KB
  (`CAPS['relief.webp']`), `webpFaults` at `[540, 840]`, and a fault when the folder holds no `art.webp` ("relief.webp
  is the relief of a rendered pack; this folder has no art.webp"). `folderFaults` takes the "holds" sentence as an
  argument so both use it; a card's messages keep their words.
- A new `packFolders(root)`, as `cardFolders` is, over `ui/packs/`, with the same key pattern. `cardArtFaults(root)`
  adds each pack folder's faults. The command's passing line counts pack folders too. The header comment says all of
  this and names the design's section 5.

Tests first, in `tools/test-card-art.mjs`, with a helper that writes a pack folder beside the clean card folder, and a
WebP header writer that takes a size (the file has one for 1080 by 1680; give it the size as an argument).

Green: a pack with `art.svg`, `mark.svg` and `art.json` (today's Booster); one with `art.webp`, `mark.svg` and
`art.json`; one with `art.webp`, `relief.webp`, `mark.svg` and `art.json`; a repository with no pack folder (the
existing cases).

Poisons: a pack folder with no `art.*`; with `art.svg` and `art.webp`; with no `mark.svg`; with no `art.json`; a
`relief.webp` of 1080 by 1680; a `relief.webp` that is a PNG; an animated `relief.webp`; a `relief.webp` padded past
200 KB; a `relief.webp` beside an `art.svg` and no `art.webp`; an `art.svg` holding `<script`. Each is driven through
`cardArtFaults` and through the command's exit code, as the file's other cases are.

## Task 2: the relief's light, as a pure module

Model: sonnet

Files: `engine/ui/shine/relief.ts` (new), `engine/ui/shine/relief.test.ts` (new).

A module with no DOM and no canvas, in the manner of `engine/ui/shine/band.ts`: it is handed pixels and writes pixels.
Its header says it is engine code that names no card, pack or instance, gives its units, and names the design's
sections 2 and 7 and the bench.

- `makeRelief(normals: Uint8ClampedArray, tint: Uint8ClampedArray | null, w: number, h: number): Relief`. `normals` is
  `w * h` RGBA pixels of a `relief.webp` drawn at `w` by `h`: it decodes each to a unit normal (`c / 127.5 - 1`,
  normalized; a zero vector becomes `(0, 0, 1)`) in a `Float32Array`, with green's sign turned so y runs down the
  screen as a `Light`'s does, and keeps each pixel's alpha. `tint` is the pack's picture drawn at the same size, or
  null; with it, each pixel keeps the highlight's color as the bench has it (`v * 0.6 + 120` for each 8-bit channel,
  at most 255); with null, the color is white.
- `lightRelief(relief: Relief, light: Light, out: Uint8ClampedArray, rows?: { top: number; bottom: number }): void`
  writes `w * h` RGBA into `out`: for each pixel in `rows` (all of them by default), the bench's highlight, `s^48 * 0.9
  + s^16 * 0.12` where `s` is the normal against the half vector of the light's direction and the viewer `(0, 0, 1)`,
  the light standing at `(light.x * 1.3, light.y * 1.3 * h / w, 0.9)` over a pack whose pixels run x in -1..1 and y in
  `-h/w..h/w`. The pixel's color is the relief's tint and its alpha is the highlight, clamped to 0..1, times the
  relief's own alpha. Rows outside `rows` are written fully transparent. It allocates nothing.
- The bench's second term, which dims the picture a little where the film faces away, is not ported: the canvas only
  adds light (the design's section 6).

Tests first:
- a flat relief (every normal toward the viewer) under a light at the center is brightest at the center pixel and
  falls off to each edge;
- with the light at `{ x: 0, y: -1 }` (above), a pixel whose normal leans up is brighter than its neighbor that leans
  down, and with `{ x: 0, y: 1 }` the other way; the same for x. This is the test that fails if green's sign is wrong;
- a pixel with alpha 0 in the relief is alpha 0 in `out` at every light of `LIGHT_GRID` (`engine/ui/shine/band.ts`);
- with `rows`, pixels outside are alpha 0 and pixels inside equal the unrestricted draw's;
- with no tint the color is white; with a tint a pixel's color is `tint * 0.6 + 120`, clamped;
- a normal encoded as `(128, 128, 128)` (the zero vector, near enough) lights as one facing the viewer and writes no
  `NaN`;
- two calls with the same light write the same bytes.

## Task 3: `PackArt` draws a picture and its light

Model: sonnet

Files: `engine/ui/cards/types.ts`, `engine/ui/types.ts`, `engine/ui/test-world.tsx`,
`engine/ui/vending/PackArt.tsx`, `engine/ui/vending/PackArt.test.tsx` (new), `engine/ui/vending/packLight.ts` (new),
`engine/ui/vending/packLight.test.tsx` (new), `engine/ui/vending/pack.css`, `engine/ui/vending/Vending.tsx`,
`engine/ui/vending/PackOpening.tsx`, `engine/ui/vending/Vending.test.tsx`, `engine/ui/vending/PackOpening.test.tsx`.

**The type.** In `engine/ui/cards/types.ts`, beside `CardArt`:

```ts
/** A pack's art: a card's, where the canvas is foil the engine crimps and prints on, or a picture of the whole pack on a transparent ground (specs/card-art.md). */
export interface PackArtLook extends Omit<CardArt, 'canvas'> {
  readonly canvas?: string;
  /** The whole pack, 1080 by 1680 on a transparent ground: its outline is the pack's, and the engine prints only the count on it. */
  readonly picture?: string;
  /** The picture's relief, 540 by 840: which way the film faces, for the page's light. Only with `picture`. */
  readonly relief?: string;
}
```

`InstanceUi.packs` becomes `Record<string, { name: string; art: PackArtLook }>`. `PackLook` and `Opening.art` in
`Vending.tsx`, `PackOpeningProps.art` in `PackOpening.tsx` and `PackArtProps.art` follow it (each keeps `color` and
`ink` required and the rest optional, as today). Run the type check to find any other reader of a pack's `canvas`.

**`PackArt`.** With `art.picture`:

```tsx
<span className="kb-pack" data-part={part} data-kb-pictured="" aria-hidden="true" data-kb-art style={vars}>
  <img className="kb-pack-picture" src={art.picture} alt="" draggable={false} decoding="async" />
  <span className="kb-pack-count" data-kb-text={`${count} cards`} />
  {art.relief ? <PackLight picture={art.picture} relief={art.relief} part={part} /> : null}
</span>
```

No seal, sheen, mark or name spans. Without `art.picture` the markup is today's, unchanged.

**`pack.css`.** `.kb-pack[data-kb-pictured]` has no background and, for the whole pack, no `clip-path`.
`.kb-pack-picture` and `.kb-pack-light` fill the box, `object-fit: contain`, centered, `pointer-events: none`; the
light is over the count. For `data-part='opened'` and `data-part='top'` on a pictured pack, the `clip-path` is the
tear line alone: the same twelve jagged points, closed by the box's plain corners instead of the crimp's teeth. The
tear's points are written once as custom properties or kept beside the existing polygons with a comment saying the
two must match, and a test reads both from the stylesheet and compares them.

**`PackLight`** (in `packLight.ts`, a component and its loader):

- `loadRelief(reliefUrl, pictureUrl, w, h): Promise<Relief | null>`: loads both images with
  `crossOrigin = 'anonymous'`, draws each to a scratch canvas at `w` by `h`, reads their pixels and calls
  `makeRelief`. It caches the promise by `reliefUrl`, `w` and `h` for the page, so every pack showing the same relief
  at the same size shares one decode. Any failure (an image that does not load, a canvas with no 2D context, a read
  that throws because the image is cross-origin) resolves null, once, with one `console.warn` naming the address. A
  picture that cannot be read while the relief can gives a relief with no tint.
- The component renders `<canvas className="kb-pack-light">` and, in an effect, measures its box, sizes the canvas to
  the box times the density `register` returns, never more than 540 by 840, loads the relief at that size, and
  registers with `register(host, canvas, box, devicePixelRatio, draw, { quiet: true, hidden })` from
  `engine/ui/shine/loop.ts`. `draw` calls `lightRelief` into one kept `ImageData` and puts it; it returns false.
  `hidden` sets the canvas to 0 by 0 and drops the `ImageData`; the next draw sizes it again. A `ResizeObserver` on the
  canvas re-registers when its box changes (the slot's zoom, the opening's `--kb-parked-w`). The effect's cleanup
  unregisters. While the relief is loading, or when it is null, nothing is registered and the canvas stays empty.
- `part` gives `rows`: `'top'` lights from the top to the tear's lower points (14% of the box's height), `'opened'`
  from its upper points (9%) to the foot, `'whole'` everything.
- Under reduced motion the loop hands the light at rest and draws once; nothing here asks.

**Callers.** `Vending.tsx` and `PackOpening.tsx` already pass `art` through; only their types change.

Tests first.

`PackArt.test.tsx`:
- with `picture`, one `img.kb-pack-picture` with that address, empty alt, `decoding="async"`; a count span saying
  "5 cards"; no `.kb-pack-seal`, `.kb-pack-sheen`, `.kb-pack-mark` or `.kb-pack-name`, though a `mark` and a `canvas`
  are given too; the root is `aria-hidden` and `data-kb-art`;
- with `picture` and `relief`, one `canvas.kb-pack-light`; with `picture` alone, none;
- with no `picture`, the markup is today's (seals, sheen, name, count, and the mark when given);
- each `part` sets `data-part`, pictured or not;
- from the stylesheet's text: a pictured whole pack has no clip, and the pictured torn parts' tear points equal the
  drawn pack's.

`packLight.test.tsx`, with the image loads and the canvas context stood in (the suite's DOM has no canvas; see how
`engine/ui/shine/loop.test.tsx` and `instances/divided-world/ui/feelin-fab/` stand theirs in):
- a relief that loads registers one host with the loop (`probe`), quiet, and a frame draws it once;
- two packs with the same relief at the same size load it once;
- a relief that fails to load registers nothing, warns once, and the picture is still in the document;
- a canvas with no 2D context registers nothing and throws nothing;
- unmounting unregisters; a host told `hidden` has a 0 by 0 canvas;
- `part="top"` and `part="opened"` hand `lightRelief` their rows;
- the canvas is never sized past 540 by 840.

`Vending.test.tsx` and `PackOpening.test.tsx`: one case each, where a pack is already asserted, that a pack whose art
has a `picture` draws it in the slot, and in the opening as two parts that each hold the picture.

## Task 4: Divided World's Booster

Model: inline (it needs Blender, and its picture is judged by eye)

Files: `instances/divided-world/ui/packs/booster/scene.py` (new), `art.webp` (new), `relief.webp` (new), `art.svg`
(deleted), `instances/divided-world/ui/packs.ts`, `instances/divided-world/ui/cards/rig.py`,
`instances/divided-world/ui/cards/README.md`, `specs/card-art.md`, and the instance's test that reads `packsUi` if one
asserts its art (`instances/divided-world/ui/index.test.tsx`).

- **The scene** starts from the bench's (`docs/research/2026-11-12-booster-pack-bench/scene.py`) and is taken to a
  finish: the pillow between two sealed ends, the film nearly pristine with the pleats the seals pull, the seals'
  ribs and fine teeth, the foil's four colors corner to corner with the rays, and the coin embossed. Added to it:
  "BOOSTER" in raised letters under the coin, in Anton (`instances/divided-world/ui/fonts/Anton-Regular.woff2`;
  Blender reads no WOFF2, so the scene unpacks it to a temporary TTF with `fontTools`, and the README's install line
  gains `fonttools brotli`); and a quiet band from 74% to 82% of the picture's height, where the engine prints the
  count, with no pleat, ray edge or lettering strong enough to fight it. The light is even: no highlight of the
  scene's own.
- **`rig.render(path, alpha=False)`**: with `alpha`, the film is transparent and the WebP is RGBA. The cards' scenes
  are untouched and their pictures are not rendered again.
- **Two outputs from one scene**, as the bench's has: `python scene.py art.webp` at the rig's defaults (1080 by 1680),
  and `PASS=relief python scene.py relief.webp`, which the scene itself renders at 540 by 840 whatever `ART_SCALE`
  says, unlit, raw, with no denoising. The scene's docstring gives both commands.
- **`packs.ts`** imports `art.webp` and `relief.webp` and gives `picture` and `relief`; it gives no `canvas`. The mark
  stays. Its header comment no longer says the art is a placeholder.
- **The README** gains a short section, "A pack's picture", after the card back's: the folder, the two commands, the
  quiet band, and that the relief is rendered again whenever the picture is.
- **`specs/card-art.md`** gains "## A pack" after "## The card back": what the folder holds, the picture's size and
  transparent ground, the relief's size and encoding, what the engine draws with each, and what the guard holds. It is
  a current document, so every path it names exists when this task ends.

Checks, shown in the PR with their output: `node tools/check-card-art.mjs` passes and counts the pack folder; `art.webp`
is at most 400 KB and `relief.webp` at most 200 KB; the picture's corner pixels are transparent. The PR shows the
picture, and a screen recording or a pair of screenshots of the machine's slot and the opening under two lights, from
the story Task 5 adds.

This task's PR waits on the owner's look at the picture (the design's section 9).

## Task 5: the stories and the screens

Model: sonnet

Files: `engine/ui/vending/Packs.board.stories.tsx`, `e2e/pack-reveal.spec.ts`, `e2e/glass-screens.ts`, and whatever
the runs below show.

- `Packs.board.stories.tsx` gains a story, `Pictured`, that draws a pack with a picture and a relief at 86px and at
  180px, whole, opened and top, beside the drawn pack with no picture, using small test pictures committed beside the
  story (a 1080 by 1680 transparent WebP and a 540 by 840 relief; they are test fixtures in the engine, not an
  instance's art, and the engine boundary check must still pass).
- Run `e2e/boards.spec.ts` for the `2026-11-07-booster-packs` boards and `e2e/pack-reveal.spec.ts`. The board match
  compares landmarks by role and box, and the pack's box is unchanged, so they are expected to pass as they are; where
  one reads something the pictured pack no longer draws (the name plate, a seal), the manifest's comment says what the
  build now draws and why, as `e2e/boards/2026-11-07-booster-packs/01-machine.ts` does for its other differences.
- One end-to-end case in `e2e/pack-reveal.spec.ts`: on the machine's story with Divided World's Booster, the slot holds
  a `.kb-pack[data-kb-pictured]` whose picture has loaded (`naturalWidth` 1080), and after a pointer move its light
  canvas holds at least one pixel that is not transparent. Under emulated reduced motion the canvas's pixels are the
  same before and after a pointer move.
- The accessibility run over the machine and the opening passes unchanged: the pack is still hidden from it.

## Review focus

- A relief or picture served from another origin without CORS headers cannot be read: the pack must fall back to the
  still picture, with one warning, and never throw into the loop or leave a half-drawn canvas.
- The cost of a draw on a machine page full of packs and during the opening's rip, when two parts light at once:
  measured with the loop's `probe.work`, on a phone-class CPU throttle, against the frame budget.
- The opening moves and rotates the pack with transforms: the light must stay registered to the right box through the
  drop, the rip and the park, and a part that leaves view must free its canvas and come back.
- A pack re-rendered without its relief (or the reverse) drifts silently: nothing compares the two files. The README
  says so; the reviewer checks the committed pair came from one run of the scene.
- The count over the picture under a moving highlight: it is decoration and the slot's name says it, but it should
  still read at 86px at every light of `LIGHT_GRID`.
- An instance with a drawn pack and no picture is unchanged to the pixel, and one with a picture and no relief shows
  the still pack with no canvas in the document.
- Nothing about the light leaves the browser, and nothing it reads is private: confirm no new request, payload or
  event was added.
