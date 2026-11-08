/**
 * Board 10, a profile and its record on the phone, in the Silver house theme (docs/research/2026-11-06-board-look/10-phone.html, four screens at 390 by
 * 844 side by side: the profile, the trophy case and the lineage, the record, then the profile in dark, compared on colors only, by web/contrast.test.tsx).
 * The record is the board's third screen, 828px to the right of the window's left, and is what this manifest compares (Task 8's): the build is the story
 * `Boards/10 Record` (engine/ui/profile/Record.board.stories.tsx), held at that offset.
 *
 * The first screen is the profile (Task 9's), the `also` side below, the story `Boards/08 Profile` read at the window's left; the second, the trophy case and
 * the belt's lineage, is the cosmetics plan's (docs/plans/2026-11-04-cosmetics-plan.md, its Task 10: the case folds On posts under each row's line), is
 * named here as that plan's departure and is not compared.
 *
 * Departures, each a decision:
 *  - The record's kinds are small Chrome buttons (Task 9, the current one pressed); here they are held by their words and their row (the current one, All, is
 *    no link, so Posts and Seasons stand for the row's ends), one row at 390, and not by their widths.
 *  - The rows' words and dates are the story's, not the board's (a date reads "9 days ago" for a while and then a date, as in 02-board), so no row is
 *    compared here; a row's date stacking above its words is held by e2e/phone-board.spec.ts.
 *  - The profile screen (the `also` side): the board draws two tables, the avatar beside the rank and the title, then the facts under them; the build is one
 *    table, a grid whose label column (112px) the avatar cell shares, so the rank and title stand 15.8px and 7.8px to the right of where the board's own cell
 *    puts them (the title's box is its whole cell, not the board's line), the rank 53.6px and the title 57.6px lower (the title stands 52.6px lower, as the
 *    record's does). The facts stand 39.6px lower, their rows the board's height: the board's first table is 173px with a 15px gap under it where the
 *    build's avatar cell is 168px with a 1px grid line. Wearing (the cosmetics plan's, 52.9px with its two lines) is not drawn, so the class and the signature stand
 *    13.3px and 11.1px higher than the board's. The avatar is decoration and the portrait the cosmetics plan's, so neither is compared. The band is clipped on
 *    the phone, as the board draws none.
 *  - The profile's Group row (docs/plans/2026-11-06-member-groups-design.md, the member groups plan's Task 12) stands after Rank, which the board, drawn
 *    before it, does not hold: every fact under it and the signature stand GROUP_ROW lower.
 *  - The profile's Pronouns row (the pronouns plan, docs/plans/2026-11-07-pronouns-plan.md) is the build's and not the board's: it stands after the rank and
 *    the title, so every fact under it, the class and the signature stand a row (32.9px) lower again than the shifts the departure above gives them.
 *  - The title stands 53px lower and the kinds 56px (the banner and the crumb stand lower than the board draws them, as in 03-phone and 07-phone, and the
 *    build's crumb is a line taller); the kinds' x is not compared, since the build's links are spaced by their gap and the board's buttons by their padding.
 */
import type { BoardManifest } from '../../board-match.ts';

const SCREEN = -828;
/** The Group row's room on the phone, in px: its label over its value. */
const GROUP_ROW = 35;

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/10-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-10-record--record' },
  landmarks: [
    { id: 'title', role: 'heading', name: 'Spritey’s public record', box: 'position', buildShift: { x: SCREEN, y: 52.6 } },
    { id: 'kind-posts', role: 'link', name: 'posts', buildName: 'Posts', box: 'height', type: false, buildShift: { y: 55.6 } },
    { id: 'kind-seasons', role: 'link', name: 'seasons', buildName: 'Seasons', box: 'height', type: false, buildShift: { y: 55.6 } },
  ],
  /* The first screen, the profile, stands at the window's left: the build is the story `Boards/08 Profile`. */
  also: [{
    name: 'profile',
    build: { story: 'boards-08-profile--profile' },
    landmarks: [
      { id: 'title', role: 'heading', name: 'Spritey', buildShift: { y: 52.6 } },
      { id: 'rank', role: 'text', name: 'Main Eventer', box: 'position', buildShift: { x: 15.8, y: 53.6 } },
      { id: 'level', role: 'text', name: 'Level editor guy', box: 'position', buildShift: { x: 7.8, y: 57.6 } },
      { id: 'fact-aura', role: 'rowheader', name: 'Aura this season', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-place', role: 'rowheader', name: 'Place', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-posts', role: 'rowheader', name: 'Posts', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-spun', role: 'rowheader', name: 'Threads spun', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-cards', role: 'rowheader', name: 'Cards played', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-joined', role: 'rowheader', name: 'Joined', box: 'position', buildShift: { y: 72.5 + GROUP_ROW } },
      { id: 'fact-class', role: 'rowheader', name: 'Class', box: 'position', buildShift: { y: 19.6 + GROUP_ROW } },
      { id: 'signature', role: 'text', name: 'posting in pencil since 2003', box: 'position', buildShift: { y: 21.9 + GROUP_ROW } },
    ],
  }],
};

export default manifest;
