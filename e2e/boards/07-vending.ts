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
 * Not built: the board's "In the machine" list (its heading, the two cards' names, prices and descriptions). The owner's
 * answer on #75 (docs/plans/2026-10-29-screens-cards-plan.md, Task 2) took it out at every width, since it grows with every
 * card added; each stocked slot carries an info button ("About Whoops!") that opens the card's rules in an overlay. The
 * info buttons are the build's own and no board draws them, so they are not compared.
 *
 * Departures by the glass polish (docs/plans/2026-11-04-glass-polish-design.md, sections 2 and 5): the left column is taller, since the price note
 * stands in the wallet (the machine's panel is narrower than ten em of its type), so its boxes are compared across, by x and width, or not at all;
 * the head is the board's own and "Your hand" is the HUD's Hand button's look (below); and the sign draws one of the instance's marquees, which the fixture fixes
 * (`random` is 0 at `?fixture=boards`, web/src/App.tsx) so it is the first.
 *
 * Not compared: the machine's drawing, which is the instance's art (its body, its marquee glass, the
 * slot codes, Push, Aura in, the tray and its words are marked `data-kb-art`, hidden from a screen
 * reader and read from no role); the cards' faces inside the slots.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '07-vending',
  size: { width: 1440, height: 1080 },
  build: { moment: '07-vending' },
  press: [{ role: 'button', name: 'Buy Whoops!, 1.00 orb, common Cast' }],
  landmarks: [
    /* The menu bar every glass page shares, the Vending Machine current. */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    /* The board writes the key cap into the link's name; the build hides it (MenuBar.tsx). */
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
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

    /* The head: drawn in outline on the board and solid in the build (the glass measures no translucent type), so its box is compared. */
    { id: 'eyebrow', role: 'text', name: 'Spend Aura' },
    /* Outline on the board (a translucent color), solid in the build, so only its type is left out (as the head's comment above says). */
    { id: 'title', role: 'heading', name: 'Vending Machine', type: false },

    /* The wallet panel, chamfer step 3. */
    { id: 'wallet', role: 'region', name: 'Your wallet', box: 'across' },
    { id: 'wallet-label', role: 'text', name: 'Wallet · solid only', within: 'wallet', box: 'none' },
    { id: 'wallet-orbs', role: 'img', name: 'Wallet: 4.62 of 6.00; buying Whoops! leaves 3.62', buildName: 'Wallet: 5.62 of 6.00; buying Whoops! leaves 4.62', within: 'wallet', box: 'across' },
    { id: 'wallet-after', role: 'text', name: '3.62', buildName: '4.62', within: 'wallet', box: 'across' },
    /*
     * "Your hand" is drawn as the HUD's Hand button is, a game piece of the salty fill (the owner's correction of 2026-11-04, "matching the HUD's Hand
     * button"), where the board draws a wider piece with its own spacing: its box and type are the HUD's, so they are not compared here (the HUD's is
     * held by e2e/boards/01-main.ts).
     */
    { id: 'hand', role: 'link', name: 'Your hand 3 → 4', buildName: 'Your hand 2 → 3', box: 'none', type: false },

    /* The machine's sign carries one of the instance's marquees, the first in the fixture; its drawing is the instance's art, and its type is fitted to its name.
       Its width follows the marquee's name, so its center is compared (`center`), not its x and width. */
    { id: 'sign', role: 'text', name: '[Machine name]', buildName: 'FRESH BEEF', type: false, box: 'center' },

    /* The slots: the two cards, A2 picked, and the four sealed. Their box is compared; their type is not, because a slot's
       visible words are the machine's printing, the instance's art (the postcard's face and a code the stylesheet writes out),
       and the name a reader gets is an aria-label with no text node behind it. */
    /* The card mechanic (docs/plans/2026-11-01-card-plays-plan.md, Tasks 7 and 8) departs from the board twice: a slot's name says
       its card's rarity and play after its price, and the instance's three new cards stock B1, B2 and C1, which the board drew sealed.
       Its Part 2 (docs/plans/2026-11-01-card-reach-plan.md, Task 7) departs once more: Glitter Bomb stocks C2, and Main Event a fourth
       row the board does not draw, so the machine holds four rows of shorter slots in the same body. So no slot's box is compared (`box: 'none'`);
       its name and role still are, and they say which card stocks it. */
    { id: 'slot-a1', role: 'button', name: 'Buy Stick Around, 1.00 orb', buildName: 'Buy Stick Around, 1.00 orb, common Cast', type: false, box: 'none' },
    { id: 'slot-a2', role: 'button', name: 'Buy Whoops!, 1.00 orb, selected', buildName: 'Buy Whoops!, 1.00 orb, common Cast, selected', type: false, box: 'none' },
    { id: 'slot-b1', role: 'img', name: 'Empty slot B1, waiting for a future postcard', buildRole: 'button', buildName: 'Buy Trap Card, 1.50 orbs, uncommon Set', type: false, box: 'none' },
    { id: 'slot-b2', role: 'img', name: 'Empty slot B2, waiting for a future postcard', buildRole: 'button', buildName: 'Buy Force Field, 1.50 orbs, uncommon Use', type: false, box: 'none' },
    { id: 'slot-c1', role: 'img', name: 'Empty slot C1, waiting for a future postcard', buildRole: 'button', buildName: 'Buy Bluff, 0.25 orbs, common Set', type: false, box: 'none' },
    { id: 'slot-c2', role: 'img', name: 'Empty slot C2, waiting for a future postcard', buildRole: 'button', buildName: 'Buy Glitter Bomb, 1.50 orbs, uncommon Cast', type: false, box: 'none' },

    /* The control panel: the price display, the buy button and the note under it. The display's lit words are the machine's
       printing (`data-kb-art`) and the text a reader gets is visually hidden, so its box is compared and its type is not. */
    { id: 'price', role: 'status', name: 'Selected: A2, Whoops!, 1.00', type: false, box: 'across' },
    { id: 'buy', role: 'button', name: 'Buy Whoops! · 1.00', box: 'across' },
    { id: 'price-note', role: 'text', name: 'Playing it on a long post costs up to 2.00 more, never more than 3.00 in all.', box: 'none' },

    /* The board's line about the empty slots ("4 slots empty", "More postcards arrive in later seasons.") is not compared. The instance
       now stocks every slot (Feelin' Fab took the last, D2: eight cards fill the machine's eight slots), and the engine draws that line only while a slot is
       empty (Vending.tsx), so a full machine shows none. The board's "In the machine" list is not built either: the owner's answer on #75 took
       it out at every width (it grows with every card added), and each card's slot carries an info button instead. */
  ],
};

export default manifest;
