Record, written 2026-11-16.

# Steel Chair in a spun thread's ORIGIN box: plan

Carries out `docs/plans/2026-11-16-steel-chair-origin-design.md` (issue #768). One PR from `main`, which closes #768.
The screenshots of the faults, and the mock the owner chose (`mock-a-box-grows.png`), are in
`docs/research/2026-11-16-steel-chair-origin/`.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for `dent.test.ts`, `npx vitest run
<file>` for the `.test.tsx` files, `npx playwright test <spec> --trace off` for the browser). Run `npm run typecheck`
and `npm run build` once after the last task, with the tail in the PR. No deployed database, bucket or connector is
touched, and there is no migration.

**The layers.** Tasks 1, 2 and 4's stories are Divided World's (`instances/divided-world/`). Task 3 is a build tool.
**This build edits no file under `engine/`.** If a task cannot be done without one, stop and ask the owner. The
instance imports the engine's `body.ts` as it does today.

**No state is added** to a player, a character or a post, so there is no way out to name. **No response, payload,
event or timing is added**: every image is made on the reader's own screen from a play's public id and the measured
box, as today.

**What stays as built:** the throw, the chairs and their physics (`body.ts`, `chair.ts`), the room's 77 px and its
mark (`data-dw-chair-room`), the sound, the Lens, the line a moment draws under its post (the engine's, left to
issue #770's design), `filterTrusted`, the bend and the filter, `dentShape`, `dentHeight`, the lighting, `LIGHT`,
`RELIEF`, `SPREAD`, `W0`, `W1`, the two shading layers and their place (`placeLayer`, `data-kb-effect-ink`), forced
colors hiding the shading and the chairs, and what the owner approved by eye: a dent that fills its box at up to
160 px.

**Expected to move:** the unit harness's area is 200 px tall (`Effect.test.tsx`, `size = { h: 200 }`), so Task 1's
height limit changes the dent sizes some tests pin; give those the new size or a taller area, and say which in the PR.
Seeds pinned in `e2e/steel-chair.spec.ts` and `e2e/origin-effects.spec.ts` may land elsewhere once centers are
clamped (Task 1); re-pin a seed, never loosen a bound, and say so in the PR.

## Task 1. The images carry their own alpha, the dent fits its room, and its center is held in

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/dent.ts`, `dent.test.ts`, and the `dent.ts` line of
`tools/check-effect-canvas.mjs` (its `why` only; the count stays 1).

**Tests first** (`dent.test.ts`):

1. *The shade is black with an alpha.* For a shape and size, `dentShade`'s pixels are `(0, 0, 0, 255 - g)` where `g`
   is the gray the present function gives (flat is alpha 0, the darkest exactly 127). Keep the present tests'
   meaning by reading `255 - alpha` where they read the gray.
2. *The light is white with an alpha.* `dentLight`'s pixels are `(255, 255, 255, l)`, `l` the present gray (0 where
   flat, at most 140, the glint's 4% bound unchanged).
3. *Laid over a color, each is what the blend gave.* For a sample of pixels and three post colors (247, 30 and 128
   gray), `c × (1 - a/255)` for the shade equals `c × g/255` within half a level, and `c + (255 - c) × a/255` for
   the light equals the screen of `l` within half a level.
4. *The cap.* `capped(own, earlier)` (below): two dents of different plays whose boxes overlap by half. Composite the
   earlier dent's shade and then the capped later one's over white in arithmetic, pixel by pixel in the later dent's
   grid; in the overlap the result equals `min(g1, g2)` within 2 levels, and outside the overlap the capped image
   equals the uncapped one exactly. The same with three dents overlapping at one point, the third capped against the
   first two. The same for the light against `max(l1, l2)`. No pixel of a capped shade composited over the earlier
   ones leaves less than 128/255 of the color (within 2 levels).
5. *A dent that overlaps nothing is not corrected.* `capped` with no earlier box intersecting returns the same
   pixels.
6. *The height limit.* `dentPrimitives` with `{ width: 600, height: 400 }` gives a larger axis of at most 160; with
   `{ width: 600, height: 62 }` at most 62; with `{ width: 100, height: 400 }` at most 60. A dent with a shape keeps
   its proportions.
7. *The center is held in, in every branch.* `hitZone` for a text taller than the dent, lying against the area's left
   border (`text.left = 0`): for targets at each corner of `THROW_X` by `THROW_Y` in the returned box, the dent's box
   (centered on the target) lies inside the area. The same for a text against the right border and the bottom. The
   short-text cases that exist stay green.
8. *`zoneHeight`.* `zoneHeight(237)` is `160`; `zoneHeight(157)` is `80`; `zoneHeight(156)` is `156` (the room is
   given up below 80); `zoneHeight(0)` is `0`.

**Code:**

- `shadeOf` and `lightOf` write the alpha forms. `dentBend` is unchanged.
- `export const FULL_DENT = 160` (the literal in `dentPrimitives` today) and `export const LEAST_ZONE = 80`.
- `export function zoneHeight(areaHeight: number): number`: `areaHeight - ROOM_HEIGHT` where that is at least
  `LEAST_ZONE`, else `areaHeight`. `ROOM_HEIGHT` is `chair.ts`'s; if importing it into `dent.ts` makes a cycle, pass
  the room as a second argument and let `Effect.tsx` give it.
- `dentPrimitives(dents, box)`: `base = Math.min(FULL_DENT, 0.6 * box.width, box.height)`. Every caller now gives
  the height a dent may land in (Task 2).
- `hitZone`: the tall-text branch no longer returns the text's box as it is. The zone of centers is the range
  `throwOf` would reach in the text's box (`THROW_X`, `THROW_Y` of it), each end clamped to `[radius, extent -
  radius]` on its axis (the `span` helper already there), then turned back into the box to hand `throwOf`, as the
  short branch does.
- The cache keeps, for each play, size and density, the three addresses as today and the two gray maps the shade
  and the light were drawn from (one byte a pixel).
- `export function capped(own, earlier)`: `own` and each of `earlier` are `{ box: DentBox, width, height, shade:
  Uint8Array, light: Uint8Array }` in one coordinate space (the area's px). For each pixel of `own`, at its center:
  `m` is the least of the earlier dents' shade grays there (sampled bilinearly in each one's grid; 255 outside its
  box), `M` the greatest of their lights (0 outside). The corrected shade gray is `255 × min(m, g) / m`; the
  corrected light is `255 × (1 - (255 - max(M, l)) / (255 - M))`. Returns the two gray maps. Pure.
- `dentImages(play, box, density, earlier?)`: with no `earlier`, or none whose box intersects `box`, the kept
  uncapped addresses. Otherwise the bend as kept, and a shade and a light made from `capped`, kept in a second cache
  of at most 8 whose key is the play, size, density, and each intersecting earlier dent's play and offset from this
  one rounded to `1 / density` px.

## Task 2. The effect: no blend, the room it measured, a least height, and a still run that keeps to its box

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `steel-chair.css`, `Effect.test.tsx`.

**Tests first** (`Effect.test.tsx`):

1. *No blend.* The CSS text of `steel-chair.css` holds no `mix-blend-mode` and no `@supports`; `.dw-chair-dents` and
   `.dw-chair-glows` are not `display: none` outside forced colors. Replaces the present `@supports` fallback test.
2. *A later dent is drawn capped.* With three plays whose dents overlap (a pinned seed on the one-line text), the
   second and third dents' `--dw-dent-img` differ from what `dentImages(play, box, density)` gives alone, and the
   first's equals it. Spy on `dentImages` and assert each call's `earlier` is the dents before it in `shown`, with
   their boxes in the area's px.
3. *The dent fits a short area.* `size = { h: 120 }`, the one-line text, 12 seeds: every dent's box lies inside the
   area (top at least 0, bottom at most 120, left and right inside), and its height is at most 120.
4. *The dent fits above the room where there is room.* `size = { h: 200 }`: every dent's height is at most `200 -
   ROOM_HEIGHT` and its bottom at most `200 - ROOM_HEIGHT`.
5. *The tall text's dents are inside.* A text box as wide as the area and 300 px tall in a 400 px area, 12 seeds:
   every dent's box is inside the area.
6. *The least height is the full dent and the room.* The CSS rule for `[data-dw-chair-room]` sets `min-height` to
   `FULL_DENT + ROOM_HEIGHT` px (237), held equal to the constants as the 77 is today.
7. *A still run is drawn again when its box changes.* Mount with `still: true` at `size = { h: 200 }`; the size
   observer is bound on the host and the body and nothing else is (no view observer, no frame, no sound; this
   replaces the "binds no observer" line of the present still test). Set `size = { h: 260 }` and fire the observer:
   the three layers are placed at the new height, every chair is at rest, the dents are drawn, and the picture
   equals the one a fresh still mount at 260 gives for the same plays. Fire it again with nothing changed: nothing is
   drawn again (the render count of the chairs does not move).
8. *A still run is drawn once where nothing changes.* The present "same picture twice over" test stays green.

**Code:**

- `steel-chair.css`: delete the `display: none` pair, the `@supports` block's gate and all four `mix-blend-mode`
  lines; the two `background` declarations stand unconditionally. Add `min-height: 237px` to a
  `[data-dw-chair-room]` rule, with the comment that where the engine gives the area a least height of its own (a
  post's body) that rule stands. Rewrite the file's comment on the shading for what is now true.
- `Effect.tsx`:
  - `Geo` gains `zone: number`, the height a dent may land in: `zoneHeight(box.h)` at each `measure`, part of
    `sameGeo`.
  - `aim`: the dent is `dentPrimitives(..., { width: geoNow?.width ?? box.w, height: zoneHeight(box.h) })`, and the
    area handed to `hitZone` is `{ width: box.w, height: zoneHeight(box.h) }`. The present `above >= …` choice goes
    into `zoneHeight`.
  - The render's `dentPrimitives` call and the resize handler's radius use `{ width: off.width, height: off.zone }`.
  - `images`: `shown.map((d, i) => dentImages(d.play, prims[i]!, density, earlierOf(i)))`, where `earlierOf(i)` is
    the dents before `i` with their boxes moved into one space (`prims` are in the wrapper's px; add `off.left`,
    `off.top` to both, or leave both in the wrapper's, as long as it is one space).
  - `startWatching` is split: the view watch stays live-only; the size observer is bound for a still run too. Its
    callback for a still run: `if (!measure()) return; clearRun(true); startRun();` with the observer kept (do not
    disconnect it in that path), and the same seed (`seedOfIds` of the plays, as `startRun` already takes for
    `still`).
  - The header comment: the shading's sentence, the still run's, and the zone's.

## Task 3. A build check: no effect blends with what is behind it

Model: sonnet

**Files:** `tools/check-effect-blend.mjs`, `tools/test-effect-blend.mjs`, one line in `STEPS` of `tools/build.mjs`
immediately after `check-effect-canvas`.

**The check** reads every `.css` under `engine/ui/` and `instances/`, and every non-test, non-story `.ts`/`.tsx`
there, and fails on a `mix-blend-mode` declaration with a value other than `normal`, or a `mixBlendMode` property in
an inline style, naming the file and line. Its header says why: an element that blends takes its backdrop from the
nearest stacking context, and a place that shows a post (the ORIGIN box's area) or another card's wrapper may make
one with nothing painted in it, so the blended image is drawn as it is (issue #768). It says what it cannot see (a
blend set through a custom property or a computed style name). `background-blend-mode` is not its concern: it blends
an element's own backgrounds. `engine/mail/` is not read.

**The self-test, first, red:** a planted CSS file with `mix-blend-mode: multiply` fires, naming file and line; a
planted `.tsx` with `style={{ mixBlendMode: 'screen' }}` fires; `mix-blend-mode: normal`, the words in a comment, a
`background-blend-mode`, and a test file stay clean; and the real tree is clean (which is red until Task 2 has
landed, so this task comes after it).

## Task 4. The stories and the browser

Model: sonnet

**Files:** `instances/divided-world/ui/OriginEffects.board.stories.tsx`,
`instances/divided-world/ui/steel-chair/Chair.board.stories.tsx`, `e2e/origin-effects.spec.ts`,
`e2e/steel-chair.spec.ts`, and whatever lists the board stories
(`e2e/board-stories.ts`).

**Stories:**

- `ChairLanded`: a thread spun from a Steel Chair play on a post that reads `!` (the case of #768; seed it as
  `WhoopsLanded` is, with the cards met so no tip covers the box). `ChairLandedPhone`: the same at the phone's width
  (`globals: phone`).
- `WithFab` in the Steel Chair stories: the three-paragraph post with Steel Chair and Feelin' Fab both on it.

**Cases, each with its poison:**

1. *No block.* In `ChairLanded`, `ChairLandedPhone` and `WithFab`, with the present `shading`/`pair` helpers: the
   four corners of each dent's box (4 px squares, where the image's alpha is 0) are the same pixels with the shading
   shown and hidden, within 2 levels. Poison: the shade image made opaque again (alpha 255, gray kept).
2. *The dent is in the area.* In `ChairLanded` at both widths and `chair-short`: every dent's box is inside the
   area's padding box and its top is at or below the band's bottom (so no dent lies over the band's words). Poison: `zoneHeight` returning the area's
   height plus 40.
3. *The box grew.* In `ChairLanded` at both widths the area's content height is at least 237 px and the dent's
   larger axis is over 100 px. Poison: the `min-height` rule deleted.
4. *The chair is on the floor, and the layers fill the area, after the box changes.* `ChairLanded` joins the loop of
   case 7 (floor, walls, room). Then the viewport is set from 1440 to 390 wide: `fills` holds for the three layers
   again and the chair's bottom is within `ROOM_HEIGHT` of the area's bottom. Poison: the still run's size observer
   not bound.
5. *The cap still holds.* The present `theLineCanBeRead` cases (`worstGap`, `deepest`, the 4.5:1 glyph contrast, the
   dark theme's tenths) stay green with no bound changed.
6. *axe* finds nothing on the three new stories.

**Seen in WebKit, once, by the build session.** If Playwright's WebKit is installed locally (`npx playwright
install --dry-run` lists it; do not download one): build with `npx vite build web --mode e2e --minify false` (the
minified build does not parse there, issue #769), serve it on a port of its own (`KB_E2E_PORT`), and run cases 1 to
4 with `--browser=webkit`. Put the output in the PR. If it is not installed, say so plainly in the PR. CI stays on
Chromium.

**Screenshots for the owner's word:** `ChairLanded`, `ChairLandedPhone` and `WithFab`, light and dark, in the shared
notes folder and linked from the PR. The owner looks at the phone story on a phone.

## Review focus

- A capped image is made on the main thread each time a dent lands on another (at most two a run, each at most 320 px
  square). Issue #755 already asks what a dent's images cost; this adds to it where dents overlap, and never grows
  with the instance.
- The cap's sampling is bilinear between two grids at a sub-pixel offset, and the browser stretches both images to
  their boxes: the product can miss the minimum by a level or two. The unit bound is 2 levels; `worstGap` is the
  browser's word.
- A still run drawn again on a size change must not loop: the run's own drawing changes no size (the room is static,
  the layers are absolute), but a content area whose size depends on what the effect draws would. WebKit already logs
  "ResizeObserver loop completed with undelivered notifications" for the live run.
- The cache now keeps two gray maps for each of 32 dents (at most about 100 kB each): bounded, but more than
  addresses.
- Plays an instance already holds: nothing stored changes. The same id gives the same shape; a dent in a short area
  is smaller than it was, and a tall text's dent may land a few pixels further in.
- The 237 px applies to any content area the effect marks. A place added later that shows a post in a small bordered
  box gets it too; whether that is wanted there is that place's design.
- The moment's line under the post stays on its own ground and cuts a strip through the dent, and it is what makes
  the area grow after a still run's first measure. Both are as the engine has them; issue #770's design decides the
  line.
- Not seen on a real iPhone. The moment's rule itself (drawn still) is under question in issue #770; nothing here
  depends on its answer except Task 2's still-run change, which goes with the still path if that rule changes.
