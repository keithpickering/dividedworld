# Kept layers: the plan

Record, written 2026-11-20. Carries out `docs/plans/2026-11-20-kept-layers-design.md`. Two tasks, in order, each test first with its
red run. Engine code only (`engine/ui/glass/`), plus one e2e spec. No interface is added or changed, and no instance's code changes.

## Task 1. The presets mark a surface, and the mark keeps its layer

Model: inline

- **Presets** in `engine/ui/glass/motion.ts`:
  - `MotionProps` gains `readonly 'data-kb-layer'?: 'kept'`, with a comment that it marks a surface whose layer is kept (the design,
    section 2).
  - `overlay`, `modal`, `screen` and `swap` return it as `'data-kb-layer': 'kept'` beside their motion. Under Off they still return
    `{}`.
  - No other preset carries it: not `crossing`, `crossingPinned`, `backdrop`, `staggerItem`, or a card's (`lift`, `toHand`, `deal`,
    `fanDeal`, `turn`, `beat`, `pulse`).
  - The module header gains a paragraph on the kept layer: why, which presets carry it, and why the crossing does not (#835).
- **`trimmed`** in `engine/ui/glass/layer.tsx` already spreads the preset's other keys, so the mark reaches the dialog's box. Its
  header comment says so.
- **CSS** in `engine/ui/glass/base.css`, beside the smoke layer's rule: `[data-kb-layer='kept'] { will-change: transform; }`, with a
  comment that names the blank frames, the containing block it makes for fixed descendants and the stacking context.
- **Tests first** in `engine/ui/glass/motion.test.tsx`, a `describe('the kept layer')`:
  - `overlay`, `modal`, `screen` and `swap` carry `'data-kb-layer': 'kept'` under both feels.
  - The crossing (both forms), the backdrop, a stagger item and the card presets never carry it.
  - Under Off every preset is `{}` (the existing test still holds).
  - Red: the four presets carry no mark.
- **Test first** in `engine/ui/glass/layer.test.tsx` (or the Overlay or Float test, wherever a box is rendered under a feel): a float's
  box rendered under Smooth has `data-kb-layer="kept"`, and under Off has none. Red: no mark.

## Task 2. The layer survives the end of an entrance, in a browser

Model: inline

- **Spec** `e2e/kept-layers.spec.ts`. Its header says what it proves (the box's compositor layer is not rebuilt when its entrance ends:
  the cause of the blank frames on Android, design section 0) and what it cannot (headless Chromium does not draw the blank frames).
- **How it reads layers.** A CDP session with `DOM.enable` and `LayerTree.enable`. It finds the layer whose `backendNodeId` is the
  surface's element (`DOM.describeNode` on the element's handle gives its `backendNodeId`). The layer is read once the entrance is
  under way (the box mounted and animating) and again once `settled` (e2e/settled.ts, `{ loops: true }`) says it is at rest, plus
  300ms. The test asserts the same `layerId` both times.
- **Cases**, each under Smooth and under Snappy (`data-kb-motion="full"`, `data-kb-motion-feel` on the root, as the probes set them):
  - The Lens, at 390 by 844 and at 1440 by 1000: the story `boards-01-lens--five-kinds`, closed with Esc, reopened from its mark with
    Enter.
  - A glass screen change: the Menu opened from `/b/general`, then another menu tab pressed. The surface is the arriving
    `.kb-glass-screen`.
- **Red**: the CSS rule of Task 1 commented out, the Lens case fails under Smooth with the box's layer gone. Recorded in the PR.
- **Run** with `node tools/test-e2e.mjs e2e/kept-layers.spec.ts`. The existing board-look specs (`e2e/board-snapshot.spec.ts`,
  `e2e/lens-frame.spec.ts`) are run too, since a stacking context or a containing block could move what they measure.

## After the tasks

- The full `npm run build`.
- A draft PR, so Netlify builds the branch's deploy preview. The owner opens the Lens on their phone there, under Smooth, and says
  whether the blank frames are gone. The PR waits on that.

## Review focus

- A fixed descendant inside a kept surface. None was found at rest (design, section 2). A card's effect or a tip that draws a fixed
  element inside a screen, a dialog or the Lens would now be placed against that surface, not the window.
- A stacking context on a screen or a swap's panel. A child's `z-index` that was meant to rise over something outside the surface (a
  sticky bar, a tooltip not portaled) is now confined to it.
- The cost at a busy instance: one kept layer per surface on the screen, never per row, per post or per Act.
- An element that leaves (`Leaving`, held for its exit) still carries the mark while it animates out, and the mark goes with the
  element when it unmounts.
