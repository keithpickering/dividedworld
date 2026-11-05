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

## 3. Open: the calm

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

Undecided; asked of the owner with batch 1.
