/**
 * Board 14, a staff character's profile, in the Silver house theme (docs/research/2026-11-06-board-look/14-staff.html, 1440 by 1000; 14-staff-dark.html
 * is the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): the Director's "About" table (its badges, title, interests,
 * favorite members, mood, career, posts and joined as label rows, the signature and the plain note closing it) and its moderation log as one full-width
 * table under it, as the story `Boards/14 Staff` (engine/ui/profile/Staff.board.stories.tsx) draws them.
 *
 * Departures, each a decision:
 *  - The labels' words are the build's: "Favorite Members" and "Current Mood" where the board draws "Favorite members" and "Current mood" (each fact's words
 *    are kept); the build's nav is named Main, as in 02-board.
 *  - The story's world is the move world's (engine/ui/board/move-world.ts): its log's four rows rename General and Off Topic (the board draws General for all
 *    four) and their dates are the clock's; its Posts and Joined are the world's. A log row is held by its place and its end, never by its words or date.
 *  - The crumb and the title stand 8.1px and 35.6px lower than the board draws them, and the About table 38.6px lower and 7.4px shorter, as in 08-profile; the log's
 *    table is named by the build's words (the board's caption reads "The Director's moves, newest first") and is held by its place.
 *  - The log stands 26.2px lower than the board's (the card's rows are taller by their 24px targets and its gap is the profile's); the build's nav reads the renamed
 *    board's name (Pointless Toast Palace) where the board draws General, so the staff board's link stands 95.1px to the right.
 *  - The avatar is decoration and is not compared; the badges' chips are held by their words.
 *  - The Group row (docs/plans/2026-11-06-member-groups-design.md, the member groups plan's Task 12) stands after Title, which the board, drawn before it,
 *    does not hold: the About table is that much taller, and every fact under Title and the log stand GROUP_ROW lower.
 */
import type { BoardManifest } from '../../board-match.ts';

/** The Group row's room in the About table at 1440, in px: its row and its grid line. */
const GROUP_ROW = 39.5;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/14-staff',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-14-staff--staff' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'nav', role: 'navigation', name: 'Boards', buildName: 'Main', type: false },
    { id: 'nav-system', role: 'link', name: 'Staff Announcements', within: 'nav', box: 'position', type: false, buildShift: { x: 95.1 } },
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'title', role: 'heading', name: 'The Director', box: 'position', buildShift: { y: 35.6 } },
    { id: 'about', role: 'table', name: 'About The Director', type: false, buildShift: { y: 38.6, height: -7.4 + GROUP_ROW } },
    { id: 'about-band', role: 'columnheader', name: 'About The Director', within: 'about', origin: 'about' },
    { id: 'fact-staff', role: 'rowheader', name: 'Staff', within: 'about', origin: 'about' },
    { id: 'fact-title', role: 'rowheader', name: 'Title', within: 'about', origin: 'about' },
    { id: 'fact-interests', role: 'rowheader', name: 'Interests', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'fact-favorites', role: 'rowheader', name: 'Favorite members', buildName: 'Favorite Members', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'fact-mood', role: 'rowheader', name: 'Current mood', buildName: 'Current Mood', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'fact-career', role: 'rowheader', name: 'Career', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'fact-posts', role: 'rowheader', name: 'Posts', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'fact-joined', role: 'rowheader', name: 'Joined', within: 'about', origin: 'about', buildShift: { y: GROUP_ROW } },
    { id: 'log', role: 'table', name: 'The Director’s moves, newest first', buildName: 'Moderation log', type: false, box: 'position', buildShift: { y: 26.2 + GROUP_ROW } },
    { id: 'log-band', role: 'heading', name: 'Moderation log', within: 'log', origin: 'log' },
    { id: 'log-when', role: 'columnheader', name: 'When', within: 'log', origin: 'log' },
    { id: 'log-did', role: 'columnheader', name: 'What it did', within: 'log', origin: 'log' },
    { id: 'log-ended', role: 'columnheader', name: 'How it ended', within: 'log', origin: 'log' },
  ],
};

export default manifest;
