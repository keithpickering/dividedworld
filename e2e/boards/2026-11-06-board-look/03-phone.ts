/**
 * Board 03, the index and a board on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/03-phone.html, four screens at 390 by 844
 * side by side: the index and a board in light, then in dark; the dark two are compared on colors only, by web/contrast.test.tsx). The page is read
 * at 390, so its first screen stands at the window's left, and that is the one compared here: the index, as the story `Boards/01 Index` draws it.
 *
 * Departures, each a decision:
 *  - The build's banner stands 13px lower (its top margin, the board look's Task 3) and its Boards button, a 44px target (the phone's menu button) where
 *    the board draws 30px, is centered in that banner (2px from where the board draws it), and everything under the banner is held at +13 and the button's growth (title +16.8, the board's row +15.8).
 *  - A board's last post holds its name link and time link each at the 24px target (WCAG 2.5.8), so the row stands 12px lower than the board's line draws
 *    it, the time at +9.6; the System's row, whose words are the build's and wrap to two lines, takes the rest (Who is online at +27.75, the footer +32).
 *  - The build's host is the page's own address, the board's "dw.gripe", so it is not compared; the dates read against the real clock, as 02-board's.
 *  - The board's screen (the second, the `also` side) is held at the offset it stands on the board page. The build's board name stands 61px lower (the card
 *    banner keeps the room of a card's mark, and the crumb sits under the banner); the words wrap to two lines where the board's stay on one (Start a thread
 *    +84, the table +80); the pinned row takes the pin's mark on a line of its own under the title (a narrow phone wraps it, so its tile never straddles the
 *    starter's 24px target), where the board draws it beside the title, so the next row stands 60px lower again (+140). The board draws no key under the
 *    list on the phone; the build keeps it, and it is not compared.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/03-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-01-index--index' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World', buildShift: { y: 13 } },
    { id: 'boards-button', role: 'button', name: 'boards', buildName: 'Boards', type: false, buildShift: { height: 14.25 } },
    { id: 'title', role: 'heading', name: 'Index', buildShift: { y: 16.8 } },
    { id: 'general', role: 'link', name: 'General', nth: 0, buildShift: { y: 15.8 } },
    { id: 'general-about', role: 'text', name: 'Anything and everything. The staff are watching.', buildName: 'Anything and everything. The System is watching.', box: 'position', buildShift: { y: 14.8 } },
    { id: 'last-who', role: 'link', name: 'Mrs. Hooligan', nth: 0, box: 'position', buildShift: { y: 12 } },
    { id: 'last-time', role: 'link', name: 'Oct 6', buildName: 'Oct 6 — latest post in General', box: 'position', buildShift: { y: 9.6 } },
    { id: 'online', role: 'heading', name: 'Who is online', buildShift: { y: 27.75 } },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', type: false, buildShift: { y: 32 } },
  ],
  /* The second screen, a board's thread list, stands 414px to the right on the board page (the screens 24px apart): the build is the story `Boards/02 Board`, held at that offset. */
  also: [{
    name: 'board',
    build: { story: 'boards-02-board--board' },
    landmarks: [
      { id: 'title', role: 'heading', name: 'General', box: 'position', buildShift: { x: -414, y: 60.8 } },
      { id: 'start', role: 'button', name: 'Start a thread', buildShift: { x: -414, y: 84.4 } },
      { id: 'pin-title', role: 'link', name: 'who keeps splatting my posts', box: 'position', buildShift: { x: -414, y: 80.5 } },
      { id: 'new-title', role: 'link', name: 'Rate my avatar', box: 'position', buildShift: { x: -414, y: 140.1 } },
    ],
  }],
};

export default manifest;
