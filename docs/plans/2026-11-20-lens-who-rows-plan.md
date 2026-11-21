Record, written 2026-11-20.

# The Lens's Who rows at scale: plan

Carries out `docs/plans/2026-11-20-lens-who-rows-design.md` (#873). Who splits into Up now and Ended; ended rows are
compact disclosures that expand into today's row; Go to post leaves the thread page's Lenses; an All N button opens a grid of
every kind when the tab row overflows. Line numbers are as read at `0bf2e7b`. Read the function, not the line.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no check needs a
poison. No migration and nothing in `supabase/` changes. The engine boundary check holds throughout: engine tests use the
fixture cards `engine/ui/cards/lens.test.tsx` already builds (`world()`), never Divided World's. No deployed database, bucket
or connector is touched.

**The world.** The Lens is the glass (`docs/plans/2026-10-29-two-worlds-design.md`): Anton and Barlow Condensed at the
glass's sizes, the play's ink on its bar, cyan for the selected, skewed buttons, chamfered panels, no rounded pills and no soft
shadows. Every word is plain and out of character. The glass's text floor holds: 20px Barlow Condensed for every word added,
including line 2 and the grid's counts.

## Task 1. `inForce`: whether a play is up now (engine)

Model: sonnet

**Files:**
- `engine/ui/cards/plays.ts`: add `export function inForce(play: CardPlay, now: number, keeps: boolean): boolean`, beside
  `livePlays` (line 132). True when the play is not `reversed`, not `untaken`, not `caught`, not `instant`, not `spent`,
  and its `ends` is absent, ahead of `now`, or passed with `keeps` true. A face-down play is in force when it is not
  `revealed`, not `takenBack`, and `backOver(play, now)` is false. A play whose `starts` is ahead is in force. Its header
  comment says it is what the Lens's Who groups by and the kinds grid's sign reads, and that it agrees with `endable`
  (`engine/ui/cards/Lens.tsx`, line 525) on every face-up play.
- `engine/ui/cards/Lens.tsx`, `endable`: unchanged in behavior; its comment points at `inForce`.

Tests first, in `engine/ui/cards/plays.test.tsx`, beside `livePlays`'s, one case each: an admin-ended play, an untaken play, a caught play, an instant play,
a spent fall, a play past its `ends`, the same play with `keeps`, a play with no `ends`, a play whose `ends` is ahead, a
play whose `starts` is ahead, a live face-down back, a sprung back's revealed play, a back past its `endsAt`. One property
case: for every face-up fixture, `inForce(p, now, keeps) === endable(p, now, keeps)`. Red before the function exists.

## Task 2. Who in two groups (engine)

Model: sonnet

**Files:**
- `engine/ui/cards/Lens.tsx`, `Who` (line 579): split `plays` into `up` and `ended` by `inForce(p, now, keeps)`, where `keeps`
  is the card's `CardRules.keeps` (the caller already reads it for `endable`, line 568). `up` keeps the order it is given
  (`rowPlays`, line 864: layer order top first for a stacking card, else billing order). `ended` is sorted by `playedAt`,
  newest first, ties by id. Draw `<li className="kb-lens-group" role="presentation">` headings inside the `<ul>`, each an
  `<h3 className="kb-lens-group-head">`: "Up now" only when both groups have rows; "Ended · N" whenever `ended` has rows. The
  rows under a heading are a nested `<ul>` so the list's structure reads as two lists to a screen reader (an `<li>` per
  group holding its `<h3>` and its `<ul>`; the outer `<ul>` keeps its `id` for the fold's `aria-controls`).
- Where `then` (`RowProps.then`) holds every play of the kind, the rows are a moment's: no groups, one list as today.
- The fold's words (`kb-lens-fold-words`) are unchanged.
- At the foot of the Ended group, a comment marks where #871's pager will stand. Nothing is drawn.

Tests first, in `engine/ui/cards/lens.test.tsx`, under "what the Lens says and offers":
- A kind with one play in force and two ended (one past its `ends`, one ended by an admin) unfolds to "Up now" with one row,
  then "Ended · 2" with two rows, newest played first.
- A kind with every play in force draws no heading; a kind with every play ended draws "Ended · N" and no "Up now".
- A stacking card's up-now rows stay in layer order, top first, with an ended layer below in Ended.
- An ORIGIN box's moment (`then` holding the kind's plays) draws no heading.
- The existing "Who is folded, and unfolds to its rows in billing order" (line 303) and "a card whose rules stack lists its
  rows by layer" (line 444) pass unchanged: their plays are all in force.
Red first.

## Task 3. The compact ended row (engine)

Model: sonnet

**Files:**
- `engine/ui/reactions/Reactions.tsx`: lift the chip computation in `Reactions` (lines 100 to 150: the tally, the pending
  kinds, the blind plays' hiding, `chipOf`, `shownKeys`, `shown`) into `export function useReactionChips(act, author, tallies,
  mine, plays)`, which `Reactions` calls. Nothing it draws changes. The compact row reads the same hook, so whatever hides a
  total from a reader on the full row hides it on the compact row too.
- `engine/ui/cards/Lens.tsx`: split `PlayRow` (line 528) into its head (`kb-lens-row-head`: avatar, caster, when) and its
  body (`PlayDetail`: sprung words, note, message, More reactions than the post, Your play, the foot, `Spun`). Up-now rows draw
  head and body, as today.
- `engine/ui/cards/Lens.tsx`: add `EndedRow`. Its `<li className="kb-lens-row" data-kb-ended="">` keeps the ink bar. It holds
  one `<button type="button" className="kb-lens-compact" aria-expanded aria-controls>` with:
  - line 1 (`kb-lens-compact-head`): the avatar, the caster's name (`kb-lens-who kb-glass-display`, one line, ellipsis), the
    date the play was played as `when`'s date without the time (add a `day` form to `when` in `engine/ui/thread/lines.tsx`
    if it has none; grep for an existing date-only formatter first), and the chevron (`kb-lens-fold-sign`, reused).
  - line 2 (`kb-lens-compact-line`), drawn only when it has words or chips: the row's note when the play is `reversed`,
    `untaken` or `caught` (the note `PlayRow` computes today, including a catch's fate), else the message cut to one line
    (CSS `text-overflow: ellipsis`, the full message in the expanded body), and at its right the chips from
    `useReactionChips`, each the emoji and its count, as plain text (no buttons inside the button). A chip whose count is
    hidden is drawn as the emoji alone.
  - The button's accessible name is its text; the chips read as "🔥 5" and the screen reader speaks the emoji's own name.
  Under the button, when expanded, `<div id>` holds `PlayDetail` for the play.
- `Who` keeps `openRow: Id | null` (state, reset when the card changes: key `Who` by the card, or reset in an effect on
  `card`). Pressing a row sets it to that row, or to `null` when it was open. Focus stays on the pressed button.
- `PlayRow`'s React picker, As it landed, End and Spin thread behave in the expanded body exactly as in a full row.

Tests first, in `lens.test.tsx`, a new `describe('ended rows')`:
- An ended row is one button with `aria-expanded="false"` carrying the caster, the date without a time, and the message's
  text; it holds no React, Spin thread or As it landed control.
- A play an admin ended says "Ended by an admin" on line 2 in place of its message; one that did not take says its note.
- A play with reactions shows each kind's emoji and count on line 2; a play with none draws no chips; a play with no
  message and no reactions draws no line 2.
- Pressing it sets `aria-expanded="true"` and shows React, Spin thread and As it landed under it; pressing again hides them.
- Opening a second ended row folds the first.
- Changing tab and coming back shows every ended row folded.
- Enter and Space on the focused row expand it (the keyboard path costs what the pointer's does).
- `Reactions.test.tsx` (or the reactions tests' file): the existing tests pass unchanged after the lift; one new test that
  `useReactionChips` hides counts exactly where `Reactions` does (a blind play on the act).
Red first.

## Task 4. Go to post only off the page (engine)

Model: inline

**Files:**
- `engine/ui/thread/Post.tsx`: the post's `PostMarks` (line 291), the character's (line 303) and the thread head's (line
  368) pass `to={null}`. `reachAt.to` (lines 304 and 369) is unchanged: it is the play form's, not Go to post's.
- `engine/ui/board/Board.tsx` (lines 234 and 270) and `engine/ui/spin/Origin.tsx` (lines 232 and 240) are unchanged.
- `PostMarks`'s `to` comment (`engine/ui/cards/Marks.tsx`, line 268) and `RowProps.to` (`Lens.tsx`, line 340) say null is
  "the Lens is on the page the post is on".

Tests first:
- `lens.test.tsx` line 579, "every play of a kind is reachable by Spin thread and Go to post from its row": it builds its
  Lens with a `to`, so it stands; add beside it that a Lens given `to={null}` draws no Go to post.
- `engine/ui/thread/Thread.test.tsx`: a post's Lens on the thread page has no Go to post link. Red first.
- The ORIGIN box's Go to post tests (`engine/ui/spin/Spin.test.tsx`, lines 476 and 509) pass unchanged.

## Task 5. The kinds grid (engine)

Model: sonnet

**Files:**
- `engine/ui/cards/Lens.tsx`, `Lens` (line 709): `overflows` is true when the tab row's `scrollWidth` exceeds its
  `clientWidth` (read where `fadeOf` is read, line 795, from the same scroll and resize listeners). While it is true and the
  Lens is not on a form, the bar draws `<button type="button" className="kb-lens-all kb-glass-skew" aria-expanded
  aria-controls>` reading "All N" (N is `kinds.length`) after the tab strip and before `CloseCross`, inside `DialogBar`.
- `grid: boolean` state. When true, the body (`kb-lens-body`) draws `KindsGrid` in place of the open tab's sections: a `<ul
  className="kb-lens-kinds">` of buttons, in `kinds`' order, each with the kind's tab label, its count of plays (the plays
  of that kind in `billed`), and, where `billed.some((p) => p.card === kind && inForce(...))`, a sign
  (`kb-lens-kind-up`) whose words for a screen reader are "N up now" (a visually hidden span; the sign itself is
  `aria-hidden`). The visit's tab, where there is one, is the first entry, with no count.
- Choosing an entry calls `choose(kind)` (so a tab that reads first still reads first), sets `grid` false, and focuses that
  tab after the select lands (`tabs.current.get(kind)?.focus()`, as `move` does at line 856).
- Esc while `grid` is true closes the grid and stops there: handle it in the Lens's own `onKeyDown` before `Float` sees it,
  as a picker opened from a row does (see the test at line 547 for the pattern), and give focus back to the All button. The
  All button pressed again closes it the same way.
- The tablist's `aria-label` and the tabs' roles are unchanged; while the grid shows, the selected tab keeps
  `aria-selected="true"` and the tabpanel's `aria-labelledby` points at the All button instead.
- The body's fades (`data-kb-more`, `data-kb-above`) read the grid as they read any body: add `grid` to the effect's
  dependencies (line 813).

Tests first, in `lens.test.tsx`, a new `describe('the kinds grid')`, with a world of more kinds than the test's width shows
(stub `scrollWidth` and `clientWidth` on the tab row; `fadeOf`'s tests, line 1894, read the same three numbers):
- No All button while the tabs fit; "All 12" when they do not.
- Pressing it shows twelve entries in the marks' order, each with its count, and "1 up now" on the kinds with a play in force.
- Choosing an entry opens its tab, hides the grid and puts focus on the tab.
- Esc closes the grid and leaves the Lens open, with focus on All; Esc again closes the Lens.
- A Lens on a form draws no All button.
Red first.

## Task 6. The look, the stress story and a look at it (engine)

Model: sonnet

**Files:**
- `engine/ui/cards/lens.css`: `.kb-lens-group-head` (Anton at the glass's label size, in capitals, the glass's muted text, a
  1px rule under it in the glass's line token, the same side padding as a row); `.kb-lens-row[data-kb-ended]` (the ink bar
  kept; the row's padding about half today's); `.kb-lens-compact` (a full-width, unstyled button: no skew, text left, its
  focus ring the glass's; two grid rows, line 1 `avatar name date chevron` with the name `min-width: 0` and ellipsis, line 2
  `line chips`); `.kb-lens-compact-line` (20px Barlow Condensed, muted, one line, ellipsis); `.kb-lens-all` (the tab's
  skew and outline, never filled; cyan when `aria-expanded`); `.kb-lens-kinds` (a two-column grid at the dock's width, one
  column under 40em; each entry a chamfered outline in the kind's ink, as an unselected tab is, with the count at the right);
  `.kb-lens-kind-up` (a small filled square in gold, the glass's "ready and earned", never a rounded dot). Reduced motion:
  the chevron's turn is instant, as `.kb-lens-fold-sign`'s is (lines 299 and 302).
- `engine/ui/cards/FamousPost.board.stories.tsx`: carried from commit 84a12d3 (branch `ccr-ec41863e-3bkmsa`, where #871 was
  found) unchanged, with an `UnfoldedWho` pair of stories (desktop and phone) that open Sugar Coat and unfold Who, and an
  `AllKinds` pair that presses All. Its header's paragraph on the fake's read stays true until #871 lands; leave it.
- The new stories join the board stories' screenshot run by being `*.board.stories.tsx` (`e2e/board-stories.ts` globs
  them); run the a11y spec over them.

Proof, recorded in the PR with the numbers measured in a browser at 1440 × 1120 and 390 × 844 on `UnfoldedWho`:
- Sugar Coat's Who body scroll height, against today's 2,764px and 3,043px. The target is under 1,200px at 1440 (one full
  row and thirteen compact rows of at most 64px with two headings).
- The number of ended rows fully visible in the phone's sheet with Who unfolded: at least four.
- Every compact row's text at least 20px, and the chips' count text included.
- Screenshots of `UnfoldedWho` with one ended row expanded, and `AllKinds`, at both sizes, in the PR.
- `.claude/skills/impeccable/scripts/impeccable detect --json engine/ui/cards/Lens.tsx engine/ui/cards/lens.css` run once,
  its findings answered in the PR.

## Review focus

- The Acts an instance already holds: a play an admin ended, a play that did not take, a caught play, a keeping card past
  its end and a sprung back each land in the group the design says; check `inForce` against `endable` and `livePlays` on
  real fixtures, not only the unit cases.
- A mask: the compact row's chips must hide exactly what the full row's reactions hide (`useReactionChips`), for every reader
  (author, caster, anyone).
- The lift out of `Reactions` must change nothing it draws or sends: the reactions tests and the board screenshots are the
  proof.
- Focus: after an expanded row folds, after the grid closes by Esc and after a kind is chosen, focus lands where the plan
  says and never on the page's body; Tab out of the Lens still goes where `leave` sends it.
- A busy instance: with dozens of ended rows, one expanded row draws its full controls and `Spun`; no other row subscribes
  to anything but its own tally.
- #871: nothing here assumes how many ended plays a page holds; the Ended group's foot is free for its pager.
