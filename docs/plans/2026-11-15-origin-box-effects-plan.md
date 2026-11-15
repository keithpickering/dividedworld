# Card effects fill a spin's ORIGIN box, border to border: plan

Record, written 2026-11-15. Carries out `docs/plans/2026-11-15-origin-box-effects-design.md` (its sections are cited
as §N), task by task. One PR from `main`.

**May start** after PR #723 (the rule's wording), PR #695 (post room) and PR #718 (Steel Chair) are all merged (§9,
the owner's choice). If one is closed unmerged, do not start; ask the owner. If #723's merged wording of "An effect
fills the post, border to border" differs from what §1 quotes, read §2 to §7 against it first, and take a difference
to the owner.

**If main has moved.** Line numbers below are from `main` at `17dbde1e`, and Steel Chair's from PR #718 at `182e01df`.
Find each place again by the quoted code, not the number. #695 and #718 both change files this plan reads
(`engine/ui/thread/thread.css`, `e2e/shine.spec.ts`, everything under `instances/divided-world/ui/steel-chair/`): read
them as merged.

Every task goes test first: write the failing test, record its red run, then the code, then the green run. During a
task, run only the tests for the changed code (`npx vitest run <file>` for a `.test.tsx`,
`node --experimental-strip-types --test <file>` for a `.test.ts`, `npm run test:e2e -- <spec> --trace off` for a
spec). Run `npm run typecheck` and `npm run build` once after the last task. No deployed database, bucket or connector
is touched, and there is no SQL and no migration.

**The layers.** Tasks 1 and 2 are engine. Tasks 4 to 7 are Divided World's. Task 3's stories are the instance's and
its spec is the web app's. The engine names no card: no file under `engine/` may name a Divided World key or class
(`tools/check-engine-boundary.mjs` holds the imports; the review holds the names).

**No check (`check-*.mjs`) is added**, so the poisons are each test's own: every case below names the change that
turns it red, and the red run is recorded.

**Names used below.**
- *The marker*: the attribute `data-kb-content-area`.
- *The area*: `div.kb-origin-area`, the ORIGIN box's content area (§2).
- *A body*: what `bodyOf` returns, a post's `.kb-act-main` or the area.
- *Lifted*: carrying `data-kb-over-ink`.

## Task 1. The marker, `bodyOf(host)` and `liftedOver` (engine)

Model: sonnet

**Files:** `engine/ui/cards/body.ts`, a new `engine/ui/cards/bodyArea.test.tsx`, `engine/ui/thread/Post.tsx`,
`engine/ui/front-door/FrontDoor.tsx`, `engine/ui/thread/thread.css`, `engine/ui/thread/brightInk.test.tsx`,
`engine/ui/bbcode/bbcode.css` (or wherever `.kb-quote`'s border color is set: find it), `engine/ui/cards/Moment.tsx`,
`engine/ui/cards/moment.css`, and every caller and harness named below.

What it builds (§2, §4, §6):
- `bodyOf(host: Element): HTMLElement | null` returns `host.closest<HTMLElement>('[data-kb-content-area]')`. The
  `place` parameter goes. Rewrite the file's header: a content area is whatever element carries the marker (a post's
  body in a thread and on the front door, the ORIGIN box's area); the nearest one is the effect's; where there is none
  (Stick Around's view) the box is the effect's own element.
- `liftedOver(target: unknown, body: Element | null): boolean`: the nearest `[data-kb-over-ink]` ancestor-or-self of
  `target` exists and (`body` is null or `body.contains` it). A target that is no element is false.
- `markBrightInk` is unchanged.
- The two places that draw a post's body add the marker: `<div className="kb-act-main" data-kb-cell="words"
  data-kb-content-area>` in `Post.tsx`, and the `kb-act-main` in `FrontDoor.tsx`.
- `thread.css`: the selectors `.kb-act-main [data-kb-effect-ink]`, `.kb-act-main [data-kb-over-ink]` and every
  `.kb-act-main[data-kb-bright-ink]` rule are rewritten with `[data-kb-content-area]` in place of `.kb-act-main`. Add
  `.kb-moment-list` to the reset's `:is(...)` list (a moment's list stands on its own ground). Update the comments.
- A quote's border: `.kb-quote`'s `border-color` reads `var(--kb-quote-rule, <what it is today>)`. The bright rule
  sets `--kb-quote-rule: var(--kb-bright-ink)` and the reset rule sets `--kb-quote-rule: var(--kb-rule)`; the two
  `… .kb-quote { border-color }` rules go. If `tools/check-ui-tokens.mjs` refuses the new property's name or place,
  follow what it asks; do not weaken it.
- Callers drop the argument: `engine/ui/cards/Moment.tsx` (`useRing`), `instances/divided-world/ui/feelin-fab/Effect.tsx`,
  `instances/divided-world/ui/glitter-bomb/Effect.tsx`, `instances/divided-world/ui/hot-box/Effect.tsx`,
  `instances/divided-world/ui/steel-chair/Effect.tsx`. Where `place` was only in a dependency list for this, drop it.
- `moment.css`'s `.kb-act-main .kb-moment` becomes `[data-kb-content-area] .kb-moment`.
- Instance stylesheets that key on `.kb-act-main[data-kb-bright-ink]` (`instances/divided-world/ui/feelin-fab/fab.css`)
  move to the marker; `grep -rn "kb-act-main" instances engine --include=*.css` and move each rule that is about a
  content area, leaving those that are about the post's grid cell (its `grid-area`, padding, `min-height`).

Tests, red first, in `bodyArea.test.tsx` (vitest, jsdom):
1. `bodyOf` returns the nearest marked ancestor: a host in a marked div inside another marked div gets the inner one.
   Red today: `bodyOf` takes a place and looks for a class.
2. `bodyOf` returns null with no marked ancestor, and an unmarked `div.kb-act-main` is not a body.
3. `liftedOver`: a target inside a lifted element inside the body is true; a target whose lifted ancestor *contains*
   the body is false; a target with no lifted ancestor is false; a null body counts any lifted ancestor; a text node's
   parent is used; `null` and `{}` are false.
4. Rendering a thread's post (reuse the nearest existing Post test's harness) gives `.kb-act-main` the marker; so does
   the front door's.

Tests, red first, in `brightInk.test.tsx`: the selectors it matches by text become the marker's; add "a quote's border
is read from `--kb-quote-rule`, set by the bright rule and by the reset". Keep its check that `.kb-origin` is in the
reset's list.

Then the harnesses. Every unit-test harness that fakes a body adds the marker to its wrapper, and its size stubs keep
keying on the class: `instances/divided-world/cards/whoops/Effect.test.tsx`, `…/cards/graffiti/Effect.test.tsx`,
`…/cards/graffiti/Compose.test.tsx`, `…/ui/feelin-fab/Effect.test.tsx` (its regex on `fab.css` at "kb-act-main\[data-kb-bright-ink\]"
follows the stylesheet), `…/ui/glitter-bomb/Effect.test.tsx`, `…/ui/hot-box/Effect.test.tsx`,
`…/ui/steel-chair/Effect.test.tsx`, `…/ui/still.test.tsx`, `engine/ui/cards/moment.test.tsx`, and any other that
`grep -rln "kb-act-main" engine instances --include=*.test.tsx` finds whose test depends on a body being found. Whoops!
and Graffiti still look the class up until Task 4, so their harnesses carry both.

Red run: `npx vitest run engine/ui/cards/bodyArea.test.tsx engine/ui/thread/brightInk.test.tsx` before the code; then
`npm run test:ui` green after it (this task touches many harnesses, so the whole screens project is its test).

## Task 2. The ORIGIN box's content area (engine)

Model: sonnet

**Files:** `engine/ui/spin/Origin.tsx`, `engine/ui/spin/spin.css`, `engine/ui/spin/Spin.test.tsx`,
`engine/ui/spin/band.test.tsx`, `engine/ui/thread/thread.css` (one rule), `engine/ui/cards/marks.css` (comment only, if
it describes the band's margins).

What it builds (§2, §3, §4):
- `Origin.tsx`: what `body()` returns and the "More than {CARDS_SHOWN} cards" note are wrapped in
  `<div className="kb-origin-area" data-kb-content-area>`. The area is drawn only when there is something to put in
  it: `body()` returned a node or the note shows. (`body()` returns null for `draw`, `wash` and a card play with a
  reach but no character post.) The band stays outside it, a sibling before it.
- Lifted, each with `data-kb-over-ink`: the `<p className="kb-small">` that holds the History button; the History
  panel's wrapper, only while it is open (wrap `history.panel` in a `div.kb-origin-lift` whose mark and ground apply
  when it has content; `:empty` or a class from `aria-expanded` state, whichever reads plainly); the "More than" note.
- `div.kb-origin` itself carries `data-kb-over-ink` (§4).
- `spin.css`:
  - `.kb-origin`: `padding: 0`. Keep the border, ground, `--kb-post-bg`, margin and `--kb-origin-inset`.
  - `.kb-origin-head`: `margin: 0`. Keep everything else.
  - `.kb-origin-area`: `padding: 0.4em var(--kb-origin-inset)`, `isolation: isolate`. No `min-height`, no `overflow`,
    no `position`.
  - The lifted panel and note: `background: var(--kb-post-bg)`; the panel is the area's full width
    (`width: auto`, beating the engine's `fit-content` for lifted things).
  - Rewrite the file's opening comment: the area, why it isolates, what is lifted.
- `thread.css`, beside the lifted rule: `[data-kb-content-area] .kb-origin[data-kb-over-ink] { width: auto; }`, with a
  comment that the box is lifted whole over the opening post's ink and is no chip.
- Update `Origin.tsx`'s header comment, and `engine/ui/cards/Effects.tsx`'s where it says where an effect paints.

Tests, red first, in `Spin.test.tsx` (its ORIGIN tests start from `screen.findByRole('group', { name: 'Origin' })`):
1. A post origin: the box's children are the band, then one `.kb-origin-area[data-kb-content-area]`; the byline, the
   words, Last edited and the History button are inside the area; the band is not.
2. The stubbed Effect drawn at place `origin` (the existing "draws the origin's card effects around its words" case):
   `bodyOf(itsElement)` is the area, and is not any `.kb-act-main` the test wraps the box in. Wrap the box in a marked
   `div.kb-act-main` for this case, as the thread does.
3. A play-spun box ("as it landed") and a character-spun box ("as it was spun"): the `.kb-moment` is inside the area.
4. No area where nothing stands under the band: an origin whose Act is a `wash`, and a card play on a thread.
5. Lifted: the History button's `closest('[data-kb-over-ink]')` is inside the area; the byline's and the words' nearest
   lifted ancestor is the box itself; `liftedOver(words, area)` is false and `liftedOver(historyButton, area)` is true;
   `liftedOver(words, outerBody)` is true.
6. The "More than 20 cards" note is inside the area and lifted.

Tests, red first, in `band.test.tsx` (it reads `spin.css` as text):
7. `.kb-origin` has `padding: 0` and still sets `--kb-origin-inset`; `.kb-origin-head` has no negative margin and
   pads with the inset; `.kb-origin-area` pads with the inset and has `isolation: isolate`. Replace the two cases that
   assert the negative margin, saying why in the test's comment (the inset moved to the area).
8. No selector in `spin.css` or `thread.css` that names `data-kb-bright-ink` names `kb-origin-head` (extend the
   existing case to both files).

Red run: `npx vitest run engine/ui/spin/Spin.test.tsx engine/ui/spin/band.test.tsx` before the code. Cases 1 to 8
fail on today's markup and CSS; record it. `e2e/origin-band.spec.ts` must stay green after it:
`npm run test:e2e -- e2e/origin-band.spec.ts --trace off`.

## Task 3. Stories of the box with effects, and the browser test, red (instance, end to end)

Model: sonnet

**Files:** a new `instances/divided-world/ui/OriginEffects.board.stories.tsx`, `e2e/board-stories.test.ts` (one line),
a new `e2e/origin-effects.spec.ts`.

Read first: `instances/divided-world/ui/jimmy-wails/Effect.board.stories.tsx` (its `origin` case seeds a post, a play
and `fake.spin(post, …)` and renders the spun thread), `instances/divided-world/ui/hot-box/HotBox.board.stories.tsx`
and `e2e/hot-box.spec.ts` (how an area is measured, the Playwright clock), `e2e/fab.spec.ts` (the canvas's backing
size against `paintScale`), `e2e/steel-chair.spec.ts` (`inside`, `onTheFloor`, `roomIsLast`, the pinned seeds),
`e2e/origin-band.spec.ts`, `e2e/moment.spec.ts`. Pick each card with `cardOf(instance.cards, '<key>')` from
`engine/ui/story.tsx` (`tools/check-story-picks.mjs`).

**The stories**, title `'Boards/26 Origin effects'` (take the next free number if 26 is taken). Each seeds a thread
with a post by another character, the play or plays, then a thread spun from the post (or from the play), and renders
the spun thread's first page:

| Export | The origin post | The box shows |
|---|---|---|
| `Whoops` | three lines, edited (so Last edited shows), Whoops! on it | the post live |
| `WhoopsLanded` | the same, spun from the Whoops! play | the play's moment, "as it landed" |
| `Fab` | one line, Feelin' Fab on it | the post live |
| `FabBright` | the same, with a quote in it, brighter effects on, and Feelin' Fab on the spin's opening post too | both live |
| `GlitterSpun` | Glitter Bomb on the character, spun from a post of theirs | "as it was spun", still |
| `HotBox` | three lines, Hot Box on it | the post live |
| `Chair` | three lines, Steel Chair on it | the post live |
| `ChairShort` | one short line, Steel Chair on it | the post live |
| `Under` | plain, and the spin's opening post has Whoops! and Hot Box on it | the post live, no effect of its own |
| `WhoopsPhone` | as `Whoops`, at the phone's width (as the other stories' phone twins do) | the post live |

Add one line to `e2e/board-stories.test.ts` listing the ten ids.

**The spec**, `e2e/origin-effects.spec.ts`, at 1440 by 1120 unless it says otherwise. Shared helpers: `box(page)` is
the group named "Origin"; `area(page)` its `.kb-origin-area`; `padBox(el)` the element's padding box in client px;
`fills(layer, areaEl)` asserts the layer's four edges are within 1 px of the area's padding box, polled (layers are
placed by a ResizeObserver). Each case names its poison:

1. **The area is the box under its band** (`Whoops`). The area's padding box: top within 0.5 px of the band's bottom
   edge (border included), left, right and bottom within 0.5 px of the box's border box minus its 1 px border.
   *Poison: give `.kb-origin` back its `0.4em` bottom padding.*
2. **Whoops! fills it** (`Whoops`, `WhoopsPhone`). The union of the ink's canvases `fills` the area; solid ink is
   found at a point in the byline and at a point 2 px inside the area's bottom-left corner.
   *Poison: `bleed`/the class lookup put back in Whoops!'s measure (the state before Task 4).*
3. **A moment is painted the same** (`WhoopsLanded`, `GlitterSpun`). The still ink's canvases, and the glitter's
   under canvas, `fill` the area; the box holds no `.kb-moment-ring`.
   *Poison: `MomentView` drawn outside the area.*
4. **Feelin' Fab fills it at the density its words cost** (`Fab`). The foil `fills` the area; its backing size is
   `round(clientWidth * d)` by `round(clientHeight * d)` with `d = dpr * clamp(sqrt(own / area), 0.5, 1)`, `own` the
   `.dw-fab` host's box, as `e2e/fab.spec.ts` computes it; the foil is under the words (`elementFromPoint` at a word
   is not the canvas). *Poison: `paintScale` forced to 1 in the effect.*
5. **Bright ink, both areas marked** (`FabBright`). In the box: the words' and the byline's computed `color` is the
   bright ink, the quote's `border-color` is the bright ink, the History button's `color` is the board's, the band's
   `color` equals the thread's column head's. Assert first that the bright ink and the board's ink differ.
   *Poison: the quote's border put back as two selector rules.*
6. **Hot Box fills it, and History stands over it** (`HotBox`). The smoke canvas `fills` the area; `elementFromPoint`
   at the History button's center is the button, and a click opens the panel; the panel's background is opaque; a
   pointer moved over the byline opens a clearing (the canvas's alpha at that point drops, as `e2e/hot-box.spec.ts`
   reads it) and a pointer moved over the History button opens none. *Poison: the History `<p>` loses its mark.*
7. **Steel Chair's floor and walls are the box's** (`Chair`, `ChairShort`). After the run settles (the spec's own
   pinned seed, as `e2e/steel-chair.spec.ts` pins them): every chair is `inside` the area's padding box and
   `onTheFloor` of it; the area's `::after` is `ROOM_HEIGHT` tall and last; the opening post's `.kb-act-main` has no
   `::after` content; no word in the box is under a chair. *Poison: the room put back as
   `[data-kb-content-area]:has(.dw-chair)::after`.*
8. **The box stands above the opening post's effects** (`Under`). At five points in the box (band, mark, byline,
   words, History) `elementsFromPoint` meets an element of the box before any `[data-kb-effect-ink]`; the mark's
   Go to post is pressed and navigates; a scrub drawn across the box's words leaves the opening post's Whoops!
   coverage unchanged (read it as `e2e/whoops.spec.ts` does), and the same scrub over the opening post's own words
   lowers it; a pointer moved over the box opens no clearing in the opening post's smoke.
   *Poison: `.kb-origin` loses its mark.*
9. **The phone** (`WhoopsPhone`, 390 by 844). The page does not scroll sideways, and case 2 holds.
10. **Nothing under the band, no area.** From `Boards/21 Jimmy Wails`'s origin story or the nearest existing story
    whose box is the band alone, if one exists; if none does, this case stays in `Spin.test.tsx` (Task 2, case 4)
    and is not repeated here.

Run `npm run test:e2e -- e2e/origin-effects.spec.ts --trace off` now and record the red run. With Tasks 1 and 2 in
place and Tasks 4 to 7 not yet done, expect: 1, 3 (glitter), 4, 6 (fill) green or red as the code stands, and 2, 5
(the foil's words), 6 (the clearing over History), 7 and 8 red. Write down which were red and why; a case that is
green before its task is checked by its poison instead, once, not committed.

## Task 4. Whoops! and Graffiti find their body through the engine (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/whoops/Effect.tsx`, its `Effect.test.tsx`, `…/cards/whoops/whoops.css`
(comment), `instances/divided-world/cards/graffiti/Effect.tsx`, its `Effect.test.tsx`, `…/cards/graffiti/Compose.tsx`,
its `Compose.test.tsx`, `instances/divided-world/cards/wiping.ts`.

- **Whoops!** `const bleed = place === 'thread'` goes. The three `bleed ? f.closest<HTMLElement>('.kb-act-main') : null`
  (in the measuring layout effect, the per-render check and `ensure()`) become `bodyOf(f)`. The measured box becomes
  `const b = bodyBox(f, cell)`, `{ box: { w: b.w, h: b.h }, left: -b.left, top: -b.top }` (the hand-written sum is the
  same numbers). The layout effect's dependency `[bleed]` goes. The frame's `overflow: 'visible'` is set when a body
  was found (`cellEl !== null`), not by place. `data-kb-place` stays. Update the header comments that say "in the
  thread".
- **Graffiti.** The same five places (`bleed`, the bring-clear body, the measure, the per-render check, `ensure()`),
  the same `bodyBox`, the same overflow.
- **`Compose.tsx`**: `under?.closest<HTMLElement>('.kb-act-main')` becomes `under ? bodyOf(under) : null`.
- **`wiping.ts`**: `overInk(target)` becomes `overInk(target, body)` and returns `liftedOver(target, body)`; each call
  in Whoops! and Graffiti passes the body it measured (`cellEl`, or `null` with none). `mine()` in both, which gives
  the body's listeners an event only when the target is outside the frame, also refuses a target that is
  `liftedOver(target, cell)`.

Tests, red first:
1. Whoops! `Effect.test.tsx`, replacing "in the ORIGIN box the frame is the surface and the box": mounted at place
   `origin` inside a marked `div.kb-origin-area` (add that class to the harness's `isBox` size stub) inside a marked
   `div.kb-act-main`, the canvases are sized and placed to the area, a press on the area outside the frame washes,
   `touch-action` is set on the area, and the frame's overflow is visible. Red today: the frame is the box.
2. Whoops!: at place `origin` with no marked ancestor (Stick Around's view), the frame is the surface and the box, as
   before.
3. Whoops!: a press whose target is inside a lifted element that *contains* the body (the box, for the box's own ink)
   starts a stroke; a press inside a lifted element inside the body still starts nothing; with the effect on an outer
   body, a press inside a nested lifted box starts nothing.
4. Graffiti `Effect.test.tsx`: the harness gains a `place: 'origin'` mount inside a marked area with a size stub; the
   wall canvas is the area's size, the Draw tile is at the area's top right, and a stroke placed at a share of the box
   in the thread harness is drawn at the same share of the area.
5. `Compose.test.tsx`: the body is found by the marker; an unmarked `kb-act-main` is not one.

Then `npm run test:e2e -- e2e/origin-effects.spec.ts e2e/whoops.spec.ts e2e/graffiti.spec.ts --trace off`: case 2 of
Task 3 turns green and the two existing specs stay green.

## Task 5. Feelin' Fab, Glitter Bomb and Hot Box in the box (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/feelin-fab/fab.css` and `Effect.test.tsx`, `…/ui/glitter-bomb/Effect.tsx`,
`glitter.css` (comment) and `Effect.test.tsx`, `…/ui/hot-box/Effect.tsx` and `Effect.test.tsx`. Header comments in all
three `Effect.tsx` files that say "anywhere else (the ORIGIN box …) the host's own".

- **Feelin' Fab.** No code change beyond Task 1. `fab.css`: confirm the rule that hands `.dw-fab-words` the body's
  outline now reads the marker and so holds in the area; the no-bleed rule
  (`.dw-fab:not([data-kb-bleed]) > .dw-fab-words`) is left for Stick Around's view.
- **Glitter Bomb.** In `hear`'s `pointermove` handler, return when `liftedOver(e.target, body)`.
- **Hot Box.** Its control test (`closest('.dw-hotbox-wave, [data-kb-over-ink]')`) becomes: the target is in
  `.dw-hotbox-wave`, or `liftedOver(e.target, found body)`.

Tests, red first, each in the effect's `Effect.test.tsx`, mounted at place `origin` inside a marked `div.kb-origin-area`
(size-stubbed) inside a marked `div.kb-act-main`:
1. Feelin' Fab: the foil is placed over the area, not the outer body; the area carries `data-kb-bright-ink` when the
   band is bright and the outer body does not; `paintScale` and `paintShare` are called with the host's area and the
   area's; on unmount the mark is gone. Keep "with no body … there is nothing to mark", renamed for Stick Around's view.
2. Glitter Bomb: the surface is placed over the area; cling's `hit` is the area; a `pointermove` whose target is in a
   lifted element inside the body is ignored, and one in a lifted element that contains the body is heard.
3. Hot Box: the smoke canvas is the area's box; the pointer listeners are on the area; a press on a lifted element
   inside the area opens no clearing, a press on the byline (unlifted, in the area) opens one; with the effect on an
   outer body, a press inside a nested lifted box opens none.

Then cases 4, 5, 6 and 8 of Task 3 green, and `e2e/fab.spec.ts`, `e2e/glitter.spec.ts`, `e2e/hot-box.spec.ts`,
`e2e/spin-at-post.spec.ts` and `e2e/shine.spec.ts` stay green.

## Task 6. Steel Chair's room is the body's it found (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `steel-chair.css`, `Effect.test.tsx`.

- In `measure()`, where the body found changes: the old body loses `data-dw-chair-room` and the new one gains it; the
  host toggles `data-kb-bleed` on whether a body was found (as Feelin' Fab's host does). The effect's cleanup removes
  both. One Steel Chair effect draws all of a post's chairs, so the mark has one owner.
- `steel-chair.css`: the `@supports selector(:has(a))` block goes. `[data-dw-chair-room]::after { content: '';
  display: block; height: <ROOM_HEIGHT>px; pointer-events: none; }` and `.dw-chair[data-kb-bleed] .dw-chair-room
  { display: none; }` replace it; `.dw-chair-room` keeps its height for the view with no body. Rewrite the comment:
  the room is at the foot of whichever content area the chairs are in; in a thread post that area is a flex column
  (PR #695) and the room is its last item, in the box it is the area's last block.
- Update the header comment ("Where there is no body (outside a thread) …").

Tests, red first, in `Effect.test.tsx`:
1. The stylesheet: `[data-dw-chair-room]::after` is `ROOM_HEIGHT` tall (parsed, as the existing case parses it); no
   rule holds `:has(`; no `@supports`.
2. In a thread: the body carries `data-dw-chair-room` and the host `data-kb-bleed`; both are gone after unmount.
3. At place `origin` inside a marked area inside a marked `div.kb-act-main`, replacing "outside a thread there is no
   body, and the effect's own box is the world" for this place: the world is the area's (`area.w - 2 * INSET` by
   `area.h - INSET`), the layers are placed over the area, the area carries the room's mark and the outer body does
   not, and chairs rest on the area's floor (`expectOnFloor` against the area's height).
4. With no marked ancestor: the host's box is the world and the in-host strip is the room, as before.
5. A body that changes (the effect moves under another marked element): the mark moves with it.

Then case 7 of Task 3 green and `e2e/steel-chair.spec.ts` green. Where that spec finds its area with
`.kb-act-main:has(.dw-chair)`, leave it: in its stories the chairs are in a thread post.

## Task 7. The cost in the box, held (instance, end to end)

Model: sonnet

**Files:** `e2e/origin-effects.spec.ts`, and `e2e/shine.spec.ts` only if its helpers must be exported to be reused.

Add to the spec, on `Fab` and `FabBright`, with the probes `e2e/shine.spec.ts` reads (`window.__kbShine`):
1. At rest, the box's foil is redrawn within `paintShare`'s allowance for its words' box and its area, by the same
   bound `shine.spec.ts` holds for a post (the larger of the words' box and a quarter of the area, times its
   `REDRAWN_SHARE`). *Poison: `share` forced to 1 in Feelin' Fab's `register` call.*
2. Scrolled out of view (a tall page: add posts to the story if it needs them), nothing is drawn for the box after
   two frames and its canvas holds no backing store. *Poison: `hidden: leave` dropped from the `register` call.*
3. `FabBright` (the opening post and the box both shiny): two hosts are registered, and each holds to its own
   allowance.

Record the red run of each by its poison, once, not committed.

## Task 8. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. `npm run test:e2e -- e2e/origin-effects.spec.ts
e2e/origin-band.spec.ts e2e/spin-at-post.spec.ts e2e/moment.spec.ts e2e/whoops.spec.ts e2e/graffiti.spec.ts
e2e/fab.spec.ts e2e/glitter.spec.ts e2e/hot-box.spec.ts e2e/steel-chair.spec.ts e2e/shine.spec.ts e2e/this.spec.ts
--trace off`, tail in the PR. Screenshots of the ten stories, light and dark, attached to the PR's description and not
committed. `grep -rn "place === 'thread'" engine instances` and `grep -rn "closest[^;]*kb-act-main" engine instances
--include=*.tsx --include=*.ts`: say in the PR what each remaining hit is for. The PR lists as a follow-up, not fixed
here: `article:has(> .kb-act-main .kb-hold)` in `instances/divided-world/ui/stick-around/hold.css` (§10).

## Review focus

- **The container is the content area, in both places.** Each of Whoops!, Feelin' Fab, Glitter Bomb, Hot Box and
  Steel Chair, in each of the ten stories: the effect touches the band's rule and the frame's three inner edges, and
  no borderless rectangle shows inside the box. Graffiti in the box was not given a story: draw one on a spun origin
  by hand and check the wall and the Draw tile.
- **What a reader presses.** In every story the mark, Go to post, History and the "More than 20 cards" link are
  pressable; the byline's link under Whoops! ink is plainly covered and pressable once washed. A lifted thing with no
  ground of its own over dark ink is a finding.
- **Nested areas.** An effect in the box never measures, marks or listens on the opening post's body, and the opening
  post's effect never takes a press in the box: read every `bodyOf` and `liftedOver` call, and every place a listener
  is added to a body. Glitter Bomb's cling registry (`hit`) is the one the tests reach least.
- **Stacking.** The area isolates, and the box is lifted in the opening post's context. Check the Lens, the callout
  and a hung "As it landed" tag on the opening post still paint over the box where they overlap it, and that
  Stick Around's ring in the box (`.kb-origin .kb-hold`) is not clipped by anything new.
- **Every harness that lost its body.** A unit test whose wrapper did not get the marker now tests the no-body path
  and still passes. For each effect, confirm at least one test fails when `bodyOf` returns null.
- **Cost on a busy page.** A spun thread's first page with a shiny opening post, a shiny box and a page of shiny
  posts under them: `e2e/shine.spec.ts`'s budgets were recorded without a box. Run the Shine story spun by hand, or
  say in the PR that it was not measured.
- **The band's two old tests.** `band.test.tsx` no longer asserts the negative margin; check at 200% text and at the
  phone's width that the band still runs edge to edge in the frame with no gap at its sides.
- **What an instance already holds.** Nothing stored changes. A Whoops! stroke, a Graffiti drawing and a Steel Chair
  dent are stored as shares of the box they were made in or are computed from a seed; check that a Whoops! wash made
  in the box before this change (a share of the words' box) and read after it (a share of the area) is not drawn
  somewhere surprising, and say what was found.
- **The front door.** Its post body now carries the marker; check an effect there still fills it.
