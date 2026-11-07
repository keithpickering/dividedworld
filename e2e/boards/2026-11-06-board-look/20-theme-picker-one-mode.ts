/**
 * Board 20, Settings › The board with Hot Rod chosen (docs/research/2026-11-06-board-look/20-theme-picker-one-mode.html, 1440 by 1120): a theme that holds one mode,
 * the Mode row held to it and the others greyed, and the note that says why and names the house theme. The page is board 19's, so its parts are 19's
 * (e2e/boards/2026-11-06-board-look/19-theme-picker.ts), as the story `Boards/19 Theme picker`'s `One mode` draws it.
 *
 * Departures by decision: board 19's. And Hot Rod is one of the story's four test themes until Task 17 adds the instance's own (the story's header), so the
 * tile and the note are the story's, in the same words the instance's will say.
 */
import type { BoardManifest } from '../../board-match.ts';
import { rail, rows } from './19-theme-picker.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/20-theme-picker-one-mode',
  size: { width: 1440, height: 1120 },
  build: { story: 'boards-19-theme-picker--one-mode' },
  landmarks: [
    ...rail('THE BOARD'),
    ...rows({ name: 'Hot Rod comes in dark only, so the board stays dark whatever your device says. Choose House for light and dark.' }, ['HOUSE', 'BLUE STEEL', 'MIDNIGHT', 'HOT ROD', 'FAN SITE']),
  ],
};

export default manifest;
