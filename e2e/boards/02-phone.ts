/**
 * Board 02, the Phone board (docs/research/2026-10-29-two-worlds/02-phone.html): the same moment as
 * the Main board at 390 by 844, with the hand open over the board. The glass plan's section 7 lists
 * what is compared: the banner's Boards button, the hand's sheet and its close button, and the
 * Game HUD's swap, Menu and hand button. The hand is open on the board because the player pressed
 * the HUD's hand button, so the build is pressed the same way before it is read.
 *
 * The hand is the cards part's (the glass build plan, Part 3): its heading with the count, the three
 * cards, and the Vending Machine link. Left out until the play does (cards Task 3): the armed card
 * (the board's second, named "Whoops!, Salty postcard, armed"; the build's second Whoops! is not armed,
 * so the board's third, the one plain Whoops!, is the build's second), the line about it, which says
 * the card is armed, and "Play Whoops! here" on #42. The thread is not compared here:
 * the board draws #42 alone under the title, and the build's thread holds the posts of its page
 * (a card play takes no number, so none is a line below #46); neither is under the sheet and the HUD,
 * which sit at the bottom of the window.
 * Where the board draws a post's row of actions (Quote, Spin thread and the rest, with "Play card" among them) bare, the
 * build draws it on an opaque footer bar of its own, like the post's header bar, and without "Play card": the owner's word
 * ("a footer bar similar to the header bar ... that ink color is totally variable too", and "why do we have "Play card" in
 * this row at all anymore? It's a game act so it should be Glass", the footer bar's amendment of 2026-10-31). Nothing of
 * that row is compared, and the thread is not compared here at all.
 * The Boards button is set in the board's 12px words, not at a control's 11px (engine/ui/frame/frame.css).
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '02-phone',
  size: { width: 390, height: 844 },
  build: { moment: '02-phone' },
  press: [{ role: 'button', name: 'Hand, 3 postcards' }],
  landmarks: [
    { id: 'boards', role: 'button', name: 'Boards' },
    /* The sheet's box, its heading with the count, and its close button. */
    { id: 'hand', role: 'region', name: 'Your hand', type: false },
    { id: 'hand-head', role: 'heading', name: 'Hand · 3', within: 'hand' },
    { id: 'hand-close', role: 'button', name: 'Close the hand', within: 'hand' },
    /* The cards, each a button by its name. A card's parts are pictures and words said once by its name, so its box is compared and not its type. */
    { id: 'card-stick', role: 'button', name: 'Stick Around, Sweet postcard', within: 'hand', type: false },
    { id: 'card-whoops', role: 'button', name: 'Whoops!, Salty postcard', within: 'hand', buildNth: 1, type: false },
    /* The link's place follows the line above it, whose words are the armed card's (cards Task 3), so only where it starts is compared. */
    { id: 'hand-vending', role: 'link', name: 'Vending Machine', within: 'hand', box: 'position' },
    { id: 'hud', role: 'region', name: 'Game HUD', type: false },
    { id: 'hud-swap', role: 'combobox', name: 'Posting as', within: 'hud' },
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud' },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards, open', within: 'hud' },
  ],
};

export default manifest;
