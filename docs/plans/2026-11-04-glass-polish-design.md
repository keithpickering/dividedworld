# The glass, polished: design

Record, written 2026-11-04. Made with the owner in a design session after the owner first saw dw.gripe running in
private testing. The plan is `docs/plans/2026-11-04-glass-polish-plan.md`. It is one design with three phases, built
and merged in order: the glass's layout, the board meeting the glass, and motion.

## 0. Where it starts

On main at 3905bb7, seen in the demo world (`npm run dev:web`) at 1400px and on an iPhone 13:

- **The calm's feather spills.** `.kb-calm::before` (`engine/ui/glass/calm.css`) is inset by
  `calc(var(--kb-glass-calm-feather) * -1)`, so each backing is drawn 32px outside its element. Nothing in the layout
  makes room for it, so it lies over a neighbor, and an ancestor that clips its overflow cuts it straight (phone
  Settings, at the right edge).
- **The HUD's clouds are a different scale.** `instances/divided-world/ui/glass.json` gives the `hud` recipe
  `frequency: [0.0042, 0.016]` and the pages `[0.0022, 0.004]`. The HUD's clouds are about half as wide and a quarter
  as tall, so they read as small and flattened beside the menu's.
- **Phone headers collapse.** `.kb-characters-head` is a flex row with no wrap. Its 96px title is `flex: none`, so the
  lead (`.kb-characters-lead`) is laid out 0px wide and 547px tall, off-screen: the empty band of smoke at the top of
  phone My characters. Every glass screen writes its own head, so each has its own version of this.
- **Buttons do not agree.** The engine has 36 separately styled skewed controls (each a class beside
  `kb-glass-skew`), each with its own type size, height and padding. The Reveal modal's Cancel and Reveal are two of
  them side by side. On a phone a control is 48px tall at a large size, so most rows break to one control a line.
- **Vending's slots overflow.** In a slot about 95px wide the postcard's face, the code and price tag and the info
  button overlap: names are cut ("STIC… AROUND", "MAI… EVENT") and tags sit on the art. The marquee reads
  `[Machine name]`, the placeholder in `instances/divided-world/ui/index.ts`.
- **The board reads small.** `--kb-size-body` is 0.75rem (12px), against the glass's 21px body. Beside the HUD it
  reads as a mistake, not as 2003.
- **The roster is a grid of tabs.** Choosing a character updates a panel far below the grid on a phone, and nothing
  says the two are connected.
- **Almost nothing moves.** Toasts and the HUD tour's spotlight use Motion (`motion/react`, already a dependency);
  everything else appears and disappears.

Out of this design: a new account has no Aura, so a lone tester cannot earn any. That is Task 11 of
`docs/plans/2026-11-02-onboarding-plan.md` (the starting grant), designed and never built (no `account_grants`, no
`'grant'` wallet event). The owner starts a build session on that task; it needs no new design.

## 1. The calm feathers inward

**Decided** (the owner: "Agreed with A, I'd also consider a little bit more padding than blur radius, so there's a bit
of full-opacity actual padding"): the calm is drawn inside its element's own box. Its backing has `inset: 0`, and its
mask ramps from transparent at the edge to full over the feather. The element carries padding of the feather plus a
pad (`--kb-glass-calm-pad`), so its text stands on the full-opacity interior with a margin of solid calm around it.
The starting numbers are a 32px feather and a 12px pad, and on the phone layout a 20px feather and a 10px pad. They
are tokens, to be tuned once seen.

Because the calm is now inside its box, it can neither lie over a neighbor nor be cut by an ancestor's overflow. The
contrast model does not change: text still stands in the full-strength interior. The rendered measurement already
reads the interior from the backing as drawn (`e2e/glass-text-page.ts`, `calmOf`), and the layout check (section 3)
refuses a backing drawn outside its element.

Weighed: keeping the outward feather and reserving a margin for it, with a check against clipping ancestors (every
future layout must remember the margin); hard-edged panels everywhere (loses the soft look the owner likes).

## 2. Shared parts: one head, one button, one row

**Decided** (the owner, "Agreed with A"): the engine gains three parts, in `engine/ui/glass/`, each drawn in the
instance's tokens:

- **`PageHead`**: title, optional eyebrow, lead and actions. The lead sits beside the title while it keeps at least
  about 18em, and goes under it otherwise. Every glass screen's head is one of these.
- **`GlassButton`**: one skewed control, as a `<button>` or a router link, with three kinds (`primary`, `secondary`,
  `quiet`) and two sizes (`m`, `s`). Its height, type and padding are tokens. On the phone layout `m` is 40px tall
  (the owner: "40px should be fine, still tappable without being massive") in the 17px phone body, so two or three fit
  a 390px row. All 36 existing skewed controls become one of these. A control that is a game piece (the Hand button,
  a class chip, an orb) is not a button of this kind and keeps its own look.
- **`ButtonRow`**: a row of `GlassButton`s at one height, inline until they do not fit, then wrapping as a whole row,
  never splitting one control's label.

## 3. A layout check across the glass

**Decided** (with section 2): a browser check that walks every glass screen and dialog the rendered contrast
measurement already visits (`e2e/glass-text.spec.ts`'s list, moved to a module both read), at 390px, 834px and
1440px, at text sizes 100, 125, 150 and 200. It refuses:

1. **a squeezed block**: an element holding text narrower than 10em of its own font size, or narrower than its longest
   word;
2. **an overflow**: anything outside the viewport's width, except inside an element that scrolls on purpose (the menu
   bar's tab list, a carousel's track);
3. **a mismatched row**: two `GlassButton`s in one `ButtonRow`, or two adjacent controls in one flex line, whose
   heights or computed type sizes differ;
4. **a cut control**: a control whose box crosses into the cut corner of the `clip-path` polygon of the panel it sits
   in;
5. **a calm outside its box**: a `.kb-calm` backing whose drawn rect goes past its element's border box.

Like the contrast measurement, its judgment is pure functions over plain facts (`e2e/glass-layout.ts`), driven red by
one poison per refusal in a Vitest self-test. The spec only gathers facts in the page. The Vending slots, the Reveal
modal's buttons and the phone heads get fixed because this check refuses them.

## 4. My characters is a carousel of tabs

**Decided** (the owner, "Agreed with A"): the roster is one row, the carousel the class cards already use, at every
width. The class cards' behavior (as many as fit, the next peeking under a fade, arrows and a count, the chosen card
scrolled whole into view and gliding, at once under Off) moves into one engine part, `engine/ui/glass/Carousel.tsx`.
It has two roles: the class cards' `radiogroup` and the roster's `tablist`.

- Each character is a `tab`. The selected character's panel is its `tabpanel`, labeled by the tab, directly under the
  row.
- **New character** is the row's last card. The empty slots fold into its line ("You have 4 open slots"), so no blank
  cards are drawn.
- A full roster has no New character card, and the panel's foot says, as now, how a slot is freed.

Weighed: a carousel on phones only (two layouts, and a full desktop grid of six has the same problem); keeping the grid
and scrolling to the panel (still does not read as tabs).

## 5. The Vending Machine's shelves

**Decided** (the owner, "Agreed with A"): each slot shows its postcard's face behind the glass, scaled down as a whole,
so its name always fits as the full card lays it out. The code, price and info button move onto the shelf's edge
under the slot, as a real machine prices its rows. On the phone the shelf edge keeps code and price and the info
control is an icon button (named in words for a reader).

**The marquee** (the owner: "a list of strings we could randomly pick from on each load"): `UiCopy.shopName` stays
one plain name, the one the log ("From the Vending Machine, for 1.00.") and the machine's group label use, because
the log speaks plainly. A new `UiCopy.marquees?: readonly string[]` is decoration. One is picked at random each time
the Vending screen mounts and drawn on the marquee, which stays `aria-hidden` art. With no list, the marquee shows
`shopName`. `instanceUiProblems` refuses an empty list, an empty string, and an entry over 20 characters (the
marquee's width at 390px). Divided World's `shopName` becomes "Vending Machine", and its list is the twelve below,
which the owner approves in the PR:

`[MACHINE NAME]`, `AURA-MATIC 3000`, `VEND-ETTA`, `THE CARD SHARK`, `POSTCARD PALACE`, `COIN-OP KAYFABE`,
`MERCH TABLE`, `CHEAP POP`, `FINISHER FRIDGE`, `GIMMICK DISPENSER`, `HEAT LAMP`, `NO SNACKS, ONLY CARDS`.

None claims anything untrue about the machine (CLAUDE.md, "The fiction may lie; the log never does": the glass's copy
may joke but never bluffs).

## 6. One field of clouds

**Decided** (the owner: "keep the current position of the clouds between screens but transition the colors
smoothly"): the smoke is one field, in the viewport's coordinates, and every surface is a window onto it.

- **The field's shapes are shared.** `GlassTheme.smoke.field` holds the layers' noise (frequency, octaves, seed,
  alpha row, blur) and each layer's drift (seconds and travel; layers drift at different rates for depth). It also
  holds `narrow`, the field below 600px. Every surface's recipe gives only each field layer's color and opacity (0
  leaves the layer out on that surface), with its `calm` and `calmAll` as today.
- **Each layer's noise is rasterized once** per field and width class, at the viewport's size: an SVG of the layer's
  feTurbulence, through a color matrix of white with the layer's alpha row and its blur, drawn to a canvas and kept as
  a `blob:` URL (`img-src` already allows `blob:`, `web/headers.ts`). A surface draws each layer as an element whose
  `mask-image` is that image and whose `background-color` is the recipe's color at its opacity. The filter runs once,
  not every frame.
- **Windows line up.** A surface's layers are sized to the viewport and offset by the surface's own position, so the
  HUD's tab, the hand drawer, a glass page and an overlay all show the same clouds in the same place. The drift is one
  clock: each layer's animation is started at a negative delay taken from the time since the page loaded, so a
  window that mounts later is in phase with one already drawn.
- **Colors cross-fade.** Moving between glass pages keeps `Page` mounted (`web/src/App.tsx` renders one `GlassPage`
  for every glass route), so a surface change transitions each layer's `background-color` and opacity over the motion
  feel's screen duration (section 9), at once under Off.
- **The HUD is the menu's scale.** The HUD's tab now shows the page field. The menu opening (section 9) widens that
  window to the screen and leaves the clouds where they are.
- **Smoke Low and Off, and High contrast,** work as today: Low draws each layer at a third of its opacity, Off draws no
  layer, and High contrast keeps the smoke to the screen's edges.
- **Cost.** Moving a masked element is composited, so adding a depth layer costs memory, not filter time. The guard caps
  the field at 4 layers (3 narrow) and the rasters at the viewport's size times the device pixel ratio, capped at 2.
  A frame-time measurement of the field story at 390px and 1440px with the drift running is reported in the build's
  PR, not gated, because frame times in CI are noise.

The contrast model keeps its math: a recipe's layers are the field's layers in its colors and opacities, composited
at full noise. Every recipe's worst pixel is recomputed and `e2e/glass-ceilings.json` rewritten, and the numbers the
self-test pins change with the data.

Weighed: matching the scale only, with each surface keeping its own clouds (nothing carries across a crossing); one
field in one color (loses each screen's own palette, which the owner likes).

## 7. The board, at 1.25

**Decided** (the owner, "Agreed with A"): every board size token is scaled by 1.25 (`--kb-size-body` 0.9375rem, 15px),
so the 2003 proportions hold. The column, `--kb-board-max`, goes from 960px to 1200px with it, so a line holds about
the same number of words.

Scaling the column with the type keeps Whoops!'s fixed layout. `REF_WIDTH` in
`instances/divided-world/cards/whoops/scrub.ts` is derived from the board's column and its 12px type. With both
scaled by 1.25 it is the same layout in proportion, and a stroke kept in widths of it lands where it was drawn. Only
the 1px table borders do not scale, a 0.05% shift. The derivation's constants become 1200 and 15.

## 8. Posts and the vignette

**Decided:**

- **Posts stay one table**, with a 4px double rule between them (`border-bottom: 4px double var(--kb-rule)` on
  `.kb-act`). The owner tried posts as separate boxes with a gap and found them "too non-2003", and chose the double
  rule: "go with A, nice idea".
- **A vignette** over the board, under the HUD (the owner: "Vignette helps a lot"). It is the glass's violet laid
  toward the edges of the window, strongest at the foot above the HUD, so the HUD's glow seems to fall onto the page.
  The board's text column is untouched, so the board's contrast is unchanged. It is drawn from instance tokens
  (`--kb-vignette-*`) in both board modes, where on white on black it reads as a glow. It is off under High contrast
  and does not move.

## 9. Motion

**Decided** (the owner: "B is what I had in mind but it's worth a prototype, we could even provide both as distinct
levels of the existing motion settings"; and on naming: "If Reduced basically means Off for us, we could just call it
that").

**The setting.** Settings › Accessibility › Motion offers **Follow my device · Off · Smooth · Snappy**. Follow my
device is Smooth, or Off where the device asks for reduced motion. The stored values are `system`, `reduce` (shown as
Off), `full` (shown as Smooth; a saved `full` is unchanged) and a new `snappy`. The sentence under it says that Off
stops every animation and that a card's effect still happens, instantly. Off is exactly today's reduced: no animation
or transition runs in the glass. That matches the code today, where every one under reduced is `none`. The root keeps
`data-kb-motion` as today (`reduce`, or `full` for both Smooth and Snappy, so every existing selector holds) and gains
`data-kb-motion-feel` (`smooth` | `snappy`).

**One choreography, two feels.** What moves, in what order and in which direction is the engine's, written once
(`engine/ui/glass/motion.ts`). A feel is a set of tokens:

- **Smooth** (the owner's choice for the default): about 300–450ms, eased; enters fade in with a slight scale and
  blur-in; exits a little faster.
- **Snappy**: about 120–220ms; springs with a slight overshoot where a thing lands; masks wipe along the glass's skew
  (`clip-path` along `--kb-glass-skew`).

An instance may set either feel's tokens in `glass.json` (`motion`). The engine's defaults stand where it does not.

**The choreography:**

- **The crossing.** The menu grows out of the HUD: the glass page's window opens from the HUD tab's rect to the
  screen, and the field behind it stays still. Back to the board reverses it, the page closing back into the HUD's
  bar. Esc during either reverses it from where it is.
- **Between glass screens.** The outgoing content leaves toward the side of the tab being left, the new content enters
  from the side of the tab chosen, and the menu bar's selected tab glides to its new place.
- **Overlays and modals** (`Overlay`, `Float`, `Modal`, the hand drawer): they enter by the feel's mask from their
  anchor, the board behind dims in step, and every exit plays.
- **Entrances stagger.** A screen's head lands, then its panels, then their rows, about 30ms apart, capped so the last
  lands within the feel's screen duration whatever the count (a busy log enters as fast as an empty one).
- **The roster's panel** changes with the feel's swap when another character is chosen.
- **The board does not move.** It is 2003. The vignette and the HUD are the glass's.

**What motion may never do.** An exiting tree is `inert` and `aria-hidden` from its first frame, so neither a keyboard
nor a reader nor a test finds two of anything. Input goes to the entering tree at once, and no animation waits for a
response. Focus moves as it does today, at the start of the transition and not at its end.

**The prototype first.** One story plays the crossing both ways, a screen change, an overlay, a modal, a staggered
screen and the roster swap, with a switch between Smooth and Snappy. The owner tunes the tokens there in review
before the screens take them on.

Weighed: Snappy alone (the session's first recommendation; the owner preferred smooth and asked for both); a separate
"Animation style" setting beside Motion (a second row to explain); Motion's own View Transitions for the crossing (the
two worlds are different trees, and Motion's presence already holds exits in this codebase).

## 10. The rules

- **The masks** (CLAUDE.md, "A response never proves a private fact"). Nothing here reads a private fact. The marquee
  is picked on the client, at random, for no one in particular. Every duration and delay is a constant of the feel and
  the count of elements drawn, and no animation starts on, or waits for, a server's response. So a refusal or a
  success cannot show a different timing for a different owner.
- **Ways out** (CLAUDE.md, "No player is ever stuck"). No state is added. A transition in progress never holds input:
  the entering tree takes input at once, and Esc reverses a crossing from wherever it is.
- **Accessibility** (CLAUDE.md, "An accessible path costs what the obstacle costs"). UI motion is not a game obstacle:
  Off removes it. A card's effect keeps its own accessible path, as today.
- **The layers** (CLAUDE.md, "KayfaBB never knows which instance it runs"). The calm, the parts, the layout check, the
  carousel, the field's renderer and model, the vignette's drawing, the motion setting and the choreography are the
  engine's. The field's shapes and colors, the feel tokens, the vignette's colors, `shopName` and `marquees` are the
  instance's, carried by `GlassTheme` (`smoke.field`, `motion`), the theme's `--kb-vignette-*` tokens and `UiCopy`.
- **Portable** (CLAUDE.md, "Portable by construction"). The motion setting's new value is a migration
  (`account_preferences.motion` and `set_preferences`), and the export round-trip carries it as it carries the column
  today.

## Open

- The calm's pad and feather, the field's layer count and drift rates, the vignette's strength, and both feels' tokens
  are starting numbers, to be tuned once seen.
- Whether Snappy is worth keeping is the prototype's to answer. If the owner drops it, the setting goes back to three
  choices and the stored `snappy` reads as Smooth.
