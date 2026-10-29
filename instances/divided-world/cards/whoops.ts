/**
 * Whoops! (Salty): the caster splats a post in a color of their choosing. Any reader can scrub
 * the ink on their own screen; only the post's author's strokes are saved, so they can wash it
 * or write back in the ink, and everyone loads into their version (the screens' design, section
 * 11). Up to three Whoops! stack on one post, each its own play, layer and seed; the server
 * chooses each play's seed, and every reader draws the same splat from it. The card sells at its
 * base price; playing it on a long post costs the rest, 0.25 per 500 characters, never more than
 * 3.00 in all (the core loop's design, section 10).
 *
 * While a post is splatted its text is laid out at one fixed width and scaled as a whole, so a
 * stroke is measured in widths of that layout: across from 0 to 1, down from 0 to 64, kept to a
 * thousandth. A post laid out taller than 64 widths has text below any stroke's reach; the screens
 * hold the splat within the first 64, and `clean` still washes the whole layer away. A stroke
 * keeps its place when an edit reflows the text under it. A stroke washes (no color) or inks
 * (the author writing back, in a color); its width is kept to a thousandth too. `clean` is the
 * author's save saying the layer is washed clean, so it fades for everyone. Counts, points and widths are bounded so the largest save
 * there can be fits the database's bound on it (effect_state, supabase/migrations/0006_cards.sql),
 * which cards.test.ts measures as Postgres writes it.
 */
import { basePrice, color, economyOf, landsOnPost, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

export const STROKES = { most: 200, points: 500, totalPoints: 12_000, widest: 64, deepest: 64 } as const;
const thousandth = (n: number) => Math.round(n * 1000) / 1000;

type Stroke = { tool: 'wash'; width: number; points: [number, number][] } | { tool: 'ink'; color: string; width: number; points: [number, number][] };

export const whoops: CardRules<{ color: string }> = {
  key: 'whoops',
  name: 'Whoops!',
  alignment: 'salty',
  priceKey: 'whoops.price',
  stack: 3,
  seeded: true,
  reads: [{ key: 'whoops.perLength', whole: true, min: 0 }, { key: 'whoops.lengthStep', whole: true, min: 1 }, { key: 'whoops.mostInAll', whole: true, min: 1 }],
  playPrice: (settings, target) =>
    Math.max(0, Math.min(economyOf(settings, 'whoops.perLength') * Math.floor(target.length / economyOf(settings, 'whoops.lengthStep')),
      economyOf(settings, 'whoops.mostInAll') - basePrice(whoops, settings))),
  canApply: (target, effects) => landsOnPost(whoops, target, effects),
  // Only the ink is the caster's: anything else sent (a seed among them) is not kept.
  validateConfig: (config) => {
    const ink = color(typeof config === 'object' && config !== null ? (config as { color?: unknown }).color : undefined);
    return ink ? ok({ color: ink }) : refuse('the ink is a color: a named one, or #rgb or #rrggbb');
  },
  validateState: (state) => {
    const { strokes, clean } = typeof state === 'object' && state !== null ? (state as { strokes?: unknown; clean?: unknown }) : { strokes: undefined, clean: undefined };
    if (!Array.isArray(strokes)) return refuse('strokes are a list');
    if (clean !== undefined && typeof clean !== 'boolean') return refuse('clean is true or false');
    if (strokes.length > STROKES.most) return refuse(`at most ${STROKES.most} strokes`);
    const out: Stroke[] = [];
    let total = 0;
    for (const s of strokes) {
      if (typeof s !== 'object' || s === null) return refuse('a stroke is a path');
      const { tool, color: c, width, points } = s as { tool?: unknown; color?: unknown; width?: unknown; points?: unknown };
      if (tool !== 'wash' && tool !== 'ink') return refuse('a stroke washes or inks');
      const ink = tool === 'ink' ? color(c) : null;
      if (tool === 'ink' && !ink) return refuse('an ink stroke\'s color is a color');
      if (tool === 'wash' && c !== undefined) return refuse('a wash stroke has no color');
      if (typeof width !== 'number' || !(thousandth(width) > 0 && width <= STROKES.widest)) return refuse(`a stroke is between 0 and ${STROKES.widest} wide`);
      if (!Array.isArray(points) || points.length < 1 || points.length > STROKES.points) return refuse(`a stroke has 1 to ${STROKES.points} points`);
      total += points.length;
      if (total > STROKES.totalPoints) return refuse(`at most ${STROKES.totalPoints} points in all`);
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n)) || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= STROKES.deepest)) {
          return refuse(`a point is across from 0 to 1 and down from 0 to ${STROKES.deepest}, in widths of the layout`);
        }
      }
      const kept = (points as [number, number][]).map(([x, y]): [number, number] => [thousandth(x), thousandth(y)]);
      const w = thousandth(width);
      out.push(tool === 'ink' ? { tool, color: ink!, width: w, points: kept } : { tool, width: w, points: kept });
    }
    return ok(clean === undefined ? { strokes: out } : { strokes: out, clean });
  },
};
