Record, written 2026-11-23.

# The Wiggler thread at the front door: plan

Design: `docs/plans/2026-11-23-wiggler-front-door-design.md`. Seven tasks: three in the engine (staged state and draws, staged
images, the content check), four in Divided World (the drop-shadow sheet, the shape helpers, the film's own cast, the thread). Each
task writes its tests first and shows their red run. Tasks 1 to 3 come before task 7, and tasks 4 to 6 before task 7; otherwise they
are independent.

## Task 1: the front door stages an effect's saved state and a surface's draws

Model: sonnet

**Files.** `engine/ui/types.ts` (`FrontDoorPost`), `engine/ui/front-door/FrontDoor.tsx` (`FrontDoor`, its `stores` memo),
`engine/ui/cards/Effects.tsx` (`nearOf`), `engine/ui/front-door/FrontDoor.test.tsx`.

- `FrontDoorPost.plays[]` gains two optional fields, documented in the file's voice:
  - `state?: Readonly<Record<string, unknown>>`: what the post's author saved for the play, loaded as a thread loads an author's save.
  - `draws?: readonly { readonly by: string; readonly draw: unknown }[]`: a surface card's draws on its wall, oldest first; `by` is a cast key.
- In `FrontDoor`'s `stores` memo, after `plays.add(acts)`:
  - `plays.setStates({ [id]: { state: p.state, savedAt: STAGED_AT } })` for each play with a `state`.
  - For each play with `draws`, find the card's rules in `instance.cards` (from `useKayfa()`; add it to the memo's dependencies). For
    each draw, `rules.surface.validateDraw(draw)`; skip one that is refused (the check in task 3 is what fails the build). Make a
    `SurfaceAct`: `id: idOf(\`${i}:${j}:${k}\`)`, `kind: 'draw'`, `character: idOf(d.by)`, `targetActId` the play's id, `thread`,
    `seq: null`, `createdAt: STAGED_AT`, `payload` the verdict's `payload`, `currentPayload: {}`, the edit fields null. Count the cells:
    `count(union over cellsOf(verdict.strokes))` (`engine/rules/surface.ts`). Then `plays.setSurfaceActs(playId, covered, acts)`.
    Read how `readSurface` (`engine/ui/cards/plays.ts`) and the fake (`engine/ui/data/fake.ts`, `surfaceStep`) shape a wall's Acts, and
    stage the same shape, `share` included if the effect reads it.
- `Effects.tsx`, `nearOf`: under `staged`, `near` does nothing. Today it would call `api.surfaceActs`.

**Tests first** (`FrontDoor.test.tsx`), on a test instance with a card whose rules have `validateState` and one with `surface`
(reuse the file's test cards, or add minimal ones beside them):
- A play with a `state` hands it to its effect in `EffectProps.states`, under the play's id.
- A surface play with two `draws` hands its effect a `surface` whose `acts` are the two draws, in order, with each drawer's id, and
  whose `covered` is the cells their strokes cover.
- A draw the card's rules refuse is not staged; the others are.
- Extend "the screen calls no API method of its own, now or later" so the page holds a surface play, and the wall's `near` is called:
  still no method is called.

## Task 2: a staged post's pictures come from the page's own origin

Model: inline

**Files.** `engine/ui/front-door/FrontDoor.tsx` (`fill`), `engine/ui/front-door/FrontDoor.test.tsx`.

- In `fill`, after the setting markers, rewrite the source of each `[img]` whose source starts with a single `/` to
  `new URL(src, window.location.origin).href`. A comment says why: a post's picture must be an `http(s)` address (`safeImageSrc`), a
  bundled file's address is root-relative, and these words are the instance's committed content, never a player's.

**Tests first.** A staged post with `[img]/x/sheet.gif[/img]` draws an `img` whose `src` is the page's origin plus `/x/sheet.gif`. One
with `[img]//evil.example/a.gif[/img]` (protocol-relative) is not rewritten by this step, and the parser treats it as it does anywhere.

## Task 3: the content check holds every staged play to its card's rules

Model: sonnet

**Files.** `engine/ui/tips/problems.ts` (`frontDoorProblems`, `instanceUiProblems`; widen the `Pick`s to the instance's `cards` and
`settings`), `engine/ui/tips/problems.test.ts`.

Each problem names the post by index and the play by index, as the file's words do now. For each play whose card has rules:
- its `config` passes `validateConfig`;
- a `state` passes `validateState`, and a card without `validateState` carries no `state`;
- `draws` belong only to a card with `surface`; each `by` is in the cast; each draw passes `surface.validateDraw`; there are at most
  `surface.mostLive`; and the cells they cover together are at most `surfaceMost(card, surface.limitKey, settings)`.

Reactions: a key in `post.reactions` is accepted when it is the instance's, or the `localKey` (`engine/rules/emoji.ts`) of the emoji a
play of a `reaction: true` card on the same post names (`localKindsOf`'s reading, `engine/ui/cards/plays.ts`). Read `Reactions.tsx`
(`kinds0`) to confirm the tally key a local kind is counted under, and accept exactly that.

**Tests first**, each poisoning a valid front door once and watching the named problem appear: a config the card refuses; a
`state` the card refuses; a `state` on a card with no `validateState`; `draws` on a card with no `surface`; a draw by someone outside
the cast; a draw the card refuses; one draw more than `mostLive`; draws over the surface's limit; a local reaction key with no play
adding it. And one valid front door with a `state`, `draws` and a local reaction count has no problem.

## Task 4: the drop-shadow sheet

Model: haiku

**Files.** Move `instances/divided-world/ui/hype/wiggler-sheet.gif` to `instances/divided-world/ui/front-door/wiggler-sheet.gif` with
`git mv` only if nothing in `hype/` or `tools/hype/` imports it by path (grep first; the stage names it by URL,
`https://dw.gripe/hype/wiggler-sheet.gif`). If anything does, copy it instead and leave the original. New:
`instances/divided-world/ui/front-door/dropshadow.py` and its output `wiggler-sheet-dropshadow.gif`.

- The script (Pillow, run as `python3 instances/divided-world/ui/front-door/dropshadow.py`): open the sheet, convert to RGBA; the mask
  is every pixel that is not pure white (`(255, 255, 255)`); the canvas grows by the offset; paint the mask in black `(0, 0, 0)` at an
  offset of 3 px right and 3 px down, then the original on top at (0, 0) with its white made transparent so the shadow shows through
  around every shape; fill the rest white; save as a GIF with a 256-color palette. Header comment: what it makes, from what, and that
  the owner asked for a shadow under everything (the design, section 6).
- Commit the output. The task's proof is the script run and the two sizes printed (original 188×390, new 191×393).

## Task 5: strokes from shapes

Model: sonnet

**Files.** New `instances/divided-world/ui/front-door/marks.ts` and `marks.test.ts`. Read first: `instances/divided-world/cards/graffiti.ts`
(a draw's `{ strokes: [{ can, cap, aspect, points }] }`, points as `[across, down]` shares), `instances/divided-world/cards/whoops/points.ts`
(`packStroke`, `encodePoints`), `instances/divided-world/cards/whoops/scrub.ts` (`brushOf`, `coveredLines`) and `whoops.ts`'s
`validateState`.

- A seeded generator (a mulberry32 as `splat.ts` has; import it if it is exported).
- Graffiti shapes, each returning points in shares of the post body's box with a small seeded wobble: `arrow(from, to)` (shaft and two
  barbs as separate strokes), `ring(center, rx, ry)` (one overshooting loop, as a hand draws it), `glyphs('??', at, size)` (each `?` a
  hook and a dot), `heart(center, size)`, `scribble(box)` (a tight zigzag). `tag(can, cap, aspect, ...shapes)` makes one draw.
- `washPasses(bands, { aspect, width, seed })`: wash strokes (`tool: 'wash'`), each a back-and-forth pass across a horizontal band,
  packed with `packStroke`, returned as `{ strokes }`.

**Tests first.** Every shape's points are inside 0 to 1. The same seed gives the same strokes. A `tag` passes Graffiti's
`surface.validateDraw`. `washPasses` passes Whoops!'s `validateState`.

## Task 6: the film keeps its own cast

Model: haiku

**Files.** `instances/divided-world/ui/hype/stage-world.ts`, `instances/divided-world/ui/hype/Stage.board.stories.tsx` (its comment).

- In `stage-world.ts`, replace the `frontDoor` import with a `FILM_CAST` constant beside it: the five entries `frontDoor.cast` holds
  today (Snuckles, Chadluminum, Serious Deer, Human Josh, D-Guy), names, ranks, post counts, revealed classes and the same avatar
  imports, copied exactly from `instances/divided-world/ui/front-door.ts` as it stands before task 7. `frontDoor.cast.forEach` becomes
  `FILM_CAST.forEach`.
- Both files' comments that say the cast is the Front Door's say instead that it is the film's own, and that the film moves to Hotel
  Bro in #1006's build.

**Proof.** `instances/divided-world/ui/hype/Stage.test.tsx` passes unchanged, before and after task 7.

## Task 7: the Wiggler thread

Model: sonnet

**Files.** `instances/divided-world/ui/front-door.ts`, `instances/divided-world/ui/index.test.tsx` (the test "the front door passes the
same check, in its own words"), `e2e/glass-preferences.spec.ts` (the title, line 232).

- The content is the design's section 2 table, word for word, with these exact values:
  - Title `'Look At My Wiggler Sprites'`; label, `note` and `prompt` unchanged.
  - Cast, in this order, keys and classes: `snuckles` Snuckles (jabroni, rank 0, 2817 posts), `hotelbro` Hotel Bro (heel, rank 1, 212
    posts, no pictures), `chadluminum` Chadluminum (face, rank 3, 1204), `deer` Serious Deer (technician, rank 2, 388), `dguy` D-Guy
    (tweener, rank 4, 1224). Drop the `human.jpg` import.
  - Reaction keys: ❤️ `heart`, 🍅 `tomato`, 👍 `thumbs-up`, 😂 `laughing`, 🔥 `fire`, 💯 `hundred-points`, 💡 `light-bulb`, 🤦 `facepalm`,
    👎 `thumbs-down`; 💀 under the local key task 3 confirmed.
  - Whoops! on #3: `config: { color: '#e8402a', seed: 228 }` (try seeds until the splat covers most of the words), `state` from
    `washPasses`.
  - Autocorrect on #5, layers 1 to 3 in the table's order; Overreaction on #6: `config: { emoji: '💀', quadrant }` with the quadrant
    the Overreaction form gives a skull (read `instances/divided-world/ui/overreaction/ConfigForm.tsx`); Feelin' Fab ×2 on #6 at layers 1
    and 2.
  - Graffiti on #1 by Serious Deer, `config: {}`, `draws` from `tag`, per the design's section 5. Place them against a screenshot
    of #1 at desktop width; set each `aspect` to that post body's measured width over height.
  - Pictures: the two sheets imported with `?url` and written as `[img]${sheet}[/img]`.
- The file's header comment is rewritten for this thread: the cast, why each card is where it is, the tomato ink, the author's partial
  wash, that the graffiti and wash are shapes, and that the counts are a quiet thread's.
- **The wash.** Tune `washPasses` (bands, passes, seed) until a test in `index.test.tsx` holds: on #3's splat at a desktop box,
  `coveredLines` says no line of the post's text is covered, and the share of the splat's ink left is between 35% and 70%.
- **The test.** Update the cast names, classes and post count (10), and keep "no front door problem".
- **Screenshots for the owner.** Render the front door in the app (`npm run dev`, signed out, at `/b/general`) at desktop width and at a
  phone's, at deviceScaleFactor 2, posts #1, #3, #5 and #6 each, and attach them to the PR.

## Review focus

- The staged wall is built from the rules' own `validateDraw` at page load: a front door that grows to many draws pays that on every
  visit to every board address. Measure the page's first render with this thread and say the cost.
- `near` doing nothing under `StagedCtx` must not change a live thread: confirm no other caller sets the context.
- The image rewrite runs on the instance's words only: confirm `fill` is not reached by any player's text, and that a protocol-relative
  or absolute address is left alone.
- The partial wash's look depends on the box's size: check #3 at a phone's width, where the same strokes fall on a narrower box.
- Overreaction's 💀 is counted under the key the reactions row actually reads: a mismatch would show the kind with no count.
