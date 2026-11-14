/**
 * Board 07, a thread, the reply box and Start a thread on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/07-phone.html, four
 * screens at 390 by 844 side by side; the fourth is the thread in dark, compared on colors only, by web/contrast.test.tsx). The page is read at 390, so
 * its first screen, the thread, stands at the window's left and is the one compared, as the fixture moment 01-main draws it (page 3 of "who keeps
 * splatting my posts", Pipewrench on the HUD). The reply box and Start a thread, its second and third screens, are held at 1440 by 05-reply and
 * 06-new-thread and by the phone tests (e2e/phone-board.spec.ts: the nine buttons in one row, the keyboard hint dropped).
 *
 * The board draws the phone's own words: the postbit is a band over its post (the avatar at its left, the name, the rank and its pips beside it), with
 * no Posts and no Joined, and a date in this year drops its year ("Oct 29, 9:14 PM").
 *
 * Departures, each a decision:
 *  - The banner stands 13px lower and the Boards button is a 44px target, as in 03-phone; the crumb and everything under it keep that offset.
 *  - The crumb stands 25px lower than the board draws it and the title 29px (the banner's 13px, the Boards button's growth, and the crumb's own gap); the
 *    pager and the first post's author stand 27 and 24px lower. The rank and the post's line are the phone postbit's departure below. The rank is set at the type scale's 13.75px, as the board draws it (the owner's word, 2026-11-13, PR #660).
 *  - The words under the post line are the fixture's, not the board's, so only each post's author, rank, line and permalink are compared.
 *  - The HUD is drawn for place only and is 01-main's.
 *  - The group bar (docs/plans/2026-11-06-member-groups-design.md, the look the owner approved in docs/research/2026-11-06-member-groups/01-bars.html,
 *    option A) stands under every character's name, which the board, drawn before it, does not. On a phone it stands under the rank and the title, in
 *    the right column, so it no longer pushes the rank down (see the next departure); it lengthens the column by its own room, which the band's height
 *    follows only where the column is taller than the avatar.
 *  - The phone's postbit draws the whole portrait, 3.6em wide and at most twice as tall, with the rank directly under the name, then the title, then the
 *    group bar (the owner's word, 2026-11-14, docs/plans/2026-11-14-mobile-postbit-design.md). The band's height is now the avatar's, so the rank stands
 *    19.1px lower than the board draws it, and the post's line and its permalink stand 31.4px
 *    lower, as the match measures them.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/07-phone',
  size: { width: 390, height: 844 },
  build: { moment: '01-main' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World', buildShift: { y: 13 } },
    { id: 'boards-button', role: 'button', name: 'boards', buildName: 'Boards', type: false, buildShift: { height: 14.25 } },
    { id: 'crumb-index', role: 'link', name: 'Index', buildShift: { y: 25.1 } },
    { id: 'crumb-board', role: 'link', name: 'General', buildShift: { y: 25.1 } },
    { id: 'title', role: 'heading', name: 'who keeps splatting my posts', buildShift: { y: 29.3 } },
    { id: 'pager-where', role: 'text', name: 'Page 3 of 3', buildShift: { y: 26.7 } },
    { id: 'post-41-author', role: 'link', name: 'Spritey', box: 'position', buildShift: { y: 23.6 } },
    { id: 'post-41-rank', role: 'text', name: 'Main Eventer', box: 'position', buildSize: 13.75, buildShift: { y: 19.1 } },
    { id: 'post-41-when', role: 'text', name: 'Oct 29, 9:14 PM', box: 'position', buildShift: { y: 31.4 } },
    { id: 'post-41-permalink', role: 'link', name: '#41', buildName: 'Permalink to post #41', box: 'position', buildShift: { y: 31.4 } },
  ],
};

export default manifest;
