Record, written 2026-11-22.

# The Vending Machine's flow: plan

Carries out `docs/plans/2026-11-22-vending-machine-flow-design.md` (the design; its sections are cited as "design, 3"). A
build session (`.claude/skills/build-session/SKILL.md`) builds it from this file alone. The look is the boards in
`docs/research/2026-11-22-vending-flow/` (its README lists them); where a board and the design disagree, the design wins
on what is decided and the board on how it looks.

**When it may start.** Any time. It touches no SQL, no migration and no payload. It may not start while another build
has an open PR that edits `engine/ui/vending/Vending.tsx` or `engine/ui/vending/vending.css`; it checks open PRs first.

**Every UI task** reads `.claude/skills/impeccable/reference/craft-floor.md` before its first edit, keeps every color,
size and font a glass token (`engine/ui/glass/tokens.css`), and runs
`.claude/skills/impeccable/scripts/impeccable detect --json <its changed .tsx files>` on its finished files. The
engine's sheet (`engine/ui/vending/vending.css`) lays the page out; the machine's drawing (body, marquee, the cells'
chamfers and neon) is the instance's (`instances/divided-world/ui/vending/vending.css`, design, "The layers"). No
engine file names Divided World.

## Task 1. The grid's keys and the typed code, as pure functions

Model: sonnet

Files: `engine/ui/vending/slot-keys.ts` and `slot-keys.test.ts` (new).

Two pure functions over the machine's slot list, with no React in them, so Task 2 wires them and the tests drive them
on plain arrays:

- `nextSlot(slots, from, key)`: `slots` is the machine's places in order, each `{ code, pickable }` (a sold out slot
  and a sealed place are not pickable), two to a row as `codeOf` (`Vending.tsx`) lays them. `key` is one of
  `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`. It returns the index of the next pickable place in
  that direction (left and right within the reading order, up and down by a row, wrapping at the ends), skipping places
  that are not pickable, or `from` when none is pickable.
- `typeCode(entry, key, codes)`: `entry` is `''` or a row letter. A row letter (any case) that some code starts with
  returns `{ entry: letter, pick: null }`; a digit after a letter returns `{ entry: '', pick: code }` when the code
  exists and is pickable, else `{ entry: '', pick: null }`; `Escape` or any other key returns `{ entry: '', pick: null }`.
  A second letter replaces the first.

**Tests first** (write them, see them red, then the functions):

- every arrow from each corner of a 10-place grid; a sold out place and a sealed place passed over; a grid with one
  pickable place returns it from every key; Home and End;
- "c" then "2" picks C2; "C" then "9" picks nothing and clears; "C" then "D" leaves "D"; Escape clears; a digit with
  no letter picks nothing; a sold out code picks nothing.

## Task 2. The slot cell and the radiogroup

Model: sonnet

Files: `engine/ui/vending/Vending.tsx` (`Machine`, `nameOf`, a new `InfoIcon`), `engine/ui/vending/vending.css`,
`instances/divided-world/ui/vending/vending.css` (the cell's chamfer and neon), `engine/ui/vending/Vending.test.tsx`.

Build design, 5 and 9 to boards 01 and 03:

- Each place is one cell: the face (`SlotArt`), the code and price chip inside the cell's bottom border, the info
  control in its top right corner. Remove `kb-vending-shelf`. A sold out cell keeps its stripe and "Sold out" chip; a
  sealed cell keeps its dashed outline and its words (`role="img"`, outside the radios).
- The stocked slots are `role="radio"` in one `role="radiogroup"` named for the machine (`shopName`), with
  `aria-checked` for the pick, a roving `tabIndex` (0 on the picked slot or the first pickable one, -1 on the rest)
  and `onKeyDown` from Task 1's `nextSlot`, picking as focus moves. A sold out slot is a radio with
  `aria-disabled="true"`.
- `nameOf` drops "Buy": "Overreaction, 1.00 orb, common Move", with `priceNote` and a sold out slot's words as now.
- The info control is a `GlassButton` holding an inline SVG circled i (`InfoIcon`, `aria-hidden`), named "About
  <card>"; only the focused slot's control has `tabIndex` 0, so Tab goes from the group to it and then on. It is 44 by
  44 on the phone's layout.
- Typed codes: one `onKeyDown` on the machine's group (never on the document), through Task 1's `typeCode`. The partly
  typed entry shows in the price display as "C_" (Task 3 draws the display); a pick moves focus to the picked radio.

**Tests first:** the slots are radios in one radiogroup named for the shop; one of them is in the tab order; ArrowRight
from A1 checks A2 and focuses it; ArrowDown passes a sold out slot; typing "c" then "2" inside the machine checks C2,
and typing them with focus outside the machine checks nothing; no slot's name starts with "Buy"; the info control's
name is "About <card>" and it holds no text node "i"; on the phone's layout its box is at least 44 by 44; axe
(`engine/ui/a11y.ts`, `axeViolations`) finds nothing on the machine with a slot picked. Every existing test in
`Vending.test.tsx` that finds a slot by "Buy …" is moved to the radio's name, in this task.

## Task 3. The decision column, the bar, the short state and the bought state

Model: sonnet

Files: `engine/ui/vending/Vending.tsx` (`Vending`, `Machine`, `Kept`, `emptyFor`, `buy`, a new `Decision` component
used by both layouts), `engine/ui/vending/vending.css`, `instances/divided-world/ui/vending/vending.css` (remove
`.kb-vending-aura-in`, `.kb-vending-tray-label`, `.kb-vending-tray-to` and their printing),
`engine/ui/vending/Vending.test.tsx`.

Build design, 1, 2, 4 and 6 to boards 01 to 04:

- `Decision` holds, in order: the price display (`role="status"`, one accessible name, no duplicate hidden text, so
  `kb-vending-lcd`'s `aria-label` and its `kb-visually-hidden` twin become one), Buy, the outcome line (the polite
  status and the refusal alert, moved from the wallet panel and still on the page empty before they speak), the tray,
  and the hand counter.
- On a desk the column is sticky under the menu bar (`top` from the menu bar's stuck foot, the variable `shell.css`
  already reads), inside the machine beside the slots. On the phone's layout, and in the stacked container query under
  `calc(20em + 768px)`, `Decision` renders as a bar fixed to the window's foot, only while there is a pick or a bought
  state, with a × ("Clear the pick") and Esc that clear both. While the bar stands, the page's `scroll-padding-bottom`
  is the bar's measured height (a `ResizeObserver` on the bar, written to a custom property), so a focused slot is never
  under it.
- `Kept` gains `bought: { slot: Id; name: string; left: number } | null`. A successful single purchase sets it and
  clears `pickedId`; any pick clears it. While it is set the display reads "Bought · <name>" and "<left> left", Buy reads
  "Buy another" and buys that slot again, the wallet shows no drain and the counter no arrow. A pack sets it when its
  reveal closes.
- Short (`short`, as now): the price in Salty pink, "Need <price> · have <balance> solid" under it, Buy with
  `aria-disabled="true"` and `aria-describedby` that line, muted, still focusable; a press says the same words in the
  refusal alert and asks the server nothing, as `buy()` does now. The wallet's `shortWords` line goes.
- The coin slot and the tray at the machine's foot are removed; on a pack `InPack` keeps its place in the column.

**Tests first:** with nothing picked there is no bar on the phone's layout; a pick raises it, holding the code, name,
price, "5.62 → 4.62" and Buy; its × clears the pick and the bar; Esc does the same; a purchase clears the pick and shows
"Bought · Feelin' Fab" and "5.42 left" with Buy named "Buy another"; "Buy another" buys the same slot again; a pick ends
the bought state; short of solid Aura the price display says "Need 3.00 · have 1.62 solid", Buy has `aria-disabled`
and the line as its description, and pressing it calls no purchase and says the line in the alert; the outcome regions
are on the page and empty before a purchase; with the bar up the document's `scroll-padding-bottom` equals the bar's
height. The existing tests of the drain, the second buy and the held answers keep passing.

## Task 4. The card's exit

Model: sonnet

Files: `engine/ui/vending/Vending.tsx` (`Flying`, `onLanded`, the hand counter's ref in place of `handLinkEl`),
`engine/ui/glass/motion.ts` (only if a preset needs a new duration; it names no instance),
`engine/ui/vending/PackOpening.tsx` (its `handLink` now the counter), `engine/ui/vending/Vending.test.tsx`,
`engine/ui/vending/PackOpening.animations.test.tsx`.

Build design, 3:

- The flight's target is the hand counter in `Decision`, which is always in view, never the left column's link. The
  card drops into the tray (`landing(feel, feel.enter)`, as now), rests `TRAY_REST_MS = 1200` (exported from
  `Vending.tsx`), then flies by `toHand` to the counter; the counter pulses (`pulse`) as the card lands, and its count
  moves then, as now.
- Under reduced motion (no feel) the card is drawn in the tray at once, without a drop or flight, rests
  `TRAY_REST_MS`, and the count moves when the rest ends. Today it is in the hand at once with nothing drawn; that
  changes, and the test that asserts it is rewritten to this rule.
- A second purchase during a rest drops beside the first, and each lands on its own (the existing second-buy tests
  keep their meaning). The fallback timer (`deliveryMs(feel) + 400`) gains `TRAY_REST_MS`.

**Tests first:** under full motion the flight aims at the counter's measured rect (the existing aim test, retargeted);
under reduced motion the card is in the tray at once, the count is unchanged until `TRAY_REST_MS` has passed (fake
timers), then moves; a card whose landing is never reported still lands after the fallback; the pack reveal's exit
aims at the counter.

## Task 5. The info dialog's foot

Model: sonnet

Files: `engine/ui/vending/Vending.tsx` (the `Overlay` for `aboutItem`), `engine/ui/vending/vending.css`,
`engine/ui/vending/Vending.test.tsx`.

Build design, 7 to board 05: a `FormFoot` (`engine/ui/glass/FormFoot.tsx`) in the dialog, sticky at its foot as the
glass's dialog feet are. Its line is "<price> from <balance> solid → <after>", or the short line of Task 3. Its buttons
are Close and Buy, visibly "Buy" with the card's name and price under it and named "Buy <name>, <price> orbs". Buy
closes the dialog, picks the slot and runs `buy()` (the drop, or the pack's reveal); focus then goes where Task 3's
purchase puts it (the bar or column, or the reveal). A sold out slot's foot has its reason (`soldSaid`) and Close only.
A sold out pack's dialog says its reason in place of the bare price (the card branch's rule, applied to the pack
branch).

**Tests first:** the dialog's foot has Close and "Buy Overreaction, 1.00 orb"; pressing Buy closes the dialog, spends
1.00, and shows the bought state; short, Buy is `aria-disabled` and its press asks the server nothing; a sold out
card's and a sold out pack's dialogs say why and have no Buy.

## Task 6. The left column and the phone's head

Model: sonnet

Files: `engine/ui/vending/Vending.tsx` (the `aside`), `engine/ui/vending/vending.css`,
`engine/ui/glass/parts.test.tsx` (the "Your hand" entry), `engine/ui/vending/Vending.test.tsx`.

Build design, 10 to boards 01 and 03: the wallet panel holds the orbs, "<balance> of <cap> solid" with the drain after a
pick, "Only solid Aura spends. Your live estimate settles into it each day." and the privacy line; the "Your hand" game
piece becomes a plain `GlassLink`, "See your hand, on the board", to the same `handLink`. On the phone's layout the
title is one line at the display's medium size and the wallet one row (the orbs at the phone's orb size, the figures,
and an info control that opens the two lines in a `Float` popover or the glass's sheet, whichever the phone's other info
controls use), so at 390 by 844 the first row of slots is on the first screen.

**Tests first:** the wallet says "5.62 of 6.00 solid" and the plain line, and no element says "ghost estimate"; the
link is named for the board and is not a skewed game piece; on the phone's layout the first radio's top is above 844
(a layout test, as the existing "does not reach past the column" test measures).

## Task 7. The machine's drawing

Model: sonnet

Files: `instances/divided-world/ui/vending/vending.css`, `engine/ui/vending/vending.css` (only where it places a part
the drawing removes).

Build design, 8 to boards 01 and 03: the body, the marquee and the cells take the glass's chamfered corners (the
`clip-path` cuts the glass's panels use, `kb-glass-cut-panel`); no `border-radius` remains in the drawing. The pink
outline, the cyan inner line and the marquee's gold edge follow the cuts (as `e2e/chamfer-borders.spec.ts` checks the
glass's other chamfered borders). The sheen stays; the coin slot and tray printing are gone (Task 3).

**Tests first:** add the machine's body, marquee and a cell to `e2e/chamfer-borders.spec.ts`'s list, and see them red
before the change.

## Task 8. The pack reveal

Model: sonnet

Files: `engine/ui/vending/PackOpening.tsx`, `engine/ui/vending/opening.css`, `PackOpening.test.tsx`.

Build design, 11. Find the gold bar's cause first (it stands to the right of the small cards at 1440 by 900 after all
five are turned; the critique's screenshot is described in the design, 0) and remove it at its cause. Fit the reveal to
a 1440 by 900 window: its title and "N of 5 turned" in view, the cards scaled to the room left. Keep one close control:
Done when all are turned, and Esc, with "Esc Back to the machine" removed where it does the same thing as Done (keep
its words on the menu bar's key cap only if the glass's other dialogs do).

**Tests first:** at 1440 by 900 the reveal's title box is inside the window after all five are turned (a layout test in
`PackOpening.test.tsx` or an e2e check beside the booster boards); there is one button that closes the reveal.

## Task 9. The boards, the stories and the end-to-end checks

Model: sonnet

Files: `e2e/boards.spec.ts` (`BOARD_FOLDERS`, `COLORS_ONLY`); `e2e/boards/2026-11-22-vending-flow/01-desk-picked.ts`,
`02-desk-bought.ts`, `03-phone-picked.ts`, `04-phone-short.ts`, `05-phone-info.ts` (new); `e2e/boards/07-vending.ts`,
`e2e/boards/2026-11-07-booster-packs/01-machine.ts`, `e2e/boards/2026-11-05-backfill/34-vending-info.ts`;
`e2e/glass-screens.ts`; `e2e/focus.spec.ts`; `engine/ui/vending/Vending.board.stories.tsx`,
`engine/ui/vending/Packs.board.stories.tsx`; `web/src/data/fixtures/boards.ts` (a moment for each new board that needs
a state the fixture lacks: a bought card, a short wallet).

- Add `docs/research/2026-11-22-vending-flow` to `BOARD_FOLDERS` with a manifest for each of its five boards (the
  booster packs' manifests are the pattern: landmarks by role and name, presses for a picked or bought state, departures
  named where they are set).
- Board 07's machine and the booster packs' board 01's machine are drawn over by the new boards. Their manifests keep
  what the new boards do not draw (board 01's odds and the Boss's moves; board 07's menu and head where they still
  match) and drop the machine's landmarks, each departure named in the manifest's header as the existing ones are; a
  manifest left with nothing to compare is deleted and its board listed in `COLORS_ONLY` as "superseded by
  2026-11-22-vending-flow, a record".
- `glass-screens.ts`'s Vending Machine entry names `2026-11-22-vending-flow/01-desk-picked`.
- `focus.spec.ts`: the Buy focus-ring test and the phone hand test find slots by their radio names.
- The stories draw each new board's state.

**Tests first:** the new manifests fail against the build before Tasks 2 to 7 are merged into this branch (run them
once on `main` and keep the red output for the PR), then pass.

## Task 10. The build

Model: inline

`npm run typecheck`, `npm run build:ci`, `npm run test:ui`, and the e2e shards for `boards.spec.ts`, `focus.spec.ts`,
`a11y.spec.ts` and `chamfer-borders.spec.ts`. The output of each is shown in the PR, with screenshots of the five
boards' states at their sizes (deviceScaleFactor 2) beside each board, and the phone bar at 200% text (design, Open).
Run `/impeccable critique` on `engine/ui/vending/Vending.tsx` and put its score beside the first run's 25/40 in the PR.

## Review focus

- **No stuck state.** Every new state (the bar, the bought state, a partly typed code, the short state, the tray's
  rest) ends by a press on the screen where it shows or by itself; walk each with keyboard only and with a screen
  reader's names.
- **A purchase still happens once.** The bar's Buy, the column's Buy, "Buy another" and the dialog's Buy all go through
  the one `buy()` and its `pressed` guard; two presses in one tick, across two of these buttons, buy once.
- **Held answers across accounts.** The new `bought` field is kept per account as `Kept`'s other fields are, and an
  answer held for one account never shows as another's bought state.
- **The typed codes never leave the machine.** No document-level key listener, and a screen reader's quick keys on the
  rest of the page are untouched.
- **The bar never covers what has focus**, at 100% and 200% text, on a 320 by 568 window too.
- **The engine names no instance.** The new words ("Bought", "Buy another", "Need … have … solid", "See your hand, on
  the board") are the engine's plain words; the drawing's changes are only in the instance's sheet.
