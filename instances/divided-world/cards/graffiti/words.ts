/**
 * Graffiti's words (plan Task 10; design sections 8, 9 and 11): the names the toolbar gives its cans, caps, stencils and spots, and the plain
 * words a drawing is described in for the Lens and the log. They are the glass's: out of character, true, in American English. A drawing is
 * described from its Act's public payload alone (the colors, and the stencil's key), never an owner or a class.
 *
 * `describeDraw` is `CardUi.describeDraw`: the Act's payload in, plain words out. `LOG_DRAW` and `LOG_WASH` are `CardUi.logDraw` and `logWash`.
 */
import { CANS, CAPS, type Can } from '../graffiti.ts';
import { STENCIL_KEYS, type StencilKey } from './stencils.ts';

const capital = (word: string) => word[0]!.toUpperCase() + word.slice(1);

/** A can is named by its color. */
export const CAN_NAMES = Object.fromEntries(Object.keys(CANS).map((k) => [k, capital(k)])) as Record<Can, string>;
export const CAP_NAMES = Object.fromEntries(Object.keys(CAPS).map((k) => [k, capital(k)])) as Record<keyof typeof CAPS, string>;
export const STENCIL_NAMES: Record<StencilKey, string> = { mustache: 'Mustache', horns: 'Horns', crown: 'Crown', kilroy: 'Kilroy was here', x: 'Big X', smiley: 'Smiley' };
/** What a stencil is, to sit in a sentence ("a crown in pink"). */
const STENCIL_NOUNS: Record<StencilKey, string> = { mustache: 'a mustache', horns: 'horns', crown: 'a crown', kilroy: 'Kilroy was here', x: 'a big X', smiley: 'a smiley' };
/** The nine cells of the 3 by 3 grid over the post, left to right and top to bottom. */
export const SPOT_NAMES: readonly string[] = [
  'Top left', 'Top center', 'Top right', 'Middle left', 'Middle center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right',
];

const isCan = (v: unknown): v is Can => typeof v === 'string' && Object.hasOwn(CANS, v);
const isStencil = (v: unknown): v is StencilKey => typeof v === 'string' && (STENCIL_KEYS as readonly string[]).includes(v);

/** "pink", "pink and lime", "red, lime and blue". */
const listed = (items: readonly string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join(''));

/** What a draw's payload shows of the drawing: a stencil and its color, or the colors of its strokes, once each in the order first used; undefined where it shows neither. */
function readDraw(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { stencil, can, strokes } = payload as { stencil?: unknown; can?: unknown; strokes?: unknown };
  if (stencil !== undefined) return isStencil(stencil) && isCan(can) ? `${STENCIL_NOUNS[stencil]} in ${can}` : undefined;
  if (!Array.isArray(strokes)) return undefined;
  const colors: string[] = [];
  for (const s of strokes as unknown[]) {
    const c = typeof s === 'object' && s !== null ? (s as { can?: unknown }).can : undefined;
    if (isCan(c) && !colors.includes(c)) colors.push(c);
  }
  return colors.length > 0 ? listed(colors) : undefined;
}

/** A draw in the Lens's row: its colors, or its stencil ("pink and lime", "a crown in pink"); "a tag" where the payload shows neither. */
export const describeDraw = (payload: unknown): string => readDraw(payload) ?? 'a tag';
/** The words the log and the Lens say a draw in (`CardUi.logDraw`): "You tagged Spritey's post (6% of the wall)", "and 14 older tags, washed or painted over". */
export const LOG_DRAW = { verb: 'tagged', noun: 'tag', nouns: 'tags', surface: 'the wall' } as const;
/** The verb of the post's own wash (`CardUi.logWash`): "You washed 9% of the wall off your post". */
export const LOG_WASH = { verb: 'washed' } as const;
