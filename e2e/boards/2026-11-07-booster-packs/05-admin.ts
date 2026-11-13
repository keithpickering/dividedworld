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
 *  - Hall Pass (face-down moves plan) stocks the slot after Card Collector, and You Were Saying? (its own plan) the slot after Autocorrect, so the build's list has two more rows than
 *    the board's: Glitter Bomb, marked up, stands two rows lower (its tag, 52px for Hall Pass's row and 55px for You Were Saying?'s), and what follows the list (the hidden Main Event,
 *    Save changes and its note) stands about 110px lower.
 *  - Card types then added Publicity Tour (in Bluff's slot, where the board draws Bluff), Heat Magnet, Class Clown and Good Vibes, so the build's list has three more rows than
 *    that: Glitter Bomb's tag stands 165px lower still (272 in all) and what follows the list 165px lower (275 in all).
 *  - Below the Fold was then added at the end of the on-sale slots (after Glitter Bomb, before the hidden Main Event), so no slot above it moves and Glitter Bomb's tag stays 272px lower;
 *    the list has one more row (55px), so what follows the list stands 55px lower again (330 in all).
 *  - The reports plan (Task 7) added Reports to the strip between Moves and The machine, which the board's two-button strip does not draw: The machine's button stands 127px
 *    to the right (the width of Reports and its gap), and the table's heads, held from it, stand 127px to its left, so the heads keep their place on the page.
 *  - Mooch, Toll, 4D Chess and the hidden Off Day were then added after Below the Fold (before the hidden Main Event, Off Day last), so no slot above them moves and Glitter Bomb's tag stays 272px lower;
 *    the list has four more rows (55px each): the hidden Main Event's cell and note stand 165px lower again (495 in all) and, under Off Day's row, Save changes and its note 220px lower (550 in all).
 *  - Jimmy Wails was then added after 4D Chess, the last on-sale slot (before the hidden Main Event), so no slot above it moves and Glitter Bomb's tag stays 272px lower;
 *    the list has one more row (55px): the hidden Main Event's cell and note stand 550px lower in all, and Save changes and its note 605px lower in all.
 *  - Hype-Up and Last Word (card notes Part 4) were then added after Jimmy Wails, the end of the on-sale slots, and the hidden Sugar Coat after Off Day, so no slot above them moves:
 *    the list has two more on-sale rows (55px each), so the hidden Main Event's cell and note stand 110px lower again (660 in all), and one more hidden row under Off Day's, so Save changes and its note stand 165px lower again (770 in all).
 *  - Laugh Track was then added after Last Word, the last on-sale slot (before the hidden Main Event), so no slot above it moves and Glitter Bomb's tag stays 272px lower;
 *    the list has one more row (55px): the hidden Main Event's cell and note stand 715px lower in all, and Save changes and its note 825px lower in all.
 *  - Graffiti was then added as the last slot, hidden (after Sugar Coat), so no slot above it moves; the list has one more hidden row (55px) under Off Day's and Sugar Coat's:
 *    with Laugh Track's row above it, the hidden Main Event's cell and note stand 715px lower in all (it is above Graffiti's row, so it is not moved by it), and Save changes and its note 880px lower in all.
 *  - Line Cutter and Feelin' Glam (card notes Part 2) were then added as the last two slots, both hidden (after Graffiti), so no slot above them moves; the list has two more hidden rows (55px each)
 *    under Graffiti's: the hidden Main Event's cell and note stay 715px lower in all, and Save changes and its note stand 110px lower again (990 in all).
 *  - Overreaction and Blind Study (card notes Part 3) were then added after Laugh Track's slot, the end of the on-sale slots (before the hidden Main Event), and the hidden Whodunnit? after Feelin' Glam, the last slot, so no slot above them moves and Glitter Bomb's tag stays 272px lower;
 *    the list has two more on-sale rows (55px each), so the hidden Main Event's cell and note stand 110px lower again (825 in all), and one more hidden row under Feelin' Glam's, so Save changes and its note stand 165px lower again (1155 in all).
 *  - Happy Heart and Take the Fall (card notes Part 5) were then added after Blind Study, the end of the on-sale slots (before the hidden Main Event), and the hidden Super Happy Heart, Tattle-Tale and Ultra Happy Heart
 *    as the last three slots (after Whodunnit?), so no slot above them moves and Glitter Bomb's tag stays 272px lower; the list has two more on-sale rows (55px each) and three more hidden rows:
 *    the hidden Main Event's cell and note stand 110px lower again (935 in all), and Save changes and its note stand 110px and 165px lower again (1430 in all).
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
    at('machine', 'link', 'THE MACHINE', { buildName: 'The machine', buildShift: { x: 127 }, origin: 'lead', originEdge: 'bottom' }),
    at('head-slot', 'columnheader', 'SLOT', { buildName: 'Slot', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('head-order', 'columnheader', 'ORDER', { buildName: 'Order', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('head-item', 'columnheader', 'ITEM', { buildName: 'Item', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('head-availability', 'columnheader', 'AVAILABILITY', { buildName: 'Availability', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('head-price', 'columnheader', 'PRICE', { buildName: 'Price', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('head-boss', 'columnheader', 'THE BOSS', { buildName: 'The Boss', buildShift: { x: -127 }, origin: 'machine', originEdge: 'bottom' }),
    at('code-a1', 'cell', 'A1', { origin: 'head-slot', originEdge: 'bottom' }),
    at('availability-booster', 'combobox', 'Booster: availability', { origin: 'head-slot', originEdge: 'bottom' }),
    at('price-booster', 'textbox', 'Booster: price', { origin: 'head-slot', originEdge: 'bottom' }),
    at('code-a2', 'cell', 'A2', { origin: 'head-slot', originEdge: 'bottom' }),
    at('tag-pull', 'text', 'PULLED BY THE BOSS · TO NOV 9', { origin: 'head-slot', originEdge: 'bottom' }),
    at('code-e1', 'cell', 'E1', { origin: 'head-slot', originEdge: 'bottom' }),
    at('tag-markup', 'text', 'MARKED UP ×1.5 · 2.25 TO NOV 8', { buildName: 'Marked up ×1.5 · 2.25 · to Nov 8', buildShift: { y: 272 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('code-none', 'cell', '–', { buildShift: { y: 935 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('hidden-note', 'text', 'Only in packs. The Boss may flash-sale it.', { buildShift: { y: 935 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('save', 'button', 'SAVE CHANGES', { buildName: 'Save changes', buildShift: { y: 1430 }, origin: 'head-slot', originEdge: 'bottom' }),
    at('save-note', 'text', 'Players see a saved price at once. A Boss move in force reads the new price.', { buildName: 'A price is between 0.01 and 1,000,000.00. Players see a saved price at once.', origin: 'head-slot', originEdge: 'bottom', buildShift: { x: -12, y: 1430 } }),
  ],
};
export default manifest;
