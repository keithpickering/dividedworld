/**
 * Board 05 of the cosmetics boards, the trophies and gear admin page (docs/research/2026-11-04-cosmetics/05-admin.html, 1440 by 1080): Award a trophy and Grant gear down the left,
 * Make a trophy and Recent awards down the right, each column its own height. The build is the story `Boards/00 Admin trophies`
 * (engine/ui/admin/Trophies.board.stories.tsx), signed in as an admin: Pipewrench's belt, its made trophy and Dr. Bones's met-demand award.
 *
 * Every part is held from the Award heading's corner (the Grant, Make and Recent parts from their own headings), so a wrapped line never moves what follows it.
 *
 * Departures by decision:
 *  - The page head: the build adds the page's title, lead and the admin pages' strip (Moves, The machine, Trophies, which the board's own menu draws as tabs) above the panels, so the
 *    Award heading stands 280px lower, and the board's panel frames and Anton headings are the glass's section labels (neon text, no frame, 24px of panel padding less: x -24).
 *  - Award a trophy's belt note shows only when a belt is chosen (the build's first option is not one), so Award stands 50px higher than the board's, and Grant gear's heading 104px higher.
 *  - Make a trophy has an Its line (optional) field the board does not draw (an award's line, set at the making), 102px more above Kind and the button 139px lower from the heading; the picture
 *    is a file field whose label says what the build does with it (any picture, drawn down to 48 pixels) where the board's button says Choose a file, so it is not held.
 *  - Grant gear's three fields stand in one row as the board's do; its column is 48px wider (no panel padding), so the second and third fields stand 20px and 40px further right.
 *  - Field and heading type, the buttons' measure and the table's art and cells are the glass's (type: false, position only); the recent awards' names and the belt art come from the instance.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the Award panel's heading's corner. */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'award', type: false, box: 'position', ...more });

const manifest: BoardManifest = {
  board: '2026-11-04-cosmetics/05-admin',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-00-admin-trophies--admin-trophies' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false, box: 'height' },
    { id: 'award', role: 'heading', name: 'AWARD A TROPHY', buildName: 'Award a trophy', type: false, box: 'position', buildShift: { x: -24, y: 280 } },
    at('trophy', 'combobox', 'TROPHY', { buildShift: { y: -9 } }),
    at('who', 'textbox', 'TO THE CHARACTER'),
    at('line', 'textbox', 'ITS LINE (OPTIONAL)', { buildShift: { y: 15 } }),
    at('award-button', 'button', 'AWARD', { buildShift: { y: -50 }, buildName: 'Award' }),
    at('grant', 'heading', 'GRANT GEAR', { buildShift: { y: -104 }, buildName: 'Grant gear' }),
    at('item', 'combobox', 'ITEM', { buildName: 'Gear', origin: 'grant' }),
    at('grant-who', 'textbox', 'TO THE CHARACTER', { buildShift: { x: 20 }, nth: 1, origin: 'grant' }),
    at('copies', 'textbox', 'COPIES', { buildShift: { x: 40 }, buildName: 'Copies', buildRole: 'spinbutton', origin: 'grant' }),
    at('grant-button', 'button', 'GRANT', { buildName: 'Grant', origin: 'grant' }),
    at('make', 'heading', 'MAKE A TROPHY', { buildName: 'Make a trophy' }),
    at('name', 'textbox', 'NAME', { buildShift: { y: -9 }, buildName: 'Name', origin: 'make' }),
    at('kind', 'combobox', 'KIND', { buildShift: { x: 25, y: 102 }, buildName: 'Kind', origin: 'make' }),
    at('make-button', 'button', 'MAKE IT', { buildShift: { y: 139 }, buildName: 'Make it', origin: 'make' }),
    at('recent', 'heading', 'RECENT AWARDS', { buildShift: { y: 85 }, buildName: 'Recent awards' }),
    at('head-trophy', 'columnheader', 'TROPHY', { buildShift: { y: -9 }, buildName: 'Trophy', origin: 'recent' }),
    at('head-to', 'columnheader', 'TO', { buildShift: { x: 46, y: -9 }, buildName: 'To', origin: 'recent' }),
    at('head-by', 'columnheader', 'BY', { buildShift: { x: 29, y: -9 }, buildName: 'By', origin: 'recent' }),
  ],
};
export default manifest;
