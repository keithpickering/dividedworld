/**
 * Board 17, the browser's page for a load that failed, in the Silver house theme (docs/research/2026-11-06-board-look/17-cannot-display.html, 1440 by 1000;
 * 17-cannot-display-dark.html is the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): a white sheet inside the frame
 * (charcoal in dark, its own colors and not the theme's) with the CSS glyph, "The page cannot be displayed", its words, the ways out (Try again, the index, the
 * browser's Back) and the address, as the story `Boards/17 Cannot display` (engine/ui/frame/CannotDisplay.board.stories.tsx) draws them.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/17-cannot-display',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-17-cannot-display--cannot-display-page' },
  landmarks: [
    { id: 'sheet', role: 'group', name: 'The page cannot be displayed', type: false },
    { id: 'title', role: 'heading', name: 'The page cannot be displayed' },
    { id: 'try-again', role: 'button', name: 'Try again' },
    { id: 'index', role: 'link', name: 'back to the index' },
    { id: 'address', role: 'text', name: 'Cannot load dw.gripe/t/3f2a9c1e' },
  ],
};

export default manifest;
