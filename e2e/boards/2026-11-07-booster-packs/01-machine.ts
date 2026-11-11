/**
 * Booster packs board 01, the machine (docs/research/2026-11-07-booster-packs/01-machine.html, 1440 by 1080), as the story `Boards/Booster packs`,
 * `Machine` (engine/ui/vending/Packs.board.stories.tsx) draws it with the Booster selected by a press, as a player does: the wallet and the hand, the
 * machine's slots in the admin's order (the Booster in A1, the card slot in A2 pulled by the Boss, E1 marked up, E2 sealed, the hidden Main Event
 * drawing no slot), the selected pack's price, what is in it and Buy beside the slots, and the column to the right: the pack's odds, and the Boss's moves in
 * force in plain words. The plan is docs/plans/2026-11-04-booster-packs-plan.md, Task 5.
 *
 * Departures, by decision, each named where it is set:
 *  - The menu is the glass's, as every glass page holds it (e2e/boards/07-vending.ts): Back is held by its y and height, and its key cap is hidden from its name.
 *  - The type: the head's eyebrow, the wallet's figures and Buy are the glass's sizes (body 21px, display-s 26px, 32px) where the board draws 20, 30 and 40px, and
 *    the moves' heading is the label's 20px where the board draws 19, so each is held by its place and not its type; the odds' caption is the glass's display
 *    size (40px, `--kb-glass-size-display-m`) where the board draws 44px. The glass's type scale is the owner's (the glass polish, design section 7).
 *  - The words of a move are the engine's, from the move's kind and its demand's catalog (machine-words.ts), where the board's are drawn by hand: the board
 *    says "once 12 different characters post in Tomato Talk (7 so far)", the build "if its demand is met: 12 different characters to post in <the board>
 *    (7 of 12 so far)". So only the bold clause that opens each is found by its words, and the rest of each is held by its place.
 *  - A sold out slot's chip says "SOLD OUT" alone: with the code beside it ("A2 · SOLD OUT"), the chip and the info control would not fit one shelf at the
 *    glass's type size, and a wrapped shelf makes every row of the machine taller. The slot's own name carries the code's place.
 *  - The kind word is the instance's (Move, Gimmick, Ward) where the board draws Cast, Set and Use. Two cards the board does not draw stock the machine before the board's
 *    Bluff: You Were Saying? takes C1 (after Autocorrect) and Hall Pass takes E1 (after Trap Card), so the slots after each stand one place later than the board draws them: the board's C1 is the build's
 *    You Were Saying?, its C2 Bluff, D1 Feelin' Fab, D2 Trap Card, E1 Hall Pass and its empty E2 the build's Force Field. Glitter Bomb, the one marked up (the board's mark on E1), stands in F1, the first
 *    place of a sixth row the board does not draw, so no landmark holds it by its place (its words are held by the moves list: "Glitter Bomb is marked up"). Each other slot is held by its place.
 *  - A slot's price is "orbs" and the board's "orb" (the glass's names say "1.00 orb" and "3.00 orbs", as board 07 holds them).
 *  - The wallet's name says "buying Booster", where the board draws "buying the Booster": a card's reads "buying Whoops!" and a pack is named as one.
 *  - The machine's sign is a marquee the instance picks at random, and the machine's drawing is the instance's art (`data-kb-art`): not compared.
 *  - The "1 slot empty" line under the Boss's moves is the machine's own and no board draws it (E2 is the board's sealed slot): not compared.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';
import { PRESSES } from './02-reveal.ts';

const PACK = 'Buy Booster, 3.00 orbs, a pack of 5 postcards';

const manifest: BoardManifest = {
  board: '2026-11-07-booster-packs/01-machine',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-booster-packs--machine' },
  press: [{ role: 'button', name: PACK }],
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },

    { id: 'eyebrow', role: 'text', name: 'Spend Aura', type: false },
    { id: 'title', role: 'heading', name: 'Vending Machine', type: false },
    { id: 'wallet', role: 'region', name: 'Your wallet', box: 'across', type: false },
    { id: 'wallet-orbs', role: 'img', name: 'Wallet: 5.62 of 6.00; buying the Booster leaves 2.62', buildName: 'Wallet: 5.62 of 6.00; buying Booster leaves 2.62', within: 'wallet', box: 'across', type: false },
    { id: 'wallet-after', role: 'text', name: '2.62', within: 'wallet', box: 'position', type: false },
    { id: 'hand', role: 'link', name: 'Your hand 2 → 7', box: 'none', type: false },

    /* The slots: each by its button, in the admin's order. */
    { id: 'slot-a1', role: 'button', name: 'Buy Booster, 3.00 orb, a pack of 5 postcards, selected', buildName: `${PACK}, selected`, type: false, box: 'position' },
    { id: 'slot-a2', role: 'button', name: 'Whoops!, sold out: pulled by the Boss until Nov 9', type: false, box: 'position' },
    { id: 'slot-b1', role: 'button', name: 'Buy Stick Around, 1.00 orb, common Cast', buildName: 'Buy Stick Around, 1.00 orb, common Move', type: false, box: 'position' },
    { id: 'slot-b2', role: 'button', name: 'Buy Autocorrect, 1.00 orb, common Cast', buildName: 'Buy Autocorrect, 1.00 orb, common Move', type: false, box: 'position' },
    { id: 'slot-c1', role: 'button', name: 'Buy Bluff, 0.25 orb, common Set', buildName: 'Buy You Were Saying?, 1.00 orb, common Move', type: false, box: 'position' },
    { id: 'slot-c2', role: 'button', name: 'Buy Feelin\' Fab, 0.20 orb, common Cast', buildName: 'Buy Bluff, 0.25 orbs, common Gimmick', type: false, box: 'position' },
    { id: 'slot-d1', role: 'button', name: 'Buy Trap Card, 1.50 orb, uncommon Set', buildName: 'Buy Feelin\' Fab, 0.20 orbs, common Move', type: false, box: 'position' },
    { id: 'slot-d2', role: 'button', name: 'Buy Force Field, 1.50 orb, uncommon Use', buildName: 'Buy Trap Card, 1.50 orbs, uncommon Gimmick', type: false, box: 'position' },
    { id: 'slot-e1', role: 'button', name: 'Buy Glitter Bomb, 2.25 orb, marked up from 1.50, uncommon Cast', buildName: 'Buy Hall Pass, 1.50 orbs, uncommon Gimmick', type: false, box: 'position' },
    { id: 'slot-e2', role: 'img', name: 'Empty slot E2, waiting for a future postcard', buildRole: 'button', buildName: 'Buy Force Field, 1.50 orbs, uncommon Ward', type: false, box: 'position' },

    /* Beside the slots: the pick, what is in the pack, and Buy. */
    { id: 'selected', role: 'region', name: 'Selected', buildRole: 'status', buildName: 'Selected: A1, Booster, 3.00', type: false, box: 'across' },
    { id: 'in-pack', role: 'region', name: 'In this pack', type: false, box: 'across' },
    { id: 'buy', role: 'button', name: 'Buy Booster · 3.00', box: 'across', type: false },

    /* The column to the right: the pack's odds, and the Boss's moves in force. */
    { id: 'about', role: 'complementary', name: 'About the Booster', box: 'across', type: false },
    { id: 'odds', role: 'table', name: 'Booster odds', box: 'across', type: false },
    { id: 'moves-heading', role: 'heading', name: 'The Boss\'s moves', box: 'across', type: false },
    { id: 'move-pull', role: 'text', name: 'Whoops! is pulled', box: 'across' },
    { id: 'move-markup', role: 'text', name: 'Glitter Bomb is marked up', box: 'across' },
  ],
};

export default manifest;

/*
 * Booster packs board 04, the phone (docs/research/2026-11-07-booster-packs/04-phone.html): four screens at 390 by 844 side by side on one page. A phone board
 * has one parent and is compared at 390 by 844 (e2e/boards.spec.ts), so this export is the whole board: the machine is its own side, and the reveal's two
 * screens are further sides (`also`), each its own build against the same page; the fourth, the machine's admin page, is the third side (the plan's Task 6).
 * The board page is opened at 390 wide with its screens at x = 20, 430, 840 and 1250; each landmark of a screen is found as that screen's nth and measured
 * from that screen's menu bar (the admin screen's bar is the page's nth navigation, 1), or, for a reveal (it has none), from its dialog's corner (`origin`), so a screen's place on the page is never compared.
 *
 * What the phone board draws that the build does not follow, by decision:
 *  - The board draws the machine "scrolled to the selected Booster": the menu bar, then the pick, what is in the pack, Buy and the odds. The build is the
 *    stack of the whole page (the head, the wallet, the machine's slots, then the pick), so the pick is wherever the page puts it and the parts of the
 *    selected pack are held from each other (`origin`, from the pick's foot), never from the bar.
 *  - The build holds the pick, what is in the pack and Buy inside the machine's body (12px in on each side, the machine's frame), where the board draws them
 *    the column's width, so their widths are not compared, and the odds stand 12px further left than the machine's parts. The tray (the machine's art,
 *    `data-kb-art`) and the machine's frame stand between Buy and the odds, which the board omits: the odds are 102px lower. The bar is the signed-in
 *    bar, with its row of tabs under Back, which the board's bar does not draw, so only Back is compared.
 *  - A button is the glass's phone control, 40px tall where the board draws 48 and 44, so a button is held by its y with that height, and what stands
 *    under a button's row follows. After the last card the build's second row is "Back to the machine" (the board's phone has Done alone), so the line under
 *    it stands 53px lower than the board's.
 *  - The type is the glass's phone tokens (the odds 17px, its caption 26px) where the board draws the desktop's sizes and 34px; no type is compared.
 *  - The board's Turn the next card is "TAP FOR THE NEXT CARD" and its hint "Tap the card, or swipe it away, to turn the next one."; the build's button says
 *    "Turn the next card" at every width (a tap on the pile or a swipe turns it too), and its hint adds that all five are already in the hand. The board's phone
 *    has no key cap on Close.
 *  - The admin screen (`The machine, for an admin`; the story is engine/ui/admin/Machine.board.stories.tsx) is held as board 05 holds the 1440 page
 *    (e2e/boards/2026-11-07-booster-packs/05-admin.ts), each part from a part above it, with its departures: the board's phone has no lead under the title (the
 *    1440 board's lead does not appear on it), so the lead is not compared; the board draws "seven more slots, then Save changes" and no Save, so only the first three
 *    slots (Booster, Whoops!, Stick Around) are held. The strip's buttons are the glass's phone control (The machine 12px narrower than the board's), the
 *    first row stands 16px lower under the strip, and the third 37px lower under the second (the Whoops! row's tag line is taller in the build), and the move
 *    arrows and the price stand 18, 9 and 17px to the left of the board's, 10px lower, for the glass's control measure. Move down is 15px nearer the board's
 *    than Move up because a glass button is at least as wide as the spinner it holds in its label's cell (Button.tsx, parts.css), so the arrow before it is wider. The title stands 17px lower under the bar
 *    and the strip 178px under the title, for the lead the build draws between them. A slot's name in the build reads "Move up" as "<slot>: move up", as board 05 names it. The glass's controls are
 *    its own measure, so a control is held by its place and not its size, and the title's type is the glass's.
 */
const PHONE = '2026-11-07-booster-packs/04-phone';

/** The menu bar of the screen that is the board page's `nth` (the machine's), and Back in it, as the phone's bar draws them. */
const bar = (nth: number): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', nth, buildNth: 0, type: false, box: 'none' },
  { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
];

/** A part held by its place, x and y, measured from `origin`, shifted by what the phone's type and the build's words make. */
const at = (id: string, role: string, name: string, origin: string, shift: Landmark['buildShift'] = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin, box: 'position', type: false, buildShift: shift, ...more,
});

/** A reveal screen of the board page: the dialog is the `nth`, and every part is measured from its corner. */
const reveal = (nth: number): Landmark => ({ id: 'dialog', role: 'dialog', name: 'Opening a Booster', nth, buildNth: 0, type: false, box: 'none' });

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-booster-packs--machine-phone' },
  press: [{ role: 'button', name: PACK }],
  landmarks: [
    ...bar(0),
    { id: 'selected', role: 'region', name: 'Selected', buildRole: 'status', buildName: 'Selected: A1, Booster, 3.00', type: false, box: 'none' },
    at('in-pack', 'region', 'In this pack', 'selected', {}, { originEdge: 'bottom' }),
    at('buy', 'button', 'Buy Booster · 3.00', 'in-pack', {}, { originEdge: 'bottom' }),
    at('about', 'complementary', 'About the Booster', 'buy', { x: -12, y: 102 }, { originEdge: 'bottom' }),
    at('odds', 'table', 'Booster odds', 'about'),
  ],
  also: [
    {
      name: 'The reveal, three turned',
      build: { story: 'boards-booster-packs--machine-phone' },
      press: [...PRESSES, { role: 'button', name: 'Turn the next card' }, { role: 'button', name: 'Turn the next card' }, { role: 'button', name: 'Turn the next card' }],
      landmarks: [
        reveal(0),
        at('title', 'heading', 'Booster', 'dialog', {}, { within: 'dialog', box: 'height' }),
        at('count', 'text', '3 OF 5 TURNED OVER', 'dialog', {}, { within: 'dialog', box: 'height' }),
        at('turn', 'button', 'TAP FOR THE NEXT CARD', 'dialog', { height: -8 }, { buildName: 'Turn the next card', within: 'dialog', box: 'height' }),
        at('all', 'button', 'TURN ALL', 'dialog', { y: -8, height: -4 }, { buildName: 'Turn all', within: 'dialog', box: 'height' }),
        at('close', 'button', 'CLOSE', 'dialog', { y: -8, height: -4 }, { within: 'dialog', box: 'height' }),
        at('hint', 'text', 'Tap the card, or swipe it away, to turn the next one.', 'dialog', { y: -12, height: 26 }, { buildName: 'Tap the card, or swipe it away, to turn the next one. All five are already in your hand.', within: 'dialog', box: 'height' }),
      ],
    },
    {
      name: 'The reveal, all turned',
      build: { story: 'boards-booster-packs--machine-phone' },
      press: [...PRESSES, { role: 'button', name: 'Turn all' }],
      landmarks: [
        reveal(1),
        at('title', 'heading', 'Booster', 'dialog', {}, { within: 'dialog', box: 'height' }),
        at('count', 'text', '5 OF 5 · ALL IN YOUR HAND', 'dialog', {}, { within: 'dialog', box: 'height' }),
        at('tag', 'text', 'RARE · MAIN EVENT', 'dialog', { height: 3 }, { within: 'dialog', box: 'height' }),
        at('done', 'button', 'DONE', 'dialog', { height: -8 }, { within: 'dialog', box: 'height' }),
        at('hint', 'text', 'These five are already in your hand.', 'dialog', { y: 53, height: 25 }, { buildName: 'These five are already in your hand. Main Event isn\'t sold on its own; this is one of the ways to get it.', within: 'dialog', box: 'height' }),
      ],
    },
    {
      name: 'The machine, for an admin',
      build: { story: 'boards-00-admin-machine--admin-machine-phone' },
      landmarks: [
        ...bar(1),
        at('title', 'heading', 'THE MACHINE', 'menu', { y: 17 }, { buildName: 'The machine', originEdge: 'bottom' }),
        at('moves', 'link', 'MOVES', 'title', { y: 178 }, { buildName: 'Moves', originEdge: 'bottom' }),
        at('machine', 'link', 'THE MACHINE', 'title', { x: -12, y: 178 }, { buildName: 'The machine', originEdge: 'bottom' }),
        ...([['a1', 'A1', 'Booster', 'moves'], ['a2', 'A2', 'Whoops!', 'a1-code'], ['b1', 'B1', 'Stick Around', 'a2-code']] as const).flatMap(([k, code, card, from], i) => [
          at(`${k}-code`, 'text', code, from, k === 'a1' ? { y: 16 } : k === 'b1' ? { y: 37 } : {}, { originEdge: 'bottom' }),
          at(`${k}-up`, 'button', 'Move up', `${k}-code`, { x: -18, y: 10 }, { buildName: `${card}: move up`, nth: i, buildNth: 0 }),
          at(`${k}-down`, 'button', 'Move down', `${k}-code`, { x: -9, y: 10 }, { buildName: `${card}: move down`, nth: i, buildNth: 0 }),
          at(`${k}-availability`, 'combobox', `${card}: availability`, `${k}-code`),
          at(`${k}-price`, 'textbox', `${card}: price`, `${k}-code`, { x: -17 }),
        ]),
      ],
    },
  ],
};
