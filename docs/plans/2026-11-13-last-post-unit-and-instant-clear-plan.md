# A thread row's last post as one unit, and an instant scroll clear: plan

Record, written 2026-11-13. Two follow-ups the owner has answered, with no design session before them: issue #554
(from PR #542, `docs/plans/2026-11-12-list-rows-design.md`, cited as §N) and issue #592, item 2 (from PR #562). The
owner's answers are recorded on the two issues. They touch different parts of `engine/ui` and travel in one PR.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches
SQL, a deployed service or an interface between the engine and an instance. No check (`check-*.mjs`) is added, so there
are no poisons beyond each test's own red run and the end-to-end poison Task 1 names.

## Task 1. A thread row's last post is one unit, and its comma hangs (engine)

Model: sonnet

**Files:** `engine/ui/board/Board.tsx`, `engine/ui/board/board.css`, `engine/ui/board/Board.test.tsx`,
`engine/ui/board/rows.test.tsx`, `e2e/list-rows.spec.ts`. Read `engine/ui/mini.css` (`.kb-who`), `engine/ui/index/index.css`
(`.kb-board-last-by`, the index's unit) and `engine/ui/base.css` (the focus ring: 2px, offset 2px; the text sizes).

**What is wrong (#554).** On a phone a thread row's last post is "last: [avatar] name, date" in a block cell with no
unit. At 360 wide and 125% text the date drops to a line of its own and the comma ends the line above; at 200% it does
so in every face; at 100% with a long name (`Boards/02 Board/Spun`) the name wraps in its `.kb-who` box and
", just now" starts a line. §2.1 says no line ends on a "·" or a comma.

**What is built.** Two things, the second because the first alone does not hold at 200%, where the unit is wider than
the row:

1. **The unit.** The byline, the comma, the `<br>` and the date's link are wrapped in `<span className="kb-thread-last-by">`,
   and inside it the comma, the `<br>` and the date's link in `<span className="kb-thread-last-when">`. On a desktop both
   spans are plain inline boxes and the cell renders as it does today (name, a line break, date; the comma not shown).
   In the fold the unit is one box, `max-width: 100%`, that moves whole to the line after "last:" when it does not fit
   beside it, as the index's `.kb-board-last-by` does.
2. **The hung comma.** When the unit is wider than the row, the date takes a line of its own inside the unit and the
   comma is not painted: no line ends on it and none starts with it. The unit is a wrapping flex box whose two items are
   the name (`.kb-who`, which may shrink and wrap its name inside itself) and `.kb-thread-last-when`. The comma is at
   the head of the second item, in a box of a set width followed by a set gap; the item is pulled left by that much and
   the name carries the same room after it, so that on the name's line the comma sits against the name, and at the
   start of a line the comma lies left of the unit's edge, where the unit clips it. The clip is on the left edge only
   and leaves the focus ring whole: the gap between the comma's box and the date is at least 4px (the ring's 2px and its
   2px offset) at every text size, and the clip is at that gap, so the ring of the date's link at a line's start, of the
   name's link and of anything else in the unit is not cut on any side.

The comma stays `aria-hidden`, the links keep their hidden words and their 24px targets, and the date's link never
breaks. Nothing the row shows is new. The index is not touched (see "#550" below).

**Tests first.**

- `Board.test.tsx`: a thread row's last cell holds one `.kb-thread-last-by` that contains the name's link, the comma
  and the date's link, and does not contain "last: "; the comma and the date's link are inside one
  `.kb-thread-last-when`. Red on main (no such element).
- `rows.test.tsx` (it reads the stylesheet's rules, as its index case does): in the fold `.kb-thread-last-by` is a box
  of its own with `max-width: 100%`. Red on main.
- `e2e/list-rows.spec.ts`, on `Boards/02 Board` and `Boards/02 Board/Spun`, at 390 and 360 wide, at text sizes 100,
  125 and 200 (`data-kb-text-size` on the root, set before the measure):
  - **6b, no comma ends or starts a line.** For each thread row: where the name's box and the date's link share a line,
    the comma is painted between them on that line; where they do not, the comma is not painted (read from the pixels
    left of the date, or from the comma's box lying wholly outside the unit's clip, whichever the implementer can show
    is a true measure of what is painted) and the date's link starts at the unit's left edge within 1px. No row's comma
    is painted as the last or the first thing on a line. Red on main at 125% (360) and 200% on `Board`, and at 100% on
    `Spun`, by the issue's own account; record which cases are red.
  - **6c, the unit moves whole.** Where the unit's parts fit the row's width (125% at 360, `Board`), the name and the
    date are on one line (middles within 12px, as case 4 holds) at or below the "last:" line. Red on main.
  - **6d, the focus ring is whole.** With the date's link focused where it starts a line (200%), and with the name's
    link focused, a screenshot shows the ring's color on all four sides of the link (or an equal measure). This holds
    the clip to the comma alone.
  - The list and the page do not scroll sideways at any of these sizes (as case 7 holds for the index).
  - **Poison:** injected CSS that makes `.kb-thread-last-by` `display: inline` again is named by 6b or 6c as a comma
    ending a line. One poison test, as the file's others are written.
- The existing cases 1 to 7 and their poisons stay green unchanged; the desktop cases prove the wrappers change nothing
  at 1440. The stories' snapshots under `e2e/boards/` are compared at 100% and must not change on a desktop; where a
  phone snapshot changes, say which and why.

**Then the code**, in `Board.tsx` and `board.css` only. The fold's rules are inside the board list's existing fold
block (a container query); the comments say what the rule is for, as the file's others do.

**#550.** The index's unit (`.kb-board-last-by`) is not changed, so #550 (a name wider than the row leaves the index's
"·" alone on a line) is left open. The hung comma is the first of #550's three listed directions built for the thread
row; whether the index's "·" and comma hang the same way is the owner's, and is put in the PR under `Design questions`.

## Task 2. `bringClear` scrolls at once (engine)

Model: sonnet

**Files:** `engine/ui/cards/clear.ts`, `engine/ui/cards/clear.test.tsx`, `engine/ui/cards/play.test.tsx`,
`instances/divided-world/cards/graffiti/Effect.test.tsx`, `e2e/graffiti.spec.ts`. No change to `play.tsx` or to
Graffiti's `Effect.tsx`.

**What is wrong (#592, item 2).** When draw mode opens, the post is scrolled clear of the dock, smoothly unless motion
is reduced. A press within about 300ms of opening lands on whatever is under the pointer then, which may not be the
post yet. The owner's answer: the opening scroll is instant for everyone.

**What is built.** `bringClear` calls `scrollIntoView({ block: 'start', behavior: 'instant' })` whatever the motion
setting, and no longer reads `motionReduced`. `'instant'`, not `'auto'`: `'auto'` defers to the root's
`scroll-behavior`, which a later stylesheet could set. Its header comment says why (a press during a moving scroll
lands off the post).

**Every caller of `bringClear`** (there are two, and both change the same way):

- `engine/ui/cards/play.tsx`, `bringComposeClear`: a card's compose opening on a post (pressing the ghost on a post,
  for Graffiti and any other card whose play composes on a post). Was smooth unless motion reduced; now instant. The
  same hazard applies: the compose's surface is the post, and a press while it moves misses it.
- `instances/divided-world/cards/graffiti/Effect.tsx`: draw mode opened from the Draw tile on a wall. Was smooth
  unless motion reduced; now instant.

Nothing else scrolls through `bringClear`; the other smooth scrolls in `engine/ui` (the carousel, the menu bar, the
guide) are their own calls and do not change.

**Tests first.**

- `clear.test.tsx`: the two cases that expect `'smooth'` and `'auto'` both expect `'instant'`, and the reduced-motion
  case stays as a case (instant under either setting). Red on main.
- `play.test.tsx`: the four expectations of `behavior: 'smooth'` or `'auto'` expect `'instant'`; the test names drop
  "smoothly". Red on main.
- Graffiti's `Effect.test.tsx`: its expectation of `'smooth'` expects `'instant'`. Red on main.
- `e2e/graffiti.spec.ts`, with motion not reduced, wide and on a phone, for the ghost and for the Draw tile: from the
  press, the body's top is read on every animation frame for about 40 frames; once it has moved it does not move
  again (at most one change of more than half a pixel), and it rests clear of the dock. Red on main, where a smooth
  scroll moves it over many frames. The existing "brought clear" cases stay; their comments no longer say a smooth
  scroll is waited out where that is no longer true.

**Then the code**, in `clear.ts`.

## Review focus

- The hung comma's clip cuts no focus ring and hides nothing but the comma, in every theme's face and at 150% as well
  as the sizes tested.
- A screen reader reads a thread row's last cell as before ("last: name, date — latest post in title" less the hidden
  comma): the two wrappers add no role and no words.
- With `bringClear` instant, a compose that opens on a post already clear still does not move the page (the "left
  alone" cases), and nothing waits on a `scrollend` that an instant scroll may not fire.
