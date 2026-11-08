/**
 * Booster packs board 02, the reveal (docs/research/2026-11-07-booster-packs/02-reveal.html, 1440 by 1080): the story `Boards/Booster packs`, `Machine`, with
 * the Booster bought and three of its five cards turned, reached by the presses a player makes (select the Booster, Buy, turn the next card three times).
 * The emptied pack is parked at the top with its foot in view, "3 OF 5 TURNED OVER" under its name, the card last turned at the sheet's size in the middle,
 * the five in pull order beneath it at the fan's size (the next card's back a button, the hit's back gold), and Turn the next card, Turn all and Close.
 * The plan is docs/plans/2026-11-04-booster-packs-plan.md, Task 5.
 *
 * Departures, by decision:
 *  - The cards shown are what the story's answer gave (four commons and the first rare, in the instance's order), not the board's drawn names; so no card is found by
 *    name: the row is held as a list, and the spotlight's card by nothing but the row's place (its art is the instance's).
 *  - The type: the pack's name is the glass's display size (52px, `--kb-glass-size-display-l`) where the board draws 56px; the counter and the line are the glass's body
 *    size (21px) where the board draws 22px and 20px; and a button is the glass's own (48px tall, its own width). The board's title, counter and line are
 *    blocks the window's width with the words centered, and the build's are the words' own width, so each of the three is held by its y and height, and
 *    so is each button. The board's Close is "ESC CLOSE": its key cap is drawn and not read, so the build's name is "Close".
 *  - The board's "Click the next card or press Space to turn it. All five are already in your hand." is the build's, word for word.
 */
import type { BoardManifest } from '../../board-match.ts';

/** A GlassButton, 48px where the board's `.btn` is 52. */
const BUTTON = { height: -4 } as const;

export const PRESSES = [
  { role: 'button', name: 'Buy Booster, 3.00 orbs, a pack of 5 postcards' },
  { role: 'button', name: 'Buy Booster · 3.00' },
] as const;

const manifest: BoardManifest = {
  board: '2026-11-07-booster-packs/02-reveal',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-booster-packs--machine' },
  press: [...PRESSES, { role: 'button', name: 'Turn the next card' }, { role: 'button', name: 'Turn the next card' }, { role: 'button', name: 'Turn the next card' }],
  landmarks: [
    { id: 'dialog', role: 'dialog', name: 'Opening a Booster', type: false, box: 'size' },
    { id: 'title', role: 'heading', name: 'Booster', within: 'dialog', type: false, box: 'height' },
    { id: 'count', role: 'text', name: '3 OF 5 TURNED OVER', within: 'dialog', type: false, box: 'height' },
    { id: 'row', role: 'list', name: 'The pack, in the order it was pulled', within: 'dialog', type: false, box: 'full' },
    { id: 'next-card', role: 'button', name: 'Turn card 4', within: 'dialog', type: false, box: 'full' },
    { id: 'turn', role: 'button', name: 'Turn the next card', within: 'dialog', type: false, box: 'height', buildShift: BUTTON },
    { id: 'all', role: 'button', name: 'Turn all', within: 'dialog', type: false, box: 'height', buildShift: BUTTON },
    { id: 'close', role: 'button', name: 'ESC CLOSE', buildName: 'Close', within: 'dialog', type: false, box: 'height', buildShift: BUTTON },
    { id: 'hint', role: 'text', name: 'Click the next card or press Space to turn it. All five are already in your hand.', within: 'dialog', type: false, box: 'height' },
  ],
};

export default manifest;
