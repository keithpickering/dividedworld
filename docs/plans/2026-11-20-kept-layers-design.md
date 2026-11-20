# Kept layers: no blank frame when a surface lands

Record, written 2026-11-20. A short design session with the owner, started from their report: "UI elements will often flicker to 0
opacity for a frame after the end of their transition in. Easiest place to see this is the Lens." The plan is
`docs/plans/2026-11-20-kept-layers-plan.md`.

## 0. What was found

- **The video.** A screen recording from Brave on Android (60fps) shows the Lens opening under Smooth. About 380ms in, which is
  Smooth's `enter`, two frames show the Lens's ground and border with nothing inside: no smoke, no tabs, no words. Then it is whole
  again. Nothing faded: an opacity of 0 would show the post under the Lens, and these frames show the Lens's own dark ground.
- **No style goes back to 0.** Every write to the Lens's inline style and every running animation, sampled each frame in Chromium,
  says the box is at opacity 1 from the end of its entrance on. Motion commits the final value and then cancels its animation
  (`NativeAnimation` in `motion-dom`), in that order.
- **What happens is a layer rebuild.** During the entrance the box has a compositor layer of its own (it animates opacity, filter and
  transform). Its smoke layers (`will-change: transform`, `base.css`) and the words drawn over them sit in layers inside it. When the
  entrance ends, Motion cancels the animation, the box no longer needs a layer, and Chromium destroys it and regroups what it held
  into new layers (CDP `LayerTree`: at 448ms the box's layer is gone and two new layers are made). Chrome on Android can draw a frame
  before a new layer's tiles are drawn, so those frames show only what lay under them: the box's ground.
- **What stops it.** With `will-change: transform` on the box, no layer is destroyed or made at the end of the entrance. With
  `will-change: opacity` or `will-change: filter`, the box's own layer survives, but what it holds is still regrouped.
- **It costs the words nothing.** A layer kept with `will-change: transform` can be left drawn at the scale it first had, and Smooth
  starts the box at 0.98. The Lens's tab strip captured at rest, with and without it, differs by at most 2 of 255 in any pixel.
- **The same happens elsewhere.** Opening the Menu rebuilds layers when its screen's entrance ends: the page head, the panels and the
  world.

## 1. The decision: surfaces keep their layer

The owner chose, of three:

- **Surfaces (chosen).** Each whole surface a motion preset enters keeps its layer for as long as it is on the screen: an overlay's
  box (and so the float's and a tooltip's), a modal's box (and so the pack opening's), a glass screen as it changes (`screen`), and a
  swap (`swap`: a screen body's and the roster's panel). It is one layer per surface on the screen, so a busy instance costs no more
  than a quiet one.
- Dialogs only. Smaller, and screens would still blink.
- Every animated element, the staggered entrants too. Up to `MAX_ROWS` (60) kept layers on a long log, each holding GPU memory for as
  long as the page is up. Refused for that cost.

Staggered entrants (a page head, its panels, its rows: `enter.ts`) keep losing their layer when they land. If they blink on a phone,
that is a follow-up with its own measurement.

## 2. How a surface keeps it

- **The presets say it.** `overlay`, `modal`, `screen` and `swap` (`engine/ui/glass/motion.ts`) add `data-kb-layer="kept"` to the
  props they return, beside `initial`, `animate` and `exit`. Every caller already spreads a preset onto the element that moves, so
  each surface is marked with no code of its own, and a surface added later is marked by using the preset. Under Off a preset returns
  `{}`: nothing animates, nothing is rebuilt, and nothing is marked.
- **The CSS keeps it.** `[data-kb-layer='kept'] { will-change: transform; }` in `engine/ui/glass/base.css`, beside the smoke's own
  `will-change`. When the feel is changed to Off, the mark goes and the layer goes with it, once.
- **Why transform.** Of the three properties, only `transform` stopped the regrouping (section 0).
- **What it changes besides the layer.** `will-change: transform` makes the element a containing block for `position: fixed`
  descendants and a stacking context. A scan of the running app at rest found no fixed descendant in a screen, a roster panel, the
  Lens or a dialog box. The pack opening's fixed element (`.kb-opening-layer`) is the dim around its box, not inside it. A surface
  that gains a fixed descendant later would be its containing block, which the plan names for review.

## 3. What is left out

- **The crossing.** The world a glass page crosses into (`crossingPinned`, `.kb-world`) holds the page's fixed smoke, and on the board
  side the HUD, the drawer, the vignette and the toasts. A kept transform would make the world their containing block. Holding its
  layer another way does not help either: Smooth's crossing blurs the world, the blur contains the fixed smoke for the crossing, and
  when it ends the smoke is released and rebuilt whatever is kept. That needs a change to the crossing itself:
  [#835](https://github.com/keithpickering/dividedworld/issues/835).
- **The dim** (`backdrop`) has no layers inside it and was not seen to blink.
- **Motion's other presets** (`lift`, `toHand`, `deal`, `turn`, `beat`, `pulse`) move a card, not a surface.

## 4. How it is proven

- Headless Chromium does not draw the blank frames, so no test here sees them. It does show the rebuild, which is the cause, through
  the layer tree. The e2e test asserts the box's layer survives the end of its entrance, and runs red without the CSS.
- The owner checks the Lens on their phone, in the branch's deploy preview, before merging.

## 5. The rules

No Act, post, character, response or private fact is touched. The change is engine code only, and no instance's code changes.

## Open

- Whether staggered entrants blink on a phone (section 1).
- The crossing (#835).
