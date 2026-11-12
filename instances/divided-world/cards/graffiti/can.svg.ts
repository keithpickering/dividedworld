/**
 * Graffiti's drawn spray can (the owner chose style D, docs/research/2026-11-11-graffiti/01-tool-styles.html): the one drawing the
 * toolbar's cans, the Draw tile's icon and the cursor's can all come from. It is the card's art inside the glass, so its metal and its
 * outline are drawn here and its paint is whatever fill the caller gives: a hex from the palette (`CANS`), or a CSS variable for the
 * cursor, which recolors one element with the can the player holds. A data list and a string, with no DOM, so it runs anywhere.
 */
export const CAN_VIEWBOX = '0 0 24 60';
/** Where the nozzle's tip is in the can's own box: the spray starts here, and the cursor's hot spot is here. */
export const CAN_NOZZLE = { x: 12, y: 3 } as const;

export interface CanShape { readonly tag: 'rect' | 'path'; readonly attrs: Readonly<Record<string, string | number>> }

const INK = '#111';
const METAL = '#d9dde3';
const SHADE = '#9aa0a8';
const NOZZLE = '#222';

/** The can's parts, back to front, its cap and label in `fill`. */
export function canShapes(fill: string): readonly CanShape[] {
  return [
    { tag: 'rect', attrs: { x: 9, y: 1, width: 6, height: 5, rx: 1, fill: NOZZLE } },
    { tag: 'path', attrs: { d: 'M4 14 Q4 7 12 6 Q20 7 20 14 Z', fill, stroke: INK, 'stroke-width': 0.8 } },
    { tag: 'rect', attrs: { x: 3, y: 13, width: 18, height: 44, rx: 2.5, fill: METAL, stroke: INK, 'stroke-width': 0.8 } },
    { tag: 'rect', attrs: { x: 3, y: 20, width: 18, height: 26, fill, stroke: INK, 'stroke-width': 0.6 } },
    { tag: 'rect', attrs: { x: 5, y: 14, width: 3, height: 41, rx: 1.5, fill: '#fff', opacity: 0.55 } },
    { tag: 'rect', attrs: { x: 3, y: 52, width: 18, height: 5, rx: 1.5, fill: SHADE, stroke: INK, 'stroke-width': 0.6 } },
  ];
}

/** The same parts as SVG markup for an element made outside React (the cursor's). */
export function canMarkup(fill: string): string {
  return canShapes(fill).map(({ tag, attrs }) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}
