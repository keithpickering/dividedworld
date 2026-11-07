/**
 * Board 01, the index, in the Silver house theme (docs/research/2026-11-06-board-look/01-index.html, 1440 by 1000; 01-index-dark.html is
 * the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): the banner and the boards' bar as one block,
 * the period table of boards, the Who is online box and the footer, as the story `Boards/01 Index` (engine/ui/index/Index.board.stories.tsx)
 * draws them. The HUD is drawn for place only and is 01-main's.
 *
 * Departures, each a decision:
 *  - The staff board is the build's The System, named so until the staff board gets its name, description and tag (the board-look plan,
 *    Task 11), so its name, its description and its tag are compared by the build's own words and, where a word differs, by place only.
 *  - The build's nav is named Main (its aria-label), the board's Boards.
 *  - The board's host, "dw.gripe", stands at the banner's right with the meter; the build's tagline of that name stands beside the name and
 *    the build's own address (the page's host) is what stands at the right, so the tagline is compared by its type alone.
 *  - The boards' bar draws no icons until the folder icons and nav icons (the plan's Task 5) do, so the board links after the first are compared by their y and height, not their x.
 *  - Who is online has no icon column until the folder icons (the plan's Task 5) draw it: its names are compared from the cell's own corner.
 *  - The kind of box the board draws around the credit is a footer, found by its role (its words hold the badges').
 *  - A board's last post holds its name link and its time link each at the 24px target (WCAG 2.5.8) without overlap, so its row stands
 *    about 12px taller than the board's line height draws it; what follows is within the match's tolerance.
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
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav', box: 'height' },
    { id: 'nav-system', role: 'link', name: 'Staff Announcements', buildName: 'The System', within: 'nav', box: 'height', type: false },
    { id: 'title', role: 'heading', name: 'Index' },
    { id: 'boards', role: 'table', name: 'Boards', type: false },
    { id: 'head-board', role: 'columnheader', name: 'Board', within: 'boards' },
    { id: 'head-threads', role: 'columnheader', name: 'Threads', within: 'boards' },
    { id: 'head-last', role: 'columnheader', name: 'Last post', within: 'boards' },
    { id: 'general', role: 'link', name: 'General', within: 'boards' },
    { id: 'general-about', role: 'text', name: 'Anything and everything. The staff are watching.', buildName: 'Anything and everything. The System is watching.', within: 'boards', box: 'position' },
    { id: 'system', role: 'link', name: 'Staff Announcements', buildName: 'The System', within: 'boards', box: 'height', type: false },
    { id: 'system-tag', role: 'text', name: 'Staff post here; you react and spin', buildName: 'The System posts; you react and spin', within: 'boards', box: 'none', type: false },
    { id: 'last-who', role: 'link', name: 'Mrs. Hooligan', within: 'boards', box: 'position' },
    { id: 'last-time', role: 'link', name: 'Oct 6, 2026', buildName: 'Oct 6, 2026 — latest post in General', within: 'boards', box: 'position' },
    { id: 'none-yet', role: 'text', name: 'None yet', within: 'boards', box: 'none' },
    { id: 'online', role: 'heading', name: 'Who is online' },
    { id: 'online-note', role: 'text', name: 'Characters active in the past 5 minutes', box: 'height' },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', type: false },
  ],
};

export default manifest;
