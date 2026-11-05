# Backfilling the boards: design

Record, written 2026-11-05. A design session with the owner, started from the owner's observation: "our E2E tests will
actually fail if screens differ too much from the design boards, and the areas with boards are in turn the ones that
look the best. Features that have been added since have not been given boards, so the design sort of just 'wings it'."
The session runs impeccable's critique over each screen built without a board, draws the board with the owner, and
turns every flaw a board fixes into a task for a build session. It is drawn on #202's head (c2553b3), the glass polish's
first phase, which may still change in review. The boards are in `docs/research/2026-11-05-backfill/`. The plan is
written once every batch is approved.

## 0. Where it starts

- **The board match holds two folders.** `e2e/boards.spec.ts` compares the app with the boards in
  `docs/research/2026-10-29-two-worlds/` and `docs/research/2026-11-02-alerts/` (`BOARD_FOLDERS`), by each board's
  manifest (`e2e/boards/<id>.ts`, compared by `e2e/board-match.ts`: a box within 8px of position and 4px of size, the
  same font family, size and weight, color and letter-spacing). It never compares the smoke's pixels.
- **Later boards are drawn and never compared.** The onboarding boards (`docs/research/2026-11-02-onboarding/`), The
  System's mocks (`docs/research/2026-10-30-the-system/`), and the boards of three designs not built yet (booster packs,
  cosmetics, the card template) are in no folder the board match reads.
- **Nothing asks a new glass screen for a board.** `e2e/glass-screens.ts` lists every glass screen the layout, text,
  hover and accessibility runs visit; nothing ties an entry to a board.
- **The glass screens with no board at all** on c2553b3: Sign in, Register, Reach a person, the signed-out HUD (the
  front door's), New character and its two Debut dialogs, Edit profile, the Reveal modal, the Lens in its three states,
  My log before anything has settled and with a settlement's posts open, Settings › Account with the invites, the HUD with
  a wallet past its cap, the Vending Machine's card info, the admin queue and Write update.

## 1. What was decided

1. **Scope** (the owner: "Glass + unchecked"). Every built glass screen and state without a board, and the onboarding and
   The System boards that exist but are not compared. The board world's screens (the index, a profile, its record, the
   Director's profile, the move notice, errors) wait for a pass of their own, since the 2003 look is held by other rules.
2. **The old boards are redrawn as amendments** (the owner: "Redraw as amendments"). The onboarding and The System
   boards are drawn again on #202's parts (PageHead, GlassButton, the one dialog frame) in this folder; the old ones stay
   as records, as the alerts boards were drawn over the two-worlds ones, and the manifests compare the new.
3. **Critique, then draw** (the owner). Each screen is shot on c2553b3 at 1440 and 390, impeccable's critique is run
   against the two-worlds and alerts boards, and each board is drawn with the flaws fixed. The owner approves the boards
   a batch at a time, and each flaw a board fixes becomes a build task.
4. **A guard** (the owner: "Every screen names a board"). Each entry in `e2e/glass-screens.ts` names the board it is held
   to or says why it has none, and a board drawn for a design not built yet waits in `PENDING`, named by the plan that
   builds it. A screen with neither fails the build. The check comes with its poisoned self-test.
5. **Sizes** (the owner). One 1440 board per screen or state, and one phone board per batch with its screens at 390 side
   by side, as `02-phone.html` and `05-phone.html` are drawn.
6. **Batches**, in the order a new player meets the screens (the owner: "Order looks good"): 1. the door; 2. onboarding,
   redrawn; 3. characters; 4. the Lens and My log's states; 5. account and HUD states; 6. admin.
7. **The front door is #224's** (the owner: "let's make sure for the welcome screen we use the version designed in #224
   (in rough form)", then "The front door, in batch 1"). Batch 1 draws the front door as #224 built it from the sketch
   the owner chose (`.impeccable/mocks/decision/the-thread.html`), polished; `/welcome` is redrawn in batch 2.

## 2. Batch 1: the door

Shot on c2553b3. The critique, against the two-worlds boards:

- **The pages are a left column on empty smoke.** Sign in, Register and Reach a person hold their content in the left
  60% of the page and nothing to its right; the boards fill the width with a structure (Settings' section rail and
  rows). The boards put the form in a 680px column and the other ways in (New here? or Already playing?, and Stuck?)
  in an aside on the right.
- **Two Register links on Sign in, and a cramped lead.** The lead reads "a new player registers first (Register), or
  gives an invite after the code", with a parenthesized link, and "New here? Register." repeats it. The board's lead is
  one plain sentence, and Register is one secondary button in the aside, with why it takes an invite.
- **The links trail with no hierarchy.** "New here? Register." and "Reach a person" stack under the button at the same
  weight. The board gives each its heading in the aside and says when you'd want it ("No code arrived, or the link has
  expired").
- **The 18+ check is an unstyled white square** in a bold line that outweighs the form. The board uses the Settings
  board's cyan checkbox, with the acknowledgement as a note under it.
- **Reach a person lists its ways as bare links**, with "Email" as the link and the address as plain text beside it.
  The board makes each a row in the Settings idiom: Discord with a button, the address itself as the link.
- **The signed-out HUD is a flat strip**, unlike the HUD a player gets: no mask panel, no Aura notch, and Register with
  an invite in a shape no other button has (one cut corner). The board draws it in the signed-in HUD's own frame, with
  the "?" in the mask panel, the Aura sockets empty, and Sign in and Register with an invite as one ButtonRow, so the
  door previews the game it opens onto. #224's sketch drew the empty sockets; the build left them out.
- **The calms are hard-edged slabs.** See section 3.

## 3. The calm

The owner, on batch 1: "the 'scrims' (black blurred areas to increase contrast subtly) are nice, soft, and blended in
the design boards, but in our actual implementation they are very harsh and noticeable, likely to force accessibility
standards".

What c2553b3 does (`engine/ui/glass/calm.css`): each text element carries its own backing, the ground at 85% opacity
(`--kb-glass-calm-opacity`), with a linear 32px ramp (`--kb-glass-calm-feather`) on each axis, and the axes intersect.
#202 caps the ramp at the title gap (12px) under a title, at 12px in a dialog, and at the gutter (16px) on the phone,
so that a calm adds no space and is never cut. A box with a short linear ramp shows its corners, and one per element
makes a page a patchwork of slabs.

What the boards do: the calm is a hole in the smoke, a rectangle blurred by a 60px Gaussian (a falloff of about 150px
with no edge to see), one or two per region. The boards hold the same 4.5:1 floor (the Settings board's comment: "every
line below sits in a calm, so its worst pixel stays dark enough for 4.5:1"). So the harshness is the shape of the
backing and its caps, not the contrast it buys. The board match never compares the smoke, so nothing has caught it.

**Decided** (the owner, agreeing with the recommendation): **region calms, as the boards draw them.** The calm becomes a
mask on the smoke layer itself, one per region (a page's column, an aside, a dialog's body, the HUD's panels), with a
Gaussian falloff, drawn behind the column so that no column's clip cuts it. It is its own task, ahead of the screens.

**Decided** (the owner): **the floor stays 4.5:1 on Full smoke.** The owner noted that Smoke Low and Off already give
every player a plain ground, so the default could be less strict; offered a lower floor on Full with Low and Off as the
conforming version, or a percentile in place of the worst pixel, the owner chose to keep 4.5:1 against the worst pixel
and soften only the shape, since the boards reach it softly. `tools/check-glass-contrast.mjs` keeps reading the worst
pixel. No rule changes. Where a screen cannot reach 4.5:1 with a soft calm, the build stops and asks rather than
hardening the calm.

Batch 1 approved by the owner as drawn.

## 4. Batch 2: onboarding, redrawn

Shot on c2553b3: `/welcome`, `/guide`, and the HUD tour's first two steps on a new account (`e2e/onboarding.ts`'s
`signInUnseasonedOnBoard`). The critique, against `docs/research/2026-11-02-onboarding/` and the two-worlds boards:

- **The letter's heading is set in capitals and breaks onto two lines.** The board sets "After nine years of
  development" as written, on one line at 60px; the build's capitals make it a two-line block that outweighs the page
  title. The same holds for the guide's section headings ("WELCOME LETTER", "THE METAGAME" against the board's
  "Classes"). The boards set a letter's or a section's heading in the case it is written in.
- **The calms are slabs**, most visibly behind the welcome's rail and the guide's contents (section 3).
- **On the phone, Before you start's choices are squeezed.** Each row keeps its label and its control in two columns at
  390, so "FOLLOW MY DEVICE" breaks inside its own label and each note runs about 170px wide. The board makes each
  setting a full-width block, its options wrapping whole and its note under them. The layout check's squeeze refusal
  passed it, since the column gave the block no more room; the board match at 390 is what holds it.
- **The tour's tip is a lighter gray than the glass**, and the page behind it is only dimmed. The board draws the tip on
  the glass's own ground with the violet edge and blurs the page behind, so the cut-out is the one sharp thing.
- **The phone HUD cuts the mask's name** ("NEWCOME" with the chevron over its last letter). The board gives the name its
  width. (Held again by batch 5's HUD states.)
- **A stray cyan square at the phone tour's top-left corner** (390, step 1), about 6px: a cut-out or a focus ring
  drawn at (0, 0) before the target is measured. The build finds its cause first.
- Kept from #202: the two calls to action as one ButtonRow at one size; the guide's folded contents on the phone; the
  welcome's copy as it stands (the instance's welcome page, approved by the owner in review).

**Approved by the owner, with two nits, both now in the boards:**

- **A chamfered piece draws its border along the cut.** The owner: "For the cards with chamfered corners, are we able to
  make the thin border go along the chamfered corner's edge, rather than just masking the regular rectangle's border?
  I think it will look a bit cleaner, and I believe we're already doing it on Modals." The dialogs do, through
  `engine/ui/glass/base.css`'s `.kb-glass-cut-panel`, `-dialog` and `-button` (the element is the border's color, cut,
  and its `::after` is the panel one border in, cut by a line moved in by 0.5858 of the border). The welcome letter
  (`engine/ui/welcome/welcome.css`), the Updates post (`engine/ui/updates/updates.css`), the guide's article
  (`engine/ui/guide/guide.css`) and Gabe's note on the front door (`engine/ui/front-door/front-door.css`) instead clip a
  bordered box with a hard-coded 24px polygon, so the cut runs through the border and leaves the diagonal bare. The
  boards' `.piece` draws the border on the cut, as the dialogs do; the plan moves every clipped, bordered piece onto
  base.css's cut classes and adds a check that refuses a `clip-path` polygon on a rule with a border outside base.css.
- **The tip's arrow meets the tip's edge.** The owner: "the arrow pointer for Gabe's tips is about 4-5px too low,
  floating beyond the edge of the card". In the build's tour at 1440 (step 2), the arrow starts about 5px below the
  tip's foot too (`engine/ui/tips/tips.css`, `.kb-tips-arrow`). The board's arrow starts one border above the foot, so
  the two read as one piece.

## 5. Batch 3: characters

Shot on c2553b3: `/characters/new`, both Debut dialogs, `/characters/edit`, and the Reveal modal. The critique, against
the two-worlds boards (06-turn above all, whose class carousel and How loud row New character shares):

- **New character's lead floats beside its title**, baseline-misaligned, on a slab calm. PageHead puts the lead under
  the title, as every other glass page has it since #202. The board does too.
- **New character's sections run together.** "HOW LOUD" sits 15px under the debut options and "WHAT EVERYONE WILL SEE"
  as close under How loud, so a label reads as the foot of the block above. The board spaces every section 44px from
  the next, as the Turn board does.
- **A class card's earns and hurts are one run of text.** The Turn board sets the hurts apart, in the hurt color, so the
  card reads as two facts. The board does the same with the build's own words, split at "Hurt by". The class's copy
  gains no words; the instance's class entry carries the two halves as two fields (the plan names the interface).
- **The page ends on two bare buttons.** The board gives New character, the Debut dialog and the Reveal modal the Turn
  board's footer: one plain line saying what will happen, beside Cancel and the primary action. Its sentences are a
  draft for the owner's review.
- **The Debut dialog's three How loud options sit in a two-column grid**, leaving a hole beside the third. The board
  sets them as one row of three, as the Turn board does; on the phone they stack.
- **The Reveal modal's Board and Thread are two small, unequal selects**, and its count sits about 40px below its field,
  nearer the next label than its own. The board makes Board and Thread one row of two equal fields, and puts each count
  on its field's own line, right-aligned, with the field's hint at its left.
- **Edit profile is one column over half the page**, its counts detached from their fields the same way, and the
  picture is chosen with the browser's own file button ("Choose File No file chosen"). The board puts the fields on the
  left, and on the right the postbit as the board will show it, following what is typed ("What everyone will see", the
  idiom New character and the dialogs already use). The picture is chosen with a secondary GlassButton beside the two
  crops' frames.
- **On the phone, My characters' title breaks inside its count** ("YOUR CHARACTERS (3 OF" / "6)"). The board sets the
  count on a line of its own under the title, never broken. The Debut dialog on the phone is a sheet with its two
  buttons at its foot.
- Kept: the shared dialog frame (#202), the carousel and its count, the preview's 2003 look.

**Approved by the owner** ("Approved, very nice"), with one nit, now in the board: the carousel's Next arrow was cut on
its right by the class row's clip, since a skewed control leans past its own box. The board pads the head by the lean.
The build holds the same with the layout check's cut-control refusal, which the board match at 1440 will now also see.

## 6. Batch 4: the Lens and My log's states

Shot on c2553b3: the Lens's three stories (`boards-01-lens--lens-whoops-who`, `--lens-stick-around-who`,
`--lens-author-whoops-who`), `/log` before anything has settled, and the Log board's story with a settlement's posts
open. The critique:

- **The Lens's content is cut off.** At 1440 by 1000 the panel is 340px wide, from 196px down to the HUD, and its last
  play's buttons (As it landed, Go to post) run under the HUD; on the phone the sheet's play is cut by the HUD the same
  way. Nothing says there is more. The board docks the Lens at the right from the page's top to just over the HUD, 460px
  wide, its bar (the tabs and Close) fixed and its body scrolling, with a fade at its foot where more follows. On the
  phone it is a sheet that ends above the HUD and scrolls inside.
- **The Lens's current tab reads backward.** The current tab (WHOOPS!) is an outline and the other a filled dark block, the
  reverse of every other glass tab strip. The board fills the current tab in its card's ink and outlines the other.
- **The Lens's buttons fall in a ragged stack** of three styles: the play's four actions wrap as two, one, one, and the
  author's tools stand as "Your tool WASH" over "WRITE IN INK". The board sets a play's actions as a two-by-two grid of
  equal secondary buttons, and the author's tools as one row with Hold to scrub, under a label.
- **My log before anything has settled is a paragraph on the smoke.** The board keeps the table's shape: its head, and
  one row saying what its first line will be and when ("Its first settlement, in 7 h 42 min, is the first line here"),
  so the page looks like the log it will become. On the phone that row is the first card.
- **A settlement's open posts put their amounts in the Wallet column.** The nested rows' amounts stand under WALLET while
  the settlement's own +0.35 stands under AURA. The board puts every nested amount in the Aura column and leaves the
  Wallet column empty there. On the phone each post's kind sits beside its link, not on a line of its own.
- **The phone's character tabs wrap raggedly** (Mrs. Hooligan alone on a second row). The board makes them one row that
  scrolls, the current tab in view.
- **The phone HUD cuts the mask's name again** ("STORY RE", "PIPEWREN"); see batch 2.

**Approved by the owner, with two nits, both decided:**

- **The Lens's tabs scroll** (the owner asked how they scale past two cards; chose "Scroll, like the menu"). A tab is one
  kind of card on the post, so a post holds as many as an instance has kinds (nine in Divided World, any number in
  another). The strip is one row that scrolls sideways, fading at the edge where more wait, with the current tab
  scrolled into view, as #202 made the menu bar on the phone. `28-lens.html` draws five kinds.
- **What each block of the Lens's words is for** (the owner: "our copy in these sections is a bit inconsistent (a
  heading acting as a description in Stick Around's case, acting as duplicated progress info for Whoops, probably
  others for other effects) ... it's good to wrangle in what each block of text is supposed to actually do here"; chose
  the roles, the check and a rewrite of every card). `engine/ui/cards/types.ts` already names the blocks (`CardView`'s
  `state`, `ends`, `notes`, `report`; `CardUi`'s `hint`), but each card fills them its own way: Stick Around's `state` is
  a sentence that describes the card and its way out, and Whoops!'s repeats its plays' notes. The roles:
  - **the tab:** the card's name;
  - **the heading (`state`):** what the card is doing to this reader on this post now, as a short status ("41% washed
    for you", "Holding you on this post"); never a sentence, never how it ends;
  - **the line under it (`ends`):** the way out, present whenever the card holds the reader or covers the post
    (CLAUDE.md, "No player is ever stuck"), in plain words;
  - **a play's note (`notes`):** that play's own part only ("Layer 3 of 3, on top"), never the whole card's;
  - **`report`:** a longer plain report, only where a card has more to say than the status and the way out;
  - **`hint`:** the one line for a reader who has not yet met the card.
  The plan adds a check over every instance card's views that can be checked from their words (an `ends` while the card
  holds or covers; a `state` with no sentence in it), driven red on a planted card, and a task that rewrites each
  card's Lens words to the roles, every new line drafted in the plan for the owner's review in the PR. The boards' Lens
  headings and lines are drawn to the roles; their words are drafts.

## 7. Batch 5: account and HUD states

Shot on c2553b3: Settings › Account, the Vending Machine's card info from slot A2, and the HUD with a full wallet and
an estimate past the cap. The critique:

- **The invites have no list.** The screen named "with the invites" shows none made ("You have made no invites." under
  the button, the state after the action). The board draws two, one open and one used, each a row with its code, its
  state and when, and the open one's own Copy the link and Withdraw; Make an invite follows the list. (Whether
  Withdraw exists in the engine is the plan's to check; where it does not, the row has Copy the link alone.)
- **Reach a person is stranded** at the page's foot-left, under no section. The board puts it under the section rail,
  ruled off, where every Settings section reaches it.
- **The card info has no card.** About Whoops! is a dialog of text with a small title, so the face a player tapped to
  learn about is gone. The board sets the card's face (the hand sheet's size, `Postcard.tsx`) beside its rules, the
  title at the dialog frame's heading size, and the slot and the card's kind above it.
- **"1.00+" is a price no one can read.** The board says it in words: "1.00 to buy · more to play on a long post", and
  the rules say how much more.
- **The HUD past its cap says the figure twice and drops the way out.** It shows "+0.85 EST." and "+0.85 past the cap"
  side by side, and leaves out the second half of the orbs' own words ("Spend some before the settlement, or it won't
  fit.", `engine/ui/orbs/Orbs.board.stories.tsx`). On the phone it shows an orb with a plus and says nothing. The board
  says the figure once ("+0.85 EST. PAST THE CAP") and the way out under it, on both sizes. Losing Aura is not being
  stuck, but the glass says plainly what the player can do about it.
- **The phone HUD cuts the mask's name** once more ("MRS. HOO"); the board gives the name the row's width, the Hand
  button beside it.
- Kept: the section rail's outlined unselected sections (#202: quiet fails contrast on bare smoke).

**Approved by the owner** ("I like putting the card image in the modal"), with one direction: **the card info shows the
card's real face, as the card template draws it.** The owner: "In the build let's be sure to use the actual card image,
which (not built yet) has been redesigned" in the card template design (`docs/plans/2026-11-05-card-template-design.md`,
its board `docs/research/2026-11-05-card-template/01-layouts.html`: the "Low name" layout, 2:3 at every size). The card
info draws `Postcard.tsx` at the sheet's size (276 wide) and never an image of its own, so it shows the new face once the
card template plan is built. The plan's card-info task follows that plan's merge; the board's face (`34-vending-info.html`,
`36-account-phone.html`) is a stand-in in the template's layout, and its manifest compares the face's box only.
