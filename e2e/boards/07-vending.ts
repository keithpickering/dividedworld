/**
 * Board 07, the Vending board (docs/research/2026-10-29-two-worlds/07-vending.html): the Vending
 * Machine at 20:09 on Oct 29, the minute before the player buys, Whoops! picked in slot A2. The
 * glass plan's section 7 lists what is compared; section 3 says where the build departs from the
 * board by a decision, and each departure is named where it sets a `buildName` or a box mode.
 *
 * The board draws the machine with Whoops! already picked, which the player reaches by pressing
 * its slot, so the build is pressed the same way before it is read.
 *
 * The wallet and the hand read what the fixture holds at the moment, which is the minute before the
 * buy: 5.62 and a hand of 2. The board's "4.62 → 3.62" and "3 → 4" are the Log board's timeline
 * shifted a purchase (section 3, the fourth departure), so the build reads 5.62 → 4.62 and 2 → 3.
 *
 * Not compared: the machine's drawing, which is the instance's art (its body, its marquee glass, the
 * slot codes, Push, Aura in, the tray and its words are marked `data-kb-art`, hidden from a screen
 * reader and read from no role); the cards' faces inside the slots; and the "In the machine"
 * descriptions, which are each card's `describe` (the instance's words, longer than the board's
 * sentences), so that list's later rows sit where its first row's length puts them, and only the
 * first is compared by place.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '07-vending',
  size: { width: 1440, height: 1080 },
  build: { moment: '07-vending' },
  press: [{ role: 'button', name: 'Buy Whoops!, 1.00 orb' }],
  landmarks: [
    /* The menu bar every glass page shares, the Vending Machine current. */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    /* The board writes the key cap into the link's name; the build hides it (MenuBar.tsx). */
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu' },

    /* The head: drawn in outline on the board and solid in the build (the glass measures no translucent type), so its box is compared. */
    { id: 'eyebrow', role: 'text', name: 'Spend Aura' },
    { id: 'title', role: 'heading', name: 'Vending Machine', type: false },

    /* The wallet panel, chamfer step 3. */
    { id: 'wallet', role: 'region', name: 'Your wallet', type: false },
    { id: 'wallet-label', role: 'text', name: 'Wallet · solid only', within: 'wallet' },
    { id: 'wallet-orbs', role: 'img', name: 'Wallet: 4.62 of 6.00; buying Whoops! leaves 3.62', buildName: 'Wallet: 5.62 of 6.00; buying Whoops! leaves 4.62', within: 'wallet', type: false },
    { id: 'wallet-after', role: 'text', name: '3.62', buildName: '4.62', within: 'wallet' },
    { id: 'hand', role: 'link', name: 'Your hand 3 → 4', buildName: 'Your hand 2 → 3' },

    /* The machine's sign carries the instance's name for it; its drawing is the instance's art. */
    { id: 'sign', role: 'text', name: '[Machine name]' },

    /* The slots: the two cards, A2 picked, and the four sealed. */
    { id: 'slot-a1', role: 'button', name: 'Buy Stick Around, 1.00 orb', type: false },
    { id: 'slot-a2', role: 'button', name: 'Buy Whoops!, 1.00 orb, selected', type: false },
    { id: 'slot-b1', role: 'img', name: 'Empty slot B1, waiting for a future postcard', type: false },
    { id: 'slot-b2', role: 'img', name: 'Empty slot B2, waiting for a future postcard', type: false },
    { id: 'slot-c1', role: 'img', name: 'Empty slot C1, waiting for a future postcard', type: false },
    { id: 'slot-c2', role: 'img', name: 'Empty slot C2, waiting for a future postcard', type: false },

    /* The control panel: the price display, the buy button and the note under it. */
    { id: 'price', role: 'status', name: 'Selected: A2, Whoops!, 1.00', type: false },
    { id: 'buy', role: 'button', name: 'Buy Whoops! · 1.00' },
    { id: 'price-note', role: 'text', name: 'Playing it on a long post costs up to 2.00 more, never more than 3.00 in all.' },

    /* The plain list: its heading, the first card's name and price, and the sealed slots' line. */
    { id: 'list', role: 'region', name: 'In the machine', type: false, box: 'position' },
    { id: 'list-head', role: 'text', name: 'In the machine', within: 'list', nth: 0 },
    { id: 'list-stick', role: 'text', name: 'Stick Around', within: 'list' },
    { id: 'list-stick-price', role: 'text', name: '1.00', within: 'list' },
    { id: 'list-whoops-price', role: 'text', name: '1.00+', within: 'list', box: 'none' },
    { id: 'list-empty', role: 'text', name: '4 slots empty', within: 'list', box: 'none' },
    { id: 'list-empty-says', role: 'text', name: 'More postcards arrive in later seasons.', within: 'list', box: 'none' },
  ],
};

export default manifest;
