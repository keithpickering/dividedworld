/**
 * Board 20, the Strategy Guide (docs/research/2026-11-05-backfill/20-guide.html, 1440 by 1320): the guide's page and its Classes section. The
 * board draws the guide scrolled to Classes with the other sections left out, which the build, one long article, cannot be shown as: so the
 * board's page head and contents column are compared on the guide from its top (the story `Boards/02 Guide`, Top), and its Classes heading on
 * the guide opened at Classes (the same story's Classes), where the contents column is pinned and the page has scrolled, so that heading is
 * compared by its words, its height and its type, not its place. Both are the page's own Anton headings set as the instance writes them
 * ("Classes", not capitals), one line at 1440.
 *
 * Departures: the contents column is 300px wide where the board draws 290 and its lede, in the glass's 21px, is 126px tall where the board's is
 * 120 and stands 15px lower, with the first link 10px lower again (held at those shifts); the first link is the section the guide opens at, which
 * the build marks in the neon (its type is not compared, the board marks Classes); and the section's heading is the glass's `4rem`, 64px where
 * the board draws 60.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/20-guide',
  size: { width: 1440, height: 1320 },
  build: { story: 'boards-02-guide--top' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'title', role: 'heading', name: 'STRATEGY GUIDE' },
    { id: 'lede', role: 'text', name: 'How the game works, from the people who made it. The voice is Gabe\'s; every fact in it is true, and every number is today\'s.', box: 'position', buildSize: 21, buildShift: { y: 15 } },
    { id: 'first', role: 'link', name: 'Welcome letter', box: 'position', type: false, buildShift: { y: 25 } },
  ],
  also: [
    {
      name: 'Classes',
      build: { story: 'boards-02-guide--classes' },
      landmarks: [
        { id: 'classes', role: 'heading', name: 'Classes', box: 'none', buildSize: 64 },
      ],
    },
  ],
};

export default manifest;
