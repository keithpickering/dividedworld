# The phone's hand, and a calmer opening for the arc: design

Record, written 2026-11-13. A design session with the owner on #521, which asked whether the hand's arc
(`docs/plans/2026-11-12-hand-arc-design.md`, built in #508) should come to the Phone board's sheet. The owner's answer on
the issue: "May as well make it consistent as long as the same logic works for smaller screens." Partway through, the
owner reported that the Main board's arc is "quite finicky while opening": the card at the far left becomes active by
default, the card at the far right shoots up from the hover state, and the animation sometimes seems to play twice.
That fix is section 1 and the plan's first task, because it changes the same lift and deal the phone builds on. The plan
is `docs/plans/2026-11-13-phone-hand-plan.md`. The mockups are in `docs/research/2026-11-13-phone-hand/`. They are
rough restylings of the real page at 390 by 844 with a 30-card hand, not boards to match.

## 1. The arc's opening, on the Main board

What the session measured (1440 by 900, motion on, 25 kinds, the hand button pressed with a mouse): the first card
dealt in and landed, and once its deal ended it rose a second time, 123px. The last card landed over the hand button,
under the pointer that had just pressed it, and rose a second time, 127px. There was no second deal. The "twice" is
the lift playing after the deal:

- **The far left.** Opening the hand focuses the first card (the arc design, section 3), and the lift's rule is
  `.kb-hand-card:focus-within` (`engine/ui/frame/frame.css`), which matches a focus the script gave after a mouse press,
  though `:focus-visible` does not.
- **The far right.** The arc's last card stands at the board's third slot, over the hand button, so the pointer that
  opened the hand is over it when it lands, and `:hover` lifts it.
- **The second play.** While a card deals, `Hud.tsx` turns its transition off, and gives it back when the card lands.
  The focus and hover rules hold from then, so their lift eases in as a second movement.

The decisions (the owner chose all three):

- **A card lifts for keyboard focus, not for any focus.** The rule becomes a card whose button matches
  `:focus-visible`. Opened with a mouse, the first card has focus and stands in its slot. Opened with Enter or Space,
  it lifts, as a keyboard player needs.
- **Hover waits for the pointer to move.** From the opening until the pointer moves, hover lifts nothing, so a card
  that lands under a still pointer stays in its slot.
- **Nothing lifts while the deal runs.** Hover and focus lift only once the last card has landed. The armed card is
  the exception: it stands lifted when the hand opens.

The owner weighed and declined moving the arc so its last card no longer stands over the hand button: the arc keeps the
board's slots.

## 2. Why the arc does not come to the phone as built

One face per kind (its ×N, and its count in its name) and the grouping by type (Moves, Reversals, Gimmicks, then the
rest, `handOrder`) do not depend on the screen's size, and come to the phone as they are. The arc does not. It is read
by lifting the card under the pointer or the focus, and a touchscreen has no hover. Divided World's 22 kinds across
390px would stand about 13px apart, or four rows deep, and a tap would arm a card nobody could read. Today the sheet
draws up to two faces of a kind in a wrapping grid. A 30-card hand is 28 faces, and the sheet scrolls 1855px inside
its 364px (`01-today-30-cards.png`).

## 3. The decisions

- **A swipe arc** (the owner chose it over the sheet's grid grouped with one face per kind, `02-grid-grouped-weighed.png`,
  which still scrolled 1721px, and over the arc shrunk to the phone's width). It is one row of the phone's postcards
  (104 by 156) along a shallow arc, swiped sideways, with the card nearest the middle snapped there
  (`03-swipe-arc.png`). The cards stand 66px apart, the arc's own step, so each overlaps its neighbor. Half a step more
  stands where the group changes. The row can bring its first and its last card to the middle.
- **The middle card is the one being read.** It stands upright, 14px higher and 1.18 times its size, above the rest.
  Each card turns 6 degrees for each step it stands from the middle, up to 18 degrees, and drops 5px times the square
  of its steps, up to 40px. The pose follows the swipe continuously, so the lift passes from card to card as the row
  moves. The line under the row (`.kb-hand-says`) speaks of the middle card: its rules in a sentence, or that it is
  armed. That line is the phone's form of hover-to-read.
- **A tap on a side card brings it to the middle**, and does nothing else. A tap on the middle card arms it, and arming
  closes the sheet, as today. A tap on the armed card while it is in the middle puts it back, and the hand stays
  open, as on the Main board.
- **Armed, the hand button carries the card.** Closed and armed, the phone keeps today's button: "Armed · Whoops!",
  one press to put it back. There is no peek: on the phone, a post's + mark stands at its right, over the hand button,
  where a peek would cover it (the owner chose this over the Main board's peek).
- **The hand is a modal on the phone too.** It is a dialog named "Your hand". While it is open, the HUD's other parts
  (the plate with Posting as, the aura, Alerts and Menu) fade to about 40% and are inert, and a press above the sheet
  closes it and does nothing else, through the same backdrop and the same swallowed click as the Main board's. The ×,
  Esc and the hand button close it. The sheet keeps its heading with the count, its ×, the line and the Vending
  Machine button.
- **It deals from the hand button.** The sheet rises as today, and the cards deal from the hand button into the row,
  each a beat after the one before, and gather back on a close, on the feel's beats (`fanDeal`, `stagger`). Under Off
  (the Motion setting, or the device's reduced motion under Follow my device) the sheet and the cards are there at once
  and gone at once, and bringing a card to the middle is instant. The pose is not motion of its own: it follows the
  player's finger, and holds under Off.
- **Where it opens.** On the armed card if there is one, else on the first card, already in the middle (no scroll
  plays), with focus on it.
- **Its size.** The sheet is as tall as its parts: the heading, the row with room for the lifted card, the line with
  room for three lines so it does not jump as the row moves, and the Vending Machine button. At 100% text it does not
  scroll. At larger text it scrolls, as today.

## 4. The keyboard and a reader

On both layouts the hand is a dialog, and opening it focuses the armed card, else the first. On the phone, a card
that takes focus by any means is brought to the middle, so the card a keyboard or a reader is on is always the one
that can be read. Left and Right move to the next card and bring it to the middle, and Home and End go to the ends.
Tab and Shift+Tab move through the cards, the × and the Vending Machine button, and wrap inside the dialog. An
activation from a keyboard or a reader (a click with no pointer) acts on the focused card as a tap on the middle card
does, because focus has already brought it there, even if the scroll is still easing. Each card's name and its
description stay as today, with its count where more than one.

## 5. The rules

- **The layers.** All of this is the engine's. The pose is a pure function beside the arc's (`engine/ui/cards/arc.ts`).
  No interface is added, and no instance file changes.
- **The masks.** The hand shows only the signed-in player's own cards. Nothing here is sent, and no response, payload or
  timing is added.
- **No player is ever stuck.** The phone's open hand becomes a modal state. It ends by Esc, the ×, a press above the
  sheet, the hand button, and arming a card. Closed and armed is today's state, and it ends as today: the hand button
  or Esc puts the card back, and playing it ends it. Section 1 adds no state: a lift waiting for the pointer ends when
  the pointer moves, and nothing waits on it.
- **An accessible path.** The hand is part of the forum's own interface. Swiping is the page's own sideways scroll,
  and every card can be reached and read with the keyboard alone (section 4). The focused card on the Main board still
  lifts, and the focused card on the phone is always the middle card, with a focus ring.
- **The scale of a busy instance.** The row is as long as the kinds held, at most the instance's pool. The pose is
  recomputed for the cards within the window and two steps beyond it on each scroll frame, so its cost does not grow
  with the pool. The deal's beats are capped by the feel's `screen` time.

## 6. Departures from the boards

The Phone board (`docs/research/2026-10-29-two-worlds/02-phone.html`) draws the hand as a region with three faces in a
row, Stick Around and two Whoops!. Its match is `e2e/boards/02-phone.ts`. Under this design:

- The sheet is a dialog named "Your hand", where the board draws a region.
- One face per kind: the build draws Stick Around and one Whoops! with ×2, its name ending ", 2 in hand". The
  `card-whoops` entry is dropped, and the cards' boxes are not compared (`box: 'none'`), since they stand on the swipe
  arc.

## 7. Open

Nothing.
