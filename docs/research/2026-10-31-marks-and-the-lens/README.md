# Marks and the Lens: a mockup

Record, written 2026-10-31. A mockup made after an impeccable critique of PR #97 (the glass on a post with cards played
on it, built from `docs/plans/2026-10-31-plays-on-a-post-design.md`). It is a design session's input, not a decision.
The owner chose this direction and asked for a mockup before a design session.

The critique measured #97 at 1440 and 390 wide:
- Whoops!'s plate adds 206px to a post on a desktop and 326px on a phone. On a phone that is 1.8 times the post's own
  ink.
- The glass's type is 20 to 26px against the post's 12px Verdana.
- The tag stack's edges stay visible when it is unstacked.
- The unstacked list overlaps the plate by 37 to 70px, and by 165 to 194px with long names.
- The tag answers who played a card. The plate answers how to get rid of it. They sit in two places and order the plays
  two ways.

The owner's answers to the critique, carried here:
- **Direction:** marks and the Lens. They replace the tag stack and the plate.
- **Who did it:** shown only on request, in the Lens. No caster's name is on a mark.
- **Takeovers:** Stick Around's hold carries the post with its marks, so other cards stay live inside it.
- **Next:** this mockup, then a design session.

`mock-marks-lens.html` shows Spritey's post #41 with three Whoops! layers and one Stick Around by a character with a
long name, on a live desktop screen and a live phone screen. Open it in a browser. It loads Anton and Barlow Condensed
from Google Fonts. The card art is `instances/divided-world/ui/cards/whoops.svg` and `stick-around.svg`, inlined.

## What it shows

- **The field.** The ink is drawn over the words and scrubbed by hand. Over the ink, a desktop cursor is a sponge.
  The first time a reader meets a card kind, a one-line callout hangs off its mark and goes away after the first
  stroke.
- **Marks.** There is one mark per card kind, not one per play. A mark is the card's art, a count when there is more
  than one play, and an edge in the card's ink that fills as the card nears its end. A mark has no words, so a long
  name cannot break it. It floats across the boundary between the post's date row and its body, and never sits in the
  page's flow. When the reader is the post's author and can act (Wash, Write in ink), the mark gets a gold notch.
- **The Lens.** A mark opens one floating panel, and its tabs are the post's card kinds. Every card's tab has the same
  three rows:
  - **State:** what the card is doing and how it ends.
  - **Act:** at most two controls from a fixed kit (hold, toggle, reveal, choose, go, author).
  - **Who:** folded until opened. It shows one row per play, with its ink, caster, message, reactions, React and Spin.
    Inside Whoops!'s tab the rows run in layer order, top first.

  On a desktop the Lens sits beside the post where there is room, so it does not cover the ink being scrubbed. On a
  phone it is a short sheet, and the post scrolls into view above it.
- **The takeover.** "Arrive held" puts the post, with its ink and marks, inside Stick Around's hold. Whoops! can be
  opened and scrubbed from inside the hold. The mockup stands in a held "Pull away" button for the hold's scroll-away.

## Shots

Each shot was taken at 1440 wide; the phone screen is beside the notes in each:
- `rest.png`: the page as it opens.
- `lens.png`: the Lens open with Who unfolded.
- `held.png`: the author's view, held by Stick Around, with Whoops! opened.

## Open, for the design session

- Where marks sit when a post's date row is crowded, and how "+N" folds more than four card kinds.
- Whether a play that outdraws its post flares its mark once without being asked.
- What an idle card that changes nothing on the post (Mic Drop, Sig Spam) shows: a mark, or nothing at all.
- `CardUi` gains `mark`, `controls` and `takeover`, which revises the plays-on-a-post design's "`CardUi` gains no
  field". #97's billing, batched reads and notes stand as built.
