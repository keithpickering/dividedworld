/**
 * Board 34, the Vending Machine's card info (docs/research/2026-11-05-backfill/34-vending-info.html, 1440 by 1000): About Whoops!, from slot A2, in the
 * dialog frame (the backfill design's section 7, the plan's Task 11): the card's face at the sheet's size (276px) beside its rules, over them the slot and the
 * card's kind, the title at the frame's heading size, and the price said in words ("1.00 to buy · more to play on a long post") where the build said "1.00+".
 * The build is the Vending page at the boards fixture's `07-vending` moment, reached as a player reaches it: About Whoops!.
 *
 * Every part is compared from the dialog's own top-left corner (`origin`), as the glass's other dialogs' boards are, and the dialog by its x and its width.
 * The face is compared by its box alone: it is the instance's art, and the board draws a stand-in (a figure) where the build draws the Postcard (an article).
 *
 * What is compared is every part's place (and the dialog's x and width, Close's size, the face's box) and no part's type. A part's type is one flag, color included, and
 * the glass's own colors stand where the board's literals do (the eyebrow's neon text, the title's text-hi, the rules' text-2), so no part's type could pass; and the
 * price reuses the build's display face (Anton, 26px, the card's alignment color) where the board draws Barlow Condensed 24px. The title's size is held where it is
 * set: a test in engine/ui/vending/Vending.test.tsx reads the card info's title rule (display-l, 52px, the play form's, where the board draws 60px; display-m, 40px, on
 * the phone, which is board 36's 40px).
 *
 * Departures by decision:
 *  - The eyebrow says the slot and the card's kind, "Slot A2 · Move" (the instance's word for how the card is played, from the card's face), where the board draws
 *    the card's alignment ("SLOT A2 · SALTY"): the alignment is on the face's badge already.
 *  - The title is the frame's heading in the glass's display face at 52px, as the play form's is, where the board draws 60px (see above for where its size is held).
 *  - The frame's bar holds the eyebrow, the title and Close at the top and the body (the face beside the price and the rules) starts under it, so the face stands
 *    where the bar ends and not beside the eyebrow as the board draws it: `BAR` and `FACE`.
 *  - The rules are the instance's own sentence, which says what the board's two paragraphs say in one (the long post's cost last); the board's words are found
 *    as the build's by `buildName`, and only the rules' place is held.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part of the dialog, held by its place from the dialog's corner. */
const part = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, within: 'dialog', origin: 'dialog', box: 'position', type: false, ...more });

/**
 * Where the build stands what the board draws in its right column, as the run measured: the board sets the eyebrow and the title at the top of that column,
 * beside the face; the frame's bar sets them at the dialog's left, over everything, and the body (the face, then the price and the rules beside it) starts under the bar.
 * So the eyebrow and the title stand 316px further left (the 276px face column and its 40px gap), the face 75px lower, and the price and the rules, which the board
 * draws under its title, stand 30px and 39px higher, beside the face.
 */
const BAR = { x: -316 } as const;
const FACE = { y: 75 } as const;

/** The instance's rules for Whoops!, in its own words (instances/divided-world/ui/cards.ts), where the board draws two shorter paragraphs. */
const RULES = "A Salty card. It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. Playing it on a long post costs 0.25 more for every 500 characters, 2.00 at most.";

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/34-vending-info',
  size: { width: 1440, height: 1000 },
  build: { moment: '07-vending' },
  press: [{ role: 'button', name: 'About Whoops!' }],
  landmarks: [
    { id: 'dialog', role: 'dialog', name: 'Whoops!', type: false, box: 'across' },
    part('eyebrow', 'text', 'SLOT A2 · SALTY', { buildName: 'Slot A2 · Move', buildShift: BAR }),
    part('title', 'heading', 'WHOOPS!', { buildShift: BAR }),
    part('close', 'button', 'Close', { box: 'size' }),
    part('face', 'figure', 'Whoops!, Salty, Cast, Common', { buildRole: 'article', buildName: 'Whoops!, Salty, Move, common postcard', box: 'full', buildShift: FACE }),
    part('price', 'text', '1.00 to buy · more to play on a long post', { buildShift: { y: -30 } }),
    part('rules', 'text', "It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink.", { buildShift: { y: -39 }, buildName: RULES }),
  ],
};

export default manifest;
