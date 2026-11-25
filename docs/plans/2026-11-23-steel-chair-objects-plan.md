Record, written 2026-11-23.

# Steel Chair throws other things: plan

Carries out `docs/plans/2026-11-23-steel-chair-objects-design.md`. One PR from `main`. It touches no migration, no SQL
and no card rules. Every product file is Divided World's, except one optional field on the fake backend's `seed.card`
(Task 1).

**Gate.** Task 10 ends on the owner's approval of the puff's bench page. Tasks 11 and 12 wait for it, and the build
session asks the owner on the PR and goes on with the other tasks in the meantime. Every other task may run in the
order below.

Paths below are relative to `instances/divided-world/ui/` unless they start at the repository root.

## Task 1. The roll, and a chosen id for a seeded play

Model: sonnet

**Files:** new `steel-chair/objects.ts` and `steel-chair/objects.test.ts`; `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

- `objects.ts` exports `type ThrownObject = 'chair' | 'can' | 'ladder' | 'extinguisher'`, `OBJECTS` (the table, in that
  order, with weights `900, 40, 40, 20`, frozen) and `objectOf(playId: string): ThrownObject`, which takes one draw from
  `rng(seedOfIds(['object', playId]))` (`body.ts` `rng`, `dent.ts` `seedOfIds`) and walks the cumulative weights out of
  1000. Its header says why the roll comes from the id (design section 1) and that the salt `object` keeps it apart from
  the dent's `dent` and the settle sounds' seed.
- `objectOf` keeps a small cache, as `Effect.tsx`'s `shapeOf` does, since a render asks once per play.
- `fake.ts` `seed.card`'s options gain `readonly id?: string`: where given, it is the play's id instead of `uuid()`. A
  second play seeded with an id already in use throws `an Act ${id} already exists`.

Tests, red first:
- `objects.test.ts`: the weights sum to 1000. Over the ids `play-0` to `play-99999` the shares are within 0.5
  percentage points of 90, 4, 4 and 2. `objectOf` gives the same answer for the same id twice. Hard-code four ids that
  give each object, found by a loop while writing the test, so a change to the hash or the salt shows up as a named
  failure.
- The fake: `seed.card` with `{ id: 'abc' }` makes a play whose id is `abc`, and a second with `id: 'abc'` throws.

## Task 2. Shapes in the body, with the chair unchanged

Model: sonnet

**Files:** `steel-chair/body.ts`, `steel-chair/body.test.ts`, new `steel-chair/rest-record.json`.

The record comes first. Before changing `body.ts`, add a test `the chair rests where it rested before shapes` that, for
seeds 0 to 199, builds a world of 600 by 400 (floor 400), throws three chairs with `throwOf(rng(seed), words)` at the
`STAGGER_STEPS` the effect uses, `settle`s, and compares each body's `position` and `quaternion` against
`rest-record.json` to 1e-9. Generate the record from the code on `main`, commit it, and watch the test pass once on
`main`. Then make the change and keep it passing. A chair's throw and rest must not move at all (design section 2).

The change:
- A `Shape`: `{ name, points: Vec3[] (the samples, corners first), corners: Vec3[], faces: Vec3[] (unit face normals,
  one per parallel pair), edges: Vec3[] (unit edge directions, one per parallel set), support(dir): number (how far the
  shape reaches along a local unit direction), inertia: Vec3 (principal, mass 1), reach: number, hinge: boolean,
  sleepsUpright: boolean, restRise: number }`.
- `boxShape(half, hinge)` builds the chair's exactly as today's constants do: its `points` are today's `SAMPLES` in
  today's order, its `corners` today's `CORNERS`, its inertia today's `invInertia` figures. `CHAIR = boxShape(HALF, true)`.
  `HALF` and `REST_RISE` stay exported, as the chair's.
- `prismShape(radius, height, sides)`: a prism along local y, `sides` rim corners at each end, samples every 15 px or so
  along each rim edge and down each side edge; face normals the `sides / 2` distinct side normals plus y; edge
  directions the `sides / 2` distinct rim directions plus y; the inertia of a solid cylinder of that radius and height;
  `support` from the corners.
- A `Body` carries its `shape`. `probe` becomes the point-in-convex test: the point's depth below each face plane (both
  faces of a pair, from `support`), out along the least. `separation` loops over `a`'s faces, `b`'s faces, and the
  crosses of `a`'s and `b`'s edges (skipping a near-zero cross), using `support` for each body's reach along an axis.
  For two boxes this is the same fifteen axes in the same order, which the record holds.
- `RADIUS`, `riseOf`, `nudge`, the sleep test and the `apart` broad phase read the body's `shape` (`reach`,
  `restRise`, `sleepsUpright`, `corners`).
- A body that `sleepsUpright` may sleep with any corner above `restRise` as long as one face's whole outline is within
  `TOUCH` of the floor and that face is the prism's end (its normal along local y within 5 degrees of the world's up or
  down). Otherwise the rule is today's.
- `Throw` gains `object: ThrownObject`. `throwOf(rand, words, object = 'chair')` draws exactly today's numbers in today's
  order whatever the object, so a seed's path is the object's choice of shape and nothing else. `addThrow` takes the
  shape from `SHAPES[th.object]`.
- The header's cost paragraph is measured again and rewritten (design section 9): one prism tumbling, three prisms
  awake in a pile, and three mixed, beside today's figures.

Tests, red first: the record (above, green before and after); `boxShape(HALF, true)` gives `SAMPLES`, `CORNERS` and the
inertia of today's code; `separation` of two boxes matches today's on 1000 seeded pairs; a prism's `support` along
each face normal is its apothem or half-height; a point just inside a prism's face probes out along that face.

## Task 3. The new shapes, and their rests

Model: sonnet

**Files:** `steel-chair/body.ts`, `steel-chair/body.test.ts`, `steel-chair/objects.ts`.

- `SHAPES: Record<ThrownObject, Shape>` in `body.ts`: the chair; the ladder `boxShape([15, 48, 3], true)`; the can
  `prismShape(15, 40, 12)`, `sleepsUpright`; the extinguisher `prismShape(7.5, 50, 12)`, `sleepsUpright`, with
  `spout: Vec3` at `[0, -25, 0]` (its top, local y up is negative as the chair's frame has it), which Task 11 reads.
  Each `restRise` is the highest a corner of it reaches when it lies on top of two more of the thickest lying object's
  thickness, as the chair's comment works it out, plus its own height standing for one that `sleepsUpright`.
- The ladder's hinge uses the chair's (`HINGE`, the fold's timing). Its folded box is the box above.

Tests, red first:
- Each shape's `reach` is at most the chair's (`Math.hypot(...HALF)`). This holds `chair.ts` `K` for every post.
- For each object alone, and for three throws whose objects are drawn from seeds 0 to 199 with each object present at
  least 30 times, the existing rest test's assertions hold: every body asleep within `SETTLE_S`, no corner past
  `Z_FRONT` (`chair.ts`), none higher than its own `restRise` unless it `sleepsUpright` and stands on its end, and
  none inside another past `TOUCH`.
- A can thrown so that it lands on its base (find a seed while writing the test, and hard-code it) sleeps standing.
- A chair thrown alone with the same seed as before rests as the record says (Task 2's test covers this).

## Task 4. Drawing the objects

Model: sonnet

**Files:** `steel-chair/chair.ts`, `steel-chair/chair.test.ts`, `steel-chair/Effect.tsx`, `steel-chair/steel-chair.css`,
`steel-chair/Chair.board.stories.tsx`.

- `chair.ts`: `piecesOf(fold)` stays the chair's. Add `ladderPiecesOf(fold)` (two rail frames, three treads on the front
  frame, a spreader and the rear frame on the hinge, all `frame`, `panel` and `tube` pieces as the chair's are),
  `prismPiecesOf(radius, height, sides)` (12 side strips, two 12-gon caps as `panel`s clipped by `clip-path: polygon(...)`
  in their style), `canPiecesOf(lidOn: boolean)` (the prism, three corrugation bands as thin strips, two side handles,
  the lid with its handle as a separate group the lid's arc moves, Task 6) and `extinguisherPiecesOf()` (the prism in
  red, a black collar, a valve head, a short hose to the spout, a gauge disc). `piecesFor(object, fold, lidOn)`
  dispatches. A piece gains an optional `color` that `shadeOf` tints instead of steel gray (the extinguisher's red, the
  can's galvanized gray, the ladder's aluminum).
- `ROOM_HEIGHT` becomes `roomHeightOf(objects: readonly ThrownObject[])`, the room the tallest of those objects' rests
  needs, worked out as today's constant is. `roomHeightOf(['chair'])` is 77, and so is `roomHeightOf([])`.
- `Effect.tsx`: each body's object comes from `objectOf(play.id)`. Its pieces' list is built by `piecesFor` and kept per
  body, where today it is the one `PIECES` (line 229) and `piecesOf(v.fold)` (line 410). The room's height is set on the
  marked content area as `--dw-chair-room: ${roomHeightOf(objects)}px`.
- `steel-chair.css`: both `height: 77px` rules (lines 51 and 59) read `var(--dw-chair-room, 77px)`. Update the comment at
  line 33 and the test in `Effect.test.tsx` that holds the CSS to `ROOM_HEIGHT`, which now holds the fallback to
  `roomHeightOf([])`.
- `Chair.board.stories.tsx` gains a story for each object at rest and in flight.

Tests, red first: each `…PiecesOf` gives the pieces named above, each within its shape's box at fold 0; `piecesFor`
dispatches by object; `roomHeightOf` as above, and larger with a can; `Effect.test.tsx`: a post whose one play's id rolls
`ladder` (pass a hard-coded id from Task 1's test) draws a ladder's pieces, and the marked area carries the room's
custom property.

## Task 5. Each object's sounds

Model: sonnet

**Files:** `docs/research/2026-11-23-steel-chair-objects/sounds/*.mp3` moved (with `git mv`) into `sounds/`;
`sounds/sounds.json`; `sounds.ts`; `sounds.test.ts`; `cards/steel-chair/ui.ts`; `steel-chair/Effect.tsx`;
`steel-chair/Effect.test.tsx`.

- Move the ten files. Add each one's manifest entry, with `source`, `license` and `maker` as
  `docs/research/2026-11-23-steel-chair-objects/README.md` says, then run `node tools/measure-sounds.mjs`, and check
  that it writes the figures that README gives. Leave the README in place. It is a record, so add a line at its end saying
  the files moved in this task's commit.
- `sounds.ts`: a slot each, ink `var(--kb-salty)`, keys `steel-chair.can-hit`, `steel-chair.can-settle-1`, `-2`,
  `steel-chair.ladder-hit`, `steel-chair.ladder-settle-1`, `-2`, `steel-chair.extinguisher-hit`,
  `steel-chair.extinguisher-settle-1`, `-2`, `steel-chair.extinguisher-hiss`, with the captions of the design's
  section 6.
- `ui.ts`'s `sounds` lists them all.
- `Effect.tsx`: a body's hit plays its object's hit, and its first floor contact one of its object's settles, drawn from
  `soundRand` as today (`SETTLE_SOUNDS` becomes per object: 4 for the chair, 2 for the others). The chair's keys stay as
  they are. Update the header's Sound paragraph.

Tests, red first: `sounds.test.ts` already holds the manifest and the slots naming the same files; add that every
`steel-chair.*` slot is in `ui.ts`'s list. `Effect.test.tsx`: a ladder play's hit plays `steel-chair.ladder-hit`, and its
floor contact plays `steel-chair.ladder-settle-1` or `-2`.

## Task 6. The lid

Model: sonnet

**Files:** new `steel-chair/lid.ts`, `steel-chair/lid.test.ts`; `steel-chair/Effect.tsx`, `steel-chair/steel-chair.css`,
`steel-chair/Effect.test.tsx`; `e2e/steel-chair.spec.ts`.

- `lid.ts` (pure): `lidArcOf(rand, hitAt: {x, y}, box: {width, height})` draws, from the can's own throw's generator
  after its other numbers (so a chair's draws are untouched), an arc that leaves through the top border or the nearer
  side border: launch speed, angle, spin about two axes. `lidAt(arc, t)` gives its position, orientation and opacity at
  `t` seconds after the hit, with gravity at the body's `GRAVITY`, and `done` once it is 80 px past the content area's
  border or 1.2 s have passed.
- `Effect.tsx`: at a can's `hit` event, the lid's group leaves the can's group and follows `lidAt` on the same frame
  loop. The loop stays up while a lid is flying. When it is done, the group is removed. A can drawn at rest under reduced
  motion is drawn with `lidOn: false`, as is any can whose hit has passed.
- The lid is drawn on the chairs' layer, which is overflow-visible. Find every ancestor between it and the page that
  clips (`overflow`, `contain: paint`, `clip-path`) in a thread post (`.kb-act-main`) and in an ORIGIN box
  (`.kb-origin-area`), and record what you find in the header. Where one clips, the lid gets its own fixed-position
  layer placed from the content area's client rect each frame. Choose that, or no change, by what the e2e shows.

Tests, red first:
- `lid.test.ts`: for 500 seeds the arc leaves the box within 1.2 s, never comes back inside it after leaving, and is
  `done` by then.
- `Effect.test.tsx`: a can play's lid group is gone after the arc's time, and the can's pieces no longer include the lid.
- `e2e/steel-chair.spec.ts`, a new story or fixture with a can (seeded id): at some frame the lid's bounding box is
  outside the content area's, and visible (not clipped to zero size), in a thread and in an ORIGIN box.

## Task 7. Each object's dent

Model: sonnet

**Files:** `steel-chair/dent.ts`, `steel-chair/dent.test.ts`, `steel-chair/Effect.tsx`.

- `dentShape(playId, object = 'chair')`: a `DentKind` table holds the parameters that differ, which are today's
  constants for the chair (`AXIS_MIN`, `AXIS_MAX`, the lobe count's range, lobe radius and depth ranges, the crumple's
  amplitude), and for the others what the design's section 5 says: ladder `rx` 0.35 to 0.45 of `ry`, one ridge lobe
  across its long axis; can rounder (axes within 5% of each other), 2 or 3 lobes, deeper; extinguisher round and 70% of
  the chair's size, 1 or 2 lobes, the deepest. The draws stay in the order the header lists, so a chair's dent is drawn
  from the same numbers.
- `Effect.tsx`'s `shapeOf` keys its cache by play id and object together.

Tests, red first: `dentShape(id)` and `dentShape(id, 'chair')` equal today's output for 50 ids (record them from `main`
first, as Task 2 does); each other object's shapes over 200 ids fall within its ranges; the extinguisher's box is
smaller than the chair's for the same id.

## Task 8. Words

Model: haiku

**Files:** `cards/steel-chair/ui.ts`, `index.test.tsx` (its Steel Chair status test, line 1479, which holds the words
today).

- `status: (plays) => ...` names each play's object from `objectOf(play.id)`, in the order of `plays`, counting
  repeats: one kind `Dented by a chair` or `Dented by 2 chairs`; two kinds `Dented by a chair and a ladder`, or `Dented
  by 2 chairs and a trash can`; three kinds `Dented by a chair, a ladder and a trash can` (no serial comma, as the rest
  of the instance's words have none). Names: `chair`/`chairs`, `ladder`/`ladders`, `trash can`/`trash cans`, `fire
  extinguisher`/`fire extinguishers`. Each kind is named once, in the order its first play appears.
- `describe`'s first two sentences become: `A Salty card, ${rarity}. Something is thrown at a post and dents it, usually
  a folding chair, sometimes a trash can, a step ladder or a fire extinguisher: the words bend into the dent, and the
  thing drops to the floor under them. A trash can's lid flies off, and a fire extinguisher fills the post with spray
  that clears by itself in a few seconds.` The rest is unchanged, with "the chair" made "it" where it reads so.
- `summary` and the tagline are unchanged.

Tests, red first: `status` for each case above, the plays' ids taken from Task 1's hard-coded ids; `describe` names all
four objects and says the spray clears by itself.

## Task 9. The hype stage keeps its chairs

Model: haiku

**Files:** `hype/stage-play.ts`, `hype/Stage.test.tsx`.

- `springsOn` (line 134) seeds its play with `id: chairId()`. `chairId()` draws `crypto.randomUUID()` until `objectOf`
  gives `chair`, and returns that id. Do the same wherever the stage seeds a `steel-chair` play (search the file for
  `'steel-chair'`).

Tests, red first: `Stage.test.tsx`: every `steel-chair` play the stage makes rolls `chair`.

## Task 10. The puff's model and its bench (the owner approves)

Model: sonnet

**Files:** new `steel-chair/puff.ts`, `steel-chair/puff.test.ts`, new
`docs/research/2026-11-23-steel-chair-objects/01-puff.html`.

- `puff.ts` (pure, no DOM, no clock): `PUFF = { color: '#f2f4f7', jetMs: 250, billowMs: 600, holdMs: 400, fadeMs: 4000,
  full: 0.9 }` (the bench may move these). `puffFront(spout, box, ms)` gives the billow's front as a radius that grows
  from 0 at the spout to past every corner of the box at `billowMs`, eased out. `puffTarget(spout, box, ms)` is a
  `FogInput` target (the type `hot-box/fog.ts` `stepField` takes): a cell outside the front may hold no fog, and a cell
  inside may hold all of it. `puffAlpha(ms)` is `full` until `billowMs + holdMs`, then falls in a straight line to 0 over
  `fadeMs`. `puffDone(ms)` is true at the end of the fade.
- The bench page is one self-contained file, as `docs/research/2026-11-15-hot-box-fog/01-fog.html` is, and that page's
  fog is its starting point: copy its `makeCloud`, `advect`, `step` and `drawFog` and its pointer clearing. It draws a
  post-sized box with three lines of text and an extinguisher resting at a chosen spot, runs the puff with the target
  and alpha above over that fog, and has sliders for the five numbers and a Replay button. It is a record, not product
  code. What the owner approves is copied into `puff.ts`, as the fog bench's numbers were copied into `fog.ts`.
- Post the bench's path and a screen recording on the PR, and ask the owner to approve the look and the numbers. Write
  what the owner approves into `PUFF` and into the design's section 4, as an addendum dated that day.

Tests, red first: `puffFront` is 0 at 0 ms and covers the box's farthest corner from the spout at `billowMs`;
`puffAlpha` is `full` through the hold and 0 at the end; `puffDone` turns true at the end and no sooner.

## Task 11. The puff in the effect

Model: sonnet

Waits for Task 10's approval.

**Files:** new `hot-box/pointer.ts` (the shared hook), `hot-box/Effect.tsx`, `hot-box/Effect.test.tsx`; new
`steel-chair/Puff.tsx`, `steel-chair/Puff.test.tsx`; `steel-chair/Effect.tsx`; `EffectBudget.board.stories.tsx`;
`EffectBudget.test.tsx`.

- Move Hot Box's pointer handling ("the pointer: on the content area, passive, never prevented, never captured", from
  line 797 on) and its fog ladder (`spend`, `closeFrame`, `forceFogLevel`, `resetFogLadder`, the rest timer, from line
  150 to line 265) out of `hot-box/Effect.tsx` into `hot-box/pointer.ts` (`usePointerClearings(area, options)`) and
  `hot-box/ladder.ts`, each with Hot Box's own comments carried over. Hot Box's tests must pass unchanged. Keep the
  exports Hot Box's tests import, re-exported from the effect, so no test is rewritten in the move.
- `Puff.tsx` draws one puff on the engine's tile layer (`makeTileLayer`), as Hot Box draws its smoke, over the content
  area Steel Chair already finds (`bodyOf`, `bodyBox`). It steps its own fog field with `puffTarget` as the floor and
  the pointer's clearings cutting it, paints with `puffAlpha` as the fog's alpha, takes rungs from the shared ladder, and
  removes itself and its layer at `puffDone`. It never makes the words inert, sets no live region and adds no Lens
  control. Forced colors and reduced motion draw nothing.
- `Effect.tsx`: an extinguisher's first `floor` event starts a `Puff` at its spout, projected with `chair.ts` `project`
  at that moment, and plays `steel-chair.extinguisher-hiss`. A new throw of the same play while a puff stands starts a
  new one in its place.
- `EffectBudget.board.stories.tsx`: a `steel-chair` key whose seeding plays a Steel Chair with an id that rolls
  `extinguisher` (Task 1's hard-coded id), and its story, `SteelChair`, tagged `effect-sheets-1` and not
  `effect-hides-words`. `tools/check-effect-canvas.mjs` then accepts `steel-chair/Puff.tsx` importing the layer. Run it
  to see that.

Tests, red first:
- `hot-box/Effect.test.tsx` passes before and after the move, unchanged.
- `Puff.test.tsx`: the layer is made on start and gone after `puffDone`; the words are never `inert`; a pointer move over
  the area opens a clearing (the field's density under it drops); under reduced motion and forced colors no layer is
  made.
- `Effect.test.tsx`: an extinguisher play's floor event mounts a puff and plays the hiss; a chair's does neither.
- `e2e/effect-tiles.spec.ts` runs the new budget story, as it runs every key.

## Task 12. End to end, and the stories

Model: sonnet

Waits for Task 11.

**Files:** `e2e/steel-chair.spec.ts`, `e2e/origin-effects.spec.ts`, `OriginEffects.board.stories.tsx`,
`steel-chair/Chair.board.stories.tsx`.

- Stories with seeded ids for: a ladder on a post, a can on a post, an extinguisher on a post, and three mixed (a chair,
  a can, an extinguisher), live and in an ORIGIN box.
- `e2e/steel-chair.spec.ts`: each object comes to rest inside the content area on its floor and covers no words. The
  mixed post's room is `roomHeightOf` of its objects. The extinguisher's puff appears after the floor contact, fills the
  content area, and is gone within `billowMs + holdMs + fadeMs` plus 500 ms. A pointer swept across the puff leaves the
  words under its path readable sooner than the fade alone (pixel sampling as the Hot Box spec samples). The Lens says
  `Dented by a chair, a trash can and a fire extinguisher` on the mixed post.
- `e2e/origin-effects.spec.ts`: the extinguisher in an ORIGIN box puffs inside the box's area, and the can's lid leaves
  it.

## Task 13. The build

Model: inline

Run `npm run typecheck`, `npm run build:ci` and the two e2e specs above, and show their output. Read the design's
sections against the diff once more before the final review.

## Review focus

- A chair's throw, rest and dent must not move for any seed or id (the records of Tasks 2 and 7). A change in the order
  of draws from a generator is how that slips.
- About 10% of the Steel Chairs already on an instance become other objects, because the roll reads ids that already
  exist. Check nothing stored or cached on a page (the dent cache, the settle sound's seed) assumes every play is a chair.
- The separating axis test's cost with three prisms in a pile, on a phone-speed throttle, against the 4-step frame cap.
- The puff steps its field over the whole content area for about 5 s. With several smoked posts in view, it must take
  rungs from the shared ladder and never make a Hot Box step down a rung it would not have taken alone.
- Moving Hot Box's pointer handling and ladder must change nothing Hot Box does. Its test file must pass unchanged.
- The lid must leave the content area visibly in both places a post is shown, and must not leave a node behind after
  its arc.
- `objectOf` reads only the play's id. No private fact (who played, who wrote) may reach the roll, the status or a sound.
