/**
 * Board 11, a move in force on its board, in the Silver house theme (docs/research/2026-11-06-board-look/11-move-notice.html, 1440 by 1000;
 * 11-move-notice-dark.html is the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): the board's name and words, the
 * Boss's announcement as a table (a light band reading "Announcement from The Director", its words, its top reactions) with the glass label and Way out on
 * the band's corner, then Start a thread, the board's one thread and Users browsing this board, as the story `Boards/11 Move notice`
 * (engine/ui/board/MoveNotice.board.stories.tsx) draws them.
 *
 * Departures, each a decision:
 *  - The glass label reads "The Boss renamed this board", as the board draws it (the build sets it in capitals), held by its place; Way out's count is the build's own words and held by its place alone. The glass
 *    is the glass's own face (Barlow Condensed), held by neither type nor size.
 *  - The build's nav is named Main, as in 02-board; the
 *    host and tagline are not repeated, and the HUD is drawn for place only and is 01-main's.
 *  - The build's nav reads the renamed board's name (Pointless Toast Palace) where the board draws General, so its links are not compared; the notice stands
 *    43.9px lower with the board's name (the card banner keeps the room of a card's mark, as in 02-board), Start a thread and the thread 2.5px and 1.2px further
 *    (the notice's 14px gap and the thread row's 24px targets), and Users browsing 59.4px further still: the build's key (New posts, No new posts, Hot) stands
 *    under the thread list, which this board does not draw. The reactions are display-only tiles, held with the notice's frame, whose height they set.
 *  - The story's times are read against the real clock ("8 days ago", then a date), so no time is a landmark; the reactions are the notice's tally and are held
 *    by their place as a list.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/11-move-notice',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-11-move-notice--move-notice' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'nav', role: 'navigation', name: 'Boards', buildName: 'Main', type: false },
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'title', role: 'heading', name: 'Pointless Toast Palace', box: 'position', buildShift: { y: 43.9 } },
    { id: 'notice', role: 'table', name: '', buildName: 'Announcement from The Director', type: false, buildShift: { y: 43.9 } },
    { id: 'notice-band', role: 'text', name: 'Announcement from The Director', within: 'notice', origin: 'notice', box: 'position' },
    { id: 'notice-boss', role: 'link', name: 'The Director', within: 'notice', origin: 'notice' },
    { id: 'start', role: 'button', name: 'Start a thread', box: 'position', buildShift: { y: 46.4 } },
    { id: 'thread-title', role: 'link', name: 'toast is a sandwich and I can prove it', box: 'position', buildShift: { y: 45.1 } },
    { id: 'online', role: 'heading', name: 'Users browsing this board', buildShift: { y: 105.8 } },
  ],
};

export default manifest;
