/**
 * Board 08, a profile, in the Silver house theme (docs/research/2026-11-06-board-look/08-profile.html, 1440 by 1700; 08-profile-dark.html is the
 * same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): Spritey's "About" table, each fact a row whose label is a
 * row header, the signature under them, and its public record's latest rows under their band with See the full record at the right, as the story
 * `Boards/08 Profile` (engine/ui/profile/Profile.board.stories.tsx) draws them.
 *
 * Departures, each a decision:
 *  - The cosmetics are the cosmetics plan's (docs/plans/2026-11-04-cosmetics-plan.md, its Task 10, which takes this board's look for the Wearing row,
 *    the trophy case and the belt's lineage): the board's portrait dressed in a cap, a mustache and a button is the build's initial, the Wearing row
 *    is not drawn, and the trophy case and the lineage tables between the About table and the record are not drawn, so the record stands higher
 *    by their height and is compared from its own band. The avatar is decoration (the name beside it says who) and is not compared.
 *  - The words and numbers are the story's: its Aura, rank and counts are not the board's (a rank and its Aura agree in the build; the board's
 *    1.85 is a Main Eventer's), so a fact is held by its label and its place, never by its value; Place's link and the class fact's words are the same.
 *  - The build's nav is named Main and its staff board The System until the plan's Task 11 gives it its name, as in 02-board; the host and tagline are not repeated.
 *  - The story's times are read against the real clock, so no time is a landmark; a record row is held by its place and its words.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/08-profile',
  size: { width: 1440, height: 1700 },
  build: { story: 'boards-08-profile--profile' },
  landmarks: [
    { id: 'logo', role: 'text', buildRole: 'link', name: 'DIVIDED WORLD', buildName: 'Divided World' },
    { id: 'nav', role: 'navigation', name: 'Boards', buildName: 'Main', type: false },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav' },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav' },
    { id: 'nav-system', role: 'link', name: 'Staff Announcements', buildName: 'The System', within: 'nav', box: 'position', type: false },
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'title', role: 'heading', name: 'Spritey', buildShift: { y: 35.6 } },
    { id: 'about', role: 'table', name: 'About Spritey', type: false, buildShift: { y: 38.6, height: -33.4 } },
    { id: 'about-band', role: 'columnheader', name: 'About Spritey', within: 'about', origin: 'about' },
    { id: 'fact-title', role: 'rowheader', name: 'Title', within: 'about', origin: 'about' },
    { id: 'fact-rank', role: 'rowheader', name: 'Rank', within: 'about', origin: 'about' },
    { id: 'fact-aura-this-season', role: 'rowheader', name: 'Aura this season', within: 'about', origin: 'about' },
    { id: 'fact-place', role: 'rowheader', name: 'Place', within: 'about', origin: 'about' },
    { id: 'fact-posts', role: 'rowheader', name: 'Posts', within: 'about', origin: 'about' },
    { id: 'fact-threads-spun', role: 'rowheader', name: 'Threads spun', within: 'about', origin: 'about' },
    { id: 'fact-cards-played', role: 'rowheader', name: 'Cards played', within: 'about', origin: 'about' },
    { id: 'fact-joined', role: 'rowheader', name: 'Joined', within: 'about', origin: 'about' },
    { id: 'fact-class', role: 'rowheader', name: 'Class', within: 'about', origin: 'about', buildShift: { y: -34.4 } },
    { id: 'fact-title-words', role: 'cell', name: 'Level editor guy', within: 'about', origin: 'about' },
    { id: 'standings', role: 'link', name: 'season standings', within: 'about', origin: 'about', box: 'position' },
    { id: 'signature', role: 'text', name: 'posting in pencil since 2003', within: 'about', origin: 'about', box: 'position', buildShift: { y: -33.6 } },
    { id: 'record', role: 'table', name: 'Latest rows of the public record, newest first', type: false, buildShift: { y: -451.6, height: 5.4 } },
    { id: 'record-band', role: 'heading', name: 'Public record', within: 'record', origin: 'record' },
    { id: 'record-when', role: 'columnheader', name: 'When', within: 'record', origin: 'record' },
    { id: 'record-what', role: 'columnheader', name: 'What', within: 'record', origin: 'record' },
    { id: 'see-all', role: 'link', name: 'See the full record', buildShift: { y: -447.7 } },
    { id: 'footer', role: 'contentinfo', name: '', box: 'position', type: false, buildShift: { y: -448.7 } },
  ],
};

export default manifest;
