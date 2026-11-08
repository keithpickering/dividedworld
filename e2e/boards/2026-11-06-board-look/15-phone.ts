/**
 * Board 15, the staff on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/15-phone.html, four screens at 390 by 844 side by side:
 * the move notice and the Director's profile in light, then both in dark, compared on colors only, by web/contrast.test.tsx). The first screen is the move
 * notice, the story `Boards/11 Move notice` at the window's left; the second, the Director's profile, is the `also` side below, the story `Boards/14 Staff`
 * read at 414px (the screen's width and the 24px between screens) to the window's left.
 *
 * Departures, each a decision:
 *  - The label's words are the board's (the build sets them in capitals), as in 11-move-notice; on the phone each of its segments keeps its words whole and Way out wraps
 *    under the label, which the glass's own face sets, so the label is held by its place and its width, not its type.
 *  - The label is in the flow on the phone, over the frame's top edge by 14px, so a label that wraps pushes the notice down and never covers its band: the notice
 *    stands 90.4px lower and 14.5px taller (the label's own line or two above it, and the band's room for it), its band and the Boss's link 14.2px lower in it, and
 *    Start a thread 104.9px lower.
 *  - The profile screen: the board draws two tables (the avatar beside the badges and the title, then the facts under them), the build is one table (Task 9's
 *    grid, whose label column the avatar cell shares); the badge and title rows stand where that grid puts them, and the facts and the log are held by their
 *    labels and their places. The log's rows read as blocks, each date over its words with the end under them, which the story's words and dates fill.
 *    Its Group row (docs/plans/2026-11-06-member-groups-design.md, the member groups plan's Task 12) stands after Title, which the board, drawn before it,
 *    does not hold: every fact under it stands GROUP_ROW lower.
 *  - The profile's Pronouns row (the pronouns plan, docs/plans/2026-11-07-pronouns-plan.md) is the build's and not the board's: it stands after the title, so
 *    every fact under it stands a row (33px) lower than where the grid alone puts it.
 *  - The build's nav is a boards button where the board draws one; the banner and the crumb stand lower than the board draws them, as in 03-phone and 07-phone.
 */
import type { BoardManifest } from '../../board-match.ts';

const SCREEN = -414;
/** The Group row's room on the phone, in px: its label over its value. */
const GROUP_ROW = 35;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/15-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-11-move-notice--move-notice' },
  landmarks: [
    { id: 'title', role: 'heading', name: 'Pointless Toast Palace', box: 'position', buildShift: { y: 60.8 } },
    { id: 'notice', role: 'table', name: '', buildName: 'Announcement from The Director', type: false, buildShift: { y: 90.4, height: 14.5 } },
    { id: 'notice-band', role: 'text', name: 'Announcement from The Director', within: 'notice', origin: 'notice', box: 'position', buildShift: { y: 14.2 } },
    { id: 'notice-boss', role: 'link', name: 'The Director', within: 'notice', origin: 'notice', buildShift: { y: 14.2 } },
    { id: 'start', role: 'button', name: 'Start a thread', box: 'position', buildShift: { y: 104.9 } },
  ],
  also: [{
    name: 'staff',
    build: { story: 'boards-14-staff--staff' },
    landmarks: [
      { id: 'title', role: 'heading', name: 'The Director', box: 'position', buildShift: { x: SCREEN, y: 52.6 } },
      { id: 'fact-interests', role: 'rowheader', name: 'Interests', box: 'position', buildShift: { x: SCREEN, y: 73.5 + GROUP_ROW } },
      { id: 'fact-mood', role: 'rowheader', name: 'Current mood', buildName: 'Current Mood', box: 'position', buildShift: { x: SCREEN, y: 73.5 + GROUP_ROW } },
      { id: 'fact-career', role: 'rowheader', name: 'Career', box: 'position', buildShift: { x: SCREEN, y: 73.5 + GROUP_ROW } },
      { id: 'fact-posts', role: 'rowheader', name: 'Posts', box: 'position', buildShift: { x: SCREEN, y: 73.5 + GROUP_ROW } },
      { id: 'fact-joined', role: 'rowheader', name: 'Joined', box: 'position', buildShift: { x: SCREEN, y: 73.5 + GROUP_ROW } },
    ],
  }],
};

export default manifest;
