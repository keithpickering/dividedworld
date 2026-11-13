/**
 * Board 03, the index and a board on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/03-phone.html, four screens at 390 by 844
 * side by side: the index and a board in light, then in dark; the dark two are compared on colors only, by web/contrast.test.tsx). The page is read
 * at 390, so its first screen stands at the window's left, and that is the one compared here: the index, as the story `Boards/01 Index` draws it.
 *
 * Departures, each a decision:
 *  - The build's banner stands 13px lower (its top margin, the board look's Task 3) and its Boards button, a 44px target (the phone's menu button) where
 *    the board draws 30px, is centered in that banner (2px from where the board draws it), and everything under the banner is held at +13 and the button's growth (title +16.8, the board's row +15.8).
 *  - A board's last post holds its name link and time link each at the 24px target (WCAG 2.5.8), so the row stands 12px lower than the board's line draws
 *    it, the time at +9.6; the rest is the build's own spacing (Who is online at +6, the footer +10.3).
 *  - A linked name is one link holding the avatar and the name, so it starts at the avatar, 1.62em (the avatar, 1.27em, and the gap, 0.35em: 22.3px at this row's 13.75px text) left of the name, which stands where it stood: the name's link is held at 22.77px less than the thread link's shift, the figure the index's manifest holds it to.
 *  - A board's last post also names its thread, ahead of the poster's name and on the same wrapping line, which the board does not draw: the name stands
 *    104px to the right of where the board draws it, the time wraps to a line of its own at the left (-237px, +22.5px more than before), and Who is online and
 *    the footer stand about 20.6px lower again.
 *  - The last post has a line of its own under the threads' count, led by "last:" (docs/plans/2026-11-12-list-rows-design.md, section 2.1, which replaces
 *    the board look's one flowing line): each part is held to where it now stands, measured: the name at +38.91px across and +30.58 down, the time at
 *    +38.91 across and +28.19 down, and Who is online and the footer 20px lower again (+46.56, +50.91).
 *  - The build's host is the page's own address, the board's "dw.gripe", so it is not compared; the dates read against the real clock, as 02-board's.
 *  - The board's screen (the second, the `also` side) is held at the offset it stands on the board page. The build's board name stands 61px lower (the card
 *    banner keeps the room of a card's mark, and the crumb sits under the banner); the description stands a line lower (Start a thread
 *    +62.6, the table +58.7); the pinned row takes the pin's mark on a line of its own under the title (a narrow phone wraps it, so its tile never straddles the
 *    starter's 24px target), where the board draws it beside the title, so the next row stands 60px lower again (+118.3). The board draws no key under the
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
    { id: 'general-about', role: 'text', name: 'Anything and everything. The staff are watching.', box: 'position', buildShift: { y: 14.8 } },
    { id: 'last-who', role: 'link', name: 'Mrs. Hooligan', nth: 0, box: 'position', buildShift: { x: 16.14, y: 30.58 } },
    { id: 'last-time', role: 'link', name: 'Oct 6', buildName: 'Oct 6 — latest post in General', box: 'position', buildShift: { x: 38.91, y: 28.19 } },
    { id: 'online', role: 'heading', name: 'Who is online', buildShift: { y: 46.56 } },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', type: false, buildShift: { y: 50.91 } },
  ],
  /* The second screen, a board's thread list, stands 414px to the right on the board page (the screens 24px apart): the build is the story `Boards/02 Board`, held at that offset. */
  also: [{
    name: 'board',
    build: { story: 'boards-02-board--board' },
    landmarks: [
      { id: 'title', role: 'heading', name: 'General', box: 'position', buildShift: { x: -414, y: 60.8 } },
      { id: 'start', role: 'button', name: 'Start a thread', buildShift: { x: -414, y: 62.6 } },
      { id: 'pin-title', role: 'link', name: 'who keeps splatting my posts', box: 'position', buildShift: { x: -414, y: 58.7 } },
      { id: 'new-title', role: 'link', name: 'Rate my avatar', box: 'position', buildShift: { x: -414, y: 118.3 } },
    ],
  }],
};

export default manifest;
