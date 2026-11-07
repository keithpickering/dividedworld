/**
 * Board 37, the admin queue (docs/research/2026-11-05-backfill/37-admin-queue.html, 1440 by 1640): the queue first (To do, Waiting to land, In force,
 * Ended) with a move waiting and one in force, then How players reach you as its own section, ruled off, its two fields of each row labeled in view and
 * Remove shown. The build is the story `Boards/00 Admin queue` (engine/ui/admin/Queue.board.stories.tsx), the mock's sample world with the board's two
 * ways to reach the admins. This file also exports the phone drawing, board 39 (`phone`), whose second screen, Write an update, is board 38's build.
 *
 * Every part is held from a part above it, and a part under a paragraph or a block whose height a renderer could change by a line is held from that
 * part's bottom edge (`originEdge: 'bottom'`), so a wrapped line never moves what follows it. The first group is held from the lead's bottom, a group's
 * parts from its head, the next head from the bottom of the part above.
 *
 * Departures by decision:
 *  - The page head leaves 36px under the title where the board's lead stands 8px under it (the glass polish, design section 2), so the lead is 30px lower, and
 *    the first group stands 11px lower than the board's (the board overlaps the lead's box by 11px).
 *  - A group's head is the glass's display token, 40px, where the board draws 44px (`buildSize`).
 *  - A move is drawn in the build's fuller words (the board's are shorter: a demand's sentence, the why's name, the progress line "5 of 12, counted …"), so
 *    its article is taller than the board's, and its countdown and button stand lower in it, as the grid centers them: the shifts below are what the
 *    first run measured. The count of the move in force is the build's own world's (5 of 12), not the board's 7.
 *  - The build also draws the Mod Bots' cards group between In force and Ended (a heading and its empty line), which the board does not draw; Ended is
 *    held from In force's REVERSE with that group's height as its shift. Ended's head carries its count in the build (the board's carries none).
 *  - A waiting rename also carries Replace description, a button under HOLD (shut until pressed, so the row keeps the board's width and wrapping), which
 *    the board does not draw; the row centers HOLD higher by half of it, so HOLD stands 22px higher than it did, and In force 22px lower from HOLD's bottom (HOLD's own shift is smaller, the head's larger). On the phone the
 *    button stands under HOLD in the column, so In force stands 48px lower from HOLD's bottom.
 *  - The build also draws the Boards group (each board with its description and a shut Replace description) between Ended and How players reach you, which
 *    the board does not draw; How players reach you is held from Ended's bottom with that group's height as its shift. The staff board's name,
 *    Staff Announcements (the board look's Task 11), takes one more line in its row than The System did, 31.2px of that group.
 *  - The warning's color is the glass's lighter text token for it (contrast on the smoke), so the countdown's type is not compared.
 *  - The labels of the contact rows are the glass's label size, 20px, where the board draws 19px.
 *  - A button's measure is the glass's own, so a button is compared by its place and not its size.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the part named (the title's corner unless `origin` says another). */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'title', box: 'position', ...more });

/** A row's Remove: the board's `.btn` is 56px tall and 25px wider than the glass's, at the row's right edge and its input's foot, so the build's 48px button stands lower and further right by what the first run measured. */
const REMOVE = { x: 24.7, y: 22.1 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/37-admin-queue',
  size: { width: 1440, height: 1640 },
  build: { story: 'boards-00-admin-queue--admin-queue' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false, box: 'height' },
    { id: 'title', role: 'heading', name: "THE SYSTEM'S MOVES", buildName: "The System's moves", box: 'position' },
    at('lead', 'text', 'Moves that reshape a board wait here before they land, and land unless you hold them. Anything in force can be reversed. Players never see a held move.', { type: false, buildShift: { y: 30 } }),
    at('todo-head', 'heading', 'TO DO 0', { buildName: 'To do 0', buildSize: 40, buildShift: { y: 11 }, origin: 'lead', originEdge: 'bottom' }),
    at('todo-empty', 'text', 'Nothing to do.', { origin: 'todo-head' }),
    at('waiting-head', 'heading', 'WAITING TO LAND 1', { buildName: 'Waiting to land 1', buildSize: 40, origin: 'todo-empty', originEdge: 'bottom' }),
    at('countdown', 'text', 'IN 17 HOURS', { origin: 'waiting-head', type: false, buildShift: { y: 23.2 } }),
    at('hold', 'button', 'HOLD', { buildName: 'Hold: Small Soldiers Situation Room', origin: 'waiting-head', buildShift: { y: 9.6 } }),
    at('force-head', 'heading', 'IN FORCE 1', { buildName: 'In force 1', buildSize: 40, origin: 'hold', originEdge: 'bottom', buildShift: { y: 59.6 } }),
    at('reverse', 'button', 'REVERSE', { buildName: 'Reverse: Pointless Toast Palace', origin: 'force-head' }),
    at('ended', 'text', '· the last 30 days, with how each ended ›', { origin: 'reverse', originEdge: 'bottom', buildShift: { x: 23, y: 151.5 } }),
    at('reach-head', 'heading', 'HOW PLAYERS REACH YOU', { buildName: 'How players reach you', buildSize: 40, origin: 'ended', originEdge: 'bottom', buildShift: { x: -17.4, y: 592.1 } }),
    at('reach-note', 'text', 'Players read these on the Reach a person page, which they can open signed out. Up to 5 links, each a label and an address: a web address that starts with https://, or an email address.', { origin: 'reach-head', type: false }),
    at('label-1', 'text', 'LABEL', { nth: 0, origin: 'reach-note', originEdge: 'bottom', buildSize: 20 }),
    at('address-1', 'text', 'ADDRESS', { nth: 0, origin: 'reach-note', originEdge: 'bottom', buildSize: 20 }),
    at('label-2', 'text', 'LABEL', { nth: 1, origin: 'reach-note', originEdge: 'bottom', buildSize: 20 }),
    at('remove-1', 'button', 'Remove link 1', { origin: 'reach-note', originEdge: 'bottom', type: false, buildShift: REMOVE }),
    at('remove-2', 'button', 'Remove link 2', { origin: 'reach-note', originEdge: 'bottom', type: false, buildShift: REMOVE }),
    at('add', 'button', 'ADD A LINK', { buildName: 'Add a link', origin: 'reach-note', originEdge: 'bottom', type: false }),
    at('save', 'button', 'SAVE HOW PLAYERS REACH YOU', { buildName: 'Save how players reach you', origin: 'reach-note', originEdge: 'bottom', type: false, box: 'height' }),
  ],
};
export default manifest;

/*
 * Board 39, the admin screens on a phone (docs/research/2026-11-05-backfill/39-admin-phone.html): two phone screens at 390 by 844 side by side on one page,
 * the queue and Write an update. A phone board has one parent and is compared at 390 by 844, so this export is the whole board: the queue is its own side, and
 * Write an update is a further side (`also`), a story of its own against the same page, which is opened at 390 wide with its two screens at x = 20 and 430.
 * Each landmark is found as its screen's nth (`nth`, where the build has one of each) and measured from that screen's menu bar (`origin`), so a screen's place
 * on the page is never compared.
 */
const PHONE = '2026-11-05-backfill/39-admin-phone';

const bar = (nth: number): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', nth, buildNth: 0, type: false, box: 'none' },
  { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
];

const on = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'menu', box: 'position', type: false, ...more });


/*
 * What the phone board draws that the build does not follow, by decision: the board's screens are cut from the middle of each page (the queue from its
 * Waiting group, Write an update from its head), where the build draws the whole page: the title and lead and To do above the queue, and Updates' title, lede
 * and the Write an update button above the form, which also has its note under the head. So a screen's first part stands lower than the board's, by the shift
 * measured, and each part under it is held from that first part, at the shift the build's fuller words and spacing make. Write an update's
 * head stands 266.5px lower: the page's title and lede are above the form. Its presses end with `scroll: 'top'`, since a fill scrolls the page
 * by how the hint under What changed wraps, and the sticky bar then stands over a page that has moved with it (CI's narrower text moved it
 * 26px). The phone's menu is a Back row with the tabs in a row of their own under it, which the board draws as Back alone, so the bar is not compared by its size. No type on this board is compared (the build sets a phone in
 * the glass's phone tokens), and a button's measure is the glass's own.
 */
export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-00-admin-queue--admin-queue-phone' },
  landmarks: [
    ...bar(0),
    on('waiting-head', 'heading', 'WAITING TO LAND 1', { buildName: 'Waiting to land 1', buildShift: { y: 541.4 } }),
    on('countdown', 'text', 'IN 17 HOURS', { origin: 'waiting-head', buildShift: { y: 11 } }),
    on('why', 'text', 'Changes back when 8 different characters post there, or Nov 14.', { buildName: "Why, in The Director's words: “Games has gone soft. Time for discipline.”", origin: 'waiting-head', box: 'none' }),
    on('hold', 'button', 'HOLD', { buildName: 'Hold: Small Soldiers Situation Room', origin: 'why', originEdge: 'bottom' }),
    on('force-head', 'heading', 'IN FORCE 1', { buildName: 'In force 1', origin: 'hold', originEdge: 'bottom', buildShift: { y: 48 } }),
    on('since', 'text', 'SINCE OCT 30', { buildName: 'SINCE OCT 28', origin: 'force-head', buildShift: { y: 11 } }),
    on('progress', 'text', '7 of 12', { buildName: '5 of 12, counted Oct 29, 12:00 PM', origin: 'force-head', box: 'none' }),
    on('reverse', 'button', 'REVERSE', { buildName: 'Reverse: Pointless Toast Palace', origin: 'progress', originEdge: 'bottom' }),
  ],
  also: [
    {
      name: 'Write an update',
      build: { story: 'boards-00-write-update--write-update-phone' },
      press: [
        { role: 'button', name: 'Write an update' },
        { role: 'textbox', name: 'Title', fill: 'Whoops! costs less on short posts' },
        { role: 'textbox', name: 'Words', fill: 'A long post still costs more to splat.' },
        { role: 'textbox', name: 'Change 1 label', fill: 'Whoops!' },
        { role: 'textbox', name: 'Change 1 text', fill: '0.25 more for every 500 characters.' },
        { scroll: 'top' },
      ],
      landmarks: [
        ...bar(1),
        on('head', 'heading', 'WRITE AN UPDATE', { buildName: 'Write an update', buildShift: { x: 17.3, y: 266.5 } }),
        on('title-label', 'text', 'TITLE', { origin: 'head', buildShift: { y: 102.5 } }),
        on('words-label', 'text', 'WORDS', { origin: 'head', buildShift: { y: 104.1 } }),
        on('count', 'text', '38 of 20000', { origin: 'head', buildName: '38 of 20000', buildShift: { x: -22, y: 136.7 } }),
        on('changed-label', 'text', 'WHAT CHANGED', { origin: 'head', buildShift: { y: 142.9 } }),
        /* The build's hint under What changed (the board's phone omits it) wraps in as many lines as the renderer sets, which moves what is under it: these are found, and held on the 1440 board. */
        on('remove', 'button', 'Remove change 1', { origin: 'head', box: 'none' }),
        on('add', 'button', 'ADD A CHANGE', { buildName: 'Add a change', origin: 'head', box: 'none' }),
        on('post', 'button', 'POST UPDATE', { buildName: 'Post update', origin: 'head', box: 'none' }),
      ],
    },
  ],
};
