# Marks and the Lens: design

Record, written 2026-10-31. The design for what a post shows of the cards played on it, made with the owner after the
impeccable critique of PR #97 (`.impeccable/critique/`, the run of 2026-10-31T13-41-46Z on `engine/ui/cards/Effects.tsx`)
and the mockup the owner chose from it (`docs/research/2026-10-31-marks-and-the-lens/`, merged as #103). It replaces
#97's tag stack and every card's plate with **marks** on the post and one **Lens** opened on request. It revises
`docs/plans/2026-10-31-plays-on-a-post-design.md`, sections 3, 4 and 6, and keeps its sections 1, 2, 5, 7 and 8. The plan
is `docs/plans/2026-10-31-marks-and-the-lens-plan.md`.

## 0. Where it starts

- **#97 merges first** (the owner chose this). Its billing (`engine/ui/cards/billing.ts`), its batched reads of the
  plays' tallies, own reactions and spins (`prepare` in `engine/ui/thread/Thread.tsx`), its play panel's content (React,
  Spin thread, Go to post) and Whoops!'s per-layer readout and ink names stand as built. This design replaces its
  screens: the tag stack (`PlayTags`, `PlayTag`), the panel as a modal overlay (`engine/ui/cards/Panel.tsx`), the notes
  (`Plays.note`, `setNote`), and the plate (`EffectStrip`, `PlateProvider`, `usePlateHere`, the post's `slot`).
- **What the critique measured.** Whoops!'s plate adds 206px to a post at 1440 and 326px at 390, which is 1.8 times the
  post's own ink on a phone. The glass's type is 20 to 26px beside 12px Verdana. The stack's edges show when it is
  unstacked, and the unstacked list overlaps the plate by 37 to 194px. Who played a card (the tag) and how to get rid of
  it (the plate) sit in two places and order the plays two ways. Plates do not compose: four cards could take about
  1,000px on a phone.
- **What the owner answered.** Marks and the Lens replace the tag stack and the plate. Who did it is shown only on
  request, in the Lens, and no caster's name is on a mark. Stick Around's hold carries the post with its marks, so other
  cards stay live inside it.
- **What the code says about the hold.** Effects nest in play order (`PostEffects`), so a Whoops! played after Stick
  Around wraps outside the hold and is left behind in the thread when the post is lifted. And Stick Around draws its
  `children` in the thread or in its view, never both, so a lift remounts whatever is inside it: a reader's unsaved
  scrubbing is lost when the hold lifts the post, and again when it lets go.

## 1. Marks

**Decided.** One mark per card kind on a post, never one per play.

- **What a mark is.** The card's mark icon (`CardArt.mark`, the face image where a card gives none), a count ("×3")
  when the kind has more than one play, and an edge in the card's ink that fills with the card's `progress` as the card
  nears its end. It has no words, so no caster's or card's name can break it. A card with no effect gets a mark too,
  with no edge, since every play must be reachable to react to and spin from (the owner on #84).
- **Order** (the owner chose the recommendation): billing order. A kind's place is the place of its most drawn play in
  the post's billing (#97's, set when the page is read, never moved while it is read). A play that arrives live puts a
  new kind at the end.
- **Where.** Right-aligned in the post's date row, ending just left of its #number, straddling the date row and the
  body. Marks are positioned over the post and never in the page's flow, so a post is the same height with no marks or
  nine. In the ORIGIN box the strip sits on the box's head the same way.
- **Crowding** (the owner chose the recommendation): up to four marks on a desktop and three under the thread's 40em
  breakpoint, then one "+N" mark. "+N" opens the Lens on the first kind it hides. Its accessible name begins with its
  visible text ("+2 more cards played on this post"), which answers #100's label-in-name finding.
- **The notch.** A mark carries a gold notch (the glass's `--kb-glass-ready`) when the card says the reader can act on
  it as more than a reader (the view's `yours`, section 3): Whoops!'s post author, who can Wash and Write in ink. It
  is decided on the reader's screen from their own characters.
- **More reactions than the post** (the owner chose a still sign). While any play of the kind has more public reactions
  than the post it landed on (the sum of each tally), its mark carries a small still sign in its corner, and that play's
  Who row says "More reactions than the post". There is no motion. It updates live and never moves a mark.

  The words are not "outdraws". Settlement judges an outdraw by vote shares, counted per player within the window
  (`engine/rules/settle.ts`), and those are computed from who owns the reacting characters, which is private. A screen
  compares public tallies only. So the sign says what the public counts show and claims no settlement result, which the
  glass could not know and might state falsely.
- **The ghost mark** (the owner chose the recommendation). While a card is armed in the hand and can land on the post
  (`landing`), the strip ends in a dashed mark in that card's color and art with a "+", named "Play Whoops! on post
  41". It opens the play form, as `PlayHere` does today. Arming a card never moves a post. It replaces `PlayHere`'s
  tile and its place in the plate.

## 2. The Lens

**Decided.** One floating glass panel, opened on request from a mark.

- **Tabs.** The post's card kinds, in the marks' order. Pressing a mark opens the Lens on its tab. The tab row is a
  `tablist` and scrolls where it overflows.
- **Three rows, the same for every card:**
  - **State:** the card's line about what it is doing on this screen ("3 layers · top: Gloomba's yellow, 18% washed"),
    and its line about how it ends ("Ends on your screen when you scrub every layer off. The author can wash it for
    everyone."). A card with no effect says its `summary`.
  - **Act:** at most two controls from the engine's fixed kit (section 3). A card with none has no Act row.
  - **Who:** folded until opened ("3 plays · Gloomba, Pipewrench, Mrs. Hooligan"). Unfolded, it shows one row per play:
    the play's ink, its caster in capitals in the glass's face, when it was played, the message, the card's note for the
    play, "More reactions than the post" where it applies, its reactions with React (none on the reader's own play),
    Spin thread with the count of threads spun from it, and Go to post. This is #97's panel content, as a row. A card
    whose rules stack (`CardRules.stack` above 1) lists its rows in layer order, top first, because which layer a stroke
    washes is what the rows explain. Every other card lists them in billing order.
- **Not modal.** The Lens never dims or blocks the page, so the ink can be scrubbed with it open. Pressing the post
  does not close it. It closes by Esc, its ×, pressing its mark again, opening another post's Lens, or leaving the
  page, and focus returns to the mark that opened it. One Lens is open on a page at a time.
- **Where.** On a desktop, in the margin beside the post where there is room for it, so it does not cover the ink
  being scrubbed. Otherwise it sits under the mark, kept in the window (`engine/ui/glass/place.ts`). Under 40em it is a
  short sheet on the HUD's top edge, and the post is scrolled into view above it.
- **Its look.** The glass on the `effect` smoke, chamfered, with its border and glow in the open tab's ink or alignment.
  The glow is drawn on a wrapper, since the chamfer's `clip-path` cuts a box-shadow (#100's missing glow). Its type is
  the glass's at the glass's floor. Its sentences live here and not on the post, so the post's 12px Verdana is never
  out-shouted.

## 3. How a card feeds a mark and the Lens

**Decided** (the owner chose the recommendation): **the effect publishes a view**, and the Act row is **data from a
fixed kit**.

- `EffectProps.show(view)` replaces the `slot`, `EffectStrip` and #97's `Plays.setNote`. An effect calls it whenever
  what it would say changes, at most once an animation frame. A view is:
  - `progress`: 0 to 1, the edge's fill, or null for no edge;
  - `state` and `ends`: the State row's two lines, in plain words, because the Lens is the glass;
  - `yours`: whether the notch shows;
  - `controls`: the Act row, a list of kit controls;
  - `notes`: a line per play, shown in its Who row;
  - `report`: a line for a save that did not get through, shown under State.

  The view goes into the post's plays store beside its plays, and wakes that post alone. A view that changes replaces
  only the post's entry for that card, so another card's notes never blank for a frame (#100's last finding). A card
  with no effect gets the engine's default view: its `summary` as State, no edge, no controls.
- **The kit.** The engine draws every control, so every card's Lens looks, sizes and reads alike, and a card cannot
  break the glass's floor or its focus order. The kit grows only by an engine change:
  - `hold`: press and hold, by pointer, or by Space or Enter held. A key's auto-repeat counts once, and blur or leaving
    stops it. It calls the card's `start` and `stop`, so the card keeps its own pace ("Hold to scrub" costs what a hand
    costs: "An accessible path costs what the obstacle costs").
  - `press`: one action.
  - `toggle`: on or off (`aria-pressed`).
  - `choose`: one of a few named options, as a group of pressed buttons.
  - `go`: a link.
  - At most two controls are drawn. A third is a card's mistake: the engine draws the first two and warns in
    development, and each instance card's test asserts that its views never give more.
- `CardUi` gains three fields:
  - `takeover` (section 4);
  - `hint` (section 5);
  - `art.mark`, the mark's icon.

## 4. The takeover

**Decided** (the owner chose the recommendation): a **takeover flag, with the marks handed in**.

- A card with `CardUi.takeover` always wraps outermost in `PostEffects`, whatever its play order, so every other card's
  effect is inside its `children`. Two takeovers on one post wrap in play order, the latest outermost.
- A takeover's effect is given `marks`, the post's mark strip as a node, and draws it on the post it lifts. Stick
  Around's view draws the post with its ink and its marks, as the mockup's held screen does.
- The Lens opens inside the takeover. The takeover's view provides the Lens's host (a context the engine reads), so the
  Lens renders inside the hold's dialog, where focus and the inert page behind allow it. Whoops! can be opened and
  scrubbed, with Hold to scrub, from inside the hold.
- **Nothing remounts.** Stick Around draws its `children` once, into an element of its own, and moves that element
  between the thread and its view. So a lift and a release keep every inner effect's state, a reader's unsaved
  scrubbing included.
- Stick Around's own tab: its State says how it holds and how it ends ("Holds you on this post until you check the
  caster's sentence, or break free for this visit" / "It will not hold you again" / "You broke free this visit", the
  last answering the plays-on-a-post design's open note). It has no Act controls: the hold's bar, Break free and its
  checkbox stay in the hold, where its ways out are.

## 5. The first-time callout

**Decided** (the owner chose the recommendation): **met is remembered on the account.**

- The first time a reader meets a card kind that gives a `hint`, a one-line callout in the glass hangs off the first
  mark of that kind on the page ("Whoops! Drag across the ink to scrub it off your screen. Got it"). It is not in the
  page's flow. It goes away for good on "Got it", or when the card reports its first use through `EffectProps.met()`
  (Whoops!: the reader's first stroke). It replaces Whoops!'s hint on every plate, which the critique found shown on
  every post forever.
- Met is kept on the account, in `account_preferences.cards_met` (a migration), read with the preferences the engine
  already loads, and written by an RPC that adds one card key. It is the account's own, read by no one else and never
  broadcast. Its way out is Settings, Accessibility: "Card tips", with "Show card tips again", which clears it.
- An instance's export carries it, as it carries every preference, and the round-trip test sets it.

## 6. Whoops!

- **Mark:** the splat icon, "×3", and the edge filled with the share washed of the layers still inked, on this screen.
  The notch is for the post's author while a layer holds ink.
- **State:** "3 layers · top: Gloomba's yellow, 18% washed" (#97's sentence, now a State line). **Ends:** "Ends on
  your screen when you scrub every layer off. The author can wash it for everyone." Once every layer is clean, the
  State is "Washed clean" and there is no edge.
- **Act:** Hold to scrub (`hold`), and for the author a `choose` of Wash and Write in ink: the author's tool, which the
  effect already keeps as `'wash' | 'ink'`, since the author's stroke is the wash saved for everyone. That's two
  controls, as the kit allows.
- **Who:** layer order, top first. Each row's note is #97's ("Layer 3 of 3, on top · 18% washed").
- **The callout's hint:** "Drag across the ink to scrub it off your screen." Met on the first stroke.
- **Ink names** (#101's second question). The owner kept #97's rule and asked that it bend to new swatches: "if
  'Brown' is a swatch the label doesn't end up resolving to Gray". An ink given by a CSS name keeps its name. Every other
  ink is named from one table holding the swatches and the neutrals (black, white, gray), each classed by its own
  chroma in OKLCh:
  - An ink below the gray gate (chroma 0.03) takes the nearest neutral entry by lightness.
  - An ink above the gate takes the nearest chromatic entry by hue, with lightness weighed at half.

  Nothing in the code names a color family. An added Brown is chromatic, so it competes with Orange on lightness and
  wins the dark oranges. An added Silver is neutral, so it competes with Gray.

  The session checked three rules against the shipped swatches:
  - Plain nearest-point distance fails. It calls a tan "gray", and once Brown is added it calls #202020 "brown".
  - #97's hue-only rule, given a Brown, still calls #8b5a2b and #806040 "orange", because it never weighs lightness.
  - The two-stage rule names #6b4423 orange, and brown once Brown is added. #004400 stays green and #202020 stays
    black.

## 7. Engine and instance

- **Engine** (`engine/ui/`): the views in the plays store; the kit; the marks, the ghost mark, "+N" and the corner sign;
  the Lens, its non-modal float, its host for takeovers, and its Who rows; the takeover's wrapping order; the callout,
  `cards_met` and its Settings row; the migration and the API. Nothing in it names a card.
- **Instance** (`instances/divided-world/`): Whoops!'s view, controls, notes, hint, mark icon and ink names; Stick
  Around's `takeover`, its view, its mark icon, and its hold drawing the marks and hosting the Lens.

## 8. The masks

- **Billing and the corner sign** come from public tallies and the public list of spun threads. Neither reads who
  reacted or who owns what, and two readers see the same marks for the same counts. The sign's words claim nothing
  about settlement (section 1).
- **The notch, "Your play" and React hidden on one's own play** are decided on the reader's screen from their own
  characters, as #97's are. Nothing is sent.
- **`cards_met`** is a fact about the reader's own account. Its row is read by its own account alone (0019's policy),
  the RPC writes only the caller's row and answers the same way for any key it accepts, and nothing about it is
  broadcast or shown to another account.
- **No Realtime event is added.** A view is the reader's own screen state, never sent.

## 9. A busy instance

A post draws at most five marks however many plays it carries. The Lens is one per page and draws only when open; its
Who rows draw only when unfolded. A view wakes only its own post, and a mark is memoized per kind, so a wash in progress
redraws one strip (#100's memoization finding). `cards_met` is read once with the preferences, and written once per card
kind per account. The page's reads are #97's, unchanged.

## 10. Ways out

- **The Lens:** Esc, its ×, its mark, another post's Lens, or leaving the page. Focus returns to the mark.
- **The callout:** Got it, or first use. Settings' "Show card tips again" brings every tip back.
- **The hold:** unchanged (its bar, Break free, Esc presses, the checkbox, leaving the page). A Lens opened inside it
  closes back to the hold and never traps the reader in it.
- **The ghost mark:** disarming the card in the hand, as today.

No new state is put on a player, a character or a post. The log is unchanged.

## 11. Issues this answers

- **#101.** The first question (the phone's top tag wrapping to two lines) is moot, since a phone draws marks and no
  tags. The second (ink names) is answered in section 6. The owner agreed #101 closes when this merges.
- **#100.** The label-in-name finding, the panel's missing glow, the memoization and the notes blanking for a frame are
  answered in sections 1, 2, 9 and 3. The spun count appearing a frame late and the spin draft lost when the form changes
  origin are on the Lens's path, so the plan fixes both.

## Open

- Whether the corner sign should weigh spun threads as billing does. For now it compares reactions only.
- The Lens's margin placement beside a postbit laid out stacked, and the phone sheet's height, tuned with the owner on
  the stories.
- A future takeover that hosts its own Act controls in the Lens rather than in its view.
