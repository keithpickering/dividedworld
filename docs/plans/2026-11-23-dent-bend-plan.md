Record, written 2026-11-23.

# A dent that bends what lies under the words: plan

Carries out `docs/plans/2026-11-23-dent-bend-design.md` (issue #1035). One PR from `main`, with `Closes #1035`.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`npx vitest run <file>` for a `.test.tsx`, `node --experimental-strip-types --test
<file>` for a `.test.ts` the repository runs that way, `npx playwright test <spec> --trace off` for the browser). Run
`npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database,
bucket or connector is touched, and no migration is added.

**The layers.** Task 1 is the engine's; it names no card and imports nothing from `instances/`. Tasks 2 to 5 are
Divided World's. The engine's boundary check (`npm run build`) must stay green.

**What stays as built:** the dent itself (`dent.ts`: `dentShape`, `dentImages`, `dentPrimitives`, `hitZone`,
`zoneHeight`, `filterTrusted`, `DENT_SCALE = 14`), the filter's flood, per-dent `feComponentTransfer` growth and
arithmetic sum, the two shading layers, the chairs, the room, the sound and the Lens; Fab's foil, its loop, its worker
and its `paintScale` and `paintShare`.

## Task 1. The words box and the bend interface

Model: sonnet

**Files:** `engine/ui/cards/Effects.tsx` (`PostEffects`' `plain`, `MomentEffects`), `engine/ui/cards/body.ts`,
`engine/ui/thread/thread.css`, and their tests (`engine/ui/cards/Effects.test.tsx`, `engine/ui/cards/body.test.ts`).

- **The words box.** `plain(inner)` always returns `<div data-kb-words-box="">{inner}</div>`; in the compose path the
  slot's `bodyEl` is the box and carries the attribute itself (one element however the layers wrap it, as now). Every
  return of `PostEffects` that draws words goes through `plain` (the no-plays return, the presenting path, the
  default); the moment path's `now={plain(words)}` already does. `MomentEffects` wraps its writing wraps (the first
  `nested.writing.length` of `order`) in the same box before the others. `VersionEffects` is unchanged. Export the
  attribute name as `WORDS_BOX = 'data-kb-words-box'` from `body.ts`, and say in `Effects.tsx`'s header comment where
  the box stands.
- **`body.ts`:** `BEND_LAYER = 'data-kb-bend'`; `interface Bend { readonly area: string; readonly words: string }`
  (each a CSS `filter` value, such as `url("#id")`); `setBend(area: HTMLElement | null, host: HTMLElement, bend: Bend
  | null): void`, which sets `--kb-bend` and `--kb-bend-words` inline on `area` (or, where `area` is null, only
  `--kb-bend-words`, on `host`), and with `bend` null removes what it set from both. A header line says it is
  single-owner, as `markBrightInk` is. `wordsBoxOf(host: HTMLElement): HTMLElement | null`: the first
  `[data-kb-words-box]` inside `host` whose nearest `[data-kb-content-area]` is `host`'s own (`bodyOf`), so a box
  inside a nested area is never taken.
- **`thread.css`:** `[data-kb-content-area] { --kb-bend: none; --kb-bend-words: none; }`;
  `[data-kb-words-box] { filter: var(--kb-bend-words, none); }`; `[data-kb-bend] { filter: var(--kb-bend, none); }`,
  with a comment naming the design. The words box is a plain block with no margin, padding or position of its own.

**Tests first:**
- `Effects.test.tsx`: in `PostEffects` with a writing card and another card played, `[data-kb-words-box]` holds the
  words and the writing card's wrap, and the other card's wrap holds the box (red before: no box). The no-plays render
  has the box. `MomentEffects` has the box inside its writing wraps and inside every other.
- `body.test.ts`: `setBend` sets both properties on the area and none on the host; with no area, only
  `--kb-bend-words`, on the host; `null` removes them. `wordsBoxOf` skips a box inside a nested content area.

Then run `e2e/post-room.spec.ts` and the thread's layout specs it sits beside: a bare post must lay out as before.

## Task 2. Steel Chair bends through the interface

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `steel-chair.css`, `Effect.test.tsx`.

- **No filter on the wrapper.** `.dw-chair-words` never carries `filter`. It stays as the shake's former home only if
  something else needs it; otherwise it goes and `children` sit straight in the host.
- **Two filters**, `${filterId}-area` and `${filterId}-words`, each built by one function from the same dents (the
  flood, each dent's `feImage`, its growth transfer and its sum, the displacement), differing only in the offset the
  primitives are placed at and the region:
  - the area's: primitives at the dent's content-area px (`prims[i].x + off.left`, as the shading boxes are), region
    `-DENT_SCALE`, `-DENT_SCALE`, area width and height plus `2 * DENT_SCALE`;
  - the words': primitives as today (relative to the words box), region the words box plus `DENT_SCALE`, as today's.
  `Geo` measures the words box (`wordsBoxOf(host)`), not the wrapper, and gains the area's `w` and `h`. The
  `depthRef` map holds both filters' transfer nodes for a play, so `grow` moves both.
- **`setBend`.** While `filterOn`, `setBend(body, host, { area: url(#…-area), words: url(#…-words) })`; when it goes
  off, on a run cleared and on unmount, `setBend(body, host, null)`. Where `body` changes (`measure`), the old one is
  given up first.
- **The shake** sets `data-dw-chair-shake` on the body (or the host where there is none) and removes it as today's
  `data-shake` is; `steel-chair.css` moves the keyframes' rule to `[data-dw-chair-shake]`. Reduced motion still has
  none. The cleanup removes the attribute.
- Update the header comment's "Where" and "The dents" to say where the filter now stands and why (the design, 1).

**Tests first** (`Effect.test.tsx`, jsdom, with `filterTrusted` forced true as the file's other filter tests do):
the wrapper has no `filter` once a dent lands (red before); the area carries `--kb-bend` and `--kb-bend-words` naming
the two filters, and loses both on unmount and when the last play ends; an ORIGIN box's area inside a dented post's
body carries neither; both filters' transfer functions are driven by one dent's growth; the shake's attribute is on the
area.

## Task 3. The browser: nothing clipped, nothing trapped

Model: sonnet

**Files:** `e2e/steel-chair.spec.ts`, `instances/divided-world/ui/steel-chair/Chair.board.stories.tsx`.

Add `FabAfter` (Steel Chair played first, then Feelin' Fab, on the three paragraphs; `worldOf` gains the order). On
`with-fab` and `fab-after`, reduced motion (the foil holds still):
- **The foil is whole.** With the chair's shading layers and chairs hidden, sample the foil at five points of the
  content area well outside the words' box (below the last line, beside a short line, near the bottom border) before
  the dent lands (the run not yet started) and after: the same pixels, within 2 per channel. Poison: set the old
  `filter` on the chair's host wrapper (`page.evaluate`, the words filter's address and region grown back to the words'
  box), and the same samples turn to the board's ground: red.
- **Nothing is trapped.** The signature's pixels are the same with the foil shown and hidden. Poison: put
  `filter: url(#…-words)` on the element that holds Fab's host; the foil covers the signature: red.
- The existing `with-fab` test (the four corners of each dent's box) stays.

## Task 4. The gate: what bending the foil costs

Model: sonnet

**Files:** `instances/divided-world/ui/Shine.board.stories.tsx`, `e2e/dent-bend.spec.ts` (new),
`docs/research/2026-11-23-dent-bend/README.md` (new).

- **The page.** A story `Dented` on the Shine thread, with a Steel Chair on every post that has a Feelin' Fab, and an
  arg `bend` (true or false) that sets or removes `data-kb-bend` on every `.dw-fab-foil` once mounted, for the
  measurement alone (the story, not the effect).
- **The spec** reuses `e2e/shine.spec.ts`'s scroll (export what it needs from `e2e/shine-share.ts` or a new helper
  beside it; do not copy it). With `DENT_BEND_RUNS=N` it runs N scrolls of `bend: true` and N of `bend: false`,
  alternating, at `THROTTLE` 2 (CDP `Emulation.setCPUThrottlingRate`), and prints one `dent-bend-data` JSON line per
  run: the frame gap's 95th percentile and median, frames, and the bend. Without it, one pair, logged, and nothing
  asserted (the owner's ruling on the frame gap, #318).
- **Run it** with `DENT_BEND_RUNS=8` on the session's machine, headless Chromium as CI runs it. The verdict: **bent**
  if the bent runs' 95th-percentile gap (the median of the eight) is within 10% of the shade-only runs'; otherwise
  **shade only**. Write the figures, the machine, the command and the verdict in the README. The README is a record.
- Before trusting the spec, poison it once: a `bend` that also adds a 25 ms busy loop to every foil draw's
  `requestAnimationFrame` must read as over 10% (red); say so in the README.

## Task 5. Fab asks to be bent, if the gate passed

Model: inline

**Files:** `instances/divided-world/ui/feelin-fab/Effect.tsx`, `fab.css`, `Effect.test.tsx`, `e2e/steel-chair.spec.ts`.

- **If Task 4 said bent:** the foil's `<canvas>` carries `data-kb-bend=""` (the engine's `BEND_LAYER`). The header's
  "Where" says the foil takes a bending effect's dent. Test first in `Effect.test.tsx`: the canvas has the attribute.
  In the browser, on `with-fab` and `fab-after`: inside a dent's box, the foil's pixels (shading hidden) differ with
  the attribute present and removed. Poison: removed on both reads, the same pixels: red.
- **If Task 4 said shade only:** nothing is added to Fab. Its header says, in one sentence with the README's path,
  that the foil does not ask to be bent and why. The PR says which verdict it carries.

## Review focus

- The words box is a new element around every post's words in every place: a margin collapsing differently, a
  selector reading `.kb-act-main > …` or a takeover measuring the words could move a bare post's layout.
- `setBend` is single-owner: a run cleared, a body found again or an effect unmounted mid-dent must never leave a
  `--kb-bend` that nothing will take off, and a nested ORIGIN box must never inherit its post's.
- The shake now transforms the whole content area for 0.25 s: anything positioned fixed or measured during a hit
  inside the area (a callout, the Lens's anchor) moves with it.
- The gate measures one machine; the logged `dent-bend-data` line on CI is what tells a busy instance's cost drifting
  later, so check that it is printed.
- Fab bent after a chair, or before it, must look the same; a moment drawn in the thread and an ORIGIN box must bend
  as a live post does.
