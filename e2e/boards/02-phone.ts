/**
 * Board 02, the Phone board (docs/research/2026-10-29-two-worlds/02-phone.html): the same moment as
 * the Main board at 390 by 844, with the hand open over the board. The glass plan's section 7 lists
 * what is compared: the banner's Boards button, the hand's sheet and its close button, and the
 * Game HUD's swap, Menu and hand button. The hand is open on the board because the player pressed
 * the HUD's hand button, so the build is pressed the same way before it is read.
 *
 * DEPARTURE (the phone hand's design, docs/plans/2026-11-13-phone-hand-design.md, sections 3 and 6): the sheet is a dialog named "Your hand" where the board draws a
 * region (`buildRole`), and it holds one face per kind on a swipe arc. It stands 89.5px taller than the board draws it, held to the bottom of the window, because it
 * is as tall as its parts: the row with room for the lifted card, and the line with room for its three-line reserve, and the close button. So `hand`, `hand-head`
 * and `hand-close` carry a `buildShift` for it: the sheet's top is 89.5px higher and its height 89.5px more, and the heading and the close button in it stand higher
 * by that much: the heading stands 21px and the close button 11px below the sheet's top in both, measured on the board and the build, so each shifts the full 89.5
 * (the heading's shift was written 88.5 once, a 1px slip the match's tolerance never showed).
 * The cards' boxes are not compared (they stand on the arc), nor is any of the cards' words: the board's second card, the Stick Around, is named by its play and
 * rarity in the build (`buildName`), and Whoops!'s card, which the build draws as one card named ", 2 in hand" where the board draws two, is not compared at all.
 * The hand is the cards part's (the glass build plan, Part 3): its heading with the count, one card per kind, and the Vending Machine link. Left out until the play
 * does (cards Task 3): the line about an armed card, which says the card is armed, and "Play Whoops! here" on #42. The thread is not compared here:
 * the board draws #42 alone under the title, and the build's thread holds the posts of its page
 * (a card play takes no number, so none is a line below #46); neither is under the sheet and the HUD,
 * which sit at the bottom of the window.
 * Where the board draws a post's row of actions (Quote, Spin thread and the rest, with "Play card" among them) bare, the
 * build draws it on an opaque footer bar of its own, like the post's header bar, and without "Play card": the owner's word
 * ("a footer bar similar to the header bar ... that ink color is totally variable too", and "why do we have "Play card" in
 * this row at all anymore? It's a game act so it should be Glass", the footer bar's amendment of 2026-10-31). Nothing of
 * that row is compared, and the thread is not compared here at all.
 * The Boards button is set in the body's 15px words, not at a control's 13.75px (engine/ui/frame/frame.css); the board draws 12px, and the type scale
 * (the glass polish, design section 7) is the 1.25 times that `buildShift` holds. Departure, the board look's Task 4: the button is Chrome now, so its
 * type is not compared and its shift is the Chrome button's wider box (see the landmark).
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '02-phone',
  size: { width: 390, height: 844 },
  build: { moment: '02-phone' },
  press: [{ role: 'button', name: 'Hand, 3 postcards' }],
  landmarks: [
    /* The type scale (the glass polish, design section 7) sets the button's words at 15px where the board draws 12px, so it is 10.4px wider and, held to the right edge, 18.2px further left. */
    /* The banner stands 18px lower (its top margin, the board look's Task 3) and 1px more for its frame. */
    /* DEPARTURE (the board look's Task 4): the Boards button is a Chrome button now (bold, tracked, in the button's own ink), which this board, a record, draws plain, so its type is not compared (docs/research/2026-11-06-board-look/03-phone.html, the batch-1 phone board, draws it as built) and its box is 10px wider again, held to the right edge 10.9px further left. */
    { id: 'boards', role: 'button', name: 'Boards', type: false, buildShift: { x: -29.1, y: 19, width: 20.8 } },
    /* The sheet's box, its heading with the count, and its close button. DEPARTURE (the phone hand's design, section 3, "Its size"): the sheet is as tall as its parts, the row with room for the lifted card and the arc, the line with room for three lines, and the button, so it stands 89.5px taller than the board draws it, held to the bottom of the window: its top, and the heading and the close button in it, stand that far higher. */
    { id: 'hand', role: 'region', buildRole: 'dialog', name: 'Your hand', type: false, buildShift: { y: -89.5, height: 89.5 } },
    { id: 'hand-head', role: 'heading', name: 'Hand · 3', within: 'hand', buildShift: { y: -89.5 } },
    { id: 'hand-close', role: 'button', name: 'Close the hand', within: 'hand', buildShift: { y: -89.5 } },
    /* The cards, each a button by its name. A card's parts are pictures and words said once by its name, so its box is compared and not its type. */
    { id: 'card-stick', role: 'button', name: 'Stick Around, Sweet postcard', buildName: 'Stick Around, Sweet, Move, common postcard', within: 'hand', box: 'none', type: false },
    /* (Each card's name says its play and rarity in the build, a departure the card mechanic makes: docs/plans/2026-11-01-card-plays-plan.md, Task 7.) */
    /* The link's place follows the line above it, whose words are the armed card's (cards Task 3), so only where it starts is compared. */
    /* A GlassButton in a centered ButtonRow (the glass polish, design section 2), in the parts' secondary colors, where the board draws a salty-yellow link at the sheet's left: not compared (the layout check holds it). */
    { id: 'hand-vending', role: 'link', name: 'Vending Machine', within: 'hand', box: 'none', type: false },
    { id: 'hud', role: 'region', name: 'Game HUD', type: false },
    /*
     * REVISED by the alerts design (docs/plans/2026-11-02-alerts-design.md, section 8; docs/research/2026-11-02-alerts/05-phone.html): on the phone the HUD's
     * row gains a 52px Alerts bell between Posting as and Menu, so the select is narrower than this board draws it. This board is a record and is not
     * edited; the select is compared by its place and type, not its width, and the bell is held by e2e/boards/05-phone.ts.
     */
    { id: 'hud-swap', role: 'combobox', name: 'Posting as', within: 'hud', box: 'position' },
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud' },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards, open', within: 'hud' },
  ],
};

export default manifest;
