/**
 * Board 05, the Cards board (docs/research/2026-10-29-two-worlds/05-cards.html, 1440 by 1080), its
 * left part: the hand sheet. The build side is its story, engine/ui/cards/Hand.board.stories.tsx,
 * opened through the end-to-end build's story route at the board's moment (the player at 21:51 on
 * Oct 29, with three cards in hand). The glass plan's section 7 lists what is compared: Stick Around
 * and Whoops! in hand, the second armed, the sealed slot, the three state chips, and "On the board,
 * the same card reads like this" with the card's tag on a 2003 post.
 *
 * The board's right part, the play form open on Gloomba's #46, is the app, not a story, and a
 * manifest has one build side (a moment or a story). It is the cards plan's Task 3's, and is
 * compared there, in a second manifest the board match gains for it; until then this board's
 * play form is not held, and the board stays green on its sheet alone.
 *
 * Not compared: a card's face, which is the instance's art (each article is compared by its box and
 * its name; its parts are aria-hidden pictures and words said once by the article's name and
 * description), the heading's type (drawn in outline on the board, solid in the build, where the
 * glass measures no translucent type), and the 2003 window's words, which are the board's own.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '05-cards',
  size: { width: 1440, height: 1080 },
  build: { story: 'boards-05-cards--sheet' },
  landmarks: [
    { id: 'eyebrow', role: 'text', name: 'Your hand · 3 cards' },
    { id: 'title', role: 'heading', name: 'Postcards', type: false },

    /* The cards, each rotated a few degrees on the board, so a box is the turned card's own bounds. */
    { id: 'stick-around', role: 'article', name: 'Stick Around, a Sweet postcard', type: false },
    { id: 'whoops', role: 'article', name: 'Whoops!, a Salty postcard, armed', type: false },
    { id: 'sealed', role: 'article', name: 'An empty slot for a future postcard', type: false },
    { id: 'sealed-head', role: 'heading', name: 'Sealed', within: 'sealed' },
    { id: 'sealed-says', role: 'text', name: 'A slot in the Vending Machine waiting for the next postcard.', within: 'sealed' },

    /* The three states, as chips. */
    { id: 'chip-held', role: 'text', name: 'In hand' },
    { id: 'chip-armed', role: 'text', name: 'Armed · pick a post' },
    { id: 'chip-later', role: 'text', name: 'Coming later' },

    /* Where the card meets the board. */
    /* The glass tag is taller than the board's line of words, so the window is compared by where it starts. */
    { id: 'onboard', role: 'region', name: 'How it reads on the board', type: false, box: 'position' },
    { id: 'onboard-head', role: 'text', name: 'On the board, the same card reads like this', within: 'onboard' },
  ],
};

export default manifest;
