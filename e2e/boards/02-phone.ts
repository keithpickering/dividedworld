/**
 * Board 02, the Phone board (docs/research/2026-10-29-two-worlds/02-phone.html): the same moment as
 * the Main board at 390 by 844, with the hand open over the board. The glass plan's section 7 lists
 * what is compared: the banner's Boards button, the hand's sheet and its close button, and the
 * Game HUD's swap, Menu and hand button. The hand is open on the board because the player pressed
 * the HUD's hand button, so the build is pressed the same way before it is read.
 *
 * Left out until the part that builds them (the glass build plan, Part 3, the cards): the hand's
 * heading and its cards, the armed card, the line about it and the Vending Machine link (cards
 * Tasks 2 and 3), and "Play Whoops! here" on #42 (cards Task 3). The thread is not compared here:
 * the board draws #42 alone under the title, and below #46 the build holds the plays' lines the
 * fixture writes there until cards Task 3 (section 3, the sixth departure); neither is under the
 * sheet and the HUD, which sit at the bottom of the window.
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
    /* The sheet's box; its first text is its heading, which comes with its cards in Part 3. */
    { id: 'hand', role: 'region', name: 'Your hand', type: false },
    { id: 'hand-close', role: 'button', name: 'Close the hand', within: 'hand' },
    { id: 'hud', role: 'region', name: 'Game HUD', type: false },
    { id: 'hud-swap', role: 'combobox', name: 'Posting as', within: 'hud' },
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud' },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards, open', within: 'hud' },
  ],
};

export default manifest;
