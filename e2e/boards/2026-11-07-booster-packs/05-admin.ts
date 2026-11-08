/**
 * Board 05 of the booster packs boards, the machine's admin page (docs/research/2026-11-07-booster-packs/05-admin.html, 1440 by 1180): the title and lead, the
 * admin pages' strip (Moves, The machine) under the lead with The machine filled, a plain table of the ten slots in grid order, and one Save changes under a
 * rule. The build is the story `Boards/00 Admin machine` (engine/ui/admin/Machine.board.stories.tsx): the instance's own machine with the board's two Boss
 * moves, a Pull of Whoops! and a markup of Glitter Bomb. The phone drawing, the fourth screen of board 04, is a side of board 04's manifest (`phone.also`, e2e/boards/2026-11-07-booster-packs/01-machine.ts).
 *
 * Every part is held from a part above it, the first from the strip's bottom edge and the rest of a row from its slot's code, so a wrapped line never moves
 * what follows it.
 *
 * Departures by decision:
 *  - The page head leaves 36px under the title where the board's lead stands 8px under it (the glass polish, design section 2), as board 37 names.
 *  - Hall Pass (face-down moves plan) stocks the slot after Trap Card, so the build's list has one more row than the board's: Glitter Bomb, marked up, stands one row
 *    lower (its tag), and what follows the list (the hidden Main Event, Save changes and its note) stands about 55px lower.
 *  - The build's controls are the glass's own measure, so a button is compared by its place and not its size, and a field's type is the glass's.
 *  - A control's accessible name in the build says whose it is ("Whoops!: move up"), where the board's arrows are named "Move up" alone.
 *  - The note beside Save changes says what a price is held to (between 0.01 and 1,000,000.00) where the board's note says a Boss move reads the new price; the
 *    Boss's rows say the same of their move.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the part named (the title's corner unless `origin` says another). */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'title', box: 'position', type: false, ...more });

const manifest: BoardManifest = {
  board: '2026-11-07-booster-packs/05-admin',
  size: { width: 1440, height: 1180 },
  build: { story: 'boards-00-admin-machine--admin-machine' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false, box: 'height' },
    { id: 'title', role: 'heading', name: 'THE MACHINE', buildName: 'The machine', box: 'position' },
    at('lead', 'text', 'The slots in the order players see them. A hidden slot draws nothing; a sold-out slot shows greyed. What a pack can roll is set in the code, with the cards.', { buildShift: { y: 30 } }),
    at('moves', 'link', 'MOVES', { buildName: 'Moves', origin: 'lead', originEdge: 'bottom' }),
    at('machine', 'link', 'THE MACHINE', { buildName: 'The machine', origin: 'lead', originEdge: 'bottom' }),
    at('head-slot', 'columnheader', 'SLOT', { buildName: 'Slot', origin: 'machine', originEdge: 'bottom' }),
    at('head-order', 'columnheader', 'ORDER', { buildName: 'Order', origin: 'machine', originEdge: 'bottom' }),
    at('head-item', 'columnheader', 'ITEM', { buildName: 'Item', origin: 'machine', originEdge: 'bottom' }),
    at('head-availability', 'columnheader', 'AVAILABILITY', { buildName: 'Availability', origin: 'machine', originEdge: 'bottom' }),
    at('head-price', 'columnheader', 'PRICE', { buildName: 'Price', origin: 'machine', originEdge: 'bottom' }),
    at('head-boss', 'columnheader', 'THE BOSS', { buildName: 'The Boss', origin: 'machine', originEdge: 'bottom' }),
    at('code-a1', 'cell', 'A1', { origin: 'head-slot', originEdge: 'bottom' }),
    at('availability-booster', 'combobox', 'Booster: availability', { origin: 'head-slot', originEdge: 'bottom' }),
    at('price-booster', 'textbox', 'Booster: price', { origin: 'head-slot', originEdge: 'bottom' }),
    at('code-a2', 'cell', 'A2', { origin: 'head-slot', originEdge: 'bottom' }),
    at('tag-pull', 'text', 'PULLED BY THE BOSS · TO NOV 9', { origin: 'head-slot', originEdge: 'bottom' }),
    at('code-e1', 'cell', 'E1', { origin: 'head-slot', originEdge: 'bottom' }),
    at('tag-markup', 'text', 'MARKED UP ×1.5 · 2.25 TO NOV 8', { buildName: 'Marked up ×1.5 · 2.25 · to Nov 8', buildShift: { y: 52 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('code-none', 'cell', '–', { buildShift: { y: 55 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('hidden-note', 'text', 'Only in packs. The Boss may flash-sale it.', { buildShift: { y: 55 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('save', 'button', 'SAVE CHANGES', { buildName: 'Save changes', buildShift: { y: 55 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('save-note', 'text', 'Players see a saved price at once. A Boss move in force reads the new price.', { buildName: 'A price is between 0.01 and 1,000,000.00. Players see a saved price at once.', origin: 'head-slot', originEdge: 'bottom', buildShift: { x: -12, y: 55 } }),
  ],
};
export default manifest;
