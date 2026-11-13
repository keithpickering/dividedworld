/**
 * Board 01, the index, in the Silver house theme (docs/research/2026-11-06-board-look/01-index.html, 1440 by 1000; 01-index-dark.html is
 * the same page in the dark mode and is compared on colors only; its theme token pairs are held by web/contrast.test.tsx): the banner and the boards' bar as one block,
 * the period table of boards, the Who is online box and the footer, as the story `Boards/01 Index` (engine/ui/index/Index.board.stories.tsx)
 * draws them. The HUD is drawn for place only and is 01-main's.
 *
 * Departures, each a decision:
 *  - The build's nav is named Main (its aria-label), the board's Boards.
 *  - The board's host, "dw.gripe", stands at the banner's right with the meter; the build's tagline of that name stands beside the name and
 *    the build's own address (the page's host) is what stands at the right, so the tagline is compared by its type alone.
 *  - The kind of box the board draws around the credit is a footer, found by its role (its words hold the badges').
 *  - A board's last post holds its name link and its time link each at the 24px target (WCAG 2.5.8) without overlap, so its row stands
 *    about 12px taller than the board's line height draws it; what follows is within the match's tolerance.
 *  - A board's last post also names the thread it points at, in a link of its own above the poster's name, which the board does not draw: the table stands
 *    25.6px taller for it, the poster's name +18.4 and the time +19.6, and everything under the table (the second row, Who is online, the footer) about +21 to +26.
 *  - A linked name is one link holding the character's avatar and the name (the avatar is the link's too, so the link's accessible name is the name alone), where the board draws the
 *    avatar beside a link of the name: the link starts at the avatar, 1.62em (the avatar, 1.27em, and the gap, 0.35em: 24.3px at this row's 15px text) left of the name, which stands where it stood; the shift holds the link to the x the board draws its name's link at.
 *  - A time is a link named by its words and where it goes ("Oct 6, 2026 — latest post in General"), the board's by the words alone.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/01-index',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-01-index--index' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'tagline', role: 'text', name: 'dw.gripe', box: 'none' },
    { id: 'nav', role: 'navigation', name: 'Boards', buildName: 'Main', type: false },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav', box: 'position' },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav', box: 'position' },
    { id: 'nav-system', role: 'link', name: 'Staff Announcements', within: 'nav', box: 'position', type: false },
    { id: 'title', role: 'heading', name: 'Index' },
    { id: 'boards', role: 'table', name: 'Boards', type: false, buildShift: { height: 25.63 } },
    { id: 'head-board', role: 'columnheader', name: 'Board', within: 'boards' },
    { id: 'head-threads', role: 'columnheader', name: 'Threads', within: 'boards' },
    { id: 'head-last', role: 'columnheader', name: 'Last post', within: 'boards' },
    { id: 'general', role: 'link', name: 'General', within: 'boards' },
    { id: 'general-about', role: 'text', name: 'Anything and everything. The staff are watching.', within: 'boards', box: 'position' },
    { id: 'system', role: 'link', name: 'Staff Announcements', within: 'boards', box: 'height', type: false, buildShift: { y: 21.81 } },
    { id: 'system-tag', role: 'text', name: 'Staff post here; you react and spin', within: 'boards', box: 'none', type: false },
    { id: 'last-who', role: 'link', name: 'Mrs. Hooligan', within: 'boards', box: 'position', buildShift: { x: -22.77, y: 18.38 } },
    { id: 'last-time', role: 'link', name: 'Oct 6, 2026', buildName: 'Oct 6, 2026 — latest post in General', within: 'boards', box: 'position', buildShift: { y: 19.63 } },
    { id: 'none-yet', role: 'text', name: 'None yet', within: 'boards', box: 'none' },
    { id: 'online', role: 'heading', name: 'Who is online', buildShift: { y: 21.05 } },
    { id: 'online-note', role: 'text', name: 'Characters active in the past 5 minutes', box: 'position', buildShift: { y: 26.33 } },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', type: false, buildShift: { y: 26.39 } },
  ],
};

export default manifest;
