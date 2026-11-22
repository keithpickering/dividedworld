Record, written 2026-11-22.

# The Vending Machine's flow: design

A design session with the owner, after an impeccable critique of the Vending Machine
(`.impeccable/critique/2026-11-22T15-38-22Z__engine-ui-vending-vending-tsx.md`, 25/40, three P1s). The plan is
`docs/plans/2026-11-22-vending-machine-flow-plan.md`.

The owner's brief: the page "started out as a cartoon-styled skeuomorphic machine at a time before the Board and Glass
visual separation existed at all. It was redesigned to Glass, and in general it has an attractive appearance, but the
skeuomorphic nature of the UX itself may be fighting the rest of the glass' precedent a bit." What the owner likes and
keeps: the name, the slots' letter and number codes, the flow of picking a slot, seeing the price due and pressing Buy,
and the cards leaving the machine as objects ("this part could actually be given more detail"). What the owner asked to
change: a "Push" panel that cannot be pushed; no sticky header or footer, so on a phone a pick seems to do nothing until
the reader scrolls; info buttons and price rows that could belong to the slot above or below, and an info symbol that
reads as an uppercase I; and an info dialog with no way to buy.

The page is glass (`docs/plans/2026-10-29-two-worlds-design.md`, 1). In one line, the design keeps the machine's
grammar (codes, a price display, Buy, a tray) and drops its anatomy (a coin slot, a push flap, shelves, a rounded
cabinet), and brings the decision and its payoff to where the player is looking, as the glass's sticky menu bar
(`engine/ui/glass/shell.css`, `.kb-glass-menu`) and sticky dialog bars and feet already do.

## 0. What was found

Measured in the boards fixture's `07-vending` moment (wallet 5.62, hand 2, ten slots on sale), at 390 by 844 and
1440 by 900:

- **On the phone the decision is two screens away.** The first slot starts at y 755. After a pick, the price display
  is 717px and Buy 927px below the window's foot; the only change on screen is the slot's ring. After a purchase the
  outcome line (`kb-vending-outcome`, in the wallet panel) is about 560px above the window's top.
- **On a desk the payoff is below the fold.** At 1440 by 900 the tray stands at y 900 to 1040. The card the player
  bought drops, rests half of `feel.screen` and flies to the Your hand link (`Flying`, `engine/ui/vending/Vending.tsx`),
  all out of sight; on the phone the link is about 600px above the window, so the card leaves upward and vanishes.
- **The tray's words promise an input.** "Push" and "To your hand" are CSS `content` on `aria-hidden` art
  (`instances/divided-world/ui/vending/vending.css`, `.kb-vending-tray-label::before`); nothing can be pushed.
- **The coin slot is art in the decision path.** `.kb-vending-aura-in` (`aria-hidden`, `data-kb-art`) stands between
  the price display and Buy.
- **The shelf reads as the next slot's.** Each slot's chip and info button sit on a shelf row 3px under their slot and
  6px over the next one, and the card art hangs at the top of its slot, so the chip leans to the card below
  (`kb-vending-shelf`). The info glyph is a lowercase "i" that the glass's uppercase transform turns into a bar; it is
  37.6 by 32 on the phone.
- **A slot is named "Buy …" but only selects** (`nameOf`, `aria-pressed` on each of ten buttons), and the grid takes
  twenty tab stops (a slot and its info button each).
- **Short of solid Aura, Buy is loud and live.** It stays the pink primary button with the card's name and price; the
  reason (`shortWords`) is fine print in the wallet panel, and the press is refused after it is made.
- **After a purchase the page is armed for another.** The pick stays, so the display, Buy ("Buy Overreaction · 1.00"),
  the wallet's "4.62 → 3.62" and the hand's "3 → 4" preview a second purchase, and the page looks as it did before the
  first.
- **The info dialog is a dead end.** Its one control is Close; from it, buying is close, find the slot, pick it, and on
  the phone scroll two screens.
- **Three names for one currency.** "Wallet · solid only", "The ghost estimate can't be spent", Aura and orbs, and a
  unitless "1.00", none defined on the page. "Your hand" looks like a count but is a link back to the board.
- **The body is rounded** (`border-radius: 28px 28px 8px 8px`, the marquee 16px), where the glass's panels are
  chamfered (`2026-10-29-two-worlds-design.md`, 2: "No rounded pills").
- **The pack reveal at 1440 by 900** is 1048px tall, so its title and "N of 5 turned" are clipped above the window; a
  stray gold bar stands to the right of the small cards; "Done" and "Esc Back to the machine" do the same thing
  (`engine/ui/vending/PackOpening.tsx`). A sold out pack's info shows a bare price where a sold out card's says why.

## 1. The purchase bar, on the phone

**Decided:** on the phone's layout (`:root[data-kb-layout='phone']`) the machine's price display and Buy leave the
machine and become a bar docked to the window's foot. It is not on the page until a slot is picked; a pick raises it.
It holds, in reading order: the slot's code and name, the price, the wallet before and after ("5.62 → 4.62"), the hand
counter and its tray (section 3), and Buy. The outcome of a purchase and a refusal are said in it, beside Buy. It has a
× (and Esc closes it) that clears the pick. The page reserves scroll padding at its foot equal to the bar's height while
the bar stands, so a focused slot is never under it (WCAG 2.4.11), as `shell.css` already does for the sticky menu bar
at the top.

The bar is the glass's: the near-black ground, a 1px pale cyan seam with the cyan glow along its top edge (the seam,
`2026-10-29-two-worlds-design.md`, 2), chamfered corners, Buy the skewed primary button. It stands on the window's
foot because the Vending Machine is a full-screen glass page with no HUD under it.

Weighed: a bar always docked, reading "Pick a slot · 0.00" with Buy disabled (it never jumps, but it takes a strip of a
phone's screen while the reader only browses); a price display stuck under the menu bar with Buy left in the machine
(closer to the machine's look, but Buy stays a scroll away and out of a thumb's reach).

## 2. The decision column, on a desk

**Decided:** where the page is three columns, the machine's right column (the price display, Buy, the outcome line, and
under them the tray and the hand counter) is sticky under the menu bar while the slots scroll. The tray moves out of the
machine's foot into this column, so the card drops right under the button that bought it. The coin slot
(`.kb-vending-aura-in`) is removed; on a pack the "In this pack" backs (`InPack`) keep its place. The tray at the
machine's foot, its "Push" and "To your hand" printing and its arrow are removed. Where the page stacks but is not the
phone's layout (the container query under `calc(20em + 768px)`), the column stays in the machine, sticky to the
window's foot, as the phone's bar is.

Weighed: the phone's bar at every width (one component, but on a wide screen the eye travels from a slot to the
window's foot); shrinking the machine to fit 900px (nothing sticks, and it breaks again in a shorter window or at larger
text).

## 3. The card's exit

**Decided:** the tray is a stage with no words on it. A bought card falls into the tray (the column's on a desk, the
bar's on the phone) with a short drop and a settle, rests about 1.2 seconds with its face readable at the slot's size,
then slides into the "Your hand N" counter beside the tray, which stands in view because it is in the same bar or
column. The count ticks up when the card lands, as the hand count does now. Under reduced motion the card is in the
tray at once, rests the same time, and the count changes when the rest ends: instant, never absent (CLAUDE.md, "An
accessible path costs what the obstacle costs", read for a payoff rather than an obstacle). A pack keeps its reveal
(`PackOpening`), which flies its cards to the counter in place of the Your hand link.

The rest is a designed wait ("A wait is designed, never incidental"), and it holds nothing: the player may pick,
buy again, or leave during it, and a second purchase's card drops beside the first, each landing on its own
(the booster packs plan's Task 10 rule, which stays).

Weighed: drop and stay (the tray shows the last buy until the next, with no flight); a flight to the HUD's real hand
button wherever it stands, with a stand-in when it is off screen (more literal, more moving parts).

## 4. After a purchase

**Decided:** a purchase clears the pick. The price display (the bar on the phone) reads "Bought · Overreaction" and
"4.62 left" while the card rests in the tray, and Buy becomes "Buy another" for the same slot, so a deliberate repeat
is one press and never the default label. Picking any slot ends the bought state; on the phone the bar's × ends it too.
The wallet shows its balance with no drain preview, and the hand counter its count with no arrow. A pack's bought state
is the same once its reveal closes.

Weighed: reset to "Pick a slot · 0.00" as a real machine does (a repeat takes a second pick); keep the pick armed with a
"Bought" line beside Buy (fastest for buying several of one card, but it invites the purchase nobody meant).

## 5. The slot cell

**Decided, overturning `2026-11-04-glass-polish-design.md`, 5's shelf edge:** each slot is one chamfered cell that holds
its card's face (scaled whole, as section 5 of that design keeps), the code and price chip inside its bottom border,
and an info control in its top right corner. The info control is a circled i drawn in SVG, never a letter the
uppercase transform can reach, named in words for a reader ("About Overreaction"), 44 by 44 on the phone. Cells stand
apart with a gap, so what a chip and an info control belong to is the cell's border. A sold out cell keeps its stripe
and its chip's "Sold out"; a sealed cell keeps its dashed outline and its words. The Vending board
(`docs/research/2026-10-29-two-worlds/07-vending.html`) put the chip inside the cell too; the shelf was the polish
design's answer to a 95px slot that the cell's own layout now answers.

Weighed: keep the shelf and fix its spacing (the polish design's real-machine pricing, but a shelf between rows is
ambiguous at any gap); put the info control in the bar beside Buy (one tab stop per slot, but rules need a pick first).

## 6. Short of solid Aura

**Decided:** when the picked slot costs more than the wallet's solid balance, the price turns Salty pink and the line
under it reads "Need 3.00 · have 1.62 solid". Buy is drawn muted and carries `aria-disabled="true"` with the same words
as its description, so it stays focusable and a reader hears why. Pressing it says the same words in the outcome place
beside it (a refusal, `role="alert"`) and asks the server nothing, as `buy()` does now. The wallet shows no drain
preview and the hand counter no arrow, as now. The words are the player's own numbers, never another's.

Weighed: replace Buy with the reason as plain text (clearest, but the bar's layout changes between states and a
keyboard user loses the stop); keep Buy live and move the refusal beside it (least change, but the page still invites a
purchase it will refuse).

## 7. The info dialog

**Decided:** the dialog (`Overlay`, the `kb-vending-about-dialog`) gets a sticky foot (`FormFoot`, as the Turn and
debut dialogs use) with one plain line and two buttons, Close and "Buy Overreaction · 1.00". The line is "1.00 from
5.62 solid → 4.62", or the need and have line of section 6 when the wallet is short, with Buy muted as there. Buy closes
the dialog, picks the slot, and runs the same purchase as the bar's Buy: the drop into the tray, or the pack's reveal.
A sold out slot's foot has its reason ("Sold out", "Pulled by the Boss until Nov 9") and Close, and no Buy. A sold out
pack's info says its reason too, where today it shows a bare price.

Weighed: "Pick this slot" in place of Buy (one place to buy, one press more); both buttons (more choice, more buttons).

## 8. The machine's shape

**Decided:** the body, the marquee and the slot cells take the glass's chamfered corners. The machine still reads as an
object by its neon outline, its marquee and its tray, and it stops being the one glass page whose panels are rounded.
The drawing is the instance's (`instances/divided-world/ui/vending/vending.css`); the engine's sheet only gives it a
place (`2026-10-29-two-worlds-design.md`, 6).

Weighed: keep it rounded as a named exception (an object drawn in the glass, not a panel of it); a rounded cabinet with
chamfered parts inside it.

## 9. The keyboard, and what a slot is called

**Decided:**

- The slots are one single choice: a `radiogroup` named for the machine, each stocked slot a `radio` named for what it
  sells ("Overreaction, 1.00 orbs, common Move", with the price note and the Boss's words as now), never "Buy …". Tab
  enters the group at the picked slot or the first stocked one; the arrow keys move through the two-column grid (left
  and right within a row, up and down between rows, wrapping at the ends) and pick as they move; Home and End go to the
  first and last stocked slot. A sold out slot is a radio with `aria-disabled="true"` that the arrows pass over, as now
  it cannot be picked; a sealed slot is not a radio and the arrows pass over it.
- From the group, Tab goes next to the focused slot's info control (the others are out of the tab order but each can be
  pressed by pointer), then to Buy.
- A code typed while focus is inside the machine picks its slot: a row letter, then its number. Between the keys the
  price display shows the letter and a blank ("C_"); a second letter starts over; Esc or a key that is not a code
  clears it. The keys are listened for only inside the machine, so a screen reader's quick keys and the page's other
  shortcuts are untouched (WCAG 2.1.4).

Weighed: the radiogroup without typed codes (simpler; the codes stay labels); today's tab order with only the names
changed.

## 10. The left column

**Decided:** the column holds the title and the wallet alone: the orbs, "5.62 of 6.00 solid" with the drain preview
after a pick, one line, "Only solid Aura spends. Your live estimate settles into it each day.", and the privacy line
("What you buy is private: nobody else sees it until you play it."). The outcome and refusal lines leave it for the bar
or column beside Buy. "Your hand" becomes a plain text link under the wallet, "See your hand", whose words or
description say it goes to the board; the counter in the bar and column is the hand's count on this page.

On the phone the head compacts so the machine starts on the first screen: the title on one line, the wallet one row
(the orbs, "5.62 of 6.00 solid", and an info control that opens the plain-words line and the privacy line), then the
machine with at least its first row of slots in view at 390 by 844.

Weighed: leave the column as it is and move only the outcome lines; fold the wallet into the bar on the phone (the page
starts with the machine, but the orbs lose their stage).

## 11. The pack reveal

**Decided:** the reveal fits a 900px window at 1440 wide: its title and its count of turned cards in view. The gold bar
to the right of the small cards is found at its cause and removed. One close control remains where two do the same
thing. These belong to this design because they are the end of the purchase this design rebuilds.

## The masks, the ways out, the layers

- **The masks.** Nothing here adds a payload, a Realtime event, a read or a timing. Everything the bar, the column and
  the dialog say is the signed-in account's own wallet, hand and purchase, read as now (`usePlayer`). The typed codes and
  the radiogroup are client state.
- **The ways out.** The bar: its ×, Esc, and any pick. The bought state: any pick, and the bar's ×. A partly typed code:
  Esc, a non-code key, or leaving the machine. The short state: a different pick, and the bar's ×. The dialog keeps
  Close and Esc. The card's rest ends by itself.
- **The layers.** The structure, the bar, the column, the radiogroup, the typed codes, the copy and the motion are the
  engine's (`engine/ui/vending/`). The machine's drawing (its body, marquee, cells' chamfers and neon) is Divided World's
  (`instances/divided-world/ui/vending/vending.css`). No new interface: the shop's name, the marquees and the pack looks
  already reach the engine through `InstanceUi`. The engine's new words name no instance.

## The confirmed brief

Glass, Operate with a game's flavor. The machine is the stage and the decision follows the player: the pick shows
itself at once wherever the player is looking, Buy is in a thumb's reach on the phone, and the card the player bought
is seen arriving in a hand that is on screen. Neon on what is picked (cyan) and ready (gold), Salty pink for what the
wallet cannot cover; chamfers everywhere; Anton for the price and the "Bought" moment, Barlow Condensed for the rest;
no decoration in the path from a pick to Buy.

## Open

- **The bar's height at 200% text.** The bar must not take more than a third of a 390 by 844 window; at the largest text
  setting the name may need to truncate with the full name in the radio's own name. The build measures it and the
  owner sees the screenshot.
- **Typed codes past row Z.** `codeOf` runs A1 upward; a machine with more than 52 slots has no letter codes. No
  instance has a quarter of that; the plan keeps `codeOf` and the typed codes to its range.
