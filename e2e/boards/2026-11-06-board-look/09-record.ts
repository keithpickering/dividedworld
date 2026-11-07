/**
 * Board 09, a character's full public record, in the Silver house theme (docs/research/2026-11-06-board-look/09-record.html, 1440 by 1000; 09-record-dark.html
 * is the same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): the crumb, the name's "public record", the six kinds as a
 * row of small Chrome buttons with the current one (All) pressed, the note under them, the table with its heads, and the pager, as the story `Boards/10 Record`
 * (engine/ui/profile/Record.board.stories.tsx, which is also the phone board's third screen) draws them.
 *
 * Departures, each a decision:
 *  - The story holds eight rows and one page where the board draws twelve of three pages, so the table is held by its top, its heads and its width, not its height,
 *    and the pager, which a single page does not draw, is not compared; what stands under the table (the footer) is not compared either.
 *  - The note's words are the build's ("past seasons" where the board says "season reveal posts"); it is held by its place alone.
 *  - A row's words and dates are the story's (a date reads "9 days ago" for a while and then a date), so no row is compared.
 *  - The kinds' buttons are held by their words, place and size: the current one (All) is no link, so Posts and Seasons stand for the row's ends.
 *  - The build's nav is named Main, as in 02-board.
 */
import type { BoardManifest } from '../../board-match.ts';

/** A small Chrome button's type: --kb-size-fine (12.5px), the board-look plan's Task 4, where the board draws it at 11.25px; its width follows (the button's words and padding at that size). */
const BUTTON_SIZE = 12.5;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/09-record',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-10-record--record' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'crumb-name', role: 'link', name: 'Spritey', buildShift: { y: 8.1 } },
    { id: 'title', role: 'heading', name: 'Spritey’s public record', buildShift: { y: 35.6 } },
    { id: 'kinds', role: 'navigation', name: 'Kind of row', type: false, buildShift: { y: 38.6 } },
    { id: 'kind-all', role: 'text', name: 'All', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE },
    { id: 'kind-posts', role: 'link', name: 'Posts', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE },
    { id: 'kind-spins', role: 'link', name: 'Spins', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE },
    { id: 'kind-cards', role: 'link', name: 'Cards', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE },
    { id: 'kind-class', role: 'link', name: 'Class statements', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE, buildShift: { x: 10, width: 11.8 } },
    { id: 'kind-seasons', role: 'link', name: 'Seasons', within: 'kinds', origin: 'kinds', buildSize: BUTTON_SIZE, buildShift: { x: 21.8, width: 5 } },
    { id: 'note', role: 'text', name: 'Its Acts with its reveals, announced Turns and season reveal posts, newest first.', buildName: 'Its Acts with its reveals, announced Turns and past seasons, newest first.', box: 'position', type: false, buildShift: { y: 47.1 } },
    { id: 'record', role: 'table', name: 'Public record, newest first', type: false, box: 'position', buildShift: { y: 50.9 } },
    { id: 'record-when', role: 'columnheader', name: 'When', within: 'record', origin: 'record' },
    { id: 'record-what', role: 'columnheader', name: 'What', within: 'record', origin: 'record' },
  ],
};

export default manifest;
