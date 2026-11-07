/**
 * Board 18, the errors on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/18-phone.html, four screens at 390 by 844 side by side: not
 * found and cannot be displayed in light, then in dark, the dark two compared on colors only, by web/contrast.test.tsx). The first screen is the Information box
 * asking for a character, the story `Boards/16 Not found`'s character export; the second, the sheet with its glyph above the heading, is the `also` side, the story
 * `Boards/17 Cannot display` read at 414px (the screen's width and the 24px between screens) to the window's left.
 *
 * Departures, each a decision:
 *  - The build's banner stands 13px lower (its top margin, the board look's Task 3) and its Boards button, a 44px target (the phone's menu button) where the
 *    board draws 30px, makes it taller (as 03-phone), so everything under the banner is held at +14.8 on both screens.
 */
import type { BoardManifest } from '../../board-match.ts';

const SCREEN = -414;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/18-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-16-not-found--not-found-character' },
  landmarks: [
    { id: 'info', role: 'table', name: 'Information', type: false, buildShift: { y: 14.8 } },
    { id: 'message', role: 'heading', name: 'The character you requested does not exist.', buildShift: { y: 14.8 } },
    { id: 'way-out', role: 'link', name: 'Click here to return to the index', buildShift: { y: 14.8 } },
    { id: 'address', role: 'text', name: 'Address: /c/nobody', buildShift: { y: 14.8 } },
  ],
  also: [{
    name: 'cannot-display',
    build: { story: 'boards-17-cannot-display--cannot-display-page' },
    landmarks: [
      { id: 'title', role: 'heading', name: 'The page cannot be displayed', buildShift: { x: SCREEN, y: 14.8 } },
      { id: 'try-again', role: 'button', name: 'Try again', buildShift: { x: SCREEN, y: 14.8 } },
    ],
  }],
};

export default manifest;
