/**
 * Board 05, a thread scrolled to its foot, in the Silver house theme (docs/research/2026-11-06-board-look/05-reply.html, 1440 by 1000; 05-reply-dark.html
 * is compared on colors only): the last post, the bottom pager with Unfollow this thread at its right, the reply box, Users browsing this thread and
 * the footer. The build is the fixture moment 01-main, which is not scrolled and whose last post is #46 where the board's is #43, so each part is
 * measured from the last post: the post's own corner for what is inside it, its bottom edge for what follows it.
 *
 * What this task (the board-look plan's Task 6) owns here is the post's three cells at the thread's foot and the bottom row (the pager and Unfollow).
 * Departures, each a decision:
 *  - The reply box ("Reply", "Posting as", the nine formatting buttons, the box, the count, Preview, Send and Reveal), Users browsing this thread and
 *    the footer are drawn by the board and left out until Task 7 (the reply box) builds them; this manifest compares none of them yet.
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
    { id: 'unfollow', role: 'button', name: 'Unfollow this thread', origin: 'last-spin', originEdge: 'bottom', box: 'position', buildSize: 12.5, buildShift: { x: -18.3 } },
  ],
};

export default manifest;
