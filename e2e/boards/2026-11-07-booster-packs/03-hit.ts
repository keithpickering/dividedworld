/**
 * Booster packs board 03, the hit (docs/research/2026-11-07-booster-packs/03-hit.html, 1440 by 1080): the same story and presses as board 02 and then
 * Turn all, so all five are turned and the hit is in the spotlight: a rare Main Event with its gold tag, glow and sparks, "5 OF 5 · ALL IN YOUR HAND" under the
 * pack's name, Done and Back to the machine, and the line that the five are already in the hand. The plan is docs/plans/2026-11-04-booster-packs-plan.md, Task 5.
 *
 * Departures, by decision, those of board 02 (its manifest says each: the glass's own type sizes and buttons, the title, counter and line held by their y and
 * height, the cards shown the story's answer) and:
 *  - The tag is found by its words, which the story's answer makes the board's: the hit is the instance's first rare, Main Event, which no slot sells on its own, so
 *    the line also says "Main Event isn't sold on its own; this is one of the ways to get it." as the board draws it. It is held by its y and height, the build's
 *    tag being the glass's label size (20px) where the board draws 22px.
 *  - The board's "ESC BACK TO THE MACHINE" has its key cap drawn and not read: the build's name is "Back to the machine".
 */
import type { BoardManifest } from '../../board-match.ts';
import { PRESSES } from './02-reveal.ts';

const BUTTON = { height: -4 } as const;

const manifest: BoardManifest = {
  board: '2026-11-07-booster-packs/03-hit',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-booster-packs--machine' },
  press: [...PRESSES, { role: 'button', name: 'Turn all' }],
  landmarks: [
    { id: 'dialog', role: 'dialog', name: 'Opening a Booster', type: false, box: 'size' },
    { id: 'title', role: 'heading', name: 'Booster', within: 'dialog', type: false, box: 'height' },
    { id: 'count', role: 'text', name: '5 OF 5 · ALL IN YOUR HAND', within: 'dialog', type: false, box: 'height' },
    { id: 'tag', role: 'text', name: 'RARE · MAIN EVENT', within: 'dialog', type: false, box: 'height' },
    { id: 'row', role: 'list', name: 'The pack, in the order it was pulled', within: 'dialog', type: false, box: 'full' },
    { id: 'done', role: 'button', name: 'Done', within: 'dialog', type: false, box: 'height', buildShift: BUTTON },
    { id: 'back', role: 'button', name: 'ESC BACK TO THE MACHINE', buildName: 'Back to the machine', within: 'dialog', type: false, box: 'height', buildShift: BUTTON },
    { id: 'hint', role: 'text', name: 'These five are already in your hand. Main Event isn\'t sold on its own; this is one of the ways to get it.', within: 'dialog', type: false, box: 'height' },
  ],
};

export default manifest;
