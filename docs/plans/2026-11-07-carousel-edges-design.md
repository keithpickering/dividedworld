# Carousel edges and the wide roster

Record, written 2026-11-07. The owner's notes on the carousel that the glass polish built
(`docs/plans/2026-11-04-glass-polish-design.md`, section 4), given in a session that planned and built the change itself,
with the owner's leave ("this can become a design session if more info is needed, otherwise you can plan and execute
right here"). In their words:

- "Carousels have a hidden overflow container which prevents glow effects, or often the very edge of an object
  (probably due to a box-shadow emulating a border), from being fully seen."
- "Carousels have an edge fade which pops in instantly when an item goes beyond the container's viewport. This would
  look great if it just faded instead of popping in/out instantly."
- "On wide screens, the old layout (character slots in a grid, selected character info in the right column) worked
  better. The current layout, though good on smaller screens, on desktop pushes the character options down too far and
  makes the buttons comically wide. Let's just add a media query to get rid of the carousel whenever there is room for
  the side-by-side look."

World: the glass. All of it is engine (`engine/ui/glass/Carousel.tsx`, `engine/ui/characters/`); no instance file
changes.

## 0. Where it starts

Read from the code on 2026-11-07 (`main` at 5e81a3b). The carousel's row, `.kb-class-grid`, is its scroll container. It
holds 32px of padding above and below for a chosen card's glow, and none at its two ends, so a card at either end has
its glow, and the 2px ring its `box-shadow` draws as a border, cut at the row's edge. The fade over a peeking card is
one of three `mask-image` rules picked by `data-kb-peek-before` and `-after`, and its width is the peek the carousel
measures; when a card comes whole into view the peek drops from most of a card to nothing in one frame, and the rule
changes with it, so the fade pops. The roster is the carousel at every width, its panel under the row and capped at
52em: at 1440 its buttons are about 1040px wide.

## 1. The row keeps room for a glow at its ends

**Decided:** the row has the same room for a glow at its two ends as above and below, `--kb-class-glow` (32px, the
largest glow a card here draws reaches 30px past its box). The row is padded by it inline and drawn out past its column by
the same amount, so its cards stand where they stood and the glow is inside the row's box. Snapping and the carousel's
own scrolling keep their cards at the column's edge (`scroll-padding-inline`).

A card is still counted whole (the count, "1–4 of 6") by whether it lies inside the column. A card that lies past the
column shows up to the room more, inside the row's box, and that is its peek: the fade is drawn over it from the row's
edge, so a card shown whole is never faded and nothing peeking is drawn unfaded. The numbers stay pure and tested
(`engine/ui/characters/carousel.ts`, `peeks`).

Weighed: `overflow-clip-margin`, which applies only to `overflow: clip`, not to a row that scrolls.

## 2. The fade eases

**Decided:** the fade is one mask, always drawn, over two lengths the stylesheet registers (`@property`) and eases,
`--kb-class-fade-before` and `-after`, following the peeks the carousel measures (`--kb-class-peek-before` and
`-after`, which stay the measured truth). A card coming whole into view loses its fade over 0.2s instead of at once.
Under reduced motion the fade follows at once. The fade is a look and not a game obstacle, so it has no accessible
path to weigh.

## 3. The wide roster is the board's grid and its panel beside it

**Decided** (the owner, above): where My characters has room, the roster is the Roster board's own layout
(`docs/research/2026-10-29-two-worlds/10-roster.html`): the cards three across at 246px, 20px apart, New character in the
next slot, and the selected panel in the column beside them, 32px away. Room is 780px for the grid, 32px between, and
420px for the panel (the board's is 500px), so 1232px, asked of the page's own width by a container query rather than a
media query: the page is drawn in the board's pixels, scaled by `zoom`, and a container query reads those. On the Main
board's layout at 100% text that is every width; on the Phone board's it is none of them, as on a phone or a narrow
window, which keep the carousel.

The roster is still the tablist and its panel the tabpanel: only the stylesheet changes. The tablist lays its tabs in
the grid's columns (`subgrid`), and New character, which stands beside the tablist and not in it, takes the next
slot, placed from the count the carousel sets on its row. A row of three never overflows, so the count and the arrows
are not drawn and nothing is faded.

This departs from the glass polish's section 4 ("at every width"), which weighed "a carousel on phones only (two
layouts, and a full desktop grid of six has the same problem)". The owner has now chosen the two layouts. A full grid of
six is two rows of three beside the panel, as the board's own grid is.

## 4. The rules

- **The masks.** Nothing here reads a private fact: the roster is the player's own, as before.
- **An accessible path.** The roster is the same tablist at every width; the arrow keys, Home and End work as before.
- **No player is stuck.** No state is added.

## Plan

One task, built in this session, test first:

1. `peeks` in `engine/ui/characters/carousel.ts`, with its unit tests red first, and `Carousel.tsx` reading the row's
   inline padding and drawing its counts for the stylesheet (`--kb-carousel-items`, `--kb-carousel-count`).
2. `e2e/characters.spec.ts`: the chosen card's glow lies inside the row at its start; the fade's lengths ease and, under
   reduced motion, do not; at 1440 the roster is three across with New character in the next slot and the panel beside
   it, with no count or arrows; on the Phone board's layout at 1024 it is still the carousel with its panel under it.
   Each red first.
3. `engine/ui/characters/characters.css`: the glow's room, the eased fade, the wide roster.
4. The board's manifest comment (`e2e/boards/10-roster.ts`) says which layout it now compares, and the build and the
   characters and boards specs pass.
