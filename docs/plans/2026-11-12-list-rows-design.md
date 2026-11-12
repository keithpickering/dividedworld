# The index's and a board's rows, aligned on a phone and on a desktop: design

Record, written 2026-11-12. Designed with the owner in a design session. The plan that carries it out is
`docs/plans/2026-11-12-list-rows-plan.md`. The mockups are in `docs/research/2026-11-12-list-rows/`. They were drawn
from the real `Boards/01 Index` and `Boards/02 Board` stories in the e2e build, with only the candidate CSS and a few
DOM moves laid over them (`mock-phone.cjs`, `mock-desk.cjs` in that folder).

## 1. What was wrong

The owner sent two phone screenshots of the deployed instance, one row of the index and one row of a board, and asked
for both lists' rows to be polished, "particularly to ensure proper alignment on both mobile and desk". Read against the
code (`engine/ui/index/Index.tsx`, `index.css`; `engine/ui/board/Board.tsx`, `board.css`) and reproduced at 360px
(`01-phone-index-before.png`, `02-phone-board-before.png`), the rows have six defects.

1. **The folded cells stand on different baselines.** On a phone each count cell and the last-post cell is
   `display: inline`, so a row's cells flow as one text. `.kb-table td` sets `vertical-align: top` (`base.css`), which
   on an inline box means "align my top to the line's top". The last-post cell holds the 24px link targets and the
   avatar, so it is taller than the count cells, and its words sit lower than theirs. Measured at 360px, the index's
   "13 threads" stands 1px above the "·" and 3px below the thread's title in the same line. On the owner's phone, with
   its own fallback face and text size, the step is several pixels: "13 threads" rides high and the "·" between two
   cells reads as a full stop.
2. **The index's last post runs its words together**: "Spin a spin" and "last:" have nothing between them
   ("Spin a spinlast:"). The `<br>` that parts them on a desktop is hidden on a phone, and no separator takes its place.
3. **The last post breaks wherever the line ends.** The date drops to a line of its own with the name's comma left
   hanging above it, and the row's shape changes with the length of a name.
4. **"1 replies"**, and "1 threads" and "1 views": the unit is never singular.
5. **"↳ spun from …" starts beside the title** and wraps partway through on a phone, and after a long title on a
   desktop.
6. **On a desktop the columns do not share a baseline** (`07-desk-board-before.png`). Every cell is top-aligned with
   the same padding, but the title is 16px bold in a 24px box, a count is 13.75px text, and the last post's name is a
   13.75px link in a 24px box. So a row's count stands about 3px above its title's baseline and the name about 2px.

## 2. What was decided

### 2.1 On a phone, the last post has a line of its own (B)

A folded row keeps its counts on one line and puts the last post on the next:

- A thread: "1 reply · 2 views", then "last: [avatar] Snuckles, 2 days ago".
- A board: "13 threads", then "last: Spin a spin · [avatar] Snuckles, 2 days ago". A board with no posts reads
  "0 threads", then "last: None yet".

Every row then has the same shape whatever the length of a name, no line ends on a "·" or a comma, and nothing breaks
mid-phrase. The date never breaks (as today). On the index, the avatar, name, comma and date are one unit that moves to
the next line whole when the thread's title leaves no room for it; the title itself may wrap, since a title has no one
place to break. The unit breaks inside itself only when it is wider than the whole row (a very long name).

Weighed (`03` to `06` in the mockups):
- **A, one flowing line**, the board look's own form with the baselines fixed and the last post kept whole. The
  shortest rows. But when the last post does not fit it wraps, the first line ends on a hanging "·", and rows differ in
  shape with the length of a name.
- **B, the last post on its own line.** Chosen by the owner. It costs one line on a row whose counts and last post
  would have fit together.
- **C, counts at the left edge and the last post pushed to the right edge**, dropping to its own line when it does not
  fit. Not mocked: the owner chose B before it was drawn.

This replaces one decision of the board look (`docs/plans/2026-11-06-board-look-design.md`, "On the phone a row's
counts fold into one line … the index folds the same way"). The rest of that design's phone list stands: the ruled
table, the 40px folder column, the grays, and a date that never breaks.

### 2.2 "Spun from" has a line of its own, at every width

"↳ spun from #1 in Gabe my beloved" stands under the title on a phone and on a desktop
(`06-phone-board-b.png`, `08-desk-board-baseline-own-line.png`). The title always stands alone, and neither a long
title nor a long origin wraps beside the other. A spun row is one line taller on a desktop.

Weighed: beside the title on a desktop only (shorter desktop rows, but a long title pushes the origin to wrap), and
beside the title everywhere (today; on a phone it nearly always wraps partway through). The owner chose the line of
its own everywhere.

A card's mark tile (`.kb-thread-pin-mark`) stays beside the title, before the "spun from" line.

### 2.3 Every cell of a row stands on the title's baseline

The cells of a board row and of a thread row are aligned on their first baseline, not their top, at every width. On a
desktop the count and the last post's first line then stand on the title's baseline (`08`, `09`). On a phone the count
cells, which are still inline, share one baseline by the same rule. The folder cell keeps its own alignment (centered
on a desktop, at the row's top on a phone).

This was not put to the owner as a choice: it is what "proper alignment" asks, and the mockups the owner chose from
already had it.

### 2.4 A unit is singular at one

"1 reply", "1 view", "1 thread". The units are read only on a phone and by a screen reader; a desktop shows the column
head instead.

## 3. What does not change

- No data, payload, SQL or copy an instance supplies. The change is engine only, in the two screens' markup and CSS,
  so no interface is added ("KayfaBB never knows which instance it runs").
- Nothing a row shows is new, so nothing new is computed from a private fact, and no state is added that needs a way
  out.
- The 24px targets (WCAG 2.5.8) stay as they are: the title, the starter, the last post's name and its time are each
  a 24px box that meets no other.
- The table stays a table to a screen reader at every width: its roles, its hidden head on a phone, and each link's
  hidden words ("— latest post in General").
- The fold's widths: 40em for the index, and the container query for a board's list.

## 4. Open

- **The owner's screenshot shows the last cell's links larger than the counts beside them**, which the e2e build does
  not reproduce at any width. The likeliest cause is the phone's own face and text size (it has no Verdana). The
  baseline rule (2.3) removes the step whatever the sizes are, but the size difference itself is not explained. It is
  in the plan's review focus, to be looked at on a real phone after the build.
- **Option C** (2.1) was never drawn. If B's extra line reads as too tall once it is on a phone, C is the next thing
  to try.
