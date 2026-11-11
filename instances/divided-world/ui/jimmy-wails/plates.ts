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
 * The numbers are starting values; the owner judges them on the shots.
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
}

export const PLATES: readonly Plate[] = Object.freeze([
  // Jimbo in a blue shirt, fading to white on the right: the panel carries on that white, and the words go in it.
  { key: 'blue-shirt', src: blueShirt, width: 450, height: 300, extend: 'right', panel: { width: 450, color: '#fff' }, box: { x: 470, y: 24, w: 410, h: 252 }, ink: '#222' },
  // A close-up on the right, fading to white and green on the left: the words go in the left 45%.
  { key: 'close-up', src: closeUp, width: 799, height: 301, extend: null, panel: null, box: { x: 20, y: 20, w: 340, h: 261 }, ink: '#222' },
  // Jimbo on the right, a near-black band and a blue logo mark on the left: white words in the left half.
  { key: 'dark-logo', src: darkLogo, width: 769, height: 300, extend: null, panel: null, box: { x: 20, y: 20, w: 364, h: 260 }, ink: '#fff' },
]);
