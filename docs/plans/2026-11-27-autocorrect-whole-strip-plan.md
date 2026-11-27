# Autocorrect: a strip that fits a line stays whole: plan

Record, written 2026-11-27. The plan for `docs/plans/2026-11-27-autocorrect-whole-strip-design.md`. One build session
builds it in one PR from `main`, after the design's PR is merged. No migration: nothing here touches SQL or a deployed
database. This plan adds no `check-*.mjs`.

**The layers.** Every task is Divided World's: Autocorrect's effect, its CSS, its board story and its browser spec.
The engine is not touched.

Every task is test first: the test, its red run, then the code.

## The words this plan uses

- A **stack** is one of `stripsOf(...).stacks` (`instances/divided-world/cards/autocorrect/tape.ts`): strips that
  overlap, laid together. The effect's `layout` calls them `groups`.
- A stack's **footprint** is the width of its words from its first strip's `from` to its last strip's `to` (the
  layout's `measure.words`), plus every room in it at its true width (`rooms × spaceAt(end)`), using the rooms `roomOf`
  sets in the layout's first pass (`nextRooms` before `extra.current.at` is added).
- A stack is **whole** when it has at least one strip not in `loaded` and its footprint is no more than its line's
  width. The **line's width** is the content width of the nearest block-level element around the stack's first
  segment: its `getBoundingClientRect().width` minus its computed padding and border on both sides.

## Task 1: the case in a real browser

Model: sonnet

**Files:** `instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx`, `e2e/autocorrect.spec.ts`.

1. Add a case `door` to the stories: the front door's post and play
   (`instances/divided-world/ui/front-door.ts`: body "Who was that react from?! Come fight me like a man and I'll
   show ya where to put that thumbs up.", play `{ phrase: 'a man', replacement: 'a Goomba' }`), copied as literals,
   with `LANDED_AGO` 48 hours and no saved state. Export `DoorPhone` (reader, light, `...phone`) beside the other phone
   stories, and add `door` to the header comment's list of cases.
2. Add to `e2e/autocorrect.spec.ts` a test, "a short strip at a line's end moves to the next line whole, at every
   phone width": open `door-phone`, then for each viewport width from 320 to 430 in steps of 2, set the width, wait
   for the layout (poll until the pieces' `data-kb-ac-line` values stop changing, or wait 200ms after
   `document.fonts.ready`), and collect, for each strip (`data-kb-ac-piece`'s strip key), its distinct
   `data-kb-ac-line` values. Expect every strip to have exactly one line at every width, reporting the widths where one
   did not. Do the same sweep for `one-phone` ("Mario" to "Luigi", three strips), which also lands a strip at a line's
   end at some width.
3. Extend the header comment's list of what the spec covers.

**Red run:** run the new test on `main`'s effect (`npm run test:e2e -- e2e/autocorrect.spec.ts -g "line's end"`, or
as `tools/test-e2e.mjs` takes a filter). It must fail on its assertion, naming at least one width where a strip has two
lines. If no width in the sweep fails, widen the sweep or lengthen the text before "a man" until one does, and say so
in the report; a test that is green on `main` proves nothing. Commit the story and the red test together.

## Task 2: whole stacks

Model: sonnet

**Files:** `instances/divided-world/cards/autocorrect/Effect.tsx` (`layout`, the `runs` memo, the state beside
`rooms`), `instances/divided-world/cards/autocorrect/autocorrect.css`,
`instances/divided-world/cards/autocorrect/Effect.test.tsx`.

**Tests first**, in `Effect.test.tsx`, with its existing measuring mocks (`getClientRects` for `[data-kb-ac-seg]`,
`getBoundingClientRect` at 300px wide):
- a stack whose footprint fits the line: every one of its `[data-kb-ac-seg]` spans and its `.dw-ac-room` carry
  `data-kb-ac-whole`;
- a stack whose footprint is wider than the line (a long phrase, as the `across` story's): none of its spans or rooms
  carry it;
- a stack whose only strip was peeled before this load: no `data-kb-ac-whole`;
- a whole stack takes no `extra`: mock a first layout where the stack crosses two lines so `extra` grows, then a resize
  where it fits; the room after the resize is the one `roomOf` sets, not grown.
Record each red run.

**The code:**
1. State `whole` beside `rooms`: a `Record<string, true>` keyed by the stack's first strip's `from`. Add it to
   `world.current` and to the dependencies of the `useLayoutEffect` that runs `layoutNow`.
2. In `layout`, after the rooms pass (`nextRooms` from `roomOf`) and before `extra.current.at` is added: for each stack
   in `groups` with a strip not in `before`, find its footprint (`measure.words(stackFrom, stackTo)` from the stack's
   first `from` to its last `to`, with the inner rooms at `spaceAt`, the same sums the rooms pass makes) and its line's
   width (the nearest block-level ancestor of its first segment, `segs[firstAt.get(stackFrom)]`, found with
   `getComputedStyle(el).display` not starting with `inline`). Set `nextWhole[from] = true` where the footprint is no
   more than the width, with 0.5px to spare.
3. Add `extra.current.at` only to the ends of stacks that are not whole. In the bump loop, skip strips whose stack is
   whole.
4. If `nextWhole` differs from the `whole` the render used (`sameJson`), `setWhole(nextWhole)` and return, as the rooms
   do.
5. In `runs`, a run inside a whole stack draws its `[data-kb-ac-seg]` span and its room's span with `data-kb-ac-whole`.
   Add `whole` to the memo's dependencies.
6. In `autocorrect.css`: `[data-kb-ac-seg][data-kb-ac-whole] { white-space: nowrap; }` and
   `.dw-ac-room[data-kb-ac-whole] { white-space: pre; }`, with a comment naming the design.
7. Extend the header comment's **The line.** paragraph by one sentence: a stack whose footprint fits its line is laid
   whole (it does not wrap) and moves to the next line as a long word does; one wider than its line wraps and is cut
   into pieces.

**Green runs:** `npx vitest run instances/divided-world/cards/autocorrect` and Task 1's e2e test, plus the rest of
`e2e/autocorrect.spec.ts` (the content-box and marker tests must stay green at 390px and 1440px).

## Review focus

- A stack's whole state is found from widths only, never from where the lines broke, so it cannot flip between two
  layouts; check that a resize across the threshold settles in one or two passes and does not loop between `setRooms`
  and `setWhole`.
- A strip the author has half peeled keeps its footprint and its whole state when the post is measured again: nothing
  of the post's words moves when tape comes off.
- Saved stretches and drops are in shares of a strip and are cut at each screen's line breaks: a strip that was in two
  pieces on a screen before this change and is one piece now still shows the same peeled stretch.
- The same effect draws in a spun thread's ORIGIN box and in a play's moment: the line's width is read from the box the
  post is shown in, not from the board's.
