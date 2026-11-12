# The hand's arc: design

Record, written 2026-11-12. A design session with the owner, begun from the owner's words: "Can we design a more
intuitive/convenient way to look through the Hand on desktop? Becomes very unwieldy with a wide variety of cards. Need
to click each to find one. The look is nice, though." The plan is `docs/plans/2026-11-12-hand-arc-plan.md`. The
mockups the session showed are in `docs/research/2026-11-12-hand-arc/`. They are rough restylings of the real page
and are not boards to match.

This changes the hand on the Main board's layout (`engine/ui/cards/Hand.tsx`, `engine/ui/frame/Hud.tsx`, the hand's rules in
`engine/ui/frame/frame.css`). The Phone board's sheet is unchanged.

## 1. Why the fan does not scale

The Main board drew three postcards fanned through the HUD's seam at -11, -1 and 10 degrees, and the build kept that
shape for any count: `fanSlot` spreads every face between the first and last of those three slots, 132px apart, and
`drawn` gives each kind up to two faces. With all 22 of Divided World's kinds held, 33 faces stand in 132px and only the
top one can be seen (`01-today-22-kinds.png`). Pressing a card arms it, so the only way to see what lies under the top
card is to arm cards one at a time.

## 2. The decisions

- **A wide arc** (the owner chose it over a fan with a name list beside it, `03-rail-weighed.png`, and a spread of
  full cards above the HUD, `04-spread-weighed.png`). The same tilted neon postcards, fanned along an arc that widens
  with the hand across the HUD's width (`02-arc-chosen.png`).
- **One face per kind.** A kind held more than once is one face with its ×N badge (today's `.kb-hand-times`) and its
  count in its name ("Whoops!, Salty postcard, 2 in hand"). This holds on the Main board's layout only. The Phone
  board's sheet keeps drawing up to two faces of a kind.
- **The arc grows from the board's fan.** One to three kinds stand exactly where the board draws them (today's
  `fanSlot` for 1 and 3; for 2, the first and last of the three), so the Main board's match keeps its fan. From four
  kinds the cards step leftward from the right end at the board's spacing (about 66px), each turning a little more,
  with the turn held between -14 and 10 degrees and the arc's middle lifted along a gentle curve, until the arc reaches
  the HUD's width (1150px of the board's 1440, the hand button's right edge to near the plate's left). Past that, the
  step narrows to fit, down to a floor of 40px, where a name still shows its first letters.
- **Rows behind, past the floor.** A hand that would need a step under 40px wraps into a second arc standing 120px
  higher and behind the first, then a third and a fourth. Rows fill front first and split the hand as evenly as they
  can. Four rows (about 100 kinds) fit inside the board's height above the HUD. Past four, the step narrows below the
  floor rather than adding a fifth row. Divided World's 22 kinds fit in one row.
- **Grouped by type.** Left to right: Moves (`cast`), then Reversals (`set`), then Gimmicks (`use`), then any other
  play (`keep`) and any card the instance no longer has. Within a group, the instance's order. A gap of half a step
  more stands between groups. The owner chose this over grouping by flavor (a color gradient that mixes the types) and
  over the most recently drawn first (no card would keep a place).
- **A card lifts to be read.** Hovering a card, or focusing it, stands it upright, 110px higher and at 1.25 times its
  size, above every other card. The armed card stands lifted the same way while the hand is open.
- **The hand is a modal on the Main board.** While it is open, the HUD's other parts (the plate, the aura, Menu and
  Alerts) fade to about 40% and are inert. The board is not dimmed (the owner: fade only the HUD). A press anywhere
  outside the cards closes the hand and does nothing else, as a modal's backdrop does. The hand button still closes
  it, and so does Esc.
- **It deals from the hand button.** On opening, the cards rise as a stack from the hand button and fan out to their
  slots, each a beat after the one before, like a solitaire deal. Closing plays it in reverse: they gather back into
  the stack and sink into the button. The beats are the motion feel's (`engine/ui/glass/motion.ts`), so Smooth and
  Snappy each deal in their own way. Under Off (the player's Motion setting, or the device's reduced motion under
  Follow my device) the arc is there at once and gone at once, and a lift is instant.
- **Arming closes the arc.** Pressing a card arms it (as today), and the arc folds back toward the button with the armed
  card riding on top. Closed and armed, that card peeks about 90px above the HUD's seam with its "Armed · pick a post"
  tag. It is drawn for the eye only: it takes no click, so it never stands between the player and a post's + mark.
  Opened again, the arc shows the armed card lifted. Pressing it puts it back, and pressing another card arms that
  one and closes the arc. The owner chose this over keeping the arc open while armed (it would cover the foot of the
  page where the posts to pick are) and over a closed hand with no peek (the card's picture would be lost while
  picking).

## 3. The keyboard and a reader

On the Main board's layout the hand is a dialog named "Your hand" (`role="dialog"`, `aria-modal="true"`). Opening it
focuses the first card, or the armed card when one is armed. Left and Right move along the arc (Home and End go to its
ends), and the focused card lifts just as a hovered one does. Tab moves among the cards and wraps inside the hand.
Esc closes it and returns focus to the hand button. The HUD's other parts are inert while it is open, so neither Tab
nor a reader reaches them. Each card's name stays as today (its name, flavor, type, its count where more than one) and
its rules stay its description. On the Phone board's layout the hand stays a region, as today.

## 4. The rules

- **The layers.** All of this is the engine's. The grouping reads `CardFace.play`, which the engine already has, and
  the group's word is already the instance's (`UiCopy.cardKinds`). No interface is added and no instance file changes.
- **The masks.** The hand shows only the signed-in player's own cards. Nothing here is sent, and no response, payload
  or timing is added.
- **No player is ever stuck.** The open hand is a new modal state. It ends by Esc, by a press outside the cards, by the
  hand button, and by arming a card. Closed and armed is today's state, and it ends as it does today: the hand button
  puts the card back, Esc puts it back, and playing it ends it.
- **An accessible path.** The hand is part of the forum's own interface, not a game obstacle, so it meets the usual
  standards: the keyboard path in section 3, a focus ring on the lifted card, and nothing that only shows on hover.
  The faded HUD parts are inert while faded, so their contrast is that of disabled controls.
- **The scale of a busy instance.** The layout is a pure function of the number of kinds and their groups, so its cost
  is the cards drawn, at most the instance's pool. The deal's beats are capped by the feel's `screen` time, so a hand of
  60 kinds deals as fast as one of 5.

## 5. Departures from the boards

The Main board (`docs/research/2026-10-29-two-worlds/01-main.html`) draws three faces, Stick Around and two Whoops!,
with the middle one armed and raised 48px in the open fan. The board match (`e2e/boards/01-main.ts`) presses the hand
button and then a Whoops! to reach that moment. Under this design:

- One face per kind: the build draws Stick Around and one Whoops! ×2, at the board's first and last slots. The
  `card-whoops` entry is dropped.
- Arming closes the arc, so the match presses the hand button, Whoops! and the hand button again: the arc opens with
  Whoops! armed and lifted. `card-stick` holds as it is. `card-whoops-armed` and `armed-tag` are compared with
  `box: 'none'`, because the armed card stands lifted (upright, higher and larger) where the board draws it in the fan.
  Each names this design as the departure.

## 6. Open

- Whether the arc should also come to the Phone board's sheet. The owner left the phone out of this design.
