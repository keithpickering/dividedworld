Record, written 2026-11-27.

# Graffiti that holds up on every screen, and on the wall: plan

Design: `docs/plans/2026-11-27-graffiti-everywhere-design.md`. The bench the coat numbers come from is
`docs/research/2026-11-27-graffiti-everywhere/01-scrub-bench.html`. Nine tasks. Each writes its tests first and shows their
red run. Order: 1 and 2 first (they are independent of each other); 3 after 2; 4 and 5 after 1 to 3; 6 after 4 and 5; 7 and 8
after 6; 9 last.

Names used throughout:
- **A group** is `{ at, anchor, unit, em?, strokes }` (task 3 holds its exact shape). **A place** is where a group is attached
  for the post's current version: its own anchor, a mapped one, or `null` for its box spot.
- **Tenths.** Coats are kept in tenths of a coat, 0 to 40 per cell. A cell is painted while it holds 2 tenths or more; at 1 or
  less it is clean and is set to 0.
- **A coat string** is 10,000 characters, one per cell, row-major as `toBits`, over the alphabet
  `0123456789abcdefghijklmnopqrstuvwxyzABCDE` (index = tenths). Postgres compresses a mostly-zero string well, as it does the
  `cells` bit strings today.

## Task 1: attachments, groups and the edit mapping (engine rules)

Model: sonnet

**Files.** New `engine/rules/anchor.ts` and `engine/rules/anchor.test.ts`. Read first: `engine/bbcode/visible.ts`
(`visibleWalk`, `SEPARATOR`), `engine/bbcode/parse.ts` (`parse`, the `img` node), `engine/rules/surface.ts`.

Pure, no DOM. Header comment: the design's sections 1, 2, 3 and 6, in the file's voice.

- **Types.** `Attachment =
  { kind: 'text'; version: string; at: number; len: number; dx: number; dy: number } |
  { kind: 'image'; version: string; n: number; src: string; nth: number; x: number; y: number } |
  { kind: 'box' }`.
  - Text: `at` is an offset into the version's visible text and `at + len` the end of the word there. `dx`, `dy` is the group's
    center from the left edge of the character at `at` and the top of its line, in ems.
  - Image: `n` is the image's index among the post's images in tree order, `src` its address, and `nth` which copy of that
    address it is. `x`, `y` is the group's center in the image's shares (it may lie outside 0 to 1).
  - `version` is the version's id as the server names it: the post's own Act id, or its latest edit's.
- **`contentOf(body: string): { text: string; images: { src: string; nth: number }[] }`.** The visible text (`visibleWalk(parse(body)).text`)
  and the images in tree order, quotes included, with each image's `nth`. It walks the tree with its own stack, as `visibleWalk`
  does.
- **`groupsOf(strokes: { points: [number, number][]; r: number }[]): number[][]`.** Indices of strokes per group, in px of one
  frame. First the figures: strokes whose cores touch (two capsules within the sum of their radii, tested segment to segment)
  are one figure, by union-find. Then the groups: two figures join when the gap between their bounding boxes is less than the
  taller figure's height, followed through by union-find. Groups are ordered by their first stroke.
- **`mapPlace(from: { text: string; images: Img[] }, to: { text: string; images: Img[] }, a: Attachment): Attachment | null`.**
  - Text: a character diff of `from.text` against `to.text` (Myers, O((N+M)·D), with a cap of 2,000 on D past which every
    text group falls back). The attachment survives when `[at − 8, at + len + 8]` (held to the text) lies inside one unchanged
    stretch. It is then moved by that stretch's shift. Otherwise `null`.
  - Image: the image in `to` with the same `src` and `nth`, or `null`.
  - Box: unchanged.

**Tests first.**
- `contentOf`: a body with `[b]bold[/b]`, a quote holding an image, and two copies of one address gives the visible text
  `visibleText` gives, and images numbered in tree order with `nth` 0 and 1 for the copies.
- `groupsOf`:
  - The five letters of HELLO drawn as Stock strokes at 70px letters with 22px gaps are one group.
  - A ring and an arrow whose tip stops 10px from the ring are one group.
  - A ring and a "??" 300px away are two groups.
  - A dot under a "?" (a gap less than the "?"'s height) joins it.
  - Groups keep the order of their first strokes.
- `mapPlace`:
  - A typo fixed 30 characters before the run moves `at` by the change.
  - A typo inside the run, or within 8 characters of it, gives `null`.
  - Text added after the run leaves `at` as it was.
  - A rewrite that keeps the word somewhere else gives `null` (no search).
  - An image whose second copy is removed keeps the first copy's attachment and gives `null` for the second's.
  - A box attachment comes back unchanged.
  - A diff past the cap gives `null` for text.

## Task 2: coats (engine rules)

Model: sonnet

**Files.** `engine/rules/surface.ts`, `engine/rules/surface.test.ts` (or a new `engine/rules/coats.test.ts` beside it),
`engine/rules/cards.ts` (`CardRules.surface`, `decideDraw`, `decideWash`, `surfaceMost`).

- **In `surface.ts`**, beside `cellsOf` (which stays):
  - `export type Coats = Uint8Array` (10,000 tenths).
  - `coatsOf(strokes: readonly SurfaceStroke[], rules: { line: number; most: number }): Coats`: each stroke's `cellsOf([stroke])`
    adds `line` to its cells, once per stroke, held to `most`.
  - `takesOf(presses: readonly (readonly [number, number])[], radius: number, aspect: number): Coats`: each press is a disc of
    radius `R = 2 · radius` (a share of the box's width, the y axis divided by `aspect` as `cellsOf` does). It takes
    `10 · PER · (1 − d²/R²)³` tenths at each cell center within `R`, where `PER = (radius / 3) / (R · 32 / 35)`. The sum is
    rounded to whole tenths per cell, at most 40.
  - `minusCoats(a, b)`: each cell `max(0, a − b)`, with 1 or less set to 0. `paintedCount(c)`: the cells holding 2 or more.
  - `toCoatString` / `fromCoatString` (the alphabet above; a string not 10,000 characters of it throws, as `fromBits` does).
    `legacyCoats(cells: Cells, line: number)`: `line` on each set cell.
- **In `cards.ts`:**
  - `CardRules.surface` gains `coats: { line: number; most: number }` (in tenths), and `validateWash` changes to
    `(input: unknown) => Verdict<{ cuts: readonly { draw: Id; presses: readonly [number, number][] }[]; payload }>`. The
    presses are in the draw's own frame (shares of its drawer's box), turned there by the card, which knows the draw's
    shape (task 3).
  - `validateWash` is given the live draws it cuts as a second argument, `(input, draws: ReadonlyMap<Id, unknown>)`, payloads
    as stored, so it can place a group's presses in its drawer's frame. Each of its cuts also names the draw's `radius` (the
    sponge's, as a share of that drawer's box width) and `aspect`.
  - `decideDraw` returns `{ payload, coats: string, most }`, with `coats = toCoatString(coatsOf(strokes, surface.coats))`.
  - `decideWash(rules, settings, input, draws)` returns `{ payload, takes: { draw: Id; takes: string }[] }`, one entry per
    cut draw with `takesOf` of its presses as a coat string.
  - `surfaceMost` is unchanged (cells).

**Tests first.**
- A straight pass of presses every third of the radius across a 2-coat stroke takes 10 tenths (±1) at the stroke's center
  and leaves it see-through. A second pass leaves it clean (the bench's quick line).
- Three strokes crossing one patch stack to 40 and no higher, and one stroke that crosses itself lays its line once.
- `takesOf` is zero at `R` and beyond. `paintedCount` counts 2 and not 1.
- A coat string round-trips, and `fromCoatString` throws on a 9,999-character string and on a character outside the alphabet.
- `legacyCoats` lays `line` on exactly the set cells.
- `decideDraw` on a test card with a surface gives a coat string that decodes to `coatsOf` of its strokes.
- `decideWash` names one entry per cut draw.

## Task 3: Graffiti's draw, wash and words (instance)

Model: sonnet

**Files.** `instances/divided-world/cards/graffiti.ts`, `graffiti.test.ts`, `instances/divided-world/cards/graffiti/stencils.ts`
(read), `instances/divided-world/cards/graffiti/words.ts`, `instances/divided-world/ui/cards/graffiti/ui.ts`,
`engine/ui/cards/lens-words.ts` and the tests that pin its sentence (`engine/ui/cards/lens.test.tsx`).

- **Sizes, exported:**
  - `CAPS_EM = { skinny: 0.4, stock: 1.07, fat: 2.67 }`, `SPONGE_EM = 4`, `STENCIL_EM = 12`.
  - `COATS = { line: 20, most: 40 }`, given as `surface.coats`.
  - `CAPS` and `SPONGE` stay for reading stored draws and washes.
- **A new draw** is `{ box: { w, h }, groups: Group[] }`:
  - `box` is the drawer's box in ems, `w` from 5 to 200 and `h` from 1 to 4,000.
  - `Group = { at: [x, y], anchor: Attachment, unit: 'em' | 'image', em?: number, strokes: { can, cap, points }[] }`.
    - `at` is the group's center in shares of the drawer's box, 0 to 1.
    - `points` are in the group's units from its center: ems, from −200 to 200; or image widths, from −10 to 10.
    - `em` is required for `unit: 'image'`: how many ems one image width was, from 0.5 to 400.
  - The bounds of today hold across all groups (120 strokes, 300 points each, 3,000 in all), plus at most 120 groups.
  - An attachment is checked for shape only: an image attachment needs `unit: 'image'`; a text or box attachment needs
    `unit: 'em'`.
- **What `validateDraw` gives the engine:** the strokes framed in the drawer's box. Each point becomes
  `at + point · scale`, where `scale` is `1 / box.w` across and `1 / box.h` down for ems, and `em / box.w` and `em / box.h`
  for image widths. Each stroke's width is `CAPS_EM[cap] / box.w` (times nothing more for an image group, since its caps are
  in ems), and its aspect is `box.w / box.h`. Points framed outside 0 to 1 are held to it, for the count only; the payload
  keeps them as drawn.
- **A stencil** `{ stencil, can, spot }` is expanded, as today, into one group. It has a box attachment, `at` the center of
  its spot's cell, and its strokes scaled so the stencil is `STENCIL_EM` across. Its framed count uses a reference box of
  65.9 by 46.7 ems (988 by 700 px at 15px), since a Mod Bot has no screen.
- **A new wash** is `{ cuts: { draw, group, presses }[] }`. `presses` are in that group's units, from its center, at most
  3,000 in all. `validateWash(input, draws)` refuses a cut of a draw not in `draws`, or a group the draw does not have. It
  frames each cut's presses as a draw's points are, and names the draw's radius (`SPONGE_EM / 2 / box.w`) and aspect.
- **A stored draw or wash of the old shape** (`{ strokes }`, `{ strokes, cells }`) is read where a payload is read (the
  painter, `describeDraw`), and is never accepted by `validateDraw` or `validateWash` again.
- **Words.**
  - `ui.ts`'s `describe` reads: `A Pepperoni card, ${rarity}. It turns a post into a wall. Any character can tag it with
    spray cans, drawing freehand or placing a stencil, and the wall holds up to ${limit}% of the post, counting each tag's
    own paint, even where it covers another tag. A reader can scrub the paint off on their own screen, which lasts until they
    leave the page. The post's author can wash it off for everyone, a coat at a pass, and anyone can tag it again. A Whoops!
    splat on the same post always covers the wall. It costs nothing more to play.`
  - `lens-words.ts`'s line for drawings no longer live reads "and 14 older tags, washed off", and its comment, the
    `types.ts` comment that quotes it (`CardUi.logDraw`) and `words.ts`'s comment say the same.

**Tests first** (`graffiti.test.ts`).
- A draw of two groups (a text attachment in ems, an image attachment in image widths) is kept as given. Its framed strokes
  land where `at` puts them: a Stock stroke's width is `1.07 / box.w`, and in the image group the same cap has the same width.
- Each bound refuses one over and names its predicate: a 121st stroke, a 301-point stroke, a 3,001st point, a 121st group,
  an `em` of 0.4, a box `w` of 4.9, an image attachment on an `em` group, a point at 200.1 ems.
- A stencil gives one box-attached group at its spot's center, `STENCIL_EM` across.
- A wash with a cut of a draw not given, or of a group it lacks, is refused. A wash's framed presses for a group whose `at`
  is `[0.5, 0.5]` land at the center.
- An old-shaped draw is refused by `validateDraw`.
- The Lens's line reads "washed off".

## Task 4: the server's count (migration)

Model: sonnet

**Files.** A new migration, `<n>_surface_coats.sql` under `supabase/migrations/`, and its test, `<n>-surface-coats.sql` under
`supabase/tests/`, where `<n>` is the next number free on main when the build starts (main and other plans already use 0453
and 0454); the existing
`supabase/tests/0162-surfaces.sql`, `0166-surface-log.sql` and `0291-surface-face-up.sql` changed where they pin the old
grid. Read first: all of `supabase/migrations/0317_surfaces.sql`, `0343_surface_face_up.sql`, and `edit_post` in
`supabase/migrations/0395_polls.sql`.

The migration's header says what it changes and why, in 0317's voice: the design's sections 5, 6 and 7.

- **The derived rows.**
  - `surfaces` gains `covered integer not null default 0`: the sum of each live draw's painted cells.
  - `cover` and `owners` are dropped once every reader below is moved off them.
  - New `surface_coats (play uuid, draw uuid references acts, coats smallint[] check (cardinality = 10000), painted integer,
    primary key (play, draw))`, with RLS on and no grant, as `surface_marks`.
  - New `surface_places (draw uuid references acts, grp smallint, version uuid references acts, place jsonb, primary key (draw,
    grp, version))`. `place` is the attachment for that version, or JSON `null` for the box spot. It has the same grants as
    `surfaces` (authenticated select).
- **The payload check.** `acts_surface_payload` is replaced:
  - a draw holds `groups` (an array) and `coats` (a coat string), or the old `strokes` and `cells`;
  - a wash holds `cuts` (an array) and `takes` (an array of `{draw, takes}`), or the old `strokes` and `cells`;
  - the payload less `cells`, `coats`, `takes`, `uncovered` and `cut` is at most 64 KiB.
- **`surface_apply(play, character, kind, payload, coats text, takes jsonb, places jsonb, most)`** replaces the old one,
  under the same lock and with the same refusals in the same words:
  - A draw decodes `coats` into a `surface_coats` row. The refusal is computed on `covered + painted(new)` against `most`,
    with `before`, the limit and `after` in whole percent as today. The 48-draw bound counts `surface_coats` rows.
  - A wash: for each `{draw, takes}`, for draws that are live, the cells become `greatest(0, c − t)` with 1 or less set to 0.
    `uncovered` is the cells that went from painted to clean, and `cut` is `[{draw, took}]` with `took` > 0, kept in the
    payload as today and written to `surface_marks` and `surface_cuts` as today.
  - A draw whose `painted` reaches 0 is deleted from `surface_coats` and leaves `live`. The washes stay live while a draw they
    cut is live.
  - `covered` is recomputed from `surface_coats`.
  - `places` (`[{grp, version, place}]`) is inserted into `surface_places` for a draw.
- **Decoding** the coat string in SQL: a function `coat_cells(text) returns smallint[]`, by `position(ch in alphabet) − 1`
  over `string_to_array` (or `regexp_split_to_array(s, '')`), immutable.
- **Legacy.** A draw with `cells` and no `coats` has its coats laid as 20 on each set cell. A wash with `cells` and no
  `takes` takes every coat of each draw older than it on its set cells. `rebuild_surface` replays both kinds of Act this way,
  in `created_at, id` order, and returns `covered` and `live`. A new `rebuild_surface_coats(play) returns setof
  surface_coats` gives the rows.
- **The rebuild.** At the end of the migration, every surface is rebuilt from its Acts into the new rows, and `covered` is
  set.
- **Writers** take the new arguments, passed through from the server function: `draw_on_surface`, `wash_surface`,
  `staff_draw_on_surface`, `play_surface_card` and `staff_play_surface_card` (`first_cells` becomes `first_coats`, and
  `first_places` is added).
  - `set_surface_card` keeps refusing a new back, as `faceUpOnly` does.
  - A face-down draft that springs (`lay_sprung`, `face_down_draws`) is written as an old-shaped draw. It is laid by the legacy
    rule, its groups fall to their box spots, and it writes no places.
- **`edit_post`** is redefined from its definition in 0395 with one more argument, `surface_places jsonb default '[]'`,
  inserted against the new edit Act's id as the version, in the same transaction.
- **Readers.**
  - Every function whose current definition reads `bit_count(sf.cover)` or `bit_count(s.cover)` is redefined to read
    `sf.covered` (or `s.covered`), from its latest definition, changing nothing else. Find them in the local database after a
    full replay (`select proname from pg_proc where prosrc ~ 'bit_count\(s[f]?\.cover\)'`) and name each in the header.
  - `surface_acts` gives each draw its `share` (its own `painted` cells), its `coats` grid is not sent, and its `places`: for
    the post's current version (its latest edit by `created_at, id`, or the post), `[{grp, place}]` from `surface_places`.
    `older` counts draws no longer live.
- **Rows the export carries:** the new tables are in the public schema, so `tools/instance-files.mjs` carries them. Read
  it to confirm, and add them where it lists tables.

**Tests first** (`<n>-surface-coats.sql`, pgTAP, on localhost Postgres).
- A draw's row decodes its coats and `covered` is its painted count.
- A second draw over the same cells adds its own count (overlap paid).
- A draw that would pass the limit is refused with the figures. A wash is never refused.
- Two washes of one pass each over a 2-coat draw (takes of 10 tenths) leave it see-through and then clean. The draw then
  leaves `live` and `surface_coats`, its washes leave with it, and `surface_cuts` holds the cells each wash cleared.
- A legacy wall rebuilt by `rebuild_surface` gives the same `covered` and `live` as the stored row after the migration's
  rebuild.
- `edit_post` with places writes them against the edit's id, and `surface_acts` gives the current version's places.
- Every redefined reader still answers `covered` (one assertion each, through the function the page reads).

The poison for this task's guard: the test that rebuilds a legacy wall is run once against a migration that lays legacy
coats at 10 instead of 20, and it must fail. Record the red output in the PR.

## Task 5: the server function

Model: sonnet

**Files.** `supabase/functions/act/core.ts`, `supabase/functions/act/core.test.ts`, `engine/rules/actions.ts` (read: `edit`).
Read first: the `play_surface_card` and `draw_on_surface` paths in `core.ts` (`decision.rpc === 'draw_on_surface'` and the
`play.value.draw` branch).

- **A draw** (`draw_on_surface`, `staff_draw_on_surface`, and a play's first draw):
  - `decideDraw` gives `coats`.
  - For each group with a text or image attachment, the function reads the post's versions (one read RPC, below) and finds
    the group's `version`.
  - When that is the current version, its place is its own attachment. Otherwise it is `mapPlace(contentOf(old),
    contentOf(current), attachment)`.
  - A `version` the post never had is a refusal: "That post's words aren't the ones you drew on. Reload it and tag again."
  - The places go to the RPC with the coats.
- **A wash:** the function reads the live draws' payloads (`surface_acts`, as the service role) and gives them to
  `decideWash`, then calls `wash_surface` with the takes.
- **An edit** (`edit_post`):
  - Before the RPC, it reads the walls on the post and, for each live draw's group, the version the group is placed at now
    (its row for the current version) and that version's body. That is one new read RPC, `surface_groups_on(post) returns
    jsonb`, service role only, defined in task 4's migration; add it there.
  - It computes each group's place against the new body (`contentOf` of the edit's `body`) with `mapPlace`, and passes them
    as `surface_places`.
  - A group already fallen stays fallen.
- **A transport failure** on these reads is retried on the request itself, as the function's other reads are (CLAUDE.md,
  "Three unrelated timeouts are not a poison pill"). A database error is thrown at once.
- **Broadcasts** are unchanged: the wall's count, never strokes.

**Tests first** (`core.test.ts`, the file's fakes):
- A draw on the current version sends its own attachments as places.
- A draw on an older version sends mapped places, and `null` for a group whose words were touched.
- A draw naming a version the post never had is refused in those words.
- An edit sends `surface_places` for each live group.
- A wash sends one `takes` entry per cut draw.
- A wash cutting a draw not live is refused before the RPC.

## Task 6: placing groups on a screen (engine UI)

Model: sonnet

**Files.**
- `engine/ui/bbcode/layers.tsx`, `engine/ui/bbcode/render.tsx`, `engine/ui/data/api.ts` (`SurfaceAct`), `engine/ui/data/fake.ts`
  (`surfaceStep`, `writeSurface`, `surfaceActs`).
- New `engine/ui/cards/place.ts` and `engine/ui/cards/place.test.ts`.
- `engine/ui/front-door/FrontDoor.tsx` and `engine/ui/tips/problems.ts`, for coats in place of cells.

Read first: `instances/divided-world/cards/autocorrect/` for how a card lays text runs.

- **A mark run.** `TextRun` gains a third mode, `mark`. It is zero-width at `start` (its `end` equals `start`), and its
  `render` draws an empty inline element there whatever run covers that offset, after any standing trail at the same
  offset. It never changes which run draws the words. `stretchesOf` ignores marks for drawing. The renderer draws a run's
  marks at their offsets inside the piece of text that holds them, splitting that piece. The header comment gains the mode.
- **Images.** `render.tsx`'s `img` gets `data-kb-img={n}`, its index among the post's images in tree order, quotes included,
  the same count as `contentOf` (task 1). Pass the counter through the render the way `key`s are made.
- **`SurfaceAct`** gains `places?: readonly { grp: number; place: Attachment | null }[]`. `fake.ts` mirrors task 4:
  - coats per draw, the sum, washes by takes;
  - places written by a draw and by an edit, with `mapPlace` from task 1 on `editPost`;
  - the legacy rule for old-shaped Acts in its fixtures.
- **`place.ts`**, pure over measured rectangles:
  - `placeGroups(groups, measured, box, emPx)`, where `measured` gives each attachment's point (a text mark's left and line
    top, an image's rect) or `null`, gives each group's `{ x, y, scale }` in px. Its steps are the design's section 4:
    1. the attachment's point plus its offset (`dx, dy` ems, or the image share);
    2. otherwise the group's `at` in the box;
    3. scale `min(1, box.w / width)`;
    4. pulled into the box;
    5. then, within one drawing, a group overlapping an earlier group of that drawing that its drawer's frame showed
       clear is nudged down in 1-em steps until clear. If down would leave the box, it is nudged up. If neither clears
       it, it goes where the overlap is least.
  - A group's bounds are its strokes' bounds plus its widest cap's radius.

**Tests first.**
- `layers`: a mark at an offset inside a bold word draws an element between the right characters and does not change which
  run draws the words. A mark at an offset a replace run covers is still drawn.
- `render`: three images, one in a quote, carry `data-kb-img` 0, 1 and 2 in tree order.
- `place.ts`:
  - A text group lands at its mark plus its offset.
  - A group 900px wide in a 360px box is scaled to 0.4 and inside the box.
  - A group hanging past the right edge is pulled in.
  - A group whose attachment is missing lands at its `at`.
  - Two groups of one drawing that overlap after placement are moved apart, and the later one moves.
  - Two groups of different drawings that overlap are left where they are.
- `fake.ts`: a draw then two one-pass washes leaves the fake's `covered` as task 4's test does.

## Task 7: the wall's painter and its washes (instance)

Model: sonnet

**Files.** `instances/divided-world/cards/graffiti/spray.ts`, `spray.test.tsx`,
`instances/divided-world/cards/graffiti/Effect.tsx`, `Effect.test.tsx`. Read first: the bench's `spraySeg`, `disc`, `take` and
`render` (the reference for the look, not code to copy), and `whoops/scrub.ts`'s `bandsOf` and `sweepStep`.

- **The painter paints coats.** For each live draw, each group is painted as a field, in its placed px:
  - Each stroke lays `COATS.line` tenths once on the cells of a 2px grid its core covers, held to `COATS.most`, and an
    overspray and speckle field as today's look (`OVERSPRAY`, `SPECKLE_*`, seeded by the stroke's own points as today).
  - The draw's saved takes are the server's per cell. On a screen the group's cuts are replayed as presses in its units at
    its placed scale, which is what keeps the fine edge. Then this visit's own presses (a reader's scrub, the author's
    unsent wash) are replayed.
  - Each field is computed over the group's own bounds, never the whole box, so the cost follows the paint and not the post.
  - Composited as the bench does: halos under all cores, then cores in wall order. Thinned paint, any cell a press touched,
    is drawn at `0.92 · min(1, 0.35 + 0.65 · (coats − 1.2) / 10)`, with coats in tenths. A cell under 1.2 tenths is clean.
  - A legacy draw is one group at its shares, its strokes at their old widths, drawn as a 2-coat group. A legacy wash is an
    instant cut, as stored.
- **`hitAt(x, y)`:** a point is inked when some group's field holds 1.2 tenths or more there.
- **A press goes to the top group** with paint under its center: wall order, a later draw over an earlier. It thins only
  that group. The sponge's radius is `SPONGE_EM / 2` ems at this screen's text size, and presses go every third of it.
- **The author's wash batch** (`WASH_AFTER_MS`) sends `{ cuts }`: this batch's presses grouped by draw and group, turned
  into each group's units by its placed transform.
- **A reader's scrub** stays on the screen, as today.
- **Hold to scrub** and the author's Wash take the same presses at the same pace. The sweep goes round only the bands that
  still have paint (`bandsOf` with a test against the fields) and stops when none has.
- **Placement** comes from task 6 (`placeGroups`). The Effect:
  - lays a `TextLayer` of `mark` runs at each text attachment's `at` (the place's, else the group's own);
  - measures the marks and `[data-kb-img]` rects after layout, in a layout effect;
  - measures again on a `ResizeObserver` of the body, each image's `load`, and `data-kb-text-size` changes.

**Tests first.**
- `spray.test.tsx` (canvas stubbed as the file does):
  - one pass of presses over a fresh 2-coat stroke leaves `hitAt` true at its center and the drawn alpha see-through;
  - a second pass leaves `hitAt` false;
  - presses over two groups where one lies on the other thin only the top one;
  - a legacy draw and a legacy wash paint as they did.
- `Effect.test.tsx`:
  - the author's batch sends `cuts` keyed by draw and group, with presses in the group's units (a group scaled to 0.5 sends
    presses at twice the px distance);
  - a reader's scrub sends nothing;
  - Hold to scrub stops once the fields are clean;
  - a resize places a text group at its mark's new position.

## Task 8: tagging (instance)

Model: sonnet

**Files.** `instances/divided-world/cards/graffiti/Compose.tsx`, `Compose.test.tsx`, `draft.ts`, `draft.test.ts`,
`Toolbar.tsx` (the meter's words only if they change: they don't).

- **While draw mode is open,** the body carries a `TextLayer` of `mark` runs, one at each word's first character (words split
  on whitespace in the visible text), so every word's left edge and line can be measured.
- **The draft is drawn in px**, with a stroke's width `CAPS_EM[cap]` ems at this screen's text size.
- **At Tag it, `inputOf(draft)` builds the draw:**
  1. `groupsOf` over the draft's strokes in px.
  2. For each group: its center, its `at` in the box, and its attachment:
     - an image whose rect holds the center (its `n`, `src` and `nth` from `contentOf` of the post's current body), in image
       widths, with `em`;
     - otherwise the word whose box holds the center, or the nearest word by its mark's point (section 3), in ems;
     - otherwise a box attachment.
  3. `version` is the post's current version id, read with the post (the latest edit's id, or the post's). If the page does
     not hold it, add it to what the post's read carries in this task, through the one read the Effect already has.
- **The meter** (`meterOf`) counts the wall's `covered` plus this draft's own painted cells, framed as task 3 frames a draw.
  Overlap with the wall is no longer free, so `wallCells` and the union go.
- **Undo** and the bounds work as today. `LEAVE_ASK` is unchanged.

**Tests first.**
- A draft of HELLO over a paragraph tags as one group with a text attachment on the word under its center.
- A ring over an image tags as an image attachment in image widths.
- A tag drawn in the blank space right of the last line attaches to that line's last word, with a positive `dx`.
- The meter for a draft over existing paint counts the draft's own cells in full.

## Task 9: the front door's marks (instance)

Model: sonnet

**Files.** `instances/divided-world/ui/front-door/marks.ts`, `marks.test.ts`, `instances/divided-world/ui/front-door.ts`,
`engine/ui/tips/problems.ts`, `engine/ui/tips/problems.test.ts`, `engine/ui/front-door/FrontDoor.tsx` (staging, as task 6
left it).

- **`marks.ts`:** the shapes return points in a group's own units, from its center. `tag(can, cap, ...shapes)` becomes:
  - `onImage(n, [x, y], em, can, cap, ...shapes)`: one group with an image attachment, in image widths;
  - `onWords(at, len, [dx, dy], can, cap, ...shapes)`: one group with a text attachment, in ems.
  `SHEET_ASPECT` and `BURN_ASPECT` go from `front-door.ts` (the Whoops! wash keeps its own aspect; rename it beside its use if
  it is still needed).
- **`front-door.ts`, post #1:**
  - Serious Deer's ring and arrow go on image 0, centered on the Example Wiggler.
  - Hotel Mario's "??" goes on image 0, beside the Build Your Own row.
  - Hotel Mario's black bar goes on image 0, over the credit block.
  - D-Guy's heart goes on the words "what you think!" (`at` found by `contentOf(body).text.indexOf('what you think!')` in
    the file, never a typed number).
  - Each is placed in the sheet's own shares, read off `wiggler-sheet-dropshadow.gif`, 191 by 393. Comment each with what it
    points at.
- **The staged version** is the post's own staged id.
- **The content check** (`frontDoorProblems`) gains, for each staged draw:
  - an image attachment's `n` names an image in its post, with the same `src`;
  - a text attachment's `at + len` lies inside its post's visible text;
  - its version is its post's.
  The wording follows the file's.

**Tests first.**
- `marks.test.ts`: every helper's draw passes Graffiti's `surface.validateDraw`, and the same seed gives the same strokes.
- `problems.test.ts`, each poisoning a valid front door once and watching its problem appear:
  - an image attachment naming image 3 of a post with one;
  - an image attachment with another `src`;
  - a text attachment past the end of the text;
  - a version not its post's.
- A browser check at 390px and 1100px, in the PR: post #1's four marks sit on the Wiggler, beside Build Your Own, over the
  credit and on "what you think!" at both widths. Screenshots at `deviceScaleFactor: 2`.

## Review focus

- What the migration does to walls already stored: legacy draws laid at 2 coats and legacy washes as instant cuts must give
  each wall the same paint it showed before. A wall that shows differently after the rebuild is a defect.
- The count's cost under the lock: a wash cutting 48 draws decodes and subtracts 48 grids of 10,000 cells. Measure one on
  local Postgres and write the figure in the migration's header, as 0317 did.
- Payload size: a wash's `takes` hold one coat string per cut draw. Check that Postgres's compression keeps a 48-draw wash's
  row small, and that the 64 KiB bound still excludes the server's keys.
- A draw racing an edit: a draw anchored on the version an edit just replaced is mapped by task 5. Two edits and a draw in
  flight must leave every group with a place for the current version, or at its box spot. Never at a place for another
  version.
- The mark runs: a mark must never change where a line breaks. Test it at the narrowest width with marks at every word.
- Placement cost on a busy page: placement runs per wall near the viewport only, as the canvas does. A resize must not place
  walls that are off screen.
- Masks: the places and the takes are computed from the drawing, the post's words and the author's wash alone. Nothing is
  computed from who owns a character.
- Rounding drift: the server counts in whole tenths per cell, and a screen draws fine fields. A screen showing a cell clean
  that the server still counts, or the reverse, must be under a cell's width at the edges, never a whole tag.
