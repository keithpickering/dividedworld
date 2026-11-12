Record, written 2026-11-12.

# One outline for every card type: design and plan

A design and its plan in one file, built in the same PR, on the owner's word ("let's design and plan and build it here
without a separate plan PR if it's quick"). It redraws section 9 of `docs/plans/2026-11-11-card-types-design.md`, which
stays as written.

## Why

The card types' design made the frame say the type: a Cast's solid frame, a Set's double frame with a folded corner, a
Use's dashed frame. As built, each type's lines were drawn a different distance outside the card's box, so three cards
of one size were three sizes to the eye (the owner: "the cards actually vary in width/height and border radius now"):

| Type | Its outermost line | Past the box | Outer corner |
|---|---|---|---|
| Cast | a 1.5px shadow ring | 1.5px | radius + 1.5px |
| Use | a 2px dashed border on a box 3px out | 3px | radius + 3px |
| Set | a second 1.5px ring on a box 5px out | 6.5px | radius + 6.5px |

The boxes themselves were always equal (`border: 0`); only the drawn lines differed.

## Decided

**Every type has one outline, and a type is drawn inside it.** The outline is the ring a Cast already has: 1.5px
outside the card's box (2px on the sheet), so a Cast, the card back and the layouts that hold cards do not move.

- **Cast:** that ring, solid. Unchanged.
- **Set:** that ring, and a second line of the same width inside the card, on its border. The gap between the two is
  three tenths of the border and never under 1.5px, so the second line ends inside the border at every size (at the
  slot: the border is 4.3px, the line ends 3px in) and never reaches the canvas. The folded corner stays.
- **Use:** the ring dashed. The solid ring is not painted and a dashed border is laid where it was, its outer edge and
  corner on the ring's. The border stays 2px (3px on the sheet), since a 1.5px border is floored to 1px at a pixel
  ratio of 1; the extra half pixel is inward.
- **The glow is every card's.** A Use used to lose its size's glow and shadow with its ring (its rule replaced the
  whole `box-shadow`, and came after the fan's and the sheet's). The ring's color is now a variable, and a Use sets
  only that.

Weighed and turned down:

- **Every line inside the card's box, none outside.** The same outline for all, but it moves a Cast and the back in by
  the ring's width everywhere a card is shown, for nothing a player would see.
- **The same reserved space around every card, lines left where they were.** It fixes spacing in a layout and leaves
  the three outlines three sizes, which is the thing the owner saw.

- **A rule that restyles a card's shadow reads the card's ring.** Two rules outside the card's stylesheet painted a solid
  ring of their own (the machine's drop tray, a pack's hit pull), which sat under a Use's dashes before this change and
  would have gone on doing so. They now paint `0 0 0 var(--kb-pc-ring) var(--kb-pc-ring-color)`, and a test in each layer
  holds every stylesheet to that.
- **A hit pull turns the whole frame gold.** The frame's color is one variable, `--kb-pc-line`, read by the ring, a
  Set's second line and a Use's dashes; the hit sets it, where it used to recolor the ring alone.

## Rules it touches

- Engine: `engine/ui/cards/postcard.css`, and the pack reveal's hit ring in `engine/ui/vending/opening.css`. Instance:
  the drop tray's card in `instances/divided-world/ui/vending/vending.css`. Both read the card's own custom properties,
  as an instance's stylesheet already reads `--kb-card-color`; no new interface.
- No state, response, payload or timing is added, so there is no way out to name and no mask to hold.
- Accessibility: the type is still said in words in each card's name (`cardLabel`), and forced colors keep both lines
  (the Set's second line as a border, the Use's dashes in the system's text color).

## Open

- An armed Use shows the armed state's solid ring with its dashes over it, as before this change. Whether an armed Use
  should keep reading as dashed is a question for the armed state, not for the outline.

## Plan

### Task 1: the outline

Model: inline

Files: `engine/ui/cards/postcard.css`, `engine/ui/cards/postcard.test.tsx`, `e2e/card-frames.spec.ts` (new).

1. Test first, in the browser (`e2e/card-frames.spec.ts`): on the Vending Machine's moment, whose slots hold every
   type, read each card's outermost drawn line from computed style (its own ring, or its `::before`'s border or ring)
   and assert that every type's reaches as far past the box as a Cast's and has a Cast's outer corner; that a Use is
   dashed with no solid ring painted; that a Set keeps the solid ring and its second line's box is inside the card. Its
   red run is on the reach (a Use's 3px against a Cast's 1.5px).
2. `postcard.css`: `--kb-pc-ring` (1.5px; 2px on the sheet) and `--kb-pc-ring-color` on `.kb-postcard`, read by the
   three sizes' `box-shadow`; the Set's `::before` inset by the gap plus the ring, with the radius less that inset; the
   Use's `::before` at `inset: calc(-1 * var(--kb-pc-ring))` with the radius plus the ring, and
   `--kb-pc-ring-color: transparent` in place of its `box-shadow`.
3. `postcard.test.tsx`: the stylesheet test of the frames reads the new rules (the ring's width is never under 1.5px,
   no line starts a fixed length outside the card).

### Task 2: the rules that paint a ring of their own

Model: inline

Added in the build, from the quality review (a plan gap: the plan's first form named `postcard.css` alone).

Files: `engine/ui/vending/opening.css`, `instances/divided-world/ui/vending/vending.css`,
`engine/ui/cards/postcard.css`, `engine/ui/cards/postcard.test.tsx`, `instances/divided-world/ui/index.test.tsx`.

1. Tests first: in each layer, every stylesheet but `postcard.css` is read, and a rule on `.kb-postcard` whose
   `box-shadow` has a ring (no offset, no blur, not inset) must paint it as
   `0 0 0 var(--kb-pc-ring) var(--kb-pc-ring-color)`. Red on the two rules above.
2. `--kb-pc-line` on `.kb-postcard`, read by `--kb-pc-ring-color`, the Set's second line and the Use's dashes; the
   two rules read the ring, and the hit sets `--kb-pc-line`.

## Review focus

- The outline at the sizes the browser test does not hold (phone, fan, sheet): they share the slot's rules through
  `--kb-pc-ring`, and only the sheet sets its own widths.
- Anything that clipped or spaced a card by the old 6.5px reach of a Set (the hand's arc, the machine's slots, the
  Lens's overlapping faces): the reach only shrank.
