/**
 * Graffiti (Pepperoni, rare): a wall on a post that any character may draw on, and the post's own character may wash. Divided World's
 * instance of the engine's surface (docs/plans/2026-11-11-graffiti-design.md, sections 2, 3, 8 and 9; plan Task 7). The engine counts the
 * cells the strokes cover against `graffiti.limit` (a whole percent of its 100 x 100 grid) and holds at most `surface.mostLive` live draws;
 * this card's part is the cans, the caps and the stencils, and the shape of a draw.
 *
 * - **A drawn stroke** is `{ can, cap, aspect, points }`: the can names its color (`CANS`) and the cap its width as a share of the box's
 *   width (`CAPS`, the core the engine counts). The width is never sent: whatever is sent as one is dropped, so a stroke cannot be wider
 *   than its cap. Points are shares of the post body's box, to a ten-thousandth; `aspect` is the drawer's box width over its height, to
 *   three significant figures, as Whoops!'s is.
 * - **A draw** is `{ strokes }`, at most 120 strokes of at most 300 points, 3,000 points in all, which fits 64 KiB as Postgres writes it;
 *   or `{ stencil, can, spot }`, a stencil placed in one cell of a 3 x 3 grid over the body. A stencil is expanded here, so the server,
 *   the chatter and the screen place it the same, and is kept with its key and its strokes. A stencil is drawn at aspect 1 and so stretches
 *   with the post body's shape, a third of its width by a third of its height, as any stroke does when the body reflows.
 * - **A wash** is `{ strokes }` of `{ aspect, points }` with the same bounds, at the sponge's width: 0.06 of the box's width.
 * - **A Mod Bot** names `{ stencil, can, spot }` and never freehands (The System acts inside bounded choices). Its options are a
 *   configuration `validateConfig` keeps, and `staffConfigs` are valid draws of the same shape, one for each stencil, which a Mod Bot's
 *   first draw is chosen from (the plan's Task 3 wires that: `staffConfigOf` returns `{}` for this card, since `validateConfig({})` accepts).
 */
import { landsOn, ok, refuse, type CardRules, type Verdict } from '../../../engine/rules/cards.ts';
import type { SurfaceStroke } from '../../../engine/rules/surface.ts';
import { STENCILS, STENCIL_KEYS, type StencilKey } from './graffiti/stencils.ts';

export const CANS = { black: '#111111', white: '#fafafa', red: '#e8202a', orange: '#ff7a1a', yellow: '#ffd200',
  lime: '#7ed321', green: '#16a34a', teal: '#14b8a6', cyan: '#22c7f0', blue: '#2457e6', purple: '#7c3aed',
  pink: '#ff3d9a', brown: '#8b5a2b', silver: '#b8bcc4' } as const;
export const CAPS = { skinny: 0.006, stock: 0.016, fat: 0.04 } as const;
export type Can = keyof typeof CANS;
export type Cap = keyof typeof CAPS;
/** The sponge's width, as a share of the box's width. */
export const SPONGE = 0.06;
export const BOUNDS = { strokes: 120, points: 300, totalPoints: 3000, mostLive: 48 } as const;
const ASPECT = { least: 0.001, most: 1000 } as const;

const tenThousandth = (n: number) => Math.round(n * 10_000) / 10_000;
const threeFigures = (n: number) => Number(n.toPrecision(3));
const isCan = (v: unknown): v is Can => typeof v === 'string' && Object.hasOwn(CANS, v);
const isCap = (v: unknown): v is Cap => typeof v === 'string' && Object.hasOwn(CAPS, v);
const isStencil = (v: unknown): v is StencilKey => typeof v === 'string' && Object.hasOwn(STENCILS, v);
const isSpot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8;
const CAN_WORDS = `the cans are ${Object.keys(CANS).join(', ')}`;

type Points = [number, number][];
type Kept = { aspect: number; points: Points };
type Drawn = Kept & { can: Can; cap: Cap };

/** The bounds every stroke list holds, and the aspect and points each stroke keeps; `each` checks and keeps what is the stroke's alone. */
function strokesOf<T extends Kept>(input: unknown, each: (s: Record<string, unknown>, kept: Kept) => Verdict<T>): Verdict<T[]> {
  const list = typeof input === 'object' && input !== null ? (input as { strokes?: unknown }).strokes : undefined;
  if (!Array.isArray(list) || list.length < 1) return refuse('send the strokes, a list of at least one');
  if (list.length > BOUNDS.strokes) return refuse(`at most ${BOUNDS.strokes} strokes`);
  const out: T[] = [];
  let total = 0;
  for (const [i, s] of list.entries()) {
    const at = `stroke ${i + 1}`;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return refuse(`${at}: a stroke is an object with a can, a cap, an aspect and points`);
    const { aspect, points } = s as { aspect?: unknown; points?: unknown };
    if (typeof aspect !== 'number' || !(aspect >= ASPECT.least && aspect <= ASPECT.most)) return refuse(`${at}: the aspect is the drawer's box width over its height, from ${ASPECT.least} to ${ASPECT.most}`);
    if (!Array.isArray(points) || points.length < 1 || points.length > BOUNDS.points) return refuse(`${at}: a stroke has 1 to ${BOUNDS.points} points`);
    total += points.length;
    if (total > BOUNDS.totalPoints) return refuse(`${at}: at most ${BOUNDS.totalPoints} points in all`);
    for (const [j, p] of points.entries()) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return refuse(`${at}, point ${j + 1}: a point is two numbers, across then down`);
      if (!(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) return refuse(`${at}, point ${j + 1}: a point is across and down from 0 to 1, in shares of the box`);
    }
    const kept = { aspect: threeFigures(aspect), points: (points as [number, number][]).map(([x, y]): [number, number] => [tenThousandth(x), tenThousandth(y)]) };
    const one = each(s as Record<string, unknown>, kept);
    if (!one.ok) return refuse(`${at}: ${one.why}`);
    out.push(one.value);
  }
  return ok(out);
}

/** A stencil as strokes: scaled to a third of the box's width, centered in its spot, at aspect 1. */
function place(key: StencilKey, can: Can, spot: number): Drawn[] {
  const [col, row] = [spot % 3, Math.floor(spot / 3)];
  return STENCILS[key].strokes.map((s) => ({
    can, cap: s.cap, aspect: 1,
    points: s.points.map(([x, y]): [number, number] => [tenThousandth((col + x) / 3), tenThousandth((row + y) / 3)]),
  }));
}

const engine = (s: Drawn): SurfaceStroke => ({ width: CAPS[s.cap], aspect: s.aspect, points: s.points });

/** A stencil's named parts, checked: its key, its can and its spot. */
function named(input: unknown): Verdict<{ stencil: StencilKey; can: Can; spot: number }> {
  const { stencil, can, spot } = (typeof input === 'object' && input !== null ? input : {}) as { stencil?: unknown; can?: unknown; spot?: unknown };
  if (!isStencil(stencil)) return refuse(`choose a stencil: ${STENCIL_KEYS.join(', ')}`);
  if (!isCan(can)) return refuse(`choose a can: ${CAN_WORDS}`);
  if (!isSpot(spot)) return refuse('choose a spot, 0 to 8: the nine cells of a 3 by 3 grid over the post, left to right, top to bottom');
  return ok({ stencil, can, spot });
}

function validateDraw(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }> {
  const body = typeof input === 'object' && input !== null ? (input as { stencil?: unknown; strokes?: unknown }) : {};
  if (body.stencil !== undefined) {
    if (body.strokes !== undefined) return refuse('a draw is strokes or a stencil, not both');
    const n = named(input);
    if (!n.ok) return n;
    const strokes = place(n.value.stencil, n.value.can, n.value.spot);
    return ok({ strokes: strokes.map(engine), payload: { stencil: n.value.stencil, can: n.value.can, spot: n.value.spot, strokes } });
  }
  const drawn = strokesOf<Drawn>(input, (s, kept) => {
    if (!isCan(s.can)) return refuse(`the can is one of the cans: ${CAN_WORDS}`);
    if (!isCap(s.cap)) return refuse(`the cap is ${Object.keys(CAPS).join(', ')}`);
    return ok({ can: s.can, cap: s.cap, ...kept });
  });
  if (!drawn.ok) return drawn;
  return ok({ strokes: drawn.value.map(engine), payload: { strokes: drawn.value } });
}

function validateWash(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }> {
  const washed = strokesOf<Kept>(input, (_s, kept) => ok(kept));
  if (!washed.ok) return washed;
  return ok({ strokes: washed.value.map((s) => ({ width: SPONGE, ...s })), payload: { strokes: washed.value } });
}

/** What a Mod Bot names: a stencil, a can and a spot. */
export type GraffitiConfig = { readonly stencil?: never } | { readonly stencil: StencilKey; readonly can: Can; readonly spot: number };

export const graffiti: CardRules<GraffitiConfig> = {
  key: 'graffiti',
  name: 'Graffiti',
  alignment: 'pepperoni',
  rarity: 'rare',
  stack: 1,
  screenReads: [{ key: 'graffiti.limit', whole: true, min: 1, max: 100 }],
  surface: { limitKey: 'graffiti.limit', mostLive: BOUNDS.mostLive, validateDraw, validateWash },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(graffiti, target, effects, now),
  // A player's play names nothing (the draw is the first draw); a Mod Bot's names a stencil, a can and a spot, all or none.
  validateConfig: (config): Verdict<GraffitiConfig> => {
    if (typeof config !== 'object' || config === null || !('stencil' in config || 'can' in config || 'spot' in config)) return ok({});
    return named(config);
  },
  /** One for each stencil, each a valid draw as well as a configuration. */
  staffConfigs: STENCIL_KEYS.map((stencil, i): GraffitiConfig => ({ stencil, can: (['red', 'teal', 'orange', 'purple', 'lime', 'pink'] as const)[i % 6]!, spot: [4, 1, 0, 7, 4, 2][i % 6]! })),
  staffOptions: {
    prompt: `Choose a stencil to spray on the post: ${STENCIL_KEYS.join(', ')}. Choose a can for it: ${Object.keys(CANS).join(', ')}. Choose a spot, 0 to 8: the nine cells of a 3 by 3 grid over the post, left to right and top to bottom, so 4 is the middle.`,
    schema: {
      type: 'object',
      properties: { stencil: { enum: [...STENCIL_KEYS] }, can: { enum: Object.keys(CANS) }, spot: { enum: [0, 1, 2, 3, 4, 5, 6, 7, 8] } },
      required: ['stencil', 'can', 'spot'],
      additionalProperties: false,
    },
  },
};
