/**
 * Board 21, Settings › The board on the phone (docs/research/2026-11-06-board-look/21-theme-picker-phone.html): two screens at 390 by 844 side by side, House chosen
 * and then Hot Rod, as the stories `Boards/19 Theme picker`'s `Picker, phone` and `One mode, phone` draw them. The preview drops its Last post column, the tiles are
 * three across, and Mode's choices stack. The page is read at 390, so its first screen stands at the window's left, and that is the one compared first; the second
 * (the `also` side) is found as the page's second of each part.
 *
 * Each screen is measured from its own section heading (`origin`), so a screen's place on the page is never compared; the board draws no page head or rail, so
 * nothing above the section is held.
 *
 * Departures by decision: the board is drawn in the desktop's sizes (19px sentences, a 44px heading) and the build in the phone tokens (17px and 20px, a 40px
 * heading), so no type is compared (`type: false`) and a part is held by its place, with the shift the first run measured, each added to the board's:
 *  - The build's row label stands 15px higher than the board's small label over its row (the build's phone rows pad 16 with a 12px gap, the board's 14 and 8), and
 *    the miniature 11px higher. Its list is 15px shorter (the build's rows are as tall as their words, the board's 4px padded rows hold two lines of its 10px type),
 *    so the tiles stand 27px higher.
 *  - The board's sentence under the tiles runs to two lines at 19px where the build's 17px runs to one, so the Mode row under it stands 44px higher again; its
 *    choices, each 48px tall in the build and 52 on the board, stand 66 to 70px higher, and its sentence 71.
 *  - Hot Rod's Mode sentence (the second screen) is the same words in the build, and the one-mode choices stack as the first screen's do.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

const at = (id: string, role: string, name: string, y: number, n: number, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'board', box: 'position', type: false, nth: n, buildNth: 0, buildShift: { y }, ...more,
});

/** One screen's parts, the `n`th of each on the board page and the first of each on the build's. */
const screen = (n: number, note: string, buildNote: string): Landmark[] => [
  { id: 'board', role: 'heading', name: 'THE BOARD', nth: n, buildNth: 0, box: 'none', type: false },
  at('theme-label', 'text', 'THEME', -15, n, { buildName: 'Theme' }),
  at('preview-logo', 'text', 'DIVIDED WORLD', -11.4, n),
  at('preview-button', 'text', 'start a thread', -11.4, n),
  at('tile-house', 'text', 'HOUSE', -26.7, n),
  at('theme-note', 'text', 'Applies to the board at once, on every device you sign in on.', -24.5, n),
  at('mode-label', 'text', 'MODE', -69, n, { buildName: 'Mode' }),
  at('mode-device', 'text', 'FOLLOW MY DEVICE', -65.9, n),
  at('mode-light', 'text', 'LIGHT', -67.9, n),
  at('mode-dark', 'text', 'DARK', -69.9, n),
  /* Each screen's sentence is its own words, so it is the board page's only one of them. */
  at('mode-note', 'text', note, -71.4, 0, { buildName: buildNote }),
];

const HOUSE = 'The 2003 board stays 2003 whichever you choose. Only its look changes. The game’s own pieces (orbs, cards, reactions, marks) keep theirs.';
const HOT_ROD = 'Hot Rod comes in dark only, so the board stays dark whatever your device says. Choose House for light and dark.';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/21-theme-picker-phone',
  size: { width: 390, height: 844 },
  build: { story: 'boards-19-theme-picker--picker-phone' },
  landmarks: screen(0, HOUSE, HOUSE.replace('’', '\'')),
  also: [{ name: 'Hot Rod', build: { story: 'boards-19-theme-picker--one-mode-phone' }, landmarks: screen(1, HOT_ROD, HOT_ROD) }],
};

export default manifest;
