/**
 * Jimmy Wails's plates: the pictures a banner is drawn on (docs/plans/2026-11-03-jimmy-wails-design.md, section 5). The card draws one of
 * these keys at each play (`CardRules.draws`, instances/divided-world/cards/jimmy-wails.ts), and the banner paints the appeal's words in the
 * plate's `box`, so the words sit where the original appeal's text sat. The picture files are the research copies of the plates with the
 * text painted out (docs/research/minus-world/jimmy-wails-plates/, which stays as the record); a plate in the pool is the card's draw, so
 * adding or removing one is a change to the card's `draws` too, and plates.test.tsx holds the two together.
 *
 * Everything is in the plate's own pixels, so a banner scales by one factor and the words stay where they were set:
 * - `width` and `height` are the picture's size (read from the file by the test).
 * - `extend: 'right'` lays a panel of `panel.width` pixels in `panel.color` beside the picture, for a plate whose picture holds no room
 *   for words; the banner is then `width + panel.width` wide. A plate that does not extend has `extend: null` and `panel: null`.
 * - `box` is where the words go, in the banner's pixels (the panel's included).
 * - `ink` is the words' color on the plate.
 * - `boxRange` is the darkest and the lightest color under the box (the panel's included), measured from the picture file, since a test cannot
 *   sample an image: the ink must keep a 4.5 ratio against both (Banner.test.tsx). Measured again whenever the picture or the box moves.
 * - `credit` is the photograph's: who took it, its page on Wikimedia Commons and the license it is used under. Every plate is a photograph of
 *   Jimmy Wales that the Wikimedia Foundation published under CC BY-SA 3.0, which asks for the photographer's name, a link to the license and a
 *   note that the picture was changed; the banner says all three under the picture (Banner.tsx), and `plates/CREDITS.md` says the same of the
 *   files, which are themselves under that license. A plate added to the pool comes with its credit.
 * The numbers are starting values; the owner judges them on the shots. Two moved in Task 7 to keep their contrast: close-up's box left the dark green
 * at its right, and dark-logo, whose near-black band is only 65 pixels wide, got a near-black panel on its right to hold the white words.
 */
import blueShirt from './plates/blue-shirt.png?url';
import closeUp from './plates/close-up.png?url';
import darkLogo from './plates/dark-logo.png?url';

export interface Plate {
  readonly key: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly extend: 'right' | null;
  readonly panel: { readonly width: number; readonly color: string } | null;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly ink: '#fff' | '#222';
  readonly boxRange: { readonly darkest: string; readonly lightest: string };
  readonly credit: { readonly author: string; readonly source: string; readonly license: string; readonly licenseUrl: string };
}

const BY_SA_3 = { license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' } as const;
const HARTWELL = 'Lane Hartwell';
const GOLDBERG = 'Nicolas Goldberg';

export const PLATES: readonly Plate[] = Object.freeze([
  // Jimbo in a blue shirt, fading to white on the right: the panel carries on that white, and the words go in it.
  { key: 'blue-shirt', src: blueShirt, width: 450, height: 300, extend: 'right', panel: { width: 450, color: '#fff' }, box: { x: 470, y: 24, w: 410, h: 252 }, ink: '#222', boxRange: { darkest: '#ffffff', lightest: '#ffffff' }, credit: { author: HARTWELL, source: 'https://commons.wikimedia.org/wiki/File:Jimmy_Wales_July_2010.jpg', ...BY_SA_3 } },
  // A close-up on the right, fading to white and green on the left: the words go in the left 30%, where it is light (the green darkens past x 310).
  { key: 'close-up', src: closeUp, width: 799, height: 301, extend: null, panel: null, box: { x: 40, y: 20, w: 230, h: 261 }, ink: '#222', boxRange: { darkest: '#918b5d', lightest: '#c6d2c8' }, credit: { author: HARTWELL, source: 'https://commons.wikimedia.org/wiki/File:Jimmy_Wales_July_2010_4.jpg', ...BY_SA_3 } },
  // Jimbo on the right, beige and a blue logo mark across the picture, and only a 65-pixel near-black band at its left edge: a near-black panel
  // carries on to the right of him, and the white words go in it.
  { key: 'dark-logo', src: darkLogo, width: 769, height: 300, extend: 'right', panel: { width: 360, color: '#0c0c0e' }, box: { x: 789, y: 20, w: 320, h: 260 }, ink: '#fff', boxRange: { darkest: '#0c0c0e', lightest: '#0c0c0e' }, credit: { author: GOLDBERG, source: 'https://commons.wikimedia.org/wiki/File:Wikimania_2009_GOLDBERGN-9398.jpg', ...BY_SA_3 } },
]);
