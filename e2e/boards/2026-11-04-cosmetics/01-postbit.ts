/**
 * Board 01, gear and trophies on a post (docs/research/2026-11-04-cosmetics/01-postbit.html, 1180 by 1003): two posts with the side postbit, the
 * 1:2 and 1:1.4 portraits wearing gear that reaches above the slot, the chosen trophies and a held belt, then the stacked band. The build is the story
 * `Boards/01 Postbit gear` (engine/ui/postbit/Postbit.board.stories.tsx): the thread on the Main board's layout, and under it the stacked band
 * drawn by the postbit itself, since the reader's one layout shows only one. The gear and the portraits are not compared: they are decoration (the
 * slot is `aria-hidden`), held by the postbit's and the outfit's own tests (engine/ui/postbit/Postbit.test.tsx, engine/ui/gear/Outfit.test.tsx).
 * What is compared is every word and badge of the postbit by its place from the post's author link (`origin`), so the page's own chrome above the
 * posts, which the board does not draw (it draws a black bar where the build has the crumb, the title and the table's head), is never compared.
 *
 * Departures by decision:
 *  - The postbit's order is the owner's, 2026-11-13 (PR #660): the rank above the avatar, then the avatar, then the group bar under it, then the title,
 *    the trophies and the counts. This board, drawn before it, puts the avatar between the title and the rank, and the house theme's group bar above the
 *    title. So the rank, title and trophies stand at the shifts measured from the build's order (the group bar's 26.5px moved off the top, the rank's
 *    line 1.25px smaller), and the post's own height differs, so the second post's author stands lower.
 *  - The house theme's page is not the board's: its posts have no 24px page padding and no 10px cell padding, so each x is 21.4px smaller; the
 *    glass's type scale (1.25 times) sets the names at 15px where the board draws 12, and every badge em-sized at 24px where the board draws 20,
 *    so each stands further along its row. The title, rank and counts are the house theme's quieter text in regular weight, so their type is not compared.
 *  - The board's stars after the rank are the house theme's pips; its trophies' names are the instance's own kinds (the board's "Season 1 Champion" is
 *    the build's "Season Champion", its Sprite Contest the build's "Employee of the Month", and the board's "Boss's Pet (Sighbot, Oct)" and the belt's
 *    "since Nov 2" words are the board's longer labels), and the number of posts the story's world seeds is the board's (212 and 31).
 *  - The board's counts are one text, the build's two lines: "Joined" is held for the counts' place.
 *  - The stacked band stands in the build under the thread's follow, reply and presence rows, which the board does not draw: it is held from the page's top at the
 *    shift measured; its name stands 42px nearer the left (no 10px band padding, and the build's square is 48px where the board draws 52) and its belt, a badge after the name, 20px nearer.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** The postbit's author-link size in the build: the board's 12px at the glass's type scale. */
const NAME_SIZE = 15;
/** The 21.4px the build's postbit stands nearer the page's left than the board's (no page or cell padding). */
const LEFT = -21.4;

/** A part of the postbit measured from its author link, at the y the first run measured against the board's. */
const part = (id: string, origin: string, role: string, name: string, y: number, more: Partial<Landmark> = {}): Landmark => ({ id, origin, role, name, box: 'position', type: false, buildShift: { y }, ...more });

const manifest: BoardManifest = {
  board: '2026-11-04-cosmetics/01-postbit',
  size: { width: 1180, height: 1003 },
  build: { story: 'boards-01-postbit-gear--gear-and-trophies' },
  landmarks: [
    { id: 'a1', role: 'link', name: 'Pipewrench', nth: 0, buildNth: 0, box: 'position', buildSize: NAME_SIZE, buildShift: { x: LEFT, y: -20.5 } },
    part('a1-title', 'a1', 'text', 'Professional Wrench', 5.86, { nth: 0, buildNth: 0 }),
    part('a1-rank', 'a1', 'text', 'Main Eventer', -235.1, { nth: 0, buildNth: 0 }),
    part('a1-counts', 'a1', 'text', 'Posts: 212Joined Oct 2026', 70.2, { buildName: 'Joined Oct 2026' }),
    part('t1', 'a1', 'img', 'Season 1 Champion', -212.6, { buildName: 'Season Champion' }),
    part('t2', 'a1', 'img', "Boss's Pet (Sighbot, Oct)", -212.6, { buildName: "Boss's Pet", buildShift: { x: 4.8, y: -212.6 } }),
    part('t3', 'a1', 'img', 'Sprite Contest 2026', -212.6, { buildName: 'Employee of the Month', buildShift: { x: 9.5, y: -212.6 } }),
    part('t4', 'a1', 'img', 'Holds the Hardcore Belt since Nov 2', -212.6, { buildName: 'The Hardcore Belt', nth: 0, buildNth: 0, buildShift: { x: 14.3, y: -212.6 } }),
    { id: 'a2', role: 'link', name: 'Dr. Bones', box: 'position', buildSize: NAME_SIZE, buildShift: { x: LEFT, y: 41.9 } },
    part('a2-title', 'a2', 'text', 'no relation', 5.86),
    part('a2-rank', 'a2', 'text', 'Jobber', -163.1),
    part('a2-counts', 'a2', 'text', 'Posts: 31Joined Nov 2026', 75.9, { buildName: 'Joined Nov 2026' }),
    part('t5', 'a2', 'img', "Met the Boss's demand: 12 characters post in Tomato Talk", -140.6, { buildName: "Met the Boss's Demand" }),
    { id: 'band-name', role: 'link', name: 'Pipewrench', nth: 1, buildNth: 1, box: 'position', buildSize: NAME_SIZE, buildShift: { x: -42, y: 180.5 } },
    { id: 'band-belt', role: 'img', name: 'Holds the Hardcore Belt', buildName: 'The Hardcore Belt', nth: 0, buildNth: 1, box: 'position', type: false, buildShift: { x: -20.1, y: 185.7 } },
  ],
};

export default manifest;
