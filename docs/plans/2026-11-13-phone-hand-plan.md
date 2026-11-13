# The phone's hand, and a calmer opening for the arc: plan

Record, written 2026-11-13. Carries out `docs/plans/2026-11-13-phone-hand-design.md` (#521, and the owner's report of
the arc's opening). One build session builds it in one PR from `main`. Where a number here differs from the design,
the design wins.

Every task goes test first: write the failing test, show its red run, then write the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node tools/test-e2e.mjs <spec> --trace off`). Run
`npm run build` once after the last task. Every task is engine. No instance file changes, and nothing here touches a
database.

"The phone" below is `useBoard().board !== 'main'` in a component and `:root[data-kb-layout='phone']` in CSS, as today.

## Task 1. The arc opens calmly on the Main board

Model: sonnet.

Files: `engine/ui/frame/frame.css` (the lift rule, about line 1206, and the hover pad's rule after it, with their
comments), `engine/ui/frame/Hud.tsx` (the drawer's layout effect that runs `fanDeal`, the focus-on-open effect, the
header comment), `engine/ui/frame/hand-modal.test.tsx`, `e2e/hand-arc.spec.ts`, `e2e/hand-hover.spec.ts`.

- The lift's selectors on the Main board become `.kb-hand-card:has(> button:focus-visible)`,
  `.kb-hand-card:hover` and `.kb-hand-card[data-armed]`, and the first two (and the hover pad's `::after`) apply only
  while the drawer carries neither `data-kb-dealing` nor `data-kb-hover-waits` (focus only needs the first). The armed
  card's lift is never held back.
- `Hud.tsx`: while a deal or a gather runs, the drawer carries `data-kb-dealing`, removed when the last card's play ends
  or the run is stopped. On every open, the drawer carries `data-kb-hover-waits`, removed by the first `pointermove`
  on the window whose point is more than 4px from the point of the press that opened the hand (the hand button's
  `pointerdown` client point, kept in a ref). When the hand was opened with no press (a key), the first `pointermove`
  removes it. The listener is removed on close and on unmount.
- The header comment of `Hud.tsx` and the lift's comment in `frame.css` say why: a focus given by script after a mouse
  press, and a card landing under a still pointer, must not lift, and the deal's end must not be followed by a second
  movement.
- Tests, red first:
  - `hand-modal.test.tsx`: after the hand is opened, the drawer carries `data-kb-hover-waits`. A `pointermove` 2px from
    the opening press leaves it, and one 20px away removes it. Under a feel, `data-kb-dealing` is present until the
    plays end (the test's fake play calls its end) and absent after. Under Off it is never set.
  - `e2e/hand-arc.spec.ts`, motion full, 01-main: the hand opened with a mouse press on the hand button, without moving
    the pointer, then 2s waited. No card but the armed one has a lifted transform (`getComputedStyle(li).transform` is
    not the lift's matrix), and the card under the pointer is not lifted. After `page.mouse.move` 30px, the card under
    the pointer lifts. A second test: the hand opened with the keyboard (focus the hand button, press Enter). The first
    card is lifted once the deal ends.
  - `e2e/hand-arc.spec.ts`: sampling each card's top every animation frame from the press to 2.5s after it (as the
    session's probe did), no card's top falls (moves up the screen) by more than 2px once it has risen to its resting
    top. This is the "played twice" check.
  - `e2e/hand-hover.spec.ts` keeps passing. Its comment "Opening focuses the first card, which lifts it by its focus"
    is corrected: the mouse-opened first card no longer lifts.
- Poison: restore `:focus-within` in the lift's selector and show the mouse-opened check red. Drop
  `data-kb-hover-waits` from the hover selector and show the still-pointer check red.

## Task 2. The swipe arc's pose

Model: haiku.

Files: `engine/ui/cards/arc.ts` (its header comment and new exports), `engine/ui/cards/arc.test.tsx`.

- Export the constants `SWIPE_STEP = 66`, `SWIPE_TURN = 6` (degrees per step), `SWIPE_TURN_MAX = 18`, `SWIPE_DROP = 5`
  (px per step squared), `SWIPE_DROP_MAX = 40`, `SWIPE_LIFT = 14` (px), `SWIPE_SCALE = 0.18`.
- `swipePose(d: number): { readonly y: number; readonly deg: number; readonly scale: number }`, where `d` is the card's
  signed distance from the row's middle in steps (its center's x less the middle's x, over `SWIPE_STEP`). With
  `w = max(0, 1 − |d|)`:
  `deg = clamp(SWIPE_TURN × d, −SWIPE_TURN_MAX, SWIPE_TURN_MAX)`,
  `y = min(SWIPE_DROP × d², SWIPE_DROP_MAX) × (1 − w) − SWIPE_LIFT × w`,
  `scale = 1 + SWIPE_SCALE × w`.
- `swipeMiddle(centers: readonly number[], middle: number): number`: the index of the center nearest `middle`, the
  lower index on a tie, −1 for none.
- The header comment adds a paragraph: the phone's row is the arc's order (`handOrder`) on one swiped row, read by the
  card in the middle, and cites the design's section 3.
- Tests, red first: `swipePose(0)` is `{ y: −14, deg: 0, scale: 1.18 }`. `swipePose(1)` is `{ y: 5, deg: 6, scale: 1 }`.
  `swipePose(−2)` is `{ y: 20, deg: −12, scale: 1 }`. `swipePose(5)` is `{ y: 40, deg: 18, scale: 1 }`. `swipePose(0.5)`
  is `{ y: 0.625 − 7, deg: 3, scale: 1.09 }` (to 1e-9). `swipeMiddle([10, 76, 142], 80)` is 1, `([10, 76], 43)` is 0,
  and `([], 0)` is −1.
- Poison: make `swipePose` drop the clamp on `deg` and show the `swipePose(5)` test red.

## Task 3. The phone's row in `Hand`

Model: sonnet.

Files: `engine/ui/cards/Hand.tsx` (`Hand`, its header comment; `drawn` and `COPIES_SHOWN` are removed),
`engine/ui/cards/Hand.test.tsx`, `engine/ui/frame/frame.css` (the Phone board's sheet rules, from
`/* ---- the Phone board's sheet ---- */`).

- Both layouts draw `handOrder`: one `li.kb-hand-card` per kind, with the ×N badge and ", N in hand" in the name where
  more than one is held. On the phone each `li` also carries `data-kb-group-start` where its group differs from the
  card before it, and `data-kb-middle` on the middle card. The phone's `Postcard` stays `size="phone"`.
- The phone's row (`ul.kb-hand-cards`): one line, `overflow-x: auto`, `overflow-y: hidden`, `scroll-snap-type: x
  mandatory`, no visible scrollbar, inline padding `calc(50% − 52px)` so the first and last card can stand in the
  middle, and top padding that holds the lifted card (14px plus the 18% growth, rounded up). Each `li` after the
  first has `margin-left: −38px` (104 − 66), and `−5px` where it carries `data-kb-group-start` (half a step more),
  with `scroll-snap-align: center`. The pose is written as `--kb-swipe-y`, `--kb-swipe-turn` and `--kb-swipe-scale`
  on each `li` and drawn with the individual properties `translate: 0 var(--kb-swipe-y)`, `rotate:
  var(--kb-swipe-turn)` and `scale: var(--kb-swipe-scale)`, so the deal, which writes `transform`, composes with them.
  The middle card's z-index is above every other card's, and the rest stand lower the further they are from it.
- The pose: on the row's `scroll` event, at most once per animation frame, and once on mount and on resize, `Hand`
  measures the cards' centers (from `offsetLeft` and `offsetWidth`, never from a transformed box), finds the middle
  with `swipeMiddle`, and writes `swipePose` for the cards within the row's visible width and two steps beyond it on
  each side. A card outside that range keeps the edge pose (`swipePose(±5)`), written once when it leaves it.
- Bringing a card to the middle (`center(key, instant)`): `ul.scrollTo({ left, behavior })`, with `behavior` `'instant'`
  under Off (the HUD passes the feel in, see the props below) or when asked, and `'smooth'` otherwise.
- Pressing a card, on the phone: a click with `detail === 0` (keyboard or a reader) does what pressing does today
  (`setViewed`, `onPick`). A pointer click on the middle card does the same. A pointer click on any other card calls
  `center(key)` and nothing else. A card's button that takes focus calls `center(key)` and is focused with
  `preventScroll: true` where `Hand` moves focus itself.
- The phone's keys on the row: Left and Right focus the neighbor, Home and End the ends, and none wraps (as on the Main
  board). Tab and Shift+Tab are not taken on the phone: the dialog's own trap (Task 4) wraps them through the cards,
  the × and the Vending Machine button.
- The line (`.kb-hand-says`) on the phone speaks of the middle card: the armed sentence if it is the armed card, else
  its name and `summary`. It reserves three lines (`min-height: 4.5em` at its 1.5 line height). The sheet's `height:
  364px` becomes `height: auto` with `max-height` the window's height less the HUD's (`--kb-hud-measured`) less 48px,
  and keeps `overflow: auto` for large text.
- New props on `Hand`: `instant?: boolean` (true under Off), and `opening?: string | null`, the key to stand in the
  middle when the sheet opens (the HUD passes the armed key, else none, which means the first card). `Hand` puts that
  card in the middle instantly in a layout effect when it mounts open.
- Tests, red first, in `Hand.test.tsx` with `useBoard` mocked to the phone:
  - A hand of Whoops! ×5 and Stick Around draws two cards, Whoops!'s name ending ", 5 in hand", and a ×5 badge.
  - A Gimmick listed first in the faces stands after a Move.
  - A click with `detail: 0` on a card that is not the middle calls `onPick`. A pointer click (`detail: 1`) on a card
    that is not the middle does not call `onPick` and calls `scrollTo` on the row. A pointer click on the middle card
    calls `onPick`.
  - The line names the middle card. With the middle card armed, it says the armed sentence.
  - `drawn`'s tests are removed with it.
- Poison: make every pointer click call `onPick` and show the side-card test red.

## Task 4. The modal, the deal and the opening on the phone

Model: sonnet.

Files: `engine/ui/frame/Hud.tsx` (`modal`, the drawer's `role`, the focus-on-open effect, the drawer's layout effect,
`pick`, the header comment), `engine/ui/frame/frame.css` (the fade rules after "The hand is a modal on the Main board",
and `.kb-hand-backdrop`), `engine/ui/frame/hand-modal.test.tsx`.

- `modal` is `handOpen` on both layouts, so the backdrop, the HUD's `data-kb-hand-open`, the inert parts and the
  drawer's `role="dialog"` and `aria-modal` hold on the phone. The fade rules lose their `:not([data-kb-layout='phone'])`.
  Check on the phone that the plate (with Posting as), the aura, Alerts and Menu are the four parts faded, and the hand
  button is not.
- The backdrop on the phone covers the page above the sheet. A press on it, or on the HUD's faded parts, closes the hand
  through `dismiss`, as on the Main board.
- The deal: the drawer's layout effect runs the `fanDeal` branch on both layouts. On the phone, the sheet also plays its
  `overlay` entrance and exit as today, and the cards deal within it. Only the cards within the row's visible width are
  dealt, and the rest are left at rest, so a long row deals as fast as a short one. `fanDeal`'s `turn` on the phone is
  0, since the pose's rotation lives in `rotate`. Task 1's `data-kb-dealing` holds on both layouts.
- Opening: `Hand` gets `opening={armed}` and `instant={!feel}`. The focus-on-open effect focuses the armed card's
  button, else the first card's, on both layouts, with `preventScroll: true`.
- `pick`: arming closes the hand on both layouts, and putting the armed card back leaves it open on both
  (`if (!putBack) { setHandOpen(false); handButton.current?.focus(); }`). The phone's armed hand button and its words
  are unchanged, and the phone draws no peek (`peeked` stays wide-only).
- Tests, red first, in `hand-modal.test.tsx`'s "the hand on the Phone board": "stays a region" becomes "is a modal":
  the sheet is a dialog with `aria-modal`, the HUD carries `data-kb-hand-open`, the plate, the aura, Alerts and Menu
  are inert, the hand button is not, and the backdrop is there. A pointer press on the backdrop closes the hand and
  focuses the hand button. Esc closes it. Opening with Whoops! armed focuses Whoops!'s card. Pressing the armed card
  (a click with `detail: 0`) puts it back and leaves the dialog open. Pressing another card arms it, closes the
  dialog, and the hand button says "Armed · …". The existing "Playing" test is updated to find the dialog.
- Poison: leave `modal` as `wide && handOpen` and show the inert test red.

## Task 5. The board match, the stories and the browser checks

Model: sonnet.

Files: `e2e/boards/02-phone.ts`, `e2e/focus.spec.ts` (the "keeps every card in reach" tests, about line 464),
`e2e/phone-hand.spec.ts` (new), `engine/ui/frame/HandArc.stories.tsx`, and any of `e2e/a11y.spec.ts`,
`e2e/keyboard.spec.ts`, `e2e/glass-text.ts`, `e2e/glass-layout.test.ts` that names the phone's region or its grid.

- `02-phone.ts`, as the design's section 6 says: `hand` becomes `role: 'dialog'`. `card-whoops` is dropped.
  `card-stick` takes `box: 'none'`. Whoops!'s card, if kept, takes the build name ending ", 2 in hand" and `box:
  'none'`. The press and the hand button's names stay. The header comment names this design as the departure.
- `focus.spec.ts`: the 320 and 390 test becomes "every card can be brought into the window". Open the hand, press End,
  and the last card's box is inside the window. Press Home, and the first card's box is. The middle card is never cut
  by the window's edge.
- `e2e/phone-hand.spec.ts`, at 390 by 844 on the 02-phone moment, with the fixture's hand widened in the test (as
  `focus.spec.ts` widens it, by cloning cards, or through a story):
  - The hand opens as a dialog. Tab wraps through the cards, the × and the Vending Machine button only. Esc closes it,
    and focus is on the hand button.
  - A tap above the sheet closes it, and the URL is unchanged.
  - A tap on a side card brings it to the middle (it then carries `data-kb-middle`) and arms nothing. A tap on the
    middle card arms it and closes the hand.
  - Right Arrow moves focus to the next card, which becomes the middle.
  - Under reduced motion, opening with a card armed shows that card in the middle at once (the row's `scrollLeft` is
    final on the first frame).
- `HandArc.stories.tsx` gains phone stories at 390 by 844, the hand open: three kinds, every kind the instance has (one
  to three copies each), and every kind with one armed. Each opens the hand in its `play` function.
- Poison: make a pointer tap on a side card arm it and show the side-card check red.

## Task 6. Records

Model: inline.

Files: the PR description, and `docs/plans/2026-11-13-phone-hand-design.md` only if the build found a gap.

- The PR says `Closes #521`, links the phone stories for the owner's review, and says the Main board's opening fix is
  in it.
- Run `npm run build` and show it green.

## Review focus

- The hover wait (Task 1): Chrome and Safari may update `:hover` when content moves under a still pointer without
  firing `pointermove`, or may fire a synthetic one. The 4px distance from the opening press must keep a still pointer
  waiting in both, and a real move must always end the wait. Check a touch press on a wide touch screen, where no
  pointer rests.
- The second movement (Task 1): no card, the armed one included, should rise again after its deal ends, under Smooth
  and Snappy, and on a reopen during the gather.
- The pose on a busy instance (Task 3): scrolling a 100-kind row must write poses for the visible cards only, and a fast
  fling must leave no card with a stale pose once the row comes to rest.
- The swipe and the snap on a real phone: a horizontal swipe inside the sheet must not scroll the page, and a vertical
  drag in the sheet at large text must scroll the sheet, not the row.
- Focus and the middle (Tasks 3 and 4): an activation by a reader while a smooth scroll is still easing must act on
  the focused card, and a focus moved by a reader's swipe must bring that card to the middle.
- The deal composing with the pose (Task 4): the deal writes `transform` and the pose writes `translate`, `rotate` and
  `scale`. A stopped deal must leave no inline `transform` behind on any card.
- The modal on the phone: closing by every path leaves focus on the hand button, and inert never stays on the HUD's
  parts after the hand closes, including when the close's animation is interrupted by an open.
- The private-fact rule: nothing here reads anything but the player's own hand.
