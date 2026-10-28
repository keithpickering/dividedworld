/**
 * Whoops! (Salty): the caster splats a post in a color of their choosing. Any reader can scrub
 * the ink on their own screen; only the post's author's strokes are saved, so they can wash it
 * clean or write back in the ink, and everyone loads into their version (design, section 7).
 * The card sells at its base price; playing it on a long post costs the rest, 0.25 per 500
 * characters, never more than 3.00 in all (section 10).
 *
 * Strokes are paths in the post's own coordinates, 0 to 1 across and down, so handwriting stays
 * legible at any width; their count, length and width are bounded, so one save is never more
 * than a few hundred kilobytes.
 */
import { color, landsOncePerPost, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { economy } from '../settings.ts';

const { price, perLength, lengthStep, mostInAll } = economy.whoops;
export const STROKES = { most: 200, points: 500, widest: 64 } as const;

export const whoops: CardRules<{ color: string }> = {
  key: 'whoops',
  name: 'Whoops!',
  alignment: 'salty',
  basePrice: price,
  playPrice: (target) => Math.min(perLength * Math.floor(target.length / lengthStep), mostInAll - price),
  canApply: (target, effects) => landsOncePerPost('whoops', target, effects),
  validateConfig: (config) => {
    const ink = color(typeof config === 'object' && config !== null ? (config as { color?: unknown }).color : undefined);
    return ink ? ok({ color: ink }) : refuse('the ink is a color: a named one, or #rgb or #rrggbb');
  },
  validateState: (state) => {
    const strokes = typeof state === 'object' && state !== null ? (state as { strokes?: unknown }).strokes : undefined;
    if (!Array.isArray(strokes)) return refuse('strokes are a list');
    if (strokes.length > STROKES.most) return refuse(`at most ${STROKES.most} strokes`);
    const out = [];
    for (const s of strokes) {
      if (typeof s !== 'object' || s === null) return refuse('a stroke is a path');
      const { color: c, width, points } = s as { color?: unknown; width?: unknown; points?: unknown };
      const ink = color(c);
      if (!ink) return refuse('a stroke\'s color is a color');
      if (typeof width !== 'number' || !(width > 0 && width <= STROKES.widest)) return refuse(`a stroke is between 0 and ${STROKES.widest} wide`);
      if (!Array.isArray(points) || points.length < 1 || points.length > STROKES.points) return refuse(`a stroke has 1 to ${STROKES.points} points`);
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) {
          return refuse('a point is two numbers from 0 to 1, across and down the post');
        }
      }
      out.push({ color: ink, width, points: points as [number, number][] });
    }
    return ok({ strokes: out });
  },
};
