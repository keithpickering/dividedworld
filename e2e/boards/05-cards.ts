/**
 * Board 05, the Cards board (docs/research/2026-10-29-two-worlds/05-cards.html, 1440 by 1080), its
 * left part: the hand sheet. The build side is its story, engine/ui/cards/Hand.board.stories.tsx,
 * opened through the end-to-end build's story route at the board's moment (the player at 21:51 on
 * Oct 29, with three cards in hand). The glass plan's section 7 lists what is compared: Stick Around
 * and Whoops! in hand, the second armed, the sealed slot, the three state chips, and "On the board,
 * the same card reads like this" with the card's tag on a 2003 post.
 *
 * The board's right part, the play form open on Gloomba's #46, is the app, not a story, and a
 * manifest's first build side is one moment or story, so it is the manifest's second side (`also`,
 * e2e/board-match.ts): the app at the board's moment, pressed as the player reaches the form (the
 * hand, the second Whoops! armed, then "Play Whoops! here" on the last post of the page), with the
 * board's message typed in. Where it differs from the board, by decision:
 *  - The post is Gloomba's #46 and not Spritey's #41 (the glass plan, section 3, item 3), so the target
 *    line is compared by its place, its link by place alone and its words not at all.
 *  - A card is paid for at the Vending Machine; playing it costs only what the post adds (the core loop's
 *    design: "1.00 to buy, plus 0.25 per 500 characters of the target when played"). The board charges the
 *    card again, "Card 1.00 ... Total 1.25, 4.62 -> 3.37", and the form draws what the server charges: the
 *    card paid ("Card: Paid"), the long post 0.25, "To pay now" 0.25 and a wallet of 4.37 after. The amounts are
 *    left out and the rows' places compared. This is a design question for the owner (the report names it).
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
  also: [{
    name: 'play form',
    build: { moment: '05-cards' },
    press: [
      { role: 'button', name: 'Hand, 3 postcards' },
      /* The Main hand's card names its tagline too (cardLabel in engine/ui/cards/Postcard.tsx). */
      { role: 'button', name: 'Whoops!, Salty. Splat a post in ink. postcard' },
      /* The last post of the page, #46, the longest of them. */
      { role: 'button', name: 'Play Whoops! here', nth: -1 },
      { role: 'textbox', name: 'Your message', fill: 'you dropped your ink' },
    ],
    landmarks: [
      /* Docked 64px from the window's top and 40 from its edge as the board draws it; its height is the card's own form's (below). */
      { id: 'dialog', role: 'dialog', name: 'Whoops!', box: 'position' },
      { id: 'kicker', role: 'text', name: 'Play a card', within: 'dialog', box: 'position' },
      { id: 'title', role: 'heading', name: 'Whoops!', within: 'dialog' },
      { id: 'close', role: 'button', name: 'Close', within: 'dialog', type: false },
      { id: 'target', role: 'link', name: 'Spritey\'s post #41', buildName: 'Gloomba\'s post #46', within: 'dialog', box: 'position', type: false },

      { id: 'ink', role: 'group', name: 'Ink color', within: 'dialog', box: 'none', type: false },
      { id: 'ink-legend', role: 'text', name: 'Ink color', within: 'dialog' },
      ...['Magenta', 'Cyan', 'Yellow', 'Green', 'Orange', 'Violet'].map((name) => ({ id: `ink-${name.toLowerCase()}`, role: 'radio', name, within: 'dialog', type: false })),

      { id: 'message-label', role: 'text', name: 'Your message', within: 'dialog', box: 'size' },
      { id: 'message', role: 'textbox', name: 'Your message', within: 'dialog', box: 'size' },
      { id: 'message-hint', role: 'text', name: 'Shown on the card\'s Act. Plain text.', within: 'dialog', box: 'size' },
      { id: 'message-count', role: 'text', name: '20 / 200', within: 'dialog', box: 'size' },

      /*
       * The card's own form is taller than the board's six swatches (the picker and the preview of the
       * ink, the screens' design, section 11), so the dialog is taller than the board's 952px and
       * everything between it and the foot stands lower than on the board and is compared by its size;
       * the rows' amounts are the server's (see the header).
       */
      { id: 'cost-card', role: 'text', name: 'Card', within: 'dialog', box: 'none' },
      { id: 'cost-long', role: 'text', name: 'Long post, +0.25 per 500 characters', within: 'dialog', box: 'size' },
      /* "Total" is "To pay now" in the build, and 22px on the board where the closed list's nearest is body's 21. */
      { id: 'cost-total', role: 'text', name: 'Total', buildName: 'To pay now', buildSize: 21, within: 'dialog', box: 'none' },
      { id: 'wallet', role: 'img', name: 'Wallet after playing: 3.37 of 6.00', buildName: 'Wallet after playing: 4.37 of 6.00', within: 'dialog', box: 'size', type: false },
      { id: 'fine', role: 'text', name: 'Playing is a public Act under Pipewrench\'s name. Only solid Aura is spent; the ghost doesn\'t count.', within: 'dialog', box: 'size' },

      /* The foot follows the taller form down the dialog, so the buttons are compared by size. */
      { id: 'play', role: 'button', name: 'Play as Pipewrench', within: 'dialog', box: 'size' },
      { id: 'cancel', role: 'button', name: 'Cancel', within: 'dialog', box: 'size' },
    ],
  }],
};

export default manifest;
