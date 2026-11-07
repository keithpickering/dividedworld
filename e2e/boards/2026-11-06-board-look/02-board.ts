/**
 * Board 02, a board's thread list, in the Silver house theme (docs/research/2026-11-06-board-look/02-board.html, 1440 by 1000; 02-board-dark.html
 * is the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): the banner and the boards' bar with their icons,
 * the crumb, the board's name and words, Start a thread with its icon, the list with its pinned group and its four folders, the key under it,
 * Users browsing this board with its icon column, and the footer, as the story `Boards/02 Board` (engine/ui/board/Board.board.stories.tsx) draws
 * them. The HUD is drawn for place only and is 01-main's.
 *
 * Departures, each a decision:
 *  - The build's nav is named Main (its aria-label), the board's Boards.
 *  - The board's host and tagline are as in 01-index, and are not repeated here.
 *  - The story's backend clock stands at Oct 29, so a thread is hot on replies this week only if it has them within it: the threads are dated a
 *    week before the clock where the board draws Oct 5 and 6. The quiet thread's "spun from"
 *    is left out (a spun thread's Act is dated at the clock, which would put it first); its row is the same height without it.
 *  - The build's board holds its name in the card banner (engine/ui/board/Board.tsx, `BoardBanner`), which always keeps the room of a card's
 *    mark so a play landing never moves the board, and the crumb sits a little lower under the bar than the board draws it: the crumb is held
 *    at +8px, the name at +44, the words and Start a thread at +47 and +44, and the table at +43, each held to where it now stands. The
 *    board's name is held by its place alone (the build's is the width of its words).
 *  - A row's title and its last post's links are each held to the 24px target (WCAG 2.5.8), so a row stands up to 3px taller than the board
 *    draws it, and the table (which holds a 4px row more than its height says) is 12px taller; the parts inside it are compared as offsets from
 *    the table's corner, and everything under it is held at the table's growth (the key at +53, Users browsing at +52, the footer at +58). The
 *    key's words stand at +53 and not the table's +55 because the key sits under the table's last row: the build's gap under the table is 1.2px
 *    smaller than the board's 14px, and its row 2px shorter (measured: table bottom +55.4, key box top +54.2, its words +53.1).
 *  - A title is compared by its place and type, not its height (the 24px target); the page numbers of a row are held by their words alone,
 *    since each is a 1.4em target, which spaces them more widely than the board's.
 *  - The story's times are read against the real clock ("9 days ago", then a date), so no time is a landmark here.
 *  - The Views head's name carries its explanation, visually hidden (the build's words).
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/02-board',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-02-board--board' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'nav', role: 'navigation', name: 'Boards', buildName: 'Main', type: false },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav' },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav' },
    { id: 'nav-system', role: 'link', name: 'Staff Announcements', within: 'nav', box: 'position', type: false },
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8 } },
    { id: 'title', role: 'heading', name: 'General', box: 'position', buildShift: { y: 44 } },
    { id: 'about', role: 'text', name: 'Anything and everything. The staff are watching.', box: 'position', buildShift: { y: 47 } },
    { id: 'start', role: 'button', name: 'Start a thread', box: 'position', buildShift: { y: 44 } },
    { id: 'threads', role: 'table', name: 'Threads on General, most recently posted first', type: false, buildShift: { y: 43, height: 12 } },
    { id: 'head-thread', role: 'columnheader', name: 'Thread', within: 'threads', origin: 'threads' },
    { id: 'head-replies', role: 'columnheader', name: 'Replies', within: 'threads', origin: 'threads' },
    { id: 'head-views', role: 'columnheader', name: 'Views', buildName: 'Views . Characters that have read it, counted hourly', within: 'threads', origin: 'threads', type: false },
    { id: 'head-last', role: 'columnheader', name: 'Last post', within: 'threads', origin: 'threads' },
    { id: 'pin-title', role: 'link', name: 'who keeps splatting my posts', within: 'threads', origin: 'threads', box: 'position' },
    { id: 'pin-pages', role: 'link', name: '2', buildName: 'Page 2 of who keeps splatting my posts', within: 'threads', origin: 'threads', nth: 0, box: 'none' },
    { id: 'new-title', role: 'link', name: 'Rate my avatar', within: 'threads', origin: 'threads', box: 'position' },
    { id: 'new-unread', role: 'link', name: 'first unread', buildName: 'First unread post in Rate my avatar', within: 'threads', origin: 'threads', nth: 0, box: 'none' },
    { id: 'long-title', role: 'link', name: 'The long one', within: 'threads', origin: 'threads', box: 'position' },
    { id: 'long-pages', role: 'link', name: '9', buildName: 'Page 9 of The long one', within: 'threads', origin: 'threads', box: 'none' },
    { id: 'quiet-title', role: 'link', name: 'Who keeps reacting with a thumbs up?', within: 'threads', origin: 'threads', box: 'position' },
    { id: 'legend-new', role: 'text', name: 'New posts', box: 'position', buildShift: { y: 53 } },
    { id: 'legend-old', role: 'text', name: 'No new posts', nth: 1, buildNth: 1, box: 'position', buildShift: { y: 53 } },
    { id: 'legend-hot', role: 'text', name: 'Hot: 10 replies this week', box: 'position', buildShift: { y: 53 } },
    { id: 'online', role: 'heading', name: 'Users browsing this board', buildShift: { y: 52 } },
    { id: 'online-who', role: 'link', name: 'Mrs. Hooligan', nth: 3, buildNth: 3, box: 'position', buildShift: { y: 52 } },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', buildShift: { y: 58 }, type: false },
  ],
};

export default manifest;
