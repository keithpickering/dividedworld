Record, written 2026-11-07.

# Card template shots

The screenshots the card template plan's "Last" section asks for, taken from the finished card template (`engine/ui/cards/Postcard.tsx` and `postcard.css`) with Divided World's nine cards and its card back.

- `card-<key>.png`, one for each of the nine cards (stick-around, whoops, trap-card, force-field, bluff, autocorrect, glitter-bomb, main-event, feelin-fab). The top row is the card unarmed at its four sizes, left to right: slot (86), phone (104), fan (150), sheet (276). The bottom row is the same four sizes armed.
- `card-back.png`: the card back with the instance's coin mark at the same four sizes. The top row is the default back, the bottom row the back in its hit state.

All are at deviceScaleFactor 2 (so the sheet card is 552 pixels wide), on the glass's dark ground (#16161a), in the instance's own fonts and theme.

## How they were taken

A scratch Vite page rendered `Postcard` and `PostcardBack` with the cards from `facesOf(instance.cards, instanceUi.cards, instance.settings)` and the glass applied (`applyGlass`, `installGlassFonts`). Playwright chromium (default launch, no options) screenshotted each row grid. The scratch page is not in the repo; it was throwaway.

The armed look is an animation (a 1.8 second pulse). Under reduced motion it stops on the plain 2 pixel ring and glow, which differs little from an unarmed card's glow. So each armed row is captured with the animation paused at its peak (the half-way frame, 0.9 seconds in), where the ring turns to the glass's bright text color and the glow widens. That frame is the one shown; the live card moves between it and the plain ring.
