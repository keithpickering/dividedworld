# Autocorrect as masking tape: plan

Record, written 2026-11-11. The plan for `docs/plans/2026-11-11-autocorrect-tape-design.md`. One build session builds it in
one PR from `main`. The look and the motion are the Autocorrect tape bench
(`docs/research/2026-11-11-autocorrect-tape-bench/01-bench.html`, version 5), which the owner judged on 2026-11-11. Its
drawing code (`drawPaper`, `makeResidue`, the flap's perspective, `dropRoll`) is the reference for how things look. Where
the bench and the design disagree, the design wins.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. There is no
migration and no SQL: `effect_state` keeps its 256 KiB bound, and the database never reads a strip's shape.

**The layers.** Tasks 1 and 2 are engine (`engine/ui/bbcode/`, `engine/ui/shine/`) and name no card. Every other task is
the instance's (`instances/divided-world/`, `e2e/`).

**Before Task 4, ask the owner one question.** The design's Section 9 (saving a half-peeled strip) is the session's
recommendation, not yet the owner's answer. If the owner has overturned it in the design's review, Task 3 drops `stuck`, and
Task 7 keeps a half peel only for the visit. Nothing else changes.

## Task 1: a run's trail

Model: sonnet

Files: `engine/ui/bbcode/layers.tsx`, `engine/ui/bbcode/render.tsx`, `engine/ui/bbcode/render.test.tsx`.

- `TextRun` gains `readonly trail?: (key: string) => ReactNode`. It is drawn once, right after the run's last drawn piece,
  inside that piece's formatting, and only for a `wrap` run whose end is drawn (not covered by a higher run).
- The header comment of `layers.tsx` says what a trail is, in the voice of the rest of it.

Tests first, in `render.test.tsx`:
- A `wrap` run with a trail over "big cats" in "I love big cats today" draws the trail once, between "cats" and " today".
- Over "big [b]cats[/b] today" the trail is inside the `<b>`, after "cats".
- A run whose end lies under a higher `replace` run draws no trail.
- Two touching `wrap` runs, each with a trail, draw both trails in order.
- A run with no trail draws exactly what it drew before (one existing wrap test, unchanged, stays green).

## Task 2: a quiet shine host

Model: inline

Files: `engine/ui/shine/loop.ts`, `engine/ui/shine/loop.test.tsx`.

- `Options` gains `readonly quiet?: boolean`. A quiet host is drawn and lit as any host is, but `shinyInView` skips it, so
  `watchShinyInView` never names its canvas.

Test first: register one quiet host in view and one ordinary host out of view, and `watchShinyInView` reports null. Then
bring the ordinary one into view, and it reports that one's canvas.

## Task 3: what the card keeps, and the numbers its screens read

Model: sonnet

Files: `instances/divided-world/cards/autocorrect.ts`, `instances/divided-world/cards/cards.test.ts`,
`instances/divided-world/settings.ts`, `instances/divided-world/settings.test.ts`.

- **The saved state** is `{ peeled: number[]; clean?: boolean; stuck?: Record<string, Stretch[]> }`. `stuck` is keyed by
  the strip's place, as a decimal string. A `Stretch` is `[from, to, edges]`:
  - `from` and `to` are shares of the strip's length, each a multiple of 0.0001 in [0, 1], with `from < to`.
  - `edges` is a whole number from 0 to 8, `startKind * 3 + endKind`. A kind is `0` (the strip's own end, allowed only at
    share 0 or 1), `1` (a peel line, where the roll waits) or `2` (a tear).
- **`validateState`:**
  - It sorts nothing in `stuck`. Each strip's stretches must already be in order and must not overlap.
  - A place in `peeled` has no `stuck` entry.
  - It rounds shares to 4 places.
  - It refuses more than `STUCK.most` (2,000) stretches in all, naming the predicate that failed ("a save holds at most
    2000 stretches").
  - It keeps `{ peeled, clean }` states exactly as today.
- **`screenReads`:** `autocorrect.peelMs` is removed. These come in, each `whole: true`:
  - `autocorrect.pace` (px a second): 20 to 400;
  - `autocorrect.pickMs`: 0 to 2000;
  - `autocorrect.give` (px): 8 to 200;
  - `autocorrect.peekStayMs`: 0 to 5000;
  - `autocorrect.peekSettle` (px a second): 20 to 2000.
- **`settings.ts`'s `cardSettings`:** `'autocorrect.pace': 90, 'autocorrect.pickMs': 450, 'autocorrect.give': 34,
  'autocorrect.peekStayMs': 300, 'autocorrect.peekSettle': 300`, in place of `peelMs`.
- **The header comment's "Its state" bullet** says what `stuck` is.

Tests first, in `cards.test.ts`, beside "Autocorrect's saved state is the author's peels by occurrence":
- `{ peeled: [0], stuck: { '2': [[0.25, 1, 3]] } }` is kept.
- `[[0.25, 1, 3]]` means: a peel line at 0.25, and the strip's own end at 1.
- Each of these is refused, and the refusal names its predicate:
  - a stretch with `from >= to`;
  - overlapping stretches;
  - out-of-order stretches;
  - a kind `0` edge at a share other than 0 or 1;
  - `edges` 9;
  - a share of 1.00001;
  - a place both in `peeled` and in `stuck`;
  - 2,001 stretches.
- 0.123456 is kept as 0.1235.
- The largest save there can be (`PEELS.most` places in `peeled`, and 2,000 stretches spread over other places) fits
  262,144 bytes as Postgres writes it. Reuse the existing measure.
- An old `{ peeled: [0, 1, 3] }` state is kept unchanged.

In `settings.test.ts`, the five settings are present, and an instance missing `autocorrect.pace` is refused at load
(`engine/rules/instance.ts`'s `screenReads` check).

## Task 4: the tape's model

Model: sonnet

Files: `instances/divided-world/cards/autocorrect/tape.ts` (new), `tape.test.ts` (new). `peel.ts` keeps only what Task 11
says.

Pure functions, no DOM:

- **`stripsOf(text, plays)`** gives every strip:
  - `{ key: \`${play}:${index}\`, play, index, z, from, to, replacement }`, with `index` the occurrence's place in the
    play;
  - `z` the play's order, later on top;
  - the stacks, which are groups of strips whose `[from, to)` overlap.
- **`roomOf(stack, measure)`** gives, for each distinct end offset of the stack's live and visit-peeled strips, the number
  of break-spaces to add there. `measure` is `{ words(from, to): px, replacement(text): px, space: px, pad: px }`.
  - Ends are taken in ascending order. A strip's room is what it lacks after counting its words and any room already set
    strictly inside it.
  - This is the bench's `footprint`, with `measure` in place of canvas calls.
- **`exposed(strip, live)`**: no live strip with a higher `z` overlaps it.
- **`dealWords(replacement, capacities, measureAt)`** gives `{ words: string[], scale }` for the design's Section 2:
  - each piece takes the words that fit it;
  - only an overflowing last piece shrinks the scale, in 0.05 steps, down to 0.6.
- **`Stretch`, the stuck model:**
  - `stuckOf(saved)` turns a saved strip into stretches. A strip with no `stuck` entry is `[[0, 1, 0]]`, and a place in
    `peeled` is `[]`.
  - `piecesOf(stretches, widths)` maps stretches onto a screen's pieces. Each piece gets its stuck intervals in local px,
    with edge kinds. A stretch crossing a piece boundary is cut there, and a cut made by a line break is kind `0` on that
    piece.
  - `fromPieces(intervals, widths)` turns a screen's pieces back into stretches, joining across piece boundaries where a
    stuck interval touches both sides.
- **`peelStep(p, want, dt, s)`**, the design's Section 6:
  - It moves the peel line by `min(want, s.pace * dt)`.
  - It adds the move to `rolled`.
  - It builds strain at `1.2 + (lag − give) / 30` a second while `lag > give`, and drains it at 2.5 a second.
  - It reports `{ moved, strain, tore }`. `tore` is true when strain reaches 1.
- **`rollDiameter(rolled)`** is `√(9 + 0.55 · rolled)`.
- **`liftsOf(pull, widths)`**: one pull lifts the pieces of a chain in turn. Piece `i` gets
  `clamp(pull − Σ widths before i, 0, width i)`.
- **`settle(pull, stay, since, dtMs, speed)`**: after a let-go, the pull holds for `stay`, then falls at `speed` px a second
  to 0.
- **`flapOf(lift, width, height)`**, the design's Section 7:
  - It gives `{ theta, perspective }`, with `theta = 150 − 58 · min(1, lift / width)` degrees.
  - `perspective = max(13 · height, 3 · lift)` px, so the free end is at most about 1.5 times the fold's height.

Tests first, in `tape.test.ts`:
- `roomOf` over the bench's stack ("Big cats are", with "big cats" → "small dogs", "cats are" → "nobody asked", "big
  cats" → "Wigglers"):
  - with a fixed-width `measure`, room lands after "cats" for the larger of the two strips ending there, and after "are"
    for "nobody asked" less the room already inside it;
  - a strip already wider than its replacement gets none;
  - a strip peeled before this load (passed as `saved`) is left out.
- `exposed`: in that stack, only "Wigglers" is exposed; with it peeled, "nobody asked"; then "small dogs".
- `dealWords`:
  - "the single greatest achievement" over capacities [120, 400] puts the words that fit in the first piece, at scale 1;
  - a word too long for the first piece moves to the second rather than shrinking;
  - only an overflowing last piece shrinks the scale, never below 0.6.
- The round trip: `fromPieces(piecesOf(s, w), w)` is `s` for every stretch list in a table, cut over one, two and three
  pieces. That includes a stretch crossing a piece boundary, and a hole in the middle piece.
- `peelStep`:
  - at `pace` 90, a hand 200px ahead moves 1.5px in a 1/60 s step, and strain builds;
  - a hand within `give` drains strain;
  - strain reaches 1 (a tear) in under 0.9 s at a lag of 100px;
  - a keyboard step (`want = pace · dt`) never builds strain.
- `liftsOf`: a pull of 150 over widths [100, 80, 60] gives [100, 50, 0].
- `settle`: a pull holds for `stay`, then reaches 0 at `speed`.
- `flapOf`: theta is 150 at no lift and 92 at a full one, and the free end's scale `p / (p − lift · sin theta)` never passes
  1.6 for widths 20 to 900 and heights 16 to 32.

## Task 5: paper, residue and the marker

Model: sonnet

Files: `instances/divided-world/cards/autocorrect/paper.ts` (new), `residue.ts` (new), `paper.test.ts` (new),
`residue.test.ts` (new), `instances/divided-world/cards/autocorrect/fonts/GochiHand-Regular.woff2` (new),
`instances/divided-world/cards/autocorrect/fonts/OFL.txt` (new), `instances/divided-world/cards/autocorrect/autocorrect.css`.

- **`paper.ts`:**
  - `drawPaper(ctx, w, h, seed)` is the bench's `drawPaper`, with the bench's constants. It draws through a
    `CanvasRenderingContext2D`, so a test can pass a recording context.
  - It exports `endJags(seed, w, h)` and `crepeLines(seed, w)`, which the residue shares, so the residue's outline and
    ridges match the tape's.
  - `PAPER` (`base`, `ink`) are the colors the stylesheet's plain fallback fill and the ink use.
- **`residue.ts`:**
  - `filmAlpha(w, h, seed)` returns the bench's film as an alpha array at density 2: two scales of value noise, the crepe
    imprint, the edge line and the torn outline.
  - `residueInk(band, light)` gives the tint and the gloss as colors already clamped into the board's band
    (`clampInto`, `engine/ui/shine/band.ts`), keeping their hue.
  - `fibersAt(seed, x, h)` gives the strokes of a tear's fiber cluster.
- **The face.** Gochi Hand's Latin `woff2` and its `OFL.txt` are vendored, with the source URL and the date in a comment
  in `autocorrect.css`. It gets an `@font-face` with `font-display: block`, so a strip is never drawn in a fallback that
  measures differently. Nothing is fetched at run time.

Tests first:
- **`paper.test.ts`:**
  - one seed records the same drawing calls twice, and two seeds record different ones;
  - nothing reads `Math.random` (spy on it);
  - `PAPER.ink` holds 7:1 on `PAPER.base`.
- **`residue.test.ts`, the band check:**
  - With `shineIsReadable` (`engine/ui/shine/band.ts`), the residue's composite at its thickest film plus its brightest
    gloss holds 4.5:1 against every post ink, at every light of `LIGHT_GRID`, on both boards' tokens.
  - **Its poison:** the same test, run with a `residueInk` that skips the clamp, fails. Record that red run in the PR.
- **`residue.test.ts`, the film:**
  - it is the same twice for one seed;
  - its alpha is 0 outside the torn outline;
  - its alpha is highest along the edge line.

## Task 6: the Effect lays the tape

Model: sonnet

Files: `instances/divided-world/cards/autocorrect/Effect.tsx`, `Effect.test.tsx`, `autocorrect.css`.

- **The runs.** Each stack's words are cut at every strip's ends into `wrap` runs.
  - Each run's pieces are spans marked with their stack and segment (`data-kb-ac-seg`), and carry `aria-hidden` and
    `data-kb-quotable="hidden"` while any tape covers them.
  - At each strip's end, the run's `trail` (Task 1) holds the room `roomOf` gives: a `span.dw-ac-room` of break-spaces.
  - A strip the author peeled before this load gets no room.
- **The anchors.** At each taped strip's start, a visually hidden button sits in the line, per the design's Section 10:
  - its name is the role's words;
  - it carries `data-kb-quotable="shown"` and the replacement;
  - it is out of the tab order (`tabIndex = -1`) while not `exposed`.
- **The overlay.** A `div.dw-ac-tape` sits over the post's words. For each live strip, the pieces are measured from a
  `Range` over the strip's first segment to its room or last segment, joined per line.
  - Each piece is drawn as a `div` positioned by its box, with a `canvas` drawn by `drawPaper` and an ink line from
    `dealWords`.
  - Its `z` is the play's order.
  - Measuring happens on mount, on a `ResizeObserver` change of the post's box, on `document.fonts.ready`, and on a new
    version of the post. It never happens per frame.
  - A piece's canvas is drawn when it first comes within the shine loop's margin of the viewport (`watchInView`). Until
    then it shows the CSS paper fill.
  - The anchor's focus draws the ring around its pieces (`data-kb-focus`).
- **The residue.** For each strip with peeled length, the residue is drawn in the strip's footprint:
  - masked to what is peeled;
  - with what lay on a lower strip cut out;
  - with its gloss on one canvas per post, drawn by the shine loop as a quiet host (`register(…, { quiet: true, share: 0.5
    })`) at `residueInk(bandFor(el), frame.light)`.
- **`still`:** the tape as saved, with no anchors pressable, no gloss movement (the rest light), and no measuring loop
  beyond the first.
- **The Lens** (`show`): the design's Section 12 words exactly, as `state`, `ends`, `notes` and `progress`.
- **Remove:**
  - `LONG` and the `dw-ac-long` path;
  - the `replace` runs;
  - the `TAPE` colors, replaced by `PAPER`;
  - the old `.dw-ac-strip` styles.

Tests first, in `Effect.test.tsx`. Replace the old tests that described the button strip and the drift. Keep the save,
retry and focus tests' intent:
- **Every occurrence gets one anchor,** named for the role. A reader's anchor reads "…Hold Enter or Space to lift it and
  read under it". None is inside a quote.
- **A quote holds the replacement** for a taped strip, and the author's words once it is peeled. These are the three
  existing quote tests, rewritten for the anchors.
- **The room.** With a stubbed `measure`, a replacement wider than its words puts `span.dw-ac-room` right after the words,
  inside their formatting ("[b]Mar[/b]io" keeps the room after "io"). A narrower one puts none.
- **The next load.** With `{ peeled: [0] }` saved, strip 0 has no room and no anchor, and its words are quotable.
- **The stack.** In the stories' stack, only the top strip's anchor is in the tab order. With the top peeled (saved), the
  next one's is.
- **The Lens.** It says "3 strips, 1 peeled" for a reader, with the reader's `ends`. For the author with a half peel saved,
  it says "3 strips, 1 peeled, 1 started", with the author's `ends`.
- **`still` draws pieces but no pressable anchor.**
- **Measuring.** It runs once on mount and again on a resize, and not on a pointer move (spy on `getClientRects`).

## Task 7: the hands

Model: sonnet

Files: `instances/divided-world/cards/autocorrect/Effect.tsx`, `hands.ts` (new: the pointer and key handling as a small
state machine over Task 4's functions), `hands.test.ts` (new), `Effect.test.tsx`.

- **The author's peel**, the design's Section 6:
  - the pick, with a corner lifting as it goes;
  - the pull at `pace`, with the roll at the peel line;
  - strain, shown as the stretch whitening and the roll shaking, which is off under reduced motion;
  - the tear, with Task 5's fiber cluster added to the residue at the tear;
  - letting go, where the roll waits;
  - either end, on any exposed piece.
- **The keyboard,** on the anchor: Enter or Space held picks, then peels its first unfinished piece at `pace`, from the end
  that has a roll, else the start. It never tears.
- **Saving.** On every change to an author's stuck model, debounce, then save
  `{ peeled, clean?, stuck }` through `fromPieces`. Use today's flush, retry and refusal handling unchanged, with one save
  in flight per play. A refusal puts back only the change it carried. A strip with no stretch left moves from `stuck` to
  `peeled`.
- **The reader's peek**, the design's Sections 7 and 8:
  - The pull lifts the chain (the piece, then `under`: lower strips' pieces overlapping it on its line, highest first)
    through `liftsOf`.
  - Each lifted part is drawn by `flapOf` as the bench draws it: hinged at the fold, `rotateY`, origin at the fold, with
    its sticky side up.
  - Letting go starts `settle` with `peekStayMs` and `peekSettle`.
  - Pressing any piece of a chain that is still up picks the pull up where it is.
  - A held key lifts at a piece's width every 0.45 s.
  - Nothing is saved.
- **Pressing a covered piece** says, in the status region: "Another strip is stuck over this one. That one comes off first."
- **When a strip comes off:** the status says "Peeled. Under it: “…”.", focus goes to the next exposed anchor or the post,
  and the strips beneath become exposed.

Tests first:
- **`hands.test.ts`,** with fake timers and no DOM:
  - a press at an end, held `pickMs`, starts a peel, and released early does not;
  - a press away from an end does nothing;
  - a pull past `give` for long enough tears, then needs a new pick at the torn end;
  - a roll left waiting needs no pick;
  - a peek pulled 150px over [100, 80] lifts [100, 50];
  - a peek let go holds for `stay`, then lays down;
  - a peek pressed again while laying down resumes from where it was.
- **`Effect.test.tsx`:**
  - The author holding Enter for `pickMs + (width / pace)` seconds peels a strip. Holding for half of that saves one
    stretch, with a peel line at the right share and kind `1`.
  - A reader's peek saves nothing.
  - A saved `stuck` state from a desktop width loads at a phone width with the same shares stuck.
  - The quick-peel, retry, leaving-the-post and refusal tests from today, carried over to stuck saves.
  - Pressing a covered strip says the status line and moves nothing.

## Task 8: the drop

Model: haiku

Files: `instances/divided-world/cards/autocorrect/drop.ts` (new, replacing `fall.ts`), `drop.test.ts` (new); delete
`fall.ts`.

- `dropFrames(seed, fall)` returns three keyframes:
  - `translate(0,0) rotate(0)` at offset 0;
  - `translate(d·0.1, −5px) rotate(s·0.06deg)` at offset 0.1;
  - `translate(d, fall) rotate(s deg)` at offset 1.
  - Here `d = (r − 0.5) · 50`, and `s = ±(200 + r · 260)`, with its sign from the seed. Both come from the card's `seeded`
    (`instances/divided-world/ui/seeded.ts`).
- `dropMs(fall)` is `260 + 13 · √fall`.
- `dropRoll(rollEl, { reduced, seed })` makes a fixed copy of the roll, `aria-hidden`, with no pointer events, falling to
  `max(80, innerHeight − top + 40)` with easing `cubic-bezier(.55,0,.9,.55)`. It removes the copy when done. Under reduced
  motion, or with no Web Animations, it makes no copy at all.

Tests first: the same frames for one seed and different for two; `dropMs(400) = 520`; under reduced motion nothing is added
to the document; the copy is removed when its animation finishes.

## Task 9: the words

Model: haiku

Files: `instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/index.test.tsx` (where the card's words are
asserted).

- `hint`: "Lift a strip by one end to read what is under it."
- `describe`: replace "Any reader can peel a strip off on their own screen; only the post's author can peel them for
  everyone, and the author's words are always under the tape and in the post's History." with "Any reader can lift a strip
  by one end to read under it, and it lays back down. Only the post's author can peel strips off, slowly, for everyone,
  and the author's words are always under the tape and in the post's History."
- `logSave`:
  - with `stuck` holding M places and `peeled` N, return `{ what: 'Strips peeled', said: \`You peeled ${N} of its strips,
    and started on ${M} more.\` }`;
  - with M = 0, keep today's line;
  - with N = 0, say "You started peeling M of its strips.";
  - use "strip" for one.
- The comment above the card's entry says "masking tape, written on in marker" for the effect. The face stays as it is
  (the design's Open).

Test first: each `logSave` case returns exactly its line, and the hint and description are the strings above.

## Task 10: stories, the e2e and the boards

Model: sonnet

Files: `instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx`, any board manifest under `e2e/boards/` that
draws an Autocorrect strip (`2026-11-05-backfill/28-lens.ts` and the welcome board's front door,
`instances/divided-world/ui/front-door.ts`, read only), and an e2e spec of its own, `e2e/autocorrect.spec.ts` (new).

- **The stories.** Add a reader/author switch, the bench's five posts as cases (one, covered wider, replacement wider,
  across lines, the stack), and a "half peeled" case with a saved `stuck`. Light and dark, reduced motion, at 1440 by 1120
  and 390 by 844.
- **`e2e/autocorrect.spec.ts`,** in Chromium, on the stories:
  - peeling a strip by keyboard takes at least `pickMs + width / pace`, and the post's words do not move by a pixel
    between before and after (compare every word's box);
  - a reader's three short drags reach the words under the stack at 390px;
  - after a reload, a peeled strip's residue takes the words' own width.
- **Boards.** Re-take the shots the boards' tooling names as changed, and say in the PR which boards changed and why
  (the new tape).

## Task 11: tidy and the docs

Model: inline

- **`peel.ts`:**
  - It keeps nothing the new code does not use.
  - `stripsOf`, `dragPeels`, `dragThreshold`, `holdShare` and `savedAfterPeel` are deleted with their tests, unless
    Task 4 re-homed them.
  - If nothing is left, delete `peel.ts` and `peel.test.ts`.
- **`autocorrect.css`** keeps only what is drawn.
- **The header comments** of `Effect.tsx` and `autocorrect.ts` name this design.
- **The first design** (`docs/plans/2026-11-03-autocorrect-design.md`) is a record and is left as written.
- **The full build:** `npm run typecheck`, then `npm run build:ci`, green.

## Review focus

- **Selection and find-in-page.** The author's words sit in the line under opaque tape. Check what a browser's own find,
  copy (Ctrl+C on a selection crossing a strip) and a screen reader's virtual cursor reach. The quote walker is covered;
  the browser's own copy is not. If copy leaks the words, say so in the review rather than hiding it, since the design
  never claimed it.
- **The trail inside formatting.** A strip that ends inside a link-free inline tag (bold, italic, color, size) must keep
  its room inside it. A size tag changes how wide a break-space is. Check that `roomOf`'s `space` is measured in the
  formatting the room sits in.
- **A tall phone post with many strips.** 200 occurrences of a short phrase at 390px: the time to measure, how many paper
  canvases exist (only those near view), and the memory held by residue films.
- **Saves from two screens.** An author peeling the same strip on a phone and a desktop at once: the last save wins, and
  neither screen crashes on a `stuck` that no longer matches its own pieces.
- **Old states and the seed data.** Saved `{ peeled, clean }` states in the fixtures and stories load unchanged, and
  nothing still writes `peelMs`.
- **The quiet host.** One Autocorrect residue with no foil or glitter on the page must not bring up the tilt tip, and the
  shine loop must stop when no residue is in view.
- **Touch on iOS Safari,** which the bench was not run on. A pick held on a strip must not start a text selection or the
  long-press menu. A peek drag must refuse the page's scroll once it has moved sideways, and a vertical swipe must
  scroll.
