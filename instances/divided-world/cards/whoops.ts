/**
 * Whoops! (Salty): the caster splats a post in a color of their choosing. Any reader can scrub
 * the ink on their own screen; only the post's author's strokes are saved, so they can wash it
 * clean or write back in the ink, and everyone loads into their version (design, section 7).
 * The card sells at its base price; playing it on a long post costs the rest, 0.25 per 500
 * characters, never more than 3.00 in all (section 10).
 *
 * Strokes are paths in the post's own coordinates, 0 to 1 across and down, so handwriting stays
 * legible at any width, kept to a thousandth of the post. Their count, their points one by one
 * and in all, and their width are bounded, so the largest save there can be fits the
 * database's bound on it (effect_state, supabase/migrations/0006_cards.sql), which
 * cards.test.ts measures as Postgres writes it.
 */
import { basePrice, color, economyOf, landsOncePerPost, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

export const STROKES = { most: 200, points: 500, totalPoints: 12_000, widest: 64 } as const;
const thousandth = (n: number) => Math.round(n * 1000) / 1000;

export const whoops: CardRules<{ color: string }> = {
  key: 'whoops',
  name: 'Whoops!',
  alignment: 'salty',
  priceKey: 'whoops.price',
  reads: ['whoops.perLength', 'whoops.lengthStep', 'whoops.mostInAll'],
  playPrice: (settings, target) =>
    Math.max(0, Math.min(economyOf(settings, 'whoops.perLength') * Math.floor(target.length / economyOf(settings, 'whoops.lengthStep')),
      economyOf(settings, 'whoops.mostInAll') - basePrice(whoops, settings))),
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
    let total = 0;
    for (const s of strokes) {
      if (typeof s !== 'object' || s === null) return refuse('a stroke is a path');
      const { color: c, width, points } = s as { color?: unknown; width?: unknown; points?: unknown };
      const ink = color(c);
      if (!ink) return refuse('a stroke\'s color is a color');
      if (typeof width !== 'number' || !(width > 0 && width <= STROKES.widest)) return refuse(`a stroke is between 0 and ${STROKES.widest} wide`);
      if (!Array.isArray(points) || points.length < 1 || points.length > STROKES.points) return refuse(`a stroke has 1 to ${STROKES.points} points`);
      total += points.length;
      if (total > STROKES.totalPoints) return refuse(`at most ${STROKES.totalPoints} points in all`);
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) {
          return refuse('a point is two numbers from 0 to 1, across and down the post');
        }
      }
      out.push({ color: ink, width, points: (points as [number, number][]).map(([x, y]) => [thousandth(x), thousandth(y)]) });
    }
    return ok({ strokes: out });
  },
};
