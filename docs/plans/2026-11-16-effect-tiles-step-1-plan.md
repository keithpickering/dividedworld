# Effect tiles, step 1: the layer, its guards, and Hot Box: plan

Record, written 2026-11-16. Carries out step 1 of `docs/plans/2026-11-16-effect-tiles-design.md` (its sections are
cited as §N), task by task. It closes the first item of issue #722 ("Cost per frame grows with the post's length");
the build's PR links #722 as a checklist and does not close it.

What it is: one engine module and its frame schedule (`engine/ui/cards/`), one tool pair, one instance effect moved
onto the layer (Hot Box), one instance story file and one spec. No migration, no database, no screen, no words a
player reads, no state a player, a character or a post can be put in, and no response, payload, Realtime event or
timing computed from a private fact: the layer reads a box, the window and the frame clock. Engine or instance, by
part: `engine/ui/cards/tiles.ts`, `tileLoop.ts` and their tests are the engine's and name no card;
`instances/divided-world/ui/hot-box/*` and `instances/divided-world/ui/EffectBudget.board.stories.tsx` are the
instance's; `tools/` and `e2e/` are neither.

**What must not change:** Hot Box's model (`instances/divided-world/ui/hot-box/smoke.ts` and `smoke.test.ts` are not
edited), what it asks of a reader (the clearings, the held sweep and its pace, the waved window), its forced-colors
path, its words, its Lens view, and its look on a post that fits one tile. No other effect is edited: Graffiti,
Whoops!, the shine effects and Autocorrect are steps 2 to 5 (§7).

**If main has moved:** this was read at `b869b5f1`. If `instances/divided-world/ui/hot-box/Effect.tsx`,
`engine/ui/cards/bands.ts` or `engine/ui/cards/body.ts` has changed since, read the change before Task 1 and say in
the PR what it altered here.

Commits: one a task, except Tasks 5 and 6, which are one commit (`tools/build.mjs` refuses a check that is not in
`STEPS`, and the check reads the story file).

## Task 1. The layer's arithmetic, `engine/ui/cards/tiles.ts` (§3)

Model: sonnet

Test first, `engine/ui/cards/tiles.test.ts` (node's runner is not used for `engine/ui`; this is vitest,
`npm run test:ui`). Red run: the module does not exist. Record it.

- `TILE_PX` is 512, `TILE_NEAR_PX` 256, `MAX_TILE_DENSITY` 2, `MAX_TILE_WIDTH_PX` 1200, and `MAX_TILE_PIXELS` is
  exactly 2,457,600.
- `tileDensity(w, screen, ask)`: the least of `MAX_TILE_DENSITY`, the screen's density and what was asked (absent:
  no ask); for `w` over 1,200 it is lowered so that `ceil(w * density)` is at most 2,400. For every `w` from 1 to
  3,000 in steps of 7, every screen of 1, 1.5, 2, 2.625 and 3, `ceil(w * d) * ceil(TILE_PX * d)` is at most
  `MAX_TILE_PIXELS`. A density that is not a positive finite number is 1.
- `mostTiles(viewportH)` is `ceil((viewportH + 2 * TILE_NEAR_PX) / TILE_PX) + 1`: 4 at 900, 4 at 844, 3 at 500.
- `nearTiles(boxH, viewTop, viewBottom)` (the box's top at 0, the view in the box's px): the indexes of the tiles
  of `bandsOf(boxH, TILE_PX)` (`engine/ui/cards/bands.ts`) that lie within `TILE_NEAR_PX` of the view; for a box
  40,000 tall and every view 900 tall stepped by 100, never more than `mostTiles(900)`; none for a view wholly above
  or below the box by more than `TILE_NEAR_PX`; none for a box of no height.

Then write the four functions and the five constants, pure, with a header that states §3's figure and where each
number comes from. `nearTiles` is what the layer uses for its first tiles (Task 2); the observer's answer is
`watchBands`'s.

## Task 2. The layer, `engine/ui/cards/tiles.ts` (§2, §4, §5)

Model: sonnet

Read first: `engine/ui/cards/bands.ts` (the watcher this is built on), `engine/ui/cards/body.ts` (`bodyOf`,
`bodyBox`, `sameBox`), `engine/ui/shine/inView.ts`, and how `instances/divided-world/cards/whoops/Effect.tsx`
releases a band's canvas (its ref callback sets `width` and `height` to 0: "a canvas's memory is freed with its size,
not when the page gets to the element").

The interface, in the same file:

```ts
/** What a painter is handed for one canvas of one tile. `ctx` is already transformed so that its coordinates are the box's CSS px. */
export interface TileDraw {
  readonly ctx: CanvasRenderingContext2D;
  /** Which of the layer's canvases for this tile (0 is the lowest). */
  readonly sheet: number;
  /** The tile: its index, its offset from the box's top and its height, CSS px. */
  readonly index: number; readonly top: number; readonly h: number;
  /** The whole box, CSS px, and the density the tile is drawn at. */
  readonly box: { readonly w: number; readonly h: number }; readonly density: number;
  /** The frame's time (a `requestAnimationFrame` timestamp), or null for a paint outside a frame. */
  readonly frame: number | null;
}
export interface TileLayerOptions {
  readonly place: EffectPlace;
  /** Canvases a tile holds, lowest first; default 1. */
  readonly sheets?: number;
  /** A density to draw at, at most the layer's own. */
  readonly density?: number;
  /** A class for each canvas (the effect's stylesheet places nothing: the layer sets the box inline). */
  readonly className?: string;
  /** A class for each band's stand-in, which carries `data-kb-tile="far"` until a painted tile covers it and `"held"` after. */
  readonly standIn?: string;
  readonly paint: (draw: TileDraw) => void;
  /** Told the box whenever it changes, and once at the start. */
  readonly onBox?: (box: BodyBox, body: HTMLElement | null) => void;
}
export interface TileLayer {
  /** The every-frame way: on, the painter is called for each held tile each frame. */
  loop(on: boolean): void;
  /** The kept way: a part of the box (CSS px, default all of it) is stale; its held tiles are painted in the next frame. */
  stale(rect?: { readonly top: number; readonly bottom: number }): void;
  /** Paints every held tile now, outside a frame (after a commit that must not show a bare frame). */
  paintNow(): void;
  /** The held tiles' canvases, for an effect that draws straight into them between paints (step 2's scrub). */
  held(): readonly { readonly index: number; readonly top: number; readonly h: number; readonly density: number; readonly sheets: readonly HTMLCanvasElement[] }[];
  /** Measures again (a takeover moved the words with no change of size). */
  measure(): void;
  stop(): void;
}
export function makeTileLayer(host: HTMLElement, options: TileLayerOptions): TileLayer;
```

Tests first, `engine/ui/cards/tiles.layer.test.tsx` (jsdom: stub `getContext`, `requestAnimationFrame`,
`ResizeObserver` and `IntersectionObserver` as `engine/ui/cards/bands.test.tsx` does, and
`getBoundingClientRect` for the host and a `.kb-act-main` ancestor). Red run on each before the code. Each line is a
test:

- In the thread the box is the body's padding box (`bodyOf`, `bodyBox`); elsewhere the host's own. `onBox` is told
  it at once and again when a `ResizeObserver` report changes it, and not when a report changes nothing (`sameBox`).
- At the start, with no observer report yet, the tiles `nearTiles` names for the box and the window are held and
  painted before `makeTileLayer` returns (§5). A box wholly out of view holds none.
- A held tile's canvas is `ceil(w * d)` by `ceil(h * d)` for `d = tileDensity(...)`, placed inline at the tile's
  offset in the box, with `aria-hidden="true"`, `data-kb-effect-ink` and the options' class, and takes no pointer.
  With `sheets: 2` a tile holds two, in order.
- The painter's `ctx` has been given `setTransform(d, 0, 0, d, 0, -top * d)` and a clip to the tile's rows, so a
  painter that fills the whole box fills only the tile.
- When the watcher reports a tile gone, its canvases are sized to 0 by 0 and removed; when it reports one new, it is
  made and painted in the next frame. No canvas of the layer is ever over `MAX_TILE_PIXELS`: asserted over a box
  1,200 by 40,000 walked top to bottom at a screen density of 2 and of 3, with never more than `mostTiles` held.
- A band's stand-in carries the options' `standIn` class and `data-kb-tile="far"` until its tile has been painted,
  then `"held"`, and `"far"` again when the tile is released. Without `standIn` the band elements are as `bands.ts`
  leaves them.
- `loop(true)` paints every held tile every frame with the frame's time; `loop(false)` stops, and with nothing
  stale no frame is requested (the page is idle). `stale({ top, bottom })` paints only the held tiles those rows
  cross, once. `paintNow()` paints with `frame: null`.
- A resize that changes the box re-places and repaints the held tiles and re-cuts the bands; one that changes only
  the box's offset re-places and does not repaint.
- `stop()` releases every canvas (0 by 0), removes the stand-ins, stops the observers and leaves no frame pending.
  A late observer or resize report after `stop()` does nothing.
- Where the browser has no `IntersectionObserver`, every tile counts as near (as `bands.ts`), and the layer then
  holds the tiles `nearTiles` names from the window on each scroll frame instead of all of them, so the figure holds
  there too. (`bands.ts` says the effect "paints the whole box" there; the layer does not.)

Then the code. `watchBands(host, box, TILE_PX, `${TILE_NEAR_PX}px 0px`, onNear)` gives the near set after the first;
the layer adds the canvases and the stand-in marks to it. Time is never read here: the frame is the only clock
(`tools/check-one-clock.mjs`).

## Task 3. One frame schedule, `engine/ui/cards/tileLoop.ts` (§4)

Model: sonnet

Test first, `engine/ui/cards/tileLoop.test.ts`: two layers registered, one looping and one with a stale tile, are
served by one `requestAnimationFrame` a frame; when neither wants a frame none is pending; a layer that asks for a
frame during a frame is served in the next; `probe.work()` returns the own time of the last frames (two
`performance.now()` reads around the step, a ring of 600, as `engine/ui/shine/loop.ts`'s `probe.work` does), and
`probe.held()` the canvas px every registered layer holds, by layer. Red run, then the code. `performance.now()` is
not the page's wall clock and is not a read `tools/check-one-clock.mjs` counts; confirm by running it.

Task 2's layer calls `want(layer)` and `forget(layer)` here and requests no frame of its own. The `probe` is
exported for the spec (Task 7) and reached through `window.__kbTiles` only in a story build, as the shine loop's
probe is reached: read how `e2e/shine.spec.ts` gets `probe` and do the same.

## Task 4. Hot Box on the layer (§2, §4, §5)

Model: sonnet

Read `instances/divided-world/ui/hot-box/Effect.tsx` and its test whole first. What changes in `Effect.tsx`:

- `MAX_CANVAS_PX`, `MAX_DPR`, `densityFor`, the `<canvas ref={canvasRef}>` element, the `sight` state with its
  `watchInView`, and the `requestAnimationFrame` loop go. `Smoke` makes a layer in a layout effect, when not
  `forced`: `makeTileLayer(host, { place, className: 'dw-hotbox-smoke', standIn: 'dw-hotbox-far', paint, onBox })`,
  and stops it on cleanup. Under forced colors no layer is made, as no canvas is drawn today.
- `paint(draw)` is today's `paint` body from "const t = api.now()" on, drawing with `draw.ctx` in the box's px: the
  fog over the tile's rows, each puff whose disc crosses them (`p.y + p.r >= draw.top && p.y - p.r <= draw.top +
  draw.h`), each clearing and each sweep rectangle that crosses them. `puffs`, `puffAt`, `cutsAt`, `covered` and
  every number stay `smoke.ts`'s. The layer has already set the transform and the clip, so `clearRect` and
  `fillRect` over the whole box are right.
- `onBox` replaces the box half of `measure`; the words' own offset and size (`wx`, `wy`, `ww`, `wh`) are still
  measured here, by the effect's `ResizeObserver` on the words and the host, and `layer.measure()` is called from
  it.
- `layer.loop(loop)` follows today's `loop` flag (not still, motion not reduced, not waved). The layer holds tiles
  only near the view, so `inView` leaves the flag. Without a loop, `layer.paintNow()` runs where `paint()` ran after
  a render. `met()` is called on the first frame a tile of this layer is painted in view: keep `watchInView` on the
  area for `met` alone if the layer cannot say so, and say which in the PR.
- The stand-in (§5): `hot-box.css` gains `.dw-hotbox-far[data-kb-tile="far"]`, a flat fill of
  `rgb(var(--dw-hotbox-rgb) / var(--dw-hotbox-fog))`, `z-index: 1`, no pointer; the effect sets the two custom
  properties on the host inline from `rgb` and `fogAlpha(strength) * (1 - waveFactor)`, at every render (the timer
  already renders when the strength moves a hundredth). `[data-kb-tile="held"]` paints nothing. A moment (`still`)
  sets them once. Under forced colors there is no layer and so no stand-in.

`Effect.test.tsx` is rewritten where it reads the one canvas (`canvas(s)`, its width, height and style, the
out-of-view release at lines 346 to 360): the same facts are asserted of the layer's tiles. Add, each red first:

- a box 800 by 600 holds two tiles, 512 and 88 tall, and the fog is filled in both;
- a clearing at y = 500 is cut in both tiles and one at y = 100 only in the first;
- a box 800 by 20,000 at a screen density of 2 holds at most `mostTiles(innerHeight)` canvases, each 1,600 by 1,024;
- before any observer report, a smoked post in view has its tiles painted in the commit that mounts it;
- a far band's stand-in carries the fog's color and alpha, and the alpha follows the strength;
- under forced colors there is no canvas and no stand-in;
- the getter test ("two readers render the same": fails on any read of `reader.author` or `reader.caster`) still
  passes unchanged.

Green: `npm run typecheck`, `npm run test:ui`, and `e2e/hot-box.spec.ts` unchanged except where it selects
`canvas.dw-hotbox-smoke` as one element (it now matches several): fix the selector, not the assertion.

## Task 5. The check and its self-test (§6, guard 2)

Model: sonnet

Read `tools/check-one-clock.mjs` and `tools/test-one-clock.mjs` first and follow their manner: the TypeScript AST,
exported pure functions the test calls, a list with a count and a reason for each file, read from git.

`tools/test-effect-canvas.mjs` first, red on the missing module, then:

- **The poison:** `instances/x/ui/y/Effect.tsx` holding `<canvas ref={r} />` fires, naming the file, the line and
  what was found. So do `document.createElement('canvas')`, `new OffscreenCanvas(1, 1)` and
  `el.transferControlToOffscreen()`, in `engine/ui/` and in `instances/`.
- **What only looks like one stays clean:** a test or story file; a comment or a string holding `<canvas>`;
  `createElement('div')`; `engine/ui/cards/tiles.ts` itself; a listed file within its count.
- **The list is exact:** a listed file with more than its count fires; a listed file with fewer fires as stale; a
  listed file that is gone fires.
- **The budget stories:** an instance file that imports `engine/ui/cards/tiles.ts` fires unless the name of the
  folder it is in is a key of the object literal `BUDGET` exported by
  `instances/<instance>/ui/EffectBudget.board.stories.tsx`; with the key present it is clean.
- **The real tree is clean** (so a guard gone quiet fails here).

`tools/check-effect-canvas.mjs`: `CANVASES`, by file: `{ count, why, until? }`. Fill it by running the scan on the
tree and reading each hit: a sprite or scratch canvas, a config preview, a ruler for `measureText`, the avatar
editor, the glass's field, the pack art, Autocorrect's per-line paper (`why` says each). Every effect not yet moved
gets `until: 'step N'` with §7's step: Graffiti 2, Whoops! 3, Feelin' Fab, Glitter Bomb and the shine modules they
draw through 4, Autocorrect's residue 5. Hot Box has no entry. The header says what the guard holds, and what it
cannot see: a canvas made through a variable tag name, and a canvas inside the list that is sized to a post (the
unit test and the spec hold that).

Add both to `STEPS` in `tools/build.mjs`, the test immediately before the check. `node tools/test-build-steps.mjs`
green.

## Task 6. The budget stories (§6, guard 3)

Model: sonnet

`instances/divided-world/ui/EffectBudget.board.stories.tsx`, title `Boards/25 Effect budget`, after the manner of
`instances/divided-world/ui/hot-box/HotBox.board.stories.tsx` (the `01-main` moment, post #43 edited by
`fake.seed.edit`, the card found with `cardOf(instance.cards, key)`, never by position).

```ts
/** One seeding for each effect on the tile layer, by the name of the effect's folder (tools/check-effect-canvas.mjs holds that none is missing). */
export const BUDGET = {
  'hot-box': (fake, caster, target, now) => fake.seed.card(caster, target, cardOf(...).key, { layer: 1, live: true, config: { color: '#ff69b4' }, message: 'Smoke out', at: now, ends: ... }),
};
```

The post's words: 20,000 characters exactly (the instance's `postMaxLength`; read it from the instance, do not write
the number), made of short paragraphs so that it is tall at both widths, built by a function in the story file. One
story for each key of `BUDGET`, named by the key (`HotBox`), drawn from the map so a new key is a new story with no
other line. Two poisons, stories of their own in the same file: `PoisonSlow`, where a layer made by the story on the
same post has a painter that spins for 25 ms; and `PoisonWhole`, where the story lays one `<canvas>` the size of the
post body into it. The poisons' canvases are in a story file, which the check does not read.

Add the stories' ids to the list `e2e/board-stories.test.ts` holds.

## Task 7. The spec (§6, guard 3)

Model: sonnet

`e2e/effect-tiles.spec.ts`, run in the desktop and the phone project. Read `e2e/shine.spec.ts` first for its manner:
the warm-up run, the scroll over three seconds, `percentile`, reading a probe from the page, logging the gap and
asserting own time, and its poisoned tests.

For each story of `BUDGET` (the spec reads the ids from the story index, so a new story is run with no edit here):

- **Pixels.** Sampled every frame of a scroll from top to bottom: every `canvas` under the post's `.kb-act-main`
  has `width * height <= 2_457_600`; the canvases with any pixels number at most `mostTiles(viewport height)` times
  the layer's sheets; none with pixels lies more than 256 px plus one tile outside the viewport.
- **Own time.** The 95th percentile of the tile loop's own time in a frame over a timed run is under 8 ms
  (`OWN_BUDGET`), in the manner of the shine spec: up to three timed runs after a warm-up, one must meet it. Log every
  run's figures and the gap between frames; do not assert the gap (issue #318).
- **Never bare** (stories whose effect hides words: `hot-box`): at every sampled frame, each band of the post that
  crosses the viewport has `data-kb-tile="held"` with a canvas that has pixels, or `data-kb-tile="far"` with a
  computed background that is not transparent.
- **At the bottom**, the tiles of the post's top have been released: no canvas with pixels above the viewport by
  more than 256 px plus one tile.

Poisoned, each expected to fail its check and asserted to: `PoisonSlow` misses `OWN_BUDGET` in every run;
`PoisonWhole` fails the pixel check, naming the canvas's size.

Record in the PR what the timed runs measured, in both projects, locally and on CI. If Hot Box misses `OWN_BUDGET`
on CI and not locally, do not raise the number: say so in the PR and ask the owner (§9).

## Task 8. The words that describe it

Model: inline

- `engine/ui/cards/body.ts`'s header: the effects that paint the body through the tile layer, and that `paintScale`
  and `paintShare` remain the shine effects' until step 4.
- `engine/ui/cards/bands.ts`'s header: the tile layer is built on it; Whoops! still uses it directly until step 3.
- `instances/divided-world/ui/hot-box/Effect.tsx`'s header: "The container" paragraph says the smoke is drawn in the
  engine's tiles, held only near the viewport, with a stand-in where a tile is not yet painted; the sentence about
  a canvas "scaled down to fit" goes.
- Issue #722: check its first item, with the PR's link.

## Review focus

- **A frame of bare words.** Whether any path shows a smoked post's words unpainted: the mount before the first
  observer report, a fling of more than 256 px in one frame, a resize, a takeover that moves the words, the play's
  end, the waved window's end, a switch into and out of forced colors. The spec samples a steady scroll only.
- **The stand-in against the model.** A far band shows flat fog with no clearing cut in it. A pointer that rests in
  a band whose tile is not yet painted sees fog where the model says clear, for a frame; whether that is ever longer
  than a frame.
- **Seams.** A puff or a clearing that crosses two tiles is drawn in both; whether a line shows at the seam at a
  fractional density (1.5, 2.625) or a fractional box height, on the light and the dark board.
- **Cost at a busy page.** Ten smoked posts in one window hold tiles by the window, not by the post: the count held
  with many short posts (each has at least one tile and one stand-in for each band) and with many layers on one
  post once steps 2 to 5 land.
- **A second run.** `makeTileLayer` under React's double effects in development, a layer stopped mid-frame, and a
  resize or observer report that arrives after `stop()`.
- **The masks.** That the layer and the loop read nothing but a box, the window and the frame clock, and Hot Box
  still reads neither `reader.author` nor `reader.caster` (the getter test).
- **Forced colors and reduced motion.** No layer under forced colors; under reduced motion no loop and tiles painted
  when they are held, with the clearings' steps as today. The paths cost a reader the same as before.
- **The check's list.** Whether each `CANVASES` entry's reason is true of the file, and whether any entry without
  `until` is a canvas that can be sized to a post.
- **The 8 ms.** What the stories measured on CI, in both projects, against the figure the design set without
  measuring.
