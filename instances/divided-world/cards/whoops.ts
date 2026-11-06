/**
 * Whoops! (Salty): the caster splats a post in a color of their choosing. Any reader can scrub
 * the ink on their own screen; only the post's author's strokes are saved, so they can wash it
 * or write back in the ink, and everyone loads into their version (the screens' design, section
 * 11). Up to three Whoops! stack on one post, each its own play, layer and seed; the server
 * chooses each play's seed, and every reader draws the same splat from it. The card sells at its
 * base price; playing it on a long post costs the rest, 0.25 per 500 characters, never more than
 * 3.00 in all (the core loop's design, section 10).
 *
 * A stroke is kept in shares of the post body's box, with the proportions of the box it was made in,
 * never in widths of a fixed layout: across from 0 to 1 and down from 0 to 1, to a ten-thousandth,
 * so a point lands at the same share of the body on every screen. A stroke's `width` is the brush's
 * diameter as a share of the box's width, and its `aspect` is the drawer's box width over its
 * height (three significant figures), so a round brush on the drawer's screen is the same ellipse
 * in shares on every other (the refinements design, section 3). A stroke washes (no color) or inks
 * (the author writing back, in a color). `clean` is the
 * author's save saying the layer is washed clean, so it fades for everyone. Counts, points and widths are bounded so the largest save
 * there can be fits the database's bound on it (effect_state, supabase/migrations/0006_cards.sql),
 * which cards.test.ts measures as Postgres writes it.
 */
import { basePrice, color, economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

export const STROKES = { most: 200, points: 500, totalPoints: 12_000, widest: 1, deepest: 1 } as const;
const tenThousandth = (n: number) => Math.round(n * 10_000) / 10_000;
const threeFigures = (n: number) => Number(n.toPrecision(3));
const ASPECT = { least: 0.001, most: 1000 } as const;

type Stroke = { tool: 'wash'; width: number; aspect: number; points: [number, number][] } | { tool: 'ink'; color: string; width: number; aspect: number; points: [number, number][] };

export const whoops: CardRules<{ color: string }> = {
  key: 'whoops',
  name: 'Whoops!',
  alignment: 'salty',
  rarity: 'common',
  priceKey: 'whoops.price',
  stack: 3,
  seeded: true,
  /** A layer counts as washed clean at this share of it, in whole percent (the effect's, read by the screens). */
  screenReads: [{ key: 'whoops.clean', whole: true, min: 1, max: 100 }],
  reads: [{ key: 'whoops.perLength', whole: true, min: 0 }, { key: 'whoops.lengthStep', whole: true, min: 1 }, { key: 'whoops.mostInAll', whole: true, min: 1 }],
  // Whoops! lands on a post alone, so a target that is none is priced nothing; landsOn refuses it first.
  playPrice: (settings, target) => target.reach !== 'post' ? 0 :
    Math.max(0, Math.min(economyOf(settings, 'whoops.perLength') * Math.floor(target.length / economyOf(settings, 'whoops.lengthStep')),
      economyOf(settings, 'whoops.mostInAll') - basePrice(whoops, settings))),
  canApply: (target, effects, _config, now) => landsOn(whoops, target, effects, now),
  /** The inks code falls back on when a persona's own ink fails (staffConfigOf). */
  staffConfigs: [{ color: 'red' }, { color: 'teal' }, { color: 'orange' }, { color: 'purple' }, { color: 'lime' }],
  staffOptions: {
    prompt: 'Choose the ink the post is splatted in: a basic color name such as teal or crimson, or a hex color written #rrggbb.',
    schema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false },
  },
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
      const { tool, color: c, width, aspect, points } = s as { tool?: unknown; color?: unknown; width?: unknown; aspect?: unknown; points?: unknown };
      if (tool !== 'wash' && tool !== 'ink') return refuse('a stroke washes or inks');
      const ink = tool === 'ink' ? color(c) : null;
      if (tool === 'ink' && !ink) return refuse('an ink stroke\'s color is a color');
      if (tool === 'wash' && c !== undefined) return refuse('a wash stroke has no color');
      if (typeof width !== 'number' || !(tenThousandth(width) > 0 && width <= STROKES.widest)) return refuse(`a stroke is wide from over 0 to ${STROKES.widest} of the box's width`);
      if (typeof aspect !== 'number' || !(aspect >= ASPECT.least && aspect <= ASPECT.most)) return refuse(`a stroke's aspect is the drawer's box width over its height, from ${ASPECT.least} to ${ASPECT.most}`);
      if (!Array.isArray(points) || points.length < 1 || points.length > STROKES.points) return refuse(`a stroke has 1 to ${STROKES.points} points`);
      total += points.length;
      if (total > STROKES.totalPoints) return refuse(`at most ${STROKES.totalPoints} points in all`);
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n)) || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= STROKES.deepest)) {
          return refuse(`a point is across from 0 to 1 and down from 0 to ${STROKES.deepest}, in shares of the box`);
        }
      }
      const kept = (points as [number, number][]).map(([x, y]): [number, number] => [tenThousandth(x), tenThousandth(y)]);
      const w = tenThousandth(width);
      const a = threeFigures(aspect);
      out.push(tool === 'ink' ? { tool, color: ink!, width: w, aspect: a, points: kept } : { tool, width: w, aspect: a, points: kept });
    }
    return ok(clean === undefined ? { strokes: out } : { strokes: out, clean });
  },
};
