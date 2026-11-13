# The index's last post: a name wider than the row, and a hung comma: plan

Record, written 2026-11-13. A follow-up the owner has answered, with no design session before it: issue #550 (from PR
#542, `docs/plans/2026-11-12-list-rows-design.md`, cited as §N). The owner's answer is recorded on #550: the index's
last post gets the treatment PR #599 built for a thread row
(`docs/plans/2026-11-13-last-post-unit-and-instant-clear-plan.md`, Task 1). When "name, date" is wider than the row,
the date takes a line of its own and the separator is not painted, so the two lists match.

This plan is built on #599's branch, because it reuses that PR's measures in `e2e/list-rows.spec.ts`; its PR is against
main and shows only its own change once #599 has merged.

The task is test first: the test named, its red run recorded, then the code, then the green run. It touches no SQL, no
deployed service and no interface between the engine and an instance. No check (`check-*.mjs`) is added, so there are
no poisons beyond each test's own red run and the end-to-end poisons the task names.

## Task 1. The index's unit keeps its "·" beside the name, and its comma hangs (engine)

Model: sonnet

**Files:** `engine/ui/index/Index.tsx`, `engine/ui/index/index.css`, `engine/ui/index/Index.test.tsx`,
`engine/ui/board/rows.test.tsx` (its index case), `engine/ui/index/Index.board.stories.tsx` (the `LongTitle` story),
`e2e/list-rows.spec.ts`, `e2e/board-last-targets.spec.ts`. Read `engine/ui/board/board.css` (the thread row's
`.kb-thread-last-by` and `.kb-thread-last-when` in the fold block: the mechanism this task repeats) and
`engine/ui/mini.css` (`.kb-who`).

**What is wrong (#550).** On a phone the index's last-post unit `.kb-board-last-by` ("· name, date") is an
inline-block that leads with its "· ". When the name is wider than the row the unit breaks inside itself: the "·" can
stand alone on a line, the name on the next and the date on a third, with the comma ending the name's line. The
`LongTitle` story's name was shortened in #542 so that cases 6 and 7 pass, so those cases do not prove the rule for
any name.

**What is built.**

1. **Markup.** Inside `.kb-board-last-by`, the "· " separator (where there is one) and the byline are wrapped in
   `<span className="kb-board-last-who">`, and the comma, the `<br>` and the date (its link, or its plain span where
   the board's last post has no thread) in `<span className="kb-board-last-when">`. On a desktop both are plain inline
   boxes and the cell renders as it does today.
2. **In the phone block** the unit is a wrapping flex box of those two items, `max-width: 100%`, that still moves whole
   to the line after the title when the title leaves no room for it (§2.1, case 7).
   - `.kb-board-last-who` is one item that does not wrap between the "·" and the name: the "·" keeps its place at the
     head of the name's first line, and a name wider than the row wraps inside its own box beside it. The "·" is never
     alone on a line.
   - The comma hangs as the thread row's does: a box of a set width and a set gap at the head of
     `.kb-board-last-when`, the item pulled left by both and the first item carrying the same room, a left-only
     `clip-path` on the unit at the gap. Beside the name the comma sits against the name; where the date starts a line
     the comma is not painted. The gap is at least 4px at every text size, so no focus ring is cut.
   - The two lists share the measures: the comma's width and gap are the same values as the thread row's. They are
     stated once as custom properties where both stylesheets can read them (`engine/ui/tokens.css` if a check on
     tokens allows it, else the same two declarations in each file with a comment naming the other), and `board.css`
     is touched only if that needs it; say which in the report.
3. **Selectors that named the date as the unit's direct child** move with it: `index.css`'s `.kb-board-last-by > a`
   (the 24px target; the phone block's `white-space: nowrap`) becomes the date inside `.kb-board-last-when`, and
   `e2e/board-last-targets.spec.ts` (its selector and its poison's CSS) follows. The date that is a plain span never
   breaks either.
4. **The `LongTitle` story's name goes back** to "Sir Reginald Featherstonehaugh-Wetherby the Third", the name #550
   was found with, and the story's comment says a name wider than the row is now held. Where a snapshot of that story
   exists, it is renewed and the PR says so.

The comma and the "·" stay `aria-hidden`; the links keep their hidden words and 24px targets. Nothing the row shows
is new.

**Tests first.**

- `Index.test.tsx`: the unit holds one `.kb-board-last-who` whose first child is the "· " separator and which contains
  the name's link, and one `.kb-board-last-when` that contains the comma and the date's link; the existing cases (the
  cell's text order, "· " leading the unit, two separators, the title outside the unit) are kept, changed only where
  they name a direct child. A board whose last post has no thread: the date's span is inside `.kb-board-last-when`.
  Red on main for the new assertions.
- `rows.test.tsx`: the index case expects the unit to be a box of its own (`inline-block` or `inline-flex`) with
  `max-width: 100%`, as the thread case does. (It passes on main; it is loosened only as far as the change needs, and
  the e2e is what holds the behavior.)
- `e2e/list-rows.spec.ts`, on `Boards/01 Index` and `LongTitle`, at 390 and 360 wide, at text sizes 100, 125 and 200,
  reusing #599's measures (`setTextSize`, the paint measure of a comma's strip, the ring measure), made to take the
  list's selectors rather than copied:
  - **8a, the "·" is never alone.** Every visible "·" of a unit has the first line of the name on its own line (the
    name's first client rect shares the dot's line). Red on main with the restored long name.
  - **8b, no comma ends or starts a line.** Where the name's box and the date share a line the comma is painted
    between them; where they do not, the comma is not painted (the paint measure) and the date starts at the unit's
    left edge within 1px. Red on main with the restored long name, and at 200%.
  - **8c, the focus ring is whole** for the date's link where it starts a line and for the name's link (the ring
    measure), at 200%; a row whose date starts a line is asserted to exist.
  - The list and the page do not scroll sideways at any of these sizes.
  - Cases 6 and 7 and their poisons stay, and pass with the restored long name: case 6 is no longer bounded by its
    fixture. Where case 7's measure (`byline`) reads the unit's parts by selector, it is updated to the new markup
    and its poison is still named.
  - **Poisons:** `.kb-board-last-by { clip-path: none !important }` is named by 8b as a painted comma; and
    `.kb-board-last-who { display: inline !important; }` with the unit made `inline-block` again (the form on main)
    is named by 8a as a "·" alone on a line. Each is one poison test, as the file's others are written. 8c has no red
    on main: its red run is the clip set hard at the unit's left edge, run once and recorded, then restored.
- `e2e/board-last-targets.spec.ts` stays green with its new selector, and its poison is still named.
- The board-look snapshots under `e2e/boards/` for the index must not change on a desktop; say which phone snapshots
  change, if any, and why.

**Then the code.**

## Review focus

- With the "·" inside the first item, the unit's first line reads "· name" exactly as before at 100% with an ordinary
  name (no shift of the dot or the name against main, on a phone or a desktop).
- A board whose last post has no title (no "·") and one whose date is not a link (no thread) both hold.
- The clip cuts no focus ring and hides nothing but the comma, in every theme's face.
- A screen reader reads the cell as before: the wrappers add no role and no words.
