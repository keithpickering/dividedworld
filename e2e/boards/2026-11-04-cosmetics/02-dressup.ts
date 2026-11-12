/**
 * Board 02 of the cosmetics boards, the wardrobe (docs/research/2026-11-04-cosmetics/02-dressup.html, 1440 by 1080): the Selected panel with the keyboard moves, On the square and
 * Save the outfit. The build is the story `Boards/00 Wardrobe` (engine/ui/wardrobe/Wardrobe.board.stories.tsx): Pipewrench in the cap, mustache and button, the mustache selected by
 * the press on its row of Worn now. Every part is held from the Selected panel's label.
 *
 * Departures by decision:
 *  - The page frame: the build's own page head (title, lead and the Character select across the page) stands above the three columns, where the board sets the dressing select and its note
 *    in a row of its own over them and the title in the third column; the select, the portrait stage and the wardrobe's tiles are therefore not held, and the build's third column is
 *    the class cards' carousel (the owner's addition on confirming the board) beside the chosen piece's panel, not the board's grid of tiles.
 *  - The Selected panel carries Worn now (a row of the layers) the board does not draw, and the intro sentence wraps to one more line in the build's wider panel, so what follows stands 113 to 137px lower.
 *  - The menu is the glass's, without a Wardrobe tab (the page is reached from My characters and from a Random Event's Wear it); only its height is held.
 *  - The glass's button measure and type (type: false, position only); the pieces and the portrait are the instance's and the story's placeholders.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the Selected panel's label. */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'selected', type: false, box: 'position', ...more });

const manifest: BoardManifest = {
  board: '2026-11-04-cosmetics/02-dressup',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-00-wardrobe--arranging' },
  press: [{ role: 'button', name: 'Layer 2 Mustache' }],
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false, box: 'height' },
    { id: 'selected', role: 'text', name: 'SELECTED · MUSTACHE', buildName: 'Selected · Mustache', type: false, box: 'none' },
    at('left', 'button', 'Move left', { buildShift: { y: 126 } }),
    at('bigger', 'button', 'BIGGER', { buildShift: { y: 122 }, buildName: 'Bigger' }),
    at('forward', 'button', 'BRING FORWARD', { buildShift: { y: 137 }, buildName: 'Bring forward' }),
    at('off', 'button', 'TAKE IT OFF', { buildShift: { y: 129 }, buildName: 'Take it off' }),
    at('square', 'text', 'ON THE SQUARE', { buildShift: { y: 113 }, buildName: 'On the square' }),
    at('save', 'button', 'SAVE THE OUTFIT', { buildShift: { y: 124 }, buildName: 'Save the outfit' }),
    at('title', 'heading', 'THE WARDROBE', { buildShift: { x: 126 }, buildName: 'The wardrobe', buildNth: 1 }),
  ],
};
export default manifest;
