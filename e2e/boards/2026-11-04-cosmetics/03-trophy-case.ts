/**
 * Board 03, the trophy case (docs/research/2026-11-04-cosmetics/03-trophy-case.html, 1180 by 584): a profile with the gear named in words, the trophy case
 * (five awards, newest first, with who gave each and when) and the Hardcore Belt's lineage. The build is the story `Boards/03 Trophy case`
 * (engine/ui/profile/TrophyCase.board.stories.tsx): Pipewrench's profile on the Main board's layout, the case and the lineage drawn by TrophyCase.tsx, as the route
 * /c/:id draws them. The portrait and its gear are decoration (`aria-hidden`) and are not compared; the outfit's own tests hold them (engine/ui/gear/Outfit.test.tsx).
 * What is compared is each word and badge's name, its place from the page's name (`origin`) at the shift the first run measured, and its type where
 * the board's and the build's can be the same.
 *
 * Departures by decision:
 *  - The page is the house theme's profile (the board look's board 08, docs/plans/2026-11-06-board-look-design.md), which this board, drawn before it, does not
 *    know: the card is the "About" table with its avatar in the left column and the title, rank and counts as its rows (Group, Pronouns, Aura this season, Place, Posts,
 *    Threads spun and Cards played besides), with the nav, the HUD and the crumb above it, so the name stands 199px nearer the left and 85px lower, and the
 *    title, rank and Wearing row stand in the table's value column, 348px along. What is under the table stands lower by the rows the board does not draw
 *    (the Wearing row and the page's own gaps): the case's bar, its five rows and the lineage's bar and rows are held at the shifts measured.
 *  - The Wearing words are the row's cell, without the board's "Wearing:" and its full stop, and the board's "Posts: 212 · Joined Oct 2026" line is two rows of the table:
 *    neither is compared.
 *  - The glass's type scale (1.25 times) sets the board's 12px words at 15px and the badges' rows at 61px where the board draws 35; the bars are the house theme's light bar in
 *    the text color where the board draws white on black, and the table's values are black where the board's title is the quieter gray, so those are held by their words and place, not their type.
 *  - The trophies' names are the instance's own kinds ("Season Champion" where the board draws "Season 1 Champion", "Employee of the Month" where it draws "Sprite Contest 2026",
 *    "The Hardcore Belt" where it draws "Hardcore Belt"), and the build's words under each name are the kind's own line and who gave it ("Given by the Boss, Nov 2"), where the board
 *    draws its own longer notes ("taken from Sock Puppet by Sighbot, the Boss", "first of 22", "Season 1, ended Oct 1", "by Sighbot's move"): those words are the story's and are not compared.
 *  - The lineage's bar names the belt with the engine's own article, once ("The Hardcore Belt's lineage"); the board's holders are plain text where the build's are links to the profiles.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** The glass's type scale, 1.25 times the board's 12px. */
const BODY = 15;

/** A part measured from the page's name, at the shift the first run measured (build minus board). */
const at = (id: string, role: string, name: string, shift: { x?: number; y?: number }, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'name', box: 'position', buildSize: BODY, buildShift: shift, ...more,
});

const manifest: BoardManifest = {
  board: '2026-11-04-cosmetics/03-trophy-case',
  size: { width: 1180, height: 584 },
  build: { story: 'boards-03-trophy-case--trophy-case' },
  landmarks: [
    { id: 'name', role: 'text', buildRole: 'heading', name: 'Pipewrench', nth: 0, buildNth: 0, box: 'position', buildSize: 22.5, buildShift: { x: -199.4, y: 85.2 } },
    at('title', 'text', 'Professional Wrench', { x: 348, y: 49.9 }, { buildRole: 'cell', type: false }),
    at('rank', 'text', 'Main Eventer', { x: 357.8, y: 68 }),
    at('wearing', 'text', 'Wearing: Baseball Cap, Mustache, "I Really Wish I Weren\'t Here" Button.', { x: 348, y: 393.8 }, { buildRole: 'cell', buildName: 'Baseball Cap, Mustache, "I Really Wish I Weren\'t Here" Button', type: false }),
    at('case', 'columnheader', 'Trophy case (5)', { x: 11.3, y: 464.4 }, { buildRole: 'heading', buildName: 'Trophy case', type: false }),
    at('belt', 'text', 'Hardcore Belt', { x: 22.3, y: 475.6 }, { buildName: 'The Hardcore Belt', nth: 0, buildNth: 0 }),
    at('sprite', 'text', 'Sprite Contest 2026', { x: 22.3, y: 502.6 }, { buildName: 'Employee of the Month' }),
    at('pet', 'text', "Boss's Pet", { x: 22.3, y: 528.6 }),
    at('demand', 'text', "Met the Boss's demand", { x: 22.3, y: 554.6 }, { buildName: "Met the Boss's Demand" }),
    at('champion', 'text', 'Season 1 Champion', { x: 22.3, y: 580.6 }, { buildName: 'Season Champion' }),
    at('on-1', 'text', 'On posts', { x: 228.3, y: 475.2 }, { nth: 0, buildNth: 0, buildSize: 13.75 }),
    at('lineage', 'columnheader', "The Hardcore Belt's lineage", { x: 11.3, y: 658.4 }, { buildRole: 'heading', type: false }),
    at('holder-1', 'text', 'Pipewrench', { x: 11.3, y: 678 }, { nth: 1, buildNth: 1 }),
    at('holder-2', 'text', 'Sock Puppet', { x: 11.3, y: 689.3 }),
    at('holder-3', 'text', 'Dr. Bones', { x: 11.3, y: 700.2 }),
  ],
};

export default manifest;
