---
target: the Vending Machine
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/dividedworld/engine/ui/vending/Vending.tsx"
target_fingerprint: "sha256:c654ea2106f15353a8862a82c0e48bcc76d18f7cf7fa5c268f0369a5c2adae9b"
target_path: /home/user/dividedworld/engine/ui/vending/Vending.tsx
timestamp: 2026-11-22T15-38-22Z
slug: engine-ui-vending-vending-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | On phone, after you select a slot, both the price and Buy are a screen or more below the fold. After buying, the result line is above the viewport. At 1440×900 the tray, where cards come out, is entirely below the fold. |
| 2 | Match System / Real World | 3 | The metaphor lands. But the codes can't be keyed in, PUSH can't be pushed, and "solid" and "ghost estimate" are never explained. |
| 3 | User Control and Freedom | 3 | Esc and Back work, and the reveal has Turn all and Close. You can't deselect, and the selection stays after a purchase. |
| 4 | Consistency and Standards | 2 | Slot buttons are named "Buy X…" but only select. The "i" renders as an uppercase bar. `aria-pressed` is used for a single choice. The rounded body clashes with the glass's chamfers. |
| 5 | Error Prevention | 2 | When the wallet is short, Buy stays loud pink and enabled, and the price display stays green. After a buy, the same item is still armed for a second purchase. |
| 6 | Recognition Rather Than Recall | 2 | On phone you have to hold the selection in your head while you scroll. A card's rules exist only in the modal. |
| 7 | Flexibility and Efficiency | 2 | The grid takes 20 tab stops, has no arrow keys, can't take a code typed in, and the modal has no Buy. |
| 8 | Aesthetic and Minimalist Design | 3 | Striking, but decoration (the AURA IN coin slot, the empty tray, the marquee) sits in the decision path. The right column is empty when a card is selected. |
| 9 | Error Recovery | 3 | Refusals are plain and give numbers, but they show in the left column, far from Buy (about 1000px away on phone). |
| 10 | Help and Documentation | 3 | The modal rules are thorough and the odds are honest. "Solid" goes unexplained on this page. |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** This is the most authored page in the glass. Nothing about it could be lifted into another product: the neon machine, the instance's rotating marquee ("FRESH BEEF"), the slot codes, the price display, the orb wallet's drain preview and the foil pack reveal are all its own. But that specificity lives in decoration more than in use. The parts copied from a real machine (the AURA IN coin slot, the PUSH tray, the shelf lip, the rounded body) look like a vending machine without behaving like one, and they take space from the one decision on the page. The core flow (select, see the price, Buy) is already the glass's own pattern, the one My characters uses: select a tile, and its panel holds the actions. That part isn't fighting the glass. The ornaments around it are.

**Deterministic scan:** The source scan of Vending.tsx, PackOpening.tsx, PackOdds.tsx and PackArt.tsx came back clean (0 findings). The live-URL scan found 21 issues at 1440 and 29 at 390, nearly all `dark-glow`: one per postcard, gem, price display, marquee and title. That glow is the brand's own neon, recorded in PRODUCT.md, so it is a deliberate choice, not a defect. The page-wide `gradient-text`, `radial-halo` and `stripes` findings come from the shell's background, not this page.

The overlay's low-contrast flags are false positives. On the wallet, the detector read the gold cut-corner stroke (#836f25) as the background; measured from real pixels the text is 11.9–13.5:1. In the modal, it read the cyan corner stroke as the background; the real figure is 15.5:1. The "caption overlaps LCD" flag is the modal sitting over the page, which is intended.

Two measurements are real:

- **Info button size:** 37.6×32 on phone, under 44×44.
- **Red price chips:** 4.53–4.62:1. They pass only because they count as large text.

**Visual overlays:** Injection worked at both widths in a headless session, and the console reported 22 to 35 anti-patterns depending on the state. There is no [Human] tab, because the browser was headless.

## Overall Impression

The machine is a good idea wearing a costume it no longer needs. Everything you said you like is the real product: the codes, select → price → Buy, and cards as objects leaving the machine. Everything you flagged is costume: PUSH, the coin slot, the stacked shelves, a layout that is a tall object rather than a form. The biggest opportunity is to keep the machine's *grammar* (codes, the price display, Buy, a tray) and drop its *anatomy*. Let the decision and the payoff follow the player, as the glass's sticky menu bar and sticky dialog footers already do.

## What's Working

1. **The price preview is honest and very well made.**
   - Selecting a slot drains the wallet's orbs as ghosts and shows "5.62 → 4.62". The hand count shows "2 → 3".
   - The fine print gives the exact play surcharge.
   - It is the best moment on the page: reassurance right before you commit.
2. **The pack reveal is a true peak.**
   - Foil, a gold banner on the hit, sparkles, and turning one card at a time, with Turn all, Space and swipe.
   - The odds come from the same rules the server rolls with, and they are shown plainly, for packs only.
3. **The copy keeps "the log never lies."**
   - Refusals give real numbers ("Booster costs 3.00 and your wallet holds 1.62…").
   - Privacy is stated plainly.
   - The Boss's moves are explained in plain clauses.

## Priority Issues

**[P1] The decision and its result are off-screen on phone, and partly on desktop.**

- **What:** At 390×844, the first slot starts at y=755. After you tap A1, the price display sits 717px below the fold and Buy 927px below. The only visible change is a cyan ring. After buying, the success line is about 560px above the viewport. At 1440×900 the tray sits at y 900–1040, below the fold.
- **Why it matters:** This is the core loop. Selecting looks broken and buying looks like nothing happened, so "a wait is designed" fails here.
- **Fix:**
  - On phone, add a sticky bottom purchase bar once a slot is picked: code and name, price, wallet after the buy, and Buy. It is also where the outcome and the arriving card show.
  - On desktop, make the decision column sticky inside the machine, and bring the tray into the first 900px.
  - Precedent: the glass's sticky menu bar (shell.css:40) and sticky dialog title and footer (shell.css:442,485).
- **Suggested command:** /impeccable adapt

**[P1] PUSH promises an action that doesn't exist, and the physical exit plays where nobody is looking.**

- **What:** The tray label is `aria-hidden` printing drawn by CSS `content` (Vending.tsx:344–352). On phone its arrow is hidden, so it reads "PUSH … TO YOUR HAND" with nothing to push. The bought card sits in the tray for about 300ms, then flies to "Your hand", which on phone is about 600px above the viewport, so it simply vanishes upward.
- **Why it matters:** This is the emotional peak you value most, and it is invisible or lasts a blink. Meanwhile a label invites an input that does nothing.
- **Fix:** Make the tray the stage and give PUSH a real job.
  - The card drops in with weight and rests, visibly. On phone it rests in the sticky bar.
  - The flap becomes a real button ("Take it"). Pressing it flies the card to a hand target that is in view.
  - The card takes itself after a few seconds, so no player is ever stuck.
  - Under reduced motion it is instant, but the card still visibly appears, because "instant, never absent" applies.
  - Alternatively, drop the PUSH label and keep the tray as pure stage.
- **Suggested command:** /impeccable animate, then /impeccable delight

**[P1] When the wallet is short, nothing stops the player at the point of purchase.**

- **What:** With too little solid Aura, Buy stays enabled in loud pink ("BUY BOOSTER · 3.00") and the price display stays green. The only warning is fine print in the left column (Vending.tsx:556).
- **Why it matters:** The page invites a purchase it is about to refuse.
- **Fix:** When `short` (Vending.tsx:435), switch the price display and Buy to Salty pink and show "NEED 3.00 · HAVE 1.62" beside Buy. Keep Buy focusable with `aria-disabled` and the reason as its description.
- **Suggested command:** /impeccable harden

**[P2] Slot grouping and the info control are ambiguous.**

- **What:** Each code/price chip and its "i" sit on a separate shelf row (Vending.tsx:310–325). They are 3px below their own slot and 6px above the next. The card art sits at the top of its box, so each chip visually belongs to the card *below* it. The lowercase "i" goes through the glass's uppercase transform and comes out as a bare bar ("I", "1", "l"). It is 37.6×32 on phone.
- **Why it matters:** Players will open the wrong card's info or misread prices.
- **Fix:**
  - Follow board 07: put the code and price inside the slot's bordered cell, so one bordered cell holds art, chip and info.
  - Draw a real circled ⓘ in SVG, exempt from the uppercase transform, or use the word "Rules".
  - Make the info target 44px on phone.
- **Suggested command:** /impeccable layout

**[P2] The info modal is a dead end, and slot names mislead screen readers.**

- **What:**
  - The modal's only control is Close (Vending.tsx:607–640), and Esc does not select the slot.
  - The modal is 2237–2350px tall.
  - Every slot announces "Buy Autocorrect, 1.00 orb…" (Vending.tsx:119), but pressing it only selects.
- **Why it matters:** Reading the rules is the moment of intent. On phone, the way back to buying is close → find the slot → select → scroll two screens → Buy.
- **Fix:**
  - Add a sticky modal footer, "Buy Autocorrect · 1.00", that respects the short state and runs the same drop.
  - Rename slots to "Autocorrect, 1.00 orbs, common Move".
  - Make the grid a radiogroup: arrow keys, one tab stop, and typing a code (C, 2) to select.
  - After a buy, reset the price display to "BOUGHT · IN YOUR HAND · 4.62 LEFT" until the next pick, instead of leaving the same item armed.
- **Suggested command:** /impeccable clarify, then /impeccable harden

## Persona Red Flags

**Casey (one-handed phone):**

- Products start below the fold (y=755).
- To buy, you select, then scroll two screens to reach Buy at the bottom edge.
- The result appears above the viewport.
- Info targets are 37.6×32 at the right edge, where the thumb reaches worst.
- The modal sheet has no Buy.

**Sam (keyboard and screen reader):**

- Every slot is announced as "Buy …" but only selects.
- The single choice uses `aria-pressed` toggles.
- The grid takes 20 tab stops, with no arrow keys, and the visible codes can't be typed.
- The price display is a `role=status` with an `aria-label` plus duplicate hidden text (Vending.tsx:333–334), so it risks being announced twice.
- Positives: the 3px white focus rings are always visible, and focus returns correctly from the modal and the reveal.

**Jordan (first-timer):**

- "Wallet · solid only", "the ghost estimate can't be spent", and Aura vs orbs vs a unitless "1.00": three names for one currency, none defined on this page.
- "Your hand" looks like a status chip but is a link back to the board.

**A cast member (reads in bed on a phone, knows the game):**

- Buys a card and sees nothing happen.
- Scrolls up to find "Feelin' Fab is in your hand."
- Scrolls down again, finds the same card still armed, "BUY FEELIN' FAB · 0.20", and wonders whether it bought one or not.

## Minor Observations

- **Layout and sizing:**
  - The price display wraps "A2 · / AUTOCORRECT" onto two lines at 1440.
  - Slot art is about 50×75 at 1440, so the faces are unreadable thumbnails.
  - The right column is empty when a single card is selected. Board 07's "In the machine" list was removed and nothing replaced it. The selected card's short rules could live there.
  - The rounded body (`28px 28px 8px 8px`, instances/divided-world/ui/vending/vending.css:16,22) clashes with the brand's "panels chamfered, no rounded pills". Board 07 drew it that way, so this needs a decision, not a quiet change.
- **Pack reveal:**
  - At 1440×900 the dialog is 1048px tall, so its title and the "N of 5 turned" counter are clipped.
  - A stray gold bar floats right of the small cards.
  - "Done" and "Esc Back to the machine" do the same thing (PackOpening.tsx:648–650).
- **States:**
  - A sold-out pack's info still shows a bare price, not why it is sold out (Vending.tsx:629–630). The card branch handles this.
  - The visible wallet shows "5.62" with no cap. "of 6.00" lives only in the orbs' label.
  - Under reduced motion a purchase has no visual moment beyond fine print.
- **Contrast:** The red chips (#d24a2c with dark ink) are at 4.53:1. That is legal only as large text, so keep them at 20px/800.
- **Not exercised:** Sealed and empty slots and the Boss's-moves column were reviewed from code only, because the fixture had none.

## Questions to Consider

- If the machine's charm is the object, why is the one physical act (taking the card out of the tray) the only thing the player can't do?
- Should the slot codes be a real input? On desktop, typing C then 2 would turn the most authentic detail into a speed path rather than a label.
- After a purchase, should the machine forget the selection? A real machine resets to "PICK A SLOT", and keeping the item armed invites the purchase nobody meant.
