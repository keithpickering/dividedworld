/**
 * Board 13, Rankings (docs/research/2026-10-29-two-worlds/13-rankings.html, 1440 by 1034): the season
 * as the player sees it at 08:30 on Oct 30, after the settlement (the fixture's 13-rankings moment).
 * No two-worlds board drew Rankings; this one was drawn from its story
 * (engine/ui/rankings/Rankings.board.stories.tsx) once the owner approved it (issue #50), so it is
 * compared in full: the menu bar with Rankings current, the heading and the season's line, the lead,
 * the table's heads, and every row's name, place, rank and standing, the player's own three marked
 * Yours, and the classes, with both ways a stranger's class shows (Gloomba's reveal; Thwompson's,
 * Turned since).
 *
 * The season's line and the dates are in the reader's own time; the board draws them in UTC, and the
 * board match opens both pages in UTC (e2e/boards.spec.ts), whatever the machine's zone.
 */
import type { BoardManifest, Landmark } from '../board-match.ts';

/** How many cells of each text the rows before have: a cell is found in the table by its text and its place among those. */
const seen = new Map<string, number>();
const cell = (id: string, name: string): Landmark => {
  const nth = seen.get(name) ?? 0;
  seen.set(name, nth + 1);
  return { id, role: 'cell', name, within: 'table', nth, origin: 'table' };
};

/** A row: its header (the name, with Yours on the player's own), its link, and its place, rank and standing. */
function row(n: number, name: string, place: string, rank: string, standing: string, own: boolean): Landmark[] {
  const id = `row-${n}`;
  return [
    { id, role: 'rowheader', name: own ? `${name} Yours` : name, within: 'table', type: false, origin: 'table' },
    { id: `${id}-name`, role: 'link', name, within: id, origin: 'table' },
    ...(own ? [{ id: `${id}-yours`, role: 'text', name: 'Yours', within: id, origin: 'table' }] : []),
    cell(`${id}-place`, place),
    cell(`${id}-rank`, rank),
    cell(`${id}-standing`, standing),
  ];
}

const manifest: BoardManifest = {
  board: '13-rankings',
  size: { width: 1440, height: 1034 },
  build: { moment: '13-rankings' },
  landmarks: [
    /*
     * The menu bar, as boards 06, 07, 10, 11 and 12 draw it, with Rankings the current page. Back's
     * name: the board's ESC key cap is in the link's text, where the build hides it from the
     * accessibility tree and names the link by its words (engine/ui/glass/MenuBar.tsx), as the Main
     * board's manifest says of the HUD's Menu button. The tabs are compared in full, the Vending
     * Machine's among them (the glass build's Part 3 added it).
     */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC Back to the board', buildName: 'Back to the board', within: 'menu', box: 'height' },
    /*
     * REVISED by the alerts design (docs/plans/2026-11-02-alerts-design.md, sections 4, 6 and 7; the menu as docs/research/2026-11-02-alerts/02-alerts.html draws it):
     * the tabs are now Alerts, Vending Machine, My characters, Season, My log, Updates and Settings after Back, and Rankings is the Season
     * tab's page. This board is a record of the earlier menu and is not edited, so the build's tabs sit further right than this board
     * draws them (the new menu sets its tabs 16px padded and spaced 1.5px, with Back 8px further left, to hold eight): Back and each tab are compared by their y and height and their type, not their x and width. The Season tab is this board's Rankings. The new menu
     * is held in full by e2e/boards/02-alerts.ts.
     */
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu', box: 'height' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu', box: 'height' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', buildName: 'Season', within: 'menu', box: 'height' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu', box: 'height' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu', box: 'height' },

    /* The heading, the season's line and the lead. */
    /*
     * REVISED by the alerts design (docs/plans/2026-11-02-alerts-design.md, section 7; docs/research/2026-11-02-alerts/04-season-news.html): Rankings is
     * the Season page's first tab, under the heading "Season 1" with the tabs beside it and the season's line beneath, so this board's heading and
     * line are not where the page now puts them, and the table sits 82px lower. This board is a record and is not edited: the heading, the line and
     * the lead are found and compared by their type, and the table, its heads and every row are compared as they sit in the table (`origin`), as the
     * Main board's posts are from their own corner. The page's heading, tabs and News tab are held by e2e/boards/04-season-news.ts.
     */
    { id: 'title', role: 'heading', name: 'Rankings', buildName: 'Season 1', box: 'none' },
    { id: 'season', role: 'text', name: 'Season 1 · Settled Oct 30, 8:17 AM', box: 'none' },
    { id: 'lead', box: 'none', role: 'text', name: 'The season\'s standings, as the last settlement left them. Your own characters are marked, with their classes, which only you see here. Anyone else\'s class shows only once its player has revealed it.' },

    /* The table and its heads. */
    { id: 'table', role: 'table', name: 'Season 1 rankings, highest standing first', type: false, box: 'size' },
    { id: 'head-place', role: 'columnheader', name: 'Place', within: 'table', origin: 'table' },
    { id: 'head-character', role: 'columnheader', name: 'Character', within: 'table', origin: 'table' },
    { id: 'head-rank', role: 'columnheader', name: 'Rank', within: 'table', origin: 'table' },
    { id: 'head-standing', role: 'columnheader', name: 'Standing', within: 'table', origin: 'table' },
    { id: 'head-class', role: 'columnheader', name: 'Class', within: 'table', origin: 'table' },

    /* Every row, in the standings' order. */
    ...row(1, 'Spritey', '1', 'Main Eventer', '6.50', true),
    ...row(2, 'Mrs. Hooligan', '2', 'Midcarder', '4.20', true),
    ...row(3, 'Pipewrench', '3', 'Midcarder', '3.30', true),
    ...row(4, 'Gloomba', '4', 'Enhancement Talent', '1.80', false),
    ...row(5, 'Thwompson', '5', 'Jobber', '0.40', false),
    ...row(6, 'Ringside 1', '6', 'Jobber', '0.00', false),
    ...row(7, 'Ringside 2', '6', 'Jobber', '0.00', false),
    ...row(8, 'Ringside 3', '6', 'Jobber', '0.00', false),
    ...row(9, 'Ringside 4', '6', 'Jobber', '0.00', false),

    /* The classes, by their words in the table: the player's own filled, the two said in public outlined with their dates. */
    { id: 'class-spritey', role: 'text', name: 'Jabroni', within: 'table', origin: 'table' },
    { id: 'class-hooligan', role: 'text', name: 'Face', within: 'table', nth: 0, origin: 'table' },
    { id: 'class-pipewrench', role: 'text', name: 'Face', within: 'table', nth: 1, origin: 'table' },
    { id: 'class-gloomba', role: 'text', name: 'Heel', within: 'table', origin: 'table' },
    { id: 'revealed-gloomba', role: 'text', name: 'Revealed Oct 30', within: 'table', origin: 'table' },
    { id: 'class-thwompson', role: 'text', name: 'Lurker', within: 'table', origin: 'table' },
    { id: 'revealed-thwompson', role: 'text', name: 'Revealed Oct 8', within: 'table', origin: 'table' },
    { id: 'turned-thwompson', role: 'text', name: 'Has Turned since Oct 30', within: 'table', origin: 'table' },
    /* No class for the rest: the dash is hidden from a reader and "Not revealed" from the eye, so each dash is compared by its box and type. */
    ...[1, 2, 3, 4].map((n): Landmark => ({ id: `none-ringside-${n}`, role: 'text', name: '—', within: 'table', nth: n - 1, origin: 'table' })),
  ],
};

export default manifest;
