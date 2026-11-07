/**
 * Board 06, Start a thread, in the Silver house theme (docs/research/2026-11-06-board-look/06-new-thread.html, 1440 by 1000; 06-new-thread-dark.html is
 * the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): General with Start a thread pressed in, the form under
 * its light band (who posts, the title, the first post in the shared editor with its toolbar, the count, the hint, Preview and the one primary button),
 * as the story `Boards/02 Board` (engine/ui/board/Board.board.stories.tsx) draws it after Start a thread is pressed.
 *
 * Departures, each a decision:
 *  - The band is held by its type alone: the board's is a cell with the heading inside it; the build's heading is the whole band, wider and taller by the cell's padding.
 *  - The board's text boxes are empty divs with no role, so the labels, the toolbar and the buttons are measured from Start a thread, and the boxes are not compared.
 *  - Preview and Start thread are wider than the board's by the type scale (every board size token at 1.25 times), 5px and 7.75px; Preview stands 11.2px nearer the
 *    left, since the build's hint ("Ctrl+Enter or Command+Enter starts it") and Start thread are wider than the board's.
 *  - The HUD is drawn for place only and is 01-main's.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/06-new-thread',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-02-board--board' },
  press: [{ role: 'button', name: 'Start a thread' }],
  landmarks: [
    { id: 'title', role: 'heading', name: 'General', box: 'position', buildShift: { y: 44 } },
    { id: 'start', role: 'button', name: 'Start a thread', nth: 0, box: 'position', buildShift: { y: 44 } },
    { id: 'band', role: 'heading', name: 'Start a thread', box: 'none' },
    { id: 'as', role: 'text', name: 'Posting as Mrs. Hooligan', origin: 'start' },
    { id: 'label-title', role: 'text', name: 'Title', origin: 'start' },
    { id: 'label-first', role: 'text', name: 'First post', origin: 'start' },
    { id: 'tools', role: 'toolbar', name: 'Formatting', origin: 'start', type: false },
    { id: 'preview', role: 'button', name: 'Preview', origin: 'start', buildSize: 12.5, buildShift: { x: -11.2, width: 5 } },
    { id: 'go', role: 'button', name: 'Start thread', origin: 'start', buildShift: { width: 7.75 } },
  ],
};

export default manifest;
