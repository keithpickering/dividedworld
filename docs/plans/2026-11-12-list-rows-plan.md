# The index's and a board's rows, aligned on a phone and on a desktop: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-list-rows-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches
SQL, a deployed service or an instance file. Every task is engine; no interface is added. No check (`check-*.mjs`) is
added, so there are no poisons beyond each test's own red run and the two end-to-end poisons Task 3 names.

The screens are the board's world (`docs/plans/2026-10-29-two-worlds-design.md`), in the board look
(`docs/plans/2026-11-06-board-look-design.md`), whose phone list this plan changes in one respect (§2.1).

## Task 1. A singular unit, and the markup the new lines need (engine)

Model: sonnet

**Files:** `engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`, `engine/ui/index/Index.test.tsx`,
`engine/ui/board/Board.test.tsx`. Read `engine/ui/mini.tsx` (`Byline`, `Who`, `Ago`).

**Tests first.**

`Index.test.tsx`, new cases:
1. A board with one thread reads "1 thread" in `.kb-board-threads` (its text content, units included), and one with
   three reads "3 threads".
2. A board with a last post: `.kb-board-last`'s text content starts with "last: ", then the thread's title, then
   " · ", then the name, ", " and the date. So the title and "last:" never run together (§1 item 2).
3. The name's `.kb-who` and the time's link are both inside one `.kb-board-last-by` element, and the title's link is
   not inside it.
4. A board with no posts: `.kb-board-last` reads "last: None yet".

`Board.test.tsx`, new cases:
5. A thread with one reply reads "1 reply" in `.kb-thread-replies`, and one with one view "1 view" in
   `.kb-thread-views`; four replies read "4 replies".
6. In a spun row, `.kb-thread-spun`'s text content starts with "↳" (no leading space), and it follows the title's
   link and the mark, if any, as a sibling.
7. `.kb-thread-last`'s text content starts with "last: " (the leading " · " is gone).

Run `npx vitest run engine/ui/index/Index.test.tsx engine/ui/board/Board.test.tsx` and record the red run.

**Code, `Index.tsx`.** The last cell's children, in this order:

```tsx
<span className="kb-board-last-label">last: </span>
{b.lastAt === null ? <span>None yet</span> : (
  <>
    {b.lastThread && b.lastTitle && (
      <>
        <Link to={`/t/${b.lastThread}`} className="kb-board-last-title">{b.lastTitle}</Link>
        <span className="kb-board-sep" aria-hidden="true"> · </span>
        <br />
      </>
    )}
    <span className="kb-board-last-by">
      <Byline character={who} id={b.lastCharacter} name={who?.name} link avatar={false} />
      <span className="kb-board-sep" aria-hidden="true">, </span>
      <br />
      {/* the time: the same link, or the same span, as today */}
    </span>
  </>
)}
```

The cell's leading `kb-board-sep` is removed in both branches. The threads cell's unit is
`{b.threadCount === 1 ? ' thread' : ' threads'}`.

**Code, `Board.tsx`** (the row, near line 333). The units: `' reply'`/`' replies'` on `t.replies`, `' view'`/`' views'`
on `views[t.id] ?? 0`. The spun span loses its leading `{' '}`. The last cell loses its leading
`<span className="kb-thread-sep"> · </span>`; the rest of the cell is unchanged. The views cell keeps its leading
separator, which parts it from the replies.

`tools/check-css-classes.mjs` lists the classes the code may name: add `kb-board-last-by` wherever that file wants a
new class named (read its head comment), and run its test.

Run the two test files green, then all of `npx vitest run engine/ui/index engine/ui/board`. An older case that read
the old order or the old leading separator is updated to the new, and the change is named in the task's record.

## Task 2. The stylesheets (engine)

Model: sonnet

**Files:** `engine/ui/index/index.css`, `engine/ui/board/board.css`, and a new test
`engine/ui/board/rows.test.tsx`. Read `engine/ui/base.css` (`.kb-table td`), `engine/ui/mini.css`, and
`engine/ui/spin/band.test.tsx` for the `css`/`strip`/`rules` helpers, which the new test copies.

**Test first, `engine/ui/board/rows.test.tsx`**, reading the two stylesheets as text:
1. Outside any `@media` or `@container`, a rule sets `vertical-align: baseline` for `.kb-board-row > td`, and one for
   `.kb-thread-row > td`; the folder cell (`.kb-thread-flags`) is still `vertical-align: middle` (§2.3).
2. `.kb-thread-spun` is `display: block`, outside any `@media` or `@container` (§2.2).
3. Inside `board.css`'s `@container` block, `.kb-thread-last` is `display: block`, and `.kb-thread-replies` and
   `.kb-thread-views` are still `display: inline` (§2.1).
4. Inside `index.css`'s `@media (max-width: 40em)` block, `.kb-board-threads` and `.kb-board-last` are each
   `display: block`, and `.kb-board-last-by` is `display: inline-block` with `max-width: 100%`.
5. No rule in `index.css` names `.kb-board-last > a` any longer (the time's link is a child of `.kb-board-last-by`).

Record the red run.

**Code, `board.css`.**
- After the `.kb-thread-main` rule: `.kb-table.kb-thread-list .kb-thread-row > td { vertical-align: baseline; }`. The
  existing `.kb-thread-list td.kb-thread-flags { vertical-align: middle }` must still win for the folder; raise its
  selector to match if it does not, and say so in its comment.
- `.kb-thread-spun { display: block; }`, with a comment citing §2.2: the origin has a line of its own under the title
  at every width.
- In the `@container` block: `td.kb-thread-last` leaves the list of inline cells and becomes `display: block` (it
  keeps the muted color, the small size and the 1.6 line height of that rule). The comment above the block and the one
  above `.kb-thread-sep` ("169 replies · 4 views · last: Pipewrench, Oct 5") are rewritten to the two lines of §2.1.
  The folder cell in the fold keeps `vertical-align: top` behavior by its absolute position; check it by eye.

**Code, `index.css`.**
- `.kb-table.kb-board-list .kb-board-row > td { vertical-align: baseline; }` near the top.
- The three places `.kb-board-last > a` is named become `.kb-board-last-title` and `.kb-board-last-by > a`, with the
  same declarations and comments.
- `.kb-board-sep` stays hidden on a desktop.
- In the `@media` block: `td.kb-board-threads` and `td.kb-board-last` are `display: block` (color, size and line
  height as today); `.kb-board-last-by { display: inline-block; max-width: 100%; }` with a comment: the name and the
  date move to the next line whole, and break inside only when wider than the row. The time's link stays
  `white-space: nowrap`; the title's stays `normal`. The block's head comment is rewritten to §2.1's two lines.

Run the new test green, then `npx vitest run engine/ui` and record it.

## Task 3. The rows in a browser (engine, end to end)

Model: sonnet

**Files:** `e2e/phone-board.spec.ts`, `e2e/board-last-targets.spec.ts`, `e2e/mini-who.spec.ts`,
`engine/ui/board/Board.board.stories.tsx`, `engine/ui/index/Index.board.stories.tsx`, the manifests
`e2e/boards/2026-11-06-board-look/01-index.ts`, `02-board.ts`, `03-phone.ts`, and a new `e2e/list-rows.spec.ts`. Read
`e2e/board-match.ts` for what a manifest's `buildShift` and a departure are.

**The stories.** `Boards/02 Board`'s world gains nothing (the manifests compare it). The new spec needs a spun thread
with one reply and a board whose latest thread has a long title; if no fixture story has them, add a story
`Boards/02 Board/Spun` beside the existing one (a thread spun from post 1 of another, one reply, a long-named last
poster) and name it in the spec. It is compared with no manifest.

**Tests first, `e2e/list-rows.spec.ts`**, opening stories the way `phone-board.spec.ts` does (its `open` helper, the
fixed clock, `standInFaces`, `loadFaces`). The baseline of an element is read by appending a zero-size inline-block
probe to it and taking its bottom (`mock-phone.cjs`'s first draft did this; write the helper once in the spec).

At 1440 by 1000:
1. In every thread row, the baselines of the title's `<b>`, the replies' figure, the views' figure and the last
   post's name are within 0.5px of each other.
2. In every board row of the index, the same for the board's name, the threads' figure and the first line of the last
   post.
3. In the spun row, `.kb-thread-spun`'s top is at or below the title link's bottom, and its left edge is the title's.

At 390 by 844, and again at 360 by 800:
4. In every thread row, the replies' and the views' units share a baseline within 0.5px; `.kb-thread-last`'s top is
   at or below the bottom of both; inside it, "last:", the name and the date share one line (their vertical middles
   within 12px, as the old test allowed for a 24px target beside 13.75px type).
5. In every board row, `.kb-board-last`'s top is at or below `.kb-board-threads`'s bottom, and its text starts at the
   row's left edge with "last:".
6. No line of a row's counts or last post ends in "·" or ",": for each text node of the separators, the next visible
   sibling's first client rect is on the separator's own line.
7. With the long title, `.kb-board-last-by` has one client rect (it moved whole), and the row does not scroll
   sideways (`scrollWidth <= clientWidth` on the list).

Two poisons, each a test of its own that injects a style and expects the measure above to name it:
`.kb-thread-row > td { vertical-align: top !important }` fails the measure of case 1, and
`.kb-thread-last { display: inline !important }` fails case 4's "at or below".

Record the red run before Tasks 1 and 2 are merged into the branch's build, or against a build of `main` if they
already are: the cases must be seen failing on the old rows.

**The older specs.**
- `phone-board.spec.ts`: "a thread row's replies, views and last post share one line at 390" and "the index's threads
  and last post share one line at 390" assert what §2.1 replaces. Each is rewritten to the new shape (the counts share
  a line; the last post is on the next), its head comment citing this design, and its poison likewise. The date tests
  stand.
- `board-last-targets.spec.ts` selects the time as `.kb-board-last :scope > a`; it becomes `.kb-board-last-by > a`,
  and its poison's selector with it. The two boxes must still not intersect and each be 24px.
- `mini-who.spec.ts`: run it; change only what the new markup breaks.

**The manifests.** The baseline rule moves a count and a last post down by a few pixels on a desktop, and the phone
board's rows are a line taller. Run `npm run test:e2e` and, for each landmark of `01-index`, `02-board` and `03-phone`
that now falls outside the match's tolerance, add or change its `buildShift` to the measured value and add one line
to the manifest's "Departures, each a decision" naming this design's section. No tolerance is widened and no landmark
is dropped. The research boards under `docs/research/2026-11-06-board-look/` are records and are not redrawn.

Run `npm run build` whole and record its tail.

## Review focus

- **The owner's phone.** The screenshot that started this shows the last cell's links larger than the counts beside
  them, which the e2e build never reproduced (design §4). After the build, the rows are looked at with no Verdana
  installed (a fallback sans) and at the 125% and 200% text sizes, at 360 wide, for any step the baseline rule does not
  remove.
- **A row with every part at once on a phone**: a mark tile, a spun origin whose words are long, "first unread", nine
  pages, a long-named starter and last poster. Each line wraps inside itself only, and the 24px targets meet no other
  (`e2e/a11y.spec.ts`'s target checks).
- **The folder cell and the stub rows.** `vertical-align: baseline` is set on a row's cells: the folder stays centered
  on a desktop, a "Moved:" stub row and the 4px gap row are untouched, and the theme picker's preview table, if it
  shares these classes, still draws as it did.
- **A screen reader's order on the index.** The label "last: " now leads the cell in the DOM. It is `display: none` on
  a desktop, where the column head names the cell, so nothing is read twice; on a phone the cell reads "last: title,
  name, date".
- **Themes.** The rows are checked in each theme the instance ships, light and dark, since the first screenshots came
  from a blue theme and the mockups were drawn in Silver.
