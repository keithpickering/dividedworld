Record, written 2026-11-23.

# A dent that bends what lies under the words: design

A design session with the owner on issue #1035: on the front door's post #6 (Feelin' Fab twice under a Steel Chair),
the chair's dent landing made Fab's rainbow disappear instead of being dented. Its plan is
`docs/plans/2026-11-23-dent-bend-plan.md`. It changes how Steel Chair's dent is applied
(`docs/plans/2026-11-16-steel-chair-dent-design.md`, whose dent itself is unchanged) and adds one engine interface.

## 1. The cause, read on `main` at `7816fa1fe`

- `PostEffects` nests the latest play outermost (`nestOrder`, `engine/ui/cards/Effects.tsx`), so a chair played after
  Fab wraps Fab's host and its foil canvas, which fills the content area (`placeLayer`, `engine/ui/cards/body.ts`).
- Once a dent lands, Steel Chair sets `filter: url(#…)` on its own words wrapper, `.dw-chair-words`
  (`instances/divided-world/ui/steel-chair/Effect.tsx`, the `<filter>` and the wrapper near the end of `Chairs`). Its
  region is the wrapper's box plus `DENT_SCALE`. A CSS filter does two things to everything inside the element:
  - **It clips** to the region. The foil, which fills the post bar to bar, is cut to the words' box: on a short post
    that is almost all of it. This is the bug the owner saw.
  - **It makes a stacking context.** The engine's rule (`engine/ui/thread/thread.css`, `.kb-act-main`) is that no
    wrapper is a stacking context of its own, so an effect's layers lie in the content area's. Fab's foil is at
    z-index -1 there, under everything in the body. Trapped inside a filtered wrapper, it would paint in that
    wrapper's place among the positioned boxes, over the signature and the edited note.
- It is not Fab alone: every effect that paints across the content area (Glitter Bomb, Hot Box's tiles, Kick Me, Time
  Machine) is clipped and trapped the same way when a chair is played after it, in a thread, on the front door, in an
  ORIGIN box and in a moment (`MomentEffects` nests by the same `nestOrder`).
- The hit's shake (a transform on the same wrapper for 0.25 s) traps the same layers for as long as it runs.

## 2. Decided

### 2.1 The dent bends the words, and layers that ask to be bent (the owner's pick)

Weighed against:
- **Shade only**: the filter on the words alone; every layer underneath stays whole and unbent, and the dent's own
  shading, which already fills the content area, lies over it. Cheapest, and the owner's fallback if bending costs
  too much (2.4).
- **The issue's proposal**: keep the filter on the wrapper and grow its region to the content area. It ends the
  clipping but not the trapping (the foil would cover the signature), and every effect inside would be filtered again
  on each of its frames.

So the filter leaves Steel Chair's wrapper. The words are filtered in a box of their own, and a layer that fills the
content area is filtered on its own element, which holds nothing but itself, so nothing is trapped and nothing is
clipped beyond the layer's own box.

### 2.2 The words box (engine)

The engine draws the post's words in one element, `<div data-kb-words-box>`, at the place it already names for them:
`plain()` in `PostEffects`, inside the cards that write (so their tails bend with the words) and outside every other
card's effect. `MomentEffects` draws the same box after its writing wraps; `VersionEffects` draws only writing cards
and gains nothing. The box is a plain block: it takes no room of its own and changes no layout. It carries
`filter: var(--kb-bend-words)`. The ORIGIN box, the poll, the edited note, the reactions and the signature are all
outside `PostEffects`, so nothing lifted over ink is in it.

### 2.3 The bend interface (engine), in any play order (the owner's pick)

- Every content area sets `--kb-bend: none; --kb-bend-words: none` (`thread.css`, on `[data-kb-content-area]`), so a
  nested area (an ORIGIN box in a post's body) never inherits the post's bend.
- An effect that bends sets both on the content area it found, inline, through one helper in `engine/ui/cards/body.ts`
  (`setBend(area, bend)`, `bend` null to give it up): `--kb-bend` to a filter in the area's coordinates (its padding
  box's top left, as `bodyBox` measures), `--kb-bend-words` to one in the words box's. The bend is single-owner, as
  `markBrightInk` is: one effect bends an area. Where there is no content area (Stick Around's view lifts the words out
  of every area), the helper sets only `--kb-bend-words`, on the effect's own host, and no layer bends.
- A layer that fills the content area asks to be bent with `data-kb-bend`, which `thread.css` gives
  `filter: var(--kb-bend)`. Placed by `placeLayer` over `bodyBox`, its origin is the area's, so one filter serves
  every such layer.
- Because the bend is set on the area and inherited by everything in it, a layer bends whether its card was played
  before the chair or after it: a dented post looks the same however it got there. Weighed against a bend that reached
  only what the chair wraps (the nesting order), which would lay an unbent foil over a dented post when Fab came second.

The engine names no card: the interface is two custom properties, one attribute, and the helper.

### 2.4 Fab is bent only if it is cheap enough (the owner's gate)

Bending the foil re-runs the displacement over the content area each time the foil redraws (up to 30 a second, at
least a quarter of that: `paintShare`). That is what a busy instance pays on every dented Fab post in view, so it is
measured before Fab asks to be bent:

- **The page**: the Shine busy page (`instances/divided-world/ui/Shine.board.stories.tsx`, sixteen shiny posts), with
  a Steel Chair on every Fab post, scrolled as `e2e/shine.spec.ts` scrolls it, CPU throttled ×2.
- **The runs**: eight with the foil bent and eight shade-only, alternating, on one machine.
- **The bar**: the foil is bent only if the 95th percentile of the gap between animation frames with the bend is
  within 10% of the shade-only page's. Otherwise the foil does not ask to be bent, and the dent's shading over it is
  the whole of its dent (2.1's fallback).
- Either way the figures are written to `docs/research/2026-11-23-dent-bend/`, and the shine spec's `shine-data` line
  logs the bent page's frame gap from then on, logged and not asserted, as the frame gap has been since #318.

The interface ships whatever the gate says: the words need it.

### 2.4a Fab is the only layer that bends (the owner, after review)

Feelin' Fab is the only effect that should be dentable for now: a foil is a surface, and a dent in a surface bends it.
Hot Box's smoke, Glitter Bomb's glitter and Time Machine's effect would naturally lie above a dent, so none of them
asks to be bent; each is no longer clipped by it. Time Machine blocks new effects while it is active anyway. A tiled
layer that is ever bent would put `data-kb-bend` on the tiles' container, which fills the area.

The owner named a richer interplay as out of scope here, to be taken up once this work lands: a chair clearing Hot
Box's smoke as the cursor does, and a chair's impact sending Glitter Bomb's glitter flying.

### 2.5 The shake moves to the content area

The hit's 4 px shake is set on the content area (an attribute of Steel Chair's, `data-dw-chair-shake`, beside the
room's mark), or on the host where there is none. The area is already a stacking context (`isolation: isolate`), so a
transform on it traps nothing new, and the whole post shakes, foil and all.

## 3. The rules

- **Layers.** Engine: the words box, the two properties and their reset, `data-kb-bend`, `setBend`. Instance: Steel
  Chair's two filters and its shake; Fab's `data-kb-bend`, if the gate passes. The engine names no instance.
- **Private facts.** Nothing is read but the plays' ids and the post's own boxes; no response, payload, Realtime event
  or timing is added.
- **States.** None is added. A dent still ends with its play.
- **An effect fills the post.** Restored: a layer under a dent fills its content area border to border again; the
  dent bends what lies in that area and clips nothing.
- **Accessibility.** The words stay readable and selectable; reduced motion has no shake and full dents at once, as
  now; forced colors still hides the shading and keeps the bend.
- **Safari.** Where `filterTrusted()` is false neither filter is drawn, as now.
- **Scale.** The words' filter is what it is today. The layer's filter is the gate's subject (2.4).

## 4. Open

- **Two benders on one area.** Only Steel Chair bends. A second card that bends would need the properties to hold a
  list; the helper's single owner is where that is decided.
