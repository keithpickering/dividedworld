/**
 * Board 25, the Reveal modal (docs/research/2026-11-05-backfill/25-reveal.html, 1440 by 1000): the dialog over My characters with the class
 * sentence, Board and Thread as one row of two equal fields, the character's words with their hint at the left of the count's own line, the
 * preview and the footer's one line beside Cancel and the reveal. The build is the story `Boards/00 Characters` › `Debuted`
 * (engine/ui/characters/Dialogs.board.stories.tsx), reached as a player reaches it: Reveal Pipewrench's class. The player's one character there is
 * Pipewrench, a Heel, as the board's is.
 *
 * Every part is compared from the dialog's own top-left corner (`origin`), as board 24's are, and the dialog by its x and its width. The board's
 * Board and Thread each hold a chosen option, which a press cannot choose, so the build's say "Choose a board" and "Choose a thread" and the
 * fields are compared by their place and size. The board's words ("Took you long enough.") are typed by the manifest; the count then reads
 * "21 of 200" as the board's.
 *
 * The board's selects are not tied to their labels, so they have no accessible name there (and the build's are named Board and Thread); each is found
 * as the board's nth combobox. Departures by decision are board 24's: the frame's 68px title, the glass's button measure (the reveal button says the character's name and class, as the
 * board's does), section labels in the glass's quieter text, and the preview's words and type being previews.ts's; and the field labels are the lead's 24px
 * (characters.css), compared by their words and place with the board's 24px. The count's own line is held (the hint at the left, the count at the right).
 */
import type { BoardManifest } from '../../board-match.ts';
import { part } from './24-debut.ts';

/**
 * How much lower the build stands what is under the sentence, from what the first run measured: the dialog's 44px section gap where the board
 * draws 24 to 30 between its sections (the Reveal board's own are uneven). They add as the parts go down the dialog. Each is measured from the
 * sentence's bottom edge (`UNDER`), not from the dialog's corner: the sentence is 680px wide and its words stand within a few percent of two lines'
 * worth, so one machine sets it in two lines and another in three (CI two, a local run three), which moves everything under it by a line.
 * What follows the sentence is held from where the sentence ends, whatever its lines.
 */
const DOWN = { fields: { y: 16 }, selects: { y: 16 }, words: { y: 36.5 }, count: { y: 36 } } as const;
const UNDER = { origin: 'sentence', originEdge: 'bottom' } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/25-reveal',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-characters--debuted' },
  press: [
    { role: 'button', name: "Reveal Pipewrench's class" },
    { role: 'textbox', name: "In the character's words (optional)", fill: 'Took you long enough.' },
  ],
  landmarks: [
    { id: 'dialog', role: 'dialog', name: "Reveal Pipewrench's class", type: false, box: 'across' },
    part('kicker', 'text', 'MY CHARACTERS › REVEAL', { buildName: 'My characters › Reveal', type: false }),
    part('title', 'heading', "Reveal Pipewrench's class", { type: false }),
    part('close', 'button', 'Close', { type: false, box: 'size' }),
    part('sentence', 'text', "Pipewrench is a Heel. This shows everyone that, as checked by The System, as Pipewrench's own post. Anyone can react to it or spin a thread from it, and this can't be taken back.", { buildName: "Pipewrench is a Heel. This shows everyone that, as checked by the game, as Pipewrench's own post. Anyone can react to it or spin a thread from it, and this can't be taken back.", box: 'none', type: false }),
    part('board-label', 'text', 'BOARD', { ...UNDER, buildShift: DOWN.fields }),
    part('board', 'combobox', '', { ...UNDER, type: false, buildName: 'Board (optional)', buildShift: DOWN.selects }),
    part('thread-label', 'text', 'THREAD', { ...UNDER, buildShift: DOWN.fields }),
    part('thread', 'combobox', '', { ...UNDER, type: false, buildName: 'Thread', nth: 1, buildNth: 0, buildShift: DOWN.selects }),
    part('words-label', 'text', "IN THE CHARACTER'S WORDS (OPTIONAL)", { ...UNDER, buildShift: DOWN.words }),
    part('hint', 'text', 'Plain text.', { ...UNDER, type: false, buildShift: DOWN.count }),
    part('count', 'text', '21 of 200', { ...UNDER, type: false, buildShift: DOWN.count }),
    part('preview-head', 'text', 'What everyone will see', { box: 'none', type: false }),
    part('foot-line', 'text', 'The reveal is checked by The System and posted at once.', { buildName: 'The reveal is checked by the game and posted at once.', box: 'none', type: false }),
    part('cancel', 'button', 'CANCEL', { buildName: 'Cancel', type: false, box: 'none' }),
    part('reveal', 'button', 'REVEAL PIPEWRENCH AS A HEEL', { buildName: 'Reveal Pipewrench as a Heel', type: false, box: 'none' }),
  ],
};

export default manifest;
