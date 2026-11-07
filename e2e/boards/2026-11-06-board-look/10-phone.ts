/**
 * Board 10, a profile and its record on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/10-phone.html, four screens at 390 by
 * 844 side by side: the profile, the trophy case and the lineage, the record, then the profile in dark, compared on colors only, by web/contrast.test.tsx).
 * The record is the board's third screen, 828px to the right of the window's left, and is what this manifest compares (Task 8's): the build is the story
 * `Boards/10 Record` (engine/ui/profile/Record.board.stories.tsx), held at that offset.
 *
 * The first two screens are Task 9's (the profile's facts as a table under its band, the trophy case and the belt's lineage, which the cosmetics plan
 * builds): the board's phone profile leads with the avatar beside the rank and title, then the facts as a two-column table and the signature, and the
 * case folds On posts under each row's line. They are named here as that task's departures and are compared by its manifests (08-profile and the case
 * boards), not by this one.
 *
 * Departures, each a decision:
 *  - The record's kinds are bare links in the build until Task 9 draws them as small Chrome buttons (the current one pressed); here they are held by their
 *    words and their row (the current one, All, is no link, so Posts and Seasons stand for the row's ends), one row at 390, and not by their widths.
 *  - The rows' words and dates are the story's, not the board's (a date reads "9 days ago" for a while and then a date, as in 02-board), so no row is
 *    compared here; a row's date stacking above its words is held by e2e/phone-board.spec.ts.
 *  - The title stands 53px lower and the kinds 56px (the banner and the crumb stand lower than the board draws them, as in 03-phone and 07-phone, and the
 *    build's crumb is a line taller); the kinds' x is not compared, since the build's links are spaced by their gap and the board's buttons by their padding.
 */
import type { BoardManifest } from '../../board-match.ts';

const SCREEN = -828;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/10-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-10-record--record' },
  landmarks: [
    { id: 'title', role: 'heading', name: 'Spritey’s public record', box: 'position', buildShift: { x: SCREEN, y: 52.6 } },
    { id: 'kind-posts', role: 'link', name: 'posts', buildName: 'Posts', box: 'height', type: false, buildShift: { y: 55.6 } },
    { id: 'kind-seasons', role: 'link', name: 'seasons', buildName: 'Seasons', box: 'height', type: false, buildShift: { y: 55.6 } },
  ],
};

export default manifest;
