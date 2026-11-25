# Rendered gear: the plan

Record, written 2026-11-23. It carries out `docs/plans/2026-11-23-rendered-gear-design.md`, and surveys the same files.
Tasks run in order. Each goes test first: the failing test and its red run, then the code. The whole build
(`npm run typecheck`, then `npm run build:ci`) is green at the end of every task.

## Task 1: the geometry and the view, in the rules

Model: sonnet

Files: `engine/rules/cosmetics.ts`, `engine/rules/cosmetics.test.ts`.

The design's sections 2 and 6. In `engine/rules/cosmetics.ts`:

- `export const GEAR_VIEWS = ['side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right'] as const`
  (the Facing row's order, section 7) and `export type GearView = (typeof GEAR_VIEWS)[number]`.
- `Piece` gains `readonly view: GearView | null`, null meaning the item's default.
- `export interface GearViewShape { readonly width: number; readonly height: number; readonly pivot: { readonly x: number; readonly y: number } }`,
  in the picture's own pixels, and `export interface GearShape { readonly default: GearView; readonly views: Readonly<Partial<Record<GearView, GearViewShape>>> }`.
- `shownView(item: GearShape, view: GearView | null): GearView`: `view` when the item ships it, else `item.default`.
- `pieceShape(piece: Piece, item: GearShape): { w: number; aspect: number; px: number; py: number }`, for the view
  shown: `w` is `piece.w * shown.width / default.width`, `aspect` is `shown.height / shown.width`, and `px`, `py` are
  the pivot as fractions of the shown picture (`pivot.x / width`, `pivot.y / height`).
- `pieceExtent(piece, shape, height)`: the turned box's `left`, `right`, `top` and `bottom`, in units of the box's
  width, where the box is 1 wide and `height` tall (the portrait's tallness, or 1 for the square) and the pivot sits at
  `(piece.x, piece.y * height)`. It turns the picture's four corners, offsets from the pivot of `-px*w .. (1-px)*w`
  across and `-py*w*aspect .. (1-py)*w*aspect` down, by `piece.turn` about the pivot, and takes their bounds.
- `pieceHolds(piece, shape, height, qx, qy)`: whether the point (in the same units) lies in the turned picture: the
  point turned back by `-turn` about the pivot falls inside the unturned rectangle.
- `outfitOverhang` takes `shapeOf: (piece: Piece) => ReturnType<typeof pieceShape> | undefined` in place of
  `aspectOf`, and reads `pieceExtent(...).top`: the overhang is `max(0, -top)` over the pieces, capped at `reach` as now.
  Its comment is rewritten for the pivot.
- `pieceProblem` returns `'view'` for a `view` that is neither null nor one of `GEAR_VIEWS`, checked after `turn` and
  before `layer`.

Tests to write first, in `cosmetics.test.ts`, each red before the code:

- `shownView`: a shipped view comes back; an unshipped one, and null, give the default.
- `pieceShape`: a fixture item with a default view 400 by 200 with its pivot at (200, 150), and a second view 280 by
  220 with its pivot at (100, 165). Worn at `w` 0.5 in the second view, its `w` is 0.35, its aspect 220/280, its pivot
  fractions (100/280, 0.75).
- `pieceExtent`: unturned, a piece with its pivot at its center gives today's center-and-aspect box; a piece whose pivot
  is its bottom-left corner, unturned, extends only right and up; turned 90 degrees, the same piece's box is the one
  worked by hand in the test.
- `pieceHolds`: a point just inside a turned corner holds, a point just outside does not.
- `outfitOverhang`: the existing cases still pass with a center pivot (each item's one view with its pivot at its
  center), and a new one: a cap whose pivot is its band, placed at `y` 0, stands above the slot by the picture's
  height above the pivot.
- `pieceProblem`: `view: 'back'` gives `'view'`; null and each of the five give null.

Every other `Piece` literal in the repository gains `view: null` (the type check names them; the fakes, stories and
tests).

## Task 2: the column, the checks and the reads

Model: sonnet

Files: `supabase/migrations/NNNN_gear_views.sql` (new; NNNN is the next free number when the build starts),
`supabase/tests/NNNN-gear-views.sql` (new),
`supabase/tests/e2e/0003-export.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, and the test that holds a TS
list and a SQL list to one (below).

The design's section 6. Before writing, confirm by grep that no migration after 0206 redefines `profile_projection`,
none after 0205 redefines `piece_problem` or `set_outfit`, and none after 0210 redefines `profile_cosmetics`; if one
does, that later definition is the one copied. The migration, each function written again whole with a header comment
that names the one it replaces and says "Everything else as NNNN wrote it":

- `alter table gear_worn add column view text check (view in ('side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right'))`,
  nullable, with a comment: null is the item's default; which views an item ships is the instance's art, not held here.
- `piece_problem` (0205): after `turn`, a `view` that is present, not JSON null, and not one of the five returns
  `'a piece''s view is side-left, three-quarter-left, front, three-quarter-right or side-right'`.
- `set_outfit` (0205): writes `pc ->> 'view'` (JSON null and a missing key both give SQL null).
- `profile_projection` (0206) and `profile_cosmetics` (0210): each outfit object gains `'view', w.view`.

`web/src/data/supabase.ts`: the `gear_worn` select gains `view`, and `toPieces` reads it, giving null for anything not
one of `GEAR_VIEWS`. `engine/ui/data/fake.ts`'s `setOutfit` keeps the view it is given and refuses as `piece_problem`
does.

The five names are now in two lists, `GEAR_VIEWS` and the column's check. Find how the repository already holds a
TypeScript list and a SQL list to one (grep for a `.test.ts` that reads `supabase/migrations/`) and add this pair to it
the same way, so that a name added to one and not the other fails the build.

Tests to write first:

- `supabase/tests/NNNN-gear-views.sql` (pgTAP, on localhost): `set_outfit` saves a piece with `view` `side-left` and
  `profile_cosmetics` and `profile_projection` give it back; a piece with no `view` reads back null; `view` `back` is
  refused with the words above; a row inserted with `view` `back` straight into `gear_worn` violates the check.
- `0003-export.ts`: the inserted `gear_worn` row gains `view` `three-quarter-right`, so the round trip carries it.
- `toPieces`: a row with `view` `front` and a row with `view` `sideways` read as `front` and null.
- The list test, driven red once by adding a sixth name to `GEAR_VIEWS` in a scratch copy, then removed.

## Task 3: the engine draws a view, and the instance ships folders

Model: sonnet

Files: `engine/ui/types.ts`, `engine/ui/gear/Outfit.tsx`, `engine/ui/gear/Outfit.test.tsx`, `engine/ui/wardrobe/moves.ts`,
`engine/ui/wardrobe/moves.test.tsx`, `engine/ui/wardrobe/Wardrobe.tsx`, `engine/ui/postbit/Postbit.tsx`,
`engine/ui/events/RandomEvent.tsx`, `instances/divided-world/ui/cosmetics.ts`, `instances/divided-world/ui/gear/`,
`instances/divided-world/ui/index.test.tsx`, and every story and test that builds an `InstanceUi.gear` entry.

- `engine/ui/types.ts`: `GearViewArt extends GearViewShape { readonly art: string }`, and `InstanceUi.gear` becomes
  `Readonly<Record<string, { readonly default: GearView; readonly views: Readonly<Partial<Record<GearView, GearViewArt>>> }>>`.
  Its comment says what each field is and that a rendered item's numbers come from its `views.json`.
- `Outfit`: each piece is drawn from `shownView`'s art. `left` and `top` place the pivot; `width` is `pieceShape`'s `w`;
  `aspectRatio` its aspect; `transform-origin` is the pivot (`px%` `py%`); `transform` is
  `translate(-px%, -py%) rotate(turn)`. `touchesSquare` is replaced by `pieceExtent` with height 1. The header comment
  says the pivot is what `x` and `y` place.
- `moves.ts`: `hit` takes `shapeOf` in place of `aspectOf` and uses `pieceHolds`. `dragSized` and `dragTurned` already
  measure from `x`, `y`, which is now the pivot; their comments say so.
- `Wardrobe.tsx`: the selection box is drawn as `Outfit` draws the piece (pivot, `transform-origin`, the shown view's
  width and aspect), so its handles hug the view; the carousel shows each item's default view; a piece loaded with a
  view its item does not ship has its view set to null in the draft. `Postbit.tsx` passes `shapeOf` to
  `outfitOverhang`. `RandomEvent.tsx` shows the default view's art.
- The instance: each of the five `ui/gear/<key>.svg` moves (`git mv`) to `ui/gear/<key>/front.svg`, with a
  `views.json` beside it: `{ "default": "front", "views": { "front": { "width": W, "height": H, "pivot": { "x": W/2, "y": H/2 } } } }`,
  W and H its viewBox's. `cosmetics.ts` imports each file's URL and its `views.json`, and builds each entry from them,
  so no number is typed twice. Its header comment says this, and drops "from the SVG's viewBox".

Tests to write first:

- `Outfit.test.tsx`: a piece whose item's pivot is its bottom-left corner is drawn with `transform-origin: 0% 100%` and
  `translate(0%, -100%)`; a piece in a view its item does not ship draws the default view's URL; on the square, a piece
  whose pivot is outside the square but whose picture reaches into it is drawn, and one wholly outside is not.
- `moves.test.tsx`: `hit` finds a piece by a point near its pivot-side edge, and misses a point the old center box held
  but the pivot-placed picture does not.
- `instances/divided-world/ui/index.test.tsx`: "every gear has art and an aspect" becomes "every gear has a default
  view it ships, and each view a URL, a size and a pivot inside it"; "each gear piece's aspect is its viewBox" becomes
  "each SVG view's `views.json` size is its viewBox", reading `ui/gear/<key>/<view>.svg`; the bare-SVG test reads the
  gear folders.

## Task 4: the Facing row

Model: sonnet

Files: `engine/ui/wardrobe/Wardrobe.tsx`, `engine/ui/wardrobe/wardrobe.css`, `engine/ui/wardrobe/Wardrobe.test.tsx`,
`engine/ui/wardrobe/Wardrobe.stories.tsx`, `engine/ui/wardrobe/Wardrobe.board.stories.tsx`.

The design's section 7. In the Selected panel, under the size and turn buttons, when the selected piece's item ships
more than one view: a radio group labeled "Facing", one option per shipped view in `GEAR_VIEWS` order, each a small
picture of that view (`alt=""`, the option named by its words: "Side, facing left", "Three-quarter, facing left",
"Front", "Three-quarter, facing right", "Side, facing right"). The shown view (`shownView`) is checked. Choosing one
changes the piece through the page's `change`, so it is a draft change like a nudge, with the live words
"`<name>` now faces `<words>`." Arrow keys move along the group as a radio group does. Styled in the dress-up page's own
glass look, with its focus ring and the contrast the glass contrast check holds. The board story's fixture item ships
five views (small SVG fixtures in the story, not the instance's art).

Tests to write first, in `Wardrobe.test.tsx`:

- a one-view item shows no Facing group;
- a five-view item shows five options in order, with the default checked when the piece's view is null;
- choosing "Side, facing right" checks it, says the live words, marks the page as changed, and the saved outfit carries
  `view: 'side-right'`;
- the arrow keys move the choice;
- the pivot stays put: after a view change the piece's `x` and `y` are unchanged.

The a11y self-test the page already runs covers the group's labels.

## Task 5: one reading of art files, and the gear guard

Model: sonnet

Files: `tools/art-files.mjs` (new), `tools/check-card-art.mjs`, `tools/check-gear-art.mjs` (new),
`tools/test-gear-art.mjs` (new), `tools/build.mjs`.

The design's section 3.

- `tools/art-files.mjs` takes, from `tools/check-card-art.mjs`, `safetyFaults` and the SVG helpers it uses, and a WebP
  header reader `webpInfo(bytes)` returning `{ width, height, alpha, animated }` or a fault ("is not a WebP image",
  "is not a WebP image this guard can read"), with `alpha` read from bit 4 (value 16) of a `VP8X` file's flags byte
  at 20, and false for `VP8 `; `VP8L` reads its alpha hint bit (bit 28 of the value at 21). `check-card-art.mjs`
  imports both, and its `webpFaults` keeps its own words over `webpInfo`; its self-test is unchanged and stays green,
  which is what shows the move changed nothing.
- `tools/check-gear-art.mjs`, header comment in the card guard's manner, for every `instances/*/ui/gear/<key>/`
  (a folder named as a key, as the card guard decides it):
  1. `views.json` is there, parses, and is at most 2 KB; its `default` is a key of its `views`; every key of `views`
     is one of the five; `views` is not empty.
  2. Each listed view has exactly one of `<view>.webp` and `<view>.svg`; a `<view>.*` file for a view not listed, or a
     picture named for no view, is a fault.
  3. Each view's `width` and `height` are whole numbers, its `pivot.x` within 0 to `width` and `pivot.y` within 0 to
     `height`.
  4. A WebP: `webpInfo` reads it, its size is `views.json`'s, its longest side is at most 1024, it has alpha, it is not
     animated, and it is at most 200 KB.
  5. An SVG: its viewBox's width and height are `views.json`'s, `safetyFaults` finds nothing, and it is at most 50 KB.
  6. A flat `ui/gear/*.svg` (the old layout) is a fault naming the file and the new layout.
- `tools/build.mjs`: `'node tools/test-gear-art.mjs'` then `'node tools/check-gear-art.mjs'`, after the card art pair.

Tests to write first, in `tools/test-gear-art.mjs`, in `test-card-art.mjs`'s manner (a temporary repository per case,
real WebP fixtures as base64: a 64 by 32 lossy image with alpha (`VP8X` with `ALPH`), the same without alpha, and a
2000 by 10 one with alpha):

Green: a folder with one SVG view; a folder with three WebP views and a `model.blend` and `rig` input file beside them
(files that are not pictures are not read).

Poisons, each failing with its fault named: no `views.json`; `views.json` not JSON; a `default` not among the views; a
view named `back`; a listed view with no file; a view with both files; a `front.webp` not listed; a pivot at
`width + 1`; a WebP whose size disagrees with `views.json`; the 2000 by 10 WebP (over 1024); the WebP with no alpha;
the alpha fixture with its animation flag set; a WebP padded past 200 KB; an SVG whose viewBox disagrees; an SVG with a
`<script>`; a flat `ui/gear/cap.svg`.

## Task 6: the gear rig, and the cap

Model: sonnet

Files: `instances/divided-world/ui/gear/rig.py` (new), `instances/divided-world/ui/gear/README.md` (new),
`instances/divided-world/ui/gear/baseball-cap/` (its `front.svg` replaced), `instances/divided-world/ui/cosmetics.ts`,
`specs/gear-art.md` (new).

The design's sections 4 and 5. This task runs Blender 4.5 on the build session's machine (`blender -b`); it touches no
database.

- **The model.** Copy `docs/research/2026-11-23-gear-renders/hat.blend` to `instances/divided-world/ui/gear/baseball-cap/model.blend`
  (the record stays as it is). In it: delete the hidden `Cylinder` and `Sphere`, the camera and the light; add an
  empty named `pivot` at the middle of the cap's band, on the dome's vertical axis (the research README's 0.044 along
  x, 0 along y, measured again from the mesh) at the height of the dome's lowest rear edge; the brim already faces +X.
  Save it with a short script run once under `blender -b`, kept in the PR description, not the repository.
- **The rig** (`rig.py`, run as `blender -b -P rig.py -- <key>` from `ui/gear/`), all in Blender's own Python and its
  bundled numpy (no Pillow):
  1. Reads `<key>/views.json` for the views to ship and the default; for an item with no `views.json` yet, a
     `--views a,b,c --default b` argument.
  2. Builds the scene from nothing: Eevee (whichever of `BLENDER_EEVEE_NEXT` and `BLENDER_EEVEE` the build has), the
     AgX view, a world of flat gray (0.154, strength 1), a transparent film, a 50 mm camera and one point light.
  3. Appends every object in `<key>/model.blend` but `pivot`, and moves them so `pivot` is at the origin.
  4. Places the camera and the light as `hat.blend` had them relative to the cap, with the camera swung onto the +X side
     (the side the item's front faces), looking along -X at it, pitched 6 degrees down. Distances scale with the item's radius (the farthest vertex from the
     vertical axis through the pivot, and the height range) over the cap's, and the light's energy with that factor
     squared, so the cap is lit exactly as in `hat.blend` and every other item alike in proportion. The rig's header
     comment gives the numbers and where they came from.
  5. For each view (`front` 0, `three-quarter-right` +35.5, `three-quarter-left` -35.5, `side-right` +90,
     `side-left` -90 degrees about the vertical axis), renders a square picture at 2048 px, crops to the alpha's
     bounds plus two pixels, and records the pivot's pixel (the origin projected by `world_to_camera_view`) less the
     crop's corner.
  6. Scales every view of the item by one factor, so the longest side of the largest view is 1024, and writes each as
     `<view>.webp` (quality 90, RGBA) and `views.json` (default, and each view's width, height and pivot, rounded to
     whole pixels).
- **The cap.** Render it with all five views and `three-quarter-right` as the default; delete its `front.svg` and the
  old `views.json`. `cosmetics.ts` needs no change beyond the cap's imports (it reads `views.json`).
- **Look at it.** Make a sheet as the research one was (each view bare on a checkerboard, and each worn on the
  placeholder portrait at one `x`, `y` and `w`, the pivot marked) in the scratchpad, and put it in the PR description.
  The cap's three-quarter-right view should match `docs/research/2026-11-23-gear-renders/verify-original.png` in light
  and shade; say in the PR how it compares.
- **`instances/divided-world/ui/gear/README.md`**, in the card art README's manner: what an item's folder holds; how
  to model one for the rig (front toward +X, the `pivot` empty, real-world proportions do not matter); the command; that
  the files are what ship and the model is how to make them again, with nothing in the build holding one to the other;
  and that an SVG item is drawn with its `views.json` written by hand.
- **`specs/gear-art.md`**, the engine's contract, as `specs/card-art.md` is for cards: the five views and their order,
  `views.json`'s fields, what `x`, `y`, `w` and `turn` mean against the pivot and the default view, the file rules, and
  that the guard is `tools/check-gear-art.mjs`.

Tests: `instances/divided-world/ui/index.test.tsx` (task 3's) and the guard (task 5's) hold the cap's files. No new test
is written for the rig, whose output is pictures; the sheet is the check, and the owner reviews it.

## Task 7: the whole build

Model: inline

Run `npm run typecheck`, then `npm run build:ci`, and the pgTAP and e2e suites the build session's skill names, on
localhost. Paste the tail of each into the PR. Open the dress-up page in the dev server with the fake data, put the cap
on a mask, switch through its five views, and put a screenshot of two views in the PR.

## Review focus

- **Worn pieces an instance already holds.** Every `gear_worn` row today places its item's center. After this change
  `x`, `y` place the pivot. For the four placeholders the pivot is the center, so nothing moves; a cap worn before
  this change sits by its band instead of its middle, and is drawn at the default three-quarter view's width. A test
  instance's caps move; nothing is migrated.
- **Two lists of five names**: `GEAR_VIEWS` and the column's check. Task 2's test is the only thing holding them to one.
- **The geometry has one home.** `pieceExtent` and `pieceHolds` replace three copies; check that no center-and-aspect
  box is left anywhere a piece is drawn, hit or measured (grep for `aspect` in `engine/ui/gear`, `engine/ui/wardrobe`
  and `engine/ui/postbit`).
- **A view drawn as the default.** A stored view the item does not ship must draw, size and hit-test as the default
  everywhere, and never fail a save.
- **Art weight on a busy board.** A postbit with twelve rendered pieces fetches twelve files of up to 200 KB once,
  cached across masks; check that the files the rig writes for the cap sit well under the cap.
- **The rig and its model drift.** Nothing in the build holds a render to its model; the README says so.
