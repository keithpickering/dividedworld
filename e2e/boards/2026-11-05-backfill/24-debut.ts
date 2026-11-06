/**
 * Board 24, the Debut dialog, choosing how (docs/research/2026-11-05-backfill/24-debut.html, 1440 by 1000): My characters behind it, the dialog
 * over it on the Turn's smoke with How loud as one row of three, its preview, and the footer's one line beside Cancel and Save. The build is the story
 * `Boards/00 Characters` › `Waiting` (engine/ui/characters/Dialogs.board.stories.tsx), reached as a player reaches it: Change how Waiting Wanda
 * debuts. The story's world has the board's 7 h 42 min to the settlement, set when the story is, so the footer's countdown reads as the board's.
 * `40-debut-now.ts` is this board's frame with its own title and footer.
 *
 * The dialog is one frame (engine/ui/glass/Frame.tsx) 1100px wide where the board draws it (the Reveal board's too), and is held by its width and its
 * x; the page behind it is not compared (the dialog's overlay stands over the page, and the board draws the page for place only). Every part of the
 * dialog is compared from the dialog's own top-left corner (`origin`), so where the overlay centers it is never compared.
 *
 * Departures by decision:
 *  - The dialog's title is the frame's 68px (4.25rem, characters.css) where the board draws 60px, and the kicker the frame's 21px, so neither is compared by its
 *    size; the board's Close is an icon where the build's word is drawn off its square, so it is compared by its box.
 *  - The options keep the build's words: a bold name with a period after it ("Silent."), and the board's "SILENT" is found by that. A button's measure is the
 *    glass's own (48px of the body's size, where the board's `.btn` is 52px), and the save button says the character's name ("Save how Waiting Wanda
 *    debuts") where the board's says "SAVE HOW IT DEBUTS", so Cancel and the save are compared by their places only.
 *  - The preview's words are previews.ts's, the thread's own, at the type scale (the glass polish, design section 7), so only The System's name is compared.
 *  - Section labels are the glass's body-size label in its quieter text where the board draws 22px in the full text; compared by their words and place.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part of the dialog, held by its place from the dialog's corner. */
export const part = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, within: 'dialog', origin: 'dialog', box: 'position', ...more });

/** The parts the two Debut boards share, with the footer's words and the save button's name each draws. */
export function debutLandmarks(o: { readonly title: string; readonly buildTitle: string; readonly foot: string; readonly save: string; readonly buildSave: string; readonly silent: string; readonly where: string }): Landmark[] {
  return [
    { id: 'dialog', role: 'dialog', name: o.buildTitle, buildName: o.buildTitle, type: false, box: 'across' },
    part('kicker', 'text', 'MY CHARACTERS › DEBUT', { buildName: 'My characters › Debut', type: false }),
    part('title', 'heading', o.title, { buildName: o.buildTitle, type: false }),
    part('close', 'button', 'Close', { type: false, box: 'size' }),
    part('loud', 'group', 'How loud', { type: false, box: 'none' }),
    part('silent', 'text', 'SILENT', { buildName: 'Silent.', within: 'loud', origin: 'loud', buildShift: { y: -9 } }),
    part('announced', 'text', 'ANNOUNCED', { buildName: 'Announced.', within: 'loud', origin: 'loud', buildShift: { y: -9 } }),
    part('with-class', 'text', 'ANNOUNCED, WITH ITS CLASS', { buildName: 'Announced, with its class.', within: 'loud', origin: 'loud', buildShift: { y: -9 } }),
    part('preview-head', 'text', 'What everyone will see', { box: 'none', type: false }),
    part('preview-by', 'text', 'The System', { box: 'none', type: false }),
    part('foot-line', 'text', o.foot, { box: 'none', type: false }),
    part('cancel', 'button', 'CANCEL', { buildName: 'Cancel', type: false, box: 'none' }),
    part('save', 'button', o.save, { buildName: o.buildSave, type: false, box: 'none' }),
  ];
}

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/24-debut',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-characters--waiting' },
  press: [{ role: 'button', name: 'Change how Waiting Wanda debuts' }],
  landmarks: debutLandmarks({
    title: "HOW WAITING WANDA DEBUTS", buildTitle: 'How Waiting Wanda debuts',
    foot: 'It debuts at the next settlement, in 7 h 42 min. Until then you can drop it now instead.',
    save: 'SAVE HOW IT DEBUTS', buildSave: 'Save how Waiting Wanda debuts', silent: 'Nobody is told. Waiting Wanda simply appears.', where: 'In the tally at the next settlement',
  }),
};

export default manifest;
