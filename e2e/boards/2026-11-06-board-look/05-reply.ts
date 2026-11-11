/**
 * Board 05, a thread scrolled to its foot, in the Silver house theme (docs/research/2026-11-06-board-look/05-reply.html, 1440 by 1000; 05-reply-dark.html
 * is compared on colors only): the last post, the bottom pager with Unfollow this thread at its right, the reply box, Users browsing this thread and
 * the footer. The build is the fixture moment 01-main, which is not scrolled and whose last post is #46 where the board's is #43, so each part is
 * measured from the last post: the post's own corner for what is inside it, its bottom edge for what follows it.
 *
 * What this task (the board-look plan's Task 6) owns here is the post's three cells at the thread's foot and the bottom row (the pager and Unfollow).
 * Departures, each a decision:
 *  - Users browsing this thread and the footer stand 9.9px and 16.5px lower than the board's, under the reply box's own 10px and the footer's usual few more (as in 02-board).
 *  - The reply box (Task 7) is held from the last post's bottom edge like the pager: its band by its type alone (the board's is a cell with the heading inside it, the build's heading is the whole
 *    band), the form's parts standing 7.6px to 10.3px lower than the board's (the build's bottom row and the form's margin are a little taller), Preview at 12.5px where the board draws
 *    11.25px, and Preview and Send farther right by 64.8px and 69.3px: the build's foot is right-aligned and has no Reveal… to stand beside. Send is held by place alone: the build draws it disabled while the box is empty,
 *    its words grayed, where the board draws it ready. The board's text box is an empty div with no role, so it is not compared; the toolbar is held by place.
 *  - Left out: the board's Reveal… beside Preview. The build's reply box has none (the HUD's "Only you see this" opens the Reveal overlay instead; docs/plans/2026-11-06-hud-reveal-plan.md, Task 5), so the board image stays as drawn and no landmark holds it.
 *  - The build's last post is #46 (Gloomba's, with no Edit), the board's #43 (Pipewrench's, with Edit), so the actions row's Quote is measured from its Spin thread (nothing of the board's Edit or History sits between).
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/05-reply',
  size: { width: 1440, height: 1000 },
  build: { moment: '01-main' },
  landmarks: [
    /* The last post's Spin thread button is the corner everything here is measured from (the board's posts are table rows, which have no role to find): its own place is the post's actions, held by 04-thread. */
    { id: 'last-spin', role: 'button', name: 'Spin thread', buildNth: -1, box: 'none', buildSize: 12.5 },
    { id: 'last-quote', role: "button", name: "Quote", nth: 0, buildNth: -1, origin: 'last-spin', box: 'position', buildSize: 12.5, buildShift: { x: -11 } },
    { id: 'pager', role: 'navigation', name: 'Pages, bottom', origin: 'last-spin', originEdge: 'bottom', box: 'position', type: false },
    { id: 'pager-where', role: 'text', name: 'Page 3 of 3', within: 'pager', origin: 'last-spin', originEdge: 'bottom', box: 'position' },
    { id: 'pager-1', role: 'link', name: '1', buildName: 'Page 1', within: 'pager', origin: 'last-spin', originEdge: 'bottom', box: 'position' },
    { id: 'pager-here', role: 'text', name: '3', within: 'pager', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildShift: { x: 22.7 } },
    { id: 'pager-jump', role: 'link', name: 'Jump to latest', within: 'pager', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildShift: { x: 29.6 } },
    { id: 'reply-band', role: 'heading', name: 'Reply', origin: 'last-spin', originEdge: 'bottom', box: 'none' },
    { id: 'reply-as', role: 'text', name: 'Posting as Pipewrench', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildShift: { y: 7.6 } },
    { id: 'reply-tools', role: 'toolbar', name: 'Formatting', origin: 'last-spin', originEdge: 'bottom', box: 'position', type: false, buildShift: { y: 7.9 } },
    { id: 'reply-count', role: 'text', name: '0 of 20000', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildShift: { y: 9.5 } },
    { id: 'reply-preview', role: 'button', name: 'Preview', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildSize: 12.5, buildShift: { x: 64.8, y: 8.1 } },
    { id: 'reply-send', role: 'button', name: 'Send', origin: 'last-spin', originEdge: 'bottom', box: 'position', type: false, buildShift: { x: 69.3, y: 10.3 } },
    { id: 'browsing', role: 'heading', name: 'Users browsing this thread', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildShift: { y: 9.9 } },
    { id: 'footer', role: 'contentinfo', name: '', origin: 'last-spin', originEdge: 'bottom', box: 'position', type: false, buildShift: { y: 16.5 } },
    { id: 'unfollow', role: 'button', name: 'Unfollow this thread', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildSize: 12.5, buildShift: { x: -18.3 } },
  ],
};

export default manifest;
