/**
 * Board 04 of the cosmetics boards, the Random Event dialog (docs/research/2026-11-04-cosmetics/04-event.html, 1440 by 1080), finding a gear: the dialog over a page. The build is the story
 * `Boards/00 Random Event` (engine/ui/events/RandomEvent.board.stories.tsx), the instance's cap in its own line for Pipewrench. The title, Wear it and OK are held from the dialog's corner.
 *
 * Departures by decision:
 *  - The dialog is the glass's overlay, standing in the middle of the window (250px lower than the board's, which hangs it 150px from the top over a forum), 51px taller for the bar's Close
 *    and the glass's spacing, and the title, the buttons and the line are the glass's type (type: false, position only; Wear it is a link to the wardrobe, and OK carries no Esc key cap).
 *  - The forum under the dialog is the board's illustration of a page; the story's page is the glass's shell, so it is not held. The two smaller states the board insets (a line alone,
 *    a found card) are drawn as the stories `Glass/Random Event` (RandomEvent.stories.tsx) in the dialog's own frame, not as the board's mini cards, so they are not held.
 *  - The picture is the instance's art at 120 by 80 in the 150px box.
 */
import type { BoardManifest } from '../../board-match.ts';
const manifest: BoardManifest = {
  board: '2026-11-04-cosmetics/04-event',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-00-random-event--gear-found' },
  landmarks: [
    { id: 'dialog', role: 'dialog', name: 'SOMETHING HAPPENED!', buildName: 'Something happened!', type: false, buildShift: { y: 250, height: 51 } },
    { id: 'title', role: 'heading', name: 'SOMETHING HAPPENED!', buildName: 'Something happened!', type: false, box: 'position', origin: 'dialog', buildShift: { x: -163, y: 13 } },
    { id: 'wear', role: 'button', name: 'WEAR IT', buildName: 'Wear it', buildRole: 'link', type: false, box: 'position', origin: 'dialog', buildShift: { x: -162, y: 46 } },
    { id: 'ok', role: 'button', name: 'ESC OK', buildName: 'OK', type: false, box: 'position', origin: 'dialog', buildShift: { x: -177, y: 46 } },
  ],
};
export default manifest;
