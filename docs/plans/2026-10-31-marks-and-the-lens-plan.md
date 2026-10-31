# Marks and the Lens: plan

Record, written 2026-10-31. The plan for `docs/plans/2026-10-31-marks-and-the-lens-design.md`, built by one build session
in one PR. The PR says `Closes #101` and `Closes #105`. It names #100's findings it answers, and the issue is checked off
item by item rather than closed, unless every item is answered.

**Before Task 1.** #97 merged on 2026-10-31 (`309390b`), so the build starts from `main`. File and function names below
are #97's where #97 made them. #104 (the page's unchunked tallies and own-reactions reads) is a separate plan,
`docs/plans/2026-10-31-chunked-id-reads-plan.md`. This plan neither waits on it nor touches `web/src/data/supabase.ts`
beyond Task 7's two RPCs.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so there is no
poison to plant. The engine/instance boundary check runs in the build as always, and nothing in `engine/` names Divided
World, Whoops! or Stick Around. One migration (Task 7) is in the same commit as its SQL test. The words a player reads
are the design's, in American English.

## Task 1. Views in the plays store; `show` replaces the notes and the slot (engine)

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/plays.ts`, `engine/ui/cards/Effects.tsx` (`PostEffects`);
tests in `engine/ui/cards/plays.test.tsx` and a new `engine/ui/cards/view.test.tsx`.

- In `types.ts`, add `CardView`: `progress: number | null`, `state: string`, `ends?: string`, `yours: boolean`,
  `controls: readonly KitControl[]`, `notes: Readonly<Record<Id, string>>`, `report?: string`. Add `KitControl`, a
  union of `hold { label, describe?, start(), stop() }`, `press { label, run() }`, `toggle { label, on, set(on) }`,
  `choose { label, options: {value, label}[], value, choose(value) }` and `go { label, to }`.
- `EffectProps` gains `show(view: CardView | null)`, `met()` (wired in Task 7; a no-op until then) and `marks: ReactNode`
  (filled in Task 5). It loses `slot`.
- `CardUi` gains `takeover?: boolean` and `hint?: string`. `CardArt` gains `mark?: string`.
- In `Plays`, replace `note`/`setNote` with `view(post, card): CardView | null` and `setView(post, card, view | null)`.
  `useCardView(plays, post, card)` reads it. Setting a view equal to the one held (shallow, per field, with `notes`
  compared by entry) does nothing. Setting a view wakes only that post's listeners, and leaves the post's plays snapshot
  as it was, as #97's notes did.
- `defaultView(rules, ui)`: the engine's view for a card with no effect, or before its effect has said anything. Its
  State is the card's `summary` (else `describe`'s first sentence), with no edge and no controls.
- `PostEffects` gives each effect a `show` bound to its post and card, and clears the card's view when the effect
  unmounts.

Tests first:
- A view set for one card wakes that post's listener and no other post's.
- An equal view wakes nothing.
- Changing one card's view leaves another card's view (and its notes) on the same post untouched, with no frame in
  which it is absent (#100's last finding).
- Unmounting an effect clears its view.
- `defaultView` with and without a `summary`.

## Task 2. The kit (engine)

**Files:** `engine/ui/cards/Kit.tsx` (new), `engine/ui/cards/kit.css` (new); test `engine/ui/cards/kit.test.tsx` (new).

- `<Kit controls={...} ink={...} />` draws at most two controls as glass tiles, at the glass's floor (`--kb-glass-font-body`
  and the size tokens; no literal colors, so `tools/check-ui-tokens.mjs` holds).
- `hold` is a button.
  - It calls `start` on pointer down, or on Space or Enter keydown with `!repeat`.
  - It calls `stop` on pointer up, leave or cancel, on key up, and on blur, and swallows the context menu.
  - `describe` becomes its `aria-describedby` text.
  - This is Whoops!'s "Hold to scrub" handling (`instances/divided-world/cards/whoops/Effect.tsx`, about lines 723 to
    733), moved into the engine unchanged in behavior.
- `press` is a button. `toggle` is a button with `aria-pressed`. `choose` is a `role="group"` named by its label,
  holding one `aria-pressed` button per option. `go` is a `Link`.
- Given more than two controls, it draws the first two and, in development only, `console.warn`s naming the card.

Tests first:
- `hold`'s start and stop by pointer, by Space and by Enter.
- A key's auto-repeat calls `start` once.
- Blur stops.
- `choose` presses one option and reports its value.
- `toggle`'s `aria-pressed`.
- `go`'s `href`.
- Three controls draw two and warn.

## Task 3. Marks, the ghost mark, "+N" and the corner sign (engine)

**Files:** `engine/ui/cards/Marks.tsx` (new), `engine/ui/cards/marks.css` (new), `engine/ui/thread/Post.tsx`
(`ActArticle`: the strip in the `kb-act-meta` header; `PlayTags`, `slot`, `PlateProvider` and `PlayHere` removed from
it), `engine/ui/spin/Origin.tsx` (the strip on the ORIGIN box's head), `engine/ui/cards/PlayActions.tsx` (`PlayHere`
becomes `GhostMark`, drawn by the strip); tests in a new `engine/ui/cards/marks.test.tsx`.

- `kindsOf(billed: readonly CardPlay[]): readonly string[]`: card kinds in the order their first play appears in
  billing. It's pure, with a Node test.
- `MarkStrip({ post, plays, tallies, onOpen })` draws one `Mark` per kind. Up to `MARKS_WIDE = 4` show, or
  `MARKS_NARROW = 3` under 40em (#97's `useNarrow`), then a "+N" mark. Every mark is a `button` with
  `aria-expanded` for the Lens, absolutely positioned so the post's box is the same height with or without marks.
  `Mark` is memoized per kind.
- A mark shows:
  - its icon (`art.mark ?? art.image`);
  - the count (`×n`) when n > 1;
  - the edge, `--kb-mark-progress` from the view's `progress` (no edge when null);
  - the notch when the view's `yours`;
  - the corner sign when any play of the kind has a tally sum greater than the post's (`useTally` for each, from the
    page's tallies store).
- Accessible names:
  - a mark: "Whoops!, 3 plays, 18% washed. Opens the cards on this post.", where the middle is the view's `state`;
  - the corner sign adds "One has more reactions than the post.";
  - the notch adds "Yours to act on.";
  - "+N": "+2 more cards played on this post".
- `GhostMark`: while a card is armed and `landing(...)` is ok, the strip ends in a dashed mark in the card's color
  with "+", named "Play Whoops! on post 41", opening the play form as `PlayHere` did. Delete `PlateProvider`,
  `usePlateHere`, `EffectStrip`, `PlayTags`, `PlayTag`, the stack and its CSS, and the `kb-act-slot`.
- Remove what #97's `cards.css` and `panel.css` drew for the stack, the tags and the plate. Keep only what the Lens
  reuses.
- `engine/ui/cards/tags.test.tsx` goes with the tags. This removes #100's test that held without its code, and the
  stack's inert lift that #105 found making an ORIGIN box unreachable. Rewrite `Effects.tsx`'s header for marks, and
  drop `panel.test.tsx`'s stale "chip" words with the file (#100's stale words).

Tests first:
- `kindsOf` orders kinds by billing.
- One kind with three plays draws one mark "×3".
- Six kinds on a desktop draw four marks and "+2"; on a phone, three and "+3".
- A live play of a new kind lands at the end, and a live tally never reorders marks.
- The corner sign appears when a play's tally sum passes the post's, and goes when it falls back.
- The notch follows `yours`.
- The accessible names.
- The ghost mark appears only while an armed card can land, and opens the form.
- A post's height is the same with zero and with six kinds of marks (in `e2e/plays.spec.ts`, measured in a browser,
  since jsdom has no layout).

## Task 4. The Lens (engine)

**Files:** `engine/ui/cards/Lens.tsx` (new, from #97's `Panel.tsx`, whose content becomes `PlayRow`),
`engine/ui/cards/lens.css` (from `panel.css`), `engine/ui/glass/Float.tsx` (new: a non-modal glass float placed by
`place.ts`), `engine/ui/thread/Thread.tsx` and `engine/ui/spin/Origin.tsx` (a `LensProvider` per page),
`engine/ui/spin/spun.ts` (`useSpunInto` seeded from the loader's cache), `engine/ui/thread/Post.tsx` (a spin draft per
origin); tests in a new `engine/ui/cards/lens.test.tsx`, `engine/ui/spin/Spin.test.tsx` and
`engine/ui/spin/spun.test.tsx`.

- **`LensProvider`** holds the one open Lens on the page: `{ post, card, opener } | null`. Opening another closes the
  first. `useLensHost()` gives where the Lens renders: the page's body by default, or a takeover's host (Task 5).
- **`Float`** is a glass panel with `role="dialog"` and `aria-modal="false"`. It doesn't dim the page or make it inert.
  On open, focus moves to its open tab. Esc closes it (through the modal layer's Esc stack, so a picker opened from it
  closes first). It never closes on a press outside.
  - Placement on a desktop: beside the post's right edge when the window has the Float's width plus a gutter free
    there; else under the anchor (`placePopover`).
  - Placement under 40em: a sheet on the HUD's top edge, with the post scrolled so its marks sit just above the sheet.
  - It places itself again once a frame on scroll, resize or a change of its own size.
- **The Lens:** the `tablist` of the post's kinds, in mark order, with the arrow keys moving between tabs (roving
  tabindex). Then, for the open tab:
  - **State:** `view.state`, `view.ends`, and `view.report` when set;
  - **Act:** `<Kit>`, when the view gives controls;
  - **Who:** a `<details>`-like disclosure button, "3 plays · Gloomba, Pipewrench, Mrs. Hooligan", that unfolds the
    rows.
- **`PlayRow`** is #97's panel content for one play. Add to it:
  - `view.notes[play.id]`;
  - "More reactions than the post" when its tally sum passes the post's;
  - "Your play" in place of React on the reader's own play.
  
  Rows run by layer, top first, when the card's rules give `stack` above 1, and by billing otherwise. Casters are
  in capitals in the glass's face.
- **Spin thread** from a row closes the Lens and opens the post's spin form for the play (#97's `spinOrigin`). The post
  keeps one draft per origin (`Map<Id, SpinDraft>` in `Post.tsx`), so switching the form between the post and a play
  loses nothing (#100).
- **`useSpunInto`** returns the loader's cached answer synchronously when it has one, so the Who row's count is there
  on the Lens's first frame (#100).
- **The glow** is a `filter: drop-shadow` on the Float's unclipped wrapper, in the tab's ink (#100).
- Delete `Panel.tsx`'s overlay use, its `data-kb-panel` popover and sheet, and the tags' opener plumbing.

Tests first:
- A mark opens the Lens on its tab, and "+N" opens it on the first hidden kind.
- Pressing the same mark closes it.
- Esc and × close it, and focus returns to the mark.
- A press on the post's body leaves it open.
- Opening another post's Lens closes the first.
- Arrow keys move between tabs.
- State shows the view's lines.
- Act draws the view's controls.
- Who is folded, and unfolds to rows in layer order for a stacking card and in billing order otherwise.
- A row's React calls `api.react` with the play's id.
- The reader's own play shows "Your play" and no React.
- Spin thread opens the form named for the play.
- A draft typed for the post survives a switch to a play and back.
- The spun count is present on the first render when cached.
- The Float is `aria-modal="false"` and leaves the page interactive: no element on the page is `inert` while it is
  open. Assert this on a post that stays on screen, never by counting across a document whose posts have gone (#100's
  test that held without its code).
- In an ORIGIN box (a spun thread whose origin post carries plays of two kinds), a mark opens the Lens, every tab and
  every Who row can be reached by keyboard and by pointer, and a row's React works (#105's case, as the Lens draws it).
- The sheet shows under 40em (`data-kb-lens="sheet"`) and the side panel on a desktop (`data-kb-lens="side"` or
  `"under"`).

## Task 5. The takeover: outermost, carrying the marks, hosting the Lens (engine and instance)

**Files:** engine: `engine/ui/cards/Effects.tsx` (`PostEffects` ordering, `marks`), `engine/ui/cards/Lens.tsx`
(`LensHost`). Instance: `instances/divided-world/ui/cards.ts` (`takeover: true` on Stick Around),
`instances/divided-world/ui/stick-around/Effect.tsx`, `instances/divided-world/ui/stick-around/HoldView.tsx`,
`instances/divided-world/ui/stick-around/hold.css`. Tests in `engine/ui/cards/view.test.tsx` and
`instances/divided-world/ui/stick-around/hold.test.tsx`.

- **`PostEffects`** wraps kinds in first-played order as today, except kinds whose `CardUi.takeover` is set. Those wrap
  last, so they are outermost, in their own first-played order. It passes every effect `marks`: a `MarkStrip` for the
  post, which only a takeover draws.
- **`LensHost`** is a context provider a takeover's view puts around its content, naming an element inside its dialog.
  The Lens portals there while it is set, so it is inside the hold's focus scope and not inert.
- **Stick Around** draws `children` exactly once, through `createPortal` into an element it creates and keeps in a
  ref. A layout effect moves that element (`appendChild`) between its place in the thread and the slot in `HoldView`.
  React never unmounts what is inside. `HoldView` draws the post's head with `marks` over the lifted post, and wraps its
  body in `LensHost`.
- **Stick Around's view** (`show`):
  - `progress`: null;
  - `state`: "Holds you on this post until you check the caster's sentence, or break free for this visit" while it
    can hold; "You broke free this visit" after a break; "It will not hold you again" once released; "It never holds
    you: you wrote this post" or "…: you played it" for the author or the caster;
  - `ends`: the hold's way out in a sentence (`WAYS_OUT`);
  - no controls.

Tests first:
- With Stick Around played first and Whoops! after, Stick Around's effect is the outermost element and Whoops!'s ink is
  inside the lifted view.
- A Whoops! effect inside the hold keeps its state across a lift and a release: a reader's stroke made before the lift
  is still washed after it, with the effect mounted once (count mounts).
- The hold shows the marks, and a mark there opens the Lens inside the hold's dialog.
- Hold to scrub works from that Lens.
- Esc in the Lens closes the Lens and not the hold, and a second Esc is a Break free press, as #74 set.
- Stick Around's State in each case listed above.

## Task 6. Whoops!'s view, its controls, its mark and its ink names (instance)

**Files:** `instances/divided-world/cards/whoops/Effect.tsx` (the plate, hint and tool buttons go; `show` and `met` come
in), `instances/divided-world/cards/whoops/names.ts`, `instances/divided-world/cards/whoops/whoops.css`,
`instances/divided-world/ui/cards.ts` (`hint`, `art.mark`), `instances/divided-world/ui/cards/whoops-mark.svg` and
`stick-around-mark.svg` (new, from the faces' art as the mockup's icons draw them); tests in `Effect.test.tsx`,
`names.test.ts` and `instances/divided-world/ui/index.test.tsx`.

- **The view**, published at most once an animation frame while a sweep runs (the effect's existing `REFRESH_MS` pace
  is fine):
  - `progress`: the mean share washed of the inked layers, or null when all are clean;
  - `state`: #97's readout sentence;
  - `ends`: "Ends on your screen when you scrub every layer off. The author can wash it for everyone.";
  - `yours`: the reader is the author and a layer holds ink;
  - `notes`: #97's per-layer lines;
  - `report`: the save's report;
  - `controls`: a `hold` "Hold to scrub" whose `describe` is today's help sentence, with `start`/`stop` being
    `startSweep`/`stopSweep`. For the author, add a `choose` "Your tool" of Wash and Write in ink, which is the
    effect's `tool` state (`useState<'wash' | 'ink'>`, about line 128). The author's stroke is the wash saved for
    everyone, so there is no third option.
- **`met()`** is called on the reader's first stroke on any layer.
- The aria-live "uncovered" and status regions stay in the effect, because they are the post's reading. The visible
  report moves to the view.
- **`inkName(color, names = NAMES)`**:
  - `NAMES` is one table holding the swatches (`SWATCHES`) plus black `#000000`, white `#ffffff` and gray `#808080`.
  - A CSS name keeps its name, as #97 does.
  - Otherwise, convert to OKLCh. Each entry is neutral when its own chroma is below `GRAY_GATE = 0.03`, and chromatic
    otherwise.
  - An ink below the gate takes the neutral entry nearest in lightness.
  - An ink above it takes the chromatic entry minimizing `hypot(0.5 · ΔL, Δh / π)`, with Δh the hue angle's shortest
    difference.
  - Remove #97's HSL pre-checks (`GRAY`, `DARK`, `PALE`). The OKLab conversion is a small pure function in `names.ts`
    with its own test against known values.

Tests first:
- The view's fields for one, two and three layers, partly washed and all clean.
- The author's view has two controls and the reader's one; no view ever has more than two.
- `met` is called on the first stroke only.
- No plate is drawn.
- `inkName`:
  - each swatch names itself;
  - black, white and a mid gray name themselves;
  - "violet" by name stays violet;
  - with the table as it ships: `#6b4423`, `#c08040` and `#3b2a1e` are "orange", `#004400` is "green", `#0000ff` is
    "violet", `#202020` is "black", `#7f7f90` and `#a0a0a0` are "gray", and `#e0e0e0` is "white";
  - the planted case the owner asked for: with a test table that adds `{ name: 'Brown', color: '#7a4a24' }`,
    `#3b2a1e`, `#4a3020`, `#6b4423`, `#806040` and `#8b5a2b` are "brown", while `#c08040` stays "orange", `#004400`
    stays "green" and `#202020` stays "black". Run this first against #97's `inkName` with its swatch list given the
    same Brown: it names `#806040` and `#8b5a2b` "orange", because it weighs hue alone. Record that red;
  - with a test table that adds `{ name: 'Silver', color: '#c0c0c0' }`, `#a0a0a0` is "silver" and `#0000ff` is still
    "violet".

## Task 7. The first-time callout and `cards_met` (SQL, engine)

**Files:** `supabase/migrations/0040_cards_met.sql` (new; use the next free number if one has landed),
`supabase/tests/0045-cards-met.sql` (new; likewise), `supabase/tests/e2e/0003-export.ts` (the fixture row sets
`cards_met`), `engine/ui/data/api.ts` (`Preferences.cardsMet: readonly string[]`, `meetCard(card)`,
`forgetCardsMet()`), `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`, `engine/ui/cards/Callout.tsx` (new),
`engine/ui/cards/Marks.tsx`, `engine/ui/account/Settings.tsx`; tests in `engine/ui/cards/callout.test.tsx`,
`engine/ui/account/Settings.test.tsx` and `web/src/data/supabase.test.tsx`.

- **Migration:**
  - `alter table account_preferences add column cards_met text[] not null default '{}'`, with a check of at most 64
    entries.
  - `meet_card(card text) returns jsonb`: `security definer`, as `signed_in_account()`. It refuses a key not matching
    `^[a-z][a-z0-9-]{0,39}$` with a `kayfabb.refusal`. It adds the key once (an upsert like `set_preferences`) and
    returns the preferences.
  - `forget_cards_met() returns jsonb`: empties the set.
  - Both are granted to `authenticated` only.
  - The 0019 read policy already limits the row to its account. The test asserts it for the new column too.
- **SQL tests first:**
  - a key added twice is kept once;
  - a bad key is refused;
  - another account's row is never written or read;
  - `anon` cannot call either;
  - the 65th key is refused;
  - `forget_cards_met` empties only the caller's.
- **Engine.** The page's first mark of an unmet kind whose `CardUi.hint` is set shows `Callout`. It's a small glass
  bubble off the mark, out of the page's flow, with the card's name in the display face, the hint, and "Got it". Only
  one callout shows on a page at a time, for the kind met first in reading order. "Got it" or the effect's `met()` calls
  `meetCard` and hides it at once (optimistically, kept hidden if the write fails, and tried again on the next read).
- **Settings.** In Accessibility, a "Card tips" row with "Show card tips again" (disabled when `cardsMet` is empty)
  calls `forgetCardsMet`. Plain words, out of character.

Tests first:
- A callout shows for an unmet kind with a hint, once per page, and not for a met kind or a card without a hint.
- "Got it" and `met()` each call `meetCard` once and hide it.
- Settings' button clears and the callout returns on the next read.
- The supabase adapter maps `cards_met` and calls both RPCs.

## Task 8. Stories, shots and the critique's numbers (engine and instance)

**Files:** replace `engine/ui/cards/Tags.board.stories.tsx` and `engine/ui/cards/Plate.board.stories.tsx` with
`engine/ui/cards/Marks.board.stories.tsx`, and add `instances/divided-world/ui/whoops/Lens.board.stories.tsx`; update
`e2e/plays.spec.ts`, `e2e/plate.spec.ts` (renamed or folded into `plays.spec.ts`), `e2e/thread.spec.ts` and
`e2e/glass-ceilings.json` as the stack and plate leave.

- **Stories:** the mockup's post #41 (three Whoops! layers and one Stick Around by a long name), for a reader and for
  the author; the Lens on each tab with Who folded and unfolded; six kinds (with "+N"); an armed card's ghost mark; the
  callout; held by Stick Around with Whoops! opened inside. Each at 1440 and 390.
- **Shots** in the PR, set against `docs/research/2026-10-31-marks-and-the-lens/` (`rest.png`, `lens.png`, `held.png`).
- **The critique's numbers, measured again in `e2e/plays.spec.ts`:**
  - a post with marks adds 0px to its height at 1440 and at 390;
  - the Lens never overlaps its post's body on a desktop wide enough for the side panel;
  - glass text in the Lens meets the floor (`tools/check-glass-contrast.mjs`'s rendered measure already covers the
    Lens once it's in a story).
- Run `.claude/skills/impeccable/scripts/impeccable detect --json` over the changed UI and answer what it finds in the
  PR.

## Last. The full build and the final review

`npm run build` green, with its output in the PR. The final reviewer's charter is the review focus below.

## Ways out of the states this touches

- **The Lens:** Esc, its ×, its mark, another post's Lens, leaving the page. Focus returns to the mark.
- **The callout:** Got it, or first use. Settings' "Show card tips again" undoes it.
- **The hold:** unchanged. A Lens inside it closes back to it.
- **The ghost mark:** disarming the card in the hand.

## Review focus

- **The corner sign and the log.** "More reactions than the post" must never be worded, in the Lens, a mark's name or
  the log, as the settlement's "outdraws". Check that the HUD's live estimate and the log do not now disagree with it in
  a way a player would read as the log lying.
- **The remount.** A Whoops! inside Stick Around keeps its unsaved strokes across a lift and a release on a real browser,
  not only in jsdom. Check that the portal move keeps the canvas, the observers and the `inert` state working after the
  element changes parents.
- **The takeover order and Acts already held.** Posts already carrying Stick Around and Whoops! in either order draw
  the same ink and the same saved author washes after the reordering. A saved state is keyed by play, so nothing should
  change, but confirm it on seeded data.
- **The non-modal Lens and focus.** Tab order from the Lens back into the page, Esc layering with the React picker and
  with the hold, and that a Lens left open while its post scrolls away doesn't hold focus off-screen.
- **A busy page.** A wash in progress redraws one strip and one open Lens, not the page. Many posts with marks cost one
  callout and one Lens at most.
- **`cards_met` and the masks.** No response, refusal or timing of `meet_card` differs with anything but the caller's
  own row. The column round-trips in the export.
- **Ink names.** A future swatch is never pre-empted by a neutral or by a hue rule. Check the OKLab table against each
  shipped swatch and the neutrals.
