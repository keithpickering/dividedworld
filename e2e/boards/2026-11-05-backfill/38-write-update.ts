/**
 * Board 38, Write an update (docs/research/2026-11-05-backfill/38-write-update.html, 1440 by 1600): the form in the glass's chamfered piece (headed Write an
 * update, its labels in the field label's color, each change's Remove shown), and under it "What everyone will see": the update as the Updates page draws it,
 * Gabe's frame. The build is the story `Boards/00 Write update` (engine/ui/admin/WriteUpdate.board.stories.tsx), an admin on Updates, who presses Write an
 * update and types the board's draft as an admin types it; the preview follows what is typed and nothing is posted.
 *
 * Departures by decision:
 *  - The form's own place and size are not compared (below): its top is the Updates page's, under its lede and the Write an update button, and its width the
 *    main column's (904px where the board draws 920).
 *  - The form's head is the glass's display token, 40px, where the board draws 44px; the preview's headline, name and tagline are the glass's tokens nearest the
 *    board's compact post (40, 26 and 21px where it draws 34, 28 and 20), and its heading the body's 21px where the board draws 22px.
 *  - A button's measure is the glass's own, so Remove and Post are held by their place with the width's difference as their shift (the right-aligned count
 *    is 20px left of the board's, which draws the form 16px wider, and the field count's own line is 9px taller than the board's).
 *  - The words' count is the build's own (the board's sample draws 78 for the 76 characters it shows), and the preview's "What changed" is the page's color
 *    for it, not the board's, so its type is not compared; the preview's list stands 24px lower than the board's (the page's own paragraph and list spacing).
 *
 * The board draws the form alone on its page, at the page's left; the build's is in the Updates page's main column, to the right of the lede and the archive. So
 * every part is held from the form's own top-left corner (`origin`), the form's place on the page is never compared, and the preview, which flows under the form,
 * is held from the form's bottom edge.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the form's corner. */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'form', box: 'position', ...more });

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/38-write-update',
  size: { width: 1440, height: 1600 },
  build: { story: 'boards-00-write-update--write-update' },
  press: [
    { role: 'button', name: 'Write an update' },
    { role: 'textbox', name: 'Title', fill: 'Whoops! costs less on short posts' },
    { role: 'textbox', name: 'Words', fill: 'A long post still costs more to splat. A short one costs what the slot says.' },
    { role: 'textbox', name: 'Change 1 label', fill: 'Whoops!' },
    { role: 'textbox', name: 'Change 1 text', fill: '0.25 more for every 500 characters, from the first 500.' },
  ],
  landmarks: [
    { id: 'form', role: 'form', name: 'WRITE AN UPDATE', buildName: 'Write an update', type: false, box: 'none' },
    at('head', 'heading', 'WRITE AN UPDATE', { buildName: 'Write an update', buildSize: 40 }),
    at('note', 'text', 'This posts as Gabe. Every player gets it as an alert. No model writes it, and the page says it is always true, so check the facts.'),
    at('title-label', 'text', 'TITLE'),
    at('words-label', 'text', 'WORDS'),
    at('count', 'text', '78 of 20000', { buildName: '76 of 20000', type: false, buildShift: { x: -20 } }),
    at('changed-label', 'text', 'WHAT CHANGED', { buildShift: { y: 9 } }),
    at('changed-hint', 'text', 'A bold label (it can be left empty) and the words after it, one change to a row. A row with nothing in it is left out.'),
    at('remove', 'button', 'Remove change 1', { type: false, buildShift: { x: 8.7, y: 9 } }),
    at('add', 'button', 'ADD A CHANGE', { buildName: 'Add a change', type: false }),
    at('post', 'button', 'POST UPDATE', { buildName: 'Post update', type: false, buildShift: { x: -11.6 } }),
    at('preview-head', 'heading', 'WHAT EVERYONE WILL SEE', { buildName: 'What everyone will see', buildSize: 21, originEdge: 'bottom' }),
    at('preview-name', 'text', 'GABE', { buildName: 'Gabe', buildSize: 26, originEdge: 'bottom' }),
    at('preview-tagline', 'text', 'Made this. Sorry.', { buildSize: 21, originEdge: 'bottom' }),
    at('preview-title', 'heading', 'Whoops! costs less on short posts', { buildSize: 40, originEdge: 'bottom' }),
    at('preview-changed', 'text', 'WHAT CHANGED', { nth: 1, buildNth: 1, originEdge: 'bottom', type: false, buildShift: { y: 24 } }),
  ],
};

export default manifest;
