# The hand's arc: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-hand-arc-design.md`. One build session builds it in one
PR from `main`. Where a number here differs from the design, the design wins.

Every task goes test first: write the failing test, show its red run, then write the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node tools/test-e2e.mjs <spec> --trace off`). Run
`npm run build` once after the last task. Every task is engine. No instance file changes, and nothing here touches
a database.

Coordinates: every x and y below is in the board's px, from the same origin today's `fanSlot` uses (the card's left at
`256px + x` inside the drawer's fifth column, its top at `8.875rem + y`). The board's three slots are
`{ x: -60, y: -260, deg: -11 }`, `{ x: 10, y: -260, deg: -1 }` and `{ x: 72, y: -250, deg: 10 }`. A card is 150 by 225.

## Task 1. The arc's order and slots

Model: sonnet.

Files: `engine/ui/cards/arc.ts` (new), `engine/ui/cards/arc.test.tsx` (new).

- `handOrder(held: readonly HeldCard[], faces: readonly CardFace[]): readonly ArcCard[]`, where `ArcCard` is
  `{ face, held, group }`. One entry per kind held (held > 0). Groups in order: `cast`, `set`, `use`, then every other
  play and every `unknown` face as one last group. Within a group, the order of `faces`. `group` is the group's index
  among the groups present (0 for the first non-empty group).
- `arcSlots(groups: readonly number[]): readonly ArcSlot[]`, where `groups` is the group index of each card in order and
  `ArcSlot` is `{ x, y, deg, row }`. The constants are named and exported: `ARC_SPAN = 1150` (the arc's width, card
  included), `ARC_STEP = 66`, `ARC_FLOOR = 40`, `ROW_RISE = 120`, `MAX_ROWS = 4`, `GROUP_GAP = 0.5` (in steps),
  `ARC_BOW = 40`, `TURN_FROM = -14`, `TURN_TO = 10`.
  - n = 1: the board's middle slot. n = 2: its first and last. n = 3: all three. (`row` 0.)
  - n ≥ 4: per row, the units are `(cards − 1) + GROUP_GAP × (group changes in the row)`, the step is
    `min(ARC_STEP, (ARC_SPAN − 150) / units)`, the last card stands at x = 72, and each card before it stands one step
    to the left, plus `GROUP_GAP` of a step where the group changes. With t the card's place along its row from 0 to 1:
    `deg = TURN_FROM + (TURN_TO − TURN_FROM) × t`, `y = −260 + 10t − ARC_BOW × sin(πt) − ROW_RISE × row`.
  - Rows: if one row's step would fall under `ARC_FLOOR`, the hand takes the fewest rows (at most `MAX_ROWS`) whose
    step is at least the floor, and splits the cards in order as evenly as it can, the front row (row 0) taking the
    first and any extra. At `MAX_ROWS` the step may fall under the floor.
- Tests, red first:
  - The board's slots for 1, 2 and 3 kinds, exactly.
  - 4 kinds in one group: x = −126, −60, 6, 72; the first deg is −14 and the last is 10.
  - 22 kinds (Divided World's pool in its three groups) are one row whose leftmost card's x is ≥ 72 + 150 − 1150, with a
    step ≥ 40 and a half step more at each group change.
  - 60 kinds take more than one row and no row's step is under 40. 200 kinds take 4 rows.
  - `handOrder`: a Gimmick listed first in `faces` stands after a Move and a Reversal. A `keep` card and an `unknown`
    face stand last. A kind held 3 times is one entry with `held: 3`. A kind held 0 times is absent.
- Poison: make `handOrder` keep the order of `faces` and show the grouping test red. Remove the row split and show the
  60-kind test red.

## Task 2. The hand draws the arc on the Main board

Model: sonnet.

Files: `engine/ui/cards/Hand.tsx` (`Hand`, its header comment; `fanSlot` is replaced on the Main board by `arcSlots`, and
`drawn` stays for the Phone board's sheet), `engine/ui/cards/Hand.test.tsx`, `engine/ui/frame/frame.css` (the hand's
Main board rules and their comment).

- On `board === 'main'`, `Hand` draws `handOrder` with `arcSlots`: one `li.kb-hand-card` per kind, with `data-kb-row`, and
  `--kb-fan-x`, `--kb-fan-y`, `--kb-fan-turn` and `--kb-fan-z` as today. The z order is: rows further back lower, and
  within a row left to right (a card overlaps the one to its left). A kind held more than once shows `×N` (`.kb-hand-times`)
  and its name ends ", N in hand", as a kind held more than twice does today. The Phone board's sheet is unchanged.
- The list on the Main board spans the drawer's whole grid (`grid-column: 1 / -1`), and the card's `left` keeps the
  card inside the window as today's `min(...)` does, measured from the fifth column's place. The rule for a text size
  other than the board's (the fan 7rem less 5px higher) holds for every row.
- The lift: `.kb-hand-card:hover`, `:focus-within` and `[data-armed]` stand upright, 110px higher, at scale 1.25, with
  a z-index above every card (`--kb-fan-z` + 100). Under Off (`:root[data-kb-motion='reduce']`, and
  `prefers-reduced-motion` unless `data-kb-motion='full'`, as `base.css`'s `.kb-sheet` does) the lift has no transition.
  With motion, it eases over the feel's `enter` with its `ease`. No CSS token carries those today, so the HUD sets
  `--kb-hand-lift-ms` and `--kb-hand-lift-ease` on the drawer from `useFeel` (`engine/ui/glass/motion-tokens.ts`), and the
  rule falls back to 0ms where they are absent. The old
  `[data-armed]` rule (48px higher) goes.
- The keyboard, Main board only: Left and Right move focus to the card before or after (stopping at the ends), and Home
  and End go to the first and last. Tab and Shift+Tab move among the cards and wrap at the ends (a focus trap on the
  list's buttons). Each card's button is in the tab order as today.
- Tests, red first, in `Hand.test.tsx`, on the Main board's layout as the test world sets a board
  (`engine/ui/test-world.tsx`; read how `useBoard` resolves there first, and add a world option if it has none):
  - 5 kinds, one held 3 times: 5 buttons. The one held 3 times is named "..., 3 in hand" and shows "×3".
  - The buttons stand in `handOrder`'s order (by their `data-kb-card`).
  - ArrowRight from the first card focuses the second. End focuses the last. Tab from the last focuses the first. Shift+Tab
    from the first focuses the last.
  - On the Phone board, a kind held 2 times is still two faces (today's test stays).
- Poison: remove the Tab wrap and show its test red.

## Task 3. The modal, the fade, the outside press and the peek

Model: sonnet.

Files: `engine/ui/frame/Hud.tsx` (the drawer's element and attributes, `pick`, the open-focus effect, a new peek, the
header comment's hand paragraph), `engine/ui/frame/frame.css` (the fade, the backdrop, the peek),
`engine/ui/frame/hand-modal.test.tsx` (new).

- On the wide layout, the drawer is `role="dialog"`, `aria-modal="true"`, `aria-label="Your hand"`. On the phone it stays
  `role="region"`. While open on the wide layout, the HUD root carries `data-kb-hand-open`, and the plate, the aura,
  Menu and Alerts are `inert`. CSS fades them to `opacity: 0.4`, over the feel's `exit` with motion and at once under
  Off. The hand button stays live.
- The backdrop: while open on the wide layout, a `div.kb-hand-backdrop` (fixed, the whole viewport, under the cards and
  above the board, transparent, `aria-hidden`) catches the press. A `pointerdown` on it prevents its default and closes
  the hand. The `click` that follows is stopped there, so nothing under it acts. Focus returns to the hand button.
- Opening focuses the armed card's button when one is armed, else the first card's (it focused the drawer before).
  Esc, as today, closes and returns focus to the hand button.
- `pick` on the wide layout: arming a card closes the hand and focuses the hand button, as the phone does today.
  Pressing the armed card puts it back and leaves the hand open.
- The peek: on the wide layout, while a card is armed and the hand is closed, the HUD draws the armed card's `Postcard`
  (size `fan`) with its "Armed · pick a post" tag in `div.kb-hand-peek`, `aria-hidden`, `pointer-events: none`,
  upright, its top 90px above the HUD's seam over the hand button. It is gone when nothing is armed or the hand is open.
- Tests, red first, in `hand-modal.test.tsx` on the Frame with a seeded hand (the `playerWorld` style of the Frame's
  stories, through the fake), at a wide viewport:
  - Opening: a dialog named "Your hand" with `aria-modal`. The plate and Menu are inert. The first card has focus.
  - A press on the backdrop closes the hand, the hand button has focus, and a click handler on an element under the
    backdrop is not called.
  - Pressing a card closes the hand and arms it. The peek is in the document, `aria-hidden`. Opening again focuses the
    armed card. Pressing it disarms it, and the hand stays open.
  - On the phone layout, the drawer is still a region and nothing is inert.
- Poison: drop the click stop on the backdrop and show the "not called" test red.

## Task 4. The deal and the gather

Model: sonnet.

Files: `engine/ui/glass/motion.ts` (a new preset `fanDeal`, beside `deal`), `engine/ui/glass/motion.test.tsx`,
`engine/ui/frame/Hud.tsx` (the drawer's play on the wide layout), `e2e/hand-exit.spec.ts`.

- `fanDeal(feel, index, delays, from: { x, y })`: the card's entrance from `from` (the offset from its slot to the hand
  button's center, measured when the open starts) at rotate 0 and scale 0.6 to its slot (x 0, y 0, its own turn,
  scale 1), landing over `enter` after `delays[index]`, and an exit back to `from` at scale 0.6 and opacity 0, eased
  over `exit`, after `delays[count − 1 − index]` (the reverse order). Empty under Off. `delays` is `stagger(feel, count)`,
  which already holds the last beat within `screen`.
- On the wide layout the drawer does not play `overlay`. Each card's `li` plays `fanDeal` with `playIn` on opening and
  `playOut` on closing. The drawer stays shown and inert until the last card's exit ends, as it does today with the
  overlay. The phone keeps `overlay`.
- Tests, red first:
  - `motion.test.tsx`: `fanDeal(null, ...)` is `{}`. Under Smooth, the entrance starts at `from` and ends at x 0, y 0. The
    exit of index 0 starts last (its delay is the largest). 60 cards' last delay is within `screen`.
  - `e2e/hand-exit.spec.ts`, rewritten for the wide layout under Smooth: sampled during the open, a card's center moves
    from near the hand button's center to its slot. Sampled during the close, it moves back toward the button. The
    drawer is hidden after the last exit. Under `reducedMotion: 'reduce'` the cards are in their slots on the first frame
    after the press.
- Poison: give the exit the entrance's delays and show the "exit of index 0 starts last" test red.

## Task 5. The board match, the stories and the browser checks

Model: sonnet.

Files: `e2e/boards/01-main.ts`, `e2e/focus.spec.ts`, `e2e/a11y.spec.ts` (only where a check names the old fan or the
region role on the wide layout), `engine/ui/frame/HandArc.stories.tsx` (new), `e2e/hand-arc.spec.ts` (new).

- `01-main.ts`, as the design's section 5 says: `press` becomes the hand button, Whoops! and the hand button again.
  `card-whoops` is dropped. `card-whoops-armed` and `armed-tag` take `box: 'none'`. The Whoops! name gains ", 2 in hand",
  and the hand button's build name is whatever the HUD then says. The header comment names the design as the
  departure.
- `HandArc.stories.tsx`, for the owner's review at 1440 by 900, the hand open: three kinds, every kind the instance has
  (one to three copies each, as the session's mockup), and every kind with one armed. Each story opens the hand in a
  `play` function.
- `e2e/hand-arc.spec.ts` on the 01-main moment at 1440 by 900:
  - The hand opens as a dialog. Tab cycles through its cards only. Esc closes it and focuses the hand button.
  - A press on the board outside the cards closes the hand and does not follow a link under it (the URL is unchanged).
  - Hovering a card makes it the topmost element at its own center (`elementFromPoint`).
  - Armed and closed, the peek takes no press: `elementFromPoint` at the peek's center is not inside the peek.
  - Under reduced motion, a hovered card's transform is its lifted one at once, with no transition.
- Poison: make the peek take pointer events and show its check red.

## Task 6. Records

Model: inline.

Files: `docs/plans/2026-11-12-hand-arc-design.md` only if the build found a gap, and the PR description.

- The PR lists the design's section 6 question under `Design questions`, and links the stories for the owner's review.
- Run `npm run build` and show it green.

## Review focus

- The arc at sizes other than the board's: at a large text size, and in a window just above the switch to the Phone
  board (the board scaled down), the back rows must stay inside the window, and no card may hide under the HUD.
- The outside press: a press that starts on a card and ends on the backdrop, a drag, a right click, a middle click and a
  touch on a wide touch screen must each either close the hand or do nothing, and never act on the page under it.
- Arming closes the arc: the play flow (`engine/ui/cards/play.tsx`) and the post's + marks must still work from the
  closed hand. A card armed by any other path (a story, a test, the phone) must show the peek on the wide layout.
- Focus: closing by every path (Esc, the backdrop, the hand button, arming) leaves focus on the hand button, and inert
  never stays on the HUD's parts after the hand closes, including when the close's animation is interrupted by an open.
- Toasts and the Alerts bell, which already wait while the hand is open, must still come back when it closes.
- The private-fact rule: nothing here reads anything but the player's own hand.
